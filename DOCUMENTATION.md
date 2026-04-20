# Документация проекта КлиникСеть

## Обзор

КлиникСеть — мультитенантная SaaS-платформа для автоматизации медицинских сетей.

### Стек технологий

**Backend:**
- FastAPI 0.111 — асинхронный веб-фреймворк
- SQLAlchemy 2.0 — ORM с async поддержкой
- PostgreSQL 16 — основная база данных
- Redis 7 — кэш, rate limiting, метрики
- Alembic — миграции БД
- Pydantic 2.7 — валидация данных

**Frontend:**
- React 18 — UI библиотека
- Vite 5 — сборщик
- Tailwind CSS 3 — стилизация
- Zustand — state management
- React Router 6 — роутинг

**DevOps:**
- Docker & Docker Compose — контейнеризация
- Nginx — reverse proxy

## API Документация

Полная спецификация API доступна в формате OpenAPI 3.1:
- Файл: [`backend/openapi.json`](./backend/openapi.json)
- Количество endpoint'ов: **222**

### Основные разделы API

| Раздел | Префикс | Описание |
|--------|---------|----------|
| Аутентификация | `/auth` | Вход, refresh tokens, сессии |
| Направления | `/referrals` | Создание и управление направлениями |
| Бонусы | `/bonuses` | Бонусная система |
| Клиники | `/clinics` | Управление клиниками |
| Врачи/Расписание | `/doctors`, `/scheduling` | Расписание врачей, записи |
| Аналитика | `/analytics` | Отчёты, воронки, динамика |
| Финансы | `/ledger`, `/billing` | Реестры, подписки, счета |
| Реклама | `/ads` | Управление объявлениями |
| Платформа | `/admin` | SuperAdmin: тенанты, метрики |
| Интеграции | `/mis`, `/webhooks` | МИС, webhook'и |

## Структура проекта

```
/workspace
├── backend/
│   ├── app/
│   │   ├── core/           # Безопасность, зависимости, tenant context
│   │   ├── models/         # SQLAlchemy модели (22+ файла)
│   │   ├── routers/        # FastAPI endpoints (30+ файлов)
│   │   ├── services/       # Бизнес-логика
│   │   ├── schemas/        # Pydantic схемы
│   │   ├── utils/          # Утилиты (geo, device, metrics)
│   │   ├── plugins/        # Система плагинов (MIS, SMS, Notify)
│   │   └── modules/        # Feature flags
│   ├── alembic/            # Миграции БД
│   └── requirements.txt    # Python зависимости
├── frontend/
│   ├── src/
│   │   ├── pages/          # Страницы приложения
│   │   ├── sections/       # Крупные компоненты
│   │   ├── components/     # Переиспользуемые компоненты
│   │   └── lib/            # Утилиты, SDK
│   └── package.json        # Node.js зависимости
├── bot/                    # Telegram бот
└── docker-compose.yml      # Оркестрация сервисов
```

## Модели данных

### Ключевые сущности

| Модель | Таблица | Описание |
|--------|---------|----------|
| `Tenant` | `tenants` | Организации (мультитенантность) |
| `User` | `users` | Пользователи всех ролей |
| `Clinic` | `clinics` | Медицинские учреждения |
| `Referral` | `referrals` | Направления пациентов |
| `Bonus` | `bonuses` | Бонусные начисления |
| `Doctor` | `doctors` | Врачи и расписание |
| `Appointment` | `appointments` | Записи к врачам |
| `LedgerEntry` | `ledger_entries` | Финансовый реестр (append-only) |
| `AuditEntry` | `audit_entries` | Журнал аудита |

### Роли пользователей

- `super_admin` — управление всей платформой
- `admin` — администратор тенанта
- `manager` — руководитель клиники
- `doctor` — врач
- `nurse` — медсестра
- `recruiter` — рекрутер
- `partner` — партнёр (Telegram Mini App)

## Развёртывание

### Требования

- Docker 24+
- Docker Compose 2.20+
- 2 GB RAM minimum
- PostgreSQL 16
- Redis 7

### Быстрый старт

```bash
# Клонирование репозитория
git clone <repository-url>
cd clinika

# Настройка переменных окружения
cp backend/.env.example backend/.env
# Отредактируйте backend/.env

# Запуск всех сервисов
docker-compose up -d

# Проверка статуса
docker-compose ps

# Логи
docker-compose logs -f backend
```

### Переменные окружения

**Обязательные:**
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `SECRET_KEY` — JWT signing key (минимум 32 символа)
- `QR_SECRET` — QR code generation secret

**Опциональные:**
- `TELEGRAM_BOT_TOKEN` — токен Telegram бота
- `ALLOWED_ORIGINS` — CORS origins (через запятую)
- `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` — учётные данные суперадмина

## Мониторинг

### Health Checks

- `GET /health` — базовая проверка доступности
- `GET /monitoring/health` — расширенная проверка (БД, Redis)
- `GET /monitoring/metrics` — метрики производительности (p50/p95/p99)
- `GET /monitoring/pool` — статус connection pool

### Метрики

- Request latency (p50, p95, p99)
- Error rate по endpoint'ам
- Top endpoints по количеству запросов
- SQLAlchemy pool utilization
- PostgreSQL active connections

## Безопасность

### Реализованные механизмы

1. **JWT Authentication** — access + refresh tokens
2. **RBAC** — матрица ролей и разрешений
3. **Rate Limiting** — защита от brute force (Redis)
4. **CORS** — настройка разрешённых origin
5. **Security Headers** — X-Content-Type-Options, X-Frame-Options и др.
6. **152-ФЗ** — согласия на обработку персональных данных
7. **Password Hashing** — bcrypt
8. **Refresh Token Rotation** — отзыв сессий

## Тестирование

### Backend

```bash
cd backend
pip install -r requirements.txt
pytest  # TODO: добавить тесты
```

### Frontend

```bash
cd frontend
npm install
npm run dev  # Development server
npm run build  # Production build
```

## Лицензия

Проприетарное ПО. Все права защищены.
