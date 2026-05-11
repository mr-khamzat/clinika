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
import apiClient from '../api'
import { API_BASE, SLUG } from '../config'
import {
  Page,
  Card,
  KpiCard,
  KpiRow,
  Chip,
  Button,
  Tabs,
  Modal,
  Avatar,
  EmptyState,
  Sparkline,
  QuickActions,
  buildPatientCardActions,
  useToast,
} from '../design'

// ─── Глава 5: Регистратор скорость ───
import RegQuickBar from '../components/RegQuickBar'
import RegCommandPalette from '../components/RegCommandPalette'
import RegMobilePatientForm from '../components/RegMobilePatientForm'
import useRegHotkeys from '../hooks/useRegHotkeys'
// ─── Глава 7: Мои регламенты (читатель) ───
const RegulationsReaderSection = lazy(() => import('../sections/RegulationsReaderSection'))
// ─── Глава 9: Чат с пациентами (премиум-чат клиники) ───
const ClinicChatSection = lazy(() => import('../sections/ClinicChatSection'))

// LocalStorage-ключ «последнее напечатанное направление» — для Alt+P и Quick-bar «Печать»
const LAST_PRINT_KEY = 'reg_last_print_ref'


// ─── HTTP-клиент: единый apiClient (auto-Bearer + auto-refresh).
// Сигнатура (token) сохранена для обратной совместимости — не используется.
const api = (_token) => ({
  get:  (url, params) => apiClient.get(url, { params }),
  post: (url, data)   => apiClient.post(url, data),
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
  // ─── QR-print контекст (W4) ───
  const [qrPrint, setQrPrint] = useState(null) // { qr_code, short_code, service_name, patient_phone }

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
  const [form, setForm] = useState({
    referral_type: 'service',  // service | doctor | lab
    to_clinic_id: '', service_id: '', target_doctor_id: '', lab_tests: '',
    patient_phone: '', patient_name: '', notes: '', appointment_at: ''
  })
  // Список штатных врачей выбранной клиники (для type=doctor)
  const [referralDoctors, setReferralDoctors] = useState([])
  // Список анализов из МИС (для type=lab) с категориями
  const [labCatalog, setLabCatalog] = useState([])    // [{id, name, category, price}]
  const [labLoading, setLabLoading] = useState(false)
  const [labQuery, setLabQuery] = useState('')        // поиск
  const [labCategoryFilter, setLabCategoryFilter] = useState('')
  const [labSelectedIds, setLabSelectedIds] = useState(new Set())  // выбранные анализы
  const [misSearching, setMisSearching] = useState(false)
  const [misHint, setMisHint] = useState('')
  const [misMatches, setMisMatches] = useState([])     // найденные пациенты в МИС
  const [misMatchAccepted, setMisMatchAccepted] = useState(null) // выбранный match (mis_patient_id)
  const [misConfirmAddNew, setMisConfirmAddNew] = useState(false)
  const [createdRef, setCreatedRef] = useState(null)

  // ─── Принять пациента (premium-фишка): QR scan + short_code + поиск ───
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [acceptCode, setAcceptCode] = useState('')
  const [acceptBusy, setAcceptBusy] = useState(false)
  const [acceptResult, setAcceptResult] = useState(null) // { ok:true, referral } | { ok:false, msg }
  const [referralFilter, setReferralFilter] = useState('all') // all|created|confirmed|expired

  // ─── Глава 5: Регистратор скорость ───
  const [cmdOpen, setCmdOpen] = useState(false)
  const [quickPatientOpen, setQuickPatientOpen] = useState(false)
  const [referralListFilter, setReferralListFilter] = useState('') // строка поиска в направлениях
  const referralSearchRef = useRef(null)
  const [lastPrintRefId, setLastPrintRefId] = useState(() => {
    try { return localStorage.getItem(LAST_PRINT_KEY) || '' } catch { return '' }
  })

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
      const [todayRes, sumRes] = await Promise.all([
        a.get('/referrals/', { status:'all', limit:200 }).catch(() => ({ data:[] })),
        a.get('/bonuses/summary').catch(() => ({ data:{ total_pending:0, total_paid:0, total_referrals:0, confirmed_referrals:0 } })),
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
      const sum = sumRes.data || {}
      setStats({
        today_count: todayRefs.length,
        balance: (sum.total_pending || 0) + (sum.total_paid || 0),
        bonus_pending: sum.total_pending || 0,
        bonus_paid: sum.total_paid || 0,
        my_total_referrals: sum.total_referrals || 0,
        my_confirmed_referrals: sum.confirmed_referrals || 0,
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

  // Список штатных врачей выбранной клиники (для type=doctor)
  async function loadDoctorsForClinic(clinicId) {
    if (!clinicId) { setReferralDoctors([]); return }
    try {
      const res = await a.get('/doctors', { clinic_id: clinicId })
      setReferralDoctors(Array.isArray(res.data) ? res.data : [])
    } catch { setReferralDoctors([]) }
  }

  // Список анализов из МИС с категориями (для type=lab)
  async function loadLabCatalog(clinicId) {
    if (!clinicId) { setLabCatalog([]); return }
    setLabLoading(true)
    try {
      const res = await a.get(`/clinics/${clinicId}/services`, { lab_only: true })
      const list = Array.isArray(res.data) ? res.data : []
      // Фильтр: только лабораторные / анализы (по категории или ключевым словам)
      const labs = list.filter(s => {
        const cat = (s.category || '').toLowerCase()
        const name = (s.name || '').toLowerCase()
        return cat.includes('анализ') || cat.includes('лаборат') || cat.includes('lab')
            || name.includes('анализ') || name.includes('кровь') || name.includes('моча')
            || /оам|оак|биохим|гемогл|глюкоза|холестерин|тироид|ттг|витамин/.test(name)
      })
      setLabCatalog(labs)
    } catch { setLabCatalog([]) }
    setLabLoading(false)
  }


  async function createReferral(e) {
    e.preventDefault()
    if (!form.to_clinic_id || !form.patient_phone) return
    if (form.referral_type === 'service' && !form.service_id) { setError('Выберите услугу'); return }
    if (form.referral_type === 'doctor' && !form.target_doctor_id) { setError('Выберите врача'); return }
    if (form.referral_type === 'lab' && labSelectedIds.size === 0 && !form.lab_tests.trim()) {
      setError('Выберите анализы из списка или укажите их вручную'); return
    }
    setLoading(true); setError('')
    try {
      // Если выбраны анализы из каталога — собрать их в lab_tests текстом
      let labTextParts = []
      if (form.referral_type === 'lab') {
        labCatalog.filter(l => labSelectedIds.has(l.id)).forEach(l => labTextParts.push(l.name))
        if (form.lab_tests.trim()) labTextParts.push(form.lab_tests.trim())
      }
      const payload = {
        referral_type: form.referral_type,
        to_clinic_id: form.to_clinic_id,
        patient_phone: form.patient_phone,
        patient_name: form.patient_name || null,
        notes: form.notes || null,
        appointment_at: form.appointment_at || null,
      }
      if (form.referral_type === 'service') payload.service_id = form.service_id
      if (form.referral_type === 'doctor')  payload.target_doctor_id = form.target_doctor_id
      if (form.referral_type === 'lab')     payload.lab_tests = labTextParts.join('; ')
      const res = await a.post('/referrals/', payload)
      setCreatedRef(res.data)
      // Глава 5: запоминаем последнее направление для Quick-bar «Печать»
      if (res.data?.id) {
        try { localStorage.setItem(LAST_PRINT_KEY, res.data.id) } catch {}
        setLastPrintRefId(res.data.id)
      }
      setForm({ referral_type:'service', to_clinic_id:'', service_id:'', target_doctor_id:'', lab_tests:'', patient_phone:'', patient_name:'', notes:'', appointment_at:'' })
      setLabSelectedIds(new Set()); setLabQuery(''); setLabCategoryFilter('')
      setMisMatches([]); setMisMatchAccepted(null); setMisHint('')
      loadStats()
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

  // ─── Пункты «Ещё» ───
  const moreItems = [
    { key:'bonuses',     label:'Бонусы',     icon:'payments' },
    { key:'doctors',     label:'Врачи',      icon:'people'   },
    // Глава 7: «Мои регламенты» (читатель)
    { key:'regulations', label:'Регламенты', icon:'rule'     },
    // Глава 9: Чат с пациентами (премиум-чат клиники) — для reg/nurse
    { key:'chat',        label:'Чат пациентов', icon:'forum' },
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
    if (referralFilter !== 'all' && r.status !== referralFilter) return false
    if (referralListFilter.trim()) {
      const q = referralListFilter.trim().toLowerCase()
      const name = (r.patient_name || '').toLowerCase()
      const phone = (r.patient_phone || '').toLowerCase()
      const code = String(r.short_code || '')
      if (!name.includes(q) && !phone.includes(q) && !code.includes(q)) return false
    }
    return true
  })

  // ─── Глава 5: печать PDF одного направления ───
  function openPrintForReferral(refId) {
    if (!refId) { toast?.('Нет направления для печати', 'info'); return }
    try {
      localStorage.setItem(LAST_PRINT_KEY, refId)
      setLastPrintRefId(refId)
    } catch {}
    const url = `${API_BASE}/referrals/${refId}/print`
    // Открываем через скрытый iframe → window.print() для прямого Print Preview
    // Иначе fallback: новая вкладка.
    try {
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      iframe.title = 'Печать направления'
      iframe.onload = () => {
        try {
          // Cookie/Bearer прокидывает axios — а iframe идёт без Authorization.
          // Поэтому: если 401 — открываем в новой вкладке (там пользователь сам авторизован).
          setTimeout(() => {
            try { iframe.contentWindow?.focus(); iframe.contentWindow?.print() } catch {}
            setTimeout(() => { try { document.body.removeChild(iframe) } catch {} }, 2000)
          }, 500)
        } catch {
          window.open(url, '_blank')
        }
      }
      // Чтобы передать Bearer — используем blob через apiClient
      apiClient.get(`/referrals/${refId}/print`, { responseType: 'blob' })
        .then(resp => {
          const blobUrl = URL.createObjectURL(resp.data)
          iframe.src = blobUrl
          document.body.appendChild(iframe)
          // Через 30 секунд освободим URL
          setTimeout(() => { try { URL.revokeObjectURL(blobUrl) } catch {} }, 30000)
        })
        .catch(() => {
          toast?.('Не удалось загрузить PDF', 'error')
        })
    } catch {
      window.open(url, '_blank')
    }
  }

  // ─── Глава 5: обработчик действий Quick-bar / Command Palette ───
  function handleQuickAction(key) {
    switch (key) {
      case 'new':
        setQuickPatientOpen(true)
        break
      case 'book':
        setTab(isReg ? 'visiting' : 'create')
        break
      case 'search':
        setTab('referrals')
        setTimeout(() => referralSearchRef.current?.focus(), 60)
        break
      case 'print':
        if (lastPrintRefId) openPrintForReferral(lastPrintRefId)
        else toast?.('Сначала откройте направление для печати', 'info')
        break
      case 'waitlist':
        setTab('referrals')
        setReferralFilter('created')
        break
      case 'cmd':
        setCmdOpen(true)
        break
      case 'profile':
        setMoreOpen(true)
        break
      default:
        break
    }
  }

  // ─── Глобальные горячие клавиши (Alt+N/R/S/P/W + Ctrl+K) ───
  useRegHotkeys({
    onNewPatient:      () => setQuickPatientOpen(true),
    onBookAppointment: () => setTab(isReg ? 'visiting' : 'create'),
    onSearch:          () => { setTab('referrals'); setTimeout(() => referralSearchRef.current?.focus(), 60) },
    onPrintLast:       () => lastPrintRefId ? openPrintForReferral(lastPrintRefId) : toast?.('Нет последнего направления', 'info'),
    onWaitlist:        () => { setTab('referrals'); setReferralFilter('created') },
    onCommandPalette:  () => setCmdOpen(true),
  }, { disabled: !isReg })

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
        /* Премиум pill-кнопки заменены на <Button> из design-system (Этап 5 ROADMAP) */
        .ks-bottom-nav {
          position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
          padding-bottom: env(safe-area-inset-bottom);
          background: oklch(1 0 0 / 0.85);
          backdrop-filter: saturate(180%) blur(24px);
          -webkit-backdrop-filter: saturate(180%) blur(24px);
          border-top: 1px solid var(--border);
        }
        /* Bottom-sheets заменены на <Modal> (на мобильном Modal сам становится bottom-sheet) */
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

        {/* Hero KPI mini-row (W4: 4 метрики — Принятых / В очереди / Записанных сегодня / Бонусов) */}
        <div className="max-w-3xl mx-auto mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Принятых',          value: stats?.confirmed_today ?? '—',          icon: 'task_alt' },
            { label: 'В очереди',         value: stats?.pending_today ?? stats?.created_today ?? '—', icon: 'pending' },
            { label: 'Записано сегодня',  value: stats?.today_count ?? '—',              icon: 'event_note' },
            { label: 'Бонусы',            value: stats ? fmtMoney(stats.balance) : '—',  icon: 'payments' },
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

        {/* ─── Глава 5: Quick-bar регистратора (Alt+N/R/S/P/W + Ctrl+K) ─── */}
        {isReg && (
          <div className="max-w-3xl mx-auto">
            <RegQuickBar
              onAction={handleQuickAction}
              lastPrintAvailable={!!lastPrintRefId}
            />
          </div>
        )}
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
                    <KpiCard
                      label="Мои направления"
                      value={stats.my_total_referrals ?? 0}
                      icon={<Icon name="assignment" size={16} />}
                      delta={(stats.my_confirmed_referrals ?? 0) + ' подтв.'}
                      trend="up"
                    />
                    <KpiCard
                      label="Мои бонусы"
                      value={fmtMoney((stats.bonus_pending || 0) + (stats.bonus_paid || 0))}
                      icon={<Icon name="payments" size={16} />}
                      delta={stats.bonus_pending > 0 ? `${fmtMoney(stats.bonus_pending)} ждёт выплаты` : (stats.bonus_paid > 0 ? `${fmtMoney(stats.bonus_paid)} выплачено` : '—')}
                      trend={stats.bonus_pending > 0 ? 'up' : 'flat'}
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
                    <div key={r.id} className="ks-row" style={{ alignItems: 'flex-start' }}>
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
                        {/* ─── Quick Actions (W4): компактные иконки на карточке-превью ─── */}
                        <div className="mt-1.5">
                          <QuickActions
                            compact
                            actions={buildPatientCardActions({
                              phone: r.patient_phone,
                              onPrintQr: r.qr_code ? () => setQrPrint({
                                qr_code: r.qr_code,
                                short_code: r.short_code,
                                service_name: r.service_name,
                                patient_phone: r.patient_phone,
                              }) : undefined,
                            })}
                          />
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
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={() => setCreatedRef(null)}
                      leftIcon={<Icon name="add" size={18} />}
                      style={{ minHeight: 48 }}
                    >
                      Ещё одно
                    </Button>
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={() => setTab('referrals')}
                      leftIcon={<Icon name="list_alt" size={18} fill={1} />}
                      style={{ minHeight: 48 }}
                    >
                      К списку
                    </Button>
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
                  {/* Переключатель типа направления */}
                  <div>
                    <label className="ks-label">Тип направления</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { v:'service', icon:'medical_services', label:'На услугу', sub:'КТ, МРТ, УЗИ…' },
                        { v:'doctor',  icon:'person',           label:'К врачу',    sub:'ЛОР, гинеколог…' },
                        { v:'lab',     icon:'biotech',          label:'Анализы',    sub:'Лаборатория' },
                      ].map(t => {
                        const on = form.referral_type === t.v
                        return (
                          <button
                            type="button"
                            key={t.v}
                            onClick={() => setForm(p => ({ ...p, referral_type: t.v }))}
                            className="rounded-xl px-2 py-3 text-left transition"
                            style={{
                              background: on ? 'var(--accent-soft)' : 'var(--surface-2)',
                              border: '1px solid ' + (on ? 'var(--accent-line)' : 'var(--line)'),
                            }}
                          >
                            <div className="flex items-center gap-1.5">
                              <Icon name={t.icon} size={18} fill={on ? 1 : 0} />
                              <span className="text-[13px] font-semibold" style={{ color: on ? 'var(--accent)' : 'var(--fg)' }}>{t.label}</span>
                            </div>
                            <div className="text-[11px] mt-0.5" style={{ color: 'var(--fg-3)' }}>{t.sub}</div>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="ks-label">Клиника назначения *</label>
                    <select
                      value={form.to_clinic_id}
                      onChange={e => {
                        const cid = e.target.value
                        setForm(p => ({ ...p, to_clinic_id: cid, target_doctor_id: '', service_id: '' }))
                        if (form.referral_type === 'doctor') loadDoctorsForClinic(cid)
                        if (form.referral_type === 'lab')    loadLabCatalog(cid)
                        setLabSelectedIds(new Set())
                      }}
                      required
                      className="ks-input"
                    >
                      <option value="">Выбрать клинику…</option>
                      {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>

                  {/* Поля по выбранному типу */}
                  {form.referral_type === 'service' && (
                    <div>
                      <label className="ks-label">Услуга *</label>
                      <select
                        value={form.service_id}
                        onChange={e => setForm(p => ({ ...p, service_id: e.target.value }))}
                        required
                        className="ks-input"
                      >
                        <option value="">Выбрать услугу…</option>
                        {services.filter(s => !form.to_clinic_id || s.clinic_id === form.to_clinic_id).map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name}{s.bonus_amount > 0 ? ` (+${s.bonus_amount} ₽)` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {form.referral_type === 'doctor' && (
                    <>
                      <div>
                        <label className="ks-label">Врач *</label>
                        <select
                          value={form.target_doctor_id}
                          onChange={e => setForm(p => ({ ...p, target_doctor_id: e.target.value }))}
                          required
                          className="ks-input"
                          disabled={!form.to_clinic_id}
                        >
                          <option value="">{form.to_clinic_id ? 'Выбрать врача…' : 'Сначала выберите клинику'}</option>
                          {referralDoctors.map(d => (
                            <option key={d.id} value={d.id}>
                              {d.full_name}{d.specialization ? ' · ' + d.specialization : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="ks-label">Дата и время приёма (опц.)</label>
                        <input
                          type="datetime-local"
                          value={form.appointment_at}
                          onChange={e => setForm(p => ({ ...p, appointment_at: e.target.value }))}
                          className="ks-input"
                        />
                      </div>
                    </>
                  )}

                  {form.referral_type === 'lab' && (
                    <div>
                      <label className="ks-label">
                        Анализы * {labSelectedIds.size > 0 && (
                          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>· выбрано {labSelectedIds.size}</span>
                        )}
                      </label>
                      {!form.to_clinic_id && (
                        <div className="text-[12px] py-2" style={{ color: 'var(--fg-3)' }}>
                          Сначала выберите клинику — анализы загрузятся из её МИС
                        </div>
                      )}
                      {form.to_clinic_id && labLoading && (
                        <div className="text-[12px] py-2" style={{ color: 'var(--fg-3)' }}>
                          Загружаем каталог анализов из МИС…
                        </div>
                      )}
                      {form.to_clinic_id && !labLoading && labCatalog.length === 0 && (
                        <div className="text-[12px] py-2" style={{ color: 'var(--fg-3)' }}>
                          В МИС не нашлось анализов. Можно вписать вручную:
                        </div>
                      )}
                      {form.to_clinic_id && !labLoading && labCatalog.length > 0 && (
                        <>
                          {/* Поиск + фильтр категории */}
                          <div className="flex gap-2 mb-2">
                            <input
                              type="text"
                              value={labQuery}
                              onChange={e => setLabQuery(e.target.value)}
                              placeholder="🔍 Найти анализ (например: гемоглобин, тироид)"
                              className="ks-input flex-1"
                            />
                            <select
                              value={labCategoryFilter}
                              onChange={e => setLabCategoryFilter(e.target.value)}
                              className="ks-input"
                              style={{ width: 180 }}
                            >
                              <option value="">Все категории</option>
                              {[...new Set(labCatalog.map(l => l.category).filter(Boolean))].sort().map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                              ))}
                            </select>
                          </div>
                          {/* Сгруппированный список */}
                          <div
                            className="rounded-xl border"
                            style={{ borderColor: 'var(--line)', maxHeight: 320, overflowY: 'auto' }}
                          >
                            {(() => {
                              const q = labQuery.toLowerCase().trim()
                              const filtered = labCatalog.filter(l => {
                                if (labCategoryFilter && l.category !== labCategoryFilter) return false
                                if (q && !l.name.toLowerCase().includes(q)) return false
                                return true
                              })
                              if (filtered.length === 0) return (
                                <div className="text-[12px] p-3 text-center" style={{ color: 'var(--fg-3)' }}>
                                  Ничего не найдено
                                </div>
                              )
                              const grouped = {}
                              filtered.forEach(l => {
                                const cat = l.category || '— Без категории —'
                                if (!grouped[cat]) grouped[cat] = []
                                grouped[cat].push(l)
                              })
                              return Object.keys(grouped).sort().map(cat => (
                                <div key={cat}>
                                  <div
                                    className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide sticky top-0"
                                    style={{ background: 'var(--surface-2)', color: 'var(--fg-3)', borderBottom: '1px solid var(--line)' }}
                                  >
                                    {cat} <span style={{ color: 'var(--accent)' }}>· {grouped[cat].length}</span>
                                  </div>
                                  {grouped[cat].map(l => {
                                    const on = labSelectedIds.has(l.id)
                                    return (
                                      <label
                                        key={l.id}
                                        className="flex items-center gap-2 px-3 py-2 text-[13px] cursor-pointer transition"
                                        style={{ background: on ? 'var(--accent-soft)' : 'transparent', borderBottom: '1px solid var(--line)' }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={on}
                                          onChange={() => setLabSelectedIds(prev => {
                                            const n = new Set(prev)
                                            if (n.has(l.id)) n.delete(l.id); else n.add(l.id)
                                            return n
                                          })}
                                          style={{ accentColor: 'var(--accent)' }}
                                        />
                                        <span className="flex-1">{l.name}</span>
                                        {l.price > 0 && (
                                          <span className="text-[12px]" style={{ color: 'var(--fg-3)' }}>{l.price} ₽</span>
                                        )}
                                      </label>
                                    )
                                  })}
                                </div>
                              ))
                            })()}
                          </div>
                          {labSelectedIds.size > 0 && (
                            <button
                              type="button"
                              onClick={() => setLabSelectedIds(new Set())}
                              className="text-[12px] mt-1"
                              style={{ color: 'var(--fg-3)' }}
                            >
                              Сбросить выбор ({labSelectedIds.size})
                            </button>
                          )}
                        </>
                      )}
                      {/* Поле для ручных анализов (если в МИС нет или хочется добавить) */}
                      <textarea
                        value={form.lab_tests}
                        onChange={e => setForm(p => ({ ...p, lab_tests: e.target.value }))}
                        rows={2}
                        placeholder={labCatalog.length > 0 ? 'Дополнительно вручную (необязательно)' : 'Например: ОАК, биохимия, ТТГ…'}
                        className="ks-input mt-2"
                        style={{ resize: 'none' }}
                      />
                    </div>
                  )}
                  <div>
                    <label className="ks-label">Телефон пациента *</label>
                    <div className="flex gap-2">
                      <input
                        type="tel"
                        inputMode="tel"
                        value={form.patient_phone}
                        onChange={e => setForm(p => ({ ...p, patient_phone: e.target.value }))}
                        placeholder="+7…"
                        required
                        className="ks-input flex-1"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        disabled={misSearching || (!form.patient_phone && !form.patient_name)}
                        onClick={async () => {
                          if (!form.patient_phone && !form.patient_name) return
                          setMisSearching(true); setMisHint(''); setMisMatches([]); setMisMatchAccepted(null)
                          try {
                            const params = {}
                            if (form.patient_phone) params.phone = form.patient_phone
                            if (form.patient_name)  params.full_name = form.patient_name
                            const r = await api(adminToken).get('/referrals/verify-patient', params)
                            const d = r.data
                            if (d?.error) {
                              setMisHint('МИС: ' + d.error)
                            } else if (d?.matches && d.matches.length > 0) {
                              setMisMatches(d.matches)
                              setMisHint('Найдено в МИС: ' + d.matches.length)
                            } else {
                              setMisHint('В МИС не найден — будет создан при первом приёме')
                            }
                          } catch (e) {
                            setMisHint('Ошибка поиска в МИС')
                          }
                          setMisSearching(false)
                        }}
                        title="Найти пациента в МИС Renovatio (по телефону и/или ФИО)"
                      >
                        <Icon name={misSearching ? 'hourglass_empty' : 'travel_explore'} size={18} fill={1} />
                        {misSearching ? '...' : 'МИС'}
                      </Button>
                    </div>
                    {misHint && misMatches.length === 0 && (
                      <div className="text-[12px] mt-1" style={{ color: 'var(--fg-3)' }}>
                        {misHint}
                      </div>
                    )}
                    {misMatches.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {misMatches.map(m => {
                          const accepted = misMatchAccepted === m.mis_patient_id
                          return (
                            <div
                              key={m.mis_patient_id}
                              className="rounded-xl p-3"
                              style={{
                                background: accepted ? 'var(--accent-soft)' : 'var(--surface-2)',
                                border: '1px solid ' + (accepted ? 'var(--accent-line)' : 'var(--line)'),
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-semibold text-[14px]" style={{ color: 'var(--fg)' }}>
                                    {m.name || '—'}
                                  </div>
                                  <div className="text-[12px] mt-0.5" style={{ color: 'var(--fg-2)' }}>
                                    {[m.birth_date, m.age, m.gender].filter(Boolean).join(' · ')}
                                  </div>
                                  <div className="text-[12px] mt-0.5" style={{ color: 'var(--fg-2)' }}>
                                    МИС № {m.mis_number || m.mis_patient_id} · тел. {m.mobile || '—'}
                                  </div>
                                  {m.match_type === 'name' && m.phone_mismatch && (
                                    <div className="text-[12px] mt-1 font-semibold" style={{ color: 'var(--bad)' }}>
                                      ⚠ В МИС другой телефон: {m.mobile}
                                    </div>
                                  )}
                                  {m.match_type === 'phone' && (
                                    <div className="text-[11px] mt-1" style={{ color: 'var(--good)' }}>
                                      Совпадение по телефону
                                    </div>
                                  )}
                                  {m.match_type === 'name' && !m.phone_mismatch && (
                                    <div className="text-[11px] mt-1" style={{ color: 'var(--good)' }}>
                                      Совпадение по ФИО
                                    </div>
                                  )}
                                </div>
                                <Button
                                  type="button"
                                  variant={accepted ? 'primary' : 'secondary'}
                                  size="sm"
                                  onClick={() => {
                                    // Принять: вписать ФИО и телефон из МИС
                                    setForm(p => ({
                                      ...p,
                                      patient_name: m.name || p.patient_name,
                                      patient_phone: m.mobile || p.patient_phone,
                                    }))
                                    setMisMatchAccepted(m.mis_patient_id)
                                  }}
                                >
                                  <Icon name={accepted ? 'check_circle' : 'check'} size={16} fill={1} />
                                  {accepted ? 'Принят' : 'Принять'}
                                </Button>
                              </div>
                            </div>
                          )
                        })}
                        {/* Кнопка «Это другой пациент — создать нового» если все совпадения по name с phone_mismatch */}
                        {misMatches.every(m => m.match_type === 'name' && m.phone_mismatch) && form.patient_phone && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={misConfirmAddNew}
                            onClick={async () => {
                              if (!form.patient_phone) return
                              setMisConfirmAddNew(true); setMisHint('')
                              try {
                                const r = await api(adminToken).post('/referrals/mis-add-patient', {
                                  phone: form.patient_phone, full_name: form.patient_name || ''
                                })
                                if (r.data?.mis_patient_id) {
                                  setMisHint('Создан новый пациент в МИС № ' + r.data.mis_patient_id)
                                  setMisMatches([])
                                  setMisMatchAccepted(r.data.mis_patient_id)
                                }
                              } catch (e) {
                                setMisHint('Ошибка создания в МИС: ' + (e.response?.data?.detail || ''))
                              }
                              setMisConfirmAddNew(false)
                            }}
                            className="w-full"
                          >
                            <Icon name="person_add" size={16} fill={1} />
                            {misConfirmAddNew ? 'Создаём…' : 'Это другой человек — создать в МИС нового'}
                          </Button>
                        )}
                      </div>
                    )}
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
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={loading}
                    leftIcon={loading
                      ? <div className="ks-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                      : <Icon name="add_circle" size={20} fill={1} />}
                    className="w-full"
                    style={{ minHeight: 48 }}
                  >
                    {loading ? 'Создаём…' : 'Создать направление'}
                  </Button>
                </form>
              </Card>
            )}
          </div>
        )}

        {/* ───── НАПРАВЛЕНИЯ ───── */}
        {tab === 'referrals' && (
          <div className="space-y-3">
            {/* Глава 5: быстрый поиск по направлениям (Alt+S фокусит сюда) */}
            <div className="relative">
              <Icon
                name="search"
                size={18}
                style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-3)' }}
              />
              <input
                ref={referralSearchRef}
                type="text"
                value={referralListFilter}
                onChange={(e) => setReferralListFilter(e.target.value)}
                placeholder="Поиск по ФИО, телефону или коду (Alt+S)"
                className="ks-input"
                style={{ paddingLeft: 38 }}
              />
              {referralListFilter && (
                <button
                  type="button"
                  onClick={() => setReferralListFilter('')}
                  aria-label="Очистить"
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--fg-3)' }}
                >
                  <Icon name="close" size={18} />
                </button>
              )}
            </div>

            {/* Фильтр через design-system <Tabs> */}
            <div className="overflow-x-auto -mx-4 px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
              <Tabs
                value={referralFilter}
                onChange={setReferralFilter}
                items={[
                  { id: 'all',       label: 'Все' },
                  { id: 'created',   label: 'Активные' },
                  { id: 'confirmed', label: 'Завершённые' },
                  { id: 'expired',   label: 'Просроченные' },
                ]}
              />
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
                    {/* ─── Quick Actions (W4): иконки прямо на карточке направления ─── */}
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <QuickActions
                        compact
                        actions={buildPatientCardActions({
                          phone: r.patient_phone,
                          onPrintQr: r.qr_code ? () => setQrPrint({
                            qr_code: r.qr_code,
                            short_code: r.short_code,
                            service_name: r.service_name,
                            patient_phone: r.patient_phone,
                          }) : undefined,
                        })}
                      />
                      {/* Глава 5: PDF направления в 1 клик */}
                      <button
                        type="button"
                        onClick={() => openPrintForReferral(r.id)}
                        title="Печать направления (PDF)"
                        aria-label="Печать направления"
                        className="reg-print-btn"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '6px 12px', borderRadius: 9,
                          background: 'var(--accent-soft)',
                          border: '1px solid var(--accent-line)',
                          color: 'var(--accent)',
                          fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        <Icon name="print" size={16} />
                        Печать
                      </button>
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
                            <Button
                              variant="primary"
                              size="md"
                              onClick={() => {
                                setBookVisitDoc(doc)
                                setBookVisitForm({ patient_name:'', patient_phone:'', appointment_date:'', start_time:'09:00', end_time:'09:30', price:'' })
                                setBookVisitResult(null); setBookVisitMsg('')
                              }}
                              style={{ minHeight: 44 }}
                            >
                              Записать
                            </Button>
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

        {/* Глава 7: Мои регламенты (читатель) */}
        {tab === 'regulations' && (
          <Suspense fallback={<div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)' }}>Загрузка…</div>}>
            <RegulationsReaderSection user={user} />
          </Suspense>
        )}

        {/* Глава 9: Чат с пациентами (премиум-чат клиники) */}
        {tab === 'chat' && (
          <Suspense fallback={<div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)' }}>Загрузка…</div>}>
            <ClinicChatSection role={user?.role || 'reg'} />
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

      {/* ───── MODAL: Ещё (через design-system <Modal>) ───── */}
      <Modal
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="Дополнительно"
        size="sm"
      >
        <div className="grid grid-cols-3 gap-3">
          {moreItems.map(item => {
            const active = tab === item.key
            return (
              <button
                key={item.key}
                onClick={() => { setTab(item.key); setMoreOpen(false) }}
                className="flex flex-col items-center gap-2 py-4 rounded-2xl"
                style={{
                  minHeight: 96,
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
      </Modal>

      {/* ───── MODAL: Принять пациента (design-system <Modal>) ───── */}
      <Modal
        open={acceptOpen}
        onClose={() => { setAcceptOpen(false); setAcceptResult(null) }}
        title="Принять пациента"
        size="sm"
      >
        {acceptResult?.ok ? (
          <div className="text-center">
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
              <Button
                variant="secondary"
                size="lg"
                onClick={() => setAcceptResult(null)}
                style={{ minHeight: 48 }}
              >
                Ещё пациент
              </Button>
              <Button
                variant="primary"
                size="lg"
                onClick={() => { setAcceptOpen(false); setAcceptResult(null); setTab('referrals') }}
                style={{ minHeight: 48 }}
              >
                К списку
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submitAccept} className="space-y-4">
            <p className="text-[12.5px] -mt-2" style={{ color: 'var(--fg-3)' }}>
              Введите 5-значный код пациента или отсканируйте QR
            </p>
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

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={acceptBusy || acceptCode.length < 4}
              leftIcon={acceptBusy
                ? <div className="ks-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                : <Icon name="check_circle" size={20} fill={1} />}
              className="w-full"
              style={{ minHeight: 48 }}
            >
              {acceptBusy ? 'Проверяем…' : 'Принять'}
            </Button>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => { setAcceptOpen(false); setAcceptResult(null); setTab('referrals') }}
                leftIcon={<Icon name="search" size={18} />}
                style={{ minHeight: 44 }}
              >
                Поиск
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => toast('Включение камеры доступно в HTTPS-режиме. Используйте код или поиск по телефону.', 'info', 6000)}
                leftIcon={<Icon name="qr_code_scanner" size={18} />}
                style={{ minHeight: 44 }}
              >
                QR
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ───── MODAL: Запись к приезжему врачу (design-system <Modal>) ───── */}
      <Modal
        open={!!bookVisitDoc}
        onClose={() => { setBookVisitDoc(null); setBookVisitResult(null) }}
        title={bookVisitDoc ? `Запись на приём — ${bookVisitDoc.doctor_name}` : 'Запись на приём'}
        size="md"
      >
        {bookVisitResult ? (
          <div className="text-center">
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
            <Button
              variant="primary"
              size="lg"
              onClick={() => { setBookVisitDoc(null); setBookVisitResult(null) }}
              className="w-full mt-5"
              style={{ minHeight: 48 }}
            >
              Готово
            </Button>
          </div>
        ) : bookVisitDoc ? (
          <form onSubmit={saveBookVisit} className="space-y-3">
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

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={bookVisitSaving}
              leftIcon={bookVisitSaving
                ? <div className="ks-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                : <Icon name="event_available" size={20} fill={1} />}
              className="w-full"
              style={{ minHeight: 48 }}
            >
              {bookVisitSaving ? 'Сохраняем…' : 'Создать запись'}
            </Button>
          </form>
        ) : null}
      </Modal>

      {/* ───── QR Print Modal (W4) ───── */}
      <Modal
        open={!!qrPrint}
        onClose={() => setQrPrint(null)}
        title="QR направления"
        size="sm"
        actions={
          <>
            <Button variant="secondary" onClick={() => setQrPrint(null)}>Закрыть</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!qrPrint) return
                const w = window.open('', '_blank', 'width=420,height=600')
                if (!w) { toast('Разрешите всплывающие окна для печати', 'warn'); return }
                const code = (qrPrint.short_code || '').replace(/[<>&"']/g, '')
                const svc  = (qrPrint.service_name || 'Направление').replace(/[<>&"']/g, '')
                w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR направления</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;text-align:center;padding:24px;color:#0f172a}
h1{font-size:18px;margin:0 0 8px}p{margin:4px 0;color:#475569;font-size:13px}
img{width:280px;height:280px;border:1px solid #e2e8f0;border-radius:12px;padding:12px;background:#fff;margin:16px auto;display:block}
.code{font-family:ui-monospace,monospace;font-size:24px;letter-spacing:0.18em;margin:8px 0;color:#0e7490;font-weight:700}
@media print{body{padding:0}}
</style></head><body>
<h1>${svc}</h1>
<img src="data:image/png;base64,${qrPrint.qr_code}" alt="QR"/>
${code ? `<div class="code">${code}</div>` : ''}
<p>Покажите код в регистратуре</p>
<script>setTimeout(()=>{window.print();},200);window.onafterprint=()=>window.close();</script>
</body></html>`)
                w.document.close()
              }}
            >
              <Icon name="print" size={16} />
              Печать
            </Button>
          </>
        }
      >
        {qrPrint && (
          <div className="text-center">
            <div className="text-sm font-semibold mb-2" style={{ color: 'var(--fg)' }}>{qrPrint.service_name || '—'}</div>
            <img
              alt="QR"
              src={`data:image/png;base64,${qrPrint.qr_code}`}
              style={{ width: 220, height: 220, margin: '0 auto', background: '#fff', padding: 8, borderRadius: 12, border: '1px solid var(--border)' }}
            />
            {qrPrint.short_code && (
              <div className="mt-3 font-mono tabular-nums" style={{ fontSize: 22, letterSpacing: '0.16em', color: 'var(--accent)' }}>
                {qrPrint.short_code}
              </div>
            )}
            {qrPrint.patient_phone && (
              <div className="mt-2 text-xs" style={{ color: 'var(--fg-3)' }}>{qrPrint.patient_phone}</div>
            )}
          </div>
        )}
      </Modal>

      {/* ───── Глава 5: Командная палитра (Ctrl+K) ───── */}
      {isReg && (
        <RegCommandPalette
          open={cmdOpen}
          onClose={() => setCmdOpen(false)}
          onCommand={(cmdId) => handleQuickAction(cmdId)}
          onSelectPatient={(p) => {
            // открыть направления и отфильтровать по телефону
            setTab('referrals')
            setReferralListFilter(p.patient_phone || '')
            setTimeout(() => referralSearchRef.current?.focus(), 80)
          }}
        />
      )}

      {/* ───── Глава 5: Mobile-first форма пациента ───── */}
      {isReg && (
        <RegMobilePatientForm
          open={quickPatientOpen}
          onClose={() => setQuickPatientOpen(false)}
          onCreated={(patient) => {
            if (patient?.book_now) {
              // Подставляем телефон/имя в форму создания направления и переключаемся
              setForm(prev => ({
                ...prev,
                patient_phone: patient.patient_phone || '',
                patient_name:  patient.patient_name  || '',
              }))
              setTab('create')
              toast?.('Пациент сохранён, можно создать направление', 'success')
            } else if (patient?.duplicate) {
              setTab('referrals')
              setReferralListFilter(patient.patient_phone || '')
            } else {
              toast?.('Пациент сохранён', 'success')
            }
          }}
          smsModuleEnabled={false}
        />
      )}
    </Page>
  )
}
