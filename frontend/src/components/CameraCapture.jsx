import { useEffect, useRef, useState } from 'react'
import { Aperture, Camera, CameraOff, ImageUp, RefreshCw, SwitchCamera } from 'lucide-react'
import { captureVideoFrame, prepareFile } from '../lib/image.js'

// Browsers only allow a live camera on HTTPS pages and localhost. Anywhere
// else, "Take photo" falls back to a file input with `capture`, which opens
// the phone's own camera app.
const liveSupported = () => Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext

function describeError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { state: 'blocked', message: 'Camera access is blocked. Allow it in your browser’s site settings, or use a photo instead.' }
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { state: 'error', message: 'No camera was found on this device.' }
    case 'NotReadableError':
      return { state: 'error', message: 'The camera is busy in another app. Close it and try again.' }
    default:
      return { state: 'error', message: 'The camera could not start.' }
  }
}

export default function CameraCapture({ onCapture, hint }) {
  const videoRef = useRef(null)
  const uploadRef = useRef(null)
  const nativeCameraRef = useRef(null)
  const [state, setState] = useState(liveSupported() ? 'starting' : 'unavailable')
  const [message, setMessage] = useState('')
  const [facing, setFacing] = useState('environment')
  const [canFlip, setCanFlip] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [flash, setFlash] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!liveSupported()) return undefined
    let cancelled = false
    let stream = null
    setState('starting')
    setMessage('')

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop())
          return
        }
        stream = s
        const video = videoRef.current
        video.srcObject = s
        await video.play().catch(() => {})
        if (cancelled) return
        setState('live')
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
        if (!cancelled) setCanFlip(devices.filter((d) => d.kind === 'videoinput').length > 1)
      })
      .catch((error) => {
        if (cancelled) return
        const { state: next, message: text } = describeError(error)
        setState(next)
        setMessage(text)
      })

    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [facing, attempt])

  const run = async (work) => {
    if (busy) return
    setBusy(true)
    try {
      onCapture(await work())
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  const shoot = () => {
    const video = videoRef.current
    if (state !== 'live' || !video?.videoWidth) return
    setFlash(true)
    setTimeout(() => setFlash(false), 280)
    run(() => captureVideoFrame(video))
  }

  const takeFile = (file) => file && run(() => prepareFile(file))

  const fallbackTitle = {
    unavailable: 'Live preview needs HTTPS',
    blocked: 'Camera access is off',
    error: 'Camera unavailable',
  }[state]

  return (
    <div className="camera">
      <div
        className={`viewfinder ${dragging ? 'dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          takeFile(event.dataTransfer.files?.[0])
        }}
      >
        {state !== 'unavailable' && (
          <video ref={videoRef} className={facing === 'user' ? 'mirrored' : ''} playsInline muted autoPlay />
        )}

        {(state === 'live' || state === 'starting') && (
          <div className="viewfinder-frame" aria-hidden="true">
            <span /><span /><span /><span />
          </div>
        )}
        {state === 'live' && hint && <div className="viewfinder-hint">{hint}</div>}
        {state === 'starting' && (
          <div className="viewfinder-status">
            <Aperture className="spin" size={22} />
            Starting camera…
          </div>
        )}

        {fallbackTitle && (
          <div className="viewfinder-fallback">
            <CameraOff size={28} strokeWidth={1.5} />
            <strong>{fallbackTitle}</strong>
            <p>
              {state === 'unavailable'
                ? 'This page isn’t on HTTPS, so the browser hides the live camera. Take photo still opens your phone’s camera.'
                : message}
            </p>
            <div className="fallback-actions">
              <button className="btn btn-active" onClick={() => nativeCameraRef.current?.click()} disabled={busy}>
                <Camera size={16} /> Take photo
              </button>
              <button className="btn" onClick={() => uploadRef.current?.click()} disabled={busy}>
                <ImageUp size={16} /> Choose photo
              </button>
              {state === 'blocked' && (
                <button className="btn" onClick={() => setAttempt((n) => n + 1)}>
                  <RefreshCw size={16} /> Try again
                </button>
              )}
            </div>
          </div>
        )}

        {dragging && <div className="viewfinder-drop">Drop a photo to use it</div>}
        {flash && <div className="viewfinder-flash" aria-hidden="true" />}
      </div>

      <div className="camera-controls">
        <button className="camera-side" onClick={() => uploadRef.current?.click()} disabled={busy}>
          <ImageUp size={20} />
          <span>Upload</span>
        </button>
        <button
          className="shutter"
          onClick={shoot}
          disabled={state !== 'live' || busy}
          aria-label="Take photo"
          title="Take photo"
        >
          <span />
        </button>
        <button
          className="camera-side"
          onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
          disabled={!canFlip || busy}
          title={canFlip ? 'Switch camera' : 'Only one camera found'}
        >
          <SwitchCamera size={20} />
          <span>Flip</span>
        </button>
      </div>
      {message && state === 'live' && <p className="form-error" role="alert">{message}</p>}

      <input
        ref={uploadRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          takeFile(file)
        }}
      />
      <input
        ref={nativeCameraRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          takeFile(file)
        }}
      />
    </div>
  )
}
