/**
 * ========================================
 * БЛОК: <Chip> — чип/бейдж/пилюля
 * ========================================
 * Соответствует .chip из design-preview-2 со вариантами .chip-good/.chip-warn/.chip-bad/.chip-accent.
 *
 * Props:
 *   variant   — 'default' | 'accent' | 'good' | 'warn' | 'bad' (по умолчанию 'default')
 *   dot       — boolean: показывать точку-индикатор (.chip-dot) слева
 *   className — override
 *   children  — содержимое
 * ========================================
 */
const VARIANTS = {
  default: {
    background: 'var(--bg-2)',
    color: 'var(--fg-2)',
    borderColor: 'var(--border)',
  },
  accent: {
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    borderColor: 'var(--accent-line)',
  },
  good: {
    background: 'var(--good-soft)',
    color: 'var(--good)',
    borderColor: 'var(--good-soft)',
  },
  warn: {
    background: 'var(--warn-soft)',
    color: 'var(--warn)',
    borderColor: 'var(--warn-soft)',
  },
  bad: {
    background: 'var(--bad-soft)',
    color: 'var(--bad)',
    borderColor: 'var(--bad-soft)',
  },
}

export default function Chip({ variant = 'default', dot = false, className = '', children, ...rest }) {
  const v = VARIANTS[variant] || VARIANTS.default
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium ${className}`}
      style={{
        padding: '4px 10px',
        borderRadius: '999px',
        fontSize: '11.5px',
        background: v.background,
        color: v.color,
        border: `1px solid ${v.borderColor}`,
      }}
      {...rest}
    >
      {dot && (
        <span
          aria-hidden
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'currentColor',
            display: 'inline-block',
          }}
        />
      )}
      {children}
    </span>
  )
}
