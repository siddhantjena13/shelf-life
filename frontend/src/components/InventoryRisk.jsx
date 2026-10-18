import { Camera, ChevronRight } from 'lucide-react'
import { formatHours } from '../lib/food.js'
import { ITEM_STATUS } from '../lib/risk.js'
import { FreshnessPill } from './Freshness.jsx'
import { FoodThumb } from './FoodCard.jsx'
import StatusBadge, { StatusIcon } from './StatusBadge.jsx'

const ORDER = ['good', 'soon', 'risk', 'expired', 'discard']
const COLORS = {
  good: 'var(--status-good)',
  soon: 'var(--status-warning)',
  risk: 'var(--status-critical)',
  expired: 'var(--status-critical)',
  discard: 'var(--status-critical)',
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
            <circle key={id} cx="60" cy="60" r={R} fill="none" stroke={COLORS[id]} strokeWidth={STROKE}
              strokeDasharray={`${Math.max(length - GAP, 0)} ${CIRC}`} strokeDashoffset={-offset}>
              <title>{`${ITEM_STATUS[id].label}: ${counts[id]}`}</title>
            </circle>
          )
          offset += length
          return segment
        })}
      </g>
      <text x="60" y="58" textAnchor="middle" className="donut-value">{total}</text>
      <text x="60" y="74" textAnchor="middle" className="donut-label">items</text>
    </svg>
  )
}

export default function InventoryRisk({ items, inventoryStatus, onLog, onOpenItem, onOpenInventory, riskActive, riskError }) {
  const counts = Object.fromEntries(ORDER.map((id) => [id, items.filter((item) => {
    if (id === 'soon') return ['soon', 'use_soon'].includes(item.status)
    if (id === 'risk') return ['risk', 'at_risk'].includes(item.status)
    return item.status === id
  }).length]))

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Inventory risk</h2>
        <button className="btn" onClick={onLog}><Camera size={15} /> Log food</button>
      </div>
      <p className={`risk-engine-note ${riskActive ? 'active' : ''}`} role="status">
        {riskActive ? 'Full exposure model connected' : riskError ? 'Backend risk engine offline · showing a preview estimate' : 'Connecting to the backend risk engine…'}
      </p>
      <div className="donut-row">
        <Donut counts={counts} total={items.length} />
        <ul className="donut-legend">
          {ORDER.map((id) => <li key={id}><StatusIcon level={ITEM_STATUS[id].level} />{ITEM_STATUS[id].label}<strong>{counts[id]}</strong></li>)}
        </ul>
      </div>

      {items.length === 0 ? (
        <p className="empty-inventory">
          {inventoryStatus === 'error' ? 'The inventory is unavailable until the backend is running.' : 'No food yet. Log an item with a photo to get started.'}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Item</th><th>Looks</th><th>Zone</th><th className="num">Freshness</th><th>Status</th><th><span className="visually-hidden">Open</span></th></tr></thead>
            <tbody>{items.map((item) => (
              <tr key={item.id} className="clickable-row" onClick={() => onOpenItem(item.id)}>
                <td>
                  <span className="item-cell">
                    <FoodThumb item={item} size={28} />
                    <span>
                      {item.name}
                      {item.gapHours >= 0.1 && <span className="data-gap">{`${item.gapHours.toFixed(1)}h unobserved`}</span>}
                    </span>
                  </span>
                </td>
                <td><FreshnessPill level={item.freshness} /></td>
                <td className="muted">{item.zoneLabel}</td>
                <td className="num strong">
                  {item.score}
                  {item.scoringMode === 'preview' && <small className="remaining-hours">Preview</small>}
                  {item.scoringMode === 'backend' && Number.isFinite(item.remainingHours) && <small className="remaining-hours">{`~${formatHours(item.remainingHours)} left`}</small>}
                </td>
                <td><StatusBadge level={ITEM_STATUS[item.status].level} label={ITEM_STATUS[item.status].label} /></td>
                <td>
                  <button className="row-open" aria-label={`Open ${item.name}`} onClick={(e) => { e.stopPropagation(); onOpenItem(item.id) }}>
                    <ChevronRight size={16} />
                  </button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="panel-foot">
        <p className="caption">Expected share of shelf life left, from printed dates, sensor history and freshness checks.</p>
        <button className="text-link" onClick={onOpenInventory}>Open inventory <ChevronRight size={14} /></button>
      </div>
    </section>
  )
}
