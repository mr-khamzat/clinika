/**
 * ========================================
 * БЛОК: <ManagerShell> — общий «корпус» под-страниц кабинета управляющего
 * ========================================
 * Используется в ManagerBonuses, ManagerActivity, ManagerInvoices, ManagerSettings,
 * ManagerKPI, ManagerHistory, ManagerAnalytics, ManagerRecruitDoctors, ManagerAppointments.
 *
 * Структура:
 *   <Page>
 *     ─ Sticky topbar с кнопкой «← Назад» и иконкой раздела
 *     ─ контейнер max-w-1280 с padding и отступом под bottom-nav
 *     ─ slot {children}
 *
 * Также рендерит mobile bottom-nav (с активным разделом по `active` prop)
 * и drawer «Ещё» — единые на все экраны.
 * ========================================
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Page, Chip } from '../design'

// ─── Карта разделов (синхронизирована с ManagerDashboard) ───
export const MGR_NAV = [
  { key:'analytics',    label:'Аналитика', icon:'bar_chart',    path:'/manager/analytics' },
  { key:'kpi',          label:'KPI',       icon:'emoji_events', path:'/manager/kpi' },
  { key:'activity',     label:'Журнал',    icon:'article',      path:'/manager/activity' },
  { key:'bonuses',      label:'Выплаты',   icon:'payments',     path:'/manager/bonuses' },
  { key:'history',      label:'История',   icon:'history',      path:'/manager/history' },
  { key:'settings',     label:'Настройки', icon:'tune',         path:'/manager/settings' },
  { key:'invoices',     label:'Счета',     icon:'receipt_long', path:'/manager/invoices' },
  { key:'recruit',      label:'Врачи',     icon:'groups',       path:'/manager/recruit-doctors' },
  { key:'appointments', label:'Записи',    icon:'event',        path:'/manager/appointments' },
]
const BOTTOM_KEYS = ['analytics', 'bonuses', 'kpi', 'history']
const bottomItems = BOTTOM_KEYS.map(k => MGR_NAV.find(n => n.key === k)).filter(Boolean)
const moreItems   = MGR_NAV.filter(n => !BOTTOM_KEYS.includes(n.key))

export default function ManagerShell({
  active,            // ключ активного раздела (analytics/kpi/...) — подсвечивает в bottom-nav
  title,             // заголовок раздела (для sticky-topbar)
  subtitle,          // подзаголовок (опц.)
  icon,              // material-symbol для иконки в topbar
  badge,             // ReactNode рядом с заголовком (опц.)
  topbarRight,       // ReactNode для правой части топбара (опц., desktop)
  children,
}) {
  const nav = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <Page>
      {/* ─── Sticky topbar ─── */}
      <header
        className="sticky top-0 z-20 px-4 sm:px-6 py-3 sm:py-4"
        style={{
          background: 'oklch(1 0 0 / 0.85)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="flex items-center gap-3 max-w-[1280px] mx-auto">
          <button
            type="button"
            onClick={() => nav('/manager')}
            className="inline-grid place-items-center transition-transform active:scale-95 flex-shrink-0"
            style={{
              width: 36, height: 36, borderRadius: 9,
              background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--fg-2)',
            }}
            aria-label="Назад в кабинет управляющего"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>arrow_back</span>
          </button>
          {icon && (
            <span
              className="inline-grid place-items-center flex-shrink-0"
              style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'var(--accent-soft)', color: 'var(--accent)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
                {icon}
              </span>
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate flex items-center gap-2" style={{ fontSize: 15, color: 'var(--fg)', letterSpacing: '-0.01em' }}>
              <span className="truncate">{title}</span>
              {badge && <span className="flex-shrink-0">{badge}</span>}
            </div>
            {subtitle && (
              <div className="text-[11px] truncate" style={{ color: 'var(--fg-3)' }}>
                {subtitle}
              </div>
            )}
          </div>
          {topbarRight && <div className="hidden sm:flex flex-shrink-0">{topbarRight}</div>}
        </div>
      </header>

      {/* ─── Контент ─── */}
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-28">
        {children}
      </div>

      {/* ─── Mobile bottom-nav ─── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 sm:hidden"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
          background: 'oklch(1 0 0 / 0.95)',
          backdropFilter: 'blur(20px)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div className="flex">
          <button
            onClick={() => nav('/manager')}
            className="flex-1 flex flex-col items-center pt-2 pb-1.5 gap-0.5 relative"
          >
            {active === 'home' && (
              <span
                className="absolute top-0 left-1/2 -translate-x-1/2"
                style={{ width: 28, height: 2, borderRadius: 999, background: 'var(--accent)' }}
              />
            )}
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 22,
                color: active === 'home' ? 'var(--accent)' : 'var(--fg-3)',
                fontVariationSettings: active === 'home' ? "'FILL' 1" : "'FILL' 0",
              }}
            >
              home
            </span>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: active === 'home' ? 700 : 600,
                color: active === 'home' ? 'var(--accent)' : 'var(--fg-3)',
              }}
            >
              Главная
            </span>
          </button>
          {bottomItems.map(item => {
            const isActive = active === item.key
            return (
              <button
                key={item.key}
                onClick={() => nav(item.path)}
                className="flex-1 flex flex-col items-center pt-2 pb-1.5 gap-0.5 relative"
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
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: isActive ? 700 : 600,
                    color: isActive ? 'var(--accent)' : 'var(--fg-3)',
                  }}
                >
                  {item.label}
                </span>
              </button>
            )
          })}
          <button onClick={() => setMoreOpen(true)} className="flex-1 flex flex-col items-center pt-2 pb-1.5 gap-0.5">
            <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'var(--fg-3)' }}>more_horiz</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--fg-3)' }}>Ещё</span>
          </button>
        </div>
      </nav>

      {/* ─── Drawer «Ещё» ─── */}
      {moreOpen && (
        <>
          <div className="fixed inset-0 z-40" style={{ background: 'oklch(0 0 0 / 0.4)' }} onClick={() => setMoreOpen(false)} />
          <div
            className="fixed bottom-0 left-0 right-0 z-50 sm:hidden"
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
            <div className="grid grid-cols-3 gap-3 px-4 pb-6">
              {moreItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => { nav(item.path); setMoreOpen(false) }}
                  className="flex flex-col items-center gap-2 p-3 transition-transform active:scale-95"
                  style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 14 }}
                >
                  <span
                    className="inline-grid place-items-center"
                    style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
                      {item.icon}
                    </span>
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg-2)', textAlign: 'center', lineHeight: 1.2 }}>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </Page>
  )
}
