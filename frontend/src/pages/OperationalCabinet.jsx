import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

const api = (token) => ({
  get: (url, params) => axios.get(API_BASE + url, { headers: { Authorization: `Bearer ${token}` }, params }),
  post: (url, data) => axios.post(API_BASE + url, data, { headers: { Authorization: `Bearer ${token}` } }),
})

const ROLE_LABELS = {
  admin: 'Администратор',
  nurse: 'Медсестра',
}

export default function OperationalCabinet({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('dashboard')
  const [stats, setStats] = useState(null)
  const [referrals, setReferrals] = useState([])
  const [bonuses, setBonuses] = useState([])
  const [clinics, setClinics] = useState([])
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Форма создания направления
  const [form, setForm] = useState({ to_clinic_id: '', service_id: '', patient_phone: '', patient_name: '', notes: '' })
  const [createdRef, setCreatedRef] = useState(null)

  const a = api(adminToken)

  useEffect(() => { loadStats(); loadClinics(); loadServices() }, [])
  useEffect(() => {
    if (tab === 'referrals') loadReferrals()
    if (tab === 'bonuses') loadBonuses()
  }, [tab])

  async function loadStats() {
    try {
      const [todayRes, balRes] = await Promise.all([
        a.get('/referrals/', { status: 'all', limit: 200 }).catch(() => ({ data: [] })),
        a.get('/bonuses/balance').catch(() => ({ data: { balance: 0 } })),
      ])
      const today = new Date().toDateString()
      const todayRefs = (Array.isArray(todayRes.data) ? todayRes.data : []).filter(r =>
        new Date(r.created_at).toDateString() === today
      )
      setStats({
        today_count: todayRefs.length,
        balance: balRes.data?.balance || 0,
        confirmed_today: todayRefs.filter(r => r.status === 'confirmed').length,
      })
    } catch {}
  }

  async function loadReferrals() {
    setLoading(true)
    try {
      const res = await a.get('/referrals/', { limit: 100 })
      setReferrals(Array.isArray(res.data) ? res.data : [])
    } catch { setError('Ошибка загрузки направлений') }
    setLoading(false)
  }

  async function loadBonuses() {
    setLoading(true)
    try {
      const res = await a.get('/bonuses/')
      setBonuses(Array.isArray(res.data) ? res.data : [])
    } catch { setError('Ошибка загрузки бонусов') }
    setLoading(false)
  }

  async function loadClinics() {
    try {
      const res = await a.get('/clinics/')
      setClinics(Array.isArray(res.data) ? res.data : [])
    } catch {}
  }

  async function loadServices() {
    try {
      const res = await a.get('/services/')
      setServices(Array.isArray(res.data) ? res.data : [])
    } catch {}
  }

  async function createReferral(e) {
    e.preventDefault()
    if (!form.to_clinic_id || !form.service_id || !form.patient_phone) return
    setLoading(true); setError('')
    try {
      const res = await a.post('/referrals/', {
        to_clinic_id: form.to_clinic_id,
        service_id: form.service_id,
        patient_phone: form.patient_phone,
        patient_name: form.patient_name,
        notes: form.notes,
      })
      setCreatedRef(res.data)
      setForm({ to_clinic_id: '', service_id: '', patient_phone: '', patient_name: '', notes: '' })
    } catch (err) {
      setError(err?.response?.data?.detail || 'Ошибка создания направления')
    }
    setLoading(false)
  }

  const statusBadge = (s) => {
    const map = { confirmed: ['bg-green-100 text-green-700', 'Подтверждено'],
                  created: ['bg-blue-100 text-blue-700', 'Создано'],
                  expired: ['bg-gray-100 text-gray-500', 'Истекло'] }
    const [cls, label] = map[s] || ['bg-gray-100 text-gray-500', s]
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
  }

  const roleLabel = ROLE_LABELS[user.role] || user.role

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-base font-bold text-gray-800">{user.full_name || 'Кабинет'}</div>
            <div className="text-xs text-teal-600 font-medium">{roleLabel}</div>
          </div>
          <button onClick={onLogout} className="text-xs text-gray-400 hover:text-gray-600 transition">Выйти</button>
        </div>
        {/* Tabs */}
        <div className="max-w-2xl mx-auto px-4 flex gap-1 pb-0 overflow-x-auto no-scrollbar">
          {[
            ['dashboard', 'Главная'],
            ['create', 'Создать'],
            ['referrals', 'Направления'],
            ['bonuses', 'Бонусы'],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition ${
                tab === id ? 'border-teal-600 text-teal-700' : 'border-transparent text-gray-500 hover:text-gray-700'
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
            <h2 className="text-lg font-bold text-gray-800">Добро пожаловать</h2>
            {stats ? (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Сегодня', value: stats.today_count, icon: '📋', color: 'bg-blue-50 text-blue-700' },
                  { label: 'Подтв.', value: stats.confirmed_today, icon: '✅', color: 'bg-green-50 text-green-700' },
                  { label: 'Баланс', value: (stats.balance || 0).toLocaleString('ru') + ' ₽', icon: '💰', color: 'bg-amber-50 text-amber-700' },
                ].map(c => (
                  <div key={c.label} className={`rounded-xl p-4 text-center ${c.color.split(' ')[0]}`}>
                    <div className="text-2xl mb-1">{c.icon}</div>
                    <div className={`text-xl font-bold ${c.color.split(' ')[1]}`}>{c.value}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mt-2">
              <button onClick={() => setTab('create')}
                className="bg-teal-600 hover:bg-teal-700 text-white rounded-xl p-4 text-center font-semibold transition">
                <div className="text-2xl mb-1">➕</div>
                <div className="text-sm">Создать направление</div>
              </button>
              <button onClick={() => setTab('referrals')}
                className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl p-4 text-center font-semibold transition">
                <div className="text-2xl mb-1">📋</div>
                <div className="text-sm">Мои направления</div>
              </button>
            </div>
          </div>
        )}

        {/* ─── Create Referral ─── */}
        {tab === 'create' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-gray-800">Создать направление</h2>
            {createdRef ? (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
                <div className="text-4xl mb-3">✅</div>
                <div className="font-bold text-green-800 mb-1">Направление создано!</div>
                <div className="text-sm text-gray-600 mb-4">Код: <span className="font-bold text-2xl text-teal-700">{createdRef.short_code}</span></div>
                {createdRef.qr_code && (
                  <img src={'data:image/png;base64,' + createdRef.qr_code} alt="QR"
                    className="w-40 h-40 mx-auto rounded-xl border mb-3" />
                )}
                <button onClick={() => setCreatedRef(null)}
                  className="w-full mt-2 bg-teal-600 text-white rounded-xl py-2.5 font-semibold text-sm">
                  Создать ещё
                </button>
              </div>
            ) : (
              <form onSubmit={createReferral} className="space-y-3 bg-white rounded-2xl p-5 border border-gray-100">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Клиника назначения</label>
                  <select value={form.to_clinic_id} onChange={e => setForm(f => ({ ...f, to_clinic_id: e.target.value }))}
                    required className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="">Выбрать клинику...</option>
                    {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Услуга</label>
                  <select value={form.service_id} onChange={e => setForm(f => ({ ...f, service_id: e.target.value }))}
                    required className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="">Выбрать услугу...</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name} {s.bonus_amount > 0 ? `(+${s.bonus_amount} ₽)` : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Телефон пациента</label>
                  <input value={form.patient_phone} onChange={e => setForm(f => ({ ...f, patient_phone: e.target.value }))}
                    placeholder="+7..." required
                    className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ФИО пациента</label>
                  <input value={form.patient_name} onChange={e => setForm(f => ({ ...f, patient_name: e.target.value }))}
                    placeholder="Необязательно"
                    className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Примечание</label>
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    rows={2} placeholder="Необязательно"
                    className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-bold rounded-xl py-3 text-sm transition">
                  {loading ? 'Создаём...' : 'Создать направление'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* ─── Referrals ─── */}
        {tab === 'referrals' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-gray-800">Мои направления</h2>
            {loading ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
            ) : referrals.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <div className="text-5xl mb-3">📋</div>
                <p className="text-sm">Направлений ещё нет</p>
                <button onClick={() => setTab('create')} className="mt-3 text-teal-600 text-sm font-semibold">Создать первое →</button>
              </div>
            ) : (
              <div className="space-y-2">
                {referrals.map(r => (
                  <div key={r.id} className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="flex justify-between items-start mb-1">
                      <div className="font-semibold text-gray-800 text-sm">{r.patient_name || r.patient_phone}</div>
                      {statusBadge(r.status)}
                    </div>
                    <div className="text-xs text-gray-500">{r.service_name || 'Услуга'} → {r.to_clinic_name || 'Клиника'}</div>
                    <div className="flex justify-between items-center mt-1">
                      <div className="text-xs text-gray-400">{new Date(r.created_at).toLocaleDateString('ru')}</div>
                      {r.short_code && <div className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded">{r.short_code}</div>}
                    </div>
                  </div>
                ))}
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
              </div>
            ) : (
              <div className="space-y-2">
                {bonuses.map(b => (
                  <div key={b.id} className="bg-white rounded-xl border border-gray-100 p-4 flex justify-between items-center">
                    <div>
                      <div className="text-sm font-semibold text-gray-800">{Number(b.amount).toLocaleString('ru')} ₽</div>
                      <div className="text-xs text-gray-400">{new Date(b.created_at).toLocaleDateString('ru')}</div>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      b.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                    }`}>{b.status === 'paid' ? 'Выплачен' : 'Начислен'}</span>
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
