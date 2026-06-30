import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useCountdownTtl from '../hooks/useCountdownTtl';
import { formatRecordValue } from '../utils/dnsFormatter';

function RecordCard({ rec, ri, type, domain, isNxDomain, showRawJson, setShowRawJson }) {
  const secondsElapsed = useCountdownTtl();

  const currentTtl = Math.max(0, rec.ttl - secondsElapsed);
  const isExpired = currentTtl === 0 && !isNxDomain;
  const cardKey = `${type}-${rec.name || ''}-${ri}`;
  const showJson = showRawJson[cardKey] === true;

  return (
    <div
      className={`border border-ink flex flex-col relative overflow-hidden transition-all duration-300 bg-white ${
        isExpired ? 'border-ink/20 opacity-45' : ''
      }`}
    >
      {/* Cache Expiry stamp overlay */}
      {isExpired && (
        <div className="absolute inset-0 flex items-center justify-center z-20 backdrop-blur-[1px] bg-base/40 select-none">
          <span className="text-error font-mono text-[9px] font-bold border border-error bg-[#F0EDE8] px-2 py-0.5 rotate-[-5deg] tracking-widest shadow-[2px_2px_0_0_rgba(239,68,68,1)]">
            [CACHE EXPIRED]
          </span>
        </div>
      )}

      {/* Record metadata header */}
      {((rec.ttl !== undefined && rec.ttl !== null) ||
        (rec.name && rec.name.replace(/\.$/, '') !== domain.replace(/\.$/, '')) ||
        typeof rec.value === 'object') && (
        <div className="px-3 py-1 bg-ink/[0.02] border-b border-ink/10 flex justify-between items-center text-[8.5px] text-ink/50 select-none font-mono font-medium">
          <div className="flex items-center gap-1.5">
            <span>{rec.ttl !== undefined ? `TTL ${currentTtl}s` : ''}</span>
            {typeof rec.value === 'object' && (
              <button
                type="button"
                onClick={() =>
                  setShowRawJson((prev) => ({ ...prev, [cardKey]: !prev[cardKey] }))
                }
                className="px-1 border border-ink/20 hover:border-ink hover:text-accent transition-colors cursor-pointer text-[7.5px] uppercase font-bold"
              >
                {showJson ? 'TEXT' : 'JSON'}
              </button>
            )}
          </div>
          {rec.name && rec.name.replace(/\.$/, '') !== domain.replace(/\.$/, '') && (
            <span className="truncate max-w-[160px]" title={rec.name}>
              {rec.name}
            </span>
          )}
        </div>
      )}

      {/* Record value */}
      <div className="px-3 py-1.5 font-mono text-[10.5px] break-all leading-relaxed text-ink/80 select-all font-medium">
        {showJson ? JSON.stringify(rec.value) : formatRecordValue(rec.value, type)}
      </div>
    </div>
  );
}

export default function RecordSection({
  domain,
  recordType,
  answers,
  authorityRecords,
  additionalRecords,
  isNxDomain,
  onAppendQuery
}) {
  const [showRawJson, setShowRawJson] = useState({});
  const [expandedGroups, setExpandedGroups] = useState({});

  const toggleGroup = (section, type) => {
    const key = `${section}-${type}`;
    setExpandedGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const renderGroupedSection = (sectionName, records) => {
    if (!records || records.length === 0) {
      return <div className="font-mono text-[10px] text-ink opacity-40 italic">No records found.</div>;
    }

    const groups = {};
    records.forEach((rec) => {
      const type = rec.typeName || rec.type || 'UNKNOWN';
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(rec);
    });

    return (
      <div className="flex flex-col gap-4">
        {Object.entries(groups).map(([type, groupRecords]) => {
          const key = `${sectionName}-${type}`;
          const isExpanded = expandedGroups[key] === true;
          const firstRecord = groupRecords[0];
          const remainingRecords = groupRecords.slice(1);

          return (
            <div key={type} className="flex flex-col gap-2">
              {/* Type Category Title */}
              <div className="font-mono text-[9.5px] font-bold uppercase text-ink/60 tracking-wider flex items-center gap-1.5 select-none">
                <span>:: {type} records</span>
                <span className="text-[8px] opacity-40">({groupRecords.length})</span>
              </div>

              {/* Always show the first record */}
              <RecordCard
                rec={firstRecord}
                ri={0}
                type={type}
                domain={domain}
                isNxDomain={isNxDomain}
                showRawJson={showRawJson}
                setShowRawJson={setShowRawJson}
              />

              {/* Remaining records shown under collapsible accordion container */}
              {remainingRecords.length > 0 && (
                <div className="flex flex-col gap-2">
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden flex flex-col gap-2"
                      >
                        {remainingRecords.map((rec, ri) => (
                          <RecordCard
                            key={ri + 1}
                            rec={rec}
                            ri={ri + 1}
                            type={type}
                            domain={domain}
                            isNxDomain={isNxDomain}
                            showRawJson={showRawJson}
                            setShowRawJson={setShowRawJson}
                          />
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Expand / Collapse trigger button */}
                  <button
                    onClick={() => toggleGroup(sectionName, type)}
                    className="w-full py-1.5 border border-dashed border-ink/30 bg-ink/[0.01] hover:bg-ink hover:text-base hover:border-ink font-mono text-[8.5px] font-bold uppercase tracking-widest text-center cursor-pointer transition-all duration-100 hover:-translate-y-[0.5px] hover:shadow-[1.5px_1.5px_0_0_#0D0D0D] active:translate-y-0 active:shadow-none"
                  >
                    {isExpanded
                      ? `[-] COLLAPSE ${remainingRecords.length} RECORDS`
                      : `[+] EXPAND +${remainingRecords.length} MORE RECORDS`}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {recordType === 'ALL' && (
        <div className="border border-ink p-3 bg-white font-mono text-[9.5px] relative overflow-hidden shadow-[2px_2px_0_0_#0D0D0D] border-l-4 border-l-accent">
          <div className="flex justify-between items-center border-b border-ink/10 pb-1 mb-1.5 font-bold text-accent select-none">
            <span>SYNTHETIC BATCH INFO</span>
            <a
              href="https://blog.cloudflare.com/rfc8482-saying-goodbye-to-any/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline flex items-center gap-0.5 cursor-pointer hover:text-ink transition-colors"
            >
              RFC 8482 ↗
            </a>
          </div>
          <p className="text-ink/75 leading-relaxed">
            In standard DNS, querying for "all" records at once (ANY type) is blocked to prevent DDoS attacks.
            To build this list, DNS Observatory automatically resolved A, AAAA, MX, TXT, and NS records in parallel.
          </p>
        </div>
      )}

      {/* ANSWER SECTION */}
      <div className="flex flex-col gap-2.5">
        <div className="font-mono text-[9px] uppercase text-ink/40 tracking-wider font-bold select-none">
          :: Answer Section
        </div>
        {renderGroupedSection('answer', answers)}
      </div>

      {/* AUTHORITY SECTION */}
      <div className="flex flex-col gap-2">
        <div className="font-mono text-[9px] uppercase text-ink/40 tracking-wider font-bold select-none">
          :: Authority Section
        </div>
        {renderGroupedSection('authority', authorityRecords)}
      </div>

      {/* ADDITIONAL SECTION */}
      <div className="flex flex-col gap-2">
        <div className="font-mono text-[9px] uppercase text-ink/40 tracking-wider font-bold select-none">
          :: Additional Section
        </div>
        {renderGroupedSection('additional', additionalRecords)}
      </div>

      {/* Alternate Query Buttons (Quick Tracing) */}
      {!isNxDomain && (
        <div className="mt-2 pt-4 border-t border-ink/15 flex flex-col gap-2.5">
          <span className="font-mono text-[9px] uppercase text-accent font-bold tracking-wider select-none">
            Query Alternate Type
          </span>
          <div className="flex flex-wrap gap-2">
            {['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'PTR', 'SRV', 'ALL']
              .filter((t) => t !== recordType)
              .map((t) => (
                <button
                  key={t}
                  onClick={() => onAppendQuery(t)}
                  className="px-3 py-1.5 border border-ink bg-ink/5 font-mono text-[10px] font-bold text-ink hover:bg-ink hover:text-base transition-colors duration-100 cursor-pointer"
                >
                  {t === 'ALL' ? 'BATCH ALL' : `+ ${t}`}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
