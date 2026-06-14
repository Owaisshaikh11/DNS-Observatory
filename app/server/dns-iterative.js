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
  MX: 15,
  TXT: 16,
  AAAA: 28,
};

// ── Fixed SVG tree positions for each hop type ─────────────────────────────
// These match the layout in Visualization_demo_option_c_hybrid.html
const TREE_POSITIONS = {
  CLIENT: { treeX: 20, treeY: 55 },
  LOCAL: { treeX: 185, treeY: 55 },
  ROOT: { treeX: 370, treeY: 15 },
  TLD: { treeX: 370, treeY: 95 },
  AUTH: { treeX: 580, treeY: 55 },
  CNAME_REDIRECT: { treeX: 0, treeY: 55 },
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
 * Performs a single DNS hop: builds a query packet, sends it, parses the
 * response, and measures the round-trip time.
 *
 * @param {string} ip      - DNS server IP address to query
 * @param {number} port    - DNS server port (usually 53)
 * @param {string} domain  - Domain name to look up
 * @param {number} typeNum - Record type number
 * @param {object} opts    - { recursionDesired, dnssecOk, timeoutMs }
 * @returns {Promise<{parsed, latencyMs, byteLength, queryHex, queryPacket}>}
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
    console.error(`[Iterative] Failed to parse request query buffer:`, err.message);
  }

  const start = Date.now();
  const rawResponse = await sendUdpQuery(ip, port, query, opts.timeoutMs || 3000);
  const latencyMs = Date.now() - start;

  const parsed = parseDnsResponse(rawResponse);
  return { parsed, latencyMs, byteLength: rawResponse.length, queryHex, queryPacket };
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
async function resolveNsHostname(nsHostname) {
  const query = buildDnsQuery(nsHostname, TYPE_NUMBERS.A, {
    recursionDesired: true,
    dnssecOk: false,
  });
  try {
    const raw = await sendUdpQuery('1.1.1.1', 53, query, 3000);
    const parsed = parseDnsResponse(raw);
    const aRecord = parsed.answers.find(r => r.typeName === 'A');
    return aRecord ? aRecord.value : null;
  } catch {
    return null;
  }
}

// ── Hop Builders ──────────────────────────────────────────────────────────

/**
 * Builds a structured hop object from the result of a DNS query.
 * This is the shape that the frontend's HopCard component consumes.
 */
function buildHop({ id, step, type, label, server, ip, port, latencyMs, cumulativeMs, parsed, geo, description, byteLength, queryDomain, queriedTypes, parallelQueries, queryPacket }) {
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
    ...TREE_POSITIONS[type],             // treeX, treeY for SVG layout
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
async function iterativeTrace(domain, recordType = 'A') {
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

  while (depth < maxDepth) {
    const typeNum = TYPE_NUMBERS[recordType.toUpperCase()] || TYPE_NUMBERS.A;
    const isFirst = depth === 0;
    const suffix = isFirst ? '' : `-${depth}`;

    // Hop IDs
    const clientHopId = `client${suffix}`;
    const localHopId = `local${suffix}`;
    const rootHopId = `root${suffix}`;
    const tldHopId = `tld${suffix}`;
    const authHopId = `auth${suffix}`;

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
      // Connect previous CNAME node to this client node
      edges.push({
        from: `cname-${depth - 1}`,
        to: clientHopId,
        label: `Resolve ${currentDomain}`
      });
    }

    // 2. LOCAL Hop
    let isLocalHit = false;
    let localParsed = null;
    let localLatency = 0;
    let localByteLength = 0;
    let localParallelQueries = [];

    try {
      const { parsed, latencyMs, byteLength, queryPacket } = await performHop('127.0.0.1', 5354, currentDomain, typeNum, {
        recursionDesired: true,
        dnssecOk: false,
      });
      localParsed = parsed;
      localLatency = latencyMs;
      localByteLength = byteLength;
      cumulative += latencyMs;

      isLocalHit = parsed.isAuthoritative && parsed.answers.length > 0;

      // If local hit and recordType is 'ALL', query local DNS server for extra records (AAAA, MX, TXT, NS)
      if (isLocalHit && recordType.toUpperCase() === 'ALL') {
        localParallelQueries.push({
          type: 'A',
          latencyMs: latencyMs,
          byteLength: byteLength,
          rcode: parsed.rcode,
          queryPacket,
          responsePacket: parsed,
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
            });
          }
        });

        // Compute localLatency as the maximum RTT of all parallel queries
        const latencies = localParallelQueries.map(q => q.latencyMs);
        localLatency = Math.max(...latencies);

        // Adjust cumulative RTT to reflect maximum latency of parallel requests
        cumulative = cumulative - latencyMs + localLatency;
      } else {
        localParallelQueries = [{
          type: recordType.toUpperCase(),
          latencyMs: localLatency,
          byteLength: localByteLength,
          rcode: localParsed ? localParsed.rcode : 'UNKNOWN',
          queryPacket,
          responsePacket: localParsed,
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
          const cnameNodeId = `cname-${depth}`;
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
            treeX: 0,
            treeY: 55,
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

    // 3. ROOT Hop
    const rootServer = ROOT_SERVERS[Math.floor(Math.random() * ROOT_SERVERS.length)];
    let rootParsed, rootLatency, rootByteLength, rootQueryHex, rootQueryPacket;
    try {
      ({ parsed: rootParsed, latencyMs: rootLatency, byteLength: rootByteLength, queryHex: rootQueryHex, queryPacket: rootQueryPacket } = await performHop(
        rootServer.ipv4, 53, currentDomain, typeNum, { dnssecOk: true }
      ));
    } catch (err) {
      throw new Error(`Root server ${rootServer.name} (${rootServer.ipv4}) timed out: ${err.message}`, { cause: err });
    }

    cumulative += rootLatency;
    const rootGeo = await lookupGeoIp(rootServer.ipv4);
    if (rootParsed.dnssecPresent) dnssecPresent = true;

    const rootParallelQueries = [{
      type: recordType.toUpperCase() === 'ALL' ? 'A' : recordType.toUpperCase(),
      latencyMs: rootLatency,
      byteLength: rootByteLength,
      rcode: rootParsed.rcode,
      queryPacket: rootQueryPacket,
      responsePacket: rootParsed,
    }];

    if (rootParsed.rcodeNum === 3) {
      hops.push(buildHop({
        id: rootHopId, step: hops.length, type: 'ROOT',
        label: 'Root (.)',
        server: rootServer.name, ip: rootServer.ipv4, port: 53,
        latencyMs: rootLatency, cumulativeMs: cumulative,
        parsed: rootParsed, geo: rootGeo,
        queryDomain: currentDomain,
        description: `Root server ${rootServer.name} returned NXDOMAIN. ${currentDomain} does not exist at root level.`,
        byteLength: rootByteLength,
        queriedTypes: [recordType.toUpperCase() === 'ALL' ? 'A' : recordType.toUpperCase()],
        parallelQueries: rootParallelQueries,
        queryPacket: rootQueryPacket,
      }));
      edges.push({ from: localHopId, to: rootHopId, label: 'Iterative (RD=0)' });
      finalParsed = rootParsed;
      break;
    }

    let tldRef = extractReferral(rootParsed);
    if (!tldRef) {
      const nsRecord = rootParsed.authority.find(r => r.typeName === 'NS');
      if (nsRecord) {
        const nsName = String(nsRecord.value).replace(/\.$/, '');
        const resolvedIp = await resolveNsHostname(nsName);
        if (resolvedIp) {
          tldRef = { nsName, ip: resolvedIp, zone: nsRecord.name.replace(/\.$/, '') };
        }
      }
    }

    if (!tldRef) {
      throw new Error(`Root server returned no usable TLD referral for ${currentDomain}`);
    }

    const tldZone = tldRef.zone || currentDomain.split('.').slice(-1)[0];
    hops.push(buildHop({
      id: rootHopId, step: hops.length, type: 'ROOT',
      label: 'Root (.)',
      server: rootServer.name, ip: rootServer.ipv4, port: 53,
      latencyMs: rootLatency, cumulativeMs: cumulative,
      parsed: rootParsed, geo: rootGeo,
      queryDomain: currentDomain,
      description: `Root server ${rootServer.name} responded with a referral to the .${tldZone} TLD nameservers.`,
      byteLength: rootByteLength,
      queriedTypes: [recordType.toUpperCase() === 'ALL' ? 'A' : recordType.toUpperCase()],
      parallelQueries: rootParallelQueries,
      queryPacket: rootQueryPacket,
    }));
    edges.push({ from: localHopId, to: rootHopId, label: 'Iterative (RD=0)' });

    // 4. TLD Hop
    let tldParsed, tldLatency, tldByteLength, tldQueryHex, tldQueryPacket;
    try {
      ({ parsed: tldParsed, latencyMs: tldLatency, byteLength: tldByteLength, queryHex: tldQueryHex, queryPacket: tldQueryPacket } = await performHop(
        tldRef.ip, 53, currentDomain, typeNum, { dnssecOk: true }
      ));
    } catch (err) {
      throw new Error(`TLD server ${tldRef.nsName} (${tldRef.ip}) timed out: ${err.message}`, { cause: err });
    }

    cumulative += tldLatency;
    const tldGeo = await lookupGeoIp(tldRef.ip);
    if (tldParsed.dnssecPresent) dnssecPresent = true;

    const tldParallelQueries = [{
      type: recordType.toUpperCase() === 'ALL' ? 'A' : recordType.toUpperCase(),
      latencyMs: tldLatency,
      byteLength: tldByteLength,
      rcode: tldParsed.rcode,
      queryPacket: tldQueryPacket,
      responsePacket: tldParsed,
    }];

    if (tldParsed.rcodeNum === 3) {
      hops.push(buildHop({
        id: tldHopId, step: hops.length, type: 'TLD',
        label: `TLD (.${tldZone})`,
        server: tldRef.nsName, ip: tldRef.ip, port: 53,
        latencyMs: tldLatency, cumulativeMs: cumulative,
        parsed: tldParsed, geo: tldGeo,
        queryDomain: currentDomain,
        description: `TLD server returned NXDOMAIN. ${currentDomain} is not registered in .${tldZone}.`,
        byteLength: tldByteLength,
        queriedTypes: [recordType.toUpperCase() === 'ALL' ? 'A' : recordType.toUpperCase()],
        parallelQueries: tldParallelQueries,
        queryPacket: tldQueryPacket,
      }));
      edges.push({ from: rootHopId, to: tldHopId, label: `NS .${tldZone} → ${tldRef.nsName}` });
      finalParsed = tldParsed;
      break;
    }

    let authRef = extractReferral(tldParsed);
    if (!authRef) {
      const nsRecord = tldParsed.authority.find(r => r.typeName === 'NS');
      if (nsRecord) {
        const nsName = String(nsRecord.value).replace(/\.$/, '');
        const resolvedIp = await resolveNsHostname(nsName);
        if (resolvedIp) {
          authRef = { nsName, ip: resolvedIp, zone: nsRecord.name.replace(/\.$/, '') };
        }
      }
    }

    if (!authRef) {
      throw new Error(`TLD server returned no usable authoritative referral for ${currentDomain}`);
    }

    const authZoneVal = authRef.zone || currentDomain;
    hops.push(buildHop({
      id: tldHopId, step: hops.length, type: 'TLD',
      label: `TLD (.${tldZone})`,
      server: tldRef.nsName, ip: tldRef.ip, port: 53,
      latencyMs: tldLatency, cumulativeMs: cumulative,
      parsed: tldParsed, geo: tldGeo,
      queryDomain: currentDomain,
      description: `TLD server ${tldRef.nsName} responded with a referral to the ${authZoneVal} authoritative nameservers.`,
      byteLength: tldByteLength,
      queriedTypes: [recordType.toUpperCase() === 'ALL' ? 'A' : recordType.toUpperCase()],
      parallelQueries: tldParallelQueries,
      queryPacket: tldQueryPacket,
    }));
    edges.push({ from: rootHopId, to: tldHopId, label: `NS .${tldZone} → ${tldRef.nsName}` });

    // 5. AUTH Hop
    let authParsed = null;
    let authLatency = 0;
    let authByteLength = 0;
    let parallelQueries = [];
    let combinedAnswers = [];

    const isAllQuery = recordType.toUpperCase() === 'ALL';

    if (isAllQuery) {
      const typesToQuery = ['A', 'AAAA', 'MX', 'TXT', 'NS'];
      const results = await Promise.allSettled(
        typesToQuery.map(t => performHop(authRef.ip, 53, currentDomain, TYPE_NUMBERS[t], { dnssecOk: t === 'A' }))
      );

      typesToQuery.forEach((t, idx) => {
        const res = results[idx];
        if (res.status === 'fulfilled') {
          const val = res.value;
          parallelQueries.push({
            type: t,
            latencyMs: val.latencyMs,
            byteLength: val.byteLength,
            rcode: val.parsed.rcode,
            queryPacket: val.queryPacket,
            responsePacket: val.parsed,
          });
          combinedAnswers.push(...val.parsed.answers);

          if (t === 'A') {
            authParsed = val.parsed;
            authByteLength = val.byteLength;
          } else {
            authByteLength += val.byteLength;
          }
        } else {
          parallelQueries.push({
            type: t,
            latencyMs: 0,
            byteLength: 0,
            rcode: 'TIMEOUT',
            error: res.reason.message,
            queryPacket: null,
            responsePacket: null,
          });
        }
      });

      if (!authParsed) {
        const successful = results.find(r => r.status === 'fulfilled');
        if (successful) {
          authParsed = successful.value.parsed;
        } else {
          throw new Error(`Authoritative server ${authRef.nsName} (${authRef.ip}) parallel queries timed out.`);
        }
      }

      authParsed.answers = combinedAnswers;
      const latencies = parallelQueries.map(q => q.latencyMs);
      authLatency = Math.max(...latencies);

    } else {
      try {
        const { parsed, latencyMs, byteLength, queryPacket } = await performHop(
          authRef.ip, 53, currentDomain, typeNum, { dnssecOk: true }
        );
        authParsed = parsed;
        authLatency = latencyMs;
        authByteLength = byteLength;
        parallelQueries = [{
          type: recordType.toUpperCase(),
          latencyMs,
          byteLength,
          rcode: parsed.rcode,
          queryPacket,
          responsePacket: parsed,
        }];
      } catch (err) {
        throw new Error(`Authoritative server ${authRef.nsName} (${authRef.ip}) timed out: ${err.message}`, { cause: err });
      }
    }

    cumulative += authLatency;
    const authGeo = await lookupGeoIp(authRef.ip);
    if (authParsed.dnssecPresent) dnssecPresent = true;
    if (isFirst) {
      authZone = authZoneVal;
      authNs = authRef.nsName;
    }

    const finalAnswers = authParsed.answers;
    finalParsed = authParsed;

    let authDescription;
    if (authParsed.rcodeNum === 3) {
      authDescription = `Authoritative server ${authRef.nsName} returned NXDOMAIN. ${currentDomain} has no record in the ${authZoneVal} zone.`;
    } else if (finalAnswers.length > 0) {
      const first = finalAnswers[0];
      const valueStr = typeof first.value === 'string' ? first.value : JSON.stringify(first.value);
      authDescription = `Authoritative server ${authRef.nsName} returned final answer. ${first.typeName} record: ${valueStr}.${isAllQuery ? ` Plus ${finalAnswers.length - 1} extra records resolved in parallel.` : ''}`;
    } else {
      authDescription = `Authoritative server ${authRef.nsName} responded but returned no ${recordType.toUpperCase()} records for ${currentDomain}.`;
    }

    hops.push(buildHop({
      id: authHopId, step: hops.length, type: 'AUTH',
      label: isFirst ? 'Authoritative' : `Authoritative (${depth})`,
      server: authRef.nsName, ip: authRef.ip, port: 53,
      latencyMs: authLatency, cumulativeMs: cumulative,
      parsed: authParsed, geo: authGeo,
      queryDomain: currentDomain,
      description: authDescription,
      byteLength: authByteLength,
      queriedTypes: isAllQuery ? ['A', 'AAAA', 'MX', 'TXT', 'NS'] : [recordType.toUpperCase()],
      parallelQueries,
      queryPacket: parallelQueries[0]?.queryPacket || null,
    }));
    edges.push({ from: tldHopId, to: authHopId, label: `NS ${authZoneVal} → ${authRef.nsName}` });

    const cnameRec = finalAnswers.find(r => r.typeName === 'CNAME' && r.name.replace(/\.$/, '').toLowerCase() === currentDomain);
    if (cnameRec) {
      const cnameTarget = String(cnameRec.value).replace(/\.$/, '').toLowerCase();
      cnameChain.push({ from: currentDomain, to: cnameTarget });

      const hasTargetIp = finalAnswers.some(r => r.name.replace(/\.$/, '').toLowerCase() === cnameTarget && (r.typeName === 'A' || r.typeName === 'AAAA'));
      if (!hasTargetIp) {
        const cnameNodeId = `cname-${depth}`;
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
          treeX: 0,
          treeY: 55,
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
