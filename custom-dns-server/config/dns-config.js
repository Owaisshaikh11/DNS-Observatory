function parseUpstreamServer(server) {
  const trimmed = server.trim();
  if (!trimmed) return null;

  // Case 1: Bracketed form for IPv6 (e.g. "[::1]:5353" or "[::1]")
  if (trimmed.startsWith("[")) {
    const closeBracket = trimmed.indexOf("]");
    if (closeBracket !== -1) {
      let host = trimmed.slice(1, closeBracket);
      let port = 53;
      const afterBracket = trimmed.slice(closeBracket + 1);
      if (afterBracket.startsWith(":")) {
        const portStr = afterBracket.slice(1);
        const parsedPort = Number(portStr);
        if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
          port = parsedPort;
        }
      }
      return { host, port };
    }
  }

  // Case 2: Treat as host:port only when it contains exactly one ":"
  const colons = (trimmed.match(/:/g) || []).length;
  if (colons === 1) {
    const colonIdx = trimmed.indexOf(":");
    const host = trimmed.slice(0, colonIdx);
    const portStr = trimmed.slice(colonIdx + 1);
    const parsedPort = Number(portStr);
    if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
      return { host, port: parsedPort };
    }
  }

  // Case 3: Zero or multiple colons (e.g. bare IPv4 or bare IPv6 literal like 2001:db8::1)
  return { host: trimmed, port: 53 };
}

const dnsConfig = {
  get forwardEnabled() {
    return process.env.DNS_FORWARD_ENABLED !== 'false';
  },
  get upstreamServers() {
    if (process.env.DNS_UPSTREAM_SERVERS) {
      return process.env.DNS_UPSTREAM_SERVERS.split(",")
        .map(server => parseUpstreamServer(server))
        .filter(server => server !== null);
    }
    return [
      { host: "8.8.8.8", port: 53 },
      { host: "8.8.4.4", port: 53 }
    ];
  },
  get forwardTimeout() {
    const timeout = Number(process.env.DNS_FORWARD_TIMEOUT);
    if (!isNaN(timeout) && timeout > 0) {
      return timeout;
    }
    return 2000; // default 2 seconds timeout
  },
};

module.exports = {
  dnsConfig,
  parseUpstreamServer,
};

