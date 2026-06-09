# routers [08] — управление франшизой, маркетинг, маркетплейс, МИС-синхронизация, мониторинг и уведомления

Этот срез из 15 роутеров покрывает «обвязку» руководителя франшизы и платформы: управление сотрудниками и системными настройками тенанта, продажа и активация коммерческих модулей (marketplace), интеграция с внешней МИС (Renovatio/StoClinic), health-мониторинг модулей и системы, центр уведомлений, NPS-опросы, медкарта пациента, маркетинговые расходы и onboarding-мастер для нового владельца франшизы.

Общие архитектурные черты группы:
- **FastAPI + SQLAlchemy async** (`AsyncSession` через `Depends(get_db)`), почти везде `await db.commit()` вручную.
- **Tenant-изоляция**: подавляющее большинство запросов фильтруется по `current_user.tenant_id`; `super_admin` часто получает сквозной доступ или фильтр через `?tenant_id=`.
- **Роль-гейтинг** через `app.core.deps`: `require_manager`, `require_franchise_owner`, `require_director_or_owner`, `require_role(...)`, `get_current_user`.
- **Аудит** через `app.services.audit_service.write_safe(...)` (best-effort, не валит основной flow).
- **МИС-креды не хранятся в коде** — читаются на лету из `settings_service.get_setting(db, "mis_api_url"/"mis_api_key", tenant_id=...)`.
- Часть роутеров — **сырые SQL через `text(...)`** (monitoring, network_dashboard), что обходит ORM-фильтры и требует ручной осторожности с tenant-скоупом.

## Оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `manager/settings_mgmt.py` | Настройки тенанта: комиссия, МИС, Telegram | 142 |
| `manager/staff.py` | CRUD сотрудников всех ролей, soft/hard-delete | 582 |
| `manager_mis_webhooks.py` | Вебхуки тенанта на события подписки | 201 |
| `manager_subscription_cash.py` | Активация подписки пациента за наличные | 465 |
| `marketing_ads.py` | CRUD каналов и рекламных расходов | 393 |
| `marketplace.py` | Витрина модулей, триал/активация/отписка | 446 |
| `medcard.py` | Медкарта: диагнозы, аллергии, прививки, timeline | 621 |
| `mis_sync.py` | Импорт клиник/врачей/услуг из МИС | 404 |
| `module_monitoring.py` | Health-статус платных модулей per-tenant | 238 |
| `modules.py` | Доступные фичи/планы тенанта для UI | 89 |
| `monitoring.py` | Мониторинг сервера, БД, Redis, МИС | 1138 |
| `network_dashboard.py` | Сводная панель сети клиник + PDF | 522 |
| `notifications.py` | Центр уведомлений (колокольчик) staff | 495 |
| `nps.py` | NPS-опрос пациента после чата | 93 |
| `onboarding.py` | Мастер настройки франшизы (6 шагов) | 431 |

---

## `backend/app/routers/manager/settings_mgmt.py`
- **Назначение:** Управление системными настройками тенанта: ставка/получатель комиссии рекрутёра, реквизиты МИС, Telegram-уведомления и саппорт-бот. Все настройки изолированы по тенанту через key-value `settings_service`.
- **Ключевые элементы:** роутер без собственного префикса (монтируется внутрь `/manager`); константа `GENERAL_SETTINGS_KEYS` (whitelist разрешённых ключей); функции `get_commission_settings`, `update_commission_settings`, `get_general_settings`, `update_general_settings`, `test_mis_connection`, `get_mis_status`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/manager/settings/commission` | manager | — | `CommissionSettings` | Текущие настройки комиссии + имя получателя |
| PATCH | `/manager/settings/commission` | manager | `UpdateCommissionRequest` | `CommissionSettings` | Включить/ставка/получатель комиссии |
| GET | `/manager/settings/general` | manager | — | `dict` | Все general-настройки (МИС/Telegram) |
| PATCH | `/manager/settings/general` | manager | `dict` | `{"status":"ok"}` | Сохранить general-настройки + audit |
| POST | `/manager/settings/test-mis` | manager | — | `dict` | Тест соединения с МИС |
| GET | `/manager/mis/status` | manager | — | `{"online":bool,...}` | Статус МИС (online + clinic_count) |

- **Зависимости:** `settings_service.get_setting/set_setting` (key-value хранилище настроек), `audit_service.write_safe` + `AuditAction.SETTINGS_UPDATED`, `mis_client.test_connection` (lazy import), модели `User`, схемы `CommissionSettings`/`UpdateCommissionRequest` из `app.schemas.manager`.
- **Где менять для типовых задач:** добавить новую general-настройку — внести ключ в `GENERAL_SETTINGS_KEYS` (стр. 67-73); изменить валидацию ставки комиссии — стр. 56-57 (диапазон 0.1..100); сменить логику проверки получателя комиссии — стр. 60 (требует роль `MANAGER` + active).
- **Подводные камни:** audit-лог намеренно **маскирует секреты** (`mis_api_key`, `telegram_bot_token`, `support_bot_token`) — стр. 102, при добавлении нового секрета не забыть добавить его в исключения. `commission_rate` хранится строкой и парсится `float(...)` — потенциальная Decimal-неточность для денежных расчётов (здесь только ставка %). `update_commission_settings` повторно вызывает `get_commission_settings(...)` — два прохода в БД.
- **Строк:** 142

## `backend/app/routers/manager/staff.py`
- **Назначение:** Полный CRUD сотрудников: назначение клиники администратору, создание/обновление/деактивация admin/manager, универсальное создание сотрудника **любой роли** (reg/nurse/doctor/recruiter/manager/partner/visiting/deputy/accountant/lab) с авто-созданием связанных `Doctor`/`DoctorClinicAccess`/`VisitingDoctorSettings`, soft- и hard-delete.
- **Ключевые элементы:** `CreateStaffRequest`, `HardDeleteRequest` (Pydantic); словари `_ROLE_HIERARCHY` (кто кого может создавать), `_ROLE_MAP` (строка→`UserRole`); функции `assign_clinic`, `create_admin`, `update_admin`, `deactivate_admin`, `list_managers`, `create_staff_universal`, `delete_staff_universal`, `hard_delete_staff`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| PATCH | `/manager/admins/{admin_id}/assign-clinic` | manager | `AssignClinicRequest` | `UserResponse` | Привязать/отвязать клинику админу |
| POST | `/manager/admins/` | manager + active sub | `CreateAdminRequest` | `UserResponse` 201 | Создать admin/manager |
| PATCH | `/manager/admins/{admin_id}` | manager | `UpdateAdminRequest` | `UserResponse` | Обновить сотрудника (вкл. сброс пароля) |
| DELETE | `/manager/admins/{admin_id}?hard=` | manager | — | `{"status":...}` | Деактивировать (или обезличить при hard) |
| GET | `/manager/managers/` | manager | — | `list[dict]` | Список активных менеджеров |
| POST | `/manager/users/create-staff` | manager + active sub | `CreateStaffRequest` | `dict` 201 (user+QR) | Универсальное создание любой роли |
| DELETE | `/manager/users/{user_id}` | manager | — | 204 | Soft-delete (is_active=false, suspended=true) |
| DELETE | `/manager/users/{user_id}/hard` | manager | `HardDeleteRequest` | 204 | Hard-delete с подтверждением паролем |

- **Зависимости:** модели `User`/`UserRole`, `Clinic`, `Doctor`, `DoctorClinicAccess`, `Tenant`, `VisitingDoctorSettings` (lazy); `security.hash_password`/`verify_password`; `qr_service.generate_url_qr_base64`; `core.limits.check_plan_limit("users", ...)`; `core.subscription_guard.require_active_subscription`; `audit_service`.
- **Где менять для типовых задач:** разрешить роли создавать новую роль — править `_ROLE_HIERARCHY` (стр. 263-267) и `_ROLE_MAP` (стр. 270-283); изменить набор связанных сущностей при создании врача — блок стр. 362-459 (`Doctor`, `DoctorClinicAccess`, `VisitingDoctorSettings`); поменять формат QR/login-url — стр. 477-484; правила hard-delete — стр. 540-581.
- **Подводные камни:** `password_must_change=True` ставится при любом заданном пароле (флаг **pwdmust01**, повторяется в нескольких местах). `create_staff_universal` использует `Decimal(str(...))` для денежных полей visiting (правильно), но `bonus_percent`/`price_per_visit` приходят `float`. Hard-delete может упасть на `IntegrityError` от FK — обрабатывается возвратом 409 с просьбой использовать soft-delete (стр. 571-580). `tenant_id`-проверки сравнивают через `current_user.tenant_id is not None` — для `super_admin` без tenant фильтр обходится. `verify_password(..., current_user.hashed_password)` — обратите внимание на свойство `hashed_password` (не `password_hash`).
- **Строк:** 582

## `backend/app/routers/manager_mis_webhooks.py`
- **Назначение:** CRUD исходящих вебхуков тенанта, которые система дёргает на события подписки (`subscription.activated/cancelled/renewed`). Позволяет внешней МИС (Renovatio/StoClinic/custom) узнавать об изменении подписок пациентов.
- **Ключевые элементы:** роутер с `prefix="/manager/mis-webhooks"` и `dependencies=[Depends(require_manager)]`; константы `ALLOWED_EVENTS`, `ALLOWED_MIS_TYPES`; схемы `WebhookIn`, `WebhookPatch`; хелперы `_to_dict`, `_validate_events`; эндпоинты `list_hooks`, `create_hook`, `update_hook`, `delete_hook`, `test_hook`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/manager/mis-webhooks` | manager | — | `{"items":[...]}` | Список вебхуков тенанта |
| POST | `/manager/mis-webhooks` | manager | `WebhookIn` | `dict` 201 | Создать вебхук |
| PATCH | `/manager/mis-webhooks/{hook_id}` | manager | `WebhookPatch` | `dict` | Обновить вебхук |
| DELETE | `/manager/mis-webhooks/{hook_id}` | manager | — | 204 | Удалить вебхук |
| POST | `/manager/mis-webhooks/{hook_id}/test` | manager | — | результат отправки | Отправить тестовый payload |

- **Зависимости:** модель `TenantMisSubscriptionWebhook`; `app.services.mis_webhook_sender.test_webhook`; `core.deps.get_current_user`/`require_manager`. Дополнительно `require_manager` навешан на весь роутер и плюс `get_current_user` внутри хэндлеров для доступа к `user.tenant_id`.
- **Где менять для типовых задач:** добавить новый тип события — расширить `ALLOWED_EVENTS` (стр. 35-39) и `_validate_events`; новый тип МИС — `ALLOWED_MIS_TYPES` (стр. 40) + regex-паттерны в схемах `WebhookIn`/`WebhookPatch` (стр. 44, 54); сериализация ответа (что отдаём наружу) — `_to_dict` (стр. 62-76, скрывает `auth_header`, отдаёт лишь флаг `auth_header_set`).
- **Подводные камни:** `auth_header` **не возвращается** наружу (только bool), но хранится как есть — секрет в БД. `webhook_url` приходит `HttpUrl`, при сохранении/патче кастится `str(...)` (стр. 114, 149). Tenant-фильтр строго по `user.tenant_id`, без tenant — 403. Реальная отправка вебхуков на события — в `manager_subscription_cash.py` (см. `send_mis_webhook_safe`), здесь только управление и тест.
- **Строк:** 201

## `backend/app/routers/manager_subscription_cash.py`
- **Назначение:** Оформление подписки пациента (модуль «Здоровье+») **за наличные** менеджером/регистратором: создание подписки + запись в `billing_ledger`, PDF-квитанция, журнал и статистика активаций, поиск пациента (ЛК + МИС) и find-or-create `PatientAccount`.
- **Ключевые элементы:** `prefix="/manager/subscription-cash"`; схемы `ActivateIn`, `EnsurePatientIn`; гейты `_require_cash_role`, `_require_module` (проверка `health_plus_module_active`); хелперы `_mis_full_name`, `_patient_dto`; эндпоинты `activate`, `receipt_pdf`, `history`, `stats`, `search_patients`, `ensure_patient`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| POST | `/manager/subscription-cash/activate` | manager/owner/reg/super | `ActivateIn` | `dict` 201 | Оформить подписку за нал + ledger + МИС-webhook |
| GET | `/manager/subscription-cash/{ledger_id}/receipt.pdf` | manager/owner/reg/super | — | `application/pdf` | PDF-квитанция |
| GET | `/manager/subscription-cash/history` | те же | query `from/to/clinic_id/limit` | `{"items":[...]}` | Журнал активаций |
| GET | `/manager/subscription-cash/stats` | те же (tenant обязателен) | `period=7d/30d/90d/365d` | статистика | Выручка/средний чек |
| GET | `/manager/subscription-cash/search-patients` | те же | `q`, `limit` | `{"patients":[...]}` | Поиск пациента (ЛК + Renovatio) с дедупом |
| POST | `/manager/subscription-cash/ensure-patient` | те же | `EnsurePatientIn` | `{"id",...,"created"}` | Find-or-create PatientAccount |

- **Зависимости:** сервисы `subscription_cash_service` (как `scs`: `activate_cash`, `render_receipt_pdf`, `list_history`, `stats`), `subscription_service` (`ss.plan_meta_db`), `mis_webhook_sender.send_mis_webhook_safe`, `subscription_module_service.health_plus_module_active`, `mis_client` (`find_patient_by_phone`, `_post`); модели `BillingLedger`, `PatientAccount`, `PatientSubscription`, `Clinic`, `Tenant`; `utils.phone.normalize_phone`.
- **Где менять для типовых задач:** правила доступа к кассовым операциям — `_require_cash_role` (стр. 42-48); сумма/расхождение/флаг — внутри `scs.activate_cash`, здесь только проброс `Decimal(str(body.amount_received))` (стр. 109); содержимое квитанции — словарь `ctx` (стр. 200-217) + шаблон в `scs.render_receipt_pdf`; источники поиска пациента и логика дедупа — `search_patients` (стр. 289-409, ЛК побеждает над МИС по нормализованному телефону).
- **Подводные камни:** деньги корректно идут через **`Decimal`** (стр. 109), но в квитанции форматируются из `meta` через `:.2f` поверх возможного float (стр. 211-212). `PatientAccount` **глобален по телефону**, не tenant-scoped — поиск по «хвосту» 7-10 цифр через `ILIKE` (стр. 327-329, 439-441), возможны коллизии при разных форматах номера. МИС-webhook вызывается после `commit` как best-effort. `receipt_pdf` проверяет `entry_type == "subscription_cash"` и tenant. Поиск в МИС обёрнут в `try/except: pass` — тихо игнорирует ошибки внешнего API.
- **Строк:** 465

## `backend/app/routers/marketing_ads.py`
- **Назначение:** CRUD маркетинговых каналов (системные + кастомные тенанта) и записей рекламных расходов (`ad_spend`) с метриками лидов/кликов/показов. ROI и атрибуция источников считаются отдельно в `director.py` (`/director/marketing/*`).
- **Ключевые элементы:** `prefix="/marketing"`; гейт чтения `_require_read_access` (director/deputy/owner/manager/super); хелперы `_role_str`, `_ad_spend_out`; схемы `ChannelOut/Create/Update`, `AdSpendOut/Create/Update`; эндпоинты `list_channels`, `create_channel`, `update_channel`, `delete_channel`, `list_ad_spend`, `create_ad_spend`, `update_ad_spend`, `delete_ad_spend`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/marketing/channels` | read-access | `?include_inactive` | `list[ChannelOut]` | Каналы (системные + тенанта) |
| POST | `/marketing/channels` | manager | `ChannelCreateRequest` | `ChannelOut` 201 | Создать кастомный канал |
| PATCH | `/marketing/channels/{id}` | manager | `ChannelUpdateRequest` | `ChannelOut` | Редактировать (только tenant-канал) |
| DELETE | `/marketing/channels/{id}` | manager | — | 204 | Удалить (только tenant-канал) |
| GET | `/marketing/ad-spend` | read-access | `from/to/channel_id/clinic_id` | `list[AdSpendOut]` | Расходы за период |
| POST | `/marketing/ad-spend` | manager | `AdSpendCreateRequest` | `AdSpendOut` 201 | Добавить расход |
| PATCH | `/marketing/ad-spend/{id}` | manager | `AdSpendUpdateRequest` | `AdSpendOut` | Обновить расход |
| DELETE | `/marketing/ad-spend/{id}` | manager | — | 204 | Удалить расход |

- **Зависимости:** модели `MarketingChannel`, `AdSpendEntry` (`app.models.marketing`); `core.deps.get_current_user`/`require_manager`; `User`/`UserRole`. Аудита здесь нет.
- **Где менять для типовых задач:** список ролей с правом просмотра — `_require_read_access` (стр. 48-59); поля расхода/метрик — схемы `AdSpend*` (стр. 92-137) + `_ad_spend_out` (стр. 257-269); правило «системные каналы нельзя править/удалять» — стр. 215-216, 242-243 (`tenant_id is None` = системный).
- **Подводные камни:** «системный» канал определяется как `tenant_id IS NULL` — такие каналы видны всем тенантам и защищены от изменения. `amount` хранится в модели (тип на стороне модели) и отдаётся через `float(e.amount)` (стр. 264) — следить за Decimal/float на уровне модели при денежных суммах. Валидация `period_to >= period_from` проверяется и при create (стр. 323), и при update **после** применения изменений (стр. 369). Фильтр по периоду в `list_ad_spend` использует пересечение интервалов (`period_to >= from` и `period_from <= to`).
- **Строк:** 393

## `backend/app/routers/marketplace.py`
- **Назначение:** Витрина коммерческих модулей: публичный каталог (без auth), просмотр статуса подписок тенанта, запуск триала, платная активация и отписка. Активации пишут в `billing_ledger` (charge + revenue_split) и audit.
- **Ключевые элементы:** `prefix="/marketplace"`; схемы `StartTrialRequest`, `ActivateRequest`; хелперы `_mod_full` (сериализация с/без публичных полей), `_sub_out`, `_calc_expires`, `_get_module`, `_get_sub`, `_authorize_tenant` (super_admin/franchise_owner-проверка); эндпоинты `public_list_modules`, `tenant_marketplace`, `start_trial`, `activate_module`, `cancel_module`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/marketplace/modules` | публично | — | `list[dict]` | Каталог активных модулей (витрина) |
| GET | `/marketplace/tenant/{tenant_id}/modules` | super/owner-своих | — | `list[dict]` | Каталог + статус подписок тенанта |
| POST | `/marketplace/tenant/{tenant_id}/modules/{key}/start-trial` | super/owner | `StartTrialRequest` | `dict` подписки | Триал на N дней (повторно нельзя) |
| POST | `/marketplace/tenant/{tenant_id}/modules/{key}/activate` | super/owner | `ActivateRequest` | `dict` подписки | Платная активация + ledger |
| POST | `/marketplace/tenant/{tenant_id}/modules/{key}/cancel` | super/owner | — | `dict` подписки | Отписка (status=cancelled) |

- **Зависимости:** модели `CommercialModule`, `TenantModuleSubscription`, `ModuleStatus`, `Tenant`, `Franchise`, `User`/`UserRole`; `billing_service.record_billing_ledger` + `_apply_revenue_split` (lazy); `billing_ledger.EntryType/Direction`; `audit_service.write_safe`.
- **Где менять для типовых задач:** добавить billing-цикл — `ActivateRequest` regex (стр. 51-54) + `_calc_expires` (стр. 101-107); правила авторизации тенанта — `_authorize_tenant` (стр. 130-159); набор полей витрины — `_mod_full` (стр. 59-80); запрет повторного триала — стр. 242-247 (флаг `trial_ends_at is not None`).
- **Подводные камни:** цена идёт через `Decimal("0")`/`m.price_monthly`/`sub.custom_price` и `_apply_revenue_split` — денежные операции в Decimal (хорошо). Запись в billing-ledger и revenue-split обёрнуты в `try/except: pass` (стр. 297-298, 386-387) — **молчаливое проглатывание ошибок биллинга**, требует внимания при отладке. `_mod_full` использует `getattr(m, ..., default)` для полей, которые могут отсутствовать в старых миграциях (`monthly_price_demo`, `screenshots`, `popular`). Публичный каталог отдаёт цены без auth.
- **Строк:** 446

## `backend/app/routers/medcard.py`
- **Назначение:** Медкарта пациента — диагнозы, аллергии, прививки. Две стороны: пациентское чтение собственной карты (по сессионному токену) и staff-CRUD (manager/doctor/reg/nurse). Плюс агрегированный timeline медицинских событий из `Referral` + `Appointment` + МИС.
- **Ключевые элементы:** роутер без префикса (пути захардкожены `/patient/medcard/*` и `/medcard/*`); гейт `_staff_dep = require_role("manager","doctor","reg","nurse")`; хелперы `_patient_session_or_401`, `_diag_dict`/`_allergy_dict`/`_vacc_dict`, `_parse_dt`; схемы `DiagnosisIn/Patch`, `AllergyIn/Patch`, `VaccIn/Patch`; эндпоинты чтения пациента, staff-CRUD по 3 сущностям и `patient_medcard_timeline`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/patient/medcard/diagnoses` | patient session | `session_token/t` или `X-Patient-Session` | `list[dict]` | Диагнозы пациента |
| GET | `/patient/medcard/allergies` | patient session | токен | `list[dict]` | Аллергии пациента |
| GET | `/patient/medcard/vaccinations` | patient session | токен | `list[dict]` | Прививки пациента |
| GET | `/patient/medcard/timeline` | patient session | `?days` | `{"items":[...],"total"}` | Timeline (Referral+Appointment+МИС) |
| POST/PATCH/DELETE/GET | `/medcard/diagnoses[/{id}]` | manager/doctor/reg/nurse | `DiagnosisIn/Patch`, `?patient_phone` | `dict`/`{"ok":true}` | Staff-CRUD диагнозов |
| POST/PATCH/DELETE/GET | `/medcard/allergies[/{id}]` | те же | `AllergyIn/Patch` | аналогично | Staff-CRUD аллергий |
| POST/PATCH/DELETE/GET | `/medcard/vaccinations[/{id}]` | те же | `VaccIn/Patch` | аналогично | Staff-CRUD прививок |

- **Зависимости:** модели `PatientDiagnosis`, `PatientAllergy`, `PatientVaccination` (`app.models.medcard`); `patient_session_service.restore_session`; `utils.phone.normalize_phone`; в timeline lazy-импорт `Referral`/`Appointment`/`Doctor`/`Clinic`/`Service`/`User` + `mis_client.find_patient_by_phone`/`_post` + `settings_service.get_setting`; `core.deps.require_role`/`get_current_user`.
- **Где менять для типовых задач:** добавить поле к диагнозу/аллергии/прививке — править соответствующую модель, `*_dict`-сериализатор и `*In/*Patch` схему (по 3 места на сущность); изменить кто из staff редактирует медкарту — `_staff_dep` (стр. 146); расширить источники timeline — функция `patient_medcard_timeline` (стр. 475-620), блоки 1) направления, 2) приёмы, 3) МИС-визиты.
- **Подводные камни:** пациентское чтение фильтрует по **нормализованному `patient_phone`** + `tenant_id`, а timeline матчит по списку вариантов телефона `[phone, "+"+phone, "8"+phone[1:]]` (стр. 507, 542) — рассинхрон форматов телефона легко ломает выборку. Связь медкарта↔пациент **только по телефону** (нет FK на PatientAccount). `source="manual"` ставится staff-записям. МИС-визиты в timeline ограничены 30 на клинику и обёрнуты `try/except: continue` — частичная деградация. `_parse_dt` глотает невалидные даты в None.
- **Строк:** 621

## `backend/app/routers/mis_sync.py`
- **Назначение:** Импорт/синхронизация из внешней МИС (Renovatio): список и импорт клиник, врачей, услуг (с фильтром по категориям/клиникам), профиль и история визитов пациента, ручной поллинг авто-подтверждения направлений, создание ЛК-кабинета врача.
- **Ключевые элементы:** `prefix="/mis"`; локальный гейт `_require_manager` (manager/super/reg); все эндпоинты под `Depends(require_module("mis_sync"))`; схемы `SyncClinicsRequest`, `SyncDoctorsRequest`, `SyncServicesRequest`, `CreateDoctorAccountRequest`; эндпоинты `list_mis_clinics`, `sync_mis_clinics`, `list_mis_doctors`, `sync_mis_doctors`, `list_mis_services`, `sync_mis_services`, `get_patient_profile`, `get_patient_appointments`, `trigger_poll`, `create_doctor_account`, `list_doctor_accounts`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/mis/clinics` | manager/reg/super + module | — | `{"clinics":[...]}` | Клиники из МИС для выбора |
| POST | `/mis/clinics/sync` | те же + module | `SyncClinicsRequest` | created/updated | Импорт клиник |
| GET | `/mis/doctors` | те же + module | — | `{"doctors":[...]}` | Врачи из МИС |
| POST | `/mis/doctors/sync` | те же + module | `SyncDoctorsRequest` | created/updated/skipped | Импорт врачей |
| GET | `/mis/services` | те же + module | `?clinic_mis_id` | services + категории | Услуги из МИС |
| POST | `/mis/services/sync` | те же + module | `SyncServicesRequest` | результат | Импорт услуг в наши клиники |
| GET | `/mis/patient/profile` | current_user + module | `?phone` | профиль | Профиль пациента из МИС |
| GET | `/mis/patient/appointments` | current_user + module | `?phone&months_back` | визиты | История визитов |
| POST | `/mis/poll-referrals` | manager/reg/super + module | — | результат | Ручной поллинг подтверждений |
| POST | `/mis/doctors/create-account` | те же + module | `CreateDoctorAccountRequest` | user_id/username | ЛК-кабинет врача |
| GET | `/mis/doctors/accounts` | те же + module | — | `list[dict]` | Врачи + наличие кабинета |

- **Зависимости:** `mis_sync_service` (`get_mis_clinics`, `sync_clinics_bulk`, `get_mis_users`, `sync_doctors_bulk`, `get_mis_services`, `sync_services_bulk`, `get_patient_from_mis`, `get_patient_appointments_from_mis`, `poll_and_confirm_referrals`); `settings_service.get_setting` (mis_api_url/key); `core.tenant.require_module("mis_sync")`; модели `Doctor`, `User`/`UserRole`; `security.hash_password`.
- **Где менять для типовых задач:** маппинг полей МИС→наш формат — внутри list-эндпоинтов (клиники стр. 46-57, врачи 95-108, услуги 158-174, визиты 262-287); логику импорта менять в `mis_sync_service`, не здесь; правила доступа — `_require_manager` (стр. 30-33) либо `require_module` на конкретном эндпоинте; создание кабинета врача и проверки уникальности логина — `create_doctor_account` (стр. 316-372).
- **Подводные камни:** **`require_module("mis_sync")`** — это гейт коммерческого модуля; без активной подписки все эндпоинты вернут ошибку доступа. Креды МИС читаются на каждый запрос из настроек тенанта (не кэшируются). Цены услуг кастятся `float(...)` (стр. 165) — для импорта прайса; денежная точность зависит от `sync_services_bulk`. `_post` к МИС и фильтрация врачей по `role_names`/`is_deleted` — на клиенте. `create_doctor_account` делает `import HTTPException` локально несколько раз (легаси-стиль, не баг). Поллинг `poll_and_confirm_referrals(db)` запускается без tenant-аргумента — проверьте скоуп в сервисе.
- **Строк:** 404

## `backend/app/routers/module_monitoring.py`
- **Назначение:** Health-мониторинг **платных модулей** per-tenant: статус (ok/degraded/error/idle/unknown), heatmap по всем тенантам (super_admin), внеочередная проверка, детали по модулю с метриками и 24-часовой audit-историей.
- **Ключевые элементы:** `prefix="/admin/modules"`; хелперы `_is_super`, `_can_view_own`; эндпоинты `get_my_modules_health`, `get_all_tenants_modules`, `trigger_health_check`, `module_details`; вложенная функция `_problem_score` (скоринг проблемности тенанта).
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/admin/modules/health` | super/owner/manager | `?tenant_id` (super) | модули тенанта или heatmap | Health своего тенанта |
| GET | `/admin/modules/health/all` | super_admin | `?status_filter` | tenants + top_problematic | Heatmap по всем тенантам |
| POST | `/admin/modules/health/check-now` | super/owner/manager | `?tenant_id` (super) | stats | Внеочередная проверка |
| GET | `/admin/modules/health/{module_key}` | super/owner/manager | `?tenant_id` (super) | health + audit[] | Детали модуля + история |

- **Зависимости:** `module_health_service` (`get_modules_health_all_tenants`, `get_modules_health_for_tenant`, `run_health_checks_all_tenants`, `run_health_checks_for_tenant`); модели `ModuleHealthCheck`, `ModuleHealthStatus`, `AuditEntry`, `User`/`UserRole`; `core.deps.get_current_user`.
- **Где менять для типовых задач:** скоринг «самых проблемных» тенантов — `_problem_score` (стр. 102-110, error=2/degraded=1); набор ролей с доступом — `_can_view_own` (стр. 44-46); окно audit-истории в деталях — стр. 198 (24 часа, лимит 20 записей); формат пустого ответа при отсутствии health-записи — стр. 186-195.
- **Подводные камни:** `super_admin` без `?tenant_id` на `/health` получает heatmap по **всем** тенантам — потенциально тяжёлый запрос. Маршрут `/health/{module_key}` объявлен после `/health/all` и `/health/check-now`, но FastAPI матчит статические сегменты раньше параметрических, так что `all`/`check-now` не перехватываются как `module_key` (порядок важен — не переставлять). audit-история фильтруется `entity_type == module_key` — записи должны писаться с этим entity_type.
- **Строк:** 238

## `backend/app/routers/modules.py`
- **Назначение:** Лёгкий read-only API доступных фич и тарифных планов тенанта. Фронтенд использует для условного рендеринга разделов меню (показ/скрытие). Плюс список активных коммерческих модулей тенанта.
- **Ключевые элементы:** `prefix="/modules"`; схемы `FeatureItem`, `PlanInfo`; эндпоинты `list_features`, `check_feature`, `get_active_module_keys`, `list_plans`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/modules/features` | авторизованный | license | `list[FeatureItem]` | Все фичи с флагом enabled |
| GET | `/modules/features/{name}` | авторизованный | license | `{name,label,enabled}` | Проверить одну фичу (404 если нет) |
| GET | `/modules/active-keys` | авторизованный | — | `list[str]` | Активные коммерческие модули тенанта |
| GET | `/modules/plans` | авторизованный | — | `list[PlanInfo]` | Каталог планов и их фич |

- **Зависимости:** `app.modules` (`get_features_for_ui`, `has_feature`, `get_enabled_features`), `app.modules.features` (`PLANS`, `PLAN_FEATURES`, `FEATURE_LABELS`); `core.tenant.get_tenant_license`; модель `TenantLicense`, `commercial.TenantModuleSubscription` (lazy в active-keys).
- **Где менять для типовых задач:** определения фич/планов — **не здесь**, а в `app/modules/features.py` (`PLAN_FEATURES`, `FEATURE_LABELS`, `PLANS`); статусы, считающиеся «активными» для active-keys — стр. 73 (`["active","trial"]`); логику доступности фичи — `has_feature`/`get_features_for_ui` в `app/modules/`.
- **Подводные камни:** `get_active_module_keys` обёрнут в `try/except: return []` (стр. 67-79) — при любой ошибке тихо отдаёт пустой список, что может скрыть подключённые модули в UI. Доступ к фичам определяется лицензией тенанта (`TenantLicense`), а коммерческие модули — отдельной таблицей `TenantModuleSubscription`: две разные системы прав, не путать.
- **Строк:** 89

## `backend/app/routers/monitoring.py`
- **Назначение:** Системный мониторинг для администратора: сервер (CPU/RAM/диск через psutil), Docker-контейнеры (через sidecar-прокси), PostgreSQL, Redis, МИС-ping, фоновые задачи, метрики запросов, безопасность, активные пользователи, live бизнес-метрики, storage-детализация, алерты и графики истории. Публичный `/monitoring/health`.
- **Ключевые элементы:** `prefix="/monitoring"`; константа `DOCKER_PROXY_URL`; сбор-функции `_get_server_stats`, `_get_containers`, `_get_telegram_bot_status`, `_get_db_stats`, `_get_redis_stats`, `_get_mis_stats`, `_get_background_tasks`, `_get_referrals_today`; эндпоинты `get_system_status`, `get_container_logs`, `get_db_analysis`, `get_performance_stats`, `get_security_stats`, `get_integrations_stats`, `health_check`, `get_request_metrics`, `get_endpoint_breakdown`, `get_health_history`, `save_health_snapshot`, `get_db_pool_stats`, `get_api_stats`, `get_active_users`, `get_business_now`, `get_storage_detail`, `get_alerts`, `get_perf_history`.
- **Эндпоинты (ключевые):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/monitoring/system` | manager | — | сводный dict | Сервер+контейнеры+БД+Redis+МИС+алерты |
| GET | `/monitoring/logs` | manager | `?container&lines` | logs | Логи контейнера (whitelist) |
| GET | `/monitoring/db-analysis` | manager | — | tables[] | Размеры/строки таблиц |
| GET | `/monitoring/performance` | manager | — | cache/bloat/slow/index | Производительность БД |
| GET | `/monitoring/security` | manager | — | dict | Неудачные входы, активные сессии |
| GET | `/monitoring/integrations` | manager | — | dict | МИС-вебхуки + Telegram-бот |
| GET | `/monitoring/health` | **публично** | — | JSONResponse 200/503 | Healthcheck (db+redis) |
| GET | `/monitoring/metrics` | manager | `?window` | метрики | Запросы за N минут (Redis) |
| GET | `/monitoring/metrics/endpoints` | manager | `?window` | топ эндпоинтов | Breakdown по эндпоинтам |
| GET | `/monitoring/health/history` | manager | `?limit` | history | История снимков здоровья |
| POST | `/monitoring/health/snapshot` | manager | — | snapshot | Сохранить снимок в Redis |
| GET | `/monitoring/pool` | manager | — | pool+sessions | Пул SQLAlchemy + pg_stat_activity |
| GET | `/monitoring/api-stats` | manager | `?hours` | hourly | API stats p50/p95/p99 |
| GET | `/monitoring/active-users` | manager | — | online+top+logins | Онлайн (WS presence) + активность |
| GET | `/monitoring/business-now` | manager | — | live-метрики | Приёмы/выручка/телемед сегодня |
| GET | `/monitoring/storage-detail` | manager | — | disk breakdown | Разбивка диска (du/find/journalctl) |
| GET | `/monitoring/alerts` | manager | `?limit&severity` | alerts[] | Алерты (audit+activity+live) |
| GET | `/monitoring/perf-history` | manager | `?hours` | series | CPU/RAM/Disk история (+Prometheus) |

- **Зависимости:** `require_manager`; `app.utils.metrics` (`get_request_metrics`, `get_request_metrics_hourly`, `get_health_history`, `save_health_snapshot`); `app.database.engine`/`AsyncSessionLocal`; `app.config.settings.redis_url`; внешние `psutil`, `httpx`, `redis.asyncio`, `subprocess`; sidecar `clinika-docker-proxy:9099`.
- **Где менять для типовых задач:** пороги алертов CPU/RAM/диск — `get_system_status` (стр. 196-213) и live-блок в `get_alerts` (стр. 1044-1064); whitelist контейнеров для логов — стр. 246; добавить новый блок в `/system` — расширить `asyncio.gather` (стр. 183-191); расписания cron в storage — `cleanup_info` (стр. 946-952, **захардкожено**, может разойтись с реальным шедулером).
- **Подводные камни:** **массово сырые SQL** через `text(...)` по таблицам `appointments`, `activity_log`, `audit_log`, `patient_accounts`, `telemedicine_sessions` — **без tenant-фильтра** (это глобальный системный мониторинг для админа, но при предоставлении доступа не-super ролям это утечка между тенантами). `/monitoring/health` **публичный** (без auth). `get_storage_detail` запускает `subprocess` (`du`, `find`, journalctl) — работает только в Linux-контейнере, не на Windows-dev. `_get_server_stats` использует `psutil.getloadavg()` — нет на Windows. Много блоков обёрнуто в `try/except` с отдачей частичных данных. Денежные суммы (`revenue_today`) считаются `float(SUM(price))` напрямую в SQL.
- **Строк:** 1138

## `backend/app/routers/network_dashboard.py`
- **Назначение:** Сводная панель сети клиник для руководства: KPI (выручка, визиты, новые/активные ЛК-пациенты, NPS) по каждой клинике и по сети, список и детали ЛК-пациентов сети, PDF-экспорт отчёта через WeasyPrint (с inline SVG-графиками).
- **Ключевые элементы:** `prefix="/network"`; хелперы `_scope_tenants` (определение скоупа: франшиза или одна клиника), `_clinic_metrics`, `_build_overview`; рендер PDF `_fmt_money`, `_bar`, `_render_html`; эндпоинты `network_overview`, `network_patients`, `network_patient_details`, `export_overview_pdf`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/network/overview` | director/deputy/owner/super | `?days` | KPI + per-clinic | Сводная панель сети |
| GET | `/network/patients` | те же | `?q&limit` | `{"patients":[...]}` | ЛК-пациенты сети с агрегацией визитов |
| GET | `/network/patients/{patient_id}` | те же | — | детали | Карточка пациента: визиты по клиникам |
| GET | `/network/overview/export-pdf` | те же | `?days` | `application/pdf` | PDF-отчёт (WeasyPrint) |

- **Зависимости:** `core.deps.require_director_or_owner`; модели `Tenant`, `User`, `NpsResponse` (`app.models.engagement`); WeasyPrint (`weasyprint.HTML`, lazy import); сырые SQL по `appointments`, `patient_accounts`.
- **Где менять для типовых задач:** определение скоупа сети (франшиза vs одна клиника) — `_scope_tenants` (стр. 30-47, ключ — `tenant.franchise_id`); набор KPI клиники — `_clinic_metrics` (стр. 50-103); агрегации/totals по сети — `_build_overview` (стр. 106-166); вёрстка/графики PDF — `_render_html` (стр. 388-521, SVG line+bar chart инлайном).
- **Подводные камни:** **сырые SQL** связывают `patient_accounts` ↔ `appointments` **по телефону** (`a.patient_phone = pa.phone`) и используют `::text = ANY(:tids_arr)` для tenant-фильтра — корректно для скоупа сети, но связь по телефону хрупка к форматам. NPS усредняется по 90 дням, прочие метрики — по `days`. Выручка считается `COALESCE(SUM(price),0)::float` напрямую в SQL (float). `_render_html` делает финальный `.replace(",", " ")` по всей строке HTML — может затронуть и нежелательные запятые. PDF падает 500, если WeasyPrint не установлен (стр. 364-365) — на dev-Windows weasyprint lazy, поэтому импорт внутри функции.
- **Строк:** 522

## `backend/app/routers/notifications.py`
- **Назначение:** Центр уведомлений (колокольчик в шапке staff-кабинетов): агрегирует `audit_log` + `activity_log` + платформенные объявления + контакт-реквесты в ≤10 последних событий, отметка «прочитано» (без модификации append-only логов), пользовательские настройки отключаемых категорий.
- **Ключевые элементы:** `prefix="/notifications"`; константы `CATEGORIES`, `CATEGORY_IDS`, `_ACTION_TEMPLATES` (action→русский шаблон); классификаторы `_category`, `_classify_action`, `_readable_text`; хелпер `_get_disabled_categories`; эндпоинты `recent_notifications`, `mark_notification_read`, `mark_all_read`, `get_preferences`, `update_preferences`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/notifications/recent` | авторизованный (не patient) | — | `{"items":[...],"unread"}` | Последние ≤10 событий + счётчик |
| POST | `/notifications/{notif_id}/read` | авторизованный | `notif_id="kind:uuid"` | `{"ok":true}` | Пометить событие прочитанным |
| POST | `/notifications/read-all` | авторизованный | — | `{"ok",marked}` | Пометить все непрочитанные |
| GET | `/notifications/preferences` | авторизованный | — | categories+disabled | Категории + отключённые |
| PUT | `/notifications/preferences` | авторизованный | `{"disabled":[...]}` | `{"ok",disabled}` | Сохранить отключённые категории |

- **Зависимости:** модели `ActivityLog`, `AuditEntry`, `ContactRequest`, `NotificationPreference`, `NotificationRead`, `PlatformAnnouncement`, `User`/`UserRole`; `sqlalchemy.dialects.postgresql.insert` (upsert `on_conflict`); `core.deps.get_current_user`.
- **Где менять для типовых задач:** добавить категорию — `CATEGORIES` (стр. 56-70) + ветка в `_category` (стр. 74-107) + маппинг в `_classify_action` (стр. 121-135); добавить русский текст события — `_ACTION_TEMPLATES` (стр. 140-198); кто видит контакт-реквесты — стр. 348; источники событий — функция `recent_notifications` (4 блока: audit, activity, announcements, contacts).
- **Подводные камни:** «прочитано» хранится в отдельной `notification_reads(user_id, kind, source_id)` чтобы не трогать append-only логи. `mark_all_read` **переиспользует** `recent_notifications(...)` напрямую как функцию (стр. 433) — связность: изменение формата `items` сломает оба. Upsert использует именованные constraint'ы `uq_notif_read` и `index_elements=["user_id"]` — должны существовать в БД. Audit и activity берутся лимитом 40 каждый, потом обрезаются до 10 после сортировки — события могут «теряться» при большом потоке. Tenant-фильтр применяется только если `tenant_id is not None` (super_admin видит всё).
- **Строк:** 495

## `backend/app/routers/nps.py`
- **Назначение:** NPS-опрос пациента по итогам чат-треда: пациент отвечает (0..10 + комментарий) по знанию `survey_id` из чата (без auth), staff видит сводную статистику NPS клиники.
- **Ключевые элементы:** `prefix="/patient/nps"`; схема `NPSAnswer`; эндпоинты `answer`, `get_survey`, `clinic_nps_stats`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| POST | `/patient/nps/{survey_id}/answer` | без auth (по survey_id) | `NPSAnswer` | `{"ok",score}` | Ответ пациента на NPS |
| GET | `/patient/nps/{survey_id}` | без auth | — | `{id,score,answered_at}` | Статус опроса |
| GET | `/patient/nps/clinic/stats` | авторизованный | `?days` | NPS/promoters/... | Сводная статистика клиники |

- **Зависимости:** модель `NPSSurvey` (`app.models.nps_survey`); `core.deps.get_current_user` (только на stats); `User`.
- **Где менять для типовых задач:** формула NPS (промоутеры ≥9, пассивы 7-8, детракторы ≤6) — `clinic_nps_stats` (стр. 80-83); запрет повторного ответа — стр. 38-39 (`answered_at`).
- **Подводные камни:** `/answer` и `/{survey_id}` **без авторизации** — защита только через непредсказуемость `survey_id` (UUID из чата). `clinic_nps_stats` **не фильтрует по tenant/clinic** — считает по всем `NPSSurvey` с `answered_at >= since` (стр. 66-73), что для multi-tenant выглядит как утечка/некорректный скоуп — кандидат на доработку (нет привязки к `current_user.tenant_id`). Маршрут `/clinic/stats` идёт после `/{survey_id}` в коде, но `clinic` — статический сегмент, FastAPI разрешит корректно.
- **Строк:** 93

## `backend/app/routers/onboarding.py`
- **Назначение:** Пошаговый мастер настройки франшизы для нового `franchise_owner` (6 шагов: приветствие → клиника → услуги → сотрудники → уведомления → готово). Аккумулирует данные шагов в `franchises.onboarding_data` (JSONB), а реальное создание тенанта/клиники/услуг/сотрудников происходит при `/complete`.
- **Ключевые элементы:** `prefix="/onboarding"`; константа `TOTAL_STEPS=6`, `SERVICE_TEMPLATES` (general/dental/cosmetology); схемы `StatusResponse`, `Step1Welcome`..`Step5Notify`, `ServiceItem`, `StaffMember` (с валидатором пароля), `StepGenericPayload`; хелперы `_get_or_create_my_franchise`, `_ensure_data`; эндпоинты `get_onboarding_status`, `list_service_templates`, `save_step`, `complete_onboarding`, `reset_onboarding`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/onboarding/status` | franchise_owner | — | `StatusResponse` | Текущий шаг/прогресс мастера |
| GET | `/onboarding/service-templates` | franchise_owner | — | список шаблонов | Шаблоны услуг для шага 3 |
| POST | `/onboarding/step/{n}` | franchise_owner | `dict` (payload шага) | `{ok,step,next_step}` | Сохранить данные шага N (валидация) |
| POST | `/onboarding/complete` | franchise_owner | — | `{ok,created}` | Финализировать: создать клинику/услуги/staff |
| POST | `/onboarding/reset` | super_admin | — | `{ok}` | Сбросить мастер (отладка) |

- **Зависимости:** `core.deps.require_franchise_owner`; `security.hash_password`; `utils.password_strength.validate_password_strength` (в валидаторе `StaffMember`); модели `Franchise`, `Tenant`, `Clinic`, `Service`, `User`/`UserRole`; `services.tenant_onboarding_service.onboard_tenant` (lazy); `sqlalchemy.orm.attributes.flag_modified` для JSONB.
- **Где менять для типовых задач:** добавить/изменить шаг — `TOTAL_STEPS` (стр. 45) + новая `StepN*` схема + ветка валидации в `save_step` (стр. 250-271) + создание ресурса в `complete_onboarding` (стр. 296-405); шаблоны услуг — `SERVICE_TEMPLATES` (стр. 49-80); реальная логика создания тенанта — в `onboard_tenant`, здесь только сборка аргументов (стр. 313-326).
- **Подводные камни:** **`flag_modified(f, "onboarding_data")`** обязателен после мутации JSONB — иначе SQLAlchemy не заметит изменения (повторяется в save_step/complete/reset). `complete_onboarding` обёрнут в множественные `try/except` (услуги/staff/tenant) — частичный успех возможен, ошибки фиксируются в `data["complete_error"]` (стр. 401-404), не блокируя завершение. `save_step` принимает «сырой» `dict` и валидирует Pydantic-схемами выборочно (только при `not skipped`). `password_must_change=bool(m.password)` (флаг pwdmust01). Указатель шага движется только вперёд (стр. 277-278), кнопка «назад» прогресс не сбрасывает. Для `super_admin` без франшизы `_get_or_create_my_franchise` создаёт заглушку.
- **Строк:** 431
