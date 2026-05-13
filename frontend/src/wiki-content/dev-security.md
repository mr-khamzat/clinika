# Безопасность

Меры безопасности КлиникСеть на разных уровнях: транспорт, аутентификация, авторизация, изоляция данных, защита от атак.

## Транспорт

- HTTPS only. HTTP редиректится на HTTPS на nginx-уровне.
- TLS 1.2+ (1.0/1.1 запрещены).
- HSTS заголовок: `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
- Сертификаты от Let's Encrypt, renewal через acme.sh / certbot.

## Аутентификация

### JWT

- Алгоритм: HS256 (HMAC-SHA256).
- Secret в `.env` (`JWT_SECRET`), минимум 32 байта random.
- Access TTL: 1 час.
- Refresh TTL: 30 дней, **rotation** при каждом использовании (старый отзывается).
- Blacklist отозванных refresh-tokens в Redis.

### Пароли

- Хеширование: bcrypt с cost=12 (через passlib).
- Минимальная длина: 12 символов (`auth.py:validate_password`).
- Запрет частых паролей (топ-100 список).
- Принудительная смена при роли super_admin / franchise_owner раз в 90 дней.

### Brute-force protection

- Rate-limit на `/auth/login`: 5/min на IP.
- Lockout: 5 неудачных попыток → блок 15 минут.
- Telegram-алерт владельцу платформы при подозрительной активности.

### OTP

- Для подписи документов и подтверждения операций.
- 6-значный код, TTL 5 минут.
- Доставка: SMS, email или Telegram.
- Лимит: 3 попытки ввода, потом новая отправка.

## Авторизация (RBAC)

Роли (hierarchy):
```
super_admin > franchise_owner > manager > 
  registry_admin / recruiter / doctor / nurse / inventory_manager
  partner_doctor / visiting_doctor / acquisition_manager
> patient
```

- Каждый router использует `Depends(require_role("manager"))` или `require_module("telemedicine")`.
- Override прав на уровне тенанта — таблица `tenant_permission_overrides`.
- Тесты `test_rbac_isolation.py` проверяют, что doctor не может выполнить action manager.

## Изоляция данных (Multi-tenancy)

- Все таблицы тенант-aware имеют `tenant_id` UUID NOT NULL + индекс.
- Все queries фильтруют по `tenant_id` явно.
- `SET app.tenant_id = '<uuid>'` в начале каждой транзакции (для potential RLS policies).
- Тесты `test_tenant_isolation*.py` — проверка cross-tenant утечек.

## Audit Log

`audit_log` фиксирует:
- action (string, e.g. `user.login`, `patient.medcard.view`, `region.violation`).
- actor_user_id, actor_ip, actor_user_agent.
- target_type, target_id.
- tenant_id, timestamp.
- payload (JSONB с деталями).

Хранение бессрочно. Доступ только super_admin через `/audit/log`.

## Region Lock

GeoIP-based мониторинг попыток работы вне разрешённого региона франшизы. См. `module-region-lock.md`. Логирует в `audit_log` action=`region.violation` + Telegram-алерт (dedup 30 мин).

## XSS / CSRF

- User-input через DOMPurify перед `dangerouslySetInnerHTML` (frontend).
- React-markdown без `rehype-raw` для пользовательских markdown'ов.
- Strict Content-Security-Policy (CSP) headers (планируется в nginx).
- CSRF — не нужен (нет cookie-auth, только Bearer JWT).
- Все ответы API: `Content-Type: application/json` (запрещает HTML injection).

## SQL Injection

- SQLAlchemy 2.0 ORM — все queries параметризованы.
- `text(...)` — только с bound параметрами (`{"tid": str(tenant_id)}`).
- Никаких string format для построения SQL.

## File Upload

- Whitelist расширений: `.jpg, .jpeg, .png, .pdf, .docx`.
- Whitelist MIME (через python-magic).
- Лимит размера: 10 MB по умолчанию.
- Хранение в `/opt/clinika/uploads/<tenant_id>/<resource>/<uuid>`.
- Антивирус (ClamAV) — TODO.

## Secrets Management

- Все секреты в `/opt/clinika/.env` (не в git).
- `JWT_SECRET`, `DATABASE_URL`, `REDIS_URL`, `AI_API_KEY`, `AI_TRANSCRIPTION_KEY`, `YOOKASSA_SECRET`, ...
- Backup-копия `.env` хранится в зашифрованном виде у владельца платформы.
- Ротация секретов раз в год (manually).

## Honeypot

Скрытые поля на формах публичных страниц (регистрация, контакты). Если бот заполнил — запрос отбрасывается с `400`. Лог в `audit_log` action=`honeypot.triggered`.

## DDoS / Rate Limit

- nginx limit_req на хосте (по IP, 10 req/s burst 20).
- fastapi-limiter на endpoints (см. `dev-api-design.md`).
- Cloudflare — пока не используется, но готовы подключить при инциденте.

## Backup security

- pg_dump хранится в `/opt/clinika/backups/` (доступ только root).
- GPG-шифрование перед заливом в облако (TODO rclone).
- При компрометации сервера — бэкапы должны быть «cold» (не доступны изнутри инстанса). TODO.

## 152-ФЗ (ПД РФ)

- Все ПД хранятся только в РФ (сервер 212.57.118.126 — РФ хостер).
- Согласие на обработку ПД — обязательно при регистрации (`AgreementConsent`).
- Право на удаление: `DELETE /patient/me` (soft-delete с обнулением ПД через 30 дней).
- Право на выгрузку: `GET /patient/me/export` — все мои данные в JSON / PDF.

## Чек-лист безопасности для разработчика

1. Не логировать пароли, JWT, секреты, ПД пациентов.
2. Не отправлять ПД в Sentry (использовать `beforeSend` для маскирования).
3. Все user-input валидировать через Pydantic schemas.
4. Все queries использовать ORM с параметрами.
5. Все endpoint'ы защищать через `require_role` или `require_module`.
6. При работе с файлами — проверять расширение, MIME, размер.
7. Логировать важные action в `audit_log`.
8. Не использовать `eval()`, `exec()`, `pickle.loads()` на user-input.

## Смотрите также

- [Концепт · Безопасность и 152-ФЗ](concepts-security.md)
- [API · Аутентификация — детально](api-auth-detailed.md)
- [Модуль · Region Lock](module-region-lock.md)
