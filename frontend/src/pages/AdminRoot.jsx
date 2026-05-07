import { useEffect, useState } from 'react'
import api from '../api'
import AdminLogin from './AdminLogin'
import AdminLayout from './AdminLayout'
import DoctorLayout from './DoctorLayout'
import OperationalCabinet from './OperationalCabinet'
import RecruiterCabinet from './RecruiterCabinet'
import PartnerDoctorCabinet from './PartnerDoctorCabinet'
import VisitingDoctorCabinet from './VisitingDoctorCabinet'
import InviteAccept from './InviteAccept'
import PatientCabinet from './PatientCabinet'
import FranchiseOwnerCabinet from './FranchiseOwnerCabinet'
import { API_BASE, BASE_PATH, SLUG } from '../config'
import CallWidget from '../components/CallWidget'
import { loadTheme } from '../utils/ThemeLoader'
import useTheme from '../lib/useTheme'

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

  // Единая тема для всей панели (хук читает localStorage и применяет класс dark)
  useTheme()

  // Загружаем брендинг тенанта при старте + перезагружаем при сохранении в BrandingSection
  useEffect(() => {
    loadTheme().catch(() => {})
    const onBrandingUpdated = () => { loadTheme().catch(() => {}) }
    window.addEventListener('clinika-branding-updated', onBrandingUpdated)
    return () => window.removeEventListener('clinika-branding-updated', onBrandingUpdated)
  }, [])

  useEffect(() => {
    if (!adminToken) {
      setChecking(false)
      return
    }
    api
      .get('/admins/me')
      .then(res => {
        const u = res.data
        const role = (u.role || '').toLowerCase()
        u.role = role
        const slug = u.tenant_slug
        const isSuperAdmin = u.is_superadmin || u.is_super || role === 'super_admin'

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

  // ── Presence WebSocket — всегда подключаем для отслеживания онлайн статуса
  useEffect(() => {
    const NO_PRESENCE = ['visiting_doctor', 'partner_doctor', 'patient']
    if (!adminToken || !user?.id || NO_PRESENCE.includes(user.role)) return
    const wsUrl = API_BASE.replace(/^http/, 'ws') + `/presence/ws/${user.id}`
    const ws = new WebSocket(wsUrl)
    let ping
    ws.onopen = () => {
      api.put('/presence/status', { status: 'online' }).catch(() => {})
      ping = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'heartbeat' })) }, 30000)
    }
    return () => { clearInterval(ping); ws.close() }
  }, [adminToken, user?.id])

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
    return <><DoctorLayout adminToken={adminToken} user={user} onLogout={handleLogout} /><CallWidget /></>
  }

  // ── Регистратор / Медсестра → операционный кабинет
  if (role === 'reg' || role === 'nurse') {
    return <><OperationalCabinet adminToken={adminToken} user={user} onLogout={handleLogout} /><CallWidget /></>
  }

  // ── Врач-партнёр (бывший external_doctor)
  if (role === 'partner_doctor') {
    return <PartnerDoctorCabinet adminToken={adminToken} user={user} onLogout={handleLogout} />
  }

  // ── Выездной врач
  if (role === 'visiting_doctor') {
    return <VisitingDoctorCabinet adminToken={adminToken} user={user} onLogout={handleLogout} />
  }

  // ── Пациент → личный кабинет пациента
  if (role === 'patient') {
    return <PatientCabinet adminToken={adminToken} user={user} onLogout={handleLogout} />
  }

  // ── Рекрутер → кабинет рекрутера
  if (role === 'recruiter') {
    return <><RecruiterCabinet adminToken={adminToken} user={user} onLogout={handleLogout} /><CallWidget /></>
  }

  // ── Владелец франшизы → отдельный кабинет (НЕ AdminLayout — это платформа).
  if (role === 'franchise_owner') {
    return <><FranchiseOwnerCabinet adminToken={adminToken} user={user} onLogout={handleLogout} /><CallWidget /></>
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
    return <><AdminLayout adminToken={adminToken} user={user} onLogout={handleLogout} /><CallWidget /></>
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
