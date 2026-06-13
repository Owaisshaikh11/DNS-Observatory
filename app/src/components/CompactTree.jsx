import { useState, useEffect, useRef } from 'react';

const NW = 130;
const NH = 44;

const getCenter = (node) => ({
  x: node.treeX + NW / 2,
  y: node.treeY + NH / 2,
});

const simplifyLabel = (label) => {
  if (!label) return '';
  if (label.startsWith('Query ')) {
    const parts = label.split(' ');
    const type = parts[parts.length - 1] || 'ALL';
    return `Query (${type})`;
  }
  if (label.includes('Local authoritative answer')) {
    return 'Auth Answer';
  }
  if (label.includes('Iterative')) {
    return 'Iterative';
  }
  if (label.startsWith('NS ')) {
    const match = label.match(/NS\s+([^\s→]+)/);
    if (match) {
      return `NS (${match[1]})`;
    }
    return 'NS Referral';
  }
  return label;
};

const getLatencyColor = (latencyMs) => {
  if (latencyMs === undefined || latencyMs === null) return 'var(--color-accent)';
  if (latencyMs < 40) return '#22C55E'; // green
  if (latencyMs <= 150) return '#FF4D00'; // orange
  return '#EF4444'; // red
};

export default function CompactTree({ hops, edges, selectedHop, onSelectHop, activeStep, playbackState }) {
  const columns = hops?.length || 1;
  const W = Math.max(850, columns * 240);
  const H = 280;
  const paddingX = 30;

  // Dynamic layout calculations
  const nodes = hops?.map((hop, index) => {
    let treeX = paddingX;
    if (columns > 1) {
      treeX = paddingX + (index * (W - 2 * paddingX - NW)) / (columns - 1);
    }

    let treeY = 118; // default center (perfectly symmetric vertically)
    if (hop.type === 'ROOT') {
      treeY = 30;
    } else if (hop.type === 'TLD') {
      treeY = 206;
    }

    return {
      ...hop,
      treeX,
      treeY,
      isPlaceholder: false,
    };
  }) || [];

  const edgesToRender = edges || [];

  // Zoom & Pan states
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [activeTooltip, setActiveTooltip] = useState(null); // { edge, toNode, x, y }

  const defaultScale = columns > 5 ? Math.max(0.4, 5 / columns) : 1;

  // Auto-centering helper
  const centerCanvas = (targetScale) => {
    if (!containerRef.current) return;
    const V_w = containerRef.current.clientWidth;
    const V_h = containerRef.current.clientHeight;
    const zoomScale = targetScale !== undefined ? targetScale : defaultScale;

    setScale(zoomScale);
    setPosition({
      x: V_w / 2 - (W / 2) * zoomScale,
      y: V_h / 2 - (H / 2) * zoomScale,
    });
  };

  // Focus and Zoom-in on a specific node
  const focusNode = (nodeId, customScale = 1.25) => {
    if (!containerRef.current || !nodes || nodes.length === 0) return;

    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const V_w = containerRef.current.clientWidth;
    const V_h = containerRef.current.clientHeight;

    const X_target = node.treeX + NW / 2;
    const Y_target = node.treeY + NH / 2;

    setScale(customScale);
    setPosition({
      x: V_w / 2 - X_target * customScale,
      y: V_h / 2 - Y_target * customScale,
    });
  };

  // Zoom relative to the center of the viewport
  const zoomAboutCenter = (zoomFactor) => {
    if (!containerRef.current) return;
    const V_w = containerRef.current.clientWidth;
    const V_h = containerRef.current.clientHeight;
    const C_x = V_w / 2;
    const C_y = V_h / 2;

    const S_old = scale;
    const S_new = Math.min(Math.max(scale * zoomFactor, 0.3), 3.5);

    const X_svg = (C_x - position.x) / S_old;
    const Y_svg = (C_y - position.y) / S_old;

    setScale(S_new);
    setPosition({
      x: C_x - X_svg * S_new,
      y: C_y - Y_svg * S_new,
    });
  };

  // Initialize: Center whole canvas on columns change
  useEffect(() => {
    centerCanvas(defaultScale);
  }, [columns, defaultScale]);

  // Camera follow effect for active steps during playback
  useEffect(() => {
    if (hops && hops[activeStep]) {
      focusNode(hops[activeStep].id, 1.25);
    }
  }, [activeStep]);

  // Camera follow effect when selectedHop changes
  useEffect(() => {
    if (selectedHop) {
      focusNode(selectedHop, 1.25);
    }
  }, [selectedHop]);

  // Keep focus node centered during window resizes
  useEffect(() => {
    const handleResize = () => {
      const targetId = selectedHop || (hops && hops[activeStep]?.id);
      if (targetId) {
        focusNode(targetId, scale);
      } else {
        centerCanvas(scale);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [selectedHop, activeStep, scale, hops]);

  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
    zoomAboutCenter(zoomFactor);
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return; // Only left mouse drags
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden select-none border border-ink bg-base/30 shadow-[3px_3px_0_0_#0D0D0D] min-h-[220px]"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      <div
        style={{
          width: W,
          height: H,
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          transformOrigin: '0 0',
          transition: isDragging ? 'none' : 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        className="pointer-events-auto absolute left-0 top-0"
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className="block w-full h-full"
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
              const toIndex = hops.findIndex((h) => h.id === toHop.id);
              isActive = toIndex <= activeStep;
              isAnimating = toIndex === activeStep && playbackState === 'PLAYING';
            } else {
              const fromIndex = hops.findIndex((h) => h.id === fromHop.id);
              isActive = fromIndex !== -1 && fromIndex <= activeStep;
              isAnimating = fromIndex === activeStep && playbackState === 'PLAYING';
            }

            const fc = getCenter(fromNode);
            const tc = getCenter(toNode);

            const midX = (fc.x + tc.x) / 2;
            const midY = (fc.y + tc.y) / 2;

            // Horizontal Bezier curve (S-Curve) calculation
            const cp1x = fc.x + (tc.x - fc.x) / 2;
            const cp1y = fc.y;
            const cp2x = fc.x + (tc.x - fc.x) / 2;
            const cp2y = tc.y;
            const pathD = `M ${fc.x} ${fc.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tc.x} ${tc.y}`;

            const cpX = midX;
            const cpY = fc.y === tc.y ? fc.y + 1 : (fc.y + tc.y) / 2 + 3;

            const strokeColor = isActive ? getLatencyColor(toNode.latencyMs) : 'rgba(13,13,13,0.1)';
            const dotColor = strokeColor;

            const isHovered = activeTooltip?.edge === edge;

            return (
              <g key={i}>
                {/* Secondary thick background highlight trace on hover */}
                {isActive && isHovered && (
                  <path
                    d={pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={6}
                    className="opacity-20"
                    style={{ transition: 'stroke-width 0.2s' }}
                  />
                )}

                {/* Bezier Path */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={isActive ? (isHovered ? 2.5 : 1.5) : 1}
                  strokeDasharray={isActive ? '5 3' : '3 3'}
                  className={`${isActive ? 'arrow-path' : ''} ${isActive && isHovered ? 'arrow-path-hovered' : ''}`}
                  style={{ transition: 'stroke-width 0.2s, stroke 0.4s' }}
                />
                
                {/* Edge Label */}
                <text
                  x={cpX}
                  y={cpY - 6}
                  textAnchor="middle"
                  fill={isActive ? strokeColor : 'rgba(13,13,13,0.2)'}
                  className="font-mono text-[10px] font-bold select-none pointer-events-none transition-all duration-200"
                  style={{
                    textShadow: '1.5px 1.5px 0 var(--color-base), -1.5px 1.5px 0 var(--color-base), 1.5px -1.5px 0 var(--color-base), -1.5px -1.5px 0 var(--color-base)',
                  }}
                >
                  {simplifyLabel(edge.label)}
                </text>

                {/* Invisible hover overlay path for tooltips */}
                {isActive && (
                  <path
                    d={pathD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={8}
                    className="cursor-pointer interactive"
                    onMouseEnter={() => {
                      setActiveTooltip({
                        edge,
                        toNode,
                        x: midX,
                        y: midY,
                      });
                    }}
                    onMouseLeave={() => {
                      setActiveTooltip(null);
                    }}
                  />
                )}

                {/* Animated packet dot */}
                {isAnimating && (
                  <circle r="3.5" fill={dotColor}>
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
            const isCname = node.type === 'CNAME_REDIRECT';

            const handleNodeClick = () => {
              if (!isPlaceholder && isReached) {
                onSelectHop(node.id);
              }
            };

            return (
              <g
                key={node.id}
                onClick={handleNodeClick}
                className={`interactive transition-all duration-200 ${
                  isPlaceholder || !isReached
                    ? 'cursor-not-allowed opacity-35'
                    : 'cursor-pointer group'
                }`}
              >
                {/* Solid Brutalist Shadow */}
                {!isPlaceholder && isReached && (
                  <rect
                    x={node.treeX + 2.5}
                    y={node.treeY + 2.5}
                    width={NW}
                    height={NH}
                    fill={isSel ? 'var(--color-accent)' : 'var(--color-ink)'}
                    className="opacity-20 group-hover:opacity-30 transition-opacity duration-200"
                  />
                )}

                {/* Front Card */}
                <g className="transition-transform duration-200 group-hover:-translate-x-[1.5px] group-hover:-translate-y-[1.5px]">
                  <foreignObject
                    x={node.treeX}
                    y={node.treeY}
                    width={NW}
                    height={NH}
                    className="overflow-visible"
                  >
                    <div
                      className={`w-full h-full border flex flex-col justify-between p-1.5 select-none transition-all duration-200 ${
                        isSel
                          ? isCname
                            ? 'bg-accent text-base border-accent'
                            : 'bg-ink text-base border-ink'
                          : isReached
                          ? 'bg-base/80 backdrop-blur-[2.5px] text-ink border-ink'
                          : 'bg-base/40 backdrop-blur-[1px] text-ink/30 border-ink/12'
                      }`}
                      style={{
                        borderRadius: '0px',
                      }}
                    >
                      {/* Top line: flag + label + optional AA badge */}
                      <div className="flex items-center gap-1 w-full min-w-0">
                        <span className="text-[10px] shrink-0 leading-none select-none">
                          {isReached ? (node.geo?.flag || '🌐') : '🌐'}
                        </span>
                        <span className={`font-display text-[9px] font-black uppercase truncate leading-none ${isSel ? 'text-base' : isReached ? 'text-ink' : 'text-ink/30'}`}>
                          {node.label}
                        </span>
                        {!isCname && isReached && node.response?.flags?.includes('AA') && (
                          <span className={`ml-auto text-[6px] font-mono font-bold px-0.5 border leading-none shrink-0 select-none ${isSel ? 'bg-base text-accent border-base' : 'bg-accent text-base border-accent'}`}>
                            AA
                          </span>
                        )}
                      </div>

                      {/* Middle line: IP / Latency or target CNAME */}
                      <div className={`font-mono text-[7px] leading-none truncate ${isSel ? 'text-base/60' : 'text-ink/40'}`}>
                        {isCname
                          ? (isReached ? `→ ${node.cnameTo}` : '?.?.?.?')
                          : (isReached ? node.ip : '?.?.?.?')
                        }
                        {isReached && node.latencyMs > 0 ? ` · ${node.latencyMs}ms` : ''}
                      </div>

                      {/* Bottom line: Org */}
                      <div className={`font-mono text-[6.5px] leading-none truncate ${isSel ? 'text-base/40' : 'text-ink/35'}`} style={{ maxWidth: NW - 12 }}>
                        {isCname
                          ? (isReached ? `Alias of ${node.cnameFrom}` : 'Awaiting Redirection...')
                          : (isReached
                              ? (node.geo?.org ? (node.geo.org.length > 25 ? `${node.geo.org.substring(0, 22)}...` : node.geo.org) : '')
                              : 'Awaiting Connection...')
                        }
                      </div>
                    </div>
                  </foreignObject>
                </g>
              </g>
            );
          })}

          {/* Referral Info Tooltips */}
          {activeTooltip && activeTooltip.toNode.type !== 'CLIENT' && activeTooltip.toNode.type !== 'CNAME_REDIRECT' && (
            <foreignObject
              x={activeTooltip.x - 100}
              y={activeTooltip.y - 85}
              width="200"
              height="80"
              className="pointer-events-none z-50 overflow-visible"
            >
              <div className="bg-ink text-base p-2 border border-accent font-mono text-[9px] shadow-[2px_2px_0_0_#FF4D00] flex flex-col gap-1 w-[200px]">
                <div className="border-b border-base/20 pb-0.5 mb-0.5 text-accent font-bold uppercase tracking-wider">
                  :: Referral Info
                </div>
                <div className="flex justify-between">
                  <span>RCODE:</span>
                  <span className="font-bold text-green-400">{activeTooltip.toNode.response?.rcode || 'NOERROR'}</span>
                </div>
                {activeTooltip.toNode.response?.byteLength && (
                  <div className="flex justify-between">
                    <span>Packet Size:</span>
                    <span className="font-bold text-base">{activeTooltip.toNode.response.byteLength} bytes</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Delegations (NS):</span>
                  <span className="font-bold text-base">{activeTooltip.toNode.response?.authority?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Glue Records:</span>
                  <span className="font-bold text-base">{activeTooltip.toNode.response?.additional?.length || 0}</span>
                </div>
              </div>
            </foreignObject>
          )}
        </svg>
      </div>

      {/* Segmented Zoom / Reset Controls Toolbar */}
      <div className="absolute bottom-3 right-3 flex items-center border border-ink bg-base shadow-[2px_2px_0_0_#0D0D0D] z-30 font-mono text-[9px] font-bold pointer-events-auto">
        <button
          onClick={(e) => {
            e.stopPropagation();
            zoomAboutCenter(1.15);
          }}
          className="px-2.5 py-1 border-r border-ink hover:bg-ink hover:text-base active:translate-y-0 transition-colors duration-100 cursor-pointer"
          title="Zoom In"
        >
          +
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            zoomAboutCenter(0.85);
          }}
          className="px-2.5 py-1 border-r border-ink hover:bg-ink hover:text-base active:translate-y-0 transition-colors duration-100 cursor-pointer"
          title="Zoom Out"
        >
          -
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            centerCanvas(defaultScale);
          }}
          className="px-2.5 py-1 hover:bg-ink hover:text-base active:translate-y-0 transition-colors duration-100 cursor-pointer"
          title="Reset Zoom & Centering"
        >
          RESET
        </button>
      </div>
    </div>
  );
}
