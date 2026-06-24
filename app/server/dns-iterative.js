/**
 * dns-iterative.js
 *
 * The core of the DNS Observatory visualizer. Performs full iterative DNS
 * resolution by querying each tier of the hierarchy in sequence:
 *
 *   Client → Local Custom DNS → Root (RD=0) → TLD (RD=0) → Authoritative (RD=0)
 *
 * Every hop is captured with:
 *   - Exact RTT (latency)
 *   - Cumulative elapsed time
 *   - Full parsed response (answers, authority, additional sections)
 *   - DNSSEC presence flags
 *   - GeoIP metadata for the queried server
 *   - Raw hex bytes of the response packet
 *   - A human-readable description of what happened at this step
 *   - Fixed (x, y) tree positions for the SVG visualizer
 *
 * Also exports benchmarkResolvers() for comparing Cloudflare vs Google RTTs.
 */

const dgram = require('dgram');
const net = require('net');
const logger = require('./logger');
const { buildDnsQuery } = require('./dns-query-writer');
const { parseDnsResponse } = require('./dns-response-parser');
const { parseQuery } = require('../../custom-dns-server/lib/dns-parser');
const { lookupGeoIp } = require('./geoip-service');
const ROOT_SERVERS = require('./root-hints');

// ── Record type name → number ──────────────────────────────────────────────
const TYPE_NUMBERS = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
};



// ── UDP Query ──────────────────────────────────────────────────────────────

/**
 * Sends a raw DNS query buffer over UDP and waits for a response.
 * Matches the response by TX ID to avoid accepting stray packets.
 *
 * @param {string} ip          - Target DNS server IP
 * @param {number} port        - Target port (usually 53)
 * @param {Buffer} queryBuffer - Raw DNS query packet
 * @param {number} timeoutMs   - Max wait time in milliseconds
 * @returns {Promise<Buffer>}  - Raw DNS response packet
 */
function sendUdpQuery(ip, port, queryBuffer, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const expectedTxId = queryBuffer.readUInt16BE(0);
    let settled = false;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      err ? reject(err) : resolve(result);
    };

    const timer = setTimeout(() => {
      finish(new Error(`Timeout querying ${ip}:${port} after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on('message', (msg) => {
      if (msg.length >= 2 && msg.readUInt16BE(0) === expectedTxId) {
        finish(null, msg);
      }
    });

    socket.on('error', (err) => finish(err));

    socket.send(queryBuffer, port, ip, (err) => {
      if (err) finish(err);
    });
  });
}

/**
 * Sends a raw DNS query buffer over TCP to a target DNS server.
 * Prefixes the query with its 2-byte Big-Endian length header and reads the response length.
 * Cleanly destroys the socket under all conditions to prevent leaks.
 *
 * @param {string} ip          - Target DNS server IP
 * @param {number} port        - Target port (usually 53)
 * @param {Buffer} queryBuffer - Raw DNS query packet
 * @param {number} timeoutMs   - Max wait time in milliseconds
 * @returns {Promise<Buffer>}  - Raw DNS response packet (excluding length prefix)
 */
function sendTcpQuery(ip, port, queryBuffer, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    let receivedBuffer = Buffer.alloc(0);
    let expectedLength = null;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* already destroyed */
      }
      err ? reject(err) : resolve(result);
    };

    const timer = setTimeout(() => {
      finish(new Error(`Timeout querying ${ip}:${port} over TCP after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.connect(port, ip, () => {
      // 2-Byte Length Rule: Prefix outgoing query buffers with their 2-byte Big-Endian length header
      const lenBuffer = Buffer.alloc(2);
      lenBuffer.writeUInt16BE(queryBuffer.length, 0);
      const payload = Buffer.concat([lenBuffer, queryBuffer]);
      socket.write(payload);
    });

    socket.on('data', (chunk) => {
      // Concatenate incoming stream chunks
      receivedBuffer = Buffer.concat([receivedBuffer, chunk]);

      if (expectedLength === null && receivedBuffer.length >= 2) {
        expectedLength = receivedBuffer.readUInt16BE(0);
      }

      // Only resolve when the received buffer size is >= 2 bytes + the expected packet length
      if (expectedLength !== null && receivedBuffer.length >= 2 + expectedLength) {
        const dnsPacket = receivedBuffer.slice(2, 2 + expectedLength);
        finish(null, dnsPacket);
      }
    });

    socket.on('error', (err) => finish(err));

    socket.on('close', () => {
      if (!settled) {
        finish(new Error(`TCP socket closed before response was fully received`));
      }
    });
  });
}

/**
 * Performs a single DNS hop: builds a query packet, sends it, parses the
 * response, and measures the round-trip time. Handles automatic TCP failover.
 *
 * @param {string} ip      - DNS server IP address to query
 * @param {number} port    - DNS server port (usually 53)
 * @param {string} domain  - Domain name to look up
 * @param {number} typeNum - Record type number
 * @param {object} opts    - { recursionDesired, dnssecOk, timeoutMs }
 * @returns {Promise<{parsed, latencyMs, byteLength, queryHex, queryPacket, resolvedOverTcp}>}
 */
async function performHop(ip, port, domain, typeNum, opts = {}) {
  const query = buildDnsQuery(domain, typeNum, {
    recursionDesired: opts.recursionDesired || false,
    dnssecOk: opts.dnssecOk !== false, // default true for DNSSEC visibility
  });

  const queryHex = [...query].map(b => b.toString(16).padStart(2, '0')).join(' ');
  let queryPacket = null;
  try {
    queryPacket = parseQuery(query);
    queryPacket.rawHex = queryHex;
  } catch (err) {
    logger.error({ err }, `[Iterative] Failed to parse request query buffer: ${err.message}`);
  }

  const attempts = [];
  const start = Date.now();
  let rawResponse = null;
  let latencyMs;
  let resolvedOverTcp;
  let failureReason;
  let parsed;

  const udpStart = Date.now();
  try {
    rawResponse = await sendUdpQuery(ip, port, query, opts.timeoutMs || 3000);
    const udpLatency = Date.now() - udpStart;
    latencyMs = Date.now() - start;
    parsed = parseDnsResponse(rawResponse);
    attempts.push({
      protocol: 'UDP',
      success: true,
      latencyMs: udpLatency,
      byteLength: rawResponse.length,
      rcode: parsed.rcode,
      isTruncated: parsed.isTruncated,
      queryPacket,
      responsePacket: {
        rawHex: [...rawResponse].map(b => b.toString(16).padStart(2, '0')).join(' '),
      },
    });
  } catch (err) {
    const udpLatency = Date.now() - udpStart;
    latencyMs = Date.now() - start;
    const expectedTxId = query.readUInt16BE(0);
    parsed = {
      id: expectedTxId,
      flags: ['QR'],
      rawFlags: 0x8002, // SERVFAIL
      opcode: 'QUERY',
      opcodeNum: 0,
      rcode: 'SERVFAIL',
      rcodeNum: 2,
      qdcount: 0,
      ancount: 0,
      nscount: 0,
      arcount: 0,
      isAuthoritative: false,
      isTruncated: false,
      isRecursionAvail: false,
      questions: [],
      answers: [],
      authority: [],
      additional: [],
      dnssec: { rrsigPresent: false, dnskeyPresent: false, dsPresent: false },
      dnssecPresent: false,
      rawHex: '',
    };
    failureReason = `UDP Query Failed: ${err.message}. The nameserver did not respond or was unreachable over UDP port 53.`;
    attempts.push({
      protocol: 'UDP',
      success: false,
      latencyMs: udpLatency,
      error: err.message,
      rcode: 'SERVFAIL',
      queryPacket,
    });
  }

  // Fallback Trigger: Inspect parsed UDP response. If truncated, retry over TCP.
  if (!failureReason && parsed.isTruncated) {
    logger.info(`[Iterative] UDP response truncated for ${domain}, retrying query over TCP to ${ip}:${port}...`);
    const tcpStart = Date.now();
    try {
      const tcpResponse = await sendTcpQuery(ip, port, query, opts.timeoutMs || 3000);
      const tcpLatency = Date.now() - tcpStart;
      latencyMs = Date.now() - start; // recalculate overall latency
      rawResponse = tcpResponse;
      parsed = parseDnsResponse(rawResponse);
      resolvedOverTcp = true;
      attempts.push({
        protocol: 'TCP',
        success: true,
        latencyMs: tcpLatency,
        byteLength: rawResponse.length,
        rcode: parsed.rcode,
        isTruncated: false,
        queryPacket,
        responsePacket: {
          rawHex: [...rawResponse].map(b => b.toString(16).padStart(2, '0')).join(' '),
        },
      });
    } catch (err) {
      const tcpLatency = Date.now() - tcpStart;
      logger.error(`[Iterative] TCP failover failed to ${ip}:${port} for ${domain}: ${err.message}`);
      // Graceful Failures: fail the hop gracefully by returning a mock SERVFAIL response
      latencyMs = Date.now() - start;
      const expectedTxId = query.readUInt16BE(0);
      parsed = {
        id: expectedTxId,
        flags: ['QR'],
        rawFlags: 0x8002, // QR=1, RCODE=SERVFAIL
        opcode: 'QUERY',
        opcodeNum: 0,
        rcode: 'SERVFAIL',
        rcodeNum: 2,
        qdcount: 0,
        ancount: 0,
        nscount: 0,
        arcount: 0,
        isAuthoritative: false,
        isTruncated: false,
        isRecursionAvail: false,
        questions: [],
        answers: [],
        authority: [],
        additional: [],
        dnssec: { rrsigPresent: false, dnskeyPresent: false, dsPresent: false },
        dnssecPresent: false,
        rawHex: '',
      };

      // Formulate detailed, human-readable reasons for TCP failover failures
      if (err.code === 'ECONNREFUSED' || err.message.includes('ECONNREFUSED')) {
        if (ip === '127.0.0.1' && port === 5354) {
          failureReason = `TCP Failover Failed: Connection refused to the local custom DNS server (127.0.0.1:5354). The custom DNS server only runs a UDP socket listener, and port 5354/TCP is closed/inactive.`;
        } else {
          failureReason = `TCP Failover Failed: Connection refused by nameserver ${ip}:${port} on TCP port 53. The target nameserver may not support TCP resolution, or port 53/TCP is closed.`;
        }
      } else if (err.message.includes('timeout') || err.message.includes('Timeout')) {
        failureReason = `TCP Failover Failed: Connection timed out to nameserver ${ip}:${port} over TCP port 53. The server failed to respond within ${opts.timeoutMs || 3000}ms, possibly due to a firewall blocking TCP traffic.`;
      } else {
        failureReason = `TCP Failover Failed: ${err.message}. The TCP stream socket was reset or closed prematurely before the query complete.`;
      }
      attempts.push({
        protocol: 'TCP',
        success: false,
        latencyMs: tcpLatency,
        error: err.message,
        rcode: 'SERVFAIL',
        queryPacket,
      });
      resolvedOverTcp = false;
    }
  }

  return { parsed, latencyMs, byteLength: rawResponse ? rawResponse.length : 0, queryHex, queryPacket, resolvedOverTcp, failureReason, attempts };
}

// ── Referral Extraction ────────────────────────────────────────────────────

/**
 * Extracts the first usable NS referral from a DNS response.
 * Looks for an NS record in the Authority section whose name appears in the
 * Additional section as a glue A record. Returns the NS hostname and its IP.
 *
 * @param {object} parsed - Parsed DNS response
 * @returns {{ nsName, ip, zone } | null}
 */
function extractReferral(parsed) {
  // Build a map of hostname → IP from the additional (glue) records
  const glueMap = new Map();
  for (const rec of parsed.additional) {
    if (rec.typeName === 'A' && typeof rec.value === 'string') {
      const host = rec.name.replace(/\.$/, '').toLowerCase();
      glueMap.set(host, rec.value);
    }
  }

  // Find the first NS in the authority section that has a glue record
  for (const rec of parsed.authority) {
    if (rec.typeName !== 'NS' || !rec.value) continue;
    const nsName = String(rec.value).replace(/\.$/, '').toLowerCase();
    const ip = glueMap.get(nsName);
    if (ip) {
      return { nsName, ip, zone: rec.name.replace(/\.$/, '') };
    }
  }

  return null; // no glue available
}

/**
 * When a referral response has NS records but no glue A records, we need to
 * resolve the NS hostname separately. We use Cloudflare (1.1.1.1) with RD=1
 * for this "cold" lookup — we're not tracing it, just getting an IP.
 */
async function resolveNsHostname(nsHostname, resolverIp = '1.1.1.1') {
  const query = buildDnsQuery(nsHostname, TYPE_NUMBERS.A, {
    recursionDesired: true,
    dnssecOk: false,
  });
  try {
    const raw = await sendUdpQuery(resolverIp, 53, query, 3000);
    const parsed = parseDnsResponse(raw);
    const aRecord = parsed.answers.find(r => r.typeName === 'A');
    return aRecord ? aRecord.value : null;
  } catch (err) {
    logger.warn(`GeoIP/NS resolution failed querying custom resolver ${resolverIp}, falling back to 1.1.1.1. Error: ${err.message}`);
    try {
      const raw = await sendUdpQuery('1.1.1.1', 53, query, 3000);
      const parsed = parseDnsResponse(raw);
      const aRecord = parsed.answers.find(r => r.typeName === 'A');
      return aRecord ? aRecord.value : null;
    } catch (fallbackErr) {
      logger.error(`Fallback query to 1.1.1.1 also failed: ${fallbackErr.message}`);
      return null;
    }
  }
}

// ── Hop Builders ──────────────────────────────────────────────────────────

/**
 * Builds a structured hop object from the result of a DNS query.
 * This is the shape that the frontend's HopCard component consumes.
 */
function buildHop({ id, step, type, label, server, ip, port, latencyMs, cumulativeMs, parsed, geo, description, byteLength, queryDomain, queriedTypes, parallelQueries, queryPacket, resolvedOverTcp, failureReason, attempts }) {
  return {
    id,
    step,
    type,                                // 'CLIENT' | 'LOCAL' | 'ROOT' | 'TLD' | 'AUTH' | 'CNAME_REDIRECT'
    label,                               // human-readable label for the UI
    server,                              // hostname of the queried server
    ip,                                  // IP address of the queried server
    port: port || 53,
    latencyMs,
    cumulativeMs,                        // total time elapsed up to and including this hop
    resolvedOverTcp: resolvedOverTcp || false,
    failureReason: failureReason || null,
    attempts: attempts || null,
    description,                         // what happened here, in plain English
    geo,                                 // { flag, org, country, city, countryCode }
    queryDomain: queryDomain || null,
    queriedTypes: queriedTypes || (parsed?.typeName ? [parsed.typeName] : ['A']),
    parallelQueries: parallelQueries || null,
    queryPacket: queryPacket || null,
    response: parsed ? {
      id: parsed.id,
      rawFlags: parsed.rawFlags,
      flags: parsed.flags,
      qdcount: parsed.qdcount,
      ancount: parsed.ancount,
      nscount: parsed.nscount,
      arcount: parsed.arcount,
      questions: parsed.questions,
      rcode: parsed.rcode,
      answers: parsed.answers,
      authority: parsed.authority,
      additional: parsed.additional,
      dnssec: parsed.dnssec,
      rawHex: parsed.rawHex,
      byteLength: byteLength || null,
    } : null,
  };
}

// ── Main Trace Function ────────────────────────────────────────────────────

/**
 * Performs a full iterative DNS trace for a domain/type pair.
 *
 * Resolution path:
 *   1. CLIENT    — user's machine (no network, just a starting node)
 *   2. LOCAL     — custom DNS server (localhost:5354), checks local records
 *   3. ROOT      — one of the 13 root servers (RD=0), returns TLD referral
 *   4. TLD       — TLD nameserver (RD=0), returns authoritative referral
 *   5. AUTH      — authoritative nameserver (RD=0), returns final answer
 *
 * If the local server has an authoritative answer, steps 3–5 are skipped.
 * If "ALL" type is requested, the auth server is queried for multiple types.
 *
 * @param {string} domain     - Domain to resolve (e.g. "github.com")
 * @param {string} recordType - Record type string (e.g. "A", "MX", "ALL")
 * @returns {Promise<TraceResult>}
 */
async function iterativeTrace(domain, recordType = 'A', resolverIp = '1.1.1.1') {
  const hops = [];
  const edges = [];
  let cumulative = 0;
  let dnssecPresent = false;
  const cnameChain = [];
  let authZone = null;
  let authNs = null;
  let finalParsed = null;

  let currentDomain = domain.trim().toLowerCase().replace(/\.$/, '');
  let depth = 0;
  const maxDepth = 4;

  let clientCount = 0;
  let localCount = 0;
  let rootCount = 0;
  let tldCount = 0;
  let authCount = 0;
  let cnameCount = 0;

  while (depth < maxDepth) {
    const typeNum = TYPE_NUMBERS[recordType.toUpperCase()] || TYPE_NUMBERS.A;
    const isFirst = depth === 0;

    const clientHopId = `client-${clientCount++}`;
    const localHopId = `local-${localCount++}`;

    // 1. CLIENT Hop
    hops.push(buildHop({
      id: clientHopId,
      step: hops.length,
      type: 'CLIENT',
      label: isFirst ? 'Client Stub' : `Client Stub (${depth})`,
      server: null,
      ip: '127.0.0.1',
      port: null,
      latencyMs: 0,
      cumulativeMs: cumulative,
      parsed: null,
      geo: { flag: '💻', org: 'Local Machine', country: 'Local', city: null, countryCode: null },
      queryDomain: currentDomain,
      description: isFirst
        ? `Initiating iterative trace for ${currentDomain} [TYPE: ${recordType.toUpperCase()}]. Querying local custom DNS server first.`
        : `CNAME target resolution: initiating query for ${currentDomain} [TYPE: ${recordType.toUpperCase()}].`,
      queriedTypes: [recordType.toUpperCase()],
      parallelQueries: null,
    }));

    if (!isFirst) {
      edges.push({
        from: `cname-${cnameCount - 1}`,
        to: clientHopId,
        label: `Resolve ${currentDomain}`
      });
    }

    // 2. LOCAL Hop
    let isLocalHit = false;
    let localParsed = null;
    let localLatency;
    let localByteLength = 0;
    let localParallelQueries = [];

    try {
      const { parsed, latencyMs, byteLength, queryPacket, resolvedOverTcp, failureReason, attempts } = await performHop('127.0.0.1', 5354, currentDomain, typeNum, {
        recursionDesired: true,
        dnssecOk: false,
      });
      localParsed = parsed;
      localLatency = latencyMs;
      localByteLength = byteLength;
      cumulative += latencyMs;

      isLocalHit = parsed.isAuthoritative && parsed.answers.length > 0;

      if (isLocalHit && recordType.toUpperCase() === 'ALL') {
        localParallelQueries.push({
          type: 'A',
          latencyMs: latencyMs,
          byteLength: byteLength,
          rcode: parsed.rcode,
          queryPacket,
          responsePacket: parsed,
          resolvedOverTcp,
          failureReason,
          attempts,
        });

        const extraTypes = ['AAAA', 'MX', 'TXT', 'NS'];
        const extraResults = await Promise.allSettled(
          extraTypes.map(t => performHop('127.0.0.1', 5354, currentDomain, TYPE_NUMBERS[t], { recursionDesired: true, dnssecOk: false }))
        );

        extraTypes.forEach((t, idx) => {
          const res = extraResults[idx];
          if (res.status === 'fulfilled') {
            const val = res.value;
            localParsed.answers.push(...val.parsed.answers);
            localByteLength += val.byteLength;
            localParallelQueries.push({
              type: t,
              latencyMs: val.latencyMs,
              byteLength: val.byteLength,
              rcode: val.parsed.rcode,
              queryPacket: val.queryPacket,
              responsePacket: val.parsed,
              resolvedOverTcp: val.resolvedOverTcp,
              failureReason: val.failureReason,
              attempts: val.attempts,
            });
          } else {
            localParallelQueries.push({
              type: t,
              latencyMs: 0,
              byteLength: 0,
              rcode: 'TIMEOUT',
              error: res.reason.message,
              queryPacket: null,
              responsePacket: null,
              resolvedOverTcp: false,
              failureReason: `Query timed out or failed: ${res.reason.message}`,
              attempts: null,
            });
          }
        });

        const latencies = localParallelQueries.map(q => q.latencyMs);
        localLatency = Math.max(...latencies);
        cumulative = cumulative - latencyMs + localLatency;
      } else {
        localParallelQueries = [{
          type: recordType.toUpperCase(),
          latencyMs: localLatency,
          byteLength: localByteLength,
          rcode: localParsed ? localParsed.rcode : 'UNKNOWN',
          queryPacket,
          responsePacket: localParsed,
          resolvedOverTcp,
          failureReason,
          attempts,
        }];
      }

      const localDescription = isLocalHit
        ? `Local DNS server found an authoritative answer for ${currentDomain}. Returning cached/configured record — no iterative resolution needed.`
        : `Local DNS server has no authoritative record for ${currentDomain}. Starting iterative resolution from a root server.`;

      hops.push(buildHop({
        id: localHopId,
        step: hops.length,
        type: 'LOCAL',
        label: isFirst ? 'Custom DNS' : `Custom DNS (${depth})`,
        server: 'localhost',
        ip: '127.0.0.1',
        port: 5354,
        latencyMs: localLatency,
        cumulativeMs: cumulative,
        parsed,
        geo: { flag: '🖥️', org: 'Local DNS Server', country: 'Local', city: null, countryCode: null },
        queryDomain: currentDomain,
        description: localDescription,
        byteLength: localByteLength,
        queriedTypes: isLocalHit && recordType.toUpperCase() === 'ALL' ? ['A', 'AAAA', 'MX', 'TXT', 'NS'] : [recordType.toUpperCase()],
        parallelQueries: localParallelQueries,
        queryPacket,
        resolvedOverTcp,
        failureReason,
        attempts,
      }));
      edges.push({ from: clientHopId, to: localHopId, label: `Query ${currentDomain} ${recordType.toUpperCase()}` });

    } catch (err) {
      hops.push(buildHop({
        id: localHopId,
        step: hops.length,
        type: 'LOCAL',
        label: isFirst ? 'Custom DNS' : `Custom DNS (${depth})`,
        server: 'localhost',
        ip: '127.0.0.1',
        port: 5354,
        latencyMs: 0,
        cumulativeMs: cumulative,
        parsed: null,
        geo: { flag: '🖥️', org: 'Local DNS Server', country: 'Local', city: null, countryCode: null },
        queryDomain: currentDomain,
        description: `Local DNS server unreachable (${err.message}). Proceeding with public iterative resolution.`,
      }));
      edges.push({ from: clientHopId, to: localHopId, label: `Query ${currentDomain} ${recordType.toUpperCase()}` });
    }

    if (isLocalHit && localParsed) {
      const authHopId = `auth-${authCount++}`;
      edges.push({ from: localHopId, to: authHopId, label: 'Local authoritative answer' });

      hops.push(buildHop({
        id: authHopId,
        step: hops.length,
        type: 'AUTH',
        label: isFirst ? 'Authoritative' : `Authoritative (${depth})`,
        server: 'local-zone',
        ip: '127.0.0.1:5354',
        port: 5354,
        latencyMs: 0,
        cumulativeMs: cumulative,
        parsed: localParsed,
        geo: { flag: '🔐', org: 'Local Auth Zone' },
        queryDomain: currentDomain,
        description: `Local custom DNS served authoritative mapping directly.`,
        byteLength: localByteLength,
        queriedTypes: recordType.toUpperCase() === 'ALL' ? ['A', 'AAAA', 'MX', 'TXT', 'NS'] : [recordType.toUpperCase()],
        parallelQueries: localParallelQueries,
      }));

      finalParsed = localParsed;

      const cnameRec = localParsed.answers.find(r => r.typeName === 'CNAME' && r.name.replace(/\.$/, '').toLowerCase() === currentDomain);
      if (cnameRec) {
        const cnameTarget = String(cnameRec.value).replace(/\.$/, '').toLowerCase();
        cnameChain.push({ from: currentDomain, to: cnameTarget });

        const hasTargetIp = localParsed.answers.some(r => r.name.replace(/\.$/, '').toLowerCase() === cnameTarget && (r.typeName === 'A' || r.typeName === 'AAAA'));
        if (!hasTargetIp) {
          const cnameNodeId = `cname-${cnameCount++}`;
          hops.push({
            id: cnameNodeId,
            step: hops.length,
            type: 'CNAME_REDIRECT',
            label: 'CNAME Redirect',
            server: null,
            ip: null,
            port: null,
            latencyMs: 0,
            cumulativeMs: cumulative,
            description: `CNAME alias detected: ${currentDomain} points to ${cnameTarget}. Following redirection.`,
            geo: { flag: '🔗', org: 'CNAME Alias' },
            queryDomain: currentDomain,
            cnameFrom: currentDomain,
            cnameTo: cnameTarget,
            response: null,
            queriedTypes: [recordType.toUpperCase()],
            parallelQueries: null,
          });
          edges.push({ from: authHopId, to: cnameNodeId, label: 'CNAME Alias' });

          currentDomain = cnameTarget;
          depth++;
          continue;
        }
      }
      break;
    }

    // 3. Iterative Tracing Start
    const rootServer = ROOT_SERVERS[Math.floor(Math.random() * ROOT_SERVERS.length)];
    let currentQueryServerIp = rootServer.ipv4;
    let currentQueryServerName = rootServer.name;
    let currentQueryServerZone = '.';
    let iterativeHopCount = 0;
    let previousNodeId = localHopId;
    let nextReferralLabel = 'Iterative (RD=0)';
    let isTracePathTerminal = false;

    while (!isTracePathTerminal) {
      let type, currentNodeId, label;

      if (iterativeHopCount === 0) {
        type = 'ROOT';
        currentNodeId = `root-${rootCount++}`;
        label = 'Root (.)';
      } else if (iterativeHopCount === 1) {
        type = 'TLD';
        currentNodeId = `tld-${tldCount++}`;
        label = `TLD (.${currentQueryServerZone})`;
      } else {
        type = 'AUTH';
        currentNodeId = `auth-${authCount++}`;
        label = currentQueryServerZone;
      }

      let parsed;
      let latencyMs;
      let byteLength;
      let queryPacket;
      let resolvedOverTcp;
      let failureReason;
      let attempts;

      try {
        const hopResult = await performHop(
          currentQueryServerIp, 53, currentDomain, typeNum, { dnssecOk: true }
        );
        parsed = hopResult.parsed;
        latencyMs = hopResult.latencyMs;
        byteLength = hopResult.byteLength;
        queryPacket = hopResult.queryPacket;
        resolvedOverTcp = hopResult.resolvedOverTcp;
        failureReason = hopResult.failureReason;
        attempts = hopResult.attempts;
      } catch (err) {
        cumulative += 1000;
        const failedGeo = await lookupGeoIp(currentQueryServerIp);
        hops.push(buildHop({
          id: currentNodeId,
          step: hops.length,
          type,
          label,
          server: currentQueryServerName,
          ip: currentQueryServerIp,
          port: 53,
          latencyMs: 0,
          cumulativeMs: cumulative,
          parsed: null,
          geo: failedGeo,
          queryDomain: currentDomain,
          description: `Query to resolver ${currentQueryServerName} (${currentQueryServerIp}) timed out or failed: ${err.message}`,
          byteLength: 0,
          queriedTypes: [recordType.toUpperCase() === 'ALL' ? 'A' : recordType.toUpperCase()],
          parallelQueries: null,
          queryPacket: null,
          resolvedOverTcp: false,
          failureReason: `UDP Query Failed: ${err.message}. The nameserver was unreachable or did not respond.`,
        }));
        edges.push({ from: previousNodeId, to: currentNodeId, label: nextReferralLabel });
        throw new Error(`SERVFAIL: resolver query failed: ${err.message}`, { cause: err });
      }

      cumulative += latencyMs;
      const geo = await lookupGeoIp(currentQueryServerIp);
      if (parsed.dnssecPresent) dnssecPresent = true;

      const hasAnswers = parsed.answers && parsed.answers.length > 0;
      const isNXDomain = parsed.rcodeNum === 3;
      
      let ref = extractReferral(parsed);
      if (!ref && parsed.authority) {
        const nsRecord = parsed.authority.find(r => r.typeName === 'NS');
        if (nsRecord && nsRecord.value) {
          const nsName = String(nsRecord.value).replace(/\.$/, '');
          const resolvedIp = await resolveNsHostname(nsName, resolverIp);
          if (resolvedIp) {
            ref = { nsName, ip: resolvedIp, zone: nsRecord.name.replace(/\.$/, '') };
          }
        }
      }

      const isTerminal = hasAnswers || isNXDomain || !ref;

      if (isTerminal) {
        isTracePathTerminal = true;
        let parallelQueries = [{
          type: recordType.toUpperCase() === 'ALL' ? 'A' : recordType.toUpperCase(),
          latencyMs,
          byteLength,
          rcode: parsed.rcode,
          queryPacket,
          responsePacket: parsed,
          resolvedOverTcp,
          failureReason,
          attempts,
        }];

        if (recordType.toUpperCase() === 'ALL' && !isNXDomain) {
          const extraTypes = ['AAAA', 'MX', 'TXT', 'NS'];
          const extraResults = await Promise.allSettled(
            extraTypes.map(t => performHop(currentQueryServerIp, 53, currentDomain, TYPE_NUMBERS[t], { dnssecOk: false }))
          );

          extraResults.forEach((res, idx) => {
            const t = extraTypes[idx];
            if (res.status === 'fulfilled') {
              const val = res.value;
              parsed.answers.push(...val.parsed.answers);
              byteLength += val.byteLength;
              parallelQueries.push({
                type: t,
                latencyMs: val.latencyMs,
                byteLength: val.byteLength,
                rcode: val.parsed.rcode,
                queryPacket: val.queryPacket,
                responsePacket: val.parsed,
                resolvedOverTcp: val.resolvedOverTcp,
                failureReason: val.failureReason,
                attempts: val.attempts,
              });
            } else {
              parallelQueries.push({
                type: t,
                latencyMs: 0,
                byteLength: 0,
                rcode: 'TIMEOUT',
                error: res.reason.message,
                queryPacket: null,
                responsePacket: null,
                resolvedOverTcp: false,
                failureReason: `Query timed out or failed: ${res.reason.message}`,
                attempts: null,
              });
            }
          });

          const latencies = parallelQueries.map(q => q.latencyMs);
          const maxParallelLatency = Math.max(...latencies);
          cumulative = cumulative - latencyMs + maxParallelLatency;
          latencyMs = maxParallelLatency;
        }

        let description;
        if (isNXDomain) {
          description = `Server ${currentQueryServerName} (${currentQueryServerIp}) returned NXDOMAIN. Domain does not exist.`;
        } else if (parsed.answers && parsed.answers.length > 0) {
          const first = parsed.answers[0];
          const valStr = typeof first.value === 'string' ? first.value : JSON.stringify(first.value);
          description = `Server ${currentQueryServerName} (${currentQueryServerIp}) returned terminal answer. ${first.typeName} record: ${valStr}.${recordType.toUpperCase() === 'ALL' ? ` Plus parallel queries resolved.` : ''}`;
        } else {
          description = `Server ${currentQueryServerName} (${currentQueryServerIp}) returned NOERROR with empty answer section (NODATA).`;
        }

        hops.push(buildHop({
          id: currentNodeId,
          step: hops.length,
          type,
          label,
          server: currentQueryServerName,
          ip: currentQueryServerIp,
          port: 53,
          latencyMs,
          cumulativeMs: cumulative,
          parsed,
          geo,
          queryDomain: currentDomain,
          description,
          byteLength,
          queriedTypes: recordType.toUpperCase() === 'ALL' ? ['A', 'AAAA', 'MX', 'TXT', 'NS'] : [recordType.toUpperCase()],
          parallelQueries,
          queryPacket,
          resolvedOverTcp,
          failureReason,
          attempts,
        }));
        edges.push({ from: previousNodeId, to: currentNodeId, label: nextReferralLabel });
        finalParsed = parsed;

        if (isFirst && iterativeHopCount >= 2) {
          authZone = currentQueryServerZone;
          authNs = currentQueryServerName;
        }

        const cnameRec = parsed.answers ? parsed.answers.find(r => r.typeName === 'CNAME' && r.name.replace(/\.$/, '').toLowerCase() === currentDomain) : null;
        if (cnameRec) {
          const cnameTarget = String(cnameRec.value).replace(/\.$/, '').toLowerCase();
          cnameChain.push({ from: currentDomain, to: cnameTarget });

          const hasTargetIp = parsed.answers.some(r => r.name.replace(/\.$/, '').toLowerCase() === cnameTarget && (r.typeName === 'A' || r.typeName === 'AAAA'));
          if (!hasTargetIp) {
            const cnameNodeId = `cname-${cnameCount++}`;
            hops.push({
              id: cnameNodeId,
              step: hops.length,
              type: 'CNAME_REDIRECT',
              label: 'CNAME Redirect',
              server: null,
              ip: null,
              port: null,
              latencyMs: 0,
              cumulativeMs: cumulative,
              description: `CNAME alias detected: ${currentDomain} points to ${cnameTarget}. Following redirection.`,
              geo: { flag: '🔗', org: 'CNAME Alias' },
              queryDomain: currentDomain,
              cnameFrom: currentDomain,
              cnameTo: cnameTarget,
              response: null,
              queriedTypes: [recordType.toUpperCase()],
              parallelQueries: null,
            });
            edges.push({ from: currentNodeId, to: cnameNodeId, label: 'CNAME Alias' });

            currentDomain = cnameTarget;
            depth++;
          } else {
            depth = maxDepth;
          }
        } else {
          depth = maxDepth;
        }
      } else {
        const refZoneLabel = ref.zone.includes('.') ? ref.zone : `.${ref.zone}`;
        const description = `Resolver ${currentQueryServerName} (${currentQueryServerIp}) returned a referral to nameserver ${ref.nsName} for zone ${refZoneLabel}.`;

        hops.push(buildHop({
          id: currentNodeId,
          step: hops.length,
          type,
          label,
          server: currentQueryServerName,
          ip: currentQueryServerIp,
          port: 53,
          latencyMs,
          cumulativeMs: cumulative,
          parsed,
          geo,
          queryDomain: currentDomain,
          description,
          byteLength,
          queriedTypes: [recordType.toUpperCase() === 'ALL' ? 'A' : recordType.toUpperCase()],
          parallelQueries: [{
            type: recordType.toUpperCase() === 'ALL' ? 'A' : recordType.toUpperCase(),
            latencyMs,
            byteLength,
            rcode: parsed.rcode,
            queryPacket,
            responsePacket: parsed,
            resolvedOverTcp,
            failureReason,
            attempts,
          }],
          queryPacket,
          resolvedOverTcp,
          failureReason,
          attempts,
        }));
        edges.push({ from: previousNodeId, to: currentNodeId, label: nextReferralLabel });

        currentQueryServerIp = ref.ip;
        currentQueryServerName = ref.nsName;
        currentQueryServerZone = ref.zone;
        previousNodeId = currentNodeId;
        nextReferralLabel = `NS ${refZoneLabel.startsWith('.') ? refZoneLabel : '.' + refZoneLabel} → ${ref.nsName}`;
        iterativeHopCount++;
      }
    }
  }

  return buildTraceResult({
    domain,
    recordType,
    hops,
    edges,
    finalParsed,
    dnssecPresent,
    cnameChain,
    authZone,
    authNs,
  });
}



// ── Benchmark ─────────────────────────────────────────────────────────────

/**
 * Compares resolution latency between Cloudflare (1.1.1.1) and Google (8.8.8.8)
 * by sending the same query to both in parallel and measuring the RTT.
 *
 * @param {string} domain     - Domain to benchmark
 * @param {string} recordType - Record type (e.g. "A")
 * @returns {Promise<{ cloudflare, google, domain, recordType }>}
 */
async function benchmarkResolvers(domain, recordType = 'A') {
  const typeNum = TYPE_NUMBERS[recordType.toUpperCase()] || TYPE_NUMBERS.A;

  const measure = async (resolverIp, resolverName) => {
    const start = Date.now();
    try {
      const { parsed } = await performHop(resolverIp, 53, domain, typeNum, {
        recursionDesired: true,
        dnssecOk: false,
        timeoutMs: 5000,
      });
      return {
        resolver: resolverName,
        ip: resolverIp,
        latencyMs: Date.now() - start,
        rcode: parsed.rcode,
        answerCount: parsed.answers.length,
        answers: parsed.answers,
      };
    } catch (err) {
      return {
        resolver: resolverName,
        ip: resolverIp,
        latencyMs: Date.now() - start,
        rcode: 'TIMEOUT',
        answerCount: 0,
        answers: [],
        error: err.message,
      };
    }
  };

  const [cloudflare, google] = await Promise.all([
    measure('1.1.1.1', 'Cloudflare'),
    measure('8.8.8.8', 'Google'),
  ]);

  return { cloudflare, google, domain, recordType: recordType.toUpperCase() };
}

// ── Result Builder ─────────────────────────────────────────────────────────

function buildTraceResult({ domain, recordType, hops, edges, finalParsed, dnssecPresent = false, cnameChain = [], authZone = null, authNs = null }) {
  const totalLatency = hops.reduce((sum, hop) => sum + hop.latencyMs, 0);

  return {
    domain,
    recordType: recordType.toUpperCase(),
    status: finalParsed ? finalParsed.rcode : 'UNKNOWN',
    totalLatency,
    dnssecPresent: dnssecPresent || (finalParsed ? finalParsed.dnssecPresent : false),
    answers: finalParsed ? finalParsed.answers : [],
    cnameChain,
    authZone,
    authNs,
    hopCount: hops.length,
    hops,
    edges,
    timestamp: Date.now(),
  };
}

module.exports = { iterativeTrace, benchmarkResolvers };
