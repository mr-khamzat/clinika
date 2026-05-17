/**
 * ========================================
 * БЛОК: AttributionTab — атрибуция пациентов к каналам
 * ========================================
 * Учёт связи «пациент ↔ канал привлечения» с UTM-метками.
 *
 * API:
 *   GET    /marketing/attribution?search=&channel_id=&limit=&offset=
 *   POST   /marketing/attribution
 *   PATCH  /marketing/attribution/{id}
 *   DELETE /marketing/attribution/{id}
 *   GET    /marketing/channels?is_active=true
 *
 * Структура patient_attribution:
 *   { id, tenant_id, patient_phone, patient_user_id,
 *     patient: { id, full_name, phone } (если найден),
 *     channel_id, channel: { id, code, name, icon },
 *     utm_source, utm_medium, utm_campaign, utm_content, utm_term,
 *     source_detail, referrer,
 *     first_touch_at, last_touch_at }
 * ========================================
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import api from '../../api'
import {
  Card, Button, EmptyState, Modal, useToast, useConfirm,
} from '../../design'

// Форматы
function fmtDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    })
  } catch { return iso }
}
function normalizePhone(s) {
  return (s || '').replace(/\D/g, '')
}

export default function AttributionTab() {
  const { toast } = useToast()
  const { confirm, ConfirmHost } = useConfirm()

  const [channels, setChannels] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  // ─── Загрузка каналов один раз ───
  useEffect(() => {
    let alive = true
    api.get('/marketing/channels', { params: { is_active: true } })
      .then(r => { if (alive) setChannels(Array.isArray(r.data) ? r.data : []) })
      .catch(() => { if (alive) setChannels([]) })
    return () => { alive = false }
  }, [])

  // ─── Загрузка атрибуций ───
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { limit: 200 }
      if (search.trim()) params.search = search.trim()
      if (channelFilter) params.channel_id = channelFilter
      const r = await api.get('/marketing/attribution', { params })
      setItems(Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.items) ? r.data.items : []))
    } catch (_) {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [search, channelFilter])

  // Debounce search
  const searchTimerRef = useRef(null)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => { load() }, 300)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, channelFilter])

  const onDelete = useCallback(async (it) => {
    const name = it.patient?.full_name || it.patient_phone || '—'
    const ok = await confirm(
      `Удалить атрибуцию пациента «${name}»?`,
      { danger: true, okText: 'Удалить', title: 'Удалить атрибуцию?' },
    )
    if (!ok) return
    try {
      await api.delete(`/marketing/attribution/${it.id}`)
      toast('Атрибуция удалена', 'success')
      load()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось удалить', 'error')
    }
  }, [confirm, load, toast])

  return (
    <div className="flex flex-col gap-4">
      <ConfirmHost />

      {/* ─── Фильтры + кнопка ─── */}
      <Card>
        <div className="grid gap-3" style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}>
          <label className="flex flex-col gap-1">
            <span style={{ fontSize: 11.5, color: 'var(--fg-3)', fontWeight: 600 }}>
              Поиск по телефону или ФИО
            </span>
            <div style={{ position: 'relative' }}>
              <span className="material-symbols-outlined"
                style={{ position: 'absolute', left: 10, top: 8, fontSize: 18, color: 'var(--fg-3)' }}>
                search
              </span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="+7 999 ... / Иванов"
                style={{ ...inputStyle(), paddingLeft: 34 }}
              />
            </div>
          </label>

          <label className="flex flex-col gap-1">
            <span style={{ fontSize: 11.5, color: 'var(--fg-3)', fontWeight: 600 }}>Канал</span>
            <select
              value={channelFilter}
              onChange={e => setChannelFilter(e.target.value)}
              style={inputStyle()}
            >
              <option value="">Все каналы</option>
              {channels.map(c => (
                <option key={c.id} value={String(c.id)}>{c.name}</option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <Button
              variant="primary"
              onClick={() => { setEditing(null); setModalOpen(true) }}
              className="w-full"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
              Связать пациента с каналом
            </Button>
          </div>
        </div>
      </Card>

      {/* ─── Таблица / карточки ─── */}
      <Card padded={false}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin"
              style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        ) : items.length === 0 ? (
          <div className="py-6">
            <EmptyState
              icon={<span className="material-symbols-outlined" style={{ fontSize: 24 }}>person_search</span>}
              title="Нет атрибуций"
              message="Привяжите пациента к каналу привлечения, чтобы считать CAC и ROI по реальным деньгам."
              action={
                <Button variant="primary" onClick={() => { setEditing(null); setModalOpen(true) }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
                  Связать пациента с каналом
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden sm:block" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-1)' }}>
                    <Th>Пациент</Th>
                    <Th>Канал</Th>
                    <Th>UTM source / medium / campaign</Th>
                    <Th>Первое касание</Th>
                    <Th>Последнее</Th>
                    <Th style={{ width: 80 }}>{''}</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr
                      key={it.id}
                      style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                      onClick={() => { setEditing(it); setModalOpen(true) }}
                    >
                      <Td>
                        <div style={{ fontWeight: 600 }}>{it.patient?.full_name || '—'}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                          {it.patient?.phone || it.patient_phone || '—'}
                        </div>
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--fg-3)' }}>
                            {it.channel?.icon || 'campaign'}
                          </span>
                          {it.channel?.name || '—'}
                        </span>
                      </Td>
                      <Td>
                        <UtmTriad
                          source={it.utm_source}
                          medium={it.utm_medium}
                          campaign={it.utm_campaign}
                        />
                      </Td>
                      <Td>{fmtDate(it.first_touch_at)}</Td>
                      <Td>{fmtDate(it.last_touch_at)}</Td>
                      <Td>
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          <IconBtn icon="edit" title="Редактировать"
                            onClick={() => { setEditing(it); setModalOpen(true) }} />
                          <IconBtn icon="delete" title="Удалить" danger
                            onClick={() => onDelete(it)} />
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="sm:hidden flex flex-col gap-2 p-3">
              {items.map(it => (
                <button
                  key={it.id}
                  onClick={() => { setEditing(it); setModalOpen(true) }}
                  className="text-left transition-transform active:scale-[0.99]"
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: 12,
                  }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <div style={{ fontSize: 14, fontWeight: 600 }} className="truncate">
                        {it.patient?.full_name || '—'}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                        {it.patient?.phone || it.patient_phone || '—'}
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-1 flex-shrink-0" style={{ fontSize: 12, fontWeight: 600 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'var(--fg-3)' }}>
                        {it.channel?.icon || 'campaign'}
                      </span>
                      {it.channel?.name || '—'}
                    </div>
                  </div>
                  <UtmTriad
                    source={it.utm_source}
                    medium={it.utm_medium}
                    campaign={it.utm_campaign}
                  />
                  <div className="mt-1" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                    {fmtDate(it.first_touch_at)} → {fmtDate(it.last_touch_at)}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* ─── Модалка ─── */}
      <AttributionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editing}
        channels={channels}
        onSaved={() => { setModalOpen(false); load() }}
        onDelete={editing ? () => { onDelete(editing); setModalOpen(false) } : null}
      />
    </div>
  )
}

// ════════════════════════════════════════════════════
// БЛОК: модалка добавления / редактирования атрибуции
// ════════════════════════════════════════════════════
function AttributionModal({ open, onClose, editing, channels, onSaved, onDelete }) {
  const { toast } = useToast()
  const isEdit = !!editing

  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})

  // ─── Подсказки пациентов при вводе телефона ───
  const [hints, setHints] = useState([])
  const hintTimerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    if (editing) {
      setForm({
        patient_phone:    editing.patient_phone || editing.patient?.phone || '',
        patient_user_id:  editing.patient_user_id || editing.patient?.id || '',
        channel_id:       editing.channel_id ? String(editing.channel_id) : '',
        utm_source:       editing.utm_source || '',
        utm_medium:       editing.utm_medium || '',
        utm_campaign:     editing.utm_campaign || '',
        utm_content:      editing.utm_content || '',
        utm_term:         editing.utm_term || '',
        source_detail:    editing.source_detail || '',
        referrer:         editing.referrer || '',
      })
    } else {
      setForm({ ...emptyForm })
    }
    setErrors({})
    setHints([])
  }, [open, editing])

  // ─── Поиск пациента по подстроке номера ───
  const phoneDigits = normalizePhone(form.patient_phone)
  useEffect(() => {
    if (!open) return
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    if (phoneDigits.length < 3) { setHints([]); return }
    hintTimerRef.current = setTimeout(async () => {
      try {
        // Глобальный поиск менеджера (CommandPalette) — возвращает {patients, doctors, ...}
        const r = await api.get('/search', { params: { q: form.patient_phone } })
        const list = Array.isArray(r?.data?.patients) ? r.data.patients : []
        // Нормализуем под общий вид {id, full_name, phone}
        setHints(list.map(p => ({
          id: p.id,
          full_name: p.name || p.full_name || '',
          phone: p.phone || '',
        })))
      } catch (_) {
        setHints([])
      }
    }, 300)
    return () => { if (hintTimerRef.current) clearTimeout(hintTimerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.patient_phone, open])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const pickPatient = (p) => {
    setForm(f => ({
      ...f,
      patient_phone: p.phone || f.patient_phone,
      patient_user_id: p.id || '',
    }))
    setHints([])
  }

  const validate = () => {
    const e = {}
    if (!form.patient_phone.trim() && !form.patient_user_id) {
      e.patient_phone = 'Укажите телефон пациента'
    }
    if (!form.channel_id) e.channel_id = 'Выберите канал'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const onSubmit = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const payload = {
        patient_phone:    form.patient_phone.trim() || null,
        patient_user_id:  form.patient_user_id || null,
        channel_id:       Number(form.channel_id),
        utm_source:       form.utm_source.trim() || null,
        utm_medium:       form.utm_medium.trim() || null,
        utm_campaign:     form.utm_campaign.trim() || null,
        utm_content:      form.utm_content.trim() || null,
        utm_term:         form.utm_term.trim() || null,
        source_detail:    form.source_detail.trim() || null,
        referrer:         form.referrer.trim() || null,
      }
      if (isEdit) {
        await api.patch(`/marketing/attribution/${editing.id}`, payload)
        toast('Атрибуция обновлена', 'success')
      } else {
        await api.post('/marketing/attribution', payload)
        toast('Атрибуция создана', 'success')
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
      title={isEdit ? 'Редактировать атрибуцию' : 'Связать пациента с каналом'}
      size="md"
      actions={
        <>
          {isEdit && onDelete && (
            <Button variant="danger" onClick={onDelete} style={{ marginRight: 'auto' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
              Удалить
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={onSubmit} disabled={saving}>
            {saving ? 'Сохранение…' : (isEdit ? 'Сохранить' : 'Связать')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Телефон пациента" required error={errors.patient_phone}
          hint="Введите минимум 3 цифры — появятся подсказки из базы">
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={form.patient_phone}
              onChange={e => { setField('patient_phone', e.target.value); setField('patient_user_id', '') }}
              placeholder="+7 999 ..."
              style={inputStyle()}
              autoComplete="off"
            />
            {hints.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 10, boxShadow: 'var(--shadow-lg)', zIndex: 10,
                maxHeight: 220, overflowY: 'auto',
              }}>
                {hints.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickPatient(p)}
                    className="block w-full text-left transition-colors hover:bg-[var(--bg-1)]"
                    style={{
                      padding: '8px 12px',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 13,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{p.full_name || '—'}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{p.phone || '—'}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {form.patient_user_id && (
            <div className="inline-flex items-center gap-1 mt-1" style={{ fontSize: 11, color: 'var(--good)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>check_circle</span>
              Пациент найден в базе (ID: {form.patient_user_id})
            </div>
          )}
        </Field>

        <Field label="Канал" required error={errors.channel_id}>
          <select
            value={form.channel_id}
            onChange={e => setField('channel_id', e.target.value)}
            style={inputStyle()}
          >
            <option value="">— выберите канал —</option>
            {channels.map(c => (
              <option key={c.id} value={String(c.id)}>{c.name}</option>
            ))}
          </select>
        </Field>

        {/* UTM */}
        <div style={{
          padding: 12, borderRadius: 10,
          background: 'var(--bg-1)', border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            UTM-метки (опц.)
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="utm_source">
              <input type="text" value={form.utm_source}
                onChange={e => setField('utm_source', e.target.value)}
                placeholder="google" style={inputStyle()} />
            </Field>
            <Field label="utm_medium">
              <input type="text" value={form.utm_medium}
                onChange={e => setField('utm_medium', e.target.value)}
                placeholder="cpc" style={inputStyle()} />
            </Field>
            <Field label="utm_campaign">
              <input type="text" value={form.utm_campaign}
                onChange={e => setField('utm_campaign', e.target.value)}
                placeholder="winter_2026" style={inputStyle()} />
            </Field>
            <Field label="utm_content">
              <input type="text" value={form.utm_content}
                onChange={e => setField('utm_content', e.target.value)}
                placeholder="banner_a" style={inputStyle()} />
            </Field>
            <Field label="utm_term">
              <input type="text" value={form.utm_term}
                onChange={e => setField('utm_term', e.target.value)}
                placeholder="имплантация" style={inputStyle()} />
            </Field>
          </div>
        </div>

        <Field label="Source detail (доп. контекст)">
          <input
            type="text"
            value={form.source_detail}
            onChange={e => setField('source_detail', e.target.value)}
            placeholder="Например: реклама в чате района"
            style={inputStyle()}
          />
        </Field>

        <Field label="Referrer (URL источника)">
          <input
            type="text"
            value={form.referrer}
            onChange={e => setField('referrer', e.target.value)}
            placeholder="https://..."
            style={inputStyle()}
          />
        </Field>
      </div>
    </Modal>
  )
}

const emptyForm = {
  patient_phone: '',
  patient_user_id: '',
  channel_id: '',
  utm_source: '',
  utm_medium: '',
  utm_campaign: '',
  utm_content: '',
  utm_term: '',
  source_detail: '',
  referrer: '',
}

// ════════════════════════════════════════════════════
// БЛОК: вспомогательные компоненты
// ════════════════════════════════════════════════════
function UtmTriad({ source, medium, campaign }) {
  const has = source || medium || campaign
  if (!has) return <span style={{ color: 'var(--fg-3)' }}>—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {source && <UtmBadge label="src" value={source} />}
      {medium && <UtmBadge label="med" value={medium} />}
      {campaign && <UtmBadge label="cmp" value={campaign} />}
    </div>
  )
}
function UtmBadge({ label, value }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, padding: '2px 7px', borderRadius: 6,
      background: 'var(--bg-2)', border: '1px solid var(--border)',
      color: 'var(--fg-2)', maxWidth: 200,
    }}>
      <span style={{ color: 'var(--fg-3)', fontWeight: 700 }}>{label}:</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </span>
  )
}
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
