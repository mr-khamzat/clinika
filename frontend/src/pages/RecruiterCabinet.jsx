/**
 * Кабинет рекрутера — premium mobile-first
 */
import { useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../config'

const PRIMARY = '#0097A7'
const DARK    = '#004D5F'

function apiFetch(token, path, opts = {}) {
  return fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-3 border-teal-500 border-t-transparent rounded-full animate-spin" style={{ borderWidth:3 }} />
    </div>
  )
}

// ── QR Popup ──────────────────────────────────────────────────────
function QRPopup({ data, onClose }) {
  const [copied, setCopied] = useState('')
  const copy = (text, key) => { navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 2000) }

  const printQR = () => {
    const w = window.open('', '_blank', 'width=500,height=700')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><title>QR — ${data.full_name}</title><style>
      body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;font-family:sans-serif}
      .card{text-align:center;padding:32px 24px;border:2px solid #e0eaec;border-radius:20px;max-width:380px}
      img{width:220px;height:220px;border-radius:12px;margin:16px auto;display:block}
      h2{font-size:20px;font-weight:800;color:#004D5F;margin:0 0 4px}
      p{font-size:13px;color:#607d8b;margin:2px 0}
      .code{font-size:28px;font-weight:900;color:#0097A7;letter-spacing:6px;margin:20px 0 8px;border:2px dashed #b2dfdb;border-radius:10px;padding:10px}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body>
      <div class="card">
        <h2>${data.full_name}</h2>
        <p>${data.specialization || ''}</p>
        ${data.qr_code ? `<img src="data:image/png;base64,${data.qr_code}" alt="QR" />` : ''}
        <div class="code">${data.username}</div>
        <p style="font-size:12px;color:#90a4ae;margin-top:8px">Используйте этот логин для входа</p>
      </div>
    </body></html>`)
    w.document.close()
    setTimeout(() => { w.print() }, 500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="bg-white w-full max-w-md rounded-t-3xl p-6 pb-safe" style={{ paddingBottom:'calc(1.5rem + env(safe-area-inset-bottom))' }}>
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
        <div className="text-center mb-4">
          <div className="text-lg font-bold text-gray-800 mb-1">Врач зарегистрирован!</div>
          <div className="text-sm text-gray-500">{data.full_name}</div>
        </div>
        {data.qr_code && (
          <img src={`data:image/png;base64,${data.qr_code}`} alt="QR"
            className="w-44 h-44 mx-auto rounded-2xl mb-4" />
        )}
        <div className="bg-teal-50 rounded-2xl p-4 mb-4 text-center">
          <p className="text-xs font-bold text-teal-600 uppercase tracking-wider mb-2">Данные для входа</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between bg-white rounded-xl px-3 py-2">
              <span className="text-xs text-gray-500">Логин</span>
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-800 text-sm">{data.username}</span>
                <button onClick={() => copy(data.username, 'user')}
                  className="text-xs text-teal-600 font-semibold">{copied === 'user' ? '✓' : 'Копировать'}</button>
              </div>
            </div>
            {data.temp_password && (
              <div className="flex items-center justify-between bg-white rounded-xl px-3 py-2">
                <span className="text-xs text-gray-500">Пароль</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-gray-800 text-sm">{data.temp_password}</span>
                  <button onClick={() => copy(data.temp_password, 'pass')}
                    className="text-xs text-teal-600 font-semibold">{copied === 'pass' ? '✓' : 'Копировать'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={printQR} className="flex-1 py-3 rounded-xl text-white font-bold text-sm" style={{ background:'linear-gradient(135deg,#0097A7,#004D5F)' }}>
            Распечатать QR
          </button>
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border-2 border-gray-200 text-gray-600 font-bold text-sm">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Register Form ─────────────────────────────────────────────────
function RegisterTab({ token }) {
  const [clinics, setClinics] = useState([])
  const [form, setForm] = useState({ full_name:'', email:'', phone_number:'', address:'', specialization:'', username:'', password:'', clinic_ids:[] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const f = key => e => setForm(p => ({ ...p, [key]: e.target.value }))
  const toggleClinic = id => setForm(p => ({ ...p, clinic_ids: p.clinic_ids.includes(id) ? p.clinic_ids.filter(x => x !== id) : [...p.clinic_ids, id] }))

  useEffect(() => {
    apiFetch(token, '/recruiter/clinics').then(r => r.json()).then(d => setClinics(Array.isArray(d) ? d : [])).catch(() => {})
  }, [token])

  const submit = async e => {
    e.preventDefault(); setLoading(true); setError('')
    try {
      const r = await apiFetch(token, '/recruiter/register-doctor', { method:'POST', body: JSON.stringify(form) })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Ошибка')
      setResult(data)
      setForm({ full_name:'', email:'', phone_number:'', address:'', specialization:'', username:'', password:'', clinic_ids:[] })
    } catch(e) { setError(e.message) }
    setLoading(false)
  }

  return (
    <div>
      {result && <QRPopup data={result} onClose={() => setResult(null)} />}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-3 mb-4 flex justify-between items-center">
          <span className="text-red-700 text-sm">{error}</span>
          <button onClick={() => setError('')} className="text-red-400 ml-2">✕</button>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
          <h3 className="font-bold text-gray-800 mb-4 text-sm">Данные врача</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">ФИО *</label>
              <input value={form.full_name} onChange={f('full_name')} required placeholder="Иванов Иван Иванович"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 transition" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Email</label>
                <input type="email" value={form.email} onChange={f('email')} placeholder="doctor@mail.ru"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 transition" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Телефон</label>
                <input value={form.phone_number} onChange={f('phone_number')} placeholder="+7..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 transition" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Специализация</label>
              <input value={form.specialization} onChange={f('specialization')} placeholder="Терапевт, хирург..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 transition" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Адрес</label>
              <input value={form.address} onChange={f('address')} placeholder="г. Грозный, ул. ..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 transition" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
          <h3 className="font-bold text-gray-800 mb-1 text-sm">Данные для входа</h3>
          <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2 mb-4">Передайте логин и пароль врачу лично</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Логин *</label>
              <input value={form.username} onChange={f('username')} required placeholder="dr_ivanov"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 transition" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Пароль *</label>
              <input value={form.password} onChange={f('password')} required placeholder="мин. 4 символа"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 transition" />
            </div>
          </div>
        </div>

        {clinics.length > 0 && (
          <div className="bg-white rounded-2xl p-5" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
            <h3 className="font-bold text-gray-800 mb-4 text-sm">Доступ к клиникам</h3>
            <div className="space-y-2">
              {clinics.map(c => (
                <label key={c.id}
                  className={`flex items-center gap-3 cursor-pointer p-3 rounded-xl border-2 transition ${form.clinic_ids.includes(c.id) ? 'border-teal-400 bg-teal-50' : 'border-gray-100 bg-gray-50'}`}>
                  <input type="checkbox" checked={form.clinic_ids.includes(c.id)} onChange={() => toggleClinic(c.id)}
                    className="w-4 h-4 accent-teal-500" />
                  <span className={`text-sm font-medium ${form.clinic_ids.includes(c.id) ? 'text-teal-700' : 'text-gray-700'}`}>{c.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <button type="submit" disabled={loading}
          className="w-full h-13 rounded-2xl text-white font-bold text-sm disabled:opacity-60 transition active:scale-95"
          style={{ height:52, background:'linear-gradient(135deg,#0097A7,#004D5F)' }}>
          {loading ? 'Регистрируем...' : '✓ Зарегистрировать и получить QR'}
        </button>
      </form>
    </div>
  )
}

// ── Doctors ───────────────────────────────────────────────────────
function DoctorsTab({ token }) {
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch(token, '/recruiter/doctors').then(r => r.json())
      .then(d => { setDoctors(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token])

  if (loading) return <Spinner />
  if (!doctors.length) return (
    <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
      <span className="material-symbols-outlined text-5xl text-gray-300 block mb-3" style={{ fontVariationSettings:"'FILL' 1" }}>group</span>
      <p className="font-semibold text-gray-600 mb-1">Нет врачей</p>
      <p className="text-sm text-gray-400">Зарегистрируйте первого врача</p>
    </div>
  )

  return (
    <div className="space-y-3">
      {doctors.map(d => (
        <div key={d.id} className="bg-white rounded-2xl p-4" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-800 text-sm truncate">{d.full_name}</p>
              {d.specialization && <p className="text-xs font-medium mt-0.5" style={{ color:PRIMARY }}>{d.specialization}</p>}
            </div>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ml-2 flex-shrink-0 ${d.is_active ? 'bg-teal-100 text-teal-700' : 'bg-red-100 text-red-600'}`}>
              {d.is_active ? 'Активен' : 'Неактивен'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mb-2">
            {d.phone_number && <span className="text-xs text-gray-500">📞 {d.phone_number}</span>}
            {d.email && <span className="text-xs text-gray-500">✉️ {d.email}</span>}
          </div>
          {d.clinics?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {d.clinics.map(c => (
                <span key={c.id} className="text-xs bg-teal-50 text-teal-700 px-2.5 py-0.5 rounded-full font-semibold">{c.name}</span>
              ))}
            </div>
          )}
          <div className="flex justify-between items-center pt-2 border-t border-gray-100 text-xs text-gray-500">
            <span>Логин: <strong className="text-gray-700">{d.username || '—'}</strong></span>
            <span className="font-bold text-green-600">{Number(d.bonuses_earned || 0).toLocaleString('ru')} ₽</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Bonuses ───────────────────────────────────────────────────────
function BonusesTab({ token }) {
  const [bonuses, setBonuses] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch(token, '/recruiter/bonuses').then(r => r.json())
      .then(d => { setBonuses(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token])

  if (loading) return <Spinner />
  if (!bonuses.length) return (
    <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
      <span className="material-symbols-outlined text-5xl text-gray-300 block mb-3" style={{ fontVariationSettings:"'FILL' 1" }}>payments</span>
      <p className="font-semibold text-gray-600 mb-1">Бонусов пока нет</p>
      <p className="text-sm text-gray-400">Они появятся когда врачи начнут создавать направления</p>
    </div>
  )

  return (
    <div className="space-y-3">
      {bonuses.map(b => (
        <div key={b.id} className="bg-white rounded-2xl p-4 flex items-center justify-between" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
          <div>
            <p className="text-base font-bold text-gray-800">{Number(b.amount).toLocaleString('ru')} ₽</p>
            <p className="text-xs text-gray-500 mt-0.5">{b.doctor_name} · {b.percent_applied}%</p>
            <p className="text-xs text-gray-300 mt-0.5">{new Date(b.created_at).toLocaleDateString('ru')}</p>
          </div>
          <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${b.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {b.status === 'paid' ? '✓ Выплачен' : '⏳ Начислен'}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Percent ───────────────────────────────────────────────────────
function PercentTab({ stats }) {
  const myPercent = stats?.my_percent ?? 0
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-5" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
        <h3 className="font-bold text-gray-800 text-sm mb-4">Мой процент вознаграждения</h3>
        <div className="flex items-center gap-5 mb-5">
          <div className="w-20 h-20 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background:`conic-gradient(${PRIMARY} ${myPercent * 3.6}deg, #e0eaec 0deg)` }}>
            <div className="w-14 h-14 rounded-full bg-white flex items-center justify-center font-black text-lg" style={{ color:DARK }}>
              {myPercent}%
            </div>
          </div>
          <div>
            <p className="font-bold text-gray-800 text-sm">Ваш процент: {myPercent}%</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">С каждого подтверждённого направления вы получаете {myPercent}% от бонуса врача</p>
          </div>
        </div>
        <div className="bg-teal-50 rounded-2xl p-4 space-y-3">
          {[
            { step:'1', text:'Врач создаёт направление' },
            { step:'2', text:'Клиника подтверждает визит' },
            { step:'3', text:'Врач получает бонус' },
            { step:'4', text:`Вы получаете ${myPercent}% от бонуса` },
          ].map(s => (
            <div key={s.step} className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-black flex-shrink-0" style={{ background:PRIMARY }}>{s.step}</div>
              <p className="text-sm text-gray-700">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
      {myPercent === 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
          ⚠️ Ваш процент не установлен. Обратитесь к менеджеру для настройки.
        </div>
      )}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-700">
        💡 Для изменения процента обратитесь к менеджеру франшизы.
      </div>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────
function DashboardTab({ stats, onNavigate }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[
          { label:'Врачей привлечено', value:stats?.doctors_count,   icon:'group',    color:PRIMARY,    bg:'#e0f7fa' },
          { label:'Всего заработано',  value:stats?.total_bonuses != null ? `${Number(stats.total_bonuses).toLocaleString('ru')} ₽` : null, icon:'payments', color:'#16A34A', bg:'#e8f5e9' },
          { label:'К выплате',         value:stats?.pending_bonuses != null ? `${Number(stats.pending_bonuses).toLocaleString('ru')} ₽` : null, icon:'pending', color:'#d97706', bg:'#fff8e1' },
          { label:'Мой %',             value:stats?.my_percent != null ? `${stats.my_percent}%` : null, icon:'percent', color:'#7c3aed', bg:'#f3e8ff' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-2xl p-4 flex items-center gap-3" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:c.bg }}>
              <span className="material-symbols-outlined text-xl" style={{ color:c.color, fontVariationSettings:"'FILL' 1" }}>{c.icon}</span>
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium leading-tight">{c.label}</p>
              <p className="text-lg font-black text-gray-800">{c.value ?? (stats ? '0' : '—')}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => onNavigate('register')}
          className="bg-white rounded-2xl p-4 text-center active:scale-95 transition-transform" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
          <div className="w-12 h-12 rounded-2xl mx-auto mb-2 flex items-center justify-center" style={{ background:'linear-gradient(135deg,#0097A7,#004D5F)' }}>
            <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>person_add</span>
          </div>
          <p className="text-sm font-semibold text-gray-700">Зарегистрировать врача</p>
        </button>
        <button onClick={() => onNavigate('doctors')}
          className="bg-white rounded-2xl p-4 text-center active:scale-95 transition-transform" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
          <div className="w-12 h-12 rounded-2xl mx-auto mb-2 flex items-center justify-center" style={{ background:'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
            <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>group</span>
          </div>
          <p className="text-sm font-semibold text-gray-700">Мои врачи</p>
        </button>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────
export default function RecruiterCabinet({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('dashboard')
  const [stats, setStats] = useState(null)
  const [statsError, setStatsError] = useState(false)

  const loadStats = useCallback(() => {
    setStatsError(false)
    apiFetch(adminToken, '/recruiter/stats')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => setStats(d))
      .catch(() => { setStats({ doctors_count:0, total_bonuses:0, pending_bonuses:0, paid_bonuses:0, my_percent:0 }); setStatsError(true) })
  }, [adminToken])

  useEffect(() => { loadStats() }, [loadStats])

  const TABS = [
    { key:'dashboard', label:'Главная',      icon:'home'       },
    { key:'register',  label:'Регистрация',  icon:'person_add' },
    { key:'doctors',   label:'Врачи',        icon:'group'      },
    { key:'bonuses',   label:'Бонусы',       icon:'payments'   },
    { key:'percent',   label:'Мой %',        icon:'percent'    },
  ]

  return (
    <div className="min-h-screen bg-[#f7f9fb]" style={{ fontFamily:"'Inter',sans-serif" }}>

      {/* Gradient Header */}
      <div className="relative overflow-hidden px-4 pt-12 pb-6"
        style={{ background:'linear-gradient(135deg,#004D5F 0%,#0097A7 100%)' }}>
        <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background:'rgba(255,255,255,0.18)', backdropFilter:'blur(10px)' }}>
            <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>person_search</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-base truncate">{user?.full_name || 'Рекрутер'}</p>
            <p className="text-white/70 text-xs">Кабинет рекрутера</p>
          </div>
          <button onClick={onLogout} className="w-11 h-11 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background:'rgba(255,255,255,0.12)' }}>
            <span className="material-symbols-outlined text-white/80 text-lg">logout</span>
          </button>
        </div>
        {stats && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { label:'Врачей', value:stats.doctors_count ?? 0 },
              { label:'Мой %',  value:`${stats.my_percent ?? 0}%` },
              { label:'₽',      value:Number(stats.total_bonuses ?? 0).toLocaleString('ru') },
            ].map(s => (
              <div key={s.label} className="rounded-xl p-2 text-center" style={{ background:'rgba(255,255,255,0.12)' }}>
                <p className="text-white font-black text-lg leading-none">{s.value}</p>
                <p className="text-white/60 text-xs mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-4 py-4 pb-28">
        {statsError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-3 mb-4 flex justify-between items-center">
            <span className="text-red-700 text-sm">Не удалось загрузить статистику</span>
            <button onClick={loadStats} className="text-teal-600 text-sm font-semibold">Повторить</button>
          </div>
        )}
        {tab === 'dashboard' && <DashboardTab stats={stats} onNavigate={setTab} />}
        {tab === 'register'  && <RegisterTab token={adminToken} />}
        {tab === 'doctors'   && <DoctorsTab token={adminToken} />}
        {tab === 'bonuses'   && <BonusesTab token={adminToken} />}
        {tab === 'percent'   && <PercentTab stats={stats} />}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-50"
        style={{ paddingBottom:'env(safe-area-inset-bottom)', background:'rgba(255,255,255,0.95)', backdropFilter:'blur(20px)', borderTop:'1px solid rgba(0,0,0,0.06)' }}>
        <div className="flex">
          {TABS.map(item => (
            <button key={item.key} onClick={() => setTab(item.key)}
              className="flex-1 flex flex-col items-center justify-center pt-2 pb-1 min-h-[56px] gap-0.5 relative">
              {tab === item.key && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full" style={{ background:PRIMARY }} />}
              <span className="material-symbols-outlined text-2xl" style={{ color:tab === item.key ? PRIMARY : '#9ca3af', fontVariationSettings:tab === item.key ? "'FILL' 1" : "'FILL' 0" }}>{item.icon}</span>
              <span className="text-xs font-semibold" style={{ color:tab === item.key ? PRIMARY : '#9ca3af' }}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
