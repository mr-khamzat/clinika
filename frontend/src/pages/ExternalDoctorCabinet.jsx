import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

const NAV = [
  { key: 'dashboard',  label: 'Главная',     icon: 'dashboard' },
  { key: 'referrals',  label: 'Направления',  icon: 'send' },
  { key: 'schedule',   label: 'Расписание',   icon: 'calendar_today' },
  { key: 'bonuses',    label: 'Бонусы',       icon: 'payments' },
]

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' })
}

const STATUS_LABEL = { created:'Создано', confirmed:'Подтверждено', expired:'Истекло', cancelled:'Отменено' }
const STATUS_COLOR = { created:'bg-blue-100 text-blue-700', confirmed:'bg-green-100 text-green-700', expired:'bg-gray-100 text-gray-500', cancelled:'bg-red-100 text-red-700' }

export default function ExternalDoctorCabinet({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('dashboard')
  const [referrals, setReferrals] = useState([])
  const [bonuses, setBonuses] = useState([])
  const [income, setIncome] = useState([])
  const [sideOpen, setSideOpen] = useState(false)

  const hdr = { headers: { Authorization: `Bearer ${adminToken}` } }

  useEffect(() => {
    if (tab === 'referrals' || tab === 'dashboard') {
      axios.get(API_BASE + '/referrals', hdr).then(r => setReferrals(Array.isArray(r.data) ? r.data : (r.data?.items || []))).catch(() => {})
    }
    if (tab === 'bonuses') {
      axios.get(API_BASE + '/bonuses', hdr).then(r => setBonuses(Array.isArray(r.data) ? r.data : [])).catch(() => {})
      axios.get(API_BASE + '/visiting/my-income', hdr).then(r => setIncome(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    }
  }, [tab])

  const totalIncome = income.reduce((s, e) => s + parseFloat(e.amount || 0), 0)
  const totalBonuses = bonuses.reduce((s, b) => s + parseFloat(b.amount || 0), 0)

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-100 flex flex-col transition-transform duration-200
        ${sideOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static`}>
        <div className="h-16 flex items-center px-5 border-b border-gray-100">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center mr-3"
            style={{ background: 'linear-gradient(135deg,#1565C0,#0097A7)' }}>
            <span className="material-symbols-outlined text-white text-base" style={{ fontVariationSettings:"'FILL' 1" }}>stethoscope</span>
          </div>
          <div className="min-w-0">
            <p className="font-bold text-gray-800 text-sm truncate">{user?.full_name}</p>
            <p className="text-xs text-gray-400 truncate">Внешний врач</p>
          </div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {NAV.map(item => (
            <button key={item.key} onClick={() => { setTab(item.key); setSideOpen(false) }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all
                ${tab === item.key ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>
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
                  <p className="text-xs text-gray-400">Направлений</p>
                  <p className="text-2xl font-bold text-gray-800 mt-1">{referrals.length}</p>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <p className="text-xs text-gray-400">Подтверждено</p>
                  <p className="text-2xl font-bold text-green-600 mt-1">{referrals.filter(r => r.status === 'confirmed').length}</p>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <p className="text-xs text-gray-400">Бонусы ₽</p>
                  <p className="text-2xl font-bold text-teal-600 mt-1">{Math.round(totalBonuses)}</p>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <p className="text-xs text-gray-400">Начислено ₽</p>
                  <p className="text-2xl font-bold text-blue-600 mt-1">{Math.round(totalIncome)}</p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Последние направления</p>
                {referrals.slice(0, 5).map(r => (
                  <div key={r.id} className="bg-white rounded-xl p-3 border border-gray-100 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{r.to_clinic_name || '—'}</p>
                      <p className="text-xs text-gray-400 truncate">{r.service_name || '—'}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[r.status] || 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Направления */}
          {tab === 'referrals' && (
            <div className="max-w-xl space-y-3">
              {referrals.length === 0 && <p className="text-gray-400 text-sm text-center py-10">Нет направлений</p>}
              {referrals.map(r => (
                <div key={r.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                      <span className="material-symbols-outlined text-blue-600 text-base" style={{ fontVariationSettings:"'FILL' 1" }}>send</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 text-sm truncate">{r.to_clinic_name || '—'}</p>
                      <p className="text-xs text-gray-400 truncate">{r.service_name}</p>
                      {r.short_code && <p className="text-xs text-gray-500 mt-0.5 font-mono">#{r.short_code}</p>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLOR[r.status] || 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-300 mt-2">{fmt(r.created_at)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Расписание */}
          {tab === 'schedule' && (
            <div className="max-w-md">
              <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm text-center">
                <span className="material-symbols-outlined text-4xl text-gray-300 mb-3 block" style={{ fontVariationSettings:"'FILL' 1" }}>calendar_today</span>
                <p className="text-gray-500 text-sm">Расписание назначается администратором клиники</p>
              </div>
            </div>
          )}

          {/* Бонусы */}
          {tab === 'bonuses' && (
            <div className="max-w-xl space-y-3">
              {bonuses.length === 0 && income.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-10">Нет начислений</p>
              )}
              {bonuses.map(b => (
                <div key={b.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-yellow-50 flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-yellow-500 text-base" style={{ fontVariationSettings:"'FILL' 1" }}>star</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">Бонус</p>
                    <p className="text-xs text-gray-400">{fmt(b.created_at)}</p>
                  </div>
                  <p className="font-bold text-yellow-600 text-sm">+{b.amount} ₽</p>
                </div>
              ))}
              {income.map(e => (
                <div key={e.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-green-600 text-base" style={{ fontVariationSettings:"'FILL' 1" }}>payments</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{e.operation_type}</p>
                    <p className="text-xs text-gray-400">{fmt(e.created_at)}</p>
                  </div>
                  <p className="font-bold text-green-600 text-sm">+{e.amount} ₽</p>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
