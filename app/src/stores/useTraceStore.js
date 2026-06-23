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

let initialRecentQueries = [];
try {
  const stored = localStorage.getItem('dns_trace_history');
  if (stored) {
    initialRecentQueries = JSON.parse(stored);
  }
} catch (e) {
  console.error("Failed to parse recent queries:", e);
}

export const useTraceStore = create((set, get) => ({
  domain: '',
  recordType: 'ALL',
  isBenchmarkMode: false,
  benchmarkData: null,
  isBenchmarking: false,
  traceData: null,
  traceError: null,
  activeStep: 0,
  playbackState: 'IDLE', // IDLE | PLAYING | PAUSED | COMPLETE | NXDOMAIN
  isSlowMo: false,
  realTtl: 0,
  selectedHop: null,
  resolver: '1.1.1.1 (Cloudflare)',
  activeAbortController: null,
  recentQueries: initialRecentQueries,

  setDomain: (domain) => set({ domain }),
  setRecordType: (recordType) => set({ recordType }),
  setIsBenchmarkMode: (isBenchmarkMode) => set({ isBenchmarkMode }),
  setBenchmarkData: (benchmarkData) => set({ benchmarkData }),
  setIsBenchmarking: (isBenchmarking) => set({ isBenchmarking }),
  setResolver: (resolver) => set({ resolver }),

  cancelPendingRequests: () => {
    const controller = get().activeAbortController;
    if (controller) {
      controller.abort();
    }
    set({ activeAbortController: null });
  },

  startTrace: async (domain, type) => {
    // Abort existing trace or benchmark requests if active
    const existingController = get().activeAbortController;
    if (existingController) {
      existingController.abort();
    }

    const controller = new AbortController();
    const signal = controller.signal;
    set({ activeAbortController: controller });

    const isBenchmarkMode = get().isBenchmarkMode;
    const resolverName = get().resolver;
    const resolverIp = getResolverIp(resolverName);

    set({
      playbackState: 'PLAYING',
      activeStep: 0,
      traceData: null,
      traceError: null,
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
        signal,
      })
        .then(async res => {
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || `HTTP error ${res.status}`);
          }
          set({ benchmarkData: data, isBenchmarking: false });
          return data;
        })
        .catch(error => {
          if (error.name === 'AbortError') return null;
          console.error("Failed to run benchmark:", error);
          set({ isBenchmarking: false, traceError: error.message });
          return null;
        });
    }

    try {
      const response = await fetch('/api/dns/trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, type, resolver: resolverIp }),
        signal,
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || `HTTP error ${response.status}`);
      }

      set({
        traceData: data,
        playbackState: 'PLAYING'
      })

      // Update query history on success
      const currentQueries = get().recentQueries || [];
      const filtered = currentQueries.filter(
        q => !(q.domain.toLowerCase() === domain.toLowerCase() && q.type === type)
      );
      const updated = [{ domain, type }, ...filtered].slice(0, 5);
      set({ recentQueries: updated });
      try {
        localStorage.setItem('dns_trace_history', JSON.stringify(updated));
      } catch (e) {
        console.error("Failed to save recent queries:", e);
      }

      if (isBenchmarkMode) {
        await benchmarkPromise;
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error("Failed to start trace:", error)
      set({ playbackState: 'IDLE', isBenchmarking: false, traceError: error.message })
    }
  },

  setActiveStep: (step) => set({ activeStep: step }),
  setSelectedHop: (hopId) => set({ selectedHop: hopId }),
  toggleSlowMo: () => set((state) => ({ isSlowMo: !state.isSlowMo })),
  replayTrace: () => set({ activeStep: 0, playbackState: 'PLAYING', selectedHop: null }),
  clearRecentQueries: () => {
    set({ recentQueries: [] });
    try {
      localStorage.removeItem('dns_trace_history');
    } catch (e) {
      console.error("Failed to clear recent queries:", e);
    }
  },
}))
