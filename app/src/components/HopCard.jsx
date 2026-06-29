import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import FlagBadge from './FlagBadge';
import WaterfallBar from './WaterfallBar';
import RecordTable from './RecordTable';
import HexViewer from './HexViewer';
import CountryFlag from './CountryFlag';


const getResolverIcon = (ip, className = "w-3.5 h-3.5") => {
  const cleanIp = (ip || '').toString().trim();
  if (cleanIp === '1.1.1.1' || cleanIp === '1.0.0.1' || cleanIp.includes('cloudflare')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="#F38020" title="Cloudflare Resolver">
        <path d="M22.9 14.8c-.2-1.7-1.4-3.1-3.1-3.5.1-.4.1-.7.1-1.1 0-3-2.5-5.5-5.5-5.5-2.2 0-4.1 1.3-4.9 3.2C8.7 7.4 7.6 7 6.4 7 3.4 7 1 9.4 1 12.4c0 .4 0 .8.1 1.2C.4 14 0 14.9 0 15.8 0 17.6 1.4 19 3.2 19h18c1.5 0 2.8-1.2 2.8-2.7 0-.7-.3-1.2-.8-1.5z" />
      </svg>
    );
  }
  if (cleanIp === '8.8.8.8' || cleanIp === '8.8.4.4' || cleanIp.includes('google')) {
    return (
      <svg viewBox="0 0 24 24" className={className} title="Google Resolver">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" title="Recursive Resolver">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" strokeLinecap="round" />
      <line x1="6" y1="18" x2="6.01" y2="18" strokeLinecap="round" />
      <line x1="20" y1="6" x2="16" y2="6" strokeLinecap="round" />
      <line x1="20" y1="18" x2="16" y2="18" strokeLinecap="round" />
    </svg>
  );
};

const cleanOrg = (org) => {
  if (!org) return '';
  return org
    .replace(/^AS\d+\s+/g, '')
    .replace(/,?\s+(Inc\.|L\.L\.C\.|LLC|Corporation|Corp\.|Ltd\.)/g, '')
    .trim();
};

export default function HopCard({ hop, index, totalLatency, isSelected, onSelect, secondsElapsed = 0, isReached = true, isCompleted = true, compact = false }) {
  const [expanded, setExpanded] = useState(false);
  const [showHex, setShowHex] = useState(false);
  const cardRef = useRef(null);

  const isClient = hop.type === 'CLIENT';

  // Auto-scroll and auto-expand when selected via SVG Tree node click
  useEffect(() => {
    if (isSelected && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (!isClient) {
        const timer = setTimeout(() => {
          setExpanded(true);
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [isSelected, isClient]);

  const handleToggle = () => {
    if (!isClient && !compact && isCompleted) {
      setExpanded(!expanded);
    }
    onSelect(hop.id);
  };

  const showDnssec = hop.response?.dnssec && isCompleted && (
    hop.response.dnssec.rrsigPresent ||
    hop.response.dnssec.dnskeyPresent ||
    hop.response.dnssec.dsPresent
  );

  const isCname = hop.type === 'CNAME_REDIRECT';

  return (
    <div ref={cardRef} className="flex flex-col select-none mb-2.5 last:mb-0">
      {/* Card Border Container */}
      <div
        className={`border transition-all duration-200 ${isSelected
            ? isCname
              ? 'border-accent bg-accent text-white shadow-[2px_2px_0_0_#0D0D0D]'
              : 'border-ink bg-ink text-base shadow-[2.5px_2.5px_0_0_#FF4D00]'
            : 'border-ink bg-white hover:border-ink/80 hover:translate-y-[-0.5px] hover:shadow-[1px_1px_0_0_rgba(13,13,13,1)]'
          } ${!isReached ? 'opacity-30 pointer-events-none filter grayscale select-none' : ''
          }`}
      >
        {/* Main Row / Header: Redesigned into 5-column layout aligning with telemetry scale */}
        <div
          onClick={handleToggle}
          className="interactive grid grid-cols-[28px_1.2fr_1.5fr_64px_68px] gap-3 p-2 items-center select-none cursor-pointer"
        >
          {/* Step Badge */}
          <div
            className={`w-6 h-6 flex items-center justify-center border font-mono text-[9.5px] font-bold select-none ${isSelected
                ? 'border-base bg-base text-ink'
                : isClient
                  ? 'border-ink bg-ink/10 text-ink/60'
                  : hop.type === 'AUTH' || hop.response?.flags?.includes('AA')
                    ? 'border-accent bg-accent text-white'
                    : 'border-ink bg-ink text-white'
              }`}
          >
            {index + 1}
          </div>

          {/* Server Details */}
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] select-none flex items-center justify-center">
                {isClient ? '🖥️' : hop.type === 'LOCAL' ? (
                  getResolverIcon(hop.ip, "w-3.5 h-3.5")
                ) : (
                  <CountryFlag countryCode={hop.geo?.countryCode} fallbackFlag={hop.geo?.flag} />
                )}
              </span>
              <span className={`font-display text-[9.5px] font-black uppercase tracking-tight truncate ${isSelected ? 'text-white' : 'text-ink'}`}>
                {hop.label}
              </span>
              {hop.response?.flags?.includes('AA') && isCompleted && (
                <span className={`font-mono text-[6.5px] px-0.5 font-bold select-none leading-none ${isSelected ? 'bg-base text-ink' : 'bg-accent text-white'}`}>
                  AUTH
                </span>
              )}
              {showDnssec && (
                <span
                  className="text-[9px] select-none cursor-help leading-none shrink-0"
                  title="DNSSEC Verified"
                >
                  🔒
                </span>
              )}
            </div>
            <div className={`font-mono text-[7.5px] truncate ${isSelected ? 'text-white/60' : 'opacity-40 text-ink'}`}>
              {hop.server && `${hop.server.split('.')[0]} · `}
              {hop.ip}
            </div>
            {hop.geo?.org && (
              <div className={`font-mono text-[6.5px] truncate ${isSelected ? 'text-white/40' : 'text-ink/30'} mt-0.5 font-medium`}>
                {cleanOrg(hop.geo.org)}
              </div>
            )}
          </div>

          {/* Proportional Latency Bar */}
          {hop.latencyMs > 0 && isCompleted ? (
            <WaterfallBar
              latencyMs={hop.latencyMs}
              cumulativeMs={hop.cumulativeMs}
              totalMs={totalLatency}
            />
          ) : (
            <div className={`h-2.5 border relative overflow-hidden ${isSelected ? 'bg-white/10 border-white/10' : 'bg-ink/5 border-ink/10'}`} />
          )}

          {/* RTT Display */}
          <div className="flex flex-col items-end gap-0.5 min-w-0">
            <div className={`font-mono text-[10px] font-bold text-right select-text ${isSelected ? 'text-white' : 'text-accent'}`}>
              {isCompleted ? `${hop.latencyMs}ms` : '--'}
            </div>
            {hop.resolvedOverTcp && isCompleted && (
              <span className={`font-mono text-[6.5px] px-1 py-px border border-dashed select-none font-bold leading-none ${isSelected ? 'border-white/50 bg-white/10 text-white' : 'border-orange-500 bg-orange-500/5 text-orange-600'}`}>
                TCP
              </span>
            )}
          </div>

          {/* Status + Expand Arrow */}
          <div className="text-right flex items-center justify-end select-none">
            {hop.response?.rcode && isCompleted ? (
              <span
                className={`font-mono text-[8px] font-bold px-1.5 py-0.5 border ${isSelected
                    ? 'border-white/30 bg-white/10 text-white'
                    : hop.response.rcode === 'NOERROR'
                      ? 'border-green-500/30 bg-green-500/5 text-green-600'
                      : 'border-red-500/30 bg-red-500/5 text-red-600'
                  }`}
              >
                {hop.response.rcode}
              </span>
            ) : (
              <span className="font-mono text-[8px] opacity-45 px-1.5 py-0.5 border border-dashed select-none text-ink/65">
                PENDING
              </span>
            )}
          </div>
        </div>

        {/* Action/Trace Step Description */}
        {!compact && (
          <div className="font-mono text-[9px] opacity-50 px-[48px] pb-3.5 leading-relaxed select-text">
            {hop.description}
          </div>
        )}

        {/* Detailed Dropdown Panel */}
        <AnimatePresence initial={false}>
          {!compact && expanded && hop.response && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden border-t border-ink/10 bg-base/5"
            >
              <div className="p-4 flex flex-col gap-4">
                {/* Response Flags Row */}
                {hop.response.flags && hop.response.flags.length > 0 && (
                  <div>
                    <div className="font-mono text-[8px] text-ink/35 uppercase tracking-wider mb-1">
                      ;; Response Flags
                    </div>
                    <div className="flex flex-wrap gap-1 items-center">
                      {hop.response.flags.map((f) => (
                        <FlagBadge key={f} flag={f} />
                      ))}
                      <span className="font-mono text-[8.5px] text-ink/30 ml-2">
                        RCODE: {hop.response.rcode}
                      </span>
                    </div>
                  </div>
                )}

                {/* DNSSEC Sign Verification Box */}
                {showDnssec && (
                  <div className="flex items-center gap-2 border border-green-500/30 bg-green-500/5 px-3 py-2 sharp-border">
                    <span className="text-[14px]">🔒</span>
                    <div className="flex flex-col">
                      <span className="font-mono text-[9px] font-bold text-success uppercase tracking-wider leading-none">
                        DNSSEC Signature Present
                      </span>
                      <span className="font-mono text-[7.5px] opacity-50 mt-0.5">
                        Found records:{' '}
                        {[
                          hop.response.dnssec.rrsigPresent && 'RRSIG',
                          hop.response.dnssec.dnskeyPresent && 'DNSKEY',
                          hop.response.dnssec.dsPresent && 'DS',
                        ]
                          .filter(Boolean)
                          .join(' + ')}
                      </span>
                    </div>
                  </div>
                )}

                {/* Parallel Queries Timing Breakdown */}
                {hop.parallelQueries && hop.parallelQueries.length > 1 && (
                  <div className="border border-ink/20 p-2.5 bg-base/40 flex flex-col gap-2">
                    <div className="font-mono text-[8px] text-ink/40 uppercase tracking-widest font-bold select-none">
                      ;; Parallel Queries Timing Breakdown
                    </div>
                    <div className="flex flex-col gap-2.5">
                      {hop.parallelQueries.map((sub, sidx) => {
                        const maxLat = Math.max(...hop.parallelQueries.map(q => q.latencyMs), 1);
                        const pct = (sub.latencyMs / maxLat) * 100;
                        return (
                          <div key={sidx} className="grid grid-cols-[36px_1fr_40px_48px] gap-2 items-center font-mono text-[9px]">
                            <div className="font-bold text-accent">{sub.type}</div>
                            <div className="w-full h-2 bg-ink/5 border border-ink/10 relative overflow-hidden">
                              <div 
                                className="absolute top-0 bottom-0 left-0 bg-accent transition-all duration-300"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="text-right font-medium text-ink/80">{sub.latencyMs}ms</div>
                            <div className="text-right font-bold text-ink/45 text-[8.5px]">
                              {sub.rcode === 'TIMEOUT' ? 'TIMEOUT' : `${sub.byteLength}B`}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Section: Answers */}
                {hop.response.answers && hop.response.answers.length > 0 && (
                  <div>
                    <div className="font-mono text-[8px] text-ink/35 uppercase tracking-wider mb-1.5">
                      ;; Answer Section ({hop.response.answers.length})
                    </div>
                    <RecordTable
                      records={hop.response.answers}
                      accent={true}
                      secondsElapsed={secondsElapsed}
                    />
                  </div>
                )}

                {/* Section: Authority */}
                {hop.response.authority && hop.response.authority.length > 0 && (
                  <div>
                    <div className="font-mono text-[8px] text-ink/35 uppercase tracking-wider mb-1.5">
                      ;; Authority Section ({hop.response.authority.length})
                    </div>
                    <RecordTable
                      records={hop.response.authority}
                      accent={false}
                      secondsElapsed={secondsElapsed}
                    />
                  </div>
                )}

                {/* Section: Additional */}
                {hop.response.additional && hop.response.additional.length > 0 && (
                  <div>
                    <div className="font-mono text-[8px] text-ink/35 uppercase tracking-wider mb-1.5">
                      ;; Additional Section ({hop.response.additional.length})
                    </div>
                    <RecordTable
                      records={hop.response.additional}
                      accent={false}
                      secondsElapsed={secondsElapsed}
                    />
                  </div>
                )}

                {/* Section: Raw Hex Bytes collapsible */}
                {hop.response.rawHex && (
                  <div className="mt-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowHex(!showHex);
                      }}
                      className="font-mono text-[8.5px] font-bold px-2 py-1 bg-ink text-base border border-ink tracking-wider uppercase hover:bg-accent hover:border-accent transition-colors duration-150 cursor-pointer"
                    >
                      {showHex ? '▲ Hide Packet Bytes' : '▼ Raw Packet Bytes'}
                    </button>
                    <AnimatePresence>
                      {showHex && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden mt-2"
                        >
                          <HexViewer hexString={hop.response.rawHex} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
