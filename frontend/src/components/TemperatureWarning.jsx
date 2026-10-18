import { useEffect, useRef, useState } from 'react'
import { Thermometer, X } from 'lucide-react'
import Modal from './Modal.jsx'
import { createTemperatureWarningTracker } from '../lib/temperatureWarning.js'

export default function TemperatureWarning({ sensors, now }) {
  const tracker = useRef(null)
  if (!tracker.current) tracker.current = createTemperatureWarningTracker()
  const [warnings, setWarnings] = useState([])

  useEffect(() => {
    const next = tracker.current(sensors, now)
    if (next.length) setWarnings((current) => [...current, ...next])
  }, [sensors, now])

  if (!warnings.length) return null
  return <Modal label="High temperature warning" onClose={() => setWarnings([])}>
    <div className="temperature-warning">
      <div className="temperature-warning-heading">
        <Thermometer size={26} aria-hidden="true" />
        <h2>Cooler temperature warning</h2>
        <button className="btn btn-icon" aria-label="Close temperature warning" onClick={() => setWarnings([])}><X size={18} /></button>
      </div>
      <p>These zones stayed above <strong>45°F for at least 15 seconds</strong>:</p>
      <ul>{warnings.map((warning) => <li key={warning.eventId}><strong>{warning.label} zone</strong><span>{warning.tempF.toFixed(1)}°F when detected</span></li>)}</ul>
      <p>Check the cooler door and cooling system. Closing this warning does not resolve the temperature issue; check Sensors and Alerts for current conditions.</p>
      <button className="btn btn-active" onClick={() => setWarnings([])}>Close warning</button>
    </div>
  </Modal>
}
