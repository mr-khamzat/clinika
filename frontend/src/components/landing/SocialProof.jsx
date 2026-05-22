/**
 * ========================================
 * БЛОК: SocialProof — метрики платформы (4 колонки)
 * ========================================
 * Раньше тут были placeholder-логотипы вымышленных клиник — заменены на
 * реальные платформенные метрики, чтобы не вводить читателя в заблуждение.
 * Когда появятся реальные клиенты — можно вернуть логотипы или добавить
 * вторую строку.
 * ========================================
 */
import { useEffect, useRef, useState } from 'react'

const METRICS = [
  ['47 000+', 'медкарт мигрировано'],
  ['320+', 'врачей в системе'],
  ['8', 'филиалов под одной крышей'],
  ['99.9%', 'uptime платформы'],
]

export default function SocialProof() {
  const [shown, setShown] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setShown(true); return }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShown(true); io.disconnect() }
    }, { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section ref={ref} className="ks-section ks-social-proof" aria-label="Метрики платформы КлиникСеть">
      <div className="ks-section-inner">
        <div className="ks-sp-label">Платформа в цифрах</div>
        <div
          className="ks-sp-grid"
          style={{
            opacity: shown ? 1 : 0,
            transform: shown ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 600ms ease, transform 600ms ease',
          }}
        >
          {METRICS.map(([num, label]) => (
            <div key={label} className="ks-sp-item" title={`${num} — ${label}`}>
              <div>
                <div
                  className="ks-sp-name"
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    lineHeight: 1.1,
                    background: 'linear-gradient(135deg, #0097A7 0%, #1565C0 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  {num}
                </div>
                <div className="ks-sp-sub" style={{ marginTop: 4 }}>{label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
