/**
 * ========================================
 * БЛОК: PatientBottomNav — 5-табовая навигация Apple HIG (iOS-style segmented)
 * ========================================
 * Используется ИСКЛЮЧИТЕЛЬНО в PatientCabinet (премиум-редизайн).
 * Не путать с компонентом /components/BottomNav.jsx — тот для роли
 * partner_doctor/staff в основном приложении.
 *
 * Премиум стиль:
 *   • Floating над bottom safe-area (margin снизу, не приклеен)
 *   • border-radius 24px, blur backdrop, glass shadow
 *   • Активный пункт: gradient pill cyan→blue за иконкой+лейблом
 *   • Smooth transition при свитче
 *   • Иконка material-symbols с FILL 1 на active, outline на inactive
 *   • Tap = haptic-feel scale(.92) на 100ms
 *   • Badge — мини красная точка справа-сверху иконки
 *
 * props:
 *   items: [{ key, icon, label, badge? }]
 *   value: текущий выбранный key
 *   onChange: (key) => void
 * ========================================
 */
import { useState } from 'react'

export default function PatientBottomNav({ items, value, onChange }) {
  // ═════ БЛОК: PatientBottomNav — haptic-feel state ═════
  const [pressed, setPressed] = useState(null)

  return (
    <div
      className="fixed left-0 right-0 z-40 pointer-events-none"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom,0px) + 8px)',
      }}
    >
      <nav
        role="tablist"
        aria-label="Главная навигация"
        className="pointer-events-auto max-w-lg mx-3 sm:mx-auto flex items-stretch justify-around bg-white/85 dark:bg-gray-900/85"
        style={{
          height: 64,
          borderRadius: 24,
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          backdropFilter: 'blur(24px) saturate(180%)',
          border: '1px solid rgba(255,255,255,.6)',
          boxShadow:
            '0 4px 16px rgba(0,0,0,.06), 0 12px 32px rgba(21,101,192,.08), inset 0 1px 0 rgba(255,255,255,.5)',
          padding: 6,
        }}
      >
        {items.map((t) => {
          const active = t.key === value
          const isPressed = pressed === t.key
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onPointerDown={() => setPressed(t.key)}
              onPointerUp={() => setPressed(null)}
              onPointerLeave={() => setPressed(null)}
              onClick={() => onChange(t.key)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 relative outline-none"
              style={{
                minWidth: 44,
                minHeight: 44,
                borderRadius: 18,
                color: active ? '#fff' : '#9CA3AF',
                background: active
                  ? 'linear-gradient(135deg,#0097A7 0%,#1565C0 100%)'
                  : 'transparent',
                boxShadow: active
                  ? '0 6px 14px rgba(21,101,192,.32), inset 0 1px 0 rgba(255,255,255,.35)'
                  : 'none',
                transform: isPressed ? 'scale(.92)' : 'scale(1)',
                transition:
                  'transform 100ms ease-out, background 280ms cubic-bezier(.4,0,.2,1), color 200ms ease, box-shadow 220ms ease',
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 22,
                  lineHeight: '22px',
                  fontVariationSettings: active
                    ? "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24"
                    : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
                  transition: 'font-variation-settings 220ms ease',
                }}
              >
                {t.icon}
              </span>
              <span
                className="font-semibold"
                style={{
                  fontSize: 10.5,
                  lineHeight: '12px',
                  letterSpacing: active ? '.2px' : 0,
                  opacity: active ? 1 : 0.85,
                }}
              >
                {t.label}
              </span>
              {t.badge ? (
                <span
                  className="absolute rounded-full"
                  style={{
                    top: 8,
                    right: 'calc(50% - 18px)',
                    width: 8,
                    height: 8,
                    background: '#EF4444',
                    border: '1.5px solid #fff',
                    boxShadow: '0 0 0 2px rgba(239,68,68,.18)',
                  }}
                  aria-label={`${t.badge} непрочитанных`}
                />
              ) : null}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
