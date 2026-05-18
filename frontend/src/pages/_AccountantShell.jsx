/**
 * ========================================
 * БЛОК: <AccountantShell> — корпус кабинета бухгалтера
 * ========================================
 * Шелл с боковым sidebar (220px) для всех страниц бухгалтера.
 * Использование:
 *   <AccountantShell active="cash">
 *     ...content...
 *   </AccountantShell>
 *
 * Пункты меню: summary / cash / acts / payments / payroll / spending / reports.
 * Акцент — бирюзовый (#0097A7). Активный пункт — заливка var(--accent-soft)
 * + левая рамка цветом акцента.
 * Кнопка «Выйти» снизу очищает токен и редиректит на /{slug}/login.
 * ========================================
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import { SLUG } from '../config'

// ─── Карта разделов кабинета бухгалтера ─────────────────────────────────────
export const ACC_NAV = [
  { key: 'summary',  label: 'Сводка',   icon: 'dashboard',     path: '/accountant/summary'  },
  { key: 'cash',     label: 'Касса',    icon: 'point_of_sale', path: '/accountant/cash'     },
  { key: 'acts',     label: 'Акты',     icon: 'description',   path: '/accountant/acts'     },
  { key: 'payments', label: 'Платежи',  icon: 'payments',      path: '/accountant/payments' },
  { key: 'payroll',  label: 'Зарплата', icon: 'group',         path: '/accountant/payroll'  },
  { key: 'spending', label: 'Расходы',  icon: 'receipt_long',  path: '/accountant/spending' },
  { key: 'reports',  label: 'Отчёты',   icon: 'analytics',     path: '/accountant/reports'  },
]

// Цвет акцента бухгалтерии (бирюзовый) — переопределяет --accent внутри shell
const ACC_ACCENT = '#0097A7'
const ACC_ACCENT_SOFT = 'rgba(0, 151, 167, 0.10)'
const ACC_ACCENT_LINE = 'rgba(0, 151, 167, 0.28)'

function logout() {
  try {
    localStorage.removeItem('clinika_token_' + SLUG)
    localStorage.removeItem('clinika_admin_token_' + SLUG)
    localStorage.removeItem('clinika_refresh_token_' + SLUG)
    localStorage.removeItem('clinika_admin_refresh_token_' + SLUG)
  } catch (_) { /* noop */ }
  window.location.href = '/' + SLUG + '/login'
}

export default function AccountantShell({ active, children }) {
  const nav = useNavigate()
  const [clinicName, setClinicName] = useState('')
  const [userName, setUserName] = useState('')

  useEffect(() => {
    let alive = true
    api.get('/admins/me')
      .then(r => {
        if (!alive) return
        const u = r?.data || {}
        setClinicName(u?.clinic?.name || u?.clinic_name || '')
        setUserName(u?.full_name || u?.name || u?.email || '')
      })
      .catch(() => { /* anon */ })
    return () => { alive = false }
  }, [])

  return (
    <div
      style={{
        // переопределяем акцент-токены внутри кабинета бухгалтера
        ['--accent']: ACC_ACCENT,
        ['--accent-soft']: ACC_ACCENT_SOFT,
        ['--accent-line']: ACC_ACCENT_LINE,
        minHeight: '100vh',
        display: 'flex',
        background: 'var(--bg)',
        color: 'var(--fg)',
      }}
    >
      {/* ─── Sidebar ─── */}
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
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
        </div>

        {/* Меню */}
        <nav style={{ padding: '12px 8px', flex: 1, overflowY: 'auto' }}>
          {ACC_NAV.map(item => {
            const isActive = active === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => nav(item.path)}
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
                  if (!isActive) e.currentTarget.style.background = 'var(--bg-1)'
                }}
                onMouseLeave={e => {
                  if (!isActive) e.currentTarget.style.background = 'transparent'
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
      <main style={{ flex: 1, minWidth: 0, padding: '24px 28px 48px', overflowX: 'auto' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>{children}</div>
      </main>
    </div>
  )
}
