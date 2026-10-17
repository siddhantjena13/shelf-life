import { useRef, useState } from 'react'
import { Camera, Plus, ScanLine, Search, Trash2, Upload, X } from 'lucide-react'
import { ZONES } from '../config.js'
import { ITEM_STATUS, PROFILES } from '../lib/risk.js'
import StatusBadge, { StatusIcon } from './StatusBadge.jsx'

const ORDER = ['good', 'soon', 'risk', 'expired', 'discard']
const COLORS = {
  good: 'var(--status-good)',
  soon: 'var(--status-warning)',
  risk: 'var(--status-critical)',
  expired: 'var(--status-critical)',
  discard: 'var(--status-critical)',
}
const PROFILE_OPTIONS = Object.entries(PROFILES)
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

const newId = () => globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}-${Math.random().toString(36).slice(2)}`
function localDateTimeNow() {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 16)
}

const blankItem = () => ({ name: '', profile: 'dairy', zone: 'mid', packaged: false, addedAtLocal: localDateTimeNow() })

export default function InventoryRisk({ items, inventory, setInventory, riskActive, riskError, fullPage = false }) {
  const [mode, setMode] = useState(null)
  const [manual, setManual] = useState(blankItem)
  const [photo, setPhoto] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const fileRef = useRef(null)
  const counts = Object.fromEntries(ORDER.map((id) => [id, items.filter((item) => {
    if (id === 'soon') return ['soon', 'use_soon'].includes(item.status)
    if (id === 'risk') return ['risk', 'at_risk'].includes(item.status)
    return item.status === id
  }).length]))
  const visibleItems = items.filter((item) => {
    const matchesQuery = item.name.toLowerCase().includes(query.trim().toLowerCase()) || item.profileLabel?.toLowerCase().includes(query.trim().toLowerCase())
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'soon' ? ['soon', 'use_soon'].includes(item.status) : statusFilter === 'risk' ? ['risk', 'at_risk', 'expired', 'discard'].includes(item.status) : item.status === statusFilter)
    return matchesQuery && matchesStatus
  })

  const closeEditor = () => {
    setMode(null)
    setError('')
    setSuggestions([])
    setPhoto(null)
  }

  const addManual = (event) => {
    event.preventDefault()
    const name = manual.name.trim()
    if (!name) return
    setInventory((current) => [...current, {
      ...manual,
      name,
      id: newId(),
      addedAtMs: new Date(manual.addedAtLocal).getTime(),
    }])
    setManual(blankItem())
    closeEditor()
  }

  const scanPhoto = async (file) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Choose a JPG, PNG, WEBP, or GIF image.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be 10 MB or smaller.')
      return
    }
    setPhoto(file)
    setSuggestions([])
    setError('')
    setBusy(true)
    try {
      const body = new FormData()
      body.append('image', file)
      const response = await fetch('/api/inventory/scan', { method: 'POST', body })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Could not analyze this image.')
      const found = Array.isArray(payload.items) ? payload.items : []
      if (!found.length) throw new Error('No food items were recognized. Try a clearer photo or enter items manually.')
      setSuggestions(found.map((item) => ({
        name: String(item.name || '').trim(),
        profile: PROFILES[item.profile] ? item.profile : 'other',
        zone: 'mid',
        packaged: false,
        addedAtLocal: localDateTimeNow(),
        confidence: Number.isFinite(item.confidence) ? item.confidence : null,
      })).filter((item) => item.name))
    } catch (cause) {
      setError(cause.message || 'Photo analysis failed. You can still add items manually.')
    } finally {
      setBusy(false)
    }
  }

  const saveSuggestions = () => {
    const named = suggestions.filter((item) => item.name.trim())
    const additions = named.filter((item) => Number.isFinite(new Date(item.addedAtLocal).getTime())).map((item) => ({
      id: newId(), name: item.name.trim(), profile: item.profile, zone: item.zone, packaged: item.packaged,
      addedAtMs: new Date(item.addedAtLocal).getTime(),
    }))
    if (additions.length !== named.length) {
      setError('Set a valid “in fridge since” time for each item before adding it.')
      return
    }
    if (additions.length) setInventory((current) => [...current, ...additions])
    closeEditor()
  }

  const updateSuggestion = (index, key, value) => {
    setSuggestions((current) => current.map((item, i) => i === index ? { ...item, [key]: value } : item))
  }

  return (
    <section className={`panel ${fullPage ? 'inventory-page' : ''}`}>
      <div className="panel-head">
        <h2>{fullPage ? 'Food inventory' : 'Inventory risk'}</h2>
        <button className="btn" onClick={() => { setMode('choose'); setError('') }}><Plus size={15} /> Add items</button>
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

      {mode && <div className="inventory-editor">
        <div className="editor-heading">
          <div><strong>{mode === 'photo' ? 'Scan a fridge photo' : mode === 'manual' ? 'Add an item' : 'Add to inventory'}</strong>
            <p className="caption">Photo results are suggestions. Review them before they affect risk scores.</p></div>
          <button className="btn btn-icon" onClick={closeEditor} aria-label="Close inventory editor"><X size={16} /></button>
        </div>

        {mode === 'choose' && <div className="add-choice">
          <button className="choice-card" onClick={() => setMode('manual')}><Plus size={18} /><span><strong>Enter manually</strong><small>Add one food item</small></span></button>
          <button className="choice-card" onClick={() => setMode('photo')}><Camera size={18} /><span><strong>Scan a photo</strong><small>Get editable food suggestions</small></span></button>
        </div>}

        {mode === 'manual' && <form className="inventory-form" onSubmit={addManual}>
          <label>Food name<input autoFocus value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} placeholder="e.g. Greek yogurt" required /></label>
          <label>Food profile<select value={manual.profile} onChange={(e) => setManual({ ...manual, profile: e.target.value })}>{PROFILE_OPTIONS.map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}</select></label>
          <label>Storage zone<select value={manual.zone} onChange={(e) => setManual({ ...manual, zone: e.target.value })}>{ZONES.map((zone) => <option key={zone.id} value={zone.id}>{zone.label}</option>)}</select></label>
          <label>Added to this fridge<input type="datetime-local" max={localDateTimeNow()} value={manual.addedAtLocal} onChange={(e) => setManual({ ...manual, addedAtLocal: e.target.value })} required /></label>
          <label className="check-label"><input type="checkbox" checked={manual.packaged} onChange={(e) => setManual({ ...manual, packaged: e.target.checked })} /> Sealed or bagged</label>
          <div className="editor-actions"><button type="button" className="btn" onClick={() => setMode('choose')}>Back</button><button className="btn btn-active" type="submit">Add item</button></div>
        </form>}

        {mode === 'photo' && <div className="photo-scan">
          <input ref={fileRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; scanPhoto(file) }} />
          {!suggestions.length && <button className="upload-area" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <ScanLine className="spin" size={22} /> : <Upload size={22} />}
            <strong>{busy ? 'Looking for food items…' : photo ? 'Choose a different photo' : 'Take or upload a photo'}</strong>
            <small>JPG, PNG, WEBP, or GIF · up to 10 MB</small>
          </button>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {suggestions.length > 0 && <>
            <div className="suggestion-intro">Found {suggestions.length} possible item{suggestions.length === 1 ? '' : 's'}. Edit or remove anything that looks wrong.</div>
            {suggestions.map((item, index) => <div className="suggestion-row" key={`${index}-${item.name}`}>
              <input aria-label="Food name" value={item.name} onChange={(e) => updateSuggestion(index, 'name', e.target.value)} />
              <select aria-label="Food profile" value={item.profile} onChange={(e) => updateSuggestion(index, 'profile', e.target.value)}>{PROFILE_OPTIONS.map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}</select>
              <select aria-label="Storage zone" value={item.zone} onChange={(e) => updateSuggestion(index, 'zone', e.target.value)}>{ZONES.map((zone) => <option key={zone.id} value={zone.id}>{zone.label}</option>)}</select>
              <label className="suggestion-date">In fridge since<input aria-label="Added to fridge" type="datetime-local" max={localDateTimeNow()} value={item.addedAtLocal} onChange={(e) => updateSuggestion(index, 'addedAtLocal', e.target.value)} required /></label>
              <label className="suggestion-packaged"><input type="checkbox" checked={item.packaged} onChange={(e) => updateSuggestion(index, 'packaged', e.target.checked)} /> Packaged</label>
              {item.confidence !== null && <small className="confidence">{Math.round(item.confidence * 100)}%</small>}
              <button className="btn btn-icon remove-item" aria-label={`Remove ${item.name}`} onClick={() => setSuggestions((current) => current.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
            </div>)}
            <button className="text-button" onClick={() => fileRef.current?.click()}>Try another photo</button>
            <div className="editor-actions"><button className="btn" onClick={() => setMode('choose')}>Back</button><button className="btn btn-active" onClick={saveSuggestions}>Add {suggestions.filter((item) => item.name.trim()).length} items</button></div>
          </>}
          {!suggestions.length && <button className="text-button" onClick={() => setMode('choose')}>Back to options</button>}
        </div>}
      </div>}

      {items.length === 0 ? <p className="empty-inventory">No food yet. Add items manually or scan a photo to get started.</p> : <div className="table-scroll">
        {fullPage && <div className="inventory-filters">
          <label className="inventory-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search inventory" aria-label="Search inventory" /></label>
          <label className="filter-select"><span className="visually-hidden">Filter by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses ({items.length})</option><option value="good">Good ({counts.good})</option><option value="soon">Use soon ({counts.soon})</option><option value="risk">At risk ({counts.risk + counts.expired + counts.discard})</option></select></label>
          <span className="inventory-result-count">{visibleItems.length} of {items.length} items</span>
        </div>}
        <table className="table">
          <thead><tr><th>Item</th><th>Profile</th><th>Zone</th><th>In fridge since</th><th className="num">Score</th><th>Status</th><th><span className="visually-hidden">Remove</span></th></tr></thead>
          <tbody>{visibleItems.map((item) => <tr key={item.id}>
            <td>{item.name}{item.packaged && <span className="packaged-tag">Packaged</span>}</td><td className="muted">{item.profileLabel}{['produce', 'other'].includes(item.profile) && ' · estimate'}</td><td className="muted">{item.zoneLabel}</td><td className="muted">{item.addedAtMs ? new Date(item.addedAtMs).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Unknown'}{item.gapHours > 0 && <span className="data-gap">{` · ${item.gapHours.toFixed(1)}h unobserved`}</span>}</td><td className="num strong">{item.score}{item.scoringMode === 'preview' && <small className="remaining-hours">Preview</small>}{item.scoringMode === 'backend' && Number.isFinite(item.remainingHours) && <small className="remaining-hours">{`${item.remainingHours.toFixed(0)}h left`}</small>}</td>
            <td><StatusBadge level={ITEM_STATUS[item.status].level} label={ITEM_STATUS[item.status].label} /></td>
            <td><button className="row-remove" aria-label={`Remove ${item.name}`} onClick={() => setInventory((current) => current.filter((entry) => entry.id !== item.id))}><Trash2 size={14} /></button></td>
          </tr>)}</tbody>
        </table>
        {fullPage && visibleItems.length === 0 && <div className="empty-state">No inventory matches those filters.</div>}
      </div>}
      <p className="caption">Storage-quality score out of 100, estimated from sensor exposure over the last 24 hours.</p>
    </section>
  )
}
