/**
 * ========================================
 * БЛОК: SubPageNav — премиум-меню разделов внутри таба
 * ========================================
 * Используется как «карточный список» на главной табе раздела (Здоровье /
 * Бонусы / Профиль). Каждая карточка — gradient-icon + заголовок + hint +
 * chevron. Тап → onOpen(key).
 *
 * Полировка 2026-06-09:
 *   • Карточки разделены gap-2 (видимый воздух между пунктами)
 *   • Иконка ставится в gradient-чип, размер 44 (было 40), с drop-shadow
 *   • Заглавный header — выровнен по дизайну Home
 *   • Stagger pop-in анимация (60ms между пунктами)
 *   • Активный tap — scale(.97) + лёгкое затемнение
 *   • Поддержка badge остаётся, типография согласована
 *
 * props:
 *   items: [{
 *     key:    string,         // ID при onOpen
 *     icon:   string,         // material-symbols name
 *     label:  string,         // заголовок строки
 *     hint?:  string,         // вторая строка (опционально)
 *     badge?: string | number,// chip справа (опционально)
 *     color?: {bg, fg}        // цвета icon-чипа
 *   }]
 *   onOpen: (key) => void
 *   title?: заголовок группы (опционально)
 * ========================================
 */
const DEFAULT_BG = '#E0F7FA'
const DEFAULT_FG = '#00838F'

export default function SubPageNav({ items, onOpen, title }) {
  return (
    <div className="space-y-3">
      <style>{`
        @keyframes spnPop { from{opacity:0;transform:translateY(8px) scale(.98)} to{opacity:1;transform:translateY(0) scale(1)} }
        .spn-card { animation: spnPop .42s cubic-bezier(.22,1.4,.36,1) both; transition: transform .15s, box-shadow .2s, background .2s }
        .spn-card:active { transform: scale(.97); background: rgba(0,0,0,.025) }
        @media (prefers-color-scheme: dark) {
          .spn-card:active { background: rgba(255,255,255,.04) }
        }
      `}</style>

      {/* ── Заголовок группы (необязательный) ── */}
      {title && (
        <h2
          className="text-[13px] font-bold uppercase tracking-wide px-1"
          style={{ color: 'var(--fg-3, #6B7280)' }}
        >
          {title}
        </h2>
      )}

      {/* ── Карточный список разделов ── */}
      <div className="space-y-2">
        {items.map((it, i) => {
          const bg = it.color?.bg || DEFAULT_BG
          const fg = it.color?.fg || DEFAULT_FG
          return (
            <button
              key={it.key}
              onClick={() => onOpen(it.key)}
              className="spn-card w-full flex items-center gap-3 px-3.5 py-3 text-left rounded-2xl"
              style={{
                animationDelay: `${i * 0.05}s`,
                minHeight: 68,
                background: 'var(--bg, #fff)',
                border: '1px solid rgba(0,0,0,.05)',
                boxShadow: '0 2px 10px rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.6)',
              }}
            >
              {/* Icon-chip с gradient + drop-shadow */}
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${bg} 0%, ${bg}EE 100%)`,
                  boxShadow: `0 4px 12px ${fg}26, inset 0 1px 0 rgba(255,255,255,.5)`,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 22,
                    color: fg,
                    fontVariationSettings: "'FILL' 1",
                    filter: `drop-shadow(0 1px 2px ${fg}40)`,
                  }}
                >
                  {it.icon}
                </span>
              </div>

              {/* Текст: label + hint */}
              <div className="flex-1 min-w-0">
                <p
                  className="text-[14px] font-bold truncate"
                  style={{ color: 'var(--fg, #0A2342)', letterSpacing: '-0.01em' }}
                >
                  {it.label}
                </p>
                {it.hint && (
                  <p
                    className="text-[12px] truncate mt-0.5"
                    style={{ color: 'var(--fg-3, #6B7280)' }}
                  >
                    {it.hint}
                  </p>
                )}
              </div>

              {/* Опциональный chip-badge справа */}
              {it.badge ? (
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: '#FEF3C7', color: '#92400E' }}
                >
                  {it.badge}
                </span>
              ) : null}

              {/* Chevron-стрелка */}
              <span
                className="material-symbols-outlined flex-shrink-0"
                style={{ fontSize: 20, color: '#9CA3AF' }}
              >
                chevron_right
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
