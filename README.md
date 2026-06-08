# КлиникСеть (clinika)

Мультитенантная **МИС/SaaS-платформа для сети медицинских клиник**: FastAPI + React, **~263 000 строк кода**, **7 ролевых кабинетов** поверх единого ядра изоляции тенантов. Один монолитный бэкенд (~181 файл роутеров / **161 подключение** через `include_router`, ~129 сервисов, ~105 ORM-моделей) и один SPA обслуживают всю сеть клиник, разводя их по slug-у тенанта в URL.

> Это **главная точка входа для нового разработчика**. Детальные обзоры по слоям — в [карте документации](#7-документация). Прежде чем менять код — прочитайте [`docs/structure/HOWTO-CHANGE.md`](docs/structure/HOWTO-CHANGE.md) и раздел [«Состояние и безопасность»](#8-состояние-и-безопасность) ниже.

| | |
|---|---|
| **Стек** | FastAPI 0.115 · SQLAlchemy 2.0 async · PostgreSQL 16 · Redis 7 · React 18 · Vite 5 · Tailwind 3 |
| **Развёртывание** | Docker Compose (6 контейнеров) · backend `127.0.0.1:8900` · frontend `127.0.0.1:8901` |
| **Прод** | `212.57.118.126`, каталог `/opt/clinika`, приватный репозиторий `mr-khamzat/clinika` |
| **Статус** | Функционален, в проде. Прошёл аудит → **89 находок** (2 critical + 18 high + 25 medium + 33 low) |

---

## Оглавление

1. [Что это](#1-что-это) · 2. [Возможности](#2-возможности) · 3. [Стек](#3-технологический-стек) · 4. [Архитектура](#4-архитектура) · 5. [Структура репозитория](#5-структура-репозитория) · 6. [Быстрый старт](#6-быстрый-старт) · 7. [Документация](#7-документация) · 8. [Состояние и безопасность](#8-состояние-и-безопасность) · 9. [Конвенции и как менять код](#9-конвенции-и-как-менять-код)

---

## 1. Что это

«КлиникСеть» — платформа для **франшизной сети** медицинских клиник. Бизнес-ядро — **реферальная воронка**: клиники направляют пациентов друг к другу, за подтверждённые направления начисляются бонусы, платформа и франшиза берут split. Вокруг этого надстроены онлайн-запись, медкарта, телемедицина, лаборатория, склад, телефония, AI-ассистенты, биллинг и сквозная аналитика.

**Иерархия данных:** `Платформа → Франшиза → Тенант → Клиника`. Каждый тенант — точка/город франшизы; изоляция между тенантами держится в основном на ручной фильтрации `tenant_id` в коде (см. [риски](#8-состояние-и-безопасность)).

### Семь кабинетов

| Кабинет | Роль(и) `UserRole` | Точка входа (URL) | Назначение |
|---|---|---|---|
| **Платформа** | `super_admin` | `/admin` (PLATFORM_MODE) | Управление всеми тенантами/франшизами: биллинг платформы, churn, health-score, feature-flags, ARR/LTV, cost-attribution, мониторинг, журнал безопасности, RBAC-матрица, impersonation (RFC 8693), wiki |
| **Франшиза** | `franchise_owner` | `/{slug}/admin` | Кабинет владельца франшизы: P&L сети, перелив пациентов между клиниками, gap-анализ модулей, биллинг от платформы, создание клиник, рекрутеры, контракты партнёров |
| **Директор сети** | `director`, `deputy_director` | `/{slug}/director/*` | Read-only аналитика сети: P&L / ДДС (cashflow) / KPI / маркетинг / клиники / врачи / услуги, network-dashboard, patient-engagement |
| **Управляющий** | `manager` (часть — `reg`) | `/{slug}/manager/*` | Операционка клиники: услуги, персонал, склад (остатки/партии/приходы), лояльность, лаборатория, телефония, агрегаторы, SMS-маркетинг, подписки, отчёты, KPI, финансы |
| **Бухгалтер** | `accountant` | `/{slug}/accountant/*` | Кассовые смены, акты оказанных услуг, входящие счета, платежи, выплаты (payroll), расходы, отчёты |
| **Врач / медперсонал** | `doctor`, `reg`, `nurse`, `recruiter`, `partner_doctor`, `visiting_doctor` | `/{slug}/admin` (кабинет по роли) | Расписание, слоты, приёмы, заключения (шифруются), направления, AI-брифинг и планы лечения, лаб-заявки, заработок/рейтинг; регистратор — создание направлений/анализов с hotkeys; рекрутёр — регистрация врачей (QR+пароль); приезжий/партнёрский врач — приём по QR/коду |
| **Пациент (ЛК)** | `patient` | `/{slug}/p`, `/{slug}/p/...` | Записи, медкарта, рецепты, витальные, лаборатория (с динамикой аналитов), документы, лояльность, подписка «Здоровье+», семья, чат с клиникой, телемед, NPS, 152-ФЗ (экспорт данных / право на забвение). Вход по **QR/коду без пароля** (long-lived session-токен) |
| **Публичный портал** | без роли | `/`, `/franchise`, `/signup`, `/{slug}/book`, `/{slug}/clinic`, `/wiki`, `/p/telemed/:token`, legal-страницы | Лендинг, страница франшизы, self-service регистрация франшизы (OTP-онбординг), онлайн-запись, публичная страница клиники, wiki, телемед-комната по токену, privacy/terms/consent |

> Всего в enum `UserRole` — **16 значений** (включая `acquisition_manager`, `lab_ct`, `lab_xray`). `super_admin` определяется по роли **ИЛИ** по `username == settings.superadmin_username`.

---

## 2. Возможности

| Домен | Что умеет | Ключевые роутеры / сервисы |
|---|---|---|
| **Запись и приём** | Онлайн-запись (публичная), слоты, TTL-бронь, расписание врачей, приёмы, заключения (шифруются), вложения, внутриклинические направления, себестоимость приёма (GENERATED-маржа) | `scheduling`, `appointments`, `public_booking` / `scheduling_service`, `appointment_costing` |
| **Направления (реферальная воронка)** | Межклинические направления, два независимых статуса (`status` + `cross_clinic_status`), партнёрский прайс (cross-clinic offers), SLA-напоминания, снапшоты бонусов для аудита | `referrals`, `reg_speed`, `partner_offers` / `referral_service` |
| **Биллинг платформы и франшизы** | Подписки тенантов (SaaS), счета/B2B-акты/платежи, append-only `billing_ledger` с revenue-split (platform/tenant/franchise), тарифы, API-квоты, MRR/ARR/LTV, счета франшизам, gap-анализ модулей | `billing`, `acts`, `commercial`, `marketplace`, `franchise_*` / `billing_service`, `arr_ltv_service`, `franchise_billing_service` |
| **Эквайринг (онлайн-оплата пациентов)** | Интернет-эквайринг: init/status/refund/webhook. **Работает ЮKassa**; Tinkoff/Sber/CloudPayments/Robokassa — заглушки (`NotImplementedError`→501) | `clinic_payments` / `acquiring/*`, `acquiring_service` |
| **ОФД / 54-ФЗ** | Фискальные чеки через ОФД, идемпотентность по ФД+ФН. **Работает Платформа ОФД**; Атол.Онлайн/Первый ОФД/Такском — заглушки | `fiscal_receipts` / `fiscal/*`, `fiscal_service` |
| **Касса** | Кассовые смены (open/X/Z-отчёт/сверка), наличная активация подписки + PDF-квитанция | `accountant/cash`, `manager_subscription_cash` / `subscription_cash_service` |
| **Телефония** | Конфиг провайдера, DID, исходящие звонки (callback-схема), история, WebRTC-присутствие (Redis Pub/Sub), запись + Whisper-транскрипция. **Работают Mango / Sipuni / Zadarma** | `tenant_telephony`, `calls`, `presence`, `call_recording` / `telephony/*`, `whisper_service` |
| **Лаборатория** | CRUD провайдеров (Gemotest/Invitro/KDL/Citilab), заявки врача, результаты пациенту, динамика аналитов, приём результатов через webhook | `admin_lab`, `doctor_lab`, `patient_lab(_dynamics)` / `lab_service` |
| **Склад** | Номенклатура, остатки по партиям, **FIFO-списание**, поставщики, приходы, импорт Excel/CSV/1С, нормативы расходников на услугу, себестоимость | `inventory(_batches/_import)`, `service_norms` / `inventory_fifo` |
| **Чат** | Чат клиника↔пациент (Intercom-стиль, SLA-светофор, реассайн), чат сотрудников (Slack-стиль, WebSocket, реакции, опросы, mentions, threads), AI Smart-Reply, slot-букинг в чате, техподдержка | `clinic_chat`, `patient_chat`, `staff_chat`, `support` / `chat_service`, `staff_chat_service` |
| **Пациентский ЛК** | Медкарта, документы, витальные, подписка «Здоровье+», семья, лояльность, NPS, wellness, 152-ФЗ экспорт/забвение, iCal-календарь | `patient`, `medcard`, `vitals`, `patient_subscription`, `patient_family` / `patient_session_service`, `subscription_service` |
| **Аналитика** | Drill-down направлений, кабинет директора (P&L/ДДС/KPI), сводка сети, LTV, маркетинговая атрибуция, CRM-engagement (теги/сегменты/push-кампании), когорты, retention | `analytics`, `director`, `ltv`, `patient_engagement_*` / `ltv_service`, `cohort_service`, `engagement_analytics` |
| **AI** | AI-аналитика клиники/платформы, AI-ассистент пациенту (каскад Claude→Gemini→rule-based), FAQ-поиск (экономия токенов), AI-генерация рекламы/регламентов/планов лечения | `ai`, `ai_platform`, `ai_assistant`, `doctor_ai`, `ai_knowledge` / `claude_service`, `gemini_service`, `doctor_ai_service` |
| **Реклама/маркетинг** | Объявления (CPC/CPM/flat), таргетинг, A/B, approval-workflow, атрибуция конверсий, SMS-рассылки, Web Push (VAPID) | `ads(_ai/_analytics/_workflow)`, `sms_marketing`, `push` / `push_service`, `ads_analytics` |
| **Интеграции/онбординг** | МИС **Renovatio** (импорт справочников, синк платежей, авто-подтверждение направлений), исходящие вебхуки, внешний REST API v1 (`clk_live_*` ключи), self-service регистрация франшизы (OTP) | `mis_sync`, `webhooks`, `public_api_v1`, `onboarding` / `mis_client`, `mis_sync_service`, `webhook_queue` |
| **Платформа/SaaS** | Мультитенантность, white-label брендинг, feature-flags, платные модули (active/trial/grace), Region Lock (гео-блок франшизы + IP-allowlist), health-score тенантов, impersonation, audit-журнал | `admin`, `admin_*`, `tenant`, `cms`, `security` / `tenant_onboarding_service`, `feature_flag_service`, `security_service` |

---

## 3. Технологический стек

### Backend (`backend/`, Python 3.11)

- **Web/ORM:** FastAPI 0.115.14 + uvicorn 0.32, SQLAlchemy 2.0.36 async (asyncpg 0.29 + psycopg2-binary 2.9.9), Alembic 1.13, Pydantic 2.10 / pydantic-settings 2.7.
- **Хранилища:** **PostgreSQL 16** (с `pg_stat_statements`), **Redis 7** — кэш / per-tenant квоты / pub-sub (presence/telemed) / JWT-blacklist / очереди.
- **Auth/крипто:** python-jose[cryptography] (JWT HS256, `jti`, refresh-ротация с reuse-detection), passlib[bcrypt], Fernet-шифрование ПДн (ключ из `SECRET_KEY`).
- **Фон:** **APScheduler** (~37 джобов; Redis-jobstore с fallback на память) — напоминания, дайджесты, атрибуция, синк МИС, SLA-эскалация, security-scan, биллинг-счета и т.д.
- **PDF/документы:** WeasyPrint 66 (lazy-import, системные pango/cairo в Docker), openpyxl, icalendar, jinja2, qrcode/Pillow.
- **AI:** `anthropic>=0.45` (единственный AI-SDK); OpenAI / Gemini / Whisper вызываются «голым» httpx через **proxyapi.ru** (обход блокировок в ЧР).
- **Наблюдаемость:** structlog, prometheus-client (`/metrics`), sentry-sdk[fastapi].

### Frontend (`frontend/`, версия 1.0.0)

- React 18.3 + Vite 5.4 + react-router-dom 6.24, Tailwind 3.4 (+ PostCSS/autoprefixer).
- **Zustand 4.5** (минимальный auth-стор), **axios 1.7** (единый инстанс: auto-Bearer, `X-Tenant-Slug`, auto-refresh при 401, region-lock 403).
- dompurify (XSS-санитизация), @sentry/react, react-markdown + rehype-raw + remark-gfm, jspdf, html5-qrcode/jsqr (сканер QR), material-symbols, @fontsource/inter+manrope.
- **Дизайн-система** на CSS-токенах (`design/`): `Card`/`Button`/`Chip`/`Tabs`/`Modal`/`Toast`/… через `import { } from '../design'`.
- ⚠️ `xlsx` (SheetJS) тянется напрямую с **CDN-tarball** (`cdn.sheetjs.com`), минуя npm-реестр.

### Боты и инфраструктура

- **Telegram-боты** (`bot/` — отдельный контейнер, делит `.env`): admin/owner-боты (алерты, админ-команды через docker-proxy), owner-бот на long-poll. Все вызовы `api.telegram.org` идут **через HTTP-прокси** (заблокирован у провайдера).
- **Docker Compose:** PostgreSQL, Redis, backend, frontend (Vite→nginx), бот, docker-proxy (read-only Docker API sidecar).
- **Мониторинг** (отдельный профиль `metrics`): Prometheus + exporters (postgres/redis/node/cadvisor/blackbox), Uptime-Kuma (отдельно), Sentry. На сервере уже развёрнут.
- **nginx хоста** (TLS, домен `клиниксеть.рф`) срезает `/api` и проксирует на backend/frontend.

---

## 4. Архитектура

### Backend — три слоя

```
HTTP → Middleware-конвейер (12 шт.) → Router (RBAC + валидация) → Service (бизнес-логика) → Model (ORM) → PostgreSQL
                                          │                          │
                                          ├─ Depends: auth/роль/      ├─ Decimal для денег (Numeric)
                                          │   тенант/фича/модуль        ├─ PII-шифрование на уровне модели
                                          └─ Pydantic-схемы            └─ tenant_id-фильтр ВРУЧНУЮ в роутере/сервисе
```

- **Routers** (`app/routers/*`) — тонкие `APIRouter`, prefix задаётся **внутри файла** (внешний `/api` навешивает nginx); проверка ролей через `Depends`; `await db.commit()` на уровне роутера; `Decimal → float` на выходе.
- **Services** (`app/services/*`) — «толстая» бизнес-логика, адаптеры внешних API; принимают `AsyncSession` извне; распространённый паттерн `flush()` без `commit()` (но ~36 сервисов коммитят сами — решается осознанно).
- **Models** (`app/models/*`) — SQLAlchemy 2.0 (`Mapped[...]` + `mapped_column`); деньги — `Numeric/Decimal`; ПДн шифруется через property+`__init__`; **`tenant_id`-фильтр НЕ на уровне модели**.
- **Core** (`app/core/*`) — auth/RBAC, middleware, лимиты, гейты; сквозной принцип **fail-open** (super_admin и юзер без tenant проходят гейты; деградация Redis не блокирует).

**Три контура авторизации:** JWT-сотрудник (основной), patient-session (long-lived токен по QR/коду), бессекретные/ключевые (webhook МИС, агрегаторы `X-Agg-API-Key`, публичный API `clk_live_*`, bot `X-Bot-Secret`, Telegram-webhook).

### Frontend — четыре слоя

```
pages/ (роутинг, ролевая логика) → sections/ (раздел кабинета: данные+API) → components/ (UI-блоки) → design/ (UI-kit на токенах)
```

Один SPA обслуживает 7+ кабинетов: `config.js` вычисляет `SLUG`/`API_BASE`/`PLATFORM_MODE` из первого сегмента URL; `App.jsx` — двухуровневый диспетчер (`AppRouter` грубо по `pathname` → `MiniApp` с `<BrowserRouter basename={/slug}>`). Особенность: панель `/admin` рендерится **вне BrowserRouter** (навигация через `window.location.assign`).

### Детальные обзоры

| Документ | О чём |
|---|---|
| [`docs/structure/BACKEND.md`](docs/structure/BACKEND.md) | Слои, жизненный цикл запроса, RBAC и мультитенантность, доменные группы роутеров, middleware-конвейер, ~37 фоновых джобов |
| [`docs/structure/FRONTEND.md`](docs/structure/FRONTEND.md) | Мультитенантный роутинг (SLUG→кабинет), слои pages/sections/components/design, сетевой слой, две оси темизации |
| [`docs/structure/DATA-MODEL.md`](docs/structure/DATA-MODEL.md) | ORM-слой: ~105 моделей, домены сущностей, изоляция (RLS), денежные поля, шифрование ПДн (152-ФЗ), ER-схема |
| [`docs/structure/INFRA-INTEGRATIONS.md`](docs/structure/INFRA-INTEGRATIONS.md) | Docker-стек, мониторинг, внешние интеграции, переменные окружения |

---

## 5. Структура репозитория

```
clinika/
├── backend/                       # FastAPI-монолит (Python 3.11)
│   ├── app/
│   │   ├── main.py                # точка сборки: 161 include_router + 12 middleware + lifespan (джобы)
│   │   ├── config.py              # pydantic-settings из .env (fail-fast на дефолтных секретах в prod)
│   │   ├── database.py            # async-движок (пул 10+20), get_db() без RLS
│   │   ├── routers/               # ~181 файл тонких APIRouter (prefix задаётся внутри файла)
│   │   ├── services/              # ~129 сервисов: бизнес-логика + адаптеры внешних API
│   │   │   ├── acquiring/         #   эквайринг: base → registry → адаптеры (ЮKassa рабочий)
│   │   │   ├── fiscal/            #   ОФД/54-ФЗ: адаптеры (Платформа ОФД рабочий)
│   │   │   └── telephony/         #   телефония: factory → Mango/Sipuni/Zadarma/null
│   │   ├── models/                # ~105 ORM-моделей (SQLAlchemy 2.0), наследуют Base
│   │   ├── schemas/               # Pydantic DTO (*In / *Out / *Patch)
│   │   ├── core/                  # auth/RBAC (deps, permissions, security), middleware, лимиты, гейты, crypto
│   │   ├── jobs/                  # фоновые APScheduler-задачи (своя сессия, идемпотентны)
│   │   ├── plugins/               # лёгкая plugin-система (MIS / SMS / Notify / Reviews)
│   │   └── utils/                 # stateless-хелперы (телефоны, IP, метрики, device)
│   ├── alembic/versions/          # >100 миграций (пишутся ВРУЧНУЮ, не autogenerate)
│   ├── tests/                     # pytest (coverage ~35%)
│   ├── wiki_content/              # markdown базы знаний (роли, концепции, dev-доки)
│   ├── requirements.txt
│   └── Dockerfile                 # alembic upgrade heads → uvicorn --proxy-headers
├── frontend/                      # React SPA (Vite → nginx)
│   └── src/
│       ├── main.jsx               # createRoot, ErrorBoundary, lazy Sentry, tokens.css + index.css
│       ├── App.jsx                # AppRouter (грубый роутинг по pathname) + MiniApp + auth-гейт
│       ├── config.js              # вычисление SLUG / API_BASE / PLATFORM_MODE из URL
│       ├── api/index.js           # единый axios-инстанс: Bearer, X-Tenant-Slug, auto-refresh, region-lock
│       ├── pages/                 # ≈90 экранов уровня роутинга (shell-кабинеты + тонкие обёртки)
│       ├── sections/              # крупные разделы кабинетов (переиспользуются между shell-ами)
│       ├── components/            # переиспользуемые UI-блоки (Layout, CallWidget, CommandPalette, доменные под-папки)
│       ├── design/                # дизайн-система (UI-kit на CSS-токенах)
│       ├── store/auth.js          # минимальный Zustand-стор (token, user) — частично легаси
│       ├── hooks/ · lib/          # clinicScope, regHotkeys, useTheme, webPush, Telegram SDK, callTones
│       └── utils/ThemeLoader.js   # CMS-брендинг тенанта (CSS-переменные :root)
├── bot/                           # Telegram-бот (отдельный контейнер, делит .env)
├── docker-proxy/                  # read-only Docker API sidecar для админ-команд бота
├── docker-compose.yml             # основной стек (db, redis, backend, frontend, bot, docker-proxy)
├── docker-compose.monitoring.yml  # профиль metrics (Prometheus + exporters)
├── .env / .env.example            # переменные окружения (⚠️ .env под git — см. техдолг)
└── docs/structure/                # карта проекта (этот аудит) — см. раздел «Документация»
```

---

## 6. Быстрый старт

### Прод-стиль (Docker, рекомендуется)

```bash
docker compose up -d                                                 # db, redis, backend, frontend, bot, docker-proxy
docker exec clinika-backend alembic -c /app/alembic.ini upgrade head # миграции (применяются и автоматически при старте)
```

| Контейнер | Образ / сборка | Порт (host → cont) | Назначение |
|---|---|---|---|
| `clinika-db` | `postgres:16-alpine` | — (только в сети) | PostgreSQL + `pg_stat_statements` |
| `clinika-redis` | `redis:7-alpine` | — (только в сети) | кэш / квоты / pub-sub / blacklist / очереди |
| `clinika-backend` | build `./backend` | **`127.0.0.1:8900` → 8000** | FastAPI/uvicorn |
| `clinika-frontend` | build `./frontend` | **`127.0.0.1:8901` → 80** | Vite-сборка → nginx |
| `clinika-bot` | build `./bot` | — | Telegram-бот |
| `clinika-docker-proxy` | build `./docker-proxy` | — | read-only Docker API для бота |

- Порты привязаны к `127.0.0.1` — наружу backend/frontend публикует **nginx хоста** (TLS, домен).
- Super-admin создаётся одноразово из ENV при первом старте (`SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD`).
- Health-чеки: `GET /health` и `GET /health/full` (watchdog шлёт Telegram-алерт при 5 фейлах подряд).
- Мониторинг (опц.): `docker compose -f docker-compose.monitoring.yml --profile metrics up -d`.

### Dev-режим бэкенда (без Docker)

```bash
pip install -r backend/requirements.txt                # системный Python 3.11; weasyprint импортируется лениво
# нужны доступные PostgreSQL и Redis
ENVIRONMENT=development uvicorn app.main:app --reload   # из каталога backend/
```

> В **prod** `lifespan` **отказывается стартовать** при дефолтных секретах (`change-in-production`, `change-me-qr-secret` и т.п.). В **dev** — только warning, поэтому задавайте `ENVIRONMENT=development`.

### Dev-режим фронтенда

```bash
cd frontend
npm install
npm run dev      # dev-сервер с HMR
npm run build    # Vite-сборка (порог предупреждения о chunk — 1500 KB, большие страницы lazy)
```

> Sentry DSN запекается build-arg'ом (`VITE_SENTRY_DSN`) — смена требует пересборки фронта (`build --no-cache`).

### Миграции (Alembic)

Миграции **пишутся вручную** (autogenerate не используется), `revision`/`down_revision` — строки-метки. Образец — `backend/alembic/versions/acct01_cashshift.py`. Команды:

```bash
docker exec clinika-backend alembic -c /app/alembic.ini heads          # узнать текущий head
docker exec clinika-backend alembic -c /app/alembic.ini upgrade head   # применить
```

### Переменные окружения (`.env`)

Конфиг — `pydantic-settings` (`backend/app/config.py`), шаблон — [`.env.example`](.env.example). `.env` целиком прокидывается в backend и bot через `env_file`.

| Тип | Переменные | Заметка |
|---|---|---|
| **Критичные (fail-fast)** | `DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`, `QR_SECRET`, `SUPERADMIN_USERNAME`, `SUPERADMIN_PASSWORD` | Без них сервис не стартует. `SECRET_KEY` ещё и деривирует Fernet-ключ шифрования ПДн — при пустом значении секреты лягут в БД в открытом виде (`plain:`-fallback) |
| **Секреты интеграций** | `YOOKASSA_*`, `PLATFORMA_OFD_*`, `COMPANY_INN`, `MIS_API_KEY`, `ANTHROPIC_API_KEY`, `PROXYAPI_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `*_BOT_TOKEN`, `TELEGRAM_PROXY_URL`, `SMTP_*`, `VAPID_*`, `TURN_SECRET`, `WEBHOOK_API_KEY`, `ONBOARDING_SECRET`, `PII_HASH_PEPPER` | Компрометация = доступ к платежам/МИС/AI |
| **Конфигурация** | `JWT_ALGORITHM`, `JWT_EXPIRE_HOURS`, `ALLOWED_ORIGINS` (CORS), `ENVIRONMENT`, `MIS_SSL_VERIFY`, `GEOIP_DB_PATH`, `SENTRY_DSN`, `VITE_SENTRY_DSN` | Не секреты |

### Прод и деплой

- **Сервер:** `212.57.118.126`, каталог `/opt/clinika`. Отдельного `deploy.sh` нет.

```bash
cd /opt/clinika
git pull
docker compose up -d --build                                       # пересборка изменённых сервисов
docker exec clinika-backend alembic -c /app/alembic.ini upgrade head
docker compose logs -f clinika-backend                             # проверить старт
```

- Тома данных хоста: `/opt/clinika/uploads` (загрузки), `/opt/clinika/data` (мед.документы пациентов, GeoIP, VAPID-бэкап, offset Telegram-поллера), `/opt/clinika/downloads` (инсталляторы Electron-звонилки KliniknetCalls).
- **Чек-лист перед деплоем:** миграции применяются без ошибок · `pytest` зелёный (хотя бы critical-path) · `npm run build` проходит · новые ENV добавлены в `.env` на сервере · секреты не дефолтные · **не закоммитить новые секреты в `.env`** (он под git — техдолг).

---

## 7. Документация

Полная карта кодовой базы — в [`docs/structure/`](docs/structure/). Начните с тематических обзоров (верхний уровень), затем при необходимости — детальные карточки в `ref/`.

| Документ | О чём |
|---|---|
| [`BACKEND.md`](docs/structure/BACKEND.md) | Слои бэкенда, жизненный цикл запроса, RBAC и мультитенантность, доменные группы роутеров, middleware, ~37 фоновых джобов |
| [`FRONTEND.md`](docs/structure/FRONTEND.md) | Мультитенантный роутинг (SLUG→кабинет), слои pages/sections/components/design, сетевой слой, темизация |
| [`DATA-MODEL.md`](docs/structure/DATA-MODEL.md) | ORM-слой: ~105 моделей, домены, изоляция (RLS), денежные поля, шифрование ПДн (152-ФЗ), ER-схема |
| [`INFRA-INTEGRATIONS.md`](docs/structure/INFRA-INTEGRATIONS.md) | Docker-стек, мониторинг, внешние интеграции (эквайринг/ОФД/телефония/МИС/AI), переменные окружения |
| [`HOWTO-CHANGE.md`](docs/structure/HOWTO-CHANGE.md) | **Плейбук разработчика:** рецепты «как добавить эндпоинт / страницу / модель / кабинет / провайдера» с чек-листами и подводными камнями |
| [`AUDIT-PLAN.md`](docs/structure/AUDIT-PLAN.md) | Результаты аудита: 89 подтверждённых находок (severity, файлы, что делать), топ-10 порядок устранения, опровергнутые/под вопросом |
| [`REMEDIATION-PLAN.md`](docs/structure/REMEDIATION-PLAN.md) | **План устранения critical + high** (20 находок): дорожная карта по волнам с учётом зависимостей, детали по темам (где править / корень / как чинить / миграция / проверка / риск) |
| [`ref/`](docs/structure/ref/) | **Детальная карта файлов** (~60 доков): карточки каждого роутера/сервиса/модели/компонента — `routers-01..13`, `services-01..09`, `models-01..05`, `pages-01..10`, `sections-01..09`, `components-01..09`, `core-01`, `design-01`, `frontend-misc-01`, `jobs-schemas-01`, `utils-plugins-01` |

Дополнительно: в проде доступна **wiki** (`backend/wiki_content/` → `/wiki`) — пользовательские и dev-доки по ролям, концепциям и модулям.

---

## 8. Состояние и безопасность

Проект **функционален и в проде**, но прошёл аудит (78 агентов, 7 направлений: безопасность, баги бэкенда, битые меню/фичи, контракт API, модели/БД, инфра/зависимости, корректность фронта). Из 104 находок **подтверждено 89**, опровергнуто 12, под вопросом 3.

| Тяжесть | Кол-во | Суть |
|---|---|---|
| 🔴 **CRITICAL** | **2** | Изоляция тенантов на уровне БД почти отсутствует; центральная PHI-таблица хранит ПДн в plaintext |
| 🟠 **HIGH** | **18** | Кросс-тенантный IDOR, медданные в plaintext, fail-open эндпоинты, баги денег, открытые CVE, хардкод секретов |
| 🟡 **MEDIUM** | **25** | Контракт API (битые эндпоинты), инфра-гигиена, конкурентность, дубли-источники истины |
| 🟢 **LOW** | **33** (вкл. 11 INFO) | Техдолг, мёртвый код, понижённые маршрутные находки |

### Топ-риски (критичное — читать обязательно)

- **🔴 RLS лишь на 3 таблицах из 126.** Row-Level Security включён только на `referrals`, `bonuses`, `audit_log`; остальные ~123 таблицы с `tenant_id` (appointments, medcard, lab_*, clinic_payments, inventory_* …) защищены **только ручным `WHERE tenant_id` в коде**. Более того, RLS-инфраструктура де-факто мёртвая — `get_tenant_db` (ставит `app.tenant_id`) **не используется ни в одном роутере**. Любой пропущенный фильтр = немедленная межтенантная утечка медданных без страховочного слоя БД.
- **🔴 ПДн пациентов в plaintext (152-ФЗ).** Центральная PHI-таблица `appointments` (`patient_phone`/`patient_name`/`notes`) + медкарта (диагнозы/аллергии/прививки), `LabResult`, `PatientVital` хранятся **открытым текстом**, хотя соседние поля (заключения/заметки/адрес) шифруются тем же `encryption_service`. У `appointments` ещё и `tenant_id` nullable + `ondelete=SET NULL` (приём может «осиротеть»). Дамп БД раскрывает диагнозы и контакты пациентов.
- **🟠 Кросс-тенантный IDOR при `tenant_id IS NULL`.** Повсеместный паттерн `if user.tenant_id and obj.tenant_id and obj.tenant_id != user.tenant_id: 404` — если у записи `tenant_id IS NULL`, проверка пропускается, доступ разрешён менеджеру любого тенанта (чат, медкарта, документы).
- **🟠 Деньги.** `record_payment` помечает счёт PAID при **любой** сумме платежа (1₽ закрывает счёт на 49900₽); `update_clinic_payment_status` доверяет webhook без сверки суммы/статуса; per-clinic эквайринг **никогда не читает сохранённые ключи** (Fernet-секреты write-only) → платежи идут на ENV-аккаунт платформы; `refund_clinic_payment` без идемпотентности; `_add_months` падает для подписок 29–31 числа.
- **🟠 Секреты в репозитории.** Пароль БД `clinika_pass` захардкожен в обоих compose-файлах + `.env.example`; хардкод прокси-кредов Telegram повторяется в 5 файлах; открытые CVE в зависимостях (python-multipart/Pillow/weasyprint не подняты, starlette не запинен).

### ⚠️ Главный техдолг: `.env` отслеживается git

На сервере файл **`.env` закоммичен в репозиторий**, поэтому все боевые секреты (креды БД, JWT/QR-секреты, токены платёжек/ОФД/МИС/AI, пароль суперадмина, прокси-креды Telegram) **уже в истории приватного репо** `mr-khamzat/clinika`. Это находка №1 в порядке устранения.

**Что нужно сделать (критично, по приоритету):**
1. **Ротировать все секреты, попавшие в git** — пароль БД `clinika_pass` (`ALTER ROLE clinika WITH PASSWORD …` на живой БД, **не пересоздавая volume**), токен Telegram-бота в BotFather, ключи интеграций.
2. **Убрать `.env` из git:** `git rm --cached .env` + `.gitignore` + **чистка истории** (`git filter-repo`/BFG).
3. **Вынести хардкод** пароля БД (`${POSTGRES_PASSWORD}`) и прокси-кредов в env без fallback-хардкода в коде.
4. **Задать сильные** `SECRET_KEY` / `QR_SECRET` / `PII_HASH_PEPPER` (при пустом `SECRET_KEY` шифрование ПДн деградирует в `plain:`).

### Полные планы

- [`docs/structure/AUDIT-PLAN.md`](docs/structure/AUDIT-PLAN.md) — **все 89 находок** с severity, файлами, «что сделать» и рекомендованным топ-10 порядком устранения.
- [`docs/structure/REMEDIATION-PLAN.md`](docs/structure/REMEDIATION-PLAN.md) — **план фикса 2 critical + 18 high**: дорожная карта по волнам (с учётом зависимостей: сначала backfill NULL `tenant_id` → целостность appointments → системный RLS → шифрование медданных; отдельная «ось денег»), с деталями по каждой находке.

---

## 9. Конвенции и как менять код

Прежде чем вносить изменения — прочитайте **[`docs/structure/HOWTO-CHANGE.md`](docs/structure/HOWTO-CHANGE.md)** (плейбук с пошаговыми рецептами и чек-листами). Ключевые правила:

- **Tenant-изоляция (самое важное):** каждый `select(...)` по тенантным данным **обязан** иметь `.where(Model.tenant_id == user.tenant_id)` — на уровне модели изоляции нет. Для доступа по `id` проверяй владение (IDOR: `obj.tenant_id == user.tenant_id`, **строго**, NULL ≠ разрешение).
- **Деньги — только `Decimal`:** модели `Numeric(12,2)`; вход с фронта `Decimal(str(value))` (не `Decimal(float)`); выход в JSON `float(...)`; **никогда не клади `Decimal` в JSONB**.
- **Роутеры тонкие, логика в сервисах.** Prefix задаётся внутри `APIRouter(prefix=...)`, в `main.py` — «голый» `include_router`. Гейты: `require_role`/`require_feature`/`require_module` возвращают голую функцию (оборачивай `Depends`), а `require_permission` уже возвращает `Depends` (не оборачивай).
- **Миграции — вручную** (не autogenerate); `down_revision` = текущий head (узнать `alembic heads` — дерево ветвистое); пиши `downgrade()`; `server_default` ↔ `default=` должны совпадать.
- **Фронт — три механизма навигации:** react-router (`App.jsx`, Director, Accountant), `pushState`-роутер (`AdminLayout` — источник истины размазан по 6 структурам), локальный `route`-switch (`DoctorLayout`/`OperationalCabinet` — **вне BrowserRouter**, навигация через `window.location.assign`). Две токен-системы на SLUG (`clinika_token_*` пациент / `clinika_admin_token_*` админ).
- **Подводные камни:** PostgreSQL-специфичный raw-SQL не работает на SQLite-тестах (прогоняй на Postgres); дубли-источники истины (цены планов, метрики MRR, две системы лояльности, два чата пациента); fail-open гейты — не единственная защита; гигантские файлы (`AdminLayout.jsx` 9004 стр., `main.py` ~1951) читай частями.
- **Перед коммитом** — `docker exec clinika-backend pytest /app/tests/ -v` (критические пути ловят реальные баги: Decimal-в-JSONB, гонки направлений, RBAC-изоляция).

---

> **Один абзац для занятого:** мультитенантная МИС/SaaS на FastAPI+React (~263k строк, 7 кабинетов). Запуск — `docker compose up -d` (backend `:8900`, frontend `:8901`) + `alembic upgrade head`. Прод на `212.57.118.126` / `/opt/clinika`. Изоляция тенантов держится на ручном `WHERE tenant_id` (RLS лишь на 3 таблицах — главный риск); ПДн пациентов частично в plaintext (152-ФЗ); `.env` под git → нужна ротация секретов. Карта кода — `docs/structure/`, что чинить — `AUDIT-PLAN.md` + `REMEDIATION-PLAN.md`, как менять — `HOWTO-CHANGE.md`.
