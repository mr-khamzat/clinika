# Mobile Adaptation Backlog

## 2026-05-06: Quick mobile pass перед запуском мобильного приложения

Быстрый pass прошёл по 17 файлам кабинетов. Исправлены критичные проблемы:
- Тач-таргеты <44px (back-кнопки 32px → 44px, logout-кнопки 32px → 44px)
- Bottom nav кнопки без min-height
- Таблицы без overflow-x wrapper в ManagerDashboard / ManagerAnalytics
- Grid-cols-4 на 320px → grid-cols-3 sm:grid-cols-4 в ManagerDashboard quick links
- Заголовок ManagerAppointments с табами adjacent → flex-col на mobile

## TODO для следующей сессии (полный редизайн)

### AdminLayout.jsx
- 7700+ строк, не трогали в этой сессии
- Нужен **полный редизайн** под mobile-first
- Десктоп-таблицы с 8+ колонками не адаптированы (доктора, пациенты, направления, бонусы)
- Сложные модалы редактирования услуг/врачей/клиник — desktop-only сейчас
- Sidebar 250px → drawer на мобильном

### SupervisorCabinet.jsx
- 3758 строк, прошли только bottom nav
- Роль удаляется в ROADMAP — НЕ ИНВЕСТИРОВАТЬ время в редизайн
- Если решили оставить — нужен полный pass отдельно

### ManagerRecruitDoctors.jsx
- Inline styles вместо tailwind классов делает override сложным
- AddModal: на мобильном открывается как card без bottom-sheet стиля
- Список карточек врачей с кнопками "Сменить данные" / "Заблокировать" / "Активировать" на 320px wraps awkwardly
- TODO: переписать на tailwind + bottom-sheet модалы

### OperationalCabinet.jsx
- Bottom nav с 5 пунктами (4 + Ещё) — на 320px ≈64px на пункт, лейблы упираются
- Booking modal `bookVisitDoc` (приём приезжего врача) — занимает весь экран, scrollable, OK
- Forms с datepicker/timepicker на native HTML — приемлемо

### FranchiseOwnerCabinet.jsx
- 10 табов в bottom nav → сделан horizontal scroll, но для UX лучше вынести в drawer "Ещё"
- TenantsList с MRR данными на mobile сжимается, вторая строка с meta wraps
- TODO: переход на drawer pattern как в ManagerDashboard

### ManagerHistory.jsx
- Карточки направлений ОК на mobile
- Status tabs сделаны horizontal scrollable
- TODO: ExpandedRow содержимое (Bonus, Cancel reason etc.) использует text-xs (12px) — не критично, но не идеал

### ManagerAnalytics.jsx
- DailyChart SVG viewBox 340 — масштабируется, но на 320px метки могут перекрываться
- TODO: на 320px хотя бы каждый 7-й день вместо каждого 5-го, или вертикальные метки

### Общие TODO:
- Не везде применён `safe-area-inset-bottom` для нижней навигации (проверить iOS notch)
- Шрифт `text-xs` (12px) используется повсеместно для labels/captions — приемлемо, но в 4-5 местах основной контент тоже — нужна замена на text-sm
- Modal sheets: ручной back-button (Esc, swipe-down) не реализован
- Toast уведомлений нет, fallback на alert

## Принцип на следующую волну (Wave 5)
- Полный редизайн в стиле design-preview-2 (см. /opt/clinika/frontend/src/pages/DesignPreview2.jsx)
- Использовать дизайн-токены и компоненты из DesignSystem.jsx
- Bottom-sheet модалы везде на mobile
- Skeleton loaders вместо spinner
- Pull-to-refresh для списков
- Native-like transitions (slide-in, scale-out)


## 2026-05-06: Депрекация старой `plugin_*` системы (Этап 7 ROADMAP, продолжение)

Старая система `PluginCatalog` / `PluginFeature` / `TenantPluginFeature` /
`BillingEvent` дублирует новую `CommercialModule` / `TenantModuleSubscription` /
`BillingLedger`. Все эндпоинты `/plugins/*` помечены `deprecated=True`,
отдают заголовки `Deprecation: true`, `Sunset: 2026-08-01`,
`Link: ...rel="successor-version"`. Сервисный слой `app/services/plugin_service.py`
вызывает `warnings.warn(DeprecationWarning)` в каждой функции.

План полного удаления (≥30 дней warning-периода, не раньше августа 2026):

- [ ] Миграция данных `plugin_features` → `commercial_modules`
      (массовый INSERT с маппингом ключей: `feature.key` → `module.key`)
- [ ] Перенос `tenant_plugin_features` → `tenant_module_subscriptions`
      (история включений и trial-периоды)
- [ ] Перенос `billing_events` → `billing_ledger` (или оставить read-only для аудита)
- [ ] Удалить роутер `app/routers/plugins.py` + регистрацию в `main.py`
- [ ] Удалить модели `PluginCatalog/PluginFeature/TenantPluginFeature/BillingEvent`
- [ ] Удалить миграции таблиц старой системы (или оставить как archive-only)
- [ ] Удалить сервис `app/services/plugin_service.py`
- [ ] Удалить сидер `seed_plugins.py` / любые scripts ссылки
- [ ] Frontend: заменить `PluginsSection` в `AdminLayout` на `ModulesSection`
- [ ] Документация: BILLING_ARCHITECTURE.md — выписать только новую систему

### Минимум до удаления
За 30 дней до удаления отправить email-нотификацию супер-админам
тенантов, использующих устаревшие endpoints. Считать обращения через
`Deprecation: true` header в логах nginx / access-log.

### Связанные «неоплачиваемые ещё» гейты
Закрыто Этапом 7:
- `webhooks` → `require_module("webhooks")`
- `ai_assistant` → `require_module("ai_assistant")` (бывшая FAQ-фича)
- `white_label` → `require_module("white_label")` (CMS write-endpoints)
- `mis_sync` → `require_module("mis_sync")` (импорт пациентов/визитов)

Проверить позже:
- [ ] `ads.py` — рекламные кампании (модуль уже есть, гейт в роутере?)
- [ ] `referrals_advanced` — массовая аналитика партнёров (drill-down)
- [ ] `recruiter.py` — модуль найма врачей, нужен ли отдельный гейт
- [ ] Patient-portal premium-фичи (vitals, medcard) — что бесплатно, что нет

## 2026-05-06: Wiki — раздел «Обучение пользованию КлиникСеть»

Создана статическая wiki через React + react-markdown. Контент в `frontend/src/wiki-content/*.md`, рендер через `<Wiki>` и `<WikiArticle>` (lazy). Маршруты: `/wiki` и `/wiki/:slug`, публичные.

### TODO для следующей сессии

#### Безопасность: DOMPurify (КРИТИЧНО при user-generated)
- Сейчас контент wiki — статический (только наш). `rehype-raw` пропускает HTML без санитизации (нужно для iframe из design2).
- **Если wiki когда-то станет редактируемой через UI** — ОБЯЗАТЕЛЬНО прогонять контент через DOMPurify перед сохранением:
  - `npm i dompurify`
  - В компоненте редактирования: `DOMPurify.sanitize(content, { ALLOWED_TAGS: [...], ALLOWED_ATTR: [...] })`
  - Whitelist iframe src только для `/design2/...` (см. как сделано в `WikiViewer.jsx`).
- Без этого — XSS через злонамеренный markdown с HTML-инъекциями.

#### Полировка
- Добавить картинки/скриншоты внутрь markdown (сейчас иллюстрации только через iframe в role-доках).
- Подсветка активного заголовка в TOC при скролле (IntersectionObserver).
- Mobile: открытие drawer по свайпу справа.
- Keyboard navigation: ↑↓ по sidebar.
- i18n: подготовить структуру для перевода на русский/казахский/английский.

#### Контент
- Добавить раздел «Сценарии и кейсы» — типовые рабочие сценарии (например, «Что делать, если пациент пришёл по QR-направлению, а партнёр не активен»).
- Видео-туториалы для каждой роли (3–5 минут, embedded).
- Глоссарий терминов (приём, направление, бонус, тенант, модуль).
