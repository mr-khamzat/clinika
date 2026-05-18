/**
 * ========================================
 * БЛОК: AccSpending — расходы клиники (бухгалтер)
 * ========================================
 * Источники:
 *   GET    /accountant/spending?date_from&date_to&category
 *   POST   /accountant/spending            (создание)
 *   POST   /accountant/spending/{id}/mark-paid
 *   DELETE /accountant/spending/{id}
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import { Card, Button, Chip, Modal, EmptyState } from '../../design'
import AccountantShell from '../_AccountantShell'
import api from '../../api'

// ===== БЛОК: константы =====
const CAT_LABELS = {
  rent: 'Аренда',
  lab: 'Лаборатория',
  materials: 'Материалы',
  marketing: 'Маркетинг',
  utilities: 'Коммуналка',
  other: 'Прочее',
}
const CAT_VARIANT = {
  rent: 'accent',
  lab: 'default',
  materials: 'default',
  marketing: 'warn',
  utilities: 'default',
  other: 'default',
}

// ===== БЛОК: utils =====
function fmtMoney(v) {
  const n = Number(v || 0)
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽'
}
function todayISO() { return new Date().toISOString().slice(0, 10) }
function firstOfMonthISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function fmtDate(s) {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch { return s }
}

// ===== БЛОК: основной компонент =====
export default function AccSpending() {
  const [dateFrom, setDateFrom] = useState(firstOfMonthISO())
  const [dateTo, setDateTo] = useState(todayISO())
  const [category, setCategory] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [busyId, setBusyId] = useState(null)

  async function load() {
    setLoading(true); setError('')
    try {
      const params = { date_from: dateFrom, date_to: dateTo }
      if (category) params.category = category
      const { data } = await api.get('/accountant/spending', { params })
      const list = Array.isArray(data) ? data : (data?.items || [])
      setItems(list)
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Ошибка загрузки')
      setItems([])
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [dateFrom, dateTo, category])

  async function markPaid(id) {
    setBusyId(id)
    try {
      await api.post(`/accountant/spending/${id}/mark-paid`)
      await load()
    } catch (e) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось пометить как оплаченное')
    } finally { setBusyId(null) }
  }

  async function remove(id) {
    if (!window.confirm('Удалить запись о расходе? Действие нельзя отменить.')) return
    setBusyId(id)
    try {
      await api.delete(`/accountant/spending/${id}`)
      await load()
    } catch (e) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось удалить')
    } finally { setBusyId(null) }
  }

  const totals = useMemo(() => {
    let total = 0, unpaid = 0
    items.forEach(it => {
      const a = Number(it.amount || 0)
      total += a
      if (!it.paid_at && !it.is_paid) unpaid += a
    })
    return { total, unpaid }
  }, [items])

  return (
    <AccountantShell active="spending">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ color: 'var(--fg)', fontWeight: 700, fontSize: 22, margin: 0 }}>
            Расходы клиники
          </h2>
          <Button variant="primary" onClick={() => setShowCreate(true)}>+ Добавить расход</Button>
        </div>

        {/* Фильтры */}
        <Card>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <Field label="С даты">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="По дату">
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Категория">
              <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}>
                <option value="">Все</option>
                {Object.entries(CAT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
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
              <EmptyState title="Расходов не найдено" description="За выбранный период записей нет. Создайте новую через «+ Добавить расход»." />
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={trHeadStyle}>
                    <th style={thStyle}>Дата</th>
                    <th style={thStyle}>Категория</th>
                    <th style={thStyle}>Название</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Сумма</th>
                    <th style={thStyle}>Срок</th>
                    <th style={thStyle}>Статус</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => {
                    const isPaid = !!(it.paid_at || it.is_paid)
                    const date = it.paid_at || it.created_at
                    return (
                      <tr key={it.id} style={trStyle}>
                        <td style={tdStyle}>{fmtDate(date)}</td>
                        <td style={tdStyle}>
                          <Chip variant={CAT_VARIANT[it.category] || 'default'}>
                            {CAT_LABELS[it.category] || it.category || '—'}
                          </Chip>
                        </td>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 600 }}>{it.title || '—'}</div>
                          {it.notes && (
                            <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 2 }}>
                              {it.notes}
                            </div>
                          )}
                          {it.is_recurring && (
                            <div style={{ marginTop: 4 }}>
                              <Chip variant="accent">Регулярный</Chip>
                            </div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                          {fmtMoney(it.amount)}
                        </td>
                        <td style={tdStyle}>{fmtDate(it.due_date)}</td>
                        <td style={tdStyle}>
                          {isPaid
                            ? <Chip variant="good" dot>Оплачено</Chip>
                            : <Chip variant="warn" dot>К оплате</Chip>}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {!isPaid && (
                            <Button
                              size="sm" variant="secondary"
                              onClick={() => markPaid(it.id)}
                              disabled={busyId === it.id}
                            >
                              Оплачено
                            </Button>
                          )}
                          {' '}
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => remove(it.id)}
                            disabled={busyId === it.id}
                          >
                            Удалить
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
            <span>Всего за период: <b style={{ color: 'var(--fg)' }}>{fmtMoney(totals.total)}</b></span>
            <span>Не оплачено: <b style={{ color: 'var(--warn)' }}>{fmtMoney(totals.unpaid)}</b></span>
          </div>
        </Card>
      </div>

      {showCreate && (
        <CreateSpendingModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load() }}
        />
      )}
    </AccountantShell>
  )
}

// ===== БЛОК: модалка создания =====
function CreateSpendingModal({ onClose, onSaved }) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [cat, setCat] = useState('other')
  const [dueDate, setDueDate] = useState('')
  const [isRecurring, setIsRecurring] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    setSaving(true); setErr('')
    try {
      const body = {
        title: title.trim(),
        amount: Number(amount),
        category: cat,
        due_date: dueDate || null,
        is_recurring: !!isRecurring,
        notes: notes || null,
      }
      if (!body.title) { setErr('Укажите название'); setSaving(false); return }
      if (!body.amount || body.amount <= 0) { setErr('Сумма должна быть больше 0'); setSaving(false); return }
      await api.post('/accountant/spending', body)
      onSaved()
    } catch (e) {
      setErr(e?.response?.data?.detail || e?.message || 'Не удалось сохранить')
    } finally { setSaving(false) }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Новый расход"
      actions={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? 'Сохранение…' : 'Создать'}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Название">
          <input
            type="text" value={title} onChange={e => setTitle(e.target.value)}
            style={inputStyle} placeholder="Например, Аренда за май" autoFocus
          />
        </Field>
        <Field label="Сумма (₽)">
          <input
            type="number" min="0" step="0.01"
            value={amount} onChange={e => setAmount(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Категория">
          <select value={cat} onChange={e => setCat(e.target.value)} style={inputStyle}>
            {Object.entries(CAT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Срок оплаты">
          <input
            type="date" value={dueDate}
            onChange={e => setDueDate(e.target.value)} style={inputStyle}
          />
        </Field>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--fg)' }}>
          <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} />
          <span>Регулярный (повторяется)</span>
        </label>
        <Field label="Комментарий">
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
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
