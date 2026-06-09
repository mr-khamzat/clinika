# jobs-schemas [01] — фоновые APScheduler-джобы + Pydantic-схемы API

Этот срез объединяет два независимых, но смежных слоя backend МИС clinika:

1. **`backend/app/jobs/*`** — 9 фоновых задач, которые запускает APScheduler (регистрация и расписание заданы в `app/main.py`). Все джобы — `async`-функции с единым контрактом: открывают свою сессию через `AsyncSessionLocal()` (либо принимают `db` аргументом), не возвращают HTTP-ответов, логируют через именованный `logging.getLogger(...)`, и почти все идемпотентны (дедуп через `alert_service.notify_admin(dedup_key=...)` или через проверку уже-существующих записей в БД). Большинство шлёт уведомления администратору сети через `app.services.alert_service` (Telegram).
2. **`backend/app/schemas/*`** — 9 модулей Pydantic v2-схем (request/response DTO) для роутеров. Это контракты между API и фронтом: что роутер принимает в теле запроса и что отдаёт. Многие Response-схемы используют `from_attributes=True` (ORM-mode) для прямой сериализации SQLAlchemy-моделей, и часть полей денормализованы — заполняются роутером вручную при выдаче (помечено в комментариях `# заполняется роутером`).

Важная общая черта джобов: типичная ошибка из памяти проекта (Decimal в JSONB, `sum()` пустого генератора, двойной учёт) актуальна именно здесь — несколько джобов оперируют деньгами (`Decimal`/`float`) и инкрементируют агрегаты, поэтому к ним повышенное внимание.

## Оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `backend/app/jobs/ads_attribution_job.py` | Атрибуция конверсий рекламы по кликам | 120 |
| `backend/app/jobs/appointment_reminders.py` | Push-напоминания о записи (24ч/2ч) | 107 |
| `backend/app/jobs/daily_digest_job.py` | Ежедневная Telegram-сводка по сети | 221 |
| `backend/app/jobs/disk_check_job.py` | Контроль свободного места на диске | 114 |
| `backend/app/jobs/engagement_suggestions_job.py` | Почасовой обход тенантов: suggestions | 34 |
| `backend/app/jobs/inventory_alerts.py` | Сканер низких/просроченных остатков | 127 |
| `backend/app/jobs/marketplace_jobs.py` | Алерты о скором/истёкшем триале модуля | 155 |
| `backend/app/jobs/sms_campaign_dispatch.py` | Воркер отправки SMS-кампаний батчами | 230 |
| `backend/app/jobs/transcription_dispatch.py` | Воркер транскрипции звонков (whisper+gemini) | 106 |
| `backend/app/schemas/auth.py` | DTO логина: Telegram/пароль, токен | 23 |
| `backend/app/schemas/bonus.py` | Response-схемы бонусов + сводка | 24 |
| `backend/app/schemas/chat_slots.py` | Слот-букинг в чате: payload+req+resp | 95 |
| `backend/app/schemas/clinic.py` | Базовые DTO клиники (create/response) | 21 |
| `backend/app/schemas/feature_flag.py` | DTO фича-флагов + tenant-override | 115 |
| `backend/app/schemas/manager.py` | DTO кабинета менеджера: статы/услуги/комиссия | 177 |
| `backend/app/schemas/partner_offer.py` | DTO партнёрских офферов и категорий | 75 |
| `backend/app/schemas/referral.py` | DTO направлений: create/response/QR | 62 |
| `backend/app/schemas/user.py` | DTO пользователя: update/response | 46 |

---

## `backend/app/jobs/ads_attribution_job.py`

- **Назначение:** Привязывает подтверждённые направления (`Referral.confirmed_at`) к более ранним кликам по рекламе того же тенанта и создаёт `AdEvent(type=conversion)` с расчётом выручки. Обновляет агрегаты рекламы (`conversions_count`, `revenue_attributed`).
- **Ключевые элементы:** единственная корутина `run_attribution(db, lookback_days=30) -> dict`. Возвращает `{"attributed", "skipped_already", "no_match"}`. Принимает `db` извне (в отличие от большинства джобов — сессию не открывает сам).
- **Зависимости:** модели `app.models.advertising` (`Ad`, `AdEvent`, `AdEventType`), `app.models.referral` (`Referral`, `ReferralStatus`), `app.models.service.Service`, `app.models.user.User`; утилита `app.utils.phone.normalize_phone`. Все импорты — ленивые (внутри функции).
- **Где менять для типовых задач:**
  - Расширить матчинг кликов (сейчас strict только по `user_id`+нормализованному телефону) — блок цикла `for ev, ad in candidates` (строки 67-86); TODO про `ip_hash`-matching через cookies на строке 72.
  - Изменить расчёт выручки конверсии (сейчас только `service_id` → `Service.price`, для doctor/lab выручка `0`) — строки 92-97.
  - Изменить окно атрибуции — берётся из `ad.attribution_window_days or 7` (строка 68).
- **Подводные камни:**
  - Выручка корректно держится в `Decimal` (`Decimal(str(svc.price))`) — НЕ менять на `float`, иначе сломается аккумуляция `revenue_attributed`.
  - Tenant-изоляция есть: кандидаты-клики фильтруются `AdEvent.tenant_id == ref.tenant_id`.
  - Дедуп конверсий — через проверку существующего `AdEvent(referral_id, type=conversion)` (строки 42-50), идемпотентность гарантирована.
  - Потенциально тяжёлый запрос: для каждого referral подтягиваются ВСЕ click-события тенанта за окно без `LIMIT` (строки 57-63) — при росте трафика стоит ограничить.
  - `revenue` для doctor/lab жёстко `0` — заведомо недосчёт по этим типам направлений.
- **Строк:** 120

## `backend/app/jobs/appointment_reminders.py`

- **Назначение:** Отправляет push-напоминания пациенту за 24ч и за 2ч до приёма. Запускается каждые 30 минут. Помечает отправленное в `Appointment.reminders_sent` (JSON-словарь `{"24h": True, "2h": True}`), чтобы не дублировать.
- **Ключевые элементы:** `run_appointment_reminders() -> int` (entry-point, возвращает число отправленных); helper `_send_reminder(db, apt, key, hours)`; форматтер даты `_fmt_when(apt) -> str` (русские сокращения месяцев).
- **Зависимости:** `app.database.AsyncSessionLocal`, модель `app.models.doctor` (`Appointment`, `AppointmentStatus`), сервис `app.services.push_service.send_push_to_phone` (ленивый импорт, graceful при отсутствии). Использует `sqlalchemy.orm.attributes.flag_modified` для пометки изменения JSON-поля.
- **Где менять для типовых задач:**
  - Изменить окна напоминаний — `t24_lo/t24_hi/t2_lo/t2_hi` (строки 73-76) и пороги выбора (строки 96-101).
  - Изменить текст пуша — `_send_reminder`, ветка `if hours >= 24` (строки 37-40).
  - Добавить новое окно (например, за 1ч) — добавить ключ в `reminders_sent` и ещё одну ветку выбора; обязательно дополнить `flag_modified`.
- **Подводные камни:**
  - JSON-поле `reminders_sent` мутируется через `dict(...)` + `flag_modified` (строки 55-58) — без `flag_modified` SQLAlchemy не заметит изменения мутабельного JSON и не сохранит.
  - Помечает `key=True` ДАЖЕ при `sent=0` (нет подписок) — осознанно, чтобы не долбить повторно (комментарий строка 54).
  - **Нет tenant-фильтра** в выборке `Appointment` (строки 81-85) — джоб глобальный по всем тенантам, что корректно для платформенного воркера, но запрос грузит все записи в окне дат.
  - Весь джоб обёрнут в `try/except` с логом ошибки — падение одного приёма не валит остальные (внутренний `try` на `datetime.combine`).
- **Строк:** 107

## `backend/app/jobs/daily_digest_job.py`

- **Назначение:** Раз в день (~09:00 МСК) собирает сводку за «вчера» по сети ARC (приёмы по статусам, выручка, cross-clinic направления, топ-3 врача, нарушения региона) и шлёт админу HTML в Telegram.
- **Ключевые элементы:** `run_daily_digest() -> bool` (entry-point); хелперы `_yesterday_msk_window()` (UTC-окно «вчера» с учётом МСК=UTC+3), `_collect_clinic_stats`, `_collect_referrals`, `_collect_top_doctors`, `_count_region_violations`. Константа `DEFAULT_SLUGS = "arc,lor,neo,ach,srn"`.
- **Зависимости:** `app.database.AsyncSessionLocal`; модели `audit.AuditEntry`, `doctor` (`Appointment`, `AppointmentStatus`, `Doctor`), `referral.Referral`, `tenant.Tenant`, `clinic.Clinic`; сервис `app.services.alert_service` (`format_daily_digest`, `notify_admin`). Слаги сети — из env `DIGEST_TENANT_SLUGS`.
- **Где менять для типовых задач:**
  - Изменить состав сети — env `DIGEST_TENANT_SLUGS` (csv) или `DEFAULT_SLUGS` (строка 36).
  - Добавить новую метрику — написать `_collect_*` хелпер и добавить ключ в `stats` (строки 208-214); рендер — в `alert_service.format_daily_digest`.
  - Сменить часовой пояс окна — `_yesterday_msk_window` (`timezone(timedelta(hours=3))`, строка 46).
- **Подводные камни:**
  - **Decimal vs float:** выручка собирается в `Decimal`, но в `stats` отдаётся `float(revenue)` (строка 88) — для отчёта приемлемо, но при дальнейшей агрегации возможна потеря точности.
  - **Часовые пояса:** БД хранит naive UTC; окно явно конвертируется МСК→UTC и `.replace(tzinfo=None)` (строки 52-53). При смене схемы хранения времени логика поедет.
  - **Несогласованность фильтрации по датам:** статистика приёмов фильтрует по `appointment_date` (только дата), а referrals/violations — по `created_at` (datetime). Это разные семантики окна.
  - `_collect_referrals`: cross-clinic = `FromC.tenant_id != ToC.tenant_id` с `isouter` join на from-clinic — referrals без from-clinic исключаются (`FromC.tenant_id.is_not(None)`).
  - Каждый сбор обёрнут в свой `try/except` — падение одной метрики не валит всю сводку.
  - Дедуп по дате: `dedup_key=f"daily_digest:{label}"` защищает от двойного запуска в один день.
- **Строк:** 221

## `backend/app/jobs/disk_check_job.py`

- **Назначение:** Раз в час проверяет занятость `/` через `os.statvfs`; если used% > порога — собирает топ-директорий через `du -sh` и шлёт критический алерт админу.
- **Ключевые элементы:** `run_disk_check() -> bool` (entry-point); хелпер `_run_du(path) -> str | None` (subprocess `du -sh` c таймаутом 10с). Константы `THRESHOLD` (env `DISK_ALERT_THRESHOLD`, дефолт 80), `DU_ROOTS` (список путей для разведки).
- **Зависимости:** `app.services.alert_service` (`format_disk_alert`, `notify_admin`); стандартные `os`, `asyncio` (для `create_subprocess_exec`).
- **Где менять для типовых задач:**
  - Изменить порог — env `DISK_ALERT_THRESHOLD` или `THRESHOLD` (строка 22).
  - Изменить список разведываемых директорий — `DU_ROOTS` (строки 27-32).
  - Сменить точку монтирования для проверки места — `os.statvfs("/")` (строка 74).
- **Подводные камни:**
  - **Linux-only:** `os.statvfs` и бинарь `du` отсутствуют на Windows — джоб рассчитан на контейнер (POSIX). При локальном запуске на Windows упадёт/вернёт `False`.
  - `_run_du` устойчив: проверяет `os.path.isdir`, ловит `FileNotFoundError` (нет `du`), таймаут с `proc.kill()` — best-effort, никогда не валит джоб.
  - **Дедуп с гранулярностью 1%:** `dedup_key=f"disk:{int(used_pct)}"` — пока процент не изменится на целое значение, повтор не уйдёт (антиспам).
  - `bypass_switch=True` (строка 112) — переполнение диска шлётся даже при выключенном глобальном переключателе уведомлений.
- **Строк:** 114

## `backend/app/jobs/engagement_suggestions_job.py`

- **Назначение:** Раз в час обходит ВСЕ тенанты и для каждого запускает движок генерации suggestions (рекомендаций по вовлечению). Тонкая обёртка-планировщик над `suggestion_engine`.
- **Ключевые элементы:** единственная корутина `run_all_tenants()` — entry-point APScheduler. Возвращает агрегированный `total` dict.
- **Зависимости:** `app.database.AsyncSessionLocal`, `app.models.tenant.Tenant`, **`app.services.suggestion_engine.run_engine`** (вся бизнес-логика — там, этот файл лишь итерирует).
- **Где менять для типовых задач:**
  - Логику генерации suggestions — НЕ здесь, а в `app.services.suggestion_engine.run_engine`.
  - Изменить периодичность/фильтр тенантов — здесь (строка 19 — сейчас берёт всех без фильтра `is_active`).
- **Подводные камни:**
  - **Отдельная сессия на каждого тенанта** (строка 24) — изоляция: падение одного тенанта (через `log.exception`) не валит остальных.
  - Список тенантов читается одной сессией, обработка — другими (строки 18-19 vs 24) — корректно, не держит длинную транзакцию.
  - Агрегирует в `total` только `int`-значения статистики (строка 28) — нечисловые ключи теряются.
- **Строк:** 34

## `backend/app/jobs/inventory_alerts.py`

- **Назначение:** Раз в день (cron 09:00) для тенантов с активным модулем `inventory` считает низкие остатки + скорую просрочку (≤30 дней) + просроченные позиции и шлёт компактный алерт админу платформы в Telegram.
- **Ключевые элементы:** `run_inventory_alerts() -> int` (число тенантов, кому ушло сообщение). Внутри — три агрегатных запроса на тенанта (low_stock, expiring, expired).
- **Зависимости:** `app.database.AsyncSessionLocal`; модели `commercial` (`ModuleStatus`, `TenantModuleSubscription`), `inventory` (`InventoryItem`, `InventoryStock`), `tenant.Tenant`; сервис `app.services.alert_service._send_telegram` (приватный метод!).
- **Где менять для типовых задач:**
  - Порог «скоро просрочка» — `cutoff = today + timedelta(days=30)` (строка 55).
  - Какие статусы подписки считать активными — `status.in_([ACTIVE, TRIAL, GRACE])` (строки 45-49).
  - Текст алерта — строки 113-118.
  - **Адресацию:** сейчас шлёт ТОЛЬКО админу платформы (комментарий строки 7-12: персональные алерты менеджеру тенанта — в будущей итерации).
- **Подводные камни:**
  - **Decimal:** остатки и пороги в `Decimal` (`func.coalesce(..., Decimal("0"))`) — корректно, не подменять на 0/float.
  - low_stock считается через подзапрос-сумму `InventoryStock.quantity` по складам, сравнение с `InventoryItem.min_stock_threshold > 0` — учитываются только позиции с заданным порогом.
  - Tenant-изоляция строгая: каждый запрос фильтрует `tenant_id == tenant_id`.
  - Использует **приватный** `alert_service._send_telegram` (а не публичный `notify_admin`) — нет дедупа; при ежедневном запуске не критично, но при учащении расписания возможен спам.
- **Строк:** 127

## `backend/app/jobs/marketplace_jobs.py`

- **Назначение:** Два джоба жизненного цикла триала коммерческих модулей: предупреждение за 3 дня до окончания (`trial_expiring_soon_job`, каждые 6ч) и алерт о только что истёкшем триале (`trial_expired_alert_job`, каждый час после `module_expiry_job`).
- **Ключевые элементы:** `trial_expiring_soon_job()` и `trial_expired_alert_job()` — обе корутины без возврата (`-> None`), обёрнуты в общий `try/except`. Оба пресетят имена тенантов/модулей одним пакетным запросом (мапы `tenants_map`, `modules_map`).
- **Зависимости:** `app.database.AsyncSessionLocal`; модели `commercial` (`CommercialModule`, `TenantModuleSubscription`, `ModuleStatus`), `tenant.Tenant`; сервис `app.services.alert_service.notify_admin`. **NB:** сам автопереход trial→expired делает другой джоб — `module_expiry_job` (не в этом файле).
- **Где менять для типовых задач:**
  - Окно «за 3 дня» — `window_start/window_end` (строки 39-40).
  - Окно «только что истёк» — `cutoff = now - timedelta(hours=2)` (строка 105) — должно быть согласовано с периодом запуска (1ч < 2ч).
  - Текст уведомлений — строки 79-85 и 140-146.
- **Подводные камни:**
  - **Идемпотентность через дедуп:** `trial_expiring` ключ включает дату (`{sub.id}:{date}`), `trial_expired` — только `{sub.id}` (один раз на подписку). При смене расписания учитывать.
  - Окно `trial_expired_alert_job` (2ч) шире периода запуска (1ч) — намеренно с запасом; дедуп по `sub.id` предотвращает повтор.
  - Время в UTC (`datetime.utcnow()`), сравнивается с `trial_ends_at` — поле должно храниться в UTC.
- **Строк:** 155

## `backend/app/jobs/sms_campaign_dispatch.py`

- **Назначение:** Воркер SMS-кампаний, тик раз в минуту. Активирует scheduled→sending по `scheduled_at`, отправляет батч (≤100) каждой sending-кампании, при исчерпании аудитории финализирует в sent. Провайдер сейчас стаб (`internal`).
- **Ключевые элементы:** `run_sms_campaign_dispatch() -> int` (entry-point); `_process_one_campaign(db, camp) -> int` (один тик одной кампании); `_fetch_audience_phones(...)` (стаб-сегментация: `custom_phones` из фильтра или distinct телефоны из appointments); `_send_via_provider(phone, text)` (стаб, всегда успех); `_render_template(body, ctx)` (подстановка `{{key}}`). Константы `LIMIT_PER_TICK=100`, `MAX_RECIPIENTS_PER_CAMPAIGN=5000`.
- **Зависимости:** `app.database.AsyncSessionLocal`; модели `app.models.sms_marketing` (`SmsCampaign`, `SmsCampaignStatus`, `SmsMessageLog`, `SmsMessageStatus`, `SmsProvider`, `SmsTemplate`), `app.models.doctor.Appointment` (источник аудитории); утилита `app.utils.phone.mask_phone` (для безопасного лога).
- **Где менять для типовых задач:**
  - **Подключить реальный SMS-провайдер** (smsc.ru/smsaero/plivo) — заменить тело `_send_via_provider` (строки 65-74); сейчас всегда `(True, uuid, None)`.
  - Расширить сегментацию аудитории — `_fetch_audience_phones` (строки 39-62); сейчас только `custom_phones` и «все из appointments».
  - Размер батча/лимит кампании — `LIMIT_PER_TICK` / `MAX_RECIPIENTS_PER_CAMPAIGN` (строки 26-28).
  - Плейсхолдеры шаблона — `_render_template`; контекст формируется на строке 155 (`patient_phone`, `date`).
- **Подводные камни:**
  - **Tenant-изоляция:** аудитория тянется `Appointment.tenant_id == camp.tenant_id` — корректно.
  - **Дедуп получателей между тиками** — через выборку уже-залогированных `patient_phone` и фильтр (строки 129-144). Грубый: при больших аудиториях множество `sent_phones` растёт и `limit` запроса раздувается (`batch_size + len(sent_phones)`).
  - **Хрупкая логика финализации** (строки 178-183): сложное условие на основе `total_recipients`; при рассогласовании `total_recipients` с реальной аудиторией кампания может «зависнуть» в sending или, наоборот, недоотправить. Кандидат на рефакторинг.
  - **Нет проверок opt-out и timezone** (явно отмечено в docstring, строки 11-12) — недоделка первой итерации.
  - Каждая кампания коммитится отдельно с `rollback` на ошибке (строки 219-226) — изоляция сбоев.
  - Активация scheduled-кампаний — bulk `update(...)` без timezone-проверки `scheduled_at` (строки 200-208).
- **Строк:** 230

## `backend/app/jobs/transcription_dispatch.py`

- **Назначение:** Воркер транскрипции звонков, тик раз в 2 минуты. Берёт до 5 записей `status=ready`, переводит в `transcribing`, прогоняет whisper→gemini-summary, финализирует в `done` (или `failed` внутри whisper_service).
- **Ключевые элементы:** единственная корутина `run_transcription_dispatch() -> int` (число обработанных). Константа `LIMIT_PER_TICK=5`.
- **Зависимости:** `app.database.AsyncSessionLocal`; модели `app.models.call_recording` (`CallRecording`, `CallRecordingStatus`, `CallTranscript`); сервисы `app.services.whisper_service.transcribe_recording` и `app.services.gemini_service.summarize_transcript` (ленивый импорт, опционален — джоб работает без AI-summary при `ImportError`).
- **Где менять для типовых задач:**
  - Размер пачки — `LIMIT_PER_TICK` (строка 19).
  - Цепочку обработки (добавить шаг после summary) — цикл `for rid in ids` (строки 65-103).
  - Логику самой транскрипции/выставления `failed` — в `whisper_service.transcribe_recording` (НЕ здесь; джоб полагается, что сервис сам ставит `status=failed`+`error_message`).
- **Подводные камни:**
  - **Двухфазность с изоляцией:** сначала одна сессия помечает все взятые записи `transcribing` и коммитит (строки 41-63), затем КАЖДАЯ запись обрабатывается в отдельной сессии (строка 67) — длинные HTTP-вызовы (whisper/gemini) не держат общую транзакцию.
  - Пометка `transcribing` повторно проверяет `status == READY` (строка 61) — защита от гонки между тиками/инстансами.
  - AI-summary best-effort: ошибка summary логируется warning'ом, но НЕ переводит запись в failed (строки 87-91).
  - Финализация в `done` только если запись всё ещё `transcribing` (строка 99) — не перетирает статус, изменённый сервисом (например `failed`).
  - **Нет tenant-фильтра** — глобальный воркер по всем записям; tenant-контекст внутри `transcribe_recording`.
- **Строк:** 106

## `backend/app/schemas/auth.py`

- **Назначение:** DTO для аутентификации: вход через Telegram WebApp, вход по логину/паролю и ответ с JWT-токеном.
- **Ключевые элементы:** `TelegramAuthData` (id/имя/username/phone + сырая `init_data` для верификации подписи), `PasswordLoginData` (username/password), `TokenResponse` (access_token, token_type, user_id, role, clinic_id, full_name).
- **Зависимости:** только `pydantic.BaseModel`. Без импортов моделей/енумов.
- **Где менять для типовых задач:**
  - Добавить поле в ответ логина (например `tenant_slug`) — `TokenResponse` (строки 16-22) + соответствующий роутер аутентификации.
  - Принять новый параметр верификации Telegram — `TelegramAuthData` (строки 3-10).
- **Подводные камни:**
  - `id` в `TelegramAuthData` — строка (`str`), не int; Telegram отдаёт числовой id, конвертация на стороне роутера.
  - `role`/`user_id`/`clinic_id` в `TokenResponse` — строки, не UUID/Enum (готовый к JSON формат) — сериализацию делает роутер.
- **Строк:** 23

## `backend/app/schemas/bonus.py`

- **Назначение:** Response-схемы для бонусов рефереров: карточка одного бонуса и агрегированная сводка.
- **Ключевые элементы:** `BonusResponse` (id, admin_id, referral_id, bonus_type, amount, status, created_at, paid_at; `from_attributes=True`), `BonusSummary` (total_pending, total_paid, total_referrals, confirmed_referrals).
- **Зависимости:** енумы `app.models.bonus.BonusStatus`, `BonusType`.
- **Где менять для типовых задач:**
  - Добавить новый тип/статус бонуса в ответ — менять енумы в `app.models.bonus`, схема подхватит.
  - Расширить сводку — `BonusSummary` (строки 19-23) + расчёт в соответствующем роутере/сервисе.
- **Подводные камни:**
  - **`amount: float`** — деньги отдаются как `float`. В БД бонусы скорее всего `Decimal`/Numeric; Pydantic сконвертирует в float при сериализации → возможная потеря точности на чтении (для отображения некритично, но не использовать для повторных вычислений).
  - Использует устаревший Pydantic v1 стиль `class Config: from_attributes = True` (в отличие от v2 `model_config`) — работает, но несогласовано с другими файлами среза.
- **Строк:** 24

## `backend/app/schemas/chat_slots.py`

- **Назначение:** Pydantic-схемы фичи «slot-booking в чате» (chatslot01): структуры payload (хранятся в `PatientChatMessage.payload` JSONB), тела запросов и ответы роутеров slot-*.
- **Ключевые элементы:**
  - Payload: `SlotOfferSlot`, `SlotOfferPayload` (offer на 1-10 слотов, статус active/superseded/expired), `SlotRequestPayload`, `SlotBookedPayload`, `SlotExpiredPayload`.
  - Request: `SlotOfferCreate`, `SlotRequestCreate`, `SlotBookRequest`.
  - Response: `ChatMessageResponse` (`from_attributes`), `SlotBookResponse`.
- **Зависимости:** только `pydantic`/`datetime`/`uuid`. Самодостаточный (не импортирует ORM-модели). Логически связан с моделью `PatientChatMessage` (через payload-контракт, упомянута в docstring/комментариях).
- **Где менять для типовых задач:**
  - Изменить набор/ограничения слотов в оффере — `SlotOfferPayload.slots` (`min_length=1, max_length=10`, строка 30) и `SlotOfferCreate`.
  - Добавить поле в системное сообщение «записан» — `SlotBookedPayload` (строки 42-47).
  - Новый тип чат-сообщения для слотов — добавить payload-класс + расширить `message_type` обработку в роутере.
- **Подводные камни:**
  - `duration_min` валидируется `gt=0, le=240` — слоты > 4ч отвергаются.
  - `ChatMessageResponse.payload: dict | None` — нетипизированный dict; конкретная структура зависит от `message_type` (на стороне фронта/роутера разбирается вручную).
  - Это **схемы payload, а не таблиц** — изменения здесь меняют формат JSON в БД-колонке, миграция данных не требуется, но старые записи могут не пройти валидацию.
- **Строк:** 95

## `backend/app/schemas/clinic.py`

- **Назначение:** Базовые DTO клиники: создание и краткий ответ. Лёгкая версия (полные/расширенные варианты клиники — в `manager.py`, см. дубль ниже).
- **Ключевые элементы:** `ClinicCreate` (name/address/phone), `ClinicResponse` (id, name, address, phone, is_active, **mis_id**, created_at; `from_attributes`).
- **Зависимости:** только `pydantic`/`uuid`/`datetime`.
- **Где менять для типовых задач:**
  - Добавить поле клиники в ответ — `ClinicResponse` (строки 10-17). **Проверить дубль** в `manager.py::ClinicResponse`.
- **Подводные камни:**
  - **ДУБЛЬ:** существует второй `ClinicResponse` в `backend/app/schemas/manager.py` (строки 167-176) — у него НЕТ поля `mis_id`, зато есть `CreateClinicRequest`/`UpdateClinicRequest`. Два разных контракта одной сущности → легко рассинхронизировать. При изменении полей клиники проверять ОБА файла и какой импортируется в конкретном роутере.
- **Строк:** 21

## `backend/app/schemas/feature_flag.py`

- **Назначение:** DTO системы фича-флагов и tenant-override'ов: создание/обновление флага, ответ, установка override на тенанта. Содержит нетривиальную валидацию `rollout_value` по стратегии.
- **Ключевые элементы:**
  - Функция `validate_rollout_value(strategy, value)` — проверяет соответствие value стратегии (all/tenants → None; percentage → 0..100; ab_test → словарь весов с суммой > 0).
  - `FeatureFlagBase`, `FeatureFlagCreate` (валидатор ключа `_KEY_RE` = snake_case ASCII + метод `normalized_rollout_value()`), `FeatureFlagUpdate`, `FeatureFlagResponse` (+ денормализованный `overrides_count`).
  - `TenantFeatureFlagSet`, `TenantFeatureFlagResponse` (+ денормализованные `tenant_name`/`tenant_slug`).
- **Зависимости:** енум `app.models.feature_flag.RolloutStrategy`. Pydantic v2 (`field_validator`, `ConfigDict`).
- **Где менять для типовых задач:**
  - Добавить новую rollout-стратегию — расширить `RolloutStrategy` в модели + ветку в `validate_rollout_value` (строки 17-51).
  - Изменить правила ключа флага — regexp `_KEY_RE` (строка 14) и валидатор `_check_key`.
  - Денормализованные поля (`overrides_count`, `tenant_name`, `tenant_slug`) заполняет РОУТЕР при выдаче — добавлять расчёт там.
- **Подводные камни:**
  - `validate_rollout_value` бросает `ValueError` — роутер должен вызывать `normalized_rollout_value()` и обрабатывать как 422/400.
  - ab_test: веса нормализуются к `float`, имена вариантов — непустые строки; пустой словарь вариантов отвергается.
  - `percentage` приводится к `float` — целые проценты тоже валидны.
- **Строк:** 115

## `backend/app/schemas/manager.py`

- **Назначение:** Крупный «зонтичный» модуль DTO кабинета менеджера: отчёты/статистика, управление админами, услугами, комиссией и клиниками. Фактически сборник схем для нескольких разделов роутера менеджера.
- **Ключевые элементы:**
  - Отчёты: `SummaryReport`, `AdminStats`, `ClinicFlowEntry`.
  - Админы: `AssignClinicRequest`, `MarkPaidResponse`, `CreateAdminRequest`, `UpdateAdminRequest` (с флагом `unset_clinic`).
  - Услуги: `ServiceSchema`, `CreateServiceRequest`, `UpdateServiceRequest` (с финансовыми `price`/`bonus_amount`/`referral_payout`, `visible_for_referrals`).
  - Комиссия: `CommissionSettings`, `UpdateCommissionRequest`.
  - Клиники: `CreateClinicRequest`, `UpdateClinicRequest`, `ClinicResponse` (дубль — см. `clinic.py`).
- **Зависимости:** енум `app.models.user.UserRole`.
- **Где менять для типовых задач:**
  - Добавить поле услуги — `ServiceSchema` + `CreateServiceRequest` + `UpdateServiceRequest` (нужно править все три согласованно).
  - Изменить финансовую модель направлений — поле `referral_payout` (фолбэк на `bonus_amount` при NULL, комментарий строки 101-104).
  - Новый параметр создания админа — `CreateAdminRequest` (строки 61-70); по умолчанию `role=UserRole.REG`.
  - Очистка клиники у админа — паттерн `unset_clinic: bool` в `UpdateAdminRequest` (строка 80), т.к. `clinic_id=None` неотличим от «не передано».
- **Подводные камни:**
  - **Деньги как `float`:** `bonus_amount`, `price`, `referral_payout`, `commission_rate`, `pending_bonuses`, `paid_bonuses` — все `float`. В БД, вероятно, Numeric/Decimal — потеря точности при сериализации; не использовать эти значения для повторных денежных вычислений на стороне клиента.
  - **ДУБЛЬ `ClinicResponse`** (строки 167-176) с версией из `clinic.py` (та имеет `mis_id`, эта — нет). Аналогично `CreateClinicRequest` дублирует `ClinicCreate` из `clinic.py`. Источник рассинхрона.
  - `date_of_birth` — `str`, не `date` (передаётся как строка, парсинг на роутере).
  - Pydantic v1 стиль `class Config` в Response-схемах (несогласовано с v2-файлами среза).
- **Строк:** 177

## `backend/app/schemas/partner_offer.py`

- **Назначение:** DTO партнёрских офферов (услуга, которую клиника предлагает партнёрам с выплатой) и категорий офферов. Единственный файл среза, корректно использующий `Decimal` для денег.
- **Ключевые элементы:**
  - Категории: `PartnerCategoryBase`, `PartnerCategoryCreate`, `PartnerCategoryUpdate`, `PartnerCategoryResponse`.
  - Офферы: `PartnerOfferBase` (`payout_amount`, `price_override` — оба `Decimal`), `PartnerOfferCreate`, `PartnerOfferBulkCreate` (bulk по `service_ids` 1-200), `PartnerOfferUpdate`, `PartnerOfferResponse` (+ денормализованные `service_name/code/category`, `service_original_price`, `category_name`).
- **Зависимости:** только `pydantic`/`uuid`/`datetime`/`decimal`. Pydantic v2 (`ConfigDict`).
- **Где менять для типовых задач:**
  - Добавить поле оффера — `PartnerOfferBase` (наследуется create/response) и при необходимости `PartnerOfferUpdate`/`PartnerOfferBulkCreate`.
  - Лимит bulk-создания — `service_ids` `max_length=200` (строка 48).
  - Денормализованные поля для UI заполняет РОУТЕР при сериализации (строки 69-74).
- **Подводные камни:**
  - **Эталон работы с деньгами:** `Decimal` с `max_digits=10, decimal_places=2` и `ge=0` — правильный паттерн, в отличие от `bonus.py`/`manager.py`, где `float`. При новых денежных полях в проекте ориентироваться на этот файл.
  - **`tenant_id` присутствует в Response** (`PartnerCategoryResponse`, `PartnerOfferResponse`) — tenant-скоупленные сущности; фильтрацию по `tenant_id` обеспечивает роутер/сервис, схема лишь отдаёт его клиенту.
- **Строк:** 75

## `backend/app/schemas/referral.py`

- **Назначение:** DTO направлений (рефералов): создание, тело отмены, полный ответ (с QR/SLA/денормализацией клиник и услуг) и запрос сканирования QR.
- **Ключевые элементы:** `ReferralCreate` (поддержка трёх типов: `service`/`doctor`/`lab`), `CancelRequestBody`, `ReferralResponse` (большой DTO: статусы, QR-коды, `short_code`, SLA-поля `sla_days`/`sla_deadline`, денормализованные имена клиник/услуги, `bonus_amount`), `QRScanRequest`.
- **Зависимости:** енум `app.models.referral.ReferralStatus`.
- **Где менять для типовых задач:**
  - Добавить тип направления — поле `referral_type` (строка 17, сейчас строка `service|doctor|lab`, НЕ Enum) + связанные поля (`target_doctor_id`, `lab_tests`); валидация типа — на стороне роутера/сервиса.
  - Новое поле в ответе направления — `ReferralResponse` (строки 23-58).
  - Логику SLA — поля `sla_days`/`sla_deadline` заполняются как `created_at + service.sla_days` (комментарий строка 53); расчёт — в роутере/сервисе.
- **Подводные камни:**
  - `referral_type` — свободная строка с дефолтом `"service"`, не Enum → опечатки не отловятся на уровне схемы.
  - `service_id` опционален в `ReferralCreate`, но обязателен для `type=service` (комментарий строка 8) — это инвариант проверяет роутер, не схема.
  - `from_clinic_id` — «только для менеджера» (комментарий строка 14); обычный реферер не должен его задавать (проверка прав — в роутере).
  - **`bonus_amount: float`** — деньги как float (потеря точности; см. общую заметку среза).
  - Много денормализованных опциональных полей (`*_name`, `qr_code`, `patient_url`) — заполняются роутером, не приходят из ORM напрямую.
- **Строк:** 62

## `backend/app/schemas/user.py`

- **Назначение:** DTO пользователя: частичное обновление профиля (self-service) и полный ответ с вычисляемым флагом суперадмина.
- **Ключевые элементы:** `UserUpdate` (full_name/phone_number/date_of_birth — БЕЗ clinic_id, см. ниже), `UserResponse` (профиль + `avatar_url`, `password_must_change`, вычисляемый `is_superadmin` через `@model_validator(mode='after')`). Модульная константа `SUPERADMIN_USERNAME` (env, дефолт `khamzat`).
- **Зависимости:** енум `app.models.user.UserRole`; `os` (для env). Pydantic v2 (`model_validator`).
- **Где менять для типовых задач:**
  - Добавить поле в ответ профиля — `UserResponse` (строки 15-35).
  - Изменить логику суперадмина — `set_superadmin` валидатор (строки 37-42) и env `SUPERADMIN_USERNAME`.
  - Разрешить пользователю менять новое поле — `UserUpdate`; **НЕ добавлять туда `clinic_id`** (см. ниже).
- **Подводные камни:**
  - **Безопасность (privilege escalation):** `clinic_id` сознательно УБРАН из `UserUpdate` (комментарий строка 13) — через `PATCH /admins/me` пользователь мог бы переназначить себе клинику. Смена клиники — только через менеджерский `/admins/{id}/assign-clinic`. НЕ возвращать поле обратно.
  - `is_superadmin` вычисляется на каждом ответе сравнением `username == SUPERADMIN_USERNAME` — захардкоженный (через env) механизм, не флаг в БД.
  - `date_of_birth` — `str`, не `date`.
  - `telegram_id` — строка (Telegram-id как строка).
- **Строк:** 46

---

### Сквозные наблюдения по срезу

- **Деньги/Decimal:** `partner_offer.py` — единственный файл, корректно использующий `Decimal`. `bonus.py`, `manager.py`, `referral.py`, `daily_digest_job.py` (в выводе) отдают деньги как `float` — потеря точности при сериализации; не использовать для повторных вычислений. Джобы `ads_attribution_job.py` и `inventory_alerts.py` правильно держат `Decimal` внутри расчётов.
- **Дубли:** `ClinicResponse` и `CreateClinicRequest` существуют и в `clinic.py`, и в `manager.py` с разными полями (`mis_id` есть только в `clinic.py`) — риск рассинхрона при правках клиники.
- **Идемпотентность джобов:** большинство защищено дедупом (`alert_service.notify_admin(dedup_key=...)` в digest/disk/marketplace) либо проверкой существующих записей (ads-атрибуция); исключение — `inventory_alerts` (зовёт приватный `_send_telegram` без дедупа).
- **Pydantic v1 vs v2:** часть файлов на новом стиле (`model_config = ConfigDict(...)`, `field_validator`, `model_validator`), часть на легаси `class Config: from_attributes = True` (`bonus.py`, `clinic.py`, `manager.py`, `referral.py`) — несогласованность стиля.
- **Платформа джобов:** `disk_check_job.py` POSIX-only (`os.statvfs`, бинарь `du`) — рассчитан на контейнер, не на локальный Windows-dev.
