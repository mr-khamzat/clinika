/**
 * Личный кабинет пациента v2
 * - Табы: Главная / Направления / История МИС / Анализы / Поддержка
 * - Web Push подписка
 * - MIS история приёмов и анализов
 * - PWA установка
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import axios from 'axios'

const API = '/clinika/api'
const TOKEN_KEY = 'clinika_patient_token'
const REF_KEY = 'clinika_patient_ref'

// ─── Helpers ───
function fmt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const STATUS_CONFIG = {
  created:          { label: 'Активно',      bg: 'bg-blue-100 text-blue-700', icon: 'radio_button_checked' },
  confirmed:        { label: 'Подтверждено', bg: 'bg-emerald-100 text-emerald-700', icon: 'check_circle' },
  expired:          { label: 'Истекло',      bg: 'bg-gray-100 text-gray-500', icon: 'schedule' },
  cancel_requested: { label: 'На отмене',    bg: 'bg-yellow-100 text-yellow-700', icon: 'pending' },
  cancelled:        { label: 'Отменено',     bg: 'bg-red-100 text-red-600', icon: 'cancel' },
}

const COLORS = [
  'from-blue-500 to-blue-700',
  'from-violet-500 to-violet-700',
  'from-emerald-500 to-teal-700',
  'from-orange-500 to-red-500',
  'from-pink-500 to-rose-600',
]

function StatusPill({ status }) {
  const c = STATUS_CONFIG[status] || { label: status, bg: 'bg-gray-100 text-gray-500', icon: 'info' }
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${c.bg}`}>
      <span className="material-symbols-outlined text-sm leading-none" style={{ fontVariationSettings: "'FILL' 1" }}>{c.icon}</span>
      {c.label}
    </span>
  )
}

// ─── Push Notifications ───
async function subscribePush(phone, token) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  try {
    const sw = await navigator.serviceWorker.ready
    // Get VAPID key
    const keyRes = await axios.get(`${API}/push/vapid-key`)
    const vapidKey = keyRes.data.public_key
    // Convert to Uint8Array
    const b64 = vapidKey.replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(b64)
    const key = new Uint8Array(raw.split('').map(c => c.charCodeAt(0)))

    const sub = await sw.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    const subJson = sub.toJSON()
    await axios.post(`${API}/push/subscribe`, {
      endpoint: subJson.endpoint,
      p256dh: subJson.keys.p256dh,
      auth: subJson.keys.auth,
      patient_phone: phone,
      patient_token: token,
    })
    return true
  } catch (e) {
    console.warn('Push subscribe failed:', e)
    return false
  }
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register('/clinika/sw.js', { scope: '/clinika/' })
  } catch (e) {
    console.warn('SW register failed:', e)
  }
}

// ─── QR Fullscreen ───
function QrFullscreen({ qr, onClose }) {
  return (
    <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-50 px-8" onClick={onClose}>
      <div className="flex items-center gap-2 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center">
          <span className="material-symbols-outlined text-white text-xl">medical_services</span>
        </div>
        <span className="text-blue-600 text-xl font-bold">Clinika</span>
      </div>
      <p className="text-sm text-gray-500 mb-5 text-center">Покажите этот QR администратору клиники</p>
      <div className="bg-white p-4 rounded-3xl shadow-2xl border border-gray-100">
        <img src={`data:image/png;base64,${qr}`} alt="QR" className="w-64 h-64 rounded-2xl" />
      </div>
      <p className="text-xs text-gray-400 mt-6">Нажмите чтобы закрыть</p>
    </div>
  )
}

// ─── Login screen ───
function LoginScreen({ onLogin, errorMsg }) {
  const [code, setCode] = useState('')
  const [phone, setPhone] = useState('+7')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(errorMsg || '')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!code || !phone) { setErr('Введите код и телефон'); return }
    setLoading(true); setErr('')
    try {
      const res = await axios.post(`${API}/patient/by-code`, { code: parseInt(code), phone })
      onLogin(res.data.referral_id, res.data.patient_token)
    } catch (e) {
      setErr(e.response?.data?.detail || 'Направление не найдено')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center justify-center px-5">
      <div className="mb-8 text-center">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mx-auto mb-4 shadow-2xl shadow-blue-500/30">
          <span className="material-symbols-outlined text-white text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>medical_services</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white">Clinika</h1>
        <p className="text-slate-400 text-sm mt-1">Личный кабинет пациента</p>
      </div>

      <div className="w-full max-w-sm bg-white/10 backdrop-blur-lg rounded-3xl p-6 border border-white/10">
        <h2 className="text-xl font-bold text-white mb-1 text-center">Войти в кабинет</h2>
        <p className="text-slate-400 text-sm text-center mb-5">Введите код из направления и номер телефона</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl pointer-events-none">tag</span>
            <input type="number" placeholder="Код направления" value={code} onChange={e => setCode(e.target.value)}
              className="w-full h-14 pl-12 pr-4 bg-white/10 text-white rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder-slate-500" />
          </div>
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl pointer-events-none">phone</span>
            <input type="tel" placeholder="+7 900 000-00-00" value={phone} onChange={e => setPhone(e.target.value)}
              className="w-full h-14 pl-12 pr-4 bg-white/10 text-white rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder-slate-500" />
          </div>
          {err && <p className="text-red-400 text-sm text-center">{err}</p>}
          <button type="submit" disabled={loading}
            className="w-full h-14 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold text-base transition disabled:opacity-50 shadow-lg shadow-blue-600/30">
            {loading ? 'Поиск...' : 'Найти направление'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Referral Card ───
function ReferralCard({ referral, index, onQr }) {
  const grad = COLORS[index % COLORS.length]
  const dateStr = fmtDateTime(referral.appointment_at || referral.created_at)

  return (
    <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-gray-100">
      {/* Gradient header */}
      <div className={`bg-gradient-to-br ${grad} p-5 text-white`}>
        <div className="flex items-start justify-between mb-3">
          <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center">
            <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>local_hospital</span>
          </div>
          <StatusPill status={referral.status} />
        </div>
        <h3 className="text-xl font-extrabold leading-tight">{referral.to_clinic_name || 'Клиника'}</h3>
        <p className="text-white/80 text-sm mt-0.5">{referral.service_name}</p>
      </div>
      {/* Body */}
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="material-symbols-outlined text-base">calendar_today</span>
          <span>{dateStr}</span>
        </div>
        {referral.short_code && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="material-symbols-outlined text-base">tag</span>
            <span>Код: <span className="font-bold text-gray-800 tracking-widest">{referral.short_code}</span></span>
          </div>
        )}
        {referral.from_clinic_name && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="material-symbols-outlined text-base">arrow_forward</span>
            <span>Направил: {referral.from_clinic_name}</span>
          </div>
        )}
        {(referral.status === 'created' || referral.status === 'confirmed') && referral.qr_code && (
          <button onClick={() => onQr(referral.qr_code)}
            className="mt-1 w-full h-11 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center gap-2 font-semibold text-sm border border-blue-100">
            <span className="material-symbols-outlined text-base">qr_code_2</span>
            Показать QR для клиники
          </button>
        )}
      </div>
    </div>
  )
}

// ─── MIS Visit Card ───
function VisitCard({ visit }) {
  const dateStr = visit.date || visit.appointment_date || visit.created_at
  const doctor = visit.doctor_name || visit.doctor || '—'
  const clinic = visit.clinic_name || visit.clinic || '—'
  const service = visit.service_name || visit.service || visit.specialty || '—'
  const status = visit.status || visit.visit_status || ''

  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center">
            <span className="material-symbols-outlined text-teal-600 text-base" style={{ fontVariationSettings: "'FILL' 1" }}>stethoscope</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">{service}</p>
            <p className="text-xs text-gray-400">{doctor}</p>
          </div>
        </div>
        {status && (
          <span className="text-xs font-medium bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">{status}</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
        <span className="flex items-center gap-1">
          <span className="material-symbols-outlined text-sm">calendar_today</span>
          {fmt(dateStr)}
        </span>
        <span className="flex items-center gap-1">
          <span className="material-symbols-outlined text-sm">location_on</span>
          {clinic}
        </span>
      </div>
    </div>
  )
}

// ─── Analysis Card ───
function AnalysisCard({ analysis }) {
  const name = analysis.name || analysis.analysis_name || analysis.test_name || '—'
  const date = analysis.date || analysis.created_at || analysis.result_date
  const result = analysis.result || analysis.value || analysis.result_value
  const norm = analysis.norm || analysis.reference || analysis.reference_range
  const status = analysis.status || (result && norm ? 'Готов' : 'В обработке')

  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-1">
          <div className="w-9 h-9 bg-violet-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-violet-600 text-base" style={{ fontVariationSettings: "'FILL' 1" }}>biotech</span>
          </div>
          <p className="text-sm font-semibold text-gray-800 leading-tight">{name}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${status === 'Готов' || result ? 'bg-emerald-50 text-emerald-600' : 'bg-yellow-50 text-yellow-600'}`}>
          {status}
        </span>
      </div>
      {result && (
        <div className="bg-gray-50 rounded-xl p-2 mt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Результат</span>
            <span className="text-sm font-bold text-gray-800">{result}</span>
          </div>
          {norm && (
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-xs text-gray-400">Норма</span>
              <span className="text-xs text-gray-500">{norm}</span>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-gray-400 mt-1.5">{fmt(date)}</p>
    </div>
  )
}

// ─── Main PatientCabinet ───
export default function PatientCabinet() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showLogin, setShowLogin] = useState(false)
  const [fullscreenQr, setFullscreenQr] = useState(null)
  const [tab, setTab] = useState('home')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showInstall, setShowInstall] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  useEffect(() => {
    // Register SW
    registerSW()
    // PWA install prompt
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); setShowInstall(true) }
    window.addEventListener('beforeinstallprompt', handler)
    // Check push permission
    if ('Notification' in window && Notification.permission === 'granted') setPushEnabled(true)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('t')
    const referralId = window.location.pathname.split('/p/')[1]?.split('?')[0]

    if (t && referralId) {
      localStorage.setItem(TOKEN_KEY, t)
      localStorage.setItem(REF_KEY, referralId)
      loadData(referralId, t)
    } else {
      const savedToken = localStorage.getItem(TOKEN_KEY)
      const savedRef = localStorage.getItem(REF_KEY)
      if (savedToken && savedRef) {
        loadData(savedRef, savedToken)
      } else {
        setLoading(false)
        setShowLogin(true)
      }
    }
  }, [])

  const loadData = async (referralId, token) => {
    setLoading(true); setError('')
    try {
      const res = await axios.get(`${API}/patient/${referralId}?t=${token}`)
      setData(res.data)
    } catch (e) {
      const msg = e.response?.data?.detail || 'Ошибка загрузки'
      setError(msg)
      if (e.response?.status === 403) {
        localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REF_KEY)
        setShowLogin(true)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = (referralId, token) => {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(REF_KEY, referralId)
    setShowLogin(false)
    loadData(referralId, token)
  }

  const handlePushToggle = async () => {
    if (pushEnabled) return
    setPushLoading(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm === 'granted') {
        const phone = data?.patient_phone
        const token = localStorage.getItem(TOKEN_KEY)
        const ok = await subscribePush(phone, token)
        setPushEnabled(ok)
      }
    } catch {}
    setPushLoading(false)
  }

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null); setShowInstall(false)
  }

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REF_KEY)
    setData(null); setShowLogin(true)
  }

  // ─── Screens ───
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/30">
          <span className="material-symbols-outlined text-white text-3xl animate-pulse">medical_services</span>
        </div>
        <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
        <p className="text-sm text-gray-400">Загрузка...</p>
      </div>
    </div>
  )

  if (fullscreenQr) return <QrFullscreen qr={fullscreenQr} onClose={() => setFullscreenQr(null)} />

  if (showLogin) return <LoginScreen onLogin={handleLogin} errorMsg={error} />

  if (!data) return null

  const { current, other_referrals = [], mis_info, mis_visits = [], mis_analyses = [], patient_name, patient_phone } = data
  const allReferrals = [current, ...other_referrals]
  const activeReferrals = allReferrals.filter(r => r.status === 'created' || r.status === 'confirmed')
  const filteredReferrals = searchQ
    ? allReferrals.filter(r => (r.to_clinic_name + r.service_name + r.short_code).toLowerCase().includes(searchQ.toLowerCase()))
    : allReferrals

  const TABS = [
    { key: 'home', icon: 'home', label: 'Главная' },
    { key: 'referrals', icon: 'assignment', label: 'Направления' },
    ...(mis_visits.length ? [{ key: 'history', icon: 'history', label: 'История' }] : []),
    ...(mis_analyses.length ? [{ key: 'analyses', icon: 'biotech', label: 'Анализы' }] : []),
    { key: 'support', icon: 'chat', label: 'Поддержка' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 pb-20">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-5 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>medical_services</span>
            </div>
            <div>
              <span className="text-blue-700 font-bold text-base leading-none block">Clinika</span>
              <span className="text-gray-400 text-[10px]">{patient_name || patient_phone}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!pushEnabled && 'Notification' in window && (
              <button onClick={handlePushToggle} disabled={pushLoading}
                className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center"
                title="Включить уведомления">
                <span className="material-symbols-outlined text-blue-600 text-xl">notifications</span>
              </button>
            )}
            {pushEnabled && (
              <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center" title="Уведомления включены">
                <span className="material-symbols-outlined text-emerald-600 text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>notifications_active</span>
              </div>
            )}
            <button onClick={handleLogout}
              className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
              <span className="material-symbols-outlined text-gray-500 text-xl">logout</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 pt-5">
        {/* PWA banner */}
        {showInstall && (
          <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-3xl p-4 mb-4 flex items-center gap-3 text-white">
            <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-xl">download</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold">Добавить на экран</p>
              <p className="text-xs text-blue-200">Быстрый доступ к кабинету</p>
            </div>
            <button onClick={handleInstall}
              className="bg-white text-blue-700 rounded-xl px-3 py-1.5 text-xs font-bold flex-shrink-0">
              Добавить
            </button>
            <button onClick={() => setShowInstall(false)} className="text-white/70 text-xl flex-shrink-0">×</button>
          </div>
        )}

        {/* ─── HOME TAB ─── */}
        {tab === 'home' && (
          <div className="space-y-4">
            {/* Patient card */}
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-5 text-white">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-white/15 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>person</span>
                </div>
                <div>
                  <p className="font-bold text-lg leading-tight">{patient_name || 'Пациент'}</p>
                  <p className="text-slate-400 text-sm">{patient_phone}</p>
                </div>
              </div>
              {mis_info && (
                <div className="grid grid-cols-2 gap-2">
                  {mis_info.card_number && (
                    <div className="bg-white/10 rounded-2xl p-2.5">
                      <p className="text-xs text-slate-400">Карта МИС</p>
                      <p className="font-bold text-sm mt-0.5">№ {mis_info.card_number}</p>
                    </div>
                  )}
                  {mis_info.birth_date && (
                    <div className="bg-white/10 rounded-2xl p-2.5">
                      <p className="text-xs text-slate-400">Дата рождения</p>
                      <p className="font-bold text-sm mt-0.5">{mis_info.birth_date}</p>
                    </div>
                  )}
                  {mis_info.gender && (
                    <div className="bg-white/10 rounded-2xl p-2.5">
                      <p className="text-xs text-slate-400">Пол</p>
                      <p className="font-bold text-sm mt-0.5">{mis_info.gender}</p>
                    </div>
                  )}
                  {mis_info.has_account && (
                    <div className="bg-emerald-500/20 rounded-2xl p-2.5 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-emerald-400 text-base" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                      <p className="text-emerald-300 text-xs font-semibold">В реестре МИС</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Active referrals summary */}
            {activeReferrals.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-bold text-gray-800">Активные направления</h2>
                  <button onClick={() => setTab('referrals')}
                    className="text-sm text-blue-600 font-semibold flex items-center gap-0.5">
                    Все <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </button>
                </div>
                <div className="space-y-3">
                  {activeReferrals.slice(0, 2).map((r, i) => (
                    <div key={r.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${COLORS[i % COLORS.length]} flex items-center justify-center flex-shrink-0`}>
                        <span className="material-symbols-outlined text-white text-base" style={{ fontVariationSettings: "'FILL' 1" }}>local_hospital</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{r.to_clinic_name}</p>
                        <p className="text-xs text-gray-400 truncate">{r.service_name}</p>
                      </div>
                      <StatusPill status={r.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => setTab('referrals')}
                className="bg-white rounded-2xl p-4 text-center border border-gray-100 shadow-sm">
                <p className="text-2xl font-extrabold text-blue-600">{allReferrals.length}</p>
                <p className="text-xs text-gray-400 mt-0.5">Направлений</p>
              </button>
              {mis_visits.length > 0 ? (
                <button onClick={() => setTab('history')}
                  className="bg-white rounded-2xl p-4 text-center border border-gray-100 shadow-sm">
                  <p className="text-2xl font-extrabold text-teal-600">{mis_visits.length}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Приёмов</p>
                </button>
              ) : (
                <div className="bg-white rounded-2xl p-4 text-center border border-gray-100 shadow-sm">
                  <p className="text-2xl font-extrabold text-gray-300">—</p>
                  <p className="text-xs text-gray-400 mt-0.5">Приёмов</p>
                </div>
              )}
              {mis_analyses.length > 0 ? (
                <button onClick={() => setTab('analyses')}
                  className="bg-white rounded-2xl p-4 text-center border border-gray-100 shadow-sm">
                  <p className="text-2xl font-extrabold text-violet-600">{mis_analyses.length}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Анализов</p>
                </button>
              ) : (
                <div className="bg-white rounded-2xl p-4 text-center border border-gray-100 shadow-sm">
                  <p className="text-2xl font-extrabold text-gray-300">—</p>
                  <p className="text-xs text-gray-400 mt-0.5">Анализов</p>
                </div>
              )}
            </div>

            {/* Recent visit */}
            {mis_visits[0] && (
              <div>
                <h2 className="text-base font-bold text-gray-800 mb-3">Последний приём</h2>
                <VisitCard visit={mis_visits[0]} />
              </div>
            )}

            {/* Recent analysis */}
            {mis_analyses[0] && (
              <div>
                <h2 className="text-base font-bold text-gray-800 mb-3">Последний анализ</h2>
                <AnalysisCard analysis={mis_analyses[0]} />
              </div>
            )}
          </div>
        )}

        {/* ─── REFERRALS TAB ─── */}
        {tab === 'referrals' && (
          <div>
            <div className="relative mb-4">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl pointer-events-none">search</span>
              <input type="text" placeholder="Поиск по клинике, услуге..." value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                className="w-full h-12 pl-12 pr-4 bg-white border border-gray-100 text-gray-800 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            {filteredReferrals.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-3xl flex items-center justify-center mb-4">
                  <span className="material-symbols-outlined text-4xl text-gray-300">inbox</span>
                </div>
                <p className="text-gray-400 font-medium">Направлений нет</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredReferrals.map((r, i) => (
                  <ReferralCard key={r.id} referral={r} index={i} onQr={setFullscreenQr} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── HISTORY TAB ─── */}
        {tab === 'history' && (
          <div>
            <h2 className="text-lg font-bold text-gray-800 mb-4">История приёмов</h2>
            {mis_visits.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-3xl flex items-center justify-center mb-4">
                  <span className="material-symbols-outlined text-4xl text-gray-300">history</span>
                </div>
                <p className="text-gray-400 font-medium">История приёмов из МИС</p>
                <p className="text-gray-300 text-sm mt-1">Данные появятся после синхронизации</p>
              </div>
            ) : (
              <div className="space-y-3">
                {mis_visits.map((v, i) => <VisitCard key={i} visit={v} />)}
              </div>
            )}
          </div>
        )}

        {/* ─── ANALYSES TAB ─── */}
        {tab === 'analyses' && (
          <div>
            <h2 className="text-lg font-bold text-gray-800 mb-4">Анализы и исследования</h2>
            {mis_analyses.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-3xl flex items-center justify-center mb-4">
                  <span className="material-symbols-outlined text-4xl text-gray-300">biotech</span>
                </div>
                <p className="text-gray-400 font-medium">Результаты анализов</p>
                <p className="text-gray-300 text-sm mt-1">Данные загружаются из МИС</p>
              </div>
            ) : (
              <div className="space-y-3">
                {mis_analyses.map((a, i) => <AnalysisCard key={i} analysis={a} />)}
              </div>
            )}
          </div>
        )}

        {/* ─── SUPPORT TAB ─── */}
        {tab === 'support' && <SupportTab phone={patient_phone} token={localStorage.getItem(TOKEN_KEY)} />}
      </div>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-gray-100 px-4 pb-safe z-40">
        <div className="max-w-lg mx-auto flex items-center justify-around py-2">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition ${tab === t.key ? 'text-blue-600' : 'text-gray-400'}`}>
              <span className="material-symbols-outlined text-2xl leading-none"
                style={tab === t.key ? { fontVariationSettings: "'FILL' 1" } : {}}>
                {t.icon}
              </span>
              <span className="text-[10px] font-medium">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}

// ─── Support Chat Tab ───
function SupportTab({ phone, token }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  const load = useCallback(async () => {
    if (!phone) return
    try {
      const res = await axios.get(`${API}/support/patient/thread`, { params: { phone } })
      setMessages(Array.isArray(res.data) ? res.data : [])
    } catch {}
    setLoading(false)
  }, [phone])

  useEffect(() => {
    load()
    const id = setInterval(load, 6000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [messages])

  const send = async (e) => {
    e.preventDefault()
    if (!text.trim() || sending) return
    const t = text.trim(); setText(''); setSending(true)
    try {
      await axios.post(`${API}/support/patient/send`, { phone, text: t })
      await load()
    } catch { setText(t) }
    setSending(false)
  }

  if (loading) return <div className="text-center py-10 text-gray-400">Загрузка...</div>

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 160px)' }}>
      <h2 className="text-lg font-bold text-gray-800 mb-3">Поддержка</h2>
      <div className="flex-1 overflow-y-auto space-y-2 mb-3">
        {messages.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">
            <span className="material-symbols-outlined text-4xl block mb-2 text-gray-200">chat</span>
            Напишите нам — мы ответим в рабочее время
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.sender === 'patient' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
              m.sender === 'patient'
                ? 'bg-blue-600 text-white rounded-br-sm'
                : 'bg-white border border-gray-100 text-gray-800 rounded-bl-sm'
            }`}>
              {m.text || m.content}
              <p className={`text-[10px] mt-0.5 ${m.sender === 'patient' ? 'text-blue-200' : 'text-gray-400'}`}>
                {fmt(m.created_at)}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="flex gap-2">
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Сообщение..."
          className="flex-1 h-11 px-4 bg-white border border-gray-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <button type="submit" disabled={!text.trim() || sending}
          className="w-11 h-11 bg-blue-600 text-white rounded-2xl flex items-center justify-center disabled:opacity-50">
          <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
        </button>
      </form>
    </div>
  )
}
