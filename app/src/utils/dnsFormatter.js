/**
 * Formats DNS record values of various types (e.g. MX, SOA, SRV, DS, DNSKEY, RRSIG, TXT)
 * into human-readable monospaced strings for visual display.
 *
 * @param {*} val - The raw record value (string, number, or parsed object).
 * @param {string} type - The DNS record type (e.g., 'A', 'MX', 'TXT').
 * @returns {string} - The formatted record string.
 */
export const formatRecordValue = (val, type) => {
  if (typeof val !== 'object' || val === null) {
    if (type === 'TXT') {
      // Ensure we don't double-quote if it is already quoted
      const strVal = String(val);
      if (strVal.startsWith('"') && strVal.endsWith('"')) {
        return strVal;
      }
      return `"${strVal}"`;
    }
    return String(val);
  }

  const upperType = String(type).toUpperCase();

  if (upperType === 'MX') {
    return `${val.preference} ${val.exchange}`;
  }

  if (upperType === 'SOA') {
    return `MNAME: ${val.mname} | RNAME: ${val.rname} | S: ${val.serial} | RF: ${val.refresh} | RT: ${val.retry}`;
  }

  if (upperType === 'SRV') {
    return `Pri: ${val.priority} | Wgt: ${val.weight} | Port: ${val.port} | Tgt: ${val.target}`;
  }

  if (upperType === 'DS') {
    const digest = val.digest ? String(val.digest) : '';
    return `Tag: ${val.keyTag} | Alg: ${val.algorithm} | Type: ${val.digestType} | Dig: ${digest.substring(0, 10)}...`;
  }

  if (upperType === 'DNSKEY') {
    return `Flags: ${val.flags} | Proto: ${val.protocol} | KeyLen: ${val.keyLength}B`;
  }

  if (upperType === 'RRSIG') {
    return `Covers: ${val.typeCovered} | KeyTag: ${val.keyTag} | Signer: ${val.signerName}`;
  }

  return JSON.stringify(val);
};
