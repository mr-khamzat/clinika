/**
 * SegmentEditorModal.jsx — редактор сегмента пациентов.
 * Filter builder для всех ключей filter_json + Превью + Сохранить.
 * Props:
 *   token, segment (id если редактирование, null если новый),
 *   initialFilter (опционально — например, ручной список patient_ids → переданный из таблицы),
 *   onClose, onSaved(segment)
 */
import { useEffect, useState, useCallback } from 'react'
import { API_BASE } from '../../config'

function apiFetch(token, path, opts = {}) {
  return fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

const FIELD = (label, hint) => ({ label, hint })

const GROUPS = [
  {
    title: 'По регистрации',
    fields: [
      { key: 'created_after_days',   type: 'number', ...FIELD('Дней с регистрации (минимум)', 'напр. 7 — зарегистрировались ≥7 дней назад') },
      { key: 'created_before_days',  type: 'number', ...FIELD('Дней с регистрации (максимум)', 'напр. 30 — не старше 30 дней') },
    ],
  },
  {
    title: 'По активности',
    fields: [
      { key: 'last_seen_within_days',    type: 'number', ...FIELD('Активны за последние N дней') },
      { key: 'last_seen_after_days_ago', type: 'number', ...FIELD('Не заходили N+ дней') },
    ],
  },
  {
    title: 'Логины',
    fields: [
      { key: 'login_count_min', type: 'number', ...FIELD('Минимум логинов') },
      { key: 'login_count_max', type: 'number', ...FIELD('Максимум логинов') },
    ],
  },
  {
    title: 'День рождения',
    fields: [
      { key: 'birthday_in_next_days', type: 'number', ...FIELD('ДР в течение N дней') },
    ],
  },
  {
    title: 'Тэги',
    fields: [
      { key: 'tags', type: 'chips', ...FIELD('Список тэгов (любой из)') },
    ],
  },
  {
    title: 'Прочее',
    fields: [
      { key: 'has_appointments_in_tenant', type: 'bool', ...FIELD('Есть приёмы в этой клинике') },
      { key: 'marketing_opt_in',            type: 'bool', ...FIELD('Согласие на маркетинг') },
      { key: 'city',                        type: 'string', ...FIELD('Город') },
    ],
  },
]

export default function SegmentEditorModal({ token, segment, initialFilter, onClose, onSaved }) {
  const isEdit = !!segment?.id
  const [name, setName] = useState(segment?.name || '')
  const [description, setDescription] = useState(segment?.description || '')
  const [isDynamic, setIsDynamic] = useState(segment?.is_dynamic !== false)
  const [filter, setFilter] = useState(() => ({ ...(initialFilter || {}), ...(segment?.filter_json || {}) }))
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [savedFlag, setSavedFlag] = useState(false)
  const [err, setErr] = useState('')

  function setField(k, v) {
    setFilter(f => {
      const n = { ...f }
      if (v === '' || v == null || (Array.isArray(v) && v.length === 0)) delete n[k]
      else n[k] = v
      return n
    })
  }

  const runPreview = useCallback(async () => {
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(token, `/engagement/segments/preview`, {
        method: 'POST', body: JSON.stringify({ filter_json: filter })
      })
      if (r.ok) setPreview(await r.json())
      else { setPreview(null); setErr('Не удалось рассчитать превью') }
    } catch (e) { setErr(String(e)) }
    finally { setBusy(false) }
  }, [token, filter])

  async function save() {
    if (!name.trim()) { setErr('Введите название'); return }
    setBusy(true); setErr('')
    try {
      const payload = { name: name.trim(), description: description.trim(), is_dynamic: isDynamic, filter_json: filter }
      const r = isEdit
        ? await apiFetch(token, `/engagement/segments/${segment.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await apiFetch(token, `/engagement/segments`, { method: 'POST', body: JSON.stringify(payload) })
      if (r.ok) {
        const saved = await r.json()
        setSavedFlag(true)
        if (onSaved) onSaved(saved)
        setTimeout(() => onClose && onClose(), 600)
      } else {
        setErr('Ошибка сохранения')
      }
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-4xl max-h-[94vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800 z-10">
          <h2 className="font-bold text-gray-900 dark:text-white text-lg">{isEdit ? 'Редактировать сегмент' : 'Новый сегмент'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
          {/* Левая колонка — поля */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Название</label>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="VIP-пациенты с приёмами"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Описание</label>
              <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={isDynamic} onChange={e => setIsDynamic(e.target.checked)}
                className="h-4 w-4 rounded text-cyan-600" />
              <span>Динамический (пересчитывается при отправке) — иначе snapshot из текущего превью</span>
            </label>

            <div className="space-y-3 mt-4">
              {GROUPS.map(g => (
                <div key={g.title} className="bg-gray-50 dark:bg-gray-900/40 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                  <div className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase mb-2">{g.title}</div>
                  <div className="space-y-2">
                    {g.fields.map(f => (
                      <FilterField key={f.key} field={f} value={filter[f.key]} onChange={v => setField(f.key, v)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Правая колонка — превью + действия */}
          <div className="space-y-3">
            <div className="sticky top-20 space-y-3">
              <button onClick={runPreview} disabled={busy}
                className="w-full px-4 py-2 rounded-lg bg-white dark:bg-gray-700 border-2 border-cyan-500 text-cyan-700 dark:text-cyan-300 font-semibold hover:bg-cyan-50 dark:hover:bg-cyan-900/40 flex items-center justify-center gap-2 disabled:opacity-50">
                <span className="material-symbols-outlined">visibility</span>
                {busy ? 'Считаем…' : 'Превью сегмента'}
              </button>

              {preview && (
                <div className="bg-white dark:bg-gray-900/40 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-baseline justify-between mb-3">
                    <div>
                      <div className="text-3xl font-bold text-cyan-600 dark:text-cyan-400">{(preview.size ?? preview.total ?? 0).toLocaleString('ru')}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">пациентов в сегменте</div>
                    </div>
                  </div>
                  <div className="text-[10px] font-bold uppercase text-gray-500 mb-1">Примеры (до 20):</div>
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {(preview.sample || preview.samples || []).slice(0, 20).map((p, i) => (
                      <div key={i} className="text-xs text-gray-700 dark:text-gray-300 flex justify-between gap-2">
                        <span className="truncate">{p.name || '—'}</span>
                        <span className="text-gray-400">{p.phone || ''}</span>
                      </div>
                    ))}
                    {(preview.sample || preview.samples || []).length === 0 && (
                      <div className="text-xs text-gray-400 italic">Пациенты не найдены</div>
                    )}
                  </div>
                </div>
              )}

              {err && <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{err}</div>}

              <div className="flex gap-2">
                <button onClick={onClose}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                  Отмена
                </button>
                <button onClick={save} disabled={busy || !name.trim()}
                  className="flex-1 px-4 py-2 rounded-lg bg-cyan-600 text-white font-semibold hover:bg-cyan-700 disabled:opacity-50">
                  {savedFlag ? 'Сохранено' : (isEdit ? 'Обновить' : 'Сохранить сегмент')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Универсальное поле фильтра ───────────────────────────────────────────
function FilterField({ field, value, onChange }) {
  if (field.type === 'number') {
    return (
      <div>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">{field.label}</label>
        <input type="number" min="0" value={value ?? ''}
          onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="w-full px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
        {field.hint && <div className="text-[10px] text-gray-400 mt-0.5">{field.hint}</div>}
      </div>
    )
  }
  if (field.type === 'string') {
    return (
      <div>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">{field.label}</label>
        <input type="text" value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          className="w-full px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
      </div>
    )
  }
  if (field.type === 'bool') {
    return (
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked || null)}
          className="h-4 w-4 rounded text-cyan-600" />
        {field.label}
      </label>
    )
  }
  if (field.type === 'chips') {
    const list = Array.isArray(value) ? value : []
    return <ChipsField field={field} value={list} onChange={onChange} />
  }
  return null
}

function ChipsField({ field, value, onChange }) {
  const [draft, setDraft] = useState('')
  function add() {
    if (!draft.trim()) return
    if (value.includes(draft.trim())) return
    onChange([...value, draft.trim()])
    setDraft('')
  }
  function remove(i) {
    onChange(value.filter((_, j) => j !== i))
  }
  return (
    <div>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">{field.label}</label>
      <div className="flex flex-wrap gap-1 mb-1">
        {value.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300">
            {t}<button onClick={() => remove(i)} className="hover:text-red-600">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="Добавить тэг…"
          className="flex-1 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
        <button onClick={add} className="px-2 rounded-lg bg-cyan-600 text-white text-sm">+</button>
      </div>
    </div>
  )
}
