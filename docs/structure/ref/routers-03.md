# routers [03] — AI-аналитика, аутентификация, биллинг, звонки и чат-админка

Этот срез (15 файлов `backend/app/routers/*.py`) объединяет разнородные, но смежные по «обвязке» роутеры FastAPI: платформенный AI (база знаний FAQ + аналитика SaaS), drill-down аналитика тенанта, аудит-журнал, аутентификация (Telegram/пароль/refresh-rotation), биллинг (тарифы/подписки/счета), личные бонусы, запись звонков с Whisper-транскрипцией, правила и история звонков, а также админ-обвязка чата сотрудников.

Общее для всех файлов:
- Все — асинхронные роутеры (`async def`, `AsyncSession` через `Depends(get_db)`).
- Tenant-изоляция почти везде идёт через `current_user.tenant_id` (либо явный `get_current_tenant`); в нескольких местах применяется per-clinic скоуп через `resolve_clinic_filter_ids`.
- Роутеры подключаются в `app/main.py` БЕЗ дополнительного префикса (`app.include_router(...)`); префикс задаётся внутри самого `APIRouter(prefix=...)`. На уровне `FastAPI(...)` `root_path` НЕ задан — фактический внешний путь идёт через reverse-proxy с `/api` (см. `appointments.py`, где file_url строится как `/api/appointments/...`). В таблицах ниже путь дан БЕЗ `/api`, как он объявлен в коде; добавьте `/api` для внешнего вызова.
- Гейтинг доступа: `require_module("...")` (подписка на модуль), `require_feature("...")` (фича тарифа), `require_manager` / `require_super_admin` / `get_current_user` (роль/аутентификация).

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `backend/app/routers/ai_knowledge.py` | CRUD базы знаний AI (FAQ) | 426 |
| `backend/app/routers/ai_platform.py` | AI-аналитика всей платформы (super_admin) | 442 |
| `backend/app/routers/analytics.py` | Drill-down аналитика направлений тенанта | 618 |
| `backend/app/routers/announcements.py` | Платформенные объявления super_admin | 93 |
| `backend/app/routers/appointments.py` | Итоги приёма: заключение, файлы, направления | 555 |
| `backend/app/routers/audit.py` | Аудит-журнал, гео-IP, нарушения регионов | 577 |
| `backend/app/routers/auth.py` | Аутентификация, refresh-rotation, lockout | 564 |
| `backend/app/routers/billing.py` | Тарифы, подписки, счета, платежи | 682 |
| `backend/app/routers/bonuses.py` | Личные бонусы и сводка сотрудника | 53 |
| `backend/app/routers/call_recording.py` | Запись звонков + Whisper-транскрипция | 502 |
| `backend/app/routers/call_rules.py` | Матрица правил аудио/видео-звонков | 109 |
| `backend/app/routers/calls.py` | История звонков, статистика, справочник | 619 |
| `backend/app/routers/chat_admin.py` | Админ-настройки чата + группы/broadcast | 329 |
| `backend/app/routers/chat_ai.py` | AI Smart-Reply подсказки регистратору | 102 |
| `backend/app/routers/chat_counselor.py` | Назначение куратора пациенту | 60 |

---

## `backend/app/routers/ai_knowledge.py`
- **Назначение:** CRUD базы знаний AI (FAQ): записи вопрос/ответ с приоритетом и счётчиком hits, используемые для экономии токенов LLM. Поддерживает платформенные (tenant_id=null) и тенантские записи.
- **Ключевые элементы:** схемы `KnowledgeOut/Create/Patch`, `ImportItem`; хелперы доступа `_is_super_admin`, `_can_manage`, `_entry_belongs_to_user`; эндпоинты list/create/patch/delete/stats/import.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/ai/knowledge` | require_module(ai_assistant) + can_manage | q, tenant_id, is_active, limit, offset | `list[KnowledgeOut]` | Список FAQ по ролевой видимости |
| POST | `/ai/knowledge` | то же | `KnowledgeCreate` | `KnowledgeOut` 201 | Создать запись |
| PATCH | `/ai/knowledge/{entry_id}` | то же | `KnowledgePatch` | `KnowledgeOut` | Частичное обновление |
| DELETE | `/ai/knowledge/{entry_id}` | то же | — | 204 | Удалить запись |
| GET | `/ai/knowledge/stats` | то же | limit | top + total_hits + estimated_tokens_saved | Топ по hits, оценка экономии |
| POST | `/ai/knowledge/import` | то же | `items[]` JSON или `file` (CSV/JSON) | imported/received | Массовый импорт |
- **Зависимости:** `app.models.ai_knowledge.AIKnowledgeEntry`, `app.models.user.User/UserRole`, `app.core.deps.get_current_user`, `app.core.tenant.require_module`, `app.config.settings` (для `superadmin_username`).
- **Где менять для типовых задач:** новое поле FAQ — правь модель `AIKnowledgeEntry` + схемы `KnowledgeOut/Create/Patch` здесь; логику ролевой видимости — `_can_manage`/`_entry_belongs_to_user`; формулу экономии токенов — константа `* 200` в `get_stats`; парсинг импорта (новые ключи CSV) — блок `norm.get(...)` в `import_entries`.
- **Подводные камни:** `super_admin` определяется И по роли, И по `settings.superadmin_username` (двойная проверка). Платформенные записи (tenant_id=None) видны всем тенантам, но править их может только super_admin. Импорт super_admin'а всегда кладёт в `tenant_id=None` (игнорирует payload tenant_id). CSV декодируется как utf-8-sig, затем cp1251 — fallback на кириллицу.
- **Строк:** 426

## `backend/app/routers/ai_platform.py`
- **Назначение:** AI-аналитика всей SaaS-платформы КлиникСеть (тенанты, пользователи, направления, лиды, модули, churn). Только super_admin. Конфиг провайдера читается из файла `/app/uploads/ai_config.json`.
- **Ключевые элементы:** `_load_config`, `_get_provider_settings` (вытаскивает baseURL/apiKey/model из JSON), `_openai_call` (httpx → /chat/completions), `_gather_platform_stats` (большой агрегатор), словарь `PLATFORM_PROMPTS` (overview/growth/churn/modules/leads), схема `PlatformAskRequest`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/ai/platform/stats` | require_super_admin | days(7..365) | stats dict | Сырые метрики платформы без AI |
| GET | `/ai/platform/analyze` | require_super_admin | type, days | result + stats + model | AI-анализ по выбранному типу |
| POST | `/ai/platform/ask` | require_super_admin | `PlatformAskRequest` | answer + model | Свободный вопрос о платформе |
- **Зависимости:** `app.core.deps.require_super_admin`; внутри `_gather_platform_stats` импортирует модели `Tenant`, `User`, `Referral`, `ContactRequest`, `commercial.TenantModuleSubscription`; внешний `httpx`. AI-провайдер задаётся файлом, не БД.
- **Где менять для типовых задач:** новый тип AI-анализа — добавь ключ в `PLATFORM_PROMPTS` + расширь regex в `platform_analyze` (`^(overview|growth|...)$`); новые метрики — `_gather_platform_stats` + соответствующие `{плейсхолдеры}` в `.format(...)`; смена LLM-провайдера/модели — формат `ai_config.json` и `_get_provider_settings`.
- **Подводные камни:** конфиг — файл, а не БД; путь захардкожен `/app/uploads/ai_config.json`. `_gather_platform_stats` использует сырой SQL (`text(...)`) для нескольких агрегатов — при смене схемы таблиц (tenants/referrals/tenant_module_subscriptions) эти запросы НЕ ловятся ORM-рефакторингом. Если AI не настроен — возвращает 501 `ai_not_configured`. Все суммы — обычные int/float, не Decimal (это аналитика, не финансы).
- **Строк:** 442

## `backend/app/routers/analytics.py`
- **Назначение:** Drill-down аналитика направлений тенанта: обзор, воронка, динамика по времени, топ услуг/сотрудников, сравнение клиник, тренд баланса из реестра. Требует `require_manager` + фичу `analytics` (последний эндпоинт — `financial_ledger`).
- **Ключевые элементы:** хелперы `_date_range` (last-N-days или явный диапазон), `_dt`; 7 эндпоинтов overview/funnel/dynamics/top-services/top-staff/clinics/ledger-trend. Общие зависимости: `_feat`, `_mgr`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/analytics/overview` | feature(analytics)+manager | clinic_id, days, from/to_date | current/previous/delta | Сводка + сравнение с пред. периодом |
| GET | `/analytics/funnel` | то же | clinic_id, days, from/to | steps[4] + конверсии | Воронка Создано→Выплачен |
| GET | `/analytics/dynamics` | то же | clinic_id, days(7..), granularity | series[] | Динамика day/week/month |
| GET | `/analytics/top-services` | то же | clinic_id, days, limit | items[] | Топ услуг по направлениям |
| GET | `/analytics/top-staff` | то же | clinic_id, days, limit | items[] | Рейтинг сотрудников (роль REG) |
| GET | `/analytics/clinics` | то же | clinic_id, days | items[] | Сравнение клиник |
| GET | `/analytics/ledger-trend` | feature(financial_ledger)+manager | user_id, days | series накопит. баланс | Тренд баланса из ledger_entries (enterprise) |
- **Зависимости:** `app.core.deps.require_manager`, `app.core.tenant.require_feature`, модели `Clinic`, `Referral/ReferralStatus`, `Bonus/BonusStatus`, `Service`, `LedgerEntry`, `services.ledger_service.OpType`; **ключевая внутренняя связь** — `app.routers.manager.clinics_access.resolve_clinic_filter_ids` (per-clinic скоуп).
- **Где менять для типовых задач:** новая аналитическая выкладка — добавь `@router.get` с `dependencies=[_feat, _mgr]` и обязательно прокидывай `resolve_clinic_filter_ids`; смена окна дат — `_date_range`; смена логики «сотрудник» — фильтр `User.role == UserRole.REG` в top-staff.
- **Подводные камни:** ВЕЗДЕ обязателен паттерн per-clinic: `filter_ids == []` → пустой ответ (нет доступа), `None` → без фильтра. Tenant-условие пишется хитро: `Referral.tenant_id == _tenant_id` подмешивается через распаковку списка `*([...] if _tenant_id else [])`; в `overview._period_stats` использован сомнительный приём `Referral.tenant_id.isnot(None) | True` — фактически всегда True при отсутствии tenant_id (легаси-обходка, при рефакторинге проверить). Денежные суммы приводятся к `float(...)` — это аналитика, не транзакции, но при сверке с биллингом помнить о расхождении с Decimal.
- **Строк:** 618

## `backend/app/routers/announcements.py`
- **Назначение:** Платформенные объявления: super_admin создаёт сообщение, которое подмешивается всем сотрудникам всех тенантов в `/notifications/recent` (категория announcements).
- **Ключевые элементы:** `_require_super`, схема `AnnouncementCreate` (severity info/warning/critical), `_to_dict`; create/list/revoke.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/admin/announcements` | super_admin | `AnnouncementCreate` | dict 201 | Создать объявление |
| GET | `/admin/announcements` | super_admin | include_revoked | list (до 200) | Список объявлений |
| DELETE | `/admin/announcements/{announcement_id}` | super_admin | — | 204 | Отозвать (revoked=True) |
- **Зависимости:** `app.models.platform_announcement.PlatformAnnouncement`, `app.core.deps.get_current_user`.
- **Где менять для типовых задач:** новое поле объявления — модель + `_to_dict` + `AnnouncementCreate`; саму выдачу читателям ищи НЕ здесь, а в роутере notifications (`/notifications/recent`).
- **Подводные камни:** удаление — soft (`revoked=True`), физически не удаляет. Лимит списка захардкожен `[:200]`, фильтрация revoked делается в Python после выборки (не в SQL). Проверка роли — строгое `!= UserRole.SUPER_ADMIN`, без учёта superadmin_username.
- **Строк:** 93

## `backend/app/routers/appointments.py`
- **Назначение:** «Итоги приёма»: заключение врача (1:1 с приёмом), вложения (PDF/изображения), внутриклинические направления (с авто-записью на слот целевого врача), история визитов пациента по телефону. Гейт — фича `scheduling`.
- **Ключевые элементы:** схемы `OutcomeIn/Out`, `AttachmentOut`, `ReferralIn/Out`; хелпер `_get_appt_or_404` (tenant-проверка); константы `ATTACH_ROOT`, `_ALLOWED_MIMES`, `_MAX_FILE_SIZE`, `_VALID_TARGETS`.
- **Эндпоинты:** (роутер без prefix — пути абсолютные; все с `dependencies=_FEAT`=scheduling)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/appointments/{id}/outcome` | feature(scheduling)+auth | `OutcomeIn` | `OutcomeOut` | Upsert заключения + COMPLETED |
| GET | `/appointments/{id}/outcome` | то же | — | `OutcomeOut` или null | Получить заключение |
| POST | `/appointments/{id}/attachments` | то же | `file` (multipart) | `AttachmentOut` | Загрузить файл ≤25МБ |
| GET | `/appointments/{id}/attachments` | то же | — | `list[AttachmentOut]` | Список вложений |
| DELETE | `/appointments/{id}/attachments/{attachment_id}` | то же | — | `{ok}` | Удалить файл + с диска |
| GET | `/appointments/{id}/attachments/{attachment_id}/raw` | то же | — | FileResponse | Скачать/просмотреть файл |
| POST | `/appointments/{id}/referrals` | то же | `ReferralIn` | `ReferralOut` | Внутриклин. направление (+опц. запись) |
| GET | `/appointments/{id}/referrals` | то же | — | `list[ReferralOut]` | Направления из приёма |
| GET | `/patients/{phone}/history` | то же | — | list (до 50) | История визитов пациента |
- **Зависимости:** модели `doctor.Appointment/AppointmentStatus/Doctor`, `appointment_outcome.AppointmentOutcome/AppointmentAttachment/InternalReferral`; **сервисы-хуки** (lazy-import в try/except): `services.loyalty_ext_service.award_appointment` (+50 баллов), `services.appointment_costing.on_appointment_completed` (авто-списание расходников).
- **Где менять для типовых задач:** новые типы направлений — множество `_VALID_TARGETS`; разрешённые форматы файлов — `_ALLOWED_MIMES`; логику начисления лояльности/себестоимости при закрытии приёма — блоки `if was_just_completed` в `upsert_outcome`; нормализацию телефона для истории — блок `candidates` в `patient_appointment_history`.
- **Подводные камни:** tenant-проверка в `_get_appt_or_404` срабатывает только если ОБА `user.tenant_id` и `appt.tenant_id` непустые. Хуки лояльности/costing обёрнуты в `try/except pass` — НЕ должны ломать закрытие приёма, но молча проглатывают ошибки. Двойная запись на слот защищена проверкой existing + `db.rollback()` + 409. При создании авто-Appointment длительность берётся из `doctor.slot_duration` (по умолч. 30). История пациента ищет по нескольким нормализованным вариантам телефона (+7/8/10-значный) — расхождения денормализации не теряют визиты. Файлы хранятся на диске `/app/uploads/appointments/{appt_id}/` — на проде это volume.
- **Строк:** 555

## `backend/app/routers/audit.py`
- **Назначение:** Аудит-журнал: общий лог, CSV-экспорт, история сущности/актора, объединённая лента (audit+activity), гео-статистика по тенантам и лента нарушений региональной блокировки. Гейт — фича `audit_log` (часть эндпоинтов без гейта, только `require_manager`).
- **Ключевые элементы:** `_entry_out` (сериализация с гео-полями), эндпоинты log/export.csv/{entity}/actor/actions/feed/by-tenant-geo/region-violations; вложенная функция `add_event` (агрегатор гео в `by_tenant_geo`).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/audit/log` | feature(audit_log)+manager | action, entity_type, days, limit, offset | total + items | Журнал с фильтрами |
| GET | `/audit/log/export.csv` | то же | action, entity_type, days, limit | CSV (UTF-8 BOM, `;`) | Выгрузка журнала |
| GET | `/audit/log/{entity_type}/{entity_id}` | то же | limit | items | История сущности |
| GET | `/audit/log/actor/{actor_id}` | то же | days, limit | items | Действия актора |
| GET | `/audit/actions` | feature+manager | — | list | Известные типы действий |
| GET | `/audit/feed` | require_manager | days, limit | объедин. items | audit_log + activity_log |
| GET | `/audit/by-tenant-geo` | require_manager | days | tenants[] | Гео-статистика по тенантам |
| GET | `/audit/region-violations` | require_manager | days, limit, tenant_id | items[] | Лента region.violation |
- **Зависимости:** `app.models.audit.AuditEntry`, `app.models.activity_log.ActivityLog`, `app.models.tenant.Tenant`, `app.models.franchise.Franchise`; `services.audit_service.AuditAction` (список действий), `services.region_lock_service._matches` (проверка региона). В `region-violations` — сырой SQL по `franchise_ip_allowlist` (проверка IP по CIDR).
- **Где менять для типовых задач:** новые поля в выгрузке — `_entry_out` + заголовки writer в `export_audit_log_csv`; новые типы аудит-действий — `services.audit_service.AuditAction`; логику региональных нарушений — `region_lock_service._matches` + `by_tenant_geo`/`region_violations`.
- **Подводные камни:** ВАЖНО — `/log/export.csv` объявлен ДО `/log/{entity_type}/{entity_id}`, чтобы FastAPI не парсил «export.csv» как путь-параметр (порядок маршрутов load-bearing!). Гео-поля (`geo_country` и т.п.) могут быть None если нет mmdb или приватный IP. `get_audit_log` считает total через выборку всех id и `len(...)` — неэффективно на больших объёмах (нет `func.count`). CSV режет before/after до 500 символов, comment до 300. `feed`/`by-tenant-geo`/`region-violations` БЕЗ feature-гейта (только manager) — рассогласование с остальными.
- **Строк:** 577

## `backend/app/routers/auth.py`
- **Назначение:** Аутентификация: Telegram Mini App, логин/пароль, refresh-токены с ротацией и reuse-detection, выход (один/все устройства), сессии, инвайт-регистрация. Содержит per-user brute-force lockout через Redis.
- **Ключевые элементы:** lockout-хелперы (`_get_lockout_redis`, `_check_lockout`, `_register_failed_login`, `_clear_lockout`), `_login_limiter` (fastapi-limiter), `_get_ip`, **центральный `_issue_tokens`** (выпускает access+refresh, считает `redirect_url` по роли/slug); схемы инвайта `InviteInfoResponse/InviteRegisterRequest`, `RefreshRequest`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/auth/telegram` | публичный | `TelegramAuthData` | tokens + redirect | Вход через Telegram WebApp |
| POST | `/auth/login` | публичный (rate-limit) | `PasswordLoginData` | tokens + redirect | Логин/пароль + lockout |
| POST | `/auth/refresh` | refresh-токен | `RefreshRequest` | новый access+refresh | Ротация токена |
| POST | `/auth/logout` | bearer+refresh | `RefreshRequest` | `{ok}` | Revoke refresh + blacklist access |
| POST | `/auth/logout-all` | bearer+refresh | `RefreshRequest` | `{ok}` | Выход со всех устройств |
| POST | `/auth/sessions` | refresh-токен | `RefreshRequest` | sessions[] | Список активных сессий |
| GET | `/auth/invite/{code}` | публичный | — | `InviteInfoResponse` | Инфо по инвайту |
| POST | `/auth/register-invite` | публичный | `InviteRegisterRequest` | tokens | Регистрация по инвайту |
- **Зависимости:** `core.security` (create/verify токены, hash паролей, `verify_telegram_init_data`, `decode_token`), `core.token_blacklist.revoke_access_token`, модели `User`, `Invitation`, `RefreshToken`, `Tenant`; `services.security_service.log_login_failed`, `utils.password_strength.validate_password_strength`, `services.email_service.schedule_email`. Redis — для lockout (через `settings.redis_url`).
- **Где менять для типовых задач:** куда редиректить после логина — словарь `ADMIN_CABINET_ROLES` и цепочка `if is_super / role == ...` в `_issue_tokens`; параметры lockout — `LOCKOUT_MAX_ATTEMPTS`/`LOCKOUT_TTL_SECONDS`; rate-limit логина — `_login_limiter` (times/seconds); правила пароля — `validate_password_strength` (в utils, не здесь).
- **Подводные камни:** lockout полностью деградирует если Redis недоступен (`_lockout_redis = False` → проверки no-op). Refresh-ротация: при reuse revoked-токена ревокается ВСЯ цепочка пользователя (компрометация → 401), но есть 2-сек grace-окно для сетевых ретраев. Login fail пишет одинаковый action независимо от причины (анти-энумерация), но `reason` различается в audit. `register-invite` нормализует телефон в username (`isdigit или +`), email-уведомление best-effort. super_admin определяется по роли ИЛИ `settings.superadmin_username` (fallback "khamzat").
- **Строк:** 564

## `backend/app/routers/billing.py`
- **Назначение:** Биллинг тенанта: прайс-лист тарифов, сводка, подписки (создать/сменить/отменить), счета, платежи, статус trial, запрос апгрейда (через Telegram), сводка BillingLedger v2. Гейт большинства — фича `billing` + manager.
- **Ключевые элементы:** схемы `CreateSubscriptionRequest`, `ChangePlanRequest`, `RecordPaymentRequest`; сериализаторы `_sub_out`, `_inv_out`, `_pay_out`; словари `PLAN_BULLETS` (продублированы в `list_plans` и `trial_status`); shortcut-эндпоинты для старого фронта.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/billing/plans` | публичный | — | plans[] | Прайс-лист (БД или fallback) |
| GET | `/billing/summary` | feature(billing)+manager | — | summary | Подписка + долги |
| GET | `/billing/subscription` | то же | — | sub | Текущая подписка |
| POST | `/billing/subscription` | то же | `CreateSubscriptionRequest` | sub | Создать подписку |
| POST | `/billing/subscription/{sub_id}/change-plan` | то же | `ChangePlanRequest` | sub | Сменить тариф |
| POST | `/billing/subscription/{sub_id}/cancel` | то же | — | sub | Отменить |
| GET | `/billing/invoices` | то же | status, limit, offset | inv[] | Список счетов |
| GET | `/billing/invoices/{invoice_id}` | то же | — | inv | Детали счёта (IDOR-проверка) |
| POST | `/billing/invoices/generate` | то же | sub_id (query) | inv | Выставить счёт |
| POST | `/billing/invoices/{invoice_id}/pay` | то же | `RecordPaymentRequest` | pay | Зарегистрировать платёж |
| GET | `/billing/payments` | то же | limit | pay[] | История платежей |
| GET | `/billing/trial-status` | auth (без feature) | — | статус trial/plan | Дни до конца trial |
| POST | `/billing/upgrade-request` | auth | `{plan, comment}` | `{ok}` | Заявка на апгрейд (Telegram) |
| GET | `/billing/ledger/summary` | feature(billing)+manager | days | summary | BillingLedger v2 |
| GET | `/billing/ledger/plans` | то же | — | pricing rules | Split %/fee % тенанта |
| POST | `/billing/generate` | то же | `{}` | inv | Shortcut: счёт по тенанту |
| POST | `/billing/pay` | то же | `{invoice_id, amount, ...}` | pay | Shortcut: оплата |
- **Зависимости:** `services.billing_service` (вся бизнес-логика: list_plans/get_active_subscription/create_subscription/change_plan/cancel/generate_invoice/record_payment/get_billing_summary/get_billing_ledger_summary/get_pricing_rules); модели `billing.{Subscription,Invoice,Payment,PLAN_PRICES,...}`, `tenant.{Tenant,TenantLicense}`; `modules.features.{PLAN_FEATURES,FEATURE_LABELS,PLAN_LIMITS,PLAN_DESCRIPTIONS}`; `config.settings.admin_bot_token` (Telegram-уведомления).
- **Где менять для типовых задач:** маркетинговые буллеты тарифов — словарь `PLAN_BULLETS` (ВНИМАНИЕ: дублируется в `list_plans` и `trial_status` — менять в ОБОИХ); набор тарифов/циклов — regex в `CreateSubscriptionRequest`/`ChangePlanRequest`; бизнес-логику счетов/платежей — `services.billing_service` (не здесь); fallback-цены — `PLAN_PRICES` в модели.
- **Подводные камни:** `PLAN_BULLETS` ДУБЛИРУЕТСЯ в двух функциях — рассинхрон легко допустить. Платёж принимает `amount: float` но конвертирует в `Decimal(str(body.amount))` перед записью — правильный паттерн против float-ошибок (соблюдать!). Сериализаторы оборачивают денежные поля в `float(...)` для вывода. IDOR-защита счетов есть в `get_invoice`/`record_payment`/`pay_invoice_shortcut` (проверка `inv.tenant_id == current_user.tenant_id`). Tenant fallback на `slug=="default"` повторяется в 6+ местах (легаси для одно-тенантных установок). `upgrade-request` шлёт в захардкоженный Telegram chat_id 293633093.
- **Строк:** 682

## `backend/app/routers/bonuses.py`
- **Назначение:** Личный кабинет сотрудника: сводка бонусов (ожидает/выплачено) и список своих бонусов. Минимальный роутер.
- **Ключевые элементы:** два эндпоинта `get_bonus_summary`, `get_my_bonuses`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/bonuses/summary` | auth (текущий user) | — | `BonusSummary` | Сводка: pending/paid + конверсия |
| GET | `/bonuses/` | auth | — | `list[BonusResponse]` | Свои бонусы |
- **Зависимости:** модели `Bonus/BonusStatus`, `Referral/ReferralStatus`; схемы `schemas.bonus.BonusResponse/BonusSummary`; `core.deps.get_current_user`.
- **Где менять для типовых задач:** новое поле сводки — схема `BonusSummary` + расчёт в `get_bonus_summary`. Фильтрация только по `Bonus.admin_id == current_user.id` (личные бонусы сотрудника).
- **Подводные камни:** суммы считаются Python-ом через `sum(float(b.amount) ...)` — float, не Decimal; для копеечной точности это риск, но здесь личная сводка-отображение. НЕТ явной tenant-фильтрации — изоляция держится только на `admin_id == current_user.id` (бонусы своего пользователя). GET `/bonuses/` со слешем — старый стиль маршрута.
- **Строк:** 53

## `backend/app/routers/call_recording.py`
- **Назначение:** Запись звонков (аудио/видео) + Whisper-транскрипция: init draft → upload файла → finalize (status=ready, воркер транскрибирует) → просмотр/скачивание/поиск/soft-delete. Все эндпоинты гейтятся модулем `call_recording` и tenant-изолированы.
- **Ключевые элементы:** схемы `RecordingInitIn/FinalizeIn`, `RecordingOut`, `TranscriptOut`, `TranscriptSearchHit`; хелперы `_ensure_tenant`, `_get_owned_recording`, `_serialize`; константы `RECORDINGS_ROOT` (env), `MAX_FILE_SIZE`=500МБ, `ALLOWED_MIME_PREFIXES`.
- **Эндпоинты:** (router-level dependency = require_module(call_recording))

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/recordings` | module+tenant | `RecordingInitIn` | `RecordingOut` 201 | Создать draft (uploading) |
| POST | `/recordings/{id}/upload` | то же | `file` (multipart) | `RecordingOut` | Загрузить файл чанками |
| POST | `/recordings/{id}/finalize` | то же | `RecordingFinalizeIn` | `RecordingOut` | status=ready |
| GET | `/recordings` | то же | session_type, status, date_from/to, limit, offset | `list[RecordingOut]` | Список с фильтрами |
| GET | `/recordings/{id}` | то же | — | `RecordingOut` | Детали |
| GET | `/recordings/{id}/file` | module + manager+ | — | FileResponse | Скачать файл |
| GET | `/recordings/{id}/transcript` | то же | — | `TranscriptOut` | Транскрипт |
| DELETE | `/recordings/{id}` | module + manager+ | — | 204 | Soft-delete (status=failed) |
| GET | `/recordings/search/transcripts` | module+tenant | q, limit | `list[TranscriptSearchHit]` | Полнотекст ILIKE по транскриптам |
- **Зависимости:** модели `call_recording.{CallRecording,CallRecordingStatus,CallSessionType,CallTranscript}`, `Tenant`, `User/UserRole`; `core.tenant.{get_current_tenant,require_module}`; транскрипцию делает ВНЕШНИЙ воркер (здесь только статусы).
- **Где менять для типовых задач:** разрешённые форматы — `ext_map`/`ALLOWED_MIME_PREFIXES`; лимит размера — `MAX_FILE_SIZE`; путь хранения — env `RECORDINGS_ROOT`; статусную модель — enum `CallRecordingStatus` (в модели) + проверки `if rec.status not in (...)`. Сама транскрипция — НЕ здесь (отдельный воркер подхватывает status=ready).
- **Подводные камни:** загрузка читается чанками по 1МБ, при превышении лимита файл удаляется (`target.unlink`). `_get_owned_recording` ВСЕГДА фильтрует по `tenant_id` (жёсткая изоляция). Скачивание/удаление дополнительно требует роль manager+ (SUPER_ADMIN/FRANCHISE_OWNER/MANAGER). Delete — soft (status=failed, error_message='deleted'), запись остаётся для аудита, файл физически удаляется. `cost_usd` транскрипта приводится к float при выводе. Поиск snippet ±60 символов вокруг найденного.
- **Строк:** 502

## `backend/app/routers/call_rules.py`
- **Назначение:** Управление матрицей правил аудио/видео-звонков между ролями (same_clinic/cross_clinic/any). Доступ: super_admin (любой тенант), franchise_owner (своя франшиза), manager (свой тенант).
- **Ключевые элементы:** схема `RuleIn`; хелпер `_ensure_access` (RBAC по тенанту); list/upsert/reset.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/call-rules/{tenant_id}` | super/FO/manager (scope) | — | rules matrix + roles | Матрица правил тенанта |
| PUT | `/call-rules/{tenant_id}` | то же | `RuleIn` | `{ok, id}` | Upsert правила |
| DELETE | `/call-rules/{tenant_id}` | то же | — | `{ok, deleted}` | Сброс к дефолтам |
- **Зависимости:** **`services.call_rules_service`** (вся логика: `get_rules_matrix`, `upsert_rule`, `reset_rules`, `ACTIVE_ROLES`, `EXCLUDED_ROLES`); модели `Tenant`, `Franchise`, `User/UserRole`.
- **Где менять для типовых задач:** саму матрицу/дефолты правил — `services.call_rules_service` (не здесь); валидные scope — множество в `upsert_rule`; правила доступа — `_ensure_access`.
- **Подводные камни:** в `_ensure_access` есть ЯВНЫЙ ДУБЛЬ — две идентичные ветки `if current_user.role == UserRole.MANAGER and current_user.tenant_id == tenant_id` (строки 43-46), вторая мёртвая. franchise_owner находит свою франшизу по `owner_user_id == current_user.id`. `from_clinic_id/to_clinic_id` парсятся из строк в UUID — упадёт на невалидном UUID без аккуратного 400.
- **Строк:** 109

## `backend/app/routers/calls.py`
- **Назначение:** История и аналитика звонков (модель CallLog): список с фильтрами/пагинацией, агрегаты (peak hours, top callers/callees, daily trend), детали звонка, CSV-экспорт, cross-clinic справочник сотрудников для инициации звонка.
- **Ключевые элементы:** скоуп-хелперы `_accessible_tenant_ids`, `_is_manager_plus`, `_can_see_clinic`; сериализация `_user_brief`, `_row_to_dict`; **общий построитель WHERE `_build_filters`**; вложенный `_top` в stats; словари локализации `_STATUS_RU`/`_TYPE_RU`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/calls/log` | auth (scope) | from/to, user_id, type, status, clinic_id, search, limit, offset | items + total | История звонков |
| GET | `/calls/stats` | require_manager | from/to, clinic_id, period_days | агрегаты | Дашборд звонков |
| GET | `/calls/log/export.csv` | require_manager | from/to, clinic_id, type, status, user_id | CSV (UTF-8 BOM) | Выгрузка истории |
| GET | `/calls/log/{call_id}` | auth (scope) | — | call dict | Детали звонка |
| GET | `/calls/directory` | require_manager | role, search | clinics[] + users[] | Cross-clinic справочник |
- **Зависимости:** модели `presence.CallLog`, `Clinic`, `Franchise`, `Tenant`, `User/UserRole`; **`app.routers.manager.clinics_access.resolve_clinic_filter_ids`** (per-clinic скоуп); `services.call_rules_service.EXCLUDED_ROLES` (фильтр справочника).
- **Где менять для типовых задач:** ВСЯ логика доступа/фильтров в одном месте — `_build_filters` (правь здесь, переиспользуется в log/stats/export); маппинг UI-статусов на модель — `ui_to_model` внутри `_build_filters`; локализация CSV — `_STATUS_RU`/`_TYPE_RU`; скоуп тенантов — `_accessible_tenant_ids`.
- **Подводные камни:** ВАЖЕН порядок маршрутов — `/log/export.csv` объявлен ДО `/log/{call_id}`, иначе FastAPI распарсит «export.csv» как UUID. `_build_filters` возвращает `None` = «нет доступа» (вернуть пустую страницу), это не ошибка. Даты нормализуются из aware в naive UTC (колонка `started_at` — TIMESTAMP WITHOUT TIME ZONE, asyncpg не сравнит aware с naive!) — критичный фикс, не убирать. Поиск по ФИО в `/log` делается Python-фильтром ПОСЛЕ применения limit/offset (поиск «по текущей странице» — намеренный компромисс). super_admin с заданным tenant_id ограничивается им; без tenant_id видит всё. Статистика считается в Python (выбираются все строки в память) — на больших объёмах тяжело.
- **Строк:** 619

## `backend/app/routers/chat_admin.py`
- **Назначение:** Админ-обвязка чата сотрудников: глобальные настройки чата тенанта (TTL файлов, лимиты, межклиничный доступ, TG-уведомления) + управление кастомными группами и broadcast-каналами (создание, участники, переименование, удаление).
- **Ключевые элементы:** хелперы `_ensure_admin`, `_ensure_owner_or_super`, `_get_or_create_settings`; схемы `SettingsResponse/Update`, `GroupCreate`, `MembersAdd`, `GroupUpdate`; CRUD групп.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/admin/chat-settings` | admin/manager+ | — | `SettingsResponse` | Настройки чата тенанта |
| PUT | `/admin/chat-settings` | super/FO только | `SettingsUpdate` | `SettingsResponse` | Обновить настройки |
| POST | `/admin/chat/groups` | admin/manager+ | `GroupCreate` | `{id, members_added}` 201 | Создать группу/broadcast |
| GET | `/admin/chat/groups` | любой не-patient | — | groups[] | Свои группы (только участник) |
| POST | `/admin/chat/groups/{room_id}/members` | admin групп + manager+ | `MembersAdd` | `{added}` 201 | Добавить участников |
| DELETE | `/admin/chat/groups/{room_id}/members/{user_id}` | admin группы | — | 204 | Убрать участника |
| PATCH | `/admin/chat/groups/{room_id}` | admin группы | `GroupUpdate` | `{id, name}` | Переименовать |
| DELETE | `/admin/chat/groups/{room_id}` | admin группы | — | 204 | Удалить (CASCADE) |
- **Зависимости:** модели `chat_global_settings.ChatGlobalSettings`, `staff_chat.{StaffChatRoom,StaffChatMember,ROOM_TYPE_GROUP,ROOM_TYPE_BROADCAST}`; **`services.staff_chat_service`** (`visible_users_for`, `list_room_members`, `get_room`, `serialize_user_brief`).
- **Где менять для типовых задач:** новая глобальная настройка чата — модель `ChatGlobalSettings` + схемы `SettingsResponse/Update` (оба места); RBAC видимости участников — `staff_chat_service.visible_users_for`; права на группы — проверки `me.member_role != "admin"`.
- **Подводные камни:** изоляция групп СТРОЖЕ ролей — даже super_admin/franchise_owner НЕ видят чужие группы (только где сами участники), bypass'ов нет — это намеренно. Добавление участников фильтруется через `visible_users_for` (нельзя добавить невидимого). Удаление группы — жёсткое (CASCADE удалит messages+files). Изменять настройки может только super/FO, но читать — manager+. `_ensure_admin` принимает строковые роли включая 'admin' (которой нет в основном UserRole — легаси-совместимость).
- **Строк:** 329

## `backend/app/routers/chat_ai.py`
- **Назначение:** AI Smart-Reply: генерирует 3 контекстных варианта ответа регистратору в чате пациент↔клиника по последним ~10 сообщениям thread'а. Сейчас AI-ветка — заглушка, реально работает эвристика по ключевым словам.
- **Ключевые элементы:** эндпоинт `ai_suggest_reply`, асинхронная заглушка `_generate_via_ai` (возвращает None → fallback).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/clinic/chat/threads/{thread_id}/ai-suggest` | auth | — | suggestions[] + source | 3 подсказки ответа |
- **Зависимости:** модели `chat.ChatThread/ChatMessage`, `User`; `core.deps.get_current_user`.
- **Где менять для типовых задач:** ПОДКЛЮЧИТЬ реальный AI — реализовать `_generate_via_ai` (TODO в коде указывает на `services.claude_service.chat_completion` с system-prompt регистратора и парсингом JSON в 3 варианта); эвристики/шаблоны — блоки `if any(w in body ...)` и список `fallbacks`.
- **Подводные камни:** **AI-ветка — заглушка** (`_generate_via_ai` всегда возвращает None), сейчас всегда работает heuristic/fallback. НЕТ tenant/доступ-проверки thread'а — берётся любой thread по id (потенциальный IDOR, при доработке добавить проверку принадлежности). `source` в ответе ('ai'/'heuristic'/'fallback') показывает, что реально сработало.
- **Строк:** 102

## `backend/app/routers/chat_counselor.py`
- **Назначение:** Назначение/снятие/просмотр персонального куратора (counselor) пациентскому аккаунту — для чата пациент↔клиника. Куратор — сотрудник по умолчанию для thread'ов пациента.
- **Ключевые элементы:** схема `CounselorIn`; assign/remove/get.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/clinic/chat/patients/{patient_id}/assign-counselor` | manager/director/FO/super/admin | `CounselorIn` | `{ok}` | Назначить куратора |
| DELETE | `/clinic/chat/patients/{patient_id}/assign-counselor` | auth | — | `{ok}` | Снять куратора |
| GET | `/clinic/chat/patients/{patient_id}/counselor` | auth | — | `{counselor}` | Текущий куратор |
- **Зависимости:** модель `patient_account.PatientAccount` (поля `default_counselor_user_id`, `counselor_since`), `User`; `core.deps.get_current_user`.
- **Где менять для типовых задач:** роли, которым можно назначать куратора — список ролей в `assign_counselor`; поля куратора — модель `PatientAccount`.
- **Подводные камни:** ролевая проверка ТОЛЬКО в `assign` (POST); DELETE и GET доступны любому авторизованному — рассогласование прав. НЕТ tenant/clinic-проверки принадлежности пациента (потенциальный IDOR по `patient_id`). `assign` не валидирует, что `body.user_id` — реально сотрудник этой клиники.
- **Строк:** 60

---

## Сквозные риски и связи группы

1. **Порядок статических маршрутов** (`audit.py`, `calls.py`): `/log/export.csv` ВСЕГДА регистрируется ДО `/log/{...}` — иначе «export.csv» парсится как path-параметр. Не переставлять.
2. **Per-clinic скоуп** через `app.routers.manager.clinics_access.resolve_clinic_filter_ids` — единый контракт в `analytics.py` и `calls.py`: `[]` = нет доступа (пустой ответ), `None` = без фильтра, `[...]` = список clinic_id.
3. **Decimal vs float**: `billing.py` корректно держит деньги в `Decimal` (`Decimal(str(amount))`), а `analytics.py`/`bonuses.py` выводят `float(...)` — при сверке аналитики с биллингом возможны расхождения в копейках.
4. **Потенциальные IDOR**: `chat_ai.py` (thread по id без проверки), `chat_counselor.py` (patient_id без tenant-проверки, права только на POST). Кандидаты на доработку безопасности.
5. **AI-провайдеры рассогласованы**: `ai_platform.py` читает провайдера из файла `/app/uploads/ai_config.json` и зовёт OpenAI-совместимый эндпоинт напрямую через httpx; `chat_ai.py` имеет лишь заглушку с TODO на `services.claude_service`. Единого AI-роутера в этом срезе нет.
