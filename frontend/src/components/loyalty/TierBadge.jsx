/**
 * ========================================
 * БЛОК: TierBadge — переиспользуемый бейдж тира программы лояльности
 * ========================================
 * Используется в PatientLoyaltySection (большая карточка тира) и в
 * AdminLoyaltySection (лидерборд, форма ручной корректировки),
 * а также в каталоге наград (min_tier для каждой карточки).
 *
 * Props:
 *   tier — строка: 'bronze' | 'silver' | 'gold' | 'platinum' (любой регистр)
 *   size — 'sm' | 'md' | 'lg' (по умолчанию 'md')
 *
 * Цветовая палитра по тиру (медальный градиент + иконка):
 *   bronze   — #a0522d → #cd7f32
 *   silver   — #a8a8a8 → #d4d4d4
 *   gold     — #ffa500 → #ffd700
 *   platinum — #b0c4de → #e5e4e2
 *
 * Иконка медали (workspace_premium) с FILL для серебра/золота/платины,
 * для бронзы оставляем outlined чтобы было видно «уровень входа».
 * ========================================
 */
export const TIER_PALETTE = {
  bronze: {
    from: '#a0522d',
    to: '#cd7f32',
    text: '#fff',
    label: 'Bronze',
    ru: 'Бронза',
    icon: 'workspace_premium',
    fill: 1,
  },
  silver: {
    from: '#a8a8a8',
    to: '#d4d4d4',
    text: '#1f2937',
    label: 'Silver',
    ru: 'Серебро',
    icon: 'workspace_premium',
    fill: 1,
  },
  gold: {
    from: '#ffa500',
    to: '#ffd700',
    text: '#5a3a00',
    label: 'Gold',
    ru: 'Золото',
    icon: 'workspace_premium',
    fill: 1,
  },
  platinum: {
    from: '#b0c4de',
    to: '#e5e4e2',
    text: '#1f2937',
    label: 'Platinum',
    ru: 'Платина',
    icon: 'diamond',
    fill: 1,
  },
}

// Если бэкенд вернул неизвестный тир — даём нейтральный «default»
const DEFAULT_PALETTE = {
  from: '#94a3b8',
  to: '#cbd5e1',
  text: '#0f172a',
  label: 'Tier',
  ru: 'Тир',
  icon: 'workspace_premium',
  fill: 0,
}

export function paletteFor(tier) {
  if (!tier) return DEFAULT_PALETTE
  return TIER_PALETTE[String(tier).toLowerCase()] || DEFAULT_PALETTE
}

const SIZES = {
  sm: { padX: 8, padY: 3, font: 11, icon: 14, gap: 4, radius: 999 },
  md: { padX: 12, padY: 5, font: 13, icon: 18, gap: 6, radius: 999 },
  lg: { padX: 16, padY: 8, font: 16, icon: 22, gap: 8, radius: 14 },
}

export default function TierBadge({ tier, size = 'md', showIcon = true, className = '' }) {
  const p = paletteFor(tier)
  const s = SIZES[size] || SIZES.md
  return (
    <span
      className={`inline-flex items-center font-bold ${className}`}
      style={{
        background: `linear-gradient(135deg, ${p.from} 0%, ${p.to} 100%)`,
        color: p.text,
        padding: `${s.padY}px ${s.padX}px`,
        borderRadius: s.radius,
        gap: s.gap,
        fontSize: s.font,
        lineHeight: 1,
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        letterSpacing: '0.01em',
      }}
    >
      {showIcon && (
        <span
          className="material-symbols-outlined"
          style={{ fontSize: s.icon, fontVariationSettings: `'FILL' ${p.fill}` }}
        >
          {p.icon}
        </span>
      )}
      <span>{p.label}</span>
    </span>
  )
}
