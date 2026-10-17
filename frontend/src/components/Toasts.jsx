import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const TOAST_MS = 5000

export function useToasts() {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(0)

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), [])
  const notify = useCallback((message, action) => {
    const id = ++nextId.current
    setToasts((list) => [...list.slice(-2), { id, message, action }])
    setTimeout(() => dismiss(id), TOAST_MS)
  }, [dismiss])

  return { toasts, notify, dismiss }
}

export default function Toasts({ toasts, dismiss }) {
  // While a modal dialog is open, the rest of the page is inert and drawn
  // under its backdrop, so toasts render inside the topmost dialog instead.
  const [host, setHost] = useState(null)
  useLayoutEffect(() => {
    const top = [...document.querySelectorAll('dialog.modal')].pop() ?? document.body
    if (top !== host) setHost(top)
  })

  if (!host || !toasts.length) return null
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                toast.action.run()
                dismiss(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    host,
  )
}
