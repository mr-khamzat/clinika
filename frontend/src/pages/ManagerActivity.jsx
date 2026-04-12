import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getActivityLog } from '../api'

function actionIcon(action) {
  if (!action) return null
  if (action.includes('Создано')) return (
    <span className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </span>
  )
  if (action.includes('Подтверждено')) return (
    <span className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    </span>
  )
  if (action.includes('отмен') || action.includes('Отмен') || action.includes('отклон')) return (
    <span className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </span>
  )
  if (action.includes('Выплата') || action.includes('бонус')) return (
    <span className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
    </span>
  )
  return (
    <span className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    </span>
  )
}

function fmtDt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export default function ManagerActivity() {
  const nav = useNavigate()
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [error, setError] = useState('')

  const load = async (p = 1, replace = true) => {
    setLoading(true)
    setError('')
    try {
      const params = { page: p, limit: 50 }
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const res = await getActivityLog(params)
      const items = Array.isArray(res.data) ? res.data : []
      setHasMore(items.length === 50)
      setLogs(prev => replace ? items : [...prev, ...items])
      setPage(p)
    } catch {
      setError('Ошибка загрузки журнала')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(1, true) }, [dateFrom, dateTo])

  return (
    <div className="p-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => nav('/manager')} className="text-gray-400 hover:text-gray-600">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className="text-xl font-bold text-gray-800">Журнал активности</h1>
      </div>

      {/* Date filter */}
      <div className="bg-white rounded-2xl p-4 shadow-sm mb-4 flex gap-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">С даты</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-full border border-gray-200 rounded-xl p-2 text-sm focus:outline-none focus:border-primary"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">По дату</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-full border border-gray-200 rounded-xl p-2 text-sm focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {loading && logs.length === 0 ? (
        <div className="text-center text-gray-400 py-16">Загрузка...</div>
      ) : logs.length === 0 ? (
        <div className="text-center text-gray-400 py-16">Нет событий</div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {logs.map((log, i) => (
              <div
                key={log.id}
                className={`flex items-start gap-3 px-4 py-3 ${i < logs.length - 1 ? 'border-b border-gray-50' : ''}`}
              >
                {actionIcon(log.action)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{log.action}</p>
                  {log.user_name && (
                    <p className="text-xs text-gray-500">{log.user_name}</p>
                  )}
                  {log.entity_type && (
                    <p className="text-xs text-gray-400">{log.entity_type}</p>
                  )}
                </div>
                <p className="text-xs text-gray-400 flex-shrink-0">{fmtDt(log.created_at)}</p>
              </div>
            ))}
          </div>

          {hasMore && (
            <button
              onClick={() => load(page + 1, false)}
              disabled={loading}
              className="w-full mt-4 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Загрузка...' : 'Загрузить ещё'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
