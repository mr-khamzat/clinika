import { createContext, useContext, useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'
import HelpModal from './HelpModal'
import SupportChat from './SupportChat'
import CallWidget from './CallWidget'
import useAuthStore from '../store/auth'
import { API_BASE, BASE_PATH, SLUG } from '../config'
import { useConfirm, useToast } from '../design'
// Единый хук переключения темы (общий с AdminLayout, DoctorLayout и др.)
import useThemeHook from '../lib/useTheme'

// ─── Push helpers (Этап 10 ROADMAP) ────────────────────────────────────────
// Регистрируем service worker и подписываем устройство сотрудника на VAPID
// push. На сервере /push/subscribe-user привязывает endpoint к текущему юзеру.
async function registerStaffSW() {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register('/' + SLUG + '/sw.js', { scope: '/' + SLUG + '/' })
    return reg
  } catch (e) {
    console.warn('[push] SW регистрация не удалась', e)
    return null
  }
}

async function subscribeStaffPush() {
  // Возвращает: 'ok' | 'denied' | 'unsupported' | 'no_vapid' | 'error'
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return 'denied'

  const reg = await navigator.serviceWorker.ready
  // 1. Запрашиваем публичный VAPID ключ с бэкенда
  let publicKey = ''
  try {
    const r = await fetch(API_BASE + '/push/vapid-key')
    const j = await r.json()
    publicKey = j.public_key || ''
  } catch {
    return 'no_vapid'
  }
  if (!publicKey) return 'no_vapid'

  // 2. Конвертируем base64-urlsafe ключ в Uint8Array
  const b64 = publicKey.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4)
  const raw = atob(padded)
  const key = new Uint8Array([...raw].map(c => c.charCodeAt(0)))

  // 3. Подписываемся через PushManager
  let sub
  try {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  } catch (e) {
    console.warn('[push] subscribe failed', e)
    return 'error'
  }
  const s = sub.toJSON()

  // 4. Отправляем подписку на бэкенд (требует Authorization).
  // Ключ токена в localStorage именован как 'clinika_token_<slug>' (см. store/auth.js).
  const token = localStorage.getItem('clinika_token_' + SLUG)
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = 'Bearer ' + token
    const r = await fetch(API_BASE + '/push/subscribe-user', {
      method: 'POST',
      headers,
      body: JSON.stringify({ endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth }),
    })
    if (!r.ok) return 'error'
    return 'ok'
  } catch {
    return 'error'
  }
}

export const ThemeContext = createContext({ isDark: false, toggleTheme: () => {} })
export const HelpContext = createContext({ openHelp: () => {} })

export function useTheme() {
  return useContext(ThemeContext)
}

export function useHelp() {
  return useContext(HelpContext)
}

const ROLE_LABELS = {
  admin:   'Сотрудник клиники',
  manager: 'Руководитель',
  partner: 'Партнёр',
}

export default function Layout() {
  // Тема — общий хук (синхронизация с AdminLayout, DoctorLayout, PatientCabinet)
  const { isDark, toggle: toggleTheme } = useThemeHook()
  const [helpOpen, setHelpOpen] = useState(false)
  // Состояние push-подписки сотрудника (granted / denied / null=нужно спросить)
  const [pushState, setPushState] = useState(() => {
    try {
      if (typeof Notification === 'undefined') return 'unsupported'
      return Notification.permission // 'default' | 'granted' | 'denied'
    } catch { return 'unsupported' }
  })
  const [pushBusy, setPushBusy] = useState(false)
  const { user, logout } = useAuthStore()
  // Замена window.confirm на Modal-диалог из design-system
  const { confirm, ConfirmHost } = useConfirm()
  // Toast — используется вместо alert (правило проекта)
  const { toast } = useToast()

  // ─── Регистрируем SW заранее, чтобы потом быстро подписаться ─────────────
  useEffect(() => {
    registerStaffSW()
  }, [])

  // Кнопка «Включить уведомления» — обработчик
  const handleEnablePush = async () => {
    if (pushBusy) return
    setPushBusy(true)
    try {
      const result = await subscribeStaffPush()
      if (result === 'ok') {
        setPushState('granted')
        toast('Уведомления включены', 'success')
      } else if (result === 'denied') {
        setPushState('denied')
        toast('Разрешение на уведомления отклонено', 'error')
      } else if (result === 'no_vapid') {
        toast('Push не настроен на сервере', 'warn')
      } else if (result === 'unsupported') {
        toast('Браузер не поддерживает push', 'warn')
      } else {
        toast('Не удалось подписаться', 'error')
      }
    } finally {
      setPushBusy(false)
    }
  }

  // Применение темы выполняет сам useThemeHook —
  // отдельный useEffect больше не требуется.

  const handleLogout = async () => {
    const ok = await confirm('Выйти из аккаунта?', { okText: 'Выйти', danger: true })
    if (!ok) return
    logout()
    window.location.href = '/' + SLUG + '/'
  }

  const initials = (user?.full_name || user?.username || '?')[0].toUpperCase()
  const roleLabel = user?.is_superadmin
    ? 'Системный администратор'
    : (ROLE_LABELS[user?.role] || user?.role || '')

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      <HelpContext.Provider value={{ openHelp: () => setHelpOpen(true) }}>
        <div className="min-h-screen bg-[#f7f9fb] dark:bg-gray-900">

          {/* ─── Sticky header ─── */}
          <header
            className="sticky top-0 z-40 px-4 h-14 flex items-center justify-between"
            style={{ background: 'rgba(247,249,251,0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(194,198,212,0.4)' }}
          >
            {/* Левая часть — аватар + имя */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #0097A7 0%, #006173 100%)' }}
              >
                {initials}
              </div>
              <div className="min-w-0 hidden sm:block">
                <div className="text-sm font-bold text-[#191c1e] dark:text-white leading-tight truncate max-w-[180px] font-headline">
                  {user?.full_name || user?.username || 'Сотрудник'}
                </div>
                <div className="text-[10px] text-[#727783] uppercase tracking-wide font-semibold">{roleLabel}</div>
              </div>
            </div>

            {/* Правая часть — push, тема, справка, выйти */}
            <div className="flex items-center gap-1">
              {/* Включить уведомления — показывается только если permission != granted */}
              {pushState !== 'granted' && pushState !== 'unsupported' && (
                <button
                  onClick={handleEnablePush}
                  disabled={pushBusy}
                  className="w-9 h-9 flex items-center justify-center text-[#727783] hover:text-[#0097A7] hover:bg-[#eceef0] dark:hover:bg-gray-800 rounded-full transition disabled:opacity-50"
                  title={pushState === 'denied' ? 'Уведомления заблокированы в браузере' : 'Включить уведомления'}
                >
                  <span className="material-symbols-outlined text-xl">
                    {pushState === 'denied' ? 'notifications_off' : 'notifications_active'}
                  </span>
                </button>
              )}
              <button
                onClick={toggleTheme}
                className="w-9 h-9 flex items-center justify-center text-[#727783] hover:text-[#191c1e] dark:hover:text-white hover:bg-[#eceef0] dark:hover:bg-gray-800 rounded-full transition"
                title={isDark ? 'Светлая тема' : 'Тёмная тема'}
              >
                <span className="material-symbols-outlined text-xl">{isDark ? 'light_mode' : 'dark_mode'}</span>
              </button>
              <button
                onClick={() => setHelpOpen(true)}
                className="w-9 h-9 flex items-center justify-center text-[#727783] hover:text-[#191c1e] dark:hover:text-white hover:bg-[#eceef0] dark:hover:bg-gray-800 rounded-full transition"
                title="Справка"
              >
                <span className="material-symbols-outlined text-xl">help</span>
              </button>
              <button
                onClick={handleLogout}
                className="w-9 h-9 flex items-center justify-center text-[#727783] hover:text-[#ba1a1a] hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition"
                title="Выйти"
              >
                <span className="material-symbols-outlined text-xl">logout</span>
              </button>
            </div>
          </header>

          {/* Контент */}
          <div className="pb-20">
            <Outlet />
          </div>
          <BottomNav />
        </div>
        {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
        {user?.role !== 'visiting_doctor' && user?.role !== 'partner_doctor' && <CallWidget />}
        {user?.role !== 'visiting_doctor' && user?.role !== 'partner_doctor' && <SupportChat />}
        {/* Хост Modal-диалога подтверждения для logout */}
        <ConfirmHost />
      </HelpContext.Provider>
    </ThemeContext.Provider>
  )
}
