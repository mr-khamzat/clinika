/**
 * ========================================
 * Создание направления · Premium Redesign
 * ========================================
 * Дизайн-система: design-preview-2 (CSS-tokens, оттенки accent/bg-1/surface/border/fg/…).
 * Эталон: DoctorBriefingPanel.jsx, DoctorLayout.jsx (Card + Card.Header + MIcon + Hint).
 *
 * Бизнес-логика API не изменена:
 *   GET /clinics
 *   GET /clinics/{id}/services
 *   GET /clinics/{id}/schedule
 *   GET /mis/doctors
 *   POST /referrals
 *   GET/POST /manager/referral-templates[/{id}/use]
 *   verifyPatientInMis()
 *
 * НОВОЕ (рефактор 2026-05-20):
 *   - Логика и JSX вынесены во внутренний компонент `<CreateReferralForm />`.
 *   - `<CreateReferral />` — это страничный wrapper (Page + PageHeader),
 *     который остаётся доступным по маршруту `/arc/create` (обратная совместимость).
 *   - `<CreateReferralForm />` экспортируется именованно и используется
 *     в кабинете врача как inline-модалка (DoctorLayout.jsx, ReferralsPage)
 *     и в перспективе — в OperationalCabinet / других кабинетах.
 *
 *   Props `<CreateReferralForm />`:
 *     mode          — 'page' | 'modal' (по умолч. 'modal')
 *                     'page'  — submit-кнопка фиксированная снизу (как раньше)
 *                     'modal' — submit-кнопка inline, в конце формы
 *     initialPhone  — префилл телефона пациента
 *     initialName   — префилл ФИО пациента
 *     onSuccess(id) — колбэк после успешного создания (получает id направления);
 *                     если не задан — fallback на window.location.assign('/<SLUG>/qr/{id}')
 *     onClose       — колбэк отмены/закрытия модалки (опционален)
 *
 *   ВАЖНО: внутренний компонент НЕ использует useNavigate / useSearchParams —
 *   это нужно, чтобы его можно было рендерить в AdminRoot (вне BrowserRouter),
 *   см. memory feedback_admin_root_no_router.
 * ========================================
 */
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getClinics, getClinicServices, createReferral, verifyPatientInMis } from '../api'
import api from '../api'
import { SLUG } from '../config'
import useAuthStore from '../store/auth'
import {
  Page,
  PageHeader,
  Card,
  Chip,
  Button,
  Modal,
  useToast,
} from '../design'

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

// ─────────────────────────────────────────────────────────────────────
// Утилиты расписания / форматирования
// ─────────────────────────────────────────────────────────────────────
function getAvailableDates(schedule) {
  const activeDays = new Set(schedule.filter(d => d.is_active).map(d => d.day_of_week))
  const dates = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 0; i < 30 && dates.length < 14; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const dow = (d.getDay() + 6) % 7
    if (activeDays.has(dow)) {
      dates.push({ date: d, dow, schedule: schedule.find(s => s.day_of_week === dow) })
    }
  }
  return dates
}

function formatDateShort(d) {
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

// ─────────────────────────────────────────────────────────────────────
// Локальные шаблоны (в localStorage)
// ─────────────────────────────────────────────────────────────────────
const TEMPLATES_KEY = 'clinika_referral_templates'
function loadTemplates() {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY)) || [] } catch { return [] }
}
function saveTemplates(tpls) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(tpls))
}

// ─────────────────────────────────────────────────────────────────────
// Микрокомпоненты UI
// ─────────────────────────────────────────────────────────────────────
function MIcon({ name, size = 18, fill = false, color }) {
  return (
    <span
      className="material-symbols-outlined"
      style={{
        fontSize: size,
        color,
        fontVariationSettings: fill ? "'FILL' 1" : "'FILL' 0",
        lineHeight: 1,
      }}
    >
      {name}
    </span>
  )
}

// Иконка-«пилюля» слева от заголовка карточки — в стиле Hint из DoctorLayout
function SectionIcon({ icon, tone = 'accent' }) {
  const tones = {
    accent: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
    muted:  { bg: 'var(--bg-2)',        fg: 'var(--fg-2)' },
  }
  const t = tones[tone] || tones.accent
  return (
    <span
      className="grid place-items-center flex-shrink-0"
      style={{ width: 36, height: 36, borderRadius: 10, background: t.bg, color: t.fg }}
    >
      <MIcon name={icon} size={18} fill />
    </span>
  )
}

// Лейбл «caps» над полем — единый стиль для всех инпутов
function FieldLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--fg-3)',
        marginBottom: 6,
        marginLeft: 2,
      }}
    >
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Стили инпутов через CSS-токены (заменяют inputCls/selectCls на hex'ах)
// ─────────────────────────────────────────────────────────────────────
const FIELD_BASE = {
  width: '100%',
  padding: '12px 14px',
  background: 'var(--bg-1)',
  color: 'var(--fg)',
  fontSize: 14,
  border: '1px solid var(--border)',
  borderRadius: 12,
  outline: 'none',
  transition: 'border-color .15s, background .15s',
}

// Хелпер фокуса — выделяем var(--accent)
function focusOn(e) {
  e.target.style.borderColor = 'var(--accent)'
  e.target.style.background = 'var(--surface)'
}
function focusOff(e) {
  e.target.style.borderColor = 'var(--border)'
  e.target.style.background = 'var(--bg-1)'
}

// ─────────────────────────────────────────────────────────────────────
// Внутренний компонент формы — переиспользуется в page + modal.
// НЕ использует useNavigate / useSearchParams (можно рендерить в AdminRoot).
// ─────────────────────────────────────────────────────────────────────
export function CreateReferralForm({
  mode = 'modal',
  initialPhone = '',
  initialName  = '',
  onSuccess,
  onClose,
}) {
  // Замена alert/prompt на Toast и Modal
  const { toast } = useToast()
  // Modal-prompt для названия шаблона (заменяет нативный prompt)
  const [tplPromptOpen, setTplPromptOpen] = useState(false)
  const [tplPromptValue, setTplPromptValue] = useState('')
  const [clinics, setClinics] = useState([])
  const [allClinics, setAllClinics] = useState([])
  const [services, setServices] = useState([])
  const [schedule, setSchedule] = useState([])
  const [availableDates, setAvailableDates] = useState([])
  const [loadingServices, setLoadingServices] = useState(false)
  const [form, setForm] = useState({
    from_clinic_id: '', to_clinic_id: '', service_id: '',
    patient_phone: initialPhone || '',
    patient_name:  initialName  || '',
    mis_patient_id: null, mis_doctor_id: null,
    notes: '', appointment_date: '', appointment_time: ''
  })
  const [loading, setLoading] = useState(false)
  const [templates, setTemplates] = useState(loadTemplates)
  // Глава 4 — серверные шаблоны (CRUD через /manager/referral-templates)
  const [serverTemplates, setServerTemplates] = useState([])
  useEffect(() => {
    api.get('/manager/referral-templates').then(r => {
      setServerTemplates(Array.isArray(r.data) ? r.data : [])
    }).catch(() => setServerTemplates([]))
  }, [])
  const applyServerTemplate = async (tpl) => {
    try {
      const r = await api.post(`/manager/referral-templates/${tpl.id}/use`)
      const payload = r.data?.payload || {}
      setForm(f => ({
        ...f,
        notes:     payload.notes || f.notes,
        service_id: payload.service_id || f.service_id,
      }))
      // Если в payload указан to_clinic_id — переключаем клинику
      if (payload.to_clinic_id) handleToClinicChange(payload.to_clinic_id)
    } catch {}
  }
  const [misPatient, setMisPatient] = useState(null)
  const [misLinked, setMisLinked] = useState(false)
  const [misChecking, setMisChecking] = useState(false)
  const [misDoctors, setMisDoctors] = useState([])
  const [loadingDoctors, setLoadingDoctors] = useState(false)
  const [serviceCategory, setServiceCategory] = useState('')
  const [serviceSearch, setServiceSearch] = useState('')
  const { user } = useAuthStore()
  const isManager = user?.role === 'manager' && !user?.clinic_id

  useEffect(() => {
    getClinics().then(r => {
      setAllClinics(r.data)
      setClinics(r.data.filter(c => c.id !== user?.clinic_id))
    })
  }, [])

  const handleToClinicChange = async (clinicId) => {
    setForm(f => ({ ...f, to_clinic_id: clinicId, service_id: '', appointment_date: '', appointment_time: '', mis_doctor_id: null }))
    setServices([])
    setSchedule([])
    setAvailableDates([])
    setMisDoctors([])
    setServiceCategory('')
    setServiceSearch('')
    if (!clinicId) return
    // Загрузить врачей МИС для этой клиники
    const clinicData = allClinics.find(c => c.id === clinicId)
    if (clinicData?.mis_id) {
      setLoadingDoctors(true)
      try {
        const dr = await api.get('/mis/doctors')
        const doctors = Array.isArray(dr.data?.doctors) ? dr.data.doctors : []
        const filtered = doctors.filter(d => d.clinic_mis_id === clinicData.mis_id || (Array.isArray(d.clinic) && d.clinic.includes(String(clinicData.mis_id))))
        setMisDoctors(filtered.length ? filtered : doctors)
      } catch { setMisDoctors([]) }
      finally { setLoadingDoctors(false) }
    }
    setLoadingServices(true)
    try {
      const [svcRes, schedRes] = await Promise.all([
        getClinicServices(clinicId),
        api.get(`/clinics/${clinicId}/schedule`),
      ])
      setServices(Array.isArray(svcRes.data) ? svcRes.data : [])
      const sched = Array.isArray(schedRes.data) ? schedRes.data : []
      setSchedule(sched)
      setAvailableDates(getAvailableDates(sched))
    } catch {
      setServices([])
    } finally {
      setLoadingServices(false)
    }
  }

  const handleFromClinicChange = (clinicId) => {
    setForm(f => ({ ...f, from_clinic_id: clinicId, to_clinic_id: '', service_id: '', appointment_date: '', appointment_time: '' }))
    setServices([])
    setSchedule([])
    setAvailableDates([])
    setClinics(allClinics.filter(c => c.id !== clinicId))
  }

  const selectedDate = form.appointment_date
    ? availableDates.find(d => d.date.toISOString().slice(0, 10) === form.appointment_date)
    : null

  // Навигация на /qr/{id} — fallback, если onSuccess не передан.
  // Используем window.location.assign (а не useNavigate), чтобы форма
  // работала и в AdminRoot (вне BrowserRouter).
  const goToQr = (refId) => {
    try { window.location.assign('/' + SLUG + '/qr/' + refId) }
    catch { window.location.href = '/' + SLUG + '/qr/' + refId }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = {
        to_clinic_id: form.to_clinic_id,
        service_id: form.service_id,
        patient_phone: form.patient_phone,
        patient_name: form.patient_name || null,
        mis_patient_id: form.mis_patient_id || null,
        mis_doctor_id: form.mis_doctor_id || null,
        notes: form.notes || null,
      }
      if (isManager) payload.from_clinic_id = form.from_clinic_id
      if (form.appointment_date && form.appointment_time) {
        payload.appointment_at = `${form.appointment_date}T${form.appointment_time}:00`
      }
      const res = await createReferral(payload)
      if (typeof onSuccess === 'function') {
        onSuccess(res.data.id, res.data)
      } else {
        goToQr(res.data.id)
      }
    } catch (err) {
      toast(err.response?.data?.detail || 'Ошибка создания направления', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Открыть Modal-prompt вместо нативного prompt()
  const handleSaveTemplate = () => {
    setTplPromptValue('')
    setTplPromptOpen(true)
  }

  // Подтверждение ввода названия шаблона из Modal
  const confirmSaveTemplate = () => {
    const name = tplPromptValue.trim()
    if (!name) {
      setTplPromptOpen(false)
      return
    }
    const tpl = { id: Date.now(), name, from_clinic_id: form.from_clinic_id, to_clinic_id: form.to_clinic_id, service_id: form.service_id }
    const updated = [tpl, ...templates]
    setTemplates(updated)
    saveTemplates(updated)
    setTplPromptOpen(false)
  }

  const handleApplyTemplate = (tpl) => {
    setForm(f => ({ ...f, from_clinic_id: tpl.from_clinic_id || f.from_clinic_id, to_clinic_id: tpl.to_clinic_id, service_id: tpl.service_id }))
    if (tpl.to_clinic_id) handleToClinicChange(tpl.to_clinic_id)
  }

  const handleDeleteTemplate = (id) => {
    const updated = templates.filter(t => t.id !== id)
    setTemplates(updated)
    saveTemplates(updated)
  }

  const submitDisabled = loading || !form.to_clinic_id || !form.service_id ||
    !form.patient_phone || !form.patient_name || (isManager && !form.from_clinic_id)

  // Сервисы с фильтром
  const cats = [...new Set(services.map(s => s.category).filter(Boolean))]
  const filteredServices = services.filter(s => {
    if (serviceCategory && s.category !== serviceCategory) return false
    if (serviceSearch && !s.name.toLowerCase().includes(serviceSearch.toLowerCase())) return false
    return true
  })

  // Текущая выбранная услуга (для бейджа с суммой)
  const selectedService = form.service_id ? services.find(s => s.id === form.service_id) : null
  const selectedPayout  = selectedService
    ? (selectedService.referral_payout != null ? selectedService.referral_payout : selectedService.bonus_amount)
    : null

  // Кнопка «Сохранить шаблон» — над формой (видна и в page, и в modal mode).
  // Раньше жила в PageHeader (только page); теперь общая.
  const saveTemplateBtn = (form.to_clinic_id && form.service_id) ? (
    <Button
      variant="secondary"
      size="sm"
      leftIcon={<MIcon name="bookmark_add" size={16} />}
      onClick={handleSaveTemplate}
      title="Сохранить шаблон"
    >
      Шаблон
    </Button>
  ) : null

  return (
    <>
      {/* Modal-prompt для названия шаблона направления (вложенная модалка). */}
      <Modal
        open={tplPromptOpen}
        onClose={() => setTplPromptOpen(false)}
        title="Название шаблона"
        size="sm"
        actions={
          <>
            <Button variant="secondary" onClick={() => setTplPromptOpen(false)}>Отмена</Button>
            <Button onClick={confirmSaveTemplate}>Сохранить</Button>
          </>
        }
      >
        <input
          autoFocus
          value={tplPromptValue}
          onChange={e => setTplPromptValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') confirmSaveTemplate() }}
          onFocus={focusOn}
          onBlur={focusOff}
          placeholder="Например: Терапевт → УЗИ"
          style={FIELD_BASE}
        />
      </Modal>

      {/* Серверные шаблоны (Глава 4 — общие на тенант / клинику) */}
      {serverTemplates.length > 0 && (
        <div
          className="flex gap-2 overflow-x-auto pb-2 mb-3"
          style={{ scrollbarWidth: 'none' }}
        >
          {serverTemplates.map(tpl => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => applyServerTemplate(tpl)}
              title={tpl.description || tpl.name}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 flex-shrink-0 text-xs font-semibold transition-colors"
              style={{
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                border: '1px solid var(--accent-line)',
              }}
            >
              <MIcon name="dynamic_form" size={14} />
              <span>{tpl.name}</span>
              {tpl.usage_count > 0 && (
                <span style={{ fontSize: 10, opacity: 0.7 }}>· {tpl.usage_count}×</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Локальные шаблоны (localStorage) + inline-кнопка «Сохранить шаблон» */}
      {(templates.length > 0 || saveTemplateBtn) && (
        <div
          className="flex gap-2 overflow-x-auto pb-2 mb-3 items-center"
          style={{ scrollbarWidth: 'none' }}
        >
          {templates.map(tpl => (
            <div
              key={tpl.id}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 flex-shrink-0"
              style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}
            >
              <button
                type="button"
                onClick={() => handleApplyTemplate(tpl)}
                className="text-xs font-semibold"
                style={{ color: 'var(--fg)' }}
              >
                {tpl.name}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteTemplate(tpl.id)}
                className="ml-0.5 transition-colors"
                style={{ color: 'var(--fg-3)' }}
              >
                <MIcon name="close" size={14} />
              </button>
            </div>
          ))}
          {saveTemplateBtn && <span className="ml-auto flex-shrink-0">{saveTemplateBtn}</span>}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">

        {/* ── Пациент ───────────────────────────────────────────── */}
        <Card>
          <Card.Header>
            <div className="flex items-center gap-3">
              <SectionIcon icon="person" />
              <Card.Title>Пациент</Card.Title>
            </div>
          </Card.Header>

          <div className="flex flex-col gap-3">
            {/* Телефон */}
            <div>
              <FieldLabel>Номер телефона</FieldLabel>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span
                    className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 select-none"
                    style={{ color: 'var(--fg-3)', fontSize: 20 }}
                  >
                    call
                  </span>
                  <input
                    required
                    type="tel"
                    placeholder="+7 (___) ___-__-__"
                    value={form.patient_phone}
                    onChange={e => {
                      setForm({ ...form, patient_phone: e.target.value, patient_name: '' })
                      setMisPatient(null)
                      setMisLinked(false)
                    }}
                    onFocus={focusOn}
                    onBlur={focusOff}
                    style={{ ...FIELD_BASE, paddingLeft: 44 }}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!form.patient_phone || misChecking}
                  onClick={async () => {
                    setMisChecking(true)
                    try {
                      const r = await verifyPatientInMis(form.patient_phone)
                      setMisPatient(r.data)
                    } catch { setMisPatient({ found: false }) }
                    finally { setMisChecking(false) }
                  }}
                >
                  {misChecking ? '…' : 'МИС'}
                </Button>
              </div>
            </div>

            {/* МИС результат */}
            {misPatient && (
              <div
                className="px-4 py-3 rounded-xl text-sm flex items-center justify-between gap-2"
                style={
                  misPatient.found
                    ? { background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', color: 'var(--accent)' }
                    : { background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--fg-2)' }
                }
              >
                {misPatient.found ? (
                  <>
                    <span className="font-semibold" style={{ color: 'var(--fg)' }}>
                      {misPatient.name}{misPatient.birth_date ? ` · ${misPatient.birth_date}` : ''}
                    </span>
                    {!misLinked ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          setForm(f => ({ ...f, patient_name: misPatient.name, mis_patient_id: misPatient.mis_patient_id || null }))
                          setMisLinked(true)
                        }}
                      >
                        Привязать
                      </Button>
                    ) : (
                      <Chip variant="good">Привязан</Chip>
                    )}
                  </>
                ) : (
                  <span className="font-medium">Пациент не найден в МИС — введите ФИО ниже</span>
                )}
              </div>
            )}

            {/* ФИО */}
            {(!misPatient?.found || !misLinked) && (
              <div>
                <FieldLabel>ФИО пациента</FieldLabel>
                <input
                  type="text"
                  placeholder="Иванов Иван Иванович"
                  value={form.patient_name}
                  onChange={e => setForm({ ...form, patient_name: e.target.value })}
                  onFocus={focusOn}
                  onBlur={focusOff}
                  required
                  style={FIELD_BASE}
                />
              </div>
            )}
          </div>
        </Card>

        {/* ── Клиника-отправитель (только менеджер) ─────────────── */}
        {isManager && (
          <Card>
            <Card.Header>
              <div className="flex items-center gap-3">
                <SectionIcon icon="domain" tone="muted" />
                <Card.Title>Клиника-отправитель</Card.Title>
              </div>
            </Card.Header>
            <div className="relative">
              <select
                required
                value={form.from_clinic_id}
                onChange={e => handleFromClinicChange(e.target.value)}
                onFocus={focusOn}
                onBlur={focusOff}
                style={{ ...FIELD_BASE, appearance: 'none', paddingRight: 40 }}
              >
                <option value="">Выберите клинику</option>
                {allClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <span
                className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--fg-3)', fontSize: 20 }}
              >
                expand_more
              </span>
            </div>
          </Card>
        )}

        {/* ── Услуга ────────────────────────────────────────────
            Финансовая модель: показываем referral_payout (что получит создающий),
            для менеджера — дополнительно цену пациенту. */}
        <Card>
          <Card.Header>
            <div className="flex items-center gap-3">
              <SectionIcon icon="medical_services" />
              <Card.Title>Услуга</Card.Title>
            </div>
            {selectedService && selectedPayout != null && (
              <div className="flex items-center gap-1.5">
                <Chip variant="good">
                  Получите: {Number(selectedPayout || 0).toLocaleString('ru-RU')} ₽
                </Chip>
                {isManager && selectedService.price != null && (
                  <Chip variant="accent">
                    Цена: {Number(selectedService.price).toLocaleString('ru-RU')} ₽
                  </Chip>
                )}
              </div>
            )}
          </Card.Header>

          {/* Фильтры */}
          {services.length > 0 && cats.length > 0 && (
            <div className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <select
                  value={serviceCategory}
                  onChange={e => { setServiceCategory(e.target.value); setForm(f => ({ ...f, service_id: '' })) }}
                  onFocus={focusOn}
                  onBlur={focusOff}
                  style={{ ...FIELD_BASE, padding: '10px 14px', paddingRight: 36, appearance: 'none', fontSize: 13 }}
                >
                  <option value="">Все категории</option>
                  {cats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <span
                  className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--fg-3)', fontSize: 18 }}
                >
                  expand_more
                </span>
              </div>
              <input
                type="text"
                placeholder="Поиск"
                value={serviceSearch}
                onChange={e => { setServiceSearch(e.target.value); setForm(f => ({ ...f, service_id: '' })) }}
                onFocus={focusOn}
                onBlur={focusOff}
                style={{ ...FIELD_BASE, padding: '10px 14px', fontSize: 13, flex: 1 }}
              />
            </div>
          )}

          <div className="relative">
            <select
              required
              value={form.service_id}
              onChange={e => setForm({ ...form, service_id: e.target.value })}
              disabled={!form.to_clinic_id || loadingServices}
              onFocus={focusOn}
              onBlur={focusOff}
              style={{
                ...FIELD_BASE,
                appearance: 'none',
                paddingRight: 40,
                opacity: (!form.to_clinic_id || loadingServices) ? 0.5 : 1,
                cursor: (!form.to_clinic_id || loadingServices) ? 'not-allowed' : 'pointer',
              }}
            >
              {!form.to_clinic_id ? <option value="">Сначала выберите клинику</option>
                : loadingServices ? <option value="">Загрузка...</option>
                : services.length === 0 ? <option value="">Нет настроенных услуг</option>
                : filteredServices.length === 0 ? <option value="">Ничего не найдено</option>
                : (
                  <>
                    <option value="">Выберите услугу ({filteredServices.length})</option>
                    {filteredServices.map(s => {
                      const payout = s.referral_payout != null ? s.referral_payout : s.bonus_amount
                      // Партнёру/админу — только payout. Менеджеру — обе суммы.
                      const label = isManager && s.price != null
                        ? `${s.name} — Цена ${s.price} ₽ / Партнёру ${payout} ₽`
                        : `${s.name} (+${payout} ₽)`
                      return <option key={s.id} value={s.id}>{label}</option>
                    })}
                  </>
                )
              }
            </select>
            <span
              className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--fg-3)', fontSize: 20 }}
            >
              expand_more
            </span>
          </div>
        </Card>

        {/* ── Клиника назначения ────────────────────────────────
            СОХРАНЕНО: cross-tenant optgroup — «Моя клиника» + «🏥 {tenant_name}». */}
        <Card>
          <Card.Header>
            <div className="flex items-center gap-3">
              <SectionIcon icon="local_hospital" />
              <Card.Title>Клиника назначения</Card.Title>
            </div>
          </Card.Header>
          <div className="relative">
            <select
              required
              value={form.to_clinic_id}
              onChange={e => handleToClinicChange(e.target.value)}
              disabled={isManager && !form.from_clinic_id}
              onFocus={focusOn}
              onBlur={focusOff}
              style={{
                ...FIELD_BASE,
                appearance: 'none',
                paddingRight: 40,
                opacity: (isManager && !form.from_clinic_id) ? 0.5 : 1,
                cursor: (isManager && !form.from_clinic_id) ? 'not-allowed' : 'pointer',
              }}
            >
              <option value="">Выберите клинику</option>
              {(() => {
                // Группируем по тенанту: своя клиника без префикса, чужая — с пометкой «🏥 Тенант · Клиника»
                const own  = clinics.filter(c => c.is_own_tenant !== false)
                const cross = clinics.filter(c => c.is_own_tenant === false)
                const byTenant = {}
                cross.forEach(c => {
                  const key = c.tenant_name || 'Другая клиника'
                  ;(byTenant[key] = byTenant[key] || []).push(c)
                })
                return (
                  <>
                    {own.length > 0 && (
                      <optgroup label="Моя клиника">
                        {own.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </optgroup>
                    )}
                    {Object.entries(byTenant).map(([tname, list]) => (
                      <optgroup key={tname} label={`🏥 ${tname}`}>
                        {list.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </optgroup>
                    ))}
                  </>
                )
              })()}
            </select>
            <span
              className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--fg-3)', fontSize: 20 }}
            >
              expand_more
            </span>
          </div>
        </Card>

        {/* ── Время приёма ──────────────────────────────────────── */}
        {availableDates.length > 0 && (
          <Card>
            <Card.Header>
              <div className="flex items-center gap-3">
                <SectionIcon icon="schedule" />
                <Card.Title>Время приёма</Card.Title>
              </div>
            </Card.Header>

            <div
              className="flex gap-2 overflow-x-auto pb-1 mb-3"
              style={{ scrollbarWidth: 'none' }}
            >
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, appointment_date: '', appointment_time: '' }))}
                className="flex-shrink-0 px-3 py-2 rounded-xl text-xs font-semibold transition-colors"
                style={
                  !selectedDate
                    ? { background: 'var(--accent)', color: 'var(--accent-fg)', border: '1px solid var(--accent)' }
                    : { background: 'var(--surface)', color: 'var(--fg-2)', border: '1px solid var(--border)' }
                }
              >
                Без записи
              </button>
              {availableDates.map(({ date, dow, schedule: s }) => {
                const iso = date.toISOString().slice(0, 10)
                const isSel = form.appointment_date === iso
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, appointment_date: iso, appointment_time: s?.open_time || '09:00' }))}
                    className="flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl text-xs font-semibold transition-colors"
                    style={{
                      minWidth: 56,
                      ...(isSel
                        ? { background: 'var(--accent)', color: 'var(--accent-fg)', border: '1px solid var(--accent)' }
                        : { background: 'var(--surface)', color: 'var(--fg-2)', border: '1px solid var(--border)' }),
                    }}
                  >
                    <span>{DAY_NAMES[dow]}</span>
                    <span style={{ opacity: 0.8, marginTop: 2 }}>{formatDateShort(date)}</span>
                  </button>
                )
              })}
            </div>

            {selectedDate && (
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <FieldLabel>
                    Время ({selectedDate.schedule?.open_time}–{selectedDate.schedule?.close_time})
                  </FieldLabel>
                  <input
                    type="time"
                    min={selectedDate.schedule?.open_time}
                    max={selectedDate.schedule?.close_time}
                    value={form.appointment_time}
                    onChange={e => setForm(f => ({ ...f, appointment_time: e.target.value }))}
                    onFocus={focusOn}
                    onBlur={focusOff}
                    style={FIELD_BASE}
                  />
                </div>
                <div
                  className="text-center"
                  style={{ fontSize: 12, color: 'var(--fg-2)', paddingBottom: 6 }}
                >
                  <p className="font-bold" style={{ color: 'var(--fg)' }}>{DAY_NAMES[selectedDate.dow]},</p>
                  <p>{formatDateShort(selectedDate.date)}</p>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* ── Врач МИС ─────────────────────────────────────────── */}
        {form.appointment_date && misDoctors.length > 0 && (
          <Card>
            <Card.Header>
              <div className="flex items-center gap-3">
                <SectionIcon icon="stethoscope" />
                <Card.Title>Врач (МИС)</Card.Title>
              </div>
            </Card.Header>

            {loadingDoctors ? (
              <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Загрузка врачей…</div>
            ) : (
              <div className="relative">
                <select
                  value={form.mis_doctor_id || ''}
                  onChange={e => setForm(f => ({ ...f, mis_doctor_id: e.target.value ? parseInt(e.target.value) : null }))}
                  onFocus={focusOn}
                  onBlur={focusOff}
                  style={{ ...FIELD_BASE, appearance: 'none', paddingRight: 40 }}
                >
                  <option value="">— Не выбран (без записи в МИС) —</option>
                  {misDoctors.map(d => (
                    <option key={d.mis_id} value={d.mis_id}>
                      {d.name}{d.specialty ? ` · ${d.specialty}` : ''}
                    </option>
                  ))}
                </select>
                <span
                  className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--fg-3)', fontSize: 20 }}
                >
                  expand_more
                </span>
              </div>
            )}
            {form.mis_doctor_id && (
              <p
                className="font-medium mt-2"
                style={{ fontSize: 12, color: 'var(--accent)' }}
              >
                ✓ Запись будет создана в МИС автоматически
              </p>
            )}
          </Card>
        )}

        {/* ── Примечание ───────────────────────────────────────── */}
        <Card>
          <Card.Header>
            <div className="flex items-center gap-3">
              <SectionIcon icon="edit_note" tone="muted" />
              <Card.Title>Примечание</Card.Title>
            </div>
          </Card.Header>
          <textarea
            placeholder="Дополнительная информация..."
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            onFocus={focusOn}
            onBlur={focusOff}
            rows={3}
            style={{ ...FIELD_BASE, resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }}
          />
        </Card>

        {/* ── Submit ───────────────────────────────────────────── */}
        {mode === 'page' ? (
          // Page-mode: фиксированная кнопка снизу (как в исходном дизайне).
          <div
            className="fixed bottom-16 left-0 right-0 px-4 pb-4 pt-6 z-10"
            style={{
              background: 'linear-gradient(to top, var(--bg) 60%, transparent)',
            }}
          >
            <div className="max-w-3xl mx-auto">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={submitDisabled}
                className="w-full"
                style={{
                  width: '100%',
                  height: 52,
                  fontSize: 15,
                  borderRadius: 14,
                }}
              >
                {loading ? 'Создание…' : 'Создать направление'}
              </Button>
              <p
                className="text-center mt-2"
                style={{
                  fontSize: 11,
                  color: 'var(--fg-4)',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                Направление действует 30 дней
              </p>
            </div>
          </div>
        ) : (
          // Modal-mode: inline-кнопка в конце формы (Modal сам прокручивает body).
          <div className="flex items-center justify-end gap-2 pt-2">
            {onClose && (
              <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
                Отмена
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={submitDisabled}
              style={{ minWidth: 220, height: 48, fontSize: 14, borderRadius: 12 }}
            >
              {loading ? 'Создание…' : 'Создать направление'}
            </Button>
          </div>
        )}
      </form>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Page-wrapper (для маршрута /arc/create — обратная совместимость).
// ─────────────────────────────────────────────────────────────────────
export default function CreateReferral() {
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const phone = searchParams.get('patient_phone') || ''
  const name  = searchParams.get('patient_name')  || ''

  return (
    <Page className="pb-32">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6">
        <PageHeader
          title="Новое направление"
          subtitle="Заполните данные пациента и выберите клинику назначения"
          actions={
            <Button
              variant="ghost"
              size="sm"
              leftIcon={
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16, fontVariationSettings: "'FILL' 0", lineHeight: 1 }}
                >
                  arrow_back
                </span>
              }
              onClick={() => nav(-1)}
            >
              Назад
            </Button>
          }
        />

        <CreateReferralForm
          mode="page"
          initialPhone={phone}
          initialName={name}
          onSuccess={(id) => nav(`/qr/${id}`)}
        />
      </div>
    </Page>
  )
}
