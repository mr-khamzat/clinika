# Глава 1. Платформа и super_admin

## Цель

Дать платформе слой управления, на котором держится всё остальное: тенанты, биллинг, безопасность, доступ внешних систем. Глава 1 — это «фундамент»: без неё франшизы не появляются, модули не подключаются, аудит не пишется. Бизнес-смысл: один человек (super_admin) должен иметь возможность открыть, заблокировать или отдать платформу в работу без участия разработчиков.

## Что реализовано

- **Marketplace модулей** — каталог из 20+ платных модулей с поштучным включением для конкретного тенанта.
- **Impersonation (RFC 8693)** — безопасный вход «от имени» франчайзи без передачи их пароля. Любое действие логируется.
- **Журнал безопасности (audit_log)** — все критичные операции пишутся с IP, user-agent и дельтой изменений.
- **Tenant API Keys** — внешние системы тенанта (CRM-агрегаторы, бухгалтерия, мобильное приложение) получают доступ через API ключи с ограниченным scope.
- **Public API /api/v1/*** — стабильный публичный API с версионированием. Используется агрегаторами и подрядчиками.

## API endpoints

### Управление тенантами

```http
GET    /admin/tenants
POST   /admin/tenants
GET    /admin/tenants/{tenant_id}
PATCH  /admin/tenants/{tenant_id}
POST   /admin/tenants/{tenant_id}/suspend
POST   /admin/tenants/{tenant_id}/restore
```

Пример создания тенанта:

```bash
curl -X POST https://клиниксеть.рф/api/admin/tenants \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "ingush-med",
    "owner_email": "owner@example.ru",
    "owner_phone": "+79001234567",
    "plan": "professional",
    "trial_days": 14
  }'
```

Response:

```json
{
  "id": "01HF8X9YZA3K5N7P9R1S3T5V7W",
  "slug": "ingush-med",
  "status": "trial",
  "trial_ends_at": "2026-05-25T00:00:00Z",
  "invite_url": "https://клиниксеть.рф/invite/abc...xyz"
}
```

### Marketplace

```http
GET    /marketplace/modules
POST   /commercial/tenants/{tenant_id}/modules/{key}/enable
POST   /commercial/tenants/{tenant_id}/modules/{key}/disable
PATCH  /commercial/tenants/{tenant_id}/modules/{key}
```

Включение модуля с price override:

```bash
curl -X POST .../commercial/tenants/{id}/modules/telemedicine/enable \
  -d '{"price_override": 3990.00, "trial_days": 7}'
```

### Impersonation (token exchange RFC 8693)

```http
POST /impersonation/exchange
```

```json
{
  "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
  "subject_token": "<super_admin_jwt>",
  "subject_token_type": "urn:ietf:params:oauth:token-type:access_token",
  "audience": "tenant:ingush-med",
  "scope": "manager:read manager:write"
}
```

Response:

```json
{
  "access_token": "<impersonated_jwt>",
  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token",
  "token_type": "Bearer",
  "expires_in": 3600,
  "impersonated_by": "super_admin_uuid"
}
```

### Audit Log

```http
GET /audit/log?entity_type=tenant&action=suspended&from=2026-05-01
GET /audit/log/{entity_type}/{entity_id}
GET /audit/log/actor/{user_id}
```

### Tenant API Keys

```http
GET    /tenant/api-keys
POST   /tenant/api-keys
DELETE /tenant/api-keys/{key_id}
```

Создание ключа:

```json
{
  "name": "Aggregator SberZdorovie",
  "scopes": ["referrals:read", "referrals:write", "patients:read"],
  "expires_at": "2027-01-01T00:00:00Z"
}
```

Ключ возвращается один раз, дальше — хеш в БД.

### Public API v1

Группа `/api/v1/*` имеет стабильный контракт. Поддерживает версионирование через `Accept: application/vnd.clinikaset.v1+json`. Доступ — через Tenant API Key в заголовке `X-Api-Key`.

```http
GET  /api/v1/referrals
POST /api/v1/referrals
GET  /api/v1/patients/{phone}
GET  /api/v1/clinics
```

## Где найти в UI

`/admin` → разделы:

- Тенанты — список франшиз, статус подписки, активные модули, кнопки suspend/restore.
- Marketplace — каталог модулей, кнопка «Включить для тенанта».
- Безопасность → Audit Log — фильтры по событию, пользователю, дате.
- Безопасность → API ключи — список ключей по тенантам.
- Impersonation — кнопка «Войти как» в карточке любого пользователя.

## Backend модели

| Таблица | Описание |
|---|---|
| `tenants` | основная сущность тенанта |
| `tenant_module_subscriptions` | связка тенант↔модуль с ценой и датами |
| `audit_log` | системный журнал |
| `tenant_api_keys` | хешированные API ключи |
| `impersonation_sessions` | сессии входа «от имени» |
| `commercial_module_catalog` | каталог модулей с описанием и ценой |

## Зависимости

- Биллинг (см. [Гл. 5: концепт билинга](/wiki/concepts-billing)) — модули создают `tenant_module_subscriptions`, которые попадают в инвойсы.
- Безопасность (см. [Безопасность и 152-ФЗ](/wiki/concepts-security)) — audit log используется всеми главами.
- Onboarding (см. [Гл. 2: онбординг](/wiki/chapter-2-onboarding)) — создаёт тенант через тот же `/admin/tenants` API.

## Настройки администратора

- **Глобальные параметры платформы**: `/admin/system/settings`. Поля: имя платформы, контакты поддержки, дефолтный план, длина триала.
- **Лимиты по умолчанию**: max clinics, max users, max API rate.
- **Алерты**: Telegram канал для критических событий (suspend, security breach).
- **Disaster Mode**: ручной переключатель режима «деградации» при отказе внешних сервисов.

## FAQ

**Можно ли откатить включение модуля?** Да, через `DELETE` или `disable`. Если триал — без последствий. Если уже выставлен инвойс — корректирующая запись в ledger.

**Что происходит при suspend тенанта?** Все пользователи получают экран «Подписка приостановлена», логин блокируется кроме franchise_owner. Данные сохраняются.

**Сколько может быть super_admin?** Технически — без ограничений. Рекомендация: 2 (основной + резерв).

## Связанные статьи

- [Роль super_admin](/wiki/role-super-admin)
- [Каталог модулей](/wiki/concepts-modules)
- [Multi-tenancy](/wiki/concepts-multi-tenancy)
- [Безопасность](/wiki/concepts-security)
