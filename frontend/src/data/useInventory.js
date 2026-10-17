import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'

// Polling keeps every open screen in step, so an item logged from a phone
// shows up on the laptop dashboard within a few seconds.
const POLL_MS = 8_000
const HEALTH_MS = 30_000

const signatureOf = (list) => list.map((i) => `${i.id}:${i.updatedAt}`).join('|')

export function useInventory() {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const signature = useRef(null)

  // Replace the list only when something changed, so unchanged polls do not
  // re-render the page or re-run the risk assessment.
  const commit = useCallback((next) => {
    const sig = signatureOf(next)
    if (sig === signature.current) return
    signature.current = sig
    setItems(next)
  }, [])

  const reload = useCallback(async () => {
    try {
      commit(await api.listItems())
      setStatus('ready')
      setError('')
    } catch (cause) {
      setStatus((s) => (s === 'ready' ? 'ready' : 'error'))
      setError(cause.message)
    }
  }, [commit])

  useEffect(() => {
    reload()
    const tick = () => document.visibilityState === 'visible' && reload()
    const timer = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [reload])

  const upsert = useCallback((item) => {
    setItems((list) => {
      const next = list.some((i) => i.id === item.id) ? list.map((i) => (i.id === item.id ? item : i)) : [item, ...list]
      signature.current = signatureOf(next)
      return next
    })
    return item
  }, [])

  const actions = {
    create: async (body) => upsert(await api.createItem(body)),
    update: async (id, changes) => upsert(await api.updateItem(id, changes)),
    addCheck: async (id, check) => upsert(await api.addCheck(id, check)),
    remove: async (id) => {
      await api.deleteItem(id)
      setItems((list) => {
        const next = list.filter((i) => i.id !== id)
        signature.current = signatureOf(next)
        return next
      })
    },
  }

  return { items, status, error, reload, ...actions }
}

export function useHealth() {
  const [health, setHealth] = useState(null)
  useEffect(() => {
    let cancelled = false
    const load = () => api.health().then((h) => !cancelled && setHealth(h)).catch(() => !cancelled && setHealth(null))
    load()
    const timer = setInterval(load, HEALTH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])
  return health
}
