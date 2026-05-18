/**
 * PushTemplatesModal.jsx — каталог шаблонов push.
 * Фильтр по category, CRUD, кнопка «Создать дефолтные» (seed-defaults).
 *
 * Props: token, onClose
 */
import { useEffect, useState, useCallback } from 'react'
import { API_BASE } from '../../config'

function apiFetch(token, path, opts = {}) {
  return fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

const CATEGORIES = [
  { value: 'all',        label: 'Все' },
  { value: 'welcome',    label: 'Welcome' },
  { value: 'birthday',   label: 'ДР' },
  { value: 'abandonment',label: 'Воронка' },
  { value: 'nps',        label: 'NPS' },
  { value: 'anniversary',label: 'Годовщина' },
  { value: 'churn',      label: 'Отвал' },
  { value: 'promo',      label: 'Промо' },
  { value: 'other',      label: 'Прочее' },
]

export default function PushTemplatesModal({ token, onClose }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [cat, setCat] = useState('all')
  const [edit, setEdit] = useState(null)  // template object or { _new: true }
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    const q = cat === 'all' ? '' : `?category=${encodeURIComponent(cat)}`
    apiFetch(token, `/api/engagement/templates${q}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setItems(d?.items || d || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token, cat])

  useEffect(() => { load() }, [load])

  async function seedDefaults() {
    if (!confirm('Создать дефолтные шаблоны?')) return
    setBusy(true)
    try {
      await apiFetch(token, `/api/engagement/templates/seed-defaults`, { method: 'POST' })
      load()
    } finally { setBusy(false) }
  }

  async function save(tpl) {
    setBusy(true)
    try {
      const payload = { title: tpl.title, body: tpl.body, category: tpl.category }
      const r = tpl.id
        ? await apiFetch(token, `/api/engagement/templates/${tpl.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await apiFetch(token, `/api/engagement/templates`, { method: 'POST', body: JSON.stringify(payload) })
      if (r.ok) { setEdit(null); load() }
    } finally { setBusy(false) }
  }
  async function remove(tpl) {
    if (!confirm('Удалить шаблон?')) return
    setBusy(true)
    try {
      await apiFetch(token, `/api/engagement/templates/${tpl.id}`, { method: 'DELETE' })
      load()
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-4xl max-h-[94vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800 z-10">
          <h2 className="font-bold text-gray-900 dark:text-white text-lg">Шаблоны push-сообщений</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="p-6 space-y-3">
          {/* Filters */}
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map(c => (
              <button key={c.value} onClick={() => setCat(c.value)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                  cat === c.value ? 'bg-cyan-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
                }`}>
                {c.label}
              </button>
            ))}
            <button onClick={() => setEdit({ _new: true, title: '', body: '', category: cat === 'all' ? 'other' : cat })}
              className="ml-auto px-3 py-1 rounded-lg bg-cyan-600 text-white text-xs font-semibold hover:bg-cyan-700 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">add</span>Новый
            </button>
          </div>

          {/* Empty + seed */}
          {!loading && items.length === 0 && (
            <div className="text-center py-10">
              <span className="material-symbols-outlined text-5xl text-gray-300 dark:text-gray-600">description</span>
              <div className="mt-2 text-gray-500 dark:text-gray-400">Шаблонов пока нет</div>
              <button onClick={seedDefaults} disabled={busy}
                className="mt-3 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1 mx-auto">
                <span className="material-symbols-outlined text-base">eco</span>Создать дефолтные
              </button>
            </div>
          )}

          {loading && <div className="text-center py-10 text-gray-400">Загрузка…</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {items.map(t => (
              <div key={t.id} className="bg-white dark:bg-gray-900/40 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex-1">
                    <div className="font-bold text-gray-900 dark:text-white">{t.title}</div>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300">
                      {t.category}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setEdit(t)} title="Редактировать"
                      className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                      <span className="material-symbols-outlined text-base text-gray-600 dark:text-gray-300">edit</span>
                    </button>
                    <button onClick={() => remove(t)} title="Удалить"
                      className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30">
                      <span className="material-symbols-outlined text-base text-red-500">delete</span>
                    </button>
                  </div>
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap line-clamp-3">{t.body}</div>
              </div>
            ))}
          </div>
        </div>

        {edit && (
          <TemplateEditor tpl={edit} onSave={save} onCancel={() => setEdit(null)} busy={busy} />
        )}
      </div>
    </div>
  )
}

function TemplateEditor({ tpl, onSave, onCancel, busy }) {
  const [title, setTitle] = useState(tpl.title || '')
  const [body, setBody]   = useState(tpl.body || '')
  const [category, setCategory] = useState(tpl.category || 'other')

  return (
    <div className="fixed inset-0 bg-black/40 z-[1010] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 dark:text-white text-lg mb-3">
          {tpl._new ? 'Новый шаблон' : 'Редактирование шаблона'}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Категория</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
              {CATEGORIES.filter(c => c.value !== 'all').map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Заголовок</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Текст</label>
            <textarea rows={4} value={body} onChange={e => setBody(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
            <div className="text-[10px] text-gray-400 mt-1">
              Подстановки: <code>{`{{patient_first_name}}`}</code>, <code>{`{{clinic_name}}`}</code> и т. д.
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Отмена
          </button>
          <button onClick={() => onSave({ ...tpl, title, body, category })} disabled={busy || !title.trim() || !body.trim()}
            className="flex-1 px-4 py-2 rounded-lg bg-cyan-600 text-white font-semibold hover:bg-cyan-700 disabled:opacity-50">
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}
