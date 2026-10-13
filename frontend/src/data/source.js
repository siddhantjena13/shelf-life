import { createSimulator } from './simulator.js'

// The one place the dashboard gets readings from. To go live, return an object
// with the same shape backed by the FastAPI backend:
//   loadHistory(): Promise<Reading[]>            e.g. GET /readings?since=...
//   subscribe(onReadings): () => void            e.g. polling or a WebSocket
// where Reading = { device_id, sensor_id, temp_c, humidity, door_open, timestamp }
export function createSource() {
  return createSimulator()
}
