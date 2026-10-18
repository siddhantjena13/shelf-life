import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { FRESHNESS, FRESHNESS_ORDER, freshnessColor } from '../lib/food.js'

export function AiMark({ title = 'Filled in from the photo' }) {
  return (
    <span className="ai-mark" title={title} aria-label={title}>
      <Sparkles size={11} />
    </span>
  )
}

export function FreshnessMeter({ level, size = 'md' }) {
  const rank = level ? FRESHNESS[level].rank : 0
  return (
    <span
      className={`fresh-meter fresh-meter-${size}`}
      role="img"
      aria-label={level ? `Observed appearance: ${FRESHNESS[level].label}` : 'Appearance not rated'}
      style={{ '--level': level ? freshnessColor(level) : 'var(--border)' }}
    >
      {[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= rank ? 'on' : ''} />)}
    </span>
  )
}

export function FreshnessPill({ level }) {
  if (!level) return <span className="fresh-pill unrated">Not rated</span>
  return (
    <span className="fresh-pill" style={{ '--level': freshnessColor(level) }}>
      <span className="fresh-dot" />
      {FRESHNESS[level].label}
    </span>
  )
}

export function FreshnessPicker({ value, onChange, suggested }) {
  return (
    <div className="freshness-picker">
      <div className="fresh-options" role="radiogroup" aria-label="How fresh it looks">
        {FRESHNESS_ORDER.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={value === level}
            className={`fresh-option ${value === level ? 'selected' : ''}`}
            style={{ '--level': freshnessColor(level) }}
            onClick={() => onChange(value === level ? null : level)}
          >
            <span className="fresh-dot" />
            {FRESHNESS[level].label}
            {suggested === level && <AiMark title="Perceptron's rating" />}
          </button>
        ))}
      </div>
      <p className="field-help">{value ? FRESHNESS[value].hint : 'Not rated yet. Pick the closest match, or leave it blank.'}</p>
    </div>
  )
}

// A step chart of freshness across checks, oldest to newest.
export function FreshnessTrend({ checks }) {
  const points = checks.filter((c) => c.freshness)
  if (points.length < 2) return null
  const w = 240
  const h = 56
  const pad = 6
  const t0 = Date.parse(points[0].at)
  const span = Math.max(Date.parse(points[points.length - 1].at) - t0, 1)
  const x = (c) => pad + ((Date.parse(c.at) - t0) / span) * (w - pad * 2)
  const y = (c) => pad + ((5 - FRESHNESS[c.freshness].rank) / 4) * (h - pad * 2)
  const path = points.map((c, i) => `${i ? 'L' : 'M'}${x(c).toFixed(1)},${y(c).toFixed(1)}`).join(' ')
  return (
    <svg className="fresh-trend" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Observed appearance over time">
      {[1, 2, 3, 4, 5].map((rank) => {
        const yy = pad + ((5 - rank) / 4) * (h - pad * 2)
        return <line key={rank} x1={pad} x2={w - pad} y1={yy} y2={yy} className="fresh-trend-grid" />
      })}
      <path d={path} className="fresh-trend-line" />
      {points.map((c) => (
        <circle key={c.id} cx={x(c)} cy={y(c)} r="4" fill={freshnessColor(c.freshness)} className="fresh-trend-dot">
          <title>{`${FRESHNESS[c.freshness].label} · ${new Date(c.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}</title>
        </circle>
      ))}
    </svg>
  )
}

const SCAN_STEPS = ['Finding the food', 'Checking how fresh it looks', 'Looking for a printed date']

export function ScanningPreview({ src, label = 'Perceptron is looking' }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setStep((n) => (n + 1) % SCAN_STEPS.length), 1500)
    return () => clearInterval(timer)
  }, [])
  return (
    <div className="scanning">
      <img src={src} alt="Photo being analyzed" />
      <div className="scan-grid" aria-hidden="true" />
      <div className="scan-beam" aria-hidden="true" />
      <div className="scan-status" role="status">
        <Sparkles size={15} />
        <span>{label}</span>
        <small key={step}>{SCAN_STEPS[step]}…</small>
      </div>
    </div>
  )
}
