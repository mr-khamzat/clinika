/**
 * ========================================
 * БЛОК: ThreadListItem — карточка треда в списке чата (Глава 9)
 * ========================================
 * Используется в PatientChatSection.jsx и ClinicChatSection.jsx.
 *
 * Props:
 *   thread       — объект треда из /patient/chat/threads или /clinic/chat/threads
 *   active       — bool: подсвечивать как активный
 *   onClick      — () => выбрать тред
 *   side         — 'patient' | 'clinic'
 *                  определяет, какое поле «unread» читать и какие имена показывать
 * ========================================
 */
import { useMemo, useEffect } from 'react'

// ── SLA-pulse keyframes (Intercom-style queue) ──────────────────────────────
// Внедряем @keyframes pulse один раз в head (idempotent, scoped по id), чтобы
// ThreadListItem оставался самодостаточным и не требовал глобальных стилей.
const _SLA_STYLE_ID = '__sla_pulse_keyframes__'
function _ensureSlaPulseStyle() {
  if (typeof document === 'undefined') return
  if (document.getElementById(_SLA_STYLE_ID)) return
  const st = document.createElement('style')
  st.id = _SLA_STYLE_ID
  st.textContent = (
    '@keyframes slaPulse { 0%,100%{opacity:1;transform:scale(1)} ' +
    '50%{opacity:0.55;transform:scale(1.18)} }'
  )
  document.head.appendChild(st)
}

// Цветовая карта SLA-уровней (Intercom-style):
//   green  — <5 мин, yellow — 5..15 мин, red — >15 мин.
const _SLA_COLORS = {
  red:    '#dc2626',
  yellow: '#f59e0b',
  green:  '#16a34a',
}

function _slaTitle(level, mins) {
  if (level === 'red')    return `Просрочен · без ответа ${mins ?? '?'} мин`
  if (level === 'yellow') return `Ожидает ${mins ?? '?'} мин`
  if (level === 'green')  return `Свежий · ${mins ?? 0} мин назад`
  return ''
}

// ── Относительное время — «сейчас» / «10 мин» / «вчера» / «11.05» ───────────
function fmtRelative(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now - d
    if (diffMs < 60_000) return 'сейчас'
    const diffMin = Math.floor(diffMs / 60_000)
    if (diffMin < 60) return `${diffMin} мин`
    const sameDay = d.toDateString() === now.toDateString()
    if (sameDay) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return 'вчера'
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays < 7) return ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()]
    return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`
  } catch {
    return ''
  }
}

// ── Цвет аватара клиники/пациента по hash имени ─────────────────────────────
function avatarColor(name) {
  const palette = ['#0097A7', '#1565C0', '#7b1fa2', '#2e7d32', '#e65100', '#c2185b', '#5d4037']
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return palette[Math.abs(h) % palette.length]
}

export default function ThreadListItem({ thread, active, onClick, side = 'patient' }) {
  // Гарантируем, что @keyframes для SLA-pulse инжектирован.
  useEffect(() => { _ensureSlaPulseStyle() }, [])

  const title = side === 'patient'
    ? (thread.clinic_name || 'Клиника')
    : (thread.patient_name || thread.patient_phone || 'Пациент')
  const subtitle = side === 'patient'
    ? (thread.assigned_doctor_name || thread.subject || 'Поддержка клиники')
    : (thread.subject || 'Без темы')
  const unread = side === 'patient' ? (thread.unread_for_patient || 0) : (thread.unread_for_clinic || 0)
  const preview = thread.last_message_preview || thread.last_message || ''
  const initials = useMemo(() => {
    const t = String(title || '').trim()
    if (!t) return '?'
    const parts = t.split(/\s+/).slice(0, 2)
    return parts.map(p => p[0]).join('').toUpperCase()
  }, [title])
  const color = useMemo(() => avatarColor(title), [title])

  const labelHex = {
    red: '#EF4444', yellow: '#F59E0B', green: '#22C55E', blue: '#3B82F6',
  }[thread.color_label] || null

  return (
    <button
      onClick={onClick}
      className="w-full text-left transition-colors relative"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 12px',
        borderRadius: 14,
        background: active ? 'var(--accent-soft, rgba(0,151,167,.08))' : 'transparent',
        border: `1px solid ${active ? 'var(--accent-line, rgba(0,151,167,.25))' : 'transparent'}`,
        borderLeft: labelHex ? `3px solid ${labelHex}` : (active ? '1px solid var(--accent-line, rgba(0,151,167,.25))' : '1px solid transparent'),
        minHeight: 64,
      }}
    >
      {/* Аватар клиники/пациента */}
      <div
        className="flex-shrink-0 grid place-items-center font-bold text-white"
        style={{
          width: 44, height: 44, borderRadius: 12,
          background: `linear-gradient(135deg, ${color}, ${color}AA)`,
          fontSize: 14, letterSpacing: '-0.02em',
        }}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {thread.is_pinned && (
            <span
              className="material-symbols-outlined flex-shrink-0"
              style={{ fontSize: 14, color: '#F59E0B', fontVariationSettings: "'FILL' 1" }}
              title="Закреплён"
            >push_pin</span>
          )}
          {/* SLA-цветометка (Intercom-style queue) — менеджер сразу видит горящие. */}
          {thread.sla_level && thread.sla_level !== 'gray' && _SLA_COLORS[thread.sla_level] && (
            <span
              aria-label={`SLA ${thread.sla_level}`}
              title={_slaTitle(thread.sla_level, thread.sla_minutes)}
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                flexShrink: 0,
                background: _SLA_COLORS[thread.sla_level],
                boxShadow: thread.sla_level === 'red'
                  ? '0 0 0 2px rgba(220,38,38,0.18), 0 0 8px rgba(220,38,38,0.55)'
                  : (thread.sla_level === 'yellow'
                      ? '0 0 0 2px rgba(245,158,11,0.18)'
                      : '0 0 0 2px rgba(22,163,74,0.18)'),
                animation: thread.sla_level === 'red'
                  ? 'slaPulse 1.4s ease-in-out infinite'
                  : 'none',
              }}
            />
          )}
          <span className="truncate font-semibold" style={{ fontSize: 13.5, color: 'var(--fg, #0F172A)' }}>
            {title}
          </span>
          <span className="flex-shrink-0 ml-auto" style={{ fontSize: 11, color: 'var(--fg-3, #94a3b8)' }}>
            {fmtRelative(thread.last_message_at)}
          </span>
        </div>
        <div className="truncate" style={{ fontSize: 12, color: 'var(--fg-2, #475569)', marginTop: 2 }}>
          {subtitle}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="truncate flex-1" style={{ fontSize: 12, color: 'var(--fg-3, #94a3b8)' }}>
            {preview || '— нет сообщений'}
          </span>
          {thread.sla_breached_level && (
            <span className="flex-shrink-0 px-2 py-0.5 rounded-full font-bold"
                  style={{ fontSize: 10, background: '#fee2e2', color: '#991b1b' }}>
              SLA
            </span>
          )}
          {unread > 0 && (
            <span
              className="flex-shrink-0 grid place-items-center font-bold text-white"
              style={{
                minWidth: 20, height: 20, borderRadius: 999, padding: '0 6px',
                background: '#ef4444', fontSize: 11,
              }}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
          {thread.status === 'closed' && (
            <span className="flex-shrink-0 px-2 py-0.5 rounded-full" style={{ fontSize: 10, color: '#475569', background: '#e2e8f0' }}>
              закрыт
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
