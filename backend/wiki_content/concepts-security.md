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
- Rate-limit на `/auth/login`: 5 запросов / минута

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
Каждый запрос пользователя устанавливает `app.tenant_id` SET LOCAL в PG-сессию. Все queries фильтруются по `tenant_id = current_user.tenant_id`.

Для manager со `clinic_id` — дополнительный фильтр по `clinic_id` в 8+ endpoints.

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
