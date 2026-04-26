import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

// ── Markdown renderer (идентичен WikiSection) ─────────────────────────────────
function renderMd(raw) {
  if (!raw) return ''
  let t = raw
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  t = t.replace(/```(\w*)\n?([\s\S]*?)```/g,
    (_, lang, code) =>
      `<pre class="bg-gray-900 text-green-300 rounded-2xl p-4 overflow-x-auto text-sm my-4 leading-relaxed"><code>${code.trim()}</code></pre>`)

  t = t.replace(/`([^`\n]+)`/g,
    '<code class="bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded-lg text-[13px] font-mono">$1</code>')

  t = t.replace(/^#### (.+)$/gm, '<h4 class="text-base font-bold text-gray-700 mt-5 mb-1">$1</h4>')
  t = t.replace(/^### (.+)$/gm, '<h3 class="text-lg font-bold text-gray-800 mt-6 mb-2">$1</h3>')
  t = t.replace(/^## (.+)$/gm,
    '<h2 class="text-xl font-extrabold text-gray-900 mt-8 mb-3 pb-2 border-b-2 border-teal-100">$1</h2>')
  t = t.replace(/^# (.+)$/gm,
    '<h1 class="text-3xl font-extrabold text-gray-900 mt-4 mb-5">$1</h1>')

  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-gray-900">$1</strong>')
  t = t.replace(/\*(.+?)\*/g, '<em class="italic text-gray-700">$1</em>')

  t = t.replace(/^&gt; (.+)$/gm,
    '<blockquote class="border-l-4 border-teal-400 pl-4 py-1 my-3 bg-teal-50 rounded-r-xl text-gray-600 italic">$1</blockquote>')

  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" class="max-w-full rounded-2xl my-4 shadow-md border border-gray-100 cursor-zoom-in" onclick="this.classList.toggle(\'max-w-full\');this.classList.toggle(\'w-full\')" />')

  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="text-teal-600 font-medium hover:underline" target="_blank" rel="noopener">$1</a>')

  t = t.replace(/(\|.+\|\n?)+/g, (block) => {
    const rows = block.trim().split('\n').filter(r => r.trim())
    let html = '<div class="overflow-x-auto my-4 rounded-2xl border border-gray-200 shadow-sm"><table class="w-full text-sm border-collapse">'
    rows.forEach((row, i) => {
      if (/^\|[-| :]+\|$/.test(row.trim())) return
      const cells = row.split('|').filter((_, ci, a) => ci > 0 && ci < a.length - 1)
      if (i === 0) {
        html += '<thead class="bg-gradient-to-r from-teal-500 to-blue-600 text-white"><tr>'
        cells.forEach(c => { html += `<th class="px-4 py-3 text-left font-semibold text-sm">${c.trim()}</th>` })
        html += '</tr></thead><tbody>'
      } else {
        html += `<tr class="${i % 2 === 0 ? 'bg-gray-50' : 'bg-white'} hover:bg-teal-50/50 transition-colors">`
        cells.forEach(c => { html += `<td class="px-4 py-2.5 border-b border-gray-100 text-gray-700">${c.trim()}</td>` })
        html += '</tr>'
      }
    })
    html += '</tbody></table></div>'
    return html
  })

  t = t.replace(/^\d+\. (.+)$/gm, '<li class="ml-5 list-decimal text-gray-700 my-0.5 leading-relaxed">$1</li>')
  t = t.replace(/^- (.+)$/gm, '<li class="ml-5 list-disc text-gray-700 my-0.5 leading-relaxed">$1</li>')
  t = t.replace(/((<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="my-3 space-y-0.5">$1</ul>')

  t = t.replace(/^---$/gm,
    '<hr class="my-6 border-0 h-px bg-gradient-to-r from-teal-200 via-blue-200 to-transparent" />')

  t = t.split('\n\n').map(block => {
    block = block.trim()
    if (!block) return ''
    if (/^<(h[1-6]|ul|ol|li|pre|blockquote|div|hr|table|img)/.test(block)) return block
    return `<p class="text-gray-700 leading-relaxed my-2">${block.replace(/\n/g, '<br />')}</p>`
  }).join('\n')

  return t
}

export default function WikiViewer({ token, user, onClose }) {
  const [pages, setPages] = useState([])
  const [current, setCurrent] = useState(null)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [sideOpen, setSideOpen] = useState(false)
  const isSuperAdmin = user?.role === 'super_admin' || user?.is_superadmin

  const hdr = { headers: { Authorization: `Bearer ${token}` } }

  const loadPages = useCallback(async () => {
    try {
      const endpoint = isSuperAdmin ? '/wiki/pages/all' : '/wiki/pages'
      const r = await axios.get(API_BASE + endpoint, hdr)
      setPages(r.data)
      if (r.data.length > 0 && !current) setCurrent(r.data[0])
    } catch { setPages([]) }
  }, [token])

  useEffect(() => { loadPages() }, [loadPages])

  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return }
    const q = search.toLowerCase()
    setSearchResults(pages.filter(p =>
      p.title.toLowerCase().includes(q) || p.content_md?.toLowerCase().includes(q)
    ))
  }, [search, pages])

  const rootPages = pages.filter(p => !p.parent_id)
  const childPages = (pid) => pages.filter(p => p.parent_id === pid)

  // Breadcrumb
  const breadcrumb = []
  if (current) {
    breadcrumb.push(current)
    if (current.parent_id) {
      const parent = pages.find(p => p.id === current.parent_id)
      if (parent) breadcrumb.unshift(parent)
    }
  }

  const Sidebar = () => (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)' }}>
            <span className="material-symbols-outlined text-white text-base" style={{ fontVariationSettings:"'FILL' 1" }}>auto_stories</span>
          </div>
          <div>
            <p className="text-sm font-bold text-gray-800">Документация</p>
            <p className="text-[10px] text-gray-400">КлиникаСеть Wiki</p>
          </div>
        </div>
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">search</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по документации..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-xl focus:outline-none focus:border-teal-400 bg-gray-50"
          />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {searchResults ? (
          <>
            <p className="text-[10px] text-gray-400 px-2 pb-1">{searchResults.length} результатов</p>
            {searchResults.map(p => (
              <NavItem key={p.id} page={p} current={current} onSelect={(pg) => { setCurrent(pg); setSearch(''); setSearchResults(null); setSideOpen(false) }} />
            ))}
          </>
        ) : (
          rootPages.map(p => (
            <div key={p.id}>
              <NavItem page={p} current={current} onSelect={(pg) => { setCurrent(pg); setSideOpen(false) }} />
              {childPages(p.id).map(child => (
                <div key={child.id} className="ml-4 mt-0.5">
                  <NavItem page={child} current={current} onSelect={(pg) => { setCurrent(pg); setSideOpen(false) }} />
                </div>
              ))}
            </div>
          ))
        )}
      </nav>

      {onClose && (
        <div className="p-3 border-t border-gray-100">
          <button onClick={onClose}
            className="w-full flex items-center justify-center gap-2 py-2 text-xs text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-50 transition">
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            Вернуться
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex h-[calc(100vh-72px)] bg-gray-50 rounded-2xl overflow-hidden border border-gray-100 shadow-sm">

      {/* Sidebar desktop */}
      <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 bg-white border-r border-gray-100">
        <Sidebar />
      </aside>

      {/* Sidebar mobile overlay */}
      {sideOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setSideOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-2xl lg:hidden flex flex-col">
            <Sidebar />
          </aside>
        </>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <header className="h-14 bg-white border-b border-gray-100 flex items-center px-4 gap-3 flex-shrink-0">
          <button className="lg:hidden p-1.5 rounded-xl hover:bg-gray-100 transition"
            onClick={() => setSideOpen(true)}>
            <span className="material-symbols-outlined text-gray-600">menu</span>
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-sm min-w-0 flex-1">
            <span className="material-symbols-outlined text-gray-300 text-base">home</span>
            {breadcrumb.map((p, i) => (
              <span key={p.id} className="flex items-center gap-1.5 min-w-0">
                {i > 0 && <span className="material-symbols-outlined text-gray-300 text-sm">chevron_right</span>}
                <button onClick={() => setCurrent(p)}
                  className={`truncate transition ${i === breadcrumb.length - 1 ? 'text-gray-800 font-semibold' : 'text-gray-400 hover:text-teal-600'}`}>
                  {p.title}
                </button>
              </span>
            ))}
          </div>

          {current && !current.is_published && (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full flex-shrink-0">Черновик</span>
          )}
          {current && (
            <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:block">
              {current.updated_at ? new Date(current.updated_at).toLocaleDateString('ru-RU') : ''}
            </span>
          )}
        </header>

        {/* Article */}
        <main className="flex-1 overflow-y-auto">
          {current ? (
            <div className="max-w-3xl mx-auto px-6 py-8">

              {/* Page header */}
              <div className="flex items-start gap-4 mb-8">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm"
                  style={{ background: 'linear-gradient(135deg,rgba(0,151,167,.15),rgba(21,101,192,.15))' }}>
                  <span className="material-symbols-outlined text-3xl text-teal-600"
                    style={{ fontVariationSettings:"'FILL' 1" }}>{current.icon || 'article'}</span>
                </div>
                <div className="min-w-0">
                  <h1 className="text-3xl font-extrabold text-gray-900 leading-tight">{current.title}</h1>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">schedule</span>
                      Обновлено {current.updated_at ? new Date(current.updated_at).toLocaleDateString('ru-RU', { day:'2-digit', month:'long', year:'numeric' }) : '—'}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">link</span>
                      <span className="font-mono">{current.slug}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="wiki-content"
                dangerouslySetInnerHTML={{ __html: renderMd(current.content_md) }} />

              {/* Child pages */}
              {(() => {
                const children = pages.filter(p => p.parent_id === current.id)
                if (!children.length) return null
                return (
                  <div className="mt-10 pt-6 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">В этом разделе</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {children.map(child => (
                        <button key={child.id} onClick={() => setCurrent(child)}
                          className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-gray-100 hover:border-teal-200 hover:shadow-md text-left transition group">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                            style={{ background: 'linear-gradient(135deg,rgba(0,151,167,.1),rgba(21,101,192,.1))' }}>
                            <span className="material-symbols-outlined text-teal-600 text-base"
                              style={{ fontVariationSettings:"'FILL' 1" }}>{child.icon || 'article'}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-teal-700 transition">{child.title}</p>
                          </div>
                          <span className="material-symbols-outlined text-gray-300 text-sm group-hover:text-teal-400 transition">arrow_forward</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* Navigation */}
              <div className="flex justify-between mt-10 pt-6 border-t border-gray-100">
                {(() => {
                  const flat = [...pages].sort((a,b) => (a.sort_order||0) - (b.sort_order||0))
                  const idx = flat.findIndex(p => p.id === current.id)
                  const prev = idx > 0 ? flat[idx-1] : null
                  const next = idx < flat.length-1 ? flat[idx+1] : null
                  return (
                    <>
                      {prev ? (
                        <button onClick={() => setCurrent(prev)}
                          className="flex items-center gap-2 text-sm text-gray-500 hover:text-teal-600 transition">
                          <span className="material-symbols-outlined text-base">arrow_back</span>
                          <span className="max-w-[180px] truncate">{prev.title}</span>
                        </button>
                      ) : <span />}
                      {next ? (
                        <button onClick={() => setCurrent(next)}
                          className="flex items-center gap-2 text-sm text-gray-500 hover:text-teal-600 transition ml-auto">
                          <span className="max-w-[180px] truncate">{next.title}</span>
                          <span className="material-symbols-outlined text-base">arrow_forward</span>
                        </button>
                      ) : null}
                    </>
                  )
                })()}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <span className="material-symbols-outlined text-5xl text-gray-200 block mb-3" style={{ fontVariationSettings:"'FILL' 1" }}>auto_stories</span>
                <p className="text-gray-400 text-sm">Выберите раздел в меню слева</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function NavItem({ page, current, onSelect }) {
  const isActive = current?.id === page.id
  return (
    <button onClick={() => onSelect(page)}
      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-sm transition-all text-left ${
        isActive
          ? 'bg-gradient-to-r from-teal-50 to-blue-50 text-teal-700 font-semibold'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
      }`}>
      <span className="material-symbols-outlined text-base flex-shrink-0"
        style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0", color: isActive ? '#0097A7' : '#9CA3AF' }}>
        {page.icon || 'article'}
      </span>
      <span className="flex-1 min-w-0 truncate">{page.title}</span>
      {!page.is_published && (
        <span className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />
      )}
    </button>
  )
}
