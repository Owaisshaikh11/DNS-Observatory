const { QR_MASK, AA_MASK, RD_MASK, RA_MASK, CLASS_IN } = require("./types");
const { writeDomainName, writeAnswer } = require("./dns-writer");

// `buffer` is a raw binary packet sent over UDP (comes from the `dgram` module)
// `offset` is a pointer — tells us where we are in the buffer while reading bytes

function parseDomainName(buffer, offset) {
  const labels = [];
  let jumped = false;
  let jumpOffset = offset;
  let pointer = offset;
  const visited = new Set();

  while (true) {
    if (pointer >= buffer.length) {
      throw new Error("DNS packet parsing error: Pointer out of bounds");
    }

    if (visited.has(pointer)) {
      throw new Error("DNS packet parsing error: Circular reference detected");
    }
    visited.add(pointer);

    const length = buffer.readUInt8(pointer);
    if (length === 0) {
      pointer += 1;
      break;
    }

    if ((length & 0xc0) === 0xc0) {
      // pointer to another name (compression)
      if (pointer + 1 >= buffer.length) {
        throw new Error("DNS packet parsing error: Compressed pointer truncated");
      }
      if (!jumped) jumpOffset = pointer + 2;
      pointer = ((length & 0x3f) << 8) | buffer.readUInt8(pointer + 1);
      jumped = true;
    } else {
      // normal label
      if (pointer + 1 + length > buffer.length) {
        throw new Error("DNS packet parsing error: Label length out of bounds");
      }
      pointer += 1;
      labels.push(buffer.slice(pointer, pointer + length).toString("utf8"));
      pointer += length;
    }
  }

  return [labels.join("."), jumped ? jumpOffset : pointer];
}

// Takes The raw UDP packet and decodes it into a usable JS object
function parseQuery(buffer) {
  if (buffer.length < 12) {
    throw new Error("DNS packet parsing error: Header truncated");
  }

  let offset = 0;
  const header = {
    id: buffer.readUInt16BE(offset),
    flags: buffer.readUInt16BE(offset + 2),
    qdcount: buffer.readUInt16BE(offset + 4),
  };
  offset += 12;

  const questions = [];
  for (let i = 0; i < header.qdcount; i++) {
    const [name, newOffset] = parseDomainName(buffer, offset);
    offset = newOffset;
    if (offset + 4 > buffer.length) {
      throw new Error("DNS packet parsing error: Question section truncated");
    }
    const type = buffer.readUInt16BE(offset);
    offset += 2;
    const cls = buffer.readUInt16BE(offset);
    offset += 2;
    questions.push({ name, type, class: cls });
  }

  return { header, questions };
}

function createResponse(query, answers = [], rcode = 0) {
  // Allocating 4KB of binary space for the response
  const buffer = Buffer.alloc(4096);
  let offset = 0;

  buffer.writeUInt16BE(query.header.id, 0);
  let flags = QR_MASK | AA_MASK | (query.header.flags & RD_MASK) | RA_MASK;
  if (rcode !== 0) {
    flags = (flags & ~0x000f) | (rcode & 0x0f);
  }
  buffer.writeUInt16BE(flags, 2);

  const qdCount = query.questions && query.questions.length > 0 ? 1 : 0;
  buffer.writeUInt16BE(qdCount, 4); // QDCount
  buffer.writeUInt16BE(answers.length, 6); // ANCount
  buffer.writeUInt16BE(0, 8); // NSCount
  buffer.writeUInt16BE(0, 10); // ARCount
  offset = 12;

  let questionName = "";
  if (qdCount > 0) {
    const question = query.questions[0];
    questionName = question.name;
    offset = writeDomainName(buffer, offset, question.name);
    buffer.writeUInt16BE(question.type, offset);
    offset += 2;
    buffer.writeUInt16BE(question.class, offset);
    offset += 2;
  }

  for (const answer of answers) {
    offset = writeAnswer(buffer, offset, questionName, answer);
  }

  return buffer.slice(0, offset);
}

function createErrorResponse(id, rcode) {
  const buffer = Buffer.alloc(12);
  buffer.writeUInt16BE(id, 0);
  
  // flags: Response (QR = 1), Authoritative Answer (AA = 1), RCODE = rcode
  const flags = 0x8000 | 0x0400 | (rcode & 0x0f);
  buffer.writeUInt16BE(flags, 2);
  
  buffer.writeUInt16BE(0, 4); // QDCount
  buffer.writeUInt16BE(0, 6); // ANCount
  buffer.writeUInt16BE(0, 8); // NSCount
  buffer.writeUInt16BE(0, 10); // ARCount
  
  return buffer;
}

module.exports = {
  parseDomainName,
  parseQuery,
  createResponse,
  createErrorResponse,
};
