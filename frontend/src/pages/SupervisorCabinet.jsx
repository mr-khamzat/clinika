import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react'
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
  { key: 'services',   label: 'Услуги',       icon: 'medical_services' },
  { key: 'analytics',  label: 'Аналитика',    icon: 'bar_chart' },
  { key: 'bonuses',    label: 'Бонусы',       icon: 'payments' },
  { key: 'billing',    label: 'Биллинг',      icon: 'receipt_long' },
  { key: 'modules',    label: 'Модули',       icon: 'extension' },
  { key: 'mis',        label: 'МИС',          icon: 'sync_alt' },
  { key: 'support',    label: 'Поддержка',    icon: 'support_agent' },
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
          {/* API: {current:{total, confirmed, conversion_pct, bonuses_paid, bonuses_pending}, previous:{...}, delta:{...}} */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetaCard label="Направлений" value={fmt(overview.current?.total)} color="#0097A7" />
            <MetaCard label="Конверсия" value={`${overview.current?.conversion_pct ?? 0}%`} color="#166534" />
            <MetaCard label="Подтверждено" value={fmt(overview.current?.confirmed)} color="#7c3aed" />
            <MetaCard label="Бонусы выплачены" value={`${fmt(overview.current?.bonuses_paid)} тг`} color="#b45309" />
          </div>

          {overview.previous && (
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-700 mb-4">Сравнение с прошлым периодом</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Направлений',  cur: overview.current?.total,           prev: overview.previous?.total },
                  { label: 'Конверсия',    cur: overview.current?.conversion_pct,  prev: overview.previous?.conversion_pct, pct: true },
                  { label: 'Подтверждено', cur: overview.current?.confirmed,        prev: overview.previous?.confirmed },
                  { label: 'Бонусы',       cur: overview.current?.bonuses_paid,    prev: overview.previous?.bonuses_paid },
                ].map(m => {
                  const delta = (Number(m.cur) || 0) - (Number(m.prev) || 0)
                  const up = delta >= 0
                  return (
                    <div key={m.label} className="text-center p-3 rounded-xl bg-gray-50">
                      <div className="text-xs text-gray-400 mb-1">{m.label}</div>
                      <div className="text-lg font-bold text-gray-800">{fmt(m.cur)}{m.pct ? '%' : ''}</div>
                      {m.prev != null && (
                        <div className={`text-xs font-semibold mt-1 ${up ? 'text-green-600' : 'text-red-500'}`}>
                          {up ? '↑' : '↓'} {fmt(Math.abs(delta))}{m.pct ? '%' : ''} vs прошлый
                        </div>
                      )}
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
// API /manager/reports/bonuses returns pre-grouped:
// [{admin_id, full_name, clinic_name, pending_total, paid_total, pending_bonuses:[{bonus_id,service_name,patient_phone,amount,confirmed_at}], paid_bonuses:[...]}]
function BonusesSection({ token }) {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('pending') // 'pending' | 'paid'
  const [search, setSearch] = useState('')
  const [paying, setPaying] = useState(null)
  const [payAll, setPayAll] = useState(null)
  const a = api(token)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await a.get('/manager/reports/bonuses')
      setGroups(Array.isArray(r.data) ? r.data : [])
    } catch { setGroups([]) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const handlePay = async (bonusId) => {
    setPaying(bonusId)
    try {
      await a.patch(`/bonuses/${bonusId}/mark-paid`)
      load()
    } catch (ex) { alert(ex?.response?.data?.detail || 'Ошибка') }
    finally { setPaying(null) }
  }

  const handlePayAll = async (adminId) => {
    if (!window.confirm('Выплатить все бонусы этому сотруднику?')) return
    setPayAll(adminId)
    try {
      await a.post(`/manager/bonuses/mark-paid-all/${adminId}`)
      load()
    } catch (ex) { alert(ex?.response?.data?.detail || 'Ошибка') }
    finally { setPayAll(null) }
  }

  const totalPending = useMemo(() => groups.reduce((s, g) => s + Number(g.pending_total || 0), 0), [groups])

  const filtered = useMemo(() => groups.filter(g => {
    if (!search.trim()) return true
    return (g.full_name || '').toLowerCase().includes(search.toLowerCase())
  }).filter(g => tab === 'pending' ? g.pending_total > 0 || g.pending_bonuses?.length > 0 : g.paid_total > 0 || g.paid_bonuses?.length > 0), [groups, search, tab])

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-800">Бонусы</h2>
        {totalPending > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-sm font-semibold text-amber-700">
            К выплате: {fmt(Math.round(totalPending))} тг
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex gap-1.5">
          {[{ k: 'pending', l: 'К выплате' }, { k: 'paid', l: 'Выплачены' }].map(s => (
            <button key={s.k} onClick={() => setTab(s.k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${tab === s.k ? 'bg-[#0097A7] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
              {s.l}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по сотруднику..."
          className="flex-1 min-w-40 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0097A7]" />
      </div>

      {loading ? <Spinner /> : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-400 text-sm shadow-sm">
          {tab === 'pending' ? 'Нет бонусов к выплате' : 'Нет выплаченных бонусов'}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(g => {
            const bonuses = tab === 'pending' ? (g.pending_bonuses || []) : (g.paid_bonuses || [])
            const total = tab === 'pending' ? g.pending_total : g.paid_total
            return (
              <div key={g.admin_id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
                      {(g.full_name || '?')[0].toUpperCase()}
                    </div>
                    <div>
                      <span className="text-sm font-semibold text-gray-800">{g.full_name}</span>
                      {g.clinic_name && g.clinic_name !== '—' && (
                        <span className="text-xs text-gray-400 ml-2">{g.clinic_name}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold ${tab === 'pending' ? 'text-amber-700' : 'text-green-600'}`}>
                      {fmt(Math.round(total))} тг
                    </span>
                    {tab === 'pending' && total > 0 && (
                      <button onClick={() => handlePayAll(g.admin_id)} disabled={payAll === g.admin_id}
                        className="text-xs bg-[#0097A7] text-white rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50">
                        {payAll === g.admin_id ? '...' : 'Выплатить всё'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="divide-y divide-gray-50">
                  {bonuses.map(b => (
                    <div key={b.bonus_id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <div className="text-sm text-gray-800">{b.service_name || '—'}</div>
                        <div className="text-xs text-gray-400">{b.patient_phone || ''}{b.confirmed_at ? ` · ${new Date(b.confirmed_at).toLocaleDateString('ru')}` : ''}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-gray-800 text-sm">{fmt(b.amount)} тг</span>
                        {tab === 'pending' && (
                          <button onClick={() => handlePay(b.bonus_id)} disabled={paying === b.bonus_id}
                            className="text-xs bg-green-100 text-green-700 rounded-lg px-2.5 py-1.5 font-semibold disabled:opacity-50">
                            {paying === b.bonus_id ? '...' : 'Выплатить'}
                          </button>
                        )}
                        {tab === 'paid' && <span className="text-xs text-green-600 font-semibold">✓</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
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

// ── ServicesSection ───────────────────────────────────────────────────────────
function ServicesSection({ token }) {
  const [services, setServices] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null) // null | 'create' | serviceObj
  const [form, setForm] = useState({ name: '', code: '', category: '', bonus_amount: '', original_price: '' })
  const [saving, setSaving] = useState(false)
  const a = api(token)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const [sr, cr] = await Promise.all([
        a.get('/manager/services/'),
        a.get('/manager/services/categories'),
      ])
      setServices(Array.isArray(sr.data) ? sr.data : [])
      // API returns [{category, total, bonus_count}] or strings
      const rawCats = Array.isArray(cr.data) ? cr.data : []
      setCategories(rawCats.map(c => (typeof c === 'string' ? c : c?.category)).filter(Boolean))
    } catch { setErr('Ошибка загрузки') }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setForm({ name: '', code: '', category: categories[0] || '', bonus_amount: '', original_price: '' })
    setModal('create')
  }
  const openEdit = (s) => {
    setForm({ name: s.name, code: s.code || '', category: s.category || '', bonus_amount: s.bonus_amount || '', original_price: s.original_price || '' })
    setModal(s)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        name: form.name,
        code: form.code || null,
        category: form.category || null,
        bonus_amount: parseFloat(form.bonus_amount) || 0,
        original_price: form.original_price ? parseFloat(form.original_price) : null,
      }
      if (modal === 'create') {
        await a.post('/manager/services/', body)
      } else {
        await a.patch(`/manager/services/${modal.id}`, body)
      }
      setModal(null)
      load()
    } catch (ex) {
      alert(ex?.response?.data?.detail || 'Ошибка сохранения')
    } finally { setSaving(false) }
  }

  const handleDeactivate = async (id) => {
    if (!window.confirm('Деактивировать услугу?')) return
    try {
      await a.del(`/manager/services/${id}`)
      load()
    } catch (ex) { alert(ex?.response?.data?.detail || 'Ошибка') }
  }

  const filtered = useMemo(() => services.filter(s => {
    if (catFilter !== 'all' && s.category !== catFilter) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (s.name || '').toLowerCase().includes(q) || (s.code || '').toLowerCase().includes(q)
  }), [services, catFilter, search])

  const grouped = useMemo(() => {
    const map = {}
    filtered.forEach(s => {
      const cat = s.category || 'Без категории'
      if (!map[cat]) map[cat] = []
      map[cat].push(s)
    })
    return Object.entries(map).sort(([a], [b]) =>
      a === 'Без категории' ? 1 : b === 'Без категории' ? -1 : a.localeCompare(b, 'ru')
    )
  }, [filtered])

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-800">Услуги</h2>
        <button onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
          <span className="material-symbols-outlined text-[18px]">add</span>
          Добавить услугу
        </button>
      </div>

      <div className="mb-4 space-y-2">
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setCatFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${catFilter === 'all' ? 'bg-[#0097A7] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
            Все
          </button>
          {categories.map(c => (
            <button key={c} onClick={() => setCatFilter(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${catFilter === c ? 'bg-[#0097A7] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
              {c}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по названию или коду..."
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
      </div>

      <Err msg={err} />
      {loading ? <Spinner /> : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-400 text-sm shadow-sm">Услуг нет</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([cat, items]) => (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="material-symbols-outlined text-[16px] text-[#0097A7]">category</span>
                <span className="text-sm font-bold text-gray-700">{cat}</span>
                <span className="ml-1 text-xs bg-[#e0f7fa] text-[#0097A7] px-2 py-0.5 rounded-full font-semibold">{items.length}</span>
              </div>
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        {['Название', 'Код', 'Бонус', 'Цена', 'Статус', ''].map(h => (
                          <th key={h} className="text-left text-xs font-semibold text-gray-400 px-4 py-3 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((s, i) => (
                        <tr key={s.id} className={`border-b border-gray-50 ${i % 2 ? 'bg-gray-50/40' : ''}`}>
                          <td className="px-4 py-3 font-medium text-gray-800">{s.name}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs font-mono">{s.code || '—'}</td>
                          <td className="px-4 py-3 text-[#0097A7] font-semibold">{s.bonus_amount ? `${fmt(s.bonus_amount)} тг` : '—'}</td>
                          <td className="px-4 py-3 text-gray-500">{s.original_price ? `${fmt(s.original_price)} тг` : '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.is_active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                              {s.is_active !== false ? 'Активна' : 'Неактивна'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button onClick={() => openEdit(s)}
                                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg px-2.5 py-1.5 transition">Изменить</button>
                              {s.is_active !== false && (
                                <button onClick={() => handleDeactivate(s.id)}
                                  className="text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg px-2.5 py-1.5 transition">Откл.</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="md:hidden divide-y divide-gray-100">
                  {items.map(s => (
                    <div key={s.id} className="p-4 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-gray-800 text-sm">{s.name}</div>
                        <div className="text-xs text-gray-400">{s.bonus_amount ? `бонус ${fmt(s.bonus_amount)} тг` : ''} {s.original_price ? `· цена ${fmt(s.original_price)} тг` : ''}</div>
                      </div>
                      <button onClick={() => openEdit(s)} className="text-xs text-[#0097A7] font-semibold">Изменить</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">{modal === 'create' ? 'Новая услуга' : 'Редактировать услугу'}</h2>
              <button onClick={() => setModal(null)}><span className="material-symbols-outlined text-gray-400">close</span></button>
            </div>
            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Название *</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Код (МИС)</label>
                  <input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Категория</label>
                  {categories.length > 0 ? (
                    <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]">
                      <option value="">— не задана —</option>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Бонус (тг)</label>
                  <input type="number" min="0" step="0.01" value={form.bonus_amount} onChange={e => setForm(p => ({ ...p, bonus_amount: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Цена (тг)</label>
                  <input type="number" min="0" step="0.01" value={form.original_price} onChange={e => setForm(p => ({ ...p, original_price: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setModal(null)} className="px-4 py-2.5 text-sm text-gray-600">Отмена</button>
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

// ── BillingSection ────────────────────────────────────────────────────────────
function BillingSection({ token }) {
  const [summary, setSummary] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const a = api(token)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      a.get('/billing/summary').catch(() => ({ data: null })),
      a.get('/billing/invoices').catch(() => ({ data: { items: [] } })),
      a.get('/billing/plans').catch(() => ({ data: [] })),
    ]).then(([s, inv, p]) => {
      setSummary(s.data)
      setInvoices(inv.data?.items || [])
      setPlans(Array.isArray(p.data) ? p.data : [])
    }).finally(() => setLoading(false))
  }, [token])

  const PLAN_NAMES = { basic: 'Basic', professional: 'Professional', enterprise: 'Enterprise' }
  const STATUS_LABELS = {
    active: { label: 'Активна', cls: 'bg-green-100 text-green-700' },
    trial:  { label: 'Пробный период', cls: 'bg-amber-100 text-amber-700' },
    expired: { label: 'Истекла', cls: 'bg-red-100 text-red-600' },
    cancelled: { label: 'Отменена', cls: 'bg-gray-100 text-gray-600' },
  }
  const CYCLE_LABELS = { monthly: '1 мес', quarterly: '3 мес', semi_annual: '6 мес', nine_months: '9 мес', annual: '12 мес' }

  const sub = summary?.subscription

  if (loading) return <Spinner />

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-5">Биллинг</h2>

      <div className="flex gap-2 mb-5">
        {[{ k: 'overview', l: 'Обзор' }, { k: 'invoices', l: 'Счета' }, { k: 'plans', l: 'Тарифы' }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${tab === t.k ? 'text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
            style={tab === t.k ? { background: 'linear-gradient(135deg,#0097A7,#006173)' } : {}}>
            {t.l}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          {sub ? (
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Текущая подписка</div>
                  <div className="text-2xl font-bold text-gray-800">{PLAN_NAMES[sub.plan] || sub.plan}</div>
                  <div className="text-sm text-gray-500 mt-1">{CYCLE_LABELS[sub.billing_cycle] || sub.billing_cycle}</div>
                </div>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full ${STATUS_LABELS[sub.status]?.cls || 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABELS[sub.status]?.label || sub.status}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-xs text-gray-400 mb-1">Сумма за период</div>
                  <div className="font-bold text-gray-800">{fmt(sub.amount_per_period)} тг</div>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-xs text-gray-400 mb-1">Период</div>
                  <div className="font-bold text-gray-800 text-xs">
                    {sub.current_period_start ? new Date(sub.current_period_start).toLocaleDateString('ru') : '—'} —{' '}
                    {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString('ru') : '—'}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-xs text-gray-400 mb-1">Следующий счёт</div>
                  <div className="font-bold text-gray-800 text-xs">
                    {sub.next_invoice_date ? new Date(sub.next_invoice_date).toLocaleDateString('ru') : '—'}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-8 text-center text-gray-400 shadow-sm">
              Подписка не найдена или недоступна
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl shadow-sm p-5 text-center">
              <div className="text-xs text-gray-400 mb-1">Оплачено всего</div>
              <div className="text-2xl font-bold text-green-600">{fmt(summary?.total_paid)} тг</div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-5 text-center">
              <div className="text-xs text-gray-400 mb-1">К оплате</div>
              <div className="text-2xl font-bold text-amber-600">{fmt(summary?.total_due)} тг</div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-5 text-center">
              <div className="text-xs text-gray-400 mb-1">Счетов</div>
              <div className="text-2xl font-bold text-gray-800">{summary?.invoices_count || 0}</div>
            </div>
          </div>
        </div>
      )}

      {tab === 'invoices' && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {invoices.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">Счетов нет</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Номер', 'Период', 'Сумма', 'Статус', 'Дата'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-400 px-4 py-3 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, i) => (
                  <tr key={inv.id} className={`border-b border-gray-50 ${i % 2 ? 'bg-gray-50/40' : ''}`}>
                    <td className="px-4 py-3 text-xs font-mono text-gray-500">{inv.invoice_number || inv.id?.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {inv.period_start ? new Date(inv.period_start).toLocaleDateString('ru') : '—'} —{' '}
                      {inv.period_end ? new Date(inv.period_end).toLocaleDateString('ru') : '—'}
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-800">{fmt(inv.amount)} тг</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        inv.status === 'paid' ? 'bg-green-100 text-green-700' :
                        inv.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'
                      }`}>
                        {inv.status === 'paid' ? 'Оплачен' : inv.status === 'pending' ? 'Ожидает' : inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {inv.created_at ? new Date(inv.created_at).toLocaleDateString('ru') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'plans' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.length > 0 ? plans.map(p => {
            const key = p.plan || p.key || p.name
            const isActive = sub?.plan === key
            return (
            <div key={key} className={`bg-white rounded-2xl shadow-sm p-5 ${isActive ? 'ring-2 ring-[#0097A7]' : ''}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="font-bold text-gray-800">{p.name || PLAN_NAMES[key] || key}</div>
                {isActive && <span className="text-xs bg-[#0097A7] text-white px-2 py-0.5 rounded-full font-semibold">Текущий</span>}
              </div>
              {p.subtitle && <div className="text-xs text-gray-400 mb-3">{p.subtitle}</div>}
              <div className="text-2xl font-bold text-[#0097A7] mb-1">
                {fmt(p.price_monthly || p.prices?.monthly || p.monthly_price)} тг
              </div>
              <div className="text-xs text-gray-400 mb-4">в месяц</div>
              {p.bullets && (
                <ul className="space-y-1">
                  {(Array.isArray(p.bullets) ? p.bullets : []).map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-gray-600">
                      <span className="material-symbols-outlined text-green-500 text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                      {f}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            )
          }) : (
            ['Basic', 'Professional', 'Enterprise'].map((name, i) => {
              const key = ['basic', 'professional', 'enterprise'][i]
              const prices = { basic: 9900, professional: 24900, enterprise: 49900 }
              return (
                <div key={key} className={`bg-white rounded-2xl shadow-sm p-5 ${sub?.plan === key ? 'ring-2 ring-[#0097A7]' : ''}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-bold text-gray-800">{name}</div>
                    {sub?.plan === key && <span className="text-xs bg-[#0097A7] text-white px-2 py-0.5 rounded-full">Текущий</span>}
                  </div>
                  <div className="text-2xl font-bold text-[#0097A7] mb-1">{fmt(prices[key])} тг</div>
                  <div className="text-xs text-gray-400">в месяц</div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

// ── ModulesSection ────────────────────────────────────────────────────────────
function ModulesSection({ token }) {
  const [features, setFeatures] = useState([])
  const [sub, setSub] = useState(null)
  const [loading, setLoading] = useState(true)
  const a = api(token)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      a.get('/modules/features').catch(() => ({ data: [] })),
      a.get('/billing/subscription').catch(() => ({ data: null })),
    ]).then(([f, s]) => {
      setFeatures(Array.isArray(f.data) ? f.data : [])
      setSub(s.data)
    }).finally(() => setLoading(false))
  }, [token])

  const MODULE_LABELS = {
    referrals: 'Направления', bonuses: 'Бонусы', clinics: 'Клиники', qr_scan: 'QR-сканер',
    analytics: 'Аналитика', support: 'Поддержка', invitations: 'Приглашения',
    discounts: 'Скидки', kpi: 'KPI', mis_sync: 'МИС-синхронизация',
    partner_portal: 'Портал партнёров', custom_branding: 'Брендинг',
    sms_notify: 'SMS уведомления', scheduling: 'Расписание',
    billing: 'Биллинг', audit_log: 'Журнал аудита', multi_tenant: 'Мульти-тенант',
    api_access: 'API доступ', financial_ledger: 'Фин. реестр',
    telephony_basic: 'Телефония', video_calls: 'Видеозвонки', ai_analytics: 'AI-аналитика',
    advertising: 'Реклама',
  }

  const PLAN_NAMES = { basic: 'Basic', professional: 'Professional', enterprise: 'Enterprise' }

  if (loading) return <Spinner />

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-5">Подключённые модули и тарифы</h2>

      {sub && (
        <div className="bg-white rounded-2xl shadow-sm p-5 mb-5" style={{ borderLeft: '4px solid #0097A7' }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Активный тариф</div>
              <div className="text-xl font-bold text-gray-800">{PLAN_NAMES[sub.plan] || sub.plan}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-400 mb-1">Действует до</div>
              <div className="font-semibold text-gray-700">
                {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString('ru') : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {features.map(f => (
          <div key={f.name} className={`bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3 ${f.enabled ? '' : 'opacity-60'}`}>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${f.enabled ? 'bg-[#0097A7]/10' : 'bg-gray-100'}`}>
              <span className="material-symbols-outlined text-[18px]" style={{ color: f.enabled ? '#0097A7' : '#9ca3af', fontVariationSettings: f.enabled ? "'FILL' 1" : '' }}>
                {f.enabled ? 'check_circle' : 'radio_button_unchecked'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-800 truncate">
                {MODULE_LABELS[f.name] || f.name}
              </div>
              <div className="text-xs text-gray-400">{f.enabled ? 'Подключён' : 'Не подключён'}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── MisSection ────────────────────────────────────────────────────────────────
function MisSection({ token }) {
  const [status, setStatus] = useState(null)
  const [misClinics, setMisClinics] = useState([])
  const [misDoctors, setMisDoctors] = useState([])
  const [misServices, setMisServices] = useState([])
  const [tab, setTab] = useState('status')
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const a = api(token)

  const loadStatus = useCallback(async () => {
    try {
      const r = await a.get('/manager/mis/status')
      setStatus(r.data)
    } catch { setStatus(null) }
  }, [token])

  useEffect(() => { loadStatus() }, [loadStatus])

  const loadTab = async (t) => {
    setTab(t)
    setLoading(true)
    try {
      if (t === 'clinics' && misClinics.length === 0) {
        const r = await a.get('/mis/clinics')
        setMisClinics(Array.isArray(r.data) ? r.data : [])
      }
      if (t === 'doctors' && misDoctors.length === 0) {
        const r = await a.get('/mis/doctors')
        setMisDoctors(Array.isArray(r.data) ? r.data : [])
      }
      if (t === 'services' && misServices.length === 0) {
        const r = await a.get('/mis/services')
        setMisServices(Array.isArray(r.data) ? r.data : [])
      }
    } catch {}
    setLoading(false)
  }

  const handleSync = async (type) => {
    setSyncing(type)
    try {
      // Sync endpoints require {mis_ids:[...]} — fetch current list first to get IDs
      let listData = []
      if (type === 'clinics')  listData = misClinics.length  ? misClinics  : (await a.get('/mis/clinics').catch(() => ({data:[]}))).data
      if (type === 'doctors')  listData = misDoctors.length  ? misDoctors  : (await a.get('/mis/doctors').catch(() => ({data:[]}))).data
      if (type === 'services') listData = misServices.length ? misServices : (await a.get('/mis/services').catch(() => ({data:[]}))).data
      const ids = (Array.isArray(listData) ? listData : []).map(x => x.mis_id || x.id).filter(Boolean)
      await a.post(`/mis/${type}/sync`, { mis_ids: ids })
      // Reload after sync
      if (type === 'clinics')  { const r = await a.get('/mis/clinics');  setMisClinics(Array.isArray(r.data) ? r.data : []) }
      if (type === 'doctors')  { const r = await a.get('/mis/doctors');  setMisDoctors(Array.isArray(r.data) ? r.data : []) }
      if (type === 'services') { const r = await a.get('/mis/services'); setMisServices(Array.isArray(r.data) ? r.data : []) }
    } catch (ex) {
      alert(ex?.response?.data?.detail || 'Ошибка синхронизации')
    } finally { setSyncing(null) }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await a.post('/manager/settings/test-mis')
      setTestResult({ ok: true, msg: r.data?.message || 'Соединение успешно' })
    } catch (ex) {
      setTestResult({ ok: false, msg: ex?.response?.data?.detail || 'Ошибка соединения' })
    } finally { setTesting(false) }
  }

  const tabs = [
    { k: 'status', l: 'Статус' }, { k: 'clinics', l: 'Клиники' },
    { k: 'doctors', l: 'Врачи' }, { k: 'services', l: 'Услуги' },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-800">Интеграция МИС</h2>
        <button onClick={handleTest} disabled={testing}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
          <span className="material-symbols-outlined text-[18px]">wifi_tethering</span>
          {testing ? 'Проверяем...' : 'Проверить связь'}
        </button>
      </div>

      {testResult && (
        <div className={`rounded-xl px-4 py-3 mb-4 text-sm font-medium flex items-center gap-2 ${testResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
          <span className="material-symbols-outlined text-[18px]">{testResult.ok ? 'check_circle' : 'error'}</span>
          {testResult.msg}
        </div>
      )}

      <div className="flex gap-2 mb-5 flex-wrap">
        {tabs.map(t => (
          <button key={t.k} onClick={() => loadTab(t.k)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${tab === t.k ? 'text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
            style={tab === t.k ? { background: 'linear-gradient(135deg,#0097A7,#006173)' } : {}}>
            {t.l}
          </button>
        ))}
      </div>

      {tab === 'status' && (
        <div className="bg-white rounded-2xl shadow-sm p-6">
          {status ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-gray-50">
                <span className="text-sm text-gray-600">Статус подключения</span>
                <span className={`text-sm font-semibold flex items-center gap-1 ${(status.connected || status.online) ? 'text-green-600' : 'text-red-500'}`}>
                  <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {(status.connected || status.online) ? 'check_circle' : 'cancel'}
                  </span>
                  {(status.connected || status.online) ? 'Подключено' : 'Не подключено'}
                </span>
              </div>
              {status.url && (
                <div className="flex items-center justify-between py-2 border-b border-gray-50">
                  <span className="text-sm text-gray-600">URL МИС</span>
                  <span className="text-sm text-gray-800 font-mono truncate max-w-xs">{status.url}</span>
                </div>
              )}
              {status.clinic_count != null && (
                <div className="flex items-center justify-between py-2 border-b border-gray-50">
                  <span className="text-sm text-gray-600">Клиник в МИС</span>
                  <span className="text-sm font-semibold text-gray-800">{status.clinic_count}</span>
                </div>
              )}
              {status.last_sync && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-gray-600">Последняя синхронизация</span>
                  <span className="text-sm text-gray-800">{new Date(status.last_sync).toLocaleString('ru')}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-6">
          <span className="material-symbols-outlined text-4xl text-gray-200 block mb-2">sync_disabled</span>
          <div className="text-sm text-gray-400">МИС не настроен или недоступен</div>
          <div className="text-xs text-gray-300 mt-1">Настройте подключение в разделе «Настройки → МИС»</div>
        </div>
          )}
        </div>
      )}

      {tab === 'clinics' && (
        <div>
          <div className="flex justify-end mb-3">
            <button onClick={() => handleSync('clinics')} disabled={syncing === 'clinics'}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              <span className="material-symbols-outlined text-[16px]">sync</span>
              {syncing === 'clinics' ? 'Синхронизация...' : 'Синхронизировать'}
            </button>
          </div>
          {loading ? <Spinner /> : misClinics.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm shadow-sm">Нет данных МИС</div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100 bg-gray-50">
                  {['ID в МИС', 'Название', 'Синхронизирован'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-400 px-4 py-3 uppercase tracking-wide">{h}</th>
                  ))}
                </tr></thead>
                <tbody>{misClinics.map((c, i) => (
                  <tr key={c.mis_id || i} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 text-xs font-mono text-gray-400">{c.mis_id || '—'}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{c.name || c.mis_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${c.synced ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {c.synced ? 'Да' : 'Нет'}
                      </span>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'doctors' && (
        <div>
          <div className="flex justify-end mb-3">
            <button onClick={() => handleSync('doctors')} disabled={syncing === 'doctors'}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              <span className="material-symbols-outlined text-[16px]">sync</span>
              {syncing === 'doctors' ? 'Синхронизация...' : 'Синхронизировать'}
            </button>
          </div>
          {loading ? <Spinner /> : misDoctors.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm shadow-sm">Нет данных МИС</div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100 bg-gray-50">
                  {['ФИО', 'ID в МИС', 'Специализация', 'Аккаунт'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-400 px-4 py-3 uppercase tracking-wide">{h}</th>
                  ))}
                </tr></thead>
                <tbody>{misDoctors.map((d, i) => (
                  <tr key={d.mis_id || i} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-gray-800">{d.full_name || d.mis_name || '—'}</td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-400">{d.mis_id || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{d.specialization || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${d.has_account ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {d.has_account ? 'Создан' : 'Нет'}
                      </span>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'services' && (
        <div>
          <div className="flex justify-end mb-3">
            <button onClick={() => handleSync('services')} disabled={syncing === 'services'}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              <span className="material-symbols-outlined text-[16px]">sync</span>
              {syncing === 'services' ? 'Синхронизация...' : 'Синхронизировать'}
            </button>
          </div>
          {loading ? <Spinner /> : misServices.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center text-gray-400 text-sm shadow-sm">Нет данных МИС</div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100 bg-gray-50">
                  {['Название', 'Код МИС', 'Категория', 'Цена', 'Синх.'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-400 px-4 py-3 uppercase tracking-wide">{h}</th>
                  ))}
                </tr></thead>
                <tbody>{misServices.map((s, i) => (
                  <tr key={s.mis_id || i} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-gray-800">{s.name || s.mis_name || '—'}</td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-400">{s.mis_id || s.code || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{s.category || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{s.price ? `${fmt(s.price)} тг` : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${s.synced ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {s.synced ? 'Да' : 'Нет'}
                      </span>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── SupportSection ────────────────────────────────────────────────────────────
function SupportSection({ token }) {
  const [threads, setThreads] = useState([])
  const [active, setActive] = useState(null) // { user_id, user_name, is_closed }
  const [messages, setMessages] = useState([])
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef(null)
  const authH = { Authorization: `Bearer ${token}` }
  const BASE = API_BASE + '/support'

  const loadThreads = useCallback(async () => {
    try {
      const r = await axios.get(`${BASE}/admin/threads`, { headers: authH })
      setThreads(Array.isArray(r.data) ? r.data : [])
    } catch { setThreads([]) }
    setLoading(false)
  }, [token])

  useEffect(() => { loadThreads() }, [loadThreads])

  const loadMessages = useCallback(async (userId) => {
    try {
      const r = await axios.get(`${BASE}/admin/thread/${userId}`, { headers: authH })
      setMessages(Array.isArray(r.data) ? r.data : [])
    } catch {}
  }, [token])

  // Heartbeat while thread is open
  useEffect(() => {
    if (!active) return
    loadMessages(active.user_id)
    const beat = () => axios.post(`${BASE}/operator/heartbeat`, {}, { headers: authH }).catch(() => {})
    beat()
    const beatId = setInterval(beat, 30000)
    const pollId = setInterval(() => loadMessages(active.user_id), 5000)
    return () => {
      clearInterval(beatId)
      clearInterval(pollId)
      axios.post(`${BASE}/operator/offline`, {}, { headers: authH }).catch(() => {})
    }
  }, [active?.user_id])

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [messages])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!reply.trim() || sending) return
    const t = reply.trim()
    setReply('')
    setSending(true)
    try {
      await axios.post(`${BASE}/admin/reply/${active.user_id}`, { text: t }, { headers: authH })
      await loadMessages(active.user_id)
    } catch { setReply(t) }
    finally { setSending(false) }
  }

  const handleClose = async () => {
    try {
      await axios.post(`${BASE}/admin/close/${active.user_id}`, {}, { headers: authH })
      setActive(p => ({ ...p, is_closed: true }))
      loadThreads()
    } catch {}
  }

  const handleReopen = async () => {
    try {
      await axios.post(`${BASE}/admin/reopen/${active.user_id}`, {}, { headers: authH })
      setActive(p => ({ ...p, is_closed: false }))
      loadThreads()
    } catch {}
  }

  const fmtTime = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    const now = new Date()
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-5">Поддержка</h2>
      <div className="flex gap-4 h-[calc(100vh-220px)] min-h-96">
        {/* Thread list */}
        <div className={`w-72 flex-shrink-0 bg-white rounded-2xl shadow-sm overflow-y-auto ${active ? 'hidden md:flex flex-col' : 'flex flex-col w-full'}`}>
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-bold text-gray-800">Диалоги</span>
            <button onClick={loadThreads} className="text-gray-400 hover:text-gray-600">
              <span className="material-symbols-outlined text-[18px]">refresh</span>
            </button>
          </div>
          {loading ? <div className="p-4"><Spinner /></div> : threads.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">Диалогов нет</div>
          ) : threads.map(t => (
            <button key={t.user_id} onClick={() => setActive(t)}
              className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition ${active?.user_id === t.user_id ? 'bg-[#0097A7]/5 border-l-4 border-l-[#0097A7]' : ''}`}>
              <div className="flex items-start justify-between mb-0.5">
                <span className="text-sm font-semibold text-gray-800 truncate">{t.user_name || '—'}</span>
                {t.unread > 0 && (
                  <span className="bg-[#0097A7] text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 flex-shrink-0 ml-1">
                    {t.unread}
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-400 truncate">{t.last_message || '—'}</div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-gray-300">{fmtTime(t.last_at)}</span>
                {t.is_closed && <span className="text-[10px] text-gray-400">Закрыт</span>}
              </div>
            </button>
          ))}
        </div>

        {/* Chat window */}
        {active ? (
          <div className="flex-1 bg-white rounded-2xl shadow-sm flex flex-col min-w-0">
            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
              <button onClick={() => setActive(null)} className="md:hidden text-gray-400">
                <span className="material-symbols-outlined">arrow_back</span>
              </button>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
                {(active.user_name || '?')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-800">{active.user_name}</div>
                <div className="text-xs text-gray-400">{active.user_role || ''}</div>
              </div>
              <div className="flex gap-2">
                {active.is_closed ? (
                  <button onClick={handleReopen}
                    className="text-xs bg-green-100 text-green-700 rounded-lg px-3 py-1.5 font-semibold">
                    Открыть
                  </button>
                ) : (
                  <button onClick={handleClose}
                    className="text-xs bg-gray-100 text-gray-600 rounded-lg px-3 py-1.5 font-semibold">
                    Закрыть
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.map(m => (
                <div key={m.id} className={`flex ${m.is_from_user ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    m.is_from_user
                      ? 'bg-gray-100 text-gray-800 rounded-tl-sm'
                      : 'text-white rounded-tr-sm'
                  }`} style={!m.is_from_user ? { background: 'linear-gradient(135deg,#0097A7,#006173)' } : {}}>
                    {m.text}
                    <div className={`text-[10px] mt-1 ${m.is_from_user ? 'text-gray-400' : 'text-white/60'}`}>
                      {fmtTime(m.created_at)}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Reply form */}
            {!active.is_closed && (
              <form onSubmit={handleSend} className="px-4 py-3 border-t border-gray-100 flex gap-2">
                <input value={reply} onChange={e => setReply(e.target.value)} placeholder="Написать ответ..."
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
                <button type="submit" disabled={!reply.trim() || sending}
                  className="px-4 py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-40 transition"
                  style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
                  <span className="material-symbols-outlined text-[18px]">send</span>
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="hidden md:flex flex-1 items-center justify-center bg-white rounded-2xl shadow-sm">
            <div className="text-center text-gray-400">
              <span className="material-symbols-outlined text-5xl mb-3 block text-gray-200">chat</span>
              <div className="text-sm">Выберите диалог</div>
            </div>
          </div>
        )}
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
      case 'services':  return <ServicesSection token={adminToken} />
      case 'analytics': return <AnalyticsSection token={adminToken} />
      case 'bonuses':   return <BonusesSection token={adminToken} />
      case 'billing':   return <BillingSection token={adminToken} />
      case 'modules':   return <ModulesSection token={adminToken} />
      case 'mis':       return <MisSection token={adminToken} />
      case 'support':   return <SupportSection token={adminToken} />
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
