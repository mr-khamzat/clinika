/**
 * FAQ — аккордеон на 6 вопросов без библиотек.
 * Плавный height transition через max-height + overflow:hidden.
 * Плюсик поворачивается на 45° при открытии.
 */
import { useState, useRef, useEffect } from 'react'

const QUESTIONS = [
  {
    q: 'Можно ли попробовать перед оплатой?',
    a: 'Да. Пилот 7 дней на одной клинике бесплатно. Не подойдёт — ничего не платите.',
  },
  {
    q: 'Какой минимальный платёж?',
    a: 'Тариф Solo: 9 900 ₽/мес за одну клинику. Без скрытых платежей, без оплаты setup’а.',
  },
  {
    q: 'Если решу уйти — что теряю?',
    a: 'Ничего. Экспорт всех данных в стандартных форматах (CSV, JSON, PDF) — за 1 день. Контракт помесячный, без штрафов.',
  },
  {
    q: 'Сколько времени занимает запуск?',
    a: 'От подписания договора до первой записи в новой системе — 28 дней. Первая неделя — миграция данных, вторая — обучение регистраторов, третья — пилот на одной клинике, четвёртая — раскатка на всю сеть. Сопровождает менеджер внедрения.',
  },
  {
    q: 'Можно ли мигрировать с другой системы?',
    a: 'Да. Поддерживаем Excel-импорт пациентов и расписания из 1С, МИС Renovatio (двусторонняя), а также произвольный CSV. Историю приёмов переносим за последние 3 года — глубже только по запросу.',
  },
  {
    q: 'Что с законом 152-ФЗ о персональных данных?',
    a: 'Платформа соответствует требованиям 152-ФЗ, уровень защищённости УЗ-1. Данные хранятся в РФ, есть аудит-лог всех действий, разграничение по ролям. По запросу предоставляем модель угроз и регламент обработки ПДн.',
  },
  {
    q: 'Как считается тариф?',
    a: 'Платите за клиники, не за пользователей. Базовая подписка включает 20 сотрудников на клинику. Дополнительные модули (Telemedicine, AI-ассистент, Запись звонков) подключаются точечно. Откройте калькулятор — посчитает за минуту.',
  },
  {
    q: 'Где физически хранятся данные?',
    a: 'Дата-центры на территории России — Selectel (Москва) и резерв в Санкт-Петербурге. Ежедневный бекап на rclone в S3-хранилище с шифрованием. RPO ≤ 24 часа, RTO ≤ 4 часа.',
  },
  {
    q: 'Что входит в техподдержку?',
    a: 'Поддержка 8/5 на тарифе Старт, 12/7 на Бизнесе, 24/7 с SLA реакции 15 минут — на Корпоративном. Канал связи: Telegram, e-mail, телефон. Менеджер успеха клиента — закреплён лично от тарифа «Бизнес».',
  },
]

// ===== БЛОК: один пункт аккордеона =====
function Item({ q, a, isOpen, onToggle }) {
  const bodyRef = useRef(null)
  const [maxH, setMaxH] = useState(0)

  useEffect(() => {
    if (!bodyRef.current) return
    if (isOpen) {
      setMaxH(bodyRef.current.scrollHeight)
    } else {
      setMaxH(0)
    }
  }, [isOpen, a])

  return (
    <div
      className="ks-faq-item"
      style={{
        background: '#fff',
        border: '1px solid var(--border)',
        borderRadius: 14,
        overflow: 'hidden',
        transition: 'border-color .25s ease, box-shadow .25s ease',
        boxShadow: isOpen ? '0 8px 24px rgba(15, 23, 42, 0.06)' : 'none',
        borderColor: isOpen ? 'var(--accent-line, #b6e3eb)' : 'var(--border)',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
          color: '#0F172A',
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>
          {q}
        </span>
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: isOpen
              ? 'linear-gradient(135deg, #0097A7 0%, #1565C0 100%)'
              : '#f1f5f9',
            color: isOpen ? '#fff' : '#0F172A',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'transform .3s ease, background .3s ease, color .3s ease',
            transform: isOpen ? 'rotate(45deg)' : 'rotate(0)',
            fontSize: 18,
            lineHeight: 1,
            fontWeight: 300,
          }}
        >
          +
        </span>
      </button>
      <div
        style={{
          maxHeight: maxH,
          overflow: 'hidden',
          transition: 'max-height .35s ease',
        }}
      >
        <div
          ref={bodyRef}
          style={{
            padding: '0 24px 22px',
            fontSize: 14.5,
            lineHeight: 1.65,
            color: 'var(--fg-2)',
          }}
        >
          {a}
        </div>
      </div>
    </div>
  )
}

// ===== БЛОК: основной компонент =====
export default function FAQ() {
  const [openIdx, setOpenIdx] = useState(0)

  return (
    <section
      className="ks-section ks-faq"
      style={{
        padding: '72px 0',
        background: 'var(--bg)',
      }}
    >
      <div
        className="ks-section-inner"
        style={{ maxWidth: 820, margin: '0 auto', padding: '0 24px' }}
      >
        <header
          className="ks-section-head"
          style={{ textAlign: 'center', marginBottom: 40 }}
        >
          <div className="ks-section-eyebrow">Частые вопросы</div>
          <h2 className="ks-section-title">Шесть вопросов, которые задают чаще всего</h2>
          <p className="ks-section-sub">
            Если вопроса нет — напишите в Telegram, ответим за 15 минут в рабочее время.
          </p>
        </header>

        <div
          className="ks-faq-list"
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {QUESTIONS.map((item, i) => (
            <Item
              key={item.q}
              q={item.q}
              a={item.a}
              isOpen={openIdx === i}
              onToggle={() => setOpenIdx(openIdx === i ? -1 : i)}
            />
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 620px) {
          .ks-faq { padding: 48px 0 !important; }
        }
      `}</style>
    </section>
  )
}
