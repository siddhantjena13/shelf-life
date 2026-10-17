import { useMemo, useState } from 'react'
import { Bell, Check, CircleCheck, Clock3 } from 'lucide-react'
import { OFFLINE_AFTER_MS, SAFE_LIMIT_F } from '../config.js'
import { StatusIcon } from './StatusBadge.jsx'

export default function AlertsPage({ recommendations, sensors, now, riskActive }) {
  const [acknowledged, setAcknowledged] = useState({})
  const alerts = useMemo(() => {
    const current = recommendations.map((rec) => ({
      id: `rec:${rec.title}`,
      title: rec.title,
      reason: rec.reason,
      level: rec.level === 'critical' ? 'critical' : 'warning',
      source: 'Food safety',
    }))
    sensors.forEach((sensor) => {
      if (sensor.at === null || now - sensor.at >= OFFLINE_AFTER_MS * 3) {
        current.push({ id: `offline:${sensor.id}`, title: `${sensor.label} sensor is offline`, reason: 'No recent readings have arrived from this sensor.', level: 'critical', source: 'Sensor health' })
      } else if (sensor.tempF > SAFE_LIMIT_F) {
        current.push({ id: `temperature:${sensor.id}`, title: `${sensor.label} zone is above the safe limit`, reason: `Current temperature is ${sensor.tempF.toFixed(1)}°F. The target is ${SAFE_LIMIT_F}°F or below.`, level: 'warning', source: 'Temperature' })
      }
    })
    return current
  }, [recommendations, sensors, now])
  const activeCount = alerts.filter((alert) => !acknowledged[alert.id]).length

  return <section className="panel tab-panel">
    <div className="tab-intro"><div><h2>Alerts</h2><p>Current food safety and device notifications for this storage unit.</p></div><span className={`status-pill ${activeCount ? 'warning' : 'good'}`}><Bell size={15} />{activeCount} active</span></div>
    <div className="alert-summary">
      <div><strong>{activeCount}</strong><span>Needs attention</span></div>
      <div><strong>{alerts.filter((alert) => alert.level === 'critical' && !acknowledged[alert.id]).length}</strong><span>Critical</span></div>
      <div><strong>{alerts.filter((alert) => acknowledged[alert.id]).length}</strong><span>Acknowledged</span></div>
      <div className="alert-model"><Clock3 size={16} /><span>{riskActive ? 'Risk assessment is up to date' : 'Showing live sensor alerts while risk model connects'}</span></div>
    </div>
    <div className="alerts-heading"><h2>Recent notifications</h2><span>{alerts.length ? `${alerts.length} total` : 'All clear'}</span></div>
    {alerts.length ? <div className="alert-list">{alerts.map((alert) => {
      const done = Boolean(acknowledged[alert.id])
      return <article className={`alert-card ${done ? 'acknowledged' : ''}`} key={alert.id}>
        <StatusIcon level={done ? 'good' : alert.level} size={19} />
        <div className="alert-copy"><div className="alert-title-row"><strong>{alert.title}</strong><span className={`alert-severity ${done ? 'resolved' : alert.level}`}>{done ? 'Acknowledged' : alert.level === 'critical' ? 'Critical' : 'Warning'}</span></div><p>{alert.reason}</p><small>{alert.source} · {done ? 'Marked as reviewed' : 'Active now'}</small></div>
        <button className={`btn alert-action ${done ? '' : 'btn-active'}`} onClick={() => setAcknowledged((current) => ({ ...current, [alert.id]: !current[alert.id] }))}>{done ? <><Check size={14} /> Reviewed</> : 'Acknowledge'}</button>
      </article>
    })}</div> : <div className="all-clear"><CircleCheck size={27} /><div><strong>No active alerts</strong><p>All reported zones are within limits, and there are no current risk recommendations.</p></div></div>}
    <p className="caption">Alerts update as new sensor readings and inventory risk assessments arrive.</p>
  </section>
}
