# pages [03] — кабинет франшизы, публичные страницы и часть кабинета менеджера

Это срез из 12 страниц-компонентов React (`frontend/src/pages`, файлы 25–36 по алфавиту). Все они — **страницы-«экраны»** уровня роутинга (рендерятся из `App.jsx`/роутера, а не вложенные секции). Группа неоднородна и распадается на четыре подгруппы:

1. **Кабинет владельца франшизы** (`franchise_owner`): монолит `FranchiseOwnerCabinet.jsx` (2661 строка, оркестратор ~50 секций) + два самостоятельных экрана старого образца `FranchiseModules.jsx` и `FranchiseRevenue.jsx` (inline `<style>`, прямые `api.*`, без дизайн-системы).
2. **Публичные / без-авторизации страницы**: `Landing.jsx` (большой лендинг), `InviteAccept.jsx` и `InviteRegister.jsx` (две **разные** страницы приёма инвайтов — рекрутер vs партнёр).
3. **Кабинет пациента/врача**: `History.jsx` — журнал направлений (исходящие/входящие).
4. **Кабинет менеджера** (обёртки в `_ManagerShell`): `ManagerActivity`, `ManagerAggregator`, `ManagerAnalytics`, `ManagerAppointments`, `ManagerBillingLedger`.

Все компоненты — клиентские, общаются с бэком через `../api` (axios-инстанс с baseURL и токеном) либо напрямую через `axios` + `API_BASE`. Финансы повсеместно форматируются в рублях (`toLocaleString('ru-RU')`); суммы приходят с бэка готовыми числами — клиент только отображает.

## Оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `FranchiseModules.jsx` | Матрица модулей по клиникам + внутренние акты | 432 |
| `FranchiseOwnerCabinet.jsx` | Главный кабинет франшизы, оркестратор ~50 секций | 2661 |
| `FranchiseRevenue.jsx` | Доход франшизы с бонусов клиник | 232 |
| `History.jsx` | Журнал направлений: исходящие/входящие | 339 |
| `InviteAccept.jsx` | Приём инвайта рекрутером (регистрация врача) | 123 |
| `InviteRegister.jsx` | Регистрация партнёра по инвайт-коду | 220 |
| `Landing.jsx` | Публичный лендинг КлиникСеть + вход/демо | 2318 |
| `ManagerActivity.jsx` | Журнал активности менеджера (audit-log) | 168 |
| `ManagerAggregator.jsx` | Обёртка: заявки агрегаторов в ManagerShell | 35 |
| `ManagerAnalytics.jsx` | Аналитика менеджера: конверсия, графики, LTV | 493 |
| `ManagerAppointments.jsx` | Записи: слоты/календарь/статистика | 96 |
| `ManagerBillingLedger.jsx` | Журнал биллинг-операций франшизы + CSV | 481 |

---

## `frontend/src/pages/FranchiseModules.jsx`
- **Назначение:** Экран «Модули по клиникам» (Опция B распределения модулей внутри франшизы). Матрица подтенанты × модули: чекбокс вкл/выкл + внутренняя цена франшизы за каждую ячейку; внизу — генерация и оплата внутренних актов.
- **Ключевые элементы:** дефолт-экспорт `FranchiseModules()`. Состояние: `matrix`, `catalog`, `acts`, `period`. Мемо: `grantsByKey` (индекс `tenant_id|module_key`), `totalByTenant`, `totalByModule`, `totalNetwork`. Функции: `toggleGrant`, `setPrice`, `saveAll` (массовый PUT), `generateActs`, `markPaid`, `fmtRub`. Адаптивная верстка: таблица (`md:block`) + карточки (`md:hidden`). Стили — в константе `FM_CSS` (inline `<style>`).
- **Эндпоинты:** не роутер (фронтенд), но потребляет:

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/franchise-owner/modules/grants` | — | `{tenants, modules, grants}` | Матрица распределения |
| GET | `/franchise-owner/modules/catalog` | — | `{modules:[{key,name,subscribed_by_franchise,price_monthly,price_monthly_platform}]}` | Каталог модулей франшизы |
| GET | `/franchise-owner/modules/acts` | — | `{acts:[...]}` | Список внутренних актов |
| PUT | `/franchise-owner/modules/grants` | `{grants:[{tenant_id,module_key,is_active,internal_price_rub}]}` | `{updated,activated,deactivated}` | Массовое сохранение |
| POST | `/franchise-owner/modules/generate-acts` | `{period:"YYYY-MM"}` | `{created,updated}` | Генерация актов за период |
| POST | `/franchise-owner/modules/acts/{actId}/mark-paid` | — | — | Отметить акт оплаченным |

- **Зависимости:** `../api` (axios-инстанс). Внешних компонентов нет — самодостаточный экран со своим CSS.
- **Где менять для типовых задач:** новые столбцы в матрице → правь `<thead>`/`<tbody>` таблицы и блок мобильных карточек (логику дублируешь в обоих); формула итогов → `totalByTenant`/`totalByModule`; формат рублей → `fmtRub`; поля в payload сохранения → `saveAll`.
- **Подводные камни:** **двойная верстка** — таблица и карточки рендерят одну логику, изменения нужно вносить В ОБОИХ местах. `internal_price_rub` хранится как число, но используется и в input (`Number(value)||0`) — следи за NaN. `alert()`/`confirm()` нативные (не дизайн-система). Цена редактируема только при `is_active && subscribedByFranchise`.
- **Строк:** 432

---

## `frontend/src/pages/FranchiseOwnerCabinet.jsx`
- **Назначение:** Главный кабинет владельца франшизы — премиум-редизайн под `/public/design2/admin.html` (sidebar + topbar + content). Один большой файл-оркестратор: собственный sidebar с ~6 группами навигации (десятки пунктов), и `renderRoute()`, который по `route` рендерит либо локальную секцию, либо лениво подгружаемую секцию из `../sections`.
- **Ключевые элементы:**
  - Дефолт-экспорт `FranchiseOwnerCabinet({ adminToken, user, onLogout })`.
  - Внутренние компоненты-секции: `OverviewSection`, `TenantsSection`, `ReviewsSection`, `AnalyticsSection`, `NetworkBillingSection`, `PartnerDoctorsSection`, `RecruitersSection`, `SettingsSection`.
  - Вспомогательные: `Icon`, `Stars`, `Sidebar`, `SectionLoader`, формовые `FormField`/`FormInput`/`FormSelect`.
  - Хелперы аналитики: `fmtMetric`, `fmtDelta`, `deltaTrend`; константы `METRIC_LABELS`, `METRIC_ORDER`.
  - Конфиги: `NAV_GROUPS` (структура сайдбара), `PAGE_TITLES`, `PAGE_HINTS`, `PLAN_LABELS`, `EMPTY_TENANT`.
  - ~35 lazy-секций (`lazy(() => import('../sections/...'))`): Doctors, AIKnowledge, Ads, PatientEngagement, NetworkDashboard, ClinicChat, Wiki, Contacts, Webhooks, ApiKeys, ModulesCatalog, Marketplace, Branding, CMSPages, Acts, InterClinicInvoices, PartnerClinics, PermissionsMatrix, Visibility, LtvAnalytics, CrossClinicDirectory, ClinicsNetwork, Telemedicine, Loyalty, AdminLoyalty, Inventory, FranchiseSubscriptionPlans, ModuleMonitoring, FranchiseAnalytics, FranchisePnl, FranchiseReferrals, FranchiseModuleGaps, RegulationsAdmin, RegulationsReader, AdminWellness, AdminAggregatorPartnerships, AdminAggregator, AdminSystemStatus.
- **Эндпоинты:** потребляемые напрямую в этом файле (секции тянут свои):

| Метод | Путь | Где | Возвращает | Назначение |
|-------|------|-----|------------|------------|
| GET | `/profile/me` | главный компонент | профиль сотрудника | Аватар/ProfileModal |
| GET | `/analytics/overview` | главный (AbortController) | сводка | Overview + Analytics |
| GET | `/franchise-owner/me` | `reloadTenants` | профиль франшизы | Шапка, sidebar |
| GET | `/franchise-owner/tenants` | `reloadTenants` | список тенантов | Overview/Tenants |
| POST | `/franchise-owner/tenants` | `TenantsSection.submit` | созданный тенант + креды | Создание клиники |
| GET | `/reviews/moderate` | `ReviewsSection` | `{items,total}` | Модерация отзывов |
| PATCH | `/reviews/{id}/{action}` | `ReviewsSection.moderate` | — | approve/reject |
| DELETE | `/reviews/{id}` | `ReviewsSection.deleteReview` | — | Удаление отзыва |
| GET | `/franchise-owner/finance/network-overview` | `NetworkBillingSection` | долги/матрица сети | Биллинг сети |
| POST | `/franchise-owner/finance/trigger-billing` | `NetworkBillingSection` | `{created,number,total_amount}` | Ручной счёт от платформы |
| GET | `/admins/external-doctors` | `PartnerDoctorsSection` | список врачей | partner/visiting doctors |
| GET | `/manager/referrals/` | `PartnerDoctorsSection.loadReferrals` | `{items}` | Направления врача |
| GET | `/manager/recruiters` | `RecruitersSection` | список рекрутеров | Список рекрутеров |
| PATCH | `/manager/recruiters/{id}/percent` | `RecruitersSection.savePercent` | — | % бонуса |
| PATCH | `/franchise-owner/recruiters/{id}` | `saveContacts` | — | Контакты рекрутера |
| DELETE | `/franchise-owner/recruiters/{id}` | `removeRecruiter` | `{soft_deleted?}` | Удаление/деактивация |
| PATCH | `/integrations/mis/settings` | `SettingsSection.saveMis` | — | MIS-интеграция (может отсутствовать на беке — есть TODO-фоллбек) |

- **Зависимости:** `../api`, дизайн-система `../design` (`Page, PageHeader, Card, KpiRow, KpiCard, Chip, Button, Avatar, EmptyState, Sparkline, Modal, Tabs, useToast, useConfirm, InfoHint`), `../components/BrandLogo`, `../components/ProfileModal`, `../lib/useTheme`, секции `CallRulesSection`/`PlatformInvoicesSection`/`AppointmentsStatsSection` (статичные импорты) + ~35 lazy-секций из `../sections`.
- **Где менять для типовых задач:** добавить пункт меню → добавь объект в нужную группу `NAV_GROUPS`, заголовок в `PAGE_TITLES` (опц. `PAGE_HINTS`), `lazy()`-импорт секции и ветку `if (route === '...')` в `renderRoute()`. Создание тенанта → `TenantsSection.submit` + `EMPTY_TENANT`. Логика модерации отзывов → `ReviewsSection`. Сводные KPI → `OverviewSection`. Topbar/поиск/тема → главный `return`. Брейкпоинты sidebar (768/1024) → `setSidebarMode`.
- **Подводные камни:** **очень крупный файл** — навигация по якорям комментариев `// =====`. Дублирование: `fmtRub` определён и сверху, и локально в `NetworkBillingSection`. Маршрут `roles` рендерит `PermissionsMatrixSection` и (внутри той же Suspense) `VisibilitySection` по вложенному условию `route==='visibility'` — но `visibility` не имеет своей ветки в `renderRoute`, фактически секция Visibility отдельно не открывается (потенциальный баг/легаси). AbortController используется в загрузках, чтобы избежать setState после unmount. `SettingsSection.checkDomain` использует `fetch` с `mode:'no-cors'` → результат всегда «успех» (нельзя реально проверить). Многие пункты меню (wellness/aggregator/system_status) помечены для super_admin, но доступны и владельцу — доступ режется на бэке.
- **Строк:** 2661

---

## `frontend/src/pages/FranchiseRevenue.jsx`
- **Назначение:** Экран «Доходы франшизы с бонусов». Каждая клиника платит франшизе `fee_per_bonus_from_clinic` (по умолч. 100 ₽) за каждый выплаченный бонус. Показывает ставку, KPI (этот/прошлый месяц/всё время), разбивку по клиникам за период.
- **Ключевые элементы:** дефолт-экспорт `FranchiseRevenue()`. Состояние: `settings`, `dashboard`, `byClinic`, `period`, `savingFee`. Функции: `loadAll`, `changePeriod` (перезагружает только by-clinic), `saveFee` (PUT при blur, если значение изменилось). Inline-стили `FR_CSS`.
- **Эндпоинты:** потребляет:

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/franchise-owner/revenue/settings` | — | `{franchise_name,fee_per_bonus_from_clinic,platform_fee_per_bonus}` | Ставки комиссии |
| GET | `/franchise-owner/revenue/dashboard` | — | `{this_month,last_month,all_time,*_bonus_count}` | KPI |
| GET | `/franchise-owner/revenue/by-clinic` | `?period_start&period_end` | `{period_start,period_end,by_clinic[],total_*}` | Разбивка по клиникам |
| PUT | `/franchise-owner/revenue/settings` | `{fee_per_bonus_from_clinic}` | `{fee_per_bonus_from_clinic}` | Сохранение ставки |

- **Зависимости:** только `../api`. Самодостаточный экран со своим CSS (без дизайн-системы).
- **Где менять для типовых задач:** изменить набор KPI → секция `fr-kpi-grid`; таблица по клиникам → секция `fr-card` «По клиникам»; формат периода по умолчанию → инициализатор `useState(period)`. Сохранение ставки срабатывает на `onBlur` инпута.
- **Подводные камни:** ставка сохраняется только при потере фокуса И только если число изменилось (`v !== settings.fee_per_bonus_from_clinic`) — есть риск типового сравнения число/строка, но `Number()` приводит. `alert()` для ошибок. Легаси-стиль (inline CSS, oklch), без токенов дизайн-системы — отличается визуально от `FranchiseOwnerCabinet`.
- **Строк:** 232

---

## `frontend/src/pages/History.jsx`
- **Назначение:** Журнал направлений для сотрудника клиники: переключатель «Мои направления» (исходящие) / «Входящие» (из других клиник сети), фильтр по статусу и по телефону пациента (через `?patient_phone=` из чата). Карточки направлений с переходом на `/qr/:id` и запросом отмены.
- **Ключевые элементы:** дефолт-экспорт `History()` + внутренний `ReferralCard({r,onNav,onCancel,isIncoming})`. Константы: `STATUS_STYLE`, `STATUS_LABELS`, `STATUS_ICON`, `STATUS_FILTERS`. Хелперы `formatDate`/`formatTime`/`normPhone`. Состояние: `mode`, `referrals`, `incoming`, `filter`, `cancelTarget`. Мемо `filtered` (статус + телефон). `pendingIncoming` для бейджа.
- **Эндпоинты:** через хелперы `../api`: `getReferrals()` (исходящие) и `getIncomingReferrals()` (входящие). Точные пути инкапсулированы в `../api`.
- **Зависимости:** `react-router-dom` (`useNavigate`, `useSearchParams`), `../api` (`getReferrals`, `getIncomingReferrals`), `../components/CancelModal`. Tailwind-классы + захардкоженные hex-цвета (не токены).
- **Где менять для типовых задач:** новый статус направления → добавь в `STATUS_STYLE`/`STATUS_LABELS`/`STATUS_ICON`/`STATUS_FILTERS`; вид карточки → `ReferralCard`; логика входящих (подсказки) → ветки `isIncoming`. Кнопка отмены показывается только для исходящих в статусах `created`/`confirmed`.
- **Подводные камни:** два списка грузятся параллельно (`Promise.all`), `mode` переключает активный. Фильтр по телефону нормализует только цифры (`replace(/\D+/g,'')`) и ищет `includes` — частичное совпадение. Цвета захардкожены (`#1565c0` и т.п.), а не из дизайн-системы.
- **Строк:** 339

---

## `frontend/src/pages/InviteAccept.jsx`
- **Назначение:** Страница приёма инвайта **по recruiter-токену** (`/recruiter/accept/:token`) — регистрация врача, приглашённого рекрутером. Проверяет токен, показывает email + имя пригласившего, форма пароля/ФИО, при успехе предлагает войти в `/{SLUG}/admin`.
- **Ключевые элементы:** дефолт-экспорт `InviteAccept({ token })`. Стейт-машина `step`: `checking | form | success | error`. Состояние: `inviteData`, `form`, `loading`, `error`. `handleSubmit` валидирует совпадение паролей и длину (≥6).
- **Эндпоинты:** через прямой `axios` + `API_BASE`:

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `{API_BASE}/recruiter/accept/{token}` | — | `{email,recruiter_name}` | Проверка инвайта |
| POST | `{API_BASE}/recruiter/accept/{token}` | `{password,full_name?}` | — | Создание аккаунта врача |

- **Зависимости:** `axios` (напрямую, не `../api`), `../config` (`API_BASE`, `SLUG`). Tailwind + фиолетовый градиент.
- **Где менять для типовых задач:** дополнительные поля регистрации → `form` + `handleSubmit`; правила пароля → проверки в `handleSubmit`; ссылка после успеха → блок `step==='success'` (`/' + SLUG + '/admin'`).
- **Подводные камни:** **не путать с `InviteRegister.jsx`** — это РАЗНЫЕ потоки: здесь recruiter-токен → врач, регистрация в `/admin`; там invite-код → партнёр, вход в пациентское приложение. Использует сырой `axios`, не общий инстанс (нет авто-refresh токена — здесь и не нужен). Минимальная длина пароля 6 (в `InviteRegister` — 4, расхождение).
- **Строк:** 123

---

## `frontend/src/pages/InviteRegister.jsx`
- **Назначение:** Регистрация **партнёра по инвайт-коду** (`/clinika/invite/:code`), без авторизации. Грузит инфо об инвайте, показывает название приглашающей клиники, форма ФИО/телефон(=логин)/пароль. После регистрации сохраняет access+refresh токены и редиректит в `/{SLUG}/`.
- **Ключевые элементы:** дефолт-экспорт `InviteRegister({ code })`. Состояние: `inviteInfo`, `loadingInfo`, `form`, `loading`, `error`. `formatPhone` (маска `+7 (XXX) XXX-XX-XX`), `handleSubmit` (валидации + регистрация + сохранение токенов через `useAuthStore`).
- **Эндпоинты:** через хелперы `../api`: `getInviteInfo(code)`, `registerByInvite({code,full_name,phone_number,password})`, `getMe()`. Пути инкапсулированы в `../api`.
- **Зависимости:** `../api` (хелперы), `../store/auth` (`useAuthStore` — `setToken`, `setUser`), `../config` (`API_BASE`, `BASE_PATH`, `SLUG`). Tailwind + класс `text-primary`/`bg-primary` (CSS-переменная primary).
- **Где менять для типовых задач:** новые поля профиля партнёра → `form` + `handleSubmit` (см. комментарий «добавить выбор специализации»); маска телефона → `formatPhone`; редирект после регистрации → `window.location.href`.
- **Подводные камни:** **не путать с `InviteAccept.jsx`** (см. выше). Refresh-токен кладётся в `localStorage` под ключом `clinika_refresh_token_<SLUG>` — формат ключа должен совпадать с тем, что ждёт axios-интерсептор в `../api`. Минимальная длина пароля 4. Телефон становится логином. `BASE_PATH` импортируется, но в коде не используется (легаси-импорт).
- **Строк:** 220

---

## `frontend/src/pages/Landing.jsx`
- **Назначение:** Публичный маркетинговый лендинг КлиникСеть (этап 6 редизайна под `klinikset.html`). Nav → Hero (+ live чат-демо) → Numbers/Stats → SocialProof → Problems → Roles (табы 3 + grid 10) → Features (9) → ProductTour → Showcase → Flow (28 дней) → Integrations → Pricing (3 плана + мес/год) → Testimonial/Comparison/FAQ → Modules (6 платных) → Calls (десктоп-приложение) → FAQ → CTA → Footer. Содержит модалки входа, заявки на демо и калькулятор.
- **Ключевые элементы:** дефолт-экспорт `Landing()`. Внутренние компоненты: `Icon` (SVG), `FadeIn`, `LoginModal`, `ContactModal` (с honeypot `website_url`), `PriceCalculator`, `RolePreviewMock`. Константы: `ICONS`, `ROLES`, `ALL_ROLES`, `FEATURES`, `FLOW`, `PLANS`. Большой `LANDING_CSS` (+ импорт `LANDING_EXTRAS_CSS`). Глобальный listener `CustomEvent('ks:open-contact')` для открытия ContactModal из вложенных компонентов.
- **Эндпоинты:** через прямой `axios` + `API_BASE`:

| Метод | Путь | Где | Принимает | Возвращает | Назначение |
|-------|------|-----|-----------|------------|------------|
| POST | `{API_BASE}/auth/login` | `LoginModal` | `{username,password}` | `{access_token,refresh_token,redirect_url,tenant_slug}` | Единый вход с редиректом по роли |
| POST | `{API_BASE}/contact/` | `ContactModal` | `{name,phone,email,message,website_url}` | — | Заявка «Получить демо» |

- **Зависимости:** `axios`, `../store/auth` (`useAuthStore`), `../config` (`API_BASE`, `SLUG`), `../components/BrandLogo` и ~13 компонентов из `../components/landing/*` (SocialProof, FunctionalShowcase, Testimonials, FaqAccordion, CtaNewsletter, NumbersStrip, HeroChatDemo, ProductTour, IntegrationsGrid, Testimonial, Comparison, FAQ, `landing_extras.css.js`). Стили — токены из `tokens.css` (`var(--accent)` и т.д.).
- **Где менять для типовых задач:** добавить секцию → новый `<section>` в JSX + стили в `LANDING_CSS`; цены/планы → массив `PLANS` и хелпер расчёта годовой цены в `.ks-pricing-grid`; калькулятор → `PRICES`/`PLAN_NAMES` в `PriceCalculator`; ссылки на скачивание Calls → блоки `ks-hero-downloads` и `ks-calls`; логика редиректа после входа → `LoginModal.handleLogin` (различает admin vs пациентский токен по `redirect_url`).
- **Подводные камни:** **очень большой файл** (2318 строк, ~⅔ — CSS-строка). Цены в трёх местах: `PLANS` (лендинг), `PriceCalculator.PRICES`, текст модулей — при изменении тарифов синхронизируй. `LoginModal` сам кладёт токены в `localStorage` под ключами `clinika_admin_token_<slug>` / `clinika_token_<slug>` — формат должен совпадать с `../api`. Honeypot `website_url` (скрытое поле) обязателен — бэк отбивает заполнивших его ботов. Версии Calls в тексте местами рассинхронизированы (1.0.28 в href, 1.0.30 в подписи). Захардкоженный fallback-slug `'arc'`.
- **Строк:** 2318

---

## `frontend/src/pages/ManagerActivity.jsx`
- **Назначение:** Журнал активности (audit-log) в кабинете менеджера: события системы с фильтром по датам, иконкой по типу действия и постраничной подгрузкой («Загрузить ещё»).
- **Ключевые элементы:** дефолт-экспорт `ManagerActivity()`. Хелперы `actionMeta(action)` (иконка/цвет по подстроке действия) и `fmtDt`. Состояние: `logs`, `page`, `hasMore`, `dateFrom/dateTo`, `error`. `load(p, replace)` — пейджинг по 50.
- **Эндпоинты:** через `getActivityLog(params)` из `../api`; `params`: `{page, limit:50, date_from?, date_to?}`. Возвращает массив записей (`{id,action,user_name,entity_type,created_at}`).
- **Зависимости:** `../api` (`getActivityLog`), дизайн-система `../design` (`Card, Chip, Button, EmptyState`), `./_ManagerShell`.
- **Где менять для типовых задач:** маппинг иконок/цветов событий → `actionMeta` (сейчас по русским подстрокам «Создано»/«Подтверждено»/«отмен»/«Выплата»); размер страницы → `limit:50` в `load`; формат даты → `fmtDt`. Поля строки лога → блок рендера внутри `Card padded={false}`.
- **Подводные камни:** `actionMeta` матчит по подстрокам русского текста `action` — хрупко к изменению формулировок на бэке. `hasMore` определяется как `items.length === 50` (если ровно 50 на последней странице — лишний пустой запрос). `replace`-флаг переключает «заменить» vs «дописать».
- **Строк:** 168

---

## `frontend/src/pages/ManagerAggregator.jsx`
- **Назначение:** Тонкая страница-обёртка: рендерит секцию «Заявки агрегаторов» (`AdminAggregatorSection`) внутри `ManagerShell`, активный пункт bottom-nav — `aggregator`. Лиды от DocDoc/ПроДокторов/Яндекс.Здоровье.
- **Ключевые элементы:** дефолт-экспорт `ManagerAggregator()`. Lazy-импорт `AdminAggregatorSection`, обёрнутый в `Suspense` со skeleton-фоллбеком.
- **Эндпоинты:** нет (вся загрузка данных — внутри `AdminAggregatorSection`).
- **Зависимости:** `./_ManagerShell`, lazy `../sections/AdminAggregatorSection`.
- **Где менять для типовых задач:** заголовок/подзаголовок/иконка вкладки → пропсы `ManagerShell`; сама логика заявок — в `AdminAggregatorSection`, не здесь.
- **Подводные камни:** легковесный адаптер — та же секция (`AdminAggregatorSection`) переиспользуется и в кабинете франшизы. Менять данные/логику тут не нужно.
- **Строк:** 35

---

## `frontend/src/pages/ManagerAnalytics.jsx`
- **Назначение:** Аналитика менеджера. Верхние табы: Аналитика / Возвратность / Возвратность·МИС / Источники / Программы / No-show / LTV / Звонки. Вкладка «overview» — собственный экран (Hero с конверсией, KPI Row, SVG-график динамики, сравнение месяцев, топ услуг, конверсия по сотрудникам, сравнение клиник), остальные — lazy-секции. Поддерживает scope-фильтр по клинике.
- **Ключевые элементы:** дефолт-экспорт `ManagerAnalytics()`. Внутренние: `DailyChart` (рукописный SVG line+area-chart), `Bar`, `fmt`. Состояние: `data`, `loading`, `error`, `tab`. Хук `useClinicScope` для выбора клиники. Lazy-секции: `LtvAnalyticsSection`, `CallLogSection`, `DoctorRetentionSection`, `RetentionMisSection`, `AttributionSection`, `ProgramsSection`, `NoShowSection`.
- **Эндпоинты:** на вкладке overview — `getAnalytics(scope.selectedId || undefined)` из `../api`. Возвращает `{conversion_rate, this_month, last_month, daily[], top_services[], admin_conversion[], clinic_comparison[]}`. Остальные вкладки грузят данные внутри своих секций (получают `clinicId={scope.selectedId}`).
- **Зависимости:** `../api` (`getAnalytics`), `../design` (`Card, Chip, KpiCard, KpiRow, EmptyState, Tabs, ClinicScopeSelector, Skeleton, TableSkeleton`), `../lib/useClinicScope`, `./_ManagerShell`, 7 lazy-секций из `../sections/...`.
- **Где менять для типовых задач:** новая аналитическая вкладка → добавь в массив `items` `Tabs` + lazy-импорт + блок `{tab === '...' && <Suspense>...}`; вид графика динамики → `DailyChart`; набор KPI → `KpiRow`; таблицы (топ услуг / конверсия сотрудников / сравнение клиник) — отдельные `Card` в ветке overview.
- **Подводные камни:** загрузка данных только при `tab === 'overview'` (см. ранний `return` в useEffect); прочие вкладки сами решают, что грузить. Scope: `selectedId === ''` означает «все клиники» — передача пустой строки в секцию включает её `externallyControlled` (скрывает внутренний селектор). `DailyChart` строит `areaPath` вручную (хрупкая reduce-логика по строке точек) — при правках лучше переписать на нормальный path-генератор. Числа складываются на клиенте (`daily.reduce`).
- **Строк:** 493

---

## `frontend/src/pages/ManagerAppointments.jsx`
- **Назначение:** Страница «Записи к врачам» с переключателем видов Слоты / Календарь / Статистика поверх существующих секций. Кнопка «Выгрузить отчёт» открывает модалку отчёта по приёмам.
- **Ключевые элементы:** дефолт-экспорт `ManagerAppointments()`. Состояние: `view` (`slots|calendar|stats`), `reportOpen`. `token` вычисляется динамически (Authorization-заголовок axios → `clinika_token_<SLUG>` → fallback `arc`/без slug). Lazy `SlotBoardSection`; статичные `AppointmentsCalendarSection`, `AppointmentsStatsSection`. Константа `TABS`.
- **Эндпоинты:** нет прямых вызовов — данные грузят дочерние секции (получают `token`).
- **Зависимости:** `../api`, `../config` (`SLUG`), `../sections/AppointmentsCalendarSection`, `../sections/AppointmentsStatsSection`, lazy `../sections/scheduling/SlotBoardSection`, `../design` (`Tabs, Button`), `./_ManagerShell`, `../components/reports/AppointmentsReportModal`.
- **Где менять для типовых задач:** новый вид → добавь в `TABS` + ветку `{view === '...' && ...}`; вычисление токена → блок `const token = ...` (комментарий #23 — раньше был хардкод `arc`); кнопка/модалка отчёта → `AppointmentsReportModal`.
- **Подводные камни:** **извлечение токена вручную** из заголовка axios + localStorage с несколькими fallback-ключами — если изменится схема хранения токенов в `../api`, тут сломается; передача `token` в секции — легаси-паттерн (новые секции часто берут токен сами). Tabs дублируются: в `topbarRight` (десктоп) и в контенте (`sm:hidden`, мобайл).
- **Строк:** 96

---

## `frontend/src/pages/ManagerBillingLedger.jsx`
- **Назначение:** Журнал биллинг-операций франшизы (append-only ledger). KPI (Поступления / Возвраты и списания / Чистая выручка), фильтры (пресет дат, тип операции, клиника), таблица с подсветкой по типу и ссылкой на чек PDF, пагинация и экспорт CSV (BOM для Excel).
- **Ключевые элементы:** дефолт-экспорт `ManagerBillingLedger()`. Константы: `ENTRY_TYPES` (15+ типов), `TYPE_LABEL`, `TYPE_BG`, `DATE_PRESETS`. Хелперы: `presetToRange`, `formatRub` (со знаком), `formatRubPlain`, `formatDate`, `csvCell`. Состояние фильтров (`datePreset`, `dateFrom/To`, `typeFilter`, `clinicFilter`) и данных (`items`, `total`, `totals`, `page`). `load` (useCallback), `applyPreset`, `exportCsv` (тянет до 5000 строк, формирует Blob).
- **Эндпоинты:** через `../api`:

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/manager/clinics-accessible` | — | `[{id,name}]` | Дропдаун клиник |
| GET | `/manager/billing/ledger` | `?from&to&type&clinic_id&page&limit` | `{items[],total,totals:{gross,debit,net,by_type}}` | Журнал операций |

- **Зависимости:** `../api`, `../design` (`Card, Button, EmptyState, useToast`), `./_ManagerShell`. Доступ: manager / franchise_owner / super_admin (режется на бэке).
- **Где менять для типовых задач:** новый тип операции → добавь в `ENTRY_TYPES` (метка) и опц. `TYPE_BG` (цвет фона строки); колонки таблицы и CSV → `<thead>`/`<tbody>` + массив `headers`/строки в `exportCsv` (синхронно!); пресеты дат → `DATE_PRESETS` + `presetToRange`; лимит экспорта → `limit:5000` в `exportCsv`.
- **Подводные камни:** `useToast()` оборачивается в `|| { show: () => {} }` — защита от отсутствия провайдера; вызов `toast({type,message})` (объектная форма). Суммы приходят с бэка как `signed_amount`/`totals.*` — клиент не считает, только форматирует; знак рисует `formatRub` (использует U+2212 «−», не дефис). Колонки таблицы и CSV должны меняться синхронно (заголовки расходятся: в таблице 7 колонок, в CSV — 8, включая «Направление»). `EmptyState` тут передаётся `description` (в других файлах — `message`; проверь сигнатуру компонента).
- **Строк:** 481

---

### Сквозные наблюдения по группе
- **Два визуальных поколения:** legacy-экраны с inline-`<style>` и oklch-хардкодом (`FranchiseModules`, `FranchiseRevenue`, частично `History`/инвайты с hex-цветами) vs премиум-дизайн-система `../design` + токены (`FranchiseOwnerCabinet`, все `Manager*`, `Landing`).
- **Два разных инвайт-флоу** (`InviteAccept` recruiter→врач vs `InviteRegister` invite-код→партнёр) — частый источник путаницы; разные минимальные длины пароля (6 vs 4).
- **Прямой `axios` vs `../api`-инстанс:** публичные страницы (`Landing`, `InviteAccept`) ходят сырым `axios` + `API_BASE` (без авто-refresh), кабинетные — через общий инстанс с токеном.
- **Финансы:** все суммы рублёвые, форматируются на клиенте; реальные расчёты — на бэке (особенно в ledger). Следи за знаком и `Number()`-приведением в редактируемых полях (`FranchiseModules`, `FranchiseRevenue`).
