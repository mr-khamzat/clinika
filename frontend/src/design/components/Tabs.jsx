/**
 * ========================================
 * БЛОК: <Tabs> — горизонтальные вкладки
 * ========================================
 * Соответствует .tabs из design-preview-2: подложка bg-2, активная вкладка — surface + border.
 *
 * Props:
 *   items     — массив { id: string, label: ReactNode, badge?: ReactNode }
 *   value     — id активной вкладки (controlled)
 *   onChange  — (id) => void
 *   className — override
 * ========================================
 */
export default function Tabs({ items = [], value, onChange, className = '' }) {
  return (
    <div
      className={`inline-flex items-center gap-1 ${className}`}
      role="tablist"
      style={{
        padding: '3px',
        background: 'var(--bg-2)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
      }}
    >
      {items.map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(item.id)}
            className="inline-flex items-center gap-1.5 font-medium transition-colors"
            style={{
              padding: '6px 12px',
              borderRadius: '7px',
              fontSize: '12.5px',
              background: active ? 'var(--surface)' : 'transparent',
              color: active ? 'var(--fg)' : 'var(--fg-2)',
              border: active ? '1px solid var(--border)' : '1px solid transparent',
              boxShadow: active ? 'var(--shadow-sm)' : 'none',
            }}
          >
            {item.label}
            {item.badge !== undefined && item.badge !== null && (
              <span
                style={{
                  fontSize: '10.5px',
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: '999px',
                  background: active ? 'var(--accent-soft)' : 'var(--bg-3)',
                  color: active ? 'var(--accent)' : 'var(--fg-3)',
                }}
              >
                {item.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
