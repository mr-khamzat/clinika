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

  const [externalDoctors, setExternalDoctors] = useState([])
  const [doctorRequests, setDoctorRequests] = useState([])

  // Записи к приезжим врачам
  const [visitingDoctors, setVisitingDoctors] = useState([])
  const [visitingSettings, setVisitingSettings] = useState([])
  const [visitingApts, setVisitingApts] = useState([])
  const [visitingAptLoading, setVisitingAptLoading] = useState(false)
  const [bookVisitDoc, setBookVisitDoc] = useState(null)
  const [bookVisitForm, setBookVisitForm] = useState({ patient_name:'', patient_phone:'', appointment_date:'', start_time:'09:00', end_time:'09:30', price:'' })
  const [bookVisitSaving, setBookVisitSaving] = useState(false)
  const [bookVisitMsg, setBookVisitMsg] = useState('')
  const [bookVisitResult, setBookVisitResult] = useState(null)

  // Форма создания направления
  const [form, setForm] = useState({ to_clinic_id: '', service_id: '', patient_phone: '', patient_name: '', notes: '' })
  const [createdRef, setCreatedRef] = useState(null)

  const a = api(adminToken)

  useEffect(() => { loadStats(); loadClinics(); loadServices() }, [])
  useEffect(() => {
    if (tab === 'referrals') loadReferrals()
    if (tab === 'bonuses') loadBonuses()
    if (tab === 'doctors') loadDoctors()
    if (tab === 'visiting') loadVisiting()
  }, [tab])

  async function loadDoctors() {
    try {
      const [docRes, reqRes] = await Promise.all([
        a.get('/admins/external-doctors').catch(() => ({ data: [] })),
        a.get('/admins/doctor-requests').catch(() => ({ data: [] })),
      ])
      setExternalDoctors(Array.isArray(docRes.data) ? docRes.data : [])
      setDoctorRequests(Array.isArray(reqRes.data) ? reqRes.data : [])
    } catch {}
  }

  async function loadVisiting() {
    setVisitingAptLoading(true)
    try {
      const [settRes, aptRes] = await Promise.all([
        a.get('/visiting/admin/settings').catch(() => ({ data: [] })),
        a.get('/visiting/admin/all-appointments').catch(() => ({ data: [] })),
      ])
      const settings = Array.isArray(settRes.data) ? settRes.data : []
      setVisitingSettings(settings)
      const docIds = [...new Set(settings.map(s => s.doctor_id))]
      // Загрузить данные о врачах из settings (doctor_name есть в settings)
      setVisitingDoctors(settings.filter((s, i, arr) => arr.findIndex(x => x.doctor_id === s.doctor_id) === i))
      setVisitingApts(Array.isArray(aptRes.data) ? aptRes.data : [])
    } catch {}
    setVisitingAptLoading(false)
  }

  async function saveBookVisit(e) {
    e.preventDefault(); setBookVisitSaving(true); setBookVisitMsg('')
    try {
      const r = await a.post('/visiting/admin/book-appointment', {
        doctor_user_id: bookVisitDoc.doctor_id,
        patient_name: bookVisitForm.patient_name,
        patient_phone: bookVisitForm.patient_phone,
        appointment_date: bookVisitForm.appointment_date,
        start_time: bookVisitForm.start_time,
        end_time: bookVisitForm.end_time,
        price: bookVisitForm.price ? parseFloat(bookVisitForm.price) : null,
      })
      setBookVisitResult(r.data)
      setBookVisitMsg('✅ Запись создана')
      loadVisiting()
    } catch (e) { setBookVisitMsg('❌ ' + (e?.response?.data?.detail || 'Ошибка')) }
    setBookVisitSaving(false)
  }

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
    const map = {
      confirmed: ['bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400', 'Подтверждено'],
      created:   ['bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400', 'Создано'],
      expired:   ['bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400', 'Истекло'],
    }
    const [cls, label] = map[s] || ['bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400', s]
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
  }

  const roleLabel = ROLE_LABELS[user.role] || user.role

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 sticky top-0 z-30">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-base font-bold text-gray-800 dark:text-white">{user.full_name || 'Кабинет'}</div>
            <div className="text-xs text-teal-600 dark:text-teal-400 font-medium">{roleLabel}</div>
          </div>
          <button onClick={onLogout} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition">Выйти</button>
        </div>
        {/* Tabs */}
        <div className="max-w-2xl mx-auto px-4 flex gap-1 pb-0 overflow-x-auto no-scrollbar">
          {[
            ['dashboard', 'Главная'],
            ['create', 'Создать'],
            ['referrals', 'Направления'],
            ['visiting', 'Приезжие врачи'],
            ['bonuses', 'Бонусы'],
            ['doctors', 'Врачи'],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition ${
                tab === id
                  ? 'border-teal-600 text-teal-700 dark:text-teal-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-5">
        {error && (
          <div className="mb-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-xl px-4 py-3 text-sm flex justify-between">
            {error}
            <button onClick={() => setError('')} className="ml-2 text-red-400">✕</button>
          </div>
        )}

        {/* ─── Dashboard ─── */}
        {tab === 'dashboard' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">Добро пожаловать</h2>
            {stats ? (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Сегодня', value: stats.today_count, icon: '📋', bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300' },
                  { label: 'Подтв.', value: stats.confirmed_today, icon: '✅', bg: 'bg-green-50 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300' },
                  { label: 'Баланс', value: (stats.balance || 0).toLocaleString('ru') + ' ₽', icon: '💰', bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300' },
                ].map(c => (
                  <div key={c.label} className={`rounded-xl p-4 text-center ${c.bg}`}>
                    <div className="text-2xl mb-1">{c.icon}</div>
                    <div className={`text-xl font-bold ${c.text}`}>{c.value}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{c.label}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 dark:bg-gray-700 rounded-xl animate-pulse" />)}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mt-2">
              <button onClick={() => setTab('create')}
                className="bg-teal-600 hover:bg-teal-700 text-white rounded-xl p-4 text-center font-semibold transition">
                <div className="text-2xl mb-1">➕</div>
                <div className="text-sm">Создать направление</div>
              </button>
              <button onClick={() => setTab('referrals')}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl p-4 text-center font-semibold transition">
                <div className="text-2xl mb-1">📋</div>
                <div className="text-sm">Мои направления</div>
              </button>
            </div>
          </div>
        )}

        {/* ─── Create Referral ─── */}
        {tab === 'create' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">Создать направление</h2>
            {createdRef ? (
              <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-2xl p-5 text-center">
                <div className="text-4xl mb-3">✅</div>
                <div className="font-bold text-green-800 dark:text-green-300 mb-1">Направление создано!</div>
                <div className="text-sm text-gray-600 dark:text-gray-300 mb-4">Код: <span className="font-bold text-2xl text-teal-700 dark:text-teal-400">{createdRef.short_code}</span></div>
                {createdRef.qr_code && (
                  <img src={'data:image/png;base64,' + createdRef.qr_code} alt="QR"
                    className="w-40 h-40 mx-auto rounded-xl border dark:border-gray-700 mb-3" />
                )}
                <button onClick={() => setCreatedRef(null)}
                  className="w-full mt-2 bg-teal-600 text-white rounded-xl py-2.5 font-semibold text-sm">
                  Создать ещё
                </button>
              </div>
            ) : (
              <form onSubmit={createReferral} className="space-y-3 bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-100 dark:border-gray-700">
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Клиника назначения</label>
                  <select value={form.to_clinic_id} onChange={e => setForm(f => ({ ...f, to_clinic_id: e.target.value }))}
                    required className="mt-1 w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="">Выбрать клинику...</option>
                    {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Услуга</label>
                  <select value={form.service_id} onChange={e => setForm(f => ({ ...f, service_id: e.target.value }))}
                    required className="mt-1 w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="">Выбрать услугу...</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name} {s.bonus_amount > 0 ? `(+${s.bonus_amount} ₽)` : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Телефон пациента</label>
                  <input value={form.patient_phone} onChange={e => setForm(f => ({ ...f, patient_phone: e.target.value }))}
                    placeholder="+7..." required
                    className="mt-1 w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">ФИО пациента</label>
                  <input value={form.patient_name} onChange={e => setForm(f => ({ ...f, patient_name: e.target.value }))}
                    placeholder="Необязательно"
                    className="mt-1 w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Примечание</label>
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    rows={2} placeholder="Необязательно"
                    className="mt-1 w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
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
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">Мои направления</h2>
            {loading ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 dark:bg-gray-700 rounded-xl animate-pulse" />)}</div>
            ) : referrals.length === 0 ? (
              <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                <div className="text-5xl mb-3">📋</div>
                <p className="text-sm">Направлений ещё нет</p>
                <button onClick={() => setTab('create')} className="mt-3 text-teal-600 dark:text-teal-400 text-sm font-semibold">Создать первое →</button>
              </div>
            ) : (
              <div className="space-y-2">
                {referrals.map(r => (
                  <div key={r.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
                    <div className="flex justify-between items-start mb-1">
                      <div className="font-semibold text-gray-800 dark:text-white text-sm">{r.patient_name || r.patient_phone}</div>
                      {statusBadge(r.status)}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{r.service_name || 'Услуга'} → {r.to_clinic_name || 'Клиника'}</div>
                    <div className="flex justify-between items-center mt-1">
                      <div className="text-xs text-gray-400 dark:text-gray-500">{new Date(r.created_at).toLocaleDateString('ru')}</div>
                      {r.short_code && <div className="text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded">{r.short_code}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Bonuses ─── */}
        {tab === 'visiting' && (
          <div className="space-y-4">
            {/* Модал записи */}
            {bookVisitDoc && (
              <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
                <div style={{ background:'#fff', borderRadius:20, padding:24, maxWidth:400, width:'100%', maxHeight:'90vh', overflowY:'auto' }}>
                  <div className="flex justify-between items-center mb-4">
                    <div className="font-bold text-gray-800">Запись к врачу: {bookVisitDoc.doctor_name}</div>
                    <button onClick={() => { setBookVisitDoc(null); setBookVisitResult(null) }} className="text-gray-400 text-xl">✕</button>
                  </div>
                  {bookVisitResult ? (
                    <div className="space-y-3">
                      {bookVisitResult.patient_qr && (
                        <div className="text-center">
                          <img src={'data:image/png;base64,' + bookVisitResult.patient_qr} alt="QR пациента"
                            className="w-40 h-40 mx-auto rounded-xl cursor-pointer border border-gray-200"
                            onClick={() => window.open(bookVisitResult.patient_url, '_blank')} />
                          <p className="text-xs text-gray-400 mt-1">QR для пациента (кабинет)</p>
                        </div>
                      )}
                      {bookVisitResult.short_code && (
                        <div className="text-center rounded-xl p-3" style={{ background:'#fff8e1', border:'1px solid #ffe082' }}>
                          <p className="text-xs font-semibold uppercase text-orange-600 mb-1">Код для пациента</p>
                          <p className="text-4xl font-black text-orange-600" style={{ letterSpacing:6 }}>{bookVisitResult.short_code}</p>
                        </div>
                      )}
                      {bookVisitResult.patient_url && (
                        <a href={bookVisitResult.patient_url} target="_blank" rel="noreferrer"
                          className="block text-center text-xs text-teal-600 underline">Открыть кабинет пациента →</a>
                      )}
                      <button onClick={() => { setBookVisitDoc(null); setBookVisitResult(null) }}
                        className="w-full py-2 rounded-xl font-semibold text-sm" style={{ background:'#0097A7', color:'#fff', border:'none' }}>
                        Закрыть
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={saveBookVisit} className="space-y-3">
                      {[
                        { label:'ФИО пациента *', key:'patient_name', type:'text' },
                        { label:'Телефон пациента *', key:'patient_phone', type:'tel' },
                        { label:'Дата приёма *', key:'appointment_date', type:'date' },
                      ].map(f => (
                        <div key={f.key}>
                          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">{f.label}</label>
                          <input type={f.type} required value={bookVisitForm[f.key] || ''} onChange={e => setBookVisitForm(p => ({ ...p, [f.key]: e.target.value }))}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" />
                        </div>
                      ))}
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label:'Начало', key:'start_time', type:'time' },
                          { label:'Конец', key:'end_time', type:'time' },
                        ].map(f => (
                          <div key={f.key}>
                            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">{f.label}</label>
                            <input type={f.type} required value={bookVisitForm[f.key] || ''} onChange={e => setBookVisitForm(p => ({ ...p, [f.key]: e.target.value }))}
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" />
                          </div>
                        ))}
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Стоимость ₽ (необязательно)</label>
                        <input type="number" value={bookVisitForm.price || ''} onChange={e => setBookVisitForm(p => ({ ...p, price: e.target.value }))}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" />
                      </div>
                      {bookVisitMsg && <p className="text-sm text-center font-semibold">{bookVisitMsg}</p>}
                      <div className="flex gap-2 pt-1">
                        <button type="button" onClick={() => setBookVisitDoc(null)}
                          className="flex-1 py-2 rounded-xl text-sm font-semibold text-gray-500" style={{ background:'#f0f5f6', border:'1px solid #e0eaec' }}>
                          Отмена
                        </button>
                        <button type="submit" disabled={bookVisitSaving}
                          className="flex-2 py-2 rounded-xl text-sm font-bold text-white" style={{ flex:2, background: bookVisitSaving ? '#b2dfdb' : '#0097A7', border:'none' }}>
                          {bookVisitSaving ? 'Запись...' : '+ Записать'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Приезжие врачи</p>
              {visitingAptLoading && <p className="text-gray-400 text-sm text-center py-4">Загрузка...</p>}
              {!visitingAptLoading && visitingDoctors.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">Нет приезжих врачей</p>
              )}
              {visitingDoctors.filter(d => d.is_active !== false && !d.is_suspended).map(d => (
                <div key={d.doctor_id} className="bg-white rounded-xl border border-gray-100 p-3 mb-2 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#e0f7fa' }}>
                    <span className="material-symbols-outlined text-teal-600" style={{ fontSize:20, fontVariationSettings:"'FILL' 1" }}>stethoscope</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{d.doctor_name}</p>
                    <p className="text-xs text-gray-400">{parseFloat(d.price_per_visit || 0).toLocaleString('ru')} ₽ · {d.doctor_percent}% врачу</p>
                  </div>
                  <button onClick={() => {
                    const today = new Date().toISOString().slice(0,10)
                    setBookVisitDoc(d)
                    setBookVisitForm({ patient_name:'', patient_phone:'', appointment_date:today, start_time:'09:00', end_time:'09:30', price: d.price_per_visit || '' })
                    setBookVisitMsg(''); setBookVisitResult(null)
                  }}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg text-white" style={{ background:'#0097A7', border:'none' }}>
                    + Записать
                  </button>
                </div>
              ))}
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Записи на сегодня</p>
              {visitingApts.filter(a => a.appointment_date === new Date().toISOString().slice(0,10)).length === 0 && (
                <p className="text-gray-400 text-sm text-center py-2">Нет записей на сегодня</p>
              )}
              {visitingApts.filter(a => a.appointment_date === new Date().toISOString().slice(0,10)).map(a => (
                <div key={a.id} className="bg-white rounded-xl border border-gray-100 p-3 mb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{a.patient_name}</p>
                      <p className="text-xs text-gray-400">{a.start_time?.slice(0,5)} — {a.end_time?.slice(0,5)} · {a.doctor_name}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{
                      background: String(a.status).includes('completed') ? '#e8f5e9' : '#e0f7fa',
                      color: String(a.status).includes('completed') ? '#2e7d32' : '#0097A7'
                    }}>
                      {String(a.status).includes('completed') ? '✓ Завершён' : '⏳ Ожидает'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'bonuses' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">Мои бонусы</h2>
            {loading ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-gray-700 rounded-xl animate-pulse" />)}</div>
            ) : bonuses.length === 0 ? (
              <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                <div className="text-5xl mb-3">💰</div>
                <p className="text-sm">Бонусов пока нет</p>
              </div>
            ) : (
              <div className="space-y-2">
                {bonuses.map(b => (
                  <div key={b.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 flex justify-between items-center">
                    <div>
                      <div className="text-sm font-semibold text-gray-800 dark:text-white">{Number(b.amount).toLocaleString('ru')} ₽</div>
                      <div className="text-xs text-gray-400 dark:text-gray-500">{new Date(b.created_at).toLocaleDateString('ru')}</div>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      b.status === 'paid' ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400'
                    }`}>{b.status === 'paid' ? 'Выплачен' : 'Начислен'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* ─── Внешние врачи ─── */}
        {tab === 'doctors' && (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Заявки на регистрацию</p>
              {doctorRequests.length === 0 && <p className="text-gray-400 text-sm py-4 text-center">Заявок нет</p>}
              {doctorRequests.map(r => {
                const stColor = {pending:'bg-yellow-100 text-yellow-700',approved:'bg-green-100 text-green-700',rejected:'bg-red-100 text-red-700'}
                const stLabel = {pending:'Ожидает',approved:'Одобрено',rejected:'Отклонено'}
                return (
                  <div key={r.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-3 mb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 dark:text-white">{r.doctor_name}</p>
                        <p className="text-xs text-gray-400">{r.phone} · {r.specialization || '—'}</p>
                        {r.manager_name && <p className="text-xs text-gray-400">Менеджер: {r.manager_name}</p>}
                      </div>
                      <div className="flex flex-col gap-1 flex-shrink-0 items-end">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${stColor[r.status] || 'bg-gray-100 text-gray-500'}`}>
                          {stLabel[r.status] || r.status}
                        </span>
                        {r.status === 'pending' && (
                          <div className="flex gap-1">
                            <button onClick={async () => { try { await a.post('/admins/doctor-requests/' + r.id + '/approve'); loadDoctors() } catch(e) { alert(e?.response?.data?.detail || 'Ошибка') } }}
                              className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-lg">✓</button>
                            <button onClick={async () => { try { await a.post('/admins/doctor-requests/' + r.id + '/reject'); loadDoctors() } catch(e) { alert(e?.response?.data?.detail || 'Ошибка') } }}
                              className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-lg">✗</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Зарегистрированные врачи</p>
              {externalDoctors.length === 0 && <p className="text-gray-400 text-sm py-4 text-center">Нет врачей</p>}
              {externalDoctors.map(d => (
                <div key={d.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-3 mb-2 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-teal-50 flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-teal-600 text-sm" style={{ fontVariationSettings:"'FILL' 1" }}>person</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{d.full_name}</p>
                    <p className="text-xs text-gray-400">{d.role === 'visiting_doctor' ? 'Выездной' : 'Внешний'} · {d.username}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${d.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {d.is_active ? 'Активен' : 'Неактивен'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
