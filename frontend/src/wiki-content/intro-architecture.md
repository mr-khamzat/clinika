# Архитектура платформы

## Обзор

КлиникСеть построена как многотенантное SaaS-приложение со строгой изоляцией данных. Архитектура старается быть «boring» по умолчанию — никаких микросервисов ради микросервисов, никаких Kafka-кластеров «на вырост». В то же время критичные части (медиа, очереди, AI) вынесены в отдельные процессы, чтобы не блокировать основной API.

Схема верхнего уровня:

```
Internet
   │
   ▼
nginx (TLS, sub.клиниксеть.рф)
   │
   ├──▶ Frontend (Vite + React, статика)
   │
   └──▶ Backend (FastAPI :8900)
            │
            ├─▶ PostgreSQL 16 (data + RBAC tenant filter)
            ├─▶ Redis 7 (cache, pub/sub, presence)
            ├─▶ APScheduler (cron jobs)
            ├─▶ coturn (TURN/STUN для WebRTC)
            └─▶ Внешние API (ЮKassa, ОФД, AI, лаборатории)
```

## Слои приложения

### 1. Edge (nginx)

Единая точка входа, TLS-терминация, маршрутизация на frontend и backend. Дополнительно:

- gzip и brotli статики
- проксирование WebSocket (`/presence/ws`, `/calls/ws`)
- rate-limit на `/auth/*` (5 req/s) и `/public/*` (10 req/s)
- security headers (HSTS, X-Frame-Options, CSP)

### 2. Frontend

Однопользовательское SPA на React 18 + Vite + TailwindCSS. Маршрутизация через React Router 6. Стейт — Zustand + React Query. Дизайн-система собственная (`/src/design/`), без UI-кит библиотек, чтобы держать bundle ниже 300 KB gzip.

Сборка кладётся в `/opt/clinika/frontend/dist`, отдаётся nginx как статика. После любых изменений `.jsx` — обязательная пересборка контейнера `clinika-frontend`.

### 3. Backend

FastAPI + SQLAlchemy 2.0 (async) + Pydantic v2. Роутеры группированы по доменам (`app/routers/`), модели — по таблицам (`app/models/`), сервисы — по сценариям (`app/services/`). Фоновые задачи — APScheduler с триггерами `cron` и `interval`.

Ключевые принципы:

- Каждая модель с tenant-данными имеет колонку `tenant_id` и фильтр в зависимости `get_db_for_tenant`.
- JWT с PBKDF2-хешем пароля и ротацией refresh-токена.
- Pydantic-схемы изолированы от ORM-моделей — никакой утечки приватных полей.
- Аудит-лог пишется через декоратор `@audited("entity", "action")` поверх роутера.

### 4. PostgreSQL

Одна база `clinika`, все тенанты в одной БД с фильтрацией по `tenant_id` (shared schema, shared database). Преимущества:

- Простые миграции через Alembic
- Сводные запросы для super_admin без cross-DB joins
- Дешёвые бэкапы (pg_dump + GPG + rclone)

Минусы и митигейшен:

- Утечка tenant-данных при ошибке фильтра → миграционные индексы вида `(tenant_id, *)`, тесты доступа на каждый эндпоинт, pre-commit линтер на запросы без `tenant_id`.

### 5. Redis

Используется как:

- Cache (60-3600 сек TTL для отчётов и справочников)
- Pub/Sub для realtime событий (presence, calls)
- Rate-limit через `aioredis-rl`
- Очередь email/SMS через RQ

### 6. WebRTC стек

coturn слушает 3478 (TURN/STUN) + 5349 (TLS). ICE-конфиг отдаётся через `/presence/ice-config` с HMAC-SHA1 REST-аутентификацией (как описано в RFC 5766). Сигналинг — WebSocket `/presence/ws`. Модуль `telemedicine` использует тот же стек, плюс `call_recording` пишет медиа в S3-совместимый сторадж.

### 7. AI инфраструктура

- **AI-модель** — основной LLM для чата, summarisation, экстракции.
- **AI-транскрипция** — транскрипция аудио (модуль `call_recording`).
- **Embeddings** — пока не используется, но скаффолд в `app/services/embeddings.py`.

Запросы к AI прокси-роутятся через `app/services/llm_router.py`, который умеет fallback и кэширование одинаковых промптов.

## Изоляция тенантов

```python
# Псевдокод фильтра
async def get_db_for_tenant(user: User, db: AsyncSession):
    if user.role == "super_admin":
        return db   # видит всё
    # Все запросы автоматически дополняются tenant_id=user.tenant_id
    db.tenant_id = user.tenant_id
    return db
```

Дополнительно работает middleware `TenantSlugMiddleware`, которое сопоставляет поддомен (или префикс `/{slug}/`) с tenant_id и не даёт смешивать данные.

## Стек технологий — полный список

### Backend
- Python 3.12
- FastAPI 0.115
- SQLAlchemy 2.0 (async, asyncpg)
- Pydantic 2.x
- Alembic для миграций
- APScheduler 3.x для cron
- httpx для исходящих HTTP
- structlog для логирования
- pytest + pytest-asyncio

### Frontend
- React 18
- Vite 5
- TailwindCSS 3
- React Router 6
- Zustand + React Query
- recharts для графиков
- lucide-react для иконок

### Инфраструктура
- Docker Compose
- PostgreSQL 16
- Redis 7
- nginx 1.24
- coturn 4.6
- Telegraf + Grafana (мониторинг)

### Хранилище и бэкап
- pg_dump каждые 6 часов
- GPG-шифрование (асимметричный ключ)
- rclone → удалённое S3-совместимое хранилище
- 30 дней rolling retention

## Производительность

Целевые SLI на Professional-плане:

- P50 latency API ≤ 120 мс
- P99 latency API ≤ 800 мс
- Uptime API ≥ 99.5%
- Cold start frontend (pristine cache) ≤ 1.8 с до интерактива на 4G

Метрики собираются через `/metrics` (Prometheus-совместимый эндпоинт) и визуализируются в Grafana.

## Развёртывание

Один сервер 212.57.118.126 (Ubuntu 24.04, 8 vCPU / 16 GB RAM / 200 GB NVMe). Все сервисы в одной docker-compose:

| Сервис | Контейнер | Порт |
|---|---|---|
| Backend | clinika-backend | 8900 |
| Frontend | clinika-frontend | 8901 |
| PostgreSQL | clinika-db | 5432 |
| Redis | clinika-redis | 6379 |
| coturn | clinika-coturn | 3478 |
| nginx | clinika-nginx | 80/443 |

Развёртывание: `git pull && docker compose up -d --build`. Для миграций: `docker exec clinika-backend alembic upgrade head`.

## Связанные статьи

- [Технический стек](/wiki/dev-stack)
- [Multi-tenancy](/wiki/concepts-multi-tenancy)
- [Безопасность и 152-ФЗ](/wiki/concepts-security)
- [Мониторинг и алерты](/wiki/concepts-monitoring)
