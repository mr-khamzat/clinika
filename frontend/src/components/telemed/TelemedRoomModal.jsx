/**
 * ========================================
 * БЛОК: TelemedRoomModal — видео-комната врача
 * ========================================
 * Полноэкранная модалка для проведения телемедицинской консультации
 * со стороны сотрудника клиники (врач/регистратор/менеджер).
 *
 * Поток работы:
 *   1) GET  /telemed/sessions/{id}/ice-config     — получаем TURN/STUN
 *   2) WS   /telemed/ws/doctor/{session_id}       — сигналинг
 *   3) Принимаем offer от пациента → отвечаем answer (WebRTC)
 *   4) Обмен ICE-кандидатами через WS
 *   5) POST /telemed/sessions/{id}/start          — фиксируем старт
 *   6) Чат: GET/POST /telemed/sessions/{id}/messages (multipart с file)
 *   7) Рецепт: POST /telemed/sessions/{id}/prescription
 *   8) POST /telemed/sessions/{id}/end + close PC + close WS
 *
 * Используется из:
 *   - WeekScheduleSection (ApptModal → кнопка «Начать телемед-приём»)
 *   - TelemedicineSection (детальный просмотр + продолжение)
 * ========================================
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import api from '../../api'
import { API_BASE } from '../../config'
import useAuthStore from '../../store/auth'
import { Button, Modal } from '../../design'

const DEFAULT_RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
}

export default function TelemedRoomModal({ sessionId, onClose }) {
  const { token } = useAuthStore()
  const [loading, setLoading]         = useState(true)
  const [err, setErr]                 = useState('')
  const [connState, setConnState]     = useState('connecting')  // connecting|waiting|connected|ended
  const [micOn, setMicOn]             = useState(true)
  const [camOn, setCamOn]             = useState(true)
  const [screenShare, setScreenShare] = useState(false)
  const [chatOpen, setChatOpen]       = useState(true)
  const [messages, setMessages]       = useState([])
  const [chatInput, setChatInput]     = useState('')
  const [showRx, setShowRx]           = useState(false)
  const [rxText, setRxText]           = useState('')
  const [rxSaving, setRxSaving]       = useState(false)
  const [rxOk, setRxOk]               = useState(false)
  const [duration, setDuration]       = useState(0)

  const wsRef          = useRef(null)
  const pcRef          = useRef(null)
  const localStreamRef = useRef(null)
  const screenStreamRef = useRef(null)
  const localVideoRef  = useRef(null)
  const remoteVideoRef = useRef(null)
  const pendingIceRef  = useRef([])
  const iceConfigRef   = useRef(DEFAULT_RTC_CONFIG)
  const startedAtRef   = useRef(null)
  const fileInputRef   = useRef(null)
  const cleanupRef     = useRef(false)

  // ─── Init: ICE config + media + WS ───
  useEffect(() => {
    let aborted = false
    const init = async () => {
      try {
        // 1. ICE config
        const iceRes = await api.get(`/telemed/sessions/${sessionId}/ice-config`)
        if (iceRes.data?.iceServers) {
          iceConfigRef.current = {
            ...DEFAULT_RTC_CONFIG,
            iceServers: iceRes.data.iceServers,
          }
        }
        if (aborted) return

        // 2. Local media (cam + mic)
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (aborted) {
          stream.getTracks().forEach(t => t.stop())
          return
        }
        localStreamRef.current = stream
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream
          localVideoRef.current.muted = true
          localVideoRef.current.play?.().catch(() => {})
        }

        // 3. PeerConnection
        const pc = new RTCPeerConnection(iceConfigRef.current)
        pcRef.current = pc
        for (const tr of stream.getTracks()) pc.addTrack(tr, stream)

        pc.onicecandidate = (e) => {
          if (e.candidate) sendWs({ type: 'ice_candidate', candidate: e.candidate.toJSON() })
        }
        pc.ontrack = (e) => {
          const remote = e.streams[0]
          if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== remote) {
            remoteVideoRef.current.srcObject = remote
            remoteVideoRef.current.play?.().catch(() => {})
          }
        }
        pc.onconnectionstatechange = () => {
          const s = pc.connectionState
          if (s === 'connected') {
            setConnState('connected')
            if (!startedAtRef.current) {
              startedAtRef.current = Date.now()
              api.post(`/telemed/sessions/${sessionId}/start`).catch(() => {})
            }
          } else if (s === 'failed' || s === 'disconnected' || s === 'closed') {
            setConnState('ended')
          }
        }

        // 4. WebSocket signaling
        const wsUrl = API_BASE.replace(/^http/, 'ws') +
          `/telemed/ws/doctor/${sessionId}?token=${encodeURIComponent(token)}`
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws
        ws.onopen = () => setConnState('waiting')
        ws.onmessage = async (ev) => {
          let msg
          try { msg = JSON.parse(ev.data) } catch { return }
          switch (msg.type) {
            case 'offer':
              // Пациент создал offer — отвечаем answer
              try {
                await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
                for (const c of pendingIceRef.current) {
                  await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
                }
                pendingIceRef.current = []
                const answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                sendWs({ type: 'answer', sdp: { type: answer.type, sdp: answer.sdp } })
              } catch (e) {
                setErr('Не удалось обработать offer пациента')
              }
              break
            case 'ice_candidate':
              if (pc.remoteDescription) {
                await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {})
              } else {
                pendingIceRef.current.push(msg.candidate)
              }
              break
            case 'patient_joined':
              setConnState('waiting')
              break
            case 'chat_message':
              setMessages(m => [...m, msg.message || msg])
              break
            case 'session_ended':
              setConnState('ended')
              break
          }
        }
        ws.onerror = () => setErr('Ошибка WebSocket-соединения')
        ws.onclose = () => {
          if (!cleanupRef.current) setConnState('ended')
        }

        // 5. Загрузим существующие сообщения чата
        try {
          const ms = await api.get(`/telemed/sessions/${sessionId}/messages`)
          if (Array.isArray(ms.data)) setMessages(ms.data)
        } catch {}

        setLoading(false)
      } catch (e) {
        setErr(e?.message || 'Ошибка инициализации видео-комнаты')
        setLoading(false)
      }
    }
    init()
    return () => {
      aborted = true
      cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // ─── Таймер длительности ───
  useEffect(() => {
    if (connState !== 'connected') return
    const t = setInterval(() => {
      if (startedAtRef.current) {
        setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000))
      }
    }, 1000)
    return () => clearInterval(t)
  }, [connState])

  const sendWs = (msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }

  // ─── Контролы медиа ───
  const toggleMic = () => {
    const s = localStreamRef.current
    if (!s) return
    const tr = s.getAudioTracks()[0]
    if (tr) {
      tr.enabled = !tr.enabled
      setMicOn(tr.enabled)
    }
  }

  const toggleCam = () => {
    const s = localStreamRef.current
    if (!s) return
    const tr = s.getVideoTracks()[0]
    if (tr) {
      tr.enabled = !tr.enabled
      setCamOn(tr.enabled)
    }
  }

  const toggleScreenShare = async () => {
    const pc = pcRef.current
    if (!pc) return
    try {
      if (!screenShare) {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        screenStreamRef.current = screen
        const screenTr = screen.getVideoTracks()[0]
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video')
        if (sender) await sender.replaceTrack(screenTr)
        screenTr.onended = () => stopScreenShare()
        setScreenShare(true)
      } else {
        stopScreenShare()
      }
    } catch (e) {
      // user cancelled or no permission
    }
  }

  const stopScreenShare = () => {
    const pc = pcRef.current
    const screen = screenStreamRef.current
    if (screen) screen.getTracks().forEach(t => t.stop())
    screenStreamRef.current = null
    const cam = localStreamRef.current?.getVideoTracks()[0]
    if (pc && cam) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video')
      if (sender) sender.replaceTrack(cam)
    }
    setScreenShare(false)
  }

  // ─── Чат ───
  const sendChatText = async () => {
    const text = chatInput.trim()
    if (!text) return
    try {
      const fd = new FormData()
      fd.append('text', text)
      const r = await api.post(
        `/telemed/sessions/${sessionId}/messages`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      setMessages(m => [...m, r.data])
      setChatInput('')
      sendWs({ type: 'chat_message', message: r.data })
    } catch (e) {
      setErr('Не удалось отправить сообщение')
    }
  }

  const sendChatFile = async (file) => {
    if (!file) return
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('text', file.name)
      const r = await api.post(
        `/telemed/sessions/${sessionId}/messages`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      setMessages(m => [...m, r.data])
      sendWs({ type: 'chat_message', message: r.data })
    } catch (e) {
      setErr('Не удалось отправить файл')
    }
  }

  // ─── Рецепт ───
  const submitRx = async () => {
    if (!rxText.trim()) return
    setRxSaving(true)
    setRxOk(false)
    try {
      await api.post(`/telemed/sessions/${sessionId}/prescription`, {
        content: rxText.trim(),
      })
      setRxOk(true)
      setRxText('')
      setTimeout(() => setShowRx(false), 1200)
    } catch (e) {
      setErr('Не удалось сохранить рецепт')
    } finally {
      setRxSaving(false)
    }
  }

  // ─── Завершение ───
  const handleEnd = async () => {
    try { await api.post(`/telemed/sessions/${sessionId}/end`) } catch {}
    cleanup()
    if (onClose) onClose()
  }

  const cleanup = () => {
    cleanupRef.current = true
    try { if (wsRef.current) wsRef.current.close() } catch {}
    try {
      if (pcRef.current) {
        pcRef.current.getSenders().forEach(s => { try { s.track?.stop() } catch {} })
        pcRef.current.close()
      }
    } catch {}
    try {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop())
    } catch {}
    try {
      if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => t.stop())
    } catch {}
    wsRef.current = null
    pcRef.current = null
    localStreamRef.current = null
    screenStreamRef.current = null
  }

  const fmtDur = (s) => {
    const m = Math.floor(s / 60)
    const ss = s % 60
    return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  }

  // ─── Render ───
  return (
    <div
      className="fixed inset-0 z-[10000] flex flex-col"
      style={{ background: '#0b0e13' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[#0097A7]" style={{ fontVariationSettings: "'FILL' 1" }}>
            videocam
          </span>
          <div>
            <div className="text-white text-sm font-bold">Телемед-приём</div>
            <div className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {connState === 'connecting' && 'Подключение...'}
              {connState === 'waiting'    && 'Ожидание пациента...'}
              {connState === 'connected'  && `В эфире · ${fmtDur(duration)}`}
              {connState === 'ended'      && 'Сессия завершена'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setShowRx(true)}>Рецепт</Button>
          <Button variant="secondary" onClick={() => setChatOpen(o => !o)}>
            {chatOpen ? 'Скрыть чат' : 'Чат'}
          </Button>
          <Button variant="primary" onClick={handleEnd} style={{ background: '#ef4444', borderColor: '#ef4444' }}>
            Завершить
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Видео-зона */}
        <div className="flex-1 relative" style={{ background: '#000' }}>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-contain"
          />
          {/* PiP local */}
          <div
            className="absolute bottom-4 right-4 rounded-xl overflow-hidden border"
            style={{ width: 220, height: 140, borderColor: 'rgba(255,255,255,0.12)', background: '#1a1f26' }}
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
          </div>

          {/* Состояние */}
          {(loading || connState === 'connecting' || connState === 'waiting') && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center text-white">
                <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-3"></div>
                <div className="text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>
                  {loading ? 'Запрос камеры/микрофона…' :
                   connState === 'waiting' ? 'Ожидание подключения пациента…' :
                   'Подключение…'}
                </div>
              </div>
            </div>
          )}

          {/* Контролы */}
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-2 rounded-2xl"
            style={{ background: 'rgba(20,24,30,0.85)', backdropFilter: 'blur(10px)' }}
          >
            <CtrlBtn icon={micOn ? 'mic' : 'mic_off'} active={micOn} onClick={toggleMic} title="Микрофон" />
            <CtrlBtn icon={camOn ? 'videocam' : 'videocam_off'} active={camOn} onClick={toggleCam} title="Камера" />
            <CtrlBtn icon="screen_share" active={screenShare} onClick={toggleScreenShare} title="Демо экрана" />
            <CtrlBtn icon="call_end" active onClick={handleEnd} danger title="Завершить" />
          </div>
        </div>

        {/* Чат */}
        {chatOpen && (
          <div
            className="w-80 flex flex-col border-l"
            style={{ borderColor: 'rgba(255,255,255,0.08)', background: '#11151b' }}
          >
            <div className="px-4 py-3 border-b text-white font-semibold text-sm" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              Чат сессии
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
              {messages.length === 0 && (
                <div className="text-xs text-center mt-4" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  Сообщений пока нет
                </div>
              )}
              {messages.map((m, idx) => {
                const mine = m.sender_role === 'doctor' || m.sender_role === 'staff' || m.from_role === 'doctor'
                return (
                  <div key={m.id || idx} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className="max-w-[85%] rounded-2xl px-3 py-2 text-xs"
                      style={{
                        background: mine ? '#0097A7' : 'rgba(255,255,255,0.08)',
                        color: mine ? '#fff' : 'rgba(255,255,255,0.92)',
                      }}
                    >
                      {m.text && <div className="whitespace-pre-wrap">{m.text}</div>}
                      {m.file_url && (
                        <a
                          href={m.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline block mt-1"
                          style={{ color: mine ? '#fff' : '#0097A7' }}
                        >
                          {m.file_name || 'Файл'}
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="p-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) sendChatFile(f)
                  e.target.value = ''
                }}
                className="hidden"
              />
              <div className="flex items-end gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl p-2"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)' }}
                  title="Прикрепить файл"
                >
                  <span className="material-symbols-outlined text-base">attach_file</span>
                </button>
                <textarea
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendChatText()
                    }
                  }}
                  placeholder="Сообщение…"
                  rows={1}
                  className="flex-1 rounded-xl px-3 py-2 text-xs resize-none"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.08)',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={sendChatText}
                  disabled={!chatInput.trim()}
                  className="rounded-xl p-2"
                  style={{
                    background: chatInput.trim() ? '#0097A7' : 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    opacity: chatInput.trim() ? 1 : 0.5,
                  }}
                >
                  <span className="material-symbols-outlined text-base">send</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {err && (
        <div
          className="absolute top-16 left-1/2 -translate-x-1/2 rounded-xl px-4 py-2 text-sm"
          style={{ background: 'rgba(239,68,68,0.95)', color: '#fff' }}
        >
          {err}
        </div>
      )}

      {/* Модал выписки рецепта */}
      {showRx && (
        <Modal open onClose={() => setShowRx(false)} title="Электронный рецепт">
          <textarea
            value={rxText}
            onChange={e => setRxText(e.target.value)}
            placeholder={"Например:\n• Парацетамол 500мг 1т х 3 р/д — 3 дня\n• Ибупрофен 200мг 1т х 2 р/д — 5 дней"}
            rows={10}
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={{
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--fg)',
              outline: 'none',
              resize: 'vertical',
            }}
          />
          <div className="text-xs mt-2" style={{ color: 'var(--fg-3)' }}>
            Поддерживается Markdown. Рецепт сохраняется в карточке пациента и доступен в его кабинете.
          </div>
          {rxOk && (
            <div className="mt-2 text-xs px-3 py-2 rounded-xl"
              style={{ background: 'rgba(34,197,94,0.10)', color: '#15803d' }}>
              Рецепт сохранён
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <Button variant="secondary" onClick={() => setShowRx(false)} className="flex-1">Закрыть</Button>
            <Button variant="primary" onClick={submitRx} disabled={rxSaving || !rxText.trim()} className="flex-1">
              {rxSaving ? 'Сохранение…' : 'Подписать и отправить'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Кнопка-контрол медиа ───
function CtrlBtn({ icon, active, onClick, danger, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-full w-11 h-11 flex items-center justify-center transition-all"
      style={{
        background: danger ? '#ef4444' : (active ? '#0097A7' : 'rgba(255,255,255,0.10)'),
        color: '#fff',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>{icon}</span>
    </button>
  )
}
