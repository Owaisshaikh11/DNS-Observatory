/**
 * pcapExporter.js
 *
 * Reconstructs raw DNS query/response byte streams into valid libpcap (.pcap) files.
 * Reconstructs Ethernet, IP, and UDP packet headers entirely client-side.
 */

// Helper to convert space-separated hex strings to Uint8Array
export function hexToBytes(hexString) {
  if (!hexString) return new Uint8Array(0);
  const cleanHex = hexString.trim().replace(/\s+/g, '');
  const len = cleanHex.length;
  if (len % 2 !== 0) return new Uint8Array(0);
  
  const bytes = new Uint8Array(len / 2);
  for (let i = 0; i < len; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Strip bracket and port component from IP addresses (e.g. "[::1]:53" or "127.0.0.1:5354")
export function cleanIpAddress(ipStr) {
  if (!ipStr) return '127.0.0.1';
  
  // Bracketed IPv6 address (e.g., "[::1]:53")
  if (ipStr.startsWith('[')) {
    const endBracket = ipStr.indexOf(']');
    if (endBracket !== -1) {
      return ipStr.substring(1, endBracket);
    }
  }

  // IPv4 with port or IPv6 with port (if formatted as IPv6:port)
  const lastColon = ipStr.lastIndexOf(':');
  const firstColon = ipStr.indexOf(':');
  if (lastColon !== -1) {
    // If it has only one colon, it's IPv4 with a port (e.g. 127.0.0.1:5354)
    if (firstColon === lastColon) {
      return ipStr.substring(0, lastColon);
    }
    // If IPv6 with dot (IPv4-mapped) and a trailing port colon
    if (ipStr.includes('.') && lastColon !== -1) {
      return ipStr.substring(0, lastColon);
    }
  }
  return ipStr;
}

// Parse IPv4 string into 4 bytes
export function parseIPv4(ipStr) {
  const clean = cleanIpAddress(ipStr);
  const parts = clean.split('.');
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    bytes[i] = parts[i] ? parseInt(parts[i], 10) : 0;
  }
  return bytes;
}

// Parse IPv6 string (including compressed formats) into 16 bytes
export function parseIPv6(ipStr) {
  const clean = cleanIpAddress(ipStr);
  const bytes = new Uint8Array(16);
  
  const parts = clean.split('::');
  if (parts.length > 2) {
    // Invalid IPv6 format, default to localhost loopback
    bytes[15] = 1;
    return bytes;
  }

  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];

  const leftWords = left.filter(p => p !== '').map(p => parseInt(p, 16));
  const rightWords = right.filter(p => p !== '').map(p => parseInt(p, 16));

  const missingCount = 8 - (leftWords.length + rightWords.length);
  
  const words = [];
  words.push(...leftWords);
  for (let i = 0; i < missingCount; i++) {
    words.push(0);
  }
  words.push(...rightWords);

  for (let i = 0; i < 8; i++) {
    const w = words[i] || 0;
    bytes[i * 2] = (w >> 8) & 0xff;
    bytes[i * 2 + 1] = w & 0xff;
  }

  return bytes;
}

// Calculate standard 16-bit IP header checksum
export function calculateIpChecksum(header) {
  let sum = 0;
  for (let i = 0; i < header.length; i += 2) {
    const word = (header[i] << 8) + header[i + 1];
    sum += word;
  }
  while (sum >> 16) {
    sum = (sum & 0xffff) + (sum >> 16);
  }
  return (~sum) & 0xffff;
}

// Wraps DNS bytes in Ethernet + IP (v4/v6) + UDP layers, returns headers and packet data
// Wraps DNS bytes in Ethernet + IP (v4/v6) + UDP/TCP layers, returns headers and packet data
export function buildEthernetPacket({
  dnsBytes = new Uint8Array(0),
  isRequest,
  serverIpStr,
  serverPort = 53,
  clientPort = 50000,
  timestampMs,
  transport = 'UDP',
  tcpFlags = 0x18, // Default PSH-ACK for TCP data segments
  tcpSeq = 0,
  tcpAck = 0
}) {
  const isIPv6 = serverIpStr.includes(':');
  const isTcp = transport === 'TCP';

  // Client and Server IP buffers
  const clientIpBytes = isIPv6 
    ? new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]) // ::1 loopback
    : new Uint8Array([192, 168, 1, 100]); // Mock private Client IP

  const serverIpBytes = isIPv6 ? parseIPv6(serverIpStr) : parseIPv4(serverIpStr);

  const srcIp = isRequest ? clientIpBytes : serverIpBytes;
  const dstIp = isRequest ? serverIpBytes : clientIpBytes;

  const srcPort = isRequest ? clientPort : serverPort;
  const dstPort = isRequest ? serverPort : clientPort;

  // Mock MAC addresses
  const clientMac = new Uint8Array([2, 0, 0, 0, 0, 1]);
  const serverMac = new Uint8Array([2, 0, 0, 0, 0, 2]);
  const srcMac = isRequest ? clientMac : serverMac;
  const dstMac = isRequest ? serverMac : clientMac;

  // 1. Ethernet Header (14 bytes)
  const ethHeader = new Uint8Array(14);
  ethHeader.set(dstMac, 0);
  ethHeader.set(srcMac, 6);
  if (isIPv6) {
    ethHeader[12] = 0x86;
    ethHeader[13] = 0xdd; // IPv6 EtherType
  } else {
    ethHeader[12] = 0x08;
    ethHeader[13] = 0x00; // IPv4 EtherType
  }

  // 2. Prepare Transport Payload (prepending 2-byte length for TCP data)
  let transportPayload = dnsBytes;
  if (isTcp && dnsBytes.length > 0) {
    transportPayload = new Uint8Array(2 + dnsBytes.length);
    transportPayload[0] = (dnsBytes.length >> 8) & 0xff;
    transportPayload[1] = dnsBytes.length & 0xff;
    transportPayload.set(dnsBytes, 2);
  }

  const transportHeaderLen = isTcp ? 20 : 8;
  const transportPayloadLen = transportHeaderLen + transportPayload.length;

  // 3. IP Header
  let ipHeader;
  if (isIPv6) {
    ipHeader = new Uint8Array(40);
    // Version (6), Traffic Class (0), Flow Label (0) -> 0x60000000
    ipHeader[0] = 0x60;
    // Payload length
    ipHeader[4] = (transportPayloadLen >> 8) & 0xff;
    ipHeader[5] = transportPayloadLen & 0xff;
    // Next Header: TCP (6) or UDP (17)
    ipHeader[6] = isTcp ? 6 : 17;
    // Hop Limit: 64
    ipHeader[7] = 64;
    // Source and Destination IP
    ipHeader.set(srcIp, 8);
    ipHeader.set(dstIp, 24);
  } else {
    ipHeader = new Uint8Array(20);
    // Version & IHL: IPv4, 20 bytes -> 0x45
    ipHeader[0] = 0x45;
    // DSCP/ECN: 0
    ipHeader[1] = 0x00;
    // Total length: IP header (20) + Transport Header + Transport Payload
    const ipTotalLen = 20 + transportPayloadLen;
    ipHeader[2] = (ipTotalLen >> 8) & 0xff;
    ipHeader[3] = ipTotalLen & 0xff;
    // Identification, Flags, Fragment offset: 0
    // TTL: 64
    ipHeader[8] = 64;
    // Protocol: TCP (6) or UDP (17)
    ipHeader[9] = isTcp ? 6 : 17;
    // Source and Destination IP
    ipHeader.set(srcIp, 12);
    ipHeader.set(dstIp, 16);

    // Compute and populate IP checksum
    const checksum = calculateIpChecksum(ipHeader);
    ipHeader[10] = (checksum >> 8) & 0xff;
    ipHeader[11] = checksum & 0xff;
  }

  // 4. Transport Header (UDP/TCP)
  let transportHeader;
  if (isTcp) {
    // TCP Header (20 bytes)
    transportHeader = new Uint8Array(20);
    const view = new DataView(transportHeader.buffer);
    view.setUint16(0, srcPort, false); // Big endian
    view.setUint16(2, dstPort, false);
    view.setUint32(4, tcpSeq, false);
    view.setUint32(8, tcpAck, false);
    transportHeader[12] = 0x50; // Data Offset (5) -> 20 bytes, reserved 0
    transportHeader[13] = tcpFlags;
    view.setUint16(14, 64240, false); // Window size (64240)
    // Checksum and Urgent Pointer are 0
  } else {
    // UDP Header (8 bytes)
    transportHeader = new Uint8Array(8);
    transportHeader[0] = (srcPort >> 8) & 0xff;
    transportHeader[1] = srcPort & 0xff;
    transportHeader[2] = (dstPort >> 8) & 0xff;
    transportHeader[3] = dstPort & 0xff;
    transportHeader[4] = (transportPayloadLen >> 8) & 0xff;
    transportHeader[5] = transportPayloadLen & 0xff;
    // Checksum: 0x0000 (disabled/ignored in UDP over IPv4)
  }

  // 5. Assemble full frame bytes
  const packetSize = ethHeader.length + ipHeader.length + transportHeader.length + transportPayload.length;
  const fullPacket = new Uint8Array(packetSize);
  let offset = 0;
  fullPacket.set(ethHeader, offset); offset += ethHeader.length;
  fullPacket.set(ipHeader, offset); offset += ipHeader.length;
  fullPacket.set(transportHeader, offset); offset += transportHeader.length;
  fullPacket.set(transportPayload, offset);

  // 6. PCAP Packet Header (16 bytes)
  const pcapPacketHeader = new Uint8Array(16);
  const sec = Math.floor(timestampMs / 1000);
  const usec = Math.floor((timestampMs % 1000) * 1000);

  const view = new DataView(pcapPacketHeader.buffer);
  view.setUint32(0, sec, true); // seconds (little endian)
  view.setUint32(4, usec, true); // microseconds (little endian)
  view.setUint32(8, packetSize, true); // cap length
  view.setUint32(12, packetSize, true); // wire length

  return {
    pcapPacketHeader,
    fullPacket
  };
}

// Combines global header and array of packets into a single PCAP byte block
export function generatePcapFile(packets) {
  const globalHeader = new Uint8Array(24);
  const view = new DataView(globalHeader.buffer);
  view.setUint32(0, 0xa1b2c3d4, true); // Magic Number (microsecond, little endian)
  view.setUint16(4, 2, true);          // Major version 2
  view.setUint16(6, 4, true);          // Minor version 4
  view.setUint32(8, 0, true);          // GMT to local correction
  view.setUint32(12, 0, true);         // Accuracy of timestamps
  view.setUint32(16, 65535, true);     // Max length of captured packets (snaplen)
  view.setUint32(20, 1, true);         // Link-Type: Ethernet (1)

  let totalSize = globalHeader.length;
  for (const pkt of packets) {
    totalSize += pkt.pcapPacketHeader.length + pkt.fullPacket.length;
  }

  const fileBytes = new Uint8Array(totalSize);
  fileBytes.set(globalHeader, 0);

  let offset = globalHeader.length;
  for (const pkt of packets) {
    fileBytes.set(pkt.pcapPacketHeader, offset);
    offset += pkt.pcapPacketHeader.length;
    fileBytes.set(pkt.fullPacket, offset);
    offset += pkt.fullPacket.length;
  }

  return fileBytes;
}

// Helper to trigger browser download
export function downloadBlob(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Generates standard TCP connection packets: SYN, SYN-ACK, ACK, Query, Response, FIN-ACK, ACK
export function buildTcpFlowPackets({
  queryBytes,
  responseBytes,
  serverIpStr,
  serverPort = 53,
  clientPort = 50000,
  timestampMs,
  success = true,
  error = null
}) {
  const packets = [];
  const baseTime = timestampMs;

  let clientSeq = 1000;
  let serverSeq = 2000;

  // 1. SYN: Client -> Server
  packets.push(buildEthernetPacket({
    dnsBytes: new Uint8Array(0),
    isRequest: true,
    serverIpStr,
    serverPort,
    clientPort,
    timestampMs: baseTime,
    transport: 'TCP',
    tcpFlags: 0x02, // SYN
    tcpSeq: clientSeq,
    tcpAck: 0
  }));

  // If connection refused
  if (!success && (error?.includes('refused') || error?.includes('ECONNREFUSED'))) {
    // 2. RST-ACK: Server -> Client
    packets.push(buildEthernetPacket({
      dnsBytes: new Uint8Array(0),
      isRequest: false,
      serverIpStr,
      serverPort,
      clientPort,
      timestampMs: baseTime + 1,
      transport: 'TCP',
      tcpFlags: 0x14, // RST-ACK
      tcpSeq: serverSeq,
      tcpAck: clientSeq + 1
    }));
    return packets;
  }

  // If connection timed out (no response to SYN)
  if (!success) {
    return packets;
  }

  // 2. SYN-ACK: Server -> Client
  packets.push(buildEthernetPacket({
    dnsBytes: new Uint8Array(0),
    isRequest: false,
    serverIpStr,
    serverPort,
    clientPort,
    timestampMs: baseTime + 1,
    transport: 'TCP',
    tcpFlags: 0x12, // SYN-ACK
    tcpSeq: serverSeq,
    tcpAck: clientSeq + 1
  }));

  clientSeq += 1;
  serverSeq += 1;

  // 3. ACK: Client -> Server
  packets.push(buildEthernetPacket({
    dnsBytes: new Uint8Array(0),
    isRequest: true,
    serverIpStr,
    serverPort,
    clientPort,
    timestampMs: baseTime + 2,
    transport: 'TCP',
    tcpFlags: 0x10, // ACK
    tcpSeq: clientSeq,
    tcpAck: serverSeq
  }));

  // 4. TCP Query Data: Client -> Server
  if (queryBytes && queryBytes.length > 0) {
    packets.push(buildEthernetPacket({
      dnsBytes: queryBytes,
      isRequest: true,
      serverIpStr,
      serverPort,
      clientPort,
      timestampMs: baseTime + 5,
      transport: 'TCP',
      tcpFlags: 0x18, // PSH-ACK
      tcpSeq: clientSeq,
      tcpAck: serverSeq
    }));
    clientSeq += 2 + queryBytes.length; // Include 2-byte TCP message length prefix
  }

  // 5. TCP Response Data: Server -> Client
  if (responseBytes && responseBytes.length > 0) {
    packets.push(buildEthernetPacket({
      dnsBytes: responseBytes,
      isRequest: false,
      serverIpStr,
      serverPort,
      clientPort,
      timestampMs: baseTime + 15,
      transport: 'TCP',
      tcpFlags: 0x18, // PSH-ACK
      tcpSeq: serverSeq,
      tcpAck: clientSeq
    }));
    serverSeq += 2 + responseBytes.length; // Include 2-byte TCP message length prefix
  }

  // 6. FIN-ACK: Client -> Server
  packets.push(buildEthernetPacket({
    dnsBytes: new Uint8Array(0),
    isRequest: true,
    serverIpStr,
    serverPort,
    clientPort,
    timestampMs: baseTime + 20,
    transport: 'TCP',
    tcpFlags: 0x11, // FIN-ACK
    tcpSeq: clientSeq,
    tcpAck: serverSeq
  }));

  clientSeq += 1;

  // 7. FIN-ACK: Server -> Client
  packets.push(buildEthernetPacket({
    dnsBytes: new Uint8Array(0),
    isRequest: false,
    serverIpStr,
    serverPort,
    clientPort,
    timestampMs: baseTime + 22,
    transport: 'TCP',
    tcpFlags: 0x11, // FIN-ACK
    tcpSeq: serverSeq,
    tcpAck: clientSeq
  }));

  serverSeq += 1;

  // 8. ACK: Client -> Server
  packets.push(buildEthernetPacket({
    dnsBytes: new Uint8Array(0),
    isRequest: true,
    serverIpStr,
    serverPort,
    clientPort,
    timestampMs: baseTime + 23,
    transport: 'TCP',
    tcpFlags: 0x10, // ACK
    tcpSeq: clientSeq,
    tcpAck: serverSeq
  }));

  return packets;
}

// Maps a single hop attempt object to PCAP packets (UDP or TCP)
export function processAttempt({
  attempt,
  serverIpStr,
  serverPort = 53,
  clientPort = 50000,
  timestampMs,
  packets
}) {
  const isTcp = attempt.protocol === 'TCP';

  if (isTcp) {
    const queryBytes = attempt.queryPacket?.rawHex ? hexToBytes(attempt.queryPacket.rawHex) : new Uint8Array(0);
    const responseBytes = attempt.responsePacket?.rawHex ? hexToBytes(attempt.responsePacket.rawHex) : new Uint8Array(0);
    const tcpPackets = buildTcpFlowPackets({
      queryBytes,
      responseBytes,
      serverIpStr,
      serverPort,
      clientPort,
      timestampMs,
      success: attempt.success,
      error: attempt.error
    });
    packets.push(...tcpPackets);
  } else {
    // UDP Query
    if (attempt.queryPacket?.rawHex) {
      const queryBytes = hexToBytes(attempt.queryPacket.rawHex);
      packets.push(buildEthernetPacket({
        dnsBytes: queryBytes,
        isRequest: true,
        serverIpStr,
        serverPort,
        clientPort,
        timestampMs: timestampMs - (attempt.latencyMs || 0),
        transport: 'UDP'
      }));
    }

    // UDP Response
    if (attempt.success && attempt.responsePacket?.rawHex) {
      const responseBytes = hexToBytes(attempt.responsePacket.rawHex);
      packets.push(buildEthernetPacket({
        dnsBytes: responseBytes,
        isRequest: false,
        serverIpStr,
        serverPort,
        clientPort,
        timestampMs,
        transport: 'UDP'
      }));
    }
  }
}

// Main function to export a single hop query/response packets
export function exportHopPcap(hop, traceTimestamp) {
  const baseMs = new Date(traceTimestamp || Date.now()).getTime();
  const packets = [];
  const clientPort = 50000 + (hop.step || 1);

  if (hop.attempts && hop.attempts.length > 0) {
    let offsetMs = 0;
    hop.attempts.forEach((att, attIdx) => {
      const subClientPort = clientPort + attIdx * 10; // Avoid TCP port reuse warnings in Wireshark
      const attemptTime = baseMs + (hop.cumulativeMs || 0) - (hop.latencyMs || 0) + offsetMs;
      processAttempt({
        attempt: att,
        serverIpStr: hop.ip,
        serverPort: hop.port || 53,
        clientPort: subClientPort,
        timestampMs: attemptTime,
        packets
      });
      offsetMs += (att.latencyMs || 0) + 100; // Increment time sequentially
    });
  } else if (hop.parallelQueries && hop.parallelQueries.length > 0) {
    hop.parallelQueries.forEach((q, qIdx) => {
      const subClientPort = clientPort + qIdx;
      
      // Request Packet
      if (q.queryPacket?.rawHex) {
        const queryBytes = hexToBytes(q.queryPacket.rawHex);
        const queryTime = baseMs + (hop.cumulativeMs || 0) - (q.latencyMs || 0);
        packets.push(buildEthernetPacket({
          dnsBytes: queryBytes,
          isRequest: true,
          serverIpStr: hop.ip,
          serverPort: hop.port || 53,
          clientPort: subClientPort,
          timestampMs: queryTime
        }));
      }

      // Response Packet
      if (q.responsePacket?.rawHex && q.rcode !== 'TIMEOUT') {
        const responseBytes = hexToBytes(q.responsePacket.rawHex);
        const responseTime = baseMs + (hop.cumulativeMs || 0);
        packets.push(buildEthernetPacket({
          dnsBytes: responseBytes,
          isRequest: false,
          serverIpStr: hop.ip,
          serverPort: hop.port || 53,
          clientPort: subClientPort,
          timestampMs: responseTime
        }));
      }
    });
  } else {
    // Single Query Hop (legacy/fallback)
    // Request Packet
    if (hop.queryPacket?.rawHex) {
      const queryBytes = hexToBytes(hop.queryPacket.rawHex);
      const queryTime = baseMs + (hop.cumulativeMs || 0) - (hop.latencyMs || 0);
      packets.push(buildEthernetPacket({
        dnsBytes: queryBytes,
        isRequest: true,
        serverIpStr: hop.ip,
        serverPort: hop.port || 53,
        clientPort: clientPort,
        timestampMs: queryTime
      }));
    }

    // Response Packet
    if (hop.response?.rawHex && hop.response?.rcode !== 'TIMEOUT') {
      const responseBytes = hexToBytes(hop.response.rawHex);
      const responseTime = baseMs + (hop.cumulativeMs || 0);
      packets.push(buildEthernetPacket({
        dnsBytes: responseBytes,
        isRequest: false,
        serverIpStr: hop.ip,
        serverPort: hop.port || 53,
        clientPort: clientPort,
        timestampMs: responseTime
      }));
    }
  }

  if (packets.length === 0) return false;

  const fileBytes = generatePcapFile(packets);
  const cleanDomain = (hop.queryDomain || 'dns-query').replace(/[^a-zA-Z0-9.-]/g, '_');
  const filename = `hop_${hop.step}_${hop.type.toLowerCase()}_${cleanDomain}.pcap`;
  downloadBlob(fileBytes, filename);
  return true;
}

// Main function to export all trace hops in a single session
export function exportTracePcap(hops, traceTimestamp, domain = 'dns-trace') {
  const baseMs = new Date(traceTimestamp || Date.now()).getTime();
  const packets = [];
  let clientPortOffset = 0;

  for (const hop of hops) {
    // Skip virtual client stubs / CNAME local redirects that have no wire packets
    if (hop.type === 'CLIENT' || hop.type === 'CNAME_REDIRECT') {
      continue;
    }

    const baseHopClientPort = 50000 + clientPortOffset;

    if (hop.attempts && hop.attempts.length > 0) {
      let offsetMs = 0;
      hop.attempts.forEach((att, attIdx) => {
        const subClientPort = baseHopClientPort + attIdx * 10;
        const attemptTime = baseMs + (hop.cumulativeMs || 0) - (hop.latencyMs || 0) + offsetMs;
        processAttempt({
          attempt: att,
          serverIpStr: hop.ip,
          serverPort: hop.port || 53,
          clientPort: subClientPort,
          timestampMs: attemptTime,
          packets
        });
        offsetMs += (att.latencyMs || 0) + 100;
      });
      clientPortOffset += hop.attempts.length * 10;
    } else if (hop.parallelQueries && hop.parallelQueries.length > 0) {
      hop.parallelQueries.forEach((q, qIdx) => {
        const subClientPort = baseHopClientPort + qIdx;
        
        // Request Packet
        if (q.queryPacket?.rawHex) {
          const queryBytes = hexToBytes(q.queryPacket.rawHex);
          const queryTime = baseMs + (hop.cumulativeMs || 0) - (q.latencyMs || 0);
          packets.push(buildEthernetPacket({
            dnsBytes: queryBytes,
            isRequest: true,
            serverIpStr: hop.ip,
            serverPort: hop.port || 53,
            clientPort: subClientPort,
            timestampMs: queryTime
          }));
        }

        // Response Packet
        if (q.responsePacket?.rawHex && q.rcode !== 'TIMEOUT') {
          const responseBytes = hexToBytes(q.responsePacket.rawHex);
          const responseTime = baseMs + (hop.cumulativeMs || 0);
          packets.push(buildEthernetPacket({
            dnsBytes: responseBytes,
            isRequest: false,
            serverIpStr: hop.ip,
            serverPort: hop.port || 53,
            clientPort: subClientPort,
            timestampMs: responseTime
          }));
        }
      });
      clientPortOffset += hop.parallelQueries.length;
    } else {
      // Single Query Hop (legacy/fallback)
      // Request Packet
      if (hop.queryPacket?.rawHex) {
        const queryBytes = hexToBytes(hop.queryPacket.rawHex);
        const queryTime = baseMs + (hop.cumulativeMs || 0) - (hop.latencyMs || 0);
        packets.push(buildEthernetPacket({
          dnsBytes: queryBytes,
          isRequest: true,
          serverIpStr: hop.ip,
          serverPort: hop.port || 53,
          clientPort: baseHopClientPort,
          timestampMs: queryTime
        }));
      }

      // Response Packet
      if (hop.response?.rawHex && hop.response?.rcode !== 'TIMEOUT') {
        const responseBytes = hexToBytes(hop.response.rawHex);
        const responseTime = baseMs + (hop.cumulativeMs || 0);
        packets.push(buildEthernetPacket({
          dnsBytes: responseBytes,
          isRequest: false,
          serverIpStr: hop.ip,
          serverPort: hop.port || 53,
          clientPort: baseHopClientPort,
          timestampMs: responseTime
        }));
      }
      clientPortOffset += 1;
    }
  }

  if (packets.length === 0) return false;

  const fileBytes = generatePcapFile(packets);
  const cleanDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
  const filename = `trace_${cleanDomain}.pcap`;
  downloadBlob(fileBytes, filename);
  return true;
}
