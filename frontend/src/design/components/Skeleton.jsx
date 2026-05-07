/**
 * ========================================
 * БЛОК: <Skeleton> — анимированный shimmer-блок (loading placeholder)
 * ========================================
 * Используется вместо <Spinner /> когда грузится секция целиком —
 * показывает примерную форму контента, чтобы layout не «дрожал».
 *
 * Props:
 *   width    — CSS width (например 200, '100%', '6rem')
 *   height   — CSS height (например 18, '1rem')
 *   variant  — 'text' (radius 4) | 'rect' (radius 8) | 'circle' (квадрат, 50%)
 *   className — дополнительные классы
 *   style    — override
 *
 * Также экспортируется <TableSkeleton rows cols /> — заглушка под таблицу.
 * ========================================
 */
import './skeleton.css'

export default function Skeleton({
  width = '100%',
  height = 16,
  variant = 'text',
  className = '',
  style = {},
}) {
  // Радиус по варианту
  let radius
  if (variant === 'circle') radius = '50%'
  else if (variant === 'rect') radius = 8
  else radius = 4

  // circle всегда квадратная: width = height
  const w = variant === 'circle' ? height : width
  const h = height

  return (
    <span
      className={`ks-skeleton ${className}`}
      aria-busy="true"
      aria-live="polite"
      style={{
        display: 'inline-block',
        width: typeof w === 'number' ? `${w}px` : w,
        height: typeof h === 'number' ? `${h}px` : h,
        borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
        ...style,
      }}
    />
  )
}

/**
 * Заглушка-таблица: rows × cols ячеек одинаковой высоты.
 * Использовать пока загружается tbody.
 */
export function TableSkeleton({ rows = 5, cols = 4, rowHeight = 18, gap = 12 }) {
  const arr = Array.from({ length: rows })
  const cArr = Array.from({ length: cols })
  return (
    <div className="w-full" style={{ display: 'flex', flexDirection: 'column', gap }}>
      {arr.map((_, ri) => (
        <div key={ri} className="flex" style={{ gap }}>
          {cArr.map((__, ci) => (
            <div key={ci} className="flex-1">
              <Skeleton width="100%" height={rowHeight} variant="text" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
