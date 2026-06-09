import { create } from 'zustand'
import { io } from 'socket.io-client'

export const useTelemetryStore = create((set, get) => ({
  queries: [],
  isConnected: false,
  socket: null,

  connect: () => {
    if (get().socket) return

    const socket = io()
    
    socket.on('connect', () => set({ isConnected: true }))
    socket.on('disconnect', () => set({ isConnected: false }))
    
    socket.on('dns:query', (event) => {
      set((state) => ({
        // Keep last 100 queries
        queries: [event, ...state.queries].slice(0, 100)
      }))
    })

    set({ socket })
  },

  disconnect: () => {
    const { socket } = get()
    if (socket) {
      socket.disconnect()
      set({ socket: null, isConnected: false })
    }
  },
  
  clear: () => set({ queries: [] })
}))
