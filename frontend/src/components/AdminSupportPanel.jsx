/**
 * ========================================
 * БЛОК: Панель поддержки для администратора
 * ========================================
 * - Список диалогов с пользователями
 * - Открытие конкретного диалога
 * - Ответ через форму
 * - Закрытие / открытие диалога
 * ========================================
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import useAuthStore from '../store/auth'
import { API_BASE, BASE_PATH, SLUG } from '../config'

const API = API_BASE + '/support'

function fmt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const ROLE_LABELS = { reg: 'Регистратор', manager: 'Менеджер', partner_doctor: 'Врач-партнёр' }

// ─── Компонент: один диалог ───
function ThreadView({ userId, userName, onClose, onCloseThread, isClosed, authHeaders }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/admin/thread/${userId}`, { headers: authHeaders })
      setMessages(r.data)
    } catch {}
  }, [userId, authHeaders])

  // Heartbeat: пока диалог открыт — оператор в сети
  useEffect(() => {
    const beat = () => axios.post(`${API}/operator/heartbeat`, {}, { headers: authHeaders }).catch(() => {})
    beat() // сразу при открытии
    const id = setInterval(beat, 30000) // каждые 30 сек
    return () => {
      clearInterval(id)
      // При закрытии — немедленно офлайн
      axios.post(`${API}/operator/offline`, {}, { headers: authHeaders }).catch(() => {})
    }
  }, [authHeaders])

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [messages])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!text.trim() || sending) return
    const t = text.trim()
    setText('')
    setSending(true)
    try {
      await axios.post(`${API}/admin/reply/${userId}`, { text: t }, { headers: authHeaders })
      await load()
    } catch { setText(t) }
    finally { setSending(false) }
  }

  const handleClose = async () => {
    try {
      await axios.post(`${API}/admin/close/${userId}`, {}, { headers: authHeaders })
      onCloseThread(userId, true)
    } catch {}
  }

  const handleReopen = async () => {
    try {
      await axios.post(`${API}/admin/reopen/${userId}`, {}, { headers: authHeaders })
      onCloseThread(userId, false)
    } catch {}
  }

  return (
    <div className="flex flex-col h-full">
      {/* Шапка */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition"
        >
          <span className="material-symbols-outlined text-xl">arrow_back</span>
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-gray-900 dark:text-white truncate">{userName}</div>
          {isClosed && (
            <div className="text-xs text-gray-400">Диалог закрыт</div>
          )}
        </div>
        {isClosed ? (
          <button
            onClick={handleReopen}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition"
          >
            <span className="material-symbols-outlined text-sm">lock_open</span>
            Открыть
          </button>
        ) : (
          <button
            onClick={handleClose}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-xl text-xs font-medium hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 dark:hover:text-red-400 transition"
          >
            <span className="material-symbols-outlined text-sm">check_circle</span>
            Закрыть
          </button>
        )}
      </div>

      {/* Сообщения */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50 dark:bg-gray-900">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Нет сообщений
          </div>
        ) : messages.map((m) => (
          <div key={m.id} className={`flex ${m.is_from_user ? 'justify-start' : 'justify-end'}`}>
            <div className="max-w-[80%]">
              <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                m.is_from_user
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-tl-sm shadow-sm border border-gray-100 dark:border-gray-600'
                  : 'bg-blue-600 text-white rounded-tr-sm'
              }`}>
                {m.file_type === 'image' && m.file_url ? (
                  <img src={m.file_url} alt={m.file_name} className="max-w-[200px] rounded-lg" />
                ) : m.file_type === 'document' && m.file_url ? (
                  <a href={m.file_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 hover:opacity-80">
                    <span className="material-symbols-outlined text-lg">description</span>
                    <span className="truncate max-w-[160px] text-xs">{m.file_name}</span>
                  </a>
                ) : (
                  m.text
                )}
              </div>
              <div className={`text-[11px] mt-0.5 text-gray-400 ${m.is_from_user ? 'text-left' : 'text-right'}`}>
                {fmt(m.created_at)}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Поле ввода */}
      {!isClosed && (
        <form
          onSubmit={handleSend}
          className="flex items-end gap-2 px-3 py-3 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0"
        >
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e) }
            }}
            placeholder="Ответить пользователю..."
            rows={1}
            className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-2xl px-4 py-2.5 text-sm outline-none resize-none text-gray-900 dark:text-white placeholder-gray-400 leading-5 max-h-24 overflow-y-auto"
            style={{ height: '40px' }}
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="flex-shrink-0 w-10 h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-2xl flex items-center justify-center transition active:scale-95"
          >
            {sending ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <span className="material-symbols-outlined text-xl" style={{fontVariationSettings:"'FILL' 1"}}>send</span>
            )}
          </button>
        </form>
      )}
      {isClosed && (
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 text-center text-xs text-gray-400">
          Диалог закрыт — нажмите «Открыть» для продолжения
        </div>
      )}
    </div>
  )
}

// ─── Основной компонент ───
// Принимает необязательный tokenProp (для AdminLayout, где токен приходит через prop)
export default function AdminSupportPanel({ tokenProp } = {}) {
  const { token: storeToken } = useAuthStore()
  const token = tokenProp || storeToken
  const [threads, setThreads] = useState([])
  const [activeThread, setActiveThread] = useState(null) // { userId, userName, isClosed }
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('open') // open | closed | all

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {}

  const loadThreads = useCallback(async () => {
    setLoading(true)
    try {
      const r = await axios.get(`${API}/admin/threads`, { headers: authHeaders })
      setThreads(Array.isArray(r.data) ? r.data : [])
    } catch {} finally { setLoading(false) }
  }, [token])

  useEffect(() => {
    loadThreads()
    const id = setInterval(loadThreads, 10000)
    return () => clearInterval(id)
  }, [loadThreads])

  const handleCloseThread = (userId, isClosed) => {
    setThreads(prev => prev.map(t =>
      t.user_id === userId ? { ...t, is_closed: isClosed } : t
    ))
    if (activeThread?.userId === userId) {
      setActiveThread(prev => ({ ...prev, isClosed }))
    }
  }

  const filteredThreads = threads.filter(t => {
    if (filter === 'open') return !t.is_closed
    if (filter === 'closed') return t.is_closed
    return true
  })

  const totalUnread = threads.filter(t => !t.is_closed).reduce((s, t) => s + (t.unread || 0), 0)

  if (activeThread) {
    return (
      <div className="h-[520px] flex flex-col">
        <ThreadView
          userId={activeThread.userId}
          userName={activeThread.userName}
          isClosed={activeThread.isClosed}
          authHeaders={authHeaders}
          onClose={() => setActiveThread(null)}
          onCloseThread={handleCloseThread}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[520px]">
      {/* Заголовок */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-gray-900 dark:text-white">Диалоги</span>
          {totalUnread > 0 && (
            <span className="min-w-[20px] h-5 bg-red-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center px-1">
              {totalUnread}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {['open', 'all', 'closed'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                filter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {f === 'open' ? 'Открытые' : f === 'closed' ? 'Закрытые' : 'Все'}
            </button>
          ))}
          <button
            onClick={loadThreads}
            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
          >
            <span className={`material-symbols-outlined text-base ${loading ? 'animate-spin' : ''}`}>refresh</span>
          </button>
        </div>
      </div>

      {/* Список */}
      <div className="flex-1 overflow-y-auto">
        {filteredThreads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm gap-2">
            <span className="material-symbols-outlined text-4xl">forum</span>
            <span>{filter === 'open' ? 'Нет открытых диалогов' : filter === 'closed' ? 'Нет закрытых диалогов' : 'Нет диалогов'}</span>
          </div>
        ) : filteredThreads.map(t => (
          <button
            key={t.user_id}
            onClick={() => setActiveThread({ userId: t.user_id, userName: t.user_name, isClosed: t.is_closed })}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b border-gray-50 dark:border-gray-700/30 transition text-left"
          >
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${
              t.is_closed ? 'bg-gray-100 dark:bg-gray-700' : 'bg-blue-50 dark:bg-blue-900/30'
            }`}>
              <span className={`material-symbols-outlined text-lg ${
                t.is_closed ? 'text-gray-400' : 'text-blue-500'
              }`} style={{fontVariationSettings:"'FILL' 1"}}>
                {t.is_closed ? 'check_circle' : 'person'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-gray-900 dark:text-white truncate">{t.user_name}</span>
                <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 rounded px-1.5 py-0.5 flex-shrink-0">
                  {ROLE_LABELS[t.user_role] || t.user_role}
                </span>
              </div>
              <div className="text-xs text-gray-400 truncate mt-0.5">{t.last_message}</div>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className="text-[11px] text-gray-400">{fmt(t.last_at)}</span>
              {t.unread > 0 && !t.is_closed && (
                <span className="min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {t.unread}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
