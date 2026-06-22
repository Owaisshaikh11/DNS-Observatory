import { create } from 'zustand'

const getResolverIp = (name) => {
  if (!name) return '1.1.1.1';
  if (name.includes('1.1.1.1')) return '1.1.1.1';
  if (name.includes('8.8.8.8')) return '8.8.8.8';
  if (name.includes('9.9.9.9')) return '9.9.9.9';
  if (name === 'System Default') return '8.8.8.8';
  const match = name.match(/^([0-9.]+)/);
  return match ? match[1] : '1.1.1.1';
};

export const useTraceStore = create((set, get) => ({
  domain: '',
  recordType: 'ALL',
  isBenchmarkMode: false,
  benchmarkData: null,
  isBenchmarking: false,
  traceData: null,
  activeStep: 0,
  playbackState: 'IDLE', // IDLE | PLAYING | PAUSED | COMPLETE | NXDOMAIN
  isSlowMo: false,
  realTtl: 0,
  selectedHop: null,
  resolver: '1.1.1.1 (Cloudflare)',

  setDomain: (domain) => set({ domain }),
  setRecordType: (recordType) => set({ recordType }),
  setIsBenchmarkMode: (isBenchmarkMode) => set({ isBenchmarkMode }),
  setBenchmarkData: (benchmarkData) => set({ benchmarkData }),
  setIsBenchmarking: (isBenchmarking) => set({ isBenchmarking }),
  setResolver: (resolver) => set({ resolver }),

  startTrace: async (domain, type) => {
    const isBenchmarkMode = get().isBenchmarkMode;
    const resolverName = get().resolver;
    const resolverIp = getResolverIp(resolverName);

    set({
      playbackState: 'PLAYING',
      activeStep: 0,
      traceData: null,
      selectedHop: null,
      benchmarkData: null,
      isBenchmarking: isBenchmarkMode,
    })

    let benchmarkPromise = Promise.resolve(null);
    if (isBenchmarkMode) {
      benchmarkPromise = fetch('/api/dns/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, type }),
      })
        .then(res => res.json())
        .then(data => {
          set({ benchmarkData: data, isBenchmarking: false });
          return data;
        })
        .catch(error => {
          console.error("Failed to run benchmark:", error);
          set({ isBenchmarking: false });
          return null;
        });
    }

    try {
      const response = await fetch('/api/dns/trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, type, resolver: resolverIp }),
      })

      const data = await response.json()
      set({
        traceData: data,
        playbackState: 'PLAYING'
      })

      if (isBenchmarkMode) {
        await benchmarkPromise;
      }
    } catch (error) {
      console.error("Failed to start trace:", error)
      set({ playbackState: 'IDLE', isBenchmarking: false })
    }
  },

  setActiveStep: (step) => set({ activeStep: step }),
  setSelectedHop: (hopId) => set({ selectedHop: hopId }),
  toggleSlowMo: () => set((state) => ({ isSlowMo: !state.isSlowMo })),
  replayTrace: () => set({ activeStep: 0, playbackState: 'PLAYING', selectedHop: null }),
}))
