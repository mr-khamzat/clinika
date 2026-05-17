/**
 * ========================================
 * БЛОК: DirectorKPI — KPI и Воронка
 * ========================================
 * Виджеты: средний чек, конверсия, % повторных, LTV +
 * воронка-визуализация + тренды KPI за 12 месяцев.
 * ========================================
 */
import { useEffect, useState } from 'react'
import api from '../../api'
import { Card, EmptyState, Skeleton } from '../../design'
import { useDirectorPeriod } from '../DirectorLayout'
import { FunnelChart, LineChart, fmtRUB, fmtInt, fmtPct } from './_DirectorCharts'

function KpiTile({ label, value, hint, accent = 'var(--accent)', icon }) {
  return (
    <Card padded>
      <div className="flex items-center gap-2 mb-1">
        {icon && (
          <span className="inline-grid place-items-center" style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-soft)', color: accent }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}>{icon}</span>
          </span>
        )}
        <div style={{ fontSize: 12, color: 'var(--fg-3)', fontWeight: 600 }}>{label}</div>
      </div>
      <div style={{ fontSize: 'clamp(20px, 4vw, 26px)', fontWeight: 700, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>{hint}</div>}
    </Card>
  )
}

export default function DirectorKPI() {
  const { from, to } = useDirectorPeriod()
  const [kpi, setKpi] = useState(null)
  const [funnel, setFunnel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    Promise.allSettled([
      api.get('/director/kpi', { params: { from, to } }),
      api.get('/director/kpi/funnel', { params: { from, to } }),
    ]).then(([k, f]) => {
      if (!alive) return
      if (k.status === 'fulfilled') setKpi(k.value.data)
      else setError('Бэкенд KPI недоступен')
      if (f.status === 'fulfilled') setFunnel(f.value.data)
      setLoading(false)
    })
    return () => { alive = false }
  }, [from, to])

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <Card key={i}><Skeleton height={80} /></Card>)}
      </div>
    )
  }

  if (error && !kpi) {
    return <EmptyState icon="cloud_off" title="Бэкенд KPI пока не готов" />
  }

  const k = kpi || {}
  const trends = k.trends || {}
  const months = trends.months || k.months || []
  const avgCheckSeries  = trends.avg_check || k.avg_check_series || []
  const conversionSeries = trends.conversion || k.conversion_series || []
  const retentionSeries = trends.retention || k.retention_series || []

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {/* 4 KPI-плитки */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiTile
          icon="receipt"
          label="Средний чек"
          value={fmtRUB(k.avg_check || 0)}
          hint={k.avg_check_delta_pct != null ? `${k.avg_check_delta_pct >= 0 ? '+' : ''}${Number(k.avg_check_delta_pct).toFixed(1)}% к пред. периоду` : null}
        />
        <KpiTile
          icon="conversion_path"
          label="Конверсия лид → оплата"
          value={fmtPct(k.conversion_pct || 0)}
          hint={k.leads != null ? `Лиды: ${fmtInt(k.leads)}` : null}
          accent="#7c3aed"
        />
        <KpiTile
          icon="autorenew"
          label="Повторные пациенты"
          value={fmtPct(k.retention_pct || 0)}
          hint={k.repeat_count != null ? `${fmtInt(k.repeat_count)} повторных приёмов` : null}
          accent="#059669"
        />
        <KpiTile
          icon="diamond"
          label="LTV"
          value={fmtRUB(k.ltv || 0)}
          hint={k.ltv_period_months ? `за ${k.ltv_period_months} мес.` : 'lifetime value'}
          accent="#d97706"
        />
      </div>

      {/* Воронка */}
      <Card padded>
        <Card.Header>
          <Card.Title>Воронка продаж</Card.Title>
        </Card.Header>
        <FunnelChart stages={funnel?.stages || []} formatter={fmtInt} />
      </Card>

      {/* Тренды */}
      {months.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card padded>
            <Card.Header><Card.Title>Средний чек</Card.Title></Card.Header>
            <LineChart
              series={[{ name: 'Средний чек', color: '#1565c0', points: avgCheckSeries }]}
              xLabels={months}
              height={180}
              showLegend={false}
              yFormatter={fmtRUB}
            />
          </Card>
          <Card padded>
            <Card.Header><Card.Title>Конверсия</Card.Title></Card.Header>
            <LineChart
              series={[{ name: 'Конверсия', color: '#7c3aed', points: conversionSeries }]}
              xLabels={months}
              height={180}
              showLegend={false}
              yFormatter={(v) => `${Number(v).toFixed(1)}%`}
            />
          </Card>
          <Card padded>
            <Card.Header><Card.Title>Retention</Card.Title></Card.Header>
            <LineChart
              series={[{ name: 'Retention', color: '#059669', points: retentionSeries }]}
              xLabels={months}
              height={180}
              showLegend={false}
              yFormatter={(v) => `${Number(v).toFixed(1)}%`}
            />
          </Card>
        </div>
      )}
    </div>
  )
}
