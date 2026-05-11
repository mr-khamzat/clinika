/**
 * ========================================
 * БЛОК: PatientSubscriptionSection — премиум-подписка пациента (Глава 9)
 * ========================================
 * Используется внутри PatientCabinet.jsx (вкладка «Подписка»).
 *
 * API:
 *   GET  /patient/subscription/plans         — список тарифов (public)
 *   GET  /patient/subscription/my            — текущая подписка | 404
 *   GET  /patient/subscription/benefits      — привилегии активной подписки
 *   POST /patient/subscription/start         — {plan, trial_days?} → {redirect_url}
 *   POST /patient/subscription/cancel        — {reason, comment?}
 *   POST /patient/subscription/resume        — возобновить
 *   PATCH /patient/subscription/my           — {auto_renew}
 *
 * Состояния:
 *   • Нет подписки → hero + 3 тарифа + toggle monthly/annual + FAQ
 *   • Есть подписка → hero (золотисто-фиолетовый градиент)
 *                     + привилегии + auto-renew toggle
 *                     + история платежей + кнопка отмены
 *   • Отменена (status=cancelled) → можно «возобновить»
 * ========================================
 */
import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import { useToast } from '../design'

const PlanCard     = lazy(() => import('../components/subscription/PlanCard'))
const CancelModal  = lazy(() => import('../components/subscription/CancelModal'))
const BenefitsList = lazy(() => import('../components/subscription/BenefitsList'))

const SESSION_KEY = 'clinika_patient_session'

// Локальный fallback тарифов — если backend ещё не вернул /plans
const FALLBACK_PLANS = [
  {
    key: 'free',
    name: 'Базовый',
    description: 'Стандартный доступ к кабинету',
    price_monthly: 0,
    benefits: [
      'Запись на приём',
      'Просмотр медкарты',
      'История визитов',
      'Чат — 10 сообщений в месяц',
    ],
  },
  {
    key: 'health_plus',
    name: 'Здоровье+',
    description: 'Забота о здоровье круглый год',
    price_monthly: 290,
    benefits: [
      'Безлимитный чат с клиникой',
      'Скидка 10% на приёмы',
      'Расходник каждый месяц',
      'Приоритет записи',
      'Напоминания о приёме лекарств',
    ],
  },
  {
    key: 'family_plus',
    name: 'Семья+',
    description: 'Для всей семьи под одним аккаунтом',
    price_monthly: 590,
    benefits: [
      'Всё из тарифа «Здоровье+»',
      'До 5 членов семьи',
      'Семейный календарь приёмов',
      'Скидка 15% на семейные приёмы',
      'Персональный менеджер',
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
    q: 'Что входит в скидку на приёмы?',
    a: 'Скидка действует на все услуги клиники, кроме акционных и операций. Применяется автоматически при оплате через кабинет.',
  },
  {
    q: 'Что такое «расходник»?',
    a: 'Ежемесячный отчёт о ваших тратах на здоровье — приёмы, анализы, лекарства. Удобно для понимания семейного бюджета и для возврата НДФЛ.',
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

function PageStub({ icon = 'hourglass_empty', title, sub }) {
  return (
    <div className="rounded-2xl p-6 text-center" style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
      <span className="material-symbols-outlined text-3xl mb-2 block" style={{ color: '#92400E' }}>{icon}</span>
      <p className="text-sm font-semibold" style={{ color: '#92400E' }}>{title}</p>
      {sub && <p className="text-xs mt-1" style={{ color: '#92400E' }}>{sub}</p>}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-32 rounded-3xl bg-slate-200/60" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1,2,3].map(i => <div key={i} className="h-96 rounded-3xl bg-slate-200/60" />)}
      </div>
    </div>
  )
}

export default function PatientSubscriptionSection({ sessionToken: sessionTokenProp }) {
  const sessionToken = sessionTokenProp || (typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null)
  const { toast } = useToast()

  const [plans, setPlans]           = useState(null)
  const [sub, setSub]               = useState(null)
  const [benefits, setBenefits]     = useState(null)
  const [history, setHistory]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [billing, setBilling]       = useState('monthly')
  const [busyPlan, setBusyPlan]     = useState(null)
  const [showCancel, setShowCancel] = useState(false)
  const [openFaq, setOpenFaq]       = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // /plans — публичный, без сессии
      const plansReq = axios.get(`${API_BASE}/patient/subscription/plans`)
        .then(r => Array.isArray(r.data) ? r.data : [])
        .catch(() => FALLBACK_PLANS)

      // /my — может быть 404 (нет подписки)
      const myReq = sessionToken
        ? axios.get(`${API_BASE}/patient/subscription/my`, { params: { t: sessionToken } })
            .then(r => r.data)
            .catch(e => {
              if (e?.response?.status === 404) return null
              throw e
            })
        : Promise.resolve(null)

      const [plansData, myData] = await Promise.all([plansReq, myReq])
      setPlans(plansData?.length ? plansData : FALLBACK_PLANS)
      setSub(myData)

      // /benefits и история — только если есть активная подписка
      if (myData && sessionToken) {
        try {
          const b = await axios.get(`${API_BASE}/patient/subscription/benefits`, { params: { t: sessionToken } })
          setBenefits(b.data || {})
        } catch { setBenefits({}) }

        try {
          const h = await axios.get(`${API_BASE}/patient/subscription/history`, { params: { t: sessionToken } })
          setHistory(Array.isArray(h.data) ? h.data : [])
        } catch { setHistory([]) }
      } else {
        setBenefits(null)
        setHistory([])
      }
    } catch (e) {
      const status = e?.response?.status
      if (status === 402) setError('module_off')
      else setError('load_failed')
    } finally {
      setLoading(false)
    }
  }, [sessionToken])

  useEffect(() => { load() }, [load])

  const startPlan = async (planKey) => {
    if (!sessionToken) {
      toast('Войдите в кабинет, чтобы оформить подписку', 'error', 3000)
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
      await axios.patch(`${API_BASE}/patient/subscription/my`, { auto_renew: newVal }, { params: { t: sessionToken } })
      toast(newVal ? 'Авто-продление включено' : 'Авто-продление отключено', 'info', 2500)
    } catch (e) {
      // откат
      setSub(s => s ? { ...s, auto_renew: !newVal } : s)
      toast('Не удалось сменить настройку', 'error', 3000)
    }
  }

  if (loading) return <Skeleton />

  if (error === 'module_off') {
    return <PageStub icon="lock" title="Модуль подписок не подключён" sub="Обратитесь к администратору клиники" />
  }
  if (error === 'load_failed') {
    return <PageStub icon="error" title="Не удалось загрузить данные подписки" sub="Попробуйте обновить страницу" />
  }

  // ===== АКТИВНАЯ ПОДПИСКА =====
  if (sub && sub.status !== 'expired') {
    const stMeta = STATUS_LABEL[sub.status] || STATUS_LABEL.active
    const isCancelled = sub.status === 'cancelled'
    const planName = sub.plan_name || (plans?.find(p => p.key === sub.plan)?.name) || sub.plan

    return (
      <div className="flex flex-col gap-5">
        {/* Hero: золотисто-фиолетовый градиент */}
        <div
          className="relative overflow-hidden rounded-3xl p-6 text-white"
          style={{
            background: 'linear-gradient(135deg, #F59E0B 0%, #A855F7 60%, #6366F1 100%)',
            boxShadow: '0 16px 48px rgba(124,58,237,.3)',
          }}
        >
          <div
            className="absolute -top-10 -right-10 w-40 h-40 rounded-full"
            style={{ background: 'rgba(255,255,255,.18)', filter: 'blur(40px)' }}
          />
          <div
            className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full"
            style={{ background: 'rgba(255,255,255,.12)', filter: 'blur(36px)' }}
          />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="material-symbols-outlined text-2xl"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                workspace_premium
              </span>
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                style={{ background: 'rgba(255,255,255,.25)' }}
              >
                {stMeta.l}
              </span>
            </div>
            <h2 className="text-2xl font-extrabold mb-1.5">«{planName}»</h2>
            <p className="text-sm opacity-90">
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

            <div className="flex flex-wrap gap-2 mt-5">
              {isCancelled ? (
                <button
                  onClick={resumeSub}
                  className="px-4 py-2 rounded-xl font-bold text-sm bg-white transition-all active:scale-95"
                  style={{ color: '#7C3AED' }}
                >
                  Возобновить подписку
                </button>
              ) : (
                <button
                  onClick={() => setShowCancel(true)}
                  className="px-4 py-2 rounded-xl font-bold text-sm transition-all active:scale-95"
                  style={{ background: 'rgba(255,255,255,.18)', color: '#fff', backdropFilter: 'blur(8px)' }}
                >
                  Отменить подписку
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Auto-renew toggle */}
        {!isCancelled && (
          <div className="rounded-2xl p-4 flex items-center justify-between bg-white" style={{ border: '1px solid rgba(0,0,0,.06)' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: '#0F172A' }}>Авто-продление</p>
              <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>
                {sub.auto_renew
                  ? `Следующее списание: ${fmtDate(sub.next_charge_at || sub.expires_at)}`
                  : 'Подписка завершится в конце периода'}
              </p>
            </div>
            <button
              onClick={toggleAutoRenew}
              className="relative w-12 h-7 rounded-full transition-all"
              style={{ background: sub.auto_renew ? '#10B981' : '#CBD5E1' }}
              aria-pressed={sub.auto_renew}
            >
              <span
                className="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all"
                style={{ left: sub.auto_renew ? '22px' : '2px' }}
              />
            </button>
          </div>
        )}

        {/* Привилегии */}
        <div>
          <h3 className="text-base font-bold mb-3" style={{ color: '#0F172A' }}>Ваши привилегии</h3>
          <Suspense fallback={<div className="h-32 rounded-2xl bg-slate-100" />}>
            <BenefitsList benefits={benefits || {}} />
          </Suspense>
        </div>

        {/* История платежей */}
        {history?.length > 0 && (
          <div>
            <h3 className="text-base font-bold mb-3" style={{ color: '#0F172A' }}>История платежей</h3>
            <div className="rounded-2xl bg-white overflow-hidden" style={{ border: '1px solid rgba(0,0,0,.06)' }}>
              {history.map((h, i) => (
                <div
                  key={h.id || i}
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: i === history.length - 1 ? 'none' : '1px solid rgba(0,0,0,.05)' }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ background: h.status === 'paid' ? '#DCFCE7' : '#FEE2E2' }}
                    >
                      <span
                        className="material-symbols-outlined text-base"
                        style={{ color: h.status === 'paid' ? '#15803D' : '#991B1B', fontVariationSettings: "'FILL' 1" }}
                      >
                        {h.status === 'paid' ? 'check' : 'close'}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: '#0F172A' }}>{h.description || 'Подписка'}</p>
                      <p className="text-xs" style={{ color: '#64748B' }}>{fmtDate(h.paid_at || h.created_at)}</p>
                    </div>
                  </div>
                  <p className="text-sm font-bold" style={{ color: h.status === 'paid' ? '#0F172A' : '#94A3B8' }}>
                    {Number(h.amount || 0).toLocaleString('ru-RU')} ₽
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

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
    )
  }

  // ===== НЕТ ПОДПИСКИ — выбор тарифа =====
  const visiblePlans = (plans || FALLBACK_PLANS)

  return (
    <div className="flex flex-col gap-6">
      {/* Hero */}
      <div
        className="relative overflow-hidden rounded-3xl p-7 text-white"
        style={{
          background: 'linear-gradient(135deg, #F59E0B 0%, #A855F7 60%, #4F46E5 100%)',
          boxShadow: '0 16px 48px rgba(124,58,237,.25)',
        }}
      >
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full" style={{ background: 'rgba(255,255,255,.18)', filter: 'blur(50px)' }} />
        <div className="absolute -bottom-10 -left-10 w-36 h-36 rounded-full" style={{ background: 'rgba(255,255,255,.1)', filter: 'blur(36px)' }} />
        <div className="relative max-w-xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider mb-3"
               style={{ background: 'rgba(255,255,255,.22)', backdropFilter: 'blur(8px)' }}>
            <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
            ПОДПИСКА
          </div>
          <h1 className="text-3xl font-extrabold leading-tight mb-2">
            Подключите «Здоровье+»
          </h1>
          <p className="text-base opacity-90">
            Забота о здоровье круглый год — безлимит чата с врачом, скидки, приоритет записи и ежемесячный расходник.
          </p>
        </div>
      </div>

      {/* Toggle monthly / annual */}
      <div className="flex justify-center">
        <div className="inline-flex p-1 rounded-2xl" style={{ background: '#F1F5F9' }}>
          {[
            { k: 'monthly', l: 'Ежемесячно' },
            { k: 'annual',  l: 'Ежегодно · −17%' },
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

      {/* Plans grid */}
      <Suspense fallback={<Skeleton />}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-3">
          {visiblePlans.map(plan => (
            <PlanCard
              key={plan.key}
              plan={plan}
              billing={billing}
              featured={plan.key === 'health_plus'}
              loading={busyPlan === plan.key}
              onSelect={() => startPlan(plan.key)}
            />
          ))}
        </div>
      </Suspense>

      {/* Trust strip */}
      <div className="rounded-2xl bg-white px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-2 justify-center" style={{ border: '1px solid rgba(0,0,0,.06)' }}>
        {[
          { icon: 'shield', t: 'Безопасные платежи' },
          { icon: 'sync',  t: 'Отмена в один клик' },
          { icon: 'verified', t: 'Без скрытых платежей' },
        ].map(b => (
          <div key={b.icon} className="flex items-center gap-2 text-xs font-semibold" style={{ color: '#475569' }}>
            <span className="material-symbols-outlined text-base" style={{ color: '#10B981', fontVariationSettings: "'FILL' 1" }}>{b.icon}</span>
            {b.t}
          </div>
        ))}
      </div>

      {/* FAQ */}
      <div>
        <h3 className="text-xl font-extrabold mb-3 mt-4" style={{ color: '#0F172A' }}>Часто спрашивают</h3>
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
    </div>
  )
}
