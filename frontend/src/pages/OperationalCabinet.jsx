import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

const BrandingSection = lazy(() => import('../sections/BrandingSection'))
const CMSPagesSection = lazy(() => import('../sections/CMSPagesSection'))
const ActsSection     = lazy(() => import('../sections/ActsSection'))

const api = (token) => ({
  get:  (url, params) => axios.get(API_BASE + url, { headers: { Authorization: `Bearer ${token}` }, params }),
  post: (url, data)   => axios.post(API_BASE + url, data, { headers: { Authorization: `Bearer ${token}` } }),
})

const ACCENT = '#0097A7'

const ROLE_LABELS = { admin:'Администратор', nurse:'Медсестра' }

const BOTTOM_KEYS = ['dashboard', 'create', 'referrals', 'visiting']

export default function OperationalCabinet({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('dashboard')
  const [stats, setStats] = useState(null)
  const [referrals, setReferrals] = useState([])
  const [bonuses, setBonuses] = useState([])
  const [clinics, setClinics] = useState([])
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)

  const [externalDoctors, setExternalDoctors] = useState([])
  const [doctorRequests, setDoctorRequests] = useState([])

  const [visitingDoctors, setVisitingDoctors] = useState([])
  const [visitingSettings, setVisitingSettings] = useState([])
  const [visitingApts, setVisitingApts] = useState([])
  const [visitingAptLoading, setVisitingAptLoading] = useState(false)
  const [bookVisitDoc, setBookVisitDoc] = useState(null)
  const [bookVisitForm, setBookVisitForm] = useState({ patient_name:'', patient_phone:'', appointment_date:'', start_time:'09:00', end_time:'09:30', price:'' })
  const [bookVisitSaving, setBookVisitSaving] = useState(false)
  const [bookVisitMsg, setBookVisitMsg] = useState('')
  const [bookVisitResult, setBookVisitResult] = useState(null)

  const [form, setForm] = useState({ to_clinic_id:'', service_id:'', patient_phone:'', patient_name:'', notes:'' })
  const [createdRef, setCreatedRef] = useState(null)

  const a = api(adminToken)

  useEffect(() => { loadStats(); loadClinics(); loadServices() }, [])
  useEffect(() => {
    if (tab === 'referrals') loadReferrals()
    if (tab === 'bonuses')   loadBonuses()
    if (tab === 'doctors')   loadDoctors()
    if (tab === 'visiting')  loadVisiting()
  }, [tab])

  async function loadDoctors() {
    try {
      const [docRes, reqRes] = await Promise.all([
        a.get('/admins/external-doctors').catch(() => ({ data:[] })),
        a.get('/admins/doctor-requests').catch(() => ({ data:[] })),
      ])
      setExternalDoctors(Array.isArray(docRes.data) ? docRes.data : [])
      setDoctorRequests(Array.isArray(reqRes.data) ? reqRes.data : [])
    } catch {}
  }

  async function loadVisiting() {
    setVisitingAptLoading(true)
    try {
      const [settRes, aptRes] = await Promise.all([
        a.get('/visiting/admin/settings').catch(() => ({ data:[] })),
        a.get('/visiting/admin/all-appointments').catch(() => ({ data:[] })),
      ])
      const settings = Array.isArray(settRes.data) ? settRes.data : []
      setVisitingSettings(settings)
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
    } catch(e) { setBookVisitMsg('❌ ' + (e?.response?.data?.detail || 'Ошибка')) }
    setBookVisitSaving(false)
  }

  async function loadStats() {
    try {
      const [todayRes, balRes] = await Promise.all([
        a.get('/referrals/', { status:'all', limit:200 }).catch(() => ({ data:[] })),
        a.get('/bonuses/balance').catch(() => ({ data:{ balance:0 } })),
      ])
      const today = new Date().toDateString()
      const todayRefs = (Array.isArray(todayRes.data) ? todayRes.data : []).filter(r => new Date(r.created_at).toDateString() === today)
      setStats({ today_count:todayRefs.length, balance:balRes.data?.balance || 0, confirmed_today:todayRefs.filter(r => r.status === 'confirmed').length })
    } catch {}
  }

  async function loadReferrals() {
    setLoading(true)
    try {
      const res = await a.get('/referrals/', { limit:100 })
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
    try { const res = await a.get('/clinics/'); setClinics(Array.isArray(res.data) ? res.data : []) } catch {}
  }

  async function loadServices() {
    try { const res = await a.get('/services/'); setServices(Array.isArray(res.data) ? res.data : []) } catch {}
  }

  async function createReferral(e) {
    e.preventDefault()
    if (!form.to_clinic_id || !form.service_id || !form.patient_phone) return
    setLoading(true); setError('')
    try {
      const res = await a.post('/referrals/', { to_clinic_id:form.to_clinic_id, service_id:form.service_id, patient_phone:form.patient_phone, patient_name:form.patient_name, notes:form.notes })
      setCreatedRef(res.data)
      setForm({ to_clinic_id:'', service_id:'', patient_phone:'', patient_name:'', notes:'' })
    } catch(err) { setError(err?.response?.data?.detail || 'Ошибка создания направления') }
    setLoading(false)
  }

  const statusBadge = (s) => {
    const map = { confirmed:['bg-green-100 text-green-700','Подтверждено'], created:['bg-blue-100 text-blue-700','Создано'], expired:['bg-gray-100 text-gray-500','Истекло'] }
    const [cls, label] = map[s] || ['bg-gray-100 text-gray-500', s]
    return <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${cls}`}>{label}</span>
  }

  const roleLabel = ROLE_LABELS[user.role] || user.role
  const isAdmin = user?.role === 'admin'

  const moreItems = [
    { key:'bonuses',  label:'Бонусы',   icon:'star'     },
    { key:'doctors',  label:'Врачи',    icon:'people'   },
    ...(isAdmin ? [
      { key:'branding', label:'Брендинг',icon:'palette' },
      { key:'cms',      label:'CMS',      icon:'article' },
      { key:'acts',     label:'Акты',     icon:'receipt' },
    ] : []),
  ]

  const fmtDate = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—'

  return (
    <div className="min-h-screen bg-[#f7f9fb]">

      {/* Gradient Header */}
      <div className="relative overflow-hidden px-4 pt-12 pb-5"
        style={{ background:'linear-gradient(135deg,#0097A7 0%,#004D5F 100%)' }}>
        <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background:'rgba(255,255,255,0.18)', backdropFilter:'blur(10px)' }}>
            <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>
              {user.role === 'nurse' ? 'medical_services' : 'admin_panel_settings'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate">{user.full_name || 'Кабинет'}</p>
            <p className="text-white/70 text-xs">{roleLabel}</p>
          </div>
          <button onClick={onLogout} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.12)' }}>
            <span className="material-symbols-outlined text-white/80 text-base">logout</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-4 pb-28">
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl px-4 py-3 text-sm flex justify-between">
            {error}<button onClick={() => setError('')} className="ml-2 text-red-400">✕</button>
          </div>
        )}

        {/* Dashboard */}
        {tab === 'dashboard' && (
          <div className="space-y-4">
            {stats ? (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label:'Сегодня',  value:stats.today_count,     icon:'📋', bg:'bg-blue-50',   text:'text-blue-700'  },
                  { label:'Подтв.',   value:stats.confirmed_today, icon:'✅', bg:'bg-green-50',  text:'text-green-700' },
                  { label:'Баланс',   value:(stats.balance||0).toLocaleString('ru')+'₽', icon:'💰', bg:'bg-amber-50', text:'text-amber-700' },
                ].map(c => (
                  <div key={c.label} className={`${c.bg} rounded-2xl p-3 text-center`}>
                    <div className="text-2xl mb-1">{c.icon}</div>
                    <div className={`text-lg font-bold ${c.text}`}>{c.value}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setTab('create')}
                className="bg-white rounded-2xl p-4 text-center active:scale-95 transition-transform" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <div className="w-12 h-12 rounded-2xl mx-auto mb-2 flex items-center justify-center" style={{ background:'linear-gradient(135deg,#0097A7,#004D5F)' }}>
                  <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>add_circle</span>
                </div>
                <p className="text-sm font-semibold text-gray-700">Создать направление</p>
              </button>
              <button onClick={() => setTab('referrals')}
                className="bg-white rounded-2xl p-4 text-center active:scale-95 transition-transform" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <div className="w-12 h-12 rounded-2xl mx-auto mb-2 flex items-center justify-center" style={{ background:'linear-gradient(135deg,#4f46e5,#4338ca)' }}>
                  <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>list_alt</span>
                </div>
                <p className="text-sm font-semibold text-gray-700">Мои направления</p>
              </button>
            </div>
          </div>
        )}

        {/* Create Referral */}
        {tab === 'create' && (
          <div className="space-y-4">
            {createdRef ? (
              <div className="bg-white rounded-2xl p-6 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <div className="text-4xl mb-3">✅</div>
                <p className="font-bold text-gray-800 mb-2">Направление создано!</p>
                <div className="bg-teal-50 rounded-2xl p-4 mb-4">
                  <p className="text-xs text-teal-600 font-bold uppercase tracking-wider mb-1">Код направления</p>
                  <p className="text-4xl font-black text-teal-700" style={{ letterSpacing:6 }}>{createdRef.short_code}</p>
                </div>
                {createdRef.qr_code && (
                  <img src={'data:image/png;base64,' + createdRef.qr_code} alt="QR"
                    className="w-40 h-40 mx-auto rounded-2xl border border-gray-100 mb-4" />
                )}
                <button onClick={() => setCreatedRef(null)}
                  className="w-full py-3 rounded-2xl text-white font-bold text-sm" style={{ background:'linear-gradient(135deg,#0097A7,#004D5F)' }}>
                  Создать ещё
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-2xl p-5" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <h2 className="font-bold text-gray-800 text-base mb-4">Новое направление</h2>
                <form onSubmit={createReferral} className="space-y-3">
                  {[
                    { label:'Клиника назначения', field:'to_clinic_id', isSelect:true, options:clinics, optLabel:c=>c.name, required:true },
                    { label:'Услуга', field:'service_id', isSelect:true, options:services, optLabel:s=>`${s.name}${s.bonus_amount>0?` (+${s.bonus_amount} ₽)`:''}`, required:true },
                  ].map(f => (
                    <div key={f.field}>
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">{f.label}</label>
                      <select value={form[f.field]} onChange={e => setForm(p => ({ ...p, [f.field]:e.target.value }))}
                        required={f.required}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 transition bg-white">
                        <option value="">Выбрать...</option>
                        {f.options.map(o => <option key={o.id} value={o.id}>{f.optLabel(o)}</option>)}
                      </select>
                    </div>
                  ))}
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Телефон пациента *</label>
                    <input value={form.patient_phone} onChange={e => setForm(p => ({ ...p, patient_phone:e.target.value }))}
                      placeholder="+7..." required
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 transition" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">ФИО пациента</label>
                    <input value={form.patient_name} onChange={e => setForm(p => ({ ...p, patient_name:e.target.value }))}
                      placeholder="Необязательно"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 transition" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Примечание</label>
                    <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes:e.target.value }))}
                      rows={2} placeholder="Необязательно"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 transition resize-none" />
                  </div>
                  <button type="submit" disabled={loading}
                    className="w-full py-3 rounded-2xl text-white font-bold text-sm disabled:opacity-50 transition active:scale-95"
                    style={{ background:'linear-gradient(135deg,#0097A7,#004D5F)' }}>
                    {loading ? 'Создаём...' : 'Создать направление'}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {/* Referrals */}
        {tab === 'referrals' && (
          <div className="space-y-3">
            {loading ? (
              <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
            ) : referrals.length === 0 ? (
              <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <div className="text-5xl mb-3">📋</div>
                <p className="font-semibold text-gray-600 mb-1">Направлений ещё нет</p>
                <button onClick={() => setTab('create')} className="mt-2 text-teal-600 text-sm font-bold">Создать первое →</button>
              </div>
            ) : (
              referrals.map(r => (
                <div key={r.id} className="bg-white rounded-2xl p-4" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                  <div className="flex justify-between items-start mb-1">
                    <div className="font-semibold text-gray-800 text-sm">{r.patient_name || r.patient_phone}</div>
                    {statusBadge(r.status)}
                  </div>
                  <div className="text-xs text-gray-500">{r.service_name} → {r.to_clinic_name}</div>
                  <div className="flex justify-between items-center mt-1">
                    <div className="text-xs text-gray-400">{fmtDate(r.created_at)}</div>
                    {r.short_code && <div className="text-xs font-mono bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{r.short_code}</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Visiting Doctors */}
        {tab === 'visiting' && (
          <div className="space-y-4">
            {/* Booking modal */}
            {bookVisitDoc && (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
                <div className="bg-white w-full rounded-t-3xl p-5 max-h-[90vh] overflow-y-auto" style={{ paddingBottom:'calc(1.5rem + env(safe-area-inset-bottom))' }}>
                  <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
                  <div className="flex justify-between items-center mb-4">
                    <p className="font-bold text-gray-800">Запись: {bookVisitDoc.doctor_name}</p>
                    <button onClick={() => { setBookVisitDoc(null); setBookVisitResult(null) }} className="text-gray-400 text-xl">✕</button>
                  </div>
                  {bookVisitResult ? (
                    <div className="space-y-3 text-center">
                      {bookVisitResult.patient_qr && (
                        <img src={'data:image/png;base64,' + bookVisitResult.patient_qr} alt="QR пациента"
                          className="w-40 h-40 mx-auto rounded-2xl border border-gray-100 cursor-pointer"
                          onClick={() => window.open(bookVisitResult.patient_url, '_blank')} />
                      )}
                      {bookVisitResult.short_code && (
                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                          <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-2">Код для пациента</p>
                          <p className="text-4xl font-black text-amber-600" style={{ letterSpacing:6 }}>{bookVisitResult.short_code}</p>
                        </div>
                      )}
                      {bookVisitResult.patient_url && (
                        <a href={bookVisitResult.patient_url} target="_blank" rel="noreferrer"
                          className="block text-xs text-teal-600 underline">Открыть кабинет пациента →</a>
                      )}
                      <button onClick={() => { setBookVisitDoc(null); setBookVisitResult(null) }}
                        className="w-full py-3 rounded-2xl text-white font-bold" style={{ background:'linear-gradient(135deg,#0097A7,#004D5F)' }}>
                        Закрыть
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={saveBookVisit} className="space-y-3">
                      {[
                        { key:'patient_name',  label:'ФИО пациента',    placeholder:'Иванов...' },
                        { key:'patient_phone', label:'Телефон',          placeholder:'+7...',   required:true },
                        { key:'appointment_date', label:'Дата',         type:'date',            required:true },
                      ].map(f => (
                        <div key={f.key}>
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">{f.label}{f.required&&' *'}</label>
                          <input type={f.type||'text'} value={bookVisitForm[f.key]}
                            onChange={e => setBookVisitForm(p => ({ ...p, [f.key]:e.target.value }))}
                            placeholder={f.placeholder} required={f.required}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 transition" />
                        </div>
                      ))}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Начало</label>
                          <input type="time" value={bookVisitForm.start_time}
                            onChange={e => setBookVisitForm(p => ({ ...p, start_time:e.target.value }))}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 transition" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Конец</label>
                          <input type="time" value={bookVisitForm.end_time}
                            onChange={e => setBookVisitForm(p => ({ ...p, end_time:e.target.value }))}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 transition" />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Цена ₽</label>
                        <input type="number" value={bookVisitForm.price}
                          onChange={e => setBookVisitForm(p => ({ ...p, price:e.target.value }))}
                          placeholder="0"
                          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 transition" />
                      </div>
                      {bookVisitMsg && <p className="text-sm">{bookVisitMsg}</p>}
                      <button type="submit" disabled={bookVisitSaving}
                        className="w-full py-3 rounded-2xl text-white font-bold disabled:opacity-50" style={{ background:'linear-gradient(135deg,#0097A7,#004D5F)' }}>
                        {bookVisitSaving ? 'Сохраняем...' : 'Создать запись'}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            )}

            {visitingAptLoading ? (
              <div className="flex justify-center py-10">
                <div className="w-8 h-8 border-3 border-teal-500 border-t-transparent rounded-full animate-spin" style={{ borderWidth:3 }} />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Врачи */}
                <div className="space-y-3">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Приезжие врачи</p>
                  {visitingDoctors.length === 0 ? (
                    <div className="bg-white rounded-2xl p-6 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                      <p className="text-gray-400 text-sm">Нет приезжих врачей</p>
                    </div>
                  ) : visitingDoctors.map(doc => (
                    <div key={doc.doctor_id} className="bg-white rounded-2xl p-4 flex items-center gap-3" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#e0f7fa' }}>
                        <span className="material-symbols-outlined text-xl" style={{ color:ACCENT, fontVariationSettings:"'FILL' 1" }}>stethoscope</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-800 text-sm">{doc.doctor_name}</p>
                        {doc.clinic_name && <p className="text-xs text-gray-400">{doc.clinic_name}</p>}
                      </div>
                      <button onClick={() => { setBookVisitDoc(doc); setBookVisitForm({ patient_name:'', patient_phone:'', appointment_date:'', start_time:'09:00', end_time:'09:30', price:'' }); setBookVisitResult(null) }}
                        className="px-3 py-1.5 rounded-xl text-white text-xs font-bold" style={{ background:'linear-gradient(135deg,#0097A7,#004D5F)' }}>
                        Записать
                      </button>
                    </div>
                  ))}
                </div>

                {/* Appointments */}
                {visitingApts.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Записи</p>
                    <div className="space-y-2">
                      {visitingApts.slice(0, 10).map(apt => (
                        <div key={apt.id} className="bg-white rounded-2xl p-4 flex items-center gap-3" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                          <div className="bg-teal-50 rounded-xl px-3 py-2 text-center flex-shrink-0">
                            <p className="text-teal-700 font-black text-lg leading-none">{apt.start_time?.slice(0,5)}</p>
                            <p className="text-teal-500 text-xs font-semibold mt-0.5">{apt.appointment_date?.slice(5)}</p>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-800 text-sm">{apt.patient_name || apt.patient_phone}</p>
                            <p className="text-xs text-gray-400">{apt.doctor_name}</p>
                          </div>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${apt.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                            {apt.status === 'completed' ? 'Принят' : 'Ожидает'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bonuses */}
        {tab === 'bonuses' && (
          <div className="space-y-3">
            {loading ? <div className="flex justify-center py-10"><div className="w-8 h-8 border-3 border-teal-500 border-t-transparent rounded-full animate-spin" style={{ borderWidth:3 }} /></div>
            : bonuses.length === 0 ? (
              <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <span className="text-5xl block mb-3">💰</span>
                <p className="text-gray-400 text-sm">Нет начислений</p>
              </div>
            ) : bonuses.map(b => (
              <div key={b.id} className="bg-white rounded-2xl p-4 flex items-center gap-3" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#fff8e1' }}>
                  <span className="material-symbols-outlined text-xl text-amber-500" style={{ fontVariationSettings:"'FILL' 1" }}>star</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{b.amount} ₽</p>
                  <p className="text-xs text-gray-400">{fmtDate(b.created_at)}</p>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${b.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {b.status === 'paid' ? 'Выплачен' : 'Начислен'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Doctors */}
        {tab === 'doctors' && (
          <div className="space-y-3">
            {externalDoctors.length === 0 && doctorRequests.length === 0 ? (
              <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <span className="material-symbols-outlined text-5xl text-gray-300 block mb-3" style={{ fontVariationSettings:"'FILL' 1" }}>people</span>
                <p className="text-gray-400 text-sm">Нет внешних врачей</p>
              </div>
            ) : (
              <>
                {doctorRequests.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Запросы на одобрение</p>
                    {doctorRequests.map(r => (
                      <div key={r.id} className="bg-white rounded-2xl p-4 mb-2" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                        <p className="font-semibold text-gray-800 text-sm">{r.full_name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{r.role} · {fmtDate(r.created_at)}</p>
                        <span className="inline-flex mt-2 text-xs bg-amber-100 text-amber-700 px-2.5 py-0.5 rounded-full font-semibold">На рассмотрении</span>
                      </div>
                    ))}
                  </div>
                )}
                {externalDoctors.map(d => (
                  <div key={d.id} className="bg-white rounded-2xl p-4" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#e3f2fd' }}>
                        <span className="material-symbols-outlined text-xl text-blue-600" style={{ fontVariationSettings:"'FILL' 1" }}>person</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-800 text-sm">{d.full_name}</p>
                        <p className="text-xs text-gray-400">{d.specialization || d.role}</p>
                      </div>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${d.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {d.is_active ? 'Активен' : 'Неактивен'}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Admin-only sections */}
        {tab === 'branding' && isAdmin && (
          <Suspense fallback={<div className="flex justify-center py-10"><div className="w-8 h-8 border-3 border-teal-500 border-t-transparent rounded-full animate-spin" style={{ borderWidth:3 }} /></div>}>
            <BrandingSection token={adminToken} />
          </Suspense>
        )}
        {tab === 'cms' && isAdmin && (
          <Suspense fallback={<div className="flex justify-center py-10"><div className="w-8 h-8 border-3 border-teal-500 border-t-transparent rounded-full animate-spin" style={{ borderWidth:3 }} /></div>}>
            <CMSPagesSection token={adminToken} />
          </Suspense>
        )}
        {tab === 'acts' && isAdmin && (
          <Suspense fallback={<div className="flex justify-center py-10"><div className="w-8 h-8 border-3 border-teal-500 border-t-transparent rounded-full animate-spin" style={{ borderWidth:3 }} /></div>}>
            <ActsSection token={adminToken} />
          </Suspense>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-50"
        style={{ paddingBottom:'env(safe-area-inset-bottom)', background:'rgba(255,255,255,0.95)', backdropFilter:'blur(20px)', borderTop:'1px solid rgba(0,0,0,0.06)' }}>
        <div className="flex">
          {[
            { key:'dashboard', label:'Главная',   icon:'dashboard'  },
            { key:'create',    label:'Создать',   icon:'add_circle' },
            { key:'referrals', label:'Направления',icon:'list_alt'  },
            { key:'visiting',  label:'Приезжие',  icon:'people'     },
          ].map(item => (
            <button key={item.key} onClick={() => setTab(item.key)}
              className="flex-1 flex flex-col items-center pt-2 pb-1 gap-0.5 relative">
              {tab === item.key && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full" style={{ background:ACCENT }} />}
              <span className="material-symbols-outlined text-2xl" style={{ color:tab === item.key ? ACCENT : '#9ca3af', fontVariationSettings:tab === item.key ? "'FILL' 1" : "'FILL' 0" }}>{item.icon}</span>
              <span className="text-xs font-semibold" style={{ color:tab === item.key ? ACCENT : '#9ca3af' }}>{item.label}</span>
            </button>
          ))}
          <button onClick={() => setMoreOpen(true)}
            className="flex-1 flex flex-col items-center pt-2 pb-1 gap-0.5">
            {moreItems.some(m => m.key === tab) && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full" style={{ background:ACCENT }} />}
            <span className="material-symbols-outlined text-2xl" style={{ color: moreItems.some(m => m.key === tab) ? ACCENT : '#9ca3af' }}>more_horiz</span>
            <span className="text-xs font-semibold" style={{ color: moreItems.some(m => m.key === tab) ? ACCENT : '#9ca3af' }}>Ещё</span>
          </button>
        </div>
      </div>

      {/* Ещё Drawer */}
      {moreOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setMoreOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl" style={{ paddingBottom:'env(safe-area-inset-bottom)' }}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mt-3 mb-5" />
            <div className="grid grid-cols-3 gap-3 px-4 pb-6">
              {moreItems.map(item => (
                <button key={item.key} onClick={() => { setTab(item.key); setMoreOpen(false) }}
                  className={`flex flex-col items-center gap-2 p-3 rounded-2xl active:scale-95 transition-transform ${tab === item.key ? 'bg-teal-50' : 'bg-gray-50'}`}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#0097A7,#004D5F)' }}>
                    <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>{item.icon}</span>
                  </div>
                  <span className="text-xs font-semibold text-gray-700 text-center leading-tight">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
