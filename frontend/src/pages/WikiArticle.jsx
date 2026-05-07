/**
 * ========================================
 * БЛОК: <WikiArticle> — рендер одной статьи Wiki
 * ========================================
 * Современный layout документации:
 *   - Слева sidebar (250px desktop, drawer на mobile): «Назад» + TOC + список статей категорий
 *   - По центру: markdown с улучшенной типографикой (h1/h2/h3, code blocks, blockquote)
 *   - Сверху: breadcrumbs «База знаний / Категория / Статья»
 *   - Снизу: футер «Полезно? 👍/👎» + связанные статьи (соседи по категории)
 *
 * Markdown: react-markdown + rehype-raw + remark-gfm (как было).
 * Безопасность: rehype-raw пропускает HTML — контент static (наш). Если станет
 * редактируемым через UI → ОБЯЗАТЕЛЬНО прогонять через DOMPurify.
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { Page, Breadcrumbs } from '../design'
import indexData from '../wiki-content/_index.json'
import WikiSidebar from './wiki/WikiSidebar'
import { CATEGORIES, ARTICLE_ICONS } from './Wiki'

// ─── Сырые .md файлы ───
const rawFiles = import.meta.glob('../wiki-content/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// ─── Slug → markdown текст ───
function getMarkdown(slug) {
  return rawFiles[`../wiki-content/${slug}.md`] || null
}

// ─── ID для якоря по тексту заголовка ───
function slugifyHeading(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\wа-яё\s-]/giu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

// ─── Извлечение заголовков H2/H3 для TOC ───
function extractToc(md) {
  if (!md) return []
  const lines = md.split('\n')
  const toc = []
  let inFence = false
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m2 = line.match(/^##\s+(.+?)\s*$/)
    if (m2) {
      toc.push({ id: slugifyHeading(m2[1]), text: m2[1], level: 2 })
      continue
    }
    const m3 = line.match(/^###\s+(.+?)\s*$/)
    if (m3) {
      toc.push({ id: slugifyHeading(m3[1]), text: m3[1], level: 3 })
    }
  }
  return toc
}

// ─── localStorage helper для сохранения голоса «Полезно?» ───
const FEEDBACK_KEY = 'wiki_feedback_v1'
function getFeedback(slug) {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY)
    if (!raw) return null
    const map = JSON.parse(raw)
    return map[slug] || null
  } catch {
    return null
  }
}
function setFeedback(slug, value) {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY)
    const map = raw ? JSON.parse(raw) : {}
    map[slug] = value
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

export default function WikiArticle() {
  const { slug } = useParams()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [feedback, setFb] = useState(null) // 'up' | 'down' | null
  const [activeTocId, setActiveTocId] = useState('')

  // ─── Контент статьи ───
  const md = getMarkdown(slug)
  const meta = indexData.find((a) => a.slug === slug)
  const toc = useMemo(() => extractToc(md), [md])
  const categoryMeta = CATEGORIES.find((c) => c.id === meta?.category)

  // ─── Группировка для sidebar ───
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

  // ─── Связанные статьи: соседи по категории ───
  const related = useMemo(() => {
    if (!meta) return []
    const peers = (grouped[meta.category] || []).filter((a) => a.slug !== meta.slug)
    return peers.slice(0, 3)
  }, [meta, grouped])

  // ─── Загрузка сохранённого фидбэка ───
  useEffect(() => {
    setFb(getFeedback(slug))
  }, [slug])

  // ─── Скролл при смене slug или хеша ───
  useEffect(() => {
    if (window.location.hash) {
      const el = document.getElementById(window.location.hash.slice(1))
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      window.scrollTo(0, 0)
    }
  }, [slug])

  // ─── Закрытие drawer при переходе ───
  useEffect(() => {
    setDrawerOpen(false)
  }, [slug])

  // ─── Активная секция TOC через scrollspy ───
  useEffect(() => {
    if (!toc.length) return
    const handler = () => {
      const headings = toc
        .map((t) => document.getElementById(t.id))
        .filter(Boolean)
      let active = ''
      for (const h of headings) {
        const top = h.getBoundingClientRect().top
        if (top < 120) active = h.id
        else break
      }
      setActiveTocId(active || toc[0].id)
    }
    handler()
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [toc, slug])

  if (!md || !meta) return <Navigate to="/wiki" replace />

  // ─── Голосование ───
  const handleVote = (value) => {
    const next = feedback === value ? null : value
    setFb(next)
    setFeedback(slug, next)
  }

  // ─── Markdown рендереры (улучшенная типографика) ───
  const components = {
    h1: ({ node, children, ...p }) => (
      <h1
        className="font-semibold leading-[1.1] tracking-tight mb-5"
        style={{
          fontSize: 'clamp(28px, 3.5vw, 36px)',
          letterSpacing: '-0.03em',
          color: 'var(--fg)',
        }}
        {...p}
      >
        {children}
      </h1>
    ),
    h2: ({ node, children, ...p }) => {
      const text = String(Array.isArray(children) ? children.join('') : children)
      const id = slugifyHeading(text)
      return (
        <h2
          id={id}
          className="font-semibold mt-10 mb-3 scroll-mt-24"
          style={{
            fontSize: '22px',
            letterSpacing: '-0.02em',
            color: 'var(--fg)',
            paddingTop: '20px',
            borderTop: '1px solid var(--border)',
          }}
          {...p}
        >
          {children}
        </h2>
      )
    },
    h3: ({ node, children, ...p }) => {
      const text = String(Array.isArray(children) ? children.join('') : children)
      const id = slugifyHeading(text)
      return (
        <h3
          id={id}
          className="font-semibold mt-7 mb-2.5 scroll-mt-24"
          style={{
            fontSize: '17px',
            letterSpacing: '-0.01em',
            color: 'var(--fg)',
          }}
          {...p}
        >
          {children}
        </h3>
      )
    },
    p: ({ node, children, ...p }) => (
      <p
        className="mb-4 leading-[1.7]"
        style={{ fontSize: '15.5px', color: 'var(--fg-2)' }}
        {...p}
      >
        {children}
      </p>
    ),
    ul: ({ node, children, ...p }) => (
      <ul
        className="mb-4 ml-5 list-disc space-y-2"
        style={{ color: 'var(--fg-2)', fontSize: '15.5px', lineHeight: '1.7' }}
        {...p}
      >
        {children}
      </ul>
    ),
    ol: ({ node, children, ...p }) => (
      <ol
        className="mb-4 ml-5 list-decimal space-y-2"
        style={{ color: 'var(--fg-2)', fontSize: '15.5px', lineHeight: '1.7' }}
        {...p}
      >
        {children}
      </ol>
    ),
    li: ({ node, children, ...p }) => (
      <li className="leading-[1.7]" {...p}>
        {children}
      </li>
    ),
    a: ({ node, href, children, ...p }) => {
      const isInternal = href && (href.startsWith('/') || href.startsWith('#'))
      if (isInternal && href.startsWith('/wiki')) {
        return (
          <Link
            to={href}
            className="underline decoration-1 underline-offset-2"
            style={{ color: 'var(--accent)' }}
          >
            {children}
          </Link>
        )
      }
      return (
        <a
          href={href}
          target={isInternal ? undefined : '_blank'}
          rel="noopener noreferrer"
          className="underline decoration-1 underline-offset-2"
          style={{ color: 'var(--accent)' }}
        >
          {children}
        </a>
      )
    },
    blockquote: ({ node, children, ...p }) => (
      <blockquote
        className="my-5 pl-4 pr-3 py-3 rounded-r-lg"
        style={{
          borderLeft: '3px solid var(--accent)',
          background: 'var(--accent-soft)',
          color: 'var(--fg-2)',
          fontSize: '15px',
        }}
        {...p}
      >
        {children}
      </blockquote>
    ),
    code: ({ node, inline, className, children, ...p }) => {
      if (inline) {
        return (
          <code
            className="px-1.5 py-0.5 rounded text-[13.5px]"
            style={{
              background: 'var(--bg-2)',
              border: '1px solid var(--border)',
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              color: 'var(--fg)',
            }}
            {...p}
          >
            {children}
          </code>
        )
      }
      return (
        <pre
          className="my-4 p-4 rounded-xl overflow-x-auto text-[13.5px] leading-[1.6]"
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--border)',
            fontFamily:
              'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
          }}
        >
          <code {...p}>{children}</code>
        </pre>
      )
    },
    table: ({ node, children, ...p }) => (
      <div
        className="my-5 overflow-x-auto rounded-xl"
        style={{ border: '1px solid var(--border)' }}
      >
        <table className="w-full text-sm" {...p}>
          {children}
        </table>
      </div>
    ),
    th: ({ node, children, ...p }) => (
      <th
        className="text-left px-3 py-2.5 font-semibold"
        style={{
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--border)',
          color: 'var(--fg)',
          fontSize: '13px',
        }}
        {...p}
      >
        {children}
      </th>
    ),
    td: ({ node, children, ...p }) => (
      <td
        className="px-3 py-2.5"
        style={{
          borderBottom: '1px solid var(--border)',
          color: 'var(--fg-2)',
          fontSize: '14px',
        }}
        {...p}
      >
        {children}
      </td>
    ),
    hr: () => <hr className="my-8" style={{ borderColor: 'var(--border)' }} />,
    iframe: ({ node, ...p }) => (
      <iframe
        {...p}
        loading="lazy"
        style={{
          ...(p.style || {}),
          border: '1px solid var(--border)',
          borderRadius: '14px',
          maxWidth: '100%',
          display: 'block',
          marginTop: 18,
          marginBottom: 18,
        }}
      />
    ),
  }

  // ─── TOC с подсветкой активной секции (передаём в Sidebar дополненную версию) ───
  const tocWithActive = toc.map((t) => ({ ...t, active: t.id === activeTocId }))

  return (
    <Page>
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 py-4 sm:py-8">
        {/* ─── Mobile topbar ─── */}
        <div className="lg:hidden mb-4 flex items-center justify-between gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 transition-colors"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--fg)',
              fontSize: '13.5px',
              fontWeight: 500,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
              menu_book
            </span>
            Содержание
          </button>
          <Link
            to={meta ? `/wiki?category=${meta.category}` : '/wiki'}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--fg-2)',
              fontSize: '13.5px',
              fontWeight: 500,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
              arrow_back
            </span>
            В категорию
          </Link>
        </div>

        <div className="grid gap-8 lg:gap-10 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* ─── Sidebar desktop ─── */}
          <aside className="hidden lg:block">
            <div
              className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pr-2"
              style={{ scrollbarWidth: 'thin' }}
            >
              <WikiSidebar
                grouped={grouped}
                activeSlug={slug}
                toc={tocWithActive}
              />
            </div>
          </aside>

          {/* ─── Sidebar drawer mobile ─── */}
          {drawerOpen && (
            <>
              <div
                onClick={() => setDrawerOpen(false)}
                className="fixed inset-0 z-40 lg:hidden transition-opacity"
                style={{ background: 'rgba(0,0,0,0.45)' }}
              />
              <aside
                className="fixed left-0 top-0 bottom-0 z-50 w-[300px] overflow-y-auto p-5 lg:hidden"
                style={{
                  background: 'var(--surface)',
                  borderRight: '1px solid var(--border)',
                }}
              >
                <div className="flex items-center justify-between mb-5">
                  <div
                    className="font-semibold"
                    style={{ color: 'var(--fg)', fontSize: '14px' }}
                  >
                    База знаний
                  </div>
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="material-symbols-outlined transition-colors"
                    style={{ fontSize: '22px', color: 'var(--fg-3)' }}
                    aria-label="Закрыть"
                  >
                    close
                  </button>
                </div>
                <WikiSidebar
                  grouped={grouped}
                  activeSlug={slug}
                  toc={tocWithActive}
                  onNavigate={() => setDrawerOpen(false)}
                />
              </aside>
            </>
          )}

          {/* ─── Контент статьи ─── */}
          <article className="min-w-0">
            {/* ─── Breadcrumbs ─── */}
            <Breadcrumbs
              items={[
                { label: 'База знаний', to: () => (window.location.href = '/wiki') },
                {
                  label: categoryMeta?.title || meta.category,
                  to: () =>
                    (window.location.href = `/wiki?category=${meta.category}`),
                },
                { label: meta.title },
              ]}
            />

            {/* ─── Тег категории + иконка статьи (хедер) ─── */}
            <div className="mb-5 flex items-center gap-3 flex-wrap">
              {categoryMeta && (
                <Link
                  to={`/wiki?category=${meta.category}`}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-opacity"
                  style={{
                    background: categoryMeta.accentSoft,
                    color: categoryMeta.accent,
                    fontSize: '11.5px',
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: '14px' }}
                  >
                    {categoryMeta.icon}
                  </span>
                  {categoryMeta.title}
                </Link>
              )}
            </div>

            {/* ─── Markdown body ─── */}
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={components}
              >
                {md}
              </ReactMarkdown>
            </div>

            {/* ─── Footer статьи: «Полезно?» + связанные ─── */}
            <footer className="mt-12 pt-8" style={{ borderTop: '1px solid var(--border)' }}>
              {/* Полезно? */}
              <div
                className="rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                style={{
                  background: 'var(--bg-1)',
                  border: '1px solid var(--border)',
                }}
              >
                <div>
                  <div
                    className="font-semibold"
                    style={{ fontSize: '15px', color: 'var(--fg)' }}
                  >
                    Эта статья была полезной?
                  </div>
                  <div
                    className="mt-1"
                    style={{ fontSize: '13px', color: 'var(--fg-3)' }}
                  >
                    Ваш отзыв поможет улучшить документацию
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleVote('up')}
                    className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 transition-all"
                    style={{
                      background:
                        feedback === 'up' ? 'var(--good-soft)' : 'var(--surface)',
                      border: `1px solid ${
                        feedback === 'up' ? 'var(--good)' : 'var(--border)'
                      }`,
                      color: feedback === 'up' ? 'var(--good)' : 'var(--fg-2)',
                      fontSize: '13.5px',
                      fontWeight: 500,
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{
                        fontSize: '18px',
                        fontVariationSettings:
                          feedback === 'up' ? "'FILL' 1" : "'FILL' 0",
                      }}
                    >
                      thumb_up
                    </span>
                    Полезно
                  </button>
                  <button
                    onClick={() => handleVote('down')}
                    className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 transition-all"
                    style={{
                      background:
                        feedback === 'down' ? 'var(--bad-soft)' : 'var(--surface)',
                      border: `1px solid ${
                        feedback === 'down' ? 'var(--bad)' : 'var(--border)'
                      }`,
                      color: feedback === 'down' ? 'var(--bad)' : 'var(--fg-2)',
                      fontSize: '13.5px',
                      fontWeight: 500,
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{
                        fontSize: '18px',
                        fontVariationSettings:
                          feedback === 'down' ? "'FILL' 1" : "'FILL' 0",
                      }}
                    >
                      thumb_down
                    </span>
                    Не очень
                  </button>
                </div>
              </div>

              {/* Связанные */}
              {related.length > 0 && (
                <div className="mt-8">
                  <div
                    className="text-[11px] uppercase tracking-[0.08em] font-semibold mb-3"
                    style={{ color: 'var(--fg-4)' }}
                  >
                    Связанные статьи
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    {related.map((r) => (
                      <Link
                        key={r.slug}
                        to={`/wiki/${r.slug}`}
                        className="block rounded-xl p-4 transition-all"
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
                          e.currentTarget.style.boxShadow = 'none'
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className="material-symbols-outlined mt-0.5"
                            style={{
                              fontSize: '20px',
                              color: categoryMeta?.accent || 'var(--accent)',
                              fontVariationSettings: "'FILL' 1",
                            }}
                          >
                            {ARTICLE_ICONS[r.slug] || 'article'}
                          </span>
                          <div className="min-w-0">
                            <div
                              className="font-semibold"
                              style={{ fontSize: '14px', color: 'var(--fg)' }}
                            >
                              {r.title}
                            </div>
                            {r.summary && (
                              <div
                                className="mt-1 leading-snug"
                                style={{ fontSize: '12.5px', color: 'var(--fg-3)' }}
                              >
                                {r.summary}
                              </div>
                            )}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Кнопка обратно */}
              <div className="mt-8">
                <Link
                  to={`/wiki?category=${meta.category}`}
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
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: '18px' }}
                  >
                    arrow_back
                  </span>
                  Назад в категорию «{categoryMeta?.title || meta.category}»
                </Link>
              </div>
            </footer>
          </article>
        </div>
      </div>
    </Page>
  )
}
