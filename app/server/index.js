/**
 * index.js — Visualizer Backend
 *
 * Single Node.js process that runs:
 *   1. The custom DNS UDP server on port 5354
 *   2. The Express  API server on port 4000
 *
 * Running both in the same process lets the telemetry bridge subscribe
 * directly to the DNS server's EventEmitter and stream events to the
 * frontend over WebSocket — no IPC or polling needed.
 *
 * API routes:
 *   POST /api/dns/trace      — full iterative trace for a domain/type
 *   POST /api/dns/benchmark  — Cloudflare vs Google latency comparison
 *
 * WebSocket events emitted to clients:
 *   dns:query                — every query that passes through the local DNS server
 */

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const pinoHttp = require('pino-http');
const logger = require('./logger');

const { iterativeTrace, benchmarkResolvers } = require('./dns-iterative');

// Pull in the custom DNS server from the sibling directory
const { startDnsUdpServer } = require('../../custom-dns-server/server/dns-server');
const { loadRecords } = require('../../custom-dns-server/lib/record-manager');
const { loadDynamicSubdomains, cleanupExpiredSubdomains } = require('../../custom-dns-server/lib/dynamic-records');

const API_PORT = process.env.API_PORT || 4000;
const DNS_PORT = process.env.DNS_PORT || 5354;
const DNS_RECORDS_PATH = path.resolve(__dirname, '../../custom-dns-server/config/dns-records.json');

// Allow the Vite dev server and any localhost origin during development
const CORS_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

if (process.env.CORS_ORIGINS) {
  const envOrigins = process.env.CORS_ORIGINS.split(',')
    .map(o => o.trim())
    .filter(o => o.length > 0);
  CORS_ORIGINS.push(...envOrigins);
}

// In-memory sliding window rate limiter for /api/dns/*
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 100; // 100 requests per window
const ipRequests = new Map(); // key: ip -> value: array of timestamps (numbers)

// Periodically clean up expired IPs to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of ipRequests.entries()) {
    const validTimestamps = timestamps.filter(time => now - time < RATE_LIMIT_WINDOW_MS);
    if (validTimestamps.length === 0) {
      ipRequests.delete(ip);
    } else {
      ipRequests.set(ip, validTimestamps);
    }
  }
}, 5 * 60 * 1000).unref();

function apiRateLimiter(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();

  if (!ipRequests.has(ip)) {
    ipRequests.set(ip, []);
  }

  const timestamps = ipRequests.get(ip);
  const activeTimestamps = timestamps.filter(time => now - time < RATE_LIMIT_WINDOW_MS);

  if (activeTimestamps.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: 'Too many requests from this IP, please try again after 15 minutes'
    });
  }

  activeTimestamps.push(now);
  ipRequests.set(ip, activeTimestamps);
  next();
}

async function start() {
  // ── 1. Start the custom DNS server ─────────────────────────────────────────
  loadRecords(DNS_RECORDS_PATH);
  loadDynamicSubdomains();

  const dnsServer = startDnsUdpServer(DNS_PORT);
  setInterval(cleanupExpiredSubdomains, 60_000);

  // ── 2. Set up Express ──────────────────────────────────────────────────────
  const app = express();
  const httpServer = http.createServer(app);

  app.use(cors({ origin: CORS_ORIGINS }));
  app.use(pinoHttp({ logger }));
  app.use(express.json());
  app.use('/api/dns/', apiRateLimiter);

  // ── API Routes ─────────────────────────────────────────────────────────────

  /**
   * POST /api/dns/trace
   * Body: { domain: string, type: string }
   *
   * Runs a full iterative trace from root to authoritative nameserver,
   * collecting RTT, GeoIP, DNSSEC presence, and raw hex for every hop.
   *
   * Returns a TraceResult object (see dns-iterative.js for the full shape).
   */
  app.post('/api/dns/trace', async (req, res) => {
    try {
      const { domain, type = 'A', resolver } = req.body || {};

      if (!domain || typeof domain !== 'string' || domain.trim().length === 0) {
        return res.status(400).json({ error: 'domain is required and must be a non-empty string' });
      }

      // Sanitise: lowercase, remove trailing dot, reject obviously bad input
      const cleanDomain = domain.trim().toLowerCase().replace(/\.$/, '');
      if (!/^[a-z0-9_]([a-z0-9\-_.]*[a-z0-9_])?$/.test(cleanDomain)) {
        return res.status(400).json({ error: `"${domain}" is not a valid domain name` });
      }

      const allowedTypes = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'PTR', 'SRV', 'ALL'];
      const cleanType = String(type).toUpperCase().trim();
      if (!allowedTypes.includes(cleanType)) {
        return res.status(400).json({ error: `Invalid type "${type}". Allowed: ${allowedTypes.join(', ')}` });
      }

      // Validate the resolver parameter
      let cleanResolver = '1.1.1.1';
      if (resolver && typeof resolver === 'string') {
        const trimmed = resolver.trim();
        const net = require('net');
        if (net.isIP(trimmed)) {
          cleanResolver = trimmed;
        }
      }

      req.log.info({ domain: cleanDomain, recordType: cleanType, resolver: cleanResolver }, `Initiating trace for ${cleanDomain} (${cleanType}) using resolver ${cleanResolver}`);

      const trace = await iterativeTrace(cleanDomain, cleanType, cleanResolver);
      res.json(trace);
    } catch (err) {
      const domainVal = req.body && typeof req.body.domain === 'string' ? req.body.domain.trim() : 'unknown';
      const typeVal = req.body && req.body.type ? String(req.body.type) : 'A';
      req.log.error({ err, domain: domainVal, recordType: typeVal }, `Error executing trace for ${domainVal}`);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/dns/benchmark
   * Body: { domain: string, type: string }
   *
   * Queries Cloudflare (1.1.1.1) and Google (8.8.8.8) in parallel and
   * returns each resolver's latency, RCODE, and answer records.
   */
  app.post('/api/dns/benchmark', async (req, res) => {
    try {
      const { domain, type = 'A' } = req.body || {};

      if (!domain || typeof domain !== 'string' || domain.trim().length === 0) {
        return res.status(400).json({ error: 'domain is required and must be a non-empty string' });
      }

      // Sanitise: lowercase, remove trailing dot, reject obviously bad input
      const cleanDomain = domain.trim().toLowerCase().replace(/\.$/, '');
      if (!/^[a-z0-9_]([a-z0-9\-_.]*[a-z0-9_])?$/.test(cleanDomain)) {
        return res.status(400).json({ error: `"${domain}" is not a valid domain name` });
      }

      const allowedTypes = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'PTR', 'SRV', 'ALL'];
      const cleanType = String(type).toUpperCase().trim();
      if (!allowedTypes.includes(cleanType)) {
        return res.status(400).json({ error: `Invalid type "${type}". Allowed: ${allowedTypes.join(', ')}` });
      }

      req.log.info({ domain: cleanDomain, recordType: cleanType }, `Initiating benchmark for ${cleanDomain} (${cleanType})`);

      const result = await benchmarkResolvers(cleanDomain, cleanType);
      res.json(result);
    } catch (err) {
      const domainVal = req.body && typeof req.body.domain === 'string' ? req.body.domain.trim() : 'unknown';
      const typeVal = req.body && req.body.type ? String(req.body.type) : 'A';
      req.log.error({ err, domain: domainVal, recordType: typeVal }, `Error executing benchmark for ${domainVal}`);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/dns/inject
   * Body: { domain: string, type: string }
   *
   * Sends a raw UDP query to localhost:5354 to trigger telemetry collection.
   */
  app.post('/api/dns/inject', async (req, res) => {
    try {
      const { domain, type = 'A' } = req.body || {};

      if (!domain || typeof domain !== 'string' || domain.trim().length === 0) {
        return res.status(400).json({ error: 'domain is required and must be a non-empty string' });
      }

      const cleanDomain = domain.trim().toLowerCase().replace(/\.$/, '');
      const allowedTypes = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'PTR', 'SRV'];
      const cleanType = String(type).toUpperCase().trim();
      if (!allowedTypes.includes(cleanType)) {
        return res.status(400).json({ error: `Invalid type "${type}". Allowed: ${allowedTypes.join(', ')}` });
      }

      const { buildDnsQuery } = require('./dns-query-writer');
      const dgram = require('dgram');
      const TYPE_NUMBERS = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33 };
      const typeNum = TYPE_NUMBERS[cleanType] || 1;

      const queryBuffer = buildDnsQuery(cleanDomain, typeNum, { recursionDesired: true });
      const client = dgram.createSocket('udp4');
      client.send(queryBuffer, 5354, '127.0.0.1', (err) => {
        client.close();
        if (err) {
          req.log.error({ err, domain: cleanDomain, recordType: cleanType }, 'Failed to inject mock query');
          return res.status(500).json({ error: `Failed to inject query: ${err.message}` });
        }
        res.json({ success: true, message: `Injected UDP query to port 5354 for ${cleanDomain} (${cleanType})` });
      });
    } catch (err) {
      const domainVal = req.body && typeof req.body.domain === 'string' ? req.body.domain.trim() : 'unknown';
      const typeVal = req.body && req.body.type ? String(req.body.type) : 'A';
      req.log.error({ err, domain: domainVal, recordType: typeVal }, 'Injection build failed');
      res.status(500).json({ error: err.message });
    }
  });

  // ── API Catch-All (failsafe JSON 404 for unmatched /api/* routes) ──────────
  app.all('/api/{*splat}', (req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  // ── Production Static Asset serving & SPA routing fallback ────────────────
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, '../dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ── Start listening ────────────────────────────────────────────────────────
  httpServer.listen(API_PORT);

  httpServer.on('listening', () => {
    const boundPort = httpServer.address().port;
    logger.info(`Visualizer backend running at http://localhost:${boundPort}`);
    logger.info(`Custom DNS server running on UDP port ${DNS_PORT}`);
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`API Port ${API_PORT} in use, falling back to a random port.`);
      httpServer.listen(0);
    } else {
      logger.error({ err }, 'HTTP server error');
    }
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  process.on('SIGINT', () => {
    logger.info('Closing servers...');
    dnsServer.close();
    httpServer.close(() => {
      logger.info('Servers closed. Goodbye!');
      process.exit(0);
    });
  });
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start Visualizer backend');
  process.exit(1);
});
