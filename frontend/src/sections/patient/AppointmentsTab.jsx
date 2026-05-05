/**
 * AppointmentsTab — пациентская вкладка «Записи».
 * Список карточек с приёмами (предстоящие сверху, потом прошлые), действия:
 *   - Перенести (POST /patient/appointment/{id}/reschedule)
 *   - Отменить  (POST /patient/appointment/{id}/cancel)
 *   - Подсветка статуса, отсчёт «через ... часа», адрес клиники, маршрут.
 *
 * Используется внутри PatientCabinet.jsx как ещё одна вкладка между home и history.
 *
 * Backend:
 *   GET  /patient/appointments?t=<session_token>&include_past=true
 *   POST /patient/appointment/{id}/cancel
 *   POST /patient/appointment/{id}/reschedule
 *   GET  /doctors/{id}/slots?target_date=YYYY-MM-DD   (через PUBLIC_BOOK route)
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../../config'

const STATUS_INFO = {
  pending:   { l: 'Ожидает',     bg: '#fff7ed', c: '#c2410c', icon: 'pending' },
  confirmed: { l: 'Подтверждён', bg: '#ecfdf5', c: '#047857', icon: 'check_circle' },
  cancelled: { l: 'Отменён',     bg: '#fff1f2', c: '#be123c', icon: 'cancel' },
  completed: { l: 'Завершён',    bg: '#f3f4f6', c: '#374151', icon: 'task_alt' },
  no_show:   { l: 'Не пришёл',   bg: '#fef9c3', c: '#a16207', icon: 'error' },
}

function ymd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function fmtDate(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}.${m}.${y}`
}

function fmtDow(s) {
  if (!s) return ''
  const dt = new Date(s + 'T00:00:00')
  return dt.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '')
}

function timeUntil(date, time) {
  if (!date || !time) return null
  const dt = new Date(`${date}T${time}:00`)
  const diff = dt.getTime() - Date.now()
  if (diff <= 0) return null
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (h >= 48) return `через ${Math.floor(h / 24)} дн`
  if (h >= 1) return `через ${h} ч ${m} мин`
  return `через ${m} мин`
}

export default function AppointmentsTab({ sessionToken, onBookNew }) {
  const [appts, setAppts] = useState([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState(null)     // выбранная для действий
  const [reschedCtx, setReschedCtx] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    if (!sessionToken) { setLoading(false); return }
    setLoading(true)
    axios.get(`${API_BASE}/patient/appointments`, { params: { t: sessionToken, include_past: true } })
      .then(r => setAppts(Array.isArray(r.data) ? r.data : []))
      .catch(() => setAppts([]))
      .finally(() => setLoading(false))
  }, [sessionToken])

  useEffect(() => { load() }, [load])

  const { upcoming, past } = useMemo(() => {
    const up = [], ps = []
    for (const a of appts) {
      if (a.is_past || ['completed', 'cancelled', 'no_show'].includes(a.status)) ps.push(a)
      else up.push(a)
    }
    // upcoming: ближайшие сверху
    up.sort((x, y) => (x.appointment_date + x.start_time).localeCompare(y.appointment_date + y.start_time))
    return { upcoming: up, past: ps }
  }, [appts])

  const cancel = async (apt) => {
    if (!apt.patient_token) return setErr('Нет доступа к этой записи')
    if (!confirm(`Отменить запись ${fmtDate(apt.appointment_date)} в ${apt.start_time}?`)) return
    try {
      await axios.post(`${API_BASE}/patient/appointment/${apt.id}/cancel`, { patient_token: apt.patient_token })
      setActive(null)
      load()
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Не удалось отменить')
    }
  }

  if (loading) return <div className="text-center py-12 text-sm text-gray-400">Загрузка…</div>

  return (
    <div className="space-y-4">
      {/* Шапка */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm text-gray-500">Всего: {appts.length}</div>
          {upcoming.length > 0 && (
            <div className="text-xs text-emerald-600 font-semibold">
              {upcoming.length} {upcoming.length === 1 ? 'предстоящая' : 'предстоящих'}
            </div>
          )}
        </div>
        {onBookNew && (
          <button onClick={onBookNew}
            className="px-3 py-2 rounded-xl bg-gradient-to-br from-cyan-600 to-teal-700 text-white text-sm font-bold flex items-center gap-1 shadow">
            <span className="material-symbols-outlined text-[18px]">add</span>
            Записаться
          </button>
        )}
      </div>

      {err && (
        <div className="px-3 py-2 rounded-xl text-sm bg-rose-50 text-rose-700 border border-rose-200">{err}</div>
      )}

      {/* Предстоящие */}
      {upcoming.length > 0 && (
        <div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Предстоящие</div>
          <div className="space-y-2.5">
            {upcoming.map(a => (
              <ApptCard key={a.id} apt={a} onPick={() => setActive(a)} highlight />
            ))}
          </div>
        </div>
      )}

      {/* История */}
      {past.length > 0 && (
        <div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1 mt-4">История</div>
          <div className="space-y-2">
            {past.map(a => (
              <ApptCard key={a.id} apt={a} onPick={() => setActive(a)} compact />
            ))}
          </div>
        </div>
      )}

      {appts.length === 0 && (
        <div className="bg-white rounded-2xl p-10 text-center border border-gray-100">
          <span className="material-symbols-outlined text-5xl text-gray-300 mb-2">event_available</span>
          <p className="text-sm text-gray-400">Записей пока нет</p>
          {onBookNew && (
            <button onClick={onBookNew} className="mt-3 px-4 py-2 rounded-xl bg-cyan-600 text-white text-sm font-bold">
              Записаться к врачу
            </button>
          )}
        </div>
      )}

      {active && (
        <ApptDetailsSheet
          apt={active}
          onClose={() => setActive(null)}
          onCancel={() => cancel(active)}
          onReschedule={() => { setReschedCtx(active); setActive(null) }}
        />
      )}
      {reschedCtx && (
        <RescheduleSheet
          apt={reschedCtx}
          onClose={() => setReschedCtx(null)}
          onDone={() => { setReschedCtx(null); load() }}
        />
      )}
    </div>
  )
}

// ── Карточка ─────────────────────────────────────────────────────────────────
function ApptCard({ apt, onPick, highlight, compact }) {
  const st = STATUS_INFO[apt.status] || STATUS_INFO.pending
  const tu = timeUntil(apt.appointment_date, apt.start_time)
  return (
    <button onClick={onPick}
      className="w-full bg-white rounded-2xl p-4 border border-gray-100 shadow-sm text-left active:scale-[0.99] transition flex items-start gap-3"
      style={highlight ? { borderColor: 'rgba(0,151,167,0.25)', background: 'linear-gradient(180deg, #ffffff, #f0fbfc)' } : {}}>
      <div className="w-12 h-12 rounded-2xl flex flex-col items-center justify-center flex-shrink-0"
        style={{ background: st.bg, color: st.c }}>
        <div className="text-[9px] uppercase font-bold leading-none">{fmtDow(apt.appointment_date)}</div>
        <div className="text-base font-black leading-none mt-0.5">{apt.appointment_date?.slice(8, 10)}</div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-bold tabular-nums" style={{ color: st.c }}>{apt.start_time}</span>
          {tu && highlight && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">{tu}</span>
          )}
        </div>
        <div className={`font-bold text-gray-900 ${compact ? 'text-sm' : 'text-[15px]'} truncate`}>{apt.doctor_name}</div>
        <div className="text-xs text-gray-500 truncate">{apt.specialty || '—'} · {apt.clinic_name}</div>
      </div>

      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.c }}>{st.l}</span>
        <span className="material-symbols-outlined text-[18px] text-gray-300">chevron_right</span>
      </div>
    </button>
  )
}

// ── Sheet: детали записи ─────────────────────────────────────────────────────
function ApptDetailsSheet({ apt, onClose, onCancel, onReschedule }) {
  const st = STATUS_INFO[apt.status] || STATUS_INFO.pending
  const isUpcoming = ['pending', 'confirmed'].includes(apt.status) && !apt.is_past
  const route = apt.clinic_latitude && apt.clinic_longitude
    ? `https://yandex.ru/maps/?rtext=~${apt.clinic_latitude},${apt.clinic_longitude}&rtt=auto`
    : null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-0 md:p-4 backdrop-blur-sm">
      <div className="bg-white w-full md:max-w-md md:rounded-3xl rounded-t-3xl p-5 md:p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold">Запись на приём</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-400 text-2xl leading-none">×</button>
        </div>

        <div className="rounded-2xl p-4 mb-4" style={{ background: st.bg }}>
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="text-[11px] font-bold uppercase" style={{ color: st.c }}>{st.l}</div>
              <div className="text-2xl font-black mt-1" style={{ color: st.c }}>{apt.start_time}</div>
              <div className="text-xs mt-0.5" style={{ color: st.c }}>{fmtDate(apt.appointment_date)}</div>
            </div>
            {apt.qr_code && (
              <img src={`data:image/png;base64,${apt.qr_code}`} alt="QR"
                className="w-20 h-20 rounded-lg bg-white p-1 border" />
            )}
          </div>
        </div>

        <div className="space-y-3">
          <Row icon="stethoscope" label="Врач" value={apt.doctor_name} sub={apt.specialty} />
          <Row icon="local_hospital" label="Клиника" value={apt.clinic_name} sub={apt.clinic_address} />
          {apt.clinic_phone && (
            <Row icon="call" label="Телефон" value={
              <a href={`tel:${apt.clinic_phone}`} className="text-cyan-700 font-semibold">{apt.clinic_phone}</a>
            } />
          )}
          {apt.short_code && <Row icon="lock" label="Код" value={<span className="font-mono tabular-nums">{apt.short_code}</span>} />}
          {apt.notes && <Row icon="sticky_note_2" label="Примечание" value={apt.notes} />}
        </div>

        {isUpcoming && (
          <div className="grid grid-cols-2 gap-2 mt-5">
            <button onClick={onReschedule}
              className="py-3 rounded-xl bg-cyan-50 text-cyan-700 font-bold text-sm hover:bg-cyan-100">
              ⇆ Перенести
            </button>
            <button onClick={onCancel}
              className="py-3 rounded-xl bg-rose-50 text-rose-700 font-bold text-sm hover:bg-rose-100">
              × Отменить
            </button>
            {route && (
              <a href={route} target="_blank" rel="noreferrer"
                className="col-span-2 py-3 rounded-xl bg-gray-900 text-white font-bold text-sm text-center">
                Маршрут к клинике
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ icon, label, value, sub }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-cyan-50 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="material-symbols-outlined text-[18px] text-cyan-700">{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase font-bold text-gray-400">{label}</div>
        <div className="text-sm font-semibold text-gray-900 break-words">{value}</div>
        {sub && <div className="text-xs text-gray-500 break-words">{sub}</div>}
      </div>
    </div>
  )
}

// ── Sheet: перенос ───────────────────────────────────────────────────────────
function RescheduleSheet({ apt, onClose, onDone }) {
  const today = new Date()
  const [day, setDay] = useState(0)
  const [time, setTime] = useState('')
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() + i); return d
  }), [])

  useEffect(() => {
    const d = days[day]
    if (!d || !apt.doctor_id) return
    setLoading(true); setSlots([]); setTime('')
    axios.get(`${API_BASE}/public/${SLUG}/doctors/${apt.doctor_id}/slots`, { params: { day: ymd(d) } })
      .then(r => setSlots(Array.isArray(r.data?.slots) ? r.data.slots : (Array.isArray(r.data) ? r.data : [])))
      .catch(() => setSlots([]))
      .finally(() => setLoading(false))
  }, [day, apt.doctor_id])

  const submit = async () => {
    if (!time) return
    setSaving(true); setErr('')
    try {
      await axios.post(`${API_BASE}/patient/appointment/${apt.id}/reschedule`, {
        patient_token: apt.patient_token,
        appointment_date: ymd(days[day]),
        start_time: time,
      })
      onDone()
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Не удалось перенести')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-0 md:p-4 backdrop-blur-sm">
      <div className="bg-white w-full md:max-w-md md:rounded-3xl rounded-t-3xl p-5 md:p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-bold">Перенос записи</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-400 text-2xl leading-none">×</button>
        </div>
        <div className="text-xs text-gray-500 mb-3">{apt.doctor_name}</div>

        <div className="flex gap-1.5 mb-3 overflow-x-auto -mx-1 px-1 pb-1">
          {days.map((d, i) => {
            const active = i === day
            return (
              <button key={i} onClick={() => setDay(i)}
                className="flex-shrink-0 w-14 rounded-xl py-2 transition flex flex-col items-center"
                style={active ? {
                  background: 'linear-gradient(135deg,#0097A7,#0e7490)',
                  color: 'white',
                } : {
                  background: '#f1f5f9',
                  color: '#475569',
                }}>
                <div className="text-[10px] uppercase font-bold opacity-80">{d.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.','')}</div>
                <div className="text-base font-black">{d.getDate()}</div>
              </button>
            )
          })}
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-8 text-sm">Загрузка слотов…</div>
        ) : slots.length === 0 ? (
          <div className="text-center text-gray-400 py-8 text-sm">Свободных слотов нет</div>
        ) : (
          <div className="grid grid-cols-4 gap-2 mb-3">
            {slots.filter(s => s.available !== false).map(s => {
              const t = (s.start_time || s.time || '').slice(0, 5)
              return (
                <button key={t} onClick={() => setTime(t)}
                  className={`py-2 rounded-xl text-sm font-bold tabular-nums transition ${time === t ? 'bg-cyan-600 text-white shadow' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}`}>
                  {t}
                </button>
              )
            })}
          </div>
        )}

        {err && <div className="text-xs text-rose-700 bg-rose-50 px-3 py-2 rounded-xl mb-2">{err}</div>}

        <button onClick={submit} disabled={!time || saving}
          className="w-full py-3 rounded-xl bg-gradient-to-br from-cyan-600 to-teal-700 text-white font-bold text-sm shadow disabled:opacity-50">
          {saving ? 'Сохранение…' : `Перенести на ${days[day].toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} ${time || '—'}`}
        </button>
      </div>
    </div>
  )
}
