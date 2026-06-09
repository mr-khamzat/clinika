/**
 * Плавающий AI-ассистент для PatientCabinet (/p/).
 *
 * Появляется в правом нижнем углу. Если у тенанта не подключён модуль
 * ai_assistant — POST /patient-portal/ai/conversations вернёт 402, и виджет
 * скрывается (переходит в state 'unavailable').
 *
 * Mobile: разворачивается во весь экран. Desktop: 320×500 окошко.
 */
import { useEffect, useRef, useState } from 'react'
import axios from 'axios'

export default function PatientAiWidget({ apiBase, patientPhone, tenantSlug }) {
  // Patient session token — обязательный query-параметр ?t=... для backend.
  // Читаем из localStorage (ключ совпадает с PatientCabinet TOKEN_KEY).
  // session_token (short-lived JWT) лежит в clinika_patient_session — это то что бекенд проверяет
  const sessionToken = (typeof localStorage !== 'undefined' && localStorage.getItem('clinika_patient_session')) || ''
  const tParam = sessionToken ? `?t=${encodeURIComponent(sessionToken)}` : ''
  const [open, setOpen] = useState(false)
  // 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  const [state, setState] = useState('idle')
  const [convId, setConvId] = useState(null)
  const [convStatus, setConvStatus] = useState('active')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef(null)

  // Создаём беседу при первом открытии
  async function ensureConversation() {
    if (convId) return convId
    if (!patientPhone || !tenantSlug) return null
    setState('loading')
    try {
      const r = await axios.post(`${apiBase}/patient-portal/ai/conversations${tParam}`, {
        patient_phone: patientPhone,
        tenant_slug:   tenantSlug,
      })
      const id = r.data?.id
      setConvId(id)
      setConvStatus(r.data?.status || 'active')
      // Подгружаем историю если уже есть
      try {
        const h = await axios.get(`${apiBase}/patient-portal/ai/conversations/${id}/messages${tParam}`)
        const msgs = Array.isArray(h.data?.messages) ? h.data.messages : []
        setMessages(msgs.filter(m => m.role !== 'system'))
      } catch {}
      setState('ready')
      return id
    } catch (e) {
      if (e?.response?.status === 402) {
        setState('unavailable')
      } else {
        setState('error')
      }
      return null
    }
  }

  // При открытии — создаём беседу
  useEffect(() => {
    if (open && state === 'idle') ensureConversation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Пробное создание при монтировании (чтобы понимать — показывать ли кнопку)
  useEffect(() => {
    let alive = true
    if (!patientPhone || !tenantSlug) return
    // Проверяем доступность модуля «тихо»: легковесная попытка создания
    // (если уже есть — вернётся существующая; если 402 — скроем виджет).
    axios.post(`${apiBase}/patient-portal/ai/conversations${tParam}`, {
      patient_phone: patientPhone, tenant_slug: tenantSlug,
    }).then(r => {
      if (!alive) return
      setConvId(r.data?.id)
      setConvStatus(r.data?.status || 'active')
      setState('ready')
    }).catch(e => {
      if (!alive) return
      if (e?.response?.status === 402) setState('unavailable')
      else setState('idle')  // временная ошибка — кнопку показываем, попробуем при клике
    })
    return () => { alive = false }
  }, [apiBase, patientPhone, tenantSlug])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, open])

  if (state === 'unavailable') return null
  if (!patientPhone || !tenantSlug) return null

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    const id = await ensureConversation()
    if (!id) return
    setSending(true)
    setInput('')
    setMessages(prev => [...prev, {
      id: 'tmp-' + Date.now(),
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }])
    try {
      const r = await axios.post(
        `${apiBase}/patient-portal/ai/conversations/${id}/messages${tParam}`,
        { text },
      )
      const answer = r.data?.text || ''
      const escalated = !!r.data?.escalated
      setMessages(prev => [...prev, {
        id: 'a-' + Date.now(),
        role: 'assistant',
        content: answer,
        escalated,
        created_at: new Date().toISOString(),
      }])
      if (escalated) setConvStatus('escalated')
    } catch (e) {
      const detail = e?.response?.data?.detail || 'Не удалось отправить сообщение.'
      setMessages(prev => [...prev, {
        id: 'e-' + Date.now(),
        role: 'assistant',
        content: detail,
        created_at: new Date().toISOString(),
      }])
    } finally {
      setSending(false)
    }
  }

  async function escalate() {
    if (!convId) return
    try {
      await axios.post(`${apiBase}/patient-portal/ai/conversations/${convId}/escalate${tParam}`)
      setConvStatus('escalated')
      setMessages(prev => [...prev, {
        id: 's-' + Date.now(),
        role: 'assistant',
        content: 'Передал диалог менеджеру. Ответит в течение 5 минут.',
        created_at: new Date().toISOString(),
      }])
    } catch {}
  }

  return (
    <>
      {/* Плавающая кнопка */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed z-40 rounded-full shadow-lg flex items-center justify-center"
          style={{
            right: 18, bottom: 92,
            width: 56, height: 56,
            background: '#0097A7', color: '#fff',
            transition: 'transform .15s ease',
          }}
          aria-label="AI-ассистент"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 28 }}>
            smart_toy
          </span>
        </button>
      )}

      {/* Панель чата */}
      {open && (
        <div
          className="fixed z-50 flex flex-col bg-white dark:bg-gray-800 shadow-2xl"
          style={{
            right: 18, bottom: 92,
            width: 'min(calc(100vw - 36px), 340px)',
            height: 'min(calc(100vh - 120px), 520px)',
            borderRadius: 18,
            overflow: 'hidden',
            border: '1px solid #E5E7EB',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2"
               style={{ background: '#0097A7', color: '#fff' }}>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ fontSize: 22 }}>smart_toy</span>
              <div>
                <div className="text-sm font-semibold leading-tight">AI-ассистент</div>
                <div className="text-[11px] opacity-90 leading-tight">
                  {convStatus === 'escalated' ? 'Передан менеджеру' : 'Онлайн · отвечает мгновенно'}
                </div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/90 hover:text-white">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* Сообщения */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2" style={{ background: '#F8FAFC' }}>
            {state === 'loading' && (
              <div className="text-xs text-gray-500 dark:text-gray-400">Загрузка…</div>
            )}
            {state === 'error' && (
              <div className="text-xs text-red-600">Ошибка соединения. Попробуйте позже.</div>
            )}
            {state === 'ready' && messages.length === 0 && (
              <div className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                Здравствуйте! Я помогу с вопросами о клинике: часы работы, как
                записаться, какие документы нужны. По симптомам дам общие
                рекомендации (не диагноз!). Сложный вопрос — переключу на менеджера.
              </div>
            )}
            {messages.map(m => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className="px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap"
                  style={{
                    maxWidth: '85%',
                    background: m.role === 'user' ? '#0097A7' : '#fff',
                    color:      m.role === 'user' ? '#fff' : '#1A2B3C',
                    border: m.role === 'user' ? 'none' : '1px solid #E5E7EB',
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {convStatus === 'escalated' && (
              <div className="text-[11px] text-center px-3 py-2 rounded-lg" style={{ background:'#FEF3C7', color:'#92400E' }}>
                Передан менеджеру, ответит в течение 5 минут.
              </div>
            )}
          </div>

          {/* Footer с input */}
          <div className="border-t border-gray-100 dark:border-gray-800 p-2 flex items-center gap-2 bg-white dark:bg-gray-800">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Напишите сообщение…"
              disabled={state !== 'ready' || sending}
              className="flex-1 rounded-full border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
            />
            <button
              onClick={send}
              disabled={!input.trim() || sending || state !== 'ready'}
              className="rounded-full flex items-center justify-center"
              style={{
                width: 36, height: 36,
                background: '#0097A7', color: '#fff',
                opacity: (!input.trim() || sending || state !== 'ready') ? 0.5 : 1,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>send</span>
            </button>
          </div>
          {convStatus !== 'escalated' && state === 'ready' && (
            <button
              onClick={escalate}
              className="w-full text-[11px] py-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 border-t border-gray-50 dark:border-gray-800"
            >
              Передать вопрос менеджеру
            </button>
          )}
        </div>
      )}
    </>
  )
}
// cache-bust 1780606462
