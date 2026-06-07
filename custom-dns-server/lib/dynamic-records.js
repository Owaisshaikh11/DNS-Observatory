const { DEFAULT_TTL } = require("./types");
const { redisHelpers } = require("../config/redis-config");
const {
  normalizeDomainName,
  removeLocalRecord,
  setLocalRecord,
} = require("./record-manager");

const dynamicSubdomains = new Map(); // Map to store live dynamic subdomains

// Load dynamic subdomains from Redis on startup
async function loadDynamicSubdomains() {
  try {
    dynamicSubdomains.clear();
    const records = await redisHelpers.getAllRecords();
    for (const [domain, record] of Object.entries(records)) {
      if (record.isDynamic) {
        dynamicSubdomains.set(normalizeDomainName(domain), {
          ipAddress: record.value,
          expires: record.expires,
          isPersistent: record.isPersistent
        });
      }
    }
    console.log('Loaded dynamic subdomains from Redis');
  } catch (error) {
    console.error('Error loading dynamic subdomains:', error);
  }
}

// combines sub and domain to create into full domain name
async function addDynamicSubdomain(sub, domain, ip, ttl = DEFAULT_TTL, isPersistent = false) {
  const full = normalizeDomainName(`${sub}.${domain}`);
  const ttlValue = Number(ttl);
  const ttlSeconds = isPersistent || !Number.isInteger(ttlValue) || ttlValue <= 0
    ? DEFAULT_TTL
    : ttlValue;
  const expires = isPersistent ? null : Date.now() + ttlSeconds * 1000;
  const record = {
    type: 'A',
    value: ip,
    ttl: isPersistent ? null : ttlSeconds,
    expires: expires,
    isDynamic: true,
    isPersistent: isPersistent
  };
  
  // Store in memory
  dynamicSubdomains.set(full, {
    ipAddress: ip,
    expires: expires,
    isPersistent: isPersistent
  });

  // Store in Redis
  await redisHelpers.setRecord(full, record, isPersistent ? 'persistent' : 'temp');
  setLocalRecord(full, record);

  return full;
}

async function removeDynamicSubdomain(sub, domain, type = 'all') {
  const full = normalizeDomainName(`${sub}.${domain}`);
  const removed = dynamicSubdomains.delete(full);
  const removedLocal = removeLocalRecord(full);
  const removedRedis = await redisHelpers.deleteRecord(full, type);
  
  return removed || removedLocal || removedRedis;
}

async function cleanupExpiredSubdomains() {
  const now = Date.now();
  for (const [key, val] of dynamicSubdomains.entries()) {
    if (!val.isPersistent && now > val.expires) {
      dynamicSubdomains.delete(key);
      removeLocalRecord(key);
      // Remove from Redis
      await redisHelpers.deleteRecord(key, 'temp');
    }
  }
}

module.exports = {
  dynamicSubdomains,
  loadDynamicSubdomains,
  addDynamicSubdomain,
  removeDynamicSubdomain,
  cleanupExpiredSubdomains,
};
