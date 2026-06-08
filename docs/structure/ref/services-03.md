# services [03] — AI-провайдеры, аналитика, инфраструктурные сервисы и фискализация (ОФД)

Этот срез — 15 файлов слоя `backend/app/services` (бизнес-логика, отделённая от роутеров). Все они — **сервисы, а не роутеры**: ни в одном нет `APIRouter` или декораторов `@router.*`/`@app.*`, поэтому секция «Эндпоинты» нигде не применима — функции этих модулей вызываются из роутеров (`backend/app/routers/...`) и из крон-задач.

Группа разнородная и покрывает четыре подсистемы:

1. **AI для кабинета врача** — `claude_service.py` (низкоуровневый клиент Anthropic), `doctor_ai_service.py` (оркестратор провайдеров Claude → Gemini → rule-based), генерирующий pre-visit briefing и план лечения.
2. **Премиум-аналитика и контент** — `cohort_service.py` (cohort-анализ клиник франшизы), `engagement_analytics.py` (funnel/churn/retention/heatmap пациентов ЛК), `cost_service.py` (оценка стоимости тенанта для платформы), `cms_service.py` (CMS-страницы тенанта), `feature_flag_service.py` (фиче-флаги с раскаткой и A/B).
3. **Инфраструктура общего назначения** — `email_service.py` (SMTP-обёртка + welcome/reset-письма), `encryption_service.py` (Fernet-шифрование секретов + blind-hash PII), `document_service.py` (хранилище медицинских документов пациента), `family_service.py` (семейные профили пациентов).
4. **Фискализация 54-ФЗ (пакет `fiscal/`)** — `base.py` (абстрактный `BaseOfdProvider` + DTO), `platforma_ofd_adapter.py` (единственная рабочая реализация ОФД), `atol_online_adapter.py` и `perv_ofd_adapter.py` (заглушки `NotImplementedError`).

## Оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `services/claude_service.py` | Async-клиент Anthropic Claude для AI-генерации | 95 |
| `services/cms_service.py` | CRUD CMS-страниц и меню тенанта | 76 |
| `services/cohort_service.py` | Cohort-анализ клиник франшизы с Redis-кешем | 327 |
| `services/cost_service.py` | Оценка стоимости тенанта для платформы | 241 |
| `services/doctor_ai_service.py` | Оркестратор AI: briefing и план лечения | 401 |
| `services/document_service.py` | Хранилище медицинских документов пациента | 194 |
| `services/email_service.py` | SMTP-обёртка, welcome- и reset-письма | 376 |
| `services/encryption_service.py` | Fernet-шифрование секретов + blind-hash PII | 139 |
| `services/engagement_analytics.py` | Аналитика пациентов ЛК (funnel/churn/retention) | 244 |
| `services/family_service.py` | Семейные профили: группы, инвайты, члены | 210 |
| `services/feature_flag_service.py` | Фиче-флаги: раскатка, A/B, Redis-кеш | 267 |
| `services/fiscal/atol_online_adapter.py` | Адаптер Атол.Онлайн — заглушка | 29 |
| `services/fiscal/base.py` | Базовый класс ОФД-провайдера + DTO | 46 |
| `services/fiscal/perv_ofd_adapter.py` | Адаптер Первый ОФД — заглушка | 26 |
| `services/fiscal/platforma_ofd_adapter.py` | Платформа ОФД — рабочий адаптер фискализации | 376 |

---

## `backend/app/services/claude_service.py`

- **Назначение:** Тонкая async-обёртка над Anthropic SDK для AI-генерации в кабинете врача. Это основной AI-провайдер платформы; при отсутствии ключа или ошибке API бросает исключение, и вызывающий код (`doctor_ai_service`) переключается на Gemini или rule-based fallback.
- **Ключевые элементы:**
  - `DEFAULT_MODEL = "claude-sonnet-4-6"` — модель по умолчанию (комментарий в коде: оптимум качества/скорости для медицинских JSON-ответов).
  - `has_claude() -> bool` — есть ли ключ `settings.anthropic_api_key`.
  - `_get_client() -> anthropic.AsyncAnthropic` — ленивый singleton-клиент; читает `base_url` из `os.environ["ANTHROPIC_BASE_URL"]` (для проксирования).
  - `async chat_completion(messages, system, model, max_tokens) -> dict` — единственная публичная корутина; сигнатура зеркалит `gemini_service.chat_completion`, возвращает `{text, tokens_in, tokens_out, latency_ms, model}`. Склеивает только `text`-блоки ответа (thinking-блоки отбрасываются).
- **Зависимости:** внешний пакет `anthropic` (AsyncAnthropic), `app.config.settings` (ключ `anthropic_api_key`). Потребитель — `doctor_ai_service`.
- **Где менять для типовых задач:**
  - Сменить модель — `DEFAULT_MODEL` (строка 39).
  - Увеличить дефолтный лимит токенов — параметр `max_tokens` в `chat_completion` (строка 63).
  - Прокинуть thinking-блоки или дополнительные параметры (temperature, tools) — тело `chat_completion`, вызов `client.messages.create` (строка 74).
  - Добавить retry/таймаут — оборачивать `client.messages.create`.
- **Подводные камни:** `import os` стоит внутри docstring на строке 2 (косметический баг — строка-литерал, не исполняется; реальный импорт `os` отсутствует на верхнем уровне, но `os.environ` используется в `_get_client` строка 55 — `os` подтягивается через `import` внутри docstring? Нет — это работает только потому, что строка 2 находится ВНУТРИ docstring модуля и НЕ является импортом). **ВНИМАНИЕ:** на строке 55 вызывается `os.environ.get(...)`, но модуль нигде не делает рабочий `import os` вне докстринга — это потенциальный `NameError` при пустом `ANTHROPIC_BASE_URL`-пути; проверить при правках. Клиент `_client` кешируется глобально — смена ключа в рантайме не подхватится без рестарта. Корутина async, не забывать `await`.
- **Строк:** 95

## `backend/app/services/cms_service.py`

- **Назначение:** CRUD-сервис CMS-страниц тенанта (`TenantCmsPage`): список, получение по slug, создание/обновление/удаление, построение меню. Используется публичным сайтом клиники и админкой контента.
- **Ключевые элементы:** класс `CmsService` со статическими корутинами:
  - `list_pages(db, tenant_id, published_only=True)` — список страниц, сортировка по `sort_order, created_at`.
  - `get_page(db, tenant_id, slug)` — одна страница.
  - `create_page(db, tenant_id, user_id, data)` — белый список полей при создании (`slug, title, content_md, content_blocks, is_published, page_type, show_in_menu, menu_title, sort_order, seo_title, seo_description`).
  - `update_page(db, page, data)` — белый список полей при апдейте (тот же + `slug`, без `created_by`), пропускает `None`.
  - `delete_page(db, page)` — жёсткое удаление.
  - `get_menu(db, tenant_id)` — список пунктов меню (`show_in_menu && is_published`).
- **Зависимости:** `app.models.cms.TenantCmsPage`, SQLAlchemy async.
- **Где менять для типовых задач:**
  - Добавить новое поле страницы — добавить его в оба белых списка (строки 34-38 create и 47-49 update), иначе оно тихо проигнорируется.
  - Перейти на soft-delete — переписать `delete_page`.
  - Изменить порядок меню/страниц — `order_by` в `list_pages`/`get_menu`.
- **Подводные камни:** `create_page`/`update_page` делают `commit()` внутри (а не `flush()`) — нельзя обернуть в более крупную внешнюю транзакцию без последствий. Все запросы фильтруются по `tenant_id` (хорошо), но `update_page`/`delete_page` принимают уже найденный объект `page` — ответственность за tenant-проверку лежит на роутере, который его получает. Сравнение `== True` (строки 14, 69) вместо `.is_(True)` — работает, но не идиоматично.
- **Строк:** 76

## `backend/app/services/cohort_service.py`

- **Назначение:** Cohort-анализ клиник внутри одной франшизы (премиум-аналитика для роли `franchise_owner`, глава 3 ROADMAP). Строит 2D-матрицу метрики по месяцам за последние 12 месяцев + ранги + перцентили + рост относительно когорты. Результат кешируется в Redis на 10 минут.
- **Ключевые элементы:**
  - `ALLOWED_METRICS = ("revenue", "appointments", "referrals", "patients")`, `CACHE_TTL = 600`.
  - `_ym(d)`, `_last_n_months(n=12)` — утилиты периода.
  - `_get_redis()`, `_cached_get(key)`, `_cached_set(key, value, ttl)` — Redis с graceful-fallback.
  - `_list_clinics_of_franchise(db, franchise_id)` — клиники тенантов франшизы через `Tenant.franchise_id`.
  - 4 агрегатора: `_aggregate_revenue` (sum `Bonus.amount` по `Referral.to_clinic_id`, статусы PAID/PENDING), `_aggregate_appointments` (count по `Appointment`), `_aggregate_referrals` (count по `from_clinic_id`), `_aggregate_patients` (distinct `patient_phone`).
  - `get_cohort(db, franchise_id, metric="revenue", period="monthly") -> dict` — главная функция для эндпоинта `/admin/analytics/cohort-clinics` (сам эндпоинт — в роутере, не здесь).
- **Зависимости:** `redis.asyncio`, `app.config.settings.redis_url`, модели `Bonus/BonusStatus`, `Clinic`, `Appointment`, `Referral`, `Tenant`.
- **Где менять для типовых задач:**
  - Добавить новую метрику — расширить `ALLOWED_METRICS`, написать `_aggregate_<metric>`, добавить ветку в `get_cohort` (строки 261-268).
  - Сменить горизонт (12 → N мес.) — аргумент в `_last_n_months(12)` (строка 253).
  - Сменить TTL кеша — `CACHE_TTL`.
  - Изменить логику рангов/перцентилей/`growth_vs_cohort` — блок строк 270-310.
- **Подводные камни:** агрегаторы приводят суммы к `float` (`float(total or 0)`) — для денежного `revenue` это потеря точности `Decimal`, но допустимо для аналитики (не для биллинга). `_aggregate_revenue` фильтрует период по `Bonus.created_at`, но группирует по `Referral.to_clinic_id` — клиники без рефералов выпадут из выборки (заполняются нулями в `out`). `func.to_char(...)` — Postgres-специфично, на SQLite-тестах сломается. Redis-обрывы безопасны (возврат None → пересчёт). `_cached_set` сериализует через `json.dumps(..., default=str)`.
- **Строк:** 327

## `backend/app/services/cost_service.py`

- **Назначение:** Cost Attribution — оценочная стоимость тенанта для платформы по сигналам: объём хранилища, API-запросы, минуты звонков, оценка строк БД. Считает `est_cost_rub` по захардкоженным тарифам и пишет помесячные снимки `TenantCostSnapshot`.
- **Ключевые элементы:**
  - Тарифы (Decimal): `STORAGE_RUB_PER_MB=0.5`, `API_RUB_PER_REQUEST=0.001`, `CALLS_RUB_PER_MINUTE=0.5`.
  - `_period_bounds(period)` — границы месяца `[start, next_month_start)`.
  - `_table_exists(db, table_name)` — через `to_regclass` (Postgres).
  - `_storage_mb`, `_api_requests`, `_calls_minutes`, `_db_rows_estimate` — сборщики сигналов на сырых SQL (`text(...)`), все с try/except на отсутствие таблиц.
  - `_calc_est_cost(storage_mb, api_requests, calls_minutes) -> Decimal` — с `.quantize(Decimal("0.01"))`.
  - `compute_costs(db, tenant_id, period) -> dict` — все сигналы + стоимость.
  - `snapshot_tenant(db, tenant_id, period)` — **upsert** снимка периода (`flush`, без commit).
  - `snapshot_all(db, period=None) -> int` — обходит активных тенантов, `commit` в конце; возвращает число успешных.
- **Зависимости:** `app.models.cost_attribution.TenantCostSnapshot`, `app.models.tenant.Tenant`, сырые SQL по таблицам `patient_documents`, `call_recordings`, `quota_usage`, `appointments`, `audit_log`, `users`.
- **Где менять для типовых задач:**
  - Поменять тарифы — константы строки 37-39 (в комментарии: «потом унесём в settings»).
  - Добавить новый сигнал стоимости — написать `_<signal>` + включить в `_calc_est_cost` и `compute_costs`.
  - Изменить источники объёма хранилища — список SQL в `_storage_mb` (строки 73-76).
  - Запускать снимки по крону — вызывать `snapshot_all` из крон-задачи.
- **Подводные камни:** все суммы корректно в `Decimal` (биллинг — здесь это важно, не float). `_db_rows_estimate` в комментарии говорит «appointments + patient_accounts + audit_log», но в коде считает `appointments + audit_log + users` (расхождение docstring vs реализация). Сырые SQL c именами таблиц захардкожены — при переименовании таблиц молча вернут 0 (try/except глушит `ProgrammingError`). `_table_exists`/`to_regclass` — Postgres-специфика, на SQLite не работает. `snapshot_tenant` делает `flush`, а commit — только в `snapshot_all`; при вызове `snapshot_tenant` отдельно нужен внешний commit.
- **Строк:** 241

## `backend/app/services/doctor_ai_service.py`

- **Назначение:** Оркестратор AI кабинета врача (глава 6). Две задачи — pre-visit briefing (рекомендации к приёму) и структурированный план лечения. Реализует каскад провайдеров **Claude → Gemini → rule-based** и нормализацию/парсинг JSON-ответов модели.
- **Ключевые элементы:**
  - `_has_gemini()`, `_ai_chat(messages, system, max_tokens) -> (provider_name, raw_dict)` — выбор провайдера (Claude приоритетнее), бросает `RuntimeError` если оба ключа пусты.
  - `_try_parse_json(text)` — снимает ```` ```json ```` обёртку + грубый bracket-scan для извлечения сбалансированного JSON.
  - **Briefing:** `_BRIEFING_SYSTEM` (промпт), `_briefing_user_prompt(context)`, `_rule_based_briefing(context)` (эвристики: аллергии, хронические, АД ≥140/90, возраст 60+, жалоба на боль), `async generate_briefing_recommendations(context) -> dict`.
  - **Treatment plan:** `_PLAN_SYSTEM`, `_PLAN_SCHEMA_HINT` (JSON-схема goal/stages/medications/diagnostics/follow_ups/lifestyle/red_flags), `_plan_user_prompt(...)`, `_rule_based_plan(...)`, `async generate_treatment_plan(diagnosis, symptoms, approach, context) -> dict`.
  - Унифицированный возврат: `{data, ai_provider, tokens_in, tokens_out, latency_ms, success}`.
- **Зависимости:** `app.services.claude_service` (приоритетный провайдер), `app.services.gemini_service.chat_completion` (резерв), `app.config.settings`. Вызывается роутером кабинета врача (он добавляет работу с БД).
- **Где менять для типовых задач:**
  - Сменить приоритет/добавить провайдера — `_ai_chat` (строки 45-60).
  - Поправить промпты — `_BRIEFING_SYSTEM`/`_PLAN_SYSTEM`/`*_user_prompt`/`_PLAN_SCHEMA_HINT`.
  - Изменить rule-based fallback — `_rule_based_briefing` / `_rule_based_plan`.
  - Поправить парсинг кривого JSON от модели — `_try_parse_json`.
  - Сменить лимиты токенов — `max_tokens` в вызовах `_ai_chat` (briefing 1200, plan 3000).
- **Подводные камни:** на медицинском контенте критично — везде есть rule-based fallback и `success: False` при сбое AI, не падает. `_try_parse_json` может вернуть `None` → тогда briefing/plan уходят в fallback. Sanitize обрезает поля (`type[:24]`, `text[:240]`, `goal[:600]`) — длинные ответы режутся. Gemini жёстко на `gemini-2.5-flash` (строка 57). Всё async — `generate_*` обязательно `await`.
- **Строк:** 401

## `backend/app/services/document_service.py`

- **Назначение:** Сервис файлового хранилища медицинских документов пациента (глава 9): валидация типа/размера, запись на диск в `/app/data/patient_docs/{patient_id}/{uuid}.{ext}`, метаданные в `PatientDocument`, листинги с учётом видимости, soft-delete.
- **Ключевые элементы:**
  - Константы: `HEALTH_DOC_ROOT=Path("/app/data/patient_docs")`, `MAX_HEALTH_DOC_BYTES=20MB`, `ALLOWED_CATEGORIES`, `ALLOWED_VISIBILITY` (`patient_only`/`patient_and_doctors`/`tenant_admins`), `ALLOWED_EXTENSIONS`, `ALLOWED_MIME`.
  - `_safe_ext(filename, mime)`, `is_allowed_filetype(filename, mime)`, `_patient_dir(patient_id)`.
  - `async save_patient_document(db, *, patient_id, patient_phone, tenant_id, filename, mime, contents, title, description, category, visibility, uploaded_by_user_id) -> PatientDocument` — валидация + запись файла + flush.
  - `serialize_document(d) -> dict` — DTO для API.
  - `list_patient_documents(db, patient_id)` — все не-удалённые (для самого пациента).
  - `get_document(db, doc_id)`, `soft_delete_document(db, doc)` (проставляет `deleted_at`).
  - `list_documents_for_doctor(db, patient_id)` — только видимость `patient_and_doctors`/`tenant_admins`.
- **Зависимости:** `app.models.patient_document.PatientDocument`, stdlib `pathlib/os/uuid`.
- **Где менять для типовых задач:**
  - Добавить тип файла/категорию/уровень видимости — соответствующие множества (строки 33-47) + `_safe_ext`.
  - Изменить лимит размера — `MAX_HEALTH_DOC_BYTES`.
  - Сменить путь хранения — `HEALTH_DOC_ROOT` (на хосте это volume `/opt/clinika/data`).
  - Добавить поле в ответ API — `serialize_document`.
  - Логика доступа врача — `list_documents_for_doctor` (фильтр видимости).
- **Подводные камни:** **tenant_id не фильтруется в листингах** — `list_patient_documents`/`list_documents_for_doctor` ищут только по `patient_id` (tenant-изоляция полагается на то, что `patient_id` уже привязан к тенанту через роутер; проверять при правках). `soft_delete_document` лишь ставит `deleted_at` и **не делает flush/commit** — нужен внешний commit; файл на диске остаётся (не удаляется физически). `doc_type="other"` — легаси-поле, реальная классификация в `category`. Запись файла синхронная (`write_bytes`) внутри async-функции — на больших файлах блокирует event loop.
- **Строк:** 194

## `backend/app/services/email_service.py`

- **Назначение:** Транзакционный email-сервис (этап 10): обёртка над `aiosmtplib`. Если `SMTP_HOST` пуст — тихий no-op (возврат False, без 500). Содержит два готовых сценария: welcome-письмо руководителю клиники (Jinja2-шаблон) и письмо сброса пароля. Не для массовых рассылок.
- **Ключевые элементы:**
  - `_smtp_configured()` / `is_smtp_configured()` — настроен ли SMTP (по `smtp_host`).
  - `async send_email(to, subject, body_html, body_text, *, from_addr, from_name, timeout=15.0) -> bool` — сборка MIME, выбор implicit-SSL (465) vs STARTTLS (587), ленивый импорт `aiosmtplib`.
  - `async send_email_background(*args, **kwargs)` — fire-and-forget.
  - `schedule_email(*args, **kwargs)` — планирует task в текущем event loop (или `asyncio.run` если loop нет).
  - `_mask_email(addr)` — маскировка для логов (пароли никогда не логируются).
  - `_render_welcome_template(ctx)` — Jinja2 из `app/templates/welcome_manager.html` (с plaintext-fallback при отсутствии jinja2).
  - `async send_welcome_email_to_manager(user, tenant, plaintext_password, *, subject_prefix, role_doc_path) -> dict` — `{sent, reason?}`.
  - `async send_password_reset(email, raw_token, *, base_url, tenant_slug, full_name) -> bool` — HTML-письмо со ссылкой; в dev (без SMTP) пишет `[FORGOT-PWD-DEV]` с raw-токеном в лог.
  - Публичные домены/ссылки захардкожены: `_PUBLIC_DOMAIN="https://клиниксеть.рф"`, calls/wiki/support-константы.
- **Зависимости:** `app.config.settings` (smtp_*), внешние `aiosmtplib` и `jinja2` (оба ленивые/опциональные), шаблон `backend/app/templates/welcome_manager.html`.
- **Где менять для типовых задач:**
  - Поменять домен/ссылки в письмах — константы строки 166-171.
  - Изменить выбор TLS-режима — блок строк 109-114 в `send_email`.
  - Дизайн reset-письма — inline-HTML в `send_password_reset` (строки 338-367).
  - Дизайн welcome-письма — шаблон `welcome_manager.html` (не в этом файле).
  - Добавить новый тип письма — новая `async send_*` поверх `send_email`.
- **Подводные камни:** при незаданном SMTP всё «успешно» молчит (возврат False, без исключений) — отправка не гарантирована; роутер `/auth/forgot-password` всё равно отдаёт 200 (анти-энумерация). Пароли/токены НЕ логируются (email маскируется `_mask_email`), **кроме** dev-ветки `[FORGOT-PWD-DEV]`, которая ОСОЗНАННО пишет raw-токен в лог — не включать в проде с реальными адресами. `schedule_email` через `asyncio.get_event_loop()` — на новых версиях Python даёт DeprecationWarning вне loop. HTML→text fallback — грубый regex.
- **Строк:** 376

## `backend/app/services/encryption_service.py`

- **Назначение:** Криптографическая утилита: (1) обратимое шифрование секретов в БД через Fernet с graceful-fallback на `plain:` при отсутствии cryptography/ключа; (2) необратимый blind-hash PII (телефон/email/имя) с tenant-pepper для exact-match-поиска без раскрытия данных.
- **Ключевые элементы:**
  - **Шифрование:** `_derive_fernet_key()` (SHA-256 от `settings.secret_key` → base64 url-safe 32 байта), `_get_fernet()` (ленивый singleton), `encrypt(plain) -> "enc:..."|"plain:..."`, `decrypt(token) -> str|None` (понимает `enc:`/`plain:`/без префикса для легаси-записей).
  - **Blind-hash:** `_PII_PEPPER` из env `PII_HASH_PEPPER`, `normalize_phone(phone)` (только цифры, 8→7), `hash_phone`, `normalize_email`, `hash_email`, `hash_text` (для нормализованного имени) — все SHA-256(value + pepper), 64 hex.
- **Зависимости:** `app.config.settings.secret_key` (с fallback на env `SECRET_KEY`), опциональный `cryptography.fernet`. Pepper из `PII_HASH_PEPPER` хранится ОТДЕЛЬНО от SECRET_KEY (компрометация одного не открывает другое).
- **Где менять для типовых задач:**
  - Сменить алгоритм деривации ключа — `_derive_fernet_key` (осторожно: расшифровка старых записей сломается при смене ключа/алгоритма).
  - Добавить новый тип blind-hash (например, по СНИЛС) — по образцу `hash_phone`.
  - Изменить нормализацию телефона (другие страны) — `normalize_phone`.
- **Подводные камни:** **fallback `plain:` означает, что при незаданном SECRET_KEY/отсутствии cryptography секрет ляжет в БД в открытом виде с префиксом `plain:`** — для прода ключ обязателен. `decrypt` для строки без известного префикса возвращает её как есть (совместимость со старыми данными). `_fernet` кешируется глобально — смена ключа в рантайме не подхватится. Все функции синхронные (не async). Pepper по умолчанию пустой (`""`) — без него хэши детерминированы по самому значению (хуже rainbow-table-стойкость) — задать `PII_HASH_PEPPER` в проде.
- **Строк:** 139

## `backend/app/services/engagement_analytics.py`

- **Назначение:** Аналитика вовлечённости пациентов личного кабинета (ЛК) для CRM-hub: топ-карточки дашборда, heatmap логинов 7×24, retention-когорты, воронка (funnel), список churn-риска, «застрявшие в воронке».
- **Ключевые элементы (все async, на сырых SQL/ORM):**
  - `dashboard_summary(db, tenant_id) -> dict` — total/new_7d/active_7d/30d/90d, churn_60d_loyal, birthdays_next_7d.
  - `login_heatmap(db, days=30) -> list[dict]` — 7×24 по `patient_sessions.created_at`, нормализация Postgres DOW (вс=0) к пн=0 через `(d+6)%7`.
  - `retention_cohorts(db, weeks=8) -> list[dict]` — недельные когорты с week1..week4 % возврата (CTE).
  - `funnel_summary(db, tenant_id, days=30) -> dict` — registration → first_login → repeat_login → appointment (с conversion-rate между ступенями).
  - `churn_list(db, tenant_id, days_threshold=60, limit=100)` — loyal-пациенты (login_count≥3 + визит в тенанте), которые давно не заходили.
  - `stuck_in_funnel(db, tenant_id, opens_threshold=3, limit=100)` — по `ad_events` (click без conversion) как прокси.
- **Зависимости:** модели `PatientAccount`, `PatientSession`; сырые SQL по таблицам `patient_accounts`, `patient_sessions`, `appointments`, `ad_events`.
- **Где менять для типовых задач:**
  - Поправить пороги (60 дней churn, 7-дневные ДР, окна активности) — соответствующие функции.
  - Добавить ступень воронки — массив `stages` в `funnel_summary`.
  - Сменить горизонт когорт — аргумент `weeks` и `INTERVAL` в `retention_cohorts`.
- **Подводные камни:** **`PatientAccount` НЕ tenant-изолирована** (явно отмечено в docstring `dashboard_summary`): `total/new/active/churn/birthdays` считаются ПО ВСЕМ аккаунтам платформы, игнорируя `tenant_id` — это осознанное упрощение, но при показе цифр в кабинете конкретной клиники они «общеплатформенные», а не по тенанту. Tenant-фильтр применяется только там, где есть join с `appointments.tenant_id` (`funnel`, `churn_list`, `stuck_in_funnel`). Связь сессий с аккаунтами идёт по `phone`, а не по FK — возможны рассинхроны при разных форматах телефона. Много сырого Postgres-SQL (`EXTRACT`, `DATE_TRUNC`, `INTERVAL`) — на SQLite-тестах не пройдёт. В `retention_cohorts` `weeks` подставляется и в f-string SQL (строка 98), и как bind-параметр `:weeks` (LIMIT) — f-string `weeks` приходит из аргумента функции (не из пользовательского ввода), но это смешение стилей; следить за SQL-инъекцией если `weeks` станет внешним.
- **Строк:** 244

## `backend/app/services/family_service.py`

- **Назначение:** Бизнес-логика семейных профилей пациента (глава 8): группа с одним владельцем, добавление членов по телефону, приглашения по токену, права доступа (просмотр записей / запись на приём / управление платежами).
- **Ключевые элементы (async):**
  - `get_or_create_account_by_phone(db, phone, name, birth_date) -> (PatientAccount, is_new)` — поиск по `phone_variants`, иначе создание.
  - `get_account_by_phone(db, phone)`.
  - `get_or_create_group(db, owner, tenant_id, name) -> FamilyGroup` — создаёт группу + члена `self` для владельца со всеми правами.
  - `list_members(db, group_id) -> list[dict]` — члены с раскрытием `PatientAccount`.
  - `find_membership(db, group_id, member_id)`, `is_member_of(db, group_id, patient_id)`.
  - `create_invite(db, group_id, inviter_id, invitee_phone, invitee_name, relation) -> FamilyInvite` — токен `secrets.token_urlsafe(32)`, статус `pending`.
  - `find_invite_by_token(db, token)`.
  - `accept_invite(db, invite, accepting_account) -> FamilyMember` — проверки: статус pending, не истёк (`expires_at`), совпадение телефона; идемпотентность если уже член.
  - `VALID_RELATIONS = {self, spouse, child, parent, sibling, other}`.
- **Зависимости:** модели `FamilyGroup/FamilyMember/FamilyInvite`, `PatientAccount`; утилиты `app.utils.phone.normalize_phone`, `phone_variants`.
- **Где менять для типовых задач:**
  - Добавить тип родства — `VALID_RELATIONS` (иначе подменяется на `"other"`).
  - Изменить дефолтные права нового члена — `accept_invite` (строки 200-203: `can_manage_payments=False`).
  - Логику истечения инвайтов — проверка `expires_at` в `accept_invite` (само значение `expires_at` задаётся в модели/при создании, не здесь).
  - Поведение «несколько групп на владельца» — `get_or_create_group` сейчас допускает ровно одну группу на владельца.
- **Подводные камни:** все методы делают `flush()`, **не `commit()`** — нужен внешний commit на уровне роутера/зависимости. Сопоставление телефонов через `phone_variants` (разные форматы) — корректность зависит от `app.utils.phone`. `accept_invite` строго требует совпадения нормализованного телефона аккаунта и инвайта (защита от чужого принятия). `tenant_id` у группы опционален (`tenant_id | None`) — семейные данные потенциально кросс-тенантные; учитывать при доступе.
- **Строк:** 210

## `backend/app/services/feature_flag_service.py`

- **Назначение:** Сервис фиче-флагов с детерминированной раскаткой и A/B-тестами. Главная точка входа `is_enabled(db, flag_key, tenant_id)` возвращает `(enabled, variant)`. Двухуровневый Redis-кеш (флаг + override), TTL 60s, безопасный при обрывах Redis.
- **Ключевые элементы:**
  - Кеш-ключи: `ff:flag:<key>`, `ff:override:<flag_id>:<tenant_id>`; `CACHE_TTL=60`.
  - Redis-хелперы: `_get_redis`, `_cache_get`, `_cache_set`, `_cache_delete`.
  - Лоадеры с кешем: `_load_flag(db, flag_key)` (снимок метаданных флага), `_load_override(db, flag_id, tenant_id)`. «null» в кеше = отрицательный результат.
  - Детерминизм: `_bucket(flag_key, tenant_id, modulo=10000)` = HMAC-SHA256(key=flag_key, msg=tenant_id) → 0..9999; `_pick_variant(flag_key, tenant_id, variants)` — выбор взвешенного варианта.
  - `async is_enabled(db, flag_key, tenant_id) -> (bool, str|None)` — логика по `RolloutStrategy`: `all` / `tenants` (только явные override) / `percentage` (bucket < pct*100) / `ab_test` (всегда enabled + variant).
  - `invalidate_flag_cache(flag_key)`, `invalidate_override_cache(flag_id, tenant_id)` — вызывать после изменений в админке.
- **Зависимости:** `redis.asyncio`, `app.config.settings.redis_url`, модели `FeatureFlag`, `RolloutStrategy`, `TenantFeatureFlag`.
- **Где менять для типовых задач:**
  - Добавить новую стратегию раскатки — добавить значение в `RolloutStrategy` (модель) + ветку в `is_enabled` (строки 228-249).
  - Сменить TTL кеша — `CACHE_TTL`.
  - Изменить алгоритм бакетинга/семантику процентов — `_bucket` / `_pick_variant`.
  - После любого изменения флага/override в админке — обязательно дёргать `invalidate_*` (иначе до 60s рассинхрон).
- **Подводные камни:** детерминизм важен — один и тот же `(flag_key, tenant_id)` всегда даёт один bucket; **смена `flag_key` = новая случайная раскатка** (нельзя переименовывать ключ без потери стабильности эксперимента). `tenant_id=None` (system job) возвращает `default_enabled`, игнорируя override/раскатку. Стратегия `ab_test` по умолчанию считается «включённой» (enabled=True), различение делается по `variant != "control"` на стороне вызывающего. Redis-промахи безопасны (идём в БД). Всё async — `await`.
- **Строк:** 267

## `backend/app/services/fiscal/base.py`

- **Назначение:** Абстрактный контракт ОФД-провайдера (54-ФЗ) и DTO чека. Все конкретные адаптеры (Платформа ОФД, Первый ОФД, Атол.Онлайн и т.д.) наследуют `BaseOfdProvider`.
- **Ключевые элементы:**
  - `@dataclass FiscalReceiptData` — DTO одного чека: `inn`, `operation_type` (sale|refund_sale|sale_correction), `total_sum: Decimal`, `qr_code`, `fiscal_doc_number` (ФД), `fiscal_storage_number` (ФН), `fiscal_sign` (ФП), `receipt_at`, `raw_payload: dict`.
  - `class BaseOfdProvider(ABC)` — атрибут `name`, `__init__(config)` (хранит `OFDConfig`), абстрактные корутины `pull_receipts(since) -> list[FiscalReceiptData]` и `verify_inn(inn) -> bool`.
- **Зависимости:** только stdlib (`abc`, `dataclasses`, `datetime`, `decimal`). Это база для трёх адаптеров в этом же пакете.
- **Где менять для типовых задач:**
  - Добавить общий метод всем провайдерам (например `send_receipt` в контракт) — объявить здесь абстрактным и реализовать во всех адаптерах (сейчас `send_receipt` есть только у Платформы ОФД, не в базе).
  - Добавить поле в DTO чека — `FiscalReceiptData`.
- **Подводные камни:** `total_sum` — `Decimal` (правильно для денег). Контракт минимален (только `pull_receipts` + `verify_inn`); рабочий `platforma_ofd_adapter` имеет больше методов (`send_receipt`, `get_receipt_status`), которых нет в базе — провайдеры неоднородны по API.
- **Строк:** 46

## `backend/app/services/fiscal/atol_online_adapter.py`

- **Назначение:** Адаптер Атол.Онлайн (cloud-касса + ОФД) — **заглушка**, методы бросают `NotImplementedError`.
- **Ключевые элементы:** `class AtolOnlineProvider(BaseOfdProvider)`, `name="atol_online"`; `pull_receipts` и `verify_inn` не реализованы (в тексте исключения — подсказки по реальным эндпоинтам `/possystem/v5/getToken`, `/sell`, `/companies/<inn>`).
- **Зависимости:** `app.services.fiscal.base` (`BaseOfdProvider`, `FiscalReceiptData`).
- **Где менять для типовых задач:** реализовать тело `pull_receipts`/`verify_inn` по API v5 (getToken → access-token → sell/list). Базовый URL `https://online.atol.ru/possystem/v5/`.
- **Подводные камни:** **МЁРТВЫЙ/НЕРЕАЛИЗОВАННЫЙ код** — выбор этого провайдера в рантайме приведёт к `NotImplementedError`. Для реальной фискализации использовать `platforma_ofd_adapter`.
- **Строк:** 29

## `backend/app/services/fiscal/perv_ofd_adapter.py`

- **Назначение:** Адаптер «Первый ОФД» — **заглушка**, методы бросают `NotImplementedError`.
- **Ключевые элементы:** `class PervOfdProvider(BaseOfdProvider)`, `name="perv_ofd"`; `pull_receipts`/`verify_inn` не реализованы (подсказки: `/api/v2/receipts` с `Authorization: Bearer`, `/api/v2/companies/inn/<inn>`).
- **Зависимости:** `app.services.fiscal.base`.
- **Где менять для типовых задач:** реализовать API-токен-аутентификацию и `/api/v2/receipts`. Документация: `https://www.1-ofd.ru/api/`.
- **Подводные камни:** **МЁРТВЫЙ/НЕРЕАЛИЗОВАННЫЙ код** — `NotImplementedError` при использовании. Аналог `atol_online_adapter` — обе заглушки.
- **Строк:** 26

## `backend/app/services/fiscal/platforma_ofd_adapter.py`

- **Назначение:** Единственный рабочий ОФД-адаптер (Платформа ОФД, 54-ФЗ): аутентификация Bearer-токеном с кешированием и авто-refresh при 401, отправка чека на фискализацию, опрос статуса, постраничный pull чеков для синхронизации кроном.
- **Ключевые элементы:**
  - Маршруты: `_PATH_AUTH="/api/v1/auth"`, `_PATH_RECEIPTS="/lkapi/v3/receipts"`, `_PATH_RECEIPT_ONE="/lkapi/v3/receipts/{id}"`; `DEFAULT_BASE`, `HTTP_TIMEOUT=25.0`.
  - `class PlatformaOfdProvider(BaseOfdProvider)`, `name="platforma_ofd"`, кеш токена в инстансе (`_token`, `_token_expires_at`, `_token_lock`).
  - Креды: `_credentials() -> (login, password, api_base)` — приоритет `OFDConfig.config` (dict) → `OFDConfig.api_key` (`"login:password"`) → ENV (`PLATFORMA_OFD_LOGIN/PASSWORD/API_BASE`). `_company_inn()` (`OFDConfig.inn` или `COMPANY_INN`), `_tax_system()` (`COMPANY_TAX_SYSTEM`, default `general`).
  - `_authenticate(force=False)` — POST /auth, кеш токена до `expires_in`/`ttl` (default 1h), под `asyncio.Lock`. `_http()` — клиент с Bearer. `_request(method, url, *, json, params)` — авто-refresh на 401 (2 попытки).
  - `send_receipt(order_id, items, payment_method, total, customer_email_or_phone)` — нормализует items (Decimal price/qty, vatRate `vatNN`/`vatNo`, paymentSubject/Method), формирует body sale, возвращает `{ofd_id, fiscal_doc_number, fiscal_sign, status, raw}`.
  - `get_receipt_status(ofd_id)` — реквизиты чека (ФД/ФН/ФП/QR).
  - `pull_receipts_page(date_from, date_to, page, page_size=100)` и `pull_receipts(since) -> list[FiscalReceiptData]` (постранично, safety-stop 100 стр.), `_row_to_receipt(row)` (маппинг raw→DTO), `verify_inn(inn)`.
- **Зависимости:** `httpx` (AsyncClient), `app.services.fiscal.base`, `OFDConfig` (передаётся в `__init__`), ENV-переменные. Используется кроном синхронизации чеков и роутером фискализации.
- **Где менять для типовых задач:**
  - Под другой контракт/версию API Платформы ОФД — пути `_PATH_*` (строки 42-44; в шапке отмечено, что v1/v2/v3 варьируются по тарифу).
  - Поля чека (НДС, признак предмета/способа расчёта) — нормализация в `send_receipt` (строки 233-246).
  - Маппинг ответа на DTO — `_row_to_receipt` (разные имена полей API учтены через `or`).
  - Срок жизни/логику токена — `_authenticate`.
  - Таймаут HTTP — `HTTP_TIMEOUT`.
- **Подводные камни:** деньги — везде `Decimal` с `.quantize(Decimal("0.01"))`, но **в JSON-body уходят как `float(...)`** (требование контракта API; для самих расчётов точность сохранена). При отсутствии кредов/ИНН — `RuntimeError` (роутер должен отдавать 503). Кеш токена — на уровне инстанса провайдера (один процесс); в шапке упоминается «опционально Redis», но в коде Redis-кеша токена НЕТ — комментарий опережает реализацию. `_token_lock` создаётся лениво (цикл может ещё не существовать). `pull_receipts` имеет safety-stop на 100 страниц (логирует warning). `verify_inn` — суррогат («есть ли хоть один чек/договор»), т.к. публичного метода проверки ИНН у Платформы ОФД нет. Все методы async.
- **Строк:** 376
