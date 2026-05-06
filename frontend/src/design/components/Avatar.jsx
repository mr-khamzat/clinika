/**
 * ========================================
 * БЛОК: <Avatar> — аватар (фото или инициалы)
 * ========================================
 * Соответствует .avatar из design-preview-2 с размерами sm/md/lg/xl.
 *
 * Props:
 *   name      — полное имя; используется для инициалов и aria-label
 *   src       — URL изображения (опционально); при ошибке — fallback на инициалы
 *   size      — 'sm' (24) | 'md' (32) | 'lg' (40) | 'xl' (56)
 *   className — override
 * ========================================
 */
import { useState } from 'react'

const SIZES = {
  sm: { px: 24, font: '10px' },
  md: { px: 32, font: '12px' },
  lg: { px: 40, font: '14px' },
  xl: { px: 56, font: '20px' },
}

function getInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?'
  return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase()
}

export default function Avatar({ name = '', src, size = 'md', className = '', ...rest }) {
  const [imgErr, setImgErr] = useState(false)
  const sz = SIZES[size] || SIZES.md
  const showImg = src && !imgErr

  return (
    <span
      role="img"
      aria-label={name || 'avatar'}
      className={`inline-grid place-items-center overflow-hidden font-bold ${className}`}
      style={{
        width: sz.px,
        height: sz.px,
        borderRadius: '50%',
        background:
          'linear-gradient(135deg, oklch(0.7 0.14 30), oklch(0.65 0.16 60))',
        color: '#fff',
        fontSize: sz.font,
        flexShrink: 0,
      }}
      {...rest}
    >
      {showImg ? (
        <img
          src={src}
          alt={name}
          width={sz.px}
          height={sz.px}
          onError={() => setImgErr(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        getInitials(name)
      )}
    </span>
  )
}
