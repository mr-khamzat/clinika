/**
 * ========================================
 * БЛОК: ManagerInventoryReceipts — список документов прихода
 * ========================================
 * Этап 1 INVENTORY_COST_PLAN.
 *
 * Возможности:
 *   • Таблица: № документа / Дата / Поставщик / Сумма / Статус
 *   • Фильтры: период (from/to), поставщик, статус (draft/posted/cancelled)
 *   • «+ Создать приход» → модалка-форма
 *     (после создания — переход на /manager/inventory/receipts/{id})
 *   • Click по строке → детальная страница прихода
 *
 * API:
 *   GET  /inventory/receipts?from=&to=&supplier_id=&status=
 *   POST /inventory/receipts                  — создать черновик
 *   GET  /inventory/suppliers?is_active=true  — справочник для фильтра/формы
 *   GET  /manager/clinics/                    — список клиник для формы
 * ========================================
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import ManagerShell from './_ManagerShell'
import { Card, Button, EmptyState, Modal, useToast, Chip } from '../design'

const INPUT_STYLE = {
  width: '100%', padding: '9px 12px',
  border: '1px solid var(--border)', borderRadius: 10,
  background: 'var(--surface)', color: 'var(--fg)', fontSize: 13.5,
}

const STATUS = {
  draft:     { label: 'Черновик',   color: 'oklch(0.72 0.13 80)',  bg: 'oklch(0.96 0.04 80)' },
  posted:    { label: 'Проведён',   color: 'oklch(0.58 0.14 150)', bg: 'oklch(0.95 0.05 150)' },
  cancelled: { label: 'Отменён',    color: 'oklch(0.55 0.05 0)',   bg: 'oklch(0.95 0.01 0)' },
}

function fmtDate(d) {
  if (!d) return '—'
  try {
    const dt = new Date(d)
    const dd = String(dt.getDate()).padStart(2, '0')
    const mm = String(dt.getMonth() + 1).padStart(2, '0')
    return `${dd}.${mm}.${dt.getFullYear()}`
  } catch { return String(d) }
}
function fmtMoney(v) {
  if (v == null || v === '') return '—'
  try { return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽' }
  catch { return String(v) + ' ₽' }
}
function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ManagerInventoryReceipts() {
  const nav = useNavigate()
  const { toast } = useToast()

  const [items, setItems] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [clinics, setClinics] = useState([])
  const [loading, setLoading] = useState(true)

  // Фильтры
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Модалка создания
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    clinic_id: '', supplier_id: '', doc_number: '',
    doc_date: todayISO(), notes: '',
  })

  const supplierMap = useMemo(() => {
    const m = {}; for (const s of suppliers) m[s.id] = s; return m
  }, [suppliers])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (from) params.from = from
      if (to) params.to = to
      if (supplierId) params.supplier_id = supplierId
      if (statusFilter) params.status = statusFilter
      const r = await api.get('/inventory/receipts', { params })
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось загрузить приходы', 'error')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [from, to, supplierId, statusFilter, toast])

  useEffect(() => { load() }, [load])

  // Поставщики + клиники грузим один раз
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/inventory/suppliers', { params: { is_active: true } })
        setSuppliers(Array.isArray(r.data) ? r.data : [])
      } catch { setSuppliers([]) }
      try {
        const r = await api.get('/manager/clinics/')
        setClinics(Array.isArray(r.data) ? r.data : [])
      } catch { setClinics([]) }
    })()
  }, [])

  const openCreate = () => {
    setForm({
      clinic_id: clinics[0]?.id || '',
      supplier_id: '',
      doc_number: '',
      doc_date: todayISO(),
      notes: '',
    })
    setCreateOpen(true)
  }

  const create = async () => {
    if (!form.clinic_id) {
      toast('Выберите клинику', 'error'); return
    }
    if (!form.doc_date) {
      toast('Укажите дату документа', 'error'); return
    }
    setCreating(true)
    try {
      const body = {
        clinic_id: form.clinic_id,
        supplier_id: form.supplier_id || null,
        doc_number: form.doc_number.trim() || null,
        doc_date: form.doc_date,
        notes: form.notes.trim() || null,
      }
      const r = await api.post('/inventory/receipts', body)
      toast('Документ создан', 'success')
      setCreateOpen(false)
      nav(`/manager/inventory/receipts/${r.data.id}`)
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось создать документ', 'error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <ManagerShell
      active="inventory-receipts"
      title="Приходы"
      subtitle="Документы поступления товаров на склад"
      icon="local_shipping"
      topbarRight={
        <Button variant="primary" size="sm" onClick={openCreate}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
          Создать приход
        </Button>
      }
    >
      {/* ─── Фильтры ─── */}
      <Card className="mb-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 4 }}>С даты</div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={INPUT_STYLE} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 4 }}>По дату</div>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={INPUT_STYLE} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 4 }}>Поставщик</div>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={INPUT_STYLE}>
              <option value="">Все</option>
              {suppliers.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 4 }}>Статус</div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={INPUT_STYLE}>
              <option value="">Все</option>
              <option value="draft">Черновик</option>
              <option value="posted">Проведён</option>
              <option value="cancelled">Отменён</option>
            </select>
          </div>
        </div>
        <div className="px-3 pb-3 sm:hidden">
          <Button variant="primary" onClick={openCreate} className="w-full">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
            Создать приход
          </Button>
        </div>
      </Card>

      {/* ─── Список ─── */}
      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<span className="material-symbols-outlined" style={{ fontSize: 28 }}>local_shipping</span>}
            title="Приходов пока нет"
            message="Создайте первый документ прихода, чтобы фиксировать поступления на склад."
            action={
              <Button variant="primary" onClick={openCreate}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
                Создать приход
              </Button>
            }
          />
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden sm:block" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-1)' }}>
                    <Th>№ документа</Th>
                    <Th>Дата</Th>
                    <Th>Поставщик</Th>
                    <Th style={{ textAlign: 'right' }}>Сумма</Th>
                    <Th>Статус</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => {
                    const st = STATUS[r.status] || { label: r.status, color: 'var(--fg)', bg: 'var(--bg-2)' }
                    return (
                      <tr
                        key={r.id}
                        style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                        onClick={() => nav(`/manager/inventory/receipts/${r.id}`)}
                      >
                        <Td>
                          <span style={{ fontWeight: 600, color: 'var(--fg)' }}>
                            {r.doc_number || `#${String(r.id).slice(0, 8)}`}
                          </span>
                        </Td>
                        <Td>{fmtDate(r.doc_date)}</Td>
                        <Td>{supplierMap[r.supplier_id]?.name || '—'}</Td>
                        <Td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(r.total_amount)}</Td>
                        <Td>
                          <span style={{
                            display: 'inline-block', padding: '2px 9px', borderRadius: 999,
                            fontSize: 11.5, fontWeight: 600,
                            background: st.bg, color: st.color,
                          }}>{st.label}</span>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="sm:hidden flex flex-col gap-2 p-2">
              {items.map((r) => {
                const st = STATUS[r.status] || { label: r.status, color: 'var(--fg)', bg: 'var(--bg-2)' }
                return (
                  <div
                    key={r.id}
                    onClick={() => nav(`/manager/inventory/receipts/${r.id}`)}
                    style={{
                      padding: 12, borderRadius: 12,
                      background: 'var(--bg-1)', border: '1px solid var(--border)',
                    }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--fg)' }}>
                        {r.doc_number || `#${String(r.id).slice(0, 8)}`}
                      </div>
                      <span style={{
                        padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                        background: st.bg, color: st.color, flexShrink: 0,
                      }}>{st.label}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
                      {fmtDate(r.doc_date)} · {supplierMap[r.supplier_id]?.name || 'Без поставщика'}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)', marginTop: 6 }}>
                      {fmtMoney(r.total_amount)}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </Card>

      {/* ─── Модалка создания ─── */}
      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title="Новый приход"
        size="md"
        actions={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>Отмена</Button>
            <Button variant="primary" onClick={create} disabled={creating}>
              {creating ? 'Создание...' : 'Создать черновик'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Клиника *">
            <select
              value={form.clinic_id}
              onChange={(e) => setForm({ ...form, clinic_id: e.target.value })}
              style={INPUT_STYLE}
            >
              <option value="">— выберите клинику —</option>
              {clinics.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </Field>
          <Field label="Поставщик">
            <select
              value={form.supplier_id}
              onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
              style={INPUT_STYLE}
            >
              <option value="">— без поставщика —</option>
              {suppliers.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </Field>
          <Field label="№ документа">
            <input
              type="text" value={form.doc_number}
              onChange={(e) => setForm({ ...form, doc_number: e.target.value })}
              placeholder="напр. ТН-123 от 12.05"
              style={INPUT_STYLE}
            />
          </Field>
          <Field label="Дата документа *">
            <input
              type="date" value={form.doc_date}
              onChange={(e) => setForm({ ...form, doc_date: e.target.value })}
              style={INPUT_STYLE}
            />
          </Field>
          <Field label="Заметки" full>
            <textarea
              rows={3} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              style={{ ...INPUT_STYLE, resize: 'vertical', minHeight: 60 }}
              placeholder="комментарий, ссылки и т.п."
            />
          </Field>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--fg-3)' }}>
          После создания черновика откроется страница, где можно добавить позиции и провести документ.
        </div>
      </Modal>
    </ManagerShell>
  )
}

function Th({ children, style }) {
  return (
    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--fg-3)', fontWeight: 600, fontSize: 12, ...style }}>
      {children}
    </th>
  )
}
function Td({ children, style }) {
  return (
    <td style={{ padding: '10px 12px', color: 'var(--fg)', verticalAlign: 'middle', fontSize: 13, ...style }}>
      {children}
    </td>
  )
}
function Field({ label, full = false, children }) {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : {}}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}
