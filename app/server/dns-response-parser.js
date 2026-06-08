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
const TYPE_MX     = 15;
const TYPE_TXT    = 16;
const TYPE_AAAA   = 28;
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
    const [name, next] = parseDomainName(buffer, offset);
    offset = next;
    const type = buffer.readUInt16BE(offset);
    const cls  = buffer.readUInt16BE(offset + 2);
    offset += 4;
    questions.push({ name, type, typeName: TYPE_NAMES[type] || `TYPE${type}`, class: cls });
  }

  // ── Resource Record Sections ──────────────────────────────────────────────
  const { records: answers,    nextOffset: o1 } = parseSection(buffer, offset,  ancount);
  const { records: authority,  nextOffset: o2 } = parseSection(buffer, o1,      nscount);
  const { records: additional, nextOffset: o3 } = parseSection(buffer, o2,      arcount);

  // ── DNSSEC Presence Detection ─────────────────────────────────────────────
  // We don't validate signatures — we just check whether RRSIG/DNSKEY/DS
  // records are present in any section.
  const allRecords = [...answers, ...authority, ...additional];
  const dnssec = {
    rrsigPresent:  allRecords.some(r => r.typeNum === TYPE_RRSIG),
    dnskeyPresent: allRecords.some(r => r.typeNum === TYPE_DNSKEY),
    dsPresent:     allRecords.some(r => r.typeNum === TYPE_DS),
  };
  const dnssecPresent = dnssec.rrsigPresent || dnssec.dnskeyPresent || dnssec.dsPresent;

  // ── Raw Hex String ────────────────────────────────────────────────────────
  // The hex viewer in the UI highlights the TX ID (bytes 0–1) and flags (bytes 2–3).
  const rawHex = [...buffer].map(b => b.toString(16).padStart(2, '0')).join(' ');

  return {
    id,
    flags,
    rcode: rcodeName,
    rcodeNum: rcode,
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

    const [name, afterName] = parseDomainName(buffer, offset);
    offset = afterName;

    if (offset + 10 > buffer.length) break; // not enough bytes for RR fixed fields

    const typeNum  = buffer.readUInt16BE(offset);
    const classNum = buffer.readUInt16BE(offset + 2);
    const ttl      = buffer.readUInt32BE(offset + 4);
    const rdlength = buffer.readUInt16BE(offset + 8);
    offset += 10;

    const rdataEnd = offset + rdlength;
    const typeName = TYPE_NAMES[typeNum] || `TYPE${typeNum}`;

    // OPT records (EDNS0) are meta-records — include them as a marker but
    // don't try to parse them as normal resource records.
    if (typeNum === TYPE_OPT) {
      offset = rdataEnd;
      records.push({ name: '<OPT>', typeNum, typeName: 'OPT', class: classNum, ttl, value: null });
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
    });
  }

  return { records, nextOffset: offset };
}

/**
 * Parses the RDATA portion of a resource record based on its type.
 * Returns a human-readable value (string or object).
 */
function parseRdata(buffer, offset, type, length) {
  switch (type) {
    // ── A: 4-byte IPv4 address ──────────────────────────────────────────────
    case TYPE_A: {
      if (length !== 4) return `<invalid A length: ${length}>`;
      return `${buffer[offset]}.${buffer[offset+1]}.${buffer[offset+2]}.${buffer[offset+3]}`;
    }

    // ── AAAA: 16-byte IPv6 address ──────────────────────────────────────────
    case TYPE_AAAA: {
      if (length !== 16) return `<invalid AAAA length: ${length}>`;
      const groups = [];
      for (let i = 0; i < 8; i++) {
        groups.push(buffer.readUInt16BE(offset + i * 2).toString(16));
      }
      return groups.join(':');
    }

    // ── NS / CNAME: compressed domain name ─────────────────────────────────
    case TYPE_NS:
    case TYPE_CNAME: {
      const [name] = parseDomainName(buffer, offset);
      return name;
    }

    // ── SOA: two domain names + five 32-bit integers ────────────────────────
    case TYPE_SOA: {
      const [mname, afterMname] = parseDomainName(buffer, offset);
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
      const preference = buffer.readUInt16BE(offset);
      const [exchange] = parseDomainName(buffer, offset + 2);
      return { preference, exchange };
    }

    // ── TXT: one or more length-prefixed character strings ──────────────────
    case TYPE_TXT: {
      const strings = [];
      let pos = offset;
      const end = offset + length;
      while (pos < end) {
        const len = buffer.readUInt8(pos++);
        if (pos + len > buffer.length) break;
        strings.push(buffer.slice(pos, pos + len).toString('utf8'));
        pos += len;
      }
      return strings.join(' ');
    }

    // ── DS: Delegation Signer (DNSSEC) ──────────────────────────────────────
    case TYPE_DS: {
      if (length < 4) return null;
      return {
        keyTag:     buffer.readUInt16BE(offset),
        algorithm:  buffer.readUInt8(offset + 2),
        digestType: buffer.readUInt8(offset + 3),
        digest:     buffer.slice(offset + 4, offset + length).toString('hex'),
      };
    }

    // ── DNSKEY: DNSSEC public key ────────────────────────────────────────────
    case TYPE_DNSKEY: {
      if (length < 4) return null;
      return {
        flags:     buffer.readUInt16BE(offset),
        protocol:  buffer.readUInt8(offset + 2),
        algorithm: buffer.readUInt8(offset + 3),
        // We don't decode the key material itself — just confirm it's there
        keyLength: length - 4,
      };
    }

    // ── RRSIG: DNSSEC Signature ──────────────────────────────────────────────
    case TYPE_RRSIG: {
      if (length < 18) return null;
      const typeCovered = buffer.readUInt16BE(offset);
      const [signerName] = parseDomainName(buffer, offset + 18);
      return {
        typeCovered: TYPE_NAMES[typeCovered] || `TYPE${typeCovered}`,
        algorithm:   buffer.readUInt8(offset + 2),
        labels:      buffer.readUInt8(offset + 3),
        origTtl:     buffer.readUInt32BE(offset + 4),
        expiration:  buffer.readUInt32BE(offset + 8),
        inception:   buffer.readUInt32BE(offset + 12),
        keyTag:      buffer.readUInt16BE(offset + 16),
        signerName,
      };
    }

    default:
      return `<${length} bytes of type ${type}>`;
  }
}

module.exports = { parseDnsResponse };
