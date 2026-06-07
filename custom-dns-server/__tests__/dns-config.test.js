const fs = require("fs");
const path = require("path");

// Mock ioredis in-memory for the record-manager tests
jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => {
    return {
      on: jest.fn(),
      hset: jest.fn().mockImplementation(async () => 1),
      hget: jest.fn().mockImplementation(async () => null),
      hgetall: jest.fn().mockImplementation(async () => ({})),
      hdel: jest.fn().mockImplementation(async () => 0),
    };
  });
});

describe("dnsConfig dynamic options and parsing", () => {
  beforeEach(() => {
    // Save original env values
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.DNS_FORWARD_ENABLED;
    delete process.env.DNS_UPSTREAM_SERVERS;
    delete process.env.DNS_FORWARD_TIMEOUT;
  });

  test("should dynamically load forwardEnabled from env", () => {
    process.env.DNS_FORWARD_ENABLED = "true";
    let { dnsConfig } = require("../config/dns-config");
    expect(dnsConfig.forwardEnabled).toBe(true);

    jest.resetModules();
    process.env.DNS_FORWARD_ENABLED = "false";
    ({ dnsConfig } = require("../config/dns-config"));
    expect(dnsConfig.forwardEnabled).toBe(false);

    jest.resetModules();
    delete process.env.DNS_FORWARD_ENABLED;
    ({ dnsConfig } = require("../config/dns-config"));
    expect(dnsConfig.forwardEnabled).toBe(false); // default to false
  });

  test("should dynamically load forwardTimeout from env", () => {
    process.env.DNS_FORWARD_TIMEOUT = "5000";
    let { dnsConfig } = require("../config/dns-config");
    expect(dnsConfig.forwardTimeout).toBe(5000);

    jest.resetModules();
    delete process.env.DNS_FORWARD_TIMEOUT;
    ({ dnsConfig } = require("../config/dns-config"));
    expect(dnsConfig.forwardTimeout).toBe(2000); // default
  });

  test("should parse upstream servers correctly", () => {
    // 1. Bare IPv4
    // 2. IPv4 with port
    // 3. Bare IPv6
    // 4. Bracketed IPv6 without port
    // 5. Bracketed IPv6 with port
    process.env.DNS_UPSTREAM_SERVERS = "1.1.1.1,2.2.2.2:5353,2001:db8::1,[2001:db8::2],[2001:db8::3]:5354";
    let { dnsConfig } = require("../config/dns-config");
    
    expect(dnsConfig.upstreamServers).toEqual([
      { host: "1.1.1.1", port: 53 },
      { host: "2.2.2.2", port: 5353 },
      { host: "2001:db8::1", port: 53 },
      { host: "2001:db8::2", port: 53 },
      { host: "2001:db8::3", port: 5354 }
    ]);
  });
});

describe("saveRecords ephemeral record skipping", () => {
  const { saveRecords, loadRecords, setLocalRecord } = require("../lib/record-manager");

  const TEMP_RECORDS_PATH = path.join(__dirname, "temp-save-records.json");

  beforeAll(async () => {
    // Setup clean JSON
    fs.writeFileSync(TEMP_RECORDS_PATH, JSON.stringify({}));
    await loadRecords(TEMP_RECORDS_PATH);
  });

  afterAll(() => {
    if (fs.existsSync(TEMP_RECORDS_PATH)) {
      fs.unlinkSync(TEMP_RECORDS_PATH);
    }
  });

  test("should save only persistent records to file backup and skip ephemeral", async () => {
    // Add a persistent record to record-manager local state
    setLocalRecord("persistent.test", {
      type: "A",
      value: "10.0.0.1",
      isPersistent: true
    });

    // Add an ephemeral record to record-manager local state
    setLocalRecord("ephemeral.test", {
      type: "A",
      value: "10.0.0.2",
      isPersistent: false,
      expires: Date.now() + 60000
    });

    // Save
    await saveRecords(TEMP_RECORDS_PATH);

    // Read back file content to check what was saved
    const raw = fs.readFileSync(TEMP_RECORDS_PATH, "utf8");
    const parsed = JSON.parse(raw);

    // Should contain persistent.test but NOT ephemeral.test
    expect(parsed["persistent.test"]).toBeDefined();
    expect(parsed["ephemeral.test"]).toBeUndefined();
  });
});
