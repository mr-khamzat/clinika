/**
 * ========================================
 * БЛОК: <WikiArticle> — рендер одной статьи wiki
 * ========================================
 * Layout:
 *   - Левый sidebar с навигацией (на mobile — drawer через бургер)
 *   - Центр: markdown-контент (react-markdown + rehype-raw для HTML/iframe)
 *   - Правый TOC (≥1024px) — автогенерится из H2 заголовков
 * Безопасность:
 *   rehype-raw пропускает HTML — сейчас контент static (наш). Если в будущем wiki
 *   станет редактируемой через UI → ОБЯЗАТЕЛЬНО прогонять через DOMPurify.
 *   См. BACKLOG.md → раздел Wiki/DOMPurify.
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { Page, PageHeader, Card } from '../design'
import indexData from '../wiki-content/_index.json'

// ─── Сырые .md файлы ───
const rawFiles = import.meta.glob('../wiki-content/*.md', { query: '?raw', import: 'default', eager: true })

// ─── Категории для группировки в sidebar ───
const CATEGORY_LABELS = {
  role: 'Кабинеты по ролям',
  concepts: 'Концепции',
  setup: 'Настройка',
}

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

// ─── Извлечение H2 для TOC ───
function extractToc(md) {
  if (!md) return []
  const lines = md.split('\n')
  const toc = []
  let inFence = false
  for (const line of lines) {
    if (line.trim().startsWith('```')) { inFence = !inFence; continue }
    if (inFence) continue
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m) toc.push({ id: slugifyHeading(m[1]), text: m[1] })
  }
  return toc
}

export default function WikiArticle() {
  const { slug } = useParams()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // ─── Сама статья ───
  const md = getMarkdown(slug)
  const meta = indexData.find(a => a.slug === slug)
  const toc = useMemo(() => extractToc(md), [md])

  // ─── Сгруппированный sidebar ───
  const grouped = useMemo(() => {
    const groups = {}
    for (const a of indexData) {
      if (!groups[a.category]) groups[a.category] = []
      groups[a.category].push(a)
    }
    Object.values(groups).forEach(arr => arr.sort((a, b) => (a.order || 99) - (b.order || 99)))
    return groups
  }, [])

  // ─── Скролл к якорю при изменении hash ───
  useEffect(() => {
    if (window.location.hash) {
      const el = document.getElementById(window.location.hash.slice(1))
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      window.scrollTo(0, 0)
    }
  }, [slug])

  // ─── Закрытие drawer при переходе ───
  useEffect(() => { setDrawerOpen(false) }, [slug])

  if (!md || !meta) return <Navigate to="/wiki" replace />

  // ─── Кастом-рендереры markdown ───
  const components = {
    h1: ({ node, children, ...p }) => (
      <h1 className="font-semibold leading-tight tracking-tight mb-4" style={{ fontSize: '28px', letterSpacing: '-0.025em', color: 'var(--fg)' }} {...p}>{children}</h1>
    ),
    h2: ({ node, children, ...p }) => {
      const text = String(Array.isArray(children) ? children.join('') : children)
      const id = slugifyHeading(text)
      return (
        <h2 id={id} className="font-semibold mt-8 mb-3 scroll-mt-24" style={{ fontSize: '20px', letterSpacing: '-0.015em', color: 'var(--fg)', borderTop: '1px solid var(--border)', paddingTop: '20px' }} {...p}>{children}</h2>
      )
    },
    h3: ({ node, children, ...p }) => (
      <h3 className="font-semibold mt-5 mb-2" style={{ fontSize: '16px', color: 'var(--fg)' }} {...p}>{children}</h3>
    ),
    p: ({ node, children, ...p }) => (
      <p className="mb-3 leading-relaxed" style={{ fontSize: '15px', color: 'var(--fg-2)' }} {...p}>{children}</p>
    ),
    ul: ({ node, children, ...p }) => (
      <ul className="mb-3 ml-5 list-disc space-y-1.5" style={{ color: 'var(--fg-2)', fontSize: '15px' }} {...p}>{children}</ul>
    ),
    ol: ({ node, children, ...p }) => (
      <ol className="mb-3 ml-5 list-decimal space-y-1.5" style={{ color: 'var(--fg-2)', fontSize: '15px' }} {...p}>{children}</ol>
    ),
    li: ({ node, children, ...p }) => (
      <li className="leading-relaxed" {...p}>{children}</li>
    ),
    a: ({ node, href, children, ...p }) => {
      const isInternal = href && (href.startsWith('/') || href.startsWith('#'))
      if (isInternal && href.startsWith('/wiki')) {
        return <Link to={href} className="underline" style={{ color: 'var(--accent)' }}>{children}</Link>
      }
      return <a href={href} target={isInternal ? undefined : '_blank'} rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent)' }}>{children}</a>
    },
    blockquote: ({ node, children, ...p }) => (
      <blockquote className="my-4 pl-4 py-1 rounded-r" style={{ borderLeft: '3px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--fg-2)', fontSize: '14.5px' }} {...p}>{children}</blockquote>
    ),
    code: ({ node, inline, className, children, ...p }) => {
      if (inline) {
        return <code className="px-1.5 py-0.5 rounded text-[13.5px]" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', fontFamily: 'ui-monospace, monospace' }} {...p}>{children}</code>
      }
      return (
        <pre className="my-3 p-3 rounded-lg overflow-x-auto text-[13px]" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', fontFamily: 'ui-monospace, monospace' }}>
          <code {...p}>{children}</code>
        </pre>
      )
    },
    table: ({ node, children, ...p }) => (
      <div className="my-4 overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full text-sm" {...p}>{children}</table>
      </div>
    ),
    th: ({ node, children, ...p }) => (
      <th className="text-left px-3 py-2 font-semibold" style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)', color: 'var(--fg)', fontSize: '13px' }} {...p}>{children}</th>
    ),
    td: ({ node, children, ...p }) => (
      <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg-2)' }} {...p}>{children}</td>
    ),
    hr: () => <hr className="my-6" style={{ borderColor: 'var(--border)' }} />,
    iframe: ({ node, ...p }) => (
      <iframe
        {...p}
        loading="lazy"
        style={{ ...(p.style || {}), border: '1px solid var(--border)', borderRadius: '12px', maxWidth: '100%', display: 'block', marginTop: 16, marginBottom: 16 }}
      />
    ),
  }

  // ─── Sidebar контент (shared между desktop и mobile drawer) ───
  const SidebarContent = (
    <nav className="space-y-5">
      <Link
        to="/wiki"
        className="flex items-center gap-1.5 text-sm font-medium"
        style={{ color: 'var(--fg-2)' }}
      >
        <span className="material-symbols-rounded text-[18px]">menu_book</span>
        Все статьи
      </Link>
      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat}>
          <div className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--fg-4)' }}>
            {CATEGORY_LABELS[cat] || cat}
          </div>
          <ul className="space-y-0.5">
            {items.map(a => {
              const active = a.slug === slug
              return (
                <li key={a.slug}>
                  <Link
                    to={`/wiki/${a.slug}`}
                    className="block rounded-md px-2.5 py-1.5 text-[13.5px] leading-snug"
                    style={{
                      background: active ? 'var(--accent-soft)' : 'transparent',
                      color: active ? 'var(--accent)' : 'var(--fg-2)',
                      fontWeight: active ? 600 : 400,
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

  return (
    <Page>
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-4 sm:py-8">
        {/* ─── Topbar mobile ─── */}
        <div className="lg:hidden mb-4 flex items-center justify-between">
          <button
            onClick={() => setDrawerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--fg)' }}
          >
            <span className="material-symbols-rounded text-[18px]">menu</span>
            Разделы
          </button>
          <Link
            to="/wiki"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--fg-2)' }}
          >
            <span className="material-symbols-rounded text-[18px]">close</span>
            Закрыть
          </Link>
        </div>

        <div className="grid gap-6 lg:gap-8 lg:grid-cols-[240px_minmax(0,1fr)_220px]">
          {/* ─── Sidebar desktop ─── */}
          <aside className="hidden lg:block">
            <div className="sticky top-6">
              {SidebarContent}
            </div>
          </aside>

          {/* ─── Sidebar drawer mobile ─── */}
          {drawerOpen && (
            <>
              <div
                onClick={() => setDrawerOpen(false)}
                className="fixed inset-0 z-40 lg:hidden"
                style={{ background: 'rgba(0,0,0,0.4)' }}
              />
              <aside
                className="fixed left-0 top-0 bottom-0 z-50 w-[280px] overflow-y-auto p-5 lg:hidden"
                style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)' }}
              >
                <div className="flex items-center justify-between mb-5">
                  <div className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>Wiki</div>
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="material-symbols-rounded text-[22px]"
                    style={{ color: 'var(--fg-3)' }}
                    aria-label="Закрыть"
                  >close</button>
                </div>
                {SidebarContent}
              </aside>
            </>
          )}

          {/* ─── Контент статьи ─── */}
          <article className="min-w-0">
            <div className="mb-4 text-xs flex flex-wrap items-center gap-1.5" style={{ color: 'var(--fg-3)' }}>
              <Link to="/wiki" className="hover:underline">Wiki</Link>
              <span>›</span>
              <span>{CATEGORY_LABELS[meta.category] || meta.category}</span>
              <span>›</span>
              <span style={{ color: 'var(--fg-2)' }}>{meta.title}</span>
            </div>
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={components}
              >
                {md}
              </ReactMarkdown>
            </div>
          </article>

          {/* ─── TOC ─── */}
          <aside className="hidden lg:block">
            {toc.length > 0 && (
              <div className="sticky top-6">
                <div className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--fg-4)' }}>
                  Содержание
                </div>
                <ul className="space-y-1.5 border-l" style={{ borderColor: 'var(--border)' }}>
                  {toc.map(t => (
                    <li key={t.id}>
                      <a
                        href={`#${t.id}`}
                        className="block pl-3 text-[13px] leading-snug -ml-px hover:opacity-80"
                        style={{ color: 'var(--fg-3)' }}
                      >
                        {t.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </div>
    </Page>
  )
}
