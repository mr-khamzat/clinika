/**
 * ========================================
 * БЛОК: ManagerCostForecast (Глава 4 — Manager productivity)
 * ========================================
 * График и breakdown расходов клиники + прогноз на 3 месяца.
 *
 * Источник: GET /manager/analytics/cost-forecast
 *
 * Используется простая SVG-линейка (без recharts/chart.js — без новых
 * зависимостей). Сплошная линия — история, пунктир — прогноз.
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../api'
import { Card, Button, EmptyState } from '../design'

const CONF_LABEL = { low: 'Низкая', medium: 'Средняя', high: 'Высокая' }

export default function ManagerCostForecast() {
  const [filter, setFilter] = useState({ clinic_id: '', months_ahead: 3 })
  const [clinics, setClinics] = useState([])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/manager/clinics-accessible')
      .then(r => setClinics(Array.isArray(r.data) ? r.data : []))
      .catch(() => setClinics([]))
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const params = { months_ahead: filter.months_ahead }
      if (filter.clinic_id) params.clinic_id = filter.clinic_id
      const r = await api.get('/manager/analytics/cost-forecast', { params })
      setData(r.data)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [filter.clinic_id, filter.months_ahead])

  // ─── Геометрия SVG-графика ────────────────────────────────────────────
  const chart = useMemo(() => {
    if (!data) return null
    const all = [...data.history, ...data.forecast.map(f => ({ month: f.month, total_cost: f.predicted_cost, forecast: true, range_min: f.range_min, range_max: f.range_max }))]
    const max = Math.max(1, ...all.map(p => p.range_max || p.total_cost || 0))
    const w = 720, h = 220, pad = { l: 50, r: 15, t: 10, b: 30 }
    const innerW = w - pad.l - pad.r
    const innerH = h - pad.t - pad.b
    const step = all.length > 1 ? innerW / (all.length - 1) : 0
    const x = (i) => pad.l + i * step
    const y = (v) => pad.t + innerH - (v / max) * innerH

    const histPts = data.history.map((p, i) => `${x(i)},${y(p.total_cost)}`)
    const splitIdx = data.history.length - 1
    const forePts = [
      `${x(splitIdx)},${y(data.history[splitIdx]?.total_cost || 0)}`,
      ...data.forecast.map((f, i) => `${x(splitIdx + 1 + i)},${y(f.predicted_cost)}`),
    ]
    const bandPath = data.forecast.length
      ? `M ${forePts[0]} ` +
        data.forecast.map((f, i) => `L ${x(splitIdx + 1 + i)},${y(f.range_max)}`).join(' ') +
        ' ' +
        data.forecast.slice().reverse().map((f, idx) => {
          const j = data.forecast.length - 1 - idx
          return `L ${x(splitIdx + 1 + j)},${y(f.range_min)}`
        }).join(' ') +
        ` L ${forePts[0]} Z`
      : ''
    return { w, h, pad, all, max, x, y, histPts, forePts, bandPath, splitIdx }
  }, [data])

  return (
    <div>
      {/* ─── Toolbar ─── */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap',
        padding: 12, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      }}>
        {clinics.length > 1 && (
          <select value={filter.clinic_id}
                  onChange={e => setFilter(f => ({ ...f, clinic_id: e.target.value }))}
                  style={selectStyle}>
            <option value="">Все клиники</option>
            {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg-3)' }}>
          Прогноз на:
          <select value={filter.months_ahead}
                  onChange={e => setFilter(f => ({ ...f, months_ahead: Number(e.target.value) }))}
                  style={selectStyle}>
            <option value={1}>1 мес</option>
            <option value={3}>3 мес</option>
            <option value={6}>6 мес</option>
            <option value={12}>12 мес</option>
          </select>
        </label>
        <div style={{ flex: 1 }} />
        <Button size="sm" variant="secondary" onClick={load}>Обновить</Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--fg-3)' }}>Загрузка…</div>
      ) : !data ? (
        <EmptyState title="Нет данных" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* ─── Warning блок ─── */}
          {data.warning && (
            <div style={{
              padding: 12, borderRadius: 'var(--radius)',
              background: 'oklch(0.95 0.05 25)', color: 'oklch(0.35 0.15 25)',
              border: '1px solid oklch(0.65 0.22 25 / 0.3)',
              fontSize: 13, display: 'flex', gap: 8, alignItems: 'start',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>warning</span>
              <span>{data.warning}</span>
            </div>
          )}

          {/* ─── График ─── */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--accent)' }}>trending_up</span>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Прогноз расходов</div>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-3)' }}>
                Тренд: <b>{data.trend === 'growing' ? 'рост' : data.trend === 'declining' ? 'снижение' : 'стабильно'}</b>
                {' · '}
                Уверенность: <b>{CONF_LABEL[data.stats?.confidence] || '—'}</b>
                {' · R² '}{data.stats?.r2}
              </span>
            </div>

            {chart && (
              <svg viewBox={`0 0 ${chart.w} ${chart.h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                {/* grid */}
                {[0, 0.25, 0.5, 0.75, 1].map(t => {
                  const yv = chart.pad.t + (chart.h - chart.pad.t - chart.pad.b) * t
                  return (
                    <line key={t}
                      x1={chart.pad.l} x2={chart.w - chart.pad.r}
                      y1={yv} y2={yv}
                      stroke="var(--border)" strokeDasharray="2 4"
                    />
                  )
                })}
                {/* Y axis labels */}
                {[0, 0.5, 1].map(t => {
                  const yv = chart.pad.t + (chart.h - chart.pad.t - chart.pad.b) * (1 - t)
                  const v = Math.round(chart.max * t)
                  return (
                    <text key={t} x={chart.pad.l - 6} y={yv + 4}
                          textAnchor="end" fontSize="10" fill="var(--fg-3)">
                      {v.toLocaleString('ru-RU')}
                    </text>
                  )
                })}
                {/* X axis labels (each 2nd) */}
                {chart.all.map((p, i) => (
                  i % 2 === 0 ? (
                    <text key={i} x={chart.x(i)} y={chart.h - 8}
                          textAnchor="middle" fontSize="9" fill="var(--fg-3)">
                      {p.month.slice(5)}/{p.month.slice(2, 4)}
                    </text>
                  ) : null
                ))}
                {/* Forecast confidence band */}
                {chart.bandPath && (
                  <path d={chart.bandPath} fill="oklch(0.72 0.16 250 / 0.15)" />
                )}
                {/* History line */}
                <polyline points={chart.histPts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
                {/* Forecast line (dashed) */}
                <polyline points={chart.forePts.join(' ')} fill="none"
                          stroke="oklch(0.72 0.16 250)" strokeWidth="2.5" strokeDasharray="6 4" />
                {/* History points */}
                {data.history.map((p, i) => (
                  <circle key={i} cx={chart.x(i)} cy={chart.y(p.total_cost)} r="3"
                          fill="var(--accent)">
                    <title>{p.month}: {p.total_cost.toLocaleString('ru-RU')} ₽</title>
                  </circle>
                ))}
                {/* Forecast points */}
                {data.forecast.map((p, i) => (
                  <circle key={`f${i}`} cx={chart.x(chart.splitIdx + 1 + i)} cy={chart.y(p.predicted_cost)} r="3"
                          fill="oklch(0.72 0.16 250)">
                    <title>{p.month}: {p.predicted_cost.toLocaleString('ru-RU')} ₽ ({CONF_LABEL[p.confidence]})</title>
                  </circle>
                ))}
              </svg>
            )}

            {/* Легенда */}
            <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: 'var(--fg-3)' }}>
              <span><span style={{ display: 'inline-block', width: 12, height: 2, background: 'var(--accent)', marginRight: 6, verticalAlign: 'middle' }}/>история</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 0, borderTop: '2px dashed oklch(0.72 0.16 250)', marginRight: 6, verticalAlign: 'middle' }}/>прогноз</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 8, background: 'oklch(0.72 0.16 250 / 0.25)', marginRight: 6, verticalAlign: 'middle' }}/>доверительный интервал</span>
            </div>
          </Card>

          {/* ─── Breakdown ─── */}
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Категории расходов (среднее за период)</div>
            <BreakdownTable history={data.history} />
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-3)' }}>
              Доступные категории: {data.available_categories?.join(', ') || '—'}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

function BreakdownTable({ history }) {
  const cats = ['bonuses', 'salaries', 'supplies']
  const labels = { bonuses: 'Бонусы', salaries: 'Зарплаты', supplies: 'Расходники' }
  const sums = cats.reduce((acc, c) => {
    acc[c] = history.reduce((s, h) => s + (h[c] || 0), 0)
    return acc
  }, {})
  const total = Object.values(sums).reduce((s, v) => s + v, 0) || 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {cats.map(c => {
        const pct = Math.round((sums[c] / total) * 100)
        return (
          <div key={c}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4,
            }}>
              <span style={{ fontWeight: 600 }}>{labels[c]}</span>
              <span style={{ color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums' }}>
                {sums[c].toLocaleString('ru-RU')} ₽ · {pct}%
              </span>
            </div>
            <div style={{ height: 6, background: 'var(--bg-2)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`, height: '100%',
                background: 'linear-gradient(90deg, var(--accent), var(--accent-2))',
              }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

const selectStyle = {
  height: 32, padding: '0 8px', fontSize: 12,
  background: 'var(--bg-2)', color: 'var(--fg)',
  border: '1px solid var(--border)', borderRadius: 8,
}
