/**
 * ========================================
 * БЛОК: FunctionalShowcase — alternating «текст + мок-экран» (5 секций)
 * ========================================
 * Каждая секция: H2 + 2-3 параграфа + 3-4 фичи (✓) + мок-карточка.
 * Картинки скриншотов отсутствуют — рисуем стилизованные SVG/CSS-моки.
 * ========================================
 */
import { useEffect, useRef, useState } from 'react'

function Reveal({ children, side = 'left' }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setShown(true); return }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShown(true); io.disconnect() }
    }, { threshold: 0.12 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translate(0,0)' : (side === 'left' ? 'translateX(-24px)' : 'translateX(24px)'),
        transition: 'opacity 700ms ease, transform 700ms ease',
      }}
    >{children}</div>
  )
}

function Pill({ children, tone = 'accent' }) {
  return <span className={`ks-fs-pill ks-fs-pill-${tone}`}>{children}</span>
}

// === Стилизованные мок-превью (без внешних PNG) ===
function MockSchedule() {
  const slots = [
    ['09:00', 'Иванов А.С.', 'Кардиолог', 'done'],
    ['09:30', 'Петрова К.', 'Терапевт', 'done'],
    ['10:00', 'Сидоров В.', 'Стоматолог', 'now'],
    ['10:30', 'Свободно', '', 'free'],
    ['11:00', 'Морозова И.', 'Окулист', 'next'],
  ]
  const TONE = { done: '#94A3B8', now: 'var(--accent)', next: 'oklch(0.62 0.15 220)', free: 'oklch(0.92 0.01 220)' }
  return (
    <div className="ks-fs-mock">
      <div className="ks-fs-mock-head">
        <span className="ks-fs-mock-title">Расписание · сегодня</span>
        <span className="ks-fs-mock-badge">Live</span>
      </div>
      <div className="ks-fs-mock-rows">
        {slots.map(([t, n, role, st]) => (
          <div key={t} className="ks-fs-row">
            <span className="ks-fs-row-t">{t}</span>
            <span className="ks-fs-row-dot" style={{ background: TONE[st] }} />
            <span className="ks-fs-row-n">{n}</span>
            <span className="ks-fs-row-r">{role}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MockMedCard() {
  return (
    <div className="ks-fs-mock">
      <div className="ks-fs-mock-head">
        <span className="ks-fs-mock-title">М. Кузнецова · А-104857</span>
        <span className="ks-fs-mock-badge">152-ФЗ</span>
      </div>
      <div className="ks-fs-mc-tabs">
        <span className="ks-fs-mc-tab is-active">Приёмы</span>
        <span className="ks-fs-mc-tab">Анализы</span>
        <span className="ks-fs-mc-tab">Назначения</span>
      </div>
      <div className="ks-fs-mc-list">
        {[
          ['05.05', 'Кардиолог', 'Иванов А.С.', 'Стабильно'],
          ['02.05', 'Терапевт', 'Петрова К.', 'ОРВИ'],
          ['28.04', 'Анализ', 'ОАК', 'норма'],
        ].map(([d, kind, doc, note]) => (
          <div key={d + kind} className="ks-fs-mc-item">
            <span className="ks-fs-mc-date">{d}</span>
            <span className="ks-fs-mc-kind">{kind}</span>
            <span className="ks-fs-mc-doc">{doc}</span>
            <span className="ks-fs-mc-note">{note}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MockLoyalty() {
  return (
    <div className="ks-fs-mock">
      <div className="ks-fs-mock-head">
        <span className="ks-fs-mock-title">Бонусы и подписки</span>
        <span className="ks-fs-mock-badge ks-fs-mock-badge-gold">VIP</span>
      </div>
      <div className="ks-fs-loy">
        <div className="ks-fs-loy-balance">
          <div className="ks-fs-loy-amount">12 480 <span>₽</span></div>
          <div className="ks-fs-loy-sub">кешбэк · действует на всю сеть</div>
        </div>
        <div className="ks-fs-loy-progress">
          <div className="ks-fs-loy-bar"><span style={{ width: '72%' }} /></div>
          <div className="ks-fs-loy-line">До «Platinum» — 4 200 ₽</div>
        </div>
        <div className="ks-fs-loy-perks">
          {['−15% на стоматологию', 'Приоритет в записи', 'Семейный счёт'].map(p => (
            <span key={p} className="ks-fs-loy-chip">{p}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function MockAI() {
  return (
    <div className="ks-fs-mock">
      <div className="ks-fs-mock-head">
        <span className="ks-fs-mock-title">AI · Дашборд сети</span>
        <span className="ks-fs-mock-badge">Live</span>
      </div>
      <div className="ks-fs-ai">
        <div className="ks-fs-ai-grid">
          {[
            ['Выручка', '4.2 млн ₽', '+12%', 'good'],
            ['NPS', '+62', '+4', 'good'],
            ['Загрузка', '78%', '−3%', 'warn'],
            ['LTV', '32 400 ₽', '+8%', 'good'],
          ].map(([l, v, d, tone]) => (
            <div key={l} className="ks-fs-ai-cell">
              <div className="ks-fs-ai-l">{l}</div>
              <div className="ks-fs-ai-v">{v}</div>
              <div className={`ks-fs-ai-d ks-fs-ai-d-${tone}`}>{d}</div>
            </div>
          ))}
        </div>
        <div className="ks-fs-ai-insight">
          <span className="ks-fs-ai-spark">✦</span>
          AI: пик загрузки 10:00–12:00, открыть слоты у Иванова +6 окон
        </div>
      </div>
    </div>
  )
}

function MockIntegrations() {
  const items = [
    ['ЛИС', 'Лабораторные системы'],
    ['ЮKassa', 'Эквайринг'],
    ['ОФД', 'Чек 54-ФЗ'],
    ['1С', 'Бухгалтерия'],
    ['СБИС', 'Документооборот'],
    ['Telegram', 'Уведомления'],
    ['ProDoctorov', 'Агрегаторы'],
    ['СберHealth', 'Партнёрский трафик'],
  ]
  return (
    <div className="ks-fs-mock">
      <div className="ks-fs-mock-head">
        <span className="ks-fs-mock-title">Интеграции · 32 коннектора</span>
        <span className="ks-fs-mock-badge">API</span>
      </div>
      <div className="ks-fs-int-grid">
        {items.map(([n, d]) => (
          <div key={n} className="ks-fs-int-cell">
            <div className="ks-fs-int-mark">{n[0]}</div>
            <div>
              <div className="ks-fs-int-n">{n}</div>
              <div className="ks-fs-int-d">{d}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// === Конфиг секций ===
const ITEMS = [
  {
    id: 'showcase-schedule',
    eyebrow: 'Запись и расписание',
    title: 'Kanban + календарь — одна правда о расписании',
    paras: [
      'Слоты со всех клиник сети в одном представлении. Регистратор переключает фильтры за миллисекунды — без двойного ввода и звонков "проверьте у врача".',
      'Конфликты блокируются на уровне платформы, буфер 5/10 минут — настраивается. Премии за заполняемость считаются в реальном времени.',
    ],
    features: [
      'Drag-n-drop переноса записей',
      'Поиск окон по специальности и району',
      'Уведомления врачу за 15 минут в Telegram',
      'Авто-восстановление слотов после отмены',
    ],
    Mock: MockSchedule,
    pills: ['Регистратор', 'Врач'],
  },
  {
    id: 'showcase-medcard',
    eyebrow: 'Электронная медкарта',
    title: 'ЭМК — история приёмов, протоколы, голосовой ввод',
    paras: [
      'Карта пациента доступна по правам роли. Шаблоны по специальностям сокращают приём на 30%, голосовой ввод (Whisper) — ещё на 15%.',
      'История синхронизируется между клиниками сети мгновенно. Аллергии и противопоказания всплывают красным при назначении.',
    ],
    features: [
      'Шаблоны протоколов по специальностям',
      'Голосовой ввод через Whisper',
      'Аллергии и противопоказания подсвечиваются',
      'Аудит-лог любых изменений (152-ФЗ УЗ-1)',
    ],
    Mock: MockMedCard,
    pills: ['Врач', '152-ФЗ'],
  },
  {
    id: 'showcase-loyalty',
    eyebrow: 'Лояльность и подписки',
    title: 'Бонусы, тиры и подписки — единый баланс на сеть',
    paras: [
      'Кешбэк начисляется по правилам, тратится в любой клинике сети. Семейные счета, реферальная программа, акции — конструктор без программистов.',
      'Подписки (например, "Семейная стоматология 4 990 ₽/мес") поднимают LTV в 2-3 раза. Платёжный шлюз ЮKassa уже встроен.',
    ],
    features: [
      'Конструктор тиров (Silver/Gold/Platinum)',
      'Подписки и абонементы на услуги',
      'Семейный счёт и реферальная программа',
      'Авто-возвраты "спящих" пациентов через SMS',
    ],
    Mock: MockLoyalty,
    pills: ['Пациент', 'Маркетолог'],
  },
  {
    id: 'showcase-ai',
    eyebrow: 'AI и аналитика',
    title: 'AI-инсайты по выручке, NPS и загрузке — каждое утро',
    paras: [
      'AI-аналитик читает данные за ночь и выдаёт 3-5 действий на день: где открыть слоты, кто из врачей просел в NPS, какой филиал теряет конверсию.',
      'Отчёты не нужно собирать в Excel. Дашборд live, экспорт в PDF/Excel в один клик.',
    ],
    features: [
      'Дашборд сети live — выручка, NPS, загрузка',
      'AI-инсайты "куда смотреть сегодня"',
      'Конверсия воронки запись → визит → повтор',
      'Прогноз выручки на 30 дней',
    ],
    Mock: MockAI,
    pills: ['Управляющий', 'AI'],
  },
  {
    id: 'showcase-integrations',
    eyebrow: 'Интеграции',
    title: 'ЛИС, ЮКасса, ОФД, агрегаторы — из коробки',
    paras: [
      '32 готовых коннектора: лаборатории, эквайринг, ОФД, телефония, 1С, агрегаторы (ProDoctorov, СберHealth). 250+ эндпоинтов REST API.',
      'Не нужно платить разработчикам по 200 тысяч за каждое подключение. Включается из административной панели.',
    ],
    features: [
      '32 готовых коннектора без кодинга',
      '250+ REST API эндпоинтов',
      'Webhook на любое событие платформы',
      'Шифрование AES-256 на канальном уровне',
    ],
    Mock: MockIntegrations,
    pills: ['ИТ-директор', 'Интеграции'],
  },
]

export default function FunctionalShowcase() {
  return (
    <section id="showcase" className="ks-section ks-fs">
      <div className="ks-section-inner">
        <header className="ks-section-head">
          <div className="ks-section-eyebrow">Что внутри</div>
          <h2 className="ks-section-title">Кабинеты, ЭМК, AI и интеграции — глубже</h2>
          <p className="ks-section-sub">
            Пять ключевых блоков платформы. Каждый — отдельный модуль, который можно отключить или
            заменить под процессы вашей сети.
          </p>
        </header>

        <div className="ks-fs-list">
          {ITEMS.map((it, i) => {
            const reverse = i % 2 === 1
            return (
              <article key={it.id} id={it.id} className={`ks-fs-row-wrap ${reverse ? 'is-reverse' : ''}`}>
                <Reveal side={reverse ? 'right' : 'left'}>
                  <div className="ks-fs-text">
                    <div className="ks-section-eyebrow ks-fs-eyebrow">{it.eyebrow}</div>
                    <h3 className="ks-fs-h">{it.title}</h3>
                    {it.paras.map((p, j) => <p key={j} className="ks-fs-p">{p}</p>)}
                    <ul className="ks-fs-feats">
                      {it.features.map(f => (
                        <li key={f}><span className="ks-fs-check" aria-hidden>✓</span>{f}</li>
                      ))}
                    </ul>
                    <div className="ks-fs-pills">
                      {it.pills.map(p => <Pill key={p}>{p}</Pill>)}
                    </div>
                  </div>
                </Reveal>
                <Reveal side={reverse ? 'left' : 'right'}>
                  <div className="ks-fs-visual">
                    <it.Mock />
                  </div>
                </Reveal>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
