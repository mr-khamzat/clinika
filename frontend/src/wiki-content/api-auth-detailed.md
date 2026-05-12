# API: Аутентификация — детально

## Обзор механизмов

Платформа поддерживает три способа аутентификации:

1. **Пароль + JWT** — основной для пользователей (логин в кабинете).
2. **Tenant API Key** — для внешних систем тенанта.
3. **Token Exchange (RFC 8693)** — для impersonation.

Дополнительно: OTP для одноразовых операций (онбординг, подписание регламента, восстановление пароля).

## Пароль + JWT

### Хеширование

Пароли хранятся как PBKDF2-SHA256 с 600 000 итераций и 16-байтной солью. Формат в БД:

```
pbkdf2:sha256:600000$<salt_b64>$<hash_b64>
```

PBKDF2 выбран вместо bcrypt по соответствию требованиям 152-ФЗ и ГОСТ Р 34.11-2012 (рекомендация ФСТЭК).

### Получение токена

```http
POST /auth/login
Content-Type: application/json

{
  "username": "owner@example.ru",
  "password": "MyStr0ngPass!",
  "remember_me": false
}
```

Поле `username` принимает email или phone (для пациентов).

Response:

```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "refresh_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "token_type": "bearer",
  "access_expires_in": 3600,
  "refresh_expires_in": 2592000,
  "user": {
    "id": "01HF...",
    "role": "manager",
    "tenant_id": "01HF...",
    "tenant_slug": "family-clinic",
    "full_name": "Иванов И.И.",
    "redirect_url": "/family-clinic/manager"
  }
}
```

### Структура JWT

Header:

```json
{ "alg": "HS256", "typ": "JWT" }
```

Payload:

```json
{
  "sub": "01HF...",
  "tenant_id": "01HF...",
  "role": "manager",
  "scopes": ["referrals:read", "referrals:write"],
  "iat": 1715414400,
  "exp": 1715418000,
  "jti": "01HF...",
  "imp": null
}
```

Поле `imp` (impersonation) — если присутствует, содержит UUID настоящего пользователя.

### Refresh

```http
POST /auth/refresh
Authorization: Bearer <refresh_token>
```

Response — новая пара access + refresh. Refresh-токен **rotates** при каждом использовании: предыдущий становится невалидным.

### Logout

```http
POST /auth/logout
Authorization: Bearer <access_token>
```

Помещает токен в blacklist Redis до его естественного истечения. Также инвалидирует refresh-токен.

## Tenant API Key

### Создание

В кабинете super_admin:

```http
POST /tenant/api-keys
Authorization: Bearer <super_admin_jwt>

{
  "tenant_id": "01HF...",
  "name": "Aggregator SberZdorovie",
  "scopes": ["referrals:read", "referrals:write", "patients:read"],
  "expires_at": "2027-01-01T00:00:00Z"
}
```

Response:

```json
{
  "id": "01HF...",
  "name": "Aggregator SberZdorovie",
  "key": "tk_live_abc123...xyz",
  "key_prefix": "tk_live_abc",
  "scopes": [...],
  "created_at": "...",
  "expires_at": "..."
}
```

**Внимание:** полный ключ возвращается **один раз**. В БД хранится только хеш. Сохраните ключ в надёжное хранилище сразу.

### Использование

```bash
curl https://клиниксеть.рф/api/v1/referrals \
  -H "X-Api-Key: tk_live_abc123..."
```

### Scopes

Список доступных scopes:

```
referrals:read
referrals:write
patients:read
patients:write
appointments:read
appointments:write
clinics:read
webhooks:write
aggregator:write
```

Эндпоинт проверяет нужный scope. При отсутствии — 403.

### Отзыв

```http
DELETE /tenant/api-keys/{id}
```

Сразу инвалидирует ключ. Активные запросы с ним получат 401 при следующем запросе.

## Token Exchange (RFC 8693)

Используется для impersonation: super_admin или franchise_owner входит «от имени» нижестоящего пользователя.

```http
POST /impersonation/exchange
Authorization: Bearer <super_admin_jwt>
Content-Type: application/json

{
  "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
  "subject_token": "<super_admin_jwt>",
  "subject_token_type": "urn:ietf:params:oauth:token-type:access_token",
  "audience": "user:01HF...",
  "scope": "manager:read"
}
```

Response:

```json
{
  "access_token": "<impersonated_jwt>",
  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token",
  "token_type": "Bearer",
  "expires_in": 1800,
  "scope": "manager:read"
}
```

Все действия в режиме impersonation:

- Помечаются в audit_log с `imp_by: <super_admin_id>`.
- Не могут выполняться destructive операции (DELETE на пациентов и т.д.) если только super_admin не дал явное `scope=full`.
- Сессия максимум 30 минут.

## OTP

Одноразовый код по SMS/Telegram. Используется в:

- Регистрация франшизы
- Восстановление пароля
- Подписание регламента
- Подтверждение критической операции (смена email)

### Запрос

```http
POST /auth/otp/request
Content-Type: application/json

{ "phone": "+79001234567", "purpose": "password_reset" }
```

Response:

```json
{
  "session_id": "01HF...",
  "expires_in": 600,
  "channel": "sms"
}
```

### Подтверждение

```http
POST /auth/otp/verify

{
  "session_id": "01HF...",
  "code": "423817"
}
```

Параметры OTP:

- Длина: 6 цифр
- TTL: 10 минут
- Макс попыток: 5
- Lockout после 5 попыток: 30 минут на phone

## Безопасность

### Brute-force защита

Многослойная защита `/auth/login`:

- **Per-IP rate-limit** (`fastapi-limiter`): 20 попыток с одного IP за минуту → `429 Too Many Requests` + cooldown.
- **Per-user lockout** (с 2026-05-12): после **5 подряд неудачных** попыток входа в конкретную учётку → `423 Locked` на **15 минут**. Реализован Redis-счётчиком `login_lockout:{username}` с TTL, который сбрасывается при первом успешном входе. Это закрывает сценарий распределённого brute-force через ботнет, когда per-IP лимит обойти легко.
- **IP blacklist**: при 100 попытках с одного IP за час → IP в blacklist на 24 часа.

Пример 423-ответа:

```http
HTTP/1.1 423 Locked
Content-Type: application/json

{
  "detail": "Аккаунт временно заблокирован после 5 неудачных попыток. Повторите через 837 сек."
}
```

Если Redis недоступен — per-user lockout мягко отключается (лог `lockout check failed`), чтобы не положить логин при инфра-сбое. Per-IP лимит при этом продолжает работать.

### CSRF

REST API stateless, использует Bearer токен в заголовке — CSRF не релевантен. Для веб-приложения cookies не используются для аутентификации.

### Headers safety

При логине устанавливаются:

```
Strict-Transport-Security: max-age=63072000
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
```

## Связанные статьи

- [API Reference](/wiki/api-reference)
- [Безопасность](/wiki/concepts-security)
- [Гл. 1: Платформа](/wiki/chapter-1-platform)
- [Гл. 2: Onboarding (OTP)](/wiki/chapter-2-onboarding)
