/**
 * ========================================
 * БЛОК: Корневой компонент приложения
 * ========================================
 * Маршрутизация и auth-гейт. Режимы: Standalone Web App (основной) + Telegram Mini App (опциональный).
 * Три точки входа:
 *   1. /clinika/admin  → AdminRoot (панель управления)
 *   2. /clinika/invite/:code → InviteRegister (публичная, без авторизации)
 *   3. /clinika/*      → MiniApp (Telegram Mini App / логин по паролю)
 *
 * Расширение: добавить новый раздел → добавить Route внутри MiniApp
 * ========================================
 */
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect, useState, lazy, Suspense } from 'react'
import useAuthStore from './store/auth'
import { authTelegram, getMe } from './api'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import CreateReferral from './pages/CreateReferral'
// PartnerCreateReferral удалён в Этапе 3 ROADMAP — partner_doctor больше не имеет отдельной страницы.
import QRScreen from './pages/QRScreen'
import ScanScreen from './pages/ScanScreen'
import History from './pages/History'
import Bonuses from './pages/Bonuses'
import Landing from './pages/Landing'
import ProfileSetup from './pages/ProfileSetup'
import InviteRegister from './pages/InviteRegister'
import InviteAccept from './pages/InviteAccept'
import ManagerDashboard from './pages/ManagerDashboard'
import ManagerHistory from './pages/ManagerHistory'
import ManagerBonuses from './pages/ManagerBonuses'
import ManagerAnalytics from './pages/ManagerAnalytics'
import ManagerKPI from './pages/ManagerKPI'
import ManagerActivity from './pages/ManagerActivity'
import ManagerRecruitDoctors from './pages/ManagerRecruitDoctors'
import ManagerSettings from './pages/ManagerSettings'
import ManagerInvoices from './pages/ManagerInvoices'
import ManagerAppointments from './pages/ManagerAppointments'
import ClinicSchedules from './pages/ClinicSchedules'
import AdminPanel from './pages/AdminPanel'
import AdminRoot from './pages/AdminRoot'
import { PLATFORM_MODE } from './config'
import PatientCabinet from './pages/PatientCabinet'
import OnlineBooking from './pages/OnlineBooking'
import ClinicPage from './pages/ClinicPage'
import DesignPreview from './pages/DesignPreview'
import DesignPreview2 from './pages/DesignPreview2'
// ─── Новый этап: дизайн-токены + базовые компоненты (Этап 4 ROADMAP) ───
// Lazy: бандл с компонентами и tokens.css не грузится для обычных пользователей.
const DesignSystem = lazy(() => import('./pages/DesignSystem'))
// ─── Wiki (публичный раздел «Обучение пользованию КлиникСеть») ───
// Lazy: статьи и react-markdown не нужны рядовому пользователю кабинета.
const Wiki = lazy(() => import('./pages/Wiki'))
const WikiArticle = lazy(() => import('./pages/WikiArticle'))
import { API_BASE, BASE_PATH, SLUG } from './config'
import { waitForTelegramSDK, initTgApp } from './lib/tg'
import { loadTheme } from "./utils/ThemeLoader"

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

// ─── Универсальный компонент: Web App + Telegram Mini App ───
function MiniApp() {
  const { token, setToken, setUser, user } = useAuthStore()
  const [loading, setLoading] = useState(true)

  // ─── Инициализация: веб-сессия первой, Telegram — опционально ───
  // Порядок важен: сначала проверяем токен (веб-режим, нет задержки),
  // потом — Telegram SDK (только если URL содержит tgWebApp в hash).
  useEffect(() => {
    const init = async () => {
      loadTheme().catch(() => {})
      try {
        // 1. Восстанавливаем веб-сессию по токену (без ожидания Telegram)
        if (token) {
          try {
            const meRes = await getMe()
            setUser(meRes.data)
            return
          } catch (e) {
            if (e?.response?.status === 401) {
              localStorage.removeItem('clinika_token_' + SLUG)
              useAuthStore.getState().logout()
            }
          }
        }

        // 2. Нет токена — проверяем Telegram Mini App (с таймаутом 2с)
        // waitForTelegramSDK вернёт null немедленно если не в Telegram
        const tg = await waitForTelegramSDK()
        if (tg) {
          initTgApp(tg)
          const tgUser = tg.initDataUnsafe.user
          const res = await authTelegram({
            id: String(tgUser.id),
            first_name: tgUser.first_name || 'Пользователь',
            last_name: tgUser.last_name,
            username: tgUser.username,
            init_data: tg.initData || '',
          })
          setToken(res.data.access_token)
          const meRes = await getMe()
          setUser(meRes.data)
        }
        // 3. Ни токена, ни Telegram → покажем страницу входа
      } catch (e) {
        console.error('[MiniApp init]', e)
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

  // ─── Специальный случай: регистрация по инвайту ───
  const pathname = window.location.pathname
  // Приглашение врача от рекрутера (новая система)
  const inviteAcceptMatch = pathname.match(new RegExp('/' + SLUG + '/invite/([a-zA-Z0-9_-]{20,})'))
  if (inviteAcceptMatch) {
    return <InviteAccept token={inviteAcceptMatch[1]} />
  }
  // Старый партнёрский инвайт (короткий код)
  const inviteMatch = pathname.match(new RegExp('/' + SLUG + '/invite/([^/]+)'))
  if (inviteMatch) {
    return <InviteRegister code={inviteMatch[1]} />
  }

  // ─── Auth-гейт: нет user → стартовая страница с единым входом ───
  if (!user) return <Landing />

  // ─── ProfileSetup только для новых сотрудников клиники (без аккаунта) ───
  if (user && !user.clinic_id && user.telegram_id && !user.username) {
    return <ProfileSetup />
  }

  // ─── Приезжий и партнёрский врач → только /admin (PartnerDoctorCabinet/VisitingDoctorCabinet) ───
  if (user?.role === 'visiting_doctor' || user?.role === 'partner_doctor') {
    window.location.replace('/' + SLUG + '/admin')
    return null
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

          {/* ─── Превью дизайн-токенов (публичный пилот, без auth) ─── */}
          <Route path="design-preview" element={<DesignPreview />} />
          <Route path="design-preview-2" element={<DesignPreview2 />} />

          {/* ─── Витрина дизайн-системы (Этап 4): только super_admin ─── */}
          {user?.role === 'super_admin' && (
            <Route
              path="design-system"
              element={
                <Suspense fallback={<div style={{ background: 'var(--bg)', minHeight: '100vh' }} />}>
                  <DesignSystem />
                </Suspense>
              }
            />
          )}

          {/* ─── Маршруты для партнёра — удалены в Этапе 3 ROADMAP ─── */}

          {/* ─── Маршруты для сотрудников клиники (reg/manager/doctor/recruiter) ─── */}
          {user?.role !== 'visiting_doctor' && user?.role !== 'partner_doctor' && (
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
              <Route path="manager/recruit-doctors" element={<ManagerRecruitDoctors />} />
              <Route path="manager/invoices" element={<ManagerInvoices />} />
              <Route path="manager/appointments" element={<ManagerAppointments />} />
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

  // ─── Публичная Wiki (без auth) — глобально и в тенантах ───
  // Маршруты: /wiki, /wiki/:slug, /<slug>/wiki, /<slug>/wiki/:article
  // Точная проверка: /wiki или /<любой_сегмент>/wiki — но НЕ /admin/wiki и не служебные.
  const wikiMatch = path.match(/^(?:\/([^/]+))?\/wiki(?:\/([^/]+))?\/?$/)
  // Защита от ложных совпадений с одиночным /wiki без префикса
  const isPureWiki = path === '/wiki' || path.startsWith('/wiki/')
  const isTenantWiki = SLUG && (path === '/' + SLUG + '/wiki' || path.startsWith('/' + SLUG + '/wiki/'))
  if (wikiMatch && (isPureWiki || isTenantWiki)) {
    // Рассчитываем basename для BrowserRouter
    const base = isTenantWiki ? '/' + SLUG : ''
    return (
      <BrowserRouter basename={base}>
        <Suspense fallback={<div style={{ background: 'var(--bg, #f6f7fa)', minHeight: '100vh' }} />}>
          <Routes>
            <Route path="/wiki" element={<Wiki />} />
            <Route path="/wiki/:slug" element={<WikiArticle />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    )
  }

  // Корневой лендинг (/) — показываем Landing без slug-роутинга.
  // Но если на устройстве сохранён вход пациента (PWA-ярлык открылся на корне) —
  // моментальный редирект в его кабинет.
  if (path === '/' || path === '') {
    const slug = typeof localStorage !== 'undefined' ? localStorage.getItem('clinika_patient_slug') : null
    const session = typeof localStorage !== 'undefined' ? localStorage.getItem('clinika_patient_session') : null
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('clinika_patient_token') : null
    if (slug && (session || token)) {
      window.location.replace('/' + slug + '/p')
      return null
    }
    return <Landing />
  }

  // Глобальная платформа khamzat: /admin (без тенантного слага)
  if (PLATFORM_MODE || path === '/admin') {
    return <AdminRoot />
  }

  // Панель управления тенанта: /{slug}/admin
  if (SLUG && path.startsWith('/' + SLUG + '/admin')) {
    return <AdminRoot />
  }

  // Онлайн-запись пациентов
  if (SLUG && (path.startsWith('/' + SLUG + '/book') || path === '/' + SLUG + '/book')) {
    return <OnlineBooking />
  }

  // Публичная страница клиники (рейтинг врачей)
  if (SLUG && path.startsWith('/' + SLUG + '/clinic')) {
    return <ClinicPage />
  }

  // Превью премиум-палитры (пилот, без auth) — /{slug}/design-preview
  if (SLUG && (path === '/' + SLUG + '/design-preview' || path.startsWith('/' + SLUG + '/design-preview/'))) {
    return <DesignPreview />
  }
  // Второй бандл дизайна — /{slug}/design-preview-2 (HTML-прототипы из Claude Design)
  if (SLUG && (path === '/' + SLUG + '/design-preview-2' || path.startsWith('/' + SLUG + '/design-preview-2/'))) {
    return <DesignPreview2 />
  }

  // Preview-версия кабинета пациента (новый премиум-дизайн) — параллельный URL /p-new
  // Загружается лениво — стили cabinet-dark.css не попадают в основной bundle.
  if (SLUG && (path === '/' + SLUG + '/p-new' || path.startsWith('/' + SLUG + '/p-new/'))) {
    const PatientCabinetPreview = lazy(() => import('./pages/PatientCabinetPreview'))
    return (
      <Suspense fallback={<div style={{ background: '#161a1f', minHeight: '100vh' }} />}>
        <PatientCabinetPreview />
      </Suspense>
    )
  }

  // Личный кабинет пациента — публичный
  if (SLUG && (path.startsWith('/' + SLUG + '/p/') || path === '/' + SLUG + '/p')) {
    return <PatientCabinet />
  }

  // Регистрация по инвайту
  const inviteMatch = path.match(new RegExp('/' + (SLUG || '[^/]+') + '/invite/([^/]+)'))
  if (inviteMatch) {
    return <InviteRegister code={inviteMatch[1]} />
  }

  // Тенантное мини-приложение
  return <MiniApp />
}
