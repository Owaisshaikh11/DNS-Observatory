const Redis = require('ioredis');

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || '',
  db: Number(process.env.REDIS_DB) || 0,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
};

const redis = new Redis(redisConfig);

redis.on('connect', () => {
  console.log('Connected to Redis');
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});

// Helper functions for Redis operations
const redisHelpers = {
  async setRecord(domain, record, type = 'temp') {
    const domainKey = domain.toLowerCase();
    const recordToStore = { ...record };
    if (type === 'persistent') {
      recordToStore.isPersistent = true;
      delete recordToStore.expires;
    } else if (type === 'temp') {
      recordToStore.isPersistent = false;
      if (!recordToStore.expires && recordToStore.ttl) {
        recordToStore.expires = Date.now() + recordToStore.ttl * 1000;
      }
    }
    await redis.hset('dns:records', domainKey, JSON.stringify(recordToStore));
    return true;
  },

  async getRecord(domain, type = 'temp') {
    const domainKey = domain.toLowerCase();
    const raw = await redis.hget('dns:records', domainKey);
    if (!raw) return null;

    try {
      const record = JSON.parse(raw);
      if (record.expires && Date.now() > record.expires) {
        await redis.hdel('dns:records', domainKey);
        return null;
      }
      return record;
    } catch (err) {
      console.error(`Error parsing record for domain ${domain}:`, err);
      return null;
    }
  },

  async getAllRecords() {
    const rawRecords = await redis.hgetall('dns:records');
    const records = {};
    const expiredDomains = [];
    const now = Date.now();

    for (const [domain, rawStr] of Object.entries(rawRecords)) {
      try {
        const record = JSON.parse(rawStr);
        if (record && record.expires && now > record.expires) {
          expiredDomains.push(domain);
        } else {
          records[domain] = record;
        }
      } catch (err) {
        console.error(`Failed to parse record for domain ${domain}:`, err);
      }
    }

    if (expiredDomains.length > 0) {
      await redis.hdel('dns:records', ...expiredDomains);
    }

    return records;
  },

  async deleteRecord(domain, type = 'temp') {
    const domainKey = domain.toLowerCase();
    if (type === 'all') {
      return (await redis.hdel('dns:records', domainKey)) > 0;
    }

    const raw = await redis.hget('dns:records', domainKey);
    if (!raw) return false;

    try {
      const record = JSON.parse(raw);
      const isRecordPersistent = record.isPersistent || (!record.expires);
      if (type === 'persistent' && isRecordPersistent) {
        return (await redis.hdel('dns:records', domainKey)) > 0;
      } else if (type === 'temp' && !isRecordPersistent) {
        return (await redis.hdel('dns:records', domainKey)) > 0;
      }
    } catch (err) {
      console.error(`Error parsing record in deleteRecord for ${domain}:`, err);
      return (await redis.hdel('dns:records', domainKey)) > 0;
    }
    return false;
  },

  async setTTL(domain, ttl) {
    const domainKey = domain.toLowerCase();
    const raw = await redis.hget('dns:records', domainKey);
    if (raw) {
      try {
        const record = JSON.parse(raw);
        record.ttl = ttl;
        record.expires = Date.now() + ttl * 1000;
        record.isPersistent = false;
        await redis.hset('dns:records', domainKey, JSON.stringify(record));
        return true;
      } catch (err) {
        console.error(`Error in setTTL for domain ${domain}:`, err);
        return false;
      }
    }
    return false;
  }
};

module.exports = {
  redis,
  redisHelpers
}; 
