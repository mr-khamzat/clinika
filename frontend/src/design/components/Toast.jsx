/**
 * ========================================
 * БЛОК: <Toast> — рендер очереди уведомлений
 * ========================================
 * Чисто визуальный компонент: получает queue (массив тостов из ToastContext)
 * и рендерит их в правом-нижнем углу. На мобильном (<640px) — сверху по центру.
 *
 * Цвета берутся из токенов: --good, --warn, --bad, --accent.
 * Auto-dismiss: каждый тост сам вызывает onDismiss(id) через duration ms.
 *
 * Импортируется ToastProvider'ом, не предназначен для прямого использования.
 * ========================================
 */
import { useEffect } from 'react'

// ===== БЛОК: палитра по уровням =====
const LEVEL_STYLE = {
  info: {
    bg: 'var(--surface)',
    border: 'var(--border-strong)',
    icon: 'var(--accent)',
    iconBg: 'var(--accent-soft)',
  },
  success: {
    bg: 'var(--surface)',
    border: 'var(--good)',
    icon: 'var(--good)',
    iconBg: 'var(--good-soft)',
  },
  warn: {
    bg: 'var(--surface)',
    border: 'var(--warn)',
    icon: 'var(--warn)',
    iconBg: 'var(--warn-soft)',
  },
  error: {
    bg: 'var(--surface)',
    border: 'var(--bad)',
    icon: 'var(--bad)',
    iconBg: 'var(--bad-soft)',
  },
}

// ===== БЛОК: иконки SVG =====
function LevelIcon({ level }) {
  const stroke = 'currentColor'
  if (level === 'success') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 8.5 L6.5 12 L13 4.5" stroke={stroke} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (level === 'warn') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 3 L14 13 L2 13 Z" stroke={stroke} strokeWidth="1.6" fill="none" strokeLinejoin="round" />
        <path d="M8 7 V10" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="8" cy="11.5" r="0.9" fill={stroke} />
      </svg>
    )
  }
  if (level === 'error') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke={stroke} strokeWidth="1.6" fill="none" />
        <path d="M5 5 L11 11 M11 5 L5 11" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }
  // info по умолчанию
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke={stroke} strokeWidth="1.6" fill="none" />
      <path d="M8 7 V11.5" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="4.6" r="0.9" fill={stroke} />
    </svg>
  )
}

// ===== БЛОК: глобальные стили (вставляются один раз) =====
const STYLE_ID = 'ks-toast-styles'
function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const css = `
    @keyframes ks-toast-in-right {
      from { opacity: 0; transform: translateX(24px) scale(0.98); }
      to   { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes ks-toast-in-top {
      from { opacity: 0; transform: translateY(-16px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .ks-toast-stack {
      position: fixed;
      right: 16px; bottom: 16px;
      display: flex; flex-direction: column; gap: 8px;
      z-index: 1100;
      pointer-events: none;
      max-width: min(380px, calc(100vw - 32px));
    }
    .ks-toast-item {
      pointer-events: auto;
      display: flex; align-items: flex-start; gap: 10px;
      padding: 12px 14px;
      border-radius: var(--radius);
      box-shadow: var(--shadow-md);
      background: var(--surface);
      color: var(--fg);
      font-size: 13px;
      line-height: 1.45;
      animation: ks-toast-in-right 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
      border: 1px solid var(--border);
      border-left-width: 3px;
    }
    .ks-toast-icon {
      flex: 0 0 auto;
      width: 22px; height: 22px;
      border-radius: 999px;
      display: inline-flex; align-items: center; justify-content: center;
      margin-top: 1px;
    }
    .ks-toast-text { flex: 1 1 auto; word-break: break-word; }
    .ks-toast-close {
      flex: 0 0 auto;
      background: transparent; border: 0; cursor: pointer;
      width: 22px; height: 22px; border-radius: 6px;
      color: var(--fg-3);
      display: inline-flex; align-items: center; justify-content: center;
      transition: background 120ms ease;
    }
    .ks-toast-close:hover { background: var(--bg-2); color: var(--fg); }
    @media (max-width: 640px) {
      .ks-toast-stack {
        right: 12px; left: 12px; bottom: auto; top: 12px;
        max-width: none;
        align-items: stretch;
      }
      .ks-toast-item {
        animation: ks-toast-in-top 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }
    }
  `
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = css
  document.head.appendChild(tag)
}

// ===== БЛОК: одиночный тост (с auto-dismiss таймером) =====
function ToastItem({ item, onDismiss }) {
  const { id, level, message, duration } = item
  const palette = LEVEL_STYLE[level] || LEVEL_STYLE.info

  useEffect(() => {
    if (!duration || duration <= 0) return
    const timer = setTimeout(() => onDismiss(id), duration)
    return () => clearTimeout(timer)
  }, [id, duration, onDismiss])

  return (
    <div
      className="ks-toast-item"
      role={level === 'error' ? 'alert' : 'status'}
      style={{
        background: palette.bg,
        borderLeftColor: palette.border,
      }}
    >
      <span
        className="ks-toast-icon"
        style={{ background: palette.iconBg, color: palette.icon }}
      >
        <LevelIcon level={level} />
      </span>
      <div className="ks-toast-text">{
        /* Защита от React error #31: если message — объект,
           извлекаем text/message или сериализуем. */
        (message && typeof message === 'object')
          ? (message.text || message.message || JSON.stringify(message))
          : (message == null ? '' : String(message))
      }</div>
      <button
        type="button"
        className="ks-toast-close"
        onClick={() => onDismiss(id)}
        aria-label="Закрыть уведомление"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

// ===== БЛОК: стек тостов =====
export default function Toast({ queue = [], onDismiss }) {
  // Гарантируем CSS при первом рендере
  useEffect(() => {
    ensureStyles()
  }, [])

  if (!queue.length) return null

  return (
    <div className="ks-toast-stack" aria-live="polite" aria-atomic="false">
      {queue.map((item) => (
        <ToastItem key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
