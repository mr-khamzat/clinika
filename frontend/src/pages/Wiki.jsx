/**
 * ========================================
 * БЛОК: <Wiki> — главная и список категорий портала документации
 * ========================================
 * Современный портал «База знаний КлиникСеть».
 *
 * Маршруты:
 *   /wiki                  → Главная: hero + grid категорий + популярные статьи
 *   /wiki?category=role    → Список статей категории «Роли»
 *   /wiki?category=concepts→ Список статей категории «Концепты»
 *   /wiki?category=setup   → Список статей категории «Настройка»
 *
 * Поиск:
 *   - Client-side по title + summary + первым 4000 символам .md
 *   - Cmd+K / Ctrl+K — фокус на input
 *   - Подсветка совпадений в результатах
 *
 * Стиль:
 *   - Корпоративный (Notion/Linear/Stripe Docs)
 *   - Цветные иконки Material Symbols (НЕ emoji)
 *   - Карточки с lift hover-эффектом
 *
 * Доступ: публичный (нет чувствительных данных).
 * ========================================
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Page, Breadcrumbs } from '../design'
import indexData from '../wiki-content/_index.json'
import WikiHero from './wiki/WikiHero'
import WikiCategoryCard from './wiki/WikiCategoryCard'
import WikiArticleCard from './wiki/WikiArticleCard'
import WikiSearchResults from './wiki/WikiSearchResults'

// ─── Сырые .md файлы для контентного поиска ───
const rawFiles = import.meta.glob('../wiki-content/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// ─── Метаданные категорий: цвета, иконки, описания ───
const CATEGORIES = [
  {
    id: 'role',
    title: 'Роли',
    description:
      'Кабинеты для каждой роли в системе: что видит и что может делать пользователь.',
    icon: 'groups',
    accent: 'oklch(0.55 0.16 240)',
    accentSoft: 'oklch(0.55 0.16 240 / 0.10)',
  },
  {
    id: 'concepts',
    title: 'Концепты',
    description:
      'Как устроены ключевые механизмы платформы: бонусы, направления, расписание.',
    icon: 'auto_stories',
    accent: 'oklch(0.55 0.15 150)',
    accentSoft: 'oklch(0.55 0.15 150 / 0.10)',
  },
  {
    id: 'setup',
    title: 'Настройка',
    description:
      'Пошаговые инструкции по запуску клиники, настройке тенанта и сотрудников.',
    icon: 'tune',
    accent: 'oklch(0.62 0.13 75)',
    accentSoft: 'oklch(0.62 0.13 75 / 0.12)',
  },
]

// ─── Иконки для конкретных статей по slug ───
const ARTICLE_ICONS = {
  'role-super-admin': 'admin_panel_settings',
  'role-franchise-owner': 'workspace_premium',
  'role-manager': 'manage_accounts',
  'role-doctor': 'stethoscope',
  'role-reg': 'support_agent',
  'role-nurse': 'vaccines',
  'role-recruiter': 'person_search',
  'role-partner-doctor': 'handshake',
  'role-visiting-doctor': 'directions_car',
  'role-patient': 'person',
  'concepts-bonuses': 'paid',
  'concepts-referrals': 'share',
  'concepts-appointments': 'event',
  'concepts-qr': 'qr_code_scanner',
  'concepts-modules': 'apps',
  'setup-first-clinic': 'rocket_launch',
  'setup-staff': 'group_add',
}

// ─── Популярные slug-и для секции «Популярные статьи» ───
const POPULAR_SLUGS = ['role-manager', 'role-doctor', 'role-reg', 'role-patient', 'concepts-appointments']

export default function Wiki() {
  const [params, setParams] = useSearchParams()
  const category = params.get('category') // 'role' | 'concepts' | 'setup' | null
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)

  // ─── Cmd+K / Ctrl+K — фокус на поиск ───
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ─── Скролл наверх при смене категории ───
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [category])

  // ─── Поиск с снипетами ───
  const { filtered, snippets } = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return { filtered: [], snippets: {} }
    const out = []
    const snip = {}
    for (const a of indexData) {
      let hit = false
      if (a.title.toLowerCase().includes(q)) hit = true
      else if (a.summary && a.summary.toLowerCase().includes(q)) hit = true
      const raw = rawFiles[`../wiki-content/${a.slug}.md`]
      if (raw) {
        const lower = raw.toLowerCase()
        const idx = lower.indexOf(q)
        if (idx >= 0) {
          hit = true
          // Извлекаем сниппет ±60 символов вокруг совпадения
          const start = Math.max(0, idx - 60)
          const end = Math.min(raw.length, idx + q.length + 80)
          let snippet = raw
            .slice(start, end)
            .replace(/[#*`_>]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
          if (snippet.length > 160) snippet = snippet.slice(0, 160)
          snip[a.slug] = snippet
        }
      }
      if (hit) out.push(a)
    }
    return { filtered: out, snippets: snip }
  }, [query])

  // ─── Группировка по категориям ───
  const grouped = useMemo(() => {
    const g = {}
    for (const a of indexData) {
      if (!g[a.category]) g[a.category] = []
      g[a.category].push(a)
    }
    Object.values(g).forEach((arr) =>
      arr.sort((a, b) => (a.order || 99) - (b.order || 99))
    )
    return g
  }, [])

  const popular = useMemo(
    () =>
      POPULAR_SLUGS.map((s) => indexData.find((a) => a.slug === s)).filter(Boolean),
    []
  )

  // ─── Текущая категория (если есть) ───
  const currentCategory = category ? CATEGORIES.find((c) => c.id === category) : null
  const categoryArticles = category ? grouped[category] || [] : []

  // ─── Режим: главная или список статей категории ───
  const isCategoryView = !!currentCategory && !query.trim()

  return (
    <Page>
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-6 sm:py-10">
        {/* ─── Breadcrumbs (только в режиме категории) ─── */}
        {isCategoryView && (
          <Breadcrumbs
            items={[
              { label: 'База знаний', to: () => setParams({}) },
              { label: currentCategory.title },
            ]}
          />
        )}

        {/* ─── Главная: hero + категории + популярные ─── */}
        {!isCategoryView ? (
          <>
            <WikiHero
              query={query}
              onQueryChange={setQuery}
              inputRef={inputRef}
              resultsCount={indexData.length}
            />

            {/* ─── Поиск активен — показываем результаты ─── */}
            {query.trim() ? (
              <WikiSearchResults
                query={query.trim()}
                results={filtered}
                snippets={snippets}
              />
            ) : (
              <>
                {/* ─── Категории grid ─── */}
                <section className="mb-12 sm:mb-14">
                  <div className="flex items-end justify-between mb-5">
                    <div>
                      <h2
                        className="font-semibold tracking-tight"
                        style={{
                          fontSize: '22px',
                          letterSpacing: '-0.02em',
                          color: 'var(--fg)',
                        }}
                      >
                        Категории
                      </h2>
                      <p
                        className="mt-1"
                        style={{ fontSize: '13.5px', color: 'var(--fg-3)' }}
                      >
                        Выберите раздел, чтобы увидеть все статьи внутри
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {CATEGORIES.map((cat) => {
                      const items = grouped[cat.id] || []
                      return (
                        <WikiCategoryCard
                          key={cat.id}
                          to={`/wiki?category=${cat.id}`}
                          icon={cat.icon}
                          title={cat.title}
                          description={cat.description}
                          count={items.length}
                          accent={cat.accent}
                          accentSoft={cat.accentSoft}
                        />
                      )
                    })}
                  </div>
                </section>

                {/* ─── Популярные статьи ─── */}
                <section>
                  <div className="flex items-end justify-between mb-5">
                    <div>
                      <h2
                        className="font-semibold tracking-tight"
                        style={{
                          fontSize: '22px',
                          letterSpacing: '-0.02em',
                          color: 'var(--fg)',
                        }}
                      >
                        Популярные статьи
                      </h2>
                      <p
                        className="mt-1"
                        style={{ fontSize: '13.5px', color: 'var(--fg-3)' }}
                      >
                        С чего обычно начинают изучение платформы
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {popular.map((a) => {
                      const cat = CATEGORIES.find((c) => c.id === a.category)
                      return (
                        <WikiArticleCard
                          key={a.slug}
                          to={`/wiki/${a.slug}`}
                          icon={ARTICLE_ICONS[a.slug] || 'article'}
                          title={a.title}
                          summary={a.summary}
                          accent={cat?.accent || 'var(--accent)'}
                          accentSoft={cat?.accentSoft || 'var(--accent-soft)'}
                        />
                      )
                    })}
                  </div>
                </section>
              </>
            )}
          </>
        ) : (
          /* ─── Список статей категории ─── */
          <>
            {/* ─── Хедер категории ─── */}
            <header className="mb-7 sm:mb-9 flex items-start gap-4">
              <div
                className="flex items-center justify-center rounded-2xl flex-shrink-0"
                style={{
                  width: '64px',
                  height: '64px',
                  background: currentCategory.accentSoft,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: '36px',
                    color: currentCategory.accent,
                    fontVariationSettings: "'FILL' 1, 'wght' 500",
                  }}
                >
                  {currentCategory.icon}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <h1
                  className="font-semibold leading-tight tracking-tight"
                  style={{
                    fontSize: 'clamp(26px, 3.5vw, 36px)',
                    letterSpacing: '-0.025em',
                    color: 'var(--fg)',
                  }}
                >
                  {currentCategory.title}
                </h1>
                <p
                  className="mt-2 leading-relaxed"
                  style={{
                    fontSize: '15px',
                    color: 'var(--fg-2)',
                    maxWidth: '640px',
                  }}
                >
                  {currentCategory.description}
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: 'var(--bg-2)',
                      border: '1px solid var(--border)',
                      color: 'var(--fg-2)',
                      fontSize: '11.5px',
                    }}
                  >
                    {categoryArticles.length} {pluralize(categoryArticles.length)}
                  </span>
                </div>
              </div>
            </header>

            {/* ─── Grid статей ─── */}
            {categoryArticles.length === 0 ? (
              <div
                className="rounded-2xl p-10 text-center"
                style={{
                  background: 'var(--surface)',
                  border: '1px dashed var(--border)',
                }}
              >
                <p style={{ color: 'var(--fg-3)' }}>В этой категории пока нет статей.</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
                {categoryArticles.map((a) => (
                  <WikiArticleCard
                    key={a.slug}
                    to={`/wiki/${a.slug}`}
                    icon={ARTICLE_ICONS[a.slug] || 'article'}
                    title={a.title}
                    summary={a.summary}
                    accent={currentCategory.accent}
                    accentSoft={currentCategory.accentSoft}
                  />
                ))}
              </div>
            )}

            {/* ─── Назад ─── */}
            <div className="mt-10">
              <Link
                to="/wiki"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 transition-colors"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--fg-2)',
                  fontSize: '13.5px',
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--fg)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fg-2)')}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                  arrow_back
                </span>
                Все категории
              </Link>
            </div>
          </>
        )}
      </div>
    </Page>
  )
}

function pluralize(n) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'статья'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'статьи'
  return 'статей'
}

// ─── Экспорт мета для переиспользования в WikiArticle ───
export { CATEGORIES, ARTICLE_ICONS }
