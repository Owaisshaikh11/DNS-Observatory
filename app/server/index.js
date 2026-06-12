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
const { Server: SocketIOServer } = require('socket.io');

const { iterativeTrace, benchmarkResolvers } = require('./dns-iterative');
const { connectTelemetry } = require('./telemetry-bridge');

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

  // ── 2. Set up Express + Socket.io ──────────────────────────────────────────
  const app = express();
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: CORS_ORIGINS, methods: ['GET', 'POST'] },
  });

  app.use(cors({ origin: CORS_ORIGINS }));
  app.use(express.json());

  // ── 3. Connect telemetry bridge ────────────────────────────────────────────
  connectTelemetry(dnsServer, io);

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

  // ── Socket.io connection logging ───────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);
    socket.on('disconnect', () => {
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
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
