/**
 * dns-response-parser.js
 *
 * Decodes a raw DNS response packet (Buffer) into a structured JavaScript
 * object. Handles all standard record types and DNSSEC-related types.
 *
 * Reuses parseDomainName from the custom DNS server (which handles RFC 1035
 * pointer compression correctly).
 *
 * Follows RFC 1035 §4.1 (message format) and RFC 4034 (DNSSEC resource records).
 */

const { parseDomainName } = require('../../custom-dns-server/lib/dns-parser');

// ── Flag bitmasks ──────────────────────────────────────────────────────────
const FLAG_QR   = 0x8000; // bit 15: response (1) vs query (0)
const FLAG_AA   = 0x0400; // bit 10: authoritative answer
const FLAG_TC   = 0x0200; // bit 9:  truncated
const FLAG_RD   = 0x0100; // bit 8:  recursion desired
const FLAG_RA   = 0x0080; // bit 7:  recursion available
const FLAG_AD   = 0x0020; // bit 5:  authenticated data (DNSSEC)
const FLAG_CD   = 0x0010; // bit 4:  checking disabled (DNSSEC)

// ── Record type numbers ────────────────────────────────────────────────────
const TYPE_A      = 1;
const TYPE_NS     = 2;
const TYPE_CNAME  = 5;
const TYPE_SOA    = 6;
const TYPE_PTR    = 12;
const TYPE_MX     = 15;
const TYPE_TXT    = 16;
const TYPE_AAAA   = 28;
const TYPE_SRV    = 33;
const TYPE_OPT    = 41; // EDNS0 pseudo-record
const TYPE_DS     = 43; // DNSSEC Delegation Signer
const TYPE_RRSIG  = 46; // DNSSEC Signature
const TYPE_DNSKEY = 48; // DNSSEC Key

// ── RCODE number → name ───────────────────────────────────────────────────
const RCODE_NAMES = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
};

// ── OPCODE number → name ──────────────────────────────────────────────────
const OPCODE_NAMES = {
  0: 'QUERY',
  1: 'IQUERY',
  2: 'STATUS',
  4: 'NOTIFY',
  5: 'UPDATE',
};

// ── DNSSEC Algorithm number → name ────────────────────────────────────────
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

// ── Record type number → name ─────────────────────────────────────────────
const TYPE_NAMES = {
  1:  'A',      2:  'NS',    5:  'CNAME', 6:  'SOA',
  12: 'PTR',   15:  'MX',   16:  'TXT',  28:  'AAAA',
  33: 'SRV',   41:  'OPT',  43:  'DS',   46:  'RRSIG', 48: 'DNSKEY',
};

/**
 * Parses a raw DNS response buffer into a structured object.
 *
 * @param {Buffer} buffer - Raw UDP payload from a DNS server
 * @returns {object} Parsed DNS response with header, sections, and DNSSEC presence
 */
function parseDnsResponse(buffer) {
  if (buffer.length < 12) {
    throw new Error(`DNS response too short: ${buffer.length} bytes (min 12)`);
  }

  // ── Header ────────────────────────────────────────────────────────────────
  const id      = buffer.readUInt16BE(0);
  const rawFlags = buffer.readUInt16BE(2);
  const qdcount = buffer.readUInt16BE(4);
  const ancount = buffer.readUInt16BE(6);
  const nscount = buffer.readUInt16BE(8);
  const arcount = buffer.readUInt16BE(10);

  const rcode     = rawFlags & 0x000f;
  const rcodeName = RCODE_NAMES[rcode] || `RCODE${rcode}`;
  const opcode    = (rawFlags & 0x7800) >> 11;
  const opcodeName = OPCODE_NAMES[opcode] || `OPCODE${opcode}`;

  // Collect which flags are set (for display in the UI)
  const flags = [];
  if (rawFlags & FLAG_QR) flags.push('QR');
  if (rawFlags & FLAG_AA) flags.push('AA');
  if (rawFlags & FLAG_TC) flags.push('TC');
  if (rawFlags & FLAG_RD) flags.push('RD');
  if (rawFlags & FLAG_RA) flags.push('RA');
  if (rawFlags & FLAG_AD) flags.push('AD');
  if (rawFlags & FLAG_CD) flags.push('CD');

  let offset = 12;

  // ── Question Section ──────────────────────────────────────────────────────
  const questions = [];
  for (let i = 0; i < qdcount; i++) {
    if (offset >= buffer.length) break;
    const startOffset = offset;
    const [name, next] = parseDomainName(buffer, offset);
    offset = next;
    if (offset + 4 > buffer.length) break;
    const type = buffer.readUInt16BE(offset);
    const cls  = buffer.readUInt16BE(offset + 2);
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

  // ── Resource Record Sections ──────────────────────────────────────────────
  const { records: answers,    nextOffset: o1 } = parseSection(buffer, offset,  ancount);
  const { records: authority,  nextOffset: o2 } = parseSection(buffer, o1,      nscount);
  const { records: additional }                 = parseSection(buffer, o2,      arcount);

  // ── DNSSEC Presence Detection ─────────────────────────────────────────────
  const allRecords = [...answers, ...authority, ...additional];
  const dnssec = {
    rrsigPresent:  allRecords.some(r => r.typeNum === TYPE_RRSIG),
    dnskeyPresent: allRecords.some(r => r.typeNum === TYPE_DNSKEY),
    dsPresent:     allRecords.some(r => r.typeNum === TYPE_DS),
  };
  const dnssecPresent = dnssec.rrsigPresent || dnssec.dnskeyPresent || dnssec.dsPresent;

  // ── Raw Hex String ────────────────────────────────────────────────────────
  const rawHex = [...buffer].map(b => b.toString(16).padStart(2, '0')).join(' ');

  return {
    id,
    flags,
    rawFlags,
    opcode: opcodeName,
    opcodeNum: opcode,
    rcode: rcodeName,
    rcodeNum: rcode,
    qdcount,
    ancount,
    nscount,
    arcount,
    isAuthoritative:  (rawFlags & FLAG_AA) !== 0,
    isTruncated:      (rawFlags & FLAG_TC) !== 0,
    isRecursionAvail: (rawFlags & FLAG_RA) !== 0,
    questions,
    answers,
    authority,
    additional,
    dnssec,
    dnssecPresent,
    rawHex,
  };
}

/**
 * Parses `count` resource records starting at `offset` in `buffer`.
 * Returns the parsed records array and the offset after the last record.
 */
function parseSection(buffer, offset, count) {
  const records = [];

  for (let i = 0; i < count; i++) {
    if (offset >= buffer.length) break;

    const startOffset = offset;
    const [name, afterName] = parseDomainName(buffer, offset);
    offset = afterName;

    if (offset + 10 > buffer.length) break; // not enough bytes for RR fixed fields

    const typeNum  = buffer.readUInt16BE(offset);
    const classNum = buffer.readUInt16BE(offset + 2);
    const ttl      = buffer.readUInt32BE(offset + 4);
    const rdlength = buffer.readUInt16BE(offset + 8);
    offset += 10;

    if (offset + rdlength > buffer.length) break; // defensive check for truncated rdata
    const rdataEnd = offset + rdlength;
    const typeName = TYPE_NAMES[typeNum] || `TYPE${typeNum}`;

    // OPT records (EDNS0) are meta-records — decode fully
    if (typeNum === TYPE_OPT) {
      const extendedRcode = (ttl >> 24) & 0xff;
      const ednsVersion = (ttl >> 16) & 0xff;
      const doBit = (ttl & 0x8000) !== 0;

      // Parse options inside OPT RDATA
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
      name:     name || '.',
      typeNum,
      typeName,
      class:    classNum,
      ttl,
      value,
      startOffset,
      endOffset: offset
    });
  }

  return { records, nextOffset: offset };
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

module.exports = { parseDnsResponse };
