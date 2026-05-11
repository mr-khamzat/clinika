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
// ScanScreen — lazy. Тянет за собой html5-qrcode (~250KB), нужен только при сканировании QR.
const ScanScreen = lazy(() => import('./pages/ScanScreen'))
import History from './pages/History'
import Bonuses from './pages/Bonuses'
// Landing — lazy. Большая страница лендинга платформы (не нужна авторизованным пользователям).
const Landing = lazy(() => import('./pages/Landing'))
import Franchise from './pages/Franchise'
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
import ManagerVisitingDoctors from './pages/ManagerVisitingDoctors'
import ManagerPartnerDoctors from './pages/ManagerPartnerDoctors'
import ManagerSettings from './pages/ManagerSettings'
import ManagerInvoices from './pages/ManagerInvoices'
// svcfin01: финансовая модель платформы — 3 таба (Платформе/Сети/Сотрудникам)
import ManagerFinance from './pages/ManagerFinance'
import ManagerAppointments from './pages/ManagerAppointments'
// Глава 4 — Manager productivity (lazy load)
// (reused lazy from top import)
const ManagerKanban         = lazy(() => import('./pages/ManagerKanban'))
const ManagerDoctorLoadPage = lazy(() => import('./pages/ManagerDoctorLoadPage'))
const ManagerTemplatesPage  = lazy(() => import('./pages/ManagerTemplatesPage'))
const ManagerMultiClinic    = lazy(() => import('./pages/ManagerMultiClinic'))
const ManagerForecast       = lazy(() => import('./pages/ManagerForecast'))
// Глава 7 — Регламент-конструктор: «Мои регламенты» для менеджера
const ManagerRegulations    = lazy(() => import('./pages/ManagerRegulations'))
// Глава 8 — Программа лояльности (управление наградами, лидерборд, claims)
const ManagerLoyalty        = lazy(() => import('./pages/ManagerLoyalty'))
// Глава 9 — Чат с пациентами (премиум-чат клиники)
const ManagerChatPage       = lazy(() => import('./pages/ManagerChatPage'))
// Глава 10 — Лабораторные интеграции: CRUD провайдеров
const ManagerLab            = lazy(() => import('./pages/ManagerLab'))
// Глава 10 — Агрегаторы лидов: входящие заявки от DocDoc/ПроДокторов/Yandex Health
const ManagerAggregator     = lazy(() => import('./pages/ManagerAggregator'))
// Наличная активация подписки «Здоровье+/Семья+/Pro» (касса клиники, печать квитанции)
const ManagerSubscriptionCash = lazy(() => import('./pages/ManagerSubscriptionCash'))
import ClinicSchedules from './pages/ClinicSchedules'
// AdminPanel.jsx удалён — был дубль AdminLayout/AdminRoot
import AdminRoot from './pages/AdminRoot'
import { PLATFORM_MODE } from './config'
// PatientCabinet — lazy. Один из самых тяжёлых модулей (3000+ строк, AI-виджет, секции пациента).
// Грузим только при заходе на /{slug}/p — для остальных кабинетов экономим bundle.
const PatientCabinet = lazy(() => import('./pages/PatientCabinet'))
import OnlineBooking from './pages/OnlineBooking'
import ClinicPage from './pages/ClinicPage'
// DesignPreview (v1) удалён — используем только DesignPreview2 (актуальный)
import DesignPreview2 from './pages/DesignPreview2'
// ─── Новый этап: дизайн-токены + базовые компоненты (Этап 4 ROADMAP) ───
// Lazy: бандл с компонентами и tokens.css не грузится для обычных пользователей.
const DesignSystem = lazy(() => import('./pages/DesignSystem'))
// ─── Wiki (публичный раздел «Обучение пользованию КлиникСеть») ───
// Lazy: статьи и react-markdown не нужны рядовому пользователю кабинета.
const Wiki = lazy(() => import('./pages/Wiki'))
const WikiArticle = lazy(() => import('./pages/WikiArticle'))
// Публичная страница пациента для телемед-приёма (без auth, по одноразовому token)
const PatientTelemedRoom = lazy(() => import('./pages/PatientTelemedRoom'))
// ─── Legal (152-ФЗ): /privacy, /terms, /consent ───
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'))
const TermsOfService = lazy(() => import('./pages/TermsOfService'))
const ConsentForm = lazy(() => import('./pages/ConsentForm'))
// Self-service сброс пароля по токену из email
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
// Self-service регистрация франшизы (Глава 2) — публичный wizard
const SignupWizard = lazy(() => import('./pages/SignupWizard'))
import { API_BASE, BASE_PATH, SLUG } from './config'
import { waitForTelegramSDK, initTgApp } from './lib/tg'
import { loadTheme } from "./utils/ThemeLoader"
// ─── Глобальный провайдер тостов (Этап 4 ROADMAP) ───
// Оборачивает любую точку входа: уведомления доступны во всех кабинетах.
import { ToastProvider } from './design'

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
    // Слушаем глобальное событие — после сохранения брендинга
    // в BrandingSection тема перезагрузится без F5
    const onBrandingUpdated = () => { loadTheme().catch(() => {}) }
    window.addEventListener('clinika-branding-updated', onBrandingUpdated)

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

    return () => {
      window.removeEventListener('clinika-branding-updated', onBrandingUpdated)
    }
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
  if (!user) return (
    <Suspense fallback={<div style={{ background: 'var(--bg, #f8fafc)', minHeight: '100vh' }} />}>
      <Landing />
    </Suspense>
  )

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
          <Route index element={<RootRedirect />} />
          <Route path="history" element={<History />} />
          <Route path="bonuses" element={<Bonuses />} />
          <Route path="qr/:id" element={<QRScreen />} />

          {/* ─── Превью дизайн-токенов (публичный пилот, без auth) ─── */}
          {/* design-preview (v1) удалён, оставлен только актуальный design-preview-2 */}
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
              <Route
                path="scan"
                element={
                  <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg, #f6f7fa)' }} />}>
                    <ScanScreen />
                  </Suspense>
                }
              />
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
              <Route path="manager/visiting-doctors" element={<ManagerVisitingDoctors />} />
              <Route path="manager/partner-doctors"  element={<ManagerPartnerDoctors />} />
              <Route path="manager/invoices" element={<ManagerInvoices />} />
              <Route path="manager/finance" element={<ManagerFinance />} />
              <Route path="manager/appointments" element={<ManagerAppointments />} />
              {/* Глава 4 — Manager productivity */}
              <Route path="manager/kanban"       element={<Suspense fallback={<div style={{minHeight:'100vh'}}/>}><ManagerKanban /></Suspense>} />
              <Route path="manager/doctor-load"  element={<Suspense fallback={<div style={{minHeight:'100vh'}}/>}><ManagerDoctorLoadPage /></Suspense>} />
              <Route path="manager/templates"    element={<Suspense fallback={<div style={{minHeight:'100vh'}}/>}><ManagerTemplatesPage /></Suspense>} />
              <Route path="manager/multi-clinic" element={<Suspense fallback={<div style={{minHeight:'100vh'}}/>}><ManagerMultiClinic /></Suspense>} />
              <Route path="manager/forecast"     element={<Suspense fallback={<div style={{minHeight:'100vh'}}/>}><ManagerForecast /></Suspense>} />
              {/* Глава 7 — Регламент-конструктор: «Мои регламенты» для управляющего */}
              <Route path="manager/regulations"  element={<Suspense fallback={<div style={{minHeight:'100vh'}}/>}><ManagerRegulations /></Suspense>} />
              {/* Глава 8 — Программа лояльности: каталог наград, лидерборд, claims, ручная корректировка */}
              <Route path="manager/loyalty"      element={<Suspense fallback={<div style={{minHeight:'100vh'}}/>}><ManagerLoyalty /></Suspense>} />
              {/* Глава 9 — Чат с пациентами (премиум-чат клиники) */}
              <Route path="manager/chat"         element={<Suspense fallback={<div style={{minHeight:'100vh'}}/>}><ManagerChatPage /></Suspense>} />
              {/* Глава 10 — Лабораторные интеграции: CRUD провайдеров (Invitro/KDL/...) */}
              <Route path="manager/lab"          element={<Suspense fallback={<div style={{minHeight:'100vh'}}/>}><ManagerLab /></Suspense>} />
              {/* Глава 10 — Агрегаторы лидов: DocDoc/ПроДокторов/Yandex Health */}
              <Route path="manager/aggregator"   element={<Suspense fallback={<div style={{minHeight:'100vh'}}/>}><ManagerAggregator /></Suspense>} />
              {/* Наличная активация подписки «Здоровье+» — касса клиники */}
              <Route path="manager/subscription-cash" element={<Suspense fallback={<div style={{minHeight:'100vh'}}/>}><ManagerSubscriptionCash /></Suspense>} />
              {/* admin-panel роут удалён — AdminPanel.jsx был дубль */}
            </>
          )}

        </Route>
      </Routes>
    </BrowserRouter>
  )
}

// ─── Корневой компонент — определяет точку входа ───
// Внутренний диспетчер: возвращает нужный кабинет/лендинг по URL.
// Обёрнут в ToastProvider (см. ниже) — тосты доступны во всех ветках.

// ── Редирект с /{slug}/ в правильный кабинет по роли ──────────────────────────
// /arc/ для super_admin → /admin, для manager → /{slug}/manager,
// для doctor/reg/nurse/recruiter/franchise_owner/visiting/partner → /{slug}/admin,
// для patient → /{slug}/p. Legacy Dashboard больше не показываем.
function RootRedirect() {
  const { user } = useAuthStore()
  if (!user) return (
    <Suspense fallback={<div style={{ background: 'var(--bg, #f8fafc)', minHeight: '100vh' }} />}>
      <Landing />
    </Suspense>
  )
  if (user.role === 'super_admin') {
    window.location.replace('/admin')
    return null
  }
  if (user.role === 'manager') {
    window.location.replace('/' + SLUG + '/manager')
    return null
  }
  if (user.role === 'patient') {
    window.location.replace('/' + SLUG + '/p')
    return null
  }
  // Все остальные роли — кабинетный URL /{slug}/admin
  window.location.replace('/' + SLUG + '/admin')
  return null
}

function AppRouter() {
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

  // ─── Публичная страница франшизы (/franchise) — без auth ───
  // Этап 6 ROADMAP: отдельный лендинг для будущих франчайзи.
  if (path === '/franchise' || path === '/franchise/') {
    return <Franchise />
  }

  // ─── Self-service регистрация франшизы (/signup) — без auth ───
  // Глава 2 ROADMAP: публичный мастер регистрации.
  if (path === '/signup' || path === '/signup/') {
    return (
      <Suspense fallback={<div style={{ background: 'linear-gradient(180deg,#f8fafc,#ecfeff)', minHeight: '100vh' }} />}>
        <SignupWizard />
      </Suspense>
    )
  }

  // ─── Self-service password reset (без auth) ───
  // /reset-password?token=... (root) или /<slug>/reset-password?token=...
  if (path === '/reset-password' || path === '/reset-password/' ||
      (SLUG && (path === '/' + SLUG + '/reset-password' || path === '/' + SLUG + '/reset-password/'))) {
    return (
      <Suspense fallback={<div style={{ background: 'var(--bg, #f8fafc)', minHeight: '100vh' }} />}>
        <ResetPassword />
      </Suspense>
    )
  }

  // ─── Legal (152-ФЗ) — публичные страницы без auth ───
  if (path === '/privacy' || path === '/privacy/') {
    return (
      <Suspense fallback={<div style={{ background: 'var(--bg, #f8fafc)', minHeight: '100vh' }} />}>
        <PrivacyPolicy />
      </Suspense>
    )
  }
  if (path === '/terms' || path === '/terms/') {
    return (
      <Suspense fallback={<div style={{ background: 'var(--bg, #f8fafc)', minHeight: '100vh' }} />}>
        <TermsOfService />
      </Suspense>
    )
  }
  if (path === '/consent' || path === '/consent/') {
    return (
      <Suspense fallback={<div style={{ background: 'var(--bg, #f8fafc)', minHeight: '100vh' }} />}>
        <ConsentForm />
      </Suspense>
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
    return (
      <Suspense fallback={<div style={{ background: 'var(--bg, #f8fafc)', minHeight: '100vh' }} />}>
        <Landing />
      </Suspense>
    )
  }

  // Глобальная платформа khamzat: /admin (без тенантного слага).
  // Поддерживаем deep-link секций /admin/<section> — AdminLayout сам
  // синхронизирует URL ↔ activeSection (см. useEffect в AdminLayout.jsx).
  if (PLATFORM_MODE || path === '/admin' || path === '/admin/' || path.startsWith('/admin/')) {
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

  // Бандл актуального дизайна — /{slug}/design-preview-2 (HTML-прототипы из Claude Design)
  // (старый /design-preview удалён вместе с DesignPreview.jsx)
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

  // Публичная страница телемед-приёма пациента: /p/telemed/:token или /<slug>/p/telemed/:token.
  // Открывается из ссылки приглашения, без авторизации (auth по одноразовому JWT в URL).
  // Должна перехватываться ПЕРЕД PatientCabinet (тот ловит /<slug>/p/...).
  if (/\/p\/telemed\//.test(path)) {
    return (
      <Suspense fallback={<div style={{ background: '#0b0e13', minHeight: '100vh' }} />}>
        <PatientTelemedRoom />
      </Suspense>
    )
  }

  // Личный кабинет пациента — публичный
  if (SLUG && (path.startsWith('/' + SLUG + '/p/') || path === '/' + SLUG + '/p')) {
    return (
      <Suspense fallback={<div style={{ background: 'var(--bg, #f8fafc)', minHeight: '100vh' }} />}>
        <PatientCabinet />
      </Suspense>
    )
  }

  // Регистрация по инвайту
  const inviteMatch = path.match(new RegExp('/' + (SLUG || '[^/]+') + '/invite/([^/]+)'))
  if (inviteMatch) {
    return <InviteRegister code={inviteMatch[1]} />
  }

  // Тенантное мини-приложение
  return <MiniApp />
}

// ─── Корневой компонент-обёртка ───
// Оборачивает диспетчер в ToastProvider, чтобы хук useToast() работал
// в любой ветке: AdminRoot, PatientCabinet, MiniApp, OnlineBooking и т.д.
export default function App() {
  return (
    <ToastProvider>
      <AppRouter />
    </ToastProvider>
  )
}
