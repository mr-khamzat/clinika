/**
 * ProductTour — 4 шага продуктового тура с inline SVG-mockup'ами.
 * Desktop: grid 4 col, Mobile: 1 col.
 */

// ===== БЛОК: SVG-mockup 1 — чат пациента =====
function ChatMockup() {
  return (
    <svg viewBox="0 0 280 180" style={{ width: '100%', height: 'auto', display: 'block' }} aria-hidden>
      <defs>
        <linearGradient id="lg-chat-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f1f5f9" />
          <stop offset="1" stopColor="#e2e8f0" />
        </linearGradient>
      </defs>
      <rect width="280" height="180" rx="14" fill="url(#lg-chat-bg)" />
      {/* Header */}
      <rect x="0" y="0" width="280" height="34" rx="14" fill="#fff" />
      <rect x="0" y="20" width="280" height="14" fill="#fff" />
      <circle cx="22" cy="17" r="10" fill="#0097A7" />
      <text x="22" y="21" fontSize="9" fontWeight="700" fill="#fff" textAnchor="middle" fontFamily="Inter, system-ui">А</text>
      <rect x="38" y="11" width="86" height="6" rx="3" fill="#0F172A" />
      <rect x="38" y="21" width="54" height="4" rx="2" fill="#94a3b8" />
      <circle cx="260" cy="17" r="3" fill="#22c55e" />
      {/* Incoming message */}
      <rect x="14" y="54" width="170" height="44" rx="14" fill="#fff" stroke="#e2e8f0" />
      <rect x="22" y="62" width="110" height="5" rx="2" fill="#475569" />
      <rect x="22" y="72" width="140" height="5" rx="2" fill="#475569" />
      <rect x="22" y="82" width="80" height="5" rx="2" fill="#475569" />
      <text x="172" y="105" fontSize="8" fill="#94a3b8" textAnchor="end" fontFamily="Inter, system-ui">14:32</text>
      {/* Typing indicator */}
      <rect x="14" y="118" width="60" height="22" rx="11" fill="#fff" stroke="#e2e8f0" />
      <circle cx="28" cy="129" r="2.5" fill="#94a3b8" />
      <circle cx="38" cy="129" r="2.5" fill="#94a3b8" />
      <circle cx="48" cy="129" r="2.5" fill="#94a3b8" />
    </svg>
  )
}

// ===== БЛОК: SVG-mockup 2 — ответ регистратора =====
function ResponseMockup() {
  return (
    <svg viewBox="0 0 280 180" style={{ width: '100%', height: 'auto', display: 'block' }} aria-hidden>
      <defs>
        <linearGradient id="lg-resp-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f1f5f9" />
          <stop offset="1" stopColor="#e2e8f0" />
        </linearGradient>
        <linearGradient id="lg-resp-btn" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0097A7" />
          <stop offset="1" stopColor="#1565C0" />
        </linearGradient>
      </defs>
      <rect width="280" height="180" rx="14" fill="url(#lg-resp-bg)" />
      {/* Header */}
      <rect x="0" y="0" width="280" height="34" rx="14" fill="#fff" />
      <rect x="0" y="20" width="280" height="14" fill="#fff" />
      <circle cx="22" cy="17" r="10" fill="#1565C0" />
      <text x="22" y="21" fontSize="9" fontWeight="700" fill="#fff" textAnchor="middle" fontFamily="Inter, system-ui">Р</text>
      <rect x="38" y="11" width="86" height="6" rx="3" fill="#0F172A" />
      <rect x="38" y="21" width="54" height="4" rx="2" fill="#94a3b8" />
      {/* Suggested reply chip */}
      <rect x="14" y="46" width="252" height="22" rx="11" fill="#fff" stroke="#0097A7" strokeDasharray="3 2" />
      <circle cx="26" cy="57" r="4" fill="#0097A7" />
      <text x="36" y="61" fontSize="9" fill="#0F172A" fontFamily="Inter, system-ui">Шаблон: «Здравствуйте, подберём время приёма»</text>
      {/* Outgoing message */}
      <rect x="96" y="78" width="170" height="44" rx="14" fill="url(#lg-resp-btn)" />
      <rect x="106" y="86" width="120" height="5" rx="2" fill="#fff" opacity="0.95" />
      <rect x="106" y="96" width="148" height="5" rx="2" fill="#fff" opacity="0.95" />
      <rect x="106" y="106" width="90" height="5" rx="2" fill="#fff" opacity="0.95" />
      {/* Action button */}
      <rect x="14" y="138" width="160" height="28" rx="14" fill="url(#lg-resp-btn)" />
      <text x="94" y="156" fontSize="11" fontWeight="600" fill="#fff" textAnchor="middle" fontFamily="Inter, system-ui">Записать на приём</text>
      <rect x="184" y="138" width="82" height="28" rx="14" fill="#fff" stroke="#e2e8f0" />
      <text x="225" y="156" fontSize="11" fontWeight="500" fill="#0F172A" textAnchor="middle" fontFamily="Inter, system-ui">SLA · 02:14</text>
    </svg>
  )
}

// ===== БЛОК: SVG-mockup 3 — расписание =====
function BookingMockup() {
  const slots = [
    { t: '09:00', s: 'busy' },
    { t: '09:30', s: 'busy' },
    { t: '10:00', s: 'free' },
    { t: '10:30', s: 'pick' },
    { t: '11:00', s: 'free' },
    { t: '11:30', s: 'busy' },
  ]
  return (
    <svg viewBox="0 0 280 180" style={{ width: '100%', height: 'auto', display: 'block' }} aria-hidden>
      <defs>
        <linearGradient id="lg-book-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f1f5f9" />
        </linearGradient>
        <linearGradient id="lg-book-pick" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0097A7" />
          <stop offset="1" stopColor="#1565C0" />
        </linearGradient>
      </defs>
      <rect width="280" height="180" rx="14" fill="url(#lg-book-bg)" stroke="#e2e8f0" />
      {/* Doctor header */}
      <circle cx="24" cy="22" r="10" fill="#0097A7" />
      <text x="24" y="26" fontSize="9" fontWeight="700" fill="#fff" textAnchor="middle" fontFamily="Inter, system-ui">ИП</text>
      <text x="42" y="20" fontSize="11" fontWeight="600" fill="#0F172A" fontFamily="Inter, system-ui">Иванов П.К.</text>
      <text x="42" y="32" fontSize="9" fill="#94a3b8" fontFamily="Inter, system-ui">Терапевт · каб. 304 · 17 мая</text>
      <rect x="220" y="14" width="50" height="20" rx="10" fill="#0097A7" opacity="0.12" />
      <text x="245" y="27" fontSize="9" fontWeight="600" fill="#0097A7" textAnchor="middle" fontFamily="Inter, system-ui">сегодня</text>
      {/* Slots grid */}
      {slots.map((sl, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        const x = 14 + col * 88
        const y = 50 + row * 38
        const fill = sl.s === 'pick' ? 'url(#lg-book-pick)' : sl.s === 'busy' ? '#f1f5f9' : '#ffffff'
        const stroke = sl.s === 'pick' ? 'none' : '#e2e8f0'
        const textColor = sl.s === 'pick' ? '#fff' : sl.s === 'busy' ? '#94a3b8' : '#0F172A'
        const label = sl.s === 'busy' ? 'занято' : sl.s === 'pick' ? 'выбрано' : 'свободно'
        return (
          <g key={sl.t}>
            <rect x={x} y={y} width="80" height="30" rx="8" fill={fill} stroke={stroke} />
            <text x={x + 10} y={y + 14} fontSize="11" fontWeight="700" fill={textColor} fontFamily="Inter, system-ui">{sl.t}</text>
            <text x={x + 10} y={y + 25} fontSize="8" fill={textColor} opacity={sl.s === 'pick' ? 0.9 : 0.7} fontFamily="Inter, system-ui">{label}</text>
          </g>
        )
      })}
      {/* Confirm bar */}
      <rect x="14" y="142" width="252" height="28" rx="14" fill="url(#lg-book-pick)" />
      <text x="140" y="160" fontSize="11" fontWeight="600" fill="#fff" textAnchor="middle" fontFamily="Inter, system-ui">Подтвердить запись на 10:30</text>
    </svg>
  )
}

// ===== БЛОК: SVG-mockup 4 — дашборд =====
function DashboardMockup() {
  const cards = [
    { l: 'Выручка', v: '₽ 2.4M', up: true },
    { l: 'Записей', v: '328', up: true },
    { l: 'Конверсия', v: '74%', up: false },
  ]
  const bars = [42, 58, 50, 66, 60, 72, 80, 68, 75, 88, 82, 92]
  return (
    <svg viewBox="0 0 280 180" style={{ width: '100%', height: 'auto', display: 'block' }} aria-hidden>
      <defs>
        <linearGradient id="lg-dash-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f1f5f9" />
        </linearGradient>
        <linearGradient id="lg-dash-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0097A7" />
          <stop offset="1" stopColor="#1565C0" />
        </linearGradient>
        <linearGradient id="lg-dash-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0097A7" stopOpacity="0.25" />
          <stop offset="1" stopColor="#0097A7" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="280" height="180" rx="14" fill="url(#lg-dash-bg)" stroke="#e2e8f0" />
      {/* Title row */}
      <text x="14" y="22" fontSize="11" fontWeight="700" fill="#0F172A" fontFamily="Inter, system-ui">Сводка · апрель 2026</text>
      <rect x="220" y="10" width="50" height="16" rx="8" fill="#0097A7" opacity="0.12" />
      <text x="245" y="21" fontSize="8" fontWeight="600" fill="#0097A7" textAnchor="middle" fontFamily="Inter, system-ui">12 клиник</text>
      {/* Metric cards */}
      {cards.map((c, i) => (
        <g key={c.l}>
          <rect x={14 + i * 88} y="32" width="80" height="40" rx="10" fill="#fff" stroke="#e2e8f0" />
          <text x={22 + i * 88} y="46" fontSize="8" fill="#94a3b8" fontFamily="Inter, system-ui">{c.l.toUpperCase()}</text>
          <text x={22 + i * 88} y="62" fontSize="13" fontWeight="700" fill="#0F172A" fontFamily="Inter, system-ui">{c.v}</text>
          <text x={70 + i * 88} y="62" fontSize="8" fill={c.up ? '#22c55e' : '#ef4444'} fontFamily="Inter, system-ui">{c.up ? '▲' : '▼'}</text>
        </g>
      ))}
      {/* Chart */}
      {(() => {
        const x0 = 14, y0 = 158, w = 252, h = 70
        const max = Math.max(...bars)
        const pts = bars.map((b, i) => {
          const x = x0 + (i * w) / (bars.length - 1)
          const y = y0 - (b / max) * h
          return [x, y]
        })
        const linePath = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ')
        const fillPath = `${linePath} L${x0 + w},${y0} L${x0},${y0} Z`
        return (
          <g>
            <path d={fillPath} fill="url(#lg-dash-fill)" />
            <path d={linePath} stroke="url(#lg-dash-line)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3.5" fill="#1565C0" stroke="#fff" strokeWidth="2" />
          </g>
        )
      })()}
      <text x="14" y="172" fontSize="8" fill="#94a3b8" fontFamily="Inter, system-ui">янв</text>
      <text x="266" y="172" fontSize="8" fill="#94a3b8" textAnchor="end" fontFamily="Inter, system-ui">дек</text>
    </svg>
  )
}

// ===== БЛОК: шаги =====
const STEPS = [
  { Mock: ChatMockup,      title: 'Пациент пишет',         desc: 'Сообщения из Telegram, WhatsApp, виджета на сайте — в одном окне регистратора.' },
  { Mock: ResponseMockup,  title: 'Регистратор отвечает',  desc: 'Шаблонные ответы, авто-эскалация по SLA — старший видит зависшие диалоги.' },
  { Mock: BookingMockup,   title: 'Запись за 30 секунд',   desc: 'Слот выбирается прямо в чате, сразу попадает в расписание врача и СМС-напоминание.' },
  { Mock: DashboardMockup, title: 'Руководитель видит',    desc: 'Метрики, выручка по клиникам, загрузка кабинетов — без выгрузок из 1С.' },
]

// ===== БЛОК: scroll-helper к hero CTA =====
function scrollToHeroCta() {
  if (typeof document === 'undefined') return
  const target = document.getElementById('hero-cta') || document.getElementById('hero')
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// ===== БЛОК: основной компонент =====
export default function ProductTour() {
  return (
    <section
      className="ks-section ks-tour"
      style={{
        padding: '72px 0',
        background: 'var(--bg)',
      }}
    >
      <div className="ks-section-inner" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
        <header className="ks-section-head" style={{ textAlign: 'center', marginBottom: 48 }}>
          <div className="ks-section-eyebrow">Тур по продукту</div>
          <h2 className="ks-section-title">Четыре экрана, которые закрывают 80% работы</h2>
          <p className="ks-section-sub">От первого сообщения пациента до отчёта владельцу — в одной системе.</p>
        </header>

        <div
          className="ks-tour-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 20,
          }}
        >
          {STEPS.map((s, i) => {
            const Mock = s.Mock
            return (
              <article
                key={s.title}
                className="ks-tour-card"
                style={{
                  background: '#fff',
                  borderRadius: 18,
                  border: '1px solid var(--border)',
                  padding: 18,
                  position: 'relative',
                  transition: 'transform .3s ease, box-shadow .3s ease',
                  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 12,
                    left: 12,
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #0097A7 0%, #1565C0 100%)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    fontWeight: 700,
                    zIndex: 2,
                    boxShadow: '0 4px 10px rgba(21, 101, 192, 0.3)',
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
                  <Mock />
                </div>
                <h5 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 6px', color: '#0F172A' }}>
                  {s.title}
                </h5>
                <p style={{ fontSize: 13, color: 'var(--fg-2)', margin: 0, lineHeight: 1.5 }}>
                  {s.desc}
                </p>
                <button
                  type="button"
                  onClick={scrollToHeroCta}
                  className="ks-tour-cta"
                  style={{
                    marginTop: 12,
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    color: '#0097A7',
                    fontWeight: 600,
                    fontSize: 13.5,
                    cursor: 'pointer',
                    font: 'inherit',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  Увидеть в действии <span aria-hidden>→</span>
                </button>
              </article>
            )
          })}
        </div>
      </div>

      <style>{`
        .ks-tour-card:hover { transform: translateY(-3px); box-shadow: 0 12px 30px rgba(15,23,42,.08); }
        .ks-tour-cta { font-weight: 600; }
        .ks-tour-cta:hover { text-decoration: underline; color: #1565C0; }
        .ks-tour-cta:focus-visible { outline: 2px solid #0097A7; outline-offset: 3px; border-radius: 4px; }
        @media (max-width: 980px) {
          .ks-tour-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 620px) {
          .ks-tour { padding: 48px 0 !important; }
          .ks-tour-grid { grid-template-columns: 1fr !important; gap: 16px !important; }
        }
      `}</style>
    </section>
  )
}
