const dgram = require("dgram");
const { dnsConfig } = require("../config/dns-config");

/**
 * Forwards a raw DNS query buffer to the configured upstream DNS servers.
 * Tries each server in sequence. Returns the raw response buffer from the first
 * server that responds successfully, or null if all fail/timeout.
 *
 * @param {Buffer} msg The raw DNS query packet buffer
 * @returns {Promise<Buffer|null>} The raw DNS response packet buffer, or null
 */
function forwardQuery(msg) {
  const { upstreamServers, forwardTimeout } = dnsConfig;

  if (!upstreamServers || upstreamServers.length === 0) {
    console.warn("No upstream DNS servers configured.");
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let index = 0;
    let socket = null;
    let timeoutId = null;

    function cleanup() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (socket) {
        try {
          socket.close();
        } catch (err) {
          // Ignore socket close errors
        }
        socket = null;
      }
    }

    function tryNext() {
      cleanup();

      if (index >= upstreamServers.length) {
        resolve(null);
        return;
      }

      const { host, port } = upstreamServers[index];
      index++;

      try {
        socket = dgram.createSocket("udp4");

        socket.on("error", (err) => {
          console.error(`Upstream DNS server ${host}:${port} socket error: ${err.message}`);
          tryNext();
        });

        socket.on("message", (responseMsg) => {
          cleanup();
          resolve(responseMsg);
        });

        timeoutId = setTimeout(() => {
          console.warn(`Upstream DNS server ${host}:${port} timed out after ${forwardTimeout}ms`);
          tryNext();
        }, forwardTimeout);

        socket.send(msg, 0, msg.length, port, host, (err) => {
          if (err) {
            console.error(`Failed to send query to upstream DNS server ${host}:${port}: ${err.message}`);
            tryNext();
          }
        });
      } catch (err) {
        console.error(`Failed to create socket for upstream DNS server ${host}:${port}: ${err.message}`);
        tryNext();
      }
    }

    tryNext();
  });
}

module.exports = {
  forwardQuery,
};
