# Sentry — настройка

Sentry собирает ошибки backend (FastAPI) и frontend (React+Vite). SDK уже встроены в код:

- `backend/app/main.py` — `sentry_sdk.init(...)` при наличии `SENTRY_DSN`
- `frontend/src/main.jsx` — `Sentry.init(...)` при наличии `VITE_SENTRY_DSN`

Без DSN оба клиента молчат — приложение работает как раньше.

## Шаг 1: Создать аккаунт

1. Открой <https://sentry.io/signup/>
2. Email: **mrevil9995@gmail.com**
3. Создай Organization `клиниксеть` (или `clinikaset`, если не пускает кириллицу)
4. Создай **2 проекта**:
   - `clinika-backend` — Platform: **Python → FastAPI**
   - `clinika-frontend` — Platform: **JavaScript → React**

## Шаг 2: Получить DSN

Settings → Projects → выбрать проект → **SDK Setup → Client Keys (DSN)** → копировать DSN.

Формат:

```
https://<public_key>@o<org_id>.ingest.sentry.io/<project_id>
```

Пример:

```
https://abc123def456@o4505123456789012.ingest.sentry.io/4505987654321098
```

## Шаг 3: Заполнить /opt/clinika/.env на сервере

```bash
ssh root@212.57.118.126
cd /opt/clinika
nano .env
```

Найти/добавить блок Sentry:

```
# Backend Sentry
SENTRY_DSN=https://...@o....ingest.sentry.io/...
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1

# Frontend Sentry (компилируется в бандл при сборке Vite)
VITE_SENTRY_DSN=https://...@o....ingest.sentry.io/...
VITE_SENTRY_ENVIRONMENT=production
```

> Backend и frontend — это **разные проекты** в Sentry, у каждого свой DSN. Не путай.

## Шаг 4: Перезапуск

```bash
cd /opt/clinika

# Backend читает SENTRY_DSN из env при старте — достаточно рестарта:
docker compose up -d clinika-backend

# Frontend компилирует VITE_SENTRY_DSN в бандл — нужна пересборка:
docker compose build --no-cache clinika-frontend
docker compose up -d clinika-frontend
```

## Шаг 5: Тест

### Backend

Триггернуть ошибку — например, обратиться к несуществующему ресурсу так, чтобы FastAPI выкинул необработанный exception. Если в backend есть отладочный endpoint — использовать его, иначе зайти в panel и сделать действие, которое заведомо упадёт (после деплоя, чтобы не ломать прод).

Проверка: в `Sentry → Issues` появится событие в течение 1 минуты с тегом `environment=production`.

Логи backend:

```bash
docker logs clinika-backend 2>&1 | grep -i sentry
```

### Frontend

В консоли браузера (на <https://клиниксеть.рф>) выполнить:

```js
throw new Error('test sentry frontend');
```

В Sentry должно появиться событие в проекте `clinika-frontend`.

## Алерты

После того как ошибки начнут поступать:

1. **Settings → Alerts → Create Alert Rule**
2. Условие: `Number of events in an issue is more than 5 in 1 hour`
3. Действие: **Send a notification to Email** → mrevil9995@gmail.com
4. (Опц.) Slack/Telegram интеграция через `Settings → Integrations`.

## Полезные настройки в Sentry

- **Settings → Projects → clinika-backend → Inbound Filters**: включить «Filter out events from health checks» (UA `kube-probe`, `Uptime-Kuma/`).
- **Performance → Trace Sample Rate**: 0.1 (10%) — баланс шум/полезность. Можно поднять при отладке.
- **Releases**: связать с git — `sentry-cli releases new <commit_sha>` в CI/деплой-скрипте, тогда стектрейсы будут с подсветкой изменённых строк.

## Связанное

- `MONITORING.md` — общая архитектура мониторинга
- `.env.example` — все Sentry-переменные с описанием
