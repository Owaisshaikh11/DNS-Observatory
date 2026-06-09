import { create } from 'zustand'

export const useTraceStore = create((set) => ({
  domain: '',
  recordType: 'ALL',
  isBenchmarkMode: false,
  traceData: null,
  activeStep: 0,
  playbackState: 'IDLE', // IDLE | PLAYING | PAUSED | COMPLETE | NXDOMAIN
  isSlowMo: false,
  realTtl: 0,
  selectedHop: null,

  setDomain: (domain) => set({ domain }),
  setRecordType: (recordType) => set({ recordType }),
  setIsBenchmarkMode: (isBenchmarkMode) => set({ isBenchmarkMode }),
  
  startTrace: async (domain, type) => {
    set({
      playbackState: 'PLAYING',
      activeStep: 0,
      traceData: null,
      selectedHop: null,
    })
    
    try {
      const response = await fetch('/api/dns/trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, type }),
      })
      
      const data = await response.json()
      set({ 
        traceData: data,
        playbackState: data.status === 'NOERROR' ? 'PLAYING' : 'NXDOMAIN'
      })
    } catch (error) {
      console.error("Failed to start trace:", error)
      set({ playbackState: 'IDLE' })
    }
  },

  setActiveStep: (step) => set({ activeStep: step }),
  setSelectedHop: (hopId) => set({ selectedHop: hopId }),
  toggleSlowMo: () => set((state) => ({ isSlowMo: !state.isSlowMo })),
  replayTrace: () => set({ activeStep: 0, playbackState: 'PLAYING', selectedHop: null }),
}))
