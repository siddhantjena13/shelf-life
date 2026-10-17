import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Camera, ChevronDown, PencilLine, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { api } from '../lib/api.js'
import { CATEGORIES, fromLocalInput } from '../lib/food.js'
import { releasePhoto } from '../lib/image.js'
import CameraCapture from './CameraCapture.jsx'
import { ScanningPreview } from './Freshness.jsx'
import ItemFields, { blankDraft, draftFromDetection, draftProblem } from './ItemFields.jsx'
import Modal from './Modal.jsx'
import { StatusIcon } from './StatusBadge.jsx'

function toPayload(draft, photo) {
  return {
    name: draft.name.trim(),
    profile: draft.profile,
    zone: draft.zone,
    packaged: draft.packaged,
    addedAt: fromLocalInput(draft.addedAtLocal),
    freshness: draft.freshness,
    freshnessNote: draft.freshnessNote.trim() || null,
    expiresOn: draft.expiresOn || null,
    dateKind: draft.expiresOn ? draft.dateKind : null,
    photo: photo?.thumb ?? null,
    source: photo ? 'photo' : 'manual',
    confidence: draft.confidence,
  }
}

function DraftCard({ draft, index, total, expanded, onToggle, onChange, onRemove }) {
  const { Icon } = CATEGORIES[draft.profile]
  if (total === 1) return <ItemFields draft={draft} onChange={onChange} idPrefix={`draft-${index}`} />
  return (
    <div className={`draft-card ${draft.include ? '' : 'excluded'} ${expanded ? 'expanded' : ''}`}>
      <div className="draft-head">
        <input
          type="checkbox"
          checked={draft.include}
          onChange={(e) => onChange({ include: e.target.checked })}
          aria-label={`Include ${draft.name || 'this item'}`}
        />
        <button type="button" className="draft-title" onClick={onToggle} aria-expanded={expanded}>
          <span className={`draft-icon tint-${draft.profile}`}><Icon size={16} /></span>
          <strong>{draft.name || 'Unnamed item'}</strong>
          {draft.confidence !== null && <span className="confidence-badge">{Math.round(draft.confidence * 100)}% sure</span>}
          <ChevronDown size={16} className="chevron" />
        </button>
        <button type="button" className="icon-button" onClick={onRemove} aria-label={`Remove ${draft.name || 'item'}`}>
          <Trash2 size={15} />
        </button>
      </div>
      {expanded && <div className="draft-body"><ItemFields draft={draft} onChange={onChange} idPrefix={`draft-${index}`} /></div>}
    </div>
  )
}

export default function LogFoodFlow({ onClose, onCreate, notify, visionReady }) {
  const [step, setStep] = useState('capture')
  const [photo, setPhoto] = useState(null)
  const [drafts, setDrafts] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const scanRun = useRef(0)

  useEffect(() => () => releasePhoto(photo), [photo])

  const analyze = async (captured) => {
    setPhoto(captured)
    setStep('analyzing')
    setNotice(null)
    setError('')
    const run = ++scanRun.current
    let next = [blankDraft()]
    let note
    try {
      const { items } = await api.scanNew(captured.blob)
      if (run !== scanRun.current) return
      if (items.length) {
        next = items.map(draftFromDetection)
        note = {
          level: 'good',
          text: items.length === 1
            ? 'Perceptron filled in what it could see. Check each field before saving.'
            : `Perceptron spotted ${items.length} foods. Untick any you don’t want to log.`,
        }
      } else {
        note = { level: 'warning', text: 'No food was recognized in this photo. Fill in the details and the photo is still saved.' }
      }
    } catch (cause) {
      if (run !== scanRun.current) return
      note = { level: 'warning', text: `${cause.message} You can fill in the details yourself.` }
    }
    setDrafts(next)
    setExpanded(next[0].key)
    setNotice(note)
    setStep('review')
  }

  const enterManually = () => {
    scanRun.current += 1
    const first = blankDraft()
    setDrafts([first])
    setExpanded(first.key)
    setNotice(null)
    setStep('review')
  }

  const retake = () => {
    scanRun.current += 1
    setPhoto(null)
    setStep('capture')
  }

  const updateDraft = (key, patch) => setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)))

  const save = async (event) => {
    event.preventDefault()
    const chosen = drafts.filter((d) => d.include)
    if (!chosen.length) return setError('Tick at least one item to log.')
    const problem = chosen.map((d) => draftProblem(d, ['identity'])).find(Boolean)
    if (problem) return setError(problem)

    setSaving(true)
    setError('')
    const saved = []
    try {
      for (const draft of chosen) {
        saved.push(await onCreate(toPayload(draft, photo)))
        // Drop each saved draft right away so a retry never logs it twice.
        setDrafts((list) => list.filter((d) => d.key !== draft.key))
      }
      notify(saved.length === 1 ? `Logged ${saved[0].name}` : `Logged ${saved.length} items`)
      onClose()
    } catch (cause) {
      setError(saved.length ? `Saved ${saved.length}, but then: ${cause.message}` : cause.message)
    } finally {
      setSaving(false)
    }
  }

  const count = drafts.filter((d) => d.include).length

  return (
    <Modal onClose={onClose} label="Log food" variant="sheet" className="flow">
      <header className="flow-head">
        {step === 'review' && (
          <button className="icon-button" onClick={retake} aria-label="Back to camera"><ArrowLeft size={18} /></button>
        )}
        <div>
          <h2>{step === 'review' ? 'Review and save' : 'Log food'}</h2>
          <p>
            {step === 'capture' && 'Snap the food. Get the printed date in the shot if there is one.'}
            {step === 'analyzing' && 'Looking at your photo…'}
            {step === 'review' && 'Photo results are suggestions. Everything stays editable.'}
          </p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>

      {step === 'capture' && (
        <div className="flow-body">
          {visionReady === false && (
            <p className="notice notice-warning">
              <StatusIcon level="warning" /> Food recognition is off until PERCEPTRON_API_KEY is set on the backend. Photos are still saved.
            </p>
          )}
          <CameraCapture onCapture={analyze} hint="Center the food · include any printed date" />
          <button className="text-link center" onClick={enterManually}>
            <PencilLine size={15} /> Skip the photo and type it in
          </button>
        </div>
      )}

      {step === 'analyzing' && (
        <div className="flow-body">
          <ScanningPreview src={photo.previewUrl} />
          <button className="text-link center" onClick={enterManually}>Skip and type it in</button>
        </div>
      )}

      {step === 'review' && (
        <form className="flow-body" onSubmit={save} noValidate>
          <div className="review-photo">
            {photo ? (
              <>
                <img src={photo.previewUrl} alt="Your photo" />
                <button type="button" className="btn btn-small" onClick={retake}><RotateCcw size={14} /> Retake</button>
              </>
            ) : (
              <button type="button" className="review-photo-empty" onClick={retake}>
                <Camera size={20} />
                <span>Add a photo</span>
              </button>
            )}
          </div>

          {notice && (
            <p className={`notice notice-${notice.level}`}><StatusIcon level={notice.level} /> {notice.text}</p>
          )}

          <div className="drafts">
            {drafts.map((draft, index) => (
              <DraftCard
                key={draft.key}
                draft={draft}
                index={index}
                total={drafts.length}
                expanded={expanded === draft.key}
                onToggle={() => setExpanded(expanded === draft.key ? null : draft.key)}
                onChange={(patch) => updateDraft(draft.key, patch)}
                onRemove={() => setDrafts((list) => list.filter((d) => d.key !== draft.key))}
              />
            ))}
          </div>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              const extra = blankDraft()
              setDrafts((list) => [...list, extra])
              setExpanded(extra.key)
            }}
          >
            <Plus size={15} /> Add another item from this photo
          </button>

          {error && <p className="form-error" role="alert">{error}</p>}
          <footer className="flow-foot">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-active" disabled={saving || !count}>
              {saving ? 'Saving…' : count === 1 ? 'Log item' : `Log ${count} items`}
            </button>
          </footer>
        </form>
      )}
    </Modal>
  )
}
