/**
 * ========================================
 * БЛОК: FaqAccordion — 7 типовых вопросов
 * ========================================
 * Доступный accordion: <button aria-expanded> + раскрытие через max-height + transition.
 * Один открытый одновременно.
 * ========================================
 */
import { useState } from 'react'

const ITEMS = [
  {
    q: 'Сколько времени занимает внедрение?',
    a: 'Стандартный путь — 28 дней: 3 дня аудит, 7 дней настройка, 10 дней миграция данных, 8 дней параллельный режим и обучение. Для одной клиники без сложной миграции — от 3-5 рабочих дней.',
  },
  {
    q: 'Можно ли подключить только нужные модули?',
    a: 'Да. Тариф (Solo / Network / Enterprise) включает базовый функционал. Дополнительные модули — Телемедицина, AI-ассистент, Запись звонков, Loyalty Pro, SMS-маркетинг, Inventory — подключаются и отключаются в любой момент из админки.',
  },
  {
    q: 'Что с защитой персональных данных (152-ФЗ)?',
    a: 'Платформа соответствует УЗ-1: шифрование AES-256, аудит-лог всех операций с медкартой, доступ по ролям, токенизация ПДн, сегрегированная среда хранения. Хостинг — в РФ. Готовый комплект документов для Роскомнадзора предоставляем при подключении.',
  },
  {
    q: 'Как работают подписки и лояльность пациентов?',
    a: 'Кешбэк начисляется по правилам (% от суммы, бонус за повтор, реферал), действует на всю сеть клиник. Подписки (например, "Семейная стоматология 4 990 ₽/мес") создаются конструктором без программистов. Оплата — ЮKassa, Тинькофф, Сбер.',
  },
  {
    q: 'Можно ли использовать на iPhone и Android?',
    a: 'Да. Веб-версия адаптивная, работает в Safari/Chrome без установки. Для пациентов есть PWA и в дорожной карте — нативные iOS/Android приложения (white-label под бренд сети, тариф Enterprise).',
  },
  {
    q: 'Что если интернет упадёт во время приёма?',
    a: 'Регистратор может работать в offline-режиме до 30 минут: запись, оплата, печать чеков — всё кешируется локально и синхронизируется при восстановлении связи. Для критичных клиник предлагаем резервный канал — AmneziaWG VPN с автоматическим обходом блокировок.',
  },
  {
    q: 'Какая техподдержка?',
    a: 'Solo — email-поддержка с ответом до 24 часов. Network — выделенный менеджер внедрения, чат с ответом до 1 часа в рабочее время. Enterprise — приоритетный SLA 99.9%, дежурная команда 24/7, выделенная Telegram-группа.',
  },
]

export default function FaqAccordion() {
  const [open, setOpen] = useState(0)

  return (
    <section id="faq" className="ks-section ks-faq">
      <div className="ks-section-inner">
        <header className="ks-section-head">
          <div className="ks-section-eyebrow">Вопросы</div>
          <h2 className="ks-section-title">Частые вопросы клиентов</h2>
          <p className="ks-section-sub">
            Не нашли ответ? <a href="#contact" onClick={e => {
              e.preventDefault()
              window.dispatchEvent(new CustomEvent('ks:open-contact'))
            }}>напишите нам</a> — отвечаем за час в рабочее время.
          </p>
        </header>

        <div className="ks-faq-list" role="list">
          {ITEMS.map((it, i) => {
            const expanded = open === i
            return (
              <div key={it.q} className={`ks-faq-item ${expanded ? 'is-open' : ''}`} role="listitem">
                <button
                  type="button"
                  className="ks-faq-q"
                  aria-expanded={expanded}
                  aria-controls={`ks-faq-a-${i}`}
                  onClick={() => setOpen(expanded ? -1 : i)}
                >
                  <span>{it.q}</span>
                  <span className="ks-faq-icon" aria-hidden>{expanded ? '−' : '+'}</span>
                </button>
                <div
                  id={`ks-faq-a-${i}`}
                  className="ks-faq-a"
                  role="region"
                  style={{
                    maxHeight: expanded ? 280 : 0,
                    opacity: expanded ? 1 : 0,
                  }}
                >
                  <p>{it.a}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
