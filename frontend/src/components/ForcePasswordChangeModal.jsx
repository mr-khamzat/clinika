/**
 * ========================================
 * БЛОК: <ForcePasswordChangeModal>
 * ========================================
 * Блокирующая модалка по центру экрана, которая появляется при каждом входе,
 * пока сотрудник не сменит временный пароль, установленный администратором.
 *
 * Признак — флаг `user.password_must_change` (миграция pwdmust01). Бек
 * возвращает его в /admins/me. Фронт держит модалку открытой, пока флаг
 * TRUE; модалку нельзя закрыть никак, кроме успешной смены пароля.
 *
 * Поведение:
 *   - НЕТ кнопки «Закрыть» (X), нет ESC-выхода, нет клика по backdrop:
 *     это достигается тем, что мы не передаём `onClose` в <Modal>.
 *   - 3 поля: текущий пароль (тот, что задал админ), новый, повтор.
 *   - Сабмит → PATCH /profile/me { current_password, new_password }.
 *     Существующий эндпоинт уже сбрасывает password_must_change=False
 *     на бекенде (см. routers/profile.py).
 *
 * Props:
 *   open      — boolean
 *   onSuccess — () => void: вызывается после успешной смены пароля
 *
 * Все надписи на русском.
 * ========================================
 */
import { useState } from 'react'
import { Modal, Button, useToast } from '../design'
import api from '../api'

export default function ForcePasswordChangeModal({ open, onSuccess }) {
  const toast = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md, 8px)',
    background: 'var(--bg)',
    color: 'var(--fg)',
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 120ms ease',
    boxSizing: 'border-box',
  }
  const labelStyle = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--fg-2)',
    marginBottom: 6,
    letterSpacing: '0.01em',
  }

  async function submit(e) {
    e?.preventDefault?.()
    setError('')

    // Клиентская валидация
    if (!currentPassword) {
      setError('Введите временный пароль (тот, что задал администратор)')
      return
    }
    if (!newPassword || newPassword.length < 6) {
      setError('Новый пароль должен быть не короче 6 символов')
      return
    }
    if (newPassword !== repeatPassword) {
      setError('Пароли не совпадают')
      return
    }
    if (newPassword === currentPassword) {
      setError('Новый пароль должен отличаться от временного')
      return
    }

    setSaving(true)
    try {
      await api.patch('/profile/me', {
        current_password: currentPassword,
        new_password: newPassword,
      })
      try { toast?.success?.('Пароль успешно изменён') } catch (_e) { /* noop */ }
      // Очищаем поля на случай повторного открытия (мало ли)
      setCurrentPassword('')
      setNewPassword('')
      setRepeatPassword('')
      onSuccess && onSuccess()
    } catch (err) {
      const detail = err?.response?.data?.detail || 'Не удалось изменить пароль'
      setError(typeof detail === 'string' ? detail : 'Ошибка смены пароля')
    } finally {
      setSaving(false)
    }
  }

  return (
    // ВАЖНО: не передаём onClose — модалка становится неотменяемой:
    // нет X-кнопки, ESC и клик по backdrop ни к чему не приводят.
    <Modal open={open} title="Смена временного пароля" size="sm">
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{
          padding: 12,
          background: 'var(--bg-2, rgba(255, 200, 80, 0.08))',
          border: '1px solid var(--warning, #f59e0b)',
          borderRadius: 'var(--radius-md, 8px)',
          fontSize: 13,
          color: 'var(--fg-2)',
          lineHeight: 1.5,
        }}>
          Для безопасности требуется сменить временный пароль, установленный
          администратором, перед началом работы. Без этого продолжить нельзя.
        </div>

        <div>
          <label style={labelStyle} htmlFor="fpc-current">Текущий (временный) пароль</label>
          <input
            id="fpc-current"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            style={inputStyle}
            placeholder="Пароль, который выдал администратор"
            disabled={saving}
            autoFocus
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="fpc-new">Новый пароль</label>
          <input
            id="fpc-new"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={inputStyle}
            placeholder="Не короче 6 символов"
            disabled={saving}
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="fpc-repeat">Повторите новый пароль</label>
          <input
            id="fpc-repeat"
            type="password"
            autoComplete="new-password"
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
            style={inputStyle}
            placeholder="Повтор для проверки"
            disabled={saving}
          />
        </div>

        {error && (
          <div style={{
            padding: '8px 12px',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid #ef4444',
            color: '#ef4444',
            borderRadius: 'var(--radius-md, 8px)',
            fontSize: 13,
            lineHeight: 1.4,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить новый пароль'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
