/**
 * TemplateAutocomplete — выпадающий список шаблонов в чате.
 *
 * Использование (внутри ClinicChatSection):
 *   <TemplateAutocomplete
 *     query={shortcutQuery}      // null если не активен; иначе текст после '/'
 *     onPick={(template) => { setDraft(t.body); textareaRef.current.focus() }}
 *     onClose={() => setShortcutQuery(null)}
 *   />
 *
 * Родительский контейнер textarea должен иметь position: relative.
 */
import { useEffect, useState } from 'react'
import api from '../../api'

export default function TemplateAutocomplete({ query, onPick, onClose }) {
  const [items, setItems] = useState([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (query == null) { setItems([]); return }
    let alive = true
    api.get('/chat/templates', { params: { q: query || '', limit: 10 } })
      .then(r => { if (alive) { setItems(r.data?.templates || []); setActive(0) } })
      .catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [query])

  useEffect(() => {
    const onKey = (e) => {
      if (items.length === 0) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, items.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter')  {
        e.preventDefault()
        const t = items[active]; if (t) onPick(t)
      } else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, active, onPick, onClose])

  if (query == null || items.length === 0) return null

  return (
    <div
      className="absolute bottom-full left-2 right-2 mb-2 z-30 overflow-hidden"
      style={{
        background: 'var(--surface, #fff)',
        border: '1px solid var(--border, #e2e8f0)',
        borderRadius: 14,
        boxShadow: '0 12px 32px rgba(15,23,42,.18)',
        maxHeight: 260, overflowY: 'auto',
      }}
    >
      {items.map((t, i) => (
        <button
          key={t.id}
          onMouseEnter={() => setActive(i)}
          onClick={() => onPick(t)}
          className="w-full text-left px-3 py-2 transition-colors"
          style={{
            background: active === i ? 'var(--bg-1, #f1f5f9)' : 'transparent',
            borderBottom: '1px solid var(--border, #e2e8f0)',
            cursor: 'pointer',
          }}
        >
          <div className="flex items-center gap-2">
            <code style={{
              fontSize: 11, padding: '2px 6px', borderRadius: 6,
              background: 'var(--bg-1, #f1f5f9)', color: 'var(--accent, #0097A7)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}>/{t.shortcut}</code>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg, #0F172A)' }}>{t.title}</span>
            {t.is_global && (
              <span style={{ fontSize: 10, color: 'var(--fg-3, #94a3b8)', marginLeft: 'auto' }}>общий</span>
            )}
          </div>
          <div className="truncate" style={{ fontSize: 12, color: 'var(--fg-3, #94a3b8)', marginTop: 2 }}>
            {t.body}
          </div>
        </button>
      ))}
    </div>
  )
}
