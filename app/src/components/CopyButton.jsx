import { useState, useEffect } from 'react';

/**
 * A reusable brutalist-styled copy button component.
 * Appears on hover of a parent container with the 'group' class.
 *
 * @param {Object} props
 * @param {string} props.text - The text string to copy.
 */
export default function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!text) return;
    navigator.clipboard.writeText(String(text))
      .then(() => {
        setCopied(true);
      })
      .catch((err) => {
        console.error('Failed to copy text:', err);
      });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`border bg-transparent font-mono text-[8px] font-bold px-1 py-[0.5px] uppercase cursor-pointer select-none ml-2 shrink-0 inline-flex items-center gap-1 transition-all ${
        copied
          ? 'border-accent text-accent opacity-100'
          : 'border-ink/20 hover:border-ink text-ink hover:text-accent opacity-0 group-hover:opacity-100 focus:opacity-100'
      }`}
    >
      {copied ? '[COPIED]' : '[COPY]'}
    </button>
  );
}
