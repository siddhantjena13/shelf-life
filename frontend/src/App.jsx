import { useEffect, useRef, useState } from 'react'
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
import { INVENTORY, PROFILES, scoreInventory, recommend } from './lib/risk.js'
import { readSavedValue } from './lib/storage.js'
import Sidebar from './components/Sidebar.jsx'
import StorageConditions from './components/StorageConditions.jsx'
import InventoryRisk from './components/InventoryRisk.jsx'
import ExposureHistory from './components/ExposureHistory.jsx'
import Recommendations from './components/Recommendations.jsx'
import AtAGlance from './components/AtAGlance.jsx'
import SensorsPage from './components/SensorsPage.jsx'
import AlertsPage from './components/AlertsPage.jsx'

const THEME_KEY = 'shelflife-theme'
const INVENTORY_KEY = 'shelflife-inventory'
const RISK_REFRESH_MS = 15_000

function freshStarterInventory() {
  const addedAtMs = Date.now()
  return INVENTORY.map((item) => ({ ...item, addedAtMs }))
}

function useInventory() {
  const [inventory, setInventory] = useState(() => {
    try {
      const saved = readSavedValue(INVENTORY_KEY, 'shelfsense-inventory')
      if (!saved) return freshStarterInventory()
      const parsed = JSON.parse(saved)
      if (!Array.isArray(parsed)) return freshStarterInventory()
      return parsed.filter((item) => item && typeof item.name === 'string' && item.name.trim()).map((item) => ({
        ...item,
        profile: PROFILES[item.profile] ? item.profile : 'other',
        zone: ZONES.some((zone) => zone.id === item.zone) ? item.zone : 'mid',
        addedAtMs: Number.isFinite(item.addedAtMs) ? item.addedAtMs : Date.now(),
        packaged: Boolean(item.packaged),
      }))
    } catch {
      return freshStarterInventory()
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(INVENTORY_KEY, JSON.stringify(inventory))
    } catch {
      // Inventory remains usable for this session if storage is unavailable.
    }
  }, [inventory])

  return [inventory, setInventory]
}

function useRiskAssessment(rawReadings, inventory) {
  const [assessment, setAssessment] = useState(null)
  const [error, setError] = useState('')
  const lastRequestAt = useRef(0)

  useEffect(() => {
    if (!rawReadings.length) return undefined
    const delay = Math.max(0, RISK_REFRESH_MS - (Date.now() - lastRequestAt.current))
    const timer = setTimeout(async () => {
      lastRequestAt.current = Date.now()
      try {
        const response = await fetch('/api/risk/assess', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            now: new Date().toISOString(),
            readings: rawReadings,
            inventory: inventory.map((item) => ({
              ...item,
              added_at: new Date(item.addedAtMs ?? Date.now()).toISOString(),
            })),
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.detail || 'Backend risk assessment is unavailable.')
        setAssessment(payload)
        setError('')
      } catch (cause) {
        setAssessment(null)
        setError(cause.message || 'Backend risk assessment is unavailable.')
      }
    }, delay)
    return () => clearTimeout(timer)
  }, [rawReadings, inventory])

  return { assessment, error }
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return readSavedValue(THEME_KEY, 'shelfsense-theme') === 'dark' ? 'dark' : 'light'
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
  const { samples, rawReadings, source } = useReadings()
  const [inventory, setInventory] = useInventory()
  const { assessment, error: riskError } = useRiskAssessment(rawReadings, inventory)
  const [theme, toggleTheme] = useTheme()
  const now = useNow()
  const [rangeId, setRangeId] = useState('1h')
  const [doorHeld, setDoorHeld] = useState(false)
  const [activePage, setActivePage] = useState('Dashboard')

  const range = RANGES.find((r) => r.id === rangeId)
  const start = now - range.ms
  const latest = samples[samples.length - 1]
  const online = latest && now - latest.t < OFFLINE_AFTER_MS
  const title = activePage
  const inventoryItems = scoreInventory(samples, inventory)
  const assessedById = new Map((assessment?.items || []).map((item) => [item.id, item]))
  const displayItems = inventoryItems.map((item) => {
    const result = assessedById.get(item.id)
    return result ? {
      ...item,
      ...result,
      profileLabel: PROFILES[item.profile]?.label ?? result.profileLabel,
      limitF: 40,
      timeAboveMs: result.dangerZoneHours * 3600e3,
      remainingHours: result.remainingHours,
      scoringMode: 'backend',
    } : { ...item, scoringMode: 'preview' }
  })
  const liveRecommendations = recommend(samples, displayItems, doorIntervals(samples))
  const recommendations = assessment
    ? [...assessment.recommendations, ...liveRecommendations.filter((rec) => rec.title === 'Close the door')].slice(0, 4)
    : liveRecommendations
  const sensorStates = ZONES.map((zone) => {
    const reading = [...rawReadings].reverse().find((entry) => entry.sensor_id === zone.id)
    return {
      ...zone,
      tempF: Number.isFinite(reading?.temp_c) ? reading.temp_c * 1.8 + 32 : null,
      humidity: reading?.humidity,
      at: reading ? Date.parse(reading.timestamp) : null,
    }
  })

  const toggleDoor = () => {
    source.setDoorOpen(!doorHeld)
    setDoorHeld(!doorHeld)
  }

  return (
    <div className="app">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main className="main">
        <header className="page-header">
          <h1>{title}</h1>
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

        <nav className="mobile-nav" aria-label="Main navigation">
          {['Dashboard', 'Inventory', 'Sensors', 'Alerts'].map((page) => <button key={page} className={activePage === page ? 'selected' : ''} aria-current={activePage === page ? 'page' : undefined} onClick={() => setActivePage(page)}>{page}</button>)}
        </nav>

        {activePage === 'Dashboard' && <div className="card">
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

          {latest ? <Panels samples={samples} latest={latest} range={range} start={start} end={now} inventory={inventory} setInventory={setInventory} assessment={assessment} riskError={riskError} /> : <div className="empty-state dashboard-empty">Waiting for the first sensor reading. Inventory and setup pages are available from the sidebar.</div>}
        </div>}

        {activePage === 'Inventory' && <div className="card">
          <div className="toolbar"><div className="live"><span className={`live-dot ${online ? 'on' : ''}`} /><span><strong>{inventory.length} tracked items</strong> · risk scores use sensor exposure</span></div><span className="tag">{assessment ? 'Live risk model' : 'Preview risk estimate'}</span></div>
          <InventoryRisk items={displayItems} inventory={inventory} setInventory={setInventory} riskActive={Boolean(assessment)} riskError={riskError} fullPage />
        </div>}

        {activePage === 'Sensors' && <div className="card">
          <div className="toolbar"><div className="live"><span className={`live-dot ${online ? 'on' : ''}`} /><span><strong>{online ? 'Live sensor feed' : latest ? 'Sensor feed offline' : 'Waiting for readings'}</strong></span>{source?.simulated && <span className="tag">Simulated data</span>}</div>
            <div className="segmented" role="group" aria-label="Sensor history time range">{RANGES.map((r) => <button key={r.id} className={r.id === rangeId ? 'selected' : ''} onClick={() => setRangeId(r.id)}>{r.label}</button>)}</div>
          </div>
          <SensorsPage samples={samples} rawReadings={rawReadings} now={now} range={range} />
        </div>}

        {activePage === 'Alerts' && <div className="card">
          <div className="toolbar"><div className="live"><span className={`live-dot ${online ? 'on' : ''}`} /><span><strong>{online ? 'Monitoring active' : 'Monitoring paused'}</strong> · food and sensor status</span></div><span className="tag">Cooler 1</span></div>
          <AlertsPage recommendations={recommendations} sensors={sensorStates} now={now} riskActive={Boolean(assessment)} />
        </div>}
      </main>
    </div>
  )
}

function Panels({ samples, latest, range, start, end, inventory, setInventory, assessment, riskError }) {
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
  const previewItems = scoreInventory(samples, inventory)
  const assessedById = new Map((assessment?.items || []).map((item) => [item.id, item]))
  const items = previewItems.map((item) => {
    const result = assessedById.get(item.id)
    return result ? {
      ...item,
      ...result,
      profileLabel: PROFILES[item.profile]?.label ?? result.profileLabel,
      limitF: 40,
      timeAboveMs: result.dangerZoneHours * 3600e3,
      remainingHours: result.remainingHours,
      scoringMode: 'backend',
    } : { ...item, scoringMode: 'preview' }
  })
  const liveRecommendations = recommend(samples, items, doorIntervals(samples))
  const recommendations = assessment
    ? [...assessment.recommendations, ...liveRecommendations.filter((rec) => rec.title === 'Close the door')].slice(0, 4)
    : liveRecommendations

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
        <InventoryRisk items={items} inventory={inventory} setInventory={setInventory} riskActive={Boolean(assessment)} riskError={riskError} />
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
