const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const TARGET_DIR = path.resolve(__dirname, '../data/geoip');
const CITY_DB_PATH = path.join(TARGET_DIR, 'GeoLite2-City.mmdb');
const ASN_DB_PATH = path.join(TARGET_DIR, 'GeoLite2-ASN.mmdb');

const CITY_DB_URL = 'https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-City.mmdb';
const ASN_DB_URL = 'https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-ASN.mmdb';

// Checks if files exist, are larger than 0 bytes, and are less than 7 days old
function isFileFresh(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const stats = fs.statSync(filePath);
    if (stats.size === 0) return false;
    const ageInMs = Date.now() - stats.mtimeMs;
    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
    return ageInMs < sevenDaysInMs;
  } catch (err) {
    return false;
  }
}

function downloadFile(fileUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const tempPath = `${outputPath}.tmp`;
    const options = {
      headers: {
        'User-Agent': 'NodeJS/DNS-Observatory-Downloader'
      }
    };

    const req = https.get(fileUrl, options, (response) => {
      const { statusCode } = response;

      // Handle redirect (301 or 302)
      if (statusCode === 301 || statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          const resolvedUrl = new URL(redirectUrl, fileUrl).toString();
          return downloadFile(resolvedUrl, outputPath).then(resolve).catch(reject);
        } else {
          return reject(new Error(`Redirect code ${statusCode} but no location header found`));
        }
      }

      if (statusCode !== 200) {
        return reject(new Error(`Failed to download file: Status Code ${statusCode}`));
      }

      const fileStream = fs.createWriteStream(tempPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        // Rename temp file to final output path for atomic write
        fs.rename(tempPath, outputPath, (renameErr) => {
          if (renameErr) {
            fs.unlink(tempPath, () => {});
            reject(renameErr);
          } else {
            resolve();
          }
        });
      });

      fileStream.on('error', (err) => {
        fs.unlink(tempPath, () => {}); // clean up partial temp file
        reject(err);
      });
    });

    // Prevent script hangs during network failures by timing out after 30 seconds
    req.setTimeout(30000, () => {
      req.destroy(new Error('GeoIP download request timed out after 30 seconds'));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  console.log('Checking GeoIP / ASN local databases status...');

  // Ensure output directory exists
  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  // Clean up legacy GeoLite2-Country database to free disk space
  const legacyCountryPath = path.join(TARGET_DIR, 'GeoLite2-Country.mmdb');
  if (fs.existsSync(legacyCountryPath)) {
    console.log('Removing legacy GeoLite2-Country database to save disk space...');
    try {
      fs.unlinkSync(legacyCountryPath);
      console.log('Legacy Country database deleted.');
    } catch (e) {
      console.warn(`Failed to delete legacy Country database: ${e.message}`);
    }
  }

  const cityFresh = isFileFresh(CITY_DB_PATH);
  const asnFresh = isFileFresh(ASN_DB_PATH);

  if (cityFresh && asnFresh) {
    console.log('Local City GeoIP & ASN databases are present and fresh (< 7 days old). Skipping download.');
    return;
  }

  try {
    if (!cityFresh) {
      // If the file exists but isn't fresh or is corrupted, remove it first
      if (fs.existsSync(CITY_DB_PATH)) {
        try { fs.unlinkSync(CITY_DB_PATH); } catch (e) {}
      }
      console.log(`Downloading GeoLite2-City database from ${CITY_DB_URL}...`);
      await downloadFile(CITY_DB_URL, CITY_DB_PATH);
      console.log('GeoLite2-City database downloaded successfully.');
    } else {
      console.log('GeoLite2-City database is fresh. Skipping.');
    }

    if (!asnFresh) {
      if (fs.existsSync(ASN_DB_PATH)) {
        try { fs.unlinkSync(ASN_DB_PATH); } catch (e) {}
      }
      console.log(`Downloading GeoLite2-ASN database from ${ASN_DB_URL}...`);
      await downloadFile(ASN_DB_URL, ASN_DB_PATH);
      console.log('GeoLite2-ASN database downloaded successfully.');
    } else {
      console.log('GeoLite2-ASN database is fresh. Skipping.');
    }

    console.log('GeoIP database updates completed successfully!');
  } catch (err) {
    console.error(`Error updating databases: ${err.message}`);
    process.exit(0);
  }
}

main();
