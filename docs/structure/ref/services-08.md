# services [08] — подписки пациентов, телемедицина, телефония, здоровье и онбординг тенантов

Этот срез из 15 файлов `backend/app/services/` объединяет несколько слабо связанных платформенных подсистем SaaS-уровня (не клинический core), а именно:

- **Подписки пациента «Здоровье+»** (`subscription_*`) — каталог тарифов (глобальные шаблоны + override на тенант), жизненный цикл подписки пациента, расчёт скидок на приёмы и ежемесячная автогенерация «расходника» (PDF) по cron.
- **CRM-движок подсказок** (`suggestion_engine.py`) — сканер триггеров (welcome / birthday / churn / anniversary / nps), создающий pending-suggestions для менеджера (без автоотправки push).
- **Телемедицина** (`telemed_*`) — WebRTC-сигналинг через Redis Pub/Sub и JWT join-токены для пациентов.
- **Телефония** (`telephony/`) — pluggable-провайдеры исходящих звонков и обработки webhook'ов (Sipuni / Mango / Zadarma / Null) за единым ABC-интерфейсом + фабрика по `TelephonyConfig` тенанта.
- **Здоровье тенанта** (`tenant_health*`) — два независимых калькулятора composite health-score (см. подводный камень про дубль) и сервис снимков.
- **Онбординг тенанта** (`tenant_onboarding_service.py`) — атомарное создание нового тенанта со всеми связанными объектами.

Все файлы — чистый сервисный слой (async SQLAlchemy `AsyncSession`, бизнес-логика); **роутеров среди них нет** — endpoints, упомянутые в докстрингах (например `POST /tenant/create`, `POST /patient/subscription/supply/generate-now`), живут в `app/routers/*` и лишь вызывают эти функции.

## Оглавление

| Файл | Назначение в 5-7 слов | Строк |
|---|---|---|
| `subscription_plan_service.py` | Каталог тарифов: глобальные шаблоны + tenant-override | 317 |
| `subscription_service.py` | Жизненный цикл подписки пациента + расчёт скидки | 444 |
| `subscription_supply_cron.py` | Ежемесячная автогенерация PDF-расходника по подписке | 157 |
| `suggestion_engine.py` | CRM-сканер триггеров → pending suggestions | 302 |
| `telemed_signaling.py` | WebRTC-сигналинг телемедицины через Redis Pub/Sub | 179 |
| `telemed_token.py` | JWT join-токены пациента для видеоприёма | 90 |
| `telephony/base.py` | ABC-интерфейс провайдера телефонии + dataclasses | 32 |
| `telephony/factory.py` | Выбор провайдера по TenantConfig (иначе Null) | 44 |
| `telephony/mango.py` | Провайдер Mango Office VPBX (callback) | 143 |
| `telephony/null.py` | Заглушка-провайдер «телефония не настроена» | 17 |
| `telephony/sipuni.py` | Провайдер Sipuni (callback API) | 122 |
| `telephony/zadarma.py` | Провайдер Zadarma (callback API, 2-шаг запись) | 161 |
| `tenant_health.py` | Health-score тенанта (формула A, ORM) | 223 |
| `tenant_health_service.py` | Health-score тенанта (формула B, raw SQL) + снимки | 315 |
| `tenant_onboarding_service.py` | Создание тенанта+лицензия+бренд+admin одной транзакцией | 163 |

---

## `backend/app/services/subscription_plan_service.py`
- **Назначение:** Каталог тарифов подписки в БД (таблица `subscription_plans`). Глобальные шаблоны (`tenant_id IS NULL`, управляет super_admin) и override на конкретный тенант (`tenant_id=<id>`, управляет franchise_owner), которые накладываются поверх шаблона при чтении.
- **Ключевые элементы:**
  - Константа `DEFAULT_FEATURES` — эталонная структура `features` (флаги `unlimited_chat`, `discount_percent`, `family_members_allowed`, `telemedicine_unlimited`, `priority_booking`, `monthly_supply`), используется при merge и нормализации.
  - `serialize_plan(p)` — ORM→dict (`price_*` приводятся к `float`, `features` мёржится с DEFAULT_FEATURES).
  - `_merge_effective(global_row, override_row)` — главная логика наложения override поверх глобального шаблона; в результат добавляет `id` (override-записи, для PATCH/DELETE), `global_id`, `has_override`.
  - Чтение: `list_global_plans`, `list_overrides(tenant_id=)`, `get_global_by_key`, `get_override_by_key`, `get_effective_plans(tenant_id)`, `get_plan_by_key(tenant_id, plan_key)`.
  - `_coerce_payload(payload)` — валидация/нормализация входа с клампами (`trial_days` 0..90, `discount_percent` 0..50, `family_members_allowed` 0..10, `benefits` обрезка по 200 символов).
  - Запись: `upsert_global`, `upsert_override(tenant_id, payload)`, `update_plan(plan_id, payload)`, `delete_plan(plan_id)`.
- **Эндпоинты:** нет (сервис; вызывается из роутеров каталога планов / админки тарифов).
- **Зависимости:** `app.models.subscription_plan.SubscriptionPlan`. Является провайдером данных для `subscription_service` (тот импортирует его лениво внутри функций как `sps`).
- **Где менять для типовых задач:**
  - Добавить новый feature-флаг тарифа → внести ключ в `DEFAULT_FEATURES` И добавить ветку обработки/клампа в `_coerce_payload` (иначе значение отбросится при сохранении).
  - Изменить правило наложения override (например, чтобы пустой `benefits` не очищал глобальный) → `_merge_effective`, цикл по полям.
  - Изменить допустимые границы цен/триала/скидок → `_coerce_payload`.
- **Подводные камни:**
  - `serialize_plan` отдаёт `price_*` как **float**, тогда как `_coerce_payload` хранит как **Decimal** — при чтении точность теряется (для отображения ок, но не используй float-цену в денежных расчётах напрямую).
  - В `_merge_effective` поля override «полностью замещают» по комментарию «UI всегда заполняет все поля» — если фронт пришлёт частичный payload override, `features` затрётся неполным набором.
  - `update_plan` правит запись по `id` без фильтра `tenant_id` — права на редактирование чужого override должен проверять роутер.
- **Строк:** 317

## `backend/app/services/subscription_service.py`
- **Назначение:** Бизнес-логика подписки пациента «Здоровье+» (Глава 9): старт/отмена/возобновление, проверка активности, расчёт скидки на приём. Каталог планов берётся из БД через `subscription_plan_service`; жёстко прописанный словарь `PLANS` оставлен как fallback для пустой БД.
- **Ключевые элементы:**
  - `PLANS` (fallback-словарь: `health_plus`/`family_plus`/`pro`), `plan_meta`, `all_plans` (fallback), `all_plans_db(tenant_id)` и `plan_meta_db(plan, tenant_id)` — версии, читающие БД с override.
  - `serialize_subscription(s)`.
  - Чтение: `get_active_subscription(patient_id)` (active/trial и не expired), `has_active_plan(patient_id, plans=)`, `get_subscription_for_patient_any_status(patient_id, plan)`, `get_active_subscription_by_phone(phone)`.
  - Жизненный цикл: `start_subscription(...)` (idempotent — вернёт существующую активную; trial по умолчанию 7д, active=30д), `cancel_subscription(sub, reason)` (status=cancelled, `expires_at` НЕ меняется → доступ до конца периода), `resume_subscription(sub)` (только из cancelled и пока не истёк).
  - Привилегии: `benefits_for(plan)` (fallback), `benefits_for_db(plan, tenant_id)` (из effective-плана).
  - `compute_discount_for(...)` — расчёт скидки для цены приёма; поддерживает дифференцированные скидки через `subscription_plan_discount_service` (scope service/category/all), иначе fallback на `discount_percent` плана. Возвращает dict с `discount_source` ∈ {service, category, plan_all, fallback, none}.
  - История пишется в `PatientSubscriptionHistory` (события created/cancelled/resumed).
- **Эндпоинты:** нет (вызывается из роутеров кабинета пациента и из `appointments` при расчёте цены).
- **Зависимости:** `app.models.subscription` (`PatientSubscription`, `PatientSubscriptionHistory`), лениво — `subscription_plan_service` (`sps`), `app.models.patient_account.PatientAccount` (поиск по телефону), `subscription_plan_discount_service` (дифф-скидки, в try/except). Потребляется `subscription_supply_cron` (через `benefits_for_db`).
- **Где менять для типовых задач:**
  - Добавить новый план в fallback (когда БД пустая) → словарь `PLANS` + `benefits_for`.
  - Поменять длительность trial/периода → `start_subscription` (`timedelta(days=...)`).
  - Изменить логику дифф-скидок или клампа процента → `compute_discount_for` (клампится 0..50).
- **Подводные камни:**
  - Денежные расчёты в `compute_discount_for` ведутся в **Decimal** с `quantize(0.01)`, но на выходе всё конвертируется в **float** (контракт API) — не используй выход для повторных денежных операций без обратного приведения к Decimal.
  - `serialize_subscription` берёт `plan_title` из жёсткого `PLANS`, а НЕ из БД — кастомный/переименованный план тенанта покажет ключ вместо названия.
  - Все сравнения дат на `datetime.utcnow()` (naive UTC) — следи за консистентностью TZ при сравнении с `expires_at`.
  - `get_active_subscription` и поиск по телефону **не фильтруют по tenant_id** (подписка привязана к `patient_id`/`PatientAccount`, глобальному на платформе) — учитывай при мультитенантной логике скидок.
- **Строк:** 444

## `backend/app/services/subscription_supply_cron.py`
- **Назначение:** Ежемесячная автогенерация «расходника» (PDF-сводки трат) пациентам с активной подпиской, у которой `features.monthly_supply=True`. Запускается из APScheduler 1-го числа в 03:00 UTC или вручную через роутер.
- **Ключевые элементы:**
  - Константа `STORAGE_DIR` (env `SUPPLY_STORAGE_DIR`, дефолт `/app/storage/supplies`).
  - `_prev_month_range(today=)` → `(start, end, year, month)` предыдущего месяца; `_ensure_storage_dir()`.
  - `generate_for_subscription(db, sub, year=, month=)` — для одной подписки: проверяет наличие пациента и `monthly_supply`, считает spending summary, рендерит PDF, пишет файл `<sub_id>_<YYYY-MM>.pdf`, best-effort push-уведомление пациенту. Возвращает dict-результат с `ok`/`error`.
  - `run_monthly_for_all(db, year=, month=)` — проходит все active/trial подписки, фильтрует по `monthly_supply`, агрегирует результаты (`processed`/`ok`/`failed`/`items`).
- **Эндпоинты:** нет; ручной триггер реализован в роутере как `POST /patient/subscription/supply/generate-now` (см. докстринг), сам файл его не объявляет.
- **Зависимости:** `app.models.patient_account.PatientAccount`, `app.models.subscription.PatientSubscription`, `subscription_service as ss` (`benefits_for_db`), `spending_service as sp` (`compute_spending_summary`, `render_spending_pdf`), лениво — `push_service` (`send_to_patient`, в try/except).
- **Где менять для типовых задач:**
  - Сменить расписание/время cron → в коде планировщика (APScheduler config), не здесь.
  - Сменить путь/формат имени файла → `STORAGE_DIR` (env) и `fname` в `generate_for_subscription`.
  - Изменить текст уведомления о готовности → блок `ps.send_to_patient`.
- **Подводные камни:**
  - `STORAGE_DIR` дефолтит на POSIX-путь `/app/storage/...` — на dev-Windows без env переменной запись упадёт (ловится в try/except и вернёт error, но PDF не сохранится).
  - `compute_spending_summary` считается за **весь год**, а `report_month` лишь помечает месяц в заголовке — фактически в PDF годовые данные, не помесячные (несоответствие названию «ежемесячный расходник»).
  - Push best-effort: любые сбои `push_service` молча проглатываются.
- **Строк:** 157

## `backend/app/services/suggestion_engine.py`
- **Назначение:** Генератор CRM-подсказок (suggestions) для hub-а engagement. Сканирует пациентов по триггер-условиям и создаёт `pending`-suggestions для менеджера. ВАЖНО: НЕ отправляет push автоматически.
- **Ключевые элементы:**
  - `DEFAULT_CONFIG` — пороги (welcome `[1,3,7]` дней, birthday за 3 дня, nps через 24ч, churn `[30,60,90]`, safety-cap `max_suggestions_per_run_per_kind=200`).
  - Хелперы: `_suggestion_exists_today` (идемпотентность — не дублирует suggestion для пары пациент+kind в один день), `_default_template_id_for(category)`, `_create_suggestion(...)`.
  - Генераторы (каждый возвращает количество созданных): `generate_welcome_suggestions`, `generate_birthday_suggestions`, `generate_churn_suggestions`, `generate_anniversary_suggestions`, `generate_nps_suggestions`.
  - `run_engine(db, tenant_id, cfg=)` — главный entry, прогоняет все генераторы, ловит ошибки по каждому, делает `db.commit()`, возвращает stats per kind.
- **Эндпоинты:** нет (вызывается из cron/роутера engagement).
- **Зависимости:** `app.models.patient_account.PatientAccount`, `app.models.engagement` (`EngagementSuggestion`, `PushTemplate`, `SuggestionKind`, `TemplateCategory`).
- **Где менять для типовых задач:**
  - Добавить новый тип подсказки → новый генератор + строка в списке внутри `run_engine` + enum `SuggestionKind`/`TemplateCategory` (в моделях engagement).
  - Поменять пороги/окна → `DEFAULT_CONFIG` (или передавать `cfg` из роутера).
  - Изменить условие «лояльности» для churn → фильтр `login_count >= 3` в `generate_churn_suggestions`.
- **Подводные камни:**
  - Часть генераторов использует **сырой SQL `text()`** с именами таблиц `patient_accounts`, `appointments`, `nps_responses` напрямую — при переименовании таблиц/колонок ORM эти запросы молча сломаются (ошибка попадёт только в `stats[name]["error"]`, без падения).
  - **Tenant-фильтрация неполная:** welcome и churn выбирают `PatientAccount` БЕЗ `tenant_id` (аккаунт глобальный), а `_create_suggestion` пишет suggestion с переданным `tenant_id` — то есть один и тот же пациент попадёт в подсказки каждого тенанта. anniversary/nps корректно джойнят `appointments` по `tenant_id`.
  - `birthday`-SQL не учитывает переход через конец месяца (диапазон дней внутри одного месяца) — ДР 31-го числа в начале следующего месяца не поймает.
  - `run_engine` сам делает commit — не оборачивай его в собственную транзакцию.
- **Строк:** 302

## `backend/app/services/telemed_signaling.py`
- **Назначение:** WebRTC-сигналинг для видеоприёмов: каждая сессия — Redis-канал `telemed:{session_id}`; сообщения доставляются всем WS-клиентам сессии на любом инстансе backend, кроме отправителя. Redis нужен, т.к. доктор и пациент могут попасть на разные процессы uvicorn / поды.
- **Ключевые элементы:**
  - `_channel(session_id)` → имя Redis-канала.
  - Класс `TelemedSignalingManager`: `connections[session_id][role]=WebSocket` (role = `doctor`|`patient`, по одному на роль — новый коннект вытесняет старый с кодом 4002), `_pubsub_tasks` (по одному listener-таску на сессию на процесс).
  - `connect(ws, session_id, role)`, `disconnect(session_id, role)`, `publish(session_id, message, _from_role=)` (добавляет `_from` чтобы не вернуть отправителю), `_listen(session_id)` (подписка на Redis и раздача локальным WS, чистка мёртвых соединений).
  - Глобальный синглтон `telemed_signaling` на процесс.
  - Поддерживаемые типы сообщений: `offer`/`answer`/`ice`, `chat_message`, `end`, служебные `presence_join`/`presence_leave`.
- **Эндпоинты:** нет напрямую; используется WS-роутером телемедицины (аналог `app/routers/presence.py`).
- **Зависимости:** `fastapi.WebSocket`; лениво — `redis.asyncio`, `app.config.settings` (`redis_url`). Redis-клиент опционален (импорт внутри функций — для тестов).
- **Где менять для типовых задач:**
  - Добавить новый тип сигнального сообщения → обрабатывается прозрачно (любой dict ретранслируется); валидацию типов добавляй в WS-роутере.
  - Разрешить >2 участников / групповой звонок → структура `connections[sid][role]` (ключ по роли, не по user) ограничивает двумя — менять модель ключей здесь.
- **Подводные камни:**
  - На каждый `publish` создаётся новый Redis-клиент `from_url` и закрывается (`aclose`) — на высокой частоте ICE-кандидатов это накладно; кандидат на пул соединений.
  - `connections` — in-memory per-process: presence-учёт корректен только локально, кросс-инстанс presence идёт через сами Redis-сообщения.
  - `_listen` завершается, когда локальный bucket опустел (`break`) — это норма, listener пересоздаётся при новом `connect`.
- **Строк:** 179

## `backend/app/services/telemed_token.py`
- **Назначение:** Генерация и проверка JWT join-токенов для входа пациента в видеоприём. Единый `settings.secret_key` (как весь auth-стек), HS256. В БД хранится только SHA-256-хеш токена (`TelemedicineSession.join_token_hash`) — сам JWT отдаётся пациенту один раз через SMS/ссылку.
- **Ключевые элементы:**
  - Константа `DEFAULT_TTL_HOURS = 2`.
  - `create_join_token(session_id, patient_phone, expires_at=)` → `(raw_token, expires_at_utc)`; payload `{sid, phone, exp, iat, type:"telemed_join"}`.
  - `verify_join_token(token)` → payload или `HTTPException 401` (на JWTError, неверный `type`, отсутствие `sid`).
  - `hash_token(token)` — SHA-256 hex (для хранения в БД).
  - `verify_token_against_hash(token, stored_hash)` — сравнение через `hmac.compare_digest` (constant-time).
- **Эндпоинты:** нет (вызывается роутером телемедицины при выдаче ссылки и при входе пациента).
- **Зависимости:** `jose.jwt`, `app.config.settings` (`secret_key`, `jwt_algorithm`), `hashlib`, `hmac`.
- **Где менять для типовых задач:**
  - Изменить срок жизни ссылки → `DEFAULT_TTL_HOURS`.
  - Добавить поле в payload (например `tenant_id`) → `create_join_token` payload + при необходимости проверка в `verify_join_token`.
- **Подводные камни:**
  - `exp`/`iat` задаются как `datetime` объекты — `jose` сам сериализует в unix-ts; время naive UTC через `utcnow()`.
  - `verify_join_token` НЕ сверяет токен с хешем в БД — это отдельный шаг (`verify_token_against_hash`), который роутер должен вызвать, иначе отозванная/несуществующая сессия пройдёт по одной валидности подписи.
- **Строк:** 90

## `backend/app/services/telephony/base.py`
- **Назначение:** Абстрактный интерфейс провайдера телефонии и общие dataclass-результаты. Реальные провайдеры реализуют этот ABC в отдельных модулях.
- **Ключевые элементы:**
  - `@dataclass CallInitiateResult(success, provider_call_id=None, error=None)`.
  - `@dataclass CallStatusResult(status, duration_sec=None, recording_url=None)` — `status` ∈ `ringing|answered|completed|failed|unknown` (провайдеры расширяют `missed`/`rejected`).
  - ABC `TelephonyProvider` с абстрактными async-методами: `initiate_call(*, from_user_phone, to_number)`, `get_call_status(provider_call_id)`, `fetch_recording(provider_call_id)`, `handle_incoming_webhook(payload)`.
- **Эндпоинты:** нет (контракт).
- **Зависимости:** только stdlib (`abc`, `dataclasses`). База для `null.py`, `sipuni.py`, `mango.py`, `zadarma.py`, импортируется фабрикой.
- **Где менять для типовых задач:**
  - Добавить общий метод во все провайдеры (например `hangup`) → добавь абстрактный метод здесь И реализуй во всех 4 провайдерах (иначе ABC не инстанцируется).
  - Расширить набор полей статуса → dataclass `CallStatusResult`.
- **Подводные камни:** при добавлении abstractmethod без реализации в конкретном провайдере его инстанцирование упадёт `TypeError` ещё в фабрике.
- **Строк:** 32

## `backend/app/services/telephony/factory.py`
- **Назначение:** Фабрика провайдера телефонии для тенанта: читает `TelephonyConfig`, расшифровывает креды и возвращает нужный провайдер; при отсутствии/неактивности/неизвестном провайдере — `NullProvider`.
- **Ключевые элементы:**
  - `get_provider(db, tenant_id) -> TelephonyProvider` — диспетчер по `cfg.provider` (`sipuni`/`mango`/`zadarma`), с дешифровкой `api_key_encrypted`/`api_secret_encrypted` через `encryption_service`; пустые/невалидные креды → `NullProvider`.
- **Эндпоинты:** нет (вызывается роутером звонков на каждый исходящий вызов/webhook).
- **Зависимости:** `app.models.telephony.TelephonyConfig`, `encryption_service as enc` (`decrypt`), `.base.TelephonyProvider`, `.null.NullProvider`, `.sipuni.SipuniProvider`, `.mango.MangoProvider`, `.zadarma.ZadarmaProvider`.
- **Где менять для типовых задач:**
  - Подключить нового провайдера (например onlinepbx) → создать модуль `telephony/<name>.py` (реализовать ABC), импортировать здесь и добавить `if cfg.provider == "<name>"` ветку с дешифровкой кредов.
- **Подводные камни:**
  - Креды у всех провайдеров мапятся на пару полей `api_key_encrypted`/`api_secret_encrypted` (id+secret, key+salt, user_key+secret) — семантика полей зависит от провайдера, не перепутай при сохранении в `TelephonyConfig`.
  - Любая пустая пара кредов тихо деградирует в `NullProvider` (звонок просто не пойдёт) — диагностируй через активность config.
- **Строк:** 44

## `backend/app/services/telephony/mango.py`
- **Назначение:** Провайдер Mango Office VPBX через callback API: API сам инициирует звонок на 2 номера (оператор + клиент) и соединяет.
- **Ключевые элементы:**
  - Константы `CALLBACK_URL`, `RECORDING_URL`.
  - `MangoProvider(api_key, api_salt)`; `_signature(json_body)` = `sha256(api_key + json_body + api_salt)` (порядок строго по доке).
  - `initiate_call` (POST JSON c `command_id`, заголовки `X-MPBX-API-Key`/`X-MPBX-Signature`), `get_call_status` → всегда `unknown` (статусы только через webhook), `fetch_recording` (POST `action:play`, проверка `content-type` audio), `handle_incoming_webhook` (маппинг state `Appeared→ringing`, `Connected→answered`, `Disappeared→completed`, `NoAnswer→missed`, `Busy→rejected`, `Failed→failed`).
- **Эндпоинты:** нет (реализация интерфейса; вызывается через фабрику + webhook-роутер).
- **Зависимости:** `httpx`, `hashlib`, `.base` (`TelephonyProvider`, `CallInitiateResult`, `CallStatusResult`).
- **Где менять для типовых задач:**
  - Сменить URL/таймауты → константы и `httpx.AsyncClient(timeout=...)`.
  - Расширить маппинг состояний → `state_map` в `handle_incoming_webhook`.
- **Подводные камни:**
  - Подпись считается от точной JSON-строки (`separators=(",",":")`, `ensure_ascii=False`) — любое изменение сериализации тела ломает подпись; та же `json_body` шлётся как `content`.
  - `provider_call_id` мы генерируем сами (`command_id`); webhook может прийти только с `entry_id` — есть fallback, но матчинг звонка по id хрупкий.
- **Строк:** 143

## `backend/app/services/telephony/null.py`
- **Назначение:** Заглушка-провайдер, когда телефония не настроена. Возвращает «не настроено» на инициацию и пустые/unknown результаты на остальное.
- **Ключевые элементы:** `NullProvider` реализует все 4 метода ABC: `initiate_call` → `success=False, error="Провайдер телефонии не настроен"`, `get_call_status` → `unknown`, `fetch_recording` → `None`, `handle_incoming_webhook` → `{"ok": False, "reason": "no_provider"}`.
- **Эндпоинты:** нет.
- **Зависимости:** `.base`.
- **Где менять для типовых задач:** менять тексты ошибок «не настроено» — здесь; обычно файл стабилен.
- **Подводные камни:** это безопасный дефолт фабрики — если звонки «молча не идут», в первую очередь проверь, не вернулся ли `NullProvider` из `factory.get_provider`.
- **Строк:** 17

## `backend/app/services/telephony/sipuni.py`
- **Назначение:** Провайдер Sipuni через callback API (Вариант C): Sipuni сам звонит на оба номера и соединяет; голос в приложении не передаётся (оператору нужен реальный телефон).
- **Ключевые элементы:**
  - `API_BASE`, `CALLBACK_URL`, `RECORDING_URL`.
  - `SipuniProvider(sipuni_id, secret_key)`; `_signature(from, to, ts)` = `md5(from + user + time + to + secret)` (порядок по доке).
  - `initiate_call` (POST form-data, `provider_call_id` = plain-text ответ Sipuni), `get_call_status` → `unknown`, `fetch_recording` (POST, своя подпись `md5(call_id+user+time+secret)`, проверка audio content-type), `handle_incoming_webhook` (маппинг `CONNECTED→answered`, `NOANSWER→missed`, `BUSY→rejected`, `FAILED→failed`, `COMPLETED→completed`).
- **Эндпоинты:** нет.
- **Зависимости:** `httpx`, `hashlib`, `time`, `.base`.
- **Где менять для типовых задач:** маппинг статусов → `status_map`; формат/порядок подписи → `_signature` (две разные подписи: для callback и для recording).
- **Подводные камни:**
  - `initiate_call` определяет ошибку по тексту ответа (`startswith("error"/"incorrect")`) — хрупкая эвристика, при смене формата ответа Sipuni может ложно считать звонок успешным.
  - Подпись на MD5 — историческое требование API Sipuni, не «слабая криптография проекта», менять нельзя.
- **Строк:** 122

## `backend/app/services/telephony/zadarma.py`
- **Назначение:** Провайдер Zadarma через callback API (`GET /v1/request/callback/`). Запись скачивается в 2 шага (получить signed-link, затем скачать байты).
- **Ключевые элементы:**
  - `API_BASE`, `CALLBACK_PATH`, `RECORDING_PATH`.
  - `ZadarmaProvider(user_key, secret)`; `_signature(method_path, params, body="")` = `base64(hmac_sha1(method_path + sorted_urlencoded_params + md5(body), secret))` — заголовок `Authorization: <user_key>:<signature>`.
  - `initiate_call` (GET, парсит JSON, `status=="success"`, `provider_call_id` = `request_id`/`id`), `get_call_status` → `unknown`, `fetch_recording` (шаг 1 — JSON с `link`; шаг 2 — GET `link` без Authorization, проверка audio/octet-stream), `handle_incoming_webhook` (события `NOTIFY_START→ringing`, `NOTIFY_ANSWER→answered`, `NOTIFY_END` с `disposition` ANSWERED/NO ANSWER/BUSY/FAILED/CANCEL).
- **Эндпоинты:** нет.
- **Зависимости:** `httpx`, `base64`, `hashlib`, `hmac`, `urllib.parse`, `.base`.
- **Где менять для типовых задач:** маппинг событий/диспозиций → `status_map` и блок event в `handle_incoming_webhook`; формат подписи → `_signature`.
- **Подводные камни:**
  - Подпись чувствительна к сортировке параметров (`sorted(params.items())`) — тот же `urlencode(sorted(...))` обязателен и в URL, и в подписи, иначе 401 от Zadarma.
  - `fetch_recording` делает 2 сетевых запроса; второй (download) — без Authorization, по signed URL; `link` может прийти списком — есть обработка.
- **Строк:** 161

## `backend/app/services/tenant_health.py`
- **Назначение:** Композитный health-score тенанта (0..100) на ORM-запросах. Метрики: активность пользователей 30д (вес 30), объём записей 30д vs предыдущие (25), оплата счетов 30д (25), time-to-first-value (20). Статусы green/yellow/red по порогам 75/40.
- **Ключевые элементы:**
  - Веса-константы `WEIGHT_ACTIVITY=30`, `WEIGHT_APPOINTMENTS=25`, `WEIGHT_INVOICES=25`, `WEIGHT_TTFV=20`.
  - `_status_from_score(score)` (пороги ≥75 green, ≥40 yellow, иначе red).
  - `compute_health(tenant_id, db)` — единственная публичная функция; возвращает `{score, status, breakdown, last_active}`; не падает на отсутствии данных (даёт 0/нейтральные баллы). TTFV: ≤7 дней — grace (полный балл), ≥5 записей — activated, иначе — штраф пропорционально дням простоя (до 30д → 0).
- **Эндпоинты:** нет (вызывается роутером super_admin / дашбордом платформы).
- **Зависимости:** ORM-модели `app.models.tenant.Tenant`, `app.models.user.User`, `app.models.audit.AuditEntry`, `app.models.doctor.Appointment`, `app.models.billing.Invoice`.
- **Где менять для типовых задач:**
  - Перебалансировать веса/пороги → константы `WEIGHT_*` и `_status_from_score`.
  - Изменить TTFV-логику или grace-период → блок «4. Time-to-first-value».
- **Подводные камни:**
  - **ДУБЛЬ/два источника правды:** в этом срезе ДВА health-калькулятора — этот (`tenant_health.py`, ORM, веса 30/25/25/20, пороги 75/40, без записи в БД) и `tenant_health_service.py` (raw SQL, другая формула 25/25/15/15/15/5, пороги 70/40, пишет снимки). Перед правкой убедись, какой используется роутером, и синхронизируй оба либо удали неиспользуемый.
  - Все запросы корректно фильтруют по `tenant_id`.
  - Нет записи снимка в БД — это «онлайн»-калькулятор (в отличие от service-версии).
- **Строк:** 223

## `backend/app/services/tenant_health_service.py`
- **Назначение:** Альтернативный калькулятор health-score (0..100) на raw SQL с безопасными заглушками для опциональных таблиц + сервис создания снимков (`TenantHealthSnapshot`). Сигналы: activity_30d, payment_status, users_active_pct, feature_adoption_pct, support_tickets_30d, churn_risk (эвристика).
- **Ключевые элементы:**
  - `_classify(score)` (пороги 70/40 → green/yellow/red).
  - `_table_exists(db, table)` — безопасная проверка через `to_regclass` (для опциональных сигналов).
  - Сигналы (каждый возвращает `(value, is_real)`): `_activity_signal`, `_payment_signal` (ok/overdue/failed/unknown по billing_ledger), `_audit_users_active`, `_feature_adoption`, `_support_tickets`; `_payment_factor(status)` (ok 1.0 / overdue 0.4 / failed 0.0 / unknown 0.6).
  - `compute_score(db, tenant_id)` → `{score, alert_level, factors}` (с `factors["_source"]` = real/stub).
  - `snapshot_tenant(db, tenant_id)` (flush, без commit), `snapshot_all_tenants(db)` (по всем active-тенантам, один commit, отдельный тенант не валит job).
- **Эндпоинты:** нет (вызывается из daily-job снимков и роутера super_admin).
- **Зависимости:** raw SQL по таблицам `appointments`, `billing_ledger`, `audit_log`, `users`, `feature_flags`, `tenant_feature_flags`, `support_tickets`; ORM `app.models.tenant.Tenant`, `app.models.tenant_health` (`TenantHealthAlertLevel`, `TenantHealthSnapshot`).
- **Где менять для типовых задач:**
  - Добавить новый сигнал → новый `_*_signal` + включить в формулу `compute_score` + добавить в `factors`.
  - Изменить веса/формулу/пороги → `compute_score` (формула захардкожена в виде суммы) и `_classify`.
  - Подключить новую опциональную таблицу → паттерн `_table_exists` + `ProgrammingError`-guard.
- **Подводные камни:**
  - **ДУБЛЬ:** см. примечание в `tenant_health.py` — разные веса, пороги и даже признак «нет счетов» (здесь нейтрально, там 0.5 веса) дают РАЗНЫЙ score для одного тенанта. Это потенциальный источник расхождений в UI.
  - Все запросы — **сырой SQL `text()`** с буквальными именами таблиц/колонок; при миграции схемы guard'ы (`ProgrammingError`) тихо переводят сигнал в stub (score не упадёт, но станет неверным).
  - `snapshot_tenant` НЕ коммитит (это делает `snapshot_all_tenants` или вызывающий) — не забудь commit при одиночном вызове.
  - Tenant-фильтрация присутствует в каждом сигнале (`tenant_id = :tid`).
- **Строк:** 315

## `backend/app/services/tenant_onboarding_service.py`
- **Назначение:** Атомарное создание нового тенанта: tenant + trial-лицензия (14 дней) + брендинг + владелец франшизы (admin) + trial-подписка за одну транзакцию. Используется `POST /tenant/create`.
- **Ключевые элементы:**
  - `_generate_password(length=12)` — безопасный пароль (`secrets.choice`).
  - `onboard_tenant(db, *, name, slug, city=, plan="basic", admin_name, admin_username, admin_password=, primary_color, sidebar_color) -> dict` — проверяет уникальность `slug` и `username` (иначе `ValueError`), создаёт 5 объектов (Tenant → flush для id → TenantLicense → TenantBranding → User(FRANCHISE_OWNER) → Subscription TRIAL), `commit`, возвращает dict с доступами и URL. Лимиты плана: basic 3/20, professional 5/100, enterprise 50/500 клиник/юзеров.
  - Best-effort email франчайзи через `email_service.schedule_email`, если `admin_username` похож на email (содержит `@`).
- **Эндпоинты:** нет; вызывается роутером тенантов на `POST /tenant/create` (см. докстринг файла).
- **Зависимости:** `app.models.tenant` (`Tenant`, `TenantLicense`, `TenantBranding`), `app.models.user` (`User`, `UserRole`), `app.models.billing` (`Subscription`, `SubStatus`), `app.core.security.hash_password`, лениво — `app.services.email_service.schedule_email`.
- **Где менять для типовых задач:**
  - Изменить длительность trial → `trial_until = today + timedelta(days=14)`.
  - Изменить лимиты тарифов → словарь `plan_limits`.
  - Изменить дефолтные цвета/шрифт бренда → `TenantBranding(...)`.
  - Добавить создание дефолтных сущностей нового тенанта (клиника, категории) → внутри транзакции до `db.commit()`.
- **Подводные камни:**
  - Возвращает **сырой пароль** (`admin_password` в dict) — это намеренно (показать франчайзи один раз), но не логируй результат целиком.
  - URL хардкодит домен `https://клиниксеть.рф/{slug}` — при смене домена/мультидомене править здесь.
  - Email-уведомление шлётся только если username содержит `@`; любые сбои SMTP проглатываются и не валят онбординг.
  - `amount_per_period=Decimal("0")` для trial — денежные поля в Decimal (корректно), не float.
  - Один `db.commit()` в конце — функция владеет транзакцией; не вызывай внутри уже открытой внешней транзакции с ожиданием отката.
- **Строк:** 163
