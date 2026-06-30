import { useEffect } from 'react';
import { useTraceStore } from '../stores/useTraceStore';

/**
 * Custom hook to run the automated animation playback logic for DNS trace steps.
 */
export default function usePlaybackEngine({
  playbackState,
  activeStep,
  setActiveStep,
  isSlowMo,
  traceData,
  edgesLength
}) {
  useEffect(() => {
    if (playbackState !== 'PLAYING' || !traceData || edgesLength === 0) return;

    if (activeStep >= edgesLength) {
      const finalStatus = traceData.status || 'COMPLETE';
      useTraceStore.setState({
        playbackState: finalStatus === 'NOERROR' ? 'COMPLETE' : finalStatus,
        completedAt: Date.now()
      });
      return;
    }

    const delay = isSlowMo ? 1800 : 900;
    const timer = setTimeout(() => {
      setActiveStep(activeStep + 1);
    }, delay);

    return () => clearTimeout(timer);
  }, [playbackState, activeStep, isSlowMo, traceData, edgesLength, setActiveStep]);
}
