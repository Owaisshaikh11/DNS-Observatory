const express = require("express");
const cors = require("cors");
const net = require("net");
const pinoHttp = require("pino-http");
const logger = require("../lib/logger");
const {
  dynamicSubdomains,
  addDynamicSubdomain,
  removeDynamicSubdomain,
} = require("../lib/dynamic-records");
const { DEFAULT_TTL } = require("../lib/types");
const { getRecords } = require("../lib/record-manager");

function startHttpApi(port) {
  const app = express();

  app.use(pinoHttp({ logger }));
  app.use(express.json());
  app.use(cors());

  //* Routes

  app.get("/api/dns/subdomains", (req, res) => {
    const result = [...dynamicSubdomains.entries()].map(([domain, data]) => ({
      domain,
      ipAddress: data.ipAddress,
      expires: data.expires ? new Date(data.expires).toISOString() : null,
      isPersistent: data.isPersistent
    }));
    res.json({ subdomains: result });
  });

  app.post("/api/dns/subdomains", (req, res) => {
    const { subdomain, domain, ipAddress, ttl, isPersistent } = req.body || {};
    const subdomainValue = typeof subdomain === "string" ? subdomain.trim() : "";
    const domainValue = typeof domain === "string" ? domain.trim() : "";
    const ipAddressValue = typeof ipAddress === "string" ? ipAddress.trim() : "";
    const persistent = Boolean(isPersistent);

    if (!subdomainValue || !domainValue || !ipAddressValue) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (net.isIP(ipAddressValue) !== 4) {
      return res.status(400).json({ error: "Dynamic subdomains currently support IPv4 addresses only" });
    }

    const ttlSeconds = ttl === undefined || ttl === null ? DEFAULT_TTL : Number(ttl);
    if (!persistent && (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0)) {
      return res.status(400).json({ error: "TTL must be a positive integer" });
    }

    try {
      const domainName = addDynamicSubdomain(
        subdomainValue,
        domainValue,
        ipAddressValue,
        ttlSeconds,
        persistent
      );
      res.json({ success: true, domain: domainName, isPersistent: persistent });
    } catch (error) {
      req.log.error({ err: error, subdomain: subdomainValue, domain: domainValue }, "Error adding subdomain");
      res.status(500).json({ error: "Failed to add subdomain" });
    }
  });

  app.delete("/api/dns/subdomains", (req, res) => {
    const { subdomain, domain } = req.body || {};
    const subdomainValue = typeof subdomain === "string" ? subdomain.trim() : "";
    const domainValue = typeof domain === "string" ? domain.trim() : "";

    if (!subdomainValue || !domainValue) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const removed = removeDynamicSubdomain(subdomainValue, domainValue);
      res.status(removed ? 200 : 404).json({ success: removed });
    } catch (error) {
      req.log.error({ err: error, subdomain: subdomainValue, domain: domainValue }, "Error removing subdomain");
      res.status(500).json({ error: "Failed to remove subdomain" });
    }
  });

  app.get("/api/dns/records", (req, res) => {
    try {
      res.json(getRecords());
    } catch (error) {
      req.log.error({ err: error }, "Error retrieving records");
      res.status(500).json({ error: "Failed to retrieve records" });
    }
  });

  return app.listen(port, () => {
    logger.info(`HTTP API server running on port ${port}`);
  });
}

module.exports = { startHttpApi };
