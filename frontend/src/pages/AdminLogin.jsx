import { useState } from 'react'
import axios from 'axios'
import { API_BASE, BASE_PATH, SLUG } from '../config'

export default function AdminLogin() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await axios.post(API_BASE + '/auth/login', { username, password })
      const data = res.data
      const redirect = data.redirect_url || ('/' + (data.tenant_slug || SLUG) + '/')
      const slug = data.tenant_slug || SLUG || 'arc'
      // Если открыли тенант-панель (/arc/admin), не редиректить на /admin
      const finalRedirect = SLUG && redirect === '/admin' ? '/' + SLUG + '/admin' : redirect
      // Все роли кроме partner идут в /{slug}/admin → clinika_admin_token_{slug}
      // partner идёт в /{slug}/ → clinika_token_{slug}
      const isAdminPanel = finalRedirect === '/admin' || finalRedirect.endsWith('/admin')
      if (isAdminPanel) {
        const storageSlug = finalRedirect === '/admin' ? '' : slug
        localStorage.setItem('clinika_admin_token_' + storageSlug, data.access_token)
      } else {
        localStorage.setItem('clinika_token_' + slug, data.access_token)
      }
      window.location.href = finalRedirect
    } catch {
      setError('Неверный логин или пароль')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'linear-gradient(135deg, #004D5F 0%, #00A7AA 100%)' }}
    >
      <div className="bg-white rounded-2xl shadow-2xl p-8 sm:p-10 w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-clinical-50 rounded-2xl flex items-center justify-center mb-4">
            <span className="text-4xl">🏥</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 text-center">КлиникСеть</h1>
          <p className="text-gray-400 text-sm mt-1">Панель управления</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-5">
            <p className="text-red-600 text-sm text-center">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-600 mb-1.5">
              Логин
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-clinical-100 transition"
              placeholder="Введите логин"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-600 mb-1.5">
              Пароль
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-clinical-100 transition"
              placeholder="Введите пароль"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full bg-primary hover:bg-primary-dark disabled:opacity-60 text-white font-semibold rounded-xl py-3 text-sm transition-colors"
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  )
}
