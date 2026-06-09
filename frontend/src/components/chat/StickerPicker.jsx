/**
 * StickerPicker — палитра стикеров КлиникСеть для отправки в чат.
 * Props: open, onClose, onPick(stickerUrl) — даёт URL выбранного SVG
 */
import { useState, useEffect } from 'react'

export default function StickerPicker({ open, onClose, onPick }) {
  const [stickers, setStickers] = useState([])
  const [category, setCategory] = useState('all')

  useEffect(() => {
    if (!open) return
    fetch('/stickers/index.json')
      .then(r => r.json())
      .then(d => setStickers(d.stickers || []))
      .catch(() => setStickers([]))
  }, [open])

  if (!open) return null
  const filtered = category === 'all' ? stickers : stickers.filter(s => s.category === category)
  const categories = ['all', ...new Set(stickers.map(s => s.category))]

  const CAT_LABELS = {
    all: 'Все',
    welcome: 'Приветствие',
    love: 'Любовь',
    medical: 'Медицина',
    support: 'Поддержка',
    schedule: 'Расписание',
    finance: 'Финансы',
    emergency: 'Экстренные',
    gratitude: 'Благодарность',
  }

  return (
    <div
      className="absolute bottom-16 left-0 right-0 mx-4 rounded-2xl shadow-2xl z-30"
      style={{
        background: '#ffffff',
        color: '#0f172a',
        border: '1px solid #e2e8f0',
        maxHeight: '50vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Категории */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: 12,
          borderBottom: '1px solid #e2e8f0',
          overflowX: 'auto',
          alignItems: 'center',
        }}
      >
        {categories.map(c => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              background: category === c ? '#0097A7' : '#f1f5f9',
              color: category === c ? '#fff' : '#475569',
              whiteSpace: 'nowrap',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {CAT_LABELS[c] || c}
          </button>
        ))}
        <button
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            width: 32,
            height: 32,
            borderRadius: 8,
            background: '#f1f5f9',
            fontSize: 18,
            border: 'none',
            cursor: 'pointer',
            color: '#475569',
            flexShrink: 0,
          }}
          aria-label="Закрыть"
        >
          ×
        </button>
      </div>
      {/* Сетка стикеров */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
          gap: 8,
          padding: 12,
          overflow: 'auto',
          flex: 1,
        }}
      >
        {filtered.map(s => (
          <button
            key={s.id}
            onClick={() => onPick('/stickers/' + s.file)}
            title={s.title}
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: 6,
              cursor: 'pointer',
              transition: 'transform .15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
            onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
          >
            <img
              src={'/stickers/' + s.file}
              alt={s.title}
              style={{ width: '100%', height: 80, objectFit: 'contain', display: 'block' }}
            />
            <div
              style={{
                fontSize: 10,
                marginTop: 4,
                color: '#64748b',
                textAlign: 'center',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {s.title}
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>
            Стикеры не загружены
          </div>
        )}
      </div>
    </div>
  )
}
