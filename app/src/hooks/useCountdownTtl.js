import { useState, useEffect } from 'react';
import { useTraceStore } from '../stores/useTraceStore';

/**
 * Custom React hook to calculate real-time elapsed seconds since trace completion
 * to drive TTL countdown visuals in leaf render components.
 */
export default function useCountdownTtl() {
  const completedAt = useTraceStore((state) => state.completedAt);
  const [secondsElapsed, setSecondsElapsed] = useState(() => {
    return completedAt ? Math.floor((Date.now() - completedAt) / 1000) : 0;
  });

  useEffect(() => {
    let active = true;

    const timer = setTimeout(() => {
      if (active) {
        setSecondsElapsed(completedAt ? Math.floor((Date.now() - completedAt) / 1000) : 0);
      }
    }, 0);

    const interval = setInterval(() => {
      if (active) {
        setSecondsElapsed(completedAt ? Math.floor((Date.now() - completedAt) / 1000) : 0);
      }
    }, 1000);

    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [completedAt]);

  return secondsElapsed;
}
