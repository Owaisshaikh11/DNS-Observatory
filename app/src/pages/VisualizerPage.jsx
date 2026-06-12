import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { useTraceStore } from '../stores/useTraceStore';
import CompactTree from '../components/CompactTree';
import HopCard from '../components/HopCard';
import HopInspector from '../components/HopInspector';

export default function VisualizerPage() {
  const navigate = useNavigate();
  const {
    domain,
    recordType,
    traceData,
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
  } = useTraceStore();

  const [secondsElapsed, setSecondsElapsed] = useState(0);

  const hops = traceData?.hops || [];
  const edges = traceData?.edges || [];
  const status = traceData?.status || 'PENDING';
  const totalLatency = traceData?.totalLatency || 0;
  const cnameChain = traceData?.cnameChain || [];

  // Playback timer loop
  useEffect(() => {
    if (playbackState !== 'PLAYING' || !traceData || hops.length === 0) return;

    if (activeStep >= hops.length - 1) {
      useTraceStore.setState({ playbackState: 'COMPLETE' });
      return;
    }

    const delay = isSlowMo ? 1800 : 900;
    const timer = setTimeout(() => {
      setActiveStep(activeStep + 1);
    }, delay);

    return () => clearTimeout(timer);
  }, [playbackState, activeStep, isSlowMo, traceData, hops.length, setActiveStep]);

  // Real-time TTL Countdown timer (ticks up seconds elapsed since completion)
  useEffect(() => {
    if (playbackState !== 'COMPLETE') {
      setSecondsElapsed(0);
      return;
    }

    const timer = setInterval(() => {
      setSecondsElapsed((s) => s + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [playbackState]);

  // Handle Playback Actions
  const handlePrev = () => {
    if (activeStep > 0) {
      useTraceStore.setState({ playbackState: 'PAUSED' });
      setActiveStep(activeStep - 1);
    }
  };

  const handleNext = () => {
    if (activeStep < hops.length - 1) {
      useTraceStore.setState({ playbackState: 'PAUSED' });
      setActiveStep(activeStep + 1);
    }
  };

  const togglePlayback = () => {
    if (playbackState === 'COMPLETE' || playbackState === 'NXDOMAIN') {
      handleReplay();
    } else {
      useTraceStore.setState({
        playbackState: playbackState === 'PLAYING' ? 'PAUSED' : 'PLAYING',
      });
    }
  };

  const handleReplay = () => {
    setSecondsElapsed(0);
    replayTrace();
  };

  const handleReset = () => {
    navigate('/');
  };

  // Trigger alternate query type
  const handleAppendQuery = (type) => {
    useTraceStore.setState({ recordType: type });
    useTraceStore.getState().startTrace(domain, type);
    setSecondsElapsed(0);
  };

  // Format record helper for Answer cards
  const formatRecordValue = (val, type) => {
    if (typeof val !== 'object' || val === null) {
      if (type === 'TXT') {
        return `"${val}"`;
      }
      return String(val);
    }
    if (type === 'MX') {
      return `${val.preference} ${val.exchange}`;
    }
    if (type === 'SOA') {
      return `${val.mname} | Admin: ${val.rname} | S: ${val.serial}`;
    }
    return JSON.stringify(val);
  };

  // Loader / Loading State
  if (!traceData) {
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
              <span>CONNECTING PROTOCOL: UDP PORT 5354</span>
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
  const minTtl = answers.length > 0 ? Math.min(...answers.map((a) => a.ttl)) : 60;
  const realTtl = Math.max(0, minTtl - secondsElapsed);

  // Retrieve authority and additional records from final hop response
  const finalHop = hops[hops.length - 1];
  const authorityRecords = finalHop?.response?.authority || [];
  const additionalRecords = finalHop?.response?.additional || [];

  // Get currently inspected hop (selected hop or defaults to active playback step)
  const currentInspectedHop = hops.find((h) => h.id === selectedHop) || hops[activeStep];

  return (
    <div className="w-full h-full flex flex-col text-ink bg-base overflow-hidden selection:bg-accent selection:text-[var(--base)]">
      
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
          {/* Playback control buttons styled exactly like prototype */}
          <div className="flex items-center gap-1">
            <button
              onClick={handlePrev}
              disabled={activeStep === 0}
              className="px-2 py-0.5 border border-ink/20 bg-base text-ink font-bold hover:border-ink hover:text-accent hover:-translate-y-[1px] hover:shadow-[2px_2px_0_0_#0d0d0d] active:translate-y-0 active:shadow-none transition-all duration-150 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              ◀ PREV
            </button>
            <button
              onClick={togglePlayback}
              className={`px-3 py-0.5 border font-bold transition-all duration-150 cursor-pointer hover:-translate-y-[1px] hover:shadow-[2px_2px_0_0_#0d0d0d] active:translate-y-0 active:shadow-none ${
                playbackState === 'PLAYING'
                  ? 'bg-accent border-accent text-base'
                  : 'bg-base border-ink/20 hover:border-ink hover:text-accent'
              }`}
            >
              {playbackState === 'PLAYING' ? '⏸ PAUSE' : '⏵ PLAY'}
            </button>
            <button
              onClick={handleNext}
              disabled={activeStep === hops.length - 1}
              className="px-2 py-0.5 border border-ink/20 bg-base text-ink font-bold hover:border-ink hover:text-accent hover:-translate-y-[1px] hover:shadow-[2px_2px_0_0_#0d0d0d] active:translate-y-0 active:shadow-none transition-all duration-150 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              NEXT ▶
            </button>
          </div>

          <button
            onClick={toggleSlowMo}
            className={`px-2 py-0.5 border bg-base transition-all duration-150 cursor-pointer hover:-translate-y-[1px] hover:shadow-[2px_2px_0_0_#0D0D0D] active:translate-y-0 active:shadow-none ${
              isSlowMo ? 'border-accent text-accent' : 'border-ink/20 hover:border-ink'
            }`}
          >
            SLOW-MO
          </button>

          <button
            onClick={handleReplay}
            className="flex items-center gap-1.5 px-3 py-0.5 border border-ink/20 bg-base hover:border-ink hover:text-accent hover:-translate-y-[1px] hover:shadow-[2px_2px_0_0_#0D0D0D] active:translate-y-0 active:shadow-none transition-all duration-150 cursor-pointer"
          >
            ↻ REPLAY
          </button>

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
            <div>
              <span className="font-mono text-[9px] uppercase opacity-45 block mb-2.5 tracking-wider select-none font-bold">
                CNAME Chain Explorer
              </span>
              <div className="font-mono text-xs flex flex-col gap-1.5 select-text">
                <div className="flex items-center gap-2 font-bold text-ink">
                  <span className="text-ink/40">■</span>
                  <span>{domain}</span>
                </div>
                {playbackState === 'COMPLETE' && !isNxDomain && (
                  <div className="flex flex-col gap-1 relative pl-2.5 ml-1">
                    <div className="absolute top-0 bottom-1 left-0 w-[1px] bg-ink/20" />
                    {cnameChain.map((cn, ci) => (
                      <div key={ci} className="text-ink/75 pl-3.5 truncate text-[11px] leading-relaxed">
                        ↳ CNAME alias.{cn.to.replace(/\.$/, '')}
                      </div>
                    ))}
                    <div className="text-accent font-bold pl-3.5 text-[11px] leading-relaxed">
                      ↳ {recordType} Resolved
                    </div>
                  </div>
                )}
                {isNxDomain && (
                  <div className="flex flex-col gap-1 relative pl-2.5 ml-1">
                    <div className="absolute top-0 bottom-1 left-0 w-[1px] bg-ink/20" />
                    <div className="text-ink/65 font-bold pl-3.5 text-[11px] leading-relaxed">
                      ↳ NXDOMAIN (Break)
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Section separator */}
            <div className="h-[1px] bg-ink/10 my-0.5 select-none" />

            {/* Hierarchical Inspector */}
            <div>
              <span className="font-mono text-[9px] uppercase opacity-45 block mb-4 tracking-wider select-none font-bold">
                Hierarchical Inspector
              </span>

              {playbackState === 'COMPLETE' || isNxDomain ? (
                <div className="flex flex-col gap-5">
                  
                  {/* ANSWER SECTION */}
                  <div className="flex flex-col gap-2.5">
                    <div className="font-mono text-[9px] uppercase text-ink/40 tracking-wider font-bold select-none">
                      :: Answer Section
                    </div>
                    {answers.length > 0 ? (
                      <div className="flex flex-col gap-3">
                        {answers.map((rec, ri) => (
                          <div
                            key={ri}
                            className={`border border-ink flex flex-col relative overflow-hidden transition-all duration-300 ${
                              realTtl === 0 && !isNxDomain
                                ? 'bg-base border-ink/20 opacity-45'
                                : 'bg-white'
                            }`}
                          >
                            {/* Cache Expiry stamp overlay */}
                            {realTtl === 0 && !isNxDomain && (
                              <div className="absolute inset-0 flex items-center justify-center z-20 backdrop-blur-[1px] bg-base/40 select-none">
                                <span className="text-error font-mono text-[9px] font-bold border border-error bg-[#F0EDE8] px-2 py-0.5 rotate-[-5deg] tracking-widest shadow-[2px_2px_0_0_rgba(239,68,68,1)]">
                                  [CACHE EXPIRED]
                                </span>
                              </div>
                            )}
                            
                            {/* Record Type Header */}
                            <div className="px-3 py-1 bg-ink/[0.02] border-b border-ink/10 flex justify-between items-center select-none">
                              <span className="font-bold font-mono text-[9.5px] text-ink">
                                {rec.typeName || rec.type}
                              </span>
                            </div>

                            {/* Record Value */}
                            <div className="px-3 py-1.5 font-mono text-[10.5px] break-all leading-relaxed text-ink/80 select-all font-medium">
                              {formatRecordValue(rec.value, rec.typeName || rec.type)}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="font-mono text-[10px] text-ink opacity-40 italic">No records found.</div>
                    )}
                  </div>

                  {/* AUTHORITY SECTION */}
                  <div className="flex flex-col gap-2">
                    <div className="font-mono text-[9px] uppercase text-ink/40 tracking-wider font-bold select-none">
                      :: Authority Section
                    </div>
                    {authorityRecords.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {authorityRecords.map((rec, ri) => (
                          <div
                            key={ri}
                            className="border border-ink bg-ink/[0.02] px-3 py-1.5 flex justify-between items-center font-mono text-[10px]"
                          >
                            <span className="truncate pr-4 font-medium select-all">{formatRecordValue(rec.value, rec.typeName || rec.type)}</span>
                            <span className="px-1.5 py-0.5 bg-ink/10 text-ink font-bold text-[8px] uppercase tracking-wider select-none">
                              {rec.typeName || rec.type}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="font-mono text-[10px] opacity-35 italic">Empty</div>
                    )}
                  </div>

                  {/* ADDITIONAL SECTION */}
                  <div className="flex flex-col gap-2">
                    <div className="font-mono text-[9px] uppercase text-ink/40 tracking-wider font-bold select-none">
                      :: Additional Section
                    </div>
                    {additionalRecords.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {additionalRecords.map((rec, ri) => (
                          <div
                            key={ri}
                            className="border border-ink bg-ink/[0.02] px-3 py-1.5 flex justify-between items-center font-mono text-[10px]"
                          >
                            <span className="truncate pr-4 font-medium select-all">{formatRecordValue(rec.value, rec.typeName || rec.type)}</span>
                            <span className="px-1.5 py-0.5 bg-ink/10 text-ink font-bold text-[8px] uppercase tracking-wider select-none">
                              {rec.typeName || rec.type}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="font-mono text-[10px] opacity-35 italic">Empty</div>
                    )}
                  </div>

                  {/* Alternate Query Buttons (Quick Tracing) */}
                  {!isNxDomain && (
                    <div className="mt-2 pt-4 border-t border-ink/15 flex flex-col gap-2.5">
                      <span className="font-mono text-[9px] uppercase text-accent font-bold tracking-wider select-none">
                        Query Alternate Type
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'ALL']
                          .filter((t) => t !== recordType)
                          .map((t) => (
                            <button
                              key={t}
                              onClick={() => handleAppendQuery(t)}
                              className="px-3 py-1.5 border border-ink bg-ink/5 font-mono text-[10px] font-bold text-ink hover:bg-ink hover:text-base transition-colors duration-100 cursor-pointer"
                            >
                              {t === 'ALL' ? 'BATCH ALL' : `+ ${t}`}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                </div>
              ) : (
                <div className="font-mono text-[9.5px] opacity-30 uppercase animate-pulse select-none">
                  Awaiting resolution data...
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* CENTER PANEL: Centers SVG path tree. Holds benchmark stats at bottom */}
        <main className="flex-1 flex flex-col p-6 items-center justify-center relative bg-base brutalist-grid overflow-hidden z-0">
          
          <div className="absolute top-4 left-6 pointer-events-none select-none">
            <span className="font-mono text-[8.5px] opacity-30 uppercase tracking-widest block">
              Topographical chain
            </span>
            <span className="font-display font-black text-base uppercase tracking-tight text-ink">
              Spatial Resolution Path
            </span>
          </div>

          {/* SVG Tree Graph */}
          <div className="w-full flex-1 flex items-center justify-center">
            <CompactTree
              hops={hops}
              edges={edges}
              selectedHop={selectedHop}
              onSelectHop={setSelectedHop}
              activeStep={activeStep}
              playbackState={playbackState}
            />
          </div>

          {/* Resolver Benchmark panel fits cleanly at bottom of center graph field */}
          {isBenchmarkMode && (playbackState === 'COMPLETE' || isNxDomain) && (
            <div className="border border-ink p-4 bg-base/95 shadow-[3px_3px_0_0_#0D0D0D] flex flex-col gap-3 w-full max-w-md z-10 border-t-2 border-t-accent mb-2 shrink-0">
              <div className="flex justify-between items-center border-b border-ink/20 pb-1.5 select-none">
                <span className="font-display font-black text-[10px] uppercase tracking-tight">
                  Recursive Resolver Latency Benchmark
                </span>
                <span className="font-mono text-[8px] text-accent font-bold tracking-wider">
                  RTT COMP
                </span>
              </div>

              {isBenchmarking ? (
                <div className="font-mono text-[8px] opacity-40 text-center py-2 animate-pulse uppercase tracking-wider select-none">
                  [ Benchmarking public resolvers... ]
                </div>
              ) : benchmarkData ? (
                <div className="flex flex-col gap-3 font-mono text-[9.5px]">
                  {/* Cloudflare bar */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-[9px]">1.1.1.1 (CLOUDFLARE)</span>
                      <span className="font-bold text-accent">{benchmarkData.cloudflare.latencyMs}ms</span>
                    </div>
                    <div className="w-full h-3 bg-ink/5 border border-ink relative overflow-hidden">
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
                        <span className="absolute right-1 top-0.5 text-[6.5px] bg-green-500 text-base font-bold px-0.5 select-none z-10 leading-none">
                          FASTEST
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Google bar */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-[9px]">8.8.8.8 (GOOGLE)</span>
                      <span className="font-bold text-accent">{benchmarkData.google.latencyMs}ms</span>
                    </div>
                    <div className="w-full h-3 bg-ink/5 border border-ink relative overflow-hidden">
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
                        <span className="absolute right-1 top-0.5 text-[6.5px] bg-green-500 text-base font-bold px-0.5 select-none z-10 leading-none">
                          FASTEST
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="font-mono text-[8px] opacity-35 text-center py-2 select-none">
                  No benchmark data retrieved.
                </div>
              )}
            </div>
          )}

          <div className="absolute bottom-4 left-6 pointer-events-none select-none hidden lg:block">
            <span className="font-mono text-[8px] opacity-30 leading-relaxed uppercase">
              Curved dashed paths represent non-recursive referral connections. <br />
              Lit paths denote resolving sequence progress.
            </span>
          </div>
        </main>

        {/* RIGHT PANEL: waterfall list (top half) + telemetry inspector (bottom half) */}
        <section className="w-full lg:w-[380px] xl:w-[440px] flex-none border-t lg:border-t-0 lg:border-l border-ink flex flex-col h-full bg-base/90 backdrop-blur-sm overflow-hidden z-20">
          
          {/* Top Half: Waterfall Latency list */}
          <div className="h-[45%] flex flex-col overflow-hidden border-b border-ink">
            <div className="px-4 py-3 border-b border-ink/10 flex justify-between items-center select-none bg-base/50">
              <span className="font-mono text-[8px] opacity-40 uppercase tracking-widest font-bold">
                Waterfall Latency Timeline
              </span>
              <span className="font-mono text-[7.5px] opacity-25">
                RTT INDEX
              </span>
            </div>

            {/* Waterfall Scale Grid labels */}
            <div className="grid grid-cols-[28px_1.2fr_1.6fr_48px_68px] gap-3 px-4 py-1.5 bg-ink/[0.02] border-b border-ink/10 font-mono text-[7.5px] uppercase tracking-wider text-ink/40 select-none items-center">
              <div>Hop</div>
              <div>Node</div>
              <div className="flex justify-between select-none pr-2">
                {[0, 25, 50, 75, 100].map((p) => (
                  <span key={p} className="tabular-nums">
                    {Math.round((p / 100) * totalLatency)}ms
                  </span>
                ))}
              </div>
              <div className="text-right">RTT</div>
              <div className="text-right">Status</div>
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
                  secondsElapsed={secondsElapsed}
                  isReached={i <= activeStep}
                  compact={true}
                />
              ))}
            </div>
          </div>

          {/* Bottom Half: Telemetry Packet Inspector */}
          <div className="h-[55%] flex flex-col overflow-hidden bg-white">
            <div className="px-4 py-3 border-b border-ink/15 flex justify-between items-center select-none bg-base/5 flex-none">
              <span className="font-mono text-[8px] opacity-40 uppercase tracking-widest font-bold text-ink">
                Telemetry Packet Inspector
              </span>
              <span className="font-mono text-[7.5px] text-accent font-bold">
                VERIFIED RAW
              </span>
            </div>

            {/* Render inspector for selected or active hop */}
            <div className="flex-1 overflow-hidden">
              <HopInspector hop={currentInspectedHop} secondsElapsed={secondsElapsed} />
            </div>
          </div>

        </section>

      </div>
    </div>
  );
}
