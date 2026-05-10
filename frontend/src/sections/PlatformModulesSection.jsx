/**
 * PlatformModulesSection — Module Monitoring System (super_admin heatmap).
 *
 * Heatmap-таблица: строки = тенанты, колонки = модули, ячейки = цветные точки
 * с tooltip (status + last_error). Сверху — Top-10 проблемных тенантов и
 * фильтр по статусу.
 *
 * Бэкенд: GET /admin/modules/health/all  → { tenants, top_problematic }
 *         POST /admin/modules/health/check-now (без tenant_id = все)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../api'

const STATUS_COLORS = {
  ok:       '#22c55e',
  degraded: '#f59e0b',
  error:    '#ef4444',
  idle:     '#94a3b8',
  unknown:  '#cbd5e1',
}
const STATUS_EMOJI = {
  ok: '✅', degraded: '⚠️', error: '❌', idle: '💤', unknown: '❔',
}
const STATUS_LABEL = {
  ok: 'OK', degraded: 'Degraded', error: 'Error', idle: 'Idle',
  unknown: 'Unknown',
}

function fmtTime(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit',
      day: '2-digit', month: '2-digit' })
  } catch { return '—' }
}

export default function PlatformModulesSection({ token } = {}) {
  const [data, setData] = useState({ tenants: [], top_problematic: [] })
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [filterStatus, setFilterStatus] = useState('all')
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const timerRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const url = filterStatus === 'all'
        ? '/admin/modules/health/all'
        : `/admin/modules/health/all?status_filter=${encodeURIComponent(filterStatus)}`
      const res = await api({ method: 'GET', url })
      setData(res.data || { tenants: [], top_problematic: [] })
      setUpdatedAt(new Date())
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }, [filterStatus])

  const checkNow = useCallback(async () => {
    setRunning(true); setError(null)
    try {
      await api({ method: 'POST', url: '/admin/modules/health/check-now' })
      await load()
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Ошибка')
    } finally {
      setRunning(false)
    }
  }, [load])

  useEffect(() => {
    load()
    timerRef.current = setInterval(load, 60_000)
    return () => clearInterval(timerRef.current)
  }, [load])

  // Уникальные ключи модулей по всем тенантам — формируют колонки таблицы
  const moduleKeys = useMemo(() => {
    const set = new Set()
    for (const t of data.tenants || []) {
      for (const m of t.modules || []) set.add(m.module_key)
    }
    return Array.from(set).sort()
  }, [data])

  const totals = useMemo(() => {
    const out = { ok: 0, degraded: 0, error: 0, idle: 0, unknown: 0 }
    for (const t of data.tenants || []) {
      for (const m of t.modules || []) {
        const s = m.health?.status || 'unknown'
        out[s] = (out[s] || 0) + 1
      }
    }
    return out
  }, [data])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(STATUS_LABEL).map(([k, label]) => (
            <span key={k}
                  className="text-xs px-2.5 py-1 rounded-full font-semibold
                             bg-white dark:bg-gray-800 ring-1 ring-gray-200
                             dark:ring-gray-700">
              {STATUS_EMOJI[k]} {label}: <b>{totals[k] || 0}</b>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-sm px-2 py-1 rounded-lg border border-gray-300
                       dark:border-gray-600 bg-white dark:bg-gray-800">
            <option value="all">Все статусы</option>
            <option value="error">Только Error</option>
            <option value="degraded">Только Degraded</option>
            <option value="error,degraded">Error + Degraded</option>
            <option value="idle">Только Idle</option>
          </select>
          {updatedAt && (
            <span className="text-xs text-gray-500">
              Обновлено: {updatedAt.toLocaleTimeString('ru-RU')}
            </span>
          )}
          <button
            onClick={checkNow}
            disabled={running}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold
                       bg-[#0097A7] text-white hover:bg-[#00838f]
                       disabled:opacity-50 transition">
            {running ? 'Проверяем…' : 'Проверить все тенанты'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-700 dark:text-red-300 bg-red-50
                        dark:bg-red-950/40 rounded-lg p-3 ring-1 ring-red-200
                        dark:ring-red-800">
          {error}
        </div>
      )}

      {/* Top-10 проблемных тенантов */}
      {data.top_problematic && data.top_problematic.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl ring-1
                        ring-gray-200 dark:ring-gray-700 p-4">
          <div className="text-sm font-semibold uppercase tracking-wider
                          text-gray-500 mb-2">
            Top-10 проблемных тенантов
          </div>
          <div className="flex flex-wrap gap-2">
            {data.top_problematic.map(p => (
              <span key={p.tenant_id}
                    className="text-xs px-2.5 py-1 rounded-full
                               bg-red-50 text-red-700 ring-1 ring-red-200
                               dark:bg-red-950/40 dark:text-red-300
                               dark:ring-red-800 font-semibold">
                {p.tenant_name} <b>·</b> score {p.score}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Heatmap */}
      <div className="bg-white dark:bg-gray-800 rounded-xl ring-1
                      ring-gray-200 dark:ring-gray-700 overflow-x-auto">
        {loading && (data.tenants || []).length === 0 ? (
          <div className="p-6 text-gray-400 text-sm">Загрузка…</div>
        ) : (data.tenants || []).length === 0 ? (
          <div className="p-6 text-gray-500 text-sm">
            Нет данных по фильтру. Запустите «Проверить все тенанты».
          </div>
        ) : (
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-900/40 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-semibold uppercase
                               tracking-wider text-gray-500 sticky left-0
                               bg-gray-50 dark:bg-gray-900/40">
                  Тенант
                </th>
                {moduleKeys.map(k => (
                  <th key={k}
                      className="px-2 py-2 font-mono text-[10px] text-gray-500
                                 -rotate-45 origin-bottom-left whitespace-nowrap
                                 h-24 align-bottom"
                      style={{ minWidth: 24 }}>
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.tenants.map(t => (
                <tr key={t.tenant_id}
                    className="border-t border-gray-100 dark:border-gray-700">
                  <td className="px-3 py-1.5 font-medium text-gray-900
                                 dark:text-gray-100 sticky left-0
                                 bg-white dark:bg-gray-800 whitespace-nowrap">
                    <div>{t.tenant_name}</div>
                    <div className="text-[10px] font-mono text-gray-400">
                      {t.tenant_slug}
                    </div>
                  </td>
                  {moduleKeys.map(k => {
                    const m = (t.modules || []).find(x => x.module_key === k)
                    const s = m?.health?.status || null
                    const color = s ? STATUS_COLORS[s] : 'transparent'
                    const tip = m
                      ? `${k}\nStatus: ${STATUS_LABEL[s] || '—'}\n` +
                        `Проверено: ${fmtTime(m.health?.last_check_at)}\n` +
                        (m.health?.last_error_message
                          ? `Ошибка: ${m.health.last_error_message.slice(0, 200)}`
                          : '')
                      : 'Не подключён'
                    return (
                      <td key={k} className="px-1 py-1 text-center">
                        {m ? (
                          <span title={tip}
                                className="inline-block w-3.5 h-3.5 rounded-full"
                                style={{ background: color }} />
                        ) : (
                          <span className="text-gray-300">·</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
