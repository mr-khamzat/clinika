/**
 * ========================================
 * БЛОК: DirectorPnL — Доходы / Расходы / Прибыль
 * ========================================
 * Линейный график 3 серий + таблица series + фильтры (period, granularity).
 * Кнопки экспорта Excel/PDF — реальная выгрузка через /director/export/*.
 * ========================================
 */
import { useEffect, useState } from 'react'
import api from '../../api'
import { Card, Button, EmptyState, Skeleton, useToast } from '../../design'
import { useDirectorPeriod } from '../DirectorLayout'
import { LineChart, fmtRUB, fmtDate } from './_DirectorCharts'

// ─── Универсальный helper: GET blob → save as ────────────────────────────────
// Используется для экспорта Excel/PDF — не плодим логику в каждой странице.
async function downloadBlob(url, params, filename, toast) {
  try {
    const res = await api.get(url, { params, responseType: 'blob' })
    const blob = res.data instanceof Blob ? res.data : new Blob([res.data])
    const link = document.createElement('a')
    const objUrl = URL.createObjectURL(blob)
    link.href = objUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000)
  } catch (e) {
    if (typeof toast === 'function') toast('Не удалось выгрузить отчёт', 'error')
  }
}

const GRANULARITIES = [
  { key: 'day',     label: 'День' },
  { key: 'week',    label: 'Неделя' },
  { key: 'month',   label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
]

export default function DirectorPnL() {
  const { from, to } = useDirectorPeriod()
  const { toast } = useToast()
  const [granularity, setGranularity] = useState('month')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    api.get('/director/pnl', { params: { from, to, granularity } })
      .then(r => { if (alive) setData(r.data) })
      .catch(() => { if (alive) setError('Не удалось загрузить P&L') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [from, to, granularity])

  const series = data?.series || []
  const totals = data?.totals || {}

  const labels = series.map(s => {
    if (granularity === 'day') return fmtDate(s.date).slice(0, 5) // DD.MM
    if (granularity === 'month') {
      try { const d = new Date(s.date); return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}` }
      catch { return s.date }
    }
    return s.date
  })

  const chartSeries = [
    { name: 'Доходы',  color: '#1565c0', points: series.map(s => Number(s.revenue || 0)) },
    { name: 'Расходы', color: '#dc2626', points: series.map(s => Number(s.expenses || 0)) },
    { name: 'Прибыль', color: '#059669', points: series.map(s => Number(s.profit || 0)) },
  ]

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {/* Фильтры */}
      <Card padded>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)' }}>P&L: доходы / расходы / прибыль</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{fmtDate(from)} — {fmtDate(to)}</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex" style={{ background: 'var(--bg-1)', borderRadius: 10, padding: 3, border: '1px solid var(--border)' }}>
              {GRANULARITIES.map(g => (
                <button
                  key={g.key}
                  onClick={() => setGranularity(g.key)}
                  style={{
                    padding: '6px 12px', borderRadius: 7,
                    fontSize: 12, fontWeight: 600,
                    background: granularity === g.key ? 'var(--surface)' : 'transparent',
                    color: granularity === g.key ? 'var(--accent)' : 'var(--fg-2)',
                    border: 'none', cursor: 'pointer', minHeight: 32,
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              onClick={() => downloadBlob(
                '/director/export/pnl.xlsx',
                { from, to, granularity },
                `pnl_${from}_${to}.xlsx`,
                toast,
              )}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>download</span>
              Excel
            </Button>
            <Button
              variant="ghost"
              onClick={() => downloadBlob(
                '/director/export/pnl.pdf',
                { from, to, granularity },
                `pnl_${from}_${to}.pdf`,
                toast,
              )}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>picture_as_pdf</span>
              PDF
            </Button>
          </div>
        </div>
      </Card>

      {/* Totals */}
      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card padded>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600, textTransform: 'uppercase' }}>Доходы</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>{fmtRUB(totals.revenue || 0)}</div>
          </Card>
          <Card padded>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600, textTransform: 'uppercase' }}>Расходы</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--bad)' }}>{fmtRUB(totals.expenses || 0)}</div>
          </Card>
          <Card padded>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600, textTransform: 'uppercase' }}>Прибыль</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--good)' }}>{fmtRUB(totals.profit || 0)}</div>
            {totals.margin_pct != null && (
              <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Маржа {Number(totals.margin_pct).toFixed(1)}%</div>
            )}
          </Card>
        </div>
      )}

      {/* График */}
      <Card padded>
        <Card.Header>
          <Card.Title>Динамика</Card.Title>
        </Card.Header>
        {loading ? (
          <Skeleton height={220} />
        ) : error ? (
          <EmptyState icon="error" title="Ошибка" description={error} />
        ) : series.length === 0 ? (
          <EmptyState icon="bar_chart" title="Нет данных за период" />
        ) : (
          <LineChart series={chartSeries} xLabels={labels} height={260} />
        )}
      </Card>

      {/* Таблица */}
      <Card padded>
        <Card.Header>
          <Card.Title>Серии данных</Card.Title>
          <button
            onClick={() => setExpanded(v => !v)}
            style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            {expanded ? 'Свернуть' : 'Развернуть всё'}
          </button>
        </Card.Header>
        <div className="overflow-x-auto" style={{ marginLeft: -8, marginRight: -8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--fg-3)', fontSize: 11, textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left',  padding: '6px 8px' }}>Дата</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Доходы</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Расходы</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Прибыль</th>
              </tr>
            </thead>
            <tbody>
              {(expanded ? series : series.slice(-12)).map((s, i) => (
                <tr key={`pnl-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px', fontWeight: 600, color: 'var(--fg)' }}>{fmtDate(s.date)}</td>
                  <td style={{ padding: '8px', textAlign: 'right', color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{fmtRUB(s.revenue || 0)}</td>
                  <td style={{ padding: '8px', textAlign: 'right', color: 'var(--bad)',  fontVariantNumeric: 'tabular-nums' }}>{fmtRUB(s.expenses || 0)}</td>
                  <td style={{ padding: '8px', textAlign: 'right', color: 'var(--good)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtRUB(s.profit || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
