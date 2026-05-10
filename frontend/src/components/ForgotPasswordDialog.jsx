/**
 * Мини-диалог «Забыли пароль?»: ввод email → POST /auth/forgot-password.
 * Используется в Login.jsx и AdminLogin.jsx — обоих экранах входа.
 *
 * Backend всегда возвращает 200 (защита от user-enumeration), поэтому в UI
 * мы тоже показываем универсальное сообщение «если такой email есть — письмо
 * отправлено», независимо от того, существует ли пользователь.
 */
import { useState } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

export default function ForgotPasswordDialog({ open, onClose }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !/.+@.+\..+/.test(email)) {
      setError('Введите корректный email')
      return
    }
    setLoading(true)
    try {
      await axios.post(API_BASE + '/auth/forgot-password', {
        email: email.trim(),
        tenant_slug: SLUG || null,
      })
      setDone(true)
    } catch {
      // 422/429 — всё равно показываем универсальный экран
      setDone(true)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setEmail('')
    setDone(false)
    setError('')
    onClose && onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 sm:p-8 w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-bold text-[#191c1e]">
            {done ? 'Проверьте почту' : 'Восстановление пароля'}
          </h3>
          <button
            onClick={handleClose}
            className="text-[#727783] hover:text-[#191c1e]"
            aria-label="Закрыть"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {done ? (
          <>
            <p className="text-sm text-[#424752] mb-5">
              Если такой email зарегистрирован в системе — мы отправили письмо
              со ссылкой для сброса пароля. Ссылка действительна 1 час.
            </p>
            <button
              onClick={handleClose}
              className="w-full bg-[#1565c0] hover:bg-[#004d99] text-white font-semibold py-3 rounded-xl text-sm"
            >
              Понятно
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="text-sm text-[#424752] mb-4">
              Укажите email вашей учётной записи. Мы пришлём ссылку для сброса пароля.
            </p>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
              autoComplete="email"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-[#191c1e] text-sm outline-none focus:border-[#1565c0] focus:ring-2 focus:ring-clinical-100"
            />
            {error && (
              <p className="text-[#ba1a1a] text-xs mt-2">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="mt-5 w-full bg-[#1565c0] hover:bg-[#004d99] disabled:opacity-60 text-white font-semibold py-3 rounded-xl text-sm"
            >
              {loading ? 'Отправляем…' : 'Отправить ссылку'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
