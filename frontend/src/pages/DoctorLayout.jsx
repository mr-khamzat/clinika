/**
 * Личный кабинет врача — Premium Mobile-First
 */
import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import WeekScheduleSection from '../sections/scheduling/WeekScheduleSection'

function authH(t) { return { Authorization: `Bearer ${t}` } }
function apiFetch(m, u, t, d) { return axios({ method: m, url: `${API_BASE}${u}`, headers: authH(t), data: d }) }

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#0097A7', borderTopColor: 'transparent' }} />
    </div>
  )
}

function EmptyState({ icon, text }) {
  return (
    <div className="flex flex-col items-center py-16 gap-3">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(0,151,167,0.08)' }}>
        <span className="material-symbols-outlined text-3xl" style={{ color: '#0097A7' }}>{icon}</span>
      </div>
      <p className="text-gray-400 text-sm text-center">{text}</p>
    </div>
  )
}

function ScheduleTab({ token, doctorId, doctorName }) {
  return (
    <WeekScheduleSection
      token={token}
      mode="self"
      selfDoctorId={doctorId}
      selfDoctorName={doctorName}
    />
  )
}

function AppointmentsTab({ token, doctorId }) {
  const [apts, setApts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('get', `/appointments?doctor_id=${doctorId}&limit=50`, token)
      .then(r => setApts(Array.isArray(r.data) ? r.data : r.data?.appointments || []))
      .catch(() => setApts([]))
      .finally(() => setLoading(false))
  }, [token, doctorId])

  const STATUS = {
    pending:   { l: 'Ожидает',    bg: '#fff3e0', c: '#e65100' },
    confirmed: { l: 'Подтверждён',bg: '#e8f5e9', c: '#2e7d32' },
    cancelled: { l: 'Отменён',    bg: '#fce4ec', c: '#c62828' },
    completed: { l: 'Завершён',   bg: '#f5f5f5', c: '#616161' },
    no_show:   { l: 'Не пришёл', bg: '#fff8e1', c: '#f57f17' },
  }

  if (loading) return <Spinner />
  if (!apts.length) return <EmptyState icon="event_note" text="Записей нет" />

  return (
    <div className="space-y-2">
      {apts.map(a => {
        const st = STATUS[a.status] || { l: a.status, bg: '#f5f5f5', c: '#616161' }
        return (
          <div key={a.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(0,151,167,0.08)' }}>
              <span className="material-symbols-outlined text-[18px]" style={{ color: '#0097A7', fontVariationSettings:"'FILL' 1" }}>person</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-gray-900 text-sm leading-tight">{a.patient_name}</div>
              <div className="text-xs text-gray-400 mt-0.5">{a.patient_phone} · {a.service_name || '—'}</div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-xs font-medium text-gray-600">{a.appointment_date}</div>
              <div className="text-xs font-bold text-gray-900">{a.appointment_time}</div>
              <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mt-1"
                style={{ background: st.bg, color: st.c }}>{st.l}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ReferralsTab({ token }) {
  const [refs, setRefs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('get', '/manager/referrals/?limit=50', token)
      .then(r => setRefs(Array.isArray(r.data) ? r.data : r.data?.referrals || []))
      .catch(() => setRefs([]))
      .finally(() => setLoading(false))
  }, [token])

  const STATUS = {
    created:   { l: 'Активно',   bg: '#e3f2fd', c: '#1565c0' },
    confirmed: { l: 'Выполнено', bg: '#e8f5e9', c: '#2e7d32' },
    expired:   { l: 'Истекло',   bg: '#f5f5f5', c: '#757575' },
    cancelled: { l: 'Отменено',  bg: '#fce4ec', c: '#c62828' },
    cancel_requested: { l: 'На отмене', bg: '#fff3e0', c: '#e65100' },
  }

  if (loading) return <Spinner />
  if (!refs.length) return <EmptyState icon="assignment" text="Направлений нет" />

  return (
    <div className="space-y-2">
      {refs.slice(0, 50).map(r => {
        const st = STATUS[r.status] || { l: r.status, bg: '#f5f5f5', c: '#616161' }
        return (
          <div key={r.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-gray-900 text-sm">{r.patient_name}</div>
              <div className="text-xs text-gray-400 mt-0.5">{r.service_name}</div>
              <div className="text-xs text-gray-400">{r.to_clinic_name} · {new Date(r.created_at).toLocaleDateString('ru')}</div>
            </div>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
              style={{ background: st.bg, color: st.c }}>{st.l}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function DoctorLayout({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('referrals')
  const [doctorInfo, setDoctorInfo] = useState(null)

  useEffect(() => {
    apiFetch('get', '/my-doctor', adminToken).then(r => setDoctorInfo(r.data)).catch(() => {})
  }, [adminToken])

  const doctorId = doctorInfo?.id
  const userName = user?.full_name || 'Врач'
  const userInit = userName[0].toUpperCase()
  const todayStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

  const TABS = [
    { key: 'schedule',     label: 'Расписание',  icon: 'calendar_month' },
    { key: 'appointments', label: 'Записи',       icon: 'event_note' },
    { key: 'referrals',   label: 'Направления',  icon: 'assignment' },
  ]
  const activeTab = TABS.find(t => t.key === tab)

  return (
    <div className="flex min-h-screen font-sans" style={{ background: '#F0F4F8' }}>

      {/* DESKTOP SIDEBAR */}
      <aside className="hidden md:flex flex-col w-60 flex-shrink-0 sticky top-0 h-screen"
        style={{ background: 'linear-gradient(180deg,#003d4d 0%,#004D5F 100%)' }}>
        {/* Profile */}
        <div className="px-5 pt-7 pb-5">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-bold text-white mb-3 shadow-lg"
            style={{ background: 'linear-gradient(135deg,#0097A7,#00c4d9)' }}>
            {userInit}
          </div>
          <div className="text-white font-bold text-[15px] leading-tight">{userName}</div>
          {doctorInfo?.specialty && <div className="text-[12px] mt-0.5" style={{ color: '#00d4eb' }}>{doctorInfo.specialty}</div>}
          <div className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>{todayStr}</div>
        </div>
        {/* Nav */}
        <nav className="flex-1 px-3 space-y-0.5">
          {TABS.map(t => {
            const isActive = tab === t.key
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-left transition-all"
                style={isActive ? {
                  background: 'linear-gradient(90deg,rgba(0,151,167,0.25),rgba(0,151,167,0.08))',
                  color: '#00d4eb',
                } : { color: 'rgba(255,255,255,0.45)' }}>
                <span className="material-symbols-outlined text-[19px]"
                  style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0",
                    color: isActive ? '#00d4eb' : undefined }}>
                  {t.icon}
                </span>
                <span className={'font-' + (isActive ? 'semibold' : 'medium')}>{t.label}</span>
              </button>
            )
          })}
        </nav>
        {/* Footer */}
        <div className="px-3 pb-4">
          <button onClick={onLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition"
            style={{ color: 'rgba(255,255,255,0.35)' }}>
            <span className="material-symbols-outlined text-[18px]">logout</span>
            Выйти
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* MOBILE HEADER */}
        <header className="md:hidden sticky top-0 z-20 flex items-center gap-3 px-4 py-3 border-b border-white/10"
          style={{ background: 'linear-gradient(135deg,#003d4d,#004D5F)', backdropFilter: 'blur(12px)' }}>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#00d4eb' }}>Кабинет врача</div>
            <div className="text-white font-bold text-base leading-tight">{activeTab?.label}</div>
          </div>
          <button onClick={onLogout}
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.08)' }}>
            <span className="material-symbols-outlined text-[18px] text-white">logout</span>
          </button>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#0097A7,#005F6B)' }}>
            {userInit}
          </div>
        </header>

        {/* DESKTOP HEADER */}
        <header className="hidden md:flex items-center justify-between px-8 py-4 bg-white/80 sticky top-0 z-10 border-b border-gray-100"
          style={{ backdropFilter: 'blur(12px)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(0,151,167,0.1)' }}>
              <span className="material-symbols-outlined text-[18px]" style={{ color: '#0097A7', fontVariationSettings:"'FILL' 1" }}>
                {activeTab?.icon || 'stethoscope'}
              </span>
            </div>
            <h1 className="font-bold text-gray-900 text-lg">{activeTab?.label}</h1>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="text-right">
              <div className="text-sm font-semibold text-gray-900">{userName}</div>
              {doctorInfo?.specialty && <div className="text-[11px] text-gray-400">{doctorInfo.specialty}</div>}
            </div>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#0097A7,#005F6B)' }}>
              {userInit}
            </div>
            <button onClick={onLogout}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 transition">
              <span className="material-symbols-outlined text-[19px]">logout</span>
            </button>
          </div>
        </header>

        {/* CONTENT */}
        <main className="flex-1 px-4 md:px-8 py-5 pb-24 md:pb-8 max-w-3xl mx-auto w-full">
          {!doctorId && tab !== 'referrals' && (
            <div className="mb-4 rounded-2xl px-4 py-3 text-sm"
              style={{ background: 'rgba(0,151,167,0.08)', border: '1px solid rgba(0,151,167,0.2)', color: '#005F6B' }}>
              Расписание и записи доступны после привязки кабинета администратором.
            </div>
          )}
          {tab === 'schedule'     && doctorId && <ScheduleTab token={adminToken} doctorId={doctorId} doctorName={doctorInfo?.full_name || userName} />}
          {tab === 'appointments' && doctorId && <AppointmentsTab token={adminToken} doctorId={doctorId} />}
          {tab === 'referrals'   && <ReferralsTab token={adminToken} />}
        </main>
      </div>

      {/* MOBILE BOTTOM NAV */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex"
        style={{
          background: 'rgba(0,61,77,0.97)',
          backdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.3)',
        }}>
        {TABS.map(t => {
          const isActive = tab === t.key
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 relative">
              {isActive && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full" style={{ background: '#00d4eb' }} />}
              <span className="material-symbols-outlined text-[22px]"
                style={{ color: isActive ? '#00d4eb' : '#4a7080', fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}>
                {t.icon}
              </span>
              <span className="text-[10px] font-semibold leading-none"
                style={{ color: isActive ? '#00d4eb' : '#4a7080' }}>
                {t.label}
              </span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
