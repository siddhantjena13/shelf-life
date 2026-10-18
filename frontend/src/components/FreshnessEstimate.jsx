import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Calendar, Camera, Droplets, EyeOff, Thermometer } from 'lucide-react'
import { DATE_KINDS, formatHours, formatHoursRange } from '../lib/food.js'
import { ITEM_STATUS, PROFILES } from '../lib/risk.js'
import StatusBadge from './StatusBadge.jsx'

const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 11 }

function xTicks(horizon, useDays) {
  const step = useDays
    ? [1, 2, 3, 5, 7, 14].find((d) => horizon / 24 / d <= 5) * 24
    : [3, 6, 12, 24].find((h) => horizon / h <= 5)
  const ticks = []
  for (let t = 0; t <= horizon + 1e-6; t += step) ticks.push(t)
  return ticks
}

function SurvivalTooltip({ active, payload, useDays }) {
  if (!active || !payload?.length) return null
  const { h, p } = payload[0].payload
  return (
    <div className="tooltip">
      <div className="tooltip-time">{h === 0 ? 'Now' : `In ${useDays ? formatHours(h) : `${Math.round(h)} h`}`}</div>
      <div className="tooltip-row"><strong>{Math.round(p)}%</strong><span>chance it’s still good</span></div>
    </div>
  )
}

export function SurvivalChart({ survival, medianHours }) {
  const data = survival.map(([h, p]) => ({ h, p: p * 100 }))
  const horizon = data[data.length - 1].h
  const useDays = horizon > 48
  const showMedian = medianHours > 0 && medianHours < horizon

  return (
    <figure className="survival">
      <figcaption>Chance it’s still good</figcaption>
      <ResponsiveContainer width="100%" height={150}>
        <AreaChart data={data} margin={{ top: 14, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis
            dataKey="h"
            type="number"
            domain={[0, horizon]}
            ticks={xTicks(horizon, useDays)}
            tickFormatter={(h) => (h === 0 ? 'Now' : useDays ? `${Math.round(h / 24)}d` : `${Math.round(h)}h`)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--axis)' }}
          />
          <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v) => `${v}%`} tick={AXIS_TICK} width={40} tickLine={false} axisLine={false} />
          <Tooltip content={<SurvivalTooltip useDays={useDays} />} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} isAnimationActive={false} />
          <Area
            type="monotone"
            dataKey="p"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="var(--accent)"
            fillOpacity={0.1}
            dot={false}
            activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
          {showMedian && (
            <ReferenceDot
              x={medianHours}
              y={50}
              r={4}
              fill="var(--accent)"
              stroke="var(--surface)"
              strokeWidth={2}
              // Above and right of the dot is always clear: the curve only falls.
              label={{ value: 'Median', position: 'right', offset: 6, dy: -11, fill: 'var(--text-secondary)', fontSize: 11 }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
      <table className="visually-hidden">
        <caption>Chance the item is still good over time</caption>
        <thead><tr><th>From now</th><th>Chance still good</th></tr></thead>
        <tbody>
          {data.filter((_, i) => i % 4 === 0).map((row) => (
            <tr key={row.h}><td>{formatHours(row.h)}</td><td>{Math.round(row.p)}%</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

function baselineText(item, risk) {
  if (risk.baseline?.source === 'date') {
    const kind = DATE_KINDS[risk.baseline.kind] ?? 'Printed'
    const note = {
      use_by: 'followed as printed',
      expires: 'followed as printed',
      best_by: 'quality usually holds a little past it',
      sell_by: 'plus the USDA storage time after a sell-by date',
    }[risk.baseline.kind]
    return `${kind} date: about ${formatHours(risk.baseline.hours)} from when it went in (${note})`
  }
  const [lo, hi] = risk.baseline?.days ?? []
  return `USDA FoodKeeper: ${lo}–${hi} days for ${PROFILES[item.profile].label.toLowerCase()} at 40°F`
}

function drivers(item, risk) {
  const rows = [{ Icon: Calendar, text: baselineText(item, risk) }]

  const extra = risk.equivalentHours - risk.elapsedHours
  rows.push({
    Icon: Thermometer,
    text: Math.abs(extra) < 0.5
      ? 'Fridge temperature has matched 40°F storage'
      : extra > 0
        ? `Warm spells used ${formatHours(extra)} more than 40°F storage would have`
        : `Cold storage has saved ${formatHours(-extra)} compared with 40°F`,
  })

  if (risk.waterLimitPct) {
    rows.push({
      Icon: Droplets,
      text: `Lost about ${risk.waterLossPct.toFixed(1)}% of its weight to dry air; it wilts around ${risk.waterLimitPct}%`
        + (item.packaged ? '' : ' (a bag would slow this)'),
    })
  }

  rows.push({
    Icon: Camera,
    text: risk.checksUsed === 0
      ? 'No freshness checks yet. Re-log it with a photo to sharpen this estimate'
      : `${risk.checksUsed} freshness check${risk.checksUsed === 1 ? '' : 's'} `
        + (Math.abs(risk.checksShiftHours) < 1
          ? 'agreed with the sensors'
          : `moved the estimate ${formatHours(Math.abs(risk.checksShiftHours))} ${risk.checksShiftHours < 0 ? 'earlier' : 'later'}`),
  })

  if (risk.gapHours >= 0.5) {
    rows.push({ Icon: EyeOff, text: `${formatHours(risk.gapHours)} without sensor readings, assumed to be a typical fridge` })
  }
  return rows
}

const LIMITING = {
  temperature: 'Aging from temperature ends its shelf life first.',
  water: 'Water loss will end its shelf life before anything else.',
  date: 'Its use-by date comes first, and that is when it should be used by.',
}

export default function FreshnessEstimate({ item, risk }) {
  if (!risk || risk.scoringMode !== 'backend' || !risk.survival) {
    return (
      <section className="estimate">
        <small className="estimate-label">Freshness estimate</small>
        <p className="muted">Connecting to the freshness model…</p>
      </section>
    )
  }
  const status = ITEM_STATUS[risk.status]
  const past = risk.pSpoiled >= 0.5
  // A use-by date is a hard stop, so every scenario ends at the same moment.
  const showRange = risk.remainingHigh - risk.remainingLow >= Math.max(1, 0.1 * risk.remainingHours)

  return (
    <section className="estimate">
      <div className="estimate-head">
        <small className="estimate-label">Freshness estimate</small>
        <StatusBadge level={status.level} label={status.label} />
      </div>
      <div className="estimate-hero">
        {past ? (
          <span className="estimate-value">Likely past its best</span>
        ) : (
          <>
            <span className="estimate-value">About {formatHours(risk.remainingHours)}</span>
            <span className="estimate-unit">left</span>
          </>
        )}
      </div>
      <p className="estimate-sub">
        {!past && showRange && <>Likely {formatHoursRange(risk.remainingLow, risk.remainingHigh)} · </>}
        {risk.pSpoiled < 0.01 ? 'Under 1%' : `${Math.round(risk.pSpoiled * 100)}%`} chance it’s already past its best.{' '}
        {LIMITING[risk.limiting]}
      </p>

      <SurvivalChart survival={risk.survival} medianHours={past ? 0 : risk.remainingHours} />

      <ul className="drivers">
        {drivers(item, risk).map(({ Icon, text }) => (
          <li key={text}><Icon size={15} aria-hidden="true" />{text}</li>
        ))}
      </ul>
    </section>
  )
}
