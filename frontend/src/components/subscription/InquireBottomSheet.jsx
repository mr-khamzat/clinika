/**
 * ========================================
 * БЛОК: InquireBottomSheet — мобильный bottom-sheet с деталями привилегии (Глава 9 v2)
 * ========================================
 * Mobile-only альтернатива BenefitsCategoryAccordion: открывается снизу,
 * полноэкранный, с blurred backdrop. Slide-up анимация.
 *
 * Props:
 *   open          — boolean
 *   onClose       — () => void
 *   planKey       — string
 *   categoryKey   — string
 *   data          — данные категории (см. BenefitsCategoryAccordion)
 *   loading       — boolean
 *   error         — string | null
 *   onInquireFull — (planKey, categoryKey) => void — переход в чат
 *   accent        — string — акцент-цвет
 * ========================================
 */
import { useEffect } from 'react'

function findCategory(data, categoryKey) {
  if (!data?.categories_breakdown) return null
  return data.categories_breakdown.find(c =>
    c.key === categoryKey || c.slug === categoryKey || c.category_key === categoryKey
  ) || data.categories_breakdown[0] || null
}

export default function InquireBottomSheet({
  open,
  onClose,
  planKey,
  categoryKey,
  data,
  loading = false,
  error = null,
  onInquireFull,
  accent = '#7C3AED',
}) {
  // Esc + body scroll-lock
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  const cat = findCategory(data, categoryKey)

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 transition-opacity"
        style={{
          background: 'rgba(15,23,42,.55)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          animation: 'inq-fade .25s ease-out',
        }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="relative w-full max-w-md rounded-t-3xl bg-white pb-6 shadow-2xl"
        style={{
          maxHeight: '90vh',
          animation: 'inq-slide .28s cubic-bezier(.2,.85,.3,1)',
          boxShadow: '0 -16px 48px rgba(15,23,42,.25)',
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1">
          <span className="block w-10 h-1 rounded-full" style={{ background: '#CBD5E1' }} />
        </div>

        <div className="px-5 pt-2 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 16px)' }}>
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${accent}14` }}
              >
                <span
                  className="material-symbols-outlined text-[24px]"
                  style={{ color: accent, fontVariationSettings: "'FILL' 1" }}
                >
                  {cat?.icon || 'fact_check'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                  Тариф «{planKey === 'health_plus' ? 'Здоровье+' : planKey === 'family_plus' ? 'Семья+' : planKey === 'pro' ? 'Pro' : planKey}»
                </p>
                <p className="text-[17px] font-extrabold leading-tight mt-0.5" style={{ color: '#0F172A' }}>
                  {cat?.category || cat?.title || 'Подробности'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 hover:bg-slate-100 transition-colors"
              aria-label="Закрыть"
            >
              <span className="material-symbols-outlined text-[22px]" style={{ color: '#64748B' }}>close</span>
            </button>
          </div>

          {/* Loading */}
          {loading && (
            <div className="space-y-3 animate-pulse pb-4">
              <div className="h-14 rounded-2xl bg-slate-200/70" />
              <div className="h-6 rounded bg-slate-200/60 w-1/2" />
              <div className="h-32 rounded-2xl bg-slate-200/60" />
              <div className="h-12 rounded-2xl bg-slate-200/60" />
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="rounded-2xl p-4 text-center" style={{ background: '#FEE2E2', color: '#991B1B' }}>
              <p className="text-[13px] font-semibold">Не удалось загрузить детали</p>
              <p className="text-[11.5px] mt-1 opacity-80">{error}</p>
            </div>
          )}

          {/* Data */}
          {!loading && !error && cat && (
            <>
              {/* Stats */}
              <div className="rounded-2xl px-4 py-4 mb-4 flex items-center gap-4 flex-wrap"
                   style={{ background: `${accent}0C` }}>
                <div className="flex-1 min-w-[120px]">
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Доступно</p>
                  <p className="text-3xl font-black leading-tight" style={{ color: accent }}>
                    {cat.available_count ?? '—'}
                    {cat.total_in_clinic && (
                      <span className="text-[14px] font-bold ml-1" style={{ color: '#94A3B8' }}>
                        / {cat.total_in_clinic}
                      </span>
                    )}
                  </p>
                </div>
                {cat.discount != null && (
                  <div className="flex-1 min-w-[100px]">
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Скидка</p>
                    <p className="text-3xl font-black leading-tight" style={{ color: '#15803D' }}>
                      −{cat.discount}%
                    </p>
                  </div>
                )}
              </div>

              {/* Frequency */}
              {cat.frequency && (
                <div className="rounded-xl px-3 py-2 mb-4 flex items-center gap-2"
                     style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <span className="material-symbols-outlined text-base" style={{ color: '#64748B', fontVariationSettings: "'FILL' 1" }}>schedule</span>
                  <span className="text-[12.5px] font-semibold" style={{ color: '#334155' }}>
                    Периодичность: {cat.frequency}
                  </span>
                </div>
              )}

              {/* Examples */}
              {Array.isArray(cat.examples) && cat.examples.length > 0 && (
                <>
                  <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#64748B' }}>
                    Что входит — например
                  </p>
                  <div className="flex flex-wrap gap-2 mb-5">
                    {cat.examples.map((ex, i) => (
                      <span
                        key={i}
                        className="px-3 py-1.5 rounded-full text-[13px] font-semibold"
                        style={{ background: `${accent}10`, color: accent, border: `1px solid ${accent}25` }}
                      >
                        {ex}
                      </span>
                    ))}
                    {cat.total_in_clinic && cat.examples.length < cat.total_in_clinic && (
                      <span
                        className="px-3 py-1.5 rounded-full text-[13px] font-bold"
                        style={{ background: '#F1F5F9', color: '#475569' }}
                      >
                        +ещё {cat.total_in_clinic - cat.examples.length}
                      </span>
                    )}
                  </div>
                </>
              )}

              {/* Info note */}
              <div className="rounded-xl p-3 mb-5 flex items-start gap-2"
                   style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                <span className="material-symbols-outlined text-base flex-shrink-0 mt-0.5"
                      style={{ color: '#1D4ED8', fontVariationSettings: "'FILL' 1" }}>info</span>
                <p className="text-[12px] leading-relaxed" style={{ color: '#1E40AF' }}>
                  Полный список и подробный разбор привилегий отправим в чат поддержки —
                  можно сохранить и вернуться позже.
                </p>
              </div>

              {/* CTA */}
              <button
                type="button"
                onClick={() => onInquireFull?.(planKey, categoryKey)}
                className="w-full py-3.5 rounded-2xl font-extrabold text-[14px] text-white transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                style={{
                  background: `linear-gradient(135deg, ${accent}, ${accent}CC)`,
                  boxShadow: `0 10px 26px ${accent}50`,
                }}
              >
                <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>forum</span>
                Открыть полный список в чате
              </button>
            </>
          )}

          {!loading && !error && !cat && (
            <p className="text-[13px] text-center py-6" style={{ color: '#94A3B8' }}>
              Нет деталей по этой категории
            </p>
          )}
        </div>

        {/* keyframes */}
        <style>{`
          @keyframes inq-slide {
            0% { transform: translateY(100%); }
            100% { transform: translateY(0); }
          }
          @keyframes inq-fade {
            0% { opacity: 0; }
            100% { opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  )
}
