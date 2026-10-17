import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Camera, PencilLine, RotateCcw, X } from 'lucide-react'
import { photoUrl, api } from '../lib/api.js'
import { CATEGORIES, timeAgo } from '../lib/food.js'
import { releasePhoto } from '../lib/image.js'
import CameraCapture from './CameraCapture.jsx'
import { FreshnessPill, ScanningPreview } from './Freshness.jsx'
import ItemFields, { blankDraft } from './ItemFields.jsx'
import Modal from './Modal.jsx'
import { StatusIcon } from './StatusBadge.jsx'

function Snapshot({ src, profile, label, freshness, caption }) {
  const { Icon } = CATEGORIES[profile]
  return (
    <figure className="snapshot">
      <div className={`snapshot-img tint-${profile}`}>
        {src ? <img src={src} alt="" /> : <Icon size={30} strokeWidth={1.4} />}
      </div>
      <figcaption>
        <small>{label}</small>
        <FreshnessPill level={freshness} />
        {caption && <small className="muted">{caption}</small>}
      </figcaption>
    </figure>
  )
}

// Re-log: record how an item looks now. A new check is appended to its
// history; the item's current freshness, photo and printed date follow it.
export default function RelogFlow({ item, onClose, onCheck, notify }) {
  const [step, setStep] = useState('capture')
  const [photo, setPhoto] = useState(null)
  const [draft, setDraft] = useState(() => blankDraft({
    freshness: item.freshness,
    expiresOn: item.expiresOn ?? '',
    dateKind: item.dateKind ?? 'best_by',
  }))
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
    try {
      const result = await api.scanExisting(item.id, captured.blob)
      if (run !== scanRun.current) return
      setDraft((d) => ({
        ...d,
        freshness: result.freshness ?? d.freshness,
        freshnessNote: result.freshnessNote ?? '',
        expiresOn: result.expiresOn ?? d.expiresOn,
        dateKind: result.expiresOn ? result.dateKind : d.dateKind,
        dateText: result.dateText,
        confidence: result.confidence,
        detected: { freshness: result.freshness, expiresOn: Boolean(result.expiresOn) },
      }))
      if (!result.showsItem) {
        setNotice({ level: 'warning', text: `This doesn’t look like ${item.name}. Retake it, or save anyway if it is.` })
      } else if (!result.freshness) {
        setNotice({ level: 'warning', text: 'Perceptron couldn’t judge freshness from this photo. Rate it yourself.' })
      } else {
        setNotice({ level: 'good', text: 'Perceptron rated how it looks now. Adjust anything that seems off.' })
      }
    } catch (cause) {
      if (run !== scanRun.current) return
      setNotice({ level: 'warning', text: `${cause.message} Rate it yourself below.` })
    }
    setStep('review')
  }

  const retake = () => {
    scanRun.current += 1
    setPhoto(null)
    setStep('capture')
  }

  const save = async (event) => {
    event.preventDefault()
    const dateChanged = draft.expiresOn && (draft.expiresOn !== item.expiresOn || draft.detected.expiresOn)
    const check = {
      freshness: draft.freshness,
      freshnessNote: draft.freshnessNote.trim() || null,
      expiresOn: dateChanged ? draft.expiresOn : null,
      dateKind: dateChanged ? draft.dateKind : null,
      photo: photo?.thumb ?? null,
      source: photo ? 'photo' : 'manual',
      confidence: photo ? draft.confidence : null,
    }
    if (!check.photo && !check.freshness && !check.freshnessNote && !check.expiresOn) {
      return setError('Rate the freshness, add a note, or take a photo to log a check.')
    }
    setSaving(true)
    setError('')
    try {
      await onCheck(item.id, check)
      notify(`Re-logged ${item.name}`)
      onClose()
    } catch (cause) {
      setError(cause.message)
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} label={`Re-log ${item.name}`} variant="sheet" className="flow">
      <header className="flow-head">
        {step === 'review' && (
          <button className="icon-button" onClick={retake} aria-label="Back to camera"><ArrowLeft size={18} /></button>
        )}
        <div>
          <h2>Re-log {item.name}</h2>
          <p>
            {step === 'capture' && 'Take a fresh photo to update how it looks.'}
            {step === 'analyzing' && 'Comparing against how it should look…'}
            {step === 'review' && (item.lastCheckedAt ? `Last checked ${timeAgo(item.lastCheckedAt)}.` : 'First freshness check for this item.')}
          </p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>

      {step === 'capture' && (
        <div className="flow-body">
          <CameraCapture onCapture={analyze} hint={`Show the ${item.name.toLowerCase()} up close`} />
          <button className="text-link center" onClick={() => setStep('review')}>
            <PencilLine size={15} /> No photo, just update it
          </button>
        </div>
      )}

      {step === 'analyzing' && (
        <div className="flow-body">
          <ScanningPreview src={photo.previewUrl} label="Checking freshness" />
        </div>
      )}

      {step === 'review' && (
        <form className="flow-body" onSubmit={save} noValidate>
          <div className="compare">
            <Snapshot
              src={photoUrl(item.photoId)}
              profile={item.profile}
              label="Before"
              freshness={item.freshness}
              caption={item.lastCheckedAt ? timeAgo(item.lastCheckedAt) : 'not checked yet'}
            />
            <ArrowRight className="compare-arrow" size={20} />
            {photo ? (
              <Snapshot src={photo.previewUrl} profile={item.profile} label="Now" freshness={draft.freshness} />
            ) : (
              <button type="button" className="snapshot snapshot-add" onClick={retake}>
                <span className="snapshot-img"><Camera size={24} /></span>
                <small>Add a photo</small>
              </button>
            )}
          </div>
          {photo && (
            <button type="button" className="text-link center" onClick={retake}><RotateCcw size={14} /> Retake photo</button>
          )}

          {notice && <p className={`notice notice-${notice.level}`}><StatusIcon level={notice.level} /> {notice.text}</p>}

          <ItemFields draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} sections={['freshness', 'date']} idPrefix="relog" />

          {error && <p className="form-error" role="alert">{error}</p>}
          <footer className="flow-foot">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-active" disabled={saving}>{saving ? 'Saving…' : 'Save check'}</button>
          </footer>
        </form>
      )}
    </Modal>
  )
}
