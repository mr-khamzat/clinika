import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAnalytics } from '../api'

function fmt(n) { return typeof n === 'number' ? n.toLocaleString('ru-RU') : '—' }

function PageHeader({ title, icon, color }) {
  const nav = useNavigate()
  return (
    <div className="sticky top-14 z-30 bg-[#f7f9fb]/90 dark:bg-gray-900/90 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-[#eceef0]/60 dark:border-gray-700/60 mb-4">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/manager')}
          className="w-8 h-8 rounded-xl bg-white dark:bg-gray-800 flex items-center justify-center shadow-sm active:scale-95 transition-transform">
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

function DailyChart({ data }) {
  if (!data || data.length === 0) return <div className="text-center text-[#727783] text-sm py-8">Нет данных</div>
  const W=340, H=120, PAD={top:10,right:10,bottom:30,left:36}
  const chartW=W-PAD.left-PAD.right, chartH=H-PAD.top-PAD.bottom
  const maxVal=Math.max(...data.map(d=>d.total),1)
  const step=chartW/(data.length-1||1)
  const toX=(i)=>PAD.left+i*step
  const toY=(v)=>PAD.top+chartH-(v/maxVal)*chartH
  const polylineTotal=data.map((d,i)=>`${toX(i)},${toY(d.total)}`).join(' ')
  const polylineConf=data.map((d,i)=>`${toX(i)},${toY(d.confirmed)}`).join(' ')
  const gridLines=[0,.25,.5,.75,1].map(pct=>({ y:toY(Math.round(maxVal*pct)), val:Math.round(maxVal*pct) }))
  const labels=data.map((d,i)=>({i,label:d.date.slice(8)})).filter(({i})=>i%5===0||i===data.length-1)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight:140 }}>
      {gridLines.map(({y,val})=>(
        <g key={y}>
          <line x1={PAD.left} y1={y} x2={W-PAD.right} y2={y} stroke="#f0f0f0" strokeWidth="1"/>
          <text x={PAD.left-4} y={y+4} textAnchor="end" fontSize="9" fill="#aaa">{val}</text>
        </g>
      ))}
      <polyline points={polylineTotal} fill="none" stroke="#0097A7" strokeWidth="2.5" strokeLinejoin="round"/>
      <polyline points={polylineConf} fill="none" stroke="#16A34A" strokeWidth="2" strokeLinejoin="round" strokeDasharray="4,2"/>
      {data.map((d,i)=>(
        <g key={i}>
          <circle cx={toX(i)} cy={toY(d.total)} r="2.5" fill="#0097A7"/>
          <circle cx={toX(i)} cy={toY(d.confirmed)} r="2" fill="#16A34A"/>
        </g>
      ))}
      {labels.map(({i,label})=>(
        <text key={i} x={toX(i)} y={H-6} textAnchor="middle" fontSize="9" fill="#999">{label}</text>
      ))}
    </svg>
  )
}

export default function ManagerAnalytics() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    setLoading(true)
    getAnalytics().then(r => setData(r.data)).catch(() => setError('Ошибка загрузки аналитики')).finally(() => setLoading(false))
  }, [])

  const conv      = data?.conversion_rate ?? 0
  const thisMonth = data?.this_month ?? {}
  const lastMonth = data?.last_month ?? {}

  return (
    <div className="bg-[#f7f9fb] dark:bg-gray-900 min-h-screen pb-24">
      <PageHeader title="Аналитика" icon="bar_chart" color="text-[#0097A7]" />

      <div className="px-4">
        {error && <div className="bg-red-50 border border-red-200 rounded-2xl p-3 mb-4"><p className="text-red-600 text-sm">{error}</p></div>}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 rounded-full border-4 border-[#0097A7]/20 border-t-[#0097A7] animate-spin" />
          </div>
        ) : (
          <>
            {/* Конверсия — hero */}
            <div className="rounded-2xl p-5 mb-4 text-white" style={{ background:'linear-gradient(135deg,#0097A7,#006173)', boxShadow:'0 8px 24px rgba(0,151,167,0.25)' }}>
              <p className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-1">Конверсия за 30 дней</p>
              <p className="text-5xl font-extrabold font-headline mb-1">{conv}%</p>
              <p className="text-white/60 text-xs">подтверждено / создано</p>
              <div className="flex gap-6 mt-4 pt-4 border-t border-white/15">
                <div>
                  <p className="text-xl font-bold">{fmt(data?.daily?.reduce((s,d)=>s+d.total,0))}</p>
                  <p className="text-white/60 text-xs">направлений</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-emerald-300">{fmt(data?.daily?.reduce((s,d)=>s+d.confirmed,0))}</p>
                  <p className="text-white/60 text-xs">подтверждено</p>
                </div>
              </div>
            </div>

            {/* График */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 mb-4" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-[#191c1e] dark:text-white">График за 30 дней</p>
                <div className="flex gap-3 text-xs text-[#727783]">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#0097A7] inline-block" />Всего</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#16A34A] inline-block" />Подтв.</span>
                </div>
              </div>
              <DailyChart data={data?.daily} />
            </div>

            {/* Сравнение месяцев */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 mb-4" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
              <p className="text-sm font-bold text-[#191c1e] dark:text-white mb-3">Сравнение месяцев</p>
              <div className="grid grid-cols-2 gap-3">
                {[['Этот месяц', thisMonth, 'border-[#0097A7]', 'text-[#0097A7]'], ['Прошлый', lastMonth, 'border-[#eceef0]', 'text-[#727783]']].map(([label, d, border, titleColor]) => (
                  <div key={label} className={`rounded-xl p-3 border-2 ${border} bg-[#f7f9fb] dark:bg-gray-700`}>
                    <p className={`text-xs font-bold ${titleColor} mb-2`}>{label}</p>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs"><span className="text-[#727783]">Направлений</span><span className="font-bold text-[#191c1e] dark:text-white">{fmt(d.total)}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-[#727783]">Подтверждено</span><span className="font-bold text-[#16A34A]">{fmt(d.confirmed)}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-[#727783]">Бонусы</span><span className="font-bold text-amber-600">{fmt(d.bonuses)} Б</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Топ услуг */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden mb-4" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
              <div className="px-4 py-3 border-b border-[#eceef0] dark:border-gray-700 flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-500 text-lg" style={{ fontVariationSettings:"'FILL' 1" }}>star</span>
                <p className="text-sm font-bold text-[#191c1e] dark:text-white">Топ услуг</p>
              </div>
              {(data?.top_services ?? []).length === 0 ? (
                <div className="p-4 text-center text-[#727783] text-sm">Нет данных</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[#eceef0] dark:border-gray-700">
                    <th className="text-left text-[10px] font-bold text-[#727783] uppercase tracking-wider px-4 py-2">Услуга</th>
                    <th className="text-right text-[10px] font-bold text-[#727783] uppercase tracking-wider px-2 py-2">Всего</th>
                    <th className="text-right text-[10px] font-bold text-[#727783] uppercase tracking-wider px-2 py-2">Подтв.</th>
                    <th className="text-right text-[10px] font-bold text-[#727783] uppercase tracking-wider px-4 py-2">Бонусы</th>
                  </tr></thead>
                  <tbody>
                    {(data?.top_services ?? []).map((s,i) => (
                      <tr key={s.service_id} className="border-b border-[#f7f9fb] dark:border-gray-700/50 last:border-0">
                        <td className="px-4 py-2.5 text-[#191c1e] dark:text-white font-medium text-xs">{s.name}</td>
                        <td className="px-2 py-2.5 text-right text-[#191c1e] dark:text-white">{s.total}</td>
                        <td className="px-2 py-2.5 text-right text-[#16A34A] font-semibold">{s.confirmed}</td>
                        <td className="px-4 py-2.5 text-right text-amber-600 font-semibold">{fmt(s.bonus_total)} Б</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Конверсия по сотрудникам */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden mb-4" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
              <div className="px-4 py-3 border-b border-[#eceef0] dark:border-gray-700 flex items-center gap-2">
                <span className="material-symbols-outlined text-[#1565c0] text-lg" style={{ fontVariationSettings:"'FILL' 1" }}>person_check</span>
                <p className="text-sm font-bold text-[#191c1e] dark:text-white">Конверсия по сотрудникам</p>
              </div>
              {(data?.admin_conversion ?? []).length === 0 ? (
                <div className="p-4 text-center text-[#727783] text-sm">Нет данных</div>
              ) : (
                <div className="divide-y divide-[#f7f9fb] dark:divide-gray-700/50">
                  {(data?.admin_conversion ?? []).map(a => (
                    <div key={a.admin_id} className="px-4 py-3">
                      <div className="flex justify-between items-center mb-2">
                        <div>
                          <p className="text-sm font-semibold text-[#191c1e] dark:text-white">{a.full_name}</p>
                          <p className="text-xs text-[#727783]">{a.clinic_name}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-base font-extrabold text-[#0097A7]">{a.conversion_pct}%</p>
                          <p className="text-xs text-[#727783]">{a.confirmed}/{a.total}</p>
                        </div>
                      </div>
                      <div className="w-full bg-[#f7f9fb] dark:bg-gray-700 rounded-full h-1.5">
                        <div className="bg-[#0097A7] h-1.5 rounded-full transition-all" style={{ width:`${Math.min(a.conversion_pct,100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Сравнение клиник */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
              <div className="px-4 py-3 border-b border-[#eceef0] dark:border-gray-700 flex items-center gap-2">
                <span className="material-symbols-outlined text-[#7c3aed] text-lg" style={{ fontVariationSettings:"'FILL' 1" }}>business</span>
                <p className="text-sm font-bold text-[#191c1e] dark:text-white">Сравнение клиник</p>
              </div>
              {(data?.clinic_comparison ?? []).length === 0 ? (
                <div className="p-4 text-center text-[#727783] text-sm">Нет данных</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[#eceef0] dark:border-gray-700">
                    <th className="text-left text-[10px] font-bold text-[#727783] uppercase tracking-wider px-4 py-2">Клиника</th>
                    <th className="text-right text-[10px] font-bold text-[#727783] uppercase tracking-wider px-2 py-2">Напр.</th>
                    <th className="text-right text-[10px] font-bold text-[#727783] uppercase tracking-wider px-2 py-2">Подтв.</th>
                    <th className="text-right text-[10px] font-bold text-[#727783] uppercase tracking-wider px-4 py-2">Конв.</th>
                  </tr></thead>
                  <tbody>
                    {(data?.clinic_comparison ?? []).map((c,i) => (
                      <tr key={c.clinic_id} className="border-b border-[#f7f9fb] dark:border-gray-700/50 last:border-0">
                        <td className="px-4 py-2.5 text-[#191c1e] dark:text-white text-xs font-medium">{c.name}</td>
                        <td className="px-2 py-2.5 text-right text-[#191c1e] dark:text-white">{c.total}</td>
                        <td className="px-2 py-2.5 text-right text-[#16A34A]">{c.confirmed}</td>
                        <td className="px-4 py-2.5 text-right text-[#0097A7] font-bold">{c.conversion_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
