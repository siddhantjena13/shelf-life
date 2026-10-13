import { useEffect, useState } from 'react'
import { createSource } from './source.js'

const KEEP_MS = 24 * 3600e3

// Folds raw per-sensor readings into samples: one entry per timestamp holding
// the latest known value of every zone.
//   { t, doorOpen, zones: { [sensor_id]: { tempF, humidity } } }
function createFolder() {
  const latest = {}
  return (readings) => {
    const sorted = [...readings].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const samples = []
    for (const r of sorted) {
      const t = Date.parse(r.timestamp)
      latest[r.sensor_id] = { tempF: r.temp_c * 1.8 + 32, humidity: r.humidity }
      const prev = samples[samples.length - 1]
      if (prev && prev.t === t) {
        prev.zones = { ...latest }
        prev.doorOpen ||= Boolean(r.door_open)
      } else {
        samples.push({ t, doorOpen: Boolean(r.door_open), zones: { ...latest } })
      }
    }
    return samples
  }
}

export function useReadings() {
  const [samples, setSamples] = useState([])
  const [source, setSource] = useState(null)

  useEffect(() => {
    const src = createSource()
    const fold = createFolder()
    let cancelled = false
    let unsubscribe = () => {}

    setSource(src)
    src.loadHistory().then((history) => {
      if (cancelled) return
      setSamples(fold(history))
      unsubscribe = src.subscribe((readings) => {
        const cutoff = Date.now() - KEEP_MS
        setSamples((prev) => [...prev, ...fold(readings)].filter((s) => s.t >= cutoff))
      })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return { samples, source }
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
