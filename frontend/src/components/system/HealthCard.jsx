/**
 * ========================================
 * БЛОК: HealthCard — карточка health-метрики (Глава 10)
 * ========================================
 * Универсальная KPI-карточка для AdminSystemStatusSection.
 *
 * Цветовая логика — рассчитывается из props (tone) либо вычисляется
 * автоматически из usagePct/ok:
 *   - ok    → зелёная рамка/иконка
 *   - warn  → жёлтая
 *   - bad   → красная
 *
 * Props:
 *   - icon: material-symbol
 *   - title: заголовок
 *   - value: основное значение (число/строка/null=«—»)
 *   - unit: единица (ms, %, GB, шт)
 *   - tone: 'ok' | 'warn' | 'bad' | 'neutral'
 *   - hint: подстрока пояснения
 *   - usagePct: число 0..100 — если задано, рисуется progress-bar
 *   - okStatus: bool — если задано, показывается ✓ или ✗
 * ========================================
 */
import { useMemo } from 'react'

const PALETTE = {
  ok:      { color: '#15803d', bg: '#dcfce7', accent: '#22c55e' },
  warn:    { color: '#a16207', bg: '#fef3c7', accent: '#eab308' },
  bad:     { color: '#991b1b', bg: '#fee2e2', accent: '#ef4444' },
  neutral: { color: '#475569', bg: '#f1f5f9', accent: '#64748b' },
}

export default function HealthCard({
  icon, title, value, unit, tone = 'neutral',
  hint, usagePct, okStatus,
}) {
  // Автоматический расчёт tone из usagePct (для диска и т.п.)
  const autoTone = useMemo(() => {
    if (typeof usagePct === 'number') {
      if (usagePct >= 90) return 'bad'
      if (usagePct >= 75) return 'warn'
      return 'ok'
    }
    if (typeof okStatus === 'boolean') return okStatus ? 'ok' : 'bad'
    return tone
  }, [usagePct, okStatus, tone])
  const p = PALETTE[autoTone] || PALETTE.neutral

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: 'var(--surface, #fff)',
        border: '1px solid var(--border, #e5e7eb)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="inline-grid place-items-center flex-shrink-0"
          style={{
            width: 38, height: 38, borderRadius: 10,
            background: p.bg, color: p.color,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}
          >{icon}</span>
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="text-[10.5px] font-bold uppercase tracking-wide truncate"
            style={{ color: 'var(--fg-4, #94a3b8)', letterSpacing: '0.08em' }}
          >{title}</div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            {typeof okStatus === 'boolean' && (
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 22, color: p.color, fontVariationSettings: "'FILL' 1" }}
              >{okStatus ? 'check_circle' : 'cancel'}</span>
            )}
            <span
              className="font-bold truncate"
              style={{
                fontSize: 22,
                color: 'var(--fg, #0f172a)',
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.02em',
              }}
            >{value ?? '—'}</span>
            {unit && (
              <span style={{ fontSize: 13, color: 'var(--fg-3, #64748b)', fontWeight: 600 }}>{unit}</span>
            )}
          </div>
          {hint && (
            <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--fg-3, #64748b)' }}>{hint}</div>
          )}
        </div>
      </div>

      {/* Progress bar для usage% */}
      {typeof usagePct === 'number' && (
        <div className="mt-3">
          <div
            className="rounded-full overflow-hidden"
            style={{ height: 6, background: 'var(--bg-2, #f1f5f9)' }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, Math.max(0, usagePct))}%`,
                background: p.accent,
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
