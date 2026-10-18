import { Camera, Check } from 'lucide-react'
import { photoUrl } from '../lib/api.js'
import { CATEGORIES, FRESHNESS, attention, expiryInfo, formatHours, storedFor, timeAgo, zoneLabel } from '../lib/food.js'
import { ITEM_STATUS } from '../lib/risk.js'
import { FreshnessMeter } from './Freshness.jsx'
import { StatusIcon } from './StatusBadge.jsx'

const R = 15
const CIRC = 2 * Math.PI * R

export function ScoreRing({ score, level, size = 40 }) {
  const value = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null
  return (
    <svg className="score-ring" width={size} height={size} viewBox="0 0 40 40" role="img"
      aria-label={value === null ? 'No storage score yet' : `Storage score ${value} out of 100`}>
      <circle cx="20" cy="20" r={R} className="score-ring-track" />
      {value !== null && (
        <circle cx="20" cy="20" r={R} className="score-ring-value" transform="rotate(-90 20 20)"
          style={{ stroke: `var(--status-${level === 'critical' ? 'critical' : level === 'warning' ? 'warning' : 'good'})` }}
          strokeDasharray={`${(value / 100) * CIRC} ${CIRC}`} />
      )}
      <text x="20" y="24.5" textAnchor="middle">{value ?? '–'}</text>
    </svg>
  )
}

export function FoodThumb({ item, size = 40 }) {
  const { Icon } = CATEGORIES[item.profile]
  return (
    <span className={`food-thumb tint-${item.profile}`} style={{ width: size, height: size }}>
      {item.photoId ? <img src={photoUrl(item.photoId)} alt="" loading="lazy" /> : <Icon size={size * 0.48} strokeWidth={1.6} />}
    </span>
  )
}

export default function FoodCard({ item, risk, now, onOpen, onRelog, onUsed, style }) {
  const { level, reasons } = attention(item, risk, now)
  const expiry = expiryInfo(item, now)
  const { Icon, short } = CATEGORIES[item.profile]
  const status = risk && ITEM_STATUS[risk.status]
  const modelled = risk?.scoringMode === 'backend'
  const left = !risk ? '—'
    : !modelled ? status.label
      : risk.pSpoiled >= 0.5 ? 'Past its best'
        : `~${formatHours(risk.remainingHours)}`

  return (
    <article className={`food-card attention-${level}`} style={style}>
      <button className="food-card-main" onClick={onOpen} aria-label={`${item.name}: open details`}>
        <div className={`food-photo tint-${item.profile} ${item.photoId ? 'has-photo' : ''}`}>
          {item.photoId
            ? <img src={photoUrl(item.photoId)} alt="" loading="lazy" />
            : <Icon size={44} strokeWidth={1.3} className="food-photo-icon" />}
          <span className="food-chip"><Icon size={13} /> {short}</span>
          {level !== 'good' && (
            <span className={`food-flag flag-${level}`}>
              <StatusIcon level={level} size={13} /> {reasons.find((r) => r.level === level).short}
            </span>
          )}
          {item.lastCheckedAt && <span className="food-checked">Checked {timeAgo(item.lastCheckedAt, now)}</span>}
        </div>

        <div className="food-body">
          <h3>{item.name}</h3>
          <p className="food-meta">
            {zoneLabel(item.zone)} shelf · {storedFor(item.addedAt, now)} in fridge{item.packaged && ' · sealed'}
          </p>

          <div className="food-fresh">
            <FreshnessMeter level={item.freshness} />
            <span>{item.freshness ? FRESHNESS[item.freshness].label : 'Not rated'}</span>
          </div>

          <div className="food-facts">
            <div>
              <small>Printed date</small>
              <strong className={expiry ? `text-${expiry.level}` : 'muted'}>
                {expiry ? `${expiry.kind} ${expiry.relative}` : 'None'}
              </strong>
            </div>
            <div className="food-score" title={modelled ? `Likely ${Math.round(risk.remainingLow)}–${Math.round(risk.remainingHigh)} h left` : undefined}>
              <ScoreRing score={risk?.score} level={status?.level} size={36} />
              <span>
                <small>{modelled && risk.pSpoiled < 0.5 ? 'Left' : 'Freshness'}</small>
                <strong>{left}</strong>
              </span>
            </div>
          </div>
        </div>
      </button>

      <div className="food-actions">
        <button className="btn btn-small" onClick={onRelog}><Camera size={15} /> Re-log</button>
        <button className="btn btn-small btn-quiet" onClick={onUsed}><Check size={15} /> Used it</button>
      </div>
    </article>
  )
}
