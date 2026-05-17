/**
 * ========================================
 * БЛОК: ManagerInventoryBatches — список партий с цветовой индикацией
 * ========================================
 * Этап 1 INVENTORY_COST_PLAN.
 *
 * Таблица: Номенклатура / Партия / Клиника / Получено / Остаток / Цена / Срок годности.
 *
 * Фильтры:
 *   • Номенклатура (поиск по справочнику — select)
 *   • Клиника (select)
 *   • «Истекает в N дней» (30 / 60 / 90 / все)
 *   • «Активные» (qty_remaining > 0) — toggle
 *
 * Цветовая индикация по сроку годности:
 *   • Красный   — уже истекло
 *   • Оранжевый — <30 дней
 *   • Жёлтый    — 30–60 дней
 *   • Зелёный   — норма (>60 дней или нет даты)
 *
 * Действие на партии: «Списать вручную» — modal с qty/reason/comment.
 *
 * API:
 *   GET  /inventory/batches?item_id=&clinic_id=&expiring_within=&active_only=
 *   GET  /inventory/items
 *   GET  /manager/clinics/
 *   POST /inventory/batches/{id}/writeoff
 * ========================================
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import api from '../api'
import ManagerShell from './_ManagerShell'
import { Card, Button, EmptyState, Modal, useToast } from '../design'

const INPUT_STYLE = {
  width: '100%', padding: '9px 12px',
  border: '1px solid var(--border)', borderRadius: 10,
  background: 'var(--surface)', color: 'var(--fg)', fontSize: 13.5,
}

const WRITEOFF_REASONS = [
  { value: 'damaged',  label: 'Брак / повреждение' },
  { value: 'expired',  label: 'Истёк срок годности' },
  { value: 'lost',     label: 'Утеря / недостача' },
  { value: 'count',    label: 'По итогам инвентаризации' },
  { value: 'other',    label: 'Другое' },
]

function daysUntil(dateStr) {
  if (!dateStr) return null
  try {
    const d = new Date(dateStr)
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    const diff = Math.floor((d - t) / (24 * 3600 * 1000))
    return diff
  } catch { return null }
}

function expiryBucket(dateStr) {
  // null/нет даты → green; <0 → red; 0–29 → orange; 30–59 → yellow; иначе green
  const d = daysUntil(dateStr)
  if (d == null) return 'none'
  if (d < 0) return 'red'
  if (d < 30) return 'orange'
  if (d < 60) return 'yellow'
  return 'green'
}

const BUCKET_STYLE = {
  red:    { color: 'oklch(0.52 0.18 25)', bg: 'oklch(0.95 0.05 25)',  border: 'oklch(0.85 0.10 25)' },
  orange: { color: 'oklch(0.60 0.17 50)', bg: 'oklch(0.96 0.05 60)',  border: 'oklch(0.86 0.10 60)' },
  yellow: { color: 'oklch(0.62 0.14 90)', bg: 'oklch(0.97 0.06 90)',  border: 'oklch(0.88 0.10 90)' },
  green:  { color: 'oklch(0.55 0.14 150)', bg: 'oklch(0.96 0.04 150)', border: 'oklch(0.86 0.08 150)' },
  none:   { color: 'var(--fg-3)', bg: 'var(--bg-1)', border: 'var(--border)' },
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

export default function ManagerInventoryBatches() {
  const { toast } = useToast()
  const [batches, setBatches] = useState([])
  const [items, setItems] = useState([])
  const [clinics, setClinics] = useState([])
  const [loading, setLoading] = useState(true)

  // Фильтры
  const [itemId, setItemId] = useState('')
  const [clinicId, setClinicId] = useState('')
  const [expWithin, setExpWithin] = useState('')   // '', '30', '60', '90'
  const [activeOnly, setActiveOnly] = useState(true)
  const [itemSearch, setItemSearch] = useState('')

  // Списание
  const [writeoffBatch, setWriteoffBatch] = useState(null)

  const itemMap = useMemo(() => {
    const m = {}; for (const it of items) m[it.id] = it; return m
  }, [items])
  const clinicMap = useMemo(() => {
    const m = {}; for (const c of clinics) m[c.id] = c; return m
  }, [clinics])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { active_only: activeOnly }
      if (itemId) params.item_id = itemId
      if (clinicId) params.clinic_id = clinicId
      if (expWithin) params.expiring_within = expWithin
      const r = await api.get('/inventory/batches', { params })
      setBatches(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось загрузить партии', 'error')
      setBatches([])
    } finally {
      setLoading(false)
    }
  }, [itemId, clinicId, expWithin, activeOnly, toast])

  useEffect(() => { load() }, [load])

  // Справочники
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/inventory/items', { params: { limit: 1000 } })
        const list = Array.isArray(r.data) ? r.data : (r.data?.items || [])
        setItems(list)
      } catch { setItems([]) }
      try {
        const r = await api.get('/manager/clinics/')
        setClinics(Array.isArray(r.data) ? r.data : [])
      } catch { setClinics([]) }
    })()
  }, [])

  // Подсчёт сводки по бакетам
  const summary = useMemo(() => {
    const s = { red: 0, orange: 0, yellow: 0, green: 0, none: 0 }
    for (const b of batches) s[expiryBucket(b.expires_at)]++
    return s
  }, [batches])

  const filteredItemOptions = useMemo(() => {
    const q = itemSearch.trim().toLowerCase()
    if (!q) return items.slice(0, 100)
    return items.filter(it =>
      (it.name && it.name.toLowerCase().includes(q)) ||
      (it.sku && it.sku.toLowerCase().includes(q))
    ).slice(0, 100)
  }, [items, itemSearch])

  return (
    <ManagerShell
      active="inventory-batches"
      title="Партии"
      subtitle="Все партии товаров с контролем срока годности"
      icon="inventory"
    >
      {/* ─── Сводка по срокам ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <SummaryCard label="Истекло" color={BUCKET_STYLE.red} value={summary.red} />
        <SummaryCard label="<30 дней" color={BUCKET_STYLE.orange} value={summary.orange} />
        <SummaryCard label="<60 дней" color={BUCKET_STYLE.yellow} value={summary.yellow} />
        <SummaryCard label="Норма" color={BUCKET_STYLE.green} value={summary.green + summary.none} />
      </div>

      {/* ─── Фильтры ─── */}
      <Card className="mb-3">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 p-3">
          <div className="sm:col-span-2">
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 4 }}>Номенклатура</div>
            <input
              type="text"
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              placeholder="поиск..."
              style={{ ...INPUT_STYLE, marginBottom: 4 }}
            />
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} style={INPUT_STYLE}>
              <option value="">Все товары</option>
              {filteredItemOptions.map(it => (
                <option key={it.id} value={it.id}>
                  {it.name}{it.sku ? ` · ${it.sku}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 4 }}>Клиника</div>
            <select value={clinicId} onChange={(e) => setClinicId(e.target.value)} style={INPUT_STYLE}>
              <option value="">Все клиники</option>
              {clinics.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 4 }}>Истекает в...</div>
            <select value={expWithin} onChange={(e) => setExpWithin(e.target.value)} style={INPUT_STYLE}>
              <option value="">Любой срок</option>
              <option value="30">30 дней</option>
              <option value="60">60 дней</option>
              <option value="90">90 дней</option>
            </select>
          </div>
        </div>
        <div className="px-3 pb-3">
          <label className="inline-flex items-center gap-2" style={{ fontSize: 13, color: 'var(--fg-2)' }}>
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            Только с остатком &gt; 0
          </label>
        </div>
      </Card>

      {/* ─── Таблица ─── */}
      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        ) : batches.length === 0 ? (
          <EmptyState
            icon={<span className="material-symbols-outlined" style={{ fontSize: 28 }}>inventory</span>}
            title="Партий не найдено"
            message="Попробуйте изменить фильтры или провести документ прихода."
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
                    <Th>Клиника</Th>
                    <Th style={{ textAlign: 'right' }}>Получено</Th>
                    <Th style={{ textAlign: 'right' }}>Остаток</Th>
                    <Th style={{ textAlign: 'right' }}>Цена</Th>
                    <Th>Срок годности</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => {
                    const item = itemMap[b.item_id]
                    const clinic = clinicMap[b.clinic_id]
                    const bucket = expiryBucket(b.expires_at)
                    const bst = BUCKET_STYLE[bucket]
                    return (
                      <tr key={b.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <Td>
                          <div style={{ fontWeight: 600, color: 'var(--fg)' }}>{item?.name || '—'}</div>
                          {item?.sku && <code style={{ fontSize: 11, color: 'var(--fg-3)' }}>{item.sku}</code>}
                        </Td>
                        <Td>{b.batch_number || <span style={{ color: 'var(--fg-3)' }}>—</span>}</Td>
                        <Td>{clinic?.name || '—'}</Td>
                        <Td style={{ textAlign: 'right' }}>{b.qty_received}{item?.unit ? ' ' + item.unit : ''}</Td>
                        <Td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {b.qty_remaining}{item?.unit ? ' ' + item.unit : ''}
                        </Td>
                        <Td style={{ textAlign: 'right' }}>{fmtMoney(b.unit_cost)}</Td>
                        <Td>
                          <span style={{
                            display: 'inline-block', padding: '3px 9px', borderRadius: 999,
                            fontSize: 11.5, fontWeight: 600,
                            background: bst.bg, color: bst.color, border: `1px solid ${bst.border}`,
                          }}>
                            {fmtDate(b.expires_at)}
                            {bucket === 'red' && ' · истёк'}
                            {bucket === 'orange' && ` · ${daysUntil(b.expires_at)} дн`}
                          </span>
                        </Td>
                        <Td style={{ textAlign: 'right' }}>
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => setWriteoffBatch(b)}
                            disabled={Number(b.qty_remaining || 0) <= 0}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>remove_circle</span>
                            Списать
                          </Button>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="sm:hidden flex flex-col gap-2 p-2">
              {batches.map((b) => {
                const item = itemMap[b.item_id]
                const clinic = clinicMap[b.clinic_id]
                const bucket = expiryBucket(b.expires_at)
                const bst = BUCKET_STYLE[bucket]
                return (
                  <div key={b.id} style={{
                    padding: 12, borderRadius: 12,
                    background: 'var(--bg-1)', border: '1px solid var(--border)',
                    borderLeft: `4px solid ${bst.border}`,
                  }}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--fg)' }}>{item?.name || '—'}</div>
                        <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                          {clinic?.name || '—'}{b.batch_number ? ` · ${b.batch_number}` : ''}
                        </div>
                      </div>
                      <span style={{
                        padding: '3px 8px', borderRadius: 999,
                        fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                        background: bst.bg, color: bst.color,
                      }}>
                        {fmtDate(b.expires_at)}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2" style={{ fontSize: 12 }}>
                      <div>
                        <div style={{ color: 'var(--fg-3)' }}>Получено</div>
                        <div>{b.qty_received}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--fg-3)' }}>Остаток</div>
                        <div style={{ fontWeight: 600 }}>{b.qty_remaining}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--fg-3)' }}>Цена</div>
                        <div>{fmtMoney(b.unit_cost)}</div>
                      </div>
                    </div>
                    <div className="mt-2">
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => setWriteoffBatch(b)}
                        disabled={Number(b.qty_remaining || 0) <= 0}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>remove_circle</span>
                        Списать вручную
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </Card>

      {/* ─── Modal списания ─── */}
      <WriteoffModal
        batch={writeoffBatch}
        item={writeoffBatch ? itemMap[writeoffBatch.item_id] : null}
        onClose={() => setWriteoffBatch(null)}
        onDone={() => { setWriteoffBatch(null); load() }}
      />
    </ManagerShell>
  )
}

// ─── Карточка-сводка по бакету ───
function SummaryCard({ label, value, color }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 12,
      background: color.bg, border: `1px solid ${color.border}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: color.color, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color.color, marginTop: 2 }}>{value}</div>
    </div>
  )
}

// ─── Модалка ручного списания ───
function WriteoffModal({ batch, item, onClose, onDone }) {
  const { toast } = useToast()
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('damaged')
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (batch) { setQty(''); setReason('damaged'); setComment('') }
  }, [batch])

  if (!batch) return (
    <Modal open={false} onClose={() => {}} title="" />
  )

  const submit = async () => {
    const q = Number(qty)
    const remaining = Number(batch.qty_remaining || 0)
    if (!(q > 0)) { toast('Количество должно быть больше 0', 'error'); return }
    if (q > remaining) {
      toast(`Нельзя списать больше остатка (${remaining})`, 'error'); return
    }
    setSaving(true)
    try {
      await api.post(`/inventory/batches/${batch.id}/writeoff`, {
        quantity: q,
        reason,
        comment: comment.trim() || null,
      })
      toast('Списание проведено', 'success')
      onDone()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось списать', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={!!batch}
      onClose={() => !saving && onClose()}
      title="Ручное списание из партии"
      size="sm"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button variant="danger" onClick={submit} disabled={saving}>
            {saving ? 'Списание...' : 'Списать'}
          </Button>
        </>
      }
    >
      <div style={{ padding: 10, borderRadius: 10, background: 'var(--bg-1)', marginBottom: 12 }}>
        <div style={{ fontWeight: 600, color: 'var(--fg)' }}>{item?.name || '—'}</div>
        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>
          Партия: {batch.batch_number || '—'} · Остаток: <b>{batch.qty_remaining}{item?.unit ? ' ' + item.unit : ''}</b>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3">
        <Field label="Количество к списанию *">
          <input
            type="number" min="0" step="any" max={batch.qty_remaining}
            value={qty} onChange={(e) => setQty(e.target.value)}
            style={INPUT_STYLE} autoFocus
          />
        </Field>
        <Field label="Причина *">
          <select value={reason} onChange={(e) => setReason(e.target.value)} style={INPUT_STYLE}>
            {WRITEOFF_REASONS.map(r => (<option key={r.value} value={r.value}>{r.label}</option>))}
          </select>
        </Field>
        <Field label="Комментарий">
          <textarea
            rows={3} value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="что именно произошло"
            style={{ ...INPUT_STYLE, resize: 'vertical', minHeight: 60 }}
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
function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}
