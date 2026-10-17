// Lightweight preview scoring used only while the backend risk engine is
// unavailable. Normal dashboard assessments come from backend/risk/engine.py.

import { ZONES, SAFE_LIMIT_F } from '../config.js'
import { degreeMinutes, timeAbove, longestRunAbove, zoneTemp, warmest, mean, formatDuration } from './metrics.js'

export const PROFILES = {
  poultry: { label: 'Raw poultry', limitF: 40, sensitivity: 1.6 },
  dairy: { label: 'Dairy', limitF: 40, sensitivity: 1.0 },
  greens: { label: 'Leafy greens', limitF: 41, sensitivity: 0.6 },
  berries: { label: 'Berries', limitF: 40, sensitivity: 0.8 },
  produce: { label: 'Whole produce', limitF: 40, sensitivity: 0.8 },
  other: { label: 'Other refrigerated food', limitF: 40, sensitivity: 1.0 },
}

export const INVENTORY = [
  { id: 'chicken', name: 'Chicken thighs', profile: 'poultry', zone: 'bottom' },
  { id: 'turkey', name: 'Ground turkey', profile: 'poultry', zone: 'mid' },
  { id: 'milk', name: 'Milk', profile: 'dairy', zone: 'top' },
  { id: 'yogurt', name: 'Yogurt', profile: 'dairy', zone: 'mid' },
  { id: 'spinach', name: 'Spinach', profile: 'greens', zone: 'bottom' },
  { id: 'romaine', name: 'Romaine', profile: 'greens', zone: 'mid' },
]

export const ITEM_STATUS = {
  good: { level: 'good', label: 'Good' },
  soon: { level: 'warning', label: 'Use soon' },
  risk: { level: 'critical', label: 'At risk' },
  use_soon: { level: 'warning', label: 'Use soon' },
  at_risk: { level: 'critical', label: 'At risk' },
  expired: { level: 'critical', label: 'Expired' },
  discard: { level: 'critical', label: 'Discard' },
}

const zoneLabel = (id) => ZONES.find((z) => z.id === id)?.label ?? id

export function scoreInventory(samples, inventory = INVENTORY) {
  return inventory.map((item) => {
    const profile = PROFILES[item.profile]
    const itemSamples = Number.isFinite(item.addedAtMs)
      ? samples.filter((sample) => sample.t >= item.addedAtMs)
      : samples
    const pick = zoneTemp(item.zone)
    const exposure = degreeMinutes(itemSamples, pick, profile.limitF)
    const score = Math.round(Math.max(0, 100 - (profile.sensitivity * exposure) / 6))
    const status = score >= 80 ? 'good' : score >= 50 ? 'soon' : 'risk'
    return {
      ...item,
      profileLabel: profile.label,
      zoneLabel: zoneLabel(item.zone),
      limitF: profile.limitF,
      timeAboveMs: timeAbove(itemSamples, pick, profile.limitF),
      score,
      status,
    }
  }).sort((a, b) => a.score - b.score)
}

export function recommend(samples, items, doors) {
  const recs = []
  const openNow = doors.find((d) => d.ongoing)
  if (openNow && openNow.end - openNow.start > 30e3) {
    recs.push({
      level: 'critical',
      title: 'Close the door',
      reason: `Open for ${formatDuration(openNow.end - openNow.start)} and warming.`,
    })
  }

  for (const item of items.filter((i) => ['risk', 'at_risk', 'expired', 'discard'].includes(i.status)).slice(0, 2)) {
    recs.push({
      level: 'critical',
      title: item.status === 'discard' ? `Discard the ${item.name.toLowerCase()}` :
        item.status === 'expired' ? `Check the ${item.name.toLowerCase()} before using` :
          item.status === 'at_risk' ? `Use the ${item.name.toLowerCase()} today` :
            `Check the ${item.name.toLowerCase()} before using`,
      reason: item.remainingHours != null
        ? `Estimated remaining shelf life: ${formatDuration(item.remainingHours * 3600e3)}.`
        : `${formatDuration(item.timeAboveMs)} above ${item.limitF}°F in the ${item.zoneLabel.toLowerCase()} zone.`,
    })
  }

  const avgByZone = Object.fromEntries(
    ZONES.map((z) => [z.id, mean(samples.map(zoneTemp(z.id)).filter(Number.isFinite))]),
  )
  const coldest = ZONES.reduce((a, b) => (avgByZone[a.id] <= avgByZone[b.id] ? a : b))
  const movable = items.find((i) => i.status !== 'good' && i.zone !== coldest.id)
  if (movable) {
    const diff = avgByZone[movable.zone] - avgByZone[coldest.id]
    recs.push({
      level: 'warning',
      title: `Move the ${movable.name.toLowerCase()} to the ${coldest.label.toLowerCase()} zone`,
      reason: `It averaged ${diff.toFixed(1)}°F cooler than the ${movable.zoneLabel.toLowerCase()} zone.`,
    })
  }

  const longest = longestRunAbove(samples, warmest, SAFE_LIMIT_F)
  if (longest > 15 * 60e3) {
    recs.push({
      level: 'warning',
      title: 'Check the door seal',
      reason: `One stretch above ${SAFE_LIMIT_F}°F lasted ${formatDuration(longest)}.`,
    })
  }

  if (doors.length > 30) {
    recs.push({
      level: 'warning',
      title: 'Open the door less often',
      reason: `${doors.length} openings, each letting warm air in.`,
    })
  }

  return recs.slice(0, 4)
}
