import { useEffect, useRef } from 'react';

export default function InteractiveGrid() {
  const gridRef = useRef(null);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (gridRef.current) {
        const rect = gridRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        gridRef.current.style.setProperty('--mouse-x', `${x}px`);
        gridRef.current.style.setProperty('--mouse-y', `${y}px`);
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none z-[-1] interactive-grid-container">
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
