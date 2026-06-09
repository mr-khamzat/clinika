# sections [06] — Телемед, админ-тенант, франшиза, аналитика МИС, звонки, engagement-CRM

Это разнородный, но финальный срез каталога `frontend/src/sections/` (файлы 76–90 алфавитного списка) плюс три тематических подпапки: `analytics/`, `calls/`, `engagement/`. Все файлы — React-компоненты-«секции» (содержимое одной вкладки/раздела в кабинете администратора, управляющего или директора). Это не роутеры: HTTP-эндпоинты здесь **только потребляются** (через axios или fetch), не объявляются. Backend-эндпоинты в комментариях/документации указаны как контракт, который дёргает фронт.

Ключевой архитектурный раскол этого среза — **две конвенции работы с API**:
1. **Современная** — общий axios-инстанс `import api from '../api'` (или `'../../api'`): авто-`Bearer`, авто-refresh токена, базовый URL уже зашит. Так делают: TelemedicineSection, TenantDrawer, VisibilitySection, WikiSection, все 5 файлов `analytics/`, CallLogSection.
2. **Легаси** — ручной `fetch(API_BASE + path, { headers: { Authorization: Bearer ${token} } })` с проп-токеном. Так делают все файлы `engagement/` и WebhooksSection. Здесь нет авто-refresh и нет общего перехвата ошибок; `confirm()`/`alert()` — нативные браузерные.

Tenant-изоляция (`tenant_id`) полностью на backend — фронт её не передаёт и не контролирует; единственное явное межтенантное место — VisibilitySection (матрица франшизы) и `clinic_id` как фильтр в analytics/calls.

## Оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `TelemedicineSection.jsx` | Список телемед-сессий, KPI, чат, рецепты | 357 |
| `TenantDrawer.jsx` | Drawer управления тенантом: 4 вкладки | 614 |
| `VisibilitySection.jsx` | Матрица видимости клиник во франшизе | 175 |
| `WebhooksSection.jsx` | CRUD исходящих вебхуков тенанта | 351 |
| `WikiSection.jsx` | Wiki-редактор Markdown с DOMPurify | 443 |
| `analytics/AttributionSection.jsx` | Выручка/записи по каналам привлечения | 173 |
| `analytics/DoctorRetentionSection.jsx` | Возвратность пациентов по врачам + drill | 295 |
| `analytics/NoShowSection.jsx` | Пациенты с no-show, потерянная выручка | 195 |
| `analytics/ProgramsSection.jsx` | Продажи программ/абонементов | 174 |
| `analytics/RetentionMisSection.jsx` | Возвратность из МИС (is_first_doctor) | 188 |
| `calls/CallLogSection.jsx` | История + аналитика звонков, CSV | 682 |
| `engagement/CampaignsList.jsx` | Список push-кампаний + детальный модал | 312 |
| `engagement/EngagementDashboard.jsx` | Дашборд ЛК: heatmap, когорты, воронка | 315 |
| `engagement/PatientCardModal.jsx` | Карточка пациента ЛК, 6 вкладок | 507 |
| `engagement/PatientEngagement.jsx` | Корневой hub раздела «Пациенты ЛК» | 142 |

---

## `frontend/src/sections/TelemedicineSection.jsx`
- **Назначение:** Раздел `/admin/telemedicine`: таблица телемед-сессий с KPI, фильтрами и модалкой деталей (чат + рецепты), кнопка входа в видео-комнату.
- **Ключевые элементы:** дефолтный экспорт `TelemedicineSection({ token })`; вспомогательная `DetailField`; константа `STATUS_INFO` (маппинг статусов → label/цвет Chip); хелперы `fmtDate`, `fmtDuration`. State: `sessions`, `detail`/`detailMsgs`/`detailRx`, `roomSessionId`, фильтры. `useMemo` для `kpi`, `doctorOptions`, `filtered`.
- **Зависимости:** `../api` (axios); из `../design` — `Card, KpiRow, KpiCard, Button, Chip, Modal, EmptyState`; компонент `../components/telemed/TelemedRoomModal` (рендерится при наличии `roomSessionId`). Проп `token` принимается, но **не используется** (api сам ставит Bearer).
- **Потребляемые эндпоинты:** `GET /telemed/sessions` (список), `GET /telemed/sessions/{id}/messages`, `GET /telemed/sessions/{id}/prescriptions` (грузятся параллельно при открытии детали через `Promise.all` с `.catch`-фолбэком на `[]`). Эндпоинты `/telemed/sessions/{id}` упомянуты в шапке, но в коде не вызываются.
- **Где менять для типовых задач:** новый статус сессии — добавить в `STATUS_INFO` (l/c). Новый KPI — в `useMemo kpi` + новый `<KpiCard>` в `KpiRow`. Новая колонка таблицы — `<thead>` + ячейка в `.map`. Логика входа в комнату — кнопки `setRoomSessionId(s.id)`, рендер `TelemedRoomModal` внизу. Фильтры — блок `filtered` useMemo + соответствующий `<select>`/`<input>`.
- **Подводные камни:** KPI считаются на клиенте по уже загруженному списку (нет серверной агрегации) — на больших объёмах неточно/медленно. Ответ нормализуется через `Array.isArray(r.data) ? r.data : (r.data?.items || [])` — backend может вернуть и массив, и `{items}`. `duration_seconds` ожидается числом; гейтинг доступа по модулю `telemedicine` происходит выше, в `AdminLayout.visibleNav`.
- **Строк:** 357

## `frontend/src/sections/TenantDrawer.jsx`
- **Назначение:** Правый sliding-drawer для super_admin: управление одним тенантом по 4 вкладкам — Основное (статус/сброс пароля), Интеграции (CRUD внешних МИС/ЛИС), Модули (подписки на платные модули), Биллинг (план + цикл оплаты + триал).
- **Ключевые элементы:** дефолтный экспорт `TenantDrawer({ token, tenant, onClose, onUpdate })`; внутренние под-компоненты `TabMain`, `TabIntegrations`, `TabModules`, `TabBilling`. Локальная обёртка-шим `api(method, url, _token, data)` поверх `apiClient` (третий аргумент `_token` игнорируется — оставлен для обратной совместимости). Константы стилей `STATUS_CLS`, `PLAN_CLS`, `CAT_LABELS`, `CAT_ICONS`; `EMPTY_INT`.
- **Потребляемые эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| POST | `/admin/tenants/{id}/reset-password` | super_admin | — | `{admin_panel,username,new_password}` | Сброс пароля админа тенанта |
| PATCH | `/admin/tenants/{id}/toggle` | super_admin | `{is_active}` | — | Вкл/откл тенант |
| GET | `/admin/tenants/{id}/integrations` | super_admin | — | список интеграций | Список |
| POST | `/admin/tenants/{id}/integrations` | super_admin | `{type,name,base_url,api_key,extra_config}` | — | Создать |
| PUT | `/admin/tenants/{id}/integrations/{id}` | super_admin | `{name,base_url,extra_config,api_key?}` | — | Изменить |
| DELETE | `/admin/tenants/{id}/integrations/{id}` | super_admin | — | — | Удалить |
| POST | `/admin/tenants/{id}/integrations/{id}/test` | super_admin | — | `{status,error?}` | Тест соединения |
| GET | `/admin/tenants/{id}/modules` | super_admin | — | `[{module, subscription}]` | Список модулей |
| POST | `/admin/tenants/{id}/modules/{key}/enable` | super_admin | `{billing_cycle,trial_days,custom_price}` | — | Включить модуль |
| POST | `/admin/tenants/{id}/modules/{key}/disable` | super_admin | — | — | Отключить |
| PUT | `/admin/tenants/{id}/modules/{key}/price` | super_admin | `{custom_price}` | — | Договорная цена |
| POST | `/admin/tenants/{id}/subscription` | super_admin | `{plan,billing_cycle,trial_days}` | — | Активировать подписку |

- **Зависимости:** `../api` (default `apiClient`); из `../design` — хуки `useToast`, `useConfirm` (заменяют `alert`/`window.confirm`). Вызывается из списка тенантов (родитель передаёт `tenant`, `onUpdate`, `onClose`).
- **Где менять для типовых задач:** новый тарифный план — `PLAN_OPTS` в `TabBilling` + `PLAN_CLS`. Новый цикл оплаты — массивы `[['monthly',...]]` в `TabModules`(enableForm) и `TabBilling`. Новый тип интеграции — массив `['mis','lis','bars','custom']` в `TabIntegrations`. Новая вкладка — массив `TABS` внизу + ветка рендера в «Контент».
- **Подводные камни:** при PUT интеграции `api_key` отправляется только если непустой (иначе не перезатирается) — важно при редактировании. `custom_price` уходит как `Number(...) || null` (Decimal на backend). При обновлении модуля `parent`-цена форматируется `.toLocaleString('ru-RU')` — ожидается число, не строка. `EMPTY_INT.extra_config: null` — backend должен принимать null. Цены планов в `PLAN_OPTS` (9 900 / 24 900 / 49 900) захардкожены — это витрина, не источник правды.
- **Строк:** 614

## `frontend/src/sections/VisibilitySection.jsx`
- **Назначение:** Матрица видимости между клиниками одной франшизы (super_admin / franchise_owner): для каждой пары (кто смотрит → на кого) два чекбокса — Чат и Звонки. Снятый чекбокс = пользователи viewer не видят пользователей target в этом модуле.
- **Ключевые элементы:** дефолтный экспорт `VisibilitySection()` (без пропов). State: `tenants`, `cells`, `loading`, `saving`, `msg`. `useMemo cellMap` (индекс `viewer->target`), хелперы `getCell` (дефолт `allow_chat/allow_calls = true`), `updateCell`, `save`.
- **Потребляемые эндпоинты:** `GET /franchise/visibility` → `{tenants, cells}`; `PUT /franchise/visibility` с телом `{cells}` → `{updated}`. После сохранения делает повторный GET для синхронизации.
- **Зависимости:** только `../api` (axios). Дизайн-систему не использует — голый Tailwind.
- **Где менять для типовых задач:** добавить третий модуль (кроме Chat/Calls) — расширить `getCell`/`updateCell` дефолтами, добавить третий `<label><input checkbox>` в ячейку и поле в payload. Логику «по умолчанию всё видно» — функция `getCell` (если записи нет, возвращает `true/true`).
- **Подводные камни:** диагональ матрицы (`v.id === t.id`) рендерится прочерком — клиника всегда видит себя. Жёлтая подсветка ячейки при `!isDefault` (любой чекбокс снят). `cells` — это **разреженный** массив: записи появляются только при изменении (через `updateCell`), отсутствие записи = дефолт. Пустой `tenants` → экран «Нет франшизы». `msg` авто-сбрасывается через 4 секунды.
- **Строк:** 175

## `frontend/src/sections/WebhooksSection.jsx`
- **Назначение:** Управление исходящими вебхуками тенанта: регистрация URL, выбор событий, секрет HMAC, тест-отправка, история доставок, вкл/откл.
- **Ключевые элементы:** дефолтный экспорт `WebhooksSection({ token })`; локальный `apiFetch(token, path, opts)` (ручной fetch); константа `EVENT_LABELS` (RU-подписи событий). State: `webhooks`, `events`, `form`, `showCreate`/`editId`, `deliveries`/`deliveriesId`, `testLoading`.
- **Потребляемые эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/webhooks` | tenant-admin | — | список вебхуков | Список |
| GET | `/webhooks/events` | tenant-admin | — | `{events:{...}}` или массив | Каталог событий |
| POST | `/webhooks` | tenant-admin | `{url,events,description,secret?}` | — | Создать |
| PATCH | `/webhooks/{id}` | tenant-admin | partial (`is_active`/поля) | — | Изменить/тоггл |
| DELETE | `/webhooks/{id}` | tenant-admin | — | — | Удалить |
| POST | `/webhooks/{id}/test` | tenant-admin | — | `{status_code}` | Тест-отправка |
| GET | `/webhooks/{id}/deliveries?limit=20` | tenant-admin | — | список доставок | История |

- **Зависимости:** `../config` (`API_BASE`, импортируются также `BASE_PATH, SLUG`, но фактически используется только `API_BASE`); из `../design` — `useToast`, `useConfirm`. Проп `token` обязателен (ручной Bearer).
- **Где менять для типовых задач:** новое событие — добавить ключ в `EVENT_LABELS` (RU-подпись); сами доступные события приходят из `/webhooks/events`. Валидация URL — `save()` (`startsWith('http')`). Поля формы — `form` + `resetForm` + блок «Форма создания/редактирования».
- **Подводные камни:** **легаси-конвенция** — ручной fetch без авто-refresh; при истёкшем токене запросы молча падают. `events: []` означает «все события» (отправляется как `null`). Парсинг `/webhooks/events` дефенсивный: `Array.isArray ? : Object.keys(eData?.events || eData || {})` — формат ответа непостоянен. Секрет (`secret`) при редактировании отправляется только если введён заново. Подпись на backend — заголовок `X-Clinika-Signature` (HMAC-SHA256).
- **Строк:** 351

## `frontend/src/sections/WikiSection.jsx`
- **Назначение:** Встроенный Wiki-редактор (дерево страниц слева + Markdown-редактор/превью справа): создание/редактирование/удаление страниц, загрузка картинок, посев стартовых страниц.
- **Ключевые элементы:** дефолтный экспорт `WikiSection({ token })`; под-компонент `PageItem`. **Собственный мини-Markdown-парсер `renderMd(raw)`** (регэкспы: код, заголовки, bold/italic, цитаты, картинки, ссылки, таблицы, списки, hr, параграфы). Конфиг `SANITIZE_CONFIG` для DOMPurify (whitelist тегов/атрибутов + `ALLOWED_URI_REGEXP` блокирует `javascript:`/`data:`). Массив `ICONS`. Функции `loadPages`, `selectPage`, `newPage`, `save`, `deletePage`, `uploadImage`, `seedPages`.
- **Потребляемые эндпоинты:** `GET /wiki/pages/all`; `POST /wiki/pages`; `PUT /wiki/pages/{id}`; `DELETE /wiki/pages/{id}`; `POST /wiki/images` (multipart) → `{id}`, картинка доступна по `GET /wiki/images/{id}`; `POST /wiki/seed` → `{created}`.
- **Зависимости:** `dompurify`; `../api` (axios); `../design` → `useConfirm`. Картинка вставляется как абсолютный URL `api.defaults.baseURL + '/wiki/images/' + id`, чтобы `<img src>` работал в браузере.
- **Где менять для типовых задач:** новый Markdown-синтаксис — добавить `.replace(...)` в `renderMd` **и** соответствующий тег в `SANITIZE_CONFIG.ALLOWED_TAGS`/`ALLOWED_ATTR` (иначе DOMPurify вырежет). Новая иконка страницы — массив `ICONS`. Логика дерева — `rootPages`/`childPages` (поддерживается **один уровень** вложенности).
- **Подводные камни:** **самописный MD-рендер через regex** — хрупок (порядок replace важен, edge-cases типа вложенных списков не покрыты). Безопасность держится на `DOMPurify.sanitize(renderMd(...), SANITIZE_CONFIG)` — нельзя рендерить MD без санитайза. При обновлении (`save` с `selected`) `parent_id` отправляется как строка `'null'` (не `null`) — backend должен это парсить; при создании — настоящий `null`. Дерево плоское: `parent_id` есть, но рекурсии нет (только root → child).
- **Строк:** 443

## `frontend/src/sections/analytics/AttributionSection.jsx`
- **Назначение:** Аналитика атрибуции — распределение записей и выручки по каналам/источникам привлечения за период.
- **Ключевые элементы:** дефолтный экспорт `AttributionSection({ clinicId })`; хелперы `fmt`, `money`, `periodPreset(n)`, локальные `th()`/`td()` (inline-стили таблицы через CSS-переменные темы). State: `period`, `presetKey`, `rows`, `loading`, `error`. `useMemo summary` (channels/first/revenue).
- **Потребляемые эндпоинты:** `GET /manager/analytics/attribution?date_from&date_to[&clinic_id]` → массив `{channel,total_appointments,unique_patients,first_time_patients,revenue}` (backend уже сортирует по выручке).
- **Зависимости:** `../../api`; из `../../design` — `Card, EmptyState, KpiCard`.
- **Где менять для типовых задач:** новая колонка — `<thead>` + ячейка в `.map`. Новый KPI — `summary` useMemo + `<KpiCard>`. Период по умолчанию — `useState(() => periodPreset(30))`. Пресеты — массив объектов `{n,k,l}`.
- **Подводные камни:** это **один из пяти почти-близнецов** в `analytics/` — все имеют идентичные `periodPreset`, `th()`, `td()`, фильтр периода и паттерн загрузки (копипаста, не общий компонент). `clinicId=''` означает «все клиники тенанта». KPI считаются на клиенте суммированием `rows`. Эффект загрузки с `// eslint-disable-next-line` (зависимость `load` намеренно опущена).
- **Строк:** 173

## `frontend/src/sections/analytics/DoctorRetentionSection.jsx`
- **Назначение:** Возвратность пациентов по врачам за период с drill-down: клик по врачу открывает модалку со списком его пациентов (ФИО, телефон, признак «повторно»).
- **Ключевые элементы:** дефолтный экспорт `DoctorRetentionSection({ clinicId })`; хелперы `fmt`, `pct`, `fmtDate`, `shortPhone` (форматирует +7 (xxx) xxx-xx-xx), `periodPreset`, `th`/`td`. State списка + отдельный state drill-down: `drillDoctor`/`drillRows`/`drillLoading`/`drillError`. `useMemo summary`.
- **Потребляемые эндпоинты:** `GET /manager/analytics/doctor-retention?date_from&date_to[&clinic_id]` → строки врачей; `GET /manager/analytics/doctor-retention/{doctor_id}/patients?...` → пациенты врача (drill).
- **Зависимости:** `../../api`; `../../design` → `Card, Chip, EmptyState, KpiCard, Modal, Button`.
- **Где менять для типовых задач:** пороги цвета возвратности — `Chip variant={r.retention_rate >= 0.4 ? 'good' : >= 0.2 ? 'warn' : 'neutral'}`. Колонки drill-модалки — `<thead>`/`.map` внутри `<Modal>`. Формат телефона — `shortPhone`.
- **Подводные камни:** «Повторно» определяется как «пациент был у врача до начала периода» (логика на backend, флаг `is_repeat`). Один из пяти близнецов — общая копипаста хелперов. `retention_rate` — доля 0..1, умножается на 100 в `pct`. Ключ строки drill — `p.patient_phone` (если у двух пациентов одинаковый/пустой телефон, React-ключи столкнутся).
- **Строк:** 295

## `frontend/src/sections/analytics/NoShowSection.jsx`
- **Назначение:** Список пациентов с отменёнными/несостоявшимися визитами (no-show) и потерянной выручкой — кандидаты на предоплату/skip-fee. По умолчанию период 90 дней.
- **Ключевые элементы:** дефолтный экспорт `NoShowSection({ clinicId })`; хелперы `fmt`, `money`, `fmtDate`, `shortPhone`, `periodPreset`, `th`/`td`. `useMemo summary` (totalNoshows/uniquePatients/lostRevenue).
- **Потребляемые эндпоинты:** `GET /manager/analytics/noshow?date_from&date_to[&clinic_id]` → массив `{patient_phone,patient_name,noshow_count,lost_revenue,last_noshow_date}`.
- **Зависимости:** `../../api`; `../../design` → `Card, Chip, EmptyState, KpiCard`.
- **Где менять для типовых задач:** порог «опасного» числа пропусков — `Chip variant={r.noshow_count > 3 ? 'bad' : 'warn'}`. Период по умолчанию — `periodPreset(90)`. Колонки — `<thead>`/`.map`.
- **Подводные камни:** один из пяти близнецов (период 90 вместо 30 — единственное отличие в дефолте). `lost_revenue` подсвечен красным (`var(--bad)`). Телефон кликабелен (`href="tel:"`). Ключ строки `${r.patient_phone}-${i}` (индекс добавлен для устойчивости).
- **Строк:** 195

## `frontend/src/sections/analytics/ProgramsSection.jsx`
- **Назначение:** Продажи программ/абонементов за период: количество проданных, выручка по каждой программе.
- **Ключевые элементы:** дефолтный экспорт `ProgramsSection({ clinicId })`; те же хелперы (`fmt`, `money`, `periodPreset`, `th`/`td`); `useMemo summary` (programs/sold/revenue).
- **Потребляемые эндпоинты:** `GET /manager/analytics/programs?date_from&date_to[&clinic_id]` → массив `{program_id,name,price,sessions_count,sold_count,revenue}`.
- **Зависимости:** `../../api`; `../../design` → `Card, EmptyState, KpiCard`.
- **Где менять для типовых задач:** колонки — `<thead>`/`.map`. Пустое состояние — большой `<EmptyState icon="card_membership">` (в отличие от соседей, EmptyState вынесен из таблицы — рендерится вместо `<table>`).
- **Подводные камни:** один из пяти близнецов. Ключ строки `r.program_id ?? `${r.name}-${i}`` — фолбэк, если backend не прислал id. Пустой массив = «нет программ/нет данных из МИС».
- **Строк:** 174

## `frontend/src/sections/analytics/RetentionMisSection.jsx`
- **Назначение:** Возвратность пациентов по врачам **из данных МИС** (точнее обычной retention-секции — у каждой записи МИС есть флаг `is_first_doctor`). Без drill-down (он уже есть в DoctorRetentionSection).
- **Ключевые элементы:** дефолтный экспорт `RetentionMisSection({ clinicId })`; хелперы `fmt`, `money`, `pct`, `periodPreset`, `th`/`td`; `useMemo summary` (total/repeat/first/revenue/rate).
- **Потребляемые эндпоинты:** `GET /manager/analytics/retention-mis?date_from&date_to[&clinic_id]` → массив `{doctor_id_mis,doctor_name,clinic_id_mis,clinic_name,total,first_visits,repeat_visits,retention_rate,revenue}`.
- **Зависимости:** `../../api`; `../../design` → `Card, Chip, EmptyState, KpiCard`.
- **Где менять для типовых задач:** пороги Chip возвратности — те же `>= 0.4 / >= 0.2`. Колонки — `<thead>`/`.map`. Ключ строки `${r.doctor_id_mis}-${r.clinic_id_mis}-${i}` (составной, т.к. один врач может работать в нескольких клиниках МИС).
- **Подводные камни:** один из пяти близнецов. Отличие от `DoctorRetentionSection` — источник данных (МИС, не локальные appointments) и наличие колонки «Выручка», отсутствие drill. Идентификаторы — `*_mis` (внешние ID из МИС, не PK базы).
- **Строк:** 188

## `frontend/src/sections/calls/CallLogSection.jsx`
- **Назначение:** Раздел звонков с двумя вкладками — «История» (фильтруемая таблица + пагинация) и «Аналитика» (KPI, топ-листы, SVG bar-charts динамики и распределения по часам). Экспорт в CSV.
- **Ключевые элементы:** дефолтный экспорт `CallLogSection({ clinicId, brandShort })`; под-компоненты `BarChart`, `HoursChart` (чистый inline-SVG, без библиотек), `TopList`. Константы `PERIODS`, `TYPE_OPTIONS`, `STATUS_OPTIONS`, `STATUS_LABEL`, `TYPE_LABEL`, `ROLE_LABEL`. Хелперы `fmtDateTime`, `fmtDuration`, `fmtNum`, `periodToISO`. `useMemo kpi`. Стиль `thStyle`.
- **Потребляемые эндпоинты:** `GET /calls/log?from&to&limit&offset[&type&status&clinic_id&search]` → `{items,total}`; `GET /calls/stats?from&to&period_days[&clinic_id]` → агрегаты (total_calls, audio/video, daily_trend, peak_hours, top_callers/callees); `GET /calls/log/export.csv?...` (responseType blob) → CSV.
- **Зависимости:** `../../api`; из `../../design` — `Card, KpiCard, KpiRow, Tabs, Button, Chip, Avatar, EmptyState, useToast, Skeleton, TableSkeleton`.
- **Где менять для типовых задач:** новая роль в подписи участника — `ROLE_LABEL`. Новый статус звонка — `STATUS_LABEL` (история) + `STATUS_OPTIONS` (фильтр). Имя CSV-файла — `onExport` (`звонки-${brandShort}-${stamp}.csv`). Размер страницы — `const limit = 50`. Логика чартов — `BarChart`/`HoursChart` (viewBox 560×N, CSS-vars для цвета).
- **Подводные камни:** **в STATUS_LABEL ключи `answered/missed/rejected/busy`, а в фильтре STATUS_OPTIONS — `completed/missed/declined`** — рассинхрон значений (фильтр шлёт `completed/declined`, а строки рендерятся по `answered/rejected`); проверить маппинг на backend перед правкой статусов. Пагинация через `offset`: смена любого фильтра сбрасывает на 0 (первый useEffect), `loadMore` дозагружает. Длительность показывается только для `answered`. «Распределение по часам» — UTC (явно подписано). Аналитика грузится лениво — только при переключении на вкладку `stats`.
- **Строк:** 682

## `frontend/src/sections/engagement/CampaignsList.jsx`
- **Назначение:** Список push-кампаний с фильтром по статусу; карточка кампании (метрики sent/delivered/clicks, A/B mini-chart) + действия (отправить/отменить/удалить). Плюс именованный экспорт `CampaignDetailsModal` — модалка детальной статистики.
- **Ключевые элементы:** дефолтный экспорт `CampaignsList({ token, onCompose, onOpenDetails })`; именованный экспорт `CampaignDetailsModal({ token, campaignId, onClose })`; под-компоненты `CampaignCard`, `Metric`, `BigStat`, `ABRow`. Локальный `apiFetch`; константа `STATUS` (6 статусов → label/color/icon); `fmtDateTime`.
- **Потребляемые эндпоинты:** `GET /engagement/campaigns[?status=]`; `POST /engagement/campaigns/{id}/cancel`; `POST /engagement/campaigns/{id}/send`; `DELETE /engagement/campaigns/{id}`; `GET /engagement/campaigns/{id}` + `GET /engagement/campaigns/{id}/stats` (в модалке, через `Promise.all`).
- **Зависимости:** `../../config` (`API_BASE`). Дизайн-систему **не** использует. Поднимает действия наверх через колбэки `onCompose`/`onOpenDetails` (из PatientEngagement).
- **Где менять для типовых задач:** новый статус кампании — `STATUS` + фильтр-массив `['all','draft',...]` + условия показа кнопок в `CampaignCard`. Метрики карточки — `CampaignCard` (`sent/delivered/clicks`, defensive `??`-чейны на оба формата полей). A/B-логика — блок `ab` в карточке и `ABRow` в модалке.
- **Подводные камни:** **легаси fetch** + нативные `confirm()` (не `useConfirm`). Поля статистики читаются дефенсивно из двух мест: `c.stats || c` и `stats.sent_count ?? stats.sent ?? 0` — backend непоследователен в именах. **`ABRow` строит классы Tailwind динамически** (`text-${color}-600`, `bg-${color}-500`) — при включённом Tailwind purge эти классы могут отсутствовать в бандле (нужен safelist). CTR считается как `clicks/sent`, не `clicks/delivered`.
- **Строк:** 312

## `frontend/src/sections/engagement/EngagementDashboard.jsx`
- **Назначение:** Дашборд раздела «Пациенты ЛК»: 7 stat-карточек (юзеры ЛК, новые/активные за периоды, отвал, ДР), heatmap логинов 7×24, когортный анализ удержания W1–W4, воронка вовлечённости.
- **Ключевые элементы:** дефолтный экспорт `EngagementDashboard({ token })`; под-компоненты `StatCard`, `LoginHeatmap`, `RetentionCohorts`, `FunnelChart`. Локальный `apiFetch`. Каждый виджет — самостоятельный, со своим селектором периода и `useEffect` с флагом `stop` (отмена при размонтировании).
- **Потребляемые эндпоинты:** `GET /engagement/dashboard` (7 метрик); `GET /engagement/login-heatmap?days=`; `GET /engagement/retention-cohorts?weeks=`; `GET /engagement/funnel?days=`.
- **Зависимости:** `../../config` (`API_BASE`). Все виджеты — самописные (heatmap на div-сетке, воронка на градиентных полосах, когорты на цветовой шкале `pctColor`). Дизайн-систему не использует.
- **Где менять для типовых задач:** новая stat-карточка — массив `cards` в главном компоненте. Цветовая шкала когорт — `pctColor(p)` (пороги 70/50/30/15). Цвета воронки — массив `colors`. Интенсивность heatmap-ячейки — `cnt/max` в `LoginHeatmap`.
- **Подводные камни:** легаси fetch. Каждый виджет грузит данные независимо (4 параллельных запроса). `LoginHeatmap` матрица `[7][24]`, день 0 = Пн (`dayLabels`). Селекторы периода у виджетов локальные и не синхронизированы между собой. `s.X ?? '—'` — все метрики опциональны.
- **Строк:** 315

## `frontend/src/sections/engagement/PatientCardModal.jsx`
- **Назначение:** Модал-карточка одного пациента ЛК с 6 вкладками: Профиль (+теги/+заметки), Коды доступа (направления), Коммуникации (comm_prefs), История ЛК (timeline логинов), Записи и платежи, Push-история.
- **Ключевые элементы:** дефолтный экспорт `PatientCardModal({ token, patientId, onClose })`; под-компоненты `ProfileTab`, `PrefsTab`, `LoginsTab`, `AppointmentsTab`, `PushHistoryTab`, `CodesTab`, `Field`. Локальный `apiFetch`; хелперы `fmtDate`, `fmtDateTime` и **критичный `fmtMisAddress(a)`** (нормализует address: строка ИЛИ объект `{city,street,house,...}`). Массив `TABS`.
- **Потребляемые эндпоинты:** `GET /engagement/patients/{id}` (всё за раз: profile/tags/notes/comm_prefs/recent_logins/appointments/suggestions/referrals); `POST/DELETE /engagement/patients/{id}/tags[/{tagId}]`; `POST /engagement/patients/{id}/notes`, `PATCH/DELETE .../notes/{id}` (pin/удаление); `PATCH /engagement/patients/{id}/comm-prefs`.
- **Зависимости:** `../../config` (`API_BASE`). Дизайн-систему не использует. Открывается из `PatientEngagement` по `openCardId`.
- **Где менять для типовых задач:** новая вкладка — массив `TABS` + ветка `{!loading && tab === '...' && <XxxTab/>}` + сам под-компонент. Новый toggle коммуникаций — `TOGGLES` в `PrefsTab` + дефолт в `draft`. Поля профиля — `<Field>` в `ProfileTab` (grid). Цвета статусов кодов — `statusColors` в `CodesTab`.
- **Подводные камни:** **`fmtMisAddress` — защита от React error #31** (краш при рендере объекта): MIS присылает адрес то строкой, то объектом — НЕ рендерить `profile.mis.address` напрямую. Все списки грузятся одним GET, обновление любого — `reload()` (полная перезагрузка карточки). Легаси fetch + нативный `confirm()` при удалении заметки. `comm_prefs` инициализируется через `!== false` (отсутствие = включено по умолчанию). `n.pinned`-сортировка заметок выполняется при каждом рендере (мутирующий `.sort` на копии из `data?.notes`).
- **Строк:** 507

## `frontend/src/sections/engagement/PatientEngagement.jsx`
- **Назначение:** Корневой компонент-hub раздела «Пациенты ЛК» (CRM): tab-бар (Дашборд/Пациенты/Подсказки/Кампании) + кнопки Шаблоны/Новый сегмент, плюс оркестрация всех глобальных модалок. Подключается из AdminLayout, FranchiseOwnerCabinet и DirectorLayout.
- **Ключевые элементы:** дефолтный экспорт `PatientEngagement({ token })`; `SectionLoader`; массив `TABS`. Всё содержимое и модалки загружаются через `React.lazy` + `Suspense`. State-«пульты» модалок: `openCardId`, `composeInitial`, `editSegment`, `showTemplates`, `campaignDetailsId`.
- **Зависимости (lazy):** `./EngagementDashboard`, `./PatientsTable`, `./SuggestionsBoard`, `./CampaignsList` (+ его именованный `CampaignDetailsModal` через `.then(m => ({default: m.CampaignDetailsModal}))`), `./PatientCardModal`, `./PushComposeModal`, `./SegmentEditorModal`, `./PushTemplatesModal`. **Примечание:** `PatientsTable`, `SuggestionsBoard`, `PushComposeModal`, `SegmentEditorModal`, `PushTemplatesModal` лежат в этой же папке `engagement/`, но НЕ входят в данный срез (документируются в других частях).
- **Где менять для типовых задач:** новая вкладка раздела — массив `TABS` + lazy-import + ветка рендера в первом `<Suspense>`. Новая глобальная модалка — добавить state-флаг + lazy-import + рендер во втором `<Suspense fallback={null}>` + проброс колбэка-открывашки в дочерние компоненты.
- **Подводные камни:** колбэки пробрасываются вниз и поднимают намерения наверх (`onOpenCard={setOpenCardId}`, `onCreateCampaign`, `onSaveSegment`). Bulk-тэг — **заглушка**: `onBulkTag={(ids) => alert('TODO: модалка выбора тэга')}` (нативный alert, незавершённый функционал). `CampaignDetailsModal` импортируется хитро как named-export через lazy-обёртку — при переименовании экспорта в CampaignsList сломается тихо. `token` пробрасывается всем детям (вся ветка `engagement/` — легаси-конвенция с проп-токеном).
- **Строк:** 142
