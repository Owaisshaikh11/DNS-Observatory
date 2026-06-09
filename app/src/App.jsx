import { Routes, Route } from 'react-router'
import CustomCursor from './components/CustomCursor'

// Pages
import EntryPage from './pages/EntryPage'
import VisualizerPage from './pages/VisualizerPage'
import TelemetryPage from './pages/TelemetryPage'

function App() {
  return (
    <>
      <CustomCursor />
      <Routes>
        <Route path="/" element={<EntryPage />} />
        <Route path="/trace" element={<VisualizerPage />} />
        <Route path="/telemetry" element={<TelemetryPage />} />
      </Routes>
    </>
  )
}

export default App
