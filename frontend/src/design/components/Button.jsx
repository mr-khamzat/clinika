/**
 * ========================================
 * БЛОК: <Button> — кнопка дизайн-системы
 * ========================================
 * Соответствует .btn / .btn-primary / .btn-secondary / .btn-ghost / .btn-sm из design-preview-2.
 *
 * Props:
 *   variant   — 'primary' | 'secondary' | 'ghost' | 'danger' (по умолчанию 'primary')
 *   size      — 'sm' | 'md' | 'lg' (по умолчанию 'md')
 *   leftIcon  — иконка слева (ReactNode)
 *   rightIcon — иконка справа (ReactNode)
 *   className — override
 *   ...rest   — пробрасываются на <button>
 * ========================================
 */
import { forwardRef } from 'react'

const SIZE = {
  sm: { padding: '6px 12px', fontSize: '12.5px', borderRadius: '8px' },
  md: { padding: '10px 16px', fontSize: '13.5px', borderRadius: '10px' },
  lg: { padding: '13px 22px', fontSize: '14.5px', borderRadius: '11px' },
}

function buildVariantStyle(variant) {
  switch (variant) {
    case 'secondary':
      return {
        background: 'var(--bg-2)',
        color: 'var(--fg)',
        border: '1px solid var(--border)',
      }
    case 'ghost':
      return {
        background: 'transparent',
        color: 'var(--fg-2)',
        border: '1px solid transparent',
      }
    case 'danger':
      return {
        background: 'var(--bad)',
        color: '#fff',
        border: '1px solid var(--bad)',
      }
    case 'primary':
    default:
      return {
        background: 'var(--accent)',
        color: 'var(--accent-fg)',
        border: '1px solid var(--accent)',
        boxShadow:
          '0 1px 0 oklch(1 0 0 / 0.12) inset, 0 6px 16px oklch(0.55 0.16 240 / 0.20)',
      }
  }
}

const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    leftIcon,
    rightIcon,
    className = '',
    children,
    type = 'button',
    ...rest
  },
  ref
) {
  const sz = SIZE[size] || SIZE.md
  const v = buildVariantStyle(variant)

  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition-[background,transform] active:translate-y-px hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      style={{ ...sz, ...v }}
      {...rest}
    >
      {leftIcon && <span className="inline-flex">{leftIcon}</span>}
      {children}
      {rightIcon && <span className="inline-flex">{rightIcon}</span>}
    </button>
  )
})

export default Button
