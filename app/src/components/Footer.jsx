import { useState, useEffect, useRef, forwardRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

// ── ASCII Velocity Engine (Concept 07: Payload) ────────────────────────────
// Renders the Payload logo shape in block characters with a randomizing
// core that accelerates when the user moves the mouse over the footer.

function AsciiFooterLogo({ isFast }) {
  const [core, setCore] = useState(['', '', '']);

  useEffect(() => {
    const charSet = '01-_/\\|[]{}%#X^&*ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    const updateCore = () => {
      const newCore = [];
      for (let r = 0; r < 3; r++) {
        let str = '';
        for (let c = 0; c < 6; c++) {
          str += charSet[Math.floor(Math.random() * charSet.length)];
        }
        newCore.push(str);
      }
      setCore(newCore);
    };

    // 30ms when mouse moves (hyper-fast), 200ms when idle (calm pulse)
    const speed = isFast ? 30 : 200;
    const interval = setInterval(updateCore, speed);
    return () => clearInterval(interval);
  }, [isFast]);

  // Perfectly proportioned square ASCII logo (16x8 grid, 1:2 font aspect ratio):
  // Top bracket: 16 characters wide (forms a perfect square with 8 lines height)
  // Core: 6 characters wide by 3 lines high (forms a perfect square core in center)
  // Bottom bracket: 8 characters wide (exactly half of top bracket)
  return (
    <div className="font-mono text-[10px] md:text-[13px] leading-none select-none text-base opacity-90 text-right whitespace-pre">
      <div>{'████████████████'}</div>
      <div>{'               █'}</div>
      <div>{'               █'}</div>
      <div>{'     '}<span className="text-accent font-bold bg-accent/20">{core[0]}</span>{'  █'}</div>
      <div>{'     '}<span className="text-accent font-bold bg-accent/20">{core[1]}</span>{'  █'}</div>
      <div>{'     '}<span className="text-accent font-bold bg-accent/20">{core[2]}</span>{'  █'}</div>
      <div>{'               █'}</div>
      <div>{'               █'}</div>
      <div>{'████████       '}</div>
    </div>
  );
}

// ── Footer Component ───────────────────────────────────────────────────────
// Fixed footer with kinetic typography, tabular metadata, ASCII velocity
// engine, and a scroll-to-top command button. Placed at the bottom of the
// Entry page's scroll content for a natural scroll-into-view reveal.

const Footer = forwardRef(function Footer({ scrollContainerRef }, ref) {
  const { scrollYProgress } = useScroll({
    container: scrollContainerRef,
  });

  // Kinetic Typography: text slides up and letter-spacing snaps tight on reveal
  const yTranslate = useTransform(scrollYProgress, [0.75, 1], [120, 0]);
  const tracking = useTransform(scrollYProgress, [0.8, 1], ['0.1em', '-0.04em']);
  const footerOpacity = useTransform(scrollYProgress, [0.7, 0.9], [0, 1]);

  // ASCII Velocity: track mouse movement speed over the footer
  const [isFast, setIsFast] = useState(false);
  const timeoutRef = useRef(null);

  const handleMouseMove = () => {
    setIsFast(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setIsFast(false), 200);
  };

  const scrollToTop = () => {
    if (scrollContainerRef?.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <footer
      ref={ref}
      onMouseMove={handleMouseMove}
      className="sticky bottom-0 left-0 w-full z-0 bg-ink text-base flex flex-col pt-2 md:pt-5 overflow-hidden selection:bg-accent selection:text-ink shrink-0"
    >

      {/* ── Tabular Framing (4-column blueprint grid) ──────────── */}
      <div className="w-full px-6 md:px-12 mb-12">
        <div className="grid grid-cols-1 md:grid-cols-4 w-full border-b border-base/20 divide-y md:divide-y-0 md:divide-x divide-base/20 font-mono text-[10px] uppercase">

          <div className="flex flex-col p-8 gap-2 hover:bg-base/5 transition-colors cursor-default">
            <span className="opacity-40 mb-8 tracking-widest">Engineering & Design</span>
            <span className="font-bold text-accent text-lg mt-auto">Owais Shaikh</span>
          </div>

          <div className="flex flex-col p-8 gap-2 hover:bg-base/5 transition-colors cursor-default">
            <span className="opacity-40 mb-8 tracking-widest">Copyright</span>
            <span className="text-lg mt-auto font-bold">© 2026 / Owais Shaikh</span>
          </div>

          <div className="flex flex-col p-8 gap-2 hover:bg-base/5 transition-colors group">
            <span className="opacity-40 mb-8 tracking-widest">Repository Links</span>
            <a
              href="https://github.com/owaisshaikh11"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-lg mt-auto font-bold w-max group-hover:text-accent transition-colors"
            >
              GitHub Source
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 17L17 7M17 7H7M17 7V17" />
              </svg>
            </a>
          </div>

          <div className="flex flex-col p-8 gap-2 hover:bg-base/5 transition-colors cursor-default">
            <span className="opacity-40 mb-8 tracking-widest">System Status</span>
            <div className="flex items-center gap-3 mt-auto text-lg font-bold">
              <div className="w-2 h-2 bg-green-500 animate-pulse"></div>
              <span>OPERATIONAL</span>
            </div>
          </div>

        </div>
      </div>

      {/* ── Command Input Row (Back to Top) ───────────────────────────── */}
      <div className="w-full px-6 md:px-12 flex justify-between items-end mb-4 relative z-20">
        <div className="font-mono text-[9px] uppercase opacity-40 text-left hidden md:block leading-relaxed tracking-widest">
        </div>

        <button
          onClick={scrollToTop}
          className="font-mono text-[10px] uppercase text-accent flex items-center gap-3 bg-accent/5 border border-accent/20 px-6 py-3 hover:bg-accent/10 transition-colors ml-auto md:ml-0 cursor-pointer"
        >
          <span className="opacity-60">&gt;</span>
          <span>SYSTEM.REBOOT_</span>
          <span className="w-2 h-3.5 bg-accent animate-pulse"></span>
        </button>
      </div>

      {/* ── Massive Typography Anchor & ASCII Logo ────────────────────── */}
      <div className="w-full flex flex-col md:flex-row items-end justify-between px-6 md:px-12 pb-8 gap-8 relative">

        {/* Kinetic Typography driven by scroll position */}
        <motion.div
          style={{ y: yTranslate, letterSpacing: tracking, opacity: footerOpacity }}
          className="font-display font-black uppercase leading-[0.8] w-full pointer-events-none z-10 flex flex-col"
        >
          <div className="text-[15vw] md:text-[12vw] -mb-3 md:-mb-5">DNS</div>
          <div className="text-[15vw] md:text-[12vw]">OBSERVATORY</div>
        </motion.div>

        {/* Interactive ASCII Velocity Logo */}
        <div className="shrink-0 hidden md:flex flex-col items-end pb-3 z-20 relative">
          <AsciiFooterLogo isFast={isFast} />
        </div>
      </div>
    </footer>
  );
});

export default Footer;
