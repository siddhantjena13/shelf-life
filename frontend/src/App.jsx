import { useEffect, useState } from 'react'
import { DoorOpen, Moon, Sun } from 'lucide-react'
import { ZONES, RANGES, SAFE_LIMIT_F, OFFLINE_AFTER_MS } from './config.js'
import { useReadings, useNow } from './data/useReadings.js'
import {
  bandDurations,
  bucketize,
  doorIntervals,
  longestRunAbove,
  mean,
  timeAbove,
  warmest,
  zoneTemp,
  tempLevel,
} from './lib/metrics.js'
import { scoreInventory, recommend } from './lib/risk.js'
import Sidebar from './components/Sidebar.jsx'
import StorageConditions from './components/StorageConditions.jsx'
import InventoryRisk from './components/InventoryRisk.jsx'
import ExposureHistory from './components/ExposureHistory.jsx'
import Recommendations from './components/Recommendations.jsx'
import AtAGlance from './components/AtAGlance.jsx'

const THEME_KEY = 'shelfsense-theme'

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Storage can be unavailable in private windows; the theme still applies.
    }
  }, [theme])

  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')]
}

export default function App() {
  const { samples, source } = useReadings()
  const [theme, toggleTheme] = useTheme()
  const now = useNow()
  const [rangeId, setRangeId] = useState('1h')
  const [doorHeld, setDoorHeld] = useState(false)

  const range = RANGES.find((r) => r.id === rangeId)
  const start = now - range.ms
  const latest = samples[samples.length - 1]
  const online = latest && now - latest.t < OFFLINE_AFTER_MS

  const toggleDoor = () => {
    source.setDoorOpen(!doorHeld)
    setDoorHeld(!doorHeld)
  }

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <header className="page-header">
          <h1>Dashboard</h1>
          <div className="page-actions">
            {source?.simulated && (
              <button className={`btn ${doorHeld ? 'btn-active' : ''}`} onClick={toggleDoor} aria-pressed={doorHeld}>
                <DoorOpen size={16} />
                {doorHeld ? 'Close simulated door' : 'Simulate door open'}
              </button>
            )}
            <select className="select" aria-label="Storage unit" defaultValue="cooler-1">
              <option value="cooler-1">Cooler 1</option>
            </select>
            <button
              className="btn btn-icon"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>

        <div className="card">
          <div className="toolbar">
            <div className="live">
              <span className={`live-dot ${online ? 'on' : ''}`} />
              {online ? (
                <span>
                  <strong>Live</strong> · last reading {Math.max(0, Math.round((now - latest.t) / 1000))}s ago
                </span>
              ) : (
                <strong>{latest ? 'Offline' : 'Waiting for readings…'}</strong>
              )}
              {source?.simulated && <span className="tag">Simulated data</span>}
            </div>
            <div className="segmented" role="group" aria-label="Time range">
              {RANGES.map((r) => (
                <button key={r.id} className={r.id === rangeId ? 'selected' : ''} onClick={() => setRangeId(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {latest && <Panels samples={samples} latest={latest} range={range} start={start} end={now} />}
        </div>
      </main>
    </div>
  )
}

function Panels({ samples, latest, range, start, end }) {
  const windowed = samples.filter((s) => s.t >= start)
  const doors = doorIntervals(windowed)

  const zones = ZONES.map((z) => {
    const v = latest.zones[z.id]
    return {
      ...z,
      tempF: v?.tempF,
      humidity: v?.humidity,
      status: tempLevel(v?.tempF),
      aboveMs: timeAbove(windowed, zoneTemp(z.id), SAFE_LIMIT_F),
    }
  })

  // Item risk is cumulative, so it always looks at the full 24 hours rather
  // than the selected range.
  const items = scoreInventory(samples)
  const recommendations = recommend(samples, items, doorIntervals(samples))

  return (
    <>
      <div className="split">
        <StorageConditions
          zones={zones}
          tempF={mean(zones.map((z) => z.tempF).filter(Number.isFinite))}
          humidity={mean(zones.map((z) => z.humidity).filter(Number.isFinite))}
          bands={bandDurations(windowed)}
          rangeLabel={range.label}
        />
        <InventoryRisk items={items} />
      </div>
      <ExposureHistory
        rows={bucketize(windowed, range.bucketMs)}
        start={start}
        end={end}
        range={range}
        doors={doors}
        aboveMs={timeAbove(windowed, warmest, SAFE_LIMIT_F)}
      />
      <div className="split">
        <Recommendations items={recommendations} />
        <AtAGlance
          rangeLabel={range.label}
          longestMs={longestRunAbove(windowed, warmest, SAFE_LIMIT_F)}
          avgHumidity={mean(
            windowed.flatMap((s) => ZONES.map((z) => s.zones[z.id]?.humidity)).filter(Number.isFinite),
          )}
          doorCount={doors.length}
          sensorsOnline={zones.filter((z) => Number.isFinite(z.tempF)).length}
        />
      </div>
    </>
  )
}
