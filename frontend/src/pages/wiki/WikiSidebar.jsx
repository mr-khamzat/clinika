/**
 * ========================================
 * БЛОК: <WikiSidebar> — sidebar для статьи (desktop + mobile drawer)
 * ========================================
 * Внутри:
 *   - ссылка «Все статьи» в /wiki
 *   - сгруппированный список статей по категориям с активным slug
 *   - TOC (содержание текущей статьи) — только если toc.length > 0
 *
 * Используется в WikiArticle.jsx как отдельный модуль.
 * Sidebar рендерится дважды (desktop sticky + mobile drawer) — оба раза один компонент.
 *
 * Props:
 *   grouped     — { [category]: Article[] }
 *   activeSlug  — текущий slug
 *   toc         — массив { id, text, level }
 *   onNavigate  — колбэк при клике (для закрытия drawer на mobile)
 *   variant     — 'desktop' | 'mobile'  (отвечает за оформление)
 * ========================================
 */
import { Link } from 'react-router-dom'

const CATEGORY_LABELS = {
  role: 'Роли',
  concepts: 'Концепты',
  setup: 'Настройка',
}

const CATEGORY_ORDER = ['role', 'concepts', 'setup']

export default function WikiSidebar({ grouped, activeSlug, toc = [], onNavigate }) {
  return (
    <nav className="space-y-6">
      {/* ─── Хедер «Назад в базу знаний» ─── */}
      <Link
        to="/wiki"
        onClick={onNavigate}
        className="inline-flex items-center gap-2 transition-colors group"
        style={{ fontSize: '13px', color: 'var(--fg-2)', fontWeight: 500 }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: '18px' }}
        >
          arrow_back
        </span>
        Все статьи
      </Link>

      {/* ─── TOC текущей статьи ─── */}
      {toc.length > 0 && (
        <div>
          <div
            className="text-[10.5px] uppercase tracking-[0.08em] font-semibold mb-2"
            style={{ color: 'var(--fg-4)' }}
          >
            На этой странице
          </div>
          <ul
            className="space-y-1 border-l"
            style={{ borderColor: 'var(--border)' }}
          >
            {toc.map((t) => (
              <li key={t.id}>
                <a
                  href={`#${t.id}`}
                  onClick={onNavigate}
                  className="block leading-snug -ml-px transition-colors hover:opacity-100"
                  style={{
                    paddingLeft: t.level === 3 ? '20px' : '12px',
                    paddingRight: '8px',
                    paddingTop: '4px',
                    paddingBottom: '4px',
                    fontSize: '12.5px',
                    color: 'var(--fg-3)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fg-3)')}
                >
                  {t.text}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ─── Категории + статьи ─── */}
      {CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((cat) => (
        <div key={cat}>
          <div
            className="text-[10.5px] uppercase tracking-[0.08em] font-semibold mb-2"
            style={{ color: 'var(--fg-4)' }}
          >
            {CATEGORY_LABELS[cat] || cat}
          </div>
          <ul className="space-y-0.5">
            {grouped[cat].map((a) => {
              const active = a.slug === activeSlug
              return (
                <li key={a.slug}>
                  <Link
                    to={`/wiki/${a.slug}`}
                    onClick={onNavigate}
                    className="block rounded-lg px-2.5 py-1.5 leading-snug transition-colors"
                    style={{
                      background: active ? 'var(--accent-soft)' : 'transparent',
                      color: active ? 'var(--accent)' : 'var(--fg-2)',
                      fontWeight: active ? 600 : 400,
                      fontSize: '13px',
                      borderLeft: active
                        ? '2px solid var(--accent)'
                        : '2px solid transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!active) e.currentTarget.style.background = 'var(--bg-1)'
                    }}
                    onMouseLeave={(e) => {
                      if (!active) e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    {a.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
