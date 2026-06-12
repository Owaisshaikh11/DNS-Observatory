import { motion } from 'framer-motion';

export default function WaterfallBar({ latencyMs, cumulativeMs, totalMs }) {
  const off = totalMs > 0 ? ((cumulativeMs - latencyMs) / totalMs) * 100 : 0;
  const w = totalMs > 0 ? Math.max((latencyMs / totalMs) * 100, 2) : 2;

  return (
    <div className="w-full h-2.5 bg-ink/5 border border-ink/10 relative overflow-hidden select-none">
      {/* Proportional Timing Block */}
      <motion.div
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: `${w}%`, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        style={{ left: `${off}%` }}
        className="absolute top-0 h-full bg-accent"
      />
      {/* Scale lines */}
      {[25, 50, 75].map((p) => (
        <div
          key={p}
          style={{ left: `${p}%` }}
          className="absolute top-0 bottom-0 w-[1px] bg-ink/10 pointer-events-none"
        />
      ))}
    </div>
  );
}
