/**
 * ========================================
 * БЛОК: Testimonials — placeholder под реальные отзывы
 * ========================================
 * Раньше тут были вымышленные цитаты от несуществующих клиентов — это
 * вводило читателя в заблуждение и било по доверию. Заменено на честный
 * placeholder: "Ваш отзыв будет здесь". Когда соберём реальные кейсы —
 * вернём 6-карточный grid с настоящими цитатами и логотипами.
 * ========================================
 */
import { useEffect, useRef, useState } from 'react'

export default function Testimonials() {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setShown(true); return }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShown(true); io.disconnect() }
    }, { threshold: 0.2 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section id="testimonials" className="ks-section ks-tm">
      <div className="ks-section-inner">
        <header className="ks-section-head">
          <div className="ks-section-eyebrow">Отзывы</div>
          <h2 className="ks-section-title">Кейсы клиентов — в разработке</h2>
          <p className="ks-section-sub">
            Мы только что начали публично собирать кейсы. Ваш отзыв и история внедрения
            могут оказаться здесь первыми — напишите нам.
          </p>
        </header>

        <div
          ref={ref}
          className="ks-tm-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 20,
            maxWidth: 900,
            margin: '0 auto',
            opacity: shown ? 1 : 0,
            transform: shown ? 'translateY(0)' : 'translateY(14px)',
            transition: 'opacity 600ms ease, transform 600ms ease',
          }}
        >
          <article
            className="ks-tm-card"
            style={{
              padding: 28,
              borderRadius: 18,
              background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
              border: '1.5px dashed #cbd5e1',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              minHeight: 220,
              gap: 12,
            }}
          >
            <div
              aria-hidden
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #0097A7 0%, #1565C0 100%)',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                fontSize: 24,
                fontWeight: 300,
              }}
            >
              +
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#0F172A' }}>
              В разработке: ваш отзыв будет здесь
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.55, maxWidth: 360 }}>
              Расскажете, как внедряли КлиникСеть — поделимся кейсом и предложим
              специальные условия на следующий год.
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}
