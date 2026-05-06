/**
 * CallWidget — аудио и видео звонки через WebRTC.
 * Один попап: если оба модуля включены — переключатель режима.
 * Позиция: fixed bottom-right, над SupportChat.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import useAuthStore from '../store/auth'
import { API_BASE } from '../config'
import { startRingback, stopRingback, startRingtone, stopRingtone, stopAllTones } from '../lib/callTones'

const DEFAULT_RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  // bundle + transport policy для надёжности соединения
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
}
const STATUS_COLOR = { online:'bg-emerald-400', busy:'bg-red-400', away:'bg-amber-400', offline:'bg-gray-300' }
const STATUS_LABEL = { online:'Онлайн', busy:'Занят', away:'Не на месте', offline:'Не в сети' }
const ROLE_LABEL   = { super_admin:'Платформа', franchise_owner:'Франшиза', manager:'Управляющий', doctor:'Врач', reg:'Регистратор', nurse:'Медсестра', recruiter:'Рекрутер', partner_doctor:'Врач-партнёр', visiting_doctor:'Приходящий врач', patient:'Пациент' }

export default function CallWidget() {
  const { token, user } = useAuthStore()
  const [caps, setCaps]         = useState({ enabled:false, audio:false, video:false })
  const [mode, setMode]         = useState('audio')   // 'audio' | 'video'
  const [open, setOpen]         = useState(false)
  const [contacts, setContacts] = useState([])

  const [incoming, setIncoming] = useState(null)   // {caller_id, caller_name, call_type, sdp_offer}
  const [outgoing, setOutgoing] = useState(null)   // {callee_id, callee_name, call_type, status}
  const [active, setActive]     = useState(null)   // {peer_id, peer_name, call_type, started}

  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)

  const wsRef          = useRef(null)
  const pingRef        = useRef(null)
  const pcRef          = useRef(null)
  const localStreamRef = useRef(null)
  const remoteStreamRef = useRef(null)   // персистентный поток для удалённых треков
  const remoteAudioRef = useRef(null)    // постоянный <audio> — играет голос всегда
  const localVideoRef  = useRef(null)
  const remoteVideoRef = useRef(null)
  const pendingIce     = useRef([])
  const iceConfigRef   = useRef(DEFAULT_RTC_CONFIG)
  const userGestureUnlockedRef = useRef(false)  // факт user-click для autoplay-policy

  const h = { Authorization: `Bearer ${token}` }

  // ── Проверка модулей ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return
    axios.get(API_BASE + '/presence/can-call', { headers: h })
      .then(r => {
        setCaps(r.data)
        setMode(r.data.audio ? 'audio' : 'video')
      })
      .catch(() => {})
    axios.get(API_BASE + '/presence/ice-config', { headers: h })
      .then(r => { if (r.data?.iceServers) iceConfigRef.current = { iceServers: r.data.iceServers } })
      .catch(() => {})
  }, [token])

  // ── WebSocket — подключаем всегда для presence, не только при telephony ──
  useEffect(() => {
    if (!user?.id || !token) return
    const wsUrl = API_BASE.replace(/^http/, 'ws') + `/presence/ws/${user.id}?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      axios.put(API_BASE + '/presence/status', { status: 'online' }, { headers: h }).catch(() => {})
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'heartbeat' }))
      }, 30000)
    }

    ws.onmessage = async (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }

      switch (msg.type) {
        case 'presence_update':
          setContacts(prev => prev.map(c =>
            c.user_id === msg.user_id ? { ...c, status: msg.status } : c
          ))
          break

        case 'call_invite':
          setIncoming({ caller_id: msg.caller_id, caller_name: msg.caller_name,
            call_type: msg.call_type || 'audio', sdp_offer: msg.sdp_offer || null })
          break

        case 'call_ringing':
          setOutgoing(prev => prev ? { ...prev, status: 'ringing' } : null)
          break

        case 'call_accept':
          if (msg.sdp_answer && pcRef.current) {
            try {
              await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp_answer))
              for (const c of pendingIce.current)
                await pcRef.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
              pendingIce.current = []
            } catch {}
          }
          setOutgoing(prev => {
            if (!prev) return null
            setActive({ peer_id: msg.from_id, peer_name: prev.callee_name,
              call_type: prev.call_type, started: Date.now() })
            return null
          })
          setIncoming(null)
          break

        case 'call_reject':
        case 'call_failed':
          cleanupMedia()
          setOutgoing(null)
          break

        case 'call_end':
          cleanupMedia()
          setActive(null); setIncoming(null); setOutgoing(null)
          axios.put(API_BASE + '/presence/status', { status: 'online' }, { headers: h }).catch(() => {})
          break

        case 'ice_candidate':
          if (pcRef.current) {
            if (pcRef.current.remoteDescription)
              await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {})
            else
              pendingIce.current.push(msg.candidate)
          }
          break
      }
    }

    ws.onclose = () => clearInterval(pingRef.current)
    loadContacts()

    return () => {
      clearInterval(pingRef.current)
      ws.close(); wsRef.current = null
    }
  }, [user?.id])

  const loadContacts = useCallback(() => {
    axios.get(API_BASE + '/presence/users', { headers: h })
      .then(r => setContacts(Array.isArray(r.data) ? r.data : (r.data?.users || [])))
      .catch(() => {})
  }, [token])

  useEffect(() => { if (open && caps.enabled) loadContacts() }, [open])

  // ── WebRTC ────────────────────────────────────────────────────────────────
  const sendWs = (msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify(msg))
  }

  const attachRemoteStream = (stream) => {
    // Постоянно смонтированный <video> играет и звук, и картинку.
    // <audio> держим как РЕЗЕРВ для редких случаев, когда <video> не доступен —
    // он muted, чтобы не было эха.
    if (!stream) return
    remoteStreamRef.current = stream
    if (remoteVideoRef.current) {
      if (remoteVideoRef.current.srcObject !== stream) remoteVideoRef.current.srcObject = stream
      remoteVideoRef.current.muted = false
      remoteVideoRef.current.volume = 1.0
      remoteVideoRef.current.play?.().catch(() => {})
    }
    if (remoteAudioRef.current) {
      if (remoteAudioRef.current.srcObject !== stream) remoteAudioRef.current.srcObject = stream
      remoteAudioRef.current.muted = true   // эхо-страховка, играет только <video>
    }
  }

  // Synchronously prime media elements in user-gesture context (Safari fix).
  // Вызывается из onClick «Позвонить»/«Принять» — НЕ async, чтобы Safari
  // зачёл это как user-gesture и разрешил последующие .play() из колбэков.
  const primeMediaSync = () => {
    try {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.muted = false
        remoteVideoRef.current.play?.().catch(() => {})
      }
    } catch {}
    try {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.muted = false
        remoteAudioRef.current.play?.().catch(() => {})
      }
    } catch {}
  }

  const createPC = (targetId) => {
    if (pcRef.current) pcRef.current.close()
    pendingIce.current = []
    const pc = new RTCPeerConnection(iceConfigRef.current)
    pcRef.current = pc

    pc.onicecandidate = (e) => {
      if (e.candidate) sendWs({ type: 'ice_candidate', target_id: targetId, candidate: e.candidate.toJSON() })
    }

    pc.ontrack = (e) => {
      // Современные браузеры: e.streams[0] содержит все треки звонка с дальней стороны.
      // Firefox/Safari иногда возвращают пустой streams[] — fallback на персистентный MediaStream.
      let stream = e.streams && e.streams[0]
      if (!stream) {
        if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream()
        try { remoteStreamRef.current.addTrack(e.track) } catch {}
        stream = remoteStreamRef.current
      }
      attachRemoteStream(stream)
    }

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      // 'disconnected' — временное состояние WebRTC, не дропаем звонок.
      // ICE может восстановиться сам или через restartIce.
      if (s === 'connected') stopAllTones()
      if (s === 'failed') {
        try { pc.restartIce() } catch {}
      }
      // 'closed' — мы сами закрыли, обработка не нужна.
    }

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState
      if (s === 'failed') {
        try { pc.restartIce() } catch {}
      }
      // disconnected → ничего не делаем, ждём connected/failed
    }

    return pc
  }

  const getMedia = async (callType) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
      },
      video: callType === 'video' ? {
        width:  { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24 },
        facingMode: 'user',
      } : false,
    })
    localStreamRef.current = stream
    if (localVideoRef.current) localVideoRef.current.srcObject = stream
    return stream
  }

  const cleanupMedia = () => {
    stopAllTones()
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    if (remoteStreamRef.current) {
      try { remoteStreamRef.current.getTracks().forEach(t => t.stop()) } catch {}
      remoteStreamRef.current = null
    }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
    if (localVideoRef.current)  localVideoRef.current.srcObject = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
    pendingIce.current = []
  }

  const startCall = async (contact) => {
    primeMediaSync()  // Safari: разблокировать <video>/<audio> в контексте клика
    setOpen(false)
    setOutgoing({ callee_id: contact.user_id, callee_name: contact.full_name, call_type: mode, status: 'calling' })
    setCamOn(mode === 'video'); setMicOn(true)

    let stream
    try { stream = await getMedia(mode) }
    catch { alert('Нет доступа к камере/микрофону'); setOutgoing(null); return }

    const pc = createPC(contact.user_id)
    stream.getTracks().forEach(t => pc.addTrack(t, stream))
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    sendWs({ type: 'call_invite', callee_id: contact.user_id, call_type: mode,
      sdp_offer: pc.localDescription.toJSON() })
  }

  const acceptCall = async () => {
    primeMediaSync()  // Safari: разблокировать <video>/<audio> синхронно по клику
    const callType = incoming.call_type
    setCamOn(callType === 'video'); setMicOn(true)

    let stream
    try { stream = await getMedia(callType) }
    catch { rejectCall(); return }

    const pc = createPC(incoming.caller_id)
    stream.getTracks().forEach(t => pc.addTrack(t, stream))

    if (incoming.sdp_offer) {
      await pc.setRemoteDescription(new RTCSessionDescription(incoming.sdp_offer))
      for (const c of pendingIce.current)
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
      pendingIce.current = []
    }

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    sendWs({ type: 'call_accept', caller_id: incoming.caller_id, sdp_answer: pc.localDescription.toJSON() })

    setActive({ peer_id: incoming.caller_id, peer_name: incoming.caller_name,
      call_type: callType, started: Date.now() })
    setIncoming(null)
    axios.put(API_BASE + '/presence/status', { status: 'busy' }, { headers: h }).catch(() => {})
  }

  const rejectCall = () => {
    sendWs({ type: 'call_reject', caller_id: incoming.caller_id })
    cleanupMedia(); setIncoming(null)
  }

  const endCall = () => {
    const peerId = active?.peer_id || outgoing?.callee_id
    if (peerId) sendWs({ type: 'call_end', target_id: peerId })
    cleanupMedia()
    setActive(null); setOutgoing(null); setIncoming(null)
    axios.put(API_BASE + '/presence/status', { status: 'online' }, { headers: h }).catch(() => {})
  }

  const toggleMic = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !micOn })
    setMicOn(v => !v)
  }
  const toggleCam = () => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !camOn })
    setCamOn(v => !v)
  }

  // ── Звуковые сигналы: гудок (исходящий) и мелодия (входящий) ──────────────
  useEffect(() => {
    if (outgoing && !active) startRingback()
    else stopRingback()
    return () => stopRingback()
  }, [outgoing, active])

  useEffect(() => {
    if (incoming) startRingtone()
    else stopRingtone()
    return () => stopRingtone()
  }, [incoming])

  // На случай выгрузки компонента/закрытия страницы — глушим всё
  useEffect(() => () => stopAllTones(), [])

  // ── Реаттач удалённого потока к видео/аудио элементам при их монтаже ───────
  // (overlay рендерится позже, чем приходит ontrack — без эффекта видео не виден)
  useEffect(() => {
    if (remoteStreamRef.current) attachRemoteStream(remoteStreamRef.current)
    if (localVideoRef.current && localStreamRef.current && localVideoRef.current.srcObject !== localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current
      localVideoRef.current.play?.().catch(() => {})
    }
  })

  if (!token || !user) return null  // не показываем без авторизации

  const isVideo = (active || outgoing || incoming)?.call_type === 'video'
  const callActive = !!(active || outgoing)
  const onlineCount = contacts.filter(c => c.status !== 'offline').length

  return (
    <>
      {/* ── Постоянно смонтированные медиа-элементы (Safari fix) ───────────
         Видео и аудио теги создаются ОДИН раз при маунте компонента, что:
         - даёт стабильные ref для srcObject (нет null-промаха при ontrack)
         - позволяет primeMediaSync() сработать прямо из user-gesture (клика)
         - убирает мерцание стрима при перемонтировании оверлеев */}
      <audio ref={remoteAudioRef} autoPlay playsInline />
      <video
        ref={remoteVideoRef}
        autoPlay playsInline
        className={callActive && isVideo ? 'fixed inset-0 z-40 w-full h-full object-cover bg-black' : ''}
        style={{
          display: callActive && isVideo ? 'block' : 'none',
          pointerEvents: callActive && isVideo ? 'auto' : 'none',
        }}
      />
      <video
        ref={localVideoRef}
        autoPlay playsInline muted
        className={callActive && isVideo && camOn
          ? 'fixed bottom-28 right-4 z-50 w-36 h-24 object-cover rounded-2xl border-2 border-white/30 shadow-2xl bg-gray-800'
          : ''}
        style={{
          display: (callActive && isVideo && camOn) ? 'block' : 'none',
        }}
      />

      {/* ── Входящий звонок ─────────────────────────────────────────────── */}
      {incoming && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center pb-28 pointer-events-none">
          <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl p-5 w-80 pointer-events-auto border border-gray-100 dark:border-gray-700"
            style={{ animation: 'slideUp .3s ease' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center animate-pulse">
                <span className="material-symbols-outlined text-emerald-600 text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>
                  {incoming.call_type === 'video' ? 'videocam' : 'call'}
                </span>
              </div>
              <div>
                <p className="font-bold text-gray-900 dark:text-white">{incoming.caller_name}</p>
                <p className="text-xs text-gray-500">Входящий {incoming.call_type === 'video' ? 'видео' : 'аудио'} звонок</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={rejectCall}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-red-500 text-white rounded-2xl font-bold hover:bg-red-600 transition">
                <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>call_end</span>
                Отклонить
              </button>
              <button onClick={acceptCall}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-emerald-500 text-white rounded-2xl font-bold hover:bg-emerald-600 transition">
                <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>
                  {incoming.call_type === 'video' ? 'videocam' : 'call'}
                </span>
                Ответить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Видеозвонок: оверлей с заглушкой и управлением (видео уже в DOM выше) ─ */}
      {callActive && isVideo && (
        <div className="fixed inset-0 z-50 flex flex-col pointer-events-none">
          <div className="relative flex-1 pointer-events-none">
            {/* Заглушка пока удалённый стрим не пришёл */}
            {!active && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white bg-gray-900 pointer-events-auto">
                <div className="w-24 h-24 rounded-3xl bg-white/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-5xl" style={{ fontVariationSettings:"'FILL' 1" }}>videocam</span>
                </div>
                <p className="text-xl font-bold">{outgoing?.callee_name}</p>
                <p className="text-sm text-white/60 animate-pulse">
                  {outgoing?.status === 'ringing' ? 'Вызов...' : 'Соединение...'}
                </p>
              </div>
            )}
            {!camOn && (
              <div className="absolute bottom-28 right-4 z-50 w-36 h-24 rounded-2xl bg-gray-800 border-2 border-white/30 shadow-2xl flex items-center justify-center pointer-events-auto">
                <span className="material-symbols-outlined text-white/40 text-3xl">videocam_off</span>
              </div>
            )}
          </div>
          {/* Управление */}
          <div className="flex items-center justify-center gap-4 py-6 bg-black/60 pointer-events-auto">
            <button onClick={toggleMic}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition ${micOn ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-red-500 text-white'}`}>
              <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>{micOn ? 'mic' : 'mic_off'}</span>
            </button>
            <button onClick={toggleCam}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition ${camOn ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-red-500 text-white'}`}>
              <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>{camOn ? 'videocam' : 'videocam_off'}</span>
            </button>
            <button onClick={endCall}
              className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition">
              <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings:"'FILL' 1" }}>call_end</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Аудиозвонок: компактная карточка ────────────────────────────── */}
      {callActive && !isVideo && (
        <div className="fixed bottom-56 right-4 z-50 w-64 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl text-blue-600" style={{ fontVariationSettings:"'FILL' 1" }}>
                {active ? 'call' : 'phone_forwarded'}
              </span>
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white text-sm">
                {active ? active.peer_name : outgoing?.callee_name}
              </p>
              <p className="text-xs text-gray-400">
                {active ? 'Разговор' : outgoing?.status === 'ringing' ? 'Вызов...' : 'Соединение...'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={toggleMic}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition ${micOn ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200' : 'bg-red-100 text-red-500'}`}>
              <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings:"'FILL' 1" }}>{micOn ? 'mic' : 'mic_off'}</span>
            </button>
            <button onClick={endCall}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-red-500 text-white rounded-xl text-sm font-bold hover:bg-red-600 transition">
              <span className="material-symbols-outlined text-base" style={{ fontVariationSettings:"'FILL' 1" }}>call_end</span>
              {active ? 'Завершить' : 'Отменить'}
            </button>
          </div>
        </div>
      )}

      {/* ── Список контактов ─────────────────────────────────────────────── */}
      {open && !callActive && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed bottom-56 right-4 z-50 w-72 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            {/* Заголовок + переключатель режима */}
            <div className="px-4 pt-3 pb-2 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-bold text-gray-900 dark:text-white text-sm">Контакты</p>
                  <p className="text-xs text-gray-400">{onlineCount} онлайн</p>
                </div>
                <button onClick={loadContacts} className="p-1 text-gray-400 hover:text-gray-600 transition">
                  <span className="material-symbols-outlined text-[18px]">refresh</span>
                </button>
              </div>
              {/* Переключатель только если оба модуля активны */}
              {caps.audio && caps.video && (
                <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1">
                  <button onClick={() => setMode('audio')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition ${mode === 'audio' ? 'bg-white dark:bg-gray-700 text-[#0097A7] shadow-sm' : 'text-gray-500'}`}>
                    <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings:"'FILL' 1" }}>call</span>
                    Аудио
                  </button>
                  <button onClick={() => setMode('video')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition ${mode === 'video' ? 'bg-white dark:bg-gray-700 text-[#0097A7] shadow-sm' : 'text-gray-500'}`}>
                    <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings:"'FILL' 1" }}>videocam</span>
                    Видео
                  </button>
                </div>
              )}
            </div>

            {/* Список */}
            <div className="max-h-72 overflow-y-auto divide-y divide-gray-50 dark:divide-gray-800">
              {contacts.length === 0 && (
                <div className="py-8 text-center text-gray-400 text-sm">Нет контактов</div>
              )}
              {contacts.map(c => (
                <div key={c.user_id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <div className="relative flex-shrink-0">
                    <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-600 dark:text-gray-300">
                      {(c.full_name || '?')[0].toUpperCase()}
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 ${STATUS_COLOR[c.status] || STATUS_COLOR.offline}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{c.full_name}</p>
                    <p className="text-xs text-gray-400 truncate">{ROLE_LABEL[c.role] || c.role} · {STATUS_LABEL[c.status] || 'Не в сети'}</p>
                  </div>
                  <button
                    onClick={() => c.status === 'online' && startCall(c)}
                    disabled={c.status !== 'online'}
                    title={mode === 'video' ? 'Видео звонок' : 'Аудио звонок'}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center transition flex-shrink-0 ${
                      c.status === 'online'
                        ? mode === 'video'
                          ? 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                          : 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                        : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                    }`}>
                    <span className="material-symbols-outlined text-[17px]" style={{ fontVariationSettings:"'FILL' 1" }}>
                      {mode === 'video' ? 'videocam' : 'call'}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Плавающая кнопка (только при активном модуле звонков) ─────── */}
      {caps.enabled && <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-40 right-4 z-40 w-14 h-14 text-white rounded-full flex items-center justify-center transition-all duration-150 active:scale-95"
        style={{ background:'linear-gradient(135deg,#0097A7,#006173)', boxShadow:'0 8px 24px rgba(0,151,167,0.4)' }}
        title="Звонки">
        {onlineCount > 0 && !callActive && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-400 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white">
            {onlineCount > 9 ? '9+' : onlineCount}
          </span>
        )}
        {callActive && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full border-2 border-white animate-pulse" />
        )}
        <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>
          {callActive ? 'call' : open ? 'close' : 'call'}
        </span>
      </button>}

      <style>{`
        @keyframes slideUp { from { transform:translateY(20px);opacity:0 } to { transform:translateY(0);opacity:1 } }
      `}</style>
    </>
  )
}
