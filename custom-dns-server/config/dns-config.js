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
    return process.env.DNS_FORWARD_ENABLED === "true"; // Default to false unless explicitly enabled
  },
  get upstreamServers() {
    return (process.env.DNS_UPSTREAM_SERVERS || "8.8.8.8,8.8.4.4")
      .split(",")
      .map(parseUpstreamServer)
      .filter(Boolean);
  },
  get forwardTimeout() {
    return Number(process.env.DNS_FORWARD_TIMEOUT) || 2000; // Timeout in ms, default to 2 seconds
  },
};

module.exports = { dnsConfig };

