/**
 * Страница сброса пароля по одноразовому токену из email.
 *
 * URL: /reset-password?token=XXX (root) или /<slug>/reset-password?token=XXX
 * Без auth. Токен берётся из ?token=, новый пароль — из формы.
 *
 * Backend: POST /auth/reset-password { token, new_password }
 */
import { useState, useEffect, useMemo } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

export default function ResetPassword() {
  const token = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('token') || ''
    } catch {
      return ''
    }
  }, [])

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) setError('Ссылка некорректна — отсутствует токен')
  }, [token])

  const validate = () => {
    if (!password || password.length < 8) return 'Пароль должен быть не короче 8 символов'
    if (!/[A-Za-zА-Яа-яЁё]/.test(password)) return 'Пароль должен содержать хотя бы одну букву'
    if (!/\d/.test(password)) return 'Пароль должен содержать хотя бы одну цифру'
    if (password !== confirm) return 'Пароли не совпадают'
    return ''
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const v = validate()
    if (v) { setError(v); return }
    setLoading(true)
    setError('')
    try {
      await axios.post(API_BASE + '/auth/reset-password', { token, new_password: password })
      setDone(true)
    } catch (err) {
      const msg = err?.response?.data?.detail
      if (Array.isArray(msg) && msg[0]?.msg) {
        setError(msg[0].msg.replace(/^Value error,\s*/, ''))
      } else if (typeof msg === 'string') {
        setError(msg)
      } else {
        setError('Не удалось сбросить пароль. Возможно, ссылка устарела.')
      }
    } finally {
      setLoading(false)
    }
  }

  const goLogin = () => {
    // Редирект на /{slug}/admin (страница логина админа); если slug пустой — на /admin
    if (SLUG) window.location.href = '/' + SLUG + '/admin'
    else window.location.href = '/admin'
  }

  return (
    <div className="min-h-screen bg-[#f7f9fb] flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-[440px] flex flex-col items-center">
        <header className="mb-10 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#dae5ff] mb-4">
            <span
              className="material-symbols-outlined text-[#1565c0]"
              style={{ fontSize: 36, fontVariationSettings: "'FILL' 1" }}
            >lock_reset</span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#191c1e]">КлиникСеть</h1>
          <p className="text-[11px] font-semibold text-[#727783] uppercase tracking-widest mt-1">
            Сброс пароля
          </p>
        </header>

        <section
          className="w-full bg-white px-8 py-10 rounded-3xl"
          style={{ boxShadow: '0 20px 40px rgba(0,77,153,0.06)' }}
        >
          {done ? (
            <>
              <h2 className="text-2xl font-bold text-[#191c1e] mb-3">Пароль обновлён</h2>
              <p className="text-sm text-[#727783] mb-6">
                Вы можете войти в систему с новым паролем.
              </p>
              <button
                onClick={goLogin}
                className="w-full bg-[#1565c0] hover:bg-[#004d99] text-white font-bold text-base py-4 rounded-2xl"
              >
                Войти
              </button>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-[#191c1e] mb-7">Новый пароль</h2>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-[#424752] uppercase tracking-widest pl-1">
                    Новый пароль
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#727783] text-xl select-none">
                      lock
                    </span>
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Минимум 8 символов, буква + цифра"
                      autoComplete="new-password"
                      className="w-full bg-[#f2f4f6] rounded-xl py-3.5 pl-12 pr-12 text-[#191c1e] text-sm outline-none border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(v => !v)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-[#727783] hover:text-[#191c1e]"
                    >
                      <span className="material-symbols-outlined text-xl">
                        {showPass ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-[#424752] uppercase tracking-widest pl-1">
                    Повторите пароль
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#727783] text-xl select-none">
                      check
                    </span>
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      autoComplete="new-password"
                      className="w-full bg-[#f2f4f6] rounded-xl py-3.5 pl-12 pr-4 text-[#191c1e] text-sm outline-none border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white"
                    />
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-[#ba1a1a] text-sm font-medium">
                    <span className="material-symbols-outlined text-lg">error_outline</span>
                    <span>{error}</span>
                  </div>
                )}

                <div className="pt-1">
                  <button
                    type="submit"
                    disabled={loading || !token}
                    className="w-full bg-[#1565c0] hover:bg-[#004d99] text-white font-bold text-base py-4 rounded-2xl disabled:opacity-60"
                  >
                    {loading ? 'Сохраняем…' : 'Установить пароль'}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>

        <footer className="mt-8 flex items-center gap-3">
          <p className="text-[11px] text-[#727783]">© КлиникСеть 2025</p>
        </footer>
      </div>
    </div>
  )
}
