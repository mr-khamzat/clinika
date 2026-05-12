# Деплой и DevOps

Развёртывание КлиникСеть на одном сервере с использованием Docker Compose. Без Kubernetes, без облачных оркестраторов — минимальные операционные издержки.

## Серверы

| Хост | Назначение |
|---|---|
| `212.57.118.126` | Production: backend, frontend, DB, бот, мониторинг |
| `144.31.89.167` | Mirror: зеркало `KliniknetCalls-Setup-*.exe` (быстрая раздача с РФ) |

ОС: Ubuntu 24.04 LTS. Домен `клиниксеть.рф` (Cyrillic). nginx терминирует TLS на хосте.

## Docker Compose

`docker-compose.yml` — 6 сервисов:
- `clinika-db` (postgres:16-alpine) — healthcheck pg_isready.
- `clinika-redis` (redis:7-alpine) — healthcheck redis-cli ping.
- `clinika-docker-proxy` — sidecar для read-only доступа к Docker API (без монтирования socket в backend).
- `clinika-backend` — FastAPI на uvicorn, port 8900 → внутри 8000.
- `clinika-frontend` — собранный SPA в nginx-контейнере, port 8901.
- `clinika-bot` — Telegram-бот для нотификаций.

Дополнительно (`docker-compose.monitoring.yml`):
- Grafana, Prometheus, postgres-exporter, Uptime-Kuma.

Сеть `clinika-net` — internal. Только nginx host'а пробрасывает порты наружу.

## Логирование

```yaml
x-logging: &default-logging
  driver: "json-file"
  options:
    max-size: "20m"
    max-file: "5"
```

100MB max на контейнер. После 2026-05-08 — общая ротация для всех сервисов.

## Healthcheck

Каждый сервис имеет healthcheck:
- `clinika-db`: `pg_isready -U clinika`.
- `clinika-redis`: `redis-cli ping`.
- `clinika-backend`: `curl -fsS http://localhost:8000/health`.
- `clinika-frontend`: `wget -qO- http://localhost:80/`.

Backend ждёт DB healthy перед стартом (`depends_on: condition: service_healthy`).

## Деплой (rolling)

```bash
# На production сервере
cd /opt/clinika
git pull origin main
docker compose build clinika-backend
docker compose up -d clinika-backend
# Frontend отдельно (build занимает 1-2 мин)
docker compose build clinika-frontend
docker compose up -d clinika-frontend
```

При изменении `.jsx/.js/.md`:
```bash
docker compose build --no-cache clinika-frontend
docker compose up -d clinika-frontend
```

Backend перезапускается за 5-10 сек, краткий 502 на nginx. Frontend — без даунтайма (новый контейнер сначала healthy, потом swap).

## Миграции

```bash
docker exec clinika-backend alembic -c /app/alembic.ini upgrade head
```

Запускаются вручную после `git pull`, перед перезапуском backend. На startup backend НЕ запускает миграции автоматически (защита от race condition на multi-instance).

## Бэкапы

### Ежедневный pg_dump

`/opt/clinika/backup.sh`:
```bash
#!/bin/bash
DATE=$(date +%F-%H%M)
docker exec clinika-db pg_dump -U clinika clinika | gzip > /opt/clinika/backups/daily/clinika-$DATE.sql.gz
find /opt/clinika/backups/daily/ -name "clinika-*.sql.gz" -mtime +14 -delete
```

Cron: `0 3 * * * /opt/clinika/backup.sh`. Хранение 14 дней.

### Rclone в облако (планируется)

```bash
rclone copy /opt/clinika/backups/daily/ remote:clinika-backups/daily/
```

С GPG-шифрованием: `gpg --encrypt --recipient backup@clinika ...` перед заливом.

### Cleanup

`/opt/clinika/clinika-cleanup.sh` — еженедельно (вск 04:00):
- Старые бэкапы > 30 дней.
- Docker build cache > 7 дней.
- Docker dangling images.
- Containerd snapshots с `--keep-storage=2GB` (Docker 29 нужен этот флаг — `--filter until=24h` не работает).

## Restore

```bash
gunzip -c /opt/clinika/backups/daily/clinika-2026-05-11-0300.sql.gz | \
  docker exec -i clinika-db psql -U clinika clinika
docker compose restart clinika-backend
```

Сценарий тестировался ~ раз в месяц на dev-окружении.

## SSL / TLS

nginx на хосте + acme.sh (для основного домена) или Certbot. Renewal через cron, автоматически.

Кастомные домены тенантов (white-label) — TODO автоматизация. Сейчас вручную: nginx config + acme.sh DNS-01.

## Мониторинг

- `/health` — лёгкий ping (200 OK быстро).
- `/health/full` — DB, Redis, disk, scheduler, версии.
- Sentry — frontend (через `VITE_SENTRY_DSN`) и backend (через `SENTRY_DSN` в .env).
- Grafana — `/grafana/`, dashboard'ы в `monitoring/grafana/`.
- Uptime-Kuma — `/uptime/`, внешние пинги.
- Telegram-бот — daily digest в 09:00 МСК.

## CI/CD (текущее)

- GitHub: `https://github.com/mr-khamzat/clinika`.
- GitHub Actions: pytest (98+ тестов), lint, build (см. `.github/workflows/`).
- Деплой — ручной: SSH + `git pull` + `docker compose build && up -d`.
- TODO: webhook автодеплоя при push в main.

## Безопасность операций

- `.env` — не в git (в `.gitignore`).
- БД доступна только из `clinika-net` (не наружу).
- SSH — только по ключам (пароли отключены).
- fail2ban на хосте для SSH.
- Регулярные `apt upgrade` (1 раз в неделю).

## Disaster recovery

1. Полная потеря сервера → восстановление за 2-4 часа:
2. Подъём нового хоста с Ubuntu 24.04.
3. `git clone https://github.com/mr-khamzat/clinika /opt/clinika`.
4. Скопировать `.env` из бэкапа.
5. `docker compose up -d clinika-db clinika-redis`.
6. Restore из последнего pg_dump.
7. `docker compose build && up -d` остальных сервисов.
8. DNS-переключение на новый IP.

## Смотрите также

- [Dev · Архитектура](dev-architecture.md)
- [Концепт · Резервное копирование](concepts-backup.md)
- [Концепт · Мониторинг и алерты](concepts-monitoring.md)
