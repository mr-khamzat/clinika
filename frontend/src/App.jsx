/**
 * ========================================
 * БЛОК: Корневой компонент приложения
 * ========================================
 * Маршрутизация и auth-гейт для Telegram Mini App.
 * Три точки входа:
 *   1. /clinika/admin  → AdminRoot (панель управления)
 *   2. /clinika/invite/:code → InviteRegister (публичная, без авторизации)
 *   3. /clinika/*      → MiniApp (Telegram Mini App / логин по паролю)
 *
 * Расширение: добавить новый раздел → добавить Route внутри MiniApp
 * ========================================
 */
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect, useState } from 'react'
import useAuthStore from './store/auth'
import { authTelegram, getMe } from './api'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import CreateReferral from './pages/CreateReferral'
import PartnerCreateReferral from './pages/PartnerCreateReferral'
import QRScreen from './pages/QRScreen'
import ScanScreen from './pages/ScanScreen'
import History from './pages/History'
import Bonuses from './pages/Bonuses'
import Landing from './pages/Landing'
import ProfileSetup from './pages/ProfileSetup'
import InviteRegister from './pages/InviteRegister'
import ManagerDashboard from './pages/ManagerDashboard'
import ManagerHistory from './pages/ManagerHistory'
import ManagerBonuses from './pages/ManagerBonuses'
import ManagerAnalytics from './pages/ManagerAnalytics'
import ManagerKPI from './pages/ManagerKPI'
import ManagerActivity from './pages/ManagerActivity'
import ManagerSettings from './pages/ManagerSettings'
import ClinicSchedules from './pages/ClinicSchedules'
import AdminPanel from './pages/AdminPanel'
import AdminRoot from './pages/AdminRoot'
import PatientCabinet from './pages/PatientCabinet'
import { API_BASE, BASE_PATH, SLUG } from './config'

// ─── Применяем тему ДО первого рендера ───
;(function applyThemeEarly() {
  try {
    const saved = localStorage.getItem('theme')
    if (saved === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  } catch {}
})()

// ─── Telegram Mini App — главный компонент ───
function MiniApp() {
  const { token, setToken, setUser, user } = useAuthStore()
  const [loading, setLoading] = useState(true)

  // ─── Инициализация: Telegram auth или восстановление сессии ───
  useEffect(() => {
    const init = async () => {
      try {
        const tg = window.Telegram?.WebApp
        if (tg?.initDataUnsafe?.user) {
          tg.ready()
          tg.expand()
          const tgUser = tg.initDataUnsafe.user
          const res = await authTelegram({
            id: String(tgUser.id),
            first_name: tgUser.first_name || 'Пользователь',
            last_name: tgUser.last_name,
            username: tgUser.username,
            init_data: tg.initData || '',   // для верификации подписи на бэкенде
          })
          setToken(res.data.access_token)
          const meRes = await getMe()
          setUser(meRes.data)
        } else if (token) {
          try {
            const meRes = await getMe()
            setUser(meRes.data)
          } catch (e) {
            // токен просрочен или недействителен — сбрасываем
            if (e?.response?.status === 401) {
              localStorage.removeItem('clinika_token')
              useAuthStore.getState().logout()
            }
          }
        }
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  // ─── Экран загрузки ───
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-gray-500 dark:text-gray-400">Загрузка...</p>
      </div>
    </div>
  )

  // ─── Специальный случай: регистрация по инвайту (без авторизации) ───
  const pathname = window.location.pathname
  const inviteMatch = pathname.match(new RegExp('/' + SLUG + '/invite/([^/]+)'))
  if (inviteMatch) {
    return <InviteRegister code={inviteMatch[1]} />
  }

  // ─── Auth-гейт: нет user → стартовая страница с единым входом ───
  if (!user) return <Landing />

  // ─── ProfileSetup только для новых сотрудников (не партнёров) без клиники ───
  if (user && user.role !== 'partner' && !user.clinic_id && user.telegram_id && !user.username) {
    return <ProfileSetup />
  }

  // ─── Основные маршруты приложения ───
  return (
    <BrowserRouter basename={"/" + SLUG}>
      <Routes>
        <Route path="/" element={<Layout />}>

          {/* ─── Общие маршруты (все роли) ─── */}
          <Route index element={<Dashboard />} />
          <Route path="history" element={<History />} />
          <Route path="bonuses" element={<Bonuses />} />
          <Route path="qr/:id" element={<QRScreen />} />

          {/* ─── Маршруты для партнёра ─── */}
          <Route path="partner/create" element={<PartnerCreateReferral />} />

          {/* ─── Маршруты для сотрудников клиники (admin/manager) ─── */}
          {user?.role !== 'partner' && (
            <>
              <Route path="create" element={<CreateReferral />} />
              <Route path="scan" element={<ScanScreen />} />
            </>
          )}

          {/* ─── Маршруты только для менеджера ─── */}
          {user?.role === 'manager' && (
            <>
              <Route path="manager" element={<ManagerDashboard />} />
              <Route path="manager/history" element={<ManagerHistory />} />
              <Route path="manager/bonuses" element={<ManagerBonuses />} />
              <Route path="manager/schedules" element={<ClinicSchedules />} />
              <Route path="manager/analytics" element={<ManagerAnalytics />} />
              <Route path="manager/kpi" element={<ManagerKPI />} />
              <Route path="manager/activity" element={<ManagerActivity />} />
              <Route path="manager/settings" element={<ManagerSettings />} />
              <Route path="admin-panel" element={<AdminPanel />} />
            </>
          )}

        </Route>
      </Routes>
    </BrowserRouter>
  )
}

// ─── Корневой компонент — определяет точку входа ───
export default function App() {
  const path = window.location.pathname
  // Панель управления — проверяем токен менеджера
  if (path.startsWith('/' + SLUG + '/admin')) {
    return <AdminRoot />
  }
  // Личный кабинет пациента — публичный
  if (path.startsWith('/' + SLUG + '/p/') || path === '/' + SLUG + '/p') {
    return <PatientCabinet />
  }
  // Корень сайта — показываем лендинг (если не залогинен) или приложение
  return <MiniApp />
}
