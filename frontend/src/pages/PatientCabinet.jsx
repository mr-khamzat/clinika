import { useEffect, useState, useCallback, useRef } from 'react'
import axios from 'axios'
import { API_BASE, BASE_PATH, SLUG } from '../config'

const API = API_BASE
const TOKEN_KEY = 'clinika_patient_token'
const REF_KEY   = 'clinika_patient_ref'

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtMis(str) {
  if (!str) return '—'
  const m = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']
  const [dp, tp] = str.split(' ')
  if (!dp) return str
  const [d, mo, y] = dp.split('.')
  return tp ? `${+d} ${m[+mo-1]} ${y}, ${tp}` : `${+d} ${m[+mo-1]} ${y}`
}

const STATUS_CFG = {
  created:          { label: 'Активно',      dot: '#3B82F6', bg: 'rgba(59,130,246,.1)',  text: '#1D4ED8' },
  confirmed:        { label: 'Подтверждено', dot: '#10B981', bg: 'rgba(16,185,129,.1)',  text: '#065F46' },
  expired:          { label: 'Истекло',      dot: '#9CA3AF', bg: 'rgba(156,163,175,.1)', text: '#6B7280' },
  cancel_requested: { label: 'На отмене',    dot: '#F59E0B', bg: 'rgba(245,158,11,.1)',  text: '#92400E' },
  cancelled:        { label: 'Отменено',     dot: '#EF4444', bg: 'rgba(239,68,68,.1)',   text: '#991B1B' },
}
const VISIT_STATUS = {
  completed: { label: 'Завершён',  color: '#10B981' },
  upcoming:  { label: 'Предстоит', color: '#3B82F6' },
  refused:   { label: 'Отменён',   color: '#EF4444' },
}
const CARD_GRADS = [
  ['#1565C0','#0D47A1'],
  ['#00695C','#004D40'],
  ['#6A1B9A','#4A148C'],
  ['#E65100','#BF360C'],
  ['#1B5E20','#33691E'],
]

// ── AdBanner component ───────────────────────────────────────────────────────
const AD_THEMES = [
  { bg: 'linear-gradient(135deg,#003845,#0097A7)', glow: 'rgba(0,151,167,.4)' },
  { bg: 'linear-gradient(135deg,#1a0038,#7c3aed)', glow: 'rgba(124,58,237,.4)' },
  { bg: 'linear-gradient(135deg,#7c1900,#ff6a00)', glow: 'rgba(255,106,0,.4)'  },
]
function AdBanner({ ads, idx, setIdx }) {
  if (!ads || ads.length === 0) return null
  const ad = ads[idx]
  const th = AD_THEMES[idx % AD_THEMES.length]
  return (
    <div key={idx}
      onClick={() => { if(ad.link) window.open(ad.link,'_blank'); axios.post(API+'/ads/'+ad.id+'/event',{event_type:'click'}).catch(()=>{}) }}
      className="rounded-2xl p-4 relative overflow-hidden cursor-pointer"
      style={{ background: th.bg, boxShadow: `0 4px 24px ${th.glow}` }}>
      <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
        <div className="absolute inset-0 w-1/2" style={{ background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.06),transparent)', animation: 'shimmer 3s ease-in-out infinite' }} />
      </div>
      <div className="flex items-center gap-3 relative">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,.2)' }}>
          <span className="material-symbols-outlined text-white text-lg" style={{ fontVariationSettings:"'FILL' 1" }}>campaign</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm truncate">{ad.title}</p>
          {ad.body && <p className="text-white/70 text-xs mt-0.5 truncate">{ad.body}</p>}
        </div>
        <span className="text-white/60 text-xs bg-white/10 px-2 py-0.5 rounded-full flex-shrink-0">РЕКЛАМА</span>
      </div>
      {ads.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {ads.map((_,i) => (
            <div key={i} onClick={e=>{e.stopPropagation();setIdx(i)}}
              style={{ width: i===idx ? 16 : 5, height: 5, borderRadius: 3, background: i===idx ? 'white' : 'rgba(255,255,255,.4)', transition: 'all .3s', cursor: 'pointer' }} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Push helpers ──────────────────────────────────────────────────────────────
async function subscribePush(phone, token) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  try {
    const sw = await navigator.serviceWorker.ready
    const keyRes = await axios.get(`${API}/push/vapid-key`)
    const b64 = keyRes.data.public_key.replace(/-/g,'+').replace(/_/g,'/')
    const raw = atob(b64)
    const key = new Uint8Array([...raw].map(c => c.charCodeAt(0)))
    const sub = await sw.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    const s = sub.toJSON()
    await axios.post(`${API}/push/subscribe`, { endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, patient_phone: phone, patient_token: token })
    return true
  } catch { return false }
}
async function registerSW() {
  if (!('serviceWorker' in navigator)) return
  try { await navigator.serviceWorker.register('/' + SLUG + '/sw.js', { scope: '/' + SLUG + '/' }) } catch {}
}

// ── QR Fullscreen ─────────────────────────────────────────────────────────────
function QrFullscreen({ qr, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center" style={{ background: 'linear-gradient(160deg,#0A2342 0%,#1565C0 100%)' }} onClick={onClose}>
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,.15)' }}>
          <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>medical_services</span>
        </div>
        <span className="text-white text-2xl font-extrabold tracking-tight">Clinika</span>
      </div>
      <p className="text-blue-200 text-sm mb-6 text-center px-8">Покажите этот QR-код администратору клиники</p>
      <div className="bg-white rounded-3xl p-5 shadow-2xl" style={{ boxShadow: '0 0 60px rgba(255,255,255,.2)' }}>
        <img src={`data:image/png;base64,${qr}`} alt="QR" className="w-64 h-64 rounded-2xl block" />
      </div>
      <p className="text-blue-300 text-xs mt-8">Нажмите в любом месте, чтобы закрыть</p>
    </div>
  )
}

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, errorMsg }) {
  const [code, setCode] = useState('')
  const [phone, setPhone] = useState('+7')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(errorMsg || '')

  const submit = async (e) => {
    e.preventDefault()
    if (!code || !phone) { setErr('Введите код и телефон'); return }
    setLoading(true); setErr('')
    try {
      const r = await axios.post(`${API}/patient/by-code`, { code: parseInt(code), phone })
      onLogin(r.data.referral_id, r.data.patient_token)
    } catch (e) { setErr(e.response?.data?.detail || 'Направление не найдено') }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5" style={{ background: 'linear-gradient(160deg,#0A2342 0%,#1565C0 60%,#0097A7 100%)' }}>
      <style>{`
        @keyframes floatIn { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        .login-card { animation: floatIn .5s cubic-bezier(.22,1,.36,1) }
      `}</style>
      {/* Logo */}
      <div className="mb-10 text-center login-card">
        <div className="w-24 h-24 rounded-3xl mx-auto mb-5 flex items-center justify-center" style={{ background: 'rgba(255,255,255,.15)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,.2)', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
          <span className="material-symbols-outlined text-white text-5xl" style={{ fontVariationSettings:"'FILL' 1" }}>medical_services</span>
        </div>
        <h1 className="text-4xl font-black text-white tracking-tight">Clinika</h1>
        <p className="text-blue-200 mt-2">Личный кабинет пациента</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm login-card" style={{ animationDelay: '.1s', background: 'rgba(255,255,255,.07)', backdropFilter: 'blur(24px)', borderRadius: 28, border: '1px solid rgba(255,255,255,.12)', padding: 28 }}>
        <h2 className="text-xl font-bold text-white mb-1">Войти в кабинет</h2>
        <p className="text-blue-200 text-sm mb-6">Введите код из направления и ваш телефон</p>
        <form onSubmit={submit} className="space-y-3">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-blue-300 text-xl pointer-events-none">tag</span>
            <input type="number" inputMode="numeric" placeholder="Код направления" value={code} onChange={e => setCode(e.target.value)}
              className="w-full h-14 pl-12 pr-4 rounded-2xl text-white placeholder-blue-300/60 text-base focus:outline-none focus:ring-2 focus:ring-white/30"
              style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)' }} />
          </div>
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-blue-300 text-xl pointer-events-none">phone</span>
            <input type="tel" placeholder="+7 900 000-00-00" value={phone} onChange={e => setPhone(e.target.value)}
              className="w-full h-14 pl-12 pr-4 rounded-2xl text-white placeholder-blue-300/60 text-base focus:outline-none focus:ring-2 focus:ring-white/30"
              style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)' }} />
          </div>
          {err && <div className="flex items-center gap-2 bg-red-500/20 text-red-200 rounded-xl px-3 py-2 text-sm"><span className="material-symbols-outlined text-base">error</span>{err}</div>}
          <button type="submit" disabled={loading}
            className="w-full h-14 rounded-2xl font-bold text-base text-white disabled:opacity-50 transition-all active:scale-[.98]"
            style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)', boxShadow: '0 8px 32px rgba(0,151,167,.4)' }}>
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Поиск...
              </span>
            ) : 'Найти направление'}
          </button>
        </form>
      </div>
      <p className="text-blue-300/60 text-xs mt-8">КлиникаСеть — современная медицина</p>
    </div>
  )
}

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const c = STATUS_CFG[status] || { label: status, dot: '#9CA3AF', bg: 'rgba(156,163,175,.1)', text: '#6B7280' }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: c.bg, color: c.text }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.dot }} />
      {c.label}
    </span>
  )
}

// ── Referral Card ─────────────────────────────────────────────────────────────
function ReferralCard({ referral, index, onQr }) {
  const [g1, g2] = CARD_GRADS[index % CARD_GRADS.length]
  const isActive = referral.status === 'created' || referral.status === 'confirmed'

  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 2px 10px rgba(0,0,0,.07)', border: '1px solid rgba(0,0,0,.06)' }}>
      {/* Compact colour strip */}
      <div className="px-4 py-3 flex items-center gap-3 relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${g1}, ${g2})` }}>
        <div className="absolute -right-3 -top-3 w-16 h-16 rounded-full" style={{ background: 'rgba(255,255,255,.08)' }} />
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 relative"
          style={{ background: 'rgba(255,255,255,.2)' }}>
          <span className="material-symbols-outlined text-white text-base"
            style={{ fontVariationSettings:"'FILL' 1" }}>local_hospital</span>
        </div>
        <div className="flex-1 min-w-0 relative">
          <p className="text-white font-bold text-sm leading-tight truncate">{referral.to_clinic_name || 'Клиника'}</p>
          <p className="text-white/65 text-xs truncate mt-0.5">{referral.service_name}</p>
        </div>
        <StatusBadge status={referral.status} />
      </div>
      {/* Details row */}
      <div className="px-4 py-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[13px] text-gray-400">calendar_today</span>
            <span className="font-semibold text-gray-700">
              {referral.appointment_at ? fmt(referral.appointment_at) : fmt(referral.created_at)}
            </span>
          </span>
          {referral.short_code && (
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px] text-gray-400">tag</span>
              <span className="font-bold text-gray-700 tracking-widest">{referral.short_code}</span>
            </span>
          )}
          {referral.from_clinic_name && (
            <span className="flex items-center gap-1 min-w-0">
              <span className="material-symbols-outlined text-[13px] text-gray-400">arrow_forward</span>
              <span className="truncate">{referral.from_clinic_name}</span>
            </span>
          )}
        </div>
        {referral.notes && (
          <p className="text-xs text-gray-400 italic truncate">"{referral.notes}"</p>
        )}
        {isActive && referral.qr_code && (
          <button onClick={() => onQr(referral.qr_code)}
            className="w-full h-9 rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all active:scale-[.98]"
            style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)', color: 'white', boxShadow: '0 3px 10px rgba(0,151,167,.25)' }}>
            <span className="material-symbols-outlined text-base"
              style={{ fontVariationSettings:"'FILL' 1" }}>qr_code_2</span>
            Показать QR-код
          </button>
        )}
        {referral.status === 'confirmed' && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600">
            <span className="material-symbols-outlined text-sm"
              style={{ fontVariationSettings:"'FILL' 1" }}>check_circle</span>
            <span className="font-semibold">Подтверждено {referral.confirmed_at ? fmt(referral.confirmed_at) : ''}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Visit Card ─────────────────────────────────────────────────────────────────
function fmtMisDate(str) {
  if (!str) return '—'
  const m = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']
  const [dp, tp] = str.split(' ')
  if (!dp) return str
  const [d, mo, y] = dp.split('.')
  return tp ? `${+d} ${m[+mo-1]} ${y}, ${tp}` : `${+d} ${m[+mo-1]} ${y}`
}
const VISIT_COLORS = { completed: '#10B981', upcoming: '#3B82F6', refused: '#EF4444' }

function VisitCard({ visit }) {
  const [open, setOpen] = useState(false)
  const services = Array.isArray(visit.services) ? visit.services : []
  const first = services[0]?.title || '—'
  const doctor = visit.doctor || '—'
  const clinic = visit.clinic || '—'
  const status = visit.status || ''
  const vc = VISIT_STATUS[status] || { label: status, color: '#9CA3AF' }
  const total = visit.sum_value || 0
  const isFirst = visit.is_first_clinic || visit.is_first

  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 2px 12px rgba(0,0,0,.05)' }}>
      <div className="flex items-stretch">
        {/* Left color bar */}
        <div className="w-1 flex-shrink-0 rounded-l-2xl" style={{ background: vc.color }} />
        <div className="flex-1 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-900 text-sm leading-snug truncate">{first}</p>
              <p className="text-xs text-gray-400 mt-0.5 truncate">{doctor}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isFirst && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(124,58,237,.1)', color: '#7C3AED' }}>1-й</span>}
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${vc.color}18`, color: vc.color }}>{vc.label}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <span className="material-symbols-outlined text-sm">schedule</span>
              {fmtMisDate(visit.time_start)}
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-400 truncate">
              <span className="material-symbols-outlined text-sm">location_on</span>
              <span className="truncate">{clinic}</span>
            </span>
          </div>
          {(total > 0 || services.length > 1) && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
              {total > 0 && <span className="text-sm font-extrabold" style={{ color: '#0097A7' }}>{total.toLocaleString('ru-RU')} ₽</span>}
              {services.length > 1 && (
                <button onClick={() => setOpen(v => !v)} className="flex items-center gap-0.5 text-xs font-semibold ml-auto" style={{ color: '#1565C0' }}>
                  {open ? 'Скрыть' : `${services.length} услуг`}
                  <span className="material-symbols-outlined text-sm">{open ? 'expand_less' : 'expand_more'}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {open && services.length > 0 && (
        <div className="px-4 pb-4 space-y-1.5">
          {services.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
              <span className="text-xs text-gray-600 flex-1 mr-3 truncate">{s.title || '—'}</span>
              {(s.value || s.price) && <span className="text-xs font-bold text-gray-800 flex-shrink-0">{parseInt(s.value || s.price || 0).toLocaleString('ru-RU')} ₽</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Support Tab ───────────────────────────────────────────────────────────────
function SupportTab({ phone }) {
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  const load = useCallback(async () => {
    if (!phone) return
    try {
      const r = await axios.get(`${API}/support/patient/thread`, { params: { phone } })
      setMsgs(Array.isArray(r.data) ? r.data : [])
    } catch {}
    setLoading(false)
  }, [phone])

  useEffect(() => { load(); const id = setInterval(load, 6000); return () => clearInterval(id) }, [load])
  useEffect(() => { setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50) }, [msgs])

  const send = async (e) => {
    e.preventDefault()
    if (!text.trim() || sending) return
    const t = text.trim(); setText(''); setSending(true)
    try { await axios.post(`${API}/support/patient/send`, { phone, text: t }); await load() }
    catch { setText(t) }
    setSending(false)
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100svh - 180px)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 p-4 rounded-2xl" style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)' }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,.2)' }}>
          <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>support_agent</span>
        </div>
        <div>
          <p className="font-bold text-white text-sm">Служба поддержки</p>
          <p className="text-blue-100 text-xs">Отвечаем в рабочее время</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
          <span className="text-emerald-300 text-xs font-semibold">Онлайн</span>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2 pb-2">
          {msgs.length === 0 && (
            <div className="flex flex-col items-center py-12 text-center">
              <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg,#E0F2FE,#BAE6FD)' }}>
                <span className="material-symbols-outlined text-blue-400 text-3xl">chat_bubble</span>
              </div>
              <p className="text-gray-500 font-semibold text-sm">Начните диалог</p>
              <p className="text-gray-400 text-xs mt-1">Мы ответим на ваши вопросы</p>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.sender === 'patient' ? 'justify-end' : 'justify-start'}`}>
              {m.sender !== 'patient' && (
                <div className="w-7 h-7 rounded-full flex items-center justify-center mr-2 mt-1 flex-shrink-0" style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)' }}>
                  <span className="material-symbols-outlined text-white text-xs" style={{ fontVariationSettings:"'FILL' 1" }}>support_agent</span>
                </div>
              )}
              <div style={{
                maxWidth: '78%',
                padding: '10px 14px',
                borderRadius: m.sender === 'patient' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                background: m.sender === 'patient' ? 'linear-gradient(135deg,#1565C0,#0097A7)' : 'white',
                boxShadow: '0 2px 8px rgba(0,0,0,.08)',
                border: m.sender !== 'patient' ? '1px solid rgba(0,0,0,.06)' : 'none',
              }}>
                <p className="text-sm" style={{ color: m.sender === 'patient' ? 'white' : '#1F2937' }}>{m.text || m.content}</p>
                <p className="text-[10px] mt-1" style={{ color: m.sender === 'patient' ? 'rgba(255,255,255,.6)' : '#9CA3AF' }}>{fmt(m.created_at)}</p>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      <form onSubmit={send} className="flex gap-2 pt-2">
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Сообщение..."
          className="flex-1 h-12 px-4 rounded-2xl text-sm focus:outline-none"
          style={{ background: 'white', border: '1.5px solid rgba(0,0,0,.08)', boxShadow: '0 2px 8px rgba(0,0,0,.04)' }} />
        <button type="submit" disabled={!text.trim() || sending}
          className="w-12 h-12 rounded-2xl flex items-center justify-center disabled:opacity-40 transition-all active:scale-95"
          style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)' }}>
          <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>send</span>
        </button>
      </form>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function PatientCabinet() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showLogin, setShowLogin] = useState(false)
  const [tab, setTab] = useState('home')
  const [fullscreenQr, setFullscreenQr] = useState(null)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showInstall, setShowInstall] = useState(false)
  const [showIosHint, setShowIosHint] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [bannerAds, setBannerAds] = useState([])
  const [bannerIdx, setBannerIdx] = useState(0)

  useEffect(() => {
    registerSW()
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); setShowInstall(true) }
    window.addEventListener('beforeinstallprompt', handler)
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone
    const dismissed = localStorage.getItem('clinika_ios_hint_ts')
    const staleDays = dismissed ? (Date.now() - parseInt(dismissed)) / 86400000 : 999
    if (isIos && !isStandalone && staleDays > 7) setShowIosHint(true)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    if (bannerAds.length > 1) {
      const id = setInterval(() => setBannerIdx(i => (i+1) % bannerAds.length), 5000)
      return () => clearInterval(id)
    }
  }, [bannerAds.length])

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    const refId = localStorage.getItem(REF_KEY)
    if (token && refId) {
      loadData(refId, token)
      axios.get(`${API}/ads/active`, { params: { slug: SLUG, ad_type: 'banner' } }).then(r => setBannerAds(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    } else {
      setLoading(false); setShowLogin(true)
    }
  }, [])

  const loadData = async (refId, token) => {
    setLoading(true); setError('')
    try {
      const r = await axios.get(`${API}/patient/${refId}?t=${token}`)
      setData(r.data)
    } catch (e) {
      const msg = e.response?.data?.detail || 'Ошибка загрузки'
      setError(msg)
      if (e.response?.status === 403) { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REF_KEY); setShowLogin(true) }
    } finally { setLoading(false) }
  }

  const handleLogin = (refId, token) => {
    localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(REF_KEY, refId)
    setShowLogin(false); loadData(refId, token)
  }

  const handlePushToggle = async () => {
    if (pushEnabled) return
    setPushLoading(true)
    try {
      if ((await Notification.requestPermission()) === 'granted') {
        const ok = await subscribePush(data?.patient_phone, localStorage.getItem(TOKEN_KEY))
        setPushEnabled(ok)
      }
    } catch {}
    setPushLoading(false)
  }

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt(); await deferredPrompt.userChoice
    setDeferredPrompt(null); setShowInstall(false)
  }

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REF_KEY)
    setData(null); setShowLogin(true)
  }

  // ── Loading ──
  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center" style={{ background: 'linear-gradient(160deg,#0A2342 0%,#1565C0 60%,#0097A7 100%)' }}>
      <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-6" style={{ background: 'rgba(255,255,255,.15)', backdropFilter: 'blur(12px)' }}>
        <span className="material-symbols-outlined text-white text-4xl animate-pulse" style={{ fontVariationSettings:"'FILL' 1" }}>medical_services</span>
      </div>
      <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mb-3" />
      <p className="text-blue-200 text-sm">Загрузка кабинета...</p>
    </div>
  )

  if (fullscreenQr) return <QrFullscreen qr={fullscreenQr} onClose={() => setFullscreenQr(null)} />
  if (showLogin) return <LoginScreen onLogin={handleLogin} errorMsg={error} />
  if (!data) return null

  const { current, other_referrals = [], mis_info, mis_visits = [], patient_name, patient_phone } = data
  const allRefs = [current, ...other_referrals]
  const activeRefs = allRefs.filter(r => r.status === 'created' || r.status === 'confirmed')
  const searchedRefs = searchQ ? allRefs.filter(r => (r.to_clinic_name + r.service_name + (r.short_code||'')).toLowerCase().includes(searchQ.toLowerCase())) : allRefs

  const TABS = [
    { key: 'home',      icon: 'home',       label: 'Главная'     },
    { key: 'referrals', icon: 'assignment',  label: 'Направления' },
    { key: 'history',   icon: 'history',     label: 'История'     },
    { key: 'support',   icon: 'chat_bubble', label: 'Чат'         },
  ]

  const initials = (patient_name || patient_phone || 'П').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F0F4F8' }}>
      <style>{`
        @keyframes slideUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes tabSlide { from{opacity:0;transform:translateX(16px)} to{opacity:1;transform:translateX(0)} }
        .tab-enter { animation: tabSlide .25s cubic-bezier(.22,1,.36,1) }
        .card-in { animation: slideUp .35s cubic-bezier(.22,1,.36,1) both }
        @keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
        @keyframes adGlow { 0%,100%{opacity:.7} 50%{opacity:1} }
      `}</style>

      {/* ── Hero Header ── */}
      <div className="relative overflow-hidden" style={{ background: 'linear-gradient(145deg,#0A2342 0%,#1565C0 70%,#0097A7 100%)', paddingBottom: 32 }}>
        {/* Decorative blobs */}
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full" style={{ background: 'rgba(0,151,167,.2)', filter: 'blur(40px)', transform: 'translate(30%,-30%)' }} />
        <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full" style={{ background: 'rgba(255,255,255,.05)', filter: 'blur(30px)', transform: 'translate(-30%,30%)' }} />

        <div className="relative max-w-lg mx-auto px-5 pt-12 pb-2">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-blue-200 text-xs font-medium">Добро пожаловать</p>
              <h1 className="text-white font-extrabold text-xl leading-tight mt-0.5 truncate max-w-[220px]">{patient_name || patient_phone}</h1>
            </div>
            <div className="flex items-center gap-2">
              {!pushEnabled && 'Notification' in window && (
                <button onClick={handlePushToggle} disabled={pushLoading}
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-90"
                  style={{ background: 'rgba(255,255,255,.15)' }}>
                  <span className="material-symbols-outlined text-white text-xl">notifications</span>
                </button>
              )}
              {pushEnabled && (
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(16,185,129,.25)' }}>
                  <span className="material-symbols-outlined text-emerald-300 text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>notifications_active</span>
                </div>
              )}
              <button onClick={handleLogout}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-90"
                style={{ background: 'rgba(255,255,255,.15)' }}>
                <span className="material-symbols-outlined text-white/80 text-xl">logout</span>
              </button>
            </div>
          </div>

          {/* Patient hero card */}
          <div className="rounded-3xl p-5 flex items-center gap-4" style={{ background: 'rgba(255,255,255,.1)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,.15)' }}>
            {/* Avatar */}
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 font-black text-xl text-white" style={{ background: 'linear-gradient(135deg,#0097A7,#0A2342)', boxShadow: '0 4px 16px rgba(0,0,0,.3)' }}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold truncate">{patient_name || '—'}</p>
              <p className="text-blue-200 text-sm truncate">{patient_phone}</p>
              {mis_info?.card_number && (
                <p className="text-blue-300 text-xs mt-0.5">Карта МИС: №{mis_info.card_number}</p>
              )}
            </div>
            {mis_info?.birth_date && (
              <div className="text-right flex-shrink-0">
                <p className="text-blue-200 text-[10px]">Возраст</p>
                <p className="text-white font-bold text-sm">{mis_info.age || mis_info.birth_date}</p>
              </div>
            )}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mt-4">
            {[
              { val: allRefs.length,    label: 'Направлений', tab: 'referrals', icon: 'assignment',  color: '#93C5FD' },
              { val: mis_visits.length, label: 'Визитов',     tab: 'history',   icon: 'history',     color: '#6EE7B7' },
              { val: activeRefs.length, label: 'Активных',    tab: 'referrals', icon: 'radio_button_checked', color: '#FCA5A5' },
            ].map(s => (
              <button key={s.tab + s.label} onClick={() => setTab(s.tab)}
                className="rounded-2xl py-3 px-2 text-center transition-all active:scale-95"
                style={{ background: 'rgba(255,255,255,.12)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,.12)' }}>
                <span className="material-symbols-outlined text-sm mb-1 block" style={{ color: s.color, fontVariationSettings:"'FILL' 1" }}>{s.icon}</span>
                <p className="text-xl font-black text-white leading-none">{s.val}</p>
                <p className="text-[10px] font-medium mt-1" style={{ color: 'rgba(255,255,255,.6)' }}>{s.label}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Ad Banner (top) ── */}
      {bannerAds.length > 0 && (
        <div className="max-w-lg mx-auto px-4 -mt-4 mb-0 relative z-10">
          <AdBanner ads={bannerAds} idx={bannerIdx} setIdx={setBannerIdx} />
        </div>
      )}

      {/* ── Content ── */}
      <div className="max-w-lg mx-auto px-4 pt-5">
        {/* Android PWA — нативный prompt */}
        {showInstall && (
          <div className="rounded-2xl p-4 mb-4 flex items-center gap-3" style={{ background: 'linear-gradient(135deg,#1565C0,#0097A7)', boxShadow: '0 4px 20px rgba(21,101,192,.3)' }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,.2)' }}>
              <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>install_mobile</span>
            </div>
            <div className="flex-1">
              <p className="text-white font-bold text-sm">Добавить на экран «Домой»</p>
              <p className="text-blue-100 text-xs">Открывать как приложение — вход сохранится</p>
            </div>
            <button onClick={handleInstall} className="bg-white text-blue-700 rounded-xl px-3 py-1.5 text-xs font-bold flex-shrink-0">Добавить</button>
            <button onClick={() => setShowInstall(false)} className="text-white/60 text-xl leading-none flex-shrink-0">×</button>
          </div>
        )}

        {/* iOS — ручная подсказка */}
        {showIosHint && (
          <div className="rounded-2xl p-4 mb-4" style={{ background: 'linear-gradient(135deg,#0A2342,#1565C0)', boxShadow: '0 4px 20px rgba(10,35,66,.4)' }}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 text-xl" style={{ background: 'rgba(255,255,255,.15)' }}>📲</div>
              <div className="flex-1">
                <p className="text-white font-bold text-sm mb-1">Добавить на экран «Домой»</p>
                <p className="text-blue-200 text-xs leading-relaxed">
                  Нажмите <span className="bg-white/15 rounded px-1.5 py-0.5 font-semibold text-white">↑ Поделиться</span> → <span className="font-semibold text-white">«На экран «Домой»»</span>
                </p>
                <p className="text-blue-300 text-xs mt-1.5">Авторизация сохранится — вход не потребуется</p>
              </div>
              <button onClick={() => { setShowIosHint(false); localStorage.setItem('clinika_ios_hint_ts', String(Date.now())) }}
                className="text-white/50 text-2xl leading-none flex-shrink-0">×</button>
            </div>
          </div>
        )}

        {/* ── HOME ── */}
        {tab === 'home' && (
          <div className="space-y-5 tab-enter">
            {/* Active QR — show current referral's QR prominently */}
            {current?.status === 'created' && current?.qr_code && (
              <div className="rounded-3xl overflow-hidden" style={{ background: 'linear-gradient(135deg,#0097A7 0%,#1565C0 100%)', boxShadow: '0 8px 32px rgba(0,151,167,.3)' }}>
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                    <p className="text-emerald-300 text-xs font-bold uppercase tracking-wide">Активное направление</p>
                  </div>
                  <h3 className="text-white font-extrabold text-lg leading-tight">{current.to_clinic_name}</h3>
                  <p className="text-blue-200 text-sm mt-0.5">{current.service_name}</p>
                </div>
                <button onClick={() => setFullscreenQr(current.qr_code)}
                  className="w-full py-4 flex items-center justify-center gap-3 transition-all active:opacity-80"
                  style={{ background: 'rgba(0,0,0,.25)', borderTop: '1px solid rgba(255,255,255,.1)' }}>
                  <span className="material-symbols-outlined text-white text-3xl" style={{ fontVariationSettings:"'FILL' 1" }}>qr_code_2</span>
                  <div className="text-left">
                    <p className="text-white font-bold text-base">Показать QR-код</p>
                    <p className="text-blue-200 text-xs">Для предъявления на стойке</p>
                  </div>
                  <span className="material-symbols-outlined text-white/60 text-xl ml-auto">chevron_right</span>
                </button>
              </div>
            )}

            {/* Recent active referrals */}
            {activeRefs.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold text-gray-800">Активные направления</h2>
                  <button onClick={() => setTab('referrals')} className="text-sm font-semibold flex items-center gap-0.5" style={{ color: '#1565C0' }}>
                    Все <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </button>
                </div>
                <div className="space-y-2">
                  {activeRefs.slice(0,2).map((r,i) => (
                    <div key={r.id} className="bg-white rounded-2xl p-3.5 flex items-center gap-3 card-in" style={{ border: '1px solid rgba(0,0,0,.05)', boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `linear-gradient(135deg,${CARD_GRADS[i%CARD_GRADS.length][0]},${CARD_GRADS[i%CARD_GRADS.length][1]})` }}>
                        <span className="material-symbols-outlined text-white text-base" style={{ fontVariationSettings:"'FILL' 1" }}>local_hospital</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-800 truncate">{r.to_clinic_name}</p>
                        <p className="text-xs text-gray-400 truncate">{r.service_name}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {r.short_code && <span className="text-xs font-bold text-gray-500 tracking-wider">{r.short_code}</span>}
                        <StatusBadge status={r.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent visit */}
            {mis_visits.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold text-gray-800">Последний визит</h2>
                  <button onClick={() => setTab('history')} className="text-sm font-semibold flex items-center gap-0.5" style={{ color: '#1565C0' }}>
                    История <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </button>
                </div>
                <VisitCard visit={mis_visits[0]} />
              </div>
            )}

            {/* Empty state */}
            {allRefs.length === 0 && mis_visits.length === 0 && (
              <div className="bg-white rounded-3xl p-8 text-center" style={{ border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 2px 12px rgba(0,0,0,.04)' }}>
                <div className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg,#E0F2FE,#BAE6FD)' }}>
                  <span className="material-symbols-outlined text-blue-400 text-3xl">medical_services</span>
                </div>
                <p className="text-gray-700 font-bold">Добро пожаловать!</p>
                <p className="text-gray-400 text-sm mt-1">Здесь появятся ваши направления и история визитов</p>
              </div>
            )}
          </div>
        )}

        {/* ── REFERRALS ── */}
        {tab === 'referrals' && (
          <div className="tab-enter">
            <div className="relative mb-4">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl pointer-events-none">search</span>
              <input type="text" placeholder="Поиск по клинике, услуге..." value={searchQ} onChange={e => setSearchQ(e.target.value)}
                className="w-full h-12 pl-12 pr-4 rounded-2xl text-sm focus:outline-none focus:ring-2"
                style={{ background: 'white', border: '1.5px solid rgba(0,0,0,.08)', boxShadow: '0 2px 8px rgba(0,0,0,.05)' }} />
            </div>
            {searchedRefs.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-4" style={{ background: '#E5E7EB' }}>
                  <span className="material-symbols-outlined text-3xl text-gray-400">inbox</span>
                </div>
                <p className="text-gray-500 font-semibold">Направлений нет</p>
              </div>
            ) : (
              <div className="space-y-4">
                {searchedRefs.map((r, i) => <ReferralCard key={r.id} referral={r} index={i} onQr={setFullscreenQr} />)}
              </div>
            )}
          </div>
        )}

        {/* ── HISTORY ── */}
        {tab === 'history' && (
          <div className="tab-enter">
            {mis_visits.length === 0 ? (
              <div className="flex flex-col items-center py-20 text-center">
                <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5" style={{ background: 'linear-gradient(135deg,#D1FAE5,#A7F3D0)' }}>
                  <span className="material-symbols-outlined text-4xl text-emerald-500">history</span>
                </div>
                <p className="text-gray-700 font-bold text-base">История пуста</p>
                <p className="text-gray-400 text-sm mt-2 max-w-[240px]">После первого визита в клинику ваша история появится здесь</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-4 p-3 rounded-2xl" style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.15)' }}>
                  <span className="material-symbols-outlined text-emerald-500 text-base" style={{ fontVariationSettings:"'FILL' 1" }}>verified</span>
                  <p className="text-emerald-700 text-xs font-semibold">Данные из медицинской системы клиники</p>
                </div>
                <div className="space-y-3">
                  {mis_visits.map((v, i) => <VisitCard key={i} visit={v} />)}
                </div>
                {bannerAds.length > 0 && (
                  <div className="mt-5">
                    <AdBanner ads={bannerAds} idx={bannerIdx} setIdx={setBannerIdx} />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── SUPPORT ── */}
        {tab === 'support' && (
          <div className="tab-enter">
            <SupportTab phone={patient_phone} token={localStorage.getItem(TOKEN_KEY)} />
          </div>
        )}
      </div>

      {/* ── Bottom Navigation ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40" style={{ background: 'rgba(255,255,255,.95)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(0,0,0,.07)', paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>
        <div className="max-w-lg mx-auto flex items-center justify-around px-2 py-2">
          {TABS.map(t => {
            const isActive = tab === t.key
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className="flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-2xl transition-all"
                style={{ color: isActive ? '#1565C0' : '#9CA3AF', background: isActive ? 'rgba(21,101,192,.08)' : 'transparent' }}>
                <span className="material-symbols-outlined text-2xl leading-none transition-all"
                  style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0", transform: isActive ? 'scale(1.1)' : 'scale(1)' }}>
                  {t.icon}
                </span>
                <span className="text-[10px] font-semibold">{t.label}</span>
                {isActive && <span className="w-1 h-1 rounded-full" style={{ background: '#1565C0' }} />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
