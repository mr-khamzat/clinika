/**
 * ========================================
 * БЛОК: Franchise — публичный лендинг для франчайзи
 * ========================================
 * Этап 6 ROADMAP: отдельная страница `/franchise` для будущих владельцев сетей.
 * Маршрут публичный (без auth) — подключается в App.jsx через проверку path.
 *
 * Состав:
 *   Nav         — фиксированная (как на Landing.jsx)
 *   Hero        — «Стать франчайзи КлиникСеть»
 *   Why         — 6 причин (карточки)
 *   Conditions  — условия (роялти, паушальный взнос, поддержка)
 *   ROI         — простой статический калькулятор (клиники × выручка → ROI/12 мес)
 *   Form        — заявка → POST /contact/ (если эндпоинт недоступен → mailto)
 *   Footer      — ссылка обратно на /
 *
 * Стили — минимальный inline-блок ks-fr-* + переиспользует токены из tokens.css.
 * ========================================
 */
import { useState } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

// ===== БЛОК: SVG-иконки =====
function Icon({ d, size = 18, stroke = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d}
    </svg>
  )
}

const ICONS = {
  arrow: <Icon d={<><path d="M5 12h14"/><path d="M13 5l7 7-7 7"/></>} />,
  check: <Icon d={<path d="M5 12l4 4 10-10"/>} size={14} />,
  user: <Icon d={<><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></>} />,
  phone: <Icon d={<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3.1-8.7A2 2 0 014 2h3a2 2 0 012 1.7c.1.9.3 1.8.6 2.6a2 2 0 01-.5 2.1L7.9 9.7a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.8.3 1.7.5 2.6.6a2 2 0 011.7 2z"/>} />,
  mail: <Icon d={<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>} />,
  building: <Icon d={<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 8h0M9 12h0M9 16h0M15 8h0M15 12h0M15 16h0"/></>} />,
}

// ===== БЛОК: Главный компонент =====
export default function Franchise() {
  // Форма заявки на франчайзи
  const [form, setForm] = useState({ name: '', phone: '', email: '', city: '', clinics: '1', message: '' })
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async e => {
    e.preventDefault(); setError(''); setLoading(true)
    const payload = {
      name: form.name,
      phone: form.phone,
      email: form.email || '',
      message: `[Франчайзи] Город: ${form.city}; планируемое число клиник: ${form.clinics}.\n\n${form.message || ''}`.trim(),
    }
    try {
      await axios.post(API_BASE + '/contact/', payload)
      setSent(true)
    } catch {
      // Fallback на mailto, если эндпоинт недоступен
      try {
        const subj = encodeURIComponent('[Франчайзи КлиникСеть] Заявка от ' + form.name)
        const body = encodeURIComponent(payload.message + '\n\nКонтакт: ' + form.phone + ' / ' + form.email)
        window.location.href = `mailto:franchise@xn--80aakbvaezg.xn--p1ai?subject=${subj}&body=${body}`
        setSent(true)
      } catch {
        setError('Не удалось отправить. Напишите нам на franchise@клиниксеть.рф')
      }
    } finally {
      setLoading(false)
    }
  }

  // ===== БЛОК: 6 причин стать франчайзи =====
  const REASONS = [
    ['◑', 'Готовая SaaS-платформа', 'Не нужно разрабатывать ПО с нуля. Запись, ЭМК, биллинг, мобильные приложения — всё в коробке.'],
    ['☰', 'Бренд КлиникСеть', 'Узнаваемость, единый стандарт сервиса, доверие пациентов федеральной сети.'],
    ['₽', 'Рост маржи на 18–25%', 'Автоматизация регистратуры, контроль ФОТ врачей, прозрачные взаиморасчёты.'],
    ['⌕', 'Маркетинг и аналитика', 'AI-аналитика загрузки, готовые шаблоны рекламы, конверсия записи на сайте.'],
    ['◊', 'Программа лояльности', 'Единый бонусный счёт работает во всех клиниках сети — пациенты остаются.'],
    ['◯', 'Поддержка 24/7', 'Команда внедрения, обучение администраторов и врачей, выделенный менеджер.'],
  ]

  // ===== БЛОК: Условия франшизы =====
  const TERMS = [
    ['Паушальный взнос', 'от 250 000 ₽', 'единовременно при подписании договора'],
    ['Роялти', '3% от выручки', 'ежемесячно с операционной выручки'],
    ['Срок окупаемости', '8–14 месяцев', 'при загрузке от 60% и среднем чеке 3 500 ₽'],
    ['Минимум клиник', '1 клиника', 'старт возможен с одной клиники, расширение — без доплат'],
    ['Поддержка платформы', 'включена', 'обновления, мониторинг 24/7, выделенный менеджер'],
    ['Право на территорию', 'эксклюзив', 'эксклюзив на округ/город по согласованию'],
  ]

  // ===== БЛОК: ROI калькулятор (статика) =====
  const [roiClinics, setRoiClinics] = useState(2)
  const [roiRevenue, setRoiRevenue] = useState(2500000)  // ₽/мес на клинику
  const totalRevenue = roiClinics * roiRevenue * 12        // годовая выручка
  const royalty = totalRevenue * 0.03                       // 3% роялти
  const platformCost = roiClinics * 24900 * 12              // подписка Network
  const initialFee = 250000 * roiClinics                    // паушальный
  const expectedSavings = totalRevenue * 0.20               // оптимизация: 20% экономии
  const netGain = expectedSavings - royalty - platformCost  // чистая выгода
  const roiMonths = netGain > 0 ? Math.ceil((initialFee / netGain) * 12) : 999

  return (
    <>
      <style>{FRANCHISE_CSS}</style>

      {/* ===== БЛОК: NAV ===== */}
      <nav className="ks-nav">
        <div className="ks-nav-inner">
          <a className="ks-nav-logo" href="/">
            <span className="ks-nav-mark">⚕</span>КлиникСеть
          </a>
          <div className="ks-nav-links">
            <a className="ks-nav-link" href="/">Главная</a>
            <a className="ks-nav-link" href="/#features">Возможности</a>
            <a className="ks-nav-link" href="/#pricing">Тарифы</a>
          </div>
          <div className="ks-nav-actions">
            <a href="#fr-form" className="ks-nav-cta">Подать заявку</a>
          </div>
        </div>
      </nav>

      {/* ===== БЛОК: HERO ===== */}
      <section className="ks-fr-hero">
        <div className="ks-fr-hero-inner">
          <div className="ks-eyebrow">
            <span className="ks-eyebrow-dot" />
            Франшиза для медицинских предпринимателей
          </div>
          <h1 className="ks-hero-title">
            Стать франчайзи <em>КлиникСеть</em><br />
            и открыть клинику будущего
          </h1>
          <p className="ks-hero-sub">
            Готовая платформа, бренд, маркетинг и поддержка — всё, чтобы запустить клинику за 28 дней
            и выйти на операционную прибыль за 8–14 месяцев.
          </p>
          <div className="ks-hero-actions">
            <a href="#fr-form" className="ks-btn-primary">
              Подать заявку {ICONS.arrow}
            </a>
            <a href="#fr-roi" className="ks-btn-secondary">
              Посчитать ROI
            </a>
          </div>
        </div>
      </section>

      {/* ===== БЛОК: WHY (6 причин) ===== */}
      <section className="ks-section ks-features" id="fr-why">
        <div className="ks-section-inner">
          <header className="ks-section-head">
            <div className="ks-section-eyebrow">Почему КлиникСеть</div>
            <h2 className="ks-section-title">6 причин стать франчайзи</h2>
            <p className="ks-section-sub">
              Мы запускаем сеть клиник, где каждый партнёр получает технологии федерального уровня
              без капитальных вложений в разработку.
            </p>
          </header>
          <div className="ks-features-grid">
            {REASONS.map(([icon, title, desc]) => (
              <div key={title} className="ks-feature-card">
                <div className="ks-feature-icon">{icon}</div>
                <h4>{title}</h4>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== БЛОК: CONDITIONS (условия) ===== */}
      <section className="ks-section ks-fr-terms" id="fr-terms">
        <div className="ks-section-inner">
          <header className="ks-section-head">
            <div className="ks-section-eyebrow">Условия</div>
            <h2 className="ks-section-title">Прозрачные условия партнёрства</h2>
            <p className="ks-section-sub">
              Никаких скрытых платежей. Всё, что вы платите — паушальный взнос, роялти 3%
              и подписка на платформу по выбранному тарифу.
            </p>
          </header>
          <div className="ks-fr-terms-grid">
            {TERMS.map(([k, v, note]) => (
              <div key={k} className="ks-fr-term-card">
                <div className="ks-fr-term-key">{k}</div>
                <div className="ks-fr-term-val">{v}</div>
                <div className="ks-fr-term-note">{note}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== БЛОК: ROI (калькулятор) ===== */}
      <section className="ks-section ks-fr-roi" id="fr-roi">
        <div className="ks-section-inner">
          <header className="ks-section-head">
            <div className="ks-section-eyebrow">ROI калькулятор</div>
            <h2 className="ks-section-title">Посчитайте окупаемость</h2>
            <p className="ks-section-sub">
              Базовый расчёт на основе выручки клиники, роялти 3% и оптимизации операционных расходов на 20%.
            </p>
          </header>
          <div className="ks-fr-roi-card">
            <div className="ks-fr-roi-inputs">
              <div className="ks-field">
                <span>Клиник в сети: <strong>{roiClinics}</strong></span>
                <input type="range" min={1} max={20} value={roiClinics}
                  onChange={e => setRoiClinics(Number(e.target.value))}
                  className="ks-calc-range" />
              </div>
              <div className="ks-field">
                <span>Выручка на клинику в месяц: <strong>{roiRevenue.toLocaleString('ru-RU')} ₽</strong></span>
                <input type="range" min={500000} max={10000000} step={100000} value={roiRevenue}
                  onChange={e => setRoiRevenue(Number(e.target.value))}
                  className="ks-calc-range" />
              </div>
            </div>
            <div className="ks-fr-roi-results">
              {[
                ['Годовая выручка сети', totalRevenue, '₽'],
                ['Паушальный взнос', initialFee, '₽'],
                ['Роялти за год (3%)', royalty, '₽'],
                ['Подписка на платформу', platformCost, '₽'],
                ['Ожидаемая экономия (20%)', expectedSavings, '₽'],
                ['Чистая выгода за 1 год', netGain, '₽'],
              ].map(([l, v]) => (
                <div key={l} className="ks-fr-roi-row">
                  <span>{l}</span>
                  <strong>{Math.round(v).toLocaleString('ru-RU')} ₽</strong>
                </div>
              ))}
              <div className="ks-fr-roi-summary">
                <span>Срок окупаемости</span>
                <strong>{roiMonths > 60 ? 'более 60 месяцев' : roiMonths + ' мес.'}</strong>
              </div>
            </div>
          </div>
          <p className="ks-fr-roi-note">
            * Расчёт ориентировочный. Финальные показатели зависят от региона, среднего чека, специализации
            и стартовой загрузки. Менеджер по франшизе подготовит индивидуальный план после звонка.
          </p>
        </div>
      </section>

      {/* ===== БЛОК: FORM (заявка) ===== */}
      <section className="ks-section ks-fr-form" id="fr-form">
        <div className="ks-section-inner ks-fr-form-wrap">
          <header className="ks-section-head" style={{ textAlign: 'center', margin: '0 auto 32px' }}>
            <div className="ks-section-eyebrow">Подать заявку</div>
            <h2 className="ks-section-title">Заполните форму — мы свяжемся в течение дня</h2>
          </header>
          {sent ? (
            <div className="ks-fr-form-success">
              <div className="ks-success-mark">{ICONS.check}</div>
              <h3>Заявка получена</h3>
              <p>Менеджер по франшизе свяжется с вами по указанному телефону в течение одного рабочего дня.</p>
              <a href="/" className="ks-btn-primary">Вернуться на главную</a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="ks-fr-form-card">
              {error && <div className="ks-form-error">{error}</div>}
              <div className="ks-fr-form-grid">
                <label className="ks-field">
                  <span>Имя <em>*</em></span>
                  <div className="ks-input-wrap">
                    <span className="ks-input-icon">{ICONS.user}</span>
                    <input type="text" required placeholder="Иван Иванов" value={form.name}
                      onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                </label>
                <label className="ks-field">
                  <span>Телефон <em>*</em></span>
                  <div className="ks-input-wrap">
                    <span className="ks-input-icon">{ICONS.phone}</span>
                    <input type="tel" required placeholder="+7 (900) 000-00-00" value={form.phone}
                      onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
                  </div>
                </label>
                <label className="ks-field">
                  <span>Email</span>
                  <div className="ks-input-wrap">
                    <span className="ks-input-icon">{ICONS.mail}</span>
                    <input type="email" placeholder="email@example.com" value={form.email}
                      onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
                  </div>
                </label>
                <label className="ks-field">
                  <span>Город <em>*</em></span>
                  <div className="ks-input-wrap">
                    <span className="ks-input-icon">{ICONS.building}</span>
                    <input type="text" required placeholder="Москва" value={form.city}
                      onChange={e => setForm(p => ({ ...p, city: e.target.value }))} />
                  </div>
                </label>
                <label className="ks-field" style={{ gridColumn: '1 / -1' }}>
                  <span>Сколько клиник планируете открыть</span>
                  <select className="ks-fr-select" value={form.clinics}
                    onChange={e => setForm(p => ({ ...p, clinics: e.target.value }))}>
                    <option value="1">1 клиника</option>
                    <option value="2-3">2–3 клиники</option>
                    <option value="4-10">4–10 клиник</option>
                    <option value="10+">более 10 клиник</option>
                  </select>
                </label>
                <label className="ks-field" style={{ gridColumn: '1 / -1' }}>
                  <span>Дополнительная информация</span>
                  <textarea rows={3} placeholder="Опыт в медицине, специализация, бюджет, сроки запуска…"
                    value={form.message}
                    onChange={e => setForm(p => ({ ...p, message: e.target.value }))} />
                </label>
              </div>
              <button type="submit" disabled={loading} className="ks-btn-primary ks-btn-block" style={{ marginTop: 18 }}>
                {loading ? 'Отправка…' : 'Отправить заявку'}
              </button>
              <p className="ks-fr-form-privacy">
                Отправляя форму, вы соглашаетесь на обработку персональных данных в соответствии с 152-ФЗ.
              </p>
            </form>
          )}
        </div>
      </section>

      {/* ===== БЛОК: FOOTER ===== */}
      <footer className="ks-footer">
        <div className="ks-footer-inner">
          <div className="ks-footer-col">
            <a className="ks-nav-logo" href="/">
              <span className="ks-nav-mark">⚕</span>КлиникСеть
            </a>
            <p className="ks-footer-tagline">
              Франшиза медицинской SaaS-платформы. Бренд, технологии и поддержка — для предпринимателей.
            </p>
          </div>
          <div className="ks-footer-col">
            <h6>Платформа</h6>
            <a href="/">Главная</a>
            <a href="/#features">Возможности</a>
            <a href="/#pricing">Тарифы</a>
          </div>
          <div className="ks-footer-col">
            <h6>Франшиза</h6>
            <a href="#fr-why">Почему мы</a>
            <a href="#fr-terms">Условия</a>
            <a href="#fr-roi">ROI калькулятор</a>
            <a href="#fr-form">Подать заявку</a>
          </div>
          <div className="ks-footer-col">
            <h6>Контакты</h6>
            <a href="mailto:franchise@xn--80aakbvaezg.xn--p1ai">franchise@клиниксеть.рф</a>
            <span>Пн–Пт · 09:00–19:00 МСК</span>
          </div>
        </div>
        <div className="ks-footer-bottom">
          <span>© 2026 КлиникСеть · Франшиза</span>
          <span>Сделано в России · 152-ФЗ · УЗ-1</span>
        </div>
      </footer>
    </>
  )
}

// ===== БЛОК: CSS (минимальный — переиспользует токены и общие классы из Landing.jsx) =====
const FRANCHISE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; font-family: var(--font-sans); color: var(--fg); background: var(--bg); -webkit-font-smoothing: antialiased; }
button { font-family: inherit; cursor: pointer; border: none; background: none; color: inherit; }
a { color: inherit; text-decoration: none; }

/* Nav (как на Landing) */
.ks-nav { position: sticky; top: 0; z-index: 100; background: oklch(1 0 0 / 0.78); backdrop-filter: blur(20px) saturate(1.4); border-bottom: 1px solid var(--border); }
.ks-nav-inner { max-width: 1240px; margin: 0 auto; display: flex; align-items: center; gap: 24px; padding: 14px 28px; }
.ks-nav-logo { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 600; letter-spacing: -0.02em; }
.ks-nav-mark { width: 30px; height: 30px; border-radius: 9px; background: linear-gradient(140deg, var(--accent), oklch(0.55 0.16 200)); display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 14px; box-shadow: 0 4px 10px oklch(0.55 0.16 240 / 0.3); }
.ks-nav-links { display: flex; gap: 4px; margin-left: auto; }
.ks-nav-link { padding: 7px 14px; border-radius: 8px; font-size: 14px; font-weight: 500; color: var(--fg-2); transition: all 0.15s; }
.ks-nav-link:hover { color: var(--fg); background: var(--bg-2); }
.ks-nav-actions { display: flex; gap: 8px; }
.ks-nav-cta { padding: 9px 18px; border-radius: 10px; background: var(--fg); color: #fff; font-size: 14px; font-weight: 600; }
.ks-nav-cta:hover { background: var(--accent); }

/* Section */
.ks-section { padding: 96px 28px; }
.ks-section-inner { max-width: 1240px; margin: 0 auto; }
.ks-section-head { max-width: 720px; margin-bottom: 56px; }
.ks-section-eyebrow { font-size: 13px; font-weight: 600; color: var(--accent); letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 14px; }
.ks-section-title { font-size: clamp(32px, 4vw, 48px); line-height: 1.1; letter-spacing: -0.025em; font-weight: 600; }
.ks-section-sub { font-size: 18px; color: var(--fg-2); margin-top: 14px; line-height: 1.55; }

/* Hero */
.ks-eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 13px; font-weight: 500; border: 1px solid var(--accent-line); }
.ks-eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--good); box-shadow: 0 0 0 3px oklch(0.7 0.18 145 / 0.25); }
.ks-fr-hero {
  padding: 88px 28px 64px;
  background:
    radial-gradient(ellipse 70% 60% at 80% -10%, oklch(0.94 0.06 240 / 0.7), transparent 60%),
    radial-gradient(ellipse 50% 50% at 10% 30%, oklch(0.96 0.05 200 / 0.5), transparent 60%);
}
.ks-fr-hero-inner { max-width: 920px; margin: 0 auto; text-align: center; }
.ks-hero-title { margin: 22px auto; font-size: clamp(38px, 5.2vw, 60px); line-height: 1.04; letter-spacing: -0.035em; font-weight: 600; max-width: 880px; }
.ks-hero-title em { font-style: normal; background: linear-gradient(120deg, var(--accent) 0%, oklch(0.55 0.16 200) 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.ks-hero-sub { font-size: 19px; line-height: 1.55; color: var(--fg-2); max-width: 640px; margin: 0 auto 32px; }
.ks-hero-actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-bottom: 22px; }

/* Buttons */
.ks-btn-primary { padding: 13px 22px; border-radius: 11px; background: var(--fg); color: #fff; font-size: 15px; font-weight: 600; display: inline-flex; align-items: center; gap: 8px; transition: all 0.15s; box-shadow: var(--shadow-md); }
.ks-btn-primary:hover { background: var(--accent); transform: translateY(-1px); box-shadow: var(--shadow-lg); }
.ks-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
.ks-btn-secondary { padding: 13px 22px; border-radius: 11px; background: oklch(1 0 0 / 0.6); color: var(--fg); font-size: 15px; font-weight: 600; border: 1px solid var(--border-strong); transition: all 0.15s; display: inline-flex; align-items: center; gap: 8px; }
.ks-btn-secondary:hover { background: var(--bg); border-color: var(--fg-2); }
.ks-btn-block { display: flex; width: 100%; justify-content: center; }

/* Features (reasons) */
.ks-features { background: var(--bg); }
.ks-features-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.ks-feature-card { padding: 28px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); transition: all 0.2s; }
.ks-feature-card:hover { border-color: var(--accent-line); box-shadow: var(--shadow-md); transform: translateY(-2px); }
.ks-feature-icon { width: 44px; height: 44px; border-radius: 11px; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; font-size: 22px; margin-bottom: 18px; }
.ks-feature-card h4 { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 8px; }
.ks-feature-card p  { font-size: 14.5px; color: var(--fg-2); line-height: 1.55; margin: 0; }

/* Terms */
.ks-fr-terms { background: var(--bg-1); }
.ks-fr-terms-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.ks-fr-term-card { padding: 22px 20px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.ks-fr-term-key { font-size: 12px; font-weight: 600; color: var(--fg-3); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
.ks-fr-term-val { font-size: 22px; font-weight: 600; color: var(--fg); letter-spacing: -0.02em; margin-bottom: 6px; }
.ks-fr-term-note { font-size: 13px; color: var(--fg-2); line-height: 1.5; }

/* ROI */
.ks-fr-roi { background: var(--bg); }
.ks-fr-roi-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 32px; box-shadow: var(--shadow-md); display: grid; grid-template-columns: 1fr 1fr; gap: 32px; align-items: start; }
.ks-fr-roi-inputs { display: grid; gap: 20px; }
.ks-fr-roi-inputs strong { color: var(--fg); }
.ks-fr-roi-results { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; display: grid; gap: 10px; }
.ks-fr-roi-row { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0; border-bottom: 1px dashed var(--border); font-size: 14px; color: var(--fg-2); }
.ks-fr-roi-row:last-of-type { border-bottom: none; }
.ks-fr-roi-row strong { color: var(--fg); font-weight: 600; }
.ks-fr-roi-summary { display: flex; justify-content: space-between; align-items: baseline; padding: 12px 14px; margin-top: 8px; background: var(--accent-soft); border: 1px solid var(--accent-line); border-radius: 10px; font-size: 14px; color: var(--accent); font-weight: 500; }
.ks-fr-roi-summary strong { font-size: 18px; font-weight: 600; }
.ks-fr-roi-note { margin-top: 24px; font-size: 13px; color: var(--fg-3); text-align: center; max-width: 720px; margin-left: auto; margin-right: auto; line-height: 1.5; }

/* Form */
.ks-fr-form { background: var(--bg-1); }
.ks-fr-form-wrap { max-width: 720px; margin: 0 auto; }
.ks-fr-form-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 32px; box-shadow: var(--shadow-md); }
.ks-fr-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.ks-fr-form-success { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 48px 32px; box-shadow: var(--shadow-md); text-align: center; }
.ks-fr-form-success h3 { font-size: 22px; font-weight: 600; margin: 16px 0 8px; }
.ks-fr-form-success p  { font-size: 15px; color: var(--fg-2); margin: 0 0 24px; }
.ks-fr-form-privacy { font-size: 12px; color: var(--fg-3); text-align: center; margin: 12px 0 0; }
.ks-fr-select {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 11px 12px;
  font-size: 14.5px; color: var(--fg);
  font-family: inherit;
}
.ks-fr-select:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }

/* Form fields (общие) */
.ks-field { display: grid; gap: 6px; }
.ks-field > span { font-size: 13px; font-weight: 500; color: var(--fg-2); }
.ks-field em { color: var(--bad); font-style: normal; }
.ks-input-wrap { position: relative; display: flex; align-items: center; background: var(--bg-1); border: 1px solid var(--border); border-radius: 10px; transition: all 0.15s; }
.ks-input-wrap:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); background: var(--surface); }
.ks-input-icon { padding: 0 12px; color: var(--fg-3); display: flex; }
.ks-input-wrap input { flex: 1; padding: 11px 12px 11px 0; background: transparent; border: 0; outline: 0; font-size: 14.5px; color: var(--fg); font-family: inherit; }
.ks-field textarea { background: var(--bg-1); border: 1px solid var(--border); border-radius: 10px; padding: 11px 12px; font-size: 14.5px; color: var(--fg); font-family: inherit; resize: vertical; }
.ks-field textarea:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.ks-calc-range { width: 100%; accent-color: var(--accent); }
.ks-form-error { background: var(--bad-soft); color: var(--bad); border: 1px solid var(--bad-soft); border-radius: 10px; padding: 10px 12px; font-size: 13px; margin-bottom: 14px; }
.ks-success-mark { width: 56px; height: 56px; border-radius: 14px; background: var(--good-soft); color: var(--good); display: grid; place-items: center; margin: 0 auto; }

/* Footer */
.ks-footer { border-top: 1px solid var(--border); padding: 48px 28px 32px; background: var(--bg); }
.ks-footer-inner { max-width: 1240px; margin: 0 auto; display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr; gap: 40px; }
.ks-footer-col h6 { font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--fg-3); margin: 0 0 14px; }
.ks-footer-col a, .ks-footer-col span { display: block; padding: 5px 0; font-size: 14px; color: var(--fg-2); text-align: left; }
.ks-footer-col a:hover { color: var(--fg); }
.ks-footer-tagline { font-size: 14px; color: var(--fg-2); line-height: 1.55; margin-top: 12px; max-width: 320px; }
.ks-footer-bottom { max-width: 1240px; margin: 32px auto 0; padding-top: 24px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; font-size: 13px; color: var(--fg-3); }

/* Responsive */
@media (max-width: 1100px) {
  .ks-features-grid, .ks-fr-terms-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 900px) {
  .ks-fr-roi-card { grid-template-columns: 1fr; }
  .ks-footer-inner { grid-template-columns: 1fr 1fr; }
  .ks-fr-form-grid { grid-template-columns: 1fr; }
}
@media (max-width: 700px) {
  .ks-section { padding: 64px 16px; }
  .ks-fr-hero { padding: 48px 16px 40px; }
  .ks-features-grid, .ks-fr-terms-grid { grid-template-columns: 1fr; }
  .ks-nav-links { display: none; }
}
`
