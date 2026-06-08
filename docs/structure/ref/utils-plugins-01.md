# utils-plugins [01] — плагин-инфраструктура и stateless-утилиты backend

Этот срез — два соседних, но разных по назначению пакета бэкенда МИС:

- **`backend/app/plugins/`** — лёгкая plugin-система: абстрактный базовый класс `BasePlugin`, синглтон-реестр `plugin_registry` и три конкретных плагина (MIS-интеграция, SMS, Telegram-уведомления). Плагины регистрируются один раз при старте приложения в `main.py::_register_plugins()` и затем достаются по имени через `plugin_registry.get("mis"|"sms"|"notify")`. Каждый плагин самодостаточен, лениво подтягивает зависимости (httpx, mis_client) внутри методов и обязан уметь отвечать на `is_enabled()` / `health_check()` — на этом строится дашборд мониторинга интеграций.
- **`backend/app/utils/`** — набор чистых stateless-хелперов без состояния домена: разбор User-Agent, извлечение IP, нормализация/маскирование телефонов, проверка сложности пароля, per-endpoint rate-limit на Redis и коллектор метрик запросов (тоже Redis). Эти модули импортируются повсеместно (роутеры, middleware, сервисы) и НЕ зависят от tenant/clinic — они работают на уровне инфраструктуры.

Общая инженерная идея среза: всё, что касается внешних провайдеров и сквозной инфраструктуры (Redis, Telegram, SMS, GeoIP, метрики), изолировано здесь, чтобы доменные роутеры оставались тонкими. Ошибки во всех инфраструктурных вызовах «проглатываются» (try/except → пустой результат / False), чтобы сбой Redis или провайдера не ронял основной запрос.

## Оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `backend/app/plugins/base.py` | Абстрактный базовый класс плагина | 24 |
| `backend/app/plugins/registry.py` | Синглтон-реестр плагинов по имени | 28 |
| `backend/app/plugins/mis/plugin.py` | Прокси к МИС Renovatio | 78 |
| `backend/app/plugins/notify/plugin.py` | Telegram-уведомления админу/контакт-форма | 89 |
| `backend/app/plugins/sms/plugin.py` | SMS-провайдеры (stub/SMSC/SMS.ru) | 100 |
| `backend/app/utils/device.py` | Тип устройства по User-Agent | 84 |
| `backend/app/utils/geo.py` | IP клиента из заголовков прокси | 40 |
| `backend/app/utils/metrics.py` | Коллектор метрик запросов на Redis | 269 |
| `backend/app/utils/password_strength.py` | Минимальная проверка сложности пароля | 36 |
| `backend/app/utils/phone.py` | Нормализация и маскирование телефонов | 54 |
| `backend/app/utils/rate_limit.py` | Per-endpoint rate-limit + honeypot | 105 |

---

## `backend/app/plugins/base.py`
- **Назначение:** Определяет контракт любого плагина — абстрактный класс `BasePlugin`, от которого наследуются MIS/SMS/Notify (и `ReviewsPlugin` из соседнего пакета). Контракт минимален: имя, человекочитаемое имя, описание и два async-метода.
- **Ключевые элементы:**
  - `class BasePlugin(ABC)` — атрибуты-классы `name`, `display_name`, `description` (переопределяются в подклассе).
  - `@abstractmethod async is_enabled() -> bool` — плагин включён и сконфигурирован (проверка ключей/настроек).
  - `@abstractmethod async health_check() -> dict` — возвращает `{"ok": bool, "detail": str, ...}`.
- **Зависимости:** только `abc` (stdlib). Базовый кирпич — импортируется всеми плагинами и `registry.py`.
- **Где менять для типовых задач:** чтобы добавить общий для всех плагинов метод/атрибут (например, `category` или `async def configure()`) — правь здесь, новое поле станет частью контракта. Добавление нового абстрактного метода ОБЯЗАТЕЛЬНО потребует реализации во всех 4 плагинах (mis/sms/notify/reviews), иначе они перестанут инстанцироваться.
- **Подводные камни:** оба метода async — реализации обязаны быть `async def`. Атрибуты — на уровне класса, не в `__init__`; если плагину нужно состояние на экземпляр, добавляй `__init__` в подклассе.
- **Строк:** 24

## `backend/app/plugins/registry.py`
- **Назначение:** Глобальный синглтон-реестр плагинов. Хранит плагины в dict по `plugin.name`, регистрация — при старте приложения, доступ — по имени из любого места кода.
- **Ключевые элементы:**
  - `class PluginRegistry` с методами `register(plugin)`, `get(name) -> BasePlugin | None`, `all() -> list`, `__iter__`.
  - `plugin_registry = PluginRegistry()` — модульный синглтон, импортируется везде как `from app.plugins.registry import plugin_registry`.
- **Зависимости:** `app.plugins.base.BasePlugin` (типизация).
- **Где менять для типовых задач:**
  - Регистрация нового плагина — НЕ здесь, а в `main.py::_register_plugins()` (строки ~206-214) плюс отдельная регистрация `ReviewsPlugin` в `main.py:1850-1852`.
  - Чтобы добавить выборку плагинов по категории/фильтру — добавляй метод сюда.
- **Подводные камни:** реестр — глобальное mutable-состояние в памяти процесса. При нескольких воркерах (gunicorn/uvicorn workers) каждый процесс держит СВОЙ реестр — это нормально, т.к. плагины stateless. Регистрация по `plugin.name`: два плагина с одинаковым `name` затрут друг друга молча.
- **Строк:** 28

## `backend/app/plugins/mis/plugin.py`
- **Назначение:** Обёртка-плагин над сервисом `app.services.mis_client` (интеграция с МИС Renovatio). Даёт единую точку доступа к МИС через `plugin_registry.get("mis")` и общий health-check. Существующие роутеры по-прежнему могут импортировать `mis_client` напрямую — плагин не ломает совместимость.
- **Ключевые элементы:**
  - `class MISPlugin(BasePlugin)` — `name="mis"`.
  - `is_enabled()` → `bool(settings.mis_api_key)`.
  - `health_check()` → дёргает `get_clinics()`, отдаёт число клиник.
  - Прокси-методы: `get_services(clinic_id)`, `find_patient(phone)`, `get_appointments(clinic_id, date_from, date_to)`, `get_clinics()`, `get_patient_prescriptions(phone)`.
- **Зависимости:** `app.plugins.base.BasePlugin`, `app.config.settings` (флаг `mis_api_key`), ленивые импорты из `app.services.mis_client` (`get_clinics`, `get_services`, `find_patient_by_phone`, `get_appointments`, `_post`). Потребители: `routers/prescriptions.py:86`, `routers/telemedicine.py:281`.
- **Где менять для типовых задач:**
  - Добавить новый прокси-метод к МИС — сюда (по образцу: ленивый импорт из `mis_client`, await, вернуть результат).
  - Реализовать реальные назначения/рецепты — метод `get_patient_prescriptions` сейчас МЯГКАЯ ЗАГЛУШКА: пытается дёрнуть гипотетический эндпоинт `getPatientPrescriptions` через `mis_client._post`, при 404/исключении возвращает `[]`. Когда МИС опубликует метод — правь здесь.
- **Подводные камни:**
  - Все импорты `mis_client` — ленивые (внутри методов), чтобы не тянуть зависимость при импорте плагина; не выноси наверх.
  - `get_patient_prescriptions` использует приватный `_post` из mis_client — это легально внутри проекта, но завязка на внутренний API сервиса.
  - `patient_id` достаётся как `patient.get("patient_id") or patient.get("id")` — два возможных ключа, формат ответа МИС нестабилен.
  - tenant_id здесь не фигурирует — работа идёт по `clinic_id` из МИС, а не по внутреннему tenant.
- **Строк:** 78

## `backend/app/plugins/notify/plugin.py`
- **Назначение:** Telegram-уведомления администраторам и для контакт-формы. Извлекает логику отправки из `routers/contact.py` в переиспользуемый плагин. Использует тот же `TELEGRAM_BOT_TOKEN`, что и Telegram Mini App.
- **Ключевые элементы:**
  - `class NotifyPlugin(BasePlugin)` — `name="notify"`.
  - `is_enabled()` → токен задан и не равен плейсхолдеру `"YOUR_BOT_TOKEN_HERE"`.
  - `health_check()` → вызывает Telegram `getMe`.
  - `send_message(chat_id, text, parse_mode="HTML")` → POST `sendMessage`.
  - `notify_admin(text)` → шлёт главному админу (`settings.admin_telegram_id`, дефолт-хардкод `293633093`).
  - `notify_contact_form(phone, email, name, message)` → форматирует HTML-карточку обращения, экранирует через `html.escape`, шлёт админу.
- **Зависимости:** `app.plugins.base.BasePlugin`, `app.config.settings` (`telegram_bot_token`, `admin_telegram_id`), `httpx` (ленивый), `html`, `logging`. Потребитель: `routers/contact.py` (исторически логика была там).
- **Где менять для типовых задач:**
  - Сменить получателя/формат уведомления контакт-формы — `notify_contact_form`.
  - Добавить системные уведомления (например, о новой записи) — добавляй метод `notify_*`, вызывай `send_message`/`notify_admin`.
  - Захардкоженный `admin_telegram_id` дефолт `293633093` — лучше вынести в `.env`/config.
- **Подводные камни:**
  - **БАГ (строка 37):** в `health_check` — `f"Бот @{bot.get(username)} активен"`, где `username` — НЕопределённая переменная (NameError при успешном `getMe`). Должно быть `bot.get("username")`. Health-check Telegram сейчас падает в except и вернёт `{"ok": False}` вместо успеха. Чинить здесь.
  - HTML parse_mode по умолчанию — поэтому пользовательский ввод обязательно через `html.escape` (сделано в `notify_contact_form`); при добавлении новых полей не забыть экранировать.
  - Все сетевые вызовы в try/except → при ошибке возвращается False/`{"ok": False}`, исключение наружу не пробрасывается.
- **Строк:** 89

## `backend/app/plugins/sms/plugin.py`
- **Назначение:** SMS-плагин с выбором провайдера через `SMS_PROVIDER` в `.env`. Поддерживает `stub` (только лог), `smsc` (SMSC.ru), `smsru` (SMS.ru). Значение `telegram` упомянуто в докстринге как fallback-идея, но в коде НЕ реализовано (нет ветки) — фактически неизвестный провайдер → warning + False.
- **Ключевые элементы:**
  - `class SMSPlugin(BasePlugin)` — `name="sms"`.
  - `is_enabled()` → `provider != "stub"`.
  - `health_check()` → ok только если провайдер не stub.
  - `send(phone, message) -> bool` — диспетчер по провайдеру.
  - Приватные `_send_smsc(phone, message)` (GET `smsc.ru/sys/send.php`), `_send_smsru(phone, message)` (GET `sms.ru/sms/send`).
- **Зависимости:** `app.plugins.base.BasePlugin`, `app.config.settings` (`sms_provider`, `smsc_login`, `smsc_password`, `smsru_api_id` — все через `getattr` с дефолтами), `app.utils.phone.mask_phone` (маскирование номера в логах), `httpx` (ленивый), `logging`.
- **Где менять для типовых задач:**
  - Подключить реальную отправку SMS — задать `SMS_PROVIDER=smsc|smsru` и креды в `.env`; код провайдеров уже готов.
  - Добавить нового провайдера (например, Twilio) — добавь ветку в `send()` и приватный метод `_send_<provider>`.
  - Реализовать обещанный `telegram`-fallback — добавь ветку `if provider == "telegram"` (можно через `plugin_registry.get("notify")`).
- **Подводные камни:**
  - В `stub`-режиме `send()` возвращает **False** (не True!) — «успехом» считается только реальная доставка. Вызывающий код не должен трактовать stub как отправленное.
  - Креды читаются через `getattr(settings, ..., "")` — если поля нет в config, молча пустая строка и отправка не пройдёт (логируется error).
  - Все вызовы в try/except → провайдерская ошибка не пробрасывается, возвращается False.
  - В логи попадает только `mask_phone(phone)` — соблюдение 152-ФЗ.
- **Строк:** 100

## `backend/app/utils/device.py`
- **Назначение:** Определение типа устройства и базовой ОС/браузера по строке User-Agent. Без внешних зависимостей — простой substring-matching по нижнему регистру. Используется в `device_detection_middleware` (`main.py:1576+`).
- **Ключевые элементы:**
  - `class DeviceType(str, Enum)` — `MOBILE | TABLET | DESKTOP | BOT | UNKNOWN`.
  - Кортежи паттернов: `_BOT_PATTERNS`, `_TABLET_PATTERNS`, `_MOBILE_PATTERNS`.
  - `parse_user_agent(user_agent) -> DeviceType` — приоритет: bot → tablet → mobile → desktop.
  - `get_device_info(user_agent) -> dict` — расширенно: `device_type`, `os`, `browser`, `is_mobile`, `is_bot`.
- **Зависимости:** только `enum` (stdlib). Потребитель: `main.py` (device middleware).
- **Где менять для типовых задач:**
  - Распознавать новое устройство/бота — добавь подстроку в соответствующий кортеж `_*_PATTERNS`.
  - Добавить новую ОС/браузер — расширь блоки `if` в `get_device_info`.
- **Подводные камни:**
  - Порядок проверок важен: bot проверяется ПЕРВЫМ (иначе бот с «android» в UA посчитается mobile). Tablet — раньше mobile (iPad содержит «mobile»-подобные токены — но именно поэтому tablet выше).
  - Браузер Chrome детектится как `"chrome" in ua and "safari" in ua` — типичный Chrome UA содержит и то, и то; Edge может ошибочно попасть в Chrome (Edge-ветка идёт ПОСЛЕ Chrome-ветки в elif — Edge на Chromium содержит «chrome», поэтому распознается как Chrome, а не Edge). Если важна точность по Edge — поправь порядок.
  - Эвристика приблизительная, не использовать для биллинга/безопасности.
- **Строк:** 84

## `backend/app/utils/geo.py`
- **Назначение:** Извлечение реального IP клиента из заголовков (за nginx-прокси) и проверка «внутренний ли это IP». GeoIP как такового нет — город определяется через поле `city`/`city_id` на модели `Clinic`, а не по IP.
- **Ключевые элементы:**
  - `get_client_ip(request) -> str | None` — порядок: `X-Real-IP` → `X-Forwarded-For` (первый из списка) → `request.client.host`.
  - `is_internal_ip(ip) -> bool` — проверка по префиксам приватных диапазонов (`127.`, `10.`, `192.168.`, `172.16.`–`172.31.`, `::1`, `localhost`). `None` считается внутренним.
- **Зависимости:** `fastapi.Request`. Используется в гео/аналитике.
- **Где менять для типовых задач:**
  - Изменить логику доверия прокси-заголовкам — `get_client_ip`.
  - Подключить настоящий GeoIP (geoip2/MaxMind) — добавь сюда функцию `lookup_city(ip)` (в докстринге уже заложен план).
- **Подводные камни:**
  - **ДУБЛЬ:** идентичная по сути функция `get_client_ip` есть также в `rate_limit.py` (другая реализация — там одной цепочкой `or`). Две версии IP-логики в проекте; при правке доверия прокси нужно править ОБА места.
  - `X-Forwarded-For` берётся первым элементом списка — он клиентский, но легко подделывается. Доверять только если nginx переписывает заголовок.
  - `is_internal_ip(None) -> True` — учитывай при фильтрации аналитики (отсутствие IP = «внутренний»).
- **Строк:** 40

## `backend/app/utils/metrics.py`
- **Назначение:** Self-contained коллектор метрик HTTP-запросов и health-снимков на Redis (этап 10 — Monitoring drill-down). Пишет каждый запрос в sorted-set с 24-часовым окном, агрегирует p50/p95/p99, top-endpoints, таймсерии по минутам/часам. Redis-клиент создаётся лениво, не зависит от startup.
- **Ключевые элементы:**
  - `WINDOW_SECONDS = 24*3600`, `MAX_HEALTH_SNAPSHOTS = 288`.
  - `_get_redis()` — ленивый синглтон Redis (`redis.asyncio.from_url`, таймауты 2с).
  - `set_redis_client(r)` — инъекция клиента (обратная совместимость с `main.py:1120`).
  - `async record_request(method, path, status, latency_ms)` — пишет в zset `metrics:requests`, нормализует UUID в пути → `/{id}`, чистит старше окна. Игнорирует `/docs`, `/redoc`, `/openapi`, `/monitoring/system`.
  - `async save_health_snapshot(snapshot)` — push в list `metrics:health_snapshots`, trim до 288.
  - `_parse_value(value)` — парсит строку метрики (поддержка старого 4-польного и нового 5-польного формата).
  - `async get_request_metrics(window_minutes=60)` — поминутная агрегация.
  - `async get_request_metrics_hourly(hours=24)` — почасовая агрегация (для 24h-дашборда).
  - `async get_health_history(limit=12)` — последние health-снимки.
- **Зависимости:** `redis.asyncio` (ленивый), `app.config.settings.redis_url`, stdlib (`time`, `json`, `re`, `asyncio`, `collections.defaultdict`). Потребители: middleware `request_metrics_middleware` (`main.py:1569` → `record_request`), `main.py:1120` (`set_redis_client`), `routers/monitoring.py:574-594` (`save_health_snapshot`, метрики-эндпоинты).
- **Где менять для типовых задач:**
  - Добавить новую агрегацию/метрику (например, по tenant или по user-agent) — расширь формат `value` в `record_request` (добавь поле в конце через `|`) и обнови `_parse_value`. Формат намеренно расширяемый.
  - Изменить окно хранения — `WINDOW_SECONDS` / `MAX_HEALTH_SNAPSHOTS`.
  - Исключить ещё какие-то пути из метрик — список префиксов в начале `record_request`.
- **Подводные камни:**
  - Все операции обёрнуты в try/except и молча проглатывают ошибки → при недоступном Redis метрики просто пропадают, запрос не падает.
  - Формат строки метрики — позиционный pipe-separated (`method|path|status|latency|ts`). НЕ меняй порядок существующих полей, только добавляй в конец — иначе `_parse_value` сломает старые записи в Redis.
  - UUID-нормализация в пути по регэкспу — числовые ID (например `/patients/42`) НЕ нормализуются и будут размножать endpoint-ключи; если нужно — добавь паттерн.
  - `record_request` пишет два zset-pipeline команды на каждый запрос — при очень высоком RPS нагружает Redis; окно 24h × все запросы может вырасти.
  - В health-снимках `json.dumps(..., default=str)` — Decimal/datetime сериализуются строкой.
- **Строк:** 269

## `backend/app/utils/password_strength.py`
- **Назначение:** Единая проверка минимальной сложности пароля. Применяется во всех endpoints, где задаётся НОВЫЙ пароль (регистрация, смена, админская выдача). НЕ применяется при login.
- **Ключевые элементы:**
  - Константы `_MIN_LEN = 8`, `_SPECIAL_CHARS`.
  - `validate_password_strength(password) -> str` — бросает `ValueError` при нарушении, иначе возвращает сам пароль (удобно для chaining в Pydantic `field_validator`). Требования: длина ≥ 8, ≥ 1 буква, ≥ 1 цифра ИЛИ спецсимвол.
- **Зависимости:** нет (чистый stdlib). Вызывается из Pydantic-схем (`field_validator`) и/или сервисов авторизации.
- **Где менять для типовых задач:**
  - Ужесточить/смягчить политику паролей — правь константы и проверки тут; изменение применится сразу везде, где используется validator.
  - Локализация сообщений — текст `ValueError` здесь (сообщения на русском, идут пользователю).
- **Подводные камни:**
  - Бросает `ValueError`, а не `HTTPException` — рассчитано на Pydantic-валидатор (он сам превратит в 422). Если вызывать вне Pydantic — оборачивай в try/except.
  - Намеренно НЕ требует смесь регистров (см. докстринг) — это решение задокументировано, не «забыли».
- **Строк:** 36

## `backend/app/utils/phone.py`
- **Назначение:** Единая нормализация и маскирование телефонных номеров для всего проекта (замена дублированного кода в сервисах). Нормализация к формату `7XXXXXXXXXX`, генерация вариантов для поиска в БД, маскирование PII в логах.
- **Ключевые элементы:**
  - `normalize_phone(phone) -> str` — оставляет только цифры; 10 цифр → префикс `7`; 11 цифр с `8` → `7...`.
  - `phone_variants(phone) -> list[str]` — `[7..., +7..., 8...]` без дублей, с сохранением порядка (для поиска в БД, где номер мог сохраниться в разных форматах).
  - `mask_phone(phone) -> str` — `+79991234567` → `+7999***4567`; короткие → `XX***`; пусто → `∅` (152-ФЗ: хвост виден для саппорта, середина скрыта).
  - `mask_name(name) -> str` — `'Иван Петров'` → `'Иван П.'`; пусто → `∅`.
- **Зависимости:** нет (чистый stdlib). Потребители: `plugins/sms/plugin.py` (`mask_phone`), сервисы поиска пациентов, логгеры — широко по проекту.
- **Где менять для типовых задач:**
  - Поддержать новый формат ввода номера — `normalize_phone`.
  - Добавить вариант хранения для поиска — `phone_variants`.
  - Изменить степень маскирования в логах — `mask_phone` / `mask_name`.
- **Подводные камни:**
  - `normalize_phone` не валидирует номер — мусорный ввод вернётся как есть (после удаления нецифр). Для строгой проверки нужна отдельная валидация.
  - Поиск пациента по телефону должен идти по `phone_variants`, а не по сырому вводу — иначе записи в старом формате (`8...`, `+7...`) не найдутся. Это ключевая причина существования файла.
  - Маскирование — для логов, не для UI; не показывай `∅`/`***` пользователю.
- **Строк:** 54

## `backend/app/utils/rate_limit.py`
- **Назначение:** Per-endpoint rate-limit на Redis (sliding window) в виде FastAPI-зависимости + honeypot-проверка форм. При недоступном Redis — деградирует на in-memory fallback (на процесс).
- **Ключевые элементы:**
  - `get_client_ip(request) -> str` — IP с учётом прокси (`x-real-ip` / `x-forwarded-for` / `request.client.host`).
  - `_MEMORY: dict` + `_check_memory(key, limit, window)` — in-memory sliding window, с авто-очисткой при > 50000 ключей.
  - `async _check_redis(key, limit, window)` — Redis zset sliding window; при исключении → `_check_memory` (fallback).
  - `rate_limit_dep(bucket, limit, window, key_fn=None, error_message=...) -> Callable` — фабрика FastAPI-зависимости; при превышении кидает `429` с `Retry-After`.
  - `check_honeypot(value, field_name="website_url") -> None` — если honeypot-поле заполнено (бот) → `403`.
- **Эндпоинты:** не роутер (нет своих маршрутов), а инфраструктура. Подключается как `dependencies=[Depends(rate_limit_dep('booking', 10, 600))]`. Фактические потребители: `routers/contact.py`, `routers/monitoring.py`, `routers/public_booking.py`.
- **Зависимости:** `fastapi` (`HTTPException`, `Request`, `status`), `redis.asyncio` (ленивый, внутри `_check_redis`), `app.config.settings.redis_url`, stdlib (`time`, `typing`).
- **Где менять для типовых задач:**
  - Навесить лимит на новый endpoint — НЕ здесь, а в самом роутере: `dependencies=[Depends(rate_limit_dep('<bucket>', <limit>, <window>))]`. Выбирай уникальный `bucket`, иначе счётчики смешаются между эндпоинтами.
  - Лимитировать не по IP, а по другому ключу (например, телефон/user_id) — передай `key_fn`.
  - Изменить логику окна/хранилища — `_check_redis` / `_check_memory`.
- **Подводные камни:**
  - **ДУБЛЬ `get_client_ip`:** вторая реализация (отличная по коду) живёт в `utils/geo.py`. При изменении доверия прокси-заголовкам правь оба файла.
  - In-memory fallback — ПОПРОЦЕССНЫЙ: при нескольких воркерах лимит на воркер, а не глобальный. Кросс-процессно работает только Redis-путь. Также при рестарте процесса memory-счётчики обнуляются.
  - `_check_redis` создаёт новое соединение `from_url` НА КАЖДЫЙ вызов и закрывает (`aclose`) — на горячих эндпоинтах это оверхед; кандидат на пул/синглтон.
  - Член zset формируется как `f"{now}:{id(pipe)}"` — `id(pipe)` для уникальности в рамках процесса; теоретически возможны коллизии, но на практике редки.
  - `check_honeypot` срабатывает на ЛЮБОЕ непустое значение — honeypot-поле в форме обязано быть скрыто (`display:none` / `tabindex=-1`), иначе живые пользователи получат 403.
- **Строк:** 105
