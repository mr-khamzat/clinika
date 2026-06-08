# models [04] — реферальная воронка, маркетинг, подписки и multi-tenant ядро

Это срез SQLAlchemy-моделей (`backend/app/models/*.py`, файлы 76–100 по алфавиту) — все наследуют `app.database.Base` и описывают ORM-таблицы для PostgreSQL. Группа охватывает три крупных тематических блока МИС:

1. **Реферальная воронка и партнёрские бонусы** — `Referral`, `ReferralComment`, `ReferralTemplate`, `RecruiterBonus`, `Service` (услуги с финмоделью направлений).
2. **Коммуникации и маркетинг** — `SmsTemplate/Campaign/MessageLog`, `StaffChat*` (внутренний чат сотрудников), `SupportMessage`, `Review`, `TelemedicineSession`, `Telephony*`.
3. **Платформа / multi-tenant ядро** — `Tenant`/`TenantLicense`/`TenantBranding`/`TenantModule`/`TenantPlugin`, `TenantApiKey`, `TenantHealthSnapshot`, `TenantMisSubscriptionWebhook`, `SignupRequest`, `SubscriptionPlan*`, `PatientSubscription`, `Regulation*`, `SystemSettings`, `RefreshToken`, `SlotHold`, `Spending`.

Сквозные особенности, которые повторяются почти везде:
- **`tenant_id`** есть почти во всех таблицах — изоляция данных франшизы. Где `nullable=True` — это глобальные шаблоны (управляет super_admin) либо `ondelete="SET NULL"` (запись переживает удаление тенанта). Где `nullable=False` + `CASCADE` — запись жёстко привязана к тенанту.
- **Прозрачное шифрование PII** через `app.services.encryption_service.encrypt/decrypt`: переопределённый `__init__` + property-геттер/сеттер. Шифруются поля `notes`, `text`, `body`, `full_name` (хранятся в колонках `*_encrypted`).
- **Денежные суммы** — всегда `Numeric(precision, 2)` (никогда не `Float`); в Python это `Decimal`.
- **Enum-ы** объявляются через `SAEnum(..., values_callable=lambda x: [e.value for e in x])`, чтобы в БД хранить строковые значения, а не имена.

> Это чистые модели (декларативные таблицы). Эндпоинтов здесь нет — секции «Эндпоинты» опущены за неприменимостью; вместо неё указаны роутеры/сервисы-потребители.

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `recruiter_bonus.py` | Бонус рекрутера: % от бонуса врача | 37 |
| `referral.py` | Центральная модель направления пациента | 104 |
| `referral_comment.py` | Зашифрованный комментарий к направлению | 37 |
| `referral_template.py` | Шаблон направления для менеджера | 68 |
| `refresh_token.py` | Хэши refresh-токенов, ротация устройств | 27 |
| `regulation.py` | SOP-регламенты: версии, назначения, е-подписи | 230 |
| `review.py` | Отзыв пациента с модерацией | 37 |
| `service.py` | Услуга клиники + финмодель направлений | 48 |
| `settings.py` | Глобальный key-value системных настроек | 13 |
| `signup_request.py` | Драфт самостоятельной регистрации франшизы | 91 |
| `slot_hold.py` | Временная бронь слота врача | 24 |
| `sms_marketing.py` | SMS: шаблоны, кампании, лог отправок | 224 |
| `spending.py` | Расходы клиники (бухгалтерия) | 57 |
| `staff_chat.py` | Внутренний чат сотрудников (комнаты/сообщения) | 307 |
| `staff_chat_read.py` | Read-receipts (галочки) для чата сотрудников | 49 |
| `subscription.py` | Подписка пациента «Здоровье+» + история | 79 |
| `subscription_plan.py` | Каталог тарифов подписки (шаблон/override) | 51 |
| `subscription_plan_discount.py` | Дифференцированные скидки тарифа подписки | 60 |
| `support.py` | Сообщение в техподдержку (с файлами) | 22 |
| `telemedicine.py` | Видеоприём: сессия, чат, е-рецепты | 238 |
| `telephony.py` | PSTN-телефония: конфиг, DID, звонки | 78 |
| `tenant.py` | Multi-tenant ядро: тенант, лицензия, брендинг | 165 |
| `tenant_api_key.py` | Внешний API-ключ интеграций тенанта | 42 |
| `tenant_health.py` | Снимки health-score тенанта (churn-риск) | 92 |
| `tenant_mis_subscription_webhook.py` | МИС-вебхуки на события подписки | 54 |

---

## `backend/app/models/recruiter_bonus.py`
- **Назначение:** Начисление рекрутеру процента от бонуса врача, которого он привёл. Часть HR/реферальной экономики платформы.
- **Ключевые элементы:**
  - `RecruiterBonusStatus(str, enum.Enum)`: `PENDING`, `PAID`, `CANCELLED` (последний добавлен в audit Фаза 1 для отмены при отмене направления).
  - `RecruiterBonus(Base)` → таблица `recruiter_bonuses`. Поля: `recruiter_id`, `doctor_id` (оба FK на `users.id`), `referral_id` (FK `referrals`), `source_bonus_id` (FK `bonuses`, SET NULL), `percent_applied` (Numeric 5,2 — снапшот % на момент начисления), `amount` (Numeric 10,2), `status`, `paid_at`.
  - relationships: `recruiter`, `doctor` (оба к `User`, разведены через `foreign_keys`).
- **Зависимости:** FK на `tenants`, `users`, `referrals`, `bonuses`. Логически связан с моделью `Bonus` (через `source_bonus_id`) и `Referral`.
- **Где менять для типовых задач:**
  - Изменить логику жизненного цикла бонуса рекрутера → статусы здесь + сервис начисления (ищи использование `RecruiterBonus`/`source_bonus_id`).
  - Добавить новое поле (например, `notes`) → сюда + Alembic-миграция.
- **Подводные камни:** `percent_applied` — именно snapshot, не живой % рекрутера (иммутабельность для аудита). `tenant_id` тут `SET NULL` + nullable — бонус переживёт удаление тенанта. `amount`/`percent_applied` — `Decimal`, не float.
- **Строк:** 37

## `backend/app/models/referral.py`
- **Назначение:** Центральная модель межклинического направления пациента — сердце реферальной воронки. Описывает весь жизненный цикл: создание → подтверждение → запись → отмена/просрочка, плюс cross-clinic (внутрифраншизные) направления и snapshot партнёрского оффера.
- **Ключевые элементы:**
  - `ReferralStatus(str, enum.Enum)`: `CREATED`, `CONFIRMED`, `EXPIRED`, `CANCEL_REQUESTED`, `CANCELLED`.
  - `Referral(Base)` → `referrals`. Ключевые поля: `from_clinic_id`/`to_clinic_id`, `service_id`, `referral_type` (`service`|`doctor`|`lab`), `target_doctor_id`, `lab_tests`, `patient_phone`/`patient_name`/`mis_patient_id`, `created_by_admin_id`/`confirmed_by_admin_id`, `qr_code`/`patient_qr_code`/`short_code` (unique int), `notes_encrypted`, тайминги `created_at`/`confirmed_at`/`expires_at` (по умолчанию +7 дней), `appointment_at`/`mis_appointment_id`/`mis_doctor_id`.
  - Cancellation: `cancel_reason`, `cancel_requested_at`, `cancelled_at`, `cancelled_by_id`.
  - Cross-clinic (xref01): `target_tenant_id`, `referred_by_tenant_id`, `cross_clinic_status` (отдельный ЖЦ, **не** пересекается с `ReferralStatus`), `cross_clinic_note`, `inter_clinic_invoice_id`.
  - Финмодель: `partner_offer_id` (FK `partner_service_offers`, SET NULL — snapshot для аудита), `bonus_snapshot_amount` (Numeric 10,2).
  - relationships: `from_clinic`/`to_clinic`/`service`/`created_by`/`bonus` (1:1).
  - PII: `notes` шифруется через `__init__`/property → `notes_encrypted`.
- **Зависимости:** FK на `tenants`, `clinics`, `services`, `doctors`, `users`, `partner_service_offers`. `app.services.encryption_service`. Связана с `Bonus`, `RecruiterBonus`, `ReferralComment`.
- **Где менять для типовых задач:**
  - Новый статус направления → `ReferralStatus` + сервис переходов (state-machine) + проверить миграцию enum.
  - Новый тип направления → `referral_type` (сейчас строка, не enum) + валидация в роутере/сервисе.
  - Cross-clinic логика → поля `*_tenant_id` + `cross_clinic_status` (своя строковая машина состояний).
  - SLA/просрочка → `expires_at` тут, расчёт дедлайна — через `Service.sla_days`.
- **Подводные камни:** Два независимых статусных поля (`status` vs `cross_clinic_status`) — не путать. `notes` нельзя фильтровать SQL-ом (зашифровано). `short_code` глобально-unique, не per-tenant. `tenant_id` nullable+SET NULL. `bonus_snapshot_amount`/`partner_offer_id` — намеренные снапшоты, не пересчитывать постфактум.
- **Строк:** 104

## `backend/app/models/referral_comment.py`
- **Назначение:** Зашифрованный текстовый комментарий к направлению (внутренняя переписка/заметки по кейсу).
- **Ключевые элементы:** `ReferralComment(Base)` → `referral_comments`. Поля: `referral_id` (FK), `author_id` (FK `users`), `text_encrypted`, `created_at`. relationship `author`. PII: `text` шифруется через `__init__`/property.
- **Зависимости:** FK `referrals`, `users`. `app.services.encryption_service`.
- **Где менять для типовых задач:** Добавить вложения/типы комментариев → сюда новые поля. Логика добавления — в роутере комментариев направлений.
- **Подводные камни:** `text` зашифрован — нет полнотекстового поиска по SQL. Нет `tenant_id` напрямую — изоляция наследуется через `referral_id` (фильтруй по родительскому `Referral.tenant_id` в запросах).
- **Строк:** 37

## `backend/app/models/referral_template.py`
- **Назначение:** Шаблон направления (Глава 4, mgr_templates01) — менеджер сохраняет частые комбинации (врач + услуги + заметки + приоритет) и применяет одним кликом.
- **Ключевые элементы:** `ReferralTemplate(Base)` → `referral_templates`. Поля: `tenant_id` (NOT NULL, CASCADE), `clinic_id` (nullable → NULL = виден всем клиникам тенанта), `name`, `description`, `payload` (JSONB — заготовка: `target_doctor_id`, `service_ids[]`, `notes`, `priority`, `referral_type`, `lab_tests`), `usage_count` (инкремент в POST /use), `created_by_user_id`, `created_at`/`updated_at`.
- **Зависимости:** FK `tenants`, `clinics`, `users`. Потребляется формой создания направления и сервисом шаблонов.
- **Где менять для типовых задач:**
  - Расширить заготовку шаблона → структура `payload` (JSONB, без миграции схемы) + код применения шаблона.
  - Видимость шаблона → семантика `clinic_id` (NULL = весь тенант).
- **Подводные камни:** `payload` — свободный JSONB, валидация полностью на стороне сервиса (нет схемы в БД). `usage_count` инкрементится вручную в эндпоинте — следи за гонками при параллельных вызовах.
- **Строк:** 68

## `backend/app/models/refresh_token.py`
- **Назначение:** Хранение SHA-256 хэшей refresh-токенов для JWT-аутентификации. Поддержка нескольких устройств на пользователя и детект повторного использования (token rotation / reuse detection).
- **Ключевые элементы:** `RefreshToken(Base)` → `refresh_tokens`. Поля: `user_id` (FK CASCADE), `token_hash` (String(64) unique — SHA-256 hex), `device_info`, `ip`, `expires_at`, `revoked`/`revoked_at`, `replaced_by_id` (self-FK на следующий токен в цепочке ротации), `reused_at` (детект повторного использования), `created_at`.
- **Зависимости:** FK `users`, self-FK. Потребляется auth-сервисом/роутером логина-обновления токена.
- **Где менять для типовых задач:**
  - Изменить политику ротации/реюза → поля `replaced_by_id`/`reused_at` + auth-сервис.
  - Добавить метаданные устройства → `device_info`/новые поля.
- **Подводные камни:** В БД только **хэш** токена (`token_hash`), сырой токен не хранится — при поиске хэшируй входящий токен. Нет `tenant_id` — токен принадлежит `user_id` напрямую.
- **Строк:** 27

## `backend/app/models/regulation.py`
- **Назначение:** «Регламент-конструктор» (Глава 7) — SOP/инструкции для франшиз с версионированием, назначением по ролям/клиникам/пользователям и электронной подписью под версией.
- **Ключевые элементы:** 4 модели + 2 класса-константы:
  - `RegulationStatus` (DRAFT/PUBLISHED/ARCHIVED) и `RegulationStepType` (TEXT/CHECKBOX/ACTION/FILE) — простые строковые константы (не enum.Enum), плюс кортежи `ALLOWED_STEP_TYPES`/`ALLOWED_STATUSES`.
  - `Regulation` → `regulations`: карточка (`tenant_id` NOT NULL CASCADE, `title`, `description`, `category`, `current_version_id` (FK на versions, не enforced FK-объектом), `assigned_roles` JSONB-список ролей, `status`, `created_by_user_id`).
  - `RegulationVersion` → `regulation_versions`: снапшот (`version_number`, `content` JSONB-массив шагов, `changelog`, `published_at`/`published_by_user_id`). UniqueConstraint `(regulation_id, version_number)`.
  - `RegulationAssignment` → `regulation_assignments`: точечное назначение (user_id / clinic_id / оба NULL = «на всех» тенанта).
  - `RegulationCompletion` → `regulation_completions`: е-подпись (`signature_text`, `checkboxes_state` JSONB). UniqueConstraint `(regulation_id, version_id, user_id)`.
- **Зависимости:** FK `tenants`, `regulations`, `regulation_versions`, `users`, `clinics`. Потребляется сервисом регламентов и роутером SOP.
- **Где менять для типовых задач:**
  - Новый тип шага → `RegulationStepType` + `ALLOWED_STEP_TYPES` + рендер на фронте.
  - Новая логика назначения → семантика `user_id`/`clinic_id` в `RegulationAssignment` (см. докстринг класса).
  - Перевыпуск требует переподписания → новая `RegulationVersion` (version_number++) автоматически делает старые `RegulationCompletion` неактуальными.
- **Подводные камни:** `current_version_id` объявлен как простая UUID-колонка **без** `ForeignKey` — целостность держит код, не БД (легаси/намеренно во избежание циклической зависимости). `assigned_roles` и `content` — JSONB без схемы. Уникальность подписи завязана на `version_id` — publish v2 требует переподписания.
- **Строк:** 230

## `backend/app/models/review.py`
- **Назначение:** Отзыв пациента о приёме/враче с модерацией (pending → approved/rejected).
- **Ключевые элементы:** `ReviewStatus(str, enum.Enum)` (PENDING/APPROVED/REJECTED). `Review(Base)` → `reviews`. Поля: `tenant_id` (CASCADE), `appointment_id` (unique, SET NULL — один отзыв на приём), `doctor_id`, `clinic_id`, `patient_name`/`patient_phone`, `rating` (SmallInteger), `comment` (Text, в открытом виде), `status` (String с дефолтом из enum), `moderator_id`/`moderated_at`, `is_anonymous`, `created_at`/`updated_at`.
- **Зависимости:** FK `tenants`, `appointments`, `doctors`, `clinics`, `users`.
- **Где менять для типовых задач:**
  - Шкала оценки → `rating` (сейчас просто SmallInteger, валидация диапазона — в сервисе/схеме).
  - Статусы модерации → `ReviewStatus`.
- **Подводные камни:** `status` — колонка `String(20)` с `default=ReviewStatus.PENDING` (значение enum-объекта), а **не** SAEnum — фактически хранится строка; будь аккуратен при сравнении (сравнивай со строковыми значениями). `appointment_id` unique — гарантирует один отзыв на приём. `comment` не зашифрован (в отличие от других PII-полей группы).
- **Строк:** 37

## `backend/app/models/service.py`
- **Назначение:** Услуга клиники: справочник, синхронизируемый из МИС Renovatio, + финансовая модель направлений (что получит партнёр, комиссия платформы, SLA просрочки).
- **Ключевые элементы:** `Service(Base)` → `services`. Поля: `tenant_id` (SET NULL), `name`, `code`, `clinic_id`, `bonus_amount` (Numeric 10,2), `is_active`. МИС-поля: `mis_id`, `category`, `original_price` (цена из МИС, не трогается), `description`, `preparation`, `prep_instructions` (редактируется клиникой, не перезаписывается МИС), `lab`, `duration`. Бизнес-поля: `sla_days` (default 14 — дедлайн `Referral.created_at + sla_days`), `price` (цена пациенту, редактируется клиникой), `visible_for_referrals` (svcv2_01), `referral_payout` (svcfin01 — что получит источник; NULL = fallback на `bonus_amount`). relationships: `referrals` (back_populates), `clinic`.
- **Зависимости:** FK `tenants`, `clinics`. Связана с `Referral`, `SubscriptionPlanDiscount` (через `service_id`), `Franchise.platform_fee_per_bonus` (минимум комиссии).
- **Где менять для типовых задач:**
  - Цена/комиссия/выплата → `price`/`referral_payout`/`bonus_amount`; помни про fallback `referral_payout → bonus_amount`.
  - SLA направления → `sla_days`.
  - Поля синхронизации с МИС → блок «МИС Renovatio»; **не перезаписывай** `price`/`prep_instructions`/`referral_payout` при синке (это клиентские поля).
- **Подводные камни:** Двойственность цен: `original_price` (МИС, read-only) vs `price` (клиника). Финмодель: `platform_fee = price - referral_payout`, но не меньше `Franchise.platform_fee_per_bonus`; при `referral_payout=NULL` — старая логика через `bonus_amount` (обратная совместимость). Все деньги — `Decimal`. `tenant_id` SET NULL — услуга переживёт удаление тенанта.
- **Строк:** 48

## `backend/app/models/settings.py`
- **Назначение:** Глобальная key-value таблица системных настроек платформы (без привязки к тенанту).
- **Ключевые элементы:** `SystemSettings(Base)` → `system_settings`. PK — `key` (String(100)), `value` (String(500)), `updated_at`.
- **Зависимости:** Нет FK. Самодостаточна.
- **Где менять для типовых задач:** Новая глобальная настройка → просто новая строка (key/value), без миграции схемы. Чтение/запись — через сервис настроек.
- **Подводные камни:** `value` — всегда строка (макс 500 символов); сериализуй сложные значения сам. **Глобально**, нет `tenant_id` — для per-tenant настроек используй `TenantModule`/`TenantPlugin` или брендинг, не эту таблицу.
- **Строк:** 13

## `backend/app/models/signup_request.py`
- **Назначение:** Драфт самостоятельной регистрации франшизы — «шапка» двухфазного wizard-а (`/signup` → `/onboarding/*`): start (OTP) → verify → complete (создание Tenant/User/Clinics).
- **Ключевые элементы:** `SignupRequest(Base)` → `signup_requests`. Поля: контакты (`email`, `phone`, `full_name_encrypted`), идентификаторы тенанта (`franchise_name`, `tenant_slug`), `payload` (JSONB — все шаги wizard-а: клиники, модули, план), OTP (`verification_code`, `attempts`, `verified_at`), связь `tenant_id` (после complete), `status` (draft/verified/completed/failed), антифрод (`ip_address` INET, `user_agent`), `error_message`. PII: `full_name` шифруется.
- **Зависимости:** FK `tenants` (SET NULL). `app.services.encryption_service`. Потребляется onboarding/signup сервисом.
- **Где менять для типовых задач:**
  - Новые поля wizard-а → внутрь `payload` (JSONB), а не в схему таблицы.
  - Логика OTP/антифрода → `verification_code`/`attempts`/`ip_address`.
  - Новый статус процесса → строковое `status`.
- **Подводные камни:** `full_name` зашифровано. `payload` — нетипизированный JSONB. `status` — строка, не enum. Один request может остаться без `tenant_id` если complete упал (`status=failed`, см. `error_message`).
- **Строк:** 91

## `backend/app/models/slot_hold.py`
- **Назначение:** Временная бронь слота врача (TTL-резерв времени, пока менеджер/пациент завершает запись), с конвертацией в реальный приём.
- **Ключевые элементы:** `SlotHold(Base)` → `slot_holds`. Поля: `doctor_id` (FK CASCADE), `appointment_date`/`start_time`/`end_time`, `patient_phone`/`patient_name`, `thread_id` (связь с чатом-тредом), `held_by_user_id`, `hold_expires_at` (индекс — для cleanup-джоба), `converted_to_appointment_id`, `released_at`, `created_at`.
- **Зависимости:** FK `doctors`, `users`. Логически связан с `Appointment` (через `converted_to_appointment_id`, не enforced FK) и чатом (`thread_id`).
- **Где менять для типовых задач:**
  - TTL/логика истечения → `hold_expires_at` + джоб освобождения слотов.
  - Конвертация в приём → `converted_to_appointment_id`/`released_at`.
- **Подводные камни:** **Нет `tenant_id`** — изоляция наследуется через `doctor_id` (фильтруй по тенанту врача). `converted_to_appointment_id`/`thread_id` — UUID без `ForeignKey` (целостность на коде). `end_time` помечен `Mapped[time]`, но `nullable=True` — несоответствие типа аннотации и nullable.
- **Строк:** 24

## `backend/app/models/sms_marketing.py`
- **Назначение:** SMS-маркетинг (модуль W5) — шаблоны сообщений с плейсхолдерами, кампании по сегментам аудитории и append-only лог отправок.
- **Ключевые элементы:** 4 enum + 3 модели:
  - Enums: `SmsCampaignStatus` (draft/scheduled/sending/sent/failed/cancelled), `SmsAudienceType` (sleeping_30d/sleeping_90d/specific_segment/custom_phones/all_patients), `SmsMessageStatus` (queued/sent/delivered/failed/opted_out), `SmsProvider` (smsc/sms_aero/plivo/internal). Все — native_enum в БД.
  - `SmsTemplate` → `sms_templates`: `tenant_id` CASCADE, `name`, `body`, `variables` (JSONB список плейсхолдеров), `is_active`. relationship `campaigns`.
  - `SmsCampaign` → `sms_campaigns`: `template_id` (RESTRICT), `status`, `scheduled_at`/`started_at`/`finished_at`, `audience_type`, `audience_filter` (JSONB), счётчики `total_recipients`/`sent_count`/`failed_count`, `created_by`. relationships `template`/`creator`/`messages` (cascade delete-orphan).
  - `SmsMessageLog` → `sms_messages_log`: `campaign_id` CASCADE, `patient_phone`, `message_text` (финальный текст), `status`, `provider`, `provider_message_id`, `error_message`, `sent_at`/`delivered_at`.
- **Зависимости:** FK `tenants`, `users`, между собой. Потребляется SMS-сервисом и воркером отправки.
- **Где менять для типовых задач:**
  - Новый провайдер → `SmsProvider` enum + адаптер в сервисе (помни про миграцию native enum в PG).
  - Новый тип аудитории → `SmsAudienceType` + логика фильтрации получателей.
  - Новый статус кампании/сообщения → соответствующий enum + миграция.
- **Подводные камни:** Все статусы — **native PostgreSQL enum** (`native_enum=True`, именованные типы) — добавление значения требует `ALTER TYPE` в миграции, не просто кода. `template_id` имеет `ondelete="RESTRICT"` — нельзя удалить шаблон с кампаниями. `SmsMessageLog` append-only — для ретраев. `audience_filter`/`variables` — нетипизированный JSONB.
- **Строк:** 224

## `backend/app/models/spending.py`
- **Назначение:** Расходы клиники (модуль бухгалтерии, Phase 3) — учёт затрат по категориям с отметкой оплаты и повторяемости.
- **Ключевые элементы:** `SpendingCategory` (строковые константы: rent/lab/materials/marketing/utilities/other). `Spending(Base)` → `spendings`. Поля: `tenant_id` (NOT NULL CASCADE), `clinic_id` (NOT NULL CASCADE), `category`, `title`, `amount` (Numeric 12,2 → `Decimal`), `paid_at` (NULL = не оплачено), `due_date`, `is_recurring`, `notes`, `created_by_id`.
- **Зависимости:** FK `tenants`, `clinics`, `users`. Потребляется бухгалтерским сервисом/дашбордом P&L.
- **Где менять для типовых задач:**
  - Новая категория расхода → `SpendingCategory` (просто строка, валидация в сервисе).
  - Логика «оплачено/нет» → `paid_at` (NULL-семантика).
- **Подводные камни:** `category` — строка, не enum в БД (константы только в Python). `amount` — `Decimal(12,2)`, бóльшая точность чем у большинства денежных полей (12 знаков). Оба `tenant_id` и `clinic_id` обязательны и CASCADE.
- **Строк:** 57

## `backend/app/models/staff_chat.py`
- **Назначение:** Внутренний чат сотрудник↔сотрудник (отдельный от пациентского) — комнаты, участники, сообщения, реакции, опросы, файлы-вложения. Поддерживает cross-tenant комнаты в рамках одной франшизы.
- **Ключевые элементы:** Константы типов комнат (`ROOM_TYPE_DIRECT/CLINIC/GROUP/BROADCAST`) + 7 моделей:
  - `StaffChatRoom` → `staff_chat_rooms`: `tenant_id` (CASCADE, всегда = тенант создателя), `franchise_id`/`is_cross_tenant` (cross-tenant комнаты франшизы), `type`, `name`, `clinic_id`, `created_by_id`, `description`, `last_message_at`.
  - `StaffChatMember` → `staff_chat_members`: композитный PK `(room_id, user_id)`, `member_role` (member/admin), `last_read_at`, `muted`, `joined_at`.
  - `StaffChatFile` → `staff_chat_files`: вложения с TTL 48ч (`expires_at`, чистится джобом `cleanup_staff_chat_files`), `storage_path`, `deleted_at`.
  - `StaffChatMessage` → `staff_chat_messages`: `body`, `attachments` (JSONB), `reply_to_id` (self-FK), `edited_at`/`deleted_at`, `mentioned_user_ids` (JSONB), pin (`pinned_at`/`pinned_by_user_id`). Индекс `(room_id, created_at)`.
  - `StaffChatMessageReaction` → `staff_chat_message_reactions`: emoji-реакция.
  - `StaffChatPoll` → `staff_chat_polls`: опрос (`question`, `options` JSONB, `multi_select`, `closes_at`), 1:1 с сообщением (`message_id` unique).
  - `StaffChatPollVote` → `staff_chat_poll_votes`: голос, UniqueConstraint `(poll_id, user_id, option_index)`.
- **Зависимости:** FK `tenants`, `franchises`, `clinics`, `users`, self-FK. RBAC видимости описан в докстринге → реализован в `app.services.staff_chat_service.visible_users_for`. Cleanup-джоб для файлов.
- **Где менять для типовых задач:**
  - Новый тип комнаты → константа `ROOM_TYPE_*` + логика создания/RBAC в сервисе.
  - RBAC «кто кого видит» → **не здесь**, а в `staff_chat_service.visible_users_for` (модель только хранит данные).
  - Cross-tenant логика → `franchise_id`/`is_cross_tenant` + проверки в роутере (нельзя смешивать с per-tenant комнатами).
  - Опросы/реакции/pin → соответствующие модели.
- **Подводные камни:** Cross-tenant: `tenant_id` остаётся обязательным (= создатель), а members могут быть из разных тенантов франшизы — фильтрация по `tenant_id` сломает выборку участников cross-tenant комнаты. Read-state хранится в двух местах: `StaffChatMember.last_read_at` (агрегат) И отдельная модель `StaffChatMessageRead` (см. `staff_chat_read.py`) — не дублируй логику. `attachments`/`options`/`mentioned_user_ids` — JSONB. Single-select голос требует удаления старых голосов на уровне приложения (БД не enforce-ит).
- **Строк:** 307

## `backend/app/models/staff_chat_read.py`
- **Назначение:** Read-receipts (галочки ✓/✓✓) для StaffChat — факт прочтения конкретного сообщения конкретным пользователем.
- **Ключевые элементы:** `StaffChatMessageRead(Base)` → `staff_chat_message_reads`. Поля: `message_id` (CASCADE), `user_id` (CASCADE), `read_at`. UniqueConstraint `(message_id, user_id)` + индексы по обоим FK.
- **Зависимости:** FK `staff_chat_messages`, `users`. Создаётся через `POST /staff-chat/rooms/{room_id}/mark-read` (триггер из UI по IntersectionObserver).
- **Где менять для типовых задач:** Логика отметки прочтения → этот эндпоинт + модель. Для bulk — `INSERT ... ON CONFLICT DO NOTHING` (см. докстринг), не итерируй по ORM-объектам.
- **Подводные камни:** UNIQUE гарантирует идемпотентность upsert-а (один user читает сообщение один раз). Дублирует общий счётчик `StaffChatMember.last_read_at` — два уровня read-state, держи их согласованными. Нет `tenant_id` — изоляция через `message → room → tenant_id`.
- **Строк:** 49

## `backend/app/models/subscription.py`
- **Назначение:** Подписка пациента «Здоровье+» (Глава 9) — планы health_plus/family_plus/pro + append-only история событий подписки.
- **Ключевые элементы:**
  - `PatientSubscription` → `patient_subscriptions`: `tenant_id` (SET NULL), `patient_id` (FK `patient_accounts`, CASCADE), `plan` (health_plus/family_plus/pro — строка), `status` (active/paused/cancelled/expired/trial — строка, default trial), `started_at`/`expires_at`, `auto_renew`, `price_monthly` (Numeric 10,2), `payment_method`, `external_subscription_id`.
  - `PatientSubscriptionHistory` → `patient_subscription_history`: `subscription_id` (CASCADE), `event` (created/activated/renewed/paused/cancelled/expired/payment_failed/resumed — строка), `amount`, `note`.
- **Зависимости:** FK `tenants`, `patient_accounts`, между собой. Связана с `SubscriptionPlan` (через `plan`-ключ), `TenantMisSubscriptionWebhook` (события подписки шлются как вебхуки).
- **Где менять для типовых задач:**
  - Новый план → строка в `plan` + запись в каталоге `SubscriptionPlan` (отдельная таблица).
  - Новый статус/событие → строковые значения `status`/`event` (валидация в сервисе).
  - Биллинг/автопродление → `auto_renew`/`expires_at`/`external_subscription_id` + сервис подписок.
- **Подводные камни:** `plan`/`status`/`event` — **строки, не enum** (валидных значений в БД нет, ответственность на сервисе). `price_monthly` тут — фактическая цена подписки (snapshot), не путать с каталожной `SubscriptionPlan.price_monthly`. `tenant_id` SET NULL. История — append-only (источник правды для аудита и вебхуков).
- **Строк:** 79

## `backend/app/models/subscription_plan.py`
- **Назначение:** Каталог тарифов подписки «Здоровье+» (миграция subplans01) — глобальные шаблоны (управляет super_admin) и tenant-override (franchise_owner).
- **Ключевые элементы:** `SubscriptionPlan(Base)` → `subscription_plans`. Поля: `plan_key` (индекс), `tenant_id` (NULL = глобальный шаблон, CASCADE), `title`, `description`, `price_monthly` (Numeric 10,2 NOT NULL), `price_annual`, `trial_days` (default 7), `benefits` (JSONB список), `features` (JSONB словарь), `is_active`, `sort_order`.
- **Зависимости:** FK `tenants`. Связана с `PatientSubscription` (через `plan_key`), `SubscriptionPlanDiscount` (через `plan_key`).
- **Где менять для типовых задач:**
  - Новый тариф/фича → запись в каталоге; `features` (JSONB) — флаги фич плана.
  - Логика «эффективного плана» → override (`tenant_id IS NOT NULL`) поверх шаблона (`tenant_id IS NULL`) — реализована в сервисе, не в модели.
- **Подводные камни:** Дуализм записей: глобальный шаблон vs tenant-override по одному `plan_key` — `effective_plan` мёржит их в сервисе. `benefits` (список) и `features` (словарь) — разные JSONB-структуры, не путать. `tenant_id` CASCADE (override удаляется вместе с тенантом, шаблон — нет).
- **Строк:** 51

## `backend/app/models/subscription_plan_discount.py`
- **Назначение:** Дифференцированные скидки тарифа подписки (миграция discountrules01) — % скидки на все услуги / категорию / конкретную услугу.
- **Ключевые элементы:** `SubscriptionPlanDiscount(Base)` → `subscription_plan_discounts`. Поля: `tenant_id` (NULL = глобальное правило super_admin, CASCADE), `plan_key`, `scope` (all/category/service), `category_id`/`category_name` (для scope=category), `service_id` (FK `services`, для scope=service), `discount_percent` (Numeric 5,2), `is_active`.
- **Зависимости:** FK `tenants`, `services`. Связана с `SubscriptionPlan` (`plan_key`), `Service`.
- **Где менять для типовых задач:**
  - Новый scope скидки → значения `scope` + логика применения (приоритет: service > category > all) в сервисе расчёта цены.
  - Глобальное vs tenant-правило → `tenant_id` NULL/NOT NULL (tenant приоритетнее).
- **Подводные камни:** `scope` — строка без enum. Категория представлена двумя полями (`category_id` + `category_name`) т.к. `services.category` — строка (нет отдельной таблицы категорий — `category_id` зарезервирован «на будущее»). Tenant-правило **приоритетнее** глобального — порядок применения на стороне сервиса. `discount_percent` — `Decimal(5,2)`.
- **Строк:** 60

## `backend/app/models/support.py`
- **Назначение:** Сообщение в техподдержку — простой тред пользователь↔саппорт с поддержкой файлов.
- **Ключевые элементы:** `SupportMessage(Base)` → `support_messages`. **PK — `Integer` autoincrement** (не UUID, в отличие от остальной группы). Поля: `user_id` (FK `users`), `text`, `is_from_user` (направление), `is_read`, `created_at`, файлы (`file_path`/`file_name`/`file_type` — image|document).
- **Зависимости:** FK `users`. Потребляется роутером/сервисом поддержки.
- **Где менять для типовых задач:**
  - Вложения → `file_*` поля.
  - Статус прочтения/направление → `is_read`/`is_from_user`.
- **Подводные камни:** **Integer-PK** — расходится с UUID-конвенцией проекта (легаси/упрощение). **Нет `tenant_id`** — изоляция только через `user_id`; для multi-tenant фильтрации джойни через пользователя. `text` не зашифрован.
- **Строк:** 22

## `backend/app/models/telemedicine.py`
- **Назначение:** Телемедицина (Этап 1, модуль 4990₽/мес) — WebRTC видеоприём врач↔пациент с join-токеном, чатом внутри звонка и электронно-подписанными рецептами.
- **Ключевые элементы:** 2 enum + 3 модели:
  - `TelemedicineSessionStatus` (scheduled/active/ended/expired/no_show), `TelemedicineChatRole` (doctor/patient/system) — native enum.
  - `TelemedicineSession` → `telemedicine_sessions`: `tenant_id` (CASCADE), `appointment_id` (опционально — возможна ad-hoc), `doctor_id`, `patient_phone`, `room_id` (uuid hex, public WebRTC-комната, unique), `join_token_hash` (SHA-256 от JWT — сам JWT не хранится), `status`, тайминги, `duration_seconds`, `recording_enabled` (default False — 152-ФЗ), `recording_path`/`chat_log_path`, `notes_encrypted`. relationships: `tenant`/`appointment`/`doctor`/`chat_messages`/`prescriptions` (cascade). PII: `notes`.
  - `TelemedicineChatMessage` → `telemedicine_chat_messages`: `from_role`, `text`, файл (`file_path`/`file_mime`/`file_size_bytes` BigInteger).
  - `TelemedicinePrescription` → `telemedicine_prescriptions`: `body_encrypted` (Markdown), `signature_hash` (HMAC-SHA256 от body+signed_at+signed_by), `signed_at`/`signed_by_user_id`, `pdf_path`, `sent_to_patient_at`. PII: `body`.
- **Зависимости:** FK `tenants`, `appointments`, `doctors`, `users`, между собой. `app.services.encryption_service`. Потребляется WebRTC-сигналингом и PDF-генератором рецептов.
- **Где менять для типовых задач:**
  - Логика статусов звонка → `TelemedicineSessionStatus` + сигналинг-сервис.
  - Е-подпись рецепта → `signature_hash` (формула HMAC в комментарии) + сервис подписи.
  - Запись звонка → `recording_enabled`/`recording_path` (по умолчанию **выкл** ради 152-ФЗ — не включай молча).
- **Подводные камни:** `join_token_hash` — только хэш JWT (сырой токен отдаётся один раз). `notes`/`body` зашифрованы. Статусы/роли — native PG enum (миграция при добавлении значений). `signature_hash` иммутабельна (подпись над содержимым+метаданными) — изменение рецепта инвалидирует подпись.
- **Строк:** 238

## `backend/app/models/telephony.py`
- **Назначение:** PSTN-телефония — конфиг провайдера, виртуальные номера (DID) и журнал звонков.
- **Ключевые элементы:** 3 модели:
  - `TelephonyConfig` → `telephony_configs`: `tenant_id` (unique CASCADE — один конфиг на тенант), `provider` (default "null" = заглушка), `api_url`, `api_key_encrypted`/`api_secret_encrypted`, `is_active`, `features` (JSONB).
  - `DidNumber` → `did_numbers`: `tenant_id`, `clinic_id`, `number`, `display_name`, `default_assignee_id`, `ivr_config` (JSONB), `record_calls`, `is_active`. UniqueConstraint `(tenant_id, number)`.
  - `PhoneCall` → `phone_calls`: `tenant_id`, `clinic_id`, `direction` (in/out), `external_number`, `internal_did`, `operator_id`, `patient_id` (FK `patient_accounts`), тайминги, `duration_sec`, `status` (default initiated), `recording_url`, `provider_call_id`, `notes`.
- **Зависимости:** FK `tenants`, `clinics`, `users`, `patient_accounts`. Потребляется телефонным адаптером/вебхуками провайдера.
- **Где менять для типовых задач:**
  - Новый провайдер → `provider` (строка) + адаптер; креды кладутся в `api_*_encrypted`.
  - IVR-маршрутизация → `ivr_config` (JSONB) на `DidNumber`.
  - Статусы звонка → строковое `status` на `PhoneCall`.
- **Подводные камни:** Креды провайдера **зашифрованы** (`api_key_encrypted`/`api_secret_encrypted`) — но **без** property-обёрток (в отличие от PII-полей других моделей): шифрование/дешифровка делается явно в сервисе, не на уровне модели. `provider`/`status`/`direction` — строки без enum. `TelephonyConfig.tenant_id` unique — строго один конфиг на тенант.
- **Строк:** 78

## `backend/app/models/tenant.py`
- **Назначение:** Multi-tenant ядро платформы — тенант (город/франшиза-точка), его лицензия (план + лимиты + фичи), брендинг (white-label), а также per-tenant переопределения модулей и плагинов. Здесь же — реквизиты юрлица, churn-трекинг и self-service onboarding.
- **Ключевые элементы:** 5 моделей:
  - `Tenant` → `tenants`: `name`, `slug` (unique), `domain` (unique), `is_active`, `franchise_owner_id`, `franchise_id` (NULL = независимый), большой блок реквизитов юрлица (`legal_*`, банк, подписант, печать), `royalty_percent` (Numeric 5,2), `mis_clinic_ids` (JSONB — клиники в МИС Renovatio), onboarding (`trial_ends_at`/`onboarded_at`/`onboarding_source`), churn (`churned_at`/`churn_reason`). relationships: `license` (1:1), `branding` (1:1), `franchise`.
  - `TenantLicense` → `tenant_licenses`: `tenant_id` (unique CASCADE), `plan` (basic/professional/enterprise), `max_clinics`/`max_users`, `features` (JSONB флаги), `valid_from`/`valid_until` (NULL=бессрочно), `is_active`.
  - `TenantBranding` → `tenant_branding`: цвета/шрифт/лого + white-label CMS (`custom_domain`/`domain_verified`, meta-теги, `hide_menu_items`/`rename_menu_items` JSONB).
  - `TenantModule` → `tenant_modules`: переопределение фичи (`module`, `enabled`, `config` JSONB).
  - `TenantPlugin` → `tenant_plugins`: плагин (`plugin`, `enabled`, `config`) + биллинг (`trial_until`/`paid_until`/`price_monthly`).
- **Зависимости:** FK `users`, `franchises`, между собой. Базовая таблица для **всех** `tenant_id` в проекте. Связана с `Franchise`, `SubscriptionPlan`, `TenantHealthSnapshot`, и т.д.
- **Где менять для типовых задач:**
  - Новый план/лимит → `TenantLicense.plan`/`max_*`/`features`.
  - White-label → `TenantBranding`.
  - Вкл/выкл фичу per-tenant → `TenantModule` (override поверх лицензии).
  - Churn-аналитика → `churned_at`/`churn_reason` (заполняются `POST /admin/tenants/{id}/churn`).
  - Реквизиты для документов/счетов → блок `legal_*` + `stamp_url`.
- **Подводные камни:** `plan` лицензии — **строка**, не enum. `features` есть и в `TenantLicense` (план), и в `TenantModule` (override) — приоритет override решается в сервисе доступа к фичам, не в модели. `TenantPlugin.price_monthly` объявлен без явного типа колонки (`Mapped[float|None] = mapped_column(nullable=True)`) — SQLAlchemy выведет тип из аннотации (Float); для денег это потенциально нежелательно (float вместо Numeric). `royalty_percent` — Decimal. `mis_clinic_ids` NULL = МИС не настроен.
- **Строк:** 165

## `backend/app/models/tenant_api_key.py`
- **Назначение:** Внешний API-ключ для интеграций тенанта (CRM/BI и пр.) с scope-ами, IP-allowlist и аудитом использования.
- **Ключевые элементы:** `TenantApiKey(Base)` → `tenant_api_keys`. Поля: `tenant_id` (CASCADE), `key_hash` (SHA-256 hex, unique — хранится только хэш), `key_prefix` (`clk_live_<8>` для UI), `name`, `scopes` (JSONB список `read:*`/`write:*`), `created_by_id`, `last_used_at`/`last_used_ip`, `expires_at`, `revoked_at`, `allowed_ips` (JSONB IP-allowlist, NULL=любой), `request_count`.
- **Зависимости:** FK `tenants`, `users`. Потребляется middleware/depends аутентификации внешнего API.
- **Где менять для типовых задач:**
  - Новый scope → значения в `scopes` (JSONB) + проверка в guard внешнего API.
  - Ротация/отзыв → `revoked_at`/`expires_at`.
  - IP-ограничения → `allowed_ips`.
- **Подводные камни:** В БД только **хэш** ключа — при проверке хэшируй входящий ключ и ищи по `key_hash`. Сырой ключ показывается один раз при создании. `scopes`/`allowed_ips` — нетипизированный JSONB. `request_count` инкрементится в hot-path — следи за нагрузкой/гонками.
- **Строк:** 42

## `backend/app/models/tenant_health.py`
- **Назначение:** Tenant Health Score — append-only ежедневные снимки «здоровья» тенанта (риск оттока). Считается джобом через `tenant_health_service`.
- **Ключевые элементы:** `TenantHealthAlertLevel(str, enum.Enum)` (green/yellow/red). `TenantHealthSnapshot(Base)` → `tenant_health_snapshots`. Поля: `tenant_id` (CASCADE), `captured_at` (индекс), `score` (Integer 0..100), `factors` (JSONB — `activity_30d`, `payment_status`, `churn_risk_pct`, `support_tickets_30d`, `feature_adoption_pct`, `users_active_pct`, `_source`=real/stub), `alert_level` (денормализован для фильтра /alerts). Композитный индекс `(tenant_id, captured_at)`.
- **Зависимости:** FK `tenants`. Считается `app.services.tenant_health_service`, показывается в админке (тренды, `/alerts`).
- **Где менять для типовых задач:**
  - Новый фактор score → ключ в `factors` (JSONB) + формула в `tenant_health_service`.
  - Пороги alert-уровней → значения green/yellow/red задаются в сервисе (модель только хранит вычисленный `alert_level`); пороги (70/40) описаны в докстринге.
- **Подводные камни:** Append-only — сотни строк на тенант (по одной в день); для «последнего снимка» используй `DISTINCT ON (tenant_id) ... ORDER BY captured_at DESC` (под это и заточен индекс). `alert_level` использует `create_type=False` — тип enum создаётся отдельной миграцией, не автогенерацией модели. `_source: stub` означает заглушечные данные — фильтруй в реальной аналитике. `factors` без схемы.
- **Строк:** 92

## `backend/app/models/tenant_mis_subscription_webhook.py`
- **Назначение:** Конфиг исходящих вебхуков на внешние МИС при событиях подписки (активация наличными/онлайн, автопродление, отмена). Миграция miswebhook01.
- **Ключевые элементы:** `TenantMisSubscriptionWebhook(Base)` → `tenant_mis_subscription_webhooks`. Поля: `tenant_id` (CASCADE), `mis_type`, `webhook_url`, `auth_header`, `events` (JSONB, default `["subscription.activated","subscription.cancelled"]`), `is_active`, `last_success_at`, `last_error`/`last_error_at`, `retry_count`.
- **Зависимости:** FK `tenants`. Триггерится из `subscription_cash_service` / `patient_subscription` сервисов; доставка — сервисом отправки вебхуков с ретраями.
- **Где менять для типовых задач:**
  - Новый тип события → значения в `events` (JSONB) + публикация события в сервисе подписок.
  - Логика ретраев/мониторинга → `retry_count`/`last_error`/`last_success_at`.
- **Подводные камни:** `events` — JSONB-список строк (нет enum). `auth_header` хранится в **открытом** виде (не зашифрован) — если туда кладётся секрет, это риск (в отличие от `TenantApiKey`/телефонии). Нет `id`-уникальности по URL — возможны дубли endpoint-ов на тенант.
- **Строк:** 54

---

### Сводные риски/наблюдения по группе

- **Несогласованность enum vs строка:** часть моделей использует настоящие `SAEnum` (sms_marketing, telemedicine, tenant_health, recruiter_bonus, review-enum, referral), а часть хранит статусы/планы как `String` с дефолтом-строкой (subscription, subscription_plan_discount, tenant.license.plan, telephony, signup_request, regulation). При фильтрации сравнивай со строковыми значениями, не с именами enum.
- **Native PG enum** (sms_marketing, telemedicine) и `create_type=False` (tenant_health) требуют ручных миграций `ALTER TYPE` при добавлении значений — нельзя ограничиться кодом.
- **Шифрование PII** живёт в моделях через `__init__`/property (referral, referral_comment, signup_request, telemedicine), НО `telephony` и `tenant_mis_subscription_webhook` хранят секреты/заголовки явно (telephony — зашифрованно без обёрток, webhook `auth_header` — вовсе открыто).
- **Отсутствие `tenant_id`** в нескольких таблицах (refresh_token, support, slot_hold, referral_comment, staff_chat_read, telemedicine-child) — изоляция наследуется через родительский FK; не забывай джойнить при multi-tenant выборках.
- **Float-риск:** `TenantPlugin.price_monthly` объявлен без `Numeric` (выведется как Float) — для денежного поля это потенциальная неточность.
