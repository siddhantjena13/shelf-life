// Sensor zones inside the storage unit. `id` matches the `sensor_id` each
// reading arrives with; the color follows the zone everywhere it is drawn.
export const ZONES = [
  { id: 'top', label: 'Top', color: 'var(--series-1)' },
  { id: 'mid', label: 'Middle', color: 'var(--series-2)' },
  { id: 'bottom', label: 'Bottom', color: 'var(--series-3)' },
]

// USDA cold-storage guidance: keep refrigerated food at or below 40°F.
export const SAFE_LIMIT_F = 40
export const DANGER_LIMIT_F = 45

export const RANGES = [
  { id: '15m', label: '15 min', ms: 15 * 60e3, bucketMs: 5e3, tickMs: 3 * 60e3 },
  { id: '1h', label: '1 hour', ms: 60 * 60e3, bucketMs: 30e3, tickMs: 10 * 60e3 },
  { id: '6h', label: '6 hours', ms: 6 * 3600e3, bucketMs: 3 * 60e3, tickMs: 3600e3 },
  { id: '24h', label: '24 hours', ms: 24 * 3600e3, bucketMs: 10 * 60e3, tickMs: 4 * 3600e3 },
]

// A unit with no reading for this long is shown as offline.
export const OFFLINE_AFTER_MS = 15e3
