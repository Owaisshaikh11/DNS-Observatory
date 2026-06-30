export default function HistoryDropdown({
  showHistory,
  recentQueries,
  highlightedIndex,
  setHighlightedIndex,
  handleRecentQueryClick,
  clearRecentQueries,
  setShowHistory
}) {
  if (!showHistory || !recentQueries || recentQueries.length === 0) {
    return null;
  }

  return (
    <div className="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 w-full max-w-md bg-white border border-ink/15 z-50 shadow-[0_8px_30px_rgba(13,13,13,0.08)] overflow-hidden flex flex-col select-none">
      {/* Header bar */}
      <div className="bg-ink/[0.02] border-b border-ink/5 text-ink/40 px-3.5 py-2 text-[8px] font-mono flex justify-between items-center select-none uppercase font-bold tracking-wider">
        <span>Recent Lookups</span>
        <span className="text-[7.5px] opacity-60">ESC TO CLOSE</span>
      </div>

      {/* List */}
      <div className="flex flex-col bg-white">
        {recentQueries.map((q, idx) => {
          const isHighlighted = idx === highlightedIndex;
          return (
            <div
              key={idx}
              onMouseDown={(e) => {
                e.preventDefault(); // prevents blur
                handleRecentQueryClick(q);
              }}
              onMouseEnter={() => setHighlightedIndex(idx)}
              className={`w-full flex items-center justify-between px-3.5 py-2 border-b last:border-b-0 border-ink/5 font-mono text-[9px] cursor-pointer transition-colors ${
                isHighlighted
                  ? 'bg-ink/[0.03] text-ink font-semibold'
                  : 'text-ink/70 hover:bg-ink/[0.01]'
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`w-1 h-1 rounded-full transition-all duration-200 ${
                    isHighlighted ? 'bg-accent scale-100' : 'bg-transparent scale-0'
                  }`}
                ></span>
                <span>{q.domain}</span>
                <span className="text-[8px] text-ink/30 font-normal">/ {q.type}</span>
              </span>
              <span
                className={`text-[7.5px] font-bold tracking-wider transition-colors ${
                  isHighlighted ? 'text-accent' : 'text-ink/20'
                }`}
              >
                {isHighlighted ? '← ENTER' : '[SELECT]'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer Clear utility */}
      <div className="border-t border-ink/5 bg-transparent px-3.5 py-1.5 flex justify-end">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault(); // prevents blur
            clearRecentQueries();
            setShowHistory(false);
          }}
          className="text-ink/30 hover:text-error transition-colors font-mono text-[8px] font-bold uppercase tracking-wider hover:underline cursor-pointer select-none bg-transparent border-0"
        >
          [Clear History]
        </button>
      </div>
    </div>
  );
}
