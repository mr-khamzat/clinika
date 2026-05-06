/**
 * ========================================
 * БЛОК: <Card> — карточка-контейнер
 * ========================================
 * Соответствует .card из design-preview-2: surface bg + border + radius + padding.
 * Подкомпоненты:
 *   <Card.Header>   — .card-hd (flex row, заголовок + действие)
 *   <Card.Title>    — .card-title
 *   <Card.Subtitle> — .card-sub
 *   <Card.Body>     — контент (без доп. стилей; padding уже на корне)
 *
 * Props (root):
 *   className — override
 *   padded    — boolean (по умолчанию true; false убирает padding)
 *   children  — контент
 * ========================================
 */
function Card({ className = '', padded = true, children, ...rest }) {
  return (
    <section
      className={className}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: padded ? '20px' : 0,
        boxShadow: 'var(--shadow-sm)',
      }}
      {...rest}
    >
      {children}
    </section>
  )
}

function CardHeader({ className = '', children, ...rest }) {
  return (
    <header
      className={`flex items-center justify-between mb-4 ${className}`}
      {...rest}
    >
      {children}
    </header>
  )
}

function CardTitle({ className = '', children, ...rest }) {
  return (
    <h3
      className={`font-semibold ${className}`}
      style={{ fontSize: '15px', letterSpacing: '-0.01em', color: 'var(--fg)' }}
      {...rest}
    >
      {children}
    </h3>
  )
}

function CardSubtitle({ className = '', children, ...rest }) {
  return (
    <p
      className={`mt-0.5 ${className}`}
      style={{ fontSize: '12.5px', color: 'var(--fg-3)' }}
      {...rest}
    >
      {children}
    </p>
  )
}

function CardBody({ className = '', children, ...rest }) {
  return (
    <div className={className} {...rest}>
      {children}
    </div>
  )
}

Card.Header = CardHeader
Card.Title = CardTitle
Card.Subtitle = CardSubtitle
Card.Body = CardBody

export default Card
