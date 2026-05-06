/**
 * ========================================
 * БЛОК: Landing — лендинг КлиникСеть
 * ========================================
 * Premium-дизайн по образцу /public/design2/klinikset.html.
 * Использует токены из /src/design/tokens.css и компоненты из /src/design/.
 * Никаких хардкоженных цветов вне токенов; mobile-first (≤600px) → 4K.
 *
 * Сохранена функциональность:
 *   - LoginModal  (вход → редирект по роли)
 *   - ContactModal (форма «Получить демо» → POST /contact/)
 *   - scrollTo(id) для anchor-ссылок
 *   - Скачивание Calls для Windows
 * ========================================
 */
import { useState, useEffect } from 'react'
import axios from 'axios'
import useAuthStore from '../store/auth'
import { API_BASE, SLUG } from '../config'

// ─── Хелперы ──────────────────────────────────────────────────────
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
  download: <Icon d={<><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></>} />,
  play: <Icon d={<><circle cx="12" cy="12" r="10"/><path d="M10 8l6 4-6 4z"/></>} />,
  check: <Icon d={<path d="M5 12l4 4 10-10"/>} size={14} />,
  star: <Icon d={<path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.8L5.7 21l1.7-7L2 9.2l7.1-.6z"/>} size={14} />,
  send: <Icon d={<><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></>} />,
  close: <Icon d={<><path d="M6 6l12 12"/><path d="M18 6L6 18"/></>} />,
  menu: <Icon d={<><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></>} />,
  user: <Icon d={<><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></>} />,
  lock: <Icon d={<><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></>} />,
  eye: <Icon d={<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>} />,
  eyeOff: <Icon d={<><path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0112 6c6.5 0 10 6 10 6a13.8 13.8 0 01-3.5 4.1"/><path d="M6.1 6.1A13.6 13.6 0 002 12s3.5 6 10 6a9.7 9.7 0 005.3-1.5"/><circle cx="12" cy="12" r="3"/></>} />,
  phone: <Icon d={<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3.1-8.7A2 2 0 014 2h3a2 2 0 012 1.7c.1.9.3 1.8.6 2.6a2 2 0 01-.5 2.1L7.9 9.7a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.8.3 1.7.5 2.6.6a2 2 0 011.7 2z"/>} />,
  mail: <Icon d={<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>} />,
  building: <Icon d={<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 8h0M9 12h0M9 16h0M15 8h0M15 12h0M15 16h0"/></>} />,
}

// ─── In-view helper ───────────────────────────────────────────────
function FadeIn({ children, delay = 0, className = '' }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(t)
  }, [delay])
  return (
    <div
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
        transition: 'opacity 600ms ease, transform 600ms ease',
      }}
    >
      {children}
    </div>
  )
}

// ─── Login modal ──────────────────────────────────────────────────
function LoginModal({ onClose }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { setToken, setUser } = useAuthStore()

  useEffect(() => {
    const fn = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const handleLogin = async e => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const res = await axios.post(API_BASE + '/auth/login', { username, password })
      const { access_token, redirect_url, tenant_slug } = res.data
      const targetSlug = tenant_slug || SLUG || 'arc'
      const redirect = redirect_url || ('/' + targetSlug + '/')
      const isAdmin = redirect === '/admin' || redirect.endsWith('/admin')
      if (isAdmin) localStorage.setItem('clinika_admin_token_' + (redirect === '/admin' ? '' : targetSlug), access_token)
      else localStorage.setItem('clinika_token_' + targetSlug, access_token)
      window.location.href = redirect
    } catch { setError('Неверный логин или пароль') } finally { setLoading(false) }
  }

  return (
    <div className="ks-modal-root" role="dialog" aria-modal="true">
      <div className="ks-modal-back" onClick={onClose} />
      <div className="ks-modal-card">
        <button onClick={onClose} className="ks-modal-close" aria-label="Закрыть">{ICONS.close}</button>
        <div className="ks-modal-head">
          <div className="ks-modal-mark">⚕</div>
          <h2>Войти в систему</h2>
          <p>Роль определится автоматически</p>
        </div>
        <form onSubmit={handleLogin} className="ks-modal-body">
          {error && <div className="ks-form-error">{error}</div>}
          <label className="ks-field">
            <span>Логин</span>
            <div className="ks-input-wrap">
              <span className="ks-input-icon">{ICONS.user}</span>
              <input type="text" autoComplete="username" required value={username}
                onChange={e => setUsername(e.target.value)} placeholder="Введите логин" />
            </div>
          </label>
          <label className="ks-field">
            <span>Пароль</span>
            <div className="ks-input-wrap">
              <span className="ks-input-icon">{ICONS.lock}</span>
              <input type={showPass ? 'text' : 'password'} autoComplete="current-password" required
                value={password} onChange={e => setPassword(e.target.value)} placeholder="Введите пароль" />
              <button type="button" className="ks-input-suffix" onClick={() => setShowPass(s => !s)} aria-label="Показать пароль">
                {showPass ? ICONS.eyeOff : ICONS.eye}
              </button>
            </div>
          </label>
          <button type="submit" disabled={loading} className="ks-btn-primary ks-btn-block">
            {loading ? 'Входим…' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Contact / Demo modal ─────────────────────────────────────────
function ContactModal({ onClose }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', message: '' })
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    const fn = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const handleSubmit = async e => {
    e.preventDefault(); setLoading(true)
    try { await axios.post(API_BASE + '/contact/', form); setSent(true) } catch {} finally { setLoading(false) }
  }

  return (
    <div className="ks-modal-root" role="dialog" aria-modal="true">
      <div className="ks-modal-back" onClick={onClose} />
      <div className="ks-modal-card">
        <button onClick={onClose} className="ks-modal-close" aria-label="Закрыть">{ICONS.close}</button>
        {sent ? (
          <div className="ks-modal-success">
            <div className="ks-success-mark">{ICONS.check}</div>
            <h3>Заявка отправлена</h3>
            <p>Мы свяжемся с вами в течение одного рабочего дня.</p>
            <button onClick={onClose} className="ks-btn-primary">Закрыть</button>
          </div>
        ) : (
          <>
            <div className="ks-modal-head">
              <h2>Получить демо</h2>
              <p>Расскажите о вашей клинике — мы свяжемся и подберём решение</p>
            </div>
            <form onSubmit={handleSubmit} className="ks-modal-body">
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
                  <input type="email" placeholder="email@clinic.ru" value={form.email}
                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
                </div>
              </label>
              <label className="ks-field">
                <span>Сообщение <em>*</em></span>
                <textarea rows={3} required placeholder="Расскажите о вашей клинике…"
                  value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))} />
              </label>
              <button type="submit" disabled={loading} className="ks-btn-primary ks-btn-block">
                {loading ? 'Отправка…' : 'Отправить заявку'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Главный компонент ────────────────────────────────────────────
export default function Landing() {
  const [showLogin, setShowLogin] = useState(false)
  const [showContact, setShowContact] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeRole, setActiveRole] = useState('patient')

  const scrollTo = id => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
    setMenuOpen(false)
  }

  // ─── Роли (для секции «Кабинеты под каждую роль») ───
  const ROLES = {
    patient: {
      label: 'Пациент', dot: 'oklch(0.7 0.15 25)',
      title: 'Кабинет пациента — приёмы и анализы в одном окне',
      desc: 'Запись к врачу, история визитов, результаты анализов, бонусы и онлайн-чат с поддержкой клиники.',
      features: [
        ['Запись к врачу за 30 секунд', 'Слоты со всех клиник сети, фильтр по специалисту, цене и району'],
        ['Электронные результаты', 'PDF и динамика показателей, push при готовности анализа'],
        ['Бонусы и кешбэк', 'Один баланс на всю сеть, можно списать в любом отделении'],
        ['Чат с врачом и поддержкой', 'Уточнения по приёму, рецепты, направления — без звонков'],
      ],
      url: 'app.клиниксеть.рф / пациент',
    },
    doctor: {
      label: 'Врач', dot: 'oklch(0.65 0.16 200)',
      title: 'Рабочее место врача — расписание, ЭМК, премии',
      desc: 'Карта пациента, расписание приёмов, шаблоны протоколов, прозрачная система премий по KPI.',
      features: [
        ['Расписание с защитой от ошибок', 'Автоматический буфер, конфликты блокируются на уровне платформы'],
        ['Электронная медкарта', 'История приёмов, аллергии, назначения — в один клик'],
        ['Шаблоны протоколов', 'Готовые формы по специальности, голосовой ввод, автозаполнение'],
        ['Премии в реальном времени', 'KPI по приёмам, повторам, рейтингу — без бухгалтерии'],
      ],
      url: 'doctor.клиниксеть.рф / расписание',
    },
    admin: {
      label: 'Управляющий сети', dot: 'oklch(0.6 0.18 280)',
      title: 'Кабинет сети — десятки клиник на одном дашборде',
      desc: 'Сквозная аналитика по выручке, загрузке, NPS и врачам. Биллинг, тарифы услуг, управление филиалами.',
      features: [
        ['Дашборд сети', 'Выручка, приёмы, NPS и загрузка по каждой клинике в режиме live'],
        ['Единый прайс и биллинг', 'Тарифы услуг и взаиморасчёты с клиниками — без таблиц в Excel'],
        ['HR и врачи', 'База специалистов, графики, премии и аттестация на одной панели'],
        ['Доступ по ролям', 'Управляющий филиала видит свою клинику, владелец — всю сеть'],
      ],
      url: 'admin.клиниксеть.рф / сеть',
    },
  }
  const r = ROLES[activeRole]

  // ─── Все 10 ролей платформы ───
  const ALL_ROLES = [
    ['super_admin', 'Супер-админ', 'Платформа: тенанты, биллинг, модули, мониторинг'],
    ['franchise_owner', 'Владелец франшизы', 'Сеть клиник, роялти, отзывы, white-label'],
    ['manager', 'Управляющий', 'Дашборд клиники, расписание, биллинг, KPI'],
    ['doctor', 'Врач', 'ЭМК, расписание, протоколы, премии'],
    ['reg', 'Регистратор', 'Запись пациентов, очередь, документы'],
    ['nurse', 'Медсестра', 'Назначения, процедурный кабинет, склад'],
    ['recruiter', 'HR-рекрутер', 'Подбор врачей, аттестация, обучение'],
    ['partner_doctor', 'Партнёр-врач', 'Врач-партнёр сети с доступом к расписанию'],
    ['visiting_doctor', 'Визитёр', 'Доктор-визитёр на смену в нескольких клиниках'],
    ['patient', 'Пациент', 'Запись, анализы, бонусы, чат'],
  ]

  // ─── Тарифы (3 плана) ───
  const PLANS = [
    {
      tier: 'BASIC', name: 'Старт', desc: 'Для отдельной клиники с 5–20 врачами',
      price: '14 900', unit: '/ мес. за клинику',
      list: ['ЭМК и расписание', 'Бонусы и лояльность', 'Базовая аналитика', 'Email-поддержка', 'До 50 сотрудников'],
      cta: 'Подключить',
    },
    {
      tier: 'PROFESSIONAL', name: 'Малая сеть', desc: 'До 10 клиник под одним брендом',
      price: '49 900', unit: '/ мес. за клинику', featured: true,
      list: ['Всё из Старта', 'Дашборд сети', 'Биллинг между филиалами', 'API и интеграции', 'AI-аналитика (базовая)', 'Менеджер внедрения'],
      cta: 'Получить демо',
    },
    {
      tier: 'ENTERPRISE', name: 'Крупная сеть', desc: '10+ клиник, white-label приложения',
      price: 'индивидуально', unit: 'обсуждается',
      list: ['Всё из Малой сети', 'Native iOS/Android под бренд', 'SSO и SCIM', 'Приоритетный SLA', 'Выделенная команда', 'AI Pro: прогнозы, ROI, чат с данными'],
      cta: 'Связаться',
    },
  ]

  // ─── Каталог модулей ───
  const MODULES = [
    ['◉', 'Видеозвонки P2P', 'WebRTC через coturn, без сторонних серверов'],
    ['✺', 'AI-аналитика Pro', 'Прогнозы, ROI бонусов, чат с данными на естественном языке'],
    ['☷', 'МИС-интеграция', 'Renovatio, 1С-Медицина, СБИС, лаборатории'],
    ['◐', 'White-label', 'Свой домен (CNAME), брендинг, native-приложения'],
    ['◇', 'Бонусы и лояльность', 'Единый баланс сети, кешбэк по правилам'],
    ['☎', 'Телефония и SMS', 'Журналы звонков, IVR, OTP, рассылки пациентам'],
    ['{ }', 'REST API и вебхуки', '222+ эндпоинтов, OAuth, webhooks'],
    ['⚿', 'SSO / SCIM', 'Single Sign-On, провижининг сотрудников'],
    ['⚖', '152-ФЗ и УЗ-1', 'Согласия, анонимизация ПД, аудит-лог'],
  ]

  // ─── Возможности (features-grid) ───
  const FEATURES = [
    ['◐', 'Электронная медкарта', 'История приёмов, аллергии, протоколы. Шаблоны по специальностям.'],
    ['☰', 'Расписание сети', 'Слоты всех клиник в одном календаре. Синхронизация с врачами в реальном времени.'],
    ['◇', 'Бонусы и лояльность', 'Единый баланс на всю сеть, кешбэк по правилам, акции и купоны.'],
    ['₽', 'Биллинг и взаиморасчёты', 'Тарифы услуг, оплаты, эквайринг, расчёты между филиалами.'],
    ['◯', 'Чат и видеосвязь', 'Чаты с пациентами, операторская консоль, P2P видеозвонки.'],
    ['⌕', 'Аналитика сети', 'Выручка, NPS, загрузка, конверсия — по каждой клинике и врачу.'],
    ['{ }', 'API и интеграции', '222+ эндпоинтов. 1С, СБИС, телефония, лаборатории — из коробки.'],
    ['◑', 'Мобильные приложения', 'Native iOS и Android для пациентов и врачей. White-label под бренд сети.'],
    ['⚿', 'Безопасность и 152-ФЗ', 'УЗ-1, шифрование медданных, аудит-лог, контроль доступа по ролям.'],
  ]

  // ─── Кому подходит ───
  const FOR_WHOM = [
    ['◉', 'Одна клиника', '5–50 сотрудников, всё базовое от ЭМК до бонусов'],
    ['◈', 'Сеть филиалов', 'Единый бренд, дашборд, биллинг между клиниками'],
    ['◊', 'Франшиза', 'Роялти, отчётность партнёров, white-label под точку'],
    ['◬', 'Медцентр', 'Многопрофильный стационар, лаборатория, поликлиника'],
  ]

  return (
    <>
      {/* ───── СТИЛИ (CSS-токены) ───── */}
      <style>{LANDING_CSS}</style>

      {/* ───── NAV ───── */}
      <nav className="ks-nav">
        <div className="ks-nav-inner">
          <a className="ks-nav-logo" href="#" aria-label="КлиникСеть">
            <span className="ks-nav-mark">⚕</span>
            <span>КлиникСеть</span>
          </a>
          <div className="ks-nav-links">
            {[
              ['features', 'Возможности'],
              ['ai', 'AI-аналитика'],
              ['roles', 'Кабинеты'],
              ['pricing', 'Тарифы'],
              ['modules', 'Модули'],
            ].map(([id, label]) => (
              <button key={id} onClick={() => scrollTo(id)} className="ks-nav-link">{label}</button>
            ))}
          </div>
          <div className="ks-nav-actions">
            <button onClick={() => setShowLogin(true)} className="ks-nav-link ks-nav-link-strong">Войти</button>
            <button onClick={() => setShowContact(true)} className="ks-nav-cta">Получить демо</button>
          </div>
          <button className="ks-nav-burger" onClick={() => setMenuOpen(m => !m)} aria-label="Меню">
            {menuOpen ? ICONS.close : ICONS.menu}
          </button>
        </div>
        {menuOpen && (
          <div className="ks-nav-mobile">
            {[
              ['features', 'Возможности'],
              ['ai', 'AI-аналитика'],
              ['roles', 'Кабинеты'],
              ['pricing', 'Тарифы'],
              ['modules', 'Модули'],
              ['calls', 'Calls для Windows'],
            ].map(([id, label]) => (
              <button key={id} onClick={() => scrollTo(id)} className="ks-nav-mobile-link">{label}</button>
            ))}
            <button onClick={() => { setShowLogin(true); setMenuOpen(false) }} className="ks-nav-mobile-link">Войти</button>
            <button onClick={() => { setShowContact(true); setMenuOpen(false) }} className="ks-btn-primary ks-btn-block" style={{ marginTop: 8 }}>
              Получить демо
            </button>
          </div>
        )}
      </nav>

      {/* ───── HERO ───── */}
      <section className="ks-hero">
        <div className="ks-hero-inner">
          <FadeIn>
            <div className="ks-eyebrow">
              <span className="ks-eyebrow-dot" />
              SaaS-платформа для медицинских сетей
            </div>
            <h1 className="ks-hero-title">
              КлиникСеть — платформа<br />
              клиник <em>нового поколения</em>
            </h1>
            <p className="ks-hero-sub">
              Запись, ЭМК, биллинг, AI-аналитика, бонусы и кабинеты для пациентов, врачей и управляющих —
              без зоопарка интеграций.
            </p>
            <div className="ks-hero-actions">
              <button onClick={() => setShowContact(true)} className="ks-btn-primary">
                Получить демо <span aria-hidden>{ICONS.arrow}</span>
              </button>
              <a href="/downloads/KliniknetCalls-Setup-1.0.4.exe" download className="ks-btn-secondary">
                {ICONS.download}
                Calls для Windows
              </a>
            </div>
            <div className="ks-hero-trust">
              <span className="ks-hero-stars">★★★★★</span>
              <span>UZ-1 · 152-ФЗ · 99.9% SLA · 222+ API-эндпоинтов</span>
            </div>
          </FadeIn>

          {/* Hero side — AI-карточка с цитатой */}
          <FadeIn delay={150} className="ks-hero-side">
            <div className="ks-persona-card">
              <div className="ks-persona-bg" aria-hidden />
              <div className="ks-persona-tag"><span className="ks-tag-dot" />AI · работает 24/7</div>

              {/* Стилизованный мок дашборда */}
              <div className="ks-persona-mock">
                <div className="ks-persona-mock-row">
                  <div>
                    <div className="ks-persona-mock-eyebrow">Дашборд сети</div>
                    <div className="ks-persona-mock-title">12 клиник · апрель 2026</div>
                  </div>
                  <span className="ks-chip ks-chip-good">● live</span>
                </div>
                <div className="ks-persona-kpi">
                  {[
                    ['Выручка', '14.8 М ₽', '+18%'],
                    ['Приёмы', '12 408', '+12%'],
                    ['NPS', '72', '+4'],
                    ['Загрузка', '86%', '−2%'],
                  ].map(([l, v, d]) => (
                    <div key={l} className="ks-persona-kpi-cell">
                      <div className="ks-persona-kpi-l">{l}</div>
                      <div className="ks-persona-kpi-v">{v}</div>
                      <div className={`ks-persona-kpi-d ${d.startsWith('−') ? 'is-down' : ''}`}>{d}</div>
                    </div>
                  ))}
                </div>
                <div className="ks-persona-bars">
                  {[62, 71, 58, 84, 76, 90, 82, 95, 88, 100, 94, 97].map((h, i) => (
                    <span key={i} style={{ height: `${h}%`, background: i === 10 ? 'var(--accent)' : 'var(--accent-line)' }} />
                  ))}
                </div>
              </div>

              <div className="ks-persona-name">
                <div className="ks-persona-avatar">AI</div>
                <div>
                  <div className="ks-persona-name-line">AI-аналитик</div>
                  <div className="ks-persona-name-role">Анализирую загрузку всех клиник в реальном времени</div>
                </div>
              </div>
            </div>

            <div className="ks-persona-quote">
              <strong>Каждую ночь анализирую загрузку всех клиник сети</strong> и подсвечиваю где теряется
              выручка — окна в расписании, простаивающие кабинеты, врачи с просадкой по NPS.
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ───── STATS-strip ───── */}
      <div className="ks-stats">
        <div className="ks-stats-inner">
          {[
            ['10+', 'клиник в сети'],
            ['1 000+', 'пациентов в кабинете'],
            ['222+', 'API-эндпоинтов'],
            ['99.9%', 'SLA платформы'],
          ].map(([n, l]) => (
            <div key={l}><div className="ks-stat-num">{n}</div><div className="ks-stat-l">{l}</div></div>
          ))}
        </div>
      </div>

      {/* ───── FEATURES ───── */}
      <section id="features" className="ks-section ks-features">
        <div className="ks-section-inner">
          <header className="ks-section-head">
            <div className="ks-section-eyebrow">Платформа</div>
            <h2 className="ks-section-title">Всё, что нужно медицинской сети</h2>
            <p className="ks-section-sub">9 модулей в одной системе. Включаются по тарифу — без долгих интеграций.</p>
          </header>
          <div className="ks-feature-grid">
            {FEATURES.map(([icon, title, desc], i) => (
              <FadeIn key={title} delay={i * 50}>
                <article className="ks-feature-card">
                  <div className="ks-feature-icon">{icon}</div>
                  <h4>{title}</h4>
                  <p>{desc}</p>
                </article>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ───── AI ANALYTICS DEMO ───── */}
      <section id="ai" className="ks-section ks-ai">
        <div className="ks-section-inner">
          <header className="ks-section-head ks-center">
            <div className="ks-section-eyebrow">Искусственный интеллект</div>
            <h2 className="ks-section-title">AI-аналитик знает всё о вашей клинике</h2>
            <p className="ks-section-sub">
              Задайте вопрос на обычном языке — получите глубокий анализ данных, прогнозы и рекомендации за секунды.
            </p>
          </header>
          <div className="ks-ai-grid">
            <div className="ks-ai-list">
              {[
                ['Обзор бизнеса', 'Полная картина: направления, конверсия, бонусы, рейтинг сотрудников за любой период.', 'Базовый'],
                ['Прогноз спроса', 'Модель учитывает сезонность, тренды и аномалии — прогноз на следующий период.', 'Pro'],
                ['Загрузка врачей', 'Прогноз занятости по специалисту: кто перегружен, кто простаивает.', 'Pro'],
                ['ROI бонусов', 'Соотношение затрат на бонусы к выручке — оптимизация без потери мотивации.', 'Pro'],
                ['Свободный вопрос', '«Почему упала конверсия в марте?» — AI ответит с цифрами и графиком.', 'Pro'],
              ].map(([t, d, b], i) => (
                <FadeIn key={t} delay={i * 60}>
                  <div className="ks-ai-item">
                    <div className="ks-ai-item-num">0{i + 1}</div>
                    <div className="ks-ai-item-body">
                      <div className="ks-ai-item-head">
                        <strong>{t}</strong>
                        <span className={`ks-chip ${b === 'Pro' ? 'ks-chip-accent' : 'ks-chip-default'}`}>{b}</span>
                      </div>
                      <p>{d}</p>
                    </div>
                  </div>
                </FadeIn>
              ))}
            </div>

            <FadeIn delay={120}>
              <div className="ks-ai-chat">
                <div className="ks-ai-chat-head">
                  <div className="ks-ai-chat-avatar">AI</div>
                  <div>
                    <div className="ks-ai-chat-title">AI-аналитик КлиникСеть</div>
                    <div className="ks-ai-chat-status"><span /> Онлайн · 30 дней</div>
                  </div>
                </div>
                <div className="ks-ai-chat-body">
                  <div className="ks-msg ks-msg-out">Проанализируй работу клиники за последние 30 дней</div>
                  <div className="ks-msg ks-msg-in">
                    <div style={{ marginBottom: 8 }}><strong>Сводка за 30 дней:</strong></div>
                    {[
                      ['Направлений', '187', '+23%', 'up'],
                      ['Конверсия', '79%', '+15 п.п.', 'up'],
                      ['Выплачено бонусов', '124 300 ₽', '−8%', 'down'],
                      ['Средний рейтинг', '4.8 ★', '+0.3', 'up'],
                    ].map(([l, v, d, dir]) => (
                      <div key={l} className="ks-msg-row">
                        <span>{l}</span>
                        <span className="ks-msg-val">
                          <strong>{v}</strong>
                          <em className={dir === 'up' ? 'is-up' : 'is-down'}>{d}</em>
                        </span>
                      </div>
                    ))}
                    <div className="ks-msg-rec">
                      <strong>Рекомендация:</strong> снижение выплат при росте конверсии — хороший сигнал.
                      Рассмотрите увеличение ставки за первичных пациентов.
                    </div>
                  </div>
                  <div className="ks-msg ks-msg-out">Кто из сотрудников показал лучший результат?</div>
                  <div className="ks-msg ks-msg-typing">
                    <span /><span /><span />
                  </div>
                </div>
                <div className="ks-ai-chat-input">
                  <span>Задайте вопрос об аналитике…</span>
                  <button aria-label="Отправить">{ICONS.send}</button>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ───── ROLES (10 ролей платформы) ───── */}
      <section id="roles" className="ks-section ks-roles">
        <div className="ks-section-inner">
          <header className="ks-section-head">
            <div className="ks-section-eyebrow">Кабинеты под каждую роль</div>
            <h2 className="ks-section-title">10 ролей — 10 рабочих мест в одной платформе</h2>
            <p className="ks-section-sub">
              Каждый сотрудник видит ровно то, что ему нужно. Без переключения систем и двойного ввода.
            </p>
          </header>

          {/* Активный таб: 3 ключевых */}
          <div className="ks-roles-tabs" role="tablist">
            {Object.entries(ROLES).map(([k, v]) => (
              <button key={k} role="tab" aria-selected={activeRole === k}
                onClick={() => setActiveRole(k)} className="ks-roles-tab"
                data-active={activeRole === k}>
                <span className="ks-roles-tab-dot" style={{ background: v.dot }} />
                {v.label}
              </button>
            ))}
          </div>

          <div className="ks-role-stage">
            <div className="ks-role-stage-text">
              <h3>{r.title}</h3>
              <p>{r.desc}</p>
              <div className="ks-role-features">
                {r.features.map(([t, s]) => (
                  <div key={t} className="ks-role-feature">
                    <div className="ks-role-check">{ICONS.check}</div>
                    <div>
                      <strong>{t}</strong>
                      <span>{s}</span>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setShowContact(true)} className="ks-btn-secondary">
                Посмотреть тур {ICONS.arrow}
              </button>
            </div>
            <div className="ks-role-preview">
              <div className="ks-preview-chrome">
                <div className="ks-preview-dots"><span /><span /><span /></div>
                <div className="ks-preview-url">{r.url}</div>
              </div>
              <div className="ks-preview-body">
                <RolePreviewMock role={activeRole} />
              </div>
            </div>
          </div>

          {/* Сетка из всех 10 ролей */}
          <div className="ks-roles-all" style={{ marginTop: 56 }}>
            {ALL_ROLES.map(([k, label, desc], i) => (
              <FadeIn key={k} delay={i * 30}>
                <div className="ks-role-card">
                  <div className="ks-role-card-mark">{label[0]}</div>
                  <div>
                    <div className="ks-role-card-name">{label}</div>
                    <div className="ks-role-card-desc">{desc}</div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ───── PRICING ───── */}
      <section id="pricing" className="ks-section ks-pricing">
        <div className="ks-section-inner">
          <header className="ks-section-head">
            <div className="ks-section-eyebrow">Тарифы</div>
            <h2 className="ks-section-title">Платите за клиники, а не за пользователей</h2>
            <p className="ks-section-sub">
              Безлимитные пациенты, врачи и администраторы. Цена зависит только от количества клиник.
            </p>
          </header>
          <div className="ks-pricing-grid">
            {PLANS.map(p => (
              <article key={p.tier} className={`ks-price-card ${p.featured ? 'is-featured' : ''}`}>
                <div className="ks-price-tier">{p.tier}</div>
                <div className="ks-price-name">{p.name}</div>
                <div className="ks-price-desc">{p.desc}</div>
                <div className="ks-price-amount">
                  {p.price === 'индивидуально' ? (
                    <strong>—</strong>
                  ) : (
                    <strong>{p.price} ₽</strong>
                  )}
                  <span>{p.unit}</span>
                </div>
                <ul className="ks-price-list">
                  {p.list.map(l => <li key={l}>{l}</li>)}
                </ul>
                <button onClick={() => setShowContact(true)} className="ks-price-cta">{p.cta}</button>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ───── MODULES ───── */}
      <section id="modules" className="ks-section ks-modules">
        <div className="ks-section-inner">
          <header className="ks-section-head">
            <div className="ks-section-eyebrow">Каталог модулей</div>
            <h2 className="ks-section-title">Подключайте только то, что нужно</h2>
            <p className="ks-section-sub">
              Модули включаются по подписке на уровне клиники. Можно начать с базового и расширяться.
            </p>
          </header>
          <div className="ks-modules-grid">
            {MODULES.map(([icon, title, desc], i) => (
              <FadeIn key={title} delay={i * 40}>
                <div className="ks-module-card">
                  <div className="ks-module-icon">{icon}</div>
                  <div>
                    <div className="ks-module-title">{title}</div>
                    <div className="ks-module-desc">{desc}</div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ───── FOR WHOM ───── */}
      <section className="ks-section ks-forwhom">
        <div className="ks-section-inner">
          <header className="ks-section-head">
            <div className="ks-section-eyebrow">Кому подходит</div>
            <h2 className="ks-section-title">От одной клиники до федеральной сети</h2>
          </header>
          <div className="ks-forwhom-grid">
            {FOR_WHOM.map(([icon, title, desc]) => (
              <div key={title} className="ks-forwhom-card">
                <div className="ks-forwhom-icon">{icon}</div>
                <div className="ks-forwhom-title">{title}</div>
                <div className="ks-forwhom-desc">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───── CALLS DOWNLOAD ───── */}
      <section id="calls" className="ks-section ks-calls">
        <div className="ks-section-inner">
          <div className="ks-calls-card">
            <div className="ks-calls-text">
              <div className="ks-section-eyebrow">Десктоп-приложение</div>
              <h2 className="ks-section-title">КлиникСеть Calls — десктопное приложение</h2>
              <p className="ks-section-sub">
                P2P-видеосвязь врача и пациента. WebRTC через ваш собственный coturn-сервер.
                Без сторонних облачных провайдеров. Версия 1.0.4 — adaptive bitrate, RNNoise, update flow.
              </p>
              <div className="ks-hero-actions" style={{ flexWrap: 'wrap' }}>
                <a href="/downloads/KliniknetCalls-Setup-1.0.4.exe" download className="ks-btn-primary">
                  {ICONS.download}
                  Windows · 77 МБ
                </a>
                <a href="/downloads/KliniknetCalls-1.0.4-mac-arm64.zip" download className="ks-btn-secondary">
                  {ICONS.download}
                  macOS Apple Silicon · 91 МБ
                </a>
                <a href="/downloads/KliniknetCalls-1.0.4-mac-x64.zip" download className="ks-btn-secondary">
                  {ICONS.download}
                  macOS Intel · 96 МБ
                </a>
              </div>
              <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8 }}>
                macOS: распакуйте .zip → перетащите .app в «Программы». При первом запуске:
                ПКМ → «Открыть» (без подписи Apple Developer).
              </p>
            </div>
            <div className="ks-calls-mock">
              <div className="ks-preview-chrome">
                <div className="ks-preview-dots"><span /><span /><span /></div>
                <div className="ks-preview-url">КлиникСеть Calls · 1.0.1</div>
              </div>
              <div className="ks-calls-mock-body">
                <div className="ks-calls-tile">
                  <div className="ks-calls-avatar">МК</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>Мария Кузнецова</div>
                    <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Карта №А-104857</div>
                  </div>
                  <span className="ks-chip ks-chip-good">● в сети</span>
                </div>
                <div className="ks-calls-tile ks-calls-tile-stage">
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 4 }}>Идёт приём · 14:32</div>
                    <div style={{ fontWeight: 600 }}>Кардиолог · Иванов А.С.</div>
                  </div>
                  <button className="ks-btn-primary" style={{ padding: '8px 14px', fontSize: 13 }}>Подключиться</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───── CTA ───── */}
      <section className="ks-cta">
        <div className="ks-cta-card">
          <h2>Готовы попробовать?</h2>
          <p>Получите демо за 1 минуту — покажем дашборд, проведём по кабинетам, посчитаем стоимость под вашу инфраструктуру.</p>
          <div className="ks-cta-actions">
            <button onClick={() => setShowContact(true)} className="ks-btn-cta-primary">
              Получить демо {ICONS.arrow}
            </button>
            <button onClick={() => setShowLogin(true)} className="ks-btn-cta-secondary">
              Уже клиент — войти
            </button>
          </div>
        </div>
      </section>

      {/* ───── FOOTER ───── */}
      <footer className="ks-footer">
        <div className="ks-footer-inner">
          <div className="ks-footer-col">
            <a className="ks-nav-logo" href="#"><span className="ks-nav-mark">⚕</span>КлиникСеть</a>
            <p className="ks-footer-tagline">
              SaaS-платформа для медицинских сетей. Запись, ЭМК, биллинг, аналитика и кабинеты для всех ролей.
            </p>
          </div>
          <div className="ks-footer-col">
            <h6>Продукт</h6>
            <button onClick={() => scrollTo('features')}>Возможности</button>
            <button onClick={() => scrollTo('roles')}>Кабинеты</button>
            <button onClick={() => scrollTo('modules')}>Модули</button>
            <button onClick={() => scrollTo('pricing')}>Тарифы</button>
          </div>
          <div className="ks-footer-col">
            <h6>Компания</h6>
            <button onClick={() => setShowContact(true)}>Связаться</button>
            <a href="https://github.com/mr-khamzat/clinika" target="_blank" rel="noreferrer">GitHub</a>
            <button onClick={() => setShowContact(true)}>Стать партнёром</button>
          </div>
          <div className="ks-footer-col">
            <h6>Право</h6>
            <span>152-ФЗ · УЗ-1</span>
            <span>Аудит-лог</span>
            <span>Обработка ПДн</span>
          </div>
        </div>
        <div className="ks-footer-bottom">
          <span>© 2026 КлиникСеть</span>
          <span>Сделано в России · клиниксеть.рф</span>
        </div>
      </footer>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      {showContact && <ContactModal onClose={() => setShowContact(false)} />}
    </>
  )
}

// ─── Внутренние моки кабинетов (для активного таба) ─────────────────
function RolePreviewMock({ role }) {
  if (role === 'patient') {
    return (
      <div style={{ display: 'grid', gap: 12, padding: 18 }}>
        <div className="ks-mock-tile" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>
            Ближайший приём
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <div style={{ textAlign: 'center', minWidth: 56 }}>
              <div style={{ fontSize: 22, fontWeight: 600 }}>14</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)', textTransform: 'uppercase' }}>мая</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Кардиолог · Иванов А.С.</div>
              <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>11:30 · Клиника на Тверской · каб. 304</div>
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {[['＋', 'Записаться'], ['⌕', 'Анализы'], ['◇', 'Бонусы'], ['◯', 'Чат']].map(([i, l]) => (
            <div key={l} className="ks-mock-tile" style={{ textAlign: 'center', padding: '12px 6px' }}>
              <div style={{ fontSize: 18, color: 'var(--accent)', marginBottom: 4 }}>{i}</div>
              <div style={{ fontSize: 11, color: 'var(--fg-2)', fontWeight: 500 }}>{l}</div>
            </div>
          ))}
        </div>
        <div className="ks-mock-tile">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <strong style={{ fontSize: 13 }}>Результаты анализов</strong>
            <span className="ks-chip ks-chip-good">3 новых</span>
          </div>
          {[['Общий анализ крови', '02.05', 'good'], ['Биохимия (расш.)', '02.05', 'warn'], ['Витамин D', '28.04', 'good']].map(([n, d, s]) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--border)', gap: 12 }}>
              <span style={{ flex: 1, fontSize: 13 }}>{n}</span>
              <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{d}</span>
              <span className={`ks-chip ${s === 'good' ? 'ks-chip-good' : 'ks-chip-warn'}`}>
                {s === 'good' ? 'норма' : 'внимание'}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (role === 'doctor') {
    const slots = [
      ['09:00', 'Петров В. И.', 'Первичный', 'done'],
      ['09:30', 'Сергеева А. В.', 'Повторный', 'done'],
      ['10:00', 'Иванова М. К.', 'Первичный', 'now'],
      ['10:30', 'Кузнецов Д. Л.', 'Контроль', 'next'],
      ['11:00', '— свободно —', '', 'free'],
      ['11:30', 'Морозов И. Г.', 'Первичный', 'next'],
    ]
    return (
      <div style={{ padding: 18, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Сегодня · вторник, 14 мая</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>14 приёмов · 2 окна · загрузка 86%</div>
          </div>
        </div>
        <div className="ks-mock-tile" style={{ padding: 0, overflow: 'hidden' }}>
          {slots.map(([t, n, k, s], i) => (
            <div key={t}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                background: s === 'now' ? 'var(--accent-soft)' : 'transparent',
                borderLeft: s === 'now' ? '3px solid var(--accent)' : '3px solid transparent',
              }}>
              <span style={{ width: 44, fontSize: 12, fontWeight: 600, color: s === 'free' ? 'var(--fg-3)' : 'var(--fg)' }}>{t}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: s === 'free' ? 'var(--fg-3)' : 'var(--fg)', fontStyle: s === 'free' ? 'italic' : 'normal' }}>{n}</div>
                {k && <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{k}</div>}
              </div>
              {s === 'done' && <span className="ks-chip ks-chip-good">✓ принят</span>}
              {s === 'now' && <span className="ks-chip ks-chip-accent">идёт</span>}
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="ks-mock-tile">
            <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>Премия</div>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>184 200 ₽</div>
            <div style={{ fontSize: 11, color: 'var(--good)' }}>+12% к апрелю</div>
          </div>
          <div className="ks-mock-tile">
            <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>Рейтинг</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>4.92 <span style={{ color: 'var(--gold)', fontSize: 13 }}>★★★★★</span></div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>312 отзывов</div>
          </div>
        </div>
      </div>
    )
  }
  // admin
  const bars = [62, 71, 58, 84, 76, 90, 82, 95, 88, 100, 94, 97]
  return (
    <div style={{ padding: 18, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Дашборд сети</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Апрель 2026 · обновлено 14:32</div>
        </div>
        <span className="ks-chip ks-chip-good">● live</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {[['Выручка', '14.8 М ₽', '+18%'], ['Приёмы', '12 408', '+12%'], ['NPS', '72', '+4'], ['Загрузка', '86%', '−2%']].map(([l, v, d]) => (
          <div key={l} className="ks-mock-tile" style={{ padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{l}</div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.015em' }}>{v}</div>
            <div style={{ fontSize: 10, color: d.startsWith('−') ? 'var(--bad)' : 'var(--good)' }}>{d}</div>
          </div>
        ))}
      </div>
      <div className="ks-mock-tile">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12 }}>
          <strong>Приёмы по клиникам · Топ-12</strong>
          <span style={{ color: 'var(--fg-3)' }}>30 дней</span>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 80 }}>
          {bars.map((h, i) => (
            <div key={i} style={{
              flex: 1, height: `${h}%`, borderRadius: '4px 4px 0 0',
              background: i === bars.length - 2 ? 'var(--accent)' : 'var(--accent-line)',
            }} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── CSS-токены лендинга (один раз через <style>) ───
const LANDING_CSS = `
/* ============================================================
   КлиникСеть — лендинг
   Все цвета через CSS-переменные из tokens.css.
   Mobile-first: базовые стили — для мобильного, медиа-запросы расширяют.
   ============================================================ */

/* === Сброс скролла === */
html, body { scroll-behavior: smooth; }
body { overflow-x: hidden; background: var(--bg); color: var(--fg); }

/* === NAV === */
.ks-nav {
  position: sticky; top: 0; z-index: 100;
  background: oklch(1 0 0 / 0.78);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  border-bottom: 1px solid var(--border);
}
.ks-nav-inner {
  max-width: 1240px; margin: 0 auto;
  display: flex; align-items: center; gap: 16px;
  padding: 12px 16px;
}
.ks-nav-logo {
  display: inline-flex; align-items: center; gap: 10px;
  font-size: 16px; font-weight: 600; letter-spacing: -0.02em;
  color: var(--fg); text-decoration: none;
}
.ks-nav-mark {
  width: 30px; height: 30px; border-radius: 9px;
  background: linear-gradient(140deg, var(--accent), var(--accent-2));
  display: grid; place-items: center;
  color: #fff; font-weight: 700; font-size: 14px;
  box-shadow: 0 4px 10px oklch(0.55 0.16 240 / 0.30);
}
.ks-nav-links {
  display: none;
  gap: 4px; margin-left: auto;
}
.ks-nav-link {
  padding: 7px 12px; border-radius: 8px;
  font-size: 14px; font-weight: 500; color: var(--fg-2);
  background: none; border: none; cursor: pointer;
  transition: background 0.15s, color 0.15s;
  font-family: inherit;
}
.ks-nav-link:hover { color: var(--fg); background: var(--bg-2); }
.ks-nav-link-strong { color: var(--fg); }
.ks-nav-actions { display: none; gap: 8px; align-items: center; }
.ks-nav-cta {
  padding: 9px 16px; border-radius: 10px;
  background: var(--fg); color: #fff;
  font-size: 13.5px; font-weight: 600;
  border: none; cursor: pointer; transition: background 0.15s, transform 0.15s;
  font-family: inherit;
}
.ks-nav-cta:hover { background: var(--accent); transform: translateY(-1px); }
.ks-nav-burger {
  margin-left: auto;
  width: 44px; height: 44px;
  display: grid; place-items: center;
  border-radius: 9px;
  background: var(--bg-2); color: var(--fg);
  border: 1px solid var(--border);
  cursor: pointer;
}
.ks-nav-mobile {
  display: flex; flex-direction: column; gap: 4px;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}
.ks-nav-mobile-link {
  text-align: left; padding: 12px 10px;
  font-size: 15px; font-weight: 500; color: var(--fg);
  background: none; border: none; cursor: pointer; border-radius: 8px;
  font-family: inherit;
}
.ks-nav-mobile-link:hover { background: var(--bg-2); }

/* === HERO === */
.ks-hero {
  position: relative;
  padding: 56px 16px 40px;
  overflow: hidden;
  background:
    radial-gradient(ellipse 70% 60% at 80% -10%, oklch(0.94 0.06 240 / 0.7), transparent 60%),
    radial-gradient(ellipse 50% 50% at 10% 30%, oklch(0.96 0.05 200 / 0.5), transparent 60%);
}
.ks-hero-inner {
  max-width: 1240px; margin: 0 auto;
  display: grid; grid-template-columns: 1fr; gap: 40px;
  align-items: center;
}
.ks-eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 12px; border-radius: 999px;
  background: var(--accent-soft); color: var(--accent);
  font-size: 12.5px; font-weight: 500;
  border: 1px solid var(--accent-line);
}
.ks-eyebrow-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--good);
  box-shadow: 0 0 0 3px var(--good-soft);
  animation: ksPulse 2.4s ease-in-out infinite;
}
@keyframes ksPulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.55 } }

.ks-hero-title {
  margin: 18px 0 18px;
  font-size: clamp(32px, 7vw, 60px);
  line-height: 1.06;
  letter-spacing: -0.035em;
  font-weight: 600;
  color: var(--fg);
}
.ks-hero-title em {
  font-style: normal;
  background: linear-gradient(120deg, var(--accent) 0%, var(--accent-2) 100%);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
}
.ks-hero-sub {
  font-size: 16px; line-height: 1.55; color: var(--fg-2);
  max-width: 540px; margin-bottom: 28px;
}
.ks-hero-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 24px; }
.ks-hero-trust {
  display: flex; align-items: center; gap: 12px;
  flex-wrap: wrap;
  font-size: 12.5px; color: var(--fg-3);
}
.ks-hero-stars { color: var(--gold); letter-spacing: 1px; }

/* === Кнопки === */
.ks-btn-primary, .ks-btn-secondary, .ks-btn-cta-primary, .ks-btn-cta-secondary, .ks-price-cta {
  font-family: inherit; cursor: pointer; border: none;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-weight: 600;
  transition: background 0.15s, transform 0.15s, box-shadow 0.15s, border-color 0.15s;
  min-height: 44px;
}
.ks-btn-primary {
  padding: 12px 20px; border-radius: 11px;
  background: var(--fg); color: #fff;
  font-size: 14.5px;
  box-shadow: var(--shadow-md);
}
.ks-btn-primary:hover { background: var(--accent); transform: translateY(-1px); box-shadow: var(--shadow-lg); }
.ks-btn-primary[disabled] { opacity: 0.6; cursor: not-allowed; }
.ks-btn-secondary {
  padding: 12px 20px; border-radius: 11px;
  background: var(--surface); color: var(--fg);
  font-size: 14.5px;
  border: 1px solid var(--border-strong);
  text-decoration: none;
}
.ks-btn-secondary:hover { background: var(--bg-2); border-color: var(--fg-3); }
.ks-btn-block { width: 100%; }

/* === STATS strip === */
.ks-stats {
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 24px 16px;
  background: var(--bg-1);
}
.ks-stats-inner {
  max-width: 1240px; margin: 0 auto;
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px;
}
.ks-stat-num { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; color: var(--fg); }
.ks-stat-l { font-size: 12.5px; color: var(--fg-3); margin-top: 4px; }

/* === Section base === */
.ks-section { padding: 64px 16px; }
.ks-section-inner { max-width: 1240px; margin: 0 auto; }
.ks-section-head { max-width: 720px; margin-bottom: 36px; }
.ks-section-head.ks-center { text-align: center; margin-left: auto; margin-right: auto; }
.ks-section-eyebrow {
  font-size: 12px; font-weight: 600; color: var(--accent);
  letter-spacing: 0.06em; text-transform: uppercase;
  margin-bottom: 12px;
}
.ks-section-title {
  font-size: clamp(26px, 5.4vw, 44px);
  line-height: 1.12;
  letter-spacing: -0.025em;
  font-weight: 600;
  color: var(--fg);
}
.ks-section-sub {
  font-size: 16px; color: var(--fg-2);
  margin-top: 12px; line-height: 1.55;
  max-width: 620px;
}
.ks-center .ks-section-sub { margin-left: auto; margin-right: auto; }

/* === FEATURES === */
.ks-features { background: var(--bg); }
.ks-feature-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
.ks-feature-card {
  padding: 22px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
}
.ks-feature-card:hover { border-color: var(--accent-line); box-shadow: var(--shadow-md); transform: translateY(-2px); }
.ks-feature-icon {
  width: 44px; height: 44px; border-radius: 11px;
  background: var(--accent-soft); color: var(--accent);
  display: grid; place-items: center;
  font-size: 22px;
  margin-bottom: 14px;
}
.ks-feature-card h4 { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; margin-bottom: 6px; color: var(--fg); }
.ks-feature-card p { font-size: 14px; color: var(--fg-2); line-height: 1.55; }

/* === AI === */
.ks-ai { background: var(--bg-1); }
.ks-ai-grid { display: grid; grid-template-columns: 1fr; gap: 24px; align-items: start; }
.ks-ai-list { display: grid; gap: 10px; }
.ks-ai-item {
  display: flex; gap: 14px;
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
}
.ks-ai-item-num {
  flex-shrink: 0;
  width: 32px; height: 32px; border-radius: 9px;
  background: var(--accent-soft); color: var(--accent);
  display: grid; place-items: center;
  font-size: 12px; font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.ks-ai-item-body { flex: 1; min-width: 0; }
.ks-ai-item-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
.ks-ai-item-head strong { font-size: 14.5px; color: var(--fg); }
.ks-ai-item p { font-size: 13px; color: var(--fg-2); line-height: 1.5; }
.ks-ai-chat {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}
.ks-ai-chat-head {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-1);
}
.ks-ai-chat-avatar {
  width: 36px; height: 36px; border-radius: 10px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #fff; display: grid; place-items: center;
  font-size: 11px; font-weight: 700;
}
.ks-ai-chat-title { font-size: 14px; font-weight: 600; color: var(--fg); }
.ks-ai-chat-status {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--fg-3);
}
.ks-ai-chat-status span { width: 6px; height: 6px; border-radius: 50%; background: var(--good); }
.ks-ai-chat-body {
  background: var(--bg-2);
  padding: 16px;
  display: grid; gap: 10px;
  min-height: 320px;
}
.ks-msg {
  font-size: 13px; line-height: 1.5;
  padding: 10px 14px;
  border-radius: 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  max-width: 88%;
  color: var(--fg);
}
.ks-msg-out { justify-self: end; border-bottom-right-radius: 4px; }
.ks-msg-in { justify-self: start; border-bottom-left-radius: 4px; }
.ks-msg-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 0;
  border-top: 1px solid var(--border);
  font-size: 12px; color: var(--fg-3);
}
.ks-msg-row:first-of-type { border-top: none; }
.ks-msg-val { display: flex; align-items: center; gap: 8px; color: var(--fg); font-weight: 600; }
.ks-msg-val em {
  font-style: normal; font-size: 11px; padding: 2px 6px; border-radius: 6px;
}
.ks-msg-val em.is-up { background: var(--good-soft); color: var(--good); }
.ks-msg-val em.is-down { background: var(--bad-soft); color: var(--bad); }
.ks-msg-rec {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--accent-soft);
  border-radius: 9px;
  font-size: 12px; color: var(--fg-2);
}
.ks-msg-rec strong { color: var(--accent); }
.ks-msg-typing {
  justify-self: start;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 12px 14px;
}
.ks-msg-typing span {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent);
  animation: ksTyping 1.2s infinite ease-in-out;
}
.ks-msg-typing span:nth-child(2) { animation-delay: 0.15s; }
.ks-msg-typing span:nth-child(3) { animation-delay: 0.30s; }
@keyframes ksTyping { 0%, 80%, 100% { opacity: 0.3 } 40% { opacity: 1 } }
.ks-ai-chat-input {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  background: var(--surface);
  border-top: 1px solid var(--border);
}
.ks-ai-chat-input span {
  flex: 1; padding: 10px 14px;
  background: var(--bg-2);
  border-radius: 10px;
  font-size: 13px; color: var(--fg-3);
}
.ks-ai-chat-input button {
  width: 38px; height: 38px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #fff;
  display: grid; place-items: center;
  border: none; cursor: pointer;
}

/* === ROLES === */
.ks-roles { background: var(--bg-1); }
.ks-roles-tabs {
  display: flex; gap: 4px; padding: 5px;
  background: var(--surface); border-radius: 14px;
  border: 1px solid var(--border);
  margin-bottom: 24px;
  box-shadow: var(--shadow-sm);
  overflow-x: auto;
  scrollbar-width: none;
}
.ks-roles-tabs::-webkit-scrollbar { display: none; }
.ks-roles-tab {
  padding: 9px 14px; border-radius: 10px;
  font-size: 13.5px; font-weight: 500; color: var(--fg-2);
  display: inline-flex; align-items: center; gap: 8px;
  background: none; border: none; cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
  font-family: inherit;
}
.ks-roles-tab:hover { color: var(--fg); }
.ks-roles-tab[data-active="true"] { background: var(--fg); color: #fff; }
.ks-roles-tab-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.ks-role-stage {
  display: grid; grid-template-columns: 1fr; gap: 32px;
  align-items: start;
}
.ks-role-stage-text h3 {
  font-size: clamp(22px, 4.5vw, 28px); font-weight: 600;
  letter-spacing: -0.02em; line-height: 1.18;
  margin-bottom: 10px;
  color: var(--fg);
}
.ks-role-stage-text p {
  font-size: 15px; color: var(--fg-2);
  line-height: 1.55; margin-bottom: 18px;
}
.ks-role-features { display: grid; gap: 12px; margin-bottom: 22px; }
.ks-role-feature { display: flex; gap: 10px; align-items: flex-start; }
.ks-role-check {
  flex-shrink: 0;
  width: 22px; height: 22px; border-radius: 7px;
  background: var(--accent-soft); color: var(--accent);
  display: grid; place-items: center;
  margin-top: 1px;
}
.ks-role-feature strong { font-size: 14.5px; font-weight: 600; color: var(--fg); display: block; }
.ks-role-feature span { color: var(--fg-3); display: block; margin-top: 2px; font-size: 13px; line-height: 1.5; }

.ks-role-preview {
  position: relative;
  border-radius: var(--radius-lg);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.ks-preview-chrome {
  display: flex; align-items: center; gap: 8px;
  padding: 11px 14px;
  background: var(--bg-2);
  border-bottom: 1px solid var(--border);
}
.ks-preview-dots { display: flex; gap: 5px; }
.ks-preview-dots span { width: 9px; height: 9px; border-radius: 50%; background: var(--border-strong); }
.ks-preview-url {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 5px 10px;
  font-size: 11.5px; color: var(--fg-3);
  font-family: 'SF Mono', Consolas, monospace;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ks-preview-body { background: var(--bg-2); }
.ks-mock-tile {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
}

.ks-roles-all { display: grid; grid-template-columns: 1fr; gap: 10px; }
.ks-role-card {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: border-color 0.15s, transform 0.15s;
}
.ks-role-card:hover { border-color: var(--accent-line); transform: translateY(-1px); }
.ks-role-card-mark {
  width: 36px; height: 36px; border-radius: 10px;
  background: var(--accent-soft); color: var(--accent);
  display: grid; place-items: center;
  font-weight: 700; font-size: 14px;
  flex-shrink: 0;
}
.ks-role-card-name { font-size: 14px; font-weight: 600; color: var(--fg); }
.ks-role-card-desc { font-size: 12.5px; color: var(--fg-3); line-height: 1.45; margin-top: 2px; }

/* === PRICING === */
.ks-pricing { background: var(--bg); }
.ks-pricing-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
.ks-price-card {
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  display: flex; flex-direction: column;
}
.ks-price-card.is-featured {
  border: 2px solid var(--fg);
  background: var(--fg);
  color: #fff;
  box-shadow: var(--shadow-lg);
}
.ks-price-tier { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); margin-bottom: 6px; }
.is-featured .ks-price-tier { color: var(--accent-2); }
.ks-price-name { font-size: 22px; font-weight: 600; letter-spacing: -0.015em; margin-bottom: 4px; color: inherit; }
.ks-price-desc { font-size: 13.5px; color: var(--fg-2); margin-bottom: 18px; line-height: 1.5; }
.is-featured .ks-price-desc { color: oklch(0.78 0.012 220); }
.ks-price-amount { display: flex; align-items: baseline; gap: 6px; margin-bottom: 22px; }
.ks-price-amount strong { font-size: 32px; font-weight: 600; letter-spacing: -0.02em; color: inherit; }
.ks-price-amount span { font-size: 13px; color: var(--fg-3); }
.is-featured .ks-price-amount span { color: oklch(0.7 0.012 220); }
.ks-price-list { list-style: none; padding: 0; margin: 0 0 22px; display: grid; gap: 9px; flex: 1; }
.ks-price-list li { font-size: 13.5px; line-height: 1.5; display: flex; gap: 8px; align-items: flex-start; color: inherit; }
.ks-price-list li::before { content: '✓'; color: var(--accent); font-weight: 700; flex-shrink: 0; }
.is-featured .ks-price-list li::before { color: var(--accent-2); }
.ks-price-cta {
  padding: 12px; border-radius: 10px;
  font-size: 14px; font-weight: 600;
  border: 1px solid var(--border-strong);
  background: var(--surface); color: var(--fg);
  min-height: 44px;
}
.ks-price-cta:hover { background: var(--bg-2); }
.is-featured .ks-price-cta { background: #fff; color: var(--fg); border-color: transparent; }

/* === MODULES === */
.ks-modules { background: var(--bg-1); }
.ks-modules-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
.ks-module-card {
  display: flex; align-items: flex-start; gap: 14px;
  padding: 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.ks-module-card:hover { border-color: var(--accent-line); box-shadow: var(--shadow-sm); }
.ks-module-icon {
  flex-shrink: 0;
  width: 40px; height: 40px; border-radius: 10px;
  background: var(--accent-soft); color: var(--accent);
  display: grid; place-items: center;
  font-size: 18px;
}
.ks-module-title { font-size: 14.5px; font-weight: 600; color: var(--fg); }
.ks-module-desc { font-size: 13px; color: var(--fg-3); line-height: 1.5; margin-top: 3px; }

/* === FOR WHOM === */
.ks-forwhom { background: var(--bg); }
.ks-forwhom-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ks-forwhom-card {
  padding: 22px 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  text-align: left;
}
.ks-forwhom-icon {
  width: 44px; height: 44px; border-radius: 11px;
  background: var(--accent-soft); color: var(--accent);
  display: grid; place-items: center;
  font-size: 22px;
  margin-bottom: 12px;
}
.ks-forwhom-title { font-size: 15px; font-weight: 600; color: var(--fg); margin-bottom: 4px; }
.ks-forwhom-desc { font-size: 13px; color: var(--fg-3); line-height: 1.5; }

/* === CALLS === */
.ks-calls { background: var(--bg-1); }
.ks-calls-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 28px;
  display: grid; grid-template-columns: 1fr; gap: 24px;
  box-shadow: var(--shadow-md);
}
.ks-calls-mock {
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bg-2);
}
.ks-calls-mock-body { padding: 14px; display: grid; gap: 10px; }
.ks-calls-tile {
  display: flex; align-items: center; gap: 12px;
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 11px;
}
.ks-calls-tile-stage {
  background: linear-gradient(135deg, var(--accent-soft), oklch(0.97 0.04 200));
  border-color: var(--accent-line);
  justify-content: space-between;
}
.ks-calls-avatar {
  width: 38px; height: 38px; border-radius: 10px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #fff;
  display: grid; place-items: center;
  font-weight: 700; font-size: 13px;
  flex-shrink: 0;
}

/* === CTA === */
.ks-cta {
  padding: 64px 16px;
  background:
    radial-gradient(ellipse 50% 70% at 80% 30%, oklch(0.94 0.07 240 / 0.6), transparent 65%),
    radial-gradient(ellipse 50% 70% at 20% 70%, oklch(0.95 0.05 200 / 0.5), transparent 65%),
    var(--bg-1);
}
.ks-cta-card {
  max-width: 1000px; margin: 0 auto;
  padding: 40px 24px;
  border-radius: var(--radius-lg);
  background: linear-gradient(140deg, var(--fg) 0%, oklch(0.22 0.04 250) 100%);
  color: #fff;
  text-align: center;
  position: relative;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}
.ks-cta-card::before {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(ellipse 70% 80% at 50% 0%, oklch(0.55 0.16 240 / 0.35), transparent 60%);
  pointer-events: none;
}
.ks-cta-card > * { position: relative; z-index: 1; }
.ks-cta-card h2 {
  font-size: clamp(24px, 5.4vw, 40px); font-weight: 600;
  letter-spacing: -0.025em; line-height: 1.12;
  margin-bottom: 12px;
}
.ks-cta-card p {
  font-size: 15px; color: oklch(0.78 0.012 220);
  max-width: 560px; margin: 0 auto 24px; line-height: 1.55;
}
.ks-cta-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.ks-btn-cta-primary {
  padding: 13px 24px; border-radius: 11px;
  background: #fff; color: var(--fg);
  font-size: 14.5px;
}
.ks-btn-cta-primary:hover { background: oklch(0.96 0.005 250); }
.ks-btn-cta-secondary {
  padding: 13px 24px; border-radius: 11px;
  background: oklch(1 0 0 / 0.10); color: #fff;
  font-size: 14.5px;
  border: 1px solid oklch(1 0 0 / 0.18);
}
.ks-btn-cta-secondary:hover { background: oklch(1 0 0 / 0.16); }

/* === FOOTER === */
.ks-footer {
  border-top: 1px solid var(--border);
  padding: 36px 16px 24px;
  background: var(--bg);
}
.ks-footer-inner {
  max-width: 1240px; margin: 0 auto;
  display: grid; grid-template-columns: 1fr; gap: 24px;
}
.ks-footer-col h6 {
  font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--fg-3); margin-bottom: 12px;
}
.ks-footer-col a, .ks-footer-col button, .ks-footer-col span {
  display: block; padding: 4px 0;
  font-size: 13.5px; color: var(--fg-2);
  background: none; border: none; text-align: left; cursor: pointer;
  font-family: inherit; text-decoration: none;
  transition: color 0.15s;
}
.ks-footer-col a:hover, .ks-footer-col button:hover { color: var(--fg); }
.ks-footer-col span { cursor: default; }
.ks-footer-tagline { font-size: 13.5px; color: var(--fg-2); line-height: 1.55; margin-top: 10px; max-width: 320px; }
.ks-footer-bottom {
  max-width: 1240px; margin: 24px auto 0;
  padding-top: 18px;
  border-top: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 6px;
  font-size: 12.5px; color: var(--fg-3);
}

/* === Чипы локальные (для мок-блоков) === */
.ks-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 500;
  background: var(--bg-2); color: var(--fg-3);
  border: 1px solid var(--border);
}
.ks-chip-good { background: var(--good-soft); color: var(--good); border-color: transparent; }
.ks-chip-warn { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
.ks-chip-accent { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.ks-chip-default { background: var(--bg-2); color: var(--fg-3); }

/* === PERSONA mock === */
.ks-hero-side { display: grid; gap: 14px; }
.ks-persona-card {
  position: relative;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  padding: 16px;
  display: grid; gap: 14px;
}
.ks-persona-bg {
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse 70% 50% at 0% 0%, var(--accent-soft), transparent 60%),
    radial-gradient(ellipse 60% 50% at 100% 100%, oklch(0.94 0.06 200 / 0.6), transparent 60%);
  pointer-events: none;
}
.ks-persona-card > * { position: relative; z-index: 1; }
.ks-persona-tag {
  align-self: flex-start;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-radius: 999px;
  background: oklch(0.18 0.014 220 / 0.85);
  backdrop-filter: blur(10px);
  color: #fff; font-size: 11.5px; font-weight: 600;
}
.ks-tag-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--good);
  animation: ksPulse 2s ease-in-out infinite;
}
.ks-persona-mock {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  display: grid; gap: 10px;
}
.ks-persona-mock-row { display: flex; align-items: center; justify-content: space-between; }
.ks-persona-mock-eyebrow { font-size: 10.5px; font-weight: 600; color: var(--fg-3); letter-spacing: 0.05em; text-transform: uppercase; }
.ks-persona-mock-title { font-size: 14px; font-weight: 600; letter-spacing: -0.015em; color: var(--fg); margin-top: 2px; }
.ks-persona-kpi { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.ks-persona-kpi-cell {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bg-1);
}
.ks-persona-kpi-l { font-size: 9.5px; color: var(--fg-3); text-transform: uppercase; letter-spacing: 0.04em; }
.ks-persona-kpi-v { font-size: 14px; font-weight: 600; letter-spacing: -0.015em; color: var(--fg); margin-top: 2px; }
.ks-persona-kpi-d { font-size: 9.5px; font-weight: 500; color: var(--good); margin-top: 1px; }
.ks-persona-kpi-d.is-down { color: var(--bad); }
.ks-persona-bars {
  display: flex; gap: 3px; align-items: flex-end; height: 56px;
}
.ks-persona-bars span { flex: 1; border-radius: 3px 3px 0 0; min-height: 6px; }

.ks-persona-name {
  display: flex; align-items: center; gap: 12px;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
}
.ks-persona-avatar {
  width: 34px; height: 34px; border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  display: grid; place-items: center;
  color: #fff; font-size: 11px; font-weight: 700;
  flex-shrink: 0;
}
.ks-persona-name-line { font-size: 13px; font-weight: 600; color: var(--fg); }
.ks-persona-name-role { font-size: 11.5px; color: var(--fg-3); margin-top: 1px; }
.ks-persona-quote {
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  padding: 14px 16px;
  font-size: 13.5px; line-height: 1.55; color: var(--fg-2);
}
.ks-persona-quote strong { color: var(--fg); font-weight: 600; }

/* === MODALS === */
.ks-modal-root {
  position: fixed; inset: 0; z-index: 200;
  display: grid; place-items: center;
  padding: 16px;
}
.ks-modal-back {
  position: absolute; inset: 0;
  background: oklch(0.18 0.014 220 / 0.55);
  backdrop-filter: blur(8px);
}
.ks-modal-card {
  position: relative; z-index: 1;
  width: 100%; max-width: 440px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  max-height: calc(100vh - 32px);
  display: flex; flex-direction: column;
}
.ks-modal-close {
  position: absolute; top: 12px; right: 12px; z-index: 2;
  width: 36px; height: 36px;
  display: grid; place-items: center;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--fg-2);
  cursor: pointer;
}
.ks-modal-close:hover { color: var(--fg); }
.ks-modal-head {
  padding: 28px 24px 18px;
  text-align: center;
  border-bottom: 1px solid var(--border);
}
.ks-modal-mark {
  width: 48px; height: 48px; border-radius: 14px;
  margin: 0 auto 12px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #fff;
  display: grid; place-items: center;
  font-size: 22px; font-weight: 700;
  box-shadow: var(--shadow-md);
}
.ks-modal-head h2 { font-size: 20px; font-weight: 600; color: var(--fg); margin-bottom: 4px; letter-spacing: -0.015em; }
.ks-modal-head p { font-size: 13.5px; color: var(--fg-3); }
.ks-modal-body { padding: 22px 24px; display: grid; gap: 14px; overflow-y: auto; }
.ks-form-error {
  background: var(--bad-soft); color: var(--bad);
  padding: 10px 12px; border-radius: 9px; font-size: 13px;
}
.ks-field { display: grid; gap: 6px; }
.ks-field > span { font-size: 13px; font-weight: 500; color: var(--fg-2); }
.ks-field > span em { color: var(--bad); font-style: normal; }
.ks-input-wrap { position: relative; display: flex; align-items: center; }
.ks-input-icon { position: absolute; left: 12px; color: var(--fg-3); display: inline-flex; pointer-events: none; }
.ks-input-suffix {
  position: absolute; right: 8px;
  width: 32px; height: 32px;
  display: grid; place-items: center;
  background: none; border: none; cursor: pointer; color: var(--fg-3);
}
.ks-input-wrap input, .ks-field textarea {
  width: 100%;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 11px 14px 11px 40px;
  font-size: 14px;
  color: var(--fg);
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s, background 0.15s;
  min-height: 44px;
}
.ks-field textarea {
  padding: 11px 14px;
  resize: vertical;
}
.ks-input-wrap input:focus, .ks-field textarea:focus {
  border-color: var(--accent);
  background: var(--surface);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.ks-modal-success {
  padding: 36px 24px;
  text-align: center;
}
.ks-success-mark {
  width: 64px; height: 64px; border-radius: 18px;
  margin: 0 auto 14px;
  background: var(--good-soft); color: var(--good);
  display: grid; place-items: center;
  font-size: 28px;
}
.ks-modal-success h3 { font-size: 19px; font-weight: 600; color: var(--fg); margin-bottom: 6px; }
.ks-modal-success p { font-size: 14px; color: var(--fg-3); margin-bottom: 18px; }

/* ============================================================
   MEDIA QUERIES — расширения для планшета и десктопа
   ============================================================ */
@media (min-width: 600px) {
  .ks-stats-inner { grid-template-columns: repeat(4, 1fr); }
  .ks-feature-grid { grid-template-columns: 1fr 1fr; }
  .ks-modules-grid { grid-template-columns: 1fr 1fr; }
  .ks-forwhom-grid { grid-template-columns: repeat(4, 1fr); }
  .ks-roles-all { grid-template-columns: 1fr 1fr; }
  .ks-footer-inner { grid-template-columns: 1.5fr 1fr 1fr 1fr; }
  .ks-footer-bottom { flex-direction: row; justify-content: space-between; }
  .ks-cta-card { padding: 56px 40px; }
  .ks-section { padding: 80px 24px; }
  .ks-hero { padding: 72px 24px 48px; }
}

@media (min-width: 900px) {
  .ks-nav-links, .ks-nav-actions { display: flex; }
  .ks-nav-burger { display: none; }
  .ks-nav-mobile { display: none !important; }

  .ks-hero-inner { grid-template-columns: 1.05fr 0.95fr; gap: 56px; }
  .ks-hero { padding: 88px 28px 64px; }

  .ks-feature-grid { grid-template-columns: repeat(3, 1fr); }
  .ks-modules-grid { grid-template-columns: repeat(3, 1fr); }
  .ks-pricing-grid { grid-template-columns: repeat(3, 1fr); }
  .ks-pricing-grid .is-featured { transform: translateY(-6px); }
  .ks-roles-all { grid-template-columns: repeat(2, 1fr); }

  .ks-role-stage { grid-template-columns: 1.05fr 0.95fr; gap: 48px; }
  .ks-role-stage-text h3 { font-size: 30px; }
  .ks-ai-grid { grid-template-columns: 1fr 1fr; gap: 40px; }

  .ks-calls-card { grid-template-columns: 1fr 1fr; padding: 40px; gap: 40px; }
  .ks-section { padding: 96px 28px; }
}

@media (min-width: 1200px) {
  .ks-roles-all { grid-template-columns: repeat(5, 1fr); }
  .ks-section { padding: 104px 28px; }
}
`
