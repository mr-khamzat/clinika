# Финальный аудит КлиникСеть — 2026-05-11

**Аудитор:** Claude Opus 4.7 (security architect + senior engineer)
**Сервер:** 212.57.118.126 (Ubuntu 24.04, Docker compose stack)
**Стэк:** FastAPI 0.111 + SQLAlchemy 2.0 async + PostgreSQL 16 + Redis 7 + React 18 + Vite 5
**Текущий Alembic head:** `health_module01` (97 миграций, single head)
**Контейнеры:** `clinika-backend`, `clinika-frontend`, `clinika-db`, `clinika-redis`, `clinika-bot`, `clinika-docker-proxy` + monitoring stack — все `restart: always`, все healthy.

---

## Executive Summary

КлиникСеть — большая, зрелая SaaS-платформа (~76k LOC backend Python, ~105k LOC frontend JSX, 141 таблица БД, 791 endpoint, 34 React-роута). Все 10 глав + Здоровье+ модуль реализованы и интегрированы. Архитектура многотенантная (PostgreSQL `SET LOCAL app.tenant_id` + RLS), коммерческие модули продаются через `tenant_module_subscriptions` с правильным gating через `require_module(...)`.

**Готовность к запуску: ~85%.** Блокирующих архитектурных проблем нет. SECRET_KEY — 50 chars, JWT настроен, password hashing — bcrypt. Все 4 критических AppScheduler джоба (auto_confirm, expire_referrals, daily_invoices, disaster_health_check) запущены и работают. Backup script с шифрованием и offsite через rclone есть, тест восстановления — еженедельный cron. CSP/HSTS/X-Frame настроены на уровне nginx. Audit log пишется для impersonate/billing/regulation.

**Главные риски P0 — не блокеры запуска, но ставят его в зону хрупкости:**
1. **`/public/{slug}/book` без rate limit и без капчи** — открытая поверхность для спама/абуза при публичном запуске.
2. **`/contact/` POST без rate limit** — лендинг подвержен спаму.
3. **Outdated dependencies:** FastAPI 0.111→0.136, Starlette 0.37→1.0, Pydantic 2.7→2.13, SQLAlchemy 2.0.30→2.0.49, sentry-sdk 2.18→2.59 — есть известные security advisories.
4. **`SET LOCAL app.tenant_id` через f-string** в `database.py:72` и `deps.py:165` — теоретический SQL injection, если `tenant_id` когда-нибудь придёт не как UUID. Сейчас UUID-валидируется, но это анти-паттерн.

**Кандидаты на cleanup (не блокеры):** legacy таблицы `tenant_plugins`/`tenant_plugin_subscriptions` (заменены `commercial_modules`), плагины `mis/sms/notify` (мини-обёртки), legacy `loyalty.py` модель (старый сервис не используется, новый `loyalty_ext` повсеместно). Файл `AdminLayout.jsx` (8852 строки) — критический split candidate.

---

## Findings — Backend

### Critical (P0) — блокеры запуска
Их нет. Все формально-критичные проверки пройдены: backup, restart-policy, audit_log, RBAC, healthcheck, миграции single head, JWT secret 50+ chars.

### High (P1)

**P1-B1. Public-booking без rate limit / captcha.**
`backend/app/routers/public_booking.py:192` — `@router.post("/{slug}/book")` создаёт `Appointment` без авторизации и без rate-limit. Никаких ограничений по IP/телефону. Минимум: `RateLimiter(times=5, seconds=300)` на endpoint + soft-капча (hCaptcha invisible или honeypot-поле). Можно усилить — лимит «1 запись в час на телефон».

**P1-B2. Contact form без rate limit.**
`backend/app/routers/contact.py:27` — `@router.post('/')` пишет в БД без ограничений. Спам-боты найдут за день. `RateLimiter(times=3, seconds=600)` + honeypot.

**P1-B3. SET LOCAL через f-string.**
`backend/app/database.py:72`: `await session.execute(text(f"SET LOCAL app.tenant_id = '{tenant_id}'"))` и аналогично в `core/deps.py:165`. PostgreSQL не поддерживает параметры в `SET LOCAL`, поэтому строковая конкатенация технически нужна — но в коде нет защиты от того, что в `tenant_id` придёт не-UUID. Минимум: явно `str(uuid.UUID(tenant_id))` перед интерполяцией (бросит ValueError на инъекцию).

**P1-B4. Устаревшие зависимости с security advisories.**
FastAPI 0.111 → 0.136 (есть CVE по `python-multipart`); Starlette 0.37 → 1.0; Pydantic 2.7 → 2.13; SQLAlchemy 2.0.30 → 2.0.49; sentry-sdk 2.18 → 2.59. Рекомендую закрепить обновление через `pip-compile`. После апдейта прогнать `pytest`.

**P1-B5. Test runner не работает.**
`docker exec clinika-backend pytest` → "No module named pytest". В production-image его и не должно быть, но в CI/dev — обязателен. Сейчас 13 тестов лежат без запуска (последний раз грин - неизвестно).

### Medium (P2)

**P2-B1. 24 FK без `ondelete=...`** (из 270 общих).
Файлы: `bonus.py`, `discount.py`, `support.py`, `doctor.py`, `push_subscription.py`, `referral_comment.py`, `service.py`, `clinic_schedule.py`, `referral.py`, `user.py`, `invitation.py`, `permission_override.py`. При удалении родительских записей упадёт IntegrityError. Рекомендую миграцию `add_ondelete_to_legacy_fks` с CASCADE/SET NULL по смыслу.

**P2-B2. Дубли loyalty: legacy не используется кодом, но модель остаётся.**
`app/models/loyalty.py` (LoyaltyAccount/LoyaltyTransaction/LoyaltyTier/LoyaltyRule/LoyaltyReward) — пишется только в `loyalty_service.py`, которым ни один роутер не пользуется. `app/routers/loyalty.py` всё ещё включён в main.py через `app.include_router(loyalty_router)`, но фронт никаких `/loyalty/*` endpoints не дёргает (только `/admin/loyalty/*` и `/patient/loyalty/*`, оба — `loyalty_ext`). Безопасно удалить роутер `loyalty.py` после grep-аудита его endpoints на отсутствие внешних потребителей (МИС?).

**P2-B3. Legacy plugin system.**
`app/plugins/{mis,sms,notify}/plugin.py` зарегистрированы в `_register_plugins()` и дёргаются из `telemedicine.py:281` (sms), `prescriptions.py:86` (mis), `main.py:724,742` (sms+notify). Это тонкий слой обёрток над фактическими сервисами. Архитектура двойная: `tenant_plugins`/`tenant_plugin_subscriptions` (legacy) + `tenant_module_subscriptions` (новая marketplace). Старые `tenant_plugins/tenant_plugin_subscriptions` таблицы пусты в БД. Кандидат на удаление в отдельной миграции (после переключения `prescriptions.py` и `telemedicine.py` на прямые сервисы).

**P2-B4. Patient documents — 3 системы.**
`/patient/documents/*` (`patient_documents.py`, staff upload), `/patient/health-documents/*` (`patient_documents_v2.py`, патиент-центричное хранилище из Гл.9), `doctor_patient_documents.py` (врач→пациент). Разделение задокументировано, но из UX-перспективы — пользователь не различает их. Долгосрочно — мерж в единый `document_service` + role-based фильтрация.

**P2-B5. N+1 query risk.**
`grep selectinload/joinedload` по `backend/app/` дал 0. SQLAlchemy 2.0 async по умолчанию ленится; 73 `relationship(...)` в моделях. Конкретные риски в `routers/admin.py` (выгрузка списка тенантов + plugins + modules + license + branding отдельными запросами), `routers/franchise_owner_clinics.py`. Перформанс-аудит на 100+ тенантов покажет N+1 в swagger логах.

**P2-B6. `main.py` 1717 строк.**
Внутри — все scheduler jobs inline. Рекомендую вынести `app/jobs/scheduler_jobs.py` (уже есть пустая директория `app/jobs/`).

**P2-B7. Pool size = 10 + overflow = 20.**
На 2-3 тенанта избыточно, но при росте до 20+ тенантов с активным трафиком — мало. Прогноз ёмкости: каждый WebSocket (presence/calls) держит соединение → 30 — это потолок при ~30 одновременно онлайн пользователей. Поднять до `pool_size=20, max_overflow=40` после первого запуска.

### Low (P3)
- 115 закомментированных строк в `main.py` — нормально для документации scheduler-логики.
- Прямое использование `time.sleep` / `requests` в async коде не найдено (хорошо).
- Pagination: 404 GET endpoints — почти везде есть `limit/offset`, но не везде `response_model` для типизации (не критично).
- 791 endpoint vs ~150 в frontend grep — есть unused REST endpoints для будущего публичного API.

---

## Findings — Frontend

### Critical (P0)
Их нет.

### High (P1)

**P1-F1. `pages/AdminLayout.jsx` — 8852 строки.**
Один файл — точка отказа разработки и сборки. Уже выделены lazy-секции (40+), но roots остались. Минимум — вынести `RootRedirect`/`AdminMenu`/`AdminTopBar` в отдельные модули, маршруты — в `routes/admin.jsx`. Это снизит initial bundle для admin-cabinet.

**P1-F2. Папка `node_modules` внутри `frontend/src/`.**
`/opt/clinika/frontend/src/node_modules/` — 22M, содержит `esbuild/@esbuild`. Это лежит в репозитории (не в `.gitignore`-границах, т.к. `.gitignore` фильтрует только верхне-уровневую `node_modules/`). Скорее всего, побочный эффект `npm install` внутри `src/`. Добавить `src/**/node_modules` в .gitignore и удалить из git tree.

**P1-F3. `dangerouslySetInnerHTML` без санитайзера.**
`PlatformAISection.jsx:457, 493` — два места, где `renderMarkdown(...)` идёт прямо в DOM. Комментарий в файле сам признаёт XSS-риск, но не исправлен. AI-ответ может содержать `<script>` (Gemini вернёт строку). Обернуть в `DOMPurify.sanitize(...)` как уже сделано в `WikiSection.jsx:402`.
`WikiViewer.jsx:277` — формально использует `sanitize(...)` обёртку, проверить что это DOMPurify (не голый pass-through).

### Medium (P2)

**P2-F1. Unused frontend файлы (безопасные кандидаты на удаление).**
- `sections/AIAnalyticsSection.jsx`
- `sections/PatientLabResultsSection.jsx`
- `sections/RequisitesSection.jsx`
- `components/ReferralCard.jsx`
- `components/ResponsiveTable.jsx`
- `components/TrialBanner.jsx`

(подтверждено `grep -r "import.*Name"`)

**P2-F2. Большие файлы (split candidates).**
- `pages/PatientCabinet.jsx` (3721)
- `pages/FranchiseOwnerCabinet.jsx` (2579)
- `pages/PatientCabinetPreview.jsx` (2373)
- `pages/OperationalCabinet.jsx` (2229)
- `pages/Landing.jsx` (1920)
- `pages/DoctorLayout.jsx` (1370)
- `sections/AdsSection.jsx` (1491)
- `sections/ManagerSubscriptionCashSection.jsx` (1291)
- `sections/AuditLogSection.jsx` (1249)
- `sections/AISection.jsx` (1075)
- `sections/BillingLedgerSection.jsx` (1030)
- `pages/onboarding/OnboardingWizard.jsx` (1034)

Не блокер запуска, но техдолг — постоянный замедлитель новых фич.

**P2-F3. 7 `console.log/console.error`** в production-коде.
Не критично, но желательно удалить или заменить на Sentry breadcrumbs.

### Low (P3)
- 38 роутов в App.jsx — все имеют рабочий lazy-import (выборочно проверены).
- `config.js` с per-tenant `API_BASE` — архитектурно правильно.
- Hardcoded URL не найдены.

---

## Module Interconnections

| Модуль | Интегрирован с | Триггер / Метод |
|--------|---------------|------------------|
| Loyalty (lp_ext) | Appointments | `appointments.py:169` award_appointment на completion |
| Loyalty (lp_ext) | Referrals | `referral_service.py:217` award_referral на success |
| Loyalty (lp_ext) | Visiting doctor | `visiting_doctor.py:275` award на завершение визита |
| Loyalty (lp_ext) | Integrations | `integrations.py:104` award из МИС-синка |
| Subscription Здоровье+ | Appointments | `scheduling.py:371` `compute_discount_for(...)` в book_slot — discount_percent/amount пишутся в Appointment |
| Subscription Здоровье+ | Aggregator | `aggregator_service.py` использует префикс ключа подписки |
| Marketplace gating | Webhooks | `require_module("webhooks")` на всех CRUD |
| Marketplace gating | Loyalty pro | `require_module("loyalty_pro")` на admin endpoints |
| Marketplace gating | Telemedicine/SMS/AI/Calls/Inventory | через `require_module` |
| Audit log | Impersonation | `audit_service.write_safe(...)` в `impersonation.py:224,323` |
| Audit log | Admin actions | `admin.py:1717,1762,1861,1894` write_safe |
| Audit log | Public API v1 | `public_api_v1.py:26,35` |
| Welcome email | Signup wizard | `onboarding_service.py:465` send_welcome_email |
| Welcome email | Manager invite | `franchise_owner_clinics.py:498` send_welcome_email_to_manager |
| Cron — daily | franchise_invoice (2:00), daily_invoices (0:00), audit_archive (3:00), inventory_alerts (9:00), ads_attribution/health (4:30/4:00), ltv_recompute (4:00), daily_digest (6:00), module_daily_digest (6:00) |
| Cron — monthly | subscription_monthly_supply (1-е число 3:00) |
| Cron — weekly | geoip_update (Mon 3:00) |
| Cron — interval | auto_confirm (10m), referrals expire (1h), plugin_renewal (6h), module_expiry (1h), trial_expiring/expired (6h/1h), webhook_queue (1m), sms_campaign (1m), transcription (2m), referral_reminders (1h), heartbeat (1h), health_watchdog (5m), disk_check (60m), module_health_check (30m), disaster_health_check (5m), password_reset_cleanup (1h) |

**Все критичные cron jobs зарегистрированы.** Disaster health check каждые 5 минут — отличная защита.

---

## Dead Code / Cleanup Candidates

### Backend (Python)
- `app/routers/loyalty.py` — legacy router, фронт не зовёт. Кандидат на удаление после grep по внешним МИС-плагинам.
- `app/services/loyalty_service.py` — не импортируется никем.
- `app/models/loyalty.py` — `LoyaltyAccount`, `LoyaltyTransaction`, `LoyaltyTier`, `LoyaltyRule`, `LoyaltyReward` — пишутся только в legacy service. Если удаляется loyalty.py — пометить таблицы `loyalty_accounts/transactions/tiers/rules/rewards` на удаление в миграции.
- `app/plugins/{mis,sms,notify}/plugin.py` — тонкие обёртки. После рефакторинга `telemedicine.py:281` и `prescriptions.py:86` на прямой вызов сервисов — удалить.
- `app/models/tenant.py` `TenantPlugin` (легаси) — таблица пуста. Удалить вместе с роутером `admin.py:184, 405-416`.
- `app/models/billing.py` `TenantPluginSubscription` — табл пуста, заменена `tenant_module_subscriptions`.
- `app/plugins/reviews/` — отдельный legacy reviews plugin (зарегистрирован в `main.py:1620`).

### Frontend (JSX)
- `sections/AIAnalyticsSection.jsx`
- `sections/PatientLabResultsSection.jsx`
- `sections/RequisitesSection.jsx`
- `components/ReferralCard.jsx`
- `components/ResponsiveTable.jsx`
- `components/TrialBanner.jsx`
- `src/node_modules/esbuild` (мусор от случайного npm install в src/)

### Database (пустые таблицы — оставить как есть пока новых тенантов мало)
141 таблица, ~76 пустые — это нормально для стартующего продукта.

### Backup files
- `/opt/clinika/.env.bak.glava8` — старая копия .env. Удалить после ревью.

---

## Security Audit — OWASP Top 10 + клинико-специфичные

| Контроль | Статус | Деталь |
|----------|--------|--------|
| A01 Broken Access Control | OK | RBAC через `require_super_admin/require_admin/require_module/require_feature`, `current_user` deps в 757/795 endpoints |
| A02 Cryptographic Failures | OK | SECRET_KEY 50 chars, bcrypt PBKDF2, JWT с явным алгоритмом, TURN_SECRET 64 chars |
| A03 Injection (SQLi) | WARN | `SET LOCAL app.tenant_id = '{uuid}'` через f-string в 2 местах — нужен явный `str(uuid.UUID(...))` |
| A03 Injection (XSS) | WARN | `PlatformAISection.jsx:457,493` без DOMPurify (AI-ответ) |
| A04 Insecure Design | OK | Multi-tenant с RLS, audit log на critical actions |
| A05 Security Misconfiguration | OK | CORS закрыт списком, CSP/HSTS/X-Frame через nginx, `restart: always` на всех контейнерах |
| A06 Vulnerable Components | WARN | FastAPI/Starlette/Pydantic/sentry-sdk требуют обновления |
| A07 Auth Failures | OK | login limiter 20/min, forgot-password 3/min, reset 5/min, confirm-code 5/min |
| A08 Software/Data Integrity | OK | Backups зашифрованы (GPG), offsite через rclone, weekly restore test |
| A09 Logging Failures | OK | Sentry, audit_log с архивированием (cron 3:00), telegram alert на 5xx |
| A10 SSRF | OK | Не нашёл внешних URL без validate (МИС через config) |
| **Clinic-specific** | | |
| PHI шифрование at rest | PARTIAL | Backup GPG + Postgres pg_data только; в TLS in-transit |
| Patient consent log | OK | `consent_records` модель + `ConsentForm.jsx` |
| Audit log immutability | OK | append-only, архивирование |
| GDPR-Right to be forgotten | NOT DOCUMENTED | endpoint не найден — нужно для будущего |
| Region lock | PRESENT | Геокарта реализована, флаги в памяти проекта |

**Чек-лист:**
- [x] HTTPS обязателен (HSTS max-age=31536000)
- [x] Rate limit на /auth/login (20/min)
- [x] Rate limit на /auth/forgot-password (3/min)
- [ ] Rate limit на /public/{slug}/book — **отсутствует**
- [ ] Rate limit на /contact — **отсутствует**
- [x] Password hashing — bcrypt
- [x] CORS — закрыт списком
- [x] CSP — настроен
- [x] X-Frame-Options — SAMEORIGIN
- [x] Audit log на impersonate/billing/regulations
- [x] Backup script + offsite + restore test (weekly)
- [ ] Pip dependencies — устарели (P1-B4)
- [x] Docker restart: always
- [x] SECRET_KEY ≥ 32 chars

---

## Performance Hotspots — топ-10

1. **`pages/AdminLayout.jsx` (8852 LOC)** — гарантированный slowdown initial load admin. Split нужен.
2. **`/admin/tenants` list** — JOIN на 5 таблиц без selectinload. На 50+ тенантов — N+1.
3. **`/admin/loyalty/leaderboard`** — нужен `LIMIT 100` + индекс `(tenant_id, points DESC)`.
4. **WebSocket presence** — каждое соединение держит DB session; pool_size=10 → ограничение ~30 онлайн.
5. **`ledger_entries` без партиционирования** — растёт линейно. Партиционирование по `year_month` после 100k rows.
6. **`activity_log`** — то же; cron `audit_archive` (3:00) делает архив, но активная таблица растёт.
7. **`SET LOCAL app.tenant_id`** на каждом `get_db()` — overhead 1ms × 791 endpoint × N rps. Можно через `PreparedStatement`.
8. **PDF generation (weasyprint)** — синхронно блокирует event loop. Вынести в `asyncio.to_thread` или Celery.
9. **`/patient/lab/results`** — пагинации нет в части endpoints (выборочно).
10. **Frontend bundle** — main JS пока не split полностью (последний коммит 6d70398 это начал).

---

## Recommendations

### Запуск (must do before launch)
1. **P1-B1 + P1-B2**: добавить RateLimiter на `/public/{slug}/book` (5/300s) и `/contact/` (3/600s) + invisible captcha.
2. **P1-B3**: `str(uuid.UUID(tenant_id))` обёртка перед `SET LOCAL` в `database.py:72` и `core/deps.py:165`.
3. **P1-F2**: убрать `frontend/src/node_modules/` из git и добавить в `.gitignore`.
4. **P1-F3**: DOMPurify обёртка в `PlatformAISection.jsx:457,493`.
5. **P1-B5**: добавить `pytest` в dev-зависимости, прогнать 13 тестов хотя бы локально.
6. Удалить `/opt/clinika/.env.bak.glava8` (потенциальная утечка old SECRET_KEY).

### 30 дней после запуска (early optimisation)
1. **P1-B4**: обновить FastAPI/Starlette/Pydantic/sentry-sdk до последних в окне одного спринта.
2. **P2-B1**: миграция `add_ondelete_to_legacy_fks` (24 FK).
3. **P2-B6**: вынести scheduler jobs из `main.py` в `app/jobs/scheduler_jobs.py`.
4. **P1-F1**: декомпозировать `AdminLayout.jsx` (8852 → 5 файлов).
5. Удалить 6 unused frontend файлов и 6 dead frontend components.
6. Решить судьбу legacy loyalty: удалить router/service/модели + миграция `drop_legacy_loyalty_tables`.

### 90 дней (scale prep)
1. **P2-B5**: добавить `selectinload`/`joinedload` в hot paths (admin.py, franchise_owner_clinics.py).
2. **P2-B7**: повысить DB pool до 20+40 при росте ≥ 10 активных тенантов.
3. Партиционирование `ledger_entries`/`activity_log` по `year_month`.
4. Удалить legacy plugin system (mis/sms/notify) + `tenant_plugins` таблицы.
5. Перенести weasyprint PDF в `asyncio.to_thread` или фоновый worker.
6. Реализовать GDPR right-to-be-forgotten endpoint.

---

## Statistics

- **Backend Python files:** 344 (LOC: 76,733)
- **Frontend JSX/JS files:** 289 (LOC: 105,502)
- **Endpoints:** 791 (GET 404 / POST 256 / PUT 15 / DELETE 50 / PATCH 66)
  - С auth check: 757
  - Без auth (public): 34 (public_booking, public_clinic, public_aggregator, public_api_v1 — с tenant_api_key, public_onboarding — с OTP, portal)
- **Models / DB tables:** 80 моделей → 141 таблица в БД
- **Sections (frontend):** 85
- **Components:** 82
- **Pages:** 66
- **Roots routes:** 34
- **Migrations:** 97, single head `health_module01`
- **Cron jobs:** 30 зарегистрировано
- **Backend tests:** 13 (test_*.py), runner не установлен в production-image
- **Frontend dependencies:** 20 prod + 5 dev
- **Backend dependencies (outdated):** 24 пакета имеют обновления, ~5 с security advisories

---

## Заключение

**Проект готов к тихому B2B-запуску** после устранения P1-блокеров (rate limit на public booking/contact, SET LOCAL обёртка, удаление node_modules из репозитория, DOMPurify в 2 местах). Архитектурно — здоровый: миграции упорядочены, multi-tenant работает, marketplace gating сработан правильно, cron-задачи покрывают expire/renewal/audit/disaster, backups шифруются и тестируются.

Главный технический долг — frontend файлы-монстры (AdminLayout 8852 LOC, PatientCabinet 3721) и устаревшие pip-зависимости. Это не блокирует запуск, но замедляет каждую следующую фичу. Запланировать в первый пост-запусковой спринт.

Безопасность OWASP — 8/10 (минус устаревшие зависимости и 2 XSS-точки в AI-секции).

— Claude Opus 4.7, 2026-05-11
