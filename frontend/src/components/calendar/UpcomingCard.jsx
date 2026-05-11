/**
 * ========================================
 * БЛОК: UpcomingCard — карточка ближайшего приёма (Глава 9, календарь)
 * ========================================
 * Используется в PatientCalendarSection.jsx.
 *
 * Props:
 *   apt        — { id, datetime, clinic_name, doctor_name, service_name, address }
 *   highlight  — bool: «герой» — крупная карточка с градиентом
 * ========================================
 */
const MONTHS_FULL = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']
const WEEKDAYS    = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота']

function parseDt(dt) {
  if (!dt) return null
  try {
    const d = new Date(dt)
    if (isNaN(d.getTime())) return null
    return d
  } catch { return null }
}

function fmtDatePretty(d) {
  if (!d) return '—'
  return `${d.getDate()} ${MONTHS_FULL[d.getMonth()]}, ${WEEKDAYS[d.getDay()]}`
}
function fmtTime(d) {
  if (!d) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function daysUntil(d) {
  if (!d) return null
  const now = new Date(); now.setHours(0,0,0,0)
  const target = new Date(d); target.setHours(0,0,0,0)
  return Math.round((target - now) / (1000 * 60 * 60 * 24))
}

export default function UpcomingCard({ apt, highlight = false }) {
  const d = parseDt(apt?.datetime)
  const dleft = daysUntil(d)
  const dayLabel = (() => {
    if (dleft === null) return ''
    if (dleft === 0) return 'сегодня'
    if (dleft === 1) return 'завтра'
    if (dleft < 0) return 'прошло'
    if (dleft < 7) return `через ${dleft} дн.`
    return `через ${dleft} дн.`
  })()

  if (highlight) {
    return (
      <div
        className="rounded-3xl p-5 text-white"
        style={{
          background: 'linear-gradient(145deg,#0A2342 0%,#1565C0 60%,#0097A7 100%)',
          boxShadow: '0 12px 40px rgba(10,35,66,.35)',
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#34d399' }} />
          <p className="text-emerald-300 text-xs font-bold uppercase tracking-wide">Ближайший приём {dayLabel && `· ${dayLabel}`}</p>
        </div>
        <div className="flex items-end gap-3 mt-2">
          <div className="text-5xl font-black leading-none">{d ? d.getDate() : '—'}</div>
          <div className="pb-1">
            <div className="text-base font-bold">{d ? MONTHS_FULL[d.getMonth()] : ''}</div>
            <div className="text-blue-200 text-sm">{d ? WEEKDAYS[d.getDay()] : ''}</div>
          </div>
          <div className="ml-auto text-right pb-1">
            <div className="text-2xl font-black leading-none">{fmtTime(d)}</div>
            <div className="text-blue-200 text-xs uppercase tracking-wide">время</div>
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-emerald-300" style={{ fontVariationSettings: "'FILL' 1" }}>stethoscope</span>
            <span className="font-semibold text-sm">{apt?.doctor_name || '—'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-blue-300" style={{ fontVariationSettings: "'FILL' 1" }}>local_hospital</span>
            <span className="text-sm text-blue-100">{apt?.clinic_name || '—'}</span>
          </div>
          {apt?.service_name && (
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-base text-blue-300" style={{ fontVariationSettings: "'FILL' 1" }}>medical_services</span>
              <span className="text-sm text-blue-100">{apt.service_name}</span>
            </div>
          )}
          {apt?.address && (
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-base text-blue-300" style={{ fontVariationSettings: "'FILL' 1" }}>place</span>
              <span className="text-sm text-blue-100">{apt.address}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Обычная карточка
  return (
    <div
      className="rounded-2xl p-4 transition-all"
      style={{
        background: 'var(--surface, #fff)',
        border: '1px solid var(--border, #e2e8f0)',
        boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(15,23,42,.08))',
      }}
    >
      <div className="flex items-start gap-3">
        {/* Дата */}
        <div
          className="flex-shrink-0 rounded-xl text-center grid place-items-center"
          style={{
            width: 56, height: 64,
            background: 'linear-gradient(135deg, #e0f7fa, #b2ebf2)',
            color: '#00838F',
          }}
        >
          <div>
            <div className="font-black leading-none" style={{ fontSize: 22 }}>{d ? d.getDate() : '—'}</div>
            <div className="uppercase mt-1" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em' }}>
              {d ? MONTHS_FULL[d.getMonth()].slice(0, 3) : ''}
            </div>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate" style={{ fontSize: 14, color: 'var(--fg, #0F172A)' }}>
              {apt?.doctor_name || 'Врач'}
            </span>
            {dayLabel && (
              <span
                className="flex-shrink-0 px-2 py-0.5 rounded-full"
                style={{
                  fontSize: 10.5, fontWeight: 700,
                  background: dleft === 0 ? '#fef3c7' : 'rgba(0,151,167,.1)',
                  color: dleft === 0 ? '#92400e' : '#00838F',
                }}
              >
                {dayLabel}
              </span>
            )}
          </div>
          <div className="truncate" style={{ fontSize: 12, color: 'var(--fg-2, #475569)' }}>
            {apt?.clinic_name}
            {apt?.service_name && <span> · {apt.service_name}</span>}
          </div>
          <div className="flex items-center gap-3 mt-1.5" style={{ fontSize: 12, color: 'var(--fg-3, #94a3b8)' }}>
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>schedule</span>
              {fmtTime(d)}
            </span>
            {apt?.address && (
              <span className="flex items-center gap-1 truncate">
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>place</span>
                <span className="truncate">{apt.address}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
