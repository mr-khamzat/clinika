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
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import { Page, Chip } from '../design'
// W3: глобальный поиск Cmd+K и центр уведомлений
import CommandPalette from '../components/CommandPalette'
import NotificationsBell from '../components/NotificationsBell'

// ─── Карта разделов (синхронизирована с ManagerDashboard) ───
// Поле `group` группирует разделы для виджета «Быстрые переходы» и drawer «Ещё».
// Ключи групп описаны в MGR_NAV_GROUPS (см. ниже).
export const MGR_NAV = [
  { key:'analytics',    label:'Аналитика', icon:'bar_chart',    path:'/manager/analytics',     group:'reports' },
  { key:'kpi',          label:'KPI',       icon:'emoji_events', path:'/manager/kpi',           group:'reports' },
  { key:'activity',     label:'Журнал',    icon:'article',      path:'/manager/activity',      group:'reports' },
  { key:'bonuses',      label:'Выплаты',   icon:'payments',     path:'/manager/bonuses',       group:'finance' },
  { key:'history',      label:'История',   icon:'history',      path:'/manager/history',       group:'reports' },
  { key:'settings',     label:'Настройки', icon:'tune',         path:'/manager/settings',      group:'settings' },
  { key:'invoices',     label:'Счета',     icon:'receipt_long', path:'/manager/invoices',      group:'finance' },
  // Согласование межклиничных счетов (бонусы от других клиник сети)
  { key:'invoice_approvals', label:'Счета на согласование', icon:'gavel', path:'/manager/invoice-approvals', group:'finance' },
  // svcfin01: финансовая модель платформы — счета платформе/сети/сотрудникам
  { key:'finance',      label:'Финансы',   icon:'account_balance', path:'/manager/finance',    group:'finance' },
  // billingledger01: журнал биллинг-операций франшизы (append-only)
  { key:'billing_ledger', label:'Журнал биллинга', icon:'receipt_long', path:'/manager/finance/ledger', group:'finance' },
  // Наличная активация подписки «Здоровье+/Семья+/Pro» (касса клиники, печать квитанции)
  { key:'subscription_cash', label:'Подписки (наличные)', icon:'payments', path:'/manager/subscription-cash', group:'subscriptions' },
  // Очередь заявок на подписку (ручное одобрение менеджером)
  { key:'subscription_pending', label:'Заявки на тариф', icon:'pending_actions', path:'/manager/subscription-pending', group:'subscriptions' },
  // discountrules01 — категорные скидки тарифа подписки «Здоровье+»
  { key:'subscription_discounts', label:'Скидки тарифов', icon:'percent', path:'/manager/subscription/discounts', group:'subscriptions' },
  // miswebhook01 — интеграции МИС: вебхуки на события подписки
  { key:'mis_webhooks', label:'Интеграции с МИС', icon:'webhook', path:'/manager/integrations/mis', group:'integrations' },
  // Телефония — PSTN-провайдер (Mango/Sipuni/...), DID-номера, история звонков
  { key:'telephony', label:'Телефония', icon:'phone', path:'/manager/telephony', group:'integrations' },
  { key:'doctors',      label:'Врачи (расписание)', icon:'stethoscope', path:'/manager/doctors',         group:'team' },
  { key:'recruit',      label:'Сотрудники',     icon:'groups',         path:'/manager/recruit-doctors',  group:'team' },
  { key:'visiting',     label:'Приезжие врачи', icon:'travel_explore', path:'/manager/visiting-doctors', group:'team' },
  { key:'partners',     label:'Врачи-партнёры', icon:'handshake',      path:'/manager/partner-doctors',  group:'team' },
  // partneroffers01 — Партнёрский прайс: категории + офферы (для бонусов внешним врачам)
  { key:'partner_offers', label:'Партнёрский прайс', icon:'price_change', path:'/manager/partner-offers', group:'team' },
  { key:'appointments', label:'Записи',    icon:'event',        path:'/manager/appointments',  group:'schedule' },
  // Глава 4 — Manager productivity
  { key:'kanban',       label:'Kanban-расписание', icon:'view_kanban',  path:'/manager/kanban',      group:'schedule' },
  { key:'doctor-load',  label:'Загрузка врачей',    icon:'timeline',     path:'/manager/doctor-load', group:'schedule' },
  { key:'templates',    label:'Шаблоны направлений', icon:'dynamic_form', path:'/manager/templates',  group:'schedule' },
  { key:'multi-clinic', label:'Все клиники',         icon:'domain',       path:'/manager/multi-clinic', requiresMultiClinic: true, group:'settings' },
  { key:'forecast',     label:'Прогноз расходов',    icon:'trending_up',  path:'/manager/forecast',    group:'finance' },
  // Глава 7 — Регламент-конструктор: «Мои регламенты» для управляющего
  { key:'regulations',  label:'Регламенты',          icon:'rule',         path:'/manager/regulations', group:'settings' },
  // Глава 8 — Программа лояльности (Награды + Лидерборд + Claims + Manual Adjust)
  { key:'loyalty',      label:'Лояльность',          icon:'workspace_premium', path:'/manager/loyalty', group:'subscriptions' },
  // Глава 9 — Чат с пациентами (премиум-чат клиники)
  { key:'chat',         label:'Чат пациентов',       icon:'forum',             path:'/manager/chat',    group:'communications' },
  // Workflow — шаблоны ответов и SLA-настройки чата
  { key:'chat-templates', label:'Шаблоны ответов',   icon:'dynamic_form',      path:'/manager/chat-templates', group:'communications' },
  { key:'chat-settings',  label:'Настройки чата',    icon:'tune',              path:'/manager/chat-settings',  group:'communications' },
  // Глава 10 — Лабораторные интеграции: CRUD провайдеров (Invitro/KDL/...)
  { key:'lab',          label:'Лаборатории',         icon:'science',           path:'/manager/lab',     group:'integrations' },
  // Глава 10 — Агрегаторы лидов: входящие заявки от DocDoc/ПроДокторов/Yandex Health
  { key:'aggregator',   label:'Заявки агрегаторов',  icon:'campaign',          path:'/manager/aggregator', group:'communications' },
  // Этап 0 интеграции с 1С — Склад: товары + импорт Excel/CSV
  { key:'inventory',    label:'Склад',               icon:'inventory_2',       path:'/manager/inventory',           group:'inventory' },
  { key:'inventory_receipts', label:'Приходы',          icon:'local_shipping',    path:'/manager/inventory/receipts', group:'inventory' },
  { key:'inventory_batches', label:'Партии',            icon:'inventory',         path:'/manager/inventory/batches',  group:'inventory' },
  { key:'suppliers',    label:'Поставщики',         icon:'business',          path:'/manager/suppliers',           group:'inventory' },
  { key:'service_norms', label:'Нормативы услуг',    icon:'tune',              path:'/manager/services/norms',      group:'inventory' },
  // Маркетинг — расходы на рекламу, каналы привлечения, атрибуция пациентов
  { key:'marketing',    label:'Маркетинг',           icon:'campaign',          path:'/manager/marketing', group:'marketing' },
]

// ─── Метаданные групп навигации (порядок = порядок отображения) ───
// Используются в ManagerDashboard (Quick Actions) и drawer «Ещё» для группировки.
export const MGR_NAV_GROUPS = [
  { key:'reports',        label:'Отчётность',            icon:'monitoring' },
  { key:'schedule',       label:'Расписание',            icon:'calendar_month' },
  { key:'team',           label:'Команда',               icon:'groups' },
  { key:'finance',        label:'Финансы',               icon:'account_balance' },
  { key:'subscriptions',  label:'Подписки и лояльность', icon:'card_membership' },
  { key:'inventory',      label:'Склад',                 icon:'inventory_2' },
  { key:'marketing',      label:'Маркетинг',             icon:'campaign' },
  { key:'communications', label:'Коммуникации',          icon:'forum' },
  { key:'integrations',   label:'Интеграции',            icon:'cable' },
  { key:'settings',       label:'Настройки',             icon:'settings' },
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
  // Глава 4: скрываем пункт «Все клиники» если у юзера ≤1 клиники
  const [accessibleClinicsCount, setAccessibleClinicsCount] = useState(null)
  useEffect(() => {
    let alive = true
    api.get('/manager/clinics-accessible')
      .then(r => { if (alive) setAccessibleClinicsCount(Array.isArray(r.data) ? r.data.length : 0) })
      .catch(() => { if (alive) setAccessibleClinicsCount(0) })
    return () => { alive = false }
  }, [])
  const visibleMoreItems = moreItems.filter(it => {
    if (it.requiresMultiClinic) return (accessibleClinicsCount ?? 0) > 1
    return true
  })

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
          {/* W3: центр уведомлений — общий dropdown в шапке менеджера */}
          <NotificationsBell size={36} variant="square" />
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
            {/* Сгруппированный список по MGR_NAV_GROUPS — drawer уже модальный, скролл вертикальный */}
            <div className="px-4 pb-6 overflow-y-auto" style={{ maxHeight: '70vh' }}>
              {MGR_NAV_GROUPS.map(group => {
                const items = visibleMoreItems.filter(it => it.group === group.key)
                if (items.length === 0) return null
                return (
                  <div key={group.key} className="mb-4">
                    <div className="flex items-center gap-2 px-1 mb-2">
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color:'var(--accent)' }}>{group.icon}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {group.label}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>({items.length})</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {items.map(item => (
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
                )
              })}
              {/* Хвост: пункты без group (если вдруг) */}
              {(() => {
                const orphans = visibleMoreItems.filter(it => !it.group)
                if (orphans.length === 0) return null
                return (
                  <div className="mb-4">
                    <div className="px-1 mb-2" style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Прочее
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {orphans.map(item => (
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
                )
              })()}
            </div>
          </div>
        </>
      )}
      {/* W3: глобальный поиск Cmd+K — слушает hotkey на window */}
      <CommandPalette />
    </Page>
  )
}
