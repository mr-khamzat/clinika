import { useEffect, useState } from 'react'
import axios from 'axios'
import AdminLogin from './AdminLogin'
import AdminLayout from './AdminLayout'
import DoctorLayout from './DoctorLayout'
import OperationalCabinet from './OperationalCabinet'
import RecruiterCabinet from './RecruiterCabinet'
import SupervisorCabinet from './SupervisorCabinet'
import AcquisitionManagerCabinet from './AcquisitionManagerCabinet'
import ExternalDoctorCabinet from './ExternalDoctorCabinet'
import VisitingDoctorCabinet from './VisitingDoctorCabinet'
import InviteAccept from './InviteAccept'
import { API_BASE, BASE_PATH, SLUG } from '../config'

// Проверяем — вдруг это страница принятия приглашения: /invite/{token}
function getInviteToken() {
  const m = window.location.pathname.match(/\/invite\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

export default function AdminRoot() {
  const inviteToken = getInviteToken()

  // Страница принятия приглашения — показываем сразу, без логина
  if (inviteToken) {
    return <InviteAccept token={inviteToken} />
  }

  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('clinika_admin_token_' + SLUG))
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
        const u = res.data
        const role = (u.role || '').toLowerCase()
        u.role = role
        const slug = u.tenant_slug
        const isSuperAdmin = u.is_superadmin || u.is_super || role === 'super_admin'

        if (role === 'partner') {
          window.location.href = '/' + (slug || SLUG) + '/'
          return
        }

        if (!isSuperAdmin && slug && slug !== SLUG) {
          window.location.href = '/' + slug + '/admin'
          return
        }

        setUser(u)
      })
      .catch(err => {
        if (err?.response?.status === 401) {
          localStorage.removeItem('clinika_admin_token_' + SLUG)
          setAdminToken(null)
        }
      })
      .finally(() => {
        setChecking(false)
      })
  }, [adminToken])

  const handleLogout = () => {
    localStorage.removeItem('clinika_admin_token_' + SLUG)
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

  const role = user.role

  // ── Врач → личный кабинет врача
  if (role === 'doctor') {
    return <DoctorLayout adminToken={adminToken} user={user} onLogout={handleLogout} />
  }

  // ── Администратор / Медсестра → операционный кабинет
  if (role === 'admin' || role === 'nurse') {
    return <OperationalCabinet adminToken={adminToken} user={user} onLogout={handleLogout} />
  }

  // ── Менеджер по привлечению
  if (role === 'acquisition_manager') {
    return <AcquisitionManagerCabinet adminToken={adminToken} user={user} onLogout={handleLogout} />
  }

  // ── Внешний врач
  if (role === 'external_doctor') {
    return <ExternalDoctorCabinet adminToken={adminToken} user={user} onLogout={handleLogout} />
  }

  // ── Выездной врач
  if (role === 'visiting_doctor') {
    return <VisitingDoctorCabinet adminToken={adminToken} user={user} onLogout={handleLogout} />
  }

  // ── Рекрутер → кабинет рекрутера
  if (role === 'recruiter') {
    return <RecruiterCabinet adminToken={adminToken} user={user} onLogout={handleLogout} />
  }

  // ── Супервизор → кабинет супервизора (только чтение)
  if (role === 'supervisor') {
    return <SupervisorCabinet adminToken={adminToken} user={user} onLogout={handleLogout} />
  }

  // ── Руководитель → кабинет управляющего (/{slug}/manager)
  if (role === 'manager') {
    const slug = user.tenant_slug || SLUG
    localStorage.setItem('clinika_token_' + slug, adminToken)
    window.location.href = '/' + slug + '/manager'
    return null
  }

  // ── Super Admin → панель платформы
  if (role === 'super_admin') {
    return <AdminLayout adminToken={adminToken} user={user} onLogout={handleLogout} />
  }

  // Неизвестная роль
  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'linear-gradient(135deg, #004D5F 0%, #00A7AA 100%)' }}>
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center">
        <div className="text-5xl mb-4">🚫</div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">Нет доступа</h1>
        <p className="text-gray-500 text-sm mb-2">Роль: <span className="font-mono">{role}</span></p>
        <p className="text-gray-400 text-xs mb-6">Обратитесь к администратору платформы</p>
        <button onClick={handleLogout}
          className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-xl py-3 text-sm transition">
          Выйти
        </button>
      </div>
    </div>
  )
}
