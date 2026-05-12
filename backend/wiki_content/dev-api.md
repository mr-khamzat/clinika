# API endpoints

Backend публикует REST API на `/api/*`. OpenAPI-схема: `https://клиниксеть.рф/api/openapi.json` (или `/api/docs` для Swagger UI).

## Аутентификация

JWT Bearer в заголовке `Authorization: Bearer <access_token>`.

- `POST /auth/login` — username + password → `{access_token, refresh_token}`. Лимит 5/мин.
- `POST /auth/refresh` — `{refresh_token}` → новые токены.
- `POST /auth/logout` — отзыв refresh.
- `POST /auth/telegram` — вход через Telegram Mini App (initData с подписью).
- `POST /auth/invite/info` + `POST /auth/invite/register` — регистрация по приглашению.

Access живёт 1 час, refresh — 30 дней (rotation при использовании).

## Роли (RBAC)

`super_admin > franchise_owner > manager > registry_admin/recruiter/doctor/nurse > patient`

Override прав на уровне тенанта — таблица `tenant_permission_overrides`.

## Часто используемые эндпоинты

### Пациенты и медкарта
- `GET/POST /patients` — список, создание
- `GET /patients/{id}/medcard` — медкарта (доступ по audit log)
- `POST /patients/search` — поиск по ФИО/телефону

### Направления
- `POST /referrals` — создать
- `POST /referrals/confirm-by-code` — подтвердить по короткому коду
- `POST /referrals/scan` — подтвердить по QR

### Запись на приём
- `GET /clinics/{id}/schedule` — слоты на дату
- `POST /appointments` — записать
- `PATCH /appointments/{id}` — перенос/отмена

### МИС (Renovatio)
- `GET /mis/doctors` — врачи из МИС
- `GET /mis/patients/search?q=...` — поиск пациента в МИС
- `POST /mis/sync` — ручной запуск синхронизации (только super_admin/manager)

### Аудит и Region Lock
- `GET /audit/log?days=30` — лента аудита
- `GET /audit/by-tenant-geo` — гео-аудит по тенантам
- `GET /audit/region-violations` — нарушения регионов
- `POST /admin/franchises/{id}/block` + `/unblock` — manual-блок
- `POST /admin/franchises/{id}/ip-allowlist` — добавить IP в whitelist

### Биллинг
- `GET /admin/tenants/{id}/subscription` — подписка тенанта
- `POST /admin/tenants/{id}/subscription` — создать/изменить
- `GET /billing/ledger` — реестр операций

### Платные модули
- `GET /admin/modules/catalog` — все модули с ценами
- `POST /admin/tenants/{id}/modules/{key}/subscribe` — подключить модуль
- `DELETE /admin/tenants/{id}/modules/{key}` — отключить

### Telemedicine
- `POST /telemed/sessions` — создать сессию
- `GET /telemed/sessions/{id}` — статус
- `WS /presence/ws` — сигналинг WebRTC
- `GET /presence/ice-config` — ICE-конфиг (HMAC)

## Webhooks

`WebhookEndpoint` — конфигурируется в `/admin/webhooks`. Поддерживаемые события:
- `appointment.created`, `appointment.updated`
- `referral.confirmed`, `referral.cancelled`
- `bonus.paid`
- `region.violation`

POST с подписью HMAC-SHA256 в заголовке `X-Webhook-Signature`.

## Лимиты и rate-limit

- `/auth/login` и `/auth/refresh` — 5/мин на IP
- `/api/*` (общие) — 600/мин на IP
- `/integrations/*` — без лимита (для интеграций)

## Смотрите также

- [Dev · Технический стек](dev-stack.md)
- [Dev · Интеграции](dev-integrations.md)
