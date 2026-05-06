/**
 * ========================================
 * БЛОК: <KpiCard> — карточка-метрика
 * ========================================
 * Соответствует .kpi из design-preview-2.
 *
 * Props:
 *   label    — подпись (короткий текст, fg-3)
 *   value    — крупное число/значение
 *   delta    — изменение (например '+12%' или '-5')
 *   trend    — 'up' | 'down' | 'flat' — определяет цвет delta (good/bad/fg-3)
 *   icon     — опциональная ReactNode иконка слева от label
 *   className — override
 * ========================================
 */
export default function KpiCard({ label, value, delta, trend = 'up', icon, className = '' }) {
  // ─── Цвет дельты по тренду ───
  const deltaColor =
    trend === 'down' ? 'var(--bad)' : trend === 'flat' ? 'var(--fg-3)' : 'var(--good)'

  return (
    <div
      className={className}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '14px 16px',
      }}
    >
      <div className="flex items-center gap-2">
        {icon && (
          <span style={{ color: 'var(--fg-3)', display: 'inline-flex' }}>{icon}</span>
        )}
        <span
          className="font-medium"
          style={{ fontSize: '11.5px', color: 'var(--fg-3)' }}
        >
          {label}
        </span>
      </div>
      <div
        className="mt-1 font-semibold"
        style={{
          fontSize: '22px',
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--fg)',
        }}
      >
        {value}
      </div>
      {delta !== undefined && delta !== null && delta !== '' && (
        <div
          className="mt-0.5 font-medium"
          style={{ fontSize: '11px', color: deltaColor }}
        >
          {delta}
        </div>
      )}
    </div>
  )
}
