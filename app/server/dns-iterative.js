/**
 * dns-iterative.js
 *
 * Perform iterative DNS resolution mapping to a literal delegation tree.
 * Queries all delegated nameservers in parallel, automatically resolves nameserver
 * IPs (recursive missing glue lookups), and outputs a clean flat graph of hops
 * and edges representing the entire chronological resolution structure.
 */

const dgram = require('dgram');
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
  MX: 15,
  TXT: 16,
  AAAA: 28,
};

// ── Default SVG positions for backward compatibility ────────────────────────
const TREE_POSITIONS = {
  CLIENT: { treeX: 20, treeY: 55 },
  LOCAL: { treeX: 185, treeY: 55 },
  ROOT: { treeX: 370, treeY: 15 },
  TLD: { treeX: 370, treeY: 95 },
  AUTH: { treeX: 580, treeY: 55 },
  CNAME_REDIRECT: { treeX: 0, treeY: 55 },
  ZONE: { treeX: 0, treeY: 0 },
  ANSWERS: { treeX: 0, treeY: 0 }
};

// ── UDP Query ──────────────────────────────────────────────────────────────

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

  const start = Date.now();
  const rawResponse = await sendUdpQuery(ip, port, query, opts.timeoutMs || 1200);
  const latencyMs = Date.now() - start;

  const parsed = parseDnsResponse(rawResponse);
  return { parsed, latencyMs, byteLength: rawResponse.length, queryHex, queryPacket };
}

// ── Referral & Glue Extraction ──────────────────────────────────────────────

function extractAllReferrals(parsed) {
  if (!parsed || !parsed.authority) return null;

  const glueMap = new Map();
  for (const rec of parsed.additional || []) {
    if ((rec.typeName === 'A' || rec.typeName === 'AAAA') && typeof rec.value === 'string') {
      const host = rec.name.replace(/\.$/, '').toLowerCase();
      if (!glueMap.has(host)) {
        glueMap.set(host, []);
      }
      glueMap.get(host).push({ type: rec.typeName, ip: rec.value });
    }
  }

  const referrals = [];
  let referralZone = null;

  for (const rec of parsed.authority) {
    if (rec.typeName !== 'NS' || !rec.value) continue;
    const nsName = String(rec.value).replace(/\.$/, '').toLowerCase();
    const zone = rec.name.replace(/\.$/, '');
    if (!referralZone) referralZone = zone;

    const glues = glueMap.get(nsName) || [];
    referrals.push({
      nsName,
      zone,
      glues
    });
  }

  return { referrals, zone: referralZone };
}

// ── Query server wrapper (fail-safe) ────────────────────────────────────────

async function queryServer(ip, port, domain, typeNum, serverName, type, zone, opts = {}) {
  try {
    const result = await performHop(ip, port, domain, typeNum, opts);
    return {
      success: true,
      ip,
      port,
      serverName,
      type,
      zone,
      latencyMs: result.latencyMs,
      byteLength: result.byteLength,
      parsed: result.parsed,
      queryPacket: result.queryPacket,
      error: null
    };
  } catch (err) {
    // Build query packet mock so client Dissect pane can render RequestHex
    let mockQueryPacket = null;
    try {
      const query = buildDnsQuery(domain, typeNum, { recursionDesired: false, dnssecOk: true });
      const queryHex = [...query].map(b => b.toString(16).padStart(2, '0')).join(' ');
      mockQueryPacket = parseQuery(query);
      mockQueryPacket.rawHex = queryHex;
    } catch { /* ignore */ }

    return {
      success: false,
      ip,
      port,
      serverName,
      type,
      zone,
      latencyMs: opts.timeoutMs || 1200,
      byteLength: 0,
      parsed: null,
      queryPacket: mockQueryPacket,
      error: err.message
    };
  }
}

// ── Hop Builder ────────────────────────────────────────────────────────────

function buildHop({ id, step, type, label, server, ip, port, latencyMs, cumulativeMs, parsed, geo, description, byteLength, queryDomain, queriedTypes, parallelQueries, queryPacket }) {
  const positions = TREE_POSITIONS[type] || { treeX: 0, treeY: 0 };
  return {
    id,
    step,
    type,
    label,
    server,
    ip,
    port: port || 53,
    latencyMs,
    cumulativeMs: cumulativeMs || 0,
    description,
    geo,
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
    ...positions,
  };
}

// ── Recursive Trace Engine ──────────────────────────────────────────────────

async function resolveMissingGlue(nsName, currentDepth, state, parentNodeId) {
  if (currentDepth > 3) return null; // recursion depth safety cap

  logger.info(`[Iterative] Missing glue for ${nsName}. Resolving recursively at depth ${currentDepth}...`);

  // Run nested trace for the Nameserver's IP address (A query)
  const subTrace = await executeTraceInternal(state, nsName, 'A', true, currentDepth, parentNodeId);

  let resolvedIp = null;
  if (subTrace && subTrace.finalParsed && subTrace.finalParsed.answers) {
    const aRec = subTrace.finalParsed.answers.find(r => r.typeName === 'A');
    if (aRec) resolvedIp = aRec.value;
  }

  if (resolvedIp) {
    logger.info(`[Iterative] Resolved missing glue for ${nsName} -> ${resolvedIp}`);
    const subAnswersId = `sub-${currentDepth}-${parentNodeId}-answers`;
    state.edges.push({
      from: subAnswersId,
      to: parentNodeId,
      label: `Glue: ${resolvedIp}`
    });
  } else {
    logger.warn(`[Iterative] Failed to resolve missing glue for ${nsName}`);
  }

  return resolvedIp;
}

async function executeTraceInternal(state, domain, recordType, isSubTrace = false, subTraceDepth = 0, parentNodeId = null) {
  const typeNum = TYPE_NUMBERS[recordType.toUpperCase()] || TYPE_NUMBERS.A;
  const currentDomain = domain;
  let finalParsed = null;

  // 1. Root Tier
  const rootZoneNodeId = isSubTrace 
    ? `sub-${subTraceDepth}-${parentNodeId}-zone-.` 
    : `zone-.`;

  state.hops.push({
    id: rootZoneNodeId,
    step: state.stepCounter++,
    type: 'ZONE',
    label: '.',
    zone: '.',
    description: `Root zone referral check.`,
    isSubTrace,
    subTraceFor: parentNodeId
  });

  state.edges.push({
    from: parentNodeId,
    to: rootZoneNodeId,
    label: isSubTrace ? `Resolve ${domain}` : `Iterative`
  });

  // Query Root in parallel (Main: all 13; Sub-trace: 1 randomly selected)
  const rootServersToQuery = isSubTrace
    ? [ROOT_SERVERS[Math.floor(Math.random() * ROOT_SERVERS.length)]]
    : ROOT_SERVERS;

  const rootResults = await Promise.all(rootServersToQuery.map(srv =>
    queryServer(srv.ipv4, 53, currentDomain, typeNum, srv.name, 'ROOT', '.', { timeoutMs: 1200 })
  ));

  const successfulRoot = [];
  for (const res of rootResults) {
    const hopId = isSubTrace 
      ? `sub-${subTraceDepth}-${parentNodeId}-root-${res.serverName}`
      : `root-${res.serverName}`;

    const geo = await lookupGeoIp(res.ip);
    state.hops.push(buildHop({
      id: hopId,
      step: state.stepCounter++,
      type: 'ROOT',
      label: res.serverName,
      server: res.serverName,
      ip: res.ip,
      port: res.port,
      latencyMs: res.latencyMs,
      cumulativeMs: Date.now() - state.timestamp,
      parsed: res.parsed,
      geo,
      description: res.success
        ? `Root server referred lookup to TLD servers.`
        : `Root query failed: ${res.error}`,
      byteLength: res.byteLength,
      queryDomain: currentDomain,
      queriedTypes: [recordType.toUpperCase()],
      queryPacket: res.queryPacket
    }));

    const addedHop = state.hops[state.hops.length - 1];
    addedHop.isSubTrace = isSubTrace;
    addedHop.subTraceFor = parentNodeId;
    addedHop.success = res.success;

    state.edges.push({
      from: rootZoneNodeId,
      to: hopId,
      label: `Query ${currentDomain}`
    });

    if (res.success && res.parsed) {
      successfulRoot.push(res);
    }
  }

  if (successfulRoot.length === 0) {
    logger.warn(`All root hints failed for ${currentDomain}`);
    return { finalParsed: null };
  }

  // Parse TLD delegation info
  const firstRootParsed = successfulRoot[0].parsed;
  const rootReferral = extractAllReferrals(firstRootParsed);

  if (!rootReferral || rootReferral.referrals.length === 0) {
    // Root server responded directly (e.g. TLD query returned final answer or NXDOMAIN)
    finalParsed = firstRootParsed;
    return { finalParsed };
  }

  // 2. TLD Tier
  const tldZone = rootReferral.zone || currentDomain.split('.').slice(-1)[0];
  const tldZoneNodeId = isSubTrace 
    ? `sub-${subTraceDepth}-${parentNodeId}-zone-${tldZone}` 
    : `zone-${tldZone}`;

  state.hops.push({
    id: tldZoneNodeId,
    step: state.stepCounter++,
    type: 'ZONE',
    label: `.${tldZone}`,
    zone: tldZone,
    description: `TLD zone referral check.`,
    isSubTrace,
    subTraceFor: parentNodeId
  });

  for (const res of successfulRoot) {
    const rootHopId = isSubTrace 
      ? `sub-${subTraceDepth}-${parentNodeId}-root-${res.serverName}`
      : `root-${res.serverName}`;
    state.edges.push({
      from: rootHopId,
      to: tldZoneNodeId,
      label: `Referral`
    });
  }

  // Gather TLD servers and resolve missing glue
  const tldServersList = [];
  for (const ref of rootReferral.referrals) {
    const glueIpv4 = ref.glues.find(g => g.type === 'A')?.ip;
    tldServersList.push({ name: ref.nsName, ip: glueIpv4 });
  }

  const tldServersToQuery = isSubTrace
    ? [tldServersList[0]]
    : tldServersList.slice(0, 8); // limit parallel queries to max 8

  for (const srv of tldServersToQuery) {
    if (!srv.ip) {
      const parentNsId = isSubTrace 
        ? `sub-${subTraceDepth}-${parentNodeId}-root-${successfulRoot[0].serverName}`
        : `root-${successfulRoot[0].serverName}`;
      srv.ip = await resolveMissingGlue(srv.name, subTraceDepth + 1, state, parentNsId);
    }
  }

  const tldResults = await Promise.all(tldServersToQuery.filter(s => s.ip).map(srv =>
    queryServer(srv.ip, 53, currentDomain, typeNum, srv.name, 'TLD', tldZone, { timeoutMs: 1200 })
  ));

  const successfulTld = [];
  for (const res of tldResults) {
    const hopId = isSubTrace 
      ? `sub-${subTraceDepth}-${parentNodeId}-tld-${res.serverName}`
      : `tld-${res.serverName}`;

    const geo = await lookupGeoIp(res.ip);
    state.hops.push(buildHop({
      id: hopId,
      step: state.stepCounter++,
      type: 'TLD',
      label: res.serverName,
      server: res.serverName,
      ip: res.ip,
      port: res.port,
      latencyMs: res.latencyMs,
      cumulativeMs: Date.now() - state.timestamp,
      parsed: res.parsed,
      geo,
      description: res.success
        ? `TLD server referred query to authoritative nameservers.`
        : `TLD query failed: ${res.error}`,
      byteLength: res.byteLength,
      queryDomain: currentDomain,
      queriedTypes: [recordType.toUpperCase()],
      queryPacket: res.queryPacket
    }));

    const addedHop = state.hops[state.hops.length - 1];
    addedHop.isSubTrace = isSubTrace;
    addedHop.subTraceFor = parentNodeId;
    addedHop.success = res.success;

    state.edges.push({
      from: tldZoneNodeId,
      to: hopId,
      label: `Query ${currentDomain}`
    });

    if (res.success && res.parsed) {
      successfulTld.push(res);
    }
  }

  if (successfulTld.length === 0) {
    logger.warn(`All TLD servers failed for ${currentDomain}`);
    return { finalParsed: null };
  }

  // Parse Authoritative delegation info
  const firstTldParsed = successfulTld[0].parsed;
  const tldReferral = extractAllReferrals(firstTldParsed);

  if (!tldReferral || tldReferral.referrals.length === 0) {
    finalParsed = firstTldParsed;
    return { finalParsed };
  }

  // 3. Authoritative Tier
  const authZone = tldReferral.zone || currentDomain;
  const authZoneNodeId = isSubTrace 
    ? `sub-${subTraceDepth}-${parentNodeId}-zone-${authZone}` 
    : `zone-${authZone}`;

  state.hops.push({
    id: authZoneNodeId,
    step: state.stepCounter++,
    type: 'ZONE',
    label: authZone,
    zone: authZone,
    description: `Authoritative zone referral check.`,
    isSubTrace,
    subTraceFor: parentNodeId
  });

  for (const res of successfulTld) {
    const tldHopId = isSubTrace 
      ? `sub-${subTraceDepth}-${parentNodeId}-tld-${res.serverName}`
      : `tld-${res.serverName}`;
    state.edges.push({
      from: tldHopId,
      to: authZoneNodeId,
      label: `Referral`
    });
  }

  // Gather authoritative nameservers
  const authServersList = [];
  for (const ref of tldReferral.referrals) {
    const glueIpv4 = ref.glues.find(g => g.type === 'A')?.ip;
    authServersList.push({ name: ref.nsName, ip: glueIpv4 });
  }

  const authServersToQuery = isSubTrace
    ? [authServersList[0]]
    : authServersList.slice(0, 8); // limit parallel queries to max 8

  for (const srv of authServersToQuery) {
    if (!srv.ip) {
      const parentNsId = isSubTrace 
        ? `sub-${subTraceDepth}-${parentNodeId}-tld-${successfulTld[0].serverName}`
        : `tld-${successfulTld[0].serverName}`;
      srv.ip = await resolveMissingGlue(srv.name, subTraceDepth + 1, state, parentNsId);
    }
  }

  // Query Authoritative servers in parallel
  const isAllQuery = recordType.toUpperCase() === 'ALL' && !isSubTrace;
  const successfulAuth = [];
  const authResults = [];

  for (const srv of authServersToQuery.filter(s => s.ip)) {
    if (isAllQuery) {
      const typesToQuery = ['A', 'AAAA', 'MX', 'TXT', 'NS'];
      const subResults = await Promise.allSettled(
        typesToQuery.map(t => performHop(srv.ip, 53, currentDomain, TYPE_NUMBERS[t], { dnssecOk: t === 'A', timeoutMs: 1200 }))
      );

      const parallelQueries = [];
      let primaryParsed = null;
      let primaryByteLength = 0;
      let latencyMs = 0;

      typesToQuery.forEach((t, idx) => {
        const res = subResults[idx];
        if (res.status === 'fulfilled') {
          parallelQueries.push({
            type: t,
            latencyMs: res.value.latencyMs,
            byteLength: res.value.byteLength,
            rcode: res.value.parsed.rcode,
            queryPacket: res.value.queryPacket,
            responsePacket: res.value.parsed
          });
          if (t === 'A') {
            primaryParsed = res.value.parsed;
            primaryByteLength = res.value.byteLength;
          } else {
            primaryByteLength += res.value.byteLength;
          }
        } else {
          parallelQueries.push({
            type: t,
            latencyMs: 0,
            byteLength: 0,
            rcode: 'TIMEOUT',
            error: res.reason.message,
            queryPacket: null,
            responsePacket: null
          });
        }
      });

      const latencies = parallelQueries.map(q => q.latencyMs);
      latencyMs = Math.max(...latencies);

      if (!primaryParsed) {
        const succ = subResults.find(r => r.status === 'fulfilled');
        if (succ) {
          primaryParsed = succ.value.parsed;
        }
      }

      const querySuccess = !!primaryParsed;
      authResults.push({
        success: querySuccess,
        ip: srv.ip,
        port: 53,
        serverName: srv.name,
        type: 'AUTH',
        zone: authZone,
        latencyMs,
        byteLength: primaryByteLength,
        parsed: primaryParsed,
        parallelQueries,
        queryPacket: parallelQueries[0]?.queryPacket || null,
        error: querySuccess ? null : 'Parallel batch timed out'
      });

      if (querySuccess) {
        const combined = [];
        subResults.forEach(r => {
          if (r.status === 'fulfilled' && r.value.parsed?.answers) {
            combined.push(...r.value.parsed.answers);
          }
        });
        primaryParsed.answers = combined;
      }
    } else {
      const res = await queryServer(srv.ip, 53, currentDomain, typeNum, srv.name, 'AUTH', authZone, { timeoutMs: 1200 });
      authResults.push(res);
    }
  }

  for (const res of authResults) {
    const hopId = isSubTrace 
      ? `sub-${subTraceDepth}-${parentNodeId}-auth-${res.serverName}`
      : `auth-${res.serverName}`;

    const geo = await lookupGeoIp(res.ip);
    state.hops.push(buildHop({
      id: hopId,
      step: state.stepCounter++,
      type: 'AUTH',
      label: res.serverName,
      server: res.serverName,
      ip: res.ip,
      port: res.port,
      latencyMs: res.latencyMs,
      cumulativeMs: Date.now() - state.timestamp,
      parsed: res.parsed,
      geo,
      description: res.success
        ? `Authoritative server returned final records.`
        : `Authoritative query failed: ${res.error}`,
      byteLength: res.byteLength,
      queriedTypes: isAllQuery ? ['A', 'AAAA', 'MX', 'TXT', 'NS'] : [recordType.toUpperCase()],
      queryPacket: res.queryPacket,
      parallelQueries: res.parallelQueries || null
    }));

    const addedHop = state.hops[state.hops.length - 1];
    addedHop.isSubTrace = isSubTrace;
    addedHop.subTraceFor = parentNodeId;
    addedHop.success = res.success;

    state.edges.push({
      from: authZoneNodeId,
      to: hopId,
      label: `Query ${currentDomain}`
    });

    if (res.success && res.parsed) {
      successfulAuth.push(res);
      finalParsed = res.parsed;
    }
  }

  if (successfulAuth.length === 0) {
    logger.warn(`All Authoritative servers failed for ${currentDomain}`);
    return { finalParsed: null };
  }

  // Check CNAME redirect
  const firstAuthParsed = successfulAuth[0].parsed;
  const cnameRec = firstAuthParsed.answers.find(r => r.typeName === 'CNAME' && r.name.replace(/\.$/, '').toLowerCase() === currentDomain);
  if (cnameRec) {
    const cnameTarget = String(cnameRec.value).replace(/\.$/, '').toLowerCase();
    const cnameHopId = isSubTrace
      ? `sub-${subTraceDepth}-${parentNodeId}-cname-redirect`
      : `cname-redirect-${subTraceDepth}`;

    state.hops.push({
      id: cnameHopId,
      step: state.stepCounter++,
      type: 'CNAME_REDIRECT',
      label: 'CNAME Redirect',
      cnameFrom: currentDomain,
      cnameTo: cnameTarget,
      description: `CNAME alias detected: ${currentDomain} points to ${cnameTarget}. Following redirect.`,
      geo: { flag: '🔗', org: 'CNAME Alias' },
      isSubTrace,
      subTraceFor: parentNodeId
    });

    for (const res of successfulAuth) {
      const authHopId = isSubTrace 
        ? `sub-${subTraceDepth}-${parentNodeId}-auth-${res.serverName}`
        : `auth-${res.serverName}`;
      state.edges.push({
        from: authHopId,
        to: cnameHopId,
        label: 'CNAME'
      });
    }

    const cnameTrace = await executeTraceInternal(state, cnameTarget, recordType, isSubTrace, subTraceDepth, cnameHopId);
    return { finalParsed: cnameTrace.finalParsed };
  }

  // Answer Section Grouping
  const answersNodeId = isSubTrace 
    ? `sub-${subTraceDepth}-${parentNodeId}-answers` 
    : `answers`;

  state.hops.push({
    id: answersNodeId,
    step: state.stepCounter++,
    type: 'ANSWERS',
    label: 'Answers',
    answers: firstAuthParsed.answers,
    isSubTrace,
    subTraceFor: parentNodeId
  });

  for (const res of successfulAuth) {
    const authHopId = isSubTrace 
      ? `sub-${subTraceDepth}-${parentNodeId}-auth-${res.serverName}`
      : `auth-${res.serverName}`;
    state.edges.push({
      from: authHopId,
      to: answersNodeId,
      label: 'Answer'
    });
  }

  return { finalParsed };
}

// ── Main Trace Interface ────────────────────────────────────────────────────

async function iterativeTrace(domain, recordType = 'A') {
  const state = {
    hops: [],
    edges: [],
    stepCounter: 0,
    timestamp: Date.now()
  };

  const cleanDomain = domain.trim().toLowerCase().replace(/\.$/, '');
  const typeNum = TYPE_NUMBERS[recordType.toUpperCase()] || TYPE_NUMBERS.A;

  // ── Local check ───────────────────────────────────────────────────────────
  let isLocalHit = false;
  let localParsed = null;
  let localLatency = 0;
  let localByteLength = 0;
  let localParallelQueries = [];

  try {
    const { parsed, latencyMs, byteLength, queryPacket } = await performHop('127.0.0.1', 5354, cleanDomain, typeNum, {
      recursionDesired: true,
      dnssecOk: false,
      timeoutMs: 1200
    });

    isLocalHit = parsed.isAuthoritative && parsed.answers.length > 0;
    if (isLocalHit) {
      localParsed = parsed;
      localLatency = latencyMs;
      localByteLength = byteLength;

      if (recordType.toUpperCase() === 'ALL') {
        localParallelQueries.push({
          type: 'A',
          latencyMs,
          byteLength,
          rcode: parsed.rcode,
          queryPacket,
          responsePacket: parsed
        });

        const extraTypes = ['AAAA', 'MX', 'TXT', 'NS'];
        const extraResults = await Promise.allSettled(
          extraTypes.map(t => performHop('127.0.0.1', 5354, cleanDomain, TYPE_NUMBERS[t], { recursionDesired: true, dnssecOk: false, timeoutMs: 1000 }))
        );

        extraTypes.forEach((t, idx) => {
          const res = extraResults[idx];
          if (res.status === 'fulfilled') {
            localParsed.answers.push(...res.value.parsed.answers);
            localByteLength += res.value.byteLength;
            localParallelQueries.push({
              type: t,
              latencyMs: res.value.latencyMs,
              byteLength: res.value.byteLength,
              rcode: res.value.parsed.rcode,
              queryPacket: res.value.queryPacket,
              responsePacket: res.value.parsed
            });
          }
        });
        localLatency = Math.max(...localParallelQueries.map(q => q.latencyMs));
      } else {
        localParallelQueries = [{
          type: recordType.toUpperCase(),
          latencyMs,
          byteLength,
          rcode: parsed.rcode,
          queryPacket,
          responsePacket: parsed
        }];
      }
    }
  } catch (err) {
    logger.warn(`Local custom DNS server unreachable: ${err.message}`);
  }

  if (isLocalHit && localParsed) {
    const clientHopId = 'client';
    const localHopId = 'local';
    const authHopId = 'auth';

    state.hops.push(buildHop({
      id: clientHopId,
      step: state.stepCounter++,
      type: 'CLIENT',
      label: 'Client Stub',
      server: null,
      ip: '127.0.0.1',
      latencyMs: 0,
      cumulativeMs: 0,
      parsed: null,
      geo: { flag: '💻', org: 'Local Machine', country: 'Local' },
      description: `Querying local custom DNS resolver for ${cleanDomain} [Type: ${recordType.toUpperCase()}].`,
      queriedTypes: [recordType.toUpperCase()]
    }));

    state.hops.push(buildHop({
      id: localHopId,
      step: state.stepCounter++,
      type: 'LOCAL',
      label: 'Custom DNS',
      server: 'localhost',
      ip: '127.0.0.1',
      port: 5354,
      latencyMs: localLatency,
      cumulativeMs: localLatency,
      parsed: localParsed,
      geo: { flag: '🖥️', org: 'Local DNS Server', country: 'Local' },
      description: `Authoritative record match found inside Local DNS Server.`,
      byteLength: localByteLength,
      queriedTypes: recordType.toUpperCase() === 'ALL' ? ['A', 'AAAA', 'MX', 'TXT', 'NS'] : [recordType.toUpperCase()],
      parallelQueries: localParallelQueries,
      queryPacket: localParallelQueries[0]?.queryPacket || null
    }));

    state.hops.push(buildHop({
      id: authHopId,
      step: state.stepCounter++,
      type: 'AUTH',
      label: 'Authoritative',
      server: 'local-zone',
      ip: '127.0.0.1:5354',
      port: 5354,
      latencyMs: 0,
      cumulativeMs: localLatency,
      parsed: localParsed,
      geo: { flag: '🔐', org: 'Local Auth Zone' },
      description: `Local zone served mappings natively.`,
      byteLength: localByteLength,
      queriedTypes: recordType.toUpperCase() === 'ALL' ? ['A', 'AAAA', 'MX', 'TXT', 'NS'] : [recordType.toUpperCase()],
      parallelQueries: localParallelQueries
    }));

    state.edges.push({ from: clientHopId, to: localHopId, label: `Query ${cleanDomain}` });
    state.edges.push({ from: localHopId, to: authHopId, label: 'Local Answer' });

    const cnameRec = localParsed.answers.find(r => r.typeName === 'CNAME' && r.name.replace(/\.$/, '').toLowerCase() === cleanDomain);
    if (cnameRec) {
      const cnameTarget = String(cnameRec.value).replace(/\.$/, '').toLowerCase();
      const cnameHopId = 'cname-local-redirect';

      state.hops.push({
        id: cnameHopId,
        step: state.stepCounter++,
        type: 'CNAME_REDIRECT',
        label: 'CNAME Redirect',
        cnameFrom: cleanDomain,
        cnameTo: cnameTarget,
        description: `CNAME alias detected locally: ${cleanDomain} -> ${cnameTarget}. Following redirect recursively.`,
        geo: { flag: '🔗', org: 'CNAME Alias' }
      });
      state.edges.push({ from: authHopId, to: cnameHopId, label: 'CNAME' });

      const targetTrace = await executeTraceInternal(state, cnameTarget, recordType, false, 0, cnameHopId);
      return buildTraceResultFromState(state, targetTrace.finalParsed, cleanDomain, recordType);
    }

    return buildTraceResultFromState(state, localParsed, cleanDomain, recordType);
  }

  // ── Public recursive trace ───────────────────────────────────────────────
  const clientHopId = 'client';
  const localHopId = 'local';

  state.hops.push(buildHop({
    id: clientHopId,
    step: state.stepCounter++,
    type: 'CLIENT',
    label: 'Client Stub',
    server: null,
    ip: '127.0.0.1',
    latencyMs: 0,
    cumulativeMs: 0,
    parsed: null,
    geo: { flag: '💻', org: 'Local Machine', country: 'Local' },
    description: `Initiating public iterative trace for ${cleanDomain} [Type: ${recordType.toUpperCase()}].`,
    queriedTypes: [recordType.toUpperCase()]
  }));

  state.hops.push(buildHop({
    id: localHopId,
    step: state.stepCounter++,
    type: 'LOCAL',
    label: 'Custom DNS',
    server: 'localhost',
    ip: '127.0.0.1',
    port: 5354,
    latencyMs: 2,
    cumulativeMs: 2,
    parsed: null,
    geo: { flag: '🖥️', org: 'Local DNS Server', country: 'Local' },
    description: `Local custom DNS cache miss. Querying public root server hints.`,
    queriedTypes: [recordType.toUpperCase()]
  }));
  state.edges.push({ from: clientHopId, to: localHopId, label: `Query ${cleanDomain}` });

  const publicTrace = await executeTraceInternal(state, cleanDomain, recordType, false, 0, localHopId);
  return buildTraceResultFromState(state, publicTrace.finalParsed, cleanDomain, recordType);
}

function buildTraceResultFromState(state, finalParsed, domain, recordType) {
  const totalLatency = state.hops
    .filter(h => h.type !== 'CLIENT' && h.type !== 'CNAME_REDIRECT' && h.type !== 'ZONE' && h.type !== 'ANSWERS')
    .reduce((sum, h) => sum + (h.latencyMs || 0), 0);

  const cnameChain = [];
  const cnameRedirects = state.hops.filter(h => h.type === 'CNAME_REDIRECT');
  for (const c of cnameRedirects) {
    cnameChain.push({ from: c.cnameFrom, to: c.cnameTo });
  }

  let dnssecPresent = false;
  for (const h of state.hops) {
    if (h.response?.dnssecPresent) {
      dnssecPresent = true;
      break;
    }
  }

  return {
    domain,
    recordType: recordType.toUpperCase(),
    status: finalParsed ? finalParsed.rcode : 'UNKNOWN',
    totalLatency,
    dnssecPresent,
    answers: finalParsed ? finalParsed.answers : [],
    cnameChain,
    authZone: finalParsed ? (finalParsed.authority?.[0]?.name || null) : null,
    authNs: finalParsed ? (finalParsed.authority?.[0]?.value || null) : null,
    hopCount: state.hops.length,
    hops: state.hops,
    edges: state.edges,
    timestamp: state.timestamp
  };
}

// ── Benchmark ──────────────────────────────────────────────────────────────

async function benchmarkResolvers(domain, recordType = 'A') {
  const typeNum = TYPE_NUMBERS[recordType.toUpperCase()] || TYPE_NUMBERS.A;

  const measure = async (resolverIp, resolverName) => {
    const start = Date.now();
    try {
      const { parsed } = await performHop(resolverIp, 53, domain, typeNum, {
        recursionDesired: true,
        dnssecOk: false,
        timeoutMs: 3000, // benchmark queries have a slightly longer cap
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

module.exports = { iterativeTrace, benchmarkResolvers };
