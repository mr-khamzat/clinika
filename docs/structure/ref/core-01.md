# core [01] — ядро: аутентификация, RBAC, middleware-конвейер, лимиты, безопасность

Это `backend/app/core/` — фундамент бэкенда МИС Clinika (FastAPI, multi-tenant SaaS). Здесь живут все **поперечные (cross-cutting) механизмы**, которые работают до бизнес-логики роутеров: проверка JWT и ролей (`deps.py`, `permissions.py`), резолв тенанта и RLS (`tenant.py`, `deps.get_tenant_db`), весь стек HTTP-middleware (rate-limit, блокировка IP, disaster-режим, кастомные домены, метрики), криптография (`security.py`, `token_blacklist.py`), а также «гейты» доступа по тарифу/подписке/региону/модулю. Почти каждый роутер проекта зависит от 2-4 файлов из этой группы через `Depends(...)`. Здесь же — два настоящих APIRouter'а (`prometheus.py` → `/metrics`, `domain_router.py` → `/.well-known/...`), оба подключены в `main.py` без префикса.

Ключевая архитектурная идея изоляции тенантов: JWT хранит **только** `sub=user_id` (tenant_id в токене обычно нет), поэтому tenant резолвится из БД по пользователю, а изоляция данных обеспечивается Postgres RLS через `SET LOCAL app.tenant_id` (см. `deps.get_tenant_db`). Все «гейты» (limits, subscription, region, feature/module) единообразно: **super_admin и юзер без tenant_id всегда проходят**, отсутствие лицензии/подписки трактуется как legacy-тенант и пропускается (fail-open), а внутренние ошибки гейтов не блокируют запрос.

| Файл | Назначение в 5-7 слов | Строк |
|---|---|---|
| `api_key_deps.py` | Авторизация публичного API по ключу + rate-limit | 101 |
| `block_ip_middleware.py` | Middleware: блок IP из таблицы blocked_ips | 89 |
| `deps.py` | JWT-аутентификация, проверка ролей, RLS-сессия | 193 |
| `disaster_middleware.py` | Файл-флаг: read-only режим обслуживания | 119 |
| `domain_router.py` | Кастомные CNAME-домены тенантов + верификация | 131 |
| `limits.py` | Проверка лимитов тарифа (клиники/юзеры) | 109 |
| `logging.py` | Настройка structlog (JSON/консоль) | 54 |
| `permissions.py` | RBAC-матрица ролей + tenant-override + кэш | 334 |
| `prometheus.py` | Метрики Prometheus + middleware + /metrics | 115 |
| `rate_limit_middleware.py` | Per-tenant rate-limit на Redis sliding-window | 240 |
| `region_lock.py` | Гейт блокировки доступа по гео-региону/вручную | 195 |
| `request_ctx.py` | ContextVar: текущий Request + impersonator | 18 |
| `scheduler.py` | APScheduler с Redis/Memory jobstore | 28 |
| `security.py` | JWT, пароли, QR/patient/portal-токены | 204 |
| `security_utils.py` | IDOR-проверка + глобальный rate-limiter | 97 |
| `subscription_guard.py` | Гейт write-операций по статусу подписки | 95 |
| `tenant.py` | Резолв тенанта + гейты фич/модулей | 115 |
| `token_blacklist.py` | Redis-чёрный список отозванных JWT (jti) | 41 |

---

## `backend/app/core/deps.py`
- **Назначение:** Центральный модуль аутентификации и авторизации по JWT. Резолвит `User` из Bearer-токена, набор фабрик ролевых зависимостей и сессию БД с RLS.
- **Ключевые элементы:**
  - `get_current_user()` — основной dependency: декодирует токен, грузит активного `User`, обрабатывает impersonation (claim `imp=true` → пишет `current_impersonator` в contextvar).
  - Ролевые гейты: `require_admin`, `require_manager`, `require_reports_access`, `require_partner_or_above`, `require_franchise_owner`, `require_super_admin`, `require_director`, `require_director_or_owner`.
  - `require_role(*roles)` — фабрика по строковым именам ролей (super_admin всегда проходит).
  - `get_current_tenant()` — грузит `Tenant` юзера (403 если без тенанта). **NB: дубль с `tenant.py`!**
  - `get_tenant_db()` — выдаёт сессию с `SET LOCAL app.tenant_id` для RLS.
- **Зависимости:** `app.core.security.decode_token`, `app.models.user` (User, UserRole), `app.models.tenant.Tenant`, `app.database.get_db`, `app.config.settings` (lazy, в `require_super_admin`), `app.core.request_ctx.current_impersonator` (lazy).
- **Где менять для типовых задач:** добавить новую роль-зависимость для роутера — пишите новую `require_*` функцию здесь по образцу; изменить какие роли считаются «админами» — правьте кортежи `UserRole` внутри соответствующих `require_*`; включить RLS на эндпоинте — замените `Depends(get_db)` на `Depends(get_tenant_db)`.
- **Подводные камни:**
  - **Два разных `get_current_tenant`** — этот (бросает 403) и в `tenant.py` (возвращает `None`). Импортируйте осознанно, иначе поведение «без тенанта» отличается.
  - RLS работает только через `get_tenant_db`; обычный `get_db` НЕ ставит `app.tenant_id` — ручная фильтрация по `tenant_id` остаётся на роутере.
  - `set_config(..., true)` с bind-параметром — это закрытая в прошлом SQL-инъекция (раньше был f-string). Не возвращайте f-string.
  - super_admin определяется и по роли, И по `username == settings.superadmin_username` — учитывайте оба условия.
- **Строк:** 193

## `backend/app/core/permissions.py`
- **Назначение:** RBAC поверх ролей — гранулярные права вида `referrals:write`. Базовая матрица в коде + per-tenant переопределения из БД с Redis-кэшем.
- **Ключевые элементы:**
  - `ROLE_PERMISSIONS: dict[UserRole, set[str]]` — источник правды по умолчанию.
  - `EDITABLE_ROLES` — какие роли франчайзи может настраивать в UI.
  - `get_all_actions()`, `get_default_permissions(role)`, `get_user_permissions(user)` (sync, без override), `get_user_permissions_effective(user, db)` (async, с override).
  - `has_permission(user, action, db)` — основная асинхронная проверка (super_admin → всегда True; override `True/False`; иначе fallback на код).
  - `require_permission(permission)` — фабрика FastAPI-зависимости (возвращает уже `Depends(...)`!).
  - Кэш: `_get_redis`, `_cache_get_override`, `_cache_set_override`, `invalidate_rbac_cache(tenant_id, role=None)`, `_load_override`, `get_effective_override`.
- **Зависимости:** `app.models.user` (User, UserRole), `app.core.deps.get_current_user`, `app.database.get_db`, `app.models.permission_override.TenantPermissionOverride` (lazy), `app.config.settings` (redis_url), `redis.asyncio`.
- **Где менять для типовых задач:** добавить новое право — добавьте строку-action в нужные роли в `ROLE_PERMISSIONS` (и оно автоматически попадёт в `get_all_actions()` для UI-матрицы); навесить право на эндпоинт — `Depends(require_permission("xxx:read"))` (без обёртки `Depends`, т.к. фабрика уже её возвращает); после изменения override в БД — обязательно `await invalidate_rbac_cache(tenant_id, role)`.
- **Подводные камни:**
  - `require_permission` уже возвращает `Depends(_check)` — НЕ оборачивайте повторно в `Depends(...)`. Это отличается от соседних фабрик `require_role`/`require_feature`, которые возвращают «голую» функцию.
  - Кэш-маркер `"__none__"` означает «override отсутствует» — не путайте с пустым dict.
  - Redis недоступен → тихий fallback на статическую матрицу (override игнорируется). При деградации Redis права «застывают» на коде.
  - `get_user_permissions` (sync, для `/auth/me`) не учитывает override — для эффективных прав использовать `_effective`.
- **Строк:** 334

## `backend/app/core/tenant.py`
- **Назначение:** Резолв тенанта/лицензии и гейты доступа к фичам и платным модулям.
- **Ключевые элементы:**
  - `get_current_tenant()` — возвращает `Tenant` или `None` (single-tenant/super_admin), 403 если тенант деактивирован.
  - `get_tenant_license()` — `TenantLicense` тенанта.
  - `require_feature(feature_name)` — фабрика: приоритет `tenant_modules` (явный override) > `license.features` JSONB > дефолты плана (через `app.modules.has_feature`).
  - `require_module(*module_keys)` — фабрика: проверяет активную/trial/grace подписку в `TenantModuleSubscription` (коммерческие модули), иначе 402.
- **Зависимости:** `app.core.deps.get_current_user`, `app.models.tenant` (Tenant, TenantLicense, TenantBranding, TenantModule), `app.models.commercial` (TenantModuleSubscription, ModuleStatus), `app.modules.has_feature` (lazy), `app.config.settings`, `app.database.get_db`.
- **Где менять для типовых задач:** закрыть эндпоинт за фичей плана — `dependencies=[Depends(require_feature("horeca"))]`; закрыть за платной подпиской на модуль — `Depends(require_module("module_key"))`; изменить приоритет резолва фич — правьте порядок в `require_feature.checker`.
- **Подводные камни:**
  - `get_current_tenant` здесь возвращает `None` для super_admin — это другой контракт, чем одноимённая функция в `deps.py` (та бросает 403). Следите за импортом.
  - `require_feature` и `require_module` возвращают «голую» `checker` — оборачивайте в `Depends(...)` на месте.
  - super_admin (по роли ИЛИ по `superadmin_username`) обходит обе проверки; юзер без `tenant_id` обходит `require_module`.
  - 402 у `require_module` против 403 у `require_feature` — разная семантика (оплата vs тариф).
- **Строк:** 115

## `backend/app/core/security.py`
- **Назначение:** Вся криптография: хэш паролей, генерация/декод JWT (access/refresh/patient/portal/appointment/session), подпись QR, проверка Telegram initData.
- **Ключевые элементы:**
  - Пароли: `hash_password` / `verify_password` (PBKDF2-SHA256, 260k итераций, формат `salt:hash`, сравнение через `hmac.compare_digest`).
  - Access: `create_access_token` (добавляет `exp`, `type=access`, `jti` для blacklist), `decode_token`.
  - Refresh: `create_refresh_token` → `(raw, hash)`, `hash_refresh_token`.
  - Пациентские/портальные токены: `make/verify_patient_token`, `decode_patient_token`, `make/verify_appointment_token`, `make_portal_token`/`decode_portal_token`, `make_patient_session_token`/`decode_patient_session_token`, `hash_session_secret`.
  - QR: `sign_qr`, `verify_qr_signature` (HMAC, первые 32 hex-символа).
  - Telegram: `verify_telegram_init_data` (`_is_dev_mode` → True если бот-токен не настроен).
- **Зависимости:** `app.config.settings` (secret_key, jwt_algorithm, qr_secret, telegram_bot_token). Внешних сервисов нет. Используется повсеместно: `deps`, `rate_limit_middleware`, auth-роутерами.
- **Где менять для типовых задач:** срок жизни токенов — `ACCESS_TOKEN_EXPIRE_MINUTES` (30) / `REFRESH_TOKEN_EXPIRE_DAYS` (30); новый тип токена — пишите пару `make_* / decode_*` по образцу portal-токена; усилить хэш — менять `260000` итераций (потребует ре-хэш существующих паролей).
- **Подводные камни:**
  - `decode_token` молча возвращает `None` при любой `JWTError` (включая истёкший токен) — вызывающий обязан проверять `if not payload`.
  - **Blacklist (`jti`) здесь не проверяется** — `decode_token` валиден даже для отозванного токена; ревокацию проверяет `token_blacklist.is_token_revoked` отдельно (если вызывается).
  - `_is_dev_mode()` отключает проверку Telegram-подписи когда токен бота не задан — в dev пропускает любой initData. Проверьте конфиг прода.
  - patient/portal-токены долгоживущие (90/365 дней) — компрометация даёт долгий доступ.
- **Строк:** 204

## `backend/app/core/token_blacklist.py`
- **Назначение:** Чёрный список отозванных access-токенов в Redis по `jti`, с TTL до истечения токена.
- **Ключевые элементы:** `_get_redis()` (ленивый singleton), `revoke_access_token(jti, exp)` (`SETEX bl:<jti>` на остаток жизни), `is_token_revoked(jti)`.
- **Зависимости:** `app.config.settings.redis_url`, `redis.asyncio`. Логически связан с `security.create_access_token` (тот кладёт `jti` в токен).
- **Где менять для типовых задач:** добавить логаут/принудительный разлогин — вызывайте `revoke_access_token(jti, exp)` при logout, а в `get_current_user` (deps.py) добавьте `await is_token_revoked(payload["jti"])` (СЕЙЧАС эта проверка в deps НЕ вызывается — см. камень).
- **Подводные камни:**
  - **Проверка ревокации не встроена в `deps.get_current_user`** — blacklist работает только там, где `is_token_revoked` вызывается явно. Если нужен полноценный logout — добавьте проверку в `get_current_user`.
  - Redis недоступен → исключение пробросится наверх (нет fail-open как в других модулях). Оборачивайте вызов при необходимости.
  - При TTL ≤ 0 запись не создаётся (токен уже истёк).
- **Строк:** 41

## `backend/app/core/request_ctx.py`
- **Назначение:** Два contextvar'а для cross-cutting доступа без передачи аргументов: текущий `Request` и контекст impersonation.
- **Ключевые элементы:** `current_request: ContextVar[Request | None]`, `current_impersonator: ContextVar[dict | None]` (структура `{actor_id, actor_name, target_id, target_name, reason}`).
- **Зависимости:** только `fastapi.Request`. Заполняется в `deps.get_current_user` (impersonator), читается в `audit_service`.
- **Где менять для типовых задач:** добавить новый сквозной контекст (например, request_id) — добавьте ещё один `ContextVar` сюда и заполняйте в middleware.
- **Подводные камни:** contextvar'ы НЕ копируются автоматически в новые таски (`asyncio.create_task`) если не передать контекст — фоновые задачи могут не увидеть impersonator. Всегда `default=None`, проверяйте на None.
- **Строк:** 18

## `backend/app/core/api_key_deps.py`
- **Назначение:** Зависимости для публичного API (`/api/v1/...`) — авторизация по API-ключу тенанта (`clk_live_...`) и проверка скоупов.
- **Ключевые элементы:**
  - `verify_tenant_api_key()` — резолвит ключ из `Authorization: Bearer` или `X-Clinika-API-Key`, валидирует через `api_key_service.verify_raw_key` (revoked/expired/IP-allowlist), проверяет rate-limit, кладёт ключ в `request.state.api_key`.
  - `require_scope(*scopes)` — фабрика: требует хотя бы один скоуп.
  - In-process rate-limit: `_RATE_LIMIT_PER_HOUR=1000`, `_check_rate_limit`, `_rate_buckets` (deque), `_client_ip`.
- **Зависимости:** `app.services.api_key_service`, `app.models.tenant_api_key.TenantApiKey`, `app.database.get_db`.
- **Где менять для типовых задач:** новый защищённый публичный эндпоинт — `Depends(require_scope("scope:name"))`; изменить лимит публичного API — `_RATE_LIMIT_PER_HOUR`/`_RATE_WINDOW_SEC`; логировать `api.request` в аудите — данные уже в `request.state.api_key` / `api_key_tenant_id`.
- **Подводные камни:**
  - Rate-limit **in-process** (deque в памяти процесса) — сбрасывается при рестарте и НЕ шарится между воркерами/репликами. Для распределённого лимита нужен Redis (как в `rate_limit_middleware`).
  - Это отдельный от JWT-стека путь авторизации — tenant_id берётся из ключа (`key_obj.tenant_id`), не из User. RLS здесь не ставится автоматически.
- **Строк:** 101

## `backend/app/core/limits.py`
- **Назначение:** Проверка лимитов тарифного плана при создании ресурсов (клиники/пользователи).
- **Ключевые элементы:** `PLAN_DEFAULTS` (basic/professional/enterprise, -1 = безлимит), `check_plan_limit(resource, tenant_id, db)` — бросает HTTP 402 с детальным payload при достижении лимита.
- **Зависимости:** `app.models.tenant.TenantLicense`, `app.models.clinic.Clinic`, `app.models.user.User`.
- **Где менять для типовых задач:** новый тип лимитируемого ресурса — добавьте ветку `elif resource == "..."` со своим `count` и лимитом из лицензии; изменить дефолтные лимиты планов — `PLAN_DEFAULTS` (но реально лимиты берутся из `TenantLicense.max_clinics/max_users`, дефолты — резерв).
- **Подводные камни:**
  - `PLAN_DEFAULTS` фактически НЕ используется в `check_plan_limit` (лимит читается напрямую из лицензии) — частично мёртвый словарь/резерв для других мест.
  - Нет лицензии → пропуск (legacy), `tenant_id=None` → пропуск (super_admin), `limit < 0` → безлимит. Это явная вызываемая функция, НЕ FastAPI-зависимость — зовите вручную в роутере перед созданием.
  - Считает только `is_active == True` — мягко удалённые не учитываются в лимите.
- **Строк:** 109

## `backend/app/core/subscription_guard.py`
- **Назначение:** Гейт write-операций по статусу подписки тенанта (trial/grace/expired/cancelled/past_due).
- **Ключевые элементы:** `GRACE_PERIOD_DAYS=3`, `require_active_subscription()` — FastAPI-зависимость: 402 с разными `error`-кодами в зависимости от `SubStatus`.
- **Зависимости:** `app.core.deps.get_current_user`, `app.models.billing` (Subscription, SubStatus), `app.database.get_db`.
- **Где менять для типовых задач:** защитить write-эндпоинт — `dependencies=[Depends(require_active_subscription)]`; изменить grace-период — `GRACE_PERIOD_DAYS`; добавить обработку нового статуса подписки — добавьте ветку по `sub.status`.
- **Подводные камни:**
  - super_admin / нет tenant_id / нет подписки (legacy) → пропуск (fail-open).
  - Берётся **последняя** подписка по `created_at desc` — если у тенанта несколько записей, активная может быть «перекрыта» более новой неактивной. Проверяйте инварианты в billing-логике.
  - Это только write-гейт — read остаётся доступным даже при истёкшей подписке (вешать только на POST/PUT/PATCH/DELETE).
- **Строк:** 95

## `backend/app/core/region_lock.py`
- **Назначение:** Гейт-зависимость, блокирующая запросы по гео-региону франшизы (auto-block) или вручную (manual block), с bypass через IP-allowlist.
- **Ключевые элементы:**
  - `enforce_region_lock()` — основной Depends: manual block (приоритет) → auto-region block (только при `region_strict=True` и заданном `allowed_region`) → IP-allowlist bypass → geoip lookup → сравнение → 403 + мягкий аудит/Telegram через `check_violation`.
  - `enforce_region_lock_login()` — placeholder для `/auth/login` (реальная проверка внутри хендлера логина).
  - `_client_ip(request)` — приоритет `X-Real-IP`, fallback на **последний** IP в `X-Forwarded-For` (анти-spoof).
  - Константы префиксов 403: `BLOCK_MESSAGE_PREFIX`, `MANUAL_BLOCK_PREFIX` (фронт ловит их для модалки).
- **Зависимости:** `app.core.deps.get_current_user`, `app.services.region_lock_service` (`_load_franchise_for_tenant`, `is_ip_allowlisted`, `_matches`, `check_violation`), `app.services.geoip_service.lookup` (lazy), `app.models.user`, `app.database.get_db`, raw SQL к `franchise_ip_allowlist`.
- **Где менять для типовых задач:** навесить регион-блок на чувствительный роутер — `dependencies=[Depends(enforce_region_lock)]`; изменить логику IP-определения — `_client_ip` (критично для безопасности — XFF spoof'ится); изменить сравнение регионов — `region_lock_service._matches`.
- **Подводные камни:**
  - **Граничный fail-open повсюду**: нет IP / нет geo / любая внутренняя ошибка → НЕ блокирует (логирует warning). Это намеренно, но означает, что блокировка не гарантирована при деградации geoip.
  - **Приоритет X-Real-IP над XFF и взятие последнего элемента XFF** — историческая P0-правка против обхода. Не меняйте на «первый XFF».
  - При HTTPException транзакция откатилась бы — поэтому аудит коммитится явно (`db.commit()`) перед raise.
  - `enforce_region_lock_login` сейчас — пустой placeholder (`return`), реальная логика дублирована в login-хендлере.
- **Строк:** 195

## `backend/app/core/block_ip_middleware.py`
- **Назначение:** HTTP-middleware: отклоняет (403) запросы с IP, заблокированных super_admin'ом в таблице `blocked_ips`. Кэш в памяти на 30 сек.
- **Ключевые элементы:** `BlockIpMiddleware(BaseHTTPMiddleware)` с `dispatch`, `_get_ip`, `_refresh_cache` (под `asyncio.Lock`), `invalidate()` (сброс кэша из роутера). `BLOCK_CACHE_TTL=30`, `SKIP_PATHS=(/health, /health/full, /metrics)`.
- **Эндпоинты:** нет (middleware). Регистрируется в `main.py:1532` (`BlockIpMiddleware`), инстанс кладётся в `app.state.block_ip_mw` для инвалидации.
- **Зависимости:** `app.services.security_service.get_active_blocked_ips` (lazy).
- **Где менять для типовых задач:** добавить путь, который нельзя блокировать — `SKIP_PATHS`; ускорить применение блокировки — уменьшить `BLOCK_CACHE_TTL` или вызывать `app.state.block_ip_mw.invalidate()` после block/unblock.
- **Подводные камни:**
  - Кэш в памяти процесса — не шарится между воркерами/репликами; на нескольких процессах блокировка применяется до TTL рассинхронизированно.
  - Health/metrics НИКОГДА не блокируются (иначе watchdog не достучится) — намеренно.
  - При ошибке обновления кэша expires ставится +5 сек (быстрый ретрай), кэш может временно опустеть → блок временно не действует (fail-open).
- **Строк:** 89

## `backend/app/core/disaster_middleware.py`
- **Назначение:** Режим обслуживания через файл-флаг: при наличии флага все mutation-запросы → 503, GET остаются read-only.
- **Ключевые элементы:** `is_disaster_mode()`, `get_flag_info()`, `enable_disaster_mode(reason)`, `disable_disaster_mode()`, `disaster_middleware(request, call_next)`. `_CANDIDATES` (пути флага), `_WHITELIST_PREFIXES` (health/docs/admin/system), `_MUTATION_METHODS`.
- **Эндпоинты:** нет (функция-middleware). Регистрируется в `main.py:1557` через `app.middleware("http")`.
- **Зависимости:** `app.core.logging.get_logger`. Управляется из `/admin/system/...` роутеров (которые в whitelist, чтобы можно было снять флаг).
- **Где менять для типовых задач:** добавить путь, доступный в disaster-режиме — `_WHITELIST_PREFIXES`; включать/выключать программно — `enable_disaster_mode` / `disable_disaster_mode`; изменить Retry-After — в JSONResponse (300 сек).
- **Подводные камни:**
  - Путь флага выбирается по существованию **родительской** директории из `_CANDIDATES`; на Windows-dev все unix-пути не существуют → fallback `/tmp/...` (тоже не Windows-путь). Этот механизм рассчитан на Linux-контейнер.
  - `enable/disable` зовут `_flag_path()` независимо — если окружение разное между запросом и проверкой, флаг может «не найтись».
  - Блокируются только `POST/PUT/PATCH/DELETE`; всё остальное (включая OPTIONS) проходит.
- **Строк:** 119

## `backend/app/core/domain_router.py`
- **Назначение:** Поддержка кастомных CNAME-доменов тенантов: middleware резолвит tenant по `Host`, плюс роутер для верификации владения доменом.
- **Ключевые элементы:** `DomainRouterMiddleware` (пишет `request.state.custom_domain_slug`), `_PLATFORM_HOSTS` (домены, не требующие lookup), `router` с двумя эндпоинтами.
- **Эндпоинты:** (роутер подключён в `main.py:1636` без префикса)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |---|---|---|---|---|---|
  | GET | `/.well-known/clinika-domain/{tenant_id}` | публичный | tenant_id (path) | text `clinika-domain-{id}` | Выдаёт challenge-токен если у тенанта задан custom_domain |
  | POST | `/.well-known/clinika-domain/{tenant_id}/verify` | публичный | tenant_id (path) | `{verified, domain/error}` | Проверяет доступность challenge по домену → `domain_verified=True` |

- **Зависимости:** `app.database.AsyncSessionLocal`, `app.models.tenant` (Tenant, TenantBranding), `httpx` (lazy). Middleware ставит slug, который читают SPA-роутеры/фронт.
- **Где менять для типовых задач:** добавить платформенный домен (без lookup) — `_PLATFORM_HOSTS`; изменить формат challenge-токена — синхронно в `domain_challenge` и `verify_domain` (`expected`).
- **Подводные камни:**
  - Middleware ловит любую ошибку lookup и тихо проходит (`except Exception: pass`) — резолв домена fail-open.
  - `verify_domain` ходит по **http** (не https) на custom_domain с timeout 10с — потенциальный SSRF-вектор/блокирующий внешний вызов на каждый verify.
  - Эндпоинты публичные, без авторизации — challenge-токен предсказуем (`clinika-domain-{id}`), это лишь proof-of-control, не секрет.
- **Строк:** 131

## `backend/app/core/prometheus.py`
- **Назначение:** Метрики Prometheus: определения метрик, middleware сбора HTTP-статистики и защищённый эндпоинт `/metrics`.
- **Ключевые элементы:** метрики `http_requests_total` (Counter), `http_request_duration_seconds` (Histogram), `active_websockets` / `db_pool_checked_out` (Gauge), `app_info` (Info); `_normalize_path` (UUID/числа → `{id}`); `metrics_middleware`; `router` с `/metrics`.
- **Эндпоинты:** (роутер подключён в `main.py` без префикса; middleware на `main.py:1633`)

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |---|---|---|---|---|---|
  | GET | `/metrics` | token (`?token=`/`X-Metrics-Token`) или localhost | — | text Prometheus exposition | Экспорт метрик |

- **Зависимости:** `prometheus_client`, `app.config.settings` (metrics_token), lazy: `app.routers.presence.presence_manager` (кол-во WS), `app.database.engine` (pool).
- **Где менять для типовых задач:** добавить новую метрику — определите Counter/Gauge на уровне модуля и инкрементируйте где нужно; изменить нормализацию путей (кардинальность лейблов) — `_normalize_path`; защитить иначе — логика в `prometheus_metrics`.
- **Подводные камни:**
  - Без `metrics_token` доступ только с захардкоженных internal-IP (`127.0.0.1`, `::1`, `172.18.0.1`, `172.19.0.1`) — при смене docker-сети их надо обновить.
  - `_normalize_path` через regex — высокая кардинальность лейблов если путь не нормализован (риск раздувания памяти Prometheus). Проверяйте новые форматы id.
  - `app_info` захардкожен `version=1.0.0, environment=production`.
- **Строк:** 115

## `backend/app/core/rate_limit_middleware.py`
- **Назначение:** Per-tenant rate-limiting на Redis sliding-window; IP-fallback для анонимных. Считает RPD для последующего flush в quota_usage.
- **Ключевые элементы:** `RateLimitMiddleware(BaseHTTPMiddleware)` (`enabled` флаг, ленивый Redis); `_resolve_tenant_id` (JWT claim `tid`/`tenant_id` → Redis-кэш `user_tenant:{sub}`); `_extract_tenant_from_jwt`; `_get_rpm_limit` (кэш `_QUOTA_CACHE`, TTL 60с); `invalidate_quota_cache`; `_get_client_ip`. `SKIP_PATHS`, `IP_FALLBACK_RPM=1000`.
- **Эндпоинты:** нет (middleware). Регистрируется в `main.py:1521` ПОСЛЕ глобального `SlidingWindowRateLimiter`.
- **Зависимости:** `app.config.settings.redis_url`, `app.services.quota_service` (get_quota, check_rpm, increment_usage), `app.core.security.decode_token` (lazy), `app.models.api_quota.DEFAULT_REQUESTS_PER_MINUTE` (lazy), `app.database.get_db`.
- **Где менять для типовых задач:** изменить анонимный лимит — `IP_FALLBACK_RPM`; per-tenant лимит берётся из `TenantQuota.requests_per_minute` (правьте в quota_service/БД); после изменения квоты тенанта — `invalidate_quota_cache(tenant_id)`; добавить исключённый путь — `SKIP_PATHS`.
- **Подводные камни:**
  - **Tenant резолвится только если JWT содержит claim `tid`/`tenant_id` ИЛИ есть Redis-кэш `user_tenant:{sub}`.** В этом проекте JWT обычно хранит только `sub` — без этого кэша middleware скатывается в IP-fallback, и per-tenant лимит не применяется (см. длинный комментарий в коде).
  - Redis недоступен → fail-open (пропуск всех запросов). Лимиты не действуют при деградации Redis.
  - `_QUOTA_CACHE` — in-memory, не шарится между процессами; инвалидация локальна.
- **Строк:** 240

## `backend/app/core/security_utils.py`
- **Назначение:** IDOR-защита тенанта + глобальный (per-IP) sliding-window rate-limiter на Redis с in-memory fallback.
- **Ключевые элементы:** `assert_tenant_owns(resource_tenant_id, current_tenant_id)` (403 при несовпадении, пропуск super_admin и глобальных ресурсов); класс `SlidingWindowRateLimiter` (callable middleware, `_get_ip`, `_check_redis` через ZSET-pipeline, `_check_memory`).
- **Эндпоинты:** нет. `SlidingWindowRateLimiter(limit=200, window=60)` регистрируется в `main.py:1516` как глобальный middleware.
- **Зависимости:** `app.config.settings.redis_url`, `redis.asyncio` (lazy). `assert_tenant_owns` — чистая функция, зовётся вручную в роутерах.
- **Где менять для типовых задач:** проверить владение ресурсом в роутере — `assert_tenant_owns(obj.tenant_id, current_tenant_id)`; изменить глобальный лимит — параметры в `main.py:1516` (`limit`, `window`); skip-пути — аргумент `skip_paths`.
- **Подводные камни:**
  - `_check_redis` создаёт **новое** Redis-соединение на КАЖДЫЙ запрос (`from_url` + `aclose`) — накладные расходы; не переиспользует pool (в отличие от `rate_limit_middleware`).
  - `assert_tenant_owns` пропускает ресурсы с `resource_tenant_id is None` как «глобальные» — убедитесь, что у tenant-ресурсов поле всегда заполнено, иначе IDOR-проверка молча пропустит.
  - При недоступности Redis — fallback на `_check_memory` (per-process, не шарится).
- **Строк:** 97

## `backend/app/core/logging.py`
- **Назначение:** Инициализация structlog: JSON в production, цветная консоль в dev.
- **Ключевые элементы:** `setup_logging(json_logs=True)` (вызывать один раз при старте), `get_logger(name)`. Глушит `sqlalchemy.engine`/`httpx`/`httpcore` до WARNING.
- **Зависимости:** `structlog`, stdlib `logging`. Используется по всему проекту через `get_logger`.
- **Где менять для типовых задач:** добавить процессор логов (например, маскирование PII) — в `shared_processors`; приглушить ещё один шумный логгер — в кортеж `noisy`; переключить формат — аргумент `json_logs`.
- **Подводные камни:** `basicConfig(level=INFO)` — DEBUG не пишется по умолчанию. `cache_logger_on_first_use=True` — менять конфигурацию после первого `get_logger` уже поздно; вызывайте `setup_logging` до создания логгеров.
- **Строк:** 54

## `backend/app/core/scheduler.py`
- **Назначение:** Единый экземпляр APScheduler для фоновых задач (квота-флаш, рассылки и т.п.) с Redis-jobstore и fallback на память.
- **Ключевые элементы:** `create_scheduler()` (пытается `RedisJobStore` на db=1, иначе `MemoryJobStore`), модульный singleton `scheduler`. Дефолты джоб: `coalesce=True`, `max_instances=1`, `misfire_grace_time=300`.
- **Зависимости:** `apscheduler`, `app.config.settings.redis_url` (lazy в try). Джобы регистрируются извне (в lifespan/`main.py`).
- **Где менять для типовых задач:** добавить периодическую задачу — `scheduler.add_job(...)` в lifespan приложения; сменить jobstore/БД Redis — `create_scheduler` (db=1); изменить дефолты пропусков — `job_defaults`.
- **Подводные камни:**
  - Парсинг `redis_url` примитивный (split по `://` и `:`) — нестандартный URL (с паролем/схемой `rediss://`/путём БД) распарсится неверно → молчаливый fallback на MemoryJobStore (джобы не переживут рестарт и не шарятся между процессами).
  - Singleton создаётся на импорте — при нескольких воркерах каждый получит свой scheduler; на Redis-сторе джобы общие, на Memory — дубли. Следите, чтобы джобы регистрировались в одном процессе.
- **Строк:** 28

---

**Сводные риски группы:**
- Несколько rate-limit / кэш-механизмов **in-process** (`api_key_deps`, `block_ip_middleware`, `_QUOTA_CACHE`, `permissions`-кэш fallback, `security_utils._memory`) — не шарятся между воркерами/репликами; за распределённость отвечает только Redis, а почти все модули при его падении делают **fail-open**.
- Дубль `get_current_tenant` в `deps.py` (бросает 403) и `tenant.py` (возвращает None) — разный контракт.
- Фабрики зависимостей возвращают разное: `require_permission` уже отдаёт `Depends(...)`, остальные (`require_role`, `require_feature`, `require_module`) — «голую» функцию.
- Изоляция тенантов держится на RLS через `get_tenant_db`; обычный `get_db` её не ставит — ручная фильтрация по `tenant_id` остаётся на роутерах.
- Blacklist токенов (`token_blacklist`) существует, но не вызывается из `get_current_user` — полноценный logout требует доработки `deps.py`.
