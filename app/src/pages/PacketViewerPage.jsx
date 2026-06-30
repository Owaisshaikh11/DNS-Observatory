import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { useTraceStore } from '../stores/useTraceStore';
import { exportHopPcap, exportTracePcap } from '../utils/pcapExporter';
import InteractiveGrid from '../components/InteractiveGrid';
import PacketHexViewer from '../components/PacketHexViewer';
import DnsDissectorTree from '../components/DnsDissectorTree';
import {
  Activity,
  Terminal,
  Info,
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
    selectedHopId,
    setSelectedHopId,
  } = useTraceStore();

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

  // Click outside to close download dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (downloadRef.current && !downloadRef.current.contains(e.target)) {
        setIsDownloadOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update selection if no hop is selected but list loads
  useEffect(() => {
    if (hops.length > 0 && !selectedHopId) {
      const defaultHop = hops.find(h => h.type !== 'CLIENT' && h.type !== 'CNAME_REDIRECT') || hops[0];
      setSelectedHopId(defaultHop.id);
    }
  }, [hops, selectedHopId, setSelectedHopId]);

  // Update active parallel type when selection changes
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
                <DnsDissectorTree
                  packet={activeTab === 'REQUEST' ? activeQueryPacket : activeResponsePacket}
                  timestamp={traceData.timestamp}
                  ip={currentHop.ip}
                  port={currentHop.port}
                  tab={activeTab}
                  resolvedOverTcp={resolvedOverTcp}
                  isTimeout={isTimeout}
                  openNodes={openNodes}
                  toggleNode={toggleNode}
                  hoverBytes={hoverBytes}
                />
              </div>

              {/* Lower: Hex Sync Panel */}
              <div className="h-[230px] sm:h-[260px] shrink-0 border-t border-ink bg-ink">
                <PacketHexViewer
                  hexString={
                    activeTab === 'REQUEST'
                      ? activeQueryPacket?.rawHex
                      : activeResponsePacket?.rawHex
                  }
                  hoveredRange={hoveredRange}
                />
              </div>

            </div>
          )}
        </section>

      </div>
    </div>
  );
}
