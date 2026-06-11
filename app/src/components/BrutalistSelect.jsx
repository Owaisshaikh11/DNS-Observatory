import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export default function BrutalistSelect({ options, value, onChange, label, width = "w-[200px]" }) {
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

  // Normalize options to support both string array and object array
  const normalizedOptions = options.map(opt => 
    typeof opt === 'string' ? { value: opt, label: opt } : opt
  );

  const selectedLabel = normalizedOptions.find(o => o.value === value)?.label || value;

  return (
    <div className={`relative ${width} z-30 font-mono interactive-hover`} ref={containerRef}>
      {label && <label className="font-mono text-[9px] uppercase opacity-50 block mb-2">{label}</label>}
      
      <button 
        type="button"
        className="w-full brutalist-select-trigger uppercase flex justify-between items-center outline-none cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="truncate">{selectedLabel}</span>
        <span className={`text-[8px] transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>▼</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
            className="absolute top-[calc(100%+4px)] left-0 w-full brutalist-select-dropdown flex flex-col max-h-[200px] overflow-y-auto z-50"
          >
            {normalizedOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                className="brutalist-select-option text-left cursor-pointer outline-none"
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
