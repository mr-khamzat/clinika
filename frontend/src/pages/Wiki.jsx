/**
 * ========================================
 * БЛОК: <Wiki> — портал документации «КлиникСеть» (Notion/Linear-style)
 * ========================================
 * Premium-UI редизайн: 3-колоночный layout.
 *   ┌──────────┬──────────────────────────┬──────────┐
 *   │ Sidebar  │   Content (cards/list)   │   ToC    │
 *   │  280px   │          1fr             │   240px  │
 *   └──────────┴──────────────────────────┴──────────┘
 *
 * Левая колонка (sidebar-tree):
 *   - Группы статей по префиксам slug: chapter-N-* → Главы; concepts-* → Концепты;
 *     dev-* → Для разработчиков; role-* → Роли; setup-* → Настройка;
 *     api-* → API; module-* → Модули; intro-* → Введение; остальные → Дополнительно.
 *   - Раскрывающиеся секции (chevron).
 *   - Поиск-фильтр по заголовкам.
 *   - Highlight активной статьи (но на /wiki активной нет — подсветка категории).
 *
 * Центральная колонка:
 *   - Sticky breadcrumbs «База знаний / Глава X / …»
 *   - Поиск-input (Cmd+K / Ctrl+K глобально → открывает модал поиска)
 *   - Главная: hero + premium-карточки категорий + популярные статьи
 *   - Категория: список карточек статей
 *
 * Правая колонка (ToC):
 *   - На /wiki: «Структура» — список категорий с anchor-jump к секциям.
 *
 * Cmd+K:
 *   - Глобально открывает overlay-модал поиска (fuzzy по title + 200 chars body).
 *   - Esc — закрыть; ↑↓ — навигация; Enter — открыть статью.
 *
 * Маршруты:
 *   /wiki                   → главная
 *   /wiki?category=role     → категория
 *
 * Доступ: публичный.
 * ========================================
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { Page } from '../design'
import indexData from '../wiki-content/_index.json'

// ─── Сырые .md для контентного поиска ───
const rawFiles = import.meta.glob('../wiki-content/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// ─── Метаданные категорий ───
const CATEGORIES = [
  {
    id: 'intro',
    title: 'Введение',
    description: 'О платформе, архитектура, глоссарий.',
    icon: 'menu_book',
    accent: 'oklch(0.58 0.18 280)',
    accentSoft: 'oklch(0.58 0.18 280 / 0.10)',
  },
  {
    id: 'role',
    title: 'Роли',
    description: 'Кабинеты для каждой роли в системе.',
    icon: 'groups',
    accent: 'oklch(0.55 0.16 240)',
    accentSoft: 'oklch(0.55 0.16 240 / 0.10)',
  },
  {
    id: 'chapters',
    title: 'Главы продукта',
    description: 'Главы 1-10: платформа, онбординг, аналитика, кабинеты, AI.',
    icon: 'auto_awesome',
    accent: 'oklch(0.55 0.18 320)',
    accentSoft: 'oklch(0.55 0.18 320 / 0.10)',
  },
  {
    id: 'concepts',
    title: 'Концепты',
    description: 'Ключевые механизмы платформы.',
    icon: 'auto_stories',
    accent: 'oklch(0.55 0.15 150)',
    accentSoft: 'oklch(0.55 0.15 150 / 0.10)',
  },
  {
    id: 'setup',
    title: 'Настройка',
    description: 'Пошаговые инструкции по запуску клиники.',
    icon: 'tune',
    accent: 'oklch(0.62 0.13 75)',
    accentSoft: 'oklch(0.62 0.13 75 / 0.12)',
  },
  {
    id: 'api',
    title: 'API',
    description: 'REST API: аутентификация, endpoints, примеры.',
    icon: 'code',
    accent: 'oklch(0.58 0.13 200)',
    accentSoft: 'oklch(0.58 0.13 200 / 0.10)',
  },
  {
    id: 'modules',
    title: 'Модули',
    description: 'Каталог платных модулей платформы.',
    icon: 'apps',
    accent: 'oklch(0.62 0.16 50)',
    accentSoft: 'oklch(0.62 0.16 50 / 0.10)',
  },
  {
    id: 'dev',
    title: 'Для разработчиков',
    description: 'Технический стек, архитектура, API.',
    icon: 'terminal',
    accent: 'oklch(0.5 0.08 260)',
    accentSoft: 'oklch(0.5 0.08 260 / 0.10)',
  },
  {
    id: 'faq',
    title: 'FAQ',
    description: 'Частые вопросы по платформе.',
    icon: 'help',
    accent: 'oklch(0.62 0.13 100)',
    accentSoft: 'oklch(0.62 0.13 100 / 0.12)',
  },
  {
    id: 'changelog',
    title: 'Changelog',
    description: 'История изменений платформы.',
    icon: 'history',
    accent: 'oklch(0.58 0.10 30)',
    accentSoft: 'oklch(0.58 0.10 30 / 0.10)',
  },
]

// ─── Иконки конкретных статей ───
const ARTICLE_ICONS = {
  'intro-about': 'home',
  'intro-architecture': 'architecture',
  'intro-glossary': 'menu_book',
  'role-super-admin': 'admin_panel_settings',
  'role-franchise-owner': 'workspace_premium',
  'role-manager': 'manage_accounts',
  'role-doctor': 'stethoscope',
  'role-reg': 'support_agent',
  'role-nurse': 'vaccines',
  'role-recruiter': 'person_search',
  'role-partner-doctor': 'handshake',
  'role-visiting-doctor': 'directions_car',
  'role-acquisition-manager': 'campaign',
  'role-patient': 'person',
  'chapter-1-platform': 'looks_one',
  'chapter-2-onboarding': 'looks_two',
  'chapter-3-franchise-analytics': 'looks_3',
  'chapter-4-manager': 'looks_4',
  'chapter-5-reg': 'looks_5',
  'chapter-6-doctor-ai': 'looks_6',
  'chapter-7-regulations': 'gavel',
  'chapter-8-patient-family': 'family_restroom',
  'chapter-9-health-plus': 'favorite',
  'chapter-10-integrations': 'hub',
  'concepts-bonuses': 'paid',
  'concepts-referrals': 'share',
  'concepts-appointments': 'event',
  'concepts-qr': 'qr_code_scanner',
  'concepts-modules': 'apps',
  'concepts-medcard': 'medical_information',
  'concepts-security': 'security',
  'concepts-billing': 'receipt_long',
  'concepts-monitoring': 'monitor_heart',
  'concepts-multi-tenancy': 'workspaces',
  'concepts-region-lock': 'lock',
  'concepts-backup': 'backup',
  'setup-first-clinic': 'rocket_launch',
  'setup-staff': 'group_add',
  'setup-mis': 'cloud_sync',
  'setup-modules': 'apps',
  'setup-payments': 'payments',
  'setup-yookassa': 'credit_card',
  'setup-smtp': 'mail',
  'setup-telegram': 'send',
  'setup-lab': 'science',
  'api-reference': 'integration_instructions',
  'api-auth-detailed': 'vpn_key',
  faq: 'help',
  changelog: 'history',
}

// ─── Группировка по префиксу slug ───
// Это резерв для статей, у которых category в индексе пустой/неверный.
// Сейчас category из _index.json приоритетнее, мы её и используем.
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

// ─── Популярные статьи ───
const POPULAR_SLUGS = [
  'intro-about',
  'chapter-1-platform',
  'role-manager',
  'role-doctor',
  'api-reference',
]

// ─── Подсветка совпадения в строке ───
function highlight(text, q) {
  if (!q) return text
  const lower = String(text).toLowerCase()
  const ql = q.toLowerCase()
  const idx = lower.indexOf(ql)
  if (idx < 0) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark
        style={{
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          padding: '0 2px',
          borderRadius: '3px',
          fontWeight: 600,
        }}
      >
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  )
}

// ─── Sidebar-tree (левая колонка) ───
function SidebarTree({ activeCategory, onPickCategory, filter, setFilter }) {
  const [expanded, setExpanded] = useState(() => {
    // По умолчанию: открыта активная категория или первые 3
    const init = {}
    CATEGORIES.forEach((c, i) => {
      init[c.id] = activeCategory ? c.id === activeCategory : i < 3
    })
    return init
  })

  // Группировка по category из _index.json
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

  const f = filter.trim().toLowerCase()
  const matchesFilter = (a) => !f || a.title.toLowerCase().includes(f)

  return (
    <nav className="space-y-1">
      {/* ─── Поиск-фильтр sidebar ─── */}
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
          className="w-full rounded-lg pl-9 pr-3 py-2 transition-all"
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

      {/* ─── Главная (root link) ─── */}
      <Link
        to="/wiki"
        onClick={() => onPickCategory?.(null)}
        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
        style={{
          background: !activeCategory ? 'var(--accent-soft)' : 'transparent',
          color: !activeCategory ? 'var(--accent)' : 'var(--fg-2)',
          fontSize: '13px',
          fontWeight: !activeCategory ? 600 : 500,
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: '17px',
            fontVariationSettings: !activeCategory ? "'FILL' 1" : "'FILL' 0",
          }}
        >
          home
        </span>
        Главная
      </Link>

      <div className="h-2" />

      {/* ─── Категории + статьи ─── */}
      {CATEGORIES.map((cat) => {
        const articles = (grouped[cat.id] || []).filter(matchesFilter)
        if (f && articles.length === 0) return null
        const open = expanded[cat.id] || !!f
        return (
          <div key={cat.id}>
            <div className="flex items-stretch group">
              <button
                onClick={() =>
                  setExpanded((s) => ({ ...s, [cat.id]: !s[cat.id] }))
                }
                className="flex items-center justify-center w-6 rounded-md transition-colors"
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
                onClick={() => onPickCategory?.(cat.id)}
                className="flex-1 flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors min-w-0"
                style={{
                  background:
                    activeCategory === cat.id ? 'var(--accent-soft)' : 'transparent',
                  color:
                    activeCategory === cat.id ? 'var(--accent)' : 'var(--fg-2)',
                  fontSize: '13px',
                  fontWeight: activeCategory === cat.id ? 600 : 500,
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
                  {articles.length || (grouped[cat.id] || []).length}
                </span>
              </Link>
            </div>
            {open && articles.length > 0 && (
              <ul className="ml-6 mt-0.5 mb-1 space-y-0.5 border-l" style={{ borderColor: 'var(--border)' }}>
                {articles.map((a) => (
                  <li key={a.slug}>
                    <Link
                      to={`/wiki/${a.slug}`}
                      className="block rounded-md px-2.5 py-1 leading-snug transition-colors ml-1"
                      style={{
                        color: 'var(--fg-3)',
                        fontSize: '12.5px',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'var(--fg)'
                        e.currentTarget.style.background = 'var(--bg-1)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'var(--fg-3)'
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      {highlight(a.title, filter)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </nav>
  )
}

// ─── Cmd+K модал поиска ───
function CommandPalette({ open, onClose }) {
  const [q, setQ] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const navigate = useNavigate()
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) {
      // Без запроса показываем популярные
      return POPULAR_SLUGS
        .map((s) => indexData.find((a) => a.slug === s))
        .filter(Boolean)
        .map((a) => ({ article: a, snippet: '' }))
    }
    const out = []
    for (const a of indexData) {
      let score = 0
      let snippet = ''
      const title = a.title.toLowerCase()
      const summary = (a.summary || '').toLowerCase()
      if (title.includes(query)) score += 10
      if (summary.includes(query)) score += 5
      const raw = rawFiles[`../wiki-content/${a.slug}.md`]
      if (raw) {
        const lower = raw.slice(0, 4000).toLowerCase()
        const idx = lower.indexOf(query)
        if (idx >= 0) {
          score += 2
          const start = Math.max(0, idx - 50)
          const end = Math.min(raw.length, idx + query.length + 80)
          snippet = raw
            .slice(start, end)
            .replace(/[#*`_>]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
          if (snippet.length > 140) snippet = snippet.slice(0, 140) + '…'
        }
      }
      if (score > 0) out.push({ article: a, snippet, score })
    }
    out.sort((a, b) => b.score - a.score)
    return out.slice(0, 12)
  }, [q])

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx((i) => Math.min(i + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const r = results[selectedIdx]
        if (r) {
          navigate(`/wiki/${r.article.slug}`)
          onClose()
        }
      }
    },
    [results, selectedIdx, navigate, onClose]
  )

  useEffect(() => {
    setSelectedIdx(0)
  }, [q])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4"
      style={{
        background: 'rgba(8, 12, 24, 0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        animation: 'wiki-fade-in 0.15s ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="w-full max-w-[640px] rounded-2xl overflow-hidden"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.05)',
        }}
      >
        {/* ─── Поиск-инпут ─── */}
        <div
          className="flex items-center gap-3 px-4 py-3.5"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: '20px', color: 'var(--fg-3)' }}
          >
            search
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по базе знаний…"
            className="flex-1 bg-transparent outline-none"
            style={{ fontSize: '15px', color: 'var(--fg)' }}
          />
          <kbd
            className="px-1.5 py-0.5 rounded font-mono"
            style={{
              background: 'var(--bg-1)',
              border: '1px solid var(--border)',
              color: 'var(--fg-4)',
              fontSize: '11px',
            }}
          >
            ESC
          </kbd>
        </div>

        {/* ─── Результаты ─── */}
        <div className="max-h-[60vh] overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <div
              className="px-4 py-10 text-center"
              style={{ color: 'var(--fg-4)', fontSize: '13.5px' }}
            >
              Ничего не найдено
            </div>
          ) : (
            <>
              {!q.trim() && (
                <div
                  className="px-4 pt-2 pb-1 text-[10.5px] uppercase tracking-[0.08em] font-semibold"
                  style={{ color: 'var(--fg-4)' }}
                >
                  Популярное
                </div>
              )}
              {results.map((r, i) => {
                const cat = CATEGORIES.find((c) => c.id === r.article.category)
                const active = i === selectedIdx
                return (
                  <Link
                    key={r.article.slug}
                    to={`/wiki/${r.article.slug}`}
                    onClick={onClose}
                    onMouseEnter={() => setSelectedIdx(i)}
                    className="flex items-start gap-3 px-4 py-2.5 transition-colors"
                    style={{
                      background: active ? 'var(--accent-soft)' : 'transparent',
                    }}
                  >
                    <span
                      className="material-symbols-outlined flex-shrink-0 mt-0.5"
                      style={{
                        fontSize: '20px',
                        color: cat?.accent || 'var(--accent)',
                        fontVariationSettings: "'FILL' 1",
                      }}
                    >
                      {ARTICLE_ICONS[r.article.slug] || 'article'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className="font-semibold leading-tight"
                        style={{
                          fontSize: '14px',
                          color: active ? 'var(--accent)' : 'var(--fg)',
                        }}
                      >
                        {highlight(r.article.title, q)}
                      </div>
                      {(r.snippet || r.article.summary) && (
                        <div
                          className="mt-0.5 leading-snug truncate"
                          style={{ fontSize: '12px', color: 'var(--fg-3)' }}
                        >
                          {r.snippet || r.article.summary}
                        </div>
                      )}
                    </div>
                    {active && (
                      <span
                        className="material-symbols-outlined flex-shrink-0"
                        style={{ fontSize: '16px', color: 'var(--accent)' }}
                      >
                        keyboard_return
                      </span>
                    )}
                  </Link>
                )
              })}
            </>
          )}
        </div>

        {/* ─── Подсказки клавиш ─── */}
        <div
          className="flex items-center gap-4 px-4 py-2"
          style={{
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-1)',
            fontSize: '11px',
            color: 'var(--fg-4)',
          }}
        >
          <span className="flex items-center gap-1">
            <kbd
              className="px-1 rounded font-mono"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              ↑↓
            </kbd>
            навигация
          </span>
          <span className="flex items-center gap-1">
            <kbd
              className="px-1 rounded font-mono"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              ↵
            </kbd>
            открыть
          </span>
          <span className="ml-auto">{results.length} результатов</span>
        </div>
      </div>
    </div>
  )
}

// ─── Premium-карточка категории ───
function CategoryCard({ cat, count }) {
  return (
    <Link
      to={`/wiki?category=${cat.id}`}
      className="group block rounded-2xl p-5 transition-all duration-200"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = cat.accent
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = `0 12px 32px -8px ${cat.accentSoft.replace(' / 0.10', ' / 0.25').replace(' / 0.12', ' / 0.28')}`
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* ─── Декоративный градиент ─── */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: '120px',
          height: '120px',
          background: `radial-gradient(circle at top right, ${cat.accentSoft}, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />
      <div className="relative flex items-start gap-4">
        <div
          className="flex items-center justify-center rounded-xl flex-shrink-0"
          style={{
            width: '44px',
            height: '44px',
            background: cat.accentSoft,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: '24px',
              color: cat.accent,
              fontVariationSettings: "'FILL' 1, 'wght' 500",
            }}
          >
            {cat.icon}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <h3
              className="font-semibold leading-tight tracking-tight"
              style={{
                fontSize: '15.5px',
                letterSpacing: '-0.01em',
                color: 'var(--fg)',
              }}
            >
              {cat.title}
            </h3>
            <span
              className="text-[11px] font-medium px-1.5 py-0.5 rounded"
              style={{
                background: 'var(--bg-1)',
                color: 'var(--fg-3)',
              }}
            >
              {count}
            </span>
          </div>
          <p
            className="leading-relaxed"
            style={{
              fontSize: '13px',
              color: 'var(--fg-3)',
              lineHeight: 1.55,
            }}
          >
            {cat.description}
          </p>
        </div>
      </div>
    </Link>
  )
}

// ─── Карточка статьи ───
function ArticleCard({ a, query }) {
  const cat = CATEGORIES.find((c) => c.id === a.category)
  return (
    <Link
      to={`/wiki/${a.slug}`}
      className="group block rounded-xl p-4 transition-all"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = cat?.accent || 'var(--accent)'
        e.currentTarget.style.boxShadow = 'var(--shadow-md, 0 4px 16px rgba(0,0,0,0.08))'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex items-center justify-center rounded-lg flex-shrink-0"
          style={{
            width: '36px',
            height: '36px',
            background: cat?.accentSoft || 'var(--accent-soft)',
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: '20px',
              color: cat?.accent || 'var(--accent)',
              fontVariationSettings: "'FILL' 1",
            }}
          >
            {ARTICLE_ICONS[a.slug] || 'article'}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h4
            className="font-semibold leading-tight"
            style={{ fontSize: '14.5px', color: 'var(--fg)' }}
          >
            {highlight(a.title, query)}
          </h4>
          {a.summary && (
            <p
              className="mt-1 leading-relaxed line-clamp-2"
              style={{ fontSize: '12.5px', color: 'var(--fg-3)' }}
            >
              {a.summary}
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}

// ─── Right-rail (структура страницы) ───
function RightRail() {
  return (
    <aside className="hidden xl:block">
      <div
        className="sticky top-6 space-y-5"
        style={{ maxHeight: 'calc(100vh - 3rem)', overflowY: 'auto' }}
      >
        <div>
          <div
            className="text-[10.5px] uppercase tracking-[0.08em] font-semibold mb-3"
            style={{ color: 'var(--fg-4)' }}
          >
            Структура
          </div>
          <ul className="space-y-1.5">
            {CATEGORIES.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/wiki?category=${c.id}`}
                  className="flex items-center gap-2 leading-snug transition-colors"
                  style={{
                    fontSize: '12.5px',
                    color: 'var(--fg-3)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fg-3)')}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: '14px',
                      color: c.accent,
                      opacity: 0.8,
                    }}
                  >
                    {c.icon}
                  </span>
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div
          className="rounded-xl p-4"
          style={{
            background: 'var(--bg-1)',
            border: '1px solid var(--border)',
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '16px', color: 'var(--accent)' }}
            >
              keyboard_command_key
            </span>
            <div
              className="font-semibold"
              style={{ fontSize: '12.5px', color: 'var(--fg)' }}
            >
              Быстрый поиск
            </div>
          </div>
          <p
            className="leading-snug mb-2"
            style={{ fontSize: '11.5px', color: 'var(--fg-3)' }}
          >
            Нажмите <kbd
              className="px-1 rounded font-mono"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                fontSize: '10px',
              }}
            >
              ⌘K
            </kbd> или <kbd
              className="px-1 rounded font-mono"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                fontSize: '10px',
              }}
            >
              Ctrl+K
            </kbd> чтобы открыть поиск.
          </p>
        </div>
      </div>
    </aside>
  )
}

// ─── Главный компонент ───
export default function Wiki() {
  const [params, setParams] = useSearchParams()
  const category = params.get('category')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarFilter, setSidebarFilter] = useState('')
  const [mobileDrawer, setMobileDrawer] = useState(false)

  // ─── Cmd+K / Ctrl+K ─── глобально открывает палитру ───
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ─── Скролл наверх при смене ──
  useEffect(() => {
    window.scrollTo(0, 0)
    setMobileDrawer(false)
  }, [category])

  // ─── Группировка ───
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

  const currentCategory = category ? CATEGORIES.find((c) => c.id === category) : null
  const categoryArticles = category ? grouped[category] || [] : []
  const popular = useMemo(
    () =>
      POPULAR_SLUGS.map((s) => indexData.find((a) => a.slug === s)).filter(Boolean),
    []
  )

  return (
    <Page>
      <style>{`
        @keyframes wiki-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="mx-auto max-w-[1440px] px-3 sm:px-5 py-4 sm:py-6">
        {/* ─── Mobile topbar ─── */}
        <div className="lg:hidden mb-3 flex items-center gap-2">
          <button
            onClick={() => setMobileDrawer(true)}
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
              menu
            </span>
            Разделы
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex-1 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-left"
            style={{
              background: 'var(--bg-1)',
              border: '1px solid var(--border)',
              color: 'var(--fg-3)',
              fontSize: '13.5px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
              search
            </span>
            Поиск…
          </button>
        </div>

        {/* ─── 3-колоночный grid ─── */}
        <div
          className="grid gap-6 lg:gap-8"
          style={{
            gridTemplateColumns: 'minmax(0, 1fr)',
          }}
        >
          <div
            className="grid gap-6 lg:gap-8 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_220px]"
          >
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
                  activeCategory={category}
                  filter={sidebarFilter}
                  setFilter={setSidebarFilter}
                />
              </div>
            </aside>

            {/* ─── MOBILE DRAWER ─── */}
            {mobileDrawer && (
              <>
                <div
                  onClick={() => setMobileDrawer(false)}
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
                      onClick={() => setMobileDrawer(false)}
                      className="material-symbols-outlined"
                      style={{ fontSize: '22px', color: 'var(--fg-3)' }}
                      aria-label="Закрыть"
                    >
                      close
                    </button>
                  </div>
                  <SidebarTree
                    activeCategory={category}
                    filter={sidebarFilter}
                    setFilter={setSidebarFilter}
                  />
                </aside>
              </>
            )}

            {/* ─── CENTER CONTENT ─── */}
            <main className="min-w-0">
              {/* ─── Sticky breadcrumbs + поиск ─── */}
              <div
                className="sticky top-0 z-20 -mx-3 sm:-mx-5 px-3 sm:px-5 pt-1 pb-4 mb-2"
                style={{
                  background: 'linear-gradient(to bottom, var(--bg) 70%, transparent)',
                }}
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  {/* Breadcrumbs */}
                  <nav className="flex items-center gap-1.5 min-w-0" aria-label="breadcrumbs">
                    <Link
                      to="/wiki"
                      onClick={() => setParams({})}
                      className="inline-flex items-center gap-1 transition-colors"
                      style={{ fontSize: '12.5px', color: 'var(--fg-3)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fg-3)')}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: '15px' }}
                      >
                        menu_book
                      </span>
                      База знаний
                    </Link>
                    {currentCategory && (
                      <>
                        <span style={{ color: 'var(--fg-4)' }}>/</span>
                        <span
                          className="truncate font-medium"
                          style={{ fontSize: '12.5px', color: 'var(--fg)' }}
                        >
                          {currentCategory.title}
                        </span>
                      </>
                    )}
                  </nav>

                  {/* Cmd+K кнопка */}
                  <button
                    onClick={() => setPaletteOpen(true)}
                    className="hidden md:inline-flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors"
                    style={{
                      background: 'var(--bg-1)',
                      border: '1px solid var(--border)',
                      color: 'var(--fg-3)',
                      fontSize: '12.5px',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent)'
                      e.currentTarget.style.color = 'var(--fg-2)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border)'
                      e.currentTarget.style.color = 'var(--fg-3)'
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                      search
                    </span>
                    <span>Поиск</span>
                    <kbd
                      className="px-1 rounded font-mono ml-2"
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        fontSize: '10px',
                        color: 'var(--fg-4)',
                      }}
                    >
                      ⌘K
                    </kbd>
                  </button>
                </div>
              </div>

              {/* ─── ГЛАВНАЯ ─── */}
              {!currentCategory ? (
                <>
                  {/* Hero */}
                  <section className="mb-10">
                    <div className="mb-2">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
                        style={{
                          background: 'var(--accent-soft)',
                          color: 'var(--accent)',
                          fontSize: '11.5px',
                          fontWeight: 600,
                          letterSpacing: '0.02em',
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>
                          star
                        </span>
                        КлиникСеть · Документация
                      </span>
                    </div>
                    <h1
                      className="font-semibold tracking-tight leading-[1.05]"
                      style={{
                        fontSize: 'clamp(32px, 4.5vw, 48px)',
                        letterSpacing: '-0.035em',
                        color: 'var(--fg)',
                      }}
                    >
                      База знаний
                    </h1>
                    <p
                      className="mt-3 leading-relaxed"
                      style={{
                        fontSize: '16px',
                        color: 'var(--fg-2)',
                        maxWidth: '640px',
                        lineHeight: 1.65,
                      }}
                    >
                      Полное руководство по платформе: от запуска первой клиники до интеграций
                      с лабораториями. {indexData.length} статей · 10 разделов.
                    </p>
                    {/* Большой search button */}
                    <button
                      onClick={() => setPaletteOpen(true)}
                      className="mt-6 w-full max-w-[520px] flex items-center gap-3 rounded-xl px-4 py-3.5 text-left transition-all"
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--accent)'
                        e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border)'
                        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: '22px', color: 'var(--fg-3)' }}
                      >
                        search
                      </span>
                      <span style={{ fontSize: '14.5px', color: 'var(--fg-3)' }}>
                        Поиск по всей документации…
                      </span>
                      <kbd
                        className="ml-auto px-1.5 py-0.5 rounded font-mono"
                        style={{
                          background: 'var(--bg-1)',
                          border: '1px solid var(--border)',
                          fontSize: '11px',
                          color: 'var(--fg-4)',
                        }}
                      >
                        ⌘K
                      </kbd>
                    </button>
                  </section>

                  {/* Categories grid */}
                  <section className="mb-12">
                    <h2
                      className="font-semibold tracking-tight mb-4"
                      style={{
                        fontSize: '20px',
                        letterSpacing: '-0.02em',
                        color: 'var(--fg)',
                      }}
                    >
                      Разделы
                    </h2>
                    <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
                      {CATEGORIES.map((cat) => (
                        <CategoryCard
                          key={cat.id}
                          cat={cat}
                          count={(grouped[cat.id] || []).length}
                        />
                      ))}
                    </div>
                  </section>

                  {/* Popular */}
                  <section className="mb-8">
                    <h2
                      className="font-semibold tracking-tight mb-4"
                      style={{
                        fontSize: '20px',
                        letterSpacing: '-0.02em',
                        color: 'var(--fg)',
                      }}
                    >
                      С чего начать
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {popular.map((a) => (
                        <ArticleCard key={a.slug} a={a} query="" />
                      ))}
                    </div>
                  </section>
                </>
              ) : (
                /* ─── КАТЕГОРИЯ ─── */
                <>
                  <header className="mb-7 flex items-start gap-4">
                    <div
                      className="flex items-center justify-center rounded-2xl flex-shrink-0"
                      style={{
                        width: '56px',
                        height: '56px',
                        background: currentCategory.accentSoft,
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: '30px',
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
                          fontSize: 'clamp(24px, 3vw, 32px)',
                          letterSpacing: '-0.025em',
                          color: 'var(--fg)',
                        }}
                      >
                        {currentCategory.title}
                      </h1>
                      <p
                        className="mt-2 leading-relaxed"
                        style={{
                          fontSize: '14.5px',
                          color: 'var(--fg-2)',
                          maxWidth: '640px',
                          lineHeight: 1.6,
                        }}
                      >
                        {currentCategory.description}
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full font-medium"
                          style={{
                            background: 'var(--bg-2, var(--bg-1))',
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

                  {categoryArticles.length === 0 ? (
                    <div
                      className="rounded-2xl p-10 text-center"
                      style={{
                        background: 'var(--surface)',
                        border: '1px dashed var(--border)',
                      }}
                    >
                      <p style={{ color: 'var(--fg-3)' }}>
                        В этой категории пока нет статей.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {categoryArticles.map((a) => (
                        <ArticleCard key={a.slug} a={a} query="" />
                      ))}
                    </div>
                  )}
                </>
              )}
            </main>

            {/* ─── RIGHT RAIL ─── */}
            <RightRail />
          </div>
        </div>
      </div>

      {/* ─── Cmd+K Palette ─── */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
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

// ─── Экспорт мета для WikiArticle ───
export { CATEGORIES, ARTICLE_ICONS }
