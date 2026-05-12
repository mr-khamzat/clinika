# Соглашения REST API

Принципы и конвенции, которым следует REST API КлиникСеть. Цель — предсказуемость для интеграторов и собственных разработчиков.

## Базовый URL

- Production: `https://клиниксеть.рф/api/`
- OpenAPI: `https://клиниксеть.рф/api/openapi.json`
- Swagger UI: `https://клиниксеть.рф/api/docs`
- ReDoc: `https://клиниксеть.рф/api/redoc`

## Префиксы роутеров

| Префикс | Назначение | Auth |
|---|---|---|
| `/auth` | Логин, refresh, OTP, регистрация | Public |
| `/public/*` | Публичные API (booking, aggregator-leads) | API-key или анонимно |
| `/patient/*` | Кабинет пациента | JWT (role=patient) |
| `/admin/*` | Кабинет тенанта | JWT (role=manager/super_admin/etc) |
| `/integrations/*` | Webhook'и от внешних систем | HMAC signature |
| `/health`, `/health/full` | Health-checks | Public |

## HTTP-методы

- `GET /resources` — список (с пагинацией).
- `GET /resources/{id}` — конкретный объект.
- `POST /resources` — создать (201 Created).
- `PATCH /resources/{id}` — частичное обновление.
- `PUT /resources/{id}` — полная замена (используется редко).
- `DELETE /resources/{id}` — удалить (204 No Content).

## Коды ответов

| Код | Когда |
|---|---|
| 200 | GET / PATCH успешно |
| 201 | POST создал ресурс |
| 204 | DELETE успешно |
| 400 | Невалидные данные (Pydantic) |
| 401 | Нет/невалидный токен |
| 403 | Доступ запрещён (RBAC) |
| 404 | Ресурс не найден |
| 409 | Конфликт (дубликат, неверный статус) |
| 422 | Ошибка валидации (стандарт FastAPI) |
| 429 | Превышен rate-limit |
| 500 | Внутренняя ошибка (логируется в Sentry) |

## Аутентификация

### JWT Bearer
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
- `POST /auth/login` → `{access_token, refresh_token}`.
- Access TTL = 1 час. Refresh TTL = 30 дней с rotation.
- При `401` с `code=token_expired` → вызови `POST /auth/refresh`.

### Tenant API Key
```
X-API-Key: ak_xxxxxxxxxxxx
```
- Для server-to-server интеграций.
- Scoped permissions: `read`, `write`, `webhooks`.
- Создаётся в `/admin/api-keys`.

### Token Exchange (RFC 8693)
Impersonation для super_admin: обменять свой access на access целевого пользователя в рамках тенанта.

## Пагинация

```
GET /resources?page=1&page_size=50&order_by=-created_at
```

Ответ:
```json
{
  "items": [...],
  "total": 1234,
  "page": 1,
  "page_size": 50,
  "pages": 25
}
```

## Ошибки

Унифицированный формат:
```json
{
  "detail": "Human-readable message",
  "code": "module.error_key",
  "field_errors": [
    {"field": "phone", "message": "Invalid format"}
  ]
}
```

## Rate Limiting

Через `fastapi-limiter` + Redis:
- `/auth/login`, `/auth/refresh` — 5/min на IP.
- `/auth/password-reset` — 3/hour на IP.
- `/api/*` общий — 600/min на IP.
- `/public/aggregator/leads` — 60/min на партнёра.

При превышении — `429 Too Many Requests` + заголовок `Retry-After`.

## Webhook'и (исходящие)

`WebhookEndpoint` — конфигурируется в `/admin/webhooks`. События:
- `appointment.created`, `appointment.updated`, `appointment.cancelled`
- `referral.confirmed`, `referral.cancelled`
- `bonus.paid`
- `region.violation`
- `subscription.activated`, `subscription.cancelled`

POST с заголовком `X-Webhook-Signature: sha256=<hex>` (HMAC-SHA256 с shared secret). Получатель должен ответить `2xx` за 5 сек, иначе retry: 5 попыток с exponential backoff.

## Идемпотентность

POST-операции, где это критично (создание бонуса, начисление в loyalty), используют `Idempotency-Key` заголовок:
```
Idempotency-Key: uuid-v4-...
```
Дубликаты возвращают сохранённый ответ из первой попытки. Хранение ключей — 24 часа в Redis.

## Версионирование

- Public API стабилизируется через `/public/api/v1/*`.
- Internal API (`/admin/*`, `/patient/*`) меняется без deprecation — это внутренний контракт SPA.
- Breaking changes в Public API сопровождаются announce за 30 дней + период `Deprecation: true` заголовка.

## OpenAPI

Авто-генерация через FastAPI + Pydantic. Все роутеры теггированы (`tags=["telemedicine"]`). Все ответы типизированы (`response_model=...`). Все ошибки описаны (`responses={404: ...}`).

## Смотрите также

- [Dev · API endpoints (примеры)](dev-api.md)
- [API · Аутентификация — детально](api-auth-detailed.md)
- [Dev · Безопасность](dev-security.md)
