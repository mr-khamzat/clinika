/**
 * ========================================
 * БЛОК: <InfoHint> — иконка-подсказка с тултипом
 * ========================================
 * Маленькая иконка ℹ️ (Material Symbol "info"), при наведении на десктопе
 * показывает поповер-тултип; на тач-устройствах по тапу открывает модалку
 * с тем же текстом.
 *
 * Props:
 *   text       — string или ReactNode (контент подсказки, обязательно)
 *   title      — string, заголовок модалки на mobile (опц., default "Подсказка")
 *   size       — number, размер иконки в px (default 16)
 *   className  — override классов на иконке
 *   ariaLabel  — aria-label иконки (default "Подсказка")
 *
 * Особенности:
 *   - На десктопе: hover/focus → tooltip справа от иконки
 *   - На мобильном (<= 640px): tap → центральная модалка
 *   - Esc/клик по backdrop закрывает модалку
 *   - Стили инжектируются один раз через ensureStyles()
 * ========================================
 */
import { useEffect, useRef, useState } from 'react'

// ===== БЛОК: единоразовая инъекция CSS =====
const STYLE_ID = 'ks-infohint-styles'
function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const css = `
    .ks-ih-wrap {
      display: inline-flex;
      align-items: center;
      vertical-align: middle;
      position: relative;
    }
    .ks-ih-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 999px;
      border: 1px solid var(--line, #e5e7eb);
      background: var(--bg-1, #f8fafc);
      color: var(--fg-3, #6b7280);
      cursor: help;
      padding: 0;
      transition: all 140ms ease;
      flex-shrink: 0;
    }
    .ks-ih-btn:hover, .ks-ih-btn:focus-visible {
      color: var(--accent, #0097A7);
      border-color: var(--accent, #0097A7);
      background: var(--accent-soft, rgba(0,151,167,0.10));
      outline: none;
    }
    .ks-ih-btn .material-symbols-outlined {
      font-size: 14px;
      font-variation-settings: 'FILL' 0, 'wght' 500, 'opsz' 20;
    }
    .ks-ih-tip {
      position: absolute;
      top: 50%;
      left: calc(100% + 8px);
      transform: translateY(-50%);
      max-width: 320px;
      min-width: 200px;
      padding: 10px 12px;
      background: var(--fg, #111827);
      color: #fff;
      font-size: 12.5px;
      line-height: 1.5;
      font-weight: 400;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.18);
      z-index: 999;
      pointer-events: none;
      opacity: 0;
      animation: ks-ih-fade 140ms ease-out forwards;
      white-space: normal;
    }
    .ks-ih-tip::before {
      content: '';
      position: absolute;
      top: 50%;
      right: 100%;
      transform: translateY(-50%);
      border: 6px solid transparent;
      border-right-color: var(--fg, #111827);
    }
    @keyframes ks-ih-fade {
      from { opacity: 0; transform: translateY(-50%) translateX(-4px); }
      to   { opacity: 1; transform: translateY(-50%) translateX(0); }
    }
    /* Мобильная модалка */
    .ks-ih-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.45);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 2000;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      animation: ks-ih-bdrop-in 160ms ease-out;
    }
    @keyframes ks-ih-bdrop-in { from { opacity: 0; } to { opacity: 1; } }
    .ks-ih-modal {
      background: var(--bg, #fff);
      color: var(--fg, #111827);
      max-width: 420px;
      width: 100%;
      border-radius: 16px;
      padding: 20px 22px;
      box-shadow: 0 18px 60px rgba(0,0,0,0.25);
      animation: ks-ih-pop-in 160ms ease-out;
    }
    @keyframes ks-ih-pop-in {
      from { opacity: 0; transform: translateY(8px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .ks-ih-modal-title {
      font-size: 16px; font-weight: 700;
      margin: 0 0 8px;
      color: var(--fg, #111827);
      display: flex; align-items: center; gap: 8px;
    }
    .ks-ih-modal-title .material-symbols-outlined {
      color: var(--accent, #0097A7);
      font-variation-settings: 'FILL' 1, 'wght' 500;
    }
    .ks-ih-modal-text {
      font-size: 14px; line-height: 1.55; color: var(--fg-2, #374151);
      margin: 0 0 16px;
    }
    .ks-ih-modal-close {
      padding: 8px 18px;
      background: var(--accent, #0097A7);
      color: #fff;
      border: 0;
      border-radius: 10px;
      font-weight: 600;
      cursor: pointer;
      font-size: 14px;
    }
    .ks-ih-modal-close:hover { filter: brightness(1.05); }
    /* На мобиле скрываем hover-tip — используем модалку */
    @media (max-width: 640px) {
      .ks-ih-tip { display: none !important; }
    }
  `
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = css
  document.head.appendChild(style)
}

// ===== БЛОК: определение тач-устройства =====
function isTouchDevice() {
  if (typeof window === 'undefined') return false
  return (
    'ontouchstart' in window ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
    window.matchMedia('(max-width: 640px)').matches
  )
}

// ===== БЛОК: основной компонент =====
export default function InfoHint({
  text,
  title = 'Подсказка',
  size = 16,
  className = '',
  ariaLabel = 'Подсказка',
}) {
  ensureStyles()
  const [hover, setHover] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const btnRef = useRef(null)

  // Закрытие модалки по Esc
  useEffect(() => {
    if (!modalOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setModalOpen(false) }
    document.addEventListener('keydown', onKey)
    // Блокируем скролл body
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [modalOpen])

  const onClick = (e) => {
    e.stopPropagation()
    e.preventDefault()
    if (isTouchDevice()) setModalOpen(true)
  }

  return (
    <span className={`ks-ih-wrap ${className}`}>
      <button
        ref={btnRef}
        type="button"
        className="ks-ih-btn"
        aria-label={ariaLabel}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onClick={onClick}
        style={size !== 16 ? { width: size + 6, height: size + 6 } : undefined}
      >
        <span className="material-symbols-outlined" aria-hidden="true">info</span>
      </button>

      {hover && !modalOpen && (
        <span className="ks-ih-tip" role="tooltip">{text}</span>
      )}

      {modalOpen && (
        <div
          className="ks-ih-backdrop"
          onClick={() => setModalOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="ks-ih-modal" onClick={e => e.stopPropagation()}>
            <h3 className="ks-ih-modal-title">
              <span className="material-symbols-outlined" aria-hidden="true">info</span>
              {title}
            </h3>
            <div className="ks-ih-modal-text">{text}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="ks-ih-modal-close" onClick={() => setModalOpen(false)}>
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}
    </span>
  )
}
