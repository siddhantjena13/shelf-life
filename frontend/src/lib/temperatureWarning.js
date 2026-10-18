export const WARNING_TEMP_F = 45
export const WARNING_DURATION_MS = 15_000

// Only observed, recent readings count. Missing readings cannot establish
// continuous warmth, and old history must not trigger a new popup on load.
export function createTemperatureWarningTracker() {
  const states = new Map()
  return (sensors, now) => {
    const warnings = []
    for (const sensor of sensors) {
      const prev = states.get(sensor.id)
      if (!Number.isFinite(sensor.at) || now - sensor.at >= 15_000 || !Number.isFinite(sensor.tempF)) {
        states.delete(sensor.id)
        continue
      }
      if (prev && sensor.at <= prev.at) continue
      if (sensor.tempF <= WARNING_TEMP_F) {
        states.delete(sensor.id)
        continue
      }
      const state = prev && sensor.at - prev.at < 15_000
        ? { ...prev, at: sensor.at }
        : { start: sensor.at, at: sensor.at, fired: false }
      if (!state.fired && sensor.at - state.start >= WARNING_DURATION_MS) {
        state.fired = true
        warnings.push({ ...sensor, eventId: `${sensor.id}:${state.start}` })
      }
      states.set(sensor.id, state)
    }
    return warnings
  }
}
