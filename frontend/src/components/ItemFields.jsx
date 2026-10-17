import { X } from 'lucide-react'
import { ZONES } from '../config.js'
import { CATEGORIES, CATEGORY_ORDER, DATE_KINDS, fromLocalInput, toLocalInput } from '../lib/food.js'
import { PROFILES } from '../lib/risk.js'
import { AiMark, FreshnessPicker } from './Freshness.jsx'

// Form state for one item. Every field the model filled in stays editable;
// `detected` remembers which ones it filled (and the freshness it suggested)
// so the form can mark them.
export function blankDraft(overrides = {}) {
  return {
    key: globalThis.crypto?.randomUUID?.() ?? String(Math.random()),
    include: true,
    name: '',
    profile: 'other',
    zone: 'mid',
    packaged: false,
    addedAtLocal: toLocalInput(),
    freshness: null,
    freshnessNote: '',
    expiresOn: '',
    dateKind: 'best_by',
    dateText: null,
    confidence: null,
    detected: {},
    ...overrides,
  }
}

export function draftFromDetection(found) {
  return blankDraft({
    name: found.name,
    profile: found.profile,
    packaged: found.packaged,
    freshness: found.freshness,
    freshnessNote: found.freshnessNote ?? '',
    expiresOn: found.expiresOn ?? '',
    dateKind: found.dateKind ?? 'best_by',
    dateText: found.dateText,
    confidence: found.confidence,
    detected: {
      name: true,
      profile: true,
      packaged: found.packaged,
      freshness: found.freshness,
      expiresOn: Boolean(found.expiresOn),
    },
  })
}

export function draftProblem(draft, sections) {
  if (sections.includes('identity')) {
    if (!draft.name.trim()) return 'Give every item a name.'
    const added = fromLocalInput(draft.addedAtLocal)
    if (!added) return 'Set when the item went into the fridge.'
    if (Date.parse(added) > Date.now() + 60e3) return 'The date added cannot be in the future.'
  }
  return null
}

export default function ItemFields({ draft, onChange, sections = ['identity', 'freshness', 'date'], idPrefix = 'item' }) {
  const d = draft.detected ?? {}
  const show = (section) => sections.includes(section)

  return (
    <div className="item-fields">
      {show('identity') && (
        <>
          <label className="field field-wide">
            <span className="field-label">Name {d.name && <AiMark />}</span>
            <input
              value={draft.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="e.g. Greek yogurt"
              maxLength={80}
              autoComplete="off"
            />
          </label>

          <div className="field field-wide">
            <span className="field-label" id={`${idPrefix}-category`}>Category {d.profile && <AiMark />}</span>
            <div className="category-picker" role="radiogroup" aria-labelledby={`${idPrefix}-category`}>
              {CATEGORY_ORDER.map((id) => {
                const { Icon, short } = CATEGORIES[id]
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={draft.profile === id}
                    className={`category-option tint-${id} ${draft.profile === id ? 'selected' : ''}`}
                    onClick={() => onChange({ profile: id })}
                    title={PROFILES[id].label}
                  >
                    <Icon size={18} strokeWidth={1.7} />
                    <span>{short}</span>
                  </button>
                )
              })}
            </div>
            <span className="field-help">
              Scored with the {PROFILES[draft.profile].label.toLowerCase()} profile
              {['produce', 'other'].includes(draft.profile) && ' (a broad estimate)'}
            </span>
          </div>

          <div className="field">
            <span className="field-label" id={`${idPrefix}-zone`}>Shelf</span>
            <div className="choice-row" role="radiogroup" aria-labelledby={`${idPrefix}-zone`}>
              {ZONES.map((zone) => (
                <button
                  key={zone.id}
                  type="button"
                  role="radio"
                  aria-checked={draft.zone === zone.id}
                  className={draft.zone === zone.id ? 'selected' : ''}
                  onClick={() => onChange({ zone: zone.id })}
                >
                  {zone.label}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="field-label">In the fridge since</span>
            <input
              type="datetime-local"
              max={toLocalInput()}
              value={draft.addedAtLocal}
              onChange={(e) => onChange({ addedAtLocal: e.target.value })}
            />
          </label>

          <label className="switch-field field-wide">
            <input
              type="checkbox"
              role="switch"
              checked={draft.packaged}
              onChange={(e) => onChange({ packaged: e.target.checked })}
            />
            <span className="switch" aria-hidden="true" />
            <span>
              Sealed or bagged {d.packaged && <AiMark />}
              <small>Humidity is ignored for sealed food</small>
            </span>
          </label>
        </>
      )}

      {show('freshness') && (
        <div className="field field-wide">
          <span className="field-label">How fresh does it look? {d.freshness && <AiMark title="Perceptron's rating" />}</span>
          <FreshnessPicker
            value={draft.freshness}
            onChange={(freshness) => onChange({ freshness })}
            suggested={d.freshness ?? null}
          />
          <input
            className="field-note"
            value={draft.freshnessNote}
            onChange={(e) => onChange({ freshnessNote: e.target.value })}
            placeholder="What you noticed, e.g. “a few soft spots” (optional)"
            maxLength={200}
            aria-label="Freshness note"
          />
        </div>
      )}

      {show('date') && (
        <div className="field field-wide">
          <span className="field-label">Printed date {d.expiresOn && <AiMark title="Read from the label" />}</span>
          <div className="date-row">
            <select
              value={draft.dateKind}
              onChange={(e) => onChange({ dateKind: e.target.value })}
              aria-label="Kind of printed date"
            >
              {Object.entries(DATE_KINDS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <input
              type="date"
              value={draft.expiresOn}
              onChange={(e) => onChange({ expiresOn: e.target.value })}
              aria-label="Printed date"
            />
            {draft.expiresOn && (
              <button type="button" className="btn btn-icon" onClick={() => onChange({ expiresOn: '' })} aria-label="Clear printed date">
                <X size={15} />
              </button>
            )}
          </div>
          <span className="field-help">
            {draft.dateText ? <>The label reads “{draft.dateText}”. Check it matches.</> : 'Optional. Leave blank if there is no date on the package.'}
          </span>
        </div>
      )}
    </div>
  )
}
