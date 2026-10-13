// Stand-in for the ESP32 + backend until the hardware arrives. It emits
// readings in the same shape the firmware will POST:
//   { device_id, sensor_id, temp_c, humidity, door_open, timestamp }

const DEVICE_ID = 'cooler-1'
const LIVE_INTERVAL_MS = 2000
const HISTORY_MS = 24 * 3600e3
const CYCLE_MS = 18 * 60e3 // compressor cycle

const SENSORS = [
  { id: 'top', baseF: 38.6, baseHum: 58, tauOpen: 300, tauClose: 300, phase: 0 },
  { id: 'mid', baseF: 37.2, baseHum: 64, tauOpen: 480, tauClose: 380, phase: 1.1 },
  { id: 'bottom', baseF: 35.4, baseHum: 71, tauOpen: 900, tauClose: 480, phase: 2.3 },
]

// How far above baseline (°F) the air heads while the door is open or ajar.
const OPEN_TARGET = 20
const AJAR_TARGET = 12

const round = (v, places) => Number(v.toFixed(places))

function createModel() {
  const state = Object.fromEntries(SENSORS.map((s) => [s.id, { excess: 0, hum: 0 }]))

  return {
    step(dtSec, target) {
      for (const s of SENSORS) {
        const st = state[s.id]
        if (target > 0) {
          st.excess += (target - st.excess) * (1 - Math.exp(-dtSec / s.tauOpen))
          st.hum += (18 - st.hum) * (1 - Math.exp(-dtSec / 150))
        } else {
          st.excess *= Math.exp(-dtSec / s.tauClose)
          st.hum *= Math.exp(-dtSec / 400)
        }
      }
    },
    read(t, doorOpen) {
      const angle = (2 * Math.PI * t) / CYCLE_MS
      const timestamp = new Date(t).toISOString()
      return SENSORS.map((s) => {
        const st = state[s.id]
        const tempF =
          s.baseF + st.excess + 0.5 * Math.sin(angle + s.phase) + (Math.random() - 0.5) * 0.16
        const humidity =
          s.baseHum + st.hum + 1.2 * Math.sin(angle + s.phase + 1) + (Math.random() - 0.5) * 0.8
        return {
          device_id: DEVICE_ID,
          sensor_id: s.id,
          temp_c: round((tempF - 32) / 1.8, 2),
          humidity: round(humidity, 1),
          door_open: doorOpen,
          timestamp,
        }
      })
    },
  }
}

function historyEvents(now) {
  const events = [
    { start: now - 9 * 3600e3, duration: 25 * 60e3, target: AJAR_TARGET }, // door left ajar
    { start: now - 38 * 60e3, duration: 4 * 60e3, target: OPEN_TARGET }, // long restock
  ]
  let t = now - HISTORY_MS
  while (t < now - 5 * 60e3) {
    t += -Math.log(1 - Math.random()) * 35 * 60e3
    events.push({ start: t, duration: (10 + Math.random() * 35) * 1e3, target: OPEN_TARGET })
  }
  return events
}

export function createSimulator() {
  const model = createModel()
  let manualOpen = false

  return {
    simulated: true,

    // One sample per minute for the past 24 hours.
    async loadHistory() {
      const now = Date.now()
      const events = historyEvents(now)
      const targetAt = (t) =>
        events.reduce((max, e) => (t >= e.start && t < e.start + e.duration ? Math.max(max, e.target) : max), 0)

      const readings = []
      const stepMs = 10e3
      let openThisMinute = false
      let step = 0
      for (let t = now - HISTORY_MS; t < now - LIVE_INTERVAL_MS; t += stepMs) {
        const target = targetAt(t)
        model.step(stepMs / 1000, target)
        openThisMinute ||= target > 0
        if (++step % 6 === 0) {
          readings.push(...model.read(t, openThisMinute))
          openThisMinute = false
        }
      }
      return readings
    },

    subscribe(onReadings) {
      let last = Date.now()
      let randomOpenUntil = 0
      const timer = setInterval(() => {
        const now = Date.now()
        if (!manualOpen && now > randomOpenUntil && Math.random() < 2 / 900) {
          randomOpenUntil = now + (10 + Math.random() * 30) * 1e3
        }
        const open = manualOpen || now < randomOpenUntil
        model.step((now - last) / 1000, open ? OPEN_TARGET : 0)
        last = now
        onReadings(model.read(now, open))
      }, LIVE_INTERVAL_MS)
      return () => clearInterval(timer)
    },

    setDoorOpen(open) {
      manualOpen = open
    },
  }
}
