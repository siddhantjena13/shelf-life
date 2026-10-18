// Match the risk engine's one-minute averages per zone, leaving raw readings
// available to charts, door events, and live sensor status.
export function summarizeReadings(readings) {
  const zones = new Map()
  for (const reading of readings) {
    let buckets = zones.get(reading.sensor_id)
    if (!buckets) zones.set(reading.sensor_id, (buckets = new Map()))
    const t = Date.parse(reading.timestamp)
    const minute = Math.floor(t / 60_000)
    let bucket = buckets.get(minute)
    if (!bucket) buckets.set(minute, (bucket = { n: 0, t: 0, temp: 0, humidity: 0 }))
    bucket.n++
    bucket.t += t
    bucket.temp += reading.temp_c
    bucket.humidity += reading.humidity
  }
  const result = []
  for (const [sensor_id, buckets] of zones) {
    for (const bucket of buckets.values()) {
      result.push({ sensor_id, timestamp: new Date(Math.floor(bucket.t / bucket.n)).toISOString(),
        temp_c: bucket.temp / bucket.n, humidity: bucket.humidity / bucket.n })
    }
  }
  return result.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}
