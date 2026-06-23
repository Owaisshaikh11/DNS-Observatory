const dgram = require("dgram");
const { EventEmitter } = require("events");
const logger = require("../lib/logger");
const { parseQuery, createResponse, createErrorResponse } = require("../lib/dns-parser");
const { getRecordsForDomain, isLocalDomain } = require("../lib/dns-resolver");
const { CLASS_IN } = require("../lib/types");
const { dnsConfig } = require("../config/dns-config");
const { forwardQuery } = require("../lib/dns-forwarder");

function startDnsUdpServer(port = 53) {
  const server = dgram.createSocket("udp4");

  // Attach an event emitter so the telemetry bridge can subscribe
  const dnsEvents = new EventEmitter();
  server.dnsEvents = dnsEvents;

  let bound = false;
  server.on("error", (err) => {
    logger.error({ err }, `DNS server socket error: ${err.message}`);
    if (err.code === 'EADDRINUSE' && !bound) {
      logger.warn(`DNS Port ${port} is in use. Falling back to an ephemeral UDP port.`);
      server.bind(0);
    }
  });

  server.on("listening", () => {
    bound = true;
    const address = server.address();
    logger.info(`DNS server running on port ${address.port}`);
  });

  server.on("message", async (msg, rinfo) => {
    // DNS Reflection Protection: drop response packets (QR = 1) immediately to prevent amplification vectors
    if (msg.length >= 4) {
      const flags = msg.readUInt16BE(2);
      if ((flags & 0x8000) !== 0) {
        logger.warn(
          { remote: `${rinfo.address}:${rinfo.port}` },
          `Dropped DNS response packet (QR = 1) received on listening port from ${rinfo.address}:${rinfo.port}`
        );
        return;
      }
    }

    const startTime = Date.now();
    let query;

    try {
      query = parseQuery(msg);
    } catch (err) {
      logger.warn(
        { err, remote: `${rinfo.address}:${rinfo.port}` },
        `DNS Query parsing failed from ${rinfo.address}:${rinfo.port} - ${err.message}`
      );
      const txId = msg.length >= 2 ? msg.readUInt16BE(0) : 0;
      const response = createErrorResponse(txId, 1); // RCODE 1 = FORMERR
      server.send(response, rinfo.port, rinfo.address, (sendErr) => {
        if (sendErr) logger.error({ err: sendErr }, "Error sending FORMERR response");
      });
      return;
    }

    try {
      if (!query.questions || query.questions.length === 0) {
        logger.warn({ remote: `${rinfo.address}:${rinfo.port}` }, "Received DNS Query with no questions — ignoring.");
        return;
      }

      const question = query.questions[0];

      logger.info(
        { domain: question.name, type: question.type, remote: `${rinfo.address}:${rinfo.port}` },
        `DNS Query: ${question.name} (Type ${question.type}) from ${rinfo.address}:${rinfo.port}`
      );

      if (question.class !== CLASS_IN) {
        const response = createResponse(query, []);
        server.send(response, rinfo.port, rinfo.address, (sendErr) => {
          if (sendErr) logger.error({ err: sendErr }, "Error sending DNS response for non-IN class");
        });
        return;
      }

      // Forward non-local queries to upstream DNS servers
      if (dnsConfig.forwardEnabled && !isLocalDomain(question.name)) {
        logger.debug({ domain: question.name }, `Forwarding query for ${question.name} to upstream servers`);
        const responseMsg = await forwardQuery(msg);

        if (responseMsg) {
          server.send(responseMsg, rinfo.port, rinfo.address, (sendErr) => {
            if (sendErr) logger.error({ err: sendErr }, "Error sending forwarded DNS response");
          });
          // Decode response RCODE from raw DNS response header (byte index 2-3)
          const responseFlags = responseMsg.length >= 4 ? responseMsg.readUInt16BE(2) : 0;
          const rcode = responseFlags & 0x000f;
          _emitQuery(dnsEvents, question, rinfo, rcode, startTime, false, msg, responseMsg);
        } else {
          logger.warn({ domain: question.name }, `Upstream resolution failed for ${question.name}. Sending SERVFAIL.`);
          const response = createResponse(query, [], 2); // RCODE 2 = SERVFAIL
          server.send(response, rinfo.port, rinfo.address, (sendErr) => {
            if (sendErr) logger.error({ err: sendErr }, "Error sending SERVFAIL response");
          });
          _emitQuery(dnsEvents, question, rinfo, 2, startTime, false, msg, response);
        }
        return;
      }

      // Local resolution
      const answers = getRecordsForDomain(question.name, question.type);
      const isLocal = isLocalDomain(question.name);
      const rcode = isLocal ? 0 : 3; // RCODE 3 = NXDOMAIN for unknown domains
      const response = createResponse(query, answers, rcode);
      server.send(response, rinfo.port, rinfo.address, (sendErr) => {
        if (sendErr) logger.error({ err: sendErr }, "Error sending DNS response");
      });

      _emitQuery(dnsEvents, question, rinfo, rcode, startTime, isLocal, msg, response);
    } catch (err) {
      logger.error({ err, domain: query?.questions?.[0]?.name }, "Error resolving DNS query");
      try {
        const response = createResponse(query, [], 2); // RCODE 2 = SERVFAIL
        server.send(response, rinfo.port, rinfo.address, (sendErr) => {
          if (sendErr) logger.error({ err: sendErr }, "Error sending SERVFAIL response after catch");
        });
      } catch (innerErr) {
        logger.error({ err: innerErr }, "Failed to build/send SERVFAIL response after catch");
      }
    }
  });

  server.bind(port);
  return server;
}

// Helper — builds and emits the telemetry event without cluttering the handler
function _emitQuery(emitter, question, rinfo, rcode, startTime, isLocal, queryBuffer, responseBuffer) {
  emitter.emit("query", {
    domain: question.name,
    type: question.type,
    source: { address: rinfo.address, port: rinfo.port },
    isLocal,
    responseCode: rcode,
    timestamp: Date.now(),
    latencyMs: Date.now() - startTime,
    queryBuffer,
    responseBuffer,
  });
}

module.exports = { startDnsUdpServer };
