# services [04] — ОФД/фискализация, биллинг и аналитика франшизы, склад FIFO, лояльность и лабы

Этот срез из 15 файлов слоя `backend/app/services` объединяет **доменную бизнес-логику** (без HTTP-роутинга) трёх крупных контуров проекта clinika:

1. **Фискализация по 54-ФЗ** — реестр и адаптеры ОФД-провайдеров плюс фасад pull-а чеков (`fiscal/registry.py`, `fiscal/takskom_adapter.py`, `fiscal_service.py`).
2. **Франшиза / сеть клиник** — биллинг платформы за бонусы и выставление счетов сети, gap-анализ непродданных модулей, консолидированный P&L, матрица «перелива» пациентов, межклиничные счета, KPI-дашборд (`franchise_billing_service.py`, `franchise_module_gaps_service.py`, `franchise_pnl_service.py`, `franchise_referral_service.py`, `inter_clinic_invoice_service.py`, `kpi_service.py`).
3. **Операционные сервисы** — AI-ассистент пациенту, GeoIP, FIFO-списание со склада, лабораторные интеграции, append-only финансовый реестр, расширенная лояльность (`gemini_service.py`, `geoip_service.py`, `inventory_fifo.py`, `lab_service.py`, `ledger_service.py`, `loyalty_ext_service.py`).

Общее у всех файлов: это **чистый сервисный слой** — функции принимают `AsyncSession` извне и НЕ коммитят (за исключением явно отмеченных «cron»/`pull`-функций, которые делают `await db.commit()` сами). Роутеры из других срезов вызывают эти функции. Все деньги хранятся в `Decimal`, на выход в JSON приводятся к `float`. Эскалации/уведомления/внешние API обёрнуты в `try/except`, чтобы не ронять основную транзакцию.

## Оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `fiscal/registry.py` | Реестр ОФД-провайдеров name→класс | 34 |
| `fiscal/takskom_adapter.py` | Адаптер Такском ОФД (заглушка) | 27 |
| `fiscal_service.py` | Фасад pull чеков из ОФД | 114 |
| `franchise_billing_service.py` | Fee платформы за бонусы, счета сети | 252 |
| `franchise_module_gaps_service.py` | Непродданные модули по клиникам сети | 169 |
| `franchise_pnl_service.py` | Консолидированный P&L франшизы | 447 |
| `franchise_referral_service.py` | Матрица перелива пациентов в сети | 189 |
| `gemini_service.py` | AI-ассистент пациенту (proxyapi/Gemini) | 226 |
| `geoip_service.py` | Lookup IP→гео, кеш в Redis | 185 |
| `inter_clinic_invoice_service.py` | Жизненный цикл межклиничных счетов | 248 |
| `inventory_fifo.py` | FIFO-списание со склада по партиям | 275 |
| `kpi_service.py` | KPI-дашборд франшизы с кешем | 473 |
| `lab_service.py` | Лабораторные интеграции (фейк + webhook) | 176 |
| `ledger_service.py` | Append-only финансовый реестр баланса | 122 |
| `loyalty_ext_service.py` | Расширенная лояльность: тиры, бонусы | 361 |

---

## `backend/app/services/fiscal/registry.py`
- **Назначение:** Простая карта `name → класс ОФД-провайдера`. Аналог `acquiring/registry.py`. Модульный синглтон-словарь `_PROVIDERS`.
- **Ключевые элементы:** `register_provider(name, cls)`, `get_provider(name, config) -> BaseOfdProvider` (бросает `KeyError` если не зарегистрирован), `list_registered() -> list[str]`. Глобаль `_PROVIDERS: dict[str, Type[BaseOfdProvider]]`.
- **Эндпоинты:** нет (не роутер).
- **Зависимости:** `app.services.fiscal.base.BaseOfdProvider`. Регистрация фактических провайдеров происходит НЕ здесь, а в `fiscal/__init__.py` (там же импортируются и `register_provider`-ятся 4 адаптера: `platforma_ofd`, `perv_ofd`, `takskom`, `atol_online`).
- **Где менять для типовых задач:** чтобы добавить НОВОГО ОФД-провайдера — создай адаптер рядом (`*_adapter.py`, наследник `BaseOfdProvider`) и допиши `register_provider("name", Cls)` в `fiscal/__init__.py`, не в этом файле. Сам реестр трогать почти не нужно.
- **Подводные камни:** `get_provider` бросает `KeyError`, а не `LookupError` — вызывающий (`fiscal_service.pull_clinic_receipts`) этого не ловит отдельно, упадёт в общий `except` крона. `config` типизирован `# noqa: ANN001` как `OFDConfig`.
- **Строк:** 34

## `backend/app/services/fiscal/takskom_adapter.py`
- **Назначение:** Адаптер ОФД «Такском». Сейчас это **заглушка** — оба метода бросают `NotImplementedError` с подсказкой, какой эндпоинт реализовать.
- **Ключевые элементы:** класс `TakskomProvider(BaseOfdProvider)`, `name = "takskom"`. Методы `pull_receipts(since)` и `verify_inn(inn)` → `NotImplementedError`.
- **Эндпоинты:** нет.
- **Зависимости:** `app.services.fiscal.base.BaseOfdProvider`, `FiscalReceiptData`.
- **Где менять для типовых задач:** чтобы оживить Такском — реализуй `pull_receipts`: `POST /API/v2/Login` (логин+пароль из `self.config`) → `GET /API/v2/Documents?from=...`, маппинг ответа в список `FiscalReceiptData` (поля inn/operation_type/total_sum/qr_code/fiscal_doc_number/fiscal_storage_number/fiscal_sign/receipt_at/raw_payload). База URL `https://api-online.taxcom.ru/API/`.
- **Подводные камни:** ЛЕГАСИ/ЗАГЛУШКА — пока возвращает `NotImplementedError`. Крон `cron_pull_all_receipts` ловит `NotImplementedError` отдельно и просто логирует info, так что заглушка безопасна. Остальные 3 адаптера (platforma/perv/atol) — аналогичные заглушки в том же пакете.
- **Строк:** 27

## `backend/app/services/fiscal_service.py`
- **Назначение:** Фасад над ОФД-провайдерами: тянет (pull) чеки из ОФД и сохраняет их в БД как `FiscalReceipt` с идемпотентностью. Есть одиночный pull и крон по всем активным конфигам.
- **Ключевые элементы:** `pull_clinic_receipts(db, *, clinic_id, since=None) -> dict` (возвращает `{ofd, fetched, saved, skipped}`; бросает `LookupError` если нет `OFDConfig`); `cron_pull_all_receipts(db) -> dict` (`{clinics_processed, total_saved, errors}`). Логгер `fiscal_service`.
- **Эндпоинты:** нет (вызывается роутером/планировщиком из другого среза).
- **Зависимости:** `app.models.payments_clinic.FiscalReceipt`, `OFDConfig`; `app.services.fiscal.get_provider`.
- **Где менять для типовых задач:** изменить логику дедупликации чеков — блок `existing = ...` по `(clinic_id, fiscal_doc_number, fiscal_storage_number)`. Изменить окно по умолчанию (сейчас `last_pulled_at` или `now - 7 дней`) — строка `since = cfg.last_pulled_at or ...`. Маппинг полей `FiscalReceiptData → FiscalReceipt` — в `db.add(FiscalReceipt(...))`.
- **Подводные камни:** **tenant_id берётся из cfg** (`tenant_id=cfg.tenant_id`), а фильтр поиска — по `clinic_id`; убедись что `OFDConfig` всегда несёт корректный tenant. `pull_clinic_receipts` САМ делает `await db.commit()` (не append-only-стиль). Идемпотентность работает ТОЛЬКО если у чека заполнены и ФД, и ФН — иначе чек сохранится возможным дублем. Крон глотает любые `Exception` в `errors[]`, а `NotImplementedError` (заглушки адаптеров) — отдельно в info.
- **Строк:** 114

## `backend/app/services/franchise_billing_service.py`
- **Назначение:** Биллинг платформы с франшиз. Записывает в `billing_ledger` комиссию (fee) платформы за каждый выплаченный бонус и периодически выставляет франшизе счёт `FranchiseInvoice` за накопленные fee.
- **Ключевые элементы:**
  - `record_platform_fee_for_bonus(db, bonus, direction="charge")` — пишет одну `BillingLedger`-запись `platform_fee_per_bonus` (charge: `+fee`, refund: `-fee` только если `franchise.refund_fee_on_cancel`). Делает `flush`, не commit.
  - `_next_invoice_number(db)` — генератор номера `FR-YYYY-NNNN`.
  - `generate_invoice_for_franchise(db, franchise, period_end=None)` — суммирует fee за период по всем тенантам франшизы, создаёт `FranchiseInvoice` (PENDING, due +14 дней), обновляет `last_invoice_at`, шлёт алерт. Возвращает `None` если за период не было fee.
  - `run_invoice_job(db)` — крон: по активным франшизам выставляет счета тем, у кого истёк `billing_period_days`.
  - `list_invoices_for_franchise(db, franchise_id)`, `get_pending_total(db, franchise_id)` — для UI.
- **Эндпоинты:** нет.
- **Зависимости:** модели `Franchise`, `Tenant`, `Bonus`/`BonusStatus`, `FranchiseInvoice`/`InvoiceStatus`, `BillingLedger`; ленивый импорт `app.services.alert_service.notify_franchise_invoice`.
- **Где менять для типовых задач:** ставка fee — поле `franchise.platform_fee_per_bonus` (читается тут, строка `fee = Decimal(...)`). Период биллинга — `franchise.billing_period_days`. Формат номера — `_next_invoice_number`. Срок оплаты — `due_date=period_end + timedelta(days=14)`.
- **Подводные камни:** **fee считается в `Decimal`**, но `entry.amount` пишется со знаком (`sign * fee`), а уведомление шлёт `float(inv.total_amount)`. `_next_invoice_number` использует глобальный счётчик по году БЕЗ блокировки → при гонке возможны коллизии номеров. `generate_invoice_for_franchise` САМ коммитит (и в пустой ветке тоже — чтобы не дублировать период). Алерт обёрнут в `except: pass` (graceful). Поиск тенантов — по `franchise_id` без явного tenant-скоупа (правильно — это межтенантный платформенный сервис).
- **Строк:** 252

## `backend/app/services/franchise_module_gaps_service.py`
- **Назначение:** Gap-анализ модулей в РАЗРЕЗЕ КЛИНИК: для каждой клиники сети показывает, какие коммерческие модули НЕ подключены, и оценивает упущенную выручку. (Отличается от роутера `franchise_module_gaps.py`, который группирует наоборот «модуль → сколько тенантов без него».)
- **Ключевые элементы:** `_get_franchise(db, tenant_id)`, `_avg_price(grants, fallback)` (средняя `internal_price_rub > 0`, иначе каталожная `price_monthly`), `compute_gaps(db, tenant_id) -> list[dict]` (по клиникам, сортировка по `potential_revenue` desc), `compute_summary(db, tenant_id) -> dict` (агрегаты + топ-5 дефицитных модулей).
- **Эндпоинты:** нет.
- **Зависимости:** модели `Franchise`, `Tenant`, `Clinic`, `CommercialModule`, `FranchiseModuleGrant`. «Подключённость» = `FranchiseModuleGrant.is_active=True`.
- **Где менять для типовых задач:** логику цены для оценки — `_avg_price`. Что считается «подключённым» — `active_pairs = {(g.tenant_id, g.module_key) for g in grants if g.is_active}`. Какие модули учитываются — фильтр `CommercialModule.is_active.is_(True)`.
- **Подводные камни:** N+1: для каждого тенанта отдельный запрос первой `Clinic`. `potential_revenue` суммируется уже как `float` (в `compute_summary` — `0.0` старт), внутри `compute_gaps` — `Decimal`, на выход `float`. Скоуп — вся сеть через `franchise_id`; если у переданного `tenant_id` нет франшизы, возвращает `[]`.
- **Строк:** 169

## `backend/app/services/franchise_pnl_service.py`
- **Назначение:** Консолидированный отчёт P&L (доходы/расходы/прибыль) по всей сети одной франшизы. Считается on-the-fly из существующих агрегатов, без новых таблиц. Разбивка по клиникам и по месяцам.
- **Ключевые элементы:**
  - `compute_pnl(db, tenant_id, period_start, period_end, tax_rate=0.06, include_by_month=False, months=12)` — главная функция, возвращает большой dict (revenue + revenue_breakdown + revenue_by_clinic + cogs/cogs_source + gross_margin + taxes + platform_fee + net_income + [by_month]).
  - `resolve_period(period, from_, to)` — `current_month`/`last_month`/`ytd`/`custom` → `(start, end, label)`.
  - Приватные сборщики: `_revenue_appointments` (Appointment.price, COMPLETED), `_revenue_clinic_payments` (ClinicPayment SUCCEEDED), `_revenue_inter_clinic` (InterClinicInvoice PAID, исходящие), `_revenue_partner_offers` (Referral.bonus_snapshot_amount, completed), `_cogs_spendings` (Spending по категориям rent/lab/materials/utilities/other, возвращает `(сумма, is_stub)`), `_platform_fee` (FranchiseInvoice PAID), `_revenue_by_clinic`, `_by_month`, `_month_bounds`, `_list_tenants`, `_d` (безопасный cast в Decimal).
  - Константа `DEFAULT_TAX_RATE = Decimal("0.06")` (УСН Доходы).
- **Эндпоинты:** нет.
- **Зависимости:** модели `Franchise`, `Tenant`, `Clinic`, `Appointment`/`AppointmentStatus`, `Spending`, `InterClinicInvoice`/`ICIStatus`, `FranchiseInvoice`/`InvoiceStatus`, `Referral`; **защищённый импорт** `ClinicPayment`/`ClinicPaymentStatus` (флаг `HAS_CLINIC_PAYMENT` — модуль может отсутствовать в старых билдах).
- **Где менять для типовых задач:** добавить источник выручки — новая `_revenue_*` функция + включить её в `revenue = appt+pay+ici+po` (и в `_by_month`, и в `_revenue_by_clinic`). Изменить состав COGS — список `cogs_categories`. Ставка налога — параметр `tax_rate`. Формула прибыли — `net_income = gross_margin - taxes - platform_fee`. Новый период — ветка в `resolve_period`.
- **Подводные камни:** ОЧЕНЬ много запросов: `_revenue_by_clinic` и `_by_month` зовут 4 revenue-функции в цикле по тенантам/месяцам → на большой сети тяжело (потенциальная оптимизация). Все суммы — `Decimal`, налог `quantize(0.01)`, на выход `float`. `is_stub` COGS определяется по «есть ли вообще хоть один Spending у тенантов» (доп. `count`-запрос) — это ставит `cogs_source: "stub"` и плашку в UI. `_list_tenants`: если у `tenant_id` есть `franchise_id` — берётся ВСЯ сеть, иначе только сам тенант. `platform_fee` берётся по `franchise_id` ПЕРВОГО тенанта.
- **Строк:** 447

## `backend/app/services/franchise_referral_service.py`
- **Назначение:** «Перелив пациентов» — матрица направлений (cross-clinic referrals) между клиниками одной сети за период, с доходом по каждой паре `(from, to)`.
- **Ключевые элементы:** `compute_matrix(db, tenant_id, period_start, period_end) -> dict` (`tenants`, `matrix`, `totals` с топ-5, период), `compute_top(..., limit=10)`, `compute_summary(...)` (только агрегаты). Хелперы `_d`, `_list_tenants`, `_clinic_name`.
- **Эндпоинты:** нет.
- **Зависимости:** модели `Franchise`, `Tenant`, `Clinic`, `Referral`. Источник — `Referral.cross_clinic_status='completed'` + `bonus_snapshot_amount`, группировка по `(referred_by_tenant_id, target_tenant_id)`.
- **Где менять для типовых задач:** что считается «переливом» — фильтр `cross_clinic_status == "completed"` и условие «обе стороны в сети» (`referred_by_tenant_id.in_(tenant_ids) AND target_tenant_id.in_(tenant_ids)`). Доход пары — `func.sum(Referral.bonus_snapshot_amount)`.
- **Подводные камни:** `compute_top`/`compute_summary` ВНУТРИ зовут полный `compute_matrix` (повторный тяжёлый запрос — нет переиспользования результата). `_clinic_name` — N+1 по тенантам. Группировка только на уровне tenant_id, хотя в payload поля называются `from_clinic_id`/`to_clinic_id` — фактически туда кладётся **tenant_id** (см. `"from_clinic_id": str(from_id)` где `from_id` = `referred_by_tenant_id`) — потенциально вводящее в заблуждение именование. Суммы `Decimal → float`.
- **Строк:** 189

## `backend/app/services/gemini_service.py`
- **Назначение:** AI-ассистент пациенту. Несмотря на имя «gemini», ПРИОРИТЕТ — OpenAI `gpt-4o-mini` через `proxyapi.ru`; Gemini direct — только fallback. При любой ошибке/отсутствии ключа возвращает заглушку с `escalate=True` (переключение на живого менеджера).
- **Ключевые элементы:** `chat_completion(messages, system, model="gemini-2.5-flash", max_tokens=600) -> dict` (поля `text/escalate/tokens_in/tokens_out/latency_ms/model`); хелперы `_detect_escalation(text)` (маркер `[ESCALATE]` или handoff-фразы), `_strip_marker(text)`. Константы `API_BASE`, `ESCALATE_MARKER`, `HANDOFF_PHRASES`.
- **Эндпоинты:** нет.
- **Зависимости:** `httpx`, `app.config.settings` (`gemini_api_key`). Env: `PROXYAPI_API_KEY` (приоритетный путь), `GEMINI_API_KEY`, `GEMINI_PROXY_URL` (опц. HTTPS-прокси для обхода блокировок в ЧР).
- **Где менять для типовых задач:** сменить провайдера/модель — блок `proxyapi_key` (маппинг `gemini-* → gpt-4o-mini`, URL `https://api.proxyapi.ru/openai/v1/chat/completions`). Эвристику эскалации — `HANDOFF_PHRASES` / `_detect_escalation`. Температуру/лимиты — `temperature: 0.4`, `max_tokens`.
- **Подводные камни:** **НАЗВАНИЕ ВВОДИТ В ЗАБЛУЖДЕНИЕ** — основной рабочий путь это OpenAI через proxyapi, Gemini — fallback (легаси-имя файла/функции сохранено). Эскалация определяется простым поиском подстрок в ответе модели (`"не знаю"` и т.п.) — ложные срабатывания возможны. Все ошибки сети глотаются в заглушку (никогда не бросает). Прокси по умолчанию выключен (DEV).
- **Строк:** 226

## `backend/app/services/geoip_service.py`
- **Назначение:** Lookup IP → `{country, country_name, region, city, lat, lon}` по локальной mmdb-базе (GeoLite2/dbip). Reader ленивый с авто-перезагрузкой по mtime; результат кешируется в Redis на 24ч (включая негативный кеш). Никогда не ломает основной поток — при ошибке `None`.
- **Ключевые элементы:** `async lookup(ip) -> dict|None` (главная), `reset_reader()` (сброс после обновления базы), приватные `_get_reader()`, `_is_lookupable(ip)` (отсев приватных/localhost IP), `_lookup_sync(ip)` (синхронный через `run_in_executor`). Глобали `_reader`, `_reader_init_failed`, `_reader_mtime`. Константы `GEOIP_DB_PATH` (env), `CACHE_TTL_SECONDS`.
- **Эндпоинты:** нет.
- **Зависимости:** `geoip2.database` (ленивый импорт), Redis-клиент берётся из `app.utils.metrics._get_redis`. Env `GEOIP_DB_PATH` (default `/app/data/GeoLite2-City.mmdb`).
- **Где менять для типовых задач:** путь к базе — `GEOIP_DB_PATH`. Отсев IP — `_is_lookupable`. TTL кеша — `CACHE_TTL_SECONDS`. Состав возвращаемых полей — конец `_lookup_sync`. Предпочтение языка имён — `_ru_or_en` (сейчас `ru` → `en`).
- **Подводные камни:** Reader — модульный синглтон с флагом `_reader_init_failed` (если файла нет — больше не лезет на диск). Авто-перезагрузка по mtime только при последующих вызовах. Всё в `try/except` с `pass` — отладка молчаливая. Негативный кеш хранится как пустая строка `""` в Redis. Синхронный geoip2 уводится в executor, чтобы не блокировать event loop.
- **Строк:** 185

## `backend/app/services/inter_clinic_invoice_service.py`
- **Назначение:** Жизненный цикл межклиничных счетов (`InterClinicInvoice`): создание, переходы статусов (draft → pending_approval → approved → paid / rejected / cancelled), списки для разных ролей, авто-создание счёта из подтверждённого направления.
- **Ключевые элементы:**
  - `create_inter_clinic_invoice(db, *, ...)` — создаёт счёт (статус SENT если `auto_send` иначе DRAFT), номер `IC-YYYY-NNNNN`. `flush`, не commit.
  - Переходы: `mark_sent` (DRAFT→PENDING_APPROVAL), `mark_approved` (снэпшот ФИО/роли согласующего), `mark_rejected`, `mark_paid` (требует APPROVED, legacy SENT/DRAFT допускаются), `mark_cancelled`.
  - Списки: `list_incoming` (recipient), `list_outgoing` (issuer), `list_all_for_tenant` (issuer OR recipient — для руководителя), `list_all_platform` (super_admin).
  - `auto_create_from_referral(db, *, ...)` — issuer=from_clinic (получает бонус), recipient=to_clinic (платит); тип `REFERRAL_BONUS`.
  - `_next_ici_number(db)`.
- **Эндпоинты:** нет.
- **Зависимости:** модель `InterClinicInvoice`, енумы `ICIStatus`, `ICIType`.
- **Где менять для типовых задач:** workflow согласования — функции `mark_*` (допустимые исходные статусы перечислены в каждом `if inv.status in (...)`). Срок оплаты по умолчанию — `due_date or (today + 30 дней)`. Логика авто-счёта из реферала — `auto_create_from_referral` (направление денег: отправитель пациента получает бонус). Формат номера — `_next_ici_number`.
- **Подводные камни:** `amount` приходит как `float`, внутри приводится `Decimal(str(amount))` — корректно. `_next_ici_number` — глобальный счётчик по году БЕЗ блокировки (гонка номеров). Функции списков **скоупятся по tenant_id** (incoming/outgoing/all_for_tenant), а `list_all_platform` — без tenant-скоупа (только для super_admin!). Legacy-статусы `SENT`/`DRAFT` явно допускаются в `mark_paid`/`mark_approved` ради обратной совместимости со старыми данными — учитывай при ужесточении workflow. Все mark-функции делают `flush`, коммит — на вызывающем.
- **Строк:** 248

## `backend/app/services/inventory_fifo.py`
- **Назначение:** FIFO-списание материалов со склада по партиям с учётом срока годности. Используется при завершении приёма (авто-списание), ручном write-off из партии (брак/потеря) и реверсе при откате приёма.
- **Ключевые элементы:**
  - `writeoff_fifo(db, *, tenant_id, item_id, clinic_id, quantity, ..., allow_negative=False) -> list[dict]` — списывает по партиям в порядке `expires_at ASC NULLS LAST, received_at ASC`, создаёт `InventoryMovement` на каждую партию, обновляет `qty_remaining` и кеш `InventoryStock`.
  - `writeoff_from_batch(db, *, batch_id, quantity, ...)` — списание из КОНКРЕТНОЙ партии.
  - `reverse_writeoff(db, *, appointment_id, tenant_id) -> int` — восстановление при откате completed→in_progress (создаёт INCOME-движения).
  - `class InsufficientStockError(Exception)` (несёт `item_id/requested/available`).
- **Эндпоинты:** нет.
- **Зависимости:** модели `InventoryBatch`, `InventoryMovement`, `InventoryMovementType`, `InventoryStock`.
- **Где менять для типовых задач:** порядок выбора партий — `order_by(expires_at.asc().nullslast(), received_at.asc())`. Поведение при нехватке — флаг `allow_negative` + `InsufficientStockError`. Тип движения — параметр `movement_type` (default `WRITE_OFF`). Связка с приёмом — `appointment_id` + `ref_entity_type`.
- **Подводные камни:** **Декимал-дисциплина строгая** — `quantity = Decimal(str(quantity))`, балансы суммируются с `Decimal("0")` стартом (нет `sum()` пустого генератора-бага). Запросы партий используют `.with_for_update()` (блокировка строк) — функции должны вызываться внутри транзакции. **Двойной учёт остатков**: есть и `InventoryBatch.qty_remaining`, и кеш `InventoryStock.quantity` (хранится по `batch_number`); FIFO трогает несколько партий, поэтому кеш уменьшается эвристически «по убыванию quantity» — рассинхрон возможен, это известная тонкость. `reverse_writeoff` восстанавливает qty в строку stock с максимальным остатком. Все функции делают `flush`/`add`, коммит — на вызывающем.
- **Строк:** 275

## `backend/app/services/kpi_service.py`
- **Назначение:** KPI-дашборд франшизы (Глава 3 ROADMAP): множество агрегатов за период с дельтой к предыдущему окну (revenue/appointments/patients/referrals/bonuses/LTV/tenants/MRR и т.д.). Кеш в Redis 5 минут.
- **Ключевые элементы:**
  - `get_kpi(db, franchise_id, range_key="30d") -> dict` — главная (range из `RANGES_DAYS = {7d,30d,90d,365d}`).
  - Приватные: `_get_redis`, `_cached_get`/`_cached_set`, `_pct_change`, `_franchise_tenants`, `_franchise_clinic_ids`, `_revenue_in_window`, `_appointments_in_window`, `_patients_split` (new/returning по телефону), `_referrals_in_out`, `_bonuses_stats`, `_top_clinic_by_revenue`, `_top_doctor_by_appointments`, `_ltv_stats` (avg/median), `_tenants_status_breakdown`, `_module_stats` (подписки + MRR).
  - Константы `CACHE_TTL=300`, `RANGES_DAYS`.
- **Эндпоинты:** нет.
- **Зависимости:** `redis.asyncio`, `statistics`; модели `Subscription`/`SubStatus`, `Bonus`/`BonusStatus`, `Clinic`, `TenantModuleSubscription`/`ModuleStatus`, `Appointment`, `Doctor`, `PatientLtvSnapshot`, `Referral`/`ReferralStatus`, `Tenant`. `settings.redis_url`.
- **Где менять для типовых задач:** добавить новый KPI — новая `_*`-функция + поле в `payload` внутри `get_kpi`. Новый диапазон — ключ в `RANGES_DAYS`. TTL кеша — `CACHE_TTL`. Определение new/returning — `_patients_split` (по `patient_phone`). MRR — `_module_stats` (учитывает custom_price модулей в статусах ACTIVE/TRIAL/GRACE + plan-подписки).
- **Подводные камни:** «Revenue» здесь = сумма **Bonus.amount** (PAID+PENDING) по `to_clinic_id`, НЕ выручка приёмов — это другое определение дохода, чем в `franchise_pnl_service`! Не путать два сервиса. `_patients_split` тянет ВСЕ телефоны окна в память и делает второй `IN`-запрос — на большой клинике дорого. Redis открывается/закрывается (`aclose`) на КАЖДЫЙ `_cached_get/_set` (новое подключение). Все суммы наружу — `float`. Скоуп — `franchise_id` (платформенно). Кеш-ключ `kpi:{franchise_id}:{range}`.
- **Строк:** 473

## `backend/app/services/lab_service.py`
- **Назначение:** Лабораторные интеграции: шифрование API-ключей провайдеров, тест соединения, отправка заявки провайдеру и приём результатов через webhook. Отправка/прогресс — ФЕЙК-имплементация (заглушка под реальное API).
- **Ключевые элементы:**
  - Крипто: `encrypt_api_key`/`decrypt_api_key` (обёртка над `secrets_service`, fallback `plain:`-префикс), `mask_api_key` (****XXXX для UI).
  - `test_provider_connection(provider) -> dict` — фейк-проверка (длина ключа ≥ 8).
  - `send_order_to_provider(db, order, session_factory)` — статус `sent`, генерит `external_order_id`, запускает фоновую `schedule_async_progress` (через 30с → `in_progress`).
  - `normalize_webhook_payload(provider_type, payload)` — нормализация формата webhook.
  - `apply_webhook_results(db, order, results_list) -> int` — создаёт `LabResult`, ставит статус `results_ready`.
- **Эндпоинты:** нет.
- **Зависимости:** `asyncio`; модели `LabProvider`, `LabOrder`, `LabResult`; ленивый импорт `app.services.secrets_service.encrypt/decrypt`.
- **Где менять для типовых задач:** оживить реальную интеграцию — `test_provider_connection` (заменить фейк на `httpx` ping), `send_order_to_provider` (реальный POST вместо фейкового `external_order_id`), парсер конкретного провайдера — `normalize_webhook_payload` (сейчас ветки `generic_http` и fallback). Маппинг полей результата — `apply_webhook_results`.
- **Подводные камни:** **ЗАГЛУШКА** — `send_order` и `schedule_async_progress` имитируют прогресс через `asyncio.sleep(30)` + `asyncio.create_task` (fire-and-forget, обёрнут в `except: pass`); фоновая задача открывает СВОЮ сессию через `session_factory` — это работает после commit основной транзакции, но НЕ переживёт рестарт процесса. `test_provider_connection` не делает реального запроса. Если `secrets_service` недоступен — ключи хранятся в открытом виде с префиксом `plain:` (видно что не зашифровано). `flush`, коммит — на вызывающем (кроме `schedule_async_progress`, которая коммитит сама).
- **Строк:** 176

## `backend/app/services/ledger_service.py`
- **Назначение:** Append-only финансовый реестр операций пользователя. Запись — только через `add_entry`; баланс = `SUM(amount)`. Источник правды по бонусным/ручным движениям.
- **Ключевые элементы:** класс-неймспейс `OpType` (константы `BONUS_ACCRUED/BONUS_PAID/BONUS_CANCELLED/MANUAL_CREDIT/MANUAL_DEBIT`); `add_entry(db, user_id, amount, operation_type, ...) -> LedgerEntry` (единственный способ записи, `flush` без commit); `get_balance(db, user_id) -> Decimal`; `get_pending_balance(db, user_id) -> Decimal`; `get_history(db, user_id, limit, offset)`; `get_summary(db, user_id) -> dict`.
- **Эндпоинты:** нет.
- **Зависимости:** модель `LedgerEntry`.
- **Где менять для типовых задач:** добавить тип операции — константа в `OpType` + учёт в `get_summary`/`get_pending_balance` при необходимости. Логику pending — `get_pending_balance` (accrued + отрицательные paid/cancelled).
- **Подводные камни:** **Append-only — НИКОГДА не редактировать/удалять записи**, только добавлять (комментарий в шапке). `amount` всегда `Decimal(str(amount))` на входе. `get_balance`/`get_pending_balance` возвращают `Decimal`, а `get_summary` — `float` (round до 2). **tenant_id опционален** (`tenant_id=None` по умолчанию) — баланс считается ПО user_id без tenant-фильтра, что для глобального бонусного кошелька пациента корректно, но проверь сценарии мультитенантности. `flush`, коммит — на вызывающем.
- **Строк:** 122

## `backend/app/services/loyalty_ext_service.py`
- **Назначение:** Расширенная программа лояльности (Глава 8): тиры (bronze/silver/gold/platinum), начисление баллов по триггерам (приём/реферал/день рождения), расход баллов на награды (claims). Все триггеры безопасные (не ломают основную транзакцию).
- **Ключевые элементы:**
  - Тиры: `calc_tier(points)`, `next_tier_threshold(points)`; константы `TIER_THRESHOLDS`, `TIER_ORDER`, `AWARD_APPOINTMENT=50/REFERRAL=100/BIRTHDAY=200`.
  - Гейт модуля: `is_module_active(db, tenant_id)` — проверяет подписку `loyalty_pro` (ACTIVE/TRIAL/GRACE).
  - Аккаунты: `get_or_create_account`, `get_account_by_patient`, `get_account_by_phone`.
  - `adjust_points(db, account, delta, reason, ...)` — меняет баланс (не ниже 0), пересчитывает тир, пишет `LoyaltyEvent`.
  - Триггеры (safe, идемпотентные): `award_appointment`, `award_referral`, `award_birthday`.
  - Награды: `can_claim(reward, account) -> (ok, err)`, `create_claim(db, account, reward)` (списывает points, уменьшает stock).
  - Крон: `run_birthday_batch(db, tenant_id) -> int`.
- **Эндпоинты:** нет.
- **Зависимости:** модели `LoyaltyAccountExt`, `LoyaltyEvent`, `LoyaltyClaim`, `LoyaltyReward`, `PatientAccount`, `TenantModuleSubscription`/`ModuleStatus`; `app.utils.phone.normalize_phone`; ленивый импорт `app.services.family_service.get_account_by_phone`.
- **Где менять для типовых задач:** размеры наград — `AWARD_*`. Пороги тиров — `TIER_THRESHOLDS` (+ `TIER_ORDER` для сравнения). Условие доступности модуля — `is_module_active` (module_key `loyalty_pro`). Правила бронирования награды — `can_claim`. Новый триггер начисления — по образцу `award_*` (обязательно с проверкой `is_module_active` и идемпотентностью).
- **Подводные камни:** **все award-функции обёрнуты в try/except → возвращают None и логируют warning**, чтобы не откатывать основной приём/реферал. **Идемпотентность** реализована проверкой существующего `LoyaltyEvent` по `appointment_id`/`referral_id`/(account+year) — НЕ уникальным индексом, так что при гонке возможны дубли начислений. `award_*` гейтятся подпиской `loyalty_pro` — без неё молча возвращают None. `total_spent`/`points`: points — int (`max(0, ...)` не уходит в минус), `total_spent` — Decimal. `run_birthday_batch` грузит ВСЕХ активных пациентов в память и фильтрует в Python (без tenant-фильтра по `PatientAccount` — берёт всех, а tenant передаётся в `award_birthday`) — на больших базах дорого. `flush`, коммит — на вызывающем.
- **Строк:** 361
