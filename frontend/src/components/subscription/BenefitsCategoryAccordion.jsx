/**
 * ========================================
 * БЛОК: BenefitsCategoryAccordion — раскрывающийся блок деталей категории привилегий (Глава 9 v2)
 * ========================================
 * Используется в PatientSubscriptionSection и десктоп-сценарии под карточкой плана.
 *
 * Что показывает:
 *   • «Доступно: N из M анализов клиники со скидкой X%» — компактная сводка
 *   • Список 5 examples (чипы) — какие именно услуги/анализы доступны
 *   • Кнопка «Открыть полный список в чате →»
 *
 * Состояния:
 *   loading=true   → skeleton-плейсхолдер
 *   error          → красная плашка с retry
 *   data загружен  → контент
 *
 * Props:
 *   planKey       — string — slug плана для вызова /benefits-detail
 *   categoryKey   — string — какую категорию раскрыть (lab / consult / diagnostic / supply)
 *                   Если null — компонент свёрнут (но контейнер можно скрыть на родителе).
 *   data          — обогащённый объект из родителя (если уже загружен) — {summary, categories_breakdown, ...}
 *   loading       — boolean
 *   error         — string | null
 *   onInquireFull — (planKey, categoryKey) => void — клик «Открыть полный список в чате»
 *   onClose       — () => void — клик «свернуть»
 *   accent        — string — акцент-цвет (берём из палитры плана)
 * ========================================
 */

function findCategory(data, categoryKey) {
  if (!data?.categories_breakdown) return null
  return data.categories_breakdown.find(c =>
    c.key === categoryKey || c.slug === categoryKey || c.category_key === categoryKey
  ) || data.categories_breakdown[0] || null
}

export default function BenefitsCategoryAccordion({
  planKey,
  categoryKey,
  data,
  loading = false,
  error = null,
  onInquireFull,
  onClose,
  accent = '#7C3AED',
}) {
  const cat = findCategory(data, categoryKey)

  return (
    <div
      className="rounded-3xl p-5 overflow-hidden transition-all"
      style={{
        background: '#FFFFFF',
        border: `1.5px solid ${accent}22`,
        boxShadow: `0 8px 24px ${accent}1A`,
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${accent}14` }}
          >
            <span
              className="material-symbols-outlined text-[22px]"
              style={{ color: accent, fontVariationSettings: "'FILL' 1" }}
            >
              {cat?.icon || 'fact_check'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-extrabold leading-tight" style={{ color: '#0F172A' }}>
              {cat?.category || cat?.title || 'Подробности привилегии'}
            </p>
            {cat?.subtitle && (
              <p className="text-[12px] mt-0.5" style={{ color: '#64748B' }}>{cat.subtitle}</p>
            )}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors hover:bg-slate-100"
            aria-label="Свернуть"
          >
            <span className="material-symbols-outlined text-[20px]" style={{ color: '#94A3B8' }}>close</span>
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-5 rounded bg-slate-200/70 w-3/4" />
          <div className="h-4 rounded bg-slate-200/60 w-1/2" />
          <div className="h-10 rounded bg-slate-200/60 mt-3" />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-xl p-3 text-[12.5px]" style={{ background: '#FEE2E2', color: '#991B1B' }}>
          Не удалось загрузить детали: {error}
        </div>
      )}

      {/* Data */}
      {!loading && !error && cat && (
        <>
          {/* Stats Strip */}
          <div className="rounded-2xl px-4 py-3 mb-4 flex items-center gap-4 flex-wrap"
               style={{ background: `${accent}0C` }}>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Доступно</p>
              <p className="text-2xl font-black leading-tight" style={{ color: accent }}>
                {cat.available_count ?? '—'}
                {cat.total_in_clinic && (
                  <span className="text-[13px] font-bold ml-1" style={{ color: '#94A3B8' }}>
                    / {cat.total_in_clinic}
                  </span>
                )}
              </p>
            </div>
            {cat.discount != null && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Скидка</p>
                <p className="text-2xl font-black leading-tight" style={{ color: '#15803D' }}>
                  −{cat.discount}%
                </p>
              </div>
            )}
            {cat.frequency && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Периодичность</p>
                <p className="text-[14px] font-bold leading-tight" style={{ color: '#0F172A' }}>{cat.frequency}</p>
              </div>
            )}
          </div>

          {/* Examples */}
          {Array.isArray(cat.examples) && cat.examples.length > 0 && (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#64748B' }}>
                Например
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                {cat.examples.slice(0, 8).map((ex, i) => (
                  <span
                    key={i}
                    className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold"
                    style={{ background: `${accent}10`, color: accent, border: `1px solid ${accent}25` }}
                  >
                    {ex}
                  </span>
                ))}
                {cat.total_in_clinic && cat.examples.length < cat.total_in_clinic && (
                  <span
                    className="px-3 py-1.5 rounded-full text-[12.5px] font-bold"
                    style={{ background: '#F1F5F9', color: '#475569' }}
                  >
                    +ещё {cat.total_in_clinic - cat.examples.length}
                  </span>
                )}
              </div>
            </>
          )}

          {/* CTA */}
          <button
            type="button"
            onClick={() => onInquireFull?.(planKey, categoryKey)}
            className="w-full py-3 rounded-2xl font-extrabold text-[13.5px] text-white transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
            style={{
              background: `linear-gradient(135deg, ${accent}, ${accent}CC)`,
              boxShadow: `0 8px 22px ${accent}40`,
            }}
          >
            <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>forum</span>
            Открыть полный список в чате
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </button>
        </>
      )}

      {/* Empty: нет cat */}
      {!loading && !error && !cat && (
        <p className="text-[13px] text-center py-3" style={{ color: '#94A3B8' }}>
          Нет деталей по этой категории
        </p>
      )}
    </div>
  )
}
