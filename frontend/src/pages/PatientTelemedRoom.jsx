/**
 * ========================================
 * БЛОК: PatientTelemedRoom — публичная страница пациента для телемед-приёма
 * ========================================
 * Маршрут: /p/telemed/:token  (или /<slug>/p/telemed/:token)
 *
 * Не требует логина — доступ по одноразовому JWT-токену сессии.
 * Mobile-first. Этапы:
 *   1) GET   /patient-portal/telemed/{token}/info        — врач, время, флаги
 *   2) Pre-call: камера/микрофон permission, выбор устройств
 *   3) Согласие на ПД (+ опц. на запись)
 *      POST /patient-portal/telemed/{token}/consent
 *   4) GET   /patient-portal/telemed/{token}/ice-config
 *   5) WS    /telemed/ws/{token}                         — сигналинг (offer + ICE)
 *   6) Видео-комната с remote video + PiP + контролы + чат
 * ========================================
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE, BASE_PATH } from '../config'

const DEFAULT_RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
}

// Извлекаем токен из URL: /p/telemed/<token> или /<slug>/p/telemed/<token>
function extractToken() {
  const m = window.location.pathname.match(/\/p\/telemed\/([^/?#]+)/)
  return m ? m[1] : null
}

export default function PatientTelemedRoom() {
  const token = useMemo(extractToken, [])
  const [stage, setStage] = useState('loading')   // loading|info|consent|precheck|connecting|inroom|ended|error
  const [info, setInfo]   = useState(null)
  const [err, setErr]     = useState('')

  // Согласие
  const [consentPd, setConsentPd]           = useState(false)
  const [consentRec, setConsentRec]         = useState(false)
  const [submittingConsent, setSubmittingConsent] = useState(false)

  // Pre-call
  const [devices, setDevices]   = useState({ cams: [], mics: [] })
  const [selectedCam, setSelectedCam] = useState('')
  const [selectedMic, setSelectedMic] = useState('')
  const [previewStream, setPreviewStream] = useState(null)

  // In-room
  const [micOn, setMicOn]       = useState(true)
  const [camOn, setCamOn]       = useState(true)
  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [connQuality, setConnQuality] = useState('good')   // good|poor|audio_only
  const [duration, setDuration]       = useState(0)

  const wsRef           = useRef(null)
  const pcRef           = useRef(null)
  const localStreamRef  = useRef(null)
  const localVideoRef   = useRef(null)
  const remoteVideoRef  = useRef(null)
  const previewVideoRef = useRef(null)
  const pendingIceRef   = useRef([])
  const iceConfigRef    = useRef(DEFAULT_RTC_CONFIG)
  const startedAtRef    = useRef(null)
  const cleanupRef      = useRef(false)

  // ─── Bootstrap: token check + GET info ───
  useEffect(() => {
    if (!token) {
      setErr('Не найден токен сессии в URL')
      setStage('error')
      return
    }
    let aborted = false
    fetch(`${API_BASE}/patient-portal/telemed/${token}/info`)
      .then(r => {
        if (!r.ok) throw new Error('Сессия не найдена или истекла')
        return r.json()
      })
      .then(data => {
        if (aborted) return
        setInfo(data)
        setStage('info')
      })
      .catch(e => {
        if (aborted) return
        setErr(e.message || 'Ошибка загрузки информации о сессии')
        setStage('error')
      })
    return () => { aborted = true }
  }, [token])

  // ─── Перечисление устройств для pre-check ───
  useEffect(() => {
    if (stage !== 'precheck') return
    let aborted = false
    const run = async () => {
      try {
        // Сначала просим permission, иначе deviceId не виден
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
        tmp.getTracks().forEach(t => t.stop())
        if (aborted) return
        const list = await navigator.mediaDevices.enumerateDevices()
        const cams = list.filter(d => d.kind === 'videoinput')
        const mics = list.filter(d => d.kind === 'audioinput')
        setDevices({ cams, mics })
        if (cams[0]) setSelectedCam(cams[0].deviceId)
        if (mics[0]) setSelectedMic(mics[0].deviceId)
      } catch (e) {
        setErr('Не удалось получить доступ к камере/микрофону. Разрешите доступ в настройках браузера.')
      }
    }
    run()
    return () => { aborted = true }
  }, [stage])

  // ─── Превью камеры в pre-check ───
  useEffect(() => {
    if (stage !== 'precheck' || !selectedCam) return
    let stream
    let aborted = false
    const run = async () => {
      try {
        if (previewStream) previewStream.getTracks().forEach(t => t.stop())
        stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedMic ? { deviceId: { exact: selectedMic } } : true,
          video: { deviceId: { exact: selectedCam } },
        })
        if (aborted) {
          stream.getTracks().forEach(t => t.stop())
          return
        }
        setPreviewStream(stream)
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = stream
          previewVideoRef.current.muted = true
          previewVideoRef.current.play?.().catch(() => {})
        }
      } catch (e) {}
    }
    run()
    return () => {
      aborted = true
      if (stream) stream.getTracks().forEach(t => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCam, selectedMic, stage])

  // ─── Submit consent → переход в pre-check ───
  const submitConsent = async () => {
    if (!consentPd) return
    setSubmittingConsent(true)
    setErr('')
    try {
      const r = await fetch(`${API_BASE}/patient-portal/telemed/${token}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personal_data: true, recording: !!consentRec }),
      })
      if (!r.ok) {
        const detail = await r.json().catch(() => ({}))
        throw new Error(detail.detail || 'Не удалось сохранить согласие')
      }
      setStage('precheck')
    } catch (e) {
      setErr(e.message)
    } finally {
      setSubmittingConsent(false)
    }
  }

  // ─── Старт WebRTC: ICE → media → PC → WS → offer ───
  const startCall = async () => {
    setStage('connecting')
    setErr('')
    try {
      // 1. ICE
      const iceRes = await fetch(`${API_BASE}/patient-portal/telemed/${token}/ice-config`)
      if (iceRes.ok) {
        const d = await iceRes.json()
        if (d?.iceServers) iceConfigRef.current = { ...DEFAULT_RTC_CONFIG, iceServers: d.iceServers }
      }

      // 2. Используем поток из pre-check, если есть; иначе создаём новый
      let stream = previewStream
      if (!stream || stream.getTracks().some(t => t.readyState === 'ended')) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedMic ? { deviceId: { exact: selectedMic } } : true,
          video: selectedCam ? { deviceId: { exact: selectedCam } } : true,
        })
      }
      localStreamRef.current = stream
      setPreviewStream(null)
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        localVideoRef.current.muted = true
        localVideoRef.current.play?.().catch(() => {})
      }

      // 3. PC
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
          setStage('inroom')
          startedAtRef.current = Date.now()
        } else if (s === 'failed' || s === 'disconnected' || s === 'closed') {
          if (!cleanupRef.current) {
            setErr(s === 'disconnected' ? 'Соединение разорвано' : 'Сессия завершена')
            setStage('ended')
          }
        }
      }

      // 4. WS
      const wsUrl = API_BASE.replace(/^http/, 'ws') + `/telemed/ws/${token}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = async () => {
        // 5. Создаём offer
        try {
          const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
          await pc.setLocalDescription(offer)
          sendWs({ type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } })
        } catch (e) {
          setErr('Не удалось создать offer')
        }
      }
      ws.onmessage = async (ev) => {
        let msg
        try { msg = JSON.parse(ev.data) } catch { return }
        switch (msg.type) {
          case 'answer':
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
              for (const c of pendingIceRef.current) {
                await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
              }
              pendingIceRef.current = []
            } catch (e) {
              setErr('Не удалось установить answer')
            }
            break
          case 'ice_candidate':
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {})
            } else {
              pendingIceRef.current.push(msg.candidate)
            }
            break
          case 'chat_message':
            setMessages(m => [...m, msg.message || msg])
            break
          case 'session_ended':
            setStage('ended')
            cleanup()
            break
        }
      }
      ws.onerror = () => setErr('Ошибка WebSocket-соединения')
      ws.onclose = () => {
        if (!cleanupRef.current) {
          // Если ещё в комнате — фиксируем как ended
          setStage(prev => (prev === 'inroom' ? 'ended' : prev))
        }
      }
    } catch (e) {
      setErr(e?.message || 'Ошибка запуска видеозвонка')
      setStage('error')
    }
  }

  // ─── Таймер ───
  useEffect(() => {
    if (stage !== 'inroom') return
    const t = setInterval(() => {
      if (startedAtRef.current) {
        setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000))
      }
    }, 1000)
    return () => clearInterval(t)
  }, [stage])

  // ─── Мониторинг качества связи (RTCStats) ───
  useEffect(() => {
    if (stage !== 'inroom' || !pcRef.current) return
    const interval = setInterval(async () => {
      try {
        const stats = await pcRef.current.getStats()
        let pktLoss = 0, pktTotal = 0
        stats.forEach(r => {
          if (r.type === 'inbound-rtp' && !r.isRemote) {
            if (typeof r.packetsLost === 'number') pktLoss += r.packetsLost
            if (typeof r.packetsReceived === 'number') pktTotal += r.packetsReceived
          }
        })
        const lossPct = pktTotal ? (pktLoss / (pktLoss + pktTotal)) * 100 : 0
        if (lossPct > 15) setConnQuality('poor')
        else setConnQuality('good')
      } catch {}
    }, 5000)
    return () => clearInterval(interval)
  }, [stage])

  // ─── Cleanup ───
  useEffect(() => () => cleanup(), [])

  const sendWs = (msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg))
  }

  const toggleMic = () => {
    const s = localStreamRef.current
    if (!s) return
    const tr = s.getAudioTracks()[0]
    if (tr) { tr.enabled = !tr.enabled; setMicOn(tr.enabled) }
  }
  const toggleCam = () => {
    const s = localStreamRef.current
    if (!s) return
    const tr = s.getVideoTracks()[0]
    if (tr) { tr.enabled = !tr.enabled; setCamOn(tr.enabled) }
  }

  const fallbackAudioOnly = () => {
    const s = localStreamRef.current
    if (!s) return
    s.getVideoTracks().forEach(t => { t.enabled = false })
    setCamOn(false)
    setConnQuality('audio_only')
  }

  const sendChatText = async () => {
    const text = chatInput.trim()
    if (!text) return
    const tmp = { id: 'tmp-' + Date.now(), text, sender_role: 'patient', created_at: new Date().toISOString() }
    setMessages(m => [...m, tmp])
    setChatInput('')
    sendWs({ type: 'chat_message', text })
  }

  const handleEnd = () => {
    sendWs({ type: 'leave' })
    cleanup()
    setStage('ended')
  }

  const cleanup = () => {
    cleanupRef.current = true
    try { wsRef.current?.close() } catch {}
    try {
      if (pcRef.current) {
        pcRef.current.getSenders().forEach(s => { try { s.track?.stop() } catch {} })
        pcRef.current.close()
      }
    } catch {}
    try { localStreamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
    try { previewStream?.getTracks().forEach(t => t.stop()) } catch {}
    wsRef.current = null
    pcRef.current = null
    localStreamRef.current = null
  }

  const fmtDur = (s) => {
    const m = Math.floor(s / 60)
    const ss = s % 60
    return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  }

  // ─── UI ───
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0b0e13', color: '#fff' }}>
      {/* Top bar */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#0097A7]" style={{ fontVariationSettings: "'FILL' 1" }}>health_and_safety</span>
          <div>
            <div className="text-sm font-bold">Телемед-приём</div>
            {stage === 'inroom' && (
              <div className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
                В эфире · {fmtDur(duration)}
              </div>
            )}
          </div>
        </div>
        {connQuality !== 'good' && stage === 'inroom' && (
          <div className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'rgba(245,158,11,0.18)', color: '#fbbf24' }}>
            {connQuality === 'audio_only' ? 'Только аудио' : 'Слабая связь'}
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col">
        {/* LOADING */}
        {stage === 'loading' && (
          <Centered>
            <Spinner />
            <div className="text-sm mt-3" style={{ color: 'rgba(255,255,255,0.7)' }}>Загрузка…</div>
          </Centered>
        )}

        {/* ERROR */}
        {stage === 'error' && (
          <Centered>
            <span className="material-symbols-outlined text-5xl mb-3" style={{ color: '#ef4444' }}>error</span>
            <div className="text-base font-semibold mb-1">Не удалось открыть приём</div>
            <div className="text-sm mb-4 text-center max-w-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>{err}</div>
            <button onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl text-sm font-semibold"
              style={{ background: '#0097A7', color: '#fff' }}>
              Попробовать снова
            </button>
          </Centered>
        )}

        {/* INFO */}
        {stage === 'info' && info && (
          <Centered>
            <div className="w-full max-w-md p-6">
              <div className="rounded-2xl p-5 mb-4" style={{ background: 'rgba(0,151,167,0.12)' }}>
                <div className="text-xs uppercase tracking-wider mb-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Ваш приём
                </div>
                <div className="text-xl font-bold mb-1">{info.doctor_name || 'Врач'}</div>
                <div className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  {info.doctor_specialty || ''}
                </div>
                {info.scheduled_at && (
                  <div className="text-sm mt-2 font-mono">
                    {new Date(info.scheduled_at).toLocaleString('ru-RU', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
              <ul className="text-sm space-y-2 mb-5" style={{ color: 'rgba(255,255,255,0.75)' }}>
                <li className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-base mt-0.5" style={{ color: '#0097A7' }}>check_circle</span>
                  Приём проходит в браузере, без установки приложений
                </li>
                <li className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-base mt-0.5" style={{ color: '#0097A7' }}>check_circle</span>
                  Понадобится камера и микрофон
                </li>
                <li className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-base mt-0.5" style={{ color: '#0097A7' }}>check_circle</span>
                  По завершении приёма врач может выписать электронный рецепт
                </li>
              </ul>
              <button
                onClick={() => setStage('consent')}
                className="w-full py-3 rounded-xl font-semibold text-sm"
                style={{ background: '#0097A7', color: '#fff' }}
              >
                Продолжить
              </button>
            </div>
          </Centered>
        )}

        {/* CONSENT */}
        {stage === 'consent' && (
          <Centered>
            <div className="w-full max-w-md p-6">
              <div className="text-lg font-bold mb-3">Согласие на обработку</div>
              <label className="flex items-start gap-3 mb-3 cursor-pointer">
                <input type="checkbox" checked={consentPd} onChange={e => setConsentPd(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-[#0097A7]" />
                <span className="text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  Я согласен(на) на обработку персональных данных и проведение
                  телемедицинской консультации (обязательно)
                </span>
              </label>
              {info?.recording_enabled && (
                <label className="flex items-start gap-3 mb-4 cursor-pointer">
                  <input type="checkbox" checked={consentRec} onChange={e => setConsentRec(e.target.checked)}
                    className="mt-1 w-4 h-4 accent-[#0097A7]" />
                  <span className="text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
                    Согласен(на) на запись приёма для медицинской документации (опционально)
                  </span>
                </label>
              )}
              {err && (
                <div className="text-xs px-3 py-2 rounded-xl mb-3"
                  style={{ background: 'rgba(239,68,68,0.18)', color: '#fca5a5' }}>{err}</div>
              )}
              <button
                onClick={submitConsent}
                disabled={!consentPd || submittingConsent}
                className="w-full py-3 rounded-xl font-semibold text-sm"
                style={{
                  background: consentPd ? '#0097A7' : 'rgba(255,255,255,0.10)',
                  color: '#fff',
                  opacity: consentPd && !submittingConsent ? 1 : 0.7,
                }}
              >
                {submittingConsent ? 'Отправка…' : 'Подтвердить и продолжить'}
              </button>
            </div>
          </Centered>
        )}

        {/* PRECHECK */}
        {stage === 'precheck' && (
          <Centered>
            <div className="w-full max-w-md p-6">
              <div className="text-lg font-bold mb-3">Проверка устройств</div>
              <div className="rounded-2xl overflow-hidden mb-3 aspect-video" style={{ background: '#000' }}>
                <video ref={previewVideoRef} autoPlay playsInline muted
                  className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
              </div>
              <label className="block text-xs mb-1" style={{ color: 'rgba(255,255,255,0.7)' }}>Камера</label>
              <select value={selectedCam} onChange={e => setSelectedCam(e.target.value)}
                className="w-full mb-3 rounded-xl px-3 py-2 text-sm"
                style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.10)' }}>
                {devices.cams.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label || 'Камера'}</option>)}
              </select>
              <label className="block text-xs mb-1" style={{ color: 'rgba(255,255,255,0.7)' }}>Микрофон</label>
              <select value={selectedMic} onChange={e => setSelectedMic(e.target.value)}
                className="w-full mb-4 rounded-xl px-3 py-2 text-sm"
                style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.10)' }}>
                {devices.mics.map(m => <option key={m.deviceId} value={m.deviceId}>{m.label || 'Микрофон'}</option>)}
              </select>
              {err && (
                <div className="text-xs px-3 py-2 rounded-xl mb-3"
                  style={{ background: 'rgba(239,68,68,0.18)', color: '#fca5a5' }}>{err}</div>
              )}
              <button
                onClick={startCall}
                className="w-full py-3 rounded-xl font-semibold text-sm"
                style={{ background: '#0097A7', color: '#fff' }}
              >
                Войти в комнату
              </button>
            </div>
          </Centered>
        )}

        {/* CONNECTING */}
        {stage === 'connecting' && (
          <Centered>
            <Spinner />
            <div className="text-sm mt-3" style={{ color: 'rgba(255,255,255,0.7)' }}>Подключение к врачу…</div>
          </Centered>
        )}

        {/* IN ROOM */}
        {stage === 'inroom' && (
          <div className="flex-1 relative" style={{ background: '#000' }}>
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-contain" />
            {/* Local PiP */}
            <div className="absolute top-3 right-3 rounded-xl overflow-hidden border"
              style={{ width: 110, height: 150, borderColor: 'rgba(255,255,255,0.18)', background: '#1a1f26' }}>
              <video ref={localVideoRef} autoPlay playsInline muted
                className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
            </div>

            {/* Bottom controls */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-3 py-2 rounded-2xl"
              style={{ background: 'rgba(20,24,30,0.85)', backdropFilter: 'blur(10px)' }}>
              <CtrlBtn icon={micOn ? 'mic' : 'mic_off'} active={micOn} onClick={toggleMic} />
              <CtrlBtn icon={camOn ? 'videocam' : 'videocam_off'} active={camOn} onClick={toggleCam} />
              <CtrlBtn icon="chat" active={chatOpen} onClick={() => setChatOpen(o => !o)} />
              {connQuality === 'poor' && (
                <CtrlBtn icon="hearing" active onClick={fallbackAudioOnly} title="Только аудио" />
              )}
              <CtrlBtn icon="call_end" active danger onClick={handleEnd} />
            </div>

            {/* Chat overlay */}
            {chatOpen && (
              <div className="absolute right-0 top-0 bottom-0 w-full sm:w-80 flex flex-col"
                style={{ background: 'rgba(17,21,27,0.97)', borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="text-sm font-semibold">Чат с врачом</div>
                  <button onClick={() => setChatOpen(false)}
                    className="p-1 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <span className="material-symbols-outlined text-base">close</span>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                  {messages.length === 0 && (
                    <div className="text-xs text-center mt-4" style={{ color: 'rgba(255,255,255,0.45)' }}>
                      Сообщений пока нет
                    </div>
                  )}
                  {messages.map((m, idx) => {
                    const mine = m.sender_role === 'patient' || m.from_role === 'patient'
                    return (
                      <div key={m.id || idx} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-[85%] rounded-2xl px-3 py-2 text-xs"
                          style={{
                            background: mine ? '#0097A7' : 'rgba(255,255,255,0.08)',
                            color: '#fff',
                          }}>
                          {m.text && <div className="whitespace-pre-wrap">{m.text}</div>}
                          {m.file_url && (
                            <a href={m.file_url} target="_blank" rel="noopener noreferrer"
                              className="underline block mt-1" style={{ color: '#fff' }}>
                              {m.file_name || 'файл'}
                            </a>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="p-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="flex items-end gap-2">
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
                    <button onClick={sendChatText} disabled={!chatInput.trim()}
                      className="rounded-xl p-2"
                      style={{
                        background: chatInput.trim() ? '#0097A7' : 'rgba(255,255,255,0.06)',
                        color: '#fff',
                        opacity: chatInput.trim() ? 1 : 0.5,
                      }}>
                      <span className="material-symbols-outlined text-base">send</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ENDED */}
        {stage === 'ended' && (
          <Centered>
            <span className="material-symbols-outlined text-5xl mb-3" style={{ color: '#0097A7' }}>check_circle</span>
            <div className="text-base font-semibold mb-1">Приём завершён</div>
            <div className="text-sm mb-4 text-center max-w-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
              Спасибо за визит. Если врач выписал рецепт — он появится в вашем личном кабинете.
            </div>
            <button onClick={() => { window.location.href = BASE_PATH || '/' }}
              className="px-4 py-2 rounded-xl text-sm font-semibold"
              style={{ background: 'rgba(255,255,255,0.10)', color: '#fff' }}>
              На главную
            </button>
          </Centered>
        )}
      </div>
    </div>
  )
}

function Centered({ children }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4">
      {children}
    </div>
  )
}

function Spinner() {
  return <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
}

function CtrlBtn({ icon, active, onClick, danger, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-full w-12 h-12 flex items-center justify-center transition-all"
      style={{
        background: danger ? '#ef4444' : (active ? '#0097A7' : 'rgba(255,255,255,0.10)'),
        color: '#fff',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>{icon}</span>
    </button>
  )
}
