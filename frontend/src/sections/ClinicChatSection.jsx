/**
 * ========================================
 * БЛОК: ClinicChatSection — чат клиники с пациентами (Глава 9)
 * ========================================
 * Используется в DoctorLayout.jsx, _ManagerShell.jsx, OperationalCabinet.jsx.
 * Роль определяется снаружи (user.role) — для doctor скрываем «Назначить врача».
 *
 * API:
 *   GET    /clinic/chat/threads?clinic_id=&status=open|closed
 *   GET    /clinic/chat/threads/{id}
 *   POST   /clinic/chat/threads/{id}/messages
 *   POST   /clinic/chat/threads/{id}/assign     (manager/reg)
 *   POST   /clinic/chat/threads/{id}/close
 *
 * Используется тот же api-инстанс (Bearer admin token), что и в кабинетах
 * врача / менеджера / регистратора.
 * ========================================
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import { useToast } from '../design'
import MessageBubble from '../components/chat/MessageBubble'
import ThreadListItem from '../components/chat/ThreadListItem'
import PatientContextPanel from '../components/chat/PatientContextPanel'
import ReassignModal from '../components/chat/ReassignModal'
import TemplateAutocomplete from '../components/chat/TemplateAutocomplete'
import useChatSoundNotification from '../hooks/useChatSoundNotification'
import { enableWebPush, disableWebPush, getPushPermissionState } from '../lib/webPush'

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

// SVG для empty-state
function EmptyChatIllustration({ size = 120 }) {
  return (
    <svg viewBox="0 0 200 160" width={size} height={size * 0.8} aria-hidden>
      <defs>
        <linearGradient id="empty-clinic-chat" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0097A7" stopOpacity=".15" />
          <stop offset="1" stopColor="#1565C0" stopOpacity=".25" />
        </linearGradient>
      </defs>
      <ellipse cx="100" cy="138" rx="60" ry="6" fill="rgba(15,23,42,.08)" />
      <path d="M40 30 h100 a18 18 0 0 1 18 18 v44 a18 18 0 0 1 -18 18 h-50 l-22 18 v-18 h-28 a18 18 0 0 1 -18 -18 v-44 a18 18 0 0 1 18 -18 z"
            fill="url(#empty-clinic-chat)" stroke="#0097A7" strokeOpacity=".4" strokeWidth="1.5" />
      <circle cx="72"  cy="68" r="5" fill="#0097A7" />
      <circle cx="100" cy="68" r="5" fill="#0097A7" />
      <circle cx="128" cy="68" r="5" fill="#0097A7" />
    </svg>
  )
}

// ── Модал «Назначить врача» (manager/reg) ───────────────────────────────────
function AssignDoctorModal({ open, onClose, onAssign, clinicId }) {
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) { setDoctors([]); setPicked(''); return }
    setLoading(true)
    // Пытаемся загрузить врачей клиники — несколько fallback-эндпоинтов
    const tryLoad = async () => {
      const params = clinicId ? { clinic_id: clinicId } : {}
      try {
        const r = await api.get('/doctors', { params })
        const arr = Array.isArray(r.data) ? r.data : (r.data?.items || r.data?.doctors || [])
        setDoctors(arr)
      } catch {
        try {
          const r2 = await api.get('/clinic/doctors', { params })
          const arr = Array.isArray(r2.data) ? r2.data : (r2.data?.items || [])
          setDoctors(arr)
        } catch { setDoctors([]) }
      }
      setLoading(false)
    }
    tryLoad()
  }, [open, clinicId])

  if (!open) return null

  const submit = async () => {
    if (!picked) return
    setBusy(true)
    try {
      await onAssign?.(Number(picked))
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center"
         style={{ background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(4px)' }}
         onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden"
           style={{ background: 'var(--bg, #fff)', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        <div className="px-5 py-4 flex items-center justify-between border-b" style={{ borderColor: 'var(--border, #e2e8f0)' }}>
          <div className="font-bold" style={{ fontSize: 16 }}>Назначить врача</div>
          <button onClick={onClose} className="grid place-items-center"
                  style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-1, #f1f5f9)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>
        <div className="p-5 space-y-3">
          {loading ? (
            <div className="text-center py-4" style={{ color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>Загрузка врачей…</div>
          ) : doctors.length === 0 ? (
            <div className="text-center py-4" style={{ color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>Нет доступных врачей</div>
          ) : (
            <select
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl outline-none"
              style={{ background: 'var(--bg-1, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', fontSize: 14 }}
            >
              <option value="">— выберите —</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>{d.full_name || d.name || `Врач #${d.id}`}</option>
              ))}
            </select>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl font-semibold"
                    style={{ background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}>
              Отмена
            </button>
            <button onClick={submit} disabled={!picked || busy}
                    className="flex-1 py-2.5 rounded-xl font-semibold text-white disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
              {busy ? 'Назначаем…' : 'Назначить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Главный компонент ────────────────────────────────────────────────────────
export default function ClinicChatSection({ role = 'doctor', clinicId: clinicIdProp }) {
  const { toast } = useToast() || {}
  const nav = useNavigate()

  const [threads, setThreads] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [listErr, setListErr] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')   // open | closed | all
  const [doctorFilter, setDoctorFilter] = useState('')       // '' | 'mine' | id

  const [activeId, setActiveId] = useState(null)
  const [active, setActive] = useState(null)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [showListMobile, setShowListMobile] = useState(true)
  const [assignOpen, setAssignOpen] = useState(false)
  const [reassignOpen, setReassignOpen] = useState(false)
  const [tplQuery, setTplQuery] = useState(null)                 // null = неактивен, '' = открыт пустой, иначе текст после '/'
  const [showPatientCard, setShowPatientCard] = useState(false)  // mobile drawer карточки пациента
  const [labelMenuOpen, setLabelMenuOpen] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem('clinic_chat_sound') !== '0' } catch { return true }
  })
  const playSound = useChatSoundNotification({ enabled: soundEnabled })
  const lastNotifyIdRef = useRef(null)        // последний message_id для которого играли звук
  const typingTickRef = useRef(0)             // дебаунс отправки typing

  // ── Quick wins хвосты: drag&drop, quoted reply, push button ───────────────
  const [isDragging, setIsDragging] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState([])
  const [replyingTo, setReplyingTo] = useState(null)  // {id, body_preview, sender_type}
  const [pushState, setPushState] = useState('default')  // default|granted|denied|unsupported

  useEffect(() => {
    getPushPermissionState().then(setPushState)
  }, [])

  const bottomRef = useRef(null)
  const textareaRef = useRef(null)
  const lastMsgIdRef = useRef(null)

  const canAssign = role === 'manager' || role === 'reg' || role === 'franchise_owner'
  const canClose  = role === 'manager' || role === 'reg' || role === 'doctor' || role === 'franchise_owner'

  // ── Quick actions: ссылки на запись / направление ──────────────────────
  // /manager/schedules доступен только manager/franchise_owner.
  const canBook = role === 'manager' || role === 'franchise_owner'
  const patientPhone = active?.thread?.patient_phone || ''
  const patientName  = active?.thread?.patient_name || ''
  const goBookAppointment = () => {
    const qs = new URLSearchParams()
    if (patientPhone) qs.set('patient_phone', patientPhone)
    if (patientName)  qs.set('patient_name', patientName)
    nav('/manager/schedules' + (qs.toString() ? '?' + qs.toString() : ''))
  }
  const goCreateReferral = () => {
    const qs = new URLSearchParams()
    if (patientPhone) qs.set('patient_phone', patientPhone)
    if (patientName)  qs.set('patient_name', patientName)
    nav('/create' + (qs.toString() ? '?' + qs.toString() : ''))
  }

  // ── Fetch threads ─────────────────────────────────────────────────────────
  const fetchThreads = useCallback(async () => {
    try {
      const params = {}
      if (statusFilter && statusFilter !== 'all') params.status = statusFilter
      if (clinicIdProp) params.clinic_id = clinicIdProp
      const r = await api.get('/clinic/chat/threads', { params })
      let list = Array.isArray(r.data) ? r.data : (r.data?.threads || [])
      if (doctorFilter === 'mine') {
        list = list.filter(t => t.assigned_doctor_id && t.is_mine)
      } else if (doctorFilter) {
        list = list.filter(t => String(t.assigned_doctor_id) === String(doctorFilter))
      }
      setThreads(list)
      setListErr('')
    } catch (e) {
      setListErr(e?.response?.data?.detail || 'Не удалось загрузить треды')
    } finally {
      setLoadingList(false)
    }
  }, [statusFilter, doctorFilter, clinicIdProp])

  // ── Fetch single thread ──────────────────────────────────────────────────
  const fetchThread = useCallback(async (id, silent = false) => {
    if (!id) return
    if (!silent) setLoadingMsgs(true)
    try {
      const r = await api.get(`/clinic/chat/threads/${id}`)
      setActive(r.data)
      setThreads(prev => prev.map(t => t.id === id ? { ...t, unread_for_clinic: 0 } : t))
      api.post(`/clinic/chat/threads/${id}/read`).catch(() => {})
    } catch (e) {
      if (!silent) toast?.(e?.response?.data?.detail || 'Не удалось загрузить тред', 'error')
    } finally {
      if (!silent) setLoadingMsgs(false)
    }
  }, [toast])

  // ── Effects ──────────────────────────────────────────────────────────────
  useEffect(() => { fetchThreads() }, [fetchThreads])
  useEffect(() => {
    if (!activeId) { setActive(null); return }
    fetchThread(activeId)
  }, [activeId, fetchThread])
  useEffect(() => {
    if (!activeId) return
    const tid = setInterval(() => fetchThread(activeId, true), POLL_MS)
    return () => clearInterval(tid)
  }, [activeId, fetchThread])
  useEffect(() => {
    const tid = setInterval(fetchThreads, 30_000)
    return () => clearInterval(tid)
  }, [fetchThreads])

  // Звук на новое входящее сообщение (только не своё).
  useEffect(() => {
    const list = active?.messages || []
    if (!list.length) return
    const last = list[list.length - 1]
    if (last.id === lastNotifyIdRef.current) return
    lastNotifyIdRef.current = last.id
    // Не воспроизводим звук при первой загрузке треда — только при добавлении НОВЫХ сообщений после mount.
    const isOwn = last.sender_type === 'doctor' || last.sender_type === 'manager'
                  || last.sender_type === 'reg' || last.sender_type === 'staff' || last.is_mine
    if (isOwn) return
    playSound()
  }, [active, playSound])

  // Авто-скролл
  useEffect(() => {
    const list = active?.messages || []
    const lastId = list.length ? list[list.length - 1].id : null
    if (lastId !== lastMsgIdRef.current) {
      lastMsgIdRef.current = lastId
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 30)
    }
  }, [active])

  // ── Send ─────────────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    if (!activeId) return
    const body = draft.trim()
    if (!body && pendingAttachments.length === 0) return
    setSending(true)
    try {
      await api.post(`/clinic/chat/threads/${activeId}/messages`, {
        body,
        attachments: pendingAttachments.length ? pendingAttachments : undefined,
        reply_to_id: replyingTo?.id,
      })
      setDraft('')
      setPendingAttachments([])
      setReplyingTo(null)
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      await fetchThread(activeId, true)
      fetchThreads()
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Не удалось отправить', 'error')
    }
    setSending(false)
  }, [activeId, draft, pendingAttachments, replyingTo, fetchThread, fetchThreads, toast])

  // ── Drag&drop handlers (загрузка файлов в текущий тред) ──────────────────
  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    setIsDragging(false)
    if (!activeId) return
    const files = Array.from(e.dataTransfer?.files || [])
    for (const file of files) {
      const fd = new FormData()
      fd.append('file', file)
      try {
        const r = await api.post(`/clinic/chat/threads/${activeId}/files`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        setPendingAttachments(prev => [...prev, r.data])
      } catch (err) {
        toast?.(err?.response?.data?.detail || 'Не удалось загрузить файл', 'error')
      }
    }
  }, [activeId, toast])
  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragging(true) }, [])
  const handleDragLeave = useCallback((e) => { e.preventDefault(); setIsDragging(false) }, [])

  // ── Assign / Close ───────────────────────────────────────────────────────
  const doAssign = async (doctorId) => {
    if (!activeId) return
    try {
      await api.post(`/clinic/chat/threads/${activeId}/assign`, { doctor_id: doctorId })
      toast?.('Врач назначен', 'success')
      setAssignOpen(false)
      await fetchThread(activeId, true)
      fetchThreads()
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Не удалось назначить', 'error')
    }
  }
  const doClose = async () => {
    if (!activeId) return
    if (!confirm('Закрыть тред?')) return
    try {
      await api.post(`/clinic/chat/threads/${activeId}/close`)
      toast?.('Тред закрыт', 'success')
      await fetchThread(activeId, true)
      fetchThreads()
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Не удалось закрыть', 'error')
    }
  }

  // ── Quick wins: реакции / pin / label / typing-emit ─────────────────────
  const doReact = async (messageId, emoji) => {
    try {
      await api.post(`/clinic/chat/messages/${messageId}/reactions`, { emoji })
      await fetchThread(activeId, true)
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Не удалось добавить реакцию', 'error')
    }
  }
  const doPin = async () => {
    if (!activeId) return
    try {
      await api.post(`/clinic/chat/threads/${activeId}/pin`)
      await fetchThread(activeId, true)
      fetchThreads()
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Не удалось закрепить', 'error')
    }
  }
  const doLabel = async (color) => {
    if (!activeId) return
    setLabelMenuOpen(false)
    try {
      await api.patch(`/clinic/chat/threads/${activeId}/label`, { color })
      await fetchThread(activeId, true)
      fetchThreads()
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Не удалось применить лейбл', 'error')
    }
  }
  // Эмитим typing не чаще раза в 4 сек, чтобы не заваливать backend
  const emitTyping = useCallback(() => {
    if (!activeId) return
    const now = Date.now()
    if (now - typingTickRef.current < 4000) return
    typingTickRef.current = now
    api.post(`/clinic/chat/threads/${activeId}/typing`).catch(() => {})
  }, [activeId])
  const toggleSound = () => {
    setSoundEnabled(v => {
      const next = !v
      try { localStorage.setItem('clinic_chat_sound', next ? '1' : '0') } catch {}
      return next
    })
  }

  // ── Auto-resize + typing-emit ────────────────────────────────────────────
  const onDraftChange = (e) => {
    const v = e.target.value
    setDraft(v)
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
    if (v.trim().length > 0) emitTyping()
    // Триггер шаблонов: если строка начинается с / — открываем picker
    const m = v.match(/^\/(\S*)$/)
    if (m) setTplQuery(m[1])
    else setTplQuery(null)
  }
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!sending) send()
    }
  }

  // ── Render messages ──────────────────────────────────────────────────────
  const renderedMessages = useMemo(() => {
    const out = []
    const msgs = active?.messages || []
    let prevDate = null
    let prevSender = null
    for (const m of msgs) {
      const d = m.created_at ? new Date(m.created_at) : null
      if (d && (!prevDate || !sameDay(prevDate, d))) {
        out.push({ kind: 'sep', id: 's-' + m.id, label: dateSeparatorLabel(d) })
        prevDate = d; prevSender = null
      }
      // Для клиники свои — те, что от персонала (doctor/manager/reg)
      const isOwn = m.sender_type === 'doctor' || m.sender_type === 'manager' || m.sender_type === 'reg' || m.sender_type === 'staff' || m.is_mine
      const showAvatar = !isOwn && (prevSender !== m.sender_type || prevSender === null)
      out.push({ kind: 'msg', id: m.id, msg: m, isOwn, showAvatar })
      prevSender = m.sender_type
    }
    return out
  }, [active])

  const hasThreads = threads.length > 0

  return (
    <>
      <style>{`
        @keyframes msg-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        .msg-in { animation: msg-in .22s cubic-bezier(.22,1,.36,1) }
        .chat-scroll::-webkit-scrollbar { width: 6px }
        .chat-scroll::-webkit-scrollbar-thumb { background: rgba(148,163,184,.4); border-radius: 6px }
        /* 3-я колонка (карточка пациента) — только на широких экранах при выбранном треде */
        .clinic-chat-patient-col { display: none; }
        @media (min-width: 1100px) {
          .clinic-chat-patient-col[data-has-active="true"] { display: flex; }
        }
        /* На широких экранах кнопка-toggle карточки в шапке скрыта (панель и так видна) */
        @media (min-width: 1100px) {
          .clinic-chat-patient-toggle { display: none !important; }
        }
      `}</style>

      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'var(--surface, #fff)',
          border: '1px solid var(--border, #e2e8f0)',
          boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(15,23,42,.08))',
        }}
      >
        <div
          className="grid"
          style={{
            // Desktop: список 320 | чат 1fr | карточка 300 (если выбран тред); иначе 320 | 1fr.
            // Mobile: одна колонка, переключение между списком/тредом; карточка — overlay-drawer.
            gridTemplateColumns: typeof window !== 'undefined' && window.innerWidth >= 1100
              ? (activeId ? '320px 1fr 300px' : '320px 1fr')
              : (typeof window !== 'undefined' && window.innerWidth >= 900 ? '320px 1fr' : '1fr'),
            minHeight: 'min(640px, calc(100vh - 220px))',
          }}
        >
          {/* Список тредов */}
          <div
            className={`flex-col border-r ${(activeId && !showListMobile) ? 'hidden md:flex' : 'flex'}`}
            style={{ borderColor: 'var(--border, #e2e8f0)', background: 'var(--bg-1, #f8fafc)' }}
          >
            <div className="px-3 py-3 sticky top-0 z-10" style={{ background: 'var(--bg-1, #f8fafc)', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
              <div className="font-bold mb-2" style={{ fontSize: 14, color: 'var(--fg, #0F172A)' }}>Чаты пациентов</div>
              <div className="flex gap-1">
                {[
                  { k: 'open',   label: 'Открытые' },
                  { k: 'closed', label: 'Закрытые' },
                  { k: 'all',    label: 'Все' },
                ].map(o => (
                  <button
                    key={o.k}
                    onClick={() => setStatusFilter(o.k)}
                    className="flex-1 py-1.5 rounded-lg font-semibold transition-colors"
                    style={{
                      fontSize: 11.5,
                      background: statusFilter === o.k ? 'var(--accent, #0097A7)' : 'var(--bg, #fff)',
                      color: statusFilter === o.k ? '#fff' : 'var(--fg-2, #475569)',
                      border: '1px solid var(--border, #e2e8f0)',
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {role !== 'doctor' && (
                <div className="mt-2 flex gap-1">
                  <button
                    onClick={() => setDoctorFilter('')}
                    className="flex-1 py-1 rounded-lg"
                    style={{
                      fontSize: 11,
                      background: doctorFilter === '' ? 'var(--accent-soft, rgba(0,151,167,.1))' : 'transparent',
                      color: doctorFilter === '' ? 'var(--accent, #0097A7)' : 'var(--fg-3, #94a3b8)',
                      border: '1px solid var(--border, #e2e8f0)',
                    }}
                  >
                    Все врачи
                  </button>
                  <button
                    onClick={() => setDoctorFilter('mine')}
                    className="flex-1 py-1 rounded-lg"
                    style={{
                      fontSize: 11,
                      background: doctorFilter === 'mine' ? 'var(--accent-soft, rgba(0,151,167,.1))' : 'transparent',
                      color: doctorFilter === 'mine' ? 'var(--accent, #0097A7)' : 'var(--fg-3, #94a3b8)',
                      border: '1px solid var(--border, #e2e8f0)',
                    }}
                  >
                    Мои
                  </button>
                </div>
              )}
            </div>
            <div className="chat-scroll flex-1 overflow-y-auto p-2 space-y-1" style={{ maxHeight: 'calc(100vh - 320px)' }}>
              {loadingList && <div className="text-center py-8" style={{ color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>Загрузка…</div>}
              {!loadingList && listErr && (
                <div className="rounded-xl p-3 m-2" style={{ background: '#fee2e2', color: '#991b1b', fontSize: 13 }}>{listErr}</div>
              )}
              {!loadingList && !listErr && !hasThreads && (
                <div className="text-center py-10 px-4">
                  <EmptyChatIllustration size={120} />
                  <div className="mt-3" style={{ fontSize: 13, color: 'var(--fg-2, #475569)' }}>
                    Нет чатов в этой категории
                  </div>
                </div>
              )}
              {!loadingList && hasThreads && threads.map(t => (
                <ThreadListItem
                  key={t.id}
                  thread={t}
                  active={activeId === t.id}
                  onClick={() => { setActiveId(t.id); setShowListMobile(false) }}
                  side="clinic"
                />
              ))}
            </div>
          </div>

          {/* Активный тред */}
          <div
            className={`flex-col ${(!activeId || showListMobile) ? 'hidden md:flex' : 'flex'}`}
            style={{ minHeight: 'min(640px, calc(100vh - 220px))' }}
          >
            {!activeId && (
              <div className="flex-1 grid place-items-center p-6 text-center">
                <div>
                  <EmptyChatIllustration size={140} />
                  <div className="mt-4 font-bold" style={{ fontSize: 15, color: 'var(--fg, #0F172A)' }}>Выберите чат</div>
                  <div className="mt-1" style={{ fontSize: 13, color: 'var(--fg-2, #475569)' }}>сообщения пациентов слева</div>
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
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>arrow_back</span>
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate flex items-center gap-1.5" style={{ fontSize: 14, color: 'var(--fg, #0F172A)' }}>
                      {active?.thread?.is_pinned && (
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 16, color: '#F59E0B', fontVariationSettings: "'FILL' 1" }}
                          title="Тред закреплён"
                        >push_pin</span>
                      )}
                      {active?.thread?.color_label && (
                        <span
                          style={{
                            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                            background:
                              active.thread.color_label === 'red'    ? '#EF4444' :
                              active.thread.color_label === 'yellow' ? '#F59E0B' :
                              active.thread.color_label === 'green'  ? '#22C55E' :
                              active.thread.color_label === 'blue'   ? '#3B82F6' : 'transparent',
                          }}
                          title={`Лейбл: ${active.thread.color_label}`}
                          aria-hidden
                        />
                      )}
                      <span className="truncate">{active?.thread?.patient_name || active?.thread?.patient_phone || 'Пациент'}</span>
                      {active?.thread?.sla_breached_level && (
                        <span className="px-2 py-1 rounded-md inline-flex items-center gap-1 flex-shrink-0"
                              style={{
                                background: '#fee2e2', color: '#991b1b',
                                fontSize: 10.5, fontWeight: 700, letterSpacing: '.02em',
                              }}
                              title={`SLA нарушен — эскалирован до ${active.thread.sla_breached_level}`}>
                          <span className="material-symbols-outlined" style={{ fontSize: 12, fontVariationSettings: "'FILL' 1" }}>warning</span>
                          SLA: {active.thread.sla_breached_level.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="truncate" style={{ fontSize: 11.5, color: 'var(--fg-3, #94a3b8)' }}>
                      {(() => {
                        // Typing indicator: показываем если last_typing_at_patient свежий (< 5s)
                        const t = active?.thread?.last_typing_at_patient
                        if (t) {
                          const age = Date.now() - new Date(t).getTime()
                          if (age < 5000 && age >= 0) {
                            return <span style={{ color: 'var(--accent, #0097A7)', fontStyle: 'italic' }}>Пациент печатает…</span>
                          }
                        }
                        return (
                          <>
                            {active?.thread?.subject || 'без темы'}
                            {active?.thread?.assigned_doctor_name && <span> · {active.thread.assigned_doctor_name}</span>}
                          </>
                        )
                      })()}
                    </div>
                  </div>
                  {/* Quick-actions: запись / направление / карточка пациента */}
                  {canBook && (
                    <button
                      onClick={goBookAppointment}
                      className="grid place-items-center"
                      style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}
                      title="Записать на приём"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>event_available</span>
                    </button>
                  )}
                  <button
                    onClick={goCreateReferral}
                    className="grid place-items-center"
                    style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}
                    title="Создать направление"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>assignment_add</span>
                  </button>
                  <button
                    onClick={() => setShowPatientCard(true)}
                    className="clinic-chat-patient-toggle grid place-items-center"
                    style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}
                    title="Карточка пациента"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>account_circle</span>
                  </button>
                  {/* Pin thread */}
                  <button
                    onClick={doPin}
                    className="grid place-items-center"
                    style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: active?.thread?.is_pinned ? 'rgba(245,158,11,.18)' : 'var(--bg-1, #f1f5f9)',
                      color: active?.thread?.is_pinned ? '#B45309' : 'var(--fg-2, #475569)',
                    }}
                    title={active?.thread?.is_pinned ? 'Открепить' : 'Закрепить тред'}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: active?.thread?.is_pinned ? "'FILL' 1" : "'FILL' 0" }}>push_pin</span>
                  </button>
                  {/* Color label */}
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={() => setLabelMenuOpen(v => !v)}
                      className="grid place-items-center"
                      style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}
                      title="Лейбл (метка)"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>label</span>
                    </button>
                    {labelMenuOpen && (
                      <div
                        onMouseLeave={() => setLabelMenuOpen(false)}
                        style={{
                          position: 'absolute', top: '100%', right: 0, marginTop: 6,
                          background: 'var(--surface, #fff)',
                          border: '1px solid var(--border, #e2e8f0)',
                          borderRadius: 12, padding: 6,
                          boxShadow: '0 8px 24px rgba(15,23,42,.15)',
                          zIndex: 30, display: 'flex', gap: 6,
                        }}
                      >
                        {[
                          { c: 'red',    hex: '#EF4444' },
                          { c: 'yellow', hex: '#F59E0B' },
                          { c: 'green',  hex: '#22C55E' },
                          { c: 'blue',   hex: '#3B82F6' },
                        ].map(({ c, hex }) => (
                          <button
                            key={c}
                            onClick={() => doLabel(c)}
                            title={c}
                            style={{
                              width: 28, height: 28, borderRadius: '50%',
                              background: hex, border: active?.thread?.color_label === c ? '3px solid #0F172A' : '2px solid #fff',
                              cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,.18)',
                            }}
                            aria-label={`Установить лейбл ${c}`}
                          />
                        ))}
                        <button
                          onClick={() => doLabel(null)}
                          title="Снять лейбл"
                          style={{
                            width: 28, height: 28, borderRadius: '50%',
                            background: 'var(--bg-1, #f1f5f9)', border: '2px solid var(--border, #e2e8f0)',
                            cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--fg-2, #475569)',
                          }}
                          aria-label="Снять лейбл"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Sound toggle */}
                  <button
                    onClick={toggleSound}
                    className="grid place-items-center"
                    style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-1, #f1f5f9)', color: soundEnabled ? 'var(--accent, #0097A7)' : 'var(--fg-3, #94a3b8)' }}
                    title={soundEnabled ? 'Звук уведомлений: вкл' : 'Звук уведомлений: выкл'}
                    aria-label="Звук уведомлений"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{soundEnabled ? 'notifications_active' : 'notifications_off'}</span>
                  </button>
                  {/* Web Push subscribe toggle */}
                  {pushState !== 'unsupported' && (
                    <button
                      onClick={async () => {
                        if (pushState === 'granted') {
                          const r = await disableWebPush()
                          if (r.ok) setPushState('default')
                        } else {
                          const r = await enableWebPush()
                          if (r.ok) {
                            setPushState('granted')
                            toast?.('Push-уведомления включены', 'success')
                          } else if (r.reason) {
                            toast?.(r.reason, 'error')
                          }
                        }
                      }}
                      className="grid place-items-center"
                      style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: 'var(--bg-1, #f1f5f9)',
                        color: pushState === 'granted' ? 'var(--accent, #0097A7)' : 'var(--fg-3, #94a3b8)',
                      }}
                      title={pushState === 'granted' ? 'Push-уведомления: вкл' : 'Включить push-уведомления'}
                      aria-label="Push notifications"
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: 20,
                          fontVariationSettings: pushState === 'granted' ? "'FILL' 1" : "'FILL' 0",
                        }}
                      >
                        {pushState === 'granted' ? 'notifications_active' : 'notifications'}
                      </span>
                    </button>
                  )}
                  {canAssign && active?.thread?.status !== 'closed' && (
                    <button
                      onClick={() => setAssignOpen(true)}
                      className="grid place-items-center"
                      style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}
                      title="Назначить врача"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>person_add</span>
                    </button>
                  )}
                  {canAssign && active?.thread?.status !== 'closed' && (
                    <button onClick={() => setReassignOpen(true)}
                      className="grid place-items-center"
                      style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}
                      title="Передать тред">
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>swap_horiz</span>
                    </button>
                  )}
                  {canClose && active?.thread?.status !== 'closed' && (
                    <button
                      onClick={doClose}
                      className="grid place-items-center"
                      style={{ width: 36, height: 36, borderRadius: 10, background: '#fee2e2', color: '#991b1b' }}
                      title="Закрыть тред"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>lock</span>
                    </button>
                  )}
                </div>

                {/* Поток */}
                <div
                  className="chat-scroll flex-1 overflow-y-auto p-3"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  style={{
                    background: 'var(--bg-1, #f8fafc)',
                    backgroundImage: 'radial-gradient(rgba(0,151,167,.06) 1px, transparent 1px)',
                    backgroundSize: '24px 24px',
                    maxHeight: 'calc(100vh - 360px)',
                    position: 'relative',
                  }}
                >
                  {loadingMsgs && <div className="text-center py-6" style={{ color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>Загрузка…</div>}
                  {!loadingMsgs && (active?.messages || []).length === 0 && (
                    <div className="text-center py-10 px-4">
                      <EmptyChatIllustration size={100} />
                      <div className="mt-2" style={{ fontSize: 13, color: 'var(--fg-2, #475569)' }}>Нет сообщений</div>
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
                      : <MessageBubble
                          key={item.id}
                          message={item.msg}
                          isOwn={item.isOwn}
                          showAvatar={item.showAvatar}
                          onReact={active?.thread?.status !== 'closed' ? doReact : undefined}
                          onReply={active?.thread?.status !== 'closed' ? (msg) => setReplyingTo({
                            id: msg.id,
                            body_preview: (msg.body || '').slice(0, 100),
                            sender_type: msg.sender_type,
                          }) : undefined}
                        />
                  ))}
                  <div ref={bottomRef} />
                  {isDragging && (
                    <div
                      style={{
                        position: 'absolute', inset: 0, zIndex: 50,
                        background: 'rgba(0,151,167,.15)',
                        border: '3px dashed #0097A7',
                        display: 'grid', placeItems: 'center',
                        fontSize: 16, fontWeight: 600, color: '#0097A7',
                        pointerEvents: 'none',
                        borderRadius: 8,
                      }}
                    >
                      Отпустите чтобы прикрепить
                    </div>
                  )}
                </div>

                {/* Input */}
                {active?.thread?.status === 'closed' ? (
                  <div className="px-3 py-3 text-center" style={{ borderTop: '1px solid var(--border, #e2e8f0)', color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>
                    Тред закрыт
                  </div>
                ) : (
                  <div className="px-2 py-2" style={{ borderTop: '1px solid var(--border, #e2e8f0)', background: 'var(--surface, #fff)', position: 'relative' }}>
                    {/* Pending attachments preview (chips с ✕) */}
                    {pendingAttachments.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '6px 8px' }}>
                        {pendingAttachments.map((a, i) => (
                          <div
                            key={i}
                            style={{
                              padding: '4px 8px', borderRadius: 8, fontSize: 11,
                              background: 'var(--bg-1, #f1f5f9)',
                              display: 'flex', gap: 4, alignItems: 'center',
                              border: '1px solid var(--border, #e2e8f0)',
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>attach_file</span>
                            <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                            <button
                              type="button"
                              onClick={() => setPendingAttachments(prev => prev.filter((_, j) => j !== i))}
                              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-3, #94a3b8)', padding: 0, lineHeight: 1 }}
                              aria-label="Убрать вложение"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Reply-to preview */}
                    {replyingTo && (
                      <div
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 10px', margin: '0 8px 4px',
                          background: 'var(--bg-1, #f1f5f9)',
                          borderLeft: '3px solid var(--accent, #0097A7)',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'var(--accent, #0097A7)' }}>reply</span>
                        <span style={{ flex: 1, color: 'var(--fg-2, #475569)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          Ответ: {replyingTo.body_preview}
                        </span>
                        <button
                          type="button"
                          onClick={() => setReplyingTo(null)}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-3, #94a3b8)' }}
                          aria-label="Отменить ответ"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                    <TemplateAutocomplete
                      query={tplQuery}
                      onPick={async (t) => {
                        try { const r = await api.post(`/chat/templates/${t.id}/use`); setDraft(r.data?.body || t.body) }
                        catch { setDraft(t.body) }
                        setTplQuery(null)
                        setTimeout(() => textareaRef.current?.focus(), 30)
                      }}
                      onClose={() => setTplQuery(null)}
                    />
                    <div className="flex items-end gap-2">
                      <textarea
                        ref={textareaRef}
                        value={draft}
                        onChange={onDraftChange}
                        onKeyDown={onKeyDown}
                        rows={1}
                        placeholder="Ответ пациенту… (наберите / для шаблонов)"
                        className="flex-1 px-3 py-2.5 rounded-2xl outline-none resize-none"
                        style={{ background: 'var(--bg-1, #f1f5f9)', border: '1px solid var(--border, #e2e8f0)', fontSize: 14, color: 'var(--fg, #0F172A)', lineHeight: 1.4, maxHeight: 140, minHeight: 40 }}
                      />
                      <button
                        type="button"
                        onClick={send}
                        disabled={sending || (!draft.trim() && pendingAttachments.length === 0)}
                        className="grid place-items-center flex-shrink-0 text-white disabled:opacity-40"
                        style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #0097A7, #0A2342)', boxShadow: '0 4px 12px rgba(0,151,167,.35)' }}
                        aria-label="Отправить"
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

          {/* Карточка пациента — 3-я колонка на широких экранах */}
          <div
            className="clinic-chat-patient-col flex-col border-l"
            data-has-active={activeId ? 'true' : 'false'}
            style={{ borderColor: 'var(--border, #e2e8f0)', background: 'var(--bg-1, #f8fafc)' }}
          >
            {activeId && (
              <PatientContextPanel
                variant="panel"
                threadId={activeId}
                onBookAppointment={canBook ? goBookAppointment : undefined}
                onCreateReferral={goCreateReferral}
                showBookButton={canBook}
              />
            )}
          </div>
        </div>
      </div>

      <AssignDoctorModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        onAssign={doAssign}
        clinicId={active?.thread?.clinic_id || clinicIdProp}
      />

      <ReassignModal
        open={reassignOpen}
        onClose={() => setReassignOpen(false)}
        threadId={activeId}
        clinicId={active?.thread?.clinic_id || clinicIdProp}
        onDone={() => { fetchThread(activeId, true); fetchThreads() }}
      />

      {/* Mobile-drawer карточки пациента (на узких экранах) */}
      {activeId && (
        <PatientContextPanel
          variant="drawer"
          threadId={activeId}
          open={showPatientCard}
          onClose={() => setShowPatientCard(false)}
          onBookAppointment={canBook ? () => { setShowPatientCard(false); goBookAppointment() } : undefined}
          onCreateReferral={() => { setShowPatientCard(false); goCreateReferral() }}
          showBookButton={canBook}
        />
      )}
    </>
  )
}
