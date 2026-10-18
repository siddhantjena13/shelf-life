// Thin client for the FastAPI backend. Every call throws an Error whose
// message is safe to show the user.

async function request(path, { method = 'GET', json, form } = {}) {
  let response
  try {
    response = await fetch(path, {
      method,
      headers: json ? { 'Content-Type': 'application/json' } : undefined,
      body: json ? JSON.stringify(json) : form,
    })
  } catch {
    throw new Error('Could not reach the ShelfLife backend. Is it running?')
  }
  if (response.status === 204) return null
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = Array.isArray(payload.detail)
      ? payload.detail.map((d) => d.msg).join('; ')
      : payload.detail
    throw new Error(detail || (response.status >= 500 ? 'The backend could not complete that request.' : 'That request was rejected.'))
  }
  return payload
}

function localToday() {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

function photoForm(blob) {
  const form = new FormData()
  form.append('image', blob, 'photo.jpg')
  form.append('today', localToday())
  return form
}

export const api = {
  health: () => request('/api/health'),
  listItems: () => request('/api/inventory').then((r) => r.items),
  createItem: (item) => request('/api/inventory', { method: 'POST', json: item }),
  updateItem: (id, changes) => request(`/api/inventory/${id}`, { method: 'PATCH', json: changes }),
  deleteItem: (id) => request(`/api/inventory/${id}`, { method: 'DELETE' }),
  addCheck: (id, check) => request(`/api/inventory/${id}/checks`, { method: 'POST', json: check }),
  scanNew: (blob) => request('/api/inventory/scan', { method: 'POST', form: photoForm(blob) }),
  scanExisting: (id, blob) => request(`/api/inventory/${id}/scan`, { method: 'POST', form: photoForm(blob) }),
}

export const photoUrl = (photoId) => (photoId ? `/api/photos/${photoId}` : null)
