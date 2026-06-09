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
const { lookupGeoIp } = require('./geoip-service');
const ROOT_SERVERS = require('./root-hints');

// ── Record type name → number ──────────────────────────────────────────────
const TYPE_NUMBERS = {
  A:     1,
  NS:    2,
  CNAME: 5,
  SOA:   6,
  MX:    15,
  TXT:   16,
  AAAA:  28,
};

// ── Fixed SVG tree positions for each hop type ─────────────────────────────
// These match the layout in Visualization_demo_option_c_hybrid.html
const TREE_POSITIONS = {
  CLIENT: { treeX: 20,  treeY: 55 },
  LOCAL:  { treeX: 185, treeY: 55 },
  ROOT:   { treeX: 370, treeY: 15 },
  TLD:    { treeX: 370, treeY: 95 },
  AUTH:   { treeX: 580, treeY: 55 },
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
 * @returns {Promise<{parsed, latencyMs}>}
 */
async function performHop(ip, port, domain, typeNum, opts = {}) {
  const query = buildDnsQuery(domain, typeNum, {
    recursionDesired: opts.recursionDesired || false,
    dnssecOk:         opts.dnssecOk !== false, // default true for DNSSEC visibility
  });

  const start = Date.now();
  const rawResponse = await sendUdpQuery(ip, port, query, opts.timeoutMs || 3000);
  const latencyMs = Date.now() - start;

  const parsed = parseDnsResponse(rawResponse);
  return { parsed, latencyMs };
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
function buildHop({ id, step, type, label, server, ip, port, latencyMs, cumulativeMs, parsed, geo, description }) {
  return {
    id,
    step,
    type,                                // 'CLIENT' | 'LOCAL' | 'ROOT' | 'TLD' | 'AUTH'
    label,                               // human-readable label for the UI
    server,                              // hostname of the queried server
    ip,                                  // IP address of the queried server
    port: port || 53,
    latencyMs,
    cumulativeMs,                        // total time elapsed up to and including this hop
    description,                         // what happened here, in plain English
    geo,                                 // { flag, org, country, city, countryCode }
    response: parsed ? {
      rcode:      parsed.rcode,
      flags:      parsed.flags,
      answers:    parsed.answers,
      authority:  parsed.authority,
      additional: parsed.additional,
      dnssec:     parsed.dnssec,
      rawHex:     parsed.rawHex,
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
  const typeNum  = TYPE_NUMBERS[recordType.toUpperCase()] || TYPE_NUMBERS.A;
  const hops     = [];
  const edges    = [];
  let   cumulative = 0;

  // ─── Hop 0: CLIENT ────────────────────────────────────────────────────────
  hops.push(buildHop({
    id: 'client', step: 0, type: 'CLIENT',
    label: 'Client Stub',
    server: null, ip: '127.0.0.1', port: null,
    latencyMs: 0, cumulativeMs: 0,
    parsed: null,
    geo: { flag: '💻', org: 'Local Machine', country: 'Local', city: null, countryCode: null },
    description: `Initiating iterative trace for ${domain} [TYPE: ${recordType.toUpperCase()}]. Querying local custom DNS server first.`,
  }));

  // ─── Hop 1: LOCAL DNS ─────────────────────────────────────────────────────
  try {
    const { parsed, latencyMs } = await performHop('127.0.0.1', 5354, domain, typeNum, {
      recursionDesired: true,  // ask the local server to resolve if it knows the answer
      dnssecOk: false,
    });
    cumulative += latencyMs;

    const isLocalHit = parsed.isAuthoritative && parsed.answers.length > 0;
    const localDescription = isLocalHit
      ? `Local DNS server found an authoritative answer for ${domain}. Returning cached/configured record — no iterative resolution needed.`
      : `Local DNS server has no authoritative record for ${domain}. Starting iterative resolution from a root server.`;

    hops.push(buildHop({
      id: 'local', step: 1, type: 'LOCAL',
      label: 'Custom DNS',
      server: 'localhost', ip: '127.0.0.1', port: 5354,
      latencyMs, cumulativeMs: cumulative,
      parsed,
      geo: { flag: '🖥️', org: 'Local DNS Server', country: 'Local', city: null, countryCode: null },
      description: localDescription,
    }));
    edges.push({ from: 'client', to: 'local', label: `Query ${domain} ${recordType.toUpperCase()}` });

    // If the local server answered authoritatively, we're done
    if (isLocalHit) {
      edges.push({ from: 'local', to: 'auth', label: 'Local authoritative answer' });
      return buildTraceResult({ domain, recordType, hops, edges, finalParsed: parsed });
    }

  } catch (err) {
    // Local server is down or unreachable — proceed with public resolution
    cumulative = 0;
    hops.push(buildHop({
      id: 'local', step: 1, type: 'LOCAL',
      label: 'Custom DNS',
      server: 'localhost', ip: '127.0.0.1', port: 5354,
      latencyMs: 0, cumulativeMs: 0,
      parsed: null,
      geo: { flag: '🖥️', org: 'Local DNS Server', country: 'Local', city: null, countryCode: null },
      description: `Local DNS server unreachable (${err.message}). Proceeding with public iterative resolution.`,
    }));
    edges.push({ from: 'client', to: 'local', label: `Query ${domain} ${recordType.toUpperCase()}` });
  }

  // ─── Hop 2: ROOT server ───────────────────────────────────────────────────
  const rootServer = ROOT_SERVERS[Math.floor(Math.random() * ROOT_SERVERS.length)];

  let rootParsed, rootLatency;
  try {
    ({ parsed: rootParsed, latencyMs: rootLatency } = await performHop(
      rootServer.ipv4, 53, domain, typeNum, { dnssecOk: true }
    ));
  } catch (err) {
    throw new Error(`Root server ${rootServer.name} (${rootServer.ipv4}) timed out: ${err.message}`, { cause: err });
  }

  cumulative += rootLatency;
  const rootGeo = await lookupGeoIp(rootServer.ipv4);

  // Early exit if root returned NXDOMAIN (very rare)
  if (rootParsed.rcodeNum === 3 /* NXDOMAIN */) {
    hops.push(buildHop({
      id: 'root', step: 2, type: 'ROOT',
      label: 'Root (.)',
      server: rootServer.name, ip: rootServer.ipv4, port: 53,
      latencyMs: rootLatency, cumulativeMs: cumulative,
      parsed: rootParsed, geo: rootGeo,
      description: `Root server ${rootServer.name} returned NXDOMAIN. ${domain} does not exist at the root level.`,
    }));
    edges.push({ from: 'local', to: 'root', label: 'Iterative (RD=0)' });
    return buildTraceResult({ domain, recordType, hops, edges, finalParsed: rootParsed });
  }

  // Extract the TLD referral from the root response
  let tldRef = extractReferral(rootParsed);
  if (!tldRef) {
    // No glue — resolve NS hostname using a recursive lookup
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
    throw new Error(`Root server returned no usable TLD referral for ${domain}`);
  }

  const tldZone = tldRef.zone || domain.split('.').slice(-1)[0]; // e.g. "com"

  hops.push(buildHop({
    id: 'root', step: 2, type: 'ROOT',
    label: 'Root (.)',
    server: rootServer.name, ip: rootServer.ipv4, port: 53,
    latencyMs: rootLatency, cumulativeMs: cumulative,
    parsed: rootParsed, geo: rootGeo,
    description: `Root server ${rootServer.name} responded with a referral to the .${tldZone} TLD nameservers. No answer yet — following the delegation chain.`,
  }));
  edges.push({ from: 'local', to: 'root', label: 'Iterative (RD=0)' });

  // ─── Hop 3: TLD server ────────────────────────────────────────────────────
  let tldParsed, tldLatency;
  try {
    ({ parsed: tldParsed, latencyMs: tldLatency } = await performHop(
      tldRef.ip, 53, domain, typeNum, { dnssecOk: true }
    ));
  } catch (err) {
    throw new Error(`TLD server ${tldRef.nsName} (${tldRef.ip}) timed out: ${err.message}`, { cause: err });
  }

  cumulative += tldLatency;
  const tldGeo = await lookupGeoIp(tldRef.ip);

  // NXDOMAIN at TLD level means the domain doesn't exist in this TLD
  if (tldParsed.rcodeNum === 3) {
    hops.push(buildHop({
      id: 'tld', step: 3, type: 'TLD',
      label: `TLD (.${tldZone})`,
      server: tldRef.nsName, ip: tldRef.ip, port: 53,
      latencyMs: tldLatency, cumulativeMs: cumulative,
      parsed: tldParsed, geo: tldGeo,
      description: `TLD server returned NXDOMAIN. ${domain} is not a registered domain in .${tldZone}.`,
    }));
    edges.push({ from: 'root', to: 'tld', label: `NS .${tldZone} → ${tldRef.nsName}` });
    return buildTraceResult({ domain, recordType, hops, edges, finalParsed: tldParsed });
  }

  // Extract the authoritative server referral
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
    throw new Error(`TLD server returned no usable authoritative NS referral for ${domain}`);
  }

  const authZone = authRef.zone || domain;

  hops.push(buildHop({
    id: 'tld', step: 3, type: 'TLD',
    label: `TLD (.${tldZone})`,
    server: tldRef.nsName, ip: tldRef.ip, port: 53,
    latencyMs: tldLatency, cumulativeMs: cumulative,
    parsed: tldParsed, geo: tldGeo,
    description: `TLD server ${tldRef.nsName} responded with a referral to the ${authZone} authoritative nameservers. Almost there.`,
  }));
  edges.push({ from: 'root', to: 'tld', label: `NS .${tldZone} → ${tldRef.nsName}` });

  // ─── Hop 4: Authoritative server ──────────────────────────────────────────
  let authParsed, authLatency;
  try {
    ({ parsed: authParsed, latencyMs: authLatency } = await performHop(
      authRef.ip, 53, domain, typeNum, { dnssecOk: true }
    ));
  } catch (err) {
    throw new Error(`Authoritative server ${authRef.nsName} (${authRef.ip}) timed out: ${err.message}`, { cause: err });
  }

  cumulative += authLatency;
  const authGeo = await lookupGeoIp(authRef.ip);

  // ── For "ALL" type: run extra queries against the same auth server ─────────
  // We already have the auth server IP, so we query it directly for AAAA, MX,
  // TXT, NS without repeating the full delegation chain.
  let extraAnswers = [];
  if (recordType.toUpperCase() === 'ALL') {
    const extraTypes = ['AAAA', 'MX', 'TXT', 'NS'];
    const results = await Promise.allSettled(
      extraTypes.map(t => performHop(authRef.ip, 53, domain, TYPE_NUMBERS[t], { dnssecOk: false }))
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        extraAnswers.push(...result.value.parsed.answers);
      }
    }
  }

  const finalAnswers = [...authParsed.answers, ...extraAnswers];

  // Build the auth hop description
  let authDescription;
  if (authParsed.rcodeNum === 3) {
    authDescription = `Authoritative server ${authRef.nsName} returned NXDOMAIN. ${domain} has no ${recordType.toUpperCase()} record in the ${authZone} zone.`;
  } else if (finalAnswers.length > 0) {
    const first = finalAnswers[0];
    const valueStr = typeof first.value === 'string' ? first.value : JSON.stringify(first.value);
    authDescription = `Authoritative server ${authRef.nsName} returned a final answer with the AA flag set. ${first.typeName} record: ${valueStr}.${extraAnswers.length > 0 ? ` Plus ${extraAnswers.length} additional records for ALL query.` : ''}`;
  } else {
    authDescription = `Authoritative server ${authRef.nsName} responded (AA flag set) but returned no ${recordType.toUpperCase()} records for ${domain}.`;
  }

  // Detect CNAME chains in the answer (CNAME → target)
  const cnameChain = finalAnswers
    .filter(r => r.typeName === 'CNAME')
    .map(r => ({ from: r.name, to: String(r.value) }));

  hops.push(buildHop({
    id: 'auth', step: 4, type: 'AUTH',
    label: 'Authoritative',
    server: authRef.nsName, ip: authRef.ip, port: 53,
    latencyMs: authLatency, cumulativeMs: cumulative,
    parsed: { ...authParsed, answers: finalAnswers },
    geo: authGeo,
    description: authDescription,
  }));
  edges.push({ from: 'tld', to: 'auth', label: `NS ${authZone} → ${authRef.nsName}` });

  const dnssecPresent =
    rootParsed.dnssecPresent || tldParsed.dnssecPresent || authParsed.dnssecPresent;

  return buildTraceResult({
    domain, recordType, hops, edges,
    finalParsed: { ...authParsed, answers: finalAnswers },
    dnssecPresent,
    cnameChain,
    authZone,
    authNs: authRef.nsName,
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
        resolver:    resolverName,
        ip:          resolverIp,
        latencyMs:   Date.now() - start,
        rcode:       parsed.rcode,
        answerCount: parsed.answers.length,
        answers:     parsed.answers,
      };
    } catch (err) {
      return {
        resolver:    resolverName,
        ip:          resolverIp,
        latencyMs:   Date.now() - start,
        rcode:       'TIMEOUT',
        answerCount: 0,
        answers:     [],
        error:       err.message,
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
    recordType:    recordType.toUpperCase(),
    status:        finalParsed ? finalParsed.rcode : 'UNKNOWN',
    totalLatency,
    dnssecPresent: dnssecPresent || (finalParsed ? finalParsed.dnssecPresent : false),
    answers:       finalParsed ? finalParsed.answers : [],
    cnameChain,
    authZone,
    authNs,
    hopCount:      hops.length,
    hops,
    edges,
    timestamp:     Date.now(),
  };
}

module.exports = { iterativeTrace, benchmarkResolvers };
