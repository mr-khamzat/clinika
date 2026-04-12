import { useState } from 'react'
import useAuthStore from '../store/auth'
import { loginPassword, getMe } from '../api'

export default function Login() {
  const { setToken, setUser } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) {
      setError('Введите логин и пароль')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await loginPassword(username.trim(), password.trim())
      const token = res.data.access_token
      setToken(token)
      localStorage.setItem('clinika_token', token)
      const me = await getMe()
      setUser(me.data)
      window.location.reload()
    } catch (e) {
      const msg = e?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Неверный логин или пароль')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f9fb] flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-[440px] flex flex-col items-center">

        {/* Brand */}
        <header className="mb-10 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#dae5ff] mb-4">
            <span
              className="material-symbols-outlined text-[#1565c0]"
              style={{ fontSize: 36, fontVariationSettings: "'FILL' 1" }}
            >hub</span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#191c1e] font-headline">КлиникаСеть</h1>
          <p className="text-[11px] font-semibold text-[#727783] uppercase tracking-widest mt-1">Медицинская сеть</p>
        </header>

        {/* Card */}
        <section
          className="w-full bg-white px-8 py-10 rounded-3xl"
          style={{ boxShadow: '0 20px 40px rgba(0,77,153,0.06)' }}
        >
          <h2 className="text-2xl font-bold text-[#191c1e] font-headline mb-7">Вход в систему</h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Login */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-[#424752] uppercase tracking-widest pl-1">
                Логин
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#727783] text-xl select-none">
                  person
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Введите ваш логин"
                  autoComplete="username"
                  className="w-full bg-[#f2f4f6] rounded-xl py-3.5 pl-12 pr-4 text-[#191c1e] text-sm outline-none border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-[#424752] uppercase tracking-widest pl-1">
                Пароль
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#727783] text-xl select-none">
                  lock
                </span>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Введите пароль"
                  autoComplete="current-password"
                  className="w-full bg-[#f2f4f6] rounded-xl py-3.5 pl-12 pr-12 text-[#191c1e] text-sm outline-none border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#727783] hover:text-[#191c1e] transition-colors"
                >
                  <span className="material-symbols-outlined text-xl">
                    {showPass ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-[#ba1a1a] text-sm font-medium">
                <span className="material-symbols-outlined text-lg">error_outline</span>
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <div className="pt-1">
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#1565c0] hover:bg-[#004d99] text-white font-bold text-base py-4 rounded-2xl transition-all duration-200 active:scale-[0.98] disabled:opacity-60 font-headline"
                style={{ boxShadow: '0 8px 20px rgba(21,101,192,0.2)' }}
              >
                {loading ? 'Вход...' : 'Войти'}
              </button>
              <p className="mt-6 text-center text-sm text-[#727783]">
                Нет доступа? Обратитесь к администратору
              </p>
            </div>
          </form>
        </section>

        {/* Footer */}
        <footer className="mt-8 flex items-center gap-3">
          <span className="text-[10px] font-bold text-[#c2c6d4] bg-[#eceef0] px-2 py-0.5 rounded-full uppercase tracking-tighter">
            v2.1
          </span>
          <span className="h-1 w-1 rounded-full bg-[#c2c6d4]" />
          <p className="text-[11px] text-[#727783]">© КлиникаСеть 2025</p>
        </footer>
      </div>
    </div>
  )
}
