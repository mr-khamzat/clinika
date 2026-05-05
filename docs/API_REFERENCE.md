# API КлиникСеть — для Android-приложения

**Базовый URL:** `https://клиниксеть.рф/{slug}/api`
- `{slug}` — поддомен тенанта (например, `arc` для АРЦ КлиникаСеть)
- Пример: `https://клиниксеть.рф/arc/api/auth/login`
- IDN-домен: можно использовать punycode `xn--e1afagcdp8ak4h.xn--p1ai`

**OpenAPI спецификация:**
- Live Swagger UI: `https://клиниксеть.рф/{slug}/api/docs`
- JSON spec: `https://клиниксеть.рф/{slug}/api/openapi.json` (≈ 222 endpoints)
- Файл в репо: `backend/openapi.json`

**Формат:** REST + JSON. Все запросы и ответы UTF-8 JSON. WebSocket для presence/звонков.

---

## Аутентификация

### 1. Логин (получить access + refresh)
```http
POST /auth/login
Content-Type: application/json

{ "username": "khamza", "password": "..." }
```
**Ответ 200:**
```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "RT-...",
  "token_type": "bearer",
  "user": {
    "id": "uuid",
    "username": "khamza",
    "role": "supervisor",
    "tenant_id": "uuid",
    "tenant_slug": "arc",
    "full_name": "Гудаев Хамзат",
    "redirect_url": "/arc/admin"
  }
}
```

JWT payload: `{ "sub": user_id, "role": "...", "tid": tenant_id, "exp": ... }`

**Срок действия:** access — 30 минут, refresh — 30 дней.

### 2. Все запросы с авторизацией
```
Authorization: Bearer <access_token>
```

### 3. Refresh
```http
POST /auth/refresh
Content-Type: application/json

{ "refresh_token": "RT-..." }
```
Возвращает новую пару access+refresh. Старый refresh инвалидируется.

### 4. Logout
```http
POST /auth/logout      # текущая сессия
POST /auth/logout-all  # все устройства
GET  /auth/sessions    # список активных
```

### 5. Регистрация по приглашению
```http
GET  /invite/{token}        # проверить токен (публично)
POST /invite/{token}/accept # принять приглашение, ввести пароль и ФИО
```

---

## Роли и кабинеты (для роутинга в приложении)

| role | redirect_url |
|---|---|
| super_admin | `/admin` |
| franchise_owner | `/{slug}/admin` (FranchiseOwnerCabinet) |
| manager | `/{slug}/manager/` |
| supervisor | `/{slug}/admin` (SupervisorCabinet) |
| admin / nurse | `/{slug}/admin` (OperationalCabinet) |
| doctor | `/{slug}/admin` (DoctorLayout) |
| recruiter | `/{slug}/admin` (RecruiterCabinet) |
| accountant | `/{slug}/admin` (AccountantCabinet) |
| acquisition_manager | `/{slug}/admin` (AcquisitionManagerCabinet) |
| external_doctor | `/{slug}/admin` (ExternalDoctorCabinet) |
| visiting_doctor | `/{slug}/admin` (VisitingDoctorCabinet) |
| patient | `/{slug}/p/` (PWA) |

Для **Android-приложения пациента** используй endpoint'ы под `/patient/*` — они спроектированы для PWA и не требуют username/password (вход по QR/коду).

---

## Кабинет пациента (Android-таргет)

### Вход по короткому коду направления
```http
POST /patient/by-code
Content-Type: application/json

{ "code": "ABC123", "phone": "+79..." }
```
**Ответ:**
```json
{
  "patient_token": "...",
  "session_token": "...",   /* JWT type=patient_session, TTL=1 год */
  "current": { "referral": {...}, "active_appointment": {...} },
  "other_referrals": [...],
  "mis_info": {...},
  "mis_visits": [...]
}
```

### Восстановить сессию (long-lived)
```http
POST /patient/session/restore
{ "session_token": "..." }
```
Сохраняй `session_token` в Android Keystore — действителен 1 год.

### Logout
```http
POST /patient/session/logout
```

### PWA Manifest (динамический, c вшитой сессией)
```http
GET /portal/manifest.json
```

---

## Основные ресурсы

### Тенант / брендинг
```
GET /tenant/current            — инфо о текущем тенанте
GET /tenant/license            — план + features
GET /tenant/branding           — лого, цвета, css-переменные
GET /tenant/modules-status     — список модулей и их статус
```

### Направления и бонусы
```
POST  /referrals/              — создать направление
GET   /referrals/              — список (фильтры: status, days, clinic_id)
GET   /referrals/{id}
POST  /referrals/{id}/scan     — отметить сканирование QR
GET   /bonuses/                — мои бонусы
GET   /bonuses/summary         — сводка по статусам
POST  /bonuses/pay             — выплатить (manager+)
GET   /ledger/balance          — баланс
GET   /ledger/history          — операции
```

### Расписание и записи
```
GET   /doctors/                — список врачей тенанта
GET   /doctors/{id}            — детали врача
GET   /doctors/{id}/slots?day=YYYY-MM-DD  — свободные слоты
POST  /appointments            — записать пациента
GET   /appointments?doctor_id=&appointment_date=  — список
PATCH /appointments/{id}/status  — изменить статус
GET   /appointments/stats?days=N — KPI по записям
```

### Аналитика (manager+)
```
GET /analytics/overview         — сводка с дельтой
GET /analytics/funnel           — воронка направлений
GET /analytics/dynamics         — динамика (day/week/month)
GET /analytics/top-services     — топ услуг
GET /analytics/top-staff        — рейтинг сотрудников
GET /analytics/clinics          — сравнение филиалов
GET /analytics/ledger-trend?user_id=... — накопительный баланс
```

### Чаты с пациентами
```
GET   /patient-chat/conversations      — список диалогов
GET   /patient-chat/conversations/{id} — сообщения
POST  /patient-chat/conversations/{id}/messages — отправить
```
AI-fallback автоматический если нет ответа от персонала.

### Звонки (presence + WebRTC)
```
GET  /presence/users           — список коллег + статус
GET  /presence/can-call        — { enabled, audio, video, in_grace, grace_until }
GET  /presence/ice-config      — STUN + TURN с REST-credentials
GET  /presence/can-call-target/{user_id} — { allow_audio, allow_video }
PUT  /presence/status          — обновить свой статус
WS   /presence/ws/{user_id}    — WebSocket signaling
```

#### WebSocket signaling (звонки)
```
URL: wss://клиниксеть.рф/{slug}/api/presence/ws/{user_id}
```
**Сервер → Клиент:**
- `presence_update` — статус коллеги изменился
- `call_invite` — входящий звонок (caller_id, call_type, sdp_offer)
- `call_accept` — собеседник принял (sdp_answer)
- `call_decline` / `call_end` — отклонил / завершил
- `ice_candidate` — для WebRTC

**Клиент → Сервер:**
- `heartbeat` (раз в 30 секунд)
- `call_invite` (callee_id, call_type, sdp_offer)
- `call_response` (caller_id, accept/decline, sdp_answer)
- `ice_candidate` (target_id, candidate)

#### TURN credentials
`GET /presence/ice-config` возвращает:
```json
{
  "iceServers": [
    { "urls": "stun:stun.l.google.com:19302" },
    { "urls": "stun:stun1.l.google.com:19302" },
    {
      "urls": ["turn:212.57.118.126:3478?transport=udp", "turn:212.57.118.126:3478?transport=tcp"],
      "username": "1777964855:user_id",
      "credential": "base64-hmac-sha1"
    }
  ],
  "ttl": 3600
}
```
Креды действительны 1 час, перезапрашивай перед каждым звонком.

### Правила звонков (UI)
```
GET    /call-rules/{tenant_id}  — все правила тенанта
PUT    /call-rules/{tenant_id}  — upsert (from_role, to_role, scope, allow_audio, allow_video, [from_clinic_id, to_clinic_id])
DELETE /call-rules/{tenant_id}  — сбросить все
```

### Клиники
```
GET   /clinics                 — список клиник тенанта
POST  /clinics                 — создать (manager+)
PATCH /clinics/{id}            — изменить
```

### Услуги
```
GET   /services                — каталог услуг (фильтр: clinic_id, category)
POST  /services                — создать (manager+)
PATCH /services/{id}           — изменить
```

### Отзывы
```
POST  /reviews                 — добавить отзыв (публично!)
GET   /reviews/doctor/{id}     — отзывы врача
GET   /reviews/moderate        — модерация (manager+)
PATCH /reviews/{id}/approve|reject
```

### Платёжные модули и биллинг
```
GET   /modules/features        — список фич плана
GET   /admin/billing/overview  — сводка биллинга (super_admin)
GET   /franchise-owner/billing/summary  — счета от платформы
GET   /franchise-owner/billing/invoices — история счетов
```

### AI Knowledge (FAQ для AI-чата)
```
GET   /ai/knowledge            — список entries
POST  /ai/knowledge            — создать (manager+)
PATCH /ai/knowledge/{id}       — изменить
DELETE /ai/knowledge/{id}      — удалить
GET   /ai/knowledge/stats      — кол-во хитов
```

### AI-аналитика (по плану)
```
GET   /ai/analyze?type=overview&days=30  — короткие инсайты
POST  /ai/ask                  — вопрос-ответ
GET   /ai/balance              — баланс LLM
```

### Геолокация / устройство
```
GET   /geo/cities?search=...   — города (autocomplete)
GET   /geo/device              — определить устройство по UA
```

### Push-уведомления
```
POST  /push/subscribe          — зарегистрировать subscription (Web Push API)
DELETE /push/unsubscribe/{endpoint}
```
Можно использовать FCM (Firebase Cloud Messaging) — бэкенд отправит payload через webhook на твой FCM-сервер. Для этого регистрируй FCM token через `/push/subscribe` с типом `fcm`.

### Telegram Mini App (если приложение это hybrid)
```
POST  /auth/telegram           — вход через Telegram WebApp initData
```

---

## Webhooks (для интеграции внешних систем)

Регистрируешь webhook endpoint на бэкенде → получаешь POST со HMAC-SHA256 подписью при каждом событии.

```
GET   /webhooks                — список своих webhook'ов
POST  /webhooks                — создать
GET   /webhooks/events         — список доступных событий
GET   /webhooks/{id}/deliveries — лог доставок
POST  /webhooks/{id}/test      — проверить
```

**События:**
- `referral_created`, `referral_scanned`
- `bonus_paid`, `bonus_cancelled`
- `appointment_booked`, `appointment_cancelled`, `appointment_completed`
- `invoice_paid`, `subscription_changed`
- `patient_registered`

**Заголовки доставки:**
- `X-Clinika-Signature: sha256=<hex>` — HMAC-SHA256(secret, body)
- `X-Clinika-Event: bonus_paid`
- `X-Clinika-Delivery: <uuid>`

Retry x3 с экспоненциальным backoff.

---

## Безопасность

### Rate limiting
- 200 req/min на IP+endpoint
- 20 req/min на `/auth/*`
- При превышении — `HTTP 429 Too Many Requests` + `Retry-After` header

### Multi-tenant isolation
- Каждый запрос ограничен `tenant_id` из JWT (`tid`)
- IDOR-защита: `assert_tenant_owns()` на каждой операции

### CORS
- Allowed origins: `https://клиниксеть.рф`, `https://app.клиниксеть.рф` (при необходимости — добавь свой).

### TLS
- Все запросы через HTTPS (сертификат от Let's Encrypt через TLS-ALPN-01)
- HTTP2 включён

---

## Примеры на Kotlin (Retrofit)

```kotlin
interface ClinikaApi {
    @POST("auth/login")
    suspend fun login(@Body req: LoginRequest): LoginResponse

    @GET("tenant/current")
    suspend fun tenantCurrent(): TenantInfo

    @GET("appointments")
    suspend fun appointments(
        @Query("doctor_id") doctorId: String?,
        @Query("appointment_date") date: String?,
    ): List<Appointment>

    @POST("appointments")
    suspend fun createAppointment(@Body req: CreateAppointmentRequest): Appointment

    @GET("presence/ice-config")
    suspend fun iceConfig(): IceConfigResponse
}

data class LoginRequest(val username: String, val password: String)
data class LoginResponse(
    val access_token: String,
    val refresh_token: String,
    val user: UserInfo,
)
```

```kotlin
val retrofit = Retrofit.Builder()
    .baseUrl("https://клиниксеть.рф/arc/api/")
    .client(OkHttpClient.Builder()
        .addInterceptor(AuthInterceptor(tokenStore))  // Authorization: Bearer ...
        .build())
    .addConverterFactory(MoshiConverterFactory.create())
    .build()
```

---

## Что ещё может быть полезно

1. **Pagination** — некоторые list-endpoints поддерживают `?limit=N&offset=N` или `?page=N&per_page=N`. Смотри Swagger UI.
2. **Field filtering** — большинство list-endpoints возвращают полную структуру; для экономии трафика можно добавить `?fields=id,name,status` (если supported).
3. **Версионирование API** — сейчас нет /v1/ префикса. При мажорных изменениях добавим.
4. **Локализация** — все ответы на русском. Заголовок `Accept-Language` пока не используется.
5. **Идемпотентность** — для POST с сайд-эффектами поддерживаем `Idempotency-Key` header (опц.).

---

## Контакт

- Issue tracker: https://github.com/mr-khamzat/clinika/issues
- Backend Swagger UI всегда live: https://клиниксеть.рф/arc/api/docs
- Mock-сервер для Android dev (если нужен) — спроси, поднимем wiremock.
