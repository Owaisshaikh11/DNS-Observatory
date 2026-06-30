import useCountdownTtl from '../hooks/useCountdownTtl';
import { formatRecordValue } from '../utils/dnsFormatter';
import CopyButton from './CopyButton';

function RecordRow({ rec, accent }) {
  const secondsElapsed = useCountdownTtl();

  const currentTtl = Math.max(0, rec.ttl - secondsElapsed);
  const isExpired = currentTtl === 0;
  const formattedVal = formatRecordValue(rec.value, rec.typeName || rec.type);

  return (
    <div
      className={`relative grid grid-cols-[1fr_36px_56px_1.2fr] gap-2 px-1.5 py-0.5 border-b border-ink/5 last:border-b-0 items-center font-mono text-[9px] transition-all duration-300 packet-field group ${
        isExpired ? 'opacity-35 select-none' : ''
      }`}
    >
      {/* Name */}
      <span className="truncate text-ink/60" title={rec.name}>
        {rec.name}
      </span>

      {/* Type */}
      <span className={`font-bold ${accent ? 'text-accent' : 'text-ink/80'}`}>
        {rec.typeName || rec.type}
      </span>

      {/* TTL Display */}
      <span className="text-ink/40 tabular-nums">
        TTL {currentTtl}
      </span>

      {/* Value */}
      <span className="flex items-center justify-between min-w-0 font-medium text-ink">
        <span className="truncate break-all" title={formattedVal}>
          {formattedVal}
        </span>
        {!isExpired && <CopyButton text={formattedVal} />}
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
}

export default function RecordTable({ records, accent }) {
  if (!records || records.length === 0) {
    return (
      <div className="font-mono text-[9.5px] text-ink/30 italic py-1">
        ;; [ Empty ]
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0 border border-ink/10 bg-base/5 p-1.5 sharp-border max-w-full overflow-x-hidden select-text">
      {records.map((rec, i) => (
        <RecordRow key={i} rec={rec} accent={accent} />
      ))}
    </div>
  );
}
