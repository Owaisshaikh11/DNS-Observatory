const { getRecordsSync, cache, removeLocalRecord } = require("./record-manager");
const {
  TYPE_A,
  TYPE_AAAA,
  TYPE_CNAME,
  TYPE_NS,
  TYPE_MX,
  TYPE_TXT,
  CLASS_IN,
  DEFAULT_TTL,
  TYPE_ANY,
} = require("./types");
const { dynamicSubdomains } = require("./dynamic-records");

function getRecordsForDomain(domain, type) {
  const answers = [];
  const records = getRecordsSync();
  const domainLower = domain.toLowerCase();

  if (dynamicSubdomains.has(domainLower)) {
    // checking if the domain is in dynamic subdomains
    const data = dynamicSubdomains.get(domainLower);
    const isValidDynamicRecord = data.isPersistent || Date.now() < data.expires;
    if (isValidDynamicRecord) {
      // ensures the subdomain is not expired based on timestamp
      if (type === TYPE_A || type === TYPE_ANY) {
        answers.push({
          type: TYPE_A,
          class: CLASS_IN,
          ttl: data.isPersistent
            ? DEFAULT_TTL
            : Math.max(1, Math.floor((data.expires - Date.now()) / 1000)),
          data: data.ipAddress,
        });
        return answers;
      }
    } else {
      dynamicSubdomains.delete(domainLower); // deleting from memory if expired
      removeLocalRecord(domainLower);
    }
  }

  // Checking if cached records
  const cacheKey = `${domainLower}:${type}`;
  if (cache.has(cacheKey)) {
    const entry = cache.get(cacheKey);
    if (Date.now() < entry.expires) return entry.records;
    cache.delete(cacheKey);
  }

  // formats the record to be pushed to the answers array
  const add = (record, typeId, formatter = (x) => x) => {
    if (Array.isArray(record)) {
      record.forEach((data) =>
        answers.push({
          type: typeId,
          class: CLASS_IN,
          ttl: DEFAULT_TTL,
          data: formatter(data),
        })
      );
    } else if (record) {
      answers.push({
        type: typeId,
        class: CLASS_IN,
        ttl: DEFAULT_TTL,
        data: formatter(record),
      });
    }
  };

  // Hierarchical wildcard and direct match logic
  let match = records[domainLower];
  if (!match) {
    const labels = domainLower.split(".");
    for (let i = 1; i < labels.length; i++) {
      const parentDomain = labels.slice(i).join(".");
      const wildcardPattern = `*.${parentDomain}`;
      if (records[wildcardPattern]) {
        match = records[wildcardPattern];
        break;
      }
    }
  }

  if (match) {
    if (match.expires && Date.now() > match.expires) {
      removeLocalRecord(domainLower);
      return answers;
    }

    // Check if this is a dynamic/added single-record format
    if (match.type && match.value !== undefined) {
      const typeMap = {
        'A': TYPE_A,
        'AAAA': TYPE_AAAA,
        'CNAME': TYPE_CNAME,
        'NS': TYPE_NS,
        'MX': TYPE_MX,
        'TXT': TYPE_TXT
      };

      const recordTypeNum = typeof match.type === 'number'
        ? match.type
        : typeMap[match.type.toUpperCase()];

      if (recordTypeNum && (type === TYPE_ANY || type === recordTypeNum)) {
        answers.push({
          type: recordTypeNum,
          class: CLASS_IN,
          ttl: match.ttl || DEFAULT_TTL,
          data: match.value
        });
      }
    } else {
      // Static multi-record array format
      if (type === TYPE_ANY || type === TYPE_A) add(match.A, TYPE_A);
      if (type === TYPE_ANY || type === TYPE_AAAA) add(match.AAAA, TYPE_AAAA);
      if (type === TYPE_ANY || type === TYPE_CNAME) add(match.CNAME, TYPE_CNAME);
      if (type === TYPE_ANY || type === TYPE_NS) add(match.NS, TYPE_NS);
      if (type === TYPE_ANY || type === TYPE_MX) add(match.MX, TYPE_MX);
      if (type === TYPE_ANY || type === TYPE_TXT) add(match.TXT, TYPE_TXT);
    }
  }

  // Storing the records in cache with expiry timestamp if answers exist
  if (answers.length > 0) {
    cache.set(cacheKey, {
      records: [...answers],
      expires: Date.now() + DEFAULT_TTL * 1000,
    });
  }

  return answers;
}

function isLocalDomain(domain) {
  if (!domain) return false;
  const domainLower = domain.toLowerCase();
  if (dynamicSubdomains.has(domainLower)) {
    return true;
  }
  const records = getRecordsSync();
  let match = records[domainLower];
  if (!match) {
    const labels = domainLower.split(".");
    for (let i = 1; i < labels.length; i++) {
      const parentDomain = labels.slice(i).join(".");
      const wildcardPattern = `*.${parentDomain}`;
      if (records[wildcardPattern]) {
        match = records[wildcardPattern];
        break;
      }
    }
  }
  return !!match;
}

module.exports = {
  getRecordsForDomain,
  isLocalDomain,
};
