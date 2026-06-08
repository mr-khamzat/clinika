# routers [12] — телемед, телефония, подписки на одобрении, инфраструктура и интеграции

Это финальный (по алфавиту) срез роутеров `backend/app/routers/` — 15 файлов от `staff_chat_cross.py` до `wellness.py`. Группа разнородна по домену, но объединена тем, что почти все файлы — это **«надстройки» поверх ядра МИС**: cross-tenant чат франшизы, телемедицина (WebRTC), телефония, очередь подписок «на одобрение», инфраструктурный мониторинг (supervisor/system), техподдержка, настройки/брендинг/API-ключи/вебхуки тенанта, витальные показатели пациента и wellness-партнёрка.

Общие архитектурные черты:
- **FastAPI `APIRouter`**, async/await, `AsyncSession` через `Depends(get_db)`. Глобального `/api`-префикса в `main.py` нет — внешний путь `/clinika/api/...` навешивает nginx (видно по `file_url` в `support.py`).
- **Изоляция тенанта** реализована руками в каждом запросе через `WHERE tenant_id == user.tenant_id` (или `session.tenant_id` для пациентских роутеров). Глобального RLS нет — пропуск фильтра = утечка между клиниками.
- Три модели авторизации сосуществуют: **JWT-сотрудник** (`get_current_user` / `require_*`), **patient-session** (токен из заголовка `X-Patient-Session` / `?t=` / cookie, через `restore_session`), и **бессекретные вебхуки** (телефония, support-бот по `X-Bot-Secret`).
- Платные модули гейтятся `Depends(require_module("..."))` (telemedicine, webhooks).
- Деньги — `Decimal` с `.quantize(Decimal("0.01"))`; во внешний JSON отдаются как `float(...)`.

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `staff_chat_cross.py` | Cross-tenant комнаты чата на уровне франшизы | 513 |
| `subscription_discounts.py` | CRUD категорных скидок «Здоровье+» (менеджер) | 169 |
| `subscription_pending.py` | Очередь подписок «на одобрение» менеджером | 384 |
| `supervisor.py` | Мониторинг состояния всех сервисов платформы | 291 |
| `support.py` | Чат техподдержки v3 + Telegram-бот | 533 |
| `system.py` | Версия процесса + heartbeat в хаб | 64 |
| `telemedicine.py` | Видеоприёмы: REST + WebSocket signaling | 939 |
| `tenant.py` | Инфо о тенанте, брендинг, лицензия, онбординг | 265 |
| `tenant_api_keys.py` | CRUD API-ключей тенанта (owner) | 198 |
| `tenant_settings.py` | Настройки SLA/autoclose чата тенанта | 75 |
| `tenant_telephony.py` | Телефония: конфиг, DID, dial, вебхуки | 480 |
| `visiting_doctor.py` | Приезжие врачи: приёмы, доход, ledger | 859 |
| `vitals.py` | Витальные показатели пациента + Apple Health | 290 |
| `webhooks.py` | Регистрация и лог доставок вебхуков | 212 |
| `wellness.py` | Wellness-партнёрка по тарифу подписки | 269 |

---

## `backend/app/routers/staff_chat_cross.py`
- **Назначение:** Cross-tenant комнаты StaffChat — единый групповой чат для сотрудников всех клиник одной франшизы. Расширяет обычный StaffChat (который tenant-scoped) на уровень `franchise_id`.
- **Ключевые элементы:** `router = APIRouter(prefix="/staff-chat")`; helpers `_ensure_not_patient`, `_ensure_room_admin_role`, `_resolve_user_franchise_id`, `_list_tenant_ids_of_franchise`, `_list_active_staff_users`, `_get_cross_room_or_404`, `_ensure_can_manage_room`; константа `_ADMIN_ROLES` (franchise_owner / super_admin / director / deputy_director); Pydantic `CrossRoomCreate`, `AddTenantUsers` (с `Literal["all_active"]`).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/staff-chat/cross-rooms` | admin-роль франшизы | `CrossRoomCreate` | объект комнаты + `members_count` | Создать cross-room; без `member_user_ids` добавляет всех staff франшизы |
| GET | `/staff-chat/cross-rooms` | не-patient | — | `{rooms:[...]}` | Список доступных cross-rooms (super_admin — все; admin — своя франшиза; staff — где член) |
| GET | `/staff-chat/cross-rooms/{room_id}/members-by-tenant` | super_admin / admin франшизы / member | — | члены, сгруппированные по тенантам | Структурированный список участников |
| POST | `/staff-chat/cross-rooms/{room_id}/add-tenant-users` | super_admin / admin франшизы | `AddTenantUsers` | `{added, skipped_already_member, total_in_room}` | Массово добавить членов из тенанта |

- **Зависимости:** `app.models.staff_chat` (`StaffChatRoom`, `StaffChatMember`, `ROOM_TYPE_GROUP`), `app.models.tenant.Tenant` (источник `franchise_id`), `app.models.user.User`/`UserRole`, `core.deps.get_current_user`. Сервисный слой не используется — вся логика в роутере.
- **Где менять для типовых задач:** новый тип доступа к комнате — `_ADMIN_ROLES` + `_ensure_can_manage_room`; добавить поле комнаты — `CreateCrossRoom` + insert в `create_cross_room` + сериализация; пагинация списка комнат — `list_cross_rooms` (сейчас без лимита).
- **Подводные камни:** `is_cross_tenant=True` обязателен, иначе `_get_cross_room_or_404` отдаёт 400. `tenant_id` комнаты — NOT NULL, хранит тенант инициатора, а реальная изоляция идёт по `franchise_id` — не перепутать. super_admin без тенанта получит `franchise_id=None` и не сможет создать комнату (нужен явный параметр, пока не реализован). `add_tenant_users` защищён от дублей PK через предзагрузку `existing_ids`.
- **Строк:** 513

## `backend/app/routers/subscription_discounts.py`
- **Назначение:** Тонкий CRUD-роутер над `subscription_plan_discount_service` для управления категорными скидками подписки «Здоровье+» (скидка на услугу/категорию/всё для держателя тарифа). Tenant-scoped.
- **Ключевые элементы:** `router` с `prefix="/manager/subscription/discounts"` и router-level `dependencies=[Depends(require_manager)]`; Pydantic `DiscountRuleIn` (regex на `plan_key`/`scope`), `DiscountRulePatch`; сериализатор `_to_dict`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/manager/subscription/discounts` | require_manager | query `plan_key/scope/is_active` | `{items:[...]}` | Список правил скидок тенанта |
| POST | `/manager/subscription/discounts` | require_manager | `DiscountRuleIn` | объект правила | Создать правило |
| PATCH | `/manager/subscription/discounts/{rule_id}` | require_manager | `DiscountRulePatch` | объект правила | Изменить (partial) |
| DELETE | `/manager/subscription/discounts/{rule_id}` | require_manager | — | 204 | Удалить правило |

- **Зависимости:** `app.services.subscription_plan_discount_service` (псевдоним `discs`) — вся бизнес-логика; `core.deps.require_manager`/`get_current_user`. Исключения сервиса маппятся: `ValueError→400`, `LookupError→404`, `PermissionError→403`.
- **Где менять для типовых задач:** новый scope (например, `brand`) — regex в `DiscountRuleIn.scope` + логика в сервисе; новый тип валидации — в сервисе `create_rule`/`update_rule`; формат ответа — `_to_dict`.
- **Подводные камни:** глобальные правила (`tenant_id IS NULL`) видны на чтение, но **создавать/менять их через этот роутер нельзя** — это контур super_admin (по комментарию шапки, отдельного эндпоинта пока нет). `discount_percent` приходит `float`, но в сервис передаётся `Decimal(str(...))` — корректно для денег/процентов. `commit()` делает роутер, не сервис.
- **Строк:** 169

## `backend/app/routers/subscription_pending.py`
- **Назначение:** Pending-flow подписок: пациент создаёт заявку «хочу тариф», менеджер вручную одобряет/отклоняет (особенно для наличной оплаты). Подписка активируется только через сервисы, не напрямую.
- **Ключевые элементы:** `router` без префикса (пути заданы на эндпоинтах); patient-helpers `_get_session`, `_account`; сериализатор `_serialize_request`; Pydantic `RequestSubscriptionIn`, `ApproveIn`, `RejectIn`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/patient/subscription/request` | patient-session | `RequestSubscriptionIn` | объект заявки `pending` | Пациент: создать заявку + TG менеджерам |
| GET | `/manager/subscription/pending` | require_manager | query `status` | `{items, count, status_filter}` | Список заявок по статусу |
| POST | `/manager/subscription/pending/{request_id}/approve` | require_manager | `ApproveIn` | `{subscription_id, plan_key, expires_at}` | Одобрить → создать `PatientSubscription` |
| POST | `/manager/subscription/pending/{request_id}/reject` | require_manager | `RejectIn` | `{status, reject_reason}` | Отклонить с причиной |

- **Зависимости:** `subscription_cash_service.activate_cash` (cash-оплата, возвращает sub+ledger+info), `subscription_service.start_subscription` (online/unknown) и `.plan_meta_db`, `family_service` (аккаунт по телефону), `manager_notifier.send_telegram_to_managers`, `patient_session_service.restore_session`, `subscription_module_service.health_plus_module_active` (гейт модуля → 402). Модели: `PendingSubscriptionRequest`, `PatientAccount`, `Clinic`, `PatientSession`.
- **Где менять для типовых задач:** новый payment_method — ветка в `manager_approve_pending`; интеграция ЮKassa — в ветке `online` (сейчас заглушка без оплаты); поля заявки — `RequestSubscriptionIn` + insert + `_serialize_request`; текст TG — блок формирования `tg_text`.
- **Подводные камни:** approve/reject требуют `req.status == "pending"`, иначе 409. Для `cash` обязателен `amount_received` (иначе 400). `amount_received` → `Decimal(str(...))`. TG-уведомление best-effort (обёрнуто в `try/except`, ошибка логируется, заявка создаётся всё равно). Все запросы менеджера дополнительно фильтруют по `tenant_id == user.tenant_id`.
- **Строк:** 384

## `backend/app/routers/supervisor.py`
- **Назначение:** Единый health-мониторинг платформы для страницы `AdminSupervisor.jsx` (auto-refresh 10s): backend/db/redis/frontend/prometheus/grafana + CPU/RAM/disk + последние ошибки из `audit_entries`. Плюс кнопка перезапуска сервиса.
- **Ключевые элементы:** `router` с `prefix="/admin/supervisor"`; сборщики статусов `_check_backend/_check_db/_check_redis/_check_frontend`, `_http_probe`, `_recent_errors`, `_system_stats` (psutil), `_read_version`; константы `RESTARTABLE_SERVICES={"backend","frontend"}`, `PROMETHEUS_URL`, `GRAFANA_URL`; Pydantic `RestartIn`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/admin/supervisor/status` | require_super_admin | — | `{services, recent_errors, system, timestamp}` | Снимок состояния всех сервисов |
| POST | `/admin/supervisor/restart` | require_super_admin | `RestartIn` (service, confirm) | `{ok, service, action}` | Перезапустить backend (graceful exit) / frontend (manual hint) |

- **Зависимости:** `core.deps.require_super_admin`, `app.config.settings` (redis_url), `database.AsyncSessionLocal` (отдельные сессии для проб, не `get_db`), внешние `httpx`, `psutil`, `redis.asyncio`. Параллелизм — `asyncio.gather`, синхронный psutil уносится в `run_in_executor`.
- **Где менять для типовых задач:** добавить проверяемый сервис — новый `_check_*`/`_http_probe` + добавить в `asyncio.gather` и в массив `services`; разрешить рестарт другого сервиса — `RESTARTABLE_SERVICES`; путь к VERSION — `_read_version(...)`.
- **Подводные камни:** рестарт backend = `os._exit(0)` через 1с после ответа — рассчитан на Docker restart policy; без оркестратора процесс просто умрёт. `confirm=true` обязателен. Каждая проба открывает свою сессию БД (`AsyncSessionLocal()`), не общий `get_db` — это намеренно (изоляция от транзакции запроса). `_recent_errors` проверяет существование таблицы через `to_regclass` — не падает, если `audit_entries` нет.
- **Строк:** 291

## `backend/app/routers/support.py`
- **Назначение:** Чат техподдержки v3: сотрудник пишет в поддержку, сообщения пересылаются в Telegram, оператор-менеджер отвечает через панель или через бота (webhook). Плюс отдельный публичный пациентский саппорт-чат (raw SQL по телефону).
- **Ключевые элементы:** `router` с `prefix="/support"`; конфиг бота из env/DB (`_get_bot_config`, `SUPPORT_BOT_TOKEN`, `ADMIN_CHAT_ID`, `BOT_SECRET`); Redis-ключи `OPERATOR_REDIS_KEY`, `support:closed:{uid}`; helpers `_safe_filename` (анти path-traversal), `_get_redis`; Pydantic `SendRequest`, `ReplyRequest`, `PatientSendRequest`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/support/send` | get_current_user | `SendRequest` | `{ok,id}` | Сотрудник: текст → БД + TG |
| POST | `/support/upload` | get_current_user | multipart file | `{file_url,...}` | Загрузка файла/фото (≤20МБ) → TG |
| GET | `/support/files/{filename}` | get_current_user | — | FileResponse | Отдать файл (только авторизованным) |
| GET | `/support/messages` | get_current_user | — | список сообщений | История + пометка прочитанным |
| GET | `/support/unread` | get_current_user | — | `{count}` | Счётчик непрочитанных |
| GET | `/support/status` | публичный | — | `{operator_online}` | Статус оператора (Redis) |
| POST | `/support/operator/heartbeat` | require_manager | — | `{ok}` | Оператор онлайн (TTL 300с) |
| POST | `/support/operator/offline` | require_manager | — | `{ok}` | Оператор офлайн |
| GET | `/support/admin/threads` | require_manager | — | список тредов | Все диалоги + флаг закрытия |
| GET | `/support/admin/thread/{user_id}` | require_manager | — | сообщения треда | Открыть тред + пометить прочитанным |
| POST | `/support/admin/reply/{user_id}` | require_manager | `ReplyRequest` | `{ok}` | Ответ пользователю |
| POST | `/support/admin/close/{user_id}` | require_manager | — | `{ok}` | Закрыть диалог (Redis) |
| POST | `/support/admin/reopen/{user_id}` | require_manager | — | `{ok}` | Открыть диалог заново |
| POST | `/support/bot/reply/{user_id}` | `X-Bot-Secret` | `ReplyRequest` | `{ok,user_name}` | Бот: ответ admin из Telegram |
| GET | `/support/patient/thread` | публичный | query `phone` | список | Пациентский тред по телефону (raw SQL) |
| POST | `/support/patient/send` | публичный | `PatientSendRequest` | `{ok}` | Пациент пишет в саппорт + TG |
| POST | `/support/patient/admin-reply` | require_manager | `dict` | `{ok}` | Admin отвечает пациенту |

- **Зависимости:** `app.models.support.SupportMessage`, `app.models.user.User`, `settings_service.get_setting` (per-tenant токен бота), `utils.phone.normalize_phone`, внешние `httpx` (Telegram), `redis.asyncio`. Пациентский контур работает через **raw SQL** к таблице `patient_support_messages` (без ORM-модели).
- **Где менять для типовых задач:** новый тип файла — список `allowed` в `upload_file`; формат TG-сообщения — `tg_text`/`caption`; роли в подписи — словари `role_labels`; смена хранилища статуса — Redis-ключи. Файлы лежат в `UPLOAD_DIR=/app/uploads/support`.
- **Подводные камни:** **дублирование двух контуров** — сотруднический (ORM `SupportMessage`, JWT) и пациентский (raw SQL, публичный, отдельная таблица) живут в одном файле и не связаны. Пациентские эндпоинты `/patient/*` **без авторизации** — любой может читать тред, зная телефон (риск). `body: dict` в `/patient/admin-reply` — без Pydantic-валидации. Захардкоженный токен бота удалён из git-истории (комментарий) — конфиг только из env/DB. `tenant_id`-изоляции в саппорт-чате нет (сообщения глобальны по `user_id`/телефону).
- **Строк:** 533

## `backend/app/routers/system.py`
- **Назначение:** Минимальный системный роутер: отдаёт текущую версию сборки и фоновый цикл heartbeat в внешний лицензионный хаб (HUB_URL) со статистикой инсталляции.
- **Ключевые элементы:** `router` с `prefix="/system"`; `get_current_version()` (читает файл VERSION); фоновые корутины `send_heartbeat()`, `heartbeat_loop()` (раз в час, не эндпоинты — запускаются из startup). Env `HUB_URL`, `LICENSE_KEY`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/system/version` | публичный | — | `{version}` | Версия сборки backend |

- **Зависимости:** лениво внутри `send_heartbeat`: `database.AsyncSessionLocal`, модели `User`/`Referral`/`Clinic` (только `func.count`), внешний `httpx`. POST на `{HUB_URL}/hub/api/licenses/validate`.
- **Где менять для типовых задач:** добавить метрики в heartbeat — словарь `stats` в `send_heartbeat`; частота — `asyncio.sleep(3600)` в `heartbeat_loop`; путь VERSION — список в `get_current_version`. `heartbeat_loop` нужно зарегистрировать в startup-хуке `main.py` (здесь только определение).
- **Подводные камни:** heartbeat молча отключается, если не заданы `HUB_URL`/`LICENSE_KEY`. Счётчики глобальны (без `tenant_id`) — это инсталляционная телеметрия, не per-tenant. Весь heartbeat обёрнут в `try/except: pass` — ошибки не логируются (тихо).
- **Строк:** 64

## `backend/app/routers/telemedicine.py`
- **Назначение:** Видеоприёмы (Этап 2): полноценный REST для врача + публичный REST для пациента по join-токену + WebSocket signaling (WebRTC offer/answer/ICE) для обеих сторон. Самый крупный файл среза.
- **Ключевые элементы:** **два** роутера — `router` (`prefix="/telemed"`) и `patient_router` (`prefix="/patient-portal/telemed"`); helpers `_tenant_secret` (HMAC-подпись рецептов per-tenant), `_normalize_phone`, `_ice_servers_for` (STUN+time-limited TURN credentials), `_get_session_for_user` (tenant-guard), `_resolve_session_by_token` (JWT + hash-проверка); сериализатор `_session_to_dict`; Pydantic `CreateSessionRequest/Response`, `PrescriptionRequest`, `ConsentRequest`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/telemed/sessions` | require_module + user | `CreateSessionRequest` | `CreateSessionResponse` (join_url) | Создать сессию + SMS + push в ЛК |
| GET | `/telemed/sessions` | require_module + user | query-фильтры | `{total, items}` | Список сессий тенанта |
| GET | `/telemed/sessions/{id}` | require_module + user | — | session dict | Детали |
| GET | `/telemed/sessions/{id}/ice-config` | require_module + user | — | iceServers | ICE для врача |
| POST | `/telemed/sessions/{id}/start` | require_module + user | — | session dict | status=active |
| POST | `/telemed/sessions/{id}/end` | require_module + user | — | session dict | status=ended + duration + WS-уведомление |
| POST | `/telemed/sessions/{id}/cancel-incoming` | require_module + user | — | `{ok}` | Отменить «звонок» в ЛК пациента |
| GET | `/telemed/sessions/{id}/messages` | require_module + user | query limit/offset | `{total, items}` | Чат-лог |
| POST | `/telemed/sessions/{id}/messages` | require_module + user | multipart (text/file) | сообщение | Добавить сообщение врача + WS push |
| POST | `/telemed/sessions/{id}/prescription` | require_module + user | `PrescriptionRequest` | рецепт + signature | HMAC-подписанный рецепт |
| GET | `/telemed/sessions/{id}/prescriptions` | require_module + user | — | `{items}` | Список рецептов |
| GET | `/patient-portal/telemed/{token}/info` | публичный (join_token) | — | инфо сессии | Данные для пациента |
| GET | `/patient-portal/telemed/{token}/ice-config` | публичный (join_token) | — | iceServers | ICE для пациента |
| POST | `/patient-portal/telemed/{token}/consent` | публичный (join_token) | `ConsentRequest` | `{ok, consent_id}` | Согласие на ПД/запись |
| WS | `/telemed/ws/{token}` | join_token | WS JSON | signaling | Сигналинг пациента |
| WS | `/telemed/ws/doctor/{session_id}` | `?token=` JWT | WS JSON | signaling | Сигналинг врача |

- **Зависимости:** `core.tenant.require_module("telemedicine")`, `core.security.decode_token`, `services.telemed_signaling.telemed_signaling` (pub/sub WS), `services.telemed_token` (`create_join_token`/`hash_token`/`verify_join_token`/`verify_token_against_hash`), `app.routers.patient_notifications.notify_patient` (входящий «звонок»), `plugins.registry` (SMS), модели `TelemedicineSession`/`ChatMessage`/`Prescription`, `Doctor`, `ConsentRecord`, `User`. Конфиг TURN/secret — `app.config.settings`.
- **Где менять для типовых задач:** STUN/TURN — `_ice_servers_for`; срок жизни ссылки — `telemed_token.create_join_token`; домен join_url — строка `https://клиниксеть.рф/p/telemed/{raw_token}` (хардкод!); подпись рецепта — `_tenant_secret` + `create_prescription`; авторизация врача в WS — блок `doctor_signaling_ws`.
- **Подводные камни:** WS **не используют `Depends`** (decode_token + проверки вручную) — комментарий явно говорит «WS не любит Depends-цепочку». Домен `клиниксеть.рф` захардкожен в join_url. `ConsentRecord.user_id` NOT NULL — пишется `tenant_id` как «прокси-юзер» с fallback в `session.notes` при FK-ошибке (хрупкое место, см. комментарий). Доменный fallback в WS врача: проверка роли фактически `pass` (разрешён любой активный юзер тенанта). datetime хранится naive (`utcnow()`). super_admin определяется по роли ИЛИ по `settings.superadmin_username`.
- **Строк:** 939

## `backend/app/routers/tenant.py`
- **Назначение:** Базовый роутер текущего тенанта: инфо, брендинг (read/update), лицензия, статус модулей и публичный/защищённый онбординг нового тенанта.
- **Ключевые элементы:** `router` с `prefix="/tenant"`; Pydantic `TenantOut`, `LicenseOut`, `BrandingOut`/`BrandingUpdate` (с white-label CMS полями: favicon, og_image, custom_domain, meta, hide/rename menu items), `TenantCreateRequest`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/tenant/current` | get_current_user | — | `TenantOut` | Инфо о текущем тенанте |
| GET | `/tenant/branding` | публичный (по tenant) | — | `BrandingOut` | Настройки брендинга (с дефолтами) |
| PATCH | `/tenant/branding` | require_manager | `BrandingUpdate` | `BrandingOut` | Обновить брендинг |
| GET | `/tenant/license` | публичный (по tenant) | — | `LicenseOut` | Лицензия тенанта |
| POST | `/tenant/create` | публичный + secret_key | `TenantCreateRequest` | логин/пароль/URL | Онбординг нового тенанта |
| GET | `/tenant/modules-status` | get_current_user | — | `{modules:[...]}` | Статусы платных модулей тенанта |

- **Зависимости:** `core.tenant.get_current_tenant`, модели `Tenant`/`TenantLicense`/`TenantBranding`, лениво `services.tenant_onboarding_service.onboard_tenant` (создаёт tenant+license+branding+admin), `models.commercial.TenantModuleSubscription`. Защита онбординга — `settings.onboarding_secret`.
- **Где менять для типовых задач:** новое поле брендинга — `BrandingOut` + `BrandingUpdate` + миграция модели `TenantBranding`; логика создания тенанта — `tenant_onboarding_service`, не роутер; дефолтные цвета (#0097A7/#004D5F) — в `get_branding`/`get_tenant_current`.
- **Подводные камни:** при `tenant is None` (single-tenant режим) везде фолбэк на `Tenant.slug == "default"`. `/tenant/create` публичный, защищён только опциональным `secret_key` — если `onboarding_secret` не задан в конфиге, эндпоинт **открыт всем** (риск). `update_branding` использует `exclude_none=True` — `None` не затирает поля (намеренно). `/tenant/branding` и `/tenant/license` не требуют JWT — раскрывают данные тенанта по контексту.
- **Строк:** 265

## `backend/app/routers/tenant_api_keys.py`
- **Назначение:** Управление программными API-ключами тенанта (для внешних интеграций). Только владелец франшизы / super_admin, гейтится модулем `webhooks`.
- **Ключевые элементы:** `router` с `prefix="/tenant/api-keys"`; Pydantic `ApiKeyCreate`/`ApiKeyUpdate` (name, scopes, ttl_days, allowed_ips).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/tenant/api-keys/scopes` | require_franchise_owner | — | `{scopes}` | Доступные скоупы с метками |
| GET | `/tenant/api-keys` | franchise_owner + require_module(webhooks) | — | список ключей (без raw) | Список ключей тенанта |
| POST | `/tenant/api-keys` | franchise_owner + require_module | `ApiKeyCreate` | ключ + `raw_key` (один раз!) | Создать ключ |
| PATCH | `/tenant/api-keys/{key_id}` | franchise_owner + require_module | `ApiKeyUpdate` | объект ключа | Обновить name/scopes/ips/ttl |
| DELETE | `/tenant/api-keys/{key_id}` | franchise_owner + require_module | — | `{status:revoked}` | Отозвать (soft delete) |

- **Зависимости:** `services.api_key_service` (`create_key`/`revoke_key`/`serialize`/`validate_scopes`, `ALLOWED_SCOPES`, `SCOPE_LABELS`), `services.audit_service.write_safe` (аудит create/update/revoke), `core.deps.require_franchise_owner`, `core.tenant.require_module`, модель `TenantApiKey`.
- **Где менять для типовых задач:** новый скоуп — `api_key_service.ALLOWED_SCOPES`/`SCOPE_LABELS`; правила валидации — `validate_scopes` в сервисе; формат хранения — `api_key_service.serialize`. Хэширование/генерация raw-ключа — в сервисе, не здесь.
- **Подводные камни:** `raw_key` показывается **ровно один раз** при создании (по дизайну — потом только prefix). Удаление — soft (`revoked_at=now`), отозванный ключ нельзя редактировать (400). Все мутации пишут аудит через `write_safe` (best-effort, не ломает основную транзакцию). `/scopes` без `require_module` — доступен всегда владельцу.
- **Строк:** 198

## `backend/app/routers/tenant_settings.py`
- **Назначение:** Узкоспециализированный роутер настроек чата тенанта (SLA-таймауты по ролям + autoclose). Хранит значения в JSON-поле `Tenant.settings`.
- **Ключевые элементы:** `router` с `prefix="/tenant/settings"`; кортеж ключей `CHAT_KEYS`; helpers `_get_chat_settings_dict`, `_merge_chat_settings`, `_require_settings_role` (manager/owner/super_admin); Pydantic `ChatSettingsIn` (с диапазонами ge/le).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/tenant/settings/chat` | manager/owner/super_admin | — | dict настроек чата | Текущие SLA/autoclose |
| PATCH | `/tenant/settings/chat` | manager/owner/super_admin | `ChatSettingsIn` | dict настроек | Обновить (merge в `Tenant.settings`) |

- **Зависимости:** `services.chat_sla_job.DEFAULT_SETTINGS` (дефолты для незаданных ключей), модель `Tenant`, `core.deps.get_current_user`. Реальное применение SLA — в фоновом `chat_sla_job`.
- **Где менять для типовых задач:** новый ключ настройки чата — добавить в `CHAT_KEYS` + `ChatSettingsIn` + `DEFAULT_SETTINGS` в `chat_sla_job`; ограничения значений — валидаторы `Field(ge/le)`.
- **Подводные камни:** хранит данные в **JSON-колонке `Tenant.settings`** (не отдельная таблица) — мутация через `_merge_chat_settings` создаёт новый dict и присваивает целиком (важно для SQLAlchemy change-tracking JSON). super_admin может ходить без `tenant_id`, но GET/PATCH всё равно ищут `Tenant.id == user.tenant_id` → для super_admin без тенанта вернётся 404.
- **Строк:** 75

## `backend/app/routers/tenant_telephony.py`
- **Назначение:** Телефония тенанта: конфиг провайдера (Mango/Sipuni/Zadarma/OnlinePBX/custom), DID-номера, инициация исходящего звонка, история, скачивание записи и приём вебхуков от провайдеров.
- **Ключевые элементы:** `router` **без префикса** (пути на эндпоинтах); helpers `_normalize_phone` (+`InvalidPhoneError`), `_require_settings_role`, сериализаторы `_serialize_config`/`_serialize_did`, `_create_outgoing_call`; Pydantic `ConfigIn` (regex провайдера), `DidIn` (валидатор номера), `DialIn`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/tenant/settings/telephony` | manager/owner/super_admin | — | config dict | Конфиг провайдера (без секретов) |
| PATCH | `/tenant/settings/telephony` | manager/owner/super_admin | `ConfigIn` | config dict | Обновить конфиг (ключи шифруются) |
| GET | `/tenant/did-numbers` | settings-role | — | `{dids}` | Список DID-номеров |
| POST | `/tenant/did-numbers` | settings-role | `DidIn` | did dict | Добавить DID |
| PATCH | `/tenant/did-numbers/{did_id}` | settings-role | `DidIn` | did dict | Изменить DID |
| DELETE | `/tenant/did-numbers/{did_id}` | settings-role | — | 204 | Удалить DID |
| POST | `/calls/dial` | get_current_user | `DialIn` | `{call_id, status, to_number}` | Инициировать исходящий (503 если не настроен) |
| GET | `/telephony/calls` | settings-role | query-фильтры | `{calls, page}` | История звонков (пагинация) |
| GET | `/telephony/calls/{call_id}/recording` | settings-role | — | audio/mpeg | Скачать запись через провайдер |
| POST | `/telephony/webhook/sipuni` | публичный | `dict` | `{ok}` | Webhook Sipuni |
| POST | `/telephony/webhook/mango` | публичный | `dict` | `{ok}` | Webhook Mango |
| POST | `/telephony/webhook/zadarma` | публичный | `dict` | `{ok}` | Webhook Zadarma |

- **Зависимости:** `services.telephony.factory.get_provider` (по tenant), провайдеры `services.telephony.{sipuni,mango,zadarma}` (парсинг вебхуков), `services.encryption_service` (Fernet `encrypt` для api_key/secret), модели `TelephonyConfig`/`DidNumber`/`PhoneCall`.
- **Где менять для типовых задач:** новый провайдер — regex в `ConfigIn.provider` + класс в `services.telephony` + ветка в factory + (опц.) свой webhook-эндпоинт; нормализация номера — `_normalize_phone`; поля звонка в истории — `list_calls`. DID и звонки фильтруются по `tenant_id`.
- **Подводные камни:** **вебхуки провайдеров публичные** (без подписи) — комментарии явно фиксируют: Sipuni/Mango/Zadarma не подписывают входящие, ищут `PhoneCall` по `provider_call_id` глобально (без tenant-фильтра в webhook — потенциальная коллизия id между тенантами). API-ключи шифруются Fernet и не возвращаются (только `has_api_key` флаг). `dial` создаёт `PhoneCall` даже при неудаче (для аудита) и кидает 503. `_normalize_phone` — РФ-специфичный (8→7, 10 цифр→+7).
- **Строк:** 480

## `backend/app/routers/visiting_doctor.py`
- **Назначение:** Управление приезжими/приглашёнными врачами: настройки оплаты (цена+процент), запись приёмов (с QR/short_code), завершение визита с разноской в ledger (VISIT_REVENUE/DOCTOR_SHARE/CLINIC_SHARE), доход врача, suspend/resume. Второй по объёму файл среза.
- **Ключевые элементы:** `router` с `prefix="/visiting"`; общий `_admin = Depends(require_role("reg","manager","super_admin"))`; Pydantic `VisitingSettingsCreate`, `CompleteVisitBody` (qr/short_code/apt_id), `BookAppointmentBody`, `UpdateDoctorBody`, `AppointmentEditBody`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/visiting/admin/settings` | reg/manager/super_admin | `VisitingSettingsCreate` | `{id, created/updated}` | Создать/обновить настройки врача |
| GET | `/visiting/admin/settings` | _admin | — | список настроек | Все visiting-настройки тенанта |
| GET | `/visiting/my-queue` | get_current_user | — | очередь на сегодня | Приёмы врача на сегодня |
| GET | `/visiting/my-visits` | get_current_user | — | список приёмов | Все приёмы врача |
| GET | `/visiting/my-income` | get_current_user | — | `{total, entries}` | Доход врача из ledger |
| POST | `/visiting/admin/complete-visit` | _admin | `CompleteVisitBody` | статус + разноска | Завершить визит + ledger + лояльность + costing |
| POST | `/visiting/admin/book-appointment` | _admin | `BookAppointmentBody` | apt + QR + patient_url | Создать запись (генерит QR/short_code/токен) |
| GET | `/visiting/admin/appointments/{doctor_user_id}` | _admin | query дат | `{appointments, stats}` | Приёмы врача + статистика |
| PATCH | `/visiting/admin/update-doctor/{doctor_user_id}` | _admin | `UpdateDoctorBody` | `{updated}` | Изменить врача/настройки/пароль |
| GET | `/visiting/admin/all-appointments` | _admin | query фильтры | список всех | Все приёмы всех visiting-врачей |
| PATCH | `/visiting/admin/appointments/{apt_id}/edit` | _admin | `AppointmentEditBody` | `{updated}` | Редактировать запись |
| DELETE | `/visiting/admin/appointments/{apt_id}` | _admin | — | `{deleted}` | Удалить запись |
| PATCH | `/visiting/admin/suspend-doctor/{doctor_user_id}` | _admin | — | `{suspended}` | Приостановить врача |
| PATCH | `/visiting/admin/resume-doctor/{doctor_user_id}` | _admin | — | `{resumed}` | Возобновить врача |

- **Зависимости:** модели `VisitingDoctorSettings`, `Doctor`/`Appointment`/`AppointmentStatus`, `LedgerEntry`, `User`/`UserRole`, `Clinic`; `core.deps.require_role`; лениво — `loyalty_ext_service.award_appointment` (+50 баллов), `appointment_costing.on_appointment_completed` (списание ТМЦ), `core.security.make_appointment_token`/`get_password_hash`, `qr_service.generate_url_qr_base64`, внешние `qrcode`.
- **Где менять для типовых задач:** правила разноски долей — `complete_visit` (ветки internal vs settings); процент по умолчанию (70%) — раскидан по нескольким функциям (`get_my_queue`, `get_visiting_doctor_appointments`, `get_all_visiting_appointments`); генерация QR/токена записи — `book_visiting_appointment`; смена статуса — `status_map` в `edit_appointment`.
- **Подводные камни:** **дефолт 70% дублируется в 4 местах** — менять синхронно. `complete_visit` пишет до 3 LedgerEntry, `doctor_share` через `Decimal.quantize(0.01)` — корректно; но дублируется расчёт `doctor_share_val` для ответа (повторный quantize). Сравнение статусов смешанное: `str(a.status) in ("completed","AppointmentStatus.COMPLETED")` — хрупкая строковая проверка (легаси, зависит от str-репрезентации enum). loyalty/costing-хуки best-effort (`try/except pass`). Все запросы фильтруют `tenant_id`, но `complete_visit` по qr/short_code ищет глобально, затем проверяет `appointment.tenant_id != current_user.tenant_id` → 404.
- **Строк:** 859

## `backend/app/routers/vitals.py`
- **Назначение:** Витальные показатели пациента (давление, пульс, шаги и т.п.): ручной ввод, временные ряды, summary с дельтой за неделю и идемпотентная синхронизация Apple HealthKit. Авторизация — patient-session, не JWT.
- **Ключевые элементы:** `router` с `prefix="/patient/vitals"`; helper `_session_or_401` (токен из `X-Patient-Session`/`?session_token`/`?t`); сериализатор `_serialize`; Pydantic `VitalIn`, `AppleHealthSample`, `AppleHealthSyncBody`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/patient/vitals/summary` | patient-session | — | `{latest, available_sources}` | Последние значения + delta за ~7д |
| GET | `/patient/vitals/series` | patient-session | query metric/days | `{metric, days, points}` | Временной ряд метрики |
| POST | `/patient/vitals` | patient-session | `VitalIn` | vital dict | Ручная запись |
| POST | `/patient/vitals/sync/apple-health` | patient-session | `AppleHealthSyncBody` | результат импорта | Bulk-синхронизация HealthKit |
| DELETE | `/patient/vitals/{vital_id}` | patient-session | — | `{ok}` | Удалить свою запись |

- **Зависимости:** `services.vitals_service` (`get_latest_per_metric`/`get_series`/`add_vital`/`bulk_import`), `patient_session_service.restore_session`, модель `PatientVital`, `utils.phone.normalize_phone`, `models.commercial.TenantModuleSubscription` (определение доступных источников apple/google).
- **Где менять для типовых задач:** новая метрика/единицы — в `vitals_service` (валидация) + фронт; новый источник синхронизации (google fit) — `bulk_import` с `source="..."` + ключ модуля `health_google`; окно дельты — `week_ago`/`timedelta(days=23)` в `vitals_summary`.
- **Подводные камни:** **TODO в коде (строки 230-234):** Apple Health не закрыт платным модулем — `require_module` работает по JWT-`tenant_id`, а тут patient-session; нужен patient-aware декоратор + ключ `vitals_apple_health` в каталоге. PG-колонка `TIMESTAMP WITHOUT TIME ZONE` — везде явный `.replace(tzinfo=None)` для aware-datetime (важно, иначе insert падает). Дедуп Apple Health — по `metric+measured_at` в сервисе (идемпотентно). DELETE сверяет владельца по `normalize_phone(rec.patient_phone) == normalize_phone(session.phone)` → 403 на чужие. `available_sources` смотрит активные модули тенанта (`active`/`trial`).
- **Строк:** 290

## `backend/app/routers/webhooks.py`
- **Назначение:** CRUD исходящих вебхуков тенанта + просмотр лога доставок + тестовый пинг. Гейтится модулем `webhooks`, доступ — менеджер.
- **Ключевые элементы:** `router` с `prefix="/webhooks"`; сериализатор `_ep_out`; Pydantic `WebhookCreateRequest`/`WebhookUpdateRequest`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/webhooks/events` | require_manager + require_module | — | `{events}` | Список событий для подписки |
| GET | `/webhooks` | require_manager + require_module | — | список endpoint'ов | Вебхуки тенанта |
| POST | `/webhooks` | require_manager + require_module | `WebhookCreateRequest` | endpoint dict | Зарегистрировать (макс. 10) |
| PATCH | `/webhooks/{webhook_id}` | require_manager + require_module | `WebhookUpdateRequest` | endpoint dict | Обновить |
| DELETE | `/webhooks/{webhook_id}` | require_manager + require_module | — | `{status:deleted}` | Удалить |
| GET | `/webhooks/{webhook_id}/deliveries` | require_manager + require_module | query limit | список доставок | История доставок |
| POST | `/webhooks/{webhook_id}/test` | require_manager + require_module | — | `{status:sent}` | Тестовый пинг `test_ping` |

- **Зависимости:** `services.webhook_service` (`WEBHOOK_EVENTS` — каталог событий, `send_event` — отправка), модели `WebhookEndpoint`/`WebhookDelivery`, `core.tenant.require_module("webhooks")`, `core.deps.require_manager`.
- **Где менять для типовых задач:** новое событие — `webhook_service.WEBHOOK_EVENTS` (валидация при создании ссылается на этот список); лимит вебхуков — число `>= 10` в `create_webhook`; формат доставки/ретраи — в `webhook_service.send_event`.
- **Подводные камни:** лимит 10/тенант проверяется неэффективно — грузит все endpoints и считает `len(...)` (можно заменить на `func.count`). `events=None` означает «все события». Все запросы фильтруют `tenant_id`. Валидация событий только при create (PATCH `events` не валидируется против `WEBHOOK_EVENTS`!) — потенциальная дыра.
- **Строк:** 212

## `backend/app/routers/wellness.py`
- **Назначение:** Глава 10 — wellness-партнёрка: пациент с активной подпиской видит партнёров своего тарифа и кликает (запись клика + промокод/ссылка); super_admin-контур CRUD партнёров + аналитика кликов.
- **Ключевые элементы:** `router` **без префикса** (пути на эндпоинтах); `_REQUIRE_ADMIN = Depends(require_role(MANAGER, FRANCHISE_OWNER, SUPER_ADMIN))`; patient-helpers `_get_session`/`_account`/`_patient_plan`; сериализатор `_serialize` (с флагом `include_admin`); Pydantic `PartnerIn`/`PartnerPatch`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/patient/wellness/partners` | patient-session | — | `{items, plan, total}` | Партнёры по тарифу пациента |
| POST | `/patient/wellness/partners/{partner_id}/click` | patient-session | — | `{ok, link_url, promo_code}` | Записать клик + выдать промокод |
| GET | `/admin/wellness/partners` | manager/owner/super_admin | query only_active | `{items}` | Все партнёры (вкл. выключенные) |
| POST | `/admin/wellness/partners` | admin | `PartnerIn` | partner dict | Создать партнёра |
| PATCH | `/admin/wellness/partners/{partner_id}` | admin | `PartnerPatch` | partner dict | Изменить |
| DELETE | `/admin/wellness/partners/{partner_id}` | admin | — | 204 | Удалить |
| GET | `/admin/wellness/analytics` | admin | query partner_id | аналитика | Аналитика кликов |

- **Зависимости:** `services.wellness_service` (`list_partners_for_plan`/`plan_allows`/`record_click`/`get_partner_analytics`), `family_service` (аккаунт по телефону), `patient_session_service.restore_session`, модели `WellnessPartner`/`WellnessPartnerClick`, `PatientSubscription` (определение тарифа), `core.deps.require_role`.
- **Где менять для типовых задач:** правила доступа партнёра по тарифу — `wellness_service.plan_allows` / `min_subscription_plan`; поля партнёра — `PartnerIn`/`PartnerPatch`/`_serialize`; аналитика — `wellness_service.get_partner_analytics`.
- **Подводные камни:** партнёры **глобальны (не tenant-scoped)** — это платформенный каталог, управляется admin-ролями без фильтра по тенанту (в отличие от большинства роутеров среза). Тариф пациента берётся из последней `active`/`trial` подписки. `_serialize` без `include_admin` скрывает `promo_code`/`link_url`/`active` от пациента в списке — промокод выдаётся только при `click` после проверки `plan_allows`. В `admin_list_partners` есть лишний неиспользуемый `current_user` (dead param).
- **Строк:** 269
