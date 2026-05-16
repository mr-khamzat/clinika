// Автокомплит @-упоминаний (Slack/Discord-style)
// Backend endpoint: GET /staff-chat/contacts?q=&limit=8
// Управляется родителем через prop `query` (string | null). null = скрыт.
import { useEffect, useState } from 'react'
import api from '../../api'

export default function MentionAutocomplete({ query, onPick, onClose }) {
  const [users, setUsers] = useState([])
  const [active, setActive] = useState(0)

  // Загрузка пользователей под текущий query (debounce не критичен — список короткий)
  useEffect(() => {
    if (query == null) { setUsers([]); return }
    let alive = true
    api.get('/staff-chat/contacts', { params: { q: query, limit: 8 } })
      .then((r) => {
        if (!alive) return
        // Бэк может вернуть массив, объект {items: []} или {groups:[{users:[]}]}
        let list = []
        const d = r.data
        if (Array.isArray(d)) list = d
        else if (Array.isArray(d?.items)) list = d.items
        else if (Array.isArray(d?.users)) list = d.users
        else if (Array.isArray(d?.groups)) {
          for (const g of d.groups) for (const u of (g.users || [])) list.push(u)
        }
        // Лёгкий клиентский фильтр по query (на случай если бэк его не учитывает)
        if (query) {
          const q = query.toLowerCase()
          list = list.filter((u) =>
            (u.username || '').toLowerCase().includes(q) ||
            (u.full_name || u.name || '').toLowerCase().includes(q)
          )
        }
        setUsers(list.slice(0, 8))
        setActive(0)
      })
      .catch(() => { if (alive) setUsers([]) })
    return () => { alive = false }
  }, [query])

  // Клавиатура: ↑/↓/Enter/Esc
  useEffect(() => {
    if (query == null || users.length === 0) return
    const onKey = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => Math.min(i + 1, users.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const u = users[active]
        if (u) onPick?.(u)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [users, active, onPick, onClose, query])

  if (query == null || users.length === 0) return null

  return (
    <div
      className="absolute z-30 overflow-hidden"
      style={{
        bottom: '100%',
        left: 8,
        right: 8,
        marginBottom: 8,
        background: 'var(--surface, var(--bg, #fff))',
        border: '1px solid var(--border, rgba(0,0,0,.08))',
        borderRadius: 14,
        boxShadow: '0 12px 32px rgba(15,23,42,.18)',
        maxHeight: 240,
        overflowY: 'auto',
      }}
    >
      {users.map((u, i) => (
        <button
          key={u.id || u.username || i}
          type="button"
          onMouseEnter={() => setActive(i)}
          onClick={(e) => { e.preventDefault(); onPick?.(u) }}
          className="w-full text-left px-3 py-2"
          style={{
            background: active === i ? 'var(--bg-1, #f6f6f8)' : 'transparent',
            cursor: 'pointer',
            border: 'none',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            @{u.username || u.full_name || u.name || 'user'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3, #94a3b8)' }}>
            {u.full_name || u.name || ''}{u.role ? ' · ' + u.role : ''}
          </div>
        </button>
      ))}
    </div>
  )
}
