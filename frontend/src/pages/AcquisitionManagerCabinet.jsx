import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

const ACCENT = '#0097A7'
const DARK   = '#004D5F'

const NAV = [
  { key: 'dashboard', label: 'Главная',   icon: 'dashboard'   },
  { key: 'doctors',   label: 'Врачи',     icon: 'people'      },
  { key: 'add',       label: 'Добавить',  icon: 'person_add'  },
  { key: 'requests',  label: 'Заявки',    icon: 'assignment'  },
  { key: 'income',    label: 'Доход',     icon: 'payments'    },
]

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' })
}

const statusColor = { pending:'bg-yellow-100 text-yellow-700', approved:'bg-green-100 text-green-700', rejected:'bg-red-100 text-red-700' }
const statusLabel = { pending:'Ожидает', approved:'Одобрено', rejected:'Отклонено' }

export default function AcquisitionManagerCabinet({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('dashboard')
  const [stats, setStats] = useState(null)
  const [doctors, setDoctors] = useState([])
  const [requests, setRequests] = useState([])
  const [income, setIncome] = useState([])
  const [form, setForm] = useState({ doctor_name:'', phone:'', clinic_name:'', specialization:'', notes:'' })
  const [formSending, setFormSending] = useState(false)
  const [formMsg, setFormMsg] = useState('')

  const hdr = { headers: { Authorization: `Bearer ${adminToken}` } }

  useEffect(() => {
    if (tab === 'dashboard') axios.get(API_BASE + '/acquisition/stats', hdr).then(r => setStats(r.data)).catch(() => {})
    if (tab === 'doctors')   axios.get(API_BASE + '/acquisition/my-doctors', hdr).then(r => setDoctors(r.data)).catch(() => {})
    if (tab === 'requests')  axios.get(API_BASE + '/acquisition/requests', hdr).then(r => setRequests(r.data)).catch(() => {})
    if (tab === 'income')    axios.get(API_BASE + '/acquisition/income', hdr).then(r => setIncome(r.data)).catch(() => {})
  }, [tab])

  async function submitRequest(e) {
    e.preventDefault(); setFormSending(true); setFormMsg('')
    try {
      await axios.post(API_BASE + '/acquisition/requests', form, hdr)
      setFormMsg('✅ Заявка отправлена')
      setForm({ doctor_name:'', phone:'', clinic_name:'', specialization:'', notes:'' })
    } catch(err) {
      setFormMsg('❌ ' + (err?.response?.data?.detail || 'Ошибка'))
    } finally { setFormSending(false) }
  }

  const name = user?.full_name?.split(' ')[0] || 'Менеджер'

  return (
    <div className="min-h-screen bg-[#f7f9fb]" style={{ fontFamily:"'Inter',sans-serif" }}>

      {/* Gradient Header */}
      <div className="relative overflow-hidden px-4 pt-12 pb-6"
        style={{ background:'linear-gradient(135deg,#0097A7 0%,#1565C0 100%)' }}>
        <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background:'rgba(255,255,255,0.18)', backdropFilter:'blur(10px)' }}>
            <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>handshake</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-base truncate">{user?.full_name}</p>
            <p className="text-white/70 text-xs">Менеджер по привлечению</p>
          </div>
          <button onClick={onLogout} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.12)' }}>
            <span className="material-symbols-outlined text-white/80 text-lg">logout</span>
          </button>
        </div>
        <p className="text-white/60 text-xs mt-1">{new Date().toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}</p>
      </div>

      {/* Content */}
      <div className="px-4 py-4 pb-28">

        {/* Dashboard */}
        {tab === 'dashboard' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon:'people',     label:'Врачей привлечено', value:stats?.doctors_count,    color:'#0097A7', bg:'#e0f7fa' },
                { icon:'assignment', label:'Заявок всего',       value:stats?.requests_total,   color:'#1565C0', bg:'#e3f2fd' },
                { icon:'pending',    label:'На рассмотрении',    value:stats?.requests_pending, color:'#F59E0B', bg:'#fff8e1' },
                { icon:'payments',   label:'Доход ₽',            value:stats?.total_income != null ? Math.round(stats.total_income) : null, color:'#10B981', bg:'#e8f5e9' },
              ].map(c => (
                <div key={c.label} className="bg-white rounded-2xl p-4 flex items-center gap-3" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:c.bg }}>
                    <span className="material-symbols-outlined text-xl" style={{ color:c.color, fontVariationSettings:"'FILL' 1" }}>{c.icon}</span>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-medium">{c.label}</p>
                    <p className="text-xl font-bold text-gray-800">{c.value ?? '—'}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setTab('add')}
                className="bg-white rounded-2xl p-4 text-center active:scale-95 transition-transform" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <div className="w-12 h-12 rounded-2xl mx-auto mb-2 flex items-center justify-center" style={{ background:'linear-gradient(135deg,#0097A7,#1565C0)' }}>
                  <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>person_add</span>
                </div>
                <p className="text-sm font-semibold text-gray-700">Добавить врача</p>
              </button>
              <button onClick={() => setTab('doctors')}
                className="bg-white rounded-2xl p-4 text-center active:scale-95 transition-transform" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <div className="w-12 h-12 rounded-2xl mx-auto mb-2 flex items-center justify-center" style={{ background:'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
                  <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>people</span>
                </div>
                <p className="text-sm font-semibold text-gray-700">Мои врачи</p>
              </button>
            </div>
          </div>
        )}

        {/* Мои врачи */}
        {tab === 'doctors' && (
          <div className="space-y-3">
            {doctors.length === 0 && (
              <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <span className="material-symbols-outlined text-5xl text-gray-300 block mb-2" style={{ fontVariationSettings:"'FILL' 1" }}>people</span>
                <p className="text-gray-400 text-sm">Нет привлечённых врачей</p>
              </div>
            )}
            {doctors.map(d => (
              <div key={d.id} className="bg-white rounded-2xl p-4" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#e0f7fa' }}>
                    <span className="material-symbols-outlined text-xl" style={{ color:ACCENT, fontVariationSettings:"'FILL' 1" }}>person</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 text-sm">{d.full_name}</p>
                    <p className="text-xs text-gray-400">{d.role === 'visiting_doctor' ? 'Выездной врач' : 'Внешний врач'}</p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${d.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {d.is_active ? 'Активен' : 'Неактивен'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Добавить врача */}
        {tab === 'add' && (
          <div className="bg-white rounded-2xl p-5" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
            <h2 className="font-bold text-gray-800 mb-4 text-base">Заявка на регистрацию врача</h2>
            <form onSubmit={submitRequest} className="space-y-3">
              {[
                { key:'doctor_name',    label:'ФИО врача',      required:true },
                { key:'phone',          label:'Телефон',        required:true },
                { key:'clinic_name',    label:'Клиника'         },
                { key:'specialization', label:'Специализация'   },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">{f.label}{f.required && ' *'}</label>
                  <input value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    required={f.required}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 transition" />
                </div>
              ))}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Примечания</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 transition resize-none" />
              </div>
              {formMsg && <p className="text-sm">{formMsg}</p>}
              <button type="submit" disabled={formSending}
                className="w-full h-12 rounded-xl text-white font-bold text-sm disabled:opacity-60 transition active:scale-95"
                style={{ background:'linear-gradient(135deg,#0097A7,#1565C0)' }}>
                {formSending ? 'Отправка...' : 'Отправить заявку'}
              </button>
            </form>
          </div>
        )}

        {/* Заявки */}
        {tab === 'requests' && (
          <div className="space-y-3">
            {requests.length === 0 && (
              <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <span className="material-symbols-outlined text-5xl text-gray-300 block mb-2" style={{ fontVariationSettings:"'FILL' 1" }}>assignment</span>
                <p className="text-gray-400 text-sm">Нет заявок</p>
              </div>
            )}
            {requests.map(r => (
              <div key={r.id} className="bg-white rounded-2xl p-4" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800 text-sm">{r.doctor_name}</p>
                    <p className="text-xs text-gray-400">{r.phone} · {r.specialization || '—'}</p>
                    {r.notes && <p className="text-xs text-gray-500 mt-1 italic">"{r.notes}"</p>}
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold flex-shrink-0 ${statusColor[r.status] || 'bg-gray-100 text-gray-500'}`}>
                    {statusLabel[r.status] || r.status}
                  </span>
                </div>
                <p className="text-xs text-gray-300 mt-2">{fmt(r.created_at)}</p>
              </div>
            ))}
          </div>
        )}

        {/* Доход */}
        {tab === 'income' && (
          <div className="space-y-3">
            {income.length === 0 && (
              <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <span className="material-symbols-outlined text-5xl text-gray-300 block mb-2" style={{ fontVariationSettings:"'FILL' 1" }}>payments</span>
                <p className="text-gray-400 text-sm">Нет начислений</p>
              </div>
            )}
            {income.map(e => (
              <div key={e.id} className="bg-white rounded-2xl p-4 flex items-center gap-3" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#e8f5e9' }}>
                  <span className="material-symbols-outlined text-xl" style={{ color:'#10B981', fontVariationSettings:"'FILL' 1" }}>payments</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{e.operation_type}</p>
                  <p className="text-xs text-gray-400">{fmt(e.created_at)}</p>
                </div>
                <p className="font-bold text-green-600 text-base">+{e.amount} ₽</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-50"
        style={{ paddingBottom:'env(safe-area-inset-bottom)', background:'rgba(255,255,255,0.95)', backdropFilter:'blur(20px)', borderTop:'1px solid rgba(0,0,0,0.06)' }}>
        <div className="flex">
          {NAV.map(item => (
            <button key={item.key} onClick={() => setTab(item.key)}
              className="flex-1 flex flex-col items-center pt-2 pb-1 gap-0.5 relative">
              {tab === item.key && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full" style={{ background:ACCENT }} />}
              <span className="material-symbols-outlined text-2xl" style={{ color:tab === item.key ? ACCENT : '#9ca3af', fontVariationSettings:tab === item.key ? "'FILL' 1" : "'FILL' 0" }}>{item.icon}</span>
              <span className="text-xs font-semibold" style={{ color:tab === item.key ? ACCENT : '#9ca3af' }}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
