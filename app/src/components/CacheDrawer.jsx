import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, Database, Search, ChevronDown, Info } from 'lucide-react';
import { useTraceStore } from '../stores/useTraceStore';
import { formatRecordValue } from '../utils/dnsFormatter';

export default function CacheDrawer({ isOpen, onClose }) {
  const { bypassCache, setBypassCache } = useTraceStore();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedKeys, setCollapsedKeys] = useState({});
  const [showTooltip, setShowTooltip] = useState(false);
  const [showToggleTooltip, setShowToggleTooltip] = useState(false);

  // Fetch cache entries from server when open
  const fetchCache = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dns/cache');
      if (res.ok) {
        const data = await res.json();
        setEntries(data || []);
      }
    } catch (e) {
      console.error('Failed to load DNS cache:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (isOpen) {
      const timer = setTimeout(() => {
        if (active) {
          fetchCache();
        }
      }, 0);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }
  }, [isOpen]);

  // Client-side countdown timer (re-calculates remaining TTL and filters expired entries)
  useEffect(() => {
    if (!isOpen || entries.length === 0) return;

    const timer = setInterval(() => {
      setEntries((prev) => {
        const now = Date.now();
        return prev
          .map((entry) => {
            const remaining = Math.max(0, Math.ceil((entry.expiresAt - now) / 1000));
            return {
              ...entry,
              ttlRemaining: remaining,
            };
          })
          .filter((entry) => entry.ttlRemaining > 0);
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, entries.length]);

  // Flush the entire cache
  const handleFlushCache = async () => {
    try {
      const res = await fetch('/api/dns/cache/clear', { method: 'POST' });
      if (res.ok) {
        setEntries([]);
        setCollapsedKeys({});
      }
    } catch (e) {
      console.error('Failed to clear cache:', e);
    }
  };

  // Evict single entry
  const handleEvictEntry = async (domain, type) => {
    try {
      const res = await fetch('/api/dns/cache', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, type }),
      });
      if (res.ok) {
        const key = `${domain}:${type}`;
        setEntries((prev) => prev.filter((e) => !(e.domain === domain && e.type === type)));
        setCollapsedKeys((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    } catch (e) {
      console.error('Failed to evict cache entry:', e);
    }
  };

  // Format H:M:S
  const formatHms = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [
      h.toString().padStart(2, '0'),
      m.toString().padStart(2, '0'),
      s.toString().padStart(2, '0'),
    ].join(':');
  };

  // Collapsible toggle helper
  const toggleKey = (key) => {
    setCollapsedKeys((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Collapse/Expand all helpers
  const handleCollapseAll = () => {
    const nextCollapsed = {};
    entries.forEach((entry) => {
      const key = `${entry.domain}:${entry.type}`;
      nextCollapsed[key] = true;
    });
    setCollapsedKeys(nextCollapsed);
  };

  const handleExpandAll = () => {
    setCollapsedKeys({});
  };

  // Filter entries
  const filteredEntries = entries.filter(
    (entry) =>
      entry.domain.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isCachedActive = !bypassCache;

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 220 }}
      className="fixed right-3 top-[52px] bottom-3 w-full sm:w-[420px] bg-[#F0EDE8] border-2 border-ink z-50 flex flex-col shadow-[4px_4px_0_0_#0D0D0D] select-none overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-ink flex justify-between items-center bg-base/80 relative">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-accent" />
          <h2 className="font-display font-black text-[13px] uppercase tracking-wider text-ink">
            Resolver Cache DB
          </h2>
          <button
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            className="p-0.5 text-ink/40 hover:text-accent cursor-pointer transition-colors"
            title="Caching Info"
          >
            <Info className="w-3 h-3 stroke-[2]" />
          </button>
        </div>
        <button
          onClick={onClose}
          className="p-1 border border-ink/20 hover:border-ink hover:text-accent hover:bg-base transition-all duration-100 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {/* Dynamic Consistent Tooltip Card */}
        <AnimatePresence>
          {showTooltip && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute left-5 right-5 top-full mt-1.5 z-50 border border-ink bg-base p-4 shadow-[3px_3px_0_0_#0D0D0D] font-mono text-[9px] flex flex-col gap-2 select-text"
            >
              <div className="flex justify-between items-center border-b border-ink/20 pb-1.5 mb-0.5">
                <span className="font-black text-accent uppercase tracking-wider">:: What is Resolver Cache?</span>
              </div>
              <div className="flex flex-col gap-2 leading-relaxed text-ink/80 font-mono text-[9px]">
                <div>
                  <span className="font-bold text-ink uppercase block mb-0.5">1. Local Cache Simulation</span>
                  Stores previously resolved DNS record structures in memory, simulating standard ISP or recursive public resolver caches (e.g. `1.1.1.1` or `8.8.8.8`).
                </div>
                <div>
                  <span className="font-bold text-ink uppercase block mb-0.5">2. Instant Cache Hits</span>
                  When Resolve Cache is active, matching queries bypass recursive nameserver chains entirely, returning records instantly in exactly 2 hops (Stub Resolver → Caching Resolver) in 0ms.
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Controls Container */}
      <div className="p-5 border-b border-ink/15 flex flex-col gap-4 bg-white/20">
        {/* Slidable Brutalist Toggle */}
        <div className="border border-ink p-3.5 bg-base shadow-[2px_2px_0_0_#0D0D0D] flex flex-col gap-2.5 relative">
          <div className="flex flex-col gap-0.5 select-none min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-display font-black text-[10px] uppercase tracking-wider text-ink">
                Virtual Resolver Caching
              </span>
              <button
                onMouseEnter={() => setShowToggleTooltip(true)}
                onMouseLeave={() => setShowToggleTooltip(false)}
                className="p-0.5 text-ink/40 hover:text-accent cursor-pointer transition-colors animate-none"
                title="Caching Modes Info"
              >
                <Info className="w-3 h-3 stroke-[2]" />
              </button>
            </div>
            <span className="font-mono text-[9px] text-ink/40">
              Control cache lookup and response behavior
            </span>
          </div>

          {/* Dynamic Consistent Tooltip Card for Toggle Modes */}
          <AnimatePresence>
            {showToggleTooltip && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="absolute left-3.5 right-3.5 top-full mt-1 z-50 border border-ink bg-base p-4 shadow-[3px_3px_0_0_#0D0D0D] font-mono text-[9px] flex flex-col gap-2 select-text"
              >
                <div className="flex justify-between items-center border-b border-ink/20 pb-1.5 mb-0.5">
                  <span className="font-black text-accent uppercase tracking-wider">:: Caching Modes</span>
                </div>
                <div className="flex flex-col gap-2 leading-relaxed text-ink/80 font-mono text-[9px]">
                  <div>
                    <span className="font-bold text-ink uppercase block mb-0.5">Bypass Cache</span>
                    Disables resolver cache checks. Every trace request initiates a complete iterative DNS query from Root hints to Authoritative servers.
                  </div>
                  <div>
                    <span className="font-bold text-ink uppercase block mb-0.5">Active Cache</span>
                    Enables resolver cache checks. If the queried domain-type record exists in the resolver memory, it resolves instantly in 0ms (2 hops).
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Slidable Segmented Switch */}
          <div
            onClick={() => setBypassCache(!bypassCache)}
            className="relative w-full h-8 border-2 border-ink bg-[#E5E0D8] cursor-pointer flex select-none p-0.5 overflow-hidden"
          >
            {/* Sliding Indicator Handle */}
            <motion.div
              animate={{ x: isCachedActive ? '100%' : '0%' }}
              transition={{ type: 'spring', stiffness: 350, damping: 28 }}
              className="absolute top-0.5 bottom-0.5 left-0.5 w-[49%] border border-ink bg-accent shadow-[1px_1px_0_0_#0D0D0D] z-0"
            />

            {/* Labels */}
            <div className={`relative z-10 w-1/2 flex items-center justify-center font-mono text-[9.5px] font-black uppercase transition-colors duration-200 ${
              !isCachedActive ? 'text-white' : 'text-ink/50'
            }`}>
              Bypass Cache
            </div>
            <div className={`relative z-10 w-1/2 flex items-center justify-center font-mono text-[9.5px] font-black uppercase transition-colors duration-200 ${
              isCachedActive ? 'text-white' : 'text-ink/50'
            }`}>
              Active Cache
            </div>
          </div>
        </div>

        {/* Flush Button */}
        <button
          onClick={handleFlushCache}
          className="w-full py-2 border border-ink bg-ink text-base font-mono text-[9px] font-black uppercase tracking-widest hover:bg-accent hover:border-accent transition-colors duration-150 cursor-pointer shadow-[2px_2px_0_0_#0D0D0D] active:translate-y-[2px] active:shadow-none"
        >
          Flush Cache Database
        </button>
      </div>

      {/* Search & Bulk Expand Row */}
      <div className="px-5 pt-4 pb-2 flex flex-col gap-3 flex-none">
        {/* Search Input */}
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-3 text-ink/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search records by domain or type..."
            className="w-full pl-8 pr-3 py-1.5 border border-ink/40 bg-white font-mono text-[9.5px] focus:border-ink focus:outline-none placeholder:text-ink/30 shadow-[1px_1px_0_0_#0D0D0D]/10"
          />
        </div>

        {/* Bulk Expand / Collapse row */}
        {entries.length > 0 && (
          <div className="flex justify-between items-center select-none">
            <span className="font-mono text-[9px] uppercase tracking-wider text-ink/40 font-bold">
              Cached Records ({filteredEntries.length})
            </span>
            <div className="flex items-center gap-2 font-mono text-[8px] font-bold">
              <button
                onClick={handleExpandAll}
                className="text-ink/60 hover:text-accent cursor-pointer"
              >
                [+] EXPAND ALL
              </button>
              <span className="text-ink/20">|</span>
              <button
                onClick={handleCollapseAll}
                className="text-ink/60 hover:text-accent cursor-pointer"
              >
                [-] COLLAPSE ALL
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cache Entries List */}
      <div className="flex-1 overflow-y-auto px-5 pb-5 flex flex-col gap-4 scrollbar-thin">
        {loading ? (
          <div className="font-mono text-[9px] text-ink/50 py-6 text-center animate-pulse">
            [ Loading cache database... ]
          </div>
        ) : entries.length === 0 ? (
          <div className="border border-dashed border-ink/30 p-8 bg-white/20 text-center flex flex-col items-center gap-2 my-auto">
            <div className="relative mb-1">
              <Database className="w-8 h-8 text-ink/30" />
              <span className="absolute -bottom-1 -right-1 text-xs select-none">❓</span>
            </div>
            <p className="font-mono text-[9.5px] text-ink/50 leading-relaxed max-w-[240px]">
              Virtual Resolver Cache is empty. Enable Cache Mode and trace a domain to populate database.
            </p>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="font-mono text-[9.5px] text-ink/50 py-8 text-center border border-dashed border-ink/20">
            [ No matching records found ]
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredEntries.map((entry) => {
              const isNxDomain = entry.status === 'NXDOMAIN';
              const progressPct =
                entry.originalTtl > 0 ? (entry.ttlRemaining / entry.originalTtl) * 100 : 0;
              const key = `${entry.domain}:${entry.type}`;
              const isCollapsed = !!collapsedKeys[key];

              return (
                <div
                  key={key}
                  className="border border-ink bg-white shadow-[2px_2px_0_0_#0D0D0D] flex flex-col overflow-hidden"
                >
                  {/* Card Header (Collapsible toggle area) */}
                  <div
                    onClick={() => toggleKey(key)}
                    className="p-3 bg-base/30 hover:bg-base/60 transition-colors flex justify-between items-center cursor-pointer border-b border-ink/10"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-ink/50 transition-transform duration-200 shrink-0 ${
                          isCollapsed ? '-rotate-90' : 'rotate-0'
                        }`}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="font-display font-black text-xs text-ink truncate uppercase">
                          {entry.domain}
                        </span>
                        <span className="font-mono text-[8px] text-ink/40 uppercase font-black">
                          Type: {entry.type} · Base TTL {entry.originalTtl}s
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEvictEntry(entry.domain, entry.type);
                      }}
                      className="p-1 border border-transparent hover:border-ink hover:text-red-500 hover:bg-red-50 transition-all duration-100 cursor-pointer text-ink/40 ml-2"
                      title="Evict Record"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Card Body - Animated Collapsible content */}
                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15, ease: 'easeInOut' }}
                        className="overflow-hidden"
                      >
                        <div className="p-3 flex flex-col gap-2">
                          <div className="p-2 border border-ink/10 bg-base/20 min-h-8 flex flex-col justify-center">
                            {isNxDomain ? (
                              <span className="inline-flex items-center gap-1.5 font-mono text-[9px] font-bold text-red-500 bg-red-50 border border-red-200 px-2 py-0.5 w-fit">
                                ⚠️ NXDOMAIN (Non-Existent Domain)
                              </span>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                {entry.answers.map((ans, aIdx) => (
                                  <div
                                    key={aIdx}
                                    className="font-mono text-[9px] text-ink/75 break-all truncate"
                                    title={formatRecordValue(ans.value, entry.type)}
                                  >
                                    {formatRecordValue(ans.value, entry.type)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Bottom Section: Expiry countdown and progress bar */}
                          <div className="flex flex-col gap-1 mt-1">
                            <div className="flex justify-between items-center font-mono text-[8px]">
                              <span className="text-ink/40 uppercase">Expires in</span>
                              <span className="font-bold text-accent font-mono leading-none">
                                {formatHms(entry.ttlRemaining)}
                              </span>
                            </div>

                            {/* Progress Bar */}
                            <div className="w-full h-1 bg-ink/10 relative overflow-hidden">
                              <div
                                className="absolute top-0 bottom-0 left-0 bg-accent transition-all duration-1000 ease-linear"
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}
