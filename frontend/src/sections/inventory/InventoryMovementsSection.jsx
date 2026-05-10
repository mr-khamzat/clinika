/**
 * InventoryMovementsSection — лента движений + быстрые действия
 * (приход / расход / перемещение / списание).
 */
import { useEffect, useState, useCallback } from 'react'
import api from '../../api'
import { Card, Button, Chip, Modal, EmptyState, useToast } from '../../design'

const TYPE_LABEL = {
  income:     'Приход',
  outgoing:   'Расход',
  transfer:   'Перемещение',
  adjustment: 'Корректировка',
  write_off:  'Списание',
  expired:    'Просрочка',
}
const TYPE_TONE = {
  income: 'good',
  outgoing: 'default',
  transfer: 'accent',
  adjustment: 'default',
  write_off: 'warn',
  expired: 'bad',
}

export default function InventoryMovementsSection() {
  const { toast } = useToast() || { toast: () => {} }
  const [moves, setMoves] = useState([])
  const [items, setItems] = useState([])
  const [clinics, setClinics] = useState([])
  const [filterType, setFilterType] = useState('')
  const [filterItem, setFilterItem] = useState('')
  const [filterClinic, setFilterClinic] = useState('')
  const [loading, setLoading] = useState(false)
  const [actionModal, setActionModal] = useState(null)  // 'income' | 'outgoing' | 'transfer' | 'write-off'
  const [expandedId, setExpandedId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterType) params.append('type', filterType)
      if (filterItem) params.append('item_id', filterItem)
      if (filterClinic) params.append('clinic_id', filterClinic)
      params.append('limit', '200')
      const res = await api({ method: 'GET', url: `/inventory/movements?${params}` })
      setMoves(res.data?.movements || [])
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Ошибка загрузки'
      toast?.(String(msg), 'error')
    } finally {
      setLoading(false)
    }
  }, [filterType, filterItem, filterClinic, toast])

  useEffect(() => {
    Promise.all([
      api({ method: 'GET', url: '/inventory/items?is_active=true&limit=500' }).then(r => r.data?.items || []),
      api({ method: 'GET', url: '/clinics/' }).then(r => (Array.isArray(r.data?.clinics) ? r.data.clinics : Array.isArray(r.data) ? r.data : [])),
    ]).then(([its, cls]) => {
      setItems(its); setClinics(cls)
    }).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  const itemMap = Object.fromEntries(items.map(i => [i.id, i]))
  const clinicMap = Object.fromEntries(clinics.map(c => [c.id, c]))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <select
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
        >
          <option value="">Все типы</option>
          {Object.entries(TYPE_LABEL).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </select>
        <select
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          value={filterClinic}
          onChange={e => setFilterClinic(e.target.value)}
        >
          <option value="">Все клиники</option>
          {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          value={filterItem}
          onChange={e => setFilterItem(e.target.value)}
        >
          <option value="">Все позиции</option>
          {items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
        </select>
        <div className="flex-1" />
        <Button onClick={() => setActionModal('income')}>+ Приход</Button>
        <Button variant="ghost" onClick={() => setActionModal('outgoing')}>− Расход</Button>
        <Button variant="ghost" onClick={() => setActionModal('transfer')}>⇄ Перемещение</Button>
        <Button variant="ghost" onClick={() => setActionModal('write-off')}>Списание</Button>
      </div>

      <Card>
        {loading ? (
          <div className="p-6 text-center text-gray-400">Загрузка…</div>
        ) : moves.length === 0 ? (
          <EmptyState
            title="Движений ещё не было"
            description="Создайте первую операцию через кнопки выше"
          />
        ) : (
          <div className="overflow-x-auto admin-resp-table-wrap">
            <table className="admin-resp-table w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                  <th className="px-3 py-2">Дата</th>
                  <th className="px-3 py-2">Тип</th>
                  <th className="px-3 py-2">Позиция</th>
                  <th className="px-3 py-2">Клиника</th>
                  <th className="px-3 py-2 text-right">Δ</th>
                  <th className="px-3 py-2 text-right">Остаток</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {moves.map(m => {
                  const it = itemMap[m.item_id]
                  const cl = clinicMap[m.clinic_id]
                  const expanded = expandedId === m.id
                  return (
                    <>
                      <tr
                        key={m.id}
                        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                        onClick={() => setExpandedId(expanded ? null : m.id)}
                      >
                        <td data-label="Дата" className="px-3 py-2 text-xs whitespace-nowrap">
                          {new Date(m.created_at).toLocaleString('ru-RU', {
                            day: '2-digit', month: '2-digit', year: '2-digit',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td data-label="Тип" className="px-3 py-2">
                          <Chip tone={TYPE_TONE[m.type]}>{TYPE_LABEL[m.type] || m.type}</Chip>
                        </td>
                        <td data-label="Позиция" className="px-3 py-2">{it?.name || m.item_id.slice(0, 8)}</td>
                        <td data-label="Клиника" className="px-3 py-2">{cl?.name || m.clinic_id.slice(0, 8)}</td>
                        <td data-label="Δ" className={`px-3 py-2 text-right font-mono tabular-nums ${
                          Number(m.quantity) >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {Number(m.quantity) >= 0 ? '+' : ''}{Number(m.quantity)}
                        </td>
                        <td data-label="Остаток" className="px-3 py-2 text-right font-mono tabular-nums">
                          {Number(m.balance_after)}
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`${m.id}-d`} className="bg-gray-50 dark:bg-gray-900">
                          <td colSpan={6} className="px-6 py-3 text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
                            <div>Партия: <b>{m.batch_number || '—'}</b> | Срок: <b>{m.expiry_date || '—'}</b></div>
                            {m.ref_entity_type && (
                              <div>Привязка: {m.ref_entity_type} {m.ref_entity_id ? `(${m.ref_entity_id.slice(0, 8)})` : ''}</div>
                            )}
                            {m.comment && <div>Комментарий: {m.comment}</div>}
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ActionModal
        kind={actionModal}
        onClose={() => setActionModal(null)}
        items={items}
        clinics={clinics}
        onDone={() => { setActionModal(null); load() }}
      />
    </div>
  )
}

// ─────────────────────────── ActionModal ──────────────────────────────────


function ActionModal({ kind, onClose, items, clinics, onDone }) {
  const { toast } = useToast() || { toast: () => {} }
  const [form, setForm] = useState({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setForm({})
  }, [kind])

  if (!kind) return null

  const titles = {
    income:      'Приход',
    outgoing:    'Расход / списание на услугу',
    transfer:    'Перемещение между клиниками',
    'write-off': 'Списание (брак / просрочка)',
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      let url, body
      if (kind === 'income') {
        url = '/inventory/movements/income'
        body = {
          item_id: form.item_id,
          clinic_id: form.clinic_id,
          quantity: form.quantity,
          batch: form.batch || '',
          expiry_date: form.expiry_date || null,
          vendor_invoice: form.vendor_invoice || null,
          comment: form.comment || null,
        }
      } else if (kind === 'outgoing') {
        url = '/inventory/movements/outgoing'
        body = {
          item_id: form.item_id,
          clinic_id: form.clinic_id,
          quantity: form.quantity,
          batch: form.batch || '',
          comment: form.comment || null,
        }
      } else if (kind === 'transfer') {
        url = '/inventory/movements/transfer'
        body = {
          item_id: form.item_id,
          from_clinic_id: form.from_clinic_id,
          to_clinic_id: form.to_clinic_id,
          quantity: form.quantity,
          batch: form.batch || '',
          comment: form.comment || null,
        }
      } else {
        url = '/inventory/movements/write-off'
        body = {
          item_id: form.item_id,
          clinic_id: form.clinic_id,
          quantity: form.quantity,
          batch: form.batch || '',
          reason: form.reason || 'Без причины',
          expired: !!form.expired,
        }
      }
      await api({ method: 'POST', url, data: body })
      toast?.('Операция выполнена', 'success')
      onDone?.()
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Ошибка'
      toast?.(String(msg), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const ItemSelect = (
    <div>
      <label className="text-xs text-gray-500 block mb-1">Позиция *</label>
      <select
        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
        value={form.item_id || ''}
        onChange={e => setForm(f => ({ ...f, item_id: e.target.value }))}
      >
        <option value="">— выберите позицию —</option>
        {items.map(it => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}
      </select>
    </div>
  )

  const QtyInput = (
    <div>
      <label className="text-xs text-gray-500 block mb-1">Количество *</label>
      <input
        type="number" step="0.001" min="0"
        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
        value={form.quantity || ''}
        onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
      />
    </div>
  )

  const ClinicSelect = (label, key) => (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label} *</label>
      <select
        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
        value={form[key] || ''}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      >
        <option value="">— клиника —</option>
        {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  )

  return (
    <Modal open={true} onClose={onClose} title={titles[kind]}>
      <div className="space-y-3 p-1">
        {ItemSelect}
        {kind === 'transfer' ? (
          <div className="grid grid-cols-2 gap-3">
            {ClinicSelect('Откуда', 'from_clinic_id')}
            {ClinicSelect('Куда', 'to_clinic_id')}
          </div>
        ) : ClinicSelect('Клиника', 'clinic_id')}
        <div className="grid grid-cols-2 gap-3">
          {QtyInput}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Партия</label>
            <input
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
              value={form.batch || ''}
              onChange={e => setForm(f => ({ ...f, batch: e.target.value }))}
            />
          </div>
        </div>
        {kind === 'income' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Срок годности</label>
              <input
                type="date"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                value={form.expiry_date || ''}
                onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">№ накладной</label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                value={form.vendor_invoice || ''}
                onChange={e => setForm(f => ({ ...f, vendor_invoice: e.target.value }))}
              />
            </div>
          </div>
        )}
        {kind === 'write-off' && (
          <>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Причина *</label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                value={form.reason || ''}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!form.expired}
                onChange={e => setForm(f => ({ ...f, expired: e.target.checked }))}
              />
              Просрочка (а не брак)
            </label>
          </>
        )}
        {kind !== 'write-off' && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">Комментарий</label>
            <input
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
              value={form.comment || ''}
              onChange={e => setForm(f => ({ ...f, comment: e.target.value }))}
            />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Сохранение…' : 'Применить'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
