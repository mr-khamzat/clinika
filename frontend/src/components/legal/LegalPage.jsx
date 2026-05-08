// Общий layout для юридических страниц (/privacy, /terms, /consent).
// Принимает title + children (контент). Печатно-дружественный, без лишнего хрома.

export function LegalPage({ title, updated, children }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg, #f8fafc)',
      color: 'var(--fg, #0f172a)',
      padding: '32px 16px 64px',
    }}>
      <div style={{
        maxWidth: 760,
        margin: '0 auto',
        background: 'var(--bg-card, #fff)',
        borderRadius: 16,
        padding: '32px 36px',
        boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.06)',
        lineHeight: 1.6,
      }}>
        <a
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: 'var(--fg-3, #64748b)',
            textDecoration: 'none',
            marginBottom: 16,
          }}
        >
          ← КлиникСеть
        </a>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px' }}>{title}</h1>
        {updated && (
          <div style={{ fontSize: 13, color: 'var(--fg-3, #64748b)', marginBottom: 24 }}>
            Действует с {updated}
          </div>
        )}
        <div className="legal-content" style={{ fontSize: 15 }}>
          {children}
        </div>
        <style>{`
          .legal-content h2 { font-size: 19px; font-weight: 600; margin: 28px 0 10px; color: var(--fg, #0f172a); }
          .legal-content p { margin: 0 0 12px; }
          .legal-content ul { margin: 0 0 12px; padding-left: 22px; }
          .legal-content li { margin-bottom: 6px; }
          .legal-content code { font-family: ui-monospace, monospace; background: rgba(0,0,0,.04); padding: 1px 6px; border-radius: 4px; font-size: 13px; }
          .legal-content b { color: var(--fg, #0f172a); }
        `}</style>
      </div>
    </div>
  )
}
