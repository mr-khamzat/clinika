/**
 * ========================================
 * БЛОК: Testimonials — 6 цитат-плейсхолдеров + company-mark
 * ========================================
 * Каждая карточка содержит логотип-плейсхолдер компании (текстовый mark).
 * Когда появятся реальные клиенты — заменить цитаты, подписи и логотипы.
 * ========================================
 */
import { useEffect, useRef, useState } from 'react'

const QUOTES = [
  {
    text: 'КлиникСеть позволил нам объединить 5 клиник под одной крышей за месяц. Регистратор перестал звонить в соседний филиал — всё в одном окне.',
    author: 'Иванов И. И.',
    role: 'Владелец сети из 5 клиник',
    avatar: 'ИИ',
    color: 'oklch(0.55 0.16 240)',
    company: 'АРКТИКА',
    companyTone: 'oklch(0.55 0.16 240)',
  },
  {
    text: 'Регистраторы стали обрабатывать в 2× больше пациентов. AI-подсказки в чате сократили время ответа в три раза.',
    author: 'Петрова А.',
    role: 'Главный администратор',
    avatar: 'АП',
    color: 'oklch(0.62 0.15 220)',
    company: 'МЕДПЛЮС',
    companyTone: 'oklch(0.62 0.15 220)',
  },
  {
    text: 'AI-инсайты по выручке окупились за неделю. Раньше я собирал отчёты в Excel по выходным, теперь дашборд показывает всё сам.',
    author: 'Сидоров С.',
    role: 'Финансовый директор',
    avatar: 'СС',
    color: 'oklch(0.58 0.16 285)',
    company: 'ВИТАКОМ',
    companyTone: 'oklch(0.58 0.16 285)',
  },
  {
    text: 'Внедрили за 21 день вместо обещанных 28 — команда вела нас за руку. Миграция 47 000 карт прошла без потерь, мы поставили рекорд по NPS.',
    author: 'Магомедова З.',
    role: 'Директор по операциям',
    avatar: 'МЗ',
    color: 'oklch(0.65 0.16 200)',
    company: 'АЛЬФАМЕД',
    companyTone: 'oklch(0.65 0.16 200)',
  },
  {
    text: 'Семейные подписки за полгода дали +38% к LTV. Раньше пациент приходил раз в год — теперь приводит всю семью и привязан к нашей клинике.',
    author: 'Левченко О.',
    role: 'Маркетинг-директор сети',
    avatar: 'ОЛ',
    color: 'oklch(0.62 0.13 75)',
    company: 'ДОБРОМЕД',
    companyTone: 'oklch(0.62 0.13 75)',
  },
  {
    text: 'Биллинг между филиалами раньше занимал у бухгалтерии 4 дня в конце месяца. Теперь — час. Аудит-лог 152-ФЗ закрыл претензии Роскомнадзора.',
    author: 'Карпов Д.',
    role: 'ИТ-директор',
    avatar: 'КД',
    color: 'oklch(0.58 0.18 145)',
    company: 'ЭНДОКРИН+',
    companyTone: 'oklch(0.58 0.18 145)',
  },
]

function Quote({ q, delay }) {
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
    <article
      ref={ref}
      className="ks-tm-card"
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : 'translateY(14px)',
        transition: `opacity 600ms ease ${delay}ms, transform 600ms ease ${delay}ms`,
      }}
    >
      <div className="ks-tm-top">
        <span className="ks-tm-mark" aria-hidden>“</span>
        {q.company && (
          <span
            className="ks-tm-company"
            style={{ color: q.companyTone, borderColor: q.companyTone }}
            aria-label={`Логотип ${q.company}`}
          >
            {q.company}
          </span>
        )}
      </div>
      <blockquote className="ks-tm-text">{q.text}</blockquote>
      <div className="ks-tm-foot">
        <span className="ks-tm-avatar" style={{ background: q.color }} aria-hidden>{q.avatar}</span>
        <div>
          <div className="ks-tm-author">{q.author}</div>
          <div className="ks-tm-role">{q.role}</div>
        </div>
      </div>
    </article>
  )
}

export default function Testimonials() {
  return (
    <section id="testimonials" className="ks-section ks-tm">
      <div className="ks-section-inner">
        <header className="ks-section-head">
          <div className="ks-section-eyebrow">Отзывы</div>
          <h2 className="ks-section-title">Что говорят клиенты</h2>
          <p className="ks-section-sub">
            Первые сети врачей и франчайзи, которые уже работают на платформе.
          </p>
        </header>
        <div className="ks-tm-grid">
          {QUOTES.map((q, i) => <Quote key={q.author} q={q} delay={i * 90} />)}
        </div>
      </div>
    </section>
  )
}
