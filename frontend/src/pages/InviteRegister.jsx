/**
 * ========================================
 * БЛОК: Регистрация партнёра по инвайт-коду
 * ========================================
 * Страница открывается по ссылке /clinika/invite/:code
 * Не требует авторизации — доступна для всех.
 * После регистрации сохраняет токен и перенаправляет в приложение.
 *
 * Расширение: добавить выбор специализации, загрузку фото профиля и т.д.
 * ========================================
 */
import { useState, useEffect } from 'react'
import { getInviteInfo, registerByInvite, getMe } from '../api'
import useAuthStore from '../store/auth'
import { API_BASE, BASE_PATH, SLUG } from '../config'

export default function InviteRegister({ code }) {
  const { setToken, setUser } = useAuthStore()

  // ─── Состояние: информация об инвайте ───
  const [inviteInfo, setInviteInfo] = useState(null)
  const [loadingInfo, setLoadingInfo] = useState(true)

  // ─── Состояние: форма регистрации ───
  const [form, setForm] = useState({ full_name: '', phone_number: '+7', password: '', password2: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ─── Загружаем информацию об инвайте ───
  useEffect(() => {
    if (!code) return
    getInviteInfo(code)
      .then(r => setInviteInfo(r.data))
      .catch(() => setInviteInfo({ valid: false, clinic_name: 'Ошибка загрузки' }))
      .finally(() => setLoadingInfo(false))
  }, [code])

  // ─── Форматирование телефона ───
  const formatPhone = (val) => {
    if (!val.startsWith('+7')) return '+7'
    const digits = val.slice(2).replace(/\D/g, '')
    let out = '+7'
    if (digits.length > 0) out += ' (' + digits.slice(0, 3)
    if (digits.length >= 3) out += ') ' + digits.slice(3, 6)
    if (digits.length >= 6) out += '-' + digits.slice(6, 8)
    if (digits.length >= 8) out += '-' + digits.slice(8, 10)
    return out
  }

  // ─── Обработка регистрации ───
  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!form.full_name.trim()) {
      setError('Введите ФИО')
      return
    }
    if (form.phone_number.replace(/\D/g, '').length < 11) {
      setError('Введите полный номер телефона')
      return
    }
    if (form.password.length < 4) {
      setError('Пароль должен быть не менее 4 символов')
      return
    }
    if (form.password !== form.password2) {
      setError('Пароли не совпадают')
      return
    }

    setLoading(true)
    try {
      const res = await registerByInvite({
        code,
        full_name: form.full_name.trim(),
        phone_number: form.phone_number,
        password: form.password,
      })
      // Сохраняем токен и получаем данные пользователя
      setToken(res.data.access_token)
      // Сохраняем refresh-токен для auto-refresh
      if (res.data?.refresh_token) {
        localStorage.setItem('clinika_refresh_token_' + SLUG, res.data.refresh_token)
      }
      const meRes = await getMe()
      setUser(meRes.data)
      // Перенаправляем в приложение
      window.location.href = '/' + SLUG + '/'
    } catch (err) {
      const msg = err?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Ошибка регистрации')
    } finally {
      setLoading(false)
    }
  }

  // ─── Загрузка ───
  if (loadingInfo) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ─── Недействительный инвайт ───
  if (!inviteInfo?.valid) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-6">
        <div className="w-full max-w-sm text-center">
          <div className="text-6xl mb-4">🔗</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Ссылка недействительна</h1>
          <p className="text-gray-500 text-sm">
            {inviteInfo?.clinic_name || 'Эта инвайт-ссылка устарела или уже была использована.'}
          </p>
          <p className="text-gray-400 text-xs mt-3">Обратитесь к администратору клиники для получения новой ссылки.</p>
        </div>
      </div>
    )
  }

  // ─── Форма регистрации ───
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">

        {/* Заголовок */}
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🏥</div>
          <h1 className="text-xl font-bold text-gray-800">Регистрация партнёра</h1>
          <p className="text-sm text-gray-500 mt-1">Вас приглашают в</p>
          <p className="text-base font-semibold text-primary mt-0.5">{inviteInfo.clinic_name}</p>
        </div>

        {/* Форма */}
        <div className="bg-white rounded-2xl p-6 shadow-lg">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
              <p className="text-red-600 text-sm text-center">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">

            {/* ФИО */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                ФИО <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder="Иванов Иван Иванович"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 focus:outline-none focus:border-primary"
              />
            </div>

            {/* Телефон — станет логином */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Телефон (будет логином) <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                value={form.phone_number}
                onChange={e => setForm(f => ({ ...f, phone_number: formatPhone(e.target.value) }))}
                placeholder="+7 (900) 000-00-00"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 focus:outline-none focus:border-primary"
              />
            </div>

            {/* Пароль */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Пароль <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Минимум 4 символа"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 focus:outline-none focus:border-primary"
              />
            </div>

            {/* Повтор пароля */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Повторите пароль <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={form.password2}
                onChange={e => setForm(f => ({ ...f, password2: e.target.value }))}
                placeholder="Повторите пароль"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 focus:outline-none focus:border-primary"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-50 mt-1"
            >
              {loading ? 'Регистрация...' : 'Зарегистрироваться'}
            </button>
          </form>

          {/* Подсказка для повторного входа */}
          <p className="text-xs text-gray-400 text-center mt-4">
            Для повторного входа используйте телефон и пароль
          </p>
        </div>
      </div>
    </div>
  )
}
