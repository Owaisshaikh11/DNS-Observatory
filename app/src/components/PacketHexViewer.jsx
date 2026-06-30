import { useRef, memo } from 'react';

function PacketHexViewer({
  hexString,
  hoveredRange
}) {
  const hexViewerContainerRef = useRef(null);

  if (!hexString) {
    return (
      <div className="text-ink/40 text-[10.5px] uppercase italic text-center p-4">
        No byte stream payload available.
      </div>
    );
  }

  const bytes = hexString.trim().split(/\s+/);
  const rows = [];
  for (let i = 0; i < bytes.length; i += 16) {
    rows.push(bytes.slice(i, i + 16));
  }

  return (
    <div
      ref={hexViewerContainerRef}
      className="bg-ink p-4 font-mono text-[10.5px] text-[#F0EDE8] overflow-x-auto border border-ink/40 h-full scrollbar-thin select-text"
    >
      <div className="text-[10px] text-accent font-bold uppercase tracking-wider mb-3 select-none flex justify-between">
        <span>Packet Byte Grid // {bytes.length} bytes captured</span>
        {hoveredRange && (
          <span className="text-[#A6E22E] animate-pulse">
            Highlighting bytes {hoveredRange.start} - {hoveredRange.end - 1}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5 min-w-[420px]">
        {rows.map((row, ri) => {
          const offset = (ri * 16).toString(16).padStart(4, '0').toUpperCase();
          return (
            <div key={ri} data-row-index={ri} className="flex gap-6 items-center leading-normal">
              {/* Offset column */}
              <span className="text-[#66D9EF]/45 select-none w-10 font-bold">{offset}</span>

              {/* Hex bytes column */}
              <span className="flex-1 tracking-wider">
                {row.map((b, bi) => {
                  const globalIdx = ri * 16 + bi;
                  const isHovered =
                    hoveredRange && globalIdx >= hoveredRange.start && globalIdx < hoveredRange.end;
                  const isTxId = globalIdx < 2;
                  const isFlags = globalIdx >= 2 && globalIdx < 4;
                  const upperByte = b.toUpperCase();

                  return (
                    <span
                      key={bi}
                      className={`inline-block text-center w-6 transition-all duration-100 ${
                        isHovered
                          ? 'bg-accent text-white font-black scale-110 rounded-none'
                          : isTxId
                          ? 'text-[#F92672] font-bold'
                          : isFlags
                          ? 'text-[#AE81FF] font-semibold'
                          : ''
                      }`}
                      style={{ marginRight: bi === 7 ? '10px' : '6px' }}
                    >
                      {upperByte}
                    </span>
                  );
                })}
              </span>

              {/* ASCII Column */}
              <span className="text-[#A6E22E]/65 font-semibold tracking-wider select-none w-24 text-right">
                {row.map((b, bi) => {
                  const globalIdx = ri * 16 + bi;
                  const isHovered =
                    hoveredRange && globalIdx >= hoveredRange.start && globalIdx < hoveredRange.end;
                  const charCode = parseInt(b, 16);
                  const isPrintable = charCode >= 32 && charCode <= 126;
                  const char = isPrintable ? String.fromCharCode(charCode) : '.';

                  return (
                    <span key={bi} className={isHovered ? 'text-accent font-black' : ''}>
                      {char}
                    </span>
                  );
                }).reduce((acc, curr) => acc + curr.props.children, '')}
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3.5 pt-2 border-t border-base/10 text-[9.5px] text-[#F0EDE8]/45 flex gap-4 select-none">
        <span>
          <span className="text-[#F92672] font-bold mr-1">00-01</span>
          Transaction ID
        </span>
        <span>
          <span className="text-[#AE81FF] font-bold mr-1">02-03</span>
          Header Flags
        </span>
      </div>
    </div>
  );
}

export default memo(PacketHexViewer);
