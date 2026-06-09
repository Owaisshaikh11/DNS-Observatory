import { useState } from 'react';

export default function InteractiveGrid({ children }) {
  const [mousePos, setMousePos] = useState({ x: -1000, y: -1000 });
  
  const handleMouseMove = (e) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  return (
    <div 
      className="relative min-h-screen brutalist-grid overflow-hidden"
      onMouseMove={handleMouseMove}
    >
      <div 
        className="pointer-events-none absolute inset-0 z-0 opacity-40 transition-opacity duration-300"
        style={{
          background: `radial-gradient(600px circle at ${mousePos.x}px ${mousePos.y}px, rgba(255, 77, 0, 0.1), transparent 40%)`
        }}
      />
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}
