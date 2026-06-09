/**
 * ========================================
 * БЛОК: FranchisePnlSection — Кабинет франшизы → Финансы → P&L
 * ========================================
 * Консолидированный P&L по всей сети.
 *
 * 4 KPI-карточки:
 *   - Revenue (выручка)
 *   - Gross Margin (валовая маржа)
 *   - Taxes (налоги)
 *   - Net Income (чистый доход)
 *
 * Period-picker: current_month | last_month | ytd | custom
 *
 * 2 вкладки:
 *   - By clinic — bar-chart распределения выручки по клиникам сети
 *   - By month — line-chart за последние 12 месяцев (revenue + net_income)
 *
 * Backend:
 *   GET /franchise-owner/pnl/summary?period=...
 *   GET /franchise-owner/pnl/by-clinic?period=...
 *   GET /franchise-owner/pnl/by-month?months=12
 *
 * Без recharts — только CSS/SVG. Дизайн-токены из ../design.
 * ========================================
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import api from '../api'
import {
  Card, KpiRow, KpiCard, Tabs, Button, Chip, EmptyState,
  Skeleton, useToast,
} from '../design'

// ── Хелперы форматирования ─────────────────────────────────────────────────
const fmtRub = (v) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })
    .format(Math.round(v || 0))

const fmtPct = (v) => `${Math.round((v || 0) * 100)}%`

const PERIODS = [
  { value: 'current_month', label: 'Текущий месяц' },
  { value: 'last_month',    label: 'Прошлый месяц' },
  { value: 'ytd',           label: 'С начала года' },
  { value: 'custom',        label: 'Произвольный' },
]

// ── Компонент ─────────────────────────────────────────────────────────────

export default function FranchisePnlSection() {
  const { showToast } = useToast?.() || { showToast: () => {} }

  const [period, setPeriod] = useState('current_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [taxRate, setTaxRate] = useState(0.06)  // 6% УСН по дефолту

  const [summary, setSummary] = useState(null)
  const [byMonth, setByMonth] = useState([])
  const [tab, setTab] = useState('by_clinic')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // ── Строка query-параметров периода ────────────────────────────────────
  const queryParams = useMemo(() => {
    const p = new URLSearchParams()
    p.append('period', period)
    if (period === 'custom' && customFrom) p.append('from', customFrom)
    if (period === 'custom' && customTo) p.append('to', customTo)
    if (taxRate !== null && taxRate !== undefined) p.append('tax_rate', String(taxRate))
    return p.toString()
  }, [period, customFrom, customTo, taxRate])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sumRes, monthRes] = await Promise.all([
        api.get(`/franchise-owner/pnl/summary?${queryParams}`),
        api.get(`/franchise-owner/pnl/by-month?months=12&tax_rate=${taxRate}`),
      ])
      setSummary(sumRes.data)
      setByMonth(monthRes.data?.by_month || [])
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Не удалось загрузить P&L'
      setError(msg)
      showToast?.({ type: 'error', message: msg })
    } finally {
      setLoading(false)
    }
  }, [queryParams, taxRate])

  useEffect(() => {
    // Custom без обеих дат — не дёргаем
    if (period === 'custom' && (!customFrom || !customTo)) {
      setLoading(false)
      return
    }
    load()
  }, [load, period, customFrom, customTo])

  // ── Renders ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Skeleton height={88} />
        <Skeleton height={300} />
      </div>
    )
  }

  if (error) {
    return <EmptyState title="Ошибка" description={error} />
  }

  if (!summary) {
    return (
      <EmptyState
        title="Нет данных"
        description="Выберите период чтобы загрузить P&L"
      />
    )
  }

  // ── KPI ───────────────────────────────────────────────────────────────
  const grossPct = summary.revenue > 0 ? (summary.gross_margin / summary.revenue) : 0
  const netPct   = summary.revenue > 0 ? (summary.net_income   / summary.revenue) : 0

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* ── Period controls ───────────────────────────────────────────── */}
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {PERIODS.map((p) => (
            <Chip
              key={p.value}
              active={period === p.value}
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </Chip>
          ))}
          {period === 'custom' && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={inputStyle}
              />
              <span style={{ opacity: 0.6 }}>—</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={inputStyle}
              />
            </>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 13, opacity: 0.7 }}>Налог:</label>
            <select
              value={String(taxRate)}
              onChange={(e) => setTaxRate(parseFloat(e.target.value))}
              style={{ ...inputStyle, width: 'auto' }}
            >
              <option value="0.06">УСН Доходы 6%</option>
              <option value="0.10">УСН 10%</option>
              <option value="0.15">УСН Доходы-Расходы 15%</option>
              <option value="0.20">ОСНО 20%</option>
              <option value="0">Без налога</option>
            </select>
            <Button variant="ghost" onClick={load}>Обновить</Button>
          </div>
        </div>
      </Card>

      {/* ── KPI cards ─────────────────────────────────────────────────── */}
      <KpiRow>
        <KpiCard
          title="Выручка"
          value={fmtRub(summary.revenue)}
          hint={`${summary.tenants_count || 0} клиник в сети`}
        />
        <KpiCard
          title="Валовая маржа"
          value={fmtRub(summary.gross_margin)}
          hint={`${fmtPct(grossPct)} от выручки · COGS ${fmtRub(summary.cogs)}`}
        />
        <KpiCard
          title="Налоги"
          value={fmtRub(summary.taxes)}
          hint={`Ставка ${fmtPct(summary.tax_rate)}`}
        />
        <KpiCard
          title="Чистый доход"
          value={fmtRub(summary.net_income)}
          hint={`${fmtPct(netPct)} · комиссия платформы ${fmtRub(summary.platform_fee)}`}
        />
      </KpiRow>

      {/* ── Stub-плашка для COGS ──────────────────────────────────────── */}
      {summary.cogs_source === 'stub' && (
        <Card>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 20 }}>!</span>
            <div>
              <div style={{ fontWeight: 600 }}>Учёт расходов не ведётся</div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>
                COGS показан как 0. Будет учитываться при наличии модуля учёта расходов.
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── Revenue breakdown ─────────────────────────────────────────── */}
      {summary.revenue_breakdown && (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Источники выручки</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <SourceBox label="Записи (оказанные)" value={summary.revenue_breakdown.appointments} />
            <SourceBox label="Онлайн-эквайринг" value={summary.revenue_breakdown.clinic_payments} />
            <SourceBox label="Межклиничные" value={summary.revenue_breakdown.inter_clinic} />
            <SourceBox label="Партнёрские офферы" value={summary.revenue_breakdown.partner_offers} />
          </div>
        </Card>
      )}

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'by_clinic', label: 'По клиникам' },
          { value: 'by_month',  label: 'По месяцам' },
        ]}
      />

      {tab === 'by_clinic' && <ByClinicChart rows={summary.revenue_by_clinic || []} />}
      {tab === 'by_month'  && <ByMonthChart rows={byMonth} />}
    </div>
  )
}


// ── Bar-chart по клиникам (CSS) ───────────────────────────────────────────
function ByClinicChart({ rows }) {
  if (!rows.length) {
    return <EmptyState title="Нет выручки за период" description="" />
  }
  const maxRev = Math.max(...rows.map((r) => r.revenue), 1)
  return (
    <Card>
      <div style={{ display: 'grid', gap: 10 }}>
        {rows.map((r) => (
          <div key={r.tenant_id} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 120px', gap: 12, alignItems: 'center' }}>
            <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.clinic_name || r.tenant_name}
            </div>
            <div style={{ position: 'relative', height: 22, background: 'var(--ks-bg-subtle, #f0f1f3)', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.round((r.revenue / maxRev) * 100)}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #3b82f6, #1d4ed8)',
                  transition: 'width 300ms ease',
                }}
              />
            </div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(r.revenue)}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}


// ── Line-chart по месяцам (SVG) ───────────────────────────────────────────
function ByMonthChart({ rows }) {
  if (!rows.length) {
    return <EmptyState title="Нет данных по месяцам" description="" />
  }
  const W = 760
  const H = 240
  const PAD = 36
  const xs = rows.length
  const maxV = Math.max(...rows.map((r) => Math.max(r.revenue, r.net_income, 0)), 1)
  const sx = (i) => PAD + (i * (W - PAD * 2)) / Math.max(xs - 1, 1)
  const sy = (v) => H - PAD - ((v / maxV) * (H - PAD * 2))

  const lineRev = rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${sx(i)},${sy(r.revenue)}`).join(' ')
  const lineNet = rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${sx(i)},${sy(r.net_income)}`).join(' ')

  return (
    <Card>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: 'transparent' }}>
        {/* axis */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="rgba(0,0,0,0.1)" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="rgba(0,0,0,0.1)" />
        {/* revenue */}
        <path d={lineRev} fill="none" stroke="#3b82f6" strokeWidth={2} />
        {/* net income */}
        <path d={lineNet} fill="none" stroke="#10b981" strokeWidth={2} strokeDasharray="4 4" />
        {rows.map((r, i) => (
          <g key={r.month}>
            <circle cx={sx(i)} cy={sy(r.revenue)} r={3} fill="#3b82f6" />
            <circle cx={sx(i)} cy={sy(r.net_income)} r={3} fill="#10b981" />
            <text x={sx(i)} y={H - PAD + 14} fontSize="10" textAnchor="middle" fill="rgba(0,0,0,0.6)">
              {r.month.slice(5)}
            </text>
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
        <Legend color="#3b82f6" label="Выручка" />
        <Legend color="#10b981" label="Чистый доход" dashed />
      </div>
    </Card>
  )
}


// ── Маленькие подкомпоненты ───────────────────────────────────────────────

function SourceBox({ label, value }) {
  return (
    <div style={{ padding: 10, background: 'var(--ks-bg-subtle, #f6f7f9)', borderRadius: 8 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
      <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtRub(value)}</div>
    </div>
  )
}

function Legend({ color, label, dashed = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <span style={{
        display: 'inline-block', width: 18, height: 0,
        borderBottom: `2px ${dashed ? 'dashed' : 'solid'} ${color}`,
      }} />
      {label}
    </div>
  )
}

const inputStyle = {
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid var(--ks-border, #d4d4d8)',
  borderRadius: 6,
  background: 'var(--ks-bg, white)',
  color: 'inherit',
}
