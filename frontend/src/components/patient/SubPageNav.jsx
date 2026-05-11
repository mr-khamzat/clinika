/**
 * ========================================
 * БЛОК: SubPageNav — список карточек-разделов внутри таба
 * ========================================
 * Используется как «иконкое меню» на главной табе раздела (Здоровье /
 * Бонусы / Профиль). Каждая карточка — иконка + заголовок + описание +
 * chevron-right. Тап → onOpen(key).
 *
 * UX iPhone SE:
 *   • Карточки одна-в-столбце (1 col), горизонтально занимают всю ширину
 *   • Touch target высота ≥ 56px
 *   • Тонкая разделительная линия между карточками либо box-shadow
 *   • Поддержка бейджей справа от названия (например «3 новых документа»)
 *
 * props:
 *   items: [{
 *     key, icon, label, hint?, badge?, color? (hex для bg иконки)
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
      {title && (
        <h2
          className="text-[13px] font-bold uppercase tracking-wide px-1"
          style={{ color: 'var(--fg-3, #6B7280)' }}
        >
          {title}
        </h2>
      )}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: '#fff',
          boxShadow: '0 2px 12px rgba(0,0,0,.04)',
          border: '1px solid rgba(0,0,0,.05)',
        }}
      >
        {items.map((it, i) => {
          const bg = it.color?.bg || DEFAULT_BG
          const fg = it.color?.fg || DEFAULT_FG
          return (
            <button
              key={it.key}
              onClick={() => onOpen(it.key)}
              className="w-full flex items-center gap-3 px-3 text-left transition-colors active:bg-gray-50"
              style={{
                minHeight: 64,
                paddingTop: 10,
                paddingBottom: 10,
                borderTop: i === 0 ? 'none' : '1px solid rgba(0,0,0,.05)',
              }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: bg }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 20,
                    color: fg,
                    fontVariationSettings: "'FILL' 1",
                  }}
                >
                  {it.icon}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="text-[14px] font-semibold truncate"
                  style={{ color: 'var(--fg, #0A2342)' }}
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
              {it.badge ? (
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: '#FEF3C7', color: '#92400E' }}
                >
                  {it.badge}
                </span>
              ) : null}
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
