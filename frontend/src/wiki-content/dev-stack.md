# Технический стек платформы

Полное описание архитектуры КлиникСеть — для разработчиков, DevOps и интеграторов.

## Серверы

| Компонент | Сервер | Назначение |
|---|---|---|
| Production | `212.57.118.126` | Backend, frontend, DB, бот, мониторинг |
| Mirror Calls | `144.31.89.167` | Зеркало `KliniknetCalls-Setup-*.exe` (быстрая раздача с РФ) |
| coturn | На Production | TURN/STUN для WebRTC, порт 3478 |

ОС — Ubuntu 24.04 LTS. Домен — `клиниксеть.рф` (Cyrillic), nginx terminating TLS.

## Backend

- **FastAPI** + **Uvicorn** + **SQLAlchemy 2.0** (async ORM) + **Alembic** (миграции).
- **PostgreSQL 16** — основное хранилище, в Docker volume.
- **Redis 7** — кэш, очереди, presence, JWT blacklist.
- **APScheduler** — внутренние jobs (биллинг, авто-подтверждение направлений, sms_campaign_dispatch).
- **GeoLite2-City.mmdb** — гео-IP (Region Lock, audit log).

Все секреты в `/opt/clinika/.env`. Не в коде. Не в git.

## Frontend

- **Vite** + **React 18** + **react-router-dom**.
- **Tailwind CSS** + **PostCSS** (`font-display: swap`).
- **Zustand** — глобальный state (auth, theme, modules).
- **Axios** + custom interceptor (`/api/index.js`) — auto-refresh JWT.
- **Sentry** (опционально, через `VITE_SENTRY_DSN`).
- **Material Symbols** — иконки.

Лениво грузятся: `Wiki`, секции AdminLayout, `PatientTelemedRoom`. Vendor чанки — `vendor-react`, `vendor-heavy` (jspdf/qr), `vendor-state`, `vendor-markdown`, `vendor-other`.

## Calls (десктоп)

- **Electron** — оболочка.
- **WebRTC** + ваш coturn для P2P звонков.
- **WhatsApp Web** в боковой панели (BrowserView, partition `persist:whatsapp`).
- **AWG VPN** — встроен в 1.0.22+, обход блокировок Чечни/Ингушетии.
- **electron-builder** — NSIS installer (Windows). Сборка через wine 9 + winehq на Linux.

Текущая версия: см. `/api/health/full → calls_version` или `frontend/public/downloads/latest.yml`.

## Платежи (заглушки)

Адаптеры в `backend/app/services/acquiring/`: Сбер, ЮKassa, T-Bank, CloudPayments, Robokassa. Большая часть методов — `NotImplementedError` до подключения реального магазина.

## 54-ФЗ (фискальные чеки)

Каркас в `payments_clinic.FiscalReceipt` + `OFDConfig`. Адаптеры провайдеров (Атол, Эвотор, Платформа ОФД) пока stub. Подключение — после открытия онлайн-кассы клиента.

## Docker stack

`docker-compose.yml`: 6 сервисов (`clinika-db`, `redis`, `docker-proxy`, `backend`, `frontend`, `bot`). Дополнительно — Grafana, Prometheus, postgres-exporter, Uptime-Kuma (через `docker-compose.monitoring.yml`).

Логи: `json-file driver, max-size 20m, max-file 5` (после 2026-05-08).

## Бэкапы

- `/opt/clinika/backup.sh` — pg_dump ежедневно в 03:00, складывает в `/opt/clinika/backups/daily/`. Сохраняется 14 дней.
- `clinika-cleanup.sh` — еженедельно (вск 04:00) чистит старые бэкапы > 30 дней, docker build cache > 7 дней.
- Uploads `/opt/clinika/uploads/` — пока не бэкапятся. **TODO**: добавить.

## CI/CD

- GitHub: `https://github.com/mr-khamzat/clinika`
- GitHub Actions: pytest (59 тестов), lint, build (см. `.github/workflows/`)
- Деплой — пока ручной: SSH → `git pull` → `docker compose build && up -d`
- TODO: webhook автодеплоя

## Наблюдаемость

- `/api/health` — лёгкий ping
- `/api/health/full` — БД, Redis, disk, scheduler, версии
- Sentry — клиентский (frontend) и серверный (backend), включается по `SENTRY_DSN` в .env
- Uptime-Kuma — `/uptime/`
- Grafana — `/grafana/` (dashboards в `monitoring/grafana/`)

## Смотрите также

- [Dev · API endpoints](dev-api.md)
- [Dev · Интеграции](dev-integrations.md)
