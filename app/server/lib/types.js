module.exports = {
  // Header flag masks
  QR_MASK: 0x8000, // 1 << 15 — response flag
  AA_MASK: 0x0400, // 1 << 10 — authoritative answer
  TC_MASK: 0x0200, // 1 << 9  — truncation
  RD_MASK: 0x0100, // 1 << 8  — recursion desired
  RA_MASK: 0x0080, // 1 << 7  — recursion available

  // Standard record types
  TYPE_A:      1,
  TYPE_NS:     2,
  TYPE_CNAME:  5,
  TYPE_SOA:    6,
  TYPE_PTR:    12,
  TYPE_MX:     15,
  TYPE_TXT:    16,
  TYPE_AAAA:   28,
  TYPE_SRV:    33,

  // DNSSEC + EDNS0 types
  TYPE_OPT:    41,  // EDNS0 pseudo-record (DO flag)
  TYPE_DS:     43,  // Delegation Signer
  TYPE_RRSIG:  46,  // DNSSEC Signature
  TYPE_DNSKEY: 48,  // DNSSEC Key
  TYPE_ANY:    255, // Wildcard query (matches any type)

  CLASS_IN: 1,

  DEFAULT_TTL: 3600,
};
