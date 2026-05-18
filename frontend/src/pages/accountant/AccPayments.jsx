/**
 * ========================================
 * БЛОК: AccPayments — реестр платежей пациентов (бухгалтер)
 * ========================================
 * Список платежей с фильтрацией по периоду и статусу.
 * Источник: GET /accountant/payments
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import { Card, Chip, EmptyState } from '../../design'
import AccountantShell from '../_AccountantShell'
import api from '../../api'

// ===== БЛОК: utils =====
function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
function firstOfMonthISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function fmtMoney(v) {
  const n = Number(v || 0)
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽'
}
function fmtDateTime(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return d.toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return s }
}

const STATUS_LABELS = {
  succeeded: 'Оплачен',
  refunded: 'Возврат',
  cancelled: 'Отменён',
  pending: 'В ожидании',
  failed: 'Ошибка',
}
const STATUS_VARIANT = {
  succeeded: 'good',
  refunded: 'default',
  cancelled: 'bad',
  pending: 'warn',
  failed: 'bad',
}

// ===== БЛОК: основной компонент =====
export default function AccPayments() {
  const [dateFrom, setDateFrom] = useState(firstOfMonthISO())
  const [dateTo, setDateTo] = useState(todayISO())
  const [status, setStatus] = useState('') // '' = все
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const params = { date_from: dateFrom, date_to: dateTo }
      if (status) params.status = status
      const { data } = await api.get('/accountant/payments', { params })
      const list = Array.isArray(data) ? data : (data?.items || [])
      setItems(list)
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Ошибка загрузки')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [dateFrom, dateTo, status])

  const totalSucceeded = useMemo(() => {
    return items
      .filter(p => p.status === 'succeeded')
      .reduce((acc, p) => acc + Number(p.amount || 0), 0)
  }, [items])

  return (
    <AccountantShell active="payments">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ color: 'var(--fg)', fontWeight: 700, fontSize: 22, margin: 0 }}>
          Платежи пациентов
        </h2>

        {/* Фильтры */}
        <Card>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <Field label="С даты">
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="По дату">
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Статус">
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                style={inputStyle}
              >
                <option value="">Все</option>
                <option value="succeeded">Оплачен</option>
                <option value="refunded">Возврат</option>
                <option value="cancelled">Отменён</option>
                <option value="pending">В ожидании</option>
              </select>
            </Field>
          </div>
        </Card>

        {/* Таблица */}
        <Card padded={false}>
          {error && (
            <div style={{ padding: 16, color: 'var(--bad)' }}>{error}</div>
          )}
          {loading ? (
            <div style={{ padding: 24, color: 'var(--fg-2)' }}>Загрузка…</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 24 }}>
              <EmptyState title="Платежей не найдено" description="Попробуйте изменить период или статус." />
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={trHeadStyle}>
                    <th style={thStyle}>Дата</th>
                    <th style={thStyle}>Пациент</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Сумма</th>
                    <th style={thStyle}>Шлюз</th>
                    <th style={thStyle}>Статус</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(p => {
                    const patientName = p.patient_name || p.patient?.full_name || '—'
                    const patientPhone = p.patient_phone || p.patient?.phone || ''
                    return (
                      <tr key={p.id} style={trStyle}>
                        <td style={tdStyle}>{fmtDateTime(p.created_at || p.paid_at)}</td>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 600 }}>{patientName}</div>
                          {patientPhone && (
                            <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>{patientPhone}</div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                          {fmtMoney(p.amount)}
                        </td>
                        <td style={tdStyle}>{p.gateway || '—'}</td>
                        <td style={tdStyle}>
                          <Chip variant={STATUS_VARIANT[p.status] || 'default'} dot>
                            {STATUS_LABELS[p.status] || p.status || '—'}
                          </Chip>
                        </td>
                        <td style={tdStyle}>
                          {/* Phase 2.5: возврат */}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            color: 'var(--fg-2)',
            fontSize: 13,
            display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
          }}>
            <span>Найдено платежей: <b style={{ color: 'var(--fg)' }}>{items.length}</b></span>
            <span>Сумма успешных: <b style={{ color: 'var(--good)' }}>{fmtMoney(totalSucceeded)}</b></span>
          </div>
        </Card>
      </div>
    </AccountantShell>
  )
}

// ===== БЛОК: вспомогательные стили =====
const inputStyle = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-2)',
  color: 'var(--fg)',
  fontSize: 13,
  minWidth: 140,
}
const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13.5,
}
const trHeadStyle = {
  background: 'var(--bg-2)',
  textAlign: 'left',
}
const thStyle = {
  padding: '10px 16px',
  borderBottom: '1px solid var(--border)',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--fg-2)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
}
const trStyle = { borderBottom: '1px solid var(--border)' }
const tdStyle = { padding: '12px 16px', color: 'var(--fg)' }

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{label}</span>
      {children}
    </label>
  )
}
