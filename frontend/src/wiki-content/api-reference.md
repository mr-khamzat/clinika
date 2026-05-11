# API Reference — обзор

Это сводный обзор REST API платформы. Полная OpenAPI спецификация доступна по адресу `/api/docs` (Swagger UI) и `/api/openapi.json`.

## Базовый URL

```
https://клиниксеть.рф/api
```

Public API v1 (для агрегаторов и внешних систем):

```
https://клиниксеть.рф/api/v1
```

## Аутентификация

### JWT (для пользователей платформы)

Получение токена:

```bash
curl -X POST https://клиниксеть.рф/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "owner@example.ru", "password": "..."}'
```

Response:

```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "refresh_token": "...",
  "token_type": "bearer",
  "expires_in": 3600,
  "user": {
    "id": "01HF...",
    "role": "manager",
    "tenant_slug": "family-clinic"
  }
}
```

Использование:

```bash
curl https://клиниксеть.рф/api/admins/me \
  -H "Authorization: Bearer eyJ0..."
```

Refresh:

```bash
curl -X POST https://клиниксеть.рф/api/auth/refresh \
  -H "Authorization: Bearer <refresh_token>"
```

### Tenant API Key (для внешних систем)

```bash
curl https://клиниксеть.рф/api/v1/referrals \
  -H "X-Api-Key: <tenant_api_key>"
```

Создаются в кабинете super_admin: «Безопасность → API ключи».

## Пагинация

Все list-эндпоинты поддерживают:

```
GET /referrals?limit=50&offset=100
```

Параметры:

- `limit` — макс 200, default 50
- `offset` — default 0
- `cursor` — альтернатива offset для больших коллекций (id последнего элемента)

Response с пагинацией:

```json
{
  "items": [...],
  "total": 1245,
  "limit": 50,
  "offset": 100,
  "next_cursor": "01HF..."
}
```

## Сортировка и фильтрация

```
GET /appointments?status=completed&from=2026-05-01&to=2026-05-31&sort=-start_time
```

Префикс `-` для убывающей сортировки.

## Коды ошибок

| Код | Описание | Когда возникает |
|---|---|---|
| 200 | OK | Успех |
| 201 | Created | Ресурс создан |
| 204 | No Content | Успех без тела (DELETE) |
| 400 | Bad Request | Невалидное тело запроса |
| 401 | Unauthorized | Нет/невалидный токен |
| 403 | Forbidden | Нет прав на действие |
| 404 | Not Found | Ресурс не найден или фильтр тенанта вырезал |
| 409 | Conflict | Дубликат (slug, email) |
| 422 | Unprocessable Entity | Pydantic ошибка валидации |
| 429 | Too Many Requests | Rate limit |
| 500 | Internal Server Error | Ошибка сервера |
| 503 | Service Unavailable | Disaster mode или maintenance |

Тело ошибки:

```json
{
  "detail": "Текст ошибки на русском",
  "code": "TENANT_NOT_FOUND",
  "request_id": "01HF..."
}
```

При 422 (Pydantic):

```json
{
  "detail": [
    { "loc": ["body", "phone"], "msg": "value is not a valid phone", "type": "value_error.phone" }
  ]
}
```

## Rate Limiting

| Endpoint group | Limit |
|---|---|
| `/auth/*` | 5 req/sec per IP |
| `/public/*` | 10 req/sec per IP |
| `/api/v1/*` | 100 req/sec per API key |
| `/api/*` (auth) | 50 req/sec per user |

При превышении — 429 с заголовком `Retry-After: 30`.

## Группы endpoints

### Аутентификация

```
POST /auth/login
POST /auth/refresh
POST /auth/logout
POST /auth/password-reset/request
POST /auth/password-reset/confirm
```

### Профиль

```
GET   /admins/me
PATCH /admins/me
POST  /admins/me/password
```

### Тенанты (super_admin)

```
GET    /admin/tenants
POST   /admin/tenants
GET    /admin/tenants/{id}
PATCH  /admin/tenants/{id}
POST   /admin/tenants/{id}/suspend
POST   /admin/tenants/{id}/restore
```

### Клиники

```
GET    /clinics
POST   /clinics
GET    /clinics/{id}
PATCH  /clinics/{id}
```

### Пациенты

```
GET    /patients
POST   /patients
GET    /patients/{id}
PATCH  /patients/{id}
GET    /patients/search?q=...
```

### Направления

```
GET    /referrals
POST   /referrals
GET    /referrals/{id}
POST   /referrals/{id}/confirm
POST   /referrals/{id}/cancel
GET    /referrals/scan/{qr_code}
GET    /referrals/by-code/{short_code}
```

### Приёмы

```
GET    /appointments
POST   /appointments
GET    /appointments/{id}
PATCH  /appointments/{id}
POST   /appointments/{id}/complete
POST   /appointments/{id}/cancel
```

### Биллинг

```
GET    /billing/summary
GET    /billing/plans
GET    /billing/invoices
GET    /billing/invoices/{id}
POST   /billing/subscription
POST   /billing/invoices/{id}/pay
```

### Modules

```
GET    /marketplace/modules
GET    /modules/active-keys
GET    /modules/features/{name}
POST   /commercial/tenants/{tid}/modules/{key}/enable
POST   /commercial/tenants/{tid}/modules/{key}/disable
```

### Аналитика

```
GET /manager/analytics/dashboard
GET /franchise/analytics/dashboard
GET /franchise/analytics/cohorts
POST /franchise/ai/insights
```

### Чат

```
GET  /patient/chat/threads
POST /patient/chat/threads
GET  /patient/chat/threads/{id}/messages
POST /patient/chat/threads/{id}/messages
```

### Calls / Telemedicine

```
GET  /presence/ice-config
WS   /presence/ws
POST /telemedicine/sessions
GET  /telemedicine/sessions/{id}
```

### Webhooks

```
GET    /webhooks/endpoints
POST   /webhooks/endpoints
DELETE /webhooks/endpoints/{id}
POST   /webhooks/endpoints/{id}/test
GET    /webhooks/deliveries
```

### Аудит

```
GET /audit/log
GET /audit/log/{entity_type}/{entity_id}
GET /audit/log/actor/{user_id}
```

## Примеры

### JS / fetch

```javascript
const res = await fetch('https://клиниксеть.рф/api/referrals', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    to_clinic_id: clinicId,
    service_id: serviceId,
    patient_phone: '+79001234567',
  }),
});
const data = await res.json();
```

### curl

```bash
curl -X POST https://клиниксеть.рф/api/referrals \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to_clinic_id": "01HF...",
    "service_id": "01HF...",
    "patient_phone": "+79001234567"
  }'
```

### Python / httpx

```python
import httpx

async with httpx.AsyncClient() as client:
    res = await client.post(
        "https://клиниксеть.рф/api/referrals",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "to_clinic_id": clinic_id,
            "service_id": service_id,
            "patient_phone": "+79001234567",
        },
    )
    data = res.json()
```

## Webhooks (входящие в вашу систему)

Платформа отправляет POST с body JSON и заголовком подписи:

```
X-Signature: sha256=<hmac_sha256(body, your_secret)>
X-Event: referral_created
X-Delivery-Id: 01HF...
```

Ответ ожидается 200 в пределах 10 секунд. Любой другой код — retry с exp backoff.

## Версионирование

- `/api/*` — внутренний API, может меняться без предупреждения.
- `/api/v1/*` — публичный, гарантия back-compat в пределах major-версии.

При breaking change в v1 — выпускается v2, v1 поддерживается ≥12 месяцев параллельно.

## Связанные статьи

- [API: Аутентификация](/wiki/api-auth-detailed)
- [Гл. 1: Платформа (Public API)](/wiki/chapter-1-platform)
- [Гл. 10: Интеграции](/wiki/chapter-10-integrations)
- [dev: API endpoints](/wiki/dev-api)
