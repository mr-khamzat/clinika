/**
 * PlanComparisonCard — премиум-карточка тарифа подписки для franchise_owner.
 *
 * Показывает итоговый план (после применения override) с возможностью
 * редактировать или сбросить override.
 *
 * Props:
 *   plan: object              — итоговый план (с has_override, features, benefits, price)
 *   onEdit: () => void
 *   onReset: () => void       — null если can't reset
 *   onActivate: () => void    — для add tile (опц.)
 *   highlight: bool
 */
import { memo } from 'react'

const PLAN_THEME = {
  health_plus:  { bg: 'linear-gradient(135deg, #14b8a6 0%, #0891b2 100%)', icon: 'favorite' },
  family_plus:  { bg: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)', icon: 'family_restroom' },
  pro:          { bg: 'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)', icon: 'workspace_premium' },
}

function fmt(price) {
  if (price === null || price === undefined) return '—'
  try {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(price)
  } catch { return String(price) }
}

function PlanComparisonCard({ plan, onEdit, onReset, highlight }) {
  if (!plan) return null
  const theme = PLAN_THEME[plan.plan_key] || PLAN_THEME.health_plus
  const features = plan.features || {}
  const benefits = plan.benefits || []
  const overridden = !!plan.has_override

  return (
    <div style={{
      background: 'var(--bg)',
      border: highlight ? '2px solid #f59e0b' : '1px solid var(--line)',
      borderRadius: 16,
      overflow: 'hidden',
      boxShadow: '0 4px 16px rgba(0,0,0,.06)',
      display: 'flex', flexDirection: 'column',
      position: 'relative',
    }}>
      {/* Header */}
      <div style={{
        padding: 20, color: '#fff', background: theme.bg,
        position: 'relative',
      }}>
        {overridden && (
          <div style={{
            position: 'absolute', top: 12, right: 12,
            background: 'rgba(255,255,255,.25)', backdropFilter: 'blur(6px)',
            color: '#fff', fontSize: 11, fontWeight: 700,
            padding: '4px 8px', borderRadius: 999,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#facc15', boxShadow: '0 0 0 2px rgba(255,255,255,.4)',
            }} />
            Изменён
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 36, fontVariationSettings: "'FILL' 1" }}>
            {theme.icon}
          </span>
          <div>
            <div style={{ fontSize: 11, opacity: 0.85, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {plan.plan_key}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>
              {plan.title}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: 32, fontWeight: 900, fontFeatureSettings: '"tnum"' }}>
            ₽{fmt(plan.price_monthly)}
          </span>
          <span style={{ fontSize: 13, opacity: 0.85 }}>/мес</span>
          {plan.price_annual && (
            <span style={{ fontSize: 12, opacity: 0.8, marginLeft: 12 }}>
              · ₽{fmt(plan.price_annual)}/год
            </span>
          )}
        </div>
        {plan.trial_days > 0 && (
          <div style={{
            display: 'inline-block', marginTop: 6,
            padding: '3px 10px', background: 'rgba(255,255,255,.2)',
            borderRadius: 999, fontSize: 11, fontWeight: 700,
          }}>
            {plan.trial_days} дн. бесплатно
          </div>
        )}
      </div>

      {/* Description */}
      {plan.description && (
        <div style={{ padding: '12px 20px 0', fontSize: 13, color: 'var(--fg-2)' }}>
          {plan.description}
        </div>
      )}

      {/* Bullets */}
      <div style={{ padding: 20, flex: 1 }}>
        {benefits.slice(0, 5).map((b, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#10b981', flexShrink: 0 }}>
              check_circle
            </span>
            <span style={{ fontSize: 13, color: 'var(--fg)' }}>{b}</span>
          </div>
        ))}

        {/* Скидка + члены семьи */}
        <div style={{
          marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--line)',
          display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--fg-2)',
        }}>
          {features.discount_percent > 0 && (
            <span>Скидка <b>{features.discount_percent}%</b></span>
          )}
          {features.family_members_allowed > 1 && (
            <span>До <b>{features.family_members_allowed}</b> чел.</span>
          )}
          {features.telemedicine_unlimited && (
            <span>Безлим. телемед</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{
        padding: 12, borderTop: '1px solid var(--line)',
        display: 'flex', gap: 8,
      }}>
        <button
          type="button" onClick={onEdit}
          style={{
            flex: 1, padding: '10px 12px', border: 0, borderRadius: 8,
            background: theme.bg, color: '#fff', fontWeight: 700, fontSize: 13,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
          Редактировать
        </button>
        {overridden && onReset && (
          <button
            type="button" onClick={onReset}
            title="Сбросить override и вернуться к настройкам платформы"
            style={{
              padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8,
              background: 'transparent', color: 'var(--fg)', fontWeight: 600, fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>restart_alt</span>
          </button>
        )}
      </div>
    </div>
  )
}

export default memo(PlanComparisonCard)
