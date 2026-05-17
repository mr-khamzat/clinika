/**
 * ========================================
 * БЛОК: DirectorCashflow — ДДС (движение денежных средств)
 * ========================================
 * Stacked-bar (приходы и расходы) + Net cashflow line + таблица операций.
 * Прогноз на следующий месяц — линейная экстраполяция последних 30 дней.
 * ========================================
 */
import { useEffect, useState } from 'react'
import api from '../../api'
import { Card, Button, EmptyState, Skeleton, useToast } from '../../design'
import { useDirectorPeriod } from '../DirectorLayout'
import { StackedBarChart, LineChart, fmtRUB, fmtDate } from './_DirectorCharts'

// ─── Универсальный helper: GET blob → save as ────────────────────────────────
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

export default function DirectorCashflow() {
  const { from, to } = useDirectorPeriod()
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    api.get('/director/cashflow', { params: { from, to } })
      .then(r => { if (alive) setData(r.data) })
      .catch(() => { if (alive) setError('Не удалось загрузить ДДС') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [from, to])

  const series = data?.series || []
  const totals = data?.totals || {}

  // Stacked bar items: для каждой даты: [приход (зелёный), расход (красный)]
  const stackItems = series.map(s => ({
    label: fmtDate(s.date).slice(0, 5),
    parts: [
      { name: 'Приходы', value: Number(s.inflow || 0),  color: '#059669' },
      { name: 'Расходы', value: Number(s.outflow || 0), color: '#dc2626' },
    ],
  }))

  // Net cashflow для линии
  const netSeries = [{
    name: 'Net',
    color: '#7c3aed',
    points: series.map(s => Number(s.inflow || 0) - Number(s.outflow || 0)),
  }]
  const labels = series.map(s => fmtDate(s.date).slice(0, 5))

  // Простой прогноз — среднее последних 30 точек × 30 дней
  const last30 = series.slice(-30)
  const avgInflow  = last30.length ? last30.reduce((a, s) => a + Number(s.inflow || 0),  0) / last30.length : 0
  const avgOutflow = last30.length ? last30.reduce((a, s) => a + Number(s.outflow || 0), 0) / last30.length : 0
  const forecast = {
    inflow:  Math.round(avgInflow * 30),
    outflow: Math.round(avgOutflow * 30),
    net:     Math.round((avgInflow - avgOutflow) * 30),
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Card padded><Skeleton height={60} /></Card>
        <Card padded><Skeleton height={240} /></Card>
        <Card padded><Skeleton height={140} /></Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {/* Заголовок + totals + кнопки экспорта */}
      <Card padded>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>
              ДДС — движение денежных средств
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{fmtDate(from)} — {fmtDate(to)}</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              onClick={() => downloadBlob(
                '/director/export/cashflow.xlsx',
                { from, to },
                `cashflow_${from}_${to}.xlsx`,
                toast,
              )}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>download</span>
              Excel
            </Button>
            <Button
              variant="ghost"
              onClick={() => downloadBlob(
                '/director/export/cashflow.pdf',
                { from, to },
                `cashflow_${from}_${to}.pdf`,
                toast,
              )}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>picture_as_pdf</span>
              PDF
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card padded>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600, textTransform: 'uppercase' }}>Приходы</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--good)' }}>{fmtRUB(totals.inflow || 0)}</div>
        </Card>
        <Card padded>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600, textTransform: 'uppercase' }}>Выплаты</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--bad)' }}>{fmtRUB(totals.outflow || 0)}</div>
        </Card>
        <Card padded>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600, textTransform: 'uppercase' }}>Чистый поток</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: (totals.net || 0) >= 0 ? 'var(--good)' : 'var(--bad)' }}>
            {fmtRUB(totals.net || 0)}
          </div>
        </Card>
      </div>

      {error ? (
        <Card padded><EmptyState icon="cloud_off" title="Бэкенд недоступен" description={error} /></Card>
      ) : series.length === 0 ? (
        <Card padded><EmptyState icon="paid" title="Нет операций за период" /></Card>
      ) : (
        <>
          {/* Stacked bar */}
          <Card padded>
            <Card.Header><Card.Title>Приходы и расходы по дням</Card.Title></Card.Header>
            <StackedBarChart items={stackItems.slice(-31)} formatter={fmtRUB} height={240} />
          </Card>

          {/* Net line */}
          <Card padded>
            <Card.Header><Card.Title>Чистый поток (нетто)</Card.Title></Card.Header>
            <LineChart series={netSeries} xLabels={labels} height={200} showLegend={false} yFormatter={fmtRUB} />
          </Card>
        </>
      )}

      {/* Прогноз */}
      <Card padded>
        <Card.Header>
          <Card.Title>Прогноз на следующий месяц</Card.Title>
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>линейная экстраполяция</span>
        </Card.Header>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600 }}>Прогноз приходов</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--good)' }}>{fmtRUB(forecast.inflow)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600 }}>Прогноз расходов</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--bad)' }}>{fmtRUB(forecast.outflow)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600 }}>Чистый поток (прогноз)</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: forecast.net >= 0 ? 'var(--good)' : 'var(--bad)' }}>
              {fmtRUB(forecast.net)}
            </div>
          </div>
        </div>
      </Card>

      {/* Таблица операций по дням */}
      <Card padded>
        <Card.Header><Card.Title>Операции по дням</Card.Title></Card.Header>
        {series.length === 0 ? (
          <EmptyState icon="receipt_long" title="Пусто" />
        ) : (
          <div className="overflow-x-auto" style={{ marginLeft: -8, marginRight: -8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--fg-3)', fontSize: 11, textTransform: 'uppercase' }}>
                  <th style={{ textAlign: 'left',  padding: '6px 8px' }}>Дата</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Приход</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Расход</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Net</th>
                </tr>
              </thead>
              <tbody>
                {series.slice(-30).reverse().map((s, i) => {
                  const net = Number(s.inflow || 0) - Number(s.outflow || 0)
                  return (
                    <tr key={`cf-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px', fontWeight: 600, color: 'var(--fg)' }}>{fmtDate(s.date)}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: 'var(--good)', fontVariantNumeric: 'tabular-nums' }}>{fmtRUB(s.inflow || 0)}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: 'var(--bad)',  fontVariantNumeric: 'tabular-nums' }}>{fmtRUB(s.outflow || 0)}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: net >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtRUB(net)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
