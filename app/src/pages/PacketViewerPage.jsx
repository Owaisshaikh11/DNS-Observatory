import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { useTraceStore } from '../stores/useTraceStore';
import { usePacketStore } from '../stores/usePacketStore';
import { exportHopPcap, exportTracePcap } from '../utils/pcapExporter';
import InteractiveGrid from '../components/InteractiveGrid';
import {
  Activity,
  Terminal,
  Info,
  ChevronRight,
  Monitor,
  Download
} from 'lucide-react';

export default function PacketViewerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qParam = searchParams.get('q');
  const typeParam = searchParams.get('type') || 'ALL';

  const {
    domain,
    recordType,
    traceData,
  } = useTraceStore();

  const {
    selectedHopId,
    setSelectedHopId,
  } = usePacketStore();

  // 1. State Declarations
  const [activeTab, setActiveTab] = useState('RESPONSE'); // 'REQUEST' or 'RESPONSE'
  const [hoveredRange, setHoveredRange] = useState(null); // { start: number, end: number }
  const [activeParallelType, setActiveParallelType] = useState(null); // Selected parallel query type (A, AAAA, MX, etc.)
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);
  const [openNodes, setOpenNodes] = useState({
    header: true,
    questions: true,
    answers: true,
    authority: true,
    additional: true
  });

  // 2. Refs
  const downloadRef = useRef(null);
  const hexViewerContainerRef = useRef(null);

  // 3. Computed Variables
  const hops = useMemo(() => traceData?.hops || [], [traceData]);
  const currentHop = hops.find(h => h.id === selectedHopId) || hops[0];
  const isVirtualHop = currentHop?.type === 'CLIENT' || currentHop?.type === 'CNAME_REDIRECT';
  const hasMultipleParallel = currentHop?.parallelQueries && currentHop.parallelQueries.length > 1;

  // 4. Handlers
  const handleDownloadHopPcap = () => {
    if (currentHop) {
      exportHopPcap(currentHop, traceData?.timestamp);
    }
    setIsDownloadOpen(false);
  };

  const handleDownloadTracePcap = () => {
    if (hops && hops.length > 0) {
      exportTracePcap(hops, traceData?.timestamp, qParam || domain || 'dns-trace');
    }
    setIsDownloadOpen(false);
  };

  const toggleNode = (node) => {
    setOpenNodes(prev => ({ ...prev, [node]: !prev[node] }));
  };

  // 5. Side Effects (useEffects)
  // Reload trace data if query params are present but store is empty (e.g. page refresh)
  useEffect(() => {
    if (qParam && (!traceData || domain !== qParam)) {
      useTraceStore.setState({
        domain: qParam,
        recordType: typeParam,
      });
      useTraceStore.getState().startTrace(qParam, typeParam);
    }
  }, [qParam, typeParam, traceData, domain]);

  // ESC key handler to navigate back to resolution lab
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27) {
        e.preventDefault();
        e.stopPropagation();
        navigate(`/trace?q=${qParam || domain}&type=${typeParam || recordType}`);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, qParam, domain, typeParam, recordType]);

  // Click outside download dropdown handler
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (downloadRef.current && !downloadRef.current.contains(event.target)) {
        setIsDownloadOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Smoothly auto-scroll highlighted row in Hex grid into view
  useEffect(() => {
    if (hoveredRange && hexViewerContainerRef.current) {
      const rowIdx = Math.floor(hoveredRange.start / 16);
      const rowEl = hexViewerContainerRef.current.querySelector(`[data-row-index="${rowIdx}"]`);
      if (rowEl) {
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [hoveredRange]);

  // Set default selected hop on load/update
  useEffect(() => {
    if (hops.length > 0 && !selectedHopId) {
      // Default to first non-CLIENT hop if possible, otherwise first hop
      const defaultHop = hops.find(h => h.type !== 'CLIENT' && h.type !== 'CNAME_REDIRECT') || hops[0];
      setSelectedHopId(defaultHop.id);
    }
  }, [hops, selectedHopId, setSelectedHopId]);

  // Reset active parallel type when selected hop changes
  useEffect(() => {
    const targetType = hasMultipleParallel && currentHop ? currentHop.parallelQueries[0].type : null;
    const timer = setTimeout(() => {
      setActiveParallelType(prev => prev !== targetType ? targetType : prev);
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedHopId, hasMultipleParallel, currentHop]);

  // Resolve which request/response packet is active
  let activeQueryPacket = null;
  let activeResponsePacket = null;
  let isTimeout = false;
  let resolvedOverTcp = false;

  if (currentHop) {
    if (hasMultipleParallel && activeParallelType) {
      const sub = currentHop.parallelQueries.find(q => q.type === activeParallelType);
      if (sub) {
        activeQueryPacket = sub.queryPacket;
        activeResponsePacket = sub.responsePacket;
        isTimeout = sub.rcode === 'TIMEOUT';
        resolvedOverTcp = sub.resolvedOverTcp || false;
      }
    } else {
      activeQueryPacket = currentHop.queryPacket;
      activeResponsePacket = currentHop.response;
      resolvedOverTcp = currentHop.resolvedOverTcp || false;
    }
  }

  // Fallback to request tab if active response packet is missing/timed out
  useEffect(() => {
    const targetTab = (activeResponsePacket === null || isTimeout) ? 'REQUEST' : 'RESPONSE';
    const timer = setTimeout(() => {
      setActiveTab(prev => prev !== targetTab ? targetTab : prev);
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedHopId, activeParallelType, isTimeout, activeResponsePacket]);

  // Helper to trigger hex highlight
  const hoverBytes = (start, end) => {
    setHoveredRange(start !== null ? { start, end } : null);
  };

  // Render Custom Inline Synchronized Hex Viewer
  const renderSyncHexViewer = (hexString) => {
    if (!hexString) return (
      <div className="text-ink/40 text-[10.5px] uppercase italic text-center p-4">No byte stream payload available.</div>
    );

    const bytes = hexString.trim().split(/\s+/);
    const rows = [];
    for (let i = 0; i < bytes.length; i += 16) {
      rows.push(bytes.slice(i, i + 16));
    }

    return (
      <div ref={hexViewerContainerRef} className="bg-ink p-4 font-mono text-[10.5px] text-[#F0EDE8] overflow-x-auto border border-ink/40 h-full scrollbar-thin select-text">
        <div className="text-[10px] text-accent font-bold uppercase tracking-wider mb-3 select-none flex justify-between">
          <span>Packet Byte Grid // {bytes.length} bytes captured</span>
          {hoveredRange && (
            <span className="text-[#A6E22E] animate-pulse">
              Highlighting bytes {hoveredRange.start} - {hoveredRange.end - 1}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-0.5 min-w-[420px]">
          {rows.map((row, ri) => {
            const offset = (ri * 16).toString(16).padStart(4, '0').toUpperCase();
            return (
              <div key={ri} data-row-index={ri} className="flex gap-6 items-center leading-normal">
                {/* Offset column */}
                <span className="text-[#66D9EF]/45 select-none w-10 font-bold">{offset}</span>

                {/* Hex bytes column */}
                <span className="flex-1 tracking-wider">
                  {row.map((b, bi) => {
                    const globalIdx = ri * 16 + bi;
                    const isHovered = hoveredRange && globalIdx >= hoveredRange.start && globalIdx < hoveredRange.end;
                    const isTxId = globalIdx < 2;
                    const isFlags = globalIdx >= 2 && globalIdx < 4;
                    const upperByte = b.toUpperCase();

                    return (
                      <span
                        key={bi}
                        className={`inline-block text-center w-6 transition-all duration-100 ${isHovered
                          ? 'bg-accent text-white font-black scale-110 rounded-none'
                          : isTxId
                            ? 'text-[#F92672] font-bold'
                            : isFlags
                              ? 'text-[#AE81FF] font-semibold'
                              : ''
                          }`}
                        style={{ marginRight: bi === 7 ? '10px' : '6px' }}
                      >
                        {upperByte}
                      </span>
                    );
                  })}
                </span>

                {/* ASCII Column */}
                <span className="text-[#A6E22E]/65 font-semibold tracking-wider select-none w-24 text-right">
                  {row.map((b, bi) => {
                    const globalIdx = ri * 16 + bi;
                    const isHovered = hoveredRange && globalIdx >= hoveredRange.start && globalIdx < hoveredRange.end;
                    const charCode = parseInt(b, 16);
                    const isPrintable = charCode >= 32 && charCode <= 126;
                    const char = isPrintable ? String.fromCharCode(charCode) : '.';

                    return (
                      <span
                        key={bi}
                        className={isHovered ? 'text-accent font-black' : ''}
                      >
                        {char}
                      </span>
                    );
                  }).reduce((acc, curr) => acc + curr.props.children, '')}
                </span>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-3.5 pt-2 border-t border-base/10 text-[9.5px] text-[#F0EDE8]/45 flex gap-4 select-none">
          <span>
            <span className="text-[#F92672] font-bold mr-1">00-01</span>
            Transaction ID
          </span>
          <span>
            <span className="text-[#AE81FF] font-bold mr-1">02-03</span>
            Header Flags
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full h-full flex flex-col text-ink bg-base overflow-hidden selection:bg-accent selection:text-[var(--base)] relative z-10">
      <InteractiveGrid />

      {/* ── HEADER NAVIGATION STRIP ────────────────────────────────────────── */}
      <header className="h-[46px] border-b border-ink flex items-center justify-between px-4 font-mono text-[12px] sm:text-[13px] uppercase tracking-wider bg-base/80 backdrop-blur-md z-40 shrink-0 select-none">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(`/trace?q=${qParam || domain}&type=${typeParam || recordType}`)}
            className="opacity-50 hover:opacity-100 hover:text-accent transition-colors cursor-pointer"
          >
            ← ESC to resolution lab
          </button>
          <span className="opacity-30">|</span>
          <span className="font-bold flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-accent animate-pulse" />
            DNS Packet Viewer // {(qParam || domain || '').toUpperCase()}
          </span>
        </div>

        <div className="relative font-mono text-[11px] select-none" ref={downloadRef}>
          <button
            onClick={() => setIsDownloadOpen(!isDownloadOpen)}
            className="brutalist-select-trigger h-7 px-3 py-0 flex items-center gap-1.5 text-[10px] font-bold uppercase cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-accent" />
            <span>Export PCAP</span>
            <span className={`text-[8px] transition-transform duration-200 ${isDownloadOpen ? 'rotate-180' : ''}`}>▼</span>
          </button>

          <AnimatePresence>
            {isDownloadOpen && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-[calc(100%+4px)] w-[190px] brutalist-select-dropdown flex flex-col z-50 shadow-[3px_3px_0_0_#0D0D0D] border border-ink"
              >
                <button
                  disabled={!currentHop || isVirtualHop}
                  onClick={handleDownloadHopPcap}
                  className="brutalist-select-option text-left text-[10.5px] cursor-pointer outline-none hover:bg-ink hover:text-base disabled:opacity-30 disabled:pointer-events-none transition-colors border-b border-ink/10 px-3 py-2 flex items-center justify-between"
                >
                  <span>DOWNLOAD HOP PCAP</span>
                </button>
                <button
                  disabled={hops.length === 0}
                  onClick={handleDownloadTracePcap}
                  className="brutalist-select-option text-left text-[10.5px] cursor-pointer outline-none hover:bg-ink hover:text-base disabled:opacity-30 disabled:pointer-events-none transition-colors px-3 py-2 flex items-center justify-between"
                >
                  <span>DOWNLOAD TRACE PCAP</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      {/* ── MAIN ANALYZER SPLIT PANEL ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden w-full relative">

        {/* COLUMN 1: TRACE HOPS LIST (30% Width) */}
        <section className="w-full lg:w-[320px] xl:w-[380px] border-b lg:border-b-0 lg:border-r border-ink bg-base flex flex-col shrink-0 h-[280px] lg:h-full overflow-hidden z-20">
          <div className="h-[40px] border-b border-ink/20 flex items-center justify-between px-3 bg-ink/[0.02] select-none shrink-0 text-[11px] font-bold uppercase tracking-wider font-mono">
            <span className="flex items-center gap-1 font-display font-black text-xs tracking-wider"><Terminal className="w-3.5 h-3.5 text-accent" /> Trace Resolution Hops</span>
            <span className="opacity-30 text-[9.5px] font-mono">HOPS: {hops.length}</span>
          </div>

          {/* Scrolling Hops List */}
          <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2 bg-ink/[0.01]">
            {hops.length === 0 ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-ink/30 font-mono text-[11px] uppercase gap-2 select-none">
                <div className="w-5 h-5 border border-dashed border-ink/30 rounded-full flex items-center justify-center animate-spin">⌕</div>
                Awaiting trace session...
              </div>
            ) : (
              hops.map((hop, idx) => {
                const isSelected = hop.id === selectedHopId;
                const isVirtual = hop.type === 'CLIENT' || hop.type === 'CNAME_REDIRECT';

                return (
                  <div
                    key={hop.id}
                    onClick={() => setSelectedHopId(hop.id)}
                    className={`border p-3 font-mono text-[11px] transition-all cursor-pointer flex flex-col gap-1.5 hover:border-ink relative ${isSelected
                      ? 'bg-white border-ink shadow-[2.5px_2.5px_0_0_rgba(13,13,13,1)] z-10 translate-y-[-0.5px]'
                      : 'bg-base border-ink/15 text-ink/75 hover:bg-white'
                      }`}
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-1.5 font-bold">
                        <span className="text-accent select-none font-bold text-[9.5px]">HOP 0{idx}</span>
                        <span className="text-ink/35">::</span>
                        <span className="truncate max-w-[140px] uppercase text-[11.5px]" title={hop.label}>{hop.label}</span>
                      </div>
                      <span className={`px-1.5 text-[8px] border font-mono font-bold leading-none py-1 select-none shrink-0 ${isVirtual
                        ? 'text-ink/40 border-ink/20 bg-base/50'
                        : hop.response?.rcode === 'NOERROR'
                          ? 'text-green-600 border-green-600 bg-green-50/50'
                          : 'text-red-500 border-red-500 bg-red-50/50'
                        }`}>
                        {isVirtual ? 'VIRTUAL' : hop.type}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-[9.5px] text-ink/40 select-none font-medium">
                      <span>{isVirtual ? 'None (Virtual Node)' : `IP: ${hop.ip}`}</span>
                      {!isVirtual && (
                        <div className="flex items-center gap-1.5 font-bold shrink-0">
                          <span className={hop.response?.rcode === 'NOERROR' ? 'text-green-600' : 'text-red-500'}>
                            {hop.response?.rcode || 'ERR'}
                          </span>
                          <span className="opacity-30">|</span>
                          <span className="text-accent">{hop.latencyMs}ms</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="flex-1 bg-white flex flex-col overflow-hidden h-full z-20">
          <div className="h-[40px] border-b border-ink/20 flex items-center justify-between px-3 bg-ink/[0.02] select-none shrink-0 font-mono text-[11px] uppercase font-bold tracking-wider relative">
            <span className="flex items-center gap-1.5 font-display font-black text-xs tracking-wider"><Info className="w-3.5 h-3.5 text-accent" /> Packet Dissect Console</span>

            {/* Parallel record selector inside the console bar */}
            {hasMultipleParallel && (
              <div className="flex items-center gap-1.5 border border-ink bg-base p-1 shrink-0 text-[9.5px] font-bold h-7.5 select-none font-mono">
                <span className="opacity-45 pl-1 select-none">BATCH:</span>
                {currentHop.parallelQueries.map((q) => {
                  const isSubSel = activeParallelType === q.type;
                  return (
                    <button
                      key={q.type}
                      onClick={() => setActiveParallelType(q.type)}
                      className={`px-2 py-0.5 border text-[9px] font-black cursor-pointer transition-all ${isSubSel
                        ? 'bg-accent border-accent text-white'
                        : 'border-ink/15 text-ink/60 hover:border-ink/40 bg-white/40'
                        }`}
                    >
                      {q.type}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Request vs Response Tabs */}
            {currentHop && !isVirtualHop && (
              <div className="flex select-none h-full items-end self-end">
                <button
                  onClick={() => setActiveTab('REQUEST')}
                  className={`px-4.5 h-[34px] text-[9.5px] font-bold transition-all cursor-pointer flex items-center border-t-2 border-x ${activeTab === 'REQUEST'
                    ? 'bg-white border-t-accent border-x-ink/20 border-b border-b-transparent text-ink z-10 translate-y-[1px]'
                    : 'bg-transparent border-t-transparent border-x-transparent border-b border-b-transparent text-ink/50 hover:text-ink'
                    }`}
                >
                  REQUEST PACKET
                </button>
                <button
                  onClick={() => setActiveTab('RESPONSE')}
                  disabled={activeResponsePacket === null || isTimeout}
                  className={`px-4.5 h-[34px] text-[9.5px] font-bold transition-all cursor-pointer disabled:opacity-20 disabled:pointer-events-none flex items-center border-t-2 border-x ${activeTab === 'RESPONSE'
                    ? 'bg-white border-t-accent border-x-ink/20 border-b border-b-transparent text-ink z-10 translate-y-[1px]'
                    : 'bg-transparent border-t-transparent border-x-transparent border-b border-b-transparent text-ink/50 hover:text-ink'
                    }`}
                >
                  RESPONSE PACKET
                </button>
              </div>
            )}
          </div>

          {/* Split Workspace */}
          {!currentHop ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-ink/30 font-mono text-[12px] uppercase gap-2.5 select-none">
              Awaiting Trace Hop Selection...
            </div>
          ) : isVirtualHop ? (
            /* Virtual Hop Info Notice screen */
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-white select-none font-mono">
              <div className="border border-dashed border-ink/20 p-8 max-w-sm flex flex-col items-center gap-4">
                <div className="text-2xl animate-pulse">⚡</div>
                <span className="text-[13px] font-bold text-accent uppercase tracking-wider">
                  Virtual Hop: {currentHop.type}
                </span>
                <p className="text-[11px] text-ink/65 uppercase leading-relaxed font-semibold">
                  This step representing a {currentHop.type === 'CLIENT' ? 'client stub setup' : 'cname redirection'} is handled internally. No physical wire packets were generated or transmitted.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">

              {/* Upper: Dissector Tree */}
              <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3 font-mono text-[11.5px] leading-normal border-b border-ink/10 select-text">

                {/* 1. Capture Node Frame */}
                {renderFrameNode(
                  activeTab === 'REQUEST' ? activeQueryPacket : activeResponsePacket,
                  traceData.timestamp,
                  currentHop.ip,
                  currentHop.port,
                  activeTab,
                  resolvedOverTcp
                )}

                {/* 2. DNS Protocol Node Tree */}
                {renderDnsProtocolNode(
                  activeTab === 'REQUEST' ? activeQueryPacket : activeResponsePacket,
                  activeTab,
                  openNodes,
                  toggleNode,
                  hoverBytes,
                  isTimeout,
                  resolvedOverTcp
                )}

              </div>

              {/* Lower: Hex Sync Panel */}
              <div className="h-[230px] sm:h-[260px] shrink-0 border-t border-ink bg-ink">
                {renderSyncHexViewer(
                  activeTab === 'REQUEST'
                    ? activeQueryPacket?.rawHex
                    : activeResponsePacket?.rawHex
                )}
              </div>

            </div>
          )}
        </section>

      </div>
    </div>
  );
}

// ── SUBCOMPONENTS & LOGIC HELPERS ──────────────────────────────────────────

// Decode RCODE helper
const getRcodeDescription = (rcodeNum, name) => {
  const rcodes = {
    0: 'No error (0)',
    1: 'Format error (1)',
    2: 'Server failure (2)',
    3: 'Non-existent domain (3)',
    4: 'Not implemented (4)',
    5: 'Query refused (5)'
  };
  return rcodes[rcodeNum] || `${name} (${rcodeNum})`;
};

// Opcode descriptions
const getOpcodeDescription = (opcodeNum) => {
  const opcodes = {
    0: 'Standard query (0)',
    1: 'Inverse query (1)',
    2: 'Server status request (2)',
    4: 'Notify (4)',
    5: 'Update (5)'
  };
  return opcodes[opcodeNum] || `Unknown (${opcodeNum})`;
};

// DNSSEC algorithms helper
const getAlgorithmDescription = (algNum, name) => {
  return `${name} (${algNum})`;
};

// ── DISSECTOR NODES RENDERING ──────────────────────────────────────────────

// Render Frame Node (Metadata details)
function renderFrameNode(packet, timestamp, ip, port, tab, resolvedOverTcp) {
  if (!packet) return null;
  const date = new Date(timestamp || Date.now());
  const timeString = `${date.toISOString()}`;

  const bytesCount = packet.rawHex ? packet.rawHex.trim().split(/\s+/).length : 0;

  return (
    <div className="border border-ink/10 bg-base/40 p-3 font-mono flex flex-col gap-1 select-none leading-relaxed">
      <div className="font-bold flex items-center gap-1.5 text-ink/75 text-[12.5px]">
        <Monitor className="w-3.5 h-3.5 text-accent" />
        Frame: {bytesCount} bytes on wire, {bytesCount} bytes captured
      </div>
      <div className="pl-4 text-[10px] text-ink/50 flex flex-col gap-0.5 mt-1 font-medium select-text border-b border-ink/5 pb-2">
        <span>• Arrival Time: {timeString}</span>
        <span>• Protocols in Frame: {resolvedOverTcp ? 'TCP' : 'UDP'} ({port || 53}) &rarr; DNS</span>
        <span>• Name Server Host Target: {ip || '127.0.0.1'}:{port || 53}</span>
        <span>• Capture Size: {bytesCount} bytes ({bytesCount * 8} bits)</span>
      </div>
      <div className="mt-2.5 p-2.5 border border-dashed border-ink/20 bg-ink/[0.02] font-mono text-[9px] text-ink/65 flex items-start gap-2 select-none leading-relaxed">
        <Info className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-accent">NOTICE:</span> Ethernet/IP/{resolvedOverTcp ? 'TCP' : 'UDP'} framing {resolvedOverTcp ? '(including SYN/ACK handshake) ' : ''}and client IP/MAC are simulated for PCAP compatibility as browsers lack raw socket access. The DNS payload and nameserver IP are real.
        </div>
      </div>
    </div>
  );
}

// Render Collapsible DNS Tree Node
function renderDnsProtocolNode(packet, tab, openNodes, toggleNode, hoverBytes, isTimeout, resolvedOverTcp) {
  if (isTimeout && tab === 'RESPONSE') {
    return (
      <div className="text-red-500 text-[11px] font-bold uppercase p-4 border border-dashed border-red-500/20 bg-red-50/20 font-mono">
        [-] Query Timed Out. No {resolvedOverTcp ? 'TCP' : 'UDP'} response packet was received from the nameserver.
      </div>
    );
  }

  if (!packet) return (
    <div className="text-ink/40 text-[11px] italic select-none font-mono">Packet payload missing for this segment.</div>
  );

  const rawFlags = packet.rawFlags || 0;
  const txIdString = '0x' + (packet.id !== undefined ? packet.id.toString(16).toUpperCase().padStart(4, '0') : '0000');
  const rawFlagsString = '0x' + rawFlags.toString(16).toUpperCase().padStart(4, '0');

  // Decode individual flag bits
  const isResponse = (rawFlags & 0x8000) !== 0;
  const opcode = (rawFlags & 0x7800) >> 11;
  const isAuth = (rawFlags & 0x0400) !== 0;
  const isTruncated = (rawFlags & 0x0200) !== 0;
  const isRecDesired = (rawFlags & 0x0100) !== 0;
  const isRecAvail = (rawFlags & 0x0080) !== 0;
  const isAuthentic = (rawFlags & 0x0020) !== 0;
  const isCheckingDisabled = (rawFlags & 0x0010) !== 0;
  const rcode = rawFlags & 0x000f;

  return (
    <div className="flex flex-col gap-2 mt-3">

      {/* 2A. Main DNS node header */}
      <div className="font-bold text-ink uppercase text-[11px] tracking-wide select-none flex items-center gap-1 border-b border-ink/10 pb-1.5">
        Domain Name System ({isResponse ? 'Response' : 'Query'})
      </div>

      {/* 2B. Transaction ID */}
      <div
        onMouseEnter={() => hoverBytes(0, 2)}
        onMouseLeave={() => hoverBytes(null)}
        className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-text"
      >
        <span>Transaction ID: <strong className="font-bold font-mono">{txIdString}</strong></span>
        <span className="text-[9.5px] opacity-40 uppercase font-semibold">bytes [0-1]</span>
      </div>

      {/* 2C. Flags Collapsible Node */}
      <div className="flex flex-col font-mono">
        <div
          onClick={() => toggleNode('header')}
          onMouseEnter={() => hoverBytes(2, 4)}
          onMouseLeave={() => hoverBytes(null)}
          className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-none cursor-pointer"
        >
          <span className="flex items-center font-bold">
            <ChevronRight className={`w-3.5 h-3.5 text-accent transition-transform duration-200 ${openNodes.header ? 'rotate-90' : ''}`} />
            Flags: {rawFlagsString} ({isResponse ? 'Response' : 'Query'}, RCODE: {packet.rcode || (isResponse ? 'NOERROR' : 'QUERY')})
          </span>
          <span className="text-[9.5px] opacity-40 uppercase font-semibold">bytes [2-3]</span>
        </div>

        <AnimatePresence>
          {openNodes.header && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden pl-6 border-l border-ink/10 flex flex-col gap-0.5 text-[10px] text-ink/75 py-1"
            >
              <div>{isResponse ? '1' : '0'}... .... .... .... = Response: Message is a {isResponse ? 'response' : 'query'}</div>
              <div>.{opcode.toString(2).padStart(4, '0')} .... .... = Opcode: {getOpcodeDescription(opcode)}</div>
              <div>.... .{isAuth ? '1' : '0'}.. .... .... = Authoritative: Server {isAuth ? 'is' : 'is NOT'} an authority for this zone</div>
              <div>.... ..{isTruncated ? '1' : '0'}. .... .... = Truncated: Message {isTruncated ? 'is' : 'is NOT'} truncated</div>
              <div>.... ...{isRecDesired ? '1' : '0'} .... .... = Recursion desired: Client {isRecDesired ? 'wants' : 'does NOT want'} recursive validation</div>
              {isResponse && (
                <div>.... .... {isRecAvail ? '1' : '0'}... .... = Recursion available: Server {isRecAvail ? 'supports' : 'does NOT support'} recursion</div>
              )}
              <div>.... .... .{isAuthentic ? '1' : '0'}.. .... = Answer authenticated: Data {isAuthentic ? 'is' : 'is NOT'} DNSSEC authenticated</div>
              <div>.... .... ..{isCheckingDisabled ? '1' : '0'}. .... = Checking disabled: DNSSEC validation {isCheckingDisabled ? 'disabled' : 'enabled'}</div>
              <div>.... .... .... {rcode.toString(2).padStart(4, '0')} = Reply code: {getRcodeDescription(rcode, packet.rcode || 'NOERROR')}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 2D. Count Nodes */}
      <div
        onMouseEnter={() => hoverBytes(4, 6)} onMouseLeave={() => hoverBytes(null)}
        className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-text"
      >
        <span>Questions count: {packet.qdcount}</span>
        <span className="text-[9.5px] opacity-40 uppercase font-semibold">bytes [4-5]</span>
      </div>
      <div
        onMouseEnter={() => hoverBytes(6, 8)} onMouseLeave={() => hoverBytes(null)}
        className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-text"
      >
        <span>Answer RRs count: {packet.ancount}</span>
        <span className="text-[9.5px] opacity-40 uppercase font-semibold">bytes [6-7]</span>
      </div>
      <div
        onMouseEnter={() => hoverBytes(8, 10)} onMouseLeave={() => hoverBytes(null)}
        className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-text"
      >
        <span>Authority RRs count: {packet.nscount}</span>
        <span className="text-[9.5px] opacity-40 uppercase font-semibold">bytes [8-9]</span>
      </div>
      <div
        onMouseEnter={() => hoverBytes(10, 12)} onMouseLeave={() => hoverBytes(null)}
        className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-text"
      >
        <span>Additional RRs count: {packet.arcount}</span>
        <span className="text-[9.5px] opacity-40 uppercase font-semibold">bytes [10-11]</span>
      </div>

      {/* 2E. Questions Section */}
      <div className="flex flex-col font-mono mt-1.5">
        <div
          onClick={() => toggleNode('questions')}
          className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-none cursor-pointer"
        >
          <span className="flex items-center font-bold text-[11px]">
            <ChevronRight className={`w-3.5 h-3.5 text-accent transition-transform duration-200 ${openNodes.questions ? 'rotate-90' : ''}`} />
            Question Section ({packet.questions?.length || 0} questions)
          </span>
        </div>

        <AnimatePresence>
          {openNodes.questions && packet.questions && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="pl-4 flex flex-col gap-2 py-1"
            >
              {packet.questions.map((q, qidx) => (
                <div
                  key={qidx}
                  onMouseEnter={() => hoverBytes(q.startOffset, q.endOffset)}
                  onMouseLeave={() => hoverBytes(null)}
                  className="pl-3 border-l-2 border-ink/20 py-1 hover:bg-accent/5 hover:border-accent flex flex-col gap-0.5 text-[10px] text-ink/75"
                >
                  <div className="font-bold text-[11px] text-ink font-mono flex justify-between select-text">
                    <span>• {q.name}: type {q.typeName}, class IN</span>
                    <span className="text-[9px] opacity-40 uppercase font-semibold select-none">
                      bytes [{q.startOffset}-{q.endOffset - 1}]
                    </span>
                  </div>
                  <div className="pl-3 flex flex-col gap-0.5 font-medium select-text">
                    <span>Name: {q.name}</span>
                    <span>Type: {q.typeName} ({q.type})</span>
                    <span>Class: IN (0x0001)</span>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 2F. Answers Section */}
      {packet.answers && packet.answers.length > 0 && (
        <div className="flex flex-col font-mono mt-1.5">
          <div
            onClick={() => toggleNode('answers')}
            className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-none cursor-pointer"
          >
            <span className="flex items-center font-bold text-[11px]">
              <ChevronRight className={`w-3.5 h-3.5 text-accent transition-transform duration-200 ${openNodes.answers ? 'rotate-90' : ''}`} />
              Answers Section ({packet.answers.length} records)
            </span>
          </div>

          <AnimatePresence>
            {openNodes.answers && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="pl-4 flex flex-col gap-2 py-1"
              >
                {packet.answers.map((ans, idx) => (
                  <div
                    key={idx}
                    onMouseEnter={() => hoverBytes(ans.startOffset, ans.endOffset)}
                    onMouseLeave={() => hoverBytes(null)}
                    className="pl-3 border-l-2 border-ink/20 py-1 hover:bg-accent/5 hover:border-accent flex flex-col gap-0.5 text-[10px] text-ink/75"
                  >
                    <div className="font-bold text-[11px] text-ink font-mono flex justify-between select-text">
                      <span>• {ans.name}: type {ans.typeName}, class IN</span>
                      <span className="text-[9px] opacity-40 uppercase font-semibold select-none">
                        bytes [{ans.startOffset}-{ans.endOffset - 1}]
                      </span>
                    </div>
                    {renderResourceRecordValue(ans)}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* 2G. Authority Section */}
      {packet.authority && packet.authority.length > 0 && (
        <div className="flex flex-col font-mono mt-1.5">
          <div
            onClick={() => toggleNode('authority')}
            className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-none cursor-pointer"
          >
            <span className="flex items-center font-bold text-[11px]">
              <ChevronRight className={`w-3.5 h-3.5 text-accent transition-transform duration-200 ${openNodes.authority ? 'rotate-90' : ''}`} />
              Authority Section ({packet.authority.length} records)
            </span>
          </div>

          <AnimatePresence>
            {openNodes.authority && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="pl-4 flex flex-col gap-2 py-1"
              >
                {packet.authority.map((ns, idx) => (
                  <div
                    key={idx}
                    onMouseEnter={() => hoverBytes(ns.startOffset, ns.endOffset)}
                    onMouseLeave={() => hoverBytes(null)}
                    className="pl-3 border-l-2 border-ink/20 py-1 hover:bg-accent/5 hover:border-accent flex flex-col gap-0.5 text-[10px] text-ink/75"
                  >
                    <div className="font-bold text-[11px] text-ink font-mono flex justify-between select-text">
                      <span>• {ns.name}: type {ns.typeName}, class IN</span>
                      <span className="text-[9px] opacity-40 uppercase font-semibold select-none">
                        bytes [{ns.startOffset}-{ns.endOffset - 1}]
                      </span>
                    </div>
                    {renderResourceRecordValue(ns)}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* 2H. Additional Section */}
      {packet.additional && packet.additional.length > 0 && (
        <div className="flex flex-col font-mono mt-1.5">
          <div
            onClick={() => toggleNode('additional')}
            className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-none cursor-pointer"
          >
            <span className="flex items-center font-bold text-[11px]">
              <ChevronRight className={`w-3.5 h-3.5 text-accent transition-transform duration-200 ${openNodes.additional ? 'rotate-90' : ''}`} />
              Additional Records Section ({packet.additional.length} records)
            </span>
          </div>

          <AnimatePresence>
            {openNodes.additional && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="pl-4 flex flex-col gap-2 py-1"
              >
                {packet.additional.map((add, idx) => (
                  <div
                    key={idx}
                    onMouseEnter={() => hoverBytes(add.startOffset, add.endOffset)}
                    onMouseLeave={() => hoverBytes(null)}
                    className="pl-3 border-l-2 border-ink/20 py-1 hover:bg-accent/5 hover:border-accent flex flex-col gap-0.5 text-[10px] text-ink/75"
                  >
                    <div className="font-bold text-[11px] text-ink font-mono flex justify-between select-text">
                      <span>• {add.name}: type {add.typeName}, class IN</span>
                      <span className="text-[9px] opacity-40 uppercase font-semibold select-none">
                        bytes [{add.startOffset}-{add.endOffset - 1}]
                      </span>
                    </div>
                    {renderResourceRecordValue(add)}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

    </div>
  );
}

// Helper: Dissects RR Type Value fields
function renderResourceRecordValue(ans) {
  if (ans.isOpt && ans.optDetails) {
    const opt = ans.optDetails;
    return (
      <div className="pl-3 flex flex-col gap-0.5 font-medium select-text">
        <span>Name: {ans.name}</span>
        <span>Type: OPT (41)</span>
        <span>Sender's UDP payload size: {opt.udpPayloadSize} bytes</span>
        <span>EDNS0 Version: {opt.version}</span>
        <span>DO bit (DNSSEC OK): {opt.dnssecOk ? '1 (Accepts validation records)' : '0'}</span>
        <span>Extended RCODE: 0x{opt.extendedRcode.toString(16).toUpperCase().padStart(2, '0')}</span>

        {/* ECS Option values */}
        {opt.options && opt.options.length > 0 && (
          <div className="mt-1 pl-3 border-l border-ink/10 flex flex-col">
            <span className="font-bold text-accent uppercase text-[8.5px] select-none tracking-wide">EDNS Options:</span>
            {opt.options.map((o, idx) => (
              <div key={idx} className="pl-1">
                • {o.name}: {typeof o.value === 'object' ? `${o.value.address}/${o.value.sourceMask} (Scope mask: /${o.value.scopeMask})` : o.value}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // standard fields
  return (
    <div className="pl-2 flex flex-col font-medium select-text">
      <span>Name: {ans.name}</span>
      <span>Type: {ans.typeName} ({ans.typeNum})</span>
      <span>TTL: {ans.ttl}s</span>
      {ans.typeNum === 1 || ans.typeNum === 28 || ans.typeNum === 5 || ans.typeNum === 2 || ans.typeNum === 12 ? (
        <span>Address/Target: {ans.value}</span>
      ) : ans.typeNum === 15 ? (
        <span>MX Preference: {ans.value.preference} | Mail server exchange: {ans.value.exchange}</span>
      ) : ans.typeNum === 33 && typeof ans.value === 'object' ? ( // SRV
        <div className="pl-2 border-l border-ink/10 flex flex-col gap-0.5">
          <span>Priority: {ans.value.priority} | Weight: {ans.value.weight}</span>
          <span>Port: {ans.value.port}</span>
          <span>Target host: {ans.value.target}</span>
        </div>
      ) : ans.typeNum === 6 ? (
        <div className="pl-2 border-l border-ink/10 flex flex-col gap-0.5">
          <span>Primary DNS nameserver: {ans.value.mname}</span>
          <span>Admin mailbox: {ans.value.rname}</span>
          <span>Serial: {ans.value.serial}</span>
          <span>Refresh: {ans.value.refresh}s | Retry: {ans.value.retry}s</span>
          <span>Expire: {ans.value.expire}s | Minimum TTL: {ans.value.minimum}s</span>
        </div>
      ) : ans.typeNum === 46 && typeof ans.value === 'object' ? ( // RRSIG
        <div className="pl-2 border-l border-ink/10 flex flex-col gap-0.5">
          <span>Type Covered: {ans.value.typeCovered}</span>
          <span>Algorithm: {getAlgorithmDescription(ans.value.algorithm, ans.value.algorithmName)}</span>
          <span>Key Tag: {ans.value.keyTag}</span>
          <span>Signature Inception: {ans.value.inceptionDate}</span>
          <span>Signature Expiration: {ans.value.expirationDate}</span>
          <span>Signer hostname: {ans.value.signerName}</span>
        </div>
      ) : ans.typeNum === 48 && typeof ans.value === 'object' ? ( // DNSKEY
        <div className="pl-2 border-l border-ink/10 flex flex-col gap-0.5">
          <span>Key Flags: {ans.value.flags} (Zone Key: {ans.value.isZoneKey ? '1' : '0'}, KSK: {ans.value.isSep ? '1' : '0'})</span>
          <span>Protocol: {ans.value.protocol}</span>
          <span>Algorithm: {getAlgorithmDescription(ans.value.algorithm, ans.value.algorithmName)}</span>
          <span>Key Length: {ans.value.keyLength} bytes</span>
        </div>
      ) : ans.typeNum === 43 && typeof ans.value === 'object' ? ( // DS
        <div className="pl-2 border-l border-ink/10 flex flex-col gap-0.5">
          <span>Key Tag: {ans.value.keyTag}</span>
          <span>Algorithm: {getAlgorithmDescription(ans.value.algorithm, ans.value.algorithmName)}</span>
          <span>Digest Type: {ans.value.digestTypeName} ({ans.value.digestType})</span>
          <span className="break-all">Digest hash: {ans.value.digest}</span>
        </div>
      ) : (
        <span>Value: {typeof ans.value === 'object' ? JSON.stringify(ans.value) : ans.value}</span>
      )}
    </div>
  );
}
