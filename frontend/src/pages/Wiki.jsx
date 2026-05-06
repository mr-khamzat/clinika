/**
 * ========================================
 * БЛОК: <Wiki> — главная страница раздела «Обучение»
 * ========================================
 * Статическая wiki: контент в /src/wiki-content/*.md, рендер через react-markdown.
 * Layout:
 *   - Sidebar с деревом разделов (mobile: drawer через бургер)
 *   - Центр: главная с категориями + поиск
 * Доступ: публичный (нет чувствительных данных).
 * ========================================
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Page, PageHeader, Card } from '../design'
import indexData from '../wiki-content/_index.json'

// ─── Сырые .md файлы (Vite ?raw): glob импорт ───
const rawFiles = import.meta.glob('../wiki-content/*.md', { query: '?raw', import: 'default', eager: true })

// ─── Группировка по категориям ───
const CATEGORIES = [
  { id: 'role', title: 'Кабинеты по ролям', subtitle: 'Что видит и делает каждая роль в системе' },
  { id: 'concepts', title: 'Концепции и процессы', subtitle: 'Как работают ключевые механизмы' },
  { id: 'setup', title: 'Настройка и запуск', subtitle: 'Пошаговые инструкции по конфигурации' },
]

export default function Wiki() {
  const [query, setQuery] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)

  // ─── Фильтрация статей ───
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return indexData
    return indexData.filter(a => {
      if (a.title.toLowerCase().includes(q)) return true
      if (a.summary && a.summary.toLowerCase().includes(q)) return true
      // поиск по содержимому (первые 2000 символов)
      const raw = rawFiles[`../wiki-content/${a.slug}.md`]
      if (raw && raw.slice(0, 2000).toLowerCase().includes(q)) return true
      return false
    })
  }, [query])

  return (
    <Page>
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-6 sm:py-10">
        <PageHeader
          title="Обучение пользованию КлиникСеть"
          subtitle="Руководство по ролям, процессам и настройкам платформы"
          actions={
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--fg-2)' }}
            >
              <span className="material-symbols-rounded text-[18px]">arrow_back</span>
              На главную
            </Link>
          }
        />

        {/* ─── Поиск ─── */}
        <div className="mb-6 sm:mb-8">
          <div
            className="flex items-center gap-2 rounded-xl px-4 py-3"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <span className="material-symbols-rounded text-[20px]" style={{ color: 'var(--fg-3)' }}>search</span>
            <input
              type="text"
              placeholder="Поиск по статьям…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: 'var(--fg)' }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="material-symbols-rounded text-[18px]"
                style={{ color: 'var(--fg-3)' }}
                aria-label="Очистить"
              >close</button>
            )}
          </div>
        </div>

        {/* ─── Категории и статьи ─── */}
        {query ? (
          <Card>
            <Card.Header>
              <Card.Title>Найдено статей: {filtered.length}</Card.Title>
            </Card.Header>
            <Card.Body>
              {filtered.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--fg-3)' }}>
                  По запросу «{query}» ничего не найдено.
                </p>
              ) : (
                <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {filtered.map(a => (
                    <li key={a.slug} className="py-3">
                      <Link
                        to={`/wiki/${a.slug}`}
                        className="block group"
                      >
                        <div className="font-medium text-sm group-hover:underline" style={{ color: 'var(--fg)' }}>
                          {a.title}
                        </div>
                        {a.summary && (
                          <div className="mt-0.5 text-xs" style={{ color: 'var(--fg-3)' }}>
                            {a.summary}
                          </div>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card.Body>
          </Card>
        ) : (
          <div className="grid gap-5 sm:gap-6">
            {CATEGORIES.map(cat => {
              const items = indexData
                .filter(a => a.category === cat.id)
                .sort((a, b) => (a.order || 99) - (b.order || 99))
              if (!items.length) return null
              return (
                <Card key={cat.id}>
                  <Card.Header>
                    <div>
                      <Card.Title>{cat.title}</Card.Title>
                      <Card.Subtitle>{cat.subtitle}</Card.Subtitle>
                    </div>
                  </Card.Header>
                  <Card.Body>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {items.map(a => (
                        <li key={a.slug}>
                          <Link
                            to={`/wiki/${a.slug}`}
                            className="block rounded-lg p-3 transition-colors"
                            style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}
                          >
                            <div className="font-medium text-[14px]" style={{ color: 'var(--fg)' }}>
                              {a.title}
                            </div>
                            {a.summary && (
                              <div className="mt-1 text-[12.5px] leading-snug" style={{ color: 'var(--fg-3)' }}>
                                {a.summary}
                              </div>
                            )}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Card.Body>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </Page>
  )
}
