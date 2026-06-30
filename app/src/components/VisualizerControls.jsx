import { motion, AnimatePresence } from 'framer-motion';
import { Database } from 'lucide-react';

export default function VisualizerControls({
  activeStep,
  edgesLength,
  playbackState,
  isSlowMo,
  isCacheOpen,
  showNudge,
  handlePrev,
  handleNext,
  togglePlayback,
  toggleSlowMo,
  handleReplay,
  handleToggleCacheDrawer,
  onInspectPackets
}) {
  return (
    <div className="flex items-center gap-6">
      {/* Playback control buttons  */}
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
          disabled={activeStep === edgesLength}
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
        onClick={onInspectPackets}
        className="px-3 py-0.5 border border-accent bg-base text-accent font-bold hover:bg-accent hover:text-[var(--base)] hover:-translate-y-[1px] hover:shadow-[2px_2px_0_0_#0D0D0D] active:translate-y-0 active:shadow-none transition-all duration-150 cursor-pointer"
      >
        INSPECT PACKETS
      </button>

      <div className="relative">
        <button
          onClick={handleToggleCacheDrawer}
          className={`flex items-center gap-1.5 px-3 py-0.5 border font-bold hover:-translate-y-[1px] hover:shadow-[2px_2px_0_0_#0D0D0D] active:translate-y-0 active:shadow-none transition-all duration-150 cursor-pointer ${isCacheOpen
              ? 'bg-accent border-accent text-base font-black shadow-[2px_2px_0_0_#0D0D0D]'
              : 'border-ink/20 hover:border-ink hover:text-accent bg-base text-ink'
            }`}
        >
          <Database className="w-3.5 h-3.5" />
          RESOLVER CACHE
        </button>

        {/* Coach-Mark Tooltip (The Nudge) */}
        <AnimatePresence>
          {showNudge && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              className="absolute right-0 top-full mt-2.5 w-72 border border-ink bg-base/95 backdrop-blur-md text-ink p-3.5 shadow-[3px_3px_0_0_var(--color-accent)] font-mono text-[9.5px] leading-relaxed z-50 flex flex-col gap-1.5 text-left"
            >
              <div className="flex justify-between items-center border-b border-ink/20 pb-1 select-none">
                <span className="font-black text-accent uppercase tracking-wider text-[8px] animate-pulse">
                  :: Cache Inspection Active
                </span>
              </div>
              <div className="text-ink/80 select-text">
                Caching logic has resolved this trace iteratively. Check the active TTLs, cache hits/misses, and live records stored inside memory.
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
