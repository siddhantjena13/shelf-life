import { useState } from 'react'
import { Camera, Check, PencilLine, RotateCcw, Trash2, Undo2, X } from 'lucide-react'
import { photoUrl } from '../lib/api.js'
import {
  CATEGORIES, DATE_KINDS, FRESHNESS, attention, expiryInfo, formatShortDate, storedFor, timeAgo, toLocalInput, fromLocalInput, zoneLabel,
} from '../lib/food.js'
import { PROFILES } from '../lib/risk.js'
import { FreshnessMeter, FreshnessPill, FreshnessTrend } from './Freshness.jsx'
import ItemFields, { blankDraft, draftProblem } from './ItemFields.jsx'
import Modal from './Modal.jsx'
import FreshnessEstimate from './FreshnessEstimate.jsx'
import { StatusIcon } from './StatusBadge.jsx'

const fullDate = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

function EditForm({ item, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => blankDraft({
    name: item.name,
    profile: item.profile,
    zone: item.zone,
    packaged: item.packaged,
    addedAtLocal: toLocalInput(item.addedAt),
    expiresOn: item.expiresOn ?? '',
    dateKind: item.dateKind ?? 'best_by',
  }))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    const problem = draftProblem(draft, ['identity'])
    if (problem) return setError(problem)
    setSaving(true)
    try {
      await onSave({
        name: draft.name.trim(),
        profile: draft.profile,
        zone: draft.zone,
        packaged: draft.packaged,
        addedAt: fromLocalInput(draft.addedAtLocal),
        expiresOn: draft.expiresOn || null,
        dateKind: draft.expiresOn ? draft.dateKind : null,
      })
    } catch (cause) {
      setError(cause.message)
      setSaving(false)
    }
  }

  return (
    <form className="detail-edit" onSubmit={submit} noValidate>
      <ItemFields draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} sections={['identity', 'date']} idPrefix="edit" />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="flow-foot">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-active" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  )
}

export default function ItemDetail({ item, risk, now, onClose, onRelog, onUpdate, onSetState, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const { Icon } = CATEGORIES[item.profile]
  const { reasons } = attention(item, risk, now)
  const expiry = expiryInfo(item, now)
  const checks = [...item.checks].reverse()
  const closed = item.state !== 'active'

  const act = async (work) => {
    setError('')
    try {
      await work()
    } catch (cause) {
      setError(cause.message)
    }
  }

  return (
    <Modal onClose={onClose} label={item.name} variant="drawer" className="detail">
      <div className={`detail-hero tint-${item.profile}`}>
        {item.photoId ? <img src={photoUrl(item.photoId)} alt={item.name} /> : <Icon size={64} strokeWidth={1.2} />}
        <button className="icon-button detail-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>

      <div className="detail-body">
        <div className="detail-title">
          <div className="detail-title-row">
            <h2>{item.name}</h2>
            {!editing && (
              <button className="btn btn-small" onClick={() => setEditing(true)}><PencilLine size={14} /> Edit</button>
            )}
          </div>
          <p className="muted">
            {PROFILES[item.profile].label} · {zoneLabel(item.zone)} shelf{item.packaged && ' · sealed'}
          </p>
          <p className="muted small">In the fridge for {storedFor(item.addedAt, now)}, since {fullDate(item.addedAt)}</p>
        </div>

        {closed && (
          <div className="notice notice-good closed-banner">
            <Check size={16} />
            <span>Marked as {item.state} {timeAgo(item.closedAt, now)}.</span>
            <button className="btn btn-small" onClick={() => act(() => onSetState(item, 'active'))}><Undo2 size={14} /> Put back</button>
          </div>
        )}

        {editing ? (
          <EditForm
            item={item}
            onCancel={() => setEditing(false)}
            onSave={async (changes) => {
              await onUpdate(item.id, changes)
              setEditing(false)
            }}
          />
        ) : (
          <>
            {!closed && <FreshnessEstimate item={item} risk={risk} />}

            {!closed && reasons.length > 0 && (
              <ul className="reasons">
                {reasons.map((r) => (
                  <li key={r.text}><StatusIcon level={r.level} /> {r.text}</li>
                ))}
              </ul>
            )}

            <div className="detail-stats">
              <div className="detail-stat">
                <small>Looks</small>
                <div className="detail-stat-main">
                  <FreshnessMeter level={item.freshness} size="lg" />
                  <strong>{item.freshness ? FRESHNESS[item.freshness].label : 'Not rated'}</strong>
                </div>
                <span className="muted">{item.freshnessNote || (item.lastCheckedAt ? `Checked ${timeAgo(item.lastCheckedAt, now)}` : 'Re-log it to rate freshness')}</span>
              </div>
              <div className="detail-stat">
                <small>Printed date</small>
                <div className="detail-stat-main">
                  <strong className={expiry ? `text-${expiry.level}` : 'muted'}>
                    {expiry ? expiry.label : 'None recorded'}
                  </strong>
                </div>
                <span className="muted">{expiry ? expiry.relative[0].toUpperCase() + expiry.relative.slice(1) : 'Add one with Edit'}</span>
              </div>
            </div>
            <p className="caption">
              The estimate combines the printed date, USDA storage times, the sensors’ temperature and humidity history,
              and every freshness check. It estimates quality; it can’t confirm food is safe.
            </p>

            <section className="timeline">
              <div className="timeline-head">
                <h3>History</h3>
                <FreshnessTrend checks={item.checks} />
              </div>
              <ol>
                {checks.map((check) => (
                  <li key={check.id}>
                    <span className={`timeline-thumb tint-${item.profile}`}>
                      {check.photoId ? <img src={photoUrl(check.photoId)} alt="" loading="lazy" /> : check.source === 'photo' ? <Camera size={16} /> : <PencilLine size={16} />}
                    </span>
                    <div>
                      <div className="timeline-row">
                        <FreshnessPill level={check.freshness} />
                        <time dateTime={check.at} title={fullDate(check.at)}>{timeAgo(check.at, now)}</time>
                      </div>
                      {check.note && <p>{check.note}</p>}
                      <small className="muted">
                        {check.source === 'photo' ? 'Photo check' : 'Manual check'}
                        {check.confidence !== null && check.confidence !== undefined && ` · ${Math.round(check.confidence * 100)}% sure`}
                        {check.expiresOn && ` · ${DATE_KINDS[check.dateKind] ?? 'Expires'} ${formatShortDate(check.expiresOn)}`}
                      </small>
                    </div>
                  </li>
                ))}
                <li className="timeline-origin">
                  <span className="timeline-thumb"><RotateCcw size={14} /></span>
                  <div>
                    <div className="timeline-row"><strong>Added to the fridge</strong><time dateTime={item.addedAt}>{timeAgo(item.addedAt, now)}</time></div>
                  </div>
                </li>
              </ol>
            </section>
          </>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
      </div>

      {!editing && (
        <footer className="detail-foot">
          {!closed && <button className="btn btn-active" onClick={() => onRelog(item)}><Camera size={16} /> Re-log</button>}
          {!closed && <button className="btn" onClick={() => act(() => onSetState(item, 'used'))}><Check size={16} /> Used it</button>}
          {!closed && <button className="btn" onClick={() => act(() => onSetState(item, 'tossed'))}><Trash2 size={16} /> Tossed it</button>}
          <button
            className={`btn btn-danger-quiet ${confirmDelete ? 'armed' : ''}`}
            onClick={() => (confirmDelete ? act(() => onDelete(item)) : setConfirmDelete(true))}
            onBlur={() => setConfirmDelete(false)}
            title="Remove an entry logged by mistake. Used or tossed food should be marked instead."
          >
            {confirmDelete ? 'Confirm delete' : 'Delete'}
          </button>
        </footer>
      )}
    </Modal>
  )
}
