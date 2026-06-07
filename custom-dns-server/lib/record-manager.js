const fs = require("fs");
const { redisHelpers } = require("../config/redis-config");

const cache = new Map();
let fileRecords = {};
let records = {};

function normalizeDomainName(domain) {
  return String(domain || "").trim().toLowerCase().replace(/\.+$/, "");
}

function normalizeRecordMap(recordMap = {}) {
  return Object.fromEntries(
    Object.entries(recordMap).map(([domain, record]) => [
      normalizeDomainName(domain),
      record,
    ])
  );
}

function clearCacheForDomain(domain) {
  const domainLower = normalizeDomainName(domain);
  if (!domainLower || domainLower.startsWith("*.")) {
    cache.clear();
    return;
  }

  for (const key of cache.keys()) {
    if (key.startsWith(`${domainLower}:`)) {
      cache.delete(key);
    }
  }
}

function setLocalRecord(domain, record) {
  const domainLower = normalizeDomainName(domain);
  records[domainLower] = record;
  clearCacheForDomain(domainLower);
}

function removeLocalRecord(domain) {
  const domainLower = normalizeDomainName(domain);
  const existed = Object.prototype.hasOwnProperty.call(records, domainLower);
  delete records[domainLower];
  clearCacheForDomain(domainLower);
  return existed;
}

async function loadRecords(filePath) {
  let loadedFileRecords = {};
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    loadedFileRecords = normalizeRecordMap(JSON.parse(raw));
    console.log(`Loaded DNS records from ${filePath}`);
  } catch (err) {
    if (err.code === "ENOENT") {
      fs.writeFileSync(filePath, JSON.stringify(loadedFileRecords, null, 2));
      console.log(`Created default records at ${filePath}`);
    } else {
      console.error(`Error loading records: ${err.message}`);
    }
  }

  fileRecords = loadedFileRecords;
  records = { ...fileRecords };
  cache.clear();

  try {
    const redisRecords = await redisHelpers.getAllRecords();
    const normalizedRedisRecords = normalizeRecordMap(redisRecords);

    for (const [domain, record] of Object.entries(fileRecords)) {
      if (!Object.prototype.hasOwnProperty.call(normalizedRedisRecords, domain)) {
        await redisHelpers.setRecord(domain, record, "persistent");
      }
    }

    records = { ...fileRecords, ...normalizedRedisRecords };
    console.log("Loaded DNS records from file and Redis");
  } catch (err) {
    console.error(`Failed to load records from Redis: ${err.message}. Using file records only.`);
  }
}

async function saveRecords(filePath) {
  try {
    const persistentRecords = {};
    // Save to Redis
    for (const [domain, record] of Object.entries(records)) {
      const isRecordPersistent = record.isPersistent !== false && (!record.expires || record.isPersistent === true);
      if (isRecordPersistent) {
        await redisHelpers.setRecord(domain, record, 'persistent');
        persistentRecords[domain] = record;
      }
    }

    // Backup to file (only persistent records)
    fs.writeFileSync(filePath, JSON.stringify(persistentRecords, null, 2));
    console.log(`Saved DNS records to Redis and backed up to ${filePath}`);
  } catch (err) {
    console.error(`Error saving records: ${err.message}`);
  }
}

async function getRecords() {
  try {
    // Refresh records from Redis if online
    const redisRecords = normalizeRecordMap(await redisHelpers.getAllRecords());
    records = { ...fileRecords, ...redisRecords };
  } catch (err) {
    console.error(`Error retrieving records from Redis: ${err.message}. Using local cache.`);
  }
  return records;
}

function getRecordsSync() {
  return records;
}

async function addRecord(domain, record) {
  const domainLower = normalizeDomainName(domain);
  setLocalRecord(domainLower, record);
  try {
    await redisHelpers.setRecord(domainLower, record);
    if (record.ttl) {
      await redisHelpers.setTTL(domainLower, record.ttl);
    }
  } catch (err) {
    console.error(`Failed to add record to Redis: ${err.message}`);
  }
}

async function removeRecord(domain, type = "temp") {
  const domainLower = normalizeDomainName(domain);
  const removedLocal = removeLocalRecord(domainLower);
  let removedRedis = false;
  try {
    removedRedis = await redisHelpers.deleteRecord(domainLower, type);
  } catch (err) {
    console.error(`Failed to delete record from Redis: ${err.message}`);
  }
  return removedLocal || removedRedis;
}

module.exports = {
  cache,
  clearCacheForDomain,
  loadRecords,
  saveRecords,
  getRecords,
  getRecordsSync,
  normalizeDomainName,
  addRecord,
  removeRecord,
  setLocalRecord,
  removeLocalRecord
};
