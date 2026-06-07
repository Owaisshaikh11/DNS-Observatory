const fs = require("fs");
const path = require("path");

// Mock ioredis in-memory
const mockRedisData = new Map();
jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => {
    return {
      on: jest.fn(),
      hset: jest.fn().mockImplementation(async (key, field, val) => {
        if (!mockRedisData.has(key)) mockRedisData.set(key, new Map());
        mockRedisData.get(key).set(field, val);
        return 1;
      }),
      hget: jest.fn().mockImplementation(async (key, field) => {
        return mockRedisData.get(key)?.get(field) || null;
      }),
      hgetall: jest.fn().mockImplementation(async (key) => {
        const map = mockRedisData.get(key);
        if (!map) return {};
        return Object.fromEntries(map.entries());
      }),
      hdel: jest.fn().mockImplementation(async (key, ...fields) => {
        const map = mockRedisData.get(key);
        if (!map) return 0;
        let count = 0;
        for (const field of fields) {
          if (map.delete(field)) count++;
        }
        return count;
      }),
    };
  });
});

const {
  loadRecords,
  getRecordsSync,
  addRecord,
  removeRecord,
  cache
} = require("../lib/record-manager");
const {
  dynamicSubdomains,
  addDynamicSubdomain,
  cleanupExpiredSubdomains
} = require("../lib/dynamic-records");
const { getRecordsForDomain, isLocalDomain } = require("../lib/dns-resolver");
const { TYPE_A, TYPE_TXT, TYPE_AAAA } = require("../lib/types");

const TEMP_RECORDS_PATH = path.join(__dirname, "temp-dns-records.json");

describe("DNS Resolver & Record Manager", () => {
  const initialRecords = {
    "example.com": {
      "A": "93.184.216.34",
      "AAAA": "2606:2800:220:1:248:1893:25c8:1946"
    },
    "*.wildcard.test": {
      "A": "127.0.0.9"
    }
  };

  beforeAll(async () => {
    // Setup initial records file
    fs.writeFileSync(TEMP_RECORDS_PATH, JSON.stringify(initialRecords, null, 2));
    await loadRecords(TEMP_RECORDS_PATH);
  });

  afterAll(() => {
    // Cleanup records file
    if (fs.existsSync(TEMP_RECORDS_PATH)) {
      fs.unlinkSync(TEMP_RECORDS_PATH);
    }
  });

  beforeEach(() => {
    cache.clear();
    dynamicSubdomains.clear();
    mockRedisData.clear();
  });

  describe("Record loading & retrieval", () => {
    test("should correctly load and return file records", () => {
      const records = getRecordsSync();
      expect(records["example.com"]).toBeDefined();
      expect(records["example.com"].A).toBe("93.184.216.34");
    });

    test("should handle domain name normalization", () => {
      expect(isLocalDomain("EXAMPLE.COM")).toBe(true);
    });
  });

  describe("DNS Resolution", () => {
    test("should resolve A record for static domain", () => {
      const answers = getRecordsForDomain("example.com", TYPE_A);
      expect(answers.length).toBe(1);
      expect(answers[0].data).toBe("93.184.216.34");
      expect(answers[0].type).toBe(TYPE_A);
    });

    test("should resolve AAAA record for static domain", () => {
      const answers = getRecordsForDomain("example.com", TYPE_AAAA);
      expect(answers.length).toBe(1);
      expect(answers[0].data).toBe("2606:2800:220:1:248:1893:25c8:1946");
    });

    test("should return empty answers for non-existing record type", () => {
      const answers = getRecordsForDomain("example.com", TYPE_TXT);
      expect(answers.length).toBe(0);
    });

    test("should resolve wildcard subdomains", () => {
      const answers = getRecordsForDomain("sub.wildcard.test", TYPE_A);
      expect(answers.length).toBe(1);
      expect(answers[0].data).toBe("127.0.0.9");
    });
  });

  describe("Wildcard / Local domain checks", () => {
    test("should verify isLocalDomain correctly", () => {
      expect(isLocalDomain("example.com")).toBe(true);
      expect(isLocalDomain("sub.wildcard.test")).toBe(true);
      expect(isLocalDomain("notlocal.com")).toBe(false);
    });
  });

  describe("Dynamic Subdomains", () => {
    test("should add and resolve persistent dynamic subdomain", async () => {
      const fullDomain = await addDynamicSubdomain("my", "dynamic.test", "192.168.50.50", 300, true);
      expect(fullDomain).toBe("my.dynamic.test");
      
      expect(isLocalDomain("my.dynamic.test")).toBe(true);

      const answers = getRecordsForDomain("my.dynamic.test", TYPE_A);
      expect(answers.length).toBe(1);
      expect(answers[0].data).toBe("192.168.50.50");
    });

    test("should clean up expired subdomains but keep persistent ones", async () => {
      const realDateNow = Date.now;
      let mockTime = Date.now();
      
      // Mock Date.now to control expiration
      global.Date.now = jest.fn(() => mockTime);

      // Add persistent subdomain
      await addDynamicSubdomain("p1", "test.local", "1.1.1.1", 30, true);
      // Add ephemeral subdomain (TTL 10s)
      await addDynamicSubdomain("temp1", "test.local", "2.2.2.2", 10, false);

      expect(dynamicSubdomains.has("p1.test.local")).toBe(true);
      expect(dynamicSubdomains.has("temp1.test.local")).toBe(true);

      // Advance time by 5s (no expiry yet)
      mockTime += 5000;
      await cleanupExpiredSubdomains();
      expect(dynamicSubdomains.has("temp1.test.local")).toBe(true);

      // Advance time by another 6s (total 11s, temp1 should expire)
      mockTime += 6000;
      await cleanupExpiredSubdomains();
      
      expect(dynamicSubdomains.has("p1.test.local")).toBe(true);
      expect(dynamicSubdomains.has("temp1.test.local")).toBe(false);

      // Restore Date.now
      global.Date.now = realDateNow;
    });
  });

  describe("Caching mechanism", () => {
    test("should cache resolution result", () => {
      // Clear resolver cache
      cache.clear();

      // Resolve a domain to populate cache
      getRecordsForDomain("example.com", TYPE_A);
      expect(cache.size).toBe(1);
      expect(cache.has("example.com:1")).toBe(true);

      // Mutate the records in-memory directly to verify result comes from cache
      const records = getRecordsSync();
      const originalValue = records["example.com"];
      records["example.com"] = { A: "10.0.0.1" };

      // Query again - should return cached value (93.184.216.34), not the mutated one
      const answers = getRecordsForDomain("example.com", TYPE_A);
      expect(answers[0].data).toBe("93.184.216.34");

      // Restore
      records["example.com"] = originalValue;
    });
  });
});
