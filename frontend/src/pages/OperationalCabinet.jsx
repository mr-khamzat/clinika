/**
 * ========================================
 * СТРАНИЦА: OperationalCabinet — кабинет регистратора (reg) и медсестры (nurse)
 * ========================================
 * Самый используемый кабинет в клинике. Premium-редизайн в стиле design-preview-2
 * (cyan/teal акценты, glassmorphism, mobile-first, большие тач-кнопки).
 *
 * Роли:
 *   - reg   — Регистратор: направления + запись к врачу + бонусы + приём пациента
 *   - nurse — Медсестра:    только направления (без записи к врачу)
 *
 * Бизнес-логика, API, useState/useEffect — без изменений; меняется ТОЛЬКО JSX/стили.
 * Эталон стиля — /public/design2/admin.html и /public/design2/patient.html.
 * ========================================
 */
import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'
import {
  Page,
  Card,
  KpiCard,
  KpiRow,
  Chip,
  Button,
  Avatar,
  EmptyState,
  Sparkline,
  useToast,
} from '../design'

const BrandingSection = lazy(() => import('../sections/BrandingSection'))
const CMSPagesSection = lazy(() => import('../sections/CMSPagesSection'))
const ActsSection     = lazy(() => import('../sections/ActsSection'))

// ─── HTTP-клиент с авторизацией ───
const api = (token) => ({
  get:  (url, params) => axios.get(API_BASE + url, { headers: { Authorization: `Bearer ${token}` }, params }),
  post: (url, data)   => axios.post(API_BASE + url, data, { headers: { Authorization: `Bearer ${token}` } }),
})

// ─── Премиум cyan/teal акцент (override accent токенов) ───
const TEAL_ACCENT = `
  :root, [data-theme="light"] {
    --accent: oklch(0.62 0.12 195);
    --accent-2: oklch(0.55 0.13 200);
    --accent-soft: oklch(0.62 0.12 195 / 0.10);
    --accent-line: oklch(0.62 0.12 195 / 0.28);
    --accent-fg: #fff;
  }
`

const ROLE_LABELS = { reg: 'Регистратор', nurse: 'Медсестра' }
const ROLE_ICONS  = { reg: 'admin_panel_settings', nurse: 'medical_services' }

// ─── Форматирование ───
const fmtDate = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—'
const fmtMoney = v => (v || 0).toLocaleString('ru-RU') + ' ₽'

// ─── Material icon helper (filled, нужный размер) ───
function Icon({ name, size = 20, fill = 1, className = '', style = {} }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${fill}`,
        lineHeight: 1,
        ...style,
      }}
    >
      {name}
    </span>
  )
}

export default function OperationalCabinet({ adminToken, user, onLogout }) {
  // Замена alert на Toast
  const { toast } = useToast()
  // ─── Текущая вкладка и UI-состояние ───
  const [tab, setTab] = useState('dashboard')
  const [stats, setStats] = useState(null)
  const [referrals, setReferrals] = useState([])
  const [bonuses, setBonuses] = useState([])
  const [clinics, setClinics] = useState([])
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)

  // ─── Внешние врачи (доп. таб «Ещё → Врачи») ───
  const [externalDoctors, setExternalDoctors] = useState([])
  const [doctorRequests, setDoctorRequests] = useState([])

  // ─── Приезжие врачи + запись на их приём ───
  const [visitingDoctors, setVisitingDoctors] = useState([])
  const [visitingSettings, setVisitingSettings] = useState([])
  const [visitingApts, setVisitingApts] = useState([])
  const [visitingAptLoading, setVisitingAptLoading] = useState(false)
  const [bookVisitDoc, setBookVisitDoc] = useState(null)
  const [bookVisitForm, setBookVisitForm] = useState({ patient_name:'', patient_phone:'', appointment_date:'', start_time:'09:00', end_time:'09:30', price:'' })
  const [bookVisitSaving, setBookVisitSaving] = useState(false)
  const [bookVisitMsg, setBookVisitMsg] = useState('')
  const [bookVisitResult, setBookVisitResult] = useState(null)

  // ─── Создание направления ───
  const [form, setForm] = useState({ to_clinic_id:'', service_id:'', patient_phone:'', patient_name:'', notes:'' })
  const [createdRef, setCreatedRef] = useState(null)

  // ─── Принять пациента (premium-фишка): QR scan + short_code + поиск ───
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [acceptCode, setAcceptCode] = useState('')
  const [acceptBusy, setAcceptBusy] = useState(false)
  const [acceptResult, setAcceptResult] = useState(null) // { ok:true, referral } | { ok:false, msg }
  const [referralFilter, setReferralFilter] = useState('all') // all|created|confirmed|expired

  const a = api(adminToken)

  useEffect(() => { loadStats(); loadClinics(); loadServices() }, [])
  useEffect(() => {
    if (tab === 'referrals') loadReferrals()
    if (tab === 'bonuses')   loadBonuses()
    if (tab === 'doctors')   loadDoctors()
    if (tab === 'visiting')  loadVisiting()
  }, [tab])

  // ─── Загрузка внешних врачей (только справочно) ───
  async function loadDoctors() {
    try {
      const [docRes, reqRes] = await Promise.all([
        a.get('/admins/external-doctors').catch(() => ({ data:[] })),
        a.get('/admins/doctor-requests').catch(() => ({ data:[] })),
      ])
      setExternalDoctors(Array.isArray(docRes.data) ? docRes.data : [])
      setDoctorRequests(Array.isArray(reqRes.data) ? reqRes.data : [])
    } catch {}
  }

  // ─── Приезжие врачи: расписание + записи ───
  async function loadVisiting() {
    setVisitingAptLoading(true)
    try {
      const [settRes, aptRes] = await Promise.all([
        a.get('/visiting/admin/settings').catch(() => ({ data:[] })),
        a.get('/visiting/admin/all-appointments').catch(() => ({ data:[] })),
      ])
      const settings = Array.isArray(settRes.data) ? settRes.data : []
      setVisitingSettings(settings)
      setVisitingDoctors(settings.filter((s, i, arr) => arr.findIndex(x => x.doctor_id === s.doctor_id) === i))
      setVisitingApts(Array.isArray(aptRes.data) ? aptRes.data : [])
    } catch {}
    setVisitingAptLoading(false)
  }

  async function saveBookVisit(e) {
    e.preventDefault(); setBookVisitSaving(true); setBookVisitMsg('')
    try {
      const r = await a.post('/visiting/admin/book-appointment', {
        doctor_user_id: bookVisitDoc.doctor_id,
        patient_name: bookVisitForm.patient_name,
        patient_phone: bookVisitForm.patient_phone,
        appointment_date: bookVisitForm.appointment_date,
        start_time: bookVisitForm.start_time,
        end_time: bookVisitForm.end_time,
        price: bookVisitForm.price ? parseFloat(bookVisitForm.price) : null,
      })
      setBookVisitResult(r.data)
      setBookVisitMsg('Запись создана')
      loadVisiting()
    } catch(e) { setBookVisitMsg('Ошибка: ' + (e?.response?.data?.detail || 'не удалось')) }
    setBookVisitSaving(false)
  }

  // ─── KPI: сегодняшние направления + баланс бонусов ───
  async function loadStats() {
    try {
      const [todayRes, balRes] = await Promise.all([
        a.get('/referrals/', { status:'all', limit:200 }).catch(() => ({ data:[] })),
        a.get('/bonuses/balance').catch(() => ({ data:{ balance:0 } })),
      ])
      const today = new Date().toDateString()
      const allRefs = Array.isArray(todayRes.data) ? todayRes.data : []
      const todayRefs = allRefs.filter(r => new Date(r.created_at).toDateString() === today)
      // Динамика по 7 последним дням (для sparkline)
      const series = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0)
        const ds = d.toDateString()
        series.push(allRefs.filter(r => new Date(r.created_at).toDateString() === ds).length)
      }
      setStats({
        today_count: todayRefs.length,
        balance: balRes.data?.balance || 0,
        confirmed_today: todayRefs.filter(r => r.status === 'confirmed').length,
        completed_today: todayRefs.filter(r => r.status === 'confirmed').length,
        series,
      })
    } catch {}
  }

  async function loadReferrals() {
    setLoading(true)
    try {
      const res = await a.get('/referrals/', { limit:100 })
      setReferrals(Array.isArray(res.data) ? res.data : [])
    } catch { setError('Не удалось загрузить направления') }
    setLoading(false)
  }

  async function loadBonuses() {
    setLoading(true)
    try {
      const res = await a.get('/bonuses/')
      setBonuses(Array.isArray(res.data) ? res.data : [])
    } catch { setError('Не удалось загрузить бонусы') }
    setLoading(false)
  }

  async function loadClinics() {
    try { const res = await a.get('/clinics/'); setClinics(Array.isArray(res.data) ? res.data : []) } catch {}
  }

  async function loadServices() {
    try { const res = await a.get('/services/'); setServices(Array.isArray(res.data) ? res.data : []) } catch {}
  }

  async function createReferral(e) {
    e.preventDefault()
    if (!form.to_clinic_id || !form.service_id || !form.patient_phone) return
    setLoading(true); setError('')
    try {
      const res = await a.post('/referrals/', { to_clinic_id:form.to_clinic_id, service_id:form.service_id, patient_phone:form.patient_phone, patient_name:form.patient_name, notes:form.notes })
      setCreatedRef(res.data)
      setForm({ to_clinic_id:'', service_id:'', patient_phone:'', patient_name:'', notes:'' })
      loadStats() // обновим KPI
    } catch(err) { setError(err?.response?.data?.detail || 'Ошибка создания направления') }
    setLoading(false)
  }

  // ─── Принять пациента: подтверждение по 5-значному коду ───
  async function submitAccept(e) {
    e?.preventDefault()
    if (!acceptCode || acceptCode.length < 4) return
    setAcceptBusy(true); setAcceptResult(null)
    try {
      const r = await a.post('/referrals/confirm-by-code', { short_code: parseInt(acceptCode, 10) })
      setAcceptResult({ ok: true, referral: r.data })
      setAcceptCode('')
      loadStats()
      if (tab === 'referrals') loadReferrals()
    } catch (err) {
      setAcceptResult({ ok: false, msg: err?.response?.data?.detail || 'Код не найден' })
    }
    setAcceptBusy(false)
  }

  // ─── Премиум-чип статуса направления ───
  const statusChip = (s) => {
    if (s === 'confirmed') return <Chip variant="good" dot>Завершено</Chip>
    if (s === 'created')   return <Chip variant="accent" dot>Активно</Chip>
    if (s === 'expired')   return <Chip variant="bad" dot>Истекло</Chip>
    return <Chip variant="default" dot>{s}</Chip>
  }

  const roleLabel = ROLE_LABELS[user.role] || user.role
  const roleIcon  = ROLE_ICONS[user.role]  || 'admin_panel_settings'
  const isReg = user?.role === 'reg'

  // ─── Пункты «Ещё»: nurse не видит брендинг/CMS/акты ───
  const moreItems = [
    { key:'bonuses',  label:'Бонусы',   icon:'payments'   },
    { key:'doctors',  label:'Врачи',    icon:'people'     },
    ...(isReg ? [
      { key:'branding', label:'Брендинг',icon:'palette' },
      { key:'cms',      label:'CMS',     icon:'article' },
      { key:'acts',     label:'Акты',    icon:'receipt' },
    ] : []),
  ]

  // ─── Bottom nav (для reg есть «Запись», для nurse — Приезжие) ───
  const navItems = isReg ? [
    { key:'dashboard', label:'Главная',     icon:'dashboard'   },
    { key:'create',    label:'Создать',     icon:'add_circle'  },
    { key:'referrals', label:'Направления', icon:'list_alt'    },
    { key:'visiting',  label:'Запись',      icon:'event_available' },
  ] : [
    { key:'dashboard', label:'Главная',     icon:'dashboard'   },
    { key:'create',    label:'Создать',     icon:'add_circle'  },
    { key:'referrals', label:'Направления', icon:'list_alt'    },
    { key:'bonuses',   label:'Бонусы',      icon:'payments'    },
  ]

  // ─── Фильтрация направлений ───
  const filteredReferrals = referrals.filter(r => {
    if (referralFilter === 'all') return true
    return r.status === referralFilter
  })

  return (
    <Page theme="light" className="ks-reg">
      {/* Premium cyan accent override */}
      <style>{TEAL_ACCENT}</style>
      <style>{`
        .ks-reg { padding-bottom: 96px; }
        .ks-glass {
          background: oklch(1 0 0 / 0.72);
          backdrop-filter: saturate(140%) blur(20px);
          -webkit-backdrop-filter: saturate(140%) blur(20px);
          border: 1px solid var(--border);
        }
        .ks-hero {
          position: relative;
          overflow: hidden;
          border-radius: 0 0 28px 28px;
          background:
            radial-gradient(120% 100% at 0% 0%, oklch(0.62 0.12 195 / 0.18), transparent 60%),
            radial-gradient(80% 80% at 100% 0%, oklch(0.55 0.13 200 / 0.22), transparent 65%),
            linear-gradient(180deg, oklch(0.30 0.06 200) 0%, oklch(0.22 0.04 215) 100%);
          color: #fff;
        }
        .ks-hero::after {
          content: ''; position: absolute; inset: 0; pointer-events: none;
          background: radial-gradient(60% 60% at 80% 110%, oklch(1 0 0 / 0.06), transparent 70%);
        }
        .ks-input {
          width: 100%;
          padding: 12px 14px;
          font-size: 14.5px;
          background: var(--surface);
          color: var(--fg);
          border: 1px solid var(--border);
          border-radius: 12px;
          transition: border-color .12s, box-shadow .12s;
        }
        .ks-input:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
        .ks-input::placeholder { color: var(--fg-4); }
        .ks-label {
          display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
          text-transform: uppercase; color: var(--fg-3); margin-bottom: 6px;
        }
        .ks-row {
          display: flex; align-items: center; gap: 12px; padding: 12px;
          background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
          transition: transform .1s, border-color .12s, box-shadow .12s;
        }
        .ks-row:active { transform: scale(0.99); }
        .ks-row:hover { border-color: var(--accent-line); }
        .ks-pill-btn {
          min-height: 48px; padding: 0 18px; border-radius: 14px;
          font-weight: 600; font-size: 14px;
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #fff;
          box-shadow: 0 1px 0 oklch(1 0 0 / 0.15) inset, 0 8px 22px oklch(0.55 0.13 200 / 0.30);
          transition: transform .08s;
        }
        .ks-pill-btn:active { transform: translateY(1px) scale(0.98); }
        .ks-pill-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .ks-pill-btn-secondary {
          min-height: 48px; padding: 0 18px; border-radius: 14px;
          font-weight: 600; font-size: 14px;
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          background: var(--surface); color: var(--fg);
          border: 1px solid var(--border);
        }
        .ks-pill-btn-secondary:active { transform: translateY(1px); }
        .ks-bottom-nav {
          position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
          padding-bottom: env(safe-area-inset-bottom);
          background: oklch(1 0 0 / 0.85);
          backdrop-filter: saturate(180%) blur(24px);
          -webkit-backdrop-filter: saturate(180%) blur(24px);
          border-top: 1px solid var(--border);
        }
        .ks-sheet-back { position: fixed; inset: 0; background: oklch(0.18 0.014 220 / 0.55); z-index: 60; backdrop-filter: blur(2px); }
        .ks-sheet {
          position: fixed; left: 0; right: 0; bottom: 0; z-index: 60;
          background: var(--surface); border-radius: 24px 24px 0 0;
          padding-bottom: calc(24px + env(safe-area-inset-bottom));
          max-height: 92vh; overflow-y: auto;
          box-shadow: 0 -24px 60px oklch(0.18 0.014 220 / 0.18);
        }
        .ks-sheet-grip { width: 44px; height: 4px; border-radius: 999px; background: var(--bg-3); margin: 12px auto 6px; }
        .ks-code-input {
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.4em;
          text-align: center;
          font-weight: 700;
          font-size: 28px;
          padding: 18px 12px;
          border-radius: 16px;
          border: 2px solid var(--border);
          background: var(--bg-1);
          color: var(--fg);
          width: 100%;
        }
        .ks-code-input:focus { outline: 0; border-color: var(--accent); background: var(--surface); }
        .ks-spinner {
          width: 28px; height: 28px; border-radius: 50%;
          border: 3px solid var(--accent-soft);
          border-top-color: var(--accent);
          animation: ks-spin 0.7s linear infinite;
        }
        @keyframes ks-spin { to { transform: rotate(360deg); } }
        .ks-skeleton {
          background: linear-gradient(90deg, var(--bg-1) 0%, var(--bg-2) 50%, var(--bg-1) 100%);
          background-size: 200% 100%;
          animation: ks-shimmer 1.4s infinite;
          border-radius: 14px;
        }
        @keyframes ks-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .ks-fab-accept {
          position: relative;
          width: 100%;
          padding: 22px 20px;
          border-radius: 20px;
          background:
            radial-gradient(140% 100% at 0% 0%, oklch(0.62 0.12 195 / 0.30), transparent 60%),
            linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #fff;
          display: flex; align-items: center; gap: 16px;
          box-shadow: 0 1px 0 oklch(1 0 0 / 0.15) inset, 0 14px 32px oklch(0.55 0.13 200 / 0.34);
          text-align: left;
        }
        .ks-fab-accept:active { transform: translateY(1px) scale(0.99); }
      `}</style>

      {/* ─── Hero / Topbar ─── */}
      <div className="ks-hero px-4 pt-12 pb-6 sm:px-6">
        <div className="flex items-center gap-3 max-w-3xl mx-auto">
          <div
            className="grid place-items-center rounded-2xl"
            style={{
              width: 48, height: 48,
              background: 'oklch(1 0 0 / 0.14)',
              border: '1px solid oklch(1 0 0 / 0.20)',
              backdropFilter: 'blur(10px)',
            }}
          >
            <Icon name={roleIcon} size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-[15px] truncate">{user.full_name || 'Кабинет'}</p>
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold"
                style={{ background: 'oklch(1 0 0 / 0.16)', color: '#fff' }}
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'oklch(0.7 0.18 145)' }} />
                {roleLabel}
              </span>
            </div>
            <p className="text-[12px]" style={{ color: 'oklch(1 0 0 / 0.7)' }}>
              {clinics.length > 0 ? `${clinics.length} клиник доступно` : 'КлиникСеть'}
            </p>
          </div>
          <button
            onClick={onLogout}
            aria-label="Выйти"
            className="grid place-items-center rounded-xl"
            style={{
              width: 44, height: 44,
              background: 'oklch(1 0 0 / 0.10)',
              border: '1px solid oklch(1 0 0 / 0.18)',
              color: '#fff',
            }}
          >
            <Icon name="logout" size={20} />
          </button>
        </div>

        {/* Hero KPI mini-row (компактно, для топа) */}
        <div className="max-w-3xl mx-auto mt-5 grid grid-cols-3 gap-3">
          {[
            { label: 'Сегодня',    value: stats?.today_count ?? '—',     icon: 'event_note' },
            { label: 'Завершено',  value: stats?.confirmed_today ?? '—', icon: 'check_circle' },
            { label: 'Бонусы',     value: stats ? fmtMoney(stats.balance) : '—', icon: 'payments' },
          ].map(c => (
            <div
              key={c.label}
              className="rounded-2xl px-3 py-3"
              style={{
                background: 'oklch(1 0 0 / 0.10)',
                border: '1px solid oklch(1 0 0 / 0.16)',
                backdropFilter: 'blur(10px)',
              }}
            >
              <div className="flex items-center gap-1.5" style={{ color: 'oklch(1 0 0 / 0.78)' }}>
                <Icon name={c.icon} size={14} fill={1} />
                <span className="text-[10.5px] font-semibold uppercase tracking-wider">{c.label}</span>
              </div>
              <div className="mt-1 text-[18px] font-bold tabular-nums" style={{ letterSpacing: '-0.02em' }}>{c.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Контент ─── */}
      <div className="px-4 sm:px-6 pt-5 max-w-3xl mx-auto">
        {error && (
          <div
            className="mb-4 flex items-start justify-between gap-2 rounded-2xl px-4 py-3 text-sm"
            style={{ background: 'var(--bad-soft)', color: 'var(--bad)', border: '1px solid var(--bad-soft)' }}
            role="alert"
          >
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="Закрыть" className="opacity-70 hover:opacity-100">
              <Icon name="close" size={18} />
            </button>
          </div>
        )}

        {/* ───── ГЛАВНАЯ ───── */}
        {tab === 'dashboard' && (
          <div className="space-y-4">
            {/* CTA: Принять пациента (premium) */}
            <button
              onClick={() => { setAcceptOpen(true); setAcceptResult(null); setAcceptCode('') }}
              className="ks-fab-accept"
            >
              <div className="grid place-items-center rounded-2xl flex-shrink-0"
                   style={{ width: 56, height: 56, background: 'oklch(1 0 0 / 0.18)', border: '1px solid oklch(1 0 0 / 0.22)' }}>
                <Icon name="qr_code_scanner" size={28} fill={1} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[17px] font-bold leading-tight">Принять пациента</div>
                <div className="text-[12.5px] mt-0.5" style={{ color: 'oklch(1 0 0 / 0.78)' }}>
                  QR · код · поиск по телефону
                </div>
              </div>
              <Icon name="arrow_forward" size={22} />
            </button>

            {/* KPI с динамикой */}
            <Card padded={false} className="overflow-hidden">
              <div className="px-5 pt-5 pb-2 flex items-center justify-between">
                <div>
                  <div className="text-[15px] font-semibold" style={{ letterSpacing: '-0.01em' }}>Активность</div>
                  <div className="text-[12px]" style={{ color: 'var(--fg-3)' }}>За последние 7 дней</div>
                </div>
                {stats?.series && stats.series.some(v => v > 0) && (
                  <Sparkline data={stats.series} width={120} height={40} />
                )}
              </div>
              <div className="px-3 pb-3 pt-2 grid grid-cols-2 gap-2">
                {stats ? (
                  <>
                    <KpiCard
                      label="Направлений сегодня"
                      value={stats.today_count}
                      icon={<Icon name="receipt_long" size={16} />}
                      delta={stats.series?.length ? `${stats.series.reduce((a, b) => a + b, 0)} за неделю` : ''}
                      trend="flat"
                    />
                    <KpiCard
                      label="Завершено приёмов"
                      value={stats.confirmed_today}
                      icon={<Icon name="task_alt" size={16} />}
                      delta={stats.today_count > 0 ? `${Math.round(stats.confirmed_today / stats.today_count * 100)}%` : '—'}
                      trend="up"
                    />
                  </>
                ) : (
                  <>
                    <div className="ks-skeleton h-[88px]" />
                    <div className="ks-skeleton h-[88px]" />
                  </>
                )}
              </div>
            </Card>

            {/* Быстрые действия (большие тач-кнопки) */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setTab('create')}
                className="text-left p-4 rounded-2xl"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  boxShadow: 'var(--shadow-sm)',
                  minHeight: 112,
                }}
              >
                <div className="grid place-items-center rounded-xl mb-3"
                     style={{
                       width: 44, height: 44,
                       background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
                       boxShadow: '0 6px 16px oklch(0.55 0.13 200 / 0.25)',
                     }}>
                  <Icon name="add_circle" size={22} fill={1} style={{ color: '#fff' }} />
                </div>
                <div className="text-[14px] font-semibold" style={{ color: 'var(--fg)' }}>Создать направление</div>
                <div className="text-[12px]" style={{ color: 'var(--fg-3)' }}>Услуга + клиника</div>
              </button>

              {isReg ? (
                <button
                  onClick={() => setTab('visiting')}
                  className="text-left p-4 rounded-2xl"
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    boxShadow: 'var(--shadow-sm)',
                    minHeight: 112,
                  }}
                >
                  <div className="grid place-items-center rounded-xl mb-3"
                       style={{
                         width: 44, height: 44,
                         background: 'linear-gradient(135deg, oklch(0.62 0.13 75), oklch(0.58 0.14 50))',
                         boxShadow: '0 6px 16px oklch(0.62 0.13 75 / 0.25)',
                       }}>
                    <Icon name="event_available" size={22} fill={1} style={{ color: '#fff' }} />
                  </div>
                  <div className="text-[14px] font-semibold" style={{ color: 'var(--fg)' }}>Запись к врачу</div>
                  <div className="text-[12px]" style={{ color: 'var(--fg-3)' }}>Свободные слоты</div>
                </button>
              ) : (
                <button
                  onClick={() => setTab('referrals')}
                  className="text-left p-4 rounded-2xl"
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    boxShadow: 'var(--shadow-sm)',
                    minHeight: 112,
                  }}
                >
                  <div className="grid place-items-center rounded-xl mb-3"
                       style={{
                         width: 44, height: 44,
                         background: 'linear-gradient(135deg, oklch(0.55 0.16 280), oklch(0.50 0.18 260))',
                         boxShadow: '0 6px 16px oklch(0.55 0.16 280 / 0.22)',
                       }}>
                    <Icon name="list_alt" size={22} fill={1} style={{ color: '#fff' }} />
                  </div>
                  <div className="text-[14px] font-semibold" style={{ color: 'var(--fg)' }}>Мои направления</div>
                  <div className="text-[12px]" style={{ color: 'var(--fg-3)' }}>История и статусы</div>
                </button>
              )}
            </div>

            {/* Последние направления (preview 3 шт.) */}
            {referrals.length > 0 && (
              <Card>
                <Card.Header>
                  <Card.Title>Последние направления</Card.Title>
                  <button
                    onClick={() => setTab('referrals')}
                    className="text-[12.5px] font-semibold"
                    style={{ color: 'var(--accent)' }}
                  >
                    Все →
                  </button>
                </Card.Header>
                <div className="space-y-2">
                  {referrals.slice(0, 3).map(r => (
                    <div key={r.id} className="ks-row">
                      <div className="grid place-items-center rounded-xl flex-shrink-0"
                           style={{ width: 38, height: 38, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                        <Icon name="receipt_long" size={18} fill={1} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--fg)' }}>
                          {r.patient_name || r.patient_phone}
                        </div>
                        <div className="text-[11.5px] truncate" style={{ color: 'var(--fg-3)' }}>
                          {r.service_name}
                        </div>
                      </div>
                      {statusChip(r.status)}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ───── СОЗДАТЬ НАПРАВЛЕНИЕ ───── */}
        {tab === 'create' && (
          <div className="space-y-4">
            {createdRef ? (
              <Card>
                <div className="text-center">
                  <div
                    className="grid place-items-center rounded-2xl mx-auto mb-3"
                    style={{
                      width: 64, height: 64,
                      background: 'var(--good-soft)',
                      color: 'var(--good)',
                    }}
                  >
                    <Icon name="check_circle" size={36} fill={1} />
                  </div>
                  <div className="text-[16px] font-bold" style={{ color: 'var(--fg)', letterSpacing: '-0.01em' }}>
                    Направление создано
                  </div>
                  <div className="text-[12.5px] mt-1" style={{ color: 'var(--fg-3)' }}>
                    Сообщите код пациенту
                  </div>

                  <div
                    className="mt-4 rounded-2xl p-5"
                    style={{
                      background: 'var(--accent-soft)',
                      border: '1px solid var(--accent-line)',
                    }}
                  >
                    <div className="text-[10.5px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
                      Код направления
                    </div>
                    <div
                      className="mt-2 font-black tabular-nums"
                      style={{ fontSize: 38, letterSpacing: '0.16em', color: 'var(--accent)' }}
                    >
                      {createdRef.short_code}
                    </div>
                  </div>

                  {createdRef.qr_code && (
                    <img
                      src={'data:image/png;base64,' + createdRef.qr_code}
                      alt="QR направления"
                      className="mx-auto mt-4 rounded-2xl"
                      style={{
                        width: 180, height: 180,
                        background: '#fff',
                        padding: 10,
                        border: '1px solid var(--border)',
                      }}
                    />
                  )}

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <button onClick={() => setCreatedRef(null)} className="ks-pill-btn-secondary">
                      <Icon name="add" size={18} /> Ещё одно
                    </button>
                    <button onClick={() => setTab('referrals')} className="ks-pill-btn">
                      <Icon name="list_alt" size={18} fill={1} /> К списку
                    </button>
                  </div>
                </div>
              </Card>
            ) : (
              <Card>
                <Card.Header>
                  <div>
                    <Card.Title>Новое направление</Card.Title>
                    <Card.Subtitle>Заполните данные пациента и услугу</Card.Subtitle>
                  </div>
                </Card.Header>
                <form onSubmit={createReferral} className="space-y-4">
                  <div>
                    <label className="ks-label">Клиника назначения *</label>
                    <select
                      value={form.to_clinic_id}
                      onChange={e => setForm(p => ({ ...p, to_clinic_id: e.target.value }))}
                      required
                      className="ks-input"
                    >
                      <option value="">Выбрать клинику…</option>
                      {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="ks-label">Услуга *</label>
                    <select
                      value={form.service_id}
                      onChange={e => setForm(p => ({ ...p, service_id: e.target.value }))}
                      required
                      className="ks-input"
                    >
                      <option value="">Выбрать услугу…</option>
                      {services.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}{s.bonus_amount > 0 ? ` (+${s.bonus_amount} ₽)` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="ks-label">Телефон пациента *</label>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={form.patient_phone}
                      onChange={e => setForm(p => ({ ...p, patient_phone: e.target.value }))}
                      placeholder="+7…"
                      required
                      className="ks-input"
                    />
                  </div>
                  <div>
                    <label className="ks-label">ФИО пациента</label>
                    <input
                      value={form.patient_name}
                      onChange={e => setForm(p => ({ ...p, patient_name: e.target.value }))}
                      placeholder="Необязательно"
                      className="ks-input"
                    />
                  </div>
                  <div>
                    <label className="ks-label">Примечание</label>
                    <textarea
                      value={form.notes}
                      onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                      rows={2}
                      placeholder="Необязательно"
                      className="ks-input"
                      style={{ resize: 'none' }}
                    />
                  </div>
                  <button type="submit" disabled={loading} className="ks-pill-btn w-full">
                    {loading
                      ? <><div className="ks-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Создаём…</>
                      : <><Icon name="add_circle" size={20} fill={1} /> Создать направление</>
                    }
                  </button>
                </form>
              </Card>
            )}
          </div>
        )}

        {/* ───── НАПРАВЛЕНИЯ ───── */}
        {tab === 'referrals' && (
          <div className="space-y-3">
            {/* Фильтр-чипы */}
            <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
              {[
                { k: 'all',       l: 'Все' },
                { k: 'created',   l: 'Активные' },
                { k: 'confirmed', l: 'Завершённые' },
                { k: 'expired',   l: 'Просроченные' },
              ].map(f => {
                const active = referralFilter === f.k
                return (
                  <button
                    key={f.k}
                    onClick={() => setReferralFilter(f.k)}
                    className="rounded-full text-[12.5px] font-semibold whitespace-nowrap transition-colors"
                    style={{
                      padding: '8px 14px',
                      background: active ? 'var(--accent)' : 'var(--surface)',
                      color: active ? '#fff' : 'var(--fg-2)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      boxShadow: active ? '0 4px 12px oklch(0.55 0.13 200 / 0.22)' : 'none',
                    }}
                  >
                    {f.l}
                  </button>
                )
              })}
            </div>

            {loading ? (
              <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="ks-skeleton h-[78px]" />)}</div>
            ) : filteredReferrals.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<Icon name="receipt_long" size={28} />}
                  title={referrals.length === 0 ? 'Направлений ещё нет' : 'Ничего не найдено'}
                  message={referrals.length === 0 ? 'Создайте первое направление пациенту' : 'Поменяйте фильтр'}
                  action={
                    <Button variant="primary" onClick={() => setTab('create')}>
                      Создать направление
                    </Button>
                  }
                />
              </Card>
            ) : (
              filteredReferrals.map(r => (
                <div key={r.id} className="ks-row" style={{ alignItems: 'flex-start' }}>
                  <div className="grid place-items-center rounded-xl flex-shrink-0"
                       style={{
                         width: 44, height: 44,
                         background: r.status === 'confirmed' ? 'var(--good-soft)' :
                                     r.status === 'expired' ? 'var(--bad-soft)' : 'var(--accent-soft)',
                         color: r.status === 'confirmed' ? 'var(--good)' :
                                r.status === 'expired' ? 'var(--bad)' : 'var(--accent)',
                       }}>
                    <Icon
                      name={r.status === 'confirmed' ? 'check_circle' : r.status === 'expired' ? 'schedule' : 'receipt_long'}
                      size={22} fill={1}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[14px] font-semibold truncate" style={{ color: 'var(--fg)' }}>
                          {r.patient_name || r.patient_phone}
                        </div>
                        <div className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--fg-3)' }}>
                          {r.service_name} → {r.to_clinic_name}
                        </div>
                      </div>
                      {statusChip(r.status)}
                    </div>
                    <div className="flex items-center justify-between mt-2 gap-2">
                      <div className="text-[11px]" style={{ color: 'var(--fg-4)' }}>{fmtDate(r.created_at)}</div>
                      {r.short_code && (
                        <div
                          className="font-mono text-[11.5px] tabular-nums px-2 py-0.5 rounded-md"
                          style={{ background: 'var(--bg-2)', color: 'var(--fg-2)', letterSpacing: '0.1em' }}
                        >
                          {r.short_code}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ───── ПРИЕЗЖИЕ ВРАЧИ / ЗАПИСЬ К ВРАЧУ ───── */}
        {tab === 'visiting' && (
          <div className="space-y-4">
            {visitingAptLoading ? (
              <div className="flex justify-center py-10"><div className="ks-spinner" /></div>
            ) : (
              <>
                {/* Список врачей */}
                <Card>
                  <Card.Header>
                    <div>
                      <Card.Title>{isReg ? 'Запись к врачу' : 'Приезжие врачи'}</Card.Title>
                      <Card.Subtitle>
                        {visitingDoctors.length > 0 ? `${visitingDoctors.length} ${visitingDoctors.length === 1 ? 'врач' : 'врачей'}` : 'Сейчас никого нет'}
                      </Card.Subtitle>
                    </div>
                  </Card.Header>
                  {visitingDoctors.length === 0 ? (
                    <EmptyState
                      icon={<Icon name="stethoscope" size={28} />}
                      title="Нет приезжих врачей"
                      message="Здесь появятся врачи с активным расписанием"
                    />
                  ) : (
                    <div className="space-y-2">
                      {visitingDoctors.map(doc => (
                        <div key={doc.doctor_id} className="ks-row">
                          <Avatar name={doc.doctor_name} size="lg" />
                          <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-semibold truncate" style={{ color: 'var(--fg)' }}>
                              {doc.doctor_name}
                            </div>
                            <div className="text-[12px] truncate" style={{ color: 'var(--fg-3)' }}>
                              {doc.clinic_name || 'Клиника не указана'}
                            </div>
                          </div>
                          {isReg && (
                            <button
                              onClick={() => {
                                setBookVisitDoc(doc)
                                setBookVisitForm({ patient_name:'', patient_phone:'', appointment_date:'', start_time:'09:00', end_time:'09:30', price:'' })
                                setBookVisitResult(null); setBookVisitMsg('')
                              }}
                              className="ks-pill-btn"
                              style={{ minHeight: 40, padding: '0 14px', fontSize: 13 }}
                            >
                              Записать
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                {/* Записи */}
                {visitingApts.length > 0 && (
                  <Card>
                    <Card.Header>
                      <Card.Title>Записи на приём</Card.Title>
                      <Chip variant="default">{visitingApts.length}</Chip>
                    </Card.Header>
                    <div className="space-y-2">
                      {visitingApts.slice(0, 12).map(apt => (
                        <div key={apt.id} className="ks-row">
                          <div
                            className="grid place-items-center rounded-xl flex-shrink-0"
                            style={{
                              width: 56, height: 56,
                              background: 'var(--accent-soft)',
                              color: 'var(--accent)',
                            }}
                          >
                            <div className="text-[15px] font-bold tabular-nums leading-none">{apt.start_time?.slice(0,5)}</div>
                            <div className="text-[10px] font-semibold mt-0.5">{apt.appointment_date?.slice(5)}</div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--fg)' }}>
                              {apt.patient_name || apt.patient_phone}
                            </div>
                            <div className="text-[11.5px] truncate" style={{ color: 'var(--fg-3)' }}>
                              {apt.doctor_name}
                            </div>
                          </div>
                          {apt.status === 'completed'
                            ? <Chip variant="good" dot>Принят</Chip>
                            : <Chip variant="accent" dot>Ожидает</Chip>}
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </>
            )}
          </div>
        )}

        {/* ───── БОНУСЫ ───── */}
        {tab === 'bonuses' && (
          <div className="space-y-4">
            <Card>
              <div className="text-center py-2">
                <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-3)' }}>
                  Баланс бонусов
                </div>
                <div
                  className="mt-2 font-black tabular-nums"
                  style={{ fontSize: 36, letterSpacing: '-0.02em', color: 'var(--accent)' }}
                >
                  {fmtMoney(stats?.balance || 0)}
                </div>
                <div className="text-[12px] mt-1" style={{ color: 'var(--fg-3)' }}>
                  Доступно к выплате
                </div>
              </div>
            </Card>

            <div className="px-1">
              <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--fg-3)' }}>
                История начислений
              </div>
            </div>

            {loading ? (
              <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="ks-skeleton h-[68px]" />)}</div>
            ) : bonuses.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<Icon name="payments" size={28} />}
                  title="Пока нет начислений"
                  message="Бонусы появятся после завершения направлений"
                />
              </Card>
            ) : (
              <div className="space-y-2">
                {bonuses.map(b => (
                  <div key={b.id} className="ks-row">
                    <div className="grid place-items-center rounded-xl flex-shrink-0"
                         style={{ width: 40, height: 40, background: 'oklch(0.62 0.13 75 / 0.10)', color: 'oklch(0.62 0.13 75)' }}>
                      <Icon name="payments" size={20} fill={1} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold tabular-nums" style={{ color: 'var(--fg)' }}>
                        +{fmtMoney(b.amount)}
                      </div>
                      <div className="text-[11.5px]" style={{ color: 'var(--fg-3)' }}>{fmtDate(b.created_at)}</div>
                    </div>
                    {b.status === 'paid' ? <Chip variant="good" dot>Выплачен</Chip> : <Chip variant="warn" dot>Начислен</Chip>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ───── ВРАЧИ (внешние) ───── */}
        {tab === 'doctors' && (
          <div className="space-y-3">
            {externalDoctors.length === 0 && doctorRequests.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<Icon name="people" size={28} />}
                  title="Нет внешних врачей"
                  message="Здесь будут отображаться приглашённые специалисты"
                />
              </Card>
            ) : (
              <>
                {doctorRequests.length > 0 && (
                  <div>
                    <div className="px-1 mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--fg-3)' }}>
                      Запросы на одобрение
                    </div>
                    <div className="space-y-2">
                      {doctorRequests.map(r => (
                        <div key={r.id} className="ks-row">
                          <div className="grid place-items-center rounded-xl flex-shrink-0"
                               style={{ width: 40, height: 40, background: 'var(--warn-soft)', color: 'var(--warn)' }}>
                            <Icon name="hourglass_top" size={20} fill={1} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-semibold truncate" style={{ color: 'var(--fg)' }}>{r.full_name}</div>
                            <div className="text-[11.5px]" style={{ color: 'var(--fg-3)' }}>
                              {r.role} · {fmtDate(r.created_at)}
                            </div>
                          </div>
                          <Chip variant="warn" dot>На рассмотрении</Chip>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {externalDoctors.length > 0 && (
                  <div>
                    <div className="px-1 mt-3 mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--fg-3)' }}>
                      Активные врачи
                    </div>
                    <div className="space-y-2">
                      {externalDoctors.map(d => (
                        <div key={d.id} className="ks-row">
                          <Avatar name={d.full_name} size="lg" />
                          <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-semibold truncate" style={{ color: 'var(--fg)' }}>{d.full_name}</div>
                            <div className="text-[11.5px]" style={{ color: 'var(--fg-3)' }}>{d.specialization || d.role}</div>
                          </div>
                          {d.is_active
                            ? <Chip variant="good" dot>Активен</Chip>
                            : <Chip variant="default" dot>Неактивен</Chip>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ───── ADMIN-ONLY (брендинг/CMS/акты) ───── */}
        {tab === 'branding' && isReg && (
          <Suspense fallback={<div className="flex justify-center py-10"><div className="ks-spinner" /></div>}>
            <BrandingSection token={adminToken} />
          </Suspense>
        )}
        {tab === 'cms' && isReg && (
          <Suspense fallback={<div className="flex justify-center py-10"><div className="ks-spinner" /></div>}>
            <CMSPagesSection token={adminToken} />
          </Suspense>
        )}
        {tab === 'acts' && isReg && (
          <Suspense fallback={<div className="flex justify-center py-10"><div className="ks-spinner" /></div>}>
            <ActsSection token={adminToken} />
          </Suspense>
        )}
      </div>

      {/* ───── BOTTOM NAV ───── */}
      <nav className="ks-bottom-nav">
        <div className="max-w-3xl mx-auto flex">
          {navItems.map(item => {
            const active = tab === item.key
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 relative"
                style={{ minHeight: 60, paddingTop: 8, paddingBottom: 6 }}
                aria-current={active ? 'page' : undefined}
              >
                {active && (
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 rounded-full"
                    style={{ width: 28, height: 3, background: 'var(--accent)' }}
                  />
                )}
                <Icon
                  name={item.icon}
                  size={24}
                  fill={active ? 1 : 0}
                  style={{ color: active ? 'var(--accent)' : 'var(--fg-3)' }}
                />
                <span
                  className="text-[10.5px] font-semibold"
                  style={{ color: active ? 'var(--accent)' : 'var(--fg-3)' }}
                >
                  {item.label}
                </span>
              </button>
            )
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 relative"
            style={{ minHeight: 60, paddingTop: 8, paddingBottom: 6 }}
          >
            {moreItems.some(m => m.key === tab) && (
              <span
                className="absolute top-0 left-1/2 -translate-x-1/2 rounded-full"
                style={{ width: 28, height: 3, background: 'var(--accent)' }}
              />
            )}
            <Icon
              name="more_horiz"
              size={24}
              fill={moreItems.some(m => m.key === tab) ? 1 : 0}
              style={{ color: moreItems.some(m => m.key === tab) ? 'var(--accent)' : 'var(--fg-3)' }}
            />
            <span
              className="text-[10.5px] font-semibold"
              style={{ color: moreItems.some(m => m.key === tab) ? 'var(--accent)' : 'var(--fg-3)' }}
            >
              Ещё
            </span>
          </button>
        </div>
      </nav>

      {/* ───── BOTTOM SHEET: Ещё ───── */}
      {moreOpen && (
        <>
          <div className="ks-sheet-back" onClick={() => setMoreOpen(false)} />
          <div className="ks-sheet">
            <div className="ks-sheet-grip" />
            <div className="px-5 pb-2 pt-2 text-[13px] font-semibold" style={{ color: 'var(--fg)' }}>Дополнительно</div>
            <div className="grid grid-cols-3 gap-3 px-4 pt-3">
              {moreItems.map(item => {
                const active = tab === item.key
                return (
                  <button
                    key={item.key}
                    onClick={() => { setTab(item.key); setMoreOpen(false) }}
                    className="flex flex-col items-center gap-2 py-4 rounded-2xl"
                    style={{
                      background: active ? 'var(--accent-soft)' : 'var(--bg-1)',
                      border: `1px solid ${active ? 'var(--accent-line)' : 'var(--border)'}`,
                    }}
                  >
                    <div className="grid place-items-center rounded-xl"
                         style={{
                           width: 44, height: 44,
                           background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
                         }}>
                      <Icon name={item.icon} size={22} fill={1} style={{ color: '#fff' }} />
                    </div>
                    <span className="text-[12px] font-semibold text-center" style={{ color: 'var(--fg)' }}>
                      {item.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* ───── BOTTOM SHEET: Принять пациента ───── */}
      {acceptOpen && (
        <>
          <div className="ks-sheet-back" onClick={() => { setAcceptOpen(false); setAcceptResult(null) }} />
          <div className="ks-sheet">
            <div className="ks-sheet-grip" />
            <div className="px-5 pb-4">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-[18px] font-bold" style={{ color: 'var(--fg)', letterSpacing: '-0.01em' }}>
                  Принять пациента
                </h2>
                <button
                  onClick={() => { setAcceptOpen(false); setAcceptResult(null) }}
                  aria-label="Закрыть"
                  className="grid place-items-center rounded-xl"
                  style={{ width: 36, height: 36, background: 'var(--bg-2)', color: 'var(--fg-2)' }}
                >
                  <Icon name="close" size={20} />
                </button>
              </div>
              <p className="text-[12.5px]" style={{ color: 'var(--fg-3)' }}>
                Введите 5-значный код пациента или отсканируйте QR
              </p>

              {acceptResult?.ok ? (
                <div className="mt-5 text-center">
                  <div
                    className="grid place-items-center rounded-2xl mx-auto mb-3"
                    style={{ width: 64, height: 64, background: 'var(--good-soft)', color: 'var(--good)' }}
                  >
                    <Icon name="check_circle" size={36} fill={1} />
                  </div>
                  <div className="text-[16px] font-bold" style={{ color: 'var(--fg)' }}>Пациент принят</div>
                  <div className="text-[13px] mt-1" style={{ color: 'var(--fg-3)' }}>
                    {acceptResult.referral?.patient_name || acceptResult.referral?.patient_phone}
                  </div>
                  <div className="text-[12px] mt-0.5" style={{ color: 'var(--fg-4)' }}>
                    {acceptResult.referral?.service_name}
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <button onClick={() => setAcceptResult(null)} className="ks-pill-btn-secondary">
                      Ещё пациент
                    </button>
                    <button
                      onClick={() => { setAcceptOpen(false); setAcceptResult(null); setTab('referrals') }}
                      className="ks-pill-btn"
                    >
                      К списку
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={submitAccept} className="mt-5 space-y-4">
                  <div>
                    <label className="ks-label">Код направления</label>
                    <input
                      autoFocus
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={acceptCode}
                      onChange={e => setAcceptCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="00000"
                      className="ks-code-input"
                    />
                  </div>

                  {acceptResult && !acceptResult.ok && (
                    <div
                      className="rounded-xl px-3 py-2.5 text-[13px] flex items-center gap-2"
                      style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}
                    >
                      <Icon name="error" size={16} fill={1} />
                      {acceptResult.msg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={acceptBusy || acceptCode.length < 4}
                    className="ks-pill-btn w-full"
                  >
                    {acceptBusy
                      ? <><div className="ks-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Проверяем…</>
                      : <><Icon name="check_circle" size={20} fill={1} /> Принять</>
                    }
                  </button>

                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => { setAcceptOpen(false); setAcceptResult(null); setTab('referrals') }}
                      className="ks-pill-btn-secondary"
                    >
                      <Icon name="search" size={18} /> Поиск
                    </button>
                    <button
                      type="button"
                      onClick={() => toast('Включение камеры доступно в HTTPS-режиме. Используйте код или поиск по телефону.', 'info', 6000)}
                      className="ks-pill-btn-secondary"
                    >
                      <Icon name="qr_code_scanner" size={18} /> QR
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </>
      )}

      {/* ───── BOTTOM SHEET: Запись к приезжему врачу ───── */}
      {bookVisitDoc && (
        <>
          <div
            className="ks-sheet-back"
            onClick={() => { setBookVisitDoc(null); setBookVisitResult(null) }}
          />
          <div className="ks-sheet">
            <div className="ks-sheet-grip" />
            <div className="px-5 pb-4">
              <div className="flex items-center justify-between mb-1">
                <div className="min-w-0">
                  <h2 className="text-[17px] font-bold truncate" style={{ color: 'var(--fg)', letterSpacing: '-0.01em' }}>
                    Запись на приём
                  </h2>
                  <p className="text-[12.5px] truncate" style={{ color: 'var(--fg-3)' }}>
                    {bookVisitDoc.doctor_name}
                  </p>
                </div>
                <button
                  onClick={() => { setBookVisitDoc(null); setBookVisitResult(null) }}
                  aria-label="Закрыть"
                  className="grid place-items-center rounded-xl"
                  style={{ width: 36, height: 36, background: 'var(--bg-2)', color: 'var(--fg-2)' }}
                >
                  <Icon name="close" size={20} />
                </button>
              </div>

              {bookVisitResult ? (
                <div className="mt-4 text-center">
                  {bookVisitResult.patient_qr && (
                    <img
                      src={'data:image/png;base64,' + bookVisitResult.patient_qr}
                      alt="QR пациента"
                      className="mx-auto rounded-2xl cursor-pointer"
                      style={{ width: 180, height: 180, border: '1px solid var(--border)', padding: 10, background: '#fff' }}
                      onClick={() => bookVisitResult.patient_url && window.open(bookVisitResult.patient_url, '_blank')}
                    />
                  )}
                  {bookVisitResult.short_code && (
                    <div
                      className="mt-4 rounded-2xl p-4"
                      style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-line)' }}
                    >
                      <div className="text-[10.5px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
                        Код для пациента
                      </div>
                      <div
                        className="font-black tabular-nums mt-1"
                        style={{ fontSize: 36, letterSpacing: '0.16em', color: 'var(--accent)' }}
                      >
                        {bookVisitResult.short_code}
                      </div>
                    </div>
                  )}
                  {bookVisitResult.patient_url && (
                    <a
                      href={bookVisitResult.patient_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block mt-3 text-[12.5px] font-semibold"
                      style={{ color: 'var(--accent)' }}
                    >
                      Открыть кабинет пациента →
                    </a>
                  )}
                  <button
                    onClick={() => { setBookVisitDoc(null); setBookVisitResult(null) }}
                    className="ks-pill-btn w-full mt-5"
                  >
                    Готово
                  </button>
                </div>
              ) : (
                <form onSubmit={saveBookVisit} className="mt-4 space-y-3">
                  <div>
                    <label className="ks-label">ФИО пациента</label>
                    <input
                      value={bookVisitForm.patient_name}
                      onChange={e => setBookVisitForm(p => ({ ...p, patient_name: e.target.value }))}
                      placeholder="Иванов Иван Иванович"
                      className="ks-input"
                    />
                  </div>
                  <div>
                    <label className="ks-label">Телефон *</label>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={bookVisitForm.patient_phone}
                      onChange={e => setBookVisitForm(p => ({ ...p, patient_phone: e.target.value }))}
                      placeholder="+7…"
                      required
                      className="ks-input"
                    />
                  </div>
                  <div>
                    <label className="ks-label">Дата приёма *</label>
                    <input
                      type="date"
                      value={bookVisitForm.appointment_date}
                      onChange={e => setBookVisitForm(p => ({ ...p, appointment_date: e.target.value }))}
                      required
                      className="ks-input"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="ks-label">Начало</label>
                      <input
                        type="time"
                        value={bookVisitForm.start_time}
                        onChange={e => setBookVisitForm(p => ({ ...p, start_time: e.target.value }))}
                        className="ks-input"
                      />
                    </div>
                    <div>
                      <label className="ks-label">Конец</label>
                      <input
                        type="time"
                        value={bookVisitForm.end_time}
                        onChange={e => setBookVisitForm(p => ({ ...p, end_time: e.target.value }))}
                        className="ks-input"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="ks-label">Цена ₽</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={bookVisitForm.price}
                      onChange={e => setBookVisitForm(p => ({ ...p, price: e.target.value }))}
                      placeholder="0"
                      className="ks-input"
                    />
                  </div>

                  {bookVisitMsg && (
                    <div
                      className="rounded-xl px-3 py-2.5 text-[13px]"
                      style={{
                        background: bookVisitMsg.startsWith('Ошибка') ? 'var(--bad-soft)' : 'var(--good-soft)',
                        color: bookVisitMsg.startsWith('Ошибка') ? 'var(--bad)' : 'var(--good)',
                      }}
                    >
                      {bookVisitMsg}
                    </div>
                  )}

                  <button type="submit" disabled={bookVisitSaving} className="ks-pill-btn w-full">
                    {bookVisitSaving
                      ? <><div className="ks-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Сохраняем…</>
                      : <><Icon name="event_available" size={20} fill={1} /> Создать запись</>
                    }
                  </button>
                </form>
              )}
            </div>
          </div>
        </>
      )}
    </Page>
  )
}
