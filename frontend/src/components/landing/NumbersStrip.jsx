/**
 * NumbersStrip — лента ключевых метрик с count-up анимацией.
 * Запускается при появлении в viewport через IntersectionObserver.
 */
import { useEffect, useRef, useState } from 'react'

// ===== БЛОК: метрики =====
const METRICS = [
  { value: 5,    suffix: '',    title: 'клиник',    subtitle: 'в сети «КлиникСеть»' },
  { value: 50,   suffix: '+',   title: 'врачей',    subtitle: 'работают онлайн ежедневно' },
  { value: 3.5,  suffix: ' мин', title: 'ср. ответ', subtitle: 'регистратора пациенту' },
  { value: 99.9, suffix: '%',   title: 'uptime',    subtitle: 'SLA платформы за квартал' },
]

// ===== БЛОК: одна цифра с count-up =====
function CountUp({ target, suffix, run }) {
  const [val, setVal] = useState(0)
  const rafRef = useRef(null)

  useEffect(() => {
    if (!run) return
    const start = performance.now()
    const duration = 1400
    const decimals = Number.isInteger(target) ? 0 : 1

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      const current = target * eased
      setVal(Number(current.toFixed(decimals)))
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [run, target])

  return (
    <span>
      {val}
      {suffix}
    </span>
  )
}

// ===== БЛОК: основной компонент =====
export default function NumbersStrip() {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!ref.current) return
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setVisible(true)
            io.disconnect()
          }
        })
      },
      { threshold: 0.25 }
    )
    io.observe(ref.current)
    return () => io.disconnect()
  }, [])

  return (
    <section
      ref={ref}
      className="ks-section ks-numbers"
      style={{
        padding: '72px 0',
        background:
          'linear-gradient(180deg, var(--bg) 0%, oklch(0.97 0.02 200) 50%, var(--bg) 100%)',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div
        className="ks-section-inner ks-numbers-grid"
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '0 24px',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 24,
        }}
      >
        {METRICS.map((m, i) => (
          <div
            key={m.title}
            className="ks-numbers-card"
            style={{
              textAlign: 'center',
              padding: '24px 16px',
              borderRadius: 20,
              background: 'rgba(255,255,255,.6)',
              backdropFilter: 'blur(12px)',
              border: '1px solid var(--border)',
              transition: 'transform .3s ease, box-shadow .3s ease',
            }}
          >
            <div
              className="ks-numbers-value"
              style={{
                fontSize: 'clamp(40px, 5vw, 64px)',
                fontWeight: 700,
                lineHeight: 1.05,
                letterSpacing: '-0.02em',
                background:
                  'linear-gradient(135deg, #0097A7 0%, #1565C0 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                marginBottom: 8,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <CountUp target={m.value} suffix={m.suffix} run={visible} />
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--fg)',
                marginBottom: 4,
              }}
            >
              {m.title}
            </div>
            <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
              {m.subtitle}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @media (max-width: 720px) {
          .ks-numbers { padding: 48px 0 !important; }
          .ks-numbers-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 16px !important; }
        }
      `}</style>
    </section>
  )
}
