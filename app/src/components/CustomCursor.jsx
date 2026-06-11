import { useEffect, useRef, useState } from 'react';

export default function CustomCursor() {
  const coreRef = useRef(null);
  const frameRef = useRef(null);
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    let mouseX = -100;
    let mouseY = -100;
    let frameX = -100;
    let frameY = -100;
    let animationFrame;

    const onMouseMove = (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      
      if (coreRef.current) {
        coreRef.current.style.transform = `translate3d(${mouseX - 2}px, ${mouseY - 2}px, 0)`;
      }

      const target = e.target;
      const isInteractive = target.closest('button') || 
                            target.closest('a') || 
                            target.closest('input') || 
                            target.closest('select') ||
                            target.closest('textarea') ||
                            target.closest('label') || 
                            target.closest('[role="button"]') ||
                            target.closest('.interactive') ||
                            target.closest('.cursor-pointer') ||
                            target.closest('.interactive-hover');
      setIsHovering(!!isInteractive);
    };

    const render = () => {
      frameX += (mouseX - frameX) * 0.3;
      frameY += (mouseY - frameY) * 0.3;
      
      if (frameRef.current) {
        frameRef.current.style.left = `${frameX}px`;
        frameRef.current.style.top = `${frameY}px`;
      }
      animationFrame = requestAnimationFrame(render);
    };

    window.addEventListener('mousemove', onMouseMove);
    animationFrame = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <>
      <div ref={coreRef} className={`cursor-core ${isHovering ? 'hidden' : 'block'}`} style={{ transform: 'translate3d(-100px, -100px, 0)' }} />
      <div ref={frameRef} className={`cursor-frame ${isHovering ? 'hovering' : ''}`} style={{ left: '-100px', top: '-100px' }} />
    </>
  );
}

