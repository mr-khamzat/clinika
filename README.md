# КлиникаСеть — Платформа направлений и бонусов

SaaS-платформа для сети медицинских клиник: направления пациентов, бонусная система, аналитика, QR-подтверждения, поддержка, партнёрский портал.

**Стек**: FastAPI · SQLAlchemy 2.0 async · PostgreSQL 16 · Redis 7 · React 18 · Vite · Tailwind CSS · Docker Compose

---

## Возможности

### Направления пациентов
- Создание направления с выбором клиники и услуги
- QR-код с HMAC-подписью (`REF:<uuid>:<hmac_16>`) — защита от подделки
- Подтверждение по QR-скану или короткому коду
- Статусы: `created → confirmed → expired / cancel_requested → cancelled`
- Автоматическое истечение через 7 дней (фоновая задача)
- Комментарии к направлению
- Запрос отмены сотрудником + одобрение/отклонение руководителем
- Личный кабинет пациента (JWT по телефону, 90 дней)

### Бонусная система
- Начисление бонуса при подтверждении направления
- Типы: `regular` (фиксированный) и `commission` (процент)
- Настраиваемый размер бонуса по категориям услуг
- Статусы: `pending → paid`
- Массовая выплата бонусов сотруднику / всем сразу
- Сводка по балансу сотрудника

### Персонал и клиники
- Роли: `admin` (сотрудник), `manager` (руководитель), `partner` (партнёр)
- CRUD сотрудников с привязкой к клинике
- CRUD клиник с расписанием работы (по дням недели)
- Геоданные клиник: город, регион, координаты
- Услуги клиник с синхронизацией из МИС Renovatio

### Партнёрский портал
- Инвайт-ссылки с ограничением по количеству использований и сроку
- Регистрация партнёра по коду приглашения
- CRUD партнёров руководителем
- Партнёр создаёт направления через отдельный интерфейс

### Скидки и акции
- CRUD скидок (процент или фиксированная сумма)
- Привязка к клинике, услуге или глобально
- Фильтрация по активным/архивным

### KPI и цели
- Установка ежемесячных целей по направлениям для сотрудников
- Статистика выполнения KPI в реальном времени
- Требует план `professional+` (feature gate)

### Аналитика и отчёты (руководитель)
- Сводный дашборд: направления, бонусы, конверсия
- Статистика по каждому сотруднику
- Поток направлений между клиниками
- Ежедневный отчёт
- Аналитика drill-down (топ услуги, топ сотрудники, динамика)
- График направлений за период
- Статистика сегодня (live)
- Экспорт в CSV
- Badge-счётчики (новые направления, ожидающие выплаты и т.д.)
- Требует план `professional+`

### Чат поддержки
- Пользователь пишет вопрос прямо в Mini App
- Оператор отвечает из Telegram-бота (reply на сообщение)
- Загрузка файлов/изображений в чате
- Онлайн-статус оператора (heartbeat)
- Счётчик непрочитанных для оператора
- Список всех диалогов для оператора

### Интеграция с МИС Renovatio
- Синхронизация услуг из МИС по клиникам
- Поиск пациента по телефону
- Получение визитов пациентов
- Вебхук `POST /integrations/mis/webhook` — автоподтверждение при визите
- Тест подключения и статус из панели руководителя
- SSL-верификация настраивается через env

### Мониторинг (панель руководителя)
- Системный статус: CPU, RAM, диск
- Статус Redis, PostgreSQL, MIS
- Логи контейнера (последние N строк)
- Анализ БД: размеры таблиц, количество записей
- Статистика производительности
- Статистика безопасности (активные сессии, попытки входа)
- Статус всех интеграций

### Аутентификация
- Вход через Telegram Mini App (HMAC-верификация initData)
- Вход по логину/пароль (PBKDF2-SHA256)
- Регистрация по инвайт-коду
- Rate limiting (10 попыток / 5 минут)
- JWT токены с ролью и tenant_id

### SaaS-слой

#### Multi-tenant
- Модели: `Tenant`, `TenantLicense`, `TenantBranding`
- Планы: `basic` / `professional` / `enterprise`
- Лимиты: max_clinics, max_users
- Кастомный брендинг: цвета, логотип, шрифт
- `tenant_id` во всех основных таблицах
- JWT содержит `tid` (tenant_id)

#### Система модулей (has_feature)
```python
has_feature(license, "analytics")  # → True/False по плану
```
| Фича | basic | professional | enterprise |
|------|:-----:|:------------:|:----------:|
| referrals, bonuses, clinics, qr_scan | ✅ | ✅ | ✅ |
| analytics, kpi, support, invitations | — | ✅ | ✅ |
| discounts, mis_sync, partner_portal | — | ✅ | ✅ |
| scheduling, billing, audit_log | — | — | ✅ |

`GET /modules/features` — фронтенд получает список фич с `enabled`-флагом и скрывает недоступные разделы.

#### Плагины
| Плагин | Описание |
|--------|---------|
| `mis` | МИС Renovatio (обёртка mis_client) |
| `sms` | SMS-уведомления (smsc.ru / sms.ru / stub) |
| `notify` | Telegram-уведомления |

`GET /plugins` — статус всех плагинов  
`GET /plugins/{name}/health` — health-check конкретного плагина

#### Geo + Device
- Таблица `cities` (название, регион, координаты)
- Поля `city`, `city_id`, `region`, `latitude`, `longitude` в клиниках
- `GET /geo/cities?search=...` — список городов для UI
- Middleware: `request.state.device_type` (mobile/tablet/desktop/bot) на каждом запросе
- `GET /geo/device` — тип устройства и IP клиента

---

## Архитектура

```
clinika/
├── backend/
│   └── app/
│       ├── core/           # deps.py, security.py, tenant.py
│       ├── models/         # User, Clinic, Referral, Bonus, Tenant, City, ...
│       ├── modules/        # has_feature(), каталог фич по планам
│       ├── plugins/        # MIS, SMS, Notify (BasePlugin + registry)
│       ├── routers/
│       │   ├── manager/    # 11 суброутеров: reports, staff, kpi, bonuses_mgmt,
│       │   │               #   clinics_mgmt, services_mgmt, settings_mgmt,
│       │   │               #   activity, partners, discounts, kpi
│       │   ├── auth.py     # /auth/telegram, /auth/login, /auth/register-invite
│       │   ├── referrals.py
│       │   ├── bonuses.py
│       │   ├── clinics.py
│       │   ├── admins.py
│       │   ├── support.py  # чат поддержки + файлы
│       │   ├── patient.py  # личный кабинет пациента
│       │   ├── integrations.py  # МИС вебхук
│       │   ├── monitoring.py
│       │   ├── tenant.py   # /tenant/current, /branding, /license
│       │   ├── modules.py  # /modules/features, /modules/plans
│       │   ├── plugins.py  # /plugins, /plugins/{name}/health
│       │   ├── geo.py      # /geo/cities, /geo/device
│       │   ├── system.py   # /version, heartbeat
│       │   └── contact.py  # контакт-форма → Telegram
│       └── services/       # activity, settings, mis_client, referral,
│                           # bonus, qr, auto_confirm
├── frontend/               # React 18 SPA (Vite + Tailwind + Zustand)
│   └── src/
│       ├── pages/          # Dashboard, CreateReferral, QRScreen, ScanScreen,
│       │                   # Bonuses, History, ManagerDashboard, ManagerAnalytics,
│       │                   # ManagerBonuses, ManagerHistory, ManagerKPI,
│       │                   # ManagerSettings, ManagerActivity, PartnerCreateReferral,
│       │                   # PatientCabinet, InviteRegister, Landing, Login
│       └── components/     # Layout, BottomNav, ReferralCard, SupportChat, ...
├── bot/                    # Telegram-бот (поддержка + уведомления)
└── docker-compose.yml
```

### Docker-контейнеры

| Контейнер | Image | Порт |
|-----------|-------|------|
| `clinika-backend` | FastAPI | 127.0.0.1:8900 |
| `clinika-frontend` | nginx + React | 127.0.0.1:8901 |
| `clinika-db` | postgres:16-alpine | внутренний |
| `clinika-redis` | redis:7-alpine | внутренний |
| `clinika-bot` | python | — |

---

## Быстрый старт

```bash
# 1. Клонировать
git clone https://github.com/mr-khamzat/clinika.git
cd clinika

# 2. Настроить переменные окружения
cp backend/.env.example backend/.env
# Заполнить: DATABASE_URL, SECRET_KEY, MIS_API_KEY, TELEGRAM_BOT_TOKEN и т.д.

# 3. Запустить
docker compose up -d

# Миграции применяются автоматически при старте (alembic upgrade head)
```

### Переменные окружения (backend/.env)

```env
DATABASE_URL=postgresql+asyncpg://clinika:pass@clinika-db:5432/clinika
REDIS_URL=redis://clinika-redis:6379
SECRET_KEY=your-secret-key
QR_SECRET=your-qr-secret

# Telegram Mini App
TELEGRAM_BOT_TOKEN=...
MINI_APP_URL=https://yourdomain.com/clinika

# МИС Renovatio
MIS_API_KEY=...
MIS_SSL_VERIFY=true
WEBHOOK_API_KEY=...

# SMS (опционально)
SMS_PROVIDER=stub  # stub | smsc | smsru

# Суперадмин (создаётся при первом запуске)
SUPERADMIN_USERNAME=admin
SUPERADMIN_PASSWORD=changeme
```

---

## Миграции

```bash
# Применить все миграции
docker exec clinika-backend alembic upgrade head

# Создать новую миграцию
docker exec clinika-backend alembic revision --autogenerate -m "описание"

# Текущая версия
docker exec clinika-backend alembic current
```

История миграций:
- `bdc4ea7233ff` — initial schema
- `3bb50c97a428` — etap1: multi-tenant (Tenant, License, Branding, tenant_id FK)
- `9bcb3fcce2e4` — etap4: geo (City, clinic geo fields)

---

## Роли

| Роль | Доступ |
|------|--------|
| `admin` | Создание направлений, QR-скан, просмотр своих бонусов, чат поддержки |
| `manager` | Полный доступ: отчёты, настройки, управление персоналом, МИС, мониторинг |
| `partner` | Создание направлений от имени партнёра |

---

## Этапы SaaS-трансформации

- [x] **0.5** Рефакторинг монолита → 11 модульных суброутеров
- [x] **1** Multi-tenant: Tenant / License / Branding + JWT `tid`
- [x] **2** Plugin system: MIS, SMS, Notify
- [x] **3** Modules + `has_feature()` по тарифным планам
- [x] **4** Geo: таблица городов, поля в клиниках, device detection
- [ ] **5** Расписание врачей + временные слоты + запись
- [ ] **6** Финансовый реестр (append-only операции)
- [ ] **7** Аналитика drill-down
- [ ] **8** Audit log
- [ ] **9** Billing (подписки, счета, платежи)
- [ ] **10** Monitoring dashboard с drill-down
- [ ] **11** Security: RBAC, refresh tokens, 152-ФЗ consent
