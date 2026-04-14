import { useEffect, useState } from 'react'
import axios from 'axios'
import AdminLogin from './AdminLogin'
import AdminLayout from './AdminLayout'
import DoctorLayout from './DoctorLayout'
import { API_BASE, BASE_PATH, SLUG } from '../config'

export default function AdminRoot() {
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('clinika_admin_token'))
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(!!adminToken)

  useEffect(() => {
    if (!adminToken) {
      setChecking(false)
      return
    }
    axios
      .get(API_BASE + '/admins/me', {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      .then(res => {
        setUser(res.data)
      })
      .catch(err => {
        if (err?.response?.status === 401) {
          localStorage.removeItem('clinika_admin_token')
          setAdminToken(null)
        }
      })
      .finally(() => {
        setChecking(false)
      })
  }, [adminToken])

  const handleLogout = () => {
    localStorage.removeItem('clinika_admin_token')
    window.location.href = '/' + SLUG + '/'
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Проверка сессии...</p>
        </div>
      </div>
    )
  }

  if (!adminToken || !user) {
    return <AdminLogin />
  }

  // Врач → личный кабинет врача
  if (user.role === 'doctor') {
    return <DoctorLayout adminToken={adminToken} user={user} onLogout={handleLogout} />
  }

  // Менеджер, администратор, партнёр, super_admin → панель управления
  const allowedRoles = ['super_admin', 'manager', 'admin', 'partner']
  if (!allowedRoles.includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4"
        style={{ background: 'linear-gradient(135deg, #004D5F 0%, #00A7AA 100%)' }}>
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center">
          <div className="text-5xl mb-4">🚫</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Нет доступа</h1>
          <p className="text-gray-500 text-sm mb-6">
            Панель управления недоступна для вашей роли.
          </p>
          <button
            onClick={handleLogout}
            className="w-full bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl py-3 text-sm transition-colors"
          >
            Выйти
          </button>
        </div>
      </div>
    )
  }

  return <AdminLayout adminToken={adminToken} user={user} onLogout={handleLogout} />
}
