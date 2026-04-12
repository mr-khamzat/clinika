import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAnalytics } from '../api'

function fmt(n) {
  return typeof n === 'number' ? n.toLocaleString('ru-RU') : '—'
}

// Pure SVG line/bar chart for daily data
function DailyChart({ data }) {
  if (!data || data.length === 0) return <div className="text-center text-gray-400 text-sm py-8">Нет данных</div>

  const W = 340
  const H = 120
  const PAD = { top: 10, right: 10, bottom: 30, left: 36 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const maxVal = Math.max(...data.map(d => d.total), 1)
  const step = chartW / (data.length - 1 || 1)

  const toX = (i) => PAD.left + i * step
  const toY = (v) => PAD.top + chartH - (v / maxVal) * chartH

  const polylineTotal = data.map((d, i) => `${toX(i)},${toY(d.total)}`).join(' ')
  const polylineConf = data.map((d, i) => `${toX(i)},${toY(d.confirmed)}`).join(' ')

  // Grid lines
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(pct => {
    const val = Math.round(maxVal * pct)
    const y = toY(val)
    return { y, val }
  })

  // Day labels every 5 days
  const labels = data
    .map((d, i) => ({ i, label: d.date.slice(8) }))
    .filter(({ i }) => i % 5 === 0 || i === data.length - 1)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 140 }}>
      {/* Grid */}
      {gridLines.map(({ y, val }) => (
        <g key={y}>
          <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#f0f0f0" strokeWidth="1" />
          <text x={PAD.left - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#aaa">{val}</text>
        </g>
      ))}

      {/* Lines */}
      <polyline points={polylineTotal} fill="none" stroke="#2563EB" strokeWidth="2" strokeLinejoin="round" />
      <polyline points={polylineConf} fill="none" stroke="#16A34A" strokeWidth="2" strokeLinejoin="round" strokeDasharray="4,2" />

      {/* Points */}
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={toX(i)} cy={toY(d.total)} r="2.5" fill="#2563EB" />
          <circle cx={toX(i)} cy={toY(d.confirmed)} r="2" fill="#16A34A" />
        </g>
      ))}

      {/* X labels */}
      {labels.map(({ i, label }) => (
        <text key={i} x={toX(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="#999">{label}</text>
      ))}
    </svg>
  )
}

export default function ManagerAnalytics() {
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    getAnalytics()
      .then(r => setData(r.data))
      .catch(() => setError('Ошибка загрузки аналитики'))
      .finally(() => setLoading(false))
  }, [])

  const conv = data?.conversion_rate ?? 0
  const thisMonth = data?.this_month ?? {}
  const lastMonth = data?.last_month ?? {}

  return (
    <div className="p-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => nav('/manager')} className="text-gray-400 hover:text-gray-600">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className="text-xl font-bold text-gray-800">Аналитика</h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 py-16">Загрузка...</div>
      ) : (
        <>
          {/* Conversion rate widget */}
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-4 flex items-center gap-4">
            <div className="flex-1">
              <p className="text-xs text-gray-500 font-medium mb-1">Конверсия (30 дней)</p>
              <p className="text-4xl font-bold text-primary">{conv}%</p>
              <p className="text-xs text-gray-400 mt-1">подтверждено / создано</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-gray-700">{fmt(data?.daily?.reduce((s,d) => s+d.total, 0))} направлений</p>
              <p className="text-sm text-green-600 font-medium">{fmt(data?.daily?.reduce((s,d) => s+d.confirmed, 0))} подтверждено</p>
            </div>
          </div>

          {/* Daily chart */}
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-700">График за 30 дней</p>
              <div className="flex gap-3 text-xs text-gray-400">
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-primary inline-block"></span>Всего</span>
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-green-600 inline-block border-dashed"></span>Подтв.</span>
              </div>
            </div>
            <DailyChart data={data?.daily} />
          </div>

          {/* Month comparison */}
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">Сравнение месяцев</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div></div>
              <div className="text-xs font-semibold text-primary">Этот месяц</div>
              <div className="text-xs font-semibold text-gray-400">Прошлый</div>

              <div className="text-xs text-gray-500 text-left py-1">Направлений</div>
              <div className="text-sm font-bold text-gray-800">{fmt(thisMonth.total)}</div>
              <div className="text-sm text-gray-400">{fmt(lastMonth.total)}</div>

              <div className="text-xs text-gray-500 text-left py-1">Подтверждено</div>
              <div className="text-sm font-bold text-green-600">{fmt(thisMonth.confirmed)}</div>
              <div className="text-sm text-gray-400">{fmt(lastMonth.confirmed)}</div>

              <div className="text-xs text-gray-500 text-left py-1">Бонусы</div>
              <div className="text-sm font-bold text-amber-600">{fmt(thisMonth.bonuses)} Б</div>
              <div className="text-sm text-gray-400">{fmt(lastMonth.bonuses)} Б</div>
            </div>
          </div>

          {/* Top services */}
          <div className="bg-white rounded-2xl shadow-sm mb-4 overflow-hidden">
            <div className="p-4 border-b border-gray-50">
              <p className="text-sm font-semibold text-gray-700">Топ услуг</p>
            </div>
            {(data?.top_services ?? []).length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-sm">Нет данных</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-50">
                    <th className="text-left text-xs text-gray-400 font-medium px-4 py-2">Услуга</th>
                    <th className="text-right text-xs text-gray-400 font-medium px-2 py-2">Всего</th>
                    <th className="text-right text-xs text-gray-400 font-medium px-2 py-2">Подтв.</th>
                    <th className="text-right text-xs text-gray-400 font-medium px-4 py-2">Бонусы</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.top_services ?? []).map((s, i) => (
                    <tr key={s.service_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                      <td className="px-4 py-2.5 text-gray-700 font-medium text-xs">{s.name}</td>
                      <td className="px-2 py-2.5 text-right text-gray-700">{s.total}</td>
                      <td className="px-2 py-2.5 text-right text-green-600 font-medium">{s.confirmed}</td>
                      <td className="px-4 py-2.5 text-right text-amber-600 font-medium">{fmt(s.bonus_total)} Б</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Per-admin conversion */}
          <div className="bg-white rounded-2xl shadow-sm mb-4 overflow-hidden">
            <div className="p-4 border-b border-gray-50">
              <p className="text-sm font-semibold text-gray-700">Конверсия по сотрудникам</p>
            </div>
            {(data?.admin_conversion ?? []).length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-sm">Нет данных</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {(data?.admin_conversion ?? []).map(a => (
                  <div key={a.admin_id} className="px-4 py-3">
                    <div className="flex justify-between items-start mb-1">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{a.full_name}</p>
                        <p className="text-xs text-gray-400">{a.clinic_name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-primary">{a.conversion_pct}%</p>
                        <p className="text-xs text-gray-400">{a.confirmed}/{a.total}</p>
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                      <div
                        className="bg-primary h-1.5 rounded-full transition-all"
                        style={{ width: `${Math.min(a.conversion_pct, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Clinic comparison */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-50">
              <p className="text-sm font-semibold text-gray-700">Сравнение клиник</p>
            </div>
            {(data?.clinic_comparison ?? []).length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-sm">Нет данных</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-50">
                    <th className="text-left text-xs text-gray-400 font-medium px-4 py-2">Клиника</th>
                    <th className="text-right text-xs text-gray-400 font-medium px-2 py-2">Напр.</th>
                    <th className="text-right text-xs text-gray-400 font-medium px-2 py-2">Подтв.</th>
                    <th className="text-right text-xs text-gray-400 font-medium px-4 py-2">Конв.</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.clinic_comparison ?? []).map((c, i) => (
                    <tr key={c.clinic_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                      <td className="px-4 py-2.5 text-gray-700 text-xs font-medium">{c.name}</td>
                      <td className="px-2 py-2.5 text-right text-gray-700">{c.total}</td>
                      <td className="px-2 py-2.5 text-right text-green-600">{c.confirmed}</td>
                      <td className="px-4 py-2.5 text-right text-primary font-semibold">{c.conversion_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
