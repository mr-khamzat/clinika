// Единый логотип КлиникСеть — SVG, идентичный favicon.svg.
// Используется во всех местах где раньше стоял Юникод ⚕ или текст без иконки:
// Landing nav/footer/login modal, Franchise nav, PatientCabinet header, AdminLayout.
//
// Параметры:
//   size — пиксельный размер (по умолчанию 32)
//   rounded — скруглённость углов (рассчитывается от size — 0.18 ≈ favicon)
//   color — основной цвет (default: бирюзовый brand)
//   white — рендерим инверс (белый плюс на прозрачном/тёмном фоне)
//
// Пример: <BrandLogo size={36} />
//         <BrandLogo size={20} color="#fff" />

export function BrandLogo({ size = 32, color = '#0097A7', white = false, style, className }) {
  const r = size * 0.18  // 12 при size=64 (как в favicon)
  const fg = white ? '#fff' : color
  const bg = white ? 'transparent' : color
  const cross = white ? color : '#fff'

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      style={style}
      className={className}
      role="img"
      aria-label="КлиникСеть"
    >
      <rect width="64" height="64" rx="12" fill={bg} />
      <rect x="26" y="12" width="12" height="40" rx="3" fill={cross} />
      <rect x="12" y="26" width="40" height="12" rx="3" fill={cross} />
    </svg>
  )
}

// Тонкая версия только с крестом (без фона) — для случаев на цветной поверхности
export function BrandMark({ size = 24, color = '#0097A7', style, className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      style={style}
      className={className}
      role="img"
      aria-label="КлиникСеть"
    >
      <rect x="26" y="12" width="12" height="40" rx="3" fill={color} />
      <rect x="12" y="26" width="40" height="12" rx="3" fill={color} />
    </svg>
  )
}
