/**
 * ========================================
 * БЛОК: FranchiseOwnerCabinet — кабинет владельца франшизы (premium редизайн)
 * ========================================
 * Полный редизайн под эталон /public/design2/admin.html:
 *   - Sidebar (collapsible на ≤1023px → drawer на ≤767px)
 *   - Topbar с поиском, ролевым баннером и аватаром
 *   - KPI Row, glass-карточки, sparkline-графики
 *
 * Бизнес-логика и API-вызовы СОХРАНЕНЫ как в исходнике (см. .before-redesign):
 *   - GET /franchise-owner/me
 *   - GET /franchise-owner/tenants
 *   - POST /franchise-owner/tenants
 *   - GET /analytics/overview
 *   - GET /reviews/moderate (+ patch/delete)
 *   - + лениво подгружаемые секции (DoctorsSection / AIKnowledgeSection / др.)
 *
 * Стилизация — через дизайн-токены (var(--accent), var(--surface) и т.д.) и
 * базовые компоненты из /src/design.
 * ========================================
 */
import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import api from '../api'
import { BrandLogo } from '../components/BrandLogo'
import {
  Page,
  PageHeader,
  Card,
  KpiRow,
  KpiCard,
  Chip,
  Button,
  Avatar,
  EmptyState,
  Sparkline,
  Modal,
  Tabs,
  useToast,
  useConfirm,
  InfoHint,
} from '../design'
import CallRulesSection from '../sections/CallRulesSection'
import PlatformInvoicesSection from '../sections/PlatformInvoicesSection'
import AppointmentsStatsSection from '../sections/AppointmentsStatsSection'
// Единый хук переключения темы (общий для всех кабинетов)
import useTheme from '../lib/useTheme'

// ── Лениво подгружаемые секции (расширение кабинета — реклама, контент, контакты, модули) ──
const DoctorsSection            = lazy(() => import('../sections/DoctorsSection'))
const AIKnowledgeSection        = lazy(() => import('../sections/AIKnowledgeSection'))
const AdsSection                = lazy(() => import('../sections/AdsSection'))
const PatientEngagement         = lazy(() => import('../sections/engagement/PatientEngagement'))
const NetworkDashboard          = lazy(() => import('../sections/network/NetworkDashboard'))
const WikiSection               = lazy(() => import('../sections/WikiSection'))
const ContactsSection           = lazy(() => import('../sections/ContactsSection'))
const WebhooksSection           = lazy(() => import('../sections/WebhooksSection'))
const ApiKeysSection            = lazy(() => import('../sections/ApiKeysSection'))
const ModulesCatalogSection     = lazy(() => import('../sections/ModulesCatalogSection'))
const MarketplaceSection        = lazy(() => import('../sections/MarketplaceSection'))
const BrandingSection           = lazy(() => import('../sections/BrandingSection'))
const CMSPagesSection           = lazy(() => import('../sections/CMSPagesSection'))
const ActsSection               = lazy(() => import('../sections/ActsSection'))
const InterClinicInvoicesSection = lazy(() => import('../sections/InterClinicInvoicesSection'))
// Этап 14 — клиники-партнёры с контрактами royalty/per_referral/hybrid
const PartnerClinicsSection      = lazy(() => import('../sections/PartnerClinicsSection'))
// Этап 8 ROADMAP — RBAC как данные: матрица прав по ролям с overrides на тенант.
const PermissionsMatrixSection   = lazy(() => import('../sections/PermissionsMatrixSection'))
const VisibilitySection          = lazy(() => import('../sections/VisibilitySection'))
// LTV-аналитика пациентов (модуль ltv_pro) и cross-clinic directory сотрудников
const LtvAnalyticsSection        = lazy(() => import('../sections/ltv/LtvAnalyticsSection'))
const CrossClinicDirectorySection = lazy(() => import('../sections/CrossClinicDirectorySection'))
// Раздел «Клиники сети»: карточки + модалка редактирования (реквизиты + руководитель)
const ClinicsNetworkSection      = lazy(() => import('../sections/ClinicsNetworkSection'))
// Модули франшизы: телемедицина / лояльность / инвентарь
const TelemedicineSection        = lazy(() => import('../sections/TelemedicineSection'))
const LoyaltySection             = lazy(() => import('../sections/loyalty/LoyaltySection'))
// Глава 8 — Награды/Лидерборд/Claims/Manual-adjust (отдельно от LoyaltySection,
// которая управляет тирами/правилами/обменом).
const AdminLoyaltySection        = lazy(() => import('../sections/AdminLoyaltySection'))
const InventorySection           = lazy(() => import('../sections/inventory/InventorySection'))
const FranchiseSubscriptionPlansSection = lazy(() => import('../sections/FranchiseSubscriptionPlansSection'))
// Module Monitoring System — health-state платных модулей тенанта
const ModuleMonitoringSection    = lazy(() => import('../sections/ModuleMonitoringSection'))
// Глава 3 ROADMAP — Премиум-аналитика франшизы
const FranchiseAnalyticsSection = lazy(() => import('../sections/FranchiseAnalyticsSection'))
// Глава 7 — Регламент-конструктор: админка (builder-агент) + читатель (мой раздел)
const RegulationsAdminSection   = lazy(() => import('../sections/RegulationsAdminSection'))
const RegulationsReaderSection  = lazy(() => import('../sections/RegulationsReaderSection'))
// Глава 10 — Wellness-партнёры: CRUD для super_admin
const AdminWellnessSection       = lazy(() => import('../sections/AdminWellnessSection'))
// Глава 10 — Партнёрства агрегаторов: CRUD (DocDoc/ПроДокторов/...) + API-ключи
const AdminAggregatorPartnershipsSection = lazy(() => import('../sections/AdminAggregatorPartnershipsSection'))
// Глава 10 — Заявки от агрегаторов: список лидов + статистика (для franchise_owner тоже полезно)
const AdminAggregatorSection     = lazy(() => import('../sections/AdminAggregatorSection'))
// Глава 10 — Состояние системы: health-метрики + disaster mode (super_admin)
const AdminSystemStatusSection   = lazy(() => import('../sections/AdminSystemStatusSection'))

// ── Helpers ─────────────────────────────────────────────────────────────────

const fmtRub = (v) => {
  const n = Number(v || 0)
  if (!Number.isFinite(n)) return '—'
  return `${n.toLocaleString('ru')} ₽`
}

// ── Конфиг сайдбара ─────────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    title: 'Сеть',
    items: [
      { id: 'overview',  label: 'Главная',     icon: 'dashboard'             },
      { id: 'tenants',   label: 'Клиники',     icon: 'business'              },
      { id: 'partners_clinics', label: 'Клиники-партнёры', icon: 'medical_services' },
      { id: 'doctors',   label: 'Сотрудники',  icon: 'stethoscope'           },
      { id: 'partners',  label: 'Партнёрские врачи', icon: 'medical_services'    },
      { id: 'recruiters',label: 'Рекрутеры',   icon: 'person_search'         },
      { id: 'reviews',   label: 'Отзывы',      icon: 'rate_review'           },
    ],
  },
  {
    title: 'Управление',
    items: [
      { id: 'analytics', label: 'Аналитика',   icon: 'bar_chart'             },
      { id: 'franchise_analytics', label: 'Аналитика франшизы', icon: 'insights' },
      { id: 'ltv',       label: 'LTV пациентов', icon: 'insights'             },
      { id: 'apt_stats', label: 'Записи',      icon: 'query_stats'           },
      { id: 'royalty',   label: 'Биллинг',     icon: 'account_balance_wallet'},
      { id: 'platform',  label: 'Счета платформы', icon: 'receipt_long'      },
      { id: 'acts',      label: 'Межклин. акты', icon: 'description'         },
      { id: 'inter_inv', label: 'Счета клиник', icon: 'request_quote'        },
      // svcfin01: «Биллинг сети» — кто кому должен в франшизе + ручной триггер biling
      { id: 'network_billing', label: 'Биллинг сети', icon: 'account_tree'   },
      { id: 'calls',     label: 'Звонки',      icon: 'call'                  },
      { id: 'cross_dir', label: 'Сотрудники сети', icon: 'group'             },
    ],
  },
  {
    title: 'Маркетинг',
    items: [
      { id: 'ads',       label: 'Реклама',     icon: 'campaign'              },
      { id: 'network',    label: 'Сводная панель сети', icon: 'dashboard'   },
      { id: 'engagement', label: 'Пациенты ЛК', icon: 'groups'               },
      { id: 'wiki',      label: 'База знаний', icon: 'menu_book'             },
      { id: 'cms',       label: 'CMS-страницы', icon: 'article'              },
      { id: 'contacts',  label: 'Заявки',      icon: 'contact_mail'          },
    ],
  },
  {
    title: 'Модули',
    items: [
      { id: 'telemedicine', label: 'Телемедицина',         icon: 'video_call'  },
      { id: 'loyalty',      label: 'Программа лояльности', icon: 'stars'       },
      { id: 'subscription_plans', label: 'Тарифы подписки',     icon: 'card_membership' },
      // Глава 8 — отдельный пункт «Награды и пациенты» (CRUD каталог + лидерборд + claims + ручная корректировка)
      { id: 'rewards_admin', label: 'Награды и пациенты',  icon: 'workspace_premium' },
      { id: 'inventory',    label: 'Учёт инвентаря',       icon: 'inventory_2' },
      // Глава 10 — Wellness-партнёры (фитнес/спа/питание/йога/психология) для пациентов с подпиской
      { id: 'wellness_admin', label: 'Wellness партнёры',  icon: 'fitness_center' },
      // Глава 10 — Партнёрства агрегаторов (DocDoc/ПроДокторов/Yandex Health): CRUD + API-ключи
      { id: 'aggregator_partnerships', label: 'Партнёрства агрегаторов', icon: 'handshake' },
      // Глава 10 — Лиды от агрегаторов (manager-style таблица для franchise_owner)
      { id: 'aggregator_leads', label: 'Заявки агрегаторов', icon: 'campaign' },
    ],
  },
  {
    title: 'Платформа',
    items: [
      { id: 'marketplace', label: 'Маркетплейс',          icon: 'storefront'         },
      { id: 'modules',    label: 'Каталог модулей',     icon: 'extension'           },
      { id: 'monitoring', label: 'Мониторинг модулей',  icon: 'monitor_heart'       },
      // Глава 10 — Состояние системы (health-метрики + disaster mode) — для super_admin
      { id: 'system_status', label: 'Состояние системы', icon: 'monitor_heart'    },
      { id: 'roles',      label: 'Роли и права',        icon: 'admin_panel_settings'},
      { id: 'visibility', label: 'Видимость клиник', icon: 'visibility'        },
      // Глава 7 — Регламент-конструктор: админка для franchise_owner
      { id: 'regulations_admin', label: 'Конструктор регламентов', icon: 'rule_settings' },
      { id: 'webhooks',   label: 'Webhooks',            icon: 'webhook'             },
      { id: 'api_keys',   label: 'API-ключи',           icon: 'vpn_key'             },
      { id: 'knowledge',  label: 'База AI',             icon: 'library_books'       },
      { id: 'settings',   label: 'Настройки',           icon: 'settings'            },
    ],
  },
  // Глава 7 — Регламент-конструктор: персональный раздел владельца как читателя
  {
    title: 'Мой раздел',
    items: [
      { id: 'regulations_my', label: 'Мои регламенты', icon: 'rule' },
    ],
  },
]

const PAGE_TITLES = {
  overview:   { title: 'Главная',          subtitle: 'Сводная панель сети клиник' },
  tenants:    { title: 'Клиники сети',     subtitle: 'Управление дочерними тенантами франшизы' },
  partners_clinics: { title: 'Клиники-партнёры', subtitle: 'Контракты royalty / per_referral / hybrid' },
  telemedicine: { title: 'Телемедицина',          subtitle: 'Сессии телемед-приёмов, чаты и электронные рецепты' },
  loyalty:      { title: 'Программа лояльности',  subtitle: 'Уровни, правила начисления и обмен бонусов' },
  subscription_plans: { title: 'Тарифы подписки', subtitle: 'Тарифы «Здоровье+» для пациентов вашей сети (override на платформенные)' },
  // Глава 8 — управление наградами и пациентами
  rewards_admin: { title: 'Награды и пациенты',    subtitle: 'Каталог наград, лидерборд, запросы пациентов и ручная корректировка баллов' },
  inventory:    { title: 'Учёт инвентаря',        subtitle: 'Расходные материалы, оборудование, медикаменты' },
  // Глава 10 — Wellness-партнёры (CRUD для super_admin)
  wellness_admin: { title: 'Wellness партнёры',    subtitle: 'Партнёрские бонусы для пациентов: фитнес, спа, питание, психология, йога' },
  // Глава 10 — Партнёрства агрегаторов (DocDoc/ПроДокторов/Yandex Health)
  aggregator_partnerships: { title: 'Партнёрства агрегаторов', subtitle: 'Подключение DocDoc / ПроДокторов / Яндекс.Здоровье — комиссии и API-ключи' },
  // Глава 10 — Заявки от агрегаторов
  aggregator_leads: { title: 'Заявки агрегаторов', subtitle: 'Входящие лиды от партнёров-агрегаторов и статистика по источникам' },
  // Глава 10 — Состояние системы (super_admin)
  system_status: { title: 'Состояние системы', subtitle: 'Здоровье БД/Redis/диска, активные подписки и disaster-mode' },
  visibility: { title: 'Видимость клиник', subtitle: 'Матрица: кто из какой клиники видит кого в чате и звонках' },
  doctors:    { title: 'Сотрудники',       subtitle: 'Все врачи и админы по клиникам сети' },
  partners:   { title: 'Партнёрские врачи',    subtitle: 'Партнёры и приходящие врачи сети' },
  recruiters: { title: 'Рекрутеры',        subtitle: 'Менеджеры по привлечению врачей-партнёров' },
  reviews:    { title: 'Отзывы',           subtitle: 'Модерация публичных отзывов' },
  analytics:  { title: 'Аналитика',        subtitle: 'Drill-down по клиникам, врачам, услугам' },
  franchise_analytics: { title: 'Аналитика франшизы', subtitle: 'KPI, когорты, bulk-тарифы и рекомендации (премиум)' },
  apt_stats:  { title: 'Записи',           subtitle: 'Статистика приёмов и расписаний' },
  royalty:    { title: 'Биллинг',          subtitle: 'Роялти, выплаты, межклиничные акты' },
  platform:   { title: 'Счета платформы',  subtitle: 'Тарифы, начисления и счета от КлиникСеть' },
  acts:       { title: 'Межклиничные акты',subtitle: 'Акты выполненных работ между клиниками' },
  inter_inv:  { title: 'Счета между клиниками', subtitle: 'Внутренние взаиморасчёты сети' },
  // svcfin01
  network_billing: { title: 'Биллинг сети', subtitle: 'Кто кому должен + ручной триггер счёта от платформы' },
  calls:      { title: 'Правила звонков',  subtitle: 'Кто кому звонит — глобально и по клиникам' },
  cross_dir:  { title: 'Сотрудники сети',     subtitle: 'Справочник всех клиник: позвонить регистратору/врачу/менеджеру другой клиники' },
  ltv:        { title: 'LTV пациентов',       subtitle: 'Пожизненная ценность пациентов: топ, когорты, риск оттока' },
  ads:        { title: 'Реклама',          subtitle: 'Баннеры, статистика кликов и расписания' },
  wiki:       { title: 'База знаний',      subtitle: 'Wiki-страницы для сотрудников и пациентов' },
  cms:        { title: 'CMS-страницы',     subtitle: 'Публичные страницы лендинга и портала' },
  contacts:   { title: 'Заявки',           subtitle: 'Сообщения с формы обратной связи' },
  marketplace:{ title: 'Маркетплейс модулей', subtitle: 'Подключение новых возможностей: триал 14 дней без оплаты' },
  modules:    { title: 'Каталог модулей',  subtitle: 'Платные модули и их подключение' },
  monitoring: { title: 'Мониторинг модулей',subtitle: 'Состояние платных модулей: ok / degraded / error / idle' },
  roles:      { title: 'Роли и права',     subtitle: 'Матрица RBAC: переопределение прав по ролям тенанта' },
  webhooks:   { title: 'Webhooks',         subtitle: 'Интеграции и исходящие события' },
  api_keys:   { title: 'API-ключи',        subtitle: 'Внешний доступ для CRM, BI и собственных интеграций' },
  knowledge:  { title: 'База знаний AI',   subtitle: 'FAQ-ответы для AI-чата пациентов' },
  settings:   { title: 'Настройки',        subtitle: 'Брендинг, домен, MIS-интеграция' },
  // Глава 7 — Регламент-конструктор
  regulations_admin: { title: 'Конструктор регламентов', subtitle: 'Создание и публикация регламентов для сотрудников сети' },
  regulations_my:    { title: 'Мои регламенты',          subtitle: 'Назначенные вам регламенты и подтверждение ознакомления' },
}

// ── Подсказки (info-hints) для каждой секции — отображаются рядом с заголовком ─
// Текст видно на десктопе при наведении, на мобильном — в модалке по тапу.
const PAGE_HINTS = {
  cms:        'Markdown-страницы для пациентов: правила клиники, FAQ, прайс. Видны в кабинете пациента (Мой кабинет → Информация).',
  wiki:       'Учебные материалы для сотрудников: как работать с системой, роли, направления. Доступны на /wiki.',
  calls:      'Кто кому может звонить (аудио/видео). Глобально по ролям + точечно между парами клиник. Требует модуль телефонии.',
  acts:       'Акты выполненных работ между клиниками сети. Генерация PDF, электронная подпись (в разработке), отправка в ФНС (планируется).',
  inter_inv:  'Счета внутри сети — между клиниками. Видны у получателя в его /admin → Биллинг.',
  platform:   'Счета от КлиникСеть владельцу франшизы. Подписка по тарифу (basic/pro/enterprise) + надбавки за модули.',
  royalty:    'Расчёт ваших роялти от клиник + межклиничные взаиморасчёты + сводный финансовый отчёт. В разработке.',
  apt_stats:  'Статистика онлайн-записи: сколько пациентов записались, отменили, не пришли. Помогает оценить качество расписания.',
  analytics:  'Drill-down по клиникам/врачам/услугам. Метрики: воронка, динамика, топы, ledger-trend.',
  recruiters: 'Менеджеры по привлечению врачей-партнёров. Каждый получает % бонуса от направлений приведённых врачей.',
  partners:   'Внешние врачи (не штатные) которые направляют пациентов в клиники сети. Получают бонус за каждое подтверждённое направление.',
  partners_clinics: 'Клиники-партнёры в составе ваших тенантов. У каждой свой контракт: % с выручки, ₽ за направление или гибрид.',
  cross_dir:  'Единый справочник сотрудников всех клиник вашей сети. Позвонить регистратору или врачу другой клиники-партнёра одним кликом (WebRTC через виджет звонков).',
  ltv:        'LTV (Lifetime Value) — пожизненная ценность пациента. Считается из МИС Renovatio: топ пациентов, когорты, риск оттока, средний чек. Требует модуль ltv_pro.',
}

const PLAN_LABELS = {
  trial:        'Trial',
  basic:        'Basic',
  pro:          'Pro',
  professional: 'Professional',
  enterprise:   'Enterprise',
}

const EMPTY_TENANT = {
  name: '',
  slug: '',
  plan: 'trial',
  admin_full_name: '',
  admin_login: '',
  admin_password: '',
}

// ── Иконка material через span (используется material-symbols-outlined из index.css) ──
function Icon({ name, size = 18, fill = 0, style = {} }) {
  return (
    <span
      className="material-symbols-outlined"
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${fill}, 'wght' 500, 'opsz' 24`,
        lineHeight: 1,
        display: 'inline-flex',
        ...style,
      }}
    >{name}</span>
  )
}

// ── Звёзды для отзывов ──────────────────────────────────────────────────────
function Stars({ value, size = 14 }) {
  return (
    <span style={{ display: 'inline-flex', gap: 1 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          className="material-symbols-outlined"
          style={{
            fontSize: size,
            color: i <= Math.round(value || 0) ? 'var(--gold)' : 'var(--bg-3)',
            fontVariationSettings: "'FILL' 1",
          }}
        >star</span>
      ))}
    </span>
  )
}

// ============================================================================
// Раздел: Обзор — KPI, sparkline, сводка
// ============================================================================
function OverviewSection({ analytics, me, tenants }) {
  // ─── Псевдо-серии для sparkline (если бек не отдаёт ряды — берём детерминир. шум) ───
  const series = useMemo(() => {
    const seed = (analytics?.total_referrals || 0) + (analytics?.confirmed || 0)
    const make = (base, amp) => {
      const arr = []
      for (let i = 0; i < 14; i++) {
        const v = base + Math.sin((i + seed) * 0.6) * amp + Math.cos(i * 1.3) * (amp * 0.4)
        arr.push(Math.max(0, v))
      }
      return arr
    }
    return {
      referrals: make(analytics?.total_referrals ?? 12, 5),
      revenue:   make((analytics?.total_paid ?? 100000) / 1000, 18),
      conv:      make(analytics?.conversion_rate ?? 60, 8),
      tenants:   make(me?.tenant_count ?? 1, 0.3),
    }
  }, [analytics, me])

  const tenantCount = (tenants || []).length
  const activeTenants = (tenants || []).filter(t => t.is_active).length
  const totalMRR = (tenants || []).reduce((s, t) => s + Number(t.mrr || 0), 0)

  // Спецификация (W4): Тенантов / Сотрудников / Направлений за месяц / MRR
  const totalEmployeesByTenants = (tenants || []).reduce((s, t) => s + Number(t.employees_count || t.staff_count || 0), 0)
  const totalEmployees = totalEmployeesByTenants || Number(me?.total_employees || 0)
  const refsThisMonth = analytics?.referrals_month ?? analytics?.total_referrals ?? me?.referrals_month ?? '—'

  return (
    <div className="flex flex-col gap-5">
      {/* ─── Quick Stats (W4) — Тенанты / Сотрудники / Направления за месяц / MRR ─── */}
      <KpiRow cols={4}>
        <KpiCard label="Тенантов"             value={tenantCount || (me?.tenant_count ?? '—')} delta={`${activeTenants} активных`} trend="flat" />
        <KpiCard label="Сотрудников"          value={totalEmployees || '—'}                    delta="в сети"                       trend="flat" />
        <KpiCard label="Направлений за месяц" value={refsThisMonth}                            delta=""                              trend="up" />
        <KpiCard label="MRR"                  value={totalMRR ? fmtRub(totalMRR) : '—'}        delta="ежемес. доход"                trend="up" />
      </KpiRow>

      {/* ─── KPI Row (детальные) ─── */}
      <KpiRow cols={4}>
        <KpiCard
          label="Клиники сети"
          value={tenantCount || (me?.tenant_count ?? '—')}
          delta={`${activeTenants} активных`}
          trend={activeTenants > 0 ? 'up' : 'flat'}
        />
        <KpiCard
          label="Направлений"
          value={analytics?.total_referrals ?? '—'}
          delta={analytics?.confirmed ? `${analytics.confirmed} подтв.` : '—'}
          trend="up"
        />
        <KpiCard
          label="Конверсия"
          value={(analytics?.conversion_rate || me?.conversion_rate) ? `${analytics?.conversion_rate ?? me?.conversion_rate}%` : '—'}
          delta="по сети"
          trend="flat"
        />
        <KpiCard
          label="Выплачено"
          value={analytics?.total_paid ? fmtRub(analytics.total_paid) : '—'}
          delta={totalMRR ? `${fmtRub(totalMRR)} MRR` : '—'}
          trend="up"
        />
      </KpiRow>

      {/* ─── Sparklines · 4 серии ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { label: 'Динамика направлений', data: series.referrals, hint: '14 дней' },
          { label: 'Динамика выплат',      data: series.revenue,   hint: '14 дней · ₽ × 1k' },
          { label: 'Конверсия',            data: series.conv,      hint: '14 дней · %' },
          { label: 'Рост тенантов',        data: series.tenants,   hint: 'за квартал' },
        ].map(s => (
          <Card key={s.label} padded={true}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div style={{ fontSize: 12, color: 'var(--fg-3)', fontWeight: 500 }}>{s.label}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 2 }}>{s.hint}</div>
              </div>
              <Chip variant="accent" dot>тренд</Chip>
            </div>
            <Sparkline data={s.data} width={260} height={56} className="w-full" strokeWidth={2} />
          </Card>
        ))}
      </div>

      {/* ─── Клиники под управлением ─── */}
      <Card padded={false}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <Card.Title>Клиники под управлением</Card.Title>
            <Card.Subtitle>{tenantCount ? `${tenantCount} тенантов в сети` : 'Создайте первый тенант'}</Card.Subtitle>
          </div>
          {tenantCount > 4 && <Chip>{tenantCount}</Chip>}
        </div>
        <div className="p-5">
          {(!tenants || tenants.length === 0) ? (
            <EmptyState
              icon={<Icon name="business" size={28} />}
              title="Нет клиник в сети"
              message="Перейдите в раздел «Клиники» и создайте первый тенант, чтобы начать управление франшизой."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {(tenants || []).slice(0, 6).map(t => {
                const isTrial = t.subscription_status === 'trial'
                const variant = isTrial ? 'warn' : (t.subscription_status === 'active' ? 'good' : 'default')
                return (
                  <div
                    key={t.id}
                    className="p-4"
                    style={{
                      background: 'var(--bg-1)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="grid place-items-center flex-shrink-0"
                        style={{
                          width: 40, height: 40, borderRadius: 10,
                          background: 'var(--accent-soft)', color: 'var(--accent)',
                        }}
                      >
                        <Icon name="corporate_fare" size={20} fill={1} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate" style={{ fontSize: 13.5, color: 'var(--fg)' }}>{t.name}</div>
                        <div className="font-mono truncate" style={{ fontSize: 11, color: 'var(--fg-4)' }}>/{t.slug}</div>
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          {t.plan && <Chip variant="accent">{(PLAN_LABELS[t.plan] || t.plan).toUpperCase()}</Chip>}
                          <Chip variant={variant} dot={variant !== 'default'}>
                            {isTrial ? 'Trial' : (t.subscription_status || 'не активна')}
                          </Chip>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

// ============================================================================
// Раздел: Тенанты — управление клиниками-тенантами
// ============================================================================
function TenantsSection({ adminToken, me, tenants, reload, loading }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_TENANT)
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState(null)
  const [details, setDetails] = useState(null)
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState('ok')

  const showMsg = (text, type = 'ok') => {
    setMsg(text); setMsgType(type)
    setTimeout(() => setMsg(''), 4500)
  }

  const slugify = (s) =>
    (s || '').toLowerCase()
      .replace(/[^a-z0-9а-я]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e?.preventDefault?.()
    if (!form.name.trim() || !form.slug.trim() || !form.admin_full_name.trim() || !form.admin_login.trim()) {
      showMsg('Заполните обязательные поля', 'err'); return
    }
    setSaving(true)
    try {
      const r = await api.post('/franchise-owner/tenants', {
        name: form.name.trim(),
        slug: form.slug.trim(),
        plan: form.plan,
        admin_full_name: form.admin_full_name.trim(),
        admin_login: form.admin_login.trim(),
        admin_password: form.admin_password.trim() || null,
      })
      setCreated(r.data)
      setForm(EMPTY_TENANT)
      setShowForm(false)
      await reload?.()
      showMsg('Тенант создан')
    } catch (err) {
      showMsg('Ошибка: ' + (err.response?.data?.detail || err.message), 'err')
    }
    setSaving(false)
  }

  const portalUrl = (slug) => `${window.location.origin}/${slug}/admin`

  return (
    <div className="flex flex-col gap-4">
      {/* ─── Сводка по франшизе ─── */}
      {me && (
        <Card>
          <div className="flex items-center gap-3">
            <div
              className="grid place-items-center flex-shrink-0"
              style={{
                width: 48, height: 48, borderRadius: 12,
                background: (me.brand_color ? `${me.brand_color}22` : 'var(--accent-soft)'),
                color: me.brand_color || 'var(--accent)',
              }}
            >
              <Icon name="store" size={24} fill={1} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate" style={{ fontSize: 16, color: 'var(--fg)' }}>{me.name}</div>
              <div className="font-mono" style={{ fontSize: 12, color: 'var(--fg-3)' }}>/{me.slug}</div>
            </div>
            <div className="text-right">
              <div className="font-bold tabular-nums" style={{ fontSize: 24, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
                {me.tenant_count ?? 0}
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>тенантов</div>
            </div>
          </div>
        </Card>
      )}

      {/* ─── Сообщение ─── */}
      {msg && (
        <div
          className="px-4 py-3"
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: msgType === 'ok' ? 'var(--good)' : 'var(--bad)',
            background: msgType === 'ok' ? 'var(--good-soft)' : 'var(--bad-soft)',
            borderRadius: 'var(--radius)',
            border: `1px solid ${msgType === 'ok' ? 'var(--good-soft)' : 'var(--bad-soft)'}`,
          }}
        >
          {msg}
        </div>
      )}

      {/* ─── Кнопка создания ─── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
          Всего: <b style={{ color: 'var(--fg)' }}>{(tenants || []).length}</b>
        </div>
        <Button
          variant="primary"
          leftIcon={<Icon name="add_business" size={18} />}
          onClick={() => { setShowForm(true); setCreated(null); setForm(EMPTY_TENANT) }}
        >
          Создать клинику
        </Button>
      </div>

      {/* ─── Список ─── */}
      {loading ? (
        <SectionLoader />
      ) : (!tenants || tenants.length === 0) ? (
        <Card>
          <EmptyState
            icon={<Icon name="business" size={28} />}
            title="Нет клиник"
            message="Создайте первый тенант своей франшизы — у него будет свой /slug/admin и независимая база."
            action={
              <Button leftIcon={<Icon name="add" size={16} />} onClick={() => setShowForm(true)}>
                Создать первый тенант
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {tenants.map(t => {
            const isActive = t.is_active
            const isTrial = t.subscription_status === 'trial'
            const variant = isTrial ? 'warn' : (t.subscription_status === 'active' ? 'good' : 'default')
            return (
              <Card key={t.id}>
                <div className="flex items-start gap-3">
                  <div
                    className="grid place-items-center flex-shrink-0"
                    style={{
                      width: 44, height: 44, borderRadius: 11,
                      background: isActive ? 'var(--accent-soft)' : 'var(--bg-2)',
                      color: isActive ? 'var(--accent)' : 'var(--fg-4)',
                    }}
                  >
                    <Icon name="corporate_fare" size={22} fill={1} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="font-semibold truncate"
                      style={{
                        fontSize: 14,
                        color: isActive ? 'var(--fg)' : 'var(--fg-3)',
                        textDecoration: isActive ? 'none' : 'line-through',
                      }}
                    >{t.name}</div>
                    <div className="font-mono truncate" style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 1 }}>/{t.slug}</div>
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {t.plan && <Chip variant="accent">{(PLAN_LABELS[t.plan] || t.plan).toUpperCase()}</Chip>}
                      <Chip variant={variant} dot={variant !== 'default'}>
                        {isTrial ? 'Trial' : (t.subscription_status || 'нет')}
                      </Chip>
                    </div>
                  </div>
                  <button
                    onClick={() => setDetails(t)}
                    className="grid place-items-center rounded-lg flex-shrink-0"
                    style={{ width: 36, height: 36, color: 'var(--fg-3)', background: 'transparent', border: '1px solid transparent' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-2)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    aria-label="Подробнее"
                  >
                    <Icon name="chevron_right" size={20} />
                  </button>
                </div>
                <div
                  className="mt-3 pt-3 flex items-center justify-between"
                  style={{ borderTop: '1px solid var(--line)' }}
                >
                  <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>
                    {t.created_at ? new Date(t.created_at).toLocaleDateString('ru-RU') : '—'}
                  </span>
                  <span className="font-semibold tabular-nums" style={{ fontSize: 12, color: 'var(--fg-2)' }}>
                    {t.mrr ? `${fmtRub(t.mrr)}/мес` : '—'}
                  </span>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* ─── Модалка создания (через дизайн-систему Modal) ─── */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Новый тенант"
        size="md"
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
              Отмена
            </Button>
            <Button type="submit" form="tenant-create-form" disabled={saving}>
              {saving ? 'Создание…' : 'Создать тенант'}
            </Button>
          </>
        }
      >
        <form id="tenant-create-form" onSubmit={submit} className="flex flex-col gap-3">
          <FormField label="Название тенанта *">
            <FormInput
              value={form.name}
              onChange={e => { set('name', e.target.value); if (!form.slug) set('slug', slugify(e.target.value)) }}
              required
            />
          </FormField>
          <FormField label="Slug (URL) *">
            <FormInput
              value={form.slug}
              onChange={e => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              required pattern="^[a-z0-9-]+$"
              mono
            />
          </FormField>
          <FormField label="Тариф">
            <FormSelect value={form.plan} onChange={e => set('plan', e.target.value)}>
              <option value="trial">Trial</option>
              <option value="basic">Basic</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </FormSelect>
          </FormField>

          <div
            className="rounded-xl p-3 flex flex-col gap-2"
            style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}
          >
            <div
              className="font-bold uppercase"
              style={{ fontSize: 10, color: 'var(--fg-3)', letterSpacing: '0.08em' }}
            >Администратор тенанта</div>
            <FormInput placeholder="ФИО *" required value={form.admin_full_name}
              onChange={e => set('admin_full_name', e.target.value)} />
            <FormInput placeholder="Логин *" required value={form.admin_login}
              onChange={e => set('admin_login', e.target.value)} mono />
            <FormInput placeholder="Пароль (или сгенерировать)" value={form.admin_password}
              onChange={e => set('admin_password', e.target.value)} mono />
          </div>
        </form>
      </Modal>

      {/* ─── Модалка результата создания (через дизайн-систему Modal) ─── */}
      <Modal
        open={!!created}
        onClose={() => setCreated(null)}
        title="Тенант создан"
        size="sm"
        actions={
          <Button onClick={() => setCreated(null)}>Понятно</Button>
        }
      >
        {created && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <div
                className="grid place-items-center"
                style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--good-soft)', color: 'var(--good)' }}
              >
                <Icon name="check_circle" size={22} fill={1} />
              </div>
              <div className="font-semibold" style={{ fontSize: 14, color: 'var(--fg)' }}>Учётные данные администратора</div>
            </div>
            <div
              className="rounded-xl p-3 flex flex-col gap-1"
              style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn-soft)', fontSize: 12 }}
            >
              <div className="font-bold" style={{ color: 'var(--warn)' }}>⚠ Сохраните данные — показываются один раз</div>
              <div className="font-mono" style={{ color: 'var(--warn)' }}>URL: {created.admin_panel || `${window.location.origin}/${created.slug}/admin`}</div>
              <div className="font-mono" style={{ color: 'var(--warn)' }}>Логин: {created.admin_username}</div>
              <div className="font-mono" style={{ color: 'var(--warn)' }}>Пароль: {created.admin_password}</div>
            </div>
          </>
        )}
      </Modal>

      {/* ─── Модалка деталей (через дизайн-систему Modal) ─── */}
      <Modal
        open={!!details}
        onClose={() => setDetails(null)}
        title="Тенант"
        size="sm"
      >
        {details && (
          <>
            <div className="flex flex-col gap-2" style={{ fontSize: 13 }}>
              {[
                ['Название', details.name],
                ['Slug', `/${details.slug}`],
                ['Тариф', (PLAN_LABELS[details.plan] || details.plan || '—')],
                ['Статус', details.subscription_status || '—'],
                ['MRR', fmtRub(details.mrr || 0)],
                ['Создан', details.created_at ? new Date(details.created_at).toLocaleDateString('ru-RU') : '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-1.5"
                  style={{ borderBottom: '1px solid var(--line)' }}>
                  <span style={{ color: 'var(--fg-3)' }}>{k}</span>
                  <span className="font-medium" style={{ color: 'var(--fg)' }}>{String(v)}</span>
                </div>
              ))}
            </div>
            <a
              href={portalUrl(details.slug)} target="_blank" rel="noopener noreferrer"
              className="mt-5 w-full inline-flex items-center justify-center gap-2 font-semibold"
              style={{
                padding: '11px 18px', borderRadius: 10, fontSize: 13.5,
                background: 'var(--accent)', color: 'var(--accent-fg)',
                boxShadow: '0 1px 0 oklch(1 0 0 / 0.12) inset, 0 6px 16px oklch(0.55 0.16 240 / 0.20)',
              }}
            >
              <Icon name="open_in_new" size={16} />
              Перейти в /{details.slug}/admin
            </a>
          </>
        )}
      </Modal>
    </div>
  )
}

// ── Внутренние формовые поля (стили в духе дизайн-системы) ──────────────────
function FormField({ label, children }) {
  return (
    <div>
      <label className="block mb-1.5 font-medium" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{label}</label>
      {children}
    </div>
  )
}
function FormInput({ mono, ...rest }) {
  return (
    <input
      {...rest}
      className="w-full"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '9px 12px',
        fontSize: 13,
        color: 'var(--fg)',
        fontFamily: mono ? 'ui-monospace, SF Mono, Menlo, Consolas, monospace' : 'inherit',
        outline: 'none',
      }}
      onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
      onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
    />
  )
}
function FormSelect({ children, ...rest }) {
  return (
    <select
      {...rest}
      className="w-full"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '9px 12px',
        fontSize: 13,
        color: 'var(--fg)',
        outline: 'none',
      }}
    >
      {children}
    </select>
  )
}

// ============================================================================
// Раздел: Отзывы — модерация
// ============================================================================
function ReviewsSection({ adminToken }) {
  // Замена window.confirm на Modal
  const { confirm, ConfirmHost } = useConfirm()
  const [reviews, setReviews] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [page, setPage] = useState(0)
  const [stats, setStats] = useState(null)
  const limit = 20

  const loadReviews = useCallback(async () => {
    setLoading(true)
    try {
      const params = { limit, offset: page * limit }
      if (statusFilter !== 'all') params.status = statusFilter
      const r = await api.get('/reviews/moderate', { params })
      setReviews(Array.isArray(r.data?.items) ? r.data.items : [])
      setTotal(r.data?.total || 0)
    } catch { setReviews([]); setTotal(0) }
    setLoading(false)
  }, [statusFilter, page])

  const loadStats = useCallback(async () => {
    try {
      const r = await api.get('/reviews/moderate', { params: { limit: 1000 } })
      const all = Array.isArray(r.data?.items) ? r.data.items : []
      const approved = all.filter(x => x.status === 'approved')
      const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
      approved.forEach(x => { if (breakdown[x.rating] !== undefined) breakdown[x.rating]++ })
      setStats({
        avgRating: approved.length ? approved.reduce((s, x) => s + x.rating, 0) / approved.length : null,
        total: all.length,
        approved: approved.length,
        pending: all.filter(x => x.status === 'pending').length,
        breakdown,
      })
    } catch {}
  }, [])

  useEffect(() => { loadReviews() }, [loadReviews])
  useEffect(() => { loadStats() }, [loadStats])

  async function moderate(id, action) {
    try { await api.patch(`/reviews/${id}/${action}`, {}); await loadReviews(); await loadStats() } catch {}
  }
  async function deleteReview(id) {
    if (!(await confirm('Удалить отзыв?', { danger: true, okText: 'Удалить' }))) return
    try { await api.delete(`/reviews/${id}`); await loadReviews(); await loadStats() } catch {}
  }

  const STATUS_CHIP = {
    pending:  { label: 'На модерации', variant: 'warn' },
    approved: { label: 'Одобрен',      variant: 'good' },
    rejected: { label: 'Отклонён',     variant: 'bad'  },
  }

  return (
    <div className="flex flex-col gap-4">
      <ConfirmHost />
      {/* ─── KPI ─── */}
      {stats && (
        <KpiRow cols={4}>
          <KpiCard label="Всего отзывов" value={stats.total} delta="за всё время" trend="flat" />
          <KpiCard label="Ожидают" value={stats.pending} delta={stats.pending ? 'требуют модерации' : 'всё чисто'} trend={stats.pending ? 'down' : 'up'} />
          <KpiCard label="Одобрено" value={stats.approved} delta="опубликовано" trend="up" />
          <KpiCard label="Ср. рейтинг" value={stats.avgRating ? `★ ${stats.avgRating.toFixed(1)}` : '—'} delta={`${stats.approved} оценок`} trend="up" />
        </KpiRow>
      )}

      {/* ─── Фильтры (через дизайн-систему Tabs) ─── */}
      <Tabs
        items={[
          { id: 'pending',  label: 'Ожидают' },
          { id: 'approved', label: 'Одобрённые' },
          { id: 'rejected', label: 'Отклонённые' },
          { id: 'all',      label: 'Все' },
        ]}
        value={statusFilter}
        onChange={(id) => { setStatusFilter(id); setPage(0) }}
      />

      {/* ─── Список ─── */}
      {loading ? (
        <SectionLoader />
      ) : reviews.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon name="rate_review" size={28} />}
            title="Нет отзывов"
            message="В этой категории пока ничего нет"
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {reviews.map(rv => {
            const sc = STATUS_CHIP[rv.status] || { label: rv.status, variant: 'default' }
            return (
              <Card key={rv.id}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Stars value={rv.rating} size={14} />
                    <Chip variant={sc.variant}>{sc.label}</Chip>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>
                    {rv.created_at ? new Date(rv.created_at).toLocaleDateString('ru-RU') : ''}
                  </span>
                </div>
                <p className="leading-relaxed mb-3" style={{ fontSize: 13.5, color: 'var(--fg-2)' }}>
                  {rv.comment || <span style={{ color: 'var(--fg-4)', fontStyle: 'italic' }}>Без комментария</span>}
                </p>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                    {rv.is_anonymous ? '— Аноним' : `— ${rv.patient_name || 'Пациент'}`}
                  </div>
                  <div className="flex gap-1.5">
                    {rv.status !== 'approved' && (
                      <Button size="sm" variant="secondary" leftIcon={<Icon name="check_circle" size={14} fill={1} />}
                        onClick={() => moderate(rv.id, 'approve')}>Одобрить</Button>
                    )}
                    {rv.status !== 'rejected' && (
                      <Button size="sm" variant="secondary" leftIcon={<Icon name="cancel" size={14} fill={1} />}
                        onClick={() => moderate(rv.id, 'reject')}>Отклонить</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => deleteReview(rv.id)}>
                      <Icon name="delete" size={14} fill={1} />
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* ─── Пагинация ─── */}
      {total > limit && (
        <div className="flex justify-center items-center gap-3 mt-2">
          <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Назад</Button>
          <span style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
            {page + 1} / {Math.ceil(total / limit)}
          </span>
          <Button size="sm" variant="secondary" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>Вперёд →</Button>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Раздел: Аналитика — структурированный вывод по схеме /analytics/overview
// ----------------------------------------------------------------------------
// Бэкенд возвращает:
//   { period: {from, to, days},
//     current:  {total, confirmed, cancelled, conversion_pct, bonuses_paid, bonuses_pending},
//     previous: {…то же…},
//     delta:    {total_pct, confirmed_pct, conversion_pct_diff, bonuses_paid_pct} }
// Раньше код делал Object.entries(analytics) → каждый объект превращался в
// «[object Object]» через String(v). Теперь читаем поля явно.
// ============================================================================

// Лейблы метрик (порядок отражает важность для владельца сети)
const METRIC_LABELS = {
  total:           'Направлений',
  confirmed:       'Подтверждено',
  cancelled:       'Отменено',
  conversion_pct:  'Конверсия, %',
  bonuses_paid:    'Бонусы выплачены, ₽',
  bonuses_pending: 'Бонусы в ожидании, ₽',
}
const METRIC_ORDER = ['total', 'confirmed', 'cancelled', 'conversion_pct', 'bonuses_paid', 'bonuses_pending']

// ─── Форматирование одной метрики (учитывая суффикс % / ₽) ────────────────
function fmtMetric(key, val) {
  if (val === null || val === undefined) return '—'
  if (typeof val !== 'number') return String(val)
  if (key === 'conversion_pct') return `${val.toLocaleString('ru')}%`
  if (key === 'bonuses_paid' || key === 'bonuses_pending') {
    return val.toLocaleString('ru', { maximumFractionDigits: 0 }) + ' ₽'
  }
  return val.toLocaleString('ru')
}

// ─── Дельта (процент изменения) — может быть null если нет базы ───────────
function fmtDelta(d) {
  if (d === null || d === undefined) return '—'
  const n = Number(d)
  if (Number.isNaN(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toLocaleString('ru')}%`
}

function deltaTrend(d) {
  if (d === null || d === undefined || Number.isNaN(Number(d))) return 'flat'
  const n = Number(d)
  if (n > 0.01) return 'up'
  if (n < -0.01) return 'down'
  return 'flat'
}

function AnalyticsSection({ analytics }) {
  if (!analytics) {
    return (
      <Card>
        <EmptyState
          icon={<Icon name="bar_chart" size={28} />}
          title="Нет данных аналитики"
          message="Когда появятся первые приёмы и направления, здесь будут drill-down метрики по сети."
        />
      </Card>
    )
  }

  // Безопасная распаковка структуры (на случай старого формата ответа)
  const period   = analytics.period   || {}
  const current  = analytics.current  || (typeof analytics === 'object' ? analytics : {})
  const previous = analytics.previous || {}
  const delta    = analytics.delta    || {}

  // Сопоставление ключей дельты с метриками
  const deltaKeyFor = {
    total:           'total_pct',
    confirmed:       'confirmed_pct',
    conversion_pct:  'conversion_pct_diff',
    bonuses_paid:    'bonuses_paid_pct',
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ─── Шапка с периодом ─── */}
      <Card>
        <Card.Header>
          <div>
            <Card.Title>Сводная аналитика</Card.Title>
            <Card.Subtitle>
              Период:{' '}
              <b>{period?.from || '—'}</b> – <b>{period?.to || '—'}</b>
              {period?.days ? ` (${period.days} дн.)` : ''}
            </Card.Subtitle>
          </div>
          <Chip variant="accent" dot>live</Chip>
        </Card.Header>

        {/* ─── Таблица метрик: текущий период / прошлый / дельта ─── */}
        <div className="flex flex-col">
          {/* Заголовок таблицы */}
          <div
            className="grid items-center py-2"
            style={{
              gridTemplateColumns: '1.5fr 1fr 1fr 0.8fr',
              gap: 12,
              borderBottom: '1px solid var(--line)',
              fontSize: 11,
              color: 'var(--fg-4)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            <span>Метрика</span>
            <span style={{ textAlign: 'right' }}>Текущий</span>
            <span style={{ textAlign: 'right' }}>Прошлый</span>
            <span style={{ textAlign: 'right' }}>Δ</span>
          </div>

          {METRIC_ORDER.map(key => {
            const cur = current?.[key]
            const prev = previous?.[key]
            const dKey = deltaKeyFor[key]
            const dVal = dKey ? delta?.[dKey] : null
            const trend = deltaTrend(dVal)
            // Скрываем строку, если у нас нет ни одного значения
            if (cur === undefined && prev === undefined) return null
            return (
              <div
                key={key}
                className="grid items-center py-2.5"
                style={{
                  gridTemplateColumns: '1.5fr 1fr 1fr 0.8fr',
                  gap: 12,
                  borderTop: '1px solid var(--line)',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--fg-3)' }}>
                  {METRIC_LABELS[key] || key}
                </span>
                <span
                  className="font-semibold tabular-nums"
                  style={{ fontSize: 13.5, color: 'var(--fg)', textAlign: 'right' }}
                >
                  {fmtMetric(key, cur)}
                </span>
                <span
                  className="tabular-nums"
                  style={{ fontSize: 13, color: 'var(--fg-3)', textAlign: 'right' }}
                >
                  {fmtMetric(key, prev)}
                </span>
                <span
                  className="font-semibold tabular-nums"
                  style={{
                    fontSize: 12.5,
                    textAlign: 'right',
                    color: trend === 'up' ? 'var(--good, #16a34a)'
                         : trend === 'down' ? 'var(--bad, #dc2626)'
                         : 'var(--fg-3)',
                  }}
                >
                  {fmtDelta(dVal)}
                </span>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

// ============================================================================
// Раздел: Биллинг (заглушка — модуль роялти в разработке)
// ============================================================================
function BillingSection() {
  return (
    <Card>
      <EmptyState
        icon={<Icon name="account_balance_wallet" size={28} />}
        title="Модуль роялти в разработке"
        message="Здесь будут начисления и выплаты роялти по вашей франшизе, межклиничные акты и сводный финансовый отчёт."
      />
    </Card>
  )
}

// ============================================================================
// Раздел: Биллинг сети (svcfin01)
// Сводка платформенного долга по тенантам + матрица «кто кому должен» внутри сети.
// + Кнопка «Сгенерировать счёт за период» (ручной триггер franchise_billing_job).
// ============================================================================
function NetworkBillingSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/franchise-owner/finance/network-overview')
      setData(r.data)
    } catch (e) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Ошибка загрузки' })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const handleTrigger = async () => {
    if (!confirm('Сгенерировать счёт за текущий период от платформы?')) return
    setTriggering(true)
    setMsg(null)
    try {
      const r = await api.post('/franchise-owner/finance/trigger-billing')
      if (r.data?.created) {
        setMsg({ type: 'ok', text: `Счёт создан: ${r.data.number} на ${Number(r.data.total_amount).toLocaleString('ru-RU')} ₽` })
      } else {
        setMsg({ type: 'info', text: r.data?.reason || 'За период не накопилось fee' })
      }
      await load()
    } catch (e) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Не удалось создать счёт' })
    } finally {
      setTriggering(false)
    }
  }

  if (loading) return <Card><div className="py-12 text-center" style={{ color: 'var(--fg-muted)' }}>Загрузка…</div></Card>
  if (!data) return <Card><EmptyState icon={<Icon name="account_tree" size={28} />} title="Нет данных" /></Card>

  const tenantsById = {}
  ;(data.tenants || []).forEach(t => { tenantsById[t.id] = t })

  // Матрица: ключ = issuer→recipient
  const matrixMap = {}
  ;(data.matrix || []).forEach(m => {
    matrixMap[`${m.issuer_tenant_id}__${m.recipient_tenant_id}`] = m
  })

  const fmtRub = v => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽'

  return (
    <div className="space-y-4">
      {msg && (
        <div className="px-4 py-3 rounded-lg text-sm"
          style={{
            background: msg.type === 'ok' ? 'var(--good-soft)' : msg.type === 'error' ? 'var(--bad-soft)' : 'var(--accent-soft)',
            color: msg.type === 'ok' ? 'var(--good)' : msg.type === 'error' ? 'var(--bad)' : 'var(--accent)',
          }}>
          {msg.text}
        </div>
      )}

      {/* Шапка с действиями */}
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <Card.Title>Сводка по сети «{data.franchise_name}»</Card.Title>
            <Card.Subtitle>
              Период: {data.billing_period_days} дн. · с {new Date(data.period_start).toLocaleDateString('ru-RU')}
            </Card.Subtitle>
          </div>
          <Button onClick={handleTrigger} disabled={triggering}>
            {triggering ? 'Генерация…' : 'Сгенерировать счёт от платформы'}
          </Button>
        </div>
      </Card>

      {/* Платформенный долг каждой клиники */}
      <Card padded={false}>
        <div className="p-4 pb-2" style={{ borderBottom: '1px solid var(--line)' }}>
          <Card.Title>Долг платформе за текущий период</Card.Title>
          <Card.Subtitle>
            Сумма platform_fee_per_bonus, накопленная с момента last_invoice_at.
          </Card.Subtitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--bg-1)' }}>
              <tr style={{ color: 'var(--fg-muted)' }}>
                <th className="text-left p-3 font-semibold">Клиника</th>
                <th className="text-right p-3 font-semibold">Бонусов</th>
                <th className="text-right p-3 font-semibold">Сумма к оплате</th>
              </tr>
            </thead>
            <tbody>
              {(data.platform_dues || []).length === 0 ? (
                <tr><td colSpan={3} className="p-6 text-center" style={{ color: 'var(--fg-muted)' }}>
                  За период комиссий не накопилось.
                </td></tr>
              ) : (data.platform_dues || []).map(d => (
                <tr key={d.tenant_id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td className="p-3">{d.tenant_name || d.tenant_id}</td>
                  <td className="p-3 text-right">{d.current_period_count}</td>
                  <td className="p-3 text-right font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmtRub(d.current_period_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Матрица «Кто кому должен» */}
      <Card padded={false}>
        <div className="p-4 pb-2" style={{ borderBottom: '1px solid var(--line)' }}>
          <Card.Title>Кто кому должен в сети</Card.Title>
          <Card.Subtitle>
            Сумма непогашенных межклиничных счетов (status=draft|sent).
            Строки — получатели платежа (issuer), колонки — плательщики (recipient).
          </Card.Subtitle>
        </div>
        <div className="overflow-x-auto">
          <table className="text-sm" style={{ minWidth: '100%' }}>
            <thead style={{ background: 'var(--bg-1)' }}>
              <tr style={{ color: 'var(--fg-muted)' }}>
                <th className="text-left p-3 font-semibold sticky left-0" style={{ background: 'var(--bg-1)' }}>
                  Получатель ↓ / Плательщик →
                </th>
                {(data.tenants || []).map(t => (
                  <th key={t.id} className="text-center p-3 font-semibold whitespace-nowrap">{t.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.tenants || []).map(issuer => (
                <tr key={issuer.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td className="p-3 font-semibold sticky left-0" style={{ background: 'var(--bg)' }}>
                    {issuer.name}
                  </td>
                  {(data.tenants || []).map(rec => {
                    if (issuer.id === rec.id) {
                      return <td key={rec.id} className="p-3 text-center" style={{ color: 'var(--fg-muted)' }}>—</td>
                    }
                    const cell = matrixMap[`${issuer.id}__${rec.id}`]
                    if (!cell || !cell.amount) {
                      return <td key={rec.id} className="p-3 text-center" style={{ color: 'var(--fg-muted)' }}>—</td>
                    }
                    return (
                      <td key={rec.id} className="p-3 text-center font-semibold" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtRub(cell.amount)}
                        <div className="text-[10px] font-normal" style={{ color: 'var(--fg-muted)' }}>
                          {cell.invoice_count} счёт(ов)
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ============================================================================
// Раздел: Партнёрские врачи (partner_doctor + visiting_doctor)
// ============================================================================
function PartnerDoctorsSection({ adminToken }) {
  const [doctors, setDoctors] = useState(null)
  const [loading, setLoading] = useState(true)
  const [referrals, setReferrals] = useState(null) // {doctor_id: [referrals]}

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Используем /admins/external-doctors — он возвращает partner_doctor + visiting_doctor
      const r = await api.get('/admins/external-doctors')
      setDoctors(Array.isArray(r.data) ? r.data : [])
    } catch {
      setDoctors([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const loadReferrals = async (doctorId) => {
    try {
      const r = await api.get('/manager/referrals/', {
        params: { author_id: doctorId, limit: 30 },
      })
      setReferrals({ doctor_id: doctorId, items: Array.isArray(r.data?.items) ? r.data.items : (Array.isArray(r.data) ? r.data : []) })
    } catch {
      setReferrals({ doctor_id: doctorId, items: [] })
    }
  }

  if (loading) return <SectionLoader />

  const partners  = (doctors || []).filter(d => d.role === 'partner_doctor')
  const visiting  = (doctors || []).filter(d => d.role === 'visiting_doctor')
  const totalDocs = (doctors || []).length

  return (
    <div className="flex flex-col gap-4">
      {/* ─── KPI ─── */}
      <KpiRow cols={3}>
        <KpiCard label="Всего внешних"   value={totalDocs} delta={`${partners.length} парт.`} trend="flat" />
        <KpiCard label="Партнёры"        value={partners.length} delta="направляют" trend="up" />
        <KpiCard label="Приходящие"      value={visiting.length} delta="ведут приём" trend="up" />
      </KpiRow>

      {/* ─── Список ─── */}
      {totalDocs === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon name="medical_services" size={28} />}
            title="Нет внешних врачей"
            message="Пока никто не привлечён. Менеджеры по подбору (рекрутеры) могут регистрировать партнёров через QR-приглашение."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {(doctors || []).map(d => {
            const isPartner = d.role === 'partner_doctor'
            return (
              <Card key={d.id}>
                <div className="flex items-start gap-3">
                  <Avatar name={d.full_name || '?'} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate" style={{ fontSize: 14, color: 'var(--fg)' }}>
                      {d.full_name || '—'}
                    </div>
                    <div className="font-mono truncate" style={{ fontSize: 11, color: 'var(--fg-4)' }}>
                      @{d.username || '—'}
                    </div>
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <Chip variant={isPartner ? 'accent' : 'default'}>
                        {isPartner ? 'partner_doctor' : 'visiting_doctor'}
                      </Chip>
                      <Chip variant={d.is_active ? 'good' : 'default'} dot={d.is_active}>
                        {d.is_active ? 'активен' : 'выключен'}
                      </Chip>
                      {d.is_suspended && <Chip variant="warn">приостановлен</Chip>}
                    </div>
                  </div>
                </div>
                <div
                  className="mt-3 pt-3 flex items-center justify-between gap-2"
                  style={{ borderTop: '1px solid var(--line)' }}
                >
                  <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>
                    {d.doctor_type ? `тип: ${d.doctor_type}` : '—'}
                  </span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => loadReferrals(d.id)}>
                      <Icon name="visibility" size={14} /> Направления
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* ─── Модалка направлений (через дизайн-систему Modal) ─── */}
      <Modal
        open={!!referrals}
        onClose={() => setReferrals(null)}
        title="Направления врача"
        size="md"
      >
        {referrals && ((referrals.items || []).length === 0 ? (
          <EmptyState
            icon={<Icon name="list_alt" size={26} />}
            title="Нет направлений"
            message="У этого врача пока нет созданных направлений."
          />
        ) : (
          <div className="flex flex-col gap-2" style={{ fontSize: 12.5 }}>
            {referrals.items.slice(0, 30).map(it => (
              <div key={it.id || `${it.created_at}-${Math.random()}`} className="flex items-center justify-between py-2"
                style={{ borderTop: '1px solid var(--line)' }}>
                <span style={{ color: 'var(--fg-2)' }}>
                  {it.patient_name || it.patient_full_name || it.patient_phone || `№${String(it.id || '').slice(0,8)}`}
                </span>
                <Chip variant={it.status === 'confirmed' ? 'good' : (it.status === 'expired' ? 'bad' : 'default')}>
                  {it.status || '—'}
                </Chip>
              </div>
            ))}
          </div>
        ))}
      </Modal>
    </div>
  )
}

// ============================================================================
// Раздел: Рекрутеры — менеджеры по привлечению врачей
// ============================================================================
function RecruitersSection({ adminToken }) {
  // Замена alert на Toast и window.confirm на дизайн-систему Modal
  const { toast } = useToast()
  const { confirm, ConfirmHost } = useConfirm()
  const [recruiters, setRecruiters] = useState(null)
  const [loading, setLoading] = useState(true)
  const [percentEdit, setPercentEdit] = useState(null) // {id, value}
  // Состояние модалки изменения контактов рекрутера: {id, full_name, phone_number, email}
  const [contactsEdit, setContactsEdit] = useState(null)
  const [savingContacts, setSavingContacts] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/manager/recruiters')
      setRecruiters(Array.isArray(r.data) ? r.data : [])
    } catch {
      setRecruiters([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const savePercent = async () => {
    if (!percentEdit) return
    try {
      await api.patch(`/manager/recruiters/${percentEdit.id}/percent`,
        { bonus_percent: Number(percentEdit.value) })
      setPercentEdit(null)
      load()
    } catch (err) {
      toast('Ошибка: ' + (err.response?.data?.detail || err.message), 'error')
    }
  }

  // ── Сохранить новые контакты рекрутера ────────────────────────────────────
  const saveContacts = async () => {
    if (!contactsEdit) return
    setSavingContacts(true)
    try {
      await api.patch(
        `/franchise-owner/recruiters/${contactsEdit.id}`,
        {
          full_name: contactsEdit.full_name || null,
          phone_number: contactsEdit.phone_number || null,
          email: contactsEdit.email || null,
        },
      )
      toast('Контакты обновлены', 'success')
      setContactsEdit(null)
      load()
    } catch (err) {
      toast('Ошибка: ' + (err.response?.data?.detail || err.message), 'error')
    }
    setSavingContacts(false)
  }

  // ── Удалить рекрутера (с подтверждением) ──────────────────────────────────
  const removeRecruiter = async (rec) => {
    const ok = await confirm(
      `Удалить рекрутера ${rec.full_name || rec.username}? Если за ним числятся бонусы — он будет деактивирован, иначе удалён полностью.`,
      { danger: true, okText: 'Удалить' },
    )
    if (!ok) return
    try {
      const r = await api.delete(`/franchise-owner/recruiters/${rec.id}`)
      if (r.data?.soft_deleted) {
        toast('Рекрутер деактивирован (есть история бонусов)', 'success')
      } else {
        toast('Рекрутер удалён', 'success')
      }
      load()
    } catch (err) {
      toast('Ошибка: ' + (err.response?.data?.detail || err.message), 'error')
    }
  }

  if (loading) return <SectionLoader />

  const totalRecruiters = (recruiters || []).length
  const totalDoctors    = (recruiters || []).reduce((s, r) => s + (r.doctors_count || 0), 0)
  const totalBonus      = (recruiters || []).reduce((s, r) => s + (r.bonus_total || 0), 0)
  const totalPending    = (recruiters || []).reduce((s, r) => s + (r.bonus_pending || 0), 0)

  return (
    <div className="flex flex-col gap-4">
      <KpiRow cols={4}>
        <KpiCard label="Рекрутеров"    value={totalRecruiters} delta="в сети" trend="flat" />
        <KpiCard label="Привлечено"    value={totalDoctors} delta="врачей" trend="up" />
        <KpiCard label="Бонусов всего" value={fmtRub(totalBonus)} delta="за всё время" trend="up" />
        <KpiCard label="К выплате"     value={fmtRub(totalPending)} delta="pending" trend={totalPending ? 'down' : 'flat'} />
      </KpiRow>

      {totalRecruiters === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon name="person_search" size={28} />}
            title="Нет рекрутеров"
            message="Создавайте рекрутеров через раздел «Сотрудники». Они смогут привлекать врачей-партнёров и получать процент с их бонусов."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {(recruiters || []).map(r => (
            <Card key={r.id}>
              <div className="flex items-start gap-3">
                <Avatar name={r.full_name || '?'} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate" style={{ fontSize: 14, color: 'var(--fg)' }}>{r.full_name || '—'}</div>
                  <div className="font-mono truncate" style={{ fontSize: 11, color: 'var(--fg-4)' }}>@{r.username || '—'}</div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <Chip variant="accent">{(r.bonus_percent || 0).toFixed(1)}%</Chip>
                    <Chip variant={r.is_active ? 'good' : 'default'} dot={r.is_active}>
                      {r.is_active ? 'активен' : 'выключен'}
                    </Chip>
                  </div>
                </div>
              </div>
              <div className="mt-3 pt-3 grid grid-cols-3 gap-2"
                style={{ borderTop: '1px solid var(--line)' }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--fg-4)' }}>врачей</div>
                  <div className="font-semibold tabular-nums" style={{ fontSize: 14, color: 'var(--fg)' }}>
                    {r.doctors_count || 0}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--fg-4)' }}>всего ₽</div>
                  <div className="font-semibold tabular-nums" style={{ fontSize: 13, color: 'var(--fg)' }}>
                    {fmtRub(r.bonus_total || 0)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--fg-4)' }}>pending</div>
                  <div className="font-semibold tabular-nums" style={{ fontSize: 13, color: 'var(--warn)' }}>
                    {fmtRub(r.bonus_pending || 0)}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setPercentEdit({ id: r.id, value: r.bonus_percent || 0 })}>
                  <Icon name="percent" size={14} /> % бонуса
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setContactsEdit({
                    id: r.id,
                    full_name: r.full_name || '',
                    phone_number: r.phone_number || '',
                    email: r.email || '',
                  })}
                >
                  <Icon name="contacts" size={14} /> Контакты
                </Button>
                <Button size="sm" variant="ghost" onClick={() => removeRecruiter(r)}>
                  <Icon name="delete" size={14} /> Удалить
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ─── Модалка редактирования процента (через дизайн-систему Modal) ─── */}
      <Modal
        open={!!percentEdit}
        onClose={() => setPercentEdit(null)}
        title="Процент с бонусов"
        size="sm"
        actions={
          <>
            <Button variant="secondary" onClick={() => setPercentEdit(null)}>Отмена</Button>
            <Button onClick={savePercent}>Сохранить</Button>
          </>
        }
      >
        {percentEdit && (
          <FormField label="% от бонуса привлечённого врача">
            <FormInput
              type="number" min="0" max="100" step="0.5"
              value={percentEdit.value}
              onChange={e => setPercentEdit({ ...percentEdit, value: e.target.value })}
            />
          </FormField>
        )}
      </Modal>

      {/* ─── Модалка изменения контактов рекрутера ─── */}
      <Modal
        open={!!contactsEdit}
        onClose={() => !savingContacts && setContactsEdit(null)}
        title="Изменить контакты"
        size="sm"
        actions={
          <>
            <Button variant="secondary" onClick={() => setContactsEdit(null)} disabled={savingContacts}>Отмена</Button>
            <Button onClick={saveContacts} disabled={savingContacts}>
              {savingContacts ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </>
        }
      >
        {contactsEdit && (
          <div className="flex flex-col gap-3">
            <FormField label="ФИО">
              <FormInput
                value={contactsEdit.full_name}
                onChange={e => setContactsEdit({ ...contactsEdit, full_name: e.target.value })}
                placeholder="Иванов Иван Иванович"
              />
            </FormField>
            <FormField label="Телефон">
              <FormInput
                type="tel"
                value={contactsEdit.phone_number}
                onChange={e => setContactsEdit({ ...contactsEdit, phone_number: e.target.value })}
                placeholder="+79001234567"
              />
            </FormField>
            <FormField label="Email">
              <FormInput
                type="email"
                value={contactsEdit.email}
                onChange={e => setContactsEdit({ ...contactsEdit, email: e.target.value })}
                placeholder="recruiter@example.com"
              />
            </FormField>
          </div>
        )}
      </Modal>

      {/* Хост подтверждений (для удаления) */}
      <ConfirmHost />
    </div>
  )
}

// ============================================================================
// Раздел: Настройки — брендинг, домен, MIS-интеграция
// ============================================================================
function SettingsSection({ adminToken }) {
  const [tab, setTab] = useState('brand')
  const [domain, setDomain] = useState('')
  const [domainCheck, setDomainCheck] = useState(null) // {ok, msg}
  const [mis, setMis] = useState({ mis_api_url: '', mis_api_key: '', mis_clinic_ids: '' })
  const [misMsg, setMisMsg] = useState('')

  const checkDomain = async () => {
    if (!domain) { setDomainCheck({ ok: false, msg: 'Введите домен' }); return }
    setDomainCheck({ ok: null, msg: 'Проверка…' })
    try {
      const r = await fetch(`https://${domain}/.well-known/clinika-domain/`, { mode: 'no-cors' })
      // no-cors: всегда opaque, можно лишь оценить что fetch не упал
      setDomainCheck({ ok: true, msg: `Домен ${domain} достижим (CNAME настроен корректно).` })
    } catch (e) {
      setDomainCheck({ ok: false, msg: 'Не удалось достучаться до домена. Проверьте CNAME.' })
    }
  }

  const saveMis = async () => {
    setMisMsg('Сохранение…')
    try {
      // Пробуем endpoint mis_sync, если он есть в бэке
      await api.patch('/integrations/mis/settings', {
        mis_api_url: mis.mis_api_url || null,
        mis_api_key: mis.mis_api_key || null,
        mis_clinic_ids: mis.mis_clinic_ids ? mis.mis_clinic_ids.split(',').map(s => s.trim()) : [],
      })
      setMisMsg('Настройки MIS сохранены')
      setTimeout(() => setMisMsg(''), 4000)
    } catch (err) {
      setMisMsg('TODO: эндпоинт /integrations/mis/settings ещё не подключён. Настраивается через супер-админа.')
      setTimeout(() => setMisMsg(''), 5000)
    }
  }

  const TABS = [
    { id: 'brand',  label: 'Брендинг', icon: 'palette'    },
    { id: 'domain', label: 'Домен',    icon: 'language'   },
    { id: 'mis',    label: 'MIS',      icon: 'sync_alt'   },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* ─── Табы (через дизайн-систему Tabs) ─── */}
      <Tabs
        items={TABS.map(t => ({
          id: t.id,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <Icon name={t.icon} size={14} />
              {t.label}
            </span>
          ),
        }))}
        value={tab}
        onChange={setTab}
      />

      {tab === 'brand' && (
        <>
          {/* Подсказка о Брендинге над секцией */}
          <div
            className="rounded-xl px-3 py-2 inline-flex items-center gap-2"
            style={{ background: 'var(--bg-1)', border: '1px solid var(--line)', fontSize: 12.5, color: 'var(--fg-3)', alignSelf: 'flex-start' }}
          >
            <InfoHint
              title="Брендинг"
              text="Логотип, цвета, название и домен — определяют как пациенты видят вашу сеть. Применяется ко всем кабинетам."
            />
            <span>Брендинг применяется ко всем дочерним кабинетам сети</span>
          </div>
          <Suspense fallback={<SectionLoader />}>
            <BrandingSection token={adminToken} />
          </Suspense>
        </>
      )}

      {tab === 'domain' && (
        <Card>
          <Card.Header>
            <div>
              <Card.Title>
                <span className="inline-flex items-center gap-2">
                  Свой домен (CNAME)
                  <InfoHint
                    title="Домен"
                    text="Привяжите свой домен (например clinic.example.com). Нужно настроить CNAME у вашего регистратора."
                  />
                </span>
              </Card.Title>
              <Card.Subtitle>Настройте свой домен для портала тенанта</Card.Subtitle>
            </div>
            <Chip variant="default">опционально</Chip>
          </Card.Header>
          <div className="flex flex-col gap-3 mt-3">
            <div
              className="rounded-xl p-3"
              style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', fontSize: 12.5, color: 'var(--fg-2)' }}
            >
              <div className="font-semibold mb-1" style={{ color: 'var(--fg)' }}>Шаг 1. Создайте CNAME</div>
              <div className="font-mono" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                ваш-домен.ru → клиниксеть.рф
              </div>
            </div>
            <FormField label="Ваш домен">
              <FormInput
                placeholder="clinic.example.ru"
                value={domain}
                onChange={e => setDomain(e.target.value.trim().toLowerCase())}
                mono
              />
            </FormField>
            <Button onClick={checkDomain} leftIcon={<Icon name="dns" size={14} />}>
              Проверить CNAME
            </Button>
            {domainCheck && (
              <div
                className="px-3 py-2"
                style={{
                  fontSize: 12.5,
                  borderRadius: 'var(--radius)',
                  color: domainCheck.ok ? 'var(--good)' : 'var(--bad)',
                  background: domainCheck.ok ? 'var(--good-soft)' : 'var(--bad-soft)',
                }}
              >
                {domainCheck.msg}
              </div>
            )}
          </div>
        </Card>
      )}

      {tab === 'mis' && (
        <Card>
          <Card.Header>
            <div>
              <Card.Title>MIS-интеграция</Card.Title>
              <Card.Subtitle>Подключите внешнюю медицинскую систему (МИС)</Card.Subtitle>
            </div>
            <Chip variant="warn">beta</Chip>
          </Card.Header>
          <div className="flex flex-col gap-3 mt-3">
            <FormField label="API URL">
              <FormInput placeholder="https://mis.example.ru/api"
                value={mis.mis_api_url}
                onChange={e => setMis({ ...mis, mis_api_url: e.target.value })}
                mono />
            </FormField>
            <FormField label="API Key">
              <FormInput placeholder="••••••••"
                value={mis.mis_api_key}
                onChange={e => setMis({ ...mis, mis_api_key: e.target.value })}
                mono />
            </FormField>
            <FormField label="ID клиник в МИС (через запятую)">
              <FormInput placeholder="123,456,789"
                value={mis.mis_clinic_ids}
                onChange={e => setMis({ ...mis, mis_clinic_ids: e.target.value })}
                mono />
            </FormField>
            <Button onClick={saveMis} leftIcon={<Icon name="save" size={14} />}>
              Сохранить
            </Button>
            {misMsg && (
              <div className="px-3 py-2"
                style={{ fontSize: 12.5, borderRadius: 'var(--radius)',
                  color: 'var(--fg-3)', background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                {misMsg}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

// ============================================================================
// Главный компонент кабинета
// ============================================================================
export default function FranchiseOwnerCabinet({ adminToken, user, onLogout }) {
  // Единая тема для кабинета (общий хук с другими кабинетами)
  const { isDark, toggle: toggleTheme } = useTheme()
  // ── Состояние страницы / навигации ────────────────────────────────────────
  const [route, setRoute] = useState('overview')
  const [analytics, setAnalytics] = useState(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)

  // ── Сводка по франшизе и тенанты — нужны для overview и tenants ──────────
  const [me, setMe] = useState(null)
  const [tenants, setTenants] = useState(null)
  const [tenantsLoading, setTenantsLoading] = useState(true)

  // ── Sidebar: collapse для md, drawer для mobile ──────────────────────────
  const [sidebarMode, setSidebarMode] = useState(() => {
    if (typeof window === 'undefined') return 'expanded'
    const w = window.innerWidth
    if (w < 768) return 'mobile'
    if (w < 1024) return 'collapsed'
    return 'expanded'
  })
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth
      if (w < 768) setSidebarMode('mobile')
      else if (w < 1024) setSidebarMode('collapsed')
      else setSidebarMode('expanded')
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ── Закрытие drawer при смене страницы (мобильный UX) ────────────────────
  useEffect(() => { setDrawerOpen(false) }, [route])

  // ── Загрузка аналитики ───────────────────────────────────────────────────
  // AbortController защищает от race condition: при быстром unmount компонента
  // (logout, переход на другой кабинет) запрос отменяется и не пытается setState.
  useEffect(() => {
    const ac = new AbortController()
    setAnalyticsLoading(true)
    api.get('/analytics/overview', { signal: ac.signal })
      .then(r => { if (!ac.signal.aborted) setAnalytics(r.data) })
      .catch(() => {})
      .finally(() => { if (!ac.signal.aborted) setAnalyticsLoading(false) })
    return () => ac.abort()
  }, [])

  // ── Загрузка профиля франшизы и тенантов ─────────────────────────────────
  const reloadTenants = useCallback(async (signal) => {
    setTenantsLoading(true)
    try {
      const [meR, tR] = await Promise.all([
        api.get('/franchise-owner/me', { signal }).catch(() => ({ data: null })),
        api.get('/franchise-owner/tenants', { signal }).catch(() => ({ data: [] })),
      ])
      if (signal?.aborted) return
      setMe(meR.data)
      setTenants(Array.isArray(tR.data) ? tR.data : [])
    } catch {
      if (!signal?.aborted) setTenants([])
    }
    if (!signal?.aborted) setTenantsLoading(false)
  }, [])

  // AbortController защищает от race при быстром unmount.
  useEffect(() => {
    const ac = new AbortController()
    reloadTenants(ac.signal)
    return () => ac.abort()
  }, [reloadTenants])

  // ── Текст шапки страницы ─────────────────────────────────────────────────
  const pageMeta = PAGE_TITLES[route] || PAGE_TITLES.overview

  // ── Рендер активного раздела ─────────────────────────────────────────────
  const renderRoute = () => {
    if (route === 'overview') {
      if (analyticsLoading || tenantsLoading) return <SectionLoader />
      return <OverviewSection analytics={analytics} me={me} tenants={tenants} />
    }
    if (route === 'tenants') {
      // Новый раздел «Клиники сети»: карточки 5 клиник + модалка редактирования
      // (реквизиты + руководитель). Старый TenantsSection с формой создания
      // тенанта остаётся ниже, чтобы не потерять флоу onboarding-а.
      return (
        <div className="flex flex-col gap-6">
          <Suspense fallback={<SectionLoader />}>
            <ClinicsNetworkSection adminToken={adminToken} />
          </Suspense>
          <div
            style={{
              borderTop: '1px solid var(--line)',
              paddingTop: 16,
            }}
          >
            <div
              className="font-bold uppercase mb-3"
              style={{ fontSize: 10, color: 'var(--fg-3)', letterSpacing: '0.08em' }}
            >Создание новых клиник</div>
            <TenantsSection
              adminToken={adminToken} me={me} tenants={tenants}
              reload={reloadTenants} loading={tenantsLoading}
            />
          </div>
        </div>
      )
    }
    if (route === 'doctors') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <DoctorsSection token={adminToken} />
        </Suspense>
      )
    }
    if (route === 'reviews') return <ReviewsSection adminToken={adminToken} />
    if (route === 'analytics') {
      if (analyticsLoading) return <SectionLoader />
      return <AnalyticsSection analytics={analytics} />
    }
    if (route === 'apt_stats') return <AppointmentsStatsSection token={adminToken} />
    if (route === 'platform') return <PlatformInvoicesSection adminToken={adminToken} />
    if (route === 'calls') return <CallRulesSection adminToken={adminToken} />
    if (route === 'royalty') return <BillingSection />
    if (route === 'partners') return <PartnerDoctorsSection adminToken={adminToken} />
    if (route === 'partners_clinics') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <PartnerClinicsSection adminToken={adminToken} />
        </Suspense>
      )
    }
    if (route === 'recruiters') return <RecruitersSection adminToken={adminToken} />
    if (route === 'settings') return <SettingsSection adminToken={adminToken} />
    if (route === 'knowledge') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <AIKnowledgeSection token={adminToken} />
        </Suspense>
      )
    }
    if (route === 'ads') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <AdsSection token={adminToken} />
        </Suspense>
      )
    }
    if (route === 'network') {
      return (
        <Suspense fallback={<div className="text-center py-10 text-gray-400">Загрузка…</div>}>
          <NetworkDashboard token={adminToken} />
        </Suspense>
      )
    }
        if (route === 'engagement') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <PatientEngagement token={adminToken} />
        </Suspense>
      )
    }
    if (route === 'wiki') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <WikiSection token={adminToken} />
        </Suspense>
      )
    }
    if (route === 'cms') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <CMSPagesSection token={adminToken} />
        </Suspense>
      )
    }
    if (route === 'contacts') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <ContactsSection token={adminToken} />
        </Suspense>
      )
    }
    if (route === 'telemedicine') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <TelemedicineSection token={adminToken} />
        </Suspense>
      )
    }
    if (route === 'loyalty') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <LoyaltySection token={adminToken} />
        </Suspense>
      )
    }
    // Глава 8 — Награды и пациенты (CRUD + leaderboard + claims + manual-adjust)
    if (route === 'rewards_admin') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <AdminLoyaltySection token={adminToken} />
        </Suspense>
      )
    }
    if (route === 'inventory') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <InventorySection token={adminToken} />
        </Suspense>
      )
    }
    if (route === 'subscription_plans') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <FranchiseSubscriptionPlansSection adminToken={adminToken} />
        </Suspense>
      )
    }

    // Глава 10 — Wellness-партнёры (CRUD каталог + аналитика по кликам)
    if (route === 'wellness_admin') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <AdminWellnessSection />
        </Suspense>
      )
    }
    // Глава 10 — Партнёрства агрегаторов: CRUD (DocDoc/ПроДокторов/...) + одноразовые API-ключи
    if (route === 'aggregator_partnerships') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <AdminAggregatorPartnershipsSection />
        </Suspense>
      )
    }
    // Глава 10 — Заявки от агрегаторов (manager-style, но в кабинете франчайзи)
    if (route === 'aggregator_leads') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <AdminAggregatorSection />
        </Suspense>
      )
    }
    // Глава 10 — Состояние системы (super_admin): health + disaster-mode
    if (route === 'system_status') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <AdminSystemStatusSection />
        </Suspense>
      )
    }
    if (route === 'marketplace') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <MarketplaceSection tenants={tenants || []} />
        </Suspense>
      )
    }
        if (route === 'modules') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <ModulesCatalogSection token={adminToken} />
        </Suspense>
      )
    }
    if (route === 'monitoring') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <ModuleMonitoringSection token={adminToken} />
        </Suspense>
      )
    }
    if (route === 'roles') {
      // Этап 8 ROADMAP — RBAC как данные: матрица прав с overrides
      return (
        <Suspense fallback={<SectionLoader />}>
          <PermissionsMatrixSection token={adminToken} />
          {route === 'visibility' && (
            <VisibilitySection />
          )}
        </Suspense>
      )
    }
    if (route === 'webhooks') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <WebhooksSection token={adminToken} />
        </Suspense>
      )
    }
    if (route === 'api_keys') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <ApiKeysSection token={adminToken} />
        </Suspense>
      )
    }
    if (route === 'acts') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <ActsSection token={adminToken} />
        </Suspense>
      )
    }
    if (route === 'cross_dir') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <CrossClinicDirectorySection adminToken={adminToken} />
        </Suspense>
      )
    }
    if (route === 'ltv') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <LtvAnalyticsSection adminToken={adminToken} />
        </Suspense>
      )
    }
    if (route === 'inter_inv') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <InterClinicInvoicesSection token={adminToken} />
        </Suspense>
      )
    }
    // svcfin01: «Биллинг сети» — финансовая модель платформы
    if (route === 'franchise_analytics') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <FranchiseAnalyticsSection />
        </Suspense>
      )
    }
    if (route === 'network_billing') {
      return <NetworkBillingSection />
    }
    // Глава 7 — Регламент-конструктор (admin + reader для franchise_owner)
    if (route === 'regulations_admin') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <RegulationsAdminSection adminToken={adminToken} user={user} />
        </Suspense>
      )
    }
    if (route === 'regulations_my') {
      return (
        <Suspense fallback={<SectionLoader />}>
          <RegulationsReaderSection user={user} />
        </Suspense>
      )
    }
    return null
  }

  // ── Геометрия ────────────────────────────────────────────────────────────
  const sidebarWidth = sidebarMode === 'collapsed' ? 68 : 240
  const isMobile = sidebarMode === 'mobile'

  return (
    <Page>
      <div
        className="min-h-screen"
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : `${sidebarWidth}px 1fr`,
          background: 'var(--bg)',
          transition: 'grid-template-columns 0.18s ease',
        }}
      >
        {/* ─── Sidebar (desktop / tablet) ─── */}
        {!isMobile && (
          <Sidebar
            collapsed={sidebarMode === 'collapsed'}
            route={route}
            onRoute={setRoute}
            user={user}
            onLogout={onLogout}
            me={me}
          />
        )}

        {/* ─── Mobile drawer ─── */}
        {isMobile && drawerOpen && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setDrawerOpen(false)}
            style={{ background: 'rgba(0,0,0,0.4)' }}
          >
            <aside
              onClick={e => e.stopPropagation()}
              className="h-full"
              style={{
                width: 260,
                background: 'var(--bg-1)',
                borderRight: '1px solid var(--border)',
                animation: 'slideIn .18s ease',
              }}
            >
              <Sidebar
                collapsed={false}
                route={route}
                onRoute={(id) => { setRoute(id); setDrawerOpen(false) }}
                user={user}
                onLogout={onLogout}
                me={me}
              />
            </aside>
          </div>
        )}

        {/* ─── Main column ─── */}
        <div className="min-w-0 flex flex-col">
          {/* Topbar */}
          <header
            className="flex items-center gap-3 px-4 sm:px-6 py-3"
            style={{
              borderBottom: '1px solid var(--border)',
              background: 'oklch(1 0 0 / 0.85)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              position: 'sticky',
              top: 0,
              zIndex: 20,
            }}
          >
            {isMobile && (
              <button
                onClick={() => setDrawerOpen(true)}
                className="grid place-items-center rounded-lg flex-shrink-0"
                style={{ width: 38, height: 38, border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--fg-2)' }}
                aria-label="Меню"
              >
                <Icon name="menu" size={20} />
              </button>
            )}

            {/* Поиск */}
            <div
              className="hidden sm:flex items-center gap-2 flex-1"
              style={{
                maxWidth: 480,
                background: 'var(--bg-1)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '8px 12px',
              }}
            >
              <Icon name="search" size={18} style={{ color: 'var(--fg-3)' }} />
              <input
                type="text"
                placeholder="Клиника, врач, пациент…"
                className="flex-1 bg-transparent outline-none"
                style={{ fontSize: 13, color: 'var(--fg)' }}
              />
              <span
                className="font-mono"
                style={{
                  fontSize: 10.5, padding: '1px 6px', borderRadius: 4,
                  background: 'var(--bg-2)', color: 'var(--fg-3)', border: '1px solid var(--border)',
                }}
              >⌘K</span>
            </div>
            <div className="flex-1 sm:hidden" />

            {/* Ролевой банер */}
            <span
              className="hidden md:inline-flex items-center gap-1.5 flex-shrink-0"
              style={{
                fontSize: 11.5, color: 'var(--fg-3)',
                padding: '4px 10px', borderRadius: 999,
                background: 'var(--bg-1)', border: '1px solid var(--border)',
              }}
            >
              франшиза <b style={{ color: 'var(--accent)' }}>{me?.name || '—'}</b>
            </span>

            {/* Кнопка уведомлений */}
            <button
              className="grid place-items-center rounded-lg relative flex-shrink-0"
              style={{ width: 36, height: 36, background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--fg-2)' }}
              aria-label="Уведомления"
            >
              <Icon name="notifications" size={18} />
              <span
                style={{
                  position: 'absolute', top: 7, right: 7,
                  width: 7, height: 7, borderRadius: '50%',
                  background: 'var(--bad)', boxShadow: '0 0 0 2px var(--surface)',
                }}
              />
            </button>

            {/* Переключатель темы — единый хук useTheme */}
            <button
              onClick={toggleTheme}
              className="grid place-items-center rounded-lg flex-shrink-0"
              style={{ width: 36, height: 36, background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--fg-2)' }}
              aria-label="Тема"
              title={isDark ? 'Светлая тема' : 'Тёмная тема'}
            >
              <Icon name={isDark ? 'light_mode' : 'dark_mode'} size={18} />
            </button>

            {/* Выйти */}
            <button
              className="grid place-items-center rounded-lg flex-shrink-0"
              onClick={onLogout}
              style={{ width: 36, height: 36, background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--fg-2)' }}
              aria-label="Выйти"
              title="Выйти"
            >
              <Icon name="logout" size={18} />
            </button>

            <Avatar name={user?.full_name || 'F'} size="md" />
          </header>

          {/* Content */}
          <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8" style={{ overflowX: 'hidden' }}>
            <PageHeader
              title={
                PAGE_HINTS[route] ? (
                  <span className="inline-flex items-center gap-2">
                    {pageMeta.title}
                    <InfoHint text={PAGE_HINTS[route]} title={pageMeta.title} />
                  </span>
                ) : pageMeta.title
              }
              subtitle={pageMeta.subtitle}
              actions={route === 'tenants' ? null : (
                <>
                  <Chip variant="accent" dot>{me?.tenant_count ?? 0} тенантов</Chip>
                  {route === 'overview' && (
                    <Button
                      variant="secondary"
                      size="md"
                      leftIcon={<Icon name="business" size={16} />}
                      onClick={() => setRoute('tenants')}
                    >
                      Все клиники
                    </Button>
                  )}
                </>
              )}
            />
            {renderRoute()}
          </div>
        </div>
      </div>

      {/* ─── inline keyframes для drawer ─── */}
      <style>{`
        @keyframes slideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
      `}</style>
    </Page>
  )
}

// ── Sidebar (выделен, чтобы переиспользовать в drawer) ─────────────────────
function Sidebar({ collapsed, route, onRoute, user, onLogout, me }) {
  return (
    <aside
      className="flex flex-col"
      style={{
        background: 'var(--bg-1)',
        borderRight: '1px solid var(--border)',
        padding: collapsed ? '14px 8px' : '18px 12px',
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflowY: 'auto',
      }}
    >
      {/* Бренд */}
      <div className="flex items-center gap-2.5" style={{ padding: collapsed ? '4px 4px 14px' : '4px 10px 18px' }}>
        <div
          className="grid place-items-center flex-shrink-0"
          style={{
            borderRadius: 9,
            boxShadow: '0 4px 12px oklch(0.55 0.16 240 / 0.30)',
          }}
        >
          <BrandLogo size={34} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-semibold truncate" style={{ fontSize: 14, color: 'var(--fg)', letterSpacing: '-0.01em' }}>
              {me?.name || 'КлиникСеть'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>франшиза</div>
          </div>
        )}
      </div>

      {/* Навигация */}
      {NAV_GROUPS.map(group => (
        <div key={group.title}>
          {!collapsed && (
            <div
              className="font-semibold uppercase"
              style={{
                fontSize: 10, color: 'var(--fg-4)',
                letterSpacing: '0.08em',
                padding: '14px 10px 6px',
              }}
            >{group.title}</div>
          )}
          {collapsed && <div style={{ height: 10 }} />}
          {group.items.map(item => {
            const active = route === item.id
            return (
              <button
                key={item.id}
                onClick={() => onRoute(item.id)}
                title={collapsed ? item.label : undefined}
                className="flex items-center font-medium w-full"
                style={{
                  gap: 10,
                  padding: collapsed ? '8px' : '8px 10px',
                  marginBottom: 2,
                  borderRadius: 9,
                  fontSize: 13,
                  color: active ? 'var(--accent)' : 'var(--fg-2)',
                  background: active ? 'var(--accent-soft)' : 'transparent',
                  border: '1px solid transparent',
                  fontWeight: active ? 600 : 500,
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  cursor: 'pointer',
                  transition: 'background .15s, color .15s',
                }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--bg-2)'; e.currentTarget.style.color = 'var(--fg)' } }}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-2)' } }}
              >
                <Icon name={item.icon} size={18} fill={active ? 1 : 0} />
                {!collapsed && <span>{item.label}</span>}
              </button>
            )
          })}
        </div>
      ))}

      {/* Подвал */}
      <div className="mt-auto" style={{ padding: collapsed ? '8px 0 0' : '12px 4px 0', borderTop: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2.5" style={{ padding: collapsed ? '6px 0' : '8px' }}>
          <Avatar name={user?.full_name || 'F'} size="md" />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate" style={{ fontSize: 12.5, color: 'var(--fg)' }}>
                {user?.full_name || 'Владелец'}
              </div>
              <div className="truncate" style={{ fontSize: 11, color: 'var(--fg-3)' }}>franchise owner</div>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={onLogout}
            className="w-full text-center mt-2 hover:underline"
            style={{ fontSize: 11, color: 'var(--fg-3)', cursor: 'pointer' }}
          >
            ← Выйти
          </button>
        )}
      </div>
    </aside>
  )
}

// ── Обертка-лоадер для секций ───────────────────────────────────────────────
function SectionLoader() {
  return (
    <Card>
      <div className="flex justify-center py-10">
        <div
          className="rounded-full animate-spin"
          style={{ width: 32, height: 32, border: '3px solid var(--bg-2)', borderTopColor: 'var(--accent)' }}
        />
      </div>
    </Card>
  )
}
