import { useState } from 'react';
import FlagBadge from './FlagBadge';
import RecordTable from './RecordTable';
import HexViewer from './HexViewer';
import { Download } from 'lucide-react';
import { exportHopPcap } from '../utils/pcapExporter';
import { useTraceStore } from '../stores/useTraceStore';

export default function HopInspector({ hop, secondsElapsed = 0 }) {
  const [showHex, setShowHex] = useState(false);

  // Placeholder screen if no hop is selected
  if (!hop) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center select-none bg-white font-mono text-[9.5px] text-ink/30 border border-ink/10 border-t-0">
        <div className="border border-dashed border-ink/20 p-6 flex flex-col items-center gap-3">
          <span>[ PACKET VIEWER ]</span>
          <span className="max-w-[220px] leading-relaxed uppercase">
            Select a resolver node from the delegation graph or waterfall list to view its packet details.
          </span>
        </div>
      </div>
    );
  }

  const isClient = hop.type === 'CLIENT';
  const showDnssec = hop.response?.dnssec && (
    hop.response.dnssec.rrsigPresent ||
    hop.response.dnssec.dnskeyPresent ||
    hop.response.dnssec.dsPresent
  );

  return (
    <div className="w-full h-full flex flex-col bg-white border border-ink/15 border-t-0 overflow-y-auto p-4 gap-4 selection:bg-accent selection:text-[var(--base)]">
      {/* Inspector Header */}
      <div className="flex flex-col border-b border-ink/15 pb-2.5 flex-none">
        <div className="flex justify-between items-center">
          <span className="font-display font-black text-xs uppercase text-ink tracking-tight">
            Hop {hop.step} // {hop.label}
          </span>
          {hop.response?.rcode && (
            <span
              className={`font-mono text-[8.5px] font-bold px-1.5 py-px border border-current select-none ${hop.response.rcode === 'NOERROR' ? 'text-success' : 'text-error'
                }`}
            >
              {hop.response.rcode}
            </span>
          )}
        </div>
        <div className="font-mono text-[8px] opacity-45 mt-1 leading-normal select-text">
          SERVER: {hop.type === 'CNAME_REDIRECT' ? 'None (Virtual Redirect)' : (hop.server || 'None')} · IP: {hop.type === 'CNAME_REDIRECT' ? 'None' : hop.ip} · RTT: {hop.latencyMs}ms <br />
          LOCATION: {hop.type === 'CNAME_REDIRECT' ? 'CNAME Record Routing' : `${hop.geo?.city || 'Unknown'}, ${hop.geo?.country || 'Local'}`} · ISP: {hop.type === 'CNAME_REDIRECT' ? 'CNAME Alias Mapping' : (hop.geo?.org || 'Local Network')}
        </div>
      </div>

      {/* Description Block */}
      <div className="font-mono text-[9px] text-ink/75 leading-relaxed italic select-text border-l border-accent/40 pl-3">
        {hop.description}
      </div>

      {/* Response Header Flags */}
      {hop.response?.flags && hop.response.flags.length > 0 && (
        <div className="flex flex-col gap-1 flex-none">
          <div className="font-mono text-[8px] text-ink/35 uppercase tracking-wider select-none">
            ;; Response Header Flags
          </div>
          <div className="flex flex-wrap gap-1 items-center">
            {hop.response.flags.map((f) => (
              <FlagBadge key={f} flag={f} />
            ))}
            <span className="font-mono text-[8px] text-ink/35 ml-2 select-none">
              RCODE: {hop.response.rcode}
            </span>
          </div>
        </div>
      )}

      {/* DNSSEC Status Box */}
      {showDnssec && (
        <div className="flex items-center gap-2 border border-green-500/25 bg-green-50/30 p-2 sharp-border select-none flex-none">
          <span className="text-[13px]">🔒</span>
          <div className="flex flex-col">
            <span className="font-mono text-[8.5px] font-bold text-success uppercase tracking-wider leading-none">
              DNSSEC Records Present
            </span>
            <span className="font-mono text-[7px] opacity-50 mt-0.5">
              Available Records:{' '}
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
        <div className="border border-ink/20 p-2.5 bg-base/40 flex flex-col gap-2 flex-none">
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

      {/* Answers Section */}
      {hop.response?.answers && hop.response.answers.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="font-mono text-[8px] text-ink/35 uppercase tracking-wider select-none">
            ;; Answer Section ({hop.response.answers.length})
          </div>
          <RecordTable
            records={hop.response.answers}
            accent={true}
            secondsElapsed={secondsElapsed}
          />
        </div>
      )}

      {/* Authority Section */}
      {hop.response?.authority && hop.response.authority.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="font-mono text-[8px] text-ink/35 uppercase tracking-wider select-none">
            ;; Authority Section ({hop.response.authority.length})
          </div>
          <RecordTable
            records={hop.response.authority}
            accent={false}
            secondsElapsed={secondsElapsed}
          />
        </div>
      )}

      {/* Additional Section */}
      {hop.response?.additional && hop.response.additional.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="font-mono text-[8px] text-ink/35 uppercase tracking-wider select-none">
            ;; Additional Section ({hop.response.additional.length})
          </div>
          <RecordTable
            records={hop.response.additional}
            accent={false}
            secondsElapsed={secondsElapsed}
          />
        </div>
      )}

      {/* Exporter and Hex Viewer Buttons */}
      {!isClient && hop.type !== 'CNAME_REDIRECT' && (
        <div className="mt-1 flex flex-col gap-2 flex-none font-mono">
          <button
            onClick={() => {
              const timestamp = useTraceStore.getState().traceData?.timestamp;
              exportHopPcap(hop, timestamp);
            }}
            className="text-[8px] font-bold px-2 py-1.5 border border-ink bg-white text-ink tracking-wider uppercase hover:bg-accent hover:border-accent hover:text-white transition-colors duration-150 cursor-pointer w-full text-center flex items-center justify-center gap-1.5 shadow-[2px_2px_0_0_#0D0D0D] hover:translate-y-[-0.5px] active:translate-y-0 active:shadow-none"
          >
            <Download className="w-3 h-3" />
            <span>Download Hop PCAP</span>
          </button>

          {hop.response?.rawHex && (
            <div>
              <button
                onClick={() => setShowHex(!showHex)}
                className="text-[8px] font-bold px-2 py-1.5 bg-ink text-base border border-ink tracking-wider uppercase hover:bg-accent hover:border-accent transition-colors duration-150 cursor-pointer w-full text-left flex justify-between select-none"
              >
                <span>{showHex ? '▲ Hide Raw Packet bytes' : '▼ Raw Packet bytes'}</span>
                <span>{showHex ? '[-]' : '[+]'}</span>
              </button>
              {showHex && (
                <div className="mt-2">
                  <HexViewer hexString={hop.response.rawHex} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
