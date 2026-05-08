/**
 * ========================================
 * БЛОК: Landing — публичный лендинг КлиникСеть
 * ========================================
 * Этап 6 ROADMAP: редизайн в стиле /public/design2/klinikset.html.
 * Использует токены из /src/design/tokens.css (var(--accent), var(--fg), …).
 *
 * Сохранена функциональность:
 *   - LoginModal  (вход → редирект по роли)
 *   - ContactModal (форма «Получить демо» → POST /contact/)
 *   - scrollTo(id) для anchor-навигации
 *   - Скачивание Calls для Windows / macOS (Win 1.0.17 NSIS installer, Mac 1.0.7 arm64/x64)
 *
 * Структура секций (как в klinikset.html):
 *   Nav → Hero → StatsStrip → Roles (tabs) → Features (9 карточек)
 *   → Flow (28 дней) → Pricing (3 плана из BillingService) → Calls
 *   → CTA (14 дней триал) → Footer
 *
 * Расширение: добавить новую секцию → добавить <section> + стиль в LANDING_CSS.
 * ========================================
 */
import { useState, useEffect } from 'react'
import axios from 'axios'
import useAuthStore from '../store/auth'
import { API_BASE, SLUG } from '../config'

// ===== БЛОК: SVG-иконки (без внешней либы) =====
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
  check: <Icon d={<path d="M5 12l4 4 10-10"/>} size={14} />,
  close: <Icon d={<><path d="M6 6l12 12"/><path d="M18 6L6 18"/></>} />,
  menu: <Icon d={<><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></>} />,
  user: <Icon d={<><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></>} />,
  lock: <Icon d={<><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></>} />,
  eye: <Icon d={<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>} />,
  eyeOff: <Icon d={<><path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0112 6c6.5 0 10 6 10 6a13.8 13.8 0 01-3.5 4.1"/><path d="M6.1 6.1A13.6 13.6 0 002 12s3.5 6 10 6a9.7 9.7 0 005.3-1.5"/><circle cx="12" cy="12" r="3"/></>} />,
  phone: <Icon d={<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3.1-8.7A2 2 0 014 2h3a2 2 0 012 1.7c.1.9.3 1.8.6 2.6a2 2 0 01-.5 2.1L7.9 9.7a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.8.3 1.7.5 2.6.6a2 2 0 011.7 2z"/>} />,
  mail: <Icon d={<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>} />,
}

// ===== БЛОК: FadeIn (плавное появление) =====
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

// ===== БЛОК: LoginModal — единый вход, редирект по роли =====
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
      const { access_token, refresh_token, redirect_url, tenant_slug } = res.data
      const targetSlug = tenant_slug || SLUG || 'arc'
      const redirect = redirect_url || ('/' + targetSlug + '/')
      const isAdmin = redirect === '/admin' || redirect.endsWith('/admin')
      if (isAdmin) {
        const storageSlug = redirect === '/admin' ? '' : targetSlug
        localStorage.setItem('clinika_admin_token_' + storageSlug, access_token)
        // Сохраняем refresh-токен для auto-refresh
        if (refresh_token) localStorage.setItem('clinika_admin_refresh_token_' + storageSlug, refresh_token)
      } else {
        localStorage.setItem('clinika_token_' + targetSlug, access_token)
        if (refresh_token) localStorage.setItem('clinika_refresh_token_' + targetSlug, refresh_token)
      }
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
                value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
              <button type="button" className="ks-input-eye" onClick={() => setShowPass(p => !p)} aria-label="Показать пароль">
                {showPass ? ICONS.eyeOff : ICONS.eye}
              </button>
            </div>
          </label>
          <button type="submit" disabled={loading} className="ks-btn-primary ks-btn-block">
            {loading ? 'Вход…' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ===== БЛОК: ContactModal — форма «Получить демо» (POST /contact/) =====
function ContactModal({ onClose }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', message: '' })
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

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
              <h2>Создать клинику</h2>
              <p>Расскажите о вашей клинике — подключим за 14 дней</p>
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
                <span>Сообщение</span>
                <textarea rows={3} placeholder="Сколько клиник, врачей, какие задачи…"
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

// ===== БЛОК: Калькулятор тарифа =====
// Простая статическая форма: число клиник × план → стоимость в месяц.
function PriceCalculator({ onClose }) {
  const [clinics, setClinics] = useState(3)
  const [plan, setPlan] = useState('professional')

  useEffect(() => {
    const fn = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  // Цены из BillingService (PLAN_PRICES), за 1 клинику в месяц
  const PRICES = { basic: 9900, professional: 24900, enterprise: 49900 }
  const PLAN_NAMES = { basic: 'Solo', professional: 'Network', enterprise: 'Enterprise' }
  const total = PRICES[plan] * clinics
  const totalAnnual = total * 12 * 0.83  // -17% при оплате за год

  return (
    <div className="ks-modal-root" role="dialog" aria-modal="true">
      <div className="ks-modal-back" onClick={onClose} />
      <div className="ks-modal-card">
        <button onClick={onClose} className="ks-modal-close" aria-label="Закрыть">{ICONS.close}</button>
        <div className="ks-modal-head">
          <h2>Калькулятор тарифа</h2>
          <p>Подсчитайте стоимость для вашей сети</p>
        </div>
        <div className="ks-modal-body">
          <label className="ks-field">
            <span>План</span>
            <div className="ks-calc-tabs">
              {['basic', 'professional', 'enterprise'].map(p => (
                <button key={p} type="button"
                  className={`ks-calc-tab ${plan === p ? 'is-active' : ''}`}
                  onClick={() => setPlan(p)}>
                  {PLAN_NAMES[p]}
                </button>
              ))}
            </div>
          </label>
          <label className="ks-field">
            <span>Количество клиник: <strong>{clinics}</strong></span>
            <input type="range" min={1} max={50} value={clinics}
              onChange={e => setClinics(Number(e.target.value))}
              className="ks-calc-range" />
          </label>
          <div className="ks-calc-result">
            <div className="ks-calc-row">
              <span>В месяц</span>
              <strong>{total.toLocaleString('ru-RU')} ₽</strong>
            </div>
            <div className="ks-calc-row ks-calc-row-mute">
              <span>В год (со скидкой 17%)</span>
              <strong>{Math.round(totalAnnual).toLocaleString('ru-RU')} ₽</strong>
            </div>
          </div>
          <button onClick={onClose} className="ks-btn-primary ks-btn-block">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== БЛОК: главный компонент Landing =====
export default function Landing() {
  const [showLogin, setShowLogin] = useState(false)
  const [showContact, setShowContact] = useState(false)
  const [showCalc, setShowCalc] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeRole, setActiveRole] = useState('patient')

  const scrollTo = id => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
    setMenuOpen(false)
  }

  // ===== БЛОК: Роли (для табов в секции «Кабинеты») =====
  const ROLES = {
    patient: {
      label: 'Пациент', dot: 'oklch(0.7 0.15 25)',
      title: 'Кабинет пациента — все приёмы и анализы в одном окне',
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
      url: 'app.клиниксеть.рф / врач',
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
      url: 'app.клиниксеть.рф / управляющий',
    },
  }

  // ===== БЛОК: Все роли (короткое описание для grid под табами) =====
  const ALL_ROLES = [
    ['super_admin', 'Платформа', 'Глобальный admin: тенанты, биллинг, мониторинг, аудит-лог'],
    ['franchise_owner', 'Франчайзи', 'Владелец сети клиник: дашборд + биллинг по своим клиникам'],
    ['manager', 'Управляющий', 'Руководитель клиники: KPI, расписание, премии, отчёты'],
    ['doctor', 'Врач', 'ЭМК, расписание, протоколы, голосовой ввод, премии по KPI'],
    ['reg', 'Администратор', 'Регистратура: запись, оплаты, направления, кассовый контроль'],
    ['recruiter', 'Рекрутер', 'Подбор врачей, инвайты, KPI рекрутинга, воронка'],
  ]

  const r = ROLES[activeRole]

  // ===== БЛОК: 9 карточек «Возможности» (Material Symbols emoji) =====
  const FEATURES = [
    ['◐', 'Электронная медкарта', 'История приёмов, аллергии, протоколы. Шаблоны по специальностям.'],
    ['☰', 'Расписание сети', 'Слоты всех клиник в одном календаре. Синхронизация с врачами в реальном времени.'],
    ['◊', 'Бонусы и лояльность', 'Единый баланс на всю сеть, кешбэк по правилам, акции и купоны.'],
    ['₽', 'Биллинг и взаиморасчёты', 'Тарифы услуг, оплаты, эквайринг, расчёты между филиалами.'],
    ['◯', 'Чат и поддержка', 'Чаты с пациентами, операторская консоль, шаблоны ответов.'],
    ['⌕', 'AI-аналитика', 'Выручка, NPS, загрузка, конверсия — по каждой клинике и врачу.'],
    ['{ }', 'API и интеграции', '222+ эндпоинтов. 1С, СБИС, телефония, лаборатории — из коробки.'],
    ['◑', 'Мобильные приложения', 'Native iOS и Android для пациентов и врачей. White-label под бренд сети.'],
    ['⚿', 'Безопасность и 152-ФЗ', 'УЗ-1, шифрование медданных, аудит-лог, контроль доступа по ролям.'],
  ]

  // ===== БЛОК: 4 шага внедрения (раздел Flow) =====
  const FLOW = [
    ['Аудит сети', 'Изучаем процессы, текущие системы, требования к миграции. 3 дня.'],
    ['Настройка', 'Создаём пространства клиник, импортируем услуги, прайсы и врачей. 7 дней.'],
    ['Миграция данных', 'Переносим карты пациентов, историю приёмов и расписание. 10 дней.'],
    ['Запуск и обучение', 'Параллельный режим, тренинги для администраторов и врачей. 8 дней.'],
  ]

  // ===== БЛОК: Тарифные планы (PLAN_PRICES из BillingService) =====
  const PLANS = [
    {
      tier: 'Solo', name: 'Одна клиника', desc: 'Для отдельной клиники с 5–20 врачами',
      price: '9 900', unit: '/ мес. за клинику',
      list: ['ЭМК и расписание', 'Бонусы и лояльность', 'Базовая аналитика', 'Email-поддержка'],
      cta: 'Подключить', plan: 'basic',
    },
    {
      tier: 'Network', name: 'Малая сеть', desc: 'До 10 клиник под одним брендом', featured: true,
      price: '24 900', unit: '/ мес. за клинику',
      list: ['Всё из Solo', 'Дашборд сети', 'Биллинг между филиалами', 'API и интеграции', 'Менеджер внедрения'],
      cta: 'Создать клинику', plan: 'professional',
    },
    {
      tier: 'Enterprise', name: 'Крупная сеть', desc: '10+ клиник, white-label приложения',
      price: '49 900', unit: '/ мес. за клинику',
      list: ['Всё из Network', 'Native iOS/Android под бренд', 'SSO и SCIM', 'Приоритетный SLA', 'Выделенная команда'],
      cta: 'Связаться', plan: 'enterprise',
    },
  ]

  return (
    <>
      <style>{LANDING_CSS}</style>

      {/* ===== БЛОК: NAV (sticky, с burger-меню на мобиле) ===== */}
      <nav className="ks-nav">
        <div className="ks-nav-inner">
          <a className="ks-nav-logo" href="#"><span className="ks-nav-mark">⚕</span>КлиникСеть</a>
          <div className="ks-nav-links">
            {[
              ['features', 'Возможности'],
              ['roles', 'Кабинеты'],
              ['pricing', 'Тарифы'],
              ['calls', 'Calls'],
            ].map(([id, label]) => (
              <button key={id} onClick={() => scrollTo(id)} className="ks-nav-link">{label}</button>
            ))}
            <a href="/franchise" className="ks-nav-link">Франчайзи</a>
          </div>
          <div className="ks-nav-actions">
            <button onClick={() => setShowLogin(true)} className="ks-nav-link ks-nav-link-strong">Войти</button>
            <button onClick={() => setShowContact(true)} className="ks-nav-cta">Создать клинику</button>
          </div>
          <button className="ks-nav-burger" onClick={() => setMenuOpen(m => !m)} aria-label="Меню">
            {menuOpen ? ICONS.close : ICONS.menu}
          </button>
        </div>
        {menuOpen && (
          <div className="ks-nav-mobile">
            {[
              ['features', 'Возможности'],
              ['roles', 'Кабинеты'],
              ['pricing', 'Тарифы'],
              ['calls', 'Calls'],
            ].map(([id, label]) => (
              <button key={id} onClick={() => scrollTo(id)} className="ks-nav-mobile-link">{label}</button>
            ))}
            <a href="/franchise" className="ks-nav-mobile-link">Франчайзи</a>
            <button onClick={() => { setShowLogin(true); setMenuOpen(false) }} className="ks-nav-mobile-link">Войти</button>
            <button onClick={() => { setShowContact(true); setMenuOpen(false) }} className="ks-btn-primary ks-btn-block" style={{ marginTop: 8 }}>
              Создать клинику
            </button>
          </div>
        )}
      </nav>

      {/* ===== БЛОК: HERO (заголовок + CTA + AI-карточка) ===== */}
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
              без зоопарка интеграций. От одной клиники до федеральной сети.
            </p>
            <div className="ks-hero-actions">
              <button onClick={() => setShowContact(true)} className="ks-btn-primary">
                Создать клинику <span aria-hidden>{ICONS.arrow}</span>
              </button>
              <button onClick={() => setShowCalc(true)} className="ks-btn-secondary">
                Калькулятор тарифа
              </button>
            </div>
            {/* Calls download buttons (сохранены из старой версии) */}
            <div className="ks-hero-downloads">
              <a href="/downloads/KliniknetCalls-Setup-1.0.17.exe" download className="ks-btn-ghost">
                {ICONS.download} Calls Win 1.0.17
              </a>
              <a href="/downloads/KliniknetCalls-1.0.7-mac-arm64.zip" download className="ks-btn-ghost">
                {ICONS.download} Calls Mac 1.0.7
              </a>
            </div>
            <div className="ks-hero-trust">
              <span className="ks-hero-stars">★★★★★</span>
              <span>УЗ-1 · 152-ФЗ · 99.9% SLA · 222+ API-эндпоинтов</span>
            </div>
          </FadeIn>

          {/* Hero side — стилизованный дашборд */}
          <FadeIn delay={150} className="ks-hero-side">
            <div className="ks-persona-card">
              <div className="ks-persona-bg" aria-hidden />
              <div className="ks-persona-tag"><span className="ks-tag-dot" />AI · работает 24/7</div>
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
              </div>
            </div>
            <div className="ks-persona-quote">
              <strong>Каждую ночь анализирую загрузку всех клиник</strong> и подсвечиваю где теряется выручка — окна в расписании, простаивающие кабинеты, врачи с просадкой по NPS.
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ===== БЛОК: STATS STRIP ===== */}
      <div className="ks-stats">
        <div className="ks-stats-inner">
          {[
            ['10+', 'клиник в продакшене'],
            ['1.2 М', 'приёмов в год'],
            ['222+', 'API-эндпоинтов'],
            ['99.9%', 'SLA платформы'],
          ].map(([n, l]) => (
            <div key={l}>
              <div className="ks-stat-num">{n}</div>
              <div className="ks-stat-label">{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ===== БЛОК: ROLES (табы 3 ключевых + grid из 6 ролей) ===== */}
      <section id="roles" className="ks-section ks-roles">
        <div className="ks-section-inner">
          <header className="ks-section-head">
            <div className="ks-section-eyebrow">Кабинеты под каждую роль</div>
            <h2 className="ks-section-title">Один продукт — три рабочих места</h2>
            <p className="ks-section-sub">
              Пациент, врач и управляющий работают с разными представлениями одних и тех же данных.
              Без переключения систем и двойного ввода.
            </p>
          </header>

          {/* Табы */}
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

          {/* Grid из 6 ролей под основным табом */}
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

      {/* ===== БЛОК: FEATURES (9 карточек) ===== */}
      <section id="features" className="ks-section ks-features">
        <div className="ks-section-inner">
          <header className="ks-section-head">
            <div className="ks-section-eyebrow">Платформа</div>
            <h2 className="ks-section-title">Всё, что нужно медицинской сети</h2>
            <p className="ks-section-sub">9 модулей в одной системе. Включаются по тарифу — без долгих интеграций.</p>
          </header>
          <div className="ks-features-grid">
            {FEATURES.map(([icon, title, desc], i) => (
              <FadeIn key={title} delay={i * 30}>
                <div className="ks-feature-card">
                  <div className="ks-feature-icon">{icon}</div>
                  <h4>{title}</h4>
                  <p>{desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ===== БЛОК: FLOW (4 шага · 28 дней) ===== */}
      <section className="ks-section ks-flow">
        <div className="ks-section-inner">
          <header className="ks-section-head">
            <div className="ks-section-eyebrow">Внедрение за 4 недели</div>
            <h2 className="ks-section-title">От договора до первой записи — 28 дней</h2>
          </header>
          <div className="ks-flow-grid">
            {FLOW.map(([t, d], i) => (
              <div key={t} className="ks-flow-step">
                <div className="ks-flow-num">{i + 1}</div>
                <h5>{t}</h5>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== БЛОК: PRICING (3 плана из BillingService) ===== */}
      <section id="pricing" className="ks-section ks-pricing">
        <div className="ks-section-inner">
          <header className="ks-section-head">
            <div className="ks-section-eyebrow">Тарифы</div>
            <h2 className="ks-section-title">Платите за клиники, а не за пользователей</h2>
            <p className="ks-section-sub">
              Безлимитные пациенты, врачи и администраторы. Цена зависит только от количества клиник в сети.
            </p>
          </header>
          <div className="ks-pricing-grid">
            {PLANS.map(p => (
              <article key={p.tier} className={`ks-price-card ${p.featured ? 'is-featured' : ''}`}>
                <div className="ks-price-tier">{p.tier}</div>
                <div className="ks-price-name">{p.name}</div>
                <div className="ks-price-desc">{p.desc}</div>
                <div className="ks-price-amount">
                  <strong>{p.price} ₽</strong>
                  <span>{p.unit}</span>
                </div>
                <ul className="ks-price-list">
                  {p.list.map(l => <li key={l}>{l}</li>)}
                </ul>
                <button onClick={() => setShowContact(true)} className="ks-price-cta">{p.cta}</button>
              </article>
            ))}
          </div>
          <div className="ks-pricing-note">
            <button onClick={() => setShowCalc(true)} className="ks-btn-secondary">
              Открыть калькулятор тарифа {ICONS.arrow}
            </button>
          </div>
        </div>
      </section>

      {/* ===== БЛОК: CALLS (десктоп-приложение) ===== */}
      <section id="calls" className="ks-section ks-calls">
        <div className="ks-section-inner">
          <div className="ks-calls-card">
            <div className="ks-calls-text">
              <div className="ks-section-eyebrow">Десктоп-приложение</div>
              <h2 className="ks-section-title">КлиникСеть Calls — видеосвязь врача и пациента</h2>
              <p className="ks-section-sub">
                P2P-видеосвязь через ваш собственный coturn-сервер. Без сторонних облачных провайдеров.
                Версия 1.0.17 — фикс прокси WhatsApp (BasicAuth через app.on('login')).
              </p>
              <div className="ks-hero-actions" style={{ flexWrap: 'wrap' }}>
                <a href="/downloads/KliniknetCalls-Setup-1.0.17.exe" download className="ks-btn-primary">
                  {ICONS.download} Windows · 1.0.17
                </a>
                <a href="/downloads/KliniknetCalls-1.0.7-mac-arm64.zip" download className="ks-btn-secondary">
                  {ICONS.download} macOS Apple Silicon · 91 МБ
                </a>
                <a href="/downloads/KliniknetCalls-1.0.7-mac-x64.zip" download className="ks-btn-secondary">
                  {ICONS.download} macOS Intel · 96 МБ
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
                <div className="ks-preview-url">КлиникСеть Calls · 1.0.17</div>
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

      {/* ===== БЛОК: CTA (14 дней триал) ===== */}
      <section className="ks-cta">
        <div className="ks-cta-card">
          <h2>Начать бесплатно — 14 дней</h2>
          <p>Без банковской карты. Создадим тенант, импортируем услуги, запустим за 1 день. Покажем дашборд сети и проведём по кабинетам.</p>
          <div className="ks-cta-actions">
            <button onClick={() => setShowContact(true)} className="ks-btn-cta-primary">
              Начать бесплатно {ICONS.arrow}
            </button>
            <button onClick={() => setShowLogin(true)} className="ks-btn-cta-secondary">
              Уже клиент — войти
            </button>
          </div>
        </div>
      </section>

      {/* ===== БЛОК: FOOTER ===== */}
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
            <button onClick={() => scrollTo('pricing')}>Тарифы</button>
            <button onClick={() => scrollTo('calls')}>Calls</button>
          </div>
          <div className="ks-footer-col">
            <h6>Компания</h6>
            <a href="/franchise">Франчайзи</a>
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
      {showCalc && <PriceCalculator onClose={() => setShowCalc(false)} />}
    </>
  )
}

// ===== БЛОК: моки кабинетов для активного таба =====
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
          <span className="ks-chip ks-chip-accent">● live</span>
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
                <div style={{ fontSize: 13, fontWeight: 500, color: s === 'free' ? 'var(--fg-3)' : 'var(--fg)' }}>{n}</div>
                {k && <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{k}</div>}
              </div>
              {s === 'now' && <span className="ks-chip ks-chip-accent">сейчас</span>}
              {s === 'next' && <span className="ks-chip">следующий</span>}
              {s === 'done' && <span className="ks-chip ks-chip-good">готов</span>}
            </div>
          ))}
        </div>
      </div>
    )
  }
  // role === admin
  const bars = [62, 78, 88, 71, 95, 82, 90, 76, 88, 92, 84, 96]
  return (
    <div style={{ padding: 18, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Дашборд сети</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>12 клиник · апрель 2026</div>
        </div>
        <span className="ks-chip ks-chip-good">● online</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {[['Выручка', '14.8 М ₽', '+18%'], ['Приёмы', '12 408', '+12%'], ['NPS', '72', '+4'], ['Загрузка', '86%', '−2%']].map(([l, v, d]) => (
          <div key={l} className="ks-mock-tile" style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{v}</div>
            <div style={{ fontSize: 11, color: d.startsWith('−') ? 'var(--bad)' : 'var(--good)', marginTop: 2 }}>{d}</div>
          </div>
        ))}
      </div>
      <div className="ks-mock-tile" style={{ padding: '14px' }}>
        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 10 }}>Загрузка по клиникам · 12 мес</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
          {bars.map((h, i) => (
            <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: '4px 4px 0 0', background: i === bars.length - 2 ? 'var(--accent)' : 'oklch(0.85 0.05 240)' }} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ===== БЛОК: CSS (один <style> на всю страницу — токены из tokens.css) =====
const LANDING_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; font-family: var(--font-sans); color: var(--fg); background: var(--bg); -webkit-font-smoothing: antialiased; }
button { font-family: inherit; cursor: pointer; border: none; background: none; color: inherit; }
a { color: inherit; text-decoration: none; }

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
  display: flex; align-items: center; gap: 24px;
  padding: 14px 28px;
}
.ks-nav-logo {
  display: flex; align-items: center; gap: 10px;
  font-size: 18px; font-weight: 600; letter-spacing: -0.02em;
}
.ks-nav-mark {
  width: 30px; height: 30px; border-radius: 9px;
  background: linear-gradient(140deg, var(--accent), oklch(0.55 0.16 200));
  display: grid; place-items: center;
  color: #fff; font-weight: 700; font-size: 14px;
  box-shadow: 0 4px 10px oklch(0.55 0.16 240 / 0.3);
}
.ks-nav-links { display: flex; gap: 4px; margin-left: auto; }
.ks-nav-link {
  padding: 7px 14px; border-radius: 8px;
  font-size: 14px; font-weight: 500; color: var(--fg-2);
  transition: all 0.15s;
}
.ks-nav-link:hover { color: var(--fg); background: var(--bg-2); }
.ks-nav-link-strong { color: var(--fg); }
.ks-nav-actions { display: flex; gap: 8px; }
.ks-nav-cta {
  padding: 9px 18px; border-radius: 10px;
  background: var(--fg); color: #fff;
  font-size: 14px; font-weight: 600;
  transition: all 0.15s;
}
.ks-nav-cta:hover { background: var(--accent); }
.ks-nav-burger {
  display: none;
  padding: 6px; border-radius: 8px;
  color: var(--fg);
}
.ks-nav-mobile {
  display: none; flex-direction: column; gap: 4px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg);
}
.ks-nav-mobile-link {
  text-align: left;
  padding: 10px 14px; border-radius: 8px;
  font-size: 14px; font-weight: 500; color: var(--fg-2);
}
.ks-nav-mobile-link:hover { background: var(--bg-2); color: var(--fg); }

/* === HERO === */
.ks-hero {
  position: relative;
  padding: 88px 28px 64px;
  overflow: hidden;
  background:
    radial-gradient(ellipse 70% 60% at 80% -10%, oklch(0.94 0.06 240 / 0.7), transparent 60%),
    radial-gradient(ellipse 50% 50% at 10% 30%, oklch(0.96 0.05 200 / 0.5), transparent 60%);
}
.ks-hero-inner {
  max-width: 1240px; margin: 0 auto;
  display: grid; grid-template-columns: 1.05fr 0.95fr;
  gap: 64px; align-items: center;
}
.ks-eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 12px; border-radius: 999px;
  background: var(--accent-soft); color: var(--accent);
  font-size: 13px; font-weight: 500;
  border: 1px solid var(--accent-line);
}
.ks-eyebrow-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--good);
  box-shadow: 0 0 0 3px oklch(0.7 0.18 145 / 0.25);
}
.ks-hero-title {
  margin: 22px 0 22px;
  font-size: clamp(40px, 5.2vw, 64px);
  line-height: 1.04;
  letter-spacing: -0.035em;
  font-weight: 600;
}
.ks-hero-title em {
  font-style: normal;
  background: linear-gradient(120deg, var(--accent) 0%, oklch(0.55 0.16 200) 100%);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
}
.ks-hero-sub {
  font-size: 19px; line-height: 1.55; color: var(--fg-2);
  max-width: 540px; margin-bottom: 32px;
}
.ks-hero-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.ks-hero-downloads { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 22px; }
.ks-hero-trust {
  display: flex; align-items: center; gap: 14px;
  font-size: 13px; color: var(--fg-3);
}
.ks-hero-stars { color: oklch(0.75 0.15 80); letter-spacing: 1px; }

.ks-hero-side { position: relative; display: grid; gap: 16px; }
.ks-persona-card {
  position: relative;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  min-height: 460px;
  padding: 64px 22px 22px;
}
.ks-persona-bg {
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse 60% 60% at 80% 20%, oklch(0.94 0.07 240 / 0.6), transparent 60%),
    radial-gradient(ellipse 60% 60% at 20% 80%, oklch(0.92 0.06 200 / 0.5), transparent 60%),
    var(--surface);
  z-index: 0;
}
.ks-persona-tag {
  position: absolute; top: 16px; left: 16px;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 12px; border-radius: 999px;
  background: oklch(0.18 0.02 255 / 0.78);
  backdrop-filter: blur(10px);
  color: #fff; font-size: 12px; font-weight: 600;
  z-index: 1;
}
.ks-tag-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: oklch(0.78 0.18 145);
  animation: ks-pulse 2s ease-in-out infinite;
}
@keyframes ks-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }

.ks-persona-mock {
  position: relative; z-index: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  box-shadow: var(--shadow-sm);
  display: grid; gap: 14px;
}
.ks-persona-mock-row { display: flex; justify-content: space-between; align-items: flex-start; }
.ks-persona-mock-eyebrow { font-size: 11px; font-weight: 600; color: var(--accent); letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 4px; }
.ks-persona-mock-title { font-size: 15px; font-weight: 600; }
.ks-persona-kpi { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ks-persona-kpi-cell {
  background: var(--bg-1); border: 1px solid var(--border);
  border-radius: 10px; padding: 10px 12px;
}
.ks-persona-kpi-l { font-size: 11px; color: var(--fg-3); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
.ks-persona-kpi-v { font-size: 17px; font-weight: 600; }
.ks-persona-kpi-d { font-size: 11px; color: var(--good); margin-top: 2px; }
.ks-persona-kpi-d.is-down { color: var(--bad); }

.ks-persona-quote {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  font-size: 13.5px; line-height: 1.55; color: var(--fg-2);
  box-shadow: var(--shadow-sm);
}
.ks-persona-quote strong { color: var(--fg); font-weight: 600; }

/* === STATS === */
.ks-stats {
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 28px;
  background: var(--bg-1);
}
.ks-stats-inner {
  max-width: 1240px; margin: 0 auto;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 32px;
}
.ks-stat-num { font-size: 32px; font-weight: 600; letter-spacing: -0.02em; color: var(--fg); }
.ks-stat-label { font-size: 13px; color: var(--fg-3); margin-top: 4px; }

/* === SECTIONS === */
.ks-section { padding: 96px 28px; }
.ks-section-inner { max-width: 1240px; margin: 0 auto; }
.ks-section-head { max-width: 720px; margin-bottom: 56px; }
.ks-section-eyebrow {
  font-size: 13px; font-weight: 600; color: var(--accent);
  letter-spacing: 0.06em; text-transform: uppercase;
  margin-bottom: 14px;
}
.ks-section-title {
  font-size: clamp(32px, 4vw, 48px);
  line-height: 1.1; letter-spacing: -0.025em;
  font-weight: 600;
}
.ks-section-sub {
  font-size: 18px; color: var(--fg-2);
  margin-top: 14px; line-height: 1.55;
}

/* === ROLES === */
.ks-roles { background: var(--bg-1); }
.ks-roles-tabs {
  display: inline-flex; gap: 4px; padding: 5px;
  background: var(--bg);
  border-radius: 14px;
  border: 1px solid var(--border);
  margin-bottom: 28px;
  box-shadow: var(--shadow-sm);
}
.ks-roles-tab {
  padding: 9px 18px; border-radius: 10px;
  font-size: 14px; font-weight: 500; color: var(--fg-2);
  transition: all 0.15s;
  display: flex; align-items: center; gap: 8px;
}
.ks-roles-tab:hover { color: var(--fg); }
.ks-roles-tab[data-active="true"] { background: var(--fg); color: #fff; }
.ks-roles-tab-dot { width: 6px; height: 6px; border-radius: 50%; }

.ks-role-stage { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 56px; align-items: center; }
.ks-role-stage-text h3 {
  font-size: 32px; font-weight: 600;
  letter-spacing: -0.02em; line-height: 1.15;
  margin: 0 0 14px;
}
.ks-role-stage-text p {
  font-size: 17px; color: var(--fg-2);
  line-height: 1.55; margin: 0 0 24px;
}
.ks-role-features { display: grid; gap: 14px; margin-bottom: 28px; }
.ks-role-feature { display: flex; gap: 12px; align-items: flex-start; }
.ks-role-check {
  flex-shrink: 0;
  width: 22px; height: 22px; border-radius: 7px;
  background: var(--accent-soft); color: var(--accent);
  display: grid; place-items: center;
  margin-top: 1px;
}
.ks-role-feature strong { font-weight: 600; font-size: 15px; }
.ks-role-feature span { color: var(--fg-2); display: block; margin-top: 2px; font-size: 14px; }

.ks-role-preview {
  position: relative;
  border-radius: var(--radius-lg);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  min-height: 520px;
}
.ks-preview-chrome {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px;
  background: var(--bg-2);
  border-bottom: 1px solid var(--border);
}
.ks-preview-dots { display: flex; gap: 6px; }
.ks-preview-dots span { width: 10px; height: 10px; border-radius: 50%; background: var(--border-strong); }
.ks-preview-url {
  flex: 1;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 5px 12px;
  font-size: 12px; color: var(--fg-3);
  font-family: 'SF Mono', Consolas, monospace;
}
.ks-preview-body { background: var(--bg); }

.ks-roles-all {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}
.ks-role-card {
  display: flex; gap: 14px; align-items: flex-start;
  padding: 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: all 0.2s;
}
.ks-role-card:hover { border-color: var(--accent-line); box-shadow: var(--shadow-md); }
.ks-role-card-mark {
  flex-shrink: 0;
  width: 38px; height: 38px; border-radius: 11px;
  background: var(--accent-soft); color: var(--accent);
  display: grid; place-items: center;
  font-weight: 700; font-size: 16px;
}
.ks-role-card-name { font-size: 14.5px; font-weight: 600; color: var(--fg); margin-bottom: 2px; }
.ks-role-card-desc { font-size: 12.5px; color: var(--fg-3); line-height: 1.5; }

.ks-mock-tile {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
}

/* === CHIPS === */
.ks-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 500;
  background: var(--bg-2); color: var(--fg-2);
  border: 1px solid var(--border);
}
.ks-chip-good { background: var(--good-soft); color: var(--good); border-color: transparent; }
.ks-chip-warn { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
.ks-chip-bad  { background: var(--bad-soft);  color: var(--bad);  border-color: transparent; }
.ks-chip-accent { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-line); }

/* === FEATURES === */
.ks-features { background: var(--bg); }
.ks-features-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.ks-feature-card {
  padding: 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  transition: all 0.2s;
  height: 100%;
}
.ks-feature-card:hover { border-color: var(--accent-line); box-shadow: var(--shadow-md); transform: translateY(-2px); }
.ks-feature-icon {
  width: 44px; height: 44px; border-radius: 11px;
  background: var(--accent-soft); color: var(--accent);
  display: grid; place-items: center;
  font-size: 22px; margin-bottom: 18px;
}
.ks-feature-card h4 { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 8px; }
.ks-feature-card p  { font-size: 14.5px; color: var(--fg-2); line-height: 1.55; margin: 0; }

/* === FLOW === */
.ks-flow { background: var(--bg-1); }
.ks-flow-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
.ks-flow-step {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
}
.ks-flow-num {
  display: inline-grid; place-items: center;
  width: 36px; height: 36px; border-radius: 11px;
  background: var(--bg-1); border: 1px solid var(--border);
  font-size: 14px; font-weight: 600; color: var(--accent);
  margin-bottom: 16px;
  box-shadow: var(--shadow-sm);
}
.ks-flow-step h5 { font-size: 16px; font-weight: 600; margin: 0 0 6px; }
.ks-flow-step p  { font-size: 14px; color: var(--fg-2); line-height: 1.5; margin: 0; }

/* === PRICING === */
.ks-pricing { background: var(--bg); }
.ks-pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.ks-price-card {
  padding: 32px;
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
  transform: translateY(-6px);
}
.ks-price-tier { font-size: 13px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); margin-bottom: 8px; }
.ks-price-card.is-featured .ks-price-tier { color: oklch(0.78 0.12 240); }
.ks-price-name { font-size: 22px; font-weight: 600; letter-spacing: -0.015em; margin-bottom: 6px; }
.ks-price-desc { font-size: 14px; color: var(--fg-2); margin-bottom: 24px; line-height: 1.5; }
.ks-price-card.is-featured .ks-price-desc { color: oklch(0.75 0.02 250); }
.ks-price-amount { display: flex; align-items: baseline; gap: 6px; margin-bottom: 26px; }
.ks-price-amount strong { font-size: 40px; font-weight: 600; letter-spacing: -0.02em; }
.ks-price-amount span { font-size: 14px; color: var(--fg-3); }
.ks-price-card.is-featured .ks-price-amount span { color: oklch(0.7 0.02 250); }
.ks-price-list { list-style: none; padding: 0; margin: 0 0 28px; display: grid; gap: 11px; flex: 1; }
.ks-price-list li { font-size: 14px; line-height: 1.5; display: flex; gap: 10px; align-items: flex-start; }
.ks-price-list li::before { content: '✓'; color: var(--accent); font-weight: 700; flex-shrink: 0; }
.ks-price-card.is-featured .ks-price-list li::before { color: oklch(0.78 0.12 240); }
.ks-price-cta {
  padding: 12px; border-radius: 10px; font-size: 14px; font-weight: 600;
  border: 1px solid var(--border-strong);
  background: var(--surface); color: var(--fg);
  transition: all 0.15s;
}
.ks-price-cta:hover { background: var(--bg-2); }
.ks-price-card.is-featured .ks-price-cta { background: #fff; color: var(--fg); border-color: transparent; }
.ks-pricing-note { margin-top: 32px; text-align: center; }

/* === CALLS === */
.ks-calls { background: var(--bg-1); }
.ks-calls-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 28px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 32px;
  box-shadow: var(--shadow-md);
  align-items: start;
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

/* === BUTTONS === */
.ks-btn-primary {
  padding: 13px 22px; border-radius: 11px;
  background: var(--fg); color: #fff;
  font-size: 15px; font-weight: 600;
  display: inline-flex; align-items: center; gap: 8px;
  transition: all 0.15s;
  box-shadow: var(--shadow-md);
}
.ks-btn-primary:hover { background: var(--accent); transform: translateY(-1px); box-shadow: var(--shadow-lg); }
.ks-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
.ks-btn-secondary {
  padding: 13px 22px; border-radius: 11px;
  background: oklch(1 0 0 / 0.6); color: var(--fg);
  font-size: 15px; font-weight: 600;
  border: 1px solid var(--border-strong);
  transition: all 0.15s;
  display: inline-flex; align-items: center; gap: 8px;
}
.ks-btn-secondary:hover { background: var(--bg); border-color: var(--fg-2); }
.ks-btn-ghost {
  padding: 8px 14px; border-radius: 9px;
  background: transparent;
  font-size: 13px; font-weight: 500; color: var(--fg-2);
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--border);
  transition: all 0.15s;
}
.ks-btn-ghost:hover { background: var(--bg-2); color: var(--fg); }
.ks-btn-block { display: flex; width: 100%; justify-content: center; }

/* === CTA === */
.ks-cta {
  padding: 96px 28px;
  background:
    radial-gradient(ellipse 50% 70% at 80% 30%, oklch(0.94 0.07 240 / 0.6), transparent 65%),
    radial-gradient(ellipse 50% 70% at 20% 70%, oklch(0.95 0.05 200 / 0.5), transparent 65%),
    var(--bg-1);
}
.ks-cta-card {
  max-width: 1000px; margin: 0 auto;
  padding: 64px 56px;
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
  font-size: clamp(30px, 3.6vw, 44px); font-weight: 600;
  letter-spacing: -0.025em; line-height: 1.1;
  margin: 0 0 14px;
}
.ks-cta-card p {
  font-size: 17px; color: oklch(0.78 0.02 250);
  max-width: 580px; margin: 0 auto 28px; line-height: 1.55;
}
.ks-cta-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.ks-btn-cta-primary {
  padding: 14px 26px; border-radius: 11px;
  background: #fff; color: var(--fg);
  font-size: 15px; font-weight: 600;
  display: inline-flex; align-items: center; gap: 8px;
}
.ks-btn-cta-primary:hover { background: oklch(0.96 0.005 250); }
.ks-btn-cta-secondary {
  padding: 14px 26px; border-radius: 11px;
  background: oklch(1 0 0 / 0.10); color: #fff;
  font-size: 15px; font-weight: 600;
  border: 1px solid oklch(1 0 0 / 0.18);
}
.ks-btn-cta-secondary:hover { background: oklch(1 0 0 / 0.16); }

/* === FOOTER === */
.ks-footer {
  border-top: 1px solid var(--border);
  padding: 48px 28px 32px;
  background: var(--bg);
}
.ks-footer-inner {
  max-width: 1240px; margin: 0 auto;
  display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr; gap: 40px;
}
.ks-footer-col h6 {
  font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--fg-3); margin: 0 0 14px;
}
.ks-footer-col a, .ks-footer-col button, .ks-footer-col span {
  display: block; padding: 5px 0; font-size: 14px; color: var(--fg-2);
  text-align: left;
}
.ks-footer-col a:hover, .ks-footer-col button:hover { color: var(--fg); }
.ks-footer-tagline { font-size: 14px; color: var(--fg-2); line-height: 1.55; margin-top: 12px; max-width: 320px; }
.ks-footer-bottom {
  max-width: 1240px; margin: 32px auto 0;
  padding-top: 24px;
  border-top: 1px solid var(--border);
  display: flex; justify-content: space-between;
  font-size: 13px; color: var(--fg-3);
}

/* === MODALS === */
.ks-modal-root { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; padding: 16px; }
.ks-modal-back { position: absolute; inset: 0; background: oklch(0.18 0.014 220 / 0.45); backdrop-filter: blur(6px); }
.ks-modal-card {
  position: relative;
  width: 100%; max-width: 420px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 28px;
}
.ks-modal-close {
  position: absolute; top: 12px; right: 12px;
  width: 32px; height: 32px; border-radius: 8px;
  display: grid; place-items: center;
  color: var(--fg-3);
}
.ks-modal-close:hover { background: var(--bg-2); color: var(--fg); }
.ks-modal-head { text-align: center; margin-bottom: 20px; }
.ks-modal-mark {
  width: 48px; height: 48px; border-radius: 12px;
  background: linear-gradient(140deg, var(--accent), oklch(0.55 0.16 200));
  display: grid; place-items: center; margin: 0 auto 12px;
  color: #fff; font-size: 22px; font-weight: 700;
}
.ks-modal-head h2 { font-size: 22px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.02em; }
.ks-modal-head p  { font-size: 14px; color: var(--fg-2); margin: 0; }
.ks-modal-body { display: grid; gap: 14px; }
.ks-modal-success { text-align: center; }
.ks-modal-success h3 { font-size: 20px; font-weight: 600; margin: 14px 0 6px; }
.ks-modal-success p  { font-size: 14px; color: var(--fg-2); margin: 0 0 18px; }
.ks-success-mark {
  width: 56px; height: 56px; border-radius: 14px;
  background: var(--good-soft); color: var(--good);
  display: grid; place-items: center; margin: 0 auto;
}
.ks-form-error {
  background: var(--bad-soft); color: var(--bad);
  border: 1px solid var(--bad-soft);
  border-radius: 10px; padding: 10px 12px;
  font-size: 13px;
}
.ks-field { display: grid; gap: 6px; }
.ks-field > span {
  font-size: 13px; font-weight: 500; color: var(--fg-2);
}
.ks-field em { color: var(--bad); font-style: normal; }
.ks-input-wrap {
  position: relative;
  display: flex; align-items: center;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 10px;
  transition: all 0.15s;
}
.ks-input-wrap:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); background: var(--surface); }
.ks-input-icon { padding: 0 12px; color: var(--fg-3); display: flex; }
.ks-input-wrap input {
  flex: 1; padding: 11px 12px 11px 0;
  background: transparent; border: 0; outline: 0;
  font-size: 14.5px; color: var(--fg);
  font-family: inherit;
}
.ks-input-eye {
  padding: 0 12px; color: var(--fg-3);
}
.ks-input-eye:hover { color: var(--fg-2); }
.ks-field textarea {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 11px 12px;
  font-size: 14.5px; color: var(--fg);
  font-family: inherit; resize: vertical;
}
.ks-field textarea:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }

/* === CALCULATOR === */
.ks-calc-tabs {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px;
  padding: 4px;
  background: var(--bg-1);
  border-radius: 10px;
  border: 1px solid var(--border);
}
.ks-calc-tab {
  padding: 8px 12px; border-radius: 7px;
  font-size: 13px; font-weight: 500; color: var(--fg-2);
}
.ks-calc-tab.is-active { background: var(--fg); color: #fff; }
.ks-calc-range {
  width: 100%; accent-color: var(--accent);
}
.ks-calc-result {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  display: grid; gap: 8px;
}
.ks-calc-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 14px; }
.ks-calc-row strong { font-size: 18px; font-weight: 600; }
.ks-calc-row-mute { color: var(--fg-3); font-size: 13px; }
.ks-calc-row-mute strong { font-size: 14px; color: var(--fg-2); }

/* === RESPONSIVE === */
@media (max-width: 1100px) {
  .ks-features-grid { grid-template-columns: repeat(2, 1fr); }
  .ks-flow-grid { grid-template-columns: repeat(2, 1fr); }
  .ks-roles-all { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 900px) {
  .ks-hero-inner { grid-template-columns: 1fr; gap: 40px; }
  .ks-role-stage { grid-template-columns: 1fr; gap: 32px; }
  .ks-calls-card { grid-template-columns: 1fr; }
  .ks-pricing-grid { grid-template-columns: 1fr; }
  .ks-stats-inner { grid-template-columns: repeat(2, 1fr); gap: 20px; }
  .ks-footer-inner { grid-template-columns: 1fr 1fr; }
  .ks-price-card.is-featured { transform: none; }
}
@media (max-width: 700px) {
  .ks-section { padding: 64px 16px; }
  .ks-hero { padding: 48px 16px; }
  .ks-cta { padding: 64px 16px; }
  .ks-cta-card { padding: 40px 24px; }
  .ks-nav-links, .ks-nav-actions { display: none; }
  .ks-nav-burger { display: grid; place-items: center; margin-left: auto; }
  .ks-nav-mobile { display: flex; }
  .ks-features-grid { grid-template-columns: 1fr; }
  .ks-flow-grid { grid-template-columns: 1fr; }
  .ks-roles-all { grid-template-columns: 1fr; }
  .ks-roles-tabs { width: 100%; overflow-x: auto; }
}
`
