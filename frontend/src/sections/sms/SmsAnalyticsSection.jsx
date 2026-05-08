/**
 * SmsAnalyticsSection — KPI и графики SMS-маркетинга.
 *
 * Источники данных:
 *   GET /sms/campaigns — список (с counters: total_recipients, sent_count,
 *     delivered_count, opened_count и пр., если backend заполняет).
 *   GET /sms/campaigns/{id}/messages — для подсчёта статусов на клиенте,
 *     если в campaign-summary нет всех счётчиков.
 *
 * KPI:
 *   - Всего кампаний
 *   - Всего отправлено сообщений
 *   - % доставки
 *   - % открытий (если provider даёт)
 *   - Топ-3 шаблона по конверсии
 *
 * Графики:
 *   - Bar/sparkline отправок за 30 дней
 *   - Топ кампаний по delivery rate
 */
import { useState, useEffect, useMemo } from 'react'
import api from '../../api'

const apiFetch = (m, url, _t, d) => api({ method: m, url, data: d })

export default function SmsAnalyticsSection({ token }) {
  const [campaigns, setCampaigns] = useState(null)
  const [messages, setMessages]   = useState([])
  const [needPay, setNeedPay] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    async function run() {
      setErr(''); setNeedPay(false)
      try {
        const r = await apiFetch('get', '/sms/campaigns', token)
        const cs = Array.isArray(r.data) ? r.data : []
        if (cancelled) return
        setCampaigns(cs)
        // Подгружаем messages по последним 20 кампаниям для графика и delivery-rate.
        const recent = cs.slice(0, 20)
        const settled = await Promise.allSettled(
          recent.map(c => apiFetch('get', `/sms/campaigns/${c.id}/messages`, token).then(r => ({ c, data: r.data })))
        )
        if (cancelled) return
        const all = []
        for (const s of settled) {
          if (s.status === 'fulfilled' && Array.isArray(s.value.data)) {
            for (const m of s.value.data) {
              all.push({ ...m, _campaign_id: s.value.c.id, _template_id: s.value.c.template_id, _template_name: s.value.c.template_name })
            }
          }
        }
        setMessages(all)
      } catch (e) {
        const code = e?.response?.status
        if (code === 402) setNeedPay(true)
        else setErr(e?.response?.data?.detail || 'Ошибка загрузки аналитики')
        setCampaigns([])
      }
    }
    run()
    return () => { cancelled = true }
  }, [token])

  const kpi = useMemo(() => {
    if (!campaigns) return null
    let totalSent = 0, totalDelivered = 0, totalOpened = 0
    for (const m of messages) {
      if (m.status === 'sent' || m.status === 'delivered') totalSent += 1
      if (m.status === 'delivered') totalDelivered += 1
      if (m.opened_at) totalOpened += 1
    }
    return {
      campaigns: campaigns.length,
      sent: totalSent,
      delivery_pct: totalSent ? Math.round(totalDelivered / totalSent * 100) : 0,
      open_pct: totalDelivered ? Math.round(totalOpened / totalDelivered * 100) : 0,
    }
  }, [campaigns, messages])

  // График: отправки по дням за 30 дней.
  const chartData = useMemo(() => {
    const buckets = {}
    const now = new Date()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000)
      const key = d.toISOString().slice(0, 10)
      buckets[key] = 0
    }
    for (const m of messages) {
      if (!m.sent_at) continue
      const key = new Date(m.sent_at).toISOString().slice(0, 10)
      if (key in buckets) buckets[key] += 1
    }
    const arr = Object.entries(buckets).map(([d, v]) => ({ d, v }))
    const max = Math.max(1, ...arr.map(b => b.v))
    return { arr, max }
  }, [messages])

  // Топ-3 шаблона по конверсии (delivery rate).
  const topTemplates = useMemo(() => {
    if (!messages.length) return []
    const grp = new Map()
    for (const m of messages) {
      const key = m._template_id || m._template_name || 'unknown'
      const name = m._template_name || `#${m._template_id || '—'}`
      const obj = grp.get(key) || { name, sent: 0, delivered: 0 }
      if (m.status === 'sent' || m.status === 'delivered') obj.sent += 1
      if (m.status === 'delivered') obj.delivered += 1
      grp.set(key, obj)
    }
    const list = [...grp.values()]
      .filter(x => x.sent > 0)
      .map(x => ({ ...x, pct: Math.round(x.delivered / x.sent * 100) }))
      .sort((a, b) => b.pct - a.pct)
    return list.slice(0, 3)
  }, [messages])

  // Топ кампаний по delivery rate.
  const topCampaigns = useMemo(() => {
    if (!campaigns) return []
    const grp = new Map()
    for (const m of messages) {
      const key = m._campaign_id
      const c = campaigns.find(x => x.id === key)
      if (!c) continue
      const obj = grp.get(key) || { name: c.name, sent: 0, delivered: 0 }
      if (m.status === 'sent' || m.status === 'delivered') obj.sent += 1
      if (m.status === 'delivered') obj.delivered += 1
      grp.set(key, obj)
    }
    return [...grp.values()]
      .filter(x => x.sent > 0)
      .map(x => ({ ...x, pct: Math.round(x.delivered / x.sent * 100) }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5)
  }, [campaigns, messages])

  if (needPay) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
        Подключите модуль <code>sms_marketing</code> в каталоге.
      </div>
    )
  }

  if (err) {
    return <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">{err}</div>
  }

  if (!kpi) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Кампаний"        value={kpi.campaigns} icon="campaign" />
        <Kpi label="Сообщений"       value={kpi.sent}      icon="send" />
        <Kpi label="% доставки"      value={`${kpi.delivery_pct}%`} icon="check_circle" tone="emerald" />
        <Kpi label="% открытий"      value={`${kpi.open_pct}%`}     icon="visibility"   tone="cyan" />
      </div>

      {/* Chart: отправки за 30 дней */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
        <div className="text-sm font-bold text-gray-900 dark:text-white mb-3">Отправки за 30 дней</div>
        <div className="flex items-end gap-1 h-36">
          {chartData.arr.map(b => {
            const h = chartData.max ? (b.v / chartData.max) * 100 : 0
            return (
              <div key={b.d} className="flex-1 flex flex-col items-center group relative">
                <div
                  className="w-full bg-[#0097A7] rounded-t transition-all"
                  style={{ height: `${Math.max(2, h)}%` }}
                  title={`${b.d}: ${b.v}`}
                />
                {b.v > 0 && (
                  <span className="hidden group-hover:block absolute -top-5 text-[10px] text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-1 rounded">
                    {b.v}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex justify-between text-[10px] text-gray-400 mt-1">
          <span>{chartData.arr[0]?.d}</span>
          <span>{chartData.arr[chartData.arr.length - 1]?.d}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top templates */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
          <div className="text-sm font-bold text-gray-900 dark:text-white mb-3">Топ-3 шаблона по доставке</div>
          {topTemplates.length === 0 ? (
            <div className="text-sm text-gray-400 italic">Данных пока нет</div>
          ) : (
            <div className="space-y-2.5">
              {topTemplates.map((t, i) => (
                <div key={t.name + i} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs font-bold">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{t.name}</div>
                    <div className="text-xs text-gray-500">{t.delivered} / {t.sent} доставлено</div>
                  </div>
                  <div className="text-lg font-extrabold text-emerald-600">{t.pct}%</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top campaigns */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
          <div className="text-sm font-bold text-gray-900 dark:text-white mb-3">Топ кампаний по delivery rate</div>
          {topCampaigns.length === 0 ? (
            <div className="text-sm text-gray-400 italic">Данных пока нет</div>
          ) : (
            <div className="space-y-2.5">
              {topCampaigns.map((c, i) => (
                <div key={c.name + i} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{c.name}</div>
                    <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mt-1">
                      <div className="h-full bg-emerald-500" style={{ width: `${c.pct}%` }} />
                    </div>
                  </div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 w-12 text-right">{c.pct}%</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, icon, tone }) {
  const toneCls = {
    emerald: 'text-emerald-600',
    cyan:    'text-[#0097A7]',
  }[tone] || 'text-gray-700 dark:text-gray-200'
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <span className={`material-symbols-outlined text-[20px] ${toneCls}`}>{icon}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-2xl font-extrabold mt-1 ${toneCls}`}>{value}</div>
    </div>
  )
}
