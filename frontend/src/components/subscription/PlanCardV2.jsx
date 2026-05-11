/**
 * ========================================
 * БЛОК: PlanCardV2 — премиум-карточка тарифа подписки (Глава 9, v2)
 * ========================================
 * Используется в PatientSubscriptionSection.
 * Отличия от PlanCard:
 *   • Премиум-хедер с тиро-специфичным градиентом и крупным символом
 *   • Превью-чипы конкретных категорий привилегий с кликабельным «Подробнее →»
 *   • Большая цена (₽ X / мес) + альтернативный годовой вид
 *   • Анимация edge-glow на hover (CSS-fallback)
 *   • Бейдж «Популярный» и «Рекомендуем»
 *
 * Props:
 *   plan            — {key, name, title?, price_monthly, summary_benefits?:[],
 *                       benefits?:[], features?:{}, ...}
 *   billing         — 'monthly' | 'annual'
 *   featured        — boolean — рекомендованный тариф
 *   loading         — boolean — состояние «Подключение…»
 *   current         — boolean — этот план уже активен
 *   onSelect        — () => void — клик по CTA «Подключить»
 *   onBenefitDetail — (categoryKey: string) => void — клик «Подробнее →» в чипе
 *   onInquireCash   — () => void — клик «Активировать в клинике (наличные)» (если module_active=false)
 *   moduleActive    — boolean — если false, online-оплата недоступна
 * ========================================
 */

const PALETTES = {
  free:        { from: '#94A3B8', to: '#64748B', accent: '#475569', soft: '#F1F5F9' },
  health_plus: { from: '#F59E0B', to: '#7C3AED', accent: '#A855F7', soft: '#FAF5FF' },
  family_plus: { from: '#0EA5E9', to: '#6366F1', accent: '#4F46E5', soft: '#EEF2FF' },
  pro:         { from: '#9333EA', to: '#4338CA', accent: '#7C3AED', soft: '#F5F3FF' },
}

const ICON_FOR_PLAN = {
  free:        'volunteer_activism',
  health_plus: 'workspace_premium',
  family_plus: 'diversity_3',
  pro:         'auto_awesome',
}

/**
 * Маппинг ключа категории привилегии → иконка + категория для запроса деталей.
 * benefit-объект: {icon?, label, value?, detail_key?}
 * Если detail_key задан — рендерим «Подробнее →».
 */
function BenefitChip({ benefit, accent, onDetail }) {
  const hasDetail = !!benefit.detail_key
  return (
    <li
      className="flex items-start gap-2.5 text-[13.5px] leading-snug"
      style={{ color: '#1E293B' }}
    >
      <span
        className="material-symbols-outlined text-base flex-shrink-0 mt-[2px]"
        style={{ color: accent, fontVariationSettings: "'FILL' 1" }}
      >
        {benefit.icon || 'check_circle'}
      </span>
      <span className="flex-1 min-w-0">
        <span className="font-semibold">{benefit.label}</span>
        {benefit.value && (
          <span className="font-medium" style={{ color: '#475569' }}>: {benefit.value}</span>
        )}
        {hasDetail && (
          <>
            {' '}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDetail?.(benefit.detail_key) }}
              className="inline-flex items-center gap-0.5 text-[12px] font-bold underline-offset-2 hover:underline transition-colors"
              style={{ color: accent }}
            >
              Подробнее
              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </button>
          </>
        )}
      </span>
    </li>
  )
}

export default function PlanCardV2({
  plan,
  billing = 'monthly',
  featured = false,
  loading = false,
  current = false,
  onSelect,
  onBenefitDetail,
  onInquireCash,
  moduleActive = true,
}) {
  const planKey = plan.key || plan.plan_key
  const palette = PALETTES[planKey] || PALETTES.health_plus
  const isAnnual = billing === 'annual'
  const monthly = Number(plan.price_monthly || 0)
  // Годовая цена: 10× месячная = экономия 2 мес = 17%
  const annual = monthly * 10
  const price = isAnnual ? annual : monthly
  const priceLabel = isAnnual ? '/ год' : '/ мес'
  const isFree = monthly === 0
  const title = plan.title || plan.name

  /**
   * Извлекаем чипы привилегий:
   *  • если backend вернул summary_benefits — берём их (богатая структура)
   *  • иначе плоский массив plan.benefits — рендерим как text-only чипы
   */
  const summary = Array.isArray(plan.summary_benefits) && plan.summary_benefits.length
    ? plan.summary_benefits
    : (Array.isArray(plan.benefits) ? plan.benefits.map(label =>
        typeof label === 'string' ? { label } : label
      ) : [])

  // Скидка для annual badge
  const annualSaving = isAnnual && !isFree ? Math.round((monthly * 12 - annual) / (monthly * 12) * 100) : 0

  return (
    <div
      className="relative rounded-3xl p-5 sm:p-6 flex flex-col transition-all duration-300 group"
      style={{
        background: featured
          ? `linear-gradient(180deg, ${palette.soft} 0%, #FFFFFF 35%)`
          : '#FFFFFF',
        border: featured
          ? '2px solid transparent'
          : '1px solid rgba(15,23,42,.06)',
        backgroundImage: featured
          ? `linear-gradient(180deg, ${palette.soft} 0%, #FFFFFF 35%), linear-gradient(135deg, ${palette.from}, ${palette.to})`
          : undefined,
        backgroundOrigin: featured ? 'border-box' : undefined,
        backgroundClip: featured ? 'padding-box, border-box' : undefined,
        boxShadow: featured
          ? `0 18px 48px ${palette.to}26, 0 4px 12px rgba(15,23,42,.04)`
          : '0 6px 22px rgba(15,23,42,.05)',
        minHeight: 460,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-3px)'
        e.currentTarget.style.boxShadow = featured
          ? `0 22px 60px ${palette.to}40, 0 6px 18px rgba(15,23,42,.06)`
          : `0 14px 36px ${palette.to}24, 0 4px 12px rgba(15,23,42,.05)`
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = featured
          ? `0 18px 48px ${palette.to}26, 0 4px 12px rgba(15,23,42,.04)`
          : '0 6px 22px rgba(15,23,42,.05)'
      }}
    >
      {/* Бейджи */}
      {featured && (
        <div
          className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-extrabold text-white tracking-wide flex items-center gap-1"
          style={{
            background: `linear-gradient(135deg, ${palette.from}, ${palette.to})`,
            boxShadow: `0 6px 16px ${palette.to}55`,
          }}
        >
          <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
          ПОПУЛЯРНЫЙ
        </div>
      )}

      {current && (
        <div
          className="absolute top-4 right-4 px-2 py-0.5 rounded-full text-[10px] font-bold text-white flex items-center gap-1"
          style={{ background: '#10B981' }}
        >
          <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
          АКТИВЕН
        </div>
      )}

      {/* Хедер с иконкой и градиентом-тиром */}
      <div className="mb-4">
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3 relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${palette.from}, ${palette.to})`,
            boxShadow: `0 8px 20px ${palette.to}40`,
          }}
        >
          <span
            className="material-symbols-outlined text-[28px] text-white relative z-10"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            {ICON_FOR_PLAN[planKey] || 'workspace_premium'}
          </span>
          {/* shine */}
          <span
            aria-hidden
            className="absolute inset-0 opacity-30"
            style={{
              background: 'radial-gradient(120% 80% at 30% 20%, rgba(255,255,255,.55), rgba(255,255,255,0) 60%)',
            }}
          />
        </div>
        <h3 className="text-xl font-extrabold leading-tight" style={{ color: '#0F172A' }}>{title}</h3>
        {plan.description && (
          <p className="text-[12.5px] mt-1 leading-snug" style={{ color: '#64748B' }}>{plan.description}</p>
        )}
      </div>

      {/* Цена */}
      <div className="mb-5">
        {isFree ? (
          <div className="flex items-baseline gap-1.5">
            <span className="text-4xl font-black" style={{ color: '#0F172A' }}>0 ₽</span>
            <span className="text-sm font-medium" style={{ color: '#64748B' }}>навсегда</span>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[40px] leading-none font-black" style={{ color: '#0F172A' }}>
                {price.toLocaleString('ru-RU')} ₽
              </span>
              <span className="text-[13px] font-semibold" style={{ color: '#64748B' }}>{priceLabel}</span>
            </div>
            {isAnnual && (
              <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold"
                   style={{ background: '#DCFCE7', color: '#15803D' }}>
                <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>savings</span>
                экономия {annualSaving || 17}% · 2 мес в подарок
              </div>
            )}
            {!isAnnual && plan.trial_days > 0 && (
              <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold"
                   style={{ background: '#FEF3C7', color: '#92400E' }}>
                <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>card_giftcard</span>
                {plan.trial_days} дней бесплатно
              </div>
            )}
          </>
        )}
      </div>

      {/* Привилегии (превью-чипы) */}
      <ul className="flex-1 flex flex-col gap-2.5 mb-6">
        {summary.length === 0 ? (
          <li className="text-[12.5px]" style={{ color: '#94A3B8' }}>Привилегии не настроены</li>
        ) : summary.slice(0, 6).map((b, i) => (
          <BenefitChip key={i} benefit={b} accent={palette.accent} onDetail={onBenefitDetail} />
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
      ) : moduleActive ? (
        <button
          onClick={onSelect}
          disabled={loading}
          className="w-full py-3.5 rounded-2xl font-extrabold text-[14px] text-white transition-all active:scale-[0.97] disabled:opacity-60 relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${palette.from}, ${palette.to})`,
            boxShadow: `0 10px 28px ${palette.to}50`,
          }}
        >
          {loading ? 'Подключение…' : `Подключить за ${price.toLocaleString('ru-RU')} ₽`}
        </button>
      ) : (
        <button
          onClick={onInquireCash}
          className="w-full py-3.5 rounded-2xl font-extrabold text-[13.5px] transition-all active:scale-[0.97]"
          style={{
            background: '#FEF3C7',
            color: '#92400E',
            border: '1.5px solid #FCD34D',
          }}
        >
          <span className="material-symbols-outlined text-base align-middle mr-1" style={{ fontVariationSettings: "'FILL' 1" }}>payments</span>
          Активировать в клинике (наличные)
        </button>
      )}
    </div>
  )
}
