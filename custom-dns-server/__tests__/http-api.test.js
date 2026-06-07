const fs = require("fs");
const path = require("path");
const request = require("supertest");

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

const { startHttpApi } = require("../api/http-api");
const { loadRecords } = require("../lib/record-manager");
const { dynamicSubdomains } = require("../lib/dynamic-records");

const TEMP_RECORDS_PATH = path.join(__dirname, "temp-api-records.json");

describe("HTTP REST API", () => {
  let apiServer;

  beforeAll(async () => {
    // Create an isolated DNS records config file for testing
    fs.writeFileSync(TEMP_RECORDS_PATH, JSON.stringify({
      "static.test": {
        "A": "10.10.10.10"
      }
    }, null, 2));
    await loadRecords(TEMP_RECORDS_PATH);

    // Start API on an alternative port
    apiServer = startHttpApi(8055);
  });

  afterAll((done) => {
    apiServer.close(() => {
      if (fs.existsSync(TEMP_RECORDS_PATH)) {
        fs.unlinkSync(TEMP_RECORDS_PATH);
      }
      done();
    });
  });

  beforeEach(() => {
    dynamicSubdomains.clear();
    mockRedisData.clear();
  });

  describe("GET /api/dns/subdomains", () => {
    test("should return empty subdomain list initially", async () => {
      const response = await request(apiServer)
        .get("/api/dns/subdomains")
        .expect(200);

      expect(response.body).toEqual({ subdomains: [] });
    });
  });

  describe("POST /api/dns/subdomains", () => {
    test("should add a new dynamic subdomain", async () => {
      const response = await request(apiServer)
        .post("/api/dns/subdomains")
        .send({
          subdomain: "myapi",
          domain: "static.test",
          ipAddress: "192.168.10.20",
          ttl: 300,
          isPersistent: true
        })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        domain: "myapi.static.test",
        isPersistent: true
      });

      // Verify it's added in memory
      expect(dynamicSubdomains.has("myapi.static.test")).toBe(true);
    });

    test("should reject request with missing fields", async () => {
      const response = await request(apiServer)
        .post("/api/dns/subdomains")
        .send({
          subdomain: "myapi",
          // missing domain and ipAddress
        })
        .expect(400);

      expect(response.body.error).toBe("Missing required fields");
    });

    test("should reject request with invalid IP version", async () => {
      const response = await request(apiServer)
        .post("/api/dns/subdomains")
        .send({
          subdomain: "myapi",
          domain: "static.test",
          ipAddress: "2001:db8::1", // IPv6 is not supported for dynamic subdomains
          ttl: 300
        })
        .expect(400);

      expect(response.body.error).toBe("Dynamic subdomains currently support IPv4 addresses only");
    });

    test("should reject non-persistent subdomain with invalid TTL", async () => {
      const response = await request(apiServer)
        .post("/api/dns/subdomains")
        .send({
          subdomain: "myapi",
          domain: "static.test",
          ipAddress: "1.1.1.1",
          ttl: -50,
          isPersistent: false
        })
        .expect(400);

      expect(response.body.error).toBe("TTL must be a positive integer");
    });
  });

  describe("DELETE /api/dns/subdomains", () => {
    test("should delete an existing dynamic subdomain and return 200", async () => {
      // First add a subdomain
      await request(apiServer)
        .post("/api/dns/subdomains")
        .send({
          subdomain: "todelete",
          domain: "static.test",
          ipAddress: "1.1.1.1",
          isPersistent: true
        })
        .expect(200);

      // Now delete it
      const deleteResponse = await request(apiServer)
        .delete("/api/dns/subdomains")
        .send({
          subdomain: "todelete",
          domain: "static.test"
        })
        .expect(200);

      expect(deleteResponse.body).toEqual({ success: true });
      expect(dynamicSubdomains.has("todelete.static.test")).toBe(false);
    });

    test("should return 404 when deleting a non-existent subdomain", async () => {
      const response = await request(apiServer)
        .delete("/api/dns/subdomains")
        .send({
          subdomain: "nonexistent",
          domain: "static.test"
        })
        .expect(404);

      expect(response.body).toEqual({ success: false });
    });
  });

  describe("GET /api/dns/records", () => {
    test("should return merged records list", async () => {
      // Add a dynamic subdomain first
      await request(apiServer)
        .post("/api/dns/subdomains")
        .send({
          subdomain: "active",
          domain: "static.test",
          ipAddress: "2.2.2.2",
          isPersistent: true
        })
        .expect(200);

      const response = await request(apiServer)
        .get("/api/dns/records")
        .expect(200);

      // Should contain the static record and the added dynamic record
      expect(response.body["static.test"]).toBeDefined();
      expect(response.body["active.static.test"]).toBeDefined();
      expect(response.body["active.static.test"].value).toBe("2.2.2.2");
    });
  });
});
