# DATA-MODEL — модель данных «КлиникСеть» (clinika)

> Обзор ORM-слоя `backend/app/models/*` (≈100 файлов, SQLAlchemy 2.0 декларативный стиль:
> `Mapped[...]` + `mapped_column(...)`). Все классы наследуют `app.database.Base`.
> БД — PostgreSQL через `asyncpg` (async SQLAlchemy, пул 10+20, `pool_pre_ping`).
> Источники: `ref/models-01..05.md`, `backend/app/database.py`, `backend/alembic/versions/*` (>100 миграций, head-цепочка от `bdc4ea7233ff` initial_schema).

---

## 1. Общие соглашения схемы

- **PK** — `postgresql.UUID(as_uuid=True)`, `default=uuid.uuid4` (генерация на стороне Python, не БД). Исключения-легаси: `SupportMessage` (Integer autoincrement), `SystemSettings` (PK = `key`), несколько таблиц с PK = `user_id`/`patient_id`.
- **Деньги** — всегда `Numeric(precision, 2)` → Python `Decimal`, **никогда float** (см. раздел 4 с известными исключениями).
- **Полугибкие поля** — `JSONB` (`config`, `payload`, `factors`, `features`, `metrics`, `attachments`). Известный класс багов: **Decimal нельзя класть в JSONB** напрямую — сериализовать в str/float до записи.
- **Время** — преобладает naive `datetime.utcnow` (UTC). Часть новых таблиц использует `DateTime(timezone=True)` / `TIMESTAMP(timezone=True)`. **Несогласованность tz** — подводный камень при сравнении timestamp'ов (особенно chat SLA-поля naive vs основные aware).
- **Статусы/перечисления** — три сосуществующих подхода: (а) класс-константа `class XStatus: ...` со строками; (б) `enum.Enum` + `SAEnum(native_enum=False)` (хранится строкой); (в) `SAEnum(native_enum=True)` → нативный PG-тип (требует `ALTER TYPE` в миграции при добавлении значения). Подход (в) у `sms_marketing`, `telemedicine`, `call_recording`, `feature_flag`, частично `inventory`/`tenant_health` (через `create_type=False`).
- **Append-only журналы** (нельзя UPDATE/DELETE — инвариант дисциплины кода, не БД): `audit_log`, `billing_ledger`, `ledger_entries`, `loyalty_transactions`, `consent_records`, `inventory_movements`, `patient_subscription_history`, `sms_messages_log`, `tenant_health_snapshots`.

---

## 2. Домены и ключевые сущности

### 2.1. Multi-tenant ядро (платформа)
| Сущность | Таблица | Роль |
|----------|---------|------|
| `Tenant` | `tenants` | Арендатор (город/точка франшизы). Реквизиты юрлица (`legal_*`, банк, печать), `royalty_percent`, `mis_clinic_ids` (JSONB), churn/onboarding. Базовый якорь для **всех** `tenant_id`. |
| `TenantLicense` | `tenant_licenses` | План (basic/professional/enterprise), `max_clinics`/`max_users`, `features` JSONB. 1:1 с tenant. |
| `TenantBranding` | `tenant_branding` | White-label: цвета/лого/домен, CMS-меню. |
| `TenantModule` / `TenantPlugin` | `tenant_modules` / `tenant_plugins` | Override фич/плагинов per-tenant (+ биллинг плагина). |
| `User` | `users` | Сотрудник И пациент. `UserRole` — 16 ролей (super_admin, franchise_owner, manager, doctor, reg, nurse, recruiter, partner_doctor, visiting_doctor, acquisition_manager, patient, director, deputy_director, accountant, lab_ct, lab_xray). PII: `address_encrypted`. |
| `TenantApiKey`, `TenantPermissionOverride`, `TenantHealthSnapshot`, `TenantVisibility`, `FeatureFlag`/`TenantFeatureFlag` | — | Внешний API, RBAC-override, churn-score, матрица видимости тенантов, фиче-флаги. |

### 2.2. Франшизы (уровень между платформой и тенантом)
Иерархия: **Платформа → Франшиза → Тенант → Клиника**.
- `Franchise` (`franchises`) — бренд, биллинг (`fee_per_bonus_from_clinic`, `platform_fee_per_bonus`, `min_bonus_amount`), Region Lock (`allowed_region`, `region_strict`), ручная блокировка, onboarding-wizard.
- `FranchiseInvoice` — счёт Платформа→Франшиза (за начисленные бонусы).
- `FranchiseModuleGrant` + `FranchiseInternalAct` — выдача модулей подтенантам + внутренний акт Франшиза→Клиника.
- `FranchiseIpAllowlist` — IP-whitelist (тип `INET`), обход Region Lock / блокировки.
- `SignupRequest` — драфт самостоятельной регистрации франшизы (PII: `full_name_encrypted`).

### 2.3. Клиника, врач, запись/приём (ядро МИС)
- `Clinic` (`clinics`) — филиал тенанта: реквизиты, гео (`city_id` FK + денормализованные `city`/`region`/lat/lon), per-clinic настройки МИС (`mis_type` renovatio/medods/medai, `mis_api_key`), контракт партнёра (royalty/per_referral/hybrid).
- `City`, `ClinicSchedule` — справочник городов (глобальный, без tenant_id), расписание работы (время строкой "HH:MM").
- `Doctor` (`doctors`) — врач: `clinic_id`, `user_id` (unique), реферальные бонусы «к этому врачу», `visit_price`.
- `DoctorSchedule` — шаблонное расписание врача.
- `Appointment` (`appointments`) — **самая нагруженная таблица**: денормализованные `patient_phone`/`patient_name` (не FK!), дата/время, статус (`AppointmentStatus`), оплата (`payment_method`, `price`), скидка по подписке, QR/`short_code` (глобально unique), `source`.
- `SlotHold` — TTL-бронь слота. `AppointmentOutcome` (**шифрованное** заключение/рекомендации, 1:1 с приёмом), `AppointmentAttachment`, `InternalReferral`.
- `AppointmentCost` (`inventory.py`) — себестоимость приёма с **GENERATED-колонками** (`total_cost`/`margin` на стороне PG).

### 2.4. Реферальная воронка (сердце бизнес-модели)
- `Referral` (`referrals`) — межклиническое направление пациента. Два независимых статусных поля: `status` (`ReferralStatus`) и `cross_clinic_status`. PII: `notes_encrypted`. Финмодель: `partner_offer_id`, `bonus_snapshot_amount` (снапшоты для аудита).
- `ReferralComment` (PII: `text_encrypted`), `ReferralTemplate`, `Service` (услуга + `referral_payout`/`bonus_amount`, `sla_days`), `PartnerCategory`/`PartnerServiceOffer` (cross-clinic прайс).
- `Bonus`, `RecruiterBonus` — бонусы за подтверждённые направления (статусы PENDING/PAID/CANCELLED).

### 2.5. Биллинг и платежи (две независимые подсистемы!)
**Биллинг платформы (тенант → платформа):**
- `Subscription → Invoice → Payment` (`billing.py`) — иерархия подписки SaaS. `Invoice` содержит B2B-акты (act_number/status, налоги subtotal/tax/total, реквизиты).
- `BillingLedger` (`billing_ledger`) — append-only финреестр платформы с revenue-split (self-FK `split_parent_id`, `split_actor` platform/tenant/franchise).
- `TenantPlan`/`TenantPricingRules` (`billing_plan.py`) — БД-каталог тарифов и split-проценты.
- `CommercialModule`/`TenantModuleSubscription` — маркетплейс платных модулей.
- ⚠️ **Дублирование цен:** хардкод `PLAN_PRICES` в `billing.py` **И** БД-каталог `TenantPlan` — два источника истины.

**Платежи клиники (пациент → клиника):**
- `ClinicPayment`/`PaymentGatewayConfig` (`payments_clinic.py`) — эквайринг (yookassa/tinkoff/sber/cloudpayments/robokassa). Креды: `secret_key_encrypted` (Fernet).
- `FiscalReceipt`/`OFDConfig` — фискализация 54-ФЗ (ОФД: platforma/perv/takskom/atol_online). `api_key_encrypted`.
- `LedgerEntry` (`ledger.py`) — append-only баланс пользователя (бонусы/выплаты, клиентская сторона).
- `CashShift`/`CashShiftEntry` — кассовая смена клиники (Z-отчёт).
- `Spending` — расходы клиники. `Discount`, `SubscriptionPlanDiscount` — скидки.
- `InterClinicInvoice` — межклиничный счёт с workflow согласования (партиальный UNIQUE `uq_ici_referral_id`).
- `MisPaymentImport` — дедуп импорта платежей из МИС (UNIQUE по `(mis_clinic_id, mis_payment_id)` **без tenant_id**).

> ⚠️ Не путать `billing.Payment` (подписки платформы) и `payments_clinic.ClinicPayment` (оплата пациента клинике).

### 2.6. Пациент, ПДн и портал
- `PatientAccount` (`patient_accounts`) — **центральная личность пациента, БЕЗ tenant_id** (кросс-тенантная сущность, ключ — `phone` глобально unique). `PatientOTP`, `PatientSession` (refresh-хэш), `PatientCalendarToken`.
- Медкарта: `PatientDiagnosis`/`PatientAllergy`/`PatientVaccination` (`medcard.py`), `PatientVital` (витальные), `PatientDocument` (**PII: `description_encrypted`**, файлы на диске), `PatientPrescriptionCache`.
- CRM/лояльность: `engagement.py` (теги/сегменты/push/NPS), **две параллельные системы лояльности** — `loyalty.py` (по `patient_phone`) и `loyalty_ext.py` (по `patient_account_id`) — риск двойного начисления.
- Подписки пациента: `PatientSubscription` (Здоровье+) + `PatientSubscriptionHistory` (append-only), `PendingSubscriptionRequest`, `SubscriptionPlan`.
- Семья: `FamilyGroup`/`FamilyMember`/`FamilyInvite` (UUID, Глава 8) и легаси `PatientFamilyMember` (по телефонам).

### 2.7. Чаты
- `PatientChat`/`PatientChatMessage` (`patient_chat.py`) — гибрид AI+регистратура (одна ветка = телефон×тенант).
- `ChatThread`/`ChatMessage`/`ChatMessageReaction` (`chat.py`) — чат пациент↔клиника с SLA-эскалацией.
- `StaffChat*` (`staff_chat.py`, 7 моделей) — внутренний чат сотрудников, cross-tenant в рамках франшизы + `StaffChatMessageRead`.
- `AiConversation`/`AiMessage`, `PatientAIConversation`, `AIKnowledgeEntry`, `AIDoctorLog` — AI-диалоги (учёт токенов/cost_usd).
- Настройки/шаблоны: `ChatGlobalSettings`, `ChatMessageTemplate`, `MessageTemplate`, `ChatPromoCode`.

### 2.8. Лаборатория, склад, телемедицина, телефония
- **Лаборатория** `lab.py`: `LabProvider` (gemotest/invitro/kdl/citilab; `api_key_encrypted`), `LabOrder` (**PII: `notes_encrypted`**), `LabResult`. ⚠️ `doctor_id` → `doctors.id`.
- **Склад** `inventory.py` (9 таблиц, самый большой файл): `InventoryItem`, `InventoryStock`, `InventoryMovement` (append-only), `InventoryImportLog` (журнал импорта Excel/CSV/1С — для аудита и отката), `InventoryBatch` (FIFO), `Supplier`, `InventoryReceipt`, `ServiceConsumable`, `AppointmentCost`. Количества `Numeric(12,3)`, деньги `Numeric(12,2)`.
- **Телемедицина** `telemedicine.py`: `TelemedicineSession` (WebRTC, `join_token_hash` SHA-256, **PII: `notes_encrypted`**), `TelemedicineChatMessage`, `TelemedicinePrescription` (`body_encrypted` + `signature_hash` HMAC).
- **Телефония** `telephony.py`: `TelephonyConfig`/`DidNumber`/`PhoneCall` (креды `api_key_encrypted`). `CallRecording`/`CallTranscript` (Whisper), `CallLog`, `CallRule`/`CallPermission`.

### 2.9. Маркетинг, реклама, аудит, системное
- Маркетинг: `MarketingChannel`/`AdSpendEntry`/`PatientAttribution` (UTM), `Ad`/`AdEvent` (CPC/CPM, `ip_hash` SHA-256 — raw IP не хранится, 152-ФЗ), `SmsTemplate`/`SmsCampaign`/`SmsMessageLog`.
- Аудит: `AuditEntry` (`audit_log`, before/after JSONB, гео `Numeric(9,6)`), `ActivityLog`, `ConsentRecord` (152-ФЗ).
- Интеграции/инфра: `MisOutbox` (очередь МИС, без FK/tenant_id), `Webhook*`, `PushSubscription` (VAPID), `ModuleHealthCheck`, `BlockedIp`, `PasswordResetToken`/`RefreshToken` (хранятся хэши), `Wiki*`, `WellnessPartner`, `Aggregator*`.

---

## 3. Мультитенантность на уровне моделей

### 3.1. Изоляция через RLS (PostgreSQL Row-Level Security)
- `database.py`: `get_db()` — суперадмин-сессия (`app.tenant_id` не установлен → RLS пропускает все строки). `get_db_for_tenant(tenant_id)` — выставляет `SET LOCAL app.tenant_id` через `set_config(..., is_local=true)` с **bind-параметром** (исправлена P1-уязвимость с f-string SQL-injection).
- ⚠️ **КРИТИЧНАЯ НАХОДКА АУДИТА:** RLS-политика (`tenant_isolation`) включена миграцией `l2m3n4o5p6q7` **только на 3 таблицах**: `referrals`, `bonuses`, `audit_log`. Десятки других таблиц с `tenant_id` (appointments, doctors, chat_*, invoices, ledger, inventory, …) **не защищены RLS на уровне БД** — изоляция держится только на дисциплине фильтрации в роутерах/сервисах. Утечка между тенантами при пропущенном `WHERE tenant_id` не блокируется БД.
- Политика разрешает строку, если: `tenant_id IS NULL` ИЛИ `app.tenant_id` не задан/пуст (суперадмин) ИЛИ `tenant_id::text = app.tenant_id`.

### 3.2. Колонки изоляции
- **`tenant_id`** — в большинстве бизнес-таблиц. У пользовательских/исторических данных часто `nullable=True` + `ondelete="SET NULL"` (запись переживает удаление тенанта); у новых модулей — `nullable=False` + `CASCADE`.
- **`clinic_id`** — изоляция второго уровня (филиал). У ряда таблиц изоляция идёт **только** через `clinic_id` (clinic_schedules) или через родительский FK.
- **Таблицы БЕЗ `tenant_id`** (изоляция косвенная или глобальная): `patient_accounts` (кросс-тенантный пациент!), `cities`, `clinic_schedules`, `consent_records`, `blocked_ip`, `platform_announcements`, `wiki_*`, `wellness_*`, `settings`, `support_messages`, `refresh_tokens`, `password_reset_tokens`, `slot_holds`, `referral_comments`, `staff_chat_message_reads`, `manager_clinic_access`, `mis_outbox`, телемед-дочерние. → При multi-tenant выборках обязателен JOIN к родителю; **`manager_clinic_access` без tenant_id = риск cross-tenant дыры**, если сервис не проверит принадлежность клиники.

### 3.3. Индексы на FK — находка аудита
- ⚠️ **Большинство FK-колонок исходно были БЕЗ индексов.** Миграция `dbidx01` (Phase 4) добавила btree-индексы **всего на 15 FK** (`CREATE INDEX CONCURRENTLY IF NOT EXISTS`): clinic_schedules.clinic_id, discounts.{created_by_id,clinic_id,service_id}, referral_comments.{referral_id,author_id}, appointments.{referral_id,created_by_id}, ledger_entries.created_by_id, wiki_pages.{parent_id,created_by_id}, activity_log.user_id, wiki_images.page_id, tenants.franchise_owner_id, invitations.clinic_id.
- Остальные FK (десятки колонок `tenant_id`, `clinic_id`, `patient_id`, self-FK) — индексируются точечно в моделях через `__table_args__`/`Index(...)`, но **системного покрытия нет** → потенциальные seq-scan и блокировки при `ON DELETE CASCADE`.
- Часть критичных индексов задаётся **в миграциях, а не в моделях** (невидимо при чтении ORM): partial unique `cash_shifts WHERE status='open'`, partial unique `uq_ici_referral_id WHERE referral_id IS NOT NULL`, нативные ENUM-типы, GENERATED-колонки.

---

## 4. Денежные поля, типы, nullable, каскады

### 4.1. Деньги
- Стандарт — `Numeric(p,2)` → `Decimal`. Типовые: `Numeric(10,2)` (bonus, amount, price_monthly), `Numeric(12,2)` (spending, inventory-деньги, реклама), `Numeric(5,2)` (проценты: `bonus_percent`, `royalty_percent`, `discount_percent`, `percent_applied`), `Numeric(10,4/10,5)` (cost_usd AI/звонки), `Numeric(9,6)` (гео-координаты в audit).
- ⚠️ **Float-риски / легаси-аннотации:**
  - `TenantPlugin.price_monthly` — объявлен `Mapped[float|None]` без `Numeric` → SQLAlchemy выведет **Float** для денежного поля (потенциальная неточность).
  - `Bonus.amount` — аннотация `Mapped[float]`, но колонка фактически `Numeric(10,2)` (читается как Decimal — тип-хинт вводит в заблуждение).
  - `Appointment.price`/`discount_*` — аннотированы `float`, в БД `Numeric`.
  - `latitude`/`longitude` (City, Clinic) — `Float` — это **допустимо** (координаты, не деньги).
- ⚠️ **Decimal в JSONB** — известный класс багов (config/payload/raw_json/factors): сериализовать в str/float до записи.

### 4.2. Каскады (ondelete)
- **`CASCADE`** — данные, не имеющие смысла без родителя: подписки/инвойсы/платежи, chat-сообщения (delete-orphan), inventory (всё), engagement, telemedicine-child, staff-chat, franchise-grants, RLS-таблицы.
- **`SET NULL`** — записи, переживающие удаление родителя: `tenant_id` у пользовательских/исторических таблиц (users, clinics, referrals, ledger, audit, activity_log, advertising, ai_*), `created_by`/`approved_by`/`moderator_id` (FK на users).
- **Без явного `ondelete`** (поведение по умолчанию RESTRICT/NO ACTION) — `discounts` FK на tenants/services/clinics (удаление услуги со скидками может упереться), `clinic_schedules.clinic_id` в модели (каскад только через ORM relationship — при прямом SQL DELETE возможны висячие строки), `push_subscriptions.tenant_id`, `permission_override.updated_by_user_id`.
- **`RESTRICT`** — `ad_spend_entries.channel_id`, `sms_campaigns.template_id` (нельзя удалить канал/шаблон, пока есть зависимые).
- **Полиморфные ссылки БЕЗ FK** (целостность не гарантируется БД): `ledger_entries.reference_id`, `notification_reads.source_id`, `nps_surveys.{patient_id,thread_id}`, `marketing.contact_request_id`, `slot_holds.converted_to_appointment_id`, `regulation.current_version_id`, `chat_promo_codes.thread_id`, `webhook_deliveries.tenant_id`, self-ссылки в regulation.

---

## 5. Хранение ПДн (152-ФЗ) и чувствительных данных

### 5.1. Прозрачное шифрование на уровне модели (Fernet via `encryption_service`)
Паттерн: кастомный `__init__` шифрует kwarg → колонку `*_encrypted`; property get/set прозрачно (де)шифрует. Формат значения: `enc:<token>` (с ключом) или **`plain:<val>` (fallback БЕЗ ключа — риск хранить незашифрованное!**).

| Модель | Зашифрованное поле | Тип данных |
|--------|-------------------|-----------|
| `AppointmentOutcome` | `conclusion_encrypted`, `recommendations_encrypted` | Медицинское заключение врача |
| `LabOrder` | `notes_encrypted` | Заметки по анализам |
| `PatientDocument` | `description_encrypted` | Описание меддокумента |
| `Referral` / `ReferralComment` | `notes_encrypted` / `text_encrypted` | Заметки по направлению |
| `TelemedicineSession` / `TelemedicinePrescription` | `notes_encrypted` / `body_encrypted` | Заметки видеоприёма / тело е-рецепта |
| `User` | `address_encrypted` | Адрес сотрудника |
| `SignupRequest` | `full_name_encrypted` | ФИО при регистрации |

⚠️ По зашифрованным полям **нельзя** фильтровать/искать в SQL (в БД шифротекст). Чтение требует рабочего `encryption_service` (ключ в ENV). property дешифрует при **каждом** обращении — не дёргать в горячих циклах.

### 5.2. Секреты/ключи (шифрование без property-обёрток — шифрует сервис явно)
- `PaymentGatewayConfig.secret_key_encrypted`, `OFDConfig.api_key_encrypted`, `LabProvider.api_key_encrypted`, `TelephonyConfig.api_key_encrypted`/`api_secret_encrypted`, `Clinic.mis_api_key` (⚠️ строкой — проверить, шифруется ли в сервисе).
- ⚠️ `TenantMisSubscriptionWebhook.auth_header` — хранится **в открытом виде** (если туда кладётся секрет — риск).

### 5.3. Хэши вместо сырых значений (необратимо)
- Токены: `RefreshToken.token_hash`, `PasswordResetToken.token_hash`, `PatientSession.refresh_hash`, `TelemedicineSession.join_token_hash`, `TenantApiKey.key_hash` (+ `key_prefix` для UI) — SHA-256, сырой токен показывается один раз.
- API-ключи интеграций: `AggregatorPartnership.api_key_hash`.
- Анонимизация: `Ad`/`AdEvent.ip_hash` (SHA-256, raw IP не хранится — 152-ФЗ).
- Согласия: `ConsentRecord` (given/withdrawn/forget_requested/forgotten + `policy_version`), `User.consent_*`. ⚠️ `consent_records` CASCADE при удалении user — юр-история 152-ФЗ может пропасть.

### 5.4. Незашифрованные ПДн (потенциальный риск)
- `Appointment.patient_phone`/`patient_name`, `Referral.patient_phone`/`patient_name`, `medcard.*` (диагнозы/аллергии/прививки по телефону), `PatientVital`, `Review.comment` (открытый текст), `PatientAccount.{phone,name,email,birth_date}`, `AggregatorLead.patient_phone`/`patient_full_name` — медицинская тайна и контактные данные хранятся **в открытом виде**.
- Запись звонков: `TelemedicineSession.recording_enabled` по умолчанию **False** (152-ФЗ) — не включать молча.

---

## 6. Текстовая ER-схема основных связей

```
                         ┌──────────────┐
                         │   Franchise  │ (бренд, RegionLock, биллинг)
                         └──────┬───────┘
                                │ 1:N (franchise_id, SET NULL)
                                ▼
   ┌───────────────────────────────────────────────────────────┐
   │                         Tenant                              │
   │  1:1 TenantLicense · 1:1 TenantBranding · N TenantModule    │
   │  N TenantPlugin · N TenantApiKey · реквизиты юрлица         │
   └───┬──────────────┬──────────────┬───────────────┬──────────┘
       │ 1:N          │ 1:N          │ 1:N           │ 1:N (tenant_id, SET NULL/CASCADE)
       ▼              ▼              ▼               ▼
   ┌────────┐    ┌────────┐    ┌──────────┐    ┌──────────────┐
   │ Clinic │    │  User  │    │ Service  │    │ Subscription │──1:N──▶ Invoice ──1:N──▶ Payment
   │(филиал)│    │(16 рол)│    │(прайс+   │    │ (платформы)  │         (B2B-акт)      (платформа)
   └──┬──┬──┘    └───┬────┘    │ payout)  │    └──────────────┘
      │  │ city_id   │ user_id └────┬─────┘
      │  └▶ City     │ (unique)     │ service_id
      │ 1:N          ▼              │
      │          ┌────────┐        │
      │  clinic  │ Doctor │◀───────┘ (доктор оказывает услугу)
      │  _id     └───┬────┘
      │ 1:N          │ 1:N (doctor_id)
      ▼              ▼
   ┌──────────────────────────────┐        ┌──────────────────────────────┐
   │        Appointment           │◀──────▶│          Referral            │
   │ patient_phone (денорм, не FK)│ refer- │ from_clinic→to_clinic        │
   │ price/discount · QR/short_code│ ral_id │ notes_encrypted · 2 статуса  │
   └───┬───────────────┬──────────┘        │ partner_offer_id · bonus_snap│
       │ 1:1           │ 1:1               └───┬──────────┬──────────┬─────┘
       ▼               ▼                       │ 1:1      │ 1:N      │ 1:N
  AppointmentOutcome  AppointmentCost          ▼          ▼          ▼
  (зашифровано)       (GENERATED margin)    Bonus   RecruiterBonus  ReferralComment
                                            └──▶ LedgerEntry (append-only баланс)

   PatientAccount (БЕЗ tenant_id, ключ = phone, кросс-тенантный)
       │ 1:N (patient_id, CASCADE)
       ├─▶ PatientSubscription ──1:N──▶ PatientSubscriptionHistory (append-only)
       ├─▶ PatientDocument (description_encrypted) · PatientVital · medcard.*
       ├─▶ FamilyGroup ──1:N──▶ FamilyMember / FamilyInvite
       ├─▶ LoyaltyAccountExt (по patient_id) ║ LoyaltyAccount (по phone) — ДВЕ системы!
       └─▶ PatientChat ──1:N──▶ PatientChatMessage (AI + регистратура)

   Clinic ──1:N──▶ ClinicPayment ──1:1──▶ FiscalReceipt (54-ФЗ ОФД)   [пациент→клиника]
   Clinic ──1:N──▶ CashShift ──1:N──▶ CashShiftEntry (Z-отчёт)
   Clinic ──N:N──▶ InterClinicInvoice (workflow согласования, partial UNIQUE по referral)

   Платформа: BillingLedger (append-only, revenue-split platform/tenant/franchise)
              Franchise ──1:N──▶ FranchiseInvoice / FranchiseModuleGrant / FranchiseInternalAct

   Склад: InventoryItem ──1:N──▶ InventoryStock / InventoryBatch(FIFO)
                          ──1:N──▶ InventoryMovement (append-only)
          Service ──N:N──▶ ServiceConsumable (норматив расходников)
```

### Ключевые «ловушки» связей (из сводки аудита моделей)
1. **`doctor_id` ссылается на РАЗНЫЕ таблицы:** `doctor.py`/`lab.py` → `doctors.id`; а `doctor_ai.py`/`external_doctor.py`/`doctor_clinic_access.py` → `users.id`. Частый источник ошибок при JOIN.
2. **Две системы лояльности** (`loyalty_accounts` по phone vs `loyalty_accounts_ext` по patient_id) — риск двойного начисления.
3. **Два источника цен подписок** (`PLAN_PRICES` hardcode vs `TenantPlan` БД).
4. **Денормализация пациента** в `Appointment`/`Referral` (телефон/имя строкой, не FK) — рассинхрон возможен.
5. **PG-специфика, невидимая в SQLite-тестах:** RLS, partial unique (`cash_shifts`, `uq_ici_referral_id`), GENERATED (`AppointmentCost`), `INET <<=`, нативные ENUM, `ARRAY`.

---

## 7. Краткие выводы для аудита

- **RLS — главный риск:** защита БД-уровня есть только у 3 таблиц из десятков с `tenant_id`. Остальное держится на дисциплине кода → высокий риск cross-tenant утечки.
- **FK без индексов:** системного покрытия нет (исправлено лишь 15 колонок миграцией `dbidx01`) → деградация на CASCADE-удалениях и JOIN.
- **ПДн:** медицинская тайна и контакты пациентов в основном **не шифруются** (шифруются только заметки/заключения/адрес/ФИО-регистрации); ключ Fernet в ENV, при его отсутствии — `plain:` fallback.
- **Деньги:** дисциплина `Numeric` соблюдается, но есть точечные float-аннотации (`TenantPlugin.price_monthly`, `Bonus.amount`) и риск Decimal-в-JSONB.
- **Каскады:** смесь CASCADE/SET NULL/без-ondelete + множество полиморфных ссылок без FK — целостность частично на коде, не на БД.
