/**
 * telemetry-bridge.js
 *
 * Bridges the custom DNS server's EventEmitter to Socket.io so that every
 * DNS query that passes through the local resolver is streamed to all
 * connected browser clients in real time.
 *
 * The DNS server emits 'query' events with this shape:
 *   {
 *     domain:       string,  // e.g. "github.com"
 *     type:         number,  // record type number (1 = A, etc.)
 *     source:       { address: string, port: number },
 *     isLocal:      boolean, // true if answered from local records
 *     responseCode: number,  // RCODE (0 = NOERROR, 3 = NXDOMAIN, etc.)
 *     timestamp:    number,  // epoch ms
 *     latencyMs:    number,  // RTT from receiving query to sending response
 *   }
 *
 * We augment each event with a unique ID before forwarding it so the frontend
 * can use it as a stable React key.
 */

const crypto = require('crypto');

// RCODE number → human-readable name
const RCODE_NAMES = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
};

// Record type number → name (common types only)
const TYPE_NAMES = {
  1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA',
  15: 'MX', 16: 'TXT', 28: 'AAAA',
};

/**
 * Subscribes to the DNS server's event emitter and forwards each query event
 * to all connected Socket.io clients.
 *
 * @param {import('dgram').Socket & { dnsEvents: import('events').EventEmitter }} dnsServer
 * @param {import('socket.io').Server} io
 */
function connectTelemetry(dnsServer, io) {
  if (!dnsServer || !dnsServer.dnsEvents) {
    console.warn('[Telemetry] DNS server has no event emitter — live query feed disabled.');
    return;
  }

  dnsServer.dnsEvents.on('query', (event) => {
    // Augment with a stable ID and human-readable names before forwarding
    const enriched = {
      id:           crypto.randomUUID(),
      domain:       event.domain,
      typeName:     TYPE_NAMES[event.type] || `TYPE${event.type}`,
      typeNum:      event.type,
      source:       event.source,
      isLocal:      event.isLocal,
      rcode:        RCODE_NAMES[event.responseCode] || `RCODE${event.responseCode}`,
      rcodeNum:     event.responseCode,
      latencyMs:    event.latencyMs,
      timestamp:    event.timestamp,
    };

    io.emit('dns:query', enriched);
  });

  console.log('[Telemetry] Connected — streaming live DNS query events via Socket.io.');
}

module.exports = { connectTelemetry };
