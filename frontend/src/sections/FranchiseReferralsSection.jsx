/**
 * ========================================
 * БЛОК: FranchiseReferralsSection — «Перелив пациентов»
 * ========================================
 * Heatmap-матрица направлений «from-clinic × to-clinic» с количеством
 * cross-clinic-referrals и суммой по партнёрским офферам.
 *
 * Что показываем:
 *   - Period picker (current_month/last_month/ytd/custom)
 *   - Totals (всего переливов / общая сумма)
 *   - Heatmap: строки = from, колонки = to, ячейка = count + сумма
 *   - Top-5 направлений списком
 *
 * Backend:
 *   GET /franchise-owner/referrals/matrix?period=...
 *   GET /franchise-owner/referrals/top?limit=5&period=...
 * ========================================
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import api from '../api'
import { Card, Button, Chip, EmptyState, Skeleton, useToast } from '../design'


const PERIODS = [
  { value: 'current_month', label: 'Текущий месяц' },
  { value: 'last_month',    label: 'Прошлый месяц' },
  { value: 'ytd',           label: 'С начала года' },
  { value: 'custom',        label: 'Произвольный' },
]

const fmtRub = (v) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })
    .format(Math.round(v || 0))


export default function FranchiseReferralsSection() {
  const { showToast } = useToast?.() || { showToast: () => {} }

  const [period, setPeriod] = useState('current_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const params = useMemo(() => {
    const p = new URLSearchParams()
    p.append('period', period)
    if (period === 'custom' && customFrom) p.append('from', customFrom)
    if (period === 'custom' && customTo) p.append('to', customTo)
    return p.toString()
  }, [period, customFrom, customTo])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get(`/franchise-owner/referrals/matrix?${params}`)
      setData(r.data)
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Не удалось загрузить переливы'
      setError(msg)
      showToast?.({ type: 'error', message: msg })
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => {
    if (period === 'custom' && (!customFrom || !customTo)) {
      setLoading(false)
      return
    }
    load()
  }, [load, period, customFrom, customTo])

  if (loading) return <Skeleton height={400} />
  if (error) return <EmptyState title="Ошибка" description={error} />
  if (!data) return <EmptyState title="Нет данных" description="" />

  const { matrix = [], tenants = [], totals = {} } = data
  const top5 = (totals.top_directions || []).slice(0, 5)
  const maxCount = matrix.reduce((acc, m) => Math.max(acc, m.count || 0), 1)

  // Индекс ячеек: { `${from}|${to}`: row }
  const byPair = {}
  matrix.forEach((m) => {
    byPair[`${m.from_tenant_id}|${m.to_tenant_id}`] = m
  })

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* ── Period controls ─────────────────────────────────────────── */}
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {PERIODS.map((p) => (
            <Chip key={p.value} active={period === p.value} onClick={() => setPeriod(p.value)}>
              {p.label}
            </Chip>
          ))}
          {period === 'custom' && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={inputStyle} />
              <span style={{ opacity: 0.6 }}>—</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={inputStyle} />
            </>
          )}
          <Button variant="ghost" style={{ marginLeft: 'auto' }} onClick={load}>Обновить</Button>
        </div>
      </Card>

      {/* ── Totals ───────────────────────────────────────────────────── */}
      <Card>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Stat label="Всего переливов" value={totals.total_count || 0} />
          <Stat label="Сумма" value={fmtRub(totals.total_amount || 0)} />
          <Stat label="Клиник в сети" value={tenants.length} />
        </div>
      </Card>

      {/* ── Heatmap ──────────────────────────────────────────────────── */}
      {tenants.length === 0 ? (
        <EmptyState title="Нет клиник" description="" />
      ) : (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Матрица направлений</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--ks-bg, white)' }}>
                    От ↓ / К →
                  </th>
                  {tenants.map((t) => (
                    <th key={t.id} style={thStyle}>{t.clinic_name || t.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tenants.map((from) => (
                  <tr key={from.id}>
                    <td style={{ ...tdStyle, fontWeight: 500, position: 'sticky', left: 0, background: 'var(--ks-bg, white)' }}>
                      {from.clinic_name || from.name}
                    </td>
                    {tenants.map((to) => {
                      const cell = byPair[`${from.id}|${to.id}`]
                      const cnt = cell?.count || 0
                      const intensity = cnt / maxCount
                      const bg = cnt > 0
                        ? `rgba(59, 130, 246, ${0.12 + intensity * 0.6})`
                        : (from.id === to.id ? 'var(--ks-bg-subtle, #f6f7f9)' : 'transparent')
                      return (
                        <td
                          key={to.id}
                          title={cell ? `${cnt} переливов · ${fmtRub(cell.total_amount)}` : ''}
                          style={{ ...tdStyle, background: bg, textAlign: 'center', minWidth: 80 }}
                        >
                          {from.id === to.id ? <span style={{ opacity: 0.3 }}>—</span> :
                            cnt > 0 ? (
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>{cnt}</div>
                                <div style={{ fontSize: 10, opacity: 0.7 }}>{fmtRub(cell.total_amount)}</div>
                              </div>
                            ) : <span style={{ opacity: 0.3 }}>·</span>
                          }
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Top-5 directions ─────────────────────────────────────────── */}
      <Card>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Топ-5 направлений</div>
        {top5.length === 0 ? (
          <EmptyState title="Нет переливов" description="" />
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {top5.map((d, idx) => (
              <div
                key={`${d.from_tenant_id}-${d.to_tenant_id}-${idx}`}
                style={{
                  display: 'grid', gridTemplateColumns: '32px 1fr 100px 140px', gap: 10,
                  alignItems: 'center', padding: '8px 10px',
                  background: 'var(--ks-bg-subtle, #f6f7f9)', borderRadius: 6,
                }}
              >
                <div style={{ fontWeight: 600, opacity: 0.6 }}>#{idx + 1}</div>
                <div>
                  <span style={{ fontWeight: 500 }}>{d.from_clinic_name || d.from_tenant_name}</span>
                  <span style={{ margin: '0 6px', opacity: 0.5 }}>→</span>
                  <span style={{ fontWeight: 500 }}>{d.to_clinic_name || d.to_tenant_name}</span>
                </div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.count} перев.</div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtRub(d.total_amount)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}


function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 22 }}>{value}</div>
    </div>
  )
}

const thStyle = {
  padding: '8px 10px', fontSize: 12, fontWeight: 600,
  borderBottom: '1px solid var(--ks-border, #e5e7eb)',
  textAlign: 'center', whiteSpace: 'nowrap',
}
const tdStyle = {
  padding: '8px 10px', fontSize: 13,
  borderBottom: '1px solid var(--ks-border, #e5e7eb)',
}
const inputStyle = {
  padding: '6px 10px', fontSize: 13,
  border: '1px solid var(--ks-border, #d4d4d8)', borderRadius: 6,
  background: 'var(--ks-bg, white)', color: 'inherit',
}
