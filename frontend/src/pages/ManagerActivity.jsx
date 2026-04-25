import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getActivityLog } from '../api'

function PageHeader({ title, icon, color }) {
  const nav = useNavigate()
  return (
    <div className="sticky top-14 z-30 bg-[#f7f9fb]/90 dark:bg-gray-900/90 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-[#eceef0]/60 dark:border-gray-700/60 mb-4">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/manager')} className="w-8 h-8 rounded-xl bg-white dark:bg-gray-800 flex items-center justify-center shadow-sm active:scale-95 transition-transform">
          <span className="material-symbols-outlined text-[#727783] text-xl">arrow_back_ios_new</span>
        </button>
        <div className="flex items-center gap-2">
          <span className={`material-symbols-outlined text-xl ${color}`} style={{ fontVariationSettings:"'FILL' 1" }}>{icon}</span>
          <h1 className="text-lg font-extrabold text-[#191c1e] dark:text-white font-headline">{title}</h1>
        </div>
      </div>
    </div>
  )
}

function actionMeta(action) {
  if (!action) return { icon:'info', bg:'bg-gray-100 dark:bg-gray-700', color:'text-[#727783]' }
  if (action.includes('Создано')) return { icon:'add_circle', bg:'bg-blue-100 dark:bg-blue-900/30', color:'text-blue-600' }
  if (action.includes('Подтверждено')) return { icon:'check_circle', bg:'bg-green-100 dark:bg-green-900/30', color:'text-green-600' }
  if (action.includes('отмен') || action.includes('Отмен') || action.includes('отклон')) return { icon:'cancel', bg:'bg-red-100 dark:bg-red-900/30', color:'text-red-600' }
  if (action.includes('Выплата') || action.includes('бонус')) return { icon:'payments', bg:'bg-amber-100 dark:bg-amber-900/30', color:'text-amber-600' }
  return { icon:'info', bg:'bg-[#f7f9fb] dark:bg-gray-700', color:'text-[#727783]' }
}

function fmtDt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}) + ' ' + d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})
}

export default function ManagerActivity() {
  const [logs, setLogs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage]       = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [error, setError]       = useState('')

  const load = async (p=1, replace=true) => {
    setLoading(true); setError('')
    try {
      const params = { page:p, limit:50 }
      if (dateFrom) params.date_from = dateFrom
      if (dateTo)   params.date_to   = dateTo
      const r = await getActivityLog(params)
      const items = Array.isArray(r.data) ? r.data : []
      setHasMore(items.length===50)
      setLogs(prev => replace ? items : [...prev, ...items])
      setPage(p)
    } catch { setError('Ошибка загрузки журнала') } finally { setLoading(false) }
  }

  useEffect(() => { load(1,true) }, [dateFrom, dateTo])

  return (
    <div className="bg-[#f7f9fb] dark:bg-gray-900 min-h-screen pb-24">
      <PageHeader title="Журнал активности" icon="article" color="text-[#7c3aed]" />
      <div className="px-4">
        {/* Фильтр */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 mb-4 flex gap-3" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-[#727783] uppercase tracking-wider mb-1">С даты</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full bg-[#f7f9fb] dark:bg-gray-700 rounded-xl px-3 py-2 text-sm text-[#191c1e] dark:text-white outline-none border-2 border-transparent focus:border-[#0097A7]/40 focus:bg-white transition-all" />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-[#727783] uppercase tracking-wider mb-1">По дату</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full bg-[#f7f9fb] dark:bg-gray-700 rounded-xl px-3 py-2 text-sm text-[#191c1e] dark:text-white outline-none border-2 border-transparent focus:border-[#0097A7]/40 focus:bg-white transition-all" />
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-2xl p-3 mb-4"><p className="text-red-600 text-sm">{error}</p></div>}

        {loading && logs.length===0 ? (
          <div className="flex items-center justify-center py-24"><div className="w-8 h-8 rounded-full border-4 border-[#0097A7]/20 border-t-[#0097A7] animate-spin" /></div>
        ) : logs.length===0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 text-center" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
            <span className="material-symbols-outlined text-5xl text-[#eceef0] dark:text-gray-600 block mb-3">article</span>
            <p className="text-[#727783] text-sm">Нет событий</p>
          </div>
        ) : (
          <>
            <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
              {logs.map((log,i) => {
                const meta = actionMeta(log.action)
                return (
                  <div key={log.id} className={`flex items-start gap-3 px-4 py-3 ${i<logs.length-1 ? 'border-b border-[#f7f9fb] dark:border-gray-700/50' : ''}`}>
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
                      <span className={`material-symbols-outlined text-[16px] ${meta.color}`} style={{ fontVariationSettings:"'FILL' 1" }}>{meta.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#191c1e] dark:text-white">{log.action}</p>
                      {log.user_name && <p className="text-xs text-[#727783]">{log.user_name}</p>}
                      {log.entity_type && <p className="text-xs text-[#727783]">{log.entity_type}</p>}
                    </div>
                    <p className="text-xs text-[#727783] flex-shrink-0">{fmtDt(log.created_at)}</p>
                  </div>
                )
              })}
            </div>
            {hasMore && (
              <button onClick={() => load(page+1, false)} disabled={loading}
                className="w-full mt-3 border-2 border-[#eceef0] dark:border-gray-600 text-[#727783] dark:text-gray-300 rounded-xl py-3 text-sm font-bold disabled:opacity-50 hover:border-[#0097A7] hover:text-[#0097A7] transition-colors">
                {loading ? 'Загрузка...' : 'Загрузить ещё'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
