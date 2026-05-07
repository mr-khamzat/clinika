import { createContext, useContext, useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'
import HelpModal from './HelpModal'
import SupportChat from './SupportChat'
import CallWidget from './CallWidget'
import useAuthStore from '../store/auth'
import { API_BASE, BASE_PATH, SLUG } from '../config'
import { useConfirm } from '../design'

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
  const [isDark, setIsDark] = useState(() => {
    try { return localStorage.getItem('theme') === 'dark' } catch { return false }
  })
  const [helpOpen, setHelpOpen] = useState(false)
  const { user, logout } = useAuthStore()
  // Замена window.confirm на Modal-диалог из design-system
  const { confirm, ConfirmHost } = useConfirm()

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [isDark])

  const toggleTheme = () => setIsDark(d => !d)

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

            {/* Правая часть — тема, справка, выйти */}
            <div className="flex items-center gap-1">
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
