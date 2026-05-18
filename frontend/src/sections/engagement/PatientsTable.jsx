/**
 * PatientsTable.jsx
 * Таблица пациентов ЛК с фильтрами, пагинацией, bulk-actions.
 *
 * Props:
 *   token     — JWT
 *   onOpenCard(id)        — открыть модал карточки
 *   onCreateCampaign(ids) — bulk → создать кампанию из выбранных
 *   onSaveSegment(ids)    — bulk → сохранить как сегмент
 *   onBulkTag(ids)        — bulk → массовый тэг
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import { API_BASE } from '../../config'

function apiFetch(token, path, opts = {}) {
  return fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

function fmtDate(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return s }
}
function fmtRel(s) {
  if (!s) return '—'
  try {
    const ts = new Date(s).getTime()
    const diff = (Date.now() - ts) / 1000
    if (diff < 60) return 'только что'
    if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`
    if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} д назад`
    return new Date(s).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return s }
}

const SORT_OPTIONS = [
  { value: 'last_seen_desc', label: 'Активность ↓' },
  { value: 'last_seen_asc',  label: 'Активность ↑' },
  { value: 'created_desc',   label: 'Регистрация ↓' },
  { value: 'created_asc',    label: 'Регистрация ↑' },
  { value: 'login_count_desc', label: 'Логинов ↓' },
  { value: 'birthday_soon',  label: 'Скоро ДР' },
]

export default function PatientsTable({ token, onOpenCard, onCreateCampaign, onSaveSegment, onBulkTag }) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [limit] = useState(50)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState(new Set())

  // фильтры
  const [q, setQ] = useState('')
  const [lastFrom, setLastFrom] = useState('')
  const [lastTo, setLastTo] = useState('')
  const [loginMin, setLoginMin] = useState('')
  const [loginMax, setLoginMax] = useState('')
  const [bdayDays, setBdayDays] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [hasApps, setHasApps] = useState(false)
  const [sort, setSort] = useState('last_seen_desc')

  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    if (lastFrom) p.set('last_login_from', lastFrom)
    if (lastTo)   p.set('last_login_to', lastTo)
    if (loginMin !== '') p.set('login_count_min', loginMin)
    if (loginMax !== '') p.set('login_count_max', loginMax)
    if (bdayDays !== '') p.set('birthday_in_next_days', bdayDays)
    if (tagFilter.trim()) p.set('has_tag', tagFilter.trim())
    if (hasApps) p.set('has_appointments_in_tenant', 'true')
    if (sort) p.set('sort', sort)
    p.set('limit', String(limit))
    p.set('offset', String(offset))
    return p.toString()
  }, [q, lastFrom, lastTo, loginMin, loginMax, bdayDays, tagFilter, hasApps, sort, limit, offset])

  const load = useCallback(() => {
    let stop = false
    setLoading(true)
    apiFetch(token, `/api/engagement/patients?${queryString}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (stop) return
        setItems(d?.items || [])
        setTotal(d?.total ?? (d?.items?.length || 0))
        setLoading(false)
      })
      .catch(() => { if (!stop) setLoading(false) })
    return () => { stop = true }
  }, [token, queryString])

  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => { setOffset(0); setSelected(new Set()) }, [q, lastFrom, lastTo, loginMin, loginMax, bdayDays, tagFilter, hasApps, sort])

  function toggleOne(id) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  function toggleAll() {
    if (selected.size === items.length) setSelected(new Set())
    else setSelected(new Set(items.map(i => i.id)))
  }
  function clearSelection() { setSelected(new Set()) }

  function resetFilters() {
    setQ(''); setLastFrom(''); setLastTo(''); setLoginMin(''); setLoginMax('')
    setBdayDays(''); setTagFilter(''); setHasApps(false); setSort('last_seen_desc')
  }

  const sel = Array.from(selected)
  const totalPages = Math.max(1, Math.ceil((total || 0) / limit))
  const curPage = Math.floor(offset / limit) + 1

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-6 gap-2">
          <div className="md:col-span-2">
            <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-0.5">Поиск</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 material-symbols-outlined text-base text-gray-400">search</span>
              <input
                value={q} onChange={e => setQ(e.target.value)}
                placeholder="Имя, телефон, email…"
                className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-0.5">Last seen от</label>
            <input type="date" value={lastFrom} onChange={e => setLastFrom(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-0.5">Last seen до</label>
            <input type="date" value={lastTo} onChange={e => setLastTo(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-0.5">Логинов</label>
            <div className="flex gap-1">
              <input type="number" min="0" placeholder="мин" value={loginMin} onChange={e => setLoginMin(e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
              <input type="number" min="0" placeholder="макс" value={loginMax} onChange={e => setLoginMax(e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-0.5">ДР через ≤ дней</label>
            <input type="number" min="0" max="365" value={bdayDays} onChange={e => setBdayDays(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-0.5">Тэг</label>
            <input value={tagFilter} onChange={e => setTagFilter(e.target.value)} placeholder="напр. vip"
              className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-0.5">Сортировка</label>
            <select value={sort} onChange={e => setSort(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 md:col-span-2">
            <input type="checkbox" checked={hasApps} onChange={e => setHasApps(e.target.checked)}
              className="h-4 w-4 rounded text-cyan-600" />
            Есть приёмы в клинике
          </label>
          <button onClick={resetFilters}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Сбросить
          </button>
        </div>
      </div>

      {/* Bulk-action bar */}
      {sel.length > 0 && (
        <div className="sticky top-0 z-10 bg-gradient-to-r from-cyan-50 to-teal-50 dark:from-cyan-900/30 dark:to-teal-900/30 border border-cyan-200 dark:border-cyan-800 rounded-xl px-4 py-2 flex items-center gap-3 shadow">
          <span className="text-sm font-semibold text-cyan-800 dark:text-cyan-200">Выбрано: {sel.length}</span>
          <button onClick={() => onBulkTag && onBulkTag(sel)}
            className="px-3 py-1 rounded-lg bg-white dark:bg-gray-800 border border-cyan-200 dark:border-cyan-700 text-sm flex items-center gap-1 hover:bg-cyan-50 dark:hover:bg-cyan-900/40">
            <span className="material-symbols-outlined text-base">sell</span>Тэг
          </button>
          <button onClick={() => onSaveSegment && onSaveSegment(sel)}
            className="px-3 py-1 rounded-lg bg-white dark:bg-gray-800 border border-cyan-200 dark:border-cyan-700 text-sm flex items-center gap-1 hover:bg-cyan-50 dark:hover:bg-cyan-900/40">
            <span className="material-symbols-outlined text-base">save</span>Сохранить сегмент
          </button>
          <button onClick={() => onCreateCampaign && onCreateCampaign(sel)}
            className="px-3 py-1 rounded-lg bg-cyan-600 text-white text-sm flex items-center gap-1 hover:bg-cyan-700">
            <span className="material-symbols-outlined text-base">campaign</span>Создать кампанию
          </button>
          <button onClick={clearSelection} className="ml-auto text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            Очистить
          </button>
        </div>
      )}

      {/* Таблица */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/50 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input type="checkbox"
                    checked={items.length > 0 && selected.size === items.length}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded text-cyan-600" />
                </th>
                <th className="px-3 py-2">Пациент</th>
                <th className="px-3 py-2 hidden md:table-cell">Email</th>
                <th className="px-3 py-2 hidden lg:table-cell">ДР</th>
                <th className="px-3 py-2 text-center">Логинов</th>
                <th className="px-3 py-2">Last seen</th>
                <th className="px-3 py-2 hidden xl:table-cell">Тэги</th>
                <th className="px-3 py-2 text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">Загрузка…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <span className="material-symbols-outlined text-3xl text-gray-300 dark:text-gray-600">search_off</span>
                    Не найдено пациентов по фильтрам
                  </div>
                </td></tr>
              )}
              {items.map(p => (
                <tr key={p.id} className="border-t border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-900/30 transition">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)}
                      className="h-4 w-4 rounded text-cyan-600" />
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => onOpenCard && onOpenCard(p.id)} className="text-left">
                      <div className="font-semibold text-gray-900 dark:text-white hover:text-cyan-600 transition">
                        {p.name || '—'}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{p.phone || ''}</div>
                    </button>
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell text-gray-600 dark:text-gray-300 truncate max-w-[200px]">{p.email || '—'}</td>
                  <td className="px-3 py-2 hidden lg:table-cell text-gray-600 dark:text-gray-300">{fmtDate(p.birth_date)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-xs">
                      <span className="material-symbols-outlined text-xs">login</span>{p.login_count || 0}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap" title={p.last_seen_at}>
                    {fmtRel(p.last_seen_at)}
                  </td>
                  <td className="px-3 py-2 hidden xl:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {(p.tags || []).slice(0, 3).map((t, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300">
                          {typeof t === 'string' ? t : (t.name || t.tag)}
                        </span>
                      ))}
                      {(p.tags || []).length > 3 && (
                        <span className="text-[10px] text-gray-400">+{p.tags.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button title="Открыть карточку" onClick={() => onOpenCard && onOpenCard(p.id)}
                        className="p-1.5 rounded-lg hover:bg-cyan-50 dark:hover:bg-cyan-900/40 text-cyan-600">
                        <span className="material-symbols-outlined text-base">badge</span>
                      </button>
                      <button title="Push пациенту" onClick={() => onCreateCampaign && onCreateCampaign([p.id])}
                        className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/40 text-emerald-600">
                        <span className="material-symbols-outlined text-base">notifications_active</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Пагинация */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 dark:border-gray-700 text-sm">
          <div className="text-gray-500 dark:text-gray-400">
            Всего: <b>{total.toLocaleString('ru')}</b> · Страница {curPage} из {totalPages}
          </div>
          <div className="flex gap-1">
            <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}
              className="px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700">
              ← Назад
            </button>
            <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total}
              className="px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700">
              Вперёд →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
