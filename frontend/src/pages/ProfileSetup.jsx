import { useState, useEffect } from 'react'
import { getClinics, updateMe, getMe } from '../api'
import useAuthStore from '../store/auth'

export default function ProfileSetup() {
  const { user, setUser } = useAuthStore()
  const [clinics, setClinics] = useState([])
  const [form, setForm] = useState({
    full_name: user?.full_name || '',
    phone_number: user?.phone_number || '',
    date_of_birth: user?.date_of_birth || '',
    clinic_id: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getClinics()
      .then(r => setClinics(r.data))
      .catch(() => {})
  }, [])

  const handleChange = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.clinic_id) {
      setError('Выберите клинику')
      return
    }
    setLoading(true)
    try {
      await updateMe({
        full_name: form.full_name,
        phone_number: form.phone_number,
        date_of_birth: form.date_of_birth || undefined,
        clinic_id: Number(form.clinic_id),
      })
      const meRes = await getMe()
      setUser(meRes.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Ошибка сохранения профиля')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-md">
            <span className="text-3xl">🏥</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Добро пожаловать!</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-2">
            Заполните профиль, чтобы начать работу
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Полное имя
              </label>
              <input
                required
                type="text"
                name="full_name"
                placeholder="Иванов Иван Иванович"
                value={form.full_name}
                onChange={handleChange}
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl p-3 text-gray-800 focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Номер телефона
              </label>
              <input
                required
                type="tel"
                name="phone_number"
                placeholder="+7 900 000-00-00"
                value={form.phone_number}
                onChange={handleChange}
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl p-3 text-gray-800 focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Дата рождения
              </label>
              <input
                type="date"
                name="date_of_birth"
                value={form.date_of_birth}
                onChange={handleChange}
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl p-3 text-gray-800 focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Ваша клиника
              </label>
              <select
                required
                name="clinic_id"
                value={form.clinic_id}
                onChange={handleChange}
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl p-3 text-gray-800 focus:outline-none focus:border-primary"
              >
                <option value="">Выберите клинику</option>
                {clinics.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl p-3">
                <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-white rounded-xl py-4 font-semibold text-lg disabled:opacity-50 mt-2"
            >
              {loading ? 'Сохранение...' : 'Сохранить и продолжить'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
