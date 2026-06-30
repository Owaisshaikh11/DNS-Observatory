export default function CnameChain({
  domain,
  playbackState,
  isNxDomain,
  cnameChain = [],
  recordType
}) {
  return (
    <div>
      <span className="font-mono text-[9px] uppercase opacity-45 block mb-2.5 tracking-wider select-none font-bold">
        CNAME Chain Explorer
      </span>
      <div className="font-mono text-xs flex flex-col gap-1.5 select-text">
        <div className="flex items-center gap-2 font-bold text-ink">
          <span className="text-ink/40">■</span>
          <span>{domain}</span>
        </div>
        {playbackState === 'COMPLETE' && !isNxDomain && (
          <div className="flex flex-col gap-1 relative pl-2.5 ml-1">
            <div className="absolute top-0 bottom-1 left-0 w-[1px] bg-ink/20" />
            {cnameChain.map((cn, ci) => (
              <div key={ci} className="text-ink/75 pl-3.5 truncate text-[11px] leading-relaxed">
                ↳ CNAME alias: {cn.to.replace(/\.$/, '')}
              </div>
            ))}
            <div className="text-accent font-bold pl-3.5 text-[11px] leading-relaxed">
              ↳ {recordType} Resolved
            </div>
          </div>
        )}
        {isNxDomain && (
          <div className="flex flex-col gap-1 relative pl-2.5 ml-1">
            <div className="absolute top-0 bottom-1 left-0 w-[1px] bg-ink/20" />
            <div className="text-ink/65 font-bold pl-3.5 text-[11px] leading-relaxed">
              ↳ NXDOMAIN (Break)
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
