/**
 * ========================================
 * БЛОК: <QuickActions> — ряд быстрых иконок-действий для карточек
 * ========================================
 * Универсальный компактный ряд с tap-target ≥ 44px (a11y) и русскими tooltip.
 * Используется в карточках пациентов / направлений (PatientCabinet,
 * AppointmentsCalendar, ManagerHistory, OperationalCabinet).
 *
 * Стандартный набор (W4):
 *   📞 Позвонить       — tel:{phone} или deep-link clinikset://call/{user_id}
 *   💬 WhatsApp        — https://wa.me/{phone}
 *   📅 Перенести       — onReschedule()
 *   ❌ Отменить        — onCancel() (confirm на стороне родителя)
 *   🖨️ Печать QR       — onPrintQr()
 *
 * Props:
 *   actions       — массив { key, icon, title, onClick?, href?, target?, danger?, disabled?, hidden? }
 *                   Если actions пуст — компонент рендерит null.
 *   className     — override корневого узла
 *   compact       — true: tap-target 36px (для очень тесных карточек)
 *   ariaLabel     — описание ряда для screen-reader (по умолчанию «Быстрые действия»)
 *
 * Helper-фабрика (для удобства):
 *   buildPatientCardActions({ phone, userId, onReschedule, onCancel, onPrintQr, hasCallApp })
 *     — возвращает корректно отфильтрованный список из 5 стандартных кнопок.
 *
 * a11y/UX:
 *   - title (tooltip) на русском
 *   - aria-label на каждой кнопке
 *   - min-width: 44px по умолчанию
 *   - transition: 160ms на background/transform для лёгкого hover-feedback
 * ========================================
 */
import { useEffect } from 'react'

// ===== БЛОК: глобальные стили (один раз) =====
const STYLE_ID = 'ks-qa-styles'
function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const css = `
    .ks-qa-row { display: inline-flex; gap: 6px; flex-wrap: wrap; }
    .ks-qa-btn {
      display: inline-grid; place-items: center;
      min-width: 44px; height: 36px; padding: 0 8px;
      border-radius: 9px;
      background: var(--bg-1, #f7f9fb);
      color: var(--fg-2, #4a4f5a);
      border: 1px solid var(--border, rgba(0,0,0,0.08));
      cursor: pointer;
      text-decoration: none;
      transition: background 160ms ease, color 160ms ease, transform 120ms ease, border-color 160ms ease;
    }
    .ks-qa-btn:hover  { background: var(--bg-2, #eef0f4); color: var(--fg, #191c1e); }
    .ks-qa-btn:active { transform: scale(0.96); }
    .ks-qa-btn[disabled] { opacity: 0.45; cursor: not-allowed; }
    .ks-qa-btn.is-danger { color: var(--bad, #dc2626); }
    .ks-qa-btn.is-danger:hover { background: var(--bad-soft, rgba(220,38,38,0.10)); border-color: var(--bad, #dc2626); }
    .ks-qa-btn.is-compact { min-width: 36px; height: 32px; }
    .ks-qa-btn .material-symbols-outlined { font-size: 18px; }
  `
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = css
  document.head.appendChild(tag)
}

// ===== БЛОК: компонент =====
export default function QuickActions({
  actions = [],
  className = '',
  compact = false,
  ariaLabel = 'Быстрые действия',
}) {
  useEffect(() => { ensureStyles() }, [])

  const visible = (actions || []).filter(a => a && !a.hidden)
  if (visible.length === 0) return null

  const btnClass = `ks-qa-btn ${compact ? 'is-compact' : ''}`

  return (
    <div className={`ks-qa-row ${className}`} role="group" aria-label={ariaLabel}>
      {visible.map(a => {
        const klass = `${btnClass} ${a.danger ? 'is-danger' : ''}`
        const common = {
          key: a.key,
          className: klass,
          title: a.title,
          'aria-label': a.title,
        }
        if (a.href) {
          return (
            <a
              {...common}
              href={a.href}
              target={a.target || undefined}
              rel={a.target === '_blank' ? 'noreferrer noopener' : undefined}
              onClick={(e) => {
                if (a.disabled) { e.preventDefault(); return }
                a.onClick && a.onClick(e)
              }}
              aria-disabled={a.disabled || undefined}
            >
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>{a.icon}</span>
            </a>
          )
        }
        return (
          <button
            {...common}
            type="button"
            disabled={a.disabled}
            onClick={(e) => { e.stopPropagation(); a.onClick && a.onClick(e) }}
          >
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>{a.icon}</span>
          </button>
        )
      })}
    </div>
  )
}

// ===== БЛОК: helper-фабрика стандартного набора =====
function digitsOnly(s) { return String(s || '').replace(/\D/g, '') }

/**
 * Стандартный набор из 5 кнопок (📞 / 💬 / 📅 / ❌ / 🖨️).
 * Любая из них автоматически прячется, если соответствующий handler не передан.
 */
export function buildPatientCardActions({
  phone,
  userId,
  onReschedule,
  onCancel,
  onPrintQr,
  hasCallApp = false,
  rescheduleDisabled = false,
  cancelDisabled = false,
} = {}) {
  const tel = phone ? `tel:${String(phone).replace(/\s/g, '')}` : ''
  const wa  = phone ? `https://wa.me/${digitsOnly(phone)}` : ''
  const callHref = hasCallApp && userId ? `clinikset://call/${userId}` : tel

  return [
    {
      key: 'call',
      icon: 'call',
      title: 'Позвонить',
      href: callHref || undefined,
      hidden: !phone && !(hasCallApp && userId),
    },
    {
      key: 'whatsapp',
      icon: 'chat',
      title: 'WhatsApp',
      href: wa || undefined,
      target: '_blank',
      hidden: !phone,
    },
    {
      key: 'reschedule',
      icon: 'update',
      title: 'Перенести',
      onClick: onReschedule,
      disabled: rescheduleDisabled,
      hidden: !onReschedule,
    },
    {
      key: 'cancel',
      icon: 'close',
      title: 'Отменить',
      onClick: onCancel,
      danger: true,
      disabled: cancelDisabled,
      hidden: !onCancel,
    },
    {
      key: 'print-qr',
      icon: 'qr_code_2',
      title: 'Печать QR',
      onClick: onPrintQr,
      hidden: !onPrintQr,
    },
  ]
}
