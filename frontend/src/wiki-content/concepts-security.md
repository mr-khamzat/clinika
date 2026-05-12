# Безопасность и 152-ФЗ соответствие

## Аутентификация

### JWT с ротацией секретов
- **Access token**: 30 минут
- **Refresh token**: 30 дней с ротацией при использовании
- **Patient session token**: 365 дней
- **Patient direccion token**: 90 дней

При старте backend проверяет `SECRET_KEY`, `QR_SECRET`, `WEBHOOK_API_KEY` на маркеры `change-in-production`, `change-me` и т.п. — **отказывается стартовать** если найдены дефолты в продакшне.

### Пароли
- `bcrypt` или `PBKDF2-SHA256 260 000 iterations`
- Forgot/Reset password flow с одноразовыми токенами (sha256 хэш в БД, expires_at 1 час)
- Rate-limit на `/auth/login`: 20 запросов / минута / IP

### Per-user brute-force lockout (2026-05-12)

К per-IP rate-limit добавлена **per-username блокировка**: Redis-счётчик `login_lockout:{username}` с TTL=15 минут. После **5 подряд неудачных** попыток по одной учётке → backend возвращает `423 Locked` с указанием оставшегося времени:

```
HTTP/1.1 423 Locked
{"detail": "Аккаунт временно заблокирован после 5 неудачных попыток. Повторите через 837 сек."}
```

Счётчик инкрементируется через `INCR` (атомарно) с установкой TTL при первой неудаче. **Сбрасывается** при успешном входе. Если Redis недоступен — lockout мягко отключается (логируется warning), чтобы не положить логин при инфра-сбое.

Цель — защита от распределённого brute-force: атакующий не может обойти per-IP лимит, размазав попытки по ботнету, если он целится в одну учётку.

## Защита публичных форм (2026-05-12)

### Rate-limit на public endpoints

Per-endpoint sliding-window rate-limit на Redis (с in-memory fallback) для public-форм без авторизации:

| Endpoint | Лимит | Назначение |
|---|---|---|
| `POST /contact/` | 5 запросов / 10 мин / IP | Контактная форма + рассылка |
| `POST /public/{slug}/book` | 10 запросов / 10 мин / IP | Онлайн-запись |

При превышении — `429 Too Many Requests` + заголовок `Retry-After: 600`. Реализация — `app/utils/rate_limit.py`, dependency `rate_limit_dep(bucket, limit, window)`.

### Honeypot `website_url`

В 4 публичных формах (ContactModal, CtaNewsletter, Franchise, OnlineBooking → StepContacts) добавлено скрытое поле `website_url` (display:none + tabindex=-1). Человек его не заполняет, а боты, прошедшие по DOM, заполняют все поля автоматически — backend возвращает `403 Forbidden`. Капчи (hCaptcha) пока нет — она в roadmap.

## RBAC и tenant isolation

### Роли (11)
- `super_admin` — глобальный доступ
- `franchise_owner` — владелец франшизы, все клиники сети
- `manager` — управляющий (опционально с clinic_id для scope)
- `doctor`, `reg`, `nurse` — внутри клиники
- `recruiter` — управление партнёр-врачами
- `partner_doctor`, `visiting_doctor` — внешние
- `acquisition_manager` — менеджер привлечения
- `patient` — ЛК пациента

### Tenant isolation
Каждый запрос пользователя устанавливает `app.tenant_id` в PG-сессию через **параметризованный** `set_config('app.tenant_id', :tid, true)` (эквивалент `SET LOCAL`, но с bind-параметром). Все queries фильтруются по `tenant_id = current_user.tenant_id`.

Для manager со `clinic_id` — дополнительный фильтр по `clinic_id` в 8+ endpoints.

> **SQL-injection fix (2026-05-12).** Ранее `tenant_id` подставлялся в SQL через f-string, что давало теоретическую возможность инъекции, если бы значение когда-либо просочилось из user-input. Заменено на bind-параметр через `set_config()` — функционально эквивалентно `SET LOCAL`, но безопасно. См. `backend/app/database.py:get_db_for_tenant`.

## Аудит

Все важные действия логируются в `audit_log`:
- `auth.login_success/failed`
- `password.reset.success`
- `impersonation.started/stopped`
- `referral.created/confirmed/cancelled`
- `bonus.cancelled`
- `module.enabled/disabled`
- `api_key.created/revoked`
- `patient.data_exported/forgotten`

Каждая запись содержит actor, target, before/after diff, IP, user-agent.

## Region Lock

GeoIP-based блокировка по странам / регионам. Manual block с IP-allowlist + причинами.

## 152-ФЗ соответствие

### Согласия (consent versioning)
- `ConsentRecord` хранит подтверждения с версией политики
- POLICY_VERSION="1.0" при изменении документа — пользователь должен подтвердить заново

### Право на удаление (ст. 21)
- `DELETE /patient/forget-personal-data` (через patient session)
- Анонимизирует PatientAccount + связанный User
- Отзывает все sessions
- Audit `patient.data_forgotten`
- В UI: 3-шаговое подтверждение (ввести «УДАЛИТЬ»)

### Право на экспорт (ст. 14)
- `GET /patient/export-personal-data?format=json` — JSON-файл со всеми данными
- Включает: профиль, consents, направления, приёмы, бонусы, семью, AI-диалоги, документы

### IP-хеширование
Реклама (`ad_events`) хранит `ip_hash` (SHA-256), не raw IP.

## Бэкапы

- Ежедневно 03:00 МСК через cron под root
- **GPG-шифрование** через `/etc/clinika-backup.env` (ENCRYPT_PASSPHRASE)
- Файлы: `clinika-db-*.sql.gz.gpg`
- **Test-restore еженедельно** — поднимает временный PG, восстанавливает свежий бэкап, проверяет таблицы

## Security headers (nginx)

- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(self), microphone=(self), geolocation=(self)`
- `Content-Security-Policy` — ограничивает script-src / style-src / connect-src

TLS 1.2/1.3 only, HTTP/3 + QUIC включены.

## Supply-chain hygiene

Зависимости обновляются регулярно. Ключевые bumps текущего цикла (2026-05-12):

| Пакет | Было | Стало | Что закрыто |
|---|---|---|---|
| `fastapi` | 0.111.0 | 0.115.14 | Starlette **CVE-2024-47874** (path traversal) |
| `pydantic` | 2.7.1 | 2.10.6 | DoS через deeply nested JSON |
| `pydantic-settings` | 2.3.0 | 2.7.1 | Совместимость с pydantic 2.10 |
| `sentry-sdk` | 2.18.0 | 2.20.0 | Багфиксы |
| `uvicorn` | 0.30.0 | 0.32.1 | Минорные патчи |
| `sqlalchemy` | 2.0.30 | 2.0.36 | Патчи |
| `httpx` | 0.27.0 | 0.27.2 | Остались на 0.27.x (0.28 ломает TestClient API) |
| `jinja2` | (транзитивно) | 3.1.4 (явно) | Фиксация версии |

Backend-образ дополнен `pytest` для smoke-тестов в CI.

## Связанные статьи

- [Multi-tenancy](/wiki/concepts-multi-tenancy)
- [API: Аутентификация](/wiki/api-auth-detailed)
- [Region Lock](/wiki/concepts-region-lock)
- [Changelog](/wiki/changelog)
