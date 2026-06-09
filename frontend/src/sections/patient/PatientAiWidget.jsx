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

  // ═════ БЛОК: PatientAiWidget — quick-prompts ═════
  const QUICK_PROMPTS = [
    { icon: 'thermostat',  label: 'Что принять при температуре?' },
    { icon: 'event_available', label: 'Когда планировать чекап?' },
    { icon: 'science',     label: 'Расшифровать анализ' },
    { icon: 'medication',  label: 'Сочетание лекарств' },
  ]

  return (
    <>
      {/* ═════ Inline keyframes для AI-виджета ═════ */}
      <style>{`
        @keyframes ai-pop {
          from { opacity: 0; transform: translateY(12px) scale(.96) }
          to   { opacity: 1; transform: translateY(0)   scale(1) }
        }
        @keyframes ai-msg-in {
          from { opacity: 0; transform: translateY(6px) }
          to   { opacity: 1; transform: translateY(0) }
        }
        @keyframes ai-dot {
          0%, 60%, 100% { transform: translateY(0); opacity: .4 }
          30%           { transform: translateY(-4px); opacity: 1 }
        }
        @keyframes ai-shine {
          0%   { transform: translateX(-100%) }
          100% { transform: translateX(100%) }
        }
        @keyframes ai-pulse-glow {
          0%,100% { box-shadow: 0 10px 28px rgba(168,85,247,.45), 0 0 0 0 rgba(168,85,247,.35) }
          50%     { box-shadow: 0 10px 28px rgba(168,85,247,.55), 0 0 0 10px rgba(168,85,247,0) }
        }
        .ai-thinking-dot { animation: ai-dot 1.2s ease-in-out infinite; display: inline-block }
        .ai-thinking-dot:nth-child(2) { animation-delay: .15s }
        .ai-thinking-dot:nth-child(3) { animation-delay: .3s }
        .ai-fab { animation: ai-pulse-glow 2.6s ease-in-out infinite }
        .ai-panel { animation: ai-pop .32s cubic-bezier(.22,1,.36,1) both }
        .ai-msg   { animation: ai-msg-in .28s cubic-bezier(.22,1,.36,1) both }
        .ai-chip:active { transform: scale(.97) }
        .ai-scroll::-webkit-scrollbar { width: 6px }
        .ai-scroll::-webkit-scrollbar-thumb { background: rgba(168,85,247,.25); border-radius: 6px }
      `}</style>

      {/* ═════ БЛОК: AI FAB — плавающая кнопка с purple gradient ═════ */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="ai-fab fixed z-40 rounded-full flex items-center justify-center transition-transform active:scale-95 overflow-hidden"
          style={{
            right: 18, bottom: 92,
            width: 60, height: 60,
            background: 'linear-gradient(135deg, #A855F7 0%, #7C3AED 50%, #6366F1 100%)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,.18)',
          }}
          aria-label="AI-ассистент"
        >
          {/* Shine эффект */}
          <span
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(120deg, transparent 30%, rgba(255,255,255,.35) 50%, transparent 70%)',
              animation: 'ai-shine 3.5s ease-in-out infinite',
            }}
          />
          <span className="material-symbols-outlined relative" style={{ fontSize: 30, fontVariationSettings: "'FILL' 1" }}>
            auto_awesome
          </span>
        </button>
      )}

      {/* ═════ БЛОК: AI Panel — premium glass-окно ═════ */}
      {open && (
        <div
          className="ai-panel fixed z-50 flex flex-col"
          style={{
            right: 18, bottom: 92,
            width: 'min(calc(100vw - 36px), 360px)',
            height: 'min(calc(100vh - 120px), 560px)',
            borderRadius: 22,
            overflow: 'hidden',
            background: '#FFFFFF',
            border: '1px solid rgba(168,85,247,.18)',
            boxShadow: '0 24px 60px rgba(124,58,237,.28), 0 4px 16px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.6)',
          }}
        >
          {/* ═════ Hero Header с purple gradient ═════ */}
          <div
            className="relative px-4 pt-3.5 pb-3 text-white overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #A855F7 0%, #7C3AED 55%, #6366F1 100%)' }}
          >
            <div aria-hidden className="absolute -top-8 -right-8 w-28 h-28 rounded-full" style={{ background: 'rgba(255,255,255,.18)', filter: 'blur(28px)' }} />
            <div aria-hidden className="absolute -bottom-6 -left-6 w-20 h-20 rounded-full" style={{ background: 'rgba(255,255,255,.12)', filter: 'blur(20px)' }} />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(255,255,255,.22)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,.25)' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                </div>
                <div className="min-w-0">
                  <div className="text-[15px] font-extrabold leading-tight">AI-помощник</div>
                  <div className="text-[11px] opacity-95 leading-tight mt-0.5 flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: convStatus === 'escalated' ? '#FBBF24' : '#34D399', boxShadow: '0 0 6px currentColor' }} />
                    {convStatus === 'escalated' ? 'Передан менеджеру' : 'Онлайн · отвечает мгновенно'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-white transition-transform active:scale-90"
                style={{ background: 'rgba(255,255,255,.15)' }}
                aria-label="Закрыть"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
              </button>
            </div>
          </div>

          {/* ═════ Сообщения ═════ */}
          <div
            ref={scrollRef}
            className="ai-scroll flex-1 overflow-y-auto px-3 py-3 space-y-2"
            style={{ background: 'linear-gradient(180deg, #FAF5FF 0%, #F8FAFC 100%)' }}
          >
            {state === 'loading' && (
              <div className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined text-base animate-spin" style={{ color: '#A855F7' }}>progress_activity</span>
                Загрузка…
              </div>
            )}
            {state === 'error' && (
              <div className="text-xs text-red-600 px-3 py-2 rounded-xl" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
                Ошибка соединения. Попробуйте позже.
              </div>
            )}

            {/* ═════ Hero подсказка + quick-prompts (показываем когда пусто) ═════ */}
            {state === 'ready' && messages.length === 0 && (
              <div className="ai-msg space-y-3">
                <div
                  className="rounded-2xl p-3.5"
                  style={{
                    background: 'linear-gradient(135deg, rgba(168,85,247,.08), rgba(99,102,241,.06))',
                    border: '1px solid rgba(168,85,247,.15)',
                  }}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                         style={{ background: 'linear-gradient(135deg,#A855F7,#7C3AED)', boxShadow: '0 4px 12px rgba(168,85,247,.3)' }}>
                      <span className="material-symbols-outlined text-white" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                    </div>
                    <div className="text-[13px] leading-relaxed" style={{ color: '#1F2937' }}>
                      Здравствуйте! Спросите про симптомы, лекарства или советы — отвечу мгновенно. Сложный вопрос переключу на менеджера.
                    </div>
                  </div>
                </div>

                {/* Quick-prompts chips */}
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PROMPTS.map((qp, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(qp.label)}
                      className="ai-chip inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11.5px] font-semibold transition-transform"
                      style={{
                        background: '#FFFFFF',
                        color: '#7C3AED',
                        border: '1px solid rgba(168,85,247,.25)',
                        boxShadow: '0 2px 6px rgba(124,58,237,.06)',
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}>{qp.icon}</span>
                      {qp.label}
                    </button>
                  ))}
                </div>

                {/* Disclaimer amber */}
                <div
                  className="rounded-xl px-3 py-2.5 flex items-start gap-2"
                  style={{ background: 'linear-gradient(135deg, #FEF3C7, #FDE68A)', border: '1px solid #FCD34D' }}
                >
                  <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 16, color: '#B45309', fontVariationSettings: "'FILL' 1", marginTop: 1 }}>info</span>
                  <p className="text-[11px] leading-relaxed" style={{ color: '#92400E' }}>
                    AI не заменяет врача — для серьёзных вопросов запишитесь на приём.
                  </p>
                </div>
              </div>
            )}

            {/* ═════ Bubbles ═════ */}
            {messages.map((m, i) => {
              const isUser = m.role === 'user'
              return (
                <div key={m.id} className={`ai-msg flex ${isUser ? 'justify-end' : 'justify-start'}`} style={{ animationDelay: `${Math.min(i, 6) * 0.04}s` }}>
                  <div
                    className="px-3 py-2 text-[13.5px] whitespace-pre-wrap leading-relaxed"
                    style={{
                      maxWidth: '85%',
                      background: isUser
                        ? 'linear-gradient(135deg, #A855F7, #7C3AED)'
                        : '#FFFFFF',
                      color: isUser ? '#FFFFFF' : '#1F2937',
                      border: isUser ? 'none' : '1px solid rgba(168,85,247,.15)',
                      borderRadius: isUser ? '16px 16px 6px 16px' : '16px 16px 16px 6px',
                      boxShadow: isUser
                        ? '0 4px 12px rgba(124,58,237,.28)'
                        : '0 2px 8px rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.6)',
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              )
            })}

            {/* ═════ Loading indicator: 3 dots ═════ */}
            {sending && (
              <div className="ai-msg flex justify-start">
                <div
                  className="px-3.5 py-3 inline-flex items-center gap-1"
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid rgba(168,85,247,.15)',
                    borderRadius: '16px 16px 16px 6px',
                    boxShadow: '0 2px 8px rgba(0,0,0,.04)',
                  }}
                >
                  {[0,1,2].map(i => (
                    <span
                      key={i}
                      className="ai-thinking-dot"
                      style={{ width: 6, height: 6, borderRadius: '50%', background: 'linear-gradient(135deg,#A855F7,#7C3AED)' }}
                    />
                  ))}
                </div>
              </div>
            )}

            {convStatus === 'escalated' && (
              <div
                className="text-[11px] text-center px-3 py-2 rounded-xl"
                style={{ background: 'linear-gradient(135deg,#FEF3C7,#FDE68A)', color: '#92400E', border: '1px solid #FCD34D' }}
              >
                Передан менеджеру, ответит в течение 5 минут.
              </div>
            )}
          </div>

          {/* ═════ Footer Input — rounded-full ═════ */}
          <div
            className="p-2.5 flex items-center gap-2"
            style={{
              background: '#FFFFFF',
              borderTop: '1px solid rgba(168,85,247,.12)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,.6)',
            }}
          >
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Спросите AI-помощника…"
              disabled={state !== 'ready' || sending}
              className="flex-1 rounded-full px-4 py-2.5 text-[13.5px] outline-none transition-all"
              style={{
                background: '#F8FAFC',
                border: '1px solid rgba(168,85,247,.15)',
                color: '#1F2937',
              }}
              onFocus={e => { e.target.style.borderColor = '#A855F7'; e.target.style.boxShadow = '0 0 0 3px rgba(168,85,247,.15)' }}
              onBlur={e => { e.target.style.borderColor = 'rgba(168,85,247,.15)'; e.target.style.boxShadow = 'none' }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || sending || state !== 'ready'}
              className="rounded-full flex items-center justify-center transition-transform active:scale-90 disabled:opacity-40"
              style={{
                width: 40, height: 40,
                background: 'linear-gradient(135deg, #A855F7, #7C3AED)',
                color: '#fff',
                boxShadow: '0 6px 14px rgba(124,58,237,.32)',
              }}
              aria-label="Отправить"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
                {sending ? 'hourglass_top' : 'send'}
              </span>
            </button>
          </div>
          {convStatus !== 'escalated' && state === 'ready' && (
            <button
              onClick={escalate}
              className="w-full text-[11px] py-2 font-semibold transition-colors"
              style={{ color: '#7C3AED', background: 'rgba(168,85,247,.05)', borderTop: '1px solid rgba(168,85,247,.10)' }}
            >
              <span className="material-symbols-outlined align-middle mr-1" style={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}>support_agent</span>
              Передать вопрос менеджеру
            </button>
          )}
        </div>
      )}
    </>
  )
}
// cache-bust 1780606462
