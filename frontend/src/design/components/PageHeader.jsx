/**
 * ========================================
 * БЛОК: <PageHeader> — заголовок страницы
 * ========================================
 * Соответствует .page-head из design-preview-2:
 *   слева — крупный title + subtitle, справа — слот action (кнопки/чипы).
 *
 * Props:
 *   title     — заголовок (string или ReactNode)
 *   subtitle  — подзаголовок (string или ReactNode)
 *   actions   — ReactNode для правой части (кнопки и т.п.)
 *   className — override классов
 * ========================================
 */
export default function PageHeader({ title, subtitle, actions, className = '' }) {
  return (
    <header
      className={`flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6 sm:mb-7 ${className}`}
    >
      <div className="min-w-0">
        {title && (
          <h1
            className="font-semibold leading-tight tracking-tight"
            style={{ fontSize: '28px', letterSpacing: '-0.025em', color: 'var(--fg)' }}
          >
            {title}
          </h1>
        )}
        {subtitle && (
          <p className="mt-1.5 text-sm" style={{ color: 'var(--fg-3)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap gap-2 sm:flex-shrink-0">{actions}</div>
      )}
    </header>
  )
}
