/**
 * ========================================
 * БЛОК: AdSpendTab — вкладка «Расходы на рекламу»
 * ========================================
 * Учёт затрат на каналы привлечения по периодам + лиды/клики/показы.
 *
 * API:
 *   GET    /marketing/ad-spend?from=&to=&channel_id=&clinic_id=
 *   POST   /marketing/ad-spend
 *   PATCH  /marketing/ad-spend/{id}
 *   DELETE /marketing/ad-spend/{id}
 *   GET    /marketing/channels?is_active=true
 *   GET    /manager/clinics/   (для select клиники)
 *
 * Структура записи ad_spend:
 *   { id, tenant_id, channel_id, channel: {id,code,name,icon},
 *     campaign, clinic_id, clinic: {id,name},
 *     amount (decimal/число в ₽), period_from, period_to,
 *     leads, clicks, impressions, notes,
 *     created_at, updated_at }
 *
 * UI:
 *   • Фильтры (период, канал, клиника)
 *   • KPI: Расход / Лидов / Кликов / Показов / Средний CPL
 *   • Таблица записей с edit/delete
 *   • Карточный режим на mobile (<640px)
 *   • Модалка «Добавить/Редактировать расход»
 * ========================================
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import api from '../../api'
import {
  Card, Button, EmptyState, Modal, KpiCard, KpiRow, useToast, useConfirm,
} from '../../design'

// ─── Утилиты форматирования ───
function fmtMoney(v) {
  if (v == null || v === '') return '—'
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency', currency: 'RUB', maximumFractionDigits: 0,
    }).format(Number(v))
  } catch { return String(v) }
}
function fmtInt(v) {
  if (v == null || v === '') return '0'
  try { return new Intl.NumberFormat('ru-RU').format(Number(v)) }
  catch { return String(v) }
}
function fmtDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return iso }
}
// ISO yyyy-mm-dd (вход для <input type="date">)
function toInputDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch { return '' }
}

// ─── Период по умолчанию: текущий месяц ───
function defaultPeriod() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { from: toInputDate(from.toISOString()), to: toInputDate(to.toISOString()) }
}

export default function AdSpendTab() {
  const { toast } = useToast()
  const { confirm, ConfirmHost } = useConfirm()

  // ─── Списки-справочники ───
  const [channels, setChannels] = useState([])
  const [clinics, setClinics]   = useState([])

  // ─── Данные таблицы ───
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  // ─── Фильтры ───
  const period0 = defaultPeriod()
  const [from, setFrom]         = useState(period0.from)
  const [to, setTo]             = useState(period0.to)
  const [channelId, setChannelId] = useState('')
  const [clinicId, setClinicId]   = useState('')

  // ─── Модалка ───
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing]     = useState(null) // null = создание, объект = редактирование

  // ─── Загрузка справочников один раз ───
  useEffect(() => {
    let alive = true
    api.get('/marketing/channels', { params: { is_active: true } })
      .then(r => { if (alive) setChannels(Array.isArray(r.data) ? r.data : []) })
      .catch(() => { if (alive) setChannels([]) })
    api.get('/manager/clinics/')
      .then(r => { if (alive) setClinics(Array.isArray(r.data) ? r.data : []) })
      .catch(() => { if (alive) setClinics([]) })
    return () => { alive = false }
  }, [])

  // ─── Загрузка ad_spend по фильтрам ───
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (from) params.from = from
      if (to) params.to = to
      if (channelId) params.channel_id = channelId
      if (clinicId) params.clinic_id = clinicId
      const r = await api.get('/marketing/ad-spend', { params })
      setItems(Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.items) ? r.data.items : []))
    } catch (_) {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [from, to, channelId, clinicId])

  useEffect(() => { load() }, [load])

  // ─── KPI по текущему набору ───
  const kpi = useMemo(() => {
    const acc = { spent: 0, leads: 0, clicks: 0, impressions: 0 }
    for (const it of items) {
      acc.spent       += Number(it.amount || 0)
      acc.leads       += Number(it.leads || 0)
      acc.clicks      += Number(it.clicks || 0)
      acc.impressions += Number(it.impressions || 0)
    }
    const cpl = acc.leads > 0 ? Math.round(acc.spent / acc.leads) : 0
    return { ...acc, cpl }
  }, [items])

  // ─── Удаление с подтверждением ───
  const onDelete = useCallback(async (item) => {
    const ok = await confirm(
      `Удалить запись расхода «${item.channel?.name || ''}» на ${fmtMoney(item.amount)}?`,
      { danger: true, okText: 'Удалить', title: 'Удалить расход?' },
    )
    if (!ok) return
    try {
      await api.delete(`/marketing/ad-spend/${item.id}`)
      toast('Расход удалён', 'success')
      load()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось удалить', 'error')
    }
  }, [confirm, load, toast])

  return (
    <div className="flex flex-col gap-4">
      <ConfirmHost />

      {/* ─── Фильтры ─── */}
      <Card>
        <div className="grid gap-3" style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        }}>
          <FilterDate label="Период с" value={from} onChange={setFrom} />
          <FilterDate label="по" value={to} onChange={setTo} />
          <FilterSelect
            label="Канал"
            value={channelId}
            onChange={setChannelId}
            options={[
              { value: '', label: 'Все каналы' },
              ...channels.map(c => ({ value: String(c.id), label: c.name })),
            ]}
          />
          <FilterSelect
            label="Клиника"
            value={clinicId}
            onChange={setClinicId}
            options={[
              { value: '', label: 'Все клиники' },
              ...clinics.map(c => ({ value: String(c.id), label: c.name })),
            ]}
          />
          <div className="flex items-end gap-2">
            <Button
              variant="primary"
              onClick={() => { setEditing(null); setModalOpen(true) }}
              className="w-full"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
              Добавить расход
            </Button>
          </div>
        </div>
      </Card>

      {/* ─── KPI ─── */}
      <KpiRow cols={5}>
        <KpiCard label="Расход за период" value={fmtMoney(kpi.spent)} />
        <KpiCard label="Лидов"      value={fmtInt(kpi.leads)} />
        <KpiCard label="Кликов"     value={fmtInt(kpi.clicks)} />
        <KpiCard label="Показов"    value={fmtInt(kpi.impressions)} />
        <KpiCard label="Средний CPL" value={fmtMoney(kpi.cpl)} />
      </KpiRow>

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
              icon={<span className="material-symbols-outlined" style={{ fontSize: 24 }}>campaign</span>}
              title="Нет расходов за период"
              message="Добавьте запись о рекламном расходе, чтобы отслеживать CPL и ROI."
              action={
                <Button variant="primary" onClick={() => { setEditing(null); setModalOpen(true) }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
                  Добавить расход
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {/* Desktop / tablet: таблица */}
            <div className="hidden sm:block" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-1)' }}>
                    <Th>Период</Th>
                    <Th>Канал</Th>
                    <Th>Кампания</Th>
                    <Th>Клиника</Th>
                    <Th style={{ textAlign: 'right' }}>Расход</Th>
                    <Th style={{ textAlign: 'right' }}>Лиды</Th>
                    <Th style={{ textAlign: 'right' }}>Клики</Th>
                    <Th style={{ textAlign: 'right' }}>Показы</Th>
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
                      <Td>{fmtDate(it.period_from)} — {fmtDate(it.period_to)}</Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--fg-3)' }}>
                            {it.channel?.icon || 'campaign'}
                          </span>
                          {it.channel?.name || '—'}
                        </span>
                      </Td>
                      <Td>{it.campaign || '—'}</Td>
                      <Td>{it.clinic?.name || '—'}</Td>
                      <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {fmtMoney(it.amount)}
                      </Td>
                      <Td style={{ textAlign: 'right' }}>{fmtInt(it.leads)}</Td>
                      <Td style={{ textAlign: 'right' }}>{fmtInt(it.clicks)}</Td>
                      <Td style={{ textAlign: 'right' }}>{fmtInt(it.impressions)}</Td>
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

            {/* Mobile: карточки */}
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
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="inline-flex items-center gap-1.5" style={{ fontSize: 13.5, fontWeight: 600 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--fg-3)' }}>
                        {it.channel?.icon || 'campaign'}
                      </span>
                      {it.channel?.name || '—'}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{fmtMoney(it.amount)}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                    {fmtDate(it.period_from)} — {fmtDate(it.period_to)}
                  </div>
                  {(it.campaign || it.clinic?.name) && (
                    <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 4 }}>
                      {[it.campaign, it.clinic?.name].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  <div className="flex gap-3 mt-2" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                    <span>Лиды: <b style={{ color: 'var(--fg)' }}>{fmtInt(it.leads)}</b></span>
                    <span>Клики: <b style={{ color: 'var(--fg)' }}>{fmtInt(it.clicks)}</b></span>
                    <span>Показы: <b style={{ color: 'var(--fg)' }}>{fmtInt(it.impressions)}</b></span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* ─── Модалка добавления/редактирования ─── */}
      <AdSpendModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editing}
        channels={channels}
        clinics={clinics}
        onSaved={() => { setModalOpen(false); load() }}
        onDelete={editing ? () => { onDelete(editing); setModalOpen(false) } : null}
      />
    </div>
  )
}

// ════════════════════════════════════════════════════
// БЛОК: модалка добавления/редактирования расхода
// ════════════════════════════════════════════════════
function AdSpendModal({ open, onClose, editing, channels, clinics, onSaved, onDelete }) {
  const { toast } = useToast()
  const isEdit = !!editing

  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})

  // Сбрасываем форму при открытии
  useEffect(() => {
    if (!open) return
    if (editing) {
      setForm({
        channel_id:   editing.channel_id ? String(editing.channel_id) : '',
        campaign:     editing.campaign || '',
        clinic_id:    editing.clinic_id ? String(editing.clinic_id) : '',
        amount:       editing.amount != null ? String(editing.amount) : '',
        period_from:  toInputDate(editing.period_from),
        period_to:    toInputDate(editing.period_to),
        leads:        editing.leads != null ? String(editing.leads) : '',
        clicks:       editing.clicks != null ? String(editing.clicks) : '',
        impressions:  editing.impressions != null ? String(editing.impressions) : '',
        notes:        editing.notes || '',
      })
    } else {
      const p = defaultPeriod()
      setForm({ ...emptyForm, period_from: p.from, period_to: p.to })
    }
    setErrors({})
  }, [open, editing])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Валидация
  const validate = () => {
    const e = {}
    if (!form.channel_id) e.channel_id = 'Выберите канал'
    if (!form.amount || Number(form.amount) <= 0) e.amount = 'Укажите сумму > 0'
    if (!form.period_from) e.period_from = 'Укажите дату начала'
    if (!form.period_to) e.period_to = 'Укажите дату окончания'
    if (form.period_from && form.period_to && form.period_from > form.period_to) {
      e.period_to = 'Дата окончания раньше начала'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const onSubmit = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const payload = {
        channel_id: Number(form.channel_id),
        campaign: form.campaign.trim() || null,
        clinic_id: form.clinic_id ? Number(form.clinic_id) : null,
        amount: Number(form.amount),
        period_from: form.period_from,
        period_to: form.period_to,
        leads: form.leads ? Number(form.leads) : 0,
        clicks: form.clicks ? Number(form.clicks) : 0,
        impressions: form.impressions ? Number(form.impressions) : 0,
        notes: form.notes.trim() || null,
      }
      if (isEdit) {
        await api.patch(`/marketing/ad-spend/${editing.id}`, payload)
        toast('Расход обновлён', 'success')
      } else {
        await api.post('/marketing/ad-spend', payload)
        toast('Расход добавлен', 'success')
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
      title={isEdit ? 'Редактировать расход' : 'Добавить расход'}
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
            {saving ? 'Сохранение…' : (isEdit ? 'Сохранить' : 'Добавить')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
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

        <Field label="Кампания (опционально)">
          <input
            type="text"
            value={form.campaign}
            onChange={e => setField('campaign', e.target.value)}
            placeholder="Например: Зима 2026 — имплантация"
            style={inputStyle()}
          />
        </Field>

        <Field label="Клиника (опционально)">
          <select
            value={form.clinic_id}
            onChange={e => setField('clinic_id', e.target.value)}
            style={inputStyle()}
          >
            <option value="">— все клиники —</option>
            {clinics.map(c => (
              <option key={c.id} value={String(c.id)}>{c.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Сумма расхода, ₽" required error={errors.amount}>
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={form.amount}
            onChange={e => setField('amount', e.target.value)}
            placeholder="0"
            style={inputStyle()}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Период с" required error={errors.period_from}>
            <input
              type="date"
              value={form.period_from}
              onChange={e => setField('period_from', e.target.value)}
              style={inputStyle()}
            />
          </Field>
          <Field label="по" required error={errors.period_to}>
            <input
              type="date"
              value={form.period_to}
              onChange={e => setField('period_to', e.target.value)}
              style={inputStyle()}
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Лиды">
            <input
              type="number"
              min="0"
              value={form.leads}
              onChange={e => setField('leads', e.target.value)}
              placeholder="0"
              style={inputStyle()}
            />
          </Field>
          <Field label="Клики">
            <input
              type="number"
              min="0"
              value={form.clicks}
              onChange={e => setField('clicks', e.target.value)}
              placeholder="0"
              style={inputStyle()}
            />
          </Field>
          <Field label="Показы">
            <input
              type="number"
              min="0"
              value={form.impressions}
              onChange={e => setField('impressions', e.target.value)}
              placeholder="0"
              style={inputStyle()}
            />
          </Field>
        </div>

        <Field label="Заметки">
          <textarea
            rows={3}
            value={form.notes}
            onChange={e => setField('notes', e.target.value)}
            placeholder="Внутренние комментарии (опц.)"
            style={{ ...inputStyle(), resize: 'vertical', minHeight: 72 }}
          />
        </Field>
      </div>
    </Modal>
  )
}

const emptyForm = {
  channel_id: '',
  campaign: '',
  clinic_id: '',
  amount: '',
  period_from: '',
  period_to: '',
  leads: '',
  clicks: '',
  impressions: '',
  notes: '',
}

// ════════════════════════════════════════════════════
// БЛОК: вспомогательные компоненты
// ════════════════════════════════════════════════════
function FilterDate({ label, value, onChange }) {
  return (
    <label className="flex flex-col gap-1">
      <span style={{ fontSize: 11.5, color: 'var(--fg-3)', fontWeight: 600 }}>{label}</span>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={inputStyle()}
      />
    </label>
  )
}
function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="flex flex-col gap-1">
      <span style={{ fontSize: 11.5, color: 'var(--fg-3)', fontWeight: 600 }}>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={inputStyle()}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}
function Field({ label, required, error, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600 }}>
        {label}{required && <span style={{ color: 'var(--bad)' }}> *</span>}
      </span>
      {children}
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
