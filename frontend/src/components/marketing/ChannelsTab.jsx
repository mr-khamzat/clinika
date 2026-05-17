/**
 * ========================================
 * БЛОК: ChannelsTab — справочник маркетинговых каналов
 * ========================================
 * Системные каналы (is_system=true) можно только активировать/деактивировать.
 * Tenant-каналы (is_system=false) — полный CRUD.
 *
 * API:
 *   GET    /marketing/channels
 *   POST   /marketing/channels                 (только tenant-каналы)
 *   PATCH  /marketing/channels/{id}
 *   DELETE /marketing/channels/{id}            (только tenant-каналы)
 *
 * Структура channel:
 *   { id, tenant_id (null=system), code, name, icon (material symbol),
 *     is_system, is_active, sort_order }
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import api from '../../api'
import {
  Card, Button, EmptyState, Modal, useToast, useConfirm,
} from '../../design'

// Иконки, которые предлагаем выбрать для tenant-канала
const ICON_PRESETS = [
  'campaign', 'photo_camera', 'group', 'send', 'search',
  'thumb_up', 'public', 'storefront', 'help',
  'ads_click', 'share', 'language', 'mail', 'phone',
  'newspaper', 'movie', 'podcasts', 'tv', 'qr_code_2',
]

export default function ChannelsTab() {
  const { toast } = useToast()
  const { confirm, ConfirmHost } = useConfirm()

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/marketing/channels')
      setItems(Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.items) ? r.data.items : []))
    } catch (_) {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ─── Toggle is_active (доступно для всех, включая системные) ───
  const toggleActive = useCallback(async (ch) => {
    try {
      await api.patch(`/marketing/channels/${ch.id}`, { is_active: !ch.is_active })
      toast(ch.is_active ? 'Канал деактивирован' : 'Канал активирован', 'success')
      load()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось обновить', 'error')
    }
  }, [load, toast])

  // ─── Удаление (только tenant-каналы) ───
  const onDelete = useCallback(async (ch) => {
    if (ch.is_system) {
      toast('Системные каналы нельзя удалить', 'error')
      return
    }
    const ok = await confirm(
      `Удалить канал «${ch.name}»? Связанные записи расходов и атрибуции потеряют ссылку на канал.`,
      { danger: true, okText: 'Удалить', title: 'Удалить канал?' },
    )
    if (!ok) return
    try {
      await api.delete(`/marketing/channels/${ch.id}`)
      toast('Канал удалён', 'success')
      load()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось удалить', 'error')
    }
  }, [confirm, load, toast])

  return (
    <div className="flex flex-col gap-4">
      <ConfirmHost />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
          Системные каналы доступны всем тенантам. Свои каналы можно создавать и удалять.
        </div>
        <Button variant="primary" onClick={() => { setEditing(null); setModalOpen(true) }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
          Добавить свой канал
        </Button>
      </div>

      <Card padded={false}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin"
              style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        ) : items.length === 0 ? (
          <div className="py-6">
            <EmptyState
              icon={<span className="material-symbols-outlined" style={{ fontSize: 24 }}>campaign</span>}
              title="Нет каналов"
              message="Системные каналы должны были создаться автоматически. Обратитесь к админу."
            />
          </div>
        ) : (
          <>
            {/* Desktop: таблица */}
            <div className="hidden sm:block" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-1)' }}>
                    <Th style={{ width: 56 }}>Иконка</Th>
                    <Th>Код</Th>
                    <Th>Название</Th>
                    <Th>Активен</Th>
                    <Th>Тип</Th>
                    <Th style={{ width: 120 }}>{''}</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(ch => (
                    <tr key={ch.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <Td>
                        <span
                          className="inline-grid place-items-center"
                          style={{
                            width: 32, height: 32, borderRadius: 8,
                            background: 'var(--accent-soft)', color: 'var(--accent)',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
                            {ch.icon || 'campaign'}
                          </span>
                        </span>
                      </Td>
                      <Td>
                        <code style={{ fontSize: 12, color: 'var(--fg-3)' }}>{ch.code}</code>
                      </Td>
                      <Td style={{ fontWeight: 600 }}>{ch.name}</Td>
                      <Td>
                        <Switch checked={!!ch.is_active} onChange={() => toggleActive(ch)} />
                      </Td>
                      <Td>
                        {ch.is_system ? (
                          <span style={badgeStyle('var(--bg-2)', 'var(--fg-2)')}>Системный</span>
                        ) : (
                          <span style={badgeStyle('var(--accent-soft)', 'var(--accent)')}>Свой</span>
                        )}
                      </Td>
                      <Td>
                        <div className="flex gap-1">
                          {!ch.is_system && (
                            <>
                              <IconBtn icon="edit" title="Редактировать"
                                onClick={() => { setEditing(ch); setModalOpen(true) }} />
                              <IconBtn icon="delete" title="Удалить" danger
                                onClick={() => onDelete(ch)} />
                            </>
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: карточки */}
            <div className="sm:hidden flex flex-col gap-2 p-3">
              {items.map(ch => (
                <div
                  key={ch.id}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: 12,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="inline-grid place-items-center flex-shrink-0"
                      style={{
                        width: 36, height: 36, borderRadius: 9,
                        background: 'var(--accent-soft)', color: 'var(--accent)',
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
                        {ch.icon || 'campaign'}
                      </span>
                    </span>
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{ch.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                        <code>{ch.code}</code> · {ch.is_system ? 'Системный' : 'Свой'}
                      </div>
                    </div>
                    <Switch checked={!!ch.is_active} onChange={() => toggleActive(ch)} />
                  </div>
                  {!ch.is_system && (
                    <div className="flex gap-2 mt-3">
                      <Button variant="secondary" size="sm"
                        onClick={() => { setEditing(ch); setModalOpen(true) }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>edit</span>
                        Изменить
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onDelete(ch)}>
                        <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'var(--bad)' }}>delete</span>
                        <span style={{ color: 'var(--bad)' }}>Удалить</span>
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* ─── Модалка добавления/редактирования tenant-канала ─── */}
      <ChannelModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editing}
        onSaved={() => { setModalOpen(false); load() }}
      />
    </div>
  )
}

// ════════════════════════════════════════════════════
// БЛОК: модалка создания/редактирования tenant-канала
// ════════════════════════════════════════════════════
function ChannelModal({ open, onClose, editing, onSaved }) {
  const { toast } = useToast()
  const isEdit = !!editing

  const [form, setForm] = useState({ code: '', name: '', icon: 'campaign', is_active: true })
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (!open) return
    if (editing) {
      setForm({
        code: editing.code || '',
        name: editing.name || '',
        icon: editing.icon || 'campaign',
        is_active: editing.is_active !== false,
      })
    } else {
      setForm({ code: '', name: '', icon: 'campaign', is_active: true })
    }
    setErrors({})
  }, [open, editing])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const validate = () => {
    const e = {}
    if (!form.code.trim()) e.code = 'Укажите код (латиница, snake_case)'
    else if (!/^[a-z][a-z0-9_]*$/.test(form.code.trim())) {
      e.code = 'Только латиница, цифры и _; начинается с буквы'
    }
    if (!form.name.trim()) e.name = 'Укажите название'
    if (!form.icon.trim()) e.icon = 'Укажите иконку'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const onSubmit = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        icon: form.icon.trim(),
        is_active: form.is_active,
      }
      if (isEdit) {
        // Системные нельзя редактировать кроме is_active — но сюда они и не попадают
        await api.patch(`/marketing/channels/${editing.id}`, payload)
        toast('Канал обновлён', 'success')
      } else {
        await api.post('/marketing/channels', payload)
        toast('Канал создан', 'success')
      }
      onSaved && onSaved()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось сохранить', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Редактировать канал' : 'Добавить свой канал'}
      size="md"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={onSubmit} disabled={saving}>
            {saving ? 'Сохранение…' : (isEdit ? 'Сохранить' : 'Создать')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Код" required error={errors.code} hint="Латиница, snake_case. Используется в API и UTM.">
          <input
            type="text"
            value={form.code}
            onChange={e => setField('code', e.target.value.toLowerCase())}
            placeholder="например: partner_aggregator"
            style={inputStyle()}
            disabled={isEdit}
          />
        </Field>

        <Field label="Название" required error={errors.name}>
          <input
            type="text"
            value={form.name}
            onChange={e => setField('name', e.target.value)}
            placeholder="Например: Партнёр-агрегатор"
            style={inputStyle()}
          />
        </Field>

        <Field label="Иконка (Material Symbol)" required error={errors.icon}>
          <input
            type="text"
            value={form.icon}
            onChange={e => setField('icon', e.target.value)}
            placeholder="campaign"
            style={inputStyle()}
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {ICON_PRESETS.map(ic => (
              <button
                key={ic}
                type="button"
                onClick={() => setField('icon', ic)}
                title={ic}
                className="inline-grid place-items-center transition-transform active:scale-90"
                style={{
                  width: 32, height: 32, borderRadius: 7,
                  background: form.icon === ic ? 'var(--accent-soft)' : 'var(--bg-1)',
                  border: '1px solid ' + (form.icon === ic ? 'var(--accent)' : 'var(--border)'),
                  color: form.icon === ic ? 'var(--accent)' : 'var(--fg-2)',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}>
                  {ic}
                </span>
              </button>
            ))}
          </div>
        </Field>

        <label className="flex items-center gap-2" style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={e => setField('is_active', e.target.checked)}
          />
          <span>Канал активен</span>
        </label>
      </div>
    </Modal>
  )
}

// ════════════════════════════════════════════════════
// БЛОК: вспомогательные компоненты
// ════════════════════════════════════════════════════
function Field({ label, required, error, hint, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600 }}>
        {label}{required && <span style={{ color: 'var(--bad)' }}> *</span>}
      </span>
      {children}
      {hint && !error && <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{hint}</span>}
      {error && <span style={{ fontSize: 11, color: 'var(--bad)' }}>{error}</span>}
    </label>
  )
}
function Switch({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      className="transition-colors"
      style={{
        width: 38, height: 22, borderRadius: 999,
        background: checked ? 'var(--accent)' : 'var(--bg-3)',
        border: '1px solid ' + (checked ? 'var(--accent)' : 'var(--border)'),
        position: 'relative',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 1, left: checked ? 17 : 1,
          width: 18, height: 18, borderRadius: 999,
          background: '#fff',
          transition: 'left 160ms ease',
          boxShadow: '0 1px 2px oklch(0 0 0 / 0.15)',
        }}
      />
    </button>
  )
}
function inputStyle() {
  return {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid var(--border)',
    borderRadius: 10,
    background: 'var(--surface)',
    color: 'var(--fg)',
    fontSize: 13.5,
    outline: 'none',
  }
}
function badgeStyle(bg, fg) {
  return {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 999,
    background: bg,
    color: fg,
  }
}
function Th({ children, style }) {
  return (
    <th style={{
      padding: '10px 12px', textAlign: 'left',
      color: 'var(--fg-3)', fontWeight: 600, fontSize: 12,
      ...style,
    }}>
      {children}
    </th>
  )
}
function Td({ children, style }) {
  return (
    <td style={{
      padding: '10px 12px', color: 'var(--fg)', verticalAlign: 'middle',
      ...style,
    }}>
      {children}
    </td>
  )
}
function IconBtn({ icon, title, danger, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-grid place-items-center transition-transform active:scale-90"
      style={{
        width: 28, height: 28, borderRadius: 7,
        background: 'transparent',
        border: '1px solid var(--border)',
        color: danger ? 'var(--bad)' : 'var(--fg-2)',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{icon}</span>
    </button>
  )
}
