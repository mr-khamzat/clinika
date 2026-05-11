/**
 * ========================================
 * БЛОК: PlanCard — карточка тарифа подписки (Глава 9)
 * ========================================
 * Карточка одного тарифа с ценой, фичами и CTA.
 * Используется в PatientSubscriptionSection.
 *
 * Props:
 *   plan      — {key, name, price_monthly, benefits[], badge?, color?}
 *   billing   — 'monthly' | 'annual'
 *   featured  — boolean (золотая обводка для рекомендованного)
 *   onSelect  — () => void
 *   loading   — boolean
 *   current   — boolean (этот тариф уже активен)
 * ========================================
 */
import { Button } from '../../design'

const PALETTES = {
  free:        { from: '#94A3B8', to: '#64748B', accent: '#475569' },
  health_plus: { from: '#F59E0B', to: '#7C3AED', accent: '#A855F7' },
  family_plus: { from: '#0EA5E9', to: '#6366F1', accent: '#4F46E5' },
}

export default function PlanCard({ plan, billing = 'monthly', featured = false, onSelect, loading = false, current = false }) {
  const palette = PALETTES[plan.key] || PALETTES.health_plus
  const isAnnual = billing === 'annual'
  // Annual: 10× monthly (по ТЗ — экономия 2 месяца)
  const price = isAnnual ? plan.price_monthly * 10 : plan.price_monthly
  const priceLabel = isAnnual ? '/ год' : '/ мес'
  const isFree = Number(plan.price_monthly || 0) === 0

  return (
    <div
      className="relative rounded-3xl p-6 flex flex-col transition-all"
      style={{
        background: featured
          ? 'linear-gradient(145deg, rgba(124,58,237,.04), rgba(245,158,11,.04))'
          : '#FFFFFF',
        border: featured
          ? '2px solid transparent'
          : '1px solid rgba(0,0,0,.06)',
        backgroundImage: featured
          ? `linear-gradient(#FFFFFF,#FFFFFF), linear-gradient(135deg, ${palette.from}, ${palette.to})`
          : undefined,
        backgroundOrigin: featured ? 'border-box' : undefined,
        backgroundClip: featured ? 'padding-box, border-box' : undefined,
        boxShadow: featured ? '0 12px 40px rgba(124,58,237,.18)' : '0 4px 18px rgba(0,0,0,.04)',
        minHeight: 440,
      }}
    >
      {featured && (
        <div
          className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-bold text-white tracking-wide"
          style={{ background: `linear-gradient(135deg, ${palette.from}, ${palette.to})`, boxShadow: '0 4px 12px rgba(124,58,237,.4)' }}
        >
          ПОПУЛЯРНЫЙ
        </div>
      )}

      {current && (
        <div
          className="absolute top-4 right-4 px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
          style={{ background: '#10B981' }}
        >
          АКТИВЕН
        </div>
      )}

      {/* Header */}
      <div className="mb-4">
        <div
          className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3"
          style={{ background: `linear-gradient(135deg, ${palette.from}22, ${palette.to}22)` }}
        >
          <span
            className="material-symbols-outlined text-2xl"
            style={{ color: palette.accent, fontVariationSettings: "'FILL' 1" }}
          >
            {plan.key === 'free' ? 'volunteer_activism'
              : plan.key === 'family_plus' ? 'diversity_3'
              : 'workspace_premium'}
          </span>
        </div>
        <h3 className="text-xl font-extrabold" style={{ color: '#0F172A' }}>{plan.name}</h3>
        {plan.description && (
          <p className="text-xs mt-1" style={{ color: '#64748B' }}>{plan.description}</p>
        )}
      </div>

      {/* Price */}
      <div className="mb-5">
        {isFree ? (
          <div className="flex items-baseline gap-1.5">
            <span className="text-4xl font-black" style={{ color: '#0F172A' }}>0 ₽</span>
            <span className="text-sm font-medium" style={{ color: '#64748B' }}>навсегда</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-1.5">
            <span className="text-4xl font-black" style={{ color: '#0F172A' }}>{price.toLocaleString('ru-RU')} ₽</span>
            <span className="text-sm font-medium" style={{ color: '#64748B' }}>{priceLabel}</span>
          </div>
        )}
        {isAnnual && !isFree && (
          <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: '#DCFCE7', color: '#15803D' }}>
            <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>savings</span>
            экономия 2 мес
          </div>
        )}
      </div>

      {/* Benefits */}
      <ul className="flex-1 flex flex-col gap-2.5 mb-6">
        {(plan.benefits || []).map((b, i) => (
          <li key={i} className="flex items-start gap-2 text-sm" style={{ color: '#334155' }}>
            <span
              className="material-symbols-outlined text-base flex-shrink-0 mt-0.5"
              style={{ color: palette.accent, fontVariationSettings: "'FILL' 1" }}
            >
              check_circle
            </span>
            <span className="leading-snug">{b}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      {current ? (
        <button
          disabled
          className="w-full py-3 rounded-2xl font-bold text-sm cursor-not-allowed"
          style={{ background: '#F1F5F9', color: '#64748B' }}
        >
          Активный тариф
        </button>
      ) : isFree ? (
        <button
          disabled
          className="w-full py-3 rounded-2xl font-bold text-sm cursor-not-allowed"
          style={{ background: '#F1F5F9', color: '#64748B' }}
        >
          По умолчанию
        </button>
      ) : (
        <button
          onClick={onSelect}
          disabled={loading}
          className="w-full py-3 rounded-2xl font-bold text-sm text-white transition-all active:scale-95 disabled:opacity-60"
          style={{
            background: `linear-gradient(135deg, ${palette.from}, ${palette.to})`,
            boxShadow: `0 6px 18px ${palette.to}40`,
          }}
        >
          {loading ? 'Подключение…' : 'Подключить'}
        </button>
      )}
    </div>
  )
}
