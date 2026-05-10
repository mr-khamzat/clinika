/**
 * ========================================
 * БЛОК: <WikiArticleCard> — карточка статьи в списке категории
 * ========================================
 * Используется на странице /wiki?category=… для рендера grid статей.
 *
 * Props:
 *   icon    — имя Material Symbol для статьи
 *   title   — заголовок статьи
 *   summary — краткое описание (1-2 строки)
 *   to      — путь /wiki/{slug}
 *   accent  — основной цвет иконки/border на hover
 * ========================================
 */
import { Link } from 'react-router-dom'
import { useState } from 'react'

export default function WikiArticleCard({
  icon = 'article',
  title,
  summary,
  to,
  accent = 'var(--accent)',
  accentSoft = 'var(--accent-soft)',
}) {
  const [hover, setHover] = useState(false)
  return (
    <Link
      to={to}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group block rounded-xl p-5 transition-all duration-200 h-full"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${hover ? accent : 'var(--border)'}`,
        boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        transform: hover ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      <div className="flex items-start gap-4">
        <div
          className="flex items-center justify-center rounded-xl flex-shrink-0"
          style={{
            width: '44px',
            height: '44px',
            background: accentSoft,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: '24px',
              color: accent,
              fontVariationSettings: "'FILL' 1",
            }}
          >
            {icon}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h3
            className="font-semibold tracking-tight"
            style={{ fontSize: '15.5px', letterSpacing: '-0.01em', color: 'var(--fg)' }}
          >
            {title}
          </h3>
          {summary && (
            <p
              className="mt-1.5 leading-snug"
              style={{ fontSize: '13.5px', color: 'var(--fg-3)' }}
            >
              {summary}
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}
