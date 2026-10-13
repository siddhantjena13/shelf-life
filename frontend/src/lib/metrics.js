import { ZONES, SAFE_LIMIT_F, DANGER_LIMIT_F } from '../config.js'

// A gap longer than this between samples is treated as missing data rather
// than time spent at the earlier reading.
const MAX_GAP_MS = 120e3

function eachSpan(samples, fn) {
  for (let i = 0; i < samples.length - 1; i++) {
    fn(samples[i], Math.min(samples[i + 1].t - samples[i].t, MAX_GAP_MS))
  }
}

export const zoneTemp = (zoneId) => (s) => s.zones[zoneId]?.tempF ?? -Infinity
export const warmest = (s) => Math.max(...ZONES.map((z) => zoneTemp(z.id)(s)))

export function timeAbove(samples, pick, limit) {
  let ms = 0
  eachSpan(samples, (s, dt) => {
    if (pick(s) > limit) ms += dt
  })
  return ms
}

// Cumulative exposure: degrees above the limit multiplied by minutes spent there.
export function degreeMinutes(samples, pick, limit) {
  let total = 0
  eachSpan(samples, (s, dt) => {
    const over = pick(s) - limit
    if (over > 0) total += over * (dt / 60e3)
  })
  return total
}

export function longestRunAbove(samples, pick, limit) {
  let longest = 0
  let run = 0
  eachSpan(samples, (s, dt) => {
    run = pick(s) > limit ? run + dt : 0
    longest = Math.max(longest, run)
  })
  return longest
}

// Time the warmest zone spent in each band.
export function bandDurations(samples) {
  const bands = { safe: 0, caution: 0, danger: 0 }
  eachSpan(samples, (s, dt) => {
    bands[tempLevel(warmest(s)).band] += dt
  })
  return bands
}

export function tempLevel(tempF) {
  if (tempF > DANGER_LIMIT_F) return { band: 'danger', level: 'critical', label: 'Danger' }
  if (tempF > SAFE_LIMIT_F) return { band: 'caution', level: 'warning', label: 'Caution' }
  return { band: 'safe', level: 'good', label: 'In range' }
}

export function doorIntervals(samples) {
  const out = []
  let start = null
  for (const s of samples) {
    if (s.doorOpen && start === null) start = s.t
    if (!s.doorOpen && start !== null) {
      out.push({ start, end: s.t })
      start = null
    }
  }
  if (start !== null) out.push({ start, end: samples[samples.length - 1].t, ongoing: true })
  return out
}

// Averages samples into fixed-width buckets aligned to the clock, so existing
// points stay put as new readings arrive. Rows: { t, top_t, top_h, mid_t, ... }
export function bucketize(samples, bucketMs) {
  const buckets = new Map()
  for (const s of samples) {
    const key = Math.floor(s.t / bucketMs)
    let b = buckets.get(key)
    if (!b) buckets.set(key, (b = { n: 0, t: 0, sums: {} }))
    b.n++
    b.t += s.t
    for (const z of ZONES) {
      const v = s.zones[z.id]
      if (!v) continue
      const sum = (b.sums[z.id] ??= { n: 0, temp: 0, hum: 0 })
      sum.n++
      sum.temp += v.tempF
      sum.hum += v.humidity
    }
  }
  return [...buckets.values()].map((b) => {
    const row = { t: Math.round(b.t / b.n) }
    for (const [id, sum] of Object.entries(b.sums)) {
      row[`${id}_t`] = Number((sum.temp / sum.n).toFixed(1))
      row[`${id}_h`] = Number((sum.hum / sum.n).toFixed(1))
    }
    return row
  })
}

export function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN
}

export function formatDuration(ms) {
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

export function formatClock(t, withSeconds = false) {
  return new Date(t).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    ...(withSeconds && { second: '2-digit' }),
  })
}
