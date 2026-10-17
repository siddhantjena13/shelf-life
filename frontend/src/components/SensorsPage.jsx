import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CheckCircle2, Clock3, Thermometer, Wifi, WifiOff } from 'lucide-react'
import { OFFLINE_AFTER_MS, SAFE_LIMIT_F, ZONES } from '../config.js'

const fmtTime = (value) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function SensorTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return <div className="tooltip"><div className="tooltip-time">{fmtTime(label)}</div>{payload.map((entry) => <div className="tooltip-row" key={entry.dataKey}><span className="line-key" style={{ background: entry.color }} /><strong>{entry.value?.toFixed(1)}°F</strong><span>{entry.name}</span></div>)}</div>
}

export default function SensorsPage({ samples, rawReadings, now, range }) {
  const sensors = useMemo(() => ZONES.map((zone) => {
    const reading = [...rawReadings].reverse().find((entry) => entry.sensor_id === zone.id)
    const at = reading ? Date.parse(reading.timestamp) : null
    return {
      ...zone,
      tempF: Number.isFinite(reading?.temp_c) ? reading.temp_c * 1.8 + 32 : null,
      humidity: reading?.humidity,
      at,
      online: at !== null && now - at < OFFLINE_AFTER_MS * 3,
    }
  }), [rawReadings, now])
  const from = now - range.ms
  const chartRows = samples.filter((sample) => sample.t >= from).map((sample) => ({
    t: sample.t,
    ...Object.fromEntries(ZONES.map((zone) => [zone.id, sample.zones[zone.id]?.tempF])),
  }))
  const connected = sensors.filter((sensor) => sensor.online).length
  const avgTemp = sensors.filter((sensor) => Number.isFinite(sensor.tempF)).reduce((sum, sensor, _, all) => sum + sensor.tempF / all.length, 0)

  return <section className="panel tab-panel">
    <div className="tab-intro"><div><h2>Sensor status</h2><p>Live temperature and humidity by storage zone.</p></div><span className={`status-pill ${connected === ZONES.length ? 'good' : connected ? 'warning' : 'critical'}`}>{connected === ZONES.length ? <Wifi size={15} /> : <WifiOff size={15} />}{connected}/{ZONES.length} online</span></div>
    <div className="metric-cards">
      <div className="metric-card"><span>Connected sensors</span><strong>{connected}<small> / {ZONES.length}</small></strong><Wifi size={17} /></div>
      <div className="metric-card"><span>Average temperature</span><strong>{Number.isFinite(avgTemp) ? `${avgTemp.toFixed(1)}°F` : '—'}</strong><Thermometer size={17} /></div>
      <div className="metric-card"><span>Safe limit</span><strong>{SAFE_LIMIT_F}°F</strong><CheckCircle2 size={17} /></div>
      <div className="metric-card"><span>Last update</span><strong>{sensors.some((sensor) => sensor.at !== null) ? `${Math.max(0, Math.round((now - Math.max(...sensors.map((sensor) => sensor.at ?? 0))) / 1000))}s ago` : 'Waiting'}</strong><Clock3 size={17} /></div>
    </div>
    <div className="sensor-grid">
      {sensors.map((sensor) => <article className="sensor-card" key={sensor.id}>
        <div className="sensor-card-head"><span className="sensor-marker" style={{ background: sensor.color }} /><div><strong>{sensor.label} zone</strong><small>Sensor · {sensor.id}</small></div><span className={`sensor-connection ${sensor.online ? 'online' : ''}`} title={sensor.online ? 'Online' : 'Offline'} /></div>
        <div className={`sensor-temperature ${Number.isFinite(sensor.tempF) && sensor.tempF > SAFE_LIMIT_F ? 'over-limit' : ''}`}>{Number.isFinite(sensor.tempF) ? `${sensor.tempF.toFixed(1)}°` : '—'}<small>F</small></div>
        <div className="sensor-details"><span>Humidity <strong>{Number.isFinite(sensor.humidity) ? `${sensor.humidity.toFixed(0)}%` : '—'}</strong></span><span>{sensor.online ? 'Reporting' : 'No recent reading'}</span></div>
        {Number.isFinite(sensor.tempF) && <div className="sensor-limit-note">{sensor.tempF > SAFE_LIMIT_F ? `Above ${SAFE_LIMIT_F}°F safe limit` : `Within ${SAFE_LIMIT_F}°F safe limit`}</div>}
      </article>)}
    </div>
    <div className="sensor-chart-section">
      <div className="panel-head"><h2>Temperature history</h2><span className="caption">Last {range.label}</span></div>
      {chartRows.length ? <figure className="chart sensor-chart"><ResponsiveContainer width="100%" height={280}><AreaChart data={chartRows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <defs>{ZONES.map((zone) => <linearGradient key={zone.id} id={`sensor-fill-${zone.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={zone.color} stopOpacity={0.18} /><stop offset="100%" stopColor={zone.color} stopOpacity={0} /></linearGradient>)}</defs>
        <CartesianGrid vertical={false} stroke="var(--grid)" /><XAxis dataKey="t" type="number" domain={[from, now]} tickFormatter={fmtTime} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} minTickGap={40} /><YAxis domain={['dataMin - 2', 'dataMax + 2']} tickFormatter={(value) => `${value}°`} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} width={44} tickLine={false} axisLine={false} /><ReferenceLine y={SAFE_LIMIT_F} stroke="var(--limit)" strokeDasharray="5 4" /><Tooltip content={<SensorTooltip />} isAnimationActive={false} />{ZONES.map((zone) => <Area key={zone.id} type="monotone" dataKey={zone.id} name={zone.label} stroke={zone.color} strokeWidth={2} fill={`url(#sensor-fill-${zone.id})`} dot={false} connectNulls isAnimationActive={false} />)}</AreaChart></ResponsiveContainer></figure> : <div className="empty-state">Sensor readings will appear here when the device reports data.</div>}
      <ul className="legend">{ZONES.map((zone) => <li key={zone.id}><span className="line-key" style={{ background: zone.color }} />{zone.label}</li>)}<li><span className="limit-key" />{SAFE_LIMIT_F}°F safe limit</li></ul>
    </div>
  </section>
}
