import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { Info } from 'lucide-react';
import { useTraceStore } from '../stores/useTraceStore';
import CompactTree from '../components/CompactTree';
import HopCard from '../components/HopCard';
import HopInspector from '../components/HopInspector';
import InteractiveGrid from '../components/InteractiveGrid';
import CacheDrawer from '../components/CacheDrawer';
import ConsoleLogger from '../components/ConsoleLogger';
import VisualizerControls from '../components/VisualizerControls';
import CnameChain from '../components/CnameChain';
import RecordSection from '../components/RecordSection';
import usePlaybackEngine from '../hooks/usePlaybackEngine';

export default function VisualizerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qParam = searchParams.get('q');
  const typeParam = searchParams.get('type') || 'ALL';
  const benchmarkParam = searchParams.get('benchmark') === 'true';
  const resolverParam = searchParams.get('resolver') || '1.1.1.1 (Cloudflare)';

  const {
    domain,
    recordType,
    traceData,
    traceError,
    activeStep,
    playbackState,
    isSlowMo,
    setActiveStep,
    selectedHop,
    setSelectedHop,
    replayTrace,
    isBenchmarkMode,
    benchmarkData,
    isBenchmarking,
    toggleSlowMo,
    resolver,
    cancelPendingRequests,
  } = useTraceStore();

  const [showLabNotes, setShowLabNotes] = useState(false);
  const [isCacheOpen, setIsCacheOpen] = useState(false);
  const [showNudge, setShowNudge] = useState(false);

  const handleToggleCacheDrawer = () => {
    setIsCacheOpen((prev) => !prev);
    setShowNudge(false);
    sessionStorage.setItem('dns_cache_nudge_shown', 'true');
  };

  // Split resizer and panel collapse overrides state
  const [waterfallHeight, setWaterfallHeight] = useState(45);
  const [isWaterfallCollapsed, setIsWaterfallCollapsed] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const rightPanelRef = useRef(null);

  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      if (!rightPanelRef.current) return;
      const rect = rightPanelRef.current.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      const percent = (relativeY / rect.height) * 100;
      // Clamp between 15% and 85% to ensure panels don't disappear completely during drag
      setWaterfallHeight(Math.max(15, Math.min(85, percent)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Retrace on reload if query parameters are present but traceData is empty
  useEffect(() => {
    if (qParam && (!traceData || domain !== qParam)) {
      useTraceStore.setState({
        domain: qParam,
        recordType: typeParam,
        isBenchmarkMode: benchmarkParam,
        resolver: resolverParam,
      });
      useTraceStore.getState().startTrace(qParam, typeParam);
    }
  }, [qParam, typeParam, benchmarkParam, resolverParam, traceData, domain]);

  const hops = traceData?.hops || [];
  const edges = traceData?.edges || [];
  const status = traceData?.status || 'PENDING';
  const totalLatency = traceData?.totalLatency || 0;
  const cnameChain = traceData?.cnameChain || [];

  // Playback timer loop runs via custom playback hook
  usePlaybackEngine({
    playbackState,
    activeStep,
    setActiveStep,
    isSlowMo,
    traceData,
    edgesLength: edges.length
  });

  // Show Coach-Mark nudge tooltip once the first trace completes in this session
  useEffect(() => {
    let active = true;
    if ((playbackState === 'COMPLETE' || playbackState === 'NXDOMAIN') && traceData && !traceData.isCacheHit) {
      const shown = sessionStorage.getItem('dns_cache_nudge_shown') === 'true';
      if (!shown) {
        const timer = setTimeout(() => {
          if (active) {
            setShowNudge(true);
          }
        }, 50);
        return () => {
          active = false;
          clearTimeout(timer);
        };
      }
    }
  }, [playbackState, traceData]);

  // Handle Playback Actions
  const handlePrev = useCallback(() => {
    if (activeStep > 0) {
      useTraceStore.setState({ playbackState: 'PAUSED' });
      setActiveStep(activeStep - 1);
    }
  }, [activeStep, setActiveStep]);

  const handleNext = useCallback(() => {
    if (activeStep < edges.length) {
      useTraceStore.setState({ playbackState: 'PAUSED' });
      setActiveStep(activeStep + 1);
    }
  }, [activeStep, edges.length, setActiveStep]);

  const handleReplay = useCallback(() => {
    replayTrace();
  }, [replayTrace]);

  const togglePlayback = useCallback(() => {
    if (playbackState === 'COMPLETE' || playbackState === 'NXDOMAIN') {
      handleReplay();
    } else {
      useTraceStore.setState({
        playbackState: playbackState === 'PLAYING' ? 'PAUSED' : 'PLAYING',
      });
    }
  }, [playbackState, handleReplay]);

  const handleReset = useCallback(() => {
    cancelPendingRequests();
    navigate('/');
  }, [cancelPendingRequests, navigate]);

  // Unmount cleanup to cancel active requests
  useEffect(() => {
    return () => {
      cancelPendingRequests();
    };
  }, [cancelPendingRequests]);

  // Keyboard navigation & playback shortcuts (Esc, Space, Arrows, R/r keys)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27) {
        e.preventDefault();
        e.stopPropagation();
        handleReset();
        return;
      }

      const key = e.key.toLowerCase();
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlayback();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (key === 'r') {
        handleReplay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleReset, togglePlayback, handleNext, handlePrev, handleReplay]);


  // Trigger alternate query type
  const handleAppendQuery = (type) => {
    setShowNudge(false);
    useTraceStore.setState({ recordType: type });
    useTraceStore.getState().startTrace(domain, type);
    navigate(`/trace?q=${domain}&type=${type}&benchmark=${isBenchmarkMode}&resolver=${encodeURIComponent(resolver)}`);
  };



  // No active trace session
  if (!qParam) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-base brutalist-grid select-none px-6">
        <div className="w-full max-w-md border border-ink p-8 bg-base shadow-[4px_4px_0_0_#0D0D0D] flex flex-col gap-6">
          <div className="flex justify-between items-center border-b border-ink/20 pb-4">
            <h2 className="font-display font-black text-xl uppercase tracking-tighter leading-none">
              No Trace Session
            </h2>
            <span className="font-mono text-[9px] text-error font-bold tracking-widest">
              INVALID REQUEST
            </span>
          </div>

          <p className="font-sans text-xs opacity-70 leading-relaxed">
            There is no active DNS resolution session. Please specify a target domain on the home page to start a new topographical trace.
          </p>

          <button
            onClick={() => navigate('/')}
            className="w-full py-3 border border-ink bg-ink text-base font-mono text-[11px] font-bold uppercase tracking-widest hover:bg-accent hover:border-accent transition-colors duration-150 cursor-pointer"
          >
            ← Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Loader / Loading State
  if (!traceData) {
    if (traceError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-base brutalist-grid select-none px-6">
          <div className="w-full max-w-md border-2 border-ink p-8 bg-white shadow-[8px_8px_0_0_#EF4444] flex flex-col gap-6">
            <div className="flex justify-between items-center border-b border-ink/20 pb-4">
              <h2 className="font-display font-black text-xl uppercase tracking-tighter leading-none text-red-500">
                Query Failed
              </h2>
              <span className="font-mono text-[9px] text-error font-bold tracking-widest border border-error px-1 bg-red-50">
                ERROR
              </span>
            </div>

            <div className="flex flex-col gap-3 font-mono text-[11px] leading-relaxed text-ink/80">
              <div className="flex items-center gap-2">
                <span className="text-red-500 font-bold">✕</span>
                <span className="font-bold">{traceError.toUpperCase()}</span>
              </div>
              <p className="font-sans text-[11px] text-ink/65 mt-2">
                The query could not be completed. If this is a rate-limiting message (HTTP 429), please wait a few minutes before trying again. Otherwise, check that the domain name is valid.
              </p>
            </div>

            <button
              onClick={handleReset}
              className="w-full py-3 border border-ink bg-ink text-base font-mono text-[11px] font-bold uppercase tracking-widest hover:bg-red-500 hover:text-white hover:border-red-500 transition-colors duration-150 cursor-pointer shadow-[2px_2px_0_0_#0D0D0D] active:translate-y-[2px] active:shadow-none"
            >
              ← Return to Dashboard
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-base brutalist-grid select-none px-6">
        <div className="w-full max-w-md border border-ink p-8 bg-base shadow-[4px_4px_0_0_#0D0D0D] flex flex-col gap-6">
          <div className="flex justify-between items-center border-b border-ink/20 pb-4">
            <h2 className="font-display font-black text-xl uppercase tracking-tighter leading-none">
              Resolving Domain
            </h2>
            <span className="font-mono text-[9px] text-accent animate-pulse font-bold tracking-widest">
              TRACING SEQUENCE
            </span>
          </div>

          <div className="flex flex-col gap-3 font-mono text-[10px] leading-relaxed">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-green-500 animate-ping"></div>
              <span>TARGET QUERY: {domain?.toUpperCase()}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink/40">[-]</span>
              <span>CONNECTING PROTOCOL: DNS UDP/TCP PORT 53</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink/40">[-]</span>
              <span>QUERYING ROOT TIER REFERENCES...</span>
            </div>
          </div>

          <div className="w-full h-2.5 border border-ink bg-base relative overflow-hidden">
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
              className="absolute top-0 bottom-0 w-1/3 bg-accent"
            />
          </div>

          <div className="font-mono text-[8px] opacity-40 text-center uppercase tracking-wide">
            Est. Latency &lt; 500ms // Initializing Iterative Resolve
          </div>
        </div>
      </div>
    );
  }

  // Get current status indicator variables
  const isNxDomain = status === 'NXDOMAIN';
  const liveStatus = playbackState === 'PLAYING' ? 'LIVE' : isNxDomain ? 'ERR' : playbackState === 'PAUSED' ? 'PAUSED' : 'DONE';
  const statusColor = liveStatus === 'LIVE' ? 'bg-accent animate-pulse' : isNxDomain ? 'bg-muted' : playbackState === 'PAUSED' ? 'bg-accent' : 'bg-green-500';

  // Compute live countdown TTL based on minimum answer record TTL
  const answers = traceData?.answers || [];

  // Retrieve authority and additional records from final hop response
  const finalHop = hops[hops.length - 1];
  const authorityRecords = finalHop?.response?.authority || [];
  const additionalRecords = finalHop?.response?.additional || [];

  // Get currently inspected hop (selected hop or defaults to active playback step)
  const activeEdge = edges.find(e => e.step === activeStep);
  const defaultInspectedHop = activeEdge
    ? (hops.find(h => h.id === activeEdge.to) || hops.find(h => h.id === activeEdge.from))
    : hops[hops.length - 1];

  const currentInspectedHop = hops.find((h) => h.id === selectedHop) || defaultInspectedHop || hops[0];

  const getHudStats = (hop) => {
    if (!hop) return null;
    const flags = hop.response?.flags || [];
    const rcode = hop.response?.rcode || 'PENDING';
    const isClient = hop.type === 'CLIENT' || hop.type === 'CNAME_REDIRECT';

    const targetDisplay = (() => {
      if (hop.type === 'LOCAL') {
        const isCacheHit = hop.label && hop.label.includes('Cache Hit');
        return isCacheHit ? 'LOCAL CACHE' : (hop.ip || '1.1.1.1');
      }
      if (hop.type === 'CLIENT') {
        return 'LOCAL MACHINE';
      }
      if (hop.type === 'CNAME_REDIRECT') {
        return 'CNAME ALIAS';
      }
      return hop.server ? `${hop.ip} (${hop.server})` : (hop.ip || 'UNKNOWN');
    })();

    return (
      <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2 select-none">
        <div className="border border-ink bg-base p-1.5 flex flex-col font-mono text-[9px] gap-0.5 shadow-[1px_1px_0_0_#0D0D0D] min-w-0" title={targetDisplay}>
          <span className="opacity-40 uppercase text-[7.5px] font-bold">Target Server</span>
          <span className="font-bold text-ink truncate">{targetDisplay}</span>
        </div>
        <div className="border border-ink bg-base p-1.5 flex flex-col font-mono text-[9px] gap-0.5 shadow-[1px_1px_0_0_#0D0D0D]">
          <span className="opacity-40 uppercase text-[7.5px] font-bold">Payload standard</span>
          <span className="font-bold text-ink">{isClient ? 'NONE' : 'EDNS0 (1232B)'}</span>
        </div>
        <div className="border border-ink bg-base p-1.5 flex flex-col font-mono text-[9px] gap-0.5 shadow-[1px_1px_0_0_#0D0D0D] min-w-0">
          <span className="opacity-40 uppercase text-[7.5px] font-bold">Header flags</span>
          <span className="font-bold text-accent truncate" title={flags.map(f => `[${f}]`).join(' ')}>
            {flags.length > 0 ? flags.map(f => `[${f}]`).join(' ') : '[NONE]'}
          </span>
        </div>
        <div className="border border-ink bg-base p-1.5 flex flex-col font-mono text-[9px] gap-0.5 shadow-[1px_1px_0_0_#0D0D0D]">
          <span className="opacity-40 uppercase text-[7.5px] font-bold">Response code</span>
          <span className={`font-bold uppercase ${rcode === 'NOERROR' ? 'text-green-600' : rcode === 'NXDOMAIN' || rcode === 'ERR' ? 'text-red-500' : 'text-ink'}`}>
            {hop.type === 'CNAME_REDIRECT' ? 'CNAME' : rcode}
          </span>
        </div>
      </div>
    );
  };



  return (
    <div className="w-full h-full flex flex-col text-ink bg-base overflow-hidden selection:bg-accent selection:text-[var(--base)] relative z-10">
      <InteractiveGrid />

      {/* HEADER: Exactly matches ESC | WWW.DOMAIN.COM · TYPE: ALL format from prototype */}
      <header className="h-[40px] border-b border-ink flex items-center justify-between px-4 font-mono text-[11px] uppercase tracking-wider bg-base/80 backdrop-blur-md z-40 shrink-0 select-none">
        <div className="flex items-center gap-4">
          <button
            onClick={handleReset}
            className="opacity-50 hover:opacity-100 hover:text-accent transition-colors cursor-pointer"
          >
            ← ESC
          </button>
          <span className="opacity-30">|</span>
          <span className="font-bold select-all">{domain.toUpperCase()}</span>
          <span className="opacity-30">·</span>
          <span>TYPE: {recordType}</span>
        </div>

        <div className="flex items-center gap-6">
        <VisualizerControls
          activeStep={activeStep}
          edgesLength={edges.length}
          playbackState={playbackState}
          isSlowMo={isSlowMo}
          isCacheOpen={isCacheOpen}
          showNudge={showNudge}
          handlePrev={handlePrev}
          handleNext={handleNext}
          togglePlayback={togglePlayback}
          toggleSlowMo={toggleSlowMo}
          handleReplay={handleReplay}
          handleToggleCacheDrawer={handleToggleCacheDrawer}
          onInspectPackets={() => navigate(`/packet-viewer?q=${domain}&type=${recordType}`)}
        />

          {/* Core Uplink Status */}
          <div className="flex items-center gap-2 w-20 justify-end select-none">
            <div className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
            <span className="text-[10px] font-bold">{liveStatus}</span>
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT: Split horizontally inside viewport */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden w-full relative">

        {/* LEFT PANEL: CNAME chain & Hierarchical Record inspector in a single unified scroll container */}
        <aside className="w-full lg:w-[300px] xl:w-[340px] flex-none border-b lg:border-b-0 lg:border-r border-ink bg-base flex flex-col z-20 shrink-0 h-[300px] lg:h-full overflow-hidden">

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
            {/* CNAME Chain Explorer */}
            <CnameChain
              domain={domain}
              playbackState={playbackState}
              isNxDomain={isNxDomain}
              cnameChain={cnameChain}
              recordType={recordType}
            />

            {/* Section separator */}
            <div className="h-[1px] bg-ink/10 my-0.5 select-none" />

            {/* Hierarchical Inspector */}
            <div>
              <span className="font-mono text-[9px] uppercase opacity-45 block mb-4 tracking-wider select-none font-bold">
                Hierarchical Inspector
              </span>

              {playbackState === 'COMPLETE' || isNxDomain ? (
                <RecordSection
                  domain={domain}
                  recordType={recordType}
                  answers={answers}
                  authorityRecords={authorityRecords}
                  additionalRecords={additionalRecords}
                  isNxDomain={isNxDomain}
                  onAppendQuery={handleAppendQuery}
                />
              ) : (
                <div className="font-mono text-[9.5px] opacity-30 uppercase animate-pulse select-none">
                  Awaiting resolution data...
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* CENTER PANEL: Centers SVG path tree. Holds benchmark stats at bottom */}
        <main className="flex-1 flex flex-col bg-transparent overflow-hidden z-20">

          {/* Structured Header Strip */}
          <div className="h-[40px] border-b border-ink flex items-center justify-between px-6 font-mono text-[9px] uppercase tracking-wider bg-base/90 backdrop-blur-md z-30 shrink-0 select-none">
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="font-display font-black text-xs uppercase tracking-tight text-ink">
                  Spatial Resolution Path
                </span>
                <button
                  onMouseEnter={() => setShowLabNotes(true)}
                  onMouseLeave={() => setShowLabNotes(false)}
                  className={`p-0.5 hover:text-accent cursor-pointer transition-colors ${showLabNotes ? 'text-accent' : 'text-ink/60'}`}
                  title="Resolution Lab Info"
                >
                  <Info size={11} className="stroke-[2.5]" />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Connection Type Legend */}
              <div className="flex items-center gap-3.5 text-[8.5px] font-bold">
                <div className="flex items-center gap-1.5" title="Outbound DNS query">
                  <span className="w-4 h-0.5 bg-[#2563EB] block rounded-sm" />
                  <span className="opacity-80">Query</span>
                </div>
                <div className="flex items-center gap-1.5" title="Iterative delegation referral response">
                  <span className="w-4 h-0.5 border-t-2 border-dashed border-[#FF4D00] block" />
                  <span className="opacity-80">Referral (Response)</span>
                </div>
                <div className="flex items-center gap-1.5" title="Final authoritative answer">
                  <span className="w-4 h-0.5 bg-[#22C55E] block rounded-sm" />
                  <span className="opacity-80">Final Answer</span>
                </div>
              </div>
              <span className="opacity-30">|</span>
              {/* Authoritative response AA legend */}
              <div className="flex items-center gap-1" title="Authoritative Answer: Response came directly from the zone's authoritative nameserver (not cached).">
                <span className="opacity-50">Auth:</span>
                <span className="text-[6px] font-mono font-bold px-0.5 bg-accent text-white border border-accent leading-none cursor-help">
                  AA
                </span>
              </div>
              <span className="opacity-30">|</span>
              {/* TCP Failover legend */}
              <div className="flex items-center gap-1" title="TCP Failover: Query resolved over a TCP connection because the primary UDP response was truncated (TC=1).">
                <span className="opacity-50">Protocol:</span>
                <span className="text-[6px] font-mono font-bold px-0.5 border border-dashed border-orange-500 text-orange-600 bg-orange-500/5 leading-none cursor-help">
                  TCP
                </span>
              </div>
            </div>
          </div>

          {/* Main workspace containing centered canvas and HUD, aligned in width */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center gap-4 justify-between relative">
            {/* Floating Lab Notes Overlay */}
            {showLabNotes && (
              <div
                onMouseEnter={() => setShowLabNotes(true)}
                onMouseLeave={() => setShowLabNotes(false)}
                className="absolute top-6 left-6 z-50 w-[300px] border border-ink bg-base p-4 shadow-[3px_3px_0_0_#0D0D0D] font-mono text-[9px] flex flex-col gap-3"
              >
                <div className="flex justify-between items-center border-b border-ink/20 pb-2">
                  <span className="font-black text-accent uppercase tracking-wider">:: Resolution Lab Notes</span>
                </div>
                <div className="flex flex-col gap-2.5 leading-relaxed text-ink/80 select-text">
                  <div>
                    <span className="font-bold text-ink uppercase block mb-0.5">1. Cache Bypassed (Demo mode)</span>
                    To visualize the complete trace, cache records are bypassed. Every lookup starts fresh from Root hints (`.`) down to the authoritative servers.
                  </div>
                  <div>
                    <span className="font-bold text-ink uppercase block mb-0.5">2. Single-Path Traversal</span>
                    Standard delegations return multiple redundant nameservers. The graph shows the active path queried rather than a branching tree of alternative servers.
                  </div>
                  <div>
                    <span className="font-bold text-ink uppercase block mb-0.5">3. Out-of-band Glue Fallback</span>
                    If a referred nameserver has no glue record, it is resolved out-of-band (via `1.1.1.1`) to obtain its IP and continue tracing seamlessly.
                  </div>
                  <div>
                    <span className="font-bold text-ink uppercase block mb-0.5">4. TCP Failover Support</span>
                    If a UDP query response is truncated (indicated by the `TC = 1` flag), the resolver automatically establishes a TCP connection on port 53 to fetch the complete response payload.
                  </div>
                </div>
              </div>
            )}

            {/* SVG Tree Graph */}
            <div className="w-full flex-1 flex items-center justify-center z-20">
              <CompactTree
                hops={hops}
                edges={edges}
                selectedHop={selectedHop}
                onSelectHop={setSelectedHop}
                activeStep={activeStep}
                playbackState={playbackState}
                recordType={recordType}
                isCacheHit={traceData?.isCacheHit}
              />
            </div>

            {/* Keyboard Shortcuts Legend Bar */}
            <div className="font-mono text-[8px] opacity-45 uppercase tracking-widest flex flex-wrap gap-x-4 gap-y-1 select-none z-30 mb-2 border border-dashed border-ink/20 px-3 py-1 bg-base/50">
              <span>[SPACE] PLAY/PAUSE</span>
              <span>·</span>
              <span>[← / →] STEP</span>
              <span>·</span>
              <span>[R] REPLAY</span>
              <span>·</span>
              <span>[ESC] EXIT</span>
            </div>

            {/* Console Logger & Benchmark Unified HUD Panel */}
            <div className="w-full max-w-[950px] bg-base/80 backdrop-blur-md flex flex-col shrink-0 select-text z-20 border border-ink p-3 shadow-[3px_3px_0_0_#0D0D0D] border-t-2 border-t-accent mb-2">
              {/* HUD Indicators */}
              {getHudStats(currentInspectedHop)}

              {/* Layout Grid: 1 column default, 2 columns (col-span 3 & 2) on benchmark completion */}
              <div className={`grid grid-cols-1 ${isBenchmarkMode && (playbackState === 'COMPLETE' || isNxDomain) && benchmarkData ? 'md:grid-cols-5' : ''} gap-3`}>

                {/* Monospace Scrolling Console */}
                <ConsoleLogger
                  hops={hops}
                  activeStep={activeStep}
                  domain={domain || qParam || ''}
                  recordType={recordType || typeParam || 'ALL'}
                  isBenchmarkMode={isBenchmarkMode}
                  playbackState={playbackState}
                  isNxDomain={isNxDomain}
                  benchmarkData={benchmarkData}
                />

                {/* Benchmark comparison side panel */}
                {isBenchmarkMode && (playbackState === 'COMPLETE' || isNxDomain) && (
                  <div className="md:col-span-2 border border-ink p-3 bg-base flex flex-col gap-2 shadow-[1.5px_1.5px_0_0_#0D0D0D] justify-center min-w-0">
                    <div className="flex justify-between items-center border-b border-ink/20 pb-1 select-none">
                      <span className="font-display font-black text-[9px] uppercase tracking-tight text-ink truncate">
                        Resolver Latency Benchmark
                      </span>
                      <span className="font-mono text-[7.5px] text-accent font-bold tracking-wider shrink-0">
                        RTT COMP
                      </span>
                    </div>

                    {isBenchmarking ? (
                      <div className="font-mono text-[8px] opacity-40 text-center py-2 animate-pulse uppercase tracking-wider select-none">
                        [ Benchmarking public resolvers... ]
                      </div>
                    ) : benchmarkData ? (
                      <div className="flex flex-col gap-2.5 font-mono text-[9px]">
                        {/* Cloudflare bar */}
                        <div className="flex flex-col gap-0.5">
                          <div className="flex justify-between items-center text-[8.5px]">
                            <span className="font-bold truncate">1.1.1.1 (CF)</span>
                            <span className="font-bold text-accent">{benchmarkData.cloudflare.latencyMs}ms</span>
                          </div>
                          <div className="w-full h-2.5 bg-ink/5 border border-ink relative overflow-hidden">
                            <div
                              className="absolute top-0 bottom-0 left-0 bg-accent transition-all duration-500"
                              style={{
                                width: `${Math.min(
                                  (benchmarkData.cloudflare.latencyMs /
                                    Math.max(
                                      benchmarkData.cloudflare.latencyMs,
                                      benchmarkData.google.latencyMs
                                    )) *
                                  100,
                                  100
                                )}%`,
                              }}
                            />
                            {benchmarkData.cloudflare.latencyMs < benchmarkData.google.latencyMs && (
                              <span className="absolute right-0.5 top-0.5 text-[5.5px] bg-green-500 text-base font-bold px-0.5 select-none z-10 leading-none">
                                FASTEST
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Google bar */}
                        <div className="flex flex-col gap-0.5">
                          <div className="flex justify-between items-center text-[8.5px]">
                            <span className="font-bold truncate">8.8.8.8 (GOOGLE)</span>
                            <span className="font-bold text-accent">{benchmarkData.google.latencyMs}ms</span>
                          </div>
                          <div className="w-full h-2.5 bg-ink/5 border border-ink relative overflow-hidden">
                            <div
                              className="absolute top-0 bottom-0 left-0 bg-accent transition-all duration-500"
                              style={{
                                width: `${Math.min(
                                  (benchmarkData.google.latencyMs /
                                    Math.max(
                                      benchmarkData.cloudflare.latencyMs,
                                      benchmarkData.google.latencyMs
                                    )) *
                                  100,
                                  100
                                )}%`,
                              }}
                            />
                            {benchmarkData.google.latencyMs < benchmarkData.cloudflare.latencyMs && (
                              <span className="absolute right-0.5 top-0.5 text-[5.5px] bg-green-500 text-base font-bold px-0.5 select-none z-10 leading-none">
                                FASTEST
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="font-mono text-[8px] opacity-35 text-center py-2 select-none">
                        No benchmark data.
                      </div>
                    )}
                  </div>
                )}

              </div>
            </div>

          </div>

          {/* Legend moved to top-right */}

        </main>

        {/* RIGHT PANEL: resizable and collapsible waterfall list & telemetry inspector */}
        <section
          ref={rightPanelRef}
          className="w-full lg:w-[380px] xl:w-[440px] flex-none border-t lg:border-t-0 lg:border-l border-ink flex flex-col h-full bg-base/90 backdrop-blur-sm overflow-hidden z-20"
        >
          {isWaterfallCollapsed ? (
            /* Minimized Waterfall Timeline strip */
            <div className="h-[36px] flex-none border-b border-ink flex items-center justify-between px-4 bg-base/50 select-none">
              <span className="font-mono text-[9px] opacity-60 uppercase font-bold tracking-wider">
                RESOLUTION HOPS & TIMINGS [COLLAPSED]
              </span>
              <button
                onClick={() => setIsWaterfallCollapsed(false)}
                className="px-2 py-0.5 border border-ink bg-base text-ink font-mono text-[8px] font-bold hover:bg-ink hover:text-base cursor-pointer"
              >
                [+] EXPAND
              </button>
            </div>
          ) : (
            /* Top Half: Waterfall Latency list */
            <div
              className={`flex flex-col overflow-hidden border-b border-ink ${isInspectorCollapsed ? 'flex-1 border-b-0' : ''
                }`}
              style={!isInspectorCollapsed ? { height: `${waterfallHeight}%` } : undefined}
            >
              <div className="px-4 py-3 border-b border-ink/10 flex justify-between items-center select-none bg-base/50 flex-none">
                <span className="font-mono text-[10.5px] opacity-75 uppercase tracking-widest font-bold">
                  RESOLUTION HOPS & TIMINGS
                </span>
                <div className="flex items-center gap-4">
                  <span className="font-mono text-[9.5px] opacity-50 font-bold">
                    RTT INDEX
                  </span>
                  <button
                    onClick={() => setIsWaterfallCollapsed(true)}
                    className="px-2 py-0.5 border border-ink/20 hover:border-ink hover:text-accent font-mono text-[8px] font-bold cursor-pointer"
                    title="Collapse Panel"
                  >
                    [-] COLLAPSE
                  </button>
                </div>
              </div>

              {/* Waterfall Scale Grid labels */}
              <div className="px-4 bg-ink/[0.02] border-b border-ink/10 shrink-0">
                <div className="grid grid-cols-[28px_1.2fr_1.5fr_64px_68px] gap-3 px-2 py-1.5 font-mono text-[9.5px] uppercase tracking-wider text-ink/60 select-none items-center font-bold border border-transparent">
                  <div>Hop</div>
                  <div>Node</div>
                  <div className="relative flex flex-col justify-end select-none pr-2 w-full h-7">
                    <div className="w-full h-[1px] bg-ink/20 relative mb-1">
                      {/* Tick 0% */}
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[1px] h-1.5 bg-ink/40" />
                      <span className="absolute left-0 -top-4 font-mono text-[8px] text-ink/50 leading-none">0ms</span>

                      {/* Ticks 25%, 50%, 75% */}
                      {[25, 50, 75].map((pct) => {
                        const tickMs = Math.round((pct / 100) * totalLatency);
                        return (
                          <div
                            key={pct}
                            style={{ left: `${pct}%` }}
                            className="absolute top-1/2 -translate-y-1/2 w-[1px] h-2 bg-ink/30 hover:bg-accent group/tick cursor-help"
                          >
                            <span className="absolute bottom-3.5 left-1/2 -translate-x-1/2 bg-ink text-base font-mono text-[7px] px-1 py-0.5 whitespace-nowrap opacity-0 group-hover/tick:opacity-100 transition-opacity pointer-events-none shadow-[2px_2px_0_0_#FF4D00] border border-accent leading-none z-30">
                              {tickMs}ms
                            </span>
                          </div>
                        );
                      })}

                      {/* Tick 100% */}
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[1px] h-1.5 bg-ink/40" />
                      <span className="absolute right-0 -top-4 font-mono text-[8px] text-accent leading-none font-bold">{totalLatency}ms</span>
                    </div>
                  </div>
                  <div className="text-right">RTT</div>
                  <div className="text-right">Status</div>
                </div>
              </div>

              {/* Compact Waterfall List */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-0 scroll-smooth">
                {hops.map((hop, i) => (
                  <HopCard
                    key={hop.id}
                    hop={hop}
                    index={i}
                    totalLatency={totalLatency}
                    isSelected={selectedHop === hop.id || (!selectedHop && activeStep === i)}
                    onSelect={setSelectedHop}
                    isReached={i <= activeStep}
                    isCompleted={hop.type === 'LOCAL' ? (activeStep >= hops.length - 1) : (i <= activeStep)}
                    compact={true}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Resizer Divider Bar */}
          {!isWaterfallCollapsed && !isInspectorCollapsed && (
            <div
              onMouseDown={handleMouseDown}
              onDoubleClick={() => setWaterfallHeight(45)}
              className="h-2 bg-base border-t border-b border-ink hover:bg-accent transition-colors duration-150 cursor-row-resize flex items-center justify-center select-none shrink-0 z-30 group"
              title="Drag to resize / Double-click to reset"
            >
              <div className="flex gap-[3px]">
                <div className="w-1.5 h-[1.5px] bg-ink group-hover:bg-white" />
                <div className="w-1.5 h-[1.5px] bg-ink group-hover:bg-white" />
                <div className="w-1.5 h-[1.5px] bg-ink group-hover:bg-white" />
              </div>
            </div>
          )}

          {isInspectorCollapsed ? (
            /* Minimized Hop Details Inspector strip */
            <div className="h-[36px] flex-none border-t border-ink flex items-center justify-between px-4 bg-base/5 select-none">
              <span className="font-mono text-[9px] opacity-60 uppercase font-bold text-ink tracking-wider">
                Hop Details Inspector [COLLAPSED]
              </span>
              <button
                onClick={() => setIsInspectorCollapsed(false)}
                className="px-2 py-0.5 border border-ink bg-base text-ink font-mono text-[8px] font-bold hover:bg-ink hover:text-base cursor-pointer"
              >
                [+] EXPAND
              </button>
            </div>
          ) : (
            /* Bottom Half: Hop Details Inspector */
            <div
              className={`flex flex-col overflow-hidden bg-white ${isWaterfallCollapsed ? 'flex-1 border-t-0' : ''
                }`}
              style={!isWaterfallCollapsed ? { height: `${100 - waterfallHeight}%` } : undefined}
            >
              <div className="px-4 py-3 border-b border-ink/15 flex justify-between items-center select-none bg-base/5 flex-none">
                <span className="font-mono text-[10.5px] opacity-75 uppercase tracking-widest font-bold text-ink">
                  Hop Details Inspector
                </span>
                <div className="flex items-center gap-4">
                  <span className="font-mono text-[7.5px] text-accent font-bold">
                    VERIFIED RAW
                  </span>
                  <button
                    onClick={() => setIsInspectorCollapsed(true)}
                    className="px-2 py-0.5 border border-ink/20 hover:border-ink hover:text-accent font-mono text-[8px] font-bold cursor-pointer"
                    title="Collapse Panel"
                  >
                    [-] COLLAPSE
                  </button>
                </div>
              </div>

              {/* Render inspector for selected or active hop */}
              <div className="flex-1 overflow-hidden">
                <HopInspector 
                  hop={currentInspectedHop} 
                  isCompleted={currentInspectedHop ? (currentInspectedHop.type === 'LOCAL' ? (activeStep >= hops.length - 1) : (hops.indexOf(currentInspectedHop) <= activeStep)) : true} 
                />
              </div>
            </div>
          )}
        </section>

      </div>

      <AnimatePresence>
        {isCacheOpen && (
          <CacheDrawer isOpen={isCacheOpen} onClose={() => setIsCacheOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
