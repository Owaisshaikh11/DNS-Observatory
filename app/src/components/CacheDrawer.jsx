import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Trash2, Database, Zap } from 'lucide-react';
import { useTraceStore } from '../stores/useTraceStore';
import { formatRecordValue } from '../utils/dnsFormatter';

export default function CacheDrawer({ isOpen, onClose }) {
  const { bypassCache, setBypassCache } = useTraceStore();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

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
        setEntries((prev) => prev.filter((e) => !(e.domain === domain && e.type === type)));
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

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed right-0 top-0 bottom-0 w-full sm:w-[460px] bg-[#F0EDE8]/90 backdrop-blur-md border-l-2 border-ink z-50 flex flex-col shadow-[-4px_0_0_0_#0D0D0D] select-none"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-ink/20 flex justify-between items-center bg-base/40">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-accent" />
          <h2 className="font-display font-black text-lg uppercase tracking-tight text-ink">
            Resolver Cache
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 border border-ink/20 hover:border-ink hover:text-accent transition-all duration-100 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Controls Container */}
      <div className="p-6 border-b border-ink/10 flex flex-col gap-4 bg-white/30">
        {/* Toggle Switch */}
        <div className="flex justify-between items-center border border-ink p-4 bg-base shadow-[2px_2px_0_0_#0D0D0D]">
          <div className="flex flex-col gap-0.5">
            <span className="font-display font-black text-[11px] uppercase tracking-wider text-ink">
              Cache Resolution Mode
            </span>
            <span className="font-mono text-[9px] text-ink/50">
              Serve hits instantly from cache
            </span>
          </div>
          <button
            onClick={() => setBypassCache(!bypassCache)}
            className={`w-11 h-6 border-2 border-ink flex items-center p-0.5 transition-all duration-200 cursor-pointer ${
              !bypassCache ? 'bg-accent' : 'bg-[#E5E0D8]'
            }`}
          >
            <div
              className={`w-4.5 h-4.5 border border-ink bg-white transition-all duration-200 ${
                !bypassCache ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Flush Button */}
        <button
          onClick={handleFlushCache}
          className="w-full py-2.5 border border-ink bg-ink text-base font-mono text-[10px] font-bold uppercase tracking-widest hover:bg-accent hover:border-accent transition-colors duration-150 cursor-pointer shadow-[2px_2px_0_0_#0D0D0D] active:translate-y-[2px] active:shadow-none"
        >
          Flush Cache Database
        </button>
      </div>

      {/* Cache Entries List */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4 scrollbar-thin">
        <div className="font-mono text-[9px] uppercase tracking-wider text-ink/40 font-bold mb-1">
          Cached Records ({entries.length})
        </div>

        {loading ? (
          <div className="font-mono text-[10px] text-ink/50 py-6 text-center animate-pulse">
            [ Loading cache database... ]
          </div>
        ) : entries.length === 0 ? (
          <div className="border border-dashed border-ink/30 p-8 bg-white/20 text-center flex flex-col items-center gap-2">
            <Zap className="w-5 h-5 text-ink/30" />
            <p className="font-mono text-[10px] text-ink/50">
              Virtual Resolver Cache is empty. Enable Cache Mode and trace a domain to populate.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {entries.map((entry) => {
              const isNxDomain = entry.status === 'NXDOMAIN';
              const progressPct =
                entry.originalTtl > 0 ? (entry.ttlRemaining / entry.originalTtl) * 100 : 0;

              return (
                <div
                  key={`${entry.domain}:${entry.type}`}
                  className="border border-ink bg-white p-3.5 shadow-[2px_2px_0_0_#0D0D0D] flex flex-col gap-2 relative overflow-hidden"
                >
                  {/* Top line: domain & type / evict button */}
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col min-w-0">
                      <span className="font-display font-black text-xs text-ink truncate uppercase">
                        {entry.domain}
                      </span>
                      <span className="font-mono text-[8px] text-ink/40 uppercase font-black">
                        Type: {entry.type} · Base TTL {entry.originalTtl}s
                      </span>
                    </div>

                    <button
                      onClick={() => handleEvictEntry(entry.domain, entry.type)}
                      className="p-1 border border-transparent hover:border-ink hover:text-red-500 transition-all duration-100 cursor-pointer text-ink/40 hover:bg-red-50"
                      title="Evict Record"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Middle Section: Records values or negative caching warning */}
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
                    <div className="flex justify-between items-center font-mono text-[8.5px]">
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
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}
