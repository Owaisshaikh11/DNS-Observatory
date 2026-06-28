/**
 * dns-cache.js — Memory Cache Engine
 *
 * Implements an in-memory caching system for DNS Observatory resolvers.
 * Respects DNS TTL records, supports negative caching of NXDOMAINs,
 * and handles normalized domain/type key matching.
 */

class DnsCache {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Generates a normalized cache key.
   * e.g., "GOOGLE.COM" and "A" -> "google.com:A"
   *
   * @param {string} domain
   * @param {string} type
   * @returns {string}
   */
  _buildKey(domain, type) {
    const cleanDomain = String(domain || '').trim().toLowerCase().replace(/\.$/, '');
    const cleanType = String(type || 'A').toUpperCase().trim();
    return `${cleanDomain}:${cleanType}`;
  }

  /**
   * Retrieves active cached answers. Evicts key lazily if expired.
   *
   * @param {string} domain
   * @param {string} type
   * @returns {object|null} { answers, status } or null
   */
  get(domain, type) {
    const key = this._buildKey(domain, type);
    const entry = this.cache.get(key);

    if (!entry) return null;

    const now = Date.now();
    if (now >= entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Refresh position for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);

    const timeElapsedSec = Math.floor((now - entry.cachedAt) / 1000);
    const adjustedAnswers = entry.answers.map(ans => {
      const remaining = Math.max(0, ans.ttl - timeElapsedSec);
      return { ...ans, ttl: remaining };
    });

    return {
      answers: adjustedAnswers,
      status: entry.status || 'NOERROR'
    };
  }

  /**
   * Caches a resolved DNS query.
   * Calculates absolute expiration using the minimum TTL.
   *
   * @param {string} domain
   * @param {string} type
   * @param {Array} answers
   * @param {string} status - 'NOERROR' or 'NXDOMAIN'
   */
  set(domain, type, answers = [], status = 'NOERROR') {
    const key = this._buildKey(domain, type);

    // Calculate minimum TTL in seconds
    let originalTtl = 60; // 60s default for negative caching or empty answers

    if (status === 'NOERROR' && Array.isArray(answers) && answers.length > 0) {
      const ttls = answers
        .map(a => typeof a.ttl === 'number' ? a.ttl : 0)
        .filter(ttl => ttl > 0);
      if (ttls.length > 0) {
        originalTtl = Math.min(...ttls);
      }
    }

    // Ensure we have a sensible lower bound for visibility (minimum 5s)
    if (originalTtl < 5) {
      originalTtl = 5;
    }

    // LRU Eviction: Limit size to 500 entries
    if (!this.cache.has(key) && this.cache.size >= 500) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    const expiresAt = Date.now() + originalTtl * 1000;

    this.cache.set(key, {
      answers,
      originalTtl,
      expiresAt,
      cachedAt: Date.now(),
      status
    });
  }

  /**
   * Manually evicts a single record.
   *
   * @param {string} domain
   * @param {string} type
   * @returns {boolean} true if deleted
   */
  delete(domain, type) {
    const key = this._buildKey(domain, type);
    return this.cache.delete(key);
  }

  /**
   * Flushes the entire cache.
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Returns a list of all active cache entries with recalculated TTLs.
   *
   * @returns {Array} List of unexpired entries
   */
  getAllActive() {
    const now = Date.now();
    const active = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
      } else {
        const [domain, type] = key.split(':');
        const timeElapsedSec = Math.floor((now - entry.cachedAt) / 1000);
        const adjustedAnswers = entry.answers.map(ans => {
          const remaining = Math.max(0, ans.ttl - timeElapsedSec);
          return { ...ans, ttl: remaining };
        });
        active.push({
          domain,
          type,
          answers: adjustedAnswers,
          originalTtl: entry.originalTtl,
          expiresAt: entry.expiresAt,
          ttlRemaining: Math.max(0, Math.ceil((entry.expiresAt - now) / 1000)),
          status: entry.status || 'NOERROR'
        });
      }
    }

    return active;
  }
}

// Export singleton instance
const dnsCache = new DnsCache();
module.exports = dnsCache;
