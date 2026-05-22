/**
 * ========================================
 * БЛОК: Comparison — таблица сравнения с конкурентами
 * ========================================
 * 3 колонки: КлиникСеть | 1С Медицина | Renovatio.
 * Колонка КлиникСеть выделена primary-цветом, галочки зелёные, минусы красные.
 * Используется в Landing.jsx ПЕРЕД FAQ.
 * ========================================
 */
import { useEffect, useRef, useState } from 'react'

// === Конфиг строк сравнения ===
const ROWS = [
  { label: 'Запуск под ключ',                  ks: '28 дней',    a: '90+ дней',     b: '60+ дней' },
  { label: 'Цена от',                          ks: '9 900 ₽/мес', a: 'от 100 000 ₽', b: 'от 50 000 ₽' },
  { label: 'Встроенный чат с пациентами',      ks: 'yes',         a: 'no',           b: 'partial' },
  { label: 'Аналитика по клиникам',            ks: 'yes',         a: 'partial',      b: 'partial' },
  { label: 'Web-кабинет пациента',             ks: 'yes',         a: 'partial',      b: 'yes' },
  { label: 'WhatsApp deep-link',               ks: 'yes',         a: 'no',           b: 'no' },
  { label: 'Telemed встроенный',               ks: 'yes',         a: 'no',           b: 'partial' },
  { label: 'Поддержка 24/7',                   ks: 'yes',         a: 'бизнес-часы',  b: 'бизнес-часы' },
]

// Преобразуем "yes"/"no"/"partial" в визуальную ячейку. Текст возвращаем как есть.
function Cell({ value, highlighted = false }) {
  if (value === 'yes') {
    return (
      <span
        title="Есть"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26, borderRadius: '50%',
          background: highlighted ? '#16a34a' : '#dcfce7',
          color: highlighted ? '#fff' : '#16a34a',
          fontWeight: 700, fontSize: 14, lineHeight: 1,
        }}
      >✓</span>
    )
  }
  if (value === 'no') {
    return (
      <span
        title="Нет"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26, borderRadius: '50%',
          background: '#fee2e2', color: '#dc2626',
          fontWeight: 700, fontSize: 14, lineHeight: 1,
        }}
      >×</span>
    )
  }
  if (value === 'partial') {
    return (
      <span
        title="Частично"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26, borderRadius: '50%',
          background: '#fef3c7', color: '#d97706',
          fontWeight: 700, fontSize: 13, lineHeight: 1,
        }}
      >!</span>
    )
  }
  // текстовое значение
  return (
    <span
      style={{
        fontWeight: highlighted ? 700 : 500,
        color: highlighted ? '#fff' : '#0F172A',
        fontSize: 14,
      }}
    >{value}</span>
  )
}

export default function Comparison() {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)

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
    <section
      id="comparison"
      className="ks-section ks-cmp"
      style={{ padding: '72px 0', background: 'var(--bg)' }}
    >
      <div className="ks-section-inner" style={{ maxWidth: 1080, margin: '0 auto', padding: '0 24px' }}>
        <header className="ks-section-head" style={{ textAlign: 'center', marginBottom: 40 }}>
          <div className="ks-section-eyebrow">Сравнение</div>
          <h2 className="ks-section-title">Чем мы лучше</h2>
          <p className="ks-section-sub">
            Честное сравнение с двумя популярными российскими МИС по ключевым параметрам выбора.
          </p>
        </header>

        <div
          ref={ref}
          className="ks-cmp-wrap"
          style={{
            opacity: shown ? 1 : 0,
            transform: shown ? 'translateY(0)' : 'translateY(14px)',
            transition: 'opacity 600ms ease, transform 600ms ease',
            overflowX: 'auto',
          }}
        >
          <table
            className="ks-cmp-table"
            style={{
              width: '100%',
              borderCollapse: 'separate',
              borderSpacing: 0,
              background: '#fff',
              borderRadius: 18,
              border: '1px solid var(--border, #e2e8f0)',
              overflow: 'hidden',
              minWidth: 640,
              boxShadow: '0 8px 24px rgba(15,23,42,0.06)',
            }}
          >
            <thead>
              <tr>
                <th
                  scope="col"
                  style={{
                    textAlign: 'left',
                    padding: '20px 24px',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#94a3b8',
                    textTransform: 'uppercase',
                    letterSpacing: '.04em',
                    background: '#f8fafc',
                    borderBottom: '1px solid var(--border, #e2e8f0)',
                  }}
                >
                  Параметр
                </th>
                <th
                  scope="col"
                  style={{
                    textAlign: 'center',
                    padding: '20px 16px',
                    fontSize: 14,
                    fontWeight: 700,
                    color: '#fff',
                    background: 'linear-gradient(135deg, #0097A7 0%, #1565C0 100%)',
                    borderBottom: 'none',
                    position: 'relative',
                  }}
                >
                  КлиникСеть
                  <span
                    style={{
                      display: 'block',
                      fontSize: 10.5,
                      fontWeight: 600,
                      letterSpacing: '.05em',
                      marginTop: 4,
                      opacity: 0.85,
                      textTransform: 'uppercase',
                    }}
                  >
                    наш продукт
                  </span>
                </th>
                <th
                  scope="col"
                  style={{
                    textAlign: 'center',
                    padding: '20px 16px',
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#475569',
                    background: '#f8fafc',
                    borderBottom: '1px solid var(--border, #e2e8f0)',
                  }}
                >
                  1С Медицина
                </th>
                <th
                  scope="col"
                  style={{
                    textAlign: 'center',
                    padding: '20px 16px',
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#475569',
                    background: '#f8fafc',
                    borderBottom: '1px solid var(--border, #e2e8f0)',
                  }}
                >
                  Renovatio
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => {
                const isLast = i === ROWS.length - 1
                const baseTd = {
                  padding: '16px 16px',
                  borderBottom: isLast ? 'none' : '1px solid #eef2f6',
                  fontSize: 14,
                }
                return (
                  <tr key={row.label}>
                    <th
                      scope="row"
                      style={{
                        ...baseTd,
                        textAlign: 'left',
                        paddingLeft: 24,
                        fontWeight: 600,
                        color: '#0F172A',
                        background: '#fff',
                      }}
                    >
                      {row.label}
                    </th>
                    <td
                      style={{
                        ...baseTd,
                        textAlign: 'center',
                        background: 'color-mix(in srgb, #0097A7 8%, #fff)',
                        borderLeft: '2px solid #0097A7',
                        borderRight: '2px solid #0097A7',
                        ...(i === 0 ? { borderTop: '2px solid #0097A7' } : {}),
                        ...(isLast ? { borderBottom: '2px solid #0097A7' } : {}),
                      }}
                    >
                      <Cell value={row.ks} highlighted />
                    </td>
                    <td
                      style={{
                        ...baseTd,
                        textAlign: 'center',
                        background: '#fff',
                      }}
                    >
                      <Cell value={row.a} />
                    </td>
                    <td
                      style={{
                        ...baseTd,
                        textAlign: 'center',
                        background: '#fff',
                      }}
                    >
                      <Cell value={row.b} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p
          style={{
            marginTop: 16,
            textAlign: 'center',
            fontSize: 12.5,
            color: '#94a3b8',
            lineHeight: 1.5,
          }}
        >
          Данные по конкурентам — на основании публичных прайс-листов и тарифов на май 2026.
          Условные обозначения: ✓ есть · ! частично · × нет.
        </p>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .ks-cmp { padding: 48px 0 !important; }
          .ks-cmp-table th, .ks-cmp-table td { padding: 12px 10px !important; font-size: 13px !important; }
        }
      `}</style>
    </section>
  )
}
