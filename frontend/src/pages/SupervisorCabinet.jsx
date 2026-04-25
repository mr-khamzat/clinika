import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

// ── helpers ──────────────────────────────────────────────────────────────────
const api = (token) => ({
  get:    (url, params) => axios.get(API_BASE + url, { headers: { Authorization: `Bearer ${token}` }, params }),
  post:   (url, data)   => axios.post(API_BASE + url, data, { headers: { Authorization: `Bearer ${token}` } }),
  patch:  (url, data)   => axios.patch(API_BASE + url, data, { headers: { Authorization: `Bearer ${token}` } }),
  del:    (url)         => axios.delete(API_BASE + url, { headers: { Authorization: `Bearer ${token}` } }),
})

function fmt(n) { return n != null ? Number(n).toLocaleString('ru') : '—' }
function plural(n, a, b, c) {
  const v = Math.abs(n) % 100
  if (v >= 11 && v <= 14) return `${n} ${c}`
  const r = v % 10
  if (r === 1) return `${n} ${a}`
  if (r >= 2 && r <= 4) return `${n} ${b}`
  return `${n} ${c}`
}

const ROLE_LABELS = {
  admin: 'Администратор', manager: 'Руководитель', doctor: 'Врач',
  nurse: 'Медсестра', recruiter: 'Менеджер по набору', supervisor: 'Супервизор',
  partner: 'Партнёр', super_admin: 'Супер-админ',
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
function Err({ msg }) {
  if (!msg) return null
  return <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 mb-4">{msg}</div>
}
function StatCard({ icon, label, value, color, bg, onClick }) {
  return (
    <div onClick={onClick} className={`bg-white rounded-2xl p-5 shadow-sm ${onClick ? 'cursor-pointer hover:shadow-md transition' : ''}`}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: bg }}>
        <span className="material-symbols-outlined text-xl" style={{ color, fontVariationSettings: "'FILL' 1" }}>{icon}</span>
      </div>
      <div className="text-2xl font-bold text-gray-800 leading-tight">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

// ── NAV ──────────────────────────────────────────────────────────────────────
const NAV = [
  { key: 'home',       label: 'Обзор',        icon: 'dashboard' },
  { key: 'staff',      label: 'Персонал',     icon: 'group' },
  { key: 'clinics',    label: 'Клиники',      icon: 'local_hospital' },
  { key: 'referrals',  label: 'Направления',  icon: 'moving' },
  { key: 'analytics',  label: 'Аналитика',    icon: 'bar_chart' },
  { key: 'bonuses',    label: 'Бонусы',       icon: 'savings' },
  { key: 'audit',      label: 'Аудит',        icon: 'manage_search' },
  { key: 'settings',   label: 'Настройки',    icon: 'settings' },
]

// ── HomeDashboard ─────────────────────────────────────────────────────────────
function HomeDashboard({ token, onNavigate }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const a = api(token)

  useEffect(() => {
    setLoading(true)
    a.get('/supervisor/dashboard', { days })
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [days])

  const stats = data ? [
    { icon: 'moving',         label: `Направлений за ${days} дн.`, value: fmt(data.total_referrals),  color: '#166534', bg: 'rgba(22,101,52,.09)',  nav: 'referrals' },
    { icon: 'person',         label: 'Уникальных пациентов',       value: fmt(data.unique_patients),  color: '#0097A7', bg: 'rgba(0,151,167,.09)',  nav: null },
    { icon: 'stethoscope',    label: 'Активных врачей',            value: fmt(data.active_doctors),   color: '#7c3aed', bg: 'rgba(124,58,237,.09)', nav: 'staff' },
    { icon: 'local_hospital', label: 'Клиник',                     value: fmt(data.total_clinics),    color: '#0369a1', bg: 'rgba(3,105,161,.09)',  nav: 'clinics' },
  ] : []

  return (
    <div className="space-y-6">
      {/* Period filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Период:</span>
        {[7, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className={`px-3 py-1 rounded-lg text-sm font-semibold transition ${days === d ? 'bg-[#0097A7] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
            {d} дн.
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stats.map(s => (
              <StatCard key={s.label} {...s} onClick={s.nav ? () => onNavigate(s.nav) : undefined} />
            ))}
          </div>

          {/* Top doctors */}
          {data?.top_doctors?.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-4">Топ-5 врачей по направлениям</h3>
              <div className="space-y-1">
                {data.top_doctors.map((doc, i) => (
                  <div key={doc.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="w-5 text-xs font-bold text-gray-400">{i + 1}</span>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
                        {(doc.full_name || '?')[0].toUpperCase()}
                      </div>
                      <span className="text-sm text-gray-800">{doc.full_name}</span>
                    </div>
                    <span className="text-sm font-semibold text-[#0097A7]">{fmt(doc.referrals_count)} нап.</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick nav */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { key: 'staff',     icon: 'group',          label: 'Персонал',    color: '#7c3aed', bg: '#f3f0ff' },
              { key: 'clinics',   icon: 'local_hospital', label: 'Клиники',     color: '#0369a1', bg: '#eff6ff' },
              { key: 'analytics', icon: 'bar_chart',      label: 'Аналитика',   color: '#0097A7', bg: '#f0fdfe' },
              { key: 'bonuses',   icon: 'savings',        label: 'Бонусы',      color: '#b45309', bg: '#fffbeb' },
            ].map(item => (
              <button key={item.key} onClick={() => onNavigate(item.key)}
                className="bg-white rounded-2xl p-4 shadow-sm flex flex-col items-center gap-2 hover:shadow-md transition">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: item.bg }}>
                  <span className="material-symbols-outlined text-xl" style={{ color: item.color, fontVariationSettings: "'FILL' 1" }}>{item.icon}</span>
                </div>
                <span className="text-xs font-semibold text-gray-700">{item.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── StaffModal ────────────────────────────────────────────────────────────────
function StaffModal({ token, clinics, existing, onClose, onDone }) {
  const [form, setForm] = useState({
    full_name:    existing?.full_name    || '',
    phone_number: existing?.phone_number || '',
    username:     existing?.username     || '',
    password:     '',
    role:         existing?.role         || 'admin',
    clinic_id:    existing?.clinic_id    || '',
    telegram_id:  existing?.telegram_id  || '',
    specialization: existing?.specialization || '',
  })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const a = api(token)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      const body = { ...form }
      if (!body.password) delete body.password
      if (!body.clinic_id) delete body.clinic_id
      if (!body.telegram_id) body.telegram_id = null
      if (existing) {
        await a.patch(`/manager/admins/${existing.id}`, body)
      } else {
        await a.post('/manager/admins/', body)
      }
      onDone()
    } catch (ex) {
      setErr(ex?.response?.data?.detail || 'Ошибка сохранения')
    } finally {
      setLoading(false)
    }
  }

  const f = (k) => (e) => setForm(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">{existing ? 'Редактировать сотрудника' : 'Добавить сотрудника'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <Err msg={err} />
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">ФИО *</label>
              <input value={form.full_name} onChange={f('full_name')} required
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Телефон</label>
              <input value={form.phone_number} onChange={f('phone_number')} placeholder="+7..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Логин</label>
              <input value={form.username} onChange={f('username')}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">{existing ? 'Новый пароль' : 'Пароль *'}</label>
              <input type="password" value={form.password} onChange={f('password')} required={!existing}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Роль *</label>
              <select value={form.role} onChange={f('role')} required
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]">
                <option value="admin">Администратор</option>
                <option value="doctor">Врач</option>
                <option value="nurse">Медсестра</option>
                <option value="manager">Руководитель</option>
                <option value="recruiter">Менеджер по набору</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Клиника</label>
              <select value={form.clinic_id} onChange={f('clinic_id')}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]">
                <option value="">— Без клиники —</option>
                {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {(form.role === 'doctor' || form.role === 'nurse') && (
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Специализация</label>
                <input value={form.specialization} onChange={f('specialization')}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
              </div>
            )}
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Telegram ID</label>
              <input value={form.telegram_id} onChange={f('telegram_id')} placeholder="числовой ID"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-800 transition">Отмена</button>
            <button type="submit" disabled={loading}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition"
              style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
              {loading ? 'Сохранение...' : existing ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── StaffSection ──────────────────────────────────────────────────────────────
function StaffSection({ token }) {
  const [staff, setStaff] = useState([])
  const [clinics, setClinics] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deactivating, setDeactivating] = useState(null)
  const a = api(token)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const [sr, cr] = await Promise.all([
        a.get('/admins/'),
        a.get('/manager/clinics/'),
      ])
      setStaff(Array.isArray(sr.data) ? sr.data : [])
      setClinics(Array.isArray(cr.data) ? cr.data : [])
    } catch {
      setErr('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const handleDeactivate = async (s) => {
    if (!window.confirm(`Деактивировать ${s.full_name}?`)) return
    setDeactivating(s.id)
    try {
      await a.del(`/manager/admins/${s.id}`)
      load()
    } catch (ex) {
      alert(ex?.response?.data?.detail || 'Ошибка')
    } finally {
      setDeactivating(null)
    }
  }

  const clinicName = (id) => clinics.find(c => c.id === id)?.name || '—'

  const filtered = useMemo(() => staff.filter(s => {
    if (roleFilter !== 'all' && s.role !== roleFilter) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (s.full_name || '').toLowerCase().includes(q) ||
      (s.phone_number || '').toLowerCase().includes(q) ||
      (s.username || '').toLowerCase().includes(q)
  }), [staff, roleFilter, search])

  const grouped = useMemo(() => {
    const map = {}
    filtered.forEach(s => {
      const key = s.clinic_id || '__none__'
      if (!map[key]) map[key] = []
      map[key].push(s)
    })
    return Object.entries(map).sort(([a], [b]) => {
      if (a === '__none__') return 1
      if (b === '__none__') return -1
      return clinicName(a).localeCompare(clinicName(b), 'ru')
    })
  }, [filtered])

  const roleBadge = (role) => {
    const map = { manager: 'bg-blue-100 text-blue-700', doctor: 'bg-green-100 text-green-700',
      nurse: 'bg-pink-100 text-pink-700', admin: 'bg-gray-100 text-gray-700',
      recruiter: 'bg-amber-100 text-amber-700' }
    return map[role] || 'bg-gray-100 text-gray-600'
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-800">Персонал</h2>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition"
          style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
          <span className="material-symbols-outlined text-[18px]">add</span>
          Добавить
        </button>
      </div>

      <div className="mb-4 space-y-2">
        <div className="flex gap-1.5 flex-wrap">
          {[
            { key: 'all', label: 'Все' }, { key: 'admin', label: 'Администраторы' },
            { key: 'doctor', label: 'Врачи' }, { key: 'nurse', label: 'Медсёстры' },
            { key: 'manager', label: 'Руководители' }, { key: 'recruiter', label: 'Менеджеры' },
          ].map(f => (
            <button key={f.key} onClick={() => setRoleFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${roleFilter === f.key ? 'bg-[#0097A7] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени, телефону, логину..."
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
      </div>

      <Err msg={err} />
      {loading ? <Spinner /> : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-400 text-sm shadow-sm">
          {search ? 'Ничего не найдено' : 'Сотрудников нет'}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([clinicKey, members]) => (
            <div key={clinicKey} className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                <span className="material-symbols-outlined text-[16px] text-gray-400">local_hospital</span>
                <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  {clinicKey === '__none__' ? 'Без клиники' : clinicName(clinicKey)}
                </span>
                <span className="ml-auto text-xs text-gray-400">{plural(members.length, 'сотрудник', 'сотрудника', 'сотрудников')}</span>
              </div>
              {/* Desktop */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['ФИО', 'Логин', 'Роль', 'Телефон', 'Статус', ''].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-gray-400 px-4 py-2.5 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((s, i) => (
                      <tr key={s.id} className={`border-b border-gray-50 ${i % 2 ? 'bg-gray-50/40' : ''}`}>
                        <td className="px-4 py-3 font-medium text-gray-800">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                              style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
                              {(s.full_name || '?')[0].toUpperCase()}
                            </div>
                            {s.full_name || '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{s.username || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${roleBadge(s.role)}`}>
                            {ROLE_LABELS[s.role] || s.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{s.phone_number || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.is_active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                            {s.is_active !== false ? 'Активен' : 'Заблокирован'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button onClick={() => setEditTarget(s)}
                              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg px-2.5 py-1.5 font-medium transition">
                              Изменить
                            </button>
                            {s.is_active !== false && (
                              <button onClick={() => handleDeactivate(s)} disabled={deactivating === s.id}
                                className="text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg px-2.5 py-1.5 font-medium transition disabled:opacity-50">
                                {deactivating === s.id ? '...' : 'Деактивировать'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile */}
              <div className="md:hidden divide-y divide-gray-100">
                {members.map(s => (
                  <div key={s.id} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                          style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
                          {(s.full_name || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-800 text-sm">{s.full_name}</p>
                          {s.phone_number && <p className="text-xs text-gray-400">{s.phone_number}</p>}
                        </div>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${roleBadge(s.role)}`}>
                        {ROLE_LABELS[s.role] || s.role}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.is_active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {s.is_active !== false ? 'Активен' : 'Заблокирован'}
                      </span>
                      <div className="flex gap-2">
                        <button onClick={() => setEditTarget(s)} className="text-xs bg-gray-100 text-gray-700 rounded-lg px-3 py-1.5">Изменить</button>
                        {s.is_active !== false && (
                          <button onClick={() => handleDeactivate(s)} disabled={deactivating === s.id}
                            className="text-xs bg-red-50 text-red-600 rounded-lg px-3 py-1.5 disabled:opacity-50">
                            {deactivating === s.id ? '...' : 'Деактивировать'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <StaffModal token={token} clinics={clinics} existing={null} onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load() }} />}
      {editTarget && <StaffModal token={token} clinics={clinics} existing={editTarget} onClose={() => setEditTarget(null)} onDone={() => { setEditTarget(null); load() }} />}
    </div>
  )
}

// ── ClinicsSection ─────────────────────────────────────────────────────────────
function ClinicsSection({ token }) {
  const [clinics, setClinics] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState({ name: '', address: '', phone: '' })
  const [saving, setSaving] = useState(false)
  const a = api(token)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await a.get('/manager/clinics/')
      setClinics(Array.isArray(r.data) ? r.data : [])
    } catch { setErr('Не удалось загрузить клиники') }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const openCreate = () => { setForm({ name: '', address: '', phone: '' }); setEditTarget(null); setShowCreate(true) }
  const openEdit = (c) => { setForm({ name: c.name, address: c.address || '', phone: c.phone || '' }); setEditTarget(c); setShowCreate(true) }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (editTarget) {
        await a.patch(`/manager/clinics/${editTarget.id}`, form)
      } else {
        await a.post('/manager/clinics/', form)
      }
      setShowCreate(false)
      load()
    } catch (ex) {
      alert(ex?.response?.data?.detail || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-800">Клиники</h2>
        <button onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition"
          style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
          <span className="material-symbols-outlined text-[18px]">add</span>
          Добавить
        </button>
      </div>
      <Err msg={err} />
      {loading ? <Spinner /> : clinics.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-400 text-sm shadow-sm">Клиник нет</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {clinics.map(c => (
            <div key={c.id} className="bg-white rounded-2xl shadow-sm p-5">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(0,151,167,.1)' }}>
                  <span className="material-symbols-outlined text-[20px]" style={{ color: '#0097A7', fontVariationSettings: "'FILL' 1" }}>local_hospital</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-800 text-sm truncate">{c.name}</div>
                  {c.address && <div className="text-xs text-gray-400 mt-0.5 truncate">{c.address}</div>}
                  {c.phone && <div className="text-xs text-gray-400">{c.phone}</div>}
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${c.is_active !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {c.is_active !== false ? 'Активна' : 'Неактивна'}
                </span>
              </div>
              <button onClick={() => openEdit(c)}
                className="text-xs text-[#0097A7] hover:underline font-semibold">Редактировать →</button>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">{editTarget ? 'Редактировать клинику' : 'Новая клиника'}</h2>
              <button onClick={() => setShowCreate(false)}><span className="material-symbols-outlined text-gray-400">close</span></button>
            </div>
            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Название *</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Адрес</label>
                <input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Телефон</label>
                <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2.5 text-sm text-gray-600">Отмена</button>
                <button type="submit" disabled={saving}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
                  {saving ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── ReferralsSection ──────────────────────────────────────────────────────────
function ReferralsSection({ token }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const a = api(token)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const r = await a.get('/manager/reports/referrals', params)
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch { setItems([]) }
    setLoading(false)
  }, [token, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => items.filter(r => {
    if (status !== 'all' && r.status !== status) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (r.patient_name || '').toLowerCase().includes(q) ||
      (r.patient_phone || '').toLowerCase().includes(q) ||
      (r.clinic_name || '').toLowerCase().includes(q) ||
      (r.doctor_name || '').toLowerCase().includes(q)
  }), [items, search, status])

  const statusBadge = (s) => {
    const map = {
      pending:   'bg-amber-100 text-amber-700',
      confirmed: 'bg-green-100 text-green-700',
      completed: 'bg-blue-100 text-blue-700',
      cancelled: 'bg-red-100 text-red-600',
    }
    const labels = { pending: 'Ожидает', confirmed: 'Подтверждено', completed: 'Завершено', cancelled: 'Отменено' }
    return { cls: map[s] || 'bg-gray-100 text-gray-600', label: labels[s] || s }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-800">Направления</h2>
        <span className="text-sm text-gray-400">{filtered.length} из {items.length}</span>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-48">
          <label className="block text-xs text-gray-500 mb-1">Поиск</label>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Пациент, клиника, врач..."
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0097A7]" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Статус</label>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0097A7]">
            <option value="all">Все</option>
            <option value="pending">Ожидает</option>
            <option value="confirmed">Подтверждено</option>
            <option value="completed">Завершено</option>
            <option value="cancelled">Отменено</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">С</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0097A7]" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">По</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0097A7]" />
        </div>
      </div>

      {loading ? <Spinner /> : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-400 text-sm shadow-sm">Направлений нет</div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Пациент', 'Клиника', 'Врач', 'Услуга', 'Статус', 'Дата'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-400 px-4 py-3 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const sb = statusBadge(r.status)
                  return (
                    <tr key={r.id} className={`border-b border-gray-50 ${i % 2 ? 'bg-gray-50/40' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{r.patient_name || '—'}</div>
                        <div className="text-xs text-gray-400">{r.patient_phone || ''}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{r.clinic_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{r.doctor_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{r.service_name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sb.cls}`}>{sb.label}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {r.created_at ? new Date(r.created_at).toLocaleDateString('ru') : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="md:hidden divide-y divide-gray-100">
            {filtered.map(r => {
              const sb = statusBadge(r.status)
              return (
                <div key={r.id} className="p-4">
                  <div className="flex items-start justify-between mb-1">
                    <div className="font-medium text-gray-800 text-sm">{r.patient_name || '—'}</div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sb.cls}`}>{sb.label}</span>
                  </div>
                  <div className="text-xs text-gray-400">{r.clinic_name} · {r.doctor_name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{r.patient_phone}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── AnalyticsSection ──────────────────────────────────────────────────────────
function AnalyticsSection({ token }) {
  const [overview, setOverview] = useState(null)
  const [topStaff, setTopStaff] = useState([])
  const [topServices, setTopServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState({ from: '', to: '' })
  const a = api(token)

  useEffect(() => {
    setLoading(true)
    const today = new Date()
    const ago30 = new Date(today - 30 * 86400000)
    const toStr = today.toISOString().slice(0, 10)
    const fromStr = ago30.toISOString().slice(0, 10)
    setPeriod({ from: fromStr, to: toStr })
    Promise.all([
      a.get('/analytics/overview', { date_from: fromStr, date_to: toStr }),
      a.get('/analytics/top-staff',    { date_from: fromStr, date_to: toStr }),
      a.get('/analytics/top-services', { date_from: fromStr, date_to: toStr }),
    ]).then(([ov, ts, tsv]) => {
      setOverview(ov.data)
      setTopStaff(Array.isArray(ts.data) ? ts.data : [])
      setTopServices(Array.isArray(tsv.data) ? tsv.data : [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner />

  const MetaCard = ({ label, value, sub, color }) => (
    <div className="bg-white rounded-2xl shadow-sm p-5">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">Аналитика</h2>

      {overview && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetaCard label="Направлений" value={fmt(overview.current?.total_referrals)} color="#0097A7" />
            <MetaCard label="Конверсия" value={`${overview.conversion_rate ?? 0}%`} color="#166534" />
            <MetaCard label="Пациентов" value={fmt(overview.current?.unique_patients)} color="#7c3aed" />
            <MetaCard label="Средний бонус" value={`${fmt(overview.current?.avg_bonus)} ₸`} color="#b45309" />
          </div>

          {overview.previous && (
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-700 mb-4">Сравнение периодов</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Направлений', cur: overview.current?.total_referrals, prev: overview.previous?.total_referrals },
                  { label: 'Конверсия', cur: overview.conversion_rate, prev: overview.prev_conversion_rate, pct: true },
                  { label: 'Пациентов', cur: overview.current?.unique_patients, prev: overview.previous?.unique_patients },
                  { label: 'Ср. бонус', cur: overview.current?.avg_bonus, prev: overview.previous?.avg_bonus },
                ].map(m => {
                  const delta = m.pct ? (m.cur - m.prev) : (m.cur - m.prev)
                  const up = delta >= 0
                  return (
                    <div key={m.label} className="text-center p-3 rounded-xl bg-gray-50">
                      <div className="text-xs text-gray-400 mb-1">{m.label}</div>
                      <div className="text-lg font-bold text-gray-800">{fmt(m.cur)}{m.pct ? '%' : ''}</div>
                      <div className={`text-xs font-semibold mt-1 ${up ? 'text-green-600' : 'text-red-500'}`}>
                        {up ? '↑' : '↓'} {fmt(Math.abs(delta))}{m.pct ? '%' : ''} vs прошлый период
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top staff */}
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-4">Топ сотрудников</h3>
          {topStaff.length === 0 ? (
            <div className="text-xs text-gray-400 text-center py-4">Нет данных</div>
          ) : topStaff.slice(0, 8).map((s, i) => (
            <div key={s.admin_id || i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
              <span className="text-xs font-bold text-gray-400 w-5">{i + 1}</span>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
                {(s.full_name || '?')[0].toUpperCase()}
              </div>
              <span className="flex-1 text-sm text-gray-700 truncate">{s.full_name || '—'}</span>
              <span className="text-sm font-semibold text-[#0097A7]">{fmt(s.referrals_count)}</span>
            </div>
          ))}
        </div>

        {/* Top services */}
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-4">Топ услуг</h3>
          {topServices.length === 0 ? (
            <div className="text-xs text-gray-400 text-center py-4">Нет данных</div>
          ) : topServices.slice(0, 8).map((s, i) => (
            <div key={s.service_id || i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
              <span className="text-xs font-bold text-gray-400 w-5">{i + 1}</span>
              <span className="flex-1 text-sm text-gray-700 truncate">{s.service_name || '—'}</span>
              <span className="text-sm font-semibold text-[#0097A7]">{fmt(s.count)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── BonusesSection ────────────────────────────────────────────────────────────
function BonusesSection({ token }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('pending')
  const [paying, setPaying] = useState(null)
  const [payAll, setPayAll] = useState(null)
  const a = api(token)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await a.get('/manager/reports/bonuses', { status: statusFilter === 'all' ? undefined : statusFilter })
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch { setItems([]) }
    setLoading(false)
  }, [token, statusFilter])

  useEffect(() => { load() }, [load])

  const handlePay = async (bonusId) => {
    setPaying(bonusId)
    try {
      await a.patch(`/bonuses/${bonusId}/mark-paid`)
      load()
    } catch (ex) {
      alert(ex?.response?.data?.detail || 'Ошибка')
    } finally {
      setPaying(null)
    }
  }

  const handlePayAll = async (adminId) => {
    if (!window.confirm('Выплатить все бонусы этому сотруднику?')) return
    setPayAll(adminId)
    try {
      await a.post(`/manager/bonuses/mark-paid-all/${adminId}`)
      load()
    } catch (ex) {
      alert(ex?.response?.data?.detail || 'Ошибка')
    } finally {
      setPayAll(null)
    }
  }

  // Group by admin
  const grouped = useMemo(() => {
    const filtered = items.filter(b => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (b.admin_name || '').toLowerCase().includes(q) ||
        (b.patient_name || '').toLowerCase().includes(q)
    })
    const map = {}
    filtered.forEach(b => {
      const key = b.admin_id || '__none__'
      if (!map[key]) map[key] = { name: b.admin_name || 'Неизвестно', items: [], total: 0 }
      map[key].items.push(b)
      if (b.status === 'pending') map[key].total += Number(b.amount || 0)
    })
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total)
  }, [items, search])

  const total = useMemo(() => items.filter(b => b.status === 'pending').reduce((s, b) => s + Number(b.amount || 0), 0), [items])

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-800">Бонусы</h2>
        {total > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-sm font-semibold text-amber-700">
            К выплате: {fmt(Math.round(total))} ₸
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex gap-1.5">
          {[{ k: 'pending', l: 'К выплате' }, { k: 'paid', l: 'Выплачены' }, { k: 'all', l: 'Все' }].map(s => (
            <button key={s.k} onClick={() => setStatusFilter(s.k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${statusFilter === s.k ? 'bg-[#0097A7] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
              {s.l}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск..."
          className="flex-1 min-w-40 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0097A7]" />
      </div>

      {loading ? <Spinner /> : grouped.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-400 text-sm shadow-sm">Бонусов нет</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([adminId, g]) => (
            <div key={adminId} className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
                    {(g.name || '?')[0].toUpperCase()}
                  </div>
                  <span className="text-sm font-semibold text-gray-800">{g.name}</span>
                  <span className="text-xs text-gray-400">{plural(g.items.length, 'запись', 'записи', 'записей')}</span>
                </div>
                <div className="flex items-center gap-3">
                  {g.total > 0 && <span className="text-sm font-bold text-amber-700">{fmt(Math.round(g.total))} ₸</span>}
                  {statusFilter === 'pending' && g.total > 0 && (
                    <button onClick={() => handlePayAll(adminId)} disabled={payAll === adminId}
                      className="text-xs bg-[#0097A7] text-white rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50">
                      {payAll === adminId ? '...' : 'Выплатить всё'}
                    </button>
                  )}
                </div>
              </div>
              <div className="divide-y divide-gray-50">
                {g.items.map(b => (
                  <div key={b.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="text-sm text-gray-800">{b.patient_name || '—'}</div>
                      <div className="text-xs text-gray-400">{b.service_name || ''} · {b.created_at ? new Date(b.created_at).toLocaleDateString('ru') : ''}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-gray-800 text-sm">{fmt(b.amount)} ₸</span>
                      {b.status === 'pending' && (
                        <button onClick={() => handlePay(b.id)} disabled={paying === b.id}
                          className="text-xs bg-green-100 text-green-700 rounded-lg px-2.5 py-1.5 font-semibold disabled:opacity-50">
                          {paying === b.id ? '...' : 'Выплатить'}
                        </button>
                      )}
                      {b.status === 'paid' && (
                        <span className="text-xs text-green-600 font-semibold">✓ Выплачен</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── AuditSection ──────────────────────────────────────────────────────────────
function AuditSection({ token }) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [skip, setSkip] = useState(0)
  const LIMIT = 50
  const a = api(token)

  const load = useCallback(async (s = 0) => {
    setLoading(true)
    try {
      const r = await a.get('/supervisor/audit', { skip: s, limit: LIMIT, days: 90 })
      setItems(r.data.items || [])
      setTotal(r.data.total || 0)
      setSkip(s)
    } catch { setItems([]) }
    setLoading(false)
  }, [token])

  useEffect(() => { load(0) }, [load])

  const actionColor = (action) => {
    if (action?.includes('create')) return 'bg-green-100 text-green-700'
    if (action?.includes('delete') || action?.includes('deactivate')) return 'bg-red-100 text-red-600'
    if (action?.includes('update') || action?.includes('patch')) return 'bg-blue-100 text-blue-700'
    return 'bg-gray-100 text-gray-600'
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-800">Журнал аудита</h2>
        {total > 0 && <span className="text-sm text-gray-400">Всего: {fmt(total)}</span>}
      </div>
      {loading ? <Spinner /> : items.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-400 text-sm shadow-sm">Журнал пуст</div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['Действие', 'Объект', 'Сотрудник', 'IP', 'Время'].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-gray-400 px-4 py-3 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((e, i) => (
                    <tr key={e.id} className={`border-b border-gray-50 ${i % 2 ? 'bg-gray-50/40' : ''}`}>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${actionColor(e.action)}`}>{e.action}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {e.entity_type || '—'}
                        {e.entity_id && <span className="text-gray-300 ml-1">#{e.entity_id.slice(0, 8)}</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-xs">{e.actor_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{e.ip_address || '—'}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {e.created_at ? new Date(e.created_at).toLocaleString('ru', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden divide-y divide-gray-100">
              {items.map(e => (
                <div key={e.id} className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${actionColor(e.action)}`}>{e.action}</span>
                    <span className="text-xs text-gray-400">{e.created_at ? new Date(e.created_at).toLocaleString('ru', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : ''}</span>
                  </div>
                  <div className="text-xs text-gray-600">{e.actor_name} · {e.entity_type}</div>
                </div>
              ))}
            </div>
          </div>
          {total > LIMIT && (
            <div className="flex justify-center gap-2 mt-4">
              <button disabled={skip === 0} onClick={() => load(Math.max(0, skip - LIMIT))}
                className="px-4 py-2 bg-white rounded-xl text-sm disabled:opacity-40 shadow-sm hover:shadow transition">
                ← Назад
              </button>
              <span className="px-4 py-2 text-gray-500 text-sm">
                {Math.floor(skip / LIMIT) + 1} / {Math.ceil(total / LIMIT)}
              </span>
              <button disabled={skip + LIMIT >= total} onClick={() => load(skip + LIMIT)}
                className="px-4 py-2 bg-white rounded-xl text-sm disabled:opacity-40 shadow-sm hover:shadow transition">
                Вперёд →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── SettingsSection ───────────────────────────────────────────────────────────
function SettingsSection({ token, user }) {
  const [form, setForm] = useState({ full_name: user?.full_name || '', phone_number: user?.phone_number || '' })
  const [pwd, setPwd] = useState({ old: '', new1: '', new2: '' })
  const [saving, setSaving] = useState(false)
  const [pwdMsg, setPwdMsg] = useState('')
  const [msg, setMsg] = useState('')
  const a = api(token)

  const saveProfile = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMsg('')
    try {
      await a.patch('/auth/me', form)
      setMsg('Сохранено')
      setTimeout(() => setMsg(''), 3000)
    } catch (ex) {
      setMsg(ex?.response?.data?.detail || 'Ошибка')
    } finally { setSaving(false) }
  }

  const savePassword = async (e) => {
    e.preventDefault()
    if (pwd.new1 !== pwd.new2) { setPwdMsg('Пароли не совпадают'); return }
    setSaving(true)
    setPwdMsg('')
    try {
      await a.post('/auth/change-password', { old_password: pwd.old, new_password: pwd.new1 })
      setPwdMsg('Пароль изменён')
      setPwd({ old: '', new1: '', new2: '' })
      setTimeout(() => setPwdMsg(''), 3000)
    } catch (ex) {
      setPwdMsg(ex?.response?.data?.detail || 'Ошибка')
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-xl font-bold text-gray-800">Настройки</h2>
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h3 className="text-sm font-bold text-gray-700 mb-4">Профиль</h3>
        <form onSubmit={saveProfile} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">ФИО</label>
            <input value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Телефон</label>
            <input value={form.phone_number} onChange={e => setForm(p => ({ ...p, phone_number: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
          </div>
          {msg && <div className={`text-sm ${msg === 'Сохранено' ? 'text-green-600' : 'text-red-500'}`}>{msg}</div>}
          <button type="submit" disabled={saving}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </form>
      </div>
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h3 className="text-sm font-bold text-gray-700 mb-4">Смена пароля</h3>
        <form onSubmit={savePassword} className="space-y-4">
          {[['old', 'Текущий пароль'], ['new1', 'Новый пароль'], ['new2', 'Повтор пароля']].map(([k, l]) => (
            <div key={k}>
              <label className="block text-xs font-semibold text-gray-600 mb-1">{l}</label>
              <input type="password" value={pwd[k]} onChange={e => setPwd(p => ({ ...p, [k]: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
            </div>
          ))}
          {pwdMsg && <div className={`text-sm ${pwdMsg.includes('изменён') ? 'text-green-600' : 'text-red-500'}`}>{pwdMsg}</div>}
          <button type="submit" disabled={saving}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
            {saving ? '...' : 'Изменить пароль'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Main SupervisorCabinet ────────────────────────────────────────────────────
export default function SupervisorCabinet({ adminToken, user, onLogout }) {
  const [activeSection, setActiveSection] = useState('home')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleNav = (key) => {
    setActiveSection(key)
    setSidebarOpen(false)
  }

  const renderSection = () => {
    switch (activeSection) {
      case 'home':      return <HomeDashboard token={adminToken} onNavigate={handleNav} />
      case 'staff':     return <StaffSection token={adminToken} />
      case 'clinics':   return <ClinicsSection token={adminToken} />
      case 'referrals': return <ReferralsSection token={adminToken} />
      case 'analytics': return <AnalyticsSection token={adminToken} />
      case 'bonuses':   return <BonusesSection token={adminToken} />
      case 'audit':     return <AuditSection token={adminToken} />
      case 'settings':  return <SettingsSection token={adminToken} user={user} />
      default:          return null
    }
  }

  const activeNav = NAV.find(n => n.key === activeSection)

  return (
    <div className="flex min-h-screen bg-[#f7f9fb] font-sans">
      {/* Sidebar overlay mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ── */}
      <aside className={`
        fixed top-0 left-0 h-full w-64 bg-[#1a2232] text-white z-30 flex flex-col
        transition-transform duration-200 shadow-2xl
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 md:static md:flex
      `}>
        {/* Logo */}
        <div className="px-6 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
            <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>health_and_safety</span>
          </div>
          <div>
            <div className="text-base font-bold leading-tight font-headline tracking-tight">КлиникСеть</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5">Franchise Admin</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 flex flex-col gap-0.5 overflow-y-auto">
          {NAV.map(item => {
            const isActive = activeSection === item.key
            return (
              <button key={item.key} onClick={() => handleNav(item.key)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-left transition-all duration-150
                  ${isActive
                    ? 'bg-[#0097A7]/20 text-white font-bold border-l-4 border-[#0097A7]'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 font-medium border-l-4 border-transparent'}`}>
                <span className="material-symbols-outlined text-[20px] flex-shrink-0"
                  style={isActive ? { fontVariationSettings: "'FILL' 1" } : {}}>
                  {item.icon}
                </span>
                <span className="flex-1 leading-none">{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* User + logout */}
        <div className="px-2 py-4 mt-auto border-t border-white/10">
          <div className="flex items-center gap-2.5 px-4 py-3 mb-1">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
              {(user?.full_name || user?.username || 'A')[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-white truncate">{user?.full_name || user?.username || 'Администратор'}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Владелец франшизы</div>
            </div>
          </div>
          <button onClick={onLogout}
            className="w-full text-slate-400 hover:text-white hover:bg-white/5 rounded-lg px-4 py-2.5 text-sm transition flex items-center gap-3">
            <span className="material-symbols-outlined text-[18px]">logout</span>
            Выйти
          </button>
        </div>
      </aside>

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="md:hidden bg-[#1a2232] text-white flex items-center gap-3 px-4 py-3 sticky top-0 z-10">
          <button onClick={() => setSidebarOpen(true)} className="text-slate-400 hover:text-white transition">
            <span className="material-symbols-outlined">menu</span>
          </button>
          <span className="font-headline font-bold text-sm tracking-tight">КлиникСеть</span>
          <button onClick={onLogout} className="ml-auto text-slate-400 hover:text-white transition">
            <span className="material-symbols-outlined text-lg">logout</span>
          </button>
        </header>

        {/* Desktop header */}
        <header className="hidden md:flex items-center justify-between px-8 h-16
          bg-white border-b border-[#eceef0] sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#0097A7] text-lg"
              style={{ fontVariationSettings: "'FILL' 1" }}>
              {activeNav?.icon || 'dashboard'}
            </span>
            <h1 className="font-headline font-bold text-base text-gray-800 tracking-tight">
              {activeNav?.label || 'Панель управления'}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-semibold text-gray-800">{user?.full_name || user?.username}</div>
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">Владелец франшизы</div>
            </div>
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
              {(user?.full_name || user?.username || 'A')[0].toUpperCase()}
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 px-4 md:px-8 py-6 max-w-5xl w-full mx-auto">
          {renderSection()}
        </main>
      </div>
    </div>
  )
}
