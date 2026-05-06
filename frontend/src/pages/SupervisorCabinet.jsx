import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react'
const AdsSection = lazy(() => import('../sections/AdsSection'))
const AISection  = lazy(() => import('../sections/AISection'))
const BrandingSection = lazy(() => import('../sections/BrandingSection'))
const CMSPagesSection = lazy(() => import('../sections/CMSPagesSection'))
const ActsSection     = lazy(() => import('../sections/ActsSection'))
const ReviewsSection  = lazy(() => import('../sections/ReviewsSection'))
const InterClinicInvoicesSection = lazy(() => import('../sections/InterClinicInvoicesSection'))
const RequisitesSection = lazy(() => import('../sections/RequisitesSection'))
const DoctorsSection = lazy(() => import('../sections/DoctorsSection'))
const CallRulesSection = lazy(() => import('../sections/CallRulesSection'))
const AIKnowledgeSection = lazy(() => import('../sections/AIKnowledgeSection'))
const PlatformInvoicesSection = lazy(() => import('../sections/PlatformInvoicesSection'))
const AppointmentsCalendarSection = lazy(() => import('../sections/AppointmentsCalendarSection'))
const AppointmentsStatsSection = lazy(() => import('../sections/AppointmentsStatsSection'))
import WikiViewer from './WikiViewer'
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
    <div onClick={onClick} className={`bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm ${onClick ? 'cursor-pointer hover:shadow-md transition' : ''}`}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: bg }}>
        <span className="material-symbols-outlined text-xl" style={{ color, fontVariationSettings: "'FILL' 1" }}>{icon}</span>
      </div>
      <div className="text-2xl font-bold text-gray-800 dark:text-gray-100 leading-tight">{value}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</div>
    </div>
  )
}

// ── NAV ──────────────────────────────────────────────────────────────────────
const NAV = [
  { key: 'home',       label: 'Обзор',        icon: 'dashboard' },
  { key: 'staff',      label: 'Персонал',     icon: 'group' },
  { key: 'doctors',    label: 'Врачи',        icon: 'stethoscope' },
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
  { key: 'ads',          label: 'Реклама',      icon: 'campaign' },
  { key: 'ai_analytics', label: 'AI-анализ',    icon: 'auto_awesome' },
  { key: 'ext_doctors',  label: 'Внеш. врачи',  icon: 'person_add' },
  { key: 'recruiters',   label: 'Рекрутеры',    icon: 'manage_accounts' },
  { key: 'settings',   label: 'Настройки',    icon: 'settings' },
  { key: 'branding',   label: 'Брендинг',      icon: 'palette' },
  { key: 'cms',        label: 'CMS Страницы',  icon: 'web' },
  { key: 'acts',       label: 'Акты',          icon: 'receipt_long' },
  { key: 'reviews',    label: 'Отзывы',        icon: 'rate_review' },
  { key: 'clinic_invoices', label: 'Межкл. счета',  icon: 'receipt_long' },
  { key: 'requisites',    label: 'Реквизиты',     icon: 'corporate_fare' },
  { key: 'calls',         label: 'Звонки',        icon: 'call' },
  { key: 'ai_knowledge',  label: 'База AI',       icon: 'library_books' },
  { key: 'platform_invoices', label: 'Платформа', icon: 'receipt_long' },
  { key: 'calendar',          label: 'Календарь', icon: 'event' },
  { key: 'apt_stats',         label: 'Статистика записей', icon: 'query_stats' },
]

// ── ExtDoctorsSection ────────────────────────────────────────────────────────
function ExtDoctorsSection({ token }) {
  const hdr = { headers: { Authorization: `Bearer ${token}` } }
  const P = '#0097A7', D = '#004D5F'

  const [doctors,  setDoctors]  = useState([])
  const [clinics,  setClinics]  = useState([])
  const [settings, setSettings] = useState([])
  const [showAdd,  setShowAdd]  = useState(false)
  const [qrData,   setQrData]   = useState(null)
  const [toggling, setToggling] = useState(null)
  const [suspending, setSuspending] = useState(null)
  const [search,   setSearch]   = useState('')
  const [saving,   setSaving]   = useState(false)
  const [msg,      setMsg]      = useState('')
  const [deleteDocId, setDeleteDocId] = useState(null)
  const [deletingDoc,  setDeletingDoc]  = useState(false)

  const [mainTab, setMainTab] = useState("doctors")
  const [allApts, setAllApts] = useState([])
  const [aptsLoading, setAptsLoading] = useState(false)
  const [aptsStatus, setAptsStatus] = useState("")
  const [aptsDateFrom, setAptsDateFrom] = useState("")
  const [aptsDateTo, setAptsDateTo] = useState("")
  const [editApt, setEditApt] = useState(null)
  const [editAptForm, setEditAptForm] = useState({})
  const [editAptSaving, setEditAptSaving] = useState(false)
  const [editAptMsg, setEditAptMsg] = useState("")
  const [deleteAptId, setDeleteAptId] = useState(null)
  const [deleteAptSaving, setDeleteAptSaving] = useState(false)

  const loadAllApts = async () => {
    setAptsLoading(true)
    try {
      const params = new URLSearchParams()
      if (aptsDateFrom) params.set("date_from", aptsDateFrom)
      if (aptsDateTo)   params.set("date_to", aptsDateTo)
      const statusVal = typeof aptsStatus === 'object' ? (aptsStatus.status || '') : aptsStatus
      if (statusVal) params.set("status", statusVal)
      const r = await axios.get(API_BASE + "/visiting/admin/all-appointments?" + params, hdr)
      setAllApts(Array.isArray(r.data) ? r.data : [])
    } catch {}
    setAptsLoading(false)
  }

  useEffect(() => {
    if (mainTab !== "appointments") return
    loadAllApts()
    const timer = setInterval(loadAllApts, 30000)
    return () => clearInterval(timer)
  }, [mainTab])

  const openEditApt = (apt) => {
    setEditApt(apt)
    setEditAptForm({
      patient_name: apt.patient_name || '',
      patient_phone: apt.patient_phone || '',
      appointment_date: apt.appointment_date || '',
      start_time: apt.start_time?.slice(0,5) || '',
      end_time: apt.end_time?.slice(0,5) || '',
      price: apt.price || '',
      status: String(apt.status).includes('completed') ? 'completed'
            : String(apt.status).includes('no_show') ? 'no_show'
            : String(apt.status).includes('cancelled') ? 'cancelled' : 'pending',
      notes: apt.notes || '',
      payment_method: apt.payment_method || '',
    })
    setEditAptMsg('')
  }

  const saveEditApt = async (e) => {
    e.preventDefault()
    setEditAptSaving(true); setEditAptMsg('')
    try {
      await axios.patch(API_BASE + `/visiting/admin/appointments/${editApt.id}/edit`, {
        ...editAptForm,
        price: editAptForm.price ? parseFloat(editAptForm.price) : null,
      }, hdr)
      setEditAptMsg('✅ Сохранено')
      await loadAllApts()
      setTimeout(() => setEditApt(null), 800)
    } catch (e) { setEditAptMsg('❌ ' + (e?.response?.data?.detail || 'Ошибка')) }
    setEditAptSaving(false)
  }

  const confirmDeleteApt = async () => {
    if (!deleteAptId) return
    setDeleteAptSaving(true)
    try {
      await axios.delete(API_BASE + `/visiting/admin/appointments/${deleteAptId}`, hdr)
      setDeleteAptId(null)
      await loadAllApts()
    } catch (e) { alert('Ошибка: ' + (e?.response?.data?.detail || e.message)) }
    setDeleteAptSaving(false)
  }

  const [form, setForm] = useState({ full_name:'', phone_number:'', email:'', specialization:'', address:'', username:'', password:'', clinic_ids:[], price_per_visit:'', doctor_percent:'70' })
  const [editDoc,  setEditDoc]  = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [bookDoc,  setBookDoc]  = useState(null)
  const [bookForm, setBookForm] = useState({ patient_name:'', patient_phone:'', appointment_date:'', start_time:'09:00', end_time:'09:30', price:'' })
  const [bookSaving, setBookSaving] = useState(false)
  const [bookMsg,    setBookMsg]    = useState('')
  const [bookResult, setBookResult] = useState(null)
  const [reportDoc,  setReportDoc]  = useState(null)
  const [reportData, setReportData] = useState(null)
  const [reportFrom, setReportFrom] = useState('')
  const [reportTo,   setReportTo]   = useState('')
  const [reportLoading, setReportLoading] = useState(false)

  const load = () => {
    axios.get(API_BASE + '/manager/all-external-doctors', hdr).then(r => setDoctors(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    axios.get(API_BASE + '/manager/clinics/', hdr).then(r => setClinics(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    axios.get(API_BASE + '/visiting/admin/settings', hdr).then(r => setSettings(Array.isArray(r.data) ? r.data : [])).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const toggleCl = id => set('clinic_ids', form.clinic_ids.includes(id) ? form.clinic_ids.filter(x => x !== id) : [...form.clinic_ids, id])

  const registerDoctor = async (e) => {
    e.preventDefault(); setSaving(true); setMsg('')
    try {
      const r = await axios.post(API_BASE + '/manager/register-external-doctor', { ...form, doctor_type: 'visiting', price_per_visit: form.price_per_visit ? parseFloat(form.price_per_visit) : null, doctor_percent: parseFloat(form.doctor_percent || 70) }, hdr)
      setQrData(r.data); setShowAdd(false)
      setForm({ full_name:'', phone_number:'', email:'', specialization:'', address:'', username:'', password:'', clinic_ids:[], price_per_visit:'', doctor_percent:'70' })
      load()
    } catch (e) { setMsg('❌ ' + (e?.response?.data?.detail || 'Ошибка')) }
    setSaving(false)
  }

  const toggleActive = async (doc) => {
    setToggling(doc.id)
    await axios.patch(API_BASE + `/manager/recruiter-doctors/${doc.id}/toggle-active`, {}, hdr).catch(() => {})
    load(); setToggling(null)
  }
  const deleteDoctor = async () => {
    setDeletingDoc(true)
    await axios.delete(API_BASE + `/manager/all-external-doctors/${deleteDocId}`, hdr).catch(() => {})
    setDeleteDocId(null); setDeletingDoc(false); load()
  }

  const toggleSuspend = async (doc) => {
    setSuspending(doc.id)
    const endpoint = doc.is_suspended ? 'resume-doctor' : 'suspend-doctor'
    await axios.patch(API_BASE + `/visiting/${endpoint}/${doc.id}`, {}, hdr).catch(() => {})
    load(); setSuspending(null)
  }

  const openEdit = (doc) => {
    const s = settings.find(x => x.doctor_id === doc.id)
    setEditDoc(doc)
    setEditForm({ full_name: doc.full_name, phone_number: doc.phone_number || '', email: doc.email || '', specialization: doc.specialization || '', price_per_visit: s ? s.price_per_visit : '', doctor_percent: s ? s.doctor_percent : '70', username: doc.username || '', new_password: '' })
  }
  const saveEdit = async (e) => {
    e.preventDefault(); setEditSaving(true)
    try {
      await axios.patch(API_BASE + `/visiting/admin/update-doctor/${editDoc.id}`, { ...editForm, price_per_visit: editForm.price_per_visit ? parseFloat(editForm.price_per_visit) : undefined, doctor_percent: editForm.doctor_percent ? parseFloat(editForm.doctor_percent) : undefined }, hdr)
      setEditDoc(null); load()
    } catch (e) { alert('Ошибка: ' + (e?.response?.data?.detail || e.message)) }
    setEditSaving(false)
  }

  const openBook = (doc) => {
    const today = new Date().toISOString().slice(0, 10)
    const s = settings.find(x => x.doctor_id === doc.id)
    setBookDoc(doc)
    setBookForm({ patient_name:'', patient_phone:'', appointment_date: today, start_time:'09:00', end_time:'09:30', price: s ? s.price_per_visit : '', clinic_id: doc.clinics?.[0]?.id || '' })
    setBookMsg('')
  }
  const saveBook = async (e) => {
    e.preventDefault(); setBookSaving(true); setBookMsg('')
    try {
      const clinic_id = bookForm.clinic_id || (clinics[0]?.id || '')
      const r = await axios.post(API_BASE + '/visiting/admin/book-appointment', { doctor_user_id: bookDoc.id, clinic_id, patient_name: bookForm.patient_name, patient_phone: bookForm.patient_phone, appointment_date: bookForm.appointment_date, start_time: bookForm.start_time, end_time: bookForm.end_time, price: bookForm.price ? parseFloat(bookForm.price) : null }, hdr)
      setBookResult(r.data)
      setBookMsg('✅ Запись создана')
    } catch (e) { setBookMsg('❌ ' + (e?.response?.data?.detail || 'Ошибка')) }
    setBookSaving(false)
  }

  const loadReport = async (docId) => {
    setReportLoading(true); setReportData(null)
    try {
      const params = new URLSearchParams()
      if (reportFrom) params.append('date_from', reportFrom)
      if (reportTo)   params.append('date_to',   reportTo)
      const r = await axios.get(API_BASE + `/visiting/admin/appointments/${docId}?${params}`, hdr)
      setReportData(r.data)
    } catch {}
    setReportLoading(false)
  }
  const openReport = (doc) => {
    setReportDoc(doc)
    setReportData(null)
    const to   = new Date().toISOString().slice(0, 10)
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    setReportFrom(from); setReportTo(to)
    setTimeout(() => {}, 0)
  }
  useEffect(() => {
    if (reportDoc) loadReport(reportDoc.id)
  }, [reportDoc, reportFrom, reportTo])

  const exportCSV = () => {
    if (!reportData) return
    const rows = [['Пациент', 'Телефон', 'Дата', 'Время', 'Статус', 'Цена, ₽', 'Доля врача, ₽']]
    reportData.appointments.forEach(a => rows.push([a.patient_name || '', a.patient_phone || '', a.appointment_date, a.start_time?.slice(0,5), a.status, a.price, a.doctor_share]))
    const csv = rows.map(r => r.join(';')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv)
    a.download = `отчёт_${reportDoc.full_name}_${reportFrom}_${reportTo}.csv`
    a.click()
  }

  const BarChart = ({ appointments }) => {
    if (!appointments || !appointments.length) return null
    const byDate = {}
    appointments.forEach(a => {
      if (!byDate[a.appointment_date]) byDate[a.appointment_date] = { total: 0, completed: 0 }
      byDate[a.appointment_date].total++
      if (a.status === 'completed') byDate[a.appointment_date].completed++
    })
    const dates = Object.keys(byDate).sort().slice(-14)
    if (!dates.length) return null
    const maxVal = Math.max(...dates.map(d => byDate[d].total), 1)
    const W = 420, H = 90, pad = 24, barW = Math.min(24, (W - pad * 2) / dates.length - 4)
    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H + 20}`} className="block mx-auto">
        {dates.map((d, i) => {
          const x = pad + i * ((W - pad * 2) / dates.length) + ((W - pad * 2) / dates.length - barW) / 2
          const h = Math.max(4, (byDate[d].total / maxVal) * H)
          const hc = Math.max(0, (byDate[d].completed / maxVal) * H)
          return (
            <g key={d}>
              <rect x={x} y={H - h} width={barW} height={h} rx={3} fill="#e0f7fa" />
              <rect x={x} y={H - hc} width={barW} height={hc} rx={3} fill={P} />
              <text x={x + barW / 2} y={H + 14} textAnchor="middle" fontSize={8} fill="#90a4ae">{d.slice(5)}</text>
            </g>
          )
        })}
      </svg>
    )
  }

  const filtered = doctors.filter(d => !search || [d.full_name, d.username, d.specialization, d.phone_number].some(v => v && v.toLowerCase().includes(search.toLowerCase())))

  const INPUT_CLS = "w-full border border-gray-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-[#0097A7]"
  const LABEL_CLS = "block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1"
  const MODAL_OVERLAY = "fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
  const MODAL_BOX = "bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
  const BTN_PRIMARY = "flex-1 bg-[#0097A7] hover:bg-[#007a88] text-white rounded-xl py-2.5 font-bold text-sm transition disabled:opacity-50"
  const BTN_CANCEL = "flex-1 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 rounded-xl py-2.5 font-semibold text-sm hover:bg-gray-200 dark:hover:bg-slate-600 transition"

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* QR попап */}
      {qrData && (
        <div className={MODAL_OVERLAY}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <p className="font-bold text-[#004D5F] dark:text-teal-300 mb-3">✅ {qrData.message}</p>
            <div className="text-center my-4">
              <img src={`data:image/png;base64,${qrData.qr_code}`} alt="QR" className="w-36 h-36 rounded-xl mx-auto" />
            </div>
            <div className="bg-teal-50 dark:bg-slate-700 rounded-xl p-3 mb-4 text-sm space-y-1">
              <div><span className="font-bold">Логин:</span> {qrData.credentials?.username}</div>
              <div><span className="font-bold">Пароль:</span> {qrData.credentials?.password}</div>
            </div>
            <button onClick={() => setQrData(null)} className="w-full bg-[#0097A7] text-white rounded-xl py-2.5 font-bold">Закрыть</button>
          </div>
        </div>
      )}

      {/* Модал редактирования врача */}
      {editDoc && (
        <div className={MODAL_OVERLAY}>
          <div className={MODAL_BOX + " p-6"}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-base text-[#004D5F] dark:text-teal-300">Редактировать врача</h3>
              <button onClick={() => setEditDoc(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={saveEdit} className="space-y-3">
              {[
                { label:'ФИО',          key:'full_name' },
                { label:'Телефон',       key:'phone_number' },
                { label:'Email',         key:'email' },
                { label:'Специализация', key:'specialization' },
              ].map(f => (
                <div key={f.key}>
                  <label className={LABEL_CLS}>{f.label}</label>
                  <input className={INPUT_CLS} value={editForm[f.key] || ''} onChange={e => setEditForm(p => ({ ...p, [f.key]: e.target.value }))} />
                </div>
              ))}
              <div className="bg-gray-50 dark:bg-slate-700/60 rounded-xl p-3 space-y-3">
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400">Доступ</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL_CLS}>Логин</label>
                    <input className={INPUT_CLS} value={editForm.username || ''} onChange={e => setEditForm(p => ({ ...p, username: e.target.value }))} />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Новый пароль</label>
                    <input type="password" className={INPUT_CLS} value={editForm.new_password || ''} onChange={e => setEditForm(p => ({ ...p, new_password: e.target.value }))} placeholder="Оставьте пустым" />
                  </div>
                </div>
              </div>
              <div className="bg-teal-50 dark:bg-slate-700/60 rounded-xl p-3 space-y-3">
                <p className="text-xs font-bold text-[#004D5F] dark:text-teal-400">Условия работы</p>
                <div className="grid grid-cols-2 gap-3">
                  {[{ label:'Цена за приём ₽', key:'price_per_visit' }, { label:'Доля врача %', key:'doctor_percent' }].map(f => (
                    <div key={f.key}>
                      <label className={LABEL_CLS}>{f.label}</label>
                      <input type="number" className={INPUT_CLS} value={editForm[f.key] || ''} onChange={e => setEditForm(p => ({ ...p, [f.key]: e.target.value }))} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditDoc(null)} className={BTN_CANCEL}>Отмена</button>
                <button type="submit" disabled={editSaving} className={BTN_PRIMARY}>{editSaving ? 'Сохранение...' : 'Сохранить'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модал записи на приём */}
      {bookDoc && (
        <div className={MODAL_OVERLAY}>
          <div className={MODAL_BOX + " p-6"}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-sm text-[#004D5F] dark:text-teal-300">Запись: {bookDoc.full_name}</h3>
              <button onClick={() => setBookDoc(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={saveBook} className="space-y-3">
              {[
                { label:'Имя пациента *', key:'patient_name', type:'text' },
                { label:'Телефон *',       key:'patient_phone', type:'tel' },
              ].map(f => (
                <div key={f.key}>
                  <label className={LABEL_CLS}>{f.label}</label>
                  <input type={f.type} required className={INPUT_CLS} value={bookForm[f.key] || ''} onChange={e => setBookForm(p => ({ ...p, [f.key]: e.target.value }))} />
                </div>
              ))}
              <div>
                <label className={LABEL_CLS}>Дата приёма *</label>
                <input type="date" required className={INPUT_CLS} value={bookForm.appointment_date} onChange={e => setBookForm(p => ({ ...p, appointment_date: e.target.value }))} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[{ label:'Начало', key:'start_time', type:'time' }, { label:'Конец', key:'end_time', type:'time' }, { label:'Цена ₽', key:'price', type:'number' }].map(f => (
                  <div key={f.key}>
                    <label className={LABEL_CLS}>{f.label}</label>
                    <input type={f.type} className={INPUT_CLS} value={bookForm[f.key] || ''} onChange={e => setBookForm(p => ({ ...p, [f.key]: e.target.value }))} required={f.key !== 'price'} />
                  </div>
                ))}
              </div>
              {clinics.length > 1 && (
                <div>
                  <label className={LABEL_CLS}>Клиника</label>
                  <select className={INPUT_CLS} value={bookForm.clinic_id || ''} onChange={e => setBookForm(p => ({ ...p, clinic_id: e.target.value }))}>
                    {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              {bookMsg && <p className="text-sm">{bookMsg}</p>}
              {bookResult && (
                <div className="bg-teal-50 dark:bg-slate-700 rounded-xl p-3 border border-teal-200 dark:border-slate-600">
                  <p className="font-bold text-sm text-[#004D5F] dark:text-teal-300 mb-2">Данные для пациента</p>
                  <div className="flex gap-3 items-start">
                    {bookResult.patient_qr && (
                      <img src={'data:image/png;base64,' + bookResult.patient_qr} alt="QR"
                        className="w-20 h-20 rounded-lg border border-gray-200 flex-shrink-0 cursor-pointer"
                        onClick={() => window.open(bookResult.patient_url, '_blank')} />
                    )}
                    <div className="flex-1">
                      {bookResult.short_code && (
                        <div className="mb-1">
                          <div className="text-[9px] text-gray-400 font-bold uppercase">Код записи</div>
                          <div className="text-3xl font-black text-orange-600 tracking-widest">{bookResult.short_code}</div>
                        </div>
                      )}
                      {bookResult.patient_url && (
                        <a href={bookResult.patient_url} target="_blank" rel="noreferrer" className="text-xs text-[#0097A7] break-all">Открыть кабинет →</a>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setBookDoc(null); setBookResult(null) }} className={BTN_CANCEL}>{bookResult ? 'Закрыть' : 'Отмена'}</button>
                {!bookResult && <button type="submit" disabled={bookSaving} className={BTN_PRIMARY}>{bookSaving ? 'Запись...' : '+ Записать пациента'}</button>}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модал отчёта */}
      {reportDoc && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-base text-[#004D5F] dark:text-teal-300">Отчёт: {reportDoc.full_name}</h3>
              <button onClick={() => setReportDoc(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="flex gap-2 mb-4 flex-wrap items-end">
              {[{ label:'С', val:reportFrom, set:setReportFrom }, { label:'По', val:reportTo, set:setReportTo }].map(f => (
                <div key={f.label}>
                  <label className={LABEL_CLS}>{f.label}</label>
                  <input type="date" className="border border-gray-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-gray-100 outline-none" value={f.val} onChange={e => f.set(e.target.value)} />
                </div>
              ))}
              <div className="flex gap-2">
                <button onClick={exportCSV} className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-3 py-2 text-xs font-bold hover:bg-green-100 transition">⬇ Excel (CSV)</button>
                <button onClick={() => window.print()} className="bg-orange-50 border border-orange-200 text-orange-700 rounded-xl px-3 py-2 text-xs font-bold hover:bg-orange-100 transition">🖨 PDF</button>
              </div>
            </div>
            {reportLoading && <div className="text-center py-8 text-gray-400 text-sm">Загрузка...</div>}
            {!reportLoading && reportData && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                  {[
                    { label:'Всего',     value:reportData.stats.total,                                   color:'text-[#004D5F] dark:text-teal-400', bg:'bg-teal-50 dark:bg-teal-900/20' },
                    { label:'Завершено', value:reportData.stats.completed,                               color:'text-green-700',   bg:'bg-green-50 dark:bg-green-900/20' },
                    { label:'Не пришёл', value:reportData.stats.no_show ?? 0,                            color:'text-red-600',     bg:'bg-red-50 dark:bg-red-900/20' },
                    { label:'Выручка ₽', value:(reportData.stats.revenue||0).toLocaleString('ru'),       color:'text-blue-700',    bg:'bg-blue-50 dark:bg-blue-900/20' },
                    { label:'Врачу ₽',   value:(reportData.stats.doctor_share||0).toLocaleString('ru'),  color:'text-purple-700',  bg:'bg-purple-50 dark:bg-purple-900/20' },
                    { label:'Эквайринг', value:(reportData.stats.pay_acquiring||0).toLocaleString('ru'), color:'text-sky-700',     bg:'bg-sky-50 dark:bg-sky-900/20' },
                    { label:'Наличные',  value:(reportData.stats.pay_cash||0).toLocaleString('ru'),      color:'text-emerald-700', bg:'bg-emerald-50 dark:bg-emerald-900/20' },
                    { label:'Перевод',   value:(reportData.stats.pay_transfer||0).toLocaleString('ru'),  color:'text-amber-700',   bg:'bg-amber-50 dark:bg-amber-900/20' },
                  ].map(c => (
                    <div key={c.label} className={`${c.bg} rounded-xl p-2.5 text-center`}>
                      <div className="text-[9px] text-gray-400 uppercase font-bold mb-1">{c.label}</div>
                      <div className={`font-extrabold text-lg ${c.color}`}>{c.value}</div>
                    </div>
                  ))}
                </div>
                {reportData.appointments.length > 0 && (
                  <div className="bg-gray-50 dark:bg-slate-700/40 rounded-xl p-3 mb-4">
                    <p className="text-[10px] text-gray-400 font-bold uppercase mb-2">
                      Приёмы по дням <span className="text-[#0097A7]">■ выполнено</span>
                    </p>
                    <BarChart appointments={reportData.appointments} />
                  </div>
                )}
                {reportData.appointments.length === 0 ? (
                  <div className="text-center py-6 text-gray-400 text-sm">Записей за период нет</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-slate-700">
                          {['Пациент','Телефон','Дата','Время','Статус','Оплата','Цена ₽','Врачу ₽'].map(h => (
                            <th key={h} className="px-2 py-2 text-left font-bold text-gray-500 dark:text-gray-400 text-[10px] uppercase whitespace-nowrap border-b border-gray-100 dark:border-slate-600">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.appointments.map(a => (
                          <tr key={a.id} className="border-b border-gray-50 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/40">
                            <td className="px-2 py-1.5 font-semibold text-gray-800 dark:text-gray-200">{a.patient_name || '—'}</td>
                            <td className="px-2 py-1.5 text-gray-500 font-mono">{a.patient_phone}</td>
                            <td className="px-2 py-1.5 text-gray-500">{a.appointment_date}</td>
                            <td className="px-2 py-1.5 text-gray-500">{a.start_time?.slice(0,5)}</td>
                            <td className="px-2 py-1.5">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.status==='completed'?'bg-green-100 text-green-700':a.status==='no_show'?'bg-red-100 text-red-600':'bg-teal-100 text-teal-700'}`}>
                                {a.status==='completed'?'✓ Завершён':a.status==='no_show'?'✗ Не пришёл':a.status==='cancelled'?'Отменён':'⏳ Ожидает'}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-gray-600">
                              {a.payment_method==='acquiring'?'💳 Карта':a.payment_method==='cash'?'💵 Нал.':a.payment_method==='transfer'?'📲 Перевод':'—'}
                            </td>
                            <td className="px-2 py-1.5 font-bold text-blue-700">{Number(a.price).toLocaleString('ru')}</td>
                            <td className="px-2 py-1.5 font-bold text-purple-700">{Number(a.doctor_share).toLocaleString('ru')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Шапка */}
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <h3 className="font-bold text-base text-[#004D5F] dark:text-teal-300 m-0">Приезжие врачи</h3>
          <p className="text-xs text-gray-400 m-0">{doctors.length} врачей зарегистрировано</p>
        </div>
        {mainTab === "doctors" && (
          <button onClick={() => setShowAdd(!showAdd)}
            className={`rounded-xl px-4 py-2 font-bold text-sm transition ${showAdd ? 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-slate-600' : 'bg-[#0097A7] text-white hover:bg-[#007a88]'}`}>
            {showAdd ? '✕ Закрыть' : '+ Добавить врача'}
          </button>
        )}
      </div>

      {/* Вкладки Врачи / Записи */}
      <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 rounded-xl p-1">
        {[{ k:"doctors", label:"Врачи" }, { k:"appointments", label:"Все записи" }].map(t => (
          <button key={t.k}
            onClick={() => { setMainTab(t.k); if (t.k === "appointments") loadAllApts() }}
            className={`flex-1 py-2 rounded-lg font-bold text-sm transition ${mainTab === t.k ? 'bg-white dark:bg-slate-600 text-[#0097A7] shadow-sm' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Вкладка: Все записи */}
      {mainTab === "appointments" && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap items-end">
            <div>
              <label className={LABEL_CLS}>С</label>
              <input type="date" className="border border-gray-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-gray-100 outline-none" value={aptsDateFrom} onChange={e => setAptsDateFrom(e.target.value)} />
            </div>
            <div>
              <label className={LABEL_CLS}>По</label>
              <input type="date" className="border border-gray-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-gray-100 outline-none" value={aptsDateTo} onChange={e => setAptsDateTo(e.target.value)} />
            </div>
            <div>
              <label className={LABEL_CLS}>Врач</label>
              <select className="border border-gray-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-gray-100 outline-none" value={aptsStatus.doctor || ''} onChange={e => setAptsStatus(prev => ({ ...prev, doctor: e.target.value }))}>
                <option value="">Все врачи</option>
                {doctors.map(d => <option key={d.id} value={d.full_name}>{d.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Статус</label>
              <select className="border border-gray-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-gray-100 outline-none" value={typeof aptsStatus === 'object' ? (aptsStatus.status || '') : aptsStatus} onChange={e => setAptsStatus(prev => typeof prev === 'object' ? { ...prev, status: e.target.value } : e.target.value)}>
                <option value="">Все</option>
                <option value="pending">Ожидает</option>
                <option value="completed">Завершён</option>
              </select>
            </div>
            <button onClick={loadAllApts} className="bg-[#0097A7] text-white rounded-xl px-4 py-2 font-bold text-sm hover:bg-[#007a88] transition self-end">Обновить</button>
          </div>

          {allApts.length > 0 && (() => {
            const docFilter = typeof aptsStatus === 'object' ? (aptsStatus.doctor || '') : ''
            const filteredApts = docFilter ? allApts.filter(a => a.doctor_name === docFilter) : allApts
            const completed = filteredApts.filter(a => String(a.status).includes('completed'))
            const totalShare = completed.reduce((s, a) => s + (Number(a.doctor_share) || 0), 0)
            return (
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label:'Всего записей',  value: filteredApts.length,                      color:'text-[#004D5F] dark:text-teal-400', bg:'bg-teal-50 dark:bg-teal-900/20' },
                  { label:'Завершено',       value: completed.length,                         color:'text-green-700',  bg:'bg-green-50 dark:bg-green-900/20' },
                  { label:'Выплатить врачам',value: totalShare.toLocaleString('ru') + ' ₽',  color:'text-purple-700', bg:'bg-purple-50 dark:bg-purple-900/20' },
                ].map(c => (
                  <div key={c.label} className={`${c.bg} rounded-xl p-3 text-center`}>
                    <div className="text-[9px] text-gray-400 uppercase font-bold mb-1">{c.label}</div>
                    <div className={`font-extrabold text-base ${c.color}`}>{c.value}</div>
                  </div>
                ))}
              </div>
            )
          })()}

          {aptsLoading ? (
            <div className="text-center py-10 text-gray-400">Загрузка...</div>
          ) : allApts.length === 0 ? (
            <div className="text-center py-10 text-gray-400">Записей нет</div>
          ) : (
            <div className="overflow-x-auto bg-white dark:bg-slate-800 rounded-2xl shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-700">
                    {['Врач', 'Пациент', 'Телефон', 'Дата', 'Время', 'Статус', 'Оплата', 'Заработок', ''].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-bold text-[10px] text-gray-500 dark:text-gray-400 uppercase border-b border-gray-100 dark:border-slate-600 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(typeof aptsStatus === 'object' && aptsStatus.doctor
                    ? allApts.filter(a => a.doctor_name === aptsStatus.doctor)
                    : allApts
                  ).map(a => (
                    <tr key={a.id} className="border-b border-gray-50 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/40">
                      <td className="px-3 py-2 font-semibold text-[#004D5F] dark:text-teal-300 whitespace-nowrap">{a.doctor_name}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{a.patient_name || '—'}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-xs">{a.patient_phone}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{a.appointment_date}</td>
                      <td className="px-3 py-2 text-gray-500">{a.start_time?.slice(0,5)}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${String(a.status).includes('completed')?'bg-green-100 text-green-700':String(a.status).includes('no_show')?'bg-red-100 text-red-600':'bg-orange-100 text-orange-600'}`}>
                          {String(a.status).includes('completed')?'✓ Завершён':String(a.status).includes('no_show')?'✗ Не пришёл':'⏳ Ожидает'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600 text-xs">
                        {a.payment_method==='acquiring'?'💳 Карта':a.payment_method==='cash'?'💵 Нал.':a.payment_method==='transfer'?'📲 Перевод':'—'}
                      </td>
                      <td className="px-3 py-2 font-bold text-green-600">{Number(a.doctor_share).toLocaleString('ru')} ₽</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <button onClick={() => openEditApt(a)} className="bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-2 py-1 text-xs font-bold hover:bg-blue-100 transition">✏</button>
                          <button onClick={() => setDeleteAptId(a.id)} className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-2 py-1 text-xs font-bold hover:bg-red-100 transition">🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Модал редактирования записи */}
      {editApt && (
        <div className={MODAL_OVERLAY}>
          <div className={MODAL_BOX + " p-6"}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-base text-[#004D5F] dark:text-teal-300">Редактировать запись</h3>
              <button onClick={() => setEditApt(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={saveEditApt}>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { label:'Пациент', key:'patient_name', type:'text', span:2 },
                  { label:'Телефон', key:'patient_phone', type:'tel', span:2 },
                  { label:'Дата', key:'appointment_date', type:'date', span:1 },
                  { label:'Начало', key:'start_time', type:'time', span:1 },
                  { label:'Конец', key:'end_time', type:'time', span:1 },
                  { label:'Цена ₽', key:'price', type:'number', span:1 },
                ].map(f => (
                  <div key={f.key} className={f.span === 2 ? 'col-span-2' : ''}>
                    <label className={LABEL_CLS}>{f.label}</label>
                    <input type={f.type} className={INPUT_CLS} value={editAptForm[f.key] || ''} onChange={e => setEditAptForm(p => ({ ...p, [f.key]: e.target.value }))} />
                  </div>
                ))}
                <div className="col-span-2">
                  <label className={LABEL_CLS}>Статус</label>
                  <select className={INPUT_CLS} value={editAptForm.status || 'pending'} onChange={e => setEditAptForm(p => ({ ...p, status: e.target.value }))}>
                    <option value="pending">Ожидает</option>
                    <option value="completed">Завершён (пришёл)</option>
                    <option value="no_show">Не пришёл</option>
                    <option value="cancelled">Отменён</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className={LABEL_CLS}>Способ оплаты</label>
                  <select className={INPUT_CLS} value={editAptForm.payment_method || ''} onChange={e => setEditAptForm(p => ({ ...p, payment_method: e.target.value }))}>
                    <option value="">— не указан —</option>
                    <option value="acquiring">Эквайринг (карта)</option>
                    <option value="cash">Наличные</option>
                    <option value="transfer">Перевод</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className={LABEL_CLS}>Примечание</label>
                  <textarea className={INPUT_CLS + " resize-y"} rows={2} value={editAptForm.notes || ''} onChange={e => setEditAptForm(p => ({ ...p, notes: e.target.value }))} />
                </div>
              </div>
              {editAptMsg && <p className={`text-sm mb-3 ${editAptMsg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>{editAptMsg}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => setEditApt(null)} className={BTN_CANCEL}>Отмена</button>
                <button type="submit" disabled={editAptSaving} className={BTN_PRIMARY}>{editAptSaving ? 'Сохранение...' : 'Сохранить'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Подтверждение удаления */}
      {deleteAptId && (
        <div className={MODAL_OVERLAY}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-xs p-7 text-center">
            <div className="text-4xl mb-3">🗑️</div>
            <h3 className="font-bold text-base text-[#004D5F] dark:text-teal-300 mb-2">Удалить запись?</h3>
            <p className="text-sm text-gray-400 mb-5">Это действие нельзя отменить</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteAptId(null)} className={BTN_CANCEL}>Отмена</button>
              <button onClick={confirmDeleteApt} disabled={deleteAptSaving}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-xl py-2.5 font-bold text-sm transition">
                {deleteAptSaving ? 'Удаление...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Вкладка: Врачи */}
      {mainTab === "doctors" && (<>

      {/* Форма регистрации */}
      {showAdd && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 shadow-sm">
          <h4 className="font-bold text-[#004D5F] dark:text-teal-300 mt-0 mb-4">Регистрация приезжего врача</h4>
          <form onSubmit={registerDoctor} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label:'ФИО *',        key:'full_name' },
                { label:'Телефон',       key:'phone_number' },
                { label:'Email',         key:'email' },
                { label:'Специализация', key:'specialization' },
                { label:'Адрес',         key:'address' },
                { label:'Логин *',       key:'username' },
                { label:'Пароль *',      key:'password' },
              ].map(f => (
                <div key={f.key} className={['full_name','address'].includes(f.key) ? 'col-span-2' : ''}>
                  <label className={LABEL_CLS}>{f.label}</label>
                  <input className={INPUT_CLS} value={form[f.key]} onChange={e => set(f.key, e.target.value)} required={f.label.includes('*')} />
                </div>
              ))}
            </div>
            <div className="bg-teal-50 dark:bg-slate-700/60 rounded-xl p-3">
              <p className="text-xs font-bold text-[#004D5F] dark:text-teal-400 mb-3">Условия работы</p>
              <div className="grid grid-cols-2 gap-3">
                {[{ label:'Цена за приём ₽', key:'price_per_visit' }, { label:'Доля врача %', key:'doctor_percent' }].map(f => (
                  <div key={f.key}>
                    <label className={LABEL_CLS}>{f.label}</label>
                    <input type="number" className={INPUT_CLS} value={form[f.key]} onChange={e => set(f.key, e.target.value)} />
                  </div>
                ))}
              </div>
              {form.price_per_visit && form.doctor_percent && (
                <p className="text-xs text-green-600 font-semibold mt-2">
                  Врач получит: {Math.round(parseFloat(form.price_per_visit) * parseFloat(form.doctor_percent) / 100).toLocaleString('ru')} ₽ / приём
                </p>
              )}
            </div>
            {clinics.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Клиники</p>
                <div className="flex flex-wrap gap-2">
                  {clinics.map(c => (
                    <button type="button" key={c.id} onClick={() => toggleCl(c.id)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${form.clinic_ids.includes(c.id) ? 'bg-teal-100 border-[#0097A7] text-[#004D5F] dark:bg-teal-900/40 dark:text-teal-300' : 'bg-white dark:bg-slate-700 border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-400'}`}>
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msg && <p className="text-sm">{msg}</p>}
            <button type="submit" disabled={saving}
              className="w-full bg-[#0097A7] hover:bg-[#007a88] disabled:opacity-50 text-white rounded-xl py-3 font-bold transition">
              {saving ? 'Регистрация...' : 'Зарегистрировать и получить QR'}
            </button>
          </form>
        </div>
      )}

      {/* Поиск */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 px-3 py-2 flex items-center gap-2 shadow-sm">
        <span className="material-symbols-outlined text-lg text-gray-400">search</span>
        <input className="flex-1 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400"
          value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск..." />
      </div>

      {/* Список врачей */}
      {filtered.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">
          {search ? 'Ничего не найдено' : 'Нет приезжих врачей — нажмите «Добавить врача»'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(doc => {
            const docSettings = settings.find(s => s.doctor_id === doc.id)
            return (
              <div key={doc.id} className={`bg-white dark:bg-slate-800 rounded-2xl border p-4 shadow-sm ${!doc.is_active ? 'border-red-200 dark:border-red-800' : doc.is_suspended ? 'border-orange-200 dark:border-orange-800' : 'border-gray-100 dark:border-slate-700'}`}>
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-[#004D5F] dark:text-teal-300">{doc.full_name}</p>
                    {doc.specialization && <p className="text-xs text-[#0097A7]">{doc.specialization}</p>}
                    <p className="text-[11px] text-gray-400 font-mono">{doc.username} · {doc.phone_number || '—'}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${!doc.is_active ? 'bg-red-100 text-red-600' : doc.is_suspended ? 'bg-orange-100 text-orange-600' : 'bg-teal-100 text-teal-700'}`}>
                    {!doc.is_active ? 'Заблокирован' : doc.is_suspended ? 'Приостановлен' : 'Активен'}
                  </span>
                </div>
                {docSettings && (
                  <div className="flex gap-2 mb-3 flex-wrap">
                    <span className="text-xs bg-teal-50 dark:bg-teal-900/30 text-[#004D5F] dark:text-teal-400 px-2 py-0.5 rounded-lg font-semibold">{parseFloat(docSettings.price_per_visit).toLocaleString('ru')} ₽/приём</span>
                    <span className="text-xs bg-green-50 dark:bg-green-900/30 text-green-700 px-2 py-0.5 rounded-lg font-semibold">{docSettings.doctor_percent}% доля</span>
                    <span className="text-xs bg-purple-50 dark:bg-purple-900/30 text-purple-700 px-2 py-0.5 rounded-lg font-semibold">Врачу: {Math.round(parseFloat(docSettings.price_per_visit)*parseFloat(docSettings.doctor_percent)/100).toLocaleString('ru')} ₽</span>
                  </div>
                )}
                {doc.clinics?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {doc.clinics.map(c => <span key={c.id} className="text-[10px] bg-teal-50 dark:bg-teal-900/30 text-[#004D5F] dark:text-teal-400 px-2 py-0.5 rounded-full font-semibold">{c.name}</span>)}
                  </div>
                )}
                <div className="flex gap-1.5 pt-3 border-t border-gray-50 dark:border-slate-700 flex-wrap">
                  <button onClick={() => openEdit(doc)} className="bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold hover:bg-blue-100 transition">✏ Редактировать</button>
                  {!doc.is_suspended && (
                    <button onClick={() => openBook(doc)} className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold hover:bg-green-100 transition">+ Записать</button>
                  )}
                  <button onClick={() => openReport(doc)} className="bg-purple-50 border border-purple-200 text-purple-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold hover:bg-purple-100 transition">📊 Отчёт</button>
                  {doc.is_active && (
                    <button onClick={() => toggleSuspend(doc)} disabled={suspending === doc.id}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition disabled:opacity-50 ${doc.is_suspended ? 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100' : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'}`}>
                      {suspending === doc.id ? '...' : doc.is_suspended ? '▶ Возобновить' : '⏸ Приостановить'}
                    </button>
                  )}
                  <button onClick={() => toggleActive(doc)} disabled={toggling === doc.id}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition disabled:opacity-50 ${doc.is_active ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100' : 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100'}`}>
                    {toggling === doc.id ? '...' : doc.is_active ? '🚫 Заблокировать' : '✓ Активировать'}
                  </button>
                  <button onClick={() => setDeleteDocId(doc.id)}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 transition ml-auto">
                    🗑 Удалить
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      </>)}

      {/* Delete doctor confirmation modal */}
      {deleteDocId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-bold text-base text-gray-800 dark:text-gray-100 mb-2">Удалить врача?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">Это действие необратимо. Все данные врача будут удалены.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteDocId(null)} className="flex-1 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 rounded-xl py-2.5 font-semibold text-sm hover:bg-gray-200 dark:hover:bg-slate-600 transition">Отмена</button>
              <button onClick={deleteDoctor} disabled={deletingDoc} className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-xl py-2.5 font-bold text-sm transition disabled:opacity-50">
                {deletingDoc ? 'Удаление...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── RecruiterSection ──────────────────────────────────────────────────────────
function RecruiterSection({ token }) {
  const hdr = { headers: { Authorization: `Bearer ${token}` } }
  const [recruiters, setRecruiters] = useState([])
  const [selected, setSelected]     = useState(null)
  const [editPercent, setEditPercent] = useState({})
  const [saving, setSaving]         = useState(null)
  const [search, setSearch]         = useState('')
  const [msg, setMsg]               = useState({})

  const load = () => {
    axios.get(API_BASE + '/manager/recruiters', hdr)
      .then(r => setRecruiters(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
  }
  useEffect(() => { load() }, [])

  const openDetail = async (rec) => {
    const r = await axios.get(API_BASE + `/manager/recruiters/${rec.id}/doctors`, hdr).catch(() => ({ data: [] }))
    setSelected({ recruiter: rec, doctors: Array.isArray(r.data) ? r.data : [] })
  }

  const savePercent = async (id) => {
    const val = editPercent[id]
    if (val === undefined || val === '') return
    setSaving(id)
    try {
      await axios.patch(API_BASE + `/manager/recruiters/${id}/percent`, { bonus_percent: parseFloat(val) }, hdr)
      setMsg(p => ({...p, [id]: '✅ Сохранено'}))
      load()
      setTimeout(() => setMsg(p => ({...p, [id]: ''})), 2000)
    } catch(e) { setMsg(p => ({...p, [id]: '❌ ' + (e?.response?.data?.detail || 'Ошибка')})) }
    setSaving(null)
  }

  const filtered = recruiters.filter(r => !search || r.full_name.toLowerCase().includes(search.toLowerCase()))

  if (selected) {
    const { recruiter, doctors } = selected
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <button onClick={() => setSelected(null)}
          className="bg-gray-100 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-2 text-sm font-semibold text-[#004D5F] dark:text-teal-300 hover:bg-gray-200 dark:hover:bg-slate-600 transition">
          ← Назад к рекрутерам
        </button>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 shadow-sm">
          <p className="font-bold text-base text-[#004D5F] dark:text-teal-300 mb-1">{recruiter.full_name}</p>
          <p className="text-xs text-gray-400 mb-4">Рекрутер · {recruiter.username}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label:'Врачей',        value: recruiter.doctors_count,                              color:'text-[#004D5F] dark:text-teal-400', bg:'bg-teal-50 dark:bg-teal-900/20' },
              { label:'Бонусов всего', value: `${recruiter.bonus_total.toLocaleString('ru')} ₽`,   color:'text-green-700',  bg:'bg-green-50 dark:bg-green-900/20' },
              { label:'К выплате',     value: `${recruiter.bonus_pending.toLocaleString('ru')} ₽`, color:'text-orange-600', bg:'bg-orange-50 dark:bg-orange-900/20' },
              { label:'% бонус',       value: `${recruiter.bonus_percent}%`,                        color:'text-purple-700', bg:'bg-purple-50 dark:bg-purple-900/20' },
            ].map(c => (
              <div key={c.label} className={`${c.bg} rounded-xl p-3 text-center`}>
                <div className="text-[9px] text-gray-400 uppercase font-bold mb-1">{c.label}</div>
                <div className={`font-extrabold text-base ${c.color}`}>{c.value}</div>
              </div>
            ))}
          </div>
        </div>
        <h4 className="font-bold text-[#004D5F] dark:text-teal-300 m-0">Привлечённые врачи ({doctors.length})</h4>
        {doctors.length === 0
          ? <div className="text-center py-8 text-gray-400 text-sm">Нет привлечённых врачей</div>
          : <div className="space-y-2">
              {doctors.map(doc => (
                <div key={doc.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4 flex justify-between items-center shadow-sm">
                  <div>
                    <p className="font-bold text-sm text-[#004D5F] dark:text-teal-300">{doc.full_name}</p>
                    {doc.specialization && <p className="text-xs text-[#0097A7]">{doc.specialization}</p>}
                    <p className="text-[11px] text-gray-400">{new Date(doc.created_at).toLocaleDateString('ru')}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-600 text-sm">+{doc.bonus_earned.toLocaleString('ru')} ₽</p>
                    <p className="text-[11px] text-gray-400">бонусов</p>
                  </div>
                </div>
              ))}
            </div>
        }
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h3 className="font-bold text-base text-[#004D5F] dark:text-teal-300 mb-0.5">Рекрутеры</h3>
        <p className="text-xs text-gray-400">{recruiters.length} рекрутеров в системе</p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 px-3 py-2 flex items-center gap-2 shadow-sm">
        <span className="material-symbols-outlined text-lg text-gray-400">search</span>
        <input className="flex-1 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400"
          value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по имени..." />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">Рекрутеров нет</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(rec => (
            <div key={rec.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="font-bold text-sm text-[#004D5F] dark:text-teal-300">{rec.full_name}</p>
                  <p className="text-xs text-gray-400">{rec.username}{rec.phone_number ? ' · ' + rec.phone_number : ''}</p>
                </div>
                <button onClick={() => openDetail(rec)}
                  className="bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-700 text-[#0097A7] dark:text-teal-400 rounded-xl px-3 py-1.5 text-xs font-semibold hover:bg-teal-100 dark:hover:bg-teal-900/50 transition">
                  Детали →
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  { label:'Врачей',    value: rec.doctors_count,                               color:'text-[#004D5F] dark:text-teal-400', bg:'bg-teal-50 dark:bg-teal-900/20' },
                  { label:'Бонусов',   value: `${Number(rec.bonus_total).toLocaleString('ru')} ₽`,  color:'text-green-700',  bg:'bg-green-50 dark:bg-green-900/20' },
                  { label:'К выплате', value: `${Number(rec.bonus_pending).toLocaleString('ru')} ₽`, color:'text-orange-600', bg:'bg-orange-50 dark:bg-orange-900/20' },
                ].map(c => (
                  <div key={c.label} className={`${c.bg} rounded-xl p-2.5 text-center`}>
                    <div className="text-[9px] text-gray-400 uppercase font-bold mb-1">{c.label}</div>
                    <div className={`font-extrabold text-sm ${c.color}`}>{c.value}</div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 items-center bg-teal-50 dark:bg-slate-700/60 rounded-xl p-3">
                <span className="text-xs font-bold text-[#004D5F] dark:text-teal-400">% бонус:</span>
                <input type="number" min="0" max="100" step="0.5"
                  className="w-16 border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1 text-sm bg-white dark:bg-slate-700 dark:text-gray-100 text-center outline-none"
                  value={editPercent[rec.id] !== undefined ? editPercent[rec.id] : rec.bonus_percent}
                  onChange={e => setEditPercent(p => ({...p, [rec.id]: e.target.value}))} />
                <span className="text-xs text-gray-500">%</span>
                <button onClick={() => savePercent(rec.id)} disabled={saving === rec.id}
                  className="bg-[#0097A7] hover:bg-[#007a88] disabled:opacity-50 text-white rounded-lg px-3 py-1.5 text-xs font-bold transition">
                  {saving === rec.id ? '...' : 'Сохранить'}
                </button>
                {msg[rec.id] && <span className="text-xs">{msg[rec.id]}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const a = api(token)

  const deleteStaff = async () => {
    setDeleting(true)
    await a.delete(`/manager/admins/${existing.id}?hard=true`).catch(() => {})
    setDeleting(false)
    onDone()
  }

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
            {existing && !deleteConfirm && (
              <button type="button" onClick={() => setDeleteConfirm(true)}
                className="px-4 py-2.5 text-sm font-semibold text-red-600 hover:text-red-700 transition">🗑 Удалить</button>
            )}
            {existing && deleteConfirm && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600">Удалить безвозвратно?</span>
                <button type="button" onClick={deleteStaff} disabled={deleting}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition">
                  {deleting ? '...' : 'Да'}
                </button>
                <button type="button" onClick={() => setDeleteConfirm(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition">Нет</button>
              </div>
            )}
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

// ── AnalyticsSection ─────────────────────────────────────────────────────────
function AnalyticsSection({ token }) {
  const PRESETS = [
    { label: '7 дней',  days: 7 },
    { label: '30 дней', days: 30 },
    { label: '90 дней', days: 90 },
    { label: '365 дней',days: 365 },
  ]
  const [preset, setPreset]     = useState(30)
  const [overview, setOverview] = useState(null)
  const [dynamics, setDynamics] = useState([])
  const [clinics,  setClinics]  = useState([])
  const [topStaff, setTopStaff] = useState([])
  const [loading,  setLoading]  = useState(true)
  const a = api(token)

  useEffect(() => { load(preset) }, [preset])

  async function load(days) {
    setLoading(true)
    try {
      const [ov, dyn, cl, ts] = await Promise.all([
        a.get('/analytics/overview',   { days }),
        a.get('/analytics/dynamics',   { days, granularity: days > 60 ? 'week' : 'day' }),
        a.get('/analytics/clinics',    { days }),
        a.get('/analytics/top-staff',  { days }),
      ])
      setOverview(ov.data)
      setDynamics(Array.isArray(dyn.data?.series) ? dyn.data.series : [])
      setClinics(Array.isArray(cl.data?.items) ? cl.data.items : [])
      setTopStaff(Array.isArray(ts.data) ? ts.data : [])
    } catch {}
    setLoading(false)
  }

  // Mini bar chart
  function BarChart({ data }) {
    if (!data.length) return <div className="text-xs text-gray-400 text-center py-4">Нет данных</div>
    const maxVal = Math.max(...data.map(d => d.total), 1)
    return (
      <div className="mt-3">
        <div className="flex items-end gap-1 h-20">
          {data.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
              <div className="absolute bottom-full mb-1 bg-gray-800 text-white text-xs px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none z-10">
                {d.date}: {d.total} / {d.confirmed} ✓
              </div>
              <div className="w-full rounded-t-sm bg-[#0097A7] opacity-80 transition hover:opacity-100"
                style={{ height: `${Math.max(2, (d.total / maxVal) * 72)}px` }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>{data[0]?.date}</span>
          <span>{data[data.length - 1]?.date}</span>
        </div>
      </div>
    )
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-gray-800">Аналитика франшизы</h2>
        <div className="flex gap-1.5">
          {PRESETS.map(p => (
            <button key={p.days} onClick={() => setPreset(p.days)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                preset === p.days ? 'bg-[#0097A7] text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* KPI */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Направлений',  value: fmt(overview.current?.total),         color: '#0097A7' },
            { label: 'Конверсия',    value: `${overview.current?.conversion_pct ?? 0}%`, color: '#166534' },
            { label: 'Подтверждено', value: fmt(overview.current?.confirmed),      color: '#7c3aed' },
            { label: 'Бонусы выплач.', value: `${fmt(overview.current?.bonuses_paid)} ₽`, color: '#b45309' },
          ].map(m => (
            <div key={m.label} className="bg-white rounded-2xl shadow-sm p-4">
              <div className="text-xs text-gray-400 mb-1">{m.label}</div>
              <div className="text-xl font-bold" style={{ color: m.color }}>{m.value}</div>
              {overview.previous && (() => {
                const key = m.label === 'Направлений' ? 'total' : m.label === 'Конверсия' ? 'conversion_pct' : m.label === 'Подтверждено' ? 'confirmed' : 'bonuses_paid'
                const delta = (Number(overview.current?.[key]) || 0) - (Number(overview.previous?.[key]) || 0)
                if (delta === 0) return null
                return (
                  <div className={`text-xs font-semibold mt-0.5 ${delta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {delta >= 0 ? '↑' : '↓'} {fmt(Math.abs(delta))} vs пред.
                  </div>
                )
              })()}
            </div>
          ))}
        </div>
      )}

      {/* Динамика */}
      {dynamics.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-1">Динамика направлений</h3>
          <div className="text-xs text-gray-400 mb-2">тёмный = всего, светлый = подтверждено</div>
          <BarChart data={dynamics} />
        </div>
      )}

      {/* Клиники */}
      {clinics.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-4">Клиники франшизы</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="pb-2 text-left">#</th>
                  <th className="pb-2 text-left">Клиника</th>
                  <th className="pb-2 text-right">Направлений</th>
                  <th className="pb-2 text-right">Конверсия</th>
                  <th className="pb-2 text-right">Бонусы</th>
                </tr>
              </thead>
              <tbody>
                {clinics.map(c => (
                  <tr key={c.clinic_id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                    <td className="py-2 text-xs text-gray-400">{c.rank}</td>
                    <td className="py-2 font-medium text-gray-800">{c.name}</td>
                    <td className="py-2 text-right text-[#0097A7] font-semibold">{fmt(c.total)}</td>
                    <td className="py-2 text-right">
                      <span className={`font-semibold ${c.conversion_pct >= 50 ? 'text-green-600' : c.conversion_pct >= 25 ? 'text-amber-600' : 'text-red-500'}`}>
                        {c.conversion_pct}%
                      </span>
                    </td>
                    <td className="py-2 text-right text-gray-600">{fmt(c.bonuses)} ₽</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Топ сотрудников */}
      {topStaff.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-4">Топ сотрудников</h3>
          <div className="space-y-2">
            {topStaff.slice(0, 8).map((s, i) => (
              <div key={s.admin_id || i} className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-400 w-5">{i + 1}</span>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
                  {(s.full_name || '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-700 truncate">{s.full_name || '—'}</div>
                  {s.clinic_name && <div className="text-xs text-gray-400 truncate">{s.clinic_name}</div>}
                </div>
                <span className="text-sm font-semibold text-[#0097A7]">{fmt(s.referrals_count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
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
            К выплате: {fmt(Math.round(totalPending))} ₽
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
                      {fmt(Math.round(total))} ₽
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
                        <span className="font-semibold text-gray-800 text-sm">{fmt(b.amount)} ₽</span>
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

function SvcRow({ svc, categories, token, onUpdated }) {
  const a = api(token)
  const [bonus, setBonus] = useState(String(svc.bonus_amount || 0))
  const [cat, setCat] = useState(svc.category === 'Без категории' ? '' : (svc.category || ''))
  const [savingB, setSavingB] = useState(false)
  const [savingC, setSavingC] = useState(false)

  const saveBonus = async () => {
    const amount = parseFloat(bonus)
    if (isNaN(amount) || amount < 0) return
    setSavingB(true)
    try { await a.patch('/manager/services/' + svc.id, { bonus_amount: amount }); onUpdated() }
    catch (_) {} finally { setSavingB(false) }
  }
  const saveCat = async (val) => {
    setCat(val); setSavingC(true)
    try { await a.patch('/manager/services/' + svc.id, { category: val || null }); onUpdated() }
    catch (_) {} finally { setSavingC(false) }
  }
  const changedB = parseFloat(bonus) !== parseFloat(svc.bonus_amount || 0)
  return (
    <tr className="border-b border-gray-50 hover:bg-teal-50/30 transition-colors">
      <td className="px-4 py-3">
        <div className="font-medium text-gray-800 text-sm">{svc.name}</div>
        {svc.code && <div className="text-xs text-gray-400 font-mono">{svc.code}</div>}
      </td>
      <td className="px-3 py-3 w-48">
        <div className="flex items-center gap-1">
          <select value={cat} onChange={e => saveCat(e.target.value)} disabled={savingC}
            className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#0097A7] bg-white disabled:opacity-60">
            <option value="">— без категории —</option>
            {categories.filter(c => c !== 'Без категории').map(c => <option key={c} value={c}>{c.length > 32 ? c.slice(0,30)+'…' : c}</option>)}
          </select>
          {savingC && <span className="text-xs text-gray-400">⏳</span>}
        </div>
      </td>
      <td className="px-3 py-3 text-sm text-gray-500 text-right whitespace-nowrap">
        {svc.original_price ? fmt(svc.original_price)+' ₽' : '—'}
      </td>
      <td className="px-3 py-3 w-36">
        <div className="flex items-center gap-1">
          <input type="number" min="0" step="50" value={bonus}
            onChange={e => setBonus(e.target.value)}
            onBlur={() => changedB && saveBonus()}
            onKeyDown={e => e.key === 'Enter' && changedB && saveBonus()}
            className={'w-20 border rounded-lg px-2 py-1 text-sm text-right font-semibold focus:outline-none transition ' +
              (parseFloat(bonus) > 0 ? 'border-teal-300 text-teal-700 bg-teal-50' : 'border-gray-200 text-gray-400 bg-white')} />
          <span className="text-xs text-gray-400">₽</span>
          {savingB && <span className="text-xs text-gray-400">⏳</span>}
          {changedB && !savingB && (
            <button onClick={saveBonus} className="text-xs bg-teal-600 text-white rounded px-1.5 py-0.5 hover:bg-teal-700">✓</button>
          )}
        </div>
      </td>
    </tr>
  )
}

function CatAccordion({ cat, token, categories }) {
  const a = api(token)
  const [open, setOpen] = useState(false)
  const [svcs, setSvcs] = useState(null)
  const [loading, setLoading] = useState(false)
  const [bonusInput, setBonusInput] = useState('')
  const [applying, setApplying] = useState(false)
  const [showBonusBar, setShowBonusBar] = useState(false)
  const [loadTick, setLoadTick] = useState(0)

  const fetchSvcs = useCallback(async () => {
    setLoading(true); setSvcs(null)
    try {
      const catParam = cat.category === 'Без категории' ? '' : cat.category
      const r = await a.get('/manager/services/', { category: catParam })
      setSvcs(Array.isArray(r.data) ? r.data : [])
    } catch (_) { setSvcs([]) } finally { setLoading(false) }
  }, [cat.category, token])

  useEffect(() => { if (open || loadTick > 0) fetchSvcs() }, [open, loadTick])

  const handleToggle = () => setOpen(v => !v)
  const handleSetAll = async () => {
    const amount = parseFloat(bonusInput)
    if (isNaN(amount) || amount < 0) return
    setApplying(true)
    try {
      await a.post('/manager/services/set-category-bonus', { category: cat.category, bonus_amount: amount })
      setShowBonusBar(false); setBonusInput(''); setLoadTick(t => t + 1)
    } catch (_) { alert('Ошибка') } finally { setApplying(false) }
  }
  const hasBonus = cat.bonus_count > 0
  return (
    <div className={'rounded-xl border overflow-hidden ' + (hasBonus ? 'border-teal-200' : 'border-gray-100')}>
      <div className="flex items-center gap-2 px-4 py-3 bg-white">
        <button onClick={handleToggle} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <span className="text-gray-400 text-xs flex-shrink-0">{open ? '▼' : '▶'}</span>
          <span className={'text-sm font-semibold truncate ' + (hasBonus ? 'text-gray-800' : 'text-gray-500')}>{cat.category}</span>
          <span className="text-xs text-gray-400 flex-shrink-0">{cat.total}</span>
          {hasBonus && <span className="bg-teal-100 text-teal-700 text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0">✓ {cat.bonus_count}</span>}
        </button>
        <button onClick={() => setShowBonusBar(v => !v)}
          className="flex-shrink-0 text-xs border border-gray-200 text-gray-500 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition">
          Бонус всем
        </button>
      </div>
      {showBonusBar && (
        <div className="px-4 py-2 flex items-center gap-2 bg-amber-50 border-t border-amber-100">
          <span className="text-xs text-amber-700 font-medium">Бонус для {cat.total} услуг:</span>
          <input type="number" min="0" step="50" placeholder="0" value={bonusInput}
            onChange={e => setBonusInput(e.target.value)}
            className="w-20 border border-amber-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none bg-white" />
          <span className="text-xs text-gray-500">₽</span>
          <button onClick={handleSetAll} disabled={applying || !bonusInput}
            className="text-xs bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 font-medium">
            {applying ? '⏳' : 'Применить'}
          </button>
          <button onClick={() => setShowBonusBar(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
        </div>
      )}
      {open && (
        <div className="border-t border-gray-100 overflow-x-auto">
          {loading ? (
            <div className="px-4 py-3 text-sm text-gray-400">Загрузка...</div>
          ) : (
            <table className="w-full min-w-[520px]" key={loadTick}>
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide">
                  <th className="text-left px-4 py-2 font-medium">Название</th>
                  <th className="text-left px-3 py-2 font-medium w-48">Категория</th>
                  <th className="text-right px-3 py-2 font-medium">Цена МИС</th>
                  <th className="text-left px-3 py-2 font-medium">Бонус</th>
                </tr>
              </thead>
              <tbody>
                {(svcs || []).length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-4 text-center text-gray-400 text-xs">Нет услуг</td></tr>
                ) : (svcs || []).map(s => (
                  <SvcRow key={s.id} svc={s} categories={categories} token={token} onUpdated={() => setLoadTick(t => t + 1)} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function ServicesSection({ token }) {
  const a = api(token)
  const [bonused, setBonused] = useState(null)
  const [allCats, setAllCats] = useState([])
  const [catNames, setCatNames] = useState([])
  const [loadingCats, setLoadingCats] = useState(true)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', code: '', category: '', bonus_amount: '', original_price: '', clinic_id: '' })
  const [saving, setSaving] = useState(false)
  const [rev, setRev] = useState(0)
  const [clinicsList, setClinicsList] = useState([])
  const [filterClinic, setFilterClinic] = useState('')

  const reload = useCallback(async () => {
    setBonused(null); setLoadingCats(true)
    try {
      const clinicParams = filterClinic ? { clinic_id: filterClinic } : {}
      const [br, cr, clr] = await Promise.all([
        a.get('/manager/services/', { has_bonus: true, ...clinicParams }),
        a.get('/manager/services/categories', clinicParams),
        a.get('/manager/clinics/'),
      ])
      setBonused(Array.isArray(br.data) ? br.data : [])
      const cats = Array.isArray(cr.data) ? cr.data : []
      setAllCats(cats)
      setCatNames(cats.map(c => c.category).filter(Boolean))
      setClinicsList(Array.isArray(clr.data) ? clr.data : [])
    } catch (_) { setBonused([]); setAllCats([]) } finally { setLoadingCats(false) }
  }, [token, filterClinic])

  useEffect(() => { reload() }, [token, rev, filterClinic])

  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await a.get('/manager/services/', { search: search.trim() })
        setSearchResults(Array.isArray(r.data) ? r.data : [])
      } catch (_) { setSearchResults([]) } finally { setSearching(false) }
    }, 350)
    return () => clearTimeout(t)
  }, [search, token])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      await a.post('/manager/services/', {
        name: form.name.trim(), code: form.code.trim() || null,
        category: form.category || null,
        bonus_amount: parseFloat(form.bonus_amount) || 0,
        original_price: form.original_price ? parseFloat(form.original_price) : null,
        clinic_id: form.clinic_id || null,
      })
      setShowCreate(false)
      setForm({ name: '', code: '', category: '', bonus_amount: '', original_price: '', clinic_id: '' })
      setRev(r => r + 1)
    } catch (ex) { alert(ex?.response?.data?.detail || 'Ошибка') } finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Услуги</h2>
          {!loadingCats && allCats.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">{allCats.reduce((s,c) => s+c.total, 0).toLocaleString('ru')} услуг · {allCats.length} категорий</p>
          )}
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
          <span className="material-symbols-outlined text-[18px]">add</span>
          Добавить
        </button>
      </div>
      {clinicsList.length > 1 && (
        <div className="mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-gray-400">local_hospital</span>
          <select value={filterClinic} onChange={e => setFilterClinic(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0097A7]">
            <option value="">Все клиники</option>
            {clinicsList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {/* Блок "С бонусом" */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-[18px] text-teal-600" style={{fontVariationSettings:"'FILL' 1"}}>stars</span>
          <span className="text-sm font-bold text-gray-800">Услуги с бонусом</span>
          {bonused !== null && <span className="bg-teal-100 text-teal-700 text-xs font-bold px-2 py-0.5 rounded-full">{bonused.length}</span>}
        </div>
        <div className="bg-white rounded-2xl border border-teal-200 shadow-sm overflow-x-auto">
          {bonused === null ? (
            <div className="px-4 py-4 text-sm text-gray-400">Загрузка...</div>
          ) : bonused.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-400 text-sm">
              <span className="material-symbols-outlined text-3xl block mb-2 text-gray-300">star_border</span>
              Ни одна услуга не имеет бонуса.<br />Нажмите «Бонус всем» в категории ниже или создайте услугу с бонусом вручную.
            </div>
          ) : (
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="bg-teal-50 text-xs text-teal-700 uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5 font-semibold">Услуга</th>
                  <th className="text-left px-3 py-2.5 font-semibold w-48">Категория</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Цена</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Бонус</th>
                </tr>
              </thead>
              <tbody>
                {bonused.map(s => (
                  <SvcRow key={s.id} svc={s} categories={catNames} token={token} onUpdated={() => setRev(r => r+1)} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Поиск */}
      <div className="mb-4">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-gray-400 text-[18px]">search</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию или коду..."
            className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>
      </div>

      {search.trim() ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
          {searching ? (
            <div className="px-4 py-4 text-sm text-gray-400">Поиск...</div>
          ) : !searchResults ? null : searchResults.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-400 text-sm">Ничего не найдено</div>
          ) : (
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5 font-medium">Услуга</th>
                  <th className="text-left px-3 py-2.5 font-medium w-48">Категория</th>
                  <th className="text-right px-3 py-2.5 font-medium">Цена</th>
                  <th className="text-left px-3 py-2.5 font-medium">Бонус</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map(s => (
                  <SvcRow key={s.id} svc={s} categories={catNames} token={token} onUpdated={() => setRev(r => r+1)} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Категории МИС ({allCats.length})
          </p>
          {loadingCats ? <Spinner /> : (
            <div className="space-y-2" key={rev}>
              {allCats.map(cat => (
                <CatAccordion key={cat.category} cat={cat} token={token} categories={catNames} />
              ))}
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">Новая услуга</h2>
              <button onClick={() => setShowCreate(false)}><span className="material-symbols-outlined text-gray-400">close</span></button>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Название *</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Код (МИС)</label>
                  <input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Бонус (₽)</label>
                  <input type="number" min="0" step="0.01" value={form.bonus_amount}
                    onChange={e => setForm(p => ({ ...p, bonus_amount: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Категория</label>
                  <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]">
                    <option value="">— без категории —</option>
                    {catNames.filter(c => c !== 'Без категории').map(c => <option key={c} value={c}>{c.length > 28 ? c.slice(0,26)+'…' : c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Цена МИС (₽)</label>
                  <input type="number" min="0" step="0.01" value={form.original_price}
                    onChange={e => setForm(p => ({ ...p, original_price: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]" />
                </div>
              </div>
              {clinicsList.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Клиника</label>
                  <select value={form.clinic_id} onChange={e => setForm(p => ({ ...p, clinic_id: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0097A7]">
                    <option value="">— Все клиники —</option>
                    {clinicsList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2.5 text-sm text-gray-600">Отмена</button>
                <button type="submit" disabled={saving}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#0097A7,#006173)' }}>
                  {saving ? 'Создание...' : 'Создать'}
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
                  <div className="font-bold text-gray-800">{fmt(sub.amount_per_period)} ₽</div>
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
              <div className="text-2xl font-bold text-green-600">{fmt(summary?.total_paid)} ₽</div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-5 text-center">
              <div className="text-xs text-gray-400 mb-1">К оплате</div>
              <div className="text-2xl font-bold text-amber-600">{fmt(summary?.total_due)} ₽</div>
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
                    <td className="px-4 py-3 font-semibold text-gray-800">{fmt(inv.amount)} ₽</td>
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
                {fmt(p.price_monthly || p.prices?.monthly || p.monthly_price)} ₽
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
                  <div className="text-2xl font-bold text-[#0097A7] mb-1">{fmt(prices[key])} ₽</div>
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
                    <td className="px-4 py-3 text-gray-700">{s.price ? `${fmt(s.price)} ₽` : '—'}</td>
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
  const [moreOpen, setMoreOpen] = useState(false)
  const [activeModules, setActiveModules] = useState(null)
  const [isDark, setIsDark] = useState(() => localStorage.getItem('adminTheme') === 'dark')
  const toggleDark = () => {
    const next = !isDark
    setIsDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('adminTheme', next ? 'dark' : 'light')
  }

  useEffect(() => {
    if (!adminToken) return
    axios.get(API_BASE + '/modules/active-keys', { headers: { Authorization: `Bearer ${adminToken}` } })
      .then(r => setActiveModules(new Set(Array.isArray(r.data) ? r.data : [])))
      .catch(() => {})
  }, [adminToken])

  const visibleNav = NAV.filter(item => {
    const m = activeModules
    if (item.key === 'ads')          return !m || m.has('ads_basic') || m.has('ads_agency')
    if (item.key === 'ai_analytics') return !m || m.has('ai_analytics_basic') || m.has('ai_analytics_pro')
    return true
  })

  const handleNav = (key) => {
    setActiveSection(key)
    setMoreOpen(false)
  }

  const renderSection = () => {
    switch (activeSection) {
      case 'home':      return <HomeDashboard token={adminToken} onNavigate={handleNav} />
      case 'staff':     return <StaffSection token={adminToken} />
      case 'doctors':   return <Suspense fallback={null}><DoctorsSection token={adminToken} /></Suspense>
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
      case 'ads':          return <Suspense fallback={null}><AdsSection token={adminToken} /></Suspense>
      case 'ai_analytics': return <Suspense fallback={null}><AISection token={adminToken} isSuperAdmin={true} /></Suspense>
      case 'ext_doctors': return <ExtDoctorsSection token={adminToken} />
      case 'recruiters':  return <RecruiterSection token={adminToken} />
      case 'settings':  return <SettingsSection token={adminToken} user={user} />
      case 'branding': return <Suspense fallback={null}><BrandingSection token={adminToken} /></Suspense>
      case 'cms':      return <Suspense fallback={null}><CMSPagesSection token={adminToken} /></Suspense>
      case 'acts':     return <Suspense fallback={null}><ActsSection token={adminToken} isSuperAdmin={false} /></Suspense>
      case 'reviews':  return <Suspense fallback={null}><ReviewsSection token={adminToken} /></Suspense>
      case 'clinic_invoices': return <Suspense fallback={null}><InterClinicInvoicesSection isSupervisor={true} token={adminToken} /></Suspense>
      case 'requisites':      return <Suspense fallback={null}><RequisitesSection token={adminToken} /></Suspense>
      case 'calls':           return <Suspense fallback={null}><CallRulesSection adminToken={adminToken} tenantId={user?.tenant_id} /></Suspense>
      case 'ai_knowledge':    return <Suspense fallback={null}><AIKnowledgeSection token={adminToken} /></Suspense>
      case 'platform_invoices': return <Suspense fallback={null}><PlatformInvoicesSection adminToken={adminToken} /></Suspense>
      case 'calendar':          return <Suspense fallback={null}><AppointmentsCalendarSection token={adminToken} /></Suspense>
      case 'apt_stats':         return <Suspense fallback={null}><AppointmentsStatsSection token={adminToken} /></Suspense>
      default: return null
    }
  }

  const activeNav = visibleNav.find(n => n.key === activeSection)
  const userName  = user?.full_name || user?.username || 'Администратор'
  const userInit  = userName[0].toUpperCase()

  // 5 bottom-nav items + «Ещё»
  const BOTTOM_KEYS = ['home', 'referrals', 'analytics', 'services', 'bonuses']
  const bottomItems = BOTTOM_KEYS.map(k => visibleNav.find(n => n.key === k)).filter(Boolean)
  const moreItems   = visibleNav.filter(n => !BOTTOM_KEYS.includes(n.key))

  return (
    <div className="flex min-h-screen font-sans bg-[#F0F4F8] dark:bg-gray-900 sv-cabinet">
      <style id="sv-dark-css">{`
        html.dark .sv-cabinet .bg-white { background-color: #1e293b !important; }
        html.dark .sv-cabinet .bg-gray-50 { background-color: #1a2740 !important; }
        html.dark .sv-cabinet .bg-gray-100 { background-color: #1e293b !important; }
        html.dark .sv-cabinet .text-gray-900 { color: #f1f5f9 !important; }
        html.dark .sv-cabinet .text-gray-800 { color: #f1f5f9 !important; }
        html.dark .sv-cabinet .text-gray-700 { color: #94a3b8 !important; }
        html.dark .sv-cabinet .text-gray-600 { color: #94a3b8 !important; }
        html.dark .sv-cabinet .text-gray-500 { color: #64748b !important; }
        html.dark .sv-cabinet .text-gray-400 { color: #475569 !important; }
        html.dark .sv-cabinet .border-gray-100 { border-color: #334155 !important; }
        html.dark .sv-cabinet .border-gray-200 { border-color: #334155 !important; }
        html.dark .sv-cabinet .border-b { border-color: #334155 !important; }
        html.dark .sv-cabinet .border-t { border-color: #334155 !important; }
        html.dark .sv-cabinet .shadow-sm { box-shadow: 0 1px 4px rgba(0,0,0,.5) !important; }
        html.dark .sv-cabinet .bg-red-50 { background-color: rgba(239,68,68,.1) !important; }
        html.dark .sv-cabinet .border-red-200 { border-color: rgba(239,68,68,.3) !important; }
        html.dark .sv-cabinet .text-red-600 { color: #f87171 !important; }
        html.dark .sv-cabinet .bg-amber-100 { background-color: rgba(245,158,11,.15) !important; }
        html.dark .sv-cabinet .text-amber-700 { color: #fbbf24 !important; }
        html.dark .sv-cabinet .bg-green-50 { background-color: rgba(16,185,129,.1) !important; }
        html.dark .sv-cabinet .bg-green-100 { background-color: rgba(16,185,129,.1) !important; }
        html.dark .sv-cabinet .text-green-600 { color: #4ade80 !important; }
        html.dark .sv-cabinet .text-green-700 { color: #4ade80 !important; }
        html.dark .sv-cabinet .bg-blue-50 { background-color: rgba(59,130,246,.1) !important; }
        html.dark .sv-cabinet .bg-blue-100 { background-color: rgba(59,130,246,.1) !important; }
        html.dark .sv-cabinet .text-blue-700 { color: #60a5fa !important; }
        html.dark .sv-cabinet input { background: #1e293b !important; color: #f1f5f9 !important; border-color: #475569 !important; }
        html.dark .sv-cabinet select { background: #1e293b !important; color: #f1f5f9 !important; border-color: #475569 !important; }
        html.dark .sv-cabinet textarea { background: #1e293b !important; color: #f1f5f9 !important; border-color: #475569 !important; }
        html.dark .sv-cabinet thead tr { background-color: #1a2740 !important; }
        html.dark .sv-cabinet tbody tr { border-color: #334155 !important; }
        html.dark .sv-cabinet label { color: #94a3b8 !important; }
      `}</style>
      
      {/* ════════════════════════════════════════
          DESKTOP SIDEBAR
          ════════════════════════════════════════ */}
      <aside className="hidden md:flex flex-col w-64 flex-shrink-0 sticky top-0 h-screen"
        style={{ background: 'linear-gradient(180deg,#0a1628 0%,#0d2040 100%)' }}>

        {/* Logo */}
        <div className="px-5 pt-7 pb-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#0097A7,#00c4d9)' }}>
            <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>health_and_safety</span>
          </div>
          <div>
            <div className="text-[15px] font-bold text-white leading-tight tracking-tight">КлиникСеть</div>
            <div className="text-[10px] text-[#0097A7] uppercase tracking-widest mt-0.5 font-semibold">Franchise Admin</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 overflow-y-auto space-y-0.5 pb-4">
          {visibleNav.map(item => {
            const isActive = activeSection === item.key
            return (
              <button key={item.key} onClick={() => handleNav(item.key)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition-all duration-150 group"
                style={isActive ? {
                  background: 'linear-gradient(90deg,rgba(0,151,167,0.25),rgba(0,151,167,0.08))',
                  color: '#00d4eb',
                } : { color: '#8ba0b8' }}>
                <span className="material-symbols-outlined text-[19px] flex-shrink-0 transition-colors"
                  style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0",
                    color: isActive ? '#00d4eb' : undefined }}>
                  {item.icon}
                </span>
                <span className={`flex-1 leading-none font-${isActive ? 'semibold' : 'medium'}`}>{item.label}</span>
                {isActive && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#0097A7' }} />}
              </button>
            )
          })}
        </nav>

        {/* User */}
        <div className="px-3 pb-4 mt-auto">
          <div className="rounded-2xl p-3 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#0097A7,#005F6B)' }}>
              {userInit}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-white truncate leading-tight">{userName}</div>
              <div className="text-[10px] mt-0.5" style={{ color: '#0097A7' }}>Владелец франшизы</div>
            </div>
            <button onClick={onLogout} title="Выйти"
              className="text-[#4a6080] hover:text-white transition flex-shrink-0 p-1 rounded-lg hover:bg-white/10">
              <span className="material-symbols-outlined text-[18px]">logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ════════════════════════════════════════
          MAIN AREA
          ════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* ── MOBILE TOP HEADER ── */}
        <header className="md:hidden sticky top-0 z-20 flex items-center gap-3 px-4 py-3 border-b border-white/10"
          style={{ background: 'linear-gradient(135deg,#0a1628,#0d2040)', backdropFilter: 'blur(12px)' }}>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#0097A7' }}>КлиникСеть</div>
            <div className="text-white font-bold text-base leading-tight truncate">
              {activeNav?.label || 'Обзор'}
            </div>
          </div>
          <button onClick={toggleDark}
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.08)' }}>
            <span className="material-symbols-outlined text-[18px] text-white">{isDark ? 'light_mode' : 'dark_mode'}</span>
          </button>
          <button onClick={onLogout}
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.08)' }}>
            <span className="material-symbols-outlined text-[18px] text-white">logout</span>
          </button>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#0097A7,#005F6B)' }}>
            {userInit}
          </div>
        </header>

        {/* ── DESKTOP TOP BAR ── */}
        <header className="hidden md:flex items-center justify-between px-8 py-4 bg-white/80 sticky top-0 z-10 border-b border-gray-100"
          style={{ backdropFilter: 'blur(12px)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,rgba(0,151,167,0.12),rgba(0,151,167,0.05))' }}>
              <span className="material-symbols-outlined text-[18px]" style={{ color: '#0097A7', fontVariationSettings:"'FILL' 1" }}>
                {activeNav?.icon || 'dashboard'}
              </span>
            </div>
            <h1 className="font-bold text-gray-900 text-lg tracking-tight">{activeNav?.label || 'Обзор'}</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-semibold text-gray-800 leading-tight">{userName}</div>
              <div className="text-[11px] text-gray-400">Владелец франшизы</div>
            </div>
            <button onClick={toggleDark}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 transition"
              title={isDark ? 'Светлая тема' : 'Тёмная тема'}>
              <span className="material-symbols-outlined text-[19px]">{isDark ? 'light_mode' : 'dark_mode'}</span>
            </button>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white shadow-sm"
              style={{ background: 'linear-gradient(135deg,#0097A7,#005F6B)' }}>
              {userInit}
            </div>
          </div>
        </header>

        {/* ── PAGE CONTENT ── */}
        <main className="flex-1 px-4 md:px-8 py-5 md:py-7 pb-24 md:pb-8 w-full max-w-5xl mx-auto">
          {renderSection()}
        </main>
      </div>

      {/* ════════════════════════════════════════
          MOBILE BOTTOM NAV
          ════════════════════════════════════════ */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch"
        style={{
          background: 'rgba(10,22,40,0.97)',
          backdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.3)',
        }}>
        {bottomItems.map(item => {
          const isActive = activeSection === item.key
          return (
            <button key={item.key} onClick={() => handleNav(item.key)}
              className="flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] gap-0.5 transition-all duration-150 relative">
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                  style={{ background: '#0097A7' }} />
              )}
              <span className="material-symbols-outlined text-[22px] transition-all"
                style={{
                  color: isActive ? '#00d4eb' : '#4a6080',
                  fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0",
                }}>
                {item.icon}
              </span>
              <span className="text-[10px] font-semibold transition-colors leading-none"
                style={{ color: isActive ? '#00d4eb' : '#4a6080' }}>
                {item.label}
              </span>
            </button>
          )
        })}
        {/* "Ещё" button */}
        <button onClick={() => setMoreOpen(true)}
          className="flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] gap-0.5 transition-all duration-150">
          <span className="material-symbols-outlined text-[22px]" style={{ color: '#4a6080' }}>more_horiz</span>
          <span className="text-[10px] font-semibold leading-none" style={{ color: '#4a6080' }}>Ещё</span>
        </button>
      </nav>

      {/* ════════════════════════════════════════
          MOBILE "ЕЩЁ" DRAWER
          ════════════════════════════════════════ */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMoreOpen(false)} />
          <div className="relative rounded-t-3xl overflow-hidden"
            style={{ background: 'linear-gradient(180deg,#0d2040,#0a1628)', maxHeight: '80vh' }}>
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-white/10">
              <span className="text-white font-bold text-base">Все разделы</span>
              <button onClick={() => setMoreOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.1)' }}>
                <span className="material-symbols-outlined text-white text-[18px]">close</span>
              </button>
            </div>
            {/* Grid of items */}
            <div className="overflow-y-auto px-4 py-4 grid grid-cols-3 gap-2"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
              {moreItems.map(item => {
                const isActive = activeSection === item.key
                return (
                  <button key={item.key} onClick={() => handleNav(item.key)}
                    className="flex flex-col items-center gap-2 p-3 rounded-2xl transition-all"
                    style={{
                      background: isActive
                        ? 'linear-gradient(135deg,rgba(0,151,167,0.3),rgba(0,151,167,0.15))'
                        : 'rgba(255,255,255,0.06)',
                      border: isActive ? '1px solid rgba(0,151,167,0.4)' : '1px solid rgba(255,255,255,0.08)',
                    }}>
                    <span className="material-symbols-outlined text-[24px]"
                      style={{
                        color: isActive ? '#00d4eb' : '#8ba0b8',
                        fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0",
                      }}>
                      {item.icon}
                    </span>
                    <span className="text-[11px] font-semibold text-center leading-tight"
                      style={{ color: isActive ? '#00d4eb' : '#8ba0b8' }}>
                      {item.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
