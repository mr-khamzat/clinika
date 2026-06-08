# sections [07] — Engagement (push-маркетинг), Inventory (склад) и Loyalty (баллы) в админ-ЛК

Этот срез — 15 React-компонентов клиники «КлиникСеть» из трёх продуктовых модулей админ-кабинета:

- **engagement/** (5 файлов) — CRM-маркетинг по пациентам ЛК: таблица аудитории, конструктор сегментов, шаблоны и конструктор push-кампаний, доска авто-подсказок. Все ходят на `/engagement/*` и `/ads/*` через локальный `apiFetch(token, path)` поверх `fetch(API_BASE + ...)`.
- **inventory/** (5 файлов) — учёт склада (W7 master plan): каталог позиций, остатки по клиникам, движения, алерты. Главный wrapper `InventorySection` раскладывает 4 подраздела по табам. Все ходят на `/inventory/*` (модульный гейт `require_module("inventory")`) через общий axios-инстанс `../../api`.
- **loyalty/** (5 файлов) — программа лояльности (W5 master plan): тиры, правила начисления, история транзакций, обмен баллов. Wrapper `LoyaltySection` раскладывает по табам. Все ходят на `/loyalty/*` (гейт `require_module("loyalty_pro")`, 402 → CTA «Подключить модуль») через `../../api`.

Это **frontend-only** код (никаких роутеров FastAPI здесь нет — таблицы «Эндпоинты» отсутствуют, вместо них даны таблицы потребляемых API). Важное архитектурное расщепление: **engagement** использует свой inline-хелпер `apiFetch` на голом `fetch` и принимает `token` пропсом, тогда как **inventory** и **loyalty** используют общий axios-инстанс `../../api` (токен берётся им самим из хранилища) и дизайн-систему `../../design` (`Card/Button/Chip/Modal/EmptyState/useToast/Tabs`). При правках держите эти два стиля раздельно — копипаст между модулями сломает аутентификацию или тосты.

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `engagement/PatientsTable.jsx` | Таблица пациентов ЛК: фильтры, пагинация, bulk | 341 |
| `engagement/PushComposeModal.jsx` | Конструктор push-кампании: A/B, расписание, превью | 323 |
| `engagement/PushTemplatesModal.jsx` | Каталог шаблонов push, CRUD, seed-defaults | 197 |
| `engagement/SegmentEditorModal.jsx` | Редактор сегмента: filter-builder + превью | 279 |
| `engagement/SuggestionsBoard.jsx` | Доска авто-подсказок, группы по kind, bulk | 261 |
| `inventory/InventoryAlertsSection.jsx` | Алерты: низкие остатки, просрочка, заказ | 185 |
| `inventory/InventoryItemsSection.jsx` | Каталог позиций: CRUD + импорт CSV | 380 |
| `inventory/InventoryMovementsSection.jsx` | Лента движений + приход/расход/перемещение/списание | 385 |
| `inventory/InventorySection.jsx` | Wrapper с 4 табами учёта инвентаря | 57 |
| `inventory/InventoryStocksSection.jsx` | Остатки по клиникам + мастер инвентаризации | 331 |
| `loyalty/LoyaltyExchangeSection.jsx` | Каталог наград + обмен баллов по телефону | 399 |
| `loyalty/LoyaltyRulesSection.jsx` | CRUD правил автоначисления баллов | 277 |
| `loyalty/LoyaltySection.jsx` | Wrapper с 4 табами программы лояльности | 59 |
| `loyalty/LoyaltyTiersSection.jsx` | CRUD тиров + топ-пациенты по уровням | 313 |
| `loyalty/LoyaltyTransactionsSection.jsx` | История транзакций баллов + CSV-экспорт | 212 |

---

## `frontend/src/sections/engagement/PatientsTable.jsx`

- **Назначение:** Таблица пациентов ЛК с расширенными фильтрами, серверной пагинацией и bulk-действиями. Витрина аудитории для маркетинга: из неё открывают карточку, создают кампанию, сохраняют сегмент, массово тэгируют.
- **Ключевые элементы:** `export default function PatientsTable({ token, onOpenCard, onCreateCampaign, onSaveSegment, onBulkTag })`. Локальные хелперы `apiFetch`, `fmtDate`, `fmtRel` (относительное время «5 мин назад»). Константа `SORT_OPTIONS` (6 вариантов сортировки, включая `birthday_soon`). Состояние: `items/total/loading`, набор фильтров (`q/lastFrom/lastTo/loginMin/loginMax/bdayDays/tagFilter/hasApps/sort`), `offset` (limit зафиксирован 50), `selected` как `Set` id.
- **Эндпоинты:** роутером не является. Потребляет одно API:

  | Метод | Путь | Принимает (query) | Возвращает | Назначение |
  |-------|------|-------------------|------------|------------|
  | GET | `/engagement/patients?…` | `q, last_login_from/to, login_count_min/max, birthday_in_next_days, has_tag, has_appointments_in_tenant, sort, limit, offset` | `{ items[], total }` | список пациентов с фильтрами |
- **Зависимости:** только `API_BASE` из `../../config`. Никакой дизайн-системы — вся вёрстка на Tailwind-классах inline. Не импортирует другие компоненты; связь с `PushComposeModal`/`SegmentEditorModal` идёт **через колбэки** (`onCreateCampaign(ids)`, `onSaveSegment(ids)`), которые поднимает родитель (страница engagement).
- **Где менять для типовых задач:**
  - Новый фильтр — добавь `useState`, положи параметр в `queryString` (useMemo, строки 70-84) и UI-инпут в filter-bar (строки 134-192); не забудь сбросить `offset` в эффекте строки 106.
  - Новая сортировка — пункт в `SORT_OPTIONS` (строки 42-49), backend должен понимать `sort`-значение.
  - Новое bulk-действие — проп-колбэк + кнопка в bulk-баре (строки 196-215), передаётся `sel` (массив id из `selected`).
  - Колонка таблицы — `<th>` в `thead` (строки 222-237) + `<td>` в `.map` (строки 251-316); следи за `colSpan={9}` в строках «Загрузка/Не найдено».
- **Подводные камни:** `tenant_id`-фильтрация целиком на бэке — фронт шлёт только `token`. Поиск дебаунсится `setTimeout(load, 200)` (строки 101-104), а смена любого фильтра сбрасывает `offset` и выделение (строка 106) — если добавишь фильтр и забудешь его в зависимостях этого эффекта, пагинация «застрянет». `load` возвращает cleanup с флагом `stop`, но реально вызывается из `useEffect` без использования возвращаемого значения — гонок нет за счёт дебаунса, но это слегка запутанный паттерн. Кнопка «Push пациенту» в строке вызывает `onCreateCampaign([p.id])` (массив из одного) — единый путь с bulk.
- **Строк:** 341

## `frontend/src/sections/engagement/PushComposeModal.jsx`

- **Назначение:** Модальный конструктор push-кампании: выбор аудитории (сегмент / список выбранных пациентов / все opt-in), заголовок и текст с подстановками-переменными, A/B-тест (вариант B), планирование на время, живой предпросмотр «на устройстве».
- **Ключевые элементы:** `export default function PushComposeModal({ token, initial, onClose, onCreated })`. Константа `VARS` (8 подстановок: `patient_first_name`, `clinic_name`, `doctor_name` и др.). Хелперы: `insertVar(varName, target)` (дописывает `{{var}}` в тело A или B), `buildPayload()` (собирает тело запроса), `submit(action)` где action ∈ `draft|send_now|schedule`. `refreshPreview` дебаунсится 300мс.
- **Эндпоинты:** потребляет:

  | Метод | Путь | Принимает | Возвращает | Назначение |
  |-------|------|-----------|------------|------------|
  | GET | `/engagement/segments` | — | `{items[]}` или `[]` | список сегментов для селекта |
  | GET | `/engagement/templates` | — | `{items[]}` или `[]` | шаблоны для автозаполнения |
  | POST | `/ads/substitute-preview` | `{ text }` | `{ preview \| text }` | серверный рендер подстановок (с fallback) |
  | POST | `/engagement/campaigns` | payload (title, body, segment_id/patient_ids, ab_*, scheduled_at, suggestion_ids) | `{ id, … }` | создать кампанию |
  | POST | `/engagement/campaigns/{id}/send` | — | — | немедленная отправка |
  | POST | `/engagement/campaigns/{id}/schedule` | `{ scheduled_at }` | — | планирование |
- **Зависимости:** `API_BASE` из `../../config`. Получает пресет через проп `initial` — его наполняют `PatientsTable` (через колбэк родителя) и `SuggestionsBoard` (поля `from_suggestion`, `patient_ids`, `suggestion_ids`, `template_id`, `kind`). Никакой дизайн-системы.
- **Где менять для типовых задач:**
  - Новая подстановка-переменная — пункт в `VARS` (строки 19-28); backend `/ads/substitute-preview` и движок рассылки должны её знать.
  - Новое поле кампании — `useState` + добавь в `buildPayload()` (строки 106-122).
  - Логика отправки/расписания — `submit()` (строки 124-148); три ветки по `action`.
  - Превью — `refreshPreview()` (строки 75-93); fallback-замена при недоступности `/ads/substitute-preview` хардкодит «Анна / Анна Иванова / Клиника».
- **Подводные камни:** `patientIds` берётся из `initial` и **не редактируется** (нет сеттера, строка 41) — если переданы пациенты, селект сегмента дизейблится. `segment_id` приводится к `Number` (строка 112) — backend ждёт int. Эффект автозаполнения из шаблона (строки 64-72) заполняет title/body **только если они пусты** и имеет отключённый `exhaustive-deps` — при ручной правке шаблон не перетрёт. `scheduled_at` шлётся как ISO; в `submit('schedule')` отдельным запросом после создания, хотя `buildPayload` уже мог положить `scheduled_at` — потенциальное дублирование, проверяй backend. Аудитория-строка вычисляется на каждый рендер (строки 150-152).
- **Строк:** 323

## `frontend/src/sections/engagement/PushTemplatesModal.jsx`

- **Назначение:** Модальный каталог шаблонов push-сообщений с фильтром по категории, CRUD (через вложенный `TemplateEditor`) и кнопкой «Создать дефолтные» (seed). Источник шаблонов для `PushComposeModal`.
- **Ключевые элементы:** `export default function PushTemplatesModal({ token, onClose })` и вложенный `function TemplateEditor({ tpl, onSave, onCancel, busy })`. Константа `CATEGORIES` (9 шт.: welcome/birthday/abandonment/nps/anniversary/churn/promo/other + «Все»). Хелперы `seedDefaults`, `save(tpl)` (POST или PATCH по наличию `tpl.id`), `remove(tpl)`.
- **Эндпоинты:** потребляет:

  | Метод | Путь | Принимает | Возвращает | Назначение |
  |-------|------|-----------|------------|------------|
  | GET | `/engagement/templates[?category=]` | query category | `{items[]}` или `[]` | список с фильтром |
  | POST | `/engagement/templates/seed-defaults` | — | — | создать дефолтные шаблоны |
  | POST | `/engagement/templates` | `{title, body, category}` | template | создать |
  | PATCH | `/engagement/templates/{id}` | `{title, body, category}` | template | обновить |
  | DELETE | `/engagement/templates/{id}` | — | — | удалить |
- **Зависимости:** `API_BASE` из `../../config`. Парная модалка к `PushComposeModal` (там селект шаблонов читает то же `/engagement/templates`). `TemplateEditor` — отдельная вложенная модалка с z-index `[1010]` поверх основной `[1000]`.
- **Где менять для типовых задач:**
  - Новая категория — пункт в `CATEGORIES` (строки 17-27); фильтр в `TemplateEditor` исключает `'all'` (строка 165).
  - Поля шаблона — `TemplateEditor` (строки 149-197) + `save()` payload (строка 59).
- **Подводные камни:** использует браузерные `confirm()` (строки 48, 67) — блокирующие; в проде с кастомным дизайном выглядит чужеродно. Данные ответа гибкие: `d?.items || d || []` — backend может вернуть и `{items}`, и голый массив. `tenant_id` на бэке. Сохранение/удаление вызывают `load()` без оптимистичного апдейта — каждое действие = новый запрос.
- **Строк:** 197

## `frontend/src/sections/engagement/SegmentEditorModal.jsx`

- **Назначение:** Модальный визуальный конструктор сегмента пациентов: builder по всем ключам `filter_json` (сгруппирован), кнопка «Превью сегмента» (показывает размер + до 20 примеров), сохранение динамического или snapshot-сегмента.
- **Ключевые элементы:** `export default function SegmentEditorModal({ token, segment, initialFilter, onClose, onSaved })` + вложенные `FilterField` (рендер поля по типу) и `ChipsField` (тэги-чипы). Хелпер-фабрика `FIELD(label, hint)`. Большая декларативная константа `GROUPS` — 6 групп (регистрация / активность / логины / ДР / тэги / прочее) с типами полей `number|string|bool|chips`. Хелперы `setField(k, v)` (удаляет пустые ключи), `runPreview`, `save`.
- **Эндпоинты:** потребляет:

  | Метод | Путь | Принимает | Возвращает | Назначение |
  |-------|------|-----------|------------|------------|
  | POST | `/engagement/segments/preview` | `{ filter_json }` | `{ size/total, sample/samples[] }` | расчёт размера сегмента |
  | POST | `/engagement/segments` | `{ name, description, is_dynamic, filter_json }` | segment | создать |
  | PATCH | `/engagement/segments/{id}` | тот же payload | segment | обновить |
- **Зависимости:** `API_BASE` из `../../config`. `initialFilter` приходит из `PatientsTable` (ручной список пациентов через bulk «Сохранить сегмент»). Результат через `onSaved(segment)` попадает обратно в селект `PushComposeModal`.
- **Где менять для типовых задач:**
  - Новый критерий сегментации — добавь объект в нужную группу `GROUPS` (строки 21-63) с `key/type/label/hint`; `FilterField` отрендерит автоматически по `type`. Backend `/engagement/segments/preview` обязан понимать новый ключ `filter_json`.
  - Новый тип поля (например `select`) — добавь ветку в `FilterField` (строки 211-247).
- **Подводные камни:** ключи `filter_json` (`created_after_days`, `last_seen_after_days_ago` и т.д.) — это контракт с backend-сегментатором; имена менять синхронно с сервером. `setField` **удаляет** ключ при пустом значении (строка 79) — пустые фильтры не уходят на сервер, это ок. Превью-ответ гибкий: `preview.size ?? preview.total`, `preview.sample || preview.samples` — backend несогласован по именам, фронт прикрывает оба. `is_dynamic` по умолчанию `true` (строка 69: `!== false`). `tenant_id` на бэке.
- **Строк:** 279

## `frontend/src/sections/engagement/SuggestionsBoard.jsx`

- **Назначение:** Доска авто-подсказок для ручной работы менеджера: система генерирует «поводы» (welcome / день рождения / брошенная воронка / NPS / годовщина / отвал 30/60/90 дней), они группируются по `kind`, менеджер bulk-отправляет push, откладывает или пропускает. Anti-spam бейдж при ≥3 push за 30 дней.
- **Ключевые элементы:** `export default function SuggestionsBoard({ token, onOpenCard, onComposePush })` + вложенный `SuggestionRow`. Константы `KIND_META` (8 видов с иконкой/цветом) и `DEFAULT_META`, хелпер `fmtDateTime`. Состояние: `items`, `status` (pending/sent/dismissed/postponed/all), `selected` (Set), `collapsed` (Set свёрнутых групп). `grouped` (useMemo группировка по kind). Хелперы `bulkAction(action, payload)` (циклом POST по каждому id), `regenerate`, `composeFor(suggestion)`.
- **Эндпоинты:** потребляет:

  | Метод | Путь | Принимает | Возвращает | Назначение |
  |-------|------|-----------|------------|------------|
  | GET | `/engagement/suggestions?status=` | query status | `{items[]}` или `[]` | список подсказок |
  | POST | `/engagement/suggestions/{id}/{action}` | `{}` или payload (`{days:7}` для postpone) | — | действие над подсказкой (postpone/dismiss/…) |
  | POST | `/engagement/suggestions/regenerate` | — | — | пересоздать все подсказки |
- **Зависимости:** `API_BASE` из `../../config`. Тесно связан с `PushComposeModal` через колбэк `onComposePush({ from_suggestion, patient_ids, suggestion_ids, template_id, kind })` — поднимает родитель. `onOpenCard(patient_id)` открывает карточку пациента.
- **Где менять для типовых задач:**
  - Новый вид подсказки (`kind`) — добавь запись в `KIND_META` (строки 18-27) с label/icon/color/bg; неизвестные kind упадут в `DEFAULT_META`.
  - Новое bulk-действие — кнопка в bulk-баре (строки 151-173) → `bulkAction('newaction', payload)`; backend должен иметь `/engagement/suggestions/{id}/newaction`.
  - Anti-spam порог — условие `pushesIn30d >= 3` в `SuggestionRow` (строка 245); значение читается из `s.meta?.pushes_in_30d`.
- **Подводные камни:** `bulkAction` шлёт запросы **последовательно в цикле** (`for…await`, строки 95-99) — на больших выборках долго и нет атомарности (частичный успех при ошибке в середине). Текст/имя подсказки читаются из гибкого `s.meta` (`text || preview || body`, `patient_name`) с fallback на `ID {patient_id}` — backend несогласован. Кнопка «Отправить push» в bulk-баре (строки 154-158) НЕ вызывает `bulkAction`, а напрямую `onComposePush` с `suggestion_ids` — отправка идёт через кампанию, а не через `/suggestions/{id}/send`. `confirm()` блокирующий. `tenant_id` на бэке.
- **Строк:** 261

## `frontend/src/sections/inventory/InventorySection.jsx`

- **Назначение:** Главный wrapper модуля «Учёт инвентаря» (W7). Заголовок + `Tabs` на 4 подраздела (Каталог / Остатки / Движения / Алерты). Тонкий контейнер без бизнес-логики.
- **Ключевые элементы:** `export default function InventorySection({ token })`. Состояние `tab` (по умолчанию `'items'`), массив `tabs`. Условный рендер 4 дочерних секций.
- **Эндпоинты:** нет (контейнер).
- **Зависимости:** `Tabs` из `../../design`; четыре дочерних компонента: `InventoryItemsSection`, `InventoryStocksSection`, `InventoryMovementsSection`, `InventoryAlertsSection`. Проп `token` пробрасывается вниз, **но дочерние секции его не используют** (они берут токен из axios-инстанса `../../api`) — проп декоративный.
- **Где менять для типовых задач:** новый подраздел инвентаря — добавь объект в `tabs` (строки 25-30), импорт компонента и условную строку рендера (51-54). Гейт модуля `require_module("inventory")` — на бэке; видимость в навигации — в `AdminLayout.visibleNav` (см. комментарий в шапке файла).
- **Подводные камни:** все дочерние секции монтируются по условию `tab === …` — при переключении таба компонент размонтируется и теряет локальное состояние/фильтры (это by design). Проброс `token` создаёт ложное впечатление, что секции его читают.
- **Строк:** 57

## `frontend/src/sections/inventory/InventoryItemsSection.jsx`

- **Назначение:** Каталог складских позиций (расходники / оборудование / медикаменты / реактивы / прочее). Список с фильтром по категории, поиском и флагом активности; модалки создания/редактирования и импорта CSV. Soft-delete (архивация).
- **Ключевые элементы:** `export default function InventoryItemsSection()`. Константы `CATEGORIES` (5) + `CAT_LABEL`, `EMPTY_FORM`. Хелперы `load`, `openCreate`, `openEdit(item)`, `handleSave` (POST/PATCH), `handleDelete` (DELETE = архив), `handleImport` (multipart CSV). Состояние: `items, filterCategory, search, showActive, modalOpen, editing, form, importOpen, importFile, importResult`.
- **Эндпоинты:** потребляет (через axios `api`):

  | Метод | Путь | Принимает | Возвращает | Назначение |
  |-------|------|-----------|------------|------------|
  | GET | `/inventory/items?category=&is_active=&search=&limit=500` | query | `{items[]}` | список с фильтрами |
  | POST | `/inventory/items` | form (sku, name, category, unit, cost_per_unit, min_stock_threshold, …) | item | создать |
  | PATCH | `/inventory/items/{id}` | тот же payload | item | обновить |
  | DELETE | `/inventory/items/{id}` | — | — | soft delete (`is_active=False`) |
  | POST | `/inventory/items/import-csv` | multipart `file` | `{created, skipped, errors[]}` | массовый импорт |
- **Зависимости:** `api` из `../../api` (axios); `Card, Button, Chip, Modal, EmptyState, useToast` из `../../design`. Дочерний для `InventorySection`.
- **Где менять для типовых задач:**
  - Новая категория — пункт в `CATEGORIES` (строки 15-21); backend должен принять id.
  - Новое поле позиции — добавь в `EMPTY_FORM` (строки 24-35), в `openEdit` маппинг (строки 78-89), в `handleSave` payload (строки 95-101) и в форму-модалку (строки 246-337).
  - Формат CSV — header описан прямо в модалке импорта (строка 354); backend-парсер должен совпадать.
- **Подводные камни:** числовые поля (`cost_per_unit`, `min_stock_threshold`) хранятся и шлются как **строки** (`String(...)`, `form.cost_per_unit || '0'`) — backend ждёт Decimal-совместимую строку, НЕ float; не приводи к `Number` при отправке (иначе потеря точности Decimal). В рендере, наоборот, оборачивают в `Number(...)` для форматирования — это только отображение. `toast` вызывается двумя несовместимыми сигнатурами: `toast?.(str, 'error')` (строки 113 и др.) и `toast?.({ kind, text })` (строка 142) — несогласованность API тостов, при правках уточни актуальную сигнатуру `useToast`. `tenant_id` на бэке. Поиск применяется по Enter или ре-рендеру `load` (зависит от `search`), а не дебаунсом.
- **Строк:** 380

## `frontend/src/sections/inventory/InventoryMovementsSection.jsx`

- **Назначение:** Лента движений склада (приход/расход/перемещение/корректировка/списание/просрочка) с фильтрами (тип / клиника / позиция) и раскрывающимися строками (партия, срок, привязка, комментарий). Вложенный `ActionModal` создаёт операции четырёх видов.
- **Ключевые элементы:** `export default function InventoryMovementsSection()` + вложенный `function ActionModal({ kind, onClose, items, clinics, onDone })`. Константы `TYPE_LABEL`, `TYPE_TONE`. `itemMap`/`clinicMap` (id→объект). Внутри `ActionModal`: `titles`, `submit()` (выбирает url+body по `kind`), переиспользуемые JSX-фрагменты `ItemSelect`, `QtyInput`, `ClinicSelect(label, key)`.
- **Эндпоинты:** потребляет:

  | Метод | Путь | Принимает | Возвращает | Назначение |
  |-------|------|-----------|------------|------------|
  | GET | `/inventory/movements?type=&item_id=&clinic_id=&limit=200` | query | `{movements[]}` | лента движений |
  | GET | `/inventory/items?is_active=true&limit=500` | — | `{items[]}` | справочник позиций (для фильтра/модалки) |
  | GET | `/clinics/` | — | `{clinics[]}` или `[]` | список клиник тенанта |
  | POST | `/inventory/movements/income` | item_id, clinic_id, quantity, batch, expiry_date, vendor_invoice, comment | — | приход |
  | POST | `/inventory/movements/outgoing` | item_id, clinic_id, quantity, batch, comment | — | расход |
  | POST | `/inventory/movements/transfer` | item_id, from_clinic_id, to_clinic_id, quantity, batch, comment | — | перемещение |
  | POST | `/inventory/movements/write-off` | item_id, clinic_id, quantity, batch, reason, expired | — | списание (брак/просрочка) |
- **Зависимости:** `api` из `../../api`; `Card, Button, Chip, Modal, EmptyState, useToast` из `../../design`. Использует общий справочник `/inventory/items` и `/clinics/`.
- **Где менять для типовых задач:**
  - Новый тип движения — добавь в `TYPE_LABEL`/`TYPE_TONE` (строки 9-24) для отображения; для создания — ветку в `ActionModal.submit()` (строки 208-252) + кнопку в тулбаре (строки 97-100) + поля формы.
  - Новые поля операции (например цена прихода) — добавь в соответствующий `body` внутри `submit()` и инпут в форму.
- **Подводные камни:** ⚠️ **React-баг вёрстки:** `moves.map` возвращает `<>…</>` (Fragment) **без `key`** на самом фрагменте (строки 130-167) — ключи стоят на внутренних `<tr>`, что вызывает React-warning "each child in a list should have a unique key"; при рефакторе оберни в фрагмент с ключом `<Fragment key={m.id}>`. `quantity` шлётся как строка из инпута (Decimal-safe), в рендере оборачивается в `Number()` только для знака/форматирования. `clinics` берётся гибко (`r.data?.clinics` ИЛИ массив) — backend `/clinics/` несогласован. `m.item_id.slice(0,8)` и `m.clinic_id.slice(0,8)` предполагают строковые UUID. Загрузка справочников (items+clinics) — отдельный эффект без зависимостей (один раз при монтировании, строки 56-63). `tenant_id` на бэке.
- **Строк:** 385

## `frontend/src/sections/inventory/InventoryStocksSection.jsx`

- **Назначение:** Остатки склада по клиникам: таблица с фильтрами (клиника / только низкие / истекает в N дней), карточки клиник с топ-5 низких позиций, и мастер (3 шага) массовой инвентаризации.
- **Ключевые элементы:** `export default function InventoryStocksSection()` + вложенный `function InventoryCountWizard({ open, onClose, clinics, onDone })`. Хелперы `load`, `clinicName(id)`, вычисление `lowByClinic` (группировка низких по клинике). Wizard: шаги 1 (клиника) → 2 (ввод фактических количеств с поиском) → 3 (комментарий + submit); `filledLines` (только заполненные строки), `handleSubmit`.
- **Эндпоинты:** потребляет:

  | Метод | Путь | Принимает | Возвращает | Назначение |
  |-------|------|-----------|------------|------------|
  | GET | `/inventory/stocks?clinic_id=&low_stock=&expiring_in_days=&limit=500` | query | `{stocks[]}` | остатки |
  | GET | `/clinics/` | — | `{clinics[]}` или `[]` | список клиник |
  | GET | `/inventory/items?is_active=true&limit=500` | — | `{items[]}` | позиции для wizard |
  | POST | `/inventory/stocks/count` | `{ clinic_id, items:[{item_id, counted_qty}], comment }` | — | применить инвентаризацию |
- **Зависимости:** `api` из `../../api`; `Card, Button, Chip, Modal, EmptyState, useToast` из `../../design`. Дочерний для `InventorySection`.
- **Где менять для типовых задач:**
  - Новый фильтр остатков — `useState` + `params.append` в `load` (строки 27-31) + инпут (строки 64-83).
  - Логика «низкий остаток» — условие `Number(s.quantity) < Number(s.item_min_threshold || 0) && порог > 0` (строки 51, 138); меняй в обоих местах синхронно (карточки + таблица).
  - Шаги мастера — `InventoryCountWizard` (строки 174-331), state `step`.
- **Подводные камни:** `counted_qty` отправляется как **строка** (`String(v)`, строка 207) — Decimal-safe. Wizard грузит `/inventory/items` лениво при `step===2` и только если `items.length===0` (строки 190-196) — если каталог обновился между открытиями, данные могут устареть (но wizard сбрасывается на закрытии, строки 184-188). `clinics` опять гибко (`r.data?.clinics` ИЛИ массив). Дублирование условия «низкий остаток» — риск рассинхрона при правке. `tenant_id` на бэке.
- **Строк:** 331

## `frontend/src/sections/inventory/InventoryAlertsSection.jsx`

- **Назначение:** Сводка алертов склада: три блока — низкие остатки (красные), скоро просрочка ≤30 дней (жёлтые), просрочено (тёмно-красные). Кнопка «Создать заказ» открывает модалку-**заглушку** с prefill списком позиций к заказу.
- **Ключевые элементы:** `export default function InventoryAlertsSection()`. Состояние `data={low_stock, expiring, expired}`, `loading`, `orderOpen`. Хелпер `load`. Без вложенных компонентов.
- **Эндпоинты:** потребляет:

  | Метод | Путь | Принимает | Возвращает | Назначение |
  |-------|------|-----------|------------|------------|
  | GET | `/inventory/alerts` | — | `{ low_stock[], expiring[], expired[] }` | текущие алерты |
- **Зависимости:** `api` из `../../api`; `Card, Button, Chip, Modal, EmptyState, useToast` из `../../design`. Дочерний для `InventorySection`.
- **Где менять для типовых задач:**
  - Новый тип алерта — добавь ключ в дефолт `data` (строка 19), блок рендера (по образцу строк 84-140) и backend `/inventory/alerts` должен его вернуть.
  - Реальная заявка поставщику — модалка «Создать заказ» (строки 143-182) сейчас **заглушка** (prefill из `low_stock`, реального POST нет); здесь подключать будущее API заявок.
- **Подводные камни:** ⚠️ **Незавершённая фича:** заказ vendor'у не реализован — прямо в коде комментарий «реальное API заявок подключится во второй итерации» (строки 9-12, 174-177). `key` карточек просрочки составной (`item_id-batch-clinic_id`) — если backend вернёт дубли по этому ключу, будет коллизия. Количества оборачиваются в `Number()` только для отображения. `tenant_id` на бэке.
- **Строк:** 185

## `frontend/src/sections/loyalty/LoyaltySection.jsx`

- **Назначение:** Главный wrapper модуля «Программа лояльности» (W5). Заголовок + `Tabs` на 4 подраздела (Тиры / Правила начисления / История / Обмен баллов). Тонкий контейнер.
- **Ключевые элементы:** `export default function LoyaltySection({ token })`. Состояние `tab` (по умолчанию `'tiers'`), массив `tabs`, условный рендер дочерних секций с пробросом `token`.
- **Эндпоинты:** нет (контейнер).
- **Зависимости:** `Tabs` из `../../design`; `LoyaltyTiersSection`, `LoyaltyRulesSection`, `LoyaltyTransactionsSection`, `LoyaltyExchangeSection`. `token` пробрасывается вниз — дочерние секции принимают проп `{ token }`, но фактически используют axios `../../api` (токен берёт инстанс).
- **Где менять для типовых задач:** новый подраздел лояльности — объект в `tabs` (строки 25-30) + импорт + условная строка (52-55). Гейт `require_module("loyalty_pro")` и CTA «Подключить» обрабатываются в каждой дочерней секции (402 → баннер), а не здесь.
- **Подводные камни:** переключение таба размонтирует секцию (теряются фильтры/состояние) — by design. CTA при отсутствии подписки реализован отдельно в каждой секции, а не централизованно — при добавлении новой секции не забудь обработать 402.
- **Строк:** 59

## `frontend/src/sections/loyalty/LoyaltyTiersSection.jsx`

- **Назначение:** CRUD уровней (тиров) лояльности с цветовой палитрой по имени и показом топ-N пациентов в каждом тире (баланс/всего баллов). При отсутствии подписки — развёрнутый CTA-баннер.
- **Ключевые элементы:** `export default function LoyaltyTiersSection({ token })` + вложенный `function TierCard({ tier, onEdit, onDelete })`. Константы `TIER_PALETTE` (bronze/silver/gold/platinum/diamond) + `DEFAULT_PALETTE`, хелпер `paletteFor(name)`, `EMPTY_FORM`. Хелперы `load`, `openCreate`, `openEdit`, `submit` (POST/PATCH), `onDelete`.
- **Эндпоинты:** потребляет:

  | Метод | Путь | Принимает | Возвращает | Назначение |
  |-------|------|-----------|------------|------------|
  | GET | `/loyalty/tiers/with-top?top_n=10` | query | `[{…, patients_count, top_patients[]}]` | тиры + топ-пациенты |
  | POST | `/loyalty/tiers` | `{ name, threshold_rub, discount_percent, perks }` | tier | создать |
  | PATCH | `/loyalty/tiers/{id}` | тот же payload | tier | обновить |
  | DELETE | `/loyalty/tiers/{id}` | — | — | удалить |
- **Зависимости:** `api` из `../../api`; `useToast` из `../../design`. Локальный адаптер `apiFetch(m, url, _t, d)` (игнорирует `_t` — токен в axios). Дочерний для `LoyaltySection`.
- **Где менять для типовых задач:**
  - Новый именованный тир-цвет — запись в `TIER_PALETTE` (строки 21-27); неизвестные имена → `DEFAULT_PALETTE`.
  - Поля тира — `EMPTY_FORM` (строки 31-36), `openEdit` маппинг, `submit` payload (строки 156-161), форма-модалка (строки 257-298).
  - `perks` вводится как **JSON-строка** и парсится `JSON.parse` с try/catch (строки 152-155) — при ошибке тост и прерывание сохранения.
- **Подводные камни:** числа `threshold_rub`/`discount_percent` приводятся `Number(...)` в payload (строки 158-159) — для тиров это допустимо (пороги/проценты), но при работе с денежными суммами в других местах предпочитают Decimal-строки. 402 (Payment Required) → `needPay` → CTA-баннер с ссылкой на каталог модулей. `confirm()` при удалении предупреждает о пересчёте пациентов. `top_patients` ключуется по `pt.phone + i` (строка 76) — телефон как идентификатор. `tenant_id` на бэке.
- **Строк:** 313

## `frontend/src/sections/loyalty/LoyaltyRulesSection.jsx`

- **Назначение:** CRUD правил автоматического начисления баллов (за визит / реферала / день рождения / визит к узкому специалисту). Таблица + модалка с фиксированным бонусом или процентом, периодом действия и JSON-условиями.
- **Ключевые элементы:** `export default function LoyaltyRulesSection({ token })`. Константы `RULE_TYPES` (4) + `TYPE_LABEL`/`TYPE_ICON`, `EMPTY_FORM`. Хелперы `load`, `openCreate`, `openEdit`, `submit` (парсит `conditions` как JSON), `onDelete`.
- **Эндпоинты:** потребляет:

  | Метод | Путь | Принимает | Возвращает | Назначение |
  |-------|------|-----------|------------|------------|
  | GET | `/loyalty/rules` | — | `[rule]` | список правил |
  | POST | `/loyalty/rules` | `{ name, rule_type, bonus_amount, bonus_pct, is_active, valid_from, valid_until, conditions }` | rule | создать |
  | PATCH | `/loyalty/rules/{id}` | тот же payload | rule | обновить |
  | DELETE | `/loyalty/rules/{id}` | — | — | удалить |
- **Зависимости:** `api` из `../../api`; `useToast` из `../../design`. Локальный адаптер `apiFetch(m, url, _t, d)`. Дочерний для `LoyaltySection`.
- **Где менять для типовых задач:**
  - Новый тип правила — пункт в `RULE_TYPES` (строки 22-27); backend-движок начислений должен понимать `rule_type`; тонкая настройка — через `conditions` JSON (пример в placeholder: `{"service_ids":[1,2],"doctor_ids":[3]}`).
  - Поля правила — `EMPTY_FORM` (строки 31-40), `openEdit`, `submit` payload (строки 91-100), форма (строки 217-265).
- **Подводные камни:** `conditions` — свободный JSON, парсится `JSON.parse` с обработкой ошибки (строки 86-90); это контракт с backend-движком начислений. `bonus_amount`/`bonus_pct` приводятся `Number(...)`. `valid_from/valid_until` режутся `.slice(0,16)` для `datetime-local` и шлются как ISO (`new Date(...).toISOString()`). 402 → CTA. `tenant_id` на бэке. Семантика «бонус ИЛИ процент» не валидируется на фронте (можно задать оба) — логику приоритета держит backend.
- **Строк:** 277

## `frontend/src/sections/loyalty/LoyaltyTransactionsSection.jsx`

- **Назначение:** История начислений/списаний баллов: KPI-полоса (записей / начислено / списано), фильтры (телефон / тип операции / лимит), таблица транзакций и CSV-экспорт текущей выборки (без внешних библиотек, с BOM для Excel).
- **Ключевые элементы:** `export default function LoyaltyTransactionsSection({ token })`. Константы `OP_LABEL`, `OP_COLOR`, `OP_TYPES` (фильтр). Хелпер `toCsv(rows)` (ручная сериализация с экранированием), `load`, `exportCsv` (Blob + временная ссылка). `totals` (useMemo: earned/redeemed/count).
- **Эндпоинты:** потребляет:

  | Метод | Путь | Принимает | Возвращает | Назначение |
  |-------|------|-----------|------------|------------|
  | GET | `/loyalty/transactions?limit=&op_type=&phone=` | query | `[transaction]` | история операций |
- **Зависимости:** `api` из `../../api`; `useToast` из `../../design`. Локальный адаптер `apiFetch(m, url, _t, d)`. Дочерний для `LoyaltySection`.
- **Где менять для типовых задач:**
  - Новый тип операции — добавь в `OP_LABEL`, `OP_COLOR` (знак цвета) и `OP_TYPES` (фильтр); backend должен вернуть такой `op_type`.
  - Колонки CSV — массив `head` и строка в `toCsv` (строки 44-56); колонки таблицы — `thead`/`tbody` (строки 181-207).
  - Лимиты — `<option>` в селекте лимита (строки 153-156).
- **Подводные камни:** `totals` считает earned/redeemed по знаку `t.delta` (строки 88-96) — `delta` ожидается числовым (целые баллы, не Decimal-деньги). CSV-экспорт берёт **только загруженную выборку** (ограничена `limit`) — не весь датасет; при limit=100 экспортируется 100 строк, легко принять за полный отчёт. BOM `﻿` префикс в Blob (строка 100) — для корректной кириллицы в Excel, не удалять. 402 → CTA. Фильтр по телефону применяется по Enter или кнопке «Обновить» (зависимость `load` от `phone`). `tenant_id` на бэке.
- **Строк:** 212

## `frontend/src/sections/loyalty/LoyaltyExchangeSection.jsx`

- **Назначение:** Двухколоночный экран: слева CRUD каталога наград, справа «обменник» — оператор вводит телефон пациента, проверяет баланс/тир и обменивает баллы на выбранную награду. Самый крупный файл среза.
- **Ключевые элементы:** `export default function LoyaltyExchangeSection({ token })` + вложенный `function RewardCard({ reward, onPick, onEdit, onDelete, picked })`. Константы `REWARD_TYPES` (3: free_service/service_discount/gift) + `TYPE_LABEL`/`TYPE_ICON`, `EMPTY_FORM`. Хелперы `load`, `checkPhone` (баланс), `openCreate/openEdit`, `submit` (POST/PATCH награды), `onDelete`, `doExchange` (проверка баланса → confirm → POST).
- **Эндпоинты:** потребляет:

  | Метод | Путь | Принимает | Возвращает | Назначение |
  |-------|------|-----------|------------|------------|
  | GET | `/loyalty/rewards` | — | `[reward]` | каталог наград |
  | POST | `/loyalty/rewards` | `{ name, description, reward_type, cost_points, discount_percent, service_ref, is_active, icon, sort_order }` | reward | создать |
  | PATCH | `/loyalty/rewards/{id}` | тот же payload | reward | обновить |
  | DELETE | `/loyalty/rewards/{id}` | — | — | удалить |
  | GET | `/loyalty/account/{phone}` | path phone | `{ points_balance, tier }` | баланс/тир пациента |
  | POST | `/loyalty/exchange` | `{ phone, reward_id }` | `{ points_balance, … }` | обмен баллов на награду |
- **Зависимости:** `api` из `../../api`; `useToast` из `../../design`. Локальный адаптер `apiFetch(m, url, _t, d)`. Дочерний для `LoyaltySection`.
- **Где менять для типовых задач:**
  - Новый тип награды — пункт в `REWARD_TYPES` (строки 22-26); поля типа — `service_discount` показывает `% скидки` (строки 358-364); добавь аналогичные условные поля при необходимости.
  - Поля награды — `EMPTY_FORM` (строки 30-40), `openEdit`, `submit` payload (строки 156-166), форма-модалка (строки 333-387).
  - Логика обмена/валидации баланса — `doExchange` (строки 193-209): проверка `account.points_balance < picked.cost_points` на фронте + confirm.
- **Подводные камни:** ⚠️ Проверка достаточности баллов дублируется **на фронте** (строки 195, 309, 315) — это UX-гард, но финальное списание и атомарность — на backend (`/loyalty/exchange`); не полагайся на фронтовую проверку как на источник истины (гонка: баланс мог измениться между `checkPhone` и `doExchange`). `cost_points` приводится `Number(...)`, `discount_percent` — `null` если пусто. `account` обновляется ответом `/loyalty/exchange` (строка 203) — баланс синхронизируется без повторного `checkPhone`. Телефон URL-энкодится (строка 128). 402 → CTA. `confirm()` блокирующий. `tenant_id` на бэке.
- **Строк:** 399

---

### Сквозные замечания по срезу

1. **Два стиля HTTP-доступа.** `engagement/*` — голый `fetch` + проп `token` + `API_BASE` из `../../config`; `inventory/*` и `loyalty/*` — axios `../../api` (токен внутри инстанса) + дизайн-система `../../design`. Не смешивать.
2. **Decimal-safe строки.** В inventory количества/цены/пороги (`cost_per_unit`, `min_stock_threshold`, `quantity`, `counted_qty`) передаются на backend **строками**, чтобы не терять точность Decimal; `Number(...)` в коде встречается только для отображения. В loyalty баллы/проценты — целые/Number (деньги тиров — `threshold_rub`, тоже Number, т.к. порог, а не транзакция).
3. **`tenant_id`** нигде на фронте не фигурирует — мультитенантная изоляция целиком на backend через токен; фронт шлёт только JWT.
4. **Известные дефекты:** отсутствующий `key` на Fragment в `InventoryMovementsSection` (React-warning); незавершённая «заявка поставщику» в `InventoryAlertsSection`; последовательный (не batch) bulk в `SuggestionsBoard`; несогласованная сигнатура `toast` в `InventoryItemsSection`.
5. **Гейты модулей:** inventory → `require_module("inventory")`, loyalty → `require_module("loyalty_pro")` (402 → CTA-баннеры в каждой loyalty-секции). Видимость в навигации — `AdminLayout.visibleNav`.
