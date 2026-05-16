/**
 * ========================================
 * БЛОК: <WikiArticle> — рендер одной статьи Wiki (Notion/Linear-style)
 * ========================================
 * 3-колоночный layout (desktop):
 *   ┌──────────┬──────────────────────────┬──────────┐
 *   │ Sidebar  │   Article markdown body  │   ToC    │
 *   │  260px   │       max-width 740px    │  220px   │
 *   └──────────┴──────────────────────────┴──────────┘
 *
 * Левая колонка: тот же sidebar-tree, что и в Wiki.jsx (общий компонент).
 * Центр:
 *   - Sticky breadcrumbs
 *   - Метаданные: иконка + заголовок + tag категории + reading time + last updated
 *   - Markdown body (типографика 1.7 line-height)
 *   - Footer: «Полезно?» + связанные статьи + prev/next + edit on GitHub
 * Правая колонка (sticky ToC):
 *   - Извлекается из H2/H3 заголовков статьи (regex по сырому MD)
 *   - Активный пункт подсвечивается через IntersectionObserver
 *
 * Reading time: ceil(words / 200), формат «N мин чтения».
 * Last updated: из frontmatter `updated:` (если есть) — backward-compatible.
 *
 * Markdown: react-markdown + rehype-raw + remark-gfm.
 * ========================================
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, Navigate, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { Page } from '../design'
import indexData from '../wiki-content/_index.json'
import { CATEGORIES, ARTICLE_ICONS } from './Wiki'

// ─── Сырые .md файлы ───
const rawFiles = import.meta.glob('../wiki-content/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

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

// ─── Frontmatter parser (минимальный, для updated:) ───
function parseFrontmatter(md) {
  if (!md || !md.startsWith('---\n')) return { body: md, meta: {} }
  const end = md.indexOf('\n---\n', 4)
  if (end < 0) return { body: md, meta: {} }
  const raw = md.slice(4, end)
  const body = md.slice(end + 5)
  const meta = {}
  raw.split('\n').forEach((line) => {
    const m = line.match(/^([a-zA-Z_-]+):\s*(.+)$/)
    if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  })
  return { body, meta }
}

// ─── Извлечение H2/H3 для ToC ───
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

// ─── Reading time ───
function readingTime(md) {
  if (!md) return 1
  // Удаляем code blocks для честности
  const clean = md.replace(/```[\s\S]*?```/g, '').replace(/[#*`_>|]/g, '')
  const words = clean.split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(words / 200))
}

// ─── localStorage feedback ───
const FEEDBACK_KEY = 'wiki_feedback_v1'
function getFeedback(slug) {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY)
    if (!raw) return null
    return JSON.parse(raw)[slug] || null
  } catch {
    return null
  }
}
function saveFeedback(slug, value) {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY)
    const map = raw ? JSON.parse(raw) : {}
    map[slug] = value
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

// ─── Группировка по префиксу slug (fallback) ───
function categoryFromSlug(slug) {
  if (slug.startsWith('chapter-')) return 'chapters'
  if (slug.startsWith('concepts-')) return 'concepts'
  if (slug.startsWith('dev-')) return 'dev'
  if (slug.startsWith('role-')) return 'role'
  if (slug.startsWith('setup-')) return 'setup'
  if (slug.startsWith('api-')) return 'api'
  if (slug.startsWith('module-')) return 'modules'
  if (slug.startsWith('intro-')) return 'intro'
  if (slug === 'faq') return 'faq'
  if (slug === 'changelog') return 'changelog'
  return 'misc'
}

// ─── SidebarTree (внутренний — копия из Wiki.jsx, но активна по slug) ───
function SidebarTree({ activeSlug, filter, setFilter, onNavigate }) {
  const activeCategory =
    indexData.find((a) => a.slug === activeSlug)?.category ||
    categoryFromSlug(activeSlug || '')
  const [expanded, setExpanded] = useState(() => {
    const init = {}
    CATEGORIES.forEach((c) => {
      init[c.id] = c.id === activeCategory
    })
    return init
  })

  const grouped = useMemo(() => {
    const g = {}
    for (const a of indexData) {
      const cat = a.category || categoryFromSlug(a.slug)
      if (!g[cat]) g[cat] = []
      g[cat].push(a)
    }
    Object.values(g).forEach((arr) =>
      arr.sort((a, b) => (a.order || 99) - (b.order || 99))
    )
    return g
  }, [])

  const f = (filter || '').trim().toLowerCase()
  const matchesFilter = (a) => !f || a.title.toLowerCase().includes(f)

  return (
    <nav className="space-y-1">
      <div className="relative mb-4">
        <span
          className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ fontSize: '17px', color: 'var(--fg-4)' }}
        >
          filter_list
        </span>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Фильтр статей…"
          className="w-full rounded-lg pl-9 pr-3 py-2"
          style={{
            background: 'var(--bg-1)',
            border: '1px solid var(--border)',
            color: 'var(--fg)',
            fontSize: '13px',
            outline: 'none',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
        />
      </div>

      <Link
        to="/wiki"
        onClick={onNavigate}
        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
        style={{
          color: 'var(--fg-2)',
          fontSize: '13px',
          fontWeight: 500,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-1)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>
          home
        </span>
        Главная
      </Link>

      <div className="h-2" />

      {CATEGORIES.map((cat) => {
        const articles = (grouped[cat.id] || []).filter(matchesFilter)
        if (f && articles.length === 0) return null
        const open = expanded[cat.id] || !!f
        const containsActive = (grouped[cat.id] || []).some((a) => a.slug === activeSlug)
        return (
          <div key={cat.id}>
            <div className="flex items-stretch">
              <button
                onClick={() =>
                  setExpanded((s) => ({ ...s, [cat.id]: !s[cat.id] }))
                }
                className="flex items-center justify-center w-6 rounded-md"
                style={{ color: 'var(--fg-4)' }}
                aria-label={open ? 'Свернуть' : 'Развернуть'}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: '18px',
                    transform: open ? 'rotate(90deg)' : 'rotate(0)',
                    transition: 'transform 0.15s',
                  }}
                >
                  chevron_right
                </span>
              </button>
              <Link
                to={`/wiki?category=${cat.id}`}
                onClick={onNavigate}
                className="flex-1 flex items-center gap-2 rounded-lg px-1.5 py-1.5 min-w-0 transition-colors"
                style={{
                  background:
                    containsActive ? 'var(--accent-soft)' : 'transparent',
                  color: containsActive ? 'var(--accent)' : 'var(--fg-2)',
                  fontSize: '13px',
                  fontWeight: containsActive ? 600 : 500,
                }}
              >
                <span
                  className="material-symbols-outlined flex-shrink-0"
                  style={{
                    fontSize: '17px',
                    color: cat.accent,
                    fontVariationSettings: "'FILL' 1, 'wght' 500",
                  }}
                >
                  {cat.icon}
                </span>
                <span className="truncate">{cat.title}</span>
                <span
                  className="ml-auto flex-shrink-0 text-[11px]"
                  style={{ color: 'var(--fg-4)' }}
                >
                  {(grouped[cat.id] || []).length}
                </span>
              </Link>
            </div>
            {open && articles.length > 0 && (
              <ul
                className="ml-6 mt-0.5 mb-1 space-y-0.5 border-l"
                style={{ borderColor: 'var(--border)' }}
              >
                {articles.map((a) => {
                  const active = a.slug === activeSlug
                  return (
                    <li key={a.slug}>
                      <Link
                        to={`/wiki/${a.slug}`}
                        onClick={onNavigate}
                        className="block rounded-md px-2.5 py-1 leading-snug transition-colors ml-1"
                        style={{
                          background: active ? 'var(--accent-soft)' : 'transparent',
                          color: active ? 'var(--accent)' : 'var(--fg-3)',
                          fontSize: '12.5px',
                          fontWeight: active ? 600 : 400,
                          borderLeft: active
                            ? '2px solid var(--accent)'
                            : '2px solid transparent',
                          marginLeft: active ? '-2px' : '0',
                        }}
                        onMouseEnter={(e) => {
                          if (!active) {
                            e.currentTarget.style.color = 'var(--fg)'
                            e.currentTarget.style.background = 'var(--bg-1)'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!active) {
                            e.currentTarget.style.color = 'var(--fg-3)'
                            e.currentTarget.style.background = 'transparent'
                          }
                        }}
                      >
                        {a.title}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </nav>
  )
}

// ─── Sticky ToC (правая колонка) ───
function StickyToc({ toc, activeId }) {
  if (!toc.length) return null
  return (
    <aside className="hidden xl:block">
      <div
        className="sticky top-6 pl-2"
        style={{ maxHeight: 'calc(100vh - 3rem)', overflowY: 'auto' }}
      >
        <div
          className="text-[10.5px] uppercase tracking-[0.08em] font-semibold mb-3"
          style={{ color: 'var(--fg-4)' }}
        >
          На этой странице
        </div>
        <ul
          className="space-y-0.5 border-l"
          style={{ borderColor: 'var(--border)' }}
        >
          {toc.map((t) => {
            const active = t.id === activeId
            return (
              <li key={t.id}>
                <a
                  href={`#${t.id}`}
                  className="block leading-snug transition-all"
                  style={{
                    paddingLeft: t.level === 3 ? '20px' : '12px',
                    paddingRight: '8px',
                    paddingTop: '4px',
                    paddingBottom: '4px',
                    fontSize: t.level === 3 ? '12px' : '12.5px',
                    color: active ? 'var(--accent)' : 'var(--fg-3)',
                    fontWeight: active ? 600 : 400,
                    borderLeft: active
                      ? '2px solid var(--accent)'
                      : '2px solid transparent',
                    marginLeft: '-1px',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.color = 'var(--fg)'
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.color = 'var(--fg-3)'
                  }}
                >
                  {t.text}
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    </aside>
  )
}

export default function WikiArticle() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [feedback, setFb] = useState(null)
  const [activeTocId, setActiveTocId] = useState('')
  const [sidebarFilter, setSidebarFilter] = useState('')
  const articleRef = useRef(null)

  const rawMd = getMarkdown(slug)
  const { body: md, meta: fm } = useMemo(() => parseFrontmatter(rawMd), [rawMd])
  const meta = indexData.find((a) => a.slug === slug)
  const toc = useMemo(() => extractToc(md), [md])
  const categoryMeta = CATEGORIES.find((c) => c.id === meta?.category)
  const minutes = useMemo(() => readingTime(md), [md])

  // ─── Группированный список для prev/next в той же категории ───
  const grouped = useMemo(() => {
    const g = {}
    for (const a of indexData) {
      const cat = a.category || categoryFromSlug(a.slug)
      if (!g[cat]) g[cat] = []
      g[cat].push(a)
    }
    Object.values(g).forEach((arr) =>
      arr.sort((a, b) => (a.order || 99) - (b.order || 99))
    )
    return g
  }, [])

  const { prev, next, related } = useMemo(() => {
    if (!meta) return { prev: null, next: null, related: [] }
    const peers = grouped[meta.category] || []
    const idx = peers.findIndex((a) => a.slug === meta.slug)
    const prev = idx > 0 ? peers[idx - 1] : null
    const next = idx >= 0 && idx < peers.length - 1 ? peers[idx + 1] : null
    const related = peers.filter((a) => a.slug !== meta.slug).slice(0, 3)
    return { prev, next, related }
  }, [meta, grouped])

  // ─── Load feedback ───
  useEffect(() => {
    setFb(getFeedback(slug))
  }, [slug])

  // ─── Scroll on slug/hash change ───
  useEffect(() => {
    if (window.location.hash) {
      const el = document.getElementById(window.location.hash.slice(1))
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      window.scrollTo(0, 0)
    }
  }, [slug])

  // ─── Close drawer ───
  useEffect(() => {
    setDrawerOpen(false)
  }, [slug])

  // ─── IntersectionObserver для ToC ───
  useEffect(() => {
    if (!toc.length) return
    const elements = toc
      .map((t) => document.getElementById(t.id))
      .filter(Boolean)
    if (!elements.length) return

    const visibleIds = new Set()
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visibleIds.add(entry.target.id)
          else visibleIds.delete(entry.target.id)
        })
        // Выбираем первый видимый из toc (по порядку)
        const firstVisible = toc.find((t) => visibleIds.has(t.id))
        if (firstVisible) {
          setActiveTocId(firstVisible.id)
        } else {
          // Если ничего не видно — fallback: ближайший к топу выше окна
          let above = ''
          for (const t of toc) {
            const el = document.getElementById(t.id)
            if (el && el.getBoundingClientRect().top < 120) above = t.id
            else break
          }
          if (above) setActiveTocId(above)
        }
      },
      { rootMargin: '-100px 0px -60% 0px', threshold: [0, 1] }
    )
    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [toc, slug])

  // ─── Keyboard: ←/→ для prev/next ───
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.altKey && e.key === 'ArrowLeft' && prev) {
        e.preventDefault()
        navigate(`/wiki/${prev.slug}`)
      } else if (e.altKey && e.key === 'ArrowRight' && next) {
        e.preventDefault()
        navigate(`/wiki/${next.slug}`)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [prev, next, navigate])

  if (!md || !meta) return <Navigate to="/wiki" replace />

  const handleVote = (value) => {
    const nextValue = feedback === value ? null : value
    setFb(nextValue)
    saveFeedback(slug, nextValue)
  }

  // ─── Markdown components ───
  const components = {
    h1: ({ node, children, ...p }) => (
      <h1
        className="font-semibold leading-[1.1] tracking-tight mb-5"
        style={{
          fontSize: 'clamp(28px, 3.5vw, 38px)',
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
          className="font-semibold mt-12 mb-4 scroll-mt-24 group"
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
          <a
            href={`#${id}`}
            className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--fg-4)', fontSize: '0.7em' }}
            aria-label="Ссылка на раздел"
          >
            #
          </a>
        </h2>
      )
    },
    h3: ({ node, children, ...p }) => {
      const text = String(Array.isArray(children) ? children.join('') : children)
      const id = slugifyHeading(text)
      return (
        <h3
          id={id}
          className="font-semibold mt-8 mb-3 scroll-mt-24"
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
        className="mb-5"
        style={{
          fontSize: '15.5px',
          color: 'var(--fg-2)',
          lineHeight: 1.75,
        }}
        {...p}
      >
        {children}
      </p>
    ),
    ul: ({ node, children, ...p }) => (
      <ul
        className="mb-5 ml-5 list-disc space-y-2"
        style={{
          color: 'var(--fg-2)',
          fontSize: '15.5px',
          lineHeight: 1.75,
        }}
        {...p}
      >
        {children}
      </ul>
    ),
    ol: ({ node, children, ...p }) => (
      <ol
        className="mb-5 ml-5 list-decimal space-y-2"
        style={{
          color: 'var(--fg-2)',
          fontSize: '15.5px',
          lineHeight: 1.75,
        }}
        {...p}
      >
        {children}
      </ol>
    ),
    li: ({ node, children, ...p }) => (
      <li style={{ lineHeight: 1.7 }} {...p}>
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
        className="my-6 pl-4 pr-3 py-3 rounded-r-lg"
        style={{
          borderLeft: '3px solid var(--accent)',
          background: 'var(--accent-soft)',
          color: 'var(--fg-2)',
          fontSize: '15px',
          lineHeight: 1.7,
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
              background: 'var(--bg-2, var(--bg-1))',
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
      // Dark code block (Notion/Linear style)
      return (
        <pre
          className="my-5 p-4 rounded-xl overflow-x-auto text-[13.5px] leading-[1.65]"
          style={{
            background: '#0F172A',
            color: '#E2E8F0',
            border: '1px solid #1E293B',
            fontFamily:
              'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
          }}
        >
          <code style={{ background: 'transparent', color: 'inherit' }} {...p}>
            {children}
          </code>
        </pre>
      )
    },
    table: ({ node, children, ...p }) => (
      <div
        className="my-6 overflow-x-auto rounded-xl"
        style={{ border: '1px solid var(--border)' }}
      >
        <table
          className="w-full text-sm wiki-table"
          style={{ borderCollapse: 'separate', borderSpacing: 0 }}
          {...p}
        >
          {children}
        </table>
      </div>
    ),
    thead: ({ node, children, ...p }) => (
      <thead className="wiki-thead" {...p}>
        {children}
      </thead>
    ),
    th: ({ node, children, ...p }) => (
      <th
        className="text-left px-3 py-2.5 font-semibold"
        style={{
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--border)',
          color: 'var(--fg)',
          fontSize: '13px',
          position: 'sticky',
          top: 0,
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
    hr: () => <hr className="my-10" style={{ borderColor: 'var(--border)' }} />,
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

  // ─── Last updated (frontmatter) ───
  const updated = fm.updated || fm.date || null
  // ─── GitHub edit link ───
  const ghUrl = `https://github.com/mr-khamzat/clinika/edit/main/frontend/src/wiki-content/${slug}.md`

  return (
    <Page>
      <style>{`
        .wiki-table tbody tr:nth-child(even) td {
          background: var(--bg-1);
        }
        .wiki-table tbody tr:hover td {
          background: var(--accent-soft);
        }
      `}</style>
      <div className="mx-auto max-w-[1440px] px-3 sm:px-5 py-4 sm:py-6">
        {/* ─── Mobile topbar ─── */}
        <div className="lg:hidden mb-3 flex items-center gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2"
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
            to={`/wiki?category=${meta.category}`}
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
            Назад
          </Link>
        </div>

        {/* ─── 3-col grid ─── */}
        <div className="grid gap-6 lg:gap-8 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_220px]">
          {/* ─── LEFT SIDEBAR ─── */}
          <aside className="hidden lg:block">
            <div
              className="sticky top-6 pr-2"
              style={{
                maxHeight: 'calc(100vh - 3rem)',
                overflowY: 'auto',
                scrollbarWidth: 'thin',
              }}
            >
              <SidebarTree
                activeSlug={slug}
                filter={sidebarFilter}
                setFilter={setSidebarFilter}
              />
            </div>
          </aside>

          {/* ─── MOBILE DRAWER ─── */}
          {drawerOpen && (
            <>
              <div
                onClick={() => setDrawerOpen(false)}
                className="fixed inset-0 z-40 lg:hidden"
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
                    className="material-symbols-outlined"
                    style={{ fontSize: '22px', color: 'var(--fg-3)' }}
                    aria-label="Закрыть"
                  >
                    close
                  </button>
                </div>
                <SidebarTree
                  activeSlug={slug}
                  filter={sidebarFilter}
                  setFilter={setSidebarFilter}
                  onNavigate={() => setDrawerOpen(false)}
                />
                {toc.length > 0 && (
                  <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--border)' }}>
                    <div
                      className="text-[10.5px] uppercase tracking-[0.08em] font-semibold mb-2"
                      style={{ color: 'var(--fg-4)' }}
                    >
                      На этой странице
                    </div>
                    <ul className="space-y-0.5 border-l" style={{ borderColor: 'var(--border)' }}>
                      {toc.map((t) => (
                        <li key={t.id}>
                          <a
                            href={`#${t.id}`}
                            onClick={() => setDrawerOpen(false)}
                            className="block leading-snug"
                            style={{
                              paddingLeft: t.level === 3 ? '20px' : '12px',
                              paddingRight: '8px',
                              paddingTop: '4px',
                              paddingBottom: '4px',
                              fontSize: '12.5px',
                              color: 'var(--fg-3)',
                            }}
                          >
                            {t.text}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </aside>
            </>
          )}

          {/* ─── ARTICLE BODY ─── */}
          <article ref={articleRef} className="min-w-0" style={{ maxWidth: '760px' }}>
            {/* ─── Sticky breadcrumbs ─── */}
            <div
              className="sticky top-0 z-20 -mx-3 sm:-mx-5 px-3 sm:px-5 pt-1 pb-3 mb-4"
              style={{
                background: 'linear-gradient(to bottom, var(--bg) 70%, transparent)',
              }}
            >
              <nav className="flex items-center gap-1.5 min-w-0 flex-wrap" aria-label="breadcrumbs">
                <Link
                  to="/wiki"
                  className="inline-flex items-center gap-1 transition-colors"
                  style={{ fontSize: '12.5px', color: 'var(--fg-3)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fg-3)')}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                    menu_book
                  </span>
                  База знаний
                </Link>
                <span style={{ color: 'var(--fg-4)' }}>/</span>
                <Link
                  to={`/wiki?category=${meta.category}`}
                  className="truncate transition-colors"
                  style={{ fontSize: '12.5px', color: 'var(--fg-3)', maxWidth: '180px' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fg-3)')}
                >
                  {categoryMeta?.title || meta.category}
                </Link>
                <span style={{ color: 'var(--fg-4)' }}>/</span>
                <span
                  className="truncate font-medium"
                  style={{ fontSize: '12.5px', color: 'var(--fg)', maxWidth: '320px' }}
                >
                  {meta.title}
                </span>
              </nav>
            </div>

            {/* ─── Метаданные хедера ─── */}
            <div className="mb-6 flex items-center gap-2 flex-wrap">
              {categoryMeta && (
                <Link
                  to={`/wiki?category=${meta.category}`}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
                  style={{
                    background: categoryMeta.accentSoft,
                    color: categoryMeta.accent,
                    fontSize: '11.5px',
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                    {categoryMeta.icon}
                  </span>
                  {categoryMeta.title}
                </Link>
              )}
              <span
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1"
                style={{
                  background: 'var(--bg-1)',
                  color: 'var(--fg-3)',
                  fontSize: '11.5px',
                  fontWeight: 500,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>
                  schedule
                </span>
                {minutes} мин чтения
              </span>
              {updated && (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1"
                  style={{
                    background: 'var(--bg-1)',
                    color: 'var(--fg-3)',
                    fontSize: '11.5px',
                    fontWeight: 500,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>
                    update
                  </span>
                  {updated}
                </span>
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

            {/* ─── Edit on GitHub ─── */}
            <div className="mt-10 flex items-center gap-3 flex-wrap">
              <a
                href={ghUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-colors"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--fg-3)',
                  fontSize: '12.5px',
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--fg)'
                  e.currentTarget.style.borderColor = 'var(--accent)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--fg-3)'
                  e.currentTarget.style.borderColor = 'var(--border)'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                  edit
                </span>
                Редактировать на GitHub
              </a>
            </div>

            {/* ─── Footer ─── */}
            <footer
              className="mt-10 pt-8"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              {/* ─── Полезно? ─── */}
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
                        feedback === 'up'
                          ? 'var(--good-soft, oklch(0.85 0.12 145 / 0.18))'
                          : 'var(--surface)',
                      border: `1px solid ${
                        feedback === 'up'
                          ? 'var(--good, oklch(0.65 0.16 145))'
                          : 'var(--border)'
                      }`,
                      color:
                        feedback === 'up'
                          ? 'var(--good, oklch(0.65 0.16 145))'
                          : 'var(--fg-2)',
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
                        feedback === 'down'
                          ? 'var(--bad-soft, oklch(0.85 0.14 25 / 0.18))'
                          : 'var(--surface)',
                      border: `1px solid ${
                        feedback === 'down'
                          ? 'var(--bad, oklch(0.65 0.18 25))'
                          : 'var(--border)'
                      }`,
                      color:
                        feedback === 'down'
                          ? 'var(--bad, oklch(0.65 0.18 25))'
                          : 'var(--fg-2)',
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

              {/* ─── Prev / Next ─── */}
              {(prev || next) && (
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  {prev ? (
                    <Link
                      to={`/wiki/${prev.slug}`}
                      className="group rounded-xl p-4 transition-all"
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor =
                          categoryMeta?.accent || 'var(--accent)'
                        e.currentTarget.style.transform = 'translateY(-1px)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border)'
                        e.currentTarget.style.transform = 'translateY(0)'
                      }}
                    >
                      <div
                        className="flex items-center gap-1 mb-1.5"
                        style={{ fontSize: '11.5px', color: 'var(--fg-4)' }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                          arrow_back
                        </span>
                        Предыдущая статья
                      </div>
                      <div
                        className="font-semibold leading-snug"
                        style={{ fontSize: '14px', color: 'var(--fg)' }}
                      >
                        {prev.title}
                      </div>
                    </Link>
                  ) : (
                    <div />
                  )}
                  {next ? (
                    <Link
                      to={`/wiki/${next.slug}`}
                      className="group rounded-xl p-4 transition-all text-right"
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor =
                          categoryMeta?.accent || 'var(--accent)'
                        e.currentTarget.style.transform = 'translateY(-1px)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border)'
                        e.currentTarget.style.transform = 'translateY(0)'
                      }}
                    >
                      <div
                        className="flex items-center gap-1 mb-1.5 justify-end"
                        style={{ fontSize: '11.5px', color: 'var(--fg-4)' }}
                      >
                        Следующая статья
                        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                          arrow_forward
                        </span>
                      </div>
                      <div
                        className="font-semibold leading-snug"
                        style={{ fontSize: '14px', color: 'var(--fg)' }}
                      >
                        {next.title}
                      </div>
                    </Link>
                  ) : (
                    <div />
                  )}
                </div>
              )}

              {/* ─── Связанные ─── */}
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
                          e.currentTarget.style.borderColor =
                            categoryMeta?.accent || 'var(--accent)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'var(--border)'
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
            </footer>
          </article>

          {/* ─── RIGHT TOC ─── */}
          <StickyToc toc={toc} activeId={activeTocId} />
        </div>
      </div>
    </Page>
  )
}
