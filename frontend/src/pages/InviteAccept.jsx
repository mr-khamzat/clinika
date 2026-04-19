import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

export default function InviteAccept({ token }) {
  const [step, setStep] = useState('checking') // checking | form | success | error
  const [inviteData, setInviteData] = useState(null)
  const [form, setForm] = useState({ password: '', password2: '', full_name: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    axios.get(`${API_BASE}/recruiter/accept/${token}`)
      .then(res => {
        setInviteData(res.data)
        setStep('form')
      })
      .catch(err => {
        const msg = err?.response?.data?.detail || 'Ошибка проверки приглашения'
        setError(msg)
        setStep('error')
      })
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    if (form.password !== form.password2) { setError('Пароли не совпадают'); return }
    if (form.password.length < 6) { setError('Пароль минимум 6 символов'); return }
    setLoading(true); setError('')
    try {
      await axios.post(`${API_BASE}/recruiter/accept/${token}`, {
        password: form.password,
        full_name: form.full_name || undefined,
      })
      setStep('success')
    } catch (err) {
      setError(err?.response?.data?.detail || 'Ошибка регистрации')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'linear-gradient(135deg, #4c1d95 0%, #7c3aed 50%, #2563eb 100%)' }}>
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">👨‍⚕️</div>
          <h1 className="text-xl font-bold text-gray-800">КлиникаСеть</h1>
          <p className="text-sm text-gray-500 mt-1">Регистрация врача</p>
        </div>

        {step === 'checking' && (
          <div className="text-center py-8">
            <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Проверяем приглашение...</p>
          </div>
        )}

        {step === 'error' && (
          <div className="text-center py-4">
            <div className="text-4xl mb-3">❌</div>
            <p className="text-red-600 font-semibold mb-2">Ошибка</p>
            <p className="text-gray-500 text-sm">{error}</p>
          </div>
        )}

        {step === 'form' && (
          <>
            {inviteData?.recruiter_name && (
              <div className="bg-purple-50 rounded-xl p-3 text-sm text-purple-700 mb-4 text-center">
                Вас пригласил: <span className="font-semibold">{inviteData.recruiter_name}</span>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</label>
                <div className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-gray-50 text-gray-600">
                  {inviteData?.email}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ваше ФИО</label>
                <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="Иванов Иван Иванович"
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Пароль *</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Минимум 6 символов" required
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Повторите пароль *</label>
                <input type="password" value={form.password2} onChange={e => setForm(f => ({ ...f, password2: e.target.value }))}
                  placeholder="Повторите пароль" required
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
              {error && <p className="text-red-600 text-sm bg-red-50 rounded-xl px-3 py-2">{error}</p>}
              <button type="submit" disabled={loading}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold rounded-xl py-3 text-sm transition">
                {loading ? 'Регистрируемся...' : 'Создать аккаунт'}
              </button>
            </form>
          </>
        )}

        {step === 'success' && (
          <div className="text-center py-4">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-green-700 font-bold text-lg mb-2">Аккаунт создан!</p>
            <p className="text-gray-500 text-sm mb-6">Теперь вы можете войти в систему</p>
            <a href={'/' + SLUG + '/admin'}
              className="block w-full bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl py-3 text-sm text-center transition">
              Войти в кабинет
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
