import { useState, useEffect, useMemo } from 'react'
import axios from 'axios'

/**
 * Динамика лабораторных показателей пациента.
 *
 * UI:
 *  - Селектор периода (6 / 12 / 24 месяцев)
 *  - Список аналитов (сначала проблемные: high/low, потом ok)
 *  - Каждая карточка раскрывается → inline SVG line-chart с зелёной зоной нормы
 *
 * Графики — чистый SVG без зависимостей (в этом проекте не используем recharts/chart.js).
 *
 * API: GET /patient/lab-dynamics?t={token}&months={n}
 */
export default function PatientLabDynamics({ apiBase, sessionToken }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [months, setMonths] = useState(12)
  const [expandedName, setExpandedName] = useState(null)

  useEffect(() => {
    if (!sessionToken) {
      setLoading(false)
      setError('Нет сессии')
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    axios
      .get(`${apiBase}/patient/lab-dynamics`, { params: { t: sessionToken, months } })
      .then(r => { if (!cancelled) setData(r.data) })
      .catch(err => {
        if (cancelled) return
        setError(err?.response?.status === 401 ? 'Сессия истекла' : 'Не удалось загрузить динамику')
        setData({ analytes: [] })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [apiBase, sessionToken, months])

  if (loading) {
    return (
      <div className="p-6 text-center text-gray-400 dark:text-gray-500 text-sm">
        <div className="inline-block animate-pulse">Загрузка динамики анализов…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <div className="text-4xl mb-2">⚠️</div>
        <div className="text-gray-600 dark:text-gray-300 text-sm">{error}</div>
      </div>
    )
  }

  const analytes = data?.analytes || []

  if (!analytes.length) {
    return (
      <div className="p-6 text-center">
        <div className="text-5xl mb-3">📊</div>
        <div className="text-gray-700 dark:text-gray-200 text-sm font-semibold">Пока нет данных анализов</div>
        <div className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          После первого анализа здесь появится динамика ваших показателей
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 p-2">
      {/* Заголовок и селектор периода */}
      <div className="px-2">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Изменение показателей за выбранный период. Зелёная зона на графике — диапазон нормы.
        </div>
        <div className="flex gap-2">
          {[6, 12, 24].map(m => (
            <button
              key={m}
              onClick={() => setMonths(m)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold transition"
              style={{
                background: months === m ? '#0097A7' : '#f1f5f9',
                color: months === m ? '#fff' : '#475569',
                boxShadow: months === m ? '0 2px 8px rgba(0,151,167,0.25)' : 'none',
              }}
            >
              {m} мес
            </button>
          ))}
        </div>
      </div>

      {/* Список показателей */}
      {analytes.map(a => (
        <AnalyteCard
          key={a.name}
          a={a}
          isExpanded={expandedName === a.name}
          onToggle={() => setExpandedName(expandedName === a.name ? null : a.name)}
        />
      ))}

      <div className="text-[10px] text-gray-400 dark:text-gray-500 text-center pt-2 px-4">
        Данные импортируются автоматически из МИС после каждого анализа.
        Норма-диапазоны — референсные значения для взрослых.
      </div>
    </div>
  )
}


function AnalyteCard({ a, isExpanded, onToggle }) {
  const statusColor =
    a.status === 'ok'   ? '#16a34a' :
    a.status === 'high' ? '#dc2626' :
    a.status === 'low'  ? '#f59e0b' : '#64748b'
  const statusLabel =
    a.status === 'ok'   ? 'В норме' :
    a.status === 'high' ? 'Повышен' :
    a.status === 'low'  ? 'Понижен' : '—'

  const hasNorm = a.norm_min != null && a.norm_max != null && a.norm_max < 999

  return (
    <div
      className="rounded-2xl border bg-white dark:bg-gray-800 shadow-sm overflow-hidden transition"
      style={{ borderColor: isExpanded ? statusColor : '#e5e7eb' }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-gray-50 dark:bg-gray-700/30"
      >
        <div className="text-2xl flex-shrink-0" aria-hidden>{a.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{a.name}</div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            {a.count} {a.count === 1 ? 'измерение' : a.count < 5 ? 'измерения' : 'измерений'}
            {a.last_date && ` · ${new Date(a.last_date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })}`}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-bold text-lg leading-tight" style={{ color: statusColor }}>
            {a.last_value}
            <span className="text-[11px] text-gray-500 dark:text-gray-400 font-normal ml-1">{a.unit}</span>
          </div>
          <div className="flex items-center gap-1.5 justify-end mt-0.5">
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: statusColor + '22', color: statusColor }}
            >
              {statusLabel}
            </span>
            {a.delta_pct != null && a.delta_pct !== 0 && (
              <span
                className="text-[10px] font-semibold"
                style={{ color: a.delta_pct > 0 ? '#16a34a' : '#dc2626' }}
              >
                {a.delta_pct > 0 ? '↑' : '↓'} {Math.abs(a.delta_pct)}%
              </span>
            )}
          </div>
        </div>
        <span
          className="material-symbols-outlined text-gray-400 dark:text-gray-500 ml-1 transition-transform"
          style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', fontSize: 20 }}
          aria-hidden
        >
          expand_more
        </span>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t" style={{ borderColor: '#f1f5f9' }}>
          <SvgLineChart analyte={a} statusColor={statusColor} hasNorm={hasNorm} />
          {hasNorm && (
            <div className="text-[11px] text-gray-500 dark:text-gray-400 text-center mt-1">
              Норма:{' '}
              <span className="font-semibold text-green-700">
                {a.norm_min} – {a.norm_max} {a.unit}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


/**
 * Inline SVG line-chart с зелёной зоной нормы, dot-маркерами и tooltip на hover.
 * Без сторонних либ.
 */
function SvgLineChart({ analyte, statusColor, hasNorm }) {
  const [hoverIdx, setHoverIdx] = useState(null)
  const points = analyte.points || []

  const geom = useMemo(() => {
    if (!points.length) return null
    const w = 320
    const h = 180
    const pad = { l: 36, r: 12, t: 16, b: 26 }
    const innerW = w - pad.l - pad.r
    const innerH = h - pad.t - pad.b

    const vals = points.map(p => p.value)
    let yMin = Math.min(...vals)
    let yMax = Math.max(...vals)
    // Расширяем по норме чтобы зелёная зона была видна
    if (hasNorm) {
      yMin = Math.min(yMin, analyte.norm_min)
      yMax = Math.max(yMax, analyte.norm_max)
    }
    if (yMin === yMax) {
      // Если все значения одинаковые — небольшой запас
      yMin -= 1
      yMax += 1
    }
    const pad05 = (yMax - yMin) * 0.1 || 1
    yMin -= pad05
    yMax += pad05

    const xStep = points.length > 1 ? innerW / (points.length - 1) : 0
    const x = (i) => pad.l + i * xStep
    const y = (v) => pad.t + innerH - ((v - yMin) / (yMax - yMin)) * innerH

    const linePoints = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')

    // Трендовая линия (linear regression)
    const n = points.length
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
    points.forEach((p, i) => {
      sumX += i
      sumY += p.value
      sumXY += i * p.value
      sumXX += i * i
    })
    const denom = n * sumXX - sumX * sumX
    let trendLine = null
    if (n >= 2 && denom !== 0) {
      const slope = (n * sumXY - sumX * sumY) / denom
      const intercept = (sumY - slope * sumX) / n
      const y0 = intercept
      const y1 = intercept + slope * (n - 1)
      trendLine = { x0: x(0), y0: y(y0), x1: x(n - 1), y1: y(y1) }
    }

    // Зелёная зона нормы (в SVG-координатах)
    let normBand = null
    if (hasNorm) {
      const yTop = Math.max(pad.t, Math.min(pad.t + innerH, y(analyte.norm_max)))
      const yBot = Math.max(pad.t, Math.min(pad.t + innerH, y(analyte.norm_min)))
      normBand = { yTop, yBot, x: pad.l, width: innerW }
    }

    // Y-axis тики (3 шт)
    const ticks = [yMin, (yMin + yMax) / 2, yMax].map(v => ({
      v,
      y: y(v),
      label: Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1),
    }))

    return { w, h, pad, innerW, innerH, x, y, linePoints, trendLine, normBand, ticks, points }
  }, [points, hasNorm, analyte.norm_min, analyte.norm_max])

  if (!geom) return null

  const fmtDate = (iso) =>
    new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })

  // Какие даты подписывать: первая, последняя, и максимум 2 промежуточных
  const labelIdx = (() => {
    const n = points.length
    if (n <= 4) return points.map((_, i) => i)
    const set = new Set([0, n - 1])
    set.add(Math.floor(n / 3))
    set.add(Math.floor((2 * n) / 3))
    return [...set].sort((a, b) => a - b)
  })()

  return (
    <div className="relative w-full" style={{ aspectRatio: `${geom.w}/${geom.h}` }}>
      <svg
        viewBox={`0 0 ${geom.w} ${geom.h}`}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Зелёная зона нормы */}
        {geom.normBand && (
          <>
            <rect
              x={geom.normBand.x}
              y={geom.normBand.yTop}
              width={geom.normBand.width}
              height={Math.max(0, geom.normBand.yBot - geom.normBand.yTop)}
              fill="#16a34a"
              fillOpacity={0.10}
            />
            <line
              x1={geom.normBand.x}
              y1={geom.normBand.yTop}
              x2={geom.normBand.x + geom.normBand.width}
              y2={geom.normBand.yTop}
              stroke="#16a34a"
              strokeOpacity={0.3}
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <line
              x1={geom.normBand.x}
              y1={geom.normBand.yBot}
              x2={geom.normBand.x + geom.normBand.width}
              y2={geom.normBand.yBot}
              stroke="#16a34a"
              strokeOpacity={0.3}
              strokeDasharray="3 3"
              strokeWidth={1}
            />
          </>
        )}

        {/* Y-axis */}
        {geom.ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={geom.pad.l}
              x2={geom.pad.l + geom.innerW}
              y1={t.y}
              y2={t.y}
              stroke="#f1f5f9"
              strokeWidth={1}
            />
            <text
              x={geom.pad.l - 6}
              y={t.y + 3}
              fontSize={9}
              fill="#94a3b8"
              textAnchor="end"
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {labelIdx.map(i => (
          <text
            key={i}
            x={geom.x(i)}
            y={geom.h - geom.pad.b + 14}
            fontSize={9}
            fill="#94a3b8"
            textAnchor="middle"
          >
            {fmtDate(points[i].date)}
          </text>
        ))}

        {/* Trend line (dashed) */}
        {geom.trendLine && (
          <line
            x1={geom.trendLine.x0}
            y1={geom.trendLine.y0}
            x2={geom.trendLine.x1}
            y2={geom.trendLine.y1}
            stroke={statusColor}
            strokeOpacity={0.35}
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
        )}

        {/* Main polyline */}
        <polyline
          points={geom.linePoints}
          fill="none"
          stroke={statusColor}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Dots + invisible hover-targets */}
        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={geom.x(i)}
              cy={geom.y(p.value)}
              r={hoverIdx === i ? 5.5 : 3.5}
              fill={statusColor}
              stroke="#fff"
              strokeWidth={2}
            />
            <circle
              cx={geom.x(i)}
              cy={geom.y(p.value)}
              r={14}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
              onTouchStart={() => setHoverIdx(i)}
              style={{ cursor: 'pointer' }}
            />
          </g>
        ))}

        {/* Tooltip */}
        {hoverIdx != null && points[hoverIdx] && (() => {
          const cx = geom.x(hoverIdx)
          const cy = geom.y(points[hoverIdx].value)
          const tipW = 100
          const tipH = 36
          const tipX = Math.min(Math.max(cx - tipW / 2, 2), geom.w - tipW - 2)
          const tipY = Math.max(cy - tipH - 10, 2)
          return (
            <g pointerEvents="none">
              <rect
                x={tipX}
                y={tipY}
                width={tipW}
                height={tipH}
                rx={6}
                fill="#1e293b"
                fillOpacity={0.95}
              />
              <text x={tipX + tipW / 2} y={tipY + 14} fontSize={10} fill="#fff" textAnchor="middle" fontWeight="600">
                {points[hoverIdx].value} {analyte.unit}
              </text>
              <text x={tipX + tipW / 2} y={tipY + 28} fontSize={9} fill="#cbd5e1" textAnchor="middle">
                {fmtDate(points[hoverIdx].date)}
              </text>
            </g>
          )
        })()}
      </svg>
    </div>
  )
}
