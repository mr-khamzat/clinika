/**
 * AdminChurn — Dashboard оттока тенантов (super_admin).
 *
 * Backend: миграция tenantchurn01 добавила поля churned_at/churn_reason в Tenant.
 * Endpoints (изначальный план):
 *   GET /admin/analytics/churn-rate?months=12
 *   GET /admin/analytics/churn-reasons
 *
 * Если endpoints ещё не реализованы — компонент показывает фолбэк.
 */
import { useEffect, useState } from 'react'
import api from '../api'
import { Page, PageHeader, Card, KpiRow, KpiCard, EmptyState, Skeleton, Chip } from '../design'

const REASON_LABELS = {
  too_expensive: 'Слишком дорого',
  missing_features: 'Не хватает функций',
  switched_to_competitor: 'Ушли к конкуренту',
  closed_business: 'Закрыли бизнес',
  bad_support: 'Плохая поддержка',
  technical_issues: 'Технические проблемы',
  other: 'Другое',
}

export default function AdminChurn() {
  const [rateLoading, setRateLoading] = useState(true)
  const [reasonsLoading, setReasonsLoading] = useState(true)
  const [rate, setRate] = useState(null)
  const [reasons, setReasons] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/admin/analytics/churn-rate?months=12')
      .then((r) => setRate(r.data))
      .catch((e) => {
        if (e?.response?.status !== 404) setError(e?.response?.data?.detail || e.message)
      })
      .finally(() => setRateLoading(false))

    api.get('/admin/analytics/churn-reasons')
      .then((r) => setReasons(r.data))
      .catch(() => { /* 404 — endpoint ещё не реализован */ })
      .finally(() => setReasonsLoading(false))
  }, [])

  const monthly = rate?.monthly || []
  const last = monthly[monthly.length - 1]
  const totalChurned = monthly.reduce((s, m) => s + (m.churned || 0), 0)
  const avgRate = monthly.length
    ? (monthly.reduce((s, m) => s + (m.churn_rate_pct || 0), 0) / monthly.length).toFixed(2)
    : '—'

  return (
    <Page>
      <PageHeader
        title="Churn (отток тенантов)"
        subtitle="Rate, причины и тренды за последние 12 месяцев"
      />

      {error && (
        <Card>
          <div style={{ padding: 16, color: 'var(--bad, #b91c1c)' }}>
            {error}
          </div>
        </Card>
      )}

      <KpiRow>
        <KpiCard
          label="Текущий месячный churn rate"
          value={last ? `${(last.churn_rate_pct ?? 0).toFixed(2)}%` : '—'}
          loading={rateLoading}
        />
        <KpiCard
          label="Средний rate (12 мес)"
          value={`${avgRate}%`}
          loading={rateLoading}
        />
        <KpiCard
          label="Всего ушло за 12 мес"
          value={totalChurned}
          loading={rateLoading}
        />
      </KpiRow>

      <Card>
        <Card.Header>
          <Card.Title>Помесячный отток</Card.Title>
          <Card.Subtitle>tenants_total / churned / churn_rate</Card.Subtitle>
        </Card.Header>
        {rateLoading && <div style={{ padding: 16 }}><Skeleton lines={6} /></div>}
        {!rateLoading && monthly.length === 0 && (
          <EmptyState
            icon="trending_down"
            title="Нет данных по churn"
            description="Метрика появится когда первые тенанты покинут платформу или endpoint /admin/analytics/churn-rate будет реализован."
          />
        )}
        {!rateLoading && monthly.length > 0 && (
          <div style={{ overflowX: 'auto', padding: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)' }}>
                  <th style={{ textAlign: 'left',  padding: 10 }}>Месяц</th>
                  <th style={{ textAlign: 'right', padding: 10 }}>Активных</th>
                  <th style={{ textAlign: 'right', padding: 10 }}>Ушло</th>
                  <th style={{ textAlign: 'right', padding: 10 }}>Rate %</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: 10 }}>{m.period}</td>
                    <td style={{ padding: 10, textAlign: 'right' }}>{m.tenants_active ?? '—'}</td>
                    <td style={{ padding: 10, textAlign: 'right' }}>{m.churned ?? 0}</td>
                    <td style={{ padding: 10, textAlign: 'right' }}>
                      <Chip variant={m.churn_rate_pct > 5 ? 'bad' : m.churn_rate_pct > 2 ? 'warn' : 'good'} size="sm">
                        {(m.churn_rate_pct ?? 0).toFixed(2)}%
                      </Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Причины оттока</Card.Title>
          <Card.Subtitle>Распределение причин (churn_reason) за всё время</Card.Subtitle>
        </Card.Header>
        {reasonsLoading && <div style={{ padding: 16 }}><Skeleton lines={4} /></div>}
        {!reasonsLoading && (!reasons || (Array.isArray(reasons) ? reasons.length === 0 : Object.keys(reasons).length === 0)) && (
          <EmptyState icon="help" title="Нет данных по причинам" />
        )}
        {!reasonsLoading && reasons && Array.isArray(reasons) && reasons.length > 0 && (
          <div style={{ padding: 16, display: 'grid', gap: 8 }}>
            {reasons.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: 10, background: 'var(--surface-2)', borderRadius: 8 }}>
                <span>{REASON_LABELS[r.reason] || r.reason}</span>
                <strong>{r.count}</strong>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Page>
  )
}
