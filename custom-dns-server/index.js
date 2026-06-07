const path = require("path");
const { startDnsUdpServer } = require("./server/dns-server");
const { startHttpApi } = require("./api/http-api");
const { loadRecords } = require("./lib/record-manager");
const { cleanupExpiredSubdomains, loadDynamicSubdomains } = require("./lib/dynamic-records");

/// const DNS_PORT = process.getuid && process.getuid() === 0 ? 53 : 5353;
const DNS_PORT = 5354;
const API_PORT = 8053;
const RECORDS_PATH = path.join(__dirname, "config", "dns-records.json");

async function startServer() {
  try {
    await loadRecords(RECORDS_PATH);
    await loadDynamicSubdomains();
    const dnsServer = startDnsUdpServer(DNS_PORT);
    const apiServer = startHttpApi(API_PORT);

    // Run cleanup every minute
    setInterval(cleanupExpiredSubdomains, 60000);

    process.on("SIGINT", async () => {
      // Graceful shutdown
      dnsServer.close();
      apiServer.close();
      console.log("DNS server shut down 🫡🫡");
      process.exit();
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
