/**
 * AppointmentsCalendarSection — календарь онлайн-записи для администраторов.
 * Два режима: Day timeline + Month grid. Создание/редактирование записи в один клик.
 *
 * Backend:
 *   GET /doctors                           — список врачей тенанта
 *   GET /appointments?doctor_id=&appointment_date=
 *   GET /doctors/{id}/slots?day=YYYY-MM-DD — доступные окна
 *   POST /appointments                     — запись
 *   PATCH /appointments/{id}/status        — статус
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

const authH = t => ({ Authorization: `Bearer ${t}` })
const STATUS_INFO = {
  pending:   { l: 'Ожидает',     bg: '#fff7ed', c: '#c2410c' },
  confirmed: { l: 'Подтверждён', bg: '#ecfdf5', c: '#047857' },
  cancelled: { l: 'Отменён',     bg: '#fff1f2', c: '#be123c' },
  completed: { l: 'Завершён',    bg: '#f3f4f6', c: '#374151' },
  no_show:   { l: 'Не пришёл',   bg: '#fef9c3', c: '#a16207' },
}

function ymd(d) {
  return d.toISOString().slice(0, 10)
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function daysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}
function dayOfWeekMon0(d) {
  // Monday-first: 0..6
  return (d.getDay() + 6) % 7
}

export default function AppointmentsCalendarSection({ token }) {
  const [view, setView] = useState('day')   // 'day' | 'month'
  const [date, setDate] = useState(new Date())
  const [doctors, setDoctors] = useState([])
  const [doctorId, setDoctorId] = useState('')
  const [appts, setAppts] = useState([])
  const [loading, setLoading] = useState(false)

  // Создание новой записи
  const [creating, setCreating] = useState(null)  // {date, time?}
  const [draft, setDraft] = useState({ patient_phone: '', patient_name: '', start_time: '10:00', end_time: '10:30' })

  useEffect(() => {
    axios.get(`${API_BASE}/doctors`, { headers: authH(token) })
      .then(r => {
        setDoctors(r.data || [])
        if (r.data?.length && !doctorId) setDoctorId(r.data[0].id)
      })
      .catch(() => {})
  }, [])

  const loadAppts = useCallback(() => {
    if (!doctorId) return
    setLoading(true)
    const params = view === 'day'
      ? { doctor_id: doctorId, appointment_date: ymd(date), limit: 100 }
      : { doctor_id: doctorId, limit: 500 }   // месяц — берём с фильтром по дате на фронте
    axios.get(`${API_BASE}/appointments`, { headers: authH(token), params })
      .then(r => setAppts(Array.isArray(r.data) ? r.data : (r.data?.appointments || [])))
      .catch(() => setAppts([]))
      .finally(() => setLoading(false))
  }, [doctorId, view, date])

  useEffect(loadAppts, [loadAppts])

  const monthAppts = useMemo(() => {
    if (view !== 'month') return {}
    const map = {}
    const m = date.getMonth(), y = date.getFullYear()
    for (const a of appts) {
      const d = new Date(a.appointment_date)
      if (d.getFullYear() === y && d.getMonth() === m) {
        const k = ymd(d)
        if (!map[k]) map[k] = []
        map[k].push(a)
      }
    }
    return map
  }, [appts, view, date])

  const updateStatus = async (apt, status) => {
    await axios.patch(`${API_BASE}/appointments/${apt.id}/status`, { status }, { headers: authH(token) })
    loadAppts()
  }

  const createAppt = async () => {
    if (!creating || !draft.patient_phone) return
    await axios.post(`${API_BASE}/appointments`, {
      doctor_id: doctorId,
      appointment_date: creating.date,
      start_time: draft.start_time,
      end_time: draft.end_time,
      patient_phone: draft.patient_phone,
      patient_name: draft.patient_name,
    }, { headers: authH(token) })
    setCreating(null)
    setDraft({ patient_phone: '', patient_name: '', start_time: '10:00', end_time: '10:30' })
    loadAppts()
  }

  return (
    <div className="px-4 pb-24 max-w-6xl mx-auto">
      <h2 className="text-2xl font-black mb-1">Онлайн-запись</h2>
      <p className="text-sm text-gray-500 mb-4">Запись пациентов к врачам, редактирование статусов.</p>

      {/* Контролы */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select value={doctorId} onChange={e => setDoctorId(e.target.value)}
          className="p-2.5 rounded-xl border border-gray-200 bg-white text-sm font-medium min-w-[180px]">
          {doctors.map(d => <option key={d.id} value={d.id}>{d.full_name || d.name}</option>)}
        </select>
        <div className="flex bg-gray-100 rounded-xl p-1">
          <button onClick={() => setView('day')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${view === 'day' ? 'bg-white shadow' : 'text-gray-500'}`}>
            День
          </button>
          <button onClick={() => setView('month')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${view === 'month' ? 'bg-white shadow' : 'text-gray-500'}`}>
            Месяц
          </button>
        </div>
        <button onClick={() => setDate(new Date())}
          className="px-3 py-1.5 rounded-xl bg-gray-100 text-xs font-bold">Сегодня</button>
        <div className="flex items-center gap-1">
          <button onClick={() => setDate(view === 'day' ? new Date(date.getTime() - 86400000) : new Date(date.getFullYear(), date.getMonth() - 1, 1))}
            className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
            <span className="material-symbols-outlined text-base">chevron_left</span>
          </button>
          <div className="font-bold text-sm min-w-[140px] text-center">
            {view === 'day'
              ? date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
              : date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
          </div>
          <button onClick={() => setDate(view === 'day' ? new Date(date.getTime() + 86400000) : new Date(date.getFullYear(), date.getMonth() + 1, 1))}
            className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
            <span className="material-symbols-outlined text-base">chevron_right</span>
          </button>
        </div>
      </div>

      {loading && <div className="text-center text-gray-400 py-6 text-sm">Загрузка…</div>}

      {/* Day timeline */}
      {!loading && view === 'day' && (
        <div className="space-y-2">
          {Array.from({ length: 14 }, (_, i) => {
            const hour = 8 + i
            const slotKey = `${String(hour).padStart(2, '0')}:00`
            const inSlot = appts.filter(a => a.start_time?.startsWith(String(hour).padStart(2, '0')))
            return (
              <div key={hour} className="flex gap-3 items-start">
                <div className="w-14 flex-shrink-0 text-xs text-gray-400 font-mono pt-2">{slotKey}</div>
                <div className="flex-1 min-h-[44px] border-l-2 border-gray-100 pl-3 pb-1">
                  {inSlot.length === 0 ? (
                    <button onClick={() => setCreating({ date: ymd(date), time: slotKey })}
                      className="text-xs text-gray-300 hover:text-violet-600 hover:bg-violet-50 px-2 py-1 rounded">
                      + Записать
                    </button>
                  ) : inSlot.map(a => {
                    const st = STATUS_INFO[a.status] || STATUS_INFO.pending
                    return (
                      <div key={a.id} className="bg-white border border-gray-100 rounded-lg p-2.5 mb-1.5 flex items-center gap-2">
                        <div className="text-xs font-mono text-gray-500 min-w-[44px]">{a.start_time?.slice(0,5)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{a.patient_name || '—'}</div>
                          <div className="text-xs text-gray-400">{a.patient_phone}</div>
                        </div>
                        <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: st.bg, color: st.c }}>{st.l}</span>
                        {a.status === 'pending' && (
                          <button onClick={() => updateStatus(a, 'confirmed')}
                            className="px-2 py-1 rounded text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100">✓</button>
                        )}
                        {['pending', 'confirmed'].includes(a.status) && (
                          <button onClick={() => updateStatus(a, 'cancelled')}
                            className="px-2 py-1 rounded text-xs bg-rose-50 text-rose-700 hover:bg-rose-100">×</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Month grid */}
      {!loading && view === 'month' && (
        <MonthGrid date={date} apptsByDay={monthAppts} onPickDay={d => { setDate(new Date(d)); setView('day') }} />
      )}

      {/* Create modal */}
      {creating && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-md">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold">Новая запись</h3>
              <button onClick={() => setCreating(null)} className="text-gray-400 text-2xl leading-none">×</button>
            </div>
            <div className="text-xs text-gray-500 mb-3">{creating.date} · {doctors.find(d => d.id === doctorId)?.full_name}</div>
            <div className="space-y-2">
              <input type="tel" placeholder="Телефон пациента +79..." value={draft.patient_phone}
                onChange={e => setDraft({ ...draft, patient_phone: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-gray-200 text-sm" />
              <input placeholder="Имя пациента" value={draft.patient_name}
                onChange={e => setDraft({ ...draft, patient_name: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-gray-200 text-sm" />
              <div className="flex gap-2">
                <input type="time" value={draft.start_time}
                  onChange={e => setDraft({ ...draft, start_time: e.target.value })}
                  className="flex-1 p-2.5 rounded-lg border border-gray-200 text-sm" />
                <input type="time" value={draft.end_time}
                  onChange={e => setDraft({ ...draft, end_time: e.target.value })}
                  className="flex-1 p-2.5 rounded-lg border border-gray-200 text-sm" />
              </div>
            </div>
            <button onClick={createAppt}
              className="mt-3 w-full py-2.5 rounded-lg bg-violet-600 text-white font-bold text-sm">
              Записать
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


function MonthGrid({ date, apptsByDay, onPickDay }) {
  const start = startOfMonth(date)
  const days = daysInMonth(date)
  const startDow = dayOfWeekMon0(start)
  const totalCells = Math.ceil((startDow + days) / 7) * 7
  const today = ymd(new Date())

  const cells = []
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startDow + 1
    if (dayNum >= 1 && dayNum <= days) {
      const d = new Date(start.getFullYear(), start.getMonth(), dayNum)
      const k = ymd(d)
      cells.push({ key: k, date: d, day: dayNum, list: apptsByDay[k] || [] })
    } else {
      cells.push(null)
    }
  }

  return (
    <div className="bg-white rounded-2xl p-3 border border-gray-100">
      <div className="grid grid-cols-7 mb-1">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => (
          <div key={d} className="text-xs font-bold text-gray-400 text-center py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <div key={i} className="aspect-square" />
          const isToday = c.key === today
          return (
            <button key={c.key} onClick={() => onPickDay(c.date)}
              className={`aspect-square rounded-lg p-1 text-left flex flex-col ${isToday ? 'bg-violet-50 ring-1 ring-violet-300' : 'hover:bg-gray-50'}`}>
              <div className={`text-xs font-bold ${isToday ? 'text-violet-700' : 'text-gray-700'}`}>{c.day}</div>
              {c.list.length > 0 && (
                <div className="mt-auto flex flex-wrap gap-0.5">
                  <span className="text-[9px] font-bold px-1 rounded bg-violet-100 text-violet-700">{c.list.length}</span>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
