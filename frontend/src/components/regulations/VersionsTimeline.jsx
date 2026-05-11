// ============================================================
// VersionsTimeline — вертикальный таймлайн версий регламента.
// Каждый элемент: номер версии, дата публикации/«черновик», changelog,
// кнопки Просмотр / Опубликовать (draft) / Откат.
//
// Props:
//   versions          — [{id, version_number, published_at, changelog, status?}, …]
//   currentVersionId  — id опубликованной версии (для подсветки)
//   onPreview(id)
//   onPublish(id)
//   onRollback(id)    — создаёт новую draft на базе старой
// ============================================================

function fmtDate(s) {
  if (!s) return ''
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return s
  }
}

export default function VersionsTimeline({
  versions = [],
  currentVersionId = null,
  onPreview,
  onPublish,
  onRollback,
}) {
  if (!versions.length) {
    return (
      <div style={{ fontSize: 13, color: '#9ca3af', padding: '8px 0' }}>
        Версий пока нет — сохраните черновик.
      </div>
    )
  }

  // Сортируем по возрастанию version_number, но визуально показываем сверху последние.
  const sorted = [...versions].sort((a, b) => (b.version_number || 0) - (a.version_number || 0))

  return (
    <div className="reg-timeline">
      {sorted.map((v) => {
        const isDraft = !v.published_at
        const isCurrent = currentVersionId && v.id === currentVersionId
        return (
          <div key={v.id} className={`reg-tl-item${isCurrent ? ' is-current' : ''}`}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span className="reg-tl-num">v{v.version_number}</span>
                {isCurrent && <span className="reg-chip reg-chip-published">текущая</span>}
                {isDraft && <span className="reg-chip reg-chip-draft">черновик</span>}
              </div>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>
                {isDraft ? '—' : fmtDate(v.published_at)}
              </span>
            </div>

            {v.changelog && (
              <div style={{ marginTop: 6, fontSize: 13, color: '#4b5563', whiteSpace: 'pre-wrap' }}>
                {v.changelog}
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {onPreview && (
                <button className="reg-tool-btn" onClick={() => onPreview(v.id)}>
                  <span className="material-symbols-outlined">visibility</span>
                  Просмотр
                </button>
              )}
              {isDraft && onPublish && (
                <button className="reg-tool-btn reg-ai" onClick={() => onPublish(v.id)}>
                  <span className="material-symbols-outlined">rocket_launch</span>
                  Опубликовать
                </button>
              )}
              {!isDraft && !isCurrent && onRollback && (
                <button className="reg-tool-btn" onClick={() => onRollback(v.id)}>
                  <span className="material-symbols-outlined">history</span>
                  Откатиться
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
