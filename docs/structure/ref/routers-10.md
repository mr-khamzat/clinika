# routers [10] — личный кабинет пациента, RBAC, присутствие/звонки и публичные API

Этот срез объединяет 15 роутеров, которые покрывают четыре больших темы платформы:

1. **Личный кабинет пациента (ЛК)** — лаборатория, динамика анализов, программа лояльности, электронная медкарта, подписка «Здоровье+», расходник, назначения, realtime-уведомления о звонках, PWA-манифест портала. Общая черта: авторизация не по сотрудничьему JWT, а по **patient_session_token** (long-lived 1 год) с единым мульти-источником: `Authorization: Bearer`, заголовок `X-Patient-Session`, query `?session_token=`/`?t=`, либо cookie `clinika_patient_session`. Везде через `restore_session()` восстанавливается `PatientSession` (поля `phone`, `tenant_id`), а аккаунт берётся/создаётся через `family_service.get_or_create_account_by_phone`.
2. **RBAC как данные** — `permissions.py` (матрица effective-прав и override на тенант).
3. **Присутствие и звонки сотрудников** — `presence.py` (WebSocket + Redis Pub/Sub, WebRTC-сигнализация, TURN-креды) и профиль сотрудника `profile.py`.
4. **Публичные/партнёрские API** — приём лидов от агрегаторов и lab-webhook, REST API v1 для CRM/BI по per-tenant ключам, публичная онлайн-запись без авторизации.

Почти все ЛК-роутеры **дублируют один и тот же auth-хелпер `_get_session`/`_get_session_token`** (скопирован построчно в 6 файлах) — это главный кандидат на вынос в общий модуль. Префиксы берутся из самих роутеров (в `main.py` все подключаются без переопределения prefix).

| Файл | Назначение в 5-7 слов | Строк |
|---|---|---|
| `patient_lab.py` | Список лаб-заявок пациента с результатами | 121 |
| `patient_lab_dynamics.py` | Графики динамики аналитов для ЛК | 263 |
| `patient_loyalty.py` | Программа лояльности пациента (баллы, награды) | 199 |
| `patient_medical_record.py` | Агрегатор электронной медкарты + PDF | 657 |
| `patient_notifications.py` | WebSocket push входящих звонков в ЛК | 190 |
| `patient_spending.py` | Расходник пациента за год + PDF | 100 |
| `patient_subscription.py` | Подписка «Здоровье+»: планы, старт, отмена | 439 |
| `permissions.py` | RBAC-матрица и override прав ролей | 242 |
| `portal.py` | PWA-манифест ЛК пациента (start_url+токен) | 111 |
| `prescriptions.py` | Назначения пациента из МИС + кэш | 122 |
| `presence.py` | Присутствие, WebRTC-звонки, TURN, права | 1023 |
| `profile.py` | Профиль сотрудника + аватарка | 321 |
| `public_aggregator.py` | Лиды от агрегаторов + lab-webhook | 126 |
| `public_api_v1.py` | Публичный REST API v1 для CRM/BI | 328 |
| `public_booking.py` | Публичная онлайн-запись без авторизации | 261 |

---

## `backend/app/routers/patient_lab.py`
- **Назначение:** Отдаёт пациенту список его лабораторных заявок (`LabOrder`) со вложенными результатами (`LabResult`) и именами провайдеров. Только чтение.
- **Ключевые элементы:** `router` (без prefix, tag `patient-lab`); хелперы `_get_session()` (мульти-источник токена), `_account()` (получить/создать `PatientAccount` по телефону); эндпоинт `list_lab_results`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/patient/lab-results` | patient_session | `limit`(1..200), токен | `{items:[{...order..., results:[...]}]}` | Список анализов пациента |

- **Зависимости:** `models.patient_account.PatientAccount`, `models.patient_session.PatientSession`, `models.lab.{LabOrder,LabResult,LabProvider}`, `services.patient_session_service.restore_session`, `services.family_service`.
- **Где менять для типовых задач:** добавить поле результата в ответ → блок `items.append({...})` (стр. 97-118); фильтр по статусу заявки → `select(LabOrder).where(...)` (стр. 70-74); пагинация уже через `limit`.
- **Подводные камни:** фильтрация идёт по `LabOrder.patient_id == acc.id`, **tenant_id не учитывается** (полагается на то, что заявки и так привязаны к пациенту); `acc` создаётся на лету с `db.commit()` при первом обращении; результаты грузятся одним запросом `IN(order_ids)` — N+1 нет.
- **Строк:** 121

---

## `backend/app/routers/patient_lab_dynamics.py`
- **Назначение:** Считает динамику лабораторных показателей (аналитов) за N месяцев для line-charts (recharts) в ЛК. Парсит числа из строковых `value`, нормализует названия по словарю синонимов, навешивает статус (low/ok/high) и delta_pct.
- **Ключевые элементы:** константа-эталон `ANALYTE_NORMS` (18 аналитов: норма, ед., иконка); `_parse_number()` (вытаскивает float из строки, поддержка `,`); `_normalize_name()` (RU/EN-алиасы → канон. имя); `_get_session_token()`; эндпоинт `get_lab_dynamics`. **Функция `get_lab_dynamics` переиспользуется напрямую из `patient_medical_record.py`.**
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/patient/lab-dynamics` | patient_session | `months`(1..36), `t`/токен | `{months, analytes:[{name,icon,unit,norm_min,norm_max,points,last_value,delta_pct,status,count}], is_demo}` | Графики динамики аналитов |

- **Зависимости:** `services.patient_session_service.restore_session`, `services.family_service`. Данные берёт **сырым SQL** (`text()`) через join `lab_results` ↔ `lab_orders`, а не через ORM-модели.
- **Где менять для типовых задач:** добавить новый показатель → расширить `ANALYTE_NORMS` (стр. 32-51) и `aliases` в `_normalize_name` (стр. 74-112); поменять окно времени → `since = utcnow() - timedelta(days=months*30)` (стр. 158); правила статуса → блок `status` (стр. 236-243).
- **Подводные камни:** demo-заглушка для тест-номера Гудаева **+79280037547** (стр. 191-218) — мёртвые данные, отметить при чистке; весь основной SQL-запрос обёрнут в `try/except Exception: analytes_data={}` (стр. 187-189) — **молча проглатывает любые ошибки БД**, баги схемы будут невидимы; поле `is_demo` в ответе содержит странное выражение `is_demo and not any(True for _ in [])` (стр. 262) — фактически равно `is_demo`, легаси-артефакт; `months*30` — грубая аппроксимация месяца.
- **Строк:** 263

---

## `backend/app/routers/patient_loyalty.py`
- **Назначение:** Эндпоинты программы лояльности для пациента: баланс/тир, история транзакций, каталог наград и оформление награды (claim). Гейтится модулем `loyalty_pro` у тенанта.
- **Ключевые элементы:** prefix `/patient/loyalty`; хелперы `_get_session()`, `_require_module_and_account()` (проверка `tenant_id`, активности модуля → 402, get/create аккаунта); схема `ClaimIn`; эндпоинты `get_account`, `get_transactions`, `get_rewards`, `claim_reward`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/patient/loyalty/account` | patient_session + модуль loyalty_pro | токен | `{points,tier,next_tier,next_tier_at,total_spent,...}` | Баланс и тир |
| GET | `/patient/loyalty/transactions` | то же | `limit`(1..200) | `{items:[{delta,reason,note,...}],total}` | История начислений |
| GET | `/patient/loyalty/rewards` | то же | токен | `{items:[{...,available,unavailable_reason}]}` | Каталог наград |
| POST | `/patient/loyalty/claim` (201) | то же | `{reward_id}` | `{claim_id,status,points_spent,points_balance,tier}` | Оформить награду |

- **Зависимости:** `models.loyalty_ext.{LoyaltyAccountExt,LoyaltyEvent,LoyaltyClaim}`, `models.loyalty.LoyaltyReward`, `services.loyalty_ext_service as ls` (`is_module_active`, `get_or_create_account`, `next_tier_threshold`, `can_claim`, `create_claim`), `services.family_service`, `restore_session`.
- **Где менять для типовых задач:** новые поля карточки награды → блок `items.append` в `get_rewards` (стр. 153-166); логика доступности → `ls.can_claim` (в сервисе, не здесь); списание баллов/создание claim → `ls.create_claim`; пороги тиров → `ls.next_tier_threshold`.
- **Подводные камни:** **402** возвращается если модуль не подключён — фронт обязан отрисовать «Не подключено»; `total_spent` приводится к `float(acc.total_spent or 0)` — money хранится Decimal, при сериализации теряется точность (для отображения ок); `discount_percent` тоже `float(...)`; награды тенант-скоупятся по `LoyaltyReward.tenant_id == tenant_id`, но баланс — по `acc.id`.
- **Строк:** 199

---

## `backend/app/routers/patient_medical_record.py`
- **Назначение:** Самый крупный ЛК-роутер: единый снимок здоровья пациента (профиль, антропометрия, аллергии, диагнозы, назначения, визиты наши+МИС, последние анализы, документы, направления, прививки) + экспорт в PDF через WeasyPrint. Не своя сущность, а unified view над 6+ источниками.
- **Ключевые элементы:** prefix `/patient/medical-record`; `_safe_iso()`, `_phone_variants()` (варианты телефона с/без `+`, 8→+7); эндпоинт `medical_record` (агрегатор); `_render_emr_html()` (огромный inline-HTML/CSS-шаблон A4); эндпоинт `medical_record_pdf`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/patient/medical-record` | patient_session | `t`/токен | JSON `{profile,anthropometry,visits,diagnoses_active,prescriptions_active,allergies,recent_labs,documents,referrals,vaccinations,generated_at}` | Агрегированная медкарта |
| GET | `/patient/medical-record/pdf` | patient_session | `t`/токен | `application/pdf` (attachment) | Скачать медкарту PDF |

- **Зависимости:** `restore_session`; `services.mis_sync_service.{get_patient_from_mis,get_patient_appointments_from_mis}`; `services.settings_service.get_setting` (mis_api_url/key per-tenant); `services.family_service`; `models.patient_account.PatientAccount`; **импортирует `get_lab_dynamics` из `patient_lab_dynamics.py`** (вызывает как функцию для блока анализов, стр. 276-283); сырой SQL по `appointments`, `patient_documents`, `referrals`, `patient_prescription_cache`; `weasyprint.HTML` (lazy import в pdf-эндпоинте).
- **Где менять для типовых задач:** добавить секцию в медкарту → дописать блок сбора данных (нумерованные секции 2-11) + ключ в финальный `return` (стр. 447-460) + соответствующий блок в `_render_emr_html`; поменять вид/стиль PDF → CSS внутри `_render_emr_html` (стр. 563-587); enrichment из МИС → блок `if mis_data` (стр. 149-204); дедуп визитов → стр. 262-271.
- **Подводные камни:** **каждый блок-источник обёрнут в `try/except: pass`** — данные молча теряются при ошибке; demo-заглушки для номера Гудаева **+79280037547** (аллергии/диагнозы/назначения/прививки, стр. 414-445) — мёртвые тест-данные; PDF-эндпоинт вызывает `medical_record(...)` напрямую и есть ветка `if hasattr(data,'body'): json.loads(data.body)` (стр. 636-638) — защита на случай если FastAPI вернёт Response, легаси; `_phone_variants` критичен для матчинга (телефоны в разных таблицах хранятся в разных форматах — `+7`/`7`/`8`); сырые SQL-строки с `ANY(:phones)` — Postgres-специфично.
- **Строк:** 657

---

## `backend/app/routers/patient_notifications.py`
- **Назначение:** Отдельный WebSocket-канал realtime push в ЛК пациента — входящие видеозвонки (Zoom-подобные). НЕ сигналинг и НЕ media-поток (это `presence`/телемед), только событие «тебе звонят».
- **Ключевые элементы:** prefix `/patient/notifications`; in-memory реестр `_patient_connections: dict[phone → list[WebSocket]]`; `_validate_token()` (поддержка ДВУХ форматов: patient_session_token и JWT patient_token); `_register`/`_unregister`; **экспортируемая функция `notify_patient(phone, event)`** (её зовут из телемед-роутера при создании/отмене сессии); WS-эндпоинт `patient_notifications_ws` с heartbeat.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| WS | `/patient/notifications/ws/{phone}` | токен в `?token=` (session или JWT), phone должен совпасть | `{type:ping}` от клиента | `{type:connected|ping|pong|incoming_call|call_cancelled}` | Realtime push звонков |

- **Зависимости:** `database.AsyncSessionLocal` (свой scope в WS), `restore_session`, `core.security.decode_token` (lazy), `utils.phone.normalize_phone`. Вызывается извне: `POST /telemed/sessions`, `/telemed/sessions/{id}/cancel-incoming`.
- **Где менять для типовых задач:** новый тип push-события → добавить вызов `notify_patient(phone, {type:..., ...})` в нужном месте (телемед/чат); heartbeat-интервал → `asyncio.sleep(30)` (стр. 165); валидация токена → `_validate_token` (стр. 49-74).
- **Подводные камни:** **состояние в памяти процесса** — при нескольких воркерах/инстансах push дойдёт только до того воркера, где висит WS пациента (в отличие от `presence`, который масштабируется через Redis); токен валидируется ДО `ws.accept()` → при провале `close(1008)`; `nginx` режет idle через 60с — отсюда ping каждые 30с; phone сравнивается нормализованным.
- **Строк:** 190

---

## `backend/app/routers/patient_spending.py`
- **Назначение:** «Расходник» пациента за год — сводка трат + PDF-выгрузка. Вся логика расчёта и рендера в сервисе, роутер тонкий.
- **Ключевые элементы:** prefix `/patient/spending-summary`; `_get_session()`; `_validate_year()` (2000..текущий+1 иначе 422); эндпоинты `spending_summary`, `spending_summary_pdf`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/patient/spending-summary` | patient_session | `year`, токен | JSON сводки трат | Расходник за год |
| GET | `/patient/spending-summary/export.pdf` | patient_session | `year`, токен | `application/pdf` (no-store) | PDF расходника |

- **Зависимости:** `services.spending_service.{compute_spending_summary,render_spending_pdf}`, `services.family_service.get_account_by_phone` (для имени в PDF), `restore_session`, `models.patient_session.PatientSession`.
- **Где менять для типовых задач:** логика подсчёта трат → `compute_spending_summary` (сервис); вид PDF → `render_spending_pdf` (сервис); год по умолчанию = текущий, если не передан.
- **Подводные камни:** `compute_spending_summary(db, sess.phone, year, sess.tenant_id)` — фильтрация по tenant_id передаётся, но сама логика в сервисе; PDF отдаётся с `Cache-Control: no-store` (чувствительные финданные); ошибка рендера → 500 с текстом исключения наружу.
- **Строк:** 100

---

## `backend/app/routers/patient_subscription.py`
- **Назначение:** Подписка пациента «Здоровье+»: каталог планов (из БД + override на тенант), детализация привилегий, открытие чат-треда «подробнее о тарифе», старт/отмена/возобновление подписки, привилегии, on-demand генерация ежемесячного расходника. Гейтится модулем `health_plus_module`.
- **Ключевые элементы:** router без prefix (пути полные `/patient/subscription/...`); `_get_session`, `_account`, `_resolve_tenant_from_slug` (по `?slug=`/`X-Tenant-Slug` для публичного лендинга); схемы `StartSubscriptionIn`, `CancelSubscriptionIn`, `InquireDetailsIn`; эндпоинты `list_plans`, `plan_benefits_detail`, `inquire_details`, `get_my_subscription`, `start_subscription`, `cancel_subscription`, `resume_subscription`, `get_benefits`, `generate_supply_now`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/patient/subscription/plans` | публично (slug/header) | `slug`/`X-Tenant-Slug` | `{plans,tenant_id,module_active,module_required}` | Каталог планов |
| GET | `/patient/subscription/plans/{plan_key}/benefits-detail` | публично | `slug` | `{summary,categories_breakdown,full_details_chat_message,...}` | Детализация тарифа |
| POST | `/patient/subscription/inquire-details` | patient_session | `{plan_key}` | `{thread_id,chat_message,summary,...}` | Открыть чат-тред по тарифу |
| GET | `/patient/subscription/my` | patient_session | токен | сериализ. подписка + benefits (404 если нет) | Моя подписка |
| POST | `/patient/subscription/start` (201) | patient_session + модуль | `{plan,trial_days?}` | подписка + `redirect_url` (stub) | Оформить подписку |
| POST | `/patient/subscription/cancel` | patient_session | `{reason?}` | сериализ. подписка | Отменить |
| POST | `/patient/subscription/resume` | patient_session | токен | сериализ. подписка | Возобновить cancelled |
| GET | `/patient/subscription/benefits` | patient_session | токен | `{active,plan,benefits{...}}` | Привилегии текущей |
| POST | `/patient/subscription/supply/generate-now` | patient_session | токен | результат генерации (путь к PDF) | Расходник по подписке |

- **Зависимости:** `services.subscription_service as ss` (`all_plans_db`, `plan_meta_db`, `start_subscription`, `get_active_subscription`, `cancel_subscription`, `resume_subscription`, `serialize_subscription`, `benefits_for_db`); `subscription_benefits_service as sbs`; `subscription_module_service.health_plus_module_active`; `mis_webhook_sender.send_mis_webhook_safe`; `subscription_supply_cron` (lazy); `chat_service`, `manager_notifier` (lazy в inquire_details); модели `PatientSubscription`, `Tenant`, `Clinic`.
- **Где менять для типовых задач:** новый план/override → в БД (`subscription_plans`) + сервис `ss.all_plans_db`; интеграция реальной оплаты → заменить stub `redirect_url` в `start_subscription` (стр. 304); МИС-события подписки → `send_mis_webhook_safe` блоки (стр. 284, 327); правила resume → `ss.resume_subscription`.
- **Подводные камни:** module-gating: `start` → **402** если `health_plus_module` не активен; `list_plans` для тенанта без модуля возвращает пустой `plans` + `module_active:false`; `inquire_details` целиком best-effort (двойной `try/except: pass`) — если упадёт чат/TG, фронту вернётся хотя бы `chat_message`; `price_monthly`/`price` через `float(... or 0)` — Decimal→float; webhooks обёрнуты в `_safe` и не валят основной flow; resume ищет любой cancelled с `expires_at` в будущем.
- **Строк:** 439

---

## `backend/app/routers/permissions.py`
- **Назначение:** RBAC «как данные» (Этап 8): отдаёт список всех action'ов, effective-матрицу прав по ролям тенанта, позволяет переопределять (override) права роли и сбрасывать override к дефолту. super_admin может работать с чужими тенантами.
- **Ключевые элементы:** prefix `/permissions`; схемы `OverridePayload`, `RoleMatrix`, `MatrixResponse`; `_resolve_tenant_id()` (super_admin может указать `tenant_id`, остальные — только свой); эндпоинты `list_actions`, `get_matrix`, `put_override`, `delete_override`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/permissions/actions` | любой авторизованный | — | `list[str]` action'ов | Заголовки таблицы UI |
| GET | `/permissions/matrix` | manager+ (`require_manager`) | `?tenant_id`(SA) | `{actions,roles:[{role,default,overrides,effective}],tenant_id}` | Effective-матрица прав |
| PUT | `/permissions/override` | franchise_owner+ | `{role,permissions,target_tenant_id?}` | `{ok,role,tenant_id,permissions}` | Переопределить права роли |
| DELETE | `/permissions/override/{role}` | franchise_owner+ | `?tenant_id`(SA) | `{ok,role,tenant_id}` | Сбросить override |

- **Зависимости:** `core.deps.{get_current_user,require_manager,require_franchise_owner}`; `core.permissions.{ROLE_PERMISSIONS,EDITABLE_ROLES,get_all_actions,get_default_permissions,get_effective_override,invalidate_rbac_cache}`; модели `User/UserRole`, `permission_override.TenantPermissionOverride`.
- **Где менять для типовых задач:** новый action → в `core.permissions` (не здесь); список редактируемых ролей → `EDITABLE_ROLES`; дефолтные права роли → `get_default_permissions`. Здесь правится только upsert/валидация (стр. 156-205).
- **Подводные камни:** effective считается как `set(default) ± overrides`; **после любого upsert/delete обязателен `invalidate_rbac_cache(tid, role)`** (стр. 205, 240) — иначе старые права залипнут в кэше; super_admin-tenant_id валидируется как UUID (400 при битом); валидация неизвестных action'ов перед записью (стр. 164-170); строгая защита `EDITABLE_ROLES` — нельзя редактировать, напр., super_admin.
- **Строк:** 242

---

## `backend/app/routers/portal.py`
- **Назначение:** Отдаёт `manifest.json` для PWA личного кабинета пациента (`/{slug}/p`). Если в URL передан patient_token (`?t=`), бэкенд на лету создаёт long-lived session и встраивает её токен в `start_url` — критично для iOS Safari (manifest кешируется при первой загрузке).
- **Ключевые элементы:** prefix `/portal`; `_session_from_patient_token()` (валидирует JWT patient/appointment-токен через verify-функции, создаёт session); эндпоинт `portal_manifest` (`include_in_schema=False`).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/portal/manifest.json` | публично | `slug`, `s`(session), `t`(patient_token) | `application/manifest+json` (no-cache) | PWA-манифест ЛК |

- **Зависимости:** `core.security.{decode_patient_token,verify_patient_token,verify_appointment_token}`; `services.patient_session_service.create_session`; модели `Referral`, `doctor.Appointment` (lazy); сырой SQL по `tenants`+`tenant_branding` для имени/цвета (брендинг).
- **Где менять для типовых задач:** поля манифеста (иконки, display, цвета) → словарь `manifest` (стр. 96-106); логика брендинга → SQL-блок (стр. 73-84); поддержка нового типа токена → `_session_from_patient_token` (`ttype` ветки, стр. 35-55).
- **Подводные камни:** при наличии `t` и отсутствии `s` создаётся **новая session с `db.commit()`** прямо в GET манифеста (побочный эффект в read-эндпоинте — by design для iOS); брендинг-SQL в `try/except: pass`; `Cache-Control: no-cache` важен, чтобы свежий токен подхватывался; `theme_color` дефолт `#0097A7`.
- **Строк:** 111

---

## `backend/app/routers/prescriptions.py`
- **Назначение:** Назначения (лекарства) пациента из двух источников: МИС-плагин (если включён) и локальный кэш `PatientPrescriptionCache` (fallback + ручные назначения). Дедуп по `mis_id`.
- **Ключевые элементы:** router без prefix; `_patient_session_or_401()` (упрощённый — только `session_token`/`X-Patient-Session`, без cookie/Bearer!); `_cache_dict()`, `_normalize_mis_prescription()` (привести разнородный МИС-объект к формату); эндпоинт `patient_prescriptions`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/patient/prescriptions` | patient_session | `session_token`/`t`/`X-Patient-Session` | `{items:[...mis+cache],mis_available,count}` | Назначения пациента |

- **Зависимости:** `models.patient_document.PatientPrescriptionCache`, `restore_session`, `utils.phone.normalize_phone`, `plugins.registry.plugin_registry` (lazy, метод `get_patient_prescriptions` — мягкая заглушка в MISPlugin).
- **Где менять для типовых задач:** маппинг полей МИС → `_normalize_mis_prescription` (стр. 58-69); источник кэша/фильтры → `select(PatientPrescriptionCache)` (стр. 102-108); логика дедупа → стр. 113-115.
- **Подводные камни:** **auth-хелпер тут урезанный** — НЕ читает cookie и НЕ парсит `Authorization: Bearer` (в отличие от остальных ЛК-роутеров); кэш фильтруется по `tenant_id` только если `sess.tenant_id` задан (стр. 105-106); вся МИС-ветка в `try/except: pass` → при недоступности МИС тихо отдаётся только кэш; дедуп удаляет из кэша записи с `mis_id`, уже пришедшим от МИС.
- **Строк:** 122

---

## `backend/app/routers/presence.py`
- **Назначение:** Ядро присутствия и звонков сотрудников: WebSocket presence с **Redis Pub/Sub** (масштабирование между инстансами), WebRTC-сигнализация (call_invite/accept/reject/end/ice_candidate), список видимых для звонка пользователей с кросс-тенантной видимостью, матрица прав на звонки, настройки уведомлений, TURN-креды (RFC TURN REST API), проверки доступности модулей.
- **Ключевые элементы:** prefix `/presence`; класс `PresenceManager` (connections в памяти + Redis pub/sub `_listen`, `connect`/`disconnect`/`broadcast_to_tenant`/`send_to_user`/`is_online`/`get_online_set`), singleton `presence_manager`; in-memory `_ACTIVE_CALLS`; `_allow_call()` (same-tenant или одна франшиза + активный `cross_clinic_audio` у обоих); `_save_call_log()`; `_mod_telephony` (Depends на модули телефонии); схемы `UpdatePresenceRequest`, `UpsertCallPermissionRequest`, `UpsertNotificationSettingRequest`; словарь `NOTIFICATION_EVENTS`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/presence/status` | авторизованный | — | `{status,status_text,last_seen_at}` | Мой статус |
| PUT | `/presence/status` | авторизованный | `{status,status_text}` | `{ok,status}` | Обновить статус (+broadcast) |
| GET | `/presence/users` | авторизованный | `?clinic_id` | `{users:[...]}` | Видимые для звонка юзеры |
| WS | `/presence/ws/{user_id}` | JWT `?token=` (sub==user_id) | call_* сообщения | presence/call события | Realtime presence + сигналинг |
| GET | `/presence/call-permissions` | авторизованный | — | `{permissions:[...]}` | Матрица прав звонков |
| POST | `/presence/call-permissions` | manager/SA + модуль телефонии | `{from_role,to_role,...}` | `{ok}` | Upsert права звонка |
| GET | `/presence/notification-settings` | авторизованный | — | `{settings,available_events}` | Настройки уведомлений |
| POST | `/presence/notification-settings` | manager/SA | `{role,events,channels}` | `{ok}` | Upsert настроек |
| GET | `/presence/ice-config` | авторизованный | — | `{iceServers,ttl}` | STUN/TURN для WebRTC |
| GET | `/presence/can-call` | авторизованный | — | `{enabled,audio,video,in_grace,...}` | Доступность звонков тенанта |
| GET | `/presence/can-call-target/{id}` | авторизованный | — | `{allow_audio,allow_video}` | Можно ли звонить юзеру |

- **Зависимости:** `core.deps.get_current_user`, `core.tenant.require_module`, `config.settings` (redis_url, turn_*), модели `presence.{UserPresence,PresenceStatus,CallPermission,NotificationSetting,CallLog}`, `user.{User,UserRole}`, `tenant`, `clinic`, `doctor_clinic_access.DoctorClinicAccess`, `tenant_visibility.TenantVisibility`, `commercial.{TenantModuleSubscription,ModuleStatus}`; `services.call_rules_service.{EXCLUDED_ROLES,check_can_call}`; `redis.asyncio`.
- **Где менять для типовых задач:** правила кросс-тенант звонков → `_allow_call` (стр. 131-155) и `check_can_call` (сервис); видимость юзеров в списке Calls → `get_all_presence` (большой блок tenant_scope/franchise/visibility, стр. 276-455); новые WS-сообщения → ветки `msg_type` в `presence_ws` (стр. 543-756); TURN → `ice_config` (стр. 937-963); список событий уведомлений → `NOTIFICATION_EVENTS` (стр. 852-865); масштабирование → `PresenceManager._listen`.
- **Подводные камни:** `presence_manager.connections` — **в памяти каждого инстанса**, доставка между инстансами идёт ТОЛЬКО через Redis pub/sub (`pch:{tid}`); `_ACTIVE_CALLS` тоже in-memory → при рестарте теряются, CallLog может не финализироваться; cross-tenant guard продублирован в каждой WS-ветке (call_invite/accept/ice) — легко забыть при добавлении нового типа; `_save_call_log` глушит исключения и делает rollback, чтобы не ломать сигналинг; авто-offline если `last_seen_at` старше 5 мин И нет активного WS; франшиза-видимость и `TenantVisibility.allow_calls` накладываются поверх tenant-фильтра; TURN-пароль = HMAC-SHA1 от `turn_secret` с TTL.
- **Строк:** 1023

---

## `backend/app/routers/profile.py`
- **Назначение:** Личный кабинет сотрудника (не пациента): чтение профиля, правка телефона/email/пароля и управление аватаркой (загрузка с ресайзом через Pillow, удаление, публичная отдача файла). Меняет только разрешённые поля.
- **Ключевые элементы:** prefix `/profile`; константы `AVATAR_DIR=/app/uploads/avatars`, `_ALLOWED_AVATAR_TYPES`, лимиты 5МБ/512px; регулярки `_PHONE_RE`, `_EMAIL_RE`; схемы `ProfileResponse`, `ProfileUpdate` (валидаторы телефона/email); `_find_existing_avatar()`, `_serialize_profile()`; эндпоинты `get_my_profile`, `update_my_profile`, `upload_my_avatar`, `delete_my_avatar`, `serve_avatar`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/profile/me` | авторизованный | — | профиль (+`password_must_change`) | Мой профиль |
| PATCH | `/profile/me` | авторизованный | `{phone_number?,email?,current_password?,new_password?}` | профиль | Правка телефон/email/пароль |
| POST | `/profile/me/avatar` | авторизованный | multipart `file` | `{avatar_url}` | Загрузить аватар |
| DELETE | `/profile/me/avatar` | авторизованный | — | `{ok}` | Удалить аватар |
| GET | `/profile/uploads/avatars/{filename}` | публично (без auth) | — | `FileResponse` | Отдача файла аватара |

- **Зависимости:** `core.deps.get_current_user`, `core.security.{hash_password,verify_password}`, модели `User`, `Clinic`, `PIL.Image` (lazy). Аудит смены пароля — через SQLAlchemy-listener `user_audit_listeners.password_changed` (срабатывает на присвоение `password_hash`).
- **Где менять для типовых задач:** список редактируемых полей → `ProfileUpdate` + блоки в `update_my_profile` (запрещённые поля менять нельзя — только manager/staff endpoints); правила пароля → стр. 171-192; форматы/размер аватара → константы + блок Pillow (стр. 244-263); путь хранения → `AVATAR_DIR`.
- **Подводные камни:** `password_must_change` (pwdmust01) снимается в FALSE при PATCH с непустым new_password (стр. 192); смена пароля требует ОБА поля (current+new); уникальность email мягкая (не unique-индекс, ручная проверка против активных юзеров того же контекста); `serve_avatar` без auth, но защищён от path-traversal (`/`,`..`,`\`) и сложностью UUID; `avatar_url` содержит `?v=timestamp` для cache-busting; URL включает префикс `/profile/` (важно для nginx-проксирования).
- **Строк:** 321

---

## `backend/app/routers/public_aggregator.py`
- **Назначение:** Публичный приём лидов от агрегаторов (DocDoc, ProDoctorov) по plaintext-ключу `X-Agg-API-Key` + webhook приёма результатов от лабораторных провайдеров.
- **Ключевые элементы:** router без prefix (tag `public-aggregator`); схема `AggregatorLeadIn`; эндпоинты `submit_aggregator_lead`, `lab_results_webhook`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| POST | `/public/aggregator/leads` (201) | `X-Agg-API-Key` | `{partner_name,patient_phone,...}` | `{ok,lead_id,status,received_at}` | Принять лид агрегатора |
| POST | `/webhooks/lab-results/{provider_type}` | без auth (по external_order_id) | raw JSON результатов | `{ok,order_id,status,inserted_results}` | Webhook результатов лаборатории |

- **Зависимости:** `models.aggregator.{AggregatorPartnership,AggregatorLead}`, `models.lab.{LabOrder,LabProvider}`, `services.aggregator_service.find_active_partnership` (хэширует ключ), `services.lab_service.{normalize_webhook_payload,apply_webhook_results}`.
- **Где менять для типовых задач:** поля лида → `AggregatorLeadIn` + создание `AggregatorLead` (стр. 55-63); нормализация webhook конкретного провайдера → `lab_service.normalize_webhook_payload`; матчинг заявки → join по `external_order_id`+`provider_type` (стр. 107-114).
- **Подводные камни:** ключ агрегатора — **plaintext в заголовке**, сравнивается по хэшу в сервисе; lab-webhook **без явной аутентификации** — полагается на знание `external_order_id` + `provider_type` (заявка должна заранее существовать, иначе 404); `partner_name` из payload может расходиться с partnership — не блокер; tenant_id у лида не выставляется явно (привязка через `partnership_id`→`clinic_id`).
- **Строк:** 126

---

## `backend/app/routers/public_api_v1.py`
- **Назначение:** Публичный REST API v1 для внешних интеграций (CRM/BI). Per-tenant API-ключи, scope-проверки, строгая tenant-изоляция, аудит каждого вызова (`api.request`).
- **Ключевые элементы:** prefix `/api/v1`; `_log_api_request()` (аудит); `_referral_out()`, `_appointment_out()` (сериализаторы); эндпоинты `list_referrals`, `get_referral`, `search_patients`, `list_appointments`, `finance_summary`, `whoami`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/api/v1/referrals` | scope `read:referrals` | status/phone/date_from/to/limit/offset | `{items,limit,offset}` | Список направлений |
| GET | `/api/v1/referrals/{id}` | scope `read:referrals` | — | referral (404) | Одно направление |
| GET | `/api/v1/patients` | scope `read:patients` | `phone`(min3) | `{items:[{phone,name,...}]}` | Поиск пациентов |
| GET | `/api/v1/appointments` | scope `read:appointments` | status/phone/clinic/doctor/date/limit/offset | `{items,limit,offset}` | Список записей |
| GET | `/api/v1/finance/summary` | scope `read:finance` | date_from/to | `{billing:{...},counts:{...}}` | Финсводка тенанта |
| GET | `/api/v1/whoami` | любой валидный ключ | — | `{tenant_id,key_prefix,scopes,...}` | Проверка ключа |

- **Зависимости:** `core.api_key_deps.{verify_tenant_api_key,require_scope}`, модели `tenant_api_key.TenantApiKey`, `referral.{Referral,ReferralStatus}`, `doctor.Appointment`, `patient_account.PatientAccount`, `billing_ledger.BillingLedger`, `services.audit_service.write_safe`.
- **Где менять для типовых задач:** новый endpoint API → добавить с `Depends(require_scope("..."))` + `_log_api_request` + `await db.commit()`; новые поля в выгрузке → `_referral_out`/`_appointment_out`; новый scope → в `core.api_key_deps`.
- **Подводные камни:** **`patient_accounts` НЕ имеет `tenant_id`** — изоляция пациентов строится косвенно через телефоны из referrals/appointments тенанта (стр. 149-198), потенциальная утечка имени пациента, если телефон совпал; во всех эндпоинтах `await db.commit()` нужен из-за аудит-записи (без него аудит не сохранится); деньги через `float(...)` (Decimal→float) в `_appointment_out` и `finance_summary` — для отображения ок, для сверки точности нет; `sum_payment` отдаётся как `abs(...)`; даты-границы через `datetime.combine(...+1 day)` для включения `date_to`.
- **Строк:** 328

---

## `backend/app/routers/public_booking.py`
- **Назначение:** Публичная онлайн-запись пациента к врачу без авторизации: список врачей с расписанием, свободные слоты на дату, доступность в диапазоне дат, создание записи (с rate-limit, honeypot, генерацией кода и QR).
- **Ключевые элементы:** prefix `/public`; rate-limit `_book_rl` (10 попыток/10мин/IP); `_get_tenant()` (по slug, 404 если неактивен); `_gen_apt_code()` (уникальный 5-значный код); схема `BookRequest` (с honeypot-полем `website_url`); эндпоинты `public_list_doctors`, `public_get_slots`, `public_get_availability`, `public_book`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/public/{slug}/doctors` | публично | — | `[{id,full_name,specialty,...}]` | Врачи с расписанием |
| GET | `/public/{slug}/doctors/{id}/slots` | публично | `date`(YYYY-MM-DD) | слоты дня | Свободные слоты на дату |
| GET | `/public/{slug}/doctors/{id}/availability` | публично | `from`/`to` | `{has_any_schedule,days:[{date,free_slots,has_schedule}]}` | Доступность за диапазон |
| POST | `/public/{slug}/book` | публично + rate-limit + honeypot | `BookRequest` | `{id,short_code,qr_code,patient_token,cabinet_url,...}` | Создать запись |

- **Зависимости:** `models.tenant.Tenant`, `models.clinic.Clinic`, `models.doctor.{Doctor,DoctorSchedule,Appointment,AppointmentStatus}`, `services.scheduling_service.{get_available_slots,book_slot}`, `services.qr_service.generate_qr_image_base64`, `core.security.make_appointment_token`, `utils.phone.normalize_phone`, `utils.rate_limit.{rate_limit_dep,check_honeypot}`.
- **Где менять для типовых задач:** поля формы записи → `BookRequest` + ответ `public_book` (стр. 248-260); параметры rate-limit → `_book_rl` (стр. 27-30); горизонт доступности (по умолч. 14, макс 60 дней) → `public_get_availability` (стр. 154, 163-164); конфликты/бронирование → `book_slot` (сервис); фильтр «показываем только врачей с расписанием» → `has_schedule` (стр. 67-82).
- **Подводные камни:** **tenant-изоляция везде через slug** — врач проверяется `Clinic.tenant_id == tenant.id` в каждом эндпоинте (стр. 115-118, 143-146, 210-218); нельзя записаться на прошедшую дату (400); honeypot-поле `website_url` (TODO: заменить на hCaptcha/Turnstile, стр. 198); `_gen_apt_code` до 20 попыток → 500 при коллизии; после брони выдаётся `patient_token` (JWT) и `cabinet_url` для входа в ЛК; rate-limit per-IP применяется только на POST `/book`.
- **Строк:** 261
