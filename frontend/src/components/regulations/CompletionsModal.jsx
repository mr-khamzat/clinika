// ============================================================
// CompletionsModal — модал "Кто выполнил регламент".
// GET /admin/regulations/{id}/completions
//   → { completions:[{user_id, full_name, version, completed_at}], stats:{covered,total,pct} }
//
// Подсветка:
//   • прочитал ТЕКУЩУЮ версию  — зелёный значок
//   • прочитал старую версию    — жёлтый
//   • не читал вовсе            — серый
//
// Бэк может вернуть всех назначенных юзеров вместе с теми, у кого completed_at = null.
// Если возвращает только тех, кто прочитал — UI всё равно покажет stats.
//
// Props:
//   open
//   regulationId
//   currentVersion   — number (для определения «прочитал последнюю»)
//   onClose
// ============================================================
import { useEffect, useState } from 'react'
import api from '../../api'
import { useToast } from '../../design'

function fmtDate(s) {
  if (!s) return ''
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
  } catch { return s }
}

export default function CompletionsModal({
  open,
  regulationId,
  currentVersion,
  onClose,
}) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({ completions: [], stats: { covered: 0, total: 0, pct: 0 } })
  const [filter, setFilter] = useState('all') // all | current | outdated | missing

  useEffect(() => {
    if (!open || !regulationId) return
    let cancel = false
    setLoading(true)
    api.get(`/admin/regulations/${regulationId}/completions`)
      .then(r => { if (!cancel) setData(r.data || { completions: [], stats: { covered: 0, total: 0, pct: 0 } }) })
      .catch(e => toast('Не удалось загрузить статистику: ' + (e?.response?.data?.detail || e.message), 'error'))
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, regulationId])

  if (!open) return null

  // Классифицируем строки
  const classify = (row) => {
    if (!row.completed_at) return 'missing'
    if (currentVersion && row.version === currentVersion) return 'current'
    return 'outdated'
  }

  const rows = (data.completions || []).map(r => ({ ...r, _status: classify(r) }))
  const filtered = filter === 'all' ? rows : rows.filter(r => r._status === filter)

  const stats = data.stats || { covered: 0, total: 0, pct: 0 }
  const pct = Math.max(0, Math.min(100, stats.pct || 0))

  return (
    <div className="reg-backdrop" onClick={onClose}>
      <div className="reg-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <h3>
          <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: 6 }}>
            fact_check
          </span>
          Кто выполнил регламент
        </h3>
        <p className="reg-modal-sub">
          Прогресс прочтения и подтверждения текущей версии сотрудниками с назначением.
        </p>

        {/* Прогресс-бар */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div className="reg-progress"><span style={{ width: `${pct}%` }} /></div>
          </div>
          <div style={{ fontSize: 13, color: '#4b5563', whiteSpace: 'nowrap' }}>
            {stats.covered} / {stats.total} · <b>{pct}%</b>
          </div>
        </div>

        {/* Фильтры */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {[
            { v: 'all',      l: 'Все' },
            { v: 'current',  l: 'Прочли последнюю' },
            { v: 'outdated', l: 'Старая версия' },
            { v: 'missing',  l: 'Не читали' },
          ].map(t => (
            <button
              key={t.v}
              className="reg-tool-btn"
              onClick={() => setFilter(t.v)}
              style={filter === t.v
                ? { borderColor: '#7c3aed', color: '#7c3aed', background: '#f9f5ff' }
                : undefined}
            >
              {t.l}
            </button>
          ))}
        </div>

        {/* Таблица */}
        {loading ? (
          <div className="reg-skel" style={{ height: 120 }} />
        ) : filtered.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: 13, padding: '14px 0', textAlign: 'center' }}>
            Нет записей с таким фильтром.
          </div>
        ) : (
          <div style={{ maxHeight: '46vh', overflow: 'auto' }}>
            <table className="reg-table">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Версия</th>
                  <th>Когда</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={`${r.user_id || i}`}>
                    <td>{r.full_name || `user #${r.user_id}`}</td>
                    <td>{r.version ? `v${r.version}` : '—'}</td>
                    <td>{fmtDate(r.completed_at)}</td>
                    <td>
                      {r._status === 'current'  && <span className="reg-chip reg-chip-published">актуально</span>}
                      {r._status === 'outdated' && <span className="reg-chip reg-chip-draft">старая</span>}
                      {r._status === 'missing'  && <span className="reg-chip reg-chip-archived">не читал</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="reg-tool-btn" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  )
}
