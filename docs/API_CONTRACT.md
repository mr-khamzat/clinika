# API Contract — КлиникСеть

Контракт для разработки мобильных и десктоп-клиентов под все 13 ролей платформы.

**Полная справка endpoints:** `https://клиниксеть.рф/{slug}/api/docs` (Swagger UI, 222 endpoint).
Подробная документация по группам: [`docs/API_REFERENCE.md`](API_REFERENCE.md).

---

## 1. Базовые правила протокола

### 1.1. URL и тенанты
- **Base URL:** `https://клиниксеть.рф/{slug}/api`
- `{slug}` — slug тенанта (3-30 символов, латиница+цифры). Получаешь от пользователя при логине или из QR-кода.
- IDN punycode: `xn--e1afagcdp8ak4h.xn--p1ai` (если стек не поддерживает кириллический домен).
- Для платформы (super_admin) slug не нужен: `https://клиниксеть.рф/api/admin/...`

### 1.2. Транспорт
- Только **HTTPS** (HTTP — редирект 301).
- HTTP/2 включён.
- Поддерживается keep-alive, gzip-compression.

### 1.3. Формат
- Все запросы и ответы — UTF-8 JSON, `Content-Type: application/json`.
- Даты — ISO 8601 в UTC (`2026-05-05T07:30:00Z`).
- Числа — float для денег (рубли, до 2 знаков после запятой).
- Идентификаторы — UUID v4 в виде строки.

### 1.4. Аутентификация
- **JWT в заголовке:** `Authorization: Bearer <access_token>`
- Access TTL — 30 минут, refresh — 30 дней.
- Получение токенов:
  - `POST /auth/login` (username + password) → access + refresh
  - `POST /auth/refresh` (refresh_token) → новая пара
  - `POST /auth/telegram` (Telegram WebApp initData) — для embedded
  - `POST /patient/by-code` (телефон + код направления) — для пациента
- При получении `401` от любого endpoint — сделать refresh; если refresh тоже 401 — разлогинить.
- `JWT.payload`: `{ sub: user_id, role: "...", tid: tenant_id, exp: <ts> }`.

### 1.5. Ошибки
Стандарт FastAPI:
```json
{ "detail": "Сообщение для пользователя" }
```
Или для validation errors:
```json
{
  "detail": [
    { "type": "missing", "loc": ["body", "username"], "msg": "Field required" }
  ]
}
```

**Коды:**
| HTTP | Что значит |
|---|---|
| 200 / 201 | OK |
| 400 | Валидация на стороне клиента (плохой запрос) |
| 401 | Нет/невалидный токен — refresh или логин |
| 402 | Модуль не оплачен (Payment Required) — показать «подключите модуль» |
| 403 | Нет прав для этой роли |
| 404 | Сущность не найдена |
| 409 | Конфликт (дубль уникального ключа, race condition) |
| 422 | Pydantic валидация — пишите имена полей в form |
| 429 | Rate-limit, читай `Retry-After` |
| 500 | Внутренняя ошибка — отправить событие в логи |
| 502 | Бэкенд временно недоступен — retry с backoff |
| 503 | Maintenance — показать «сервис в обслуживании» |

### 1.6. Pagination
Стандарт: `?limit=N&offset=N`. Default `limit=50`, `max=200`.
Ответ: `{ "items": [...], "total": N, "has_more": bool }` (некоторые endpoints просто отдают list — смотри Swagger).

### 1.7. Idempotency
Для POST с side-effects (создание направления, выплата бонуса, запись на приём) поддерживается:
```
Idempotency-Key: <uuid>
```
Повторный запрос с тем же ключом в течение 24ч вернёт тот же результат.

### 1.8. Rate-limiting
- 200 запросов/мин на IP+endpoint
- 20 запросов/мин на `/auth/*`
- При превышении: `HTTP 429`, заголовок `Retry-After: <seconds>`

### 1.9. Версионирование
Сейчас без `/v1` префикса. При breaking changes:
1. Добавим `/v2` префикс
2. Старые `/v1` остаются работать ≥ 6 месяцев
3. Изменения в response (новые поля) — non-breaking, добавятся в любой момент
4. Изменения в request (обязательные поля) — только в следующей major version

### 1.10. Локализация
Все строки от сервера на русском. Локализация — на стороне клиента.
Для дат и чисел — `Intl.NumberFormat('ru-RU')` / `dayjs.locale('ru')`.

---

## 2. Жизненный цикл клиента

### 2.1. Первый запуск
1. Пользователь вводит slug или сканирует QR со slug-ом
2. POST `/auth/login` или `/patient/by-code`
3. Сохранить `access_token` в memory, `refresh_token` в защищённом хранилище (Keystore / Keychain)
4. Сохранить `user.role` для роутинга на нужный кабинет
5. Сохранить `tenant_id` и `tenant_slug`

### 2.2. Каждый запуск
1. Прочитать refresh_token из хранилища
2. POST `/auth/refresh` → получить новый access
3. Если 401 → перейти на экран логина

### 2.3. Long-lived сессия (только пациент)
- В `/patient/by-code` возвращается `session_token` (TTL = 1 год).
- POST `/patient/session/restore` восстанавливает кабинет.
- Хранить `session_token` в Keystore.

### 2.4. Logout
- POST `/auth/logout` (текущая сессия) или `/auth/logout-all` (все устройства)
- Очистить токены из локального хранилища

### 2.5. Refresh при ошибке
```
для каждого запроса:
  if response.status == 401:
    refresh_response = POST /auth/refresh
    if refresh_response.status == 401:
      → logout, экран логина
    else:
      обновить access_token, повторить исходный запрос
```
Не делать рекурсивный refresh — после второй 401 на refresh выходи в логин.

---

## 3. Сегрегация по ролям

Каждая роль имеет свой набор разрешённых endpoint групп. Бэкенд возвращает 403 если попытаешься обратиться не к своей зоне. **Не строй UI где запросы заведомо упадут 403** — спрятать раздел вместо показа disabled.

| Группа endpoints | super_admin | franchise_owner | manager | supervisor | admin/nurse | doctor | recruiter | accountant | external_doctor | visiting_doctor | patient |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `/auth/*` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/admin/*` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/franchise-owner/*` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/manager/*` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/tenant/*` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `/clinics`, `/services` (read) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/referrals`, `/bonuses` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/scheduling/*` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅* | ✅* | ❌ |
| `/analytics/*` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/audit/*` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/recruiter/*` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/accountant/*` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `/acquisition/*` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/presence/*` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/call-rules/*` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/ai/*`, `/ai/knowledge` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/webhooks/*` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/billing/*` (тенант) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/patient/*`, `/portal/*` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `/patient-chat/*` (sender side) | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/reviews` (модерация) | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/public/*` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

`✅*` — only own appointments.

### 3.1. Что показывает мобильное приложение каждой роли

**Patient (Android/iOS):** Главная (текущее направление + ближайший приём + AI-чат), Семья, Мои записи, Врачи клиники, История, Бонусы, Профиль.

**Doctor (mobile):** Мои записи на сегодня (с swipe-actions confirm/cancel/complete), карточка пациента, голосовая диктовка протокола, чат с пациентом, P2P-звонки.

**Admin/Nurse (tablet):** Регистратор: создать направление в 2 свайпа, реестр направлений, чаты, запись пациента.

**Manager (tablet/desktop):** KPI-дашборд, drill-down аналитика, сотрудники, реестр бонусов, расписание.

**Recruiter (mobile):** KPI приглашений, мои врачи, отправить приглашение по почте/SMS.

**Supervisor / Franchise_owner (tablet):** Все вышеперечисленное + биллинг, аудит, правила звонков, AI-знание.

---

## 4. Real-time

### 4.1. WebSocket для звонков
```
URL: wss://клиниксеть.рф/{slug}/api/presence/ws/{user_id}
```
Auth: user_id в URL (внутренний JWT не требуется — упрощённая аутентификация). Heartbeat каждые 30с.

См. подробности в [`/root/clinika_android_api.md`](clinika_android_api.md) раздел «WebSocket signaling».

### 4.2. Push-уведомления

**Web Push (PWA):**
```
POST /push/subscribe
{
  "endpoint": "https://fcm.googleapis.com/...",
  "keys": { "p256dh": "...", "auth": "..." }
}
```

**Native Android (FCM):**
Регистрируешь FCM token, отправляешь на:
```
POST /push/subscribe
{ "type": "fcm", "token": "<FCM token>", "device_info": {...} }
```

**Native iOS (APNs):**
```
POST /push/subscribe
{ "type": "apns", "device_token": "<hex>", "device_info": {...} }
```

**События которые приходят:**
- `appointment_reminder` (за 24ч и за 2ч до визита)
- `referral_scanned` (когда пациент отсканировал QR направления)
- `bonus_paid`
- `incoming_call` (опционально — если пользователь должен ответить)
- `chat_message_unread`

### 4.3. Webhooks (для интеграции внешних систем)

Если приложение — это intermediate сервер, регистрируй webhook на бэкенде:
```
POST /webhooks
{
  "url": "https://your-server/webhooks/clinika",
  "events": ["bonus_paid", "appointment_booked"],
  "secret": "<random-32-bytes>"
}
```
Бэкенд будет POST'ить события с HMAC-SHA256 подписью в заголовке `X-Clinika-Signature: sha256=<hex>`.

---

## 5. WebRTC (P2P-звонки)

### Шаги звонка между двумя коллегами:
1. Оба клиента подключены к `/presence/ws/{user_id}`
2. Caller получает `iceServers` через `GET /presence/ice-config`
3. Caller создаёт `RTCPeerConnection(iceServers)`
4. Caller получает локальный поток (mic + camera)
5. Caller создаёт SDP offer, отправляет через WS:
   ```json
   { "type": "call_invite", "callee_id": "...", "call_type": "audio|video", "sdp_offer": {...} }
   ```
6. Callee получает `call_invite`, показывает UI «входящий звонок», создаёт свой PC
7. Callee принимает → отправляет `call_response` с `sdp_answer`
8. Обе стороны обмениваются `ice_candidate` через WS
9. После `icecandidate.complete` соединение установлено
10. Окончание: любая сторона шлёт `call_end`

### TURN credentials
Действительны 1 час, перезапрашивай перед каждым звонком.

### Native Android WebRTC
Используй `org.webrtc:google-webrtc:1.0.32006` или новее. Подключаешь iceServers как `PeerConnection.IceServer.builder(...)`.

---

## 6. Multi-tenant и брендинг

### 6.1. Динамический брендинг
```
GET /tenant/branding
```
Возвращает:
```json
{
  "logo_url": "https://...",
  "primary_color": "#0097A7",
  "accent_color": "#00ACC1",
  "name": "АРЦ КлиникаСеть",
  "favicon_url": "...",
  "og_image_url": "..."
}
```
Apply в Android: подменить тему через `Material You dynamic colors` или применить как primary в `MaterialTheme`.

### 6.2. CSS-переменные → нативные
Web использует `--accent: oklch(0.72 0.13 var(--brand-hue))`. На native — конвертируй в RGB через `Color.parseColor()` или `oklch-to-rgb` библиотеку.

---

## 7. Тестирование

### 7.1. Тестовый тенант
- Slug: `default`
- Можно использовать суперадмином `khamzat` (если установлен).

### 7.2. Mock-сервер
Если нужен — спроси, поднимем wiremock на отдельном поддомене.

### 7.3. Postman collection
Собрать из OpenAPI:
```bash
curl https://клиниксеть.рф/arc/api/openapi.json -o spec.json
# Импорт в Postman → New → Import → spec.json
```

---

## 8. Roadmap (что мы планируем добавить)

- **GraphQL gateway** — для эффективных запросов с многокурсорной выборкой
- **Server-sent events** — альтернатива WS для read-only потоков (notifications)
- **Idempotency-Key** на больше эндпоинтов
- **API keys** для service-to-service интеграций (без user-context)
- **Метрики прометея** на `/metrics` — для мониторинга со стороны клиента

---

## 9. Контакт

- Issue tracker: https://github.com/mr-khamzat/clinika/issues
- Swagger UI: https://клиниксеть.рф/arc/api/docs
- Этот контракт: `API_CONTRACT.md` в корне репо
