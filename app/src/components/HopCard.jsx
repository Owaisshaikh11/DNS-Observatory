import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import FlagBadge from './FlagBadge';
import WaterfallBar from './WaterfallBar';
import RecordTable from './RecordTable';
import HexViewer from './HexViewer';

const HOP_COLORS_MAP = {
  CLIENT: 'border-ink bg-muted text-ink',
  LOCAL: 'border-ink bg-ink text-base',
  ROOT: 'border-ink bg-ink text-base',
  TLD: 'border-ink bg-ink text-base',
  AUTH: 'border-accent bg-accent text-base',
};

export default function HopCard({ hop, index, totalLatency, isSelected, onSelect, secondsElapsed = 0, isReached = true, compact = false }) {
  const [expanded, setExpanded] = useState(false);
  const [showHex, setShowHex] = useState(false);
  const cardRef = useRef(null);

  const isClient = hop.type === 'CLIENT';
  const hasResponse = hop.response && (
    (hop.response.answers && hop.response.answers.length > 0) ||
    (hop.response.authority && hop.response.authority.length > 0) ||
    (hop.response.additional && hop.response.additional.length > 0)
  );

  // Auto-scroll and auto-expand when selected via SVG Tree node click
  useEffect(() => {
    if (isSelected && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (!expanded && !isClient) {
        setExpanded(true);
      }
    }
  }, [isSelected]);

  const handleToggle = () => {
    if (!isClient && !compact) {
      setExpanded(!expanded);
    }
    onSelect(hop.id);
  };

  const showDnssec = hop.response?.dnssec && (
    hop.response.dnssec.rrsigPresent || 
    hop.response.dnssec.dnskeyPresent || 
    hop.response.dnssec.dsPresent
  );

  return (
    <div ref={cardRef} className="flex flex-col select-none">
      {/* Card Border Container */}
      <div
        className={`border border-ink transition-all duration-200 ${
          isSelected
            ? 'border-accent bg-white shadow-[2px_2px_0_0_rgba(255,77,0,0.12)]'
            : 'bg-white hover:border-ink/80 hover:translate-y-[-0.5px] hover:shadow-[1px_1px_0_0_rgba(13,13,13,1)]'
        } ${
          !isReached ? 'opacity-30 pointer-events-none filter grayscale select-none' : ''
        }`}
      >
        {/* Main Row / Header: Redesigned into 5-column layout aligning with telemetry scale */}
        <div
          onClick={handleToggle}
          className="interactive grid grid-cols-[28px_1.2fr_1.6fr_48px_68px] gap-3 p-2 items-center select-none cursor-pointer"
        >
          {/* Step Badge */}
          <div
            className={`w-6 h-6 flex items-center justify-center border font-mono text-[9.5px] font-bold select-none ${
              isClient
                ? 'border-ink bg-ink/10 text-ink/60'
                : hop.type === 'AUTH' || hop.response?.flags?.includes('AA')
                ? 'border-accent bg-accent text-white'
                : 'border-ink bg-ink text-white'
            }`}
          >
            {hop.step}
          </div>

          {/* Server Details */}
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] select-none">{isClient ? '🖥️' : (hop.geo?.flag || '🌐')}</span>
              <span className="font-display text-[9.5px] font-black uppercase tracking-tight truncate text-ink">
                {hop.label}
              </span>
              {hop.response?.flags?.includes('AA') && (
                <span className="font-mono text-[6.5px] px-0.5 bg-accent text-white font-bold select-none leading-none">
                  AUTH
                </span>
              )}
            </div>
            <div className="font-mono text-[7.5px] opacity-40 truncate">
              {hop.server && `${hop.server.split('.')[0]} · `}
              {hop.ip}
            </div>
          </div>

          {/* Proportional Latency Bar */}
          {hop.latencyMs > 0 ? (
            <WaterfallBar
              latencyMs={hop.latencyMs}
              cumulativeMs={hop.cumulativeMs}
              totalMs={totalLatency}
            />
          ) : (
            <div className="h-2.5 bg-ink/5 border border-ink/10 relative overflow-hidden" />
          )}

          {/* RTT Display */}
          <div className="font-mono text-[10px] font-bold text-accent text-right select-text">
            {hop.latencyMs}ms
          </div>

          {/* Status + Expand Arrow */}
          <div className="text-right flex items-center justify-end select-none">
            {hop.response?.rcode && (
              <span
                className={`font-mono text-[8px] font-bold px-1.5 py-0.5 border ${
                  hop.response.rcode === 'NOERROR'
                    ? 'border-green-500/30 bg-green-500/5 text-green-600'
                    : 'border-red-500/30 bg-red-500/5 text-red-600'
                }`}
              >
                {hop.response.rcode}
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
                        DNSSEC Cryptographic Signature Verified
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
