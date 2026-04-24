/**
 * CallWidget — плавающая кнопка звонков.
 * Появляется только если включён модуль telephony_basic.
 * Место: рядом с SupportChat, fixed bottom-right.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import useAuthStore from '../store/auth'
import { API_BASE } from '../config'

const STATUS_COLOR = {
  online:  'bg-emerald-400',
  busy:    'bg-red-400',
  away:    'bg-amber-400',
  offline: 'bg-gray-300',
}
const STATUS_LABEL = {
  online: 'Онлайн', busy: 'Занят', away: 'Не на месте', offline: 'Не в сети',
}
const ROLE_LABEL = {
  admin: 'Администратор', doctor: 'Врач', manager: 'Руководитель',
  nurse: 'Медсестра', recruiter: 'Рекрутер', partner: 'Партнёр',
}

export default function CallWidget() {
  const { token, user } = useAuthStore()
  const [enabled, setEnabled]     = useState(false)
  const [open, setOpen]           = useState(false)
  const [contacts, setContacts]   = useState([])
  const [myStatus, setMyStatus]   = useState('online')

  // Входящий звонок
  const [incoming, setIncoming]   = useState(null) // {caller_id, caller_name, call_type}
  // Исходящий звонок
  const [outgoing, setOutgoing]   = useState(null) // {callee_id, callee_name, status}
  // Активный звонок
  const [active, setActive]       = useState(null) // {peer_id, peer_name, call_type, started}

  const wsRef = useRef(null)
  const pingRef = useRef(null)

  const h = { Authorization: `Bearer ${token}` }

  // Проверка модуля
  useEffect(() => {
    if (!token) return
    axios.get(API_BASE + '/presence/can-call', { headers: h })
      .then(r => setEnabled(r.data.enabled))
      .catch(() => {})
  }, [token])

  // WebSocket подключение когда модуль включён
  useEffect(() => {
    if (!enabled || !user?.id || !token) return

    const wsUrl = API_BASE.replace(/^http/, 'ws') + `/presence/ws/${user.id}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      // Отправляем статус online
      axios.put(API_BASE + '/presence/status', { status: 'online' }, { headers: h }).catch(() => {})
      // Heartbeat каждые 30 сек
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'heartbeat' }))
      }, 30000)
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'presence_update') {
          setContacts(prev => prev.map(c =>
            c.user_id === msg.user_id ? { ...c, status: msg.status } : c
          ))
        } else if (msg.type === 'call_invite') {
          setIncoming({ caller_id: msg.caller_id, caller_name: msg.caller_name, call_type: msg.call_type || 'audio' })
        } else if (msg.type === 'call_ringing') {
          setOutgoing(prev => prev ? { ...prev, status: 'ringing' } : null)
        } else if (msg.type === 'call_accept') {
          const peer = outgoing || incoming
          setOutgoing(null); setIncoming(null)
          setActive({ peer_id: msg.from_id, peer_name: peer?.caller_name || peer?.callee_name || '...', call_type: 'audio', started: Date.now() })
        } else if (msg.type === 'call_reject') {
          setOutgoing(null)
        } else if (msg.type === 'call_failed') {
          setOutgoing(null)
        } else if (msg.type === 'call_end') {
          setActive(null)
          setIncoming(null)
          axios.put(API_BASE + '/presence/status', { status: 'online' }, { headers: h }).catch(() => {})
        }
      } catch {}
    }

    ws.onclose = () => {
      clearInterval(pingRef.current)
    }

    // Загрузка контактов
    loadContacts()

    return () => {
      clearInterval(pingRef.current)
      ws.close()
      wsRef.current = null
    }
  }, [enabled, user?.id])

  const loadContacts = useCallback(() => {
    axios.get(API_BASE + '/presence/users', { headers: h })
      .then(r => setContacts(Array.isArray(r.data) ? r.data : (r.data?.users || [])))
      .catch(() => {})
  }, [token])

  // Обновление контактов при открытии
  useEffect(() => {
    if (open && enabled) loadContacts()
  }, [open])

  const sendWs = (msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }

  const startCall = (contact) => {
    setOutgoing({ callee_id: contact.user_id, callee_name: contact.full_name, status: 'calling' })
    setOpen(false)
    sendWs({ type: 'call_invite', callee_id: contact.user_id, call_type: 'audio' })
  }

  const acceptCall = () => {
    sendWs({ type: 'call_accept', caller_id: incoming.caller_id })
    setActive({ peer_id: incoming.caller_id, peer_name: incoming.caller_name, call_type: incoming.call_type, started: Date.now() })
    setIncoming(null)
    axios.put(API_BASE + '/presence/status', { status: 'busy' }, { headers: h }).catch(() => {})
  }

  const rejectCall = () => {
    sendWs({ type: 'call_reject', caller_id: incoming.caller_id })
    setIncoming(null)
  }

  const endCall = () => {
    const peerId = active?.peer_id
    if (peerId) sendWs({ type: 'call_end', target_id: peerId })
    setActive(null)
    setOutgoing(null)
    axios.put(API_BASE + '/presence/status', { status: 'online' }, { headers: h }).catch(() => {})
  }

  const cancelCall = () => {
    if (outgoing?.callee_id) sendWs({ type: 'call_end', target_id: outgoing.callee_id })
    setOutgoing(null)
  }

  if (!enabled) return null

  const onlineCount = contacts.filter(c => c.status !== 'offline').length

  return (
    <>
      {/* ── Входящий звонок ── */}
      {incoming && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center pb-32 pointer-events-none">
          <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl p-5 w-80 pointer-events-auto border border-gray-100 dark:border-gray-700"
            style={{animation: 'slideUp 0.3s ease'}}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center animate-pulse">
                <span className="material-symbols-outlined text-emerald-600 text-2xl" style={{fontVariationSettings:"'FILL' 1"}}>call</span>
              </div>
              <div>
                <p className="font-bold text-gray-900 dark:text-white">{incoming.caller_name}</p>
                <p className="text-xs text-gray-500">Входящий {incoming.call_type === 'audio' ? 'аудио' : 'видео'} звонок</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={rejectCall}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-red-500 text-white rounded-2xl font-bold hover:bg-red-600 transition">
                <span className="material-symbols-outlined text-xl" style={{fontVariationSettings:"'FILL' 1"}}>call_end</span>
                Отклонить
              </button>
              <button onClick={acceptCall}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-emerald-500 text-white rounded-2xl font-bold hover:bg-emerald-600 transition">
                <span className="material-symbols-outlined text-xl" style={{fontVariationSettings:"'FILL' 1"}}>call</span>
                Ответить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Исходящий / Активный звонок ── */}
      {(outgoing || active) && (
        <div className="fixed bottom-56 right-4 z-50 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-4 w-64 border border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${active ? 'bg-emerald-100' : 'bg-blue-100'}`}>
              <span className={`material-symbols-outlined text-xl ${active ? 'text-emerald-600' : 'text-blue-600'}`}
                style={{fontVariationSettings:"'FILL' 1"}}>
                {active ? 'call' : 'phone_forwarded'}
              </span>
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white text-sm">
                {active ? active.peer_name : outgoing?.callee_name}
              </p>
              <p className="text-xs text-gray-400">
                {active ? 'Звонок активен' : outgoing?.status === 'ringing' ? 'Вызов...' : 'Соединение...'}
              </p>
            </div>
          </div>
          <button onClick={active ? endCall : cancelCall}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-red-500 text-white rounded-xl text-sm font-bold hover:bg-red-600 transition">
            <span className="material-symbols-outlined text-base" style={{fontVariationSettings:"'FILL' 1"}}>call_end</span>
            {active ? 'Завершить' : 'Отменить'}
          </button>
        </div>
      )}

      {/* ── Контакты ── */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed bottom-56 right-4 z-50 w-72 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <div>
                <p className="font-bold text-gray-900 dark:text-white text-sm">Контакты</p>
                <p className="text-xs text-gray-400">{onlineCount} онлайн</p>
              </div>
              <button onClick={loadContacts}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">
                <span className="material-symbols-outlined text-[18px]">refresh</span>
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-gray-50 dark:divide-gray-800">
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
                    <p className="text-xs text-gray-400 truncate">
                      {ROLE_LABEL[c.role] || c.role} · {STATUS_LABEL[c.status] || 'Не в сети'}
                    </p>
                  </div>
                  <button
                    onClick={() => c.status !== 'offline' && startCall(c)}
                    disabled={c.status === 'offline' || c.status === 'busy'}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center transition ${
                      c.status === 'online' ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200' :
                      c.status === 'busy'   ? 'bg-gray-100 text-gray-300 cursor-not-allowed' :
                      c.status === 'away'   ? 'bg-amber-100 text-amber-500 hover:bg-amber-200' :
                      'bg-gray-100 text-gray-300 cursor-not-allowed'
                    }`}
                    title={c.status === 'offline' ? 'Не в сети' : c.status === 'busy' ? 'Занят' : 'Позвонить'}
                  >
                    <span className="material-symbols-outlined text-[16px]" style={{fontVariationSettings:"'FILL' 1"}}>call</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Плавающая кнопка ── */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-40 right-4 z-40 w-14 h-14 text-white rounded-full flex items-center justify-center transition-all duration-150 active:scale-95"
        style={{background:'linear-gradient(135deg,#0097A7,#006173)', boxShadow:'0 8px 24px rgba(0,151,167,0.4)'}}
        title="Звонки"
      >
        {onlineCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-400 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white">
            {onlineCount > 9 ? '9+' : onlineCount}
          </span>
        )}
        <span className="material-symbols-outlined text-2xl" style={{fontVariationSettings:"'FILL' 1"}}>
          {open ? 'close' : 'call'}
        </span>
      </button>

      <style>{`
        @keyframes slideUp { from { transform: translateY(20px); opacity:0; } to { transform: translateY(0); opacity:1; } }
      `}</style>
    </>
  )
}
