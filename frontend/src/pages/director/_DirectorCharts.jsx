/**
 * ========================================
 * БЛОК: Графики для кабинета директора — самописные SVG, без зависимостей
 * ========================================
 * Все графики:
 *   • Адаптивны (width=100% контейнера, viewBox)
 *   • Mobile-friendly (минимум 280px ширины, читаемые подписи)
 *   • Используют CSS-токены дизайн-системы (var(--accent), var(--good), ...)
 *
 * Экспорты:
 *   <LineChart series=[{name,color,points}] xLabels />        — линейный (1+ линии)
 *   <BarChart  items=[{label,value,color?}] horizontal />     — гор/верт bar
 *   <StackedBarChart items=[{label, parts:[{value,color}]}] />— stacked bar
 *   <DonutChart slices=[{label,value,color}] />               — donut + легенда
 *   <FunnelChart stages=[{name,count,conversion_pct}] />      — воронка
 *   <SparkLine data=[n,n,...] />                              — крошечный спарк
 * ========================================
 */
import { useId } from 'react'

const palette = [
  '#1565c0', '#7c3aed', '#059669', '#dc2626',
  '#d97706', '#0891b2', '#db2777', '#65a30d',
]
const num = (v) => Number(v) || 0
const fmt = (v) => num(v).toLocaleString('ru-RU')

// ─── Линейный график ─────────────────────────────────────────────────────────
export function LineChart({
  series = [],         // [{name, color?, points:[number,...]}]
  xLabels = [],        // подписи под X (1:1 с длиной точек)
  height = 220,
  showLegend = true,
  yFormatter = fmt,
}) {
  const uid = useId().replace(/:/g, '')
  const W = 600, H = height
  const PADL = 48, PADR = 12, PADT = 12, PADB = 32
  const plotW = W - PADL - PADR
  const plotH = H - PADT - PADB

  const allPoints = series.flatMap(s => s.points || [])
  if (!allPoints.length) {
    return <div className="text-center py-8" style={{ color: 'var(--fg-3)', fontSize: 13 }}>Нет данных</div>
  }
  const maxY = Math.max(...allPoints, 1)
  const minY = Math.min(...allPoints, 0)
  const rangeY = maxY - minY || 1
  const lenX = Math.max(...series.map(s => (s.points || []).length), 1)
  const stepX = lenX > 1 ? plotW / (lenX - 1) : plotW

  const yToPx = (v) => PADT + plotH * (1 - (v - minY) / rangeY)
  const xToPx = (i) => PADL + i * stepX

  // 4 горизонтальные сетки
  const grid = []
  for (let i = 0; i <= 4; i++) {
    const v = minY + (rangeY * i) / 4
    const y = yToPx(v)
    grid.push({ y, label: yFormatter(Math.round(v)) })
  }

  return (
    <div style={{ width: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: H, display: 'block' }}
        role="img"
      >
        {/* сетка */}
        {grid.map((g, i) => (
          <g key={`grid-${i}`}>
            <line x1={PADL} x2={W - PADR} y1={g.y} y2={g.y} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PADL - 6} y={g.y + 3} fontSize="9" fill="var(--fg-3)" textAnchor="end">
              {g.label}
            </text>
          </g>
        ))}
        {/* подписи X */}
        {xLabels.map((lbl, i) => {
          // показываем только каждую N-ю чтобы не перекрывалось
          const skip = Math.max(1, Math.ceil(xLabels.length / 8))
          if (i % skip !== 0 && i !== xLabels.length - 1) return null
          return (
            <text key={`xl-${i}`} x={xToPx(i)} y={H - 10} fontSize="9" fill="var(--fg-3)" textAnchor="middle">
              {lbl}
            </text>
          )
        })}
        {/* линии серий */}
        {series.map((s, sIdx) => {
          const pts = s.points || []
          if (!pts.length) return null
          const color = s.color || palette[sIdx % palette.length]
          const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xToPx(i)} ${yToPx(v)}`).join(' ')
          return (
            <g key={`s-${sIdx}`}>
              <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((v, i) => (
                <circle key={`p-${sIdx}-${i}`} cx={xToPx(i)} cy={yToPx(v)} r="2" fill={color} />
              ))}
            </g>
          )
        })}
      </svg>
      {showLegend && series.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-3 justify-center" style={{ fontSize: 12 }}>
          {series.map((s, sIdx) => (
            <span key={`leg-${uid}-${sIdx}`} className="inline-flex items-center gap-1.5" style={{ color: 'var(--fg-2)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color || palette[sIdx % palette.length], display: 'inline-block' }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Bar chart (вертикальный или горизонтальный) ─────────────────────────────
export function BarChart({
  items = [],            // [{label, value, color?, sub?}]
  horizontal = false,
  formatter = fmt,
  maxBars = 20,
  height = 220,
}) {
  const data = (items || []).slice(0, maxBars)
  if (!data.length) {
    return <div className="text-center py-8" style={{ color: 'var(--fg-3)', fontSize: 13 }}>Нет данных</div>
  }
  const maxV = Math.max(...data.map(d => num(d.value)), 1)

  if (horizontal) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.map((it, i) => {
          const pct = (num(it.value) / maxV) * 100
          const color = it.color || palette[i % palette.length]
          return (
            <div key={`hb-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: '0 0 38%', minWidth: 0, fontSize: 12, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.label}
              </div>
              <div style={{ flex: 1, height: 22, background: 'var(--bg-2)', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  height: '100%', width: `${pct}%`,
                  background: `linear-gradient(90deg, ${color}, ${color}cc)`,
                  borderRadius: 6, transition: 'width 600ms ease',
                }} />
              </div>
              <div style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 700, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'right' }}>
                {formatter(it.value)}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // Вертикальный
  const W = 600, H = height
  const PADL = 36, PADR = 8, PADT = 10, PADB = 38
  const plotW = W - PADL - PADR
  const plotH = H - PADT - PADB
  const barW = plotW / data.length * 0.7
  const gap = plotW / data.length * 0.3

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: H, display: 'block' }}
      role="img"
    >
      {/* baseline */}
      <line x1={PADL} x2={W - PADR} y1={H - PADB} y2={H - PADB} stroke="var(--border)" strokeWidth="0.5" />
      {data.map((it, i) => {
        const color = it.color || palette[i % palette.length]
        const h = (num(it.value) / maxV) * plotH
        const x = PADL + i * (barW + gap) + gap / 2
        const y = H - PADB - h
        return (
          <g key={`vb-${i}`}>
            <rect x={x} y={y} width={barW} height={h} rx="3" fill={color} opacity="0.9" />
            <text x={x + barW / 2} y={y - 4} fontSize="9" fill="var(--fg-2)" textAnchor="middle" fontWeight="600">
              {formatter(it.value)}
            </text>
            <text x={x + barW / 2} y={H - PADB + 14} fontSize="9" fill="var(--fg-3)" textAnchor="middle">
              {it.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Stacked Bar chart ────────────────────────────────────────────────────────
export function StackedBarChart({
  items = [],          // [{label, parts:[{name,value,color}]}]
  formatter = fmt,
  height = 220,
}) {
  if (!items.length) {
    return <div className="text-center py-8" style={{ color: 'var(--fg-3)', fontSize: 13 }}>Нет данных</div>
  }
  const sums = items.map(it => (it.parts || []).reduce((a, p) => a + num(p.value), 0))
  const maxV = Math.max(...sums, 1)

  const W = 600, H = height
  const PADL = 36, PADR = 8, PADT = 10, PADB = 38
  const plotW = W - PADL - PADR
  const plotH = H - PADT - PADB
  const barW = plotW / items.length * 0.7
  const gap = plotW / items.length * 0.3

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: H, display: 'block' }}
      role="img"
    >
      <line x1={PADL} x2={W - PADR} y1={H - PADB} y2={H - PADB} stroke="var(--border)" strokeWidth="0.5" />
      {items.map((it, i) => {
        const x = PADL + i * (barW + gap) + gap / 2
        let yAcc = H - PADB
        return (
          <g key={`sb-${i}`}>
            {(it.parts || []).map((p, pi) => {
              const h = (num(p.value) / maxV) * plotH
              yAcc -= h
              return (
                <rect
                  key={`sbp-${i}-${pi}`}
                  x={x} y={yAcc} width={barW} height={h}
                  fill={p.color || palette[pi % palette.length]}
                  opacity="0.9"
                />
              )
            })}
            <text x={x + barW / 2} y={H - PADB + 14} fontSize="9" fill="var(--fg-3)" textAnchor="middle">
              {it.label}
            </text>
            <text x={x + barW / 2} y={yAcc - 3} fontSize="9" fill="var(--fg-2)" textAnchor="middle" fontWeight="600">
              {formatter(sums[i])}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Donut chart с легендой ──────────────────────────────────────────────────
export function DonutChart({ slices = [], formatter = fmt, size = 200 }) {
  const data = (slices || []).filter(s => num(s.value) > 0)
  if (!data.length) {
    return <div className="text-center py-8" style={{ color: 'var(--fg-3)', fontSize: 13 }}>Нет данных</div>
  }
  const total = data.reduce((a, s) => a + num(s.value), 0)
  const R = size / 2 - 6
  const cx = size / 2, cy = size / 2
  let acc = 0
  const arcs = data.map((s, i) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2
    acc += num(s.value)
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2
    const large = end - start > Math.PI ? 1 : 0
    const x1 = cx + R * Math.cos(start)
    const y1 = cy + R * Math.sin(start)
    const x2 = cx + R * Math.cos(end)
    const y2 = cy + R * Math.sin(end)
    return { d: `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`, color: s.color || palette[i % palette.length] }
  })

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }} role="img">
        {arcs.map((a, i) => <path key={`arc-${i}`} d={a.d} fill={a.color} />)}
        <circle cx={cx} cy={cy} r={R * 0.55} fill="var(--surface)" />
        <text x={cx} y={cy - 4} fontSize="10" fill="var(--fg-3)" textAnchor="middle">Всего</text>
        <text x={cx} y={cy + 12} fontSize="14" fill="var(--fg)" textAnchor="middle" fontWeight="700">{formatter(total)}</text>
      </svg>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map((s, i) => {
          const pct = ((num(s.value) / total) * 100).toFixed(1)
          return (
            <div key={`leg-${i}`} className="flex items-center gap-2" style={{ fontSize: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: arcs[i].color, flexShrink: 0 }} />
              <span style={{ color: 'var(--fg-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
              <span style={{ color: 'var(--fg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {formatter(s.value)} · {pct}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Воронка ─────────────────────────────────────────────────────────────────
export function FunnelChart({ stages = [], formatter = fmt }) {
  if (!stages.length) {
    return <div className="text-center py-8" style={{ color: 'var(--fg-3)', fontSize: 13 }}>Нет данных</div>
  }
  const maxV = Math.max(...stages.map(s => num(s.count)), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {stages.map((st, i) => {
        const pct = (num(st.count) / maxV) * 100
        const conv = st.conversion_pct != null ? `${Number(st.conversion_pct).toFixed(1)}%` : null
        const color = palette[i % palette.length]
        return (
          <div key={`fn-${i}`}>
            <div className="flex items-center justify-between mb-1" style={{ fontSize: 12 }}>
              <span style={{ color: 'var(--fg-2)', fontWeight: 600 }}>{st.name}</span>
              <span style={{ color: 'var(--fg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {formatter(st.count)}{conv && <span style={{ color: 'var(--fg-3)', marginLeft: 8, fontWeight: 500 }}>{conv}</span>}
              </span>
            </div>
            <div style={{ height: 28, background: 'var(--bg-2)', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
              <div style={{
                height: '100%', width: `${pct}%`,
                background: `linear-gradient(90deg, ${color}, ${color}aa)`,
                borderRadius: 6, transition: 'width 600ms ease',
              }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Sparkline (тонкая линия для виджетов) ──────────────────────────────────
export function SparkLine({ data = [], width = 120, height = 36, color = 'var(--accent)' }) {
  if (!data || data.length < 2) return <svg width={width} height={height} />
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const stepX = width / (data.length - 1)
  const pts = data.map((v, i) => `${i * stepX},${2 + (height - 4) * (1 - (v - min) / range)}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ─── Утилиты форматирования ──────────────────────────────────────────────────
export const fmtRUB = (v) => `${num(v).toLocaleString('ru-RU')} ₽`
export const fmtInt = (v) => num(v).toLocaleString('ru-RU')
export const fmtPct = (v) => `${Number(v || 0).toFixed(1)}%`
export const fmtDate = (s) => {
  if (!s) return ''
  try {
    const d = new Date(s)
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
  } catch { return String(s) }
}
