const dgram = require("dgram");
const { EventEmitter } = require("events");
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

  server.on("error", (err) => {
    console.error(`DNS server error: ${err.message}`);
  });

  server.on("message", async (msg, rinfo) => {
    const startTime = Date.now();
    let query;

    try {
      query = parseQuery(msg);
    } catch (err) {
      console.error(
        `DNS Query parsing failed from ${rinfo.address}:${rinfo.port} - ${err.message}`
      );
      const txId = msg.length >= 2 ? msg.readUInt16BE(0) : 0;
      const response = createErrorResponse(txId, 1); // RCODE 1 = FORMERR
      server.send(response, rinfo.port, rinfo.address, (sendErr) => {
        if (sendErr) console.error("Error sending FORMERR response:", sendErr);
      });
      return;
    }

    try {
      if (!query.questions || query.questions.length === 0) {
        console.warn("Received DNS Query with no questions — ignoring.");
        return;
      }

      const question = query.questions[0];

      console.log(
        `DNS Query: ${question.name} (Type ${question.type}) from ${rinfo.address}:${rinfo.port}`
      );

      if (question.class !== CLASS_IN) {
        const response = createResponse(query, []);
        server.send(response, rinfo.port, rinfo.address, (sendErr) => {
          if (sendErr) console.error("Error sending DNS response:", sendErr);
        });
        return;
      }

      // Forward non-local queries to upstream DNS servers
      if (dnsConfig.forwardEnabled && !isLocalDomain(question.name)) {
        console.log(`Forwarding query for ${question.name} to upstream servers`);
        const responseMsg = await forwardQuery(msg);

        if (responseMsg) {
          server.send(responseMsg, rinfo.port, rinfo.address, (sendErr) => {
            if (sendErr) console.error("Error sending forwarded DNS response:", sendErr);
          });
          // Decode response RCODE from raw DNS response header (byte index 2-3)
          const responseFlags = responseMsg.length >= 4 ? responseMsg.readUInt16BE(2) : 0;
          const rcode = responseFlags & 0x000f;
          _emitQuery(dnsEvents, question, rinfo, rcode, startTime, false, msg, responseMsg);
        } else {
          console.warn(`Upstream resolution failed for ${question.name}. Sending SERVFAIL.`);
          const response = createResponse(query, [], 2); // RCODE 2 = SERVFAIL
          server.send(response, rinfo.port, rinfo.address, (sendErr) => {
            if (sendErr) console.error("Error sending SERVFAIL response:", sendErr);
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
        if (sendErr) console.error("Error sending DNS response:", sendErr);
      });

      _emitQuery(dnsEvents, question, rinfo, rcode, startTime, isLocal, msg, response);
    } catch (err) {
      console.error("Error resolving DNS query:", err);
      try {
        const response = createResponse(query, [], 2); // RCODE 2 = SERVFAIL
        server.send(response, rinfo.port, rinfo.address, (sendErr) => {
          if (sendErr) console.error("Error sending SERVFAIL response:", sendErr);
        });
      } catch (innerErr) {
        console.error("Failed to build/send SERVFAIL response:", innerErr);
      }
    }
  });

  server.bind(port, () => console.log(`DNS server running on port ${port}`));
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
