/**
 * InventoryStocksSection — остатки по клиникам.
 *
 * API:
 *   GET  /inventory/stocks?clinic_id=&low_stock=&expiring_in_days=
 *   POST /inventory/stocks/count          — массовая инвентаризация (multi-step wizard)
 *   GET  /inventory/items                  — для подбора item-ов в wizard
 *   GET  /clinics                          — список клиник тенанта
 */
import { useEffect, useState, useCallback } from 'react'
import api from '../../api'
import { Card, Button, Chip, Modal, EmptyState, useToast } from '../../design'

export default function InventoryStocksSection() {
  const { toast } = useToast() || { toast: () => {} }
  const [stocks, setStocks] = useState([])
  const [clinics, setClinics] = useState([])
  const [filterClinic, setFilterClinic] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [expiringDays, setExpiringDays] = useState('')
  const [loading, setLoading] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterClinic) params.append('clinic_id', filterClinic)
      if (lowOnly) params.append('low_stock', 'true')
      if (expiringDays) params.append('expiring_in_days', expiringDays)
      params.append('limit', '500')
      const res = await api({ method: 'GET', url: `/inventory/stocks?${params}` })
      setStocks(res.data?.stocks || [])
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Не удалось загрузить остатки'
      toast?.({ kind: 'error', text: String(msg) })
    } finally {
      setLoading(false)
    }
  }, [filterClinic, lowOnly, expiringDays, toast])

  useEffect(() => {
    api({ method: 'GET', url: '/clinics/' })
      .then(r => setClinics(Array.isArray(r.data?.clinics) ? r.data.clinics : Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  // Топ-5 позиций с низким остатком — группируем по клинике
  const lowByClinic = stocks
    .filter(s => Number(s.quantity) < Number(s.item_min_threshold || 0) && Number(s.item_min_threshold || 0) > 0)
    .reduce((acc, s) => {
      const key = s.clinic_id
      if (!acc[key]) acc[key] = []
      acc[key].push(s)
      return acc
    }, {})

  const clinicName = (id) => clinics.find(c => c.id === id)?.name || id?.slice(0, 8)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <select
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          value={filterClinic}
          onChange={e => setFilterClinic(e.target.value)}
        >
          <option value="">Все клиники</option>
          {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="text-sm flex items-center gap-1.5">
          <input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} />
          Только низкие
        </label>
        <input
          type="number" min="0" max="365"
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm w-[180px]"
          placeholder="Истекает в N дней"
          value={expiringDays}
          onChange={e => setExpiringDays(e.target.value)}
        />
        <Button onClick={() => setWizardOpen(true)}>Инвентаризация</Button>
      </div>

      {/* Карточки клиник с топ-5 низкими */}
      {Object.keys(lowByClinic).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(lowByClinic).map(([cid, list]) => (
            <Card key={cid}>
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <div className="font-semibold">{clinicName(cid)}</div>
                <Chip tone="bad">низкие: {list.length}</Chip>
              </div>
              <div className="p-3 space-y-1.5">
                {list.slice(0, 5).map(s => (
                  <div key={s.id} className="flex justify-between text-sm">
                    <span className="truncate">{s.item_name}</span>
                    <span className="font-mono text-red-600">
                      {Number(s.quantity)} / {Number(s.item_min_threshold)}
                    </span>
                  </div>
                ))}
                {list.length > 5 && (
                  <div className="text-xs text-gray-500">… и ещё {list.length - 5}</div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Таблица */}
      <Card>
        {loading ? (
          <div className="p-6 text-center text-gray-400">Загрузка…</div>
        ) : stocks.length === 0 ? (
          <EmptyState
            title="Остатков нет"
            description="Сделайте приход через раздел «Движения» или загрузите инвентаризацию"
          />
        ) : (
          <div className="overflow-x-auto admin-resp-table-wrap">
            <table className="admin-resp-table w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Название</th>
                  <th className="px-3 py-2">Клиника</th>
                  <th className="px-3 py-2">Партия</th>
                  <th className="px-3 py-2">Срок</th>
                  <th className="px-3 py-2 text-right">Остаток</th>
                  <th className="px-3 py-2 text-right">Мин.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {stocks.map(s => {
                  const isLow = Number(s.quantity) < Number(s.item_min_threshold || 0) && Number(s.item_min_threshold || 0) > 0
                  return (
                    <tr key={s.id} className={isLow ? 'bg-red-50/40 dark:bg-red-900/10' : ''}>
                      <td data-label="SKU" className="px-3 py-2 font-mono text-xs">{s.item_sku}</td>
                      <td data-label="Название" className="px-3 py-2">{s.item_name}</td>
                      <td data-label="Клиника" className="px-3 py-2">{clinicName(s.clinic_id)}</td>
                      <td data-label="Партия" className="px-3 py-2 font-mono text-xs">{s.batch_number || '—'}</td>
                      <td data-label="Срок" className="px-3 py-2 text-xs">{s.expiry_date || '—'}</td>
                      <td data-label="Остаток" className={`px-3 py-2 text-right tabular-nums font-mono ${isLow ? 'text-red-600 font-bold' : ''}`}>
                        {Number(s.quantity)} {s.item_unit}
                      </td>
                      <td data-label="Мин." className="px-3 py-2 text-right tabular-nums text-xs text-gray-500">
                        {Number(s.item_min_threshold)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <InventoryCountWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        clinics={clinics}
        onDone={() => { setWizardOpen(false); load() }}
      />
    </div>
  )
}

// ─────────────────────────── Wizard инвентаризации ────────────────────────


function InventoryCountWizard({ open, onClose, clinics, onDone }) {
  const { toast } = useToast() || { toast: () => {} }
  const [step, setStep] = useState(1)  // 1: clinic | 2: items | 3: confirm
  const [clinicId, setClinicId] = useState('')
  const [items, setItems] = useState([])
  const [counts, setCounts] = useState({})  // item_id → counted_qty (string)
  const [search, setSearch] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setStep(1); setClinicId(''); setCounts({}); setSearch(''); setComment('')
    }
  }, [open])

  useEffect(() => {
    if (step === 2 && clinicId && items.length === 0) {
      api({ method: 'GET', url: '/inventory/items?is_active=true&limit=500' })
        .then(r => setItems(r.data?.items || []))
        .catch(() => {})
    }
  }, [step, clinicId, items.length])

  const filteredItems = !search.trim()
    ? items
    : items.filter(it =>
        it.name.toLowerCase().includes(search.toLowerCase()) ||
        it.sku.toLowerCase().includes(search.toLowerCase())
      )

  const filledLines = Object.entries(counts)
    .filter(([_, v]) => v !== '' && v !== null && v !== undefined)
    .map(([item_id, v]) => ({ item_id, counted_qty: String(v) }))

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      await api({
        method: 'POST',
        url: '/inventory/stocks/count',
        data: {
          clinic_id: clinicId,
          items: filledLines.map(l => ({
            item_id: l.item_id,
            counted_qty: l.counted_qty,
          })),
          comment: comment || null,
        },
      })
      toast?.({ kind: 'success', text: 'Инвентаризация сохранена' })
      onDone?.()
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Ошибка сохранения'
      toast?.({ kind: 'error', text: String(msg) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Инвентаризация — мастер">
      <div className="p-1 space-y-4">
        <div className="text-xs text-gray-500">
          Шаг {step} из 3
        </div>
        {step === 1 && (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium block mb-1">Выберите клинику</label>
              <select
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                value={clinicId}
                onChange={e => setClinicId(e.target.value)}
              >
                <option value="">— клиника —</option>
                {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Отмена</Button>
              <Button onClick={() => setStep(2)} disabled={!clinicId}>Далее →</Button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            <input
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
              placeholder="Поиск по позиции…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="max-h-[400px] overflow-y-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Название</th>
                    <th className="px-3 py-2">Ед.</th>
                    <th className="px-3 py-2 w-[120px]">Факт. кол-во</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredItems.map(it => (
                    <tr key={it.id}>
                      <td className="px-3 py-1.5 font-mono text-xs">{it.sku}</td>
                      <td className="px-3 py-1.5">{it.name}</td>
                      <td className="px-3 py-1.5 text-xs">{it.unit}</td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number" step="0.001" min="0"
                          className="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                          value={counts[it.id] || ''}
                          onChange={e => setCounts(c => ({ ...c, [it.id]: e.target.value }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>← Назад</Button>
              <Button onClick={() => setStep(3)} disabled={filledLines.length === 0}>
                Далее → ({filledLines.length})
              </Button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3">
            <div className="text-sm">
              Будет применено корректировок: <b>{filledLines.length}</b><br />
              Клиника: <b>{clinics.find(c => c.id === clinicId)?.name || clinicId.slice(0, 8)}</b>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Комментарий</label>
              <textarea
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                rows={2}
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Например: плановая инвентаризация декабрь"
              />
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep(2)}>← Назад</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Сохранение…' : 'Применить инвентаризацию'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
