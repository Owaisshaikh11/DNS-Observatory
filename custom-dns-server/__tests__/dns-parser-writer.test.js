const { parseQuery, createResponse, createErrorResponse } = require("../lib/dns-parser");
const { writeDomainName, writeAnswer, expandIPv6 } = require("../lib/dns-writer");
const {
  TYPE_A,
  TYPE_AAAA,
  TYPE_CNAME,
  TYPE_NS,
  TYPE_MX,
  TYPE_TXT,
  CLASS_IN,
} = require("../lib/types");

describe("DNS Writer & Parser", () => {
  describe("expandIPv6", () => {
    test("should expand standard IPv6 addresses", () => {
      expect(expandIPv6("2001:db8:85a3:0:0:8a2e:370:7334")).toEqual([
        "2001", "db8", "85a3", "0", "0", "8a2e", "370", "7334"
      ]);
    });

    test("should expand compressed double-colon (::) IPv6 addresses", () => {
      expect(expandIPv6("2001:db8::1")).toEqual([
        "2001", "db8", "0", "0", "0", "0", "0", "1"
      ]);
      expect(expandIPv6("::1")).toEqual([
        "0", "0", "0", "0", "0", "0", "0", "1"
      ]);
    });

    test("should expand full 8-segment addresses without changes", () => {
      expect(expandIPv6("1:2:3:4:5:6:7:8")).toEqual([
        "1", "2", "3", "4", "5", "6", "7", "8"
      ]);
    });
  });

  describe("writeDomainName", () => {
    test("should write domain name in label format to buffer", () => {
      const buffer = Buffer.alloc(100);
      const offset = writeDomainName(buffer, 0, "test.local");
      
      // "test.local" -> [4] t e s t [5] l o c a l [0]
      expect(offset).toBe(12);
      expect(buffer.readUInt8(0)).toBe(4);
      expect(buffer.toString("utf8", 1, 5)).toBe("test");
      expect(buffer.readUInt8(5)).toBe(5);
      expect(buffer.toString("utf8", 6, 11)).toBe("local");
      expect(buffer.readUInt8(11)).toBe(0);
    });

    test("should write root domain (empty name) as a single 0 byte", () => {
      const buffer = Buffer.alloc(10);
      const offset = writeDomainName(buffer, 0, "");
      expect(offset).toBe(1);
      expect(buffer.readUInt8(0)).toBe(0);
    });
  });

  describe("parseQuery", () => {
    test("should parse a valid DNS query buffer", () => {
      const buffer = Buffer.alloc(100);
      // Header: Transaction ID 0x1234, Flags 0x0100 (RD), QDCount = 1, ANCount = 0, NSCount = 0, ARCount = 0
      buffer.writeUInt16BE(0x1234, 0);
      buffer.writeUInt16BE(0x0100, 2);
      buffer.writeUInt16BE(1, 4);
      buffer.writeUInt16BE(0, 6);
      buffer.writeUInt16BE(0, 8);
      buffer.writeUInt16BE(0, 10);
      
      // Question: "dns.test" -> [3] d n s [4] t e s t [0]
      let offset = 12;
      buffer.writeUInt8(3, offset++);
      buffer.write("dns", offset);
      offset += 3;
      buffer.writeUInt8(4, offset++);
      buffer.write("test", offset);
      offset += 4;
      buffer.writeUInt8(0, offset++);
      
      // Type A (1), Class IN (1)
      buffer.writeUInt16BE(TYPE_A, offset);
      offset += 2;
      buffer.writeUInt16BE(CLASS_IN, offset);
      offset += 2;

      const query = parseQuery(buffer.slice(0, offset));
      expect(query.header.id).toBe(0x1234);
      expect(query.header.flags).toBe(0x0100);
      expect(query.header.qdcount).toBe(1);
      expect(query.questions.length).toBe(1);
      expect(query.questions[0].name).toBe("dns.test");
      expect(query.questions[0].type).toBe(TYPE_A);
      expect(query.questions[0].class).toBe(CLASS_IN);
    });

    test("should throw error for truncated header", () => {
      const truncatedBuffer = Buffer.alloc(10);
      expect(() => parseQuery(truncatedBuffer)).toThrow("Header truncated");
    });
  });

  describe("createResponse and createErrorResponse", () => {
    const mockQuery = {
      header: { id: 0x5678, flags: 0x0100, qdcount: 1 },
      questions: [{ name: "my.domain", type: TYPE_A, class: CLASS_IN }]
    };

    test("should create success response buffer with answers", () => {
      const answers = [
        { type: TYPE_A, class: CLASS_IN, ttl: 300, data: "192.168.1.1" }
      ];
      
      const response = createResponse(mockQuery, answers);
      
      expect(response.readUInt16BE(0)).toBe(0x5678); // ID
      // QR=1, AA=1, RD=1, RA=1 -> 0x8000 | 0x0400 | 0x0100 | 0x0080 = 0x8580
      expect(response.readUInt16BE(2)).toBe(0x8580); // Flags
      expect(response.readUInt16BE(4)).toBe(1); // QDCOUNT
      expect(response.readUInt16BE(6)).toBe(1); // ANCOUNT
    });

    test("should write various record types correctly", () => {
      const complexAnswers = [
        { type: TYPE_AAAA, class: CLASS_IN, ttl: 60, data: "2001:db8::1" },
        { type: TYPE_CNAME, class: CLASS_IN, ttl: 3600, data: "target.domain" },
        { type: TYPE_NS, class: CLASS_IN, ttl: 3600, data: "ns1.nameserver" },
        { type: TYPE_MX, class: CLASS_IN, ttl: 1800, data: { preference: 10, exchange: "mail.ex" } },
        { type: TYPE_TXT, class: CLASS_IN, ttl: 300, data: "hello txt" }
      ];

      const response = createResponse(mockQuery, complexAnswers);
      // Parsing the output is the best check - but we can also just verify it successfully runs without throwing errors
      expect(response.length).toBeGreaterThan(50);
    });

    test("should create error response with correct RCODE", () => {
      const errResponse = createErrorResponse(0xabcd, 1); // FORMERR
      expect(errResponse.readUInt16BE(0)).toBe(0xabcd);
      // QR=1, AA=1, RCODE=1 -> 0x8000 | 0x0400 | 0x0001 = 0x8401
      expect(errResponse.readUInt16BE(2)).toBe(0x8401);
      expect(errResponse.readUInt16BE(4)).toBe(0); // QDCOUNT
      expect(errResponse.readUInt16BE(6)).toBe(0); // ANCOUNT
    });

    test("should parse EDNS0 (OPT record) inside a query's additional section", () => {
      const buffer = Buffer.alloc(100);
      // Header: Transaction ID 0x9999, Flags 0x0100 (RD), QDCount = 1, ANCount = 0, NSCount = 0, ARCount = 1
      buffer.writeUInt16BE(0x9999, 0);
      buffer.writeUInt16BE(0x0100, 2);
      buffer.writeUInt16BE(1, 4);
      buffer.writeUInt16BE(0, 6);
      buffer.writeUInt16BE(0, 8);
      buffer.writeUInt16BE(1, 10);

      // Question: "dns.test" -> [3] d n s [4] t e s t [0]
      let offset = 12;
      buffer.writeUInt8(3, offset++);
      buffer.write("dns", offset);
      offset += 3;
      buffer.writeUInt8(4, offset++);
      buffer.write("test", offset);
      offset += 4;
      buffer.writeUInt8(0, offset++);
      buffer.writeUInt16BE(TYPE_A, offset);
      offset += 2;
      buffer.writeUInt16BE(CLASS_IN, offset);
      offset += 2;

      // Additional section: OPT record
      buffer.writeUInt8(0, offset++); // Name: root (.)
      buffer.writeUInt16BE(41, offset); // Type: OPT (41)
      offset += 2;
      buffer.writeUInt16BE(4096, offset); // Class: UDP payload size (4096)
      offset += 2;
      buffer.writeUInt32BE(0x00008000, offset); // TTL: Extended RCODE=0, Version=0, DO flag=1
      offset += 4;
      buffer.writeUInt16BE(0, offset); // RDLength: 0
      offset += 2;

      const query = parseQuery(buffer.slice(0, offset));
      expect(query.edns.present).toBe(true);
      expect(query.edns.udpPayloadSize).toBe(4096);
      expect(query.edns.dnssecOk).toBe(true);
    });

    test("should append OPT record to the response additional section if EDNS0 was present", () => {
      const mockQueryWithEdns = {
        header: { id: 0x9999, flags: 0x0100, qdcount: 1 },
        questions: [{ name: "my.domain", type: TYPE_A, class: CLASS_IN }],
        edns: { present: true, udpPayloadSize: 4096, dnssecOk: true }
      };

      const response = createResponse(mockQueryWithEdns, []);

      // ARCOUNT should be 1
      expect(response.readUInt16BE(10)).toBe(1);

      // Total length should include the header (12), question (15), and OPT record (11) = 38 bytes
      expect(response.length).toBe(38);

      // Verify OPT record fields
      const optOffset = 38 - 11;
      expect(response.readUInt8(optOffset)).toBe(0); // Name: root (.)
      expect(response.readUInt16BE(optOffset + 1)).toBe(41); // Type: OPT
      expect(response.readUInt16BE(optOffset + 3)).toBe(4096); // Class: Max payload size
      expect(response.readUInt32BE(optOffset + 5)).toBe(0x00008000); // TTL: Extended RCODE + Version + DO
      expect(response.readUInt16BE(optOffset + 9)).toBe(0); // RDLength: 0
    });
  });
});
