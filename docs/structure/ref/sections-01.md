# sections [01] — AI-аналитика, агрегаторы/лаборатории/лояльность/wellness (админ-CRUD), акты, реклама, API-ключи

Это первые 15 файлов (по алфавиту) из `frontend/src/sections/` — корневой папки «секций» React-кабинетов МИС «КлиникСеть». Каждый файл — это самодостаточный экран (раздел), который встраивается в один из кабинетов-«шеллов» (`AdminLayout`, `FranchiseOwnerCabinet`, `_ManagerShell`, личный кабинет тенанта). Это **чистый фронтенд**: ни один файл не лезет в БД напрямую — всё через REST-эндпоинты бэкенда FastAPI.

Сразу видны **две архитектурные школы**, сосуществующие в проекте:
- **Новая «admin/Глава-10» школа** (`AdminAggregator*`, `AdminLab*`, `AdminLoyalty*`, `AdminWellness*`, `AdminSystemStatus`, `AiAssistant`): используют единый axios-клиент `../api` (токен подставляется автоматически из localStorage), дизайн-систему `../design` (`useToast`, `useConfirm`, `Modal`, `Button`, `Card`), Tailwind-классы, гейтинг платных модулей через HTTP **402** → блок «модуль не подключён».
- **Старая «token-prop» школа** (`AISection`, `AIAnalyticsSection`, `AdsSection`): получают `token` пропом, вызывают `fetch()` напрямую через локальный хелпер `apiFetch(token, path)` поверх `API_BASE` из `../config`, верстают **inline-стилями** (объекты `style={{}}`), сами рисуют SVG-графики и генерируют HTML для печати/экспорта.

Поэтому при правках сначала определите, к какой школе относится файл — это диктует и способ запроса, и способ оформления.

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `AIAnalyticsSection.jsx` | AI-аналитика (светлая тема): 10 сценариев + Q&A + история | 453 |
| `AIKnowledgeSection.jsx` | База знаний FAQ для AI-ассистента (CRUD + импорт) | 425 |
| `AISection.jsx` | AI-аналитика v5 (dark/light): анализ, чат, история, настройки, экспорт | 1076 |
| `ActPrintModal.jsx` | Печать межклинического акта A4 (window.print) | 275 |
| `ActsSection.jsx` | Реестр актов оказанных услуг: генерация, подпись, оплата, PDF | 218 |
| `AdminAggregatorPartnershipsSection.jsx` | CRUD партнёрств-агрегаторов + выдача api-key один раз | 218 |
| `AdminAggregatorSection.jsx` | Заявки (лиды) от агрегаторов + статистика, 2 вкладки | 453 |
| `AdminLabProvidersSection.jsx` | CRUD провайдеров лабораторий + test-connection | 350 |
| `AdminLoyaltySection.jsx` | Лояльность: награды, лидерборд, claims, ручная корректировка | 778 |
| `AdminSystemStatusSection.jsx` | Мониторинг здоровья системы + disaster-mode (super_admin) | 272 |
| `AdminWellnessSection.jsx` | CRUD wellness-партнёров + аналитика кликов | 462 |
| `AdsSection.jsx` | Реклама-баннеры: конструктор, превью, статистика, A/B, AI-генерация | 2644 |
| `AiAssistantSection.jsx` | Диалоги пациентов с AI-ассистентом (просмотр + взять в работу) | 240 |
| `ApiKeysSection.jsx` | API-ключи тенанта для CRM/BI (scopes, raw-key один раз) | 517 |
| `AppointmentsCalendarSection.jsx` | Тонкая обёртка над WeekScheduleSection | 9 |

---

## `frontend/src/sections/AIAnalyticsSection.jsx`
- **Назначение:** Экран AI-аналитики в светлой теме: сетка карточек из 10 типов анализа, вкладка свободного вопроса («Спросить AI») и история. Похож на упрощённую версию `AISection.jsx` — фактически их функционал дублируется (см. подводные камни).
- **Ключевые элементы:** дефолт-экспорт `AIAnalyticsSection({ token })`; внутренние компоненты `MarkdownResult` (рендер markdown в div-ы), `AnalysisCard` (одна карточка-сценарий), `AskTab`, `HistoryTab`; константа `ANALYSIS_TYPES` (10 сценариев с key/title/icon/desc); хелпер `formatDate`. Состояние результатов кэшируется в `results` (по key) и прокидывается в карточки.
- **Эндпоинты (это клиент, не роутер — список вызовов):**

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/clinika/api/ai/analyze?type=&days=` | query type, days | `{ result, model, generated_at, days }` | Запустить один сценарий анализа |
| POST | `/clinika/api/ai/ask` | `{ question, days }` | `{ answer, model, generated_at, question }` | Свободный вопрос к AI |
| GET | `/clinika/api/ai/history` | — | `{ history: [...] }` | История анализов |

- **Зависимости:** только React (`useState/useEffect/useCallback`). Никаких внутренних модулей — даже `API_BASE` не используется, путь зашит как `/clinika/api/...` (отличие от `AISection`, где `API_BASE`).
- **Где менять для типовых задач:** добавить новый тип анализа — в массив `ANALYSIS_TYPES` (key должен совпадать с тем, что понимает бэкенд `/ai/analyze`). Поменять оформление результата — в `MarkdownResult`. Кнопка «Запустить все» — `runAll` в корневом компоненте (последовательный обход с задержкой 500мс).
- **Подводные камни:** **дубликат функционала** `AISection.jsx` (тот же набор `ANALYSIS_TYPES`, те же эндпоинты `/ai/...`). Различия: тут жёстко `/clinika/api/ai/...`, светлая тема, нет вкладки «Настройки», нет баланса и экспорта. Перед правкой уточните, какой из двух экранов реально подключён в роутинге — возможно, этот легаси.
- **Строк:** 453

## `frontend/src/sections/AIKnowledgeSection.jsx`
- **Назначение:** CRUD-управление базой знаний (FAQ) для AI-ассистента пациентов. Перед обращением к LLM `patient_chat_ai` сначала ищет ответ здесь — экономит токены. Используется в `AdminLayout` (super_admin) и `FranchiseOwnerCabinet`.
- **Ключевые элементы:** дефолт-экспорт `AIKnowledgeSection({ token })`; `EntryForm` (форма создания/редактирования), `EntryCard` (карточка записи); `truncate`. Состояние: `items`, `search`+`debounced` (debounce 300мс), `editing` (null|'new'|object), `stats`, импорт через скрытый `<input type=file>`.
- **Эндпоинты (клиент):**

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/ai/knowledge?limit=&q=` | query limit, q | массив записей | Список FAQ с поиском |
| GET | `/ai/knowledge/stats?limit=5` | — | `{ total_hits, estimated_tokens_saved }` | Статистика экономии |
| POST | `/ai/knowledge` | form (question, answer, keywords, priority, is_active) | запись | Создать |
| PATCH | `/ai/knowledge/{id}` | form | запись | Обновить |
| DELETE | `/ai/knowledge/{id}` | — | — | Удалить |
| POST | `/ai/knowledge/import` | multipart `file` (.csv/.json) | `{ imported, received }` | Импорт |

- **Зависимости:** `../api` (axios-клиент), `../design` (`useToast`, `useConfirm`/`ConfirmHost`). Material Symbols для иконок.
- **Где менять для типовых задач:** поля записи — в `EntryForm` (initial-state и `set`). Формат строки/карточки — в `EntryCard`. Лимит загрузки — `params.limit = 200` в `load`. Принимаемые форматы импорта — `accept=".csv,.json"`.
- **Подводные камни:** запись с `tenant_id == null` — «платформенная» (общая для всех тенантов), помечается бейджем «Платформа»; её редактирование/удаление за обычного тенанта может быть запрещено бэкендом. `is_active`/`active` и `cost`/`priority` — следите за именами полей при PATCH. Стат «Записей» берётся из `items.length`, а не из stats (может расходиться при пагинации).
- **Строк:** 425

## `frontend/src/sections/AISection.jsx`
- **Назначение:** Полноценный экран AI-аналитики v5: тёмная/светлая темы (через `MutationObserver` на `documentElement.class`), баланс провайдера в реальном времени, 4 вкладки (Аналитика, Q&A-чат, История, Настройки), экспорт результата в **PDF (с SVG-диаграммами), Excel (.xls через HTML), .txt**. Самый крупный и «богатый» из AI-экранов.
- **Ключевые элементы:** дефолт-экспорт `AISection({ token, isSuperAdmin })`. Большой набор внутренних компонентов: `AnalyticsTab`, `QATab`, `HistoryTab`, `SettingsTab` (только super_admin), `AnalysisCard`, `BalanceBar`, `ExportButtons`, `AIText`/`renderInline` (markdown→React), `Spinner`, `ErrBanner`, `PeriodPill`. Утилиты-генераторы: `donutSVG`, `barSVG`, `aiToHtml`, `exportPDF`, `exportExcel`. Контекст темы `DarkCtx`+`useD`, палитра `P(dark)`. Хелпер `apiFetch(token, path)` поверх `API_BASE`.
- **Эндпоинты (клиент):**

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/ai/analyze?type=&days=` | query | `{ title, result, stats, model, generated_at, type }`; **501** = не настроен | Сценарий анализа |
| POST | `/ai/ask` | `{ question, days }` | `{ answer, model, generated_at }`; **501** | Q&A-чат |
| GET | `/ai/history` | — | `{ history: [...] }` | История |
| GET | `/ai/balance` | — | `{ available, balance, unit, today:{requests, actual_cost, total_tokens} }` | Баланс провайдера |
| GET | `/ai/models` | — | `{ provider, selected, models:[{id,name,context,output}] }` | Список моделей |
| GET | `/ai/config` | — | `{ config }` | Текущий конфиг (super_admin) |
| POST | `/ai/config` | `{ config, selected_model }` | — | Сохранить конфиг провайдера |

- **Зависимости:** `../config` (`API_BASE`). Material Symbols. Никакой дизайн-системы — всё inline-стилями.
- **Где менять для типовых задач:** добавить тип анализа — массив `ANALYSIS_TYPES` (тут поля type/icon/label/color/desc). Поменять цвета/тему — палитра `P(d)`. Вёрстка PDF-отчёта — функция `exportPDF` (там же `donutSVG`/`barSVG`). Excel — `exportExcel`. Конфиг провайдера (формат `opencode.ai`, `provider.openai.options.{baseURL,apiKey}`) — `SettingsTab`. Баланс обновляется каждые 5 минут (`setInterval` в `BalanceBar`).
- **Подводные камни:** **HTTP 501** = «AI не настроен» — обрабатывается отдельно (`setNotCfg`), не как ошибка; не сломайте это при рефакторинге обработки ответов. Вкладка «Настройки» скрыта без `isSuperAdmin`. Excel-экспорт — это не настоящий xlsx, а HTML с MSO-разметкой + BOM (`﻿`); открывается Excel'ем, но хрупок. PDF открывает popup `window.open` — может блокироваться браузером. **Дубль с `AIAnalyticsSection.jsx`** — функционально пересекаются.
- **Строк:** 1076

## `frontend/src/sections/ActPrintModal.jsx`
- **Назначение:** Модальное окно предпросмотра и печати межклинического счёта/акта в формате A4. Загружает данные акта по `invoiceId`, рисует документ (стороны, таблица услуг, сумма прописью, подписи, печать) и печатает через отдельное окно `window.open` + `window.print()`.
- **Ключевые элементы:** дефолт-экспорт `ActPrintModal({ invoiceId, token, onClose })`. Хелперы `fmt` (форматирование суммы), **`rubles(n)`** — сумма прописью на русском (склонение рублей/копеек, тысячи). Константа `TYPE_LABEL` (типы инвойса: referral_bonus, manual, royalty, correction). `handlePrint` собирает HTML с inline-CSS и `@media print` (A4 portrait, Times New Roman).
- **Эндпоинты (клиент):**

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/clinic-invoices/{invoiceId}/act` | — | `{ invoice, issuer, recipient }` | Данные акта (стороны + реквизиты) |

- **Зависимости:** `../config` (`API_BASE`). React-хуки. `printRef` (innerHTML забирается для печати). Esc закрывает (слушатель keydown).
- **Где менять для типовых задач:** разметка/реквизиты сторон — массив в блоке «Стороны» (ИНН/КПП/ОГРН/банк). Колонки таблицы услуг — заголовки `['№','Наименование услуги',...]`. Текст «услуги выполнены полностью» — статичный абзац. Стили печати — большой шаблон в `handlePrint`. Печать использует поля `issuer.stamp_url`, `signer_pos`, `signer_name` — добавляйте новые реквизиты там и в превью одновременно (дублируется в двух местах: preview-div и printable HTML).
- **Подводные камни:** **двойная вёрстка** — превью (JSX) и печатная версия (строковый HTML в `handlePrint`) описаны отдельно; правьте обе. Кол-во услуг жёстко = 1 строка (вся сумма одной позицией) — нет разбивки по позициям. `setTimeout(..., 400)` перед `win.print()` — хрупко, печать может стартовать до прогрузки картинки печати. Сумма прописью `rubles()` написана вручную — для крупных сумм (>миллион) логика тысяч может округлять/ломаться, протестируйте граничные значения.
- **Строк:** 275

## `frontend/src/sections/ActsSection.jsx`
- **Назначение:** Реестр актов оказанных услуг (по юрлицам/периодам): фильтр по статусу, генерация акта за месяц, ручная и электронная подпись, регистрация оплаты (super_admin), скачивание PDF.
- **Ключевые элементы:** дефолт-экспорт `ActsSection({ token, isSuperAdmin })`. Константа `STATUS_LABELS` (draft/generated/sent/signed/paid/overdue + цвета). Функции `load`, `generateAct`, `signAct` (через модалку с ФИО), `payAct`, `downloadPdf` (blob → `<a download>`), `signElectronic`. Объект `styles` (inline-стили внизу).
- **Эндпоинты (клиент):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/acts/?act_status=` | все | query фильтр | массив актов | Список актов |
| POST | `/acts/generate` | все | `{ year, month }` | акт | Сформировать акт за период |
| POST | `/acts/{act_number}/sign` | все | `{ signer_name }` | — | Подписать (ФИО) |
| POST | `/acts/{act_number}/pay` | super_admin | `{ amount }` | — | Отметить оплаченным |
| GET | `/acts/{id|act_number}/pdf` | все | responseType blob | PDF | Скачать PDF |
| POST | `/acts/{id|act_number}/sign-electronic` | все | `{}` | — | Электронная подпись (упрощённая) |

- **Зависимости:** `../api` (axios), `../design` (`useConfirm`/`ConfirmHost`). Сообщения через локальный `msg`-стейт (не toast).
- **Где менять для типовых задач:** статусы и их цвета — `STATUS_LABELS`. Условия показа кнопок: «Подписать» при `['generated','sent']`, «Оплачен» при `signed && isSuperAdmin`. Имя скачиваемого файла — в `downloadPdf` (`act_${act_number}.pdf`).
- **Подводные камни:** **легаси-маркер** — электронная подпись помечена `TODO: реальная ЭЦП` (сейчас «простая», без КЭП). Идентификатор акта непоследователен: где-то `act_number`, где-то `id` (PDF/sign-electronic используют `a.id || a.act_number`) — при изменении бэка согласуйте. Сообщения исчезают по `setTimeout` (3-4 сек). `react` импортируется явно (`import React`), хотя в большинстве файлов школы не нужен.
- **Строк:** 218

## `frontend/src/sections/AdminAggregatorPartnershipsSection.jsx`
- **Назначение:** CRUD партнёрств с агрегаторами-лидогенераторами (DocDoc, ПроДокторов, Яндекс.Здоровье и т.п.). Создание выдаёт plaintext `api_key` **один раз** — показывается в отдельной модалке, потом забывается (бэк хранит хеш). Используется в `FranchiseOwnerCabinet` (super_admin/franchise_owner).
- **Ключевые элементы:** дефолт-экспорт `AdminAggregatorPartnershipsSection()` (без пропов — токен из axios). Хелперы `fmtDate`, `moduleOffBlock`. Состояния: `items`, `editing`, `creating`, `issuedKey` (для показа ключа). `onSaved` ловит `createResult.api_key`.
- **Эндпоинты (клиент):**

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/admin/aggregator/partnerships` | — | массив | Список партнёрств |
| POST | `/admin/aggregator/partnerships` | `{ partner_name, commission_pct }` | `{ id, api_key (plaintext!), ... }` | Создать (выдаёт ключ) |
| PATCH | `/admin/aggregator/partnerships/{id}` | `{ commission_pct, status }` | — | Обновить |
| DELETE | `/admin/aggregator/partnerships/{id}` | — | — | Удалить |

- **Зависимости:** `../api`, `../design` (`useToast`), `../components/aggregator/PartnershipModal`, `../components/aggregator/ApiKeyDisplayModal`.
- **Где менять для типовых задач:** форма создания/редактирования — в `PartnershipModal` (отдельный компонент). Показ ключа — `ApiKeyDisplayModal`. Колонки таблицы — JSX `<thead>`. Гейтинг модуля `aggregator_integration` — реакция на 402 в `load` (`setError('module_off')`).
- **Подводные камни:** **402 = модуль не подключён** (`aggregator_integration`) → `moduleOffBlock`; не путайте с 403. Удаление через нативный `confirm()` (не `useConfirm` из design — несогласованность с другими секциями). `api_key` показывается только при создании — если потеряли, надо пересоздавать.
- **Строк:** 218

## `frontend/src/sections/AdminAggregatorSection.jsx`
- **Назначение:** Работа с заявками (лидами), которые агрегаторы передают через API: список с фильтрами и workflow-кнопками + вкладка статистики (KPI, разбивка по статусам и партнёрам). Используется в `_ManagerShell → ManagerAggregator` (manager) и в `FranchiseOwnerCabinet`.
- **Ключевые элементы:** дефолт-экспорт `AdminAggregatorSection()` (таб-переключатель leads/stats). Внутренние `LeadsTab`, `StatsTab`, `KpiCard`, `moduleOffBlock`. Константа `STATUS_OPTIONS`. Локальная фильтрация поиском (`filteredLeads` через `useMemo`), уникальные партнёры из лидов.
- **Эндпоинты (клиент):**

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/admin/aggregator/leads?status=&partner=` | query | массив лидов | Список заявок |
| PATCH | `/admin/aggregator/leads/{id}/status` | `{ status, appointment_id?, commission_amount? }` | — | Сменить статус по workflow |
| GET | `/admin/aggregator/stats?period=30d` | query period (7d/30d/90d) | `{ leads_count, conversion_pct, total_commission, leads_by_status, leads_by_partner }` | Статистика |

- **Зависимости:** `../api`, `../design` (`useToast`), `../components/aggregator/LeadCard` (карточка лида с кнопками действий).
- **Где менять для типовых задач:** workflow статусов (`received→contacted→scheduled→completed|lost`) — в `LeadCard` и в `STATUS_OPTIONS`. Поля поиска (телефон/ФИО/услуга) — `filteredLeads`. KPI-плитки — в `StatsTab` (`KpiCard`). Периоды — массив в селекторе периода.
- **Подводные камни:** 402 → `moduleOffBlock` (модуль `aggregator_integration`). Фильтр по статусу/партнёру — серверный (в query), поиск — клиентский (по уже загруженным лидам); комбинируются. `commission_amount` передаётся только если `!== undefined` (0 — валиден).
- **Строк:** 453

## `frontend/src/sections/AdminLabProvidersSection.jsx`
- **Назначение:** CRUD провайдеров лабораторий (Invitro, KDL, Hemotest, Helix...) с тестом подключения. API-ключ лаборатории — write-only (маскируется при чтении, не перезаписывается пустым значением). Используется в `_ManagerShell → ManagerLab` (manager).
- **Ключевые элементы:** дефолт-экспорт `AdminLabProvidersSection()`. `ProviderModal` (форма + сабмит), `Field` (обёртка label+children), `EmptyProviderForm`, `moduleOffBlock`. Константа `PROVIDER_TYPES`. Загружает список клиник через `/manager/clinics-accessible` для выбора `default_clinic_id`.
- **Эндпоинты (клиент):**

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/admin/lab/providers` | — | массив | Список провайдеров |
| POST | `/admin/lab/providers` | `{ name, provider_type, api_url, api_key, default_clinic_id, active }` | провайдер | Создать (ключ обязателен) |
| PATCH | `/admin/lab/providers/{id}` | то же, `api_key` опционально | — | Обновить |
| DELETE | `/admin/lab/providers/{id}` | — | — | Удалить |
| POST | `/admin/lab/providers/{id}/test-connection` | — | `{ ok, latency_ms, message }` | Проверить связь |
| GET | `/manager/clinics-accessible` | — | массив клиник | Для селектора клиники |

- **Зависимости:** `../api`, `../design` (`useToast`, `Modal`, `Button`).
- **Где менять для типовых задач:** список типов лабораторий — `PROVIDER_TYPES`. Поля провайдера — `EmptyProviderForm` + `ProviderModal`. Логика «не перезаписывать пустой ключ» — в `submit` (`if (form.api_key) payload.api_key = ...`).
- **Подводные камни:** 402 → `moduleOffBlock` (`lab_integration`). При редактировании `api_key` всегда сбрасывается в `''` (чтобы не показывать сохранённый) — пустое поле = «не менять». При создании пустой ключ блокируется отдельной проверкой. Нативный `confirm()` на удаление (несогласованность с design-system).
- **Строк:** 350

## `frontend/src/sections/AdminLoyaltySection.jsx`
- **Назначение:** Управление программой лояльности (4 вкладки): каталог наград (CRUD), лидерборд топ-пациентов, запросы на награды (claims с approve/deliver/cancel), ручная корректировка баллов. Используется в `_ManagerShell` и `FranchiseOwnerCabinet`. **Не путать** с другим `LoyaltySection`, который настраивает тиры/правила через `/loyalty/*`.
- **Ключевые элементы:** дефолт-экспорт `AdminLoyaltySection({ token })` (token принят для совместимости, **реально не используется** — axios берёт admin-токен сам). Вкладки: `RewardsTab`, `LeaderboardTab`, `ClaimsTab`, `ManualAdjustTab`; модалка `RewardFormModal`; `moduleOffBlock`. Использует `../components/loyalty/TierBadge`.
- **Эндпоинты (клиент):**

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/admin/loyalty/rewards` | — | массив наград | Каталог |
| POST | `/admin/loyalty/rewards` | `{ name, description, cost_points, min_tier, stock, is_active }` | — | Создать награду |
| PATCH | `/admin/loyalty/rewards/{id}` | то же | — | Обновить |
| DELETE | `/admin/loyalty/rewards/{id}` | — | — | Удалить |
| GET | `/admin/loyalty/leaderboard` | — | `[{ patient_id, full_name, points, tier }]` | Топ пациентов |
| GET | `/admin/loyalty/claims?status=` | query | claims | Запросы наград |
| PATCH | `/admin/loyalty/claims/{id}/status` | `{ status }` | — | Сменить статус claim |
| POST | `/admin/loyalty/manual-adjust` | `{ patient_id, delta, reason, note }` | — | Корректировка баллов |

- **Зависимости:** `../api`, `../design` (`useToast`), `../components/loyalty/TierBadge`.
- **Где менять для типовых задач:** поля награды — `RewardFormModal`. Статусы claim (`requested/approved/delivered/cancelled`) и кнопки workflow — `ClaimsTab` (`STATUS_LABEL`, `FILTERS`). Причины корректировки — `<select>` в `ManualAdjustTab`. Тиры (bronze/silver/gold/platinum) — `min_tier` опции.
- **Подводные камни:** **рассогласование имён полей backend↔frontend** — бэк требует `cost_points`/`is_active`, а initial из GET может отдавать оба варианта (`points_cost`/`active`); в `submit` есть hotfix-маппинг — НЕ упрощайте его бездумно. `min_tier` при отправке всегда дефолтит в `'bronze'` если пусто. `patient_id` НЕ приводить к Number (может быть UUID или телефон — `String(...).trim()`). 402 → `moduleOffBlock` (`loyalty_pro`). Нативный `confirm()` на удаление.
- **Строк:** 778

## `frontend/src/sections/AdminSystemStatusSection.jsx`
- **Назначение:** Мониторинг здоровья платформы (БД, Redis, диск, подписки, uptime, error rate, последняя миграция, окружение) с автообновлением каждые 30 сек + переключатель disaster-mode. Только super_admin, в `FranchiseOwnerCabinet`.
- **Ключевые элементы:** дефолт-экспорт `AdminSystemStatusSection()`. Хелперы `fmtUptime`, `fmtTime`. Использует `../components/system/HealthCard` и `DisasterModeToggle`. `intervalRef` хранит таймер автообновления (silent-режим), `load(silent)`.
- **Эндпоинты (клиент):**

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/health/detailed` | — | `{ db, redis, disk:{usage_pct,free_gb}, last_migration, active_subscriptions_count, recent_error_rate, uptime_seconds, environment }` | Метрики здоровья |
| GET | `/admin/system/status` | — | `{ disaster_mode:{enabled, enabled_at, reason}, recent_events? }` | Статус + disaster |
| POST | `/admin/system/enable-disaster-mode` | `{ reason }` | — | Включить (внутри DisasterModeToggle) |
| POST | `/admin/system/disable-disaster-mode` | — | — | Выключить |

- **Зависимости:** `../api`, `../components/system/HealthCard`, `../components/system/DisasterModeToggle`.
- **Где менять для типовых задач:** набор плиток здоровья — массив `<HealthCard>` в основном блоке. Интервал автообновления — `REFRESH_MS = 30_000`. Disaster on/off-логика — в компоненте `DisasterModeToggle`. Лог последних событий — блок `recentEvents` (если бэк отдаёт `recent_events`).
- **Подводные камни:** оба запроса обёрнуты в `.catch(e => ({error:e}))` — ошибка одного не валит другой; `error='load'` только если упали оба. БД/Redis статусы читаются как `health.db?.status === 'ok'` (не latency) — следите за схемой ответа `/health/detailed`. Таймер обязательно чистится в `useEffect` cleanup. `last_migration` обрезается до 14 символов.
- **Строк:** 272

## `frontend/src/sections/AdminWellnessSection.jsx`
- **Назначение:** CRUD wellness-партнёров (фитнес, спа и т.п. — скидки/промокоды для пациентов) + агрегированная аналитика кликов/уникальных. Сортировка по `sort_order`. Только super_admin, в `FranchiseOwnerCabinet`.
- **Ключевые элементы:** дефолт-экспорт `AdminWellnessSection()`. `PartnerModal` (форма), `Field`, `KpiBox`, `moduleOffBlock`. Константы `PLAN_OPTIONS`, `EMPTY_PARTNER`. Использует `../components/wellness/CategoryTabs` + экспорт `WELLNESS_CATEGORIES`. Аналитика грузится **параллельно best-effort** на каждого партнёра.
- **Эндпоинты (клиент):**

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/admin/wellness/partners` | — | массив | Список партнёров |
| POST | `/admin/wellness/partners` | партнёр (name, category, discount_text, promo_code, link_url, logo_url, min_subscription_plan, active, sort_order) | — | Создать |
| PATCH | `/admin/wellness/partners/{id}` | то же / `{ active }` | — | Обновить / toggle |
| DELETE | `/admin/wellness/partners/{id}` | — | — | Удалить |
| GET | `/admin/wellness/analytics?partner_id={id}` | query | `{ total_clicks, unique_users, conversion }` | Аналитика по партнёру |

- **Зависимости:** `../api`, `../design` (`useToast`, `Modal`, `Button`), `../components/wellness/CategoryTabs` (+ `WELLNESS_CATEGORIES`).
- **Где менять для типовых задач:** поля партнёра — `EMPTY_PARTNER` + `PartnerModal`. Категории — в `CategoryTabs`/`WELLNESS_CATEGORIES` (общий модуль). Планы подписки (health/health_plus/premium) — `PLAN_OPTIONS`. Toggle активности — `toggleActive` (PATCH `{active}`). KPI-агрегаты сверху — `totalClicks`/`totalUniqueUsers` (useMemo по `analytics`).
- **Подводные камни:** 402 → `moduleOffBlock` (`wellness_partners`). Аналитика подгружается **N+1 запросами** (по запросу на партнёра в `Promise.all`) — при большом числе партнёров это нагрузка; ошибки отдельных аналитик глотаются. Сортировка по `sort_order` делается на клиенте после загрузки. Нативный `confirm()` на удаление.
- **Строк:** 462

## `frontend/src/sections/AdsSection.jsx`
- **Назначение:** Самый большой файл блока (2644 строки) — полноценный конструктор рекламных баннеров для личного кабинета пациента: создание/редактирование с live-превью «в телефоне», расписание показов по дням/часам, аудитория/частота/бюджет (pro-модуль `adspro01`), AI-генерация текстов (Claude через `/ads/ai-generate`), drag-and-drop сортировка, дубликат, A/B-варианты, шаблоны, статистика (overview/funnel/heatmap/conversions/forecast), сравнение, CSV/PDF-отчёт, модерация (approve/reject).
- **Ключевые элементы:** дефолт-экспорт `AdsSection({ token })` (с ~25 useState). Множество внутренних компонентов: `LivePreview`, `BannerPreview`, `Modal`, `MiniChart` (SVG), `StatsModal` + вкладки `StatsTab{Overview,Funnel,Heatmap,Conversions,Forecast}`, `ScheduleEditorV2`, `AiSuggestButton`, `FormatToolbar`, `EmojiPicker`, `CharCount`, `Badge`, `StatCard`, `ProgressBar`. Хелперы: `apiFetch`, `decodeJwt` (роль для UI-прав модерации), WCAG-контраст (`relLum`, `wcagContrast`), `legacyToV2` (миграция старого формата расписания). Константы: `EMPTY_FORM`, `COLOR_THEMES`, `AD_CATEGORIES`, `CTA_PRESETS`, `EMOJI_LIBRARY`, `ALLOWED_VARS`, `STATUS_LABELS/COLORS`.
- **Эндпоинты (клиент, основные):**

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/ads?status=` / `/ads/by-tags?tags=` | query | массив объявлений | Список (с фильтром) |
| PATCH | `/ads/{id}` | payload / `{status}` | — | Редактировать / сменить статус |
| DELETE | `/ads/{id}` | — | — | Удалить |
| POST | `/ads/{id}/duplicate` | — | — | Дубликат |
| POST | `/ads/{id}/variant` | payload | — | A/B-вариант |
| POST | `/ads/{id}/declare-winner` | — | — | Выбрать победителя A/B |
| POST | `/ads/{id}/use-template` | — | — | Создать из шаблона |
| POST | `/ads/{id}/approve` / `/reject` | `{}` / `{note}` | — | Модерация (director+) |
| POST | `/ads/{id}/share` | — | ссылка | Поделиться превью |
| GET | `/ads/{id}/stats?days=` | query | `{ totals, series }` | Статистика |
| GET | `/ads/{id}/funnel\|heatmap\|conversions\|forecast` | query | данные вкладок | Аналитика |
| GET | `/ads/compare?ids=&metric=&days=` | query | сравнение | Multi-line чарт |
| GET | `/ads/stock-search?q=` | query | картинки | Поиск стоковых изображений |
| POST | `/ads/ai-generate` | `{ prompt, kind, count }` | `{ variants }` | AI-тексты (Claude) |

- **Зависимости:** `../config` (`API_BASE`), `./ImageCropEditor` (кроп загруженной картинки), `../AdReport` (`generateAdReport` — PDF-отчёт).
- **Где менять для типовых задач:** поля объявления — `EMPTY_FORM` + форма в `AdsSection`/`openEdit`. Цветовые темы — `COLOR_THEMES` (+ `THEME_BG_HEX` для контраста). Категории/CTA/эмодзи — соответствующие константы. Расписание — `ScheduleEditorV2` (формат v2 `days_config`), миграция старого формата — `legacyToV2`. Права на модерацию — `canApprove`/`userRole` (`decodeJwt`). Вкладки статистики — `StatsTabBar` + соответствующие `StatsTab*`. AI-генерация — `AiSuggestButton`.
- **Подводные камни:** **JWT декодируется на клиенте** (`decodeJwt`) только для UI-показа кнопок — это НЕ безопасность, реальная проверка прав на бэке. **Два формата расписания** (legacy `{days,hours}` и v2 `days_config`) сосуществуют — `legacyToV2` конвертирует, поля legacy сохранены «для совместимости». Токен в `AiSuggestButton.gen` берётся из `localStorage` по ключу с `window.location.pathname` (не из пропа `token`!) — хрупко. `Modal` определён **локально** (не из design-system) и вынесен за компонент специально, чтобы не терять фокус инпутов при ререндере (есть комментарий). Контраст текста проверяется по WCAG — баннер с ratio < 4.5 даёт предупреждение. Очень крупный файл — изменения локализуйте по компонентам.
- **Строк:** 2644

## `frontend/src/sections/AiAssistantSection.jsx`
- **Назначение:** Админ-просмотр диалогов пациентов с AI-ассистентом: список бесед (фильтр по статусу/телефону), в модалке — полная история сообщений; кнопка «Взять в работу» (эскалация на оператора).
- **Ключевые элементы:** дефолт-экспорт `AiAssistantSection({ token })`. `StatusChip`, `formatDate`. Константа `STATUSES`. **Использует `axios` напрямую** (не общий `../api`!) с ручным заголовком `Authorization`.
- **Эндпоинты (клиент):**

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/admin/ai/conversations?days=60&status=&phone=` | query | `{ items, total }` | Список диалогов |
| GET | `/admin/ai/conversations/{id}/messages` | — | `{ messages }` | История сообщений |
| POST | `/admin/ai/conversations/{id}/take` | `{}` | — | Взять в работу (эскалация) |

- **Зависимости:** `axios` (напрямую), `../config` (`API_BASE`), `../design` (`Card`, `Button`, `Chip`, `Modal`, `EmptyState`).
- **Где менять для типовых задач:** статусы диалогов (active/escalated/resolved/closed) — `STATUSES` + `StatusChip`. Окно в днях — `params.days = 60`. Рендер сообщений (роли user/assistant/system, флаг escalated) — в модалке. Поиск по телефону — `phone`-стейт + Enter/кнопка «Найти».
- **Подводные камни:** **прямой `axios`** вместо общего клиента `../api` — токен и базовый URL подставляются вручную (несогласованность; при смене auth-схемы этот файл легко забыть). 402 → текст «модуль ai_assistant не подключён», 403 → «нет прав». Кнопка «Взять в работу» использует нативный `alert()` на ошибку. `useEffect(load, [statusFilter])` — поиск по телефону не триггерит автозагрузку (только Enter/кнопка).
- **Строк:** 240

## `frontend/src/sections/ApiKeysSection.jsx`
- **Назначение:** Управление API-ключами тенанта для внешних интеграций (CRM/BI). Ключ генерируется на бэке и показывается raw **один раз** (в БД — sha256-хэш + префикс). Включает встроенную раскрывающуюся документацию API (curl, scopes, rate-limit, webhooks).
- **Ключевые элементы:** дефолт-экспорт `ApiKeysSection({ token })`. `CopyButton` (копирование в буфер + fallback `execCommand`), `ApiDocs` (документация). Константы `SCOPE_DEFS` (синхронны с backend `ALLOWED_SCOPES`), `TTL_PRESETS`, `STATUS_BADGES`. Хелпер `apiFetch`. Состояние `revealed` — модалка с raw-ключом.
- **Эндпоинты (клиент):**

| Метод | Путь | Принимает | Возвращает | Назначение |
|-------|------|-----------|------------|------------|
| GET | `/tenant/api-keys` | — | массив ключей | Список (без raw) |
| POST | `/tenant/api-keys` | `{ name, scopes, ttl_days, allowed_ips }` | `{ raw_key (один раз!), name, scopes, expires_at }` | Создать |
| DELETE | `/tenant/api-keys/{id}` | — | — | Отозвать |

- **Зависимости:** `../config` (`API_BASE`), `../design` (`useToast`, `useConfirm`/`ConfirmHost`).
- **Где менять для типовых задач:** список scopes — `SCOPE_DEFS` (**синхронизировать с backend `api_key_service.ALLOWED_SCOPES`!**). Сроки — `TTL_PRESETS` (0 = бессрочно). curl-примеры и документация — `ApiDocs`. Сортировка (active→expired→revoked) — `sortedKeys` useMemo. IP allowlist парсится по запятым/переводам строк.
- **Подводные камни:** **raw_key показывается единожды** в `revealed`-модалке — закрытие = потеря; не добавляйте автозакрытие. 402 → «модуль не подключён в тарифе». `SCOPE_DEFS` — ручная копия серверного списка: рассинхрон приведёт к выбору несуществующего scope. Отзыв необратим (`useConfirm` с danger). Базовый URL в доках зашит как `https://clinikset.ru/api/v1`.
- **Строк:** 517

## `frontend/src/sections/AppointmentsCalendarSection.jsx`
- **Назначение:** Тонкая обёртка-совместимость: просто рендерит `WeekScheduleSection` в режиме `mode="full"`. Используется `ManagerAppointments`.
- **Ключевые элементы:** дефолт-экспорт `AppointmentsCalendarSection({ token })` — возвращает `<WeekScheduleSection token={token} mode="full" />`.
- **Эндпоинты:** нет (вся логика в `WeekScheduleSection`).
- **Зависимости:** `./scheduling/WeekScheduleSection`.
- **Где менять для типовых задач:** любая правка расписания/календаря — НЕ здесь, а в `frontend/src/sections/scheduling/WeekScheduleSection.jsx`. Этот файл — только точка совместимости/алиас.
- **Подводные камни:** **файл-обёртка (alias)** — фактически пустой, вся реализация в `WeekScheduleSection`. Если ищете баг календаря — идите туда.
- **Строк:** 9
