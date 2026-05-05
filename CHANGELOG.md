# Changelog

История значимых изменений. Подробности в `git log`.

---

## [2026-05-05] — Инфраструктурные фиксы

- `backend/Dockerfile`: добавлен `curl` + `ca-certificates` (нужен для `download_geoip.sh`)
- `docker-compose.yml`: bind-mount `/opt/clinika/data:/app/data` — БД GeoIP переживает rebuild
- `.gitignore`: восстановлен (был испорчен), исключены `backups/`, `data/`, `*.mmdb`, `__pycache__`, `node_modules`
- README.md / CHANGELOG.md актуализированы

## [2026-05-04] — AI Knowledge, GeoIP, Franchise hierarchy, Platform sections (`705fc7c`)

### AI Knowledge Base (FAQ для AI-чата)
- Модель `AIKnowledgeEntry` + `services/ai_knowledge_service.py` (find_match через токенизацию + score, hits++)
- Pipeline `patient_chat_ai`: лимит → FAQ → Redis-cache → LLM (экономия токенов)
- `patient_chat_messages.source` — маркер источника (knowledge/cache/llm/fallback)
- UI: `AIKnowledgeSection` в FranchiseOwnerCabinet и AdminLayout
- Миграция: `a7b8c9d0e1f2_ai_knowledge`

### GeoIP в аудите
- `services/geoip_service.py` — geoip2 + maxminddb, Redis-cache 24h
- `scripts/download_geoip.sh` — dbip-city-lite (free), cron Mon 03:00 + initial download при старте
- `scripts/backfill_geo.py` — обогащение исторического `audit_log`
- `audit_log` +6 geo-полей (country/city/region/lat/lng/iso) + индекс по country
- UI: флаг страны + город в `AuditSection`, аккордеон с координатами и Яндекс-картой
- Миграция: `t6u7v8w9x0y1_audit_geoip`

### Franchise hierarchy
- Модель `Franchise(id, name, owner_user_id, branding, ...)` + `Tenant.franchise_id` FK
- Иерархия: Платформа → Франшиза → Тенанты → Клиники
- super_admin создаёт франшизы, franchise_owner создаёт тенанты внутри своей
- `/admin/franchises` CRUD + `/franchise-owner/tenants` CRUD
- `FranchisesSection` для super_admin, таб «Тенанты» в `FranchiseOwnerCabinet`
- Data-migration для существующих `tenant.franchise_owner_id`
- Миграция: `s5t6u7v8w9x0_franchise`

### Platform sections (super_admin)
- `/admin/billing/{overview,subscriptions,invoices,payments}` — `PlatformBillingSection`
- `/admin/analytics/platform` — KPI, geo-распределение, top-tenants, динамика (`PlatformAnalyticsSection`)
- `/admin/payment-gateways` — Stripe + ЮKassa CRUD каркас (`PaymentGatewaysSection`)
- Адаптив: desktop таблицы / mobile карточки

## [2026-05-04] — Patient cabinet v3 + унификация

- **Унифицированный кабинет** `/{slug}/p` (`e19254d`): single PatientPortal v3 (`/arc/portal`) убран как «уродский». PatientCabinet — единственный
- **Long-lived session**: `patient_sessions` таблица, JWT type=`patient_session` (1 год), `services/patient_session_service.py`
- POST `/patient/by-code` дополнительно возвращает `session_token`
- POST `/patient/session/restore` / `/logout`
- Frontend: SESSION_KEY autologin (LS) с приоритетом `?t=` → `?s=` → SESSION_KEY → TOKEN+REF → LoginScreen
- PWA-фикс iOS: `<link rel="manifest">` сервится с baked `start_url=/{slug}/p?s=...`
- **Premium dark theme** (`f8ae261`) — preview `/arc/p-new`
- Вкладка **Врачи** с рейтингом prodoctorov-style + QuickBook + ReviewForm
- Календарь записи, мои записи, отзывы, доктор-профиль модал, family switch hint
- Cyrillic-friendly visit receipt, family add validation, mobile UX fixes для чата

## [2026-04-24] — TenantDrawer (`83cf0da`)

- Sliding-панель управления тенантом: 4 таба
  - Основное: инфо + toggle active + reset-password с копированием
  - Интеграции: CRUD `TenantIntegration` (MIS/LIS/BARS/custom) + тест соединения
  - Модули: 12 платных `CommercialModule` по категориям — enable/disable/trial/custom_price
  - Биллинг: выбор плана/цикла/trial + активация подписки
- AdminLayout SuperAdminSection: кнопка «Открыть →» открывает `TenantDrawer`
- Миграция: `n5o6p7q8r9s0`

## [2026-04-XX] — Platform AI analytics, межклиничные акты, healthcheck

- `ad13cfd` Platform AI analytics для super_admin
- `b28fe33` Inter-clinic acts: A4-печать, штамп, реквизиты, поля КПП/ОГРН/банк/подписант
- `9e4a684` Healthcheck watchdog + cron каждые 5 мин, log rotation
- `f156d92` Лендинг с AI analytics блоком, dark gradient hero
- `8fa9956` Contact form → DB inbox; ContactsSection в /admin

## [2026-04-XX] — Этап F: CNAME Domain Routing (`519df47`)

- `core/domain_router.py`: `DomainRouterMiddleware` — Host → tenant lookup
- GET `/.well-known/clinika-domain/{tenant_id}` — challenge endpoint
- POST `/.well-known/clinika-domain/{tenant_id}/verify` — верификация + `domain_verified=True`
- nginx: server block для кастомных CNAME (HTTP, port 80)

## [2026-04-XX] — Этап E: Security Hardening (`0b4161a`)

- `core/security_utils.py`: `SlidingWindowRateLimiter` (200/min, Redis+memory fallback)
- `assert_tenant_owns()` → HTTP 403 IDOR
- `archive_audit_job()` cron 03:00 — `audit_log` >90 дней → `audit_log_archive`

## [2026-04-XX] — Этап D: Reviews Plugin (`42f3f83`)

- `app/plugins/reviews/` + `models/review.py` + `routers/reviews.py`
- POST /reviews (публичный), GET /reviews/doctor/{id}
- GET/PATCH/DELETE /reviews/moderate (manager+)
- `ReviewsSection.jsx` (фильтры, модерация, пагинация)
- Миграция: `w5x6y7z8a9b0`

## [2026-04-XX] — Этап B: FranchiseOwner + Accountant + TODO #1-3

- `FranchiseOwnerCabinet.jsx` (обзор/аналитика/роялти), `AccountantCabinet.jsx`
- `AdminRoot.jsx` маршрутизация
- `require_module(*keys)` → HTTP 402 (ai/ads/presence)
- `ModulesCatalogSection` — каталог модулей в /admin
- Supervisor analytics: пресеты периода 7/30/90/365 дней, бар-чарты
- Миграция: `v4w5x6y7z8a9`

## [2026-04-XX] — Этап A: White-Label & CMS & Acts (`u3v4w5x6y7z8`)

- `tenant_branding` +12 полей, `tenant_cms_pages`, `invoices` +17 полей
- `ThemeService`, `CmsService`, `ActsService`
- `BrandingSection`, `CMSPagesSection`, `ActsSection`

## [2026-04-18] — Этап 18: AdsSection v3 + Telegram Mini App SDK (`bdc05c4`)

- AdsSection v3: drag-and-drop, ImageCropEditor (canvas), BannerPreview, StatsModal, CSV, duplicate
- ImageCropEditor: зум/поворот/flood-fill bg removal/8 handles
- AdReport.js: PDF через Blob+SVG (без зависимостей)
- ads.py v3: image_data/mime, banner_height, interval_seconds, sort_order, schedule, color_theme
- `lib/tg.js`: Telegram SDK helper с таймаутом 2с
- App.jsx гибридный init: веб-токен → Telegram SDK fallback

## [2026-04-17] — Этап 17: Nurse & Recruiter (`bdc05c4`)

- Роли `nurse`, `recruiter` в PG enum
- Модели: `DoctorClinicAccess`, `RecruiterBonus`, `Invitation`
- `routers/recruiter.py` + публичные `/invite/{token}`
- `RecruiterCabinet.jsx`, `OperationalCabinet.jsx`, `InviteAccept.jsx`
- Миграция: `k1l2m3n4o5p6`
- auth.py: rate limiting 20 req/min

## [2026-04-16] — Billing v2 (`3686190`)

- `models/billing_plan.py`: `TenantPlan`, `TenantPricingRules` (split%, franchise_fee%)
- `models/billing_ledger.py`: `BillingLedger` (append-only, ≠ LedgerEntry бонусов)
  - EntryType: subscription_charge, plugin_charge, ad_charge, platform_income, tenant_income, franchise_fee
  - Revenue split: gross + split_parent_id → 2-3 дочерних записи
- `models/advertising.py`: `Ad` (flat/cpc/cpm), `AdEvent` (ip_hash 152-ФЗ)
- `TenantPluginSubscription` (lifecycle плагинов, UniqueConstraint)
- `seed_plans.py` — идемпотентный seed (basic/professional/enterprise в БД)
- Миграция: `j0k1l2m3n4o5` — 6 новых таблиц

## Этапы 13-16 — Commercial Plugins, Webhooks, Multi-tenant URL routing

- Этап 13 SaaS Platform (`d91bcf7`): super_admin, /admin/tenants CRUD, динамический брендинг
- Этап 14 Commercial Plugin System (`03cfe8c`): PluginCatalog, PluginFeature, BillingEvent, P2P, видимость клиник
- Этап 15 Webhooks (`1d8fb9d`): WebhookEndpoint/Delivery, HMAC-SHA256, retry x3
- Этап 16 Dynamic URL routing (`3342145`): SLUG из URL, regex nginx, /clinika→/arc redirect

## Этапы 0.5-12 — Базовая SaaS-платформа

См. подробности в git log. Кратко:
- 0.5 Рефакторинг monolith manager.py (2450) → 11 файлов + Alembic
- 1 Multi-tenant модель (Tenant/License/Branding + tenant_id FK)
- 2 Plugin system (MIS/SMS/Notify)
- 3 Modules + has_feature() (basic/professional/enterprise)
- 4 Geo + device parsing
- 5 Doctor schedules + Appointments
- 6 Bonus ledger (append-only)
- 7 Analytics drill-down (overview/funnel/dynamics/top-services/top-staff)
- 8 Audit log (19 событий, before/after JSONB)
- 9 Billing (Subscription/Invoice/Payment + PLAN_PRICES)
- 10 Monitoring (p50/p95/p99, health snapshots, pg_stat_activity)
- 11 Security (RBAC, refresh tokens, 152-ФЗ consent)
- 12 Scheduling UI + HomeDashboard + Ledger breakdown
