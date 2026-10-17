import { useEffect, useRef } from 'react'

let openCount = 0

// A native <dialog> shown with showModal(): the browser handles focus, Escape
// and making the page behind it inert. Mount it to open, unmount to close.
export default function Modal({ onClose, label, variant = 'center', className = '', children }) {
  const ref = useRef(null)
  const pressedBackdrop = useRef(false)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog.open) dialog.showModal()
    openCount += 1
    document.documentElement.classList.add('modal-open')
    return () => {
      openCount -= 1
      if (openCount === 0) document.documentElement.classList.remove('modal-open')
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className={`modal modal-${variant} ${className}`}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      // Close on a click that both starts and ends on the backdrop, so
      // dragging out of a text field does not dismiss the dialog.
      onMouseDown={(event) => { pressedBackdrop.current = event.target === ref.current }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === ref.current) onClose()
      }}
    >
      <div className="modal-panel">{children}</div>
    </dialog>
  )
}
