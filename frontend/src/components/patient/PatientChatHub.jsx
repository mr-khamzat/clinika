/**
 * ========================================
 * БЛОК: PatientChatHub — унифицированный чат-hub пациента (UX-редизайн)
 * ========================================
 * Используется в PatientCabinet.jsx (таб «Чаты»).
 *
 * Три сегмента:
 *   1) Поддержка (КлиникСеть team) — общая лента, mock-режим если бекенда нет
 *   2) Клиника — PatientChatSection (треды с врачами/менеджерами)
 *   3) AI-ассистент — Gemini-бот (если модуль ai_assistant подключён)
 *
 * Контекстное переключение:
 *   • При вводе в «Поддержка»: ["болит","рецепт","анализ","температура","выписать"]
 *     → подсказка «Это лучше обсудить с врачом → переключить в Клиника»
 *   • При вводе в «Клиника»: ["оплата","подписка","пароль","SMS"]
 *     → подсказка «Это вопрос поддержки → переключить»
 *
 * Backend support — пока mock. Endpoint /patient/support/messages
 * (optional). Если бекенд возвращает 404/501 → показываем «Скоро»
 * с инструкцией написать в support@клиниксеть.рф.
 *
 * Сохранение последнего активного сегмента в localStorage:
 *   'clinika_chat_hub_segment' = 'support' | 'clinic' | 'ai'
 * ========================================
 */
import { useEffect, useState, useRef, lazy, Suspense, useMemo, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../../config'
import SegmentControl from './SegmentControl'

// Сегменты лениво загружаются: PatientChatSection — тяжёлый
const PatientChatSection = lazy(() => import('../../sections/PatientChatSection'))

const LS_KEY = 'clinika_chat_hub_segment'
const SUPPORT_KEYWORDS_FOR_DOCTOR = ['болит', 'болят', 'рецепт', 'анализ', 'температур', 'выписать', 'диагноз', 'таблетк']
const CLINIC_KEYWORDS_FOR_SUPPORT = ['оплат', 'подписк', 'пароль', 'sms', 'смс', 'счёт', 'счет', 'логин']

// Быстрые ответы для поддержки
const SUPPORT_QUICK = [
  'Как восстановить пароль?',
  'Не приходит SMS',
  'Изменить телефон',
  'Не работает QR-код',
  'Проблема с оплатой',
]

export default function PatientChatHub({ sessionToken, patientPhone, tenantSlug, onGoSubscription }) {
  // Deeplink: если есть pending_subscription_inquiry — стартуем на segment=support
  //           (или 'clinic' для cash-mode), даже если localStorage хранит другой.
  const [pendingInquiry, setPendingInquiry] = useState(() => {
    try {
      const raw = sessionStorage.getItem('pending_subscription_inquiry')
      if (!raw) return null
      const parsed = JSON.parse(raw)
      // защита от устаревшего pending (>10 мин)
      if (!parsed?.ts || Date.now() - parsed.ts > 10 * 60 * 1000) {
        sessionStorage.removeItem('pending_subscription_inquiry')
        return null
      }
      return parsed
    } catch { return null }
  })

  const [segment, setSegment] = useState(() => {
    // Приоритет: pendingInquiry → cash_mode → 'clinic'; иначе → 'support'
    try {
      const raw = sessionStorage.getItem('pending_subscription_inquiry')
      if (raw) {
        const p = JSON.parse(raw)
        if (p?.cash_mode) return 'clinic'
        return 'support'
      }
      const v = localStorage.getItem(LS_KEY)
      return v === 'support' || v === 'clinic' || v === 'ai' ? v : 'support'
    } catch { return 'support' }
  })

  // Сохраняем выбор сегмента
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, segment) } catch {}
  }, [segment])

  // Очищаем pending после обработки (когда SupportSegment отрисовал сообщение)
  const consumeInquiry = useCallback(() => {
    try { sessionStorage.removeItem('pending_subscription_inquiry') } catch {}
    setPendingInquiry(null)
  }, [])

  const items = useMemo(() => ([
    { key: 'support', label: 'Поддержка', icon: 'support_agent' },
    { key: 'clinic',  label: 'Клиника',   icon: 'local_hospital' },
    { key: 'ai',      label: 'AI',        icon: 'auto_awesome' },
  ]), [])

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 200px)' }}>
      {/* Sticky segment-control */}
      <div
        className="sticky z-20 px-3 py-2"
        style={{
          top: 0,
          background: 'var(--bg-1, #F0F4F8)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <SegmentControl items={items} value={segment} onChange={setSegment} />
      </div>

      {/* Активный сегмент */}
      <div className="flex-1 px-1 pt-3">
        {segment === 'support' && (
          <SupportSegment
            sessionToken={sessionToken}
            onSwitchToClinic={() => setSegment('clinic')}
            pendingInquiry={pendingInquiry}
            onInquiryConsumed={consumeInquiry}
            onGoSubscription={onGoSubscription}
          />
        )}
        {segment === 'clinic' && (
          <Suspense fallback={<div className="text-center py-12 text-gray-400 text-sm">Загрузка…</div>}>
            <ClinicSegmentWrap onGoSubscription={onGoSubscription} onSwitchToSupport={() => setSegment('support')} />
          </Suspense>
        )}
        {segment === 'ai' && (
          <AiSegment apiBase={API_BASE} patientPhone={patientPhone} tenantSlug={tenantSlug} />
        )}
      </div>
    </div>
  )
}

// ── Сегмент: Поддержка ────────────────────────────────────────────────────────
function SupportSegment({ sessionToken, onSwitchToClinic, pendingInquiry, onInquiryConsumed, onGoSubscription }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [backendAvailable, setBackendAvailable] = useState(null) // null=unknown, true/false
  const [contextHint, setContextHint] = useState(null) // null | 'switch-to-doctor'
  const [inquiryBanner, setInquiryBanner] = useState(null) // { planKey, planTitle, category }
  const scrollRef = useRef(null)

  // Обработка deeplink из подписки: загружаем full_details_chat_message и
  // вставляем как сообщение поддержки + ставим баннер сверху.
  useEffect(() => {
    if (!pendingInquiry) return
    const { plan_key, category } = pendingInquiry
    if (!plan_key) { onInquiryConsumed?.(); return }
    let alive = true
    const PLAN_TITLES = { health_plus: 'Здоровье+', family_plus: 'Семья+', pro: 'Pro' }
    const planTitle = PLAN_TITLES[plan_key] || plan_key
    setInquiryBanner({ planKey: plan_key, planTitle, category })

    axios.get(`${API_BASE}/patient/subscription/plans/${plan_key}/benefits-detail`)
      .then(r => {
        if (!alive) return
        const text = r.data?.full_details_chat_message
          || r.data?.message
          || `Полная информация о тарифе «${planTitle}» — см. ниже:\n\n` +
             (Array.isArray(r.data?.categories_breakdown)
               ? r.data.categories_breakdown.map(c =>
                   `• ${c.category}: ${c.available_count || ''}${c.discount ? ` со скидкой ${c.discount}%` : ''}`
                 ).join('\n')
               : '')
        setMessages(prev => [
          ...prev,
          {
            id: 'inq_' + Date.now(),
            role: 'support',
            text,
            created_at: new Date().toISOString(),
            kind: 'subscription_inquiry',
            meta: { plan_key, category },
          },
        ])
      })
      .catch(() => {
        if (!alive) return
        // Fallback message if API unavailable
        setMessages(prev => [
          ...prev,
          {
            id: 'inq_' + Date.now(),
            role: 'support',
            text: `Здравствуйте! Вы запросили подробности по тарифу «${planTitle}». ` +
                  `Менеджер пришлёт детальный разбор в течение дня. ` +
                  `Если хотите подключить тариф прямо сейчас — нажмите кнопку «Подключить» выше.`,
            created_at: new Date().toISOString(),
            kind: 'subscription_inquiry',
            meta: { plan_key, category },
          },
        ])
      })
      .finally(() => {
        if (alive) onInquiryConsumed?.()
      })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInquiry])

  useEffect(() => {
    if (!sessionToken) { setBackendAvailable(false); return }
    let alive = true
    axios.get(`${API_BASE}/patient/support/messages`, { params: { t: sessionToken } })
      .then(r => {
        if (!alive) return
        const msgs = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.messages) ? r.data.messages : [])
        setMessages(msgs)
        setBackendAvailable(true)
      })
      .catch(() => {
        if (alive) setBackendAvailable(false)
      })
    return () => { alive = false }
  }, [sessionToken])

  useEffect(() => {
    // Контекстная подсказка по ключевым словам
    const lower = input.toLowerCase()
    if (lower.length >= 4 && SUPPORT_KEYWORDS_FOR_DOCTOR.some(k => lower.includes(k))) {
      setContextHint('switch-to-doctor')
    } else {
      setContextHint(null)
    }
  }, [input])

  useEffect(() => {
    // Авто-скролл
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length])

  const send = async (text) => {
    const msg = (text ?? input).trim()
    if (!msg || sending) return
    setSending(true)
    // Локально показываем сразу (оптимистично)
    const tmp = { id: 'tmp_' + Date.now(), role: 'user', text: msg, created_at: new Date().toISOString() }
    setMessages(prev => [...prev, tmp])
    setInput('')
    try {
      if (backendAvailable) {
        const r = await axios.post(
          `${API_BASE}/patient/support/messages`,
          { text: msg },
          { params: { t: sessionToken } }
        )
        // Сервер может вернуть auto-reply
        if (r.data?.reply) {
          setMessages(prev => [...prev, { id: 'srv_' + Date.now(), role: 'support', text: r.data.reply, created_at: new Date().toISOString() }])
        }
      } else {
        // Mock-ответ
        setTimeout(() => {
          setMessages(prev => [...prev, {
            id: 'mock_' + Date.now(),
            role: 'support',
            text: 'Спасибо за обращение! Бекенд поддержки ещё не подключён. Напишите нам на support@клиниксеть.рф — мы ответим в течение суток.',
            created_at: new Date().toISOString(),
          }])
        }, 700)
      }
    } catch (e) {
      setMessages(prev => [...prev, {
        id: 'err_' + Date.now(),
        role: 'support',
        text: 'Не удалось отправить сообщение. Попробуйте позже или напишите на support@клиниксеть.рф',
        created_at: new Date().toISOString(),
      }])
    } finally {
      setSending(false)
    }
  }

  // Заглушка если backend недоступен и сообщений нет
  const showEmptyMock = backendAvailable === false && messages.length === 0

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 260px)' }}>
      {/* Шапка-описание */}
      <div className="rounded-2xl p-3 mb-3 flex items-center gap-3" style={{ background: 'linear-gradient(135deg,#0A2342,#1565C0)' }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,.15)' }}>
          <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>support_agent</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm">Поддержка КлиникСеть</p>
          <p className="text-blue-200 text-[11px] mt-0.5">Вопросы по приложению, оплате, регистрации</p>
        </div>
      </div>

      {/* Inquiry banner: «Информация о тарифе» */}
      {inquiryBanner && (
        <div
          className="rounded-2xl p-3.5 mb-3 flex items-center gap-3 relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg,#F59E0B 0%,#A855F7 60%,#6366F1 100%)',
            boxShadow: '0 8px 24px rgba(124,58,237,.25)',
          }}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,.22)' }}>
            <span className="material-symbols-outlined text-white text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-extrabold text-[13px] leading-tight">Информация о тарифе «{inquiryBanner.planTitle}»</p>
            <p className="text-white/85 text-[11px] mt-0.5 leading-snug">Полный разбор привилегий ниже в чате</p>
          </div>
          {onGoSubscription && (
            <button
              type="button"
              onClick={onGoSubscription}
              className="flex-shrink-0 px-3 py-1.5 rounded-xl text-[12px] font-extrabold transition-all active:scale-95"
              style={{ background: '#fff', color: '#7C3AED', boxShadow: '0 4px 10px rgba(0,0,0,.15)' }}
            >
              Подключить
              <span className="material-symbols-outlined text-[13px] align-middle ml-0.5">arrow_forward</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setInquiryBanner(null)}
            className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,.18)' }}
            aria-label="Скрыть"
          >
            <span className="material-symbols-outlined text-white text-[16px]">close</span>
          </button>
        </div>
      )}

      {showEmptyMock ? (
        <div className="rounded-2xl p-5 text-center" style={{ background: '#fff', border: '1px solid rgba(0,0,0,.06)' }}>
          <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: '#FEF3C7' }}>
            <span className="material-symbols-outlined text-2xl" style={{ color: '#92400E', fontVariationSettings: "'FILL' 1" }}>hourglass_empty</span>
          </div>
          <p className="font-bold text-gray-800 text-sm mb-1">Чат поддержки скоро откроется</p>
          <p className="text-[12px] text-gray-500 leading-relaxed mb-3">
            Пока напишите нам на почту, мы ответим в течение суток
          </p>
          <a
            href="mailto:support@клиниксеть.рф"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold"
            style={{ background: '#E0F7FA', color: '#00838F' }}
          >
            <span className="material-symbols-outlined text-base">mail</span>
            support@клиниксеть.рф
          </a>
        </div>
      ) : (
        <>
          {/* Лента сообщений */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto pr-1 pb-3 space-y-2"
            style={{ WebkitOverflowScrolling: 'touch', minHeight: 200 }}
          >
            {messages.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-[13px] text-gray-500">Задайте вопрос — наша команда поможет.</p>
              </div>
            ) : (
              messages.map(m => (
                <SupportBubble key={m.id} message={m} />
              ))
            )}
          </div>

          {/* Быстрые ответы (только если сообщений мало) */}
          {messages.length < 3 && (
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
              {SUPPORT_QUICK.map(q => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  disabled={sending}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold"
                  style={{ background: '#fff', border: '1px solid rgba(0,0,0,.08)', color: '#0A2342' }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Контекстная подсказка */}
          {contextHint === 'switch-to-doctor' && (
            <div
              className="rounded-xl p-3 mb-2 flex items-start gap-2"
              style={{ background: '#FEF3C7', border: '1px solid #FCD34D' }}
            >
              <span className="material-symbols-outlined text-base flex-shrink-0" style={{ color: '#92400E', fontVariationSettings: "'FILL' 1" }}>info</span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-amber-900 leading-snug">Похоже, вопрос медицинский. Лучше написать врачу клиники.</p>
                <button
                  onClick={onSwitchToClinic}
                  className="mt-1 text-[12px] font-bold underline"
                  style={{ color: '#92400E' }}
                >
                  Переключить в «Клиника» →
                </button>
              </div>
            </div>
          )}

          {/* Поле ввода — sticky bottom */}
          <div className="flex items-center gap-2 pt-2" style={{ position: 'sticky', bottom: 0 }}>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Опишите проблему…"
              className="flex-1 h-11 px-4 rounded-2xl text-[14px] focus:outline-none focus:ring-2"
              style={{ background: '#fff', border: '1.5px solid rgba(0,0,0,.08)', minHeight: 44 }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || sending}
              className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all active:scale-95"
              style={{
                background: input.trim() && !sending ? 'linear-gradient(135deg,#0097A7,#1565C0)' : '#E5E7EB',
                minWidth: 44, minHeight: 44,
              }}
            >
              <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function SupportBubble({ message }) {
  const me = message.role === 'user'
  return (
    <div className={`flex ${me ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[80%] rounded-2xl px-3.5 py-2"
        style={{
          background: me ? 'linear-gradient(135deg,#0097A7,#1565C0)' : '#fff',
          color: me ? '#fff' : '#0A2342',
          border: me ? 'none' : '1px solid rgba(0,0,0,.06)',
          boxShadow: me ? '0 2px 8px rgba(21,101,192,.20)' : '0 1px 4px rgba(0,0,0,.04)',
        }}
      >
        <p className="text-[13.5px] leading-snug whitespace-pre-wrap">{message.text}</p>
      </div>
    </div>
  )
}

// ── Сегмент: Клиника (обёртка над PatientChatSection с контекстной подсказкой) ──
function ClinicSegmentWrap({ onGoSubscription, onSwitchToSupport }) {
  const [contextHint, setContextHint] = useState(null)

  // Слушаем input-события в PatientChatSection через MutationObserver — но
  // проще: добавим listener на document keydown по тексту в полях ввода
  // внутри собственного контейнера.
  const containerRef = useRef(null)
  useEffect(() => {
    if (!containerRef.current) return
    const handler = (e) => {
      const target = e.target
      if (!target || (target.tagName !== 'TEXTAREA' && target.tagName !== 'INPUT')) return
      if (!containerRef.current.contains(target)) return
      const v = String(target.value || '').toLowerCase()
      if (v.length >= 4 && CLINIC_KEYWORDS_FOR_SUPPORT.some(k => v.includes(k))) {
        setContextHint('switch-to-support')
      } else {
        setContextHint(null)
      }
    }
    document.addEventListener('input', handler)
    return () => document.removeEventListener('input', handler)
  }, [])

  return (
    <div ref={containerRef}>
      {contextHint === 'switch-to-support' && (
        <div
          className="rounded-xl p-3 mb-2 flex items-start gap-2"
          style={{ background: '#E0F2FE', border: '1px solid #7DD3FC' }}
        >
          <span className="material-symbols-outlined text-base flex-shrink-0" style={{ color: '#075985', fontVariationSettings: "'FILL' 1" }}>info</span>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] leading-snug" style={{ color: '#075985' }}>
              Это вопрос поддержки приложения. Лучше написать в саппорт.
            </p>
            <button
              onClick={onSwitchToSupport}
              className="mt-1 text-[12px] font-bold underline"
              style={{ color: '#075985' }}
            >
              Переключить в «Поддержка» →
            </button>
          </div>
        </div>
      )}
      <PatientChatSection
        sessionToken={(typeof window !== 'undefined') ? localStorage.getItem('clinika_patient_session') : null}
        onGoSubscription={onGoSubscription}
      />
    </div>
  )
}

// ── Сегмент: AI-ассистент ────────────────────────────────────────────────────
function AiSegment({ apiBase, patientPhone, tenantSlug }) {
  const [state, setState] = useState('idle') // 'idle'|'loading'|'ready'|'unavailable'|'error'
  const [convId, setConvId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef(null)

  const ensure = async () => {
    if (convId) return convId
    if (!patientPhone || !tenantSlug) return null
    setState('loading')
    try {
      const r = await axios.post(`${apiBase}/patient-portal/ai/conversations`, {
        patient_phone: patientPhone,
        tenant_slug: tenantSlug,
      })
      const id = r.data?.id
      setConvId(id)
      try {
        const h = await axios.get(`${apiBase}/patient-portal/ai/conversations/${id}/messages`)
        const msgs = Array.isArray(h.data?.messages) ? h.data.messages : []
        setMessages(msgs.filter(m => m.role !== 'system'))
      } catch {}
      setState('ready')
      return id
    } catch (e) {
      setState(e?.response?.status === 402 ? 'unavailable' : 'error')
      return null
    }
  }

  useEffect(() => { ensure() /* eslint-disable-next-line */ }, [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length])

  const send = async () => {
    const txt = input.trim()
    if (!txt || sending) return
    const id = await ensure()
    if (!id) return
    setSending(true)
    setMessages(prev => [...prev, { id: 'u_' + Date.now(), role: 'user', text: txt }])
    setInput('')
    try {
      const r = await axios.post(`${apiBase}/patient-portal/ai/conversations/${id}/messages`, { text: txt })
      const reply = r.data?.reply || r.data?.text || 'Не удалось получить ответ'
      setMessages(prev => [...prev, { id: 'a_' + Date.now(), role: 'assistant', text: reply }])
    } catch (e) {
      setMessages(prev => [...prev, { id: 'er_' + Date.now(), role: 'assistant', text: 'Ошибка AI-ассистента: ' + (e?.response?.data?.detail || 'попробуйте позже') }])
    } finally {
      setSending(false)
    }
  }

  if (state === 'unavailable') {
    return (
      <div className="rounded-2xl p-5 text-center" style={{ background: '#fff', border: '1px solid rgba(0,0,0,.06)' }}>
        <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#E0E7FF,#F3E8FF)' }}>
          <span className="material-symbols-outlined text-2xl" style={{ color: '#7C3AED', fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
        </div>
        <p className="font-bold text-gray-800 text-sm mb-1">AI-ассистент недоступен</p>
        <p className="text-[12px] text-gray-500 leading-relaxed">
          Подключите модуль «AI-ассистент» в магазине модулей клиники
        </p>
      </div>
    )
  }

  if (state === 'loading' || state === 'idle') {
    return <div className="text-center py-12 text-gray-400 text-sm">Подключаем AI…</div>
  }

  if (state === 'error') {
    return (
      <div className="rounded-2xl p-5 text-center" style={{ background: '#FEE2E2', border: '1px solid #FCA5A5' }}>
        <p className="font-bold text-red-800 text-sm mb-1">Не удалось подключиться к AI</p>
        <button onClick={ensure} className="mt-2 text-[12px] font-bold underline text-red-700">Повторить</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 260px)' }}>
      <div className="rounded-2xl p-3 mb-3 flex items-center gap-3" style={{ background: 'linear-gradient(135deg,#7C3AED,#1565C0)' }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,.15)' }}>
          <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm">AI-ассистент</p>
          <p className="text-purple-200 text-[11px] mt-0.5">Ответы на медицинские вопросы 24/7</p>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto pr-1 pb-3 space-y-2"
        style={{ WebkitOverflowScrolling: 'touch', minHeight: 200 }}
      >
        {messages.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-[13px] text-gray-500">Спросите что-нибудь — например, «Что делать при температуре 38?»</p>
          </div>
        ) : (
          messages.map(m => <SupportBubble key={m.id} message={{ ...m, role: m.role === 'assistant' ? 'support' : m.role }} />)
        )}
      </div>

      <div className="flex items-center gap-2 pt-2" style={{ position: 'sticky', bottom: 0 }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Спросите AI…"
          className="flex-1 h-11 px-4 rounded-2xl text-[14px] focus:outline-none focus:ring-2"
          style={{ background: '#fff', border: '1.5px solid rgba(0,0,0,.08)', minHeight: 44 }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || sending}
          className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all active:scale-95"
          style={{
            background: input.trim() && !sending ? 'linear-gradient(135deg,#7C3AED,#1565C0)' : '#E5E7EB',
            minWidth: 44, minHeight: 44,
          }}
        >
          <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
        </button>
      </div>
    </div>
  )
}
