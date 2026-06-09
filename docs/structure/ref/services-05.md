# services [05] — LTV-аналитика, интеграция с МИС Renovatio, онбординг франшиз и AI-чат пациента

Это пятый срез сервисного слоя `backend/app/services` МИС-платформы «КлиникСеть» (мульти-тенантная SaaS для сети клиник). Группа неоднородная, но почти все файлы вращаются вокруг **внешней МИС Renovatio** и **денежно/маркетинговой аналитики поверх неё**:

- **LTV-блок** (`ltv_service`, `ltv_export_service`) — тянет визиты/оплаты пациентов из Renovatio, считает GrossLTV/NetLTV, риск оттока, когорты; рендерит PDF/Excel-отчёты.
- **МИС-интеграция** (`mis_client`, `mis_resolver`, `mis_sync_service`, `mis_payments_sync`, `mis_webhook_sender`, `patient_identifier`) — низкоуровневый HTTP-клиент Renovatio, резолвер кредов клиника→тенант, импорт справочников (клиники/врачи/услуги), синк платежей в кассу/ledger, исходящие вебхуки о подписках, авто-привязка пациента к МИС.
- **Мониторинг и онбординг** (`module_health_service`, `onboarding_service`) — health-checks платных модулей с Telegram-алертами, и публичный self-service wizard регистрации новой франшизы.
- **Пациентский UX** (`patient_chat_ai`, `patient_session_service`) — AI-ассистент чата клиники и long-lived сессии пациента в ЛК.
- **Инфраструктура** (`manager_notifier`, `pii_sync`) — Telegram-уведомления менеджерам и прозрачное шифрование PII через SQLAlchemy-события.
- **Легаси-заглушка** (`loyalty_service`) — практически пустой файл (только константы), реальная логика лояльности живёт в роутерах/моделях.

Сквозные риски среза: повсеместный `tenant_id`-фильтр (изоляция франшиз — несколько методов раньше «протекали» cross-tenant и переписаны на per-tenant), аккуратная работа с `Decimal` в деньгах, best-effort внешние вызовы (Telegram/webhook/SMTP/МИС никогда не валят основной flow), и зависимость NetLTV/синка платежей от закрытого доступа к Renovatio `getPayments`.

## Оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `loyalty_service.py` | Заглушка лояльности: только константы баллов/тиров | 19 |
| `ltv_export_service.py` | Генерация PDF/Excel-отчётов LTV (WeasyPrint, openpyxl) | 637 |
| `ltv_service.py` | Расчёт LTV/NetLTV/когорт из визитов МИС | 579 |
| `manager_notifier.py` | Telegram-уведомления менеджерам клиники/тенанта | 192 |
| `mis_client.py` | Низкоуровневый HTTP-клиент Renovatio API | 352 |
| `mis_payments_sync.py` | Импорт платежей МИС в кассу/ledger | 277 |
| `mis_resolver.py` | Резолв МИС-кредов клиника→тенант | 46 |
| `mis_sync_service.py` | Импорт клиник/врачей/услуг из МИС | 376 |
| `mis_webhook_sender.py` | Исходящие вебхуки внешним МИС о подписках | 217 |
| `module_health_service.py` | Health-checks платных модулей + алерты | 890 |
| `onboarding_service.py` | Публичный wizard регистрации франшизы (OTP) | 608 |
| `patient_chat_ai.py` | AI-ассистент чата клиники для пациента | 476 |
| `patient_identifier.py` | Авто-привязка пациента к МИС при чате | 238 |
| `patient_session_service.py` | Long-lived сессии пациента в ЛК | 109 |
| `pii_sync.py` | Авто-шифрование PII через SQLAlchemy-события | 83 |

---

## `backend/app/services/loyalty_service.py`
- **Назначение:** Должен был быть сервисом программы лояльности (1 балл = 100 ₽, тиры bronze/silver/gold/platinum, append-only транзакции). Фактически — **почти пустой файл-заглушка**: импорты моделей `LoyaltyAccount/LoyaltyTransaction/LoyaltyTier` и две константы, без единой функции.
- **Ключевые элементы:** `RUB_PER_POINT = Decimal("100")`, `TIER_ORDER = ["bronze","silver","gold","platinum"]`. Импортирует `normalize_phone`. Никаких функций/классов.
- **Зависимости:** `app.models.loyalty` (LoyaltyAccount, LoyaltyTransaction, LoyaltyTier), `app.utils.phone.normalize_phone`. Здоровье модуля `loyalty_pro` проверяется отдельно в `module_health_service.check_loyalty_pro` (он сам читает `LoyaltyAccount`, этот сервис не использует).
- **Где менять для типовых задач:** если потребуется реальный движок начисления/списания баллов и переходов по тирам — логика должна появиться **здесь** (начисление по `RUB_PER_POINT`, проверка порогов из docstring: silver=20000, gold=80000, platinum=200000). Сейчас её просто нет — ищите фактическую логику лояльности в роутерах (`app/routers/...loyalty...`) или прямо в моделях.
- **Подводные камни:** **ЛЕГАСИ/мёртвый стаб.** Импорт `desc` из sqlalchemy не используется. Декларированные правила (тиры, append-only) нигде в этом файле не реализованы — не полагайтесь на этот модуль как на источник истины по лояльности. Деньги корректно объявлены как `Decimal`, но это единственное, что здесь есть.
- **Строк:** 19

---

## `backend/app/services/ltv_export_service.py`
- **Назначение:** Генерирует выгрузки LTV-отчёта в **PDF** (WeasyPrint + Jinja2-шаблон `templates/ltv_report.html` с самописными SVG-диаграммами) и **Excel** (openpyxl, 3 листа: Сводка / Топ пациентов / Когорты). Питается теми же снапшотами `PatientLtvSnapshot`, что и REST-эндпоинты `/analytics/ltv/*`.
- **Ключевые элементы:**
  - `generate_ltv_pdf(db, tenant, clinic_id, period, years) -> bytes` — рендер HTML→PDF.
  - `generate_ltv_excel(db, tenant, clinic_id, years) -> bytes` — XLSX-байты.
  - `_collect_ltv_data(...)` — общий сбор (summary, patients, cohorts) для обоих форматов.
  - SVG-чарты без matplotlib: `_bar_chart_svg` (когорты), `_pie_chart_svg` (распределение churn-риска).
  - Форматтеры: `_fmt_rub`, `_fmt_rub_zero_ok`, `_fmt_int`, `_fmt_pct`, `_fmt_date_ru`, `_years_label_ru` (русское склонение «лет/года/год»), `_scale` (масштабирование LTV под горизонт).
  - Модульный Jinja2-`_jinja_env` с `FileSystemLoader` на `../templates`.
- **Зависимости:** `app.models.ltv.PatientLtvSnapshot`, `app.models.clinic.Clinic`, `app.models.tenant.Tenant`, **`app.services.ltv_service.compute_cohorts`** (для когорт). Ленивые импорты `weasyprint.HTML` и `openpyxl` внутри функций (тяжёлые зависимости). Используется роутером аналитики (`GET /analytics/ltv/export/pdf|xlsx`).
- **Где менять для типовых задач:**
  - Поменять состав/формат отчёта → правьте `_collect_ltv_data` (данные) + `templates/ltv_report.html` (вёрстка PDF) / секции «Сводка/Топ/Когорты» в `generate_ltv_excel`.
  - Добавить колонку в Excel → правьте `headers_p`/`widths_p` (или `headers_c`) и соответствующий список `cells`.
  - Новый горизонт LTV / другая база масштабирования → `_BASE_LTV_HORIZON_YEARS` и `_scale`.
  - Цвета/диаграммы → `_bar_chart_svg`/`_pie_chart_svg` (цвета `#06b6d4`, `#10b981/#f59e0b/#ef4444`).
- **Подводные камни:**
  - **Масштабирование LTV — ключевая тонкость.** Снапшоты в БД рассчитаны под горизонт **3 года** (`_BASE_LTV_HORIZON_YEARS`); параметр `years` (1..10) пересчитывает значения коэффициентом `years/3` через `_scale`. Если изменить горизонт расчёта в `ltv_service`, **надо синхронно поправить базу в `_scale`**, иначе двойное искажение.
  - `tenant_id`-фильтр обязателен во всех выборках summary/patients/at_risk — он есть, но `clinic_id` опционален.
  - Топ-пациентов берётся только с `visits_count >= 2` (top-50) — пустой отчёт при единичных визитах это нормально, выводится плашка «запустите пересчёт».
  - `_scale`/форматтеры конвертируют `Decimal`→`float` для отображения — это осознанно (только вывод), но не используйте результат для дальнейших денежных расчётов.
  - `_collect_ltv_data` делает много отдельных `await db.execute` (N+1 по churn-бакетам) — для отчёта приемлемо, но не зовите в горячем пути.
- **Строк:** 637

---

## `backend/app/services/ltv_service.py`
- **Назначение:** Ядро LTV-аналитики (модуль `ltv_pro`). Пуллит визиты и оплаты пациентов из Renovatio, агрегирует по нормализованному телефону, считает GrossLTV (по выручке) и NetLTV (по фактическим оплатам), риск оттока, когорты; делает upsert в `PatientLtvSnapshot`. Запускается cron-задачей `run_ltv_job` (ежедневно 04:00 UTC) и ручным `POST /analytics/ltv/recompute`.
- **Ключевые элементы:**
  - `VisitRecord` (dataclass) — нормализованный визит (phone, name, sum, services, date, is_first, mis_clinic_id, total_paid).
  - `MISAdapter` (Protocol), `ManualAdapter` (пустой список), `RenovatioAdapter` (обёртка над `mis_client.get_appointments`/`get_payments`, чанкинг по 90 дней, параллельный fetch платежей, эвристики разбора сумм/телефонов).
  - `compute_ltv_for_clinic(db, tenant, clinic_id, days=730) -> dict` — главный пересчёт + upsert (SELECT→UPDATE/INSERT).
  - `compute_cohorts(db, tenant_id, period) -> list[dict]` — агрегация снапшотов в когорты (используется и `ltv_export_service`).
  - Хелперы: `_pick_adapter`, `_aggregate_visits`, `_Aggregated` (dataclass), `_quarter_label`, `_churn_risk_for`.
  - Константы: `LTV_HORIZON_YEARS=Decimal("3")`, `CHURN_LOW_MAX=90`, `CHURN_MEDIUM_MAX=180`.
- **Зависимости:** **`app.services.mis_client`** (get_appointments, get_payments), **`app.services.settings_service.get_setting`** (mis_api_url/mis_api_key per-tenant), `app.utils.phone.normalize_phone`, модели `Clinic`, `Tenant`, `PatientLtvSnapshot`, `commercial` (импортирован, но ModuleStatus/TenantModuleSubscription тут не используются — лишний импорт). Потребители: `ltv_export_service`, роутеры аналитики, cron.
- **Где менять для типовых задач:**
  - Формула LTV → `compute_ltv_for_clinic` (`ltv_estimate = avg_check * visits_per_year * LTV_HORIZON_YEARS`); NetLTV — там же по `avg_paid`.
  - Пороги churn → `CHURN_LOW_MAX`/`CHURN_MEDIUM_MAX` + `_churn_risk_for`.
  - Разбор ответа Renovatio (поля сумм/телефонов/статусов) → статические методы `RenovatioAdapter._calc_visit_sum`, `_payment_amount`, `_payment_phone_or_pid`, `_appt_phone`, фильтр «completed».
  - Размер окна опроса / чанка → `days` (default 730) и `CHUNK_DAYS=90`.
  - Добавить новый источник МИС → новый класс по `MISAdapter` + ветка в `_pick_adapter`.
- **Подводные камни:**
  - **NetLTV зависит от закрытого `getPayments`.** Пока Renovatio не открыл доступ — `total_paid=0 → net_ltv=0` (UI рисует «—»). Это штатная Gross-only деградация, не баг.
  - **Распределение оплаты — эвристика.** `getPayments` отдаёт агрегат по пациенту, `getAppointments` — отдельные визиты; оплата делится **поровну** на визиты (`patient_total_paid / visits_n`). После открытия доступа структуру надо перепроверить (поля выбираются «наугад» из вероятных ключей).
  - **Renovatio падает с 500 на окне > ~3 месяцев** — отсюда обязательный чанкинг по 90 дней, последовательно, чтобы не убить их API.
  - **Upsert вручную (SELECT→UPDATE/INSERT), а не ON CONFLICT** — потому что `clinic_id` может быть NULL (для МИС-клиник без нашей записи), а обычный unique-constraint с NULL не работает. Возможна гонка при параллельных пересчётах одного тенанта — запускать строго по одному.
  - Деньги — `Decimal` с `.quantize(Decimal("0.01"))` повсюду; `visits_per_year` нормализуется к году по реальному окну (или по `days` при единичном визите).
  - Строгий per-tenant: `tenant.mis_clinic_ids` ограничивает опрашиваемые МИС-клиники, креды берутся из настроек тенанта.
- **Строк:** 579

---

## `backend/app/services/manager_notifier.py`
- **Назначение:** Telegram-уведомления **менеджерам/владельцам конкретной клиники или тенанта** (в отличие от `alert_service`, который шлёт глобальному админу платформы). Получатели динамические — User'ы с подходящей ролью и заполненным `telegram_id`. Best-effort: никогда не роняет основной flow.
- **Ключевые элементы:**
  - `send_telegram_to_managers(db, *, tenant_id, clinic_id, text) -> int` — рассылка менеджерам клиники/тенанта.
  - `send_telegram_to_user_ids(db, *, user_ids, text) -> int` — адресная отправка по списку user_id (например, review-flow подписочной заявки).
  - `_find_recipients(...)` — выборка User'ов (роль ∈ `MANAGER_ROLES`, `is_active`, `telegram_id IS NOT NULL`; учитывает `ManagerClinicAccess` для multi-clinic).
  - `_send_one(...)` — один POST `sendMessage` через прокси.
  - `_telegram_token()`, `_proxy_url()`. `MANAGER_ROLES = (MANAGER, FRANCHISE_OWNER, REG, SUPER_ADMIN)`.
- **Зависимости:** `app.config.settings` (admin_bot_token / telegram_bot_token), `app.models.user` (User, UserRole), `app.models.manager_clinic_access.ManagerClinicAccess`, `httpx`. Вызывается из flow «Подробнее о тарифе» / «заявка на подписку».
- **Где менять для типовых задач:**
  - Кто получает уведомления → `MANAGER_ROLES` и/или логика `_find_recipients`.
  - Прокси/токен Telegram → `_proxy_url` (env `TELEGRAM_PROXY_URL`, дефолт `144.31.89.167:8080`) и `_telegram_token`.
  - Формат сообщения — задаёт caller через `text` (отправляется с `parse_mode=HTML`).
- **Подводные камни:**
  - **Прокси обязателен:** `api.telegram.org` заблокирован у провайдера, идём через HTTP-прокси с захардкоженными кредами в дефолте `_proxy_url` (`clinikabot:...@144.31.89.167:8080`) — это секрет в коде, при ротации править здесь + env.
  - Все методы обёрнуты в широкий `try/except` и возвращают `0` при любой ошибке — Telegram-сбой намеренно невидим для вызывающего кода.
  - `REG` (регистратор) намеренно включён в менеджерские роли (в маленьких клиниках reg = менеджер) — учитывайте при изменении прав.
  - Фильтр клиники: `User.clinic_id == clinic_id` ИЛИ запись в `manager_clinic_access`; при наличии и `tenant_id`, и `clinic_id` добавляется доп. фильтр по тенанту.
- **Строк:** 192

---

## `backend/app/services/mis_client.py`
- **Назначение:** Низкоуровневый HTTP-клиент **МИС Renovatio** (`POST /api/public/<METHOD>` + `api_key` в form-body). Базовый транспорт с retry, обработкой SSL и 403-«No access», плюс типизированные обёртки методов (пациенты, приёмы, услуги, клиники, оплаты/счета/программы/звонки).
- **Ключевые элементы:**
  - Транспорт: `_post(method, api_url, api_key, ssl_verify, **params)`, `_post_with_retry` (tenacity: 3 попытки, exp-backoff), `_get_base` (нормализация URL → `.../api/public`), `_ssl_context` (CA-cert / verify), `_is_no_access` (детект 403).
  - Методы: `test_connection`, `get_services`, `find_patient_by_phone`, `add_patient`, `get_appointments`, `get_clinics`.
  - **Расширенные методы NetLTV-аналитики** (`ltv_pro`): `get_payments`, `get_invoices`, `get_programs`, `get_patient_programs`, `get_calls` — на момент написания все возвращают 403 «No access», поэтому отдают `[]` + warning (грациозная деградация).
  - Константа `DEFAULT_MIS_BASE = "https://mis.stoclinic.ru:3010/api/public"`.
- **Зависимости:** `app.config.settings` (mis_api_key, mis_ssl_verify, mis_ca_cert_path), `httpx`, `tenacity`, `app.utils.phone.normalize_phone` (ленивый импорт). **Потребляется почти всем МИС-блоком:** `ltv_service`, `mis_sync_service` (через `_post`), `mis_payments_sync` (через `get_payments`), `patient_identifier` (через `find_patient_by_phone`/`add_patient`).
- **Где менять для типовых задач:**
  - Новый метод Renovatio → добавьте async-обёртку по образцу `get_payments` (try/except → `_is_no_access` → `error==0`).
  - Базовый URL по умолчанию → `DEFAULT_MIS_BASE` (но per-tenant URL приходит параметром `api_url`).
  - Поведение SSL/CA → `_ssl_context` (env/настройка `MIS_CA_CERT_PATH`, `MIS_SSL_VERIFY`).
  - Политика retry → декоратор `@retry` на `_post_with_retry`.
- **Подводные камни:**
  - **Cross-tenant утечка устранена:** глобальной константы `MIS_CLINIC_IDS` больше нет (в конце файла удалены `get_patient_visits`/`get_patient_analyses` — у них был cross-tenant fallback). Список clinic_id живёт в `Tenant.mis_clinic_ids`; caller обязан передавать `api_url`/`api_key` тенанта — **не полагайтесь на дефолтный `settings.mis_api_key`** в мульти-тенант коде.
  - SSL: при `MIS_SSL_VERIFY=false` без CA — MITM-риск, warning логируется один раз за процесс (`_SSL_WARN_LOGGED`).
  - 403 «No access» отличается от прочих ошибок через `_is_no_access` (проверяет `data.code == "403"`) — пять «премиум»-методов специально возвращают `[]`, чтобы LTV не падал.
  - `add_patient` парсит ФИО грубо (1-е слово = фамилия и т.д.) и сам глотает исключения → `None`; HTTP-статус наружу не пробрасывается (важно для `patient_identifier`).
- **Строк:** 352

---

## `backend/app/services/mis_payments_sync.py`
- **Назначение:** Синхронизация фактических платежей пациентов из МИС в нашу **кассу (CashShift) и ledger**. Идемпотентно по `MisPaymentImport`. Cash → запись в открытую кассовую смену клиники; card/transfer/other → пока только дедуп-запись (без ledger-проводки, см. ниже). Запуск: APScheduler каждые 10 мин (`sync_all_tenants_job`) + ручной `POST /accountant/cash/sync-mis-payments`.
- **Ключевые элементы:**
  - `sync_tenant_payments(db, tenant, *, date_from, date_to) -> dict` — синк одного тенанта, возвращает статистику (fetched / imported_cash|card|other / skipped_dup|no_shift / errors).
  - `sync_all_tenants_job() -> int` — APScheduler-обход всех активных тенантов (создаёт свою сессию через `AsyncSessionLocal`).
  - Хелперы: `_to_decimal`, `_parse_method` (cash/card/transfer/other по ключевым словам RU+EN), `_parse_paid_at` (множество форматов дат), `_get_open_shift`, `_already_imported`.
  - Константы: `SHIFT_CATEGORY_SALE="sale"`, `LEDGER_OP_CARD`, `LEDGER_OP_OTHER`.
- **Зависимости:** **`app.services.mis_client.get_payments`**, `app.database.AsyncSessionLocal`, модели `CashShift`/`CashShiftEntry`/`CashShiftStatus`, `Clinic`, `commercial.TenantIntegration` (креды), `LedgerEntry`, `MisPaymentImport`, `Tenant`.
- **Где менять для типовых задач:**
  - Маппинг способа оплаты → `_parse_method` (ключевые слова).
  - Что делать с card-платежами → ветка `elif method in ("card","transfer","other")` (см. подводный камень: ledger-проводка сейчас НЕ создаётся).
  - Период по умолчанию → в `sync_tenant_payments` (дефолт = сегодня).
  - Источник кредов МИС → `TenantIntegration` (type='mis', is_active) — `base_url`/`api_key`.
- **Подводные камни:**
  - **Card/transfer/other НЕ пишутся в ledger** — `LedgerEntry.user_id` NOT NULL, а пациента-владельца тут нет; поэтому для безналичных создаётся только `MisPaymentImport`, а бухгалтер видит суммы в реестре `/accountant/payments` напрямую от МИС. Если решите завести ledger-проводку — нужно ввести системного «patient placeholder» user_id.
  - **Cash без открытой смены пропускается БЕЗ дедуп-записи** (`skipped_no_shift`) — намеренно, чтобы платёж «догнался» при следующем синке после открытия смены. Не добавляйте сюда `MisPaymentImport`, иначе платёж потеряется.
  - Идемпотентность — по паре `(mis_clinic_id, mis_payment_id)`; `mis_pay_id` извлекается из `payment_id`/`id`, пустой → пропуск.
  - Деньги — `Decimal`; `amount <= 0` отбрасывается.
  - Жёсткий per-tenant: маппинг `mis_id → Clinic.id` строится в пределах тенанта; платёж по неизвестной МИС-клинике пропускается с warning.
  - Поля платежа (`amount`/`value`/`sum`, `method`/`payment_method`/`type`, даты) разбираются эвристически — реальная структура `getPayments` неизвестна (метод 403).
- **Строк:** 277

---

## `backend/app/services/mis_resolver.py`
- **Назначение:** Единая точка получения МИС-кредов с фолбэком **клиника → тенант**. Раньше `mis_api_url`/`mis_api_key` брались только из настроек тенанта; теперь сначала смотрим поля `Clinic`, при пустоте — добираем из tenant-настроек.
- **Ключевые элементы:** `resolve_mis_creds(db, *, clinic_id=None, tenant_id=None) -> tuple[str, str, str]` — возвращает `(api_url, api_key, mis_type)`. Дефолт `mis_type='renovatio'`, пустые строки если нигде не задано.
- **Зависимости:** `app.models.clinic.Clinic`, **`app.services.settings_service.get_setting`** (ключи `mis_api_url`, `mis_api_key` per-tenant). Используется везде, где раньше напрямую читались tenant-настройки МИС.
- **Где менять для типовых задач:**
  - Добавить новое МИС-поле (например, второй ключ) → расширьте кортеж и логику фолбэка здесь.
  - Изменить приоритет (клиника vs тенант) → блок «Fallback на tenant settings».
- **Подводные камни:**
  - Если `clinic_id` задан, но `tenant_id` нет — он подтягивается из `clinic.tenant_id` (важно для корректного `get_setting`).
  - Fallback срабатывает покомпонентно: можно получить `api_url` из клиники, а `api_key` — из тенанта.
  - **NB:** часть МИС-блока (`ltv_service`, `mis_sync_service`) до сих пор читает `get_setting` напрямую, а не через этот резолвер — при унификации кредов проверьте, что все точки переведены на `resolve_mis_creds`.
- **Строк:** 46

---

## `backend/app/services/mis_sync_service.py`
- **Назначение:** Импорт справочников из МИС Renovatio в нашу БД: **клиники, врачи, услуги**, плюс получение пациента/истории визитов и **polling авто-подтверждения направлений** (`Referral`). Используется мастером настройки интеграции и cron-polling'ом.
- **Ключевые элементы:**
  - Клиники: `get_mis_clinics`, `sync_clinic` (upsert по `mis_id`), `sync_clinics_bulk`.
  - Врачи: `get_mis_users`, `sync_doctors_bulk` (фильтр role='doctor', привязка к Clinic по `default_clinic` mis_id).
  - Услуги: `get_mis_services`, `sync_services_bulk` (импорт в выбранные клиники, апдейт цены по `mis_id + clinic_id`).
  - Пациент: `get_patient_from_mis`, `get_patient_appointments_from_mis`.
  - `poll_and_confirm_referrals(db) -> dict` — per-tenant polling completed-приёмов за 2 часа, авто-подтверждение направления по телефону.
- **Зависимости:** **`app.services.mis_client._post`** (использует приватную функцию напрямую — без api_url/api_key в части методов!), модели `Clinic`/`Doctor`/`Service`/`Referral`/`Tenant`, `app.core.tenant.get_current_tenant` (импортирован, но в polling используется явный обход тенантов), `app.services.settings_service.get_setting`, `app.utils.phone` (normalize_phone, phone_variants).
- **Где менять для типовых задач:**
  - Маппинг полей МИС→наша модель → соответствующая `sync_*` функция (например, поля услуги в `sync_services_bulk`).
  - Логика выбора врачей (что считать доктором) → фильтр в `sync_doctors_bulk` (`"doctor" in role_names`, `not is_deleted`).
  - Окно/частота polling направлений → `poll_and_confirm_referrals` (последние 2 часа).
- **Подводные камни:**
  - **Несогласованность с per-tenant кредами:** `get_mis_clinics`/`get_mis_users`/`get_mis_services`/`get_patient_*` зовут `_post(...)` **без `api_url`/`api_key`** → используют дефолтный `settings.mis_api_key`. Для мульти-тенант это потенциальная утечка/неверный ключ — при вызове из bulk-функций креды передаются дальше как параметры, но во вложенные `get_mis_*` не всегда. Проверяйте, что caller прокидывает креды.
  - `poll_and_confirm_referrals` **переписан на per-tenant** (комментарий в коде): убран захардкоженный список `[1,4,26,3,24]` и глобальный ключ — теперь итерируется по `Tenant.mis_clinic_ids` со своим ключом. Изоляция франшиз — критична, не возвращайте глобальный список.
  - `sync_clinic` ищет существующую клинику по `mis_id` **без фильтра tenant_id** — теоретически может «прицепиться» к чужой клинике с тем же mis_id; tenant_id присваивается только при создании. Учитывайте при мульти-тенант импорте.
  - Цены услуг здесь — `float` (`original_price`), а не Decimal (легаси модели Service).
  - `get_patient_appointments_from_mis` тянет окно −12 мес..+90 дн и сортирует по `time_start` desc.
- **Строк:** 376

---

## `backend/app/services/mis_webhook_sender.py`
- **Назначение:** Исходящие **вебхуки внешним МИС** о событиях подписки (`subscription.activated|cancelled|renewed|test`). Best-effort с retry (1s/5s/30s), логирует ошибки в `TenantMisSubscriptionWebhook.last_error`. Никогда не ломает основной flow активации/отмены подписки.
- **Ключевые элементы:**
  - `send_mis_webhook(db, *, tenant_id, event_type, payload, blocking=False) -> list[dict]` — рассылка всем активным интеграциям тенанта; первая попытка синхронно, retry в фоне (или весь цикл синхронно при `blocking=True`).
  - `send_mis_webhook_safe(...)` — тихая обёртка, ловит ВСЕ исключения (точки активации/отмены подписки).
  - `test_webhook(db, *, hook) -> dict` — тестовая отправка (кнопка Test в UI).
  - Внутренние: `_jsonify` (UUID/datetime → str), `_attempt_post`, `_deliver_one` (retry + обновление статусов hook), `_build_payload`.
  - Константы `RETRY_DELAYS=(1.0,5.0,30.0)`, `HTTP_TIMEOUT=10.0`.
- **Зависимости:** `app.models.tenant_mis_subscription_webhook.TenantMisSubscriptionWebhook`, `httpx`. Вызывается из subscription-сервиса (активация/отмена).
- **Где менять для типовых задач:**
  - Новый тип события → добавить вызов `send_mis_webhook_safe(event_type="subscription.X", ...)` в точке домена + (опц.) фильтр в `hook.events`.
  - Формат тела вебхука → `_build_payload` (`{event, occurred_at, data}`).
  - Политика ретраев → `RETRY_DELAYS` / `HTTP_TIMEOUT`.
  - Авторизация исходящего вебхука → `hook.auth_header` (кладётся в `Authorization`).
- **Подводные камни:**
  - **`blocking=False` всё равно делает первую попытку синхронно** (а не полностью в фоне, как может показаться) — на медленном внешнем endpoint первая попытка добавляет задержку к запросу пользователя. Для полностью неблокирующего поведения нужен fire-and-forget на уровне caller.
  - `_deliver_one` мутирует поля `hook` (last_success_at/last_error/retry_count), но **commit делает caller** — не забудьте закоммитить, иначе статусы потеряются.
  - Фильтрация по подписке на событие: если `hook.events` пуст — шлём все события; если задан и `event_type` не в списке — пропускаем.
  - `send_mis_webhook_safe` тихо выходит при `tenant_id is None` — проверяйте, что тенант известен.
- **Строк:** 217

---

## `backend/app/services/module_health_service.py`
- **Назначение:** **Мониторинг здоровья платных модулей** (telemedicine, ads, inventory, loyalty_pro, mis_sync, sms_marketing, телефония, AI-аналитика, fiscal, ltv_pro, white_label, webhooks, health_apple/google и др.). На каждый модуль — адаптер-функция, возвращающая `{status, message, metrics}`; результаты пишутся в `ModuleHealthCheck`; при переходе в error/degraded — Telegram-алерт админу (дедуп 1 час). Cron каждые 30 минут.
- **Ключевые элементы:**
  - ~24 адаптера `check_<module>(db, tenant_id) -> dict` (плюс общие `_check_ads_common`, `_check_ai_common`).
  - Реестр `_ADAPTERS: dict[str, AdapterFn]` (ключ модуля → функция) и `list_known_module_keys()`.
  - Конструкторы статусов: `_ok`, `_idle`, `_degraded`, `_error`, `_unknown`; `_cutoff(days)`.
  - `send_alert(...)` — Telegram-алерт через `alert_service.notify_admin` с дедупом.
  - `_upsert_result(...)` — апсерт чека + триггер алерта при смене статуса.
  - Оркестраторы: `run_health_checks_for_tenant`, `run_health_checks_all_tenants` (cron), читалки `get_modules_health_for_tenant`, `get_modules_health_all_tenants` (heatmap для super_admin).
  - Константы `IDLE_THRESHOLD_DAYS=7`, `ALERT_COOLDOWN_HOURS=1`.
- **Зависимости:** `app.models.commercial` (ModuleStatus, TenantModuleSubscription), `app.models.module_health` (ModuleHealthCheck, ModuleHealthStatus), `app.models.tenant.Tenant`, **`app.services.alert_service.notify_admin`** (ленивый импорт). Адаптеры **лениво** импортируют доменные модели (telemedicine, advertising, inventory, loyalty, sms_marketing, presence, call_recording, ai_*, payments_clinic, ltv, tenant, patient_vital, webhook) — модуль не должен ломаться, если какая-то модель отсутствует.
- **Где менять для типовых задач:**
  - **Добавить мониторинг нового модуля → 2 шага:** написать `async def check_<key>(db, tenant_id)` (по образцу: try/except внутри, возврат через `_ok/_idle/_degraded/_error`) и зарегистрировать в `_ADAPTERS`.
  - Порог idle / cooldown алертов → `IDLE_THRESHOLD_DAYS` / `ALERT_COOLDOWN_HOURS`.
  - Что считать degraded vs error для модуля → внутри конкретного `check_*`.
  - Текст/формат Telegram-алерта → `send_alert`.
- **Подводные камни:**
  - **Адаптер НЕ должен падать наружу:** вся логика в `try/except` → `status=error`. При добавлении нового адаптера соблюдайте этот контракт, иначе один модуль уронит весь обход тенанта.
  - Различайте семантику: **0 событий ≠ ошибка** → это `idle` (информационно), реальное исключение → `error`, предупреждение/низкий success-rate → `degraded`.
  - Все выборки строго по `tenant_id` (изоляция) — при копировании адаптера не забудьте `.where(... .tenant_id == tenant_id)`.
  - Алерт триггерится только при **смене** статуса (prev != new) и не чаще раза в час на пару (tenant, module).
  - Проверяются только подписки в статусах ACTIVE/TRIAL/GRACE; модуль без адаптера → `unknown` (не алертится).
  - `check_inventory` корректно работает с `Decimal` для остатков/порогов — не сводите к float.
- **Строк:** 890

---

## `backend/app/services/onboarding_service.py`
- **Назначение:** **Публичный self-service wizard регистрации новой франшизы** (Глава 2). Двухфазная регистрация: создание драфта + email-OTP → верификация → одной транзакцией создаётся вся иерархия `Franchise → Tenant → User(franchise_owner) → Clinics → модули`, отправляется welcome-письмо с кредами. Без авторизации (rate-limit и резерв slug'ов критичны).
- **Ключевые элементы:**
  - `validate_slug(db, slug) -> {available, reason?}` — проверка в реальном времени (regex, RESERVED_SLUGS, уникальность в tenants + активных драфтах).
  - `create_signup_request(...)` → драфт + OTP; `verify_otp(...)` (лимит 5 попыток, TTL 30 мин); `resend_otp(...)`.
  - `complete_onboarding(db, request_id) -> dict` — финальное создание всей иерархии в одной транзакции (+ trial-подписка, лимиты плана, модули в TRIAL).
  - Email: `send_otp_email`, `send_welcome_email` (Jinja2 `welcome_franchise.html`).
  - `trial_status_for(tenant, plan) -> dict` — статус триала для /me / TrialBanner (none/active/expiring_soon/expired).
  - Хелперы slug: `_ensure_unique_franchise_slug`, `_unique_franchise_slug`, `_generate_password`, `generate_otp`, `_normalize_email/_slug`.
  - Константы: `RESERVED_SLUGS`, `SLUG_RE` (`^[a-z0-9-]{3,20}$`), `MAX_OTP_ATTEMPTS=5`, `TRIAL_DAYS=14`, `PLANS={trial,starter,pro}`.
- **Зависимости:** модели `SignupRequest`, `Tenant`/`TenantLicense`/`TenantBranding`, `Franchise`, `User`/`UserRole`, `Clinic`, `billing.Subscription`/`SubStatus`, `commercial.CommercialModule`/`TenantModuleSubscription`/`ModuleStatus`; `app.core.security.hash_password`; **`app.services.email_service`** (send_email, is_smtp_configured). Отличается от `tenant_onboarding_service.onboard_tenant` (тот — для super_admin вручную).
- **Где менять для типовых задач:**
  - Шаги/лимиты плана (max_clinics/max_users) → словарь `plan_limits` в `complete_onboarding`.
  - Зарезервированные имена → `RESERVED_SLUGS`; правила формата → `SLUG_RE`.
  - Длительность/политика триала → `TRIAL_DAYS`, `trial_status_for`.
  - Состав welcome-письма → `welcome_franchise.html` + `send_welcome_email`.
  - Стартовый статус модулей → блок «6. Активация модулей» (сейчас все стартуют в `ModuleStatus.TRIAL`).
- **Подводные камни:**
  - **Полностью транзакционно:** при любой ошибке в `complete_onboarding` — `rollback`, заявка помечается `failed` с причиной; welcome-email шлётся **после** commit, его сбой не валит регистрацию.
  - **Гонки по slug** обрабатываются на нескольких уровнях: `validate_slug` при create + прямая проверка `tenants` при complete (намеренно НЕ зовут `validate_slug` в complete — она забракует собственный verified-драфт).
  - **Dev-режим без SMTP:** `send_otp_email`/`send_welcome_email` пишут код/креды в лог (`[SIGNUP-OTP-DEV]`, `[WELCOME-FRANCHISE-DEV]`) и возвращают False — удобно для локального теста, но **секреты в логах** на проде недопустимы (следите за SMTP).
  - `username = email` (с суффиксом `.slug` при коллизии) — email служит логином.
  - **Несостыковка комментариев:** docstring блока модулей упоминает «pro → ACTIVE», но фактически переменная `sub_status` всегда `ModuleStatus.TRIAL` (ветка по плану не реализована) — все модули стартуют в TRIAL.
  - `_unique_franchise_slug` — sync-стаб, реальную уникальность даёт async `_ensure_unique_franchise_slug` (в коде сначала присваивается стаб, потом перезаписывается async-версией).
  - Время триала считается в UTC (`timezone.utc`), `trial_status_for` нормализует naive datetime к UTC.
- **Строк:** 608

---

## `backend/app/services/patient_chat_ai.py`
- **Назначение:** AI-логика чата пациента с клиникой (вариант D). Собирает системный промпт с контекстом тенанта (название, часы, услуги, врачи, FAQ), детектит handoff («AI не знает» → перевод на оператора), и через каскад **база знаний → Redis-кэш → LLM** генерирует ответ с дневным лимитом.
- **Ключевые элементы:**
  - `chat_with_ai(db, chat, user_text) -> dict` — главная функция (возвращает answer/handoff/limit_exceeded/ai_unavailable/source).
  - `build_system_prompt(db, tenant_id)`, `_gather_clinic_context`, `_format_context_block`.
  - `should_handoff(answer)` + `HANDOFF_PHRASES` (эвристика по фразам).
  - Redis-кэш: `_get_redis`, `_cache_key` (md5), `_cache_get`, `_cache_set`.
  - Лимит: `_ensure_daily_reset`, `_last_messages_for_context`.
  - Константы: `DAILY_AI_LIMIT=20`, `CONTEXT_MESSAGES_LIMIT=10`, `CACHE_TTL_SEC=86400`, `CACHE_PREFIX="pchat:"`.
- **Зависимости:** модели `patient_chat` (PatientChat, PatientChatMessage, PatientChatMode, PatientChatSender), `tenant`/`clinic`/`clinic_schedule`/`service`/`doctor` (ленивые импорты в контексте); **`app.services.ai_knowledge_service.find_match`** (FAQ-поиск ДО LLM); **`app.routers.ai`** (`_load_config`, `_openai_call`, `_get_provider_settings`); `app.services.settings_service.get_setting` (chat_faq); `redis.asyncio`. Сохранение сообщений в БД делает caller (роутер), не этот сервис.
- **Где менять для типовых задач:**
  - Правила/тон/длину ответа AI → текст `rules` в `build_system_prompt`.
  - Что попадает в контекст модели → `_gather_clinic_context` (услуги/врачи/расписание) + `_format_context_block` (топ-30/50, обрезка FAQ до 4000).
  - Когда переключать на оператора → `HANDOFF_PHRASES` / `should_handoff`.
  - Дневной лимит / кэш → `DAILY_AI_LIMIT`, `CACHE_TTL_SEC`, условия кэширования в конце `chat_with_ai`.
- **Подводные камни:**
  - **Архитектурная связь сервис→роутер:** AI-вызов берётся из `app.routers.ai` (`_openai_call` и т.д.) — необычное направление зависимости (сервис импортирует роутер). Если рефакторите AI-конфиг, не сломайте этот импорт.
  - **Каскад экономии токенов:** FAQ-`find_match` (порог 0.5) и Redis-кэш проверяются ДО LLM и **не расходуют** дневной лимит; лимит инкрементится только при реальном LLM-ответе.
  - Кэшируются только короткие (≤300 симв вопрос, ≤1500 ответ) success-ответы без handoff; ключ кэша включает `tenant_id` (изоляция).
  - Redis-сбой не критичен (везде try/except → None/пропуск).
  - Дневной счётчик сбрасывается по `ai_messages_reset_date` через `_ensure_daily_reset` — но **сам объект chat должен быть закоммичен caller'ом** (сервис только мутирует `chat.ai_messages_today`).
  - Контекст собирается по `tenant_id` (все клиники тенанта), цены услуг приводятся к `float` только для текста промпта.
- **Строк:** 476

---

## `backend/app/services/patient_identifier.py`
- **Назначение:** (chatslot01) Автоматическая идентификация/привязка пациента к МИС при первом сообщении в thread. Вызывается хуком в `send_message` (router `patient_chat_threads`). Маппит результат в `PatientAccount.mis_sync_state`; ошибки кладёт в `mis_outbox` для retry. Никогда не бросает исключения.
- **Ключевые элементы:**
  - `identify_patient(session, *, patient_account_id) -> str` — главный поток: дубликаты телефона → поиск в МИС → создание в МИС; возвращает финальный state.
  - `_enqueue_outbox(session, *, event_type, payload, error)` — событие в `MisOutbox` с `next_retry_at = now + 1 мин`.
  - Терминальные state'ы: `linked`, `created`, `no_phone`, `ambiguous`, `manual_required`, `error`.
- **Зависимости:** **`app.services.mis_client`** (как `mis`: `find_patient_by_phone`, `add_patient`), модели `PatientAccount`, `MisOutbox`, `httpx` (для отлова `HTTPStatusError`).
- **Где менять для типовых задач:**
  - Логика state-machine (когда linked/created/manual/ambiguous) → ветки в `identify_patient`.
  - Политика retry/backoff outbox → `_enqueue_outbox` (стартовый `+1 минута`; дальше backoff делает worker).
  - Маппинг HTTP-статусов → state → блоки `except httpx.HTTPStatusError` (4xx → manual_required, 5xx/сеть → error+outbox).
- **Подводные камни:**
  - **HTTP-статус из `mis_client` не виден этому слою:** `find_patient_by_phone`/`add_patient` внутри сами глотают исключения и возвращают `None` → код **консервативно** трактует `None` как `error` + outbox-retry, а `manual_required` зарезервирован под будущую версию `mis_client`, которая начнёт пробрасывать `HTTPStatusError`. Блоки `except httpx.HTTPStatusError` сейчас почти не срабатывают (но оставлены на будущее).
  - **Идемпотентность:** если `mis_patient_id` уже задан — сразу выход (возврат текущего state).
  - **Дубликаты телефона** (>1 PatientAccount с тем же phone) → `ambiguous`, автоматика отключается — нужен ручной разбор регистратором.
  - `patient_id` из ответа МИС берётся как `patient_id` или `id`; нечисловой формат → `manual_required`.
  - Только `flush`, не `commit` — транзакцией управляет caller (router).
  - **NB:** docstring ссылается на путь `/opt/clinika/backend/...` — это прод-путь, не зависимость на код.
- **Строк:** 238

---

## `backend/app/services/patient_session_service.py`
- **Назначение:** Создание/восстановление **long-lived сессии пациента** (TTL 365 дней) для авто-входа в ЛК `/p` после установки PWA-ярлыка. Попутно бампит активность `PatientAccount` (login_count/last_seen_at) для дашборда «Пациенты ЛК».
- **Ключевые элементы:**
  - `create_session(db, phone, tenant_id, device_info) -> (PatientSession, token)` — новая сессия + JWT-подобный токен.
  - `restore_session(db, session_token) -> PatientSession | None` — декод токена, проверка (revoked/phone/expiry), продление.
  - `revoke_session(db, session_id)`.
  - `_bump_patient_account_activity(db, phone_n)` — best-effort инкремент статистики.
  - Константа `SESSION_TTL_DAYS=365`.
- **Зависимости:** модели `PatientSession`, `PatientAccount`; **`app.core.security`** (`make_patient_session_token`, `decode_patient_session_token`, `hash_session_secret`); `app.utils.phone.normalize_phone`.
- **Где менять для типовых задач:**
  - Срок жизни сессии → `SESSION_TTL_DAYS`.
  - Формат/подпись токена → `app.core.security.make_patient_session_token`/`decode_*` (не здесь).
  - Что считать «активностью» пациента → `_bump_patient_account_activity`.
- **Подводные камни:**
  - **Телефон везде нормализуется** (`normalize_phone`) — сравнение в `restore_session` идёт по нормализованным значениям, иначе сессия не восстановится. При любых правках сравнения phone сохраняйте нормализацию.
  - **Refresh-секрет хранится только хэшем** (`hash_session_secret`), сам секрет — в токене на клиенте.
  - `_bump_patient_account_activity` обёрнут в try/except — статистика **никогда** не должна ронять логин; если PatientAccount по phone нет — тихо игнор (создаст другая ветка onboarding).
  - `restore_session` продлевает `expires_at` на каждый успешный restore (скользящее окно 365 дней).
  - Только `flush`, commit — на caller'е.
- **Строк:** 109

---

## `backend/app/services/pii_sync.py`
- **Назначение:** **PII shadow-sync** — SQLAlchemy event-listeners, автоматически заполняющие колонки `*_encrypted` и `*_hash` при INSERT/UPDATE моделей с персональными данными (телефоны, email, ФИО). Подключается один раз на старте приложения.
- **Ключевые элементы:**
  - `install_pii_sync()` — вешает `before_insert`/`before_update` на 7 моделей.
  - `_MAP` — карта моделей → списки `(src_attr, enc_attr, hash_attr, hash_type)`: User, PatientAccount, PatientOTP, SignupRequest, ContactRequest, Appointment, Doctor.
  - Внутренние: `_sync` (шифрует/хэширует или зануляет при пустом значении), `make_handler` (замыкание, фиксирующее mapping на класс).
- **Зависимости:** **`app.services.encryption_service`** (`encrypt`, `hash_phone`, `hash_email`, `hash_text`); модели `User`, `PatientAccount`, `PatientOTP`, `SignupRequest`, `ContactRequest`, `Appointment` (из `doctor`), `Doctor`. Вызывается из `app/database.py` или `main.py` при инициализации.
- **Где менять для типовых задач:**
  - **Добавить новое PII-поле/модель → правьте `_MAP`** (строка `(src, enc_col, hash_col, hash_type)`) и добавьте класс в словарь `CLASSES` внутри `install_pii_sync`. Убедитесь, что у модели есть колонки `*_encrypted`/`*_hash` (миграция).
  - Алгоритм шифрования/хэша → `app.services.encryption_service` (не здесь).
- **Подводные камни:**
  - **Замыкание `make_handler(mapping)`** — критично: фиксирует свой mapping на каждый класс, иначе все слушатели использовали бы mapping последнего класса (классическая ловушка late-binding в циклах). Не «упрощайте» в лямбду без отдельной функции.
  - Пустые значения (`None`/`''`) → колонки `*_encrypted`/`*_hash` зануляются (а не шифруют пустую строку) — важно для поиска по hash.
  - **Поиск по PII идёт по `*_hash`** (детерминированный hash телефона/email), отображение — через расшифровку `*_encrypted`. При изменении соли/алгоритма в `encryption_service` все существующие хэши инвалидируются.
  - Слушатели срабатывают на ORM-flush (`before_insert/before_update`) — **bulk-update в обход ORM (Core `update()`) не триггерит** заполнение зашифрованных колонок; для массовых апдейтов PII нужна отдельная обработка.
  - `install_pii_sync()` идемпотентным не является явно — вызывать строго один раз при старте.
- **Строк:** 83

---

### Сквозные наблюдения по срезу
- **Per-tenant изоляция — главный инвариант:** несколько методов МИС-блока в прошлом «протекали» cross-tenant (глобальный `MIS_CLINIC_IDS`, захардкоженный список клиник в polling) и были переписаны на `Tenant.mis_clinic_ids` + per-tenant креды. При любой работе с МИС всегда передавайте `api_url`/`api_key` тенанта и фильтруйте по `tenant_id`.
- **Деньги — строго `Decimal`** в LTV и платежах (с `.quantize(0.01)`); `float` допускается только для отображения (отчёты, текст промпта) и в легаси-модели `Service.original_price`.
- **Внешние эффекты — best-effort:** Telegram (`manager_notifier`), webhook (`mis_webhook_sender`), SMTP (`onboarding_service`), МИС (`patient_identifier`, `ltv_service`) никогда не валят основной flow — ошибки логируются/уходят в outbox.
- **NetLTV и синк платежей заблокированы внешним доступом:** Renovatio `getPayments`/`getInvoices`/… отдают 403 «No access» → Gross-only деградация; разбор полей этих методов — эвристический и подлежит ревизии после открытия доступа.
- **`loyalty_service.py` — мёртвая заглушка** (только константы), реальной логики лояльности в сервисном слое нет.
