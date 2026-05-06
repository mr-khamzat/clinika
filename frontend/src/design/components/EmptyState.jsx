/**
 * ========================================
 * БЛОК: <EmptyState> — заглушка пустого списка
 * ========================================
 * Иконка + заголовок + описание + опциональная кнопка-действие.
 *
 * Props:
 *   icon      — ReactNode (иконка/эмодзи)
 *   title     — заголовок
 *   message   — описание (subtitle)
 *   action    — ReactNode для кнопки-действия (например <Button>...</Button>)
 *   className — override
 * ========================================
 */
export default function EmptyState({ icon, title, message, action, className = '' }) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-6 py-10 ${className}`}
      style={{ color: 'var(--fg-2)' }}
    >
      {icon && (
        <div
          className="mb-4 inline-grid place-items-center"
          style={{
            width: 56,
            height: 56,
            borderRadius: 'var(--radius)',
            background: 'var(--bg-2)',
            color: 'var(--fg-3)',
            fontSize: 24,
          }}
        >
          {icon}
        </div>
      )}
      {title && (
        <h3
          className="font-semibold"
          style={{ fontSize: '15px', color: 'var(--fg)' }}
        >
          {title}
        </h3>
      )}
      {message && (
        <p
          className="mt-1.5 max-w-md"
          style={{ fontSize: '13px', color: 'var(--fg-3)' }}
        >
          {message}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
