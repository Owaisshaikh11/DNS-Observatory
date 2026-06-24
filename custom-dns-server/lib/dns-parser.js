const {
  QR_MASK,
  AA_MASK,
  TC_MASK,
  RD_MASK,
  RA_MASK,
  TYPE_A,
  TYPE_NS,
  TYPE_CNAME,
  TYPE_SOA,
  TYPE_PTR,
  TYPE_MX,
  TYPE_TXT,
  TYPE_AAAA,
  TYPE_SRV,
  TYPE_OPT,
  TYPE_DS,
  TYPE_RRSIG,
  TYPE_DNSKEY,
} = require("./types");

const { writeDomainName, writeAnswer } = require("./dns-writer");

// ── Flag names and maps ───────────────────────────────────────────────────
const RCODE_NAMES = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
};

const OPCODE_NAMES = {
  0: 'QUERY',
  1: 'IQUERY',
  2: 'STATUS',
  4: 'NOTIFY',
  5: 'UPDATE',
};

const DNSSEC_ALGS = {
  1: 'RSAMD5',
  3: 'DSA',
  5: 'RSASHA1',
  7: 'RSASHA1-NSEC3-SHA1',
  8: 'RSASHA256',
  10: 'RSASHA512',
  13: 'ECDSAP256SHA256',
  14: 'ECDSAP384SHA384',
  15: 'ED25519',
  16: 'ED448'
};

const TYPE_NAMES = {
  [TYPE_A]:      'A',
  [TYPE_NS]:     'NS',
  [TYPE_CNAME]:  'CNAME',
  [TYPE_SOA]:    'SOA',
  [TYPE_PTR]:    'PTR',
  [TYPE_MX]:     'MX',
  [TYPE_TXT]:    'TXT',
  [TYPE_AAAA]:   'AAAA',
  [TYPE_SRV]:    'SRV',
  [TYPE_OPT]:    'OPT',
  [TYPE_DS]:     'DS',
  [TYPE_RRSIG]:  'RRSIG',
  [TYPE_DNSKEY]: 'DNSKEY',
};

// `buffer` is a raw binary packet sent over UDP (comes from the `dgram` module)
// `offset` is a pointer — tells us where we are in the buffer while reading bytes

/**
 * Decodes a domain name from the DNS wire format, supporting label pointer compression.
 *
 * @param {Buffer} buffer - The raw DNS packet buffer
 * @param {number} offset - The starting index in the buffer
 * @returns {Array} A pair [decodedDomainName, nextOffset]
 */
function parseDomainName(buffer, offset) {
  const labels = [];
  let jumped = false;
  let jumpOffset = offset;
  let pointer = offset;
  const visited = new Set();

  while (true) {
    if (pointer >= buffer.length) {
      throw new Error("DNS packet parsing error: Pointer out of bounds");
    }

    if (visited.has(pointer)) {
      throw new Error("DNS packet parsing error: Circular reference detected");
    }
    visited.add(pointer);

    const length = buffer.readUInt8(pointer);
    if (length === 0) {
      pointer += 1;
      break;
    }

    if ((length & 0xc0) === 0xc0) {
      // pointer to another name (compression)
      if (pointer + 1 >= buffer.length) {
        throw new Error("DNS packet parsing error: Compressed pointer truncated");
      }
      if (!jumped) jumpOffset = pointer + 2;
      pointer = ((length & 0x3f) << 8) | buffer.readUInt8(pointer + 1);
      jumped = true;
    } else {
      // normal label
      if (pointer + 1 + length > buffer.length) {
        throw new Error("DNS packet parsing error: Label length out of bounds");
      }
      pointer += 1;
      labels.push(buffer.slice(pointer, pointer + length).toString("utf8"));
      pointer += length;
    }
  }

  return [labels.join("."), jumped ? jumpOffset : pointer];
}

/**
 * Parses the RDATA portion of a resource record based on its type.
 * Returns a human-readable value (string or object).
 */
function parseRdata(buffer, offset, type, length) {
  if (offset + length > buffer.length) return `<truncated RDATA of type ${type}>`;
  switch (type) {
    // ── A: 4-byte IPv4 address ──────────────────────────────────────────────
    case TYPE_A: {
      if (length !== 4 || offset + 4 > buffer.length) return `<invalid A length: ${length}>`;
      return `${buffer[offset]}.${buffer[offset+1]}.${buffer[offset+2]}.${buffer[offset+3]}`;
    }

    // ── AAAA: 16-byte IPv6 address ──────────────────────────────────────────
    case TYPE_AAAA: {
      if (length !== 16 || offset + 16 > buffer.length) return `<invalid AAAA length: ${length}>`;
      const groups = [];
      for (let i = 0; i < 8; i++) {
        groups.push(buffer.readUInt16BE(offset + i * 2).toString(16));
      }
      return groups.join(':');
    }

    // ── NS / CNAME / PTR: compressed domain name ───────────────────────────
    case TYPE_NS:
    case TYPE_CNAME:
    case TYPE_PTR: {
      if (offset >= buffer.length) return '';
      const [name] = parseDomainName(buffer, offset);
      return name;
    }

    // ── SOA: two domain names + five 32-bit integers ────────────────────────
    case TYPE_SOA: {
      if (offset >= buffer.length) return {};
      const [mname, afterMname] = parseDomainName(buffer, offset);
      if (afterMname >= buffer.length) return { mname };
      const [rname, afterRname] = parseDomainName(buffer, afterMname);
      if (afterRname + 20 > buffer.length) return { mname, rname };
      return {
        mname,
        rname:   rname.replace(/\.$/, ''),  // trim trailing dot for readability
        serial:  buffer.readUInt32BE(afterRname),
        refresh: buffer.readUInt32BE(afterRname + 4),
        retry:   buffer.readUInt32BE(afterRname + 8),
        expire:  buffer.readUInt32BE(afterRname + 12),
        minimum: buffer.readUInt32BE(afterRname + 16),
      };
    }

    // ── MX: 16-bit preference + compressed exchange name ────────────────────
    case TYPE_MX: {
      if (length < 2 || offset + 2 > buffer.length) return null;
      const preference = buffer.readUInt16BE(offset);
      const [exchange] = parseDomainName(buffer, offset + 2);
      return { preference, exchange };
    }

    // ── SRV: priority, weight, port, target domain name ─────────────────────
    case TYPE_SRV: {
      if (length < 6 || offset + 6 > buffer.length) return null;
      const priority = buffer.readUInt16BE(offset);
      const weight = buffer.readUInt16BE(offset + 2);
      const port = buffer.readUInt16BE(offset + 4);
      const [target] = parseDomainName(buffer, offset + 6);
      return { priority, weight, port, target };
    }

    // ── TXT: one or more length-prefixed character strings ──────────────────
    case TYPE_TXT: {
      const strings = [];
      let pos = offset;
      const end = offset + length;
      while (pos < end) {
        if (pos + 1 > buffer.length) break;
        const len = buffer.readUInt8(pos++);
        if (pos + len > buffer.length || pos + len > end) break;
        strings.push(buffer.slice(pos, pos + len).toString('utf8'));
        pos += len;
      }
      return strings.join(' ');
    }

    // ── DS: Delegation Signer (DNSSEC) ──────────────────────────────────────
    case TYPE_DS: {
      if (length < 4 || offset + 4 > buffer.length) return null;
      const keyTag = buffer.readUInt16BE(offset);
      const algorithm = buffer.readUInt8(offset + 2);
      const digestType = buffer.readUInt8(offset + 3);
      const digestTypeName = digestType === 1 ? 'SHA-1' : digestType === 2 ? 'SHA-256' : digestType === 4 ? 'SHA-384' : 'UNKNOWN';
      const digestEnd = offset + length;
      if (digestEnd > buffer.length) return null;
      return {
        keyTag,
        algorithm,
        algorithmName: DNSSEC_ALGS[algorithm] || 'UNKNOWN',
        digestType,
        digestTypeName,
        digest: buffer.slice(offset + 4, digestEnd).toString('hex'),
      };
    }

    // ── DNSKEY: DNSSEC public key ────────────────────────────────────────────
    case TYPE_DNSKEY: {
      if (length < 4 || offset + 4 > buffer.length) return null;
      const flags = buffer.readUInt16BE(offset);
      const protocol = buffer.readUInt8(offset + 2);
      const algorithm = buffer.readUInt8(offset + 3);
      return {
        flags,
        protocol,
        algorithm,
        algorithmName: DNSSEC_ALGS[algorithm] || 'UNKNOWN',
        isZoneKey: (flags & 0x0100) !== 0,
        isSep: (flags & 0x0001) !== 0, // Secure Entry Point (KSK)
        keyLength: length - 4,
      };
    }

    // ── RRSIG: DNSSEC Signature ──────────────────────────────────────────────
    case TYPE_RRSIG: {
      if (length < 18 || offset + 18 > buffer.length) return null;
      const typeCovered = buffer.readUInt16BE(offset);
      const algorithm = buffer.readUInt8(offset + 2);
      const labels = buffer.readUInt8(offset + 3);
      const origTtl = buffer.readUInt32BE(offset + 4);
      const expiration = buffer.readUInt32BE(offset + 8);
      const inception = buffer.readUInt32BE(offset + 12);
      const keyTag = buffer.readUInt16BE(offset + 16);
      const signerNameOffset = offset + 18;
      if (signerNameOffset >= buffer.length) return null;
      const [signerName] = parseDomainName(buffer, signerNameOffset);
      
      const expirationDate = new Date(expiration * 1000).toISOString().split('T')[0];
      const inceptionDate = new Date(inception * 1000).toISOString().split('T')[0];

      return {
        typeCovered: TYPE_NAMES[typeCovered] || `TYPE${typeCovered}`,
        algorithm,
        algorithmName: DNSSEC_ALGS[algorithm] || 'UNKNOWN',
        labels,
        origTtl,
        expiration,
        expirationDate,
        inception,
        inceptionDate,
        keyTag,
        signerName,
      };
    }

    default:
      return `<${length} bytes of type ${type}>`;
  }
}

/**
 * Unified packet parser representing both DNS Queries and Responses.
 * Decodes the 12-byte header, questions, and all RR sections.
 *
 * @param {Buffer} buffer - Raw UDP payload from a DNS packet
 * @returns {object} Unified structure containing parsed header, sections, and raw hex representation
 */
function parseDnsPacket(buffer) {
  if (buffer.length < 12) {
    throw new Error("DNS packet parsing error: Header truncated");
  }

  const id = buffer.readUInt16BE(0);
  const rawFlags = buffer.readUInt16BE(2);
  const qdcount = buffer.readUInt16BE(4);
  const ancount = buffer.readUInt16BE(6);
  const nscount = buffer.readUInt16BE(8);
  const arcount = buffer.readUInt16BE(10);

  const rcode = rawFlags & 0x000f;
  const opcode = (rawFlags & 0x7800) >> 11;

  // Extract flag strings
  const flags = [];
  if (rawFlags & QR_MASK) flags.push('QR');
  if (rawFlags & AA_MASK) flags.push('AA');
  if (rawFlags & TC_MASK) flags.push('TC');
  if (rawFlags & RD_MASK) flags.push('RD');
  if (rawFlags & RA_MASK) flags.push('RA');
  if (rawFlags & 0x0020) flags.push('AD'); // AD flag
  if (rawFlags & 0x0010) flags.push('CD'); // CD flag

  let offset = 12;

  // Question section
  const questions = [];
  for (let i = 0; i < qdcount; i++) {
    if (offset >= buffer.length) break;
    const startOffset = offset;
    const [name, next] = parseDomainName(buffer, offset);
    offset = next;
    if (offset + 4 > buffer.length) {
      throw new Error("DNS packet parsing error: Question section truncated");
    }
    const type = buffer.readUInt16BE(offset);
    const cls = buffer.readUInt16BE(offset + 2);
    offset += 4;
    questions.push({
      name,
      type,
      typeName: TYPE_NAMES[type] || `TYPE${type}`,
      class: cls,
      startOffset,
      endOffset: offset
    });
  }

  // Helper to parse resource record sections
  function parseSectionRecords(count) {
    const records = [];
    for (let i = 0; i < count; i++) {
      if (offset >= buffer.length) break;

      const startOffset = offset;
      const [name, afterName] = parseDomainName(buffer, offset);
      offset = afterName;

      if (offset + 10 > buffer.length) break;

      const typeNum = buffer.readUInt16BE(offset);
      const classNum = buffer.readUInt16BE(offset + 2);
      const ttl = buffer.readUInt32BE(offset + 4);
      const rdlength = buffer.readUInt16BE(offset + 8);
      offset += 10;

      if (offset + rdlength > buffer.length) break;
      const rdataEnd = offset + rdlength;
      const typeName = TYPE_NAMES[typeNum] || `TYPE${typeNum}`;

      if (typeNum === TYPE_OPT) {
        const extendedRcode = (ttl >> 24) & 0xff;
        const ednsVersion = (ttl >> 16) & 0xff;
        const doBit = (ttl & 0x8000) !== 0;

        const options = [];
        let optPos = offset;
        while (optPos + 4 <= rdataEnd) {
          const optCode = buffer.readUInt16BE(optPos);
          const optLen = buffer.readUInt16BE(optPos + 2);
          optPos += 4;
          if (optPos + optLen > rdataEnd) break;

          const optData = buffer.slice(optPos, optPos + optLen);
          optPos += optLen;

          let optName = `OPTION_${optCode}`;
          let optValue = optData.toString('hex').match(/.{1,2}/g)?.join(' ') || '';

          if (optCode === 8) { // EDNS Client Subnet (ECS)
            optName = 'Client Subnet (ECS)';
            try {
              if (optLen >= 4) {
                const family = optData.readUInt16BE(0);
                const sourceMask = optData.readUInt8(2);
                const scopeMask = optData.readUInt8(3);
                const addrBytes = optData.slice(4);
                let ip = '';
                if (family === 1) { // IPv4
                  const octets = [];
                  for (let j = 0; j < 4; j++) {
                    octets.push(j < addrBytes.length ? addrBytes[j] : 0);
                  }
                  ip = octets.join('.');
                } else if (family === 2) { // IPv6
                  const segments = [];
                  for (let j = 0; j < 8; j++) {
                    const byteIdx = j * 2;
                    const seg = byteIdx < addrBytes.length ? optData.readUInt16BE(4 + byteIdx) : 0;
                    segments.push(seg.toString(16));
                  }
                  ip = segments.join(':');
                }
                optValue = { family, sourceMask, scopeMask, address: ip };
              }
            } catch (err) {
              optValue = `Parsing error: ${err.message}`;
            }
          }
          options.push({ code: optCode, name: optName, value: optValue });
        }

        const parsedOpt = {
          udpPayloadSize: classNum,
          extendedRcode,
          version: ednsVersion,
          dnssecOk: doBit,
          options
        };

        records.push({
          name: name || '.',
          typeNum,
          typeName: 'OPT',
          class: classNum,
          ttl,
          value: `UDP Payload Size: ${classNum}B | DO: ${doBit ? 1 : 0} | Version: ${ednsVersion}`,
          isOpt: true,
          optDetails: parsedOpt,
          startOffset,
          endOffset: rdataEnd
        });

        offset = rdataEnd;
        continue;
      }

      const value = parseRdata(buffer, offset, typeNum, rdlength);
      offset = rdataEnd;

      records.push({
        name: name || '.',
        typeNum,
        typeName,
        class: classNum,
        ttl,
        value,
        startOffset,
        endOffset: offset
      });
    }
    return records;
  }

  const answers = parseSectionRecords(ancount);
  const authority = parseSectionRecords(nscount);
  const additional = parseSectionRecords(arcount);

  const rawHex = [...buffer].map(b => b.toString(16).padStart(2, '0')).join(' ');

  return {
    id,
    rawFlags,
    flags,
    opcode,
    rcode,
    qdcount,
    ancount,
    nscount,
    arcount,
    questions,
    answers,
    authority,
    additional,
    rawHex
  };
}

/**
 * Parses a raw DNS query buffer for backward-compatible server ingestion.
 *
 * @param {Buffer} buffer - The raw DNS packet buffer
 * @returns {object} Decoded query structured object
 */
function parseQuery(buffer) {
  const packet = parseDnsPacket(buffer);
  
  // Find OPT record if present in additional section
  let edns = { present: false };
  const optRecord = packet.additional.find(r => r.isOpt);
  if (optRecord) {
    edns = {
      present: true,
      udpPayloadSize: optRecord.class,
      dnssecOk: optRecord.optDetails.dnssecOk
    };
  }

  return {
    header: {
      id: packet.id,
      flags: packet.rawFlags,
      qdcount: packet.qdcount
    },
    id: packet.id,
    flags: packet.flags,
    rawFlags: packet.rawFlags,
    opcode: packet.opcode,
    rcode: packet.rcode,
    qdcount: packet.qdcount,
    ancount: packet.ancount,
    nscount: packet.nscount,
    arcount: packet.arcount,
    questions: packet.questions,
    rawHex: packet.rawHex,
    edns
  };
}

/**
 * Parses a raw DNS response buffer for backward-compatible backend visualization.
 *
 * @param {Buffer} buffer - The raw DNS packet buffer
 * @returns {object} Decoded response structured object
 */
function parseDnsResponse(buffer) {
  const packet = parseDnsPacket(buffer);
  
  const opcodeName = OPCODE_NAMES[packet.opcode] || `OPCODE${packet.opcode}`;
  const rcodeName = RCODE_NAMES[packet.rcode] || `RCODE${packet.rcode}`;
  
  const allRecords = [...packet.answers, ...packet.authority, ...packet.additional];
  const dnssec = {
    rrsigPresent:  allRecords.some(r => r.typeNum === TYPE_RRSIG),
    dnskeyPresent: allRecords.some(r => r.typeNum === TYPE_DNSKEY),
    dsPresent:     allRecords.some(r => r.typeNum === TYPE_DS),
  };
  const dnssecPresent = dnssec.rrsigPresent || dnssec.dnskeyPresent || dnssec.dsPresent;

  return {
    id: packet.id,
    flags: packet.flags,
    rawFlags: packet.rawFlags,
    opcode: opcodeName,
    opcodeNum: packet.opcode,
    rcode: rcodeName,
    rcodeNum: packet.rcode,
    qdcount: packet.qdcount,
    ancount: packet.ancount,
    nscount: packet.nscount,
    arcount: packet.arcount,
    isAuthoritative:  (packet.rawFlags & AA_MASK) !== 0,
    isTruncated:      (packet.rawFlags & TC_MASK) !== 0,
    isRecursionAvail: (packet.rawFlags & RA_MASK) !== 0,
    questions: packet.questions,
    answers: packet.answers,
    authority: packet.authority,
    additional: packet.additional,
    dnssec,
    dnssecPresent,
    rawHex: packet.rawHex,
  };
}

/**
 * Serializes a set of resource records into a valid DNS response packet.
 * Features a rollback-and-truncate safety mechanism to prevent RangeError crashes.
 *
 * @param {object} query - The original query object
 * @param {Array} answers - List of answer objects to serialize
 * @param {number} rcode - The response code
 * @returns {Buffer} Serialized response buffer slice
 */
function createResponse(query, answers = [], rcode = 0) {
  // Allocating 4KB of binary space for the response
  const buffer = Buffer.alloc(4096);
  let offset = 12;

  buffer.writeUInt16BE(query.header.id, 0);
  let flags = QR_MASK | AA_MASK | (query.header.flags & RD_MASK) | RA_MASK;
  if (rcode !== 0) {
    flags = (flags & ~0x000f) | (rcode & 0x0f);
  }
  buffer.writeUInt16BE(flags, 2);

  const qdCount = query.questions && query.questions.length > 0 ? 1 : 0;
  const hasEdns = query.edns && query.edns.present;
  buffer.writeUInt16BE(qdCount, 4); // QDCount
  buffer.writeUInt16BE(0, 6); // ANCount placeholder, written dynamically below
  buffer.writeUInt16BE(0, 8); // NSCount
  buffer.writeUInt16BE(hasEdns ? 1 : 0, 10); // ARCount (will be adjusted if truncated)

  let questionName = "";
  if (qdCount > 0) {
    const question = query.questions[0];
    questionName = question.name;
    offset = writeDomainName(buffer, offset, question.name);
    buffer.writeUInt16BE(question.type, offset);
    offset += 2;
    buffer.writeUInt16BE(question.class, offset);
    offset += 2;
  }

  let answersWritten = 0;
  let tcFlag = false;

  for (const answer of answers) {
    const prevOffset = offset;
    if (offset + 512 > buffer.length) {
      tcFlag = true;
      break;
    }
    try {
      offset = writeAnswer(buffer, offset, questionName, answer);
      answersWritten++;
    } catch (err) {
      if (err instanceof RangeError || err.message.includes("out of range") || err.message.includes("overflow")) {
        offset = prevOffset;
        tcFlag = true;
        break;
      } else {
        throw err;
      }
    }
  }

  buffer.writeUInt16BE(answersWritten, 6);

  if (tcFlag) {
    let currentFlags = buffer.readUInt16BE(2);
    currentFlags |= TC_MASK;
    buffer.writeUInt16BE(currentFlags, 2);
  }

  if (hasEdns && !tcFlag) {
    // Write OPT record at the end of the response buffer
    // Name: 0x00 (root, 1 byte)
    buffer.writeUInt8(0, offset);
    offset += 1;

    // Type: 41 (OPT, 2 bytes)
    buffer.writeUInt16BE(41, offset);
    offset += 2;

    // Max UDP Payload Size: Class field (2 bytes). Capped at 4096.
    const requestedSize = query.edns.udpPayloadSize || 4096;
    const responsePayloadSize = Math.min(requestedSize, 4096);
    buffer.writeUInt16BE(responsePayloadSize, offset);
    offset += 2;

    // Extended RCODE & Version & Flags: TTL field (4 bytes)
    const ttlVal = query.edns.dnssecOk ? 0x00008000 : 0x00000000;
    buffer.writeUInt32BE(ttlVal, offset);
    offset += 4;

    // RDLENGTH: 0 (2 bytes)
    buffer.writeUInt16BE(0, offset);
    offset += 2;
  } else {
    buffer.writeUInt16BE(0, 10);
  }

  return buffer.slice(0, offset);
}

/**
 * Creates a minimalist error DNS response header.
 *
 * @param {number} id - Transaction ID
 * @param {number} rcode - The error response code (e.g. 1 for FORMERR)
 * @returns {Buffer} Raw response buffer
 */
function createErrorResponse(id, rcode) {
  const buffer = Buffer.alloc(12);
  buffer.writeUInt16BE(id, 0);
  
  // flags: Response (QR = 1), Authoritative Answer (AA = 1), RCODE = rcode
  const flags = 0x8000 | 0x0400 | (rcode & 0x0f);
  buffer.writeUInt16BE(flags, 2);
  
  buffer.writeUInt16BE(0, 4); // QDCount
  buffer.writeUInt16BE(0, 6); // ANCount
  buffer.writeUInt16BE(0, 8); // NSCount
  buffer.writeUInt16BE(0, 10); // ARCount
  
  return buffer;
}

module.exports = {
  parseDomainName,
  parseQuery,
  createResponse,
  createErrorResponse,
  parseDnsResponse,
};
