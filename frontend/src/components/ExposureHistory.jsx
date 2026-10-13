import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ZONES, SAFE_LIMIT_F } from '../config.js'
import { formatClock, formatDuration } from '../lib/metrics.js'

const SYNC_ID = 'exposure'
const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 12 }

// Ticks on round local clock times (:00, :10, ...) rather than round epoch values.
function timeTicks(start, end, stepMs) {
  const offset = new Date(end).getTimezoneOffset() * 60e3
  const ticks = []
  for (let t = Math.ceil((start - offset) / stepMs) * stepMs + offset; t <= end; t += stepMs) ticks.push(t)
  return ticks
}

function valueTicks(lo, hi) {
  const step = [1, 2, 5, 10, 20].find((s) => (hi - lo) / s <= 5) ?? 20
  const ticks = []
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v)
  return ticks
}

function extent(rows, suffix) {
  const values = rows.flatMap((r) => ZONES.map((z) => r[`${z.id}_${suffix}`])).filter(Number.isFinite)
  return [Math.min(...values), Math.max(...values)]
}

function ChartTooltip({ active, payload, label, unit, withSeconds }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="tooltip">
      <div className="tooltip-time">{formatClock(label, withSeconds)}</div>
      {ZONES.map((z) => {
        const entry = payload.find((p) => p.dataKey.startsWith(`${z.id}_`))
        if (!entry) return null
        return (
          <div key={z.id} className="tooltip-row">
            <span className="line-key" style={{ background: z.color }} />
            <strong>
              {row[entry.dataKey].toFixed(1)}
              {unit}
            </strong>
            <span>{z.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function EnvChart({ title, suffix, unit, rows, start, end, range, doors, domain, limit, height, showTimeAxis }) {
  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={rows} syncId={SYNC_ID} syncMethod="value" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {ZONES.map((z) => (
              <linearGradient key={z.id} id={`fill-${z.id}-${suffix}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={z.color} stopOpacity={0.14} />
                <stop offset="100%" stopColor={z.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis
            dataKey="t"
            type="number"
            domain={[start, end]}
            ticks={timeTicks(start, end, range.tickMs)}
            tickFormatter={(t) => formatClock(t)}
            tick={showTimeAxis ? AXIS_TICK : false}
            height={showTimeAxis ? 28 : 4}
            tickLine={false}
            axisLine={{ stroke: 'var(--axis)' }}
            allowDataOverflow
          />
          <YAxis
            domain={domain}
            ticks={valueTicks(...domain)}
            tickFormatter={(v) => `${v}${unit}`}
            tick={AXIS_TICK}
            width={48}
            tickLine={false}
            axisLine={false}
          />
          {doors.map((d) => (
            <ReferenceArea
              key={d.start}
              x1={Math.max(d.start, start)}
              x2={Math.min(Math.max(d.end, d.start + range.bucketMs), end)}
              fill="var(--text-primary)"
              fillOpacity={0.07}
              ifOverflow="hidden"
            />
          ))}
          {limit !== undefined && (
            <ReferenceLine y={limit} stroke="var(--limit)" strokeDasharray="5 4" />
          )}
          <Tooltip
            content={<ChartTooltip unit={unit} withSeconds={range.bucketMs < 60e3} />}
            cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
            isAnimationActive={false}
          />
          {ZONES.map((z) => (
            <Area
              key={z.id}
              type="monotone"
              dataKey={`${z.id}_${suffix}`}
              stroke={z.color}
              strokeWidth={2}
              fill={`url(#fill-${z.id}-${suffix})`}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  )
}

function DataTable({ rows, withSeconds }) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Time</th>
            {ZONES.map((z) => (
              <th key={z.id} className="num">
                {z.label} °F
              </th>
            ))}
            {ZONES.map((z) => (
              <th key={z.id} className="num">
                {z.label} %
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((r) => (
            <tr key={r.t}>
              <td>{formatClock(r.t, withSeconds)}</td>
              {ZONES.map((z) => (
                <td key={z.id} className="num">
                  {r[`${z.id}_t`]?.toFixed(1)}
                </td>
              ))}
              {ZONES.map((z) => (
                <td key={z.id} className="num">
                  {r[`${z.id}_h`]?.toFixed(1)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ExposureHistory({ rows, start, end, range, doors, aboveMs }) {
  const [view, setView] = useState('chart')

  const [tMin, tMax] = extent(rows, 't')
  const [hMin, hMax] = extent(rows, 'h')
  const tempDomain = [Math.floor(tMin - 1), Math.ceil(Math.max(tMax, SAFE_LIMIT_F + 1) + 1)]
  const humDomain = [Math.floor((hMin - 2) / 5) * 5, Math.ceil((hMax + 2) / 5) * 5]
  const shared = { rows, start, end, range, doors }

  return (
    <section className="panel panel-wide">
      <div className="panel-head">
        <h2>Exposure history</h2>
        <div className="segmented" role="group" aria-label="View">
          <button className={view === 'chart' ? 'selected' : ''} onClick={() => setView('chart')}>
            Chart
          </button>
          <button className={view === 'table' ? 'selected' : ''} onClick={() => setView('table')}>
            Table
          </button>
        </div>
      </div>

      <div className="headline">
        <div>
          <span className="headline-value">{formatDuration(aboveMs)}</span>
          <span className="headline-label">above {SAFE_LIMIT_F}°F</span>
        </div>
        <div>
          <span className="headline-value">{doors.length}</span>
          <span className="headline-label">door {doors.length === 1 ? 'opening' : 'openings'}</span>
        </div>
      </div>

      {view === 'table' ? (
        <DataTable rows={rows} withSeconds={range.bucketMs < 60e3} />
      ) : (
        <>
          <ul className="legend">
            {ZONES.map((z) => (
              <li key={z.id}>
                <span className="line-key" style={{ background: z.color }} />
                {z.label}
              </li>
            ))}
            <li>
              <span className="limit-key" />
              {SAFE_LIMIT_F}°F limit
            </li>
            <li>
              <span className="swatch door-swatch" />
              Door open
            </li>
          </ul>
          <EnvChart title="Temperature" suffix="t" unit="°" domain={tempDomain} limit={SAFE_LIMIT_F} height={240} {...shared} />
          <EnvChart title="Humidity" suffix="h" unit="%" domain={humDomain} height={188} showTimeAxis {...shared} />
        </>
      )}
    </section>
  )
}
