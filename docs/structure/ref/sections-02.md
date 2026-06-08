# sections [02] — секции кабинетов: аналитика, биллинг, брендинг, CMS, телефония и чаты

Это срез из 15 React-секций (`frontend/src/sections/*.jsx`), каждая из которых — самодостаточный «экран» (раздел кабинета). Секции монтируются разными layout-обёртками (`AdminLayout`, `DoctorLayout`, `_ManagerShell`, `OperationalCabinet`, `AdminRoot`) как контент активного пункта меню. Общие черты группы:

- Все секции — **дефолтные экспорты** React-функциональных компонентов; данные тянут через единый axios-инстанс `../api` (Bearer-токен подставляется интерсептором автоматически, поэтому проп `token`/`adminToken` чаще декоративный и не используется внутри).
- Мультитенантность обеспечивается **на бэкенде** — фронт почти нигде явно не передаёт `tenant_id` (исключения: явный выбор тенанта в `CallRulesSection`, `clinic_id`-фильтры). Гейтинг платных модулей виден по обработке **HTTP 402** (`CallRecordingsSection`, `DoctorLabOrdersSection`, `DoctorPatientDocumentsSection`).
- Два визуальных «диалекта» сосуществуют: **новая дизайн-система** `../design` (`Card`, `Tabs`, `Chip`, `KpiCard`, `Button`, `EmptyState`, `useToast`, `useConfirm`) с CSS-токенами `var(--fg)/--accent/...`, и **легаси inline-стили** с захардкоженными hex-цветами (`#0097A7`, `#0A2342`). Часть файлов смешивает оба подхода.
- Денежные суммы форматируются на клиенте (`toLocaleString('ru-RU')`, `Intl.NumberFormat`) — числовая арифметика идёт по значениям, пришедшим от API; своей денежной логики (Decimal) фронт не делает.

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|---|---|---|
| `AppointmentsStatsSection.jsx` | Дашборд статистики онлайн-записей по врачам | 161 |
| `AuditLogSection.jsx` | Журнал аудита: лента, гео, нарушения регионов | 1250 |
| `BillingLedgerSection.jsx` | Финансовый реестр платформы (super_admin) | 1031 |
| `BrandingSection.jsx` | White-label: цвета, лого, домен, меню тенанта | 221 |
| `CMSPagesSection.jsx` | CRUD страниц CMS тенанта (Markdown) | 164 |
| `CallRecordingsSection.jsx` | Записи звонков + транскрипты + поиск | 378 |
| `CallRulesSection.jsx` | Матрица прав звонков по ролям/клиникам | 488 |
| `ClinicChatSection.jsx` | Чат клиники с пациентами (омниканал) | 1322 |
| `ClinicsNetworkSection.jsx` | Карточки клиник сети владельца франшизы | 314 |
| `ContactsSection.jsx` | Обращения с сайта «Написать нам» | 204 |
| `CrossClinicDirectorySection.jsx` | Справочник сотрудников сети + звонок | 425 |
| `DoctorLabOrdersSection.jsx` | Лабораторные заявки врача + результаты | 390 |
| `DoctorPatientDocumentsSection.jsx` | Документы пациента глазами врача | 171 |
| `DoctorsSection.jsx` | CRUD врачей: профиль, фото, расписание | 633 |
| `FranchiseAnalyticsSection.jsx` | Премиум-аналитика франшизы (4 вкладки) | 918 |

---

## `frontend/src/sections/AppointmentsStatsSection.jsx`
- **Назначение:** Дашборд статистики онлайн-записей за период (7/30/90/365 дней): KPI total/today/by_status, стек-бар распределения статусов и таблица разбивки по врачам. Для франшизы/супервизора.
- **Ключевые элементы:** `AppointmentsStatsSection({ token })` — главный компонент; `chipVariant(status)` — маппинг статуса записи на вариант `Chip`; константы `STATUS_LABEL`, `STATUS_COLOR`, `PERIOD_ITEMS`.
- **Эндпоинты:** не роутер (потребитель). Единственный запрос: `GET /appointments/stats?days=N`.
- **Зависимости:** `../api`; дизайн-система `../design` (`Card`, `KpiRow`, `KpiCard`, `Tabs`, `Chip`, `EmptyState`).
- **Где менять для типовых задач:** добавить период — правь `PERIOD_ITEMS`; новый статус записи — добавь в `STATUS_LABEL` + `STATUS_COLOR` + ветку `chipVariant`; новую KPI-плитку — внутри `<KpiRow>` (строки ~69-74); колонку в таблице врачей — в `<thead>`/`<tbody>` (~120-141), данные берутся из `d.by_status?.<status>`.
- **Подводные камни:** при ошибке загрузки молча подставляется пустой объект (`{ total:0, by_status:{}, doctors:[] }`) — UI не покажет ошибку, только пустоту. Цвета стек-бара — намеренно inline (визуальная диаграмма), не трогаются темой.
- **Строк:** 161

## `frontend/src/sections/AuditLogSection.jsx`
- **Назначение:** Журнал аудита платформы (фича W4). Пять вкладок: Лента (объединённый feed + KPI + диаграмма активности/топ-акторы/гео), По тенантам (гео-сводка с Region Lock), Нарушения регионов (с действиями whitelist/block/unblock франшизы), Impersonations (lazy-таб), Поиск (фильтры + экспорт CSV).
- **Ключевые элементы:** `AuditLogSection` (роутер вкладок); под-вкладки `FeedTab`, `TenantsGeoTab`, `RegionViolationsTab`, `SearchTab` + lazy `ImpersonationsTab`; общий `EventRow`; утилиты `flagFromCountry`, `formatGeoLocation`, `actionMeta`, `toneStyle`, `relativeTime`, `actorRoleChip`, `describeEvent`; словари `ACTION_RU`, `ENTITY_RU_DAT`, `ENTITY_RU_NOM`, `ENTITY_TYPES`.
- **Эндпоинты:** потребитель. Используемые пути:

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/audit/feed` | super_admin (предполож.) | `days`, `limit` | `{items[]}` | Объединённая лента audit_log+activity_log |
| GET | `/audit/log` | super_admin | `days`, `limit`, `action`, `entity_type` | `{items[]}` | Фильтрованный аудит (fallback для feed) |
| GET | `/audit/actions` | super_admin | — | список action-констант | Опции селекта в Поиске |
| GET | `/audit/log/export.csv` | super_admin | `days`, `action`, `entity_type` | blob CSV (UTF-8 BOM) | Выгрузка в Excel |
| GET | `/audit/by-tenant-geo` | super_admin | `days` | `{tenants[]}` | Гео-сводка по франшизам |
| GET | `/audit/region-violations` | super_admin | `days`, `limit` | `{items[]}` | Нарушения Region Lock |
| POST | `/admin/franchises/{id}/ip-allowlist` | super_admin | `{ip_cidr, comment, bypass_block}` | — | Добавить IP в whitelist франшизы |
| POST | `/admin/franchises/{id}/block` | super_admin | `{reason, blocked_until}` | — | Заблокировать франшизу |
| POST | `/admin/franchises/{id}/unblock` | super_admin | — | — | Снять блокировку |

- **Зависимости:** `../api`; `../design` (`Tabs`, `Chip`, `Card`, `Button`, `EmptyState`); lazy `./ImpersonationsTab`.
- **Где менять для типовых задач:** новый перевод действия — `ACTION_RU` + иконка/тон в `actionMeta`; новый тип сущности — `ENTITY_RU_DAT`/`ENTITY_RU_NOM` + `ENTITY_TYPES`; вид строки события — `EventRow`; KPI ленты — массив в `FeedTab` (~347-352); добавить вкладку — массив `items` в `Tabs` (~242-248) + условный рендер ниже.
- **Подводные камни:** **самый крупный файл группы (1250 строк)** — много инлайновой логики статистики в `useMemo` внутри `FeedTab`. Цвета — частью через `oklch(...)` инлайн, частью через токены. Поиск по имени актора — **клиентский** (`list.filter`), бэкенд не умеет search → при большом объёме фильтрует только загруженные ≤200 строк. CSV качается через axios `responseType: 'blob'` (а не прямой `<a href>` — токен в заголовке). `RegionViolationsTab` ведёт локальный `doneIds`/`_whitelisted` для inline-подтверждений, не перезагружая список.
- **Строк:** 1250

## `frontend/src/sections/BillingLedgerSection.jsx`
- **Назначение:** Финансовый журнал платформы (append-only ledger), только super_admin. Четыре вкладки: Сводка (метрики + SVG-тренд + breakdown по типам/модулям), Журнал (пагинированный список проводок), По тенантам (рейтинг с прогресс-барами), Revenue Split (donut-диаграмма распределения дохода + ценовые правила).
- **Ключевые элементы:** `BillingLedgerSection` (главный); вкладки `SummaryTab`, `JournalTab`, `TenantsTab`, `RevenueSplitTab`; UI-хелперы `Tabs`, `PeriodSelect`, `MetricCard`, `SkeletonCard`, `TrendChart` (SVG), donut в `RevenueSplitTab`; dark-mode контекст `DarkCtx`/`useD`/`useIsDark` (MutationObserver на `html.dark`); палитра `P(d)`; утилиты `rub()`, `apiFetch()`; словарь `ENTRY_LABELS`.
- **Эндпоинты:** потребитель:

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/billing/ledger` | super_admin | `days` | `{summary, tenants[], module_breakdown[], period_days}` | Сводка + разбивка по тенантам |
| GET | `/admin/billing/ledger/entries` | super_admin | `days`, `limit`, `offset`, `entry_type` | `{items[], total}` | Постраничный журнал проводок |
| GET | `/billing/ledger/plans` | super_admin | — | `{plugin_split_percent, ad_split_percent, franchise_fee_percent, subscription_discount_percent}` | Ценовые правила (split %) |

- **Зависимости:** **НЕ использует `../api`** — собственный `apiFetch(token, path)` поверх `fetch()` с ручным `Authorization`-заголовком и `API_BASE` из `../config`. Дизайн-систему `../design` НЕ использует — всё на собственной палитре `P()` и inline-стилях.
- **Где менять для типовых задач:** новый тип проводки — `ENTRY_LABELS` (отображается в Сводке/Журнале/тенантах); новая вкладка — массив `TABS` + ветка рендера в главном компоненте (~1000-1026); цвета/тема — функция `P(d)`; формат сумм — `rub()`.
- **Подводные камни:** дубль паттерна — это **второй» механизм запросов** в проекте (свой `apiFetch` вместо общего `../api`), при смене авторизации/базового URL правки нужны и здесь. Dark-mode определяется отдельно через MutationObserver, не через дизайн-систему. `TrendChart` строит «тренд» из breakdown-типов (не временной ряд — это имитация, см. комментарий в коде). Donut в `RevenueSplitTab` рисуется вручную через SVG-path/тригонометрию.
- **Строк:** 1031

## `frontend/src/sections/BrandingSection.jsx`
- **Назначение:** Редактор White-Label брендинга тенанта: цвета/шрифт, идентичность (название, лого, favicon, OG, контакты), SEO-мета, кастомный домен (CNAME на клиниксеть.рф) и навигация (скрытие/переименование пунктов меню). Пять вкладок.
- **Ключевые элементы:** `BrandingSection({ token })`; локальное состояние `form` (большой объект всех полей брендинга); `fetchBranding()`, `save()`, `set(k,v)`; массив `TABS`, `FONT_OPTIONS`; объект `styles` (inline).
- **Эндпоинты:** потребитель:

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/tenant/branding` | tenant-admin/manager | — | объект брендинга | Загрузка текущих настроек |
| PATCH | `/tenant/branding` | tenant-admin/manager | поля `form` | сохранённый объект (вкл. server-side поля) | Сохранение брендинга |

- **Зависимости:** `../api`; `applyTheme` из `../utils/ThemeLoader` (применяет CSS-переменные сразу без reload). Бросает глобальное событие `window` `'clinika-branding-updated'` — слушают `AdminLayout`/`App`, чтобы перечитать `/tenant/branding` и `/cms/theme`.
- **Где менять для типовых задач:** новое поле брендинга — добавь в дефолт `form` (~8-15) и в нужную вкладку (массивы пар `[key,label]` для colors/identity); новый шрифт — `FONT_OPTIONS`; новая вкладка — `TABS` + блок `activeTab === '...'`. После сохранения тема применяется через `applyTheme(saved)` — менять формат CSS-переменных нужно там.
- **Подводные камни:** Навигация (`hide_menu_items` — массив slug через запятую; `rename_menu_items` — JSON в textarea) парсится в onChange с `try/catch` — при невалидном JSON правка тихо игнорируется. Все стили inline (легаси-диалект, hex `#0097A7`), не дизайн-система. `domain_verified` приходит с сервера и только отображается (фронт не верифицирует).
- **Строк:** 221

## `frontend/src/sections/CMSPagesSection.jsx`
- **Назначение:** CRUD-раздел страниц CMS тенанта (info/landing/service/contact/faq) с Markdown-контентом, SEO-полями, флагами публикации и показа в меню. Один компонент с двумя режимами: список и редактор (state `editing`).
- **Ключевые элементы:** `CMSPagesSection({ token })`; функции `load()`, `openNew()`, `openEdit(p)`, `save()`, `deletePage(slug)`, `set(k,v)`; константы `PAGE_TYPES`, `TYPE_LABELS`; `styles` (inline).
- **Эндпоинты:** потребитель:

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/cms/pages?all=true` | tenant-admin | — | массив страниц | Список всех (вкл. черновики) |
| POST | `/cms/pages` | tenant-admin | объект страницы | — | Создать страницу |
| PUT | `/cms/pages/{slug}` | tenant-admin | объект страницы | — | Обновить (ключ — slug, не id) |
| DELETE | `/cms/pages/{slug}` | tenant-admin | — | — | Удалить страницу |

- **Зависимости:** `../api`; `useConfirm` из `../design` (заменяет `window.confirm` на Modal).
- **Где менять для типовых задач:** новый тип страницы — `PAGE_TYPES` + `TYPE_LABELS`; новое поле страницы — добавь в `openNew()` дефолт + поле в форме редактора (~72-116); правила публикации/меню — чекбоксы `is_published`/`show_in_menu`.
- **Подводные камни:** обновление идёт **по `slug`, а не по `id`** (`PUT /cms/pages/{form.slug}`) — смена slug в редакторе сломает апдейт (создаст рассинхрон). Стили inline (легаси). Markdown не рендерится в превью — только textarea.
- **Строк:** 164

## `frontend/src/sections/CallRecordingsSection.jsx`
- **Назначение:** Записи звонков (модуль `call_recording`, W5): таблица записей (дата/тип/участники/длительность/размер/статус), скачивание файла, модал с транскриптом (AI-резюме + сегменты по таймкодам), полнотекстовый поиск по транскриптам (ILIKE).
- **Ключевые элементы:** `CallRecordingsSection({ token })`; функции `load()`, `runSearch()`, `openModal(row)`, `downloadFile(id)`, `removeRow(id)`; форматтеры `fmtDate`, `fmtDuration`, `fmtParticipants`, `fmtBytes`; словари `SESSION_LABEL`, `STATUS_LABEL`; inline-стили `th/td/btnSm/modalOverlay/modalBox`.
- **Эндпоинты:** потребитель:

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/recordings` | гейт `call_recording` | `session_type`, `status` | массив записей | Список записей звонков |
| GET | `/recordings/search/transcripts` | гейт модуля | `q` (≥2 симв.) | массив hit | Поиск по тексту транскриптов |
| GET | `/recordings/{id}/transcript` | гейт модуля | — | `{full_text, summary, segments[], model, language, cost_usd}` | Транскрипт записи |
| GET | `/recordings/{id}/file` | гейт модуля | — | FileResponse | Скачивание аудио (через `window.open('/api/...')`) |
| DELETE | `/recordings/{id}` | гейт модуля | — | — | Удалить запись (транскрипт сохраняется) |

- **Зависимости:** `../api` (дизайн-систему не использует — всё inline).
- **Где менять для типовых задач:** новый статус записи — `STATUS_LABEL` (text+color) + опция в селекте фильтра; новый тип сессии — `SESSION_LABEL` + опция фильтра; вид модала транскрипта — блок `{open && ...}` (~286-359).
- **Подводные камни:** **HTTP 402** ловится в `load()` → показывает «модуль не подключён». Скачивание файла идёт через `window.open('/api/recordings/{id}/file')` — это **прямой URL без Bearer-заголовка** (полагается на cookie/прокси-авторизацию), в отличие от остальных blob-загрузок в группе. `cost_usd` форматируется `Number(...).toFixed(4)` — если поле отсутствует, будет `NaN`.
- **Строк:** 378

## `frontend/src/sections/CallRulesSection.jsx`
- **Назначение:** Настройка прав аудио-/видеозвонков (матрица «кто кому может звонить»). Два уровня: Глобально (по ролям, со scope any/same_clinic/cross_clinic) и По клиникам (точечная пара from→to). Per-clinic правила переопределяют глобальные. Гейт по модулям телефонии.
- **Ключевые элементы:** `CallRulesSection({ adminToken, tenantId })` (главный); под-компоненты `GlobalTab`, `PerClinicTab`, `Matrix`, `TabBtn`, `Legend`, `Pill`; ключевая логика `reload()`, `cellState(from,to)` (резолвит per-clinic→global→default), `toggleCell(from,to,field)`, `resetAll()`; мемо `ruleIndex`, `pairsCount`, `hasTelephonyModule`; утилита `ruleWordRu(n)` (плюрализация); константы `ROLE_INFO`, `TELEPHONY_MODULES`.
- **Эндпоинты:** потребитель:

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/franchise-owner/tenants` | franchise_owner | — | список тенантов | Селектор тенанта (если не фиксирован) |
| GET | `/franchise-owner/tenants/{id}` | franchise_owner | — | детали тенанта (modules) | Проверка телефонии (не fixed) |
| GET | `/tenant/modules-status` | manager | — | статус модулей | То же при `fixedTenantId` |
| GET | `/call-rules/{tenantId}` | manager/owner | — | `{rules[], active_roles[]}` | Текущие правила |
| PUT | `/call-rules/{tenantId}` | manager/owner | `{from_role, to_role, scope, allow_audio, allow_video, from_clinic_id?, to_clinic_id?}` | — | Upsert правила (одна ячейка) |
| DELETE | `/call-rules/{tenantId}` | manager/owner | — | — | Сбросить ВСЕ правила |
| GET | `/clinics` | — | — | массив/`{clinics[]}` | Список клиник для per-clinic |

- **Зависимости:** `../api`; `useConfirm` из `../design`.
- **Где менять для типовых задач:** новая роль в матрице — `ROLE_INFO` (но реальный набор приходит в `active_roles` от бэка); новый модуль телефонии — `TELEPHONY_MODULES`; логика наследования правил — `cellState()` (это ядро, правь осторожно — ключи индекса вида `${fc}|${tc}|${from}|${to}|${scope}`); per-clinic UI — `PerClinicTab`.
- **Подводные камни:** **дефолт = разрешено** (`{audio:true, video:true}`) когда правила нет — отсутствие записи означает «можно». Per-clinic PUT всегда шлёт `scope:'any'` (см. `toggleCell`). При `from===to` ячейка не рисуется. `cellState` строит fallback-цепочку per-clinic → global(scope) → global(any) → default — баги наследования ищи здесь. Принимает проп `tenantId` под именем `fixedTenantId` (встраивание в кабинет manager без селектора).
- **Строк:** 488

## `frontend/src/sections/ClinicChatSection.jsx`
- **Назначение:** Главный омниканальный чат клиники с пациентами. Используется в кабинетах врача/менеджера/регистратора/владельца (роль приходит пропом и определяет доступные действия). Трёхколоночный layout: список тредов / переписка / карточка пациента. Огромный набор фич: назначение/передача врача, шаблоны ответов с плейсхолдерами, слоты записи, направления, калькулятор цены, стикеры, промокоды, реакции, pin, цветные лейблы, drag&drop файлов, reply-to, typing-индикатор, звук, web-push, SLA-метки.
- **Ключевые элементы:** экспорт `ClinicChatSectionExported` (оборачивает в `ChatErrorBoundary`); ядро `ClinicChatSectionInner({ role, clinicId })`; класс `ChatErrorBoundary`; вложенный `AssignDoctorModal`; `EmptyChatIllustration`; утилиты `sameDay`, `dateSeparatorLabel`. Главная логика: `fetchThreads`, `fetchThread`, `send`, `doAssign`, `doClose`, `takeOver`, `doReact`, `doPin`, `doLabel`, `emitTyping`, `substituteTemplatePlaceholders`, `handleDrop`; мемо `renderedMessages` (вставка дат-сепараторов, группировка). Поллинг: тред 10с, список 30с.
- **Эндпоинты:** потребитель (множество):

| Метод | Путь | Принимает | Назначение |
|---|---|---|---|
| GET | `/clinic/chat/threads` | `status`, `clinic_id` | Список тредов |
| GET | `/clinic/chat/threads/{id}` | — | Тред + сообщения |
| POST | `/clinic/chat/threads/{id}/messages` | `{body, attachments?, reply_to_id?}` | Отправить сообщение |
| POST | `/clinic/chat/threads/{id}/read` | — | Отметить прочитанным |
| POST | `/clinic/chat/threads/{id}/files` | multipart | Загрузка вложения |
| POST | `/clinic/chat/threads/{id}/assign` | `{doctor_id}` | Назначить врача |
| POST | `/clinic/chat/threads/{id}/reassign` | `{to_user_id, note}` | Передать/перехватить тред |
| POST | `/clinic/chat/threads/{id}/close` | — | Закрыть тред |
| POST | `/clinic/chat/threads/{id}/pin` | — | Закрепить/открепить |
| PATCH | `/clinic/chat/threads/{id}/label` | `{color}` | Цветной лейбл |
| POST | `/clinic/chat/threads/{id}/typing` | — | Эмит «печатает» |
| POST | `/clinic/chat/messages/{id}/reactions` | `{emoji}` | Реакция на сообщение |
| POST | `/clinic/chat/patients/{id}/assign-counselor` | `{user_id}` | Личный регистратор (VIP) |
| POST | `/chat/templates/{id}/use` | — | Использовать шаблон (счётчик) |

- **Зависимости:** `../api`, `../config` (`SLUG`); `useToast` из `../design`; стор `../store/auth` (`useAuthStore`); хук `../hooks/useChatSoundNotification`; lib `../lib/webPush` (`enableWebPush`/`disableWebPush`/`getPushPermissionState`); компоненты `../components/chat/*` (`MessageBubble`, `ThreadListItem`, `PatientContextPanel`, `ReassignModal`, `TemplateAutocomplete`, `TemplateManagerModal`, `ClinicSlotPicker`, `CreateReferralDrawer`, `PriceCalculatorDrawer`, `StickerPicker`, `PromoCodeButton`).
- **Где менять для типовых задач:** новая кнопка в шапке треда — блок header (~730-1008); новое действие над тредом — добавь `doX` callback + кнопку; матрица прав действий — флаги `canAssign/canClose/canBook/canTakeOver/canManageTemplates` (~275-284, зависят от `role`); плейсхолдеры шаблонов — `substituteTemplatePlaceholders` (~289-318); адаптив layout — `<style>`-блок с `.clinic-chat-grid` (CSS media-queries, ~582-611).
- **Подводные камни:** **второй по размеру файл (1322 строки)** — крайне насыщенный. Навигация через `window.location.assign('/'+SLUG+path)`, **НЕ через react-router** (компонент монтируется в `AdminRoot` без `BrowserRouter`, `useNavigate()` бросит invariant — см. комментарий ~208). Есть собственный `ChatErrorBoundary` с дампом ошибки (для отладки в проде). «Своими» считаются сообщения от `doctor/manager/reg/staff` или `is_mine` — логика дублируется в звуке и в `renderedMessages`. Многие fetch-ответы нормализуются защитно (`Array.isArray ? ... : (r.data?.threads || [])`, `.filter(Boolean)`) — бэкенд иногда отдаёт неконсистентную форму. `window.confirm`/`alert` ещё используются местами (закрытие треда, VIP-регистратор).
- **Строк:** 1322

## `frontend/src/sections/ClinicsNetworkSection.jsx`
- **Назначение:** Раздел «Клиники сети» кабинета franchise_owner. Сетка карточек клиник (название/slug/статус, адрес/телефон, контракт-метрика, руководитель или предупреждение об отсутствии). Клик по карточке открывает модалку редактирования.
- **Ключевые элементы:** `ClinicsNetworkSection({ adminToken })` (главный); под-компоненты `ClinicCard`, `ContractMetric`, локальный `Icon`; `reload()`, `openModal(id)`, `closeModal()`; словарь `CONTRACT_LABEL`.
- **Эндпоинты:** потребитель. `GET /franchise-owner/clinics` → массив клиник с полями `tenant_id`, `name`, `slug`, `is_active`, `address`, `phone`, `contract_type`, `royalty_percent`, `bonus_per_referral`, `manager{full_name,username}`.
- **Зависимости:** `../api`; `../design` (`Card`, `Chip`, `Button`, `EmptyState`); компонент `../components/ClinicEditModal` (открывается по `tenant_id`, `onSaved` → `reload`).
- **Где менять для типовых задач:** вид карточки клиники — `ClinicCard`; новый тип контракта — `CONTRACT_LABEL` + ветки в `ContractMetric`; что показывается в модалке — это уже `ClinicEditModal` (другой файл).
- **Подводные камни:** ключ карточки и проп модалки — `item.tenant_id` (не `id`). `bonus_per_referral` форматируется `Number(...).toLocaleString('ru')` — число от API. Карточка — `<button>` с hover-эффектами через прямые мутации `e.currentTarget.style` (не CSS-класс).
- **Строк:** 314

## `frontend/src/sections/ContactsSection.jsx`
- **Назначение:** Раздел «Обращения с сайта» — заявки из формы «Написать нам». Список с фильтром все/непрочитанные, раскрытием сообщения, отметкой прочитанным, удалением, пагинацией и быстрыми действиями (звонок/email/QuickActions).
- **Ключевые элементы:** `ContactsSection({ token })`; `load()`, `markRead(id)`, `del(id)`; пагинация (`page`, `limit=30`, `total`); `expanded` (раскрытая карточка).
- **Эндпоинты:** потребитель:

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/contact/admin/list` | admin/manager | `unread_only`, `limit`, `offset` | `{items[], total}` | Список обращений |
| PATCH | `/contact/admin/{id}/read` | admin/manager | `{}` | — | Отметить прочитанным |
| DELETE | `/contact/admin/{id}` | admin/manager | — | — | Удалить обращение |

- **Зависимости:** `../api`; `useConfirm` из `../design`; компонент `../components/QuickActions` (контекст `patient`, передаётся `{phone, name}`).
- **Где менять для типовых задач:** действия в раскрытой карточке (позвонить/email/прочитать/удалить) — блок `{expanded === item.id && ...}` (~149-181); фильтры — кнопки «Все»/«Непрочитанные»; размер страницы — `limit`.
- **Подводные камни:** при ошибке загрузки молча обнуляет список (`catch { setItems([]); setTotal(0) }`). `unreadCount` считается только по **текущей странице** (`items.filter`), не по всему `total`. Стили — Tailwind-классы (новый диалект), но цвета кнопок захардкожены (`#0A2342`).
- **Строк:** 204

## `frontend/src/sections/CrossClinicDirectorySection.jsx`
- **Назначение:** Справочник сотрудников всех клиник сети (одного тенанта/франшизы) с возможностью позвонить любому через WebRTC-виджет. Группировка по клиникам, фильтры по роли/ФИО/клинике, переключатель режима аудио/видео с учётом подключённых модулей.
- **Ключевые элементы:** `CrossClinicDirectorySection({ adminToken })` (главный); под-компонент `ClinicGroup`; локальный `Icon`; `reload()`, `callUser(u)`; мемо `grouped` (группировка по клинике + виртуальная «Без клиники»); словари `ROLE_LABEL`, `ROLE_TONE`, `ROLE_FILTER_OPTIONS`, JSX-`HINT`.
- **Эндпоинты:** потребитель:

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/calls/directory` | manager/reg/owner | `role`, `search` | `{clinics[], users[]}` | Справочник сотрудников сети |
| GET | `/presence/can-call` | — | — | `{audio, video, enabled}` | Возможности звонков (для UX) |

- **Зависимости:** `../api`; `../design` (`Card`, `Button`, `Chip`, `EmptyState`, `useToast`, `InfoHint`). Запуск звонка — через `window.dispatchEvent(new CustomEvent('clinika:start-call', { detail: {user_id, full_name, call_type} }))`, **слушает `CallWidget.jsx`** (не прямой API-вызов).
- **Где менять для типовых задач:** новая роль — `ROLE_LABEL` + `ROLE_TONE` + `ROLE_FILTER_OPTIONS`; логика группировки/«Без клиники» — мемо `grouped`; вид группы клиники — `ClinicGroup`; правила доступности кнопки звонка — `callUser` + `callCaps`.
- **Подводные камни:** звонок инициируется **через глобальное событие window**, а не запросом — реальные call-rules проверяются уже в `CallWidget`/WS-сигналинге. Кнопка «Позвонить» блокируется по `callCaps` (audio/video/enabled из `/presence/can-call`). Дебаунс поиска 350мс через `useEffect` с `setTimeout` (eslint-disable на deps).
- **Строк:** 425

## `frontend/src/sections/DoctorLabOrdersSection.jsx`
- **Назначение:** Раздел «Лабораторные анализы» в кабинете врача (модуль `lab_integration`). Список заявок с табами-фильтрами по статусу, создание новой заявки (lazy-форма), модал с результатами и скачиванием PDF. Адаптив: desktop-таблица / mobile-список.
- **Ключевые элементы:** `DoctorLabOrdersSection()` (без пропсов); `loadOrders()`, `loadProviders()`, `openDetail(order)`, `closeDetail()`, `downloadPdf()`; мемо `tabs` (счётчики по статусам), `filteredOrders`; форматтер `fmtDate`, `MIcon`; словарь `STATUS_META`; lazy `LabOrderForm`.
- **Эндпоинты:** потребитель:

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/doctor/lab-orders` | doctor (гейт `lab_integration`) | — | массив заявок | Список заявок врача |
| GET | `/doctor/lab-orders/{id}/results` | doctor | — | массив результатов | Результаты заявки |
| GET | `/doctor/lab-orders/{id}/pdf` | doctor | — | blob PDF | Выгрузка результатов PDF |
| POST | `/doctor/lab-orders` | doctor | (внутри `LabOrderForm`) | — | Создать заявку |
| GET | `/admin/lab/providers` | doctor | — | список лабораторий | Опции формы создания |

- **Зависимости:** `../api`; `../design` (`Card`, `Button`, `Chip`, `Tabs`, `EmptyState`, `Modal`, `useToast`, `Skeleton`); `../components/lab/LabResultsTable`; lazy `../components/lab/LabOrderForm`.
- **Где менять для типовых задач:** новый статус заявки — `STATUS_META` (label+variant) + при необходимости логика табов в `tabs`/`filteredOrders`; кнопка «Новая заявка» отключена при `providers.length===0`; вид модала результатов — блок `{detailOrder && <Modal>...}` (~323-386).
- **Подводные камни:** **HTTP 402** → ранний `return` с экраном «модуль не подключён» (`error === 'module_off'`). Результаты грузятся только для статусов `results_ready`/`delivered`. `toast` вызывается объектной формой `toast({ kind, text })` — отличается от строковой формы в других секциях (`toast('msg','error')`); проверяй сигнатуру при копировании. Поля заявки гибкие: `test_codes` || `tests`, `patient_name` || `id ${patient_id}`.
- **Строк:** 390

## `frontend/src/sections/DoctorPatientDocumentsSection.jsx`
- **Назначение:** Документы пациента глазами врача — встраиваемая панель (в `DoctorLayout`, карточка приёма). Сетка карточек документов с предпросмотром (lightbox) и скачиванием. Бэкенд сам фильтрует по visibility.
- **Ключевые элементы:** `DoctorPatientDocumentsSection({ patientId, compact })`; `load()`, `downloadDoc(doc)`, `previewDoc(doc)`, `closePreview()`; утилита `plural(n, forms)`; lazy `DocumentCard`, `ImageLightbox`.
- **Эндпоинты:** потребитель:

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/doctor/patients/{patientId}/documents` | doctor | — | массив документов | Список (отфильтрован по visibility) |
| GET | `/doctor/patients/{patientId}/documents/{docId}/download` | doctor | `responseType: blob` | blob | Скачать/предпросмотр |

- **Зависимости:** `../api`; `useToast` из `../design`; lazy `../components/documents/DocumentCard`, `../components/documents/ImageLightbox`.
- **Где менять для типовых задач:** обработка ошибок/состояний — разные `error`-экраны (`forbidden` 403, `module_off` 402, `load_failed`, пусто/404); вид карточки документа — `DocumentCard` (другой файл); встраивание без заголовка — проп `compact`.
- **Подводные камни:** маппинг статусов ошибок: **403→`forbidden`** («пациент не открыл документы»), **402→`module_off`**, 404→пустой список (не ошибка). Blob-URL для preview хранится в `preview._blobUrl` и освобождается в `closePreview` (`URL.revokeObjectURL`) — утечки памяти при незакрытии. `plural` — ручная русская плюрализация.
- **Строк:** 171

## `frontend/src/sections/DoctorsSection.jsx`
- **Назначение:** CRUD-управление врачами: список карточек с поиском, форма создания/редактирования (профиль + фото + шаблонное недельное расписание). Мягкое удаление (деактивация). Используется в кабинете менеджера.
- **Ключевые элементы:** `DoctorsSection({ token })` (главный: список + поиск); подкомпонент-редактор `DoctorEditor`; `DoctorAvatar` (фото с fallback-инициалами); `Field`; утилита `resolvePhotoUrl`; `loadDoctors()`, `loadClinics()`, `deleteDoctor()`; в редакторе — `saveDoctor()`, `saveSchedule()`, `onPickPhoto()`, `deletePhoto()`, `setDay()`; константы `DAY_NAMES`, `DEFAULT_SCHEDULE`, `EMPTY_FORM`, `inputStyle`.
- **Эндпоинты:** потребитель:

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/doctors` | manager | — | массив врачей | Список |
| GET | `/manager/clinics/` | manager | — | массив клиник | Опции «Клиника» |
| POST | `/doctors` | manager | `{full_name, specialty, clinic_id, slot_duration, bio, experience_years}` | `{id}` | Создать врача |
| PATCH | `/doctors/{id}` | manager | частичный payload / `{is_active:false}` | — | Обновить / мягко удалить |
| POST | `/doctors/{id}/photo` | manager | multipart `file` | `{photo_url}` | Загрузить фото |
| DELETE | `/doctors/{id}/photo` | manager | — | — | Удалить фото |
| GET | `/doctors/{id}/schedule` | manager | — | массив 7 дней | Загрузить расписание |
| PUT | `/doctors/{id}/schedule` | manager | массив `{day_of_week, start_time, end_time, is_active}` | — | Сохранить расписание |

- **Зависимости:** `../api`, `API_BASE` из `../config` (для абсолютных URL фото); `useToast`, `useConfirm` из `../design`.
- **Где менять для типовых задач:** новое поле профиля — `EMPTY_FORM` + инициализация в `DoctorEditor` + `payload` в `saveDoctor` + поле формы; правила фото — `onPickPhoto` (лимит 5МБ, типы jpeg/png/webp); расписание (часы по умолчанию) — `DEFAULT_SCHEDULE`; URL фото — `resolvePhotoUrl` (относительные пути → `API_BASE + url`).
- **Подводные камни:** удаление **мягкое** (`PATCH {is_active:false}`), не DELETE. Фото грузится **после** сохранения врача (нужен `savedId`); если врач создан, а фото не загрузилось — ранний `return` с ошибкой (врач остаётся). Расписание сохраняется отдельной кнопкой и только для уже сохранённого врача (`doctorId`); время дополняется `:00` если формат `HH:MM`. Стили смешанные: Tailwind + inline `inputStyle` + hex-градиенты `#0097A7→#00C4D7`.
- **Строк:** 633

## `frontend/src/sections/FranchiseAnalyticsSection.jsx`
- **Назначение:** Премиум-аналитика франшизы (Глава 3) — 4 вкладки: KPI-дашборд (метрики с дельтами, топ-сущности), Cohort-анализ (heatmap клиника×месяц с цветовой шкалой и drill-down), Bulk-тарифы (батч-редактор планов/модулей по тенантам), Рекомендации (карточки с severity, dismiss в localStorage). Без recharts — всё на CSS/SVG.
- **Ключевые элементы:** `FranchiseAnalyticsSection()` (роутер вкладок); вкладки `KpiDashboard`, `CohortAnalysis`, `BulkPricing`, `Recommendations`; карточки `BigKpiCard`, `SmallKpiCard`, `KpiSkeletonGrid`; утилиты `fmtNum`, `fmtRub`, `fmtPct`, `downloadCsv`; в Cohort — `colorFor(val,max)` (oklch шкала), drill-down `drillClinic`; константы `RANGE_TABS`, `METRIC_TABS`, `TAB_ITEMS`, `PLAN_OPTIONS`, `SEVERITY_COLORS`.
- **Эндпоинты:** потребитель:

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/admin/analytics/franchise-kpi` | franchise_owner/super_admin | `range` (7d/30d/90d/365d) | объект KPI | KPI-дашборд |
| GET | `/admin/analytics/cohort-clinics` | franchise_owner | `metric`, `period=monthly` | `{clinics[], months[], percentiles, cohort_size, cohort_avg_current}` | Когортный heatmap |
| GET | `/admin/analytics/recommendations` | franchise_owner | — | `{items[], count}` | Рекомендации |
| GET | `/admin/franchise/tenants-pricing` | franchise_owner | — | `{tenants[], modules_catalog[]}` | Текущие тарифы тенантов |
| POST | `/admin/franchise/bulk-update-plans` | franchise_owner | `{updates:[{tenant_id, plan?, modules?}]}` | `{updated_count}` | Массовое обновление |

- **Зависимости:** `../api`; `../design` (`Card`, `Tabs`, `Button`, `Chip`, `EmptyState`, `Sparkline`, `KpiRow`, `KpiCard`, `Skeleton`, `TableSkeleton`, `useToast`).
- **Где менять для типовых задач:** новая KPI-плитка — в `KpiDashboard` (`<KpiRow>` блоки) + строка в `handleExport`; новая метрика когорты — `METRIC_TABS`; цветовая шкала heatmap — `colorFor`; опции плана для bulk — `PLAN_OPTIONS`; severity рекомендаций — `SEVERITY_COLORS`; новая вкладка — `TAB_ITEMS` + ветка рендера (~109-112).
- **Подводные камни:** `useToast?.()` вызывается **опционально** и используется как `toast?.show?.(...)` — сигнатура `.show()` отличается от `toast('msg','error')` в других секциях; будь внимателен при копировании. Bulk: правки копятся в `edits` (tenant_id→{plan,modules}), `buildPayload` шлёт только изменённые; модули диффятся через `Set`. Рекомендации `dismiss` хранятся в `localStorage['clinika.rec.dismissed']`. `apply(rec)` навигирует через `window.location.hash = rec.action_url`. CSV-экспорт клиентский с BOM (`﻿`) и `;`-разделителем (для Excel). Все запросы — с флагом `cancelled` для защиты от race на смене параметров.
- **Строк:** 918

---

### Перекрёстные наблюдения по группе
- **Гейтинг модулей (HTTP 402)** обрабатывают: `CallRecordingsSection`, `DoctorLabOrdersSection`, `DoctorPatientDocumentsSection`. Паттерн один — ловить `e.response.status === 402` и показывать экран «модуль не подключён».
- **Разные сигнатуры `useToast`** в группе: строковая `toast('текст','error')` (Doctors, ClinicChat, CrossClinic), объектная `toast({kind,text})` (DoctorLabOrders), `toast?.show?.('текст','warn')` (FranchiseAnalytics). Это потенциальный источник тихих багов при копипасте.
- **`BillingLedgerSection` — единственный в группе с собственным `fetch`-механизмом** (`apiFetch`) вместо общего `../api`; учитывай при изменениях авторизации/`API_BASE`.
- **Скачивание файлов**: blob+`URL.createObjectURL` (Audit CSV, LabOrders PDF, DoctorPatientDocuments, FranchiseAnalytics CSV) против прямого `window.open('/api/...')` без Bearer (CallRecordings file) — несогласованность.
