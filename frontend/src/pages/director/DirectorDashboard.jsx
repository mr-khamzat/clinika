/**
 * ========================================
 * БЛОК: DirectorDashboard — главная директорского кабинета
 * ========================================
 * Read-only дашборд: KPI-карточки + графики + сводки по клиникам/услугам/врачам.
 * Grid 1 col (mobile) → 2 col (tablet) → 4 col (desktop).
 * ========================================
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import { Card, Button, EmptyState, Skeleton, useToast } from '../../design'
import { useDirectorPeriod } from '../DirectorLayout'
import {
  BarChart, DonutChart, FunnelChart, SparkLine,
  fmtRUB, fmtInt, fmtPct,
} from './_DirectorCharts'

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

// ─── Виджет «большая цифра + sparkline» ──────────────────────────────────────
function MetricCard({ label, value, delta, trend, sparkline, notice, icon, accent = 'var(--accent)' }) {
  const deltaColor =
    trend === 'down' ? 'var(--bad)' : trend === 'flat' ? 'var(--fg-3)' : 'var(--good)'
  return (
    <Card padded>
      <div className="flex items-center gap-2 mb-2">
        {icon && (
          <span
            className="inline-grid place-items-center flex-shrink-0"
            style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-soft)', color: accent }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}>{icon}</span>
          </span>
        )}
        <span style={{ fontSize: 12, color: 'var(--fg-3)', fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{
        fontSize: 'clamp(22px, 4.5vw, 28px)',
        fontWeight: 700, letterSpacing: '-0.02em',
        fontVariantNumeric: 'tabular-nums', color: 'var(--fg)',
      }}>
        {value}
      </div>
      <div className="flex items-end justify-between mt-2 gap-2">
        <div style={{ fontSize: 12, color: deltaColor, fontWeight: 600 }}>
          {delta || ''}
        </div>
        {sparkline && sparkline.length >= 2 && (
          <SparkLine data={sparkline} width={84} height={28} color={accent} />
        )}
      </div>
      {notice && (
        <div className="mt-2 px-2 py-1.5 rounded" style={{ background: 'var(--bg-1)', fontSize: 11, color: 'var(--fg-3)' }}>
          {notice}
        </div>
      )}
    </Card>
  )
}

export default function DirectorDashboard() {
  const nav = useNavigate()
  const { from, to } = useDirectorPeriod()
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [funnel, setFunnel] = useState(null)
  const [sources, setSources] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    Promise.allSettled([
      api.get('/director/dashboard', { params: { from, to } }),
      api.get('/director/kpi/funnel', { params: { from, to } }),
      api.get('/director/marketing/sources', { params: { from, to } }),
    ]).then(results => {
      if (!alive) return
      const [dashR, funR, srcR] = results
      if (dashR.status === 'fulfilled') setData(dashR.value.data)
      else setError('Бэкенд дашборда временно недоступен')
      if (funR.status === 'fulfilled') setFunnel(funR.value.data)
      if (srcR.status === 'fulfilled') setSources(srcR.value.data)
      setLoading(false)
    })
    return () => { alive = false }
  }, [from, to])

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}><Skeleton height={92} /></Card>
        ))}
      </div>
    )
  }

  if (error && !data) {
    return (
      <EmptyState
        icon="cloud_off"
        title="Бэкенд директора пока не готов"
        description="Когда API директора заработает — этот экран наполнится метриками автоматически."
      />
    )
  }

  const d = data || {}
  const revenue   = d.revenue || {}
  const expenses  = d.expenses || {}
  const profit    = d.profit || {}
  const cashflow  = d.cashflow || {}
  const clinics   = d.top_clinics || d.clinics || []
  const services  = d.top_services || []
  const doctors   = d.top_doctors || []
  const activity  = d.activity || {}
  const alerts    = d.alerts || []
  const summary   = d.summary || {}

  // delta-helpers
  const deltaStr = (pct) => {
    if (pct == null) return ''
    const sign = pct >= 0 ? '+' : ''
    return `${sign}${Number(pct).toFixed(1)}% к прошлому периоду`
  }
  const trendOf = (pct) => pct == null ? 'flat' : (pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat')

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {/* ───────── Кнопка экспорта сводного отчёта ───────── */}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          onClick={() => downloadBlob(
            '/director/export/dashboard.pdf',
            { from, to },
            `dashboard_${from}_${to}.pdf`,
            toast,
          )}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>picture_as_pdf</span>
          Сводный отчёт PDF
        </Button>
      </div>

      {/* ───────── Row 1: 4 metric-карточки ───────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <MetricCard
          icon="payments"
          label="Выручка за период"
          value={fmtRUB(revenue.total || revenue.value || 0)}
          delta={deltaStr(revenue.delta_pct)}
          trend={trendOf(revenue.delta_pct)}
          sparkline={d.revenue_sparkline || revenue.sparkline}
          accent="var(--accent)"
        />
        <MetricCard
          icon="trending_down"
          label="Расходы"
          value={fmtRUB(expenses.total || expenses.value || 0)}
          delta={deltaStr(expenses.delta_pct)}
          trend={expenses.delta_pct > 0 ? 'down' : expenses.delta_pct < 0 ? 'up' : 'flat'}
          sparkline={expenses.sparkline}
          notice={expenses.notice}
          accent="#dc2626"
        />
        <MetricCard
          icon="savings"
          label="Прибыль"
          value={fmtRUB(profit.total || profit.value || 0)}
          delta={profit.margin_pct != null ? `Маржа ${fmtPct(profit.margin_pct)}` : deltaStr(profit.delta_pct)}
          trend={trendOf(profit.delta_pct)}
          sparkline={profit.sparkline}
          accent="#059669"
        />
        <MetricCard
          icon="account_balance_wallet"
          label="Кешфло (нетто)"
          value={fmtRUB(cashflow.net || 0)}
          delta={`Прих. ${fmtRUB(cashflow.inflow || 0)} · Расх. ${fmtRUB(cashflow.outflow || 0)}`}
          trend={(cashflow.net || 0) >= 0 ? 'up' : 'down'}
          sparkline={cashflow.sparkline}
          accent="#7c3aed"
        />
      </div>

      {/* ───────── Row 2: клиники + воронка + источники ───────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* По клиникам */}
        <Card padded className="lg:col-span-2">
          <Card.Header>
            <Card.Title>По клиникам</Card.Title>
            <button
              onClick={() => nav('/director/clinics')}
              style={{
                fontSize: 12, color: 'var(--accent)', fontWeight: 600,
                background: 'transparent', border: 'none', cursor: 'pointer',
              }}
            >
              Подробнее →
            </button>
          </Card.Header>
          {clinics.length === 0 ? (
            <EmptyState icon="local_hospital" title="Нет данных по клиникам" />
          ) : (
            <div className="overflow-x-auto" style={{ marginLeft: -8, marginRight: -8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: 'var(--fg-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Клиника</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700 }}>Выручка</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700 }} className="hidden sm:table-cell">Приёмы</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700 }} className="hidden md:table-cell">Прибыль</th>
                  </tr>
                </thead>
                <tbody>
                  {clinics.slice(0, 8).map((c, i) => (
                    <tr key={`cl-${i}`} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                      onClick={() => nav('/director/clinics')}>
                      <td style={{ padding: '8px', fontWeight: 600, color: 'var(--fg)' }}>{c.name || c.slug}</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--fg)' }}>{fmtRUB(c.revenue)}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: 'var(--fg-2)' }} className="hidden sm:table-cell">{fmtInt(c.appointments || c.appts || 0)}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: 'var(--good)', fontWeight: 600 }} className="hidden md:table-cell">{fmtRUB(c.profit || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Источники пациентов */}
        <Card padded>
          <Card.Header>
            <Card.Title>Источники пациентов</Card.Title>
          </Card.Header>
          <DonutChart
            slices={(sources?.sources || []).slice(0, 6).map(s => ({
              label: s.name, value: s.count || s.revenue || 0,
            }))}
            formatter={fmtInt}
            size={180}
          />
        </Card>
      </div>

      {/* ───────── Row 3: топ услуг + топ врачей ───────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card padded>
          <Card.Header>
            <Card.Title>Топ-5 услуг</Card.Title>
            <button onClick={() => nav('/director/services')} style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer' }}>
              Все →
            </button>
          </Card.Header>
          <BarChart
            horizontal
            items={services.slice(0, 5).map(s => ({ label: s.name, value: s.revenue || s.amount || 0 }))}
            formatter={fmtRUB}
          />
        </Card>
        <Card padded>
          <Card.Header>
            <Card.Title>Топ-5 врачей</Card.Title>
            <button onClick={() => nav('/director/doctors')} style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer' }}>
              Все →
            </button>
          </Card.Header>
          <BarChart
            horizontal
            items={doctors.slice(0, 5).map(d => ({ label: d.name || d.full_name, value: d.revenue || d.amount || 0 }))}
            formatter={fmtRUB}
          />
        </Card>
      </div>

      {/* ───────── Row 4: воронка + активность + алерты ───────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card padded>
          <Card.Header>
            <Card.Title>Воронка</Card.Title>
            <button onClick={() => nav('/director/kpi')} style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer' }}>KPI →</button>
          </Card.Header>
          <FunnelChart stages={funnel?.stages || []} />
        </Card>

        <Card padded>
          <Card.Header><Card.Title>Активность</Card.Title></Card.Header>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { lbl: 'Сегодня',  v: activity.today  },
              { lbl: 'Неделя',   v: activity.week   },
              { lbl: 'Месяц',    v: activity.month  },
            ].map(row => (
              <div key={row.lbl} className="flex items-center justify-between"
                style={{ padding: '10px 12px', background: 'var(--bg-1)', borderRadius: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--fg-3)', fontWeight: 600 }}>{row.lbl}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtInt(row.v || 0)} <span style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 500 }}>приёмов</span>
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card padded>
          <Card.Header>
            <Card.Title>Алерты</Card.Title>
            <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{alerts.length || 0}</span>
          </Card.Header>
          {alerts.length === 0 ? (
            <div className="text-center py-6" style={{ color: 'var(--fg-3)', fontSize: 13 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 32, color: 'var(--good)', display: 'block', marginBottom: 4 }}>check_circle</span>
              Алертов нет
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {alerts.slice(0, 5).map((a, i) => (
                <div key={`a-${i}`} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--bad-soft, #fee2e2)', fontSize: 12, color: 'var(--bad, #b91c1c)' }}>
                  {a.message || a.text || JSON.stringify(a)}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ───────── Row 5: сводка по клиникам ───────── */}
      <Card padded>
        <Card.Header>
          <Card.Title>Сводка по сети</Card.Title>
        </Card.Header>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600 }}>Клиник всего</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg)' }}>{fmtInt(d.clinics_count || clinics.length)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600 }}>Лучшая клиника</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{summary.best_clinic_name || clinics[0]?.name || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600 }}>% выполнения плана</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: (summary.plan_pct || 0) >= 100 ? 'var(--good)' : 'var(--fg)' }}>
              {summary.plan_pct != null ? fmtPct(summary.plan_pct) : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600 }}>Средний чек по сети</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg)' }}>{fmtRUB(summary.avg_check || 0)}</div>
          </div>
        </div>
      </Card>
    </div>
  )
}
