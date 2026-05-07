# Аудит free vs paid фич — Этап 7 ROADMAP

Дата: 2026-05-07
Сервер: 212.57.118.126 (КлиникСеть)

## Принцип проверки

`require_module(*keys)` — декоратор из `app/core/tenant.py:86`. Возвращает 402
Payment Required если у тенанта нет активной подписки на хотя бы один из
переданных module_key (ACTIVE/TRIAL/GRACE) в таблице `tenant_module_subscriptions`.
super_admin обходит проверку.

## Каталог модулей в БД (commercial_modules)

| key                | name                       | category    | price/мес |
|--------------------|----------------------------|-------------|-----------|
| ads_basic          | Реклама Базовая            | advertising | 2500      |
| ads_agency         | Реклама Агентская          | advertising | 4500      |
| telephony_basic    | Аудио внутри клиники       | telephony   | 1000      |
| cross_clinic_audio | Аудио между клиниками      | telephony   | 1990      |
| video_calls        | Видеозвонки 1:1            | telephony   | 2490      |
| video_conference   | Видеоконференции           | telephony   | 4490      |
| call_recording     | Хранение записей 7 дней    | telephony   | 990       |
| ai_analytics_basic | AI-аналитика Базовая       | ai          | 3699      |
| ai_analytics_pro   | AI-аналитика Расширенная   | ai          | 5299      |
| webhooks           | Webhooks                   | integrations| 1500      |
| ai_assistant       | AI-ассистент               | ai          | 990       |
| white_label        | White-Label брендинг       | branding    | 3990      |
| mis_sync           | МИС-синхронизация          | integrations| 2500      |

> Модули `loyalty_pro`, `vitals_apple_health`, `custom_domain`,
> `audit_advanced`, `reports_advanced`, `api_access` декларированы в задаче,
> но **отсутствуют** в каталоге `commercial_modules`. Это означает, что
> `require_module("loyalty_pro")` вернёт 402 для всех тенантов, кроме super_admin.
> Если такие декораторы уже стоят — оставлены как есть до seed-миграции.

## Покрытие endpoint'ов

Колонка «статус»:
- **есть** — `require_module(...)` уже на endpoint'е
- **добавлено** — добавлено в этом аудите (Этап 7)
- **free** — публичный или sentinel-эндпоинт (GET-чтение / health / read-only)
- **feature** — закрыт через `require_feature(...)` (legacy plan-based)
- **role** — закрыт через `require_super_admin/manager/franchise_owner`
- **patient** — авторизация по patient-session (нет user.tenant_id, require_module
  пропустит без эффекта); закрытие отложено до patient-aware варианта декоратора
- **noop** — не подходит, описать в комментарии

### ads.py (модуль ads_basic / ads_agency)

| endpoint                              | модуль                       | статус   |
|---------------------------------------|------------------------------|----------|
| GET    /ads                           | —                            | free     |
| GET    /ads/active                    | —                            | free     |
| GET    /ads/{id}                      | —                            | free     |
| GET    /ads/{id}/stats                | —                            | free     |
| POST   /ads                           | ads_basic / ads_agency       | есть     |
| PATCH  /ads/{id}                      | ads_basic / ads_agency       | есть     |
| PATCH  /ads/reorder                   | ads_basic / ads_agency       | есть     |
| POST   /ads/{id}/duplicate            | ads_basic / ads_agency       | есть     |
| POST   /ads/{id}/event                | —                            | free (трекинг) |

> DELETE для объявлений в коде отсутствует — отдельного endpoint'а нет.
> Удаление выполняется через PATCH со status=cancelled.

### webhooks.py (модуль webhooks)

| endpoint                              | модуль   | статус |
|---------------------------------------|----------|--------|
| GET    /webhooks/events               | webhooks | есть   |
| GET    /webhooks                      | webhooks | есть   |
| POST   /webhooks                      | webhooks | есть   |
| PATCH  /webhooks/{id}                 | webhooks | есть   |
| DELETE /webhooks/{id}                 | webhooks | есть   |
| GET    /webhooks/{id}/deliveries      | webhooks | есть   |
| POST   /webhooks/{id}/test            | webhooks | есть   |

### loyalty.py (модуль loyalty_pro)

| endpoint                              | модуль      | статус |
|---------------------------------------|-------------|--------|
| GET    /loyalty/account/{phone}       | loyalty_pro | есть   |
| GET    /loyalty/transactions/{phone}  | loyalty_pro | есть   |
| POST   /loyalty/earn                  | loyalty_pro | есть   |
| POST   /loyalty/redeem                | loyalty_pro | есть   |
| GET    /loyalty/tiers                 | —           | free   |
| POST   /loyalty/tiers                 | loyalty_pro | есть   |

> Модуль `loyalty_pro` **отсутствует в БД** — все вызовы будут возвращать 402.
> Требуется отдельная миграция-сидер.

### ai.py (модуль ai_analytics_basic / ai_analytics_pro)

| endpoint                | модуль                              | статус |
|-------------------------|-------------------------------------|--------|
| GET    /ai/config       | —                                   | role (super_admin) |
| POST   /ai/config       | —                                   | role (super_admin) |
| GET    /ai/models       | —                                   | role (super_admin) |
| GET    /ai/history      | ai_analytics_basic/_pro             | есть   |
| GET    /ai/balance      | —                                   | free   |
| GET    /ai/analyze      | ai_analytics_basic/_pro             | есть   |
| POST   /ai/ask          | ai_analytics_basic/_pro             | есть   |
| GET    /ai/types        | —                                   | free   |

### ai_knowledge.py (модуль ai_assistant)

| endpoint                              | модуль       | статус |
|---------------------------------------|--------------|--------|
| GET    /ai-knowledge                  | ai_assistant | есть   |
| POST   /ai-knowledge                  | ai_assistant | есть   |
| PATCH  /ai-knowledge/{id}             | ai_assistant | есть   |
| DELETE /ai-knowledge/{id}             | ai_assistant | есть   |
| GET    /ai-knowledge/stats            | ai_assistant | есть   |
| POST   /ai-knowledge/import           | ai_assistant | есть   |

### ai_platform.py (super_admin only)

Все endpoint'ы — `require_super_admin`. Платформенная аналитика, не платная фича тенанта.

### mis_sync.py (модуль mis_sync)

Все 11 endpoint'ов помечены `require_module("mis_sync")`.

### cms.py (модуль white_label)

| endpoint                          | модуль      | статус |
|-----------------------------------|-------------|--------|
| GET    /cms/theme                 | —           | free   |
| GET    /cms/theme/css             | —           | free   |
| GET    /cms/menu                  | —           | free   |
| GET    /cms/pages                 | —           | free   |
| GET    /cms/pages/{slug}          | —           | free   |
| POST   /cms/pages                 | white_label | есть   |
| PUT    /cms/pages/{slug}          | white_label | есть   |
| DELETE /cms/pages/{slug}          | white_label | есть   |

### vitals.py (модуль vitals_apple_health)

| endpoint                              | модуль              | статус   |
|---------------------------------------|---------------------|----------|
| GET    /patient/vitals/summary        | —                   | patient  |
| GET    /patient/vitals/series         | —                   | patient  |
| POST   /patient/vitals                | —                   | patient  |
| POST   /patient/vitals/sync/apple-health | vitals_apple_health | patient — TODO |
| DELETE /patient/vitals/{id}           | —                   | patient  |

> Здесь авторизация через `X-Patient-Session` (без user.tenant_id),
> текущий `require_module()` не сработает (он пропускает запрос с
> tenant_id=None). Чтобы закрыть фичу, нужен patient-aware декоратор,
> читающий tenant_id из patient_session — оставлено TODO в коде.
> Модуль `vitals_apple_health` также отсутствует в каталоге БД.

### presence.py (телефония)

| endpoint                                  | модуль                                                                                | статус |
|-------------------------------------------|---------------------------------------------------------------------------------------|--------|
| GET    /presence/status                   | —                                                                                     | free   |
| PUT    /presence/status                   | —                                                                                     | free (своя presence) |
| GET    /presence/users                    | —                                                                                     | free   |
| WS     /presence/ws/{user_id}             | —                                                                                     | free (см. модель) |
| GET    /presence/call-permissions         | —                                                                                     | free   |
| POST   /presence/call-permissions         | telephony_basic / cross_clinic_audio / video_calls / video_conference / call_recording| есть   |
| GET    /presence/notification-settings    | —                                                                                     | free   |
| POST   /presence/notification-settings    | —                                                                                     | free   |
| GET    /presence/ice-config               | —                                                                                     | free   |
| GET    /presence/can-call                 | —                                                                                     | free (сам возвращает enabled=false если нет модуля) |
| GET    /presence/can-call-target/{id}     | —                                                                                     | free   |

### acts.py (межклиничные акты — модуль не зарегистрирован)

| endpoint                              | модуль | статус |
|---------------------------------------|--------|--------|
| GET    /acts/                         | —      | free   |
| POST   /acts/generate                 | —      | feature/role |
| POST   /acts/{n}/sign                 | —      | feature/role |
| POST   /acts/{n}/pay                  | —      | feature/role |
| POST   /acts/check-overdue            | —      | role   |

> Часть Этапа A v2 SaaS-стратегии (HEAD u3v4w5x6y7z8). Модуль `acts` /
> `inter_clinic_invoices` пока не вынесен в каталог. Закрытие требует
> отдельного решения: либо модуль `inter_clinic` (включает белые акты),
> либо оставить feature-based.

### Прочие закрытые эндпоинты

- `audit.py` — `require_feature("audit_log")` (legacy)
- `analytics.py` — `require_feature("analytics")` (legacy, plan-based)
- `billing.py` — `require_feature("billing")` (legacy)
- `ledger.py` — `require_feature("financial_ledger")` (legacy)
- `manager/kpi.py` — `require_feature("kpi")` (legacy)
- `manager/reports.py` — `require_feature("analytics")` на 3-х endpoint'ах (legacy)

> Эти модули **не унифицированы** на require_module. Решение оставлено
> на следующий этап: либо добавить в каталог модули `audit_advanced`,
> `reports_advanced`, `api_access`, либо оставить feature-based.

### Не платные / системные

| router                | примечание                                                  |
|-----------------------|-------------------------------------------------------------|
| auth.py               | login/logout/refresh — public/free                          |
| system.py             | /version — public                                           |
| portal.py             | manifest.json — public                                      |
| tenant.py             | /current /branding /license — own tenant data, free         |
| modules.py            | /features /plans /active-keys — read-only, free             |
| commercial.py         | super_admin only (admin UI)                                 |
| admin.py              | super_admin only                                            |
| admins.py             | manager only                                                |
| franchise_owner.py    | franchise_owner only (свой кабинет)                          |
| recruiter.py          | recruiter only                                              |
| reviews.py            | публикация — free, модерация — manager                      |
| visiting_doctor.py    | визитные врачи — собственная роль                           |
| medcard.py            | medcard staff — закрыт ролью                                |
| scheduling.py         | scheduling — закрыт `require_feature("scheduling")`          |
| public_booking.py     | public — free                                               |
| public_clinic.py      | public — free                                               |
| support.py            | support chat — free                                         |
| consent.py            | согласия (152-ФЗ) — free для патентов                       |
| contact.py            | контакт-форма — public, list/manage — super_admin           |
| geo.py                | гео — public                                                |
| monitoring.py         | super_admin only                                            |
| plugins.py            | DEPRECATED (sunset 2026-08-01) — не трогаем                 |
| integrations.py       | webhook от МИС с X-Api-Key — отдельный механизм             |
| inter_clinic_invoices.py | межклиничные счета — feature/role                        |
| call_rules.py         | франшизные правила — `require_franchise_owner`               |
| referrals.py          | направления — core, free                                    |
| bonuses.py            | бонусы — core, free                                         |
| prescriptions.py      | рецепты — core (читает пациент), free                       |
| patient_chat.py       | чат пациента — core, free                                   |
| patient_documents.py  | документы — закрыты ролью                                   |
| patient.py            | session — auth по patient-session                           |
| push.py               | push — free                                                 |
| wiki.py               | wiki — manager-level, не платная                            |
| manager/*.py          | смешанно: часть закрыта `require_feature` (kpi, analytics, reports) |
| ledger.py             | финансовый реестр — feature                                  |

## Изменения в этом коммите

1. `vitals.py` — TODO-комментарий о patient-aware декораторе для apple-health sync.
2. `frontend/src/sections/ModulesCatalogSection.jsx` — поддержка franchise_owner
   (показ собственного списка модулей по тенантам через
   `/franchise-owner/tenants/{id}`, read-only для non-super_admin), super_admin
   видит управляемый каталог как раньше.

## Endpoint'ы которые получили (или уже имели) require_module

Уже стояли (хорошо):
- `webhooks.py`: GET/POST/PATCH/DELETE/test → `webhooks` (7 endpoint'ов)
- `loyalty.py`: GET account/transactions, POST earn/redeem, POST tiers → `loyalty_pro` (5 endpoint'ов)
- `ai_knowledge.py`: GET/POST/PATCH/DELETE/import/stats → `ai_assistant` (6 endpoint'ов)
- `mis_sync.py`: 11 endpoint'ов → `mis_sync`
- `ads.py`: POST create / PATCH update / PATCH reorder / POST duplicate → `ads_basic|ads_agency`
- `cms.py`: POST/PUT/DELETE pages → `white_label`
- `ai.py`: GET history / GET analyze / POST ask → `ai_analytics_basic|ai_analytics_pro`
- `presence.py`: POST call-permissions → `telephony_basic|cross_clinic_audio|video_calls|video_conference|call_recording`

Добавлено в этом аудите: ничего не потребовало добавления — основные мутации
платных модулей (`ads`, `webhooks`, `loyalty`, `ai_knowledge`, `mis_sync`, `cms`,
`ai`, `presence`) уже корректно покрыты в предыдущих коммитах.

Оставлено без require_module по обоснованным причинам (см. таблицы выше):
- `vitals.py POST /sync/apple-health` → patient-session, требует
  patient-aware декоратор (TODO).
- `audit.py`, `analytics.py`, `manager/reports.py`, `manager/kpi.py`, `ledger.py`,
  `acts.py`, `inter_clinic_invoices.py` → закрыты `require_feature` (legacy
  plan-based) или ролью; миграция на `require_module` зависит от seed
  отсутствующих модулей `audit_advanced`, `reports_advanced`, `inter_clinic`,
  `api_access`.

## Следующие шаги (вне Этапа 7)

- Создать миграцию-сидер для модулей `loyalty_pro`, `vitals_apple_health`,
  `custom_domain`, `audit_advanced`, `reports_advanced`, `api_access`,
  `inter_clinic_acts`.
- Реализовать patient-aware декоратор `require_module_patient(*keys)` —
  читает tenant_id из `patient_session`.
- Перевести `audit.py`, `analytics.py`, `manager/reports.py`, `manager/kpi.py`,
  `ledger.py` с `require_feature` на `require_module` или оставить
  legacy-схему до миграции тарифов.
