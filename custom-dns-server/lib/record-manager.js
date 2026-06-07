const fs = require("fs");

// In-memory record stores
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

function loadRecords(filePath) {
  let loaded = {};
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    loaded = normalizeRecordMap(JSON.parse(raw));
    console.log(`Loaded DNS records from ${filePath}`);
  } catch (err) {
    if (err.code === "ENOENT") {
      fs.writeFileSync(filePath, JSON.stringify(loaded, null, 2));
      console.log(`Created default records at ${filePath}`);
    } else {
      console.error(`Error loading records: ${err.message}`);
    }
  }
  fileRecords = loaded;
  records = { ...fileRecords };
  cache.clear();
}

function saveRecords(filePath) {
  try {
    const persistentRecords = {};
    for (const [domain, record] of Object.entries(records)) {
      const isPersistent =
        record.isPersistent !== false &&
        (!record.expires || record.isPersistent === true);
      if (isPersistent) {
        persistentRecords[domain] = record;
      }
    }
    fs.writeFileSync(filePath, JSON.stringify(persistentRecords, null, 2));
    console.log(`Saved DNS records to ${filePath}`);
  } catch (err) {
    console.error(`Error saving records: ${err.message}`);
  }
}

function getRecords() {
  return records;
}

function getRecordsSync() {
  return records;
}

function addRecord(domain, record) {
  const domainLower = normalizeDomainName(domain);
  setLocalRecord(domainLower, record);
}

function removeRecord(domain) {
  const domainLower = normalizeDomainName(domain);
  return removeLocalRecord(domainLower);
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
  removeLocalRecord,
};
