/**
 * ========================================
 * БЛОК: AccReports — P&L и Cash flow (бухгалтер)
 * ========================================
 * Два блока:
 *   1) P&L  — GET /accountant/reports/pnl?date_from&date_to
 *   2) CF   — GET /accountant/reports/cashflow?date_from&date_to&granularity
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import { Card } from '../../design'
import AccountantShell from '../_AccountantShell'
import api from '../../api'

// ===== БЛОК: utils =====
function fmtMoney(v) {
  const n = Number(v || 0)
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽'
}
function todayISO() { return new Date().toISOString().slice(0, 10) }
function daysAgoISO(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
function fmtDate(s) {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch { return s }
}

// ===== БЛОК: компонент =====
export default function AccReports() {
  const [preset, setPreset] = useState('30') // 7 | 30 | 90 | custom
  const [dateFrom, setDateFrom] = useState(daysAgoISO(30))
  const [dateTo, setDateTo] = useState(todayISO())
  const [granularity, setGranularity] = useState('day') // day | week | month

  useEffect(() => {
    if (preset === '7') { setDateFrom(daysAgoISO(7)); setDateTo(todayISO()) }
    else if (preset === '30') { setDateFrom(daysAgoISO(30)); setDateTo(todayISO()) }
    else if (preset === '90') { setDateFrom(daysAgoISO(90)); setDateTo(todayISO()) }
  }, [preset])

  return (
    <AccountantShell active="reports">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ color: 'var(--fg)', fontWeight: 700, fontSize: 22, margin: 0 }}>
          Отчёты: P&L и Cash flow
        </h2>

        {/* Период / гранулярность */}
        <Card>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <Field label="Период">
              <select value={preset} onChange={e => setPreset(e.target.value)} style={inputStyle}>
                <option value="7">Последние 7 дней</option>
                <option value="30">Последние 30 дней</option>
                <option value="90">Последние 90 дней</option>
                <option value="custom">Кастомный</option>
              </select>
            </Field>
            <Field label="С">
              <input
                type="date" value={dateFrom}
                disabled={preset !== 'custom'}
                onChange={e => setDateFrom(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="По">
              <input
                type="date" value={dateTo}
                disabled={preset !== 'custom'}
                onChange={e => setDateTo(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Шаг (cash flow)">
              <select value={granularity} onChange={e => setGranularity(e.target.value)} style={inputStyle}>
                <option value="day">День</option>
                <option value="week">Неделя</option>
                <option value="month">Месяц</option>
              </select>
            </Field>
          </div>
        </Card>

        <PnLBlock dateFrom={dateFrom} dateTo={dateTo} />
        <CashFlowBlock dateFrom={dateFrom} dateTo={dateTo} granularity={granularity} />
      </div>
    </AccountantShell>
  )
}

// ===== БЛОК: P&L =====
function PnLBlock({ dateFrom, dateTo }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const { data } = await api.get('/accountant/reports/pnl', {
        params: { date_from: dateFrom, date_to: dateTo },
      })
      setData(data)
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Ошибка загрузки')
      setData(null)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [dateFrom, dateTo])

  const net = Number(data?.net ?? 0)
  const onlineCard = Number(data?.income_online_card ?? data?.online_card ?? 0)
  const cashIn = Number(data?.cash_in ?? data?.income_cash ?? 0)
  const cashOut = Number(data?.cash_out ?? data?.expense_cash ?? 0)
  const payroll = Number(data?.payroll_paid ?? data?.payroll ?? 0)
  const otherSpend = Number(data?.spending ?? data?.other_expenses ?? 0)

  return (
    <Card>
      <h3 style={{ color: 'var(--fg)', fontWeight: 700, fontSize: 16, margin: '0 0 14px' }}>
        Прибыль и убытки (P&L)
      </h3>
      {error && <div style={{ color: 'var(--bad)' }}>{error}</div>}
      {loading ? (
        <div style={{ color: 'var(--fg-2)' }}>Загрузка…</div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
          }}>
            <KpiBox label="Онлайн-оплаты" value={fmtMoney(onlineCard)} color="var(--good)" />
            <KpiBox label="Касса: приход" value={fmtMoney(cashIn)} color="var(--good)" />
            <KpiBox label="Касса: расход" value={fmtMoney(cashOut)} color="var(--bad)" />
            <KpiBox label="Зарплата выплачено" value={fmtMoney(payroll)} color="var(--bad)" />
            <KpiBox label="Прочие расходы" value={fmtMoney(otherSpend)} color="var(--bad)" />
          </div>
          <div style={{
            marginTop: 18,
            padding: 18,
            borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 8,
          }}>
            <span style={{ color: 'var(--fg-2)', fontSize: 14 }}>Чистый итог (net)</span>
            <span style={{
              fontSize: 28,
              fontWeight: 800,
              color: net > 0 ? 'var(--good)' : net < 0 ? 'var(--bad)' : 'var(--fg)',
            }}>
              {fmtMoney(net)}
            </span>
          </div>
        </>
      )}
    </Card>
  )
}

function KpiBox({ label, value, color }) {
  return (
    <div style={{
      background: 'var(--bg-2)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 14,
    }}>
      <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || 'var(--fg)' }}>{value}</div>
    </div>
  )
}

// ===== БЛОК: Cash flow =====
function CashFlowBlock({ dateFrom, dateTo, granularity }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const { data } = await api.get('/accountant/reports/cashflow', {
        params: { date_from: dateFrom, date_to: dateTo, granularity },
      })
      const list = Array.isArray(data) ? data : (data?.items || [])
      setRows(list)
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Ошибка загрузки')
      setRows([])
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [dateFrom, dateTo, granularity])

  // Максимум для нормирования мини-баров
  const maxAbs = useMemo(() => {
    let m = 0
    rows.forEach(r => {
      m = Math.max(m, Math.abs(Number(r.inflow || 0)), Math.abs(Number(r.outflow || 0)))
    })
    return m || 1
  }, [rows])

  const totals = useMemo(() => {
    let inflow = 0, outflow = 0
    rows.forEach(r => {
      inflow += Number(r.inflow || 0)
      outflow += Number(r.outflow || 0)
    })
    return { inflow, outflow, net: inflow - outflow }
  }, [rows])

  return (
    <Card>
      <h3 style={{ color: 'var(--fg)', fontWeight: 700, fontSize: 16, margin: '0 0 14px' }}>
        Cash flow (движение денег)
      </h3>
      {error && <div style={{ color: 'var(--bad)' }}>{error}</div>}
      {loading ? (
        <div style={{ color: 'var(--fg-2)' }}>Загрузка…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--fg-2)' }}>Нет данных за период.</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rows.map((r, i) => {
              const inflow = Number(r.inflow || 0)
              const outflow = Number(r.outflow || 0)
              const net = Number(r.net != null ? r.net : (inflow - outflow))
              const inflowPct = (inflow / maxAbs) * 100
              const outflowPct = (outflow / maxAbs) * 100
              return (
                <div key={i} style={{
                  display: 'grid',
                  gridTemplateColumns: '100px 1fr 1fr 100px',
                  gap: 10,
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 13,
                }}>
                  <div style={{ color: 'var(--fg-2)' }}>{fmtDate(r.date || r.period)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 14, background: 'var(--bg-2)', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{
                        width: `${inflowPct}%`, height: '100%', background: 'var(--good)',
                      }} />
                    </div>
                    <span style={{ width: 90, textAlign: 'right', color: 'var(--good)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMoney(inflow)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 14, background: 'var(--bg-2)', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{
                        width: `${outflowPct}%`, height: '100%', background: 'var(--bad)',
                      }} />
                    </div>
                    <span style={{ width: 90, textAlign: 'right', color: 'var(--bad)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMoney(outflow)}
                    </span>
                  </div>
                  <div style={{
                    textAlign: 'right',
                    fontWeight: 700,
                    color: net >= 0 ? 'var(--good)' : 'var(--bad)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {fmtMoney(net)}
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{
            marginTop: 12,
            padding: '10px 12px',
            background: 'var(--bg-2)',
            borderRadius: 10,
            display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between',
            fontSize: 13,
          }}>
            <span>Приход: <b style={{ color: 'var(--good)' }}>{fmtMoney(totals.inflow)}</b></span>
            <span>Расход: <b style={{ color: 'var(--bad)' }}>{fmtMoney(totals.outflow)}</b></span>
            <span>Итого net: <b style={{ color: totals.net >= 0 ? 'var(--good)' : 'var(--bad)' }}>
              {fmtMoney(totals.net)}
            </b></span>
          </div>
        </>
      )}
    </Card>
  )
}

// ===== БЛОК: общие стили =====
const inputStyle = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-2)',
  color: 'var(--fg)',
  fontSize: 13,
  minWidth: 160,
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{label}</span>
      {children}
    </label>
  )
}
