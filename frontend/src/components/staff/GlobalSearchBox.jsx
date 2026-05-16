// GlobalSearchBox — глобальный поиск по StaffChat (rooms + messages).
// Backend: GET /staff-chat/search?q=<query>
// Возвращает: { results: [{ message_id, room_id, room_name, body_snippet, created_at, sender_name }] }
import { useEffect, useRef, useState } from 'react'
import api from '../../api'

function formatShort(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const now = new Date()
    const sameDay = d.toDateString() === now.toDateString()
    if (sameDay) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  } catch { return '' }
}

export default function GlobalSearchBox({ onPick }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const wrapRef = useRef(null)

  // Debounce 300ms
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    clearTimeout(debounceRef.current)
    if (q.length < 2) {
      setResults([])
      setError('')
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/staff-chat/search', { params: { q } })
        setResults(data?.results || [])
        setError('')
      } catch (e) {
        setResults([])
        setError(e?.response?.data?.detail || 'Ошибка поиска')
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, open])

  // Click outside to close
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Auto-focus input when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setQuery('')
      setResults([])
      setError('')
    }
  }, [open])

  const handlePick = (r) => {
    onPick?.(r)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="sc-icon-btn"
        title="Глобальный поиск (Ctrl+K)"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
        </svg>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            width: 360,
            maxWidth: '92vw',
            background: 'var(--sc-surface, #fff)',
            border: '1px solid var(--sc-border, rgba(0,0,0,.08))',
            borderRadius: 14,
            boxShadow: '0 12px 32px rgba(15,23,42,.2)',
            zIndex: 60,
            padding: 10,
            display: 'flex', flexDirection: 'column', gap: 8,
            maxHeight: '70vh',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по сообщениям…"
            onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
            style={{
              padding: '9px 12px',
              borderRadius: 10,
              border: '1px solid var(--sc-border, rgba(0,0,0,.08))',
              background: 'var(--sc-bg-1, #f6f6f8)',
              color: 'var(--sc-fg, #0F172A)',
              fontSize: 14, outline: 'none',
            }}
          />
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            {loading && (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--sc-fg-3, #6b7280)' }}>
                Ищу…
              </div>
            )}
            {!loading && error && (
              <div style={{ padding: 12, fontSize: 13, color: '#b91c1c', background: 'rgba(220,38,38,.08)', borderRadius: 8 }}>
                {error}
              </div>
            )}
            {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--sc-fg-3, #6b7280)' }}>
                Ничего не найдено
              </div>
            )}
            {!loading && !error && query.trim().length < 2 && (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--sc-fg-3, #6b7280)' }}>
                Введите минимум 2 символа
              </div>
            )}
            {!loading && results.map((r) => (
              <button
                key={r.message_id || `${r.room_id}-${r.created_at}`}
                type="button"
                onClick={() => handlePick(r)}
                style={{
                  textAlign: 'left',
                  background: 'transparent',
                  border: 0,
                  padding: '8px 10px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', gap: 4,
                  transition: 'background 120ms',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--sc-bg-2, #f3f5f8)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--sc-fg, #0F172A)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.room_name || 'Чат'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--sc-fg-3, #6b7280)', flexShrink: 0 }}>
                    {formatShort(r.created_at)}
                  </span>
                </div>
                {r.sender_name && (
                  <span style={{ fontSize: 11, color: 'var(--sc-fg-3, #6b7280)' }}>
                    {r.sender_name}
                  </span>
                )}
                <span style={{ fontSize: 12.5, color: 'var(--sc-fg-2, #374151)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {r.body_snippet || r.body || ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
