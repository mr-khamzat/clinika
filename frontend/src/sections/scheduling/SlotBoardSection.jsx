/**
 * ========================================
 * БЛОК: SlotBoardSection — расписание (дизайн v3 «слоты-карточки»)
 * ========================================
 * Альтернативный вид расписания: две панели — слева врачи (поиск + загрузка),
 * справа сетка слотов (4 колонки) на выбранный день недели.
 *
 * Используется в `ManagerAppointments` как 3-й режим (view='slots') наряду
 * с существующим `AppointmentsCalendarSection` и `AppointmentsStatsSection`.
 *
 * Backend:
 *   GET  /doctors                                  — список врачей тенанта
 *   GET  /doctors/{id}/week?start_date=YYYY-MM-DD  — слоты+записи на неделю
 *   GET  /appointments?appointment_date=YYYY-MM-DD — список всех записей на дату
 *                                                    (для счётчиков в левой панели)
 *   POST /appointments                             — создать запись (BookModal)
 *
 * Карточка приёма (заключение/файлы/направления/история) открывается через
 * существующий `AppointmentDetailsModal` — НЕ дублируем.
 * ========================================
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import api from '../../api'
import { Modal, Button } from '../../design'
import AppointmentDetailsModal from '../../components/scheduling/AppointmentDetailsModal'

// ── Утилиты дат ─────────────────────────────────────────────────────────────
const DAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function ymd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function startOfWeek(d) {
  const x = new Date(d)
  const dow = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dow)
  x.setHours(0, 0, 0, 0)
  return x
}

function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function sameYMD(a, b) {
  return ymd(a) === ymd(b)
}

// ── Аватар врача: инициалы + детерминированный цвет ─────────────────────────
const AVATAR_COLORS = [
  '#0e7490', '#be185d', '#7c3aed', '#15803d', '#c2410c',
  '#1d4ed8', '#b91c1c', '#0f766e', '#a16207', '#6d28d9',
]
function doctorInitials(fullName) {
  if (!fullName) return '—'
  const parts = String(fullName).trim().split(/\s+/)
  const a = parts[0]?.[0] || ''
  const b = parts[1]?.[0] || ''
  return (a + b).toUpperCase() || '—'
}
function doctorColor(id) {
  if (!id) return AVATAR_COLORS[0]
  // Простой hash — стабильный цвет для конкретного uuid
  let h = 0
  const s = String(id)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

// ── Маппинги статусов ────────────────────────────────────────────────────────
const STATUSES = {
  pending:   { label: 'Ожидает',   cls: 'status-pending',   icon: 'schedule' },
  confirmed: { label: 'Подтв.',    cls: 'status-confirmed', icon: 'check_circle' },
  completed: { label: 'Выполнен',  cls: 'status-completed', icon: 'task_alt' },
  cancelled: { label: 'Отменён',   cls: 'status-cancelled', icon: 'close' },
  no_show:   { label: 'Не пришёл', cls: 'status-cancelled', icon: 'do_not_disturb_on' },
}

// ──────────────────────────────────────────────────────────────────────────────
// БЛОК: главный компонент
// ──────────────────────────────────────────────────────────────────────────────
export default function SlotBoardSection({ token }) {
  const [doctors, setDoctors] = useState([])
  const [activeDoctorId, setActiveDoctorId] = useState('')
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()))
  const [activeDate, setActiveDate] = useState(new Date())
  const [weekData, setWeekData] = useState(null)
  const [loadingWeek, setLoadingWeek] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [dayCounts, setDayCounts] = useState({})  // { doctor_id: appointmentsCountOnActiveDate }
  const [nowTick, setNowTick] = useState(Date.now())

  // Модалы
  const [bookModal, setBookModal] = useState(null)         // { date, start_time }
  const [detailsModal, setDetailsModal] = useState(null)   // { appointment, date, start_time }

  // ── Загрузка списка врачей ────────────────────────────────────────────────
  useEffect(() => {
    api.get('/doctors')
      .then(r => {
        const list = Array.isArray(r.data) ? r.data : []
        setDoctors(list)
        if (list.length && !activeDoctorId) setActiveDoctorId(list[0].id)
      })
      .catch(() => setError('Не удалось загрузить список врачей'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Загрузка недельных данных активного врача ────────────────────────────
  const loadWeek = useCallback(async () => {
    if (!activeDoctorId) return
    setLoadingWeek(true)
    setError('')
    try {
      const r = await api.get(`/doctors/${activeDoctorId}/week`, {
        params: { start_date: ymd(weekStart) },
      })
      setWeekData(r.data)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить расписание')
      setWeekData(null)
    } finally {
      setLoadingWeek(false)
    }
  }, [activeDoctorId, weekStart])

  useEffect(() => { loadWeek() }, [loadWeek])

  // ── Загрузка счётчиков «N записей на день» для всех врачей ────────────────
  // Один запрос на дату → счётчики по всем врачам тенанта (нужно для прогресс-баров).
  const reloadDayCounts = useCallback(async () => {
    try {
      const r = await api.get('/appointments', {
        params: { appointment_date: ymd(activeDate) },
      })
      const counts = {}
      for (const a of r.data || []) {
        // считаем только активные записи (без cancelled)
        if (a.status === 'cancelled') continue
        counts[a.doctor_id] = (counts[a.doctor_id] || 0) + 1
      }
      setDayCounts(counts)
    } catch {
      setDayCounts({})
    }
  }, [activeDate])

  useEffect(() => { reloadDayCounts() }, [reloadDayCounts])

  // ── Обновление now-line каждую минуту ─────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  // ── Если activeDate уходит за пределы текущей недели — двигаем weekStart ──
  useEffect(() => {
    const ws = startOfWeek(activeDate)
    if (!sameYMD(ws, weekStart)) setWeekStart(ws)
  }, [activeDate])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Активный врач ────────────────────────────────────────────────────────
  const activeDoctor = useMemo(
    () => doctors.find(d => d.id === activeDoctorId) || null,
    [doctors, activeDoctorId],
  )

  // ── Дни недели для шапки ──────────────────────────────────────────────────
  const weekDays = useMemo(() => {
    const arr = []
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i)
      arr.push({
        date: d,
        ymd: ymd(d),
        name: DAY_SHORT[i],
        dateNum: d.getDate(),
        isToday: sameYMD(d, new Date()),
        isActive: sameYMD(d, activeDate),
      })
    }
    return arr
  }, [weekStart, activeDate])

  // ── День активного врача из weekData ─────────────────────────────────────
  const activeDayInfo = useMemo(() => {
    if (!weekData?.days) return null
    const key = ymd(activeDate)
    return weekData.days.find(x => x.date === key) || null
  }, [weekData, activeDate])

  // ── Метрики над сеткой (для активного врача / активного дня) ──────────────
  const metrics = useMemo(() => {
    const slots = activeDayInfo?.slots || []
    let confirmed = 0, pending = 0, taken = 0
    for (const s of slots) {
      const a = s.appointment
      if (!a) continue
      taken += 1
      if (a.status === 'confirmed' || a.status === 'completed') confirmed += 1
      else if (a.status === 'pending') pending += 1
    }
    return {
      total: taken,
      confirmed,
      pending,
      free: Math.max(0, slots.length - taken),
      slotsCount: slots.length,
    }
  }, [activeDayInfo])

  // ── Фильтрация левой панели по поиску ─────────────────────────────────────
  const filteredDoctors = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    if (!q) return doctors
    return doctors.filter(d =>
      (d.full_name || '').toLowerCase().includes(q) ||
      (d.specialty || '').toLowerCase().includes(q)
    )
  }, [doctors, searchQuery])

  // ── Клики по слотам ───────────────────────────────────────────────────────
  const onPickSlot = (slot) => {
    if (slot.appointment) {
      setDetailsModal({
        appointment: slot.appointment,
        date: ymd(activeDate),
        start_time: slot.start_time,
      })
    } else {
      setBookModal({ date: ymd(activeDate), start_time: slot.start_time })
    }
  }

  // ── Создание записи (используется в BookModal) ────────────────────────────
  const onCreate = async (form) => {
    if (!activeDoctorId) throw new Error('Сначала выберите врача')
    if (!form.patient_phone || !form.patient_phone.trim()) {
      throw new Error('Укажите телефон пациента')
    }
    try {
      await api.post('/appointments', {
        doctor_id: activeDoctorId,
        appointment_date: bookModal.date,
        start_time: bookModal.start_time,
        patient_phone: form.patient_phone.trim(),
        patient_name: form.patient_name || null,
        notes: form.notes || null,
      })
      setBookModal(null)
      loadWeek()
      reloadDayCounts()
    } catch (e) {
      const det = e?.response?.data?.detail
      let msg = 'Ошибка создания'
      if (typeof det === 'string') msg = det
      else if (Array.isArray(det) && det.length) {
        msg = det.map(x => x?.msg || JSON.stringify(x)).join('; ')
      } else if (e?.message) msg = e.message
      throw new Error(msg)
    }
  }

  // ── Текущее время для now-подсветки ───────────────────────────────────────
  const isNowSlot = useCallback((slotTime) => {
    if (!sameYMD(activeDate, new Date())) return false
    const now = new Date(nowTick)
    const [h, m] = slotTime.split(':').map(Number)
    const dur = weekData?.slot_duration || 30
    const startMin = h * 60 + m
    const nowMin = now.getHours() * 60 + now.getMinutes()
    return nowMin >= startMin && nowMin < startMin + dur
  }, [activeDate, nowTick, weekData])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="slot-board">
      <SlotBoardStyles />

      <div className="sb-toolbar">
        <div className="sb-toolbar-left">
          <button className="sb-btn-icon" onClick={() => {
            const prev = addDays(activeDate, -1)
            setActiveDate(prev)
          }} aria-label="Предыдущий день">
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
          <button className="sb-btn-today" onClick={() => setActiveDate(new Date())}>
            Сегодня
          </button>
          <button className="sb-btn-icon" onClick={() => {
            const next = addDays(activeDate, 1)
            setActiveDate(next)
          }} aria-label="Следующий день">
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
          <div className="sb-date-label">
            {activeDate.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>
        <div className="sb-toolbar-right">
          <Button
            variant="primary"
            size="sm"
            onClick={() => setBookModal({ date: ymd(activeDate), start_time: '10:00' })}
            leftIcon={<span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>}
          >
            Новая запись
          </Button>
        </div>
      </div>

      {error && (
        <div className="sb-error">{error}</div>
      )}

      <section className="sb-schedule">
        {/* ── Левая панель: список врачей ─────────────────────────────── */}
        <aside className="sb-doctors-panel">
          <div className="sb-doctors-search">
            <div className="sb-search-box">
              <span className="material-symbols-outlined">search</span>
              <input
                type="search"
                placeholder="Найти врача…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="sb-doctors-list">
            {doctors.length === 0 ? (
              <div className="sb-empty">Врачей пока нет</div>
            ) : filteredDoctors.length === 0 ? (
              <div className="sb-empty">Ничего не найдено</div>
            ) : (
              filteredDoctors.map(d => {
                const isActive = d.id === activeDoctorId
                const color = doctorColor(d.id)
                const cnt = dayCounts[d.id] || 0
                // Для активного врача знаем точное число слотов; для остальных — только N записей
                const slotsTotal = isActive ? metrics.slotsCount : null
                const loadPct = isActive && slotsTotal
                  ? Math.min(100, Math.round((cnt / slotsTotal) * 100))
                  : Math.min(100, cnt * 10)
                return (
                  <div
                    key={d.id}
                    className={`sb-doctor-card ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveDoctorId(d.id)}
                  >
                    <div className="sb-doctor-row">
                      <div className="sb-doctor-avatar" style={{ background: color }}>
                        {doctorInitials(d.full_name)}
                      </div>
                      <div className="sb-doctor-meta">
                        <div className="sb-doctor-name" title={d.full_name}>{d.full_name}</div>
                        <div className="sb-doctor-spec" title={d.specialty || ''}>
                          {d.specialty || '—'}
                        </div>
                      </div>
                    </div>
                    <div className="sb-doctor-load">
                      <div className="sb-load-bar">
                        <div
                          className="sb-load-fill"
                          style={{ width: `${loadPct}%`, background: color }}
                        />
                      </div>
                      <div className="sb-load-count">
                        {slotsTotal != null ? `${cnt}/${slotsTotal}` : `${cnt}`}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </aside>

        {/* ── Правая панель: шапка + сетка слотов ─────────────────────── */}
        <section className="sb-slots-panel">
          <header className="sb-slots-header">
            <div className="sb-slots-doctor">
              {activeDoctor ? (
                <>
                  <div className="sb-doctor-avatar lg" style={{ background: doctorColor(activeDoctor.id) }}>
                    {doctorInitials(activeDoctor.full_name)}
                  </div>
                  <div className="sb-slots-doctor-info">
                    <div className="sb-slots-doctor-name">{activeDoctor.full_name}</div>
                    <div className="sb-slots-doctor-spec">{activeDoctor.specialty || '—'}</div>
                  </div>
                </>
              ) : (
                <div className="sb-slots-doctor-info">
                  <div className="sb-slots-doctor-name">—</div>
                  <div className="sb-slots-doctor-spec">Выберите врача</div>
                </div>
              )}
              <div className="sb-slots-metrics">
                <div className="sb-metric">
                  <div className="sb-metric-value">{metrics.total}</div>
                  <div className="sb-metric-label">Всего</div>
                </div>
                <div className="sb-metric confirmed">
                  <div className="sb-metric-value">{metrics.confirmed}</div>
                  <div className="sb-metric-label">Подтв.</div>
                </div>
                <div className="sb-metric pending">
                  <div className="sb-metric-value">{metrics.pending}</div>
                  <div className="sb-metric-label">Ожидают</div>
                </div>
                <div className="sb-metric free">
                  <div className="sb-metric-value">{metrics.free}</div>
                  <div className="sb-metric-label">Свободно</div>
                </div>
              </div>
            </div>

            <div className="sb-weekdays">
              {weekDays.map(d => (
                <div
                  key={d.ymd}
                  className={`sb-weekday ${d.isActive ? 'active' : ''} ${d.isToday ? 'today' : ''}`}
                  onClick={() => setActiveDate(d.date)}
                >
                  <div className="sb-weekday-name">{d.name}</div>
                  <div className="sb-weekday-date">{d.dateNum}</div>
                </div>
              ))}
            </div>
          </header>

          <div className="sb-slots-grid">
            {loadingWeek && !weekData ? (
              <div className="sb-grid-state">Загрузка расписания…</div>
            ) : !activeDayInfo ? (
              <div className="sb-grid-state">Нет данных</div>
            ) : !activeDayInfo.is_working ? (
              <div className="sb-grid-state">Нерабочий день</div>
            ) : (activeDayInfo.slots || []).length === 0 ? (
              <div className="sb-grid-state">Расписание не настроено</div>
            ) : (
              renderSlotsGrid(activeDayInfo.slots, activeDoctor, isNowSlot, onPickSlot)
            )}
          </div>
        </section>
      </section>

      {/* ── Модал создания записи ────────────────────────────────────── */}
      {bookModal && (
        <BookModal
          ctx={bookModal}
          doctorName={activeDoctor?.full_name || ''}
          onClose={() => setBookModal(null)}
          onCreate={onCreate}
        />
      )}

      {/* ── Модал карточки приёма (заключение/файлы/направления/история) — */}
      {detailsModal && (
        <AppointmentDetailsModal
          ctx={detailsModal}
          onClose={() => setDetailsModal(null)}
          onChanged={() => { loadWeek(); reloadDayCounts() }}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// БЛОК: render-помощник для сетки слотов (с почасовыми разделителями)
// ──────────────────────────────────────────────────────────────────────────────
function renderSlotsGrid(slots, doctor, isNowSlot, onPickSlot) {
  const out = []
  let lastBucket = -1
  const docColor = doctor ? doctorColor(doctor.id) : '#0e7490'

  slots.forEach((s, idx) => {
    const t = s.start_time
    const h = parseInt(t.slice(0, 2), 10)
    const bucket = Math.floor(h / 2) * 2
    if (bucket !== lastBucket) {
      out.push(
        <div key={`hm-${bucket}-${idx}`} className="sb-hour-marker">
          {String(bucket).padStart(2, '0')}:00 — {String(bucket + 2).padStart(2, '0')}:00
        </div>
      )
      lastBucket = bucket
    }
    const a = s.appointment
    const now = isNowSlot(t)
    if (a) {
      const st = STATUSES[a.status] || STATUSES.pending
      const isCancelled = a.status === 'cancelled'
      const isCompleted = a.status === 'completed'
      const isUrgent = a.priority === 'urgent'
      const isHigh = a.priority === 'high'
      out.push(
        <div
          key={`s-${t}-${a.id}`}
          className={[
            'sb-slot-cell', 'colored',
            isCancelled ? 'cancelled' : '',
            isCompleted ? 'completed' : '',
            a.has_outcome ? 'has-emr' : '',
            now ? 'now' : '',
            isUrgent ? 'urgent' : (isHigh ? 'high' : ''),
          ].filter(Boolean).join(' ')}
          style={{
            borderLeftColor: isCancelled
              ? 'var(--border-strong)'
              : (isUrgent ? '#dc2626' : (isHigh ? '#eab308' : docColor)),
          }}
          onClick={() => onPickSlot(s)}
          title={`${a.patient_name || a.patient_phone || '—'} · ${st.label}`}
        >
          <div className="sb-slot-top">
            <span className="sb-slot-time">{t}</span>
            <span className={`sb-status-chip ${st.cls}`}>
              <span className="material-symbols-outlined">{st.icon}</span>
              {st.label}
            </span>
          </div>
          <div className="sb-slot-patient-line">
            <span className="sb-slot-patient-name">
              {a.patient_name || a.patient_phone || '—'}
            </span>
          </div>
          {a.notes && (
            <div className="sb-slot-service">{a.notes}</div>
          )}
          <div className="sb-slot-bottom">
            <span className="sb-slot-phone">{a.patient_phone || ''}</span>
            <span className="sb-slot-badges">
              {(isHigh || isUrgent) && (
                <span className="sb-prio-tag" title={isUrgent ? 'Срочно' : 'Приоритет'}>
                  {isUrgent ? '⚡' : '⭐'}
                </span>
              )}
              {a.referrals_count > 0 && (
                <span className="sb-ref-tag" title={`Направлений: ${a.referrals_count}`}>
                  → {a.referrals_count}
                </span>
              )}
            </span>
          </div>
        </div>
      )
    } else {
      out.push(
        <div
          key={`s-${t}-free`}
          className={`sb-slot-cell free ${now ? 'now' : ''}`}
          onClick={() => onPickSlot(s)}
          title={`Свободно · ${t}`}
        >
          <div className="sb-slot-top">
            <span className="sb-slot-time">{t}</span>
          </div>
          <div className="sb-slot-free-text">
            <span className="material-symbols-outlined">add</span>
            <span>Свободно</span>
          </div>
        </div>
      )
    }
  })
  return out
}

// ──────────────────────────────────────────────────────────────────────────────
// БЛОК: Модал создания записи
// ──────────────────────────────────────────────────────────────────────────────
function BookModal({ ctx, doctorName, onClose, onCreate }) {
  const [form, setForm] = useState({ patient_phone: '', patient_name: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    setErr('')
    setSaving(true)
    try {
      await onCreate(form)
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    padding: '12px 14px',
    borderRadius: '12px',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--fg)',
    fontSize: 14,
    width: '100%',
    minHeight: 44,
    outline: 'none',
  }

  return (
    <Modal open onClose={onClose} title="Запись на приём">
      <div className="text-xs mb-4" style={{ color: 'var(--fg-3)' }}>
        {ctx.date} · {ctx.start_time} · {doctorName}
      </div>
      <div className="space-y-3">
        <input
          type="tel"
          placeholder="Телефон пациента +7…"
          value={form.patient_phone}
          onChange={e => setForm({ ...form, patient_phone: e.target.value })}
          style={inputStyle}
        />
        <input
          placeholder="ФИО пациента"
          value={form.patient_name}
          onChange={e => setForm({ ...form, patient_name: e.target.value })}
          style={inputStyle}
        />
        <textarea
          placeholder="Примечания (необязательно)"
          value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })}
          rows={2}
          style={{ ...inputStyle, resize: 'none' }}
        />
      </div>
      {err && (
        <div
          className="mt-3 text-xs px-3 py-2 rounded-xl"
          style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}
        >
          {err}
        </div>
      )}
      <div className="flex gap-2 mt-4">
        <Button variant="secondary" onClick={onClose} className="flex-1">Отмена</Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={saving || !form.patient_phone}
          className="flex-1"
        >
          {saving ? 'Создание…' : 'Записать'}
        </Button>
      </div>
    </Modal>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// БЛОК: Локальные стили (изолированы под .slot-board, чтобы не утечь в страницу)
// ──────────────────────────────────────────────────────────────────────────────
function SlotBoardStyles() {
  return (
    <style>{`
.slot-board {
  --sb-bg: var(--bg-2, #f8f9fb);
  --sb-surface: var(--surface, #ffffff);
  --sb-border: var(--border, #e6e8ed);
  --sb-border-strong: #d4d7de;
  --sb-text: var(--fg, #1a1d23);
  --sb-text-soft: var(--fg-2, #5a6270);
  --sb-text-mute: var(--fg-3, #8b92a0);
  --sb-accent: var(--accent, #0e7490);
  --sb-accent-light: rgba(14,116,144,0.10);
  --sb-shadow-sm: 0 1px 2px rgba(15,23,42,0.04);
  --sb-shadow-md: 0 4px 12px rgba(15,23,42,0.06);
  display: flex;
  flex-direction: column;
  min-height: 70vh;
  background: var(--sb-surface);
  font-size: 14px;
  color: var(--sb-text);
}
.slot-board .material-symbols-outlined { font-size: 18px; line-height: 1; }

/* ── Toolbar ───────────────────────────────────────────── */
.slot-board .sb-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--sb-surface);
  border-bottom: 1px solid var(--sb-border);
  flex-wrap: wrap;
}
.slot-board .sb-toolbar-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.slot-board .sb-btn-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: var(--sb-surface);
  border: 1px solid var(--sb-border);
  color: var(--sb-text-soft);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.slot-board .sb-btn-icon:hover { background: var(--sb-bg); color: var(--sb-text); }
.slot-board .sb-btn-today {
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid var(--sb-border);
  background: var(--sb-surface);
  color: var(--sb-text);
  font-weight: 600; font-size: 13px;
  cursor: pointer; min-height: 36px;
  font-family: inherit;
}
.slot-board .sb-btn-today:hover { background: var(--sb-bg); }
.slot-board .sb-date-label {
  margin-left: 8px;
  font-weight: 600;
  font-size: 14px;
  color: var(--sb-text);
  text-transform: capitalize;
}
.slot-board .sb-toolbar-right { display: flex; gap: 8px; }

.slot-board .sb-error {
  margin: 10px 16px 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--bad-soft, #fef2f2);
  color: var(--bad, #b91c1c);
  font-size: 13px;
}

/* ── Schedule layout ───────────────────────────────────── */
.slot-board .sb-schedule {
  display: flex;
  flex: 1;
  min-height: 0;
}
.slot-board .sb-doctors-panel {
  width: 240px;
  background: var(--sb-surface);
  border-right: 1px solid var(--sb-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.slot-board .sb-doctors-search {
  padding: 12px;
  border-bottom: 1px solid var(--sb-border);
}
.slot-board .sb-search-box {
  position: relative;
}
.slot-board .sb-search-box .material-symbols-outlined {
  position: absolute;
  left: 10px; top: 50%;
  transform: translateY(-50%);
  color: var(--sb-text-mute);
  font-size: 18px;
  pointer-events: none;
}
.slot-board .sb-search-box input {
  width: 100%;
  padding: 8px 10px 8px 34px;
  border: 1px solid var(--sb-border);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  background: var(--sb-surface);
  color: var(--sb-text);
}
.slot-board .sb-search-box input:focus { border-color: var(--sb-accent); }
.slot-board .sb-doctors-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
  max-height: calc(70vh + 50px);
}
.slot-board .sb-empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--sb-text-mute);
  font-size: 12px;
}
.slot-board .sb-doctor-card {
  padding: 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 2px;
}
.slot-board .sb-doctor-card:hover { background: var(--sb-bg); }
.slot-board .sb-doctor-card.active { background: var(--sb-accent-light); }
.slot-board .sb-doctor-row {
  display: flex; align-items: center; gap: 10px;
}
.slot-board .sb-doctor-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 700; font-size: 12px;
  flex-shrink: 0;
}
.slot-board .sb-doctor-avatar.lg { width: 44px; height: 44px; font-size: 14px; }
.slot-board .sb-doctor-meta { flex: 1; min-width: 0; }
.slot-board .sb-doctor-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--sb-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slot-board .sb-doctor-spec {
  font-size: 11px;
  color: var(--sb-text-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slot-board .sb-doctor-load {
  display: flex; align-items: center; gap: 8px;
  padding-top: 2px;
}
.slot-board .sb-load-bar {
  flex: 1;
  height: 4px;
  background: var(--sb-border);
  border-radius: 4px;
  overflow: hidden;
}
.slot-board .sb-load-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.25s ease;
}
.slot-board .sb-load-count {
  font-size: 10px;
  color: var(--sb-text-mute);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* ── Slots panel header ────────────────────────────────── */
.slot-board .sb-slots-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--sb-bg);
}
.slot-board .sb-slots-header {
  background: var(--sb-surface);
  border-bottom: 1px solid var(--sb-border);
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex-shrink: 0;
}
.slot-board .sb-slots-doctor {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.slot-board .sb-slots-doctor-info {
  flex: 1;
  min-width: 160px;
}
.slot-board .sb-slots-doctor-name {
  font-size: 17px;
  font-weight: 700;
  color: var(--sb-text);
}
.slot-board .sb-slots-doctor-spec {
  font-size: 13px;
  color: var(--sb-text-soft);
}
.slot-board .sb-slots-metrics {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}
.slot-board .sb-metric { text-align: right; }
.slot-board .sb-metric-value {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--sb-text);
}
.slot-board .sb-metric-label {
  font-size: 11px;
  color: var(--sb-text-mute);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.slot-board .sb-metric.confirmed .sb-metric-value { color: #059669; }
.slot-board .sb-metric.pending .sb-metric-value { color: #d97706; }
.slot-board .sb-metric.free .sb-metric-value { color: var(--sb-text-mute); }

/* ── Weekday switcher ──────────────────────────────────── */
.slot-board .sb-weekdays {
  display: flex;
  gap: 6px;
  padding-top: 4px;
}
.slot-board .sb-weekday {
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  text-align: center;
  cursor: pointer;
  border: 1px solid var(--sb-border);
  background: var(--sb-surface);
  transition: all 0.15s;
  user-select: none;
}
.slot-board .sb-weekday:hover { border-color: var(--sb-accent); }
.slot-board .sb-weekday.active {
  background: var(--sb-accent);
  border-color: var(--sb-accent);
  color: white;
}
.slot-board .sb-weekday-name {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.slot-board .sb-weekday.active .sb-weekday-name { color: rgba(255,255,255,0.85); }
.slot-board .sb-weekday-date {
  font-size: 15px;
  font-weight: 700;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}
.slot-board .sb-weekday.today:not(.active) .sb-weekday-date { color: var(--sb-accent); }

/* ── Slots grid ────────────────────────────────────────── */
.slot-board .sb-slots-grid {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 24px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  align-content: start;
}
.slot-board .sb-grid-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 60px 0;
  color: var(--sb-text-mute);
  font-size: 14px;
}
.slot-board .sb-hour-marker {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--sb-text-mute);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.slot-board .sb-hour-marker::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--sb-border);
}
.slot-board .sb-hour-marker:first-child { padding-top: 0; }

.slot-board .sb-slot-cell {
  background: var(--sb-surface);
  border: 1px solid var(--sb-border);
  border-radius: 12px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
  transition: all 0.15s;
  min-height: 110px;
  cursor: pointer;
}
.slot-board .sb-slot-cell.colored { border-left: 4px solid; }
.slot-board .sb-slot-cell.colored:hover {
  box-shadow: var(--sb-shadow-md);
  transform: translateY(-1px);
}
.slot-board .sb-slot-cell.cancelled { opacity: 0.65; }
.slot-board .sb-slot-cell.cancelled .sb-slot-patient-name {
  text-decoration: line-through;
  color: var(--sb-text-mute);
}
.slot-board .sb-slot-cell.completed {
  background: linear-gradient(180deg, rgba(5,150,105,0.04), transparent);
}
.slot-board .sb-slot-cell.high {
  background: linear-gradient(135deg, rgba(250,204,21,0.08) 0%, rgba(255,255,255,1) 100%);
}
.slot-board .sb-slot-cell.urgent {
  background: linear-gradient(135deg, rgba(239,68,68,0.10) 0%, rgba(255,255,255,1) 100%);
}
.slot-board .sb-slot-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}
.slot-board .sb-slot-time {
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.slot-board .sb-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}
.slot-board .sb-status-chip .material-symbols-outlined {
  font-size: 12px;
}
.slot-board .status-confirmed { background: #ecfdf5; color: #047857; }
.slot-board .status-pending { background: #fef3c7; color: #92400e; }
.slot-board .status-cancelled { background: #f1f5f9; color: #64748b; }
.slot-board .status-completed { background: #dbeafe; color: #1d4ed8; }
.slot-board .sb-slot-patient-line {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}
.slot-board .sb-slot-patient-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slot-board .sb-slot-service {
  font-size: 12px;
  color: var(--sb-text-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slot-board .sb-slot-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding-top: 4px;
}
.slot-board .sb-slot-phone {
  font-size: 11px;
  color: var(--sb-text-mute);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slot-board .sb-slot-badges {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.slot-board .sb-prio-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
  background: #fffbeb;
}
.slot-board .sb-ref-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  background: rgba(14,165,233,0.15);
  color: #075985;
}
.slot-board .sb-slot-cell.has-emr::after {
  content: '✓';
  position: absolute;
  bottom: 6px; right: 8px;
  font-size: 11px;
  font-weight: 700;
  color: #059669;
  opacity: 0.7;
}
.slot-board .sb-slot-cell.free {
  background: transparent;
  border: 1px dashed var(--sb-border-strong);
  align-items: stretch;
  color: var(--sb-text-mute);
  min-height: 110px;
}
.slot-board .sb-slot-cell.free .sb-slot-top { width: 100%; }
.slot-board .sb-slot-free-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 1;
  justify-content: center;
}
.slot-board .sb-slot-free-text .material-symbols-outlined { font-size: 22px; }
.slot-board .sb-slot-cell.free:hover {
  border-color: var(--sb-accent);
  border-style: solid;
  color: var(--sb-accent);
  background: rgba(14,116,144,0.04);
}
.slot-board .sb-slot-cell.now {
  box-shadow: 0 0 0 2px #ef4444, var(--sb-shadow-md);
}
.slot-board .sb-slot-cell.now::before {
  content: '';
  position: absolute;
  top: -5px; right: -5px;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: #ef4444;
  border: 2px solid var(--sb-surface);
  box-shadow: 0 0 0 4px rgba(239,68,68,0.18);
}

@media (max-width: 1280px) {
  .slot-board .sb-slots-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 980px) {
  .slot-board .sb-slots-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 768px) {
  .slot-board .sb-schedule { flex-direction: column; }
  .slot-board .sb-doctors-panel {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--sb-border);
  }
  .slot-board .sb-doctors-list {
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 12px;
    gap: 8px;
    max-height: none;
  }
  .slot-board .sb-doctor-card { flex-shrink: 0; min-width: 220px; }
  .slot-board .sb-slots-grid { grid-template-columns: 1fr; }
  .slot-board .sb-slots-metrics { gap: 14px; }
  .slot-board .sb-slots-header { padding: 12px 14px; }
  .slot-board .sb-toolbar { padding: 10px 14px; }
}
`}</style>
  )
}
