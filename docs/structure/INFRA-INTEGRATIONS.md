# Инфраструктура и интеграции «КлиникСеть» (clinika)

Обзор развёртывания, внешних интеграций и переменных окружения мультитенантной МИС/SaaS-платформы. Источники: `docker-compose.yml`, `docker-compose.monitoring.yml`, `.env.example`, `backend/app/config.py`, `backend/Dockerfile`, `backend/requirements.txt`, `frontend/package.json` и срезы сервисного слоя `docs/structure/ref/services-01..09.md`.

> Это обзор инфраструктуры, не полный аудит безопасности. Где замечены конкретные риски — они отмечены, но детальный разбор уязвимостей выходит за рамки документа.

---

## 1. Архитектура развёртывания

Платформа разворачивается через Docker Compose. Основной стек (`docker-compose.yml`) — 6 сервисов в bridge-сети `clinika-net`; отдельный профиль мониторинга (`docker-compose.monitoring.yml --profile metrics`) подключается к той же сети как external.

### Основной стек (`docker-compose.yml`)

| Контейнер | Образ / сборка | Порт (host→cont) | Healthcheck | Тома | Зависит от |
|---|---|---|---|---|---|
| `clinika-db` | `postgres:16-alpine` | — (только в сети) | `pg_isready -U clinika` (10s/5s/5) | `clinika-db-data:/var/lib/postgresql/data` | — |
| `clinika-redis` | `redis:7-alpine` | — (только в сети) | `redis-cli ping` (10s/5s/5) | `clinika-redis-data:/data` | — |
| `clinika-docker-proxy` | build `./docker-proxy` | — (только в сети) | — | `/var/run/docker.sock:ro` | — |
| `clinika-backend` | build `./backend` (FastAPI/uvicorn) | `127.0.0.1:8900→8000` | `curl /health` (30s, start 40s) | `./VERSION:ro`, `/opt/clinika/uploads`, `/opt/clinika/data` | db (healthy), redis, docker-proxy |
| `clinika-frontend` | build `./frontend` (Vite→nginx) | `127.0.0.1:8901→80` | `wget/curl /` (30s, start 15s) | `/opt/clinika/downloads:ro` (Electron-инсталляторы) | — |
| `clinika-bot` | build `./bot` (python `bot.py`, PID 1) | — | `grep '^python' /proc/1/comm` (30s, start 20s) | — (env_file `.env`) | backend |

Особенности:
- **PostgreSQL 16** запускается с `pg_stat_statements` (shared_preload_libraries, track=all, max=10000) — для анализа запросов.
- **Порты привязаны к `127.0.0.1`** — backend (8900) и frontend (8901) не торчат наружу напрямую; снаружи их публикует обратный прокси/nginx хоста (вне compose).
- **docker-proxy как sidecar:** read-only доступ к Docker API без монтирования сокета в backend (для админ-команд Telegram-бота: health-чек контейнеров, рестарт). На сервере `bot/` и `docker-proxy/` собираются из исходников — в этом audit-клоне отсутствует только каталог `docker-proxy/` (есть лишь описание в compose), а `bot/` присутствует (`bot.py`, `Dockerfile`, `requirements.txt`).
- **Единая ротация логов:** json-file, max 20MB × 5 файлов на контейнер (~100MB лимит).
- **Тома данных хоста:** `/opt/clinika/uploads` (загрузки), `/opt/clinika/data` (мед.документы пациентов `patient_docs/`, файлы staff-chat, GeoIP mmdb, offset Telegram-поллера, VAPID-бэкап и т.п.), `/opt/clinika/downloads` (инсталляторы Electron-звонилки KliniknetCalls, раздаются nginx по `/downloads/`).
- **Запуск backend:** `Dockerfile` → `alembic upgrade heads && uvicorn app.main:app --proxy-headers --forwarded-allow-ips=*`. Миграции применяются при каждом старте. Образ python:3.11-slim + системные библиотеки WeasyPrint (pango/cairo/gdk-pixbuf/fonts-dejavu) для PDF.

### Фоновые задачи (внутри backend, APScheduler)
Бот — отдельный контейнер, но большая часть периодики живёт в backend-процессе как APScheduler-джобы (см. `app/main.py`):
- авто-подтверждение направлений по МИС (10 мин), синк платежей МИС (10 мин), LTV-пересчёт (ежедн. 04:00 UTC), генерация месячного «расходника» (1-е число 03:00 UTC);
- SLA-эскалация чатов (1 мин), очистка вложений staff-chat (30 мин), health-checks модулей (30 мин), security threat-scan (5 мин);
- owner-bot long-poll `getUpdates` (2 сек), воркер очереди вебхуков (1 мин), expire старых slot-офферов.

> NB: периодика в одном backend-процессе. In-memory дедуп алертов (`alert_service`, `region_lock`) и квоты не разделяются между воркерами — при масштабировании на несколько uvicorn-воркеров возможны дубли/рассинхрон.

### Стек мониторинга (`docker-compose.monitoring.yml`, профиль `metrics`)

| Контейнер | Образ | Порт | Назначение |
|---|---|---|---|
| `prometheus` | `prom/prometheus` | `127.0.0.1:9090` | сбор метрик, retention 30d, lifecycle API |
| `postgres-exporter` | `prometheuscommunity/postgres-exporter` | — | метрики PG (DSN с теми же кредами `clinika/clinika_pass`) |
| `redis-exporter` | `oliver006/redis_exporter` | — | метрики Redis |
| `node-exporter` | `prom/node-exporter` (pid:host) | — | метрики хоста (`/proc`, `/sys`) |
| `cadvisor` | `gcr.io/cadvisor/cadvisor` (privileged) | — | метрики Docker-контейнеров |
| `blackbox-exporter` | `prom/blackbox-exporter` | — | HTTP/TCP-пробы |

Сети мониторинга: своя `monitoring-net` + подключение к external-сети основного стека `clinika_clinika-net` (для доступа к `clinika-db`/`clinika-redis`). `uptime-kuma` управляется отдельно (`docker run`, не в compose). Конфиги `monitoring/prometheus.yml`/`blackbox.yml` в этом клоне отсутствуют (есть только ссылки на тома). Backend сам экспонирует метрики (зависимость `prometheus-client`). Backend и frontend также шлют ошибки в **Sentry** (`sentry-sdk` / `@sentry/react`).

### Поток данных (упрощённо)
```
Интернет → nginx хоста (TLS, домен клиниксеть.рф) →
  ├─ /            → clinika-frontend:80  (SPA, nginx)
  ├─ /api, /ws    → clinika-backend:8000 (FastAPI, --proxy-headers)
  └─ /downloads/  → clinika-frontend (статика инсталляторов)
clinika-backend ↔ clinika-db (asyncpg), clinika-redis (кеш/квоты/pub-sub/очереди), docker-proxy (Docker API)
clinika-backend → внешние API: эквайринг, ОФД, телефония, МИС Renovatio, AI (Anthropic/proxyapi/OpenAI), Telegram (через HTTP-прокси), SMTP, GeoIP
clinika-bot → Telegram (через прокси) ← делит .env с backend
```

---

## 2. Внешние интеграции

Все адаптеры живут в сервисном слое `backend/app/services/`. Архитектурный паттерн един для эквайринга, ОФД и телефонии: **абстрактный base-класс → реестр/фабрика → конкретные адаптеры**. Многие адаптеры — **заглушки** (`NotImplementedError`), реально работает по одному провайдеру на категорию.

### 2.1 Интернет-эквайринг (онлайн-оплата пациентов)
Контракт: `acquiring/base.py` (`BasePaymentGateway`); реестр `acquiring/registry.py` (регистрация в `acquiring/__init__.py`); фасад `acquiring_service.py` (связь с моделью `ClinicPayment`). Креды берутся из `PaymentGatewayConfig` клиники (UI «Настройки → Онлайн-оплата») либо из env как fallback.

| Интеграция | Файл-адаптер | Состояние | Назначение | Нужные env (fallback) |
|---|---|---|---|---|
| **ЮKassa** | `acquiring/yookassa_adapter.py` | ✅ рабочий | init/status/refund/webhook (API v3, httpx, Basic-auth, IP-allowlist вебхука) | `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`, `YOOKASSA_RETURN_URL` |
| Т-Банк (Tinkoff) | `acquiring/tinkoff_adapter.py` | ❌ заглушка | — (NotImplementedError) | — |
| Сбербанк | `acquiring/sber_adapter.py` | ❌ заглушка | — | — |
| CloudPayments | `acquiring/cloudpayments_adapter.py` | ❌ заглушка | — | — |
| Робокасса | `acquiring/robokassa_adapter.py` | ❌ заглушка | — | — |

> ЮKassa не подписывает вебхуки — защита только по IP-allowlist + перепроверка статуса через `GET /payments/{id}`. Креды эквайринга хранятся per-clinic в `PaymentGatewayConfig` (шифруются через `encryption_service`), а не в `.env` (env — только fallback).

### 2.2 ОФД / фискализация 54-ФЗ
Контракт: `fiscal/base.py` (`BaseOfdProvider`, DTO `FiscalReceiptData`); реестр `fiscal/registry.py` (регистрация в `fiscal/__init__.py`); фасад `fiscal_service.py` (pull чеков → `FiscalReceipt`, идемпотентность по ФД+ФН; функция обхода всех активных `OFDConfig` — `cron_pull_all_receipts`). Креды: приоритет `OFDConfig.config`/`api_key` → env.

| Интеграция | Файл-адаптер | Состояние | Назначение | Нужные env (fallback) |
|---|---|---|---|---|
| **Платформа ОФД** | `fiscal/platforma_ofd_adapter.py` | ✅ рабочий | auth Bearer (кеш+refresh на 401), send_receipt, status, постраничный pull чеков | `PLATFORMA_OFD_LOGIN`, `PLATFORMA_OFD_PASSWORD`, `PLATFORMA_OFD_API_BASE`, `COMPANY_INN`, `COMPANY_TAX_SYSTEM` |
| Атол.Онлайн | `fiscal/atol_online_adapter.py` | ❌ заглушка | — | — |
| Первый ОФД | `fiscal/perv_ofd_adapter.py` | ❌ заглушка | — | — |
| Такском | `fiscal/takskom_adapter.py` | ❌ заглушка | — | — |

> `cron_pull_all_receipts` (`fiscal_service.py:95`) реализована и отдельно ловит `NotImplementedError` от заглушек (логирует info, не падает), но в этом срезе **не подключена к APScheduler** — в `main.py` нет `add_job` на неё и её импорта, ни один роутер её не вызывает (одиночный `pull_clinic_receipts` вызывается вручную из роутера `fiscal_receipts.py`). Вероятно, запускается host-cron'ом или вручную — требует подтверждения. Фискальные модули продаются как коммерческий модуль `fiscal_54fz_pro` (seed `seed_payment_modules.py`). Адаптеры АТОЛ/Эвотор/Штрих для онлайн-касс могут жить отдельно в `integrations/fiscal` (вне этого среза).

### 2.3 Телефония
Контракт: `telephony/base.py` (`TelephonyProvider` ABC); фабрика `telephony/factory.py` (по `TelephonyConfig` тенанта, дешифровка кредов через `encryption_service`; неизвестный/пустой → `NullProvider`). Креды хранятся в `TelephonyConfig.api_key_encrypted`/`api_secret_encrypted` (per-tenant, зашифрованы), не в `.env`.

| Интеграция | Файл-адаптер | Состояние | Назначение / схема подписи |
|---|---|---|---|
| **Mango Office** | `telephony/mango.py` | ✅ рабочий | VPBX callback API, подпись `sha256(key+body+salt)`, статусы через webhook |
| **Sipuni** | `telephony/sipuni.py` | ✅ рабочий | callback API, подпись MD5 (требование Sipuni), запись по своей подписи |
| **Zadarma** | `telephony/zadarma.py` | ✅ рабочий | callback API, подпись `base64(hmac_sha1(...))`, запись в 2 шага |
| (нет провайдера) | `telephony/null.py` | заглушка-дефолт | «телефония не настроена» — безопасный fallback фабрики |

> Все три провайдера — callback-схема: АТС сама звонит на оба номера и соединяет (голос идёт на реальный телефон оператора, не в приложение). Запись звонков транскрибируется через Whisper (см. AI).

### 2.4 МИС-синхронизация (Renovatio)
Низкоуровневый клиент `mis_client.py` (`POST /api/public/<METHOD>` + `api_key` в form-body, tenacity-retry, обработка SSL/403). Резолвер кредов `mis_resolver.py` (клиника → тенант). Импорт справочников `mis_sync_service.py` (клиники/врачи/услуги). Синк платежей `mis_payments_sync.py` (в кассу/ledger). Исходящие вебхуки о подписках `mis_webhook_sender.py`. Авто-привязка пациента `patient_identifier.py`. LTV поверх МИС: `ltv_service.py` / `ltv_export_service.py`. Авто-подтверждение направлений: `auto_confirm.py`.

| Назначение | Файл | Нужные env / источник кредов |
|---|---|---|
| HTTP-транспорт Renovatio | `mis_client.py` | `MIS_API_KEY`, `MIS_SSL_VERIFY`, `MIS_CA_CERT_PATH`; per-tenant URL/ключ передаётся параметром |
| Резолв кредов клиника→тенант | `mis_resolver.py` | `Clinic.mis_*` → tenant settings (`mis_api_url`/`mis_api_key`) |
| Импорт справочников | `mis_sync_service.py` | per-tenant `mis_clinic_ids` + ключ |
| Синк платежей в кассу | `mis_payments_sync.py` | `commercial.TenantIntegration` (type='mis') |

> Per-tenant изоляция — критичный инвариант: глобальный `MIS_CLINIC_IDS` и захардкоженные списки клиник в прошлом протекали cross-tenant и переписаны на `Tenant.mis_clinic_ids` + per-tenant ключи. Премиум-методы Renovatio (`getPayments`/`getInvoices`/`getPrograms`/`getCalls`) возвращают 403 «No access» → NetLTV в Gross-only-деградации, разбор полей эвристический. Дефолт `DEFAULT_MIS_BASE = https://mis.stoclinic.ru:3010/api/public`.

### 2.5 AI-провайдеры
Три независимых AI-контура с каскадами и graceful-fallback (никогда не валят бизнес-логику):

| Интеграция | Файл-адаптер | Назначение | Нужные env |
|---|---|---|---|
| **Anthropic Claude** | `claude_service.py` | приоритетный AI кабинета врача (briefing, план лечения); модель `claude-sonnet-4-6` | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` (опц. прокси) |
| **OpenAI / Gemini** (через proxyapi) | `gemini_service.py` | AI-ассистент пациента; **приоритет — OpenAI `gpt-4o-mini` через proxyapi.ru**, Gemini direct — fallback (имя файла вводит в заблуждение) | `PROXYAPI_API_KEY` (приоритет), `GEMINI_API_KEY`, `GEMINI_PROXY_URL` |
| оркестратор кабинета врача | `doctor_ai_service.py` | каскад **Claude → Gemini → rule-based** | использует ключи выше |
| AI-чат пациента | `patient_chat_ai.py` | каскад **FAQ-база → Redis-кеш → LLM** (экономия токенов), дневной лимит | через `gemini_service` / `routers/ai` |
| локальный FAQ-поиск | `ai_knowledge_service.py` | дешёвый токен-матч до LLM | — |
| AI-генератор регламентов | `regulation_ai_service.py` | SOP через Gemini + rule-based fallback | как gemini |
| **OpenAI Whisper** | `whisper_service.py` | транскрипция записей звонков (`whisper-1`, ru), $0.006/мин | `OPENAI_API_KEY`/`WHISPER_API_KEY`, `HTTPS_PROXY`/`OPENAI_HTTPS_PROXY` |
| генерация картинок рекламы | `ads_ai.py` | стаб через Unsplash (не настоящий AI) | `UNSPLASH_ACCESS_KEY` |

> Anthropic SDK (`anthropic>=0.45.0`) — единственный AI-провайдер в `requirements.txt`; OpenAI/Gemini/Whisper вызываются «голым» httpx через proxyapi.ru/прокси (обход блокировок в ЧР). NB: в `claude_service.py` потенциальный `NameError` — `os` импортируется только внутри docstring, но используется в `_get_client` (проверить при правках).

### 2.6 Прочие внешние интеграции
- **Telegram** — два бота: admin/owner (`alert_service`, `tg_admin_bot`, `tg_owner_bot_poll`, `manager_notifier`, `staff_chat_mentions`). `api.telegram.org` заблокирован у провайдера → **все вызовы идут через HTTP-прокси** (`TELEGRAM_PROXY_URL`, дефолт-хардкод `clinikabot:...@144.31.89.167:8080`). owner-бот работает long-poll (webhook не достучаться).
- **SMTP** — `email_service.py` (welcome/reset-письма). Без `SMTP_HOST` — тихий no-op; в dev пишет токены/коды в лог.
- **Web Push (VAPID)** — `push_service.py` (pywebpush). Ключи из env или автогенерация в БД `vapid_keys`.
- **GeoIP** — `geoip_service.py` (geoip2, локальная mmdb GeoLite2/dbip в `/opt/clinika/data`).
- **WebRTC / TURN** — телемедицина и звонки (`telemed_signaling.py` через Redis Pub/Sub), coturn в режиме `use-auth-secret` (`TURN_*` env).
- **Партнёрская программа агрегаторов** — `aggregator_service.py` (входящие лиды по API-ключу).
- **rclone offsite-бэкап** — Yandex Cloud S3 (`RCLONE_REMOTE`), host-cron.

---

## 3. Переменные окружения (`.env.example` + `config.py`)

`.env` целиком прокидывается в backend и bot через `env_file`. Pydantic-settings (`config.py`) задаёт типы и дефолты; **`extra = "ignore"`** — лишние ключи в `.env` (большинство кредов интеграций) не валидируются конфигом, читаются напрямую из `os.environ` в адаптерах.

### Критичные / fail-fast (сервис не стартует без них)
| Переменная | Назначение | Заметка |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection | дефолт-креды `clinika:clinika_pass` |
| `REDIS_URL` | Redis (кеш, квоты, pub-sub, очереди) | |
| `SECRET_KEY` | подпись JWT + деривация Fernet-ключа шифрования секретов | **в example `change-me-in-production`** — при пустом ключе секреты лягут в БД в открытом виде (`plain:`) |
| `QR_SECRET` | подпись QR направлений | **example `change-me-qr-secret`** |
| `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` | учётка суперадмина | обязательны, без пароля pydantic роняет старт (хардкод убран) |

### Секретные (креды интеграций — компрометация = доступ к платежам/МИС/AI)
- Эквайринг: `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` (+ per-clinic в БД).
- ОФД: `PLATFORMA_OFD_LOGIN`, `PLATFORMA_OFD_PASSWORD`, `COMPANY_INN`.
- МИС: `MIS_API_KEY`, `MIS_CA_CERT_PATH` (+ per-tenant в БД).
- AI: `ANTHROPIC_API_KEY`, `PROXYAPI_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`/`WHISPER_API_KEY`.
- Telegram: `TELEGRAM_BOT_TOKEN`, `ADMIN_BOT_TOKEN`, `OWNER_BOT_TOKEN`, `OWNER_TELEGRAM_ID`, `TELEGRAM_PROXY_URL`.
- SMTP: `SMTP_USER`, `SMTP_PASSWORD`.
- Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
- Прочее: `TURN_SECRET`, `WEBHOOK_API_KEY`, `ONBOARDING_SECRET` (защита `/tenant/create`), `PII_HASH_PEPPER` (blind-hash PII, отдельно от SECRET_KEY).

### Прочие (конфигурация, не секреты)
`JWT_ALGORITHM` (HS256), `JWT_EXPIRE_HOURS` (24), `MINI_APP_URL`, `BACKEND_URL`, `MANAGER_TELEGRAM_IDS`, `MIS_SSL_VERIFY`, `ALLOWED_ORIGINS` (CORS, дефолт закрыт на prod-домены + localhost), `ENVIRONMENT` (production), `VAPID_CLAIM_EMAIL`/`VAPID_SUBJECT`, `SMTP_HOST`/`PORT`/`FROM`/`USE_TLS`/`STARTTLS`, `TURN_HOST`/`PORT`/`TTL`, `GEOIP_DB_PATH`, `SUPPLY_STORAGE_DIR`, `DATABASE_URL` для seed-скриптов.

### Sentry / мониторинг
`SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` (backend); `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT` (frontend — **запекаются в бандл build-arg, требуют пересборки**); `GRAFANA_ADMIN_PASSWORD`; `RCLONE_REMOTE`.

### ⚠️ ВАЖНО — техдолг безопасности
**На сервере файл `.env` отслеживается git** (зафиксировано в проектной памяти). Это значит, что все боевые секреты — креды БД, JWT/QR-секреты, токены платёжек/ОФД/МИС/AI, пароль суперадмина — попадают в историю репозитория `mr-khamzat/clinika`. Дополнительно:
- **Хардкод прокси-кредов** (`clinikabot:lT9k2Pq8mNxF5jB3@144.31.89.167:8080`) повторяется как fallback в 5 файлах: `alert_service.py`, `manager_notifier.py`, `tg_admin_bot.py`, `tg_owner_bot_poll.py`, `routers/owner_bot_webhook.py` — секрет прямо в коде, при ротации править во всех местах (легко пропустить пятый).
- В `.env.example` дефолты `SECRET_KEY`/`QR_SECRET` — `change-me-*`; при невыставленном `SECRET_KEY` шифрование секретов деградирует в `plain:`.
- `docker-compose.yml` и `docker-compose.monitoring.yml` содержат хардкод `clinika_pass` для PostgreSQL.

Рекомендации (вне рамок этого обзора, но критично): убрать `.env` из git (`git rm --cached` + `.gitignore` + ротация всех секретов), вынести прокси-креды в env без хардкод-fallback, задать сильные `SECRET_KEY`/`QR_SECRET`/`PII_HASH_PEPPER`.

---

## 4. Стек зависимостей и заметные версии/риски

### Backend (`requirements.txt`, Python 3.11)
- **Web/ORM:** FastAPI 0.115.14, uvicorn 0.32.1, SQLAlchemy 2.0.36 (async), Alembic 1.13.1, asyncpg 0.29 + psycopg2-binary 2.9.9, pydantic 2.10.6 / pydantic-settings 2.7.1.
- **Auth/крипто:** python-jose[cryptography] 3.4.0, passlib[bcrypt] 1.7.4.
- **Инфра/интеграции:** redis 5.0.4, httpx 0.28.1, python-telegram-bot 21.2, fastapi-limiter, apscheduler ≥3.10.4, tenacity ≥8.2, docker 7.1 (для docker-proxy), pywebpush 2.3, geoip2 4.8 / maxminddb 2.6.
- **AI:** `anthropic>=0.45.0` (единственный AI-SDK; остальные провайдеры — через httpx).
- **PDF/документы:** weasyprint 66.0 + pydyf 0.11 (требует системных pango/cairo — ставятся в Dockerfile, импортируются лениво), openpyxl 3.1.2, icalendar 5.0.13, jinja2 3.1.6, qrcode/Pillow, holidays.
- **Наблюдаемость:** structlog ≥24, prometheus-client ≥0.20, sentry-sdk[fastapi] 2.20.

### Frontend (`package.json`, версия 1.0.0)
- React 18.3 + react-dom, react-router-dom 6.24, Vite 5.4, Tailwind 3.4 + PostCSS/autoprefixer.
- Zustand 4.5 (state), axios 1.7, dompurify 3.4 (XSS-санитизация), @sentry/react 10.51.
- react-markdown 9 + rehype-raw + remark-gfm (рендер markdown), jspdf + jspdf-autotable (PDF на клиенте), `xlsx` (SheetJS, **подключён по прямому tarball-URL с cdn.sheetjs.com**, не из npm-registry), html5-qrcode/jsqr (сканер QR), material-symbols, @fontsource/inter+manrope.

### Заметные риски (обзорно, без дублирования аудита)
- **Версии-pin без верхней границы:** часть backend-зависимостей закреплены через `>=` (apscheduler, structlog, prometheus-client, tenacity, holidays, anthropic) — на свежих минорах возможны сюрпризы.
- **httpx `proxies=` (устарел):** `whisper_service.py` использует удалённый в новых httpx параметр `proxies=` — при непустом прокси на свежем httpx упадёт (соседние tg-сервисы уже на `proxy=`). Может «работать» локально без прокси и падать в проде.
- **Frontend tarball-зависимость:** `xlsx` тянется напрямую с CDN-URL, минуя lock/реестр npm — риск воспроизводимости/supply-chain (нет фиксации в lockfile реестра).
- **Заглушки интеграций:** 4 из 5 платёжек, 3 из 4 ОФД — `NotImplementedError`; реально работают только ЮKassa и Платформа ОФД. Выбор заглушки в рантайме → ошибка (роутер должен мапить в 501/503).
- **Frontend Sentry build-time:** DSN запекается в бандл при сборке (build-arg) — смена требует `build --no-cache` + redeploy фронта.
- **Alembic при каждом старте:** `alembic upgrade heads` в CMD контейнера — старт зависит от успешности миграций; при множественных head'ах используется `heads` (мн.ч.).
- **PostgreSQL-специфика:** много сырого SQL (`to_regclass`, `extract('dow')`, `pg_advisory_xact_lock`, `DISTINCT ON`, `pg_insert ON CONFLICT`) — локальные SQLite-тесты не покрывают эти пути; обязателен прогон на Postgres перед релизом.
