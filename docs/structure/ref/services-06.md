# services [06] — Push-уведомления, квоты, рефералы, регламенты, безопасность и seed-скрипты модулей

Это срез сервисного слоя `backend/app/services/` (файлы 76–90 по алфавиту). Группа разнородная, но все файлы — это **бизнес-логика без HTTP** (роутеров среди них нет; вызываются из роутеров, middleware, cron-задач scheduler'а и других сервисов). Логически делятся на пять подгрупп:

1. **Web Push** — `push_service` (низкоуровневая отправка VAPID) и `push_dispatcher` (рассылка сотрудникам клиники при сообщении пациента).
2. **Квоты и rate-limit** — `quota_service` (Redis hot-path + flush в Postgres).
3. **Реферальное ядро платформы** — `referral_service` (создание/подтверждение направлений, расчёт бонусов и комиссий, межклиничные счета), `qr_service` (QR-коды), `recommendations_service` (эвристические подсказки франчайзи), `region_lock_service` (гео-контроль франшиз).
4. **Регламент-конструктор (Глава 7)** — `regulation_service` (CRUD/версионирование/доступ) и `regulation_ai_service` (AI-генерация черновиков через Gemini).
5. **Безопасность и сидинг** — `security_service` (threat-scan + security-аудит), `scheduling_service` (слоты врача), и 4 идемпотентных seed-скрипта коммерческих модулей (`seed_ai_assistant_module`, `seed_call_recording_module`, `seed_inventory_module`, `seed_ltv_module`).

Сквозные паттерны группы: почти все async-функции принимают `AsyncSession`; финансы в `referral_service` ведутся через `Decimal` для ledger, но float — для промежуточных расчётов бонусов (см. подводные камни); push/quota/region/security написаны в стиле «никогда не падай наружу» (всё в try/except с логом); tenant-изоляция реализована вручную фильтром по `tenant_id` (RLS не используется).

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `push_dispatcher.py` | Push сотрудникам при сообщении пациента | 145 |
| `push_service.py` | Низкоуровневая Web Push отправка (VAPID) | 302 |
| `qr_service.py` | Генерация/парсинг QR-кодов направлений | 38 |
| `quota_service.py` | API-квоты: Redis + flush в Postgres | 361 |
| `recommendations_service.py` | Эвристические подсказки для франчайзи | 344 |
| `referral_service.py` | Ядро направлений: создание, подтверждение, бонусы | 653 |
| `region_lock_service.py` | Гео-контроль региона франшизы | 206 |
| `regulation_ai_service.py` | AI-генерация черновиков регламентов (Gemini) | 272 |
| `regulation_service.py` | Регламенты: версии, доступ, сериализация | 461 |
| `scheduling_service.py` | Свободные слоты врача и бронирование | 127 |
| `security_service.py` | Threat-scan, security-аудит, blocked IP | 579 |
| `seed_ai_assistant_module.py` | Seed модуля ai_assistant в каталог | 83 |
| `seed_call_recording_module.py` | Seed модуля call_recording в каталог | 81 |
| `seed_inventory_module.py` | Seed модуля inventory в каталог | 79 |
| `seed_ltv_module.py` | Seed модуля ltv_pro (DEPRECATED) | 57 |

---

## `backend/app/services/push_dispatcher.py`

- **Назначение:** Когда пациент пишет в чат-тред клиники (`chat_threads`), рассылает Web Push всем сотрудникам клиники с подходящей ролью. Тонкая обёртка-«диспетчер» над `push_service.send_push_to_user`.
- **Ключевые элементы:**
  - `NOTIFY_ROLES` — кортеж ролей-получателей: `reg, nurse, manager, director, deputy_director, franchise_owner`.
  - `_truncate(s, n=80)` — обрезка тела сообщения с многоточием.
  - `_resolve_patient_name(db, patient_id)` — имя пациента для заголовка (raw SQL по `patient_accounts`, fallback на phone → «Пациент»).
  - `notify_clinic_about_new_message(db, thread, message) -> int` — главная функция; возвращает суммарное число доставленных подписок, никогда не падает.
- **Зависимости:** `app.models.chat` (`ChatThread`, `ChatMessage`), `app.services.push_service.send_push_to_user`. Внутри использует raw SQL по таблицам `users` и `patient_accounts`.
- **Где менять для типовых задач:**
  - Добавить/убрать роль-получателя — правь `NOTIFY_ROLES`.
  - Изменить заголовок/тело/ссылку push — блок формирования `title`/`body`/`data` (строки 113–123), в т.ч. `click_url = /staff-chat?thread=...`.
  - Поменять источник имени пациента — `_resolve_patient_name`.
- **Подводные камни:**
  - Фильтрация по клинике идёт через `clinic_id`, **не** через `tenant_id` — изоляция держится на том, что `clinic_id` уникален в пределах тенанта.
  - Есть graceful-фоллбэк: если в `users` нет колонки `is_active` (легаси-схема), запрос повторяется без неё.
  - Защита от рассылки на собственные сообщения сотрудников: если `message.sender_type` задан и != `"patient"` — функция выходит с 0.
- **Строк:** 145

---

## `backend/app/services/push_service.py`

- **Назначение:** Низкоуровневый Web Push (VAPID) сервис. Управляет VAPID-ключами (env → БД `vapid_keys` → автогенерация), отправляет push через `pywebpush`, чистит мёртвые подписки (410/404). Если ключей/библиотеки нет — тихо отключается (возвращает 0/False, без 500).
- **Ключевые элементы:**
  - Модульный кеш `_vapid_cache`.
  - `_vapid_claims()` — sub-клейм (приоритет `vapid_claim_email` → `vapid_subject` → дефолт `mailto:admin@clinika.app`).
  - `_generate_vapid_keys()` — генерация пары через `py_vapid`/`cryptography`.
  - `_get_or_create_vapid(db)`, `get_vapid_public_key(db)`.
  - `_send_push_to_subscription(...) -> (success, is_gone)` — отправка на одну подписку, `is_gone=True` при 410/404.
  - `send_push_legacy(...)` — backward-compat alias (возвращает bool).
  - `_broadcast(rows, ...)` — рассылка на список, обновляет `last_used_at`, удаляет мёртвые подписки.
  - Адресные функции: `send_push_to_phone`, `send_push_to_all`, `send_push_to_user`, `send_push_to_patient`.
  - `send_push(db, title, body, *, user_id=None, patient_id=None, data=None) -> int` — универсальный вход (ТЗ Web Push 2026-05-16), требует хотя бы один из `user_id`/`patient_id`.
- **Зависимости:** `app.config.settings` (vapid_*), raw SQL по таблицам `vapid_keys` и `push_subscriptions`. Внешние: `pywebpush`, `py_vapid`, `cryptography` (все импортируются лениво/в try). Это нижний слой — его дёргают `push_dispatcher` и роутеры/сервисы пушей.
- **Эндпоинты:** нет (сервис).
- **Где менять для типовых задач:**
  - Источник/приоритет VAPID-ключей — `_get_or_create_vapid` и `_vapid_claims`.
  - Поведение при мёртвой подписке (какие статусы считать «gone») — `_send_push_to_subscription`, строка `if status in (404, 410)`.
  - Новый таргетинг (например, по `clinic_id`) — добавить функцию по образцу `send_push_to_user` + переиспользовать `_broadcast`.
  - Формат payload — `payload = json.dumps({"title", "body", "data"})` в `_send_push_to_subscription`.
- **Подводные камни:**
  - `webpush` синхронный — обёрнут в `loop.run_in_executor`, чтобы не блокировать event loop.
  - `_vapid_cache` — глобальный модульный кеш; при ротации ключей в БД он **не сбрасывается автоматически** (нужен рестарт процесса или ручной сброс).
  - `send_push_to_all` принимает `tenant_id`, но **игнорирует** его — шлёт реально всем подпискам в таблице (нет фильтра по тенанту!). Потенциальная утечка кросс-тенант: использовать осторожно.
  - Все функции возвращают 0 при `db=None` — это «тихий» режим, легко не заметить отсутствие доставки.
- **Строк:** 302

---

## `backend/app/services/qr_service.py`

- **Назначение:** Генерация и парсинг QR-кодов. Два сценария: подписанный QR направления (для подтверждения сканом администратором) и URL-QR (ссылка на пациентский кабинет).
- **Ключевые элементы:**
  - `generate_qr_data(referral_id) -> "REF:<id>:<signature>"` — подписывает через `sign_qr`.
  - `generate_qr_image_base64(referral_id) -> str` — PNG base64 с подписанными данными.
  - `generate_url_qr_base64(url) -> str` — PNG base64 для произвольного URL.
  - `parse_qr_data(qr_string) -> (referral_id, signature) | None` — разбор формата `REF:id:sig`.
- **Зависимости:** `app.core.security.sign_qr`; внешняя библиотека `qrcode`. Используется в `referral_service` (создание/подтверждение направлений).
- **Где менять для типовых задач:**
  - Формат полезной нагрузки QR (префикс `REF:`, число частей) — `generate_qr_data` + `parse_qr_data` (менять синхронно!).
  - Внешний вид QR (размер/рамка/цвета) — параметры `QRCode(version, box_size, border)` и `make_image(fill_color, back_color)`.
- **Подводные камни:**
  - `parse_qr_data` жёстко требует ровно 3 части и префикс `REF:` — любой другой формат вернёт `None`; проверка подписи — уже на стороне `referral_service` через `verify_qr_signature`.
  - Функции **синхронные** (не async) — это чистый CPU/IO в памяти.
- **Строк:** 38

---

## `backend/app/services/quota_service.py`

- **Назначение:** Сервисный слой API-квот тенанта. Hot-path (`rate_limit_middleware`) пишет счётчики в Redis (sliding/fixed window RPM, дневной RPD, storage, минуты звонков); периодический job scheduler'а перетекает их в таблицу `quota_usage` (UPSERT). Чтения для админки — из БД + live-добавка из Redis.
- **Ключевые элементы:**
  - Redis-ключи: `k_rpm`, `k_rpd`, `k_storage`, `k_calls`; `PENDING_SET = "quota:flush:pending"`.
  - БД: `get_quota(db, tenant_id)` (создаёт с дефолтами при отсутствии), `get_usage(db, tenant_id, period)`.
  - Redis: `increment_usage(redis, tenant_id, field, n)` (`field` ∈ requests/storage/calls), `check_rpm(redis, tenant_id, limit) -> (allowed, current, retry_after)`.
  - `flush_to_db(db, redis) -> int` — UPSERT в `quota_usage` по `uq_quota_usage_tenant_period`, sanity-check существования тенанта, SREM из pending.
  - `reset_usage(db, redis, tenant_id)` — обнуление БД+Redis.
  - `list_history(db, tenant_id, days=30)`.
- **Зависимости:** `app.models.api_quota` (`TenantQuota`, `QuotaUsage` + DEFAULT_* константы). Использует `pg_insert` (PostgreSQL ON CONFLICT). Внешний `redis` передаётся аргументом (не импортирует клиент сам).
- **Эндпоинты:** нет (сервис; читается роутером `/admin/quotas/*`).
- **Где менять для типовых задач:**
  - Новый тип счётчика — добавить ветку в `increment_usage` + поле в `flush_to_db` UPSERT + колонку в модели `QuotaUsage`.
  - Окно RPM/TTL ключей — `check_rpm` (`expire(key, 60)`) и `increment_usage` (TTL для rpd=48ч, calls=35д).
  - Дефолтные лимиты — константы `DEFAULT_*` в `app.models.api_quota` (тут только импортируются).
- **Подводные камни:**
  - `check_rpm` — это **fixed window**, не настоящий sliding (точность ±60с); при `redis=None` всё разрешает (fail-open).
  - Все Redis-операции в try/except с `return 0/True` — отказ Redis не ломает запрос, но и не считает квоту.
  - В `get_quota`/`get_usage` есть защита от гонки создания: при IntegrityError делается rollback и перечитывание.
  - `flush_to_db` пишет **абсолютные** значения (rpd-ключ — нарастающий total за день), не дельты; ошибка тут приведёт к двойному учёту.
- **Строк:** 361

---

## `backend/app/services/recommendations_service.py`

- **Назначение:** Multi-tenant эвристические рекомендации для `franchise_owner` (Глава 3 ROADMAP) — **без AI**, на основе агрегатов БД. Кешируется в Redis на 30 минут.
- **Ключевые элементы:**
  - `CACHE_TTL=1800`; `_get_redis`, `_cached_get`, `_cached_set`, `_make_id(*parts)` (sha1[:16]).
  - `generate_recommendations(db, franchise_id) -> list[dict]` — главная функция; формирует 5 типов рекомендаций:
    - `clinic_revenue_low` — клиника <65% медианы выручки (нужно ≥3 клиники).
    - `trial_expiring_soon` — триал ≤5 дней без онбординга.
    - `referral_conversion_drop` — конверсия упала ≥20% (последние 30 vs предыдущие 30 дней, порог ≥5 рефералов).
    - `module_unused` — активная подписка модуля >45 дней.
    - `bonus_avg_drop` — средний bonus упал ≥15%.
  - Сортировка результата по severity: critical → warning → info.
- **Зависимости:** модели `Bonus`/`BonusStatus`, `Clinic`, `commercial` (`ModuleStatus`, `TenantModuleSubscription`), `Appointment`, `Referral`/`ReferralStatus`, `Tenant`; `app.config.settings`; `redis.asyncio`; `statistics`.
- **Эндпоинты:** нет (сервис; читается роутером франчайзи-кабинета).
- **Где менять для типовых задач:**
  - Добавить новый тип рекомендации — добавить блок в `generate_recommendations` и пополнить структуру dict (`type/severity/title/description/action_url/affected_entity_*`).
  - Подкрутить пороги — константы внутри блоков (`* 0.65`, `days=5`, `-0.20`, `> 45`, `-0.15`).
  - TTL кеша — `CACHE_TTL`.
- **Подводные камни:**
  - Выручка считается через `func.sum(Bonus.amount)` и кастится в `float` — это **не** «реальная выручка клиники», а сумма бонусов (метрика-прокси); для денег используется float, не Decimal.
  - Фильтрация строго по `franchise_id` → `tenants` → `clinics` (правильная изоляция франшизы).
  - `module_unused` помечен как `info` намеренно — точных логов использования модуля нет, эвристика грубая (см. комментарий в коде).
  - Импорт `Appointment` присутствует, но в текущей версии не используется (потенциально мёртвый импорт).
- **Строк:** 344

---

## `backend/app/services/referral_service.py`

- **Назначение:** **Ядро реферальной механики платформы** — самый «денежный» файл среза. Создание направлений (с QR, коротким кодом, snapshot партнёрского payout, синхронизацией с МИС), подтверждение по QR/short-code и весь расчёт финансов: бонусы, комиссии, каскад рекрутеров, ledger, межклиничные счета (ICI) и platform_fee франшизного биллинга.
- **Ключевые элементы:**
  - `_generate_short_code(db)` — уникальный 5-значный код (до 100 попыток).
  - `create_referral(db, ...)` — создание; определяет `referral_type` (service/doctor), снимает snapshot payout из `PartnerServiceOffer`, генерирует оба QR, ретраит commit при IntegrityError на `short_code` (до 5 раз), затем fire-and-forget создаёт пациента/запись в МИС.
  - `_get_setting(db, key, default, tenant_id)` — per-tenant обёртка над `settings_service.get_setting` (фикс #5 — изоляция тенантов).
  - `_apply_confirmation(db, referral, confirmed_by)` — идемпотентное подтверждение под `pg_advisory_xact_lock` + `FOR UPDATE` (фикс #1 — защита от двойного бонуса), начисление лояльности, МИС-синхронизация.
  - `_finalize_bonus_and_ledger(db, referral, *, confirmed_by)` — **вся денежная логика в одном месте** (фикс #6): payout/commission/каскад рекрутера, `Bonus(REGULAR/COMMISSION)`, ledger `BONUS_ACCRUED`, `RecruiterBonus`, авто-`InterClinicInvoice`, `BillingLedger` platform_fee.
  - `confirm_referral(db, qr_string, ...)` и `confirm_referral_by_short_code(db, short_code, ...)` — публичные входы с tenant-isolation.
- **Зависимости (богатые внутренние связи):** модели `Referral`/`ReferralStatus`, `Bonus`/`BonusType`, `Service`, `SystemSettings`, `Doctor`, `User`, `RecruiterBonus`, `Clinic`, `PartnerServiceOffer`, `Franchise`, `Tenant`, `BillingLedger`; сервисы `qr_service`, `core.security` (`verify_qr_signature`, `make_patient_token`), `settings_service.get_setting`, `mis_client` (`_post`, `find_patient_by_phone`, `add_patient`), `ledger_service` (`add_entry`, `OpType`), `inter_clinic_invoice_service.auto_create_from_referral`, `loyalty_ext_service.award_referral`, `audit_service.write_safe`.
- **Эндпоинты:** нет (сервис; обслуживает роутеры направлений и подтверждений).
- **Где менять для типовых задач:**
  - Формула бонуса/комиссии/каскада — **только** `_finalize_bonus_and_ledger` (единая точка для ручного и авто-подтверждения через `auto_confirm`).
  - Логика «внешнее vs внутреннее» направление (бонус только за cross-clinic) — guard `is_external` в начале `_finalize_bonus_and_ledger` (строки 313–318).
  - platform_fee франшизы — блок `effective_fee = max(spread, franchise_fee, 0)` (фикс #11).
  - Snapshot партнёрского payout — блок в `create_referral` (строки 85–102); меняй здесь, чтобы иммутабельность payout не ломалась задним числом.
  - Поведение синхронизации с МИС — fire-and-forget блоки в `create_referral` и `_apply_confirmation`.
- **Подводные камни:**
  - **Decimal vs float:** ledger/platform_fee считаются в `Decimal` (`_D`), но `payout_amount`/`bonus_total`/комиссия — в `float` с `round(..., 2)`. Смешение типов — частый источник погрешностей; при правках держи деньги в одном типе.
  - **Двойной бонус:** защита держится на `pg_advisory_xact_lock(hashtext(rid))` + `FOR UPDATE` + идемпотентный выход при `status == CONFIRMED`. Не убирать lock при рефакторинге.
  - Tenant-isolation: `confirm_*` пропускают super_admin (`confirming_user_tenant_id is None`), иначе требуют совпадения `referral.tenant_id`; «не найдено» намеренно маскирует чужой тенант.
  - Все МИС-вызовы — `fire-and-forget` в try/except (не прерывают основную операцию); ошибки только логируются.
  - `_finalize_bonus_and_ledger` делает много `db.flush()` (чтобы получить id бонусов) — порядок flush/commit критичен.
- **Строк:** 653

---

## `backend/app/services/region_lock_service.py`

- **Назначение:** Гео-контроль франшиз: платформа продаёт франшизы по регионам; при несоответствии `geo_region` пользователя и `franchise.allowed_region` фиксирует нарушение в `audit_log` (`region.violation`) и шлёт Telegram-алерт владельцу платформы. Phase 1 — только мониторинг; Phase 2 (при `region_strict=True`) — блокировка.
- **Ключевые элементы:**
  - `ACTION_REGION_VIOLATION = "region.violation"`; модульный дедуп `_alert_dedup` (30 мин на связку франшиза×регион).
  - `_normalize(s)` — приведение региона (lower, только alnum).
  - `_matches(geo, allowed)` — сравнение с допуском подстроки в обе стороны; пустой allowed или пустой geo → не нарушение.
  - `_load_franchise_for_tenant(db, tenant_id)`.
  - `is_ip_allowlisted(db, franchise_id, ip)` — Postgres `<<=` (ip ∈ cidr) по `franchise_ip_allowlist`.
  - `_should_alert(franchise_id, geo_region)` — дедуп + чистка кеша при >500 ключей.
  - `check_violation(db, *, tenant_id, geo_region, ...) -> bool` — главная функция; пишет AuditEntry + alert, никогда не коммитит и не падает.
- **Зависимости:** модели `AuditEntry`, `Tenant`, `Franchise`; `app.services.alert_service` (`_send_telegram`). Raw SQL по `franchise_ip_allowlist`.
- **Эндпоинты:** нет (сервис; вызывается из middleware/сервисов перед целевым действием).
- **Где менять для типовых задач:**
  - Логика сопоставления региона (форматы «RU-IN», «Республика Ингушетия») — `_normalize` и `_matches`.
  - Период дедупа алертов — `_DEDUP_MINUTES`.
  - Перейти к Phase 2 (реальная блокировка) — добавить ветку по `franchise.region_strict` после `check_violation` (сейчас флаг только пишется в audit/алерт).
  - Текст Telegram-алерта — блок формирования `text` (строки 181–199).
- **Подводные камни:**
  - **Никогда не коммитит** — `db.flush()` only; коммит ожидается от вызывающей транзакции. Если забыть commit снаружи — нарушение не сохранится.
  - Полностью graceful: любое исключение → `return False` (нарушение мониторинга не должно ломать бизнес-операцию).
  - Защита от рекурсии: если `original_action == ACTION_REGION_VIOLATION` — выход.
  - Если geo не определилось (нет mmdb / приватный IP) — намеренно НЕ считается нарушением (fail-open).
- **Строк:** 206

---

## `backend/app/services/regulation_ai_service.py`

- **Назначение:** AI-генератор черновиков регламентов (SOP) для Главы 7. Тонкая обёртка над `gemini_service.chat_completion`; при недоступности Gemini или невалидном JSON — детерминированный rule-based-шаблон (~7 шагов).
- **Ключевые элементы:**
  - `_CATEGORY_HINTS` — маппинг роли → (категория, описание); `_hint_for_role(role)`.
  - `_rule_based(topic, role, existing_steps) -> dict` — fallback-шаблон.
  - `_parse_ai_json(text)` — извлечение JSON (чистый → ```json блок → первый `{...}`).
  - `_coerce_steps(raw)` — нормализация шагов (type ∈ text/checkbox/action/file, перенумерация order с 1).
  - `generate_regulation(*, topic, role, language='ru', existing_steps=None) -> dict` — главная функция; возвращает `{title, description, category, steps, ai_provider: "gemini"|"rule-based", latency_ms}`.
- **Зависимости:** `app.services.gemini_service.chat_completion` (модель `gemini-2.5-flash`, max_tokens=1800). Без БД и моделей — чистый AI-слой.
- **Эндпоинты:** нет (сервис; дёргается роутером конструктора регламентов).
- **Где менять для типовых задач:**
  - Промпты — `system_prompt`/`user_prompt` в `generate_regulation`.
  - Набор шагов fallback — `_rule_based`.
  - Допустимые типы шагов — `allowed_types` в `_coerce_steps` (держать синхронно с `ALLOWED_STEP_TYPES` в `regulation_service`/моделях).
  - Сменить модель/провайдера — параметр `model=` и сам импорт `chat_completion`.
- **Подводные камни:**
  - Всегда возвращает валидный dict: при любой ошибке/пустом steps падает в rule-based с пометкой `ai_provider="rule-based"` — вызывающий код не получит исключение.
  - Результат — **черновик**: реальная нормализация/сохранение делается уже в `regulation_service.normalize_steps`/`create_*_version` (две похожие функции `_coerce_steps` здесь и `normalize_steps` там — следить за расхождением).
- **Строк:** 272

---

## `backend/app/services/regulation_service.py`

- **Назначение:** Сервис «Регламент-конструктор» (Глава 7): нормализация шагов, версионирование (draft/publish), контроль доступа по ролям, сбор «моих» регламентов, сериализация в dict, подсчёт целевой аудитории. Все запросы фильтруются по `tenant_id`.
- **Ключевые элементы:**
  - Доступ: `_role_value(user)`, `is_super_admin`, `can_manage_regulations` (super_admin + franchise_owner), `can_read_regulations` (все кроме patient).
  - `normalize_steps(raw) -> list[dict]` — канонизация шагов (тип из `ALLOWED_STEP_TYPES`, перенумерация order).
  - Версии: `create_initial_version`, `create_new_version` (next version_number), `publish_version` (ставит `current_version_id`, status=PUBLISHED).
  - `list_assigned_for_user(db, *, user)` — регламенты, доступные юзеру (по роли в `assigned_roles` + точечные `regulation_assignments`), с флагом `completed`.
  - `user_has_access_to_regulation(db, *, user, reg) -> bool`.
  - Сериализация: `regulation_to_dict`, `version_to_dict`, `assignment_to_dict`, `completion_to_dict`.
  - `count_target_audience(db, *, regulation) -> int`.
- **Зависимости:** модели `User`/`UserRole`, `regulation` (`Regulation`, `RegulationVersion`, `RegulationAssignment`, `RegulationCompletion`, `RegulationStatus`, `ALLOWED_STEP_TYPES`, `ALLOWED_STATUSES`).
- **Эндпоинты:** нет (сервис; обслуживает роутеры регламентов).
- **Где менять для типовых задач:**
  - Кто может редактировать — `can_manage_regulations` / `user_has_access_to_regulation`.
  - Логика версий (publish/changelog) — `create_new_version` + `publish_version`.
  - Правила видимости «моих» регламентов — `list_assigned_for_user` (комбинация роли + assignments).
  - Состав карточки в API — `regulation_to_dict` / `version_to_dict`.
- **Подводные камни:**
  - Tenant-isolation строгая: всё, что не super_admin, ограничено `reg.tenant_id == user.tenant_id`; patient всегда `False`.
  - `assigned_roles` хранится как JSON-массив; видимость по роли — `Regulation.assigned_roles.contains([role])` (зависит от поддержки contains в диалекте — для PG ок).
  - `completed` считается по паре `(regulation_id, version_id)` — при публикации новой версии «прочитанность» сбрасывается (это by design — новую версию надо переподписать).
  - `_coerce_steps` из `regulation_ai_service` и `normalize_steps` здесь делают похожее, но не идентичны — при изменении набора типов шагов править оба.
- **Строк:** 461

---

## `backend/app/services/scheduling_service.py`

- **Назначение:** Сервис расписания врача: генерация свободных слотов на дату из шаблона `DoctorSchedule` и бронирование слота (`Appointment`) с проверкой конфликтов.
- **Ключевые элементы:**
  - `_time_slots(start, end, duration_min) -> list[(time, time)]` — нарезка интервала на слоты.
  - `get_available_slots(db, doctor_id, target_date) -> list[dict]` — слоты с флагом `available` (исключает PENDING/CONFIRMED).
  - `book_slot(db, doctor_id, appointment_date, start_time, ...) -> Appointment` — создаёт запись, бросает `HTTPException(409)` если занято / `404` если врача нет.
- **Зависимости:** модели `Doctor`, `DoctorSchedule`, `Appointment`, `AppointmentStatus`. Импортирует `fastapi.HTTPException` локально внутри функций.
- **Эндпоинты:** нет (сервис; дёргается роутерами записи/слотов).
- **Где менять для типовых задач:**
  - Длительность слота — `doctor.slot_duration` (поле модели Doctor); шаг нарезки в `_time_slots`.
  - Какие статусы считаются «занято» — список `status.in_([PENDING, CONFIRMED])` в `get_available_slots` и `book_slot` (держать синхронно).
  - День недели/шаблон — `DoctorSchedule.day_of_week` (0=Пн), фильтр `is_active`.
- **Подводные камни:**
  - `book_slot` делает только `db.flush()` (без commit) — коммитит вызывающий роутер.
  - Возможна **гонка**: между `get_available_slots` и `book_slot` слот может занять другой; защита — проверка `conflict` в `book_slot`, но без блокировки строки (нет advisory-lock как в referral). При высокой нагрузке возможен дабл-букинг по гонке вставки.
  - Сервисный слой смешивает бизнес-логику с `HTTPException` — нетипично для services-слоя (обычно ошибки — `ValueError`), при переиспользовании вне HTTP учитывать.
- **Строк:** 127

---

## `backend/app/services/security_service.py`

- **Назначение:** Сервис «Журнала безопасности»: тонкие обёртки логирования security-событий поверх `audit_service`, периодический threat-scan (brute-force по IP, short-code brute по юзеру, подозрительные тенанты), агрегаты для `/admin/security/summary` и список активных blocked IP для middleware. Новых таблиц не создаёт — всё в `audit_log`.
- **Ключевые элементы:**
  - Пороги: `THRESHOLD_FAILED_LOGIN_IP=5`/`WIN=5`, `THRESHOLD_SHORTCODE_USER=10`/`WIN=10`, `THRESHOLD_PERM_DENIED_TEN=10`, `ALERT_DEDUP_MINUTES=30`.
  - Логгеры: `log_login_failed`, `log_permission_denied`, `log_webhook_invalid`, `log_shortcode_failed`, `log_secrets_rotated` (все через `audit_service.write_safe`, никогда не падают).
  - Алерты: `_send_brute_force_alert`, `_send_shortcode_brute_alert` (через `alert_service.notify_admin` с dedup_key).
  - Сканеры: `_scan_failed_login_per_ip`, `_scan_shortcode_per_user`, `_scan_suspicious_tenants`.
  - `security_threat_scan_job()` — cron-вход (каждые 5 мин, открывает собственную `AsyncSessionLocal`).
  - `get_summary(db) -> dict` — counts 24ч, top-IP/users, bad_modules, активные impersonation, blocked_ips_count.
  - `get_active_blocked_ips() -> set[str]` — для `BlockIpMiddleware`.
- **Зависимости:** `app.database.AsyncSessionLocal`, модель `AuditEntry`, `audit_service` + `AuditAction`; лениво — `alert_service.notify_admin`, модели `ModuleHealthCheck`, `BlockedIp`.
- **Эндпоинты:** нет (сервис; читается роутером `/admin/security/*` и cron'ом scheduler).
- **Где менять для типовых задач:**
  - Пороги детекта/окна — константы `THRESHOLD_*` / `*_WIN` вверху файла.
  - Новый детектор угроз — добавить `_scan_*` функцию и вызвать её в `security_threat_scan_job`.
  - Состав сводки безопасности — `get_summary` (списки `actions_to_count`, `attack_actions`).
  - Новый тип security-события — добавить обёртку `log_*` + `AuditAction` в `audit_service`.
- **Подводные камни:**
  - Дедуп алертов двухуровневый: на уровне БД (нет свежего `*_BRUTE_FORCE_DETECTED` за `ALERT_DEDUP_MINUTES`) + на уровне Telegram (`dedup_key` в `notify_admin`).
  - `_scan_failed_login_per_ip` делает костыльный `UPDATE` записи brute_force, чтобы проставить `ip_address` (т.к. в cron нет request, а `write_safe` не принимает ip kwarg) — хрупкое место при рефакторинге audit-схемы.
  - `security_threat_scan_job` и `get_active_blocked_ips` открывают **свою** сессию (cron/middleware context); остальные функции принимают `db` извне.
  - Агрегаты по `audit_log` без явного `tenant_id`-фильтра — это намеренно платформенный (super_admin) обзор, не per-tenant.
- **Строк:** 579

---

## `backend/app/services/seed_ai_assistant_module.py`

- **Назначение:** Идемпотентный seed-скрипт: создаёт/обновляет запись коммерческого модуля `ai_assistant` в каталоге `commercial_modules`. Запускается вручную (`python -m app.services.seed_ai_assistant_module`).
- **Ключевые элементы:** `KEY="ai_assistant"`; `PAYLOAD` (name, price_monthly=2990, price_annual=32292 Decimal, category="ai", sort_order=85, config_schema с trial_days/model/escalation_threshold/system_prompt); `seed_ai_assistant_module()` — upsert по `key`.
- **Зависимости:** модель `CommercialModule`; создаёт собственный async-engine из `DATABASE_URL` (env, дефолт на `clinika-db`). Не использует общий `app.database`.
- **Эндпоинты:** нет (CLI seed-скрипт).
- **Где менять для типовых задач:**
  - Цена/описание/конфиг модуля ai_assistant — словарь `PAYLOAD`.
  - Все цены — **Decimal** (важно для денег, не float).
- **Подводные камни:**
  - Идемпотентность через upsert: если запись есть — обновляются ВСЕ поля из PAYLOAD (ручные правки в БД будут перетёрты при повторном запуске).
  - Скрипт глобальный (каталог модулей — не per-tenant), тенанта не касается.
  - Дублирует структуру остальных трёх seed-скриптов — типовой шаблон (см. также `scripts/seed_all.py`).
- **Строк:** 83

---

## `backend/app/services/seed_call_recording_module.py`

- **Назначение:** Идемпотентный seed модуля `call_recording` в `commercial_modules` (запись/расшифровка звонков). Запуск: `python -m app.services.seed_call_recording_module`.
- **Ключевые элементы:** `KEY="call_recording"`; `PAYLOAD` (price_monthly=3990, price_annual=43092 Decimal, category="telephony", sort_order=75, config_schema с whisper_model/max_recording_minutes_per_month/retention_days/auto_summary); `seed_call_recording_module()` — upsert по `key`.
- **Зависимости:** модель `CommercialModule`; собственный async-engine из `DATABASE_URL`.
- **Эндпоинты:** нет (CLI seed-скрипт).
- **Где менять для типовых задач:** цена/конфиг — `PAYLOAD`.
- **Подводные камни:** при повторном запуске перезаписывает все поля существующей записи; цены в Decimal. Идентичный шаблон остальным seed-скриптам — отличается только KEY/PAYLOAD.
- **Строк:** 81

---

## `backend/app/services/seed_inventory_module.py`

- **Назначение:** Идемпотентный seed модуля `inventory` в `commercial_modules` (учёт расходников/оборудования/медикаментов с алертами по остаткам и срокам). Запуск: `python -m app.services.seed_inventory_module`.
- **Ключевые элементы:** `KEY="inventory"`; `PAYLOAD` (price_monthly=1990, price_annual=21492 Decimal, category="operations", sort_order=60, config_schema с low_stock_alert/expiry_alert_days/allow_negative_stock); `seed_inventory_module()` — upsert по `key`.
- **Зависимости:** модель `CommercialModule`; собственный async-engine из `DATABASE_URL`.
- **Эндпоинты:** нет (CLI seed-скрипт).
- **Где менять для типовых задач:** цена/конфиг — `PAYLOAD`.
- **Подводные камни:** перезаписывает все поля при повторе; цены Decimal; типовой клон-шаблон. NB: `sort_order=60` совпадает с `seed_ltv_module` (ltv_pro) — порядок сортировки в каталоге между ними не детерминирован.
- **Строк:** 79

---

## `backend/app/services/seed_ltv_module.py`

- **Назначение:** **DEPRECATED.** Seed модуля `ltv_pro` (LTV-аналитика). Оставлен для совместимости со старыми docker-командами/ENV; официально заменён на `python -m scripts.seed_all --ltv` (реальный путь — `backend/scripts/seed_all.py`, подтверждён в репозитории).
- **Ключевые элементы:** `seed_ltv_module()` — создаёт `CommercialModule(key="ltv_pro", price_monthly=2990, price_annual=29900, category="analytics", sort_order=60)`.
- **Зависимости:** модель `CommercialModule`; собственный async-engine из `DATABASE_URL`.
- **Эндпоинты:** нет (legacy CLI seed-скрипт).
- **Где менять для типовых задач:** **НЕ менять здесь** — правки вносить в `backend/scripts/seed_all.py` (ветка `--ltv`). Этот файл — легаси-совместимость.
- **Подводные камни:**
  - В отличие от трёх других seed-скриптов, этот **НЕ идемпотентен в upsert-смысле**: при существующей записи просто печатает «пропускаем» и выходит, поля НЕ обновляет (расхождение поведения с `seed_ai_assistant`/`seed_inventory`/`seed_call_recording`).
  - Default `DATABASE_URL` не нормализует `postgresql://` → `postgresql+asyncpg://` (в отличие от трёх остальных) — при старой схеме URL может упасть.
  - Помечен DEPRECATED в докстринге — кандидат на удаление после миграции всех ENV/скриптов на `seed_all`.
- **Строк:** 57
