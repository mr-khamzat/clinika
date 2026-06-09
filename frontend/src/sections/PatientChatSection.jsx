/**
 * ========================================
 * БЛОК: PatientChatSection — премиум-чат пациента (Глава 9)
 * ========================================
 * Mobile-first UX редизайн (июнь 2026):
 *   • viewport <768px: один экран (либо список тредов, либо активный чат)
 *   • большая кнопка «✚ Написать в клинику» в шапке списка
 *   • sticky-композер с safe-area-inset-bottom + отступ под tab-bar (pb-20)
 *   • закрытый тред → CTA «✚ Открыть новый тред» вместо мёртвого текста
 *   • пузыри сообщений шире на мобильном (88%)
 *   • date-separator: фиолетовый sticky pill
 *
 * API:
 *   GET    /patient/chat/threads
 *   POST   /patient/chat/threads               (создание)
 *   GET    /patient/chat/threads/{id}
 *   POST   /patient/chat/threads/{id}/messages (отправка)
 *   POST   /patient/chat/threads/{id}/read     (прочитано)
 * ========================================
 */
import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import { useToast } from '../design'
import MessageBubble from '../components/chat/MessageBubble'
import ThreadListItem from '../components/chat/ThreadListItem'
import PatientSlotRequestPicker from '../components/chat/PatientSlotRequestPicker'

const NewThreadModal = lazy(() => import('../components/chat/NewThreadModal'))
const StickerPicker = lazy(() => import('../components/chat/StickerPicker'))

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

  // chatslot01: drawer запроса записи (пациент выбирает врача/услугу/даты)
  const [slotRequestOpen, setSlotRequestOpen] = useState(false)
  const [stickersOpen, setStickersOpen] = useState(false)

  const [showNewThread, setShowNewThread] = useState(false)
  const [showPremium, setShowPremium] = useState(false)

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

  // На мобильном видим либо список (activeId=null), либо открытый чат.
  // На десктопе видим обе панели одновременно.
  const mobileShowList = activeId == null
  const mobileShowChat = activeId != null

  return (
    <>
      {/* ═════ БЛОК: PatientChatSection — inline styles ═════ */}
      <style>{`
        @keyframes msg-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes pchat-pop { from { opacity: 0; transform: translateY(6px) scale(.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes pchat-pulse-online { 0%,100% { box-shadow: 0 0 0 0 rgba(16,185,129,.6) } 50% { box-shadow: 0 0 0 4px rgba(16,185,129,0) } }
        .msg-in { animation: msg-in .22s cubic-bezier(.22,1,.36,1) }
        .pchat-header { animation: pchat-pop .32s cubic-bezier(.22,1,.36,1) both }
        .pchat-online-dot { animation: pchat-pulse-online 2s ease-in-out infinite }
        .chat-scroll::-webkit-scrollbar { width: 6px }
        .chat-scroll::-webkit-scrollbar-thumb { background: rgba(148,163,184,.4); border-radius: 6px }
        /* Мобильный: пузыри шире (88%), на десктопе оставляем дефолт MessageBubble */
        @media (max-width: 767px) {
          .pchat-bubbles [data-msg-id] > div:last-child { max-width: 88% !important; }
        }
        /* Asymmetric corner bubbles — глобально для MessageBubble */
        .pchat-bubbles [data-msg-id][data-own="true"] > div:last-child {
          border-radius: 18px 18px 6px 18px !important;
          background: linear-gradient(135deg, #0097A7 0%, #00838F 50%, #1565C0 100%) !important;
          box-shadow: 0 4px 12px rgba(0,151,167,.25), inset 0 1px 0 rgba(255,255,255,.15) !important;
        }
        .pchat-bubbles [data-msg-id][data-own="false"] > div:last-child {
          border-radius: 18px 18px 18px 6px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.6) !important;
        }
        /* Sticky композер: безопасная зона iPhone + отступ под tab-bar (80px) */
        .pchat-composer {
          padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 80px);
        }
        @media (min-width: 768px) {
          .pchat-composer { padding-bottom: 8px; }
        }
        /* Sticky date-pill */
        .pchat-date-pill {
          position: sticky;
          top: 8px;
          z-index: 5;
        }
        /* Premium textarea focus */
        .pchat-textarea:focus {
          border-color: #0097A7 !important;
          box-shadow: 0 0 0 3px rgba(0,151,167,.15) !important;
        }
      `}</style>

      <div
        className="md:rounded-2xl overflow-hidden"
        style={{
          background: 'var(--surface, #fff)',
        }}
      >
        <div className="grid md:grid-cols-[300px_1fr]">
          {/* ══════════════ Список тредов ══════════════
              Mobile: full-screen когда activeId=null, скрыт когда открыт чат.
              Desktop (md+): всегда видим слева. */}
          <div
            className={`${mobileShowList ? 'flex' : 'hidden'} md:flex flex-col md:border-r`}
            style={{
              borderColor: 'var(--border, #e2e8f0)',
              background: 'var(--bg-1, #f8fafc)',
              minHeight: 'calc(100vh - 200px)',
            }}
          >
            {/* Шапка с большой кнопкой «Написать в клинику» */}
            <div className="px-3 pt-3 pb-2 sticky top-0 z-10" style={{ background: 'var(--bg-1, #f8fafc)', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
              <div className="flex items-center mb-2">
                <div className="font-bold flex-1" style={{ fontSize: 15, color: 'var(--fg, #0F172A)' }}>Сообщения</div>
              </div>
              <button
                onClick={() => setShowNewThread(true)}
                className="w-full flex items-center justify-center gap-2 rounded-2xl font-bold text-white transition-transform active:scale-[.98]"
                style={{
                  minHeight: 48,
                  padding: '12px 16px',
                  background: 'linear-gradient(135deg, #0097A7, #1565C0)',
                  boxShadow: '0 4px 14px rgba(0,151,167,.3)',
                  fontSize: 14,
                }}
                aria-label="Написать в клинику"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>edit_square</span>
                Написать в клинику
              </button>
            </div>

            <div className="chat-scroll flex-1 overflow-y-auto p-2 space-y-1" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 96px)' }}>
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
                    Нажмите «Написать в клинику» выше
                  </div>
                </div>
              )}
              {!loadingList && hasThreads && threads.map(t => (
                <ThreadListItem
                  key={t.id}
                  thread={t}
                  active={activeId === t.id}
                  onClick={() => { setActiveId(t.id) }}
                  side="patient"
                />
              ))}
            </div>
          </div>

          {/* ══════════════ Активный тред ══════════════
              Mobile: full-screen когда activeId!=null, иначе скрыт.
              Desktop: всегда правая колонка. */}
          <div
            className={`${mobileShowChat ? 'flex' : 'hidden'} md:flex flex-col`}
            style={{ minHeight: 'calc(100vh - 200px)' }}
          >
            {!activeId && (
              <div className="hidden md:grid flex-1 place-items-center p-6 text-center">
                <div>
                  <EmptyChatIllustration size={140} />
                  <div className="mt-4 font-bold" style={{ fontSize: 15, color: 'var(--fg, #0F172A)' }}>Выберите чат</div>
                  <div className="mt-1" style={{ fontSize: 13, color: 'var(--fg-2, #475569)' }}>или начните новый</div>
                </div>
              </div>
            )}

            {activeId && (
              <>
                {/* ═════ БЛОК: Header активного треда — premium glass ═════ */}
                <div
                  className="pchat-header px-3 py-2.5 flex items-center gap-2.5 sticky top-0 z-10"
                  style={{
                    background: 'var(--surface, #fff)',
                    borderBottom: '1px solid var(--border, #e2e8f0)',
                    boxShadow: '0 2px 12px rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.5)',
                  }}
                >
                  <button
                    onClick={() => { setActiveId(null) }}
                    className="md:hidden grid place-items-center flex-shrink-0 transition-transform active:scale-95"
                    style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg, #0F172A)' }}
                    aria-label="Назад к списку"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 22 }}>arrow_back</span>
                  </button>
                  {/* Avatar с инициалами клиники */}
                  {(() => {
                    const name = active?.thread?.clinic_name || 'Клиника'
                    const initials = name.split(' ').filter(Boolean).slice(0,2).map(s => s[0]?.toUpperCase()).join('') || 'К'
                    const isClosed = active?.thread?.status === 'closed'
                    return (
                      <div className="relative flex-shrink-0">
                        <div
                          className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-extrabold text-[14px]"
                          style={{
                            background: 'linear-gradient(135deg, #0097A7 0%, #1565C0 100%)',
                            boxShadow: '0 4px 12px rgba(0,151,167,.28), inset 0 1px 0 rgba(255,255,255,.25)',
                          }}
                        >
                          {initials}
                        </div>
                        {!isClosed && (
                          <span
                            aria-hidden
                            className="pchat-online-dot absolute -bottom-0.5 -right-0.5 rounded-full"
                            style={{ width: 12, height: 12, background: '#10B981', border: '2px solid #fff' }}
                          />
                        )}
                      </div>
                    )
                  })()}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate" style={{ fontSize: 15, color: 'var(--fg, #0F172A)' }}>
                      {active?.thread?.clinic_name || 'Клиника'}
                    </div>
                    <div className="truncate flex items-center gap-1" style={{ fontSize: 12, color: 'var(--fg-3, #94a3b8)' }}>
                      {active?.thread?.status !== 'closed' && (
                        <span className="inline-flex items-center gap-1 font-semibold" style={{ color: '#10B981' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
                          онлайн
                        </span>
                      )}
                      {(active?.thread?.assigned_doctor_name || active?.thread?.subject) && (
                        <>
                          {active?.thread?.status !== 'closed' && <span>·</span>}
                          <span className="truncate">{active?.thread?.assigned_doctor_name || active?.thread?.subject || 'поддержка'}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {active?.thread?.status === 'closed' && (
                    <span
                      className="px-2.5 py-1 rounded-full flex-shrink-0 inline-flex items-center gap-1"
                      style={{ background: '#F1F5F9', color: '#475569', fontSize: 11, fontWeight: 700, border: '1px solid #E2E8F0' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 12, fontVariationSettings: "'FILL' 1" }}>lock</span>
                      закрыт
                    </span>
                  )}
                </div>

                {/* Поток сообщений */}
                <div
                  className="pchat-bubbles chat-scroll flex-1 overflow-y-auto p-3"
                  style={{
                    background: 'var(--bg-1, #f8fafc)',
                    backgroundImage: 'radial-gradient(rgba(0,151,167,.06) 1px, transparent 1px)',
                    backgroundSize: '24px 24px',
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
                      ? <div key={item.id} className="flex justify-center my-3 pchat-date-pill">
                          <span
                            className="px-3 py-1 rounded-full font-semibold text-white shadow-md"
                            style={{
                              background: 'linear-gradient(135deg, #7C3AED, #5B21B6)',
                              fontSize: 11.5,
                              letterSpacing: '0.02em',
                              boxShadow: '0 2px 8px rgba(124,58,237,.35)',
                            }}
                          >
                            {item.label}
                          </span>
                        </div>
                      : <MessageBubble
                          key={item.id}
                          message={item.msg}
                          isOwn={item.isOwn}
                          showAvatar={item.showAvatar}
                          isPatient={true}
                          threadId={activeId}
                          onSlotBooked={() => fetchThread(activeId, true)}
                        />
                  ))}
                  <div ref={bottomRef} />
                </div>

                {/* Композер — sticky bottom, видим всегда (включая закрытый тред) */}
                <div
                  className="pchat-composer sticky bottom-0 z-10"
                  style={{
                    borderTop: '1px solid var(--border, #e2e8f0)',
                    background: 'var(--surface, #fff)',
                    paddingLeft: 8,
                    paddingRight: 8,
                    paddingTop: 8,
                  }}
                >
                  {active?.thread?.status === 'closed' ? (
                    // Закрытый тред → одна большая кнопка вместо ввода
                    <button
                      type="button"
                      onClick={() => setShowNewThread(true)}
                      className="w-full flex items-center justify-center gap-2 rounded-2xl font-bold text-white transition-transform active:scale-[.98]"
                      style={{
                        minHeight: 52,
                        padding: '14px 16px',
                        background: 'linear-gradient(135deg, #0097A7, #1565C0)',
                        boxShadow: '0 4px 14px rgba(0,151,167,.35)',
                        fontSize: 15,
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 24 }}>add_comment</span>
                      Открыть новый тред
                    </button>
                  ) : (
                    <>
                      {pickedFiles.length > 0 && (
                        <div className="pb-2 flex flex-wrap gap-1.5">
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
                          className="grid place-items-center flex-shrink-0 transition-transform active:scale-95"
                          style={{
                            width: 44, height: 44, borderRadius: '50%',
                            background: 'linear-gradient(135deg, #F1F5F9, #E2E8F0)',
                            color: '#475569',
                            border: '1px solid rgba(0,151,167,.12)',
                            boxShadow: '0 2px 6px rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.6)',
                          }}
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
                        <button
                          type="button"
                          onClick={() => setSlotRequestOpen(true)}
                          disabled={!activeId}
                          className="hidden sm:grid place-items-center flex-shrink-0 disabled:opacity-40 transition-transform active:scale-95"
                          style={{
                            width: 44, height: 44, borderRadius: '50%',
                            background: 'linear-gradient(135deg, #E0F7FA, #B2EBF2)',
                            border: '1px solid rgba(0,151,167,.2)',
                            color: '#0097A7',
                            boxShadow: '0 2px 6px rgba(0,151,167,.06), inset 0 1px 0 rgba(255,255,255,.6)',
                          }}
                          aria-label="Записаться"
                          title="Запросить запись"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}>event_available</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setStickersOpen(v => !v)}
                          disabled={!activeId}
                          className="hidden sm:grid place-items-center flex-shrink-0 disabled:opacity-40 transition-transform active:scale-95"
                          style={{
                            width: 44, height: 44, borderRadius: '50%',
                            background: 'linear-gradient(135deg, #F1F5F9, #E2E8F0)',
                            border: '1px solid rgba(0,0,0,.06)',
                            boxShadow: '0 2px 6px rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.6)',
                          }}
                          aria-label="Стикеры"
                          title="Стикеры"
                        >
                          <span style={{ fontSize: 20 }}>😀</span>
                        </button>
                        <Suspense fallback={null}>
                          {stickersOpen && (
                            <StickerPicker
                              open={stickersOpen}
                              onClose={() => setStickersOpen(false)}
                              onPick={async (url) => {
                                setStickersOpen(false)
                                if (!activeId) return
                                try {
                                  const fileName = (url||'').split('/').pop() || 'sticker.svg'
                                  const title = fileName.replace(/^sticker-\d+-/, '').replace(/\.svg$/, '')
                                  await axios.post(
                                    API_BASE + '/patient/chat/threads/' + activeId + '/messages',
                                    { body: '', attachments: [{ type: 'sticker', url, title }] },
                                    { params }
                                  )
                                  await fetchThread(activeId, true)
                                  fetchThreads()
                                } catch (e) {
                                  const code = e?.response?.status
                                  if (code === 402) setShowPremium(true)
                                  else toast?.(e?.response?.data?.detail || 'Не удалось отправить', 'error')
                                }
                              }}
                            />
                          )}
                        </Suspense>
                        <textarea
                          ref={textareaRef}
                          value={draft}
                          onChange={onDraftChange}
                          onKeyDown={onKeyDown}
                          rows={1}
                          placeholder="Напишите сообщение…"
                          className="pchat-textarea flex-1 px-4 py-3 outline-none resize-none transition-all"
                          style={{
                            background: '#F8FAFC',
                            border: '1px solid #E2E8F0',
                            borderRadius: 22,
                            fontSize: 15,
                            color: 'var(--fg, #0F172A)',
                            lineHeight: 1.4,
                            maxHeight: 140,
                            minHeight: 44,
                          }}
                        />
                        <button
                          type="button"
                          onClick={send}
                          disabled={sending || (!draft.trim() && pickedFiles.length === 0)}
                          className="grid place-items-center flex-shrink-0 text-white disabled:opacity-40 transition-transform active:scale-90"
                          style={{
                            width: 44, height: 44, borderRadius: '50%',
                            background: 'linear-gradient(135deg, #0097A7 0%, #00838F 50%, #1565C0 100%)',
                            boxShadow: '0 6px 16px rgba(0,151,167,.4), inset 0 1px 0 rgba(255,255,255,.2)',
                          }}
                          aria-label="Отправить"
                          title="Отправить (Enter)"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}>
                            {sending ? 'hourglass_top' : 'send'}
                          </span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
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
            if (t?.id) { setActiveId(t.id) }
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

      {/* chatslot01: drawer запроса записи */}
      <PatientSlotRequestPicker
        open={slotRequestOpen}
        onClose={() => setSlotRequestOpen(false)}
        threadId={activeId}
        onSent={() => fetchThread(activeId, true)}
      />
    </>
  )
}
