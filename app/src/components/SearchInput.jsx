import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import HistoryDropdown from './HistoryDropdown';

const placeholderDomains = ['GOOGLE.COM', 'GITHUB.COM', 'WIKIPEDIA.ORG'];

export default function SearchInput({
  domainInput,
  setDomainInput,
  isFocused,
  setIsFocused,
  inputError,
  pasteError,
  setPasteError,
  validationErrors,
  recentQueries,
  clearRecentQueries,
  handleRecentQueryClick,
  handleNativePaste,
  handleMobilePaste,
  inputRef,
  showHistory,
  setShowHistory,
  highlightedIndex,
  setHighlightedIndex
}) {
  const [currentPlaceholder, setCurrentPlaceholder] = useState('');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  // Typing animation for placeholders
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

  const getDynamicFontSize = (len) => {
    if (len > 30) return 'text-[3.5vw] md:text-[2.5vw]';
    if (len > 20) return 'text-[5vw] md:text-[3.5vw]';
    return 'text-[7vw] md:text-[5vw]';
  };

  const handleInputFocus = () => {
    setIsFocused(true);
  };

  return (
    <div className="w-full flex flex-col items-center gap-12">
      <div
        className="w-full py-4 flex flex-col items-center group cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        <div className="w-full max-w-xl relative py-2 flex flex-col items-center">
          {/* Hidden input to capture keyboard events */}
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={domainInput}
            onFocus={handleInputFocus}
            onBlur={() => {
              // Note: blur handling is managed in EntryPage via handleInputBlur to allow clicks inside history dropdown
            }}
            onChange={(e) => {
              setDomainInput(e.target.value.toLowerCase());
              if (pasteError) setPasteError(null);
              setHighlightedIndex(-1);
            }}
            onKeyDown={(e) => {
              if (!recentQueries || recentQueries.length === 0) return;

              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!showHistory) {
                  setShowHistory(true);
                  setHighlightedIndex(0);
                  return;
                }
                setHighlightedIndex((prev) => (prev + 1) % recentQueries.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (!showHistory) {
                  setShowHistory(true);
                  setHighlightedIndex(recentQueries.length - 1);
                  return;
                }
                setHighlightedIndex((prev) => (prev - 1 + recentQueries.length) % recentQueries.length);
              } else if (e.key === 'Enter') {
                if (showHistory && highlightedIndex >= 0) {
                  e.preventDefault();
                  handleRecentQueryClick(recentQueries[highlightedIndex]);
                }
              } else if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault();
                setShowHistory(false);
                setHighlightedIndex(-1);
              }
            }}
            onPaste={handleNativePaste}
            placeholder=""
            className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-text caret-transparent"
          />

          {/* Styled text display */}
          <motion.div
            animate={inputError ? { x: [-12, 12, -10, 10, -5, 5, 0] } : {}}
            transition={{ duration: 0.4 }}
            className={`w-full text-center font-mono font-bold tracking-tight select-none h-[1.2em] flex items-center justify-center ${getDynamicFontSize(
              (highlightedIndex >= 0 && showHistory ? recentQueries[highlightedIndex].domain : domainInput).length
            )}`}
          >
            {highlightedIndex >= 0 && showHistory ? (
              <span className="text-ink">
                {recentQueries[highlightedIndex].domain.toUpperCase()}
                {isFocused && <span className="animate-blink text-accent ml-1">█</span>}
              </span>
            ) : domainInput ? (
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

          <div
            className={`absolute bottom-0 left-0 w-full h-[1.5px] transition-all duration-300 ${
              domainInput.trim()
                ? validationErrors.length === 0
                  ? 'bg-green-600'
                  : 'bg-accent'
                : isFocused
                ? 'bg-accent'
                : 'bg-gradient-to-r from-transparent via-ink/30 group-hover:via-accent to-transparent'
            }`}
          ></div>

          {/* Clean History Dropdown */}
          <HistoryDropdown
            showHistory={showHistory}
            recentQueries={recentQueries}
            highlightedIndex={highlightedIndex}
            setHighlightedIndex={setHighlightedIndex}
            handleRecentQueryClick={handleRecentQueryClick}
            clearRecentQueries={clearRecentQueries}
            setShowHistory={setShowHistory}
          />
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
          {isFocused && recentQueries && recentQueries.length > 0 ? (
            <div className="hidden md:block font-mono text-[9px] uppercase tracking-[0.15em] text-center select-none text-accent font-bold animate-pulse mt-2">
              [ PRESS ↑ / ↓ TO CYCLE RECENT HISTORY ]
            </div>
          ) : (
            <div className="hidden md:block font-mono text-[9px] uppercase tracking-[0.15em] text-center select-none opacity-30 mt-2">
              [ PRESS CTRL+V TO PASTE URL ]
            </div>
          )}

          {/* Mobile responsive paste button */}
          <div className="block md:hidden mt-1">
            <button
              type="button"
              onClick={handleMobilePaste}
              className="w-10 h-10 flex items-center justify-center border border-ink sharp-border bg-base active:bg-ink active:text-[var(--base)] transition-all duration-200 active:shadow-[1.5px_1.5px_0_0_#FF4D00] shadow-[1.5px_1.5px_0_0_#0D0D0D] cursor-pointer interactive-hover"
              title="Paste from clipboard"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
