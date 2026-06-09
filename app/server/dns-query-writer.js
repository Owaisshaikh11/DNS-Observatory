/**
 * dns-query-writer.js
 *
 * Builds raw DNS query packets for sending over UDP.
 * Supports:
 *  - Non-recursive queries (RD=0) for iterative resolution
 *  - Recursive queries (RD=1) for benchmarking against public resolvers
 *  - EDNS0 OPT record with the DO (DNSSEC OK) flag
 *
 * The query format follows RFC 1035 §4.1.
 */

const TYPE_OPT = 41;  // EDNS0 pseudo-record type

/**
 * Builds a DNS query packet.
 *
 * @param {string} domain - The domain name to query (e.g. "github.com")
 * @param {number} type   - The record type number (e.g. 1 for A, 28 for AAAA)
 * @param {object} opts
 * @param {boolean} opts.recursionDesired - Set the RD bit (default: false for iterative)
 * @param {boolean} opts.dnssecOk        - Include EDNS0 OPT with DO flag (default: true)
 * @param {number}  opts.txId            - Transaction ID (default: random 1–65535)
 * @returns {Buffer} The raw DNS query packet
 */
function buildDnsQuery(domain, type, opts = {}) {
  const {
    recursionDesired = false,
    dnssecOk = true,
    txId = Math.floor(Math.random() * 65535) + 1,
  } = opts;

  const buf = Buffer.alloc(512);
  let offset = 12;

  // ── DNS Header (12 bytes) ─────────────────────────────────────────────────
  buf.writeUInt16BE(txId, 0);
  buf.writeUInt16BE(recursionDesired ? 0x0100 : 0x0000, 2); // flags — RD bit
  buf.writeUInt16BE(1, 4);               // QDCOUNT: 1 question
  buf.writeUInt16BE(0, 6);               // ANCOUNT: 0 answers
  buf.writeUInt16BE(0, 8);               // NSCOUNT: 0 authority
  buf.writeUInt16BE(dnssecOk ? 1 : 0, 10); // ARCOUNT: 1 if adding OPT record

  // ── Question Section ──────────────────────────────────────────────────────
  offset = writeDomainName(buf, offset, domain);
  buf.writeUInt16BE(type, offset); offset += 2; // QTYPE
  buf.writeUInt16BE(1,    offset); offset += 2; // QCLASS: IN (1)

  // ── EDNS0 OPT Record (optional) ──────────────────────────────────────────
  // Asking the server to include DNSSEC records (RRSIG, DNSKEY, DS) in its
  // response by setting the DO (DNSSEC OK) bit in the extended RCODE field.
  if (dnssecOk) {
    buf.writeUInt8(0, offset++);              // NAME: root label (empty)
    buf.writeUInt16BE(TYPE_OPT, offset); offset += 2; // TYPE: OPT (41)
    buf.writeUInt16BE(4096, offset);     offset += 2; // CLASS: requestor's UDP payload size
    buf.writeUInt32BE(0x00008000, offset); offset += 4; // TTL: extended RCODE + DO bit
    buf.writeUInt16BE(0, offset);        offset += 2; // RDLENGTH: 0 (no options)
  }

  return buf.slice(0, offset);
}

/**
 * Encodes a domain name into the DNS wire format:
 * Each label is prefixed with its length byte, terminated by a 0x00 root label.
 * e.g. "github.com" → [6]github[3]com[0]
 */
function writeDomainName(buf, offset, domain) {
  for (const label of domain.split('.')) {
    if (label.length === 0) continue;
    const len = Math.min(label.length, 63); // DNS label max = 63 bytes
    buf.writeUInt8(len, offset++);
    buf.write(label, offset, len, 'ascii');
    offset += len;
  }
  buf.writeUInt8(0, offset++); // root label — terminates the domain name
  return offset;
}

module.exports = { buildDnsQuery };
