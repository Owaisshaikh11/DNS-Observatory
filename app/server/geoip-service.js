/**
 * geoip-service.js
 *
 * Resolves an IP address to geographical and organisational metadata using
 * the ip-api.com public JSON API. Results are cached in a simple LRU map
 * (capped at MAX_CACHE_SIZE entries) so repeated lookups for the same
 * nameserver IP don't hit the network twice.
 *
 * Private/loopback addresses (127.x, 10.x, 192.168.x, 172.16–31.x) return
 * a local placeholder without making any network request.
 *
 * ip-api.com free tier allows ~45 requests/minute — fine for interactive use.
 */

const logger = require('./logger');

const MAX_CACHE_SIZE = 500;

// Map preserves insertion order, which gives us LRU eviction for free:
// when the map is full, we delete the first (oldest) entry.
const geoCache = new Map();
const pendingGeoLookups = new Map();

const PRIVATE_IP_RE = [
  /^127\./,           // loopback
  /^10\./,            // RFC 1918 class A
  /^192\.168\./,      // RFC 1918 class C
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC 1918 class B (172.16–172.31)
  /^::1$/,            // IPv6 loopback
  /^0\.0\.0\.0$/,
];

function isPrivateIp(ip) {
  return PRIVATE_IP_RE.some(re => re.test(ip));
}

/**
 * Converts a two-letter ISO country code to its emoji flag.
 * Each letter maps to a Regional Indicator Symbol (Unicode block U+1F1E6–U+1F1FF).
 * e.g. 'US' → '🇺🇸', 'NL' → '🇳🇱'
 */
function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return '🌐';
  const REGIONAL_A = 0x1F1E6 - 65; // offset so A (65) maps to U+1F1E6
  return [...code.toUpperCase()]
    .map(c => String.fromCodePoint(c.charCodeAt(0) + REGIONAL_A))
    .join('');
}

/**
 * Looks up geographical metadata for an IP address.
 * Returns a consistent shape regardless of whether the lookup succeeds.
 *
 * @param {string} ip - IPv4 address (e.g. "198.41.0.4")
 * @returns {Promise<{flag, org, country, city, countryCode, isp}>}
 */
async function lookupGeoIp(ip) {
  // ── Local / private addresses ─────────────────────────────────────────────
  if (!ip || isPrivateIp(ip)) {
    const isLoopback = /^127\./.test(ip);
    return {
      flag:        isLoopback ? '🖥️' : '🌐',
      org:         isLoopback ? 'Local DNS Server' : 'Private Network',
      country:     'Local',
      city:        null,
      countryCode: null,
      isp:         null,
    };
  }

  // ── LRU cache hit ─────────────────────────────────────────────────────────
  if (geoCache.has(ip)) {
    // Refresh position (move to end = most-recently-used)
    const cached = geoCache.get(ip);
    geoCache.delete(ip);
    geoCache.set(ip, cached);
    return cached;
  }

  // ── Deduplicate concurrent requests for the same IP ──────────────────────
  if (pendingGeoLookups.has(ip)) {
    return pendingGeoLookups.get(ip);
  }

  const promise = (async () => {
    try {
      const response = await fetch(
        `http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,isp,org`,
        { signal: AbortSignal.timeout(3000) }
      );

      if (!response.ok) {
        throw new Error(`ip-api.com HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.status !== 'success') {
        throw new Error(`ip-api.com failed for ${ip}: ${data.message || 'unknown reason'}`);
      }

      const result = {
        flag:        countryCodeToFlag(data.countryCode),
        org:         data.org || data.isp || 'Unknown',
        country:     data.country || 'Unknown',
        city:        data.city || null,
        countryCode: data.countryCode || null,
        isp:         data.isp || null,
      };

      // ── LRU eviction ──────────────────────────────────────────────────────
      if (geoCache.size >= MAX_CACHE_SIZE) {
        const oldestKey = geoCache.keys().next().value;
        geoCache.delete(oldestKey);
      }
      geoCache.set(ip, result);

      return result;

    } catch (err) {
      logger.warn({ err, ip }, `GeoIP lookup failed for ${ip}: ${err.message}`);
      return {
        flag:        '🌐',
        org:         'Unknown',
        country:     'Unknown',
        city:        null,
        countryCode: null,
        isp:         null,
      };
    } finally {
      pendingGeoLookups.delete(ip);
    }
  })();

  pendingGeoLookups.set(ip, promise);
  return promise;
}

module.exports = { lookupGeoIp };
