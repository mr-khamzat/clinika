# services [01] — эквайринг (платёжные шлюзы), биллинг-акты, журнал активности, реклама-AI, агрегаторы, FAQ-поиск

Это первый алфавитный срез каталога `backend/app/services/` (15 файлов от `acquiring/base.py` до `ai_knowledge_service.py`). Все файлы — **сервисный слой** (бизнес-логика, адаптеры внешних API, чистые функции аналитики). **Роутеров здесь нет** — ни один файл не объявляет `APIRouter` и не содержит эндпоинтов; они вызываются из роутеров (`app/routers/*`) или из других сервисов. Поэтому секции «Эндпоинты» в документе отсутствуют.

Тематически срез распадается на шесть кластеров:

1. **Интернет-эквайринг** (приём онлайн-оплаты от пациентов): пакет `acquiring/` (база + реестр + 5 адаптеров шлюзов) и фасад `acquiring_service.py`. Из адаптеров **реально реализован только ЮKassa**; Т-Банк / Сбер / CloudPayments / Robokassa — заглушки, кидающие `NotImplementedError`.
2. **Журнал активности** (`activity_service.py`) — централизованное логирование действий пользователей + гео-IP + проверка Region Lock.
3. **Акты оказанных услуг для биллинга платформы** (`acts_service.py`) — генерация/подпись/PDF месячных актов по подпискам тенантов.
4. **Реклама** (`ads_ai.py`, `ads_analytics.py`, `ads_substitute.py`) — генерация картинок/стоков, воронки/heatmap/прогноз, подстановка `{{переменных}}` в баннеры.
5. **Партнёрская программа агрегаторов** (`aggregator_service.py`) — API-ключи, лиды, комиссии, статистика конверсии.
6. **Локальный FAQ-поиск для AI** (`ai_knowledge_service.py`) — дешёвый токен-матч по базе знаний перед дорогим вызовом LLM.

| Файл | Назначение в 5-7 слов | Строк |
|---|---|---|
| `acquiring/base.py` | Абстрактный интерфейс адаптера платёжного шлюза | 85 |
| `acquiring/cloudpayments_adapter.py` | Заглушка CloudPayments (NotImplementedError) | 50 |
| `acquiring/registry.py` | Реестр name→класс адаптера шлюза | 38 |
| `acquiring/robokassa_adapter.py` | Заглушка Robokassa (NotImplementedError) | 53 |
| `acquiring/sber_adapter.py` | Заглушка Сбербанк-эквайринг (NotImplementedError) | 50 |
| `acquiring/tinkoff_adapter.py` | Заглушка Т-Банк-эквайринг (NotImplementedError) | 51 |
| `acquiring/yookassa_adapter.py` | Рабочий адаптер ЮKassa на httpx | 318 |
| `acquiring_service.py` | Фасад: старт/статус/возврат платежа клиники | 180 |
| `activity_service.py` | Лог действий + гео-IP + Region Lock | 101 |
| `acts_service.py` | Месячные акты подписок: генерация/подпись/PDF | 329 |
| `ads_ai.py` | Генерация картинок и стоков для рекламы | 91 |
| `ads_analytics.py` | Воронка / heatmap / прогноз бюджета объявления | 155 |
| `ads_substitute.py` | Подстановка `{{var}}` в текст баннеров | 35 |
| `aggregator_service.py` | API-ключи, лиды, комиссии агрегаторов | 138 |
| `ai_knowledge_service.py` | Локальный токен-поиск по FAQ перед LLM | 184 |

---

## `backend/app/services/acquiring/base.py`
- **Назначение:** Определяет абстрактный контракт всех платёжных адаптеров и два dataclass-результата. Любой новый шлюз обязан реализовать `BasePaymentGateway`.
- **Ключевые элементы:**
  - `@dataclass PaymentInitResult` — `payment_url`, `payment_id`, `raw: dict`.
  - `@dataclass PaymentStatusResult` — `status` (`pending|succeeded|cancelled|refunded`), `paid_at`, `raw`.
  - `class BasePaymentGateway(ABC)` — атрибут `name`, конструктор `__init__(self, config)`, и 4 абстрактных async-метода: `init_payment(amount, description, return_url, metadata)`, `get_status(payment_id)`, `refund(payment_id, amount=None)`, `verify_webhook(headers, body)`.
- **Зависимости:** только stdlib (`abc`, `dataclasses`, `datetime`, `decimal`, `typing`). Конфиг — `PaymentGatewayConfig` из `app.models.payments_clinic` (передаётся в конструктор, но **не импортируется** во избежание циклов).
- **Где менять для типовых задач:**
  - Добавить новое поле в результат инициализации/статуса — правь dataclass здесь (и все адаптеры заодно).
  - Изменить сигнатуру метода шлюза (например добавить `currency`) — меняй абстрактный метод здесь, потом все 5 адаптеров.
- **Подводные камни:** `amount: Decimal` по контракту — **не передавай float**. `verify_webhook` обязан вернуть `None` при невалидной подписи (не бросать), иначе вебхук-роутер не отличит подделку. Конструктор принимает `config` без аннотации типа (`# noqa: ANN001`) специально — это объект `PaymentGatewayConfig`, импорт убран ради разрыва цикла.
- **Строк:** 85

## `backend/app/services/acquiring/registry.py`
- **Назначение:** Глобальный реестр зарегистрированных адаптеров: маппит строковый ключ шлюза на класс. Позволяет получать инстанс адаптера по имени без жёстких импортов в сервисе.
- **Ключевые элементы:**
  - `_GATEWAYS: dict[str, Type[BasePaymentGateway]]` — модульная карта.
  - `register_gateway(name, cls)` — регистрация (бросает `ValueError` на пустое имя).
  - `get_gateway(name, config) -> BasePaymentGateway` — фабрика инстанса; бросает `KeyError` если шлюз не зарегистрирован.
  - `list_registered() -> list[str]` — список ключей для UI/диагностики.
- **Зависимости:** `app.services.acquiring.base.BasePaymentGateway`. Сама регистрация выполняется в `acquiring/__init__.py` (см. ниже).
- **Где менять для типовых задач:** саму регистрацию шлюзов меняй **не здесь**, а в `acquiring/__init__.py` — там 5 строк `register_gateway(...)`. Этот файл трогать почти никогда не нужно.
- **Подводные камни:** реестр заполняется как side-effect импорта пакета `acquiring`. Если `get_gateway` зовут до импорта `app.services.acquiring` — карта пустая и будет `KeyError`. Фасад `acquiring_service.py` импортирует `from app.services.acquiring import get_gateway`, что гарантирует прогон `__init__.py` и регистрацию.
- **Строк:** 38

## `backend/app/services/acquiring/yookassa_adapter.py`
- **Назначение:** Единственный рабочий адаптер эквайринга. Полная интеграция с ЮKassa API v3 на чистом `httpx` (без SDK): создание платежа, опрос статуса, возврат, валидация вебхука по IP-allowlist.
- **Ключевые элементы:**
  - Константы `YK_API_BASE`, `YK_HTTP_TIMEOUT=20.0`, `YOOKASSA_WEBHOOK_NETS` (7 IP-диапазонов ЮKassa, включая IPv6).
  - `_ip_in_yookassa_allowlist(ip)` — проверка IP через `ipaddress`.
  - `class YookassaGateway(BasePaymentGateway)` (`name="yookassa"`):
    - `_credentials()` — берёт `shop_id`/`secret_key` из `config`, иначе из env `YOOKASSA_SHOP_ID`/`YOOKASSA_SECRET_KEY`; бросает `RuntimeError` если пусто.
    - `_default_return_url()` — env `YOOKASSA_RETURN_URL` (дефолт `https://klinikset.ru/billing/return`).
    - `_format_amount()` — quantize до 2 знаков, строкой.
    - `_http()` — собирает `httpx.AsyncClient` с Basic-auth.
    - `init_payment(...)` — `POST /payments` (capture=True, confirmation.redirect), доп. параметр `idempotency_key`. Возвращает `confirmation_url`.
    - `get_status()` — `GET /payments/{id}` (404 → `LookupError`).
    - `refund()` — `POST /refunds`; при `amount=None` дёргает `get_status` чтобы узнать оригинальную сумму.
    - `verify_webhook()` — проверяет IP отправителя, парсит JSON, маппит статусы ЮKassa (`succeeded/canceled/pending/waiting_for_capture`, события `refund.*` → `refunded`).
- **Зависимости:** `httpx`, stdlib (`ipaddress`, `os`, `uuid`, `logging`, `json`); базовые dataclass'ы из `acquiring/base.py`.
- **Где менять для типовых задач:**
  - Реальная клиника не платит / 503 — проверь `_credentials()`: либо `PaymentGatewayConfig` (UI «Настройки → Онлайн-оплата»), либо env-fallback.
  - Сменился список IP вебхуков ЮKassa — правь `YOOKASSA_WEBHOOK_NETS`.
  - Нужен холдинг средств (двухстадийный платёж) — в `init_payment` поставь `"capture": False` и добавь метод capture.
  - Новый статус в маппинге — расширь `status_map` в `verify_webhook`.
- **Подводные камни:** ЮKassa **не подписывает вебхуки** — единственная защита это IP-allowlist + рекомендация перепроверять статус через `GET /payments/{id}`. `description` обрезается до 128 символов. metadata — только строковые значения (всё конвертится в `str`). `idempotency_key` генерится через `uuid4` если не передан — повторный вызов с новым ключом создаст дубль платежа. Суммы — везде `Decimal`.
- **Строк:** 318

## `backend/app/services/acquiring/tinkoff_adapter.py`
- **Назначение:** Заглушка Т-Банк (Tinkoff Acquiring). Все 4 метода бросают `NotImplementedError` с подсказкой по реализации.
- **Ключевые элементы:** `class TinkoffGateway(BasePaymentGateway)`, `name="tinkoff"`; методы `init_payment/get_status/refund/verify_webhook` — все `raise NotImplementedError(...)`.
- **Зависимости:** `acquiring/base.py`.
- **Где менять для типовых задач:** чтобы подключить Т-Банк по-настоящему — реализуй методы по образцу `yookassa_adapter.py`: `POST https://securepay.tinkoff.ru/v2/Init` (amount в копейках, подпись `Token=SHA256` от отсортированных параметров + Password), `/v2/GetState`, `/v2/Cancel`, проверка поля `Token` в теле вебхука.
- **Подводные камни:** **Это заглушка** — вызов сейчас падает `NotImplementedError`. Фасад/роутер должен транслировать это в HTTP 501. Сумма в копейках (целое), а контракт даёт `Decimal` в рублях — при реализации не забыть умножение на 100.
- **Строк:** 51

## `backend/app/services/acquiring/sber_adapter.py`
- **Назначение:** Заглушка Сбербанк-эквайринг (REST). Все методы — `NotImplementedError`.
- **Ключевые элементы:** `class SberGateway(BasePaymentGateway)`, `name="sber"`.
- **Зависимости:** `acquiring/base.py`.
- **Где менять для типовых задач:** реализовать `register.do` (amount в копейках, `orderNumber`, `returnUrl`), `getOrderStatusExtended.do`, `refund.do`, проверку HMAC/checksum вебхука. Endpoint `https://securepayments.sberbank.ru/payment/rest/`.
- **Подводные камни:** **Заглушка.** Сумма в копейках. `userName`=`shop_id`, `password`=`secret_key` либо api-token.
- **Строк:** 50

## `backend/app/services/acquiring/cloudpayments_adapter.py`
- **Назначение:** Заглушка CloudPayments. Все методы — `NotImplementedError`.
- **Ключевые элементы:** `class CloudPaymentsGateway(BasePaymentGateway)`, `name="cloudpayments"`.
- **Зависимости:** `acquiring/base.py`.
- **Где менять для типовых задач:** реализовать `/orders/create` (или виджет `cp.payments` на фронте), `/payments/get`, `/payments/refund`; вебхук — проверка заголовка `Content-HMAC` (HMAC-SHA256 по body+secret). Авторизация: Public ID + API secret.
- **Подводные камни:** **Заглушка.** Часто платёж идёт через фронт-виджет, а не серверный редирект — `init_payment` может вообще не понадобиться в классическом виде.
- **Строк:** 50

## `backend/app/services/acquiring/robokassa_adapter.py`
- **Назначение:** Заглушка Robokassa. Все методы — `NotImplementedError`.
- **Ключевые элементы:** `class RobokassaGateway(BasePaymentGateway)`, `name="robokassa"`.
- **Зависимости:** `acquiring/base.py`.
- **Где менять для типовых задач:** собрать redirect-URL `https://auth.robokassa.ru/Merchant/Index.aspx` с `OutSum/InvId/SignatureValue=MD5(MerchantLogin:OutSum:InvId:Password1)`; статус — `OpStateExt`; вебхук — `SignatureValue=MD5(OutSum:InvId:Password2)`.
- **Подводные камни:** **Заглушка.** Возвраты у Robokassa делаются только через ЛК/заявку — программный `refund` не предусмотрен (метод так и помечен). Подпись на MD5 (legacy-стиль), не SHA-256.
- **Строк:** 53

## `backend/app/services/acquiring_service.py`
- **Назначение:** Тонкий фасад над адаптерами эквайринга, связывающий их с моделью `ClinicPayment`. Создаёт локальную pending-запись, зовёт шлюз, сохраняет `gateway_payment_id`; обновляет статус по вебхуку; делает возврат.
- **Ключевые элементы (все async):**
  - `_get_active_config(db, clinic_id, gateway=None)` — берёт активный `PaymentGatewayConfig` клиники (если `gateway` не указан — первый `is_active=True`).
  - `init_clinic_payment(db, *, tenant_id, clinic_id, amount, description, return_url, patient_phone, patient_name, appointment_id, gateway, metadata) -> (ClinicPayment, payment_url)` — создаёт `ClinicPayment(status=PENDING)`, flush, зовёт `adapter.init_payment`, пишет `gateway_payment_id`+`gateway_init` в metadata, commit.
  - `update_clinic_payment_status(db, *, payment_id, status, paid_at, raw)` — проставляет статус, `paid_at` (на SUCCEEDED), `refunded_at` (на REFUNDED), складывает событие в `payment_metadata["webhook_events"]` (хранит последние 20).
  - `refund_clinic_payment(db, *, payment_id, amount=None)` — зовёт `adapter.refund`; **локальный статус не меняет** (это сделает вебхук).
- **Зависимости:** `app.models.payments_clinic` (`ClinicPayment`, `ClinicPaymentStatus`, `PaymentGatewayConfig`); `app.services.acquiring.get_gateway`; SQLAlchemy async.
- **Где менять для типовых задач:**
  - Поменять выбор шлюза «по умолчанию» — логика в `_get_active_config`.
  - Добавить данные в платёж (например `email`, чек 54-ФЗ) — расширь конструктор `ClinicPayment` в `init_clinic_payment` и `init_meta`.
  - Логика «что считать оплаченным» — `update_clinic_payment_status`.
- **Подводные камни:**
  - `init_meta` **передаёт `internal_payment_id`** в шлюз — это связь для последующего сопоставления вебхука; не убирай.
  - `NotImplementedError` от заглушек-адаптеров **пробрасывается наверх** — роутер должен ловить и отдавать 501; `LookupError` (нет активного шлюза) → роутер обычно отдаёт 400/404.
  - `amount` оборачивается в `Decimal(amount)` — но если вызывающий передаст float, `Decimal(float)` даст «грязное» значение; передавай `Decimal` или строку.
  - `tenant_id` хранится в `ClinicPayment`, но `_get_active_config` фильтрует **только по `clinic_id`** — мультитенантная изоляция конфигов держится на уникальности `clinic_id`; при возврате (`refund_clinic_payment`) tenant вообще не проверяется, только `payment.clinic_id`. Учитывай при доступе из роутера.
  - `webhook_events` режется до 20 последних — для долгой истории смотри сырьё в логах/раздельной таблице.
- **Строк:** 180

## `backend/app/services/activity_service.py`
- **Назначение:** Центральная точка записи действий пользователей в `ActivityLog`. Обогащает запись IP, User-Agent и гео-данными, и параллельно запускает проверку Region Lock (нарушение разрешённого региона франшизы).
- **Ключевые элементы:**
  - `_ip_from_request(request)` — достаёт IP: `request.state.client_ip` (ставит `device_detection_middleware`) → `x-real-ip` → `x-forwarded-for` → `request.client.host`.
  - `async log_activity(db, user, action, entity_type=None, entity_id=None, request=None)` — формирует `ActivityLog` и `db.add` (**без commit** — commit на вызывающей стороне). Если `request` не передан — берёт из ContextVar `app.core.request_ctx.current_request`. Гео-IP — `geoip_service.lookup(ip)` с graceful-degradation. Затем зовёт `region_lock_service.check_violation(...)`.
- **Зависимости:** `app.models.activity_log.ActivityLog`; лениво (внутри функции, ради разрыва циклов): `app.core.request_ctx.current_request`, `app.services.geoip_service`, `app.services.region_lock_service`.
- **Где менять для типовых задач:**
  - Добавить новое поле в лог (например `device_type`) — расширь конструктор `ActivityLog` здесь + миграцию модели.
  - Изменить порядок/источники определения IP — `_ip_from_request`.
  - Отключить/настроить Region Lock — блок `try` в конце `log_activity`.
- **Подводные камни:**
  - **Не делает commit** — если вызывающий роутер забудет закоммитить, лог потеряется.
  - `entity_id` приводится к `uuid.UUID` если это не UUID/None — передача невалидной строки бросит `ValueError` и **уронит весь вызов** (это не обёрнуто в try).
  - User-Agent режется до 500 символов.
  - Гео-IP и Region Lock обёрнуты в `except Exception: pass` — ошибки геолокации/региона никогда не валят основной поток (и не логируются явно — отладка вслепую).
  - `tenant_id` берётся с `user.tenant_id` для Region Lock — для системных/анонимных вызовов (user=None) проверка региона пропускается.
- **Строк:** 101

## `backend/app/services/acts_service.py`
- **Назначение:** Биллинг платформы (не клиники!). Генерация месячных **актов оказанных услуг** по подпискам тенантов: нумерация, расчёт сумм, статусы (generated→signed→paid→overdue→soft-lock), PDF через Jinja2+WeasyPrint, внутренняя электронная подпись.
- **Ключевые элементы:** `class ActsService` (все методы `@staticmethod`):
  - `_generate_act_number(slug, year, month, seq)` → `ACT-YYYY-MM-SLUG-0001`.
  - `_get_next_seq(db, year, month)` — счётчик по `LIKE` на `act_number`.
  - `generate_monthly_act(db, tenant_id, subscription, year, month)` — создаёт `Invoice` с `act_*` полями, line_items, периодом, due_date (+10 дней); дубль по `invoice_number` → `ValueError`.
  - `sign_act(...)` / `sign_act_electronic(...)` — перевод в `signed` (вторая — с user_id, внутренняя ЭП без КЭП, TODO: реальная ЭЦП).
  - `mark_paid(...)`, `check_overdue(db)` (просрочка > due_date → `overdue`, флаг `overdue_notified_at`), `apply_soft_lock(db)` (через `SOFT_LOCK_DAYS=21` дня → `soft_lock_applied_at`).
  - `list_acts(db, tenant_id, act_status, limit=50)`.
  - `generate_act_pdf(db, act_id)` — ищет инвойс по UUID **или** по `act_number`, рендерит шаблон `act.html`, **лениво импортирует WeasyPrint**, возвращает `bytes`.
  - Константы `ACT_OVERDUE_DAYS=14`, `SOFT_LOCK_DAYS=21`.
- **Зависимости:** `app.models.billing` (`Invoice`, `Subscription`), `app.models.tenant` (`Tenant`, `TenantBranding`); `jinja2` (Environment грузится один раз из `app/templates`), `weasyprint` (ленивый импорт), `calendar`.
- **Где менять для типовых задач:**
  - Формат номера акта — `_generate_act_number`.
  - НДС/налог — сейчас `tax_rate=Decimal("0")` захардкожен в `generate_monthly_act`; меняй там.
  - Сроки просрочки/блокировки — константы `ACT_OVERDUE_DAYS`/`SOFT_LOCK_DAYS`.
  - Внешний вид PDF — шаблон `app/templates/act.html` (контекст собирается в `generate_act_pdf`).
  - Реальная КЭП/ФНС — `sign_act_electronic` (там TODO).
- **Подводные камни:**
  - **Грубое смешение Decimal и float**: расчёт в `Decimal` (`base_amount`, `tax_amount`, `total`), но в `Invoice` всё пишется через `float(...)` — потенциальная потеря копеек; будь осторожен при сверках.
  - **Нет фильтрации по tenant_id в `_get_next_seq`** — счётчик последовательности глобальный по `ACT-YYYY-MM-` (slug добавляется в номер, но seq общий на всех тенантов за месяц). При параллельной генерации возможны гонки/коллизии номеров.
  - WeasyPrint импортируется лениво (системные libs pango/cairo могут отсутствовать) — если PDF падает на старте, это не здесь, а в окружении.
  - `generate_monthly_act` делает `commit` внутри — не транзакционно-нейтрален.
  - `act_status` проверяется строками (`"generated"`,`"sent"`,...) — нет enum, легко опечататься.
- **Строк:** 329

## `backend/app/services/ads_ai.py`
- **Назначение:** Вспомогательные функции рекламы: генерация URL картинки-плейсхолдера, поиск стоковых фото Unsplash, генерация набора prompt-ов для bulk-создания вариантов баннера.
- **Ключевые элементы:**
  - `async generate_image_url(prompt)` — **стаб**: дёргает `source.unsplash.com` (302-редирект, без ключа), возвращает `{"url", "provider", "error"?}`.
  - `async stock_search(query, page=1)` — `api.unsplash.com/search/photos`, требует env `UNSPLASH_ACCESS_KEY` (без ключа → `[]`).
  - `BULK_CTA_VARIANTS` — 5 пресетов CTA/тональности.
  - `bulk_variant_prompts(service_name, service_price=None)` — массив prompt+CTA для `/ads/bulk-generate`.
- **Зависимости:** `httpx`, `os`. Внешних моделей не трогает.
- **Где менять для типовых задач:**
  - Подключить реальную AI-генерацию (DALL·E/SD) вместо Unsplash-стаба — `generate_image_url`.
  - Изменить набор/тон вариантов bulk — `BULK_CTA_VARIANTS`.
- **Подводные камни:** `generate_image_url` — это **не настоящая AI-генерация**, а случайное фото Unsplash по ключевым словам; не вводи пользователя в заблуждение. Все сетевые вызовы в `try/except` возвращают graceful-fallback (`url=None` / `[]`) — ошибки молча проглатываются. Зависит от внешнего сервиса и env-ключа.
- **Строк:** 91

## `backend/app/services/ads_analytics.py`
- **Назначение:** Чистые (не привязанные к FastAPI) async-функции аналитики объявлений: воронка, тепловая карта активности, прогноз исчерпания бюджета.
- **Ключевые элементы:**
  - `_f(v)` — безопасный `Decimal/None → float`.
  - `async funnel_for_ad(db, ad)` — воронка показы→клики→конверсии по **денормализованным счётчикам** на `Ad` (`impressions_count`/`clicks_count`/`conversions_count`), считает CTR-rate, CPA, ROAS.
  - `async heatmap_for_ad(db, ad_id, event_type="click", days=30)` — `extract('dow'/'hour')` по `AdEvent`, нормализует Postgres dow (вс=0) → пн=0..вс=6; days клампится 1..365.
  - `async forecast_for_ad(db, ad)` — за 7 дней считает imp/clk в день, spend/day по `PricingModel` (CPC/CPM/FLAT), `days_left_budget` vs `days_left_calendar`, выдаёт `verdict` (`ok`/`no_data`/`budget_exhausting`/`budget_underspent`).
- **Зависимости:** `app.models.advertising` (`Ad`, `AdEvent`, `AdEventType`, `PricingModel`); SQLAlchemy (`select`, `func`, `extract`).
- **Где менять для типовых задач:**
  - Новая метрика воронки — `funnel_for_ad`.
  - Логика порогов «бюджет горит/недоосвоен» — коэффициенты `0.5`/`2` в `forecast_for_ad`.
  - Новая ценовая модель — ветка по `PricingModel` в `forecast_for_ad`.
- **Подводные камни:**
  - `funnel_for_ad` берёт данные из **денормализованных счётчиков `Ad`**, а `heatmap`/`forecast` — из живых строк `AdEvent`. Если счётчики разъехались с событиями, воронка и прогноз могут противоречить.
  - **Нет фильтрации по tenant_id** в запросах — изоляция держится на том, что `ad`/`ad_id` уже принадлежат нужному тенанту (проверка должна быть в роутере/выше). Не вызывай с чужим ad_id.
  - `extract("dow")` — Postgres-специфично (вс=0); на SQLite в тестах heatmap даст другую нумерацию.
  - Decimal→float через `_f` — для отображения ок, но не для денежных сверок.
- **Строк:** 155

## `backend/app/services/ads_substitute.py`
- **Назначение:** Маленький утилитный модуль: безопасная подстановка плейсхолдеров `{{key}}` в тексты баннеров (title/body) из контекста, плюс извлечение списка использованных переменных.
- **Ключевые элементы:**
  - `_VAR_RE` — regex `{{ key }}`.
  - `ALLOWED_VARS` — белый список (8 ключей: `patient_name`, `branch_phone`, `doctor_name`, `clinic_name`, `service_name`, `city` и др.).
  - `substitute(text, ctx)` — заменяет только разрешённые ключи; неизвестные/None остаются как `{{var}}` (graceful).
  - `extract_vars(text)` — set использованных разрешённых переменных.
- **Зависимости:** только `re`, `typing`. Изолированный модуль.
- **Где менять для типовых задач:** добавить новую подставляемую переменную — впиши ключ в `ALLOWED_VARS` (и обеспечь его наличие в `ctx` на стороне вызова).
- **Подводные камни:** белый список — это **защита от инъекции произвольных полей** в шаблон; не заменяй на «подставляй всё подряд». Ключи матчатся regex `[a-z_]+` — заглавные/цифры в имени переменной не сработают.
- **Строк:** 35

## `backend/app/services/aggregator_service.py`
- **Назначение:** Логика партнёрской программы агрегаторов (внешние площадки приводят пациентов): выпуск/хэширование API-ключей, поиск активного партнёрства, ведение статуса лидов и комиссий, статистика конверсии за период.
- **Ключевые элементы:**
  - `KEY_PREFIX = "agg_live_"`.
  - `generate_api_key() -> (plaintext, sha256_hash[:80], display)` — plaintext показывается **один раз**, в БД только sha256.
  - `hash_api_key(plaintext)` — sha256[:80].
  - `async find_active_partnership(db, plaintext_key)` — ищет `AggregatorPartnership` по хэшу, `status=="active"`.
  - `async update_lead_status(db, lead, new_status, appointment_id, commission_amount)` — обновляет лид (`flush`, **без commit**).
  - `_parse_period("30d") -> int`.
  - `async stats_for_period(db, tenant_id, period="30d")` — агрегирует лиды по статусам, считает `conversion_pct` (completed/total), `scheduled_pct`, `total_commission`.
- **Зависимости:** `app.models.aggregator` (`AggregatorPartnership`, `AggregatorLead`); `hashlib`, `secrets`; SQLAlchemy async.
- **Где менять для типовых задач:**
  - Формат/префикс ключа — `KEY_PREFIX` + `generate_api_key`.
  - Новые статусы лида / новые метрики — `stats_for_period`.
  - Логика привязки комиссии — `update_lead_status`.
- **Подводные камни:**
  - `stats_for_period` **фильтрует по tenant_id** через JOIN на `AggregatorPartnership.tenant_id` — это правильная изоляция; не убирай join.
  - `find_active_partnership` **не фильтрует по tenant_id** (ключ глобально уникален) — корректно для аутентификации входящего запроса по ключу, но дальше обязательно используй `partnership.tenant_id`.
  - `update_lead_status` делает только `flush`, не `commit` — коммит на вызывающей стороне.
  - `commission_amount` — `Decimal`; в `stats_for_period` суммируется как Decimal, но в ответ отдаётся `float(total_commission)` (для денежных сверок брать из БД, не из ответа).
  - sha256 обрезается до 80 символов (`[:80]`) — sha256 hex это 64 символа, так что обрезка фактически no-op, но если поле в БД короче — учитывай.
- **Строк:** 138

## `backend/app/services/ai_knowledge_service.py`
- **Назначение:** Дешёвый локальный поиск ответа в базе знаний (FAQ) **перед** дорогим вызовом LLM. Токенизирует вопрос, чистит стоп-слова, считает score совпадения по записям тенанта и платформы, возвращает лучшую запись выше порога и инкрементит счётчик попаданий.
- **Ключевые элементы:**
  - `RU_STOPWORDS` — большой set русских стоп-слов + «вежливые» слова чата клиники.
  - `MIN_TOKEN_LEN=2`, `_TOKEN_RE` (буквы рус/лат + цифры).
  - `_tokenize(text)` — lowercase + извлечение слов + отсев стоп-слов (без стемминга).
  - `_score(query_tokens, entry)` — доля токенов запроса, попавших в `keywords+question`, плюс бонус `priority*0.02`.
  - `async find_match(db, tenant_id, query, threshold=0.5) -> AIKnowledgeEntry | None` — грузит активные записи (свой тенант + платформенные `tenant_id IS NULL`), выбирает лучшую по score, при равенстве — по priority; если найдено — `entry.hits += 1` и commit.
- **Зависимости:** `app.models.ai_knowledge.AIKnowledgeEntry`; `re`, `logging`, `uuid`; SQLAlchemy (`select`, `or_`).
- **Где менять для типовых задач:**
  - Точность срабатывания — параметр `threshold` (по умолчанию 0.5) и формула `_score` (вес priority-бонуса).
  - Улучшить распознавание — расширить `RU_STOPWORDS` или заменить `_tokenize` на стемминг/эмбеддинги (сейчас сознательно простой подход для 50–500 записей).
  - Поведение для анонимного чата — ветка `tenant_id is None` (только платформенные записи).
- **Подводные камни:**
  - **Правильная tenant-изоляция**: `find_match` всегда добавляет `tenant_id IS NULL` (платформенный FAQ) к записям тенанта через `or_` — это by design, не баг; чужих тенантов не подмешивает.
  - `find_match` делает `commit` (на инкременте hits) — **это сайд-эффект чтения**: вызов «поиска» коммитит транзакцию; при ошибке делает rollback. Не вызывай внутри чужой незакоммиченной транзакции, иначе закоммитишь чужие изменения.
  - Score без нормализации длины записи — длинные записи с мусором в keywords могут давать ложные совпадения; priority-бонус (до +0.2) может перевесить слабый текстовый матч.
  - Не масштабируется на десятки тысяч записей (грузит все в память + Python-цикл) — для большой базы нужен полнотекст/эмбеддинги.
- **Строк:** 184
