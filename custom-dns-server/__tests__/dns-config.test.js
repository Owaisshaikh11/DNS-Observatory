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
}, { virtual: true });

describe("dnsConfig dynamic options and parsing", () => {
  test("should load forwardEnabled as true by default", () => {
    let { dnsConfig } = require("../config/dns-config");
    expect(dnsConfig.forwardEnabled).toBe(true);
  });

  test("should load forwardTimeout as 2000ms by default", () => {
    let { dnsConfig } = require("../config/dns-config");
    expect(dnsConfig.forwardTimeout).toBe(2000);
  });

  test("should use standard public DNS server defaults", () => {
    let { dnsConfig } = require("../config/dns-config");
    expect(dnsConfig.upstreamServers).toEqual([
      { host: "8.8.8.8", port: 53 },
      { host: "8.8.4.4", port: 53 }
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
