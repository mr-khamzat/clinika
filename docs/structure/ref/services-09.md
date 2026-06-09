# services [09] — Telegram-боты, аудит, вебхуки, витальные показатели, темы, wellness, Whisper

Это сборная (девятая) группа сервисов backend МИС clinika — девять разнородных модулей-сервисов из `backend/app/services`, которые объединяет одно: ни один из них не является HTTP-роутером. Это «рабочие лошадки», которые вызываются из роутеров, из планировщика APScheduler или из SQLAlchemy-событий. В группе:

- **Два Telegram-сервиса** — owner/admin-бот: `tg_owner_bot_poll.py` (long-poll цикл getUpdates, запускается APScheduler каждые 2 сек) и `tg_admin_bot.py` (inline-меню админ-команд, вызывается из поллера).
- **Аудит ORM-событий** — `user_audit_listeners.py` (синхронные SQLAlchemy-листенеры на модель `User`).
- **Два вебхук-модуля** — `webhook_service.py` (синхронная отправка событий тенанта с HMAC-подписью и retry) и `webhook_queue.py` (надёжная Redis-очередь с экспоненциальным backoff).
- **Витальные показатели пациента** — `vitals_service.py` (Apple Health / ручной ввод, идемпотентный bulk-import).
- **Брендинг/тема тенанта** — `theme_service.py` (получение темы + генерация CSS-переменных). **Содержит баг!**
- **Wellness-партнёры** — `wellness_service.py` (список партнёров по тарифу, клики, аналитика).
- **Whisper-транскрипция** — `whisper_service.py` (расшифровка записей звонков через OpenAI).

Большинство сервисов корректно фильтруют по `tenant_id` и аккуратно работают с `Decimal`. Точки внимания вынесены в раздел «Подводные камни» каждого файла.

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `tg_admin_bot.py` | Inline-меню админ-команд owner-бота | 700 |
| `tg_owner_bot_poll.py` | Long-poll цикл getUpdates owner-бота | 293 |
| `theme_service.py` | Тема/брендинг тенанта + CSS-переменные | 71 |
| `user_audit_listeners.py` | ORM-листенеры аудита создания/смены пароля | 145 |
| `vitals_service.py` | Витальные показатели пациента, bulk-import | 256 |
| `webhook_queue.py` | Redis-очередь вебхуков с retry | 60 |
| `webhook_service.py` | Отправка событий тенанта с HMAC | 123 |
| `wellness_service.py` | Wellness-партнёры по тарифу, клики | 74 |
| `whisper_service.py` | Whisper-транскрипция записей звонков | 169 |

---

## `backend/app/services/tg_admin_bot.py`

- **Назначение:** Реализует inline-кнопочную админ-панель внутри Telegram owner-бота: статус сервера, health-check контейнеров, ошибки за 24ч, чаты, тенанты+MRR, пациенты, записи/касса дня, backup БД, restart backend, логи, test push. Подключается из `tg_owner_bot_poll.py` при обработке `callback_query` и команд `/start /help /admin /menu`.
- **Ключевые элементы:**
  - Класс `_RingLogHandler` + `_install_ring_logger()` — in-memory кольцевой буфер на 200 строк, подключается к логерам `tg_admin_bot, tg_owner_poll, uvicorn.error, fastapi, app, sqlalchemy.engine`.
  - Telegram-обёртки: `_tg_post`, `send_message`, `answer_callback`, `edit_message` (все через прокси `_proxy_url()`).
  - `_is_admin(tg_user_id)` — проверка роли по `User.telegram_id` (строкой!); допускает `super_admin, franchise_owner, manager, admin`.
  - Команды (все `async def cmd_*`): `cmd_status` (читает `/proc/uptime|meminfo|loadavg`, `df -h`), `cmd_health` (HTTP `/health` + TCP-пробы 7 контейнеров), `cmd_errors`, `cmd_chats`, `cmd_tenants`, `cmd_patients`, `cmd_appointments_today`, `cmd_cash_today`, `cmd_backup_db`, `cmd_logs_backend`, `cmd_test_push`, `cmd_restart_backend`.
  - `_sh(cmd)` — запуск shell через `subprocess.run(shell=True)`.
  - Клавиатуры-словари `MAIN_KEYBOARD`, `CONFIRM_RESTART`.
  - Главные обработчики: `handle_callback(callback)` (диспетчер по `admin:<action>`) и `handle_command(msg)`.
- **Эндпоинты:** нет (это не роутер; точки входа — `handle_callback` и `handle_command`, вызываемые из поллера).
- **Зависимости:** `app.config.settings` (`owner_bot_token`), `app.database.AsyncSessionLocal`, `app.models.user.User/UserRole`; `httpx` через прокси; прямой SQL через `text()` к таблицам `audit_log, payments, blocked_ips, chat_threads, tenants, users, patient_accounts, appointments, push_subscriptions`. Вызывается из `tg_owner_bot_poll._process_update`.
- **Где менять для типовых задач:**
  - Новая кнопка в меню → добавь запись в `MAIN_KEYBOARD["inline_keyboard"]` (`callback_data: "admin:<action>"`) и зарегистрируй обработчик в словаре `handlers` внутри `handle_callback`.
  - Новая метрика/отчёт → напиши `async def cmd_xxx()` возвращающую HTML-строку и подключи в `handlers`.
  - Расширить круг админов → правь список ролей в `_is_admin` (строка ~158).
  - Сменить прокси Telegram → env `TELEGRAM_PROXY_URL` либо хардкод в `_proxy_url()`.
- **Подводные камни:**
  - `_is_admin` сравнивает `User.telegram_id == str(tg_user_id)` — в БД ID хранится **строкой**; число не совпадёт.
  - Все cmd-запросы идут **сырым SQL без фильтра по tenant_id** — это глобальная админка владельца сети (by design), не путать с пользовательскими роутерами.
  - `_sh` использует `shell=True` — потенциальный вектор инъекции, но команды захардкожены (внешнего ввода нет).
  - `cmd_restart_backend` делает `os._exit(0)` через 2 сек — рассчитан на `restart: always` контейнера; запускать осознанно.
  - Прокси-креды захардкожены как fallback прямо в коде (`_proxy_url`) — секрет в репозитории.
  - `cmd_backup_db` / `cmd_restart_backend` пишут marker-файлы (`/app/data/...`), а реальную работу делает host-cron — без host-cron эти команды бесполезны.
- **Строк:** 700

---

## `backend/app/services/tg_owner_bot_poll.py`

- **Назначение:** Long-polling owner-бота через `getUpdates`. Telegram-webhook не достучаться до сервера, поэтому backend сам пуллит апдейты. Главная задача: проброс ответов владельца из Telegram обратно в комнаты staff-chat (по маркеру `room:<uuid>` в исходном сообщении), включая скачивание вложений. Также делегирует callback-кнопки и команды в `tg_admin_bot`.
- **Ключевые элементы:**
  - `tg_owner_bot_poll_job()` — один цикл long-poll: `getUpdates(timeout=20, offset)` → перебор апдейтов → `_save_offset`. **Регистрируется в APScheduler** (`main.py:1174`, `interval=2s, max_instances=1`).
  - `_process_update(update)` — роутинг: `callback_query`→`tg_admin_bot.handle_callback`; команды→`tg_admin_bot.handle_command`; иначе — обработка reply владельца в комнату staff-chat.
  - `_download_telegram_file(file_id, name)` — `getFile` + скачивание в `STORAGE_ROOT/<дата>/<uuid>_<name>`, возврат метаданных.
  - Offset-state: `_load_offset` / `_save_offset` в `/opt/clinika/data/tg_owner_offset.txt`.
  - Константы: `OFFSET_FILE`, `STORAGE_ROOT`, `FILE_TTL_HOURS=48`, `ROOM_MARKER_RE` (regex `room:<36-симв uuid>`).
- **Эндпоинты:** нет (фоновый job-сервис).
- **Зависимости:** `app.config.settings` (`owner_bot_token`, `owner_telegram_id`); `app.database.AsyncSessionLocal`; `app.models.user.User/UserRole`; `app.models.staff_chat.StaffChatFile`; `app.services.staff_chat_service as svc` (`is_member`, `get_room`, `send_message`, `serialize_message`); `app.routers.staff_chat.ws_hub` (WS-broadcast нового сообщения); `app.services.tg_admin_bot` (lazy-import). `httpx` через прокси.
- **Где менять для типовых задач:**
  - Изменить частоту опроса → правь `main.py:1174` (`seconds=2`).
  - Поддержать новый тип вложения (например, sticker) → добавь ветку в блок `attachments_to_save` внутри `_process_update` (~строки 155-184).
  - Сменить TTL файлов → `FILE_TTL_HOURS`.
  - Изменить, кому разрешено отвечать → проверка `from_id != owner_tg` (~строка 140).
- **Подводные камни:**
  - Если `owner_telegram_id` пуст — фильтр отправителя пропускает любого ответившего (см. `if owner_tg and ...`).
  - Маркер `room:<uuid>` обязан присутствовать в тексте/caption исходного сообщения, иначе reply игнорируется.
  - Файлы скачиваются **вне транзакции** (намеренно), затем отдельная сессия пишет `StaffChatFile` + сообщение и коммитит.
  - Пути жёстко `/opt/clinika/data/...` — это привязка к Linux-хосту/контейнеру, локально под Windows не работает.
  - Прокси-креды захардкожены как fallback (тот же секрет, что в `tg_admin_bot`).
  - Если отправитель не найден по `telegram_id`, fallback — первый `SUPER_ADMIN` (сообщение запишется от его имени).
- **Строк:** 293

---

## `backend/app/services/theme_service.py`

- **Назначение:** Возвращает тему/брендинг тенанта (цвета, шрифт, лого, SEO-мета, кастомный домен, скрытие/переименование пунктов меню) с дефолтами «КлиникСеть», и собирает CSS-переменные для `:root`.
- **Ключевые элементы:**
  - `DEFAULT_THEME` — словарь дефолтных значений (primary `#0097A7`, sidebar `#004D5F` и т.д.).
  - Класс `ThemeService`:
    - `get_theme(db, tenant_id)` — async, читает `TenantBranding` по `tenant_id`, мёрджит с дефолтами через `getattr(..., None)` (защита от отсутствующих колонок).
    - `to_css_variables(theme)` — static, отдаёт строку `:root{...}`.
- **Эндпоинты:** нет (вызывается из роутеров брендинга/публичной темы).
- **Зависимости:** `app.models.tenant.TenantBranding`; `sqlalchemy.AsyncSession`.
- **Где менять для типовых задач:**
  - Добавить новое поле темы → добавь ключ в `DEFAULT_THEME` и строку в `get_theme` (`getattr(b, "new_field", None)`), при необходимости в `to_css_variables`.
  - Сменить дефолтные цвета сети → правь `DEFAULT_THEME`.
- **Подводные камни — ВНИМАНИЕ, БАГ:**
  - **`to_css_variables` неисправен.** В f-строках используются `theme[primary_color]` вместо `theme["primary_color"]` (строки 65-68). `primary_color`, `secondary_color` и т.д. — это **необъявленные имена переменных**, поэтому при вызове метод выбросит `NameError`. Метод нужно починить: обернуть ключи в кавычки (`theme['primary_color']`). Если этот метод сейчас нигде не вызывается — это «мёртвый» сломанный код; перед использованием обязательно исправить.
  - `get_theme` корректно фильтрует по `tenant_id`; при пустом `tenant_id` или отсутствии записи отдаёт копию дефолта.
- **Строк:** 71

---

## `backend/app/services/user_audit_listeners.py`

- **Назначение:** Регистрирует синхронные SQLAlchemy ORM-листенеры на модель `User`, пишущие в `audit_log` два события: `user.created` (при INSERT) и `user.password_changed` (при реальном изменении `password_hash`). Импортируется один раз в `main.py:202` ради сайд-эффекта регистрации.
- **Ключевые элементы:**
  - `_resolve_actor()` — достаёт actor из `contextvar current_impersonator` (заполнен только при impersonation super_admin); иначе `(None, None)`.
  - `_role_str(role)` — нормализация enum/строки роли.
  - `@event.listens_for(User, "after_insert") _user_after_insert` — пишет `user.created` с полным payload в `after`.
  - `@event.listens_for(User, "before_update") _user_before_update` — через `get_history` определяет смену `password_hash` и помечает target атрибутом `_MARK_PWD_CHANGED`.
  - `@event.listens_for(User, "after_update") _user_after_update` — если был mark, пишет `user.password_changed`, затем снимает mark.
- **Эндпоинты:** нет (ORM event hooks).
- **Зависимости:** `app.core.request_ctx.current_impersonator` (lazy); `app.models.user.User`; `app.models.audit.AuditEntry`. Пишет напрямую через `connection.execute(insert(AuditEntry.__table__)...)`.
- **Где менять для типовых задач:**
  - Добавить новое аудит-событие на User (например, деактивация) → добавь ветку в `_user_before_update`/`_user_after_update` по аналогии с password.
  - Расширить payload `user.created` → правь словарь `payload` в `_user_after_insert`.
  - Изменить логику определения actor → `_resolve_actor`.
- **Подводные камни:**
  - **Листенеры синхронные** (ORM events не бывают async) — поэтому пишут через `connection` напрямую, без async-сессии. Не пытайся добавить `await` внутри.
  - Все ветки обёрнуты в `try/except` с `log.warning` — аудит **никогда не должен ронять** INSERT/UPDATE пользователя.
  - `tenant_id` берётся из самого `target.tenant_id` (изоляция сохраняется в записи аудита).
  - Первичная установка пароля password-less юзеру тоже считается `password_changed` (by design, для compliance).
- **Строк:** 145

---

## `backend/app/services/vitals_service.py`

- **Назначение:** Сервис витальных показателей пациента: ручной ввод одного измерения, идемпотентный массовый импорт (Apple Health / Google Fit / device), выборка последних значений по метрикам (для KPI-карточек) и временного ряда по метрике.
- **Ключевые элементы:**
  - Whitelist `ALLOWED_METRICS` (11 метрик: heart_rate, blood_pressure_sys/dia, spo2, glucose, weight_kg, height_cm, temperature, steps, sleep_minutes, hrv) и `ALLOWED_SOURCES` (manual/apple_health/google_fit/device).
  - Хелперы `_coerce_value` (→`Decimal` безопасно), `_parse_dt` (datetime/ISO, обрезает tzinfo).
  - `add_vital(...)` — async, одно измерение, валидация метрики.
  - `bulk_import(...)` — async, идемпотентная вставка с дедупом по `(tenant_id, patient_phone, metric, measured_at)`; возвращает `{"inserted","skipped","errors"}`.
  - `get_latest_per_metric(...)` — `DISTINCT ON (metric)` (Postgres), отдаёт `{metric: PatientVital}`.
  - `get_series(...)` — ряд по метрике за N дней (clamp 1..365, limit 2000).
- **Эндпоинты:** нет (вызывается из роутеров vitals / Apple Health bridge).
- **Зависимости:** `app.models.patient_vital.PatientVital`; `app.utils.phone.normalize_phone`; `sqlalchemy.AsyncSession`.
- **Где менять для типовых задач:**
  - Добавить новую метрику → добавь её в `ALLOWED_METRICS` (фронт строго привязан к этим строкам — синхронизируй с фронтом).
  - Новый источник синка → добавь в `ALLOWED_SOURCES`.
  - Сменить ключ дедупликации → правь `cond` и `existing_keys` в `bulk_import`.
- **Подводные камни:**
  - Значения хранятся в `Decimal` (`_coerce_value`) — не смешивать с float при дальнейших расчётах.
  - Дедуп в `bulk_import` идёт и по уже существующим в БД, и внутри батча (`existing_keys.add` после вставки) — двойных вставок одного сэмпла не будет.
  - `tenant_id` опционален (`None` допустим): при `None` фильтр по тенанту не добавляется — следи, чтобы пациентские данные не утекали между тенантами при вызове без tenant_id.
  - `measured_at` приводится к naive datetime (tz обрезается) — БД хранит без таймзоны.
  - `get_series` молча возвращает `[]` для неизвестной метрики.
- **Строк:** 256

---

## `backend/app/services/webhook_queue.py`

- **Назначение:** Надёжная очередь доставки вебхуков через Redis `LPUSH`/`RPOP`. При ошибке доставки — повтор до 3 раз с экспоненциальной задержкой; после исчерпания попыток — в dead-очередь. Воркер запускается APScheduler каждую минуту.
- **Ключевые элементы:**
  - Константы `QUEUE_KEY="clinika:webhook_queue"`, `DEAD_QUEUE_KEY="clinika:webhook_dead"`, `MAX_RETRIES=3`.
  - `enqueue_webhook(redis, url, payload, attempt=0)` — кладёт JSON-элемент в очередь.
  - `process_webhook_queue(redis)` — воркер: до 20 элементов за запуск, POST через `httpx`, при ошибке backoff `min(2**attempt, 30)` сек и re-LPUSH, иначе → dead-queue. Обёртка-job: `main.py:412 process_webhook_queue_job` → `main.py:1151` (`interval=1min`).
- **Эндпоинты:** нет (фоновый воркер + хелпер постановки).
- **Зависимости:** `redis.asyncio.Redis`; `app.config.settings`; `httpx` (lazy-import внутри функции).
- **Где менять для типовых задач:**
  - Изменить число попыток → `MAX_RETRIES`.
  - Изменить пропускную способность за тик → `range(20)` в `process_webhook_queue`.
  - Сменить формулу backoff → строка `await asyncio.sleep(min(2 ** attempt, 30))`.
- **Подводные камни:**
  - **Дубль по смыслу** с `webhook_service.py`: тот шлёт события тенанта синхронно с БД-логом, а этот — очередь общего назначения. Проверь, какой путь реально подключён к событию, прежде чем дорабатывать (есть риск, что один из двух — легаси).
  - Backoff `asyncio.sleep` выполняется **внутри** обработки тика — блокирует обработку остальных элементов очереди до 30 сек на один сбойный вебхук. На больших объёмах лучше переносить задержку в отложенный re-enqueue.
  - Нет валидации/таймаута дедлайна на dead-очередь — мёртвые элементы копятся без очистки.
- **Строк:** 60

---

## `backend/app/services/webhook_service.py`

- **Назначение:** Отправка событий тенанта на зарегистрированные вебхук-endpoints. Вызывается из роутеров при событиях (`referral_created`, `bonus_paid`, …). Подписывает тело HMAC-SHA256, делает до 3 попыток, логирует каждую доставку в `webhook_deliveries`, обновляет статистику endpoint.
- **Ключевые элементы:**
  - `WEBHOOK_EVENTS` — список допустимых событий (referral_created/confirmed/cancelled, bonus_paid, patient_registered, clinic_created, user_created, invoice_paid, subscription_trial_ending).
  - `_sign_payload(secret, payload)` — HMAC-SHA256 hexdigest.
  - `send_event(db, tenant_id, event, payload)` — async; выбирает активные endpoints тенанта, фильтрует по подписке на событие, шлёт с заголовками `X-Clinika-Event/Delivery/Signature`, retry до 3, пишет `WebhookDelivery`, обновляет `last_triggered_at/last_status_code/fail_count`. Ошибки коммита проглатываются.
- **Эндпоинты:** нет (вызывается из роутеров).
- **Зависимости:** `app.models.webhook.WebhookEndpoint/WebhookDelivery`; `httpx`; `sqlalchemy.AsyncSession`.
- **Где менять для типовых задач:**
  - Добавить новое событие → добавь строку в `WEBHOOK_EVENTS` и вызови `await send_event(db, tenant_id, "<event>", payload)` из нужного роутера.
  - Изменить формат тела/заголовков → правь блок `body = json.dumps(...)` и `headers` в `send_event`.
  - Изменить число попыток → `for attempt in range(1, 4)`.
- **Подводные камни:**
  - Корректно фильтрует endpoints по `tenant_id` и `is_active`; endpoint без `events` (пустой список) получает **все** события.
  - Retry **без задержки** между попытками (в отличие от `webhook_queue`, где есть backoff) — три быстрых подряд POST.
  - `except Exception: pass` на финальном `db.commit()` — лог доставки может молча не записаться; основной флоу не ломается.
  - Соседство с `webhook_queue.py`: убедись, что событие не дублируется в оба механизма.
- **Строк:** 123

---

## `backend/app/services/wellness_service.py`

- **Назначение:** Wellness-партнёры по подписочному тарифу пациента: список доступных партнёров, запись клика, агрегированная аналитика кликов.
- **Ключевые элементы:**
  - `PLAN_RANK = {"health_plus":1, "family_plus":2, "pro":3}` и `plan_allows(user_plan, partner_min_plan)` — сравнение ранга тарифа.
  - `list_partners_for_plan(db, plan)` — активные партнёры (сорт. по `sort_order, name`), фильтр по доступности тарифа (без plan → `[]`).
  - `record_click(db, partner_id, patient_id)` — создаёт `WellnessPartnerClick`.
  - `get_partner_analytics(db, partner_id=None)` — клики total / last_30d / last_7d через `func.sum(case(...))`, группировка по партнёру.
- **Эндпоинты:** нет (вызывается из wellness-роутеров).
- **Зависимости:** `app.models.wellness.WellnessPartner/WellnessPartnerClick`; `sqlalchemy.AsyncSession` (`select, func, case`).
- **Где менять для типовых задач:**
  - Добавить новый тариф → расширь `PLAN_RANK` (важен порядковый ранг).
  - Изменить правило доступа партнёра → `plan_allows`.
  - Добавить метрику в аналитику (например, конверсию) → расширь `get_partner_analytics` (в комментарии конверсия помечена как заглушка).
- **Подводные камни:**
  - В `plan_allows` default для неизвестного `partner_min_plan` = `99` (фактически «недоступно никому») — это безопасный дефолт, но проверь, что у партнёров корректный `min_subscription_plan`.
  - Аналитика и партнёры **не фильтруются по tenant_id** — wellness-партнёры, видимо, глобальные для сети; учитывай это, если потребуется изоляция по тенанту.
  - Конверсия в аналитике — заглушка (не считается).
- **Строк:** 74

---

## `backend/app/services/whisper_service.py`

- **Назначение:** Транскрипция записей звонков через OpenAI Whisper. Достаёт API-ключ из env, опционально ходит через HTTPS-прокси (обход РФ-блокировок), сохраняет полный текст, сегменты с таймкодами и стоимость в USD. При отсутствии ключа/файла/ошибке — переводит запись в `FAILED` с `error_message` (не падает).
- **Ключевые элементы:**
  - Константы: `OPENAI_API_BASE`, `WHISPER_MODEL="whisper-1"`, `WHISPER_PRICE_PER_MINUTE=Decimal("0.006")`, `HTTP_TIMEOUT=180`.
  - `_get_api_key()` — env `OPENAI_API_KEY`/`WHISPER_API_KEY`.
  - `_get_proxies()` — env `HTTPS_PROXY`/`https_proxy`/`OPENAI_HTTPS_PROXY` → dict для httpx.
  - `transcribe_recording(db, recording_id)` — async, главный метод: проверки записи/ключа/файла, POST `audio/transcriptions` (`response_format=verbose_json`, `language=ru`), сохранение/обновление `CallTranscript` (идемпотентно), расчёт `cost_usd`. Возвращает `bool`.
- **Эндпоинты:** нет (вызывается воркером транскрипции / роутером записей звонков).
- **Зависимости:** `app.models.call_recording.CallRecording/CallRecordingStatus/CallTranscript`; `httpx`; `sqlalchemy.AsyncSession`.
- **Где менять для типовых задач:**
  - Сменить модель/язык → `WHISPER_MODEL` и `data["language"]`.
  - Сменить ценообразование → `WHISPER_PRICE_PER_MINUTE`.
  - Добавить новый источник прокси/ключа → `_get_proxies` / `_get_api_key`.
  - Поменять формат ответа (сегменты) → `data["response_format"]` и разбор `payload`.
- **Подводные камни:**
  - **`proxies=` в `httpx.AsyncClient` — устаревший/удалённый параметр** в новых версиях httpx (теперь `proxy=` или `mounts=`). Сравни: соседние `tg_*`-сервисы уже используют `proxy=`. На свежем httpx вызов с непустым прокси упадёт — при отсутствии прокси (`None`) проблема не проявляется, поэтому может «работать» локально и падать в проде с прокси.
  - Стоимость считается строго в `Decimal` и квантуется до `0.0001` — не смешивать с float.
  - Идемпотентность: повторный вызов обновляет существующий `CallTranscript`, а не плодит дубликаты.
  - Каждая ветка ошибки делает `await db.commit()` для фиксации статуса `FAILED` — это намеренно (фронт должен видеть причину).
  - Ключ OpenAI по факту не задан (placeholder в проде) — без env-ключа все записи уходят в `FAILED`.
- **Строк:** 169
