/**
 * SuggestionsBoard.jsx — ручная работа менеджера с авто-подсказками.
 * Группы по kind: welcome/birthday/abandonment/nps/anniversary/churn_30d/60d/90d.
 * Каждая строка: пациент + дата + превью текста.
 * Bulk: отправить, отложить, пропустить.
 * Anti-spam tip если у пациента уже было X push за 30д.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { API_BASE } from '../../config'

function apiFetch(token, path, opts = {}) {
  return fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

const KIND_META = {
  welcome:      { label: 'Welcome',        icon: 'waving_hand',     color: 'text-cyan-500',     bg: 'bg-cyan-100 dark:bg-cyan-900/40' },
  birthday:     { label: 'День рождения',  icon: 'cake',            color: 'text-pink-500',     bg: 'bg-pink-100 dark:bg-pink-900/40' },
  abandonment:  { label: 'Брошенная воронка', icon: 'remove_circle', color: 'text-orange-500', bg: 'bg-orange-100 dark:bg-orange-900/40' },
  nps:          { label: 'NPS-опрос',      icon: 'sentiment_satisfied', color: 'text-violet-500', bg: 'bg-violet-100 dark:bg-violet-900/40' },
  anniversary:  { label: 'Годовщина',      icon: 'celebration',     color: 'text-amber-500',    bg: 'bg-amber-100 dark:bg-amber-900/40' },
  churn_30d:    { label: 'Отвал 30 дней',  icon: 'schedule',        color: 'text-yellow-600',   bg: 'bg-yellow-100 dark:bg-yellow-900/40' },
  churn_60d:    { label: 'Отвал 60 дней',  icon: 'warning',         color: 'text-orange-600',   bg: 'bg-orange-100 dark:bg-orange-900/40' },
  churn_90d:    { label: 'Отвал 90+ дней', icon: 'person_off',      color: 'text-red-600',      bg: 'bg-red-100 dark:bg-red-900/40' },
}
const DEFAULT_META = { label: 'Прочее', icon: 'tips_and_updates', color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-gray-700' }

function fmtDateTime(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return s }
}

export default function SuggestionsBoard({ token, onOpenCard, onComposePush }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('pending')
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState(new Set())

  const reload = useCallback(() => {
    setLoading(true)
    apiFetch(token, `/api/engagement/suggestions?status=${status}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setItems(d?.items || d || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token, status])

  useEffect(() => { reload() }, [reload])
  useEffect(() => { setSelected(new Set()) }, [status])

  const grouped = useMemo(() => {
    const map = {}
    for (const it of items) {
      const k = it.kind || 'other'
      if (!map[k]) map[k] = []
      map[k].push(it)
    }
    return map
  }, [items])

  function toggleOne(id) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }
  function toggleGroup(kind) {
    const ids = (grouped[kind] || []).map(s => s.id)
    const allOn = ids.every(id => selected.has(id))
    setSelected(prev => {
      const n = new Set(prev)
      ids.forEach(id => allOn ? n.delete(id) : n.add(id))
      return n
    })
  }
  function toggleCollapse(kind) {
    setCollapsed(prev => {
      const n = new Set(prev)
      n.has(kind) ? n.delete(kind) : n.add(kind)
      return n
    })
  }
  function clearSel() { setSelected(new Set()) }

  async function bulkAction(action, payload) {
    if (selected.size === 0) return
    if (action === 'dismiss' && !confirm(`Пропустить ${selected.size} подсказок?`)) return
    setBusy(true)
    try {
      const ids = Array.from(selected)
      for (const id of ids) {
        const path = `/api/engagement/suggestions/${id}/${action}`
        await apiFetch(token, path, { method: 'POST', body: JSON.stringify(payload || {}) })
      }
      setSelected(new Set())
      reload()
    } finally { setBusy(false) }
  }

  async function regenerate() {
    if (!confirm('Пересоздать все подсказки на основе текущих данных?')) return
    setBusy(true)
    try {
      await apiFetch(token, `/api/engagement/suggestions/regenerate`, { method: 'POST' })
      reload()
    } finally { setBusy(false) }
  }

  function composeFor(suggestion) {
    if (onComposePush) onComposePush({
      from_suggestion: suggestion,
      patient_ids: [suggestion.patient_id],
      template_id: suggestion.template_id,
      kind: suggestion.kind,
    })
  }

  const kinds = Object.keys(grouped).sort((a, b) => (grouped[b].length - grouped[a].length))
  const sel = Array.from(selected)

  return (
    <div className="space-y-3">
      {/* Header / filter */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">Статус:</span>
        {['pending', 'sent', 'dismissed', 'postponed', 'all'].map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-3 py-1 rounded-lg text-sm font-semibold ${
              status === s
                ? 'bg-cyan-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
            }`}>
            {s === 'all' ? 'Все' : s === 'pending' ? 'Ожидают' : s === 'sent' ? 'Отправлено' : s === 'dismissed' ? 'Пропущено' : 'Отложено'}
          </button>
        ))}

        <div className="ml-auto flex gap-2">
          <button onClick={regenerate} disabled={busy}
            className="px-3 py-1 rounded-lg text-sm border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-1">
            <span className="material-symbols-outlined text-base">refresh</span>Перегенерировать
          </button>
        </div>
      </div>

      {/* Bulk-action bar */}
      {sel.length > 0 && (
        <div className="sticky top-0 z-10 bg-gradient-to-r from-cyan-50 to-teal-50 dark:from-cyan-900/30 dark:to-teal-900/30 border border-cyan-200 dark:border-cyan-800 rounded-xl px-4 py-2 flex items-center gap-3 shadow">
          <span className="text-sm font-semibold text-cyan-800 dark:text-cyan-200">Выбрано: {sel.length}</span>
          <button onClick={() => {
            const ids = sel
            const list = items.filter(i => ids.includes(i.id))
            if (onComposePush) onComposePush({ patient_ids: list.map(s => s.patient_id), suggestion_ids: ids })
          }}
            className="px-3 py-1 rounded-lg bg-cyan-600 text-white text-sm flex items-center gap-1 hover:bg-cyan-700">
            <span className="material-symbols-outlined text-base">send</span>Отправить push
          </button>
          <button onClick={() => bulkAction('postpone', { days: 7 })} disabled={busy}
            className="px-3 py-1 rounded-lg bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-700 text-sm flex items-center gap-1 hover:bg-amber-50 dark:hover:bg-amber-900/40">
            <span className="material-symbols-outlined text-base">snooze</span>Отложить 7 дней
          </button>
          <button onClick={() => bulkAction('dismiss')} disabled={busy}
            className="px-3 py-1 rounded-lg bg-white dark:bg-gray-800 border border-red-200 dark:border-red-700 text-sm flex items-center gap-1 hover:bg-red-50 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300">
            <span className="material-symbols-outlined text-base">delete_sweep</span>Пропустить
          </button>
          <button onClick={clearSel} className="ml-auto text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            Очистить
          </button>
        </div>
      )}

      {/* Groups */}
      {loading && <div className="text-center py-10 text-gray-400">Загрузка…</div>}
      {!loading && kinds.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-10 border border-dashed border-gray-200 dark:border-gray-700 text-center">
          <span className="material-symbols-outlined text-5xl text-gray-300 dark:text-gray-600">inbox</span>
          <div className="mt-2 text-gray-500 dark:text-gray-400">Нет подсказок в этом статусе</div>
          <button onClick={regenerate} className="mt-3 px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm hover:bg-cyan-700">
            Сгенерировать подсказки
          </button>
        </div>
      )}

      {!loading && kinds.map(k => {
        const meta = KIND_META[k] || DEFAULT_META
        const list = grouped[k] || []
        const isCol = collapsed.has(k)
        const groupIds = list.map(s => s.id)
        const allSel = groupIds.length > 0 && groupIds.every(id => selected.has(id))
        return (
          <div key={k} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
            <div className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700 ${meta.bg}`}>
              <input type="checkbox" checked={allSel} onChange={() => toggleGroup(k)} className="h-4 w-4 rounded text-cyan-600" />
              <span className={`material-symbols-outlined ${meta.color}`} style={{ fontVariationSettings: "'FILL' 1" }}>{meta.icon}</span>
              <div className="flex-1">
                <div className="font-bold text-gray-900 dark:text-white">{meta.label}</div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-white/70 dark:bg-gray-900/40 text-xs font-bold text-gray-700 dark:text-gray-300">{list.length}</span>
              <button onClick={() => toggleCollapse(k)}
                className="material-symbols-outlined text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
                {isCol ? 'expand_more' : 'expand_less'}
              </button>
            </div>

            {!isCol && (
              <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {list.map(s => (
                  <SuggestionRow
                    key={s.id}
                    s={s}
                    selected={selected.has(s.id)}
                    onToggle={() => toggleOne(s.id)}
                    onOpenCard={onOpenCard}
                    onCompose={() => composeFor(s)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SuggestionRow({ s, selected, onToggle, onOpenCard, onCompose }) {
  const pushesIn30d = s.meta?.pushes_in_30d || 0
  const text = s.meta?.text || s.meta?.preview || s.meta?.body || ''
  const patientName = s.meta?.patient_name || s.patient_name || `ID ${s.patient_id}`

  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/30 transition">
      <input type="checkbox" checked={selected} onChange={onToggle} className="h-4 w-4 rounded text-cyan-600 mt-1" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <button onClick={() => onOpenCard && onOpenCard(s.patient_id)} className="font-semibold text-gray-900 dark:text-white hover:text-cyan-600">
            {patientName}
          </button>
          <span className="text-xs text-gray-400">·</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{fmtDateTime(s.created_at)}</span>
          {pushesIn30d >= 3 && (
            <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[10px] font-semibold" title="Anti-spam: пациент получил много push за 30 дней">
              <span className="material-symbols-outlined text-xs">warning</span>{pushesIn30d}/30д
            </span>
          )}
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-300 mt-0.5 line-clamp-2">
          {text || <span className="italic text-gray-400">(шаблон не задан — добавьте текст при отправке)</span>}
        </div>
      </div>
      <button onClick={onCompose}
        className="px-3 py-1 rounded-lg bg-cyan-600 text-white text-xs flex items-center gap-1 hover:bg-cyan-700 shrink-0">
        <span className="material-symbols-outlined text-sm">edit_note</span>Push
      </button>
    </div>
  )
}
