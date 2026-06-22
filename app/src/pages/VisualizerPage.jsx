import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { Info } from 'lucide-react';
import { useTraceStore } from '../stores/useTraceStore';
import CompactTree from '../components/CompactTree';
import HopCard from '../components/HopCard';
import HopInspector from '../components/HopInspector';
import InteractiveGrid from '../components/InteractiveGrid';

const getHopsLogs = (hopsArray, activeStepIndex, domVal, recTypeVal) => {
  const logLines = [];
  if (!hopsArray || hopsArray.length === 0) return logLines;

  for (let i = 0; i <= activeStepIndex; i++) {
    const hop = hopsArray[i];
    if (!hop) continue;

    const timeStr = `[${(hop.cumulativeMs / 1000).toFixed(3)}s]`;
    const hopDomain = hop.queryDomain || domVal;

    if (hop.type === 'CLIENT') {
      logLines.push({ time: timeStr, source: 'CLIENT', text: `Initiating trace query for "${hopDomain.toUpperCase()}" (Record Type: ${recTypeVal})` });
      if (recTypeVal === 'ALL') {
        logLines.push({ time: timeStr, source: 'RFC-8482', text: `Notice: ANY query deprecated by RFC 8482. Resolving types A, AAAA, MX, TXT, NS in parallel.` });
      }
      logLines.push({ time: timeStr, source: 'CLIENT', text: `Sending UDP query packet payload to Local Resolver at ${hop.ip}` });
    } else if (hop.type === 'LOCAL') {
      if (!hop.response) {
        logLines.push({ time: timeStr, source: 'LOCAL', text: `Connection to Local DNS server failed. Bypassing local resolution.` });
        logLines.push({ time: timeStr, source: 'LOCAL', text: `Querying DNS Root nameserver hints directly...` });
      } else {
        logLines.push({ time: timeStr, source: 'LOCAL', text: `Received request packet. Checking local cache & zone databases...` });
        const answersList = hop.response.answers || [];
        const isAuthoritative = hop.response.isAuthoritative || false;
        if (isAuthoritative && answersList.length > 0) {
          logLines.push({ time: timeStr, source: 'LOCAL', text: `Cache hit! Found authoritative local zone mapping.` });
          logLines.push({ time: timeStr, source: 'CLIENT', text: `Received response payload from local resolver: ${answersList.length} records resolved.` });
        } else {
          logLines.push({ time: timeStr, source: 'LOCAL', text: `Cache miss. Querying DNS Root nameserver hints...` });
        }
      }
    } else if (hop.type === 'ROOT') {
      logLines.push({ time: timeStr, source: 'ROOT', text: `Querying Root Authority: ${hop.label} (${hop.ip})` });
      logLines.push({ time: timeStr, source: 'ROOT', text: `Received delegation referral (RCODE: ${hop.response?.rcode || 'NOERROR'}). Found ${hop.response?.authority?.length || 13} TLD servers.` });
    } else if (hop.type === 'TLD') {
      logLines.push({ time: timeStr, source: 'TLD', text: `Querying TLD Server: ${hop.label} (${hop.ip})` });
      logLines.push({ time: timeStr, source: 'TLD', text: `Received delegation referral (RCODE: ${hop.response?.rcode || 'NOERROR'}). Found ${hop.response?.authority?.length || 4} authoritative servers.` });
    } else if (hop.type === 'AUTH') {
      logLines.push({ time: timeStr, source: 'AUTH', text: `Querying Authoritative Server: ${hop.label} (${hop.ip})` });
      const rcode = hop.response?.rcode || 'NOERROR';
      const answersCount = hop.response?.answers?.length || 0;
      if (rcode === 'NXDOMAIN') {
        logLines.push({ time: timeStr, source: 'AUTH', text: `NXDOMAIN response code returned. Requested domain target does not exist!` });
      } else {
        logLines.push({ time: timeStr, source: 'AUTH', text: `Final answer received (RCODE: ${rcode}, AA Flag: ${hop.response?.flags?.includes('AA') ? '1' : '0'}). Found ${answersCount} answers.` });
        logLines.push({ time: timeStr, source: 'LOCAL', text: `Iterative sequence completed. [Notice: Caching bypassed to demonstrate full resolution path]. Retransmitting payload to Client Stub.` });
      }
    } else if (hop.type === 'CNAME_REDIRECT') {
      logLines.push({ time: timeStr, source: 'CNAME', text: `CNAME alias redirection: "${hop.cnameFrom.toUpperCase()}" -> "${hop.cnameTo.toUpperCase()}"` });
      logLines.push({ time: timeStr, source: 'CLIENT', text: `Redirecting resolver chain to target host.` });
    }
  }

  return logLines;
};

export default function VisualizerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qParam = searchParams.get('q');
  const typeParam = searchParams.get('type') || 'ALL';
  const benchmarkParam = searchParams.get('benchmark') === 'true';

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
  const [expandedGroups, setExpandedGroups] = useState({});
  const [showRawJson, setShowRawJson] = useState({});
  const [showLabNotes, setShowLabNotes] = useState(false);
  const consoleEndRef = useRef(null);

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

  const toggleGroup = (section, type) => {
    const key = `${section}-${type}`;
    setExpandedGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Retrace on reload if query parameters are present but traceData is empty
  useEffect(() => {
    if (qParam && (!traceData || domain !== qParam)) {
      useTraceStore.setState({
        domain: qParam,
        recordType: typeParam,
        isBenchmarkMode: benchmarkParam,
      });
      useTraceStore.getState().startTrace(qParam, typeParam);
    }
  }, [qParam, typeParam, benchmarkParam, traceData, domain]);

  const hops = traceData?.hops || [];
  const edges = traceData?.edges || [];
  const status = traceData?.status || 'PENDING';
  const totalLatency = traceData?.totalLatency || 0;
  const cnameChain = traceData?.cnameChain || [];

  const logLines = getHopsLogs(hops, activeStep, domain || qParam || '', recordType || typeParam || 'ALL');

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logLines.length]);

  // Playback timer loop
  useEffect(() => {
    if (playbackState !== 'PLAYING' || !traceData || hops.length === 0) return;

    if (activeStep >= hops.length - 1) {
      const finalStatus = traceData.status || 'COMPLETE';
      useTraceStore.setState({
        playbackState: finalStatus === 'NOERROR' ? 'COMPLETE' : finalStatus
      });
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

  // ESC key handler to navigate back to home search page
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27) {
        e.preventDefault();
        e.stopPropagation();
        handleReset();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleReset]);


  // Trigger alternate query type
  const handleAppendQuery = (type) => {
    useTraceStore.setState({ recordType: type });
    useTraceStore.getState().startTrace(domain, type);
    setSecondsElapsed(0);
    navigate(`/trace?q=${domain}&type=${type}&benchmark=${isBenchmarkMode}`);
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

  // Retrieve authority and additional records from final hop response
  const finalHop = hops[hops.length - 1];
  const authorityRecords = finalHop?.response?.authority || [];
  const additionalRecords = finalHop?.response?.additional || [];

  // Get currently inspected hop (selected hop or defaults to active playback step)
  const currentInspectedHop = hops.find((h) => h.id === selectedHop) || hops[activeStep];

  const getHudStats = (hop) => {
    if (!hop) return null;
    const flags = hop.response?.flags || [];
    const rcode = hop.response?.rcode || 'PENDING';
    const isClient = hop.type === 'CLIENT' || hop.type === 'CNAME_REDIRECT';

    return (
      <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2 select-none">
        <div className="border border-ink bg-base p-1.5 flex flex-col font-mono text-[9px] gap-0.5 shadow-[1px_1px_0_0_#0D0D0D]">
          <span className="opacity-40 uppercase text-[7.5px] font-bold">Uplink Port</span>
          <span className="font-bold text-ink">{isClient ? 'LOCAL' : 'UDP : 5354'}</span>
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

  const renderRecordCard = (rec, ri, type) => {
    const currentTtl = Math.max(0, rec.ttl - secondsElapsed);
    const isExpired = currentTtl === 0 && !isNxDomain;
    const cardKey = `${type}-${rec.name || ''}-${ri}`;
    const showJson = showRawJson[cardKey] === true;

    return (
      <div
        key={ri}
        className={`border border-ink flex flex-col relative overflow-hidden transition-all duration-300 bg-white ${isExpired ? 'border-ink/20 opacity-45' : ''
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
        {((rec.ttl !== undefined && rec.ttl !== null) || (rec.name && rec.name.replace(/\.$/, '') !== domain.replace(/\.$/, '')) || typeof rec.value === 'object') && (
          <div className="px-3 py-1 bg-ink/[0.02] border-b border-ink/10 flex justify-between items-center text-[8.5px] text-ink/50 select-none font-mono font-medium">
            <div className="flex items-center gap-1.5">
              <span>{rec.ttl !== undefined ? `TTL ${currentTtl}s` : ''}</span>
              {typeof rec.value === 'object' && (
                <button
                  type="button"
                  onClick={() => setShowRawJson(prev => ({ ...prev, [cardKey]: !prev[cardKey] }))}
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
          const isExpanded = expandedGroups[key] === true; // default to false
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
              {renderRecordCard(firstRecord, 0, type)}

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
                        {remainingRecords.map((rec, ri) => renderRecordCard(rec, ri + 1, type))}
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
              className={`px-3 py-0.5 border font-bold transition-all duration-150 cursor-pointer hover:-translate-y-[1px] hover:shadow-[2px_2px_0_0_#0d0d0d] active:translate-y-0 active:shadow-none ${playbackState === 'PLAYING'
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
            className={`px-2 py-0.5 border bg-base transition-all duration-150 cursor-pointer hover:-translate-y-[1px] hover:shadow-[2px_2px_0_0_#0D0D0D] active:translate-y-0 active:shadow-none ${isSlowMo ? 'border-accent text-accent' : 'border-ink/20 hover:border-ink'
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

          <button
            onClick={() => navigate(`/packet-viewer?q=${domain}&type=${recordType}`)}
            className="px-3 py-0.5 border border-accent bg-base text-accent font-bold hover:bg-accent hover:text-[var(--base)] hover:-translate-y-[1px] hover:shadow-[2px_2px_0_0_#0D0D0D] active:translate-y-0 active:shadow-none transition-all duration-150 cursor-pointer"
          >
            INSPECT PACKETS
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
                        ↳ CNAME alias: {cn.to.replace(/\.$/, '')}
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
              {/* Latency Legend */}
              <div className="flex items-center gap-1.5">
                <span className="opacity-50">Latency:</span>
                <span className="w-2 h-2 bg-[#22C55E]" title="<40ms" />
                <span className="text-[8px]">&lt;40ms</span>
                <span className="w-2 h-2 bg-[#FF4D00]" title="40-150ms" />
                <span className="text-[8px]">40-150ms</span>
                <span className="w-2 h-2 bg-[#EF4444]" title=">150ms" />
                <span className="text-[8px]">&gt;150ms</span>
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
              />
            </div>

            {/* Console Logger & Benchmark Unified HUD Panel */}
            <div className="w-full max-w-[950px] bg-base/80 backdrop-blur-md flex flex-col shrink-0 select-text z-20 border border-ink p-3 shadow-[3px_3px_0_0_#0D0D0D] border-t-2 border-t-accent mb-2">
              {/* HUD Indicators */}
              {getHudStats(currentInspectedHop)}

              {/* Layout Grid: 1 column default, 2 columns (col-span 3 & 2) on benchmark completion */}
              <div className={`grid grid-cols-1 ${isBenchmarkMode && (playbackState === 'COMPLETE' || isNxDomain) && benchmarkData ? 'md:grid-cols-5' : ''} gap-3`}>

                {/* Monospace Scrolling Console */}
                <div className={`flex flex-col bg-ink p-3 font-mono text-[9.1px] text-[#A6E22E] border border-ink overflow-hidden h-36 select-text ${isBenchmarkMode && (playbackState === 'COMPLETE' || isNxDomain) && benchmarkData ? 'md:col-span-3' : 'w-full'}`}>
                  <div className="text-[8px] text-accent font-bold uppercase tracking-wider mb-1 select-none border-b border-base/10 pb-1 flex justify-between shrink-0">
                    <span>Observatory Logs</span>
                    <span className="animate-pulse">CONNECTED</span>
                  </div>
                  <div className="flex-1 overflow-y-auto flex flex-col gap-1 select-text scrollbar-thin">
                    {logLines.map((line, idx) => (
                      <div key={idx} className="flex gap-2 items-start leading-normal">
                        <span className="text-[#66D9EF] select-none shrink-0">{line.time}</span>
                        <span className="text-[#F92672] select-none font-bold shrink-0">[{line.source}]</span>
                        <span className="text-base select-text break-all text-[#F0EDE8]">{line.text}</span>
                      </div>
                    ))}
                    <div ref={consoleEndRef} />
                  </div>
                </div>

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
                    secondsElapsed={secondsElapsed}
                    isReached={i <= activeStep}
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
                <HopInspector hop={currentInspectedHop} secondsElapsed={secondsElapsed} />
              </div>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
