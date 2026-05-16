/**
 * Testimonial — большая цитата + аватар-плейсхолдер с инициалами.
 */

export default function Testimonial() {
  return (
    <section
      className="ks-section ks-testimonial"
      style={{
        padding: '72px 0',
        background:
          'linear-gradient(135deg, oklch(0.97 0.025 200) 0%, oklch(0.97 0.03 250) 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* декоративная кавычка */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -40,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 320,
          lineHeight: 1,
          color: 'rgba(0, 151, 167, 0.06)',
          fontFamily: 'Georgia, serif',
          fontWeight: 700,
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        “
      </div>

      <div
        className="ks-section-inner"
        style={{
          maxWidth: 880,
          margin: '0 auto',
          padding: '0 24px',
          textAlign: 'center',
          position: 'relative',
        }}
      >
        <blockquote
          style={{
            margin: 0,
            fontSize: 'clamp(20px, 2.6vw, 28px)',
            lineHeight: 1.5,
            fontWeight: 500,
            color: '#0F172A',
            letterSpacing: '-0.01em',
            marginBottom: 32,
          }}
        >
          «За первый квартал сократили среднее время ответа регистраторов с двенадцати минут
          до трёх с половиной. Конверсия в первичный приём выросла на 18%, а нагрузка
          на администраторов упала: вместо переключения между WhatsApp, телефоном и таблицей
          — один экран со всеми диалогами и шаблонами. Это не CRM поверх клиники — это сама клиника.»
        </blockquote>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div
            aria-hidden
            style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #0097A7 0%, #1565C0 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: '0.02em',
              boxShadow: '0 12px 28px rgba(21, 101, 192, 0.28)',
              flexShrink: 0,
            }}
          >
            КС
          </div>
          <div style={{ textAlign: 'left' }}>
            <div
              style={{
                fontSize: 17,
                fontWeight: 600,
                color: '#0F172A',
                marginBottom: 2,
              }}
            >
              Основатель сети
            </div>
            <div style={{ fontSize: 14, color: 'var(--fg-2)' }}>
              «КлиникСеть» · многопрофильная сеть
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4 }}>
              5 клиник · 50+ врачей
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 620px) {
          .ks-testimonial { padding: 48px 0 !important; }
        }
      `}</style>
    </section>
  )
}
