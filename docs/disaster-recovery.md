# Disaster Recovery — КлиникСеть

Документ описывает действия в случае краха основного backend / БД и
восстановление сервиса из бэкапов.

## 1. Disaster mode (мягкий режим работы)

Если backend ещё запущен, но один из критичных сервисов упал
(БД / Redis / диск > 95% / etc), система переключается в **disaster mode**:

* все mutation-запросы (POST / PUT / PATCH / DELETE) возвращают `503` с
  Retry-After: 300 и понятным сообщением «Сервис на технических работах»;
* GET-запросы продолжают работать (read-only режим);
* whitelisted остаются `/health*`, `/docs`, `/redoc`, `/admin/system/*`.

### Ручное управление (только super_admin)

```
POST /admin/system/enable-disaster-mode  {"reason": "плановый maintenance"}
POST /admin/system/disable-disaster-mode
GET  /admin/system/status
GET  /health/detailed
```

### Автоматический контроль

Каждые 5 минут scheduler-задача `disaster_health_check` проверяет:

* PostgreSQL доступен (`SELECT 1`);
* `df /` < 98%.

При сбое — флаг создаётся автоматически с reason `auto: ...`. Когда
сервис восстанавливается, тот же job снимает флаг (только если он был
выставлен автоматически).

Файл-флаг: `/opt/clinika/backend/data/disaster_mode.flag`
(внутри контейнера: `/app/data/disaster_mode.flag`).

## 2. Полное восстановление из PG_DUMP

В случае полной потери БД:

```bash
cd /opt/clinika
# 1. Остановить backend (БД должна быть «чистой» для восстановления)
docker compose stop clinika-backend

# 2. Подключиться к контейнеру БД
docker compose exec -T clinika-db psql -U clinika -d postgres \
    -c "DROP DATABASE IF EXISTS clinika;" \
    -c "CREATE DATABASE clinika OWNER clinika;"

# 3. Восстановить дамп (см. /opt/clinika/scripts/test-restore.sh для
# проверочного восстановления)
gunzip -c /opt/clinika/backups/daily/clinika-db-YYYYMMDD-HHMM.sql.gz \
    | docker compose exec -T clinika-db psql -U clinika -d clinika

# 4. Если бэкапы зашифрованы GPG — расшифровка перед загрузкой:
gpg --decrypt < /opt/clinika/backups/daily/clinika-db-YYYYMMDD-HHMM.sql.gz.gpg \
    | gunzip - \
    | docker compose exec -T clinika-db psql -U clinika -d clinika

# 5. Запустить backend
docker compose start clinika-backend

# 6. Проверить миграцию
docker compose exec -T clinika-backend alembic current
```

## 3. Восстановление uploads/

```bash
cd /opt/clinika
tar -xzf /opt/clinika/backups/files/uploads-YYYYMMDD-HHMM.tar.gz \
    -C /opt/clinika/  # развернёт uploads/ внутри /opt/clinika
docker compose restart clinika-backend
```

## 4. Проверочный скрипт

`scripts/test-restore.sh` — выполняет dry-run восстановление в отдельную
БД и валидирует целостность. Запускается раз в неделю по cron.

## 5. Endpoints для мониторинга

* `/health` — простой liveness (200/5xx)
* `/health/full` — расширенный (DB / Redis / диск / scheduler) — для Uptime-Kuma
* `/health/detailed` — Глава 10: + last_migration / active_subscriptions /
  recent_errors_1h / disaster_mode
* `/admin/system/status` — для super_admin UI
