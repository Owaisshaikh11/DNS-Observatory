import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { useTraceStore } from '../stores/useTraceStore';
import BrutalistSelect from '../components/BrutalistSelect';
import BentoBox from '../components/BentoBox';
import PayloadLogo from '../components/PayloadLogo';
import Footer from '../components/Footer';
import InteractiveGrid from '../components/InteractiveGrid';
import SearchInput from '../components/SearchInput';
import { getValidationErrors } from '../utils/validation';
import { pageVariants } from '../constants/animations';



export default function EntryPage() {
  const navigate = useNavigate();

  const {
    startTrace,
    setDomain,
    setRecordType,
    setIsBenchmarkMode,
    resolver,
    setResolver,
    recentQueries,
    clearRecentQueries,
  } = useTraceStore();

  const [domainInput, setDomainInput] = useState('');
  const [selectedRecord, setSelectedRecord] = useState('ALL');
  const [isBenchmarkModeChecked, setIsBenchmarkModeChecked] = useState(false);
  const [inputError, setInputError] = useState(false);
  const [pasteError, setPasteError] = useState(null);

  const cleanDomain = domainInput.trim().toLowerCase();
  const validationErrors = getValidationErrors(cleanDomain);

  const handleRecentQueryClick = (q) => {
    setDomainInput(q.domain);
    setSelectedRecord(q.type);
    setDomain(q.domain);
    setRecordType(q.type);
    startTrace(q.domain, q.type);
    navigate(`/trace?q=${q.domain}&type=${q.type}&benchmark=${isBenchmarkModeChecked}&resolver=${encodeURIComponent(resolver)}`);
  };

  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef(null);
  const blurTimeoutRef = useRef(null);
  const [showHistory, setShowHistory] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const handleInputFocus = () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }
    setIsFocused(true);
  };

  const handleInputBlur = () => {
    blurTimeoutRef.current = setTimeout(() => {
      setIsFocused(false);
      setShowHistory(false);
      setHighlightedIndex(-1);
    }, 200);
  };

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const [scrollY, setScrollY] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);

  const handleScroll = (e) => {
    setScrollY(e.currentTarget.scrollTop);
  };



  const handleTraceSubmit = (e) => {
    e.preventDefault();
    const cleanSubmitDomain = domainInput.trim().toLowerCase().replace(/\.$/, '');
    const errors = getValidationErrors(cleanSubmitDomain);
    const isValid = cleanSubmitDomain.length > 0 && errors.length === 0;

    if (isValid) {
      setDomain(cleanSubmitDomain);
      setRecordType(selectedRecord);
      setIsBenchmarkMode(isBenchmarkModeChecked);
      startTrace(cleanSubmitDomain, selectedRecord);
      navigate(`/trace?q=${cleanSubmitDomain}&type=${selectedRecord}&benchmark=${isBenchmarkModeChecked}&resolver=${encodeURIComponent(resolver)}`);
    } else {
      setInputError(true);
      setTimeout(() => setInputError(false), 400);
    }
  };
  const handleNativePaste = (e) => {
    const pastedText = e.clipboardData.getData('text');
    if (pastedText) {
      e.preventDefault();
      let text = pastedText.trim();
      try {
        if (!/^https?:\/\//i.test(text) && text.includes('.')) {
          text = 'http://' + text;
        }
        const url = new URL(text);
        text = url.hostname;
      } catch {
        text = text.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0].split('?')[0];
      }
      text = text.replace(/\.$/, '').toLowerCase();

      const errors = getValidationErrors(text);
      if (errors.length > 0 || text.length === 0) {
        setInputError(true);
        setTimeout(() => setInputError(false), 400);
        setPasteError(errors[0] || "Invalid domain name pasted");
        setTimeout(() => setPasteError(null), 3000);
      } else {
        setPasteError(null);
        setDomainInput(text);
      }
    }
  };
  const handleMobilePaste = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      let text = await navigator.clipboard.readText();
      if (text) {
        text = text.trim();
        try {
          if (!/^https?:\/\//i.test(text) && text.includes('.')) {
            text = 'http://' + text;
          }
          const url = new URL(text);
          text = url.hostname;
        } catch {
          text = text.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0].split('?')[0];
        }
        text = text.replace(/\.$/, '').toLowerCase();

        const errors = getValidationErrors(text);
        if (errors.length > 0 || text.length === 0) {
          setInputError(true);
          setTimeout(() => setInputError(false), 400);
          setPasteError(errors[0] || "Invalid domain name pasted");
          setTimeout(() => setPasteError(null), 3000);
        } else {
          setPasteError(null);
          setDomainInput(text);
        }
      }
    } catch (err) {
      console.error("Mobile clipboard read failed:", err);
      inputRef.current?.focus();
    }
  };
  // Ref for the scroll container — passed to Footer for useScroll tracking
  const scrollContainerRef = useRef(null);
  const footerRef = useRef(null);

  useEffect(() => {
    if (!footerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        setFooterHeight(entry.contentRect.height);
      }
    });
    observer.observe(footerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    const maxScroll = container.scrollHeight - container.clientHeight;
    const reveal = Math.max(0, container.scrollTop - (maxScroll - footerHeight));
    document.documentElement.style.setProperty('--footer-reveal', `${reveal}px`);
  }, [scrollY, footerHeight]);

  useEffect(() => {
    return () => {
      document.documentElement.style.setProperty('--footer-reveal', '0px');
    };
  }, []);

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="relative w-full h-full overflow-hidden text-ink"
    >
      {/* The Scrollable Page Content */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="relative w-full h-full overflow-y-auto overflow-x-hidden z-20"
      >
        <main
          className="relative w-full min-h-screen bg-base shadow-[0_40px_100px_rgba(0,0,0,0.8)] flex flex-col z-10"
        >
          <InteractiveGrid />
          {/* Branding Header with Reactive Glassmorphism */}
          <header className="brutalist-navbar">
            <div className="flex items-center gap-3">
              <PayloadLogo size={40} animate="inspect" />
              <div className="flex flex-col">
                <h1 className="font-display font-black text-xl md:text-2xl uppercase tracking-tighter leading-none">DNS Observatory</h1>
                <span className="font-mono text-[9px] text-accent mt-1 tracking-widest">Resolution Lab</span>
              </div>
            </div>

          </header>

          {/* Left HUD Elements */}
          <div className="absolute top-44 left-12 font-mono text-[9px] hidden lg:flex flex-col gap-3 opacity-60 z-20 pointer-events-none">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-green-500 animate-pulse"></div>
              DNS SERVICES ONLINE
            </div>
            <div className="border-l border-ink/30 pl-3 ml-0.5 flex flex-col gap-1">
              <span>LOCAL RESOLVER: ACTIVE (PORT 53)</span>
              <span>API ENDPOINT: 127.0.0.1:4000</span>
              <span>PACKET ENGINE: READY</span>
            </div>

          </div>

          {/* Fold 1: Hero Trace Input */}
          <div className="relative z-20 w-full min-h-screen flex flex-col items-center justify-center px-6 pt-20">
            <div className="w-full max-w-4xl flex flex-col items-center">
              <form onSubmit={handleTraceSubmit} className="w-full flex flex-col items-center gap-12">

                <SearchInput
                  domainInput={domainInput}
                  setDomainInput={setDomainInput}
                  isFocused={isFocused}
                  setIsFocused={setIsFocused}
                  handleInputFocus={handleInputFocus}
                  handleInputBlur={handleInputBlur}
                  inputError={inputError}
                  pasteError={pasteError}
                  setPasteError={setPasteError}
                  validationErrors={validationErrors}
                  recentQueries={recentQueries}
                  clearRecentQueries={clearRecentQueries}
                  handleRecentQueryClick={handleRecentQueryClick}
                  handleNativePaste={handleNativePaste}
                  handleMobilePaste={handleMobilePaste}
                  inputRef={inputRef}
                  showHistory={showHistory}
                  setShowHistory={setShowHistory}
                  highlightedIndex={highlightedIndex}
                  setHighlightedIndex={setHighlightedIndex}
                />

                {/* Custom Dropdown Configuration Panel */}
                <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8 w-full justify-center">
                  <BrutalistSelect
                    label="Record Type"
                    value={selectedRecord}
                    options={[
                      { value: 'ALL', label: 'BATCH ALL', className: 'text-ink/60 font-bold' },
                      'A', 'AAAA', 'MX', 'TXT', 'CNAME', 'PTR', 'SRV'
                    ]}
                    onChange={setSelectedRecord}
                    width="w-full md:w-[220px]"
                  />
                  <BrutalistSelect
                    label="Recursive Resolver"
                    value={resolver}
                    options={['1.1.1.1 (Cloudflare)', '8.8.8.8 (Google)', 'System Default']}
                    onChange={setResolver}
                    width="w-full md:w-[260px]"
                  />
                </div>

                <label className="flex items-center gap-3 font-mono text-[10px] uppercase cursor-pointer interactive-hover opacity-70 hover:opacity-100 transition-opacity select-none">
                  <div className="brutalist-checkbox-box">
                    <div className={`w-2 h-2 bg-accent transition-transform duration-200 origin-center ${isBenchmarkModeChecked ? 'scale-100' : 'scale-0'}`}></div>
                  </div>
                  Compare Resolvers Benchmark
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={isBenchmarkModeChecked}
                    onChange={(e) => setIsBenchmarkModeChecked(e.target.checked)}
                  />
                </label>

                <button
                  type="submit"
                  className="mt-2 flex items-center gap-4 brutalist-button group interactive-hover cursor-pointer"
                >
                  <span>Initiate Trace</span>
                  <span className="transition-transform duration-200 group-hover:translate-x-1">→</span>
                </button>
              </form>
            </div>

            {/* Scroll Indicator */}
            <div
              style={{ opacity: Math.max(0, 0.4 - scrollY / 200) }}
              className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4 transition-opacity duration-300 pointer-events-none"
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.2em]">Scroll to Inspect</span>
              <div className="w-[1px] h-12 bg-ink origin-top animate-scale-y"></div>
            </div>
          </div>

          {/* Fold 2: Bento Box Details */}
          <div className="w-full flex justify-center relative z-20">
            <div className="w-full max-w-6xl px-6 py-32 mb-24 flex flex-col justify-center">
              <motion.div
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6 }}
                className="brutalist-architecture-header"
              >
                <h2 className="font-display font-black text-3xl md:text-5xl uppercase tracking-tighter">System<br />Architecture</h2>
                <p className="font-sans text-sm opacity-60 mt-6 max-w-md leading-relaxed">
                  The Observatory dissects standard resolution chains into granular data points, presented through a reactive spatial viewer interface designed for precision network analysis.
                </p>
              </motion.div>

              <div className="grid grid-cols-1 md:grid-cols-3 auto-rows-[260px] gap-4">
                <BentoBox
                  delay={0.1}
                  className="md:col-span-2 md:row-span-2"
                  title="Spatial Resolution Graph"
                  text="A fully interactive WebGL topographical map charting the exact journey from the local stub resolver out to the authoritative nameserver, visualizing each delegation hop dynamically. Watch TTL stability affect the nodes in real-time."
                  icon="[ GRAPH SYSTEM ]"
                  decoration={
                    <svg width="400" height="400" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="0.5" className="font-mono text-[4px] opacity-15">
                      <circle cx="50" cy="50" r="40" />
                      <circle cx="50" cy="50" r="30" />
                      <circle cx="50" cy="50" r="20" strokeDasharray="2 2" />
                      <path d="M50 10 L50 90 M10 50 L90 50" />
                      <text x="52" y="15" fill="currentColor">ROOT (.)</text>
                      <text x="52" y="35" fill="currentColor">TLD (.COM)</text>
                      <text x="52" y="55" fill="currentColor">AUTH (NS)</text>
                      <text x="12" y="55" fill="currentColor">LOCAL</text>
                    </svg>
                  }
                />
                <BentoBox
                  delay={0.2}
                  title="Multi-Record Batching"
                  text="Select 'ALL' to natively dispatch and resolve simultaneous queries for A, AAAA, MX, and TXT structures across the target domain infrastructure."
                  icon="[ QUERY ENGINE ]"
                  decoration={
                    <div className="flex flex-col gap-1 w-48 font-mono text-[9px] opacity-40 text-left p-2 border border-ink/10 bg-base/50">
                      <div className="border-b border-ink/10 pb-1 mb-1 text-accent font-bold">// PARALLEL BATCH</div>
                      <div>A: 192.30.255.113</div>
                      <div>AAAA: 2606:50c0:8000::154</div>
                      <div>MX: 10 mail.example.com</div>
                      <div>TXT: v=spf1 include:_spf.example.com ~all</div>
                    </div>
                  }
                />
                <BentoBox
                  delay={0.3}
                  title="Packet Viewer"
                  text="Deep UDP/TCP raw packet decoding. Inspect opcodes, flags, and DNS headers natively within the trace interface."
                  icon="[ PACKET VIEWER ]"
                  decoration={
                    <div className="flex flex-col gap-1 w-48 font-mono text-[9px] opacity-40 text-left p-2 border border-ink/10 bg-base/50">
                      <div className="border-b border-ink/10 pb-1 mb-1 text-accent font-bold">// DNS HEADER</div>
                      <div>Transaction ID: 0x4815</div>
                      <div>Flags: 0x8180 (Response)</div>
                      <div>Questions: 1 | Answers: 2</div>
                      <div>Authority RRs: 2 | Additional: 2</div>
                    </div>
                  }
                />
                <BentoBox
                  delay={0.4}
                  className="md:col-span-3 h-[180px]"
                  title="DNSSEC Validation Layer & Cache Diagnostics"
                  text="Ensure cryptographic integrity by mapping the strict chain of trust down from the root zone, while identifying cold lookups vs warm cache hits with precise latency tracking."
                  icon="[ SECURITY & PERFORMANCE ]"
                  decoration={
                    <div className="flex flex-col gap-1 w-64 font-mono text-[9px] opacity-40 text-left p-2 border border-ink/10 bg-base/50">
                      <div className="border-b border-ink/10 pb-1 mb-1 text-accent font-bold">// DNSSEC CHAIN OF TRUST</div>
                      <div>. (Root) &rarr; DS [Key Tag: 20326] &rarr; VERIFIED</div>
                      <div>.com (TLD) &rarr; DNSKEY [Alg: RSASHA256] &rarr; VERIFIED</div>
                      <div>example.com (Auth) &rarr; RRSIG [A Record Signature] &rarr; VERIFIED</div>
                    </div>
                  }
                />
              </div>
            </div>
          </div>

        </main>
        {/* The Sticky Footer Layer */}
        <Footer ref={footerRef} scrollContainerRef={scrollContainerRef} scrollY={scrollY} />
      </div>
    </motion.div>
  );
}
