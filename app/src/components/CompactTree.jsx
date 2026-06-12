const W = 720;
const H = 140;
const NW = 130;
const NH = 44;

const STANDARD_NODES_CONFIG = [
  { id: 'client', type: 'CLIENT', label: 'Client Stub', treeX: 20, treeY: 55, geo: { flag: '💻', org: 'Local Machine' }, ip: '127.0.0.1' },
  { id: 'local', type: 'LOCAL', label: 'Custom DNS', treeX: 185, treeY: 55, geo: { flag: '🖥️', org: 'Local DNS Server' }, ip: '127.0.0.1:5354' },
  { id: 'root', type: 'ROOT', label: 'Root (.)', treeX: 370, treeY: 15, geo: { flag: '🇺🇸', org: 'Root Servers' }, ip: '198.41.0.4' },
  { id: 'tld', type: 'TLD', label: 'TLD', treeX: 370, treeY: 95, geo: { flag: '🇺🇸', org: 'TLD Registry' }, ip: '192.5.6.30' },
  { id: 'auth', type: 'AUTH', label: 'Authoritative', treeX: 580, treeY: 55, geo: { flag: '🔐', org: 'Auth Nameserver' }, ip: 'Auth IP' },
];

const getCenter = (node) => ({
  x: node.treeX + NW / 2,
  y: node.treeY + NH / 2,
});

export default function CompactTree({ hops, edges, selectedHop, onSelectHop, activeStep, playbackState }) {
  // Map standard layout to actual trace data
  const nodes = STANDARD_NODES_CONFIG.map((cfg) => {
    const actualHop = hops?.find((h) => h.type === cfg.type);
    if (actualHop) {
      // Dynamic adjustments for TLD labels (e.g. .com or .org)
      let label = cfg.label;
      if (cfg.type === 'TLD') {
        const parts = actualHop.label.split(' ');
        label = parts[parts.length - 1] || 'TLD';
      }
      return {
        ...cfg,
        ...actualHop,
        label,
        isPlaceholder: false,
      };
    }
    return {
      ...cfg,
      isPlaceholder: true,
    };
  });

  const activeLocalHop = hops?.find((h) => h.type === 'LOCAL');
  const isLocalHit = activeLocalHop?.response?.isAuthoritative && activeLocalHop?.response?.answers?.length > 0;

  // Use actual trace edges or fallback to default layout edges if empty
  const defaultEdges = [
    { from: 'client', to: 'local', label: 'Query' },
    isLocalHit 
      ? { from: 'local', to: 'auth', label: 'Local Answer' }
      : { from: 'local', to: 'root', label: 'Referral' },
    { from: 'root', to: 'tld', label: 'Referral' },
    { from: 'tld', to: 'auth', label: 'Referral' },
  ];

  const edgesToRender = edges && edges.length > 0 ? edges : defaultEdges;

  return (
    <div className="w-full flex justify-center py-4 select-none">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-[900px] h-auto block sharp-border border-ink/10 bg-base/30"
      >
        <defs>
          <pattern id="treeGrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(13,13,13,0.03)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#treeGrid)" />

        {/* Edges */}
        {edgesToRender.map((edge, i) => {
          const fromNode = nodes.find((n) => n.id === edge.from);
          const toNode = nodes.find((n) => n.id === edge.to);
          if (!fromNode || !toNode) return null;

          const fromHop = hops?.find((h) => h.id === edge.from);
          const toHop = hops?.find((h) => h.id === edge.to);

          let isActive = false;
          let isAnimating = false;

          if (fromHop && toHop) {
            isActive = toHop.step <= activeStep;
            isAnimating = toHop.step === activeStep && playbackState === 'PLAYING';
          } else if (edge.to === 'auth' && isLocalHit) {
            // Local hit case where Auth hop is virtual and never in actual hops array
            isActive = activeStep >= 1;
            isAnimating = activeStep === 1 && playbackState === 'PLAYING';
          } else if (fromHop && !toHop) {
            // Node exists in trace path but next node hasn't been reached/doesn't exist
            isActive = false;
          }

          const fc = getCenter(fromNode);
          const tc = getCenter(toNode);

          const midX = (fc.x + tc.x) / 2;
          const midY = (fc.y + tc.y) / 2;
          const dx = tc.x - fc.x;
          const dy = tc.y - fc.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const curveOff = dist > 200 ? -12 : 0;
          const cpX = midX + (dist > 0 ? curveOff * (dy / dist) : 0);
          const cpY = midY + (dist > 0 ? curveOff * (-dx / dist) : 0);
          const pathD = `M ${fc.x} ${fc.y} Q ${cpX} ${cpY} ${tc.x} ${tc.y}`;

          return (
            <g key={i}>
              <path
                d={pathD}
                fill="none"
                stroke={isActive ? 'var(--color-accent)' : 'rgba(13,13,13,0.1)'}
                strokeWidth={isActive ? 1.5 : 1}
                strokeDasharray={isActive ? '5 3' : '3 3'}
                className={isActive ? 'arrow-path' : ''}
                style={{ transition: 'stroke 0.4s' }}
              />
              <text
                x={cpX}
                y={cpY - 6}
                textAnchor="middle"
                fill={isActive ? 'var(--color-accent)' : 'rgba(13,13,13,0.2)'}
                className="font-mono text-[7px] font-bold"
                style={{ transition: 'fill 0.3s' }}
              >
                {edge.label}
              </text>
              {isAnimating && (
                <circle r="3.5" fill="var(--color-accent)">
                  <animateMotion dur="1.2s" repeatCount="indefinite" path={pathD} />
                  <animate attributeName="r" values="3;5;3" dur="0.8s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const isPlaceholder = node.isPlaceholder;
          const hopIndex = hops?.findIndex((h) => h.id === node.id);
          const isReached = !isPlaceholder && hopIndex !== -1 && hopIndex <= activeStep;
          const isSel = selectedHop === node.id;
          const isAuth = node.type === 'AUTH';

          // Disable clicks on placeholders or unreached nodes
          const handleNodeClick = () => {
            if (!isPlaceholder && isReached) {
              onSelectHop(node.id);
            }
          };

          return (
            <g
              key={node.id}
              onClick={handleNodeClick}
              className={`interactive ${isPlaceholder || !isReached ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
            >
              {/* Highlight Shadow on Selection */}
              {isSel && (
                <rect
                  x={node.treeX + 3}
                  y={node.treeY + 3}
                  width={NW}
                  height={NH}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={1}
                  opacity={0.4}
                />
              )}

              {/* Node Border Box */}
              <rect
                x={node.treeX}
                y={node.treeY}
                width={NW}
                height={NH}
                fill={isSel ? (isAuth ? 'var(--color-accent)' : 'var(--color-ink)') : 'var(--color-base)'}
                stroke={isReached ? (isAuth ? 'var(--color-accent)' : 'var(--color-ink)') : 'rgba(13,13,13,0.12)'}
                strokeWidth={isSel ? 2 : 1}
                className="transition-all duration-200"
              />

              {/* Node Flag/Icon Emoji */}
              <text x={node.treeX + 8} y={node.treeY + 18} className="text-[11px]">
                {node.geo?.flag || '🌐'}
              </text>

              {/* Label */}
              <text
                x={node.treeX + 24}
                y={node.treeY + 18}
                fill={isSel ? 'var(--color-base)' : isReached ? 'var(--color-ink)' : 'rgba(13,13,13,0.3)'}
                className="font-display text-[9px] font-black uppercase transition-colors duration-200"
              >
                {node.label}
              </text>

              {/* IP / Latency */}
              <text
                x={node.treeX + 8}
                y={node.treeY + 30}
                fill={isSel ? 'rgba(240,237,232,0.6)' : 'rgba(13,13,13,0.4)'}
                className="font-mono text-[7px] transition-colors duration-200"
              >
                {node.ip}
                {isReached && node.latencyMs > 0 ? ` · ${node.latencyMs}ms` : ''}
              </text>

              {/* Org / Host */}
              <text
                x={node.treeX + 8}
                y={node.treeY + 39}
                fill={isSel ? 'rgba(240,237,232,0.4)' : 'rgba(13,13,13,0.3)'}
                className="font-mono text-[6.5px] truncate transition-colors duration-200"
                style={{ maxWidth: NW - 16 }}
              >
                {node.geo?.org ? (node.geo.org.length > 25 ? `${node.geo.org.substring(0, 22)}...` : node.geo.org) : ''}
              </text>

              {/* Authoritative Badge (AA flag) */}
              {isAuth && isReached && node.response?.flags?.includes('AA') && (
                <g>
                  <rect
                    x={node.treeX + NW - 24}
                    y={node.treeY + 3}
                    width={20}
                    height={10}
                    fill={isSel ? 'var(--color-base)' : 'var(--color-accent)'}
                  />
                  <text
                    x={node.treeX + NW - 21}
                    y={node.treeY + 11}
                    fill={isSel ? 'var(--color-accent)' : 'var(--color-base)'}
                    className="font-mono text-[6px] font-bold"
                  >
                    AA
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
