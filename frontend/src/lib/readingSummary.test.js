import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeReadings } from './readingSummary.js'
import { createLiveSource } from '../data/live.js'

test('a full day of two sensors fits scoring limits without mixing zones or losing minute spikes', () => {
  const start = Date.UTC(2026, 9, 18)
  const readings = Array.from({ length: 57600 }, (_, i) => ({
    sensor_id: i % 2 ? 'bottom' : 'top',
    timestamp: new Date(start + Math.floor(i / 2) * 3000).toISOString(),
    temp_c: i % 2 ? 2 : (i < 40 ? 12 : 4), humidity: i % 2 ? 80 : 60,
  }))
  const before = performance.now()
  const summary = summarizeReadings(readings)
  console.log(`Summarized ${readings.length} readings to ${summary.length} in ${(performance.now() - before).toFixed(1)} ms`)
  assert.equal(summary.length, 2880)
  assert.equal(summary[0].sensor_id, 'top')
  assert.equal(summary[0].temp_c, 12)
  assert.equal(summary[1].temp_c, 2)
  assert.equal(summary[1].humidity, 80)
  assert.equal(summary[0].timestamp, new Date(start + 28500).toISOString())
  assert.deepEqual(summarizeReadings([]), [])
})

test('live source loads every history page with stable snapshot parameters', async () => {
  const original = globalThis.fetch
  const paths = []
  globalThis.fetch = async path => {
    paths.push(path)
    const second = paths.length === 2
    return { ok: true, json: async () => ({
      readings: [{id: second ? 2 : 1}], hasMore: !second,
      nextAfterId: second ? 2 : 1, untilId: 2, sinceMs: 123,
    }) }
  }
  try {
    assert.deepEqual(await createLiveSource().loadHistory(), [{id: 1}, {id: 2}])
    assert.equal(paths[1], '/api/readings/history?after_id=1&until_id=2&since_ms=123')
  } finally {
    globalThis.fetch = original
  }
})
