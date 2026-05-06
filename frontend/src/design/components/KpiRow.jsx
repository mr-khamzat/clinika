/**
 * ========================================
 * БЛОК: <KpiRow> — сетка KPI-карточек
 * ========================================
 * Соответствует .kpi-row из design-preview-2.
 * Mobile-first: на узком — 2 колонки, на широких — 4.
 *
 * Props:
 *   cols      — желаемое макс. число колонок (по умолчанию 4)
 *   className — override
 *   children  — KpiCard элементы
 * ========================================
 */
export default function KpiRow({ cols = 4, className = '', children }) {
  // ─── Базовый набор колонок: на мобиле всегда 2 ───
  const colsClass =
    cols === 2
      ? 'grid-cols-2'
      : cols === 3
      ? 'grid-cols-2 md:grid-cols-3'
      : cols === 5
      ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5'
      : 'grid-cols-2 md:grid-cols-4'

  return (
    <div className={`grid gap-3 ${colsClass} ${className}`}>{children}</div>
  )
}
