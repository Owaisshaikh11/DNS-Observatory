/**
 * PayloadLogo — Concept 07 "The Payload" brand mark
 *
 * An asymmetrical, architectural SVG representing a raw UDP packet
 * being decoded. The ink brackets protect the vital orange core.
 *
 * Props:
 *   size     — pixel width/height (default 32)
 *   animate  — 'inspect' | 'idle' | 'none' (default 'inspect')
 *   className — additional classes forwarded to the wrapper
 */
export default function PayloadLogo({ size = 32, animate = 'inspect', className = '' }) {
  const animClass =
    animate === 'inspect'
      ? 'payload-logo-inspect'
      : animate === 'idle'
        ? 'payload-logo-idle'
        : '';

  return (
    <div
      className={`inline-flex items-center justify-center shrink-0 ${animClass} ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full text-ink"
      >
        {/* Top bracket — L-shape going right then down */}
        <path
          className="pl-bracket-top"
          d="M 16 16 H 48 V 48"
          stroke="currentColor"
          strokeWidth="4"
          fill="none"
          strokeLinejoin="miter"
          strokeLinecap="square"
        />
        {/* Bottom bracket — short horizontal going right */}
        <path
          className="pl-bracket-bottom"
          d="M 16 48 H 32"
          stroke="currentColor"
          strokeWidth="4"
          fill="none"
          strokeLinejoin="miter"
          strokeLinecap="square"
        />
        {/* Payload core — orange square */}
        <rect
          className="pl-core"
          x="24"
          y="24"
          width="16"
          height="16"
          fill="var(--accent, #FF4D00)"
        />
      </svg>
    </div>
  );
}
