import { useEffect, useState, lazy, Suspense, Component } from 'react'
import api from '../api'
import AdminLogin from './AdminLogin'
import AdminLayout from './AdminLayout'

// ===== ErrorBoundary — показывает текст ошибки вместо белого экрана =====
class AdminErrorBoundary extends Component {
  state = { error: null, info: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    console.error('[AdminErrorBoundary]', error, info)
    this.setState({ info })
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 13, color: '#fff', background: '#1a1a1a', minHeight: '100vh' }}>
          <h2 style={{ color: '#f87171' }}>Ошибка приложения</h2>
          <div style={{ marginTop: 12, padding: 12, background: '#2d1b1b', border: '1px solid #f87171', borderRadius: 8, whiteSpace: 'pre-wrap' }}>
            <b>{this.state.error.name}: </b>{this.state.error.message}
          </div>
          {this.state.info?.componentStack && (
            <details style={{ marginTop: 12 }} open>
              <summary style={{ cursor: 'pointer', color: '#fbbf24' }}>Component stack</summary>
              <pre style={{ marginTop: 8, padding: 12, background: '#0f0f0f', overflow: 'auto', fontSize: 11 }}>{this.state.info.componentStack}</pre>
            </details>
          )}
          {this.state.error.stack && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', color: '#fbbf24' }}>Stack trace</summary>
              <pre style={{ marginTop: 8, padding: 12, background: '#0f0f0f', overflow: 'auto', fontSize: 11 }}>{this.state.error.stack}</pre>
            </details>
          )}
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '8px 16px', background: '#06b6d4', color: '#000', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>
            Перезагрузить
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
import DoctorLayout from './DoctorLayout'
import OperationalCabinet from './OperationalCabinet'
import RecruiterCabinet from './RecruiterCabinet'
import PartnerDoctorCabinet from './PartnerDoctorCabinet'
import VisitingDoctorCabinet from './VisitingDoctorCabinet'
import InviteAccept from './InviteAccept'
// PatientCabinet — lazy. Тяжёлый модуль (3000+ строк); грузим только если super_admin зашёл /p/.
const PatientCabinet = lazy(() => import('./PatientCabinet'))
// FranchiseOwnerCabinet — lazy. Открывается только для роли franchise_owner и super_admin.
// Сам по себе — 2400+ строк, плюс куча секций. Не нужен другим ролям.
const FranchiseOwnerCabinet = lazy(() => import('./FranchiseOwnerCabinet'))
// W4: Onboarding wizard — показывается franchise_owner до завершения первичной настройки
const OnboardingWizard = lazy(() => import('./onboarding/OnboardingWizard'))
import { API_BASE, BASE_PATH, SLUG } from '../config'
import CallWidget from '../components/CallWidget'
import { loadTheme } from '../utils/ThemeLoader'
import useTheme from '../lib/useTheme'
import useAuthStore from '../store/auth'
// pwdmust01: блокирующая модалка для принудительной смены временного пароля
import ForcePasswordChangeModal from '../components/ForcePasswordChangeModal'

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
  // pwdmust01: показывать ли блокирующую модалку смены пароля
  const [forcePwdOpen, setForcePwdOpen] = useState(false)

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
        // pwdmust01: при каждом входе показываем блокирующую модалку, если
        // бек сообщил, что временный пароль ещё не сменён. Закрываем её
        // ТОЛЬКО после успешного PATCH /profile/me (см. handleForcePwdSuccess).
        if (u.password_must_change) {
          setForcePwdOpen(true)
        }
        // Синхронизируем zustand-стор — CallWidget, SupportChat и другие компоненты
        // используют useAuthStore. Без этого они видят token=null и не рендерятся
        // (особенно при impersonate из super-admin в роль doctor/reg/nurse).
        try {
          useAuthStore.setState({ token: adminToken, user: u })
          localStorage.setItem('clinika_token_' + SLUG, adminToken)
        } catch (_e) { /* noop */ }
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

  // pwdmust01: блокирующая модалка — нужна во ВСЕХ ролевых ветках, поэтому
  // выделяем в переменную и добавляем её к каждому return ниже. Закрытие
  // невозможно (нет onClose) — единственный способ убрать модалку — успешно
  // сменить пароль через PATCH /profile/me, после чего onSuccess сбросит
  // флаг локально и закроет модалку.
  const forceModal = (
    <ForcePasswordChangeModal
      open={forcePwdOpen}
      onSuccess={() => {
        setForcePwdOpen(false)
        setUser({ ...user, password_must_change: false })
      }}
    />
  )

  const role = user.role

  // ── Врач → личный кабинет врача
  if (role === 'doctor') {
    return <><DoctorLayout adminToken={adminToken} user={user} onLogout={handleLogout} /><CallWidget />{forceModal}</>
  }

  // ── Регистратор / Медсестра → операционный кабинет
  if (role === 'reg' || role === 'nurse') {
    return <><OperationalCabinet adminToken={adminToken} user={user} onLogout={handleLogout} /><CallWidget />{forceModal}</>
  }

  // ── Врач-партнёр (бывший external_doctor)
  if (role === 'partner_doctor') {
    return <><PartnerDoctorCabinet adminToken={adminToken} user={user} onLogout={handleLogout} />{forceModal}</>
  }

  // ── Выездной врач
  if (role === 'visiting_doctor') {
    return <><VisitingDoctorCabinet adminToken={adminToken} user={user} onLogout={handleLogout} />{forceModal}</>
  }

  // ── Пациент → личный кабинет пациента
  if (role === 'patient') {
    return (
      <>
        <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg, #f6f7fa)' }} />}>
          <PatientCabinet adminToken={adminToken} user={user} onLogout={handleLogout} />
        </Suspense>
        {forceModal}
      </>
    )
  }

  // ── Рекрутер → кабинет рекрутера
  if (role === 'recruiter') {
    return <><RecruiterCabinet adminToken={adminToken} user={user} onLogout={handleLogout} /><CallWidget />{forceModal}</>
  }

  // ── Владелец франшизы → отдельный кабинет (НЕ AdminLayout — это платформа).
  // W4: Если онбординг ещё не завершён — показываем мастер вместо обычного кабинета.
  // Состояние мастера определяется через GET /onboarding/status (см. ниже Wrapper).
  if (role === 'franchise_owner') {
    return (
      <>
        <FranchiseOwnerWithOnboarding adminToken={adminToken} user={user} onLogout={handleLogout} />
        <CallWidget />
        {forceModal}
      </>
    )
  }

  // ── Руководитель → кабинет управляющего (/{slug}/manager)
  // Модалку здесь НЕ показываем — сразу редиректим. Модалка появится в
  // MiniApp (см. App.jsx) после загрузки /admins/me на /{slug}/manager.
  if (role === 'manager') {
    const slug = user.tenant_slug || SLUG
    localStorage.setItem('clinika_token_' + slug, adminToken)
    window.location.href = '/' + slug + '/manager'
    return null
  }

  // ── Super Admin → панель платформы
  if (role === 'super_admin') {
    return (
      <AdminErrorBoundary>
        <AdminLayout adminToken={adminToken} user={user} onLogout={handleLogout} />
        <CallWidget />
        {forceModal}
      </AdminErrorBoundary>
    )
  }

  // Неизвестная роль
  return (
    <>
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
      {forceModal}
    </>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// W4: FranchiseOwnerWithOnboarding
// Wrapper для franchise_owner: проверяет состояние мастера онбординга
// (GET /onboarding/status). Если не завершён — показывает <OnboardingWizard>,
// иначе — обычный <FranchiseOwnerCabinet>.
// super_admin может зайти в кабинет в любой момент через query ?skip_onboarding=1
// ───────────────────────────────────────────────────────────────────────────
function FranchiseOwnerWithOnboarding({ adminToken, user, onLogout }) {
  const [status, setStatus] = useState(null) // null=loading, false=загружен и не нужен, true=показать wizard
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // ?skip_onboarding=1 в URL — экстренно пропустить мастер (для super_admin)
    const skipFlag = new URLSearchParams(window.location.search).get('skip_onboarding')
    if (skipFlag === '1') { setStatus(false); setLoading(false); return }

    api.get('/onboarding/status')
      .then((res) => {
        if (cancelled) return
        // Если completed=true — кабинет, иначе — wizard
        setStatus(!res.data?.completed)
      })
      .catch((err) => {
        // 404 «нет франшизы» — пропускаем мастер, чтобы кабинет показал свою ошибку
        if (cancelled) return
        console.warn('[onboarding/status]', err?.response?.status)
        setStatus(false)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg, #f6f7fa)' }}>
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Проверка настройки франшизы...</p>
        </div>
      </div>
    )
  }

  if (status === true) {
    return (
      <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg, #f6f7fa)' }} />}>
        <OnboardingWizard
          user={user}
          onComplete={() => setStatus(false)}
        />
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg, #f6f7fa)' }} />}>
      <FranchiseOwnerCabinet adminToken={adminToken} user={user} onLogout={onLogout} />
    </Suspense>
  )
}
