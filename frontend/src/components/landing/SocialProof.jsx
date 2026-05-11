/**
 * ========================================
 * БЛОК: SocialProof — логотипы клиник, которые нам доверяют
 * ========================================
 * Используются placeholder-логотипы (текстовые), стилизованные под клиники.
 * Если появятся реальные клиенты — заменить на <img loading="lazy">.
 * ========================================
 */
import { useEffect, useRef, useState } from 'react'

const CLIENTS = [
  ['Арктика', 'Клиника здоровья'],
  ['МедПлюс', 'Сеть из 8 клиник'],
  ['ВитаКом', 'Семейная медицина'],
  ['АльфаМед', 'Многопрофильный центр'],
  ['Эндокрин+', 'Лабораторная сеть'],
  ['ДоброМед', 'Педиатрия и стоматология'],
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
    <section ref={ref} className="ks-section ks-social-proof" aria-label="Клиенты КлиникСеть">
      <div className="ks-section-inner">
        <div className="ks-sp-label">Нам доверяют клиники в 24 регионах</div>
        <div
          className="ks-sp-grid"
          style={{
            opacity: shown ? 1 : 0,
            transform: shown ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 600ms ease, transform 600ms ease',
          }}
        >
          {CLIENTS.map(([name, sub]) => (
            <div key={name} className="ks-sp-item" title={`${name} · ${sub}`}>
              <span className="ks-sp-mark">●</span>
              <div>
                <div className="ks-sp-name">{name}</div>
                <div className="ks-sp-sub">{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
