import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

const NAV = [
  { key: 'dashboard', label: 'Главная',      icon: 'dashboard' },
  { key: 'doctors',   label: 'Мои врачи',    icon: 'people' },
  { key: 'add',       label: 'Добавить врача', icon: 'person_add' },
  { key: 'requests',  label: 'Заявки',        icon: 'assignment' },
  { key: 'income',    label: 'Доход',          icon: 'payments' },
]

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' })
}

function StatCard({ icon, label, value, color }) {
  return (
    <div className="bg-white rounded-2xl p-4 flex items-center gap-3 shadow-sm border border-gray-100">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: color + '20' }}>
        <span className="material-symbols-outlined text-xl" style={{ color, fontVariationSettings:"'FILL' 1" }}>{icon}</span>
      </div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-xl font-bold text-gray-800">{value ?? '—'}</p>
      </div>
    </div>
  )
}

export default function AcquisitionManagerCabinet({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('dashboard')
  const [stats, setStats] = useState(null)
  const [doctors, setDoctors] = useState([])
  const [requests, setRequests] = useState([])
  const [income, setIncome] = useState([])
  const [form, setForm] = useState({ doctor_name:'', phone:'', clinic_name:'', specialization:'', notes:'' })
  const [formSending, setFormSending] = useState(false)
  const [formMsg, setFormMsg] = useState('')
  const [sideOpen, setSideOpen] = useState(false)

  const hdr = { headers: { Authorization: `Bearer ${adminToken}` } }

  useEffect(() => {
    if (tab === 'dashboard') axios.get(API_BASE + '/acquisition/stats', hdr).then(r => setStats(r.data)).catch(() => {})
    if (tab === 'doctors')   axios.get(API_BASE + '/acquisition/my-doctors', hdr).then(r => setDoctors(r.data)).catch(() => {})
    if (tab === 'requests')  axios.get(API_BASE + '/acquisition/requests', hdr).then(r => setRequests(r.data)).catch(() => {})
    if (tab === 'income')    axios.get(API_BASE + '/acquisition/income', hdr).then(r => setIncome(r.data)).catch(() => {})
  }, [tab])

  async function submitRequest(e) {
    e.preventDefault()
    setFormSending(true)
    setFormMsg('')
    try {
      await axios.post(API_BASE + '/acquisition/requests', form, hdr)
      setFormMsg('✅ Заявка отправлена')
      setForm({ doctor_name:'', phone:'', clinic_name:'', specialization:'', notes:'' })
    } catch(err) {
      setFormMsg('❌ ' + (err?.response?.data?.detail || 'Ошибка'))
    } finally {
      setFormSending(false)
    }
  }

  const statusColor = { pending:'bg-yellow-100 text-yellow-700', approved:'bg-green-100 text-green-700', rejected:'bg-red-100 text-red-700' }
  const statusLabel = { pending:'Ожидает', approved:'Одобрено', rejected:'Отклонено' }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-100 flex flex-col transition-transform duration-200
        ${sideOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static`}>
        <div className="h-16 flex items-center px-5 border-b border-gray-100">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center mr-3"
            style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)' }}>
            <span className="material-symbols-outlined text-white text-base" style={{ fontVariationSettings:"'FILL' 1" }}>handshake</span>
          </div>
          <div className="min-w-0">
            <p className="font-bold text-gray-800 text-sm truncate">{user?.full_name}</p>
            <p className="text-xs text-gray-400 truncate">Менеджер по привлечению</p>
          </div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {NAV.map(item => (
            <button key={item.key} onClick={() => { setTab(item.key); setSideOpen(false) }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all
                ${tab === item.key ? 'bg-teal-50 text-teal-700' : 'text-gray-600 hover:bg-gray-50'}`}>
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
                <StatCard icon="people"      label="Врачей привлечено"  value={stats?.doctors_count}        color="#0097A7" />
                <StatCard icon="assignment"  label="Заявок всего"       value={stats?.requests_total}       color="#1565C0" />
                <StatCard icon="pending"     label="На рассмотрении"    value={stats?.requests_pending}     color="#F59E0B" />
                <StatCard icon="payments"    label="Доход ₽"            value={stats?.total_income != null ? Math.round(stats.total_income) : null} color="#10B981" />
              </div>
            </div>
          )}

          {/* Мои врачи */}
          {tab === 'doctors' && (
            <div className="max-w-xl space-y-3">
              {doctors.length === 0 && <p className="text-gray-400 text-sm text-center py-10">Нет привлечённых врачей</p>}
              {doctors.map(d => (
                <div key={d.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center flex-shrink-0">
                      <span className="material-symbols-outlined text-teal-600" style={{ fontVariationSettings:"'FILL' 1" }}>person</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 text-sm">{d.full_name}</p>
                      <p className="text-xs text-gray-400">{d.role === 'visiting_doctor' ? 'Выездной врач' : 'Внешний врач'}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${d.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {d.is_active ? 'Активен' : 'Неактивен'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Добавить врача */}
          {tab === 'add' && (
            <div className="max-w-md">
              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <h2 className="font-bold text-gray-800 mb-4">Заявка на регистрацию врача</h2>
                <form onSubmit={submitRequest} className="space-y-3">
                  {[
                    { key:'doctor_name', label:'ФИО врача', required:true },
                    { key:'phone',       label:'Телефон',   required:true },
                    { key:'clinic_name', label:'Клиника' },
                    { key:'specialization', label:'Специализация' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="text-xs font-medium text-gray-500 block mb-1">{f.label}{f.required && ' *'}</label>
                      <input value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                        required={f.required}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-teal-400" />
                    </div>
                  ))}
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">Примечания</label>
                    <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                      rows={3}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-teal-400 resize-none" />
                  </div>
                  {formMsg && <p className="text-sm">{formMsg}</p>}
                  <button type="submit" disabled={formSending}
                    className="w-full h-11 rounded-xl text-white font-bold text-sm disabled:opacity-60 transition"
                    style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)' }}>
                    {formSending ? 'Отправка...' : 'Отправить заявку'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Заявки */}
          {tab === 'requests' && (
            <div className="max-w-xl space-y-3">
              {requests.length === 0 && <p className="text-gray-400 text-sm text-center py-10">Нет заявок</p>}
              {requests.map(r => (
                <div key={r.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 text-sm">{r.doctor_name}</p>
                      <p className="text-xs text-gray-400">{r.phone} · {r.specialization || '—'}</p>
                      {r.notes && <p className="text-xs text-gray-500 mt-1 italic">"{r.notes}"</p>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${statusColor[r.status] || 'bg-gray-100 text-gray-500'}`}>
                      {statusLabel[r.status] || r.status}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-300 mt-2">{fmt(r.created_at)}</p>
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
