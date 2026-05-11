/**
 * ========================================
 * КОМПОНЕНТ: PlanSelector — выбор тарифа подписки (3 премиум-карточки)
 * ========================================
 * Используется в ManagerSubscriptionCashSection (Step 2 wizard'а).
 *
 * Props:
 *   plans        — массив тарифов {key, name/title, price_monthly, benefits[]}
 *                  (если undefined — используется FALLBACK_PLANS)
 *   onSelect(planKey) — колбек при выборе
 *
 * Дизайн:
 *   • 3 карточки в grid (mobile: stack)
 *   • Health+ — золотисто-фиолетовый градиент (рекомендованный)
 *   • Family+ — голубо-индиго
 *   • Pro     — изумрудный
 *   • Hover: scale + shadow
 * ========================================
 */

// ─── Fallback на случай если backend ещё не отдал /plans ───
const FALLBACK_PLANS = [
  {
    key: 'health_plus',
    name: 'Здоровье+',
    title: 'Здоровье+',
    description: 'Забота о здоровье круглый год',
    price_monthly: 290,
    benefits: [
      'Безлимитный чат с клиникой',
      'Скидка 10% на приёмы',
      'Расходник каждый месяц',
      'Приоритет записи',
      'Напоминания о приёме лекарств',
    ],
  },
  {
    key: 'family_plus',
    name: 'Семья+',
    title: 'Семья+',
    description: 'Для всей семьи под одним аккаунтом',
    price_monthly: 590,
    benefits: [
      'Всё из тарифа «Здоровье+»',
      'До 5 членов семьи',
      'Семейный календарь приёмов',
      'Скидка 15% на семейные приёмы',
      'Персональный менеджер',
    ],
  },
  {
    key: 'pro',
    name: 'Pro',
    title: 'Pro',
    description: 'Максимум привилегий и сервис VIP',
    price_monthly: 990,
    benefits: [
      'Всё из тарифа «Семья+»',
      'Бесплатные стандартные приёмы',
      'Доступ к экспертам сети',
      'Скидка 25% на сложные процедуры',
      'Бесплатные анализы по плану',
      'Премиум-страховка от случайностей',
    ],
  },
]

// ─── Палитры (синхронизировано с PlanCard) ───
const PALETTES = {
  health_plus: { from: '#F59E0B', to: '#7C3AED', accent: '#A855F7', icon: 'workspace_premium' },
  family_plus: { from: '#0EA5E9', to: '#6366F1', accent: '#4F46E5', icon: 'diversity_3' },
  pro:         { from: '#10B981', to: '#0EA5E9', accent: '#0EA5E9', icon: 'diamond' },
}
const RECOMMENDED = 'health_plus'

export default function PlanSelector({ plans, onSelect }) {
  // Берём только 3 нужных тарифа из API, остальное — fallback
  const source = Array.isArray(plans) && plans.length
    ? FALLBACK_PLANS.map(fb => plans.find(p => p.key === fb.key) || fb)
    : FALLBACK_PLANS

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {source.map(plan => {
        const palette = PALETTES[plan.key] || PALETTES.health_plus
        const featured = plan.key === RECOMMENDED
        const benefits = (plan.benefits || []).slice(0, 6)
        const title = plan.title || plan.name || plan.key

        return (
          <button
            key={plan.key}
            onClick={() => onSelect?.(plan.key)}
            className="relative text-left flex flex-col rounded-3xl p-6 transition-all hover:scale-[1.02]"
            style={{
              background: featured
                ? 'linear-gradient(145deg, rgba(124,58,237,.05), rgba(245,158,11,.05))'
                : 'var(--surface)',
              border: featured ? '2px solid transparent' : '1.5px solid var(--border)',
              backgroundImage: featured
                ? `linear-gradient(var(--surface),var(--surface)), linear-gradient(135deg, ${palette.from}, ${palette.to})`
                : undefined,
              backgroundOrigin: featured ? 'border-box' : undefined,
              backgroundClip: featured ? 'padding-box, border-box' : undefined,
              boxShadow: featured
                ? '0 14px 44px rgba(124,58,237,.18)'
                : '0 4px 16px rgba(0,0,0,.05)',
              minHeight: 440,
              cursor: 'pointer',
            }}
          >
            {featured && (
              <div
                className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full"
                style={{
                  fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6,
                  background: `linear-gradient(135deg, ${palette.from}, ${palette.to})`,
                  color: '#fff',
                  boxShadow: '0 4px 12px rgba(124,58,237,.4)',
                }}
              >
                ПОПУЛЯРНЫЙ
              </div>
            )}

            {/* Header */}
            <div className="mb-4">
              <div
                className="inline-flex items-center justify-center mb-3"
                style={{
                  width: 52, height: 52, borderRadius: 16,
                  background: `linear-gradient(135deg, ${palette.from}26, ${palette.to}26)`,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 28, color: palette.accent, fontVariationSettings: "'FILL' 1" }}
                >
                  {palette.icon}
                </span>
              </div>
              <div className="text-xl font-bold mb-1" style={{ color: 'var(--fg)' }}>
                {title}
              </div>
              {plan.description && (
                <div className="text-sm" style={{ color: 'var(--fg-3)' }}>
                  {plan.description}
                </div>
              )}
            </div>

            {/* Price */}
            <div className="mb-5">
              <div className="flex items-baseline gap-1">
                <span
                  className="font-extrabold"
                  style={{
                    fontSize: 36, lineHeight: 1, letterSpacing: '-0.02em',
                    background: `linear-gradient(135deg, ${palette.from}, ${palette.to})`,
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  {Number(plan.price_monthly || 0).toLocaleString('ru-RU')} ₽
                </span>
                <span style={{ fontSize: 14, color: 'var(--fg-3)', fontWeight: 600 }}>/ мес</span>
              </div>
            </div>

            {/* Benefits */}
            <ul className="flex-1 space-y-2 mb-5">
              {benefits.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className="material-symbols-outlined flex-shrink-0 mt-0.5"
                    style={{ fontSize: 18, color: palette.accent, fontVariationSettings: "'FILL' 1" }}
                  >
                    check_circle
                  </span>
                  <span style={{ fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.45 }}>{b}</span>
                </li>
              ))}
            </ul>

            {/* CTA */}
            <div
              className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl transition-all"
              style={{
                background: `linear-gradient(135deg, ${palette.from}, ${palette.to})`,
                color: '#fff', fontWeight: 700, fontSize: 14.5, letterSpacing: 0.3,
                boxShadow: '0 6px 20px rgba(124,58,237,.25)',
              }}
            >
              Выбрать
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
