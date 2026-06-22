import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { useTraceStore } from '../stores/useTraceStore';
import BrutalistSelect from '../components/BrutalistSelect';
import BentoBox from '../components/BentoBox';
import PayloadLogo from '../components/PayloadLogo';
import Footer from '../components/Footer';
import InteractiveGrid from '../components/InteractiveGrid';

const placeholderDomains = ['GOOGLE.COM', 'EXAMPLE.COM', 'GITHUB.COM', 'WIKIPEDIA.ORG'];

const getValidationErrors = (val) => {
  const errors = [];
  if (!val) return errors;

  if (/\s/.test(val)) {
    errors.push("Spaces are not allowed");
  }

  if (!/^[a-z0-9\-_.]*$/i.test(val)) {
    errors.push("Only alphanumeric characters, '-', '_', and '.' are allowed");
  }

  const parts = val.split('.');
  if (parts.length < 2) {
    errors.push("Must include a dot followed by an extension (e.g. .com)");
  } else {
    const tld = parts[parts.length - 1];
    if (tld.length < 2) {
      errors.push("Domain extension (TLD) must be at least 2 characters long");
    }
    if (!/^[a-z0-9]*$/i.test(tld)) {
      errors.push("Domain extension must be alphanumeric");
    }
  }

  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i];
    if (segment.startsWith('-') || segment.endsWith('-')) {
      errors.push("Segments cannot start or end with a hyphen");
      break;
    }
    if (segment.length > 63) {
      errors.push("Domain segment cannot exceed 63 characters");
    }
    if (i < parts.length - 1 && segment === '') {
      errors.push("Consecutive dots or empty labels are not allowed");
      break;
    }
  }

  if (val.length > 253) {
    errors.push("Total domain name length cannot exceed 253 characters");
  }

  return errors;
};

export default function EntryPage() {
  const navigate = useNavigate();

  const {
    startTrace,
    setDomain,
    setRecordType,
    setIsBenchmarkMode,
    resolver,
    setResolver,
  } = useTraceStore();

  const [domainInput, setDomainInput] = useState('');
  const [selectedRecord, setSelectedRecord] = useState('ALL');
  const [isBenchmarkModeChecked, setIsBenchmarkModeChecked] = useState(false);
  const [inputError, setInputError] = useState(false);
  const [pasteError, setPasteError] = useState(null);

  const cleanDomain = domainInput.trim().toLowerCase();
  const validationErrors = getValidationErrors(cleanDomain);

  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef(null);

  const [scrollY, setScrollY] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);

  const handleScroll = (e) => {
    setScrollY(e.currentTarget.scrollTop);
  };

  const getDynamicFontSize = (len) => {
    if (len > 30) return 'text-[3.5vw] md:text-[2.5vw]';
    if (len > 20) return 'text-[5vw] md:text-[3.5vw]';
    return 'text-[7vw] md:text-[5vw]';
  };

  const [currentPlaceholder, setCurrentPlaceholder] = useState('');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (domainInput) {
      return;
    }

    let timer;
    const fullText = placeholderDomains[placeholderIndex];

    const handleTyping = () => {
      if (!isDeleting) {
        setCurrentPlaceholder((prev) => fullText.slice(0, prev.length + 1));
        if (currentPlaceholder === fullText) {
          timer = setTimeout(() => setIsDeleting(true), 2000);
        } else {
          timer = setTimeout(handleTyping, 120);
        }
      } else {
        setCurrentPlaceholder((prev) => fullText.slice(0, prev.length - 1));
        if (currentPlaceholder === '') {
          setIsDeleting(false);
          setPlaceholderIndex((prev) => (prev + 1) % placeholderDomains.length);
          timer = setTimeout(handleTyping, 400);
        } else {
          timer = setTimeout(handleTyping, 60);
        }
      }
    };

    timer = setTimeout(handleTyping, isDeleting ? 60 : 120);
    return () => clearTimeout(timer);
  }, [currentPlaceholder, isDeleting, placeholderIndex, domainInput]);

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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -40 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
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

            <div className="flex items-center gap-8 ">
              <a
                href="https://github.com/Owaisshaikh11"
                target="_blank"
                rel="noopener noreferrer"
                style={{ padding: '12px 24px' }}
                className="flex items-center gap-2 border border-ink font-mono text-[10px] uppercase bg-base hover:bg-ink hover:text-[var(--base)] hover:-translate-y-[1px] hover:shadow-[2px_2px_0_0_#0D0D0D] active:translate-y-0 active:shadow-none transition-all duration-200 interactive-hover"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" >
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
                <span className="hidden sm:inline font-bold">GITHUB</span>
              </a>
            </div>
          </header>

          {/* Left HUD Elements */}
          <div className="absolute top-44 left-12 font-mono text-[9px] hidden lg:flex flex-col gap-3 opacity-60 z-20 pointer-events-none">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-green-500 animate-pulse"></div>
              DNS SERVICES ONLINE
            </div>
            <div className="border-l border-ink/30 pl-3 ml-0.5 flex flex-col gap-1">
              <span>LOCAL RESOLVER: 127.0.0.1:5354</span>
              <span>API ENDPOINT: 127.0.0.1:4000</span>
              <span>PACKET ENGINE: READY</span>
            </div>
            <div className="mt-4 border-l border-accent/50 pl-3 ml-0.5 text-accent opacity-80 leading-relaxed">
              HINT: Try tracing <strong className="font-bold">"example.com"</strong> for a local resolution,<br />
              or <strong className="font-bold">"github.com"</strong> for a live iterative resolution.
            </div>
          </div>

          {/* Fold 1: Hero Trace Input */}
          <div className="relative z-20 w-full min-h-screen flex flex-col items-center justify-center px-6 pt-20">
            <div className="w-full max-w-4xl flex flex-col items-center">
              <form onSubmit={handleTraceSubmit} className="w-full flex flex-col items-center gap-12">

                <div className="w-full py-4 flex flex-col items-center group cursor-text" onClick={() => inputRef.current?.focus()}>
                  <div className="w-full max-w-xl relative py-2 flex flex-col items-center">
                    {/* Hidden input to capture keyboard events */}
                    <input
                      ref={inputRef}
                      autoFocus
                      type="text"
                      value={domainInput}
                      onFocus={() => setIsFocused(true)}
                      onBlur={() => setIsFocused(false)}
                      onChange={(e) => {
                        setDomainInput(e.target.value.toLowerCase());
                        if (pasteError) setPasteError(null);
                      }}
                      onPaste={handleNativePaste}
                      placeholder=""
                      className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-text caret-transparent"
                    />

                    {/* Styled text display */}
                    <motion.div
                      animate={inputError ? { x: [-12, 12, -10, 10, -5, 5, 0] } : {}}
                      transition={{ duration: 0.4 }}
                      className={`w-full text-center font-mono font-bold tracking-tight select-none h-[1.2em] flex items-center justify-center ${getDynamicFontSize(domainInput.length)}`}
                    >
                      {domainInput ? (
                        <span className="text-ink">
                          {domainInput.toUpperCase()}
                          {isFocused && <span className="animate-blink text-accent ml-1">█</span>}
                        </span>
                      ) : (
                        <span className="text-ink/10 uppercase">
                          {currentPlaceholder}
                          {isFocused && <span className="animate-blink text-accent ml-1">█</span>}
                        </span>
                      )}
                    </motion.div>

                    <div className={`absolute bottom-0 left-0 w-full h-[1.5px] transition-all duration-300 ${domainInput.trim()
                      ? (validationErrors.length === 0 ? 'bg-green-600' : 'bg-accent')
                      : (isFocused
                        ? 'bg-accent'
                        : 'bg-gradient-to-r from-transparent via-ink/30 group-hover:via-accent to-transparent')
                      }`}></div>
                  </div>
                </div>

                {pasteError ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="font-mono text-[9px] uppercase tracking-[0.15em] text-center select-none h-4 text-accent flex items-center gap-1.5 justify-center"
                  >
                    <span>[-]</span>
                    <span>PASTE REJECTED: {pasteError}</span>
                  </motion.div>
                ) : domainInput.trim() ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15 }}
                    className="font-mono text-[9px] uppercase tracking-[0.15em] text-center select-none h-4"
                  >
                    {validationErrors.length > 0 ? (
                      <span className="text-accent flex items-center gap-1.5 justify-center">
                        <span>[-]</span>
                        <span>{validationErrors[0]}</span>
                      </span>
                    ) : (
                      <span className="text-green-600 flex items-center gap-1.5 justify-center">
                        <span>[+]</span>
                        <span>READY FOR TRACE // PROTOCOL OK</span>
                      </span>
                    )}
                  </motion.div>
                ) : (
                  <div className="flex flex-col items-center select-none h-12">
                    {/* Desktop shortcut hint */}
                    <div className="hidden md:block font-mono text-[9px] uppercase tracking-[0.15em] text-center select-none opacity-30 mt-2">
                      [ PRESS CTRL+V TO PASTE URL ]
                    </div>

                    {/* Mobile responsive paste button */}
                    <div className="block md:hidden mt-1">
                      <button
                        type="button"
                        onClick={handleMobilePaste}
                        className="w-10 h-10 flex items-center justify-center border border-ink sharp-border bg-base active:bg-ink active:text-[var(--base)] transition-all duration-200 active:shadow-[1.5px_1.5px_0_0_#FF4D00] shadow-[1.5px_1.5px_0_0_#0D0D0D] cursor-pointer interactive-hover"
                        title="Paste from clipboard"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                          <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                        </svg>
                      </button>
                    </div>
                  </div>
                )}

                {/* Custom Dropdown Configuration Panel */}
                <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8 w-full justify-center">
                  <BrutalistSelect
                    label="Record Type"
                    value={selectedRecord}
                    options={['ALL', 'A', 'AAAA', 'MX', 'TXT', 'CNAME', 'PTR', 'SRV']}
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
