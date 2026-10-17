import { useMemo, useState } from 'react'
import { Camera, Database, RefreshCw, Search, Sparkles, Undo2 } from 'lucide-react'
import {
  CATEGORIES, CATEGORY_ORDER, FRESHNESS, attention, attentionRank, expiryInfo, hoursLeft, timeAgo,
} from '../lib/food.js'
import FoodCard, { FoodThumb } from '../components/FoodCard.jsx'

const SORTS = {
  first: { label: 'Use first' },
  recent: { label: 'Newest' },
  freshness: { label: 'Least fresh' },
  name: { label: 'A–Z' },
}

function sortItems(list, sort, risks, now) {
  const by = {
    first: (a, b) =>
      attentionRank(attention(b, risks.get(b.id), now).level) - attentionRank(attention(a, risks.get(a.id), now).level)
      || hoursLeft(a, risks.get(a.id), now) - hoursLeft(b, risks.get(b.id), now),
    recent: (a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt),
    freshness: (a, b) => (FRESHNESS[a.freshness]?.rank ?? 6) - (FRESHNESS[b.freshness]?.rank ?? 6),
    name: (a, b) => a.name.localeCompare(b.name),
  }[sort]
  return [...list].sort((a, b) => by(a, b) || a.name.localeCompare(b.name))
}

const DATABASES = {
  sqlite: { label: 'Saved locally', title: 'Inventory is saved in backend/data/shelfsense.db' },
  mongodb: { label: 'MongoDB', title: 'Inventory is saved in MongoDB' },
}

// "perceptron-mk1.5" -> "Perceptron Mk1.5"
const modelLabel = (id = '') => id.replace(/^perceptron-mk/i, 'Perceptron Mk')

function SystemBadges({ health }) {
  if (!health) return null
  const db = DATABASES[health.database] ?? { label: health.database, title: '' }
  return (
    <div className="system-badges">
      <span className={`sys-badge ${health.databaseReachable ? 'ok' : 'warn'}`} title={db.title}>
        <Database size={13} />
        {health.databaseReachable ? db.label : `${db.label}: unreachable`}
      </span>
      <span className={`sys-badge ${health.vision ? 'ok' : 'warn'}`} title={health.vision ? `Photos are analyzed by ${health.visionModel}` : 'Set PERCEPTRON_API_KEY in backend/.env'}>
        <Sparkles size={13} />
        {health.vision ? modelLabel(health.visionModel) : 'Recognition off'}
      </span>
    </div>
  )
}

function Stats({ active, closed, risks, now }) {
  const needAttention = active.filter((i) => attention(i, risks.get(i.id), now).level !== 'good').length
  const soon = active.filter((i) => {
    const e = expiryInfo(i, now)
    return e && e.days >= 0 && e.days <= 3
  }).length
  const used = closed.filter((i) => i.state === 'used').length
  const tossed = closed.filter((i) => i.state === 'tossed').length
  const finished = used + tossed

  return (
    <div className="inv-stats">
      <div className="inv-stat">
        <span className="inv-stat-value">{active.length}</span>
        <span className="inv-stat-label">in the fridge</span>
      </div>
      <div className={`inv-stat ${needAttention ? 'warn' : ''}`}>
        <span className="inv-stat-value">{needAttention}</span>
        <span className="inv-stat-label">need attention</span>
      </div>
      <div className="inv-stat">
        <span className="inv-stat-value">{soon}</span>
        <span className="inv-stat-label">printed dates in 3 days</span>
      </div>
      <div className="inv-stat">
        <span className="inv-stat-value">{finished ? `${Math.round((used / finished) * 100)}%` : '–'}</span>
        <span className="inv-stat-label">eaten, not wasted (30 days)</span>
        {finished > 0 && (
          <span className="waste-bar" role="img" aria-label={`${used} used, ${tossed} tossed`}>
            <span style={{ flexGrow: used }} className="used" />
            <span style={{ flexGrow: tossed }} className="tossed" />
          </span>
        )}
      </div>
    </div>
  )
}

function EmptyState({ onLog, onLoadSamples, loadingSamples }) {
  return (
    <div className="inv-empty">
      <div className="inv-empty-art" aria-hidden="true">
        {CATEGORY_ORDER.map((id) => {
          const { Icon } = CATEGORIES[id]
          return <span key={id} className={`tint-${id}`}><Icon size={22} strokeWidth={1.5} /></span>
        })}
      </div>
      <h2>Nothing logged yet</h2>
      <p>Snap a photo of something in the fridge. Perceptron names it, rates how fresh it looks and reads any printed date. You can correct anything before it’s saved.</p>
      <div className="inv-empty-actions">
        <button className="btn btn-active btn-large" onClick={onLog}><Camera size={18} /> Log your first item</button>
        <button className="btn btn-large" onClick={onLoadSamples} disabled={loadingSamples}>
          {loadingSamples ? 'Adding…' : 'Add sample items'}
        </button>
      </div>
    </div>
  )
}

export default function InventoryPage({
  items, status, error, reload, risks, health, now, onLog, onOpen, onRelog, onSetState, onLoadSamples, loadingSamples,
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [onlyAttention, setOnlyAttention] = useState(false)
  const [sort, setSort] = useState('first')

  const active = useMemo(() => items.filter((i) => i.state === 'active'), [items])
  const closed = useMemo(
    () => items.filter((i) => i.state !== 'active').sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt)),
    [items],
  )

  const q = query.trim().toLowerCase()
  const visible = sortItems(
    active.filter((i) =>
      (category === 'all' || i.profile === category)
      && (!q || i.name.toLowerCase().includes(q) || CATEGORIES[i.profile].short.toLowerCase().includes(q))
      && (!onlyAttention || attention(i, risks.get(i.id), now).level !== 'good')),
    sort, risks, now,
  )
  const counts = Object.fromEntries(CATEGORY_ORDER.map((id) => [id, active.filter((i) => i.profile === id).length]))

  if (status === 'loading') {
    return (
      <div className="food-grid" aria-busy="true">
        {[0, 1, 2].map((n) => <div key={n} className="food-card skeleton" />)}
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="inv-empty">
        <h2>Can’t load the inventory</h2>
        <p>{error}</p>
        <p className="muted small">Start the backend with <code>uvicorn main:app --reload</code> in <code>backend/</code>.</p>
        <button className="btn" onClick={reload}><RefreshCw size={16} /> Try again</button>
      </div>
    )
  }

  return (
    <>
      <SystemBadges health={health} />
      {error && <p className="notice notice-warning">Showing the last loaded inventory. {error}</p>}

      {active.length === 0 && closed.length === 0 ? (
        <EmptyState onLog={onLog} onLoadSamples={onLoadSamples} loadingSamples={loadingSamples} />
      ) : (
        <>
          <Stats active={active} closed={closed} risks={risks} now={now} />

          <div className="inv-toolbar">
            <label className="search">
              <Search size={16} />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search food" aria-label="Search food" />
            </label>
            <div className="inv-filters" role="group" aria-label="Filter by category">
              <button className={`chip ${category === 'all' ? 'selected' : ''}`} onClick={() => setCategory('all')}>
                All <span>{active.length}</span>
              </button>
              {CATEGORY_ORDER.filter((id) => counts[id]).map((id) => {
                const { Icon, short } = CATEGORIES[id]
                return (
                  <button key={id} className={`chip ${category === id ? 'selected' : ''}`} onClick={() => setCategory(category === id ? 'all' : id)}>
                    <Icon size={14} /> {short} <span>{counts[id]}</span>
                  </button>
                )
              })}
              <button className={`chip chip-warn ${onlyAttention ? 'selected' : ''}`} onClick={() => setOnlyAttention(!onlyAttention)} aria-pressed={onlyAttention}>
                Needs attention
              </button>
            </div>
            <label className="sort">
              <span>Sort</span>
              <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
                {Object.entries(SORTS).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
              </select>
            </label>
          </div>

          {visible.length === 0 ? (
            <p className="empty-inventory">{active.length ? 'Nothing matches those filters.' : 'Everything has been used up. Log something new.'}</p>
          ) : (
            <div className="food-grid">
              {visible.map((item, index) => (
                <FoodCard
                  key={item.id}
                  item={item}
                  risk={risks.get(item.id)}
                  now={now}
                  style={{ '--i': Math.min(index, 12) }}
                  onOpen={() => onOpen(item.id)}
                  onRelog={() => onRelog(item)}
                  onUsed={() => onSetState(item, 'used')}
                />
              ))}
            </div>
          )}

          {closed.length > 0 && (
            <section className="finished">
              <h2>Finished in the last 30 days</h2>
              <ul>
                {closed.slice(0, 12).map((item) => (
                  <li key={item.id}>
                    <FoodThumb item={item} size={36} />
                    <button className="finished-name" onClick={() => onOpen(item.id)}>{item.name}</button>
                    <span className={`outcome outcome-${item.state}`}>{item.state === 'used' ? 'Used' : 'Tossed'}</span>
                    <span className="muted small">{timeAgo(item.closedAt, now)}</span>
                    <button className="btn btn-small btn-quiet" onClick={() => onSetState(item, 'active')}><Undo2 size={14} /> Put back</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  )
}
