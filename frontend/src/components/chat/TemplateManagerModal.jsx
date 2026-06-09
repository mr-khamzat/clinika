/**
 * TemplateManagerModal — модалка управления шаблонами быстрых ответов.
 *
 * Использование (внутри ClinicChatSection):
 *   <TemplateManagerModal
 *     open={tplManageOpen}
 *     onClose={() => setTplManageOpen(false)}
 *     onPick={(body) => { setDraft(body); setTimeout(() => textareaRef.current?.focus(), 30) }}
 *     canManage={canManageTemplates}
 *     onSeed={async () => { /+ fetch +/ }}
 *   />
 *
 * Возможности:
 *   - Поиск по shortcut/title/body
 *   - Группировка по категориям
 *   - Создание/редактирование/удаление шаблона (если canManage)
 *   - Сид 10 платформенных шаблонов одной кнопкой (если canManage и список пуст)
 *   - Клик по шаблону → onPick(body) → подставляется в драфт и модалка закрывается
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../../api'

const CATEGORIES = [
  { id: 'greeting', label: 'Приветствие',     icon: 'waving_hand' },
  { id: 'pricing',  label: 'Прайс',           icon: 'sell' },
  { id: 'schedule', label: 'Запись/график',   icon: 'event' },
  { id: 'prep',     label: 'Подготовка',      icon: 'science' },
  { id: 'closing',  label: 'Закрытие',        icon: 'check_circle' },
  { id: null,       label: 'Без категории',   icon: 'label_off' },
]

function categoryOf(t) {
  return CATEGORIES.find(c => c.id === (t.category || null)) || CATEGORIES[CATEGORIES.length - 1]
}

export default function TemplateManagerModal({ open, onClose, onPick, canManage }) {
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ]             = useState('')
  const [editing, setEditing] = useState(null)  // null | { id?, shortcut, title, body, category, is_global }
  const [seeding, setSeeding] = useState(false)
  const [err, setErr]         = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/chat/templates', { params: { limit: 100 } })
      setItems(r.data?.templates || [])
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) { setQ(''); setEditing(null); setErr(null); load() }
  }, [open])

  const filtered = useMemo(() => {
    if (!q.trim()) return items
    const needle = q.toLowerCase()
    return items.filter(t =>
      (t.shortcut || '').toLowerCase().includes(needle) ||
      (t.title || '').toLowerCase().includes(needle) ||
      (t.body || '').toLowerCase().includes(needle)
    )
  }, [items, q])

  const grouped = useMemo(() => {
    const m = new Map()
    for (const c of CATEGORIES) m.set(c.id, [])
    for (const t of filtered) {
      const c = categoryOf(t)
      m.get(c.id).push(t)
    }
    return Array.from(m.entries()).filter(([_, arr]) => arr.length > 0)
  }, [filtered])

  const handleSeed = async () => {
    setSeeding(true); setErr(null)
    try {
      const r = await api.post('/chat/templates/seed-defaults')
      await load()
      // eslint-disable-next-line no-alert
      alert(`Создано: ${r.data?.created}, пропущено: ${r.data?.skipped} (уже было)`)
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Ошибка сида')
    } finally {
      setSeeding(false)
    }
  }

  const handleSave = async (e) => {
    e?.preventDefault?.()
    if (!editing) return
    const payload = {
      shortcut: (editing.shortcut || '').trim().replace(/^\//, ''),
      title:    (editing.title || '').trim(),
      body:     editing.body || '',
      category: editing.category || null,
      is_global: !!editing.is_global,
    }
    if (!payload.shortcut || !payload.title || !payload.body) {
      setErr('Заполните shortcut, title, body'); return
    }
    setErr(null)
    try {
      if (editing.id) {
        await api.put(`/chat/templates/${editing.id}`, payload)
      } else {
        await api.post('/chat/templates', payload)
      }
      setEditing(null)
      await load()
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Ошибка сохранения')
    }
  }

  const handleDelete = async (t) => {
    if (!t?.id) return
    // eslint-disable-next-line no-alert
    if (!confirm(`Удалить шаблон «${t.title}»?`)) return
    try {
      await api.delete(`/chat/templates/${t.id}`)
      await load()
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Ошибка удаления')
    }
  }

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(15,23,42,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface, #fff)',
          borderRadius: 16,
          width: 'min(720px, 100%)',
          maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(15,23,42,.35)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
          <span className="material-symbols-outlined" style={{ color: 'var(--accent, #0097A7)' }}>quick_reference</span>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--fg, #0F172A)' }}>Шаблоны быстрых ответов</h3>
          <span style={{ fontSize: 12, color: 'var(--fg-3, #94a3b8)', marginLeft: 6 }}>{items.length}</span>
          <button
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-3, #94a3b8)', padding: 4 }}
            aria-label="Закрыть"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Toolbar */}
        {!editing && (
          <div style={{ display: 'flex', gap: 8, padding: '12px 18px', borderBottom: '1px solid var(--border, #e2e8f0)', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <span className="material-symbols-outlined" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: 'var(--fg-3, #94a3b8)' }}>search</span>
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Поиск по shortcut, заголовку или тексту…"
                style={{
                  width: '100%', padding: '8px 10px 8px 34px',
                  borderRadius: 10, border: '1px solid var(--border, #e2e8f0)',
                  background: 'var(--bg-1, #f1f5f9)', fontSize: 13,
                  color: 'var(--fg, #0F172A)', outline: 'none',
                }}
              />
            </div>
            {canManage && (
              <button
                onClick={() => setEditing({ shortcut: '', title: '', body: '', category: 'greeting', is_global: false })}
                style={{
                  padding: '8px 12px', borderRadius: 10, border: 'none',
                  background: 'linear-gradient(135deg, #0097A7, #0A2342)', color: '#fff',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  boxShadow: '0 4px 12px rgba(0,151,167,.35)',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
                Добавить
              </button>
            )}
            {canManage && items.length === 0 && !loading && (
              <button
                onClick={handleSeed}
                disabled={seeding}
                style={{
                  padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border, #e2e8f0)',
                  background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)',
                  fontSize: 13, fontWeight: 500, cursor: seeding ? 'wait' : 'pointer',
                }}
              >
                {seeding ? 'Сидинг…' : 'Загрузить 10 стандартных'}
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '6px 0' }}>
          {err && (
            <div style={{ margin: '8px 18px', padding: '8px 12px', background: '#fee2e2', borderRadius: 8, color: '#991b1b', fontSize: 12 }}>
              {err}
            </div>
          )}

          {/* Edit form */}
          {editing && (
            <form onSubmit={handleSave} style={{ padding: '14px 18px', display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--accent, #0097A7)' }}>
                  {editing.id ? 'edit' : 'add_circle'}
                </span>
                <strong style={{ fontSize: 14, color: 'var(--fg, #0F172A)' }}>
                  {editing.id ? 'Редактирование шаблона' : 'Новый шаблон'}
                </strong>
              </div>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-2, #475569)', textTransform: 'uppercase', letterSpacing: .5 }}>Shortcut</span>
                <input
                  value={editing.shortcut}
                  onChange={e => setEditing({ ...editing, shortcut: e.target.value })}
                  placeholder="прив"
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #e2e8f0)', background: 'var(--bg-1, #f1f5f9)', fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                />
                <span style={{ fontSize: 11, color: 'var(--fg-3, #94a3b8)' }}>В чате: наберите «/{editing.shortcut || 'shortcut'}»</span>
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-2, #475569)', textTransform: 'uppercase', letterSpacing: .5 }}>Название</span>
                <input
                  value={editing.title}
                  onChange={e => setEditing({ ...editing, title: e.target.value })}
                  placeholder="Приветствие"
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #e2e8f0)', background: 'var(--bg-1, #f1f5f9)', fontSize: 13 }}
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-2, #475569)', textTransform: 'uppercase', letterSpacing: .5 }}>Категория</span>
                <select
                  value={editing.category || ''}
                  onChange={e => setEditing({ ...editing, category: e.target.value || null })}
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #e2e8f0)', background: 'var(--bg-1, #f1f5f9)', fontSize: 13 }}
                >
                  <option value="">— без категории —</option>
                  {CATEGORIES.filter(c => c.id).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-2, #475569)', textTransform: 'uppercase', letterSpacing: .5 }}>Текст</span>
                <textarea
                  value={editing.body}
                  onChange={e => setEditing({ ...editing, body: e.target.value })}
                  rows={5}
                  placeholder="Здравствуйте! Чем могу помочь?"
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #e2e8f0)', background: 'var(--bg-1, #f1f5f9)', fontSize: 13, resize: 'vertical', minHeight: 80 }}
                />
                <span style={{ fontSize: 11, color: 'var(--fg-3, #94a3b8)' }}>
                  Плейсхолдеры: <code>{'{{ patient_name }}'}</code>, <code>{'{{ user_name }}'}</code>, <code>{'{{ clinic_name }}'}</code>, <code>{'{{ clinic_url }}'}</code>
                </span>
              </label>
              {canManage && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg-2, #475569)' }}>
                  <input
                    type="checkbox"
                    checked={!!editing.is_global}
                    onChange={e => setEditing({ ...editing, is_global: e.target.checked })}
                    disabled={!!editing.id}
                  />
                  Общий шаблон тенанта (доступен всем регистраторам)
                </label>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  type="submit"
                  style={{
                    padding: '8px 14px', borderRadius: 10, border: 'none',
                    background: 'linear-gradient(135deg, #0097A7, #0A2342)', color: '#fff',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  style={{
                    padding: '8px 14px', borderRadius: 10,
                    border: '1px solid var(--border, #e2e8f0)',
                    background: 'transparent', color: 'var(--fg-2, #475569)',
                    fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  Отмена
                </button>
              </div>
            </form>
          )}

          {/* List grouped */}
          {!editing && (
            <>
              {loading && (
                <div style={{ padding: '20px 18px', fontSize: 13, color: 'var(--fg-3, #94a3b8)' }}>Загрузка…</div>
              )}
              {!loading && filtered.length === 0 && (
                <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>
                  {q ? 'Ничего не найдено.' : 'Пока нет шаблонов. Создайте первый или загрузите стандартные.'}
                </div>
              )}
              {!loading && grouped.map(([catId, rows]) => {
                const cat = CATEGORIES.find(c => c.id === catId) || CATEGORIES[CATEGORIES.length - 1]
                return (
                  <div key={catId || '__none__'} style={{ padding: '4px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px 6px', fontSize: 11, fontWeight: 700, color: 'var(--fg-3, #94a3b8)', textTransform: 'uppercase', letterSpacing: .5 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{cat.icon}</span>
                      {cat.label}
                      <span style={{ marginLeft: 'auto', fontWeight: 400 }}>{rows.length}</span>
                    </div>
                    {rows.map(t => (
                      <div
                        key={t.id}
                        style={{ padding: '8px 18px', borderTop: '1px solid var(--border, #e2e8f0)', display: 'flex', alignItems: 'flex-start', gap: 10 }}
                      >
                        <button
                          onClick={() => { onPick(t); onClose() }}
                          style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <code style={{
                              fontSize: 11, padding: '2px 6px', borderRadius: 6,
                              background: 'var(--bg-1, #f1f5f9)', color: 'var(--accent, #0097A7)',
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            }}>/{t.shortcut}</code>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg, #0F172A)' }}>{t.title}</span>
                            {t.is_global && (
                              <span style={{ fontSize: 10, color: 'var(--fg-3, #94a3b8)' }}>общий</span>
                            )}
                            {!!t.usage_count && (
                              <span style={{ fontSize: 10, color: 'var(--fg-3, #94a3b8)', marginLeft: 'auto' }} title="Использований">
                                ×{t.usage_count}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--fg-3, #94a3b8)', marginTop: 2, whiteSpace: 'pre-wrap' }}>
                            {t.body}
                          </div>
                        </button>
                        {canManage && (
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                            <button
                              onClick={() => setEditing({
                                id: t.id,
                                shortcut: t.shortcut,
                                title: t.title,
                                body: t.body,
                                category: t.category,
                                is_global: !!t.is_global,
                              })}
                              style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-3, #94a3b8)' }}
                              title="Редактировать"
                              aria-label="Редактировать"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                            </button>
                            <button
                              onClick={() => handleDelete(t)}
                              style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-3, #94a3b8)' }}
                              title="Удалить"
                              aria-label="Удалить"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
