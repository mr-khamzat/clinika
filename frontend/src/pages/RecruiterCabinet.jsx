import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

const api = (token) => ({
  get: (url, params) => axios.get(API_BASE + url, { headers: { Authorization: `Bearer ${token}` }, params }),
  post: (url, data) => axios.post(API_BASE + url, data, { headers: { Authorization: `Bearer ${token}` } }),
})

export default function RecruiterCabinet({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('dashboard')
  const [stats, setStats] = useState(null)
  const [doctors, setDoctors] = useState([])
  const [bonuses, setBonuses] = useState([])
  const [invites, setInvites] = useState([])
  const [clinics, setClinics] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState(null)

  // Форма приглашения
  const [form, setForm] = useState({ email: '', full_name: '', phone_number: '', clinic_ids: [] })
  const [newInvite, setNewInvite] = useState(null)

  const a = api(adminToken)

  useEffect(() => { loadStats(); loadClinics() }, [])
  useEffect(() => {
    if (tab === 'doctors') loadDoctors()
    if (tab === 'bonuses') loadBonuses()
    if (tab === 'invite') loadInvites()
  }, [tab])

  async function loadStats() {
    try {
      const res = await a.get('/recruiter/stats')
      setStats(res.data)
    } catch {}
  }

  async function loadDoctors() {
    setLoading(true)
    try {
      const res = await a.get('/recruiter/doctors')
      setDoctors(Array.isArray(res.data) ? res.data : [])
    } catch { setError('Ошибка загрузки врачей') }
    setLoading(false)
  }

  async function loadBonuses() {
    setLoading(true)
    try {
      const res = await a.get('/recruiter/bonuses')
      setBonuses(Array.isArray(res.data) ? res.data : [])
    } catch { setError('Ошибка загрузки бонусов') }
    setLoading(false)
  }

  async function loadInvites() {
    setLoading(true)
    try {
      const res = await a.get('/recruiter/invites')
      setInvites(Array.isArray(res.data) ? res.data : [])
    } catch {}
    setLoading(false)
  }

  async function loadClinics() {
    try {
      const res = await a.get('/clinics/')
      setClinics(Array.isArray(res.data) ? res.data : [])
    } catch {}
  }

  async function sendInvite(e) {
    e.preventDefault()
    if (!form.email || form.clinic_ids.length === 0) {
      setError('Укажите email и хотя бы одну клинику')
      return
    }
    setLoading(true); setError('')
    try {
      const res = await a.post('/recruiter/invite', form)
      setNewInvite(res.data)
      setForm({ email: '', full_name: '', phone_number: '', clinic_ids: [] })
      loadInvites()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Ошибка создания приглашения')
    }
    setLoading(false)
  }

  function toggleClinic(id) {
    setForm(f => ({
      ...f,
      clinic_ids: f.clinic_ids.includes(id) ? f.clinic_ids.filter(c => c !== id) : [...f.clinic_ids, id],
    }))
  }

  function copyLink(link, id) {
    const full = window.location.origin + link
    navigator.clipboard.writeText(full).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-base font-bold text-gray-800">{user.full_name || 'Менеджер'}</div>
            <div className="text-xs text-purple-600 font-medium">Кабинет рекрутера</div>
          </div>
          <button onClick={onLogout} className="text-xs text-gray-400 hover:text-gray-600 transition">Выйти</button>
        </div>
        <div className="max-w-2xl mx-auto px-4 flex gap-1 pb-0 overflow-x-auto no-scrollbar">
          {[
            ['dashboard', 'Главная'],
            ['doctors', 'Врачи'],
            ['invite', 'Пригласить'],
            ['bonuses', 'Бонусы'],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition ${
                tab === id ? 'border-purple-600 text-purple-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-5">
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex justify-between">
            {error}
            <button onClick={() => setError('')} className="ml-2 text-red-400">✕</button>
          </div>
        )}

        {/* ─── Dashboard ─── */}
        {tab === 'dashboard' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-gray-800">Мой кабинет</h2>
            {stats ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Привлечено врачей', value: stats.doctors_count, icon: '👨‍⚕️', color: 'bg-purple-50 text-purple-700' },
                    { label: 'Мой %', value: (stats.my_percent || 0) + '%', icon: '📊', color: 'bg-blue-50 text-blue-700' },
                  ].map(c => (
                    <div key={c.label} className={`rounded-xl p-4 text-center ${c.color.split(' ')[0]}`}>
                      <div className="text-2xl mb-1">{c.icon}</div>
                      <div className={`text-2xl font-bold ${c.color.split(' ')[1]}`}>{c.value}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 rounded-xl p-4 text-center">
                    <div className="text-xs text-gray-500 mb-1">Всего бонусов</div>
                    <div className="text-xl font-bold text-green-700">{Number(stats.total_bonuses || 0).toLocaleString('ru')} ₽</div>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-4 text-center">
                    <div className="text-xs text-gray-500 mb-1">Ожидают выплаты</div>
                    <div className="text-xl font-bold text-amber-700">{Number(stats.pending_bonuses || 0).toLocaleString('ru')} ₽</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">{[1,2,3,4].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}</div>
            )}

            <div className="grid grid-cols-2 gap-3 mt-2">
              <button onClick={() => setTab('invite')}
                className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl p-4 text-center font-semibold transition">
                <div className="text-2xl mb-1">➕</div>
                <div className="text-sm">Пригласить врача</div>
              </button>
              <button onClick={() => setTab('doctors')}
                className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl p-4 text-center font-semibold transition">
                <div className="text-2xl mb-1">👥</div>
                <div className="text-sm">Мои врачи</div>
              </button>
            </div>
          </div>
        )}

        {/* ─── Doctors ─── */}
        {tab === 'doctors' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800">Привлечённые врачи</h2>
              <span className="text-sm text-gray-400">{doctors.length} чел.</span>
            </div>
            {loading ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}</div>
            ) : doctors.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <div className="text-5xl mb-3">👨‍⚕️</div>
                <p className="text-sm">Нет привлечённых врачей</p>
                <button onClick={() => setTab('invite')} className="mt-3 text-purple-600 text-sm font-semibold">Пригласить первого →</button>
              </div>
            ) : (
              <div className="space-y-3">
                {doctors.map(d => (
                  <div key={d.id} className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-semibold text-gray-800">{d.full_name}</div>
                        <div className="text-xs text-gray-400">{d.email || d.phone_number || '—'}</div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                        d.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>{d.is_active ? 'Активен' : 'Неактивен'}</span>
                    </div>
                    {d.clinics?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {d.clinics.map(c => (
                          <span key={c.id} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">{c.name}</span>
                        ))}
                      </div>
                    )}
                    <div className="text-xs text-gray-500 flex justify-between">
                      <span>Зарегистрирован: {new Date(d.created_at).toLocaleDateString('ru')}</span>
                      <span className="text-green-600 font-semibold">Заработано: {Number(d.bonuses_earned).toLocaleString('ru')} ₽</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Invite ─── */}
        {tab === 'invite' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-gray-800">Пригласить врача</h2>

            {newInvite && (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
                <div className="text-3xl mb-2">✅</div>
                <div className="font-bold text-green-800 mb-1">Приглашение создано!</div>
                <div className="text-xs text-gray-500 mb-2">Отправьте эту ссылку врачу:</div>
                <div className="bg-white border rounded-xl px-3 py-2 text-xs font-mono break-all text-gray-700 mb-3">
                  {window.location.origin + newInvite.invite_link}
                </div>
                <button onClick={() => copyLink(newInvite.invite_link, 'new')}
                  className="w-full bg-purple-600 text-white rounded-xl py-2.5 font-semibold text-sm mb-2">
                  {copiedId === 'new' ? '✓ Скопировано!' : '📋 Скопировать ссылку'}
                </button>
                <button onClick={() => setNewInvite(null)} className="text-sm text-gray-400 hover:text-gray-600">
                  Создать ещё одно
                </button>
              </div>
            )}

            <form onSubmit={sendInvite} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email врача *</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="doctor@example.com" required
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ФИО врача</label>
                <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="Иванов Иван Иванович"
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Телефон</label>
                <input value={form.phone_number} onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))}
                  placeholder="+7..."
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Доступ к клиникам *</label>
                <div className="mt-2 space-y-2">
                  {clinics.map(c => (
                    <label key={c.id} className="flex items-center gap-3 cursor-pointer p-2 rounded-xl hover:bg-gray-50">
                      <input type="checkbox" checked={form.clinic_ids.includes(c.id)}
                        onChange={() => toggleClinic(c.id)}
                        className="w-4 h-4 text-purple-600 rounded" />
                      <span className="text-sm text-gray-700">{c.name}</span>
                    </label>
                  ))}
                  {clinics.length === 0 && <div className="text-sm text-gray-400">Нет доступных клиник</div>}
                </div>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700">
                Врач получит ссылку для регистрации. После регистрации он сможет создавать направления в выбранные клиники.
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold rounded-xl py-3 text-sm transition">
                {loading ? 'Создаём...' : 'Создать приглашение'}
              </button>
            </form>

            {/* Список отправленных приглашений */}
            {invites.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-700 text-sm mb-2">Отправленные приглашения</h3>
                <div className="space-y-2">
                  {invites.map(inv => (
                    <div key={inv.id} className="bg-white border border-gray-100 rounded-xl p-3 flex justify-between items-center">
                      <div>
                        <div className="text-sm font-medium text-gray-800">{inv.email}</div>
                        <div className="text-xs text-gray-400">
                          {inv.is_used ? '✅ Принято' : '⏳ Ожидает'}
                          {inv.expires_at && !inv.is_used && ` · до ${new Date(inv.expires_at).toLocaleDateString('ru')}`}
                        </div>
                      </div>
                      {!inv.is_used && (
                        <button onClick={() => copyLink(`/invite/${inv.code}`, inv.id)}
                          className="text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded-lg font-semibold hover:bg-purple-100">
                          {copiedId === inv.id ? '✓' : '📋'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── Bonuses ─── */}
        {tab === 'bonuses' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-gray-800">Мои бонусы</h2>
            {loading ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
            ) : bonuses.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <div className="text-5xl mb-3">💰</div>
                <p className="text-sm">Бонусов пока нет</p>
                <p className="text-xs mt-1">Они появятся когда ваши врачи начнут создавать направления</p>
              </div>
            ) : (
              <div className="space-y-2">
                {bonuses.map(b => (
                  <div key={b.id} className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="flex justify-between items-start mb-1">
                      <div>
                        <div className="text-sm font-semibold text-gray-800">{Number(b.amount).toLocaleString('ru')} ₽</div>
                        <div className="text-xs text-gray-400">{b.doctor_name} · {b.percent_applied}%</div>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        b.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      }`}>{b.status === 'paid' ? 'Выплачен' : 'Начислен'}</span>
                    </div>
                    <div className="text-xs text-gray-400">{new Date(b.created_at).toLocaleDateString('ru')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
