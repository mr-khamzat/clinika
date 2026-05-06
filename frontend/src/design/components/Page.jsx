/**
 * ========================================
 * БЛОК: <Page> — обёртка страницы дизайн-системы
 * ========================================
 * Применяет фон/шрифт через CSS-переменные дизайн-токенов.
 * Используется как корневой контейнер для экранов, использующих новую дизайн-систему.
 *
 * Props:
 *   theme    — 'light' | 'dark' (по умолчанию 'light'); влияет на data-theme на корне
 *   className — доп. классы Tailwind
 *   children — содержимое страницы
 * ========================================
 */
import { useEffect } from 'react'

export default function Page({ theme = 'light', className = '', children, ...rest }) {
  // ─── Применяем тему через data-атрибут на html ───
  useEffect(() => {
    const root = document.documentElement
    const prev = root.getAttribute('data-theme')
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark')
    } else {
      root.removeAttribute('data-theme')
    }
    return () => {
      if (prev) root.setAttribute('data-theme', prev)
      else root.removeAttribute('data-theme')
    }
  }, [theme])

  return (
    <main
      className={`ks-app min-h-screen w-full ${className}`}
      style={{ background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--font-sans)' }}
      {...rest}
    >
      {children}
    </main>
  )
}
