/**
 * MarkdownText — безопасный inline-рендер Markdown в сообщениях чата.
 *
 * Используется в MessageBubble. Ограниченный набор разметки:
 *   • **bold** / __bold__
 *   • *italic* / _italic_
 *   • `code`
 *   • [текст](url) — внешние ссылки открываются в новой вкладке
 *
 * Заголовки/списки/таблицы намеренно отключены — это чат, не статья.
 * Никакого raw HTML (react-markdown не парсит HTML по умолчанию).
 */
import ReactMarkdown from 'react-markdown'

const ALLOWED_TYPES = ['text', 'paragraph', 'strong', 'emphasis', 'code', 'link', 'break']

export default function MarkdownText({ children, className = '' }) {
  if (!children) return null
  return (
    <div className={`md-text ${className}`}>
      <ReactMarkdown
        allowedElements={['p', 'strong', 'em', 'code', 'a', 'br']}
        unwrapDisallowed={true}
        components={{
          // Параграфы в чате — просто div, без отступов
          p: ({ children }) => <span style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{children}</span>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              style={{ color: 'var(--accent, #0097A7)', textDecoration: 'underline' }}
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code
              style={{
                background: 'rgba(0,0,0,.06)',
                padding: '1px 5px',
                borderRadius: 4,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.9em',
              }}
            >
              {children}
            </code>
          ),
        }}
      >
        {String(children)}
      </ReactMarkdown>
    </div>
  )
}
