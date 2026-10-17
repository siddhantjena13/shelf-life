import { Carrot, Cherry, Drumstick, LeafyGreen, Milk, Soup } from 'lucide-react'
import { ZONES } from '../config.js'
import { ITEM_STATUS, PROFILES } from './risk.js'

// Visible freshness, as judged from a photo or by the user. This is separate
// from the sensor score: it records how the food looks, not what it has been
// through.
export const FRESHNESS = {
  fresh: { label: 'Fresh', hint: 'Looks just bought', rank: 5 },
  good: { label: 'Good', hint: 'No visible decline', rank: 4 },
  fair: { label: 'Fair', hint: 'Early wilting, softening or dull color', rank: 3 },
  poor: { label: 'Poor', hint: 'Browning, bruising or sliminess', rank: 2 },
  spoiled: { label: 'Spoiled', hint: 'Mold, rot or an off smell', rank: 1 },
}
export const FRESHNESS_ORDER = ['fresh', 'good', 'fair', 'poor', 'spoiled']
export const freshnessColor = (level) => `var(--fresh-${level})`

export const DATE_KINDS = {
  use_by: 'Use by',
  best_by: 'Best by',
  sell_by: 'Sell by',
  expires: 'Expires',
}

export const CATEGORIES = {
  poultry: { Icon: Drumstick, short: 'Poultry' },
  dairy: { Icon: Milk, short: 'Dairy' },
  greens: { Icon: LeafyGreen, short: 'Greens' },
  berries: { Icon: Cherry, short: 'Berries' },
  produce: { Icon: Carrot, short: 'Produce' },
  other: { Icon: Soup, short: 'Other' },
}
export const CATEGORY_ORDER = Object.keys(PROFILES)

export const zoneLabel = (id) => ZONES.find((z) => z.id === id)?.label ?? id

const LEVEL_RANK = { good: 0, warning: 1, critical: 2 }
const DAY_MS = 86400e3

function parseLocalDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function startOfToday(now = Date.now()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

export function formatShortDate(iso) {
  return parseLocalDate(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// Printed-date countdown in whole calendar days: 0 = today, -1 = yesterday.
export function expiryInfo(item, now = Date.now()) {
  if (!item.expiresOn) return null
  const days = Math.round((parseLocalDate(item.expiresOn) - startOfToday(now)) / DAY_MS)
  const kind = DATE_KINDS[item.dateKind] ?? 'Expires'
  const relative = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday'
    : days > 0 ? `in ${days} days` : `${-days} days ago`
  const level = days < 0 ? 'critical' : days <= 2 ? 'warning' : 'good'
  return { days, kind, relative, level, label: `${kind} ${formatShortDate(item.expiresOn)}` }
}

// Combines what the user saw, the printed date and the sensor model into a
// single "does this need attention" signal, keeping every reason.
export function attention(item, risk, now = Date.now()) {
  const reasons = []
  let level = 'good'
  const raise = (l, text, short, source) => {
    reasons.push({ level: l, text, short, source })
    if (LEVEL_RANK[l] > LEVEL_RANK[level]) level = l
  }
  if (item.freshness === 'spoiled') raise('critical', 'Looked spoiled at the last check', 'Looks spoiled', 'freshness')
  else if (item.freshness === 'poor') raise('warning', 'Looked past its best at the last check', 'Past its best', 'freshness')

  const expiry = expiryInfo(item, now)
  if (expiry?.days < 0) raise('critical', `${expiry.kind} date passed ${expiry.relative}`, `${expiry.kind} passed`, 'date')
  else if (expiry?.level === 'warning') raise('warning', `${expiry.kind} date is ${expiry.relative}`, `${expiry.kind} ${expiry.relative}`, 'date')

  const status = risk && ITEM_STATUS[risk.status]
  if (status && status.level !== 'good') raise(status.level, `Storage model: ${status.label.toLowerCase()}`, status.label, 'sensors')
  return { level, reasons }
}

// Dashboard recommendations from what people logged. Sensor-based advice
// comes from the backend risk engine; these cover what sensors cannot see.
export function inventoryRecommendations(items, now = Date.now()) {
  const recs = []
  for (const item of items) {
    const name = item.name.toLowerCase()
    const expiry = expiryInfo(item, now)
    if (item.freshness === 'spoiled') {
      recs.push({ level: 'critical', title: `Toss the ${name}`, reason: 'It looked spoiled at the last check.', itemId: item.id })
    } else if (expiry?.days < 0) {
      recs.push({ level: 'critical', title: `Check the ${name}`, reason: `Its ${expiry.kind.toLowerCase()} date passed ${expiry.relative}.`, itemId: item.id })
    } else if (item.freshness === 'poor') {
      recs.push({ level: 'warning', title: `Use the ${name} soon`, reason: 'It looked past its best at the last check.', itemId: item.id })
    } else if (expiry?.days === 0) {
      recs.push({ level: 'warning', title: `Use the ${name} today`, reason: `Its ${expiry.kind.toLowerCase()} date is today.`, itemId: item.id })
    }
  }
  return recs
}

// Demo inventory with a spread of states, so an empty database still shows
// what the page can do. Times stay inside the simulator's 24 h of history.
export const SAMPLE_ITEMS = [
  { name: 'Chicken thighs', profile: 'poultry', zone: 'bottom', packaged: true, hoursAgo: 18, expiresInDays: 1, dateKind: 'use_by', freshness: 'good' },
  { name: 'Whole milk', profile: 'dairy', zone: 'top', packaged: true, hoursAgo: 20, expiresInDays: 6, dateKind: 'best_by', freshness: 'fresh' },
  { name: 'Greek yogurt', profile: 'dairy', zone: 'mid', packaged: true, hoursAgo: 12, expiresInDays: 14, dateKind: 'best_by', freshness: 'good' },
  { name: 'Baby spinach', profile: 'greens', zone: 'bottom', packaged: false, hoursAgo: 16, freshness: 'fair', note: 'A few leaves are starting to wilt' },
  { name: 'Strawberries', profile: 'berries', zone: 'mid', packaged: false, hoursAgo: 14, freshness: 'poor', note: 'Soft spots on several berries' },
  { name: 'Carrots', profile: 'produce', zone: 'bottom', packaged: true, hoursAgo: 6, freshness: 'fresh' },
]

export function samplePayload(sample, now = Date.now()) {
  let expiresOn = null
  if (sample.expiresInDays !== undefined) {
    const d = new Date(now + sample.expiresInDays * DAY_MS)
    expiresOn = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return {
    name: sample.name,
    profile: sample.profile,
    zone: sample.zone,
    packaged: sample.packaged,
    addedAt: new Date(now - sample.hoursAgo * 3600e3).toISOString(),
    freshness: sample.freshness,
    freshnessNote: sample.note ?? null,
    expiresOn,
    dateKind: expiresOn ? sample.dateKind : null,
    source: 'manual',
  }
}

// Hours until the first deadline we know of, for "use first" ordering.
export function hoursLeft(item, risk, now = Date.now()) {
  const candidates = []
  const expiry = expiryInfo(item, now)
  if (expiry) candidates.push((parseLocalDate(item.expiresOn).getTime() + DAY_MS - now) / 3600e3)
  if (risk?.scoringMode === 'backend' && Number.isFinite(risk.remainingHours)) candidates.push(risk.remainingHours)
  return candidates.length ? Math.min(...candidates) : Infinity
}

export const attentionRank = (level) => LEVEL_RANK[level]

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return ''
  const min = Math.round((now - Date.parse(iso)) / 60e3)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function storedFor(iso, now = Date.now()) {
  const hours = Math.max(0, (now - Date.parse(iso)) / 3600e3)
  if (hours < 1) return 'under an hour'
  if (hours < 36) return `${Math.round(hours)}h`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

// <input type="datetime-local"> works in local wall-clock time.
export function toLocalInput(date = new Date()) {
  const d = new Date(date)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export function fromLocalInput(value) {
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}
