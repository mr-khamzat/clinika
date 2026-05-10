/**
 * ========================================
 * БЛОК: <ImpersonateModal> — окно подтверждения impersonation
 * ========================================
 * Открывается при клике «Войти как» у конкретного пользователя.
 * Поля:
 *   • Имя пользователя (read-only, для контекста)
 *   • Причина (textarea, ≤500 символов, required)
 *   • Checkbox «Я понимаю что все действия будут записаны» (required)
 *   • Для роли patient — дополнительный checkbox «Confirm 152-ФЗ»
 *
 * При успехе:
 *   1. Сохраняет текущий super_admin-токен в localStorage.clinika_impersonation_origin
 *   2. Получает новый JWT и кладёт в localStorage.clinika_admin_token_<tenant_slug>
 *   3. window.location.href = redirect_url (например /<slug>/admin)
 * ========================================
 */
import { useState } from 'react'
import api from '../api'
import { SLUG } from '../config'

const ROLE_LABELS = {
  reg:             'Регистратор',
  manager:         'Руководитель',
  franchise_owner: 'Владелец франшизы',
  doctor:          'Врач',
  partner_doctor:  'Врач-партнёр',
  nurse:           'Медсестра',
  recruiter:       'Менеджер',
  visiting_doctor: 'Выездной врач',
  patient:         'Пациент',
}

export default function ImpersonateModal({ user, onClose }) {
  const [reason, setReason]       = useState('')
  const [ack, setAck]             = useState(false)
  const [sensitiveAck, setSenAck] = useState(false)
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState('')

  if (!user) return null

  const isPatient = user.role === 'patient'
  const canSubmit = reason.trim().length >= 3 && ack && (!isPatient || sensitiveAck) && !busy

  async function handleConfirm() {
    if (!canSubmit) return
    setBusy(true); setErr('')
    try {
      const body = {
        target_user_id: user.id,
        reason: reason.trim().slice(0, 500),
        confirm_sensitive: isPatient ? sensitiveAck : false,
      }
      const r = await api.post('/admin/impersonate', body)
      const d = r.data || {}
      const newToken = d.access_token
      const tenantSlug = d.tenant_slug || ''
      const redirect  = d.redirect_url || (tenantSlug ? `/${tenantSlug}/admin` : '/admin')

      // 1. Сохраняем оригинальный super_admin-токен в origin (для безопасного возврата)
      try {
        const currentSuper = localStorage.getItem('clinika_admin_token_' + SLUG)
        if (currentSuper) {
          localStorage.setItem('clinika_impersonation_origin', currentSuper)
        }
      } catch (_) { /* noop */ }

      // 2. Кладём impersonation-токен в admin-сторадж под нужным слагом.
      //    api/index.js определяет слаг динамически по URL — после redirect токен подхватится.
      try {
        if (tenantSlug) {
          localStorage.setItem('clinika_admin_token_' + tenantSlug, newToken)
          // Не трогаем clinika_admin_token_<original_slug> (там лежит origin для отката)
          // → но в импersonation-кабинете API_BASE построится по новому SLUG
        } else {
          localStorage.setItem('clinika_admin_token_', newToken)
        }
      } catch (e) {
        setErr('Не удалось сохранить токен: ' + e.message)
        setBusy(false)
        return
      }

      // 3. Hard redirect — гарантирует чистый рендер с новым контекстом тенанта
      window.location.href = redirect
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || 'Не удалось начать сессию'
      setErr(typeof detail === 'string' ? detail : 'Ошибка')
      setBusy(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg, #fff)',
          borderRadius: 16,
          width: '100%', maxWidth: 480,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          overflow: 'hidden',
          animation: 'imp-modal-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px',
          background: 'linear-gradient(135deg, #b45309 0%, #92400e 100%)',
          color: '#fff',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 28 }}>visibility</span>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
              Войти как «{user.full_name || user.username}»
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.92 }}>
              {ROLE_LABELS[user.role] || user.role}
              {user.tenant_id && <span style={{ opacity: 0.7 }}> · tenant {String(user.tenant_id).slice(0, 8)}</span>}
            </p>
          </div>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}
            aria-label="Закрыть">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            background: 'rgba(220, 38, 38, 0.08)',
            border: '1px solid rgba(220, 38, 38, 0.22)',
            borderRadius: 10, padding: '12px 14px',
            fontSize: 13, color: 'var(--fg, #1f2937)', lineHeight: 1.5,
          }}>
            <strong style={{ color: '#b91c1c' }}>Внимание:</strong> вы получите полный
            доступ к данным выбранного пользователя. Каждое ваше действие будет
            записано в аудит-журнал с привязкой к вашему ID (RFC 8693 token exchange,
            <code style={{ background: '#fff5', padding: '0 4px', borderRadius: 4 }}>act</code> claim).
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg, #374151)' }}>
              Причина <span style={{ color: '#dc2626' }}>*</span>
              <span style={{ fontWeight: 400, opacity: 0.65, marginLeft: 6 }}>
                {reason.length}/500
              </span>
            </span>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value.slice(0, 500))}
              rows={3}
              placeholder="Например: помощь клиенту #12345 — пользователь не может выгрузить отчёт"
              autoFocus
              style={{
                border: '1px solid var(--border, #d1d5db)',
                borderRadius: 8, padding: '10px 12px',
                fontFamily: 'inherit', fontSize: 14,
                resize: 'vertical', minHeight: 60,
                background: 'var(--bg, #fff)', color: 'var(--fg, #111827)',
              }}
            />
          </label>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={ack}
              onChange={e => setAck(e.target.checked)}
              style={{ marginTop: 3, width: 17, height: 17, accentColor: '#dc2626' }}
            />
            <span style={{ color: 'var(--fg, #374151)', lineHeight: 1.5 }}>
              Я понимаю, что все мои действия в этой сессии будут записаны
              в audit-журнал и привязаны к моей учётной записи.
            </span>
          </label>

          {isPatient && (
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13,
              background: 'rgba(217, 119, 6, 0.08)', padding: '10px 12px', borderRadius: 8,
              border: '1px solid rgba(217, 119, 6, 0.25)',
            }}>
              <input
                type="checkbox"
                checked={sensitiveAck}
                onChange={e => setSenAck(e.target.checked)}
                style={{ marginTop: 3, width: 17, height: 17, accentColor: '#b45309' }}
              />
              <span style={{ color: '#92400e', lineHeight: 1.5 }}>
                <strong>152-ФЗ / GDPR:</strong> вход в личный кабинет пациента
                означает доступ к персональным медицинским данным. Подтверждаю,
                что у меня есть законное основание для этого действия.
              </span>
            </label>
          )}

          {err && (
            <div style={{
              background: 'rgba(220, 38, 38, 0.1)',
              border: '1px solid rgba(220, 38, 38, 0.3)',
              borderRadius: 8, padding: '10px 12px',
              fontSize: 13, color: '#b91c1c',
            }}>
              {err}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 22px', borderTop: '1px solid var(--border, #e5e7eb)',
          display: 'flex', justifyContent: 'flex-end', gap: 10,
          background: 'var(--bg-2, #f9fafb)',
        }}>
          <button onClick={onClose} disabled={busy}
            style={{
              padding: '9px 18px', borderRadius: 8,
              background: 'transparent', border: '1px solid var(--border, #d1d5db)',
              color: 'var(--fg, #374151)', fontSize: 14, fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer',
            }}>
            Отмена
          </button>
          <button onClick={handleConfirm} disabled={!canSubmit}
            style={{
              padding: '9px 18px', borderRadius: 8,
              background: canSubmit ? '#dc2626' : '#fca5a5',
              border: 'none', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              transition: 'background 150ms',
              minWidth: 130,
            }}>
            {busy ? 'Запуск…' : '👁 Войти в кабинет'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes imp-modal-in {
          from { opacity: 0; transform: translateY(12px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
      `}</style>
    </div>
  )
}
