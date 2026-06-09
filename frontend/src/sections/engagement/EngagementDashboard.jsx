/**
 * EngagementDashboard.jsx
 * Дашборд раздела «Пациенты ЛК»:
 *   • 7 stat-карточек по сводным метрикам (ЛК users, новые, активные, отвал, ДР)
 *   • LoginHeatmap (7×24)
 *   • RetentionCohorts (W1..W4 по неделям регистрации)
 *   • FunnelChart (воронка по этапам с rate между ступенями)
 */
import { useEffect, useState, useMemo } from 'react'
import { API_BASE } from '../../config'

function apiFetch(token, path, opts = {}) {
  return fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

function StatCard({ label, value, icon, colorClass, sub }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 flex items-center gap-3 shadow-sm">
      <span className={`material-symbols-outlined text-3xl ${colorClass}`} style={{ fontVariationSettings: "'FILL' 1" }}>{icon}</span>
      <div className="min-w-0">
        <div className="text-xl font-bold text-gray-900 dark:text-white truncate">{value}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{label}</div>
        {sub && <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  )
}

// ── Heatmap логинов 7×24 ───────────────────────────────────────────────────
function LoginHeatmap({ token }) {
  const [data, setData] = useState(null)
  const [days, setDays] = useState(30)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    let stop = false
    apiFetch(token, `/engagement/login-heatmap?days=${days}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stop) setData(d) })
      .catch(() => {})
    return () => { stop = true }
  }, [token, days])

  const cells = data?.cells || []
  const max = useMemo(() => cells.reduce((m, c) => Math.max(m, c.count || 0), 0) || 1, [cells])
  const matrix = useMemo(() => {
    const m = Array.from({ length: 7 }, () => Array(24).fill(0))
    for (const c of cells) {
      if (c.day >= 0 && c.day < 7 && c.hour >= 0 && c.hour < 24) m[c.day][c.hour] = c.count
    }
    return m
  }, [cells])

  const dayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-bold text-gray-900 dark:text-white">Активность по дням и часам</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">Heatmap входов пациентов в ЛК</p>
        </div>
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-2 py-1"
        >
          <option value={7}>7 дней</option>
          <option value={30}>30 дней</option>
          <option value={90}>90 дней</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          {/* шапка часов */}
          <div className="flex items-center text-[10px] text-gray-400 dark:text-gray-500 mb-1 select-none">
            <div className="w-8 shrink-0" />
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={h} className="w-5 text-center">{h % 3 === 0 ? h : ''}</div>
            ))}
          </div>
          {matrix.map((row, di) => (
            <div key={di} className="flex items-center mb-0.5">
              <div className="w-8 shrink-0 text-[11px] text-gray-500 dark:text-gray-400">{dayLabels[di]}</div>
              {row.map((cnt, hi) => {
                const intensity = cnt ? Math.max(0.08, cnt / max) : 0
                const bg = cnt ? `rgba(0,151,167,${intensity})` : 'rgba(148,163,184,0.12)'
                return (
                  <div
                    key={hi}
                    className="w-5 h-5 mx-px rounded-sm cursor-pointer transition hover:ring-2 hover:ring-cyan-400"
                    style={{ background: bg }}
                    onMouseEnter={() => setHover({ d: di, h: hi, c: cnt })}
                    onMouseLeave={() => setHover(null)}
                    title={`${dayLabels[di]} ${hi}:00 — ${cnt}`}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {hover && (
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
          {dayLabels[hover.d]} · {String(hover.h).padStart(2, '0')}:00 — <b>{hover.c}</b> входов
        </div>
      )}
    </div>
  )
}

// ── Когорты удержания ─────────────────────────────────────────────────────
function RetentionCohorts({ token }) {
  const [data, setData] = useState(null)
  const [weeks, setWeeks] = useState(8)

  useEffect(() => {
    let stop = false
    apiFetch(token, `/engagement/retention-cohorts?weeks=${weeks}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stop) setData(d) })
      .catch(() => {})
    return () => { stop = true }
  }, [token, weeks])

  const cohorts = data?.cohorts || []

  function pctColor(p) {
    if (p == null) return 'bg-gray-100 dark:bg-gray-700/50 text-gray-400'
    if (p >= 70) return 'bg-emerald-500/90 text-white'
    if (p >= 50) return 'bg-emerald-400/80 text-white'
    if (p >= 30) return 'bg-amber-400/80 text-gray-900'
    if (p >= 15) return 'bg-orange-400/80 text-white'
    if (p > 0)   return 'bg-red-400/80 text-white'
    return 'bg-red-500/80 text-white'
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-bold text-gray-900 dark:text-white">Когортный анализ удержания</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">Доля пациентов возвращающихся в ЛК через 1–4 недели</p>
        </div>
        <select
          value={weeks}
          onChange={e => setWeeks(Number(e.target.value))}
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-2 py-1"
        >
          <option value={4}>4 недели</option>
          <option value={8}>8 недель</option>
          <option value={12}>12 недель</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="px-2 py-2 font-semibold">Когорта</th>
              <th className="px-2 py-2 font-semibold text-center">Размер</th>
              <th className="px-2 py-2 font-semibold text-center">W1</th>
              <th className="px-2 py-2 font-semibold text-center">W2</th>
              <th className="px-2 py-2 font-semibold text-center">W3</th>
              <th className="px-2 py-2 font-semibold text-center">W4</th>
            </tr>
          </thead>
          <tbody>
            {cohorts.length === 0 && (
              <tr><td colSpan={6} className="text-center py-6 text-gray-400 text-sm">Нет данных</td></tr>
            )}
            {cohorts.map((c, i) => (
              <tr key={i} className="border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{c.cohort_week}</td>
                <td className="px-2 py-1.5 text-center text-gray-600 dark:text-gray-400">{c.size}</td>
                {['week1_pct', 'week2_pct', 'week3_pct', 'week4_pct'].map(k => {
                  const v = c[k]
                  return (
                    <td key={k} className="px-1 py-1">
                      <div className={`mx-auto w-12 h-7 rounded flex items-center justify-center text-[11px] font-semibold ${pctColor(v)}`}>
                        {v == null ? '—' : `${v}%`}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Воронка ───────────────────────────────────────────────────────────────
function FunnelChart({ token }) {
  const [data, setData] = useState(null)
  const [days, setDays] = useState(30)

  useEffect(() => {
    let stop = false
    apiFetch(token, `/engagement/funnel?days=${days}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stop) setData(d) })
      .catch(() => {})
    return () => { stop = true }
  }, [token, days])

  const stages = data?.stages || []
  const maxValue = stages.reduce((m, s) => Math.max(m, s.value || 0), 0) || 1

  const colors = ['#06b6d4', '#0891b2', '#0e7490', '#155e75', '#164e63', '#0c4a6e']

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-bold text-gray-900 dark:text-white">Воронка вовлечённости</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">Путь пациента — от регистрации до целевого действия</p>
        </div>
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-2 py-1"
        >
          <option value={7}>7 дней</option>
          <option value={30}>30 дней</option>
          <option value={90}>90 дней</option>
        </select>
      </div>

      <div className="space-y-2">
        {stages.length === 0 && (
          <div className="text-center py-6 text-gray-400 text-sm">Нет данных</div>
        )}
        {stages.map((s, i) => {
          const width = Math.max(8, (s.value / maxValue) * 100)
          const color = colors[i % colors.length]
          return (
            <div key={s.key || i}>
              {i > 0 && s.rate != null && (
                <div className="flex justify-end pr-2 mb-1">
                  <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                    → {Math.round(s.rate)}%
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="w-32 shrink-0 text-xs text-gray-700 dark:text-gray-300 truncate">{s.label}</div>
                <div className="flex-1 relative">
                  <div
                    className="h-9 rounded-lg flex items-center justify-between px-3 transition-all"
                    style={{ width: width + '%', minWidth: '60px', background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
                  >
                    <span className="text-xs font-semibold text-white">{(s.value || 0).toLocaleString('ru')}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Главный компонент ─────────────────────────────────────────────────────
export default function EngagementDashboard({ token }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let stop = false
    setLoading(true)
    apiFetch(token, '/engagement/dashboard')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stop) { setStats(d); setLoading(false) } })
      .catch(() => { if (!stop) setLoading(false) })
    return () => { stop = true }
  }, [token])

  const s = stats || {}
  const cards = [
    { label: 'Всего в ЛК',        value: s.total_lk_users ?? '—',     icon: 'group',           colorClass: 'text-cyan-500' },
    { label: 'Новых за 7д',       value: s.new_7d ?? '—',             icon: 'person_add',      colorClass: 'text-emerald-500' },
    { label: 'Активных 7д',       value: s.active_7d ?? '—',          icon: 'bolt',            colorClass: 'text-amber-500' },
    { label: 'Активных 30д',      value: s.active_30d ?? '—',         icon: 'trending_up',     colorClass: 'text-orange-500' },
    { label: 'Активных 90д',      value: s.active_90d ?? '—',         icon: 'history',         colorClass: 'text-violet-500' },
    { label: 'Отвал 60+ дней',    value: s.churn_60d_loyal ?? '—',    icon: 'person_off',      colorClass: 'text-red-500' },
    { label: 'ДР на 7 дней',      value: s.birthdays_next_7d ?? '—',  icon: 'cake',            colorClass: 'text-pink-500' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c, i) => (
          <StatCard key={i} {...c} sub={loading ? 'загрузка…' : null} />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <LoginHeatmap token={token} />
        <FunnelChart  token={token} />
      </div>

      <RetentionCohorts token={token} />
    </div>
  )
}
