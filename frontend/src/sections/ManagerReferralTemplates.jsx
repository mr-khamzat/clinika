/**
 * ========================================
 * БЛОК: ManagerReferralTemplates (Глава 4 — Manager productivity)
 * ========================================
 * CRUD-секция шаблонов направлений.
 *
 * Поля payload (свободная форма JSON) поддерживаются:
 *   target_doctor_id, services[], notes, priority, referral_type, lab_tests
 *
 * Применение шаблона:
 *   POST /manager/referral-templates/{id}/use возвращает payload —
 *   ReferralCreateForm подставляет его в форму. См. интеграцию в
 *   AppointmentsCalendarSection или существующую форму направления.
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../api'
import { Card, Button, Modal, EmptyState, useToast } from '../design'

const PRIORITIES = [
  { v: 'normal', label: 'Обычный' },
  { v: 'high',   label: 'Высокий' },
  { v: 'urgent', label: 'Срочный' },
]

const TYPES = [
  { v: 'service', label: 'На услугу' },
  { v: 'doctor',  label: 'К врачу'   },
  { v: 'lab',     label: 'Анализы'   },
]

export default function ManagerReferralTemplates() {
  const toast = useToast()
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ clinic_id: '' })
  const [clinics, setClinics] = useState([])
  const [editor, setEditor] = useState(null) // null | {} | {id, ...}

  useEffect(() => {
    api.get('/manager/clinics-accessible')
      .then(r => setClinics(Array.isArray(r.data) ? r.data : []))
      .catch(() => setClinics([]))
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const params = {}
      if (filter.clinic_id) params.clinic_id = filter.clinic_id
      const r = await api.get('/manager/referral-templates', { params })
      setList(Array.isArray(r.data) ? r.data : [])
    } catch {
      toast?.error?.('Не удалось загрузить шаблоны')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [filter.clinic_id])

  const openNew = () => setEditor({
    name: '',
    description: '',
    clinic_id: filter.clinic_id || '',
    payload: {
      referral_type: 'service',
      priority: 'normal',
      notes: '',
      services: [],
      target_doctor_id: '',
      lab_tests: '',
    },
  })

  const openEdit = (t) => setEditor({
    ...t,
    clinic_id: t.clinic_id || '',
    payload: { referral_type: 'service', priority: 'normal', ...(t.payload || {}) },
  })

  const remove = async (id) => {
    if (!confirm('Удалить шаблон?')) return
    try {
      await api.delete(`/manager/referral-templates/${id}`)
      toast?.success?.('Удалено')
      load()
    } catch { toast?.error?.('Не удалось удалить') }
  }

  const save = async () => {
    const body = {
      name: editor.name.trim(),
      description: editor.description || null,
      clinic_id: editor.clinic_id || null,
      payload: editor.payload || {},
    }
    if (!body.name) { toast?.error?.('Введите название'); return }
    try {
      if (editor.id) {
        await api.patch(`/manager/referral-templates/${editor.id}`, body)
        toast?.success?.('Сохранено')
      } else {
        await api.post('/manager/referral-templates', body)
        toast?.success?.('Шаблон создан')
      }
      setEditor(null)
      load()
    } catch (e) {
      toast?.error?.('Ошибка сохранения')
    }
  }

  return (
    <div>
      {/* ─── Toolbar ─── */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap',
        padding: 12, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      }}>
        {clinics.length > 1 && (
          <select value={filter.clinic_id}
                  onChange={e => setFilter(f => ({ ...f, clinic_id: e.target.value }))}
                  style={selectStyle}>
            <option value="">Все клиники</option>
            {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <div style={{ flex: 1 }} />
        <Button size="sm" onClick={openNew}>+ Новый шаблон</Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--fg-3)' }}>Загрузка…</div>
      ) : list.length === 0 ? (
        <EmptyState
          title="Нет шаблонов"
          subtitle="Создайте шаблон, чтобы быстро повторять типичные направления"
        />
      ) : (
        <div style={{
          display: 'grid', gap: 10,
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        }}>
          {list.map(t => (
            <Card key={t.id}>
              <div style={{ display: 'flex', alignItems: 'start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{t.name}</div>
                  {t.description && (
                    <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>{t.description}</div>
                  )}
                  <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: 6,
                    marginTop: 8, fontSize: 10,
                  }}>
                    <Tag>{t.clinic_id ? 'Клиника' : 'Общий'}</Tag>
                    {t.payload?.priority && t.payload.priority !== 'normal' && (
                      <Tag accent="oklch(0.65 0.22 25)">{t.payload.priority}</Tag>
                    )}
                    <Tag accent="oklch(0.72 0.16 250)">
                      использован: {t.usage_count}×
                    </Tag>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <Button size="sm" variant="secondary" onClick={() => openEdit(t)}>Редактировать</Button>
                <Button size="sm" variant="danger" onClick={() => remove(t.id)}>Удалить</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ─── Modal редактора ─── */}
      {editor && (
        <Modal
          open={!!editor}
          onClose={() => setEditor(null)}
          title={editor.id ? 'Редактирование шаблона' : 'Новый шаблон направления'}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditor(null)}>Отмена</Button>
              <Button onClick={save}>Сохранить</Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Field label="Название">
              <input value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Описание">
              <textarea value={editor.description || ''}
                        onChange={e => setEditor({ ...editor, description: e.target.value })}
                        style={{ ...inputStyle, minHeight: 60 }} />
            </Field>
            <Field label="Привязка к клинике">
              <select value={editor.clinic_id || ''}
                      onChange={e => setEditor({ ...editor, clinic_id: e.target.value })}
                      style={inputStyle}>
                <option value="">Общий (для всех клиник тенанта)</option>
                {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Тип направления">
              <select
                value={editor.payload?.referral_type || 'service'}
                onChange={e => setEditor({ ...editor, payload: { ...(editor.payload||{}), referral_type: e.target.value } })}
                style={inputStyle}>
                {TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Приоритет">
              <select
                value={editor.payload?.priority || 'normal'}
                onChange={e => setEditor({ ...editor, payload: { ...(editor.payload||{}), priority: e.target.value } })}
                style={inputStyle}>
                {PRIORITIES.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Заметки">
              <textarea
                value={editor.payload?.notes || ''}
                onChange={e => setEditor({ ...editor, payload: { ...(editor.payload||{}), notes: e.target.value } })}
                style={{ ...inputStyle, minHeight: 50 }} />
            </Field>
            {(editor.payload?.referral_type === 'lab') && (
              <Field label="Анализы (через запятую)">
                <input
                  value={editor.payload?.lab_tests || ''}
                  onChange={e => setEditor({ ...editor, payload: { ...(editor.payload||{}), lab_tests: e.target.value } })}
                  style={inputStyle} />
              </Field>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  )
}

function Tag({ children, accent }) {
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 999,
      background: accent ? accent : 'var(--bg-2)',
      color: accent ? 'white' : 'var(--fg-3)',
      fontWeight: 600,
    }}>{children}</span>
  )
}

const inputStyle = {
  width: '100%', height: 34, padding: '0 10px', fontSize: 13,
  background: 'var(--bg-1)', color: 'var(--fg)',
  border: '1px solid var(--border)', borderRadius: 8,
}
const selectStyle = {
  height: 32, padding: '0 8px', fontSize: 12,
  background: 'var(--bg-2)', color: 'var(--fg)',
  border: '1px solid var(--border)', borderRadius: 8,
}
