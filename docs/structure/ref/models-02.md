# models [02] — коммерция, франшизы, врачи, склад, лояльность и согласия

Это срез из 25 ORM-моделей SQLAlchemy (файлы `cms.py` … `loyalty_ext.py` по алфавиту) пакета `backend/app/models`. Все классы наследуют `app.database.Base` и описывают таблицы PostgreSQL; ни одного роутера/сервиса здесь нет — это чистый слой данных. Тематически срез покрывает несколько крупных бизнес-доменов МИС:

- **Коммерция/биллинг платформы:** `commercial.py` (каталог платных модулей + подписки тенантов + внешние интеграции), `cost_attribution.py` (сколько тенант стоит платформе).
- **Франшизы:** `franchise.py`, `franchise_invoice.py`, `franchise_ip_allowlist.py`, `franchise_module_grant.py`, `inter_clinic_invoice.py` — иерархия Платформа → Франшиза → Тенант → Клиника, межклиничные счета и Region Lock.
- **Врачи и приёмы:** `doctor.py` (врач + расписание + запись пациента), `doctor_ai.py` (план лечения + AI-лог + прямой счёт), `external_doctor.py` (приглашённые), `doctor_clinic_access.py`, `kpi_target.py`.
- **Пациент-CRM и лояльность:** `engagement.py` (теги/сегменты/push-кампании/NPS), `loyalty.py` (legacy-программа по телефону), `loyalty_ext.py` (Глава 8 по `patient_account_id`), `family.py` (семейные группы), `consent.py` (152-ФЗ).
- **Склад и себестоимость:** `inventory.py` (8 таблиц — справочник, остатки, движения, партии FIFO, нормативы расходников, себестоимость приёма).
- **Прочее:** `cms.py` (страницы сайта тенанта), `contact_request.py` (заявки с лендинга), `discount.py`, `feature_flag.py`, `invitation.py`, `lab.py` (лаборатории), `ledger.py` (финансовый реестр).

Сквозные паттерны: почти у всех таблиц есть `tenant_id` для multi-tenant изоляции (часто `nullable=True` + `ondelete="SET NULL"` у пользовательских данных, `nullable=False` + `CASCADE` у новых модулей); деньги всегда `Numeric`/`Decimal` (никогда float); журнальные таблицы (`ledger_entries`, `loyalty_transactions`, `consent_records`, `inventory_movements`) append-only.

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `cms.py` | Страницы CMS сайта тенанта | 28 |
| `commercial.py` | Каталог платных модулей, подписки, интеграции | 108 |
| `consent.py` | 152-ФЗ согласие на обработку ПДн | 27 |
| `contact_request.py` | Заявки обратной связи с лендинга | 15 |
| `cost_attribution.py` | Снимки стоимости тенанта для платформы | 78 |
| `discount.py` | Скидки на услуги для пациентов | 59 |
| `doctor.py` | Врач, расписание, запись пациента | 168 |
| `doctor_ai.py` | План лечения, AI-лог, прямой счёт | 148 |
| `doctor_clinic_access.py` | Доступ врача к клинике для направлений | 21 |
| `engagement.py` | CRM пациента: теги/сегменты/push/NPS | 182 |
| `external_doctor.py` | Заявки и настройки приглашённых врачей | 75 |
| `family.py` | Семейные группы пациентов (Глава 8) | 110 |
| `feature_flag.py` | Фиче-флаги платформы + A/B по тенантам | 134 |
| `franchise.py` | Франшиза: бренд, биллинг, Region Lock | 103 |
| `franchise_invoice.py` | Счета платформы к франшизе | 38 |
| `franchise_ip_allowlist.py` | IP-whitelist франшизы, bypass Region Lock | 53 |
| `franchise_module_grant.py` | Раздача модулей подтенантам + внутр. акты | 107 |
| `inter_clinic_invoice.py` | Межклиничные счета с workflow согласования | 100 |
| `inventory.py` | Склад: остатки/партии/FIFO/себестоимость | 530 |
| `invitation.py` | Приглашения врачей/партнёров по коду/email | 37 |
| `kpi_target.py` | KPI-цели администратора на месяц | 20 |
| `lab.py` | Интеграция с лабораториями (заказы/результаты) | 128 |
| `ledger.py` | Финансовый реестр (append-only) | 48 |
| `loyalty.py` | Legacy-лояльность по телефону + AI-лог | 155 |
| `loyalty_ext.py` | Расширенная лояльность по patient_account | 118 |

---

## `backend/app/models/cms.py`
- **Назначение:** Хранит редактируемые страницы публичного сайта тенанта (О клинике, услуги, контакты, акции) с поддержкой Markdown и блочного конструктора.
- **Ключевые элементы:** класс `TenantCmsPage` (таблица `tenant_cms_pages`). Контент в двух формах: `content_md` (Markdown) и `content_blocks` (JSONB-список блоков). Поля SEO (`seo_title`, `seo_description`), меню (`show_in_menu`, `menu_title`, `sort_order`), `page_type` (по умолчанию `info`).
- **Зависимости:** только `app.database.Base`. FK на `tenants.id` (CASCADE) и `users.id` (SET NULL у `created_by_id`). Relationship-объектов нет.
- **Где менять для типовых задач:** новый тип страницы — расширить логику `page_type` (значение хранится строкой, без enum); новое SEO/мета-поле — добавить колонку + миграцию; структуру блоков задаёт сервис/фронт, схема `content_blocks` свободная.
- **Подводные камни:** нет UNIQUE по `(tenant_id, slug)` — уникальность slug в рамках тенанта не гарантируется на уровне БД, проверять в сервисе. `tenant_id` обязателен (`nullable=False`) — фильтровать по нему всегда.
- **Строк:** 28

## `backend/app/models/commercial.py`
- **Назначение:** Коммерческое ядро платформы: каталог платных модулей (`CommercialModule`), подписки тенантов на них (`TenantModuleSubscription`) и внешние интеграции тенанта MIS/LIS/BARS (`TenantIntegration`).
- **Ключевые элементы:** enum-ы `IntegrationType` (mis/lis/bars/custom), `ModuleStatus` (trial/active/grace/expired/cancelled). `CommercialModule` — цены `price_monthly`/`price_annual` (Numeric), `included_in_plans` (JSONB), marketplace-поля (`screenshots`, `features_list`, `default_trial_days`, `popular`, `setup_complexity`, `monthly_price_demo`). `TenantModuleSubscription` — статус/цикл/`custom_price`/триал/grace/`config` (JSONB), UNIQUE `(tenant_id, module_key)`. `TenantIntegration` — `base_url`/`api_key`/`extra_config`, поля тестирования соединения.
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE), `commercial_modules.key` (CASCADE — связь по строковому ключу `module_key`, не по UUID!).
- **Где менять для типовых задач:** новый платный модуль — добавляется строкой в `commercial_modules` (данные, не код); новый статус подписки — пополнить `ModuleStatus`; новое marketplace-поле карточки — колонка в `CommercialModule`; новый тип интеграции — `IntegrationType`.
- **Подводные камни:** `status`/`billing_cycle` хранятся как `String`, а не SAEnum — значения enum используются лишь как дефолты, валидацию делать в сервисе. FK подписки ссылается на `commercial_modules.key` (String), а не на `id` — при переименовании ключа модуля каскадно поедут подписки. Цены — `Decimal`, в JSONB-`config` Decimal класть нельзя (известный баг сериализации).
- **Строк:** 108

## `backend/app/models/consent.py`
- **Назначение:** Журнал событий согласия на обработку персональных данных (152-ФЗ): принятие, отзыв, запрос на удаление, удаление. Append-only история.
- **Ключевые элементы:** класс `ConsentRecord` (таблица `consent_records`). Поле `event` (строка: `given`/`withdrawn`/`forget_requested`/`forgotten`), фиксация `ip`, `user_agent`, `policy_version`.
- **Зависимости:** `Base`. FK на `users.id` (CASCADE).
- **Где менять для типовых задач:** новое consent-событие — добавить строковое значение `event` (enum нет, перечень — в докстринге); привязка к версии политики — `policy_version`.
- **Подводные камни:** таблица append-only — записи нельзя менять/удалять (иначе теряется юридическая история). Нет `tenant_id` — согласие привязано к `user_id` глобально. При CASCADE-удалении пользователя история согласий пропадёт — для аудита 152-ФЗ это может быть нежелательно.
- **Строк:** 27

## `backend/app/models/contact_request.py`
- **Назначение:** Заявки «оставьте телефон / напишите нам» с публичного лендинга платформы.
- **Ключевые элементы:** класс `ContactRequest` (таблица `contact_requests`): `name`, `phone` (обязателен), `email`, `message`, флаг `is_read`.
- **Зависимости:** только `Base`. FK нет вообще. Самая «голая» модель среза — использует имплицитные типы колонок через `Mapped[...]` без явного `mapped_column(Type)`.
- **Где менять для типовых задач:** новое поле формы обратной связи — добавить колонку; пометка обработки менеджером — `is_read`.
- **Подводные камни:** нет `tenant_id` — заявки глобальные (платформенный лендинг). PK-тип выводится из `Mapped[uuid.UUID]` без явного `UUID(as_uuid=True)` — на PostgreSQL ляжет в нативный uuid, но это отличается от стиля остальных моделей.
- **Строк:** 15

## `backend/app/models/cost_attribution.py`
- **Назначение:** Снимок оценочной стоимости тенанта для платформы за период (= календарный месяц): storage, API-запросы, минуты звонков → `est_cost_rub`. Питает дашборд super_admin «Cost Attribution» (топ-20 дорогих тенантов).
- **Ключевые элементы:** класс `TenantCostSnapshot` (таблица `tenant_cost_snapshots`). `period` (Date = 1-е число месяца), метрики `storage_mb`/`api_requests` (BigInteger)/`db_rows_estimate`/`calls_minutes`, `est_cost_rub` (Numeric). UNIQUE `(tenant_id, period)` — один снимок на месяц (upsert в сервисе). Index `(period, est_cost_rub)` под топ-N.
- **Зависимости:** `Base`. FK на `tenants.id` (CASCADE). По смыслу связан с `QuotaUsage`/`api_quotas` (откуда берёт метрики) и с `cost_service` (формула стоимости в докстринге: `storage_mb*0.5 + api_requests*0.001 + calls_minutes*0.5`).
- **Где менять для типовых задач:** поменять формулу стоимости — НЕ здесь, а в `cost_service`; добавить новую метрику расхода — колонка здесь + сбор в сервисе; изменить гранулярность периода — поле `period` (сейчас жёстко месяц).
- **Подводные камни:** `est_cost_rub` — `Numeric`, чтобы не терять копейки. `captured_at` — `DateTime(timezone=True)`. Повторный снимок за тот же период обязан быть upsert (UNIQUE-констрейнт упадёт при наивном insert).
- **Строк:** 78

## `backend/app/models/discount.py`
- **Назначение:** Независимый модуль скидок на услуги для пациентов. Скидки НЕ влияют на бонусную/реферальную систему (явно подчёркнуто в докстринге).
- **Ключевые элементы:** enum `DiscountType` (percent/fixed). Класс `Discount` (таблица `discounts`): `discount_type` + `discount_value` (Numeric), привязка `applies_to` (all/service/clinic) с `service_id`/`clinic_id`, окно действия `valid_from`/`valid_until`. Relationships: `service`, `clinic`.
- **Зависимости:** `Base`. FK: `tenants.id`, `services.id`, `clinics.id`, `users.id`. Relationship на `Service` и `Clinic`.
- **Где менять для типовых задач:** новый способ применения скидки — расширить `applies_to` (строка, не enum); фикс/процент — `DiscountType`; ограничение по дате — поля `valid_from`/`valid_until`.
- **Подводные камни:** `discount_type`/`applies_to` хранятся строками, enum `DiscountType` используется только концептуально — валидация в сервисе. `tenant_id` `nullable=True` (есть legacy-данные без тенанта) — при фильтрации учитывать NULL. FK на `tenants.id`/`services.id`/`clinics.id` без `ondelete` — поведение по умолчанию (RESTRICT/NO ACTION), удаление услуги со скидками может упереться.
- **Строк:** 59

## `backend/app/models/doctor.py`
- **Назначение:** Центральная модель домена записи: сам врач (`Doctor`), его шаблонное расписание (`DoctorSchedule`) и запись пациента на слот (`Appointment`). Это одна из самых нагруженных таблиц МИС.
- **Ключевые элементы:** enum-ы `AppointmentStatus` (pending/confirmed/cancelled/completed/no_show/in_progress) и `AppointmentSource` (direct/referral/chat). `Doctor` — `clinic_id` (CASCADE), `user_id` (unique, связь с аккаунтом), поля реферального бонуса «к этому врачу» (`referral_bonus_type`/`_amount`/`_percent`, `visit_price`). `DoctorSchedule` — `day_of_week`/`start_time`/`end_time`. `Appointment` — денормализованные `patient_phone`/`patient_name`, `appointment_date`+`start/end_time`, статус, `priority`, оплата (`payment_method`, `price`), скидка по подписке (`applied_subscription_id`, `discount_percent`, `discount_amount`), QR/токены (`qr_code`, `short_code`, `patient_token`), `reminders_sent` (JSONB), `source`, `chat_thread_id`.
- **Зависимости:** `Base`. FK: `tenants.id`, `clinics.id`, `doctors.id`, `referrals.id`, `patient_chats.id`, `users.id`, `patient_subscriptions.id`. Relationships: `Doctor.clinic`, `Doctor.schedules` (cascade delete-orphan), `Doctor.appointments`; `Appointment.doctor`.
- **Где менять для типовых задач:** новый статус приёма (например для Kanban) — `AppointmentStatus`; новый канал создания записи — `AppointmentSource`; новое поле оплаты/скидки — в `Appointment`; правила реферального бонуса за визит к врачу — поля `referral_bonus_*` в `Doctor` (распределение каскадом считается в `_apply_confirmation`, не здесь); расписание — `DoctorSchedule`.
- **Подводные камни:** деньги (`visit_price`, `price`, `discount_amount`) — `Numeric`, но в коде `Appointment.price`/`discount_*` аннотированы как `Mapped[float]` — фактически в БД Numeric, при чтении придёт Decimal, не путать. `tenant_id` у `Doctor`/`Appointment` `nullable=True` (SET NULL) — фильтровать с учётом NULL. Данные пациента денормализованы (телефон/имя в `Appointment`), не FK на пациента — рассинхрон возможен. `short_code` глобально unique (не per-tenant). `reminders_sent` — JSONB-словарь напоминаний, дефолт `{}`. Enum-ы созданы как `native_enum=False` (хранятся строками) — миграции не трогают типы PG.
- **Строк:** 168

## `backend/app/models/doctor_ai.py`
- **Назначение:** Глава 6 «Врач AI». Три сущности: `TreatmentPlan` (план лечения, ручной или AI-сгенерированный), `AIDoctorLog` (журнал AI-вызовов для аудита затрат), `DirectBill` (прямой счёт приглашённого/партнёрского врача пациенту или клинике).
- **Ключевые элементы:** константные классы-статусы `TreatmentPlanStatus` (draft/approved/archived), `DirectBillStatus` (draft/sent/paid/cancelled), `DirectBillPaymentMethod` (cash/card/transfer). `TreatmentPlan` — `payload` (JSONB вся структура плана), `ai_provider`, привязка к `appointment_id`/`patient_phone`/`doctor_id`. `AIDoctorLog` — `action` (briefing/treatment_plan), `input_tokens`/`output_tokens`/`latency_ms`, `ai_provider`, `success`. `DirectBill` — `services` (JSONB список), `subtotal`/`discount_pct`/`discount_amount`/`total` (Numeric), `bill_number`, связь с `inter_clinic_invoice_id`.
- **Зависимости:** `Base`. FK: `tenants.id`, `appointments.id`, `users.id` (доктор!), `clinics.id`, `inter_clinic_invoices.id`. Структуру `TreatmentPlan.payload` задаёт `ai_service.generate_treatment_plan`.
- **Где менять для типовых задач:** новый тип AI-действия для логирования — значение `AIDoctorLog.action`; новый статус плана/счёта — соответствующий класс-константа; поля расчёта прямого счёта — `DirectBill`. Схема плана лечения — в `ai_service`, не в модели.
- **Подводные камни:** `doctor_id` здесь ссылается на `users.id` (а не на `doctors.id`!) — в отличие от `lab.py`/`doctor.py`. Все суммы `DirectBill` — `Decimal`; `services` — JSONB-список словарей (Decimal внутрь не класть). `tenant_id` `nullable=True`. Статусы — обычные классы-константы (не Enum), хранятся строками.
- **Строк:** 148

## `backend/app/models/doctor_clinic_access.py`
- **Назначение:** Матрица доступа: какой врач может создавать направления в какую клинику. Простая связь many-to-many с метаданными.
- **Ключевые элементы:** класс `DoctorClinicAccess` (таблица `doctor_clinic_access`): `doctor_id` (→ users), `clinic_id`, `granted_by`. Relationships: `doctor` (User, `back_populates="doctor_clinic_access"`), `clinic`.
- **Зависимости:** `Base`. FK: `users.id` (doctor_id CASCADE, granted_by SET NULL), `clinics.id` (CASCADE). Требует у `User` обратной связи `doctor_clinic_access`.
- **Где менять для типовых задач:** изменить логику «кто кому может направлять» — это таблица доступов; добавить срок/флаг активности доступа — добавить колонку (сейчас доступ бессрочный, без is_active).
- **Подводные камни:** `doctor_id` — это `users.id`, не `doctors.id`. Нет UNIQUE `(doctor_id, clinic_id)` — возможны дубли доступа, дедуп в сервисе. Нет `tenant_id` — изоляция косвенная через clinic/user.
- **Строк:** 21

## `backend/app/models/engagement.py`
- **Назначение:** Patient Engagement Hub — CRM-надстройка над пациентами: теги, заметки, коммуникационные преференсы, динамические сегменты, push-шаблоны и кампании (с A/B), AI-подсказки взаимодействия и ответы NPS.
- **Ключевые элементы:** `PatientTag` (UNIQUE `(patient_id, tag)`), `PatientNote` (с `pinned`), `PatientCommPrefs` (PK = `patient_id`; флаги promo/reminders/loyalty/news + тихие часы), `PatientSegment` (`filter_json` JSONB, `is_dynamic`, снапшот `snapshot_patient_ids`), `PushTemplate` (категория, `variables_used`), `PushCampaign` (A/B: `template_id`/`template_b_id`, счётчики `*_sent`/`*_click`/`conversion_count`, статус), `EngagementSuggestion` (`kind`, статус, `postponed_until`), `NpsResponse` (score+comment). Плюс константные классы `SuggestionKind` и `TemplateCategory` (хардкод-триггеры для `suggestion_engine.py`).
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE), `patient_accounts.id` (CASCADE), `users.id` (SET NULL), `push_templates.id`, `patient_segments.id`, `push_campaigns.id`. Связан с движком `suggestion_engine.py` (использует `SuggestionKind`).
- **Где менять для типовых задач:** новый триггер подсказки — добавить в `SuggestionKind` + обработку в `suggestion_engine.py`; новая категория шаблона — `TemplateCategory`; новая метрика кампании — счётчик-колонка в `PushCampaign`; новый канал/флаг согласия на рассылки — поле в `PatientCommPrefs`; язык фильтра сегмента — структура `filter_json` (свободный JSONB).
- **Подводные камни:** все таблицы строго `tenant_id NOT NULL` — фильтровать обязательно. `PatientCommPrefs` имеет PK `patient_id` (одна строка на пациента, не автоинкремент UUID). `NpsResponse.appointment_id` — без FK (просто UUID-колонка), целостность не гарантирована. Счётчики кампаний инкрементируются в сервисе — следить за гонками. Сегмент может быть динамическим (`is_dynamic=True`, фильтр) или статическим снимком (`snapshot_patient_ids`).
- **Строк:** 182

## `backend/app/models/external_doctor.py`
- **Назначение:** Внешние/приглашённые врачи: `DoctorRequest` — заявка менеджера на добавление нового врача (с модерацией), `VisitingDoctorSettings` — финансовые настройки приглашённого врача (цена визита, его процент).
- **Ключевые элементы:** класс-константа `DoctorRequestStatus` (pending/approved/rejected). `DoctorRequest` — `manager_id`, `doctor_name`/`phone`/`specialization`, `status`, `approved_by_id`, `created_user_id` (созданный аккаунт после одобрения). `VisitingDoctorSettings` — `price_per_visit` (Numeric), `doctor_percent` (Numeric, дефолт 70%), окно `start_date`/`end_date`. Relationships: `manager`, `approved_by`, `doctor`, `clinic`.
- **Зависимости:** `Base`. FK: `tenants.id` (SET NULL), `users.id` (несколько ролей), `clinics.id` (CASCADE). Несколько FK на `users.id` — relationship-ы разруливаются через явные `foreign_keys=[...]`.
- **Где менять для типовых задач:** workflow одобрения заявки на врача — статусы `DoctorRequestStatus` + поля `approved_*`; ставка/процент приглашённого врача — `VisitingDoctorSettings` (расчёт выплаты использует `price_per_visit` × `doctor_percent`).
- **Подводные камни:** `DoctorRequestStatus(str)` — наследник `str`, не Enum; статус в БД — обычная строка. `doctor_id` в `VisitingDoctorSettings` ссылается на `users.id`. Деньги/проценты — `Decimal`. `tenant_id` `nullable=True`.
- **Строк:** 75

## `backend/app/models/family.py`
- **Назначение:** Глава 8 — семейный профиль пациента на UUID-аккаунтах: группа (`FamilyGroup`), члены с правами (`FamilyMember`), pending-приглашения по телефону (`FamilyInvite`). Замена старой `PatientFamilyMember` (по телефонам, оставлена для совместимости — здесь её нет).
- **Ключевые элементы:** `FamilyGroup` — `owner_patient_id` (UNIQUE — один владелец = одна группа). `FamilyMember` — `relation` (self/spouse/child/parent/sibling/other), флаги прав `can_view_records`/`can_book_appointments`/`can_manage_payments`, UNIQUE `(group_id, patient_id)`. `FamilyInvite` — `invitee_phone`, `token` (unique), `status` (pending/accepted/expired/cancelled), `expires_at` (дефолт +14 дней через lambda).
- **Зависимости:** `Base`. FK: `tenants.id` (SET NULL), `patient_accounts.id` (CASCADE). Relationship-объектов нет.
- **Где менять для типовых задач:** новое право члена семьи — булев флаг в `FamilyMember`; новый тип родства — значение `relation`; срок жизни приглашения — `expires_at` default-lambda; новый статус приглашения — `FamilyInvite.status`.
- **Подводные камни:** `owner_patient_id` UNIQUE — пациент не может владеть двумя группами; для членства используется `FamilyMember`. `FamilyInvite.expires_at` вычисляется на стороне Python (`datetime.utcnow()+14дн`), не server_default — при массовых вставках в БД время фиксируется приложением. `tenant_id` только у `FamilyGroup` (у member/invite нет — изоляция через группу).
- **Строк:** 110

## `backend/app/models/feature_flag.py`
- **Назначение:** Фиче-флаги платформы: каталог фич (`FeatureFlag`) с разными стратегиями раскатки и override на уровне тенанта (`TenantFeatureFlag`) для A/B и точечного включения.
- **Ключевые элементы:** enum `RolloutStrategy` (all/tenants/percentage/ab_test — единственный настоящий SAEnum в срезе, `native_enum` создаётся в PG). `FeatureFlag` — `key` (unique snake_case, используется в коде через `is_enabled`), `default_enabled`, `rollout_strategy`, `rollout_value` (JSONB: `{"percentage":25}` или `{"variants":{"A":50,"B":50}}`). `TenantFeatureFlag` — `enabled` (жёсткий override), `variant`. Relationship `FeatureFlag.overrides` ↔ `TenantFeatureFlag.flag`. UNIQUE-index `(tenant_id, feature_flag_id)`.
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE), `feature_flags.id` (CASCADE). Логика percentage/ab_test (детерминированный hash по tenant_id) реализована в сервисе фиче-флагов, не в модели.
- **Где менять для типовых задач:** новая стратегия раскатки — расширить enum `RolloutStrategy` + обработку в сервисе; формат `rollout_value` для стратегии — см. докстринг; принудительно «прибить» тенанта к ветке — запись `TenantFeatureFlag` с `enabled`+`variant`.
- **Подводные камни:** `RolloutStrategy` — единственный SAEnum-тип в этом срезе, создаёт нативный PG-enum `feature_flag_rollout_strategy` — изменение членов требует ALTER TYPE в миграции (нельзя просто дописать значение в код). `created_at`/`updated_at` — `DateTime(timezone=True)`. Уникальность override реализована как UNIQUE-Index, а не UniqueConstraint.
- **Строк:** 134

## `backend/app/models/franchise.py`
- **Назначение:** Сущность «Франшиза» — промежуточный уровень иерархии Платформа → Франшиза → Тенант → Клиника. Один `franchise_owner` управляет группой тенантов под общим брендом. Содержит биллинг, Region Lock, ручную блокировку и onboarding-wizard.
- **Ключевые элементы:** класс `Franchise` (таблица `franchises`). Бренд (`name`, `slug` unique, `brand_color`, `logo_url`). Биллинг (`fee_per_bonus_from_clinic`, `platform_fee_per_bonus`, `min_bonus_amount`, `refund_fee_on_cancel`, `billing_period_days`, `last_invoice_at` — все Numeric/int). Region Lock (`allowed_region`, `region_strict`). Manual Block (`is_blocked`, `blocked_until`, `block_reason`, `blocked_by`, `blocked_at`). Onboarding (`onboarding_done`/`_step`/`_data` JSONB/`_completed_at`). Relationship `tenants` ↔ `Tenant.franchise` (по `Tenant.franchise_id`).
- **Зависимости:** `Base`. FK: `users.id` (`owner_user_id`, `blocked_by` — SET NULL). Region Lock проверяется в `core.region_lock.enforce_region_lock`. Связь с `Tenant`, `FranchiseInvoice`, `FranchiseModuleGrant`, `FranchiseIpAllowlist`.
- **Где менять для типовых задач:** параметры биллинга франшизы — Numeric-поля; географический контроль — `allowed_region`/`region_strict` (логика в `core.region_lock`); ручная блокировка из админки — `is_blocked`/`blocked_until` (никогда не выставляется автоматически); шаги мастера онбординга — `onboarding_step`/`onboarding_data`.
- **Подводные камни:** два похожих поля комиссии — `fee_per_bonus_from_clinic` И `platform_fee_per_bonus` (оба Numeric, дефолт 100) — легко перепутать, проверить в `billing`-сервисе какое реально используется. Все денежные поля `Decimal`. `region_strict=True` (Phase 2) пока не задействован — только алерт. Block bypass'ится через `FranchiseIpAllowlist` с `bypass_block=True`.
- **Строк:** 103

## `backend/app/models/franchise_invoice.py`
- **Назначение:** Счета от Платформы к Франшизе, накапливаются периодически по `billing_period_days` (за начисленные бонусы).
- **Ключевые элементы:** класс-константа `InvoiceStatus` (pending/paid/cancelled). `FranchiseInvoice` — `franchise_id`, `period_start`/`period_end`, `bonuses_count`, `total_amount` (Numeric), `status`, `due_date`, `paid_at`, `number`.
- **Зависимости:** `Base`. FK: `franchises.id` (CASCADE). Генерируется биллинг-джобом платформы (использует `Franchise.platform_fee_per_bonus`/`billing_period_days`).
- **Где менять для типовых задач:** новый статус счёта франшизе — `InvoiceStatus`; поля документа (номер/срок/детализация) — колонки `FranchiseInvoice`.
- **Подводные камни:** `total_amount` — `Decimal`. Это счёт Платформа→Франшиза; не путать с `FranchiseInternalAct` (Франшиза→Клиника, в `franchise_module_grant.py`) и `InterClinicInvoice` (между клиниками). `InvoiceStatus` — класс-константа, не Enum.
- **Строк:** 38

## `backend/app/models/franchise_ip_allowlist.py`
- **Назначение:** IP-whitelist франшизы — обходит проверку Region Lock (и опционально ручную блокировку). Бизнес-кейс: VPN/спутник в Чечне/Ингушетии дают неверный GeoIP-регион.
- **Ключевые элементы:** класс `FranchiseIpAllowlist` (таблица `franchise_ip_allowlist`). `ip_cidr` — тип `INET` (одиночный IP или CIDR; проверка оператором `<<=`). `bypass_block` — если True, обходит и `is_blocked` (по умолчанию False — только region check). `comment`, `created_by`. Index по `franchise_id`.
- **Зависимости:** `Base`. FK: `franchises.id` (CASCADE), `users.id` (SET NULL). Использует диалект-тип `postgresql.INET`. Применяется в `core.region_lock.enforce_region_lock`.
- **Где менять для типовых задач:** разрешить IP в обход региональной проверки — добавить запись; разрешить IP в обход блокировки франшизы — `bypass_block=True`. Сама логика сравнения — в `core.region_lock`.
- **Подводные камни:** `ip_cidr` — PG-тип `INET`, для проверки нужен SQL-оператор `<<=` (`:ip::inet <<= ip_cidr`) — на SQLite в тестах не сработает «как в проде». `bypass_block` по умолчанию обходит ТОЛЬКО регион, не блокировку — внимательно при выдаче временного доступа.
- **Строк:** 53

## `backend/app/models/franchise_module_grant.py`
- **Назначение:** Распределение коммерческих модулей внутри франшизы: `FranchiseModuleGrant` — франшиза выдаёт модуль подтенанту по внутренней цене; `FranchiseInternalAct` — ежемесячный акт «Франшиза → Клиника» за пользование модулями.
- **Ключевые элементы:** `FranchiseModuleGrant` — `module_key` (ключ из `commercial_modules.key`), `internal_price_rub` (Numeric, 0 = бесплатно для клиники), `is_active`, `granted_by_id`. UNIQUE `(franchise_id, tenant_id, module_key)`. `FranchiseInternalAct` — `period` (YYYY-MM), `total_rub` (Numeric), `breakdown_json` (строка-JSON `{module_key: price}`), `status` (pending/paid/cancelled). UNIQUE `(franchise_id, tenant_id, period)`.
- **Зависимости:** `Base`. FK: `franchises.id` (CASCADE), `tenants.id` (CASCADE), `users.id` (SET NULL). По смыслу при создании Grant сервис активирует `TenantModuleSubscription` (из `commercial.py`) у дочернего тенанта.
- **Где менять для типовых задач:** выдать/отозвать модуль клинике внутри франшизы — `FranchiseModuleGrant` (+ синхронизация `TenantModuleSubscription` в сервисе!); внутренний биллинг франшизы — `FranchiseInternalAct` (создаётся джобом 1-го числа, сумма = `SUM(internal_price_rub)`).
- **Подводные камни:** `breakdown_json` — это `String(2000)`, а НЕ JSONB (хранится сериализованная строка) — парсить/сериализовать вручную. `internal_price_rub`/`total_rub` — `Decimal`. `module_key` — свободная строка, FK на `commercial_modules.key` тут НЕ объявлен (в отличие от `commercial.py`) — целостность ключа не гарантирована БД. Создание Grant без активации подписки = модуль «выдан, но не работает».
- **Строк:** 107

## `backend/app/models/inter_clinic_invoice.py`
- **Назначение:** Межклиничный счёт — финансовый документ между клиниками (одного или разных тенантов): автогенерация по реферальным бонусам, ручные счета, роялти, корректировки. С workflow согласования руководителем плательщика.
- **Ключевые элементы:** классы-константы `ICIStatus` (draft/sent[legacy]/pending_approval/approved/rejected/paid/cancelled) и `ICIType` (referral_bonus/manual/royalty/correction). `InterClinicInvoice` — `invoice_number` (unique), стороны (`issuer_*`, `recipient_*` clinic+tenant), `amount` (Numeric), связь `referral_id`, workflow approve (`approved_by_id`/`_at`/`_name` снапшот ФИО/`_role`) и reject (`rejected_at`, `rejection_reason`). Индексы по `(issuer_tenant_id, status)`, `(recipient_tenant_id, status)` и партиальный UNIQUE `uq_ici_referral_id` (только когда `referral_id IS NOT NULL`).
- **Зависимости:** `Base`. FK: `clinics.id`, `tenants.id`, `referrals.id`, `users.id` (все SET NULL). Связан с `DirectBill.inter_clinic_invoice_id` (`doctor_ai.py`). Эндпоинты `PATCH /clinic-invoices/{id}/approve`.
- **Где менять для типовых задач:** новый статус workflow — `ICIStatus`; новый тип счёта — `ICIType`; поля согласования/отклонения — workflow-колонки. Один авто-счёт на одно направление гарантирован партиальным UNIQUE-индексом.
- **Подводные камни:** партиальный UNIQUE `uq_ici_referral_id` (с `postgresql_where`) создаётся миграцией `bonusunique01` и работает ТОЛЬКО на PostgreSQL — на SQLite в тестах дубль авто-счёта по `referral_id` не отловится. `approved_by_name` — снапшот ФИО на случай увольнения (подпись остаётся). `amount` — `Decimal`. Стороны nullable (SET NULL) — клиника/тенант могли удалиться. `ICIStatus.SENT` — legacy, новые записи идут в `pending_approval`.
- **Строк:** 100

## `backend/app/models/inventory.py`
- **Назначение:** Полный складской модуль (W7 + INVENTORY_COST_PLAN): справочник позиций, остатки по клиникам/партиям, append-only журнал движений, импорт из 1С, поставщики, приходные накладные, партии FIFO, нормативы расходников на услугу и кешированная себестоимость приёма. Самый большой файл среза (8 таблиц).
- **Ключевые элементы:** enum-ы `InventoryCategory` (consumable/equipment/medication/reagent/other) и `InventoryMovementType` (income/outgoing/transfer/adjustment/write_off/expired). Таблицы: `InventoryItem` (справочник, UNIQUE `(tenant_id, sku)`), `InventoryStock` (остаток на клинике/партии, UNIQUE `(item_id, clinic_id, batch_number)`), `InventoryMovement` (append-only журнал с `balance_after`, `batch_id`, `appointment_id`), `InventoryImportLog` (аудит импорта 1С с `file_hash`), `Supplier`, `InventoryReceipt` (накладная), `InventoryBatch` (партия FIFO — `qty_remaining`, `unit_cost`, `expires_at`), `ServiceConsumable` (норматив расходников на услугу, UNIQUE `(service_id, item_id)`), `AppointmentCost` (себестоимость приёма с GENERATED-колонками).
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE везде), `clinics.id`, `inventory_items.id`, `inventory_batches.id`, `inventory_receipts.id`, `inventory_movements.id`, `services.id`, `appointments.id`, `users.id`, `suppliers.id`. ENUM-типы создаются миграцией `inventory01` (`create_type=False` — модель их не создаёт). Использует `Computed` (GENERATED ALWAYS) и `func.now()`.
- **Где менять для типовых задач:** новый тип движения склада — `InventoryMovementType` (+ знак quantity и логика FIFO в сервисе); новая категория товара — `InventoryCategory`; формула себестоимости — `AppointmentCost.total_cost`/`margin` это GENERATED-колонки Postgres (менять выражение `Computed(...)` + миграция), `margin_pct` считается приложением; нормативы расходников на услугу — `ServiceConsumable` (авто-списание по FIFO при `appointment.status=completed`).
- **Подводные камни:** все количества `Numeric(12,3)`, деньги `Numeric(12,2)` — Decimal, не float. `InventoryMovement` append-only — балансы пересчитывать движениями, не править. `balance_after` относится к конкретной тройке `(item_id, clinic_id, batch_number)`. `batch_number` по умолчанию `""` (не NULL) — иначе UNIQUE-индекс не сработает (PG считает NULL≠NULL). `AppointmentCost.total_cost`/`margin` — GENERATED ALWAYS (на стороне PG, на SQLite в тестах не вычислятся автоматически!). `ENUM`-типы с `create_type=False` — забыть миграцию = падение на insert. `expiry_tracked=True` на item требует `expiry_date` в stock (валидация в сервисе). FIFO-списание уменьшает `InventoryBatch.qty_remaining`.
- **Строк:** 530

## `backend/app/models/invitation.py`
- **Назначение:** Приглашения: партнёрские ссылки по коду (legacy) и именные приглашения врачей по email от рекрутера/менеджера с предзаданным доступом к клиникам.
- **Ключевые элементы:** класс `Invitation` (таблица `invitations`). `code` (unique, авто `secrets.token_urlsafe(16)` — legacy), `email` (для врачей), `role` (дефолт `partner_doctor`), `recruiter_id`, `clinic_access` (JSON-список UUID-строк клиник), лимиты `max_uses`/`uses_count`/`is_used`, `expires_at`. Relationships: `clinic`, `invited_by`, `recruiter`.
- **Зависимости:** `Base`. FK: `clinics.id`, `users.id` (несколько — `invited_by_id`, `recruiter_id`). Использует `secrets` для генерации кода. `clinic_access` — обычный `JSON` (не JSONB!).
- **Где менять для типовых задач:** новая роль приглашаемого — значение `role`; список доступных клиник врачу при регистрации — `clinic_access`; лимит/срок приглашения — `max_uses`/`expires_at`.
- **Подводные камни:** `clinic_access` — тип `JSON` (а не `JSONB` как в большинстве моделей) — на PG ляжет в `json`, без бинарной индексации. Нет `tenant_id` — изоляция косвенная (через clinic/inviter). Два механизма (code legacy + email) сосуществуют — для врачей актуален email-путь. `max_uses` дефолт 100 — фактически многоразовая ссылка.
- **Строк:** 37

## `backend/app/models/kpi_target.py`
- **Назначение:** Целевые KPI администратора (сотрудника) на месяц: план по направлениям и подтверждённым.
- **Ключевые элементы:** класс `KpiTarget` (таблица `kpi_targets`). `admin_id`, `month` (Date), `target_referrals`, `target_confirmed`. UNIQUE `(admin_id, month)`. Relationship `admin` (User).
- **Зависимости:** `Base`. FK: `users.id` (CASCADE). Сравнивается с фактом из реферальной/bonus-системы в KPI-сервисе/дашборде.
- **Где менять для типовых задач:** новая KPI-метрика плана — добавить колонку `target_*`; гранулярность периода — поле `month` (хранит 1-е число).
- **Подводные камни:** нет `tenant_id` — изоляция через `admin_id`/`User.tenant_id`. UNIQUE `(admin_id, month)` — один план на админа в месяц (upsert). Минималистичная модель.
- **Строк:** 20

## `backend/app/models/lab.py`
- **Назначение:** Глава 10 — интеграция с лабораториями: справочник провайдеров (`LabProvider`), заявки на анализы (`LabOrder`) и результаты по тест-кодам (`LabResult`). С прозрачным шифрованием PII.
- **Ключевые элементы:** `LabProvider` — `provider_type` (gemotest/invitro/kdl/citilab/generic_http), `api_url`, `api_key_encrypted`. `LabOrder` — `test_codes` (JSONB), `status` (created→sent→in_progress→results_ready→delivered/cancelled/error), шифруемое поле `notes` (хранится в `notes_encrypted`), `external_order_id`. `LabResult` — `test_code`/`test_name`/`value`/`unit`/`reference_range`/`flagged`/`raw_json`. Relationship `LabOrder.results` ↔ `LabResult.order` (cascade delete-orphan). У `LabOrder` переопределён `__init__` + property `notes` (get/set) для прозрачного шифрования.
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE), `patient_accounts.id` (CASCADE), `clinics.id`, `doctors.id` (здесь — на `doctors.id`, не users!), `lab_providers.id`, `lab_orders.id`. Жёстко зависит от `app.services.encryption_service` (`encrypt`/`decrypt`) — импорт лениво внутри методов.
- **Где менять для типовых задач:** новый тип лаборатории — значение `provider_type` + адаптер в lab-сервисе; новый статус заказа — `LabOrder.status`; новое PII-поле с шифрованием — паттерн `*_encrypted` + property (как `notes`).
- **Подводные камни:** `notes` — это property поверх `notes_encrypted`; присваивание `LabOrder(notes=...)` шифруется в `__init__`, прямое чтение `.notes` дешифрует — НЕ фильтровать/искать по `notes` в SQL. Если `encryption_service` не сконфигурирован, есть fallback к plaintext (см. докстринг) — риск хранить незашифрованное. `doctor_id` → `doctors.id` (отличается от `doctor_ai.py`, где `users.id`). `api_key_encrypted` тоже зашифрован. Все timestamp — `DateTime(timezone=True)`.
- **Строк:** 128

## `backend/app/models/ledger.py`
- **Назначение:** Финансовый реестр (append-only, главная книга): баланс пользователя = SUM(amount). Положительный amount — зачисление, отрицательный — списание. Записи НИКОГДА не меняются и не удаляются.
- **Ключевые элементы:** класс `LedgerEntry` (таблица `ledger_entries`). `user_id` (владелец), `amount` (Numeric), `operation_type` (строка, индекс), `reference_id`/`reference_type` (полиморфная ссылка на источник — bonus/referral), `description`. Разбивка комиссии: `clinic_id`, `admin_amount`, `manager_amount`, `platform_amount` (все nullable Numeric). `created_at` иммутабелен.
- **Зависимости:** `Base`. FK: `tenants.id` (SET NULL), `users.id` (CASCADE для владельца, SET NULL для created_by), `clinics.id` (SET NULL). Питается из bonus/referral-сервисов.
- **Где менять для типовых задач:** новый тип финансовой операции — значение `operation_type` (строка, без enum); новая статья разбивки комиссии — колонка `*_amount`; источник записи — `reference_type`/`reference_id`.
- **Подводные камни:** append-only — НЕЛЬЗЯ обновлять/удалять записи (иначе разъедется баланс). Баланс считается как `SUM(amount)` — все суммы `Decimal`, складывать в Decimal, не float. `reference_id`/`reference_type` — полиморфная ссылка без FK (целостность не гарантирована). `tenant_id` `nullable=True`. Разбивка комиссии `nullable=True` для старых записей — учитывать NULL при агрегации.
- **Строк:** 48

## `backend/app/models/loyalty.py`
- **Назначение:** Legacy-программа лояльности пациента по телефону (отдельная от bonus/реферальной системы): аккаунт, append-only транзакции, конфиг уровней, правила автоначисления (W5), каталог наград. Плюс лог диалогов с медицинским AI-ассистентом.
- **Ключевые элементы:** `LoyaltyAccount` (по `patient_phone`, UNIQUE `(tenant_id, patient_phone)`; `points_total`/`points_balance`/`tier`/`tier_progress`). `LoyaltyTransaction` (append-only, `delta`, `op_type` earn/redeem/expire/tier_bonus/manual_*). `LoyaltyTier` (`threshold_rub`, `discount_percent`, `perks` JSONB, UNIQUE `(tenant_id, name)`). `LoyaltyRule` (W5: `rule_type` visit/referral/birthday/specialist, `bonus_amount`/`bonus_pct`, `conditions` JSONB). `LoyaltyReward` (каталог: `cost_points`, `reward_type`, `min_tier`, `stock`). Плюс `PatientAIConversation` (лог Q/A медицинского AI — `tokens_in/out`, `source`).
- **Зависимости:** `Base`. FK: `tenants.id` (SET NULL), `loyalty_accounts.id` (CASCADE), `users.id` (SET NULL). 1 балл = 100₽ (бизнес-правило в докстринге).
- **Где менять для типовых задач:** новый тип транзакции — `op_type` (строка); новое правило автоначисления — `LoyaltyRule.rule_type` + логика начисления в loyalty-сервисе; новый уровень — строка в `LoyaltyTier`; награда в каталоге — `LoyaltyReward`. ВАЖНО: эту legacy-модель трогать осторожно — на ней висит router `/loyalty/*`.
- **Подводные камни:** аккаунт идентифицируется по `patient_phone` (НЕ по `patient_account_id`!) — принципиальное отличие от `loyalty_ext.py`. `LoyaltyTransaction` append-only. `points_total`/`points_balance` — Integer (баллы), а `tier_progress`/`threshold_rub` — Decimal (рубли) — не смешивать. `PatientAIConversation` логически чужеродна (AI-чат), просто живёт в этом файле. `tenant_id` `nullable=True`.
- **Строк:** 155

## `backend/app/models/loyalty_ext.py`
- **Назначение:** Глава 8 — расширение лояльности на UUID-аккаунты (поверх legacy `loyalty.py`, которую трогать нельзя): аккаунт по `patient_account_id` с тиром и `total_spent` (`LoyaltyAccountExt`), события начисления с привязкой к приёму/направлению (`LoyaltyEvent`), заявки на награды (`LoyaltyClaim`).
- **Ключевые элементы:** `LoyaltyAccountExt` — `patient_id` (→ patient_accounts) + `patient_phone`, `points`, `tier`, `total_spent` (Numeric), UNIQUE `(tenant_id, patient_id)`. `LoyaltyEvent` — `delta`, `reason` (appointment_completed/referral_made/birthday_bonus/manual_admin/reward_claimed), привязка `appointment_id`/`referral_id`. `LoyaltyClaim` — `reward_id`, `points_spent`, `status` (requested/approved/delivered/cancelled).
- **Зависимости:** `Base`. FK: `tenants.id` (CASCADE), `patient_accounts.id` (CASCADE), `loyalty_accounts_ext.id` (CASCADE), `appointments.id` (SET NULL), `referrals.id` (SET NULL), `loyalty_rewards.id` (CASCADE — каталог наград из `loyalty.py`!).
- **Где менять для типовых задач:** новая причина начисления баллов — значение `LoyaltyEvent.reason`; новый статус заявки на награду — `LoyaltyClaim.status`; начисление при событии (приём/направление/ДР) — `LoyaltyEvent` + логика в loyalty-сервисе Главы 8.
- **Подводные камни:** ВАЖНО — это вторая, параллельная система лояльности (по `patient_id`), сосуществующая с legacy `loyalty.py` (по `patient_phone`) — НЕ путать таблицы (`loyalty_accounts` vs `loyalty_accounts_ext`); риск двойного учёта баллов если оба пути активны. `LoyaltyClaim.reward_id` ссылается на `loyalty_rewards` (каталог из старого файла) — кросс-файловая зависимость. `total_spent` — `Decimal`, `points` — Integer. `tenant_id NOT NULL` + CASCADE (строже legacy).
- **Строк:** 118

---

## Сводка рисков по срезу
1. **Две системы лояльности сосуществуют** (`loyalty.py` по телефону + `loyalty_ext.py` по `patient_id`) — высокий риск двойного начисления; всегда уточнять, какая активна для тенанта.
2. **`doctor_id` ссылается на РАЗНЫЕ таблицы:** `doctor_ai.py`/`external_doctor.py`/`doctor_clinic_access.py` → `users.id`, а `doctor.py`/`lab.py` → `doctors.id`. Частый источник путаницы при джойнах.
3. **PostgreSQL-специфика, невидимая на SQLite-тестах:** партиальный UNIQUE `uq_ici_referral_id`, GENERATED-колонки `AppointmentCost.total_cost`/`margin`, `INET`-проверка `<<=` в IP-allowlist, нативный enum `feature_flag_rollout_strategy`. Живые тесты на PG ловят то, что SQLite пропускает.
4. **Деньги везде `Numeric`/`Decimal`** — нельзя складывать с float и нельзя класть Decimal в JSONB-`config` (известный класс багов сериализации); `Appointment.price` аннотирован `float`, но в БД Numeric.
5. **Append-only журналы** (`ledger_entries`, `loyalty_transactions`, `consent_records`, `inventory_movements`) нельзя редактировать/удалять — балансы и юр-история строятся пересчётом по записям; `inventory.batch_number=""` (не NULL) ради работы UNIQUE-индекса.
