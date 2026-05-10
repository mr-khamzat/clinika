<div align="center">

# 🏥 КлиникСеть

**SaaS-платформа для управления сетью медицинских клиник**

[![Production](https://img.shields.io/badge/Production-Active-success)](https://клиниксеть.рф)
[![License](https://img.shields.io/badge/License-Proprietary-blue)]()
[![Backend](https://img.shields.io/badge/Backend-FastAPI%200.115-009688)]()
[![Frontend](https://img.shields.io/badge/Frontend-React%2018%20%2B%20Vite-61dafb)]()
[![Database](https://img.shields.io/badge/Database-PostgreSQL%2016-336791)]()
[![Tests](https://img.shields.io/badge/Tests-121%20passed-success)]()
[![Coverage](https://img.shields.io/badge/Coverage-35%25-yellow)]()

[Возможности](#-возможности) • [Архитектура](#-архитектура) • [Установка](#-установка) • [Документация](#-документация) • [Roadmap](#-roadmap)

</div>

---

## 📖 О проекте

**КлиникСеть** — многотенантная SaaS-платформа для управления сетью медицинских клиник: учёт направлений, бонусная система между клиниками, интеграция с МИС Renovatio, биллинг подписок, телемедицина, реклама с A/B-тестами, ЛК пациента, мобильная PWA.

Используется в реальной франшизе из 5 клиник: **АРЦ**, **Лорсанова**, **НЕОМЕД**, **Ачхой**, **Серноводск**.

### 🎯 Ключевые цифры
- **20+ модулей** в каталоге (телемедицина, реклама, инвентарь, лояльность, AI-аналитика, ОФД, эквайринг и др.)
- **11 ролей**: super_admin / franchise_owner / manager / doctor / reg / nurse / recruiter / partner_doctor / visiting_doctor / acquisition_manager / patient
- **70+ Backend endpoints** + Public API v1
- **80 миграций** Alembic
- **121 pytest тестов**, coverage 35% по критическим путям
- **Frontend bundle**: 167 KB gzipped (главный chunk)

---

## ✨ Возможности

### 🏢 Платформа (super_admin)
- **Marketplace модулей** — витрина с триал-периодом, скриншотами, фичами
- **Tenant impersonation** — заход «как tenant» с полным audit-логом
- **Журнал безопасности** — failed logins, brute-force, webhook-нарушения, IP-блокировка
- **Module Monitoring** — 20 health-check адаптеров, Telegram-алерты, daily digest
- **API-keys для tenants** — публичный API v1 с RBAC по scopes
- **Cohort-анализ клиник** (в работе)
- **KPI-Dashboard франшизы** (в работе)

### 🏛 Кабинет франшизы (franchise_owner)
- Управление дочерними клиниками (адрес, юр.лицо, руководитель)
- Партнёрские клиники с контрактами: royalty / per_referral / hybrid
- Биллинг: счета от платформы, межклиничные акты, биллинг сети
- LTV-аналитика пациентов
- Аналитика записей и направлений (drill-down)
- Реклама pro (A/B-тесты, таргетинг, ROI, AI-генерация креативов)
- CMS-страницы (white-label лендинг)
- Брендинг (custom domain, цвета, лого)
- Мониторинг модулей (heatmap по тенантам)
- Wiki / База знаний
- Подключение модулей (триал и оплата)

### 🏥 Кабинет руководителя клиники (manager)
- Создание сотрудников всех ролей (doctor / reg / nurse / recruiter / partner / visiting)
- Управление клиниками сети (с фильтром по `clinic_id`)
- Услуги с категориями и бонусной частью
- Бонусы сотрудников + одобрение отмен
- KPI и отчёты (по сотрудникам, клиникам, услугам)
- Финансы: бонусы / межклиничные акты / счета платформы
- Расписание врачей
- Скидки и акции
- Аналитика приёмов
- Кампании SMS / Loyalty

### 👨‍⚕️ Кабинет врача (doctor + visiting + partner)
- Расписание дня и недели с премиум-дизайном
- Список приёмов: активные / завершённые / отменённые с причинами
- Подтверждение приёма по QR / 5-значному коду
- Расчёт заработка для visiting/partner (50/50 split, редактируемый)
- Создание медкарт пациентов
- Назначения и рецепты
- Заработок и история выплат

### 🎫 Кабинет регистратора (reg / nurse)
- Создание направлений 3 типов: **услуга** / **врач** / **анализы**
- Поиск пациента в МИС Renovatio (по телефону и/или ФИО)
- Создание пациента в МИС в один клик
- Каталог анализов из МИС с категориями + поиском
- QR + 5-значный код для пациента
- Приём пациента по QR-сканеру / коду
- Бонусы и направления (только свои с фильтром `created_by_admin_id == current_user.id`)
- KPI: направлений сегодня, неделя, мои бонусы

### 🎯 Кабинет рекрутера (recruiter)
- Регистрация партнёров-врачей напрямую (с QR на вход)
- Управление доступом партнёров к клиникам
- Бонусы рекрутера (% от направлений партнёров)

### 🧑‍🤝‍🧑 ЛК пациента (PWA + Telegram WebApp)
- **Авто-вход по QR** с короткого направления
- **Семейный профиль**: добавление членов семьи + поиск в МИС по `parent_id`
- **Переключение между профилями** (требуется short_code для подтверждения)
- **Медкарта (Уровень 1)**: автоматическая хронология из направлений, приёмов и МИС-визитов
- **Показатели здоровья**: динамические KPI-карточки (пульс, давление, SpO₂, шаги, вес, рост и др.) + графики 30 дней
- **Apple Health / Google Fit** как платные модули (выключены по умолчанию)
- **Документы**: загрузка справок, выписок, больничных
- **Чат с поддержкой** + AI-ассистент
- **Видео-приём** через WebRTC (coturn + presence)
- **152-ФЗ права**: экспорт данных в JSON + кнопка «Удалить мои данные» (анонимизация)
- **Push-нотификации** через ServiceWorker
- **Реклама-баннеры** с idempotent impression tracking

### 💰 Финансовая модель
- **Каскадный расчёт бонусов**:
  - `bonus_total` (300₽ на услуге/враче) − `platform_fee_floor` (100₽) = `intermediate` (200₽)
  - Если автор = партнёр-врач с рекрутером (10%): рекрутер получает 20₽, автор 180₽
  - Если автор = штатный сотрудник: 200₽ автору, 100₽ платформе
- **Idempotent confirm** с `pg_advisory_xact_lock` + `SELECT FOR UPDATE` + UNIQUE constraint
- **InterClinicInvoice** между клиниками с автозакрытием и подписями
- **FranchiseInvoice** от платформы → tenant'у
- **BillingLedger** для всех движений
- **`approve_cancel`** правильно откатывает: Bonus → CANCELLED, RecruiterBonus → CANCELLED, ICI → CANCELLED, BillingLedger refund

### 🔌 Интеграции
- **МИС Renovatio** (per-clinic настройки) — пациенты, врачи, услуги, приёмы, программы лояльности
- **Telegram Bot API** через прокси-туннель 212→144 (провайдер блокирует прямой доступ)
- **ЮKassa эквайринг** — рабочий адаптер (init/status/refund/webhook + IP-allowlist)
- **Платформа ОФД** — фискализация 54-ФЗ (send_receipt + auto-pull статусов)
- **SMTP email-service** (Jinja2 шаблоны) — welcome / password-reset / digest
- **coturn** для WebRTC (HMAC-SHA1 short-term creds через `/presence/ice-config`)
- **Prometheus** + **Grafana** + **postgres-exporter** + **Uptime-Kuma**
- **Sentry** (готово, нужен DSN)
- **WhatsApp Web** через Electron-обёртку (с прокси-фиксом BasicAuth)

### 🛡 Безопасность
- **JWT** access (30 мин) + refresh (30 дней) с ротацией секретов при старте
- **bcrypt** для паролей (или PBKDF2-SHA256 260k iter)
- **Fail-fast** при дефолтных секретах в продакшне
- **RBAC** через `require_role` / `require_manager` / `require_super_admin`
- **Tenant isolation** через middleware с `app.tenant_id` SET LOCAL
- **Manager scope** по clinic_id (фильтр в 7+ endpoints)
- **Rate-limit** на auth (5/min) + sliding-window middleware (200 req/min)
- **Region Lock** с IP-allowlist + manual block + GeoIP
- **CSP, HSTS, X-Frame-Options, Permissions-Policy, X-Content-Type-Options**
- **TLS 1.2/1.3** + HTTP/3 + QUIC
- **Idempotency-keys** для рекламных событий
- **152-ФЗ соответствие**: consent versioning, право на удаление, экспорт данных
- **Audit log** всех важных действий с before/after diff

### ⚡ Производительность
- **Frontend bundle: 1.32MB → 738KB → 167KB gzipped** (-50% от исходного)
- **Lazy-load** PatientCabinet, FranchiseOwnerCabinet, Landing, ScanScreen
- **Code-splitting**: jspdf/xlsx/qr грузятся по запросу
- **Pre-gzipped assets** в Docker-образе (gzip_static в nginx)
- **HTTP/2** + **HTTP/3 (QUIC)**
- **Self-hosted Material Symbols** (3.3 MB) + Golos Text (72 KB)
- **CDN-free** — нет внешних зависимостей
- **PostgreSQL**: 15 FK-индексов + `pg_stat_statements`
- **Cache-Control immutable** для assets на 1 год
- **Service Worker** с CACHE_NAME=v3 для PWA

### 📊 Reliability / DevOps
- **Healthcheck** на 9 контейнеров (backend, frontend, bot, db, redis, grafana, prometheus, postgres-exporter, uptime-kuma)
- **Backup** ежедневно 03:00 с **GPG-шифрованием** + cron под root
- **Test-restore** еженедельно (поднимает временный PG, проверяет dump)
- **Uptime-Kuma** с 3 мониторами
- **Telegram-алерты** при сбоях модулей (`alert_service.notify_admin`)
- **Daily digest** модулей в 09:00 МСК
- **Auto-cleanup**: docker buildx prune каждые 2 часа + при df>70%
- **Self-healing**: healthcheck.sh перезапускает упавший backend

---

## 🏗 Архитектура

### Backend (FastAPI 0.115)
```
app/
├── main.py              # FastAPI app + lifespan + scheduler
├── database.py          # AsyncSessionLocal + engine
├── config.py            # Settings (pydantic-settings)
├── core/
│   ├── deps.py          # get_current_user, require_*
│   ├── domain_router.py # CNAME → tenant_slug middleware
│   ├── region_lock.py   # Geo-блокировка
│   ├── security.py      # JWT + hash_password
│   └── permissions.py   # RBAC матрица
├── models/              # 60+ SQLAlchemy моделей
├── routers/             # 50+ роутеров (включая manager/* subroutes)
├── services/            # MIS клиент, billing, fiscal, acquiring, AI
├── jobs/                # Cron-задачи (auto-confirm, daily-invoices, etc)
├── schemas/             # Pydantic v2 модели
└── utils/               # Helpers (phone, qr, metrics)
```

### Frontend (React 18 + Vite)
```
src/
├── App.jsx              # Router + lazy-load
├── pages/
│   ├── AdminLayout.jsx              # 8800+ строк — super_admin/franchise_owner кабинет
│   ├── FranchiseOwnerCabinet.jsx    # Кабинет владельца франшизы
│   ├── OperationalCabinet.jsx       # Кабинет reg/nurse
│   ├── DoctorLayout.jsx             # Кабинет врача
│   ├── PatientCabinet.jsx           # ЛК пациента (PWA)
│   ├── RecruiterCabinet.jsx
│   ├── PartnerDoctorCabinet.jsx
│   ├── VisitingDoctorCabinet.jsx
│   ├── ManagerDashboard.jsx + Manager*.jsx
│   └── Landing.jsx                  # Публичный лендинг
├── sections/            # 60+ переиспользуемых секций (lazy-load)
├── components/          # UI-компоненты (Modal, Toast, Card, etc)
├── design/              # Design-system tokens + components
└── api.js               # Axios клиент с auto-refresh
```

### База данных (PostgreSQL 16)
- **Multi-tenant**: `tenants` + `tenant_modules` + `app.tenant_id` SET LOCAL
- **80 миграций** Alembic
- **30 MB** размер БД в продакшне
- **pg_stat_statements** включён

---

## 🚀 Установка

### Требования
- Docker 24+ и Docker Compose v2
- Сервер с **2 vCPU / 4 GB RAM / 50 GB SSD** минимум
- Домен с настроенными DNS A-записями
- Let's Encrypt сертификат

### Развёртывание
```bash
git clone https://github.com/mr-khamzat/clinika.git /opt/clinika
cd /opt/clinika

# 1. Скопировать и заполнить .env
cp .env.example .env
nano .env

# 2. Установить SSL (Let's Encrypt)
certbot certonly --webroot -w /var/www/html -d клиниксеть.рф

# 3. Запустить
docker compose up -d

# 4. Применить миграции
docker exec clinika-backend alembic -c /app/alembic.ini upgrade head

# 5. Создать super-admin (одноразово через ENV)
# SUPERADMIN_USERNAME=admin SUPERADMIN_PASSWORD=... подхватится при первом старте
```

### Переменные окружения (`.env`)

#### Обязательные
```bash
DATABASE_URL=postgresql+asyncpg://clinika:pass@clinika-db:5432/clinika
REDIS_URL=redis://clinika-redis:6379/0
SECRET_KEY=<64+ символов случайных>
QR_SECRET=<48+ символов>
WEBHOOK_API_KEY=wh-<random>
SUPERADMIN_USERNAME=admin
SUPERADMIN_PASSWORD=<сильный пароль>
SUPERADMIN_FULL_NAME=Имя Фамилия
MINI_APP_URL=https://клиниксеть.рф
ALLOWED_ORIGINS=https://клиниксеть.рф
```

#### Интеграции (опционально)
```bash
# МИС Renovatio
MIS_API_URL=http://mis.stoclinic.ru:3010
MIS_API_KEY=<32-hex>
MIS_SSL_VERIFY=false

# ЮKassa (эквайринг)
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET_KEY=

# Платформа ОФД (54-ФЗ)
PLATFORMA_OFD_LOGIN=
PLATFORMA_OFD_PASSWORD=
COMPANY_INN=
COMPANY_TAX_SYSTEM=usn_income

# Telegram-бот (через прокси-туннель)
TELEGRAM_BOT_TOKEN=
ADMIN_CHAT_ID=
TELEGRAM_PROXY_URL=http://user:pass@host:port

# Sentry
SENTRY_DSN=

# SMTP (для forgot-password и welcome-email)
SMTP_HOST=
SMTP_USER=
SMTP_PASSWORD=

# coturn (WebRTC)
TURN_HOST=
TURN_PORT=3478
TURN_SECRET=
```

---

## 🧪 Тестирование

```bash
# Все тесты
docker exec clinika-backend pytest /app/tests/ -v

# Только новые critical-path тесты
docker exec clinika-backend pytest /app/tests/test_bonus_cascade.py -v
docker exec clinika-backend pytest /app/tests/test_referrals_race.py -v
docker exec clinika-backend pytest /app/tests/test_approve_cancel.py -v
docker exec clinika-backend pytest /app/tests/test_rbac_isolation.py -v

# Coverage
docker exec clinika-backend pytest --cov=app --cov-report=term-missing
```

**Покрытие**:
- `referral_service.py` — 61%
- `settings_service.py` — 84%
- `ledger_service.py` — 62%
- Общее — **35%**

---

## 🗺 Roadmap

### ✅ Сделано (актуальная версия)
- [x] Multi-tenant архитектура с rollback на 1 tenant + 5 клиник
- [x] 11 ролей + RBAC + manager scope по clinic_id
- [x] 3 типа направлений (услуга / врач / анализы)
- [x] Каскадная финмодель с advisory lock
- [x] МИС per-clinic + helper resolver
- [x] Реклама pro (A/B + audience + ROI + AI-генерация)
- [x] Module Monitoring System (20 адаптеров + alerts)
- [x] Forgot/Reset password flow
- [x] 152-ФЗ права пациента (export + erase)
- [x] ЮKassa + Платформа ОФД adapters
- [x] GPG-шифрование бэкапов + cron + test-restore
- [x] Apple Health + Google Fit как модули

### 🟡 В работе
- [ ] Marketplace модулей (UI витрины с триал-периодом)
- [ ] Tenant impersonation для super_admin
- [ ] Journal безопасности (единый dashboard)
- [ ] API-keys для tenant интеграций (CRM/BI)
- [ ] Self-service onboarding wizard

### 📋 Запланировано
- [ ] Cohort-анализ клиник (heatmap)
- [ ] KPI-Dashboard топ-менеджмента (live)
- [ ] Bulk-настройка тарифов
- [ ] Kanban расписание (drag-and-drop)
- [ ] Анализ загрузки врачей
- [ ] Шаблоны направлений
- [ ] Multi-clinic view для менеджеров
- [ ] Pre-visit briefing с AI
- [ ] Генератор плана лечения
- [ ] Direct billing для visiting/partner
- [ ] Подписка «Здоровье»
- [ ] Программа лояльности с уровнями
- [ ] Чат с врачом (асинхронный)
- [ ] Calendar-интеграция (iCloud/Google)
- [ ] Document storage
- [ ] Лаборатория-интеграция (Helix/Invitro)
- [ ] Wellness-модуль (Whoop/Oura/Garmin)
- [ ] Партнёрская программа агрегаторам
- [ ] Disaster-mode (offline МИС)
- [ ] iOS + Android native apps
- [ ] Электронная подпись (КриптоПро)
- [ ] ЕМИАС адаптер

### 🚧 Блокеры коммерческого запуска
- [ ] Регистрация ИП/ООО → ИНН/ОГРН для Privacy/Terms/Consent
- [ ] Уведомление Роскомнадзора как оператор ПДн
- [ ] Мед.лицензия Росздравнадзора (или B2B-модель)
- [ ] ЮKassa аккаунт (для онлайн-оплаты подписок)
- [ ] Платформа ОФД аккаунт (для фискализации 54-ФЗ)
- [ ] SMTP-аккаунт + SPF/DKIM/DMARC в DNS
- [ ] Yandex.Disk/S3 для offsite-бэкапов

**Тихий запуск возможен сейчас** — B2B-модель с оплатой по банковским переводам.

---

## 📚 Документация

- [API_REFERENCE.md](docs/API_REFERENCE.md) — справочник эндпоинтов
- [API_CONTRACT.md](docs/API_CONTRACT.md) — контракт API
- [API_CONVENTIONS.md](docs/API_CONVENTIONS.md) — соглашения
- [BACKUP.md](docs/BACKUP.md) — стратегия резервного копирования
- [MONITORING.md](docs/MONITORING.md) — мониторинг и алерты
- [PAYMENTS_FOUNDATION.md](docs/PAYMENTS_FOUNDATION.md) — платёжная архитектура
- [RENOVATIO_API.md](docs/RENOVATIO_API.md) — интеграция с МИС
- [SECURITY_HEADERS.md](docs/SECURITY_HEADERS.md) — security headers
- [SENTRY_SETUP.md](docs/SENTRY_SETUP.md) — настройка Sentry

### Wiki (внутри платформы)
В каждом кабинете есть раздел «Wiki / База знаний» (`/wiki`):
- Роли (super_admin / franchise_owner / manager / doctor / reg / nurse / patient / recruiter / partner_doctor / visiting_doctor)
- Концепции (направления, бонусы, QR, модули, приёмы)
- Настройка (первая клиника, сотрудники)

Swagger UI: `https://домен/docs` (доступ только super_admin)
ReDoc: `https://домен/redoc` (только super_admin)

---

## 🔌 API v1 (для внешних интеграций)

### Auth
Bearer token в заголовке:
```
Authorization: Bearer clk_live_<api_key>
```

API-ключи создаются в кабинете franchise_owner → «API-ключи». Scopes:
- `read:referrals` / `write:referrals`
- `read:patients` / `write:patients`
- `read:appointments` / `write:appointments`
- `read:finance`

### Эндпоинты
```
GET    /api/v1/referrals?since=2026-01-01&status=confirmed
GET    /api/v1/referrals/{id}
GET    /api/v1/patients?phone=+7...
GET    /api/v1/appointments?from=&to=
GET    /api/v1/finance/summary?period=month
```

Rate-limit: **1000 req/hour** на ключ.

---

## 🤝 Структура команды

| Роль | Ответственность |
|---|---|
| **Хамзат** (super_admin) | Архитектура платформы, безопасность, биллинг |
| **Лорсанова, manager arc** | Управление клиникой Лорсанова, наполнение услуг |
| **Регистраторы** | Создание направлений, приём пациентов |
| **Врачи** | Расписание, приёмы, медкарты |
| **Рекрутеры** | Привлечение партнёров-врачей |

---

## 📞 Поддержка

- **Telegram**: [@RootkinG85](https://t.me/RootkinG85)
- **Email**: mrevil9995@gmail.com
- **GitHub Issues**: [github.com/mr-khamzat/clinika/issues](https://github.com/mr-khamzat/clinika/issues)
- **Сервер**: 212.57.118.126 (Ubuntu 24.04, u1host.com)
- **Production URL**: https://клиниксеть.рф

---

## 📄 Лицензия

Proprietary. Все права защищены © КлиникСеть 2024-2026.

---

<div align="center">

**Made with ❤️ for healthcare in Russia**

[⬆ К началу](#-клиниксеть)

</div>
