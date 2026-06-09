import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export default function BrutalistSelect({ options, value, onChange, label }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative font-mono" ref={containerRef}>
      {label && <div className="text-[10px] text-[#0D0D0D] opacity-50 uppercase tracking-widest mb-2">{label}</div>}
      
      <button 
        type="button"
        className="interactive w-full flex items-center justify-between bg-white border-2 border-[#0D0D0D] px-4 py-3 text-sm font-bold shadow-[4px_4px_0_0_#0D0D0D] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#0D0D0D] transition-all"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{options.find(o => o.value === value)?.label || 'Select...'}</span>
        <span className="text-[10px] opacity-50">{isOpen ? '▲' : '▼'}</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 top-full left-0 right-0 mt-2 bg-white border-2 border-[#0D0D0D] shadow-[4px_4px_0_0_#0D0D0D]"
          >
            {options.map((option) => (
              <button
                key={option.value}
                className="interactive w-full text-left px-4 py-2.5 text-sm font-bold hover:bg-[#FF4D00] hover:text-white border-b last:border-b-0 border-[#0D0D0D]/10 transition-colors"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
              >
                {option.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
