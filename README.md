# КлиникСеть (clinika)

Мультитенантная **МИС/SaaS-платформа для сети клиник**: FastAPI + React, ~263k строк кода, 7 ролевых кабинетов поверх единого ядра изоляции тенантов. Один монолитный бэкенд (~165 роутеров, ~135 сервисов, ~100 ORM-моделей) и один SPA обслуживают всю сеть, разводя клиники по slug-у тенанта в URL.

> Это точка входа для нового разработчика. Подробности по слоям — в [карте документации](#карта-документации).

---

## Что это за продукт

«КлиникСеть» — платформа для франшизной сети медицинских клиник: онлайн-запись, направления между клиниками (реферальная воронка — сердце бизнес-модели), биллинг платформы и франшиз, медкарта пациента, телемедицина, лаборатория, склад, телефония, AI-ассистенты и сквозная аналитика. Иерархия данных: **Платформа → Франшиза → Тенант → Клиника**.

### Семь кабинетов

| Кабинет | Роль(и) | Назначение |
|---|---|---|
| **Платформа (super_admin)** | `super_admin` | Управление всеми тенантами/франшизами: биллинг, churn, health-score, feature-flags, мониторинг, RBAC, impersonation |
| **Франшиза** | `franchise_owner` | P&L сети, перелив пациентов, gap-анализ модулей, биллинг от платформы, создание клиник |
| **Директор сети** | `director`, `deputy_director` | P&L / ДДС / KPI / маркетинг сети — read-only аналитика |
| **Управляющий** | `manager` | Операционка клиники: услуги, персонал, склад, лояльность, лаборатория, телефония, отчёты |
| **Бухгалтер** | `accountant` | Кассовые смены, акты, счета, выплаты, расходы, отчёты |
| **Врач / медперсонал** | `doctor`, `reg`, `nurse`, `recruiter`, `partner_doctor`, `visiting_doctor` | Расписание, приёмы, заключения, направления, AI-инструменты, лаб-заявки |
| **Пациент (ЛК)** | `patient` | Записи, медкарта, рецепты, документы, лояльность, подписка «Здоровье+», семья, чат, телемед (вход по QR/коду, без пароля) |

Всего в `UserRole` — 17 значений (включая `acquisition_manager`, `lab_ct`, `lab_xray` и др.).

---

## Технологический стек

**Backend** (`backend/`, Python 3.11)
- FastAPI 0.115 + uvicorn, SQLAlchemy 2.0 async (asyncpg), Alembic
- PostgreSQL 16, Redis 7 (кэш / квоты / pub-sub / blacklist / очереди)
- Pydantic 2 / pydantic-settings, python-jose (JWT HS256), passlib (bcrypt)
- APScheduler (~37 фоновых джобов), WeasyPrint (PDF, lazy-import), structlog, prometheus-client, sentry-sdk
- AI: `anthropic` SDK; OpenAI/Gemini/Whisper — через httpx + proxyapi.ru

**Frontend** (`frontend/`, версия 1.0.0)
- React 18 + Vite 5 + react-router-dom 6, Tailwind 3
- Zustand (state), axios (единый инстанс с auto-refresh), dompurify, @sentry/react
- Дизайн-система на CSS-токенах, Material Symbols, react-markdown, jspdf

**Инфраструктура**
- Docker Compose: PostgreSQL, Redis, backend, frontend (Vite→nginx), Telegram-бот, docker-proxy (sidecar)
- Отдельный профиль мониторинга: Prometheus + exporters (postgres/redis/node/cadvisor/blackbox), Uptime-Kuma, Sentry
- nginx хоста (TLS, домен) срезает `/api` и проксирует на backend/frontend

---

## Структура репозитория

```
clinika/
├── backend/                       # FastAPI-монолит
│   ├── app/
│   │   ├── main.py                # точка сборки: ~165 include_router + 12 middleware + lifespan (джобы)
│   │   ├── config.py              # pydantic-settings из .env (fail-fast на дефолтных секретах в prod)
│   │   ├── database.py            # async-движок, get_db() и get_tenant_db() (RLS)
│   │   ├── routers/               # ~165 тонких APIRouter (prefix задаётся внутри файла)
│   │   ├── services/              # ~135 сервисов: бизнес-логика, адаптеры внешних API
│   │   ├── models/                # ~100 ORM-моделей (SQLAlchemy 2.0), наследуют Base
│   │   ├── schemas/               # Pydantic DTO (*In/*Out/*Patch)
│   │   ├── core/                  # auth/RBAC, middleware, лимиты, гейты, криптография
│   │   ├── jobs/                  # фоновые APScheduler-задачи
│   │   ├── plugins/               # лёгкая plugin-система (MIS/SMS/Notify/Reviews)
│   │   └── utils/                 # stateless-хелперы (телефоны, IP, метрики, device)
│   ├── alembic/versions/          # >100 миграций (пишутся вручную)
│   ├── tests/                     # pytest (coverage ~35%)
│   ├── requirements.txt
│   └── Dockerfile                 # alembic upgrade heads → uvicorn
├── frontend/                      # React SPA (Vite)
│   └── src/
│       ├── main.jsx               # точка входа: createRoot, ErrorBoundary, Sentry, tokens.css
│       ├── App.jsx                # AppRouter (грубый роутинг по pathname) + MiniApp + auth-гейт
│       ├── config.js              # вычисление SLUG / API_BASE / PLATFORM_MODE из URL
│       ├── api/index.js           # единый axios-инстанс: Bearer, X-Tenant-Slug, auto-refresh
│       ├── pages/                 # ≈90 экранов уровня роутинга (shell-кабинеты + тонкие обёртки)
│       ├── sections/              # крупные разделы кабинетов (переиспользуются между shell-ами)
│       ├── components/            # переиспользуемые UI-блоки и подсистемы (Layout, CallWidget, ...)
│       ├── design/               # дизайн-система (UI-kit на CSS-токенах)
│       ├── store/auth.js          # минимальный Zustand-стор (token, user)
│       ├── hooks/ · lib/          # clinicScope, regHotkeys, useTheme, webPush, telegram SDK
│       └── utils/ThemeLoader.js   # CMS-брендинг тенанта
├── bot/                           # Telegram-бот (отдельный контейнер, делит .env)
├── docker-proxy/                  # read-only Docker API sidecar для админ-команд бота
├── docker-compose.yml             # основной стек (db, redis, backend, frontend, bot, docker-proxy)
├── docker-compose.monitoring.yml  # профиль metrics (Prometheus + exporters)
├── .env / .env.example            # переменные окружения (⚠️ .env под git — см. техдолг)
└── docs/structure/                # карта проекта (этот аудит) — см. ниже
```

---

## Быстрый старт

### Прод-стиль (Docker, рекомендуется)

```bash
docker compose up -d                                                # db, redis, backend, frontend, bot
docker exec clinika-backend alembic -c /app/alembic.ini upgrade head # миграции
# backend → 127.0.0.1:8900, frontend → 127.0.0.1:8901 (наружу публикует nginx хоста)
```

Super-admin создаётся одноразово из ENV при первом старте (`SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD`).
Health-чеки: `GET /health` и `GET /health/full`.

### Dev-режим бэкенда (без Docker)

```bash
pip install -r backend/requirements.txt        # системный Python 3.11; weasyprint импортируется лениво
# нужны доступные PostgreSQL и Redis
ENVIRONMENT=development uvicorn app.main:app --reload   # из каталога backend/
```

> В prod `lifespan` **отказывается стартовать** при дефолтных секретах (`change-in-production` и т.п.); в dev — только warning. Поэтому в dev задавайте `ENVIRONMENT=development`.

### Dev-режим фронтенда

```bash
cd frontend
npm install
npm run dev      # dev-сервер с HMR
npm run build    # Vite-сборка (главный chunk < 500 KB, большие страницы lazy)
```

### Тесты

```bash
docker exec clinika-backend pytest /app/tests/ -v
docker exec clinika-backend pytest /app/tests/test_rbac_isolation.py -v   # критический путь
```

> ⚠️ Много raw-SQL **PostgreSQL-специфичен** (`date_trunc`, `FILTER (WHERE)`, `::inet`, RLS, partial unique, GENERATED-колонки) и не покрывается SQLite-тестами — обязателен прогон на Postgres перед релизом.

---

## Карта документации

Полная карта кодовой базы лежит в [`docs/structure/`](docs/structure/). Начните с тематических обзоров:

| Документ | О чём |
|---|---|
| [`docs/structure/BACKEND.md`](docs/structure/BACKEND.md) | Слои бэкенда, жизненный цикл запроса, RBAC и мультитенантность, доменные группы роутеров, ~37 фоновых джобов |
| [`docs/structure/FRONTEND.md`](docs/structure/FRONTEND.md) | Мультитенантный роутинг (SLUG→кабинет), слои pages/sections/components/design, сетевой слой, темизация |
| [`docs/structure/DATA-MODEL.md`](docs/structure/DATA-MODEL.md) | ORM-слой: ~100 моделей, домены сущностей, изоляция (RLS), денежные поля, шифрование ПДн (152-ФЗ), ER-схема |
| [`docs/structure/INFRA-INTEGRATIONS.md`](docs/structure/INFRA-INTEGRATIONS.md) | Docker-стек, мониторинг, внешние интеграции (эквайринг/ОФД/телефония/МИС/AI), переменные окружения |
| [`docs/structure/HOWTO-CHANGE.md`](docs/structure/HOWTO-CHANGE.md) | Плейбук разработчика: рецепты «как добавить эндпоинт / страницу / модель / кабинет / провайдера» с чек-листами |
| [`docs/structure/AUDIT-PLAN.md`](docs/structure/AUDIT-PLAN.md) | Результаты аудита: 89 подтверждённых находок, severity, файлы, что делать, топ-10 порядок устранения |
| [`docs/structure/ref/`](docs/structure/ref/) | **Детальная карта файлов** — карточки каждого роутера/сервиса/модели/компонента (routers-01..13, services-01..09, models-01..05, components/pages/sections-NN, core, design, frontend-misc, jobs-schemas) |

---

## Состояние и техдолг

Проект функционален и в проде, но прошёл аудит (78 агентов, 7 направлений, 104 находки → **89 подтверждено**). Распределение подтверждённых:

- 🔴 **CRITICAL — 2:** RLS включён лишь на 3 таблицах из 126 (изоляция тенантов держится на ручных `WHERE tenant_id`); центральная PHI-таблица `appointments` хранит ПДн пациента в plaintext + `tenant_id` nullable/SET NULL.
- 🟠 **HIGH — 18:** кросс-тенантный IDOR при `tenant_id IS NULL`, медданные спец.категории в plaintext, fail-open `/tenant/create`, IDOR в payment-config, открытые CVE в зависимостях, хардкод пароля БД в compose, баги денег в биллинге/эквайринге, мёртвые центральные эндпоинты.
- 🟡 **MEDIUM — 25** · 🟢 **LOW — 33** (включая 11 INFO): техдолг, мёртвый код, понижённые маршрутные находки, инфра-гигиена.

Полный разбор и рекомендованный **топ-10 порядок устранения** — в [`docs/structure/AUDIT-PLAN.md`](docs/structure/AUDIT-PLAN.md).

### ⚠️ Главный риск безопасности: `.env` отслеживается git

На сервере файл **`.env` закоммичен в репозиторий**, поэтому все боевые секреты (креды БД `clinika_pass`, JWT/QR-секреты, токены платёжек/ОФД/МИС/AI, пароль суперадмина, хардкод прокси-кредов Telegram) **уже в истории приватного репо** `mr-khamzat/clinika`. Это находка №1 в порядке устранения.

**Что нужно сделать (критично):**
1. Ротировать все секреты, попавшие в git (пароль БД, токен Telegram-бота в BotFather, ключи интеграций).
2. Убрать `.env` из git: `git rm --cached .env` + `.gitignore` + **чистка истории** (например, `git filter-repo`).
3. Вынести хардкод прокси-кредов и `clinika_pass` в `${ENV}`/secrets без fallback-хардкода в коде.
4. Задать сильные `SECRET_KEY` / `QR_SECRET` / `PII_HASH_PEPPER` (при пустом `SECRET_KEY` секреты ложатся в БД в открытом виде через `plain:`-fallback).

---

## Прод и деплой

- **Сервер:** `212.57.118.126`, каталог `/opt/clinika`.
- **Деплой** — через `docker compose` (отдельного `deploy.sh` нет):

```bash
cd /opt/clinika
git pull
docker compose up -d --build                                       # пересборка изменённых сервисов
docker exec clinika-backend alembic -c /app/alembic.ini upgrade head
docker compose logs -f clinika-backend                             # проверить старт
```

- Миграции применяются и автоматически при старте контейнера (`alembic upgrade heads` в `Dockerfile`).
- Тома данных хоста: `/opt/clinika/uploads`, `/opt/clinika/data` (мед.документы, GeoIP, VAPID), `/opt/clinika/downloads` (инсталляторы Electron-звонилки).
- Мониторинг (Prometheus + exporters + Uptime-Kuma) уже развёрнут на сервере; backend сам экспонирует `/metrics`.

**Чек-лист перед деплоем:** миграции применяются без ошибок · `pytest` зелёный (хотя бы critical-path) · `npm run build` проходит · новые ENV добавлены в `.env` на сервере · секреты не дефолтные · не закоммитить новые секреты в `.env` (он под git).
