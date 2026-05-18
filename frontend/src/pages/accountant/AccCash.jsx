/**
 * ========================================
 * БЛОК: AccCash — кассовые смены (MVP-страница)
 * ========================================
 * Поведение:
 *   - GET /accountant/cash/current → null = нет открытой смены, иначе ShiftOut
 *   - Если null: форма открытия смены (cash_start + notes) → POST /accountant/cash/open
 *   - Если есть: header «Смена открыта в HH:MM», cash on hand, лента операций.
 *     • + Приход / − Расход → POST /accountant/cash/{id}/entries
 *     • Закрыть смену       → modal с cash_end_actual + notes → POST /accountant/cash/{id}/close
 *       После закрытия показываем discrepancy.
 *   - GET /accountant/cash/history — последние 20 закрытых смен (таблица)
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../../api'
import { Card, Button, Chip, Modal, EmptyState } from '../../design'
import AccountantShell from '../_AccountantShell'

// ─── Категории операций ────────────────────────────────────────────────────
const CAT_IN = [
  { value: 'sale',       label: 'Продажа' },
  { value: 'adjustment', label: 'Корректировка' },
  { value: 'other',      label: 'Прочее' },
]
const CAT_OUT = [
  { value: 'refund',      label: 'Возврат' },
  { value: 'salary',      label: 'Зарплата' },
  { value: 'expense',     label: 'Расход' },
  { value: 'incassation', label: 'Инкассация' },
  { value: 'adjustment',  label: 'Корректировка' },
  { value: 'other',       label: 'Прочее' },
]

// ─── Helpers ───────────────────────────────────────────────────────────────
function fmtMoney(v) {
  if (v == null || v === '') return '0 ₽'
  const n = Number(v)
  if (Number.isNaN(n)) return String(v)
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽'
}
function fmtTime(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }
  catch (_) { return iso }
}
function fmtDateTime(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch (_) { return iso }
}
function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('ru-RU') }
  catch (_) { return iso }
}

// ─── Inline Field (ds-style) ───────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div>
      <label
        className="block"
        style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.04em', color: 'var(--fg-3)', marginBottom: 6,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 9,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--fg)',
  fontSize: 14,
  outline: 'none',
}

// ═══════════════════════════════════════════════════════════════════════════
// КОМПОНЕНТ
// ═══════════════════════════════════════════════════════════════════════════
export default function AccCash() {
  const [shift, setShift]         = useState(null)   // ShiftDetailsOut | null
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [history, setHistory]     = useState([])
  const [openForm, setOpenForm]   = useState({ cash_start: '', notes: '' })
  const [opening, setOpening]     = useState(false)
  const [entryModal, setEntryModal] = useState(null)   // null | 'in' | 'out'
  const [entryForm, setEntryForm] = useState({ amount: '', category: '', description: '' })
  const [entrySaving, setEntrySaving] = useState(false)
  const [closeModal, setCloseModal]   = useState(false)
  const [closeForm, setCloseForm] = useState({ cash_end_actual: '', notes: '' })
  const [closing, setClosing]     = useState(false)
  const [misSyncing, setMisSyncing] = useState(false)
  const [closedShift, setClosedShift] = useState(null) // показ результата закрытия

  // ─── Загрузка текущей смены + истории ───
  async function reload() {
    setLoading(true)
    setError('')
    try {
      const [curRes, histRes] = await Promise.all([
        api.get('/accountant/cash/current').catch(e => ({ data: null, _err: e })),
        api.get('/accountant/cash/history', { params: { limit: 20 } }).catch(() => ({ data: [] })),
      ])
      if (curRes._err && curRes._err?.response?.status !== 404) {
        setError(curRes._err?.response?.data?.detail || 'Не удалось загрузить смену')
      }
      setShift(curRes.data || null)
      setHistory(Array.isArray(histRes.data) ? histRes.data : [])
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { reload() }, [])

  // ─── Открыть смену ───
  async function handleOpen() {
    setOpening(true)
    setError('')
    try {
      const body = {
        cash_start: openForm.cash_start === '' ? 0 : Number(openForm.cash_start) || 0,
        notes: openForm.notes || null,
      }
      const r = await api.post('/accountant/cash/open', body)
      setShift(r.data)
      setOpenForm({ cash_start: '', notes: '' })
      await reload()
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Не удалось открыть смену')
    } finally {
      setOpening(false)
    }
  }

  // ─── Добавить операцию ───
  function openEntry(direction) {
    setEntryForm({
      amount: '',
      category: (direction === 'in' ? CAT_IN[0] : CAT_OUT[0]).value,
      description: '',
    })
    setEntryModal(direction)
  }
  async function handleAddEntry() {
    if (!shift?.id) return
    const amt = Number(entryForm.amount)
    if (!amt || amt <= 0) {
      setError('Сумма должна быть больше нуля')
      return
    }
    setEntrySaving(true)
    setError('')
    try {
      await api.post(`/accountant/cash/${shift.id}/entries`, {
        direction: entryModal,
        amount: amt,
        category: entryForm.category,
        description: entryForm.description || null,
      })
      setEntryModal(null)
      await reload()
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Не удалось добавить операцию')
    } finally {
      setEntrySaving(false)
    }
  }

  // ─── Синхронизация платежей из МИС ───
  async function syncMisPayments() {
    if (misSyncing) return
    setMisSyncing(true)
    setError('')
    try {
      const r = await api.post('/accountant/cash/sync-mis-payments')
      const s = r?.data || {}
      const msg = `Синк МИС: импортировано наличных — ${s.imported_cash || 0}, карта — ${s.imported_card || 0}, пропущено дублей — ${s.skipped_dup || 0}`
      window.alert(msg)
      await reload()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось синхронизировать с МИС')
    } finally {
      setMisSyncing(false)
    }
  }

  // ─── Закрыть смену ───
  function openCloseModal() {
    // Подсказка: предзаполним фактический cash_end_actual ожидаемой суммой
    const expected = expectedCashOnHand
    setCloseForm({
      cash_end_actual: expected != null ? String(expected) : '',
      notes: '',
    })
    setCloseModal(true)
  }
  async function handleClose() {
    if (!shift?.id) return
    const actual = Number(closeForm.cash_end_actual)
    if (Number.isNaN(actual) || actual < 0) {
      setError('Укажите фактическую сумму')
      return
    }
    setClosing(true)
    setError('')
    try {
      const r = await api.post(`/accountant/cash/${shift.id}/close`, {
        cash_end_actual: actual,
        notes: closeForm.notes || null,
      })
      setClosedShift(r.data)
      setCloseModal(false)
      setShift(null)
      await reload()
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Не удалось закрыть смену')
    } finally {
      setClosing(false)
    }
  }

  // ─── Вычисляемый cash on hand (cash_start + in - out) ───
  const expectedCashOnHand = useMemo(() => {
    if (!shift) return null
    const cs  = Number(shift.cash_start)  || 0
    const it  = Number(shift.in_total)    || 0
    const ot  = Number(shift.out_total)   || 0
    return cs + it - ot
  }, [shift])

  return (
    <AccountantShell active="cash">
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--fg)', margin: 0 }}>
            Касса
          </h1>
          <div style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 4 }}>
            Кассовые смены и операции
          </div>
        </div>
        {shift && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => openEntry('in')}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 4 }}>add</span>
              Приход
            </Button>
            <Button variant="secondary" onClick={() => openEntry('out')}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 4 }}>remove</span>
              Расход
            </Button>
            <Button variant="secondary" onClick={syncMisPayments} disabled={misSyncing}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 4 }}>sync</span>
              {misSyncing ? 'Синхронизация…' : 'Синк МИС'}
            </Button>
            <Button variant="secondary" onClick={openCloseModal}>
              Закрыть смену
            </Button>
          </div>
        )}
      </div>

      {error && (
        <Card style={{ marginBottom: 16, borderColor: 'var(--bad)', background: 'var(--bad-soft)' }}>
          <div style={{ color: 'var(--bad)', fontSize: 13 }}>{error}</div>
        </Card>
      )}

      {/* Результат закрытия смены */}
      {closedShift && (
        <Card style={{ marginBottom: 16, borderColor: 'var(--good)', background: 'var(--good-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 28, color: 'var(--good)' }}>check_circle</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>Смена закрыта</div>
              <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 4 }}>
                Ожидалось: <b>{fmtMoney(closedShift.cash_end_expected)}</b> ·
                Фактически: <b>{fmtMoney(closedShift.cash_end_actual)}</b> ·
                Расхождение:{' '}
                <b style={{ color: Math.abs(Number(closedShift.discrepancy) || 0) < 0.01 ? 'var(--good)' : 'var(--bad)' }}>
                  {fmtMoney(closedShift.discrepancy)}
                </b>
              </div>
            </div>
            <button
              onClick={() => setClosedShift(null)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-3)' }}
              aria-label="Закрыть"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </Card>
      )}

      {loading ? (
        <Card>
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)' }}>Загрузка…</div>
        </Card>
      ) : !shift ? (
        // ═══ Нет открытой смены — форма открытия ═══
        <Card>
          <div style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span
                style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  display: 'inline-grid', placeItems: 'center',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}>
                  point_of_sale
                </span>
              </span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Открыть кассовую смену</div>
                <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Укажите кэш в начале смены</div>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              <Field label="Кэш в кассе на старте, ₽">
                <input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  value={openForm.cash_start}
                  onChange={e => setOpenForm(f => ({ ...f, cash_start: e.target.value }))}
                  placeholder="0"
                  style={inputStyle}
                />
              </Field>
              <Field label="Примечание (опц.)">
                <input
                  value={openForm.notes}
                  onChange={e => setOpenForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="например: смена утром"
                  style={inputStyle}
                />
              </Field>
              <div>
                <Button onClick={handleOpen} disabled={opening}>
                  {opening ? 'Открываем…' : 'Открыть смену'}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        // ═══ Открытая смена ═══
        <>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--fg-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Смена открыта
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)', marginTop: 4 }}>
                  в {fmtTime(shift.opened_at)} · {fmtDate(shift.opened_at)}
                </div>
                <div style={{ marginTop: 8 }}>
                  <Chip>Открыта</Chip>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: 'var(--fg-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Cash on hand
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)', marginTop: 2, letterSpacing: '-0.02em' }}>
                  {fmtMoney(expectedCashOnHand)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
                  Старт: <b>{fmtMoney(shift.cash_start)}</b> ·
                  Приход: <b style={{ color: 'var(--good)' }}>+{fmtMoney(shift.in_total)}</b> ·
                  Расход: <b style={{ color: 'var(--bad)' }}>−{fmtMoney(shift.out_total)}</b>
                </div>
              </div>
            </div>
          </Card>

          {/* ─── Лента операций ─── */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>
                Операции {shift.entries?.length ? `(${shift.entries.length})` : ''}
              </div>
            </div>
            {!shift.entries || shift.entries.length === 0 ? (
              <EmptyState
                icon="receipt_long"
                title="Операций пока нет"
                description="Добавьте первый приход или расход кнопками сверху"
              />
            ) : (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                {shift.entries.map(e => {
                  const isIn = e.direction === 'in'
                  const catList = isIn ? CAT_IN : CAT_OUT
                  const catLabel = catList.find(c => c.value === e.category)?.label || e.category
                  return (
                    <div
                      key={e.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 0', borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <span
                        style={{
                          width: 32, height: 32, borderRadius: 8,
                          background: isIn ? 'var(--good-soft)' : 'var(--bad-soft)',
                          color: isIn ? 'var(--good)' : 'var(--bad)',
                          display: 'inline-grid', placeItems: 'center', flexShrink: 0,
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
                          {isIn ? 'arrow_upward' : 'arrow_downward'}
                        </span>
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
                          {catLabel}
                        </div>
                        {e.description && (
                          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>
                            {e.description}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: isIn ? 'var(--good)' : 'var(--bad)' }}>
                          {isIn ? '+' : '−'}{fmtMoney(e.amount)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                          {fmtTime(e.created_at)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </>
      )}

      {/* ─── История смен ─── */}
      <Card>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)', marginBottom: 12 }}>
          История смен
        </div>
        {history.length === 0 ? (
          <div style={{ padding: 16, color: 'var(--fg-3)', fontSize: 13, textAlign: 'center' }}>
            Закрытых смен пока нет
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg-3)' }}>
                  <th style={{ textAlign: 'left',  padding: '8px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Открыта</th>
                  <th style={{ textAlign: 'left',  padding: '8px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Закрыта</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Старт</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Ожидалось</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Факт</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Расхождение</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => {
                  const disc = Number(h.discrepancy) || 0
                  const discColor = Math.abs(disc) < 0.01 ? 'var(--good)' : 'var(--bad)'
                  return (
                    <tr key={h.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px', color: 'var(--fg)' }}>{fmtDateTime(h.opened_at)}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--fg-2)' }}>{fmtDateTime(h.closed_at)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{fmtMoney(h.cash_start)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{fmtMoney(h.cash_end_expected)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{fmtMoney(h.cash_end_actual)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: discColor, fontWeight: 600 }}>
                        {fmtMoney(h.discrepancy)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ─── Модалка: добавить операцию ─── */}
      {entryModal && (
        <Modal
          open
          onClose={() => setEntryModal(null)}
          title={entryModal === 'in' ? 'Приход' : 'Расход'}
          size="sm"
          actions={
            <>
              <Button variant="secondary" onClick={() => setEntryModal(null)}>Отмена</Button>
              <Button onClick={handleAddEntry} disabled={entrySaving || !entryForm.amount}>
                {entrySaving ? 'Сохранение…' : 'Добавить'}
              </Button>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Сумма, ₽ *">
              <input
                autoFocus
                type="number" min="0.01" step="0.01" inputMode="decimal"
                value={entryForm.amount}
                onChange={e => setEntryForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0"
                style={inputStyle}
              />
            </Field>
            <Field label="Категория">
              <select
                value={entryForm.category}
                onChange={e => setEntryForm(f => ({ ...f, category: e.target.value }))}
                style={inputStyle}
              >
                {(entryModal === 'in' ? CAT_IN : CAT_OUT).map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Описание (опц.)">
              <input
                value={entryForm.description}
                onChange={e => setEntryForm(f => ({ ...f, description: e.target.value }))}
                placeholder="комментарий к операции"
                style={inputStyle}
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* ─── Модалка: закрыть смену ─── */}
      {closeModal && shift && (
        <Modal
          open
          onClose={() => setCloseModal(false)}
          title="Закрытие смены"
          size="sm"
          actions={
            <>
              <Button variant="secondary" onClick={() => setCloseModal(false)}>Отмена</Button>
              <Button onClick={handleClose} disabled={closing}>
                {closing ? 'Закрываем…' : 'Закрыть смену'}
              </Button>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div
              style={{
                padding: 12, borderRadius: 9,
                background: 'var(--bg-1)', border: '1px solid var(--border)',
                fontSize: 12, color: 'var(--fg-2)',
              }}
            >
              Ожидаемая сумма по операциям: <b style={{ color: 'var(--fg)' }}>{fmtMoney(expectedCashOnHand)}</b>
            </div>
            <Field label="Фактическая сумма в кассе, ₽ *">
              <input
                autoFocus
                type="number" min="0" step="0.01" inputMode="decimal"
                value={closeForm.cash_end_actual}
                onChange={e => setCloseForm(f => ({ ...f, cash_end_actual: e.target.value }))}
                placeholder="0"
                style={inputStyle}
              />
            </Field>
            <Field label="Примечание (опц.)">
              <input
                value={closeForm.notes}
                onChange={e => setCloseForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="комментарий к смене"
                style={inputStyle}
              />
            </Field>
          </div>
        </Modal>
      )}
    </AccountantShell>
  )
}
