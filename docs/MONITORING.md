# Мониторинг КлиникСеть

Этап 12 ROADMAP (DevOps хвост): uptime-kuma + опционально Grafana/Prometheus + Sentry.

## Архитектура

```
                         ┌─────────────────────────────┐
                         │  Telegram (@clinika_alerts) │
                         └──────────────▲──────────────┘
                                        │ alerts
┌──────────────────┐    HTTPS pings     │
│ Uptime-Kuma      │────────────────────┘
│ :3001 (localhost)│ probes:
└────────▲─────────┘  • https://клиниксеть.рф/
         │            • /health
         │            • /downloads/latest.yml
         │            • postgres TCP :5432
         │            • redis TCP :6379
         │
         └─ доступ через VPN или nginx /uptime/

┌──────────────────┐   scrape       ┌────────────┐   query     ┌─────────┐
│ postgres-exporter│ ──────────────▶│ Prometheus │ ◀──────────▶│ Grafana │
│ (опционально)    │    :9090       │   :9090    │             │  :3002  │
└──────────────────┘                └────────────┘             └─────────┘
```

## 1. Uptime-Kuma

### Запуск (уже выполнен)

```bash
docker run -d --name uptime-kuma --restart=unless-stopped \
  -p 127.0.0.1:3001:3001 \
  -v uptime-kuma:/app/data \
  louislam/uptime-kuma:1
```

### Доступ

**Основной способ — SSH-туннель** (uptime-kuma 1.x не поддерживает работу из-под sub-path надёжно — редиректит на `/dashboard`):

```bash
ssh -L 3001:127.0.0.1:3001 root@212.57.118.126
# Открыть в браузере: http://localhost:3001
```

**Альтернатива через nginx** (на свой страх и риск, может ломать редиректы):

В nginx уже добавлен `location ^~ /uptime/` → `http://127.0.0.1:3001/`.
URL: <https://клиниксеть.рф/uptime/> — но редирект `/dashboard` ломается (uptime-kuma шлёт абсолютные пути).

Если хочешь публичный доступ по домену — лучший вариант:

1. Создать поддомен `status.клиниксеть.рф` (CNAME → основной домен).
2. Добавить отдельный `server { server_name status...; location / { proxy_pass http://127.0.0.1:3001/; } }`.
3. Получить SSL: `certbot --nginx -d status.клиниксеть.рф`.

> **Первый вход**: открой URL (через туннель или поддомен), создашь логин/пароль администратора.
> Запомни их или сохрани в KeePass/1Password.

### Какие проверки добавить

После входа — **Add New Monitor** для каждого пункта:

| Имя | Тип | URL/Хост | Интервал |
|-----|-----|----------|----------|
| Главная HTTPS | HTTP(s) | `https://клиниксеть.рф/` | 60 сек |
| Backend health | HTTP(s) | `https://клиниксеть.рф/api/health` | 60 сек |
| Auto-update YAML | HTTP(s) — Keyword | `https://клиниксеть.рф/downloads/latest.yml`, keyword `version` | 5 мин |
| PostgreSQL | TCP Port | `clinika-db` (через docker network) или `127.0.0.1:5432` (если открыт) | 60 сек |
| Redis | TCP Port | то же | 60 сек |
| Coturn TURN | TCP Port | `127.0.0.1:3478` | 5 мин |
| SSL cert expiry | HTTP(s) с галкой "Certificate Expiry" | `https://клиниксеть.рф/` | 24 часа |

### Telegram-алерты (после первого входа)

1. Создай бота через `@BotFather`:
   - `/newbot` → имя `clinika_alerts_bot` → получишь `TG_BOT_TOKEN` (например `7123456789:AAH...`).
2. Узнай `chat_id`:
   - Напиши боту `/start`.
   - Открой `https://api.telegram.org/bot<TOKEN>/getUpdates` — найди `chat.id`.
   - Или используй `@userinfobot` (для личных уведомлений админа `293633093`).
3. В Uptime-Kuma:
   - **Settings → Notifications → Setup Notification**
   - Notification Type: **Telegram**
   - Bot Token: `<TG_BOT_TOKEN>`
   - Chat ID: `<TG_CHAT_ID>` (например `293633093`)
   - Test → должен прийти тестовый месседж.
4. Включи нотификацию **Default for all monitors**.

> **Не хардкодь токен** в этот репозиторий. Он живёт только в БД uptime-kuma (volume `uptime-kuma`).

## 2. Prometheus + Grafana (опционально)

Полностью отдельный compose-стек, не трогает боевые контейнеры.

### Запуск

```bash
cd /opt/clinika
# Создаём конфиг prometheus один раз:
mkdir -p monitoring
cp docs/prometheus.yml.example monitoring/prometheus.yml   # уже лежит в репо

# Поднимаем стек с профилем 'metrics':
docker compose -f docker-compose.monitoring.yml --profile metrics up -d
```

После этого:

| Сервис | Порт (localhost) | Что |
|--------|------------------|-----|
| prometheus | `127.0.0.1:9090` | scrape & TSDB |
| postgres-exporter | внутри сети | метрики БД |
| grafana | `127.0.0.1:3002` | дашборды |

### Доступ к Grafana

Опционально проброс через nginx (см. секцию ниже) или SSH-туннель:

```bash
ssh -L 3002:127.0.0.1:3002 root@212.57.118.126
# Открыть http://localhost:3002
```

Логин: `admin` / `admin` (смени при первом входе через переменную `GRAFANA_ADMIN_PASSWORD` в `.env`).

### Готовые дашборды в репо

В `/opt/clinika/monitoring/grafana-dashboards/` лежат JSON для импорта:

| Файл | Что показывает | Источник |
|------|----------------|----------|
| `postgres.json` | PostgreSQL Database (ID 9628 от Grafana Labs) | postgres_exporter |
| `clinika-overview.json` | Сводка: статус PG, активные коннекшены, размер БД, uptime, транзакции, IO по строкам | postgres_exporter (кастомный) |

**Импорт после первого входа** (`admin/admin`, потом смена пароля):

1. **Settings → Data sources → Add data source → Prometheus**
   - URL: `http://prometheus:9090` (внутри docker network)
   - Save & Test → должно быть зелёным.
2. **Dashboards → New → Import → Upload JSON file** → выбрать файл из репо.
3. При запросе datasource — выбрать ранее созданный Prometheus.

Дополнительные дашборды по ID с <https://grafana.com/grafana/dashboards/>:

- **Prometheus 2.0 Stats**: ID `3662`
- **Node Exporter Full**: ID `1860` (если добавим node-exporter)

### Backend метрики (TODO)

Чтобы видеть метрики FastAPI, добавить в `backend/`:

```bash
pip install prometheus-fastapi-instrumentator
```

В `backend/app/main.py`:

```python
from prometheus_fastapi_instrumentator import Instrumentator
Instrumentator().instrument(app).expose(app)
```

Затем раскомментировать секцию `clinika-backend` в `monitoring/prometheus.yml`.

## 3. Sentry

Полная инструкция в **`docs/SENTRY_SETUP.md`** — там пошагово про регистрацию,
получение DSN, заполнение `.env`, пересборку и тест.

Кратко:

- SDK уже встроены: `backend/app/main.py` (sentry-sdk[fastapi]) + `frontend/src/main.jsx` (@sentry/react).
- Без DSN — клиенты неактивны, приложение работает как раньше.
- Backend читает `SENTRY_DSN`, frontend — `VITE_SENTRY_DSN` (компилируется в бандл, нужна пересборка).
- Email пользователя: **mrevil9995@gmail.com** (использовать при регистрации Sentry).

## 4. Nginx routes (уже в /etc/nginx/sites-enabled/clinikahttps.conf)

В конфиге уже добавлены два префикс-роута (с приоритетом `^~`, чтобы catch-all `/[^/]+` не перехватил):

```nginx
location ^~ /uptime/ {
    proxy_pass http://127.0.0.1:3001/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;   # WebSocket для socket.io
    proxy_read_timeout 3600s;
    proxy_buffering off;
}

location ^~ /grafana/ {
    proxy_pass http://127.0.0.1:3002/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 3600s;
}
```

Grafana поднята с `GF_SERVER_ROOT_URL=https://клиниксеть.рф/grafana/` и `GF_SERVER_SERVE_FROM_SUB_PATH=true` — sub-path работает корректно.

Опционально — закрыть Basic Auth или allow-list IP, если не хочешь публичный доступ.

## 5. Текущее состояние (2026-05-07)

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
```

| Контейнер | Состояние | Назначение |
|-----------|-----------|------------|
| uptime-kuma | Up (healthy) | проверки доступности, status-page |
| prometheus | Up | сбор метрик (postgres + self) |
| postgres-exporter | Up | экспорт метрик PostgreSQL |
| grafana | Up | дашборды |

URL после подъёма:

- <https://клиниксеть.рф/uptime/> — Uptime-Kuma (первый вход → создать админа)
- <https://клиниксеть.рф/grafana/> — Grafana (admin/admin)
- внутри докера: `http://prometheus:9090`, `http://postgres-exporter:9187/metrics`

Прокачка стека:

```bash
cd /opt/clinika
docker compose -f docker-compose.monitoring.yml --profile metrics up -d prometheus postgres-exporter grafana
```

(Не подавать в один cmd с `uptime-kuma` — он уже запущен через `docker run` и compose ругнётся на конфликт имени.)

## 6. Чеклист после установки

- [ ] Зайти на <https://клиниксеть.рф/uptime/>, создать админ-аккаунт
- [ ] Добавить 5–7 проверок (см. таблицу в разделе 1)
- [ ] Создать `@clinika_alerts_bot` через @BotFather
- [ ] Привязать Telegram-нотификации к default monitor
- [ ] Тест: остановить `clinika-backend`, проверить что прилетел алерт
- [x] Поднять Prometheus+Grafana через `--profile metrics`
- [ ] Зайти на <https://клиниксеть.рф/grafana/> (admin/admin), сменить пароль
- [ ] Добавить data source Prometheus (`http://prometheus:9090`)
- [ ] Импортировать `monitoring/grafana-dashboards/postgres.json` (PostgreSQL Database)
- [ ] Импортировать `monitoring/grafana-dashboards/clinika-overview.json` (сводка)
- [ ] Зарегистрироваться на sentry.io под `mrevil9995@gmail.com`, получить DSN
- [ ] Прописать `SENTRY_DSN` и `VITE_SENTRY_DSN` в `/opt/clinika/.env`
- [ ] Перезапустить backend (`docker compose up -d clinika-backend`)
- [ ] Пересобрать frontend (`docker compose build --no-cache clinika-frontend && docker compose up -d clinika-frontend`)

## Связанное

- `SENTRY_SETUP.md` — пошаговая инструкция Sentry (регистрация → DSN → тест)
- `BACKUP.md` — бэкапы и offsite (rclone Yandex.Disk)
- `ROADMAP.md` Этап 12 — DevOps & Observability
- `docker-compose.monitoring.yml` — стек мониторинга
- `monitoring/grafana-dashboards/` — JSON для импорта в Grafana
