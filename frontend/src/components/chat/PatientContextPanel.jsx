/**
 * ========================================
 * БЛОК: PatientContextPanel — карточка пациента в чате клиники
 * ========================================
 * Правая колонка в ClinicChatSection. Показывает:
 *   • Аватар (инициалы) + ФИО
 *   • Телефон (tel:), email
 *   • Дата рождения + возраст
 *   • До 5 последних приёмов
 *   • Quick-actions: «Записать на приём» / «Создать направление»
 *
 * Источник данных: GET /clinic/chat/threads/{thread_id}/patient-context
 *   → { patient: {id, name, phone, email, birth_date}, appointments: [...] }
 *
 * Mobile: рендерится как overlay-drawer (когда open=true).
 * Desktop: рендерится как обычная боковая колонка (open игнорируется).
 * ========================================
 */
import { useEffect, useState, useMemo } from 'react'
import api from '../../api'

// ── Утилиты ──────────────────────────────────────────────────────────────────
function initials(name) {
  if (!name) return '?'
  const parts = String(name).trim().split(/\s+/).slice(0, 2)
  return parts.map(s => s[0]?.toUpperCase() || '').join('') || '?'
}

function avatarColor(seed) {
  // Стабильный HSL по строке (тот же приём, что у ThreadListItem)
  let h = 0
  const s = String(seed || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 55%, 55%)`
}

function ageFromBirth(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age
}

function ageWord(n) {
  if (n == null) return ''
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} год`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} года`
  return `${n} лет`
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return iso }
}

function fmtTime(iso) {
  if (!iso) return ''
  // start_time приходит как "HH:MM:SS"
  const m = String(iso).match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}

const APPT_STATUS = {
  pending:   { label: 'Ожидает',     bg: 'rgba(245,158,11,.12)',  fg: '#b45309' },
  confirmed: { label: 'Подтверждён', bg: 'rgba(14,165,233,.12)',  fg: '#0369a1' },
  completed: { label: 'Выполнен',    bg: 'rgba(34,197,94,.12)',   fg: '#15803d' },
  cancelled: { label: 'Отменён',     bg: 'rgba(239,68,68,.12)',   fg: '#b91c1c' },
  no_show:   { label: 'Не пришёл',   bg: 'rgba(148,163,184,.18)', fg: '#475569' },
}

// ── Компонент ────────────────────────────────────────────────────────────────
export default function PatientContextPanel({
  threadId,
  variant = 'panel',  // 'panel' (desktop boková колонка) | 'drawer' (mobile overlay)
  open = false,
  onClose,
  onBookAppointment,
  onCreateReferral,
  showBookButton = true,
}) {
  const isDrawer = variant === 'drawer'
  // Drawer закрыт — ничего не делаем, чтобы не дёргать API лишний раз
  const active = isDrawer ? open : true

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState('')

  useEffect(() => {
    if (!active || !threadId) { setData(null); return }
    let cancelled = false
    setLoading(true); setErr('')
    api.get(`/clinic/chat/threads/${threadId}/patient-context`)
      .then(r => { if (!cancelled) setData(r.data) })
      .catch(e => { if (!cancelled) setErr(e?.response?.data?.detail || 'Не удалось загрузить карточку') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [threadId, active])

  const patient = data?.patient || null
  const appointments = data?.appointments || []
  const age = useMemo(() => ageFromBirth(patient?.birth_date), [patient?.birth_date])

  const body = (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface, #fff)' }}>
      {/* Header панели */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border, #e2e8f0)' }}>
        <div className="font-bold" style={{ fontSize: 14, color: 'var(--fg, #0F172A)' }}>Карточка пациента</div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="md:hidden grid place-items-center"
            style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}
            aria-label="Закрыть"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && (
          <div className="text-center py-8" style={{ color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>Загрузка…</div>
        )}
        {!loading && err && (
          <div className="rounded-xl p-3" style={{ background: '#fee2e2', color: '#991b1b', fontSize: 13 }}>{err}</div>
        )}
        {!loading && !err && !patient && (
          <div className="text-center py-8" style={{ color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>
            Нет данных о пациенте
          </div>
        )}

        {!loading && patient && (
          <>
            {/* Аватар + ФИО */}
            <div className="flex flex-col items-center text-center">
              <div
                className="grid place-items-center font-bold text-white"
                style={{
                  width: 72, height: 72, borderRadius: '50%',
                  background: avatarColor(patient.id || patient.phone || patient.name),
                  fontSize: 26,
                  boxShadow: '0 4px 12px rgba(15,23,42,.12)',
                }}
                aria-hidden
              >
                {initials(patient.name)}
              </div>
              <div className="mt-3 font-bold" style={{ fontSize: 15, color: 'var(--fg, #0F172A)' }}>
                {patient.name || 'Без имени'}
              </div>
              {age != null && (
                <div className="mt-0.5" style={{ fontSize: 12, color: 'var(--fg-3, #94a3b8)' }}>
                  {ageWord(age)}
                </div>
              )}
            </div>

            {/* Контакты + ДР */}
            <div className="space-y-2">
              {patient.phone && (
                <a
                  href={`tel:${patient.phone}`}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 transition-colors"
                  style={{ background: 'var(--bg-1, #f1f5f9)', textDecoration: 'none', color: 'var(--fg, #0F172A)' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--accent, #0097A7)', fontVariationSettings: "'FILL' 1" }}>call</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{patient.phone}</span>
                </a>
              )}
              {patient.email && (
                <a
                  href={`mailto:${patient.email}`}
                  className="flex items-center gap-2 rounded-xl px-3 py-2"
                  style={{ background: 'var(--bg-1, #f1f5f9)', textDecoration: 'none', color: 'var(--fg, #0F172A)' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--accent, #0097A7)', fontVariationSettings: "'FILL' 1" }}>mail</span>
                  <span style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{patient.email}</span>
                </a>
              )}
              {patient.birth_date && (
                <div className="flex items-center gap-2 rounded-xl px-3 py-2"
                     style={{ background: 'var(--bg-1, #f1f5f9)' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--accent, #0097A7)', fontVariationSettings: "'FILL' 1" }}>cake</span>
                  <span style={{ fontSize: 13 }}>{fmtDate(patient.birth_date)}</span>
                </div>
              )}
            </div>

            {/* Quick-actions */}
            {(showBookButton || onCreateReferral) && (
              <div className="grid grid-cols-1 gap-2">
                {showBookButton && onBookAppointment && (
                  <button
                    type="button"
                    onClick={onBookAppointment}
                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-white"
                    style={{ fontSize: 13, background: 'linear-gradient(135deg, #0097A7, #0A2342)', boxShadow: '0 4px 12px rgba(0,151,167,.25)' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>event_available</span>
                    Записать на приём
                  </button>
                )}
                {onCreateReferral && (
                  <button
                    type="button"
                    onClick={onCreateReferral}
                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold"
                    style={{ fontSize: 13, background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg, #0F172A)', border: '1px solid var(--border, #e2e8f0)' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>assignment_add</span>
                    Создать направление
                  </button>
                )}
              </div>
            )}

            {/* Последние приёмы */}
            <div>
              <div className="font-semibold mb-2" style={{ fontSize: 12, color: 'var(--fg-3, #94a3b8)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Последние приёмы
              </div>
              {appointments.length === 0 ? (
                <div className="rounded-xl p-3 text-center" style={{ background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-3, #94a3b8)', fontSize: 12 }}>
                  Нет записей
                </div>
              ) : (
                <div className="space-y-1.5">
                  {appointments.map(a => {
                    const st = APPT_STATUS[a.status] || { label: a.status, bg: 'rgba(148,163,184,.18)', fg: '#475569' }
                    return (
                      <div
                        key={a.id}
                        className="rounded-xl px-3 py-2 flex items-center gap-2"
                        style={{ background: 'var(--bg-1, #f1f5f9)' }}
                      >
                        <div className="flex-1 min-w-0">
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg, #0F172A)' }}>
                            {fmtDate(a.date)}{a.start_time ? ` · ${fmtTime(a.start_time)}` : ''}
                          </div>
                          {a.notes && (
                            <div className="truncate" style={{ fontSize: 11.5, color: 'var(--fg-3, #94a3b8)' }} title={a.notes}>
                              {a.notes}
                            </div>
                          )}
                        </div>
                        <span
                          className="flex-shrink-0 px-2 py-0.5 rounded-full font-semibold"
                          style={{ fontSize: 10.5, background: st.bg, color: st.fg }}
                        >
                          {st.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )

  if (isDrawer) {
    if (!open) return null
    return (
      <div
        className="fixed inset-0 z-[120] flex"
        style={{ background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <div className="ml-auto h-full" style={{ width: 'min(92vw, 360px)' }} onClick={e => e.stopPropagation()}>
          {body}
        </div>
      </div>
    )
  }
  return body
}
