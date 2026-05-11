/**
 * ========================================
 * БЛОК: PartnerCard — премиум-карточка wellness-партнёра (Глава 10)
 * ========================================
 * Используется в PatientWellnessSection (сетка карточек).
 *
 * props.partner: {
 *   id, name, category, description, logo_url, discount_text,
 *   min_subscription_plan, promo_code, link_url
 * }
 * props.locked: пациент не имеет нужной подписки → показываем замок.
 * props.onOpen(partner): клик «Подробнее» → POST /click + открыть link_url.
 *
 * Цветовая гамма по категориям — пастельные градиенты.
 * ========================================
 */

// Пастельные градиенты по категории (premium feel).
const CATEGORY_THEME = {
  fitness:    { from: '#fde68a', to: '#fca5a5', icon: '#b45309', label: 'Фитнес'    , mi: 'fitness_center' },
  spa:        { from: '#bae6fd', to: '#c7d2fe', icon: '#3730a3', label: 'Спа'       , mi: 'spa'            },
  nutrition:  { from: '#bbf7d0', to: '#a7f3d0', icon: '#166534', label: 'Питание'   , mi: 'restaurant'     },
  psychology: { from: '#e9d5ff', to: '#fbcfe8', icon: '#6b21a8', label: 'Психология', mi: 'psychology'     },
  yoga:       { from: '#fed7aa', to: '#fde68a', icon: '#92400e', label: 'Йога'      , mi: 'self_improvement' },
  other:      { from: '#f1f5f9', to: '#e2e8f0', icon: '#475569', label: 'Прочее'    , mi: 'storefront'     },
}

function themeFor(cat) {
  return CATEGORY_THEME[String(cat || '').toLowerCase()] || CATEGORY_THEME.other
}

export function categoryLabel(cat) {
  return themeFor(cat).label
}

export default function PartnerCard({ partner, locked = false, onOpen }) {
  const t = themeFor(partner.category)
  const hasLogo = !!partner.logo_url

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col transition-all"
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 14px rgba(15,23,42,0.04)',
        position: 'relative',
      }}
    >
      {/* ── Header c пастельным градиентом ── */}
      <div
        className="relative flex items-center justify-center"
        style={{
          height: 96,
          background: `linear-gradient(135deg, ${t.from}, ${t.to})`,
        }}
      >
        {hasLogo ? (
          <img
            src={partner.logo_url}
            alt={partner.name}
            style={{
              maxHeight: 64, maxWidth: '70%', objectFit: 'contain',
              filter: 'drop-shadow(0 2px 6px rgba(15,23,42,0.15))',
            }}
            onError={(e) => { e.target.style.display = 'none' }}
          />
        ) : (
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 48, color: t.icon, fontVariationSettings: "'FILL' 1" }}
          >
            {t.mi}
          </span>
        )}

        {/* Категория-бейдж */}
        <span
          className="absolute"
          style={{
            top: 10, left: 10,
            padding: '3px 9px', borderRadius: 999,
            background: 'rgba(255,255,255,0.85)',
            backdropFilter: 'blur(6px)',
            fontSize: 10.5, fontWeight: 700, color: t.icon,
            letterSpacing: '0.03em',
          }}
        >
          {t.label}
        </span>

        {/* Lock overlay */}
        {locked && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)' }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 40, color: '#fff', fontVariationSettings: "'FILL' 1" }}
            >
              lock
            </span>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="p-4 flex-1 flex flex-col">
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>
          {partner.name}
        </div>
        {partner.description && (
          <p
            style={{
              fontSize: 12.5, color: '#475569', marginTop: 6, lineHeight: 1.45,
              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {partner.description}
          </p>
        )}

        {/* Плашка скидки */}
        {partner.discount_text && (
          <div
            className="rounded-xl mt-3 flex items-center gap-2"
            style={{
              padding: '8px 12px',
              background: locked ? '#f1f5f9' : `linear-gradient(135deg, ${t.from}, ${t.to})`,
              border: '1px solid rgba(255,255,255,0.7)',
              color: locked ? '#64748b' : '#0f172a',
              fontSize: 13, fontWeight: 700,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>local_offer</span>
            <span>{partner.discount_text}</span>
          </div>
        )}

        {/* Кнопка */}
        <button
          onClick={() => !locked && onOpen && onOpen(partner)}
          disabled={locked}
          className="rounded-xl mt-3 w-full transition-all active:scale-95"
          style={{
            padding: '10px 14px',
            background: locked
              ? '#f1f5f9'
              : 'linear-gradient(135deg, #0ea5e9, #0369a1)',
            color: locked ? '#94a3b8' : '#fff',
            border: 'none',
            fontWeight: 700, fontSize: 13,
            cursor: locked ? 'not-allowed' : 'pointer',
          }}
        >
          {locked ? `Доступно с ${planLabel(partner.min_subscription_plan)}` : 'Подробнее'}
        </button>
      </div>
    </div>
  )
}

function planLabel(key) {
  const map = {
    health_plus:  'тарифом Health+',
    health:       'тарифом Health',
    premium:      'премиум-тарифом',
    pro:          'тарифом Pro',
  }
  return map[String(key || '').toLowerCase()] || 'премиум-подпиской'
}
