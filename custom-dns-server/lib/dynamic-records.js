const { DEFAULT_TTL } = require("./types");
const {
  normalizeDomainName,
  removeLocalRecord,
  setLocalRecord,
} = require("./record-manager");

// In-memory store for live dynamic subdomains (sub.domain → metadata)
const dynamicSubdomains = new Map();

// No-op on startup — dynamic records are ephemeral and live only in memory
function loadDynamicSubdomains() {
  dynamicSubdomains.clear();
  console.log("Dynamic subdomains initialized (in-memory only)");
}

// Registers a new dynamic A record for sub.domain pointing to ip
function addDynamicSubdomain(sub, domain, ip, ttl = DEFAULT_TTL, isPersistent = false) {
  const full = normalizeDomainName(`${sub}.${domain}`);
  const ttlSeconds =
    isPersistent || !Number.isInteger(ttl) || ttl <= 0 ? DEFAULT_TTL : ttl;
  const expires = isPersistent ? null : Date.now() + ttlSeconds * 1000;

  const record = {
    type: "A",
    value: ip,
    ttl: isPersistent ? null : ttlSeconds,
    expires,
    isDynamic: true,
    isPersistent,
  };

  dynamicSubdomains.set(full, { ipAddress: ip, expires, isPersistent });
  setLocalRecord(full, record);

  return full;
}

// Removes a dynamic subdomain from memory and the local record store
function removeDynamicSubdomain(sub, domain) {
  const full = normalizeDomainName(`${sub}.${domain}`);
  const removed = dynamicSubdomains.delete(full);
  const removedLocal = removeLocalRecord(full);
  return removed || removedLocal;
}

// Purges expired entries from the in-memory map
function cleanupExpiredSubdomains() {
  const now = Date.now();
  for (const [key, val] of dynamicSubdomains.entries()) {
    if (!val.isPersistent && now > val.expires) {
      dynamicSubdomains.delete(key);
      removeLocalRecord(key);
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
