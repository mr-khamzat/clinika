/**
 * ========================================
 * БЛОК: Лендинг — стартовая страница
 * ========================================
 * Единая точка входа для всех ролей.
 * Секции: Hero → Stats → Боль → Возможности → Как работает →
 *         Для кого → Тарифы → Почему мы → CTA → Footer
 * ========================================
 */
import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import useAuthStore from '../store/auth'
import { API_BASE, BASE_PATH, SLUG } from '../config'

// ─── Хук для анимации появления при скролле ───
function useInView(threshold = 0.1) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVisible(true) },
      { threshold }
    )
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])
  return [ref, visible]
}

function FadeIn({ children, delay = 0, className = '' }) {
  const [ref, visible] = useInView()
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

// ─── Модальное окно входа ───
function LoginModal({ onClose }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { setToken, setUser } = useAuthStore()

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await axios.post(API_BASE + '/auth/login', { username, password })
      const { access_token, role, redirect_url, tenant_slug } = res.data
      const targetSlug = tenant_slug || SLUG
      localStorage.setItem('clinika_admin_token_' + targetSlug, access_token)
      window.location.href = redirect_url || ('/' + targetSlug + '/')
    } catch {
      setError('Неверный логин или пароль')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const fn = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-gradient-to-br from-blue-600 to-cyan-600 p-8 text-center text-white">
          <div className="w-16 h-16 bg-white/20 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-white text-3xl" style={{fontVariationSettings:"'FILL' 1"}}>health_and_safety</span>
          </div>
          <h2 className="font-bold text-2xl mb-1">Войти в систему</h2>
          <p className="text-blue-100 text-sm">Роль определится автоматически</p>
          <button onClick={onClose} className="absolute top-4 right-4 text-white/60 hover:text-white transition">
            <span className="material-symbols-outlined text-2xl">close</span>
          </button>
        </div>
        <div className="p-8">
          {error && (
            <div className="bg-red-50 border border-red-100 rounded-2xl p-4 mb-5 flex items-center gap-3">
              <span className="material-symbols-outlined text-red-500 text-lg flex-shrink-0" style={{fontVariationSettings:"'FILL' 1"}}>error</span>
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Логин</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xl">person</span>
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                  autoFocus
                  placeholder="Введите логин"
                  className="w-full border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-2xl pl-11 pr-4 py-3.5 text-gray-900 placeholder-gray-400 text-sm outline-none transition bg-gray-50 focus:bg-white"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Пароль</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xl">lock</span>
                <input
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="Введите пароль"
                  className="w-full border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-2xl pl-11 pr-11 py-3.5 text-gray-900 placeholder-gray-400 text-sm outline-none transition bg-gray-50 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                >
                  <span className="material-symbols-outlined text-xl">{showPass ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full h-14 bg-gradient-to-r from-blue-600 to-cyan-600 hover:opacity-90 disabled:opacity-50 text-white rounded-2xl font-bold text-base transition shadow-lg shadow-blue-100 flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Входим...</>
              ) : (
                <><span className="material-symbols-outlined" style={{fontVariationSettings:"'FILL' 1"}}>login</span>Войти</>
              )}
            </button>
          </form>
          <div className="mt-5 pt-5 border-t border-gray-100">
            <p className="text-center text-xs text-gray-400 mb-3">Единый вход для всех ролей</p>
            <div className="flex justify-center gap-2 flex-wrap">
              {[
                { l: 'Руководитель', c: 'bg-blue-50 text-blue-600 border-blue-100' },
                { l: 'Сотрудник', c: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
                { l: 'Партнёр', c: 'bg-violet-50 text-violet-600 border-violet-100' },
              ].map(b => (
                <span key={b.l} className={`text-xs border rounded-full px-3 py-1 font-medium ${b.c}`}>{b.l}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Модальное окно обратной связи ───
function ContactModal({ onClose }) {
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await axios.post(API_BASE + '/contact/', { phone, email, message })
      setSent(true)
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => {
    const fn = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition z-10">
          <span className="material-symbols-outlined text-2xl">close</span>
        </button>
        {sent ? (
          <div className="p-12 text-center">
            <div className="w-20 h-20 bg-emerald-50 rounded-3xl flex items-center justify-center mx-auto mb-5">
              <span className="material-symbols-outlined text-emerald-500 text-4xl" style={{fontVariationSettings:"'FILL' 1"}}>check_circle</span>
            </div>
            <h3 className="font-bold text-2xl text-gray-900 mb-2">Сообщение отправлено!</h3>
            <p className="text-gray-500 text-sm mb-6">Мы свяжемся с вами в ближайшее время</p>
            <button onClick={onClose} className="px-8 py-3 bg-blue-600 text-white rounded-2xl font-semibold hover:bg-blue-700 transition">Закрыть</button>
          </div>
        ) : (
          <>
            <div className="p-7 border-b border-gray-100">
              <h2 className="font-bold text-xl text-gray-900 mb-1">Написать нам</h2>
              <p className="text-gray-500 text-sm">Расскажите о вашей клинике — мы свяжемся и подберём решение</p>
            </div>
            <form onSubmit={handleSubmit} className="p-7 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Телефон *</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xl">phone</span>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} required placeholder="+7 (900) 000-00-00"
                    className="w-full border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-2xl pl-11 pr-4 py-3 text-gray-900 placeholder-gray-400 text-sm outline-none transition" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xl">mail</span>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@clinic.ru"
                    className="w-full border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-2xl pl-11 pr-4 py-3 text-gray-900 placeholder-gray-400 text-sm outline-none transition" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Сообщение *</label>
                <textarea value={message} onChange={e => setMessage(e.target.value)} required rows={4}
                  placeholder="Расскажите о вашей клинике и задаче..."
                  className="w-full border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-2xl px-4 py-3 text-gray-900 placeholder-gray-400 text-sm outline-none transition resize-none" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full h-12 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-2xl font-semibold text-sm transition flex items-center justify-center gap-2">
                {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <><span className="material-symbols-outlined text-lg" style={{fontVariationSettings:"'FILL' 1"}}>send</span>Отправить</>}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Основной компонент лендинга ───
export default function Landing() {
  const [showLogin, setShowLogin] = useState(false)
  const [showContact, setShowContact] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [billingCycle, setBillingCycle] = useState('monthly')

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
    setMenuOpen(false)
  }

  const PLANS = [
    {
      key: 'basic',
      name: 'Базовый',
      subtitle: 'Для старта и небольших клиник',
      price_monthly: 9900,
      price_annual: 99000,
      gradient: 'from-slate-600 to-slate-800',
      badge: null,
      bullets: [
        'До 3 клиник в сети',
        'До 50 сотрудников',
        'Направления пациентов и бонусы',
        'QR-регистрация партнёров',
        'Базовая аналитика и воронка',
        'Чат технической поддержки',
        'Личный кабинет партнёра',
        'Инвайт-ссылки для партнёров',
      ],
    },
    {
      key: 'professional',
      name: 'Профессиональный',
      subtitle: 'Полный функционал для растущей сети',
      price_monthly: 24900,
      price_annual: 249000,
      gradient: 'from-blue-600 to-cyan-600',
      badge: 'Популярный',
      bullets: [
        'До 15 клиник',
        'До 200 сотрудников',
        'Всё из Базового плана',
        'Интеграция с МИС (Renovatio и др.)',
        'Расписание врачей и онлайн-запись',
        'KPI и цели сотрудников',
        'SMS-уведомления пациентам',
        'Скидки и акции',
        'Финансовый реестр',
        'Аудит-лог всех действий',
        'Кастомный брендинг (цвета, логотип)',
      ],
    },
    {
      key: 'enterprise',
      name: 'Корпоративный',
      subtitle: 'Максимум возможностей и интеграций',
      price_monthly: 49900,
      price_annual: 499000,
      gradient: 'from-violet-600 to-violet-900',
      badge: 'Максимум',
      bullets: [
        'Неограниченное количество клиник',
        'Неограниченное количество сотрудников',
        'Всё из Профессионального плана',
        'White-label: ваш домен и полный брендинг',
        'REST API для внешних интеграций',
        'Вебхуки (Webhooks) для событий',
        'P2P видеозвонки между клиниками',
        'Мульти-тенант управление',
        'Приоритетная поддержка 24/7',
      ],
    },
  ]

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans overflow-x-hidden">

      {/* ══ NAV ══ */}
      <nav className="fixed top-0 inset-x-0 z-40 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center shadow-md shadow-blue-200">
              <span className="material-symbols-outlined text-white text-lg" style={{fontVariationSettings:"'FILL' 1"}}>health_and_safety</span>
            </div>
            <span className="font-bold text-lg">КлиникаСеть</span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm text-gray-500">
            {[['features','Возможности'],['how','Как работает'],['pricing','Тарифы'],['roles','Для кого']].map(([id,label]) => (
              <button key={id} onClick={() => scrollTo(id)} className="hover:text-blue-600 transition">{label}</button>
            ))}
            <button onClick={() => setShowContact(true)} className="hover:text-blue-600 transition">Контакты</button>
          </div>
          <div className="hidden md:flex items-center gap-3">
            <button onClick={() => setShowContact(true)}
              className="px-4 py-2 text-gray-600 hover:text-blue-600 rounded-xl text-sm font-medium transition">
              Написать нам
            </button>
            <button onClick={() => setShowLogin(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:opacity-90 text-white rounded-xl text-sm font-semibold transition shadow-md shadow-blue-100">
              <span className="material-symbols-outlined text-base" style={{fontVariationSettings:"'FILL' 1"}}>login</span>
              Войти
            </button>
          </div>
          <button className="md:hidden p-2" onClick={() => setMenuOpen(m => !m)}>
            <span className="material-symbols-outlined">{menuOpen ? 'close' : 'menu'}</span>
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden bg-white border-t border-gray-100 px-5 py-4 flex flex-col gap-3 text-sm">
            {[['features','Возможности'],['how','Как работает'],['pricing','Тарифы'],['roles','Для кого']].map(([id,label]) => (
              <button key={id} onClick={() => scrollTo(id)} className="text-left text-gray-700 py-1">{label}</button>
            ))}
            <button onClick={() => { setShowContact(true); setMenuOpen(false) }} className="text-left text-gray-700 py-1">Написать нам</button>
            <button onClick={() => { setShowLogin(true); setMenuOpen(false) }} className="mt-1 w-full py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-xl font-semibold text-center">Войти</button>
          </div>
        )}
      </nav>

      {/* ══ HERO ══ */}
      <section className="pt-28 pb-20 px-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-cyan-50" />
        <div className="absolute top-10 right-0 w-[700px] h-[700px] bg-blue-100/50 rounded-full blur-3xl -translate-y-1/4 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-cyan-100/40 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-full px-4 py-1.5 text-blue-600 text-sm font-medium mb-7">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"/>
              SaaS-платформа для медицинских сетей
            </div>
            <h1 className="font-bold text-5xl md:text-6xl lg:text-7xl leading-[1.05] mb-6 text-gray-900">
              Управляйте сетью клиник.<br/>
              <span className="bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
                Без хаоса. Без Excel.
              </span>
            </h1>
            <p className="text-gray-500 text-xl leading-relaxed mb-10 max-w-2xl">
              КлиникаСеть — готовая платформа для автоматизации направлений, бонусов, расписания врачей, аналитики и взаиморасчётов. Разворачивается за день. Работает для любой сети клиник.
            </p>
            <div className="flex flex-wrap gap-4 mb-14">
              <button onClick={() => setShowContact(true)}
                className="px-8 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 hover:opacity-90 text-white rounded-2xl font-semibold text-base transition shadow-xl shadow-blue-200 flex items-center gap-2">
                <span className="material-symbols-outlined" style={{fontVariationSettings:"'FILL' 1"}}>rocket_launch</span>
                Получить демо
              </button>
              <button onClick={() => scrollTo('how')}
                className="px-8 py-4 bg-white hover:bg-gray-50 text-gray-700 rounded-2xl font-semibold text-base transition border border-gray-200 shadow-sm flex items-center gap-2">
                <span className="material-symbols-outlined">play_circle</span>
                Как это работает
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              {[
                { icon: 'verified', text: 'Интеграция с МИС' },
                { icon: 'lock', text: '152-ФЗ защита данных' },
                { icon: 'bolt', text: 'Авто-бонусы' },
                { icon: 'schedule', text: 'Расписание врачей' },
                { icon: 'analytics', text: 'Аналитика в реальном времени' },
                { icon: 'support_agent', text: 'Поддержка 24/7' },
              ].map(b => (
                <div key={b.text} className="flex items-center gap-1.5 text-sm text-gray-500 bg-white border border-gray-100 rounded-full px-3 py-1.5 shadow-sm">
                  <span className="material-symbols-outlined text-blue-500 text-base" style={{fontVariationSettings:"'FILL' 1"}}>{b.icon}</span>
                  {b.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══ STATS ══ */}
      <section className="py-14 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            {[
              { n: '16+', label: 'Модулей платформы', sub: 'из коробки' },
              { n: '500+', label: 'Направлений в месяц', sub: 'у наших клиентов' },
              { n: '98%', label: 'Подтверждений МИС', sub: 'автоматически' },
              { n: '1 день', label: 'До запуска', sub: 'разворачивается быстро' },
            ].map((s, i) => (
              <FadeIn key={s.label} delay={i * 100}>
                <div className="text-center">
                  <div className="font-bold text-4xl md:text-5xl text-white mb-1">{s.n}</div>
                  <div className="font-semibold text-gray-200 text-sm">{s.label}</div>
                  <div className="text-gray-500 text-xs mt-0.5">{s.sub}</div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ══ PAIN → SOLUTION ══ */}
      <section id="features" className="py-24 px-5 bg-white">
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="text-center mb-16">
              <div className="inline-block bg-red-50 text-red-600 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">Знакомые проблемы?</div>
              <h2 className="font-bold text-4xl md:text-5xl text-gray-900 mb-4">
                Клиники теряют деньги<br className="hidden md:block"/> каждый день
              </h2>
              <p className="text-gray-500 text-lg max-w-2xl mx-auto">
                Ручной учёт, непрозрачные бонусы и разрозненные данные — это прямые финансовые потери.
              </p>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-2 gap-5 mb-20">
            {[
              { icon: 'sentiment_dissatisfied', color: 'text-red-500 bg-red-50', title: 'Направления теряются', desc: 'Бумажные направления теряются, пациенты не доходят, никто не знает почему. Вы платите за рекламу, но не видите результат.' },
              { icon: 'money_off', color: 'text-orange-500 bg-orange-50', title: 'Бонусы начисляются вручную', desc: 'Менеджер считает в Excel, сотрудники спорят о суммах, мотивация падает. Ошибки и задержки выплат разрушают доверие команды.' },
              { icon: 'visibility_off', color: 'text-purple-500 bg-purple-50', title: 'Нет контроля над партнёрами', desc: 'Вы не знаете сколько пациентов привёл каждый партнёр, какой канал работает, кому и сколько платить.' },
              { icon: 'sync_disabled', color: 'text-slate-500 bg-slate-50', title: 'МИС живёт отдельно', desc: 'Данные из медицинской системы не связаны с направлениями. Приходится вручную сверять записи и подтверждать визиты.' },
            ].map((p, i) => (
              <FadeIn key={p.title} delay={i * 80}>
                <div className="flex gap-5 p-6 bg-gray-50 rounded-3xl border border-gray-100 hover:shadow-md transition">
                  <div className={`w-12 h-12 rounded-2xl ${p.color} flex items-center justify-center flex-shrink-0`}>
                    <span className="material-symbols-outlined text-2xl" style={{fontVariationSettings:"'FILL' 1"}}>{p.icon}</span>
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-gray-900 mb-1.5">{p.title}</h3>
                    <p className="text-gray-500 text-sm leading-relaxed">{p.desc}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>

          {/* ── Разделитель ── */}
          <FadeIn>
            <div className="text-center mb-16">
              <div className="inline-flex flex-col items-center gap-2">
                <span className="text-gray-300 text-sm font-medium uppercase tracking-widest">КлиникаСеть решает это</span>
                <div className="flex flex-col items-center gap-1">
                  <div className="w-px h-8 bg-gradient-to-b from-gray-200 to-blue-400"/>
                  <div className="w-3 h-3 rounded-full bg-blue-500"/>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* ── Большая сетка модулей ── */}
          <div className="grid md:grid-cols-3 gap-5 mb-6">
            {[
              { icon: 'qr_code_2', color: 'from-blue-600 to-blue-500', shadow: 'shadow-blue-100', title: 'QR-направления', desc: 'Цифровые направления с уникальным QR-кодом. Сотрудник сканирует при визите — визит фиксируется мгновенно.', points: ['Мгновенная генерация', 'Сканирование за 2 сек', 'История всех визитов'] },
              { icon: 'auto_awesome', color: 'from-emerald-600 to-emerald-500', shadow: 'shadow-emerald-100', title: 'Автоматические бонусы', desc: 'Как только МИС подтверждает приём — бонусы начисляются всем участникам цепочки. Никакого Excel.', points: ['Начисление в момент визита', 'Прозрачная история', 'Экспорт для бухгалтерии'] },
              { icon: 'integration_instructions', color: 'from-cyan-600 to-cyan-500', shadow: 'shadow-cyan-100', title: 'Интеграция с МИС', desc: 'Подключаем Renovatio и другие МИС. Данные о приёмах поступают автоматически — не нужно ничего переносить вручную.', points: ['Renovatio, и другие МИС', 'API-подключение', 'Автосинхронизация врачей'] },
              { icon: 'calendar_month', color: 'from-indigo-600 to-indigo-500', shadow: 'shadow-indigo-100', title: 'Расписание врачей', desc: 'Шаблоны рабочих дней, онлайн-запись пациентов с проверкой конфликтов. Полный контроль загрузки врача.', points: ['Шаблоны расписания', 'Онлайн-запись', 'Управление записями'] },
              { icon: 'analytics', color: 'from-violet-600 to-violet-500', shadow: 'shadow-violet-100', title: 'Аналитика и KPI', desc: 'Воронка направлений, топ-сотрудники, сравнение клиник, динамика за любой период. Всё в одном дашборде.', points: ['Воронка в 4 шага', 'Рейтинг сотрудников', 'Сравнение клиник'] },
              { icon: 'hub', color: 'from-rose-600 to-rose-500', shadow: 'shadow-rose-100', title: 'Партнёрская сеть', desc: 'Приглашайте партнёров по ссылке. Они ведут пациентов — вы видите каждого в реальном времени и платите прозрачно.', points: ['Инвайт-ссылки', 'Личный кабинет партнёра', 'Telegram Mini App'] },
            ].map((f, i) => (
              <FadeIn key={f.title} delay={i * 80}>
                <div className={`bg-white rounded-3xl p-7 border border-gray-100 shadow-xl ${f.shadow} hover:-translate-y-1 transition-transform`}>
                  <div className={`w-14 h-14 rounded-3xl bg-gradient-to-br ${f.color} flex items-center justify-center mb-5 shadow-lg`}>
                    <span className="material-symbols-outlined text-white text-3xl" style={{fontVariationSettings:"'FILL' 1"}}>{f.icon}</span>
                  </div>
                  <h3 className="font-bold text-xl mb-2 text-gray-900">{f.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed mb-4">{f.desc}</p>
                  <ul className="space-y-1.5">
                    {f.points.map(pt => (
                      <li key={pt} className="flex items-center gap-2 text-sm text-gray-700">
                        <span className="material-symbols-outlined text-base text-emerald-500" style={{fontVariationSettings:"'FILL' 1"}}>check_circle</span>
                        {pt}
                      </li>
                    ))}
                  </ul>
                </div>
              </FadeIn>
            ))}
          </div>

          {/* ── Дополнительные модули ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: 'account_balance', color: 'bg-amber-50 text-amber-600', title: 'Финансовый реестр', desc: 'Append-only журнал всех операций' },
              { icon: 'manage_history', color: 'bg-slate-50 text-slate-600', title: 'Аудит-лог', desc: 'История действий каждого пользователя' },
              { icon: 'support_agent', color: 'bg-blue-50 text-blue-600', title: 'Чат поддержки', desc: 'Telegram-бот поддержки для ваших клиентов' },
              { icon: 'sms', color: 'bg-emerald-50 text-emerald-600', title: 'SMS-уведомления', desc: 'Оповещения пациентам через smsc.ru' },
              { icon: 'webhook', color: 'bg-violet-50 text-violet-600', title: 'Вебхуки', desc: 'Интеграции с любыми внешними системами' },
              { icon: 'domain', color: 'bg-cyan-50 text-cyan-600', title: 'White-label', desc: 'Ваш домен, ваш логотип, ваш цвет' },
              { icon: 'video_call', color: 'bg-rose-50 text-rose-600', title: 'P2P видеозвонки', desc: 'Связь между клиниками внутри платформы' },
              { icon: 'gpp_good', color: 'bg-green-50 text-green-600', title: '152-ФЗ', desc: 'Согласия на обработку, анонимизация' },
            ].map((m, i) => (
              <FadeIn key={m.title} delay={i * 50}>
                <div className="bg-white rounded-2xl p-5 border border-gray-100 hover:shadow-md transition">
                  <div className={`w-10 h-10 rounded-xl ${m.color} flex items-center justify-center mb-3`}>
                    <span className="material-symbols-outlined text-xl" style={{fontVariationSettings:"'FILL' 1"}}>{m.icon}</span>
                  </div>
                  <p className="font-bold text-sm text-gray-900 mb-0.5">{m.title}</p>
                  <p className="text-xs text-gray-500">{m.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ══ HOW IT WORKS ══ */}
      <section id="how" className="py-24 px-5 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="text-center mb-16">
              <div className="inline-block bg-blue-50 text-blue-600 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">Простой процесс</div>
              <h2 className="font-bold text-4xl md:text-5xl text-gray-900 mb-4">Как работает КлиникаСеть</h2>
              <p className="text-gray-500 text-lg max-w-2xl mx-auto">От направления до выплаты бонуса — всё автоматически</p>
            </div>
          </FadeIn>
          <div className="relative">
            <div className="hidden md:block absolute top-10 left-[12.5%] right-[12.5%] h-0.5 bg-gradient-to-r from-blue-200 via-cyan-200 to-emerald-200" />
            <div className="grid md:grid-cols-4 gap-6">
              {[
                { n:'01', icon:'person_add', color:'bg-blue-600', title:'Создание направления', desc:'Сотрудник или партнёр создаёт направление — вводит данные пациента и выбирает услугу' },
                { n:'02', icon:'qr_code', color:'bg-cyan-600', title:'QR-код пациенту', desc:'Пациент получает QR-код в Telegram. Предъявляет при визите в клинику' },
                { n:'03', icon:'qr_code_scanner', color:'bg-indigo-600', title:'Сканирование на стойке', desc:'Администратор сканирует QR — визит подтверждается в системе и МИС одновременно' },
                { n:'04', icon:'account_balance_wallet', color:'bg-emerald-600', title:'Автоначисление бонусов', desc:'Бонусы мгновенно начисляются всем: сотруднику, партнёру и руководителю' },
              ].map((s, i) => (
                <FadeIn key={s.n} delay={i * 120}>
                  <div className="flex flex-col items-center text-center">
                    <div className="relative mb-5">
                      <div className={`w-20 h-20 rounded-3xl ${s.color} flex items-center justify-center shadow-xl`}>
                        <span className="material-symbols-outlined text-white text-4xl" style={{fontVariationSettings:"'FILL' 1"}}>{s.icon}</span>
                      </div>
                      <div className="absolute -top-2 -right-2 w-7 h-7 bg-white border-2 border-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-500 shadow">
                        {s.n}
                      </div>
                    </div>
                    <h3 className="font-bold text-base text-gray-900 mb-2">{s.title}</h3>
                    <p className="text-gray-500 text-sm leading-relaxed">{s.desc}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══ PRICING ══ */}
      <section id="pricing" className="py-24 px-5 bg-white">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <div className="inline-block bg-blue-50 text-blue-600 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">Прозрачные цены</div>
              <h2 className="font-bold text-4xl md:text-5xl text-gray-900 mb-4">Тарифы под любую сеть</h2>
              <p className="text-gray-500 text-lg mb-8">Начните с базового тарифа — масштабируйтесь без переустановки</p>
              {/* Переключатель */}
              <div className="flex items-center justify-center gap-4">
                <span className={`text-sm font-semibold ${billingCycle === 'monthly' ? 'text-gray-900' : 'text-gray-400'}`}>Ежемесячно</span>
                <button onClick={() => setBillingCycle(c => c === 'monthly' ? 'annual' : 'monthly')}
                  className={`relative w-12 h-6 rounded-full transition-colors ${billingCycle === 'annual' ? 'bg-blue-600' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${billingCycle === 'annual' ? 'translate-x-6' : ''}`} />
                </button>
                <span className={`text-sm font-semibold ${billingCycle === 'annual' ? 'text-gray-900' : 'text-gray-400'}`}>Годовой</span>
                {billingCycle === 'annual' && (
                  <span className="text-xs font-bold bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full">Скидка ~17%</span>
                )}
              </div>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-6">
            {PLANS.map((plan, i) => {
              const monthly = billingCycle === 'annual'
                ? Math.round(plan.price_annual / 12)
                : plan.price_monthly
              const isPopular = plan.key === 'professional'
              return (
                <FadeIn key={plan.key} delay={i * 100}>
                  <div className={`relative bg-white rounded-3xl overflow-hidden flex flex-col transition-all ${isPopular ? 'ring-2 ring-blue-500 scale-[1.02] shadow-2xl shadow-blue-100' : 'border border-gray-100 shadow-lg hover:shadow-xl hover:scale-[1.01]'}`}>
                    {/* Шапка */}
                    <div className={`bg-gradient-to-br ${plan.gradient} p-7 text-white relative`}>
                      {plan.badge && (
                        <span className="absolute top-4 right-4 text-[10px] font-bold bg-white/20 backdrop-blur-sm px-2.5 py-1 rounded-full">
                          {plan.badge}
                        </span>
                      )}
                      <p className="text-xs font-bold uppercase tracking-widest opacity-80 mb-2">{plan.name}</p>
                      <div className="flex items-end gap-1 mb-1">
                        <span className="text-4xl font-extrabold">{monthly.toLocaleString('ru-RU')}</span>
                        <span className="text-sm opacity-70 mb-1.5">₽/мес</span>
                      </div>
                      {billingCycle === 'annual' && (
                        <p className="text-[11px] opacity-60">{plan.price_annual.toLocaleString('ru-RU')} ₽/год</p>
                      )}
                      <p className="text-xs opacity-70 mt-2">{plan.subtitle}</p>
                    </div>
                    {/* Буллеты */}
                    <div className="p-6 flex-1 flex flex-col">
                      <ul className="space-y-2.5 flex-1 mb-6">
                        {plan.bullets.map((b, bi) => (
                          <li key={bi} className="flex items-start gap-2.5 text-sm text-gray-700">
                            <span className="material-symbols-outlined text-emerald-500 text-base flex-shrink-0 mt-0.5" style={{fontVariationSettings:"'FILL' 1"}}>check_circle</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                      <button onClick={() => setShowContact(true)}
                        className={`w-full py-3 rounded-2xl text-sm font-bold transition text-white bg-gradient-to-br ${plan.gradient} hover:opacity-90`}>
                        Подключить
                      </button>
                    </div>
                  </div>
                </FadeIn>
              )
            })}
          </div>
          <FadeIn>
            <p className="text-center text-sm text-gray-400 mt-8">
              Все тарифы включают бесплатный пробный период 14 дней · Без скрытых платежей · Отмена в любое время
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ══ FOR WHOM ══ */}
      <section id="roles" className="py-24 px-5 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="text-center mb-16">
              <div className="inline-block bg-violet-50 text-violet-600 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">Для каждой роли</div>
              <h2 className="font-bold text-4xl md:text-5xl text-gray-900 mb-4">Каждый получает своё</h2>
              <p className="text-gray-500 text-lg">Один вход — система сама определяет, что показать именно вам</p>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon:'admin_panel_settings', gradient:'from-blue-600 to-blue-700', bg:'bg-blue-50', border:'border-blue-100', tag:'Руководитель', tagColor:'bg-blue-600 text-white',
                title:'Полный контроль над сетью', subtitle:'Для владельцев и управляющих',
                items:['Сводная аналитика по всем клиникам','Управление ставками бонусов и KPI','Финансовые отчёты и реестр','Аудит-лог всех действий','Создание сотрудников и партнёров','Расписание врачей и нагрузка'] },
              { icon:'badge', gradient:'from-emerald-600 to-emerald-700', bg:'bg-emerald-50', border:'border-emerald-100', tag:'Сотрудник', tagColor:'bg-emerald-600 text-white',
                title:'Больше зарабатывайте', subtitle:'Для администраторов клиник',
                items:['Создание направлений за минуту','QR-сканирование при визите пациента','Личный кабинет с бонусами и KPI','История направлений и статусы','Мобильное приложение через Telegram','Уведомления и напоминания'] },
              { icon:'handshake', gradient:'from-violet-600 to-violet-700', bg:'bg-violet-50', border:'border-violet-100', tag:'Партнёр', tagColor:'bg-violet-600 text-white',
                title:'Зарабатывайте на рекомендациях', subtitle:'Для внешних партнёров',
                items:['Запись пациентов в 2 клика','Отслеживание статусов в реальном времени','Прозрачные бонусы за каждого пациента','Личная история всех направлений','Мини-приложение прямо в Telegram','Приглашение по ссылке без лишних шагов'] },
            ].map((r, i) => (
              <FadeIn key={r.tag} delay={i * 120}>
                <div className={`rounded-3xl border ${r.border} overflow-hidden hover:shadow-xl transition-shadow`}>
                  <div className={`bg-gradient-to-br ${r.gradient} p-7 text-white`}>
                    <span className="material-symbols-outlined text-4xl mb-4 block" style={{fontVariationSettings:"'FILL' 1"}}>{r.icon}</span>
                    <div className="text-white/70 text-xs font-bold uppercase tracking-widest mb-1">{r.subtitle}</div>
                    <h3 className="font-bold text-2xl leading-tight">{r.title}</h3>
                  </div>
                  <div className={`${r.bg} p-7`}>
                    <ul className="space-y-3">
                      {r.items.map(item => (
                        <li key={item} className="flex items-start gap-3 text-sm text-gray-700">
                          <span className="material-symbols-outlined text-base text-gray-400 mt-0.5 flex-shrink-0" style={{fontVariationSettings:"'FILL' 1"}}>check_circle</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                    <button onClick={() => setShowLogin(true)}
                      className={`mt-6 w-full py-3 rounded-2xl font-semibold text-sm ${r.tagColor} hover:opacity-90 transition flex items-center justify-center gap-2`}>
                      <span className="material-symbols-outlined text-base" style={{fontVariationSettings:"'FILL' 1"}}>login</span>
                      Войти как {r.tag.toLowerCase()}
                    </button>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ══ WHY US ══ */}
      <section className="py-24 px-5 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="text-center mb-16">
              <div className="inline-block bg-white/10 text-white text-sm font-semibold px-4 py-1.5 rounded-full mb-4">Почему именно мы</div>
              <h2 className="font-bold text-4xl md:text-5xl mb-4">Не просто CRM.<br/>Готовая экосистема.</h2>
              <p className="text-gray-400 text-lg max-w-2xl mx-auto">
                КлиникаСеть — это не набор инструментов. Это единая платформа, где все части работают вместе с первого дня.
              </p>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: 'bolt', title: 'Запуск за 1 день', desc: 'Заполните данные своей клиники — система готова к работе. Не нужно ждать разработчиков или настраивать серверы.' },
              { icon: 'layers', title: 'Всё в одном', desc: 'МИС-интеграция, расписание, бонусы, аналитика, KPI, аудит, биллинг — одна подписка, один кабинет, одна команда поддержки.' },
              { icon: 'trending_up', title: 'Масштабируется с вами', desc: 'Начните с 1 клиники. Добавляйте клиники, сотрудников, партнёров — платформа растёт без переустановки.' },
              { icon: 'lock', title: 'Безопасность по 152-ФЗ', desc: 'Согласия на обработку ПД, журнал аудита, шифрование данных, раздельное хранение по тенантам.' },
              { icon: 'support_agent', title: 'Поддержка в Telegram', desc: 'Ваши клиенты пишут в Telegram-бот — вы получаете вопросы прямо в чат. Никаких лишних инструментов.' },
              { icon: 'api', title: 'Открытый API', desc: 'REST API и вебхуки для интеграции с любыми внешними системами. Полная документация по эндпоинтам.' },
            ].map((w, i) => (
              <FadeIn key={w.title} delay={i * 80}>
                <div className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-3xl p-7 transition">
                  <div className="w-12 h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center mb-5">
                    <span className="material-symbols-outlined text-blue-400 text-2xl" style={{fontVariationSettings:"'FILL' 1"}}>{w.icon}</span>
                  </div>
                  <h3 className="font-bold text-lg mb-2 text-white">{w.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">{w.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ══ CTA BANNER ══ */}
      <section className="py-20 px-5 bg-gradient-to-br from-blue-600 to-cyan-600 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <FadeIn>
            <span className="material-symbols-outlined text-5xl mb-5 block text-white/80" style={{fontVariationSettings:"'FILL' 1"}}>rocket_launch</span>
            <h2 className="font-bold text-4xl md:text-5xl mb-5">
              Готовы автоматизировать<br/>вашу медицинскую сеть?
            </h2>
            <p className="text-white/80 text-lg mb-10 max-w-xl mx-auto">
              Подключим вашу клинику, настроим интеграцию с МИС и обучим команду. Первые 14 дней — бесплатно.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button onClick={() => setShowContact(true)}
                className="px-8 py-4 bg-white text-blue-600 rounded-2xl font-bold text-base hover:bg-blue-50 transition shadow-xl flex items-center justify-center gap-2">
                <span className="material-symbols-outlined" style={{fontVariationSettings:"'FILL' 1"}}>chat</span>
                Написать нам
              </button>
              <button onClick={() => setShowLogin(true)}
                className="px-8 py-4 bg-white/10 border border-white/30 text-white rounded-2xl font-bold text-base hover:bg-white/20 transition flex items-center justify-center gap-2">
                <span className="material-symbols-outlined" style={{fontVariationSettings:"'FILL' 1"}}>login</span>
                Войти в систему
              </button>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ══ FOOTER ══ */}
      <footer className="py-10 px-5 bg-gray-950 text-gray-400">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-lg" style={{fontVariationSettings:"'FILL' 1"}}>health_and_safety</span>
            </div>
            <div>
              <div className="font-bold text-white text-sm">КлиникаСеть</div>
              <div className="text-xs text-gray-500">SaaS-платформа для медицинских сетей</div>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-5 text-sm">
            {[['features','Возможности'],['how','Как работает'],['pricing','Тарифы'],['roles','Роли']].map(([id,l]) => (
              <button key={id} onClick={() => scrollTo(id)} className="hover:text-white transition">{l}</button>
            ))}
            <button onClick={() => setShowContact(true)} className="hover:text-white transition">Контакты</button>
          </div>
          <p className="text-xs text-gray-600">© 2026 КлиникаСеть. Все права защищены.</p>
        </div>
      </footer>

      {/* ══ МОДАЛИ ══ */}
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      {showContact && <ContactModal onClose={() => setShowContact(false)} />}
    </div>
  )
}
