/**
 * ========================================
 * ХУК: useRegHotkeys — горячие клавиши регистратора (Глава 5)
 * ========================================
 * Регистрирует глобальные Alt+N/R/S/P/W и Ctrl+K для роли reg.
 * Hotkey НЕ срабатывает в полях ввода (INPUT/TEXTAREA/SELECT/contentEditable).
 *
 * actions = {
 *   onNewPatient,        // Alt+N — создание нового пациента/направления
 *   onBookAppointment,   // Alt+R — запись на приём
 *   onSearch,            // Alt+S — фокус в поиск
 *   onPrintLast,         // Alt+P — печать последнего направления
 *   onWaitlist,          // Alt+W — список ожидания / направления
 *   onCommandPalette,    // Ctrl+K — открыть командную палитру
 * }
 *
 * disabled — пропускает регистрацию (для отключения извне).
 * ========================================
 */
import { useEffect, useRef } from 'react'

function _isEditable(el) {
  if (!el) return false
  const tag = (el.tagName || '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return false
}

export default function useRegHotkeys(actions = {}, { disabled = false } = {}) {
  // Держим callbacks в ref, чтобы не пересоздавать listener каждый рендер
  const ref = useRef(actions)
  ref.current = actions

  useEffect(() => {
    if (disabled) return
    const handler = (e) => {
      // Ctrl+K / Cmd+K — командная палитра (даже из полей ввода)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ref.current.onCommandPalette?.()
        return
      }

      // Все Alt-сочетания пропускаем в input/textarea/select
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (_isEditable(e.target)) return

      const k = (e.key || '').toLowerCase()
      // На русской раскладке Alt+R даст «к», поэтому смотрим и e.code
      const code = (e.code || '').toLowerCase()

      const map = {
        n: 'onNewPatient',     // Alt+N
        r: 'onBookAppointment', // Alt+R
        s: 'onSearch',          // Alt+S
        p: 'onPrintLast',       // Alt+P
        w: 'onWaitlist',        // Alt+W
      }
      const codeMap = {
        keyn: 'onNewPatient',
        keyr: 'onBookAppointment',
        keys: 'onSearch',
        keyp: 'onPrintLast',
        keyw: 'onWaitlist',
      }
      const fnName = map[k] || codeMap[code]
      if (fnName && typeof ref.current[fnName] === 'function') {
        e.preventDefault()
        ref.current[fnName]()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [disabled])
}
