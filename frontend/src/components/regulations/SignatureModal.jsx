/**
 * ========================================
 * <SignatureModal> — модалка подтверждения ознакомления с регламентом
 * ========================================
 * Глава 7 — Регламент-конструктор. Сторона читателя.
 *
 * Поведение:
 *   1. Текст-обязательство: «Я ознакомлен(а) с регламентом…»
 *   2. Input «Введите ваше ФИО» — обязательное поле (минимум 3 символа)
 *   3. Проверка, что все required-чекбоксы (которые есть в шагах) — отмечены.
 *      Если нет — кнопка disabled, показываем подсказку «Не отмечены пункты: …»
 *   4. Submit → POST /regulations/{id}/complete c {signature_text, checkboxes_state}
 *   5. После success → toast + onComplete(callback с обновлением статуса).
 *
 * Props:
 *   open                — boolean
 *   onClose             — fn
 *   regulationId        — id регламента
 *   regulationTitle     — для отображения в заголовке
 *   checkboxesState     — { stepKey: bool } из RegulationViewer
 *   requiredCheckboxes  — [{ key, label }] для проверки заполненности
 *   onComplete          — fn(), вызывается после успешного complete
 *   defaultFullName     — string, подставится в input по умолчанию (из user.full_name)
 * ========================================
 */
import { useState, useEffect, useMemo } from 'react'
import api from '../../api'
import { Modal, Button, useToast } from '../../design'

export default function SignatureModal({
  open,
  onClose,
  regulationId,
  regulationTitle,
  checkboxesState = {},
  requiredCheckboxes = [],
  onComplete,
  defaultFullName = '',
}) {
  const { toast } = useToast()
  const [signature, setSignature] = useState(defaultFullName || '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Сбрасываем поле при открытии — подставляем ФИО заново
  useEffect(() => {
    if (open) {
      setSignature(defaultFullName || '')
      setError('')
    }
  }, [open, defaultFullName])

  // Проверяем — какие required-чекбоксы не отмечены
  const missingChecks = useMemo(() => {
    return requiredCheckboxes.filter(cb => !checkboxesState[cb.key])
  }, [requiredCheckboxes, checkboxesState])

  const trimmed = signature.trim()
  const signatureOk = trimmed.length >= 3
  const allChecksOk = missingChecks.length === 0
  const canSubmit = signatureOk && allChecksOk && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      await api.post(`/regulations/${regulationId}/complete`, {
        signature_text: trimmed,
        checkboxes_state: checkboxesState,
      })
      toast?.('Ознакомление подтверждено', 'success')
      if (typeof onComplete === 'function') onComplete()
      onClose?.()
    } catch (e) {
      const status = e?.response?.status
      const msg = e?.response?.data?.detail || e?.message || 'Не удалось подтвердить'
      if (status === 409) {
        // Уже подтверждено — это не ошибка, обновляем статус и закрываем
        toast?.('Регламент уже был подтверждён', 'info')
        if (typeof onComplete === 'function') onComplete()
        onClose?.()
      } else {
        setError(typeof msg === 'string' ? msg : 'Ошибка подтверждения')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="Подтверждение ознакомления"
      size="md"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? 'Подтверждаем…' : 'Подтвердить'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {regulationTitle && (
          <div
            style={{
              padding: '10px 12px',
              background: 'var(--bg-1)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--fg-2)',
            }}
          >
            <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', fontSize: 18, marginRight: 6, color: 'var(--accent)' }}>
              rule
            </span>
            {regulationTitle}
          </div>
        )}

        <div
          style={{
            padding: '12px 14px',
            background: 'var(--accent-soft)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            color: 'var(--fg)',
            fontSize: 13.5,
            lineHeight: 1.55,
          }}
        >
          <b>Я ознакомлен(а) с регламентом и обязуюсь его соблюдать.</b>
          <div style={{ marginTop: 6, color: 'var(--fg-3)', fontSize: 12.5 }}>
            Это подтверждение фиксируется в журнале сотрудника. При нарушении регламента
            могут применяться меры в соответствии с трудовым договором и внутренним
            распорядком клиники.
          </div>
        </div>

        {/* Список не отмеченных обязательных пунктов */}
        {!allChecksOk && (
          <div
            style={{
              padding: '10px 12px',
              background: 'var(--bad-soft, #fff1f0)',
              border: '1px solid var(--bad, #f87171)',
              borderRadius: 10,
              fontSize: 12.5,
              color: 'var(--bad, #b91c1c)',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              Не отмечены обязательные пункты ({missingChecks.length}):
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {missingChecks.slice(0, 5).map(c => (
                <li key={c.key} style={{ marginTop: 2 }}>{c.label}</li>
              ))}
              {missingChecks.length > 5 && (
                <li style={{ marginTop: 2, opacity: 0.7 }}>… и ещё {missingChecks.length - 5}</li>
              )}
            </ul>
          </div>
        )}

        {/* Подпись (ФИО) */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-2)' }}>
            Введите ваше ФИО для подтверждения <span style={{ color: 'var(--bad, #dc2626)' }}>*</span>
          </span>
          <input
            type="text"
            value={signature}
            onChange={e => setSignature(e.target.value)}
            placeholder="Иванов Иван Иванович"
            disabled={submitting}
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--fg)',
              fontSize: 14,
              outline: 'none',
            }}
            autoFocus
          />
          {!signatureOk && trimmed.length > 0 && (
            <span style={{ fontSize: 11.5, color: 'var(--bad, #dc2626)' }}>
              Минимум 3 символа
            </span>
          )}
        </label>

        {error && (
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--bad-soft, #fee2e2)',
              border: '1px solid var(--bad, #f87171)',
              borderRadius: 10,
              fontSize: 12.5,
              color: 'var(--bad, #b91c1c)',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ fontSize: 11.5, color: 'var(--fg-4)', lineHeight: 1.5 }}>
          Подпись будет привязана к вашему аккаунту, дате и времени подтверждения.
          Действие фиксируется в журнале ознакомлений и не может быть отменено.
        </div>
      </div>
    </Modal>
  )
}
