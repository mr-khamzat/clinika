/**
 * ============================================================================
 * Хук: useTheme — единый переключатель «тёмная / светлая» для всех кабинетов
 * ============================================================================
 * Хранит выбор пользователя в localStorage('clinika-theme'),
 * применяет к корню документа сразу два маркера:
 *   1. document.documentElement.dataset.theme  — 'dark' | 'light'
 *   2. document.documentElement.classList      — добавляет/убирает класс 'dark'
 *      (для Tailwind dark: и существующих стилей AdminLayout)
 *
 * Использование:
 *   const { theme, setTheme, toggle, isDark } = useTheme()
 *   <button onClick={toggle}>{isDark ? 'light_mode' : 'dark_mode'}</button>
 *
 * Расширение: при добавлении нового кабинета — просто импортировать хук
 * и вызвать toggle() из иконки в шапке. Никакой локальной логики не нужно.
 * ============================================================================
 */
import { useEffect, useState, useCallback } from 'react'

const STORAGE_KEY = 'clinika-theme'
// Старые ключи — мигрируем в новый, чтобы выбор пользователя не сбросился
const LEGACY_KEYS = ['theme', 'adminTheme']

// ─── Чтение начального значения (SSR-safe) ──────────────────────────────────
function readInitialTheme() {
  if (typeof window === 'undefined') return 'light'
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'dark' || v === 'light') return v
    // Миграция: подхватываем старые ключи
    for (const k of LEGACY_KEYS) {
      const old = localStorage.getItem(k)
      if (old === 'dark' || old === 'light') {
        localStorage.setItem(STORAGE_KEY, old)
        return old
      }
    }
  } catch {}
  return 'light'
}

// ─── Применить тему к <html> ────────────────────────────────────────────────
function applyDomTheme(theme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.toggle('dark', theme === 'dark')
  // Обратная совместимость со старыми ключами — пишем туда же,
  // чтобы код, читающий localStorage напрямую, продолжал работать
  try {
    localStorage.setItem(STORAGE_KEY, theme)
    localStorage.setItem('theme', theme)
    localStorage.setItem('adminTheme', theme)
  } catch {}
}

// ─── Раннее применение до React-рендера (предотвращает «вспышку») ───────────
// Вызывается один раз при импорте модуля.
if (typeof document !== 'undefined') {
  try {
    applyDomTheme(readInitialTheme())
  } catch {}
}

export function useTheme() {
  const [theme, setThemeState] = useState(readInitialTheme)

  // Синхронизация при изменении состояния
  useEffect(() => {
    applyDomTheme(theme)
  }, [theme])

  // Слушаем изменения из других вкладок / других экземпляров хука
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'dark' || e.newValue === 'light')) {
        setThemeState(e.newValue)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setTheme = useCallback((next) => {
    if (next !== 'dark' && next !== 'light') return
    setThemeState(next)
  }, [])

  const toggle = useCallback(() => {
    setThemeState(prev => (prev === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, setTheme, toggle, isDark: theme === 'dark' }
}

export default useTheme
