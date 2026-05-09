/**
 * ========================================
 * БЛОК: ManagerSettings (услуги — группы + создание/редактирование)
 * ========================================
 * Услуги управляющего по категориям (accordion), поиск, создание/редактирование.
 * Поля услуги: название, цена, бонус, категория, видимость в форме направления.
 * Бизнес-логика бонусов сохранена.
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import {
  listManagerServices,
  updateService,
  createService,
  deleteService,
} from '../api'
import { Card, Button, EmptyState, Modal, useToast } from '../design'
import ManagerShell from './_ManagerShell'

// ─── Хелперы ────────────────────────────────────────────────────────────────
const NO_CAT = 'Без категории'

// Группировка списка услуг → { 'Без категории': [...], 'Категория А': [...], ... }
function groupByCategory(list) {
  const groups = {}
  list.forEach(s => {
    const k = s.category || NO_CAT
    if (!groups[k]) groups[k] = []
    groups[k].push(s)
  })
  // Внутри группы — по названию
  Object.values(groups).forEach(arr => arr.sort((a, b) => a.name.localeCompare(b.name, 'ru')))
  return groups
}

// Список ключей категорий: «Без категории» сверху, остальные по алфавиту
function orderedCategoryKeys(groups) {
  const keys = Object.keys(groups)
  const noCat = keys.includes(NO_CAT) ? [NO_CAT] : []
  const rest = keys.filter(k => k !== NO_CAT).sort((a, b) => a.localeCompare(b, 'ru'))
  return [...noCat, ...rest]
}

// ─── Модалка создания / редактирования услуги ───────────────────────────────
function ServiceFormModal({ open, onClose, initial, categories, onSubmit, saving }) {
  const isEdit = !!initial?.id
  const [form, setForm] = useState(() => ({
    name: '', price: '', bonus_amount: '', category: '',
    visible_for_referrals: true, code: '',
  }))
  const [newCategory, setNewCategory] = useState(false)

  useEffect(() => {
    if (!open) return
    if (initial) {
      setForm({
        name: initial.name || '',
        price: initial.price != null ? String(initial.price) : '',
        bonus_amount: initial.bonus_amount != null ? String(initial.bonus_amount) : '',
        category: initial.category && initial.category !== NO_CAT ? initial.category : '',
        visible_for_referrals: initial.visible_for_referrals !== false,
        code: initial.code || '',
      })
      setNewCategory(false)
    } else {
      setForm({ name: '', price: '', bonus_amount: '', category: '', visible_for_referrals: true, code: '' })
      setNewCategory(false)
    }
  }, [open, initial])

  const submit = () => {
    if (!form.name.trim()) return
    onSubmit({
      name: form.name.trim(),
      code: form.code.trim() || null,
      price: form.price === '' ? null : parseFloat(form.price),
      bonus_amount: form.bonus_amount === '' ? 0 : parseFloat(form.bonus_amount) || 0,
      category: form.category.trim() || null,
      visible_for_referrals: !!form.visible_for_referrals,
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Редактирование услуги' : 'Новая услуга'}
      size="md"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} disabled={saving || !form.name.trim()}>
            {saving ? 'Сохранение…' : (isEdit ? 'Сохранить' : 'Создать')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Название *">
          <input
            autoFocus
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Например: Приём терапевта"
            className="ds-input"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Цена пациенту, ₽">
            <input
              type="number" min="0" step="0.01"
              value={form.price}
              onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
              placeholder="0"
              className="ds-input"
            />
          </Field>
          <Field label="Бонус сотруднику, Б">
            <input
              type="number" min="0" step="0.01"
              value={form.bonus_amount}
              onChange={e => setForm(f => ({ ...f, bonus_amount: e.target.value }))}
              placeholder="0"
              className="ds-input"
            />
          </Field>
        </div>

        <Field label="Категория">
          {newCategory ? (
            <div className="flex gap-2">
              <input
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                placeholder="Введите название категории"
                className="ds-input flex-1"
              />
              <Button variant="secondary" size="sm" onClick={() => { setNewCategory(false); setForm(f => ({ ...f, category: '' })) }}>
                Из списка
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <select
                value={form.category}
                onChange={e => {
                  if (e.target.value === '__new__') { setNewCategory(true); setForm(f => ({ ...f, category: '' })) }
                  else setForm(f => ({ ...f, category: e.target.value }))
                }}
                className="ds-input flex-1"
              >
                <option value="">— Без категории —</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__new__">+ Новая категория…</option>
              </select>
            </div>
          )}
        </Field>

        <Field label="Код (опционально)">
          <input
            value={form.code}
            onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
            placeholder="Внутренний код услуги"
            className="ds-input"
          />
        </Field>

        <label className="flex items-center gap-3 cursor-pointer select-none mt-2 px-2 py-3 rounded-xl"
          style={{ background: 'var(--bg-1)', border: '1px solid var(--line)' }}>
          <input
            type="checkbox"
            checked={!!form.visible_for_referrals}
            onChange={e => setForm(f => ({ ...f, visible_for_referrals: e.target.checked }))}
            className="w-5 h-5"
          />
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--fg)' }}>Видна при создании направления</p>
            <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
              Если выключено — партнёр / админ не увидит услугу в форме направления.
            </p>
          </div>
        </label>
      </div>

      <style>{`
        .ds-input {
          width: 100%;
          background: var(--bg-1);
          border: 1px solid var(--border);
          border-radius: 9px;
          padding: 8px 12px;
          font-size: 14px;
          color: var(--fg);
          outline: none;
        }
        .ds-input:focus { border-color: var(--accent); }
      `}</style>
    </Modal>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1.5"
        style={{ color: 'var(--fg-muted)' }}>{label}</label>
      {children}
    </div>
  )
}

// ─── Страница ───────────────────────────────────────────────────────────────
export default function ManagerSettings() {
  const { toast } = useToast()
  const [services, setServices]           = useState([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState('')
  const [search, setSearch]               = useState('')
  const [expanded, setExpanded]           = useState({})       // { 'Категория': true/false }
  const [editing, setEditing]             = useState(null)     // null | { ...service } | 'new'
  const [saving, setSaving]               = useState(false)

  // Загрузка
  const reload = async () => {
    setLoading(true)
    try {
      const r = await listManagerServices()
      setServices(Array.isArray(r.data) ? r.data : [])
    } catch {
      setError('Ошибка загрузки услуг')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { reload() }, [])

  // Фильтр по поиску
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return services
    return services.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q) ||
      (s.code || '').toLowerCase().includes(q)
    )
  }, [services, search])

  const groups = useMemo(() => groupByCategory(filtered), [filtered])
  const orderedKeys = useMemo(() => orderedCategoryKeys(groups), [groups])
  const allCategories = useMemo(() => {
    const set = new Set()
    services.forEach(s => { if (s.category && s.category !== NO_CAT) set.add(s.category) })
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'))
  }, [services])

  // При активном поиске разворачиваем все группы автоматически
  const isExpanded = (k) => {
    if (search.trim()) return true
    return !!expanded[k]
  }

  const toggle = (k) => setExpanded(e => ({ ...e, [k]: !e[k] }))
  const expandAll = () => {
    const next = {}
    orderedKeys.forEach(k => { next[k] = true })
    setExpanded(next)
  }
  const collapseAll = () => setExpanded({})

  // Save (create / update)
  const handleSubmit = async (data) => {
    setSaving(true)
    try {
      if (editing && editing !== 'new') {
        await updateService(editing.id, data)
        toast('Услуга обновлена', 'success')
      } else {
        await createService(data)
        toast('Услуга создана', 'success')
      }
      setEditing(null)
      await reload()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Ошибка сохранения', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Inline-обновление бонуса (без модалки)
  const handleBonusInline = async (svc, value) => {
    try {
      await updateService(svc.id, { bonus_amount: parseFloat(value) || 0 })
      setServices(list => list.map(s => s.id === svc.id ? { ...s, bonus_amount: parseFloat(value) || 0 } : s))
    } catch {
      toast('Ошибка сохранения бонуса', 'error')
    }
  }

  // Toggle visibility for referrals (без модалки, прямо из списка)
  const handleToggleVisible = async (svc) => {
    const next = !svc.visible_for_referrals
    setServices(list => list.map(s => s.id === svc.id ? { ...s, visible_for_referrals: next } : s))
    try {
      await updateService(svc.id, { visible_for_referrals: next })
    } catch {
      toast('Ошибка обновления видимости', 'error')
      setServices(list => list.map(s => s.id === svc.id ? { ...s, visible_for_referrals: !next } : s))
    }
  }

  const handleDelete = async (svc) => {
    if (!confirm(`Деактивировать услугу «${svc.name}»?`)) return
    try {
      await deleteService(svc.id)
      toast('Услуга деактивирована', 'success')
      setServices(list => list.filter(s => s.id !== svc.id))
    } catch {
      toast('Ошибка', 'error')
    }
  }

  return (
    <ManagerShell
      active="settings"
      title="Настройки"
      subtitle="Услуги, бонусы и интеграции"
      icon="tune"
    >
      {loading ? (
        <Card>
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin"
              style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        </Card>
      ) : (
        <>
          {error && (
            <div className="mb-4 rounded-xl p-3"
              style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)', color: 'var(--bad)' }}>
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* Инфо */}
          <Card className="mb-4" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }}>
            <div className="flex gap-3">
              <span className="inline-grid place-items-center flex-shrink-0"
                style={{ width: 32, height: 32, borderRadius: 9, background: 'oklch(1 0 0 / 0.6)', color: 'var(--accent)' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>info</span>
              </span>
              <p className="text-sm" style={{ color: 'var(--accent)' }}>
                Каждая услуга может иметь цену пациенту, бонус сотруднику и видимость в форме направления.
                Настройки МИС и Telegram доступны в панели администратора.
              </p>
            </div>
          </Card>

          {/* Управление услугами */}
          <Card padded={false}>
            {/* Заголовок + действия */}
            <div className="p-4 pb-3" style={{ borderBottom: '1px solid var(--line)' }}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <Card.Title>Услуги</Card.Title>
                  <Card.Subtitle>
                    {services.length} {services.length === 1 ? 'услуга' : 'услуг'} в {orderedCategoryKeys(groupByCategory(services)).length} категориях
                  </Card.Subtitle>
                </div>
                <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
                  + Новая
                </Button>
              </div>

              {/* Поиск + развернуть/свернуть */}
              <div className="flex gap-2 items-center">
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ fontSize: 18, color: 'var(--fg-muted)' }}>search</span>
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Поиск по названию, категории, коду…"
                    className="w-full text-sm outline-none"
                    style={{
                      background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 9,
                      padding: '8px 10px 8px 36px', color: 'var(--fg)',
                    }}
                  />
                </div>
                <Button variant="secondary" size="sm" onClick={expandAll}>Развернуть всё</Button>
                <Button variant="secondary" size="sm" onClick={collapseAll}>Свернуть</Button>
              </div>
            </div>

            {/* Список групп */}
            {services.length === 0 ? (
              <EmptyState
                icon={<span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>sell</span>}
                title="Нет услуг"
                message='Создайте первую услугу через кнопку «+ Новая».'
              />
            ) : orderedKeys.length === 0 ? (
              <EmptyState
                icon={<span className="material-symbols-outlined" style={{ fontSize: 28 }}>search_off</span>}
                title="Ничего не найдено"
                message="Попробуйте изменить запрос."
              />
            ) : (
              <div>
                {orderedKeys.map((k, gi) => {
                  const list = groups[k]
                  const open = isExpanded(k)
                  return (
                    <div key={k} style={{ borderBottom: gi < orderedKeys.length - 1 ? '1px solid var(--line)' : 'none' }}>
                      <button
                        type="button"
                        onClick={() => toggle(k)}
                        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-[var(--bg-1)] transition"
                        style={{ textAlign: 'left' }}
                      >
                        <span className="material-symbols-outlined"
                          style={{
                            fontSize: 20,
                            color: 'var(--fg-muted)',
                            transform: open ? 'rotate(90deg)' : 'none',
                            transition: 'transform 0.15s',
                          }}>
                          chevron_right
                        </span>
                        <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--fg)' }}>{k}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: 'var(--bg-1)', color: 'var(--fg-muted)' }}>
                          {list.length}
                        </span>
                      </button>

                      {open && list.map((svc, i) => (
                        <ServiceRow
                          key={svc.id}
                          svc={svc}
                          last={i === list.length - 1}
                          onEdit={() => setEditing(svc)}
                          onDelete={() => handleDelete(svc)}
                          onBonus={(v) => handleBonusInline(svc, v)}
                          onToggleVisible={() => handleToggleVisible(svc)}
                        />
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </>
      )}

      <ServiceFormModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        initial={editing && editing !== 'new' ? editing : null}
        categories={allCategories}
        onSubmit={handleSubmit}
        saving={saving}
      />
    </ManagerShell>
  )
}

// Строка услуги (с inline-полем бонуса и иконками действий)
function ServiceRow({ svc, last, onEdit, onDelete, onBonus, onToggleVisible }) {
  const [bonus, setBonus] = useState(svc.bonus_amount != null ? String(svc.bonus_amount) : '')
  useEffect(() => { setBonus(svc.bonus_amount != null ? String(svc.bonus_amount) : '') }, [svc.bonus_amount])

  const commitBonus = () => {
    const v = parseFloat(bonus) || 0
    if (v !== Number(svc.bonus_amount)) onBonus(v)
  }

  return (
    <div
      className="flex items-center gap-2 px-4 py-2.5 pl-10"
      style={{ borderTop: '1px dashed var(--line)' }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{svc.name}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {svc.price != null && (
            <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
              {Number(svc.price).toLocaleString('ru-RU')} ₽
            </span>
          )}
          {svc.code && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono"
              style={{ background: 'var(--bg-1)', color: 'var(--fg-muted)' }}>{svc.code}</span>
          )}
        </div>
      </div>

      {/* Видимость в направлении */}
      <button
        type="button"
        onClick={onToggleVisible}
        title={svc.visible_for_referrals ? 'Видна в форме направления — выключить' : 'Скрыта от формы направления — включить'}
        className="inline-grid place-items-center w-8 h-8 rounded-lg transition hover:bg-[var(--bg-1)]"
        style={{ color: svc.visible_for_referrals ? 'var(--good)' : 'var(--fg-muted)' }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: svc.visible_for_referrals ? "'FILL' 1" : "'FILL' 0" }}>
          {svc.visible_for_referrals ? 'visibility' : 'visibility_off'}
        </span>
      </button>

      {/* Inline-бонус */}
      <input
        type="number"
        value={bonus}
        onChange={e => setBonus(e.target.value)}
        onBlur={commitBonus}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
        className="text-sm w-20 text-right outline-none"
        style={{
          background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 9,
          padding: '6px 8px', color: 'var(--fg)', fontVariantNumeric: 'tabular-nums',
        }}
        placeholder="Б"
        title="Бонус сотруднику"
      />

      <button type="button" onClick={onEdit}
        className="inline-grid place-items-center w-8 h-8 rounded-lg transition hover:bg-[var(--bg-1)]"
        style={{ color: 'var(--fg-muted)' }} title="Редактировать">
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
      </button>
      <button type="button" onClick={onDelete}
        className="inline-grid place-items-center w-8 h-8 rounded-lg transition hover:bg-[var(--bg-1)]"
        style={{ color: 'var(--bad)' }} title="Деактивировать">
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete_outline</span>
      </button>
    </div>
  )
}
