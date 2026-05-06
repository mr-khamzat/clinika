/**
 * ========================================
 * БЛОК: <Sparkline> — мини-график без зависимостей
 * ========================================
 * Простая SVG-линия по массиву чисел; опциональная заливка под линией.
 *
 * Props:
 *   data      — массив чисел
 *   width     — ширина SVG (по умолчанию 120)
 *   height    — высота SVG (по умолчанию 36)
 *   stroke    — цвет линии (CSS, по умолчанию var(--accent))
 *   fill      — цвет заливки под линией (CSS); если null — без заливки
 *   strokeWidth — толщина линии (по умолчанию 1.6)
 *   className — override
 * ========================================
 */
export default function Sparkline({
  data = [],
  width = 120,
  height = 36,
  stroke = 'var(--accent)',
  fill = 'var(--accent-soft)',
  strokeWidth = 1.6,
  className = '',
}) {
  if (!data || data.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={className}
        aria-hidden
      />
    )
  }
  // ─── Нормализация значений в координаты ───
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const stepX = data.length > 1 ? width / (data.length - 1) : width
  const PAD_Y = 2

  const pts = data.map((v, i) => {
    const x = i * stepX
    const y = PAD_Y + (height - PAD_Y * 2) * (1 - (v - min) / range)
    return [x, y]
  })

  const linePath = pts
    .map(([x, y], i) => (i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : `L ${x.toFixed(2)} ${y.toFixed(2)}`))
    .join(' ')

  const areaPath = fill
    ? `${linePath} L ${(pts[pts.length - 1][0]).toFixed(2)} ${height} L 0 ${height} Z`
    : null

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
    >
      {areaPath && <path d={areaPath} fill={fill} stroke="none" />}
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
