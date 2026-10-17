import { createSimulator } from './simulator.js'
import { createLiveSource } from './live.js'

// The one place the dashboard gets readings from.
//   live (default): readings the ESP32 devices post to the FastAPI backend
//   sim:            built-in simulator, for UI work without hardware or as a demo backup
// Pick with ?source=sim / ?source=live in the URL, or VITE_DATA_SOURCE=sim in frontend/.env.local.
// Reading = { device_id, sensor_id, temp_c, humidity, door_open, timestamp }
export function createSource() {
  const fromUrl = new URLSearchParams(window.location.search).get('source')
  const mode = fromUrl || import.meta.env.VITE_DATA_SOURCE || 'live'
  return mode === 'sim' ? createSimulator() : createLiveSource()
}
