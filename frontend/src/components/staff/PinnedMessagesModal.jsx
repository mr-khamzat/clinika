// Модалка списка закреплённых сообщений в комнате
// Backend endpoint: GET /staff-chat/rooms/:roomId/pinned
import { useEffect, useState } from 'react'
import api from '../../api'

export default function PinnedMessagesModal({ open, onClose, roomId }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !roomId) return
    setLoading(true)
    api.get(`/staff-chat/rooms/${roomId}/pinned`)
      .then((r) => setItems(r.data?.messages || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [open, roomId])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,.55)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-3xl overflow-hidden"
        style={{
          background: 'var(--bg, #fff)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--border, rgba(0,0,0,.08))',
        }}
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--border, rgba(0,0,0,.08))' }}
        >
          <div style={{ fontWeight: 700 }}>📌 Закреплённые сообщения</div>
          <button
            onClick={onClose}
            className="px-2 py-1 rounded-lg"
            style={{ background: 'var(--bg-1, #f6f6f8)', cursor: 'pointer' }}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-2">
          {loading && <div style={{ color: 'var(--fg-3, #94a3b8)' }}>Загрузка…</div>}
          {!loading && items.length === 0 && (
            <div style={{ color: 'var(--fg-3, #94a3b8)' }}>Нет закреплённых сообщений</div>
          )}
          {items.map((m) => (
            <div
              key={m.id}
              className="p-3 rounded-2xl"
              style={{
                background: 'var(--bg-1, #f6f6f8)',
                border: '1px solid var(--border, rgba(0,0,0,.08))',
              }}
            >
              <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{m.body || <em>(без текста)</em>}</div>
              {m.pinned_at && (
                <div style={{ fontSize: 11, color: 'var(--fg-3, #94a3b8)', marginTop: 4 }}>
                  Закреплено: {new Date(m.pinned_at).toLocaleString('ru-RU')}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
