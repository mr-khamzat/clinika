/**
 * ========================================
 * pages/AdminArrLtv.jsx — ARR / Cohort LTV / Forecast Dashboard
 * ========================================
 * Страница super_admin: 4 KPI сверху, retention heatmap кохорт, LTV-сводка,
 * прогноз MRR (sparkline).
 *
 * Endpoints:
 *   GET /admin/arr-ltv/summary
 *   GET /admin/arr-ltv/cohorts?months=12
 *   GET /admin/arr-ltv/ltv
 *   GET /admin/arr-ltv/forecast?months_ahead=6
 *
 * Дизайн:
 *   - Только design-tokens из /src/design/tokens.css (var(--accent), var(--good)...)
 *   - Компоненты из /src/design (KpiCard, KpiRow, Card, Page, Sparkline)
 *   - Heatmap собирается inline CSS — без recharts.
 *
 * Прокси-токен: страница ожидает adminToken в localStorage (ключ 'admin_token'),
 * как и остальные admin-страницы (см. AdminLayout.jsx).
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../config'
import {
  Page,
  PageHeader,
  Card,
  KpiCard,
  KpiRow,
  Sparkline,
  Chip,
} from '../design'

// ── helpers ──────────────────────────────────────────────────────────────────

function formatRub(v) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽'
}

function formatPct(v) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return (n > 0 ? '+' : '') + n.toFixed(1) + '%'
}

/**
 * retention% → background-color на основе токенов:
 *   100% → var(--good)
 *   0%   → var(--bad-soft)
 *   между → линейная интерполяция через прозрачность var(--accent).
 */
function cellBg(pct) {
  if (pct === null || pct === undefined) return 'var(--bg-2)'
  const p = Math.max(0, Math.min(100, Number(pct))) / 100
  // OKLCH через CSS color-mix — fallback на rgba.
  // Используем var(--accent) с заданной прозрачностью.
  const alpha = 0.08 + p * 0.7 // от 0.08 до 0.78
  return `color-mix(in oklab, var(--accent) ${(alpha * 100).toFixed(0)}%, var(--surface))`
}

function cellFg(pct) {
  if (pct === null || pct === undefined) return 'var(--fg-3)'
  const p = Number(pct)
  // выше ~60% — белый текст лучше читается
  if (p >= 55) return 'var(--accent-fg)'
  return 'var(--fg)'
}

async function apiGet(url, token) {
  const resp = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (!resp.ok) {
    throw new Error(`${url} → ${resp.status}`)
  }
  return resp.json()
}

// ── main component ───────────────────────────────────────────────────────────

export default function AdminArrLtv({ token: tokenProp }) {
  const token = tokenProp || (typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null)

  const [summary, setSummary] = useState(null)
  const [cohorts, setCohorts] = useState(null)
  const [ltv, setLtv] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let canceled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [s, c, l, f] = await Promise.all([
          apiGet(API_BASE + '/admin/arr-ltv/summary', token),
          apiGet(API_BASE + '/admin/arr-ltv/cohorts?months=12', token),
          apiGet(API_BASE + '/admin/arr-ltv/ltv', token),
          apiGet(API_BASE + '/admin/arr-ltv/forecast?months_ahead=6', token),
        ])
        if (canceled) return
        setSummary(s)
        setCohorts(c)
        setLtv(l)
        setForecast(f)
      } catch (e) {
        if (!canceled) setError(String(e.message || e))
      } finally {
        if (!canceled) setLoading(false)
      }
    }
    load()
    return () => {
      canceled = true
    }
  }, [token])

  const trendForKpi = useMemo(() => {
    if (!summary?.mom_growth_pct) return 'flat'
    return summary.mom_growth_pct >= 0 ? 'up' : 'down'
  }, [summary])

  // Максимальная длина retention-строки — для выравнивания колонок heatmap.
  const maxCols = useMemo(() => {
    if (!cohorts?.cohorts?.length) return 0
    return Math.max(...cohorts.cohorts.map((c) => c.retention.length))
  }, [cohorts])

  const sparkData = useMemo(() => {
    if (!forecast) return []
    const hist = (forecast.history || []).map((p) => p.mrr)
    const fc = (forecast.forecast || []).map((p) => p.mrr_forecast)
    return [...hist, ...fc]
  }, [forecast])

  return (
    <Page>
      <div style={{ padding: '20px 28px' }}>
        <PageHeader
          title="ARR / LTV / Forecast"
          subtitle="Финансовый pulse платформы: годовая выручка, удержание кохорт, прогноз MRR"
        />

        {error && (
          <Card className="mt-4">
            <div style={{ color: 'var(--bad)' }}>Ошибка загрузки: {error}</div>
          </Card>
        )}

        {/* ── 4 KPI: MRR / ARR / Active tenants / MoM ─────────────────── */}
        <div className="mt-4">
          <KpiRow cols={4}>
            <KpiCard
              label="MRR"
              value={loading ? '…' : formatRub(summary?.mrr_rub)}
            />
            <KpiCard
              label="ARR"
              value={loading ? '…' : formatRub(summary?.arr_rub)}
            />
            <KpiCard
              label="Активных тенантов"
              value={loading ? '…' : (summary?.total_active_tenants ?? '—')}
            />
            <KpiCard
              label="MoM рост"
              value={loading ? '…' : formatPct(summary?.mom_growth_pct)}
              trend={trendForKpi}
              delta={summary?.mom_growth_pct != null ? formatPct(summary.mom_growth_pct) : null}
            />
          </KpiRow>
        </div>

        {/* ── Forecast sparkline ──────────────────────────────────────── */}
        <Card className="mt-6">
          <Card.Header>
            <div>
              <Card.Title>Прогноз MRR на 6 месяцев</Card.Title>
              <Card.Subtitle>
                Линейная регрессия по последним 12 точкам.{' '}
                {forecast && (
                  <Chip
                    variant={
                      forecast.confidence === 'high'
                        ? 'good'
                        : forecast.confidence === 'medium'
                        ? 'warn'
                        : 'default'
                    }
                  >
                    confidence: {forecast.confidence} (R²={forecast.r2})
                  </Chip>
                )}
              </Card.Subtitle>
            </div>
            {forecast && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--fg-3)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                slope: {forecast.slope > 0 ? '+' : ''}
                {forecast.slope?.toLocaleString('ru-RU')} ₽/мес
              </div>
            )}
          </Card.Header>
          <div style={{ padding: '4px 0' }}>
            {sparkData.length >= 2 ? (
              <Sparkline data={sparkData} width={760} height={120} strokeWidth={2} />
            ) : (
              <div style={{ color: 'var(--fg-3)', fontSize: 13 }}>
                Нет данных для прогноза.
              </div>
            )}
          </div>
          {forecast && forecast.forecast?.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${forecast.forecast.length}, 1fr)`,
                gap: 8,
                marginTop: 12,
              }}
            >
              {forecast.forecast.map((p) => (
                <div
                  key={p.month}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    background: 'var(--bg-1)',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{p.month}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {formatRub(p.mrr_forecast)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Cohort retention heatmap ────────────────────────────────── */}
        <Card className="mt-6" padded={false}>
          <div style={{ padding: 20 }}>
            <Card.Title>Cohort retention</Card.Title>
            <Card.Subtitle>
              Доля выживших тенантов от месяца первой подписки. 100% — все ещё активны.
            </Card.Subtitle>
          </div>
          <div style={{ overflowX: 'auto', padding: '0 20px 20px' }}>
            {cohorts?.cohorts?.length ? (
              <table
                style={{
                  borderCollapse: 'separate',
                  borderSpacing: 4,
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: 'left',
                        color: 'var(--fg-3)',
                        fontWeight: 500,
                        padding: '4px 8px',
                        minWidth: 88,
                      }}
                    >
                      Кохорта
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        color: 'var(--fg-3)',
                        fontWeight: 500,
                        padding: '4px 8px',
                      }}
                    >
                      N
                    </th>
                    {Array.from({ length: maxCols }, (_, i) => (
                      <th
                        key={i}
                        style={{
                          color: 'var(--fg-3)',
                          fontWeight: 500,
                          padding: '4px 8px',
                          minWidth: 44,
                        }}
                      >
                        M{i}
                      </th>
                    ))}
                    <th
                      style={{
                        color: 'var(--fg-3)',
                        fontWeight: 500,
                        padding: '4px 8px',
                      }}
                    >
                      Avg revenue
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cohorts.cohorts.map((row) => (
                    <tr key={row.cohort}>
                      <td
                        style={{
                          color: 'var(--fg-2)',
                          padding: '6px 8px',
                          background: 'var(--bg-1)',
                          borderRadius: 6,
                        }}
                      >
                        {row.cohort}
                      </td>
                      <td
                        style={{
                          color: 'var(--fg-2)',
                          padding: '6px 8px',
                          textAlign: 'left',
                        }}
                      >
                        {row.tenants}
                      </td>
                      {Array.from({ length: maxCols }, (_, i) => {
                        const pct = row.retention[i]
                        return (
                          <td
                            key={i}
                            title={
                              pct != null ? `${row.cohort} + ${i} мес: ${pct}%` : null
                            }
                            style={{
                              background: cellBg(pct),
                              color: cellFg(pct),
                              borderRadius: 6,
                              textAlign: 'center',
                              padding: '6px 4px',
                              minWidth: 44,
                              fontWeight: pct != null && pct >= 80 ? 600 : 400,
                            }}
                          >
                            {pct != null ? `${Math.round(pct)}%` : '—'}
                          </td>
                        )
                      })}
                      <td
                        style={{
                          padding: '6px 8px',
                          color: 'var(--fg)',
                          textAlign: 'right',
                          fontWeight: 600,
                        }}
                      >
                        {formatRub(row.avg_revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ color: 'var(--fg-3)', fontSize: 13, padding: 12 }}>
                {loading ? 'Загрузка…' : 'Нет кохорт за выбранный период.'}
              </div>
            )}
          </div>
        </Card>

        {/* ── LTV summary ─────────────────────────────────────────────── */}
        <Card className="mt-6">
          <Card.Header>
            <div>
              <Card.Title>LTV (Customer Lifetime Value)</Card.Title>
              <Card.Subtitle>
                Источник:{' '}
                <Chip variant={ltv?.source === 'ledger' ? 'good' : 'default'}>
                  {ltv?.source || '—'}
                </Chip>{' '}
                · выборка: {ltv?.sample_size ?? '—'} тенантов
              </Card.Subtitle>
            </div>
          </Card.Header>

          <KpiRow cols={3}>
            <KpiCard label="Avg LTV" value={loading ? '…' : formatRub(ltv?.avg_ltv)} />
            <KpiCard label="Median LTV" value={loading ? '…' : formatRub(ltv?.median_ltv)} />
            <KpiCard label="P90 LTV" value={loading ? '…' : formatRub(ltv?.p90_ltv)} />
          </KpiRow>

          {ltv?.by_plan?.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 12,
                marginTop: 20,
              }}
            >
              {ltv.by_plan.map((p) => (
                <div
                  key={p.plan}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: 14,
                    background: 'var(--surface)',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {p.plan}
                  </div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 600,
                      marginTop: 4,
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--fg)',
                    }}
                  >
                    {formatRub(p.avg_ltv)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>
                    {p.tenants} тенант{p.tenants === 1 ? '' : p.tenants < 5 ? 'а' : 'ов'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Page>
  )
}
