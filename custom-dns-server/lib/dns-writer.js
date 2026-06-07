const {
  TYPE_A,
  TYPE_AAAA,
  TYPE_NS,
  TYPE_CNAME,
  TYPE_MX,
  TYPE_TXT,
  TYPE_SOA,
} = require("./types");


// splits the domain name into labels and writes them to the buffer
// eg([3]www[7]example[3]com[0]);
function writeDomainName(buffer, offset, domain) {
  if (!domain) {
    buffer.writeUInt8(0, offset++);
    return offset;
  }
  const labels = domain.split(".");
  for (const label of labels) {
    // DNS Label length must not exceed 63 bytes
    const len = Math.min(label.length, 63);
    buffer.writeUInt8(len, offset++);
    buffer.write(label, offset, len);
    offset += len;
  }
  buffer.writeUInt8(0, offset++);
  return offset;
}

function expandIPv6(ip) {
  const doubleColonIndex = ip.indexOf("::");
  let segments = [];
  
  if (doubleColonIndex !== -1) {
    const leftPart = ip.slice(0, doubleColonIndex);
    const rightPart = ip.slice(doubleColonIndex + 2);
    
    const leftSegs = leftPart ? leftPart.split(":") : [];
    const rightSegs = rightPart ? rightPart.split(":") : [];
    
    const missingCount = 8 - (leftSegs.length + rightSegs.length);
    const middleSegs = new Array(Math.max(0, missingCount)).fill("0");
    
    segments = [...leftSegs, ...middleSegs, ...rightSegs];
  } else {
    segments = ip.split(":");
  }
  
  // Ensure we have exactly 8 segments
  while (segments.length < 8) segments.push("0");
  while (segments.length > 8) segments.pop();
  
  return segments;
}

function writeAnswer(buffer, offset, name, answer) {
  offset = writeDomainName(buffer, offset, name);
  buffer.writeUInt16BE(answer.type, offset);
  offset += 2;
  buffer.writeUInt16BE(answer.class, offset);
  offset += 2;
  buffer.writeUInt32BE(answer.ttl, offset);
  offset += 4;

  const dataOffset = offset + 2;
  // The length of the data field is written at offset for reserve space
  let length = 0;

  switch (answer.type) {
    case TYPE_A: {
      const octets = answer.data.split(".");
      if (octets.length !== 4) {
        throw new Error(`Invalid IPv4 address: ${answer.data}`);
      }
      octets.forEach((octet, i) => {
        const val = parseInt(octet, 10);
        if (isNaN(val) || val < 0 || val > 255) {
          throw new Error(`Invalid IPv4 octet: ${octet} in address ${answer.data}`);
        }
        buffer.writeUInt8(val, dataOffset + i);
      });
      length = 4;
      break;
    }

    case TYPE_AAAA: {
      const segments = expandIPv6(answer.data);
      segments.forEach((part, i) => {
        const val = parseInt(part || "0", 16);
        if (isNaN(val) || val < 0 || val > 0xffff) {
          throw new Error(`Invalid IPv6 segment: ${part} in address ${answer.data}`);
        }
        buffer.writeUInt16BE(val, dataOffset + i * 2);
      });
      length = 16;
      break;
    }

    case TYPE_CNAME:
    case TYPE_NS:
      length = writeDomainName(buffer, dataOffset, answer.data) - dataOffset;
      break;

    case TYPE_MX:
      buffer.writeUInt16BE(answer.data.preference, dataOffset);
      length =
        2 +
        writeDomainName(buffer, dataOffset + 2, answer.data.exchange) -
        (dataOffset + 2);
      break;

    case TYPE_TXT: {
      const txtLen = Math.min(answer.data.length, 255);
      buffer.writeUInt8(txtLen, dataOffset);
      buffer.write(answer.data.slice(0, txtLen), dataOffset + 1);
      length = 1 + txtLen;
      break;
    }
    case TYPE_SOA: {
      // MNAME (primary nameserver) + RNAME (admin email)
      let soaOffset = dataOffset;
      soaOffset = writeDomainName(buffer, soaOffset, answer.data.mname);
      soaOffset = writeDomainName(buffer, soaOffset, answer.data.rname);
      // Serial, Refresh, Retry, Expire, Minimum — each 4 bytes
      buffer.writeUInt32BE(answer.data.serial,  soaOffset);      soaOffset += 4;
      buffer.writeUInt32BE(answer.data.refresh, soaOffset);      soaOffset += 4;
      buffer.writeUInt32BE(answer.data.retry,   soaOffset);      soaOffset += 4;
      buffer.writeUInt32BE(answer.data.expire,  soaOffset);      soaOffset += 4;
      buffer.writeUInt32BE(answer.data.minimum, soaOffset);      soaOffset += 4;
      length = soaOffset - dataOffset;
      break;
    }
    default:
      length = 0;
  }
  buffer.writeUInt16BE(length, offset);
  return dataOffset + length;
}

module.exports = {
  writeDomainName,
  writeAnswer,
  expandIPv6,
};
