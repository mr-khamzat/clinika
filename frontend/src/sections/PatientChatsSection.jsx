import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import api from '../api'

// ─── Хелперы ──────────────────────────────────────────────────────────────────
const PRIMARY = '#0097A7'

function fmtTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const now = new Date()
    const sameDay = d.toDateString() === now.toDateString()
    if (sameDay) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24))
    if (diffDays < 7) {
      return ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()]
    }
    return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`
  } catch {
    return ''
  }
}

function fmtFullTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return ''
  }
}

function maskPhone(phone) {
  if (!phone) return '—'
  // +79991234567 -> +7 (999) 123-45-67
  const clean = String(phone).replace(/\D/g, '')
  if (clean.length === 11 && (clean.startsWith('7') || clean.startsWith('8'))) {
    return `+7 (${clean.slice(1, 4)}) ${clean.slice(4, 7)}-${clean.slice(7, 9)}-${clean.slice(9, 11)}`
  }
  return phone
}

// ─── Главный компонент ───────────────────────────────────────────────────────
export default function PatientChatsSection({ token }) {
  const [chats, setChats] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [err, setErr] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [active, setActive] = useState(null)        // { chat, messages }
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [showListMobile, setShowListMobile] = useState(true)
  const bottomRef = useRef(null)

  // ── API ──────────────────────────────────────────────────────────────
  const fetchChats = useCallback(async () => {
    try {
      const r = await api.get('/admin/patient-chats')
      setChats(Array.isArray(r.data?.chats) ? r.data.chats : [])
      setErr('')
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Не удалось загрузить чаты')
    } finally {
      setLoadingList(false)
    }
  }, [])

  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return
    setLoadingMsgs(true)
    try {
      const r = await api.get(`/admin/patient-chats/${chatId}/messages`)
      setActive(r.data)
      // Обновляем chat в списке (unread сбрасывается)
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, ...r.data?.chat, unread_admin: 0 } : c))
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Не удалось загрузить сообщения')
    } finally {
      setLoadingMsgs(false)
    }
  }, [])

  useEffect(() => {
    fetchChats()
    const id = setInterval(fetchChats, 8000)
    return () => clearInterval(id)
  }, [fetchChats])

  useEffect(() => {
    if (activeId) fetchMessages(activeId)
  }, [activeId, fetchMessages])

  // Polling выбранного чата
  useEffect(() => {
    if (!activeId) return
    const id = setInterval(() => fetchMessages(activeId), 5000)
    return () => clearInterval(id)
  }, [activeId, fetchMessages])

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [active?.messages])

  // ── Действия ─────────────────────────────────────────────────────────
  const sendReply = async (e) => {
    e?.preventDefault?.()
    const text = (reply || '').trim()
    if (!text || sending || !activeId) return
    setSending(true)
    try {
      const r = await api.post(
        `/admin/patient-chats/${activeId}/reply`,
        { text }
      )
      // Сразу подмешиваем новое сообщение
      setActive(prev => prev ? {
        chat: r.data?.chat || prev.chat,
        messages: [...(prev.messages || []), r.data?.message],
      } : prev)
      setReply('')
      // Обновляем список
      setChats(prev => prev.map(c => c.id === activeId ? { ...c, ...(r.data?.chat || {}) } : c))
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Не удалось отправить ответ')
    } finally {
      setSending(false)
    }
  }

  const toggleMode = async () => {
    if (!activeId) return
    try {
      const r = await api.post(
        `/admin/patient-chats/${activeId}/toggle-mode`,
        {}
      )
      setActive(prev => prev ? { ...prev, chat: r.data?.chat || prev.chat } : prev)
      setChats(prev => prev.map(c => c.id === activeId ? { ...c, ...(r.data?.chat || {}) } : c))
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Не удалось переключить режим')
    }
  }

  // ── Поиск/фильтр ────────────────────────────────────────────────────
  const filteredChats = useMemo(() => {
    const q = (search || '').trim().toLowerCase()
    if (!q) return chats
    return chats.filter(c =>
      (c.patient_phone || '').toLowerCase().includes(q) ||
      (c.patient_name || '').toLowerCase().includes(q) ||
      (c.last_message_preview || '').toLowerCase().includes(q)
    )
  }, [chats, search])

  const totalUnread = useMemo(() => chats.reduce((s, c) => s + (c.unread_admin || 0), 0), [chats])

  // ── UI: список ──────────────────────────────────────────────────────
  const ListPanel = (
    <div className="flex flex-col h-full bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px]" style={{ color: PRIMARY }}>chat_bubble</span>
        <h3 className="font-bold text-gray-900 dark:text-white text-sm">Чаты пациентов</h3>
        {totalUnread > 0 && (
          <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: '#EF4444' }}>
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </div>
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-[16px]">search</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Телефон, имя, текст..."
            className="w-full h-9 pl-8 pr-3 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-white focus:outline-none focus:border-[#0097A7]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loadingList ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-6 h-6 border-2 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredChats.length === 0 ? (
          <div className="text-center py-12 px-4 text-gray-400 text-sm">
            <span className="material-symbols-outlined text-4xl mb-2 block" style={{ color: '#D1D5DB' }}>forum</span>
            Нет чатов
          </div>
        ) : (
          <ul>
            {filteredChats.map(c => {
              const isActive = c.id === activeId
              const unread = c.unread_admin || 0
              return (
                <li key={c.id}>
                  <button
                    onClick={() => { setActiveId(c.id); setShowListMobile(false) }}
                    className={`w-full flex items-start gap-3 px-3 py-3 text-left border-l-4 transition-all
                      ${isActive
                        ? 'bg-[#E0F7FA] dark:bg-[#0a3038] border-[#0097A7]'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border-transparent'}`}
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold"
                      style={{
                        background: c.mode === 'manual'
                          ? 'linear-gradient(135deg,#F59E0B,#D97706)'
                          : 'linear-gradient(135deg,#0097A7,#1565C0)',
                      }}>
                      {(c.patient_name || c.patient_phone || '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-sm text-gray-900 dark:text-white truncate">
                          {c.patient_name || maskPhone(c.patient_phone)}
                        </p>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtTime(c.last_message_at || c.updated_at)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {c.last_message_preview || '...'}
                        </p>
                        {unread > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white flex-shrink-0"
                            style={{ background: '#EF4444' }}>
                            {unread > 9 ? '9+' : unread}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide ${
                          c.mode === 'manual'
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-cyan-100 text-cyan-700'
                        }`}>
                          {c.mode === 'manual' ? 'Регистратура' : 'AI'}
                        </span>
                        {c.patient_phone && c.patient_name && (
                          <span className="text-[10px] text-gray-400 truncate">{maskPhone(c.patient_phone)}</span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )

  // ── UI: правая панель (чат) ─────────────────────────────────────────
  const chatHeader = active?.chat || (activeId ? chats.find(c => c.id === activeId) : null)
  const ChatPanel = (
    <div className="flex flex-col h-full bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      {!activeId ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 px-4 text-center">
          <span className="material-symbols-outlined text-6xl mb-3" style={{ color: '#D1D5DB' }}>chat</span>
          <p className="text-gray-500 dark:text-gray-400 font-semibold text-sm">Выберите чат слева</p>
          <p className="text-gray-400 text-xs mt-1">Чтобы прочитать вопрос пациента и ответить</p>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="px-3 sm:px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
            <button
              onClick={() => setShowListMobile(true)}
              className="lg:hidden w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700">
              <span className="material-symbols-outlined text-[20px] text-gray-600 dark:text-gray-300">arrow_back</span>
            </button>
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
              style={{
                background: chatHeader?.mode === 'manual'
                  ? 'linear-gradient(135deg,#F59E0B,#D97706)'
                  : 'linear-gradient(135deg,#0097A7,#1565C0)',
              }}>
              {(chatHeader?.patient_name || chatHeader?.patient_phone || '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-gray-900 dark:text-white truncate">
                {chatHeader?.patient_name || maskPhone(chatHeader?.patient_phone)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {maskPhone(chatHeader?.patient_phone)} ·
                <span className={chatHeader?.mode === 'manual' ? 'text-orange-600 ml-1' : 'text-cyan-700 ml-1'}>
                  {chatHeader?.mode === 'manual' ? 'Регистратура' : 'AI-ассистент'}
                </span>
                {chatHeader?.ai_messages_today != null && chatHeader?.ai_daily_limit && (
                  <span className="ml-2 text-gray-400 hidden sm:inline">
                    AI {chatHeader.ai_messages_today}/{chatHeader.ai_daily_limit}
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={toggleMode}
              title={chatHeader?.mode === 'manual' ? 'Передать AI' : 'Перевести в ручной режим'}
              className="hidden sm:flex items-center gap-1 px-3 h-9 rounded-xl text-xs font-semibold transition-all hover:opacity-90"
              style={{
                background: chatHeader?.mode === 'manual' ? '#E0F2FE' : '#FFEDD5',
                color: chatHeader?.mode === 'manual' ? '#0369A1' : '#9A3412',
              }}>
              <span className="material-symbols-outlined text-[16px]">
                {chatHeader?.mode === 'manual' ? 'smart_toy' : 'support_agent'}
              </span>
              {chatHeader?.mode === 'manual' ? 'Передать AI' : 'Ручной режим'}
            </button>
            <button
              onClick={toggleMode}
              className="sm:hidden w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: '#F3F4F6' }}>
              <span className="material-symbols-outlined text-[18px] text-gray-700">
                {chatHeader?.mode === 'manual' ? 'smart_toy' : 'support_agent'}
              </span>
            </button>
          </div>

          {/* Сообщения */}
          {loadingMsgs && !active ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-2"
              style={{ background: '#F9FAFB' }}>
              {(active?.messages || []).map((m, i) => {
                const isPatient = m.sender === 'patient'
                const isAdmin = m.sender === 'admin'
                const isAssistant = m.sender === 'assistant'
                return (
                  <div key={m.id || i} className={`flex ${isPatient ? 'justify-start' : 'justify-end'}`}>
                    <div style={{
                      maxWidth: '78%',
                      padding: '8px 12px',
                      borderRadius: isPatient ? '18px 18px 18px 4px' : '18px 18px 4px 18px',
                      background: isPatient
                        ? 'white'
                        : (isAdmin ? 'linear-gradient(135deg,#16A34A,#15803D)' : 'linear-gradient(135deg,#0097A7,#1565C0)'),
                      color: isPatient ? '#1F2937' : 'white',
                      boxShadow: '0 2px 6px rgba(0,0,0,.05)',
                      border: isPatient ? '1px solid rgba(0,0,0,.05)' : 'none',
                    }}>
                      <p className="text-sm whitespace-pre-wrap break-words">{m.text}</p>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="text-[10px] opacity-70">
                          {isAssistant && '🤖 AI'}
                          {isAdmin && '👤 Админ'}
                          {isPatient && '🧑 Пациент'}
                          {m.is_cached && ' • cache'}
                        </span>
                        <span className="text-[10px] opacity-60">{fmtFullTime(m.created_at)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
              {(active?.messages || []).length === 0 && !loadingMsgs && (
                <div className="text-center py-12 text-gray-400 text-sm">Сообщений пока нет</div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {/* Поле ответа */}
          <form onSubmit={sendReply} className="border-t border-gray-100 dark:border-gray-700 p-2 sm:p-3 bg-white dark:bg-gray-800 flex gap-2">
            <input
              value={reply}
              onChange={e => setReply(e.target.value)}
              placeholder="Ответ от имени клиники..."
              disabled={sending}
              className="flex-1 h-11 px-3 rounded-xl text-sm focus:outline-none border disabled:opacity-60"
              style={{ borderColor: 'rgba(0,0,0,.1)' }}
            />
            <button type="submit" disabled={!reply.trim() || sending}
              className="px-4 sm:px-5 h-11 rounded-xl text-sm font-bold text-white disabled:opacity-40 transition-all active:scale-[.98] flex items-center gap-1.5"
              style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)' }}>
              {sending ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                  <span className="hidden sm:inline">Отправить</span>
                </>
              )}
            </button>
          </form>
        </>
      )}
    </div>
  )

  return (
    <div className="p-3 md:p-6 dark:text-white">
      <div className="mb-3 md:mb-5 flex items-center gap-2">
        <h2 className="text-lg md:text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ color: PRIMARY, fontVariationSettings: "'FILL' 1" }}>chat_bubble</span>
          Чаты пациентов
        </h2>
        {totalUnread > 0 && (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold text-white" style={{ background: '#EF4444' }}>
            {totalUnread} новых
          </span>
        )}
      </div>

      {err && (
        <div className="mb-3 p-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-700">
          {err}
        </div>
      )}

      {/* Layout: на mobile показываем либо список, либо чат. На lg — оба колонки. */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-3 md:gap-4"
        style={{ height: 'calc(100vh - 180px)', minHeight: 480 }}>
        <div className={`${showListMobile || !activeId ? 'block' : 'hidden'} lg:block min-h-0 h-full`}>
          {ListPanel}
        </div>
        <div className={`${!showListMobile && activeId ? 'block' : 'hidden'} lg:block min-h-0 h-full`}>
          {ChatPanel}
        </div>
      </div>
    </div>
  )
}
