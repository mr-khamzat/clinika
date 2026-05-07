/**
 * ========================================
 * БЛОК: <WikiSearchResults> — результаты поиска с подсветкой
 * ========================================
 * Используется на главной /wiki, когда заполнен query.
 * Заменяет grid категорий — показывает плоский список совпадений.
 *
 * Props:
 *   query     — поисковая строка (для подсветки)
 *   results   — Article[] из _index.json
 *   snippets  — { [slug]: string } — короткий выдержка контента вокруг совпадения
 * ========================================
 */
import { Link } from 'react-router-dom'

const CATEGORY_LABELS = {
  role: 'Роли',
  concepts: 'Концепты',
  setup: 'Настройка',
}

// ─── Подсветка совпадений в тексте ───
function highlight(text, query) {
  if (!text || !query) return text
  const parts = String(text).split(new RegExp(`(${escapeRegex(query)})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark
        key={i}
        style={{
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          padding: '0 2px',
          borderRadius: '3px',
          fontWeight: 600,
        }}
      >
        {part}
      </mark>
    ) : (
      part
    )
  )
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default function WikiSearchResults({ query, results, snippets = {} }) {
  if (!results.length) {
    return (
      <div
        className="rounded-2xl p-10 text-center"
        style={{
          background: 'var(--surface)',
          border: '1px dashed var(--border)',
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: '48px', color: 'var(--fg-4)' }}
        >
          search_off
        </span>
        <p
          className="mt-3 font-medium"
          style={{ color: 'var(--fg)', fontSize: '16px' }}
        >
          Ничего не найдено
        </p>
        <p className="mt-1" style={{ color: 'var(--fg-3)', fontSize: '14px' }}>
          По запросу «{query}» статей не нашлось. Попробуйте другие ключевые слова.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div
        className="text-[11px] uppercase tracking-[0.08em] font-semibold mb-3"
        style={{ color: 'var(--fg-4)' }}
      >
        Найдено {results.length}
      </div>
      <ul className="space-y-2">
        {results.map((a) => (
          <li key={a.slug}>
            <Link
              to={`/wiki/${a.slug}`}
              className="block rounded-xl p-4 sm:p-5 transition-all duration-200"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent)'
                e.currentTarget.style.boxShadow = 'var(--shadow-md)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.boxShadow = 'var(--shadow-sm)'
              }}
            >
              <div
                className="text-[11px] uppercase tracking-[0.06em] font-semibold mb-1"
                style={{ color: 'var(--fg-4)' }}
              >
                {CATEGORY_LABELS[a.category] || a.category}
              </div>
              <div
                className="font-semibold tracking-tight"
                style={{ fontSize: '16px', color: 'var(--fg)', letterSpacing: '-0.01em' }}
              >
                {highlight(a.title, query)}
              </div>
              {a.summary && (
                <div
                  className="mt-1 leading-snug"
                  style={{ fontSize: '13.5px', color: 'var(--fg-3)' }}
                >
                  {highlight(a.summary, query)}
                </div>
              )}
              {snippets[a.slug] && (
                <div
                  className="mt-2 leading-snug rounded-md px-2 py-1.5"
                  style={{
                    fontSize: '12.5px',
                    color: 'var(--fg-2)',
                    background: 'var(--bg-1)',
                    fontStyle: 'italic',
                  }}
                >
                  …{highlight(snippets[a.slug], query)}…
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
