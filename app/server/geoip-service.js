/**
 * geoip-service.js
 *
 * Resolves an IP address to geographical (country + city) and organisational metadata
 * by querying the ip-api.com public JSON API first for maximum accuracy.
 * If the API is rate-limited, times out, or the system is offline, it gracefully
 * falls back to resolving lookups locally using the MaxMind City & ASN binary databases.
 *
 * Results are cached in a simple LRU map (capped at MAX_CACHE_SIZE entries).
 * Private/loopback addresses (127.x, 10.x, 192.168.x, 172.16–31.x) return
 * a local placeholder without making any network request or database lookup.
 */

const path = require('path');
const fs = require('fs');
const net = require('net');
const maxmind = require('maxmind');
const logger = require('./logger');

const MAX_CACHE_SIZE = 500;
const geoCache = new Map();

const PRIVATE_IP_RE = [
  /^127\./,           // loopback
  /^10\./,            // RFC 1918 class A
  /^192\.168\./,      // RFC 1918 class C
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC 1918 class B (172.16–172.31)
  /^169\.254\./,      // link-local
  /^224\./,           // multicast
  /^::1$/,            // IPv6 loopback
  /^0\.0\.0\.0$/,
];

function isPrivateIp(ip) {
  return PRIVATE_IP_RE.some(re => re.test(ip));
}

/**
 * Converts a two-letter ISO country code to its emoji flag.
 */
function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return '🌐';
  const REGIONAL_A = 0x1F1E6 - 65; // offset so A (65) maps to U+1F1E6
  return [...code.toUpperCase()]
    .map(c => String.fromCodePoint(c.charCodeAt(0) + REGIONAL_A))
    .join('');
}

// Open local MaxMind databases asynchronously for fallback use
const CITY_DB_PATH = path.resolve(__dirname, 'data/geoip/GeoLite2-City.mmdb');
const ASN_DB_PATH = path.resolve(__dirname, 'data/geoip/GeoLite2-ASN.mmdb');

let cityReader = null;
let asnReader = null;

const initPromise = (async () => {
  try {
    const openTasks = [];

    if (fs.existsSync(CITY_DB_PATH)) {
      openTasks.push(
        maxmind.open(CITY_DB_PATH)
          .then(reader => { cityReader = reader; })
          .catch(err => logger.warn(`Failed to open City database: ${err.message}`))
      );
    } else {
      logger.warn(`GeoLite2-City.mmdb not found at ${CITY_DB_PATH}. Local City resolution fallback is disabled.`);
    }

    if (fs.existsSync(ASN_DB_PATH)) {
      openTasks.push(
        maxmind.open(ASN_DB_PATH)
          .then(reader => { asnReader = reader; })
          .catch(err => logger.warn(`Failed to open ASN database: ${err.message}`))
      );
    } else {
      logger.warn(`GeoLite2-ASN.mmdb not found at ${ASN_DB_PATH}. Local ASN resolution fallback is disabled.`);
    }

    if (openTasks.length > 0) {
      await Promise.all(openTasks);
      logger.info('Local City GeoIP / ASN database readers initialized (configured as fallback).');
    }
  } catch (err) {
    logger.error(`Error during GeoIP databases initialization: ${err.message}`);
  }
})();

/**
 * Looks up geographical metadata for an IP address.
 *
 * @param {string} ip - IPv4 address (e.g. "198.41.0.4")
 * @returns {Promise<{flag, org, country, city, countryCode, isp}>}
 */
async function lookupGeoIp(ip) {
  // ── 1. Validate IP address string ─────────────────────────────────────────
  if (!ip || net.isIP(ip) === 0) {
    return {
      flag:        '🌐',
      org:         'Unknown',
      country:     'Unknown',
      city:        null,
      countryCode: null,
      isp:         null,
    };
  }

  // ── 2. Local / private addresses ──────────────────────────────────────────
  if (isPrivateIp(ip)) {
    const isLoopback = /^127\./.test(ip) || ip === '::1';
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
    const cached = geoCache.get(ip);
    geoCache.delete(ip);
    geoCache.set(ip, cached);
    return cached;
  }

  // ── 1. API-First Lookup (ip-api.com) ──────────────────────────────────────
  try {
    const response = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,isp,org`,
      { signal: AbortSignal.timeout(2000) } // Keep timeout low for fast fallback response
    );

    if (!response.ok) {
      throw new Error(`ip-api.com HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== 'success') {
      throw new Error(`ip-api.com failed for ${ip}: ${data.message || 'unknown message'}`);
    }

    const result = {
      flag:        countryCodeToFlag(data.countryCode),
      org:         data.org || data.isp || 'Unknown',
      country:     data.country || 'Unknown',
      city:        data.city || null,
      countryCode: data.countryCode || null,
      isp:         data.isp || null,
    };

    if (geoCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = geoCache.keys().next().value;
      geoCache.delete(oldestKey);
    }
    geoCache.set(ip, result);

    return result;

  } catch (err) {
    logger.warn({ err, ip }, `API GeoIP lookup failed for ${ip}, falling back to local MMDB: ${err.message}`);
  }

  // Ensure database initialization promise has settled
  await initPromise;

  // ── 2. Fallback: Local MMDB lookup ────────────────────────────────────────
  if (cityReader || asnReader) {
    try {
      const cityData = cityReader ? cityReader.get(ip) : null;
      const asnData = asnReader ? asnReader.get(ip) : null;

      if (cityData || asnData) {
        const countryCode = cityData?.country?.iso_code || null;
        const countryName = cityData?.country?.names?.en || 'Unknown';
        const cityName = cityData?.city?.names?.en || null;
        const flag = countryCodeToFlag(countryCode);

        let org = 'Unknown';
        if (asnData) {
          const asnNum = asnData.autonomous_system_number;
          const asnOrg = asnData.autonomous_system_organization;
          if (asnNum && asnOrg) {
            org = `AS${asnNum} ${asnOrg}`;
          } else if (asnOrg) {
            org = asnOrg;
          } else if (asnNum) {
            org = `AS${asnNum}`;
          }
        }

        const result = {
          flag,
          org,
          country: countryName,
          city: cityName,
          countryCode,
          isp: org !== 'Unknown' ? org : null,
        };

        // Cache result
        if (geoCache.size >= MAX_CACHE_SIZE) {
          const oldestKey = geoCache.keys().next().value;
          geoCache.delete(oldestKey);
        }
        geoCache.set(ip, result);

        return result;
      }
    } catch (dbErr) {
      logger.error({ err: dbErr, ip }, `Local MMDB fallback lookup failed for ${ip}: ${dbErr.message}`);
    }
  }

  // ── 3. Final Fallback (if both fail) ──────────────────────────────────────
  const finalFallback = {
    flag:        '🌐',
    org:         'Unknown',
    country:     'Unknown',
    city:        null,
    countryCode: null,
    isp:         null,
  };
  return finalFallback;
}

module.exports = { lookupGeoIp };
