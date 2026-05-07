import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getClinics, getClinicServices, createReferral, verifyPatientInMis } from '../api'
import api from '../api'
import useAuthStore from '../store/auth'
import { useToast, Modal, Button } from '../design'

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

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

const TEMPLATES_KEY = 'clinika_referral_templates'
function loadTemplates() {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY)) || [] } catch { return [] }
}
function saveTemplates(tpls) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(tpls))
}

// Секция-карточка
function Section({ icon, iconBg, iconColor, title, badge, children }) {
  return (
    <div className="bg-white rounded-3xl p-5" style={{ boxShadow: '0 4px 20px rgba(25,28,30,0.06)' }}>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${iconBg}`}>
            <span className="material-symbols-outlined text-xl" style={{ color: iconColor, fontVariationSettings: "'FILL' 1" }}>{icon}</span>
          </div>
          <h2 className="text-base font-bold text-[#191c1e] font-headline">{title}</h2>
        </div>
        {badge}
      </div>
      {children}
    </div>
  )
}

// Стиль для input
const inputCls = 'w-full bg-[#f2f4f6] rounded-2xl px-4 py-3.5 text-[#191c1e] text-sm outline-none border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white transition-all placeholder-[#727783]'
const selectCls = 'w-full bg-[#f2f4f6] rounded-2xl px-4 py-3.5 text-[#191c1e] text-sm outline-none border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white transition-all appearance-none disabled:opacity-50'

export default function CreateReferral() {
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
    patient_phone: '', patient_name: '', mis_patient_id: null, mis_doctor_id: null, notes: '', appointment_date: '', appointment_time: ''
  })
  const [loading, setLoading] = useState(false)
  const [templates, setTemplates] = useState(loadTemplates)
  const [misPatient, setMisPatient] = useState(null)
  const [misLinked, setMisLinked] = useState(false)
  const [misChecking, setMisChecking] = useState(false)
  const [misDoctors, setMisDoctors] = useState([])
  const [loadingDoctors, setLoadingDoctors] = useState(false)
  const [serviceCategory, setServiceCategory] = useState('')
  const [serviceSearch, setServiceSearch] = useState('')
  const { user } = useAuthStore()
  const nav = useNavigate()
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
      nav(`/qr/${res.data.id}`)
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

  return (
    <div className="bg-[#f7f9fb] min-h-screen pb-32">
      {/* Modal-prompt для названия шаблона направления */}
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
          placeholder="Например: Терапевт → УЗИ"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
        />
      </Modal>
      {/* Шапка */}
      <header className="sticky top-14 z-10 flex items-center px-4 h-14 bg-white/80" style={{ backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(194,198,212,0.3)' }}>
        <button onClick={() => nav(-1)} className="w-10 h-10 flex items-center justify-center text-[#727783] hover:text-[#191c1e] rounded-full hover:bg-[#eceef0] transition -ml-2">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h1 className="font-bold text-[#191c1e] font-headline text-base ml-2">Новое направление</h1>
        {form.to_clinic_id && form.service_id && (
          <button type="button" onClick={handleSaveTemplate} title="Сохранить шаблон"
            className="ml-auto w-10 h-10 flex items-center justify-center text-[#727783] hover:text-[#1565c0] rounded-full hover:bg-[#dae5ff] transition">
            <span className="material-symbols-outlined text-xl">bookmark_add</span>
          </button>
        )}
      </header>

      <div className="px-4 pt-4 space-y-3">

        {/* Шаблоны */}
        {templates.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {templates.map(tpl => (
              <div key={tpl.id} className="flex items-center gap-1 bg-[#dae5ff] rounded-full px-3 py-1.5 flex-shrink-0">
                <button type="button" onClick={() => handleApplyTemplate(tpl)} className="text-xs font-semibold text-[#1565c0]">
                  {tpl.name}
                </button>
                <button type="button" onClick={() => handleDeleteTemplate(tpl.id)} className="text-[#727783] hover:text-[#ba1a1a] ml-0.5">
                  <span className="material-symbols-outlined text-sm leading-none">close</span>
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">

          {/* Пациент */}
          <Section icon="person" iconBg="bg-[#dae5ff]" iconColor="#1565c0" title="Пациент">
            <div className="space-y-3">
              {/* Телефон */}
              <div>
                <label className="block text-[11px] font-semibold text-[#424752] uppercase tracking-widest mb-1.5 ml-1">Номер телефона</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#727783] text-xl select-none">call</span>
                    <input required type="tel" placeholder="+7 (___) ___-__-__"
                      value={form.patient_phone}
                      onChange={e => { setForm({ ...form, patient_phone: e.target.value, patient_name: '' }); setMisPatient(null); setMisLinked(false) }}
                      className="w-full bg-[#f2f4f6] rounded-2xl py-3.5 pl-12 pr-4 text-[#191c1e] text-sm outline-none border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white transition-all placeholder-[#727783]"
                    />
                  </div>
                  <button type="button" disabled={!form.patient_phone || misChecking}
                    onClick={async () => {
                      setMisChecking(true)
                      try {
                        const r = await verifyPatientInMis(form.patient_phone)
                        setMisPatient(r.data)
                      } catch { setMisPatient({ found: false }) }
                      finally { setMisChecking(false) }
                    }}
                    className="px-4 py-3 rounded-2xl bg-[#f2f4f6] text-sm font-semibold text-[#424752] hover:bg-[#eceef0] disabled:opacity-40 transition whitespace-nowrap border-2 border-transparent focus:border-[#1565c0]/30 outline-none">
                    {misChecking ? '...' : 'МИС'}
                  </button>
                </div>
              </div>

              {/* МИС результат */}
              {misPatient && (
                <div className={`px-4 py-3 rounded-2xl text-sm ${misPatient.found ? 'bg-[#dcfce7]' : 'bg-amber-50'}`}>
                  {misPatient.found ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#166534]">
                        {misPatient.name}{misPatient.birth_date ? ` · ${misPatient.birth_date}` : ''}
                      </span>
                      {!misLinked ? (
                        <button type="button"
                          onClick={() => { setForm(f => ({ ...f, patient_name: misPatient.name, mis_patient_id: misPatient.mis_patient_id || null })); setMisLinked(true) }}
                          className="flex-shrink-0 bg-[#166534] hover:bg-[#14532d] text-white rounded-xl px-3 py-1 text-xs font-bold transition">
                          Привязать
                        </button>
                      ) : (
                        <span className="text-[#166534] font-bold text-xs">Привязан ✓</span>
                      )}
                    </div>
                  ) : (
                    <span className="font-medium text-amber-700">Пациент не найден в МИС — введите ФИО ниже</span>
                  )}
                </div>
              )}

              {/* ФИО */}
              {(!misPatient?.found || !misLinked) && (
                <div>
                  <label className="block text-[11px] font-semibold text-[#424752] uppercase tracking-widest mb-1.5 ml-1">ФИО пациента</label>
                  <input type="text" placeholder="Иванов Иван Иванович"
                    value={form.patient_name} onChange={e => setForm({ ...form, patient_name: e.target.value })} required
                    className={inputCls} />
                </div>
              )}
            </div>
          </Section>

          {/* Клиника-отправитель (только менеджер) */}
          {isManager && (
            <Section icon="local_hospital" iconBg="bg-[#f3e8ff]" iconColor="#7c3aed" title="Клиника-отправитель">
              <div className="relative">
                <select required value={form.from_clinic_id} onChange={e => handleFromClinicChange(e.target.value)} className={selectCls}>
                  <option value="">Выберите клинику</option>
                  {allClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-[#727783] pointer-events-none text-xl">expand_more</span>
              </div>
            </Section>
          )}

          {/* Услуга */}
          <Section icon="medical_services" iconBg="bg-[#dcfce7]" iconColor="#166534" title="Услуга"
            badge={form.service_id && services.find(s => s.id === form.service_id) ? (
              <span className="bg-[#dcfce7] text-[#166534] text-xs font-bold px-3 py-1 rounded-full">
                +{services.find(s => s.id === form.service_id)?.bonus_amount ?? 0} Б
              </span>
            ) : null}>

            {/* Фильтры */}
            {services.length > 0 && cats.length > 0 && (
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1">
                  <select value={serviceCategory} onChange={e => { setServiceCategory(e.target.value); setForm(f => ({ ...f, service_id: '' })) }}
                    className="w-full bg-[#f2f4f6] rounded-2xl px-4 py-2.5 text-sm text-[#191c1e] outline-none appearance-none border-2 border-transparent focus:border-[#1565c0]/30">
                    <option value="">Все категории</option>
                    {cats.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[#727783] pointer-events-none text-lg">expand_more</span>
                </div>
                <input type="text" placeholder="Поиск"
                  value={serviceSearch} onChange={e => { setServiceSearch(e.target.value); setForm(f => ({ ...f, service_id: '' })) }}
                  className="flex-1 bg-[#f2f4f6] rounded-2xl px-4 py-2.5 text-sm text-[#191c1e] outline-none border-2 border-transparent focus:border-[#1565c0]/30 placeholder-[#727783]" />
              </div>
            )}

            <div className="relative">
              <select required value={form.service_id} onChange={e => setForm({ ...form, service_id: e.target.value })}
                disabled={!form.to_clinic_id || loadingServices}
                className={selectCls}>
                {!form.to_clinic_id ? <option value="">Сначала выберите клинику</option>
                  : loadingServices ? <option value="">Загрузка...</option>
                  : services.length === 0 ? <option value="">Нет настроенных услуг</option>
                  : filteredServices.length === 0 ? <option value="">Ничего не найдено</option>
                  : (
                    <>
                      <option value="">Выберите услугу ({filteredServices.length})</option>
                      {filteredServices.map(s => (
                        <option key={s.id} value={s.id}>{s.name} (+{s.bonus_amount} Б)</option>
                      ))}
                    </>
                  )
                }
              </select>
              <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-[#727783] pointer-events-none text-xl">expand_more</span>
            </div>
          </Section>

          {/* Клиника назначения */}
          <Section icon="local_hospital" iconBg="bg-[#dae5ff]" iconColor="#1565c0" title="Клиника назначения">
            <div className="relative">
              <select required value={form.to_clinic_id} onChange={e => handleToClinicChange(e.target.value)}
                disabled={isManager && !form.from_clinic_id}
                className={selectCls}>
                <option value="">Выберите клинику</option>
                {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-[#727783] pointer-events-none text-xl">expand_more</span>
            </div>
          </Section>

          {/* Запись на приём */}
          {availableDates.length > 0 && (
            <Section icon="schedule" iconBg="bg-orange-50" iconColor="#c2410c" title="Время приёма">
              <div className="flex gap-2 overflow-x-auto pb-1 mb-3" style={{ scrollbarWidth: 'none' }}>
                <button type="button" onClick={() => setForm(f => ({ ...f, appointment_date: '', appointment_time: '' }))}
                  className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-semibold border-2 transition-colors ${!selectedDate ? 'bg-[#1565c0] text-white border-[#1565c0]' : 'border-[#eceef0] text-[#727783] bg-white'}`}>
                  Без записи
                </button>
                {availableDates.map(({ date, dow, schedule: s }) => {
                  const iso = date.toISOString().slice(0, 10)
                  const isSel = form.appointment_date === iso
                  return (
                    <button key={iso} type="button" onClick={() => setForm(f => ({ ...f, appointment_date: iso, appointment_time: s?.open_time || '09:00' }))}
                      className={`flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl border-2 text-xs font-semibold transition-colors min-w-[52px] ${isSel ? 'bg-[#1565c0] text-white border-[#1565c0]' : 'border-[#eceef0] text-[#424752] bg-white'}`}>
                      <span>{DAY_NAMES[dow]}</span>
                      <span className="opacity-80 mt-0.5">{formatDateShort(date)}</span>
                    </button>
                  )
                })}
              </div>
              {selectedDate && (
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-[11px] text-[#727783] mb-1">
                      Время ({selectedDate.schedule?.open_time}–{selectedDate.schedule?.close_time})
                    </label>
                    <input type="time"
                      min={selectedDate.schedule?.open_time} max={selectedDate.schedule?.close_time}
                      value={form.appointment_time} onChange={e => setForm(f => ({ ...f, appointment_time: e.target.value }))}
                      className={inputCls} />
                  </div>
                  <div className="text-center text-xs text-[#424752] pt-5">
                    <p className="font-bold">{DAY_NAMES[selectedDate.dow]},</p>
                    <p>{formatDateShort(selectedDate.date)}</p>
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* Врач МИС */}
          {form.appointment_date && misDoctors.length > 0 && (
            <Section icon="stethoscope" iconBg="bg-teal-50" iconColor="#0097A7" title="Врач (МИС)">
              {loadingDoctors ? (
                <div className="text-xs text-gray-400">Загрузка врачей...</div>
              ) : (
                <div className="relative">
                  <select
                    value={form.mis_doctor_id || ''}
                    onChange={e => setForm(f => ({ ...f, mis_doctor_id: e.target.value ? parseInt(e.target.value) : null }))}
                    className="w-full appearance-none bg-[#f2f4f6] rounded-2xl px-4 py-3.5 text-sm text-[#191c1e] outline-none border-2 border-transparent focus:border-[#0097A7]/30 focus:bg-white transition-all pr-10">
                    <option value="">— Не выбран (без записи в МИС) —</option>
                    {misDoctors.map(d => (
                      <option key={d.mis_id} value={d.mis_id}>
                        {d.name}{d.specialty ? ` · ${d.specialty}` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-[#727783] pointer-events-none text-xl">expand_more</span>
                </div>
              )}
              {form.mis_doctor_id && (
                <p className="text-xs text-teal-600 mt-2 font-medium">
                  ✓ Запись будет создана в МИС автоматически
                </p>
              )}
            </Section>
          )}

          {/* Примечание */}
          <Section icon="edit_note" iconBg="bg-[#f2f4f6]" iconColor="#727783" title="Примечание">
            <textarea placeholder="Дополнительная информация..."
              value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={2} className="w-full bg-[#f2f4f6] rounded-2xl px-4 py-3.5 text-[#191c1e] text-sm outline-none border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white transition-all resize-none placeholder-[#727783]" />
          </Section>

          {/* Кнопка */}
          <div className="fixed bottom-16 left-0 right-0 px-4 pb-4 bg-gradient-to-t from-[#f7f9fb] via-[#f7f9fb] to-transparent pt-6 z-10">
            <button type="submit" disabled={submitDisabled}
              className="w-full h-14 rounded-2xl text-white font-bold text-base disabled:opacity-50 transition-all active:scale-[0.98]"
              style={{ background: 'linear-gradient(90deg, #1565c0, #1e6fe8)', boxShadow: '0 8px 24px rgba(21,101,192,0.25)' }}>
              {loading ? 'Создание...' : 'Создать направление'}
            </button>
            <p className="text-[11px] text-center text-[#c2c6d4] font-semibold uppercase tracking-wider mt-2">
              Направление действует 30 дней
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
