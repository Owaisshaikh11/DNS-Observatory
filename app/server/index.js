/**
 * index.js — Visualizer Backend
 *
 * Single Node.js process that runs:
 *   1. The custom DNS UDP server on port 5354
 *   2. The Express + Socket.io API server on port 4000
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
  app.use(express.json());

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
    const { domain, type = 'A' } = req.body || {};

    if (!domain || typeof domain !== 'string' || domain.trim().length === 0) {
      return res.status(400).json({ error: 'domain is required and must be a non-empty string' });
    }

    // Sanitise: lowercase, remove trailing dot, reject obviously bad input
    const cleanDomain = domain.trim().toLowerCase().replace(/\.$/, '');
    if (!/^[a-z0-9]([a-z0-9\-.]*[a-z0-9])?$/.test(cleanDomain)) {
      return res.status(400).json({ error: `"${domain}" is not a valid domain name` });
    }

    const allowedTypes = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'ALL'];
    const cleanType = String(type).toUpperCase().trim();
    if (!allowedTypes.includes(cleanType)) {
      return res.status(400).json({ error: `Invalid type "${type}". Allowed: ${allowedTypes.join(', ')}` });
    }

    console.log(`[Trace] ${cleanDomain} ${cleanType}`);

    try {
      const trace = await iterativeTrace(cleanDomain, cleanType);
      res.json(trace);
    } catch (err) {
      console.error(`[Trace] Error for ${cleanDomain}:`, err.message);
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
    const { domain, type = 'A' } = req.body || {};

    if (!domain || typeof domain !== 'string' || domain.trim().length === 0) {
      return res.status(400).json({ error: 'domain is required' });
    }

    console.log(`[Benchmark] ${domain.trim()} ${type}`);

    try {
      const result = await benchmarkResolvers(domain.trim(), type);
      res.json(result);
    } catch (err) {
      console.error('[Benchmark] Error:', err.message);
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
    const { domain, type = 'A' } = req.body || {};

    if (!domain || typeof domain !== 'string' || domain.trim().length === 0) {
      return res.status(400).json({ error: 'domain is required and must be a non-empty string' });
    }

    const cleanDomain = domain.trim().toLowerCase().replace(/\.$/, '');
    const allowedTypes = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA'];
    const cleanType = String(type).toUpperCase().trim();
    if (!allowedTypes.includes(cleanType)) {
      return res.status(400).json({ error: `Invalid type "${type}". Allowed: ${allowedTypes.join(', ')}` });
    }

    const { buildDnsQuery } = require('./dns-query-writer');
    const dgram = require('dgram');
    const TYPE_NUMBERS = { A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, TXT: 16, AAAA: 28 };
    const typeNum = TYPE_NUMBERS[cleanType] || 1;

    try {
      const queryBuffer = buildDnsQuery(cleanDomain, typeNum, { recursionDesired: true });
      const client = dgram.createSocket('udp4');
      client.send(queryBuffer, 5354, '127.0.0.1', (err) => {
        client.close();
        if (err) {
          console.error('[Packet Engine] Failed to inject mock query:', err.message);
          return res.status(500).json({ error: `Failed to inject query: ${err.message}` });
        }
        res.json({ success: true, message: `Injected UDP query to port 5354 for ${cleanDomain} (${cleanType})` });
      });
    } catch (err) {
      console.error('[Packet Engine] Injection build failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });



  // ── Start listening ────────────────────────────────────────────────────────
  httpServer.listen(API_PORT, () => {
    console.log(`[API] Visualizer backend running at http://localhost:${API_PORT}`);
    console.log(`[DNS] Custom DNS server running on UDP port ${DNS_PORT}`);
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  process.on('SIGINT', () => {
    console.log('\n[Shutdown] Closing servers...');
    dnsServer.close();
    httpServer.close(() => {
      console.log('[Shutdown] Done. Goodbye!');
      process.exit(0);
    });
  });
}

start().catch((err) => {
  console.error('[Fatal] Failed to start:', err.message);
  process.exit(1);
});
