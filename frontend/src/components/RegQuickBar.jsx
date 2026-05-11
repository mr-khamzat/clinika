/**
 * ========================================
 * КОМПОНЕНТ: RegQuickBar — полоса быстрых действий регистратора (Глава 5)
 * ========================================
 * Premium 48×48 иконки в шапке OperationalCabinet:
 *   🆕 Новый пациент (Alt+N)
 *   📅 Запись (Alt+R)
 *   🔍 Поиск (Alt+S)
 *   🖨 Печать последнего (Alt+P)
 *   📋 Список (Alt+W)
 *   ⚙ Профиль клиники
 *
 * Mobile (<768px): горизонтальный скролл, без подписей.
 * Tooltip с горячей клавишей при наведении.
 * ========================================
 */
import { useEffect, useState } from 'react'

const ITEMS = [
  { key: 'new',      label: 'Пациент',    hint: 'Alt+N', icon: 'person_add',     accent: '#10b981' },
  { key: 'book',     label: 'Запись',     hint: 'Alt+R', icon: 'event_available', accent: '#3b82f6' },
  { key: 'search',   label: 'Поиск',      hint: 'Alt+S', icon: 'search',          accent: '#0a6e85' },
  { key: 'print',    label: 'Печать',     hint: 'Alt+P', icon: 'print',           accent: '#6b7280' },
  { key: 'waitlist', label: 'Ожидание',   hint: 'Alt+W', icon: 'list_alt',        accent: '#f59e0b' },
  { key: 'cmd',      label: 'Команды',    hint: 'Ctrl+K', icon: 'bolt',            accent: '#a855f7' },
]

function Icon({ name, size = 22 }) {
  return (
    <span
      className="material-symbols-outlined"
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' 1`,
        lineHeight: 1,
      }}
    >{name}</span>
  )
}

export default function RegQuickBar({ onAction, lastPrintAvailable = false }) {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  useEffect(() => {
    const h = () => setMobile(window.innerWidth < 768)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  return (
    <div
      className="reg-quickbar"
      role="toolbar"
      aria-label="Быстрые действия регистратора"
      style={{
        display: 'flex',
        gap: 8,
        overflowX: mobile ? 'auto' : 'visible',
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch',
        padding: mobile ? '6px 0 2px' : '4px 0 0',
        marginTop: 12,
      }}
    >
      {ITEMS.map(it => {
        const disabled = it.key === 'print' && !lastPrintAvailable
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => !disabled && onAction?.(it.key)}
            disabled={disabled}
            title={`${it.label} · ${it.hint}`}
            aria-label={`${it.label} (${it.hint})`}
            className="reg-quickbar-btn"
            style={{
              flex: mobile ? '0 0 auto' : '1 1 0',
              minWidth: mobile ? 64 : 72,
              minHeight: 60,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              padding: '6px 4px',
              borderRadius: 14,
              background: disabled ? 'oklch(1 0 0 / 0.06)' : 'oklch(1 0 0 / 0.12)',
              border: '1px solid oklch(1 0 0 / 0.20)',
              backdropFilter: 'blur(8px)',
              color: '#fff',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.45 : 1,
              transition: 'transform .08s, background .12s',
            }}
            onPointerDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'scale(0.96)' }}
            onPointerUp={(e) => { e.currentTarget.style.transform = '' }}
            onPointerLeave={(e) => { e.currentTarget.style.transform = '' }}
          >
            <span
              style={{
                width: 36, height: 36,
                display: 'grid', placeItems: 'center',
                borderRadius: 10,
                background: `linear-gradient(135deg, ${it.accent}, ${it.accent}cc)`,
                color: '#fff',
                boxShadow: '0 2px 6px oklch(0 0 0 / 0.18)',
              }}
            >
              <Icon name={it.icon} size={20} />
            </span>
            {!mobile && (
              <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.02, lineHeight: 1.1 }}>
                {it.label}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
