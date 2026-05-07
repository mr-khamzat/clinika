# КлиникСеть — SaaS-платформа для медицинских сетей

> Multi-tenant МИС: единая платформа, у каждой клиники-тенанта свой URL/брендинг, изолированные данные. Покрывает направления и бонусы, расписание, межклиничные взаиморасчёты, рекламные кабинеты, AI-чат, биллинг платформы, франшизную иерархию.

**Стек:** FastAPI 0.111 (async) · SQLAlchemy 2.0 · PostgreSQL 16 · Redis 7 · React 18 · Vite 5 · Tailwind 3 · Docker Compose · Alembic 1.13

**Боевой URL:** https://клиниксеть.рф/{slug}/ — slug определяет тенанта в URL

---

## Архитектура

```
                  Пользователь (браузер / PWA / Telegram WebApp)
                                  │
       ┌──────────────────────────┴──────────────────────────┐
       │                       nginx                          │
       │   /                  → лендинг                       │
       │   /{slug}/           → React SPA (Vite build)        │
       │   /{slug}/api/       → FastAPI                       │
       │   custom CNAME       → DomainRouterMiddleware → tenant│
       └──────────────────────────┬──────────────────────────┘
                                  │
   ┌──────────────────────────────┼──────────────────────────────┐
   │                              │                               │
PostgreSQL 16                Redis 7                       Docker socket (RO)
(tenant-scoped data)    (cache, rate-limit,            через clinika-docker-proxy
                         ZSET метрик, geoip-кеш)
```

**Multi-tenancy:** все основные таблицы имеют `tenant_id` FK. Контекст тенанта берётся из URL (`{slug}`) или из Host-заголовка (CNAME → `DomainRouterMiddleware`). JWT содержит `tid` в payload.

**Брендинг:** при логине фронт читает `/tenant/branding` и подставляет CSS-переменные (primary, accent, logo) — один билд, разный вид у каждого тенанта.

**Plugin system:** платные модули (MIS, SMS, Reviews, P2P-звонки, AI-аналитика) включаются per-tenant через `tenant_modules` с потенциальным override цены.

---

## Роли и кабинеты

| Роль | URL | Кабинет |
|---|---|---|
| `super_admin` | `/admin` | **AdminLayout** — платформа: франшизы, тенанты, биллинг платформы, модули, AI, аудит с GeoIP-картой, вебхуки, мониторинг |
| `franchise_owner` | `/{slug}/admin` | **FranchiseOwnerCabinet** — свои тенанты в рамках франшизы, аналитика, роялти, отзывы, AI-knowledge |
| `manager` | `/{slug}/manager/*` | **ManagerDashboard** + ManagerAnalytics/Bonuses/KPI/Settings/Activity/Invoices/RecruitDoctors |
| `supervisor` | `/{slug}/admin` | **SupervisorCabinet** — аналитика 7/30/90/365д, реестр, отзывы, акты, реквизиты |
| `admin` / `nurse` | `/{slug}/admin` | **OperationalCabinet** — регистратор: направления, услуги, чаты с пациентами |
| `doctor` | `/{slug}/admin` | **DoctorLayout** — расписание, пациенты, чаты, P2P-звонки между клиниками |
| `recruiter` | `/{slug}/admin` | **RecruiterCabinet** — приглашение врачей по ссылке, бонусы, статистика |
| `accountant` | `/{slug}/admin` | **AccountantCabinet** — акты выполненных работ, межклиничные счета, ЭП, A4-печать |
| `acquisition_manager` | `/{slug}/admin` | **AcquisitionManagerCabinet** — CRM-пайплайн привлечения врачей |
| `external_doctor` | `/{slug}/admin` | **ExternalDoctorCabinet** — внешний врач с ограниченным доступом |
| `visiting_doctor` | `/{slug}/admin` | **VisitingDoctorCabinet** — выездной врач, мобильное расписание |
| `partner` | `/{slug}/p` (старое) | партнёр-направляющий через Telegram Mini App |
| **patient** | `/{slug}/p/` (PWA) | **PatientCabinet** — направления, семья, AI-чат с клиникой, врачи с рейтингом, мои записи, история, МИС, бонусы |

`AdminRoot.jsx` маршрутизирует роль → кабинет. Доступ контролируется `core/permissions.py` (RBAC-матрица) + `require_role()` / `require_permission()` в `deps.py`.

---

## Функциональные модули

### Операционка клиники
- **Направления и бонусы** (`referrals.py`, `bonuses.py`) — QR-код, скан, выплата, append-only `ledger_entries`
- **Расписание** (`scheduling.py`) — `Doctor`/`DoctorSchedule`/`Appointment`, поиск свободных слотов, статусы pending/confirmed/cancelled/completed/no_show
- **Услуги** (`services` модель) — каталог per-clinic, модуль services-per-clinic
- **Чаты пациент↔клиника** (`patient_chat.py`) — реалтайм, AI-fallback на пустые ответы

### Платформа (super_admin)
- **Франшизы** (`Franchise` model, `admin.py` + `FranchisesSection`) — иерархия Платформа → Франшиза → Тенанты → Клиники
- **Каталог модулей** (`modules.py` + `ModulesCatalogSection`) — цены, активация per-tenant, trial
- **Биллинг платформы** (`billing.py` + `PlatformBillingSection`/`PaymentGatewaysSection`) — подписки, инвойсы, MRR, Stripe + ЮKassa каркас
- **Платформенная аналитика** (`PlatformAnalyticsSection`) — KPI, geo-распределение тенантов, top-tenants, динамика
- **AI-настройки** (`ai_platform.py`, `PlatformAISection`) — выбор LLM-провайдера, API-ключи
- **Аудит с GeoIP** (`audit.py` + `services/geoip_service.py`) — `dbip-city-lite.mmdb`, флаги стран, координаты, Яндекс-карта в UI
- **Вебхуки** (`webhooks.py` + `WebhooksSection`) — HMAC-SHA256, retry x3, события: referral_created, bonus_paid, invoice_paid, …
- **Мониторинг** (`monitoring.py`) — p50/p95/p99 latency через Redis ZSET, health snapshots, pg_stat_activity
- **Безопасность** (`security_utils.py`) — SlidingWindowRateLimiter (200/min), `assert_tenant_owns()` против IDOR, ежедневный архив `audit_log` старше 90 дней

### Франшиза (franchise_owner)
- Свои тенанты, создание новых, аналитика по сети
- Модерация отзывов (`reviews.py` + `ReviewsSection`)
- AI-knowledge — FAQ для AI-чата (`ai_knowledge.py` + `AIKnowledgeSection`): экономия LLM-токенов через токенизацию + score-матчинг

### White-label & CMS
- `tenant_branding` (+12 полей: цвета, лого, фавикон, шрифт, og-image)
- `tenant_cms_pages` — статические страницы с MD-контентом (`cms.py` + `CMSPagesSection`)
- Кастомный CNAME (`core/domain_router.py`) — challenge `/.well-known/clinika-domain/{tenant_id}` + verify

### Финансы и взаиморасчёты
- **Bonus ledger** (`ledger_entries`) — append-only, бонусные операции
- **Billing ledger** (`billing_ledger` + `BillingLedgerSection`) — платёжный журнал с revenue split (gross + child-records: platform_income / tenant_income / franchise_fee)
- **Межклиничные счета** (`inter_clinic_invoices.py` + `InterClinicInvoicesSection`)
- **Акты** (`acts.py` + `ActsSection`/`ActPrintModal`) — A4-печатная форма со штампом, подписант, реквизиты
- **Реквизиты** (`RequisitesSection`) — КПП, ОГРН, банк, подписант на тенант

### Реклама
- `ads.py` v3 + `AdsSection`/`ImageCropEditor`/`AdReport`
- Drag-and-drop, кроп изображений на canvas (без зависимостей), 6 цветовых пресетов, расписание показа, авто-пауза по лимитам, дублирование, CSV/PDF-отчёт

### Patient cabinet (PWA)
- Premium dark theme, mobile-first
- Long-lived session: JWT type=`patient_session` (1 год), таблица `patient_sessions`
- Автологин: URL `?t=` → `?s=` → SESSION_KEY (LS) → TOKEN+REF
- PWA `<link rel="manifest">` сервится с `start_url` содержащим session_token (фикс iOS PWA)
- Семьи (мульти-пациент per номер), AI-чат, врачи с рейтингом prodoctorov-style + QuickBook + ReviewForm
- Календарь записи, мои записи, отзывы, история визитов из МИС

### Безопасность и compliance
- RBAC: `ROLE_PERMISSIONS` матрица в `core/permissions.py`
- Refresh-токены (`refresh_token` model): access=30мин, refresh=30дней, `/auth/sessions`, logout-all
- 152-ФЗ: `consent_records`, `/consent/accept|withdraw|forget` (анонимизация)
- Аудит-лог архивируется в `audit_log_archive` старше 90 дней (cron 03:00)
- Rate-limiting: 200 req/min на IP+endpoint, 20 req/min на `/auth/*`
- Audit-IP geo-резолв через `dbip-city-lite` (Redis-cache 24ч), обновляется по понедельникам

---

## Тарифы и фичи

| Фича | Basic | Professional | Enterprise |
|---|---|---|---|
| Направления + бонусы | ✅ | ✅ | ✅ |
| Аналитика drill-down | — | ✅ | ✅ |
| KPI | — | ✅ | ✅ |
| Расписание врачей | — | ✅ | ✅ |
| Финансовый реестр | — | ✅ | ✅ |
| Аудит-лог | — | ✅ | ✅ |
| Вебхуки | — | — | ✅ |
| Накопительный баланс | — | — | ✅ |
| Max клиник | 5 | 50 | ∞ |
| Max пользователей | 20 | 500 | ∞ |

Платные модули поверх плана (включаются per-tenant в `ModulesCatalogSection`): MIS, SMS-провайдер, Reviews, P2P-звонки между клиниками, AI-аналитика basic/pro, реклама flat/cpc/cpm.

---

## Структура проекта

```
clinika/
├── backend/
│   ├── alembic/versions/       # 43 миграции (head: s5t6u7v8w9x0)
│   ├── scripts/
│   │   ├── download_geoip.sh   # cron Mon 03:00 + initial download
│   │   └── backfill_geo.py     # обогащение исторического audit_log
│   └── app/
│       ├── core/               # deps, permissions, tenant, domain_router, security_utils
│       ├── models/             # 45 моделей
│       ├── routers/            # 44 роутера (см. ниже)
│       │   └── manager/        # 11 файлов после рефакторинга monolith
│       ├── services/           # 28 сервисов
│       ├── plugins/            # base, registry, mis/, sms/, notify/, reviews/
│       └── main.py             # middleware, CORS, schedulers, geoip_initial_download
├── frontend/
│   └── src/
│       ├── pages/              # 41 страница (кабинеты ролей + публичные)
│       ├── sections/           # 26 секций (вкладки внутри кабинетов)
│       ├── lib/tg.js           # Telegram SDK helper
│       ├── App.jsx             # роутинг + init session
│       └── config.js           # SLUG/API_BASE из window.location
├── bot/                        # Telegram-бот (super_admin уведомления)
├── docker-proxy/               # sidecar для read-only доступа к docker.sock
├── data/                       # GeoLite2-City.mmdb (mounted)
├── uploads/                    # пользовательские файлы (mounted)
├── backups/                    # дампы БД (cron, gitignored)
├── docker-compose.yml
└── deploy.sh
```

### Ключевые роутеры
auth, tenant, admin (platform), admins, franchise_owner, supervisor, manager (split), recruiter, doctor (через scheduling), patient, patient_chat, portal, public_booking, public_clinic, referrals, bonuses, ledger, scheduling, billing, commercial (модули), modules, plugins, ads, reviews, acts, inter_clinic_invoices, cms, integrations, mis_sync, ai, ai_platform, ai_knowledge, audit, monitoring, webhooks, presence, push, support, contact, consent, geo, system, wiki, acquisition_manager, visiting_doctor

---

## Развёртывание

```bash
# Первый запуск
git clone https://github.com/mr-khamzat/clinika.git /opt/clinika
cd /opt/clinika
cp .env.example .env
# Отредактировать .env (SECRET_KEY, DATABASE_URL, BOT_TOKEN, GEMINI_API_KEY)

docker compose up -d
docker exec clinika-backend alembic upgrade head
docker exec clinika-backend python seed_plans.py

# При первом старте main.py сам скачает dbip-city-lite.mmdb в /app/data
```

### После изменений

```bash
# Backend (Python)
docker compose restart clinika-backend

# Frontend (любые .jsx/.js)
docker compose build --no-cache clinika-frontend
docker compose up -d clinika-frontend

# Миграции
docker exec clinika-backend alembic upgrade head
```

### .env

```env
DATABASE_URL=postgresql+asyncpg://clinika:clinika_pass@clinika-db:5432/clinika
REDIS_URL=redis://clinika-redis:6379

SECRET_KEY=<min 32 chars>
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=30

# Telegram-бот super_admin
ADMIN_BOT_TOKEN=
ADMIN_CHAT_ID=

# AI (Gemini / OpenAI / Anthropic — выбирается в PlatformAISection)
GEMINI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# LiveKit (P2P звонки, опционально)
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

---

## Сервисы (docker-compose)

| Сервис | Порт (host) | Назначение |
|---|---|---|
| `clinika-db` | — | PostgreSQL 16 |
| `clinika-redis` | — | Redis 7 |
| `clinika-docker-proxy` | — | RO-доступ к docker.sock из backend |
| `clinika-backend` | `127.0.0.1:8900` | FastAPI |
| `clinika-frontend` | `127.0.0.1:8901` | nginx → SPA |
| `clinika-bot` | — | Telegram-бот super_admin уведомлений |

Volumes: `/opt/clinika/uploads`, `/opt/clinika/data` (GeoIP), `clinika-db-data`, `clinika-redis-data`.

---

## Что не ломать

### Frontend
- Новая роль → `redirect_url` в `auth.py` + `AdminRoot.jsx` switch + (если есть отдельный кабинет) новая страница
- `frontend/src/config.js` — SLUG/API_BASE из URL. Не хардкодить
- JSX-блоки только внутри функций-компонентов. На уровне модуля → `ReferenceError` → белый экран
- После любых изменений `.jsx`/`.js` — пересобрать frontend (см. выше)

### Backend
- Новая миграция → одна голова в `alembic heads`. Не менять `down_revision` старых
- Новый роутер → `app.include_router()` в `main.py`
- Новая роль → PG enum `ALTER TYPE userrole ADD VALUE` + `ROLE_PERMISSIONS` + `require_role()`

### Multi-tenancy
- В каждом запросе — `tenant_id` из контекста, никогда не из тела запроса
- `assert_tenant_owns(obj, tenant_id)` перед любой операцией над сущностью с `tenant_id`
- Платформенные эндпоинты (`/admin/*`) — `require_role(UserRole.SUPER_ADMIN)`

---

## Документация

### API documentation
- **Swagger UI:** <https://клиниксеть.рф/api/docs> — интерактивная документация всех endpoints
- **OpenAPI JSON:** `backend/openapi.json` (импортируется в Postman / Insomnia)
- **API Conventions:** [`docs/API_CONVENTIONS.md`](docs/API_CONVENTIONS.md) — правила URL, query, статусов, naming + список endpoints для рефакторинга
- **API Reference:** [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) — описание текущих endpoints
- **API Contract:** [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) — контракты для интеграций

### Прочие документы
- **Биллинг:** `BILLING_ARCHITECTURE.md` — revenue split, plans, pricing rules
- **Changelog:** `CHANGELOG.md`

---

## Активные направления развития

- **Stripe / ЮKassa интеграция** — каркас есть, нужна реальная подписка, webhooks от платёжных систем
- **WebRTC E2EE для P2P** — DTLS, одноразовые токены комнат
- **AI-инсайты** — автоматические рекомендации по аналитике на base/pro
- **Тесты** — pytest unit + integration (сейчас покрытие 0%)
- **Структурированные логи** + correlation IDs
