import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import CountryFlag from './CountryFlag';
import ResolverIcon from './ResolverIcon';
import { cleanOrg, formatLabelLines, calculateNodePositions } from '../utils/layoutMath';

const NW = 220;
const NH = 64;



function CompactTree({ hops, edges, selectedHop, onSelectHop, activeStep, playbackState, isCacheHit, recordType }) {
  const isFailedTrace = playbackState !== 'IDLE' && playbackState !== 'PLAYING' && playbackState !== 'PAUSED' && playbackState !== 'COMPLETE';

  const segWidth = 1400;
  const gap = 180;
  const paddingX = 30;

  // Compute node layouts and partition segments using layoutMath utility
  const { calculatedNodes: nodes, segments } = useMemo(() => {
    return calculateNodePositions({ hops, isCacheHit, segWidth, gap, paddingX });
  }, [hops, isCacheHit]);

  const W = Math.max(1600, segments.length * (segWidth + gap));
  const H = 500;
  const columns = segments.length * 2.5;

  const edgesToRender = useMemo(() => edges || [], [edges]);

  // Zoom & Pan states
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [activeTooltip, setActiveTooltip] = useState(null); // { edge, toNode, x, y }

  const defaultScale = columns > 5 ? Math.max(0.4, 5 / columns) : 1;

  // Auto-centering helper
  const centerCanvas = useCallback((targetScale) => {
    if (!containerRef.current) return;
    const V_w = containerRef.current.clientWidth;
    const V_h = containerRef.current.clientHeight;
    const zoomScale = targetScale !== undefined ? targetScale : defaultScale;

    setScale(zoomScale);
    setPosition({
      x: V_w / 2 - (W / 2) * zoomScale,
      y: V_h / 2 - (H / 2) * zoomScale,
    });
  }, [defaultScale, W]);

  // Focus and Zoom-in on a specific node
  const focusNode = useCallback((nodeId, customScale = 1.25) => {
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
  }, [nodes]);

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

  // Initialize: Center canvas on segments change
  useEffect(() => {
    const timer = setTimeout(() => {
      centerCanvas(defaultScale);
    }, 0);
    return () => clearTimeout(timer);
  }, [columns, defaultScale, centerCanvas]);

  // Camera follow effect: focus on node receiving the active step packet (prioritize explicitly selectedHop)
  useEffect(() => {
    const activeEdge = edgesToRender.find(e => e.step === activeStep);
    const targetNodeId = selectedHop || activeEdge?.to || (hops && hops[0]?.id);

    if (targetNodeId) {
      const timer = setTimeout(() => {
        if (isCacheHit) {
          centerCanvas(1.0);
        } else {
          focusNode(targetNodeId, 1.25);
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [activeStep, edgesToRender, selectedHop, hops, focusNode, isCacheHit, centerCanvas]);

  // Keep focus node centered during window resizes
  useEffect(() => {
    const handleResize = () => {
      const activeEdge = edgesToRender.find(e => e.step === activeStep);
      const targetId = selectedHop || activeEdge?.to || (hops && hops[0]?.id);
      if (isCacheHit) {
        centerCanvas(1.0);
      } else if (targetId) {
        focusNode(targetId, scale);
      } else {
        centerCanvas(scale);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [selectedHop, activeStep, edgesToRender, scale, hops, focusNode, centerCanvas, isCacheHit]);

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

  // Helper for computing orthogonal arrow coordinates and corners
  // Helper for computing parallel path coordinates when type is ALL
  const getParallelPathD = (fromNode, toNode, edgeType, dy) => {
    const localNode = fromNode.type === 'LOCAL' ? fromNode : toNode;
    const nsNode = fromNode.type === 'LOCAL' ? toNode : fromNode;
    const isQuery = edgeType === 'query';
    const x1_q = localNode.treeX + 60;
    const y1_q = localNode.treeY + NH;
    const x2_q = nsNode.treeX;
    const y2_q = nsNode.treeY + 20;

    const x1_r = nsNode.treeX;
    const y1_r = nsNode.treeY + 44;
    const x2_r = localNode.treeX + 160;
    const y2_r = localNode.treeY + NH;

    if (isQuery) {
      return `M ${x1_q} ${y1_q} L ${x1_q} ${y2_q + dy} L ${x2_q} ${y2_q + dy}`;
    } else {
      return `M ${x1_r} ${y1_r + dy} L ${x2_r} ${y1_r + dy} L ${x2_r} ${y2_r}`;
    }
  };

  const getEdgeCoords = (fromNode, toNode, edgeType) => {
    let x1, y1, x2, y2;

    const isClientHop = (fromNode.type === 'CLIENT' && toNode.type === 'LOCAL') || 
                        (fromNode.type === 'LOCAL' && toNode.type === 'CLIENT');
    
    const isCnameHop = fromNode.type === 'CNAME_REDIRECT' || toNode.type === 'CNAME_REDIRECT';

    if (isClientHop) {
      if (fromNode.type === 'CLIENT') {
        // Query (Stub -> Recursive)
        x1 = fromNode.treeX + NW;
        y1 = fromNode.treeY + 20;
        x2 = toNode.treeX;
        y2 = toNode.treeY + 20;
      } else {
        // Response (Recursive -> Stub)
        x1 = fromNode.treeX;
        y1 = fromNode.treeY + 44;
        x2 = toNode.treeX + NW;
        y2 = toNode.treeY + 44;
      }
      return { x1, y1, x2, y2, pathD: `M ${x1} ${y1} L ${x2} ${y2}`, midX: (x1 + x2) / 2, midY: (y1 + y2) / 2 };
    }

    if (isCnameHop) {
      if (fromNode.treeX + NW <= toNode.treeX) {
        x1 = fromNode.treeX + NW;
        y1 = fromNode.treeY + NH / 2;
        x2 = toNode.treeX;
        y2 = toNode.treeY + NH / 2;
      } else {
        x1 = fromNode.treeX;
        y1 = fromNode.treeY + NH / 2;
        x2 = toNode.treeX + NW;
        y2 = toNode.treeY + NH / 2;
      }
      return { x1, y1, x2, y2, pathD: `M ${x1} ${y1} L ${x2} ${y2}`, midX: (x1 + x2) / 2, midY: (y1 + y2) / 2 };
    }

    // Nameserver Hops (Recursive <-> Nameserver)
    const localNode = fromNode.type === 'LOCAL' ? fromNode : toNode;
    const nsNode = fromNode.type === 'LOCAL' ? toNode : fromNode;
    const isQuery = edgeType === 'query';

    const nsY = nsNode.treeY;
    
    let pathD;
    let midX, midY;

    if (nsY < 200) {
      // Top-edge routing (above Recursive)
      if (isQuery) {
        x1 = localNode.treeX + 60;
        y1 = localNode.treeY;
        x2 = nsNode.treeX;
        y2 = nsNode.treeY + 20;
        pathD = `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
        midX = (x1 + x2) / 2;
        midY = y2;
      } else {
        x1 = nsNode.treeX;
        y1 = nsNode.treeY + 44;
        x2 = localNode.treeX + 160;
        y2 = localNode.treeY;
        pathD = `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
        midX = (x1 + x2) / 2;
        midY = y1;
      }
    } else if (nsY > 230) {
      // Bottom-edge routing (below Recursive)
      if (isQuery) {
        x1 = localNode.treeX + 60;
        y1 = localNode.treeY + NH;
        x2 = nsNode.treeX;
        y2 = nsNode.treeY + 20;
        pathD = `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
        midX = (x1 + x2) / 2;
        midY = y2;
      } else {
        x1 = nsNode.treeX;
        y1 = nsNode.treeY + 44;
        x2 = localNode.treeX + 160;
        y2 = localNode.treeY + NH;
        pathD = `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
        midX = (x1 + x2) / 2;
        midY = y1;
      }
    } else {
      // Right-edge routing (horizontally aligned)
      if (isQuery) {
        x1 = localNode.treeX + NW;
        y1 = localNode.treeY + 20;
        x2 = nsNode.treeX;
        y2 = nsNode.treeY + 20;
      } else {
        x1 = nsNode.treeX;
        y1 = nsNode.treeY + 44;
        x2 = localNode.treeX + NW;
        y2 = localNode.treeY + 44;
      }
      pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
      midX = (x1 + x2) / 2;
      midY = (y1 + y2) / 2;
    }

    return { x1, y1, x2, y2, pathD, midX, midY };
  };

  // Helper for clean text label positioning
  const getLabelCoords = (fromNode, toNode, edgeType) => {
    const isClientHop = (fromNode.type === 'CLIENT' && toNode.type === 'LOCAL') || 
                        (fromNode.type === 'LOCAL' && toNode.type === 'CLIENT');
    
    if (isClientHop) {
      if (fromNode.type === 'CLIENT') {
        const midX = (fromNode.treeX + NW + toNode.treeX) / 2;
        return {
          x: midX,
          y: fromNode.treeY + 20 - 6,
          textAnchor: 'middle'
        };
      } else {
        const midX = (fromNode.treeX + toNode.treeX + NW) / 2;
        return {
          x: midX,
          y: fromNode.treeY + 44 + 11,
          textAnchor: 'middle'
        };
      }
    }

    const isCnameHop = fromNode.type === 'CNAME_REDIRECT' || toNode.type === 'CNAME_REDIRECT';
    if (isCnameHop) {
      return {
        x: (fromNode.treeX + toNode.treeX + NW) / 2,
        y: (fromNode.treeY + toNode.treeY) / 2 - 10,
        textAnchor: 'middle'
      };
    }

    // Nameserver hops (Recursive <-> Nameserver)
    const nsNode = fromNode.type === 'LOCAL' ? toNode : fromNode;
    const isQuery = edgeType === 'query';

    // We align all text to the left side of the nameserver cards (end anchor)
    if (isQuery) {
      return {
        x: nsNode.treeX - 30,
        y: nsNode.treeY + 20 - 5,
        textAnchor: 'end'
      };
    } else {
      return {
        x: nsNode.treeX - 30,
        y: nsNode.treeY + 44 + 11,
        textAnchor: 'end'
      };
    }
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
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(13,13,13,0.06)" strokeWidth="0.5" />
            </pattern>
            <marker id="arrow-query" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#2563EB" />
            </marker>
            <marker id="arrow-referral" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--color-accent)" />
            </marker>
            <marker id="arrow-answer" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#22C55E" />
            </marker>
            <marker id="arrow-inactive" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="rgba(13,13,13,0.15)" />
            </marker>
          </defs>
          <rect width={W} height={H} fill="url(#treeGrid)" />

          {/* Edges */}
          {edgesToRender.map((edge, i) => {
            const fromNode = nodes.find((n) => n.id === edge.from);
            const toNode = nodes.find((n) => n.id === edge.to);
            if (!fromNode || !toNode) return null;

            const isActive = edge.step <= activeStep;
            if (!isActive) return null; // Reveal query arrows and details only when they are animated/active

            const isAnimating = edge.step === activeStep && playbackState === 'PLAYING';

            const { pathD, midX, midY } = getEdgeCoords(fromNode, toNode, edge.type);

            let strokeColor = 'rgba(13,13,13,0.1)';
            let isDashed = true;

            if (isActive) {
              if (edge.type === 'query') {
                strokeColor = '#2563EB';
                isDashed = false;
              } else if (edge.type === 'referral') {
                strokeColor = 'var(--color-accent)';
                isDashed = true;
              } else if (edge.type === 'answer') {
                strokeColor = '#22C55E';
                isDashed = false;
              }
            }

            const markerEnd = isActive
              ? (edge.type === 'query' ? 'url(#arrow-query)' : edge.type === 'referral' ? 'url(#arrow-referral)' : 'url(#arrow-answer)')
              : 'url(#arrow-inactive)';

            const isHovered = activeTooltip?.edge === edge;
            const labelPos = getLabelCoords(fromNode, toNode, edge.type);

            // Compute badge and text positions relative to nameserver card (nsNode) if present
            const isClientHop = (fromNode.type === 'CLIENT' && toNode.type === 'LOCAL') || (fromNode.type === 'LOCAL' && toNode.type === 'CLIENT');
            const nsNode = (toNode.type === 'ROOT' || toNode.type === 'TLD' || toNode.type === 'AUTH')
              ? toNode
              : ((fromNode.type === 'ROOT' || fromNode.type === 'TLD' || fromNode.type === 'AUTH') ? fromNode : null);

            let badgeX = labelPos.x - 35;
            let textX = labelPos.x - 20;
            let textAnchor = 'start';

            if (isClientHop) {
              badgeX = labelPos.x - 45;
              textX = labelPos.x - 30;
              textAnchor = 'start';
            } else if (nsNode) {
              badgeX = nsNode.treeX - 25;
              textX = nsNode.treeX - 32;
              textAnchor = 'end';
            }

            const lines = formatLabelLines(edge.label);
            const textY = labelPos.y;
            const adjustedTextY = edge.type === 'query' ? textY - (lines.length - 1) * 11 : textY;
            const badgeY = adjustedTextY - 10;

            const isParallel = recordType === 'ALL' && (fromNode.type === 'AUTH' || toNode.type === 'AUTH');

            if (isParallel) {
              const dyValues = [-6, -3, 0, 3, 6];
              return (
                <g key={i}>
                  {dyValues.map((dy, idx) => {
                    const pD = getParallelPathD(fromNode, toNode, edge.type, dy);
                    const isMiddle = idx === 2;
                    const pathMarker = isMiddle ? markerEnd : 'none';

                    return (
                      <g key={idx}>
                        {isActive && isHovered && (
                          <path
                            d={pD}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth={3}
                            className="opacity-20"
                          />
                        )}
                        <path
                          d={pD}
                          fill="none"
                          stroke={strokeColor}
                          strokeWidth={isActive ? 1.0 : 0.8}
                          strokeDasharray={isDashed ? '4 3' : 'none'}
                          markerEnd={pathMarker}
                          className={`${isActive ? 'arrow-path' : ''}`}
                          style={{ transition: 'stroke-width 0.2s, stroke 0.4s' }}
                        />
                        {isAnimating && (
                          <circle r="2" fill={strokeColor}>
                            <animateMotion dur={`${0.65 + idx * 0.15}s`} repeatCount="indefinite" path={pD} />
                            <animate attributeName="r" values="1.5;3;1.5" dur="0.8s" repeatCount="indefinite" />
                          </circle>
                        )}
                      </g>
                    );
                  })}

                  {/* Step badge and label text (drawn once) */}
                  <g className="select-none pointer-events-none">
                    <rect
                      width="13"
                      height="13"
                      x={badgeX}
                      y={badgeY}
                      fill={isActive ? (edge.type === 'query' ? '#2563EB' : edge.type === 'referral' ? '#FF4D00' : '#22C55E') : 'rgba(13,13,13,0.15)'}
                      stroke="var(--color-ink)"
                      strokeWidth="0.5"
                    />
                    <text
                      x={badgeX + 6.5}
                      y={badgeY + 9.5}
                      textAnchor="middle"
                      fill="var(--color-base)"
                      fontSize="8.5px"
                      fontWeight="bold"
                      fontFamily="Space Grotesk"
                    >
                      {edge.step}
                    </text>
                    <text
                      x={textX}
                      y={adjustedTextY}
                      textAnchor={textAnchor}
                      fill={isActive ? (edge.type === 'query' ? '#2563EB' : edge.type === 'referral' ? '#FF4D00' : '#22C55E') : 'rgba(13,13,13,0.3)'}
                      fontSize="9px"
                      fontFamily="JetBrains Mono"
                      style={{
                        textShadow: '1px 1px 0 var(--color-base), -1px 1px 0 var(--color-base), 1px -1px 0 var(--color-base), -1px -1px 0 var(--color-base)'
                      }}
                    >
                      {lines.map((line, idx) => (
                        <tspan
                          key={idx}
                          x={textX}
                          dy={idx === 0 ? 0 : 11}
                          fontWeight={idx === 0 ? 'bold' : 'normal'}
                          fill={idx === 0 ? undefined : 'var(--color-ink)'}
                          opacity={idx === 2 ? 0.65 : 1}
                        >
                          {line}
                        </tspan>
                      ))}
                    </text>
                  </g>

                  {/* Interactive hover overlay path (middle path is enough for trigger) */}
                  {isActive && (
                    <path
                      d={pathD}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={12}
                      className="cursor-pointer interactive"
                      onMouseEnter={() => {
                        setActiveTooltip({
                          edge,
                          toNode,
                          x: midX,
                          y: midY - 80,
                        });
                      }}
                      onMouseLeave={() => {
                        setActiveTooltip(null);
                      }}
                    />
                  )}
                </g>
              );
            }

            return (
              <g key={i}>
                {isActive && isHovered && (
                  <path
                    d={pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={5}
                    className="opacity-20"
                    style={{ transition: 'stroke-width 0.2s' }}
                  />
                )}

                <path
                  d={pathD}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={isActive ? (isHovered ? 2.2 : 1.4) : 1}
                  strokeDasharray={isDashed ? '4 3' : 'none'}
                  markerEnd={markerEnd}
                  className={`${isActive ? 'arrow-path' : ''} ${isActive && isHovered ? 'arrow-path-hovered' : ''}`}
                  style={{ transition: 'stroke-width 0.2s, stroke 0.4s' }}
                />

                {/* Step badge and label text */}
                <g className="select-none pointer-events-none">
                  <rect
                    width="13"
                    height="13"
                    x={badgeX}
                    y={badgeY}
                    fill={isActive ? (edge.type === 'query' ? '#2563EB' : edge.type === 'referral' ? '#FF4D00' : '#22C55E') : 'rgba(13,13,13,0.15)'}
                    stroke="var(--color-ink)"
                    strokeWidth="0.5"
                  />
                  <text
                    x={badgeX + 6.5}
                    y={badgeY + 9.5}
                    textAnchor="middle"
                    fill="var(--color-base)"
                    fontSize="8.5px"
                    fontWeight="bold"
                    fontFamily="Space Grotesk"
                  >
                    {edge.step}
                  </text>
                  <text
                    x={textX}
                    y={adjustedTextY}
                    textAnchor={textAnchor}
                    fill={isActive ? (edge.type === 'query' ? '#2563EB' : edge.type === 'referral' ? '#FF4D00' : '#22C55E') : 'rgba(13,13,13,0.3)'}
                    fontSize="9px"
                    fontFamily="JetBrains Mono"
                    style={{
                      textShadow: '1px 1px 0 var(--color-base), -1px 1px 0 var(--color-base), 1px -1px 0 var(--color-base), -1px -1px 0 var(--color-base)'
                    }}
                  >
                    {lines.map((line, idx) => (
                      <tspan
                        key={idx}
                        x={textX}
                        dy={idx === 0 ? 0 : 11}
                        fontWeight={idx === 0 ? 'bold' : 'normal'}
                        fill={idx === 0 ? undefined : 'var(--color-ink)'}
                        opacity={idx === 2 ? 0.65 : 1}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>

                {isActive && (
                  <path
                    d={pathD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12}
                    className="cursor-pointer interactive"
                    onMouseEnter={() => {
                      setActiveTooltip({
                        edge,
                        toNode,
                        x: midX,
                        y: midY - 80,
                      });
                    }}
                    onMouseLeave={() => {
                      setActiveTooltip(null);
                    }}
                  />
                )}

                {isAnimating && (
                  <circle r="3" fill={strokeColor}>
                    <animateMotion dur="1s" repeatCount="indefinite" path={pathD} />
                    <animate attributeName="r" values="2.5;4;2.5" dur="0.8s" repeatCount="indefinite" />
                  </circle>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const isPlaceholder = node.isPlaceholder;
            const isReached = node.type === 'CLIENT' || edgesToRender.some(edge => edge.step <= activeStep && (edge.to === node.id || edge.from === node.id));
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
                    fill={isFailedTrace && node.id === (hops[hops.length - 1]?.id) ? '#EF4444' : isSel ? 'var(--color-accent)' : 'var(--color-ink)'}
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
                      className={`w-full h-full border flex flex-col justify-start select-none transition-all duration-200 ${
                        node.type === 'AUTH' ? 'gap-0.5 p-1.5' : 'gap-1.5 p-2'
                      } ${
                        isFailedTrace && node.id === (hops[hops.length - 1]?.id)
                          ? 'bg-red-50 text-red-600 border-[#EF4444] border-2 shadow-[2px_2px_0_0_#EF4444]'
                          : isSel
                          ? isCname
                            ? 'bg-accent text-base border-accent'
                            : 'bg-ink text-base border-ink'
                          : node.type === 'LOCAL' && isReached
                          ? 'bg-ink text-base border-ink shadow-[2.5px_2.5px_0_0_rgba(13,13,13,0.35)]'
                          : isReached
                          ? 'bg-base/80 backdrop-blur-[2.5px] text-ink border-ink'
                          : 'bg-base/40 backdrop-blur-[1px] text-ink/30 border-ink/12'
                      }`}
                      style={{
                        borderRadius: '0px',
                      }}
                    >
                      {/* Top line: flag + label + optional AA badge */}
                      <div className="flex items-center gap-1.5 w-full min-w-0">
                        <span className="text-[10px] shrink-0 leading-none select-none flex items-center justify-center">
                          {isFailedTrace && node.id === (hops[hops.length - 1]?.id) ? '⚠️' : isReached ? (
                            node.type === 'LOCAL' ? (
                              <ResolverIcon ip={node.ip} className="w-4 h-3.5" />
                            ) : (
                              <CountryFlag countryCode={node.geo?.countryCode} fallbackFlag={node.geo?.flag} className="w-4 h-3" />
                            )
                          ) : '🌐'}
                        </span>
                        <span className={`font-display text-[10px] font-black uppercase break-words leading-tight ${isFailedTrace && node.id === (hops[hops.length - 1]?.id) ? 'text-red-700 font-black' : isSel ? 'text-base' : isReached ? (node.type === 'LOCAL' ? 'text-white' : 'text-ink') : 'text-ink/30'}`}>
                          {node.label}
                        </span>
                        {/* Badges container */}
                        <div className="ml-auto flex items-center gap-0.5 shrink-0">
                          {isFailedTrace && node.id === (hops[hops.length - 1]?.id) && (
                            <span className="text-[7.5px] font-mono font-bold px-0.5 border border-[#EF4444] bg-[#EF4444] text-white leading-none select-none">
                              {playbackState}
                            </span>
                          )}
                          {!isCname && isReached && node.response?.flags?.includes('AA') && (
                            <span className={`text-[7.5px] font-mono font-bold px-0.5 border leading-none select-none ${isSel ? 'bg-base text-accent border-base' : 'bg-accent text-base border-accent'}`}>
                              AA
                            </span>
                          )}
                          {isReached && node.resolvedOverTcp && (
                            <span className={`text-[7.5px] font-mono font-bold px-0.5 border border-dashed leading-none select-none ${isSel ? 'border-white/50 text-white' : 'border-orange-500 text-orange-600 bg-orange-500/5'}`}>
                              TCP
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Second line (nameserver hostname) - only for AUTH hops */}
                      {isReached && node.type === 'AUTH' && (
                        <div className={`font-mono text-[7.5px] leading-tight break-all truncate ${isSel ? 'text-base/60' : 'text-ink/50'}`}>
                          {node.server || 'UNKNOWN'}
                        </div>
                      )}

                      {/* Middle line: IP / Latency or target CNAME */}
                      <div className={`font-mono text-[8px] leading-tight break-all ${isFailedTrace && node.id === (hops[hops.length - 1]?.id) ? 'text-red-500 font-bold' : isSel ? 'text-base/60' : node.type === 'LOCAL' && isReached ? 'text-white/60' : 'text-ink/40'}`}>
                        {isFailedTrace && node.id === (hops[hops.length - 1]?.id)
                          ? `RESOLVE FAIL: ${playbackState}`
                          : isCname
                          ? (isReached ? `→ ${node.cnameTo}` : '?.?.?.?')
                          : (isReached ? node.ip : '?.?.?.?')
                        }
                        {!(isFailedTrace && node.id === (hops[hops.length - 1]?.id)) && isReached && node.latencyMs > 0 ? ` · ${node.latencyMs}ms` : ''}
                      </div>

                      {/* Bottom line: Org */}
                      <div className={`font-mono text-[7.5px] leading-tight break-words ${isFailedTrace && node.id === (hops[hops.length - 1]?.id) ? 'text-red-400 font-medium' : isSel ? 'text-base/40' : node.type === 'LOCAL' && isReached ? 'text-white/40' : 'text-ink/35'}`}>
                        {isFailedTrace && node.id === (hops[hops.length - 1]?.id)
                          ? `Failed at this resolver`
                          : isCname
                          ? (isReached ? `Alias of ${node.cnameFrom}` : 'Awaiting Redirection...')
                          : (isReached
                              ? (node.geo?.org ? cleanOrg(node.geo.org) : '')
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
              y={activeTooltip.y}
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

export default memo(CompactTree);
