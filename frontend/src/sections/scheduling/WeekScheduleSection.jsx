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
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../../config'

const authH = t => ({ Authorization: `Bearer ${t}` })

// ── helpers ──────────────────────────────────────────────────────────────────
const DAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const STATUS_INFO = {
  pending:   { l: 'Ожидает',     bg: 'rgba(245,158,11,0.10)', c: '#b45309', dot: '#f59e0b' },
  confirmed: { l: 'Подтверждён', bg: 'rgba(0,151,167,0.12)',  c: '#0e7490', dot: '#0097a7' },
  completed: { l: 'Завершён',    bg: 'rgba(100,116,139,0.10)', c: '#475569', dot: '#94a3b8' },
  cancelled: { l: 'Отменён',     bg: 'rgba(244,63,94,0.08)',   c: '#9f1239', dot: '#f43f5e' },
  no_show:   { l: 'Не пришёл',   bg: 'rgba(245,158,11,0.08)',  c: '#92400e', dot: '#f59e0b' },
}

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
  const [doctors, setDoctors] = useState([])
  const [doctorId, setDoctorId] = useState(selfDoctorId || '')
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()))
  const [data, setData] = useState(null)         // ответ /doctors/{id}/week
  const [loading, setLoading] = useState(false)
  const [mobileView, setMobileView] = useState(isMobile() ? 'day' : 'week')
  const [activeDayIdx, setActiveDayIdx] = useState(() => (new Date().getDay() + 6) % 7)

  // Модалы
  const [bookModal, setBookModal] = useState(null)   // { date, start_time }
  const [apptModal, setApptModal] = useState(null)   // { appointment, date, start_time }
  const [moveDrag, setMoveDrag] = useState(null)     // { appointment, fromKey }
  const [error, setError] = useState('')

  // Подгрузка списка врачей (для mode=full)
  useEffect(() => {
    if (mode !== 'full') return
    axios.get(`${API_BASE}/doctors`, { headers: authH(token) })
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
      const r = await axios.get(`${API_BASE}/doctors/${doctorId}/week`, {
        headers: authH(token),
        params: { start_date: ymd(weekStart) },
      })
      setData(r.data)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить расписание')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [doctorId, weekStart, token])

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
      await axios.post(`${API_BASE}/appointments`, {
        doctor_id: doctorId,
        appointment_date: bookModal.date,
        start_time: bookModal.start_time,
        patient_phone: form.patient_phone.trim(),
        patient_name: form.patient_name || null,
        notes: form.notes || null,
      }, { headers: authH(token) })
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
    await axios.patch(`${API_BASE}/appointments/${id}/status`, { status }, { headers: authH(token) })
    setApptModal(null)
    reload()
  }

  const onMove = async (id, newDate, newTime) => {
    await axios.patch(`${API_BASE}/appointments/${id}`, {
      appointment_date: newDate,
      start_time: newTime,
    }, { headers: authH(token) })
    setMoveDrag(null)
    setApptModal(null)
    reload()
  }

  const canEdit = mode === 'full'

  return (
    <div className="px-4 pb-24 max-w-[1280px] mx-auto">
      {/* Header */}
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
        <div className="mb-3 px-3 py-2 rounded-xl text-sm bg-rose-50 text-rose-700 border border-rose-200">{error}</div>
      )}

      {/* Грид недели (десктоп) или день (мобильный) */}
      {loading && !data ? (
        <div className="text-center text-gray-400 py-16">Загрузка расписания…</div>
      ) : !data ? (
        <div className="text-center text-gray-400 py-16">Нет данных</div>
      ) : mobileView === 'week' ? (
        <WeekGrid
          data={data}
          hours={hoursAxis}
          canEdit={canEdit}
          onPickEmpty={(date, time) => canEdit && setBookModal({ date, start_time: time })}
          onPickAppt={(apt, date, time) => setApptModal({ appointment: apt, date, start_time: time })}
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
          onPickAppt={(apt, date, time) => setApptModal({ appointment: apt, date, start_time: time })}
        />
      )}

      {/* KPI */}
      <KpiRow kpi={kpi} duration={data?.slot_duration} />

      {/* Модалы */}
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
    </div>
  )
}

// ── Header ───────────────────────────────────────────────────────────────────
function Header({ mode, doctors, doctorId, setDoctorId, weekStart, setWeekStart, mobileView, setMobileView, canEdit, onAdd, selfDoctorName }) {
  const ws = weekStart
  const we = addDays(weekStart, 6)
  const fmt = (d) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  const title = `${fmt(ws)} – ${fmt(we)} ${we.getFullYear()}`

  return (
    <div className="mb-5">
      <div className="flex items-start gap-3 flex-wrap mb-3">
        <div className="flex-1 min-w-[200px]">
          <h2 className="text-xl md:text-2xl font-black text-gray-900">Расписание</h2>
          <p className="text-sm text-gray-500 mt-0.5">{title}</p>
        </div>
        {canEdit && (
          <button onClick={onAdd}
            className="px-4 py-2 rounded-xl bg-gradient-to-br from-cyan-600 to-teal-700 text-white text-sm font-bold shadow-lg hover:shadow-xl transition flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[18px]">add</span>
            Запись
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {mode === 'full' && (
          <select value={doctorId} onChange={e => setDoctorId(e.target.value)}
            className="p-2.5 rounded-xl border border-gray-200 bg-white text-sm font-medium min-w-[200px]">
            {doctors.map(d => (
              <option key={d.id} value={d.id}>
                {d.full_name || d.name}{d.specialty ? ` · ${d.specialty}` : ''}
              </option>
            ))}
          </select>
        )}
        {mode === 'self' && selfDoctorName && (
          <div className="px-3 py-2 rounded-xl bg-cyan-50 text-cyan-800 text-sm font-semibold border border-cyan-100">
            {selfDoctorName}
          </div>
        )}

        <div className="flex bg-gray-100 rounded-xl p-1">
          <button onClick={() => setMobileView('week')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${mobileView === 'week' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
            Неделя
          </button>
          <button onClick={() => setMobileView('day')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${mobileView === 'day' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
            День
          </button>
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition">
            <span className="material-symbols-outlined text-base text-gray-700">chevron_left</span>
          </button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="px-3 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-bold text-gray-700">
            Сегодня
          </button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition">
            <span className="material-symbols-outlined text-base text-gray-700">chevron_right</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Сетка недели ─────────────────────────────────────────────────────────────
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
    <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))`,
          gap: 1,
          background: '#f1f5f9',
        }}>
        {/* header row */}
        <div className="bg-white" />
        {days.map((d, i) => {
          const isToday = d.date === todayKey
          return (
            <div key={d.date} className="bg-white px-2 py-3 text-center">
              <div className={`text-[11px] uppercase tracking-wider font-semibold ${isToday ? 'text-cyan-600' : 'text-gray-400'}`}>{d.day_name}</div>
              <div className={`text-lg font-bold mt-0.5 ${isToday ? 'text-cyan-700' : 'text-gray-900'}`}>
                {parseInt(d.date.slice(8, 10), 10)}
              </div>
              {!d.is_working && <div className="text-[10px] text-gray-400 mt-0.5">выходной</div>}
            </div>
          )
        })}

        {/* hour rows */}
        {hours.map(h => (
          <div key={`row-${h}`} style={{ display: 'contents' }}>
            <div className="bg-white text-right px-2 py-2 text-[11px] text-gray-400 font-mono tabular-nums">{h}</div>
            {days.map((d, di) => {
              const slot = dayMaps[di].get(h)
              if (!d.is_working) {
                return (
                  <div key={`c-${d.date}-${h}`} className="min-h-[58px]"
                    style={{
                      background: 'repeating-linear-gradient(45deg, #f8fafc, #f8fafc 6px, #eef2f6 6px, #eef2f6 12px)',
                    }} />
                )
              }
              if (!slot) return <div key={`c-${d.date}-${h}`} className="bg-gray-50 min-h-[58px]" />
              const a = slot.appointment
              const st = a ? STATUS_INFO[a.status] || STATUS_INFO.pending : null

              if (a) {
                return (
                  <div
                    key={`c-${d.date}-${h}`}
                    draggable={canEdit}
                    onDragStart={() => canEdit && setMoveDrag({ appointment: a, fromKey: `${d.date}-${h}` })}
                    onDragEnd={() => setMoveDrag(null)}
                    onClick={() => onPickAppt(a, d.date, h)}
                    className="cursor-pointer p-2 min-h-[58px] hover:brightness-95 transition active:scale-[0.98] flex flex-col"
                    style={{ background: st.bg, color: st.c }}
                    title={`${a.patient_name || a.patient_phone} · ${st.l}`}>
                    <div className="text-[11px] font-mono tabular-nums opacity-80 leading-none">{slot.start_time}</div>
                    <div className="text-[12.5px] font-semibold leading-tight mt-0.5 truncate">
                      {a.patient_name || '—'}
                    </div>
                    <span className="text-[10px] mt-auto self-start px-1.5 py-0.5 rounded font-bold uppercase"
                      style={{ background: 'rgba(255,255,255,0.5)' }}>{st.l}</span>
                  </div>
                )
              }
              return (
                <div
                  key={`c-${d.date}-${h}`}
                  onDragOver={canEdit && moveDrag ? (e) => e.preventDefault() : undefined}
                  onDrop={canEdit && moveDrag ? () => onDropMove(d.date, h) : undefined}
                  onClick={() => onPickEmpty(d.date, h)}
                  className={`bg-white min-h-[58px] flex items-center justify-center transition ${canEdit ? 'cursor-pointer hover:bg-cyan-50' : 'cursor-default'}`}>
                  {canEdit && <span className="text-[11px] text-gray-300 font-medium">+ слот</span>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Список одного дня (мобильный) ────────────────────────────────────────────
function DayList({ data, hours, activeDayIdx, setActiveDayIdx, canEdit, onPickEmpty, onPickAppt }) {
  const days = data.days || []
  const day = days[activeDayIdx] || days[0]
  const todayKey = ymd(new Date())

  return (
    <div>
      {/* day chips */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto -mx-1 px-1 pb-1">
        {days.map((d, i) => {
          const active = i === activeDayIdx
          const isToday = d.date === todayKey
          return (
            <button key={d.date} onClick={() => setActiveDayIdx(i)}
              className="flex-shrink-0 w-14 rounded-xl py-2 transition flex flex-col items-center"
              style={active ? {
                background: 'linear-gradient(135deg,#0097A7,#0e7490)',
                color: 'white',
                boxShadow: '0 4px 14px rgba(14,116,144,0.3)',
              } : {
                background: 'white',
                color: isToday ? '#0e7490' : '#475569',
                border: '1px solid #e5e7eb',
              }}>
              <div className="text-[10px] uppercase font-bold opacity-80">{d.day_name}</div>
              <div className="text-lg font-black">{parseInt(d.date.slice(8, 10), 10)}</div>
            </button>
          )
        })}
      </div>

      {/* slots list */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {!day.is_working ? (
          <div className="text-center py-12 text-sm text-gray-400">Нерабочий день</div>
        ) : day.slots.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-400">Расписание не настроено</div>
        ) : (
          day.slots.map((s, i) => {
            const a = s.appointment
            const st = a ? STATUS_INFO[a.status] || STATUS_INFO.pending : null
            return (
              <div key={s.start_time}
                onClick={() => a ? onPickAppt(a, day.date, s.start_time) : onPickEmpty(day.date, s.start_time)}
                className={`flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 transition ${(canEdit || a) ? 'active:bg-gray-50 cursor-pointer' : ''}`}
                style={a ? { background: st.bg } : undefined}>
                <div className="w-12 flex-shrink-0 text-center">
                  <div className={`text-sm font-bold tabular-nums ${a ? '' : 'text-gray-400'}`} style={a ? { color: st.c } : undefined}>{s.start_time}</div>
                  <div className="text-[10px] text-gray-400">{s.end_time}</div>
                </div>
                <div className="flex-1 min-w-0">
                  {a ? (
                    <>
                      <div className="text-sm font-semibold leading-tight" style={{ color: st.c }}>{a.patient_name || '—'}</div>
                      <div className="text-xs opacity-70 mt-0.5" style={{ color: st.c }}>{a.patient_phone}</div>
                    </>
                  ) : (
                    <div className="text-sm text-gray-400">Свободно</div>
                  )}
                </div>
                {a && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase flex-shrink-0"
                    style={{ background: 'rgba(255,255,255,0.5)', color: st.c }}>{st.l}</span>
                )}
                {!a && canEdit && (
                  <span className="material-symbols-outlined text-[20px] text-gray-300">add_circle</span>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── KPI ──────────────────────────────────────────────────────────────────────
function KpiRow({ kpi, duration }) {
  const items = [
    { l: 'Слотов в неделе', v: kpi.total, sub: duration ? `по ${duration} мин` : '' },
    { l: 'Занято',          v: kpi.taken, sub: `${kpi.load || 0}% загрузка` },
    { l: 'Свободно',        v: kpi.free,  sub: 'видны пациентам' },
  ]
  return (
    <div className="grid grid-cols-3 gap-2 mt-4">
      {items.map(x => (
        <div key={x.l} className="bg-white rounded-xl p-3 border border-gray-100">
          <div className="text-[11px] text-gray-500 font-semibold">{x.l}</div>
          <div className="text-2xl font-black tabular-nums">{x.v}</div>
          {x.sub && <div className="text-[10px] text-gray-400 mt-0.5">{x.sub}</div>}
        </div>
      ))}
    </div>
  )
}

// ── Модал создания записи ────────────────────────────────────────────────────
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

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-0 md:p-4 backdrop-blur-sm">
      <div className="bg-white w-full md:max-w-md md:rounded-2xl rounded-t-3xl p-5 md:p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold">Запись на приём</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-400 text-xl leading-none">×</button>
        </div>
        <div className="text-xs text-gray-500 mb-4">{ctx.date} · {ctx.start_time} · {doctorName}</div>

        <div className="space-y-3">
          <input type="tel" placeholder="Телефон пациента +7…" value={form.patient_phone}
            onChange={e => setForm({ ...form, patient_phone: e.target.value })}
            className="w-full p-3 rounded-xl border border-gray-200 text-sm focus:border-cyan-500 outline-none" />
          <input placeholder="ФИО пациента" value={form.patient_name}
            onChange={e => setForm({ ...form, patient_name: e.target.value })}
            className="w-full p-3 rounded-xl border border-gray-200 text-sm focus:border-cyan-500 outline-none" />
          <textarea placeholder="Примечания (необязательно)" value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
            className="w-full p-3 rounded-xl border border-gray-200 text-sm focus:border-cyan-500 outline-none resize-none" />
        </div>

        {err && <div className="mt-3 text-xs text-rose-700 bg-rose-50 px-3 py-2 rounded-xl">{err}</div>}

        <div className="flex gap-2 mt-4">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold text-sm">Отмена</button>
          <button onClick={submit} disabled={saving || !form.patient_phone}
            className="flex-1 py-3 rounded-xl bg-gradient-to-br from-cyan-600 to-teal-700 text-white font-bold text-sm shadow disabled:opacity-50">
            {saving ? 'Создание…' : 'Записать'}
          </button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-0 md:p-4 backdrop-blur-sm">
      <div className="bg-white w-full md:max-w-md md:rounded-2xl rounded-t-3xl p-5 md:p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold">Запись пациента</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-400 text-xl leading-none">×</button>
        </div>

        <div className="rounded-xl p-3 mb-4" style={{ background: st.bg, color: st.c }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase opacity-80">{st.l}</span>
            <span className="text-xs font-mono tabular-nums">{ctx.date} · {ctx.start_time}</span>
          </div>
          <div className="text-base font-bold mt-1">{a.patient_name || '—'}</div>
          <div className="text-xs opacity-80 mt-0.5">{a.patient_phone}</div>
          {a.notes && <div className="text-xs mt-2 italic opacity-90">«{a.notes}»</div>}
        </div>

        {!canEdit ? (
          <div className="text-xs text-gray-400 text-center py-2">Только просмотр</div>
        ) : moveCtx ? (
          <>
            <div className="text-xs font-semibold text-gray-500 mb-2">Перенос на:</div>
            <div className="grid grid-cols-7 gap-1 mb-3">
              {days.map(d => (
                <button key={ymd(d)} onClick={() => setMoveCtx({ ...moveCtx, date: ymd(d) })}
                  className={`py-2 rounded-lg text-xs font-bold transition ${moveCtx.date === ymd(d) ? 'bg-cyan-600 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}`}>
                  <div className="text-[9px] opacity-70">{DAY_SHORT[(d.getDay() + 6) % 7]}</div>
                  {d.getDate()}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 mb-3 max-h-40 overflow-y-auto">
              {times.map(t => (
                <button key={t} onClick={() => setMoveCtx({ ...moveCtx, time: t })}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-mono tabular-nums transition ${moveCtx.time === t ? 'bg-cyan-600 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}`}>
                  {t}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setMoveCtx(null)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-sm font-semibold">Назад</button>
              <button onClick={() => onMove(a.id, moveCtx.date, moveCtx.time)} disabled={!moveCtx.date || !moveCtx.time}
                className="flex-1 py-2.5 rounded-xl bg-cyan-600 text-white text-sm font-bold disabled:opacity-50">Перенести</button>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {a.status === 'pending' && (
              <button onClick={() => onStatus(a.id, 'confirmed')}
                className="py-2.5 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-bold hover:bg-emerald-100">
                ✓ Подтвердить
              </button>
            )}
            {['pending', 'confirmed'].includes(a.status) && (
              <>
                <button onClick={() => setMoveCtx({ date: ctx.date, time: ctx.start_time })}
                  className="py-2.5 rounded-xl bg-cyan-50 text-cyan-700 text-sm font-bold hover:bg-cyan-100">
                  ⇆ Перенести
                </button>
                <button onClick={() => onStatus(a.id, 'completed')}
                  className="py-2.5 rounded-xl bg-violet-50 text-violet-700 text-sm font-bold hover:bg-violet-100">
                  ✓ Завершить
                </button>
                <button onClick={() => onStatus(a.id, 'no_show')}
                  className="py-2.5 rounded-xl bg-amber-50 text-amber-700 text-sm font-bold hover:bg-amber-100">
                  ⚠ Не пришёл
                </button>
                <button onClick={() => onStatus(a.id, 'cancelled')}
                  className="py-2.5 rounded-xl bg-rose-50 text-rose-700 text-sm font-bold hover:bg-rose-100 col-span-2">
                  × Отменить запись
                </button>
              </>
            )}
            {['cancelled', 'completed', 'no_show'].includes(a.status) && (
              <div className="col-span-2 text-center text-xs text-gray-400 py-2">Запись закрыта</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
