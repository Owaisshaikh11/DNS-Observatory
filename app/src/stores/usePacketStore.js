import { create } from 'zustand'

export const usePacketStore = create((set) => ({
  // Selected trace hop ID for packet viewer
  selectedHopId: null,

  setSelectedHopId: (id) => set({ selectedHopId: id }),

  clear: () => set({
    selectedHopId: null,
  })
}))
