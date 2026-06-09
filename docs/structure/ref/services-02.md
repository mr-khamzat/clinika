# services [02] — алёрты, биллинг, чат пациент↔клиника, аудит и финаналитика

Это второй срез сервисного слоя `backend/app/services/` (файлы 16–30 по алфавиту). Группа разнородная, но все файлы — чистый **service-layer**: бизнес-логика и работа с БД через `AsyncSession`, ни одного `APIRouter` (роутеры лежат в `backend/app/routers/`, эндпоинты помечены ниже как «—»). Условно делятся на пять кластеров:

- **Уведомления / алёрты** — `alert_service.py` (Telegram-алёрты админу и owner-боту).
- **Безопасность и аудит** — `api_key_service.py` (API-ключи тенантов), `audit_service.py` (append-only журнал + impersonation + Region Lock хук), `auth_service.py` (мёртвая заглушка).
- **Финансы / биллинг** — `billing_service.py` (подписки, счета, billing_ledger, revenue split, реклама), `bonus_service.py` (выплата/отмена бонусов), `arr_ltv_service.py` (ARR/LTV/forecast для super_admin), `appointment_costing.py` (FIFO-себестоимость приёма).
- **Чат пациент↔клиника** — `chat_service.py` (ядро тредов и сообщений), `chat_sla_job.py` (фоновая SLA-эскалация + автозакрытие), `chat_template_service.py` (шаблоны), `chat_workflow_service.py` (reassign тредов).
- **Прочая автоматизация** — `auto_confirm.py` (автоподтверждение направлений по МИС), `calendar_service.py` (iCal-feed пациенту), `call_rules_service.py` (матрица прав на звонки).

Сквозные принципы: почти всё `async`/`await`; деньги считаются через `Decimal` (см. подводные камни во многих файлах — float используется только на сериализации в JSON); большинство сервисов делают `db.flush()`, а `commit()` оставляют вызывающему роутеру (исключения — `bonus_service`, `call_rules_service`, фоновые джобы, которые коммитят сами); tenant-изоляция реализуется фильтрацией по `tenant_id` в запросах самих сервисов.

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `alert_service.py` | Telegram-алёрты админу и owner-боту платформы | 546 |
| `api_key_service.py` | API-ключи тенантов: генерация, скоупы, проверка | 217 |
| `appointment_costing.py` | FIFO-себестоимость и маржа приёма | 498 |
| `arr_ltv_service.py` | ARR / cohort LTV / прогноз MRR | 509 |
| `audit_service.py` | Append-only аудит-журнал + impersonation | 222 |
| `auth_service.py` | Мёртвая заглушка (логика в роутере auth.py) | 2 |
| `auto_confirm.py` | Автоподтверждение направлений по данным МИС | 212 |
| `billing_service.py` | Подписки, счета, billing_ledger, revenue split | 807 |
| `bonus_service.py` | Выплата / отмена бонуса + побочные эффекты | 116 |
| `calendar_service.py` | iCal-feed предстоящих приёмов пациента | 201 |
| `call_rules_service.py` | Матрица прав на аудио/видео-звонки | 183 |
| `chat_service.py` | Ядро чата: треды, сообщения, лимиты | 361 |
| `chat_sla_job.py` | Фоновая SLA-эскалация + автозакрытие тредов | 156 |
| `chat_template_service.py` | Шаблоны сообщений: сериализация и права | 24 |
| `chat_workflow_service.py` | Reassign треда между сотрудниками | 62 |

---

## `backend/app/services/alert_service.py`
- **Назначение:** Отправка Telegram-уведомлений главному админу платформы (@RootkinG85, chat_id `293633093`) и в owner-бот владельца сети. Включает критичные алёрты (5xx, exception, health, диск) и v2 admin-notifications (создание тенанта, блокировка франшизы, сброс пароля, крупные счета, дайджест).
- **Ключевые элементы:**
  - Owner-бот: `send_to_owner`, `send_document_to_owner`, `send_to_owner_to`, `send_document_to_owner_to` — адресные сообщения/файлы через отдельный `OWNER_BOT_TOKEN`, без дедупа.
  - Транспорт: `_send_telegram` (через `ADMIN_BOT_TOKEN`/`TELEGRAM_BOT_TOKEN`), `_should_send` (дедуп по ключу), `_signature` (подпись МСК).
  - v1 (legacy): `send_alert_500`, `send_alert_exception`, `send_alert_health`, `send_alert_recovery`, `send_alert_info`.
  - v2: `notify_admin` (generic, дедуп 5 мин); форматтеры `format_disk_alert`, `format_health_alert`, `format_health_recovery`, `format_daily_digest`; helpers `notify_tenant_created`, `notify_franchise_blocked`, `notify_password_reset`, `notify_big_invoice`, `notify_franchise_invoice`.
- **Эндпоинты:** — (не роутер).
- **Зависимости:** `app.config.settings` (токены ботов, `owner_telegram_id`); `httpx` (через HTTP-прокси `144.31.89.167:8080`); `html` для экранирования. Вызывается из middleware (5xx/exception), watchdog-джоба (health), роутеров админки (audit-helpers).
- **Где менять для типовых задач:**
  - Новый тип admin-уведомления → добавь helper по образцу `notify_*`, внутри зови `notify_admin(...)` с уникальным `dedup_key`.
  - Поменять получателя критичных алёртов → `ADMIN_CHAT_ID` (env `ADMIN_CHAT_ID`).
  - Прокси для Telegram → env `TELEGRAM_PROXY_URL` (по умолчанию хардкод `clinikabot:...@144.31.89.167:8080`).
  - Глобально выключить уведомления (но не 5xx/health) → env `ADMIN_NOTIFICATIONS_ENABLED=false`.
- **Подводные камни:**
  - **Хардкод секретов:** дефолтные креды прокси (`clinikabot:lT9k2Pq8mNxF5jB3@...`) повторяются в КАЖДОЙ из 5 функций — при ротации править во всех местах. Это утечка пароля в репозиторий.
  - Все user-controlled поля обязательно `html.escape(...)` — иначе Telegram ругается на `<class '...'>` в traceback и валит 400.
  - Дедуп `_recent_alerts` — in-memory dict, обнуляется при рестарте процесса; в multi-worker сетапе дедуп не общий.
  - Все функции graceful: исключения логируются, наружу не пробрасываются (бизнес-логика не должна падать из-за лежащего TG).
  - `notify_admin` уважает switch, но критичные алёрты должны идти с `bypass_switch=True`.
- **Строк:** 546

## `backend/app/services/api_key_service.py`
- **Назначение:** Жизненный цикл API-ключей тенанта для внешнего REST API (формат `clk_live_<32 chars>`). Сырой ключ показывается клиенту один раз, в БД хранится только `sha256`.
- **Ключевые элементы:**
  - Константы: `ALLOWED_SCOPES`, `SCOPE_LABELS`, `KEY_PREFIX="clk_live_"`.
  - `_hash_raw`, `generate_raw_key` → `(raw, key_hash, key_prefix)`.
  - `validate_scopes` (бросает ValueError на неизвестный scope), `ip_allowed` (одиночные IP + CIDR).
  - CRUD: `create_key`, `revoke_key`, `verify_raw_key` (проверка revoked/expired/IP + телеметрия), `key_status`, `serialize`.
- **Эндпоинты:** — (не роутер). Используется роутером управления ключами и middleware/dependency аутентификации внешних запросов.
- **Зависимости:** `app.models.tenant_api_key.TenantApiKey`; `hashlib`, `secrets`, `ipaddress`.
- **Где менять для типовых задач:**
  - Новый scope → добавь в `ALLOWED_SCOPES` И в `SCOPE_LABELS` (иначе UI не покажет лейбл).
  - Сменить формат/длину ключа → `generate_raw_key` и `KEY_PREFIX` (учти, что `verify_raw_key` отсекает по `startswith(KEY_PREFIX)`).
  - Добавить поле телеметрии → модель `TenantApiKey` + `UPDATE` в `verify_raw_key` + `serialize`.
- **Подводные камни:**
  - `verify_raw_key` делает отдельный `UPDATE` телеметрии (`last_used_*`, `request_count+1`) — намеренно вне основной транзакции запроса; `db.flush()`/`commit` за вызывающим.
  - **tenant_id-фильтрация:** `verify_raw_key` ищет ТОЛЬКО по `key_hash` (без tenant) — что верно, т.к. ключ глобально уникален; но `revoke_key` обязательно фильтрует по `tenant_id`, чтобы тенант не отозвал чужой ключ.
  - Пустой allowlist (`None`/`[]`) = разрешены все IP; невалидный `client_ip` при заданном allowlist → отказ.
- **Строк:** 217

## `backend/app/services/appointment_costing.py`
- **Назначение:** Калькуляция себестоимости и маржи приёма (Этап 3 INVENTORY_COST_PLAN): связывает нормативы расходников услуги, FIFO-списание партий и кеш `appointment_costs`.
- **Ключевые элементы:**
  - Private: `_get_service_ids_for_appointment` (связь приём→услуга через `referral.service_id`), `_sum_materials_cost` (сумма списаний по `unit_cost` партии + fallback на `item.cost_per_unit` для `batch_id IS NULL`), `_sum_revenue` (succeeded-платежи), `_writeoff_norms_for_service`.
  - Public: `calculate_appointment_cost`, `on_appointment_completed` (hook на →completed), `on_appointment_uncomplete` (откат + reverse), `cost_breakdown` (детализация по движениям).
- **Эндпоинты:** — (не роутер). Хуки зовутся из логики смены статуса приёма; `cost_breakdown`/`calculate_appointment_cost` — из manager-UI роутеров.
- **Зависимости:** `app.models.doctor` (Appointment), `app.models.inventory` (AppointmentCost, InventoryBatch/Item/Movement, ServiceConsumable), `app.models.payments_clinic` (ClinicPayment), `app.services.inventory_fifo` (`writeoff_fifo`, `reverse_writeoff`, `InsufficientStockError`); lazy-import `app.models.referral.Referral`.
- **Где менять для типовых задач:**
  - Добавить ФОТ/накладные в себестоимость → сейчас `labor_cost=0`, `overhead_cost=0` (MVP); расширять в `calculate_appointment_cost` (помечено «план v3»).
  - Изменить связь приём→услуга → `_get_service_ids_for_appointment` (сейчас единственный путь — через referral, прямой связи appointment→service в схеме нет).
  - Поведение при нехватке остатка → `_writeoff_norms_for_service` (для `is_optional` позиций ошибка глотается тихо).
- **Подводные камни:**
  - **Decimal обязателен:** все денежные суммы — `Decimal(str(...))`; во float конвертируются только в `cost_breakdown`/summary для JSON. `margin_pct` защищён от деления на ноль.
  - **Идемпотентность:** `on_appointment_completed` проверяет существующие `WRITE_OFF`-движения по приёму и не списывает повторно (но cost всё равно пересчитывает).
  - **Двойной учёт исключён:** fallback-ветка `_sum_materials_cost` фильтруется `batch_id IS NULL`, чтобы не сложить с основной.
  - Хуки никогда не бросают — ошибки списания не блокируют смену статуса приёма (логируются warning/exception, возвращается summary с `errors`).
  - Требует `appointment.tenant_id` — иначе `skipped_reason="no_tenant"` / ValueError в `calculate_appointment_cost`.
- **Строк:** 498

## `backend/app/services/arr_ltv_service.py`
- **Назначение:** Расширенная финансовая аналитика платформы для super_admin: ARR, retention-матрица по когортам, LTV summary, прогноз MRR. Считается on-the-fly без отдельной таблицы снапшотов.
- **Ключевые элементы:**
  - Helpers: `_month_key`, `_add_months`, `_months_between`, `_to_float`, `_monthly_amount` (annual/12), `_linear_regression`.
  - Public: `compute_arr`, `compute_cohort_ltv` (retention + грубая avg_revenue), `compute_ltv_summary` (avg/median/p90/by_plan, источник ledger > fallback), `compute_mrr_history`, `compute_forecast` (линрегрессия + R²→confidence).
- **Эндпоинты:** — (не роутер). Вызывается из `routers/admin_analytics.py` (тот же роутер отдаёт MRR; здесь намеренно НЕ дублируется расчёт MRR).
- **Зависимости:** `app.models.tenant.Tenant`, `app.models.billing` (Subscription, SubStatus), `app.models.billing_ledger` (BillingLedger, EntryType, Direction); `statistics`, `collections.defaultdict`.
- **Где менять для типовых задач:**
  - Сменить набор entry_type для LTV → список в `compute_ltv_summary` (`PLATFORM_INCOME`, `SUBSCRIPTION_CHARGE`, `PAYMENT_RECEIVED`).
  - Глубина когорт / горизонт прогноза → аргументы `cohort_months`, `months_ahead`, `window`.
  - Точную выручку когорты → заменить аппроксимацию (`monthly × months_alive`) на агрегацию из `billing_ledger`.
  - Если данных станет много — добавить снапшот-таблицу (в комментарии помечено как будущая миграция `arrltv01`).
- **Подводные камни:**
  - **Decimal→float:** `_to_float` приводит `Decimal` к float ради JSON; для аналитики ок, но не использовать эти числа для повторной записи в ledger.
  - Когортная `avg_revenue` — заведомо грубая аппроксимация (по последней подписке); точная цифра — в `compute_ltv_summary` через ledger.
  - Активность тенанта в месяце считается **in-memory** по всем подпискам (для производительности) — при тысячах подписок может стать тяжёлой.
  - Forecast обрезает прогноз снизу нулём (UX), `confidence` — эвристика по R² (≥0.7 high / ≥0.4 medium).
  - Tenant-изоляции тут нет и не должно быть — это платформенная аналитика (super_admin), агрегирует по всем тенантам.
- **Строк:** 509

## `backend/app/services/audit_service.py`
- **Назначение:** Append-only аудит-журнал (только INSERT, без update/delete). Пишет действия с актором, before/after, IP, гео и контекстом impersonation. Также триггерит Region Lock проверку.
- **Ключевые элементы:**
  - Класс-перечисление `AuditAction` — строковые константы действий (user.*, clinic.*, referral.*, bonus.*, settings.*, ledger.*, region.violation, discount/partner.*, и блок Security Journal: auth.*, password.*, short_code.*, impersonation.*, permission.denied, webhook.*, secrets.rotated, ip.*).
  - `_ip` (из x-real-ip / x-forwarded-for / client), `_ua`.
  - `write(...)` — основная запись (+impersonation override +geoip +Region Lock хук), `write_safe(...)` — обёртка, не падает.
- **Эндпоинты:** — (не роутер). `write`/`write_safe` зовутся практически из всех мутирующих роутеров.
- **Зависимости:** `app.models.audit.AuditEntry`; lazy-imports: `app.core.request_ctx` (`current_request`, `current_impersonator`), `app.services.geoip_service.lookup`, `app.services.region_lock_service.check_violation`.
- **Где менять для типовых задач:**
  - Новый тип события → добавь константу в `AuditAction` и вызывай `write(db, AuditAction.XXX, ...)`.
  - Расширить контекст impersonation → блок `imp_block` внутри `write` (формат по RFC 8693 act-claim).
  - Изменить логику гео → `geoip_service` (здесь только graceful-вызов).
- **Подводные камни:**
  - **Impersonation override:** при активной сессии impersonation `actor_id` подменяется на реального super_admin, а целевой пользователь уезжает в `after.impersonation` — критично для compliance; НЕ применяется к самим `impersonation.*` событиям.
  - `write` делает `db.flush()`, но НЕ `commit()` — коммитит вызывающий роутер (иначе запись потеряется при rollback транзакции).
  - Region Lock и geoip обёрнуты в `try/except: pass` — любые их ошибки не должны валить аудит.
  - `before`/`after` приводятся к dict; не-dict значения оборачиваются в `{"value": str(...)}`.
  - **tenant_id** передаётся явным аргументом — не забывать прокидывать, иначе запись будет «бестенантной».
- **Строк:** 222

## `backend/app/services/auth_service.py`
- **Назначение:** **Мёртвый файл / заглушка.** Содержит только комментарий: логика аутентификации встроена прямо в `routers/auth.py`, файл оставлен ради совместимости импортов.
- **Ключевые элементы:** нет (2 строки комментариев).
- **Эндпоинты:** —.
- **Зависимости:** нет.
- **Где менять для типовых задач:** Аутентификацию править в `backend/app/routers/auth.py`, не здесь. Этот файл можно удалить, если убедиться, что его никто не импортирует.
- **Подводные камни:** Легаси-заглушка — не вводит в заблуждение названием: реальной логики тут НЕТ.
- **Строк:** 2

## `backend/app/services/auto_confirm.py`
- **Назначение:** Фоновое автоподтверждение направлений по данным МИС Renovatio. Раз в 10 минут опрашивает МИС, ищет выполненные визиты и подтверждает совпавшие открытые направления, начисляя бонусы.
- **Ключевые элементы:**
  - `POLL_INTERVAL=600`; `_normalize_name`, импорт `normalize_phone`/`mask_phone`/`mask_name`.
  - `run_auto_confirm()` — один цикл (итерация по активным тенантам с `mis_clinic_ids`), `_process_tenant_confirmations()` (матчинг + подтверждение по тенанту), `auto_confirm_loop()` (бесконечный цикл с задержкой старта 60 c).
  - Внутренняя `_confirm(referral)` делегирует все денежные эффекты в `referral_service._finalize_bonus_and_ledger`.
- **Эндпоинты:** — (не роутер; запускается как фоновая задача из main.py).
- **Зависимости (lazy внутри функций):** `app.database.AsyncSessionLocal`, модели Tenant/Referral/Service/SystemSettings/Bonus, `app.services.mis_client.get_appointments`, `app.services.settings_service.get_setting`, `app.services.referral_service._finalize_bonus_and_ledger`, `app.utils.phone`.
- **Где менять для типовых задач:**
  - Логика матчинга (точный `mis_patient_id` → телефон+ФИО ≥2 общих слова) → `_process_tenant_confirmations`.
  - Что считать «выполненным» визитом → фильтр `done` в `run_auto_confirm` (`status_id == "4"` или текст «выполнено/завершено/completed»).
  - Финансовые последствия подтверждения → НЕ здесь, а в `referral_service._finalize_bonus_and_ledger` (общий с ручным confirm).
  - Интервал опроса → `POLL_INTERVAL`.
- **Подводные камни:**
  - **Фикс рассогласования (audit Фаза 1, #6/#7):** раньше авто-ветка не писала Ledger/ICI/BillingLedger/RecruiterBonus и использовала `service.bonus_amount` вместо `service.referral_payout`. Теперь обе ветки идут через общий `_finalize_bonus_and_ledger` — НЕ вводить расхождение снова.
  - **Конкурентность:** открытые направления выбираются `with_for_update(skip_locked=True)`, чтобы параллельные джобы не подтвердили одно и то же.
  - Per-tenant: МИС-настройки (`mis_api_url`/`mis_api_key`) читаются по `tenant_id`; тенант без `mis_clinic_ids` пропускается.
  - PII в логах маскируется (`mask_name`/`mask_phone`).
  - `commit` делается внутри `_process_tenant_confirmations` (фоновая задача владеет своей сессией).
- **Строк:** 212

## `backend/app/services/billing_service.py`
- **Назначение:** Ядро SaaS-биллинга платформы (Этап 9 + V2): подписки тенантов, счета/платежи, тарифные планы, правила ценообразования, append-only `billing_ledger`, revenue split (платформа/тенант/франшиза), реклама (flat/CPC/CPM).
- **Ключевые элементы:**
  - Helpers: `_next_invoice_number`, `_add_months`, `_period_end`.
  - Подписки: `create_subscription`, `get_active_subscription`, `change_plan`, `cancel_subscription`.
  - Счета/платежи: `generate_invoice`, `mark_invoice_overdue`, `record_payment`, `get_billing_summary`.
  - V2 — планы: `get_plan_by_name`, `list_plans`; ценообразование: `get_pricing_rules`, `update_pricing_rules`.
  - **`record_billing_ledger`** — единственная точка записи в реестр.
  - Revenue split: `_apply_revenue_split` (PLATFORM_INCOME + TENANT_INCOME + FRANCHISE_FEE).
  - Плагины: `get_active_plugin_subscription`, `charge_plugin_subscription`, `cancel_plugin_subscription`, `assert_plugin_active` (бросает HTTP 402).
  - Реклама: `create_ad`, `record_ad_event` (счётчики + CPC/CPM-биллинг), аналитика `get_billing_ledger_summary`.
- **Эндпоинты:** — (не роутер). Зовётся из роутеров биллинга/тарифов/рекламы и фоновых джобов (`mark_invoice_overdue`, `renew_plugins_job`).
- **Зависимости:** `app.models.billing` (Subscription/Invoice/Payment/TenantPluginSubscription + статусы + PLAN_PRICES), `app.models.billing_plan` (TenantPlan, TenantPricingRules), `app.models.billing_ledger` (BillingLedger, EntryType, Direction), `app.models.advertising` (Ad/AdEvent + enums); `hashlib`.
- **Где менять для типовых задач:**
  - Любая финансовая проводка → ТОЛЬКО через `record_billing_ledger` (не создавай BillingLedger руками).
  - Новый billing-цикл → словарь `months` в `_period_end` (monthly/quarterly/semi_annual/nine_months/annual).
  - Изменить доли платформы/франшизы → `TenantPricingRules` (`plugin_split_percent`, `ad_split_percent`, `franchise_fee_percent`); дефолты создаются в `get_pricing_rules`.
  - Гейт платного модуля в роутере → `await assert_plugin_active(db, tenant_id, "feature_key")` (HTTP 402).
  - Новая модель оплаты рекламы → `record_ad_event` (CPC при click, CPM = price/1000 за impression).
- **Подводные камни:**
  - **Decimal vs float:** все суммы — `Decimal`; `record_billing_ledger` оборачивает `Decimal(str(amount))`. `get_billing_summary`/`get_billing_ledger_summary` конвертируют во float ТОЛЬКО на выходе. Не смешивать.
  - **Порядковый номер счёта** в `generate_invoice` берётся как `count(Invoice)+1` — НЕ атомарно, при гонке двух выписок возможен дубль `invoice_number`. Глобальный счётчик, не per-tenant per-year.
  - `_add_months` использует `start.day` без клампа — при `start.day=31` для месяца с 30 днями бросит ошибку date (потенциальный баг на конец месяца).
  - Legacy: `enable_plugin()` и таблица `plugin_features`/`PluginFeature` удалены — включение модулей теперь через `commercial_service`/`/commercial`. Комментарии в файле это фиксируют.
  - `get_billing_ledger_summary` фильтрует `is_split == False` для gross-сводки и отдельно суммирует `PLATFORM_INCOME` (split) — не путать gross и split-записи.
  - Revenue split FRANCHISE_FEE создаётся только если `franchise_fee_percent > 0`.
- **Строк:** 807

## `backend/app/services/bonus_service.py`
- **Назначение:** Перевод бонуса в статусы PAID / CANCELLED с полным каскадом побочных эффектов (ledger, platform fee, webhook, push, email).
- **Ключевые элементы:** `mark_bonus_paid(db, bonus_id)`, `mark_bonus_cancelled(db, bonus_id)`.
- **Эндпоинты:** — (не роутер). Зовётся из роутеров бонусов/выплат (в т.ч. bulk).
- **Зависимости (lazy внутри):** `app.models.bonus` (Bonus, BonusStatus); `app.services.ledger_service` (`add_entry`, `OpType`), `app.services.franchise_billing_service.record_platform_fee_for_bonus`, `app.services.webhook_service.send_event`, `app.services.push_service.send_push_to_user`, `app.services.email_service.schedule_email`, `app.models.user.User`.
- **Где менять для типовых задач:**
  - Новый побочный эффект при выплате (например, SMS) → добавь блок в `mark_bonus_paid` по образцу push/email (обязательно в своём `try/except` с `logger.exception`).
  - Логика возврата fee при отмене → `record_platform_fee_for_bonus(..., direction="refund")` в `mark_bonus_cancelled`.
- **Подводные камни:**
  - **Только из PENDING:** оба метода работают, только если `bonus.status == PENDING` (идемпотентность — повторный вызов ничего не делает).
  - **Сам делает `db.commit()`** (в отличие от большинства сервисов, делающих flush) — учитывать при вызове внутри большей транзакции.
  - **float, не Decimal:** в ledger пишется `-float(bonus.amount)` (отрицательная сумма = списание с pending) — потенциальная точность, но согласовано с `ledger_service`.
  - Каждый побочный эффект изолирован `try/except` — падение push/email/webhook не откатывает смену статуса.
  - `tenant_id` берётся осторожно через `hasattr(bonus, 'tenant_id')` (защита от старой схемы).
- **Строк:** 116

## `backend/app/services/calendar_service.py`
- **Назначение:** Генерация iCal-feed (RFC 5545) с предстоящими приёмами пациента (до 4 недель) — для подписки в Google/Apple Calendar по URL с токеном.
- **Ключевые элементы:**
  - Токены: `issue_token`, `revoke_token`, `get_token_record`.
  - Данные: `upcoming_appointments` (по нормализованному телефону, статусы PENDING/CONFIRMED).
  - Рендер: `build_ics` (через пакет `icalendar`, с fallback на ручную сборку VCALENDAR), helpers `_utc`, `_ics_escape`, `_dt_combine`, `serialize_upcoming`.
- **Эндпоинты:** — (не роутер). Зовётся из публичного calendar-роутера, отдающего `.ics` по токену.
- **Зависимости:** `app.models.calendar.PatientCalendarToken`, `app.models.doctor` (Appointment/AppointmentStatus/Doctor), `app.models.clinic.Clinic`, `app.models.patient_account.PatientAccount`, `app.utils.phone.normalize_phone`; опционально `icalendar`.
- **Где менять для типовых задач:**
  - Горизонт выдачи → аргумент `weeks_ahead` в `upcoming_appointments` (по умолчанию 4).
  - Содержимое события (SUMMARY/DESCRIPTION/LOCATION) → править В ДВУХ местах: ветка `icalendar` и fallback-ветка в `build_ics`.
  - Какие статусы попадают в feed → фильтр `status.in_([PENDING, CONFIRMED])`.
- **Подводные камни:**
  - **Дубль логики рендера:** SUMMARY/DESCRIPTION/LOCATION собираются дважды (через icalendar и вручную) — легко рассинхронизировать при правках.
  - Все времена принудительно в UTC (`_dt_combine` ставит tzinfo=UTC) — наивные времена приёма трактуются как UTC, без учёта таймзоны клиники.
  - Старые токены при `issue_token` не отзываются — у пациента может быть несколько активных.
  - Поиск идёт по `patient_phone` (нормализованному), а не по `patient_id` — приёмы матчатся по телефону.
- **Строк:** 201

## `backend/app/services/call_rules_service.py`
- **Назначение:** Матрица прав на аудио/видео-звонки между ролями (с учётом клиник и scope). Дефолты держатся в коде, overrides — в таблице `call_rules`.
- **Ключевые элементы:**
  - `EXCLUDED_ROLES` (super_admin, visiting_doctor, partner_doctor — без звонков), `ACTIVE_ROLES`.
  - `default_rule`, `_resolve_scope` (same_clinic / cross_clinic / any).
  - `check_can_call(from_user, to_user, db)` — 4-уровневый резолв (пара клиник → роли+scope → роли+any → дефолт).
  - `get_rules_matrix`, `upsert_rule`, `reset_rules`.
- **Эндпоинты:** — (не роутер). Зовётся из роутера звонков (проверка перед инициацией) и админ-UI настройки правил.
- **Зависимости:** `app.models.call_rule` (CallRule, CallScope), `app.models.user` (User, UserRole).
- **Где менять для типовых задач:**
  - Новая роль-исключение → `EXCLUDED_ROLES`; новая участвующая роль → `ACTIVE_ROLES`.
  - Базовая политика по умолчанию → `default_rule` (сейчас «все активные роли могут аудио+видео всем»).
  - Порядок приоритета правил → последовательность веток 1→4 в `check_can_call`.
- **Подводные камни:**
  - **tenant-изоляция жёсткая:** `check_can_call` сразу возвращает запрет, если у пользователей разные `tenant_id` или tenant отсутствует, и если это один и тот же пользователь.
  - `upsert_rule` и `reset_rules` делают `db.commit()` сами.
  - Условие в `upsert_rule` для NULL-клиник использует тернарник `is_(None)` vs `== id` — следить, чтобы поиск существующего правила точно совпадал с критериями (иначе создастся дубль вместо апдейта).
- **Строк:** 183

## `backend/app/services/chat_service.py`
- **Назначение:** Ядро асинхронного чата пациент↔клиника (Глава 9): создание тредов и сообщений, лимиты пациента, непрочитанные, SLA-цветометка, сериализация (включая реакции и reply-preview).
- **Ключевые элементы:**
  - Константа `PATIENT_MONTHLY_FREE_LIMIT=3`.
  - Сериализаторы: `serialize_thread` (с расчётом `sla_level`/`sla_minutes`), `serialize_message`, `serialize_message_with_reply`, `serialize_message_with_reactions`.
  - Чтение: `list_patient_threads`, `list_clinic_threads` (pinned сверху), `get_thread`, `list_messages` (курсорная пагинация по `before_id`), `last_message`, `count_patient_messages_last_30d`.
  - Лимит: `check_patient_can_send` → `(allowed, used, limit_or_None)`.
  - Запись: `create_thread`, `add_patient_message`, `add_staff_message`, `mark_read_for_patient`, `mark_read_for_clinic`.
- **Эндпоинты:** — (не роутер). Зовётся из чат-роутеров пациента и клиники.
- **Зависимости:** `app.models.chat` (ChatThread, ChatMessage, ChatMessageReaction), `app.services.subscription_service.has_active_plan`.
- **Где менять для типовых задач:**
  - Пороги SLA-цветометки → `serialize_thread` (green <5 мин, yellow <15, red >15) — это UI-метка, отдельно от эскалации в `chat_sla_job`.
  - Бесплатный лимит пациента / какие планы дают безлимит → `PATIENT_MONTHLY_FREE_LIMIT` и список планов в `check_patient_can_send` (`health_plus`/`family_plus`/`pro`).
  - Допустимые типы отправителя со стороны клиники → проверка в `add_staff_message` (`doctor`/`reg`/`manager`/`system`).
- **Подводные камни:**
  - **SLA-таймер:** `last_inbound_message_at` обновляется ТОЛЬКО при входящем от пациента (`create_thread`, `add_patient_message`) — это вход для обоих: цветометки тут и эскалации в `chat_sla_job`. Не сбросить случайно.
  - Повторное сообщение пациента в `closed` тред его переоткрывает (`status="open"`).
  - Счётчики непрочитанных (`unread_for_clinic`/`unread_for_patient`) денормализованы — инкремент при отправке, обнуление при `mark_read_*`; легко рассинхронизировать при ручных правках.
  - Лимит считается суммарно по всем тредам пациента за 30 дней (только `sender_type=="patient"`).
  - `db.flush()` без commit — коммитит роутер.
- **Строк:** 361

## `backend/app/services/chat_sla_job.py`
- **Назначение:** Фоновое задание (раз в минуту, apscheduler): SLA-эскалация открытых тредов на более старшую роль (reg→manager→owner) и автозакрытие неактивных тредов.
- **Ключевые элементы:**
  - `DEFAULT_SETTINGS` (флаг + минуты порогов + autoclose-дни), `ROLE_PRIORITY`.
  - `_resolve_level` (минуты→уровень), `_find_free_user_of_role` (наименее загруженный по open-тредам), `_system_actor` (фиктивный actor с zero-UUID), `_check_thread_sla`, `_should_autoclose`.
  - Точка входа `chat_sla_checker_job()`.
- **Эндпоинты:** — (не роутер; джоб scheduler).
- **Зависимости:** `app.models.chat` (ChatThread, ChatMessage), `app.models.tenant.Tenant`, `app.models.user.User`, `app.services.chat_workflow_service.reassign_thread`, `app.database.AsyncSessionLocal`.
- **Где менять для типовых задач:**
  - Пороги эскалации и autoclose → `DEFAULT_SETTINGS` (дефолты) либо per-tenant в `tenant.settings` (мёрджатся поверх дефолтов).
  - Алгоритм выбора исполнителя → `_find_free_user_of_role` (сейчас: минимум open-тредов; маппинг `owner→franchise_owner`).
  - Включение фичи → `chat_sla_enabled` (по умолчанию `False`).
- **Подводные камни:**
  - **tz-нормализация:** `_should_autoclose` отрезает tzinfo у `last_message_at` (на случай TIMESTAMPTZ из БД) перед сравнением с `utcnow()` — наивный vs aware datetime иначе бросит TypeError.
  - **Эскалация только вверх:** если тред уже на ≥ уровне приоритета — повторно не эскалирует (`ROLE_PRIORITY`).
  - `tenant.settings` может отсутствовать как атрибут, если миграция `wf02` не применена → `getattr(tenant, "settings", None)` (защита).
  - Safety cap 500 тредов за прогон; джоб делает один `commit` в конце и глотает все исключения (`log.exception`), чтобы scheduler не падал.
  - SLA-флаги (`sla_breached_level`/`sla_breached_at`) выставляются здесь, а сбрасываются в `reassign_thread` — следить за согласованностью.
- **Строк:** 156

## `backend/app/services/chat_template_service.py`
- **Назначение:** Вспомогательная логика шаблонов быстрых сообщений (canned responses) для чата: сериализация и проверка прав на изменение.
- **Ключевые элементы:** `serialize_template(t)` (включает `is_global = created_by_user_id is None`), `can_modify_template(t, user)`.
- **Эндпоинты:** — (не роутер). Зовётся из роутера управления шаблонами.
- **Зависимости:** `app.models.message_template.MessageTemplate`, `app.models.user.User`. Это самый маленький файл среза (тонкая обёртка над моделью).
- **Где менять для типовых задач:**
  - Кто может править глобальные/чужие шаблоны → `can_modify_template` (сейчас: manager/franchise_owner/super_admin — любые; остальные — только свои).
  - Поля в выдаче шаблона → `serialize_template`.
- **Подводные камни:**
  - Чисто синхронный модуль (нет `async`/БД) — никакой фильтрации tenant_id здесь нет, изоляция должна обеспечиваться запросом в роутере.
  - Глобальный шаблон = `created_by_user_id is None`; такие может править только привилегированная роль.
- **Строк:** 24

## `backend/app/services/chat_workflow_service.py`
- **Назначение:** Операции над тредом чата — пока только переназначение (reassign) треда другому сотруднику с историей и system-сообщением.
- **Ключевые элементы:** исключение `CrossTenantError`; `reassign_thread(db, *, thread, target_user, actor, note, reason)`.
- **Эндпоинты:** — (не роутер). Зовётся из чат-роутера (ручной reassign, `reason="manual"`) и из `chat_sla_job` (авто-эскалация, `reason="sla"`).
- **Зависимости:** `app.models.chat` (ChatThread, ChatMessage), `app.models.user.User`.
- **Где менять для типовых задач:**
  - Новые операции над тредом (например, merge/snooze) → добавлять сюда, по образцу `reassign_thread`.
  - Формат записи истории передач → блок `history.append({...})` (JSONB).
- **Подводные камни:**
  - **CrossTenantError:** жёстко запрещает передачу треда пользователю из другого тенанта (`thread.tenant_id != target_user.tenant_id`) — основная защита изоляции.
  - **JSONB-мутация:** `reassigned_history` пересобирается новым списком целиком (`list(... or [])` + append + присвоение) — иначе SQLAlchemy не заметит изменение mutable-поля. Не делать `.append` на месте.
  - `reassign_thread` сбрасывает SLA-флаги (`sla_breached_level`/`sla_breached_at = None`), что важно для корректной работы `chat_sla_job` (иначе повторная эскалация залипнет).
  - Не делает commit — коммитит вызывающий (роутер или джоб).
  - `actor` может быть не реальным User, а `SimpleNamespace` (из `chat_sla_job._system_actor`) — код использует только `actor.id`, так что duck-typing работает.
- **Строк:** 62
