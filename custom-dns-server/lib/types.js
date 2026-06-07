module.exports = {
  //Flags for header
  QR_MASK: 0x8000, // 1 << 15 – response flag
  AA_MASK: 0x0400, // 1 << 10 – authoritative aanswer
  RD_MASK: 0x0100, // 1 << 8 – recursion esired
  RA_MASK: 0x0080, // 1 << 7 – recursion available

// record types   
  TYPE_A: 1,
  TYPE_NS: 2,
  TYPE_CNAME: 5,
  TYPE_SOA: 6,
  TYPE_MX: 15,
  TYPE_TXT: 16,
  TYPE_AAAA: 28, // partial support for IPv6
  CLASS_IN: 1,

  DEFAULT_TTL: 3600  //time to live in seconds, 
  
};
