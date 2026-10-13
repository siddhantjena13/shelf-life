import { StatusIcon } from './StatusBadge.jsx'

export default function Recommendations({ items }) {
  return (
    <section className="panel">
      <h2>Recommendations</h2>
      {items.length === 0 ? (
        <div className="rec">
          <StatusIcon level="good" size={20} />
          <div>
            <div className="rec-title">No action needed</div>
            <div className="rec-reason">Everything stayed in range over the last 24 hours.</div>
          </div>
        </div>
      ) : (
        <div className="rec-grid">
          {items.map((rec) => (
            <div className="rec" key={rec.title}>
              <StatusIcon level={rec.level} size={20} />
              <div>
                <div className="rec-title">{rec.title}</div>
                <div className="rec-reason">{rec.reason}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="caption">Based on the last 24 hours</p>
    </section>
  )
}
