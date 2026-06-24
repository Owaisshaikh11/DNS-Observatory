import { useState, useEffect, useRef } from 'react';
import { motion, useSpring } from 'framer-motion';
import { useNavigate } from 'react-router';
import InteractiveGrid from '../components/InteractiveGrid';

// ── Error Telemetry Stream ─────────────────────────────────────────────────
// Background log lines cycling DNS error messages. Speeds up in panic mode.

function ErrorTelemetry({ isPanic }) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    const errors = [
      'ERR_NAME_NOT_RESOLVED', 'NXDOMAIN_DETECTED', 'TRACEROUTE_FAILED',
      'UPSTREAM_TIMEOUT', 'AUTHORITATIVE_REFUSAL', 'PACKET_DROPPED_IN_VOID',
      'NO_A_RECORD_FOUND', 'ROOT_SERVER_UNREACHABLE', 'CACHE_MISS_FATAL',
      'DNSSEC_VALIDATION_FAILED', 'BOGUS_PACKET_RECEIVED', 'SOCKET_CLOSED',
    ];

    const generateLog = () => {
      const time = new Date().toISOString().substring(11, 23);
      const hex = Math.random().toString(16).substring(2, 8).toUpperCase();
      const err = errors[Math.floor(Math.random() * errors.length)];
      return `[${time}] [0x${hex}] ${err}`;
    };

    // Panic: extreme spawn rate (30ms, 4 logs/tick). Idle: calm (400ms, 1 log/tick)
    const interval = setInterval(() => {
      setLogs(prev => {
        const newLogs = isPanic
          ? [generateLog(), generateLog(), generateLog(), generateLog()]
          : [generateLog()];
        return [...prev.slice(-(isPanic ? 60 : 30)), ...newLogs];
      });
    }, isPanic ? 30 : 400);

    return () => clearInterval(interval);
  }, [isPanic]);

  return (
    <div
      className={`absolute inset-0 pointer-events-none overflow-hidden z-0 flex flex-col justify-end p-8 font-mono text-[10px] leading-tight transition-colors duration-150 ${isPanic ? 'opacity-60 text-accent font-bold drop-shadow-md' : 'opacity-25'
        }`}
    >
      {/* Fade mask at top */}
      <div className="absolute top-0 left-0 w-full h-32 bg-linear-to-b from-base to-transparent z-10" />
      {logs.map((log, i) => (
        <div key={i} className="whitespace-nowrap">{log}</div>
      ))}
    </div>
  );
}

// ── Structural 404 Digits with Parallax & Glitch ───────────────────────────
// Three stacked digit layers (4, 0, 4) with spring-driven mouse parallax,
// outline trails, and panic mode clip-path glitch effects.

const textBase =
  'absolute w-full h-full font-display font-black leading-[0.8] select-none text-[35vw] md:text-[24vw] flex items-center justify-center';

const RenderDigit = ({ digit, xSlow, ySlow, xMed, yMed, xFast, yFast, zIndex, extraClasses, isPanic }) => (
  <div className={`relative w-[25vw] h-[25vw] md:w-[16vw] md:h-[16vw] ${zIndex} ${extraClasses}`}>
    {/* Trailing outline layers */}
    <motion.div style={{ x: xSlow, y: ySlow }} className={`${textBase} text-outline-ink opacity-20`}>{digit}</motion.div>
    <motion.div style={{ x: xMed, y: yMed }} className={`${textBase} text-outline-accent opacity-40`}>{digit}</motion.div>

    {/* Primary interactive layer */}
    <motion.div style={{ x: xFast, y: yFast }} className="absolute w-full h-full">
      {/* Standard idle view */}
      <div className={`absolute w-full h-full flex items-center justify-center transition-opacity duration-100 ${isPanic ? 'opacity-0' : 'opacity-100'}`}>
        <div className={`${textBase} text-solid-ink hover-hard-shadow cursor-crosshair`}>{digit}</div>
      </div>

      {/* Panic glitch view (visible only during panic) */}
      <div className={`absolute w-full h-full flex items-center justify-center pointer-events-none transition-opacity duration-100 ${isPanic ? 'opacity-100' : 'opacity-0'}`}>
        <div className={`${textBase} panic-layer-1`}>{digit}</div>
        <div className={`${textBase} panic-layer-2`}>{digit}</div>
        <div className={`${textBase} panic-text-shadow`}>{digit}</div>
      </div>
    </motion.div>
  </div>
);

function Structural404({ mousePos, isPanic }) {
  // Spring configs — heavier = more mechanical lag
  const spFast = { damping: 30, stiffness: 200 };
  const spMed = { damping: 40, stiffness: 120 };
  const spSlow = { damping: 50, stiffness: 80 };

  // Digit 1: '4'
  const n1xFast = useSpring(mousePos.x * -30, spFast);
  const n1yFast = useSpring(mousePos.y * -30, spFast);
  const n1xMed = useSpring(mousePos.x * -50, spMed);
  const n1yMed = useSpring(mousePos.y * -50, spMed);
  const n1xSlow = useSpring(mousePos.x * -70, spSlow);
  const n1ySlow = useSpring(mousePos.y * -70, spSlow);

  // Digit 2: '0'
  const n2xFast = useSpring(mousePos.x * 15, spFast);
  const n2yFast = useSpring(mousePos.y * 15, spFast);
  const n2xMed = useSpring(mousePos.x * 30, spMed);
  const n2yMed = useSpring(mousePos.y * 30, spMed);
  const n2xSlow = useSpring(mousePos.x * 45, spSlow);
  const n2ySlow = useSpring(mousePos.y * 45, spSlow);

  // Digit 3: '4'
  const n3xFast = useSpring(mousePos.x * 45, spFast);
  const n3yFast = useSpring(mousePos.y * 45, spFast);
  const n3xMed = useSpring(mousePos.x * 65, spMed);
  const n3yMed = useSpring(mousePos.y * 65, spMed);
  const n3xSlow = useSpring(mousePos.x * 85, spSlow);
  const n3ySlow = useSpring(mousePos.y * 85, spSlow);

  return (
    <div className="relative w-full flex-1 flex items-center justify-center z-10 -mt-12 md:-mt-20">
      {/* Background pillars (falling staircase) */}
      <div className="absolute inset-0 flex justify-center items-end opacity-20 pointer-events-none px-4 gap-[4vw] md:gap-[3vw]">
        <div className="w-[20vw] md:w-[12vw] h-[75%] border-x border-t border-ink bg-ink/5" />
        <div className="w-[20vw] md:w-[12vw] h-[55%] border-x border-t border-ink bg-ink/5" />
        <div className="w-[20vw] md:w-[12vw] h-[35%] border-x border-t border-ink bg-ink/5" />
      </div>

      {/* Staggered 404 lockup */}
      <div className="relative flex flex-col md:flex-row items-center justify-center w-full max-w-5xl h-full">
        <RenderDigit
          digit="4"
          xSlow={n1xSlow} ySlow={n1ySlow}
          xMed={n1xMed} yMed={n1yMed}
          xFast={n1xFast} yFast={n1yFast}
          zIndex="z-10" extraClasses="md:mr-[-4vw] md:-mt-[8vw]"
          isPanic={isPanic}
        />
        <RenderDigit
          digit="0"
          xSlow={n2xSlow} ySlow={n2ySlow}
          xMed={n2xMed} yMed={n2yMed}
          xFast={n2xFast} yFast={n2yFast}
          zIndex="z-20" extraClasses="md:mt-[4vw]"
          isPanic={isPanic}
        />
        <RenderDigit
          digit="4"
          xSlow={n3xSlow} ySlow={n3ySlow}
          xMed={n3xMed} yMed={n3yMed}
          xFast={n3xFast} yFast={n3yFast}
          zIndex="z-30" extraClasses="md:ml-[-4vw] md:mt-[16vw]"
          isPanic={isPanic}
        />
      </div>
    </div>
  );
}

// ── NotFoundPage ───────────────────────────────────────────────────────────
// Full-viewport 404 with mouse-reactive parallax digits, velocity-triggered
// panic mode, streaming error telemetry, and a brutalist action bar.

export default function NotFoundPage() {
  const navigate = useNavigate();

  // Global panic & mouse position state
  const [isPanic, setIsPanic] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const lastMouse = useRef(null);
  const panicTimer = useRef(null);

  useEffect(() => {
    // Update page title
    document.title = '404 NXDOMAIN | DNS Observatory';

    lastMouse.current = { x: 0, y: 0, time: Date.now() };

    const handleMouseMove = (e) => {
      const now = Date.now();
      const dt = now - lastMouse.current.time;
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;

      // Velocity: trigger panic at >4.5px/ms (aggressive flick)
      if (dt > 0) {
        const velocity = Math.sqrt(dx * dx + dy * dy) / dt;
        if (velocity > 4.5) {
          setIsPanic(true);
          if (panicTimer.current) clearTimeout(panicTimer.current);
          panicTimer.current = setTimeout(() => setIsPanic(false), 200);
        }
      }

      lastMouse.current = { x: e.clientX, y: e.clientY, time: now };

      setMousePos({
        x: (e.clientX / window.innerWidth - 0.5) * 2,
        y: (e.clientY / window.innerHeight - 0.5) * 2,
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div
      className={`w-full h-screen flex flex-col relative overflow-hidden selection:bg-accent selection:text-base transition-colors duration-300 z-10 ${isPanic ? 'bg-accent/5' : 'bg-base'
        }`}
    >
      <InteractiveGrid />
      <ErrorTelemetry isPanic={isPanic} />

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="w-full p-6 md:px-12 flex justify-between items-start md:items-center z-20 border-b border-ink/10 bg-base/80 backdrop-blur-md shrink-0">
        <div className="flex flex-col">
          <h1 className="font-display font-black text-xl md:text-2xl uppercase tracking-tighter leading-none">
            DNS Observatory
          </h1>
          <span className="font-mono text-[9px] text-accent mt-1 tracking-widest">
            Resolution Lab
          </span>
        </div>

      </header>

      {/* ── Falling 404 Hero ────────────────────────────────────────── */}
      <Structural404 mousePos={mousePos} isPanic={isPanic} />

      {/* ── Bottom Action Bar ───────────────────────────────────────── */}
      <motion.div
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.5 }}
        className={`w-full border-t border-ink bg-base flex flex-col z-20 shrink-0 transition-all duration-300 ${isPanic
          ? 'border-t-4 border-t-accent shadow-[0_-4px_0_0_rgba(255,77,0,1)]'
          : 'shadow-[0_-20px_60px_rgba(13,13,13,0.15)]'
          }`}
      >
        {/* Status strip */}
        <div className="w-full px-6 md:px-12 py-3 border-b border-ink/10 bg-ink/5 font-mono text-[10px] uppercase flex justify-between items-center opacity-60">
          <span>Fatal Exception Encountered</span>
          <span>Traceroute Halted</span>
        </div>

        {/* Main action area */}
        <div className="w-full px-6 md:px-12 py-8 md:py-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-8">
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase opacity-50 mb-2 tracking-widest">
              Error Code: 404
            </span>
            <div className="font-display font-black text-5xl md:text-7xl lg:text-8xl tracking-tighter uppercase leading-none hover-glitch w-max cursor-crosshair text-ink">
              NXDOMAIN<span className="text-accent">!</span>
            </div>
            <p className="font-mono text-xs opacity-70 mt-4 max-w-md leading-relaxed border-l-2 border-accent pl-4">
              The requested target domain does not exist within the global namespace. The routing sequence has collapsed into the void.
            </p>
          </div>

          <button
            onClick={() => navigate('/')}
            className="group border border-ink px-8 py-5 bg-ink text-base font-mono text-xs uppercase tracking-widest flex items-center gap-4 transition-all duration-200 hover:-translate-y-[4px] hover:shadow-[8px_8px_0_0_rgba(255,77,0,1)] hover:border-accent hover:text-accent w-full md:w-auto justify-center cursor-pointer"
          >
            {/* Brutalist return arrow */}
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="square"
              className="group-hover:-translate-x-1 transition-transform"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Re-Initialize Connection
          </button>
        </div>
      </motion.div>
    </div>
  );
}
