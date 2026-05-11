/**
 * ========================================
 * БЛОК: ManagerSubscriptionCashSection — наличная активация подписки
 * ========================================
 * Премиум-секция для управляющего: возможность активировать подписку
 * «Здоровье+» / «Семья+» / «Pro» по наличной оплате прямо в клинике.
 *
 * 3 вкладки:
 *   1. «Активировать тариф»  — 5-шаговый wizard
 *   2. «История активаций»   — фильтры + таблица + повторная печать
 *   3. «Статистика»          — KPI + графики (CSS bars, без библиотек)
 *
 * API-контракт (зафиксирован backend-агентом):
 *   POST  /manager/subscription-cash/activate
 *   GET   /patient/subscription/plans
 *   GET   /referrals/patients/search?q=
 *   GET   /manager/subscription-cash/history
 *   GET   /manager/subscription-cash/stats?period=7d|30d|90d
 *   GET   /manager/subscription-cash/{id}/receipt.pdf
 *
 * Используется в pages/ManagerSubscriptionCash.jsx (роут /manager/subscription-cash).
 * ========================================
 */
import { useEffect, useMemo, useState, lazy, Suspense, useCallback } from 'react'
import apiClient from '../api'
import { Tabs, useToast, EmptyState } from '../design'

// Подкомпоненты wizard'а
const PatientSearchPicker  = lazy(() => import('../components/subscription-cash/PatientSearchPicker'))
const PlanSelector         = lazy(() => import('../components/subscription-cash/PlanSelector'))
const PeriodSelector       = lazy(() => import('../components/subscription-cash/PeriodSelector'))
const PaymentConfirmStep   = lazy(() => import('../components/subscription-cash/PaymentConfirmStep'))
const SuccessReceipt       = lazy(() => import('../components/subscription-cash/SuccessReceipt'))
// Существующая премиум-форма быстрого создания пациента
const RegMobilePatientForm = lazy(() => import('../components/RegMobilePatientForm'))

// Период-скидки (синхронизировано с PeriodSelector)
import { calcPrice, PERIOD_OPTIONS } from '../components/subscription-cash/PeriodSelector'

// ─── Тарифы по умолчанию (если /plans ещё не загружен) ───
const PLAN_TITLES = {
  health_plus: 'Здоровье+',
  family_plus: 'Семья+',
  pro:         'Pro',
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch { return iso }
}
function fmtDateLong(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch { return iso }
}
function fmtMoney(v) {
  return Number(v || 0).toLocaleString('ru-RU') + ' ₽'
}
function initials(name) {
  if (!name) return '?'
  const parts = String(name).trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

const TABS = [
  { id: 'activate', label: 'Активировать тариф' },
  { id: 'history',  label: 'История активаций' },
  { id: 'stats',    label: 'Статистика' },
]

// ────────────────────────────────────────────
// Главный компонент
// ────────────────────────────────────────────
export default function ManagerSubscriptionCashSection() {
  const [tab, setTab] = useState('activate')
  return (
    <div>
      {/* Tabs */}
      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === 'activate' && <ActivateWizard />}
      {tab === 'history'  && <HistoryTab />}
      {tab === 'stats'    && <StatsTab />}
    </div>
  )
}

// ============================================
// TAB 1: Активация (5-шаговый wizard)
// ============================================
function ActivateWizard() {
  const { toast } = useToast()
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState(false)

  // Состояние wizard'а
  const [plans, setPlans]         = useState(null)
  const [patient, setPatient]     = useState(null)
  const [planKey, setPlanKey]     = useState(null)
  const [months, setMonths]       = useState(1)
  const [amount, setAmount]       = useState('')
  const [note, setNote]           = useState('')

  // Результат активации
  const [result, setResult]       = useState(null)

  // Модал быстрого создания пациента
  const [createOpen, setCreateOpen] = useState(false)

  // Модал подтверждения для re-activation
  const [confirmReactivate, setConfirmReactivate] = useState(null)
  // Универсальный confirm перед активацией
  const [confirmActivate, setConfirmActivate] = useState(false)

  // ─── Загрузка тарифов один раз ───
  useEffect(() => {
    let alive = true
    apiClient.get('/patient/subscription/plans').then(r => {
      if (!alive) return
      const data = Array.isArray(r.data) ? r.data : (r.data?.plans || [])
      setPlans(data)
    }).catch(() => { /* fallback в PlanSelector сработает */ })
    return () => { alive = false }
  }, [])

  const selectedPlan = useMemo(
    () => (plans || []).find(p => p.key === planKey) || null,
    [plans, planKey],
  )
  const priceMonthly = Number(selectedPlan?.price_monthly || 0)
  const planTitle = selectedPlan?.title || selectedPlan?.name || PLAN_TITLES[planKey] || planKey
  const calc = useMemo(() => calcPrice(priceMonthly, months), [priceMonthly, months])

  // ─── Префилл amount при изменении расчёта ───
  useEffect(() => {
    if (step >= 4 && calc.total > 0) {
      setAmount(String(calc.total))
    }
  }, [step, calc.total])

  // ─── Reset ───
  const reset = useCallback(() => {
    setStep(1)
    setPatient(null)
    setPlanKey(null)
    setMonths(1)
    setAmount('')
    setNote('')
    setResult(null)
    setConfirmReactivate(null)
    setConfirmActivate(false)
  }, [])

  // ─── Обработчики шагов ───
  const onSelectPatient = (p) => {
    setPatient(p)
    setStep(2)
  }
  const onSelectPlan = (key) => {
    // Если у пациента уже есть активная подписка — спросить о продлении
    if (patient?.subscription_plan_key && patient?.subscription_expires_at) {
      setConfirmReactivate({ key })
      return
    }
    setPlanKey(key)
    setStep(3)
  }
  const onConfirmReactivate = () => {
    setPlanKey(confirmReactivate.key)
    setConfirmReactivate(null)
    setStep(3)
  }
  const onSelectMonths = (m) => setMonths(m)
  const goToConfirm = () => {
    setAmount(String(calc.total))
    setStep(4)
  }
  // Шаг 4 → запрос подтверждения → активация
  const handleActivate = async () => {
    setConfirmActivate(false)
    setBusy(true)
    try {
      const res = await apiClient.post('/manager/subscription-cash/activate', {
        patient_id: patient.id,
        plan_key: planKey,
        months: Number(months),
        amount_received: Number(amount),
        note: note?.trim() || undefined,
      })
      setResult(res.data || {})
      setStep(5)
      toast?.({ type: 'success', message: 'Тариф активирован' })
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Не удалось активировать тариф'
      toast?.({ type: 'error', message: msg })
    } finally {
      setBusy(false)
    }
  }

  // ─── Шаг назад ───
  const back = () => setStep(s => Math.max(1, s - 1))

  return (
    <div>
      {/* ─── Прогресс-бар ─── */}
      <ProgressBar step={step} />

      {/* ─── Контент шага ─── */}
      <div
        className="mt-6 rounded-3xl p-5 sm:p-7"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <Suspense fallback={<div style={{ minHeight: 240 }} />}>
          {/* STEP 1: Пациент */}
          {step === 1 && (
            <div>
              <StepTitle
                icon="person_search"
                title="Поиск пациента"
                subtitle="Найдите пациента по ФИО или телефону. Если в базе нет — создайте нового."
              />
              <PatientSearchPicker
                onSelect={onSelectPatient}
                onCreateNew={() => setCreateOpen(true)}
              />
            </div>
          )}

          {/* STEP 2: Тариф */}
          {step === 2 && patient && (
            <div>
              <StepTitle
                icon="workspace_premium"
                title="Выберите тариф"
                subtitle="Подберите подходящий план для пациента."
              />
              <PatientHeaderCard patient={patient} onChange={() => setStep(1)} />
              <div className="mt-5">
                <PlanSelector plans={plans} onSelect={onSelectPlan} />
              </div>
              <div className="mt-5 flex justify-start">
                <SecondaryBackButton onClick={back} />
              </div>
            </div>
          )}

          {/* STEP 3: Период */}
          {step === 3 && patient && planKey && (
            <div>
              <StepTitle
                icon="event_repeat"
                title="Срок подписки"
                subtitle="Чем длиннее период — тем выгоднее. Скидка применяется автоматически."
              />
              <SummaryRow patient={patient} planTitle={planTitle} months={null} amount={null} compact />
              <div className="mt-5">
                <PeriodSelector
                  priceMonthly={priceMonthly}
                  value={months}
                  onChange={onSelectMonths}
                />
              </div>
              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-between">
                <SecondaryBackButton onClick={back} />
                <PrimaryNextButton onClick={goToConfirm} label="Далее: оплата" />
              </div>
            </div>
          )}

          {/* STEP 4: Оплата */}
          {step === 4 && patient && planKey && (
            <div>
              <StepTitle
                icon="payments"
                title="Получение наличных"
                subtitle="Введите фактически полученную сумму и подтвердите активацию."
              />
              <PaymentConfirmStep
                patient={patient}
                planTitle={planTitle}
                months={months}
                priceTotal={calc.total}
                amount={amount}
                setAmount={setAmount}
                note={note}
                setNote={setNote}
                busy={busy}
                onActivate={() => setConfirmActivate(true)}
                onBack={back}
              />
            </div>
          )}

          {/* STEP 5: Успех */}
          {step === 5 && (
            <SuccessReceipt
              patient={patient}
              planTitle={planTitle}
              expiresAt={result?.expires_at}
              receiptUrl={result?.receipt_url ? withApi(result.receipt_url) : null}
              discountWarning={result?.discount_warning}
              onReset={reset}
            />
          )}
        </Suspense>
      </div>

      {/* ─── Модал быстрого создания пациента ─── */}
      {createOpen && (
        <Suspense fallback={null}>
          <RegMobilePatientForm
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            onCreated={(p) => {
              setCreateOpen(false)
              if (p) onSelectPatient(p)
            }}
          />
        </Suspense>
      )}

      {/* ─── Confirm: re-activation ─── */}
      {confirmReactivate && (
        <ConfirmModal
          icon="autorenew"
          title="У пациента уже активный тариф"
          message={
            <>
              У пациента <strong>{patient?.full_name}</strong> уже есть активный тариф{' '}
              <strong style={{ color: '#7C3AED' }}>
                {patient?.subscription_plan_title || patient?.subscription_plan_key}
              </strong>
              {patient?.subscription_expires_at && (
                <> до <strong>{fmtDateLong(patient.subscription_expires_at)}</strong></>
              )}
              . Продлить / переоформить?
            </>
          }
          confirmLabel="Да, продолжить"
          cancelLabel="Отмена"
          onConfirm={onConfirmReactivate}
          onCancel={() => setConfirmReactivate(null)}
        />
      )}

      {/* ─── Confirm: активация (последняя точка возврата) ─── */}
      {confirmActivate && (
        <ConfirmModal
          icon="paid"
          title="Подтвердите активацию"
          message={
            <>
              Активировать тариф <strong style={{ color: '#7C3AED' }}>{planTitle}</strong> на{' '}
              <strong>{months} {months === 1 ? 'месяц' : months < 5 ? 'месяца' : 'месяцев'}</strong>{' '}
              для <strong>{patient?.full_name}</strong>?<br />
              Получено наличными: <strong>{fmtMoney(amount)}</strong>.
            </>
          }
          confirmLabel="Активировать"
          cancelLabel="Назад"
          onConfirm={handleActivate}
          onCancel={() => setConfirmActivate(false)}
        />
      )}
    </div>
  )
}

// Преобразовать /manager/... → полный URL (учитывая baseURL apiClient'а)
function withApi(path) {
  if (!path) return null
  if (/^https?:/i.test(path)) return path
  const base = apiClient?.defaults?.baseURL || ''
  // baseURL уже содержит /api или подобный префикс, path начинается с /manager → склеиваем
  return base.replace(/\/$/, '') + path
}

// ============================================
// ProgressBar (5 шагов)
// ============================================
function ProgressBar({ step }) {
  const stepsMeta = [
    { n: 1, label: 'Пациент',  icon: 'person_search' },
    { n: 2, label: 'Тариф',    icon: 'workspace_premium' },
    { n: 3, label: 'Срок',     icon: 'event_repeat' },
    { n: 4, label: 'Оплата',   icon: 'payments' },
    { n: 5, label: 'Готово',   icon: 'check_circle' },
  ]
  return (
    <div
      className="rounded-2xl px-4 py-3 sm:px-5 sm:py-4"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div className="flex items-center">
        {stepsMeta.map((s, idx) => {
          const done = step > s.n
          const active = step === s.n
          return (
            <div key={s.n} className="flex items-center flex-1 last:flex-initial">
              <div className="flex flex-col items-center" style={{ minWidth: 0 }}>
                <div
                  className="inline-grid place-items-center transition-all"
                  style={{
                    width: 38, height: 38, borderRadius: '50%',
                    background: done || active
                      ? 'linear-gradient(135deg, #F59E0B, #7C3AED)'
                      : 'var(--bg-2)',
                    color: done || active ? '#fff' : 'var(--fg-3)',
                    boxShadow: active ? '0 4px 14px rgba(124,58,237,.32)' : 'none',
                    border: !done && !active ? '1.5px solid var(--border)' : 'none',
                    fontWeight: 800,
                    fontSize: 13.5,
                  }}
                >
                  {done ? (
                    <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>check</span>
                  ) : (
                    <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}>
                      {s.icon}
                    </span>
                  )}
                </div>
                <div
                  className="mt-1.5 hidden sm:block text-center"
                  style={{
                    fontSize: 10.5,
                    fontWeight: active ? 800 : 600,
                    color: done || active ? 'var(--fg)' : 'var(--fg-3)',
                    letterSpacing: 0.3, textTransform: 'uppercase',
                  }}
                >
                  {s.label}
                </div>
              </div>
              {idx < stepsMeta.length - 1 && (
                <div
                  className="flex-1 mx-2 sm:mx-3"
                  style={{
                    height: 3, borderRadius: 999,
                    background: done
                      ? 'linear-gradient(90deg, #F59E0B, #7C3AED)'
                      : 'var(--border)',
                    opacity: done ? 1 : 0.6,
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================
// Карточка выбранного пациента (шапка шагов 2-3)
// ============================================
function PatientHeaderCard({ patient, onChange }) {
  return (
    <div
      className="flex items-center gap-3 p-4 rounded-2xl"
      style={{
        background: 'var(--bg-1)',
        border: '1px solid var(--border)',
      }}
    >
      <div
        className="flex-shrink-0 inline-grid place-items-center"
        style={{
          width: 48, height: 48, borderRadius: 14,
          background: 'linear-gradient(135deg, #F59E0B, #7C3AED)',
          color: '#fff', fontWeight: 800, fontSize: 16, letterSpacing: 0.3,
        }}
      >
        {initials(patient.full_name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold truncate" style={{ fontSize: 15, color: 'var(--fg)' }}>
          {patient.full_name || 'Без имени'}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>{patient.phone || '—'}</span>
          {patient.subscription_plan_key && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
              style={{
                fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3,
                background: 'rgba(124,58,237,.12)', color: '#7C3AED',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>workspace_premium</span>
              Активен: {patient.subscription_plan_title || patient.subscription_plan_key}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onChange}
        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl transition-colors"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--fg-2)',
          fontSize: 12.5, fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>swap_horiz</span>
        Другой
      </button>
    </div>
  )
}

// ============================================
// Маленький компонент: заголовок шага
// ============================================
function StepTitle({ icon, title, subtitle }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div
        className="flex-shrink-0 inline-grid place-items-center"
        style={{
          width: 44, height: 44, borderRadius: 14,
          background: 'linear-gradient(135deg, rgba(245,158,11,.18), rgba(124,58,237,.18))',
          color: '#7C3AED',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 24, fontVariationSettings: "'FILL' 1" }}>
          {icon}
        </span>
      </div>
      <div>
        <div className="font-bold" style={{ fontSize: 18, letterSpacing: '-0.01em', color: 'var(--fg)' }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 2 }}>{subtitle}</div>
        )}
      </div>
    </div>
  )
}

function SecondaryBackButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 px-5 py-3 rounded-xl transition-colors"
      style={{
        background: 'var(--surface)',
        border: '1.5px solid var(--border)',
        color: 'var(--fg-2)',
        fontWeight: 700,
        fontSize: 14,
        cursor: 'pointer',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
      Назад
    </button>
  )
}
function PrimaryNextButton({ onClick, label }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 px-6 rounded-xl transition-all hover:scale-[1.01]"
      style={{
        height: 52,
        background: 'linear-gradient(135deg, #F59E0B, #7C3AED)',
        color: '#fff',
        fontWeight: 800,
        fontSize: 14.5,
        boxShadow: '0 8px 22px rgba(124,58,237,.32)',
        cursor: 'pointer',
        border: 'none',
      }}
    >
      {label}
      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>arrow_forward</span>
    </button>
  )
}

function SummaryRow({ patient, planTitle, months, amount, compact }) {
  return (
    <div
      className="rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap"
      style={{
        background: 'rgba(124,58,237,.06)',
        border: '1px solid rgba(124,58,237,.18)',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#7C3AED' }}>info</span>
      <span style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
        <strong style={{ color: 'var(--fg)' }}>{patient?.full_name}</strong>
        {planTitle && <> • Тариф: <strong style={{ color: '#7C3AED' }}>{planTitle}</strong></>}
        {months != null && <> • {months} мес</>}
        {amount != null && <> • {fmtMoney(amount)}</>}
      </span>
    </div>
  )
}

// ============================================
// Универсальный confirm-модал
// ============================================
function ConfirmModal({ icon, title, message, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'oklch(0 0 0 / 0.42)' }}
        onClick={onCancel}
      />
      <div
        className="fixed inset-0 z-50 grid place-items-center px-4"
        onClick={onCancel}
      >
        <div
          className="rounded-3xl p-6 max-w-[440px] w-full"
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: '0 24px 64px rgba(0,0,0,.18)',
            animation: 'modalIn .2s ease-out',
          }}
        >
          <div
            className="inline-grid place-items-center mb-4"
            style={{
              width: 56, height: 56, borderRadius: 18,
              background: 'linear-gradient(135deg, rgba(245,158,11,.18), rgba(124,58,237,.18))',
              color: '#7C3AED',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 30, fontVariationSettings: "'FILL' 1" }}>
              {icon}
            </span>
          </div>
          <h3 className="font-extrabold mb-2" style={{ fontSize: 20, letterSpacing: '-0.01em', color: 'var(--fg)' }}>
            {title}
          </h3>
          <div style={{ fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.55 }}>{message}</div>
          <div className="flex gap-3 mt-5">
            <button
              onClick={onCancel}
              className="flex-1 py-3 rounded-xl transition-colors"
              style={{
                background: 'var(--surface)',
                border: '1.5px solid var(--border)',
                color: 'var(--fg-2)',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              {cancelLabel || 'Отмена'}
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 py-3 rounded-xl transition-all hover:scale-[1.02]"
              style={{
                background: 'linear-gradient(135deg, #F59E0B, #7C3AED)',
                border: 'none',
                color: '#fff',
                fontWeight: 800,
                fontSize: 14,
                cursor: 'pointer',
                boxShadow: '0 8px 22px rgba(124,58,237,.32)',
              }}
            >
              {confirmLabel || 'OK'}
            </button>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes modalIn {
          from { transform: scale(.95); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </>
  )
}

// ============================================
// TAB 2: История активаций
// ============================================
function HistoryTab() {
  const { toast } = useToast()
  const today = new Date()
  const monthAgo = new Date(today.getTime() - 30 * 86400000)
  const ymd = (d) => d.toISOString().slice(0, 10)

  const [from, setFrom] = useState(ymd(monthAgo))
  const [to,   setTo]   = useState(ymd(today))
  const [patientQ, setPatientQ] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiClient.get('/manager/subscription-cash/history', {
        params: {
          from: from || undefined,
          to:   to   || undefined,
          patient_q: patientQ?.trim() || undefined,
          limit: 50,
        },
      })
      setItems(Array.isArray(res.data) ? res.data : [])
    } catch (e) {
      toast?.({ type: 'error', message: 'Не удалось загрузить историю' })
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [from, to, patientQ, toast])

  useEffect(() => { load() }, [from, to])

  const totalSum = useMemo(
    () => items.reduce((s, x) => s + Number(x.amount_received || 0), 0),
    [items],
  )

  const onReprint = (id) => {
    const url = withApi(`/manager/subscription-cash/${id}/receipt.pdf`)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div>
      {/* Фильтры */}
      <div
        className="rounded-2xl p-4 mb-5 grid grid-cols-1 md:grid-cols-4 gap-3"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <FieldLabel label="Период с">
          <DateInput value={from} onChange={setFrom} />
        </FieldLabel>
        <FieldLabel label="по">
          <DateInput value={to} onChange={setTo} />
        </FieldLabel>
        <FieldLabel label="Поиск пациента">
          <input
            type="text"
            placeholder="Имя или телефон…"
            value={patientQ}
            onChange={(e) => setPatientQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load() }}
            style={inputStyle}
          />
        </FieldLabel>
        <div className="flex items-end">
          <button
            onClick={load}
            className="w-full inline-flex items-center justify-center gap-2 px-4 rounded-xl transition-all hover:scale-[1.02]"
            style={{
              height: 44,
              background: 'linear-gradient(135deg, #F59E0B, #7C3AED)',
              color: '#fff', border: 'none',
              fontWeight: 700, fontSize: 14,
              cursor: 'pointer',
              boxShadow: '0 6px 18px rgba(124,58,237,.28)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>
            Найти
          </button>
        </div>
      </div>

      {/* Сводка */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{
            background: 'rgba(16,185,129,.10)',
            color: '#059669',
            fontSize: 12.5, fontWeight: 700,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>receipt_long</span>
          Активаций: {items.length}
        </span>
        <span
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{
            background: 'rgba(124,58,237,.10)',
            color: '#7C3AED',
            fontSize: 12.5, fontWeight: 700,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>payments</span>
          Сумма: {fmtMoney(totalSum)}
        </span>
      </div>

      {/* Таблица */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {loading ? (
          <div className="p-8 text-center" style={{ color: 'var(--fg-3)' }}>Загрузка…</div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="Нет активаций за период"
            description="Попробуйте расширить диапазон дат или очистить фильтры."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13.5 }}>
              <thead>
                <tr style={{ background: 'var(--bg-2)' }}>
                  <Th>Дата</Th>
                  <Th>Пациент</Th>
                  <Th>Тариф</Th>
                  <Th>Период</Th>
                  <Th right>Сумма</Th>
                  <Th>Менеджер</Th>
                  <Th right>Действия</Th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <Td>{fmtDate(it.started_at)}</Td>
                    <Td>
                      <div style={{ fontWeight: 700, color: 'var(--fg)' }}>{it.patient_name || '—'}</div>
                    </Td>
                    <Td>
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                        style={{
                          fontSize: 11, fontWeight: 700, letterSpacing: 0.2,
                          background: 'rgba(124,58,237,.10)',
                          color: '#7C3AED',
                        }}
                      >
                        {it.plan_title || PLAN_TITLES[it.plan_key] || it.plan_key}
                      </span>
                    </Td>
                    <Td>
                      {it.months} мес
                      <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>до {fmtDate(it.expires_at)}</div>
                    </Td>
                    <Td right>
                      <strong style={{ color: 'var(--fg)' }}>{fmtMoney(it.amount_received)}</strong>
                    </Td>
                    <Td>{it.received_by_name || '—'}</Td>
                    <Td right>
                      <button
                        onClick={() => onReprint(it.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors"
                        style={{
                          background: 'var(--bg-1)',
                          border: '1px solid var(--border)',
                          color: 'var(--fg-2)',
                          fontSize: 12, fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>print</span>
                        Печать
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%',
  height: 44,
  padding: '0 12px',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  fontSize: 14,
  color: 'var(--fg)',
  outline: 'none',
}
function FieldLabel({ label, children }) {
  return (
    <div>
      <div
        className="mb-1.5"
        style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
          color: 'var(--fg-3)',
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}
function DateInput({ value, onChange }) {
  return (
    <input
      type="date"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      style={inputStyle}
    />
  )
}
function Th({ children, right }) {
  return (
    <th
      style={{
        padding: '10px 12px',
        textAlign: right ? 'right' : 'left',
        fontSize: 11,
        fontWeight: 800,
        color: 'var(--fg-3)',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
      }}
    >
      {children}
    </th>
  )
}
function Td({ children, right }) {
  return (
    <td style={{ padding: '12px', textAlign: right ? 'right' : 'left', color: 'var(--fg-2)' }}>
      {children}
    </td>
  )
}

// ============================================
// TAB 3: Статистика
// ============================================
function StatsTab() {
  const { toast } = useToast()
  const [period, setPeriod] = useState('30d')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiClient.get('/manager/subscription-cash/stats', { params: { period } })
      setData(res.data || {})
    } catch {
      toast?.({ type: 'error', message: 'Не удалось загрузить статистику' })
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [period, toast])

  useEffect(() => { load() }, [period])

  const PERIODS = [
    { id: '7d',  label: '7 дней' },
    { id: '30d', label: '30 дней' },
    { id: '90d', label: '90 дней' },
  ]

  // ─── Trend max для bar-chart ───
  const trend = data?.trend || []
  const maxTrend = trend.reduce((m, x) => Math.max(m, Number(x.revenue || 0)), 0) || 1

  // ─── By plan для donut (CSS conic-gradient) ───
  const byPlan = data?.by_plan || []
  const totalByPlan = byPlan.reduce((s, x) => s + Number(x.revenue || 0), 0) || 1
  const PLAN_COLORS = {
    health_plus: '#A855F7',
    family_plus: '#4F46E5',
    pro:         '#10B981',
  }
  let acc = 0
  const conicSegs = byPlan.map(p => {
    const pct = Number(p.revenue || 0) / totalByPlan
    const from = acc * 360
    const to = (acc + pct) * 360
    acc += pct
    return { plan: p, from, to, color: PLAN_COLORS[p.plan_key] || '#94A3B8' }
  })
  const conicGradient = conicSegs.length
    ? `conic-gradient(${conicSegs.map(s => `${s.color} ${s.from}deg ${s.to}deg`).join(', ')})`
    : 'conic-gradient(var(--bg-2) 0deg 360deg)'

  // ─── By clinic top-3 ───
  const byClinic = (data?.by_clinic || []).slice(0, 3)
  const maxClinicRev = byClinic.reduce((m, x) => Math.max(m, Number(x.revenue || 0)), 0) || 1

  return (
    <div>
      {/* Период */}
      <div className="mb-5">
        <Tabs items={PERIODS} value={period} onChange={setPeriod} />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCardCash
          icon="receipt_long"
          label="Активаций"
          value={loading ? '…' : (data?.total_activations ?? 0)}
          gradient="linear-gradient(135deg, #F59E0B, #FBBF24)"
        />
        <KpiCardCash
          icon="payments"
          label="Выручка"
          value={loading ? '…' : fmtMoney(data?.total_revenue || 0)}
          gradient="linear-gradient(135deg, #7C3AED, #A855F7)"
        />
        <KpiCardCash
          icon="trending_up"
          label="Средний чек"
          value={loading ? '…' : fmtMoney(data?.avg_check || 0)}
          gradient="linear-gradient(135deg, #0EA5E9, #6366F1)"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Trend bars */}
        <ChartCard title="Динамика выручки" icon="show_chart">
          {trend.length === 0 ? (
            <div className="text-center py-10" style={{ color: 'var(--fg-3)', fontSize: 13 }}>
              {loading ? 'Загрузка…' : 'Нет данных за период'}
            </div>
          ) : (
            <div className="flex items-end gap-1 sm:gap-1.5" style={{ height: 180 }}>
              {trend.map((t, i) => {
                const h = Math.max(2, (Number(t.revenue || 0) / maxTrend) * 160)
                return (
                  <div key={i} className="flex-1 flex flex-col items-center" title={`${t.date}: ${fmtMoney(t.revenue)}`}>
                    <div
                      className="w-full rounded-t-md transition-all"
                      style={{
                        height: h,
                        background: 'linear-gradient(180deg, #F59E0B, #7C3AED)',
                        boxShadow: '0 -2px 8px rgba(124,58,237,.18)',
                      }}
                    />
                    {trend.length <= 14 && (
                      <div
                        style={{
                          fontSize: 9, color: 'var(--fg-4)',
                          marginTop: 4, transform: 'rotate(-30deg)', transformOrigin: 'top right',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {fmtDate(t.date)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </ChartCard>

        {/* Donut by plan */}
        <ChartCard title="Распределение по тарифам" icon="pie_chart">
          {byPlan.length === 0 ? (
            <div className="text-center py-10" style={{ color: 'var(--fg-3)', fontSize: 13 }}>
              {loading ? 'Загрузка…' : 'Нет данных'}
            </div>
          ) : (
            <div className="flex items-center gap-5 flex-wrap">
              <div
                className="relative flex-shrink-0"
                style={{
                  width: 160, height: 160, borderRadius: '50%',
                  background: conicGradient,
                  boxShadow: '0 8px 24px rgba(0,0,0,.08)',
                }}
              >
                <div
                  className="absolute inset-3 rounded-full"
                  style={{ background: 'var(--surface)' }}
                />
                <div
                  className="absolute inset-0 grid place-items-center"
                  style={{ textAlign: 'center' }}
                >
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 700, textTransform: 'uppercase' }}>
                      Всего
                    </div>
                    <div
                      style={{
                        fontSize: 18, fontWeight: 800,
                        background: 'linear-gradient(135deg, #F59E0B, #7C3AED)',
                        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                      }}
                    >
                      {fmtMoney(totalByPlan)}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                {byPlan.map(p => {
                  const pct = Math.round((Number(p.revenue || 0) / totalByPlan) * 100)
                  return (
                    <div key={p.plan_key} className="flex items-center gap-2">
                      <span
                        className="inline-block flex-shrink-0"
                        style={{
                          width: 12, height: 12, borderRadius: 3,
                          background: PLAN_COLORS[p.plan_key] || '#94A3B8',
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg)' }}>
                            {PLAN_TITLES[p.plan_key] || p.plan_key}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--fg-3)', fontWeight: 600 }}>{pct}%</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                          {p.count} • {fmtMoney(p.revenue)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </ChartCard>

        {/* Top-3 clinics */}
        <ChartCard title="Топ-3 клиники" icon="leaderboard" wide>
          {byClinic.length === 0 ? (
            <div className="text-center py-10" style={{ color: 'var(--fg-3)', fontSize: 13 }}>
              {loading ? 'Загрузка…' : 'Нет данных'}
            </div>
          ) : (
            <div className="space-y-3">
              {byClinic.map((c, i) => {
                const pct = (Number(c.revenue || 0) / maxClinicRev) * 100
                return (
                  <div key={c.clinic_id || i}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-grid place-items-center"
                          style={{
                            width: 24, height: 24, borderRadius: 7,
                            background: i === 0
                              ? 'linear-gradient(135deg, #F59E0B, #FBBF24)'
                              : i === 1
                                ? 'linear-gradient(135deg, #94A3B8, #64748B)'
                                : 'linear-gradient(135deg, #92400E, #78350F)',
                            color: '#fff', fontWeight: 800, fontSize: 11,
                          }}
                        >
                          {i + 1}
                        </span>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--fg)' }}>
                          {c.name || `Клиника #${c.clinic_id}`}
                        </span>
                      </div>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--fg-2)' }}>
                        {fmtMoney(c.revenue)}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 8, borderRadius: 999,
                        background: 'var(--bg-2)', overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`, height: '100%',
                          background: 'linear-gradient(90deg, #F59E0B, #7C3AED)',
                          transition: 'width .4s ease',
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3 }}>
                      Активаций: {c.count}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  )
}

function KpiCardCash({ icon, label, value, gradient }) {
  return (
    <div
      className="relative rounded-2xl p-5 overflow-hidden"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div
        className="absolute top-0 right-0 opacity-10 pointer-events-none"
        style={{
          width: 90, height: 90, borderRadius: '50%',
          background: gradient,
          transform: 'translate(20px,-20px)',
        }}
      />
      <div
        className="inline-grid place-items-center mb-3"
        style={{
          width: 40, height: 40, borderRadius: 12,
          background: gradient,
          color: '#fff',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}>
          {icon}
        </span>
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div className="mt-1 font-extrabold" style={{ fontSize: 24, color: 'var(--fg)', letterSpacing: '-0.02em' }}>
        {value}
      </div>
    </div>
  )
}

function ChartCard({ title, icon, children, wide }) {
  return (
    <div
      className={`rounded-2xl p-5 ${wide ? 'md:col-span-2' : ''}`}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#7C3AED' }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--fg)', letterSpacing: 0.2 }}>
          {title}
        </span>
      </div>
      {children}
    </div>
  )
}
