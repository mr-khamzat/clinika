# КлиникаСеть — Платформа направлений и бонусов

FastAPI + React + PostgreSQL + Redis. Docker Compose.

## Стек

| Слой | Технология |
|------|-----------|
| Backend | FastAPI, SQLAlchemy 2.0 async (asyncpg), Alembic |
| Frontend | React 18, Vite, Tailwind CSS, Zustand |
| БД | PostgreSQL 16, Redis 7 |
| Деплой | Docker Compose, nginx reverse proxy |

## Архитектура (SaaS)

```
clinika/
├── backend/
│   └── app/
│       ├── core/          # deps, security, tenant зависимости
│       ├── models/        # SQLAlchemy модели (tenant, city, clinic, ...)
│       ├── modules/       # has_feature() + каталог фич по планам
│       ├── plugins/       # MIS, SMS, Notify плагины
│       ├── routers/
│       │   ├── manager/   # 11 суброутеров (reports, staff, kpi, ...)
│       │   ├── tenant.py  # /tenant/*
│       │   ├── modules.py # /modules/features
│       │   ├── plugins.py # /plugins/*
│       │   └── geo.py     # /geo/cities, /geo/device
│       └── services/      # activity, settings, mis_client, ...
├── frontend/              # React SPA
├── bot/                   # Telegram бот
└── docker-compose.yml
```

## Функциональность

### Ядро
- Направления пациентов (QR + HMAC подпись)
- Бонусная система (pending/paid, CSV экспорт)
- Управление клиниками и сотрудниками
- Инвайт-ссылки для партнёров
- Поддержка (чат в Telegram боте)

### SaaS слой (реализовано)
- **Multi-tenant**: Tenant / TenantLicense / TenantBranding
- **Планы**: basic / professional / enterprise
- **Модули**: `has_feature(license, "analytics")` — фичи по плану
- **Плагины**: MIS Renovatio, SMS, Telegram-уведомления
- **Geo**: таблица городов, поля city/lat/lng в клиниках, device detection
- **JWT**: содержит `tid` (tenant_id)

### API
- `GET /tenant/current` — текущий тенант
- `GET /tenant/branding` — брендинг (цвета, шрифт, логотип)
- `GET /tenant/license` — план и лимиты
- `GET /modules/features` — список фич с enabled-флагами для UI
- `GET /plugins` — статус плагинов
- `GET /plugins/{name}/health` — health-check плагина
- `GET /geo/cities` — список городов
- `GET /geo/device` — тип устройства клиента

## Запуск

```bash
cp backend/.env.example backend/.env
# Заполнить DATABASE_URL, SECRET_KEY, MIS_API_KEY и т.д.

docker compose up -d
```

Миграции применяются автоматически при старте контейнера (`alembic upgrade head`).

## Планы

| Фича | basic | professional | enterprise |
|------|-------|-------------|-----------|
| Направления, бонусы, клиники, QR | ✅ | ✅ | ✅ |
| Аналитика, KPI, инвайты, скидки | — | ✅ | ✅ |
| МИС синхронизация, SMS | — | ✅ | ✅ |
| Расписание врачей, биллинг, аудит | — | — | ✅ |

## Этапы SaaS-трансформации

- [x] 0.5 Рефакторинг монолита → модули
- [x] 1 Multi-tenant (Tenant + License + Branding)
- [x] 2 Plugin system (MIS, SMS, Notify)
- [x] 3 Modules + has_feature()
- [x] 4 Geo + device detection
- [ ] 5 Расписание врачей + слоты
- [ ] 6 Финансовый реестр (append-only)
- [ ] 7 Аналитика drill-down
- [ ] 8 Audit log
- [ ] 9 Billing
- [ ] 10 Monitoring dashboard
- [ ] 11 Security (RBAC, refresh tokens, 152-ФЗ)
