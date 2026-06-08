/**
 * ========================================
 * БЛОК: <DirectorLayout> — корневой layout кабинета директора
 * ========================================
 * Read-only кабинет руководителя сети с графиками/KPI/аналитикой.
 *
 * Структура:
 *   <Page>
 *     ─ Sticky topbar: лого + имя франшизы + переключатель периода + avatar+logout
 *     ─ Side-nav (desktop ≥1024px)
 *     ─ Bottom-nav (mobile < 640px)
 *     ─ <Outlet /> для вложенных страниц
 *
 * Использует существующий design-system Page + tokens.
 * ========================================
 */
import { useState, useEffect, createContext, useContext } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import api from '../api'
import { Page } from '../design'
import useAuthStore from '../store/auth'
import { SLUG } from '../config'

// ─── Контекст периода — доступен всем child-страницам через useDirectorPeriod() ──
const PeriodContext = createContext({
  period: 'month',
  setPeriod: () => {},
  from: null, to: null,
  setRange: () => {},
})
export const useDirectorPeriod = () => useContext(PeriodContext)

// ─── Карта разделов ──────────────────────────────────────────────────────────
export const DIR_NAV = [
  { key: 'dashboard', label: 'Главная',    icon: 'dashboard',       path: '/director' },
  { key: 'pnl',       label: 'P&L',        icon: 'paid',            path: '/director/pnl' },
  { key: 'cashflow',  label: 'ДДС',        icon: 'currency_exchange',path: '/director/cashflow' },
  { key: 'kpi',       label: 'KPI',        icon: 'leaderboard',     path: '/director/kpi' },
  { key: 'marketing', label: 'Маркетинг',  icon: 'campaign',        path: '/director/marketing' },
  { key: 'clinics',   label: 'Клиники',    icon: 'local_hospital',  path: '/director/clinics' },
  { key: 'doctors',   label: 'Врачи',      icon: 'medical_services',path: '/director/doctors' },
  { key: 'services',  label: 'Услуги',     icon: 'list_alt',        path: '/director/services' },
]
// 6 пунктов в bottom-nav на мобильном (главная + 5), остальное в "Ещё"
const BOTTOM_KEYS = ['dashboard', 'pnl', 'cashflow', 'kpi', 'clinics']

// ─── Период: ярлыки и расчёт диапазонов ──────────────────────────────────────
const PERIODS = [
  { key: 'today',     label: 'Сегодня' },
  { key: 'week',      label: 'Неделя' },
  { key: 'month',     label: 'Месяц' },
  { key: 'quarter',   label: 'Квартал' },
  { key: 'year',      label: 'Год' },
  { key: 'custom',    label: 'Произвольный' },
]
function computeRange(period) {
  const now = new Date()
  const to = now.toISOString().slice(0, 10)
  const d = new Date(now)
  if (period === 'today') {/* keep */}
  else if (period === 'week')    d.setDate(d.getDate() - 7)
  else if (period === 'month')   d.setMonth(d.getMonth() - 1)
  else if (period === 'quarter') d.setMonth(d.getMonth() - 3)
  else if (period === 'year')    d.setFullYear(d.getFullYear() - 1)
  const from = d.toISOString().slice(0, 10)
  return { from, to }
}

export default function DirectorLayout() {
  const nav = useNavigate()
  const loc = useLocation()
  const { user, logout } = useAuthStore()
  const [me, setMe] = useState(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)

  const [period, setPeriod] = useState(() => localStorage.getItem('director_period') || 'month')
  const [customRange, setCustomRange] = useState({ from: '', to: '' })
  const range = period === 'custom' && customRange.from && customRange.to
    ? customRange
    : computeRange(period)

  // Активный раздел (по pathname)
  const activeKey = (() => {
    const p = loc.pathname.replace(/\/$/, '')
    const found = DIR_NAV.find(n => n.path !== '/director' && p.startsWith(n.path))
    if (found) return found.key
    if (p === '/director' || p === '') return 'dashboard'
    return 'dashboard'
  })()

  // Загрузка профиля директора
  useEffect(() => {
    let alive = true
    api.get('/director/me')
      .then(r => { if (alive) setMe(r.data) })
      .catch(() => { /* бэк может быть ещё не готов — игнорируем */ })
    return () => { alive = false }
  }, [])

  useEffect(() => { localStorage.setItem('director_period', period) }, [period])

  const handleLogout = () => {
    // logout() уже чистит все 4 ключа (store/auth + lib/authKeys) — компенсация не нужна
    try { logout() } catch {}
    window.location.href = '/' + SLUG + '/'
  }

  const bottomItems = BOTTOM_KEYS.map(k => DIR_NAV.find(n => n.key === k)).filter(Boolean)
  const moreItems = DIR_NAV.filter(n => !BOTTOM_KEYS.includes(n.key))

  return (
    <PeriodContext.Provider value={{ period, setPeriod, from: range.from, to: range.to, setRange: setCustomRange, customRange }}>
      <Page>
        {/* ─── Sticky topbar ─── */}
        <header
          className="sticky top-0 z-30 px-3 sm:px-6 py-2.5 sm:py-3"
          style={{
            background: 'oklch(1 0 0 / 0.92)',
            backdropFilter: 'blur(20px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="flex items-center gap-2 sm:gap-4 max-w-[1280px] mx-auto">
            {/* Лого КлиникСеть */}
            <a href="#/director" className="inline-grid place-items-center flex-shrink-0" style={{ width: 38, height: 38, borderRadius: 10, overflow: 'hidden', textDecoration: 'none' }} title="КлиникСеть">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="38" height="38">
                <rect width="64" height="64" rx="10" fill="#0097A7"/>
                <rect x="26" y="12" width="12" height="40" rx="3" fill="white"/>
                <rect x="12" y="26" width="40" height="12" rx="3" fill="white"/>
              </svg>
            </a>

            {/* Название */}
            <div className="min-w-0 flex-1">
              <div className="font-semibold truncate" style={{ fontSize: 15, color: 'var(--fg)', letterSpacing: '-0.01em' }}>
                {me?.franchise_name || me?.tenant_name || 'Кабинет директора'}
              </div>
              <div className="text-[11px] truncate" style={{ color: 'var(--fg-3)' }}>
                {(me?.full_name || user?.full_name || 'Директор сети') + (user?.role === 'deputy_director' ? ' · зам руководителя' : '')}
              </div>
            </div>

            {/* Переключатель периода (desktop) */}
            <div className="hidden md:flex items-center gap-1 flex-shrink-0" style={{ background: 'var(--bg-1)', borderRadius: 10, padding: 3, border: '1px solid var(--border)' }}>
              {PERIODS.slice(0, 5).map(p => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 7,
                    fontSize: 12, fontWeight: 600,
                    background: period === p.key ? 'var(--surface)' : 'transparent',
                    color: period === p.key ? 'var(--accent)' : 'var(--fg-2)',
                    boxShadow: period === p.key ? 'var(--shadow-sm)' : 'none',
                    border: 'none', cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => setPeriod('custom')}
                style={{
                  padding: '6px 10px', borderRadius: 7,
                  fontSize: 12, fontWeight: 600,
                  background: period === 'custom' ? 'var(--surface)' : 'transparent',
                  color: period === 'custom' ? 'var(--accent)' : 'var(--fg-2)',
                  border: 'none', cursor: 'pointer',
                }}
                title="Произвольный период"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>tune</span>
              </button>
            </div>

            {/* Период (mobile) — компактная кнопка-селектор */}
            <select
              className="md:hidden"
              value={period}
              onChange={e => setPeriod(e.target.value)}
              style={{
                padding: '8px 10px', borderRadius: 10,
                background: 'var(--bg-1)', border: '1px solid var(--border)',
                color: 'var(--fg)', fontSize: 12, fontWeight: 600,
                minHeight: 36,
              }}
            >
              {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>

            {/* Avatar + dropdown */}
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setAvatarOpen(v => !v)}
                className="inline-grid place-items-center transition-transform active:scale-95"
                style={{
                  width: 38, height: 38, borderRadius: 999,
                  background: 'var(--accent)', color: '#fff',
                  fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer',
                }}
                aria-label="Профиль"
              >
                {(me?.full_name || user?.full_name || 'Д').slice(0, 1).toUpperCase()}
              </button>
              {avatarOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAvatarOpen(false)} />
                  <div
                    className="absolute right-0 mt-2 z-50"
                    style={{
                      minWidth: 200, background: 'var(--surface)',
                      border: '1px solid var(--border)', borderRadius: 12,
                      boxShadow: 'var(--shadow-lg)', padding: 6,
                    }}
                  >
                    <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg)' }}>
                        {me?.full_name || user?.full_name || 'Директор'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{user?.email || me?.email || ''}</div>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-3 py-2 mt-1 transition-colors"
                      style={{
                        fontSize: 13, color: 'var(--bad)', fontWeight: 600,
                        background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 8,
                      }}
                      onMouseOver={e => e.currentTarget.style.background = 'var(--bg-1)'}
                      onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 6 }}>logout</span>
                      Выйти
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Произвольный диапазон дат (если выбран) */}
          {period === 'custom' && (
            <div className="flex items-center gap-2 mt-2 max-w-[1280px] mx-auto flex-wrap" style={{ fontSize: 12 }}>
              <span style={{ color: 'var(--fg-3)' }}>С</span>
              <input
                type="date"
                value={customRange.from}
                onChange={e => setCustomRange(r => ({ ...r, from: e.target.value }))}
                style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-1)', minHeight: 36 }}
              />
              <span style={{ color: 'var(--fg-3)' }}>по</span>
              <input
                type="date"
                value={customRange.to}
                onChange={e => setCustomRange(r => ({ ...r, to: e.target.value }))}
                style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-1)', minHeight: 36 }}
              />
            </div>
          )}
        </header>

        {/* ─── Контент с side-nav на десктопе ─── */}
        <div className="max-w-[1280px] mx-auto flex gap-4" style={{ padding: 'clamp(8px, 2vw, 24px)' }}>
          {/* Side-nav (desktop ≥ lg) */}
          <aside
            className="hidden lg:block flex-shrink-0"
            style={{
              width: 220, position: 'sticky', top: 76, alignSelf: 'flex-start',
              maxHeight: 'calc(100vh - 96px)', overflowY: 'auto',
            }}
          >
            <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {DIR_NAV.map(item => {
                const isActive = activeKey === item.key
                return (
                  <button
                    key={item.key}
                    onClick={() => nav(item.path)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', borderRadius: 10,
                      background: isActive ? 'var(--accent-soft)' : 'transparent',
                      color: isActive ? 'var(--accent)' : 'var(--fg-2)',
                      fontWeight: isActive ? 700 : 600, fontSize: 13,
                      border: 'none', cursor: 'pointer', textAlign: 'left',
                      transition: 'background 150ms',
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}>
                      {item.icon}
                    </span>
                    {item.label}
                  </button>
                )
              })}
            </nav>
          </aside>

          {/* Контент */}
          <main className="flex-1 min-w-0 pb-24 lg:pb-4">
            <Outlet />
          </main>
        </div>

        {/* ─── Mobile bottom-nav ─── */}
        <nav
          className="fixed bottom-0 left-0 right-0 z-30 lg:hidden"
          style={{
            paddingBottom: 'env(safe-area-inset-bottom)',
            background: 'oklch(1 0 0 / 0.95)',
            backdropFilter: 'blur(20px)',
            borderTop: '1px solid var(--border)',
          }}
        >
          <div className="flex">
            {bottomItems.map(item => {
              const isActive = activeKey === item.key
              return (
                <button
                  key={item.key}
                  onClick={() => nav(item.path)}
                  className="flex-1 flex flex-col items-center pt-2 pb-1.5 gap-0.5 relative"
                  style={{ minHeight: 56, background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  {isActive && (
                    <span
                      className="absolute top-0 left-1/2 -translate-x-1/2"
                      style={{ width: 28, height: 2, borderRadius: 999, background: 'var(--accent)' }}
                    />
                  )}
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: 22,
                      color: isActive ? 'var(--accent)' : 'var(--fg-3)',
                      fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0",
                    }}
                  >
                    {item.icon}
                  </span>
                  <span style={{
                    fontSize: 10.5, fontWeight: isActive ? 700 : 600,
                    color: isActive ? 'var(--accent)' : 'var(--fg-3)',
                  }}>{item.label}</span>
                </button>
              )
            })}
            <button
              onClick={() => setMoreOpen(true)}
              className="flex-1 flex flex-col items-center pt-2 pb-1.5 gap-0.5"
              style={{ minHeight: 56, background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'var(--fg-3)' }}>more_horiz</span>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--fg-3)' }}>Ещё</span>
            </button>
          </div>
        </nav>

        {/* ─── Drawer «Ещё» (mobile) ─── */}
        {moreOpen && (
          <>
            <div className="fixed inset-0 z-40 lg:hidden" style={{ background: 'oklch(0 0 0 / 0.4)' }} onClick={() => setMoreOpen(false)} />
            <div
              className="fixed bottom-0 left-0 right-0 z-50 lg:hidden"
              style={{
                background: 'var(--surface)',
                borderTopLeftRadius: 22, borderTopRightRadius: 22,
                paddingBottom: 'env(safe-area-inset-bottom)',
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              <div className="mx-auto mt-3 mb-4" style={{ width: 40, height: 4, borderRadius: 999, background: 'var(--bg-3)' }} />
              <div className="px-5 mb-3" style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Разделы
              </div>
              <div className="px-3 pb-4" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {moreItems.map(item => {
                  const isActive = activeKey === item.key
                  return (
                    <button
                      key={item.key}
                      onClick={() => { setMoreOpen(false); nav(item.path) }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '14px 14px', borderRadius: 12,
                        background: isActive ? 'var(--accent-soft)' : 'var(--bg-1)',
                        color: isActive ? 'var(--accent)' : 'var(--fg)',
                        fontWeight: 600, fontSize: 14,
                        border: 'none', cursor: 'pointer', textAlign: 'left',
                        minHeight: 48,
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 22 }}>{item.icon}</span>
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </Page>
    </PeriodContext.Provider>
  )
}
