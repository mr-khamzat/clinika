/**
 * InventoryItemsSection — каталог позиций (товары/оборудование/медикаменты).
 *
 * API:
 *   GET    /inventory/items       — список с фильтрами и search
 *   POST   /inventory/items       — создать
 *   PATCH  /inventory/items/{id}  — обновить
 *   DELETE /inventory/items/{id}  — soft delete (is_active=False)
 *   POST   /inventory/items/import-csv — массовый импорт
 */
import { useEffect, useState, useCallback } from 'react'
import api from '../../api'
import { Card, Button, Chip, Modal, EmptyState, useToast } from '../../design'

const CATEGORIES = [
  { id: 'consumable', label: 'Расходники' },
  { id: 'equipment',  label: 'Оборудование' },
  { id: 'medication', label: 'Медикаменты' },
  { id: 'reagent',    label: 'Реактивы' },
  { id: 'other',      label: 'Прочее' },
]
const CAT_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.id, c.label]))

const EMPTY_FORM = {
  sku: '',
  name: '',
  category: 'consumable',
  unit: 'шт',
  barcode: '',
  vendor: '',
  cost_per_unit: '0',
  min_stock_threshold: '0',
  expiry_tracked: false,
  notes: '',
}

export default function InventoryItemsSection() {
  const { toast } = useToast() || { toast: () => {} }
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [filterCategory, setFilterCategory] = useState('')
  const [search, setSearch] = useState('')
  const [showActive, setShowActive] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importResult, setImportResult] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterCategory) params.append('category', filterCategory)
      params.append('is_active', showActive ? 'true' : 'false')
      if (search) params.append('search', search)
      params.append('limit', '500')
      const res = await api({ method: 'GET', url: `/inventory/items?${params}` })
      setItems(res.data?.items || [])
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Не удалось загрузить'
      toast?.({ kind: 'error', text: String(msg) })
    } finally {
      setLoading(false)
    }
  }, [filterCategory, showActive, search, toast])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }
  const openEdit = (item) => {
    setEditing(item)
    setForm({
      sku: item.sku,
      name: item.name,
      category: item.category,
      unit: item.unit,
      barcode: item.barcode || '',
      vendor: item.vendor || '',
      cost_per_unit: String(item.cost_per_unit || '0'),
      min_stock_threshold: String(item.min_stock_threshold || '0'),
      expiry_tracked: !!item.expiry_tracked,
      notes: item.notes || '',
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    try {
      const payload = {
        ...form,
        cost_per_unit: form.cost_per_unit || '0',
        min_stock_threshold: form.min_stock_threshold || '0',
        barcode: form.barcode || null,
        vendor: form.vendor || null,
        notes: form.notes || null,
      }
      if (editing) {
        await api({ method: 'PATCH', url: `/inventory/items/${editing.id}`, data: payload })
        toast?.({ kind: 'success', text: 'Позиция обновлена' })
      } else {
        await api({ method: 'POST', url: '/inventory/items', data: payload })
        toast?.({ kind: 'success', text: 'Позиция создана' })
      }
      setModalOpen(false)
      load()
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Ошибка сохранения'
      toast?.({ kind: 'error', text: String(msg) })
    }
  }

  const handleDelete = async (item) => {
    if (!confirm(`Архивировать позицию «${item.name}»?`)) return
    try {
      await api({ method: 'DELETE', url: `/inventory/items/${item.id}` })
      toast?.({ kind: 'success', text: 'Архивировано' })
      load()
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Ошибка удаления'
      toast?.({ kind: 'error', text: String(msg) })
    }
  }

  const handleImport = async () => {
    if (!importFile) return
    try {
      const fd = new FormData()
      fd.append('file', importFile)
      const res = await api({
        method: 'POST',
        url: '/inventory/items/import-csv',
        data: fd,
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setImportResult(res.data)
      toast?.({ kind: 'success', text: `Импортировано: ${res.data.created}` })
      load()
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Ошибка импорта'
      toast?.({ kind: 'error', text: String(msg) })
    }
  }

  return (
    <div className="space-y-4">
      {/* Фильтры */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
        >
          <option value="">Все категории</option>
          {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm flex-1 min-w-[180px]"
          placeholder="Поиск по SKU / названию / штрихкоду…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
        />
        <label className="text-sm flex items-center gap-1.5">
          <input type="checkbox" checked={showActive} onChange={e => setShowActive(e.target.checked)} />
          Только активные
        </label>
        <Button onClick={openCreate}>+ Новая позиция</Button>
        <Button variant="ghost" onClick={() => setImportOpen(true)}>Импорт CSV</Button>
      </div>

      {/* Таблица */}
      <Card>
        {loading ? (
          <div className="p-6 text-center text-gray-400">Загрузка…</div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Каталог пуст"
            description="Добавьте первую позицию через кнопку «+ Новая позиция»"
          />
        ) : (
          <div className="overflow-x-auto admin-resp-table-wrap">
            <table className="admin-resp-table w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Название</th>
                  <th className="px-3 py-2">Категория</th>
                  <th className="px-3 py-2">Ед.</th>
                  <th className="px-3 py-2 text-right">Цена</th>
                  <th className="px-3 py-2 text-right">Мин. порог</th>
                  <th className="px-3 py-2">Срок</th>
                  <th className="px-3 py-2 w-[120px]">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {items.map(it => (
                  <tr key={it.id} className={it.is_active ? '' : 'opacity-50'}>
                    <td data-label="SKU" className="px-3 py-2 font-mono text-xs">{it.sku}</td>
                    <td data-label="Название" className="px-3 py-2">
                      <div className="font-medium">{it.name}</div>
                      {it.vendor && <div className="text-xs text-gray-500">{it.vendor}</div>}
                    </td>
                    <td data-label="Категория" className="px-3 py-2">
                      <Chip>{CAT_LABEL[it.category] || it.category}</Chip>
                    </td>
                    <td data-label="Ед." className="px-3 py-2">{it.unit}</td>
                    <td data-label="Цена" className="px-3 py-2 text-right tabular-nums">
                      {Number(it.cost_per_unit).toLocaleString('ru')} ₽
                    </td>
                    <td data-label="Мин. порог" className="px-3 py-2 text-right tabular-nums">
                      {Number(it.min_stock_threshold)}
                    </td>
                    <td data-label="Срок" className="px-3 py-2">
                      {it.expiry_tracked ? <Chip tone="warn">отслеж.</Chip> : '—'}
                    </td>
                    <td data-label="Действия" className="px-3 py-2 text-right">
                      <button
                        className="admin-tap-44 text-[#0097A7] hover:underline text-xs mr-2 px-2 py-2"
                        onClick={() => openEdit(it)}
                      >Изм.</button>
                      <button
                        className="admin-tap-44 text-red-600 hover:underline text-xs px-2 py-2"
                        onClick={() => handleDelete(it)}
                      >Архив</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Модалка create/edit */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Изменить «${editing.name}»` : 'Новая позиция'}
      >
        <div className="space-y-3 p-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">SKU *</label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                value={form.sku}
                onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Категория</label>
              <select
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              >
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Название *</label>
            <input
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Ед.</label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                value={form.unit}
                onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Цена за ед., ₽</label>
              <input
                type="number" step="0.01"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                value={form.cost_per_unit}
                onChange={e => setForm(f => ({ ...f, cost_per_unit: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Мин. порог</label>
              <input
                type="number" step="0.001"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                value={form.min_stock_threshold}
                onChange={e => setForm(f => ({ ...f, min_stock_threshold: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Штрихкод</label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                value={form.barcode}
                onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Поставщик</label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                value={form.vendor}
                onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.expiry_tracked}
              onChange={e => setForm(f => ({ ...f, expiry_tracked: e.target.checked }))}
            />
            Отслеживать срок годности
          </label>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Заметки</label>
            <textarea
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
              rows={2}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Отмена</Button>
            <Button onClick={handleSave}>{editing ? 'Сохранить' : 'Создать'}</Button>
          </div>
        </div>
      </Modal>

      {/* Модалка импорта */}
      <Modal
        open={importOpen}
        onClose={() => { setImportOpen(false); setImportFile(null); setImportResult(null) }}
        title="Импорт CSV"
      >
        <div className="space-y-3 p-1">
          <div className="text-sm text-gray-600 dark:text-gray-300">
            Колонки (header обязателен):<br />
            <code className="text-xs">sku,name,category,unit,barcode,vendor,cost_per_unit,min_stock_threshold,expiry_tracked,notes</code>
          </div>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={e => setImportFile(e.target.files?.[0] || null)}
          />
          {importResult && (
            <div className="text-sm space-y-1">
              <div>Создано: <b>{importResult.created}</b></div>
              <div>Пропущено (дубль SKU): <b>{importResult.skipped}</b></div>
              {importResult.errors?.length > 0 && (
                <div className="text-red-600 text-xs">
                  Ошибок: {importResult.errors.length}
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setImportOpen(false)}>Закрыть</Button>
            <Button onClick={handleImport} disabled={!importFile}>Загрузить</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
