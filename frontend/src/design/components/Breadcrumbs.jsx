/**
 * ========================================
 * БЛОК: <Breadcrumbs> — навигационная цепочка
 * ========================================
 * Используется сверху каждого раздела /admin для контекста положения.
 *
 * Пример:
 *   <Breadcrumbs items={[
 *     { label: 'Платформа' },
 *     { label: 'Тенанты', to: () => onNav('super_admin') },
 *     { label: 'АРЦ КлиникаСеть' },
 *   ]} />
 *
 * Props:
 *   items     — массив { label: string, to?: () => void }
 *               последний элемент — текущая страница (без `to`)
 *   className — override
 *
 * Стиль:
 *   - text-fg-3 для всего ряда
 *   - hover на ссылках поднимает цвет до --fg
 *   - chevron_right между элементами (Material Symbols)
 * ========================================
 */
export default function Breadcrumbs({ items = [], className = '' }) {
  // Не рендерим, если нет элементов или один пункт (нечего показывать)
  if (!Array.isArray(items) || items.length < 2) return null

  return (
    <nav
      aria-label="Навигационная цепочка"
      className={`flex flex-wrap items-center gap-1 mb-3 ${className}`}
      style={{ fontSize: '12.5px', color: 'var(--fg-3)' }}
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1
        const isLink = !isLast && typeof item.to === 'function'
        return (
          <span key={`${idx}-${item.label}`} className="inline-flex items-center gap-1 min-w-0">
            {isLink ? (
              <button
                type="button"
                onClick={item.to}
                className="truncate transition-colors"
                style={{
                  color: 'var(--fg-3)',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--fg)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--fg-3)' }}
                title={item.label}
              >
                {item.label}
              </button>
            ) : (
              <span
                className="truncate"
                style={{ color: isLast ? 'var(--fg)' : 'var(--fg-3)', fontWeight: isLast ? 500 : 400 }}
                title={item.label}
                aria-current={isLast ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
            {!isLast && (
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '16px', color: 'var(--fg-4)' }}
                aria-hidden="true"
              >
                chevron_right
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
