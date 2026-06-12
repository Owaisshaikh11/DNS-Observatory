export default function HexViewer({ hexString }) {
  if (!hexString) return null;

  const bytes = hexString.trim().split(/\s+/);
  const rows = [];
  for (let i = 0; i < bytes.length; i += 16) {
    rows.push(bytes.slice(i, i + 16));
  }

  return (
    <div className="bg-ink p-4 font-mono text-[10px] text-base overflow-x-auto selection:bg-accent/40 selection:text-base border border-ink/40">
      <div className="text-[9px] text-accent font-bold uppercase tracking-wider mb-2 select-none">
        Raw UDP Packet — {bytes.length} bytes
      </div>
      <div className="flex flex-col gap-1 min-w-[480px]">
        {rows.map((row, ri) => {
          const offset = (ri * 16).toString(16).padStart(4, '0').toUpperCase();
          return (
            <div key={ri} className="flex gap-4 items-center leading-normal">
              {/* Offset Column */}
              <span className="text-base/35 select-none w-8 font-bold">{offset}</span>
              
              {/* Hex bytes Column */}
              <span className="flex-1 tracking-wider">
                {row.map((b, bi) => {
                  const globalIdx = ri * 16 + bi;
                  const isTxId = globalIdx < 2;
                  const isFlags = globalIdx >= 2 && globalIdx < 4;
                  const upperByte = b.toUpperCase();

                  return (
                    <span
                      key={bi}
                      className={`${
                        isTxId || isFlags ? 'hex-highlight font-bold text-accent px-0.5' : ''
                      }`}
                      style={{ marginRight: bi === 7 ? '12px' : '6px' }}
                    >
                      {upperByte}
                    </span>
                  );
                })}
              </span>

              {/* ASCII Translation Column */}
              <span className="text-base/35 font-semibold tracking-wider select-none w-24 text-right">
                {row.map((b) => {
                  const charCode = parseInt(b, 16);
                  return charCode >= 32 && charCode <= 126
                    ? String.fromCharCode(charCode)
                    : '.';
                }).join('')}
              </span>
            </div>
          );
        })}
      </div>
      
      {/* Legend */}
      <div className="mt-3 pt-2 border-t border-base/10 text-[9px] text-base/40 flex gap-4 select-none">
        <span>
          <span className="hex-highlight text-accent font-bold px-1 mr-1">00-01</span>
          Transaction ID
        </span>
        <span>
          <span className="hex-highlight text-accent font-bold px-1 mr-1">02-03</span>
          Header Flags
        </span>
      </div>
    </div>
  );
}
