/**
 * ========================================
 * БЛОК: PatientSubscriptionSection — премиум-подписка пациента «Здоровье+» (v2)
 * ========================================
 * Глава 9 v2 — full premium redesign.
 *
 * Используется внутри PatientCabinet.jsx (tab=subscription, секция rewards).
 *
 * API:
 *   GET  /patient/subscription/plans                          — список тарифов (+ module_active)
 *   GET  /patient/subscription/my                             — текущая | 404
 *   GET  /patient/subscription/benefits                       — текущие привилегии
 *   GET  /patient/subscription/plans/{plan_key}/benefits-detail — детали по категориям
 *   POST /patient/subscription/start                          — {plan, billing, trial_days?}
 *   POST /patient/subscription/cancel                         — {reason, comment?}
 *   POST /patient/subscription/resume                         — (= включить авто-продление)
 *   POST /patient/subscription/inquire-details                — {plan_key, category} → {thread_id}
 *   NB: авто-продление управляется через resume/cancel (PATCH /my на бэке нет)
 *
 * Состояния:
 *   • module_active=false → плашка «Свяжитесь с менеджером клиники» (CTA → чат с клиникой)
 *   • Нет подписки → hero + 3 PlanCardV2 + toggle monthly/annual + PlanComparisonTable (desktop) + FAQ
 *   • Есть подписка → hero (золотисто-фиолетовый) + BenefitsList + auto-renew + cancel
 *
 * Deeplink в чат:
 *   • При клике «Подробнее» на конкретной категории → POST /inquire-details
 *     → sessionStorage.setItem('pending_subscription_inquiry', plan_key)
 *     → window.dispatchEvent('patient:navigate', {tab:'chats', segment:'support', threadId})
 * ========================================
 */
import { useEffect, useState, useCallback, lazy, Suspense, useMemo } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import { useToast } from '../design'

const PlanCardV2                = lazy(() => import('../components/subscription/PlanCardV2'))
const CancelModal               = lazy(() => import('../components/subscription/CancelModal'))
const BenefitsList              = lazy(() => import('../components/subscription/BenefitsList'))
const BenefitsCategoryAccordion = lazy(() => import('../components/subscription/BenefitsCategoryAccordion'))
const InquireBottomSheet        = lazy(() => import('../components/subscription/InquireBottomSheet'))
const PlanComparisonTable       = lazy(() => import('../components/subscription/PlanComparisonTable'))

const SESSION_KEY = 'clinika_patient_session'

// Палитра по тиру (для accent в accordion / bottom-sheet)
const TIER_ACCENT = {
  free:        '#64748B',
  health_plus: '#A855F7',
  family_plus: '#4F46E5',
  pro:         '#7C3AED',
}

// Локальный fallback тарифов с богатой структурой summary_benefits
const FALLBACK_PLANS = [
  {
    key: 'health_plus',
    plan_key: 'health_plus',
    name: 'Здоровье+',
    title: 'Здоровье+',
    description: 'Забота о здоровье круглый год',
    price_monthly: 290,
    trial_days: 7,
    summary_benefits: [
      { icon: 'chat_bubble',         label: 'Безлимит чата с врачом' },
      { icon: 'discount',            label: 'Скидка на приёмы',     value: '10%' },
      { icon: 'science',             label: 'Анализы со скидкой',   value: 'до 20 / мес · −20%', detail_key: 'lab' },
      { icon: 'stethoscope',         label: 'Консультации врачей',  value: '4 / мес',            detail_key: 'consult' },
      { icon: 'inventory_2',         label: 'Расходник ежемесячно' },
      { icon: 'bolt',                label: 'Приоритет записи' },
    ],
  },
  {
    key: 'family_plus',
    plan_key: 'family_plus',
    name: 'Семья+',
    title: 'Семья+',
    description: 'Для всей семьи под одним аккаунтом',
    price_monthly: 590,
    trial_days: 7,
    summary_benefits: [
      { icon: 'chat_bubble',         label: 'Безлимит чата для всех' },
      { icon: 'discount',            label: 'Скидка на приёмы',     value: '15%' },
      { icon: 'science',             label: 'Анализы со скидкой',   value: 'до 40 / мес · −25%', detail_key: 'lab' },
      { icon: 'diversity_3',         label: 'Семейный аккаунт',     value: 'до 5 чел' },
      { icon: 'stethoscope',         label: 'Консультации врачей',  value: '8 / мес',            detail_key: 'consult' },
      { icon: 'video_camera_front',  label: 'Безлимитная телемедицина' },
    ],
  },
  {
    key: 'pro',
    plan_key: 'pro',
    name: 'Pro',
    title: 'Pro',
    description: 'Максимум привилегий — для требовательных',
    price_monthly: 1290,
    trial_days: 7,
    summary_benefits: [
      { icon: 'chat_bubble',         label: 'Безлимит чата с врачом' },
      { icon: 'discount',            label: 'Скидка на приёмы',     value: '20%' },
      { icon: 'science',             label: 'Анализы со скидкой',   value: 'до 100 / мес · −30%', detail_key: 'lab' },
      { icon: 'stethoscope',         label: 'Безлимитные консультации',                          detail_key: 'consult' },
      { icon: 'monitor_heart',       label: 'Диагностика',          value: '−25%',                detail_key: 'diagnostic' },
      { icon: 'support_agent',       label: 'Персональный менеджер 24/7' },
    ],
  },
]

const FAQ = [
  {
    q: 'Как работает пробный период?',
    a: 'Подключаете тариф — первые 7 дней бесплатно. Можно отменить в любой момент до окончания пробного периода и оплата не спишется.',
  },
  {
    q: 'Можно ли отменить подписку?',
    a: 'Да, отмена работает в любое время в один клик. Подписка останется активной до конца оплаченного периода — деньги не сгорают.',
  },
  {
    q: 'Что входит в скидку на приёмы и анализы?',
    a: 'Скидка действует на все услуги клиники, кроме акционных и операций. Применяется автоматически при оплате через кабинет.',
  },
  {
    q: 'Что такое «расходник»?',
    a: 'Ежемесячный отчёт о ваших тратах на здоровье — приёмы, анализы, лекарства. Удобно для семейного бюджета и для возврата НДФЛ.',
  },
  {
    q: 'Подписка действует во всех клиниках сети?',
    a: 'Да, после подключения подписка работает во всех клиниках КлиникСеть, к которым вы подключены.',
  },
]

const STATUS_LABEL = {
  active:    { l: 'Активна',          c: '#10B981' },
  trial:     { l: 'Пробный период',   c: '#F59E0B' },
  cancelled: { l: 'Отменена',         c: '#EF4444' },
  expired:   { l: 'Истекла',          c: '#94A3B8' },
  past_due:  { l: 'Ошибка оплаты',    c: '#DC2626' },
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch { return iso }
}

function isMobileViewport() {
  if (typeof window === 'undefined') return false
  return window.matchMedia && window.matchMedia('(max-width: 767px)').matches
}

function PageStub({ icon = 'hourglass_empty', title, sub, cta }) {
  return (
    <div className="rounded-3xl p-6 text-center" style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
      <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center"
           style={{ background: 'rgba(146,64,14,.08)' }}>
        <span className="material-symbols-outlined text-3xl" style={{ color: '#92400E', fontVariationSettings: "'FILL' 1" }}>{icon}</span>
      </div>
      <p className="text-base font-extrabold" style={{ color: '#92400E' }}>{title}</p>
      {sub && <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: '#92400E' }}>{sub}</p>}
      {cta && (
        <div className="mt-4">
          <button
            onClick={cta.onClick}
            className="px-5 py-2.5 rounded-xl font-bold text-sm text-white transition-all active:scale-95"
            style={{ background: '#92400E', boxShadow: '0 6px 16px rgba(146,64,14,.3)' }}
          >
            {cta.icon && <span className="material-symbols-outlined text-base align-middle mr-1.5" style={{ fontVariationSettings: "'FILL' 1" }}>{cta.icon}</span>}
            {cta.label}
          </button>
        </div>
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-36 rounded-3xl bg-slate-200/60" />
      <div className="h-10 rounded-2xl bg-slate-200/60 w-64 mx-auto" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1,2,3].map(i => <div key={i} className="h-[460px] rounded-3xl bg-slate-200/60" />)}
      </div>
    </div>
  )
}

// Поиск accent-цвета по plan.key
function accentFor(planKey) { return TIER_ACCENT[planKey] || '#7C3AED' }

export default function PatientSubscriptionSection({ sessionToken: sessionTokenProp }) {
  const sessionToken = sessionTokenProp || (typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null)
  const { toast } = useToast()

  const [plans, setPlans]           = useState(null)
  const [moduleActive, setModuleActive] = useState(true)
  const [sub, setSub]               = useState(null)
  const [benefits, setBenefits]     = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [billing, setBilling]       = useState('monthly')
  const [busyPlan, setBusyPlan]     = useState(null)
  const [showCancel, setShowCancel] = useState(false)
  const [openFaq, setOpenFaq]       = useState(null)

  // Детали привилегий
  const [detailCache, setDetailCache] = useState({})       // { plan_key: data }
  const [detailOpen, setDetailOpen]   = useState(null)     // { planKey, categoryKey, mobile }
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError]     = useState(null)
  const [inquireBusy, setInquireBusy]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // /plans — публичный; может вернуть либо массив, либо {plans, module_active}
      const plansReq = axios.get(`${API_BASE}/patient/subscription/plans`)
        .then(r => {
          const d = r.data
          if (Array.isArray(d)) return { list: d, module_active: true }
          return {
            list: Array.isArray(d?.plans) ? d.plans : FALLBACK_PLANS,
            module_active: d?.module_active !== false,
          }
        })
        .catch(e => {
          if (e?.response?.status === 402) return { list: FALLBACK_PLANS, module_active: false }
          return { list: FALLBACK_PLANS, module_active: true }
        })

      const myReq = sessionToken
        ? axios.get(`${API_BASE}/patient/subscription/my`, { params: { t: sessionToken } })
            .then(r => r.data)
            .catch(e => {
              if (e?.response?.status === 404) return null
              throw e
            })
        : Promise.resolve(null)

      const [plansData, myData] = await Promise.all([plansReq, myReq])
      setPlans(plansData.list?.length ? plansData.list : FALLBACK_PLANS)
      setModuleActive(plansData.module_active !== false)
      setSub(myData)

      if (myData && sessionToken) {
        try {
          const b = await axios.get(`${API_BASE}/patient/subscription/benefits`, { params: { t: sessionToken } })
          setBenefits(b.data?.benefits || b.data || {})
        } catch { setBenefits({}) }
      } else {
        setBenefits(null)
      }
    } catch (e) {
      const status = e?.response?.status
      if (status === 402) {
        // module off — показываем плашку с CTA
        setModuleActive(false)
        setPlans(FALLBACK_PLANS)
      } else {
        setError('load_failed')
      }
    } finally {
      setLoading(false)
    }
  }, [sessionToken])

  useEffect(() => { load() }, [load])

  // ── Plan start ────────────────────────────────────────────────────────────
  const startPlan = async (planKey) => {
    if (!sessionToken) {
      toast('Войдите в кабинет, чтобы оформить подписку', 'error', 3000)
      return
    }
    if (!moduleActive) {
      openCashInquiry(planKey)
      return
    }
    setBusyPlan(planKey)
    try {
      const r = await axios.post(
        `${API_BASE}/patient/subscription/start`,
        { plan: planKey, billing },
        { params: { t: sessionToken } }
      )
      const url = r?.data?.redirect_url
      if (url) {
        window.location.href = url
      } else {
        toast('Подписка оформлена', 'success', 3000)
        load()
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Не удалось оформить подписку'
      toast(msg, 'error', 4000)
    } finally {
      setBusyPlan(null)
    }
  }

  // ── Cancel / Resume / Auto-renew ──────────────────────────────────────────
  const cancelSub = async ({ reason, comment }) => {
    const r = await axios.post(
      `${API_BASE}/patient/subscription/cancel`,
      { reason, comment },
      { params: { t: sessionToken } }
    )
    setSub(s => ({ ...(s || {}), ...(r.data || {}), status: 'cancelled' }))
    toast('Подписка отменена. Останется активной до конца оплаченного периода', 'info', 5000)
    load()
  }

  const resumeSub = async () => {
    try {
      await axios.post(`${API_BASE}/patient/subscription/resume`, {}, { params: { t: sessionToken } })
      toast('Подписка возобновлена', 'success', 3000)
      load()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось возобновить подписку', 'error', 4000)
    }
  }

  const toggleAutoRenew = async () => {
    const newVal = !sub?.auto_renew
    setSub(s => s ? { ...s, auto_renew: newVal } : s)
    try {
      // На бэке нет PATCH /my: авто-продление управляется через resume/cancel.
      // Включить авто-продление = возобновить, выключить = отменить (подписка
      // остаётся активной до конца оплаченного периода).
      if (newVal) {
        await axios.post(`${API_BASE}/patient/subscription/resume`, {}, { params: { t: sessionToken } })
      } else {
        await axios.post(
          `${API_BASE}/patient/subscription/cancel`,
          { reason: 'auto_renew_off' },
          { params: { t: sessionToken } }
        )
      }
      toast(newVal ? 'Авто-продление включено' : 'Авто-продление отключено', 'info', 2500)
      load()
    } catch (e) {
      setSub(s => s ? { ...s, auto_renew: !newVal } : s)
      toast('Не удалось сменить настройку', 'error', 3000)
    }
  }

  // ── «Подробнее» → загрузка benefits-detail ────────────────────────────────
  const openBenefitDetail = useCallback(async (planKey, categoryKey) => {
    const mobile = isMobileViewport()
    setDetailOpen({ planKey, categoryKey, mobile })
    setDetailError(null)
    if (detailCache[planKey]) return
    setDetailLoading(true)
    try {
      const r = await axios.get(`${API_BASE}/patient/subscription/plans/${planKey}/benefits-detail`)
      setDetailCache(prev => ({ ...prev, [planKey]: r.data }))
    } catch (e) {
      setDetailError(e?.response?.data?.detail || 'Сервер недоступен')
    } finally {
      setDetailLoading(false)
    }
  }, [detailCache])

  // ── «Открыть в чате» — POST /inquire-details + deeplink ───────────────────
  const openInquiryInChat = useCallback(async (planKey, category = null) => {
    if (inquireBusy) return
    setInquireBusy(true)
    let threadId = null
    try {
      if (sessionToken) {
        const r = await axios.post(
          `${API_BASE}/patient/subscription/inquire-details`,
          { plan_key: planKey, category },
          { params: { t: sessionToken } }
        )
        threadId = r?.data?.thread_id || null
      }
    } catch (e) {
      // даже если сервер ответил 404/501 — всё равно делаем deeplink
      // PatientChatHub покажет mock/empty fallback
    } finally {
      setInquireBusy(false)
    }
    // Сохраняем pending в sessionStorage (PatientChatHub подхватит)
    try {
      sessionStorage.setItem('pending_subscription_inquiry', JSON.stringify({
        plan_key: planKey,
        category,
        thread_id: threadId,
        ts: Date.now(),
      }))
    } catch {}
    // Закрываем bottom-sheet / accordion перед навигацией
    setDetailOpen(null)
    // Уведомляем родителя
    try {
      window.dispatchEvent(new CustomEvent('patient:navigate', {
        detail: { tab: 'chats-hub', segment: 'support', threadId, planKey, category },
      }))
    } catch {}
  }, [sessionToken, inquireBusy])

  // ── «Связаться с клиникой» (наличный сценарий / module off) ───────────────
  const openCashInquiry = useCallback((planKey) => {
    try {
      sessionStorage.setItem('pending_subscription_inquiry', JSON.stringify({
        plan_key: planKey || 'health_plus',
        category: null,
        cash_mode: true,
        ts: Date.now(),
      }))
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent('patient:navigate', {
        detail: { tab: 'chats-hub', segment: 'clinic', planKey, cashMode: true },
      }))
    } catch {}
  }, [])

  // Закрытие detail при resize (mobile ↔ desktop)
  useEffect(() => {
    const onResize = () => {
      if (!detailOpen) return
      const m = isMobileViewport()
      if (m !== detailOpen.mobile) setDetailOpen(d => d ? { ...d, mobile: m } : d)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [detailOpen])

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return <Skeleton />

  if (error === 'load_failed') {
    return <PageStub icon="error" title="Не удалось загрузить данные подписки" sub="Попробуйте обновить страницу" />
  }

  // ──────────────────────────────────────────────────────────────────────────
  // АКТИВНАЯ ПОДПИСКА
  // ──────────────────────────────────────────────────────────────────────────
  if (sub && sub.status !== 'expired') {
    const stMeta = STATUS_LABEL[sub.status] || STATUS_LABEL.active
    const isCancelled = sub.status === 'cancelled'
    const planName = sub.plan_name || (plans?.find(p => (p.key||p.plan_key) === sub.plan)?.title || plans?.find(p => (p.key||p.plan_key) === sub.plan)?.name) || sub.plan

    // ═════ Расчёт прогресса дней подписки ═════
    let daysLeft = null
    let daysTotal = null
    let progressPct = null
    if (sub.expires_at) {
      try {
        const exp = new Date(sub.expires_at).getTime()
        const start = sub.started_at ? new Date(sub.started_at).getTime() : (exp - 30 * 86400000)
        const now = Date.now()
        daysLeft = Math.max(0, Math.ceil((exp - now) / 86400000))
        daysTotal = Math.max(1, Math.ceil((exp - start) / 86400000))
        progressPct = Math.min(100, Math.max(0, ((now - start) / (exp - start)) * 100))
      } catch { /* noop */ }
    }

    return (
      <>
        {/* ═════ БЛОК: PatientSubscriptionSection — inline keyframes ═════ */}
        <style>{`
          @keyframes psub-pop { from { opacity: 0; transform: translateY(8px) scale(.985) } to { opacity: 1; transform: translateY(0) scale(1) } }
          @keyframes psub-shine { 0% { transform: translateX(-100%) } 100% { transform: translateX(100%) } }
          @keyframes psub-progress { from { width: 0 } }
          .psub-pop { animation: psub-pop .42s cubic-bezier(.22,1,.36,1) both }
          .psub-hero-shine::after {
            content: '';
            position: absolute; inset: 0;
            background: linear-gradient(120deg, transparent 30%, rgba(255,255,255,.18) 50%, transparent 70%);
            animation: psub-shine 6s ease-in-out infinite;
            pointer-events: none;
          }
        `}</style>
        <div className="flex flex-col gap-5">
          {/* ═════ БЛОК: Hero активной подписки — premium gradient ═════ */}
          <div
            className="psub-pop psub-hero-shine relative overflow-hidden rounded-3xl p-6 text-white"
            style={{
              background: 'linear-gradient(135deg, #F59E0B 0%, #EC4899 35%, #A855F7 70%, #6366F1 100%)',
              boxShadow: '0 16px 48px rgba(124,58,237,.32), inset 0 1px 0 rgba(255,255,255,.25)',
            }}
          >
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full" style={{ background: 'rgba(255,255,255,.18)', filter: 'blur(40px)' }} />
            <div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full" style={{ background: 'rgba(255,255,255,.12)', filter: 'blur(36px)' }} />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(255,255,255,.22)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,.3)' }}
                >
                  <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
                </div>
                <span
                  className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1"
                  style={{ background: 'rgba(255,255,255,.25)', backdropFilter: 'blur(8px)' }}
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#fff', boxShadow: '0 0 6px #fff' }} />
                  {stMeta.l}
                </span>
              </div>
              <h2 className="text-2xl font-extrabold mb-1.5">«{planName}»</h2>
              <p className="text-sm opacity-95">
                {isCancelled
                  ? `Активна до ${fmtDate(sub.expires_at)}, затем будет отключена`
                  : `Активна до ${fmtDate(sub.expires_at)}`}
              </p>
              {sub.price_monthly != null && (
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-black">{Number(sub.price_monthly).toLocaleString('ru-RU')} ₽</span>
                  <span className="text-sm opacity-80">/ мес</span>
                </div>
              )}

              {/* ═════ Прогресс-бар оставшихся дней ═════ */}
              {progressPct != null && daysLeft != null && (
                <div className="mt-5">
                  <div className="flex items-center justify-between mb-1.5 text-[11px] font-bold opacity-95">
                    <span>{daysLeft > 0 ? `Осталось ${daysLeft} дн.` : 'Истекает сегодня'}</span>
                    <span className="opacity-80">{Math.round(progressPct)}%</span>
                  </div>
                  <div
                    className="relative h-2 rounded-full overflow-hidden"
                    style={{ background: 'rgba(255,255,255,.22)', backdropFilter: 'blur(4px)' }}
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${progressPct}%`,
                        background: 'linear-gradient(90deg, rgba(255,255,255,.95), rgba(255,255,255,.7))',
                        boxShadow: '0 0 8px rgba(255,255,255,.5)',
                        animation: 'psub-progress 1.2s cubic-bezier(.22,1,.36,1)',
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 mt-5">
                {isCancelled ? (
                  <button
                    onClick={resumeSub}
                    className="px-5 py-2.5 rounded-xl font-bold text-sm bg-white transition-transform active:scale-95 inline-flex items-center gap-1.5"
                    style={{ color: '#7C3AED', boxShadow: '0 4px 14px rgba(255,255,255,.3)' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>refresh</span>
                    Возобновить подписку
                  </button>
                ) : (
                  <button
                    onClick={() => setShowCancel(true)}
                    className="px-4 py-2 rounded-xl font-bold text-sm transition-transform active:scale-95"
                    style={{ background: 'rgba(255,255,255,.2)', color: '#fff', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,.25)' }}
                  >
                    Отменить подписку
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ═════ Auto-renew toggle — premium glass card ═════ */}
          {!isCancelled && (
            <div
              className="psub-pop rounded-2xl p-4 flex items-center justify-between bg-white"
              style={{
                border: '1px solid rgba(0,0,0,.06)',
                boxShadow: '0 4px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.5)',
                animationDelay: '.08s',
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: sub.auto_renew
                      ? 'linear-gradient(135deg,#34D399,#10B981)'
                      : 'linear-gradient(135deg,#CBD5E1,#94A3B8)',
                    boxShadow: sub.auto_renew
                      ? '0 4px 12px rgba(16,185,129,.28)'
                      : '0 2px 8px rgba(148,163,184,.2)',
                  }}
                >
                  <span className="material-symbols-outlined text-white" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
                    {sub.auto_renew ? 'autorenew' : 'pause_circle'}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold" style={{ color: '#0F172A' }}>Авто-продление</p>
                  <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>
                    {sub.auto_renew
                      ? `Следующее списание: ${fmtDate(sub.next_charge_at || sub.expires_at)}`
                      : 'Подписка завершится в конце периода'}
                  </p>
                </div>
              </div>
              <button
                onClick={toggleAutoRenew}
                className="relative w-12 h-7 rounded-full transition-all flex-shrink-0"
                style={{
                  background: sub.auto_renew
                    ? 'linear-gradient(135deg,#34D399,#10B981)'
                    : '#CBD5E1',
                  boxShadow: sub.auto_renew
                    ? '0 2px 6px rgba(16,185,129,.3), inset 0 1px 0 rgba(255,255,255,.15)'
                    : 'inset 0 2px 4px rgba(0,0,0,.08)',
                }}
                aria-pressed={sub.auto_renew}
              >
                <span
                  className="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all"
                  style={{ left: sub.auto_renew ? '22px' : '2px', boxShadow: '0 2px 4px rgba(0,0,0,.15)' }}
                />
              </button>
            </div>
          )}

          {/* ═════ Привилегии ═════ */}
          <div className="psub-pop" style={{ animationDelay: '.12s' }}>
            <h3 className="text-base font-extrabold mb-3 inline-flex items-center gap-1.5" style={{ color: '#0F172A' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#A855F7', fontVariationSettings: "'FILL' 1" }}>verified</span>
              Ваши привилегии
            </h3>
            <Suspense fallback={<div className="h-32 rounded-2xl bg-slate-100 animate-pulse" />}>
              <BenefitsList benefits={benefits || {}} />
            </Suspense>
          </div>

          {/* CancelModal */}
          <Suspense fallback={null}>
            {showCancel && (
              <CancelModal
                open={showCancel}
                planName={planName}
                expiresAt={sub.expires_at}
                onClose={() => setShowCancel(false)}
                onSubmit={cancelSub}
              />
            )}
          </Suspense>
        </div>
      </>
    )
  }

  // ──────────────────────────────────────────────────────────────────────────
  // НЕТ ПОДПИСКИ
  // ──────────────────────────────────────────────────────────────────────────
  const visiblePlans = (plans || FALLBACK_PLANS)
  const featuredKey = 'health_plus'

  // module gating — показываем плашку, но карточки остаются (без CTA «Подключить»)
  return (
    <div className="flex flex-col gap-6">
      {/* Hero премиум */}
      <div
        className="relative overflow-hidden rounded-3xl p-6 sm:p-7 text-white"
        style={{
          background: 'linear-gradient(135deg, #F59E0B 0%, #A855F7 55%, #4F46E5 100%)',
          boxShadow: '0 18px 56px rgba(124,58,237,.28)',
        }}
      >
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full" style={{ background: 'rgba(255,255,255,.18)', filter: 'blur(50px)' }} />
        <div className="absolute -bottom-10 -left-10 w-36 h-36 rounded-full" style={{ background: 'rgba(255,255,255,.1)', filter: 'blur(36px)' }} />
        <div className="absolute top-4 right-5 hidden sm:block">
          <span className="material-symbols-outlined text-[64px] opacity-25" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
        </div>

        <div className="relative max-w-xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider mb-3"
               style={{ background: 'rgba(255,255,255,.22)', backdropFilter: 'blur(8px)' }}>
            <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
            ПОДПИСКА ЗДОРОВЬЕ+
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight mb-2">
            Подключите «Здоровье+»
          </h1>
          <p className="text-[14px] sm:text-base opacity-90 leading-relaxed">
            Забота о здоровье круглый год — безлимит чата с врачом, скидки, приоритет записи и ежемесячный расходник.
          </p>
        </div>
      </div>

      {/* Module off banner */}
      {!moduleActive && (
        <PageStub
          icon="lock"
          title="Online-подписка временно недоступна"
          sub="Свяжитесь с менеджером клиники — подключим тариф за наличный расчёт"
          cta={{
            icon: 'forum',
            label: 'Связаться с клиникой',
            onClick: () => openCashInquiry(featuredKey),
          }}
        />
      )}

      {/* Toggle monthly/annual + label */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Выберите тариф</p>
          <p className="text-lg font-extrabold" style={{ color: '#0F172A' }}>
            {visiblePlans.length} {visiblePlans.length === 1 ? 'тариф' : visiblePlans.length < 5 ? 'тарифа' : 'тарифов'} на выбор
          </p>
        </div>
        <div className="inline-flex p-1 rounded-2xl" style={{ background: '#F1F5F9' }}>
          {[
            { k: 'monthly', l: 'Ежемесячно' },
            { k: 'annual',  l: 'Год · −17%' },
          ].map(opt => (
            <button
              key={opt.k}
              onClick={() => setBilling(opt.k)}
              className="px-4 py-2 rounded-xl text-sm font-bold transition-all"
              style={{
                background: billing === opt.k ? '#FFFFFF' : 'transparent',
                color: billing === opt.k ? '#0F172A' : '#64748B',
                boxShadow: billing === opt.k ? '0 2px 8px rgba(0,0,0,.06)' : 'none',
              }}
            >
              {opt.l}
            </button>
          ))}
        </div>
      </div>

      {/* Plans — grid (desktop) / horizontal swipe (mobile) */}
      <Suspense fallback={<Skeleton />}>
        {/* Desktop: 3 в ряд */}
        <div className="hidden md:grid md:grid-cols-3 gap-5 pt-3">
          {visiblePlans.map(plan => {
            const key = plan.key || plan.plan_key
            return (
              <PlanCardV2
                key={key}
                plan={plan}
                billing={billing}
                featured={key === featuredKey}
                loading={busyPlan === key}
                moduleActive={moduleActive}
                onSelect={() => startPlan(key)}
                onBenefitDetail={(catKey) => openBenefitDetail(key, catKey)}
                onInquireCash={() => openCashInquiry(key)}
              />
            )
          })}
        </div>

        {/* Mobile: горизонтальный swipe + snap */}
        <div className="md:hidden -mx-3 px-3 overflow-x-auto pb-2"
             style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
          <div className="flex gap-3 pt-3">
            {visiblePlans.map(plan => {
              const key = plan.key || plan.plan_key
              return (
                <div key={key} className="flex-shrink-0 w-[88%] max-w-[340px]" style={{ scrollSnapAlign: 'center' }}>
                  <PlanCardV2
                    plan={plan}
                    billing={billing}
                    featured={key === featuredKey}
                    loading={busyPlan === key}
                    moduleActive={moduleActive}
                    onSelect={() => startPlan(key)}
                    onBenefitDetail={(catKey) => openBenefitDetail(key, catKey)}
                    onInquireCash={() => openCashInquiry(key)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </Suspense>

      {/* Details inline (desktop only) — раскрывается под карточками */}
      {detailOpen && !detailOpen.mobile && (
        <Suspense fallback={null}>
          <BenefitsCategoryAccordion
            planKey={detailOpen.planKey}
            categoryKey={detailOpen.categoryKey}
            data={detailCache[detailOpen.planKey]}
            loading={detailLoading}
            error={detailError}
            accent={accentFor(detailOpen.planKey)}
            onInquireFull={openInquiryInChat}
            onClose={() => setDetailOpen(null)}
          />
        </Suspense>
      )}

      {/* Trust strip */}
      <div className="rounded-2xl bg-white px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-2 justify-center" style={{ border: '1px solid rgba(0,0,0,.06)' }}>
        {[
          { icon: 'shield',   t: 'Безопасные платежи' },
          { icon: 'sync',     t: 'Отмена в один клик' },
          { icon: 'verified', t: 'Без скрытых платежей' },
        ].map(b => (
          <div key={b.icon} className="flex items-center gap-2 text-xs font-semibold" style={{ color: '#475569' }}>
            <span className="material-symbols-outlined text-base" style={{ color: '#10B981', fontVariationSettings: "'FILL' 1" }}>{b.icon}</span>
            {b.t}
          </div>
        ))}
      </div>

      {/* Comparison Table — desktop only */}
      <div className="hidden md:block">
        <Suspense fallback={<div className="h-72 rounded-3xl bg-slate-100 animate-pulse" />}>
          <PlanComparisonTable
            plans={visiblePlans}
            recommend={featuredKey}
            billing={billing}
            onSelect={moduleActive ? startPlan : openCashInquiry}
          />
        </Suspense>
      </div>

      {/* FAQ */}
      <div>
        <h3 className="text-xl font-extrabold mb-3 mt-2" style={{ color: '#0F172A' }}>Часто спрашивают</h3>
        <div className="flex flex-col gap-2">
          {FAQ.map((f, i) => (
            <div
              key={i}
              className="rounded-2xl bg-white overflow-hidden transition-all"
              style={{ border: '1px solid rgba(0,0,0,.06)' }}
            >
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between px-5 py-4 text-left"
              >
                <span className="text-sm font-semibold pr-3" style={{ color: '#0F172A' }}>{f.q}</span>
                <span
                  className="material-symbols-outlined text-xl flex-shrink-0 transition-transform"
                  style={{ color: '#94A3B8', transform: openFaq === i ? 'rotate(180deg)' : 'rotate(0)' }}
                >
                  expand_more
                </span>
              </button>
              {openFaq === i && (
                <div className="px-5 pb-4 text-sm leading-relaxed" style={{ color: '#475569' }}>
                  {f.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile bottom-sheet for detail */}
      <Suspense fallback={null}>
        {detailOpen && detailOpen.mobile && (
          <InquireBottomSheet
            open={true}
            planKey={detailOpen.planKey}
            categoryKey={detailOpen.categoryKey}
            data={detailCache[detailOpen.planKey]}
            loading={detailLoading}
            error={detailError}
            accent={accentFor(detailOpen.planKey)}
            onInquireFull={openInquiryInChat}
            onClose={() => setDetailOpen(null)}
          />
        )}
      </Suspense>
    </div>
  )
}
