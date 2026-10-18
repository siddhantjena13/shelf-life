import test from 'node:test'
import assert from 'node:assert/strict'
import { createTemperatureWarningTracker } from './temperatureWarning.js'

const sensor = (at, tempF = 46) => ({ id: 'top', label: 'Top', at, tempF })

test('requires 15 seconds above 45, fires once, and rearms after cooling', () => {
  const step = createTemperatureWarningTracker()
  for (const at of [0, 3000, 6000, 9000, 12000]) assert.equal(step([sensor(at)], at).length, 0)
  assert.equal(step([sensor(15000)], 15000).length, 1)
  assert.equal(step([sensor(18000)], 18000).length, 0)
  assert.equal(step([sensor(21000, 45)], 21000).length, 0)
  for (const at of [24000, 27000, 30000, 33000, 36000]) step([sensor(at)], at)
  assert.equal(step([sensor(39000)], 39000).length, 1)
})

test('stale readings and interrupted warm spells never establish continuous warmth', () => {
  const step = createTemperatureWarningTracker()
  step([sensor(0)], 0)
  assert.equal(step([sensor(0)], 16000).length, 0)
  assert.equal(step([sensor(18000)], 18000).length, 0)
  step([sensor(21000, 44)], 21000)
  assert.equal(step([sensor(24000)], 24000).length, 0)
  assert.equal(step([sensor(45000)], 45000).length, 0)
})
