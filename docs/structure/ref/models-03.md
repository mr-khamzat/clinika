# models [03] — аналитика, маркетинг, медкарта пациента, чат, платежи и интеграция с МИС

Эта группа из 25 файлов — **чистые SQLAlchemy ORM-модели** (наследники `app.database.Base`), без роутеров и без бизнес-логики (за единственным исключением — прозрачное шифрование PII в `PatientDocument`). Каждый файл объявляет одну или несколько таблиц через декларативный синтаксис `Mapped[...] = mapped_column(...)`. Эндпоинтов здесь нет — модели потребляются роутерами и сервисами из `app/routers/*` и `app/services/*`.

Тематически срез покрывает: **аналитику ценности пациента** (LTV), **маркетинговую атрибуцию** (каналы/расходы/UTM), **медкарту и здоровье пациента** (диагнозы, аллергии, прививки, документы, витальные показатели), **портал пациента** (аккаунты, OTP, сессии, семья, чат, NPS), **платёжный каркас клиники** (эквайринг + 54-ФЗ), **интеграцию с МИС Renovatio** (outbox для отложенных вызовов, дедуп импорта платежей), **системные сервисы** (мониторинг модулей, объявления, push-подписки, уведомления, присутствие/звонки, RBAC-override, сброс пароля, multi-clinic доступ менеджера).

Сквозные паттерны, которые надо знать перед правкой:
- **Ключ идентификации пациента — нормализованный телефон** (`patient_phone`, формат `7XXXXXXXXXX`), а не FK на `patient_accounts`. Это легаси-связка из МИС (у одного человека несколько `id`, телефон стабилен). FK на `patient_accounts.id` добавляется постепенно (Глава 9) и пока nullable.
- **`tenant_id` — почти везде nullable=True**, FK с `ondelete` либо `CASCADE` (жёсткая привязка), либо `SET NULL` (исторические/глобальные записи). Фильтрацию по тенанту делает роутер/сервис — на уровне модели её нет.
- **Деньги — всегда `Numeric(12,2)` / `Numeric(10,2)` → Python `Decimal`**, никогда float. При расчётах в сервисах не смешивать с float.
- Все временные метки — naive `datetime.utcnow` (UTC), кроме нескольких `DateTime(timezone=True)` / `TIMESTAMP(timezone=True)` — это расхождение по файлам (см. подводные камни).

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `ltv.py` | Снимок LTV-ценности пациента, пересчёт крон-джобом | 103 |
| `manager_clinic_access.py` | Multi-clinic доступ менеджера (N:M) | 54 |
| `marketing.py` | Каналы, рекламные расходы, атрибуция UTM | 141 |
| `medcard.py` | Диагнозы, аллергии, прививки пациента | 82 |
| `message_template.py` | Шаблоны быстрых ответов в чате | 27 |
| `mis_outbox.py` | Outbox отложенных вызовов в МИС | 45 |
| `mis_payment_import.py` | Дедупликация платежей, импортированных из МИС | 61 |
| `module_health.py` | Состояние платных модулей per-tenant | 70 |
| `notification_preference.py` | Per-user отключённые категории уведомлений | 43 |
| `notification_read.py` | Прочитанность событий в центре уведомлений | 29 |
| `nps_survey.py` | NPS-опрос после закрытия чат-треда | 32 |
| `partner_offer.py` | Партнёрский прайс cross-clinic (категории+офферы) | 58 |
| `password_reset.py` | Токены сброса пароля (хэш, TTL) | 28 |
| `patient_account.py` | Аккаунты пациентов портала + OTP | 49 |
| `patient_chat.py` | Чат пациент↔клиника (AI+регистратура) | 147 |
| `patient_document.py` | Документы пациента + кэш назначений МИС | 111 |
| `patient_family.py` | Семейный аккаунт (owner→members) | 31 |
| `patient_session.py` | Долгоживущая сессия кабинета пациента | 25 |
| `patient_vital.py` | Витальные показатели здоровья (пульс, давление) | 67 |
| `payments_clinic.py` | Эквайринг пациента + ОФД + 54-ФЗ | 222 |
| `pending_subscription.py` | Заявка пациента на подписку на одобрение | 80 |
| `permission_override.py` | Per-tenant переопределение RBAC | 56 |
| `platform_announcement.py` | Объявления super_admin всем тенантам | 38 |
| `presence.py` | Присутствие, права звонков, лог звонков | 98 |
| `push_subscription.py` | Web Push (VAPID) подписки | 60 |

---

## `backend/app/models/ltv.py`
- **Назначение:** Хранит агрегированный снимок ценности (LTV) одного пациента в рамках тенанта/клиники. Пересчитывается ежедневно крон-задачей `run_ltv_job` по данным МИС Renovatio (модуль `ltv_pro`).
- **Ключевые элементы:** класс `PatientLtvSnapshot` (таблица `patient_ltv_snapshots`). Метрики: `visits_count`, `total_spent`, `avg_check`, `visits_per_year`, `ltv_estimate` (по `sum_value` визитов), `net_ltv` (по фактическим оплатам из `getPayments`), `cohort_quarter` (квартал первого визита, напр. `2026-Q1`), `churn_risk` (`low`/`medium`/`high` по дням с последнего визита). Уникальный ключ — `(tenant_id, clinic_id, patient_phone)`.
- **Эндпоинты:** N/A (модель). Потребляется роутером `/analytics/ltv/*` (есть `POST /analytics/ltv/recompute`).
- **Зависимости:** `app.database.Base`; FK на `tenants.id` (CASCADE) и `clinics.id` (SET NULL). Логически зависит от крон-сервиса `run_ltv_job` и адаптера МИС.
- **Где менять для типовых задач:** изменить горизонт расчёта (сейчас ×3 года) или формулу LTV — это **только в сервисе расчёта, не в модели**; модель лишь хранит итог. Добавить новую метрику снимка (например, `last_service_name`) — добавить `mapped_column` сюда + миграция. Поменять пороги `churn_risk` — в сервисе.
- **Подводные камни:** все денежные поля — `Numeric → Decimal`, не складывать с float в сервисе. Снимок перезаписывается по уникальному ключу `(tenant, clinic, phone)` — если у пациента в МИС несколько `id` с разными телефонами, будут разные строки. `net_ltv=0`, когда Renovatio не отдаёт `getPayments` — это не «нулевая ценность», а отсутствие данных.
- **Строк:** 103

## `backend/app/models/manager_clinic_access.py`
- **Назначение:** Реализует multi-clinic доступ менеджера: одна запись = «пользователю X доступна клиника Y». Связь N:M между `users` и `clinics`. Если записей нет — fallback на единственную `User.clinic_id`.
- **Ключевые элементы:** класс `ManagerClinicAccess` (таблица `manager_clinic_access`). Поля: `user_id`, `clinic_id`, `granted_at`, `granted_by_user_id`. Уникальный ключ `(user_id, clinic_id)`.
- **Эндпоинты:** N/A (модель). Используется в `routers.manager.multi_clinic` и `routers.manager.clinics_access.get_user_clinic_ids`.
- **Зависимости:** `app.database.Base`; FK на `users.id` (CASCADE, дважды: `user_id` и `granted_by_user_id` → SET NULL) и `clinics.id` (CASCADE).
- **Где менять для типовых задач:** расширить список доступных менеджеру клиник — писать строки сюда (через сервис назначения). Логика «нет записей → fallback на User.clinic_id» живёт в `get_user_clinic_ids`, а не в модели — правь её там.
- **Подводные камни:** `tenant_id` в модели **отсутствует** — изоляция тенанта обеспечивается только тем, что `clinic_id` принадлежит тенанту менеджера; при выдаче доступа сервис обязан проверить, что клиника того же тенанта (cross-tenant дыра, если забыть). `granted_at` — `DateTime(timezone=True)` (в отличие от большинства моделей-naive).
- **Строк:** 54

## `backend/app/models/marketing.py`
- **Назначение:** Маркетинговая атрибуция и расходы на рекламу для Кабинета Директора (`DirectorMarketing`) и Manager-кабинета. Три таблицы: справочник каналов, рекламные расходы, привязка пациента к каналу с UTM.
- **Ключевые элементы:**
  - `MarketingChannel` (`marketing_channels`) — справочник каналов; `tenant_id=NULL` означает глобальный системный канал, доступный всем тенантам. Поля `code`, `name`, `icon`, `is_active`, `sort_order`.
  - `AdSpendEntry` (`ad_spend_entries`) — расходы за период (`amount`, `period_from/to`, `leads_count`, `clicks_count`, `impressions_count`, `campaign_name`). CheckConstraints: `amount >= 0`, `period_to >= period_from`.
  - `PatientAttribution` (`patient_attribution`) — связь пациента (по `patient_phone` ИЛИ `patient_user_id`) с каналом + полный набор UTM-меток (`utm_source/medium/campaign/term/content`), `referrer`, `first_touch_at`, `last_touch_at`.
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`; FK: `tenants.id` (CASCADE), `clinics.id` (SET NULL), `marketing_channels.id` (RESTRICT для расходов / SET NULL для атрибуции), `users.id` (SET NULL для `created_by_id` и `patient_user_id`). `contact_request_id` — UUID **без FK** (свободная ссылка на `contact_requests`).
- **Где менять для типовых задач:** добавить новый канал по умолчанию — сидируется отдельно (системный `tenant_id=NULL`), не здесь. Добавить новую UTM/поле атрибуции — `PatientAttribution` + миграция. Добавить метрику расходов (например `conversions_count`) — `AdSpendEntry` + миграция. Изменить ограничение неотрицательности суммы — `CheckConstraint` тут.
- **Подводные камни:** `ad_spend_entries.channel_id` имеет `ondelete="RESTRICT"` — нельзя удалить канал, пока на него есть расходы. `amount` — `Decimal`. Атрибуция дублируема: пациент может быть привязан и по телефону, и по `user_id` — дедупликацию делает сервис. `contact_request_id` без FK — целостность не гарантируется БД.
- **Строк:** 141

## `backend/app/models/medcard.py`
- **Назначение:** Медкарта пациента — диагнозы, аллергии, прививки. Записи либо вводятся вручную, либо импортируются из МИС (`source='manual'|'mis'`). Привязка по нормализованному телефону + tenant_id.
- **Ключевые элементы:** три таблицы — `PatientDiagnosis` (`patient_diagnoses`; `icd10_code` МКБ-10, `is_chronic`, `diagnosed_at`, `doctor_name`), `PatientAllergy` (`patient_allergies`; `allergen`, `severity` mild/moderate/severe, `reaction`), `PatientVaccination` (`patient_vaccinations`; `vaccine_name`, `dose_number`, `expires_at`, `batch_number`).
- **Эндпоинты:** N/A (модель). Потребляется роутерами медкарты пациента/врача.
- **Зависимости:** `app.database.Base`; FK на `tenants.id` (SET NULL) во всех трёх таблицах. Нет FK на пациента — связь только по `patient_phone`.
- **Где менять для типовых задач:** добавить новый тип медкарточной записи (например «оперативные вмешательства») — новый класс по образцу + миграция. Расширить степени тяжести аллергии — это строковое поле без enum-ограничения в БД, валидируй в схеме/сервисе.
- **Подводные камни:** **нет уникального ключа** — повторный импорт из МИС создаст дубликаты, если сервис не дедуплицирует (в отличие от `PatientPrescriptionCache`, где есть `mis_id`). `severity`/`source` — обычные строки без `CheckConstraint`. `patient_phone` обязателен — записи нельзя завести без телефона.
- **Строк:** 82

## `backend/app/models/message_template.py`
- **Назначение:** Шаблоны быстрых ответов («заготовки») для сотрудников в чате — по shortcut вставляются в поле ответа.
- **Ключевые элементы:** класс `MessageTemplate` (`message_templates`). Поля: `shortcut`, `title`, `body` (Text), `category`, `usage_count` (счётчик использований), `created_by_user_id`.
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`; FK на `tenants.id` (CASCADE, обязателен) и `users.id` (SET NULL).
- **Где менять для типовых задач:** добавить группировку/доступ шаблонов по ролям — добавить поле `role` или `scope` + миграция. Инкремент `usage_count` делает роутер при применении шаблона.
- **Подводные камни:** `tenant_id` обязателен (NOT NULL) — шаблон всегда привязан к тенанту, глобальных нет. Нет уникальности `shortcut` в рамках тенанта — два шаблона могут иметь одинаковый shortcut (разрешает БД, конфликт разрулит фронт/сервис).
- **Строк:** 27

## `backend/app/models/mis_outbox.py`
- **Назначение:** Outbox-таблица для отложенных (асинхронных/повторных) вызовов МИС, когда МИС недоступен (5xx). Сюда `patient_identifier` пишет `patient.create/update`, `slot_booking_service` — `appointment.create/update/cancel`. Worker забирает `status='pending'` с `next_retry_at <= now()` и шлёт в МИС с exp.backoff.
- **Ключевые элементы:** класс `MisOutbox` (`mis_outbox`). Поля: `event_type` (5 типов), `payload` (JSONB, структура зависит от типа), `status` (`pending`/`sent`/`failed`/`manual_required`), `attempt_count`, `next_retry_at`, `last_error`.
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`. **Нет FK вообще** — таблица намеренно изолирована (надёжная очередь, не должна каскадно удаляться). Логически связана с сервисами `patient_identifier`, `slot_booking_service` и worker-фичей.
- **Где менять для типовых задач:** добавить новый тип отложенного события — расширить набор `event_type` (строка, без enum) + согласовать форму `payload` с worker. Изменить политику ретраев — в worker, не в модели.
- **Подводные камни:** `payload` — JSONB; **не клади туда `Decimal`** (типовой баг проекта — Decimal не сериализуется в JSONB напрямую, конвертируй в str/float до записи). `tenant_id` в модели **нет** — тенант должен быть зашит внутрь `payload`. Все даты naive UTC.
- **Строк:** 45

## `backend/app/models/mis_payment_import.py`
- **Назначение:** Гарантия идемпотентности импорта платежей из МИС в нашу кассу/ledger. Уникальный ключ `(mis_clinic_id, mis_payment_id)` не даёт одному платежу МИС попасть дважды в кассовую смену.
- **Ключевые элементы:** класс `MisPaymentImport` (`mis_payment_imports`). Поля: `mis_clinic_id` (int — id клиники в самой МИС), `mis_payment_id`, `mis_invoice_id`, `amount`, `method` (cash/card/other), `paid_at`, ссылки на `shift_entry_id` (если cash) и `ledger_entry_id` (если card/other) для отката синхронизации. Уникальный ключ `uq_mis_payment_unique`.
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`; FK на `tenants.id` (CASCADE), `clinics.id` (CASCADE), `cash_shift_entries.id` (SET NULL), `ledger_entries.id` (SET NULL).
- **Где менять для типовых задач:** изменить ключ дедупликации — править `UniqueConstraint` (сейчас по паре mis_clinic+mis_payment, **без tenant_id** — см. ниже) + миграция. Добавить откат card-платежей — связь `ledger_entry_id` уже есть.
- **Подводные камни:** **уникальность глобальная по `(mis_clinic_id, mis_payment_id)`, без `tenant_id`** — теоретически платёж из МИС другого тенанта с тем же `mis_clinic_id`+`mis_payment_id` вызовет коллизию (на практике `mis_clinic_id` уникален на инсталляцию МИС, но это риск). `amount` — `Decimal`. Основной gate дедупа — именно эта пара, `mis_invoice_id` лишь для отчётности.
- **Строк:** 61

## `backend/app/models/module_health.py`
- **Назначение:** Last-known состояние каждого платного модуля у каждого тенанта (Module Monitoring System). Питает health-проверки (cron каждые 30 мин), Telegram-алерты при `ok→error` и UI-индикаторы у `franchise_owner`/`super_admin`.
- **Ключевые элементы:** enum `ModuleHealthStatus` (`unknown`/`ok`/`degraded`/`error`/`idle`) + класс `ModuleHealthCheck` (`module_health_checks`). Поля: `module_key`, `status` (хранится как VARCHAR(16), **не SAEnum**), счётчики и метки (`last_check_at`, `last_used_at`, `last_success_at`, `error_count_24h`, `last_error_*`, `last_alert_at`), `metrics` (JSONB для tooltip). Уникальный ключ `(tenant_id, module_key)`.
- **Эндпоинты:** N/A (модель). Используется `services/module_health_service.py`.
- **Зависимости:** `app.database.Base`; FK на `tenants.id` (CASCADE).
- **Где менять для типовых задач:** добавить новый статус — добавить в enum `ModuleHealthStatus` (миграция alter type **не нужна**, т.к. в БД это VARCHAR). Добавить новую метрику в tooltip — кладётся в `metrics` JSONB без миграции. Логика переходов и алертов — в сервисе.
- **Подводные камни:** `status` намеренно хранится строкой, а не нативным enum — присваивай `ModuleHealthStatus.OK.value`, не сам enum, чтобы не словить рассогласование типов. `metrics` JSONB — не клади `Decimal`.
- **Строк:** 70

## `backend/app/models/notification_preference.py`
- **Назначение:** Per-user настройки центра уведомлений (`NotificationsBell`): список категорий, которые пользователь скрыл из bell-дропдауна.
- **Ключевые элементы:** класс `NotificationPreference` (`notification_preferences`). PK — сам `user_id` (1:1 с пользователем). Поле `disabled_categories` — Postgres `ARRAY(String(40))` с `server_default="{}"`.
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`; FK на `users.id` (CASCADE, он же PK).
- **Где менять для типовых задач:** добавить новую категорию для скрытия — это просто строка в массиве, валидируй допустимые значения в схеме/сервисе (категории перечислены в комментарии: security/region/patient_data/staff/referrals/bonuses/settings/discounts/contacts/system/finance). Расширить до per-channel (bell/email/telegram) или «тихих часов» — модель к этому готова (комментарий), добавляй колонки.
- **Подводные камни:** `ARRAY` — **Postgres-специфичный тип**, на SQLite (локальные тесты) может вести себя иначе — учитывай при прогоне тестов. `default=list` (mutable) — безопасно, т.к. SQLAlchemy вызывает callable. PK = `user_id` означает строго одна запись на пользователя.
- **Строк:** 43

## `backend/app/models/notification_read.py`
- **Назначение:** Отметки «прочитано» для событий центра уведомлений. Поскольку `audit_log` append-only, прочитанность хранится отдельно.
- **Ключевые элементы:** класс `NotificationRead` (`notification_reads`). Поля: `user_id`, `kind` (`audit`/`activity`/`contact`), `source_id` (id исходного события из соответствующей таблицы). Уникальный ключ `(user_id, kind, source_id)`.
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`; FK на `users.id` (CASCADE). `source_id` — UUID **без FK** (полиморфная ссылка на разные таблицы в зависимости от `kind`).
- **Где менять для типовых задач:** добавить новый источник уведомлений — добавить значение `kind` (строка, без enum) и научить сервис подсчёта непрочитанного его обрабатывать.
- **Подводные камни:** `source_id` полиморфен и **без FK** — целостность не гарантируется БД, висячие ссылки возможны после удаления исходного события (для audit это ок — он append-only). `kind` — свободная строка.
- **Строк:** 29

## `backend/app/models/nps_survey.py`
- **Назначение:** NPS-опрос пациента, создаваемый автоматически при закрытии чат-треда (`status='closed'`). Привязан 1:1 к `thread_id`. Пациент отвечает через `/patient/nps/{id}/answer`.
- **Ключевые элементы:** класс `NPSSurvey` (`nps_surveys`). Поля: `patient_id`, `thread_id` (unique), `score` (0..10), `comment`, `sent_at`, `answered_at`.
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`; FK на `tenants.id` (CASCADE) и `clinics.id` (SET NULL). `patient_id`/`thread_id` — UUID **без FK**.
- **Где менять для типовых задач:** изменить шкалу/добавить вопросы NPS — добавить поля сюда + миграция. Триггер создания опроса — в сервисе закрытия треда, не здесь.
- **Подводные камни:** **Это НЕ единственная NPS-модель в проекте** — есть отдельная `NpsResponse` в `engagement.py`, привязанная к `appointment_id` (общий NPS после визита). `NPSSurvey` здесь — именно chat-thread NPS. Не путать при поиске «где считается NPS». `thread_id` unique → один опрос на тред.
- **Строк:** 32

## `backend/app/models/partner_offer.py`
- **Назначение:** Партнёрский прайс для cross-clinic направлений внутри тенанта: клиника-получатель заводит свои категории и офферы (услуга + payout + опц. переопределение цены), видимые другим клиникам того же тенанта.
- **Ключевые элементы:**
  - `PartnerCategory` (`partner_categories`) — собственные категории клиники (отдельно от МИС); `relationship` → `offers`. Уникальный индекс `(clinic_id, name)`.
  - `PartnerServiceOffer` (`partner_service_offers`) — связка `(clinic_id, service_id)` с `payout_amount` и опц. `price_override`; `relationship` → `category`. Уникальный индекс `(clinic_id, service_id)` + индекс `(tenant_id, is_active)`.
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`; FK: `tenants.id` (CASCADE), `clinics.id` (CASCADE), `services.id` (CASCADE), `partner_categories.id` (SET NULL), `users.id` (SET NULL). Внутренние `relationship` между двумя моделями с явным `foreign_keys`.
- **Где менять для типовых задач:** добавить поле в оффер (например `min_age`, `comment`) — `PartnerServiceOffer` + миграция. Изменить уникальность оффера — индекс `uq_partner_offer_clinic_service`. Cross-tenant видимость закрыта **на уровне роутера**, а не модели — изоляцию проверяй там.
- **Подводные камни:** `payout_amount`/`price_override` — `Decimal`. Удаление `service` каскадно удаляет оффер (CASCADE). `relationship` требует, чтобы обе модели были импортированы для разрешения строковых ссылок. Изоляция тенанта — забота роутера (модель видна в пределах tenant_id).
- **Строк:** 58

## `backend/app/models/password_reset.py`
- **Назначение:** Одноразовые токены сброса пароля. Хранится **только SHA-256 хэш** raw-токена (raw отдаётся пользователю по email и нигде не логируется). TTL 1 час, `used_at` для одноразовости. Используется в `/auth/forgot-password` и `/auth/reset-password`.
- **Ключевые элементы:** класс `PasswordResetToken` (`password_reset_tokens`). Поля: `token_hash` (unique, SHA-256 hex), `expires_at`, `used_at`, `requested_ip`.
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`; FK на `users.id` (CASCADE).
- **Где менять для типовых задач:** изменить TTL (сейчас 1 час) — в сервисе генерации токена, не в модели (модель хранит готовый `expires_at`). Сменить алгоритм хэширования — согласовать генерацию и проверку в `/auth/*`.
- **Подводные камни:** **никогда не храни и не логируй raw-токен** — только хэш. Проверка одноразовости (`used_at IS NULL`) и срока (`expires_at > now`) — ответственность сервиса. `requested_ip` — String(45) (вмещает IPv6).
- **Строк:** 28

## `backend/app/models/patient_account.py`
- **Назначение:** Аккаунты пациентов портала v2 (Patient Portal) + OTP-коды для входа по SMS. Ключевая «личность» пациента в портале.
- **Ключевые элементы:**
  - `PatientAccount` (`patient_accounts`) — `phone` (unique, главный ключ личности), `name`, `email`, `birth_date`, `password_hash`, engagement-поля (`login_count`, `last_seen_at`, `marketing_opt_in`), связь с МИС (`mis_patient_id`, `mis_synced_at`, `mis_sync_state` — 7 состояний), VIP-counselor (`default_counselor_user_id`, `counselor_since`).
  - `PatientOTP` (`patient_otps`) — `phone`, `code` (6 цифр), `expires_at`, `is_used`.
- **Эндпоинты:** N/A (модель). Потребляется роутерами `/patient/auth/*` и порталом.
- **Зависимости:** `app.database.Base`. **Нет FK вообще** — `PatientAccount` намеренно автономен (нет tenant_id! пациент — кросс-тенантная сущность, идентифицируется телефоном). `default_counselor_user_id` — UUID без FK.
- **Где менять для типовых задач:** многие модели срезa ссылаются на `patient_accounts.id` (документы, push, pending-подписка) — здесь центральная сущность пациента. Добавить поле профиля — сюда + миграция. Расширить состояния синка МИС — `mis_sync_state` (строка). Изменить длину OTP — `code` String(6).
- **Подводные камни:** **`PatientAccount` НЕ имеет `tenant_id`** — пациент глобален, привязка к тенанту идёт через направления/визиты/чаты. `phone` unique глобально. `mis_patient_id` — int (id в МИС). OTP не имеет FK на аккаунт — связь только по `phone` (аккаунта может ещё не быть при первом входе).
- **Строк:** 49

## `backend/app/models/patient_chat.py`
- **Назначение:** Гибридный чат «пациент ↔ клиника» (вариант D): AI-ассистент + регистратура. Одна ветка = (пациент по телефону) × тенант. Поддерживает режимы `ai` (автоответ LLM) и `manual` (ждём админа), интерактивные слот-карточки (бронирование через чат) и дневной лимит AI-ответов.
- **Ключевые элементы:** enum'ы `PatientChatMode` (ai/manual), `PatientChatSender` (patient/assistant/admin), `PatientChatMessageType` (text/slot_offer/slot_request/slot_booked/slot_expired). Классы:
  - `PatientChat` (`patient_chats`) — ветка; `mode`, `ai_messages_today`+`ai_messages_reset_date` (лимит 20/день, lazy-reset), `unread_admin`, `last_message_at/preview`; `relationship messages` (cascade delete-orphan, order_by created_at).
  - `PatientChatMessage` (`patient_chat_messages`) — сообщение; `sender`, `text`, `message_type`+`payload` (JSONB для слот-карточек), `tokens_in/out`, `is_cached`, `handed_off` (AI «не знаю»), `is_read_by_patient`, `source` (llm/knowledge/cache/fallback), `admin_user_id`.
- **Эндпоинты:** N/A (модель). Потребляется роутерами чата пациента и `patient_chat_ai.py` (Redis-кэш частых вопросов).
- **Зависимости:** `app.database.Base`; FK на `tenants.id` (SET NULL), `patient_chats.id` (CASCADE), `users.id` (SET NULL). Внутренний `relationship` chat↔messages. Логически — `patient_chat_ai.py`, `slot_booking_service`, Redis.
- **Где менять для типовых задач:** добавить новый тип интерактивной карточки — добавить значение в `PatientChatMessageType` + согласовать форму `payload` (JSONB). Изменить дневной лимит AI (20) — в сервисе, читающем `ai_messages_today`. Добавить вложения в сообщение — поле сюда + миграция.
- **Подводные камни:** все три enum'а объявлены `native_enum=False` + `values_callable` — хранятся как VARCHAR (новые значения без alter type, но согласуй имена enum `name=...`). `payload` JSONB — не клади `Decimal`. `ai_messages_reset_date` сбрасывается **lazy** (при первом сообщении нового дня) — не полагайся на крон. Каскадное удаление сообщений при удалении ветки (delete-orphan).
- **Строк:** 147

## `backend/app/models/patient_document.py`
- **Назначение:** Документы пациента (справки, направления, выписки, больничные) + кэш назначений из МИС для офлайн-просмотра. Файлы на диске (`/app/uploads/patient_docs/...` или `/app/data/patient_docs/...`). **Единственный файл срезa с бизнес-логикой** — прозрачное шифрование описания.
- **Ключевые элементы:**
  - `PatientDocument` (`patient_documents`) — `patient_phone` (legacy) + `patient_id` (FK на `patient_accounts`, Глава 9), `filename`, `mime`, `size_bytes`, `doc_type` (legacy) + `category`/`title`/`visibility` (Глава 9), `file_path`, `description_encrypted` (Text), `issued_at`, soft-delete `deleted_at`. **Кастомный `__init__` шифрует `description`→`description_encrypted` через `encryption_service`; property `description` get/set прозрачно (де)шифрует.**
  - `PatientPrescriptionCache` (`patient_prescription_cache`) — кэш назначений МИС; `mis_id` (для дедупа), `drug_name`, `dosage`, `frequency`, `duration`, `prescribed_at`, `doctor_name`, `raw_json` (JSONB сырых данных МИС).
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`; **`app.services.encryption_service.encrypt/decrypt`** (lazy import внутри `__init__`/property — чтобы избежать циклов). FK: `tenants.id` (SET NULL), `patient_accounts.id` (SET NULL), `users.id` (SET NULL).
- **Где менять для типовых задач:** добавить шифруемое PII-поле — расширить список `[('description','description_encrypted')]` в `__init__` + добавить property + колонку `*_encrypted` + миграцию. Добавить категорию документа — строка `category` (валидируй в схеме: lab_result/prescription/referral/discharge/mri/xray/other). Изменить путь хранения файла — в роутере загрузки, не в модели.
- **Подводные камни:** **передавай `description=...` в конструктор/сеттер, НЕ `description_encrypted` напрямую** — иначе значение запишется незашифрованным. При фильтрации никогда не ищи по plaintext `description` (его в БД нет). Soft-delete `deleted_at` — запросы должны фильтровать `deleted_at IS NULL`. Легаси-загрузки имеют только `patient_phone` (новые колонки nullable). `PatientPrescriptionCache` дедуплицируется по `mis_id`.
- **Строк:** 111

## `backend/app/models/patient_family.py`
- **Назначение:** Семейный аккаунт: владелец (`owner_phone`) добавляет членов семьи (`member_phone`) и переключается между профилями. Безопасность переключения — через short_code активного направления члена семьи (логика в роутере).
- **Ключевые элементы:** класс `PatientFamilyMember` (`patient_family_members`). Поля: `owner_phone`, `member_phone`, `member_name`, `relation` («Супруг(а)»/«Ребёнок»/...), `tenant_id`. Уникальный ключ `(owner_phone, member_phone)`.
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`. **Нет FK** — связь только по телефонам (пациенты идентифицируются телефоном). `tenant_id` — UUID без FK.
- **Где менять для типовых задач:** добавить лимит числа членов или права доступа члена — поле сюда / логика в роутере. Проверка short_code при switch — в роутере, не в модели.
- **Подводные камни:** связь по телефонам без FK — целостность не гарантируется. `tenant_id` nullable и без FK. Симметрии нет: запись односторонняя (owner→member), обратное направление — отдельная строка при необходимости.
- **Строк:** 31

## `backend/app/models/patient_session.py`
- **Назначение:** Долгоживущая сессия кабинета пациента `/p` — «пропуск» без повторного SMS/пароля. Создаётся при входе по short_code направления, валидна 1 год с автопродлением.
- **Ключевые элементы:** класс `PatientSession` (`patient_sessions`). Поля: `phone`, `tenant_id` (без FK), `refresh_hash` (хэш refresh-токена), `device_info`, `last_used_at`, `expires_at`, `revoked`.
- **Эндпоинты:** N/A (модель). Потребляется auth-слоем кабинета `/p`.
- **Зависимости:** `app.database.Base`. **Нет FK** (связь по `phone`).
- **Где менять для типовых задач:** изменить срок жизни сессии (1 год) или политику автопродления — в auth-сервисе кабинета пациента; модель хранит `expires_at`/`last_used_at`. Отзыв сессии — флаг `revoked`.
- **Подводные камни:** хранится **хэш** refresh-токена (`refresh_hash`), не сам токен. Проверки `revoked=False` и `expires_at > now` — ответственность сервиса. `tenant_id` без FK. Не путать с `PatientOTP` (одноразовый вход) — здесь долгоживущий refresh.
- **Строк:** 25

## `backend/app/models/patient_vital.py`
- **Назначение:** Витальные показатели здоровья пациента (пульс, давление, SpO2, глюкоза, вес, шаги, сон и т.д.). Источники: ручной ввод, Apple Health, Google Fit, медустройства.
- **Ключевые элементы:** класс `PatientVital` (`patient_vitals`). Поля: `patient_phone`, `metric` (11 типов в комментарии), `value_num` (Decimal), `value_extra` (JSONB для составных — напр. SYS+DIA или фазы сна), `unit`, `measured_at`, `source` (manual/apple_health/google_fit/device), `device_info`, `note`. Композитный индекс `ix_vitals_tenant_phone_metric_time` под основные запросы (серии по метрике).
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`; FK на `tenants.id` (SET NULL).
- **Где менять для типовых задач:** добавить новый тип показателя — добавить значение `metric` (строка) + соответствующий `unit` (валидация в схеме/сервисе, в БД enum нет). Составные показатели кладутся в `value_extra` JSONB.
- **Подводные камни:** **дедупликация по `(tenant_id, patient_phone, metric, measured_at)` делается в сервисе, а не БД** — нет UniqueConstraint, повторная синхронизация без дедупа создаст дубли. `value_num` — `Decimal`; `value_extra` JSONB — не клади Decimal. Индекс заточен под порядок `(tenant, phone, metric, measured_at)` — запросы вне этого порядка медленнее.
- **Строк:** 67

## `backend/app/models/payments_clinic.py`
- **Назначение:** Платёжный каркас **клиники** (модули `online_payments_pro` + `fiscal_54fz_pro`): онлайн-оплата пациентом услуг клиники через эквайринг + фискализация 54-ФЗ через ОФД. Самый объёмный файл срезa.
- **Ключевые элементы:** константы-классы `PaymentGateway` (yookassa/tinkoff/sber/cloudpayments/robokassa), `OFDProvider` (platforma/perv/takskom/atol_online), `ClinicPaymentStatus` (pending/succeeded/cancelled/refunded), `FiscalOperationType` (sale/refund_sale/sale_correction). Модели:
  - `ClinicPayment` (`clinic_payments`) — платёж пациента; `amount`, `gateway`, `gateway_payment_id`, `status`, `payment_metadata` (JSONB — сырьё шлюза + idempotency_key), `paid_at`/`refunded_at`. FK на appointment.
  - `PaymentGatewayConfig` (`payment_gateway_configs`) — конфиг шлюза per-clinic; `shop_id`, `secret_key_encrypted` (Fernet), `is_test_mode`, `config` JSONB. Уникальный `(clinic_id, gateway)`.
  - `FiscalReceipt` (`fiscal_receipts`) — чек из ОФД; `inn`, `operation_type`, `total_sum`, `qr_code`, ФД/ФН/ФП-номера, `raw_payload` JSONB, `ofd_provider`. FK на payment.
  - `OFDConfig` (`ofd_configs`) — конфиг ОФД per-clinic; `provider`, `inn`, `api_key_encrypted` (Fernet), `last_pulled_at`. Уникальный `(clinic_id)`.
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`; **`app.services.encryption_service` (Fernet)** для `secret_key_encrypted`/`api_key_encrypted` — шифрование/дешифрование делает сервис при чтении/записи. FK: `tenants.id` (CASCADE), `clinics.id` (CASCADE), `appointments.id` (SET NULL), `clinic_payments.id` (SET NULL).
- **Где менять для типовых задач:** добавить новый шлюз — добавить константу в `PaymentGateway` + адаптер в сервисе. Добавить новый ОФД — `OFDProvider` + адаптер. Изменить набор статусов платежа — `ClinicPaymentStatus` (строка в БД). idempotency_key и сырьё шлюза живут в `payment_metadata` JSONB.
- **Подводные камни:** **НЕ путать с `app.models.billing.Payment`** — там подписки платформы (тенант→платформа), здесь оплаты пациента клинике. `amount`/`total_sum` — `Decimal`. Поля `*_encrypted` хранят `enc:<token>` (Fernet) или `plain:<val>` (fallback без ключа) — **не присваивай plaintext напрямую**, иди через сервис шифрования. JSONB-поля (`payment_metadata`, `config`, `raw_payload`) — не клади Decimal-суммы без конвертации. Один ОФД на клинику (unique), но несколько шлюзов.
- **Строк:** 222

## `backend/app/models/pending_subscription.py`
- **Назначение:** Заявка пациента на подписку, ожидающая ручного одобрения менеджером. Подписка НЕ активна до одобрения; при approve создаётся `PatientSubscription` и ссылка в `resulting_subscription_id`.
- **Ключевые элементы:** класс `PendingSubscriptionRequest` (`pending_subscription_requests`). Поля: `patient_id`, `plan_key`, `months`, `payment_method` (cash/online/unknown — желание пациента, не финальное), `patient_note`, `status` (pending/approved/rejected/expired), `reviewed_by_id`, `reviewed_at`, `reject_reason`, `resulting_subscription_id`.
- **Эндпоинты:** N/A (модель). Workflow: `POST /patient/subscription/request` → менеджер на `/manager/subscription-pending`.
- **Зависимости:** `app.database.Base`; FK: `tenants.id` (CASCADE), `clinics.id` (SET NULL), `patient_accounts.id` (CASCADE), `users.id` (SET NULL), `patient_subscriptions.id` (SET NULL). Логически — `subscription_cash_service.activate_cash` / `subscription_service.start_subscription`.
- **Где менять для типовых задач:** добавить состояние заявки — `status` (строка). Активация подписки и создание `PatientSubscription` — в сервисах подписок, не в модели; модель лишь связывает заявку с результатом.
- **Подводные камни:** даты здесь — `TIMESTAMP(timezone=True)` (timezone-aware, в отличие от большинства naive-моделей срезa) — учитывай при сравнении дат в сервисе. `payment_method` — лишь намерение пациента, финальный способ определяет менеджер. `tenant_id` обязателен.
- **Строк:** 80

## `backend/app/models/permission_override.py`
- **Назначение:** Per-tenant переопределение RBAC (Этап 8 ROADMAP «RBAC как данные»). Базовая матрица прав — в коде (`app.core.permissions.ROLE_PERMISSIONS`); тенант точечно переопределяет отдельные действия для своих ролей.
- **Ключевые элементы:** класс `TenantPermissionOverride` (`tenant_permission_overrides`). Поля: `tenant_id`, `role` (строка UserRole.value), `permissions` (JSONB-карта `{"referrals:read": true, "bonuses:write": false}`), `updated_by_user_id`. Уникальный ключ `(tenant_id, role)`.
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`; **`app.core.permissions.ROLE_PERMISSIONS`** (fallback-источник прав); FK на `tenants.id` (CASCADE) и `users.id` (без ondelete для `updated_by_user_id`).
- **Где менять для типовых задач:** базовые права роли — в `app.core.permissions.ROLE_PERMISSIONS` (код), НЕ здесь. Эта таблица — только тенант-специфичные переопределения. Логика «есть ключ в override → приоритет, нет → fallback на код» — в слое проверки прав (читает `permissions` dict).
- **Подводные камни:** `role` — строка без enum-ограничения (чтобы добавлять роли без миграций) — следи за соответствием `UserRole.value`. Действия, отсутствующие в `permissions`, **не** запрещены, а берутся из кода (fallback) — частая логическая ошибка: «удалил ключ → думал запретил», на деле вернулся к дефолту. `updated_by_user_id` FK без `ondelete`.
- **Строк:** 56

## `backend/app/models/platform_announcement.py`
- **Назначение:** Платформенные объявления: super_admin рассылает всем активным сотрудникам всех тенантов через центр уведомлений (`NotificationsBell`). Напр. «техобслуживание в 02:00», «вышло обновление».
- **Ключевые элементы:** класс `PlatformAnnouncement` (`platform_announcements`). Поля: `message` (Text), `severity` (info/warning/critical), `created_by_id`, `expires_at` (null=бессрочно), `revoked` (soft-delete/отзыв).
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`; FK на `users.id` (SET NULL).
- **Где менять для типовых задач:** добавить таргетинг (по тенанту/роли) — сейчас объявление **глобально для всех** (нет tenant_id/role-фильтра); добавить поля + логику в сервис рассылки. Добавить уровень severity — строка.
- **Подводные камни:** **нет `tenant_id`** — объявление видят все тенанты (by design). Фильтрация по «активно сейчас» = `revoked=False AND (expires_at IS NULL OR expires_at > now)` — делает сервис. `created_at` имеет `server_default=CURRENT_TIMESTAMP`.
- **Строк:** 38

## `backend/app/models/presence.py`
- **Назначение:** Присутствие пользователей и инфраструктура P2P-звонков (Этап 15). Четыре таблицы: статус присутствия, матрица прав звонков, настройки уведомлений per-tenant/role, лог звонков.
- **Ключевые элементы:** enum `PresenceStatus` (online/away/busy/offline). Классы:
  - `UserPresence` (`user_presence`) — `user_id` (unique, 1:1), `status` (хранится VARCHAR, не SAEnum), `status_text`, `last_seen_at`.
  - `CallPermission` (`call_permissions`) — матрица `from_role→to_role` per-tenant; `can_call`, `can_video`, `same_clinic_only`.
  - `NotificationSetting` (`notification_settings`) — per-tenant/role; `events` (JSONB), `channels` (JSONB `{"sms":true,...}`).
  - `CallLog` (`call_logs`) — `caller_id`/`callee_id`, `outcome` (missed/answered/rejected/busy), `duration_sec`, `call_type` (audio/video), `started_at`/`ended_at`.
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`; FK: `users.id` (CASCADE — для presence/caller/callee), `tenants.id` (CASCADE).
- **Где менять для типовых задач:** добавить статус присутствия — `PresenceStatus` (хранится строкой). Добавить канал уведомлений — ключ в `channels` JSONB. Изменить правила «кто кому может звонить» — строки `CallPermission`. Добавить поле в лог звонка — `CallLog` + миграция.
- **Подводные камни:** `UserPresence.status` объявлен с типом `String(20)`, но `default=PresenceStatus.OFFLINE` (enum-объект, не `.value`) — при вставке через ORM полагаемся на строковое приведение; присваивай `.value` явно во избежание сюрпризов. `events`/`channels` — JSONB с `default=dict`, но семантически `events` хранит массив строк (комментарий) — рассогласование default/использования. `NotificationSetting` (per-tenant/role) — НЕ путать с `NotificationPreference` (per-user) и `NotificationSetting` из других модулей.
- **Строк:** 98

## `backend/app/models/push_subscription.py`
- **Назначение:** Web Push (VAPID) подписки на браузерные/мобильные уведомления — и для сотрудников, и для пациентов.
- **Ключевые элементы:** класс `PushSubscription` (`push_subscriptions`). Взаимоисключающие `user_id` (сотрудник) / `patient_id` (пациент) + legacy `patient_phone`. Поля Web Push: `endpoint` (unique), `p256dh`, `auth`, `user_agent`. `tenant_id` для изоляции.
- **Эндпоинты:** N/A (модель).
- **Зависимости:** `app.database.Base`; FK: `users.id` (CASCADE), `patient_accounts.id` (CASCADE), `tenants.id` (без ondelete). Потребляется сервисом отправки push.
- **Где менять для типовых задач:** новые подписки сотрудников проставляют `user_id`, пациентов — `patient_id` (НЕ `patient_phone` — он legacy). Инвалидация мёртвых endpoint'ов (410 Gone) — в сервисе отправки, по `endpoint`.
- **Подводные камни:** `endpoint` — глобально unique (одно устройство = одна подписка). `user_id`/`patient_id`/`patient_phone` — все nullable; в legacy-записях заполнен только `patient_phone` (по нему и искать старые). `created_at` — `server_default=func.now()` (timezone-aware). `tenant_id` FK без `ondelete`.
- **Строк:** 60
