import { useEffect, useRef } from 'react';

export default function InteractiveGrid() {
  const gridRef = useRef(null);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (gridRef.current) {
        gridRef.current.style.setProperty('--mouse-x', `${e.clientX}px`);
        gridRef.current.style.setProperty('--mouse-y', `${e.clientY}px`);
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-10">
      <div className="absolute inset-0 brutalist-grid"></div>
      <div
        ref={gridRef}
        className="absolute inset-0 brutalist-grid-accent transition-opacity duration-300"
        style={{
          '--mouse-x': '-1000px',
          '--mouse-y': '-1000px',
          WebkitMaskImage: 'radial-gradient(circle 250px at var(--mouse-x) var(--mouse-y), black 0%, transparent 100%)',
          maskImage: 'radial-gradient(circle 250px at var(--mouse-x) var(--mouse-y), black 0%, transparent 100%)'
        }}
      ></div>
    </div>
  );
}
