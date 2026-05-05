/**
 * AppointmentsStatsSection — дашборд статистики записей для франшизы и супервизора.
 * Показывает: KPI total/today/byStatus + таблицу врачей с разбивкой по статусам.
 *
 * Backend: GET /appointments/stats?days=N
 */
import { useEffect, useState } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

const authH = t => ({ Authorization: `Bearer ${t}` })

const STATUS_LABEL = {
  pending: 'Ожидает',
  confirmed: 'Подтв.',
  cancelled: 'Отмена',
  completed: 'Заверш.',
  no_show: 'Не пришёл',
}
const STATUS_COLOR = {
  pending: '#f59e0b',
  confirmed: '#10b981',
  cancelled: '#ef4444',
  completed: '#6b7280',
  no_show: '#eab308',
}

export default function AppointmentsStatsSection({ token }) {
  const [days, setDays]     = useState(30)
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    axios.get(`${API_BASE}/appointments/stats`, { headers: authH(token), params: { days } })
      .then(r => setData(r.data))
      .catch(() => setData({ total: 0, today: 0, by_status: {}, doctors: [] }))
      .finally(() => setLoading(false))
  }, [days])

  if (loading) return <div className="p-6 text-center text-gray-500">Загрузка…</div>
  if (!data) return null

  return (
    <div className="px-4 pb-24 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-black mb-1">Записи к врачам</h2>
          <p className="text-sm text-gray-500">Статистика онлайн-записи за выбранный период.</p>
        </div>
        <div className="flex bg-gray-100 rounded-xl p-1">
          {[7, 30, 90, 365].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${days === d ? 'bg-white shadow' : 'text-gray-500'}`}>
              {d}д
            </button>
          ))}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Kpi label="Всего" value={data.total} accent="#7c3aed" />
        <Kpi label="Сегодня" value={data.today} accent="#10b981" />
        <Kpi label="Подтверждённых" value={data.by_status?.confirmed || 0} accent="#059669" />
        <Kpi label="Отменённых" value={data.by_status?.cancelled || 0} accent="#dc2626" />
      </div>

      {/* По статусам — стек */}
      {data.total > 0 && (
        <div className="bg-white rounded-2xl p-4 border border-gray-100 mb-5">
          <div className="text-xs font-bold uppercase text-gray-400 mb-2">Распределение по статусам</div>
          <div className="flex h-8 rounded-lg overflow-hidden bg-gray-50">
            {Object.entries(data.by_status).map(([st, cnt]) => {
              const pct = (cnt / data.total) * 100
              return (
                <div key={st} title={`${STATUS_LABEL[st] || st}: ${cnt}`}
                  className="h-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ width: `${pct}%`, background: STATUS_COLOR[st] || '#9ca3af' }}>
                  {pct >= 7 ? `${Math.round(pct)}%` : ''}
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {Object.entries(data.by_status).map(([st, cnt]) => (
              <div key={st} className="flex items-center gap-1.5 text-xs">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLOR[st] }}></span>
                <span className="text-gray-600">{STATUS_LABEL[st] || st}</span>
                <span className="font-bold">{cnt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Таблица по врачам */}
      <div className="text-xs font-bold uppercase text-gray-400 mb-2">По врачам</div>
      {data.doctors?.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">Нет данных за период</div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left p-3 font-semibold">Врач</th>
                <th className="text-right p-3 font-semibold">Всего</th>
                <th className="text-right p-3 font-semibold hidden sm:table-cell">Подтв.</th>
                <th className="text-right p-3 font-semibold hidden sm:table-cell">Заверш.</th>
                <th className="text-right p-3 font-semibold hidden md:table-cell">Отмен.</th>
                <th className="text-right p-3 font-semibold hidden md:table-cell">Не пришёл</th>
              </tr>
            </thead>
            <tbody>
              {data.doctors.map(d => (
                <tr key={d.id} className="border-t border-gray-100">
                  <td className="p-3 font-semibold">{d.name}</td>
                  <td className="p-3 text-right font-bold">{d.total}</td>
                  <td className="p-3 text-right text-emerald-600 hidden sm:table-cell">{d.by_status?.confirmed || '—'}</td>
                  <td className="p-3 text-right text-gray-500 hidden sm:table-cell">{d.by_status?.completed || '—'}</td>
                  <td className="p-3 text-right text-rose-600 hidden md:table-cell">{d.by_status?.cancelled || '—'}</td>
                  <td className="p-3 text-right text-amber-600 hidden md:table-cell">{d.by_status?.no_show || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, accent }) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-3xl font-black" style={{ color: accent }}>{value}</div>
    </div>
  )
}
