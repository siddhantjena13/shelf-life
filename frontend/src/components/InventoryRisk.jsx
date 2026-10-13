import { ITEM_STATUS } from '../lib/risk.js'
import StatusBadge, { StatusIcon } from './StatusBadge.jsx'

const ORDER = ['good', 'soon', 'risk']
const COLORS = {
  good: 'var(--status-good)',
  soon: 'var(--status-warning)',
  risk: 'var(--status-critical)',
}

const R = 42
const STROKE = 14
const CIRC = 2 * Math.PI * R
const GAP = 2

function Donut({ counts, total }) {
  let offset = 0
  return (
    <svg viewBox="0 0 120 120" className="donut" role="img" aria-label="Items by status">
      <g transform="rotate(-90 60 60)">
        {ORDER.filter((id) => counts[id] > 0).map((id) => {
          const length = (counts[id] / total) * CIRC
          const segment = (
            <circle
              key={id}
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={COLORS[id]}
              strokeWidth={STROKE}
              strokeDasharray={`${Math.max(length - GAP, 0)} ${CIRC}`}
              strokeDashoffset={-offset}
            >
              <title>{`${ITEM_STATUS[id].label}: ${counts[id]}`}</title>
            </circle>
          )
          offset += length
          return segment
        })}
      </g>
      <text x="60" y="58" textAnchor="middle" className="donut-value">
        {total}
      </text>
      <text x="60" y="74" textAnchor="middle" className="donut-label">
        items
      </text>
    </svg>
  )
}

export default function InventoryRisk({ items }) {
  const counts = Object.fromEntries(ORDER.map((id) => [id, items.filter((i) => i.status === id).length]))

  return (
    <section className="panel">
      <h2>Inventory risk</h2>
      <div className="donut-row">
        <Donut counts={counts} total={items.length} />
        <ul className="donut-legend">
          {ORDER.map((id) => (
            <li key={id}>
              <StatusIcon level={ITEM_STATUS[id].level} />
              {ITEM_STATUS[id].label}
              <strong>{counts[id]}</strong>
            </li>
          ))}
        </ul>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Profile</th>
            <th>Zone</th>
            <th className="num">Score</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.name}</td>
              <td className="muted">{item.profileLabel}</td>
              <td className="muted">{item.zoneLabel}</td>
              <td className="num strong">{item.score}</td>
              <td>
                <StatusBadge level={ITEM_STATUS[item.status].level} label={ITEM_STATUS[item.status].label} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="caption">Storage-quality score out of 100, from exposure over the last 24 hours</p>
    </section>
  )
}
