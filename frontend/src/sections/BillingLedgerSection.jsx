/**
 * BillingLedgerSection — финансовый журнал платформы (только super_admin).
 * Использует:
 *   GET /admin/billing/ledger?days=N  — сводка + разбивка по тенантам
 *   GET /billing/ledger/plans         — ценовые правила (split %)
 */
import { useState, useEffect, useCallback, useContext, createContext } from 'react'
import { API_BASE } from '../config'

// ── Dark mode ─────────────────────────────────────────────────────────────────

const DarkCtx = createContext(false)
const useD = () => useContext(DarkCtx)

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains('dark'))
    )
    obs.observe(document.documentElement, { attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

// ── Палитра ───────────────────────────────────────────────────────────────────

const P = (d) => ({
  bg:          d ? '#0f172a' : '#f8fafc',
  card:        d ? '#1e293b' : '#ffffff',
  cardBorder:  d ? '#334155' : '#f1f5f9',
  text1:       d ? '#f1f5f9' : '#0f172a',
  text2:       d ? '#94a3b8' : '#64748b',
  text3:       d ? '#64748b' : '#94a3b8',
  border:      d ? '#334155' : '#e2e8f0',
  inputBg:     d ? '#1e293b' : '#ffffff',
  inputBorder: d ? '#475569' : '#e2e8f0',
  pillBg:      d ? '#1e293b' : '#f1f5f9',
  pillActive:  d ? '#334155' : '#ffffff',
  subtle:      d ? '#1e293b' : '#f8fafc',
  errBg:       d ? '#450a0a' : '#fff1f2',
  errBorder:   d ? '#7f1d1d' : '#fecdd3',
  errText:     d ? '#fca5a5' : '#be123c',
  success:     d ? '#16a34a' : '#16a34a',
  warn:        d ? '#f59e0b' : '#d97706',
  accent:      '#0ea5e9',
  green:       '#22c55e',
  violet:      '#8b5cf6',
  orange:      '#f97316',
  tableTh:     d ? '#1e293b' : '#f8fafc',
  tableRowAlt: d ? '#1a2435' : '#f9fafb',
})

// ── Утилиты ───────────────────────────────────────────────────────────────────

const rub = (n) => `${Number(n || 0).toLocaleString('ru-RU')} ₽`

async function apiFetch(token, path) {
  const r = await fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err?.detail || `HTTP ${r.status}`)
  }
  return r.json()
}

// ── Скелетон ─────────────────────────────────────────────────────────────────

function SkeletonCard({ p }) {
  return (
    <div style={{
      background: p.card, border: `1px solid ${p.cardBorder}`,
      borderRadius: 16, padding: 24,
      animation: 'pulse 1.5s infinite',
    }}>
      <div style={{ height: 12, width: '60%', background: p.border, borderRadius: 8, marginBottom: 12 }} />
      <div style={{ height: 28, width: '80%', background: p.border, borderRadius: 8, marginBottom: 8 }} />
      <div style={{ height: 10, width: '40%', background: p.border, borderRadius: 8 }} />
    </div>
  )
}

// ── Вкладки ───────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'summary',  label: 'Сводка',       icon: 'dashboard' },
  { key: 'journal',  label: 'Журнал',        icon: 'list_alt' },
  { key: 'tenants',  label: 'По тенантам',   icon: 'business' },
  { key: 'split',    label: 'Revenue Split', icon: 'pie_chart' },
]

function Tabs({ active, onChange, p }) {
  return (
    <div style={{
      display: 'flex', gap: 4, background: p.pillBg,
      borderRadius: 12, padding: 4, marginBottom: 24, flexWrap: 'wrap',
    }}>
      {TABS.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            flex: '1 1 auto',
            display: 'flex', alignItems: 'center', gap: 6,
            justifyContent: 'center',
            padding: '8px 14px',
            borderRadius: 10,
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: active === t.key ? 700 : 400,
            background: active === t.key ? p.pillActive : 'transparent',
            color: active === t.key ? p.text1 : p.text2,
            boxShadow: active === t.key ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
            transition: 'all 0.15s',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ── Период ────────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { value: 7,   label: '7 дней' },
  { value: 30,  label: '30 дней' },
  { value: 90,  label: '90 дней' },
  { value: 180, label: '180 дней' },
  { value: 365, label: '1 год' },
]

function PeriodSelect({ days, onChange, p }) {
  return (
    <select
      value={days}
      onChange={e => onChange(Number(e.target.value))}
      style={{
        background: p.inputBg, border: `1px solid ${p.inputBorder}`,
        borderRadius: 10, padding: '8px 12px', fontSize: 13,
        color: p.text1, cursor: 'pointer', outline: 'none',
      }}
    >
      {PERIOD_OPTIONS.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// ── Карточка метрики ─────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color, icon, p }) {
  return (
    <div style={{
      background: p.card, border: `1px solid ${p.cardBorder}`,
      borderRadius: 16, padding: '20px 24px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 18, color: color, fontVariationSettings: "'FILL' 1" }}
        >
          {icon}
        </span>
        <span style={{ fontSize: 13, color: p.text2, fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: p.text3 }}>{sub}</div>}
    </div>
  )
}

// ── Сводка ────────────────────────────────────────────────────────────────────

// Типы записей → читаемые названия
const ENTRY_LABELS = {
  subscription_charge:  'Подписки (списание)',
  subscription_credit:  'Подписки (кредит)',
  subscription_trial:   'Пробный период',
  plugin_charge:        'Плагины (включение)',
  plugin_renewal:       'Плагины (продление)',
  plugin_refund:        'Плагины (возврат)',
  ad_charge:            'Реклама (flat)',
  ad_click_income:      'Реклама (CPC)',
  ad_impression_income: 'Реклама (CPM)',
  platform_income:      'Доход платформы',
  tenant_income:        'Доход тенантов',
  franchise_fee:        'Franchise fee',
  payment_received:     'Платёж получен',
  refund:               'Возврат',
  manual_adjustment:    'Ручная корректировка',
}

// Простой SVG-тренд
function TrendChart({ data, color, p }) {
  if (!data || data.length < 2) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center', color: p.text3, fontSize: 13 }}>
        Недостаточно данных для графика
      </div>
    )
  }

  const W = 500
  const H = 120
  const PAD = 16

  const vals = data.map(d => d.value)
  const max = Math.max(...vals, 1)
  const min = Math.min(...vals, 0)
  const range = max - min || 1

  const pts = data.map((d, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - PAD * 2)
    const y = H - PAD - ((d.value - min) / range) * (H - PAD * 2)
    return [x, y]
  })

  const polyline = pts.map(([x, y]) => `${x},${y}`).join(' ')
  const area = `M${pts[0][0]},${H} ` +
    pts.map(([x, y]) => `L${x},${y}`).join(' ') +
    ` L${pts[pts.length - 1][0]},${H} Z`

  // Метки оси X — показываем первую и последнюю
  const labelFirst = data[0]?.label || ''
  const labelLast  = data[data.length - 1]?.label || ''

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H + 24}`} width="100%" style={{ display: 'block', minWidth: 280 }}>
        <defs>
          <linearGradient id="blg-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#blg-area)" />
        <polyline points={polyline} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* Точки */}
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3.5" fill={color} />
        ))}
        {/* Метки оси X */}
        <text x={PAD} y={H + 20} fontSize="10" fill={p.text3}>{labelFirst}</text>
        <text x={W - PAD} y={H + 20} fontSize="10" fill={p.text3} textAnchor="end">{labelLast}</text>
      </svg>
    </div>
  )
}

function SummaryTab({ summary, loading, p }) {
  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {[1,2,3,4].map(i => <SkeletonCard key={i} p={p} />)}
      </div>
    )
  }
  if (!summary) return null

  const s = summary.summary || summary

  const totalCredit    = s.total_credit || 0
  const platformIncome = s.platform_income || 0
  const net            = s.net || 0
  const periodDays     = summary.period_days || s.period_days || 30

  // Считаем доход тенантов и franchise fee из breakdown
  const bd = s.breakdown || {}
  const tenantIncome = bd['tenant_income_credit']?.amount || 0
  const franchiseFee = bd['franchise_fee_debit']?.amount || 0

  // Строим тренд-данные из breakdown (группируем по типам в одну точку — имитация)
  const trendData = Object.entries(bd)
    .filter(([k]) => k.endsWith('_credit'))
    .map(([k, v]) => ({
      label: ENTRY_LABELS[k.replace('_credit', '')] || k,
      value: v.amount || 0,
    }))
    .sort((a, b) => b.value - a.value)

  const metrics = [
    {
      label: 'Общая выручка',
      value: rub(totalCredit),
      sub: `за ${periodDays} дней`,
      color: p.accent,
      icon: 'account_balance',
    },
    {
      label: 'Доход платформы',
      value: rub(platformIncome),
      sub: totalCredit > 0 ? `${((platformIncome / totalCredit) * 100).toFixed(1)}% от выручки` : '—',
      color: p.green,
      icon: 'trending_up',
    },
    {
      label: 'Доход тенантов',
      value: rub(tenantIncome),
      sub: totalCredit > 0 ? `${((tenantIncome / totalCredit) * 100).toFixed(1)}% от выручки` : '—',
      color: p.violet,
      icon: 'store',
    },
    {
      label: 'Franchise fees',
      value: rub(franchiseFee),
      sub: franchiseFee > 0 ? `${((franchiseFee / totalCredit) * 100).toFixed(1)}% от выручки` : 'нет данных',
      color: p.orange,
      icon: 'hub',
    },
  ]

  // Breakdown таблица
  const bdRows = Object.entries(bd)
    .filter(([k]) => k.endsWith('_credit') || k.endsWith('_debit'))
    .map(([k, v]) => {
      const isCredit = k.endsWith('_credit')
      const typeKey = k.replace(/_credit$|_debit$/, '')
      return {
        label: ENTRY_LABELS[typeKey] || typeKey,
        direction: isCredit ? 'credit' : 'debit',
        amount: v.amount || 0,
        count: v.count || 0,
      }
    })
    .sort((a, b) => b.amount - a.amount)

  return (
    <div>
      {/* Карточки метрик */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 16, marginBottom: 32,
      }}>
        {metrics.map(m => <MetricCard key={m.label} {...m} p={p} />)}
      </div>

      {/* График тренда — визуализация breakdown */}
      <div style={{
        background: p.card, border: `1px solid ${p.cardBorder}`,
        borderRadius: 16, padding: 24, marginBottom: 24,
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: p.text1, marginBottom: 16 }}>
          Структура доходов (кредиты за период)
        </div>
        <TrendChart data={trendData} color={p.accent} p={p} />
      </div>

      {/* Breakdown по типам операций */}
      <div style={{
        background: p.card, border: `1px solid ${p.cardBorder}`,
        borderRadius: 16, padding: 24,
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: p.text1, marginBottom: 16 }}>
          Разбивка по типам операций
        </div>
        {bdRows.length === 0 ? (
          <div style={{ color: p.text3, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
            Нет данных за выбранный период
          </div>
        ) : (
          <div className="admin-resp-table-wrap" style={{ overflowX: 'auto' }}>
            <table className="admin-resp-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: p.tableTh }}>
                  {['Тип операции', 'Направление', 'Сумма', 'Кол-во'].map(h => (
                    <th key={h} style={{
                      padding: '10px 14px', textAlign: 'left',
                      color: p.text2, fontWeight: 600, whiteSpace: 'nowrap',
                      borderBottom: `1px solid ${p.border}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bdRows.map((row, i) => (
                  <tr key={i} style={{ background: i % 2 === 1 ? p.tableRowAlt : 'transparent' }}>
                    <td data-label="Тип операции" style={{ padding: '10px 14px', color: p.text1, borderBottom: `1px solid ${p.border}` }}>
                      {row.label}
                    </td>
                    <td data-label="Направление" style={{ padding: '10px 14px', borderBottom: `1px solid ${p.border}` }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                        background: row.direction === 'credit' ? '#d1fae5' : '#fee2e2',
                        color: row.direction === 'credit' ? '#065f46' : '#991b1b',
                      }}>
                        {row.direction === 'credit' ? 'Кредит' : 'Дебет'}
                      </span>
                    </td>
                    <td data-label="Сумма" style={{
                      padding: '10px 14px', color: row.direction === 'credit' ? p.green : p.errText,
                      fontWeight: 600, borderBottom: `1px solid ${p.border}`,
                    }}>
                      {rub(row.amount)}
                    </td>
                    <td data-label="Кол-во" style={{ padding: '10px 14px', color: p.text2, borderBottom: `1px solid ${p.border}` }}>
                      {row.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* Разбивка по модулям */}
      {summary && summary.module_breakdown && summary.module_breakdown.length > 0 && (
        <div style={{
          background: p.card, border: `1px solid ${p.cardBorder}`,
          borderRadius: 16, padding: 24, marginTop: 16,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: p.text1, marginBottom: 16 }}>
            Разбивка по модулям
          </div>
          <div className="admin-resp-table-wrap" style={{ overflowX: 'auto' }}>
            <table className="admin-resp-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: p.tableTh }}>
                  {['Модуль', 'Категория', 'Тип', 'Направление', 'Сумма'].map(h => (
                    <th key={h} style={{
                      padding: '10px 14px', textAlign: 'left',
                      color: p.text2, fontWeight: 600, whiteSpace: 'nowrap',
                      borderBottom: `1px solid ${p.border}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.module_breakdown.map((row, i) => (
                  <tr key={i} style={{ background: i % 2 === 1 ? p.tableRowAlt : 'transparent' }}>
                    <td data-label="Модуль" style={{ padding: '10px 14px', color: p.text1, fontWeight: 600, borderBottom: `1px solid ${p.border}` }}>
                      {row.module_name}
                    </td>
                    <td data-label="Категория" style={{ padding: '10px 14px', borderBottom: `1px solid ${p.border}` }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 20, fontSize: 11,
                        background: p.pillBg, color: p.text2, fontWeight: 600,
                      }}>
                        {row.category === 'telephony' ? 'Телефония' :
                         row.category === 'ai' ? 'AI' :
                         row.category === 'advertising' ? 'Реклама' : row.category}
                      </span>
                    </td>
                    <td data-label="Тип" style={{ padding: '10px 14px', color: p.text2, borderBottom: `1px solid ${p.border}` }}>
                      {ENTRY_LABELS[row.entry_type] || row.entry_type}
                    </td>
                    <td data-label="Направление" style={{ padding: '10px 14px', borderBottom: `1px solid ${p.border}` }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                        background: row.direction === 'credit' ? '#d1fae5' : '#fee2e2',
                        color: row.direction === 'credit' ? '#065f46' : '#991b1b',
                      }}>
                        {row.direction === 'credit' ? 'Кредит' : 'Дебет'}
                      </span>
                    </td>
                    <td data-label="Сумма" style={{
                      padding: '10px 14px',
                      color: row.direction === 'credit' ? p.green : '#ef4444',
                      fontWeight: 700, borderBottom: `1px solid ${p.border}`,
                    }}>
                      {row.entry_type === 'subscription_trial' ? 'Пробный' : rub(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Журнал ────────────────────────────────────────────────────────────────────

function JournalTab({ token, days, p }) {
  const [typeFilter, setTypeFilter] = useState('')
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const LIMIT = 50

  const load = useCallback(async (off = 0) => {
    setLoading(true)
    setError('')
    try {
      let url = `/admin/billing/ledger/entries?days=${days}&limit=${LIMIT}&offset=${off}`
      if (typeFilter) url += `&entry_type=${typeFilter}`
      const d = await apiFetch(token, url)
      setEntries(d.items || [])
      setTotal(d.total || 0)
      setOffset(off)
    } catch (e) {
      setError(e.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [token, days, typeFilter])

  useEffect(() => { load(0) }, [load])

  const typeOptions = [
    'subscription_charge','subscription_trial','plugin_charge','plugin_renewal',
    'ad_charge','ad_click_income','ad_impression_income','payment_received',
  ]

  const fmtDate = iso => {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div style={{ background: p.card, border: `1px solid ${p.cardBorder}`, borderRadius: 16, padding: 24 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: p.text1, flex: 1 }}>
          {'Журнал операций за ' + days + ' дней · ' + total + ' записей'}
        </div>
        <select
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value) }}
          style={{
            background: p.inputBg, border: `1px solid ${p.inputBorder}`,
            borderRadius: 10, padding: '8px 12px', fontSize: 13, color: p.text1, outline: 'none',
          }}
        >
          <option value="">Все типы</option>
          {typeOptions.map(t => (
            <option key={t} value={t}>{ENTRY_LABELS[t] || t}</option>
          ))}
        </select>
      </div>

      {error && (
        <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: p.text3, textAlign: 'center', padding: '32px 0', fontSize: 13 }}>Загрузка...</div>
      ) : entries.length === 0 ? (
        <div style={{ color: p.text3, textAlign: 'center', padding: '32px 0', fontSize: 13 }}>
          Нет записей за период · включите модули или выставьте счёт для появления данных
        </div>
      ) : (
        <div className="admin-resp-table-wrap" style={{ overflowX: 'auto' }}>
          <table className="admin-resp-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: p.tableTh }}>
                {['Дата', 'Тип', 'Описание', 'Направление', 'Сумма'].map(h => (
                  <th key={h} style={{
                    padding: '10px 14px', textAlign: 'left', color: p.text2, fontWeight: 600,
                    borderBottom: `1px solid ${p.border}`, whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((row, i) => (
                <tr key={row.id} style={{ background: i % 2 === 1 ? p.tableRowAlt : 'transparent' }}>
                  <td data-label="Дата" style={{ padding: '9px 14px', color: p.text3, borderBottom: `1px solid ${p.border}`, whiteSpace: 'nowrap' }}>
                    {fmtDate(row.created_at)}
                  </td>
                  <td data-label="Тип" style={{ padding: '9px 14px', borderBottom: `1px solid ${p.border}` }}>
                    <span style={{
                      background: p.pillBg, color: p.text2,
                      padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    }}>
                      {ENTRY_LABELS[row.entry_type] || row.entry_type}
                    </span>
                  </td>
                  <td data-label="Описание" style={{ padding: '9px 14px', color: p.text1, borderBottom: `1px solid ${p.border}`, maxWidth: 260 }}>
                    {row.description || '—'}
                  </td>
                  <td data-label="Направление" style={{ padding: '9px 14px', borderBottom: `1px solid ${p.border}` }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      background: row.direction === 'credit' ? '#d1fae5' : '#fee2e2',
                      color: row.direction === 'credit' ? '#065f46' : '#991b1b',
                    }}>
                      {row.direction === 'credit' ? '↑ Кредит' : '↓ Дебет'}
                    </span>
                  </td>
                  <td data-label="Сумма" style={{
                    padding: '9px 14px', fontWeight: 700,
                    color: row.direction === 'credit' ? p.green : '#ef4444',
                    borderBottom: `1px solid ${p.border}`,
                  }}>
                    {row.direction === 'credit' ? '+' : '-'}{rub(row.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > LIMIT && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button
            onClick={() => load(Math.max(0, offset - LIMIT))}
            disabled={offset === 0}
            style={{ padding: '6px 16px', borderRadius: 8, border: `1px solid ${p.border}`, background: p.card, color: p.text1, cursor: offset === 0 ? 'not-allowed' : 'pointer', opacity: offset === 0 ? 0.4 : 1 }}
          >{'← Назад'}</button>
          <span style={{ fontSize: 12, color: p.text2, alignSelf: 'center' }}>
            {offset + 1}&ndash;{Math.min(offset + LIMIT, total)} из {total}
          </span>
          <button
            onClick={() => load(offset + LIMIT)}
            disabled={offset + LIMIT >= total}
            style={{ padding: '6px 16px', borderRadius: 8, border: `1px solid ${p.border}`, background: p.card, color: p.text1, cursor: offset + LIMIT >= total ? 'not-allowed' : 'pointer', opacity: offset + LIMIT >= total ? 0.4 : 1 }}
          >{'Вперёд →'}</button>
        </div>
      )}
    </div>
  )
}
// ── По тенантам ───────────────────────────────────────────────────────────────

function TenantsTab({ data, p }) {
  const [sortBy, setSortBy] = useState('total_credit')

  if (!data) return null

  const tenants = [...(data.tenants || [])]
    .sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0))

  if (tenants.length === 0) {
    return (
      <div style={{
        background: p.card, border: `1px solid ${p.cardBorder}`,
        borderRadius: 16, padding: 48, textAlign: 'center', color: p.text3, fontSize: 14,
      }}>
        Нет данных по тенантам за выбранный период
      </div>
    )
  }

  const maxCredit = Math.max(...tenants.map(t => t.total_credit || 0), 1)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16, gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: p.text2 }}>Сортировка:</span>
        {[
          { key: 'total_credit', label: 'Выручка' },
          { key: 'platform_income', label: 'Доход платформы' },
        ].map(opt => (
          <button
            key={opt.key}
            onClick={() => setSortBy(opt.key)}
            style={{
              padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: sortBy === opt.key ? 700 : 400,
              background: sortBy === opt.key ? p.accent : p.pillBg,
              color: sortBy === opt.key ? '#fff' : p.text2,
            }}
          >{opt.label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tenants.map((t, i) => {
          const creditPct = maxCredit > 0 ? ((t.total_credit || 0) / maxCredit) * 100 : 0
          return (
            <div key={t.tenant_id} style={{
              background: p.card, border: `1px solid ${p.cardBorder}`,
              borderRadius: 14, padding: '16px 20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: `hsl(${(i * 47) % 360}, 60%, 50%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0,
                }}>
                  {(t.tenant_name || '?').charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: p.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.tenant_name || t.slug || 'Неизвестный тенант'}
                  </div>
                  <div style={{ fontSize: 11, color: p.text3 }}>{t.slug}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: p.green }}>{rub(t.total_credit)}</div>
                  <div style={{ fontSize: 11, color: p.text3 }}>платформа: {rub(t.platform_income)}</div>
                </div>
              </div>

              {/* Прогресс-бар */}
              <div style={{ height: 6, background: p.border, borderRadius: 99, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${creditPct}%`, borderRadius: 99,
                  background: `hsl(${(i * 47) % 360}, 60%, 50%)`,
                  transition: 'width 0.4s',
                }} />
              </div>

              {/* Мини-breakdown */}
              {t.breakdown && Object.keys(t.breakdown).length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {Object.entries(t.breakdown)
                    .filter(([k, v]) => v > 0)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 4)
                    .map(([k, v]) => {
                      const typeKey = k.replace(/_credit$|_debit$/, '')
                      return (
                        <span key={k} style={{
                          padding: '2px 8px', borderRadius: 20, fontSize: 11,
                          background: p.pillBg, color: p.text2,
                        }}>
                          {ENTRY_LABELS[typeKey] || typeKey}: {rub(v)}
                        </span>
                      )
                    })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Revenue Split ─────────────────────────────────────────────────────────────

function RevenueSplitTab({ data, plans, p }) {
  if (!data) return null

  const s = data.summary || {}
  const bd = s.breakdown || {}

  const platformIncome = s.platform_income || 0
  const tenantIncome   = bd['tenant_income_credit']?.amount || 0
  const franchiseFee   = bd['franchise_fee_debit']?.amount || 0
  const total = platformIncome + tenantIncome + franchiseFee

  const segments = [
    { label: 'Доход платформы', value: platformIncome, color: p.accent },
    { label: 'Доход тенантов',  value: tenantIncome,   color: p.green },
    { label: 'Franchise fees',  value: franchiseFee,   color: p.orange },
  ].filter(s => s.value > 0)

  // SVG доnut-диаграмма
  const R = 60, CX = 80, CY = 80
  let angle = -Math.PI / 2
  const paths = segments.map(seg => {
    const pct = total > 0 ? seg.value / total : 0
    const da = pct * 2 * Math.PI
    const x1 = CX + R * Math.cos(angle)
    const y1 = CY + R * Math.sin(angle)
    const x2 = CX + R * Math.cos(angle + da)
    const y2 = CY + R * Math.sin(angle + da)
    const large = da > Math.PI ? 1 : 0
    const d = `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`
    const midAngle = angle + da / 2
    angle += da
    return { ...seg, d, pct: (pct * 100).toFixed(1), midAngle }
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* Donut */}
        <div style={{
          background: p.card, border: `1px solid ${p.cardBorder}`,
          borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column',
          alignItems: 'center', minWidth: 220, flex: '0 0 auto',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: p.text1, marginBottom: 16 }}>
            Revenue Split
          </div>
          <svg viewBox="0 0 160 160" width={160} height={160}>
            {total === 0 ? (
              <circle cx={CX} cy={CY} r={R} fill={p.border} />
            ) : (
              paths.map((seg, i) => (
                <path key={i} d={seg.d} fill={seg.color} />
              ))
            )}
            {/* Центр */}
            <circle cx={CX} cy={CY} r={36} fill={p.card} />
            <text x={CX} y={CY - 6} textAnchor="middle" fontSize="11" fill={p.text2}>всего</text>
            <text x={CX} y={CY + 10} textAnchor="middle" fontSize="10" fontWeight="700" fill={p.text1}>
              {rub(total)}
            </text>
          </svg>

          {/* Легенда */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginTop: 8 }}>
            {segments.map((seg, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: seg.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: p.text2, flex: 1 }}>{seg.label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: p.text1 }}>
                  {total > 0 ? `${((seg.value / total) * 100).toFixed(1)}%` : '0%'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Детали */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {segments.map((seg, i) => (
            <div key={i} style={{
              background: p.card, border: `1px solid ${p.cardBorder}`,
              borderRadius: 14, padding: '16px 20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: seg.color }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: p.text1 }}>{seg.label}</span>
                <span style={{
                  marginLeft: 'auto', fontSize: 18, fontWeight: 700, color: seg.color,
                }}>
                  {rub(seg.value)}
                </span>
              </div>
              <div style={{ height: 8, background: p.border, borderRadius: 99, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: total > 0 ? `${(seg.value / total) * 100}%` : '0%',
                  background: seg.color,
                  borderRadius: 99,
                  transition: 'width 0.5s',
                }} />
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: p.text3 }}>
                {total > 0 ? `${((seg.value / total) * 100).toFixed(2)}% от общей суммы` : 'Нет данных'}
              </div>
            </div>
          ))}

          {/* Ценовые правила */}
          {plans && (
            <div style={{
              background: p.card, border: `1px solid ${p.cardBorder}`,
              borderRadius: 14, padding: '16px 20px',
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: p.text1, marginBottom: 12 }}>
                Ценовые правила (split %)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                {[
                  { label: 'Плагины → платформа', value: plans.plugin_split_percent, suffix: '%' },
                  { label: 'Реклама → платформа', value: plans.ad_split_percent, suffix: '%' },
                  { label: 'Franchise fee',        value: plans.franchise_fee_percent, suffix: '%' },
                  { label: 'Скидка подписки',      value: plans.subscription_discount_percent, suffix: '%' },
                ].map(r => (
                  <div key={r.label} style={{
                    background: p.subtle, borderRadius: 10, padding: '10px 14px',
                  }}>
                    <div style={{ fontSize: 11, color: p.text3, marginBottom: 4 }}>{r.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: p.text1 }}>
                      {Number(r.value || 0).toFixed(1)}{r.suffix}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Главный компонент ─────────────────────────────────────────────────────────

export default function BillingLedgerSection({ token }) {
  const dark = useIsDark()
  const p = P(dark)

  const [tab, setTab] = useState('summary')
  const [days, setDays] = useState(30)

  const [data, setData]   = useState(null)
  const [plans, setPlans] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Основной запрос к admin эндпоинту (возвращает summary + tenants)
      const [ledger, plansData] = await Promise.all([
        apiFetch(token, `/admin/billing/ledger?days=${days}`),
        apiFetch(token, `/billing/ledger/plans`).catch(() => null),
      ])
      setData(ledger)
      setPlans(plansData)
    } catch (e) {
      setError(e.message || 'Ошибка загрузки данных')
    } finally {
      setLoading(false)
    }
  }, [token, days])

  useEffect(() => { load() }, [load])

  const s = data?.summary || {}

  return (
    <DarkCtx.Provider value={dark}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      <div style={{ padding: '24px 16px', maxWidth: 1100, margin: '0 auto' }}>
        {/* Шапка */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 28, color: p.accent, fontVariationSettings: "'FILL' 1" }}
          >
            account_balance
          </span>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: p.text1, margin: 0 }}>
              Финансовый журнал
            </h1>
            <p style={{ fontSize: 13, color: p.text2, margin: '2px 0 0' }}>
              Биллинговый реестр платформы (append-only) · только super_admin
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PeriodSelect days={days} onChange={d => setDays(d)} p={p} />
            <button
              onClick={load}
              disabled={loading}
              style={{
                background: p.accent, color: '#fff',
                border: 'none', borderRadius: 10, padding: '8px 16px',
                fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
              Обновить
            </button>
          </div>
        </div>

        {/* Ошибка */}
        {error && (
          <div style={{
            background: p.errBg, border: `1px solid ${p.errBorder}`,
            borderRadius: 12, padding: '12px 16px', marginBottom: 20,
            color: p.errText, fontSize: 13,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14, marginRight: 6, verticalAlign: 'middle' }}>error</span>
            {error}
          </div>
        )}

        {/* Быстрые итоги */}
        {data && !loading && (
          <div style={{
            background: p.card, border: `1px solid ${p.cardBorder}`,
            borderRadius: 14, padding: '14px 20px', marginBottom: 20,
            display: 'flex', gap: 24, flexWrap: 'wrap',
          }}>
            {[
              { label: 'Выручка', value: rub(s.total_credit), color: p.accent },
              { label: 'Платформа', value: rub(s.platform_income), color: p.green },
              { label: 'Дебет', value: rub(s.total_debit), color: '#ef4444' },
              { label: 'Нетто', value: rub(s.net), color: (s.net || 0) >= 0 ? p.green : '#ef4444' },
              { label: 'Период', value: `${data.period_days || days} дн.`, color: p.text2 },
              { label: 'Тенантов', value: (data.tenants || []).length, color: p.violet },
            ].map(m => (
              <div key={m.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 11, color: p.text3 }}>{m.label}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: m.color }}>{m.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Вкладки */}
        <Tabs active={tab} onChange={setTab} p={p} />

        {/* Контент вкладки */}
        {tab === 'summary' && (
          <SummaryTab summary={data} loading={loading} p={p} />
        )}
        {tab === 'journal' && (
          loading ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: p.text3 }}>
              <div style={{ width: 32, height: 32, border: `3px solid ${p.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
              Загрузка...
            </div>
          ) : (
            <JournalTab token={token} days={days} p={p} />
          )
        )}
        {tab === 'tenants' && (
          loading ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: p.text3 }}>Загрузка...</div>
          ) : (
            <TenantsTab data={data} p={p} />
          )
        )}
        {tab === 'split' && (
          loading ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: p.text3 }}>Загрузка...</div>
          ) : (
            <RevenueSplitTab data={data} plans={plans} p={p} />
          )
        )}
      </div>
    </DarkCtx.Provider>
  )
}
