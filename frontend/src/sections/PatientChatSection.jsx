/**
 * ========================================
 * БЛОК: PatientChatSection — премиум-чат пациента (Глава 9)
 * ========================================
 * Используется в PatientCabinet.jsx (вкладка «Сообщения»).
 *
 * API:
 *   GET    /patient/chat/threads
 *   POST   /patient/chat/threads               (создание)
 *   GET    /patient/chat/threads/{id}
 *   POST   /patient/chat/threads/{id}/messages (отправка)
 *   POST   /patient/chat/threads/{id}/read     (прочитано)
 *
 * Слой UX:
 *   - Двухколоночный layout на desktop, single-column на mobile
 *   - Пузыри сообщений (Telegram-like)
 *   - Авто-скролл вниз, polling 10s активного треда
 *   - 402 → premium modal с CTA «Здоровье+ 290₽/мес»
 *   - Empty state с inline SVG-иллюстрацией
 * ========================================
 */
import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import { useToast } from '../design'
import MessageBubble from '../components/chat/MessageBubble'
import ThreadListItem from '../components/chat/ThreadListItem'

const NewThreadModal = lazy(() => import('../components/chat/NewThreadModal'))

const SESSION_KEY = 'clinika_patient_session'
const POLL_MS = 10_000

// ── Утилиты ──────────────────────────────────────────────────────────────────
function sameDay(a, b) {
  if (!a || !b) return false
  return a.toDateString() === b.toDateString()
}
function dateSeparatorLabel(d) {
  const now = new Date()
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, now)) return 'Сегодня'
  if (sameDay(d, yesterday)) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: now.getFullYear() === d.getFullYear() ? undefined : 'numeric' })
}

// Inline SVG empty state — рисунок «облако диалога»
function EmptyChatIllustration({ size = 120 }) {
  return (
    <svg viewBox="0 0 200 160" width={size} height={size * 0.8} aria-hidden>
      <defs>
        <linearGradient id="empty-chat-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0097A7" stopOpacity=".15" />
          <stop offset="1" stopColor="#1565C0" stopOpacity=".25" />
        </linearGradient>
      </defs>
      <ellipse cx="100" cy="138" rx="60" ry="6" fill="rgba(15,23,42,.08)" />
      <path d="M40 30 h100 a18 18 0 0 1 18 18 v44 a18 18 0 0 1 -18 18 h-50 l-22 18 v-18 h-28 a18 18 0 0 1 -18 -18 v-44 a18 18 0 0 1 18 -18 z"
            fill="url(#empty-chat-grad)" stroke="#0097A7" strokeOpacity=".4" strokeWidth="1.5" />
      <circle cx="72"  cy="68" r="5" fill="#0097A7" />
      <circle cx="100" cy="68" r="5" fill="#0097A7" />
      <circle cx="128" cy="68" r="5" fill="#0097A7" />
    </svg>
  )
}

// 402 модал (отдельный — без lazy, лёгкий)
function PremiumModal({ open, onClose, onSubscribe }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center"
         style={{ background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(4px)' }}
         onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="w-full sm:max-w-sm overflow-hidden rounded-t-3xl sm:rounded-3xl"
           style={{ background: 'var(--bg, #fff)', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        <div className="p-6 text-white" style={{ background: 'linear-gradient(145deg,#0A2342,#1565C0,#0097A7)' }}>
          <div className="grid place-items-center mx-auto mb-3"
               style={{ width: 64, height: 64, borderRadius: 20, background: 'rgba(255,255,255,.18)' }}>
            <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
          </div>
          <div className="text-center">
            <div className="font-black text-xl">Подписка «Здоровье+»</div>
            <div className="text-blue-100 text-sm mt-1">Безлимитный чат с клиникой</div>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <div className="text-sm" style={{ color: 'var(--fg-2, #475569)' }}>
            Без подписки доступно 3 сообщения в месяц.
            С «Здоровье+» — безлимит, приоритетный ответ и расширенная медкарта.
          </div>
          <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(135deg, #e0f7fa, #ede7f6)' }}>
            <div className="text-3xl font-black" style={{ color: '#00838F' }}>290 ₽<span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-2)' }}> /мес</span></div>
            <div className="text-xs mt-1" style={{ color: 'var(--fg-2, #475569)' }}>отмена в любой момент</div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl font-semibold"
                    style={{ background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}>
              Позже
            </button>
            <button onClick={onSubscribe}
                    className="flex-1 py-2.5 rounded-xl font-semibold text-white"
                    style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)', boxShadow: '0 4px 14px rgba(0,151,167,.3)' }}>
              Подключить
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Главный компонент ────────────────────────────────────────────────────────
export default function PatientChatSection({ sessionToken: sessionTokenProp, onGoSubscription }) {
  const sessionToken = sessionTokenProp || (typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null)
  const { toast } = useToast() || {}

  const [threads, setThreads] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [listErr, setListErr] = useState('')

  const [activeId, setActiveId] = useState(null)
  const [active, setActive] = useState(null)        // { thread, messages: [] }
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [pickedFiles, setPickedFiles] = useState([])

  const [showNewThread, setShowNewThread] = useState(false)
  const [showPremium, setShowPremium] = useState(false)
  const [showListMobile, setShowListMobile] = useState(true)

  const bottomRef = useRef(null)
  const fileRef = useRef(null)
  const textareaRef = useRef(null)
  const lastMsgIdRef = useRef(null)

  // ── API ────────────────────────────────────────────────────────────────────
  const params = useMemo(() => ({ t: sessionToken }), [sessionToken])

  const fetchThreads = useCallback(async () => {
    try {
      const r = await axios.get(`${API_BASE}/patient/chat/threads`, { params })
      const list = Array.isArray(r.data) ? r.data : (r.data?.threads || [])
      setThreads(list)
      setListErr('')
    } catch (e) {
      setListErr(e?.response?.data?.detail || 'Не удалось загрузить чаты')
    } finally {
      setLoadingList(false)
    }
  }, [params])

  const fetchThread = useCallback(async (id, silent = false) => {
    if (!id) return
    if (!silent) setLoadingMsgs(true)
    try {
      const r = await axios.get(`${API_BASE}/patient/chat/threads/${id}`, { params: { ...params, limit: 100, offset: 0 } })
      setActive(r.data)
      // Сброс непрочитанных у локального списка
      setThreads(prev => prev.map(t => t.id === id ? { ...t, unread_for_patient: 0 } : t))
      // Mark read (silent)
      axios.post(`${API_BASE}/patient/chat/threads/${id}/read`, {}, { params }).catch(() => {})
    } catch (e) {
      if (!silent) toast?.(e?.response?.data?.detail || 'Не удалось загрузить тред', 'error')
    } finally {
      if (!silent) setLoadingMsgs(false)
    }
  }, [params, toast])

  // ── Список + первичная загрузка ───────────────────────────────────────────
  useEffect(() => {
    if (!sessionToken) return
    fetchThreads()
  }, [sessionToken, fetchThreads])

  // ── При открытии треда — загрузить ────────────────────────────────────────
  useEffect(() => {
    if (!activeId) { setActive(null); return }
    fetchThread(activeId)
  }, [activeId, fetchThread])

  // ── Polling активного треда (10 сек) ──────────────────────────────────────
  useEffect(() => {
    if (!activeId) return
    const tid = setInterval(() => fetchThread(activeId, true), POLL_MS)
    return () => clearInterval(tid)
  }, [activeId, fetchThread])

  // ── Polling списка тредов (30 сек) — чтобы видеть новые unread ───────────
  useEffect(() => {
    if (!sessionToken) return
    const tid = setInterval(fetchThreads, 30_000)
    return () => clearInterval(tid)
  }, [sessionToken, fetchThreads])

  // ── Авто-скролл при появлении нового сообщения ───────────────────────────
  useEffect(() => {
    const list = active?.messages || []
    const lastId = list.length ? list[list.length - 1].id : null
    if (lastId !== lastMsgIdRef.current) {
      lastMsgIdRef.current = lastId
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 30)
    }
  }, [active])

  // ── Клиники из истории — для NewThreadModal ──────────────────────────────
  const clinicsForNew = useMemo(() => {
    const map = new Map()
    threads.forEach(t => {
      if (t.clinic_id && !map.has(t.clinic_id)) map.set(t.clinic_id, { id: t.clinic_id, name: t.clinic_name || `Клиника #${t.clinic_id}` })
    })
    return Array.from(map.values())
  }, [threads])

  // ── Отправка сообщения ───────────────────────────────────────────────────
  const send = useCallback(async () => {
    if (!activeId) return
    const body = draft.trim()
    if (!body && pickedFiles.length === 0) return
    setSending(true)
    try {
      // Если есть файлы — multipart, иначе JSON
      if (pickedFiles.length > 0) {
        const fd = new FormData()
        fd.append('body', body)
        pickedFiles.forEach(f => fd.append('attachments', f))
        await axios.post(`${API_BASE}/patient/chat/threads/${activeId}/messages`, fd, { params })
      } else {
        await axios.post(`${API_BASE}/patient/chat/threads/${activeId}/messages`, { body }, { params })
      }
      setDraft('')
      setPickedFiles([])
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      await fetchThread(activeId, true)
      fetchThreads()
    } catch (e) {
      const code = e?.response?.status
      if (code === 402) {
        setShowPremium(true)
      } else {
        toast?.(e?.response?.data?.detail || 'Не удалось отправить', 'error')
      }
    }
    setSending(false)
  }, [activeId, draft, pickedFiles, params, fetchThread, fetchThreads, toast])

  // ── Auto-resize textarea ─────────────────────────────────────────────────
  const onDraftChange = (e) => {
    setDraft(e.target.value)
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
  }
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!sending) send()
    }
  }

  // ── Группировка сообщений с date-separator и showAvatar логикой ──────────
  const renderedMessages = useMemo(() => {
    const out = []
    const msgs = active?.messages || []
    let prevDate = null
    let prevSender = null
    for (const m of msgs) {
      const d = m.created_at ? new Date(m.created_at) : null
      if (d && (!prevDate || !sameDay(prevDate, d))) {
        out.push({ kind: 'sep', id: 's-' + m.id, label: dateSeparatorLabel(d) })
        prevDate = d
        prevSender = null
      }
      const isOwn = m.sender_type === 'patient' || m.sender_type === 'me'
      const showAvatar = !isOwn && (prevSender !== m.sender_type || prevSender === null)
      out.push({ kind: 'msg', id: m.id, msg: m, isOwn, showAvatar })
      prevSender = m.sender_type
    }
    return out
  }, [active])

  // ── Render ────────────────────────────────────────────────────────────────
  const hasThreads = threads.length > 0

  if (!sessionToken) {
    return (
      <div className="px-4 py-8 text-center" style={{ color: 'var(--fg-2, #475569)' }}>
        Войдите в кабинет, чтобы открыть чат
      </div>
    )
  }

  return (
    <>
      <style>{`
        @keyframes msg-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        .msg-in { animation: msg-in .22s cubic-bezier(.22,1,.36,1) }
        .chat-scroll::-webkit-scrollbar { width: 6px }
        .chat-scroll::-webkit-scrollbar-thumb { background: rgba(148,163,184,.4); border-radius: 6px }
      `}</style>

      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'var(--surface, #fff)',
          border: '1px solid var(--border, #e2e8f0)',
          boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(15,23,42,.08))',
          minHeight: 'min(620px, calc(100vh - 240px))',
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr)',
        }}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: typeof window !== 'undefined' && window.innerWidth >= 900 ? '300px 1fr' : '1fr',
            minHeight: 'min(620px, calc(100vh - 240px))',
          }}
        >
          {/* ── Список тредов ── */}
          <div
            className={`flex-col border-r ${(activeId && !showListMobile) ? 'hidden md:flex' : 'flex'}`}
            style={{ borderColor: 'var(--border, #e2e8f0)', background: 'var(--bg-1, #f8fafc)' }}
          >
            <div className="px-4 py-3 flex items-center gap-2 sticky top-0" style={{ background: 'var(--bg-1, #f8fafc)', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
              <div className="font-bold flex-1" style={{ fontSize: 15, color: 'var(--fg, #0F172A)' }}>Сообщения</div>
              <button
                onClick={() => setShowNewThread(true)}
                className="grid place-items-center"
                style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #0097A7, #0A2342)', color: '#fff', boxShadow: '0 2px 8px rgba(0,151,167,.3)' }}
                aria-label="Новый чат"
                title="Новый чат"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>edit_square</span>
              </button>
            </div>
            <div className="chat-scroll flex-1 overflow-y-auto p-2 space-y-1" style={{ maxHeight: 'calc(100vh - 280px)' }}>
              {loadingList && (
                <div className="text-center py-8" style={{ color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>Загрузка…</div>
              )}
              {!loadingList && listErr && (
                <div className="rounded-xl p-3 m-2" style={{ background: '#fee2e2', color: '#991b1b', fontSize: 13 }}>{listErr}</div>
              )}
              {!loadingList && !listErr && !hasThreads && (
                <div className="text-center py-10 px-4">
                  <EmptyChatIllustration size={120} />
                  <div className="mt-3 font-semibold" style={{ fontSize: 14, color: 'var(--fg, #0F172A)' }}>
                    Пока нет сообщений
                  </div>
                  <div className="mt-1" style={{ fontSize: 12, color: 'var(--fg-2, #475569)' }}>
                    Напишите первое сообщение клинике
                  </div>
                  <button
                    onClick={() => setShowNewThread(true)}
                    className="mt-4 px-4 py-2 rounded-xl font-semibold text-white"
                    style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)', fontSize: 13 }}
                  >
                    Новое сообщение
                  </button>
                </div>
              )}
              {!loadingList && hasThreads && threads.map(t => (
                <ThreadListItem
                  key={t.id}
                  thread={t}
                  active={activeId === t.id}
                  onClick={() => { setActiveId(t.id); setShowListMobile(false) }}
                  side="patient"
                />
              ))}
            </div>
          </div>

          {/* ── Активный тред ── */}
          <div
            className={`flex-col ${(!activeId || showListMobile) ? 'hidden md:flex' : 'flex'}`}
            style={{ minHeight: 'min(620px, calc(100vh - 240px))' }}
          >
            {!activeId && (
              <div className="flex-1 grid place-items-center p-6 text-center">
                <div>
                  <EmptyChatIllustration size={140} />
                  <div className="mt-4 font-bold" style={{ fontSize: 15, color: 'var(--fg, #0F172A)' }}>Выберите чат</div>
                  <div className="mt-1" style={{ fontSize: 13, color: 'var(--fg-2, #475569)' }}>или начните новый</div>
                </div>
              </div>
            )}

            {activeId && (
              <>
                {/* Header треда */}
                <div className="px-3 py-2.5 flex items-center gap-2 sticky top-0 z-10"
                     style={{ background: 'var(--surface, #fff)', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
                  <button
                    onClick={() => { setActiveId(null); setShowListMobile(true) }}
                    className="md:hidden grid place-items-center"
                    style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}
                    aria-label="Назад"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>arrow_back</span>
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate" style={{ fontSize: 14, color: 'var(--fg, #0F172A)' }}>
                      {active?.thread?.clinic_name || 'Клиника'}
                    </div>
                    <div className="truncate" style={{ fontSize: 11.5, color: 'var(--fg-3, #94a3b8)' }}>
                      {active?.thread?.assigned_doctor_name || active?.thread?.subject || 'поддержка клиники'}
                    </div>
                  </div>
                  {active?.thread?.status === 'closed' && (
                    <span className="px-2 py-0.5 rounded-full" style={{ background: '#e2e8f0', color: '#475569', fontSize: 11, fontWeight: 600 }}>
                      закрыт
                    </span>
                  )}
                </div>

                {/* Поток сообщений */}
                <div
                  className="chat-scroll flex-1 overflow-y-auto p-3"
                  style={{
                    background: 'var(--bg-1, #f8fafc)',
                    backgroundImage: 'radial-gradient(rgba(0,151,167,.06) 1px, transparent 1px)',
                    backgroundSize: '24px 24px',
                    maxHeight: 'calc(100vh - 360px)',
                  }}
                >
                  {loadingMsgs && (
                    <div className="text-center py-6" style={{ color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>Загрузка…</div>
                  )}
                  {!loadingMsgs && (active?.messages || []).length === 0 && (
                    <div className="text-center py-10 px-4">
                      <EmptyChatIllustration size={100} />
                      <div className="mt-2" style={{ fontSize: 13, color: 'var(--fg-2, #475569)' }}>
                        Напишите первое сообщение
                      </div>
                    </div>
                  )}
                  {!loadingMsgs && renderedMessages.map(item => (
                    item.kind === 'sep'
                      ? <div key={item.id} className="flex justify-center my-3 msg-in">
                          <span className="px-3 py-1 rounded-full"
                                style={{ background: 'rgba(255,255,255,.85)', color: 'var(--fg-3, #64748b)', fontSize: 11, fontWeight: 600, border: '1px solid var(--border, #e2e8f0)' }}>
                            {item.label}
                          </span>
                        </div>
                      : <MessageBubble key={item.id} message={item.msg} isOwn={item.isOwn} showAvatar={item.showAvatar} />
                  ))}
                  <div ref={bottomRef} />
                </div>

                {/* Input */}
                {active?.thread?.status === 'closed' ? (
                  <div className="px-3 py-3 text-center" style={{ borderTop: '1px solid var(--border, #e2e8f0)', color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>
                    Чат закрыт клиникой
                  </div>
                ) : (
                  <div className="px-2 py-2" style={{ borderTop: '1px solid var(--border, #e2e8f0)', background: 'var(--surface, #fff)' }}>
                    {pickedFiles.length > 0 && (
                      <div className="px-2 pb-2 flex flex-wrap gap-1.5">
                        {pickedFiles.map((f, i) => (
                          <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: 'var(--bg-1, #f1f5f9)', fontSize: 12 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>attach_file</span>
                            <span className="truncate" style={{ maxWidth: 140 }}>{f.name}</span>
                            <button onClick={() => setPickedFiles(prev => prev.filter((_, j) => j !== i))}
                                    className="grid place-items-center" style={{ width: 18, height: 18, color: 'var(--fg-3, #94a3b8)' }} aria-label="Убрать">
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-end gap-2">
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="grid place-items-center flex-shrink-0"
                        style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}
                        aria-label="Прикрепить файл"
                        title="Прикрепить файл"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 22 }}>attach_file</span>
                      </button>
                      <input
                        ref={fileRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || [])
                          setPickedFiles(prev => [...prev, ...files].slice(0, 5))
                          e.target.value = ''
                        }}
                      />
                      <textarea
                        ref={textareaRef}
                        value={draft}
                        onChange={onDraftChange}
                        onKeyDown={onKeyDown}
                        rows={1}
                        placeholder="Напишите сообщение…"
                        className="flex-1 px-3 py-2.5 rounded-2xl outline-none resize-none"
                        style={{ background: 'var(--bg-1, #f1f5f9)', border: '1px solid var(--border, #e2e8f0)', fontSize: 14, color: 'var(--fg, #0F172A)', lineHeight: 1.4, maxHeight: 140, minHeight: 40 }}
                      />
                      <button
                        type="button"
                        onClick={send}
                        disabled={sending || (!draft.trim() && pickedFiles.length === 0)}
                        className="grid place-items-center flex-shrink-0 text-white disabled:opacity-40"
                        style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #0097A7, #0A2342)', boxShadow: '0 4px 12px rgba(0,151,167,.35)' }}
                        aria-label="Отправить"
                        title="Отправить (Enter)"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}>
                          {sending ? 'hourglass_top' : 'send'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Создание нового треда */}
      <Suspense fallback={null}>
        <NewThreadModal
          open={showNewThread}
          onClose={() => setShowNewThread(false)}
          onCreated={(t) => {
            setShowNewThread(false)
            fetchThreads()
            if (t?.id) { setActiveId(t.id); setShowListMobile(false) }
          }}
          sessionToken={sessionToken}
          clinics={clinicsForNew}
          apiBase={API_BASE}
        />
      </Suspense>

      {/* Premium upsell на 402 */}
      <PremiumModal
        open={showPremium}
        onClose={() => setShowPremium(false)}
        onSubscribe={() => { setShowPremium(false); onGoSubscription?.() }}
      />
    </>
  )
}
