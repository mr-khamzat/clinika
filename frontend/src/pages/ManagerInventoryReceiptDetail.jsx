/**
 * ========================================
 * БЛОК: ManagerInventoryReceiptDetail — детальная страница прихода
 * ========================================
 * Этап 1 INVENTORY_COST_PLAN.
 *
 * Шапка: № документа, дата, поставщик, статус, итоговая сумма.
 * Таблица позиций (партий): номенклатура / кол-во / цена / сумма / срок годности / № партии.
 *
 * Действия:
 *   • «+ Добавить позицию» (только если status=draft) → форма (item, qty, price, expires, batch_number)
 *   • «Удалить позицию» (только draft) — DELETE /receipts/{id}/items/{batch_id}
 *   • «Провести»  (только draft, ≥1 позиция) — POST /receipts/{id}/post
 *   • «Отменить»  (только draft) — POST /receipts/{id}/cancel
 *
 * API:
 *   GET    /inventory/receipts/{id}
 *   GET    /inventory/batches?receipt_id={id}&active_only=false
 *   GET    /inventory/items?search=
 *   GET    /inventory/suppliers?is_active=true   — чтобы подписать поставщика
 *   POST   /inventory/receipts/{id}/items
 *   DELETE /inventory/receipts/{id}/items/{batch_id}
 *   POST   /inventory/receipts/{id}/post
 *   POST   /inventory/receipts/{id}/cancel
 * ========================================
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../api'
import ManagerShell from './_ManagerShell'
import { Card, Button, EmptyState, Modal, useToast } from '../design'

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

export default function ManagerInventoryReceiptDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { toast } = useToast()

  const [receipt, setReceipt] = useState(null)
  const [batches, setBatches] = useState([])
  const [items, setItems] = useState([])         // справочник номенклатуры
  const [supplierName, setSupplierName] = useState('')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const itemMap = useMemo(() => {
    const m = {}; for (const it of items) m[it.id] = it; return m
  }, [items])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r1, r2] = await Promise.all([
        api.get(`/inventory/receipts/${id}`),
        api.get('/inventory/batches', { params: { receipt_id: id, active_only: false } }),
      ])
      setReceipt(r1.data)
      setBatches(Array.isArray(r2.data) ? r2.data : [])
      // Подписать поставщика (если есть)
      if (r1.data?.supplier_id) {
        try {
          const sup = await api.get(`/inventory/suppliers/${r1.data.supplier_id}`)
          setSupplierName(sup.data?.name || '')
        } catch { setSupplierName('') }
      } else {
        setSupplierName('')
      }
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось загрузить документ', 'error')
      setReceipt(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { load() }, [load])

  // Справочник товаров — для подписи и select в форме добавления
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/inventory/items', { params: { limit: 500 } })
        const list = Array.isArray(r.data) ? r.data : (r.data?.items || [])
        setItems(list)
      } catch { setItems([]) }
    })()
  }, [])

  const post = async () => {
    if (!confirm('Провести документ? После этого редактировать позиции будет нельзя.')) return
    setWorking(true)
    try {
      await api.post(`/inventory/receipts/${id}/post`)
      toast('Документ проведён, остатки обновлены', 'success')
      load()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось провести', 'error')
    } finally {
      setWorking(false)
    }
  }

  const cancel = async () => {
    if (!confirm('Отменить документ?')) return
    setWorking(true)
    try {
      await api.post(`/inventory/receipts/${id}/cancel`)
      toast('Документ отменён', 'success')
      load()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось отменить', 'error')
    } finally {
      setWorking(false)
    }
  }

  const removeItem = async (batchId) => {
    if (!confirm('Удалить позицию из документа?')) return
    try {
      await api.delete(`/inventory/receipts/${id}/items/${batchId}`)
      toast('Позиция удалена', 'success')
      load()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось удалить', 'error')
    }
  }

  if (loading) {
    return (
      <ManagerShell active="inventory-receipts" title="Загрузка..." icon="local_shipping">
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
        </div>
      </ManagerShell>
    )
  }
  if (!receipt) {
    return (
      <ManagerShell active="inventory-receipts" title="Документ не найден" icon="local_shipping">
        <Card>
          <EmptyState
            icon={<span className="material-symbols-outlined" style={{ fontSize: 28 }}>error</span>}
            title="Документ не найден"
            message="Возможно, он был удалён или у вас нет доступа."
            action={<Button onClick={() => nav('/manager/inventory/receipts')}>← К списку приходов</Button>}
          />
        </Card>
      </ManagerShell>
    )
  }

  const st = STATUS[receipt.status] || { label: receipt.status, color: 'var(--fg)', bg: 'var(--bg-2)' }
  const isDraft = receipt.status === 'draft'

  return (
    <ManagerShell
      active="inventory-receipts"
      title={`Приход ${receipt.doc_number || '#' + String(receipt.id).slice(0, 8)}`}
      subtitle={fmtDate(receipt.doc_date) + (supplierName ? ' · ' + supplierName : '')}
      icon="local_shipping"
      topbarRight={
        <Button variant="ghost" size="sm" onClick={() => nav('/manager/inventory/receipts')}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
          К списку
        </Button>
      }
    >
      {/* ─── Шапка с метаданными ─── */}
      <Card className="mb-3">
        <div className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
            <div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600, textTransform: 'uppercase' }}>Документ</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)' }}>
                {receipt.doc_number || `#${String(receipt.id).slice(0, 8)}`}
              </div>
            </div>
            <span style={{
              padding: '4px 11px', borderRadius: 999,
              fontSize: 12, fontWeight: 600,
              background: st.bg, color: st.color,
            }}>{st.label}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <Meta label="Дата">{fmtDate(receipt.doc_date)}</Meta>
            <Meta label="Поставщик">{supplierName || '—'}</Meta>
            <Meta label="Позиций">{batches.length}</Meta>
            <Meta label="Сумма">
              <span style={{ fontWeight: 700, fontSize: 15 }}>{fmtMoney(receipt.total_amount)}</span>
            </Meta>
          </div>
          {receipt.notes && (
            <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: 'var(--bg-1)', fontSize: 13, color: 'var(--fg-2)' }}>
              {receipt.notes}
            </div>
          )}

          {/* Действия */}
          <div className="flex flex-wrap items-center gap-2 mt-4">
            {isDraft && (
              <>
                <Button variant="primary" onClick={() => setAddOpen(true)} disabled={working}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
                  Добавить позицию
                </Button>
                <Button variant="secondary" onClick={post} disabled={working || batches.length === 0}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>check_circle</span>
                  Провести
                </Button>
                <Button variant="ghost" onClick={cancel} disabled={working}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
                  Отменить
                </Button>
              </>
            )}
            {receipt.status === 'posted' && (
              <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
                <span className="material-symbols-outlined align-middle" style={{ fontSize: 14, marginRight: 4 }}>info</span>
                Документ проведён {receipt.posted_at ? fmtDate(receipt.posted_at) : ''} — остатки уже обновлены.
              </div>
            )}
            {receipt.status === 'cancelled' && (
              <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>Документ отменён.</div>
            )}
          </div>
        </div>
      </Card>

      {/* ─── Позиции ─── */}
      <Card>
        <div className="px-3 pt-3 pb-1" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-2)' }}>
          Позиции
        </div>
        {batches.length === 0 ? (
          <EmptyState
            icon={<span className="material-symbols-outlined" style={{ fontSize: 28 }}>inventory_2</span>}
            title="Позиций пока нет"
            message={isDraft ? 'Добавьте первую позицию, чтобы провести документ.' : 'В этом документе нет позиций.'}
            action={isDraft ? (
              <Button variant="primary" onClick={() => setAddOpen(true)}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
                Добавить позицию
              </Button>
            ) : null}
          />
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden sm:block" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-1)' }}>
                    <Th>Номенклатура</Th>
                    <Th>№ партии</Th>
                    <Th style={{ textAlign: 'right' }}>Кол-во</Th>
                    <Th style={{ textAlign: 'right' }}>Цена</Th>
                    <Th style={{ textAlign: 'right' }}>Сумма</Th>
                    <Th>Срок годности</Th>
                    {isDraft && <Th />}
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => {
                    const item = itemMap[b.item_id]
                    const sum = Number(b.qty_received || 0) * Number(b.unit_cost || 0)
                    return (
                      <tr key={b.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <Td>
                          <div style={{ fontWeight: 600, color: 'var(--fg)' }}>{item?.name || '—'}</div>
                          {item?.sku && <code style={{ fontSize: 11, color: 'var(--fg-3)' }}>{item.sku}</code>}
                        </Td>
                        <Td>{b.batch_number || <span style={{ color: 'var(--fg-3)' }}>—</span>}</Td>
                        <Td style={{ textAlign: 'right' }}>{b.qty_received}{item?.unit ? ' ' + item.unit : ''}</Td>
                        <Td style={{ textAlign: 'right' }}>{fmtMoney(b.unit_cost)}</Td>
                        <Td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(sum)}</Td>
                        <Td>{fmtDate(b.expires_at)}</Td>
                        {isDraft && (
                          <Td style={{ textAlign: 'right' }}>
                            <button
                              onClick={() => removeItem(b.id)}
                              className="inline-flex items-center justify-center transition-transform active:scale-95"
                              style={{
                                width: 30, height: 30, borderRadius: 8,
                                background: 'transparent', border: '1px solid var(--border)',
                                color: 'var(--bad, #d4424b)',
                              }}
                              aria-label="Удалить позицию"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                            </button>
                          </Td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden flex flex-col gap-2 p-2">
              {batches.map((b) => {
                const item = itemMap[b.item_id]
                const sum = Number(b.qty_received || 0) * Number(b.unit_cost || 0)
                return (
                  <div key={b.id} style={{
                    padding: 12, borderRadius: 12,
                    background: 'var(--bg-1)', border: '1px solid var(--border)',
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--fg)' }}>{item?.name || '—'}</div>
                    <div className="grid grid-cols-2 gap-2 mt-2" style={{ fontSize: 12 }}>
                      <div><span style={{ color: 'var(--fg-3)' }}>Кол-во: </span>{b.qty_received}{item?.unit ? ' ' + item.unit : ''}</div>
                      <div><span style={{ color: 'var(--fg-3)' }}>Цена: </span>{fmtMoney(b.unit_cost)}</div>
                      <div><span style={{ color: 'var(--fg-3)' }}>Сумма: </span><b>{fmtMoney(sum)}</b></div>
                      <div><span style={{ color: 'var(--fg-3)' }}>Срок: </span>{fmtDate(b.expires_at)}</div>
                      {b.batch_number && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          <span style={{ color: 'var(--fg-3)' }}>Партия: </span>{b.batch_number}
                        </div>
                      )}
                    </div>
                    {isDraft && (
                      <div className="mt-2">
                        <Button variant="ghost" size="sm" onClick={() => removeItem(b.id)}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                          Удалить
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </Card>

      {/* ─── Модалка «Добавить позицию» ─── */}
      <AddItemModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        items={items}
        receiptId={id}
        onAdded={load}
      />
    </ManagerShell>
  )
}

// ─── Модалка добавления позиции ───
function AddItemModal({ open, onClose, items, receiptId, onAdded }) {
  const { toast } = useToast()
  const [form, setForm] = useState({
    item_id: '', qty_received: '', unit_cost: '',
    batch_number: '', expires_at: '',
  })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (open) {
      setForm({ item_id: '', qty_received: '', unit_cost: '', batch_number: '', expires_at: '' })
      setSearch('')
    }
  }, [open])

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items.slice(0, 200)
    return items.filter(it =>
      (it.name && it.name.toLowerCase().includes(q)) ||
      (it.sku && it.sku.toLowerCase().includes(q))
    ).slice(0, 200)
  }, [items, search])

  const submit = async () => {
    if (!form.item_id) { toast('Выберите номенклатуру', 'error'); return }
    const qty = Number(form.qty_received)
    const price = Number(form.unit_cost)
    if (!(qty > 0)) { toast('Количество должно быть больше 0', 'error'); return }
    if (!(price >= 0)) { toast('Цена не может быть отрицательной', 'error'); return }
    setSaving(true)
    try {
      await api.post(`/inventory/receipts/${receiptId}/items`, {
        item_id: form.item_id,
        qty_received: qty,
        unit_cost: price,
        batch_number: form.batch_number.trim() || null,
        expires_at: form.expires_at || null,
      })
      toast('Позиция добавлена', 'success')
      onClose()
      onAdded?.()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось добавить позицию', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Добавить позицию"
      size="md"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? 'Добавление...' : 'Добавить'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Поиск номенклатуры" full>
          <input
            type="text" value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="название или SKU"
            style={INPUT_STYLE}
          />
        </Field>
        <Field label="Номенклатура *" full>
          <select
            value={form.item_id}
            onChange={(e) => setForm({ ...form, item_id: e.target.value })}
            style={INPUT_STYLE}
            size={Math.min(6, Math.max(3, filteredItems.length))}
          >
            <option value="">— выбрать —</option>
            {filteredItems.map(it => (
              <option key={it.id} value={it.id}>
                {it.name}{it.sku ? ` · ${it.sku}` : ''}{it.unit ? ` · ${it.unit}` : ''}
              </option>
            ))}
          </select>
          {items.length > 200 && (
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
              Показаны первые 200 — уточните поиск.
            </div>
          )}
        </Field>
        <Field label="Количество *">
          <input
            type="number" min="0" step="any" value={form.qty_received}
            onChange={(e) => setForm({ ...form, qty_received: e.target.value })}
            style={INPUT_STYLE}
          />
        </Field>
        <Field label="Цена за единицу, ₽ *">
          <input
            type="number" min="0" step="any" value={form.unit_cost}
            onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
            style={INPUT_STYLE}
          />
        </Field>
        <Field label="№ партии">
          <input
            type="text" value={form.batch_number}
            onChange={(e) => setForm({ ...form, batch_number: e.target.value })}
            placeholder="по этикетке"
            style={INPUT_STYLE}
          />
        </Field>
        <Field label="Срок годности">
          <input
            type="date" value={form.expires_at}
            onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
            style={INPUT_STYLE}
          />
        </Field>
      </div>
    </Modal>
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
function Meta({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13.5, color: 'var(--fg)' }}>{children}</div>
    </div>
  )
}
