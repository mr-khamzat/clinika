/**
 * ========================================
 * БЛОК: SegmentControl — iOS-style сегмент-контрол
 * ========================================
 * Используется в PatientChatHub.jsx для переключения вкладок
 * «Поддержка / Клиника / AI-ассистент». Apple HIG-стиль:
 *   • Серая pill-подложка
 *   • Активный сегмент — белая капсула + тонкая тень
 *   • Поддержка тёмной темы (используется var(--bg-2), var(--fg))
 *   • Бейдж непрочитанных справа от лейбла
 *   • Иконка слева (material-symbols-outlined) — опциональна
 * ========================================
 *
 * props:
 *   items: [{ key, label, icon?, badge? }]
 *   value: текущий выбранный key
 *   onChange: (key) => void
 */
export default function SegmentControl({ items, value, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Сегмент-контрол"
      className="flex items-center gap-1 p-1 rounded-2xl"
      style={{
        background: 'rgba(118,118,128,0.12)',
        WebkitBackdropFilter: 'blur(20px)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {items.map((it) => {
        const active = it.key === value
        return (
          <button
            key={it.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className="flex-1 flex items-center justify-center gap-1 h-9 rounded-xl text-[13px] font-semibold transition-all"
            style={{
              minHeight: 36,
              minWidth: 44,
              background: active ? 'var(--bg, #ffffff)' : 'transparent',
              color: active ? 'var(--fg, #0A2342)' : 'var(--fg-3, #6B7280)',
              boxShadow: active
                ? '0 2px 6px rgba(0,0,0,.10), 0 1px 2px rgba(0,0,0,.06)'
                : 'none',
            }}
          >
            {it.icon && (
              <span
                className="material-symbols-outlined text-[16px]"
                style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
              >
                {it.icon}
              </span>
            )}
            <span className="truncate">{it.label}</span>
            {it.badge ? (
              <span
                className="ml-0.5 min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
                style={{ background: '#EF4444', color: '#fff' }}
              >
                {it.badge > 99 ? '99+' : it.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
