# pages [01] — Admin/Platform-страницы super_admin + точки входа кабинетов

Это первый алфавитный срез каталога `frontend/src/pages/` (React, Vite, без TypeScript). Группа объединяет **точки входа и платформенные дашборды панели управления** мульти-тенантной МИС «КлиникСеть».

Ядро среза — две вещи:

1. **`AdminRoot.jsx`** — корневой роутер ролей: читает токен, дёргает `/admins/me` и по `user.role` решает, какой кабинет монтировать (врач / регистратор / партнёр / пациент / рекрутёр / владелец франшизы / руководитель / **super_admin → `AdminLayout`**).
2. **`AdminLayout.jsx`** (9004 строки, монолит) — оболочка платформенной панели super_admin: сайдбар + шапка + `renderSection()` switch на ~80 секций. Большинство секций вынесено в `../sections/*`, но **6 страниц этого среза подключаются прямо как route-секции внутри `AdminLayout`** через `activeSection`: `AdminApiQuotas`, `AdminArrLtv`, `AdminChurn`, `AdminCostAttribution`, `AdminFeatureFlags`, `AdminTenantHealth`. Седьмая, `AdminSupervisor`, висит отдельным маршрутом `/admin/supervisor` в `App.jsx` (НЕ в switch).

Остальное: `AdminLogin` (форма входа), `AccountantCabinet` (вложенный роутер кабинета бухгалтера на `react-router`), `Bonuses` (мобильный экран бонусов сотрудника — единственный «не-админский» файл среза).

Общие паттерны среза:
- HTTP через единый axios-инстанс `../api` (auto-Bearer + auto-refresh). Исключение: `AdminLogin` (чистый `axios`, токена ещё нет) и `AdminArrLtv` (нативный `fetch` + `API_BASE`).
- 5 из 6 «route-секций» админки используют дизайн-систему `../design` (Card/Button/Chip/Tabs/EmptyState/KpiCard…). `AdminSupervisor` и `Bonuses` — на голом inline-CSS/Tailwind (легаси-стиль).
- Все платформенные дашборды — **super_admin only** (защита на бэке + видимость в NAV).

| Файл | Назначение в 5-7 слов | Строк |
|---|---|---|
| `AccountantCabinet.jsx` | Роутер кабинета бухгалтера, ленивые под-страницы | 46 |
| `AdminApiQuotas.jsx` | Лимиты API/storage по тенантам | 323 |
| `AdminArrLtv.jsx` | ARR/LTV/кохорты/прогноз MRR дашборд | 452 |
| `AdminChurn.jsx` | Отток тенантов: rate + причины | 152 |
| `AdminCostAttribution.jsx` | Стоимость тенантов для платформы | 342 |
| `AdminFeatureFlags.jsx` | CRUD фич-флагов + tenant-overrides | 605 |
| `AdminLayout.jsx` | Оболочка панели super_admin (монолит) | 9004 |
| `AdminLogin.jsx` | Форма входа + раскладка токенов | 123 |
| `AdminRoot.jsx` | Корневой роутер ролей панели | 344 |
| `AdminSupervisor.jsx` | Мониторинг сервисов платформы | 375 |
| `AdminTenantHealth.jsx` | Health-score тенантов 0..100 | 367 |
| `Bonuses.jsx` | Мобильный экран бонусов сотрудника | 133 |

---

## `frontend/src/pages/AccountantCabinet.jsx`

- **Назначение:** Корневой роутер кабинета бухгалтера, монтируется под `/{slug}/accountant/*`. Лениво грузит под-страницы и редиректит индекс на `summary`.
- **Ключевые элементы:** `export default function AccountantCabinet()`; локальный `Stub()` («Страница в разработке»). Использует `Routes/Route/Navigate` из `react-router-dom` + `lazy/Suspense`.
- **Зависимости:** ленивые импорты `./accountant/AccSummary`, `AccCash`, `AccActs`, `AccIncomingInvoices` (реальные); `AccPayments`, `AccPayroll`, `AccSpending`, `AccReports` — Phase-2 заглушки через `.catch(() => ({ default: Stub }))`, чтобы ленивый чанк не падал `ChunkLoadError`, если файла ещё нет.
- **Где менять для типовых задач:**
  - Добавить страницу бухгалтера — создать `./accountant/AccX.jsx`, добавить `lazy(...)` и `<Route path="x" .../>`.
  - Превратить заглушку в реальную страницу — заменить `.catch(...)`-импорт на обычный `lazy(() => import('./accountant/AccPayments'))`.
- **Подводные камни:** маршрутизация здесь — `react-router` `<Routes>`, в отличие от `AdminLayout`, который сам ведёт URL через `history.pushState` (разные механизмы навигации в проекте). `Stub` определён ПОСЛЕ `lazy(...)`-вызовов, но используется только в колбэке `.catch` при загрузке чанка — TDZ не нарушается.
- **Строк:** 46

---

## `frontend/src/pages/AdminApiQuotas.jsx`

- **Назначение:** Управление лимитами API по тенантам (RPM / RPD / storage / users / минуты звонков) и просмотр текущего потребления. Рендерится как секция `api_quotas` внутри `AdminLayout`.
- **Ключевые элементы:** `export default function AdminApiQuotas()`. Локальные хелперы `pct(used, limit)` (0..999%), `chipVariant(p)` (good/accent/warn/bad), константа `FIELDS` (5 квот-полей с метками/единицами). Внутри: вкладки all/alerts, таблица квот, модалка редактирования (`editing`), drawer деталей с историей за 30 дней (`selected`).
- **Эндпоинты:** (axios-инстанс уже шлёт base-URL; реальные пути — без префикса роутера)

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/quotas/` | super_admin | — | массив/`{items}` тенантов с квотами+usage | список (вкладка «Все») |
| GET | `/admin/quotas/alerts` | super_admin | — | тенанты с usage ≥ 80% | вкладка «Близко к лимиту» |
| GET | `/admin/quotas/{tenant_id}` | super_admin | — | детали + `history[]` (30 дней) | drawer деталей |
| PUT | `/admin/quotas/{tenant_id}` | super_admin | `{requests_per_minute, requests_per_day, storage_mb_limit, users_limit, calls_minutes_per_month}` | — | изменить квоты |
| POST | `/admin/quotas/{tenant_id}/reset` | super_admin | — | — | обнулить usage |

- **Зависимости:** `../api` (axios), `../design` (Page, PageHeader, Card, Button, Chip, Tabs, EmptyState, Skeleton).
- **Где менять для типовых задач:**
  - Добавить новый вид квоты — дописать объект в `FIELDS` И добавить ключ usage в маппинг `usedKey` (строки ~187-193, по `f.key`), иначе колонка покажет used=0.
  - Изменить пороги цветов чипа — `chipVariant()`.
  - Поля сохранения формируются циклом по `FIELDS` в `saveQuotas()` — новые поля подхватятся автоматически.
- **Подводные камни:** маппинг `usedKey` — хрупкая ручная связка ключа лимита с ключом потребления (`requests_per_minute → requests_used_rpm` и т.д.); легко забыть при добавлении квоты. Используются нативные `confirm()`/`alert()` вместо тостов дизайн-системы (есть `useToast`/`useConfirm` в `../design`, но тут не задействованы). Бэкенд может вернуть и массив, и `{items}` — учтено в `load`.
- **Строк:** 323

---

## `frontend/src/pages/AdminArrLtv.jsx`

- **Назначение:** Финансовый дашборд super_admin: 4 KPI (MRR/ARR/активные тенанты/MoM-рост), прогноз MRR на 6 месяцев (sparkline + линейная регрессия), heatmap retention-кохорт, сводка LTV по планам. Секция `arr_ltv` в `AdminLayout`.
- **Ключевые элементы:** `export default function AdminArrLtv({ token: tokenProp })`. Хелперы `formatRub`, `formatPct`, `cellBg(pct)`/`cellFg(pct)` (цвет ячейки heatmap через `color-mix(in oklab, var(--accent) … var(--surface))`), `apiGet(url, token)` (нативный `fetch`). 4 параллельных запроса в `useEffect`. `useMemo`: `trendForKpi`, `maxCols` (ширина heatmap), `sparkData` (история+прогноз).
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/arr-ltv/summary` | super_admin | — | `{mrr_rub, arr_rub, total_active_tenants, mom_growth_pct}` | KPI-строка |
| GET | `/admin/arr-ltv/cohorts?months=12` | super_admin | query `months` | `{cohorts:[{cohort,tenants,retention[],avg_revenue}]}` | heatmap |
| GET | `/admin/arr-ltv/ltv` | super_admin | — | `{avg_ltv, median_ltv, p90_ltv, source, sample_size, by_plan[]}` | блок LTV |
| GET | `/admin/arr-ltv/forecast?months_ahead=6` | super_admin | query `months_ahead` | `{history[], forecast[], confidence, r2, slope}` | sparkline-прогноз |

- **Зависимости:** `../config` (`API_BASE`), `../design` (Page, PageHeader, Card, KpiCard, KpiRow, Sparkline, Chip). НЕ использует `../api`.
- **Где менять для типовых задач:**
  - Изменить горизонт прогноза/период кохорт — query-параметры в `Promise.all` (`months`, `months_ahead`).
  - Перекрасить heatmap — `cellBg`/`cellFg`.
  - Добавить KPI — `<KpiCard>` в `<KpiRow cols={4}>` (поправить `cols`).
- **Подводные камни:** **исключение из общего паттерна** — токен берёт из пропа ИЛИ `localStorage.getItem('admin_token')` (а реально панель хранит токен под ключом `clinika_admin_token_{SLUG}`, см. `AdminLogin`/`AdminRoot`). Внутри `AdminLayout` секция вызывается БЕЗ пропа `token` (`<AdminArrLtv />`), поэтому полагается на `credentials: 'include'` (cookie) — расхождение с остальными axios-секциями. При добавлении полей следить за `Number.isFinite` в форматтерах. `useMemo` импортирован и используется.
- **Строк:** 452

---

## `frontend/src/pages/AdminChurn.jsx`

- **Назначение:** Дашборд оттока тенантов: текущий/средний месячный churn-rate, всего ушло за 12 мес, помесячная таблица и распределение причин ухода. Секция `churn` в `AdminLayout`.
- **Ключевые элементы:** `export default function AdminChurn()`. Константа `REASON_LABELS` (перевод кодов причин: too_expensive/missing_features/…). Два независимых запроса в `useEffect`. Локальные вычисления `monthly`, `last`, `totalChurned`, `avgRate`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/analytics/churn-rate?months=12` | super_admin | query `months` | `{monthly:[{period,tenants_active,churned,churn_rate_pct}]}` | KPI + таблица |
| GET | `/admin/analytics/churn-reasons` | super_admin | — | `[{reason,count}]` | блок причин |

- **Зависимости:** `../api`, `../design` (Page, PageHeader, Card, KpiRow, KpiCard, EmptyState, Skeleton, Chip).
- **Где менять для типовых задач:**
  - Добавить причину оттока — ключ в `REASON_LABELS` (значение по умолчанию = сырой код).
  - Изменить пороги цвета rate — тернарник `m.churn_rate_pct > 5 ? 'bad' : … 'warn' : 'good'` в таблице.
- **Подводные камни:** **graceful-fallback** — оба эндпоинта могут быть не реализованы; `churn-rate` глотает 404 (не показывает ошибку), `churn-reasons` глотает любую ошибку. То есть пустой экран ≠ баг. `reasons` обрабатывается и как массив, и как объект (`Object.keys`).
- **Строк:** 152

---

## `frontend/src/pages/AdminCostAttribution.jsx`

- **Назначение:** Сколько каждый тенант стоит платформе (storage + API + минуты звонков → оценка ₽). Топ-20 тенантов, сводные KPI (total/avg/самый дорогой), селектор периода (текущий/прошлый/история 12 мес), кнопка «Снять snapshot», drawer с историей по тенанту. Секция `cost_attribution`.
- **Ключевые элементы:** `export default function AdminCostAttribution()`. Хелперы `monthIso(offset)`, `fmtMonth`, `fmtRub`, `fmtInt`. Под-компоненты: `MiniBars({values})` (inline-SVG спарклайн), `TenantDetailDrawer({tenantId,onClose})`, `KV({label,value,bold})`. Константа `PERIOD_TABS`. Локальные стили `th`/`td` в конце файла.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/cost-attribution/` | super_admin | query `?period=YYYY-MM-01` (опц.) | топ тенантов `[{id,tenant_id,tenant_name,tenant_slug,storage_mb,api_requests,calls_minutes,est_cost_rub}]` | таблица |
| GET | `/admin/cost-attribution/summary` | super_admin | query `?period` | `{total_cost_rub,avg_cost_rub,tenant_count,top_tenant,period}` | KPI-карточки |
| GET | `/admin/cost-attribution/{tenant_id}` | super_admin | — | `{tenant_name,tenant_slug,current,history[]}` | drawer деталей |
| POST | `/admin/cost-attribution/snapshot` | super_admin | — | — | пересчитать снимок за текущий месяц |

- **Зависимости:** `../api`, `../design` (Card, Button, Chip, Tabs, EmptyState). Связана с бэк-роутером `backend/app/routers/admin_cost_attribution.py`.
- **Где менять для типовых задач:**
  - Добавить колонку расхода — `<th>` в шапке + `<td>` в строке таблицы + поле в drawer (`TenantDetailDrawer` → блок «Текущий период»).
  - Добавить вкладку периода — `PERIOD_TABS` + ветка в `useMemo period` (`monthIso(offset)`).
- **Подводные камни:** `MiniBars` объявлен, но в JSX НЕ используется — **мёртвый под-компонент** (вероятно остаток рефакторинга). `Tabs` здесь принимает пропсы `tabs/value/onChange` (старый API дизайн-системы), тогда как в `AdminApiQuotas` тот же `Tabs` вызывается как `items/active/onChange` — **расхождение сигнатур Tabs в двух файлах среза, проверяй фактический API компонента**. Drawer цвета захардкожены (`#fff`, `#64748b`) — не токены.
- **Строк:** 342

---

## `frontend/src/pages/AdminFeatureFlags.jsx`

- **Назначение:** Управление feature-flags платформы: CRUD флагов, стратегии раскатки (all / tenants / percentage / ab_test), tenant-overrides через боковой drawer. Секция `feature_flags`.
- **Ключевые элементы:** `export default function AdminFeatureFlags()`. Константы `STRATEGY_LABELS`, `STRATEGY_TONES`, `EMPTY_FORM`. Хелперы `buildRolloutValue(form)` (собирает `{percentage}` или `{variants}`), `formFromFlag(flag)` (обратное разворачивание для редактирования). Под-компоненты: `FlagsTable`, `FlagFormModal` (создание/редактирование, вариативные поля под стратегию), `TenantOverridesDrawer` (список/добавление/переключение/снятие overrides), UI-примитивы `Overlay`, `Field`. Локальные стили `cellHeader/cell/cellMono/modalBox/drawerBox/inputStyle`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/feature-flags/` | super_admin | — | `[{id,key,name,description,default_enabled,rollout_strategy,rollout_value,overrides_count}]` | таблица флагов |
| POST | `/admin/feature-flags/` | super_admin | `{key,name,description,default_enabled,rollout_strategy,rollout_value}` | флаг | создать |
| PATCH | `/admin/feature-flags/{key}` | super_admin | тело без `key` | флаг | редактировать |
| DELETE | `/admin/feature-flags/{key}` | super_admin | — | — | удалить (+overrides) |
| GET | `/admin/feature-flags/{key}/tenants` | super_admin | — | `[{id,tenant_id,tenant_name,tenant_slug,enabled,variant}]` | overrides |
| PUT | `/admin/feature-flags/{key}/tenants/{tenant_id}` | super_admin | `{enabled,variant}` | — | задать/обновить override |
| DELETE | `/admin/feature-flags/{key}/tenants/{tenant_id}` | super_admin | — | — | снять override |

- **Зависимости:** `../api`, `../design` (Card, Button, Chip, Tabs[импорт. но не исп.], EmptyState). Связана с `backend/app/routers/admin_feature_flags.py`.
- **Где менять для типовых задач:**
  - Добавить стратегию раскатки — `STRATEGY_LABELS` + `STRATEGY_TONES` + ветка в `buildRolloutValue` + (если нужны поля) условный блок в `FlagFormModal` + разворот в `formFromFlag`.
  - Изменить форму флага — `FlagFormModal` (поля `Field`).
- **Подводные камни:** `key` редактируется только при создании (`disabled={!isCreate}`); все эндпоинты overrides идут через `encodeURIComponent(flag.key)` — не ломай при ручной правке URL. `Chip` тут вызывается с пропом `tone=...`, а в `AdminApiQuotas` — `variant=...` (**снова разнобой API Chip в одном срезе**). `Button` — то `variant="ghost"`, то в др. файлах `kind="ghost"` — фактическую сигнатуру смотри в `../design`. Цвета захардкожены (`#0f172a`, `#f8fafc`) — light-only, не токены/не dark.
- **Строк:** 605

---

## `frontend/src/pages/AdminLayout.jsx`

- **Назначение:** Главная оболочка платформенной панели **super_admin**: премиум-сайдбар (3 режима: expanded/collapsed/mobile-drawer), шапка (тема, профиль, уведомления, Cmd+K), баннер impersonation и `renderSection()` — switch на ~80 разделов. Это **монолит на 9004 строки** с ~28 inline-секциями/модалками и ~50 ленивыми импортами из `../sections/*`.
- **Ключевые элементы:**
  - `export default function AdminLayout({ adminToken, user, onLogout })`.
  - **Реестр секций:** `const NAV[]` (пункты меню: key/label/icon), `NAV_GROUP_TITLES`/`NAV_GROUP_OF`/`NAV_GROUP_ORDER` (группировка сайдбара), `PAGE_TITLES` (заголовок+подзаголовок на каждую секцию), `ADMIN_SECTIONS` (Set валидных ключей для URL).
  - **URL-навигация без react-router:** `sectionFromPath(pathname)` и `adminBasePath()` + `useEffect`-ы, которые пишут URL через `window.history.pushState` и слушают `popstate`. Состояние — `activeSection` (init из URL).
  - **Видимость:** `visibleNav` фильтрует NAV по `isSuperAdmin`/`isSupervisor`/`SLUG`/`activeModules` + наборы `PLATFORM_ONLY_KEYS` и `TENANT_OPERATIONAL_KEYS`.
  - **`renderSection()`** (≈стр. 8223) — `switch(activeSection)`, каждая ветка возвращает секцию (часто обёрнутую в `<Suspense fallback={<SectionLoader/>}>`).
  - **Inline-секции/модалки** (НЕ вынесены в `../sections`): `HomeDashboard`, `StaffSection`/`StaffModal`, `ClinicsSection`/`ClinicModal`/`CreateClinicManagerModal`/`ClinicCredentialsModal`, `ReportsSection`, `BonusesSection`, `ServicesSection`/`ServiceModal`, `CommissionSection`, `SettingsSection`, `MyPlanSection`, `MonitoringSection`, `PartnersSection`/`PartnerModal`, `DiscountsSection`/`DiscountModal`, `LedgerSection`, `AnalyticsDrillSection`, `AuditSection` (легаси-fallback), `BillingSection`, `SchedulingSection`, `SuperAdminSection`, `MisSyncSection`, `CallsConfigSection`, `PushSection`. Хелперы `apiFetch`, `formatPhone`, `Spinner`, `ErrorBox`, `SectionLoader`, `SupportAdminWrapper`.
- **Эндпоинты:** роутером в смысле бэка НЕ является, но дёргает множество API (axios `../api`), напр.: `GET /profile/me` (профиль в шапке), `GET /tenant/branding` (тема), `GET /contact/admin/unread-count` (бейдж «Обращения», polling 60с), `GET /modules/active-keys` (фильтр видимости платных модулей), плюс десятки запросов внутри inline-секций.
- **Зависимости (внутренние связи — важнейшее):**
  - **6 страниц этого среза монтируются здесь как секции:** `AdminChurn`(churn), `AdminArrLtv`(arr_ltv), `AdminTenantHealth`(tenant_health), `AdminCostAttribution`(cost_attribution), `AdminFeatureFlags`(feature_flags), `AdminApiQuotas`(api_quotas) — все `lazy()`.
  - `../sections/*` (~50 ленивых секций: Platform, Franchises, Webhooks, Ads, BillingLedger, Branding, CMS, Acts, ModulesCatalog, Reviews, Doctors, PatientChats, Loyalty, Telemedicine, SmsMarketing, Inventory, Security, Audit, PermissionsMatrix, CallLog, и т.д.).
  - Компоненты: `ImpersonationBanner`, `ImpersonateModal`, `BrandLogo`, `AdminSupportPanel`, `CommandPalette`, `NotificationsBell`, `ProfileModal`.
  - `../config` (API_BASE, BASE_PATH, SLUG), `../lib/useTheme`, `../utils/ThemeLoader`, `../design` (Page/PageHeader/Chip/Avatar/Card/Button/KpiCard/KpiRow/Breadcrumbs/useToast/useConfirm), `../api`.
- **Где менять для типовых задач:**
  - **Добавить раздел** в панель: (1) `lazy()`-импорт или inline-функция; (2) пункт в `NAV[]`; (3) запись в `NAV_GROUP_OF`; (4) `PAGE_TITLES[key]`; (5) ключ в `ADMIN_SECTIONS` (иначе deep-link сбросится на home); (6) `case 'key':` в `renderSection()`. Пропустишь любой шаг — секция «частично» появится/исчезнет.
  - Поменять, кому виден пункт — `visibleNav` + наборы `PLATFORM_ONLY_KEYS`/`TENANT_OPERATIONAL_KEYS`.
  - Привязать пункт к платному модулю — добавить ветку `m.has('module_key')` в `visibleNav`.
  - Поправить deep-link/URL — `sectionFromPath`/`adminBasePath`.
- **Подводные камни:**
  - **Источник истины по секциям РАЗМАЗАН по 6 структурам** (`NAV`, `NAV_GROUP_OF`, `PAGE_TITLES`, `ADMIN_SECTIONS`, `renderSection`, `visibleNav`) — добавление раздела требует синхронной правки всех. `ADMIN_SECTIONS` НЕ содержит `arr_ltv/tenant_health/cost_attribution/feature_flags/api_quotas/churn/franchise_*` → для этих секций deep-link `/admin/<key>` при перезагрузке откатится на `home` (известный риск, проверь при доработке URL).
  - **Своя навигация на `pushState`, а не react-router** — не смешивать с `<Routes>`-подходом из `AccountantCabinet`/`App`.
  - `AdminSupervisor` НЕ в этом switch — он отдельным `<Route path="/admin/supervisor">` в `App.jsx`.
  - Inline-секции тащат собственные fetch/состояния — правка одной не требует трогать монолит целиком, но файл тяжёлый: грузи через `Read` с `offset/limit`, не целиком.
  - Часть пунктов NAV помечены легаси-комментариями (`plugins` удалён; `AuditSection` — fallback, рендерится новый `AuditLogSection`).
- **Строк:** 9004

---

## `frontend/src/pages/AdminLogin.jsx`

- **Назначение:** Экран входа в панель управления. Логинит через `/auth/login`, по `redirect_url`/роли раскладывает access/refresh-токены по правильным ключам `localStorage` и редиректит.
- **Ключевые элементы:** `export default function AdminLogin()`. State `username/password/loading/error/forgotOpen`. `handleSubmit` — POST логина + логика выбора ключа хранения токена.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| POST | `/auth/login` | публичный | `{username, password}` | `{access_token, refresh_token, redirect_url, tenant_slug}` | вход |

- **Зависимости:** `axios` напрямую (НЕ `../api` — токена ещё нет, refresh не нужен), `../config` (API_BASE, BASE_PATH, SLUG), `../components/ForgotPasswordDialog`.
- **Где менять для типовых задач:**
  - Логика, КУДА класть токен — блок в `handleSubmit`: ключи `clinika_admin_token_{storageSlug}` / `clinika_admin_refresh_token_{storageSlug}` (admin-панель) против `clinika_token_{slug}` / `clinika_refresh_token_{slug}` (тенант-панель). `storageSlug` = `''` если редирект на глобальный `/admin`.
  - Сменить редирект — `finalRedirect`.
- **Подводные камни:** **критичная связка** ключей `localStorage` с `AdminRoot.jsx` (читает `clinika_admin_token_{SLUG}`) и `../api` (берёт токен оттуда же). Поменяешь схему ключей здесь — сломаешь чтение токена везде. `redirect === '/admin'` при заданном `SLUG` переписывается на `/{SLUG}/admin` (тенант-панель не должна улетать на глобальную). Ошибка логина показывается единым текстом «Неверный логин или пароль» (детали бэка не показываются).
- **Строк:** 123

---

## `frontend/src/pages/AdminRoot.jsx`

- **Назначение:** Корневой роутер ролей всей панели `/admin` (и `/{slug}/admin`). Проверяет приглашение `/invite/{token}`, валидирует сессию через `/admins/me`, по `user.role` монтирует нужный кабинет. Содержит `AdminErrorBoundary` (показывает stack вместо белого экрана).
- **Ключевые элементы:**
  - `class AdminErrorBoundary` (getDerivedStateFromError/componentDidCatch).
  - `getInviteToken()` (регэксп по `pathname`).
  - `export default function AdminRoot()` — главный диспетчер.
  - `FranchiseOwnerWithOnboarding` — обёртка для `franchise_owner`: по `/onboarding/status` показывает `OnboardingWizard` или `FranchiseOwnerCabinet` (`?skip_onboarding=1` пропускает мастер).
  - Presence-WebSocket (`/presence/ws/{user.id}` + heartbeat 30с), `ForcePasswordChangeModal` (pwdmust01) во всех ролевых ветках.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admins/me` | по токену | — | профиль `{role, tenant_slug, is_superadmin, password_must_change…}` | валидация сессии + выбор кабинета |
| PUT | `/presence/status` | по токену | `{status:'online'}` | — | присутствие онлайн |
| WS | `/presence/ws/{user.id}` | по токену | heartbeat | — | онлайн-статус |
| GET | `/onboarding/status` | franchise_owner | — | `{completed}` | показывать ли мастер онбординга |

- **Зависимости (важнейшие связи):** `../api`; кабинеты `AdminLogin`, `AdminLayout` (super_admin), `DoctorLayout`, `OperationalCabinet` (reg/nurse), `RecruiterCabinet`, `PartnerDoctorCabinet`, `VisitingDoctorCabinet`, `InviteAccept`, lazy `PatientCabinet`, lazy `FranchiseOwnerCabinet`, lazy `OnboardingWizard`; `../config` (SLUG), `CallWidget`, `../utils/ThemeLoader` (loadTheme), `../lib/useTheme`, `../store/auth` (zustand `useAuthStore`), `ForcePasswordChangeModal`.
- **Где менять для типовых задач:**
  - Добавить роль/кабинет — новая ветка `if (role === 'x') return <XCabinet … />` (порядок веток = приоритет).
  - Изменить редирект руководителя/тенанта — ветки `manager`/`franchise_owner`.
  - Логика принудительной смены пароля — `forceModal` + `password_must_change`.
- **Подводные камни:**
  - Читает токен `localStorage.getItem('clinika_admin_token_' + SLUG)` — должен совпадать со схемой ключей из `AdminLogin`. При 401 чистит этот ключ.
  - Синхронизирует zustand-стор `useAuthStore.setState({token,user})` + дублирует токен в `clinika_token_{SLUG}` — **нужно для CallWidget/SupportChat при impersonate** (иначе они видят `token=null`). Не убирай.
  - `manager` НЕ рендерится здесь — делает hard-redirect на `/{slug}/manager`; модалка смены пароля там в `App.jsx`/MiniApp.
  - `ForcePasswordChangeModal` без `onClose` — закрывается только успешным `PATCH /profile/me`.
- **Строк:** 344

---

## `frontend/src/pages/AdminSupervisor.jsx`

- **Назначение:** Мониторинг сервисов платформы (super_admin): карточки 6 сервисов (backend/db/redis/frontend/prometheus/grafana), sparkline CPU/RAM/Disk (10 точек in-memory), таблица последних ошибок (`audit_entries.level='error'`), кнопки «Перезапустить» для backend/frontend. Auto-refresh 10 секунд.
- **Ключевые элементы:** `export default function AdminSupervisor()`. Константы `STATUS_META`, `RESTARTABLE` (Set backend/frontend), `SERVICE_LABELS`. Хелперы `fmtUptime`, `fmtTime`. Под-компоненты `Sparkline` (inline-SVG), `ServiceCard`, `Metric`. State накапливает `history.{cpu,ram,disk}` (последние 10). `handleRestart` с `confirm()`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/supervisor/status` | super_admin | — | `{services[], system{cpu_pct,ram_pct,disk_pct}, recent_errors[], timestamp}` | снимок состояния |
| POST | `/admin/supervisor/restart` | super_admin | `{service, confirm:true}` | `{action, hint?}` | перезапуск сервиса |

- **Зависимости:** ТОЛЬКО `../api`. **Не использует дизайн-систему** — весь UI на inline-CSS со светлыми хардкод-цветами (`#fff`, `#0f172a`, `#16a34a` и т.д.). Локальный `Sparkline` ≠ `Sparkline` из `../design`.
- **Где менять для типовых задач:**
  - Добавить сервис — `SERVICE_LABELS` (+ при необходимости в `RESTARTABLE`); карточки рендерятся из `data.services`.
  - Изменить интервал refresh — `setInterval(load, 10_000)`.
  - Добавить системную метрику — компонент `Metric` + накопление в `history` (`load`).
- **Подводные камни:** **маршрут отдельный** — `<Route path="/admin/supervisor">` в `App.jsx` (lazy), НЕ часть `renderSection` в `AdminLayout`. История метрик живёт только в памяти (теряется при перезагрузке). Light-only стиль (нет dark-режима). Перезапуск frontend может вернуть `action='manual_required'` с `hint` — обрабатывается отдельной веткой alert.
- **Строк:** 375

---

## `frontend/src/pages/AdminTenantHealth.jsx`

- **Назначение:** Health-score тенантов 0..100 + `alert_level` (green/yellow/red). Фильтр по уровню (вкладки), сводные KPI, детали факторов в drawer, ручной пересчёт. Секция `tenant_health`.
- **Ключевые элементы:** `export default function AdminTenantHealth()`. Константы `LEVEL_LABELS`, `LEVEL_TONES`, `PAYMENT_LABELS`, `TABS`. Хелперы `scoreTone(score)`, `fmtPct`. Под-компоненты `MiniTrend` (inline-SVG polyline), `TenantDetailDrawer` (факторы + история + пересчёт). Локальные стили `tdLabel/tdVal/th/td`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/tenant-health/` | super_admin | — | `[{tenant_id,tenant_name,tenant_slug,score,alert_level,factors{}}]` | таблица |
| GET | `/admin/tenant-health/{tenant_id}` | super_admin | — | `{tenant_name,tenant_slug,current{score,alert_level,factors,captured_at},history[]}` | drawer |
| POST | `/admin/tenant-health/{tenant_id}/recompute` | super_admin | — | — | пересчитать score |

- **Зависимости:** `../api`, `../design` (Card, Button, Chip, Tabs, EmptyState). Связана с `backend/app/routers/admin_tenant_health.py`.
- **Где менять для типовых задач:**
  - Добавить фактор в детали — строка `<tr>` в `TenantDetailDrawer` (блок «Факторы», `data.current.factors.<key>`).
  - Изменить пороги цвета score — `scoreTone()` (≥70 success, ≥40 warning, иначе danger).
  - Колонка таблицы — `<th>`/`<td>`.
- **Подводные камни:** `MiniTrend` объявлен, но в JSX НЕ используется (как `MiniBars` в `AdminCostAttribution`) — **мёртвый под-компонент**. `Tabs` вызывается с `tabs/value/onChange`, `Chip` — с `tone=` и `size=` (то же расхождение API, что в `AdminCostAttribution`/`AdminFeatureFlags`). `activity_30d` приходит долей 0..1 — умножается на 100 для `fmtPct`. Цвета захардкожены (light-only).
- **Строк:** 367

---

## `frontend/src/pages/Bonuses.jsx`

- **Назначение:** Мобильный экран «Бонусы» личного кабинета сотрудника/партнёра: карточка сводки (всего/ожидают/выплачено), вкладки фильтра (все/ожидают/выплачено), список начислений. Единственный «не-админский» файл среза.
- **Ключевые элементы:** `export default function Bonuses()`. Хелпер `formatDate`. Локальный `TABS` (массив пар). State `summary/bonuses/loading/tab`, фильтрация `filtered`, `totalAmount`.
- **Эндпоинты:** не роутер. Дёргает через именованные хелперы из `../api`:

| Метод (хелпер) | Возвращает | Назначение |
|---|---|---|
| `getBonusSummary()` | `{total_pending, total_paid}` | карточка сводки |
| `getBonuses()` | `[{id, bonus_type, service_name, clinic_name, amount, status, created_at}]` | список начислений |

- **Зависимости:** `../api` (именованные функции `getBonusSummary`, `getBonuses` — НЕ дефолтный axios-инстанс). Tailwind-классы + inline-стили (тёплый светлый дизайн `#f7f9fb`, синие градиенты). Material Symbols иконки.
- **Где менять для типовых задач:**
  - Добавить вкладку фильтра — массив `TABS` + (если новый статус) проверка `b.status === val`.
  - Тип бонуса для подписи — тернарник `b.bonus_type === 'commission' ? 'Комиссия' : 'Направление'`.
- **Подводные камни:** сумма через `parseFloat(b.amount)` — backend отдаёт `amount` строкой (Decimal сериализован как string), float-арифметика в `totalAmount` приемлема только для отображения. Все ошибки запросов молча глотаются (`.catch(() => {})`) — пустой список ≠ ошибка. Чисто презентационный экран без записи.
- **Строк:** 133
