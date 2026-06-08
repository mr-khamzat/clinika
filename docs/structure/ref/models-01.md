# models [01] — ORM-модели: реклама, биллинг, AI, чат, кассы, аудит (A–C)

Эта группа — **25 файлов SQLAlchemy-моделей** (декларативный стиль 2.0: `Mapped[...]` + `mapped_column(...)`), отсортированных по алфавиту от `activity_log.py` до `clinic_schedule.py`. Это **не роутеры и не сервисы** — здесь нет ни одного эндпоинта; файлы описывают только таблицы БД. Каждый класс наследует `app.database.Base`, использует `postgresql.UUID(as_uuid=True)` для PK (`default=uuid.uuid4`) и `JSONB` для полугибких полей. Бизнес-логика (CRUD, расчёты, шифрование вызовов) живёт в соответствующих `app/services/*` и роутерах; модели — это контракт схемы и точка для добавления/изменения колонок (с обязательной Alembic-миграцией).

Сквозные паттерны, общие почти для всех файлов:
- **Мультитенантность.** Почти у каждой таблицы есть `tenant_id` (FK на `tenants.id`). Где данные критичны — `ondelete="CASCADE"`; где запись должна пережить удаление тенанта (аудит, реклама-история) — `ondelete="SET NULL"` и `tenant_id` nullable. Фильтрация по `tenant_id` — ответственность сервиса/роутера, **на уровне модели её нет**.
- **Деньги — всегда `Numeric`/`Decimal`,** никогда не `float` (исключение-легаси см. `bonus.py`). Для `latitude/longitude` и нек-рых координат используется `Float` — это допустимо (не деньги).
- **Время** — `datetime.utcnow` как `default`; часть таблиц использует `DateTime(timezone=True)` (новые), часть — naive `DateTime` (старые). Несогласованность — потенциальный подводный камень при сравнении timestamp'ов.
- **Статусы** хранятся строками; перечисления заданы либо классом-константой (`class XStatus: ...` со строковыми атрибутами — НЕ Python-enum), либо настоящим `enum.Enum` + `SAEnum` (см. `bonus.py`, `call_recording.py`). Это два разных подхода в одной кодовой базе.

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `activity_log.py` | Лог действий пользователя + гео-IP | 26 |
| `advertising.py` | Реклама: объявления и события (CPC/CPM) | 182 |
| `aggregator.py` | Партнёрство с агрегаторами и лиды | 71 |
| `ai_assistant.py` | Диалоговый AI пациента (сессии, реплики) | 93 |
| `ai_history.py` | История AI-аналитики по тенанту | 20 |
| `ai_knowledge.py` | FAQ-база для AI-чата (экономия токенов) | 72 |
| `api_quota.py` | Квоты и использование API по тенантам | 82 |
| `appointment_outcome.py` | Заключение врача, вложения, направления | 179 |
| `audit.py` | Append-only журнал аудита (before/after) | 47 |
| `billing.py` | Подписки, счета, платежи, плагины-подписки | 211 |
| `billing_ledger.py` | Append-only финансовый реестр платформы | 120 |
| `billing_plan.py` | Каталог тарифов и правила ценообразования | 100 |
| `blocked_ip.py` | Ручная блокировка IP-адресов | 38 |
| `bonus.py` | Бонусы за рефералы (legacy float-связки) | 42 |
| `calendar.py` | Токены iCal-фида календаря пациента | 36 |
| `call_recording.py` | Запись звонков + Whisper-транскрипт | 152 |
| `call_rule.py` | Правила звонков по ролям/клиникам | 49 |
| `cash_shift.py` | Кассовая смена клиники + операции | 106 |
| `chat.py` | Чат пациент↔клиника (треды, сообщения) | 169 |
| `chat_global_settings.py` | Глобальные настройки чата на тенант | 55 |
| `chat_message_template.py` | Шаблоны быстрых ответов чата | 51 |
| `chat_promo_code.py` | Промокоды, выдаваемые в чате | 29 |
| `city.py` | Справочник городов для клиник | 26 |
| `clinic.py` | Клиника: реквизиты, гео, МИС, контракт | 61 |
| `clinic_schedule.py` | Расписание работы клиники по дням | 20 |

---

## `backend/app/models/activity_log.py`
- **Назначение:** Лёгкий лог действий пользователя (вход, открытие раздела и т.п.) с обогащением гео-IP. Отличается от `audit.py` тем, что не хранит before/after-снимки — это «след активности», а не финансово-юридический аудит.
- **Ключевые элементы:** класс `ActivityLog` (таблица `activity_log`). Поля: `action`, `entity_type`/`entity_id`, контекст запроса (`ip_address`, `user_agent`), денормализованное `user_name` и блок гео (`geo_country`, `geo_country_name`, `geo_region`, `geo_city`).
- **Зависимости:** только `app.database.Base`. FK на `tenants.id` (SET NULL) и `users.id` (SET NULL).
- **Где менять для типовых задач:** новое отслеживаемое поле активности — добавить колонку здесь + Alembic-миграция; источник записи ищи в сервисе логирования активности / middleware, не здесь.
- **Подводные камни:** `tenant_id` и `user_id` nullable (SET NULL) — записи переживают удаление тенанта/юзера, поэтому при выборках нельзя полагаться на JOIN, есть денормализованный `user_name`. Без `__table_args__` — единственный явный индекс на `tenant_id`.
- **Строк:** 26

## `backend/app/models/advertising.py`
- **Назначение:** Полноценная рекламная подсистема тенанта: объявления (`Ad`) с моделями оплаты flat/CPC/CPM, бюджетами, частотными ограничениями, A/B-тестами, таргетингом и approval-workflow; и события взаимодействия (`AdEvent`) для показов/кликов/конверсий.
- **Ключевые элементы:** классы-константы `AdStatus`, `AdType`, `PricingModel`, `AdEventType`; модели `Ad` (таблица `ads`) и `AdEvent` (`ad_events`). У `Ad` денормализованные счётчики (`impressions_count`/`clicks_count`/`conversions_count`), бюджет (`budget_total`/`spent_total`), self-FK `parent_ad_id` (A/B) и `share_origin_ad_id` (шаринг между филиалами франшизы), JSONB `audience` (таргетинг). Два индекса: `ix_ads_tenant_status`, `ix_ads_dates`.
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE), `users.id` (created_by/approved_by, SET NULL), self-FK `ads.id`, в `AdEvent` — FK на `ads.id` (CASCADE), `tenants.id`, `users.id`, `referrals.id` (для атрибуции конверсии и `revenue`).
- **Где менять для типовых задач:** новый тип оплаты — добавить в `PricingModel` (строки 36-39) + обработка в ad_service; новый вид события — `AdEventType` (42-46); approval/категории/теги — поля начиная со строки 115 (блок `ads02_improvements`).
- **Подводные камни:** все денежные поля — `Numeric(12,2)`/`Decimal` (в JSONB-агрегациях легко получить Decimal-в-JSONB — сериализовать вручную). `ip_hash` — SHA-256, raw IP не хранится (152-ФЗ), дедуп показов «1 per ip_hash per day». `approval_status` дефолт `"approved"` ради обратной совместимости — старые объявления не блокируются. `tenant_id` тут NOT NULL (CASCADE) — реклама удаляется вместе с тенантом.
- **Строк:** 182

## `backend/app/models/aggregator.py`
- **Назначение:** Партнёрская программа с медицинскими агрегаторами (DocDoc, ProDoctorov, Яндекс.Здоровье): хранит само партнёрство с хэшем API-ключа и входящие лиды от агрегатора с расчётом комиссии.
- **Ключевые элементы:** `AggregatorPartnership` (таблица `aggregator_partnerships`) — `partner_name`, `api_key_hash` (UNIQUE, sha256), `key_prefix`, `commission_pct`, `status`; `AggregatorLead` (`aggregator_leads`) — данные пациента (`patient_phone`, `patient_full_name`), `service_requested`, `desired_date`, `status` (received→contacted→scheduled→completed→lost), `commission_amount`, ссылка на созданный `appointment_id`.
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE), `aggregator_partnerships.id` (CASCADE), `clinics.id` (SET NULL), `appointments.id` (SET NULL).
- **Где менять для типовых задач:** добавить нового агрегатора — это просто новое значение строки `partner_name` (валидация в сервисе); новые поля лида — здесь + миграция.
- **Подводные камни:** хранится только **хэш** ключа — плейн-key показывается один раз при создании (`key_prefix` для отображения). `commission_amount` и `commission_pct` — `Numeric` (Decimal), не float. `tenant_id` есть только у партнёрства, у лида изоляция идёт через `partnership_id` → присоединяться к тенанту нужно через JOIN.
- **Строк:** 71

## `backend/app/models/ai_assistant.py`
- **Назначение:** Полноценный диалоговый AI-ассистент пациента на Gemini: сессия-диалог с историей реплик и эскалацией. **Важно:** это НЕ то же, что `PatientAIConversation` из `loyalty.py` (та — single-shot лог Q/A); здесь — многоходовая сессия.
- **Ключевые элементы:** `AiConversation` (таблица `ai_conversations`) — `patient_phone`, `status` (active/resolved/escalated/closed), JSONB `context` (кеш контекста для LLM), `last_message_at`; `AiMessage` (`ai_messages`) — `role` (user/assistant/system), `content`, метрики LLM (`tokens_in`/`tokens_out`, `model`, `latency_ms`, `cost_usd`), флаг `escalated`.
- **Зависимости:** `Base`. FK: `tenants.id` (SET NULL, nullable), `ai_conversations.id` (CASCADE для сообщений).
- **Где менять для типовых задач:** новый статус диалога — менять строковые значения (комментарии-перечисления в строках 46-47) + логику эскалации в ai-сервисе; учёт стоимости/токенов — поля `AiMessage`.
- **Подводные камни:** `cost_usd` — `Numeric(10,5)` (Decimal), точность 5 знаков для дешёвых вызовов. `tenant_id` nullable (SET NULL) — анонимные/платформенные диалоги допустимы. Дубликат по смыслу с `loyalty.py::PatientAIConversation` — не перепутать при поиске «AI-чат пациента».
- **Строк:** 93

## `backend/app/models/ai_history.py`
- **Назначение:** История запусков AI-аналитики (например, аналитический отчёт за N дней): что считали, какой результат, сколько токенов потратили.
- **Ключевые элементы:** `AIAnalysisHistory` (таблица `ai_analysis_history`) — `analysis_type`, `days`, `result_text`, JSONB `stats`, `model`, `tokens_used`, `created_by_id`.
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE), `users.id` (SET NULL).
- **Где менять для типовых задач:** новый тип AI-аналитики — добавлять значение `analysis_type` и обработчик в сервисе аналитики; здесь менять только при новой колонке.
- **Подводные камни:** `tenant_id` NOT NULL (CASCADE). Очень тонкая таблица-лог, без relationship'ов — связи только по id.
- **Строк:** 20

## `backend/app/models/ai_knowledge.py`
- **Назначение:** Локальная FAQ-база для AI-чата пациента: перед обращением к LLM ищется готовый ответ по ключевым словам — экономия токенов. Поддерживает два уровня: платформенные записи (`tenant_id IS NULL`, создаёт super_admin) и тенант-специфичные.
- **Ключевые элементы:** `AIKnowledgeEntry` (таблица `ai_knowledge_entries`) — `question`, `answer`, `keywords` (через запятую, ILIKE/token-overlap), `priority`, счётчик `hits`, `is_active`, `franchise_owner_id` (для фильтрации по франшизе). Доп. индекс `ix_ai_knowledge_active_priority` (tenant_id, is_active, priority) объявлен модульной функцией `Index(...)` после класса.
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE, nullable), `users.id` (franchise_owner, SET NULL).
- **Где менять для типовых задач:** изменить алгоритм поиска FAQ — это сервис `patient_chat_ai`, не модель; добавить поле для матчинга — здесь.
- **Подводные камни:** `tenant_id IS NULL` означает «платформенная запись для всех» — при выборках тенанта нужно явно включать `OR tenant_id IS NULL`. Индекс задан НЕ внутри `__table_args__`, а отдельным вызовом `Index(...)` — легко не заметить.
- **Строк:** 72

## `backend/app/models/api_quota.py`
- **Назначение:** Квоты и лимиты API на тенанта: настройки лимитов (`TenantQuota`, одна строка на тенанта) и daily-aggregate использование (`QuotaUsage`), которое копится в Redis и периодически флашится в БД.
- **Ключевые элементы:** константы-дефолты `DEFAULT_REQUESTS_PER_MINUTE=6000`, `DEFAULT_REQUESTS_PER_DAY=100_000`, `DEFAULT_STORAGE_MB_LIMIT=5000`, `DEFAULT_USERS_LIMIT=50`, `DEFAULT_CALLS_MINUTES_PER_MONTH=1000`. `TenantQuota` (UNIQUE `tenant_id`) с лимитами + `plan_default`. `QuotaUsage` (UNIQUE `tenant_id`+`period`) с `requests_count`/`storage_mb_used`/`calls_minutes_used`.
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE) в обеих таблицах. Логически связан с `quota_service` (flush_to_db) и `billing_plan.py` (лимиты тарифа).
- **Где менять для типовых задач:** новый вид лимита — добавить колонку в `TenantQuota` + дефолт-константу (синхронно со `server_default`), и счётчик в `QuotaUsage`; правят лимиты через `POST/PUT /admin/quotas/{tenant_id}` (super_admin).
- **Подводные камни:** дефолты в коде (`default=...`) должны совпадать с `server_default` в миграции — рассинхрон даст разные значения у новых строк. `QuotaUsage` пишется батчем из Redis, не на каждый запрос — текущее значение «в реальном времени» только в Redis.
- **Строк:** 82

## `backend/app/models/appointment_outcome.py`
- **Назначение:** Постприёмные сущности: заключение врача (1:1 с приёмом, **шифрованное**), файловые вложения (анализы/исследования) и внутриклинические направления (к другому врачу/на КТ/МРТ/анализы).
- **Ключевые элементы:** `AppointmentOutcome` (`appointment_outcomes`, UNIQUE `appointment_id`) — поля `conclusion_encrypted`/`recommendations_encrypted` с **прозрачным шифрованием**: кастомный `__init__` шифрует `conclusion`/`recommendations` из kwargs, плюс property-геттеры/сеттеры дешифруют через `encryption_service`. `AppointmentAttachment` (`appointment_attachments`) — `file_url`, `file_name`, `mime_type`, `size_bytes`. `InternalReferral` (`internal_referrals`) — `target_type` (doctor/ct/mri/xray/lab/procedure), `target_doctor_id`, `target_service`, `status` (pending/scheduled/done/cancelled), денормализованные `patient_phone`/`patient_name`.
- **Зависимости:** `Base`; **рантайм-импорт** `app.services.encryption_service.encrypt/decrypt` (ленивый, внутри методов). FK: `appointments.id` (CASCADE), `users.id` (SET NULL), `tenants.id` (SET NULL), `doctors.id` (SET NULL), self-ссылки на `appointments.id` (source/scheduled).
- **Где менять для типовых задач:** новое шифруемое поле заключения — добавить колонку `*_encrypted` + пару в списке `__init__` (строка 53) + property; новый тип направления — расширить комментарий-перечисление `target_type` (строка 145) и валидацию в сервисе.
- **Подводные камни:** **PII шифруется на уровне модели** — нельзя фильтровать/искать по `conclusion` в SQL (хранится шифротекст); чтение происходит через property и требует рабочего `encryption_service` (ключ в ENV). `InternalReferral.tenant_id` nullable (SET NULL) и берётся из source-приёма. Денормализация телефона/имени — намеренная, на случай удаления исходного приёма.
- **Строк:** 179

## `backend/app/models/audit.py`
- **Назначение:** Append-only журнал аудита значимых мутаций данных (этап 8 SaaS): кто, что, до/после, откуда (IP, гео). Юридически весомый лог, в отличие от лёгкого `activity_log.py`.
- **Ключевые элементы:** `AuditEntry` (таблица `audit_log`) — `actor_id`/`actor_name`, `action`, `entity_type`/`entity_id`, JSONB `before`/`after`, контекст (`ip_address`, `user_agent`), полный блок гео (`geo_country`…`geo_lat`/`geo_lon` как `Numeric(9,6)`), `comment`. Много индексов (action, entity_type, entity_id, geo_country, created_at).
- **Зависимости:** `Base`. FK: `tenants.id` (SET NULL), `users.id` (actor, SET NULL). Логически — `geoip_service.lookup` заполняет гео-поля.
- **Где менять для типовых задач:** новое аудируемое действие — это вызов записи в сервисе/декораторе аудита; здесь — только при новой колонке контекста.
- **Подводные камни:** **append-only** — записи никогда не меняются/удаляются (инвариант на уровне дисциплины кода, не БД). `geo_lat/geo_lon` — `Numeric`, не float. `before`/`after` JSONB — при сериализации Decimal/datetime нужно приводить к JSON-safe вручную.
- **Строк:** 47

## `backend/app/models/billing.py`
- **Назначение:** Ядро биллинга SaaS (этап 9): иерархия Подписка → Счёт → Платёж, плюс отдельный lifecycle подписок на платные плагины и B2B-акты оказанных услуг.
- **Ключевые элементы:** классы-константы `SubStatus`, `InvoiceStatus`, `PaymentStatus`, `PluginSubStatus`; статичный прайс-лист `PLAN_PRICES` (basic/professional/enterprise × monthly/quarterly/semi_annual/nine_months/annual). Модели: `Subscription` (`subscriptions`) с relationship `invoices`; `Invoice` (`invoices`, UNIQUE `invoice_number`) с обширным блоком B2B-актов (act_number/act_status/act_type, подпись, PDF, налоги subtotal/tax_rate/tax_amount/total, реквизиты юрлица) и relationship `payments`; `Payment` (`payments`, UNIQUE `transaction_id`); `TenantPluginSubscription` (`tenant_plugin_subscriptions`, UNIQUE `tenant_id`+`feature_key`).
- **Зависимости:** `Base`; relationship'ы Subscription↔Invoice↔Payment (cascade delete-orphan). FK: `tenants.id` (CASCADE) везде, `subscriptions.id` (CASCADE), `invoices.id` (CASCADE). Связь с `billing_ledger.py` через `reference_id`+`reference_type='plugin_subscription'`.
- **Где менять для типовых задач:** цены/циклы — словарь `PLAN_PRICES` (строки 43-47), но учти, что есть и БД-каталог `billing_plan.py::TenantPlan` (дублирование, см. подводные камни); поля акта — блок строк 109-126 `Invoice`; новый статус платежа — `PaymentStatus`.
- **Подводные камни:** **два источника цен** — хардкод `PLAN_PRICES` здесь и БД `TenantPlan` в `billing_plan.py`; нужно понимать, какой используется в конкретном сервисе. Все суммы — `Decimal`. `TenantPluginSubscription` отделена от `TenantPlugin` (tenant.py): здесь финансовый lifecycle, там — технический флаг enabled; UNIQUE(tenant_id, feature_key) обеспечивает идемпотентность enable_plugin. `UniqueConstraint` импортируется локально внутри тела класса (строка 207) — необычно.
- **Строк:** 211

## `backend/app/models/billing_ledger.py`
- **Назначение:** Append-only финансовый реестр **платформы** (подписки, плагины, реклама, revenue split). Чётко разграничен с `ledger.py` (тот — бонусы пациентов/сотрудников, клиентская сторона).
- **Ключевые элементы:** классы-константы `EntryType` (subscription_*/plugin_*/ad_*/platform_income/tenant_income/franchise_fee/payment_received/refund/manual_adjustment) и `Direction` (credit/debit). `BillingLedger` (таблица `billing_ledger`) — `entry_type`, `direction`, `amount` (всегда >0), `currency` (RUB), `reference_id`/`reference_type`, паттерн revenue-split (`is_split`, self-FK `split_parent_id`, `split_actor` ∈ platform/tenant/franchise). Индексы `ix_billing_ledger_tenant_type`, `ix_billing_ledger_created_tenant`.
- **Зависимости:** `Base`. FK: `tenants.id` (SET NULL, nullable — записи самой платформы), `clinics.id` (SET NULL), self-FK `billing_ledger.id` (SET NULL).
- **Где менять для типовых задач:** новый тип финоперации — добавить в `EntryType` (строки 22-49) + генерацию записи в billing-сервисе; новый участник split — `split_actor` + логика разбивки.
- **Подводные камни:** **append-only** (правило дисциплины). Сумма всегда положительная — знак определяется `direction`. Revenue split = 1 gross-запись + 2-3 split-записи через `split_parent_id`; при подсчёте дохода платформы фильтровать `entry_type='platform_income' AND direction='credit'`, иначе двойной учёт. `tenant_id` nullable: `NULL` = запись принадлежит платформе.
- **Строк:** 120

## `backend/app/models/billing_plan.py`
- **Назначение:** БД-каталог тарифных планов (альтернатива хардкоду `PLAN_PRICES`) и индивидуальные ценовые правила тенанта (скидки, revenue split %, franchise fee %).
- **Ключевые элементы:** `TenantPlan` (`tenant_plans`, UNIQUE `name`) — `display_name`, `base_price_month`/`base_price_year`, лимиты `max_clinics`/`max_users` (-1 = безлимит), JSONB `features`, `sort_order`, `is_active`, `is_public`. `TenantPricingRules` (`tenant_pricing_rules`, UNIQUE `tenant_id`) — `min_price`/`max_price`, `plugin_split_percent` (деф. 30%), `ad_split_percent` (деф. 20%), `franchise_fee_percent` (деф. 0%), `subscription_discount_percent` (деф. 0%).
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE). Логически — источник split-процентов для `billing_ledger.py` и цен для `billing.py`.
- **Где менять для типовых задач:** добавить тариф без деплоя — строка в `tenant_plans`; включить/выключить фичу тарифа — JSONB `features`; индивидуальные условия клиента — `TenantPricingRules` (один набор на тенанта).
- **Подводные камни:** дублирует прайс из `billing.py::PLAN_PRICES` — следить, что является источником истины. Все проценты/цены — `Decimal`. `is_public=False` — скрытый Enterprise-план, не показывать в публичном списке тарифов.
- **Строк:** 100

## `backend/app/models/blocked_ip.py`
- **Назначение:** Ручная блокировка IP super_admin'ом из UI «Безопасность». `BlockIpMiddleware` проверяет входящие запросы против активных записей и отвечает 403. Только ручные блокировки — авто-системы (rate-limiter, Region Lock) отдельны.
- **Ключевые элементы:** `BlockedIp` (таблица `blocked_ips`) — `ip`, `reason`, `blocked_by_id`, `blocked_at`, `blocked_until` (nullable = бессрочно), `is_active`.
- **Зависимости:** `Base`. FK: `users.id` (blocked_by, SET NULL). Потребитель — `BlockIpMiddleware`.
- **Где менять для типовых задач:** добавить причину/категорию блокировки — здесь; логику проверки — в middleware.
- **Подводные камни:** **нет `tenant_id`** — таблица глобальная (платформенный уровень безопасности). Активность блокировки = `is_active=True AND (blocked_until IS NULL OR blocked_until > now)` — проверять оба условия.
- **Строк:** 38

## `backend/app/models/bonus.py`
- **Назначение:** Бонусы (вознаграждения) за рефералы: начисление админу за подтверждённое направление, со статусом pending/paid/cancelled.
- **Ключевые элементы:** настоящие Python-enum `BonusStatus` (PENDING/PAID/**CANCELLED**) и `BonusType` (REGULAR/COMMISSION). `Bonus` (таблица `bonuses`) — `admin_id`, `referral_id`, `bonus_type` (через `SAEnum` с `values_callable`), `amount`, `status`, `paid_at`. Relationship'ы `admin` (User) и `referral` (Referral).
- **Зависимости:** `Base`; relationship'ы на `User.bonuses` и `Referral.bonus` (обратные связи определены в тех моделях). FK: `tenants.id` (SET NULL), `users.id` (admin), `referrals.id`.
- **Где менять для типовых задач:** новый статус/тип бонуса — добавить значение в enum (BonusStatus/BonusType) + значения в БД; начисление/отмена — `bonus_service` (mark_bonus_cancelled).
- **Подводные камни:** **легаси-аннотация** — `amount: Mapped[float]` хотя колонка `Numeric(10,2)` (фактически Decimal); тип-хинт вводит в заблуждение, работать с amount как с Decimal. `CANCELLED` добавлен пост-фактум (фикс #4 аудита: код ссылался на отсутствовавшее значение → AttributeError). `status` использует `SAEnum(BonusStatus)` БЕЗ `values_callable` (в отличие от `bonus_type`) — в БД могут попасть ИМЕНА enum (PENDING), а не значения (pending); расхождение стилей внутри одной модели — потенциальный баг при сравнении.
- **Строк:** 42

## `backend/app/models/calendar.py`
- **Назначение:** Токен для iCal-фида календаря пациента (подписка Google/Apple Calendar по URL `.../patient/calendar/feed.ics?token=<token>`).
- **Ключевые элементы:** `PatientCalendarToken` (таблица `patient_calendar_tokens`) — `patient_id`, `token` (UNIQUE 64 символа), `revoked_at` (nullable = активен).
- **Зависимости:** `Base`. FK: `patient_accounts.id` (CASCADE). Потребитель — роутер выдачи .ics.
- **Где менять для типовых задач:** изменить формат/содержимое фида — в сервисе/роутере календаря; ротация токена — добавить логику revoke здесь не нужно, поле `revoked_at` уже есть.
- **Подводные камни:** **нет `tenant_id`** — изоляция через `patient_id`. Токен — секрет в URL: проверять `revoked_at IS NULL`. `DateTime(timezone=True)` (aware) — в отличие от многих соседних naive-таблиц.
- **Строк:** 36

## `backend/app/models/call_recording.py`
- **Назначение:** Запись звонков (staff/telemed/external) + Whisper-транскрипция и опц. AI-summary (Gemini). Модуль W5. Две таблицы 1:1.
- **Ключевые элементы:** Python-enum `CallSessionType` (staff/telemed/external) и `CallRecordingStatus` (uploading→ready→transcribing→done/failed). `CallRecording` (`call_recordings`) — `call_log_id` (nullable), JSONB `participants`, `recording_path`, `file_size_bytes` (BigInteger), `duration_seconds`, `status`; relationship `transcript` (1:1, delete-orphan) и `tenant`. `CallTranscript` (`call_transcripts`, UNIQUE `recording_id`) — JSONB `segments`, `full_text`, `summary`, `tokens_used`, `model` (деф. whisper-1), `cost_usd`.
- **Зависимости:** `Base`; relationship'ы CallRecording↔CallTranscript, CallRecording→Tenant. FK: `tenants.id` (CASCADE), `call_logs.id` (SET NULL), `call_recordings.id` (CASCADE).
- **Где менять для типовых задач:** новый тип сессии/статус — enum'ы (строки 37-50); смена модели транскрипции — `model`/`cost_usd` логика в whisper-сервисе.
- **Подводные камни:** оба enum используют `native_enum=True` + `values_callable` → в PostgreSQL создаются ENUM-типы `call_session_type`/`call_recording_status` (изменение значений требует ALTER TYPE в миграции, не просто правку Python). `cost_usd` — `Numeric(10,4)` Decimal. `call_log_id` nullable: внешние сессии без CallLog. `file_size_bytes` — BigInteger (большие файлы).
- **Строк:** 152

## `backend/app/models/call_rule.py`
- **Назначение:** Правила «кто кому может звонить» по парам ролей и scope (одна клиника / разные / любая), с опц. привязкой к конкретной паре клиник. Иерархия точности: конкретная пара клиник → общее правило ролей со scope → дефолт из сервиса.
- **Ключевые элементы:** класс-константа `CallScope` (same_clinic/cross_clinic/any). `CallRule` (`call_rules`) — `from_role`/`to_role`, `scope`, опц. `from_clinic_id`/`to_clinic_id`, `allow_audio`/`allow_video`. UNIQUE(`tenant_id`,`from_role`,`to_role`,`scope`,`from_clinic_id`,`to_clinic_id`).
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE), `clinics.id` ×2 (CASCADE). Дефолт — `call_rules_service.default_rule`.
- **Где менять для типовых задач:** новый scope — `CallScope` + логика подбора правила в `call_rules_service`; новый канал (например screen-share) — добавить `allow_*` поле.
- **Подводные камни:** UNIQUE включает nullable clinic-поля — в PostgreSQL NULL'ы в уникальном индексе НЕ считаются равными, поэтому можно создать несколько «общих» правил с NULL-клиниками; учитывать в сервисе. `tenant_id` NOT NULL.
- **Строк:** 49

## `backend/app/models/cash_shift.py`
- **Назначение:** Кассовая смена клиники (модуль бухгалтерии): открытие/закрытие смены и операции прихода/расхода внутри неё. Z-отчёт собирается по закрытии.
- **Ключевые элементы:** классы-константы `CashShiftStatus` (open/closed), `CashShiftEntryDirection` (in/out), `CashShiftEntryCategory` (sale/refund/salary/expense/incassation/adjustment/other). `CashShift` (`cash_shifts`) — `clinic_id`, `cash_start`, `cash_end_actual`/`cash_end_expected`/`discrepancy`, `status`. `CashShiftEntry` (`cash_shift_entries`) — `direction`, `amount` (всегда >0), `category`, `reference_type`/`reference_id`.
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE), `clinics.id` (CASCADE), `users.id` (opened_by/closed_by/created_by, SET NULL), `cash_shifts.id` (CASCADE).
- **Где менять для типовых задач:** новая категория операции — `CashShiftEntryCategory` (строки 37-44) + обработка в cash-сервисе; формула Z-отчёта (`expected = cash_start + sum(in) - sum(out)`, `discrepancy = actual - expected`) — в сервисе закрытия смены.
- **Подводные камни:** инвариант «одна открытая смена на клинику» обеспечивается **partial unique index** (`WHERE status='open'`), который задаётся в МИГРАЦИИ, а не в этой модели — в коде модели его не видно. Все суммы — `Decimal`. `sum()` пустого генератора при подсчёте — типичный источник ошибок (см. заметки по проекту), приводить к Decimal('0').
- **Строк:** 106

## `backend/app/models/chat.py`
- **Назначение:** Асинхронный чат пациент↔клиника: треды (с назначенным врачом, SLA-эскалацией, пиннингом), сообщения (с цитированием и вложениями) и реакции-emoji.
- **Ключевые элементы:** `ChatThread` (`chat_threads`) — `clinic_id`, `patient_id`, `assigned_doctor_id`, `status` (open/closed/archived), счётчики `unread_for_patient`/`unread_for_clinic`, индикаторы «печатает» (`last_typing_at_*`), `pinned_at`, `color_label`, SLA-блок (`last_inbound_message_at`, `sla_breached_level`, `sla_breached_at`, JSONB `reassigned_history`). `ChatMessage` (`chat_messages`) — `sender_type` (patient/doctor/reg/manager/system), `body`, JSONB `attachments`, `read_at`, self-FK `reply_to_id` (цитирование, SET NULL). `ChatMessageReaction` (`chat_message_reactions`, UNIQUE message+user_type+user_id+emoji).
- **Зависимости:** `Base`. FK: `tenants.id` (SET NULL), `clinics.id` (CASCADE), `patient_accounts.id` (CASCADE), `users.id` (assigned_doctor, SET NULL), `chat_threads.id` (CASCADE), self-FK `chat_messages.id` (SET NULL). Потребители — chat_service, `chat_sla_job` (расчёт SLA).
- **Где менять для типовых задач:** новый тип отправителя — комментарий-перечисление `sender_type` (строка 114) + валидация в сервисе; SLA-уровни — поля строк 87-100 + `chat_sla_job`; лимит «3 msg/мес без подписки» реализуется в сервисе, не в модели.
- **Подводные камни:** `tenant_id` nullable (SET NULL), изоляция чаще через `clinic_id`. `reassigned_history` — JSONB-массив с `server_default='[]'` NOT NULL. Лимит сообщений (3/мес без health_plus) — бизнес-логика вне модели. `DateTime(timezone=True)` для большинства полей, но SLA-поля (`last_inbound_message_at`, `sla_breached_at`) — naive `DateTime`: рассинхрон tz при сравнении.
- **Строк:** 169

## `backend/app/models/chat_global_settings.py`
- **Назначение:** Глобальные настройки чата на тенант (единственная запись на tenant): TTL и лимит размера файлов, разрешение межклиничных чатов, флаги TG-уведомлений.
- **Ключевые элементы:** `ChatGlobalSettings` (`chat_global_settings`, UNIQUE `tenant_id`) — `file_ttl_hours` (48), `max_file_mb` (50), `inter_clinic_allowed`, `tg_notifications_enabled`, `tg_notify_super_admin`, `tg_notify_franchise_owner`, `patient_chat_tg_enabled`, `updated_by_id`.
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE, nullable+unique), `users.id` (updated_by, SET NULL). Потребители — chat_service, TG-нотификатор, очистка файлов по TTL.
- **Где менять для типовых задач:** новый флаг/настройка чата — колонка здесь + дефолт; читается в `/admin/chat-settings`.
- **Подводные камни:** `tenant_id` nullable+UNIQUE — допускает одну «платформенную» запись (tenant_id NULL); если записи нет — сервис использует дефолты из ENV/констант (фолбэк вне модели).
- **Строк:** 55

## `backend/app/models/chat_message_template.py`
- **Назначение:** Шаблоны быстрых ответов (quick-replies) для чата клиники. **Изолирована** от старой `message_templates` (которую использует TemplateAutocomplete). Поддерживает платформенные шаблоны (`tenant_id IS NULL AND is_default=TRUE`) и тенант/клиничные.
- **Ключевые элементы:** `ChatMessageTemplate` (`chat_message_templates`) — `category`, `shortcut`, `title`, `body`, `is_default`, `sort_order`, `usage_count`.
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE, nullable), `clinics.id` (CASCADE, nullable), `users.id` (created_by, SET NULL).
- **Где менять для типовых задач:** новая категория шаблона — значение `category` (валидация в сервисе); seed платформенных шаблонов — записи с tenant_id NULL + is_default.
- **Подводные камни:** **дубль по смыслу** со старой `message_templates` — не перепутать; эта именно для чата. `tenant_id`/`clinic_id` оба nullable: уровни видимости платформа→тенант→клиника надо разруливать в выборке.
- **Строк:** 51

## `backend/app/models/chat_promo_code.py`
- **Назначение:** Промокоды на скидку, выдаваемые в чате пациенту (например, как стимул записаться). Код генерируется в формате `CL-XXXXXXXX`.
- **Ключевые элементы:** функция-генератор `gen_code()` (`secrets`-рандом). `ChatPromoCode` (`chat_promo_codes`) — `code` (UNIQUE, авто-default `gen_code`), `discount_type` (percent/...), `discount_value`, `max_uses`/`used_count`, `valid_until`, `used_at`, ссылки `thread_id`/`issued_to_patient_id` (без FK), `issued_by_user_id`.
- **Зависимости:** `Base`; модуль `secrets`/`string`. FK: `tenants.id` (CASCADE), `clinics.id` (SET NULL), `users.id` (issued_by, CASCADE).
- **Где менять для типовых задач:** новый тип скидки (например fixed-сумма) — расширить `discount_type` + расчёт в сервисе применения; формат кода — `gen_code()` (строки 9-10).
- **Подводные камни:** `discount_value` — `Integer` (для percent — проценты целым; для абсолютной суммы потребуется иной тип — учесть). `thread_id` и `issued_to_patient_id` объявлены **без ForeignKey** (только UUID) — целостность не гарантируется БД. `issued_by_user_id` — CASCADE: удаление пользователя удалит выданные им промокоды.
- **Строк:** 29

## `backend/app/models/city.py`
- **Назначение:** Справочник городов для фильтрации клиник и гео-аналитики. Может быть общим или специфичным для тенанта (комментарий допускает tenant_id, но в текущей схеме его НЕТ).
- **Ключевые элементы:** `City` (`cities`) — `name`, `region`, `country` (RU), `latitude`/`longitude` (Float), `is_active`. Relationship `clinics` (back_populates `city_ref`).
- **Зависимости:** `Base`; relationship City↔Clinic (см. `clinic.py`).
- **Где менять для типовых задач:** добавить город — строка в `cities`; привязать клинику — через `Clinic.city_id`.
- **Подводные камни:** **нет `tenant_id`** (несмотря на докстринг) — справочник глобальный. `latitude/longitude` — Float (координаты, не деньги — ок). Дублирование гео: у `Clinic` есть и `city_id` (FK), и денормализованное `city` (строка) — следить за консистентностью.
- **Строк:** 26

## `backend/app/models/clinic.py`
- **Назначение:** Центральная сущность — клиника (филиал) тенанта: реквизиты, гео, настройки интеграции с МИС и контракт партнёра-франчайзи.
- **Ключевые элементы:** `Clinic` (`clinics`) — `name`, `address`, `phone`, `is_active`; МИС-блок per-clinic (`mis_id`, `mis_api_url`, `mis_api_key`, `mis_type` ∈ renovatio/medods/medai/...); гео (`city_id` FK + денормализованные `city`/`region`/`latitude`/`longitude`); контракт партнёра (`contract_type` ∈ royalty/per_referral/hybrid, `royalty_percent`, `bonus_per_referral`, `contract_signed_at`/`contract_expires_at`, `partner_status`, `revenue_source` ∈ mis/manual/export). Богатый набор relationship'ов: `city_ref`, `users`, `services`, `referrals_from`/`referrals_to` (по разным FK), `schedules` (delete-orphan).
- **Зависимости:** `Base`; relationship'ы на City, User, Service, Referral (×2 foreign_keys), ClinicSchedule. FK: `tenants.id` (SET NULL), `cities.id` (SET NULL).
- **Где менять для типовых задач:** новый тип МИС — значение `mis_type` + адаптер в mis-сервисе; новая схема выплаты партнёру — `contract_type` + расчёт в bonus/referral-сервисе; новое поле клиники — здесь + миграция, **проверить, не нужно ли добавить в relationship-цепочки**.
- **Подводные камни:** `tenant_id` nullable (SET NULL) — клиника может «осиротеть». `mis_api_key` хранится строкой (в идеале шифровать — проверить, шифруется ли на уровне сервиса). `royalty_percent`/`bonus_per_referral` — `Decimal`. Денормализованный `city` дублирует `city_ref.name` — рассинхрон при правке только одного. Два relationship на Referral различаются `foreign_keys` — не перепутать from/to.
- **Строк:** 61

## `backend/app/models/clinic_schedule.py`
- **Назначение:** Расписание работы клиники по дням недели (часы открытия/закрытия).
- **Ключевые элементы:** константа `DAY_NAMES` (Пн..Вс). `ClinicSchedule` (`clinic_schedules`) — `day_of_week` (0=Mon..6=Sun), `open_time`/`close_time` (строки "HH:MM"), `is_active`. Relationship `clinic` (back_populates `schedules`).
- **Зависимости:** `Base`; relationship ClinicSchedule↔Clinic. FK: `clinics.id` (без явного ondelete — но Clinic.schedules задаёт cascade delete-orphan на ORM-уровне).
- **Где менять для типовых задач:** изменить формат времени или добавить перерыв (break_start/break_end) — поля здесь; недельная сетка строится по `day_of_week`.
- **Подводные камни:** **нет `tenant_id`** — изоляция через `clinic_id`. Время хранится **строкой** `String(5)` ("09:00"), не `Time` — сравнения и валидация формата лежат на сервисе; легко записать невалидное значение. FK на `clinics.id` без `ondelete` в модели (каскад — только через ORM relationship, не на уровне БД-констрейнта) — при прямом DELETE в SQL возможны висячие записи.
- **Строк:** 20
