/**
 * ========================================
 * БЛОК: FranchiseAnalyticsSection — премиум-аналитика франшизы (Глава 3)
 * ========================================
 * 4 вкладки:
 *   1. KPI       — дашборд с дельтами, sparkline-мини, топ-сущностями
 *   2. Cohort    — heatmap клиника × месяц с цветовой шкалой
 *   3. Bulk-планы— редактор планов и модулей по тенантам одним батчем
 *   4. Рекомендации — карточки с severity-цветами
 *
 * Backend:
 *   GET /admin/analytics/franchise-kpi?range=7d|30d|90d|365d
 *   GET /admin/analytics/cohort-clinics?metric=revenue|appointments|referrals|patients
 *   GET /admin/analytics/recommendations
 *   GET /admin/franchise/tenants-pricing
 *   POST /admin/franchise/bulk-update-plans
 *
 * Дизайн: токены ks-design (Card, KpiRow, Tabs, Skeleton, Button, Sparkline).
 * Без recharts — только CSS/SVG.
 * ========================================
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import api from '../api'
import {
  Card,
  Tabs,
  Button,
  Chip,
  EmptyState,
  Sparkline,
  KpiRow,
  KpiCard,
  Skeleton,
  TableSkeleton,
  useToast,
} from '../design'

// ── Хелперы ────────────────────────────────────────────────────────────────

const fmtNum = (v) => new Intl.NumberFormat('ru-RU').format(Math.round(v || 0))
const fmtRub = (v) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v || 0)
const fmtPct = (v) => `${v >= 0 ? '+' : ''}${(v ?? 0).toFixed(1)}%`

const RANGE_TABS = [
  { id: '7d', label: '7 дн' },
  { id: '30d', label: '30 дн' },
  { id: '90d', label: '90 дн' },
  { id: '365d', label: '1 год' },
]

const METRIC_TABS = [
  { id: 'revenue', label: 'Выручка' },
  { id: 'appointments', label: 'Записи' },
  { id: 'referrals', label: 'Направления' },
  { id: 'patients', label: 'Пациенты' },
]

const TAB_ITEMS = [
  { id: 'kpi', label: 'KPI-дашборд' },
  { id: 'cohort', label: 'Cohort-анализ' },
  { id: 'bulk', label: 'Bulk-тарифы' },
  { id: 'rec', label: 'Рекомендации' },
]

// CSV-экспорт (клиент)
function downloadCsv(filename, rows) {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const s = cell == null ? '' : String(cell)
          if (s.includes(';') || s.includes('"') || s.includes('\n')) {
            return `"${s.replaceAll('"', '""')}"`
          }
          return s
        })
        .join(';')
    )
    .join('\n')
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// ── Главный компонент ──────────────────────────────────────────────────────

export default function FranchiseAnalyticsSection() {
  const [tab, setTab] = useState('kpi')

  return (
    <div className="px-4 pb-24 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black mb-1" style={{ color: 'var(--fg)' }}>
            Аналитика франшизы
          </h2>
          <p className="text-sm" style={{ color: 'var(--fg-3)' }}>
            Премиум-инструменты владельца сети: KPI, когорты, bulk-настройка тарифов и рекомендации.
          </p>
        </div>
        <Tabs items={TAB_ITEMS} value={tab} onChange={setTab} />
      </div>

      {tab === 'kpi' && <KpiDashboard />}
      {tab === 'cohort' && <CohortAnalysis />}
      {tab === 'bulk' && <BulkPricing />}
      {tab === 'rec' && <Recommendations />}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// 1. KPI-дашборд
// ───────────────────────────────────────────────────────────────────────────

function KpiDashboard() {
  const [range, setRange] = useState('30d')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .get('/admin/analytics/franchise-kpi', { params: { range } })
      .then((r) => !cancelled && setData(r.data))
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || 'Ошибка загрузки'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [range])

  const handleExport = () => {
    if (!data) return
    const rows = [
      ['Метрика', 'Значение', 'Дельта %'],
      ['Выручка', data.revenue_total, data.revenue_growth_pct],
      ['Записей', data.appointments_count, data.appointments_growth_pct],
      ['Новых пациентов', data.new_patients, ''],
      ['Повторных пациентов', data.returning_patients, ''],
      ['Направлений (in)', data.referrals_in, ''],
      ['Направлений (out)', data.referrals_out, ''],
      ['Конверсия %', data.referrals_conversion_pct, ''],
      ['Бонусы выплачены', data.bonuses_paid_total, ''],
      ['Средний бонус', data.bonuses_avg_per_referral, ''],
      ['LTV среднее', data.ltv_avg, ''],
      ['LTV медиана', data.ltv_median, ''],
      ['Активных тенантов', data.active_tenants, ''],
      ['Trial-тенантов', data.trial_tenants, ''],
      ['Подписок на модули', data.module_subscriptions_total, ''],
      ['MRR оценка', data.mrr_estimate, ''],
    ]
    downloadCsv(`franchise-kpi-${range}.csv`, rows)
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>KPI-дашборд</Card.Title>
        <div className="flex items-center gap-2">
          <Tabs items={RANGE_TABS} value={range} onChange={setRange} />
          <Button onClick={handleExport} disabled={!data || loading} variant="ghost">
            Экспорт CSV
          </Button>
        </div>
      </Card.Header>
      <Card.Body>
        {error && (
          <div className="p-4 rounded-lg" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>
            {error}
          </div>
        )}
        {loading && <KpiSkeletonGrid />}
        {!loading && !error && data && (
          <>
            <KpiRow cols={4} className="mb-4">
              <BigKpiCard
                label="Выручка"
                value={fmtRub(data.revenue_total)}
                delta={data.revenue_growth_pct}
              />
              <BigKpiCard
                label="Записи"
                value={fmtNum(data.appointments_count)}
                delta={data.appointments_growth_pct}
              />
              <BigKpiCard
                label="Конверсия рефералов"
                value={`${(data.referrals_conversion_pct ?? 0).toFixed(1)}%`}
                hint={`${fmtNum(data.referrals_in)} вход. / ${fmtNum(data.referrals_out)} исход.`}
              />
              <BigKpiCard
                label="MRR (оценка)"
                value={fmtRub(data.mrr_estimate)}
                hint={`${data.module_subscriptions_total} модулей`}
              />
            </KpiRow>

            <KpiRow cols={4} className="mb-4">
              <SmallKpiCard label="Новых пациентов" value={fmtNum(data.new_patients)} />
              <SmallKpiCard label="Повторных" value={fmtNum(data.returning_patients)} />
              <SmallKpiCard
                label="Бонусы выплачены"
                value={fmtRub(data.bonuses_paid_total)}
                hint={`Ср. ${fmtRub(data.bonuses_avg_per_referral)}/реф.`}
              />
              <SmallKpiCard
                label="LTV (avg / med)"
                value={`${fmtRub(data.ltv_avg)} / ${fmtRub(data.ltv_median)}`}
              />
            </KpiRow>

            <KpiRow cols={3} className="mb-4">
              <SmallKpiCard label="Активных тенантов" value={data.active_tenants} />
              <SmallKpiCard label="Trial" value={data.trial_tenants} />
              <SmallKpiCard
                label="Истекают подписки (≤14дн)"
                value={data.expiring_subscriptions_count}
                accent={data.expiring_subscriptions_count > 0 ? 'warn' : 'ok'}
              />
            </KpiRow>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <div className="text-xs uppercase mb-1" style={{ color: 'var(--fg-3)', letterSpacing: '0.06em' }}>
                  Топ клиника по выручке
                </div>
                {data.top_clinic_by_revenue ? (
                  <>
                    <div className="font-semibold text-lg" style={{ color: 'var(--fg)' }}>
                      {data.top_clinic_by_revenue.clinic_name}
                    </div>
                    <div className="font-bold tabular-nums" style={{ fontSize: 22, color: 'var(--accent)' }}>
                      {fmtRub(data.top_clinic_by_revenue.revenue)}
                    </div>
                  </>
                ) : (
                  <div style={{ color: 'var(--fg-3)' }}>—</div>
                )}
              </Card>

              <Card>
                <div className="text-xs uppercase mb-1" style={{ color: 'var(--fg-3)', letterSpacing: '0.06em' }}>
                  Топ врач по записям
                </div>
                {data.top_doctor_by_appointments ? (
                  <>
                    <div className="font-semibold text-lg" style={{ color: 'var(--fg)' }}>
                      {data.top_doctor_by_appointments.doctor_name}
                    </div>
                    <div className="font-bold tabular-nums" style={{ fontSize: 22, color: 'var(--accent)' }}>
                      {fmtNum(data.top_doctor_by_appointments.appointments)} записей
                    </div>
                  </>
                ) : (
                  <div style={{ color: 'var(--fg-3)' }}>—</div>
                )}
              </Card>
            </div>
          </>
        )}
      </Card.Body>
    </Card>
  )
}

function KpiSkeletonGrid() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-xl"
            style={{ padding: 16, background: 'var(--bg-1)', border: '1px solid var(--border)' }}
          >
            <Skeleton width="60%" height={12} />
            <div style={{ height: 8 }} />
            <Skeleton width="80%" height={28} variant="rect" />
            <div style={{ height: 8 }} />
            <Skeleton width="40%" height={10} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-xl"
            style={{ padding: 12, background: 'var(--bg-1)', border: '1px solid var(--border)' }}
          >
            <Skeleton width="60%" height={11} />
            <div style={{ height: 6 }} />
            <Skeleton width="70%" height={20} variant="rect" />
          </div>
        ))}
      </div>
    </div>
  )
}

function BigKpiCard({ label, value, delta, hint }) {
  const positive = delta == null ? null : delta >= 0
  return (
    <div
      className="rounded-xl"
      style={{
        padding: 16,
        background: 'var(--bg-1)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="text-xs uppercase mb-1" style={{ color: 'var(--fg-3)', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div className="font-bold tabular-nums" style={{ fontSize: 26, color: 'var(--fg)' }}>
        {value}
      </div>
      {delta != null && (
        <div
          className="text-xs font-semibold mt-1"
          style={{ color: positive ? 'var(--ok, #10b981)' : 'var(--bad, #ef4444)' }}
        >
          {positive ? '▲' : '▼'} {fmtPct(delta)}
        </div>
      )}
      {hint && (
        <div className="text-xs mt-1" style={{ color: 'var(--fg-3)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}

function SmallKpiCard({ label, value, hint, accent }) {
  let valueColor = 'var(--fg)'
  if (accent === 'warn') valueColor = 'var(--warn, #f59e0b)'
  if (accent === 'ok') valueColor = 'var(--ok, #10b981)'
  return (
    <div
      className="rounded-xl"
      style={{
        padding: 12,
        background: 'var(--bg-1)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="text-[11px] uppercase mb-1" style={{ color: 'var(--fg-3)', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div className="font-bold tabular-nums" style={{ fontSize: 18, color: valueColor }}>
        {value}
      </div>
      {hint && (
        <div className="text-xs mt-1" style={{ color: 'var(--fg-3)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// 2. Cohort-анализ
// ───────────────────────────────────────────────────────────────────────────

function CohortAnalysis() {
  const [metric, setMetric] = useState('revenue')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [drillClinic, setDrillClinic] = useState(null) // clinic_id для drill-down

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .get('/admin/analytics/cohort-clinics', { params: { metric, period: 'monthly' } })
      .then((r) => !cancelled && setData(r.data))
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || 'Ошибка загрузки'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [metric])

  // Цветовая шкала: красный → жёлтый → зелёный по перцентилю
  const colorFor = useCallback(
    (val, max) => {
      if (!max || val <= 0) return 'var(--bg-2)'
      const ratio = Math.min(1, val / max)
      if (ratio < 0.33) return 'oklch(0.66 0.18 25 / 0.55)' // красный
      if (ratio < 0.66) return 'oklch(0.85 0.16 90 / 0.55)' // жёлтый
      return 'oklch(0.72 0.18 145 / 0.55)' // зелёный
    },
    []
  )

  const maxValue = useMemo(() => {
    if (!data) return 0
    let m = 0
    data.clinics.forEach((c) => c.values.forEach((v) => (m = Math.max(m, v))))
    return m
  }, [data])

  const filteredClinics = useMemo(() => {
    if (!data) return []
    if (!drillClinic) return data.clinics
    return data.clinics.filter((c) => c.clinic_id === drillClinic)
  }, [data, drillClinic])

  const handleExport = () => {
    if (!data) return
    const header = ['Клиника', 'Tenant', ...data.months, 'Ранг', 'Δ к среднему %']
    const rows = [header]
    data.clinics.forEach((c) => {
      rows.push([
        c.clinic_name,
        c.tenant_slug,
        ...c.values,
        c.rank_current,
        c.growth_vs_cohort,
      ])
    })
    downloadCsv(`cohort-${metric}.csv`, rows)
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>Cohort-анализ клиник</Card.Title>
        <div className="flex items-center gap-2 flex-wrap">
          <Tabs items={METRIC_TABS} value={metric} onChange={setMetric} />
          <Button onClick={handleExport} disabled={!data || loading} variant="ghost">
            Экспорт CSV
          </Button>
          {drillClinic && (
            <Button onClick={() => setDrillClinic(null)} variant="ghost">
              Сбросить фильтр
            </Button>
          )}
        </div>
      </Card.Header>
      <Card.Body>
        {error && (
          <div className="p-4 rounded-lg" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>
            {error}
          </div>
        )}
        {loading && <TableSkeleton rows={5} cols={13} />}
        {!loading && !error && data && (
          <>
            <div className="text-xs mb-3" style={{ color: 'var(--fg-3)' }}>
              Размер когорты: <b>{data.cohort_size}</b> клиник · перцентили (тек. месяц): P25 = <b>{fmtNum(data.percentiles.p25)}</b> · P50 = <b>{fmtNum(data.percentiles.p50)}</b> · P75 = <b>{fmtNum(data.percentiles.p75)}</b> · среднее = <b>{fmtNum(data.cohort_avg_current)}</b>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-2)' }}>
                    <th className="text-left p-2 font-semibold" style={{ position: 'sticky', left: 0, background: 'var(--bg-2)', zIndex: 1, minWidth: 200 }}>
                      Клиника
                    </th>
                    {data.months.map((m) => (
                      <th key={m} className="p-2 text-center font-semibold tabular-nums" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                        {m}
                      </th>
                    ))}
                    <th className="p-2 text-center font-semibold" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                      Δ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClinics.length === 0 ? (
                    <tr>
                      <td colSpan={data.months.length + 2}>
                        <EmptyState title="Нет данных" description="Для выбранной франшизы пока нет клиник с активностью" />
                      </td>
                    </tr>
                  ) : (
                    filteredClinics.map((c) => (
                      <tr key={c.clinic_id}>
                        <td
                          className="p-2 font-medium"
                          style={{
                            position: 'sticky',
                            left: 0,
                            background: 'var(--bg-1)',
                            borderTop: '1px solid var(--border)',
                            cursor: 'pointer',
                          }}
                          onClick={() => setDrillClinic(c.clinic_id === drillClinic ? null : c.clinic_id)}
                          title="Клик для drill-down фильтра"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="grid place-items-center rounded"
                              style={{
                                width: 22,
                                height: 22,
                                background: 'var(--accent-soft)',
                                color: 'var(--accent)',
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              #{c.rank_current}
                            </span>
                            <div>
                              <div style={{ color: 'var(--fg)' }}>{c.clinic_name}</div>
                              <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{c.tenant_slug}</div>
                            </div>
                          </div>
                        </td>
                        {c.values.map((v, i) => (
                          <td
                            key={i}
                            title={`${c.clinic_name} · ${data.months[i]}: ${fmtNum(v)}`}
                            className="p-1 text-center tabular-nums"
                            style={{
                              background: colorFor(v, maxValue),
                              fontSize: 11,
                              borderTop: '1px solid var(--border)',
                              minWidth: 56,
                              cursor: 'help',
                            }}
                          >
                            {v >= 1000 ? `${Math.round(v / 1000)}к` : Math.round(v)}
                          </td>
                        ))}
                        <td
                          className="p-2 text-center font-semibold tabular-nums"
                          style={{
                            color: c.growth_vs_cohort >= 0 ? 'var(--ok, #10b981)' : 'var(--bad, #ef4444)',
                            borderTop: '1px solid var(--border)',
                          }}
                        >
                          {fmtPct(c.growth_vs_cohort)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card.Body>
    </Card>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Bulk-тарифы
// ───────────────────────────────────────────────────────────────────────────

const PLAN_OPTIONS = [
  { value: '', label: '— не менять —' },
  { value: 'starter', label: 'Starter (basic)' },
  { value: 'pro', label: 'Pro (professional)' },
  { value: 'enterprise', label: 'Enterprise' },
]

function BulkPricing() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [edits, setEdits] = useState({}) // tenant_id -> { plan, modules }
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState(0)
  const toast = useToast?.()

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .get('/admin/franchise/tenants-pricing')
      .then((r) => setData(r.data))
      .catch((e) => setError(e?.response?.data?.detail || 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const setEdit = (tid, patch) => {
    setEdits((prev) => ({ ...prev, [tid]: { ...(prev[tid] || {}), ...patch } }))
  }

  const toggleModule = (tid, key) => {
    setEdits((prev) => {
      const cur = prev[tid] || {}
      const t = data?.tenants.find((x) => x.tenant_id === tid)
      const baseModules = cur.modules ?? (t ? [...t.active_modules] : [])
      const set = new Set(baseModules)
      if (set.has(key)) set.delete(key)
      else set.add(key)
      return { ...prev, [tid]: { ...cur, modules: [...set] } }
    })
  }

  const buildPayload = () => {
    const updates = []
    Object.entries(edits).forEach(([tid, ed]) => {
      const item = { tenant_id: tid }
      if (ed.plan) item.plan = ed.plan
      if (ed.modules !== undefined) item.modules = ed.modules
      if (item.plan || item.modules !== undefined) updates.push(item)
    })
    return updates
  }

  const apply = async () => {
    const updates = buildPayload()
    if (updates.length === 0) {
      toast?.show?.('Нет изменений для применения', 'warn')
      return
    }
    setSubmitting(true)
    setProgress(15)
    try {
      const r = await api.post('/admin/franchise/bulk-update-plans', { updates })
      setProgress(80)
      toast?.show?.(`Обновлено: ${r.data.updated_count}`, 'success')
      setEdits({})
      reload()
    } catch (e) {
      toast?.show?.(e?.response?.data?.detail || 'Ошибка bulk-обновления', 'error')
    } finally {
      setProgress(100)
      setTimeout(() => setProgress(0), 600)
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>Bulk-настройка тарифов</Card.Title>
        <div className="flex items-center gap-2">
          <Button onClick={apply} disabled={submitting || Object.keys(edits).length === 0}>
            Применить
          </Button>
          <Button onClick={() => setEdits({})} variant="ghost" disabled={submitting}>
            Сбросить
          </Button>
        </div>
      </Card.Header>
      <Card.Body>
        {submitting && progress > 0 && (
          <div
            className="mb-3 rounded-full overflow-hidden"
            style={{ height: 4, background: 'var(--bg-2)' }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                background: 'var(--accent)',
                transition: 'width .3s',
              }}
            />
          </div>
        )}
        {error && (
          <div className="p-4 rounded-lg" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>
            {error}
          </div>
        )}
        {loading && <TableSkeleton rows={4} cols={4} />}
        {!loading && data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-2)' }}>
                  <th className="text-left p-2 font-semibold">Тенант</th>
                  <th className="text-left p-2 font-semibold">Текущий план</th>
                  <th className="text-left p-2 font-semibold" style={{ minWidth: 160 }}>
                    Новый план
                  </th>
                  <th className="text-left p-2 font-semibold">Модули</th>
                </tr>
              </thead>
              <tbody>
                {data.tenants.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      <EmptyState title="Нет тенантов" description="Создайте первый тенант в кабинете владельца" />
                    </td>
                  </tr>
                )}
                {data.tenants.map((t) => {
                  const ed = edits[t.tenant_id] || {}
                  const modulesNow = ed.modules ?? t.active_modules
                  const dirty = ed.plan || ed.modules !== undefined
                  return (
                    <tr
                      key={t.tenant_id}
                      style={{ borderTop: '1px solid var(--border)', background: dirty ? 'var(--accent-soft)' : 'transparent' }}
                    >
                      <td className="p-2">
                        <div className="font-medium" style={{ color: 'var(--fg)' }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{t.slug}</div>
                      </td>
                      <td className="p-2 tabular-nums">
                        <Chip>{t.current_plan || '—'}</Chip>
                        <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{t.subscription_status || ''}</div>
                      </td>
                      <td className="p-2">
                        <select
                          value={ed.plan || ''}
                          onChange={(e) => setEdit(t.tenant_id, { plan: e.target.value })}
                          className="rounded px-2 py-1.5 text-sm w-full"
                          style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--fg)' }}
                        >
                          {PLAN_OPTIONS.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {(data.modules_catalog || []).map((m) => {
                            const active = modulesNow.includes(m.key)
                            return (
                              <button
                                key={m.key}
                                type="button"
                                onClick={() => toggleModule(t.tenant_id, m.key)}
                                className="px-2 py-1 rounded text-xs"
                                title={`${m.name} · ${fmtRub(m.price_monthly)}/мес`}
                                style={{
                                  background: active ? 'var(--accent-soft)' : 'var(--bg-2)',
                                  color: active ? 'var(--accent)' : 'var(--fg-3)',
                                  border: '1px solid var(--border)',
                                  fontWeight: active ? 600 : 400,
                                }}
                              >
                                {m.key}
                              </button>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card.Body>
    </Card>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// 4. Рекомендации
// ───────────────────────────────────────────────────────────────────────────

const SEVERITY_COLORS = {
  critical: { bg: 'oklch(0.62 0.21 28 / 0.12)', border: 'oklch(0.62 0.21 28 / 0.4)', fg: 'oklch(0.62 0.21 28)' },
  warning: { bg: 'oklch(0.78 0.16 80 / 0.12)', border: 'oklch(0.78 0.16 80 / 0.4)', fg: 'oklch(0.65 0.16 80)' },
  info: { bg: 'oklch(0.65 0.13 240 / 0.10)', border: 'oklch(0.65 0.13 240 / 0.35)', fg: 'oklch(0.55 0.16 240)' },
}

function Recommendations() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('clinika.rec.dismissed') || '[]'))
    } catch (e) {
      return new Set()
    }
  })
  const toast = useToast?.()

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .get('/admin/analytics/recommendations')
      .then((r) => setData(r.data))
      .catch((e) => setError(e?.response?.data?.detail || 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [])

  const dismiss = (id) => {
    const next = new Set(dismissed)
    next.add(id)
    setDismissed(next)
    try {
      localStorage.setItem('clinika.rec.dismissed', JSON.stringify([...next]))
    } catch (e) {
      // ignore
    }
    toast?.show?.('Рекомендация отклонена', 'info')
  }

  const apply = (rec) => {
    if (rec.action_url) {
      window.location.hash = rec.action_url
    }
    toast?.show?.('Открываем рекомендуемое действие', 'info')
  }

  const visible = (data?.items || []).filter((r) => !dismissed.has(r.id))

  return (
    <Card>
      <Card.Header>
        <Card.Title>Рекомендации</Card.Title>
        <div className="text-xs" style={{ color: 'var(--fg-3)' }}>
          {data ? `${visible.length} активных из ${data.count}` : ''}
        </div>
      </Card.Header>
      <Card.Body>
        {error && (
          <div className="p-4 rounded-lg" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>
            {error}
          </div>
        )}
        {loading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-xl"
                style={{ padding: 16, background: 'var(--bg-1)', border: '1px solid var(--border)' }}
              >
                <Skeleton width="50%" height={14} />
                <div style={{ height: 6 }} />
                <Skeleton width="90%" height={11} />
                <div style={{ height: 4 }} />
                <Skeleton width="70%" height={11} />
              </div>
            ))}
          </div>
        )}
        {!loading && !error && visible.length === 0 && (
          <EmptyState
            title="Всё под контролем"
            description="Платформа не нашла критичных проблем — отдыхайте."
          />
        )}
        <div className="space-y-3">
          {visible.map((rec) => {
            const c = SEVERITY_COLORS[rec.severity] || SEVERITY_COLORS.info
            return (
              <div
                key={rec.id}
                className="rounded-xl"
                style={{
                  padding: 16,
                  background: c.bg,
                  border: `1px solid ${c.border}`,
                }}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Chip
                        style={{
                          background: c.fg,
                          color: '#fff',
                          fontSize: 10,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        {rec.severity}
                      </Chip>
                      <span className="text-xs" style={{ color: 'var(--fg-3)' }}>
                        {rec.type}
                      </span>
                    </div>
                    <div className="font-semibold" style={{ color: 'var(--fg)' }}>
                      {rec.title}
                    </div>
                    <div className="text-sm mt-1" style={{ color: 'var(--fg-2)' }}>
                      {rec.description}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {rec.action_url && (
                      <Button onClick={() => apply(rec)} variant="primary">
                        Применить
                      </Button>
                    )}
                    <Button onClick={() => dismiss(rec.id)} variant="ghost">
                      Отклонить
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Card.Body>
    </Card>
  )
}
