import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import useAuthStore from '../store/auth'
import { API_BASE, BASE_PATH, SLUG } from '../config'

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
    <div ref={ref}
      className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

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
      const targetSlug = tenant_slug || SLUG || 'arc'
      const redirect = redirect_url || ('/' + targetSlug + '/')
      const isAdminPanel = redirect === '/admin' || redirect.endsWith('/admin')
      if (isAdminPanel) {
        const storageSlug = redirect === '/admin' ? '' : targetSlug
        localStorage.setItem('clinika_admin_token_' + storageSlug, access_token)
      } else {
        localStorage.setItem('clinika_token_' + targetSlug, access_token)
      }
      window.location.href = redirect
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
        <div className="bg-gradient-to-br from-[#0A2342] to-[#1a5276] p-8 text-center text-white">
          <div className="w-16 h-16 bg-white/20 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-white text-3xl" style={{fontVariationSettings:"'FILL' 1"}}>health_and_safety</span>
          </div>
          <h2 className="font-bold text-2xl mb-1">Войти в систему</h2>
          <p className="text-blue-200 text-sm">Роль определится автоматически</p>
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
                <input type="text" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)}
                  required autoFocus placeholder="Введите логин"
                  className="w-full border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-2xl pl-11 pr-4 py-3.5 text-gray-900 placeholder-gray-400 text-sm outline-none transition bg-gray-50 focus:bg-white" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Пароль</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xl">lock</span>
                <input type={showPass ? 'text' : 'password'} autoComplete="current-password" value={password}
                  onChange={e => setPassword(e.target.value)} required placeholder="Введите пароль"
                  className="w-full border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-2xl pl-11 pr-11 py-3.5 text-gray-900 placeholder-gray-400 text-sm outline-none transition bg-gray-50 focus:bg-white" />
                <button type="button" onClick={() => setShowPass(s => !s)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition">
                  <span className="material-symbols-outlined text-xl">{showPass ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading}
              className="w-full h-14 bg-gradient-to-r from-[#0A2342] to-[#1a6b8a] hover:opacity-90 disabled:opacity-50 text-white rounded-2xl font-bold text-base transition shadow-lg flex items-center justify-center gap-2 mt-2">
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
                { l: 'Пациент', c: 'bg-teal-50 text-teal-600 border-teal-100' },
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

function ContactModal({ onClose }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await axios.post(API_BASE + '/contact/', { name, phone, email, message })
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
            <button onClick={onClose} className="px-8 py-3 bg-[#0A2342] text-white rounded-2xl font-semibold hover:opacity-90 transition">Закрыть</button>
          </div>
        ) : (
          <>
            <div className="p-7 border-b border-gray-100">
              <h2 className="font-bold text-xl text-gray-900 mb-1">Написать нам</h2>
              <p className="text-gray-500 text-sm">Расскажите о вашей клинике — мы свяжемся и подберём решение</p>
            </div>
            <form onSubmit={handleSubmit} className="p-7 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Имя *</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xl">person</span>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="Иван Иванов"
                    className="w-full border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-2xl pl-11 pr-4 py-3 text-gray-900 placeholder-gray-400 text-sm outline-none transition" />
                </div>
              </div>
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
                className="w-full h-12 bg-[#0A2342] hover:opacity-90 disabled:opacity-50 text-white rounded-2xl font-semibold text-sm transition flex items-center justify-center gap-2">
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
        'Личный кабинет пациента (OTP-вход)',
        'Базовая аналитика и воронка',
        'Чат технической поддержки',
        'Инвайт-ссылки для партнёров',
      ],
    },
    {
      key: 'professional',
      name: 'Профессиональный',
      subtitle: 'Полный функционал для растущей сети',
      price_monthly: 24900,
      price_annual: 249000,
      gradient: 'from-[#0A2342] to-[#1a6b8a]',
      badge: 'Популярный',
      bullets: [
        'До 15 клиник',
        'До 200 сотрудников',
        'Всё из Базового плана',
        'Интеграция с МИС (Renovatio и др.)',
        'Расписание врачей и онлайн-запись',
        'Рейтинги и отзывы врачей с модерацией',
        'Публичная страница клиники',
        'Кастомный брендинг (цвета, логотип)',
        'KPI и цели сотрудников',
        'SMS-уведомления пациентам',
        'Финансовый реестр',
        'Аудит-лог всех действий',
      ],
    },
    {
      key: 'enterprise',
      name: 'Корпоративный',
      subtitle: 'Максимум: франшиза, домен, интеграции',
      price_monthly: 49900,
      price_annual: 499000,
      gradient: 'from-violet-700 to-violet-900',
      badge: 'Максимум',
      bullets: [
        'Неограниченное количество клиник',
        'Неограниченное количество сотрудников',
        'Всё из Профессионального плана',
        'White-label: ваш домен (CNAME) и полный брендинг',
        'Кабинет владельца франшизы и роялти',
        'Модули AI-аналитики и телефонии',
        'REST API и вебхуки для интеграций',
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
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0A2342] to-[#1a6b8a] flex items-center justify-center shadow-md">
              <span className="material-symbols-outlined text-white text-lg" style={{fontVariationSettings:"'FILL' 1"}}>health_and_safety</span>
            </div>
            <span className="font-bold text-lg">КлиникСеть</span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm text-gray-500">
            {[['features','Возможности'],['patient','Пациентам'],['how','Как работает'],['pricing','Тарифы'],['roles','Для кого']].map(([id,label]) => (
              <button key={id} onClick={() => scrollTo(id)} className="hover:text-[#0A2342] transition">{label}</button>
            ))}
            <button onClick={() => setShowContact(true)} className="hover:text-[#0A2342] transition">Контакты</button>
          </div>
          <div className="hidden md:flex items-center gap-3">
            <button onClick={() => setShowContact(true)}
              className="px-4 py-2 text-gray-600 hover:text-[#0A2342] rounded-xl text-sm font-medium transition">
              Написать нам
            </button>
            <button onClick={() => setShowLogin(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-[#0A2342] to-[#1a6b8a] hover:opacity-90 text-white rounded-xl text-sm font-semibold transition shadow-md">
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
            {[['features','Возможности'],['patient','Пациентам'],['how','Как работает'],['pricing','Тарифы'],['roles','Для кого']].map(([id,label]) => (
              <button key={id} onClick={() => scrollTo(id)} className="text-left text-gray-700 py-1">{label}</button>
            ))}
            <button onClick={() => { setShowContact(true); setMenuOpen(false) }} className="text-left text-gray-700 py-1">Написать нам</button>
            <button onClick={() => { setShowLogin(true); setMenuOpen(false) }} className="mt-1 w-full py-2.5 bg-gradient-to-r from-[#0A2342] to-[#1a6b8a] text-white rounded-xl font-semibold text-center">Войти</button>
          </div>
        )}
      </nav>

      {/* ══ HERO ══ */}
      <section className="pt-28 pb-20 px-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-blue-50" />
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-[#0A2342]/5 rounded-full blur-3xl -translate-y-1/4 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-teal-100/40 rounded-full blur-3xl" />
        <div className="relative max-w-7xl mx-auto">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 bg-[#0A2342]/5 border border-[#0A2342]/10 rounded-full px-4 py-1.5 text-[#0A2342] text-sm font-medium mb-7">
              <span className="w-2 h-2 bg-[#0A2342] rounded-full animate-pulse"/>
              Платформа-франшиза для медицинских сетей
            </div>
            <h1 className="font-bold text-5xl md:text-6xl lg:text-7xl leading-[1.05] mb-6 text-gray-900">
              От регистратуры<br/>до пациента —
              <br/>
              <span className="bg-gradient-to-r from-[#0A2342] to-[#1a8fa8] bg-clip-text text-transparent">
                в одной платформе.
              </span>
            </h1>
            <p className="text-gray-500 text-xl leading-relaxed mb-10 max-w-2xl">
              КлиникСеть — готовая экосистема: управление сетью клиник, личный кабинет пациента с OTP-входом, рейтинги врачей, white-label брендинг и кастомный домен. Разворачивается за день.
            </p>
            <div className="flex flex-wrap gap-4 mb-14">
              <button onClick={() => setShowContact(true)}
                className="px-8 py-4 bg-gradient-to-r from-[#0A2342] to-[#1a6b8a] hover:opacity-90 text-white rounded-2xl font-semibold text-base transition shadow-xl flex items-center gap-2">
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
                { icon: 'person', text: 'Кабинет пациента' },
                { icon: 'star', text: 'Рейтинги врачей' },
                { icon: 'domain', text: 'Кастомный домен' },
                { icon: 'integration_instructions', text: 'Интеграция с МИС' },
                { icon: 'lock', text: '152-ФЗ защита данных' },
                { icon: 'analytics', text: 'Аналитика в реальном времени' },
              ].map(b => (
                <div key={b.text} className="flex items-center gap-1.5 text-sm text-gray-500 bg-white border border-gray-100 rounded-full px-3 py-1.5 shadow-sm">
                  <span className="material-symbols-outlined text-[#0A2342] text-base" style={{fontVariationSettings:"'FILL' 1"}}>{b.icon}</span>
                  {b.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══ STATS ══ */}
      <section className="py-14 bg-[#0A2342] text-white">
        <div className="max-w-7xl mx-auto px-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            {[
              { n: '12+', label: 'Ролей пользователей', sub: 'каждый получает свой кабинет' },
              { n: '500+', label: 'Направлений в месяц', sub: 'у наших клиентов' },
              { n: '98%', label: 'Подтверждений МИС', sub: 'автоматически' },
              { n: '1 день', label: 'До запуска', sub: 'разворачивается быстро' },
            ].map((s, i) => (
              <FadeIn key={s.label} delay={i * 100}>
                <div className="text-center">
                  <div className="font-bold text-4xl md:text-5xl text-white mb-1">{s.n}</div>
                  <div className="font-semibold text-blue-200 text-sm">{s.label}</div>
                  <div className="text-blue-400 text-xs mt-0.5">{s.sub}</div>
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
              { icon: 'person_off', color: 'text-slate-500 bg-slate-50', title: 'Пациент не возвращается', desc: 'Нет личного кабинета, нет истории визитов, нет рейтингов врачей. Пациент уходит к конкурентам у которых есть онлайн-запись.' },
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

          <FadeIn>
            <div className="text-center mb-16">
              <div className="inline-flex flex-col items-center gap-2">
                <span className="text-gray-300 text-sm font-medium uppercase tracking-widest">КлиникСеть решает это</span>
                <div className="flex flex-col items-center gap-1">
                  <div className="w-px h-8 bg-gradient-to-b from-gray-200 to-[#0A2342]"/>
                  <div className="w-3 h-3 rounded-full bg-[#0A2342]"/>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Основные модули */}
          <div className="grid md:grid-cols-3 gap-5 mb-6">
            {[
              { icon: 'person', color: 'from-teal-600 to-teal-500', shadow: 'shadow-teal-100',
                title: 'Личный кабинет пациента',
                desc: 'Пациент входит по номеру телефона через OTP-код. Видит историю записей, может самостоятельно записаться к врачу и оставить отзыв.',
                points: ['OTP-вход по телефону', 'История визитов и направлений', 'Онлайн-запись к врачу'] },
              { icon: 'star', color: 'from-amber-500 to-orange-500', shadow: 'shadow-amber-100',
                title: 'Рейтинги и отзывы врачей',
                desc: 'Пациенты оставляют отзывы прямо из кабинета. Руководитель модерирует — одобряет или отклоняет. Рейтинги видны всем посетителям.',
                points: ['Отзывы с оценкой от 1 до 5 ★', 'Модерация до публикации', 'Публичная страница клиники'] },
              { icon: 'qr_code_2', color: 'from-[#0A2342] to-[#1a5276]', shadow: 'shadow-blue-100',
                title: 'QR-направления',
                desc: 'Цифровые направления с уникальным QR-кодом. Сотрудник сканирует при визите — визит фиксируется мгновенно и автоматически.',
                points: ['Мгновенная генерация', 'Сканирование за 2 сек', 'История всех визитов'] },
              { icon: 'auto_awesome', color: 'from-emerald-600 to-emerald-500', shadow: 'shadow-emerald-100',
                title: 'Автоматические бонусы',
                desc: 'Как только МИС подтверждает приём — бонусы начисляются всем участникам цепочки. Никакого Excel.',
                points: ['Начисление в момент визита', 'Прозрачная история', 'Экспорт для бухгалтерии'] },
              { icon: 'analytics', color: 'from-violet-600 to-violet-500', shadow: 'shadow-violet-100',
                title: 'Аналитика и KPI',
                desc: 'Воронка направлений, топ-сотрудники, сравнение клиник, динамика за любой период. Всё в одном дашборде.',
                points: ['Воронка в 4 шага', 'Рейтинг сотрудников', 'Пресеты за 7/30/90/365 дней'] },
              { icon: 'integration_instructions', color: 'from-cyan-600 to-cyan-500', shadow: 'shadow-cyan-100',
                title: 'Интеграция с МИС',
                desc: 'Подключаем Renovatio и другие МИС. Данные о приёмах поступают автоматически — не нужно ничего переносить вручную.',
                points: ['Renovatio и другие МИС', 'API-подключение', 'Автосинхронизация врачей'] },
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

          {/* Дополнительные модули */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: 'domain', color: 'bg-[#0A2342]/5 text-[#0A2342]', title: 'Кастомный домен', desc: 'CNAME — ваш домен с верификацией' },
              { icon: 'storefront', color: 'bg-teal-50 text-teal-600', title: 'Публичная страница', desc: 'Страница клиники с врачами и отзывами' },
              { icon: 'business_center', color: 'bg-violet-50 text-violet-600', title: 'Кабинет франшизы', desc: 'Управление роялти и сводная аналитика' },
              { icon: 'account_balance', color: 'bg-amber-50 text-amber-600', title: 'Кабинет бухгалтера', desc: 'Акты, счета и финансовый реестр' },
              { icon: 'calendar_month', color: 'bg-indigo-50 text-indigo-600', title: 'Расписание врачей', desc: 'Шаблоны, слоты, онлайн-запись' },
              { icon: 'manage_history', color: 'bg-slate-50 text-slate-600', title: 'Аудит-лог', desc: 'История действий каждого пользователя' },
              { icon: 'webhook', color: 'bg-rose-50 text-rose-600', title: 'Вебхуки', desc: 'Интеграции с любыми внешними системами' },
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

      {/* ══ PATIENT CABINET ══ */}
      <section id="patient" className="py-24 px-5 bg-gradient-to-br from-[#0A2342] to-[#0d3b6e] text-white overflow-hidden relative">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-white/5 rounded-full blur-3xl translate-x-1/2 -translate-y-1/4" />
        <div className="max-w-7xl mx-auto relative">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <div className="inline-flex items-center gap-2 bg-white/10 rounded-full px-4 py-1.5 text-white/80 text-sm font-medium mb-6">
                  <span className="material-symbols-outlined text-base text-teal-300" style={{fontVariationSettings:"'FILL' 1"}}>new_releases</span>
                  Новое в КлиникСеть
                </div>
                <h2 className="font-bold text-4xl md:text-5xl mb-6 leading-tight">
                  Пациенты тоже<br/>
                  <span className="text-teal-300">получают кабинет</span>
                </h2>
                <p className="text-white/70 text-lg leading-relaxed mb-8">
                  Пациент заходит по номеру телефона — без пароля, без приложения. Видит своих врачей, историю визитов, может записаться повторно и оставить отзыв.
                </p>
                <div className="space-y-4">
                  {[
                    { icon: 'phone_iphone', title: 'Вход по SMS-коду', desc: 'Номер телефона → OTP-код → личный кабинет. Никаких паролей.' },
                    { icon: 'history', title: 'История визитов', desc: 'Все записи, направления и QR-коды — в одном месте.' },
                    { icon: 'event_available', title: 'Онлайн-запись', desc: 'Выбор врача → дата → время → запись в 2 клика.' },
                    { icon: 'rate_review', title: 'Отзывы врачам', desc: 'Пациент оставляет отзыв — он проходит модерацию и помогает другим.' },
                  ].map((item, i) => (
                    <div key={item.title} className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-teal-300 text-xl" style={{fontVariationSettings:"'FILL' 1"}}>{item.icon}</span>
                      </div>
                      <div>
                        <div className="font-semibold text-white text-sm">{item.title}</div>
                        <div className="text-white/60 text-sm">{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-10">
                  <button onClick={() => setShowContact(true)}
                    className="px-8 py-4 bg-teal-500 hover:bg-teal-400 text-white rounded-2xl font-bold transition shadow-xl flex items-center gap-2">
                    <span className="material-symbols-outlined" style={{fontVariationSettings:"'FILL' 1"}}>rocket_launch</span>
                    Подключить для своей клиники
                  </button>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              <div className="relative flex justify-center">
                {/* Мок-ап кабинета */}
                <div className="bg-white rounded-3xl shadow-2xl w-72 overflow-hidden text-gray-900">
                  <div className="bg-gradient-to-br from-[#0A2342] to-[#1a6b8a] p-5 text-white">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-bold text-lg">А</div>
                      <div>
                        <div className="font-semibold text-sm">Алия Мусаева</div>
                        <div className="text-white/60 text-xs">Пациент</div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {['Записи','Врачи','Профиль'].map(t => (
                        <button key={t} className={`px-3 py-1.5 rounded-full text-xs font-medium ${t === 'Записи' ? 'bg-white text-[#0A2342]' : 'bg-white/15 text-white/80'}`}>{t}</button>
                      ))}
                    </div>
                  </div>
                  <div className="p-4 space-y-3">
                    {[
                      { doc: 'Гудаев Х.С.', spec: 'Хирург', date: '28 апр', status: 'Завершён', color: 'bg-emerald-50 text-emerald-700' },
                      { doc: 'Ахматова Т.С.', spec: 'Терапевт', date: '15 апр', status: 'Завершён', color: 'bg-emerald-50 text-emerald-700' },
                      { doc: 'Айза', spec: 'Кардиолог', date: '10 апр', status: 'Отменён', color: 'bg-red-50 text-red-600' },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-xl">
                        <div className="w-8 h-8 rounded-lg bg-[#0A2342]/10 flex items-center justify-center text-xs font-bold text-[#0A2342]">
                          {item.doc[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-gray-800 truncate">{item.doc}</div>
                          <div className="text-[10px] text-gray-400">{item.spec} · {item.date}</div>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${item.color}`}>{item.status}</span>
                      </div>
                    ))}
                    <button className="w-full py-2.5 bg-teal-600 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5">
                      <span className="material-symbols-outlined text-sm" style={{fontVariationSettings:"'FILL' 1"}}>add_circle</span>
                      Записаться к врачу
                    </button>
                  </div>
                </div>
                {/* Всплывашка рейтинга */}
                <div className="absolute -right-4 top-16 bg-white rounded-2xl shadow-xl p-3 w-44 border border-gray-100">
                  <div className="text-xs font-bold text-gray-800 mb-1">Гудаев Х.С.</div>
                  <div className="flex items-center gap-1 mb-1">
                    {[1,2,3,4,5].map(i => (
                      <span key={i} className="material-symbols-outlined text-sm text-amber-400" style={{fontVariationSettings:"'FILL' 1"}}>star</span>
                    ))}
                    <span className="text-xs font-bold text-gray-700 ml-1">5.0</span>
                  </div>
                  <div className="text-[10px] text-gray-400">Отличный специалист!</div>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ══ HOW IT WORKS ══ */}
      <section id="how" className="py-24 px-5 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="text-center mb-16">
              <div className="inline-block bg-blue-50 text-[#0A2342] text-sm font-semibold px-4 py-1.5 rounded-full mb-4">Простой процесс</div>
              <h2 className="font-bold text-4xl md:text-5xl text-gray-900 mb-4">Как работает КлиникСеть</h2>
              <p className="text-gray-500 text-lg max-w-2xl mx-auto">От направления до выплаты бонуса — всё автоматически</p>
            </div>
          </FadeIn>
          <div className="relative">
            <div className="hidden md:block absolute top-10 left-[12.5%] right-[12.5%] h-0.5 bg-gradient-to-r from-[#0A2342]/20 via-teal-200 to-emerald-200" />
            <div className="grid md:grid-cols-4 gap-6">
              {[
                { n:'01', icon:'person_add', color:'bg-[#0A2342]', title:'Создание направления', desc:'Сотрудник или партнёр создаёт направление — вводит данные пациента и выбирает услугу' },
                { n:'02', icon:'qr_code', color:'bg-teal-600', title:'QR-код пациенту', desc:'Пациент получает QR-код в Telegram. Предъявляет при визите в клинику' },
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
              <div className="inline-block bg-[#0A2342]/5 text-[#0A2342] text-sm font-semibold px-4 py-1.5 rounded-full mb-4">Прозрачные цены</div>
              <h2 className="font-bold text-4xl md:text-5xl text-gray-900 mb-4">Тарифы под любую сеть</h2>
              <p className="text-gray-500 text-lg mb-8">Начните с базового тарифа — масштабируйтесь без переустановки</p>
              <div className="flex items-center justify-center gap-4">
                <span className={`text-sm font-semibold ${billingCycle === 'monthly' ? 'text-gray-900' : 'text-gray-400'}`}>Ежемесячно</span>
                <button onClick={() => setBillingCycle(c => c === 'monthly' ? 'annual' : 'monthly')}
                  className={`relative w-12 h-6 rounded-full transition-colors ${billingCycle === 'annual' ? 'bg-[#0A2342]' : 'bg-gray-300'}`}>
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
                  <div className={`relative bg-white rounded-3xl overflow-hidden flex flex-col transition-all ${isPopular ? 'ring-2 ring-[#0A2342] scale-[1.02] shadow-2xl' : 'border border-gray-100 shadow-lg hover:shadow-xl hover:scale-[1.01]'}`}>
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
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { icon:'account_tree', gradient:'from-[#0A2342] to-[#1a5276]', bg:'bg-slate-50', border:'border-slate-100', tag:'Владелец сети', tagColor:'bg-[#0A2342] text-white',
                title:'Полный контроль над франшизой', subtitle:'Franchise Owner',
                items:['Обзор всей сети в одном экране','Управление роялти и выплатами','Модерация отзывов врачей','Сводная аналитика по клиникам','Настройка брендинга и домена'] },
              { icon:'admin_panel_settings', gradient:'from-indigo-600 to-indigo-700', bg:'bg-indigo-50', border:'border-indigo-100', tag:'Руководитель', tagColor:'bg-indigo-600 text-white',
                title:'Управление клиникой', subtitle:'Supervisor / Manager',
                items:['Аналитика за любой период','Финансовый реестр и акты','KPI и рейтинг сотрудников','Создание сотрудников и расписания','Аудит-лог всех действий'] },
              { icon:'badge', gradient:'from-emerald-600 to-emerald-700', bg:'bg-emerald-50', border:'border-emerald-100', tag:'Сотрудник', tagColor:'bg-emerald-600 text-white',
                title:'Больше зарабатывайте', subtitle:'Администратор / Врач',
                items:['Создание направлений за минуту','QR-сканирование при визите','Личный кабинет с бонусами и KPI','Расписание и запись пациентов','Уведомления и напоминания'] },
              { icon:'person', gradient:'from-teal-600 to-teal-700', bg:'bg-teal-50', border:'border-teal-100', tag:'Пациент', tagColor:'bg-teal-600 text-white',
                title:'Удобный личный кабинет', subtitle:'Patient Portal',
                items:['Вход по номеру телефона (OTP)','История всех визитов и записей','Онлайн-запись к врачу','Рейтинги и отзывы врачей','Доступ без установки приложения'] },
            ].map((r, i) => (
              <FadeIn key={r.tag} delay={i * 100}>
                <div className={`rounded-3xl border ${r.border} overflow-hidden hover:shadow-xl transition-shadow h-full flex flex-col`}>
                  <div className={`bg-gradient-to-br ${r.gradient} p-6 text-white`}>
                    <span className="material-symbols-outlined text-4xl mb-3 block" style={{fontVariationSettings:"'FILL' 1"}}>{r.icon}</span>
                    <div className="text-white/70 text-xs font-bold uppercase tracking-widest mb-1">{r.subtitle}</div>
                    <h3 className="font-bold text-xl leading-tight">{r.title}</h3>
                  </div>
                  <div className={`${r.bg} p-6 flex-1 flex flex-col`}>
                    <ul className="space-y-2.5 flex-1">
                      {r.items.map(item => (
                        <li key={item} className="flex items-start gap-2.5 text-sm text-gray-700">
                          <span className="material-symbols-outlined text-base text-gray-400 mt-0.5 flex-shrink-0" style={{fontVariationSettings:"'FILL' 1"}}>check_circle</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                    <button onClick={() => setShowLogin(true)}
                      className={`mt-5 w-full py-2.5 rounded-2xl font-semibold text-sm ${r.tagColor} hover:opacity-90 transition flex items-center justify-center gap-2`}>
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
      <section className="py-24 px-5 bg-[#0A2342] text-white">
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="text-center mb-16">
              <div className="inline-block bg-white/10 text-white text-sm font-semibold px-4 py-1.5 rounded-full mb-4">Почему именно мы</div>
              <h2 className="font-bold text-4xl md:text-5xl mb-4">Не просто CRM.<br/>Готовая экосистема.</h2>
              <p className="text-blue-200 text-lg max-w-2xl mx-auto">
                КлиникСеть — это не набор инструментов. Это единая платформа, где всё — от регистратуры до пациента — работает вместе с первого дня.
              </p>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: 'bolt', title: 'Запуск за 1 день', desc: 'Заполните данные своей клиники — система готова к работе. Не нужно ждать разработчиков или настраивать серверы.' },
              { icon: 'layers', title: 'Всё в одном', desc: 'МИС, расписание, бонусы, рейтинги врачей, кабинет пациента, аналитика, аудит — одна подписка, один кабинет.' },
              { icon: 'trending_up', title: 'Масштабируется с вами', desc: 'Начните с 1 клиники. Добавляйте клиники, сотрудников, партнёров — платформа растёт без переустановки.' },
              { icon: 'lock', title: 'Безопасность по 152-ФЗ', desc: 'Согласия на обработку ПД, журнал аудита, шифрование данных, защита от подбора (rate limiter), раздельное хранение.' },
              { icon: 'domain', title: 'Ваш домен и бренд', desc: 'Подключите собственный CNAME-домен. Ваши цвета, логотип, название — пациенты видят только ваш бренд.' },
              { icon: 'api', title: 'Открытый API', desc: 'REST API и вебхуки для интеграции с любыми внешними системами. Полная документация по эндпоинтам.' },
            ].map((w, i) => (
              <FadeIn key={w.title} delay={i * 80}>
                <div className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-3xl p-7 transition">
                  <div className="w-12 h-12 rounded-2xl bg-teal-500/20 flex items-center justify-center mb-5">
                    <span className="material-symbols-outlined text-teal-300 text-2xl" style={{fontVariationSettings:"'FILL' 1"}}>{w.icon}</span>
                  </div>
                  <h3 className="font-bold text-lg mb-2 text-white">{w.title}</h3>
                  <p className="text-blue-200/70 text-sm leading-relaxed">{w.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ══ CTA BANNER ══ */}
      <section className="py-20 px-5 bg-gradient-to-br from-teal-600 to-[#0A2342] text-white">
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
                className="px-8 py-4 bg-white text-[#0A2342] rounded-2xl font-bold text-base hover:bg-blue-50 transition shadow-xl flex items-center justify-center gap-2">
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
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0A2342] to-[#1a6b8a] flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-lg" style={{fontVariationSettings:"'FILL' 1"}}>health_and_safety</span>
            </div>
            <div>
              <div className="font-bold text-white text-sm">КлиникСеть</div>
              <div className="text-xs text-gray-500">Платформа-франшиза для медицинских сетей</div>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-5 text-sm">
            {[['features','Возможности'],['patient','Пациентам'],['how','Как работает'],['pricing','Тарифы'],['roles','Роли']].map(([id,l]) => (
              <button key={id} onClick={() => scrollTo(id)} className="hover:text-white transition">{l}</button>
            ))}
            <button onClick={() => setShowContact(true)} className="hover:text-white transition">Контакты</button>
          </div>
          <p className="text-xs text-gray-600">© 2026 КлиникСеть. Все права защищены.</p>
        </div>
      </footer>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      {showContact && <ContactModal onClose={() => setShowContact(false)} />}
    </div>
  )
}
