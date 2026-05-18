/**
 * ========================================
 * БЛОК: AccPayroll — зарплата сотрудников (бухгалтер)
 * ========================================
 * Таблица с начислениями/выплатами и остатком. Возможность
 * пометить выплату через модалку.
 * Источники:
 *   GET  /accountant/payroll?date_from&date_to
 *   POST /accountant/payroll/{user_id}/mark-paid  { amount, period_label, notes }
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import { Card, Button, Chip, Modal, EmptyState } from '../../design'
import AccountantShell from '../_AccountantShell'
import api from '../../api'

// ===== БЛОК: utils =====
function fmtMoney(v) {
  const n = Number(v || 0)
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽'
}
const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
function monthLabel(d = new Date()) {
  return `${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`
}
function startOfMonthISO(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function endOfMonthISO(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
}
function startOfQuarterISO(d = new Date()) {
  const q = Math.floor(d.getMonth() / 3)
  return new Date(d.getFullYear(), q * 3, 1).toISOString().slice(0, 10)
}
function endOfQuarterISO(d = new Date()) {
  const q = Math.floor(d.getMonth() / 3)
  return new Date(d.getFullYear(), q * 3 + 3, 0).toISOString().slice(0, 10)
}

const ROLE_LABELS = {
  doctor: 'Врач',
  manager: 'Менеджер',
  administrator: 'Администратор',
  admin: 'Администратор',
  assistant: 'Ассистент',
  accountant: 'Бухгалтер',
  director: 'Директор',
  nurse: 'Медсестра',
}

// ===== БЛОК: компонент =====
export default function AccPayroll() {
  const [period, setPeriod] = useState('month') // month | quarter | custom
  const [dateFrom, setDateFrom] = useState(startOfMonthISO())
  const [dateTo, setDateTo] = useState(endOfMonthISO())
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [payingUser, setPayingUser] = useState(null) // объект-сотрудник для модалки

  // Управление периодом
  useEffect(() => {
    if (period === 'month') {
      setDateFrom(startOfMonthISO())
      setDateTo(endOfMonthISO())
    } else if (period === 'quarter') {
      setDateFrom(startOfQuarterISO())
      setDateTo(endOfQuarterISO())
    }
    // custom — не трогаем
  }, [period])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/accountant/payroll', {
        params: { date_from: dateFrom, date_to: dateTo },
      })
      const list = Array.isArray(data) ? data : (data?.items || [])
      // сортировка по balance DESC
      list.sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
      setItems(list)
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Ошибка загрузки')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [dateFrom, dateTo])

  const totals = useMemo(() => {
    const due = items.reduce((acc, r) => acc + Math.max(0, Number(r.balance || 0)), 0)
    const withDebt = items.filter(r => Number(r.balance || 0) > 0).length
    return { due, withDebt }
  }, [items])

  return (
    <AccountantShell active="payroll">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ color: 'var(--fg)', fontWeight: 700, fontSize: 22, margin: 0 }}>
          Зарплата сотрудников
        </h2>

        {/* Период */}
        <Card>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <Field label="Период">
              <select value={period} onChange={e => setPeriod(e.target.value)} style={inputStyle}>
                <option value="month">Текущий месяц</option>
                <option value="quarter">Текущий квартал</option>
                <option value="custom">Кастомный</option>
              </select>
            </Field>
            <Field label="С">
              <input
                type="date"
                value={dateFrom}
                disabled={period !== 'custom'}
                onChange={e => setDateFrom(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="По">
              <input
                type="date"
                value={dateTo}
                disabled={period !== 'custom'}
                onChange={e => setDateTo(e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>
        </Card>

        {/* Таблица */}
        <Card padded={false}>
          {error && <div style={{ padding: 16, color: 'var(--bad)' }}>{error}</div>}
          {loading ? (
            <div style={{ padding: 24, color: 'var(--fg-2)' }}>Загрузка…</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 24 }}>
              <EmptyState title="Нет данных по зарплате" description="За выбранный период начислений не найдено." />
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={trHeadStyle}>
                    <th style={thStyle}>Сотрудник</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Начислено</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Выплачено</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Остаток</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(r => {
                    const uid = r.user_id || r.id
                    const bal = Number(r.balance || 0)
                    return (
                      <tr key={uid} style={trStyle}>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 600 }}>{r.full_name || r.name || '—'}</div>
                          {r.role && (
                            <div style={{ marginTop: 4 }}>
                              <Chip variant="default">{ROLE_LABELS[r.role] || r.role}</Chip>
                            </div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtMoney(r.accrued)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtMoney(r.paid)}</td>
                        <td style={{
                          ...tdStyle,
                          textAlign: 'right',
                          fontWeight: 700,
                          color: bal > 0 ? 'var(--warn)' : bal < 0 ? 'var(--bad)' : 'var(--fg-2)',
                        }}>
                          {fmtMoney(bal)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <Button
                            size="sm"
                            variant={bal > 0 ? 'primary' : 'secondary'}
                            onClick={() => setPayingUser(r)}
                          >
                            Выплатить
                          </Button>
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
            <span>
              К выплате: <b style={{ color: 'var(--warn)' }}>{fmtMoney(totals.due)}</b>
              {' '}по <b style={{ color: 'var(--fg)' }}>{totals.withDebt}</b> сотрудникам
            </span>
            <span>Всего в списке: <b style={{ color: 'var(--fg)' }}>{items.length}</b></span>
          </div>
        </Card>
      </div>

      {/* Модалка выплаты */}
      {payingUser && (
        <PayoutModal
          user={payingUser}
          onClose={() => setPayingUser(null)}
          onSaved={() => { setPayingUser(null); load() }}
        />
      )}
    </AccountantShell>
  )
}

// ===== БЛОК: модалка выплаты =====
function PayoutModal({ user, onClose, onSaved }) {
  const uid = user.user_id || user.id
  const defaultAmount = Math.max(0, Number(user.balance || 0))
  const [amount, setAmount] = useState(String(defaultAmount))
  const [periodLabel, setPeriodLabel] = useState(monthLabel())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    setSaving(true)
    setErr('')
    try {
      const body = {
        amount: Number(amount),
        period_label: periodLabel,
        notes: notes || null,
      }
      await api.post(`/accountant/payroll/${uid}/mark-paid`, body)
      onSaved()
    } catch (e) {
      setErr(e?.response?.data?.detail || e?.message || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Выплата: ${user.full_name || user.name || '—'}`}
      actions={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button variant="primary" onClick={submit} disabled={saving || !amount}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Сумма (₽)">
          <input
            type="number" min="0" step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            style={inputStyle}
            autoFocus
          />
        </Field>
        <Field label="Период (подпись)">
          <input
            type="text"
            value={periodLabel}
            onChange={e => setPeriodLabel(e.target.value)}
            style={inputStyle}
            placeholder="Например, Май 2026"
          />
        </Field>
        <Field label="Комментарий">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
            placeholder="Опционально"
          />
        </Field>
        {err && <div style={{ color: 'var(--bad)', fontSize: 13 }}>{err}</div>}
      </div>
    </Modal>
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
  width: '100%',
  boxSizing: 'border-box',
}
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }
const trHeadStyle = { background: 'var(--bg-2)', textAlign: 'left' }
const thStyle = {
  padding: '10px 16px',
  borderBottom: '1px solid var(--border)',
  fontSize: 12, fontWeight: 600, color: 'var(--fg-2)',
  textTransform: 'uppercase', letterSpacing: 0.4,
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
