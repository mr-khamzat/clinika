/**
 * WeekScheduleSection — премиум-расписание врачей (стиль design-preview-2).
 *
 * Используется тремя ролями:
 *   - doctor      → mode='self', свой собственный календарь, action=mark (status, notes)
 *   - manager/    → mode='full', выбор врача + полное редактирование (book, move, cancel)
 *     admin/
 *     supervisor/
 *     nurse
 *
 * Backend:
 *   GET  /doctors                                         — список врачей тенанта
 *   GET  /doctors/{id}/week?start_date=YYYY-MM-DD         — слоты+записи на неделю
 *   POST /appointments                                    — создать запись
 *   PATCH /appointments/{id}                              — перенести (date/time)
 *   PATCH /appointments/{id}/status                       — confirm/cancel/complete/no_show
 *
 * Миграция (#29): шапка / KPI / модалы → дизайн-система (Card, KpiRow, KpiCard, Button, Tabs, Chip, Modal).
 * TODO: сама сетка-таблица недели (WeekGrid) и список одного дня (DayList) оставлены в нативной разметке —
 *       они слишком кастомные (drag-and-drop, position-aware grid, гибридная адаптивность).
 *       Их можно мигрировать поэтапно отдельным PR.
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import api from '../../api'
import { Card, KpiRow, KpiCard, Button, Tabs, Chip, Modal, QuickActions, buildPatientCardActions } from '../../design'
// Видео-комната телемед-приёма (lazy, чтобы не утяжелять основной bundle расписания)
import { lazy, Suspense } from 'react'
const TelemedRoomModal = lazy(() => import('../../components/telemed/TelemedRoomModal'))
// Модалка карточки приёма (заключение / файлы / направления / история)
import AppointmentDetailsModal from '../../components/scheduling/AppointmentDetailsModal'

// ── helpers ──────────────────────────────────────────────────────────────────
const DAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
// Статусы записей: фон достаточно насыщенный чтобы цвет читался при беглом
// взгляде на расписание; border слева 3px усиливает узнаваемость.
const STATUS_INFO = {
  pending:   { l: 'Ожидает',     bg: 'rgba(245,158,11,0.20)',  c: '#92400e', border: '#f59e0b', dot: '#f59e0b', chip: 'warn'    },
  confirmed: { l: 'Подтверждён', bg: 'rgba(14,165,233,0.20)',  c: '#075985', border: '#0ea5e9', dot: '#0ea5e9', chip: 'accent'  },
  completed: { l: 'Выполнено',   bg: 'rgba(34,197,94,0.20)',   c: '#14532d', border: '#22c55e', dot: '#22c55e', chip: 'good'    },
  cancelled: { l: 'Отменён',     bg: 'rgba(244,63,94,0.18)',   c: '#9f1239', border: '#f43f5e', dot: '#f43f5e', chip: 'bad'     },
  no_show:   { l: 'Не пришёл',   bg: 'rgba(168,85,247,0.20)',  c: '#581c87', border: '#a855f7', dot: '#a855f7', chip: 'default' },
}
// Приоритетная запись — золотая подсветка поверх любого статуса.
const PRIORITY_HIGH_BG = 'linear-gradient(135deg, rgba(250,204,21,0.30) 0%, rgba(245,158,11,0.18) 100%)'
const PRIORITY_HIGH_BORDER = '#eab308' 

function ymd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function startOfWeek(d) {
  // Понедельник как начало
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

function isMobile() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 767px)').matches
}

// ── main ─────────────────────────────────────────────────────────────────────
export default function WeekScheduleSection({
  token,
  mode = 'full',          // 'full' | 'self'
  selfDoctorId = null,    // если mode='self' — id своего врача
  selfDoctorName = '',
}) {
  const [telemedRoomId, setTelemedRoomId] = useState(null)
  const [doctors, setDoctors] = useState([])
  // Слушаем глобальное событие для открытия телемед-комнаты (из ApptModal)
  useEffect(() => {
    const onOpen = (e) => { if (e?.detail?.sessionId) setTelemedRoomId(e.detail.sessionId) }
    window.addEventListener('open-telemed-room', onOpen)
    return () => window.removeEventListener('open-telemed-room', onOpen)
  }, [])
  const [doctorId, setDoctorId] = useState(selfDoctorId || '')
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()))
  const [data, setData] = useState(null)         // ответ /doctors/{id}/week
  const [loading, setLoading] = useState(false)
  const [mobileView, setMobileView] = useState(isMobile() ? 'day' : 'week')
  const [activeDayIdx, setActiveDayIdx] = useState(() => (new Date().getDay() + 6) % 7)

  // Модалы
  const [bookModal, setBookModal] = useState(null)      // { date, start_time }
  const [apptModal, setApptModal] = useState(null)      // { appointment, date, start_time } — старая модалка статуса/переноса (legacy)
  const [detailsModal, setDetailsModal] = useState(null) // { appointment, date, start_time } — карточка приёма (заключение/файлы/направления/история)
  const [moveDrag, setMoveDrag] = useState(null)        // { appointment, fromKey }
  const [error, setError] = useState('')

  // Подгрузка списка врачей (для mode=full)
  useEffect(() => {
    if (mode !== 'full') return
    api.get('/doctors')
      .then(r => {
        const list = Array.isArray(r.data) ? r.data : []
        setDoctors(list)
        if (list.length && !doctorId) setDoctorId(list[0].id)
      })
      .catch(() => {})
  }, [mode, token])

  // Реакция на ресайз (десктоп ↔ мобильный)
  useEffect(() => {
    const onResize = () => setMobileView(isMobile() ? 'day' : 'week')
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const loadWeek = useCallback(async () => {
    if (!doctorId) return
    setLoading(true)
    setError('')
    try {
      const r = await api.get(`/doctors/${doctorId}/week`, {
        params: { start_date: ymd(weekStart) },
      })
      setData(r.data)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить расписание')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [doctorId, weekStart])

  useEffect(() => { loadWeek() }, [loadWeek])

  // Сетка часов: общее окно work-hours по неделе
  const hoursAxis = useMemo(() => {
    if (!data?.days) return []
    let minH = 23, maxH = 0
    for (const d of data.days) {
      if (!d.is_working) continue
      const sh = parseInt((d.start_time || '09:00').slice(0, 2), 10)
      const eh = parseInt((d.end_time   || '18:00').slice(0, 2), 10)
      if (sh < minH) minH = sh
      if (eh > maxH) maxH = eh
    }
    if (minH > maxH) { minH = 9; maxH = 18 }
    const arr = []
    for (let h = minH; h < maxH; h++) arr.push(`${String(h).padStart(2, '0')}:00`)
    return arr
  }, [data])

  // KPI
  const kpi = useMemo(() => {
    if (!data?.days) return { total: 0, taken: 0, free: 0 }
    let total = 0, taken = 0
    for (const d of data.days) for (const s of d.slots) {
      total++
      if (!s.available) taken++
    }
    return { total, taken, free: total - taken, load: total ? Math.round(taken / total * 100) : 0 }
  }, [data])

  const reload = () => loadWeek()

  // Действия
  const onCreate = async (form) => {
    // Защита от race-condition: запрос на /doctors ещё не вернулся → doctorId='' → 422
    if (!doctorId) {
      throw new Error('Сначала выберите врача (список ещё загружается)')
    }
    if (!form.patient_phone || !form.patient_phone.trim()) {
      throw new Error('Укажите телефон пациента')
    }
    try {
      // is_telemed: backend принимает либо нативное поле, либо хранит в notes JSON.
      // Дублируем флаг в notes, чтобы на бэкенде без миграции тоже было видно (#telemed marker).
      const payload = {
        doctor_id: doctorId,
        appointment_date: bookModal.date,
        start_time: bookModal.start_time,
        patient_phone: form.patient_phone.trim(),
        patient_name: form.patient_name || null,
        notes: form.notes || null,
        is_telemed: !!form.is_telemed,
      }
      if (form.is_telemed && !payload.notes) {
        payload.notes = '[ТЕЛЕМЕД] Видео-консультация'
      } else if (form.is_telemed && payload.notes && !/телемед|telemed/i.test(payload.notes)) {
        payload.notes = '[ТЕЛЕМЕД] ' + payload.notes
      }
      await api.post('/appointments', payload)
      setBookModal(null)
      reload()
    } catch (e) {
      // FastAPI 422 возвращает detail как массив объектов — превращаем в строку,
      // иначе пользователь видел "[object Object]" (#23).
      const det = e?.response?.data?.detail
      let msg = 'Ошибка создания'
      if (typeof det === 'string') msg = det
      else if (Array.isArray(det) && det.length) msg = det.map(x => x?.msg || JSON.stringify(x)).join('; ')
      else if (e?.message) msg = e.message
      throw new Error(msg)
    }
  }

  const onStatus = async (id, status) => {
    await api.patch(`/appointments/${id}/status`, { status })
    setApptModal(null)
    reload()
  }

  const onMove = async (id, newDate, newTime) => {
    await api.patch(`/appointments/${id}`, {
      appointment_date: newDate,
      start_time: newTime,
    })
    setMoveDrag(null)
    setApptModal(null)
    reload()
  }

  const canEdit = mode === 'full'

  return (
    <div className="px-4 pb-24 max-w-[1280px] mx-auto">
      {/* ===== БЛОК: Шапка (выбор врача, неделя, view-toggle, +Запись) ===== */}
      <Header
        mode={mode}
        doctors={doctors}
        doctorId={doctorId}
        setDoctorId={setDoctorId}
        weekStart={weekStart}
        setWeekStart={setWeekStart}
        mobileView={mobileView}
        setMobileView={setMobileView}
        canEdit={canEdit}
        onAdd={() => setBookModal({ date: ymd(addDays(weekStart, activeDayIdx)), start_time: '10:00' })}
        selfDoctorName={selfDoctorName}
      />

      {error && (
        <div className="mb-3 px-3 py-2 rounded-xl text-sm"
          style={{ background: 'var(--bad-soft)', color: 'var(--bad)', border: '1px solid var(--bad-soft)' }}>
          {error}
        </div>
      )}

      {/* ===== БЛОК: Сетка недели или список дня =====
          TODO(#29): WeekGrid и DayList используют нестандартную верстку (CSS-grid с display:contents,
          drag-and-drop, гибридные мобильные чипы). Оставлены как есть — при переходе на дизайн-систему
          цвета статусов и контейнеры карточки могут быть постепенно унифицированы. */}
      {loading && !data ? (
        <div className="text-center py-16" style={{ color: 'var(--fg-3)' }}>Загрузка расписания…</div>
      ) : !data ? (
        <div className="text-center py-16" style={{ color: 'var(--fg-3)' }}>Нет данных</div>
      ) : mobileView === 'week' ? (
        <WeekGrid
          data={data}
          hours={hoursAxis}
          canEdit={canEdit}
          onPickEmpty={(date, time) => canEdit && setBookModal({ date, start_time: time })}
          onPickAppt={(apt, date, time) => setDetailsModal({ appointment: apt, date, start_time: time })}
          moveDrag={moveDrag}
          setMoveDrag={canEdit ? setMoveDrag : () => {}}
          onDropMove={(toDate, toTime) => moveDrag && onMove(moveDrag.appointment.id, toDate, toTime)}
        />
      ) : (
        <DayList
          data={data}
          hours={hoursAxis}
          activeDayIdx={activeDayIdx}
          setActiveDayIdx={setActiveDayIdx}
          canEdit={canEdit}
          onPickEmpty={(date, time) => canEdit && setBookModal({ date, start_time: time })}
          onPickAppt={(apt, date, time) => setDetailsModal({ appointment: apt, date, start_time: time })}
        />
      )}

      {/* ===== БЛОК: KPI недели ===== */}
      <KpiRow cols={3} className="mt-4">
        <KpiCard
          label="Слотов в неделе"
          value={kpi.total}
          delta={data?.slot_duration ? `по ${data.slot_duration} мин` : ''}
          trend="flat"
        />
        <KpiCard
          label="Занято"
          value={kpi.taken}
          delta={`${kpi.load || 0}% загрузка`}
          trend={kpi.load >= 70 ? 'up' : 'flat'}
        />
        <KpiCard
          label="Свободно"
          value={kpi.free}
          delta="видны пациентам"
          trend="flat"
        />
      </KpiRow>

      {/* ===== БЛОК: Модалы ===== */}
      {telemedRoomId && (
        <Suspense fallback={null}>
          <TelemedRoomModal
            sessionId={telemedRoomId}
            onClose={() => { setTelemedRoomId(null); reload() }}
          />
        </Suspense>
      )}

      {bookModal && (
        <BookModal
          ctx={bookModal}
          doctorName={data?.doctor_name || selfDoctorName}
          onClose={() => setBookModal(null)}
          onCreate={onCreate}
        />
      )}
      {apptModal && (
        <ApptModal
          ctx={apptModal}
          canEdit={canEdit}
          onClose={() => setApptModal(null)}
          onStatus={onStatus}
          onMove={onMove}
          weekStart={weekStart}
        />
      )}
      {detailsModal && (
        <AppointmentDetailsModal
          ctx={detailsModal}
          onClose={() => setDetailsModal(null)}
          onChanged={() => reload()}
        />
      )}
    </div>
  )
}

// ── Header ───────────────────────────────────────────────────────────────────
function Header({ mode, doctors, doctorId, setDoctorId, weekStart, setWeekStart, mobileView, setMobileView, canEdit, onAdd, selfDoctorName }) {
  const ws = weekStart
  const we = addDays(weekStart, 6)
  const fmt = (d) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  const title = `${fmt(ws)} – ${fmt(we)} ${we.getFullYear()}`

  // ===== БЛОК: View-toggle (Неделя / День) =====
  const viewItems = [
    { id: 'week', label: 'Неделя' },
    { id: 'day',  label: 'День' },
  ]

  return (
    <div className="mb-5">
      <div className="flex items-start gap-3 flex-wrap mb-3">
        <div className="flex-1 min-w-[200px]">
          <h2 className="text-xl md:text-2xl font-black" style={{ color: 'var(--fg)' }}>Расписание</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--fg-3)' }}>{title}</p>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={onAdd}
            leftIcon={<span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>}>
            Запись
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {mode === 'full' && (
          <select value={doctorId} onChange={e => setDoctorId(e.target.value)}
            className="text-sm font-medium min-w-[200px]"
            style={{
              padding: '10px 12px',
              borderRadius: '10px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--fg)',
              minHeight: 44,
            }}>
            {doctors.map(d => (
              <option key={d.id} value={d.id}>
                {d.full_name || d.name}{d.specialty ? ` · ${d.specialty}` : ''}
              </option>
            ))}
          </select>
        )}
        {mode === 'self' && selfDoctorName && (
          <Chip variant="accent">{selfDoctorName}</Chip>
        )}

        <Tabs items={viewItems} value={mobileView} onChange={setMobileView} />

        <div className="flex items-center gap-1 ml-auto">
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))}
            aria-label="Предыдущая неделя"
            className="!w-11 !h-11 !p-0">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_left</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            Сегодня
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))}
            aria-label="Следующая неделя"
            className="!w-11 !h-11 !p-0">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_right</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Сетка недели ─────────────────────────────────────────────────────────────
// TODO(#29): кастомная CSS-grid сетка с display:contents и drag-and-drop.
// Оставлена в нативной разметке — миграция требует отдельной проработки.
function WeekGrid({ data, hours, canEdit, onPickEmpty, onPickAppt, moveDrag, setMoveDrag, onDropMove }) {
  const days = data.days || []
  const todayKey = ymd(new Date())

  // Карта быстрого доступа: dayDate→slotMap
  const dayMaps = days.map(d => {
    const m = new Map()
    for (const s of d.slots) m.set(s.start_time, s)
    return m
  })

  return (
    <Card padded={false} className="overflow-hidden">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))`,
          gap: 1,
          background: 'var(--bg-2)',
        }}>
        {/* header row */}
        <div style={{ background: 'var(--surface)' }} />
        {days.map((d) => {
          const isToday = d.date === todayKey
          return (
            <div key={d.date} className="px-2 py-3 text-center" style={{ background: 'var(--surface)' }}>
              <div className="text-[11px] uppercase tracking-wider font-semibold"
                style={{ color: isToday ? 'var(--accent)' : 'var(--fg-3)' }}>{d.day_name}</div>
              <div className="text-lg font-bold mt-0.5"
                style={{ color: isToday ? 'var(--accent)' : 'var(--fg)' }}>
                {parseInt(d.date.slice(8, 10), 10)}
              </div>
              {!d.is_working && <div className="text-[10px] mt-0.5" style={{ color: 'var(--fg-3)' }}>выходной</div>}
            </div>
          )
        })}

        {/* hour rows */}
        {hours.map(h => (
          <div key={`row-${h}`} style={{ display: 'contents' }}>
            <div className="text-right px-2 py-2 text-[11px] font-mono tabular-nums"
              style={{ background: 'var(--surface)', color: 'var(--fg-3)' }}>{h}</div>
            {days.map((d, di) => {
              const slot = dayMaps[di].get(h)
              if (!d.is_working) {
                return (
                  <div key={`c-${d.date}-${h}`} className="min-h-[58px]"
                    style={{
                      background: 'repeating-linear-gradient(45deg, var(--bg-2), var(--bg-2) 6px, var(--bg-3) 6px, var(--bg-3) 12px)',
                    }} />
                )
              }
              if (!slot) return <div key={`c-${d.date}-${h}`} className="min-h-[58px]" style={{ background: 'var(--bg-2)' }} />
              const a = slot.appointment
              const st = a ? STATUS_INFO[a.status] || STATUS_INFO.pending : null

              if (a) {
                const priority = a.priority || 'normal'
                const isUrgent = priority === 'urgent'
                const isHigh = priority === 'high'
                return (
                  <div
                    key={`c-${d.date}-${h}`}
                    draggable={canEdit}
                    onDragStart={() => canEdit && setMoveDrag({ appointment: a, fromKey: `${d.date}-${h}` })}
                    onDragEnd={() => setMoveDrag(null)}
                    onClick={() => onPickAppt(a, d.date, h)}
                    className="cursor-pointer p-2 min-h-[58px] hover:brightness-95 transition active:scale-[0.98] flex flex-col relative overflow-hidden"
                    style={{
                      background: isUrgent
                        ? 'linear-gradient(135deg, rgba(239,68,68,0.28) 0%, rgba(220,38,38,0.18) 100%)'
                        : isHigh
                          ? 'linear-gradient(135deg, rgba(250,204,21,0.30) 0%, rgba(245,158,11,0.18) 100%)'
                          : st.bg,
                      color: st.c,
                      borderLeft: `3px solid ${isUrgent ? '#dc2626' : isHigh ? '#eab308' : (st.border || st.dot)}`,
                      borderRadius: 10,
                      margin: 2,
                      boxShadow: (isHigh || isUrgent) ? '0 2px 8px rgba(234,179,8,0.25)' : 'none',
                    }}
                    title={`${a.patient_name || a.patient_phone} · ${st.l}${isHigh ? ' · ⭐ Приоритет' : ''}${isUrgent ? ' · ⚡ Срочно' : ''}`}>
                    {(isHigh || isUrgent) && (
                      <span style={{ position: 'absolute', top: 4, right: 6, fontSize: 11, lineHeight: 1 }}>
                        {isUrgent ? '⚡' : '⭐'}
                      </span>
                    )}
                    <div className="text-[11px] font-mono tabular-nums opacity-80 leading-none">{slot.start_time}</div>
                    <div className="text-[12.5px] font-semibold leading-tight mt-0.5 truncate">
                      {a.patient_name || '—'}
                    </div>
                    <div className="mt-auto flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] self-start px-1.5 py-0.5 rounded font-bold uppercase"
                        style={{ background: 'rgba(255,255,255,0.55)' }}>{st.l}</span>
                      {a.has_outcome && (
                        <span title="Заключение оформлено"
                          className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                          style={{ background: 'rgba(34,197,94,0.30)', color: '#14532d' }}>✓</span>
                      )}
                      {a.referrals_count > 0 && (
                        <span title={`Направлений: ${a.referrals_count}`}
                          className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                          style={{ background: 'rgba(14,165,233,0.30)', color: '#075985' }}>→ {a.referrals_count}</span>
                      )}
                    </div>
                  </div>
                )
              }
              return (
                <div
                  key={`c-${d.date}-${h}`}
                  onDragOver={canEdit && moveDrag ? (e) => e.preventDefault() : undefined}
                  onDrop={canEdit && moveDrag ? () => onDropMove(d.date, h) : undefined}
                  onClick={() => onPickEmpty(d.date, h)}
                  className={`min-h-[58px] transition ${canEdit ? 'cursor-pointer' : 'cursor-default'}`}
                  style={{
                    background: 'rgba(16,185,129,0.05)',
                    border: '1px dashed rgba(16,185,129,0.30)',
                    borderRadius: 10,
                    margin: 2,
                  }}
                  onMouseEnter={canEdit ? (e) => {
                    e.currentTarget.style.background = 'rgba(16,185,129,0.14)'
                    e.currentTarget.style.borderStyle = 'solid'
                    e.currentTarget.style.borderColor = 'rgba(16,185,129,0.50)'
                  } : undefined}
                  onMouseLeave={canEdit ? (e) => {
                    e.currentTarget.style.background = 'rgba(16,185,129,0.05)'
                    e.currentTarget.style.borderStyle = 'dashed'
                    e.currentTarget.style.borderColor = 'rgba(16,185,129,0.30)'
                  } : undefined} />
              )
            })}
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Список одного дня (мобильный) ────────────────────────────────────────────
// TODO(#29): чипы дней + список слотов — оставлено в нативной разметке (мобильные тач-чипы).
function DayList({ data, hours, activeDayIdx, setActiveDayIdx, canEdit, onPickEmpty, onPickAppt }) {
  const days = data.days || []
  const day = days[activeDayIdx] || days[0]
  const todayKey = ymd(new Date())

  return (
    <div>
      {/* day chips (мобильная навигация по дням) */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto -mx-1 px-1 pb-1">
        {days.map((d, i) => {
          const active = i === activeDayIdx
          const isToday = d.date === todayKey
          return (
            <button key={d.date} onClick={() => setActiveDayIdx(i)}
              className="flex-shrink-0 w-14 rounded-xl py-2 transition flex flex-col items-center"
              style={active ? {
                background: 'var(--accent)',
                color: 'var(--accent-fg)',
                boxShadow: 'var(--shadow-sm)',
                minHeight: 56,
              } : {
                background: 'var(--surface)',
                color: isToday ? 'var(--accent)' : 'var(--fg-2)',
                border: '1px solid var(--border)',
                minHeight: 56,
              }}>
              <div className="text-[10px] uppercase font-bold opacity-80">{d.day_name}</div>
              <div className="text-lg font-black">{parseInt(d.date.slice(8, 10), 10)}</div>
            </button>
          )
        })}
      </div>

      {/* slots list */}
      <Card padded={false} className="overflow-hidden">
        {!day.is_working ? (
          <div className="text-center py-12 text-sm" style={{ color: 'var(--fg-3)' }}>Нерабочий день</div>
        ) : day.slots.length === 0 ? (
          <div className="text-center py-12 text-sm" style={{ color: 'var(--fg-3)' }}>Расписание не настроено</div>
        ) : (
          day.slots.map((s) => {
            const a = s.appointment
            const st = a ? STATUS_INFO[a.status] || STATUS_INFO.pending : null
            return (
              <div key={s.start_time}
                onClick={() => a ? onPickAppt(a, day.date, s.start_time) : onPickEmpty(day.date, s.start_time)}
                className={`flex items-center gap-3 px-4 py-3 transition ${(canEdit || a) ? 'active:bg-gray-50 cursor-pointer' : ''}`}
                style={{
                  background: a ? st.bg : undefined,
                  borderBottom: '1px solid var(--border)',
                  minHeight: 56,
                }}>
                <div className="w-12 flex-shrink-0 text-center">
                  <div className="text-sm font-bold tabular-nums"
                    style={a ? { color: st.c } : { color: 'var(--fg-3)' }}>{s.start_time}</div>
                  <div className="text-[10px]" style={{ color: 'var(--fg-3)' }}>{s.end_time}</div>
                </div>
                <div className="flex-1 min-w-0">
                  {a ? (
                    <>
                      <div className="text-sm font-semibold leading-tight" style={{ color: st.c }}>{a.patient_name || '—'}</div>
                      <div className="text-xs opacity-70 mt-0.5" style={{ color: st.c }}>{a.patient_phone}</div>
                      {(a.has_outcome || a.referrals_count > 0) && (
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          {a.has_outcome && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                              style={{ background: 'rgba(34,197,94,0.18)', color: '#14532d' }}>✓ заключение</span>
                          )}
                          {a.referrals_count > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                              style={{ background: 'rgba(14,165,233,0.18)', color: '#075985' }}>→ {a.referrals_count} напр.</span>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-sm" style={{ color: 'var(--fg-3)' }}>Свободно</div>
                  )}
                </div>
                {a && (
                  <Chip variant={st.chip}>{st.l}</Chip>
                )}
                {!a && canEdit && (
                  <span className="material-symbols-outlined text-[20px]" style={{ color: 'var(--fg-3)' }}>add_circle</span>
                )}
              </div>
            )
          })
        )}
      </Card>
    </div>
  )
}

// ── Модал создания записи ────────────────────────────────────────────────────
function BookModal({ ctx, doctorName, onClose, onCreate }) {
  const [form, setForm] = useState({ patient_phone: '', patient_name: '', notes: '', is_telemed: false })
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

  // Стиль input — единый
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
      <div className="text-xs mb-4" style={{ color: 'var(--fg-3)' }}>{ctx.date} · {ctx.start_time} · {doctorName}</div>

      <div className="space-y-3">
        <input type="tel" placeholder="Телефон пациента +7…" value={form.patient_phone}
          onChange={e => setForm({ ...form, patient_phone: e.target.value })}
          style={inputStyle} />
        <input placeholder="ФИО пациента" value={form.patient_name}
          onChange={e => setForm({ ...form, patient_name: e.target.value })}
          style={inputStyle} />
        <textarea placeholder="Примечания (необязательно)" value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
          style={{ ...inputStyle, resize: 'none' }} />

        {/* Чекбокс телемед-приёма — добавляет флаг is_telemed в payload */}
        <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--fg)' }}>
          <input
            type="checkbox"
            checked={!!form.is_telemed}
            onChange={e => setForm({ ...form, is_telemed: e.target.checked })}
            className="w-4 h-4 accent-[#0097A7]"
          />
          <span className="material-symbols-outlined text-base" style={{ color: '#0097A7' }}>video_call</span>
          Тип приёма: Телемедицина (видео-консультация)
        </label>
      </div>

      {err && (
        <div className="mt-3 text-xs px-3 py-2 rounded-xl"
          style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>{err}</div>
      )}

      <div className="flex gap-2 mt-4">
        <Button variant="secondary" onClick={onClose} className="flex-1">Отмена</Button>
        <Button variant="primary" onClick={submit} disabled={saving || !form.patient_phone} className="flex-1">
          {saving ? 'Создание…' : 'Записать'}
        </Button>
      </div>
    </Modal>
  )
}

// ── Модал записи: статус, перенос ────────────────────────────────────────────
function ApptModal({ ctx, canEdit, onClose, onStatus, onMove, weekStart }) {
  const a = ctx.appointment
  const st = STATUS_INFO[a.status] || STATUS_INFO.pending
  const [moveCtx, setMoveCtx] = useState(null)   // { date, time }

  // Список дней недели для переноса
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const times = useMemo(() => {
    const arr = []
    for (let h = 8; h < 20; h++) for (const m of [0, 15, 30, 45]) {
      arr.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
    return arr
  }, [])

  return (
    <Modal open onClose={onClose} title="Запись пациента">
      {/* ===== БЛОК: Карточка статуса записи ===== */}
      <div className="rounded-xl p-3 mb-3" style={{ background: st.bg, color: st.c }}>
        <div className="flex items-center justify-between">
          <Chip variant={st.chip}>{st.l}</Chip>
          <span className="text-xs font-mono tabular-nums">{ctx.date} · {ctx.start_time}</span>
        </div>
        <div className="text-base font-bold mt-2">{a.patient_name || '—'}</div>
        <div className="text-xs opacity-80 mt-0.5">{a.patient_phone}</div>
        {a.notes && <div className="text-xs mt-2 italic opacity-90">«{a.notes}»</div>}
      </div>

      {/* ===== Quick Actions (W4): иконки для быстрого контакта ===== */}
      {(a.patient_phone || a.qr_code) && (
        <div className="mb-4">
          <QuickActions
            actions={buildPatientCardActions({
              phone: a.patient_phone,
              onReschedule: canEdit && ['pending', 'confirmed'].includes(a.status)
                ? () => setMoveCtx({ date: ctx.date, time: ctx.start_time })
                : undefined,
              onCancel: canEdit && ['pending', 'confirmed'].includes(a.status)
                ? () => onStatus(a.id, 'cancelled')
                : undefined,
              onPrintQr: a.qr_code ? () => {
                const w = window.open('', '_blank', 'width=420,height=600')
                if (!w) return
                w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR записи</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;text-align:center;padding:24px;color:#0f172a}
img{width:280px;height:280px;border:1px solid #e2e8f0;border-radius:12px;padding:12px;background:#fff;margin:16px auto;display:block}
@media print{body{padding:0}}</style></head><body>
<h3>${(a.patient_name || a.patient_phone || '—').replace(/[<>&"']/g, '')}</h3>
<img src="data:image/png;base64,${a.qr_code}" alt="QR"/>
<p>${ctx.date} ${ctx.start_time}</p>
<script>setTimeout(()=>{window.print();},200);window.onafterprint=()=>window.close();</script>
</body></html>`)
                w.document.close()
              } : undefined,
            })}
          />
        </div>
      )}

      {/* ===== Кнопка «Начать телемед-приём» (только для записей с маркером телемед) ===== */}
      {(() => {
        const isTelemed = !!a.is_telemed || (a.notes && /телемед|telemed/i.test(a.notes))
        if (!isTelemed) return null
        if (!['pending', 'confirmed'].includes(a.status)) return null
        return (
          <div className="mb-4">
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  // Запрашиваем у backend session_id для этой записи. Если её ещё нет — создаём.
                  let sessionId = a.telemed_session_id
                  if (!sessionId) {
                    const r = await api.post('/telemed/sessions', { appointment_id: a.id })
                    sessionId = r.data?.id
                  }
                  if (sessionId) {
                    // Открываем модалку через глобальное событие (TelemedRoomModal монтируется ниже)
                    window.dispatchEvent(new CustomEvent('open-telemed-room', { detail: { sessionId } }))
                    onClose()
                  }
                } catch (e) {
                  alert('Не удалось открыть телемед-комнату: ' + (e?.response?.data?.detail || e.message))
                }
              }}
              className="w-full"
            >
              <span className="material-symbols-outlined text-base mr-1" style={{ verticalAlign: 'middle' }}>videocam</span>
              Начать телемед-приём
            </Button>
          </div>
        )
      })()}

      {!canEdit ? (
        <div className="text-xs text-center py-2" style={{ color: 'var(--fg-3)' }}>Только просмотр</div>
      ) : moveCtx ? (
        <>
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--fg-3)' }}>Перенос на:</div>
          {/* Сетка дней (компактные кнопки 14 дней) */}
          <div className="grid grid-cols-7 gap-1 mb-3">
            {days.map(d => {
              const active = moveCtx.date === ymd(d)
              return (
                <button key={ymd(d)} onClick={() => setMoveCtx({ ...moveCtx, date: ymd(d) })}
                  className="rounded-lg text-xs font-bold transition"
                  style={{
                    padding: '8px 0',
                    minHeight: 44,
                    background: active ? 'var(--accent)' : 'var(--bg-2)',
                    color: active ? 'var(--accent-fg)' : 'var(--fg-2)',
                    border: '1px solid var(--border)',
                  }}>
                  <div className="text-[9px] opacity-70">{DAY_SHORT[(d.getDay() + 6) % 7]}</div>
                  {d.getDate()}
                </button>
              )
            })}
          </div>
          {/* Сетка времён */}
          <div className="flex flex-wrap gap-1 mb-3 max-h-40 overflow-y-auto">
            {times.map(t => {
              const active = moveCtx.time === t
              return (
                <button key={t} onClick={() => setMoveCtx({ ...moveCtx, time: t })}
                  className="text-xs font-mono tabular-nums transition"
                  style={{
                    padding: '8px 12px',
                    minHeight: 36,
                    borderRadius: 8,
                    background: active ? 'var(--accent)' : 'var(--bg-2)',
                    color: active ? 'var(--accent-fg)' : 'var(--fg-2)',
                    border: '1px solid var(--border)',
                  }}>
                  {t}
                </button>
              )
            })}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setMoveCtx(null)} className="flex-1">Назад</Button>
            <Button variant="primary" onClick={() => onMove(a.id, moveCtx.date, moveCtx.time)}
              disabled={!moveCtx.date || !moveCtx.time} className="flex-1">Перенести</Button>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {a.status === 'pending' && (
            <Button variant="secondary" onClick={() => onStatus(a.id, 'confirmed')} className="col-span-2">
              ✓ Подтвердить
            </Button>
          )}
          {['pending', 'confirmed'].includes(a.status) && (
            <>
              <Button variant="secondary" onClick={() => setMoveCtx({ date: ctx.date, time: ctx.start_time })}>
                ⇆ Перенести
              </Button>
              <Button variant="secondary" onClick={() => onStatus(a.id, 'completed')}>
                ✓ Завершить
              </Button>
              <Button variant="secondary" onClick={() => onStatus(a.id, 'no_show')}>
                ⚠ Не пришёл
              </Button>
              <Button variant="danger" onClick={() => onStatus(a.id, 'cancelled')}>
                × Отменить
              </Button>
            </>
          )}
          {['cancelled', 'completed', 'no_show'].includes(a.status) && (
            <div className="col-span-2 text-center text-xs py-2" style={{ color: 'var(--fg-3)' }}>Запись закрыта</div>
          )}
        </div>
      )}
    </Modal>
  )
}
