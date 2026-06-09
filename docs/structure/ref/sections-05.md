# sections [05] — административные секции платформы (super_admin / franchise_owner): RBAC, биллинг, регламенты, безопасность

Этот срез — 15 React-секций из `frontend/src/sections/`, образующих **«надтенантный» административный слой» КлиникСеть**. Почти все требуют роли `super_admin` (управление всеми тенантами, безопасность платформы, AI-аналитика, каталог тарифов, impersonation) или `franchise_owner` (свой биллинг от платформы, конструктор регламентов). Это самостоятельные экраны, которые подключаются лениво (`React.lazy`) из `AdminLayout`/`App.jsx` и рендерятся как «section» внутри кабинета.

Общие архитектурные соглашения для этой группы:
- **HTTP-слой неоднороден.** Большинство файлов используют единый axios-инстанс `import api from '../api'` (auto-Bearer + auto-refresh токена). Но 3 легаси-файла (`PlatformAISection`, `RequisitesSection`, частично) ходят голым `fetch(API_BASE + ...)` со своим `apiFetch` и ручным `Authorization`-заголовком — это технический долг (нет auto-refresh, ошибки не нормализованы).
- **Паттерн «token-проп для совместимости».** Многие компоненты принимают `token` в пропсах, но фактически уже не используют его (axios сам подставляет Bearer). В `PlatformAnalyticsSection`, `PlatformBillingSection`, `PlatformSection` это прямо помечено комментарием `_token` / «не используется».
- **Дизайн-система `../design`** даёт `useToast`, `useConfirm`, `Card`, `Button`, `Chip`, `Modal`, `EmptyState`, `Tabs`, `Page`. Это предпочтительный путь — он заменил старые `alert`/`window.confirm`. Часть старых секций (`ReviewsSection`, `PlatformSection`) ещё показывают сообщения через локальный `msg`-state.
- **Две визуальные темы.** Платформенные super_admin-экраны (`PlatformAISection`, `PlatformAnalyticsSection`, `SuperAdminSubscriptionPlansSection` hero) — тёмный фиолетовый градиент с inline-стилями. Тенантные экраны (`ReviewsSection`, `RequisitesSection`, `PlatformBillingSection`) — светлый Tailwind с teal-акцентом `#0097A7`.
- **API префиксы:** `/admin/...` = super_admin платформенный, `/franchise-owner/...` = владелец франшизы, остальные (`/reviews`, `/regulations`, `/permissions`) — тенантные с RBAC.

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `PermissionsMatrixSection.jsx` | RBAC-матрица прав ролей, overrides | 407 |
| `PlatformAISection.jsx` | AI-аналитика платформы для super_admin | 505 |
| `PlatformAnalyticsSection.jsx` | KPI/метрики платформы, рост и отток | 352 |
| `PlatformBillingSection.jsx` | Биллинг всех тенантов: MRR/счета/платежи | 511 |
| `PlatformInvoicesSection.jsx` | Счета от платформы владельцу франшизы | 149 |
| `PlatformModulesSection.jsx` | Heatmap здоровья модулей по тенантам | 245 |
| `PlatformSection.jsx` | Главная панель управления тенантами | 756 |
| `RegulationBuilderSection.jsx` | Конструктор SOP/регламентов с версиями | 667 |
| `RegulationsAdminSection.jsx` | Список регламентов, CRUD, фильтры | 372 |
| `RegulationsReaderSection.jsx` | «Мои регламенты» — сторона читателя | 425 |
| `RequisitesSection.jsx` | Юр. реквизиты и печать тенанта | 176 |
| `ReviewsSection.jsx` | Модерация отзывов пациентов | 195 |
| `SecuritySection.jsx` | Журнал безопасности платформы | 834 |
| `SuperAdminSubscriptionPlansSection.jsx` | Каталог тарифов «Здоровье+» CRUD | 345 |
| `SuperAdminUsersSection.jsx` | Список юзеров платформы + impersonation | 251 |

---

## `frontend/src/sections/PermissionsMatrixSection.jsx`
- **Назначение:** UI-матрица RBAC «Роли и права»: таблица «роль × action» с чекбоксами effective-прав. Работает в двух режимах — для `franchise_owner` (свой тенант) и для `super_admin` (`mode="admin"`, с селектором тенанта).
- **Ключевые элементы:** дефолтный экспорт `PermissionsMatrixSection({ token, mode })`; константы `ROLE_LABELS`, `RESOURCE_LABELS`; утилита `groupActions(actions)` (группирует по ресурсу до `:`); внутренние функции `load`, `toggle`, `buildOverridePayload`, `saveRole`, `resetRole`; inline-стили `thSticky/thRole/tdAction/tdCheck/tdGroup`.
- **Эндпоинты:** (потребляемые)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/permissions/matrix?tenant_id=…` | owner / super_admin | tenant_id (admin) | `{actions, roles[{role, default, overrides, effective}]}` | Получить матрицу |
  | GET | `/admin/tenants` | super_admin | — | `[{id,name,slug}]` | Список тенантов для селектора |
  | PUT | `/permissions/override` | owner / super_admin | `{role, permissions{}, target_tenant_id?}` | ok | Сохранить overrides роли |
  | DELETE | `/permissions/override/{role}?tenant_id=…` | owner / super_admin | role в пути, tenant_id | ok | Сбросить роль к дефолту |
- **Зависимости:** `../api`; из `../design` — `Card`, `Button`, `useToast`. Связан с бэкенд-константой `ROLE_PERMISSIONS` (захардкоженные дефолты) — фронт зеркалит ответ `/permissions/matrix`.
- **Где менять для типовых задач:**
  - Новая роль в UI → добавить в `ROLE_LABELS` (стр. 34). Сам список ролей приходит с бэка в `data.roles`.
  - Новый ресурс/категория action'ов → подпись в `RESOURCE_LABELS` (стр. 56). Если ресурса нет в словаре — выводится raw-ключ.
  - Логика, какие изменения шлются на бэк → `buildOverridePayload` (стр. 153): шлётся только diff между draft и default.
- **Подводные камни:** в admin-режиме при невыбранном `tenantId` запрос НЕ делается (иначе вернётся «дефолт», стр. 108). `super_admin` редактирует overrides выбранного тенанта через `target_tenant_id` в body PUT. Подсветка ячейки (`var(--accent-soft)`) завязана на `r.overrides`, а чекбокс — на локальный `drafts` (effective): после toggle до сохранения подсветка и чекбокс могут рассинхрониться (это ожидаемо). React-предупреждение: фрагмент рендерится без `key` у внешнего `<>` в `Object.entries(grouped).map` (стр. 297) — потенциальный warning.
- **Строк:** 407

---

## `frontend/src/sections/PlatformAISection.jsx`
- **Назначение:** AI-аналитика всей платформы для super_admin: статистика по тенантам/пользователям/направлениям, 5 типов готового AI-анализа и свободный вопрос к LLM. Тёмная фиолетовая тема.
- **Ключевые элементы:** дефолтный экспорт `PlatformAISection({ token })`; вспомогательный `StatCard`; `apiFetch(method, path, token, body)` на голом `fetch`; `escapeHtml`, `renderMarkdown(text)` + `SANITIZE_CONFIG` (DOMPurify); константа `ANALYSIS_TYPES`; объект стилей `S`. Хендлеры `handleAnalyze`, `handleAsk`.
- **Эндпоинты:** (потребляемые)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/ai/platform/stats?days=30` | super_admin | days | `{tenants, users, referrals, leads, modules, activity}` | Сводная статистика |
  | GET | `/ai/platform/analyze?type=&days=` | super_admin | type∈ANALYSIS_TYPES, days | `{type,title,result(markdown),model,generated_at}` | AI-анализ по типу |
  | POST | `/ai/platform/ask` | super_admin | `{question, days}` | `{answer(markdown),model,generated_at}` | Свободный вопрос |
- **Зависимости:** `dompurify` (XSS-санитизация LLM-вывода); `API_BASE` из `../config`. НЕ использует `../api` и `../design` (легаси-стиль).
- **Где менять для типовых задач:**
  - Новый тип анализа → добавить в `ANALYSIS_TYPES` (стр. 50), бэк должен поддержать `type`.
  - Разрешённые HTML-теги в ответе LLM → `SANITIZE_CONFIG.ALLOWED_TAGS` (стр. 19). Markdown-преобразования — в `renderMarkdown` (стр. 38).
- **Подводные камни:** **XSS-критично** — вывод LLM идёт в `dangerouslySetInnerHTML`, безопасность держится на `escapeHtml` + DOMPurify (`ALLOWED_ATTR: []` запрещает inline-style как вектор CSS-injection). Любое расширение `renderMarkdown` без прогона через DOMPurify откроет дыру. `apiFetch` не делает auto-refresh токена — при протухшем JWT экран молча покажет ошибку из тела ответа. Ошибки парсятся вручную через `data.detail || data.error`.
- **Строк:** 505

---

## `frontend/src/sections/PlatformAnalyticsSection.jsx`
- **Назначение:** Дашборд метрик франшизной сети для super_admin: фильтр периода (7/14/30/90 дн), 6 KPI (тенанты/новые/активные/отток/avg клиник/avg направлений), Top-10 по выручке, гео-распределение, динамика подписок (SVG-sparkline).
- **Ключевые элементы:** дефолтный экспорт `PlatformAnalyticsSection({ token })`; компоненты `Sparkline`, `KpiCard`; `apiFetch(method, url, _token, data)` (обёртка над `api`); `fmtRub`; объект стилей `S`.
- **Эндпоинты:** (потребляемые)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/admin/analytics/platform?days=` | super_admin | days | `{tenants_total, tenants_new, tenants_active, churned, avg_clinics_per_tenant, avg_directions_per_clinic, top_revenue[], geo_distribution[], subscription_dynamics[]}` | Все метрики платформы |
- **Зависимости:** `../api`. Самодостаточен (нет импортов из `../design`). Гео-данные тянутся бэком из `audit_log` (поля `geo_country`, `geo_city`).
- **Где менять для типовых задач:**
  - Новый KPI → добавить `<KpiCard>` в `statsGrid` (стр. 211) + поле в ответе бэка.
  - Период по умолчанию → `useState(30)` (стр. 159); набор кнопок — `[7,14,30,90]` (стр. 191).
  - Внешний вид графика → компонент `Sparkline` (стр. 111).
- **Подводные камни:** `_token` намеренно не используется (axios сам ставит Bearer). `fmtRub` приводит к `Number`, не Decimal — для отображения ок, но не для расчётов. Гео-блок показывает заглушку, пока в `audit_log` нет geo-IP записей.
- **Строк:** 352

---

## `frontend/src/sections/PlatformBillingSection.jsx`
- **Назначение:** Биллинг ПЛАТФОРМЫ для super_admin без slug (агрегат по всем тенантам): KPI (MRR/ARR/активные подписки/просроченные счета) + 3 таба (Подписки/Счета/Платежи). Адаптив: карточки на mobile, таблицы на desktop.
- **Ключевые элементы:** дефолтный экспорт `PlatformBillingSection({ token })`; вложенные компоненты `SubscriptionsTab`, `InvoicesTab`, `PaymentsTab`, `Kpi`, `Chip`; словари статусов `SUB_STATUS_COLORS`, `INV_STATUS_COLORS`, `PAY_STATUS_COLORS`, `PLAN_LABELS`, `GATEWAY_LABELS`; `fmtRub`, `fmtDate`; `apiFetch`.
- **Эндпоинты:** (потребляемые)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/admin/billing/overview` | super_admin | — | `{mrr,arr,arpu,churn_rate,active_subscriptions,paid_invoices,total_invoices,overdue_invoices,cancelled_30d}` | KPI-сводка |
  | GET | `/admin/billing/subscriptions?status=` | super_admin | status фильтр | `{items[]}` | Подписки всех тенантов |
  | POST | `/admin/subscriptions/{id}/cancel` | super_admin | id | ok | Отменить подписку |
  | GET | `/admin/billing/invoices?status=` | super_admin | status фильтр | `{items[]}` | Счета |
  | GET | `/admin/billing/payments` | super_admin | — | `{items[]}` | Платежи |
- **Зависимости:** `../api`; из `../design` — `useToast`, `useConfirm`. Стилевая совместимость с `BillingSection`/`BillingLedgerSection` (тенантные аналоги).
- **Где менять для типовых задач:**
  - Новый статус подписки/счёта/платежа → соответствующий словарь `*_STATUS_COLORS` (стр. 34–55).
  - Новый платёжный шлюз → `GATEWAY_LABELS` (стр. 58).
  - Новый таб → массив `TABS` (стр. 439) + рендер в конце (стр. 504) + новый `*Tab` компонент.
  - Ссылка на оплату счёта → `sendLink` в `InvoicesTab` (стр. 238): формат `origin + /{tenant_slug}/admin?invoice={id}`.
- **Подводные камни:** «Отмена подписки» — единственное мутирующее действие, через `useConfirm` (Modal, не window.confirm). `_token`-проп — легаси. Этот файл — платформенный агрегат; не путать с тенантным `BillingSection` (тот про подписку одного тенанта). Суммы через `fmtRub(Number(...))` — отображение, не расчёт.
- **Строк:** 511

---

## `frontend/src/sections/PlatformInvoicesSection.jsx`
- **Назначение:** Сторона ВЛАДЕЛЬЦА ФРАНШИЗЫ — счета, которые платформа выставляет ему за выплаченные бонусы. Read-only: тарифная политика (fee с бонуса, мин. бонус, период), сводка текущего периода, список счетов (pending/paid).
- **Ключевые элементы:** дефолтный экспорт `PlatformInvoicesSection({ adminToken })`; вспомогательный `Metric`; `STATUS_LABEL`; `fmt`, `fmtDate`; вычисление `next_invoice_in` (дни до выставления счёта по `period_start + billing_period_days`).
- **Эндпоинты:** (потребляемые)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/franchise-owner/billing/summary` | franchise_owner | — | `{franchise{platform_fee_per_bonus, min_bonus_amount, billing_period_days, refund_fee_on_cancel}, current_period_amount, current_period_count, period_start, pending_invoices_total}` | Тариф + текущий период |
  | GET | `/franchise-owner/billing/invoices` | franchise_owner | — | `[{id,number,status,total_amount,bonuses_count,period_start,period_end,due_date,paid_at}]` | Список счетов |
- **Зависимости:** `../api`. Никакого design-system. Принимает проп `adminToken` (отличается именем от остальных `token`!) — но фактически тоже не используется (запросы через `api`).
- **Где менять для типовых задач:**
  - Новое поле тарифа → добавить `<Metric>` в блок «Тариф» (стр. 67).
  - Новый статус счёта → `STATUS_LABEL` (стр. 11).
  - Логика расчёта «до выставления» → IIFE `next_invoice_in` (стр. 48).
- **Подводные камни:** при 403 на `/summary` ставится `error='Доступ только владельцу франшизы'` и второй запрос (invoices) безопасно падает в `[]`. Это **противоположная сторона** платформенного биллинга: тут владелец франшизы видит, сколько ДОЛЖЕН платформе (fee с бонусов), а не подписки тенантов. Тариф меняется только админом платформы (UI read-only).
- **Строк:** 149

---

## `frontend/src/sections/PlatformModulesSection.jsx`
- **Назначение:** Module Monitoring System для super_admin — heatmap-таблица «тенанты × модули» с цветными статус-точками (ok/degraded/error/idle/unknown), tooltip с last_error, Top-10 проблемных тенантов, фильтр по статусу, автообновление каждые 60 сек.
- **Ключевые элементы:** дефолтный экспорт `PlatformModulesSection({ token })`; словари `STATUS_COLORS`, `STATUS_EMOJI`, `STATUS_LABEL`; `fmtTime`; `useMemo` `moduleKeys` (колонки = уникальные `module_key`) и `totals` (счётчики по статусам); `load`, `checkNow`; `timerRef` для setInterval.
- **Эндпоинты:** (потребляемые)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/admin/modules/health/all?status_filter=` | super_admin | status_filter (опц., csv) | `{tenants[{tenant_id,tenant_name,tenant_slug,modules[{module_key,health{status,last_check_at,last_error_message}}]}], top_problematic[{tenant_id,tenant_name,score}]}` | Здоровье модулей |
  | POST | `/admin/modules/health/check-now` | super_admin | — (без tenant_id = все) | ok | Форсировать проверку |
- **Зависимости:** `../api`. Без design-system, чистый Tailwind.
- **Где менять для типовых задач:**
  - Новый статус модуля → добавить в три словаря `STATUS_*` (стр. 14–27) одновременно.
  - Опции фильтра → `<select>` (стр. 115). Поддерживается CSV (`error,degraded`).
  - Интервал автообновления → `setInterval(load, 60_000)` (стр. 77).
- **Подводные камни:** колонки таблицы динамические — пересобираются из всех `module_key` всех тенантов (`moduleKeys`). Если у тенанта модуль не подключён — рисуется `·`, не точка. `checkNow` без tenant_id запускает проверку ВСЕХ тенантов (может быть тяжело). Таймер чистится в cleanup эффекта — но `load` в зависимостях, значит при смене фильтра интервал пересоздаётся (ок).
- **Строк:** 245

---

## `frontend/src/sections/PlatformSection.jsx`
- **Назначение:** Главная панель управления платформой для super_admin — 4 таба: Обзор (метрики), Тенанты (список + тогглы/смена тарифа/сброс пароля/удаление/drawer), Биллинг (MRR/подписки), Доходы (BillingLedger v2). Плюс модал создания тенанта (provisioning).
- **Ключевые элементы:** дефолтный экспорт `PlatformSection({ token })`; lazy `TenantDrawer`; словари `SUB_STATUS`, `PLAN_COLOR`; `EMPTY_PROVISION`; вложенный `MetricCard`; загрузчики `loadMetrics/loadTenants/loadBilling/loadLedger`; действия `toggleTenant`, `changePlan`, `deleteTenant`, `resetPassword`, `copyCredentials`, `provision`; масса модалов (создание, новый пароль, смена тарифа, подтверждение удаления).
- **Эндпоинты:** (потребляемые)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/admin/metrics` | super_admin | — | `{tenants_total, tenants_active, users_total, clinics_total, referrals_total, subscriptions_by_status, tenants_by_plan}` | Обзорные метрики |
  | GET | `/admin/tenants` | super_admin | — | `[{id,name,slug,plan,subscription_status,is_active,clinics_count,users_count,created_at}]` | Список тенантов |
  | GET | `/admin/billing` | super_admin | — | `{mrr, subscriptions_count, subscriptions[]}` | Биллинг-сводка |
  | GET | `/admin/billing/ledger?days=` | super_admin | days | `{summary{total_credit,platform_income,total_debit,net,breakdown}, tenants[], period_days}` | Финжурнал v2 |
  | PATCH | `/admin/tenants/{id}/toggle` | super_admin | id | ok | Вкл/выкл тенант |
  | PATCH | `/admin/tenants/{id}/plan` | super_admin | `{plan,days}` | ok | Сменить тариф |
  | DELETE | `/admin/tenants/{id}` | super_admin | id | ok | Деактивировать тенант |
  | POST | `/admin/tenants/{id}/reset-password` | super_admin | id | `{username,new_password,admin_panel,...}` | Сброс пароля админа |
  | POST | `/tenant/create` | super_admin | `EMPTY_PROVISION`-форма | `{tenant_name,admin_username,admin_password,trial_until,url}` | Создать тенант |
- **Зависимости:** `../api`; из `../design` — `useConfirm`; lazy-импорт `./TenantDrawer` (детальное управление одним тенантом).
- **Где менять для типовых задач:**
  - Новый таб → массив `TABS` (стр. 172) + блок `{tab === '...' && ...}` + загрузчик в `useEffect` (стр. 100).
  - Новый KPI на обзоре → `<MetricCard>` (стр. 232).
  - Поля формы создания тенанта → массив в модале (стр. 553) + `EMPTY_PROVISION` (стр. 32).
  - Логика «защищённого» тенанта → `t.slug !== 'arc'` (стр. 336): тенант `arc` нельзя удалить.
- **Подводные камни:** удаление тенанта = деактивация (данные не стираются, стр. 724). Захардкожен slug `arc` как неудаляемый. Сообщения через локальный `msg`-state с таймаутом 5 сек (не toast). Пароли (provision/reset) показываются **один раз** — есть `copyCredentials`. Lazy `TenantDrawer` обновляет `tenants` через `onUpdate`. Самый большой файл группы (756 строк) — кандидат на декомпозицию модалов в отдельные компоненты.
- **Строк:** 756

---

## `frontend/src/sections/RegulationBuilderSection.jsx`
- **Назначение:** Конструктор регламентов/SOP (для franchise_owner и super_admin). 2 колонки: слева метаданные (название/описание/категория/роли) + таймлайн версий + действия; справа конструктор шагов (text/checkbox/action/file) с drag-and-drop и AI-генерацией. URL-контракт: `?reg=<id>` или `?reg=new`.
- **Ключевые элементы:** дефолтный экспорт `RegulationBuilderSection({ regulationId, onBack })`; lazy `AiGenerateModal`; константы `CATEGORIES`, `ROLES`; утилиты `newStep`, `reorder`, `getRegIdFromUrl`; операции шагов `addStep/updateStep/deleteStep/moveStep`; DnD `makeDragHandlers`; `serializeSteps`, `validate`; асинхронные `saveDraft`, `publishNew`, `publishVersion`, `rollbackVersion`, `previewVersion`, `refetchOne`; AI-вставка `applyAiSteps`, `applyAiMeta`.
- **Эндпоинты:** (потребляемые)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/admin/regulations/{id}` | owner / super_admin | id | `{title,description,category,assigned_roles,status,versions[],current_version_id,current_version_content[]}` | Загрузить регламент |
  | POST | `/admin/regulations` | owner / super_admin | `{title,description,category,assigned_roles,initial_steps[]}` | `{id}` | Создать новый |
  | PATCH | `/admin/regulations/{id}` | owner / super_admin | `{title,description,category,assigned_roles}` | ok | Обновить метаданные |
  | POST | `/admin/regulations/{id}/versions` | owner / super_admin | `{content[], changelog?}` | `{id}` | Новая draft-версия |
  | POST | `.../versions/{vid}/publish` | owner / super_admin | — | ok | Опубликовать версию |
  | GET | `.../versions/{vid}` | owner / super_admin | — | `{content[], version_number}` | Контент конкретной версии |
  | POST | `.../versions/{vid}/rollback` | owner / super_admin | — | ok | Серверный откат (fallback) |
- **Зависимости:** `../api`; из `../design` — `useToast`, `useConfirm`; компоненты `../components/regulations/StepEditor`, `VersionsTimeline`, lazy `AiGenerateModal`; стили `./regulations.css`.
- **Где менять для типовых задач:**
  - Новый тип шага → расширить `newStep` (стр. 50), добавить кнопку в toolbar (стр. 597), обработать в `StepEditor`.
  - Новая категория → `CATEGORIES` (стр. 26). Кастомная категория идёт через `__custom__` + `customCategory`.
  - Роли для назначения → `ROLES` (стр. 39) — должны быть синхронны с системными ролями и `AiGenerateModal`.
  - Формат отправки шагов на бэк → `serializeSteps` (стр. 219).
- **Подводные камни:** у шагов есть фронтовый `_tmpId` (Math.random) — бэк выдаёт реальные id при сохранении; для React-key используется `_tmpId`. `rollbackVersion` (стр. 358) хрупок: пытается GET версии, при неудаче — POST серверного rollback, оба пути могут молча `.catch(()=>{})`. `previewVersion` подменяет шаги без флага «только просмотр» — пользователь может случайно сохранить чужую версию как новый draft. `dirty`-флаг и URL-синхронизация (`history.replaceState`) — следить при добавлении полей.
- **Строк:** 667

---

## `frontend/src/sections/RegulationsAdminSection.jsx`
- **Назначение:** Список регламентов (CRUD-таблица) для franchise_owner/super_admin: поиск, фильтр по категории/статусу, пагинация, действия (редактировать/статистика/архивировать). Является «оболочкой» — при `?reg=<id>` рендерит вместо таблицы `RegulationBuilderSection`.
- **Ключевые элементы:** дефолтный экспорт `RegulationsAdminSection()`; lazy `CompletionsModal`, `RegulationBuilderSection`; константы `CATEGORIES`, `STATUSES`; компоненты `StatusChip`, `fmtDate`; утилита `readBuilderIdFromUrl`; стейт-машина `builderId` (null → таблица, 'new' → создание, uuid → редактирование); `load`, `openBuilder`, `closeBuilder`, `archive`, `openStats`.
- **Эндпоинты:** (потребляемые)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/admin/regulations?q=&category=&status=&limit=&offset=` | owner / super_admin | фильтры, пагинация | `{items[{id,title,category,status,current_version,assigned_roles_count,created_at,published_at}], total}` | Список регламентов |
  | DELETE | `/admin/regulations/{id}` | owner / super_admin | id | ok | Архивировать (мягкое удаление) |
- **Зависимости:** `../api`; из `../design` — `useToast`, `useConfirm`; lazy `../components/regulations/CompletionsModal` (статистика прочтения) и `./RegulationBuilderSection`; стили `./regulations.css`.
- **Где менять для типовых задач:**
  - Колонки таблицы → `<thead>` (стр. 281) + `<tbody>` рендер (стр. 293).
  - Фильтры → `CATEGORIES`/`STATUSES` (стр. 23/36). Должны быть синхронны с builder'ом.
  - Размер страницы → `limit = 20` (стр. 117).
  - Навигация в конструктор → `openBuilder(id)` (стр. 155): пишет `?reg=` в history.pushState.
- **Подводные камни:** `DELETE` = архивирование, не физическое удаление. Навигация целиком на query-параметре `?reg=` + popstate-слушатель + кастомное событие `regulations:open-builder` (стр. 89) — кабинеты не используют react-router. Поиск с debounce 300 мс (стр. 145). `CATEGORIES` дублируются между этим файлом и builder'ом (риск рассинхрона при правке).
- **Строк:** 372

---

## `frontend/src/sections/RegulationsReaderSection.jsx`
- **Назначение:** Сторона ЧИТАТЕЛЯ — «Мои регламенты» для рядового сотрудника. Список назначенных регламентов, сгруппированный по категориям (раскрывающиеся секции), с бейджами статуса (прочитано/изменено/не прочитано) и сводкой. Клик открывает `RegulationViewer`.
- **Ключевые элементы:** дефолтный экспорт `RegulationsReaderSection({ user, initialId, onChangeRoute })`; компонент `StatusBadge`; константы `CATEGORY_ORDER`, `CATEGORY_LABELS`, `CATEGORY_ICONS`; `fmtDate`; `useMemo` `groups` (группировка+сортировка) и `stats` (total/unread/changed); навигация через локальный `activeId`.
- **Эндпоинты:** (потребляемые)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/regulations/my-assigned` | любой авторизованный | — | `[{id,title,description,category,completed,current_version,completion_version?,required,published_at}]` | Назначенные сотруднику регламенты |
- **Зависимости:** `../api`; из `../design` — `Card`, `Chip`, `Button`, `EmptyState`, `Page`; компонент `../components/regulations/RegulationViewer` (сам помечает «прочитано»).
- **Где менять для типовых задач:**
  - Подписи/иконки/порядок категорий → `CATEGORY_LABELS`/`CATEGORY_ICONS`/`CATEGORY_ORDER` (стр. 34–66). **ВНИМАНИЕ:** здесь ключи английские (`general/hr/medical/...`), в админ-стороне (`RegulationsAdminSection`/`Builder`) — РУССКИЕ (`Регистратура/Врачи/...`). Это разные таксономии категорий!
  - Логика бейджа «изменено» → `StatusBadge` (стр. 77): completed && current_version > completion_version.
- **Подводные камни:** **рассинхрон таксономии категорий** между читателем (англ.) и админкой (рус.) — load-bearing факт, легко наступить. При возврате из viewer (`activeId → null`) список перезагружается, чтобы обновить статус «прочитано» (стр. 143). Бэк может отдавать массив или `{items}` — обработаны оба (стр. 128). 404 трактуется как пустой список, не ошибка.
- **Строк:** 425

---

## `frontend/src/sections/RequisitesSection.jsx`
- **Назначение:** Редактирование юридических реквизитов тенанта (наименование, ИНН/КПП/ОГРН, адрес, банк, подписант) и загрузка изображения печати. Используется в `ManagerDashboard`, доступ managers+.
- **Ключевые элементы:** дефолтный экспорт `RequisitesSection({ token })`; `apiFetch` на голом `fetch`; массив полей `FIELDS` (13 полей с label/hint/span); действия `save`, `uploadStamp`; `fileRef` для file-input.
- **Эндпоинты:** (потребляемые)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/admins/me` | managers+ | — | user | (preflight, результат игнорируется) |
  | GET | `/tenant/branding` | managers+ | — | branding | (preflight, результат игнорируется) |
  | GET | `/requisites` | managers+ | — | `{stamp_url, legal_*...}` | Текущие реквизиты |
  | PATCH | `/clinic-invoices/requisites` | managers+ | форма `legal_*` | `{ok}` | Сохранить реквизиты |
  | POST | `/clinic-invoices/stamp/upload` | managers+ | multipart `file` | `{stamp_url}` | Загрузить печать |
- **Зависимости:** только `API_BASE` из `../config`. Легаси-файл: голый `fetch`, без `../api` и `../design`.
- **Где менять для типовых задач:**
  - Новое поле реквизитов → добавить в `FIELDS` (стр. 15) с `key/label/hint/span`. Рендер автоматический.
  - Эндпоинт сохранения → `save` (стр. 66): сейчас PATCH `/clinic-invoices/requisites`.
- **Подводные камни:** **несимметричные эндпоинты** — чтение через GET `/requisites`, запись через PATCH `/clinic-invoices/requisites`, загрузка печати через `/clinic-invoices/stamp/upload`. Два preflight-GET (`/admins/me`, `/tenant/branding`) в цепочке `.then` бессмысленны — их результат не используется (мёртвый код, стр. 42–48). Превью печати использует cache-buster `?t=Date.now()`. Удаление печати (стр. 165) меняет только локальный state, **не шлёт запрос на сервер** — печать на бэке остаётся. Голый `fetch` без auto-refresh JWT.
- **Строк:** 176

---

## `frontend/src/sections/ReviewsSection.jsx`
- **Назначение:** Модерация отзывов пациентов: список с фильтрами (ожидают/одобренные/отклонённые/все), действия approve/reject, удаление, пагинация. Звёздный рейтинг, анонимные отзывы.
- **Ключевые элементы:** дефолтный экспорт `ReviewsSection({ token })`; компонент `Stars`; словарь `STATUS`; `load(status, off)`, `act(id, action)`, `del(id)`; константы `FILTERS`, `LIMIT=20`.
- **Эндпоинты:** (потребляемые)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/reviews/moderate?status=&limit=&offset=` | модератор тенанта | фильтры | `{items[{id,status,rating,comment,patient_name,patient_phone,is_anonymous,created_at}], total}` | Список на модерацию |
  | PATCH | `/reviews/{id}/{action}` | модератор | action∈approve/reject | ok | Сменить статус |
  | DELETE | `/reviews/{id}` | модератор | id | ok | Удалить отзыв |
- **Зависимости:** `../api`; из `../design` — `useConfirm`. Сообщения — локальный `msg`-state (не toast).
- **Где менять для типовых задач:**
  - Новый статус отзыва → словарь `STATUS` (стр. 5) + кнопки действий в карточке (стр. 137).
  - Фильтры → `FILTERS` (стр. 70). `'all'` означает «без параметра status».
  - Размер страницы → `LIMIT` (стр. 30).
- **Подводные камни:** `act` использует динамический путь `/reviews/{id}/{action}` — `action` подставляется прямо в URL (approve/reject). Удаление через `useConfirm` (Modal), а уведомления — старый `msg`-state с setTimeout 3 сек (не унифицировано с toast). `load` ловит ошибки пустым `catch {}` (стр. 43) — провал загрузки молчит.
- **Строк:** 195

---

## `frontend/src/sections/SecuritySection.jsx`
- **Назначение:** Единый журнал безопасности платформы для super_admin: 6 summary-карточек (failed logins / brute-force / permission denied / blocked IPs / webhook / region), heatmap активности 7×24, топ атакующих IP (с блокировкой), топ атакованных юзеров, активные impersonation-сессии, проблемные модули, лента событий с фильтрами и модалом деталей. Polling каждые 30 сек.
- **Ключевые элементы:** дефолтный экспорт `SecuritySection({ token })`; компоненты `SummaryCard`, `ActivityHeatmap`, `BlockIpModal`, `EventDetailsModal`, `Row`; утилиты `flagFromCountry`, `fmtDate`, `fmtRelative`, `getActionMeta`, `toneClass`; большой словарь `ACTION_META` (тип события → ru/tone/icon); загрузчики `fetchAll`, `fetchAudit`; действия `handleBlockIp`, `handleUnblockIp`; `useMemo` `cards`, `actionOptions`; `pollRef`.
- **Эндпоинты:** (потребляемые)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/admin/security/summary` | super_admin | — | `{counts_24h, blocked_ips_count, top_attacking_ips[], top_attacked_users[], active_impersonations[], bad_modules[]}` | Карточки + топы |
  | GET | `/admin/security/heatmap` | super_admin | — | `{grid[7][24], labels_days[], days}` | Activity grid |
  | GET | `/admin/security/blocked-ips` | super_admin | — | `{items[{id,ip,reason,blocked_by_name,blocked_at,blocked_until,is_active}]}` | Ручные блокировки |
  | GET | `/admin/security/audit` | super_admin | `page,page_size,action?,search?` | `{total, items[]}` | Лента событий |
  | POST | `/admin/security/block-ip` | super_admin | `{ip,reason,ttl_hours}` | ok | Заблокировать IP |
  | POST | `/admin/security/unblock-ip` | super_admin | `{ip}` | ok | Снять блокировку |
- **Зависимости:** `../api`; из `../design` — `Card`, `Chip`, `Button`, `EmptyState`, `Tabs`, `Modal`, `useToast`.
- **Где менять для типовых задач:**
  - Новый тип security-события → `ACTION_META` (стр. 61): добавить ru-подпись/tone/icon, иначе покажется raw-action через `getActionMeta` fallback.
  - Новая summary-карточка → массив `cards` в `useMemo` (стр. 438), берёт значения из `summary.counts_24h`.
  - Цветовая шкала heatmap → `cellColor` внутри `ActivityHeatmap` (стр. 131).
  - Интервал polling → `setInterval(..., 30000)` (стр. 406).
- **Подводные камни:** даты приходят без таймзоны — `fmtDate`/`fmtRelative` принудительно добавляют `Z` (трактуют как UTC, стр. 47/52). При polling ошибки НЕ показываются toast'ом, только `console.warn` (чтобы не спамить, стр. 378). `handleUnblockIp` использует нативный `confirm()` (стр. 426) — единственное место, не переведённое на `useConfirm`. `toast` вызывается объектом `{kind,text}` — отличается от сигнатуры в других файлах (`toast(text, type)`); следить за контрактом `useToast`. Самый большой по логике файл (834 строки).
- **Строк:** 834

---

## `frontend/src/sections/SuperAdminSubscriptionPlansSection.jsx`
- **Назначение:** CRUD-управление каталогом тарифов подписки «Здоровье+» для super_admin. Два таба: «Глобальные шаблоны» (видны всем тенантам по умолчанию) и «Override-ы по тенантам». Hero-баннер с градиентом, lazy-модал редактора плана.
- **Ключевые элементы:** дефолтный экспорт `SuperAdminSubscriptionPlansSection({ token })`; компоненты `GlobalPlansTable`, `OverridesTable`, `Skel`; lazy `PlanEditorModal`; `fmtPrice`; действия `onCreate/onEdit/onDelete/onDeleteOverride`; `tenantName(id)` (резолв имени тенанта).
- **Эндпоинты:** (потребляемые)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/admin/subscription-plans/global` | super_admin | — | `{plans[{id,plan_key,title,description,price_monthly,price_annual,trial_days,is_active,subscribers_count}]}` | Глобальные тарифы |
  | GET | `/admin/subscription-plans/overrides` | super_admin | — | `{overrides[{id,tenant_id,plan_key,title,price_monthly,trial_days,is_active}]}` | Все override-ы |
  | GET | `/admin/tenants` | super_admin | — | `[{id,name,slug}]` | Резолв имён в Override-табе |
  | DELETE | `/admin/subscription-plans/global/{id}` | super_admin | id | ok / 409 если есть подписчики | Удалить план |
  | DELETE | `/admin/subscription-plans/override/{id}` | super_admin | id | ok | Сбросить override |
- **Зависимости:** `../api`; из `../design` — `useToast`, `useConfirm`; lazy `../components/subscription/PlanEditorModal` (создание/редактирование, mode="global"). Создание/upsert делает сам модал (POST/PATCH).
- **Где менять для типовых задач:**
  - Колонки таблицы планов → `GlobalPlansTable` (заголовки стр. 222, строки стр. 230).
  - Поля плана при создании → внутри `PlanEditorModal` (отдельный компонент).
  - Защита от удаления → DELETE возвращает 409 если есть подписчики; ошибка показывается из `detail`.
- **Подводные камни:** `lockPlanKey={!editing.isNew}` (стр. 186) — при редактировании ключ плана нельзя менять. Override-ы создаются НЕ здесь, а в кабинете владельца франшизы; тут super_admin может только их просматривать и сбрасывать. `tenantName` падает на `id.slice(0,8)` если тенант не найден в загруженном списке. `useConfirm` здесь вызывается объектом `{title,message,confirmText,danger}` — иной контракт, чем в `PlatformSection`.
- **Строк:** 345

---

## `frontend/src/sections/SuperAdminUsersSection.jsx`
- **Назначение:** Список всех пользователей платформы для super_admin с фильтром по роли и поиском. Главное действие — кнопка «Войти как» (impersonation) рядом с допустимыми ролями; открывает `ImpersonateModal`, после подтверждения — hard-redirect в кабинет с новым JWT.
- **Ключевые элементы:** дефолтный экспорт `SuperAdminUsersSection()`; константы `ROLE_FILTERS`, `ROLE_LABELS`, `ROLE_BADGE`, `ALLOWED_ROLES_TO_IMPERSONATE` (Set); `useMemo` `filtered` (клиентский поиск); стейт `target` (выбранный юзер для модалки).
- **Эндпоинты:** (потребляемые)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/admin/users?role=` | super_admin | role фильтр | `[{id,full_name,username,email,phone_number,role,tenant_id}]` | Список юзеров платформы |
- **Зависимости:** `../api`; компонент `../components/ImpersonateModal` (сама impersonation-логика и redirect внутри него). Без design-system, inline-стили.
- **Где менять для типовых задач:**
  - Новая роль в фильтрах → `ROLE_FILTERS` (стр. 16); подпись → `ROLE_LABELS` (стр. 28); цвет бейджа → `ROLE_BADGE` (стр. 43).
  - Разрешить/запретить impersonation роли → `ALLOWED_ROLES_TO_IMPERSONATE` (стр. 56). **super_admin исключён намеренно** (бэк вернёт 403).
  - Поля поиска → `filtered` useMemo (стр. 81): сейчас имя/логин/email/телефон.
- **Подводные камни:** **impersonation** — security-чувствительно: 30-минутная сессия, все действия пишутся в audit-журнал с claim `act` (RFC 8693). Фронтовый `ALLOWED_ROLES_TO_IMPERSONATE` — лишь UX-гейт; реальная защита на бэке (нельзя войти как super_admin = 403). Поиск чисто клиентский (`filtered`) по уже загруженной выборке — при большом числе юзеров одной роли может тормозить. Дефолтный фильтр — `franchise_owner` (стр. 65). `tenant_id` обрезается до 8 символов для отображения.
- **Строк:** 251
