# КлиникСеть — SaaS-платформа для медицинских сетей

> Готовая платформа для автоматизации направлений пациентов, бонусной системы, расписания врачей, МИС-интеграции, аналитики и взаиморасчётов. Мультитенантная SaaS-архитектура — каждая клиника получает изолированное пространство.

**Стек**: FastAPI 0.115 · SQLAlchemy 2.0 async · PostgreSQL 16 · Redis 7 · React 18 · Vite · Tailwind CSS · Docker Compose · Alembic

---

## Архитектура платформы

```
Клиент (браузер / Telegram Mini App)
  │
  ├── /{slug}/          → React SPA (Vite, Tailwind)
  ├── /{slug}/api/      → FastAPI backend
  │
  └── Telegram Mini App → тот же SPA, авторизация через initData
  
Backend:
  FastAPI → AsyncSession (SQLAlchemy 2.0) → PostgreSQL 16
                                          → Redis 7 (кеш, метрики, rate-limit)
```

### Роли пользователей

| Роль | Кабинет | Описание |
|------|---------|----------|
| `super_admin` | AdminLayout | Управление всей платформой, все тенанты |
| `admin` | AdminLayout | Управление своим тенантом |
| `manager` | AdminLayout | Руководитель клиники |
| `doctor` | DoctorCabinet | Кабинет врача, направления |
| `nurse` | OperationalCabinet | Медсестра, создание направлений |
| `recruiter` | RecruiterCabinet | Рекрутер, привлечение врачей |
| `supervisor` | (планируется) | Владелец франшизы |
| `partner` | PatientCabinet | Партнёр-направляющий (Telegram Mini App) |

---

## Реализованные этапы

### ✅ Этап 0.5 — Рефакторинг монолита
- `manager.py` (2450 строк) → 11 файлов в `routers/manager/`
- `services/activity_service.py`, `services/settings_service.py`
- Alembic вместо `create_all`; миграция `bdc4ea7233ff`
- `database.py`: `pool_size=10`, `max_overflow=20`

### ✅ Этап 1 — Multi-tenant
- Модели: `Tenant`, `TenantLicense`, `TenantBranding`
- `tenant_id` FK (nullable) → users, clinics, referrals, bonuses, activity_log, services
- Миграция `3bb50c97a428`
- `app/core/tenant.py`: `get_current_tenant()`, `get_tenant_license()`, `require_feature()`
- `app/routers/tenant.py`: GET /tenant/current, /branding, /license; PATCH /tenant/branding
- JWT содержит `"tid"` (tenant_id)

### ✅ Этап 2 — Plugin System
- `app/plugins/base.py`: BasePlugin (ABC: is_enabled, health_check)
- `app/plugins/registry.py`: plugin_registry синглтон
- Плагины: MISPlugin, SMSPlugin (smsc.ru / sms.ru / stub), NotifyPlugin (Telegram)
- `app/routers/plugins.py`: GET /plugins, GET /plugins/{name}/health

### ✅ Этап 3 — Modules + has_feature()
- `app/modules/features.py`: PLAN_FEATURES (basic/professional/enterprise), FEATURE_LABELS
- `require_feature()` — проверяет tenant_modules (override > license.features > plan)
- Feature gates: analytics, kpi, scheduling, financial_ledger, audit_log

### ✅ Этап 4 — Geo + Device
- Модели: `City` (id, name, region, country, lat, lng)
- `Clinic`: добавлены city_id, city, region, latitude, longitude
- `app/utils/geo.py`: `get_client_ip()` (X-Real-IP → X-Forwarded-For → client.host)
- `app/utils/device.py`: `parse_user_agent()` → DeviceType, browser, OS

### ✅ Этап 5 — Расписание врачей (Doctor Schedules + Appointments)
- Модели: `Doctor`, `DoctorSchedule` (шаблон по дням), `Appointment`
- Статусы записей: pending / confirmed / cancelled / completed / no_show
- `services/scheduling_service.py`: `get_available_slots()`, `book_slot()` (проверка конфликтов)
- `routers/scheduling.py`: GET/POST /doctors, /doctors/{id}/schedule, /doctors/{id}/slots, /appointments

### ✅ Этап 6 — Финансовый реестр (Append-only Ledger)
- `models/ledger.py`: `LedgerEntry` (append-only)
- `OpType`: BONUS_ACCRUED / BONUS_PAID / BONUS_CANCELLED / MANUAL_CREDIT / MANUAL_DEBIT
- `services/ledger_service.py`: add_entry, get_balance, get_pending_balance, get_summary, get_history
- `routers/ledger.py`: GET /ledger/balance|summary|history, POST /ledger/adjust

### ✅ Этап 7 — Аналитика drill-down
- GET /analytics/overview — сводка + дельта к предыдущему периоду
- GET /analytics/funnel — воронка 4 шага + ставки конверсии
- GET /analytics/dynamics — динамика (day/week/month granularity)
- GET /analytics/top-services, /top-staff, /clinics, /ledger-trend

### ✅ Этап 8 — Аудит-лог
- `models/audit.py`: `AuditEntry` (actor_id/name, action, entity_type/id, before/after JSONB)
- 19 типов событий: USER_CREATED, BONUS_PAID, SETTINGS_UPDATED и др.
- `routers/audit.py`: GET /audit/log (фильтр action/entity_type/days)

### ✅ Этап 9 — Биллинг
- `models/billing.py`: Subscription (trial/active/past_due/paused/cancelled), Invoice, Payment
- `services/billing_service.py`: create/change/cancel_subscription, generate_invoice, record_payment
- `routers/billing.py`: /billing/plans|summary|subscription|invoices|payments

### ✅ Этап 10 — Мониторинг
- `utils/metrics.py`: lazy Redis client, `record_request` (middleware), health snapshots
- GET /monitoring/health — публичный healthcheck (HTTP 200/503)
- GET /monitoring/metrics — p50/p95/p99, error_rate, top_endpoints
- GET /monitoring/pool — SQLAlchemy pool + pg_stat_activity

### ✅ Этап 11 — Безопасность (RBAC, Refresh Tokens, 152-ФЗ)
- `core/permissions.py`: ROLE_PERMISSIONS матрица (manager/admin/partner)
- `models/refresh_token.py`: RefreshToken (token_hash, device_info, ip, expires_at, revoked)
- `routers/auth.py`: /auth/refresh, /auth/logout, /auth/logout-all, /auth/sessions
- `models/consent.py`: ConsentRecord (152-ФЗ), /consent/accept, /withdraw, /status, /forget

### ✅ Этап 12 — Scheduling UI + Dashboard + Ledger Breakdown
- Frontend: SchedulingSection (~600 строк) — врачи/календарь/записи
- Frontend: HomeDashboard — системные плитки DB/Redis/API/MIS
- Backend: LedgerEntry + поля clinic_id, admin_amount, manager_amount, platform_amount

### ✅ Этап 13 — SaaS Platform (super_admin, onboarding, tenant isolation)
- `UserRole.SUPER_ADMIN` — управление всей платформой
- POST /tenant/create — создаёт tenant+license(trial)+branding+admin за 1 транзакцию
- GET|POST /admin/tenants — список и создание тенантов (super_admin only)
- PUT /admin/tenants/{id}/modules|plugins — включение модулей per-tenant
- Frontend: SuperAdminSection — метрики/тенанты/биллинг/модули
- Динамический брендинг: CSS-переменные из /tenant/branding

### ✅ Этап 14 — Commercial Plugin System
- `models/plugin.py`: PluginCatalog, PluginFeature, TenantPluginFeature, BillingEvent
- `services/plugin_service.py`: enable/disable paid features, billing events, visibility matrix, P2P
- Frontend: PluginsSection — 4 вкладки (управление / интеграции / P2P звонки / видимость)

### ✅ Этап 15 — Webhooks
- `models/webhook.py`: WebhookEndpoint (url, events JSONB, secret), WebhookDelivery
- `services/webhook_service.py`: `send_event()` — async, retry 3, HMAC-SHA256
- Events: referral_created, patient_registered, bonus_paid, invoice_paid
- Frontend: WebhooksSection — список, создание, история доставок, тест

### ✅ Этап 16 — Dynamic Multi-tenant URL Routing
- `frontend/src/config.js`: SLUG/BASE_PATH/API_BASE из `window.location.pathname[0]`
- Хост nginx: regex `/{slug}/api` → backend; `/{slug}/` → SPA
- `backend admin.py`: POST /admin/tenants/{id}/reset-password
- URL тенанта "arc": `https://клиниксеть.рф/arc/`

### ✅ Billing v2 — Production-ready биллинг
- `models/billing_plan.py`: TenantPlan (каталог в БД), TenantPricingRules (split%, franchise_fee%)
- `models/billing_ledger.py`: BillingLedger (append-only, ≠ LedgerEntry бонусов)
- `models/advertising.py`: Ad (flat/cpc/cpm), AdEvent (ip_hash 152-ФЗ)
- Revenue split: gross + split → platform_income + tenant_income + franchise_fee
- `seed_plans.py`: идемпотентный seed (basic/professional/enterprise)
- Alembic: j0k1l2m3n4o5 — 6 таблиц

### ✅ Этап 17 — Nurse & Recruiter Roles (2026-04-17)
- **Роли**: `nurse` (медсестра) и `recruiter` (рекрутер) добавлены в PG enum
- **Модели**:
  - `DoctorClinicAccess` — контроль доступа врачей к клиникам
  - `RecruiterBonus` — бонусы рекрутера (% от бонуса привлечённого врача)
  - `Invitation` — система пригласительных токенов для регистрации
- **Backend**:
  - `routers/recruiter.py`: GET /recruiter/doctors|bonuses|stats|invites, POST /recruiter/invite
  - `GET /invite/{token}` — публичная проверка токена
  - `POST /invite/{token}/accept` — принятие приглашения (ввод пароля + ФИО)
- **Frontend**:
  - `RecruiterCabinet.jsx` — дашборд, список врачей, бонусы, отправка приглашений
  - `OperationalCabinet.jsx` — кабинет медсестры: создание направлений, статистика
  - `InviteAccept.jsx` — страница принятия приглашения (публичная)
- **Миграция**: k1l2m3n4o5p6 — новые таблицы + поля users.email, users.recruiter_id, users.bonus_percent

### ✅ Этап 18 — AdsSection v3 + Telegram Mini App SDK
- **AdsSection v3** (~900 строк React):
  - Drag-and-drop сортировка баннеров
  - `ImageCropEditor.jsx` — встроенный редактор кропа (canvas, без зависимостей)
  - Предпросмотр в мобильном (phoneMockup)
  - Цветовые темы (6 пресетов), расписание показа (дни/часы), авто-пауза по лимитам
  - Дублирование объявлений
  - `AdReport.js` — PDF-отчёт со статистикой (SVG-графики, генерация через Blob)
  - CSV экспорт
- **Ads API v3** (ads.py):
  - Поля: image_data, image_mime, banner_height, interval_seconds, sort_order, schedule, color_theme
  - GET /ads/{id}/stats?days=N — статистика по дням
  - PATCH /ads/reorder — пакетная сортировка
  - POST /ads/{id}/duplicate — дублирование
- **Telegram Mini App SDK** (`lib/tg.js`):
  - `waitForTelegramSDK()` — ждёт SDK с таймаутом 2с (не блокирует веб-режим)
  - `initTgApp()` — tg.ready() + tg.expand()
  - `isTelegramWebApp()`, `getTgUser()`, `getTgInitData()`
  - App.jsx: гибридный init — сначала веб-сессия, потом Telegram (если tgWebApp в hash)

---

## Модели данных

### Основные таблицы
| Таблица | Описание |
|---------|----------|
| `tenants` | Тенанты SaaS (организации) |
| `tenant_licenses` | Тарифный план + лимиты |
| `tenant_branding` | Бренд (цвета, логотип) |
| `users` | Все роли: admin/manager/doctor/nurse/recruiter/partner/super_admin |
| `clinics` | Клиники, привязаны к тенанту |
| `referrals` | Направления пациентов |
| `bonuses` | Начисленные бонусы |
| `services` | Услуги клиник |
| `doctors` | Врачи (расписание) |
| `doctor_schedules` | Шаблоны рабочего времени |
| `appointments` | Записи к врачу |
| `doctor_clinic_access` | Доступ врача к клиникам |
| `invitations` | Пригласительные токены |
| `recruiter_bonuses` | Бонусы рекрутеров |

### Финансовые таблицы
| Таблица | Описание |
|---------|----------|
| `ledger_entries` | Бонусный реестр (append-only) |
| `subscriptions` | Подписки тенантов |
| `invoices` | Счета |
| `payments` | Платежи |
| `tenant_plans` | Тарифные планы (в БД) |
| `billing_ledger` | Платёжный журнал с revenue split |
| `tenant_pricing_rules` | Правила разделения выручки |

### Прочие таблицы
| Таблица | Описание |
|---------|----------|
| `audit_entries` | Аудит-журнал |
| `consent_records` | Согласия 152-ФЗ |
| `refresh_tokens` | Сессии refresh tokens |
| `webhook_endpoints` | Вебхук-подписчики |
| `webhook_deliveries` | Лог доставок вебхуков |
| `ads` | Рекламные объявления |
| `ad_events` | События рекламы (impression/click/conversion) |
| `plugin_subscriptions` | Активные платные плагины |
| `cities` | Справочник городов |

---

## API Endpoints

### Аутентификация
```
POST /auth/login          — вход (username/password)
POST /auth/refresh        — обновление access token
POST /auth/logout         — выход (revoke refresh)
POST /auth/logout-all     — выход со всех устройств
GET  /auth/sessions       — список активных сессий
```

### Направления и бонусы
```
POST /referrals/          — создать направление
GET  /referrals/          — список направлений
POST /referrals/{id}/scan — подтвердить QR-скан
GET  /bonuses/my          — бонусы текущего пользователя
POST /bonuses/pay         — выплатить бонусы
```

### Расписание
```
GET  /doctors/            — список врачей тенанта
POST /doctors/            — добавить врача
PUT  /doctors/{id}/schedule — установить расписание
GET  /doctors/{id}/slots  — доступные слоты
POST /appointments/       — записаться к врачу
GET  /appointments/       — список записей
PATCH /appointments/{id}/status — изменить статус
```

### Аналитика
```
GET /analytics/overview         — сводка с дельтой
GET /analytics/funnel           — воронка направлений
GET /analytics/dynamics         — динамика по времени
GET /analytics/top-services     — топ услуг
GET /analytics/top-staff        — рейтинг сотрудников
GET /analytics/clinics          — сравнение клиник
GET /analytics/ledger-trend     — накопительный баланс
```

### Реклама
```
GET    /ads/              — список объявлений (фильтр ?status=)
POST   /ads/              — создать объявление
PATCH  /ads/{id}          — обновить объявление
PATCH  /ads/reorder       — пакетная сортировка
POST   /ads/{id}/duplicate — дублировать
GET    /ads/{id}/stats    — статистика по дням (?days=N)
GET    /ads/active        — активные (для клиентского показа)
POST   /ads/{id}/event    — записать событие (impression/click/conversion)
```

### Рекрутер
```
GET  /recruiter/doctors   — привлечённые врачи
GET  /recruiter/bonuses   — бонусы рекрутера
GET  /recruiter/stats     — сводная статистика
POST /recruiter/invite    — пригласить врача (email)
GET  /recruiter/invites   — список приглашений
GET  /invite/{token}      — проверить токен (публичный)
POST /invite/{token}/accept — принять приглашение
```

### Platform (super_admin only)
```
GET    /admin/tenants              — все тенанты
POST   /admin/tenants              — создать тенант
GET    /admin/metrics              — метрики платформы
GET    /admin/billing              — MRR + подписки
PUT    /admin/tenants/{id}/modules — включить модули
PUT    /admin/tenants/{id}/plugins — включить плагины
POST   /admin/tenants/{id}/reset-password — сброс пароля
GET    /admin/tenants/{id}/credentials   — логин/пароль
```

---

## Тарифные планы

| Фича | Basic | Professional | Enterprise |
|------|-------|--------------|-----------|
| Направления пациентов | ✅ | ✅ | ✅ |
| Бонусная система | ✅ | ✅ | ✅ |
| Аналитика | ❌ | ✅ | ✅ |
| KPI | ❌ | ✅ | ✅ |
| Расписание врачей | ❌ | ✅ | ✅ |
| Финансовый реестр | ❌ | ✅ | ✅ |
| Аудит-лог | ❌ | ✅ | ✅ |
| Вебхуки | ❌ | ❌ | ✅ |
| Накопительный баланс | ❌ | ❌ | ✅ |
| Max клиник | 5 | 50 | ∞ |
| Max пользователей | 20 | 500 | ∞ |

---

## Структура проекта

```
clinika/
├── backend/
│   ├── alembic/               # Миграции БД
│   │   └── versions/          # История миграций (17+ файлов)
│   └── app/
│       ├── core/
│       │   ├── deps.py        # FastAPI dependencies (auth, tenant)
│       │   ├── permissions.py # RBAC матрица
│       │   ├── tenant.py      # Tenant context helpers
│       │   └── limits.py      # Plan enforcement
│       ├── models/            # SQLAlchemy models (22+ файла)
│       ├── routers/           # FastAPI routers (30+ эндпоинтов)
│       │   └── manager/       # Менеджерские роутеры (11 файлов)
│       ├── services/          # Бизнес-логика
│       ├── utils/             # geo, device, metrics
│       ├── plugins/           # Plugin registry (MIS, SMS, Notify)
│       ├── modules/           # Feature flags (plan features)
│       └── main.py            # FastAPI app + middleware
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── AdminLayout.jsx      # Панель управления (admin/super_admin)
│   │   │   ├── AdminLogin.jsx       # Вход в панель
│   │   │   ├── AdminRoot.jsx        # Роутинг кабинетов по роли
│   │   │   ├── PatientCabinet.jsx   # Кабинет партнёра (Telegram Mini App)
│   │   │   ├── DoctorCabinet.jsx    # Кабинет врача
│   │   │   ├── OperationalCabinet.jsx # Кабинет медсестры
│   │   │   ├── RecruiterCabinet.jsx # Кабинет рекрутера
│   │   │   ├── Landing.jsx          # Лендинг платформы
│   │   │   └── InviteAccept.jsx     # Принятие приглашения
│   │   ├── sections/
│   │   │   ├── AdsSection.jsx       # Реклама (v3: кроп, превью, дранд-дроп)
│   │   │   ├── ImageCropEditor.jsx  # Редактор кропа изображений (canvas)
│   │   │   ├── WebhooksSection.jsx  # Вебхуки
│   │   │   ├── PlatformSection.jsx  # SuperAdmin: тенанты, метрики
│   │   │   └── AISection.jsx        # AI-аналитика (Gemini)
│   │   ├── lib/
│   │   │   └── tg.js               # Telegram SDK helper
│   │   ├── AdReport.js             # PDF-генератор отчётов по рекламе
│   │   ├── App.jsx                 # Корневой компонент + init
│   │   └── config.js              # SLUG, API_BASE, PLATFORM_MODE
│   ├── Dockerfile
│   └── nginx.conf
├── bot/                           # Telegram-бот (super_admin уведомления)
├── docker-compose.yml
├── deploy.sh
└── README.md
```

---

## Развёртывание

```bash
# Первый запуск
cp .env.example .env
# Отредактировать .env (SECRET_KEY, DATABASE_URL, BOT_TOKEN и др.)
docker compose up -d

# Применить миграции (внутри контейнера)
docker exec clinika-backend alembic upgrade head

# Seed тарифных планов
docker exec clinika-backend python seed_plans.py

# Пересборка фронтенда (после изменений)
docker compose build --no-cache clinika-frontend
docker compose up -d clinika-frontend
```

### Переменные окружения (.env)

```env
# База данных
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/clinika
REDIS_URL=redis://localhost:6379

# JWT
SECRET_KEY=your-secret-key-min-32-chars
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=30

# Telegram бот
ADMIN_BOT_TOKEN=bot_token_here
ADMIN_CHAT_ID=293633093

# Gemini AI (для AISection)
GEMINI_API_KEY=

# LiveKit (для P2P звонков, опционально)
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

---

## Известные правила / Что не ломать

### ⚠️ При изменении фронтенда
1. `frontend/src/config.js` — SLUG и API_BASE берутся из URL, не захардкожены
2. Новая роль → нужно добавить в 3 места: `redirect_url` в `auth.py`, ключ токена в `config.js`, маршрут в `AdminRoot.jsx`
3. JSX-блоки не вставлять на уровне модуля — только внутри функций-компонентов
4. После изменений фронтенда — пересобрать: `docker compose build --no-cache clinika-frontend && docker compose up -d clinika-frontend`

### ⚠️ При изменении backend
1. Новая Alembic-миграция → применить: `docker exec clinika-backend alembic upgrade head`
2. Не менять `down_revision` существующих миграций
3. Новый роутер → зарегистрировать в `main.py`

### ⚠️ При изменении ролей
1. Добавить значение в PG enum (`ALTER TYPE userrole ADD VALUE IF NOT EXISTS`)
2. Добавить в `ROLE_PERMISSIONS` матрицу (`core/permissions.py`)
3. Добавить в `require_role()` в `deps.py`
4. Создать кабинет или добавить обработку в `AdminRoot.jsx`

---

## Планы / TODO

- [ ] **Franchise fee UI** — суперадмин видит franchise_fee в BillingLedger
- [ ] **BillingLedgerSection.jsx** — фронтенд финансового журнала (split, тренд)
- [ ] **WebRTC/LiveKit** — токены для P2P звонков врач↔медсестра
- [ ] **AI-инсайты (Gemini)** — полная интеграция: автоматические рекомендации
- [ ] **Fail-safe** — retry decorator для MIS-клиента, Redis queue вебхуков
- [ ] **Тесты** — pytest unit + smoke (check_limit, billing_service, onboard_tenant)
- [ ] **Supervisor кабинет** — кабинет владельца франшизы
- [ ] **White-label domain** — nginx slug routing + tenant per domain
