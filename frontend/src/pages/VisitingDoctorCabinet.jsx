import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

const NAV = [
  { key: 'dashboard', label: 'Главная',   icon: 'dashboard' },
  { key: 'visits',    label: 'Приёмы',    icon: 'medical_services' },
  { key: 'income',    label: 'Доход',      icon: 'payments' },
  { key: 'period',    label: 'Период',     icon: 'date_range' },
]

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' })
}
function fmtDt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
}

export default function VisitingDoctorCabinet({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('dashboard')
  const [visits, setVisits] = useState([])
  const [income, setIncome] = useState([])
  const [settings, setSettings] = useState([])
  const [sideOpen, setSideOpen] = useState(false)

  const hdr = { headers: { Authorization: `Bearer ${adminToken}` } }

  useEffect(() => {
    if (tab === 'dashboard' || tab === 'visits') {
      axios.get(API_BASE + '/visiting/my-visits', hdr).then(r => setVisits(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    }
    if (tab === 'income' || tab === 'dashboard') {
      axios.get(API_BASE + '/visiting/my-income', hdr).then(r => setIncome(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    }
    if (tab === 'period') {
      axios.get(API_BASE + '/visiting/admin/settings', hdr).then(r => setSettings(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    }
  }, [tab])

  const totalIncome = income.reduce((s, e) => s + parseFloat(e.amount || 0), 0)
  const completedVisits = visits.filter(v => v.status === 'completed' || v.status === 'confirmed').length

  const STATUS_COLOR = {
    scheduled: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
    confirmed: 'bg-green-100 text-green-700',
  }
  const STATUS_LABEL = {
    scheduled: 'Запланирован', completed: 'Завершён', cancelled: 'Отменён', confirmed: 'Подтверждён',
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-100 flex flex-col transition-transform duration-200
        ${sideOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static`}>
        <div className="h-16 flex items-center px-5 border-b border-gray-100">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center mr-3"
            style={{ background: 'linear-gradient(135deg,#7C3AED,#0097A7)' }}>
            <span className="material-symbols-outlined text-white text-base" style={{ fontVariationSettings:"'FILL' 1" }}>medical_services</span>
          </div>
          <div className="min-w-0">
            <p className="font-bold text-gray-800 text-sm truncate">{user?.full_name}</p>
            <p className="text-xs text-gray-400 truncate">Выездной врач</p>
          </div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {NAV.map(item => (
            <button key={item.key} onClick={() => { setTab(item.key); setSideOpen(false) }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all
                ${tab === item.key ? 'bg-violet-50 text-violet-700' : 'text-gray-600 hover:bg-gray-50'}`}>
              <span className="material-symbols-outlined text-base"
                style={{ fontVariationSettings: tab === item.key ? "'FILL' 1" : "'FILL' 0" }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-100">
          <button onClick={onLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-500 hover:bg-gray-50">
            <span className="material-symbols-outlined text-base">logout</span>Выйти
          </button>
        </div>
      </aside>
      {sideOpen && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setSideOpen(false)} />}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-gray-100 flex items-center px-4 gap-3">
          <button className="lg:hidden p-2 rounded-xl hover:bg-gray-100" onClick={() => setSideOpen(true)}>
            <span className="material-symbols-outlined text-gray-600">menu</span>
          </button>
          <h1 className="font-bold text-gray-800">{NAV.find(n => n.key === tab)?.label}</h1>
        </header>

        <main className="flex-1 p-4 overflow-y-auto">
          {/* Dashboard */}
          {tab === 'dashboard' && (
            <div className="space-y-4 max-w-xl">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <p className="text-xs text-gray-400">Всего приёмов</p>
                  <p className="text-2xl font-bold text-gray-800 mt-1">{visits.length}</p>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <p className="text-xs text-gray-400">Завершено</p>
                  <p className="text-2xl font-bold text-green-600 mt-1">{completedVisits}</p>
                </div>
                <div className="col-span-2 bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <p className="text-xs text-gray-400">Начислено ₽</p>
                  <p className="text-2xl font-bold text-violet-600 mt-1">{Math.round(totalIncome)}</p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Ближайшие приёмы</p>
                {visits.slice(0, 3).map(v => (
                  <div key={v.id} className="bg-white rounded-xl p-3 border border-gray-100 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{v.patient_name || 'Пациент'}</p>
                      <p className="text-xs text-gray-400">{fmtDt(v.scheduled_at || v.created_at)}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[v.status] || 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[v.status] || v.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Приёмы */}
          {tab === 'visits' && (
            <div className="max-w-xl space-y-3">
              {visits.length === 0 && <p className="text-gray-400 text-sm text-center py-10">Нет приёмов</p>}
              {visits.map(v => (
                <div key={v.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0">
                      <span className="material-symbols-outlined text-violet-600 text-base" style={{ fontVariationSettings:"'FILL' 1" }}>medical_services</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 text-sm truncate">{v.patient_name || 'Пациент'}</p>
                      <p className="text-xs text-gray-400">{fmtDt(v.scheduled_at || v.created_at)}</p>
                      {v.price && <p className="text-xs text-gray-500 mt-0.5">Цена: {v.price} ₽</p>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLOR[v.status] || 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[v.status] || v.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Доход */}
          {tab === 'income' && (
            <div className="max-w-xl space-y-3">
              {income.length === 0 && <p className="text-gray-400 text-sm text-center py-10">Нет начислений</p>}
              {income.map(e => (
                <div key={e.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-violet-600 text-base" style={{ fontVariationSettings:"'FILL' 1" }}>payments</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{e.operation_type}</p>
                    <p className="text-xs text-gray-400">{fmt(e.created_at)}</p>
                  </div>
                  <p className="font-bold text-violet-600 text-sm">+{e.amount} ₽</p>
                </div>
              ))}
            </div>
          )}

          {/* Период работы */}
          {tab === 'period' && (
            <div className="max-w-xl space-y-3">
              {settings.length === 0 && <p className="text-gray-400 text-sm text-center py-10">Нет настроек периода</p>}
              {settings.map(s => (
                <div key={s.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">Ставка за визит: {s.price_per_visit} ₽</p>
                      <p className="text-xs text-gray-400 mt-0.5">Доля врача: {s.doctor_percent}%</p>
                      <p className="text-xs text-gray-400">
                        {fmt(s.start_date)} — {s.end_date ? fmt(s.end_date) : 'бессрочно'}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {s.is_active ? 'Активно' : 'Неактивно'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
