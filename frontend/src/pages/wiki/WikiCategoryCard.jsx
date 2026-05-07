/**
 * ========================================
 * БЛОК: <WikiCategoryCard> — карточка категории на главной
 * ========================================
 * Кликабельная карточка с цветной иконкой Material Symbols, заголовком,
 * описанием и бейджем количества статей. Hover — lift + accent border.
 *
 * Props:
 *   icon        — имя Material Symbol (rounded)
 *   title       — заголовок категории
 *   description — описание (1-2 строки)
 *   count       — количество статей
 *   accent      — opaque hex/oklch цвет акцента иконки (фон tinted)
 *   to          — путь (например, /wiki?category=role)
 * ========================================
 */
import { Link } from 'react-router-dom'
import { useState } from 'react'

export default function WikiCategoryCard({
  icon,
  title,
  description,
  count,
  accent = 'var(--accent)',
  accentSoft = 'var(--accent-soft)',
  to,
}) {
  const [hover, setHover] = useState(false)

  return (
    <Link
      to={to}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative block rounded-2xl p-6 sm:p-7 transition-all duration-200"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${hover ? accent : 'var(--border)'}`,
        boxShadow: hover ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
        transform: hover ? 'translateY(-2px)' : 'translateY(0)',
      }}
    >
      {/* ─── Иконка в цветном бэкграунде ─── */}
      <div
        className="inline-flex items-center justify-center rounded-2xl transition-transform duration-200"
        style={{
          width: '56px',
          height: '56px',
          background: accentSoft,
          transform: hover ? 'scale(1.05)' : 'scale(1)',
        }}
      >
        <span
          className="material-symbols-rounded"
          style={{
            fontSize: '32px',
            color: accent,
            fontVariationSettings: "'FILL' 1, 'wght' 500",
          }}
        >
          {icon}
        </span>
      </div>

      {/* ─── Заголовок + бейдж количества ─── */}
      <div className="mt-5 flex items-center gap-2 flex-wrap">
        <h3
          className="font-semibold tracking-tight"
          style={{ fontSize: '20px', letterSpacing: '-0.02em', color: 'var(--fg)' }}
        >
          {title}
        </h3>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full font-medium"
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--border)',
            color: 'var(--fg-2)',
            fontSize: '11.5px',
          }}
        >
          {count} {pluralize(count)}
        </span>
      </div>

      {/* ─── Описание ─── */}
      <p
        className="mt-2 leading-relaxed"
        style={{ fontSize: '14.5px', color: 'var(--fg-3)' }}
      >
        {description}
      </p>

      {/* ─── Стрелка-индикатор внизу ─── */}
      <div
        className="mt-5 inline-flex items-center gap-1.5 font-medium transition-colors"
        style={{
          fontSize: '13.5px',
          color: hover ? accent : 'var(--fg-2)',
        }}
      >
        Смотреть статьи
        <span
          className="material-symbols-rounded transition-transform duration-200"
          style={{
            fontSize: '18px',
            transform: hover ? 'translateX(3px)' : 'translateX(0)',
          }}
        >
          arrow_forward
        </span>
      </div>
    </Link>
  )
}

function pluralize(n) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'статья'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'статьи'
  return 'статей'
}
