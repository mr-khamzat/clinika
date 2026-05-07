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

### Полезные дашборды (импорт по ID)

- **PostgreSQL Database**: ID `9628` (postgres_exporter)
- **Prometheus Stats**: ID `2`
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

См. `.env.example` — переменные `SENTRY_DSN` (backend) и `VITE_SENTRY_DSN` (frontend).

Структура DSN: `https://<key>@o<org_id>.ingest.sentry.io/<project_id>`

Получение DSN:

1. Регистрация на <https://sentry.io>.
2. Create Project → Python (для backend) и React (для frontend) — два отдельных проекта.
3. Settings → Projects → `<project>` → Client Keys (DSN) — копируешь URL.
4. Вставляешь в `/opt/clinika/.env`:

   ```
   SENTRY_DSN=https://abc123def456@o123456.ingest.sentry.io/7654321
   VITE_SENTRY_DSN=https://fed987cba654@o123456.ingest.sentry.io/1234567
   ```

5. Пересборка фронтенда (DSN компилируется в бандл):

   ```bash
   docker compose build --no-cache clinika-frontend
   docker compose up -d clinika-frontend
   ```

Без DSN Sentry не инициализируется, приложение работает как раньше.

## 4. Nginx route для uptime-kuma

Добавлен `location /uptime/` в `/etc/nginx/sites-enabled/clinikahttps.conf`:

```nginx
location /uptime/ {
    proxy_pass http://127.0.0.1:3001/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # WebSocket для real-time дашборда
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 3600s;
}
```

Опционально — закрыть Basic Auth или allow-list IP (см. `nginx-http-auth` snippet) если не хочешь публичный доступ.

## 5. Чеклист после установки

- [ ] Зайти на <https://клиниксеть.рф/uptime/>, создать админ-аккаунт
- [ ] Добавить 5–7 проверок (см. таблицу в разделе 1)
- [ ] Создать `@clinika_alerts_bot` через @BotFather
- [ ] Привязать Telegram-нотификации к default monitor
- [ ] Тест: остановить `clinika-backend`, проверить что прилетел алерт
- [ ] (Опц.) поднять Prometheus+Grafana через `--profile metrics`
- [ ] (Опц.) импортировать дашборд `9628` в Grafana
- [ ] Прописать Sentry DSN в `.env` (backend + frontend)
- [ ] Перезапустить backend и пересобрать frontend после Sentry

## Связанное

- `BACKUP.md` — бэкапы и offsite (rclone Yandex.Disk)
- `ROADMAP.md` Этап 12 — DevOps & Observability
- `docker-compose.monitoring.yml` — стек мониторинга
