/**
 * ========================================
 * БЛОК: <ToastProvider> + хук useToast
 * ========================================
 * Контекст для глобальных уведомлений (тостов). Заменяет alert() в UI:
 *
 *   const { toast } = useToast()
 *   toast('Сохранено', 'success')
 *   toast('Ошибка сети', 'error', 6000)
 *
 * Provider оборачивает приложение один раз в App.jsx и рендерит
 * <Toast /> с очередью. Анимация — справа-снизу (на мобильном — сверху).
 * ========================================
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import Toast from './Toast'

// ===== БЛОК: контекст =====
const ToastContext = createContext({
  toast: () => {},
  dismiss: () => {},
})

// ===== БЛОК: провайдер =====
export function ToastProvider({ children }) {
  // Очередь активных тостов
  const [queue, setQueue] = useState([])
  // Счётчик id (стабильный между ререндерами)
  const idRef = useRef(0)

  // ===== БЛОК: убрать тост по id =====
  const dismiss = useCallback((id) => {
    setQueue((q) => q.filter((t) => t.id !== id))
  }, [])

  // ===== БЛОК: добавить тост =====
  // signature: toast(message, level?, duration?)
  // level: 'info' | 'success' | 'warn' | 'error' (default 'info')
  // duration: ms (default 4000), 0 — не закрывать автоматически
  const toast = useCallback(
    (message, level = 'info', duration = 4000) => {
      idRef.current += 1
      const id = idRef.current
      setQueue((q) => [...q, { id, level, message, duration }])
      return id
    },
    []
  )

  const ctx = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <Toast queue={queue} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

// ===== БЛОК: хук =====
export function useToast() {
  return useContext(ToastContext)
}

export default ToastProvider
