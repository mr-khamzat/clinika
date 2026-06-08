/**
 * ========================================
 * БЛОК: <AccountantShell> — корпус кабинета бухгалтера
 * ========================================
 * Адаптивный шелл: десктоп = sticky sidebar 220px слева, мобила = drawer.
 *
 * Использование:
 *   <AccountantShell active="cash">
 *     ...content...
 *   </AccountantShell>
 *
 * Пункты меню: summary / cash / acts / payments / payroll / spending / reports.
 * Акцент — бирюзовый (#0097A7). Активный пункт — заливка var(--accent-soft)
 * + левая рамка цветом акцента.
 * Кнопка «Выйти» снизу очищает токен и редиректит на /{slug}/.
 *
 * Mobile (≤880px):
 *   • Верхняя панель с burger-кнопкой + название раздела + clinic name
 *   • Sidebar скрыт за экраном (translateX(-100%)), вылетает справа налево
 *   • При открытии — backdrop, клик по нему / по пункту меню закрывает drawer
 *   • Контент-padding меньше (16px вместо 24-28)
 * ========================================
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import { SLUG } from '../config'
import { clearAllAuth } from '../lib/authKeys'

// ─── Карта разделов кабинета бухгалтера ─────────────────────────────────────
export const ACC_NAV = [
  { key: 'summary',  label: 'Сводка',   icon: 'dashboard',     path: '/accountant/summary'  },
  { key: 'cash',     label: 'Касса',    icon: 'point_of_sale', path: '/accountant/cash'     },
  { key: 'acts',     label: 'Акты',     icon: 'description',   path: '/accountant/acts'     },
  { key: 'incoming', label: 'Счета сети', icon: 'mail',        path: '/accountant/incoming-invoices' },
  { key: 'payments', label: 'Платежи',  icon: 'payments',      path: '/accountant/payments' },
  { key: 'payroll',  label: 'Зарплата', icon: 'group',         path: '/accountant/payroll'  },
  { key: 'spending', label: 'Расходы',  icon: 'receipt_long',  path: '/accountant/spending' },
  { key: 'reports',  label: 'Отчёты',   icon: 'analytics',     path: '/accountant/reports'  },
]

const ACC_ACCENT = '#0097A7'
const ACC_ACCENT_SOFT = 'rgba(0, 151, 167, 0.10)'
const ACC_ACCENT_LINE = 'rgba(0, 151, 167, 0.28)'
const MOBILE_BREAKPOINT = 880

function logout() {
  // Единый хелпер чистит все 4 ключа (access+refresh, user+admin) — см. lib/authKeys
  clearAllAuth(SLUG)
  window.location.href = '/' + SLUG + '/'
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches
      : false
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
    const handler = e => setIsMobile(e.matches)
    if (mql.addEventListener) mql.addEventListener('change', handler)
    else mql.addListener(handler)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler)
      else mql.removeListener(handler)
    }
  }, [])
  return isMobile
}

export default function AccountantShell({ active, children }) {
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [clinicName, setClinicName] = useState('')
  const [userName, setUserName] = useState('')

  // Закрываем drawer при смене десктоп ↔ мобайл
  useEffect(() => { if (!isMobile) setDrawerOpen(false) }, [isMobile])

  // Блокируем скролл body когда drawer открыт
  useEffect(() => {
    if (typeof document === 'undefined') return
    const prev = document.body.style.overflow
    document.body.style.overflow = drawerOpen ? 'hidden' : prev
    return () => { document.body.style.overflow = prev }
  }, [drawerOpen])

  useEffect(() => {
    let alive = true
    api.get('/admins/me')
      .then(r => {
        if (!alive) return
        const u = r?.data || {}
        setClinicName(u?.clinic?.name || u?.clinic_name || '')
        setUserName(u?.full_name || u?.name || u?.email || '')
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const activeItem = ACC_NAV.find(n => n.key === active)
  const handleNav = (path) => {
    setDrawerOpen(false)
    nav(path)
  }

  const sidebarVisible = !isMobile || drawerOpen

  return (
    <div
      style={{
        ['--accent']: ACC_ACCENT,
        ['--accent-soft']: ACC_ACCENT_SOFT,
        ['--accent-line']: ACC_ACCENT_LINE,
        minHeight: '100vh',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        background: 'var(--bg)',
        color: 'var(--fg)',
      }}
    >
      {/* ─── Mobile top bar ─── */}
      {isMobile && (
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            minHeight: 56,
          }}
        >
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Открыть меню"
            style={{
              width: 40,
              height: 40,
              display: 'inline-grid',
              placeItems: 'center',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--bg-1)',
              color: 'var(--fg)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>menu</span>
          </button>

          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: ACC_ACCENT,
              color: '#fff',
              display: 'inline-grid',
              placeItems: 'center',
              fontWeight: 800,
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            КС
          </span>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--fg)',
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {activeItem?.label || 'Бухгалтерия'}
            </div>
            {clinicName && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--fg-3)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginTop: 1,
                }}
              >
                {clinicName}
              </div>
            )}
          </div>
        </header>
      )}

      {/* ─── Backdrop (только на мобиле и при открытом drawer) ─── */}
      {isMobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(2px)',
            zIndex: 40,
            transition: 'opacity 0.2s ease',
          }}
        />
      )}

      {/* ─── Sidebar ─── */}
      <aside
        style={{
          width: isMobile ? 260 : 220,
          flexShrink: 0,
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          // desktop: sticky слева; mobile: fixed-drawer
          ...(isMobile
            ? {
                position: 'fixed',
                top: 0,
                left: 0,
                bottom: 0,
                height: '100vh',
                zIndex: 50,
                transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
                transition: 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)',
                boxShadow: drawerOpen ? '0 20px 60px rgba(15,23,42,0.25)' : 'none',
              }
            : {
                position: 'sticky',
                top: 0,
                height: '100vh',
              }),
        }}
        aria-hidden={isMobile && !drawerOpen}
      >
        {/* Бренд */}
        <div
          style={{
            padding: '18px 16px 14px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: ACC_ACCENT,
              color: '#fff',
              display: 'inline-grid',
              placeItems: 'center',
              fontWeight: 800,
              fontSize: 13,
              letterSpacing: '-0.02em',
              flexShrink: 0,
            }}
          >
            КС
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--fg)',
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title="Бухгалтерия"
            >
              Бухгалтерия
            </div>
            {clinicName && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--fg-3)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginTop: 2,
                }}
                title={clinicName}
              >
                {clinicName}
              </div>
            )}
          </div>
          {isMobile && (
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Закрыть меню"
              style={{
                width: 32,
                height: 32,
                display: 'inline-grid',
                placeItems: 'center',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--fg-2)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
            </button>
          )}
        </div>

        {/* Меню */}
        <nav style={{ padding: '12px 8px', flex: 1, overflowY: 'auto' }}>
          {ACC_NAV.map(item => {
            const isActive = active === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleNav(item.path)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  marginBottom: 2,
                  borderRadius: 10,
                  background: isActive ? ACC_ACCENT_SOFT : 'transparent',
                  borderLeft: isActive
                    ? `3px solid ${ACC_ACCENT}`
                    : '3px solid transparent',
                  color: isActive ? ACC_ACCENT : 'var(--fg-2)',
                  fontSize: 13.5,
                  fontWeight: isActive ? 700 : 500,
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background 0.12s ease, color 0.12s ease',
                }}
                onMouseEnter={e => {
                  if (!isActive && !isMobile) e.currentTarget.style.background = 'var(--bg-1)'
                }}
                onMouseLeave={e => {
                  if (!isActive && !isMobile) e.currentTarget.style.background = 'transparent'
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 20,
                    color: isActive ? ACC_ACCENT : 'var(--fg-3)',
                    fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0",
                    flexShrink: 0,
                  }}
                >
                  {item.icon}
                </span>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.label}
                </span>
              </button>
            )
          })}
        </nav>

        {/* Footer: юзер + выход */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
          {userName && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--fg-3)',
                marginBottom: 8,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={userName}
            >
              {userName}
            </div>
          )}
          <button
            type="button"
            onClick={logout}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 9,
              background: 'var(--bg-1)',
              border: '1px solid var(--border)',
              color: 'var(--fg-2)',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>logout</span>
            Выйти
          </button>
        </div>
      </aside>

      {/* ─── Контент ─── */}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          padding: isMobile ? '16px 14px 40px' : '24px 28px 48px',
          overflowX: 'auto',
        }}
      >
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>{children}</div>
      </main>
    </div>
  )
}
