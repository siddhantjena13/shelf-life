import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, DoorOpen, Moon, Sun } from 'lucide-react'
import { ZONES, RANGES, SAFE_LIMIT_F, OFFLINE_AFTER_MS } from './config.js'
import { useReadings, useNow } from './data/useReadings.js'
import { useHealth, useInventory } from './data/useInventory.js'
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
import { mergeRisk, recommend } from './lib/risk.js'
import { SAMPLE_ITEMS, endOfLocalDay, inventoryRecommendations, samplePayload } from './lib/food.js'
import Sidebar, { MobileNav } from './components/Sidebar.jsx'
import { readSavedValue } from './lib/storage.js'
import StorageConditions from './components/StorageConditions.jsx'
import InventoryRisk from './components/InventoryRisk.jsx'
import ExposureHistory from './components/ExposureHistory.jsx'
import Recommendations from './components/Recommendations.jsx'
import AtAGlance from './components/AtAGlance.jsx'
import LogFoodFlow from './components/LogFoodFlow.jsx'
import RelogFlow from './components/RelogFlow.jsx'
import ItemDetail from './components/ItemDetail.jsx'
import Toasts, { useToasts } from './components/Toasts.jsx'
import InventoryPage from './pages/InventoryPage.jsx'
import SensorsPage from './components/SensorsPage.jsx'
import AlertsPage from './components/AlertsPage.jsx'

const THEME_KEY = 'shelflife-theme'
const RISK_REFRESH_MS = 15_000

function useRiskAssessment(rawReadings, inventory) {
  const [assessment, setAssessment] = useState(null)
  const [error, setError] = useState('')
  const readingsRef = useRef(rawReadings)

  useEffect(() => {
    readingsRef.current = rawReadings
  }, [rawReadings])

  useEffect(() => {
    let stopped = false
    let timer
    let controller
    const refresh = async () => {
      controller = new AbortController()
      try {
        const response = await fetch('/api/risk/assess', {
          signal: controller.signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            now: new Date().toISOString(),
            readings: readingsRef.current,
            inventory: inventory.map((item) => ({
              id: item.id,
              name: item.name,
              profile: item.profile,
              zone: item.zone,
              packaged: item.packaged,
              added_at: item.addedAt,
              expires_at: item.expiresOn ? endOfLocalDay(item.expiresOn) : null,
              date_kind: item.dateKind,
              checks: item.checks
                .filter((check) => check.freshness)
                .map((check) => ({ at: check.at, freshness: check.freshness, source: check.source, confidence: check.confidence })),
            })),
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (stopped) return
        if (!response.ok) throw new Error(payload.detail || 'Backend risk assessment is unavailable.')
        setAssessment(payload)
        setError('')
      } catch (cause) {
        if (stopped) return
        setAssessment(null)
        setError(cause.message || 'Backend risk assessment is unavailable.')
      } finally {
        // Keep aging food even without new sensor data. Wait for each request
        // to finish before scheduling another, so assessments cannot overlap.
        if (!stopped) timer = setTimeout(refresh, RISK_REFRESH_MS)
      }
    }
    refresh()
    return () => {
      stopped = true
      clearTimeout(timer)
      controller?.abort()
    }
  }, [inventory])

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

const PAGES = { dashboard: 'Dashboard', inventory: 'Inventory', sensors: 'Sensors', alerts: 'Alerts' }
const LEVEL_ORDER = { critical: 0, warning: 1, good: 2 }

const pageFromHash = () => {
  const page = window.location.hash.replace(/^#\/?/, '').split('/')[0]
  return PAGES[page] ? page : 'dashboard'
}

function usePage() {
  const [page, setPage] = useState(pageFromHash)
  useEffect(() => {
    const onChange = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const navigate = (target) => {
    window.location.hash = target === 'dashboard' ? '/' : `/${target}`
    window.scrollTo({ top: 0 })
  }
  return [page, navigate]
}

export default function App() {
  const { samples, rawReadings, source } = useReadings()
  const inventory = useInventory()
  const health = useHealth()
  const active = useMemo(
    () => inventory.items.filter((i) => i.state === 'active').map((i) => ({ ...i, addedAtMs: Date.parse(i.addedAt) })),
    [inventory.items],
  )
  const { assessment, error: riskError } = useRiskAssessment(rawReadings, active)
  const riskItems = useMemo(() => mergeRisk(samples, active, assessment), [samples, active, assessment])
  const risks = useMemo(() => new Map(riskItems.map((item) => [item.id, item])), [riskItems])
  const [theme, toggleTheme] = useTheme()
  const [page, navigate] = usePage()
  const now = useNow()
  const { toasts, notify, dismiss } = useToasts()
  const [rangeId, setRangeId] = useState('1h')
  const [doorHeld, setDoorHeld] = useState(false)
  const [logging, setLogging] = useState(false)
  const [detailId, setDetailId] = useState(null)
  const [relogId, setRelogId] = useState(null)
  const [loadingSamples, setLoadingSamples] = useState(false)

  const range = RANGES.find((r) => r.id === rangeId)
  const start = now - range.ms
  const latest = samples[samples.length - 1]
  const online = latest && now - latest.t < OFFLINE_AFTER_MS
  const detailItem = inventory.items.find((i) => i.id === detailId)
  const relogItem = inventory.items.find((i) => i.id === relogId)

  // Item risk is cumulative, so recommendations always look at the full 24
  // hours rather than the selected range.
  const liveRecommendations = recommend(samples, riskItems, doorIntervals(samples))
  const sensorRecommendations = assessment
    ? [...assessment.recommendations, ...liveRecommendations.filter((rec) => rec.title === 'Close the door')]
    : liveRecommendations
  const seen = new Set()
  const recommendations = [...sensorRecommendations, ...inventoryRecommendations(riskItems, now)]
    .filter((rec) => !seen.has(rec.title) && seen.add(rec.title))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
  const sensorStates = ZONES.map((zone) => {
    const reading = rawReadings.findLast((entry) => entry.sensor_id === zone.id)
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

  const setItemState = async (item, state) => {
    await inventory.update(item.id, { state })
    if (state === 'active') {
      notify(`Put ${item.name} back in the fridge`)
    } else {
      notify(`Marked ${item.name} as ${state}`, {
        label: 'Undo',
        run: () => inventory.update(item.id, { state: 'active' }).catch((cause) => notify(cause.message)),
      })
    }
  }

  const deleteItem = async (item) => {
    await inventory.remove(item.id)
    setDetailId(null)
    notify(`Deleted ${item.name}`)
  }

  const loadSamples = async () => {
    setLoadingSamples(true)
    try {
      for (const sample of SAMPLE_ITEMS) await inventory.create(samplePayload(sample))
      notify(`Added ${SAMPLE_ITEMS.length} sample items`)
    } catch (cause) {
      notify(cause.message)
    } finally {
      setLoadingSamples(false)
    }
  }

  const themeButton = (
    <button
      className="btn btn-icon"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )

  return (
    <div className="app">
      <Sidebar page={page} onNavigate={navigate} inventoryCount={active.length} onLog={() => setLogging(true)} />
      <main className="main">
        {page === 'inventory' ? (
          <>
            <header className="page-header">
              <div>
                <h1>Inventory</h1>
                <p className="page-sub">What’s in Cooler 1, how it looks, and what to use first</p>
              </div>
              <div className="page-actions">
                <button className="btn btn-active" onClick={() => setLogging(true)}><Camera size={16} /> Log food</button>
                {themeButton}
              </div>
            </header>
            <InventoryPage
              items={inventory.items}
              status={inventory.status}
              error={inventory.error}
              reload={inventory.reload}
              risks={risks}
              health={health}
              now={now}
              onLog={() => setLogging(true)}
              onOpen={setDetailId}
              onRelog={(item) => setRelogId(item.id)}
              onSetState={(item, state) => setItemState(item, state).catch((cause) => notify(cause.message))}
              onLoadSamples={loadSamples}
              loadingSamples={loadingSamples}
            />
          </>
        ) : (
          <>
            <header className="page-header">
              <h1>{PAGES[page]}</h1>
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
                {themeButton}
              </div>
            </header>

            {page === 'dashboard' && <div className="card">
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

              {latest ? (
                <Panels
                  samples={samples}
                  latest={latest}
                  range={range}
                  start={start}
                  end={now}
                  riskItems={riskItems}
                  recommendations={recommendations.slice(0, 4)}
                  inventoryStatus={inventory.status}
                  assessment={assessment}
                  riskError={riskError}
                  onLog={() => setLogging(true)}
                  onOpenItem={setDetailId}
                  onOpenInventory={() => navigate('inventory')}
                />
              ) : (
                <div className="empty-state dashboard-empty">Waiting for the first sensor reading. The other pages are available from the sidebar.</div>
              )}
            </div>}

            {page === 'sensors' && <div className="card">
              <div className="toolbar">
                <div className="live">
                  <span className={`live-dot ${online ? 'on' : ''}`} />
                  <span><strong>{online ? 'Live sensor feed' : latest ? 'Sensor feed offline' : 'Waiting for readings'}</strong></span>
                  {source?.simulated && <span className="tag">Simulated data</span>}
                </div>
                <div className="segmented" role="group" aria-label="Sensor history time range">
                  {RANGES.map((r) => (
                    <button key={r.id} className={r.id === rangeId ? 'selected' : ''} onClick={() => setRangeId(r.id)}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <SensorsPage samples={samples} rawReadings={rawReadings} now={now} range={range} />
            </div>}

            {page === 'alerts' && <div className="card">
              <div className="toolbar">
                <div className="live">
                  <span className={`live-dot ${online ? 'on' : ''}`} />
                  <span><strong>{online ? 'Monitoring active' : 'Monitoring paused'}</strong> · food and sensor status</span>
                </div>
                <span className="tag">Cooler 1</span>
              </div>
              <AlertsPage recommendations={recommendations} sensors={sensorStates} now={now} riskActive={Boolean(assessment)} />
            </div>}
          </>
        )}
      </main>
      <MobileNav page={page} onNavigate={navigate} onLog={() => setLogging(true)} />

      {logging && (
        <LogFoodFlow onClose={() => setLogging(false)} onCreate={inventory.create} notify={notify} visionReady={health?.vision} />
      )}
      {detailItem && (
        <ItemDetail
          item={detailItem}
          risk={risks.get(detailItem.id)}
          now={now}
          onClose={() => setDetailId(null)}
          onRelog={(item) => setRelogId(item.id)}
          onUpdate={inventory.update}
          onSetState={setItemState}
          onDelete={deleteItem}
        />
      )}
      {relogItem && (
        <RelogFlow item={relogItem} onClose={() => setRelogId(null)} onCheck={inventory.addCheck} notify={notify} />
      )}
      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  )
}

function Panels({ samples, latest, range, start, end, riskItems, recommendations, inventoryStatus, assessment, riskError, onLog, onOpenItem, onOpenInventory }) {
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
        <InventoryRisk
          items={riskItems}
          inventoryStatus={inventoryStatus}
          onLog={onLog}
          onOpenItem={onOpenItem}
          onOpenInventory={onOpenInventory}
          riskActive={Boolean(assessment)}
          riskError={riskError}
        />
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
