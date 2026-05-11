/**
 * ========================================
 * БЛОК: LeadCard — карточка лида от агрегатора (Глава 10)
 * ========================================
 * Используется внутри AdminAggregatorSection — список заявок от партнёров
 * (DocDoc / ПроДокторов / Yandex Health / прочее).
 *
 * Workflow статусов: received → contacted → scheduled → completed | lost
 * Каждый переход — отдельная кнопка действия.
 *
 * Props:
 *   - lead: объект с полями {id, partner_name, patient_phone,
 *           patient_full_name, clinic_name, service_requested, desired_date,
 *           status, commission_amount, appointment_id, created_at}
 *   - onAction({id, status, appointment_id?, commission_amount?}) — async
 *   - busy: bool — блокирует все кнопки во время запроса
 * ========================================
 */
import { useState } from 'react'

const STATUS_META = {
  received:  { label: 'Получен',   color: '#0369a1', bg: '#dbeafe' },
  contacted: { label: 'Контакт',   color: '#92400e', bg: '#fef3c7' },
  scheduled: { label: 'Записан',   color: '#7c3aed', bg: '#ede9fe' },
  completed: { label: 'Завершён',  color: '#166534', bg: '#dcfce7' },
  lost:      { label: 'Потерян',   color: '#991b1b', bg: '#fee2e2' },
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

function fmtMoney(v) {
  const n = Number(v || 0)
  if (!Number.isFinite(n) || !n) return null
  return `${n.toLocaleString('ru')} ₽`
}

export default function LeadCard({ lead, onAction, busy }) {
  const [showCompleteForm, setShowCompleteForm] = useState(false)
  const [commission, setCommission] = useState(lead.commission_amount || '')
  const meta = STATUS_META[lead.status] || STATUS_META.received
  const isClosed = lead.status === 'completed' || lead.status === 'lost'

  const phone = lead.patient_phone || '—'
  const name  = lead.patient_full_name || '— без ФИО —'

  return (
    <div
      className="rounded-2xl p-4 transition-shadow"
      style={{
        background: 'var(--surface, #fff)',
        border: '1px solid var(--border, #e5e7eb)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      }}
    >
      {/* Заголовок: партнёр + статус */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="material-symbols-outlined flex-shrink-0"
              style={{ fontSize: 16, color: 'var(--accent, #0097A7)' }}
            >campaign</span>
            <span
              className="font-bold truncate"
              style={{ fontSize: 13, color: 'var(--fg, #0f172a)' }}
            >{lead.partner_name || 'Партнёр'}</span>
          </div>
          <div className="text-xs" style={{ color: 'var(--fg-3, #64748b)' }}>
            {fmtDate(lead.created_at)}
          </div>
        </div>
        <span
          style={{
            padding: '3px 9px', borderRadius: 999,
            background: meta.bg, color: meta.color,
            fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
          }}
        >{meta.label}</span>
      </div>

      {/* Контент */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <Info icon="person" label="ФИО" value={name} />
        <Info icon="call" label="Телефон" value={phone} mono />
        <Info icon="local_hospital" label="Клиника" value={lead.clinic_name || '— не выбрана —'} />
        <Info icon="medical_services" label="Услуга" value={lead.service_requested || '—'} />
        {lead.desired_date && (
          <Info icon="event" label="Желаемая дата" value={fmtDate(lead.desired_date)} />
        )}
        {lead.commission_amount ? (
          <Info icon="payments" label="Комиссия" value={fmtMoney(lead.commission_amount) || '—'} />
        ) : null}
      </div>

      {/* Действия */}
      {!isClosed && (
        <div className="flex flex-wrap items-center gap-1.5 pt-3" style={{ borderTop: '1px dashed #f1f5f9' }}>
          {lead.status === 'received' && (
            <ActionButton
              icon="phone_in_talk"
              label="Связаться"
              tone="primary"
              disabled={busy}
              onClick={() => onAction({ id: lead.id, status: 'contacted' })}
            />
          )}
          {(lead.status === 'received' || lead.status === 'contacted') && (
            <ActionButton
              icon="event_available"
              label="Записать"
              tone="accent"
              disabled={busy}
              onClick={() => onAction({ id: lead.id, status: 'scheduled' })}
            />
          )}
          {lead.status === 'scheduled' && !showCompleteForm && (
            <ActionButton
              icon="task_alt"
              label="Завершить"
              tone="ok"
              disabled={busy}
              onClick={() => setShowCompleteForm(true)}
            />
          )}
          <ActionButton
            icon="close"
            label="Потеряно"
            tone="bad"
            disabled={busy}
            onClick={() => onAction({ id: lead.id, status: 'lost' })}
          />
        </div>
      )}

      {/* Форма завершения — вводим комиссию */}
      {showCompleteForm && (
        <div
          className="mt-3 p-3 rounded-xl"
          style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}
        >
          <div className="text-xs font-bold mb-2" style={{ color: '#166534', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Комиссия за лид (₽)
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="1"
              value={commission}
              onChange={e => setCommission(e.target.value)}
              placeholder="0"
              className="flex-1 rounded-lg"
              style={{ padding: '8px 10px', border: '1px solid #bbf7d0', fontSize: 13, outline: 'none', background: '#fff', fontVariantNumeric: 'tabular-nums' }}
              autoFocus
            />
            <button
              onClick={async () => {
                await onAction({
                  id: lead.id,
                  status: 'completed',
                  commission_amount: commission ? Number(commission) : 0,
                })
                setShowCompleteForm(false)
              }}
              disabled={busy}
              className="rounded-lg px-3 py-2 text-xs font-bold text-white"
              style={{ background: '#15803d' }}
            >Подтвердить</button>
            <button
              onClick={() => setShowCompleteForm(false)}
              disabled={busy}
              className="rounded-lg px-3 py-2 text-xs font-semibold"
              style={{ background: '#f1f5f9', color: '#475569' }}
            >Отмена</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Info({ icon, label, value, mono }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span
        className="material-symbols-outlined flex-shrink-0"
        style={{ fontSize: 15, color: 'var(--fg-3, #64748b)', marginTop: 1 }}
      >{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] uppercase font-bold tracking-wide" style={{ color: 'var(--fg-4, #94a3b8)' }}>
          {label}
        </div>
        <div
          className="text-xs truncate"
          style={{
            color: 'var(--fg, #0f172a)',
            fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : undefined,
            fontWeight: 500,
          }}
        >{value}</div>
      </div>
    </div>
  )
}

function ActionButton({ icon, label, tone, disabled, onClick }) {
  const palette = {
    primary: { bg: '#0ea5e9', color: '#fff' },
    accent:  { bg: '#0097A7', color: '#fff' },
    ok:      { bg: '#15803d', color: '#fff' },
    bad:     { bg: '#fee2e2', color: '#991b1b' },
  }[tone] || { bg: '#f1f5f9', color: '#475569' }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-lg text-xs font-bold transition-transform active:scale-95"
      style={{
        background: palette.bg,
        color: palette.color,
        padding: '6px 10px',
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{icon}</span>
      {label}
    </button>
  )
}
