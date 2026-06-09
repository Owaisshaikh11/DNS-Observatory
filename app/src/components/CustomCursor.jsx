import { useState, useEffect, useRef } from 'react';

export default function CustomCursor() {
  const coreRef = useRef(null);
  const frameRef = useRef(null);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    let mx = -100, my = -100, fx = -100, fy = -100, raf;
    const onMove = (e) => {
      mx = e.clientX; 
      my = e.clientY;
      if (coreRef.current) coreRef.current.style.transform = `translate3d(${mx - 2}px, ${my - 2}px, 0)`;
      setHovering(!!e.target.closest('button, a, .interactive'));
    };
    const render = () => {
      fx += (mx - fx) * 0.25; 
      fy += (my - fy) * 0.25;
      if (frameRef.current) { 
        frameRef.current.style.left = fx + 'px'; 
        frameRef.current.style.top = fy + 'px'; 
      }
      raf = requestAnimationFrame(render);
    };
    window.addEventListener('mousemove', onMove);
    raf = requestAnimationFrame(render);
    return () => { 
      window.removeEventListener('mousemove', onMove); 
      cancelAnimationFrame(raf); 
    };
  }, []);

  return (
    <>
      <div ref={coreRef} style={{ display: hovering ? 'none' : 'block' }} className="cursor-core" />
      <div ref={frameRef} className={`cursor-frame ${hovering ? 'hovering' : ''}`} />
    </>
  );
}
