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
  // Поддерживаются ДВЕ сигнатуры (для обратной совместимости):
  //   1) toast(message, level?, duration?)
  //   2) toast({ kind|level, text|message, duration })  ← старый стиль из секций
  // level/kind: 'info' | 'success' | 'warn' | 'error' (default 'info')
  // duration: ms (default 4000), 0 — не закрывать автоматически
  //
  // Защита от React error #31: message всегда приводится к строке.
  const toast = useCallback(
    (message, level = 'info', duration = 4000) => {
      // Нормализация объектной сигнатуры { kind, text }
      if (message && typeof message === 'object' && !Array.isArray(message)) {
        const obj = message
        const lvl = obj.level || obj.kind || level || 'info'
        const dur = typeof obj.duration === 'number' ? obj.duration : duration
        const txt = obj.text != null
          ? obj.text
          : (obj.message != null ? obj.message : '')
        idRef.current += 1
        const id = idRef.current
        setQueue((q) => [
          ...q,
          { id, level: String(lvl), message: txt == null ? '' : String(txt), duration: dur },
        ])
        return id
      }
      // Строковая (или любая примитивная) сигнатура — гарантируем строку
      const safeMessage = message == null
        ? ''
        : (typeof message === 'string' ? message : String(message))
      idRef.current += 1
      const id = idRef.current
      setQueue((q) => [...q, { id, level, message: safeMessage, duration }])
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
