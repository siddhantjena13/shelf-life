import { SAFE_LIMIT_F, DANGER_LIMIT_F } from '../config.js'
import { formatDuration } from '../lib/metrics.js'
import StatusBadge from './StatusBadge.jsx'

const BANDS = [
  { id: 'safe', label: `At or below ${SAFE_LIMIT_F}°F`, color: 'var(--status-good)' },
  { id: 'caution', label: `${SAFE_LIMIT_F}–${DANGER_LIMIT_F}°F`, color: 'var(--status-warning)' },
  { id: 'danger', label: `Above ${DANGER_LIMIT_F}°F`, color: 'var(--status-critical)' },
]

export default function StorageConditions({ zones, tempF, humidity, bands, rangeLabel }) {
  const total = BANDS.reduce((sum, b) => sum + bands[b.id], 0) || 1
  const share = (id) => (bands[id] / total) * 100

  return (
    <section className="panel">
      <h2>Storage conditions</h2>
      <div className="hero">
        <span className="hero-value">{tempF.toFixed(1)}°F</span>
        <span className="hero-label">average now · {Math.round(humidity)}% humidity</span>
      </div>

      <div className="band-bar" role="img" aria-label={`Share of the last ${rangeLabel} in each temperature band`}>
        {BANDS.filter((b) => bands[b.id] > 0).map((b) => (
          <span
            key={b.id}
            style={{ flexGrow: bands[b.id], background: b.color }}
            title={`${b.label}: ${share(b.id).toFixed(0)}%`}
          />
        ))}
      </div>
      <ul className="band-legend">
        {BANDS.map((b) => (
          <li key={b.id}>
            <span className="swatch" style={{ background: b.color }} />
            {b.label}
            <strong>{share(b.id).toFixed(0)}%</strong>
          </li>
        ))}
      </ul>
      <p className="caption">Warmest zone, share of the last {rangeLabel}</p>

      <table className="table">
        <thead>
          <tr>
            <th>Zone</th>
            <th className="num">Temp</th>
            <th className="num">Humidity</th>
            <th>Status</th>
            <th className="num">Above {SAFE_LIMIT_F}°F</th>
          </tr>
        </thead>
        <tbody>
          {zones.map((z) => (
            <tr key={z.id}>
              <td>
                <span className="line-key" style={{ background: z.color }} />
                {z.label}
              </td>
              <td className="num strong">{Number.isFinite(z.tempF) ? `${z.tempF.toFixed(1)}°F` : '–'}</td>
              <td className="num">{Number.isFinite(z.humidity) ? `${Math.round(z.humidity)}%` : '–'}</td>
              <td>
                <StatusBadge level={z.status.level} label={z.status.label} />
              </td>
              <td className="num muted">{formatDuration(z.aboveMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
