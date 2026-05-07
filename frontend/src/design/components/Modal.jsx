/**
 * ========================================
 * БЛОК: <Modal> — переиспользуемая модалка дизайн-системы
 * ========================================
 * Соответствует .modal/.modal-card из design-preview-2: backdrop с blur,
 * surface bg + radius-lg + shadow-lg. На мобильном (<640px) рендерится
 * как bottom-sheet с slide-up анимацией.
 *
 * Props:
 *   open      — boolean, контролируется снаружи
 *   onClose   — fn, вызывается на Esc, клик по backdrop, кнопке закрытия
 *   title     — string, заголовок (опционально)
 *   children  — контент модалки
 *   size      — 'sm' | 'md' | 'lg' (по умолчанию 'md'), max-width
 *   actions   — JSX-нода с кнопками внизу (опционально)
 *   className — override корневого узла .modal-card
 *
 * Поведение:
 *   - Esc → onClose
 *   - Клик по backdrop → onClose
 *   - Клик внутри карточки → не закрывает (stopPropagation)
 *   - Focus trap: фокус возвращается на ранее активный элемент
 *   - body scroll lock пока open=true
 * ========================================
 */
import { useEffect, useRef, useState, useCallback } from 'react'

// ===== БЛОК: размеры =====
const SIZE = {
  sm: '420px',
  md: '560px',
  lg: '760px',
}

// ===== БЛОК: глобальные стили модалки (вставляем один раз) =====
const STYLE_ID = 'ks-modal-styles'
function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const css = `
    @keyframes ks-modal-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes ks-modal-pop-in {
      from { opacity: 0; transform: translateY(20px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes ks-modal-fade-out { from { opacity: 1; } to { opacity: 0; } }
    @keyframes ks-modal-pop-out {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to   { opacity: 0; transform: translateY(20px) scale(0.98); }
    }
    @keyframes ks-modal-slide-up {
      from { opacity: 0; transform: translateY(100%); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes ks-modal-slide-down {
      from { opacity: 1; transform: translateY(0); }
      to   { opacity: 0; transform: translateY(100%); }
    }
    .ks-modal-backdrop {
      position: fixed; inset: 0;
      background: oklch(0.18 0.014 220 / 0.45);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      z-index: 1000;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      transition: opacity 200ms ease;
      animation: ks-modal-fade-in 200ms ease-out;
    }
    .ks-modal-backdrop.is-closing { animation: ks-modal-fade-out 200ms ease-in forwards; }
    .ks-modal-card {
      background: var(--surface);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      width: 100%;
      max-height: calc(100vh - 32px);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: opacity 200ms ease, transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
      animation: ks-modal-pop-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .ks-modal-backdrop.is-closing .ks-modal-card { animation: ks-modal-pop-out 200ms cubic-bezier(0.4, 0, 1, 1) forwards; }
    .ks-modal-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
    }
    .ks-modal-title {
      font-size: 15px; font-weight: 600; letter-spacing: -0.01em;
      color: var(--fg); margin: 0;
    }
    .ks-modal-close {
      background: transparent; border: 0; cursor: pointer;
      width: 32px; height: 32px; border-radius: 8px;
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--fg-3);
      transition: background 120ms ease;
    }
    .ks-modal-close:hover { background: var(--bg-2); color: var(--fg); }
    .ks-modal-body {
      padding: 20px;
      overflow: auto;
      flex: 1 1 auto;
      color: var(--fg-2);
      font-size: 13.5px;
      line-height: 1.55;
    }
    .ks-modal-actions {
      padding: 14px 20px;
      border-top: 1px solid var(--border);
      display: flex; justify-content: flex-end; gap: 8px;
      background: var(--bg-1);
    }
    /* ===== Bottom-sheet на мобильном ===== */
    @media (max-width: 640px) {
      .ks-modal-backdrop {
        align-items: flex-end;
        padding: 0;
      }
      .ks-modal-card {
        border-radius: var(--radius-lg) var(--radius-lg) 0 0;
        max-height: 92vh;
        animation: ks-modal-slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .ks-modal-backdrop.is-closing .ks-modal-card {
        animation: ks-modal-slide-down 220ms cubic-bezier(0.4, 0, 1, 1) forwards;
      }
    }
  `
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = css
  document.head.appendChild(tag)
}

// ===== БЛОК: компонент =====
export default function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  actions,
  className = '',
}) {
  const cardRef = useRef(null)
  const prevFocusRef = useRef(null)
  // ===== БЛОК: closing-state для exit-анимации (200ms) =====
  // mounted синхронен с open, но при open=false держим узел в DOM ещё ~220ms,
  // чтобы проиграть fade-out + pop-out.
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
    } else if (mounted) {
      setClosing(true)
      const t = setTimeout(() => { setMounted(false); setClosing(false) }, 220)
      return () => clearTimeout(t)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Стабильный коллбэк закрытия (используется в обработчиках ниже)
  const requestClose = useCallback(() => { onClose && onClose() }, [onClose])

  // ===== БЛОК: гарантируем CSS =====
  useEffect(() => {
    ensureStyles()
  }, [])

  // ===== БЛОК: Esc + body scroll lock + focus management =====
  useEffect(() => {
    if (!open) return
    // Запоминаем активный элемент, чтобы вернуть фокус после закрытия
    prevFocusRef.current = document.activeElement

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose && onClose()
      } else if (e.key === 'Tab') {
        // Простой focus-trap: ограничиваем Tab внутри карточки
        const card = cardRef.current
        if (!card) return
        const focusable = card.querySelectorAll(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)

    // Блокируем скролл body
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Фокусируем первый интерактивный элемент или саму карточку
    setTimeout(() => {
      const card = cardRef.current
      if (!card) return
      const focusable = card.querySelector(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]'
      )
      ;(focusable || card).focus()
    }, 0)

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      // Возвращаем фокус
      try {
        if (prevFocusRef.current && prevFocusRef.current.focus) {
          prevFocusRef.current.focus()
        }
      } catch {}
    }
  }, [open, onClose])

  if (!mounted) return null

  const maxWidth = SIZE[size] || SIZE.md

  // ===== БЛОК: рендер =====
  return (
    <div
      className={`ks-modal-backdrop ${closing ? 'is-closing' : ''}`}
      onMouseDown={(e) => {
        // Закрываем только если клик начался на самом backdrop
        if (e.target === e.currentTarget) requestClose()
      }}
      role="presentation"
    >
      <div
        ref={cardRef}
        className={`ks-modal-card ${className}`}
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Диалог'}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(title || onClose) && (
          <header className="ks-modal-head">
            {title ? <h3 className="ks-modal-title">{title}</h3> : <span />}
            {onClose && (
              <button
                type="button"
                className="ks-modal-close"
                onClick={onClose}
                aria-label="Закрыть"
              >
                {/* Крестик */}
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M3 3 L13 13 M13 3 L3 13"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </header>
        )}
        <div className="ks-modal-body">{children}</div>
        {actions && <footer className="ks-modal-actions">{actions}</footer>}
      </div>
    </div>
  )
}
