// Keep pre-rename browser data available without replacing newer ShelfLife data.
export function readSavedValue(key, legacyKey) {
  const current = localStorage.getItem(key)
  if (current !== null) return current

  const legacy = localStorage.getItem(legacyKey)
  if (legacy !== null) {
    try {
      localStorage.setItem(key, legacy)
    } catch {
      // Still use the saved value this session if storage cannot be written.
    }
  }
  return legacy
}
