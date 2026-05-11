/**
 * ========================================
 * БЛОК: CancelModal — модал отмены подписки (Глава 9)
 * ========================================
 * Радио-причины отмены + textarea для комментария + предупреждение
 * о потере привилегий. Используется в PatientSubscriptionSection.
 *
 * Props:
 *   open      — boolean
 *   planName  — string
 *   expiresAt — ISO date (когда фактически закончится подписка)
 *   onClose   — () => void
 *   onSubmit  — ({reason, comment}) => Promise
 * ========================================
 */
import { useState } from 'react'
import { Modal, Button } from '../../design'

const REASONS = [
  { key: 'too_expensive',   label: 'Слишком дорого' },
  { key: 'not_using',       label: 'Не пользуюсь функциями' },
  { key: 'temporary',       label: 'Временно не нужно' },
  { key: 'switch_clinic',   label: 'Меняю клинику' },
  { key: 'tech_issues',     label: 'Технические проблемы' },
  { key: 'other',           label: 'Другая причина' },
]

export default function CancelModal({ open, planName = 'Здоровье+', expiresAt, onClose, onSubmit }) {
  const [reason, setReason] = useState('not_using')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const expiresStr = expiresAt
    ? new Date(expiresAt).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—'

  const submit = async () => {
    setBusy(true); setError('')
    try {
      await onSubmit({ reason, comment: comment.trim() })
      onClose?.()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось отменить подписку')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose?.()}
      title="Жалко терять…"
      size="md"
      actions={
        <div className="flex gap-2 justify-end w-full">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Передумал</Button>
          <Button variant="danger" onClick={submit} disabled={busy}>
            {busy ? 'Отмена…' : 'Всё равно отменить'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.2)' }}
        >
          <span
            className="material-symbols-outlined text-2xl flex-shrink-0"
            style={{ color: '#D97706', fontVariationSettings: "'FILL' 1" }}
          >
            sentiment_dissatisfied
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: '#92400E' }}>
              Подписка «{planName}» будет активна до {expiresStr}
            </p>
            <p className="text-xs mt-1" style={{ color: '#92400E' }}>
              После этой даты вы потеряете: безлимит чата, скидки на приёмы, ежемесячный расходник и приоритет записи.
            </p>
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold mb-2.5" style={{ color: '#0F172A' }}>Почему вы решили отменить?</p>
          <div className="flex flex-col gap-1.5">
            {REASONS.map(r => (
              <label
                key={r.key}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
                style={{
                  background: reason === r.key ? 'rgba(99,102,241,.06)' : 'transparent',
                  border: reason === r.key ? '1px solid rgba(99,102,241,.3)' : '1px solid rgba(0,0,0,.06)',
                }}
              >
                <input
                  type="radio"
                  name="cancel_reason"
                  value={r.key}
                  checked={reason === r.key}
                  onChange={() => setReason(r.key)}
                  style={{ accentColor: '#6366F1' }}
                />
                <span className="text-sm" style={{ color: '#334155' }}>{r.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-semibold mb-1.5 block" style={{ color: '#0F172A' }}>
            Комментарий <span style={{ color: '#94A3B8', fontWeight: 400 }}>(необязательно)</span>
          </label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Расскажите подробнее — это поможет нам стать лучше"
            rows={3}
            maxLength={500}
            className="w-full rounded-xl px-3 py-2 text-sm resize-none"
            style={{
              border: '1px solid rgba(0,0,0,.1)',
              background: '#F8FAFC',
              color: '#0F172A',
              outline: 'none',
            }}
          />
        </div>

        {error && (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: '#FEE2E2', color: '#991B1B' }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
