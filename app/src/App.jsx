import { Routes, Route, useLocation } from 'react-router'
import { AnimatePresence } from 'framer-motion'
import CustomCursor from './components/CustomCursor'
import InteractiveGrid from './components/InteractiveGrid'

// Pages
import EntryPage from './pages/EntryPage'
import VisualizerPage from './pages/VisualizerPage'
import TelemetryPage from './pages/TelemetryPage'

function App() {
  const location = useLocation()

  return (
    <div className="w-full h-screen font-sans text-ink overflow-hidden selection:bg-accent selection:text-[var(--base)] relative">
      <CustomCursor />

      <InteractiveGrid />
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<EntryPage />} />
          <Route path="/trace" element={<VisualizerPage />} />
          <Route path="/telemetry" element={<TelemetryPage />} />
        </Routes>
      </AnimatePresence>
    </div>
  )
}

export default App
