/**
 * DeviceTestModal — тест микрофона/камеры перед звонком.
 *
 * Props:
 *   open: bool
 *   onClose: () => void
 *   onConfirm: ({mic, cam}) => void — пользователь нажал «Начать звонок»
 *   title?: string — заголовок (по умолчанию «Проверьте устройства»)
 *   confirmLabel?: string — текст кнопки confirm (по умолч. «Начать звонок»)
 */
import { useEffect, useRef, useState } from 'react'
import {
  getPreferredMic, setPreferredMic,
  getPreferredCam, setPreferredCam,
} from '../../lib/deviceStorage'

export default function DeviceTestModal({
  open, onClose, onConfirm,
  title = 'Проверьте устройства',
  confirmLabel = 'Начать звонок',
}) {
  const [mics, setMics] = useState([])
  const [cams, setCams] = useState([])
  const [selectedMic, setSelectedMic] = useState(getPreferredMic())
  const [selectedCam, setSelectedCam] = useState(getPreferredCam())
  const [error, setError] = useState('')
  const [level, setLevel] = useState(0)   // 0..100, VU-meter
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const rafRef = useRef(0)

  // Enumerate devices при open
  useEffect(() => {
    if (!open) return
    setError('')
    navigator.mediaDevices.enumerateDevices().then(list => {
      setMics(list.filter(d => d.kind === 'audioinput'))
      setCams(list.filter(d => d.kind === 'videoinput'))
    }).catch(e => setError('Не удалось получить список устройств: ' + (e?.message || e)))
  }, [open])

  // Старт live-preview при смене устройств
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function start() {
      // Останавливаем предыдущий stream
      cleanup()
      try {
        const constraints = {
          audio: selectedMic ? { deviceId: { exact: selectedMic } } : true,
          video: selectedCam ? { deviceId: { exact: selectedCam } } : true,
        }
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        // VU-meter setup
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
        audioCtxRef.current = audioCtx
        const source = audioCtx.createMediaStreamSource(stream)
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          analyser.getByteFrequencyData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) sum += data[i]
          const avg = sum / data.length
          setLevel(Math.min(100, Math.round((avg / 128) * 100)))
          rafRef.current = requestAnimationFrame(tick)
        }
        tick()
        setError('')
      } catch (e) {
        setError('Не удалось открыть устройство: ' + (e?.message || e))
      }
    }
    start()
    return () => { cancelled = true; cleanup() }
  }, [open, selectedMic, selectedCam])

  function cleanup() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close() } catch {}
      audioCtxRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  const confirm = () => {
    setPreferredMic(selectedMic)
    setPreferredCam(selectedCam)
    cleanup()
    onConfirm?.({ mic: selectedMic, cam: selectedCam })
  }

  const close = () => { cleanup(); onClose?.() }

  if (!open) return null

  const inputStyle = {
    width: '100%', padding: '8px 12px', borderRadius: 10,
    background: 'var(--bg-1, #f6f6f8)',
    border: '1px solid var(--border, rgba(0,0,0,.08))',
    color: 'var(--fg, #0F172A)', fontSize: 14,
  }

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(4px)' }}
      onClick={close}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-3xl overflow-hidden p-5 space-y-3"
        style={{ background: 'var(--bg, #fff)', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}
      >
        <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>

        {/* Live preview */}
        <div
          style={{
            position: 'relative',
            background: '#000', borderRadius: 14, overflow: 'hidden',
            aspectRatio: '16/9',
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          {/* VU-meter overlay */}
          <div
            style={{
              position: 'absolute', bottom: 8, left: 8, right: 8, height: 8,
              borderRadius: 4, background: 'rgba(255,255,255,.18)', overflow: 'hidden',
            }}
            title="Уровень микрофона"
          >
            <div
              style={{
                width: `${level}%`, height: '100%',
                background: level > 70 ? '#ef4444' : level > 40 ? '#22c55e' : '#94a3b8',
                transition: 'width 60ms linear',
              }}
            />
          </div>
        </div>

        {/* Device selectors */}
        <label>
          <div style={{ fontSize: 12, color: 'var(--fg-2, #475569)', marginBottom: 4 }}>
            Микрофон
          </div>
          <select
            value={selectedMic}
            onChange={e => setSelectedMic(e.target.value)}
            style={inputStyle}
          >
            <option value="">Системный по умолчанию</option>
            {mics.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Микрофон ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div style={{ fontSize: 12, color: 'var(--fg-2, #475569)', marginBottom: 4 }}>
            Камера
          </div>
          <select
            value={selectedCam}
            onChange={e => setSelectedCam(e.target.value)}
            style={inputStyle}
          >
            <option value="">Системная по умолчанию</option>
            {cams.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Камера ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <div
            className="rounded-xl p-3"
            style={{ background: '#fee2e2', color: '#991b1b', fontSize: 13 }}
          >
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={close}
            className="flex-1 py-2.5 rounded-xl font-semibold"
            style={{ background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}
          >
            Отмена
          </button>
          <button
            onClick={confirm}
            disabled={!!error}
            className="flex-1 py-2.5 rounded-xl font-semibold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
