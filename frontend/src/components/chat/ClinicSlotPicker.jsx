/**
 * ClinicSlotPicker — премиум-календарь записи пациента из чата.
 * 7 дней × слоты времени, цветовая разметка: свободно / занято / выбрано.
 */
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import api from '../../api'
import { chatSlotsApi } from '../../api/chatSlots'

const WD_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function fmtDateISO(d) { return d.toISOString().slice(0, 10) }
function fmtDateLabel(d) {
  const wd = WD_RU[(d.getDay() + 6) % 7]
  const day = d.getDate()
  const month = d.toLocaleDateString('ru', { month: 'short' })
  return { wd, day, month }
}

export default function ClinicSlotPicker({ open, onClose, threadId, clinicId, defaults = {}, onSent }) {
  const [doctorId, setDoctorId] = useState(defaults.doctor_id || '')
  const [serviceId, setServiceId] = useState(defaults.service_id || '')
  const [serviceQuery, setServiceQuery] = useState('')
  const [doctors, setDoctors] = useState([])
  const [services, setServices] = useState([])
  // slotsByDate: { 'YYYY-MM-DD': [{start_time, end_time, available}, ...] }
  const [slotsByDate, setSlotsByDate] = useState({})
  const [selected, setSelected] = useState([])  // [{date, start_time}]
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // 7 ближайших дней
  const days = useMemo(() => {
    const today = new Date()
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today)
      d.setDate(today.getDate() + i)
      return d
    })
  }, [open])

  // Загрузка справочников
  useEffect(() => {
    if (!open) return
    api.get('/doctors', { params: clinicId ? { clinic_id: clinicId } : {} })
      .then(r => setDoctors(Array.isArray(r.data) ? r.data : (r.data?.items || [])))
      .catch(() => setDoctors([]))
    if (clinicId) {
      api.get('/clinics/' + clinicId + '/services')
        .then(r => setServices(Array.isArray(r.data) ? r.data : (r.data?.items || [])))
        .catch(() => api.get('/manager/services/').then(r => setServices(r.data || [])).catch(() => setServices([])))
    } else {
      api.get('/manager/services/').then(r => setServices(r.data || [])).catch(() => setServices([]))
    }
  }, [open, clinicId])

  // Загрузка слотов выбранного врача на 7 дней
  useEffect(() => {
    if (!doctorId) { setSlotsByDate({}); return }
    let cancelled = false
    setLoadingSlots(true)
    Promise.all(days.map(d => {
      const iso = fmtDateISO(d)
      return api.get('/doctors/' + doctorId + '/slots', { params: { target_date: iso } })
        .then(r => [iso, Array.isArray(r.data) ? r.data : (r.data?.slots || [])])
        .catch(() => [iso, []])
    })).then(pairs => {
      if (cancelled) return
      setSlotsByDate(Object.fromEntries(pairs))
      setLoadingSlots(false)
    })
    return () => { cancelled = true }
  }, [doctorId, days])

  // Toggle слота (max 5)
  function toggleSlot(date, startTime) {
    const key = date + '_' + startTime
    setSelected(prev => {
      const exists = prev.find(s => s.date === date && s.start_time === startTime)
      if (exists) return prev.filter(s => !(s.date === date && s.start_time === startTime))
      if (prev.length >= 5) return prev
      return [...prev, { date, start_time: startTime }]
    })
  }
  function isSelected(date, startTime) {
    return selected.some(s => s.date === date && s.start_time === startTime)
  }

  async function send() {
    if (!doctorId || !serviceId || selected.length === 0) {
      setErr('Выбери врача, услугу и хотя бы один слот')
      return
    }
    setBusy(true); setErr(null)
    try {
      // Формируем slot_offer для chat_slots API
      const offers = selected.map(s => ({
        doctor_id: doctorId,
        service_id: serviceId,
        date: s.date,
        start_time: s.start_time,
      }))
      await chatSlotsApi.offerSlots(threadId, offers)
      setSelected([])
      onSent?.()
      onClose?.()
    } catch (e) {
      const d = e?.response?.data?.detail
      let m = 'Не удалось отправить слоты'
      if (typeof d === 'string') m = d
      else if (Array.isArray(d)) m = d.map(x => x?.msg || JSON.stringify(x)).join('; ')
      setErr(m)
    } finally { setBusy(false) }
  }

  if (!open) return null

  // Фильтрация услуг по поиску
  const filteredServices = serviceQuery
    ? services.filter(s => (s.name || s.title || '').toLowerCase().includes(serviceQuery.toLowerCase())).slice(0, 50)
    : []

  return createPortal(
    <div className="fixed inset-0 flex items-stretch justify-end" style={{ zIndex: 1500 }}>
      <div className="absolute inset-0" style={{ background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div className="relative w-full h-full overflow-y-auto shadow-2xl" style={{ background: '#ffffff', color: '#0f172a', maxWidth: 920 }}>

        {/* Шапка */}
        <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'linear-gradient(135deg, #0097A7, #0A2342)', color: '#fff', padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Запись на приём</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>Выбери врача и до 5 слотов — пациент получит карточки в чат</div>
          </div>
          <button onClick={onClose} style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(255,255,255,.15)', color: '#fff', fontSize: 22, display: 'grid', placeItems: 'center' }}>×</button>
        </div>

        <div style={{ padding: 24 }}>
          {/* Врач */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Врач</label>
            <select
              value={doctorId}
              onChange={e => { setDoctorId(e.target.value); setSelected([]) }}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', fontSize: 15, colorScheme: 'light' }}
            >
              <option value="">— выберите врача —</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>{d.full_name || d.name} {d.specialty ? '· ' + d.specialty : ''}</option>
              ))}
            </select>
          </div>

          {/* Услуга — поиск */}
          <div style={{ marginBottom: 22 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Услуга</label>
            <input
              type="text"
              value={serviceQuery}
              onChange={e => { setServiceQuery(e.target.value); setServiceId('') }}
              placeholder={serviceId ? '✓ выбрана' : 'Начни печатать название услуги…'}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', fontSize: 15 }}
            />
            {filteredServices.length > 0 && !serviceId && (
              <div style={{ marginTop: 6, background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 12, maxHeight: 220, overflow: 'auto', boxShadow: '0 8px 24px -12px rgba(0,0,0,.2)' }}>
                {filteredServices.map(s => (
                  <div
                    key={s.id}
                    onClick={() => { setServiceId(s.id); setServiceQuery(s.name || s.title || '') }}
                    style={{ padding: '10px 14px', cursor: 'pointer', color: '#0f172a', fontSize: 14, borderBottom: '1px solid #f1f5f9' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f0fdfa'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  >
                    {s.name || s.title || '—'}
                    {s.price ? <span style={{ color: '#64748b', marginLeft: 8 }}>· {s.price} ₽</span> : null}
                  </div>
                ))}
              </div>
            )}
            {serviceId && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: '#ecfeff', border: '1px solid #06b6d4', borderRadius: 10, color: '#0f172a', fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>✓ {serviceQuery}</span>
                <button type="button" onClick={() => { setServiceId(''); setServiceQuery('') }} style={{ color: '#0891b2', fontSize: 13, fontWeight: 600 }}>× сбросить</button>
              </div>
            )}
          </div>

          {/* Календарь слотов — 7 дней */}
          {doctorId && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Расписание · 7 дней
                </label>
                <span style={{ fontSize: 13, color: '#64748b' }}>
                  Выбрано: <b style={{ color: '#0097A7' }}>{selected.length}</b> / 5
                </span>
              </div>

              {loadingSlots ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Загрузка расписания…</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
                  {days.map(d => {
                    const iso = fmtDateISO(d)
                    const lbl = fmtDateLabel(d)
                    const slots = slotsByDate[iso] || []
                    const isToday = iso === fmtDateISO(new Date())
                    return (
                      <div key={iso} style={{ background: '#f8fafc', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        {/* Заголовок дня */}
                        <div style={{ padding: '10px 8px', textAlign: 'center', background: isToday ? 'linear-gradient(135deg, #0097A7, #0A2342)' : '#f1f5f9', color: isToday ? '#fff' : '#475569' }}>
                          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: isToday ? 0.85 : 0.7 }}>{lbl.wd}</div>
                          <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>{lbl.day}</div>
                          <div style={{ fontSize: 10, opacity: 0.7 }}>{lbl.month.replace('.', '')}</div>
                        </div>
                        {/* Слоты дня */}
                        <div style={{ padding: 6, flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minHeight: 60 }}>
                          {slots.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#cbd5e1', fontSize: 11, padding: '12px 0' }}>—</div>
                          ) : (
                            slots.map((s, idx) => {
                              const sel = isSelected(iso, s.start_time)
                              const avail = s.available !== false
                              return (
                                <button
                                  key={iso + s.start_time + idx}
                                  onClick={() => avail && toggleSlot(iso, s.start_time)}
                                  disabled={!avail}
                                  style={{
                                    padding: '6px 4px',
                                    fontSize: 12,
                                    fontWeight: sel ? 700 : 500,
                                    borderRadius: 8,
                                    background: sel ? '#0097A7' : (avail ? '#ffffff' : '#e2e8f0'),
                                    color: sel ? '#fff' : (avail ? '#0f172a' : '#94a3b8'),
                                    border: sel ? '1px solid #0097A7' : '1px solid #e2e8f0',
                                    cursor: avail ? 'pointer' : 'not-allowed',
                                    textDecoration: avail ? 'none' : 'line-through',
                                    transition: 'all .15s',
                                    boxShadow: sel ? '0 2px 8px -2px rgba(0,151,167,.4)' : 'none',
                                  }}
                                  onMouseEnter={e => { if (avail && !sel) e.currentTarget.style.background = '#f0fdfa' }}
                                  onMouseLeave={e => { if (avail && !sel) e.currentTarget.style.background = '#fff' }}
                                  title={avail ? 'Свободно — нажми чтобы предложить' : 'Занято'}
                                >
                                  {s.start_time}
                                </button>
                              )
                            })
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Легенда */}
              <div style={{ marginTop: 12, display: 'flex', gap: 16, fontSize: 12, color: '#64748b', flexWrap: 'wrap' }}>
                <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 3, verticalAlign: 'middle' }} /> Свободно</span>
                <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#e2e8f0', borderRadius: 3, verticalAlign: 'middle' }} /> Занято</span>
                <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#0097A7', borderRadius: 3, verticalAlign: 'middle' }} /> Выбрано</span>
              </div>
            </div>
          )}

          {err && <div style={{ marginTop: 16, padding: 12, background: '#fee2e2', color: '#991b1b', borderRadius: 10, fontSize: 13 }}>{err}</div>}

          {/* Кнопки */}
          <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ flex: 1, padding: 14, borderRadius: 12, background: '#f1f5f9', color: '#475569', fontWeight: 600, fontSize: 15 }}>Отмена</button>
            <button
              onClick={send}
              disabled={busy || selected.length === 0 || !serviceId}
              style={{
                flex: 2,
                padding: 14,
                borderRadius: 12,
                background: (busy || selected.length === 0 || !serviceId) ? '#cbd5e1' : 'linear-gradient(135deg, #0097A7, #0A2342)',
                color: '#fff',
                fontWeight: 700,
                fontSize: 15,
                boxShadow: (busy || selected.length === 0 || !serviceId) ? 'none' : '0 4px 16px -4px rgba(0,151,167,.5)',
              }}
            >
              {busy ? 'Отправка…' : `Отправить пациенту (${selected.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
