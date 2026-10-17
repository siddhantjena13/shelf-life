// Live readings from the FastAPI backend (which the ESP32 devices post to).
// Same interface as the simulator, so the rest of the dashboard doesn't care
// where readings come from:
//   loadHistory(): Promise<Reading[]>    last 24 h, on page load
//   subscribe(onReadings): () => void    polls for new readings every POLL_MS
// Reading = { id, device_id, sensor_id, temp_c, humidity, door_open, timestamp }

const POLL_MS = 2000

async function getJson(path) {
  const response = await fetch(path, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return response.json()
}

export function createLiveSource() {
  let lastId = 0

  return {
    simulated: false,

    async loadHistory() {
      try {
        const rows = await getJson('/api/readings?hours=24')
        if (rows.length) lastId = rows[rows.length - 1].id
        return rows
      } catch (error) {
        console.warn('[live] could not load history; is the backend running?', error)
        return []
      }
    },

    subscribe(onReadings) {
      let stopped = false
      let timer

      const poll = async () => {
        try {
          const rows = await getJson(`/api/readings?after_id=${lastId}`)
          if (rows.length && !stopped) {
            lastId = rows[rows.length - 1].id
            onReadings(rows)
          }
        } catch (error) {
          console.warn('[live] poll failed; will retry', error)
        }
        if (!stopped) timer = setTimeout(poll, POLL_MS)
      }

      timer = setTimeout(poll, POLL_MS)
      return () => {
        stopped = true
        clearTimeout(timer)
      }
    },

    // Door state comes from hardware in live mode; nothing to simulate.
    setDoorOpen() {},
  }
}
