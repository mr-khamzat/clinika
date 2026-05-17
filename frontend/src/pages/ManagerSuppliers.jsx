/**
 * ========================================
 * БЛОК: ManagerSuppliers — справочник поставщиков
 * ========================================
 * Этап 1 INVENTORY_COST_PLAN — фронт поверх backend /inventory/suppliers.
 *
 * Возможности:
 *   • Таблица: Название / ИНН / Контактное лицо / Телефон / Email
 *   • Поиск (debounced) по name
 *   • Кнопка «+ Добавить поставщика» → модалка-форма
 *   • Click по строке → редактирование
 *   • Soft-delete (is_active=false) через кнопку «Деактивировать»
 *   • Mobile: таблица превращается в карточки (<640px)
 *
 * API:
 *   GET    /inventory/suppliers?search=&is_active=
 *   POST   /inventory/suppliers
 *   PATCH  /inventory/suppliers/{id}
 *   DELETE /inventory/suppliers/{id}     — soft (is_active=false)
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import api from '../api'
import ManagerShell from './_ManagerShell'
import { Card, Button, EmptyState, Modal, useToast, Chip } from '../design'

// ─── Стиль для текстовых полей формы ───
const INPUT_STYLE = {
  width: '100%', padding: '9px 12px',
  border: '1px solid var(--border)', borderRadius: 10,
  background: 'var(--surface)', color: 'var(--fg)', fontSize: 13.5,
}

const EMPTY_FORM = {
  name: '', inn: '', contact_person: '', phone: '', email: '',
  payment_terms: '', notes: '',
}

export default function ManagerSuppliers() {
  const { toast } = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)        // null=новый, объект=правка
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (search.trim()) params.search = search.trim()
      if (!showInactive) params.is_active = true
      const r = await api.get('/inventory/suppliers', { params })
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось загрузить поставщиков', 'error')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [search, showInactive, toast])

  useEffect(() => { load() }, [load])

  // Дебаунс поиска
  useEffect(() => {
    const t = setTimeout(() => { load() }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }
  const openEdit = (s) => {
    setEditing(s)
    setForm({
      name: s.name || '', inn: s.inn || '', contact_person: s.contact_person || '',
      phone: s.phone || '', email: s.email || '',
      payment_terms: s.payment_terms || '', notes: s.notes || '',
    })
    setModalOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) {
      toast('Укажите название поставщика', 'error')
      return
    }
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        inn: form.inn.trim() || null,
        contact_person: form.contact_person.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        payment_terms: form.payment_terms.trim() || null,
        notes: form.notes.trim() || null,
      }
      if (editing) {
        await api.patch(`/inventory/suppliers/${editing.id}`, body)
        toast('Поставщик обновлён', 'success')
      } else {
        await api.post('/inventory/suppliers', body)
        toast('Поставщик добавлен', 'success')
      }
      setModalOpen(false)
      load()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось сохранить', 'error')
    } finally {
      setSaving(false)
    }
  }

  const deactivate = async (s) => {
    if (!confirm(`Деактивировать поставщика «${s.name}»? Его нельзя будет выбрать в новых приходах.`)) return
    try {
      await api.delete(`/inventory/suppliers/${s.id}`)
      toast('Поставщик деактивирован', 'success')
      load()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось деактивировать', 'error')
    }
  }

  const reactivate = async (s) => {
    try {
      await api.patch(`/inventory/suppliers/${s.id}`, { is_active: true })
      toast('Поставщик активирован', 'success')
      load()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось активировать', 'error')
    }
  }

  return (
    <ManagerShell
      active="suppliers"
      title="Поставщики"
      subtitle="Справочник контрагентов для приходов на склад"
      icon="business"
      topbarRight={
        <Button variant="primary" size="sm" onClick={openCreate}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
          Добавить
        </Button>
      }
    >
      {/* ─── Панель фильтров ─── */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 220 }}>
          <span
            className="material-symbols-outlined"
            style={{ position: 'absolute', left: 10, top: 9, fontSize: 18, color: 'var(--fg-3)' }}
          >search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию или ИНН"
            style={{ ...INPUT_STYLE, padding: '9px 12px 9px 34px' }}
          />
        </div>
        <label className="inline-flex items-center gap-2" style={{ fontSize: 13, color: 'var(--fg-2)' }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Показывать неактивных
        </label>
        <Button variant="primary" size="sm" onClick={openCreate} className="sm:hidden">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
          Добавить
        </Button>
      </div>

      {/* ─── Таблица / Карточки ─── */}
      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<span className="material-symbols-outlined" style={{ fontSize: 28 }}>business</span>}
            title="Поставщиков пока нет"
            message="Добавьте первого поставщика, чтобы оформлять приходы на склад."
            action={
              <Button variant="primary" onClick={openCreate}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
                Добавить поставщика
              </Button>
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-1)' }}>
                    <Th>Название</Th>
                    <Th>ИНН</Th>
                    <Th>Контакт</Th>
                    <Th>Телефон</Th>
                    <Th>Email</Th>
                    <Th style={{ textAlign: 'right' }}>Действия</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => (
                    <tr
                      key={s.id}
                      style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                      onClick={() => openEdit(s)}
                    >
                      <Td>
                        <div className="flex items-center gap-2">
                          <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{s.name}</span>
                          {!s.is_active && (
                            <Chip>неактивен</Chip>
                          )}
                        </div>
                      </Td>
                      <Td><code style={{ fontSize: 12 }}>{s.inn || '—'}</code></Td>
                      <Td>{s.contact_person || '—'}</Td>
                      <Td>{s.phone || '—'}</Td>
                      <Td>{s.email || '—'}</Td>
                      <Td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        {s.is_active ? (
                          <button
                            onClick={() => deactivate(s)}
                            className="inline-flex items-center gap-1 transition-transform active:scale-95"
                            style={{
                              padding: '5px 9px', borderRadius: 8, fontSize: 12,
                              background: 'transparent', border: '1px solid var(--border)',
                              color: 'var(--bad, #d4424b)',
                            }}
                            aria-label="Деактивировать"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>block</span>
                            Деактивировать
                          </button>
                        ) : (
                          <button
                            onClick={() => reactivate(s)}
                            className="inline-flex items-center gap-1 transition-transform active:scale-95"
                            style={{
                              padding: '5px 9px', borderRadius: 8, fontSize: 12,
                              background: 'transparent', border: '1px solid var(--border)',
                              color: 'var(--good, #1aa260)',
                            }}
                            aria-label="Активировать"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check_circle</span>
                            Активировать
                          </button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden flex flex-col gap-2 p-2">
              {items.map((s) => (
                <div
                  key={s.id}
                  onClick={() => openEdit(s)}
                  style={{
                    padding: 12, borderRadius: 12,
                    background: 'var(--bg-1)', border: '1px solid var(--border)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 14 }}>{s.name}</div>
                    {!s.is_active && <Chip>неактивен</Chip>}
                  </div>
                  {s.inn && <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>ИНН: <code>{s.inn}</code></div>}
                  {s.contact_person && <div style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>{s.contact_person}</div>}
                  {(s.phone || s.email) && (
                    <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4 }}>
                      {s.phone}{s.phone && s.email ? ' · ' : ''}{s.email}
                    </div>
                  )}
                  <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                    {s.is_active ? (
                      <Button variant="ghost" size="sm" onClick={() => deactivate(s)}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>block</span>
                        Деактивировать
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => reactivate(s)}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
                        Активировать
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* ─── Модалка формы ─── */}
      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editing ? `Редактировать: ${editing.name}` : 'Новый поставщик'}
        size="md"
        actions={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saving}>Отмена</Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Название *" full>
            <input
              type="text" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              style={INPUT_STYLE} autoFocus
            />
          </Field>
          <Field label="ИНН">
            <input
              type="text" value={form.inn} maxLength={12}
              onChange={(e) => setForm({ ...form, inn: e.target.value.replace(/[^\d]/g, '') })}
              style={INPUT_STYLE}
            />
          </Field>
          <Field label="Условия оплаты">
            <input
              type="text" value={form.payment_terms}
              onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
              placeholder="например, нал/счёт/14 дней"
              style={INPUT_STYLE}
            />
          </Field>
          <Field label="Контактное лицо">
            <input
              type="text" value={form.contact_person}
              onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
              style={INPUT_STYLE}
            />
          </Field>
          <Field label="Телефон">
            <input
              type="tel" value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              style={INPUT_STYLE}
            />
          </Field>
          <Field label="Email" full>
            <input
              type="email" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              style={INPUT_STYLE}
            />
          </Field>
          <Field label="Заметки" full>
            <textarea
              rows={3} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              style={{ ...INPUT_STYLE, resize: 'vertical', minHeight: 60 }}
            />
          </Field>
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
function Td({ children, style, onClick }) {
  return (
    <td style={{ padding: '10px 12px', color: 'var(--fg)', verticalAlign: 'middle', fontSize: 13, ...style }} onClick={onClick}>
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
