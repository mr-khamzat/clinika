# services [07] — сиды каталога модулей/планов, чат сотрудников, slot-booking, подписки «Здоровье+»

Этот срез из `backend/app/services/` объединяет четыре функциональных кластера, которые роднит то, что все они — слой бизнес-логики (не роутеры), вызываемый либо из роутеров, либо из APScheduler-планировщика в `app/main.py`, либо как одноразовый CLI-скрипт `python -m app.services.<name>`:

1. **Сид-скрипты каталога** (`seed_payment_modules`, `seed_plans`, `seed_sms_marketing_module`, `seed_telemedicine_module`) — идемпотентно наполняют справочные таблицы `commercial_modules` и `tenant_plans`. Два из них помечены `DEPRECATED` в пользу `scripts/seed_all`.
2. **CRM-сегментация** (`segment_service`) — резолвинг JSONB-фильтра сегмента в список patient_id.
3. **Системные настройки** (`settings_service`) — key-value хранилище с tenant-скоупом через префикс ключа.
4. **Коммуникации**: `slot_booking_service` (бронь слотов из чата пациента с advisory-lock), `staff_chat_service` + `staff_chat_mentions` + `staff_chat_cleanup_job` (внутренний чат сотрудников: RBAC-видимость, сообщения, реакции, опросы, read-receipts, @-упоминания, очистка вложений).
5. **Подписки «Здоровье+»**: `subscription_module_service` (gate по модулю), `subscription_benefits_service` (привилегии тарифа), `subscription_cash_service` (наличная активация + PDF-квитанция), `subscription_plan_discount_service` (дифференцированные скидки).

Несколько файлов зависят от центрального (но НЕ входящего в этот срез) `app/services/subscription_service` (alias `ss`) — это source of truth по метаданным планов (`plan_meta_db`, `get_active_subscription`).

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `seed_payment_modules.py` | DEPRECATED сид модулей оплаты/54-ФЗ | 90 |
| `seed_plans.py` | DEPRECATED сид SaaS-тарифов tenant_plans | 131 |
| `seed_sms_marketing_module.py` | Upsert модуля SMS-маркетинга в каталог | 79 |
| `seed_telemedicine_module.py` | Upsert модуля телемедицины в каталог | 80 |
| `segment_service.py` | Резолв JSONB-фильтра сегмента → patient_ids | 136 |
| `settings_service.py` | Key-value настройки с tenant-префиксом | 49 |
| `slot_booking_service.py` | Бронь слотов из чата + advisory-lock | 271 |
| `spending_service.py` | Годовой расходник пациента + PDF | 275 |
| `staff_chat_cleanup_job.py` | Cron-очистка протухших вложений чата | 75 |
| `staff_chat_mentions.py` | Парсинг @username + TG-нотификация | 154 |
| `staff_chat_service.py` | Ядро чата сотрудников (RBAC, msgs, polls) | 868 |
| `subscription_benefits_service.py` | Привилегии тарифа для UI/чата | 247 |
| `subscription_cash_service.py` | Наличная активация подписки + PDF | 327 |
| `subscription_module_service.py` | Gate активности модуля health_plus | 47 |
| `subscription_plan_discount_service.py` | Дифференцированные скидки подписки | 251 |

---

## `backend/app/services/seed_payment_modules.py`
- **Назначение:** Одноразовый сид-скрипт: добавляет в каталог `commercial_modules` два маркетплейс-модуля — `online_payments_pro` (онлайн-оплата картой) и `fiscal_54fz_pro` (чеки 54-ФЗ). **ЛЕГАСИ:** в docstring помечен `DEPRECATED` — актуальная точка входа `python -m scripts.seed_all --payments`, файл оставлен для совместимости с docker-командами в ENV/скриптах.
- **Ключевые элементы:** константа `MODULES` (list[dict] с key/name/description/category/price_monthly/price_annual/sort_order), `async seed_payment_modules()`, `if __name__ == "__main__"` → `asyncio.run`.
- **Зависимости:** `app.models.commercial.CommercialModule`; сам поднимает `create_async_engine` из `DATABASE_URL` (НЕ переиспользует `app.database`).
- **Где менять для типовых задач:** чтобы добавить ещё один платёжный модуль — допиши dict в `MODULES` с уникальным `key` и новым `sort_order`. Менять цены — в `price_monthly`/`price_annual` (тип `Decimal`). НО предпочтительно вносить изменения в `scripts/seed_all`, т.к. этот файл deprecated.
- **Подводные камни:** идемпотентность реализована ручной проверкой `existing` (а не `ON CONFLICT`, вопреки фразе в docstring) — при существующем `key` запись НЕ обновляется, только пропускается. Цены — `Decimal`, не float. Свой engine из env, дефолт хардкодит креды `clinika:clinika_pass@clinika-db`. Дубль логики с `seed_sms_marketing_module`/`seed_telemedicine_module`, но те делают upsert, а этот — только insert.
- **Строк:** 90

## `backend/app/services/seed_plans.py`
- **Назначение:** Одноразовый сид SaaS-тарифов B2B (для франшиз/тенантов, не путать с пациентскими «Здоровье+») в таблицу `tenant_plans`: `basic`/`professional`/`enterprise` с ценами, лимитами клиник/пользователей и флагами фич. **ЛЕГАСИ:** `DEPRECATED` в пользу `python -m scripts.seed_all --plans`.
- **Ключевые элементы:** константа `PLANS` (source of truth тарифов), `async seed_plans(db)` → int (число добавленных, принимает готовую сессию), `async main()` (создаёт engine из env и оборачивает в транзакцию).
- **Зависимости:** `app.models.billing_plan.TenantPlan`. По комментариям синхронизирован с `PLAN_PRICES` из `billing.py` и `PLAN_DEFAULTS` из `core/limits.py` — при правках держать в согласии.
- **Где менять для типовых задач:** добавить тариф — новый dict в `PLANS` (`name` уникален, `max_clinics=-1` = безлимит, `features` — dict флагов). Изменить набор фич — ключи в `features`. Менять цены — `base_price_month`/`base_price_year` (`Decimal`).
- **Подводные камни:** `seed_plans(db)` использует `db.flush()` без commit — commit делает вызывающий (`main()` через `session.begin()`). Идемпотентность — ручная проверка по `name`, существующие планы НЕ обновляются. `-1` как магическое значение безлимита. Источник правды дублируется в трёх местах (`PLANS`, `billing.py`, `core/limits.py`) — риск рассинхрона.
- **Строк:** 131

## `backend/app/services/seed_sms_marketing_module.py`
- **Назначение:** Idempotent **upsert** модуля `sms_marketing` (рассылки спящим пациентам, реактивация по LTV-сегментам) в каталог `commercial_modules`. В отличие от deprecated-сидов, актуален и обновляет поля существующей записи.
- **Ключевые элементы:** константы `KEY="sms_marketing"`, `PAYLOAD` (включает `config_schema` с `trial_days`/`billing_cycle`/`max_recipients_per_campaign`/`default_provider`), `async seed_sms_marketing_module()` (создаёт ИЛИ обновляет через `setattr`).
- **Зависимости:** `app.models.commercial.CommercialModule`; собственный engine из `DATABASE_URL`.
- **Где менять для типовых задач:** поменять цену/лимиты/провайдера SMS — правь `PAYLOAD` (и вложенный `config_schema`). Перезапуск скрипта применит изменения к существующей строке (upsert).
- **Подводные камни:** цена annual захардкожена расчётом `1990*12*0.9=21492` в комментарии — при изменении monthly не забыть пересчитать annual вручную. `Decimal` для денег. `engine.dispose()` вызывается в двух местах (в ветке update и в конце) — корректно, но дублируется.
- **Строк:** 79

## `backend/app/services/seed_telemedicine_module.py`
- **Назначение:** Idempotent upsert модуля `telemedicine` (видеоприём WebRTC, чат с файлами, ЭЦП рецептов) в `commercial_modules`. Структурный близнец `seed_sms_marketing_module`.
- **Ключевые элементы:** `KEY="telemedicine"`, `PAYLOAD` (с `config_schema`: `recording_enabled`, `max_session_minutes`, `prescription_signing`), `async seed_telemedicine_module()`.
- **Зависимости:** `app.models.commercial.CommercialModule`; собственный engine из env.
- **Где менять для типовых задач:** параметры телемед-модуля (цена, длительность сессии, запись) — `PAYLOAD`/`config_schema`.
- **Подводные камни:** идентичны `seed_sms_marketing_module` — это копипаст-шаблон (annual = `4990*12*0.9=53892` в комментарии, дубль `engine.dispose()`). При добавлении новых каталожных модулей разумно вынести общий upsert-хелпер, но сейчас каждый модуль = отдельный файл-копия.
- **Строк:** 80

## `backend/app/services/segment_service.py`
- **Назначение:** CRM-сегментация (Phase E2): резолвит `filter_json` (JSONB-конструктор фильтров) патиент-сегмента в список `patient_id`. Поддерживает динамические (пересчёт фильтра) и статические (snapshot) сегменты.
- **Ключевые элементы:** `_date_to_range(days)` (utcnow − N дней), `async resolve_segment_filter(db, tenant_id, f)` → list[str] (основная логика AND-комбинации условий), `async resolve_segment(db, segment)` → list[str] (диспетчер dynamic/static).
- **Зависимости:** `app.models.patient_account.PatientAccount`, `app.models.engagement.{PatientSegment, PatientTag}`. Потребитель — `app/routers/patient_engagement_segments.py`.
- **Где менять для типовых задач:** добавить новый ключ фильтра (напр. `gender`) — допиши блок `if f.get("..."):` в `resolve_segment_filter` И обнови docstring-перечень ключей. Изменить логику «спящих»/churn — `last_seen_*` блоки. Логика ДР — `birthday_in_next_days` (raw SQL `text`).
- **Подводные камни:** `birthday_in_next_days` и `has_appointments_in_tenant` используют сырой SQL `text()` с интерполяцией `{n}` (значение приводится через `int()` — SQL-инъекция исключена, но осторожно при правках). `has_appointments_in_tenant` матчит appointments по `patient_phone` (а не по patient_id — телефон как ключ связи между `PatientAccount` и `appointments`). Ключ `city` зарезервирован, но **no-op** (поля city в `PatientAccount` нет). tenant_id фильтрует только теги и appointments, но НЕ базовую выборку `PatientAccount` (аккаунты пациентов глобальны, не привязаны к тенанту) — это by design.
- **Строк:** 136

## `backend/app/services/settings_service.py`
- **Назначение:** Тонкая обёртка над таблицей `system_settings`: чтение/запись строковых key-value. Поддерживает tenant-специфичные настройки через композитный ключ `"{tenant_id}:{key}"`.
- **Ключевые элементы:** `_scoped_key(key, tenant_id)` (формирует префиксный ключ), `async get_setting(db, key, default="", tenant_id=None)` (с fallback на глобальный ключ), `async set_setting(db, key, value, tenant_id=None)` (upsert + commit).
- **Зависимости:** `app.models.settings.SystemSettings`. Используется широко по проекту везде, где нужны рантайм-конфиги.
- **Где менять для типовых задач:** добавить типизацию (сейчас всё `str`) — обернуть `get_setting` хелперами bool/int на стороне вызова. Изменить стратегию tenant-изоляции — `_scoped_key`.
- **Подводные камни:** значения ВСЕГДА строки — числа/булевы парсить на вызывающей стороне. `get_setting` с `tenant_id` делает **fallback на глобальный ключ** (для миграции старых данных) — может вернуть чужое глобальное значение, если тенант-специфичного нет. `set_setting` делает `await db.commit()` внутри — нельзя вызывать в середине чужой транзакции, которую вызывающий хочет откатить. Старый стиль `# ===== БЛОК =====` в шапке — легаси-комментарий.
- **Строк:** 49

## `backend/app/services/slot_booking_service.py`
- **Назначение:** Бизнес-логика бронирования слотов приёма прямо из чата пациент↔клиника (фича `chatslot01`). Регистратор шлёт `slot_offer`, пациент кликает слот → создаётся `Appointment`. Защита от двойного бука через `pg_advisory_xact_lock`.
- **Ключевые элементы:** иерархия ошибок `SlotBookingError(ValueError)` → `SlotTakenError`/`SlotExpiredError`/`SlotNotFoundError`; `_advisory_lock_key(doctor_id, start_at)` (sha256 → signed 8-byte int); `async create_slot_offer(...)`, `async create_slot_request(...)`, `async book_slot(...)` → `(Appointment, booked_msg, sys_msg)`, `async expire_old_offers(session, older_than_hours=24)` → int (cron).
- **Зависимости:** модели `patient_chat` (`PatientChat`, `PatientChatMessage`, `PatientChatSender`, `PatientChatMessageType`), `doctor` (`Appointment`, `AppointmentStatus`, `AppointmentSource`, `Doctor`), `service.Service`; схемы `schemas.chat_slots.*`. **Вызывается из планировщика:** `app/main.py` регистрирует `expire_old_offers` (см. строка ~1029-1032, периодический job с commit при count>0).
- **Где менять для типовых задач:** изменить TTL оффера — параметр `older_than_hours` в `expire_old_offers` (дефолт 24ч, дублируется в docstring). Поменять статус создаваемой записи — `AppointmentStatus.PENDING` в шаге 5 `book_slot`. Логика занятости слота — шаг 3 (проверка `Appointment` по doctor+date+time != CANCELLED).
- **Подводные камни:** advisory-lock работает ТОЛЬКО в PostgreSQL (`pg_advisory_xact_lock`) — на SQLite в тестах не сработает. Lock держится до commit/rollback — вызывающий обязан завершить транзакцию. `book_slot` делает только `flush`, НЕ commit — commit за роутером. Ошибки бросаются как подклассы `ValueError` (конвенция репо) — роутер ловит и мапит на HTTP-коды. При гонке слот помечается `taken=True` в payload оффера и кидается `SlotTakenError` (UI обновится). `price` берётся через `getattr(service, "price", None)` — мягко, если у Service нет поля.
- **Строк:** 271

## `backend/app/services/spending_service.py`
- **Назначение:** Глава 8 — «Расходник пациента за год»: агрегирует траты пациента по категориям/клиникам/месяцам за год + бонусы лояльности, и рендерит из этого PDF-отчёт (WeasyPrint).
- **Ключевые элементы:** `async compute_spending_summary(db, patient_phone, year, tenant_id=None)` → dict (агрегат + список приёмов), `render_spending_pdf(summary, patient_name)` → bytes (ленивый импорт WeasyPrint, inline HTML+CSS, локальный `fmt_money`).
- **Зависимости:** модели `doctor.Appointment/Doctor`, `clinic.Clinic`, `service.Service`, `payments_clinic.ClinicPayment`, `loyalty_ext.{LoyaltyAccountExt, LoyaltyEvent}`; `app.utils.phone.normalize_phone`.
- **Где менять для типовых задач:** изменить источник суммы приёма — приоритет `payment > appointment.price > 0` в цикле по `appts` (строка ~91). Категоризация — `doctor.specialty` или фолбэк `"Услуги"`. Вёрстка PDF — HTML-строка в `render_spending_pdf` (CSS в `<style>`, шрифт DejaVu Sans для кириллицы). Добавить раздел отчёта — новая `by_*` агрегация + новая `<h2>`+таблица.
- **Подводные камни:** **Decimal vs float** — внутренние агрегаты считаются в `Decimal` (`defaultdict(lambda: Decimal("0"))`), но на выходе словарь конвертируется в `float(...)` для JSON — не переиспользовать выходные float для денежной арифметики. Связь оплаты с приёмом — по `appointment_id`; связь пациента — по нормализованному телефону (`normalize_phone`), а не patient_id. `tenant_id` опционален — без него выборка глобальна по телефону (риск смешать данные из разных тенантов!). `loyalty_earned`/`saved_with_loyalty` считаются только при заданном `tenant_id`. `sum(e.delta ...)` по генератору может вернуть `0` (int) при пустом списке — следить за типами.
- **Строк:** 275

## `backend/app/services/staff_chat_cleanup_job.py`
- **Назначение:** Cron-джоб: удаляет с диска протухшие вложения чата сотрудников (`staff_chat_files` где `expires_at < now`, TTL 48ч), проставляет `deleted_at`, плюс подчищает orphan-файлы (нет записи в БД, старше 7 дней).
- **Ключевые элементы:** константа `STORAGE_ROOT = Path("/opt/clinika/data/staff_chat_files")`, `async cleanup_staff_chat_files_job()`.
- **Зависимости:** `app.database.AsyncSessionLocal` (собственная сессия), `app.models.staff_chat.StaffChatFile`. **Регистрируется в планировщике:** `app/main.py` строка 1167 — `scheduler.add_job(cleanup_staff_chat_files_job, 'interval', minutes=30, ...)`.
- **Где менять для типовых задач:** изменить интервал — НЕ здесь, а в `app/main.py` (`add_job ... minutes=30`). Изменить orphan-порог 7 дней — `cutoff = now - timedelta(days=7)`. Путь хранилища — `STORAGE_ROOT`.
- **Подводные камни:** `STORAGE_ROOT` захардкожен под продовый Linux-путь `/opt/clinika/...` — на Windows-деве не существует, ветка orphan-cleanup тихо пропускается (`if STORAGE_ROOT.exists()`). TTL «48 часов» в docstring — на самом деле определяется при создании файла (`expires_at`), джоб лишь удаляет просроченные. Открывает ДВЕ отдельные сессии (для expired и для known_paths). Ошибки на отдельных файлах глотаются (`except Exception`), считаются в `failed_count`. utcnow / mtime сравнение — потенциальный TZ-mismatch если сервер не в UTC.
- **Строк:** 75

## `backend/app/services/staff_chat_mentions.py`
- **Назначение:** Парсинг `@username` в сообщениях чата сотрудников, резолв в user-id (в рамках тенанта) и best-effort Telegram-нотификация упомянутым.
- **Ключевые элементы:** regex `_RE_MENTION = @([A-Za-z0-9_.]{3,30})`; `parse_mention_strings(text)` → list[str] (уникальные, lower); `async resolve_mentions(db, usernames, *, tenant_id)` → list[str] (только юзеры тенанта); `async send_mention_tg_notification(...)` → bool (через urllib + опц. HTTPS_PROXY, в thread executor); `async notify_mentions(db, *, sender, room, mention_ids, text_preview)` (fire-and-forget рассылка).
- **Зависимости:** `app.models.user.User`; env `TG_BOT_TOKEN`, `HTTPS_PROXY`. Вызывается из `POST /staff-chat/rooms/{id}/messages` (см. docstring), результат `resolve_mentions` пишется в `msg.mentioned_user_ids` (JSONB).
- **Где менять для типовых задач:** формат/длина юзернейма — regex `_RE_MENTION`. Текст TG-уведомления — `msg` в `send_mention_tg_notification`. Источник telegram_id — `getattr(u, "telegram_id", ...)` в `notify_mentions`.
- **Подводные камни:** mention-резолв строго **tenant-scoped** (`User.tenant_id == tenant_id`) — кросс-тенантные упоминания невозможны (в отличие от cross-tenant DM в staff_chat_service). TG-нотификация полностью best-effort: без `TG_BOT_TOKEN` тихо возвращает False, ошибки глотаются. `notify_mentions` использует `asyncio.create_task` (fire-and-forget) — задачи не ожидаются, при падении процесса могут потеряться; себя не нотифицирует. Только латиница в юзернеймах (кириллические @ не распознаются).
- **Строк:** 154

## `backend/app/services/staff_chat_service.py`
- **Назначение:** Ядро внутреннего чата сотрудник↔сотрудник: RBAC-видимость пользователей, direct/group/clinic/broadcast комнаты, отправка/чтение сообщений, реакции, read-receipts (✓/✓✓), опросы, поиск, сериализация. Самый крупный файл среза.
- **Ключевые элементы (по группам):**
  - *RBAC:* `async user_clinic_ids(db, user)`, `_user_franchise_id`, `_hidden_targets_for_viewer`, `async visible_users_for(db, user)`, `_dedup_by_id`.
  - *Membership/queries:* `user_room_ids`, `get_room`, `is_member`, `list_room_members`, `get_or_create_direct_room`.
  - *Send/read:* `send_message`, `mark_read`, `list_messages`, `last_message`, `count_unread`.
  - *Read-receipts:* `load_reads_for_messages`, `mark_messages_read` (bulk-insert ON CONFLICT DO NOTHING), `count_room_members`.
  - *Реакции:* `load_reactions_for_messages`, `_aggregate_reactions`.
  - *Сериализация:* `serialize_user_brief`, `serialize_message`, `serialize_room`.
  - *Поиск:* `search_messages_logic` (ILIKE по body в комнатах юзера).
  - *Опросы:* `serialize_poll_for_message`, `_serialize_poll_obj`, `create_poll_logic`, `toggle_poll_vote_logic`.
- **Зависимости:** `app.models.user.{User, UserRole}`, `app.models.clinic.Clinic`, `app.models.staff_chat.*` (Room/Member/Message/Reaction/Poll/PollVote + константы типов комнат), `app.models.staff_chat_read.StaffChatMessageRead`; ленивые импорты `app.models.tenant.Tenant`, `doctor_clinic_access.DoctorClinicAccess`, `tenant_visibility.TenantVisibility`.
- **Где менять для типовых задач:** изменить кто-кого-видит в чате — `visible_users_for` (главная RBAC-функция) + `user_clinic_ids`. Разрешить/запретить cross-tenant DM — `get_or_create_direct_room` (проверка франшизы + роли admin). Добавить поле в API сообщения — `serialize_message` (kwargs backward-compat). Логика галочек прочтения — `mark_messages_read` + `serialize_message` (delivered_to/read_by). Новый тип комнаты — константы в `app.models.staff_chat` + ветки сериализации.
- **Подводные камни:** видимость **cross-tenant в рамках одной франшизы** (super_admin/franchise_owner видят все клиники франшизы) — НЕ чистая tenant-изоляция, легко сломать при правках. Матрица `TenantVisibility` (allow_chat=False) дополнительно скрывает таргеты — её игнор приведёт к утечке. Множество ленивых импортов внутри функций (антипаттерн, но защищает от циклических импортов и отсутствующих моделей через `try/except`). `send_message`/`create_poll_logic` делают `flush`, НЕ commit. `delivered_to` — эвристика (override → members_count-1 → len(read_by)). `mark_messages_read` использует PostgreSQL-специфичный `pg_insert ... on_conflict_do_nothing` (не сработает на SQLite). Фильтр `is_active` через хитрый `getattr(User, "is_active", User.id == User.id)` — заглушка-«always true» если поля нет.
- **Строк:** 868

## `backend/app/services/subscription_benefits_service.py`
- **Назначение:** Строит структурированное представление привилегий пациентского тарифа «Здоровье+» для UI-карточек и для авто-сообщения в чат менеджеру. Раскрывает `features.services_access` в человекочитаемый summary + breakdown по категориям с примерами реальных услуг клиники.
- **Ключевые элементы:** константы `SUMMARY_ICONS` (slug→material-иконка), `CATEGORY_KEYWORDS` (slug→подстроки для ILIKE-матча категорий); `async _list_examples_for_category(db, tenant_id, slug)` → (топ-5 названий, total); `async get_benefits_detail(db, plan_key, tenant_id)` → полный dict (summary/categories_breakdown/full_details_chat_message); `build_summary_for_card(meta)` → list[dict] (короткий 4-6-item summary, синхронный, без БД).
- **Зависимости:** `app.models.service.Service`; **`app.services.subscription_service as ss`** (вызывает `ss.plan_meta_db` — source of truth метаданных плана). Потребители: `GET /patient/subscription/plans/{plan_key}/benefits-detail`, `POST /patient/subscription/inquire-details`.
- **Где менять для типовых задач:** добавить новый тип привилегии (напр. «бесплатная доставка») — иконка в `SUMMARY_ICONS` + блок в `get_benefits_detail` + строка в `chat_lines` + (опц.) в `build_summary_for_card`. Подстроить категоризацию услуг — `CATEGORY_KEYWORDS`. Безлимит = `count >= 999` (магическое число, дублируется).
- **Подводные камни:** магическое `>= 999` для «безлимита» встречается в нескольких местах — менять синхронно. Матч услуг по ILIKE-ключевым словам (`category` ИЛИ `name`) — неточный, может ловить лишнее/упускать. `total_in_clinic`/`examples` требуют `tenant_id` (без него пусто). Цены приводятся к `float` для JSON. `build_summary_for_card` берёт только 3 захардкоженные категории (`lab_tests`/`consultations`/`diagnostics`) и режет до 6 элементов.
- **Строк:** 247

## `backend/app/services/subscription_cash_service.py`
- **Назначение:** Наличная активация пациентской подписки «Здоровье+» менеджером/регистратором в кабинете клиники: создаёт `PatientSubscription`, пишет `BillingLedger`, историю, проверяет сумму (±5%) и генерирует PDF-квитанцию.
- **Ключевые элементы:** `async can_activate_for_patient(db, tenant_id, patient_id)` → (bool, reason); `_months_to_days(months)` (1→30/3→90/6→180/12→365); `async activate_cash(...)` → `(sub, ledger, info)` (ядро); `RECEIPT_HTML_TEMPLATE` + `render_receipt_pdf(ctx)` → bytes (WeasyPrint → reportlab → HTML-фолбэк); `async list_history(...)`, `async stats(...)`.
- **Зависимости:** модели `billing_ledger.BillingLedger`, `patient_account.PatientAccount`, `subscription.{PatientSubscription, PatientSubscriptionHistory}`, `tenant.Tenant`, `user.User`; **`subscription_service as ss`** (`plan_meta_db`, `get_active_subscription`); **`subscription_module_service.health_plus_module_active`** (gate). Потребитель — `POST /manager/subscription-cash/activate`.
- **Где менять для типовых задач:** изменить допуск расхождения суммы — `flagged = diff_pct > 5.0` (порог 5%). Изменить срок по месяцам — `_months_to_days`. Вёрстка квитанции — `RECEIPT_HTML_TEMPLATE`. Запрет двойной подписки — `can_activate_for_patient`. Тип записи в ledger — `entry_type="subscription_cash"` (важно для `list_history`/`stats`).
- **Подводные камни:** **Decimal-дисциплина** — все деньги (`price_monthly`, `amount_expected`, `amount_received`) приводятся к `Decimal` и `.quantize(Decimal("0.01"))`; в `meta` (JSONB) пишутся уже как `float(...)` (важно: Decimal не сериализуется в JSONB напрямую — здесь это учтено!). Расхождение >5% НЕ блокирует активацию, лишь ставит `flagged=True`. `activate_cash` делает `flush`, НЕ commit. Gate: без активного `health_plus_module` бросает ValueError → роутер мапит в 402. PDF имеет трёхуровневый фолбэк (Weasy→reportlab→raw HTML bytes) — клиенту может прийти не-PDF.
- **Строк:** 327

## `backend/app/services/subscription_module_service.py`
- **Назначение:** Gate-утилита: проверяет, активен ли у тенанта маркетплейс-модуль `health_plus_module` (из `commercial_modules` через `tenant_module_subscriptions`). От этого зависит видимость планов пациентом и право менеджеров/owner'ов на операции с подписками.
- **Ключевые элементы:** константа `MODULE_KEY = "health_plus_module"`, `async health_plus_module_active(db, tenant_id)` → bool (учитывает статусы ACTIVE/TRIAL/GRACE).
- **Зависимости:** `app.models.commercial.{ModuleStatus, TenantModuleSubscription}`. Импортируется в `subscription_cash_service` и (по docstring) проверяется во множестве subscription-роутеров (plans=пустой массив, override=402, cash=402, global PATCH=403).
- **Где менять для типовых задач:** изменить, какие статусы модуля считаются «активными» — список в `.status.in_([...])`. Добавить аналогичный gate для другого модуля — скопировать функцию с новым `MODULE_KEY`.
- **Подводные камни:** ключевое поведение — **`tenant_id=None` (платформа/super_admin) ВСЕГДА возвращает True** (админит global-шаблоны, модуль ему не нужен). Учитывает `GRACE` (период после неоплаты) как активный — намеренно, чтобы не отрубать функционал мгновенно. Очень маленький файл, но критичен для всей монетизации подписок.
- **Строк:** 47

## `backend/app/services/subscription_plan_discount_service.py`
- **Назначение:** Дифференцированные скидки подписки «Здоровье+» по уровням: конкретная услуга → категория → весь план → старый fallback. Резолвит итоговый % и предоставляет CRUD-обёртки для manager-роутера.
- **Ключевые элементы:** `_load_service`; `async get_effective_discount_for_service(...)` → Decimal (каскад service→category→all→fallback, с приоритетом tenant>global); CRUD: `list_rules`, `create_rule` (валидация scope/полей/диапазона), `update_rule`, `delete_rule`.
- **Зависимости:** `app.models.subscription_plan_discount.SubscriptionPlanDiscount`, `app.models.service.Service`. По docstring fallback — из `TenantPricingRules.subscription_discount_percent` или `benefits.discount_percent`.
- **Где менять для типовых задач:** изменить приоритет резолва скидки — порядок блоков 1→2→3→4 в `get_effective_discount_for_service`. Добавить scope — расширить валидацию в `create_rule` (`scope not in (...)`) и каскад в резолвере. Изменить tenant>global приоритет — паттерн `next((r for r in rules if r.tenant_id == tenant_id), None)` затем global.
- **Подводные камни:** **Decimal vs float** — проценты строго `Decimal(str(...))`, диапазон [0;100] валидируется в `create_rule`, но финальный clamp в [0;50] делается НЕ здесь, а на call-site `compute_discount_for` (см. docstring) — не полагаться на этот сервис для верхней границы. tenant-правило всегда побеждает global (`tenant_id IS NULL`) на каждом уровне. `update_rule`/`delete_rule` запрещают править чужой тенант И global (`row.tenant_id != tenant_id` → PermissionError) — менеджер не может тронуть глобальные правила. Если у услуги не передана категория — она подтягивается из `services.category` автоматически.
- **Строк:** 251
