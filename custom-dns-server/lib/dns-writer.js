const {
  TYPE_A,
  TYPE_AAAA,
  TYPE_NS,
  TYPE_CNAME,
  TYPE_MX,
  TYPE_TXT,
  TYPE_SOA,
  TYPE_OPT,
} = require("./types");


// splits the domain name into labels and writes them to the buffer
// eg([3]www[7]example[3]com[0]);
function writeDomainName(buffer, offset, domain) {
  if (!domain) {
    buffer.writeUInt8(0, offset++);
    return offset;
  }
  const labels = domain.split(".");
  for (const label of labels) {
    if (label.length === 0) continue;
    // DNS Label length must not exceed 63 bytes
    const len = Math.min(label.length, 63);
    buffer.writeUInt8(len, offset++);
    buffer.write(label, offset, len, 'ascii');
    offset += len;
  }
  buffer.writeUInt8(0, offset++);
  return offset;
}

function expandIPv6(ip) {
  const doubleColonIndex = ip.indexOf("::");
  let segments;
  
  if (doubleColonIndex !== -1) {
    const leftPart = ip.slice(0, doubleColonIndex);
    const rightPart = ip.slice(doubleColonIndex + 2);
    
    const leftSegs = leftPart ? leftPart.split(":") : [];
    const rightSegs = rightPart ? rightPart.split(":") : [];
    
    const missingCount = 8 - (leftSegs.length + rightSegs.length);
    const middleSegs = new Array(Math.max(0, missingCount)).fill("0");
    
    segments = [...leftSegs, ...middleSegs, ...rightSegs];
  } else {
    segments = ip.split(":");
  }
  
  // Ensure we have exactly 8 segments
  while (segments.length < 8) segments.push("0");
  while (segments.length > 8) segments.pop();
  
  return segments;
}

function writeAnswer(buffer, offset, name, answer) {
  offset = writeDomainName(buffer, offset, name);
  buffer.writeUInt16BE(answer.type, offset);
  offset += 2;
  buffer.writeUInt16BE(answer.class, offset);
  offset += 2;
  buffer.writeUInt32BE(answer.ttl, offset);
  offset += 4;

  const dataOffset = offset + 2;
  // The length of the data field is written at offset for reserve space
  let length;

  switch (answer.type) {
    case TYPE_A: {
      const octets = answer.data.split(".");
      if (octets.length !== 4) {
        throw new Error(`Invalid IPv4 address: ${answer.data}`);
      }
      octets.forEach((octet, i) => {
        const val = parseInt(octet, 10);
        if (isNaN(val) || val < 0 || val > 255) {
          throw new Error(`Invalid IPv4 octet: ${octet} in address ${answer.data}`);
        }
        buffer.writeUInt8(val, dataOffset + i);
      });
      length = 4;
      break;
    }

    case TYPE_AAAA: {
      const segments = expandIPv6(answer.data);
      segments.forEach((part, i) => {
        const val = parseInt(part || "0", 16);
        if (isNaN(val) || val < 0 || val > 0xffff) {
          throw new Error(`Invalid IPv6 segment: ${part} in address ${answer.data}`);
        }
        buffer.writeUInt16BE(val, dataOffset + i * 2);
      });
      length = 16;
      break;
    }

    case TYPE_CNAME:
    case TYPE_NS:
      length = writeDomainName(buffer, dataOffset, answer.data) - dataOffset;
      break;

    case TYPE_MX:
      buffer.writeUInt16BE(answer.data.preference, dataOffset);
      length =
        2 +
        writeDomainName(buffer, dataOffset + 2, answer.data.exchange) -
        (dataOffset + 2);
      break;

    case TYPE_TXT: {
      let dataPos = 0;
      let txtOffset = dataOffset;
      const textBuffer = Buffer.from(answer.data, 'utf8');
      const totalLen = textBuffer.length;

      if (totalLen === 0) {
        buffer.writeUInt8(0, txtOffset);
        txtOffset += 1;
      } else {
        while (dataPos < totalLen) {
          const chunkLen = Math.min(totalLen - dataPos, 255);
          buffer.writeUInt8(chunkLen, txtOffset);
          txtOffset += 1;
          textBuffer.copy(buffer, txtOffset, dataPos, dataPos + chunkLen);
          txtOffset += chunkLen;
          dataPos += chunkLen;
        }
      }
      length = txtOffset - dataOffset;
      break;
    }
    case TYPE_SOA: {
      // MNAME (primary nameserver) + RNAME (admin email)
      let soaOffset = dataOffset;
      soaOffset = writeDomainName(buffer, soaOffset, answer.data.mname);
      soaOffset = writeDomainName(buffer, soaOffset, answer.data.rname);
      // Serial, Refresh, Retry, Expire, Minimum — each 4 bytes
      buffer.writeUInt32BE(answer.data.serial,  soaOffset);      soaOffset += 4;
      buffer.writeUInt32BE(answer.data.refresh, soaOffset);      soaOffset += 4;
      buffer.writeUInt32BE(answer.data.retry,   soaOffset);      soaOffset += 4;
      buffer.writeUInt32BE(answer.data.expire,  soaOffset);      soaOffset += 4;
      buffer.writeUInt32BE(answer.data.minimum, soaOffset);      soaOffset += 4;
      length = soaOffset - dataOffset;
      break;
    }
    default:
      length = 0;
  }
  buffer.writeUInt16BE(length, offset);
  return dataOffset + length;
}

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

module.exports = {
  writeDomainName,
  writeAnswer,
  expandIPv6,
  buildDnsQuery,
};
