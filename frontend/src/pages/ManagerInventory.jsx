/**
 * ========================================
 * БЛОК: ManagerInventory — страница «Склад» в кабинете управляющего
 * ========================================
 *   • Таблица позиций inventory_items (SKU / Название / Категория / Ед. / Остаток / Цена)
 *   • Поиск по названию / SKU
 *   • Создание / редактирование позиции вручную (для клиник без 1С)
 *   • Удаление (DELETE /inventory/items/{id})
 *   • Импорт из 1С (Excel/CSV) — для клиник с 1С
 *
 * API:
 *   GET    /inventory/items?search=...
 *   POST   /inventory/items
 *   PATCH  /inventory/items/{id}
 *   DELETE /inventory/items/{id}
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import api from '../api'
import ManagerShell from './_ManagerShell'
import { Card, Button, EmptyState, Modal } from '../design'
import InventoryImportWizard from '../components/inventory/InventoryImportWizard'

const PAGE_SIZE = 50

function fmtMoney(v) {
  if (v == null || v === '') return '—'
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(Number(v))
  } catch { return String(v) }
}

const CATEGORIES = [
  { value: 'consumable', label: 'Расходник',    icon: 'medical_services',     hint: 'Перчатки, шприцы, бахилы, салфетки и т.п.' },
  { value: 'medication', label: 'Медикамент',   icon: 'vaccines',             hint: 'Лекарства, анестетики (со сроком годности)' },
  { value: 'reagent',    label: 'Реагент',      icon: 'science',              hint: 'Реактивы для лаборатории' },
  { value: 'equipment',  label: 'Оборудование', icon: 'precision_manufacturing', hint: 'Стерилизатор, УЗИ-датчики и т.п.' },
  { value: 'other',      label: 'Прочее',       icon: 'category',             hint: 'Всё остальное' },
]
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]))
// На бэке enum хранится lowercase, старые данные могли быть UPPER
const NORM_CAT = (c) => (c || '').toLowerCase()

// ─── Поле формы ─────────────────────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, type = 'text', required = false }) {
  return (
    <div className="mb-3">
      <label className="block mb-1.5" style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}{required && ' *'}
      </label>
      <input
        type={type} value={value ?? ''} onChange={onChange} placeholder={placeholder}
        className="w-full text-sm outline-none"
        style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', color: 'var(--fg)' }}
      />
    </div>
  )
}

// ─── ItemModal: создание / редактирование позиции ───────────────────────────
function ItemModal({ item, onClose, onSaved }) {
  const isEdit = !!item?.id
  const [form, setForm] = useState({
    name:                 item?.name || '',
    sku:                  item?.sku || '',
    category:             NORM_CAT(item?.category) || 'consumable',
    unit:                 item?.unit || 'шт',
    cost_per_unit:        item?.cost_per_unit ?? '',
    min_stock_threshold:  item?.min_stock_threshold ?? '',
    vendor:               item?.vendor || '',
    barcode:              item?.barcode || '',
    expiry_tracked:       !!item?.expiry_tracked,
    photo_url:            item?.photo_url || '',
    description:          item?.description || '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const save = async () => {
    if (!form.name.trim()) { setError('Введите название'); return }
    setLoading(true); setError('')
    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        category: form.category,
        unit: form.unit.trim() || 'шт',
        cost_per_unit: form.cost_per_unit === '' ? null : Number(form.cost_per_unit),
        min_stock_threshold: form.min_stock_threshold === '' ? null : Number(form.min_stock_threshold),
        vendor: form.vendor.trim() || null,
        barcode: form.barcode.trim() || null,
        expiry_tracked: !!form.expiry_tracked,
        photo_url: form.photo_url.trim() || null,
        description: form.description.trim() || null,
      }
      if (isEdit) {
        await api.patch(`/inventory/items/${item.id}`, payload)
      } else {
        await api.post('/inventory/items', payload)
      }
      onSaved?.()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Ошибка сохранения')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={true} onClose={onClose} size="md"
      title={isEdit ? 'Изменить позицию' : 'Новая позиция склада'}
      actions={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>Отмена</Button>
          <Button variant="primary" size="md" onClick={save} disabled={loading}>
            {loading ? '…' : (isEdit ? 'Сохранить' : 'Создать')}
          </Button>
        </>
      }
    >
      {error && (
        <div className="rounded-lg p-2.5 mb-3 text-sm"
             style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)', color: 'var(--bad)' }}>
          {error}
        </div>
      )}

      {/* Категория */}
      <div className="mb-4">
        <label className="block mb-2" style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Категория *
        </label>
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map(c => {
            const on = form.category === c.value
            return (
              <button
                key={c.value} type="button"
                onClick={() => set('category', c.value)}
                className="text-left transition-colors"
                style={{
                  padding: '10px 12px', borderRadius: 10,
                  background: on ? 'var(--accent-soft)' : 'var(--surface)',
                  border: `1px solid ${on ? 'var(--accent-line)' : 'var(--border)'}`,
                  color: on ? 'var(--accent)' : 'var(--fg)',
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{c.icon}</span>
                  <span className="text-sm font-semibold">{c.label}</span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--fg-3)', opacity: 0.8 }}>{c.hint}</div>
              </button>
            )
          })}
        </div>
      </div>

      <Field label="Название" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Перчатки нитриловые, размер L" required />
      <div className="grid grid-cols-2 gap-3">
        <Field label="SKU / артикул" value={form.sku} onChange={e => set('sku', e.target.value)} placeholder="GLV-NIT-L" />
        <Field label="Ед. изм." value={form.unit} onChange={e => set('unit', e.target.value)} placeholder="шт / мл / г / упак" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Цена за ед., ₽" type="number" value={form.cost_per_unit} onChange={e => set('cost_per_unit', e.target.value)} placeholder="8" />
        <Field label="Мин. остаток (для алерта)" type="number" value={form.min_stock_threshold} onChange={e => set('min_stock_threshold', e.target.value)} placeholder="20" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Поставщик / вендор" value={form.vendor} onChange={e => set('vendor', e.target.value)} placeholder="ООО «Медснаб»" />
        <Field label="Штрих-код" value={form.barcode} onChange={e => set('barcode', e.target.value)} placeholder="4607000000000" />
      </div>

      {/* expiry_tracked */}
      <label className="flex items-center gap-2 mb-3" style={{ cursor: 'pointer', userSelect: 'none' }}>
        <input
          type="checkbox" checked={form.expiry_tracked}
          onChange={e => set('expiry_tracked', e.target.checked)}
          style={{ width: 16, height: 16, accentColor: '#0097A7' }}
        />
        <span style={{ fontSize: 13, color: 'var(--fg)' }}>Отслеживать срок годности (для медикаментов и реагентов)</span>
      </label>

      <Field label="Ссылка на фото (опц.)" value={form.photo_url} onChange={e => set('photo_url', e.target.value)} placeholder="https://..." />
      <div className="mb-1">
        <label className="block mb-1.5" style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Описание / заметка
        </label>
        <textarea
          value={form.description}
          onChange={e => set('description', e.target.value)}
          rows={3}
          placeholder="Произвольный комментарий"
          style={{
            width: '100%', resize: 'vertical',
            background: 'var(--bg-1)', border: '1px solid var(--border)',
            borderRadius: 9, padding: '9px 12px', color: 'var(--fg)',
            fontSize: 13.5, outline: 'none', fontFamily: 'inherit',
          }}
        />
      </div>
    </Modal>
  )
}

// ─── Основной компонент ─────────────────────────────────────────────────────
export default function ManagerInventory() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editItem, setEditItem] = useState(null)  // null | {} | {id, ...}

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE }
      if (search.trim()) params.search = search.trim()
      const r = await api.get('/inventory/items', { params })
      if (Array.isArray(r.data)) {
        setItems(r.data); setTotal(r.data.length)
      } else {
        setItems(Array.isArray(r.data?.items) ? r.data.items : [])
        setTotal(Number(r.data?.total ?? 0))
      }
    } catch {
      setItems([]); setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [search, page])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setTimeout(() => { setPage(0); load() }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const filtered = categoryFilter === 'all'
    ? items
    : items.filter(it => NORM_CAT(it.category) === categoryFilter)

  const hasMore = items.length === PAGE_SIZE || (total > (page + 1) * PAGE_SIZE)

  const remove = async (it) => {
    if (!window.confirm(`Удалить позицию «${it.name}»?\nДвижения и партии сохранятся в истории.`)) return
    try {
      await api.delete(`/inventory/items/${it.id}`)
      load()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Не удалось удалить')
    }
  }

  return (
    <ManagerShell
      active="inventory"
      title="Склад"
      subtitle="Учёт расходников и оборудования по клиникам"
      icon="inventory_2"
      topbarRight={
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => setEditItem({})}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
            Добавить
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setWizardOpen(true)}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>upload_file</span>
            Импорт из 1С
          </Button>
        </div>
      }
    >
      {/* Mobile buttons */}
      <div className="mb-3 sm:hidden flex gap-2">
        <Button variant="primary" size="md" className="flex-1" onClick={() => setEditItem({})}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
          Добавить
        </Button>
        <Button variant="secondary" size="md" className="flex-1" onClick={() => setWizardOpen(true)}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>upload_file</span>
          Из 1С
        </Button>
      </div>

      {/* Поиск */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 220 }}>
          <span className="material-symbols-outlined" style={{ position: 'absolute', left: 10, top: 8, fontSize: 18, color: 'var(--fg-3)' }}>search</span>
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию или SKU"
            style={{
              width: '100%', padding: '8px 12px 8px 34px',
              border: '1px solid var(--border)', borderRadius: 10,
              background: 'var(--surface)', color: 'var(--fg)', fontSize: 13.5,
            }}
          />
        </div>
      </div>

      {/* Чипы категорий */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => setCategoryFilter('all')}
          className="text-xs font-semibold transition-colors"
          style={{
            padding: '6px 12px', borderRadius: 999,
            background: categoryFilter === 'all' ? 'var(--accent-soft)' : 'var(--surface)',
            color: categoryFilter === 'all' ? 'var(--accent)' : 'var(--fg-3)',
            border: `1px solid ${categoryFilter === 'all' ? 'var(--accent-line)' : 'var(--border)'}`,
          }}
        >Все · {items.length}</button>
        {CATEGORIES.map(c => {
          const count = items.filter(it => NORM_CAT(it.category) === c.value).length
          if (count === 0 && categoryFilter !== c.value) return null
          const on = categoryFilter === c.value
          return (
            <button
              key={c.value} onClick={() => setCategoryFilter(c.value)}
              className="text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
              style={{
                padding: '6px 12px', borderRadius: 999,
                background: on ? 'var(--accent-soft)' : 'var(--surface)',
                color: on ? 'var(--accent)' : 'var(--fg-3)',
                border: `1px solid ${on ? 'var(--accent-line)' : 'var(--border)'}`,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{c.icon}</span>
              {c.label} · {count}
            </button>
          )
        })}
      </div>

      {/* Таблица */}
      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="inventory_2"
            title={search || categoryFilter !== 'all' ? 'Ничего не найдено' : 'Склад пуст'}
            description={search || categoryFilter !== 'all'
              ? 'Попробуйте изменить поиск или фильтр.'
              : 'Добавьте первую позицию вручную или импортируйте остатки из 1С.'}
            action={!search && categoryFilter === 'all' ? (
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => setEditItem({})}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
                  Добавить вручную
                </Button>
                <Button variant="secondary" onClick={() => setWizardOpen(true)}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>upload_file</span>
                  Импорт из 1С
                </Button>
              </div>
            ) : null}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-1)' }}>
                  <Th>SKU</Th>
                  <Th>Название</Th>
                  <Th>Категория</Th>
                  <Th>Ед.</Th>
                  <Th style={{ textAlign: 'right' }}>Остаток</Th>
                  <Th style={{ textAlign: 'right' }}>Цена</Th>
                  <Th style={{ textAlign: 'right' }}></Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => (
                  <tr key={it.id || it.sku} style={{ borderTop: '1px solid var(--border)' }}>
                    <Td><code style={{ fontSize: 12 }}>{it.sku || '—'}</code></Td>
                    <Td>{it.name || '—'}</Td>
                    <Td>{CATEGORY_LABEL[NORM_CAT(it.category)] || it.category || '—'}</Td>
                    <Td>{it.unit || '—'}</Td>
                    <Td style={{ textAlign: 'right' }}>{it.quantity ?? it.stock ?? 0}</Td>
                    <Td style={{ textAlign: 'right' }}>{fmtMoney(it.cost_per_unit ?? it.cost_price ?? it.price)}</Td>
                    <Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => setEditItem(it)}
                        title="Изменить"
                        style={{
                          width: 30, height: 30, borderRadius: 7, border: 0,
                          background: 'var(--bg-1)', color: 'var(--fg-2)',
                          cursor: 'pointer', display: 'inline-grid', placeItems: 'center',
                          marginRight: 4,
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span>
                      </button>
                      <button
                        onClick={() => remove(it)}
                        title="Удалить"
                        style={{
                          width: 30, height: 30, borderRadius: 7, border: 0,
                          background: 'rgba(220, 38, 38, 0.08)', color: '#dc2626',
                          cursor: 'pointer', display: 'inline-grid', placeItems: 'center',
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between mt-3" style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
            <div>Страница {page + 1}{total ? ` · всего ${total}` : ''}</div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>← Назад</Button>
              <Button variant="secondary" size="sm" disabled={!hasMore} onClick={() => setPage(p => p + 1)}>Вперёд →</Button>
            </div>
          </div>
        )}
      </Card>

      {/* Модалки */}
      {editItem !== null && (
        <ItemModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => { setEditItem(null); load() }}
        />
      )}
      <InventoryImportWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onDone={() => { setPage(0); load() }}
      />
    </ManagerShell>
  )
}

function Th({ children, style }) {
  return (
    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--fg-3)', fontWeight: 600, fontSize: 12, ...style }}>{children}</th>
  )
}
function Td({ children, style }) {
  return (
    <td style={{ padding: '9px 12px', color: 'var(--fg)', verticalAlign: 'middle', ...style }}>{children}</td>
  )
}
