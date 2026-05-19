/**
 * VisibilitySection — матрица видимости между клиниками одной франшизы.
 *
 * Доступно: super_admin / franchise_owner.
 * Что делает: для каждой пары (viewer, target) тенантов франшизы — два
 * чекбокса (Chat / Calls). Снятый чекбокс = пользователи viewer'а НЕ видят
 * пользователей target'а в соответствующем модуле. По умолчанию (если запись
 * не сохранена) — оба true (всё видно).
 */
import { useEffect, useState, useMemo } from 'react'
import api from '../api'

export default function VisibilitySection() {
  const [tenants, setTenants] = useState([])
  const [cells, setCells] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api.get('/franchise/visibility')
      .then(r => {
        setTenants(r.data.tenants || [])
        setCells(r.data.cells || [])
        setLoading(false)
      })
      .catch(e => { setMsg('Ошибка загрузки: ' + (e.message || e)); setLoading(false) })
  }, [])

  const cellMap = useMemo(() => {
    const m = {}
    for (const c of cells) m[`${c.viewer_tenant_id}->${c.target_tenant_id}`] = c
    return m
  }, [cells])

  const getCell = (v, t) => cellMap[`${v}->${t}`] || { viewer_tenant_id: v, target_tenant_id: t, allow_chat: true, allow_calls: true }

  const updateCell = (v, t, patch) => {
    const key = `${v}->${t}`
    setCells(prev => {
      const exists = prev.some(c => c.viewer_tenant_id === v && c.target_tenant_id === t)
      if (exists) {
        return prev.map(c => (c.viewer_tenant_id === v && c.target_tenant_id === t) ? { ...c, ...patch } : c)
      }
      const base = { viewer_tenant_id: v, target_tenant_id: t, allow_chat: true, allow_calls: true }
      return [...prev, { ...base, ...patch }]
    })
  }

  const save = async () => {
    setSaving(true); setMsg('')
    try {
      const r = await api.put('/franchise/visibility', { cells })
      setMsg(`Сохранено: обновлено ${r.data.updated} ячеек`)
      // Обновим состояние из ответа сервера
      const refresh = await api.get('/franchise/visibility')
      setCells(refresh.data.cells || [])
    } catch (e) {
      setMsg('Ошибка сохранения: ' + (e.response?.data?.detail || e.message))
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(''), 4000)
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-400">Загрузка матрицы…</div>

  if (!tenants.length) {
    return (
      <div className="p-8 text-center">
        <div className="text-amber-600 dark:text-amber-400 font-semibold mb-2">Нет франшизы</div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Управление видимостью доступно только для тенантов привязанных к франшизе.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Видимость между клиниками</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Матрица: кто из какой клиники видит кого в чате и звонках.
            По умолчанию — всё видно. Снимите галочку, чтобы скрыть.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition"
        >
          {saving ? 'Сохранение…' : 'Сохранить матрицу'}
        </button>
      </div>

      {msg && (
        <div className={`text-sm px-4 py-2 rounded-lg ${msg.startsWith('Ошибка') ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'}`}>
          {msg}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <th className="text-left px-3 py-2 font-semibold text-gray-700 dark:text-gray-200 sticky left-0 bg-gray-50 dark:bg-gray-700/50 z-10">
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Кто смотрит ↓</div>
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-0.5">На кого →</div>
              </th>
              {tenants.map(t => (
                <th key={t.id} className="px-3 py-2 font-semibold text-gray-800 dark:text-gray-100 text-center border-l border-gray-200 dark:border-gray-700">
                  <div className="text-xs uppercase tracking-wide">{t.slug}</div>
                  <div className="text-xs font-normal text-gray-500 dark:text-gray-400">{t.name}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tenants.map(v => (
              <tr key={v.id} className="border-t border-gray-100 dark:border-gray-700">
                <td className="px-3 py-2 font-semibold text-gray-900 dark:text-gray-100 sticky left-0 bg-white dark:bg-gray-800 z-10">
                  <div className="text-xs uppercase tracking-wide">{v.slug}</div>
                  <div className="text-xs font-normal text-gray-500 dark:text-gray-400">{v.name}</div>
                </td>
                {tenants.map(t => {
                  if (v.id === t.id) {
                    return (
                      <td key={t.id} className="px-3 py-2 text-center border-l border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 text-gray-300 dark:text-gray-600">
                        —
                      </td>
                    )
                  }
                  const c = getCell(v.id, t.id)
                  const isDefault = c.allow_chat && c.allow_calls
                  return (
                    <td key={t.id} className={`px-3 py-2 border-l border-gray-100 dark:border-gray-700 ${!isDefault ? 'bg-amber-50 dark:bg-amber-900/10' : ''}`}>
                      <div className="flex flex-col gap-1 items-center">
                        <label className="flex items-center gap-1 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={c.allow_chat}
                            onChange={e => updateCell(v.id, t.id, { allow_chat: e.target.checked })}
                            className="w-3.5 h-3.5 accent-cyan-600"
                          />
                          <span className="text-gray-700 dark:text-gray-300">💬 Чат</span>
                        </label>
                        <label className="flex items-center gap-1 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={c.allow_calls}
                            onChange={e => updateCell(v.id, t.id, { allow_calls: e.target.checked })}
                            className="w-3.5 h-3.5 accent-cyan-600"
                          />
                          <span className="text-gray-700 dark:text-gray-300">📞 Звонки</span>
                        </label>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Подсказка: жёлтым подсвечены ячейки с ограничением. Чёрта — сама клиника (видит себя всегда).
        Изменения применяются сразу после кнопки «Сохранить».
      </p>
    </div>
  )
}
