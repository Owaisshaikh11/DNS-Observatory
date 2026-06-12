export default function RecordTable({ records, accent, secondsElapsed = 0 }) {
  if (!records || records.length === 0) {
    return (
      <div className="font-mono text-[9.5px] text-ink/30 italic py-1">
        ;; [ Empty ]
      </div>
    );
  }

  // Format complex records (e.g. SOA, MX, DNSSEC records) into clean monospaced strings
  const formatRecordValue = (val, type) => {
    if (typeof val !== 'object' || val === null) {
      return String(val);
    }

    if (type === 'MX') {
      return `${val.preference} ${val.exchange}`;
    }

    if (type === 'SOA') {
      return `MNAME: ${val.mname} | RNAME: ${val.rname} | S: ${val.serial} | RF: ${val.refresh} | RT: ${val.retry}`;
    }

    if (type === 'DS') {
      return `Tag: ${val.keyTag} | Alg: ${val.algorithm} | Type: ${val.digestType} | Dig: ${val.digest.substring(0, 10)}...`;
    }

    if (type === 'DNSKEY') {
      return `Flags: ${val.flags} | Proto: ${val.protocol} | KeyLen: ${val.keyLength}B`;
    }

    if (type === 'RRSIG') {
      return `Covers: ${val.typeCovered} | KeyTag: ${val.keyTag} | Signer: ${val.signerName}`;
    }

    return JSON.stringify(val);
  };

  return (
    <div className="flex flex-col gap-0 border border-ink/10 bg-base/5 p-1.5 sharp-border max-w-full overflow-x-hidden select-text">
      {records.map((rec, i) => {
        const currentTtl = Math.max(0, rec.ttl - secondsElapsed);
        const isExpired = currentTtl === 0;

        return (
          <div
            key={i}
            className={`relative grid grid-cols-[1fr_36px_56px_1.2fr] gap-2 px-1.5 py-0.5 border-b border-ink/5 last:border-b-0 items-center font-mono text-[9px] transition-all duration-300 packet-field ${
              isExpired ? 'opacity-35 select-none' : ''
            }`}
          >
            {/* Name */}
            <span className="truncate text-ink/60" title={rec.name}>
              {rec.name}
            </span>

            {/* Type */}
            <span
              className={`font-bold ${accent ? 'text-accent' : 'text-ink/80'}`}
            >
              {rec.typeName || rec.type}
            </span>

            {/* TTL Display */}
            <span className="text-ink/40 tabular-nums">
              TTL {currentTtl}
            </span>

            {/* Value */}
            <span className="truncate font-medium text-ink break-all" title={formatRecordValue(rec.value, rec.typeName || rec.type)}>
              {formatRecordValue(rec.value, rec.typeName || rec.type)}
            </span>

            {/* Expired overlay indicator */}
            {isExpired && (
              <div className="absolute inset-0 flex items-center justify-end pr-2 bg-base/5 pointer-events-none select-none z-10">
                <span className="text-[7.5px] font-black text-error border border-error bg-[#F0EDE8] px-1 select-none leading-none">
                  EXPIRED
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
