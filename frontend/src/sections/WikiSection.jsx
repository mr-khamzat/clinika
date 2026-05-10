import { useState, useEffect, useRef, useCallback } from 'react'
import DOMPurify from 'dompurify'
import api from '../api'
import { useConfirm } from '../design'

// ── DOMPurify whitelist для wiki-контента ─────────────────────────────────────
// Разрешаем только теги/атрибуты, которые реально использует renderMd.
// ALLOWED_URI_REGEXP блокирует javascript:/data: в href/src.
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'a', 'img', 'hr',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'div', 'span',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel'],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/,
}

// ── Markdown renderer ─────────────────────────────────────────────────────────
function renderMd(raw) {
  if (!raw) return ''
  let t = raw
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // fenced code blocks
  t = t.replace(/```(\w*)\n?([\s\S]*?)```/g,
    (_, lang, code) =>
      `<pre class="bg-gray-900 text-green-300 rounded-2xl p-4 overflow-x-auto text-sm my-4 leading-relaxed"><code>${code.trim()}</code></pre>`)

  // inline code
  t = t.replace(/`([^`\n]+)`/g,
    '<code class="bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded-lg text-[13px] font-mono">$1</code>')

  // headers
  t = t.replace(/^#### (.+)$/gm, '<h4 class="text-base font-bold text-gray-700 mt-5 mb-1">$1</h4>')
  t = t.replace(/^### (.+)$/gm, '<h3 class="text-lg font-bold text-gray-800 mt-6 mb-2">$1</h3>')
  t = t.replace(/^## (.+)$/gm,
    '<h2 class="text-xl font-extrabold text-gray-900 mt-8 mb-3 pb-2 border-b-2 border-teal-100">$1</h2>')
  t = t.replace(/^# (.+)$/gm,
    '<h1 class="text-3xl font-extrabold text-gray-900 mt-6 mb-4">$1</h1>')

  // bold / italic
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-gray-900">$1</strong>')
  t = t.replace(/\*(.+?)\*/g, '<em class="italic text-gray-700">$1</em>')

  // blockquotes
  t = t.replace(/^&gt; (.+)$/gm,
    '<blockquote class="border-l-4 border-teal-400 pl-4 py-1 my-3 bg-teal-50 rounded-r-xl text-gray-600 italic">$1</blockquote>')

  // images
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" class="max-w-full rounded-2xl my-4 shadow-md border border-gray-100" />')

  // links
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="text-teal-600 font-medium hover:underline" target="_blank" rel="noopener">$1</a>')

  // tables
  t = t.replace(/(\|.+\|\n?)+/g, (block) => {
    const rows = block.trim().split('\n').filter(r => r.trim())
    let html = '<div class="overflow-x-auto my-4"><table class="w-full text-sm border-collapse">'
    rows.forEach((row, i) => {
      if (/^\|[-| :]+\|$/.test(row.trim())) return
      const cells = row.split('|').filter((_, ci, a) => ci > 0 && ci < a.length - 1)
      if (i === 0) {
        html += '<thead class="bg-gradient-to-r from-teal-500 to-blue-600 text-white"><tr>'
        cells.forEach(c => { html += `<th class="px-4 py-2.5 text-left font-semibold">${c.trim()}</th>` })
        html += '</tr></thead><tbody>'
      } else {
        html += `<tr class="${i % 2 === 0 ? 'bg-gray-50' : 'bg-white'} hover:bg-teal-50 transition-colors">`
        cells.forEach(c => { html += `<td class="px-4 py-2.5 border-b border-gray-100">${c.trim()}</td>` })
        html += '</tr>'
      }
    })
    html += '</tbody></table></div>'
    return html
  })

  // lists
  t = t.replace(/^\d+\. (.+)$/gm, '<li class="ml-5 list-decimal text-gray-700 my-0.5">$1</li>')
  t = t.replace(/^- (.+)$/gm, '<li class="ml-5 list-disc text-gray-700 my-0.5">$1</li>')
  t = t.replace(/((<li[^>]*>.*<\/li>\n?)+)/g,
    '<ul class="my-3 space-y-0.5">$1</ul>')

  // hr
  t = t.replace(/^---$/gm,
    '<hr class="my-6 border-0 h-px bg-gradient-to-r from-teal-200 via-blue-200 to-transparent" />')

  // paragraphs (wrap orphan text lines)
  t = t.split('\n\n').map(block => {
    block = block.trim()
    if (!block) return ''
    if (/^<(h[1-6]|ul|ol|li|pre|blockquote|div|hr|table|img)/.test(block)) return block
    return `<p class="text-gray-700 leading-relaxed my-2">${block.replace(/\n/g, '<br />')}</p>`
  }).join('\n')

  return t
}

const ICONS = [
  'article','home','info','help','settings','code','api','extension',
  'send','receipt_long','lock','group','manage_accounts','bar_chart',
  'sync_alt','payments','star','bookmark','school','science',
  'medical_services','local_hospital','analytics','security',
]

export default function WikiSection({ token }) {
  // Замена window.confirm на Modal
  const { confirm, ConfirmHost } = useConfirm()
  const [pages, setPages] = useState([])
  const [selected, setSelected] = useState(null)
  const [mode, setMode] = useState('edit') // 'edit' | 'preview'
  const [form, setForm] = useState({ title:'', slug:'', icon:'article', content_md:'', parent_id:'', sort_order:0, is_published:true })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const fileRef = useRef()
  const textareaRef = useRef()

  const loadPages = useCallback(async () => {
    try {
      const r = await api.get('/wiki/pages/all')
      setPages(r.data)
    } catch { setPages([]) }
  }, [])

  useEffect(() => { loadPages() }, [loadPages])

  function selectPage(p) {
    setSelected(p)
    setForm({
      title: p.title,
      slug: p.slug,
      icon: p.icon || 'article',
      content_md: p.content_md || '',
      parent_id: p.parent_id || '',
      sort_order: p.sort_order || 0,
      is_published: p.is_published,
    })
    setMsg('')
    setMode('edit')
  }

  function newPage() {
    setSelected(null)
    setForm({ title:'Новая страница', slug:'new-page-' + Date.now(), icon:'article', content_md:'# Новая страница\n\nНачните писать...', parent_id:'', sort_order:0, is_published:false })
    setMsg('')
    setMode('edit')
  }

  async function save() {
    setSaving(true); setMsg('')
    try {
      if (selected) {
        await api.put('/wiki/pages/' + selected.id, {
          ...form,
          parent_id: form.parent_id || 'null',
        })
        setMsg('✅ Сохранено')
      } else {
        const r = await api.post('/wiki/pages', {
          ...form,
          parent_id: form.parent_id || null,
        })
        setSelected(r.data)
        setMsg('✅ Создано')
      }
      loadPages()
    } catch(e) { setMsg('❌ ' + (e?.response?.data?.detail || 'Ошибка')) }
    finally { setSaving(false) }
  }

  async function deletePage() {
    if (!selected) return
    if (!(await confirm('Удалить страницу «' + selected.title + '»?', { danger: true, okText: 'Удалить' }))) return
    try {
      await api.delete('/wiki/pages/' + selected.id)
      setSelected(null)
      setForm({ title:'', slug:'', icon:'article', content_md:'', parent_id:'', sort_order:0, is_published:true })
      loadPages()
    } catch(e) { setMsg('❌ ' + (e?.response?.data?.detail || 'Ошибка')) }
  }

  async function uploadImage(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (selected) fd.append('page_id', selected.id)
      const r = await api.post('/wiki/images', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      // Используем тот же baseURL что и api — но абсолютный путь чтобы img src работал в браузере
      const url = api.defaults.baseURL + '/wiki/images/' + r.data.id
      const md = `![${file.name}](${url})`
      const ta = textareaRef.current
      if (ta) {
        const start = ta.selectionStart, end = ta.selectionEnd
        const newVal = form.content_md.slice(0, start) + '\n' + md + '\n' + form.content_md.slice(end)
        setForm(p => ({ ...p, content_md: newVal }))
      } else {
        setForm(p => ({ ...p, content_md: p.content_md + '\n' + md }))
      }
    } catch(e) { setMsg('❌ Ошибка загрузки изображения') }
    finally { setUploading(false); e.target.value = '' }
  }

  async function seedPages() {
    setSeeding(true)
    try {
      const r = await api.post('/wiki/seed', {})
      setMsg(`✅ Создано ${r.data.created} стартовых страниц`)
      loadPages()
    } catch(e) { setMsg('❌ ' + (e?.response?.data?.detail || 'Ошибка')) }
    finally { setSeeding(false) }
  }

  const rootPages = pages.filter(p => !p.parent_id)
  const childPages = (parentId) => pages.filter(p => p.parent_id === parentId)
  const filtered = search
    ? pages.filter(p => p.title.toLowerCase().includes(search.toLowerCase()) || p.slug.includes(search.toLowerCase()))
    : null

  const displayPages = filtered || rootPages

  return (
    <div className="flex h-[calc(100vh-120px)] gap-4 min-w-0">
      <ConfirmHost />

      {/* ── Левая панель: дерево страниц ──────────────────── */}
      <div className="w-64 flex-shrink-0 flex flex-col bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-3 border-b border-gray-100">
          <div className="relative mb-2">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-base">search</span>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Поиск..."
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-teal-400"
            />
          </div>
          <button onClick={newPage}
            className="w-full h-8 flex items-center justify-center gap-1.5 rounded-xl text-white text-xs font-bold transition"
            style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)' }}>
            <span className="material-symbols-outlined text-sm">add</span>
            Новая страница
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {displayPages.map(p => (
            <div key={p.id}>
              <PageItem page={p} selected={selected} onSelect={selectPage} />
              {!search && childPages(p.id).map(child => (
                <div key={child.id} className="ml-4">
                  <PageItem page={child} selected={selected} onSelect={selectPage} />
                </div>
              ))}
            </div>
          ))}
          {pages.length === 0 && (
            <div className="text-center py-6 px-3">
              <span className="material-symbols-outlined text-3xl text-gray-300 block mb-2">auto_stories</span>
              <p className="text-xs text-gray-400 mb-3">Страниц пока нет</p>
              <button onClick={seedPages} disabled={seeding}
                className="text-xs text-teal-600 hover:underline disabled:opacity-50">
                {seeding ? 'Создаю...' : '+ Загрузить стартовые'}
              </button>
            </div>
          )}
        </nav>

        {pages.length > 0 && (
          <div className="p-2 border-t border-gray-100">
            <button onClick={seedPages} disabled={seeding}
              className="w-full text-xs text-gray-400 hover:text-teal-600 py-1 flex items-center justify-center gap-1 transition">
              <span className="material-symbols-outlined text-sm">auto_awesome</span>
              {seeding ? 'Создаю...' : 'Добавить стартовые'}
            </button>
          </div>
        )}
      </div>

      {/* ── Правая панель: редактор ────────────────────────── */}
      {form.slug ? (
        <div className="flex-1 flex flex-col min-w-0 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 flex-wrap">
            {/* Icon picker */}
            <div className="relative group">
              <button className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 flex items-center justify-center shadow-sm">
                <span className="material-symbols-outlined text-white text-lg" style={{ fontVariationSettings:"'FILL' 1" }}>
                  {form.icon}
                </span>
              </button>
              <div className="absolute top-10 left-0 z-50 bg-white border border-gray-200 rounded-2xl shadow-xl p-2 hidden group-hover:grid grid-cols-6 gap-1 w-52">
                {ICONS.map(ic => (
                  <button key={ic} onClick={() => setForm(p => ({ ...p, icon: ic }))}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm transition hover:bg-teal-50 ${form.icon === ic ? 'bg-teal-100 text-teal-700' : 'text-gray-500'}`}>
                    <span className="material-symbols-outlined text-base" style={{ fontVariationSettings:"'FILL' 1" }}>{ic}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <input
              value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              placeholder="Заголовок страницы"
              className="flex-1 min-w-0 text-lg font-bold text-gray-900 border-none outline-none bg-transparent placeholder-gray-300"
            />

            {/* Mode toggle */}
            <div className="flex bg-gray-100 rounded-xl p-0.5">
              {[['edit','edit_note','Ред.'],['preview','visibility','Просмотр']].map(([m,ic,lb]) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-[10px] text-xs font-medium transition-all ${mode===m ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  <span className="material-symbols-outlined text-sm">{ic}</span>
                  {lb}
                </button>
              ))}
            </div>

            {/* Actions */}
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="h-8 px-3 flex items-center gap-1 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl text-xs text-gray-600 font-medium transition disabled:opacity-50">
              <span className="material-symbols-outlined text-sm">image</span>
              {uploading ? 'Загрузка...' : 'Фото'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={uploadImage} />

            <button onClick={() => setForm(p => ({ ...p, is_published: !p.is_published }))}
              className={`h-8 px-3 flex items-center gap-1 border rounded-xl text-xs font-medium transition ${form.is_published ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
              <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings:"'FILL' 1" }}>
                {form.is_published ? 'public' : 'public_off'}
              </span>
              {form.is_published ? 'Опубликовано' : 'Черновик'}
            </button>

            {selected && (
              <button onClick={deletePage}
                className="h-8 w-8 flex items-center justify-center border border-red-200 hover:bg-red-50 rounded-xl text-red-400 hover:text-red-600 transition">
                <span className="material-symbols-outlined text-sm">delete</span>
              </button>
            )}

            <button onClick={save} disabled={saving}
              className="h-8 px-4 flex items-center gap-1 text-white text-xs font-bold rounded-xl shadow-sm disabled:opacity-60 transition"
              style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)' }}>
              <span className="material-symbols-outlined text-sm">{saving ? 'hourglass_empty' : 'save'}</span>
              {saving ? 'Сохраняю...' : 'Сохранить'}
            </button>
          </div>

          {/* Slug + Parent */}
          <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs">
            <span className="text-gray-400">Slug:</span>
            <input value={form.slug} onChange={e => setForm(p => ({ ...p, slug: e.target.value.replace(/[^a-z0-9-]/g,'') }))}
              className="bg-transparent border-none outline-none font-mono text-teal-600 w-40" />
            <span className="text-gray-300">|</span>
            <span className="text-gray-400">Родитель:</span>
            <select value={form.parent_id} onChange={e => setForm(p => ({ ...p, parent_id: e.target.value }))}
              className="bg-transparent border-none outline-none text-gray-600">
              <option value="">— корневая —</option>
              {pages.filter(p => p.id !== selected?.id && !p.parent_id).map(p => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
            <span className="text-gray-300">|</span>
            <span className="text-gray-400">Порядок:</span>
            <input type="number" value={form.sort_order}
              onChange={e => setForm(p => ({ ...p, sort_order: parseInt(e.target.value) || 0 }))}
              className="bg-transparent border-none outline-none text-gray-600 w-12" />
            {msg && <span className="ml-auto text-sm">{msg}</span>}
          </div>

          {/* Editor / Preview */}
          <div className="flex-1 overflow-hidden">
            {mode === 'edit' ? (
              <textarea
                ref={textareaRef}
                value={form.content_md}
                onChange={e => setForm(p => ({ ...p, content_md: e.target.value }))}
                placeholder="Пишите в формате Markdown..."
                className="w-full h-full p-5 text-sm font-mono text-gray-800 leading-relaxed resize-none border-none outline-none bg-white"
                style={{ tabSize: 2 }}
              />
            ) : (
              <div className="h-full overflow-y-auto p-6">
                <div
                  className="max-w-3xl mx-auto prose-custom"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMd(form.content_md), SANITIZE_CONFIG) }}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="text-center">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4"
              style={{ background: 'linear-gradient(135deg,rgba(0,151,167,.1),rgba(21,101,192,.1))' }}>
              <span className="material-symbols-outlined text-4xl text-teal-600" style={{ fontVariationSettings:"'FILL' 1" }}>auto_stories</span>
            </div>
            <p className="text-gray-400 text-sm">Выберите страницу или создайте новую</p>
          </div>
        </div>
      )}
    </div>
  )
}

function PageItem({ page, selected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(page)}
      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-sm transition-all text-left group ${
        selected?.id === page.id
          ? 'bg-teal-50 text-teal-700'
          : 'text-gray-600 hover:bg-gray-50'
      }`}>
      <span className="material-symbols-outlined text-base flex-shrink-0"
        style={{ fontVariationSettings: selected?.id === page.id ? "'FILL' 1" : "'FILL' 0", color: selected?.id === page.id ? '#0097A7' : '#9CA3AF' }}>
        {page.icon || 'article'}
      </span>
      <span className="flex-1 min-w-0 truncate font-medium">{page.title}</span>
      {!page.is_published && (
        <span className="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full flex-shrink-0">черновик</span>
      )}
    </button>
  )
}
