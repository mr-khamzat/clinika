/**
 * Личный кабинет врача
 * Доступен при role === 'doctor' через /clinika/admin
 */
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import useAuthStore from '../store/auth'
import { API_BASE, BASE_PATH, SLUG } from '../config'

const API = API_BASE

function authH(token) {
  return { Authorization: `Bearer ${token}` }
}

function apiFetch(method, url, token, data) {
  return axios({ method, url: `${API}${url}`, headers: authH(token), data })
}

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin" /></div>
}

function StatCard({ label, value, color = 'text-gray-800', icon }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className="material-symbols-outlined text-teal-600 text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>{icon}</span>}
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      </div>
      <p className={`text-3xl font-extrabold ${color}`}>{value ?? '—'}</p>
    </div>
  )
}

// ─── Schedule Tab ───
function ScheduleTab({ token, doctorId }) {
  const [schedule, setSchedule] = useState(null)
  const [loading, setLoading] = useState(true)
  const today = new Date().toISOString().split('T')[0]
  const [date, setDate] = useState(today)

  useEffect(() => {
    apiFetch('get', `/doctors/${doctorId}/slots?date=${date}`, token)
      .then(r => setSchedule(r.data))
      .catch(() => setSchedule(null))
      .finally(() => setLoading(false))
  }, [token, doctorId, date])

  if (loading) return <Spinner />

  const slots = schedule?.slots || []
  const booked = slots.filter(s => s.appointment_id)
  const free = slots.filter(s => !s.appointment_id)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input type="date" value={date} onChange={e => { setDate(e.target.value); setLoading(true) }}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-teal-500" />
        <div className="flex gap-3">
          <StatCard label="Запись" value={booked.length} color="text-blue-600" icon="event_available" />
          <StatCard label="Свободно" value={free.length} color="text-emerald-600" icon="event_available" />
        </div>
      </div>

      {slots.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
          <span className="material-symbols-outlined text-4xl text-gray-200 block mb-2">calendar_today</span>
          <p className="text-gray-400">Расписание не настроено на эту дату</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {slots.map((slot, i) => (
            <div key={i} className={`rounded-xl p-3 text-center border ${
              slot.appointment_id
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}>
              <p className="text-base font-bold">{slot.time}</p>
              {slot.patient_name && <p className="text-xs mt-0.5 truncate">{slot.patient_name}</p>}
              {!slot.appointment_id && <p className="text-xs opacity-60">Свободно</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Appointments Tab ───
function AppointmentsTab({ token, doctorId }) {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('get', `/appointments?doctor_id=${doctorId}&limit=50`, token)
      .then(r => setAppointments(Array.isArray(r.data) ? r.data : r.data?.appointments || []))
      .catch(() => setAppointments([]))
      .finally(() => setLoading(false))
  }, [token, doctorId])

  if (loading) return <Spinner />

  const STATUS = {
    pending:   { label: 'Ожидает', bg: 'bg-yellow-100 text-yellow-700' },
    confirmed: { label: 'Подтверждено', bg: 'bg-emerald-100 text-emerald-700' },
    cancelled: { label: 'Отменено', bg: 'bg-red-100 text-red-600' },
    completed: { label: 'Завершено', bg: 'bg-gray-100 text-gray-600' },
    no_show:   { label: 'Не пришёл', bg: 'bg-orange-100 text-orange-700' },
  }

  return (
    <div>
      {appointments.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center border border-gray-100">
          <span className="material-symbols-outlined text-4xl text-gray-200 block mb-2">person_off</span>
          <p className="text-gray-400">Нет записей</p>
        </div>
      ) : (
        <div className="space-y-2">
          {appointments.map(a => {
            const st = STATUS[a.status] || { label: a.status, bg: 'bg-gray-100 text-gray-600' }
            return (
              <div key={a.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-teal-600 text-lg">person</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800">{a.patient_name}</p>
                  <p className="text-xs text-gray-400">{a.patient_phone} · {a.service_name || '—'}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-medium text-gray-700">{a.appointment_date} {a.appointment_time}</p>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.bg}`}>{st.label}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Referrals directed to this doctor's clinic ───
function ReferralsTab({ token }) {
  const [referrals, setReferrals] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('get', '/manager/referrals/?limit=50', token)
      .then(r => setReferrals(Array.isArray(r.data) ? r.data : r.data?.referrals || []))
      .catch(() => setReferrals([]))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <Spinner />

  const STATUS = {
    created:   { label: 'Активно', bg: 'bg-blue-100 text-blue-700' },
    confirmed: { label: 'Выполнено', bg: 'bg-emerald-100 text-emerald-700' },
    expired:   { label: 'Истекло', bg: 'bg-gray-100 text-gray-500' },
    cancelled: { label: 'Отменено', bg: 'bg-red-100 text-red-600' },
    cancel_requested: { label: 'На отмене', bg: 'bg-yellow-100 text-yellow-700' },
  }

  return (
    <div>
      {referrals.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center border border-gray-100">
          <p className="text-gray-400">Нет направлений</p>
        </div>
      ) : (
        <div className="space-y-2">
          {referrals.slice(0, 30).map(r => {
            const st = STATUS[r.status] || { label: r.status, bg: 'bg-gray-100 text-gray-600' }
            return (
              <div key={r.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800">{r.patient_name}</p>
                  <p className="text-xs text-gray-400">{r.service_name} · {r.to_clinic_name}</p>
                  <p className="text-xs text-gray-400">{new Date(r.created_at).toLocaleDateString('ru-RU')}</p>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded-full flex-shrink-0 ${st.bg}`}>{st.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main DoctorLayout ───
export default function DoctorLayout({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('schedule')
  const [doctorInfo, setDoctorInfo] = useState(null)
  const [dark, setDark] = useState(() => localStorage.getItem('adminTheme') === 'dark')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('adminTheme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    // Load doctor info linked to this user account
    apiFetch('get', `/my-doctor`, adminToken)
      .then(r => setDoctorInfo(r.data))
      .catch(() => {})
  }, [adminToken])

  const doctorId = doctorInfo?.id
  const todayStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

  const TABS = [
    { key: 'schedule', label: 'Расписание', icon: 'calendar_month' },
    { key: 'appointments', label: 'Записи', icon: 'event_note' },
    { key: 'referrals', label: 'Направления', icon: 'assignment' },
  ]

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950 font-sans">
      {/* Sidebar */}
      <aside className="hidden md:flex w-60 bg-slate-800 text-white flex-col">
        <div className="px-6 py-6">
          <div className="w-10 h-10 rounded-full bg-teal-600 flex items-center justify-center mb-3">
            <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>stethoscope</span>
          </div>
          <p className="font-bold text-base leading-tight">{user?.full_name || 'Врач'}</p>
          {doctorInfo?.specialty && <p className="text-slate-400 text-xs mt-0.5">{doctorInfo.specialty}</p>}
          <p className="text-slate-500 text-xs mt-1">{todayStr}</p>
        </div>
        <nav className="flex-1 px-2">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-left transition mb-0.5
                ${tab === t.key ? 'bg-teal-600/20 text-white font-bold border-l-4 border-teal-500' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
              <span className="material-symbols-outlined text-[18px]"
                style={tab === t.key ? { fontVariationSettings: "'FILL' 1" } : {}}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="px-4 pb-6 space-y-2">
          <button onClick={() => setDark(d => !d)}
            className="w-full flex items-center gap-2 px-4 py-2 rounded-lg text-slate-400 hover:text-white text-sm transition">
            <span className="material-symbols-outlined text-[18px]">{dark ? 'light_mode' : 'dark_mode'}</span>
            {dark ? 'Светлая тема' : 'Тёмная тема'}
          </button>
          <button onClick={onLogout}
            className="w-full flex items-center gap-2 px-4 py-2 rounded-lg text-slate-400 hover:text-red-400 text-sm transition">
            <span className="material-symbols-outlined text-[18px]">logout</span>
            Выйти
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-6 overflow-y-auto">
        {/* Mobile header */}
        <div className="md:hidden flex items-center justify-between mb-4">
          <div>
            <p className="font-bold text-gray-800 dark:text-white">{user?.full_name}</p>
            <p className="text-xs text-gray-400">{doctorInfo?.specialty}</p>
          </div>
          <button onClick={onLogout} className="text-sm text-red-500">Выйти</button>
        </div>

        {/* Mobile tabs */}
        <div className="md:hidden flex gap-1 bg-white rounded-xl p-1 mb-4 shadow-sm border border-gray-100">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition ${tab === t.key ? 'bg-teal-600 text-white' : 'text-gray-500'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold text-gray-800 dark:text-white">
            {TABS.find(t => t.key === tab)?.label}
          </h1>
          {doctorInfo && (
            <p className="text-sm text-gray-400 mt-0.5">
              {doctorInfo.full_name} · {doctorInfo.specialty} · {doctorInfo.clinic_name}
            </p>
          )}
        </div>

        {!doctorId && tab !== 'referrals' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 mb-4">
            <p className="text-yellow-700 text-sm">Профиль врача не найден. Обратитесь к администратору для привязки кабинета.</p>
          </div>
        )}

        {tab === 'schedule' && doctorId && <ScheduleTab token={adminToken} doctorId={doctorId} />}
        {tab === 'appointments' && doctorId && <AppointmentsTab token={adminToken} doctorId={doctorId} />}
        {tab === 'referrals' && <ReferralsTab token={adminToken} />}
      </main>
    </div>
  )
}
