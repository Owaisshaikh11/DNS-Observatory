import { useState } from 'react';

const FLAG_DESC = {
    'QR': 'Query Response — This packet is a response, not a query.',
    'AA': 'Authoritative Answer — Response from the zone owner, not cached.',
    'TC': 'Truncation — Response too large for UDP, was truncated.',
    'RD': 'Recursion Desired — Client asked server to resolve recursively.',
    'RA': 'Recursion Available — Server supports recursive resolution.',
};

export default function FlagBadge({ flag }) {
    const [tip, setTip] = useState(false);
    return (
        <span className="interactive relative inline-block mr-1.5"
            onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
            <span className="font-mono inline-block px-1.5 py-px text-[9px] font-bold transition-all duration-150" style={{
                border: `1px solid ${tip ? 'var(--color-accent)' : 'rgba(13,13,13,0.2)'}`,
                color: tip ? 'var(--color-accent)' : 'var(--color-ink)'
            }}>[{flag}]</span>
            {tip && FLAG_DESC[flag] && (
                <div className="absolute bottom-full left-0 mb-2 w-52 p-2.5 bg-[#F0EDE8] border border-[#0D0D0D] text-[10px] leading-tight font-sans whitespace-normal z-[100]" style={{
                    boxShadow: '3px 3px 0 0 var(--color-accent)'
                }}>
                    <strong className="font-mono text-[#FF4D00] block mb-1 text-[9px]">{flag}</strong>
                    {FLAG_DESC[flag]}
                </div>
            )}
        </span>
    );
}
