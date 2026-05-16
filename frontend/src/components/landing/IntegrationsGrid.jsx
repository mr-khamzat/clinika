/**
 * IntegrationsGrid — 6 карточек интеграций с Material Symbols.
 * Hover: scale + shadow.
 */

const ITEMS = [
  {
    icon: 'integration_instructions',
    title: 'МИС Renovatio',
    desc: 'Двусторонняя синхронизация пациентов и расписания — без двойного ввода.',
    accent: '#0097A7',
  },
  {
    icon: 'phone',
    title: 'Sipuni · Mango · Zadarma',
    desc: 'Телефония: запись звонков, всплывающая карточка, статистика по операторам.',
    accent: '#1565C0',
  },
  {
    icon: 'payment',
    title: 'ЮKassa',
    desc: 'Оплата подписки и приёмов картой и СБП. Авто-фискализация в одной транзакции.',
    accent: '#0F766E',
  },
  {
    icon: 'description',
    title: '1С',
    desc: 'Импорт пациентов и услуг через Excel · регулярная выгрузка в бухгалтерию.',
    accent: '#7C3AED',
  },
  {
    icon: 'notifications',
    title: 'Telegram',
    desc: 'Push-уведомления врачам и пациентам, бот-напоминание о визите за 24 часа.',
    accent: '#2563EB',
  },
  {
    icon: 'receipt',
    title: 'ОФД',
    desc: 'Фискальные чеки в Атол / OFD.ru. 54-ФЗ из коробки — без отдельной кассы.',
    accent: '#D97706',
  },
]

export default function IntegrationsGrid() {
  return (
    <section
      className="ks-section ks-integrations"
      style={{
        padding: '72px 0',
        background:
          'linear-gradient(180deg, var(--bg) 0%, oklch(0.98 0.015 220) 100%)',
      }}
    >
      {/* Material Symbols font подгружается один раз */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
      />

      <div
        className="ks-section-inner"
        style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}
      >
        <header
          className="ks-section-head"
          style={{ textAlign: 'center', marginBottom: 48 }}
        >
          <div className="ks-section-eyebrow">Интеграции</div>
          <h2 className="ks-section-title">Подключается к тому, что уже работает</h2>
          <p className="ks-section-sub">
            Шесть готовых интеграций «из коробки». Без дополнительных консультантов и платных коннекторов.
          </p>
        </header>

        <div
          className="ks-integrations-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 20,
          }}
        >
          {ITEMS.map((it) => (
            <article
              key={it.title}
              className="ks-integrations-card"
              style={{
                background: '#fff',
                border: '1px solid var(--border)',
                borderRadius: 18,
                padding: 24,
                transition: 'transform .25s ease, box-shadow .25s ease, border-color .25s ease',
                cursor: 'default',
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: `${it.accent}14`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                }}
              >
                <span
                  className="material-symbols-rounded"
                  style={{
                    fontSize: 28,
                    color: it.accent,
                    fontVariationSettings: "'FILL' 0, 'wght' 500",
                  }}
                >
                  {it.icon}
                </span>
              </div>
              <h5
                style={{
                  fontSize: 17,
                  fontWeight: 600,
                  margin: '0 0 8px',
                  color: '#0F172A',
                }}
              >
                {it.title}
              </h5>
              <p
                style={{
                  fontSize: 14,
                  color: 'var(--fg-2)',
                  margin: 0,
                  lineHeight: 1.55,
                }}
              >
                {it.desc}
              </p>
            </article>
          ))}
        </div>
      </div>

      <style>{`
        .ks-integrations-card:hover {
          transform: scale(1.02);
          box-shadow: 0 16px 36px rgba(15, 23, 42, 0.08);
          border-color: var(--accent-line, #cbd5e1);
        }
        @media (max-width: 920px) {
          .ks-integrations-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 620px) {
          .ks-integrations { padding: 48px 0 !important; }
          .ks-integrations-grid { grid-template-columns: 1fr !important; gap: 14px !important; }
        }
      `}</style>
    </section>
  )
}
