import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import useAuthStore from '../store/auth'
import { API_BASE, SLUG } from '../config'

function useInView(threshold = 0.12) {
  const ref = useRef(null)
  const [v, setV] = useState(false)
  useEffect(() => {
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) setV(true) }, { threshold })
    if (ref.current) o.observe(ref.current)
    return () => o.disconnect()
  }, [])
  return [ref, v]
}
function FadeIn({ children, delay = 0, className = '' }) {
  const [ref, v] = useInView()
  return (
    <div ref={ref} className={`transition-all duration-700 ${v ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}>{children}</div>
  )
}

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
  }, [])
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="relative p-8 text-center overflow-hidden" style={{ background: 'linear-gradient(135deg, #0A2342 0%, #0d4a6e 60%, #00b4d8 100%)' }}>
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
          <div className="relative">
            <div className="w-16 h-16 bg-white/15 backdrop-blur rounded-2xl flex items-center justify-center mx-auto mb-4 border border-white/20">
              <span className="material-symbols-outlined text-white text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>health_and_safety</span>
            </div>
            <h2 className="font-bold text-2xl text-white mb-1">Войти в систему</h2>
            <p className="text-white/60 text-sm">Роль определится автоматически</p>
          </div>
          <button onClick={onClose} className="absolute top-4 right-4 text-white/50 hover:text-white transition">
            <span className="material-symbols-outlined text-2xl">close</span>
          </button>
        </div>
        <div className="p-8">
          {error && <div className="bg-red-50 border border-red-100 rounded-2xl p-4 mb-5 flex items-center gap-3">
            <span className="material-symbols-outlined text-red-500 text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
            <p className="text-red-600 text-sm">{error}</p>
          </div>}
          <form onSubmit={handleLogin} className="space-y-4">
            {[{ label: 'Логин', type: 'text', icon: 'person', val: username, set: setUsername, ac: 'username', ph: 'Введите логин' },
              { label: 'Пароль', type: showPass ? 'text' : 'password', icon: 'lock', val: password, set: setPassword, ac: 'current-password', ph: 'Введите пароль' }
            ].map(f => (
              <div key={f.label}>
                <label className="block text-sm font-semibold text-gray-700 mb-2">{f.label}</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xl">{f.icon}</span>
                  <input type={f.type} autoComplete={f.ac} value={f.val} onChange={e => f.set(e.target.value)} required placeholder={f.ph}
                    className="w-full border border-gray-200 focus:border-[#0A2342] focus:ring-2 focus:ring-[#0A2342]/10 rounded-2xl pl-11 pr-4 py-3.5 text-gray-900 placeholder-gray-400 text-sm outline-none transition bg-gray-50 focus:bg-white" />
                  {f.label === 'Пароль' && (
                    <button type="button" onClick={() => setShowPass(s => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition">
                      <span className="material-symbols-outlined text-xl">{showPass ? 'visibility_off' : 'visibility'}</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button type="submit" disabled={loading}
              className="w-full h-14 rounded-2xl font-bold text-base text-white transition shadow-lg flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #0A2342, #0d4a6e)' }}>
              {loading ? <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Входим...</>
                : <><span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>login</span>Войти</>}
            </button>
          </form>
          <div className="mt-5 pt-5 border-t border-gray-100">
            <p className="text-center text-xs text-gray-400 mb-3">Единый вход для всех ролей</p>
            <div className="flex justify-center gap-2 flex-wrap">
              {[['Руководитель','bg-blue-50 text-blue-700'],['Сотрудник','bg-emerald-50 text-emerald-700'],['Партнёр','bg-violet-50 text-violet-700'],['Пациент','bg-teal-50 text-teal-700']].map(([l,c]) => (
                <span key={l} className={`text-xs rounded-full px-3 py-1 font-medium ${c}`}>{l}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ContactModal({ onClose }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', message: '' })
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  useEffect(() => {
    const fn = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])
  const handleSubmit = async e => {
    e.preventDefault(); setLoading(true)
    try { await axios.post(API_BASE + '/contact/', form); setSent(true) } catch {} finally { setLoading(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 z-10 transition">
          <span className="material-symbols-outlined text-2xl">close</span>
        </button>
        {sent ? (
          <div className="p-14 text-center">
            <div className="w-20 h-20 bg-emerald-50 rounded-3xl flex items-center justify-center mx-auto mb-5">
              <span className="material-symbols-outlined text-emerald-500 text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            </div>
            <h3 className="font-bold text-2xl text-gray-900 mb-2">Заявка отправлена!</h3>
            <p className="text-gray-500 text-sm mb-7">Мы свяжемся с вами в течение одного рабочего дня</p>
            <button onClick={onClose} className="px-8 py-3 text-white rounded-2xl font-semibold transition" style={{ background: 'linear-gradient(135deg, #0A2342, #0d4a6e)' }}>Закрыть</button>
          </div>
        ) : (
          <>
            <div className="p-7 border-b border-gray-100">
              <h2 className="font-bold text-xl text-gray-900 mb-1">Получить консультацию</h2>
              <p className="text-gray-500 text-sm">Расскажите о вашей клинике — мы свяжемся и подберём решение</p>
            </div>
            <form onSubmit={handleSubmit} className="p-7 space-y-4">
              {[{ label: 'Имя *', type: 'text', key: 'name', icon: 'person', ph: 'Иван Иванов', req: true },
                { label: 'Телефон *', type: 'tel', key: 'phone', icon: 'phone', ph: '+7 (900) 000-00-00', req: true },
                { label: 'Email', type: 'email', key: 'email', icon: 'mail', ph: 'email@clinic.ru', req: false }
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">{f.label}</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xl">{f.icon}</span>
                    <input type={f.type} value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} required={f.req} placeholder={f.ph}
                      className="w-full border border-gray-200 focus:border-[#0A2342] focus:ring-2 focus:ring-[#0A2342]/10 rounded-2xl pl-11 pr-4 py-3 text-sm outline-none transition" />
                  </div>
                </div>
              ))}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Сообщение *</label>
                <textarea value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))} required rows={3} placeholder="Расскажите о вашей клинике..."
                  className="w-full border border-gray-200 focus:border-[#0A2342] focus:ring-2 focus:ring-[#0A2342]/10 rounded-2xl px-4 py-3 text-sm outline-none transition resize-none" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full h-12 text-white rounded-2xl font-semibold text-sm transition flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #0A2342, #0d4a6e)' }}>
                {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <><span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>Отправить заявку</>}
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
  const scrollTo = id => { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); setMenuOpen(false) }

  const PLANS = [
    { key: 'basic', name: 'Старт', subtitle: 'Для небольших клиник', pm: 9900, pa: 99000,
      gradient: 'linear-gradient(135deg, #374151, #1f2937)', badge: null,
      bullets: ['До 3 клиник в сети','До 50 сотрудников','QR-направления и бонусы','Личный кабинет пациента','Базовая аналитика','Техническая поддержка'] },
    { key: 'professional', name: 'Профи', subtitle: 'Для растущей сети', pm: 24900, pa: 249000,
      gradient: 'linear-gradient(135deg, #0A2342, #0d4a6e 60%, #1a7a9a)', badge: 'Популярный',
      bullets: ['До 15 клиник','До 200 сотрудников','Всё из Старта','МИС-интеграция (Renovatio)','Расписание и онлайн-запись','Рейтинги и отзывы врачей','AI-аналитика (базовая)','Кастомный брендинг и логотип','KPI, финансовый реестр, аудит'] },
    { key: 'enterprise', name: 'Корпорат', subtitle: 'Максимум возможностей', pm: 49900, pa: 499000,
      gradient: 'linear-gradient(135deg, #4c1d95, #6d28d9, #7c3aed)', badge: 'Максимум',
      bullets: ['Без ограничений по клиникам','Без ограничений по сотрудникам','Всё из Профи','Кастомный домен (CNAME)','AI Pro: прогнозы, ROI, чат с данными','Кабинет владельца франшизы','REST API и вебхуки','P2P видеозвонки','Поддержка 24/7'] },
  ]

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans overflow-x-hidden">

      {/* ══ NAV ══ */}
      <nav className="fixed top-0 inset-x-0 z-40 bg-white/70 backdrop-blur-2xl border-b border-gray-100/80">
        <div className="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow" style={{ background: 'linear-gradient(135deg, #0A2342, #00b4d8)' }}>
              <span className="material-symbols-outlined text-white text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>health_and_safety</span>
            </div>
            <span className="font-bold text-lg tracking-tight">КлиникСеть</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm text-gray-500 font-medium">
            {[['features','Возможности'],['ai','AI-аналитика'],['patient','Пациентам'],['pricing','Тарифы'],['roles','Роли']].map(([id,l]) => (
              <button key={id} onClick={() => scrollTo(id)} className="hover:text-gray-900 transition">{l}</button>
            ))}
          </div>
          <div className="hidden md:flex items-center gap-3">
            <button onClick={() => setShowContact(true)} className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm font-medium transition">Связаться</button>
            <button onClick={() => setShowLogin(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-white text-sm font-semibold rounded-xl transition shadow-md hover:shadow-lg hover:opacity-95"
              style={{ background: 'linear-gradient(135deg, #0A2342, #0d4a6e)' }}>
              <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>login</span>
              Войти
            </button>
          </div>
          <button className="md:hidden p-2" onClick={() => setMenuOpen(m => !m)}>
            <span className="material-symbols-outlined">{menuOpen ? 'close' : 'menu'}</span>
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden bg-white border-t border-gray-100 px-5 py-4 flex flex-col gap-3 text-sm shadow-lg">
            {[['features','Возможности'],['ai','AI-аналитика'],['patient','Пациентам'],['pricing','Тарифы'],['roles','Роли']].map(([id,l]) => (
              <button key={id} onClick={() => scrollTo(id)} className="text-left text-gray-700 py-1.5 font-medium">{l}</button>
            ))}
            <button onClick={() => { setShowContact(true); setMenuOpen(false) }} className="text-left text-gray-700 py-1.5 font-medium">Связаться</button>
            <button onClick={() => { setShowLogin(true); setMenuOpen(false) }}
              className="mt-1 w-full py-3 text-white rounded-xl font-semibold text-center"
              style={{ background: 'linear-gradient(135deg, #0A2342, #0d4a6e)' }}>Войти</button>
          </div>
        )}
      </nav>

      {/* ══ HERO ══ */}
      <section className="relative min-h-screen flex items-center pt-16 overflow-hidden" style={{ background: 'linear-gradient(150deg, #05111f 0%, #0A2342 45%, #0d4a6e 80%, #0a6e8a 100%)' }}>
        {/* Декор */}
        <div className="absolute inset-0">
          <div className="absolute top-20 right-0 w-[700px] h-[700px] rounded-full opacity-10" style={{ background: 'radial-gradient(circle, #00b4d8 0%, transparent 70%)' }} />
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full opacity-5" style={{ background: 'radial-gradient(circle, #00b4d8 0%, transparent 70%)' }} />
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.8) 1px, transparent 1px)', backgroundSize: '80px 80px' }} />
        </div>
        <div className="relative max-w-7xl mx-auto px-5 py-14 md:py-24 grid lg:grid-cols-2 gap-16 items-center w-full">
          <div>
            <div className="inline-flex items-center gap-2 border border-white/15 rounded-full px-4 py-1.5 text-white/70 text-sm font-medium mb-8 backdrop-blur bg-white/5">
              <span className="w-2 h-2 bg-[#00b4d8] rounded-full animate-pulse" />
              Платформа-франшиза для медицинских сетей
            </div>
            <h1 className="font-black text-3xl sm:text-5xl md:text-6xl lg:text-[4.5rem] leading-[1.04] mb-5 md:mb-7 text-white">
              Управляйте<br />
              <span style={{ background: 'linear-gradient(90deg, #48cae4, #90e0ef)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                клиникой
              </span>
              <br />умнее.
            </h1>
            <p className="text-white/55 text-base md:text-xl leading-relaxed mb-8 md:mb-10 max-w-lg">
              Единая экосистема: от регистратуры и врача до пациента. QR-направления, AI-аналитика, личный кабинет пациента, рейтинги врачей, white-label домен.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mb-8 md:mb-12">
              <button onClick={() => setShowContact(true)}
                className="px-8 py-4 text-white rounded-2xl font-bold text-base transition shadow-2xl flex items-center gap-2 hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #00b4d8, #0077b6)' }}>
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>rocket_launch</span>
                Получить демо
              </button>
              <button onClick={() => scrollTo('features')}
                className="px-8 py-4 bg-white/10 hover:bg-white/15 border border-white/20 text-white rounded-2xl font-bold text-base transition backdrop-blur flex items-center gap-2">
                <span className="material-symbols-outlined">play_circle</span>
                Возможности
              </button>
              <a href="/downloads/KliniknetCalls-Setup-1.0.0.exe" download
                className="px-6 py-4 rounded-2xl font-bold text-base transition shadow-2xl flex items-center gap-2 hover:brightness-110"
                style={{ background: 'linear-gradient(135deg, #22d3ee, #0e7490)', color: 'white', boxShadow: '0 10px 30px rgba(34,211,238,0.35)' }}>
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>download</span>
                Calls для Windows
                <span className="text-[10px] font-normal opacity-80 bg-white/20 px-1.5 py-0.5 rounded">.exe · 78 МБ</span>
              </a>
            </div>
            <div className="flex flex-wrap gap-3">
              {[
                { icon: 'smart_toy', text: 'AI-аналитика' },
                { icon: 'person', text: 'Кабинет пациента' },
                { icon: 'star', text: 'Рейтинги врачей' },
                { icon: 'domain', text: 'Ваш домен' },
                { icon: 'integration_instructions', text: 'МИС-интеграция' },
                { icon: 'lock', text: '152-ФЗ' },
              ].map(b => (
                <div key={b.text} className="flex items-center gap-1.5 text-sm text-white/60 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 backdrop-blur">
                  <span className="material-symbols-outlined text-[#48cae4] text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>{b.icon}</span>
                  {b.text}
                </div>
              ))}
            </div>
          </div>
          {/* Hero card */}
          <div className="hidden lg:flex justify-center items-center">
            <div className="relative">
              <div className="w-80 rounded-3xl overflow-hidden shadow-2xl border border-white/10 backdrop-blur"
                style={{ background: 'rgba(255,255,255,0.06)' }}>
                {/* Header */}
                <div className="p-5 border-b border-white/10">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#00b4d8] to-[#0077b6] flex items-center justify-center">
                      <span className="material-symbols-outlined text-white text-base" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
                    </div>
                    <div>
                      <div className="text-white text-sm font-semibold">AI-аналитик</div>
                      <div className="text-white/40 text-xs">Анализ данных клиники</div>
                    </div>
                  </div>
                </div>
                {/* Chat */}
                <div className="p-4 space-y-3">
                  <div className="bg-white/10 rounded-2xl rounded-tl-sm p-3">
                    <p className="text-white/80 text-xs leading-relaxed">Покажи динамику направлений за последние 30 дней</p>
                  </div>
                  <div className="ml-4 rounded-2xl rounded-tr-sm p-3" style={{ background: 'linear-gradient(135deg, #00b4d8/20, rgba(0,180,216,0.15))' }}>
                    <p className="text-white text-xs leading-relaxed">📈 За 30 дней: <b className="text-[#48cae4]">+23%</b> направлений. Лидеры: Иванов А.В. (47), Смирнова Е.Н. (38). Конверсия выросла с <b className="text-emerald-400">64%</b> до <b className="text-emerald-400">79%</b>.</p>
                  </div>
                  <div className="bg-white/10 rounded-2xl rounded-tl-sm p-3">
                    <p className="text-white/80 text-xs leading-relaxed">Прогноз на следующий месяц?</p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <div className="flex gap-1">
                      {[1,2,3].map(i => (
                        <div key={i} className="w-1.5 h-1.5 bg-[#48cae4] rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                    <span className="text-white/40 text-xs">Анализирую...</span>
                  </div>
                </div>
                {/* Stats strip */}
                <div className="px-4 pb-4 grid grid-cols-3 gap-2">
                  {[['187', 'Направлений'],['79%', 'Конверсия'],['+23%', 'Динамика']].map(([v, l]) => (
                    <div key={l} className="bg-white/5 rounded-xl p-2.5 text-center border border-white/10">
                      <div className="text-white font-bold text-base">{v}</div>
                      <div className="text-white/40 text-[10px]">{l}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Плавающие бейджи */}
              <div className="absolute -left-12 top-16 bg-emerald-500 text-white rounded-2xl px-3 py-2 shadow-xl text-xs font-bold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                МИС синхронизирован
              </div>
              <div className="absolute -right-10 bottom-20 bg-white rounded-2xl px-3 py-2 shadow-xl text-xs font-semibold text-gray-800 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-amber-400 text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                4.9 — средний рейтинг
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ STATS ══ */}
      <section className="py-12 border-b border-gray-100" style={{ background: '#f8fafc' }}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0">
            {[
              { n: '12+', label: 'Ролей пользователей', icon: 'group' },
              { n: '500+', label: 'Направлений в месяц', icon: 'trending_up' },
              { n: '98%', label: 'Подтверждений МИС', icon: 'verified' },
              { n: '1 день', label: 'До полного запуска', icon: 'bolt' },
            ].map((s, i) => (
              <FadeIn key={s.label} delay={i * 80}>
                <div className={`text-center py-6 px-4 ${i < 3 ? 'md:border-r border-gray-200' : ''}`}>
                  <div className="font-black text-3xl md:text-4xl text-gray-900 mb-1">{s.n}</div>
                  <div className="text-sm text-gray-500 font-medium">{s.label}</div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ══ FEATURES ══ */}
      <section id="features" className="py-16 md:py-28 px-5 bg-white">
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12 md:mb-20">
              <div className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-[#00b4d8] mb-4">Возможности платформы</div>
              <h2 className="font-black text-4xl md:text-5xl text-gray-900 mb-5 leading-tight">
                Всё необходимое —<br />в одной системе
              </h2>
              <p className="text-gray-500 text-lg max-w-2xl mx-auto">
                Направления, бонусы, расписание, AI, рейтинги врачей — не набор инструментов, а единая платформа.
              </p>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-6 mb-6">
            {[
              { icon: 'person', bg: 'from-teal-500 to-cyan-600', title: 'Личный кабинет пациента',
                desc: 'Вход по номеру телефона через OTP. Пациент видит историю визитов, записывается к врачу и оставляет отзывы — без установки приложений.',
                points: ['OTP-вход по телефону','История записей и направлений','Онлайн-запись и отзывы врачам'] },
              { icon: 'star', bg: 'from-amber-500 to-orange-500', title: 'Рейтинги и отзывы',
                desc: 'Пациенты оставляют отзывы прямо из кабинета. Модерация до публикации. Рейтинги врачей повышают доверие и конверсию.',
                points: ['Звёздный рейтинг 1—5','Модерация перед публикацией','Публичная страница клиники'] },
              { icon: 'qr_code_2', bg: 'from-[#0A2342] to-[#0d4a6e]', title: 'QR-направления',
                desc: 'Цифровые направления с уникальным QR. Администратор сканирует при визите — визит фиксируется мгновенно.',
                points: ['Мгновенная генерация QR','Сканирование за 2 секунды','Полная история визитов'] },
              { icon: 'auto_awesome', bg: 'from-violet-600 to-purple-700', title: 'Автоматические бонусы',
                desc: 'Как только МИС подтверждает приём — бонусы начисляются всем участникам цепочки. Прозрачно и без ошибок.',
                points: ['Начисление в момент визита','Прозрачная история','Экспорт для бухгалтерии'] },
              { icon: 'analytics', bg: 'from-blue-600 to-indigo-700', title: 'Аналитика и KPI',
                desc: 'Воронка направлений, динамика, топ-сотрудники, сравнение клиник. Пресеты за 7, 30, 90, 365 дней — всё в одном дашборде.',
                points: ['Воронка в 4 шага','Топ сотрудников и клиник','Пресеты и кастомный период'] },
              { icon: 'integration_instructions', bg: 'from-emerald-600 to-teal-600', title: 'Интеграция с МИС',
                desc: 'Renovatio и другие МИС. Данные о приёмах поступают автоматически — врачи, расписание, подтверждения.',
                points: ['Renovatio и другие МИС','REST API-подключение','Авто-синхронизация данных'] },
            ].map((f, i) => (
              <FadeIn key={f.title} delay={i * 70}>
                <div className="group rounded-3xl p-7 border border-gray-100 hover:border-gray-200 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 bg-white">
                  <div className={`w-13 h-13 rounded-2xl bg-gradient-to-br ${f.bg} flex items-center justify-center mb-6 shadow-lg`} style={{ width: 52, height: 52 }}>
                    <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>{f.icon}</span>
                  </div>
                  <h3 className="font-bold text-lg text-gray-900 mb-2.5">{f.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed mb-5">{f.desc}</p>
                  <ul className="space-y-2">
                    {f.points.map(pt => (
                      <li key={pt} className="flex items-center gap-2 text-sm text-gray-600">
                        <span className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0">
                          <span className="material-symbols-outlined text-emerald-500" style={{ fontSize: 12, fontVariationSettings: "'FILL' 1" }}>check</span>
                        </span>
                        {pt}
                      </li>
                    ))}
                  </ul>
                </div>
              </FadeIn>
            ))}
          </div>
          {/* Малые плитки */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: 'domain', color: '#0A2342', bg: '#f0f4f8', title: 'Кастомный домен', desc: 'CNAME — ваш бренд, ваш URL' },
              { icon: 'business_center', color: '#7c3aed', bg: '#f5f3ff', title: 'Кабинет франшизы', desc: 'Роялти, обзор сети, отзывы' },
              { icon: 'account_balance', color: '#b45309', bg: '#fffbeb', title: 'Кабинет бухгалтера', desc: 'Акты, счета, фин. реестр' },
              { icon: 'calendar_month', color: '#0369a1', bg: '#f0f9ff', title: 'Расписание врачей', desc: 'Шаблоны, слоты, запись' },
              { icon: 'manage_history', color: '#374151', bg: '#f9fafb', title: 'Аудит-лог', desc: 'История каждого действия' },
              { icon: 'webhook', color: '#dc2626', bg: '#fff1f2', title: 'Вебхуки', desc: 'Интеграция с любыми системами' },
              { icon: 'sms', color: '#059669', bg: '#ecfdf5', title: 'SMS-уведомления', desc: 'Оповещения пациентам' },
              { icon: 'gpp_good', color: '#16a34a', bg: '#f0fdf4', title: '152-ФЗ', desc: 'Согласия и анонимизация ПД' },
            ].map((m, i) => (
              <FadeIn key={m.title} delay={i * 40}>
                <div className="bg-white rounded-2xl p-5 border border-gray-100 hover:shadow-md hover:border-gray-200 transition-all">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: m.bg }}>
                    <span className="material-symbols-outlined text-xl" style={{ color: m.color, fontVariationSettings: "'FILL' 1" }}>{m.icon}</span>
                  </div>
                  <p className="font-bold text-sm text-gray-900 mb-0.5">{m.title}</p>
                  <p className="text-xs text-gray-500 leading-relaxed">{m.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ══ AI SECTION ══ */}
      <section id="ai" className="py-16 md:py-28 px-5 overflow-hidden" style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)' }}>
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12 md:mb-20">
              <div className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-violet-600 mb-4">Искусственный интеллект</div>
              <h2 className="font-black text-4xl md:text-5xl text-gray-900 mb-5 leading-tight">
                AI-аналитик знает<br />
                <span className="text-violet-600">всё о вашей клинике</span>
              </h2>
              <p className="text-gray-500 text-lg max-w-2xl mx-auto">
                Задайте вопрос на обычном языке — получите глубокий анализ данных, прогнозы и рекомендации за секунды.
              </p>
            </div>
          </FadeIn>
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Левая: типы анализа */}
            <FadeIn>
              <div className="space-y-4">
                {[
                  { icon: 'dashboard', color: '#0A2342', bg: '#eef2ff',
                    title: 'Обзор бизнеса',
                    desc: 'Полная картина: направления, конверсия, выплаченные бонусы, рейтинг сотрудников — за любой выбранный период.',
                    badge: 'Базовый' },
                  { icon: 'trending_up', color: '#0369a1', bg: '#f0f9ff',
                    title: 'Прогноз спроса',
                    desc: 'Модель анализирует сезонность, тренды и аномалии — и прогнозирует число направлений на следующий период.',
                    badge: 'Pro' },
                  { icon: 'schedule', color: '#7c3aed', bg: '#f5f3ff',
                    title: 'Загрузка врачей',
                    desc: 'Прогноз занятости по каждому специалисту. Видно, кто перегружен, а кто простаивает — до того как это стало проблемой.',
                    badge: 'Pro' },
                  { icon: 'payments', color: '#b45309', bg: '#fffbeb',
                    title: 'ROI бонусной программы',
                    desc: 'Соотношение затрат на бонусы к выручке от привлечённых пациентов. Оптимизация ставок без потери мотивации.',
                    badge: 'Pro' },
                  { icon: 'chat', color: '#059669', bg: '#ecfdf5',
                    title: 'Свободный вопрос к данным',
                    desc: 'Спросите на обычном языке: "Почему упала конверсия в марте?" или "Кто принёс больше всего выручки?" — AI ответит с цифрами.',
                    badge: 'Pro' },
                ].map((item, i) => (
                  <div key={item.title} className="flex gap-4 p-5 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: item.bg }}>
                      <span className="material-symbols-outlined text-xl" style={{ color: item.color, fontVariationSettings: "'FILL' 1" }}>{item.icon}</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-sm text-gray-900">{item.title}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.badge === 'Pro' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600'}`}>{item.badge}</span>
                      </div>
                      <p className="text-gray-500 text-xs leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </FadeIn>
            {/* Правая: мок-ап чата */}
            <FadeIn delay={150}>
              <div className="relative">
                <div className="rounded-3xl overflow-hidden shadow-2xl border border-gray-200">
                  {/* Хедер */}
                  <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-white">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center">
                      <span className="material-symbols-outlined text-white text-base" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-gray-900">AI-аналитик КлиникСеть</div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                        <span className="text-xs text-gray-400">Онлайн</span>
                      </div>
                    </div>
                    <div className="ml-auto hidden sm:flex gap-1">
                      {['7 дней','30 дней','90 дней'].map((p, i) => (
                        <button key={p} className={`text-[11px] px-2.5 py-1 rounded-lg font-medium ${i === 1 ? 'bg-violet-600 text-white' : 'text-gray-400 hover:bg-gray-50'}`}>{p}</button>
                      ))}
                    </div>
                  </div>
                  {/* Тело чата */}
                  <div className="bg-gray-50 p-5 space-y-4 min-h-[340px]">
                    {/* Сообщение пользователя */}
                    <div className="flex justify-end">
                      <div className="bg-white border border-gray-200 rounded-2xl rounded-tr-sm px-4 py-3 max-w-[80%] shadow-sm">
                        <p className="text-sm text-gray-800">Проанализируй работу клиники за последние 30 дней</p>
                      </div>
                    </div>
                    {/* Ответ AI */}
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center flex-shrink-0 mt-1">
                        <span className="material-symbols-outlined text-white" style={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%] shadow-sm">
                        <p className="text-sm text-gray-800 leading-relaxed mb-3">
                          📊 <b>Сводка за 30 дней:</b>
                        </p>
                        <div className="overflow-x-auto">
                        {[['Направлений','187','+23%','up'],['Конверсия','79%','+15 п.п.','up'],['Выплачено бонусов','124 300 ₽','-8%','down'],['Средний рейтинг','4.8 ★','+0.3','up']].map(([l,v,d,dir]) => (
                          <div key={l} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0 min-w-[200px]">
                            <span className="text-xs text-gray-500">{l}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-900">{v}</span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${dir === 'up' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{d}</span>
                            </div>
                          </div>
                        ))}
                        </div>
                        <p className="text-xs text-gray-500 mt-3 leading-relaxed">
                          ⚡ <b>Рекомендация:</b> снижение выплат при росте конверсии — хороший сигнал. Рассмотрите увеличение ставки за первичных пациентов.
                        </p>
                      </div>
                    </div>
                    {/* Следующий вопрос */}
                    <div className="flex justify-end">
                      <div className="bg-white border border-gray-200 rounded-2xl rounded-tr-sm px-4 py-3 max-w-[80%] shadow-sm">
                        <p className="text-sm text-gray-800">Кто из сотрудников показал лучший результат?</p>
                      </div>
                    </div>
                    {/* Индикатор печати */}
                    <div className="flex gap-3 items-center">
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-white" style={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex gap-1 items-center">
                        {[0,1,2].map(i => <div key={i} className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.2}s` }} />)}
                      </div>
                    </div>
                  </div>
                  {/* Поле ввода */}
                  <div className="bg-white border-t border-gray-100 px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 bg-gray-50 rounded-xl px-4 py-2.5 text-sm text-gray-400">Задайте вопрос об аналитике...</div>
                    <button className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center shadow">
                      <span className="material-symbols-outlined text-white text-base" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                    </button>
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ══ PATIENT CABINET ══ */}
      <section id="patient" className="py-16 md:py-28 px-5 overflow-hidden" style={{ background: 'linear-gradient(150deg, #05111f 0%, #0A2342 50%, #0a5e7a 100%)' }}>
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <div className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-[#48cae4] mb-6">Личный кабинет</div>
                <h2 className="font-black text-4xl md:text-5xl text-white mb-6 leading-tight">
                  Пациент —<br />
                  <span className="text-[#48cae4]">тоже участник</span><br />
                  экосистемы
                </h2>
                <p className="text-white/60 text-lg leading-relaxed mb-10">
                  Вход по SMS-коду, без паролей и приложений. Пациент видит своих врачей, историю визитов, записывается повторно и оставляет отзывы — всё с телефона.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { icon: 'phone_iphone', title: 'OTP-вход', desc: 'Номер телефона → код → кабинет' },
                    { icon: 'history', title: 'История визитов', desc: 'Все записи в одном месте' },
                    { icon: 'event_available', title: 'Онлайн-запись', desc: 'Врач → дата → время' },
                    { icon: 'rate_review', title: 'Отзывы', desc: 'Оценка и комментарий врачу' },
                  ].map(item => (
                    <div key={item.title} className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-4">
                      <div className="w-9 h-9 rounded-xl bg-[#48cae4]/15 flex items-center justify-center mb-3">
                        <span className="material-symbols-outlined text-[#48cae4] text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>{item.icon}</span>
                      </div>
                      <div className="font-bold text-white text-sm mb-0.5">{item.title}</div>
                      <div className="text-white/50 text-xs">{item.desc}</div>
                    </div>
                  ))}
                </div>
                <button onClick={() => setShowContact(true)}
                  className="mt-10 px-8 py-4 text-[#0A2342] rounded-2xl font-bold transition shadow-2xl flex items-center gap-2 hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #48cae4, #00b4d8)' }}>
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>rocket_launch</span>
                  Подключить для клиники
                </button>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              <div className="flex justify-center">
                <div className="bg-white rounded-3xl shadow-2xl w-72 overflow-hidden">
                  <div className="p-5 text-white" style={{ background: 'linear-gradient(135deg, #0A2342, #0d4a6e)' }}>
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center font-bold text-white">К</div>
                      <div>
                        <div className="font-semibold text-sm">Карина Петрова</div>
                        <div className="text-white/50 text-xs">Пациент</div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {['Записи','Врачи','Профиль'].map((t, i) => (
                        <button key={t} className={`px-3 py-1.5 rounded-full text-xs font-medium ${i === 0 ? 'bg-white text-[#0A2342]' : 'bg-white/10 text-white/70'}`}>{t}</button>
                      ))}
                    </div>
                  </div>
                  <div className="p-4 space-y-2.5">
                    {[['Иванов А.В.','Хирург','28 апр','Завершён','emerald'],
                      ['Смирнова Е.Н.','Терапевт','15 апр','Завершён','emerald'],
                      ['Фёдоров И.П.','Кардиолог','10 апр','Отменён','red']
                    ].map(([doc, spec, date, st, color]) => (
                      <div key={doc} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <div className="w-8 h-8 rounded-lg bg-[#0A2342]/8 flex items-center justify-center text-xs font-bold text-[#0A2342]">{doc[0]}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-gray-800 truncate">{doc}</div>
                          <div className="text-[10px] text-gray-400">{spec} · {date}</div>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${color === 'red' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>{st}</span>
                      </div>
                    ))}
                    <button className="w-full py-2.5 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5"
                      style={{ background: 'linear-gradient(135deg, #0A2342, #0d4a6e)' }}>
                      <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>add_circle</span>
                      Записаться к врачу
                    </button>
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ══ HOW IT WORKS ══ */}
      <section id="how" className="py-16 md:py-28 px-5 bg-white">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12 md:mb-20">
              <div className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-[#00b4d8] mb-4">Процесс</div>
              <h2 className="font-black text-4xl md:text-5xl text-gray-900 mb-5">Как работает платформа</h2>
              <p className="text-gray-500 text-lg">От направления до бонуса — полностью автоматически</p>
            </div>
          </FadeIn>
          <div className="relative">
            <div className="hidden md:block absolute top-11 left-[12.5%] right-[12.5%] h-px" style={{ background: 'linear-gradient(90deg, #0A2342, #00b4d8, #059669)' }} />
            <div className="grid md:grid-cols-4 gap-8">
              {[
                { n:'01', icon:'person_add', bg:'linear-gradient(135deg, #0A2342, #0d4a6e)', title:'Создание направления', desc:'Сотрудник создаёт цифровое направление — вводит данные пациента и выбирает услугу' },
                { n:'02', icon:'qr_code', bg:'linear-gradient(135deg, #0369a1, #0ea5e9)', title:'QR-код пациенту', desc:'Пациент получает QR-код на телефон. Предъявляет при визите в клинику' },
                { n:'03', icon:'qr_code_scanner', bg:'linear-gradient(135deg, #4c1d95, #7c3aed)', title:'Сканирование', desc:'Администратор сканирует QR — визит подтверждается в системе и МИС одновременно' },
                { n:'04', icon:'account_balance_wallet', bg:'linear-gradient(135deg, #065f46, #059669)', title:'Бонусы автоматически', desc:'Бонусы мгновенно начисляются всем: сотруднику, партнёру и руководителю' },
              ].map((s, i) => (
                <FadeIn key={s.n} delay={i * 120}>
                  <div className="flex flex-col items-center text-center">
                    <div className="relative mb-6">
                      <div className="w-22 h-22 rounded-3xl flex items-center justify-center shadow-xl" style={{ background: s.bg, width: 80, height: 80 }}>
                        <span className="material-symbols-outlined text-white text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>{s.icon}</span>
                      </div>
                      <div className="absolute -top-2 -right-2 w-7 h-7 bg-white border-2 border-gray-100 rounded-full flex items-center justify-center text-xs font-black text-gray-500 shadow-md">
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
      <section id="pricing" className="py-16 md:py-28 px-5" style={{ background: '#f8fafc' }}>
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            <div className="text-center mb-10 md:mb-16">
              <div className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-[#0A2342] mb-4">Тарифы</div>
              <h2 className="font-black text-4xl md:text-5xl text-gray-900 mb-4">Цены без сюрпризов</h2>
              <p className="text-gray-500 text-lg mb-8">Начните с малого — масштабируйтесь без переустановки</p>
              <div className="inline-flex items-center gap-4 bg-white rounded-2xl p-1.5 shadow-sm border border-gray-100">
                <button onClick={() => setBillingCycle('monthly')}
                  className={`px-5 py-2 rounded-xl text-sm font-semibold transition ${billingCycle === 'monthly' ? 'bg-gray-900 text-white shadow' : 'text-gray-500 hover:text-gray-800'}`}>
                  Ежемесячно
                </button>
                <button onClick={() => setBillingCycle('annual')}
                  className={`px-5 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${billingCycle === 'annual' ? 'bg-gray-900 text-white shadow' : 'text-gray-500 hover:text-gray-800'}`}>
                  Ежегодно
                  {billingCycle !== 'annual' && <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">−17%</span>}
                </button>
              </div>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-6">
            {PLANS.map((plan, i) => {
              const monthly = billingCycle === 'annual' ? Math.round(plan.pa / 12) : plan.pm
              const isPop = plan.key === 'professional'
              return (
                <FadeIn key={plan.key} delay={i * 100}>
                  <div className={`relative bg-white rounded-3xl overflow-hidden flex flex-col h-full transition-all ${isPop ? 'shadow-2xl ring-2 ring-[#0A2342] scale-[1.02]' : 'shadow-md hover:shadow-xl'}`}>
                    {isPop && <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#0A2342] to-[#00b4d8]" />}
                    <div className="p-7 text-white relative overflow-hidden" style={{ background: plan.gradient }}>
                      <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
                      {plan.badge && <span className="absolute top-5 right-5 text-[10px] font-black bg-white/20 border border-white/20 backdrop-blur px-2.5 py-1 rounded-full">{plan.badge}</span>}
                      <p className="text-xs font-black uppercase tracking-[0.2em] opacity-70 mb-3">{plan.name}</p>
                      <div className="flex items-end gap-1.5 mb-1">
                        <span className="text-4xl font-black">{monthly.toLocaleString('ru-RU')}</span>
                        <span className="text-sm opacity-60 mb-2">₽/мес</span>
                      </div>
                      {billingCycle === 'annual' && <p className="text-xs opacity-50">{plan.pa.toLocaleString('ru-RU')} ₽/год</p>}
                      <p className="text-xs opacity-60 mt-2">{plan.subtitle}</p>
                    </div>
                    <div className="p-6 flex-1 flex flex-col">
                      <ul className="space-y-3 flex-1 mb-6">
                        {plan.bullets.map((b, bi) => (
                          <li key={bi} className="flex items-start gap-3 text-sm text-gray-600">
                            <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <span className="material-symbols-outlined text-gray-700" style={{ fontSize: 12, fontVariationSettings: "'FILL' 1" }}>check</span>
                            </span>
                            {b}
                          </li>
                        ))}
                      </ul>
                      <button onClick={() => setShowContact(true)}
                        className="w-full py-3.5 rounded-2xl text-sm font-bold text-white transition hover:opacity-90"
                        style={{ background: plan.gradient }}>
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
              14 дней бесплатно · Без скрытых платежей · Отмена в любое время
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ══ FOR WHOM ══ */}
      <section id="roles" className="py-16 md:py-28 px-5 bg-white">
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12 md:mb-20">
              <div className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-violet-600 mb-4">Для каждой роли</div>
              <h2 className="font-black text-4xl md:text-5xl text-gray-900 mb-5">Один вход — каждый получает своё</h2>
              <p className="text-gray-500 text-lg">Система сама определяет, что показать именно вам</p>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { icon: 'account_tree', bg: 'linear-gradient(135deg, #0A2342, #1a4a7a)', tag: 'Franchise Owner',
                title: 'Владелец сети', items: ['Обзор всей сети','Управление роялти','Модерация отзывов','Аналитика по клиникам','Брендинг и домен'] },
              { icon: 'admin_panel_settings', bg: 'linear-gradient(135deg, #1e40af, #3b82f6)', tag: 'Supervisor',
                title: 'Руководитель', items: ['Аналитика за любой период','Фин. реестр и KPI','Рейтинг сотрудников','Расписание врачей','Аудит всех действий'] },
              { icon: 'badge', bg: 'linear-gradient(135deg, #065f46, #10b981)', tag: 'Staff',
                title: 'Сотрудник', items: ['Создание направлений','QR-сканирование','Бонусы и KPI','Расписание и запись','Уведомления'] },
              { icon: 'person', bg: 'linear-gradient(135deg, #0e7490, #06b6d4)', tag: 'Patient',
                title: 'Пациент', items: ['Вход по OTP','История визитов','Онлайн-запись','Отзывы врачам','Без установки приложения'] },
            ].map((r, i) => (
              <FadeIn key={r.tag} delay={i * 80}>
                <div className="rounded-3xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 h-full flex flex-col">
                  <div className="p-6 text-white" style={{ background: r.bg }}>
                    <span className="material-symbols-outlined text-4xl mb-4 block opacity-90" style={{ fontVariationSettings: "'FILL' 1" }}>{r.icon}</span>
                    <div className="text-white/50 text-xs font-bold uppercase tracking-wider mb-1">{r.tag}</div>
                    <h3 className="font-black text-2xl">{r.title}</h3>
                  </div>
                  <div className="bg-gray-50 p-6 flex-1 flex flex-col">
                    <ul className="space-y-2.5 flex-1">
                      {r.items.map(item => (
                        <li key={item} className="flex items-center gap-2.5 text-sm text-gray-600">
                          <span className="w-4 h-4 rounded-full bg-white border border-gray-200 flex items-center justify-center flex-shrink-0">
                            <span className="material-symbols-outlined" style={{ fontSize: 10, color: '#6b7280', fontVariationSettings: "'FILL' 1" }}>check</span>
                          </span>
                          {item}
                        </li>
                      ))}
                    </ul>
                    <button onClick={() => setShowLogin(true)}
                      className="mt-5 w-full py-3 rounded-2xl text-sm font-bold text-white transition hover:opacity-90 flex items-center justify-center gap-2"
                      style={{ background: r.bg }}>
                      <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>login</span>
                      Войти
                    </button>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ══ WHY US ══ */}
      <section className="py-16 md:py-28 px-5" style={{ background: 'linear-gradient(150deg, #05111f 0%, #0A2342 60%, #0d4a6e 100%)' }}>
        <div className="max-w-7xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12 md:mb-20">
              <div className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-[#48cae4] mb-4">Наши преимущества</div>
              <h2 className="font-black text-4xl md:text-5xl text-white mb-5">Не просто CRM.<br />Готовая экосистема.</h2>
              <p className="text-white/50 text-lg max-w-2xl mx-auto">
                Всё от направления до AI-прогноза — в одной платформе, с первого дня.
              </p>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { icon: 'bolt', title: 'Запуск за 1 день', desc: 'Заполните данные — система готова. Не нужно ждать разработчиков или арендовать серверы.' },
              { icon: 'layers', title: 'Всё в одном', desc: 'МИС, расписание, бонусы, AI, рейтинги, кабинет пациента, аудит — одна подписка, одна команда.' },
              { icon: 'trending_up', title: 'Растёт с вами', desc: 'Начните с одной клиники. Добавляйте клиники, сотрудников, партнёров — без переустановки.' },
              { icon: 'lock', title: 'Безопасность 152-ФЗ', desc: 'Согласия, аудит, шифрование, rate-limiter, IDOR-защита, раздельное хранение данных.' },
              { icon: 'domain', title: 'Ваш бренд и домен', desc: 'Подключите CNAME. Пациенты видят только ваш логотип, ваши цвета, ваш домен.' },
              { icon: 'api', title: 'Открытый API', desc: 'REST API и вебхуки для интеграции с любыми системами. Полная документация.' },
            ].map((w, i) => (
              <FadeIn key={w.title} delay={i * 70}>
                <div className="rounded-3xl p-7 border border-white/8 hover:border-white/15 transition-all hover:bg-white/5" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'rgba(72,202,228,0.1)' }}>
                    <span className="material-symbols-outlined text-[#48cae4] text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>{w.icon}</span>
                  </div>
                  <h3 className="font-bold text-lg text-white mb-2">{w.title}</h3>
                  <p className="text-white/45 text-sm leading-relaxed">{w.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ══ CTA ══ */}
      <section className="py-14 md:py-24 px-5 bg-white">
        <div className="max-w-4xl mx-auto">
          <FadeIn>
            <div className="rounded-3xl p-7 sm:p-10 md:p-12 text-center text-white relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0A2342 0%, #0d4a6e 50%, #0a6e8a 100%)' }}>
              <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '50px 50px' }} />
              <div className="relative">
                <div className="inline-flex items-center gap-2 bg-white/10 border border-white/15 rounded-full px-4 py-1.5 text-white/70 text-sm font-medium mb-6">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                  14 дней бесплатного доступа
                </div>
                <h2 className="font-black text-3xl md:text-5xl mb-5">
                  Готовы запустить<br />вашу платформу?
                </h2>
                <p className="text-white/60 text-lg mb-10 max-w-xl mx-auto">
                  Подключим клинику, настроим МИС и обучим команду. Первые результаты — уже в первую неделю.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button onClick={() => setShowContact(true)}
                    className="px-8 py-4 bg-white font-bold text-base rounded-2xl transition hover:bg-blue-50 flex items-center justify-center gap-2 shadow-xl"
                    style={{ color: '#0A2342' }}>
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>chat</span>
                    Получить консультацию
                  </button>
                  <button onClick={() => setShowLogin(true)}
                    className="px-8 py-4 bg-white/10 border border-white/20 text-white rounded-2xl font-bold text-base hover:bg-white/15 transition flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>login</span>
                    Войти в систему
                  </button>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ══ FOOTER ══ */}
      <footer className="py-10 px-5 border-t border-gray-100">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0A2342, #00b4d8)' }}>
              <span className="material-symbols-outlined text-white text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>health_and_safety</span>
            </div>
            <div>
              <div className="font-bold text-gray-900 text-sm">КлиникСеть</div>
              <div className="text-xs text-gray-400">Платформа для медицинских сетей</div>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-gray-400">
            {[['features','Возможности'],['ai','AI-аналитика'],['pricing','Тарифы'],['roles','Роли']].map(([id,l]) => (
              <button key={id} onClick={() => scrollTo(id)} className="hover:text-gray-700 transition">{l}</button>
            ))}
            <button onClick={() => setShowContact(true)} className="hover:text-gray-700 transition">Связаться</button>
          </div>
          <p className="text-xs text-gray-400">© 2026 КлиникСеть</p>
        </div>
      </footer>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      {showContact && <ContactModal onClose={() => setShowContact(false)} />}
    </div>
  )
}
