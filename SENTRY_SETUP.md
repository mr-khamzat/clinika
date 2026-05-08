# Sentry — пошаговая настройка для КлиникСеть

Sentry — облачный sink для ошибок и performance-traces. У нас два проекта:
**backend (Python/FastAPI)** и **frontend (React/Vite)**.
Если DSN не задан — Sentry полностью отключён, приложение работает без него.

---

## 1. Регистрация и проекты

1. Зайди на <https://sentry.io/signup/> под `mrevil9995@gmail.com`.
   Free-план: 5k errors/мес, 10k transactions/мес, 1 user — нам хватит.
2. **Create Organization** → имя: `clinikset` (или любое).
3. **Create Project** → платформа **Python → FastAPI** → имя: `clinika-backend`.
   После создания скопируй DSN — он лежит в **Settings → Projects → clinika-backend → Client Keys (DSN)**.
   Формат: `https://<key>@o<org>.ingest.sentry.io/<project>`.
4. **Create Project** → платформа **Browser → React** → имя: `clinika-frontend`.
   Скопируй второй DSN (он отличается от backend!).

---

## 2. Куда положить DSN

На проде — в `/opt/clinika/.env`:

```bash
# Backend (читается процессом FastAPI)
SENTRY_DSN=https://aaaaaaaaaa@o123456.ingest.sentry.io/4505000000000001
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1

# Frontend (запекается Vite в бандл при build)
VITE_SENTRY_DSN=https://bbbbbbbbbb@o123456.ingest.sentry.io/4505000000000002
VITE_SENTRY_ENVIRONMENT=production
```

> Не коммить `.env`! Шаблон лежит в `.env.example`.

---

## 3. Применение

### Backend
```bash
cd /opt/clinika
docker compose up -d --force-recreate clinika-backend
docker logs clinika-backend --tail 30 | grep -i sentry
```
В логах должно быть `[sentry]` или просто отсутствие ошибок Sentry.
Без DSN бэкенд стартует молча — это норма.

### Frontend (важно — нужен ребилд, а не просто рестарт!)
```bash
cd /opt/clinika
docker compose build --no-cache clinika-frontend
docker compose up -d clinika-frontend
```
Vite читает `VITE_SENTRY_DSN` из ENV при сборке (см. `frontend/Dockerfile`,
`docker-compose.yml` → `build.args`). Перезапуск без `build` ничего не даст.

---

## 4. Тестирование

### Backend
```bash
# Этот endpoint специально кидает RuntimeError
curl -sk https://клиниксеть.рф/api/_test_alert_500
```
Через 30–60 секунд событие появится в **Sentry → Issues** (проект `clinika-backend`).

### Frontend
В DevTools-консоли любой страницы:
```js
throw new Error('Sentry test from production')
```
Или временный кнопочный handler в любом компоненте:
```jsx
<button onClick={() => { throw new Error('boom') }}>Test Sentry</button>
```
Событие появится в проекте `clinika-frontend` через 10–30 секунд.

---

## 5. Что отправляется

- **Backend**: исключения (через `FastApiIntegration`), медленные SQL-запросы (`SqlalchemyIntegration`),
  10% транзакций (sample 0.1).
- **Frontend**: JS-ошибки + `Sentry.ErrorBoundary` (см. `src/main.jsx`),
  10% navigation transactions, **session replay только при ошибках** (10% от ошибок),
  с маскированием текста и медиа (PII-защита 152-ФЗ).
- `send_default_pii=False` на бэке — не шлём IP, заголовки, тело.

---

## 6. Известные ограничения

- **Source maps** для frontend сейчас не загружаются в Sentry (нужен `@sentry/vite-plugin` + `SENTRY_AUTH_TOKEN`).
  Stacktrace будет minified, но читаемый. Подключить позже, когда будет CI/CD.
- При выключении интернета на сервере Sentry SDK буферизует и потом отправит — приложение не зависает.
- Если квота кончилась — Sentry просто дропает события, прод не страдает.

---

## 7. Чек-лист после регистрации

- [ ] Зарегистрирован на sentry.io под `mrevil9995@gmail.com`
- [ ] Создан проект `clinika-backend` (FastAPI), скопирован DSN
- [ ] Создан проект `clinika-frontend` (React), скопирован DSN
- [ ] `SENTRY_DSN` и `VITE_SENTRY_DSN` записаны в `/opt/clinika/.env`
- [ ] `docker compose up -d --force-recreate clinika-backend`
- [ ] `docker compose build --no-cache clinika-frontend && docker compose up -d clinika-frontend`
- [ ] Тестовый `/api/_test_alert_500` пришёл в Issues
- [ ] Тестовый `throw new Error()` из браузера пришёл в Issues
