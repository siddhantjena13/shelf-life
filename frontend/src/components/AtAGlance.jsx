import { ZONES, SAFE_LIMIT_F } from '../config.js'
import { formatDuration } from '../lib/metrics.js'

export default function AtAGlance({ rangeLabel, longestMs, avgHumidity, doorCount, sensorsOnline }) {
  const tiles = [
    { value: longestMs > 0 ? formatDuration(longestMs) : 'None', label: `longest stretch above ${SAFE_LIMIT_F}°F` },
    { value: `${Math.round(avgHumidity)}%`, label: 'average humidity' },
    { value: doorCount, label: doorCount === 1 ? 'door opening' : 'door openings' },
    { value: `${sensorsOnline}/${ZONES.length}`, label: 'sensors reporting' },
  ]

  return (
    <section className="panel">
      <h2>At a glance</h2>
      <div className="tiles">
        {tiles.map((tile) => (
          <div key={tile.label}>
            <div className="tile-value">{tile.value}</div>
            <div className="tile-label">{tile.label}</div>
          </div>
        ))}
      </div>
      <p className="caption">Over the last {rangeLabel}</p>
    </section>
  )
}
