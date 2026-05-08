# Uptime-Kuma — настройка мониторинга КлиникСеть

Uptime-Kuma — self-hosted status-page, который опрашивает наши endpoints
и шлёт алерты в Telegram при падении.

- **URL:** <https://клиниксеть.рф/uptime/>
- **Контейнер:** `uptime-kuma` (docker-compose.monitoring.yml)
- **Volume:** `uptime-kuma` (Docker named volume — переживает пересоздание контейнера)
- **Порт:** `127.0.0.1:3001` (наружу выпущен только через nginx)
- **Запуск:** `cd /opt/clinika && docker compose -f docker-compose.monitoring.yml up -d uptime-kuma`

---

## 1. Первый вход

1. Открой <https://клиниксеть.рф/uptime/> (через VPN не нужно — оно публично).
2. Если volume пустой — Kuma попросит создать **админ-аккаунт**:
   - Username: `khamzat`
   - Password: задай длинный, запиши в LastPass/1Password
3. После — попадёшь на дашборд.

> Если volume уже инициализирован — сразу login screen. Пароль восстановить
> можно только сбросом через CLI: `docker exec -it uptime-kuma node extra/reset-password.js`.

---

## 2. Какие чеки добавить

В верхнем меню **+ Add New Monitor**. Для каждого:
- **Monitor Type:** HTTP(s)
- **Heartbeat Interval:** 60 сек
- **Retries:** 2
- **Notification:** Telegram (см. ниже как добавить)

| Имя | URL | Тип | Что проверяем |
|---|---|---|---|
| Backend health | `https://клиниксеть.рф/api/health` | HTTP(s) — Keyword `"ok"` | FastAPI жив |
| Backend full | `https://клиниксеть.рф/api/health/full` | HTTP(s) — Keyword `"ok"` | DB+Redis+Disk+Scheduler |
| Landing | `https://клиниксеть.рф/` | HTTP(s) — status 200 | Frontend bundle отдаётся |
| Admin SPA | `https://клиниксеть.рф/admin` | HTTP(s) — status 200 | Frontend SPA-маршрут |
| PostgreSQL | `clinika-db:5432` | TCP Port | Если из той же docker-сети |
| MongoDB | (если используется) | TCP Port | — |
| TURN-сервер | `212.57.118.126:3478` | TCP Port | WebRTC звонки |

> Для TCP Port-чеков Kuma должен видеть хост. Из контейнера `uptime-kuma`
> внутри `monitoring-net` БД не видна — лучше проверять через
> `https://клиниксеть.рф/api/health/full` (там db/redis уже агрегированы).

---

## 3. Telegram-алерты

1. **Settings → Notifications → Setup Notification → Telegram**
2. Bot token: можно использовать существующий `clinika-bot` (`/opt/clinika/.env` → `TELEGRAM_BOT_TOKEN`)
   или создать отдельный через `@BotFather`.
3. Chat ID: `293633093` (твой личный, @RootkinG85). Получить можно через
   `https://api.telegram.org/bot<TOKEN>/getUpdates` после `/start` в личке.
4. **Apply on all existing monitors** → ✓
5. **Test** — должно прилететь "Hello from Uptime Kuma".

---

## 4. Status-page (публичная)

**Settings → Status Pages → New Status Page**:
- Slug: `clinikset`
- Public URL: `https://клиниксеть.рф/uptime/status/clinikset`
- Domain Names: `клиниксеть.рф` (для красивых индикаторов)
- Добавить мониторы: Backend health, Landing, Admin

Можно дать ссылку клиентам/франшизам как трансляцию uptime.

---

## 5. Бэкап

Volume `uptime-kuma` (named) живёт в `/var/lib/docker/volumes/uptime-kuma/_data/`.
Внутри SQLite-база `kuma.db`. Бэкап:

```bash
docker run --rm -v uptime-kuma:/data -v /opt/clinika/backups:/bk \
  alpine tar czf /bk/uptime-kuma-$(date +%F).tar.gz -C /data .
```

Восстановление: `tar xzf` → перезапуск контейнера.

---

## 6. Известные особенности

- **WebSocket** на `/uptime/socket.io/` — настроен в nginx (см. `clinikahttps.conf`).
  Если дашборд "висит загрузкой" — проверить `Connection: upgrade` headers.
- **Не выставляй basic-auth** на `/uptime/` — у Kuma свой логин.
- При падении контейнера Kuma не шлёт алерты сам себе. Для двойной страховки —
  есть APScheduler-watchdog в backend (см. `health_watchdog_job` в `app/main.py`).
- **Docker volume external: true** в compose — потому что volume создан
  раньше через `docker run` и его нельзя пересоздавать (потеряется конфиг).

---

## 7. Чек-лист

- [ ] `https://клиниксеть.рф/uptime/` открывается и логинит
- [ ] Добавлены чеки: Backend health, Backend full, Landing, Admin
- [ ] Telegram-уведомления настроены и протестированы
- [ ] Создана публичная status-page
- [ ] Бэкап volume в `/opt/clinika/backups/uptime-kuma-*.tar.gz`
