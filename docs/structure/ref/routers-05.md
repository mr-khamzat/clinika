# routers [05] — лаборатория врача, документы пациента, external-doctor, 54-ФЗ и кабинет владельца франшизы

Этот срез из 15 роутеров покрывает четыре функциональные зоны бэкенда clinika:

1. **Доктор**: лабораторные заявки (`doctor_lab.py`) и доступ к документам пациента (`doctor_patient_documents.py`).
2. **External-doctor** (приходящий/партнёрский врач): прямые счета пациентам + личная статистика (`external_doctor.py`).
3. **Фискалка 54-ФЗ**: чеки, QR и конфиг ОФД (`fiscal_receipts.py`).
4. **Кабинет владельца франшизы (`franchise_owner`)** — крупнейший блок: 10 роутеров для аналитики, финансов (P&L, выручка с бонусов), управления тенантами/клиниками/руководителями, распределения коммерческих модулей и gap-анализа. Все они под ролью `franchise_owner` / `super_admin`.

Все роутеры подключаются в `main.py` через `app.include_router(...)` **без дополнительного `prefix=`** — путь полностью задаётся `APIRouter(prefix=...)` внутри файла. Общий паттерн доступа во франшиза-блоке: локальный хелпер `_require_franchise_owner` / `_require_role` + `_get_my_franchise` / `_resolve_tenant_id`, которые **дублируются почти в каждом файле** (см. «Подводные камни»). Tenant-изоляция строится на `Tenant.franchise_id == моя_франшиза.id`.

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `doctor_lab.py` | Лабораторные заявки врача (фейк-провайдер) | 213 |
| `doctor_patient_documents.py` | Доступ врача к документам пациента | 69 |
| `external_doctor.py` | Прямые счета и статистика external-врача | 533 |
| `fiscal_receipts.py` | Чеки 54-ФЗ, QR, конфиг ОФД | 212 |
| `franchise_analytics.py` | Cohort/KPI/рекомендации + bulk план/модули | 420 |
| `franchise_analytics_ext.py` | Рейтинг клиник + матрица переливов (raw SQL) | 344 |
| `franchise_finance.py` | Консолидированный P&L сети (raw SQL) | 321 |
| `franchise_module_gaps.py` | Gap-анализ модулей по тенантам (MRR) | 151 |
| `franchise_module_gaps_by_clinic.py` | Gap-анализ модулей по клиникам (через сервис) | 127 |
| `franchise_modules.py` | Каталог/гранты/акты распределения модулей | 407 |
| `franchise_owner.py` | Кабинет: тенанты, биллинг, рекрутеры, финансы | 557 |
| `franchise_owner_clinics.py` | Клиники сети + руководители + пароли | 600 |
| `franchise_pnl.py` | P&L кабинета (summary/by-month/by-clinic) | 158 |
| `franchise_referral.py` | Матрица/summary/top переливов (через сервис) | 127 |
| `franchise_revenue.py` | Доход франшизы с fee за бонусы клиник | 208 |

---

## `backend/app/routers/doctor_lab.py`

- **Назначение:** Эндпоинты врача для работы с лабораторными заявками. Врач создаёт заявку для пациента → она автоматически «отправляется» в лабораторию (фейк-имплементация: статус `sent`, через 30 сек фоном → `in_progress`), результаты приходят отдельным webhook (не в этом файле).
- **Ключевые элементы:** `router` (`prefix=/doctor/lab-orders`); константа-зависимость `_REQUIRE_DOCTOR` (роли DOCTOR, LAB_CT, LAB_XRAY, MANAGER, FRANCHISE_OWNER, SUPER_ADMIN); схема `LabOrderIn`; хелперы сериализации `_serialize_order`, `_serialize_result`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| POST | `/doctor/lab-orders` | `_REQUIRE_DOCTOR` | `LabOrderIn` | dict заявки | Создать заявку + фейк-отправка провайдеру |
| GET | `/doctor/lab-orders` | `_REQUIRE_DOCTOR` | query `patient_id`, `status`, `limit` | `{items:[...]}` | Список заявок тенанта |
| GET | `/doctor/lab-orders/{order_id}` | `_REQUIRE_DOCTOR` | path id | заявка + results | Одна заявка с результатами |
| GET | `/doctor/lab-orders/{order_id}/results` | `_REQUIRE_DOCTOR` | path id | `{order_id,status,results}` | Только результаты |
| POST | `/doctor/lab-orders/{order_id}/cancel` | `_REQUIRE_DOCTOR` | path id | `{ok,id,status}` | Отменить (если не delivered/cancelled) |

- **Зависимости:** `app.models.lab` (`LabProvider`, `LabOrder`, `LabResult`); `app.services.lab_service.send_order_to_provider`; `app.models.doctor.Doctor` (lazy-import для резолва `doctor_id`); `app.database.AsyncSessionLocal` (передаётся в сервис для фоновой задачи); `app.core.deps.get_current_user`/`require_role`.
- **Где менять для типовых задач:** новые поля заявки — `LabOrderIn` + `_serialize_order` + модель `LabOrder`; смена логики автоотправки / таймера 30 сек — в `lab_service.send_order_to_provider` (не здесь); новый статус-переход — `cancel_order` и эндпоинты статуса; роли доступа — константа `_REQUIRE_DOCTOR`.
- **Подводные камни:** дублирование зависимостей — в сигнатурах одновременно `user: User = _REQUIRE_DOCTOR` и `current_user: User = Depends(get_current_user)` (фактически используется `current_user`, `user` нужен только ради проверки роли). `create_order` делает `db.flush()` → `send_order_to_provider` → `db.commit()`: фоновая задача получает свою сессию через `AsyncSessionLocal`, поэтому коммит основной транзакции обязателен. Tenant-фильтрация ручная (`o.tenant_id != current_user.tenant_id`) — в `get_order`/`cancel` сначала тянут по id, потом сверяют тенант (а не фильтруют в запросе). Резолв `doctor_id` обёрнут в `try/except: pass` — заявка создастся даже без doctor-записи.
- **Строк:** 213

## `backend/app/routers/doctor_patient_documents.py`

- **Назначение:** Доступ врача (и админ-ролей) к документам пациента с учётом visibility-настроек, заданных пациентом. Только просмотр списка и скачивание файла.
- **Ключевые элементы:** `router` (`prefix=/doctor`); множество `CLINIC_DOC_ROLES`; хелпер `_ensure_doctor_role`; два эндпоинта.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/doctor/patients/{patient_id}/documents` | `CLINIC_DOC_ROLES` | path patient_id | `{documents:[...]}` | Список видимых врачу документов |
| GET | `/doctor/patient-documents/{doc_id}/download` | `CLINIC_DOC_ROLES` | path doc_id | `FileResponse` | Скачать файл документа |

- **Зависимости:** `app.services.document_service` (`list_documents_for_doctor`, `get_document`, `serialize_document`); `fastapi.responses.FileResponse`; `pathlib.Path` для проверки файла на диске.
- **Где менять для типовых задач:** список ролей с доступом — `CLINIC_DOC_ROLES`; правила видимости (что именно видит врач) — преимущественно в `document_service.list_documents_for_doctor`, частично в проверке `doc.visibility` в download; формат отдачи файла (inline vs attachment) — заголовки в `FileResponse`.
- **Подводные камни:** **легаси/недоделанная логика** — в `download_patient_document` ветка `if doc.visibility == "tenant_admins" and role_val == "doctor"` содержит `pass` и комментарий «упростим», то есть врач по факту МОЖЕТ скачать `tenant_admins`-only документ. Это потенциальная privacy-дыра — при ужесточении правил править здесь. Проверка тенанта здесь НЕ делается явно (полагается на `document_service`). Роль читается через `user.role.value if hasattr(...)` — паттерн enum-or-str, встречается во всём срезе.
- **Строк:** 69

## `backend/app/routers/external_doctor.py`

- **Назначение:** Кабинет приходящего/партнёрского врача (`visiting_doctor`/`partner_doctor`): выставление прямых счетов пациентам (Direct Bill), смена статуса, PDF-печать счёта через WeasyPrint и личная статистика заработка.
- **Ключевые элементы:** `router` (`prefix=/external-doctor`); зависимость `_dep_ext` = `require_role("visiting_doctor","partner_doctor","super_admin")`; схемы `ServiceLine`, `DirectBillCreate`, `DirectBillStatusUpdate`; хелперы `_to_dec`, `_bill_to_dict`, `_calc_totals` (Decimal), `_get_bill_or_404`, `_gen_bill_number`; PDF-хелперы `_esc`, `_fmt_money`, `_bill_html`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| POST | `/external-doctor/direct-bill` | `_dep_ext` | `DirectBillCreate` | dict счёта | Создать прямой счёт (status=draft) |
| GET | `/external-doctor/direct-bills` | `_dep_ext` | query status/period_from/period_to/limit | `[dict]` | Список своих счетов |
| GET | `/external-doctor/direct-bills/{bill_id}` | `_dep_ext` | path id | dict счёта | Один счёт |
| PATCH | `/external-doctor/direct-bills/{bill_id}/status` | `_dep_ext` | `DirectBillStatusUpdate` | dict счёта | Сменить статус (фиксирует sent/paid/cancelled_at) |
| GET | `/external-doctor/direct-bills/{bill_id}/print` | `_dep_ext` | query `inline` | `application/pdf` | PDF счёта (WeasyPrint) |
| GET | `/external-doctor/my-stats` | `_dep_ext` | query period_from/period_to | dict KPI | Заработок, ср. чек, приёмы, топ клиник |

- **Зависимости:** `app.models.doctor_ai` (`DirectBill`, `DirectBillStatus`, `DirectBillPaymentMethod`); `app.models.doctor` (`Appointment`, `Doctor`); `app.models.clinic.Clinic`; `app.models.user.User`; `weasyprint.HTML` (lazy-import в print); `app.core.deps.require_role`.
- **Где менять для типовых задач:** расчёт сумм/скидки — `_calc_totals`; формат и вид PDF — `_bill_html` (inline CSS, `@page A4`); нумерация счетов — `_gen_bill_number` (счётчик `DB-{year}-{NNNNN}` в рамках тенанта/года); новые статусы и их таймстемпы — `change_direct_bill_status`; метрики кабинета — `my_stats`; проверка владения счётом — `_get_bill_or_404`.
- **Подводные камни:** **Decimal vs float** — суммы считаются в `Decimal` (`_calc_totals`, `quantize(0.01)`), но в `_bill_to_dict` отдаются как `float(...)`. Нумерация `_gen_bill_number` основана на `func.count()` за год → **гонка/дубликаты** при параллельном создании счетов (нет блокировки). Связка приёмов в `my_stats` идёт `Appointment.doctor_id → Doctor.id`, при этом `DirectBill.doctor_id == user.id` (т.е. user, а не Doctor) — две разные модели врача, легко перепутать. PDF падает 500 если weasyprint недоступен (lazy-import в `try/except`). `_get_bill_or_404` сверяет тенант только если оба `tenant_id` заданы.
- **Строк:** 533

## `backend/app/routers/fiscal_receipts.py`

- **Назначение:** Endpoints 54-ФЗ модуля `fiscal_54fz_pro`: список фискальных чеков клиники, QR одного чека, принудительный pull из ОФД и CRUD-конфиг ОФД (с шифрованием api_key).
- **Ключевые элементы:** `router` (**без prefix**, пути абсолютные); module-gate `_fis_module = Depends(require_module("fiscal_54fz_pro"))`; схема `OFDConfigBody`; сериализаторы `_serialize_receipt`, `_serialize_ofd_config`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/clinics/{clinic_id}/receipts` | `require_manager` + module-gate | query `from`/`to`/`limit` | `[receipt]` | Список чеков клиники |
| GET | `/receipts/{receipt_id}/qr` | module-gate | path id | `{id,qr_code}` | QR-ссылка проверки чека |
| POST | `/clinics/{clinic_id}/ofd/pull` | `require_manager` + module-gate | path clinic_id | результат pull | Принудительный pull из ОФД |
| GET | `/clinics/{clinic_id}/ofd-config` | `require_manager` | path clinic_id | `{config,available_providers}` | Текущий конфиг ОФД (без module-gate!) |
| PUT | `/clinics/{clinic_id}/ofd-config` | `require_manager` + module-gate | `OFDConfigBody` | config | Upsert конфига ОФД |

- **Зависимости:** `app.models.payments_clinic` (`FiscalReceipt`, `OFDConfig`); `app.services.fiscal.list_registered` (доступные провайдеры); `app.services.fiscal_service.pull_clinic_receipts`; `app.services.encryption_service.encrypt` (lazy-import для api_key); `app.core.tenant` (`get_current_tenant`, `require_module`); `app.core.deps.require_manager`.
- **Где менять для типовых задач:** новые поля чека — `_serialize_receipt` + модель `FiscalReceipt`; логика pull — `fiscal_service.pull_clinic_receipts`; список/реализация ОФД-провайдеров — `app.services.fiscal` (реестр) + `fiscal_service`; шифрование ключа — `encryption_service`; валидация конфига — `OFDConfigBody` + `upsert_ofd_config`.
- **Подводные камни:** `get_current_tenant` может вернуть `None` → разные ветки: `list_receipts` отдаёт `[]`, `get_ofd_config` отдаёт `config=None`, а pull/put бросают 403. **Несогласованность гейтов:** `GET /ofd-config` НЕ закрыт module-gate (`_fis_module`), а PUT/pull/receipts — закрыты; намеренно, чтобы UI показывал «провайдеры есть, модуль не подключён». `pull` ловит `LookupError`→400 и `NotImplementedError`→501 (провайдер-заглушка). `api_key` хранится только зашифрованным (`api_key_encrypted`), наружу отдаётся только флаг `api_key_present`. tenant-проверка чека: `r.tenant_id != tenant.id`.
- **Строк:** 212

## `backend/app/routers/franchise_analytics.py`

- **Назначение:** Премиум-аналитика франшизы для `franchise_owner`/`super_admin`: cohort-анализ клиник, KPI-дашборд, мульти-тенант рекомендации, а также bulk-редактор планов/модулей сразу по нескольким тенантам (транзакционно + аудит + сброс кеша).
- **Ключевые элементы:** `router` (без prefix; пути `/admin/...`); хелперы `_resolve_franchise_id`, `_require_franchise_role`; схемы `BulkUpdateItem`, `BulkUpdateRequest`; маппинг `_PLAN_ALIASES` (`starter→basic`, `pro→professional`).
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/admin/analytics/cohort-clinics` | owner/super | query metric/period/franchise_id | cohort dict | Cohort-анализ клиник |
| GET | `/admin/analytics/franchise-kpi` | owner/super | query range/franchise_id | kpi dict | KPI-дашборд (7d/30d/90d/365d) |
| GET | `/admin/analytics/recommendations` | owner/super | query franchise_id | `{items,count,...}` | Рекомендации по сети |
| GET | `/admin/franchise/tenants-pricing` | owner/super | query franchise_id | `{tenants,modules_catalog}` | Данные для bulk-редактора |
| POST | `/admin/franchise/bulk-update-plans` | owner/super | `BulkUpdateRequest` | `{items,updated_count}` | Транзакционно сменить план/модули |

- **Зависимости:** services — `cohort_service` (`ALLOWED_METRICS`, `get_cohort`), `kpi_service` (`RANGES_DAYS`, `get_kpi`), `recommendations_service.generate_recommendations`, `audit_service.write`; models — `billing` (`Subscription`, `SubStatus`), `commercial` (`CommercialModule`, `ModuleStatus`, `TenantModuleSubscription`), `Franchise`, `Tenant`; `redis.asyncio` + `app.config.settings` (сброс кеша `kpi/cohort/recommendations`).
- **Где менять для типовых задач:** новая метрика cohort — `ALLOWED_METRICS` в `cohort_service` + regex в `cohort_clinics`; новый диапазон KPI — `RANGES_DAYS` + regex в `franchise_kpi`; правила резолва франшизы (owner vs super_admin) — `_resolve_franchise_id`; новые планы в bulk — `_PLAN_ALIASES` + `pattern` в `BulkUpdateItem`; ключи кеша для инвалидации — список `("kpi","cohort","recommendations")`.
- **Подводные камни:** `bulk_update_plans` — единственная в файле write-операция: обёрнута в общий `try/except` с `db.rollback()`, отдельно ловит `HTTPException` и `Exception`→500; пишет аудит на каждый тенант. Незнакомые `module_key` молча пропускаются (`continue`). Сброс Redis-кеша в `try/except` (warning при ошибке) — не валит запрос. `_resolve_franchise_id` для `super_admin` без `franchise_id` берёт ПЕРВУЮ активную франшизу по имени — может выбрать не ту. Для owner с переданным чужим `franchise_id` → 403.
- **Строк:** 420

## `backend/app/routers/franchise_analytics_ext.py`

- **Назначение:** Расширение аналитики (ФИЧИ 2+3): сводный рейтинг клиник сети по 8 KPI и матрица перелива пациентов между клиниками. Данные собираются через **raw SQL** (`text()`), чтобы быть устойчивым к отсутствию ORM-моделей/таблиц.
- **Ключевые элементы:** `router` (`prefix=/franchise-owner/analytics`); хелперы `_require_franchise_owner`, `_get_my_franchise`, `_period_to_range` (last_7d/30d/90d/all), `_ym_period_to_range` (YYYY-MM).
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/franchise-owner/analytics/clinic-ranking` | owner/super | query period | `{period,rows,sources}` | Рейтинг клиник по 8 KPI |
| GET | `/franchise-owner/analytics/referral-matrix` | owner/super | query period=YYYY-MM | `{clinics,matrix}` | Матрица переливов (inter_clinic_invoices) |

- **Зависимости:** только models `Franchise`, `Tenant`, `Clinic`, `User` + raw SQL к таблицам `clinic_payments`, `users`, `appointments`, `referrals`, `inter_clinic_invoices` (без ORM-моделей этих таблиц). Сервисов нет.
- **Где менять для типовых задач:** добавить KPI-колонку — соответствующий SQL-блок (revenue / doctors_count / appointments / referrals / retention) + сборка `rows`; формулы (avg_check, conversion, no_show_rate, retention 30/90) — секция «Сборка строк»; источник матрицы переливов — SQL в `referral_matrix` (issuer_clinic_id → recipient_clinic_id); период — `_period_to_range` / `_ym_period_to_range`.
- **Подводные камни:** **каждый SQL-блок обёрнут в `try/except: pass`** — при ошибке/отсутствии таблицы метрика тихо остаётся нулём (нет ошибки, но и нет диагностики). NPS всегда `null` (нет таблицы опросов, помечен `sources.nps=missing`). conversion искусственно режется до 100% если `>100`. retention считается по `patient_phone` (а не patient_id) и игнорирует переданный период — берёт фиксированное окно 30/90 дней от `utcnow()`. `clinic_payments.status` матчится по широкому списку (`paid/success/succeeded/completed`). Дубль `_require_franchise_owner`/`_get_my_franchise` с другими файлами.
- **Строк:** 344

## `backend/app/routers/franchise_finance.py`

- **Назначение:** ФИЧА 1 — консолидированный P&L по всей сети франшизы за месяц: выручка (cash/card/online), себестоимость (salary/supplies/rent/other), валовая маржа, налоги (УСН 6%), чистая прибыль. Помечает источники данных как ok/empty/missing для yellow-banner в UI.
- **Ключевые элементы:** `router` (`prefix=/franchise-owner/finance`); хелперы `_require_franchise_owner`, `_get_my_franchise`, `_parse_period` (YYYY-MM), `_table_exists` (через `to_regclass`), `_empty_row_totals`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/franchise-owner/finance/pnl` | owner/super | query period=YYYY-MM, group_by=clinic\|tenant | `{rows,totals,sources}` | Консолидированный P&L сети |

- **Зависимости:** models `Franchise`, `Tenant`, `Clinic`, `User` + raw SQL к `clinic_payments` и `spendings`. Сервисов нет (расчёт инлайн на Decimal).
- **Где менять для типовых задач:** ставка налога — `TAX_RATE = Decimal("0.06")` (захардкожена); классификация выручки по gateway (cash/card/online) — блок разбора `gw`; категории себестоимости (salary/supplies/rent/other) — блок разбора `cat` и `cogs_src_status`; формулы gross/net/маржа% — секция «Сборка строк»; пустые ответы при отсутствии тенантов/клиник — `_empty_row_totals`.
- **Подводные камни:** **корректно использует Decimal** для всех денег и `quantize(0.01)`, наружу конвертирует во float только в финальном dict — образец для подражания в этом блоке. `group_by` принимает `clinic|tenant`, но фактически всегда группирует по клинике (значение `tenant` не обрабатывается отдельно — потенциальная недоделка). Оба SQL-блока в `try/except` → при отсутствии таблицы источник = `missing`/`empty` (не падает). Классификация gateway по подстрокам (`"cash" in gw`) — хрупко при нестандартных названиях шлюзов. Налог считается от всей выручки (УСН-доходы), без учёта режима конкретной клиники.
- **Строк:** 321

## `backend/app/routers/franchise_module_gaps.py`

- **Назначение:** ФИЧА 4 — gap-анализ коммерческих модулей, сгруппированный **по модулям**: сколько тенантов уже имеют грант, скольким не хватает, средняя цена и потенциальный MRR (упущенная выручка). Это «старый» ракурс (по модулям).
- **Ключевые элементы:** `router` (`prefix=/franchise-owner/modules`, endpoint `/gaps`); хелперы `_require_franchise_owner`, `_get_my_franchise`; один эндпоинт.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/franchise-owner/modules/gaps` | owner/super | — | `{items,total_tenants,total_modules}` | Gap-анализ по модулям + potential_mrr |

- **Зависимости:** models `Franchise`, `Tenant`, `CommercialModule`, `FranchiseModuleGrant`. Сервисов нет (вся агрегация инлайн).
- **Где менять для типовых задач:** расчёт `avg_price` (по грантам с ценой > 0, fallback на `m.price_monthly`) — внутри цикла по модулям; формула `potential_mrr = missing × avg_price` — там же; сортировка (по `potential_mrr` DESC) — `items.sort(...)`; состав возвращаемых полей модуля — формирование `items.append({...})`.
- **Подводные камни:** **внимание на коллизию префикса** — этот файл и `franchise_modules.py` оба используют `prefix=/franchise-owner/modules`; здесь endpoint `/gaps`, там `/catalog`,`/grants`,`/acts` — конфликта путей нет, но логически это «соседи». Есть отдельный файл `franchise_module_gaps_by_clinic.py` с тем же функционалом в другом ракурсе (по клиникам, `prefix=/franchise-owner/module-gaps`). `avg_price` усредняется по всем грантам ключа (включая неактивные, т.к. `priced` берёт из `key_grants`, а `granted` — только из `active_grants`). Decimal суммируется правильно (`sum(..., Decimal(0))`), затем `float`. Дубль хелперов прав.
- **Строк:** 151

## `backend/app/routers/franchise_module_gaps_by_clinic.py`

- **Назначение:** Тот же gap-анализ, но сгруппированный **по клиникам** сети (другой UX-ракурс): какие модули отсутствуют у каждой клиники, агрегаты с топ-5, плюс заглушка отправки рекомендации клинике. Вся логика вынесена в сервис.
- **Ключевые элементы:** `router` (`prefix=/franchise-owner/module-gaps`, namespace-имя `franchise_module_gaps_v2`); хелперы `_require_role`, `_resolve_tenant_id`; схема `PushRecommendationIn`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/franchise-owner/module-gaps` (и `/`) | owner/super | — | `{items,total}` | Клиники с пропущенными модулями |
| GET | `/franchise-owner/module-gaps/summary` | owner/super | — | агрегаты | Total potential revenue + топ модулей |
| POST | `/franchise-owner/module-gaps/push-recommendation` | owner/super | `PushRecommendationIn` | `{ok,...}` | **Заглушка** отправки рекомендации |

- **Зависимости:** `app.services.franchise_module_gaps_service` (`compute_gaps`, `compute_summary`); models `Franchise`, `Tenant`.
- **Где менять для типовых задач:** логика расчёта пропусков и потенциального дохода — в сервисе `franchise_module_gaps_service` (НЕ в роутере); реализация реальной отправки рекомендации — `push_recommendation` (сейчас `return {ok:True}`, в будущем `notification_service`/push); резолв тенанта — `_resolve_tenant_id`.
- **Подводные камни:** **`push_recommendation` — явная ЗАГЛУШКА** (комментарий в коде), уведомления не отправляются. Префикс `/module-gaps` намеренно отличается от `/modules` соседнего `franchise_module_gaps.py` — при добавлении путей не перепутать ракурсы. `_resolve_tenant_id` отличается от других файлов: возвращает `tenant_id` (а не Franchise) и при отсутствии берёт первый тенант франшизы. `push_recommendation` проверяет, что целевой тенант в той же франшизе (cross-tenant защита).
- **Строк:** 127

## `backend/app/routers/franchise_modules.py`

- **Назначение:** Распределение коммерческих модулей внутри франшизы: каталог модулей, матрица «модуль × тенант» с внутренними ценами/статусом, массовое обновление грантов (с синхронизацией реальных `TenantModuleSubscription`), генерация внутренних актов за период и пометка их оплаченными.
- **Ключевые элементы:** `router` (`prefix=/franchise-owner/modules`); хелперы `_require_franchise_owner`, `_get_my_franchise`; схемы `GrantInput`, `GrantsBulkInput`, `GenerateActsInput`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/franchise-owner/modules/catalog` | owner/super | — | `{franchise,modules}` | Каталог + флаг subscribed_by_franchise |
| GET | `/franchise-owner/modules/grants` | owner/super | — | `{tenants,modules,grants}` | Матрица грантов с ценами |
| PUT | `/franchise-owner/modules/grants` | owner/super | `GrantsBulkInput` | `{updated,activated,deactivated}` | Bulk-upsert грантов + синк подписок |
| POST | `/franchise-owner/modules/generate-acts` | owner/super | `GenerateActsInput` | `{created,updated,period}` | Сгенерировать акты за YYYY-MM |
| GET | `/franchise-owner/modules/acts` | owner/super | query period/status | `{acts,summary}` | Список актов |
| POST | `/franchise-owner/modules/acts/{act_id}/mark-paid` | owner/super | path id | 204 | Пометить акт оплаченным |

- **Зависимости:** models `Franchise`, `Tenant`, `Clinic`, `commercial` (`CommercialModule`, `TenantModuleSubscription`), `franchise_module_grant` (`FranchiseModuleGrant`, `FranchiseInternalAct`); `json` для `breakdown_json`.
- **Где менять для типовых задач:** структура матрицы грантов — `get_grants_matrix`; логика синхронизации грант↔подписка (активация/отключение модуля у тенанта) — цикл в `update_grants_bulk`; формула суммы акта (`SUM(internal_price_rub)` по billable-грантам) и идемпотентность — `generate_acts_for_period`; вычисление `subscribed_by_franchise` (по корневому тенанту) — `get_modules_catalog`.
- **Подводные камни:** **Decimal** — `internal_price_rub` в `GrantInput` валидируется как Decimal (`max_digits=12, decimal_places=2`), суммы актов считаются на Decimal, breakdown сериализуется через `float()`. `update_grants_bulk` правит ДВЕ сущности: `FranchiseModuleGrant` (внутренний учёт) И `TenantModuleSubscription` (реальный доступ к модулю) — рассинхрон даст «оплачено, но не работает». `subscribed_by_franchise` определяется по «корневому» тенанту (минимальный `created_at`) — хрупкая эвристика. Статусы подписок сравниваются со строкой `"active"` (не enum). `generate_acts_for_period` пропускает тенантов с `total<=0` (акт не создаётся). Дубль хелперов прав.
- **Строк:** 407

## `backend/app/routers/franchise_owner.py`

- **Назначение:** Центральный роутер кабинета владельца франшизы: данные франшизы и сетевые KPI, CRUD тенантов внутри франшизы (через общий `onboard_tenant`), биллинг от платформы (summary/invoices/settings), управление рекрутерами, и обзор финансов сети (кто кому должен).
- **Ключевые элементы:** `router` (`prefix=/franchise-owner`); зависимость `require_franchise_owner` (из `core.deps`); хелпер `_get_my_franchise` (строгий — только по `owner_user_id`, иначе 404); схемы `TenantCreateForOwner`, `TenantPatchForOwner`, `FranchiseSettingsIn`, `RecruiterContactsIn`; хелпер `_get_recruiter_in_my_franchise`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/franchise-owner/me` | require_franchise_owner | — | dict + KPI | Моя франшиза + агрегаты (MRR, сотрудники, конверсия) |
| GET | `/franchise-owner/tenants` | require_franchise_owner | — | `[dict]` | Список тенантов франшизы |
| POST | `/franchise-owner/tenants` | require_franchise_owner | `TenantCreateForOwner` | result+franchise_id | Создать тенант (onboard + привязка) |
| GET | `/franchise-owner/tenants/{tenant_id}` | require_franchise_owner | path id | dict + modules | Детали тенанта + коммерческие модули |
| PATCH | `/franchise-owner/tenants/{tenant_id}` | require_franchise_owner | `TenantPatchForOwner` | dict | Редактировать имя/активность |
| GET | `/franchise-owner/billing/summary` | require_franchise_owner | — | summary | Сводка биллинга + pending |
| GET | `/franchise-owner/billing/invoices` | require_franchise_owner | — | `[invoice]` | Счета от платформы |
| PATCH | `/franchise-owner/billing/settings` | require_franchise_owner | `FranchiseSettingsIn` | 403 | Заглушка — только super_admin меняет тариф |
| PATCH | `/franchise-owner/recruiters/{recruiter_id}` | require_franchise_owner | `RecruiterContactsIn` | dict | Изменить контакты рекрутера |
| DELETE | `/franchise-owner/recruiters/{recruiter_id}` | require_franchise_owner | path id | `{deleted,soft_deleted}` | Удалить рекрутера (soft если есть бонусы) |
| GET | `/franchise-owner/finance/network-overview` | require_franchise_owner | — | `{platform_dues,matrix}` | Финансы сети: долги + матрица |
| POST | `/franchise-owner/finance/trigger-billing` | require_franchise_owner | — | `{created,invoice_id,...}` | Ручной триггер FranchiseInvoice |

- **Зависимости:** services — `tenant_onboarding_service.onboard_tenant`, `franchise_billing_service` (`get_pending_total`, `list_invoices_for_franchise`, `generate_invoice_for_franchise`); models — `Franchise`, `Tenant`/`TenantLicense`/`TenantBranding`, `billing` (`Subscription`, `SubStatus`), `recruiter_bonus.RecruiterBonus`, `inter_clinic_invoice` (`InterClinicInvoice`, `ICIStatus`), `billing_ledger.BillingLedger`. Использует raw `text()` для агрегатов в `/me`.
- **Где менять для типовых задач:** маппинг UI-планов → внутренние (`trial→basic`, `pro→professional`) — словарь `plan_map` в `create_tenant_in_my_franchise`; KPI на overview (сотрудники, конверсия, рефералы) — `/me`; логика soft vs hard delete рекрутера — `delete_recruiter` (soft если есть `RecruiterBonus`); матрица долгов сети — `network_finance_overview`; ручной биллинг — `trigger_billing_for_my_franchise` (тот же сервис, что cron).
- **Подводные камни:** `_get_my_franchise` здесь **строгий** (только `owner_user_id`, иначе 404) — в отличие от одноимённых хелперов в других файлах, где есть fallback на первую франшизу. **Много lazy-import внутри функций** (services и models импортируются по месту вызова). Создание тенанта: `onboard_tenant` коммитит сам, затем отдельный `db.commit()` для проставления `franchise_id`/`franchise_owner_id`. `delete_recruiter`: hard-delete если бонусов нет, soft — если есть (чтобы не терять историю выплат). `network_finance_overview` использует `__import__("datetime").timedelta` — кривой инлайн-импорт (timedelta уже импортируется в других файлах среза, здесь — нет). Decimal-поля франшизы (`platform_fee_per_bonus` и т.п.) отдаются через float.
- **Строк:** 557

## `backend/app/routers/franchise_owner_clinics.py`

- **Назначение:** Управление клиниками сети из кабинета владельца: реквизиты клиники + контракт (royalty/per_referral/hybrid), и полное управление primary-руководителем (manager) клиники — обновление данных, назначение первого, сброс пароля с опциональным welcome-email. Все мутации пишут аудит.
- **Ключевые элементы:** `router` (`prefix=/franchise-owner`, tag `franchise-owner-clinics`); схемы `ContractFields`, `ClinicPatchIn`, `ManagerPatchIn`, `ManagerCreateIn`, `ResetPasswordIn`; хелперы `_normalize_email` (regex, без EmailStr), `_gen_password` (secrets), `_get_my_franchise`, `_get_tenant_in_my_franchise`, `_get_primary_clinic`, `_get_primary_manager`, сериализаторы `_serialize_manager`, `_serialize_clinic_summary`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/franchise-owner/clinics` | require_franchise_owner | — | `[summary]` | Список клиник сети |
| GET | `/franchise-owner/clinics/{tenant_id}` | require_franchise_owner | path id | summary | Детали одной клиники |
| PATCH | `/franchise-owner/clinics/{tenant_id}` | require_franchise_owner | `ClinicPatchIn` | summary | Реквизиты + контракт (+ аудит) |
| PATCH | `/franchise-owner/clinics/{tenant_id}/manager` | require_franchise_owner | `ManagerPatchIn` | manager dict | Обновить данные руководителя (+ аудит) |
| POST | `/franchise-owner/clinics/{tenant_id}/manager` | require_franchise_owner | `ManagerCreateIn` | manager + password | Назначить первого руководителя |
| POST | `/franchise-owner/clinics/{tenant_id}/manager/reset-password` | require_franchise_owner | `ResetPasswordIn?` | password dict | Сбросить пароль руководителя |

- **Зависимости:** `app.core.security.hash_password`; services — `audit_service.write_safe`, `email_service` (`send_welcome_email_to_manager`, `is_smtp_configured`), `alert_service.notify_password_reset`; models `Franchise`, `Tenant`, `Clinic`, `User`/`UserRole`; `secrets`/`string`/`re`.
- **Где менять для типовых задач:** поля контракта клиники — `ContractFields` + `update_network_clinic` + модель `Clinic`; правила выбора primary-руководителя (сейчас по min `created_at`, флага is_primary нет) — `_get_primary_manager`; генерация/длина пароля — `_gen_password`; текст/логика welcome-email — `email_service`; валидация email — `_normalize_email` (regex `_EMAIL_RE`); карточка клиники — `_serialize_clinic_summary`.
- **Подводные камни:** **КРИТИЧЕСКОЕ ПРАВИЛО (в docstring):** при смене руководителя User НИКОГДА не удаляется/не пересоздаётся — только правятся поля, `user_id` сохраняется (иначе рвутся appointments/referrals/bonuses/audit_log). Пароли отдаются plaintext ровно один раз (`password` + `warning`), `password_must_change=True` форсит смену при первом входе. Email-отправка обёрнута в `try/except` — НЕ должна валить создание manager-а (`email_sent`/`email_error` в ответе). Decimal для royalty/bonus (`Decimal(str(...))`), наружу float. EmailStr намеренно НЕ используется (чтобы не тянуть email-validator) — своя regex. Проверка уникальности username/email — ручная (409/409). PATCH clinic создаёт минимальный `Clinic` если его нет у только что созданного тенанта.
- **Строк:** 600

## `backend/app/routers/franchise_pnl.py`

- **Назначение:** P&L кабинета франшизы — тонкий роутер поверх `franchise_pnl_service`: сводка за период, помесячная история (line-chart), разбивка по клиникам (bar-chart). Период задаётся именем (current_month/last_month/ytd/custom).
- **Ключевые элементы:** `router` (`prefix=/franchise-owner/pnl`); хелперы `_require_role`, `_resolve_tenant_id`, `_resolve_period_safe` (ValueError→400).
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/franchise-owner/pnl/summary` | owner/super | query period/from/to/tax_rate | data + period | KPI P&L за период |
| GET | `/franchise-owner/pnl/by-month` | owner/super | query months/tax_rate | `{by_month,...}` | Помесячная история (1..36 мес) |
| GET | `/franchise-owner/pnl/by-clinic` | owner/super | query period/from/to | `{by_clinic,...}` | Разбивка выручки по клиникам |

- **Зависимости:** `app.services.franchise_pnl_service` (`compute_pnl`, `resolve_period`, `DEFAULT_TAX_RATE`); models `Franchise`, `Tenant` (только для резолва тенанта).
- **Где менять для типовых задач:** все формулы P&L и источники данных — **в сервисе `franchise_pnl_service.py`** (роутер только маршрутизирует); поддерживаемые имена периодов — `resolve_period` в сервисе; ставка налога по умолчанию — `DEFAULT_TAX_RATE`; способ резолва тенанта — `_resolve_tenant_id`.
- **Подводные камни:** `tax_rate` принимается в долях (0.06=6%), конвертируется в `Decimal(str(tax_rate))` перед передачей в сервис — корректная работа с Decimal. `by_month` игнорирует period-параметры и считает окно как `months * 31` дней (грубая оценка месяца). `_resolve_tenant_id` для owner без `tenant_id` берёт первый тенант его франшизы, для super_admin без франшизы — первую франшизу в системе. Дубль `_require_role`/`_resolve_tenant_id` с `franchise_referral.py` (даже `resolve_period` импортируется из того же pnl-сервиса).
- **Строк:** 158

## `backend/app/routers/franchise_referral.py`

- **Назначение:** «Перелив пациентов» (cross-clinic referrals) — аналитический ракурс: матрица направлений, агрегаты с top-5 и топ-N направлений. Тонкий роутер поверх `franchise_referral_service`.
- **Ключевые элементы:** `router` (`prefix=/franchise-owner/referrals`); хелперы `_require_role`, `_resolve_tenant_id`, `_resolve_period_safe`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/franchise-owner/referrals/matrix` | owner/super | query period/from/to | matrix + period | Полная матрица from→to клиник |
| GET | `/franchise-owner/referrals/summary` | owner/super | query period/from/to | summary + period | Агрегаты + top-5 |
| GET | `/franchise-owner/referrals/top` | owner/super | query limit/period/from/to | `{items,...}` | Топ-N направлений |

- **Зависимости:** `app.services.franchise_referral_service` (`compute_matrix`, `compute_summary`, `compute_top`); `app.services.franchise_pnl_service.resolve_period` (переиспользует резолвер периодов из P&L-сервиса); models `Franchise`, `Tenant`.
- **Где менять для типовых задач:** логика расчёта матрицы/агрегатов/топа — **в `franchise_referral_service.py`**; формат периодов — общий `resolve_period` (P&L-сервис); резолв тенанта — `_resolve_tenant_id`.
- **Подводные камни:** **NB из docstring:** префикс `/referrals` намеренно отличается от операционного роутера `referrals_cross.py` (там отправка/приём/завершение направлений) — здесь ТОЛЬКО аналитика, не путать. Полный дубль хелперов `_require_role`/`_resolve_tenant_id`/`_resolve_period_safe` с `franchise_pnl.py`. Вся бизнес-логика в сервисе — роутер почти пустой.
- **Строк:** 127

## `backend/app/routers/franchise_revenue.py`

- **Назначение:** Доход франшизы с роялти за выплаченные бонусы: каждая клиника при выплате бонуса платит франшизе `fee_per_bonus_from_clinic` (по умолчанию 100 ₽). Настройка ставки, дашборд (этот/прошлый месяц/всё время) и детализация по клиникам. Сама запись комиссии создаётся в `bonus_service.mark_bonus_paid` (не здесь).
- **Ключевые элементы:** `router` (`prefix=/franchise-owner/revenue`); хелперы `_require_franchise_owner`, `_get_my_franchise`; схема `RevenueSettingsUpdate`; вложенная функция `count_paid_bonuses` в dashboard.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/franchise-owner/revenue/settings` | owner/super | — | `{fee...,...}` | Текущая ставка fee |
| PUT | `/franchise-owner/revenue/settings` | owner/super | `RevenueSettingsUpdate` | `{fee...}` | Изменить ставку |
| GET | `/franchise-owner/revenue/dashboard` | owner/super | — | `{this_month,last_month,all_time}` | Сводка дохода по месяцам |
| GET | `/franchise-owner/revenue/by-clinic` | owner/super | query period_start/period_end | `{by_clinic,...}` | Детализация по клиникам |

- **Зависимости:** models `Franchise`, `Tenant`, `Clinic`, `bonus` (`Bonus`, `BonusStatus`). Сервисов нет (агрегация инлайн). Связь с `bonus_service.mark_bonus_paid` — только концептуальная (там создаётся комиссия).
- **Где менять для типовых задач:** формула дохода (`fee × count(paid bonus)`) — `revenue_dashboard` / `revenue_by_clinic`; дефолтная ставка fee — `getattr(f, "fee_per_bonus_from_clinic", 100)` (100 ₽ fallback); границы периодов (текущий/прошлый месяц) — расчёты в `revenue_dashboard`; сама запись комиссии при выплате бонуса — `bonus_service.mark_bonus_paid` (вне файла).
- **Подводные камни:** **Decimal** — `fee` приводится к `Decimal(str(...))`, доход считается как `fee * count` (Decimal × int), наружу float. `_get_my_franchise` здесь может вернуть `None` (без 404 в конце!) — если франшизы нет, последующий `f.id`/`f.name` упадёт `AttributeError` (расхождение с другими файлами, где явно бросается 404). Доход считается ОТ КОЛИЧЕСТВА paid-бонусов, а не от их суммы (`bonus_total_paid_rub` показывается отдельно, но в доход не входит). Период `by-clinic` по умолчанию — текущий месяц. Дубль хелперов прав.
- **Строк:** 208
