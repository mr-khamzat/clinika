# routers [07] — кабинет руководителя (manager): управление сетью, финансы, аналитика, отчёты

Все 15 файлов лежат в пакете `backend/app/routers/manager/` и собираются агрегатором `manager/__init__.py`, который создаёт `APIRouter(prefix="/manager")`. Затем в `main.py` (строка 1648) подключается `app.include_router(manager_router)`. **Итог: к каждому пути ниже добавляется глобальный префикс `/manager`.** Особый случай — `mis_analytics.py`: его собственный `APIRouter(prefix="/analytics")` даёт двойной префикс `/manager/analytics/*`.

Это «командный центр» франшизы/сети клиник. Файлы покрывают: CRUD клиник и услуг, скидки, KPI, финансы (счета платформы/межклиничные/бонусы/журнал биллинга), Kanban-расписание, тепловую карту загрузки врачей, прогноз расходов, мультиклиничный обзор, управление партнёрами/инвайтами/внешними и приезжими врачами/рекрутерами, шаблоны направлений, аналитику из МИС Renovatio и большой набор отчётов с CSV-экспортом.

**Сквозные паттерны группы (важно для любых правок):**
- Доступ почти везде через `Depends(require_manager)` из `app.core.deps` (роли manager / franchise_owner / super_admin). Часть POST/PATCH/DELETE дополнительно требует `require_admin`, `enforce_region_lock`, `require_active_subscription` или `require_feature(...)`.
- Tenant-изоляция: фильтр `Model.tenant_id == current_user.tenant_id`. `super_admin` обычно имеет `tenant_id is None` и видит всё.
- Per-clinic scope: единый хелпер `resolve_clinic_filter_ids(db, current_user, clinic_id)` из соседнего `clinics_access.py` (НЕ из этого среза). Контракт: `None` = все клиники тенанта; `[]` = доступа нет (ранний пустой ответ); список UUID = ограниченный набор. Этот контракт критичен — путать `None` и `[]` нельзя.
- Аудит: best-effort `audit_service.write_safe(...)` обёрнут в `try/except`, чтобы не ломать основное действие.
- Деньги: в БД `Decimal`, на выходе почти всегда приводятся к `float(...)`. `mis_analytics.py` — исключение, работает в `Decimal` (через `_to_decimal`).

| Файл | Назначение в 5-7 слов | Строк |
|---|---|---|
| `clinics_mgmt.py` | CRUD клиник + онбординг управляющего клиники | 216 |
| `cost_forecast.py` | Прогноз расходов клиники, линейная регрессия | 262 |
| `discounts.py` | CRUD скидок с tenant-изоляцией | 160 |
| `doctor_load.py` | Тепловая карта загрузки врачей | 191 |
| `external_doctors.py` | Внешние врачи и менеджеры привлечения | 293 |
| `finance.py` | Счета платформы, межклиничные, бонусы, журнал | 464 |
| `kanban.py` | Kanban расписания приёмов, drag-and-drop | 241 |
| `kpi.py` | KPI-цели сотрудников и факт | 153 |
| `mis_analytics.py` | Аналитика напрямую из МИС Renovatio | 565 |
| `multi_clinic.py` | Панорамный обзор клиник + права доступа | 294 |
| `partners.py` | Партнёры (суб-агенты) и инвайт-коды | 219 |
| `recruiter_doctors.py` | Внешние/приезжие врачи, рекрутеры, профили | 746 |
| `referral_templates.py` | CRUD шаблонов направлений + применение | 249 |
| `reports.py` | Отчёты руководителя + CSV-экспорт | 997 |
| `services_mgmt.py` | CRUD услуг, бонусы, синхронизация с МИС | 273 |

---

## `backend/app/routers/manager/clinics_mgmt.py`
- **Назначение:** CRUD клиник для руководителя сети и онбординг управляющего клиники (генерация логина/пароля управляющего MANAGER, привязанного к `clinic_id`).
- **Ключевые элементы:** эндпоинты `list_clinics`, `update_clinic`, `create_clinic`, `onboard_clinic_manager`, `get_clinic_manager`, `remove_clinic_manager`. Генерация логина (`fmgr_<телефон|имя>`) и 10-символьного пароля через `secrets`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/clinics/` | require_manager | — | `list[ClinicResponse]` | Список клиник в скоупе |
| PATCH | `/manager/clinics/{clinic_id}` | require_manager + region_lock | `UpdateClinicRequest` | `ClinicResponse` | Изменить клинику |
| POST | `/manager/clinics/` | require_manager + region_lock + active_subscription | `CreateClinicRequest` | `ClinicResponse` (201) | Создать клинику (с проверкой лимита тарифа) |
| POST | `/manager/clinics/{clinic_id}/onboard-manager` | require_manager + region_lock | `dict` (full_name, phone_number) | `dict` с логином+паролем (201) | Создать управляющего клиники |
| GET | `/manager/clinics/{clinic_id}/manager` | require_manager | — | `dict` (manager без пароля) | Получить управляющего |
| DELETE | `/manager/clinics/{clinic_id}/manager` | require_manager + region_lock | — | `{"status":"removed"}` | Деактивировать управляющего |
- **Зависимости:** `app.models.clinic.Clinic`, `app.models.user.User/UserRole`, `app.schemas.manager` (`CreateClinicRequest`, `UpdateClinicRequest`, `ClinicResponse`), `app.core.deps.require_manager`, `app.core.region_lock.enforce_region_lock`, `app.core.limits.check_plan_limit`, `app.core.subscription_guard.require_active_subscription`, `app.core.security.hash_password`.
- **Где менять для типовых задач:** новое поле клиники при редактировании — блок `if body.X is not None: clinic.X = ...` в `update_clinic` (+ в схемах `manager.py`); правила генерации логина управляющего — в `onboard_clinic_manager` (блок `if phone: ... else:`); лимит клиник по тарифу — `check_plan_limit("clinics", ...)`.
- **Подводные камни:** в `list_clinics` блок фильтра по `current_user.clinic_id` **продублирован** (строки 31-32 и 34-35) — мёртвый дубль, безвреден, но стоит почистить. `onboard_manager` и `update_clinic` не дублируют `enforce_region_lock` в теле (он навешен зависимостью). Пароль управляющего возвращается **в открытом виде ровно один раз** — фронт обязан показать его сразу. `password_must_change=True` форсирует смену при первом входе (метка `pwdmust01`).
- **Строк:** 216

---

## `backend/app/routers/manager/cost_forecast.py`
- **Назначение:** один GET-эндпоинт — 12-месячная история расходов клиники + прогноз на N месяцев вперёд. Без statsmodels: своя LSQ-линейная регрессия + помесячная сезонность + R² для уровня доверия.
- **Ключевые элементы:** хелперы `_month_key`, `_add_months`, `_build_month_axis`, `_linreg` (возвращает `a, b, r2`); эндпоинт `cost_forecast`. Источники расходов: `bonuses` (модель `Bonus` через `Referral.to_clinic_id`), `supplies` (списания `InventoryMovement` типов WRITE_OFF/OUTGOING/EXPIRED × `InventoryItem.cost_per_unit`), `salaries` — заглушка (0, не добавляется в `available_categories`).
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/analytics/cost-forecast` | require_manager | query: `clinic_id?`, `months_ahead` (1..12, деф. 3) | `dict`: history[], forecast[], trend, warning, available_categories, stats | Прогноз расходов |
- **Зависимости:** `app.models.bonus.Bonus`, `app.models.referral.Referral`, опционально `app.models.inventory.*` (импорт обёрнут try/except → флаг `_HAS_INVENTORY`), `resolve_clinic_filter_ids` из `clinics_access`.
- **Где менять для типовых задач:** добавить новую статью расходов — завести в `history_map` ещё ключ, написать отдельный запрос-агрегацию (как блоки «1. Бонусы» / «3. Расходники») и добавить в `available_categories`; включить реальные зарплаты — заменить блок «2. Зарплаты» на запрос к будущей модели `SalaryPayment`; пороги доверия/тренда — константы `r2 >= 0.7/0.3` и `a > avg*0.02`.
- **Подводные камни:** `inventory` может отсутствовать — весь блок под `_HAS_INVENTORY` и ещё одним `try/except`. Все суммы здесь намеренно `float` (round-2), не Decimal — это аналитический прогноз, не учёт. Бонусы привязаны к клинике только через `Referral.to_clinic_id` (LEFT JOIN), бонусы без referral в клиничный скоуп не попадут. При `filter_ids == []` запрос искусственно зануляется (`.where(False)` / `tenant_id == uuid.UUID(int=0)`).
- **Строк:** 262

---

## `backend/app/routers/manager/discounts.py`
- **Назначение:** CRUD скидок (процент/фикс) с привязкой к услуге или клинике и tenant-изоляцией.
- **Ключевые элементы:** Pydantic-модели `CreateDiscountRequest`, `UpdateDiscountRequest`; эндпоинты `list_discounts`, `create_discount`, `update_discount`, `delete_discount`. Валидация: `discount_type ∈ {percent, fixed}`, `applies_to ∈ {all, service, clinic}`, процент 1..100.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/discounts/` | require_manager | — | `list[dict]` (с именами услуги/клиники) | Список скидок тенанта |
| POST | `/manager/discounts/` | require_manager | `CreateDiscountRequest` | `dict` (201) | Создать скидку |
| PATCH | `/manager/discounts/{discount_id}` | require_manager | `UpdateDiscountRequest` | `dict` | Изменить скидку |
| DELETE | `/manager/discounts/{discount_id}` | require_manager | — | `{"status":"deleted"}` | Удалить скидку (hard delete) |
- **Зависимости:** `app.models.discount.Discount`, `app.models.service.Service`, `app.models.clinic.Clinic`, `app.models.user.User`.
- **Где менять для типовых задач:** новое поле скидки — добавить в обе схемы + в `create_discount` (конструктор `Discount(...)`) + в `update_discount` (блок `if body.X is not None`); новые типы/области применения — расширить проверки в `create_discount`.
- **Подводные камни:** `delete_discount` делает **физическое удаление** (`db.delete`), а не деактивацию — необратимо. Manager со `clinic_id` видит скидки своей клиники + общие (`clinic_id IS NULL`). `discount_value` хранится как `float` на выходе. Где именно применяется скидка к чеку — в этом файле НЕТ (только CRUD); расчёт ищите в сервисах оплаты/направлений.
- **Строк:** 160

---

## `backend/app/routers/manager/doctor_load.py`
- **Назначение:** один GET — heatmap-матрица 7 (дни недели) × 12 (часы 09:00–20:00) загрузки каждого врача в скоупе за период, с метриками `avg_load_pct`, `idle_windows_count`, `overtime_days`.
- **Ключевые элементы:** константы `_HOURS = range(9,21)`, `_WEEKDAYS_RU`; эндпоинт `doctor_load`. Считает `capacity` как (часы × число дней недели в периоде), процент загрузки — эвристика (1 пациент/час).
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/analytics/doctor-load` | require_manager | query: `clinic_id?`, `date_from?`, `date_to?` (деф. 30 дней) | `dict`: doctors[], hours[], days[], period | Тепловая карта загрузки |
- **Зависимости:** `app.models.doctor.Appointment/AppointmentStatus/Doctor`, `resolve_clinic_filter_ids`.
- **Где менять для типовых задач:** изменить рабочее окно — константа `_HOURS`; учитываемые статусы приёмов — список в `Appointment.status.in_([...])` (сейчас PENDING/CONFIRMED/IN_PROGRESS/COMPLETED, без cancelled/no_show); порог переработки — `c > 10` в `overtime_days`; определение «окна простоя» — блок `idle_windows`.
- **Подводные камни:** приёмы вне окна 09–20 в матрицу НЕ попадают, но засчитываются в `overtime`. `avg_load_pct` — грубая эвристика, реальное расписание врача уже не учитывается. tooltip ограничен 5 пациентами на ячейку (`items[:5]`). При `filter_ids == []` возвращается пустой каркас (не ошибка).
- **Строк:** 191

---

## `backend/app/routers/manager/external_doctors.py`
- **Назначение:** тонкая обёртка MVP над ролями `partner_doctor` (= внешний врач, исторический алиас) и `acquisition_manager`/`recruiter` (менеджеры привлечения). Приглашение и редактирование ставок/ИНН/активности.
- **Ключевые элементы:** схемы `ExternalRate`, `ExternalDoctorInvite`, `ExternalDoctorUpdate`, `AcquisitionManagerInvite`; сериализаторы `_serialize_external`, `_serialize_manager`; эндпоинты `list/invite/update external-doctors`, `list/invite acquisition-managers`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/external-doctors` | require_manager | — | `list[dict]` | Внешние врачи тенанта (PARTNER_DOCTOR) |
| POST | `/manager/external-doctors` | require_manager | `ExternalDoctorInvite` | `dict` (201) | Пригласить внешнего врача |
| PATCH | `/manager/external-doctors/{doctor_id}` | require_manager | `ExternalDoctorUpdate` | `dict` | Ставка/ИНН/активность/менеджер |
| GET | `/manager/acquisition-managers` | require_manager | — | `list[dict]` | Менеджеры привлечения (fallback на рекрутеров) |
| POST | `/manager/acquisition-managers` | require_manager | `AcquisitionManagerInvite` | `dict` (201) | Создать менеджера привлечения |
- **Зависимости:** `app.models.user.User/UserRole`, `app.core.security.hash_password`. Поля `external_doctor_inn/rate/active`, `manager_id`, `bonus_percent` читаются через `getattr` (мягко).
- **Где менять для типовых задач:** новый параметр ставки — расширить `ExternalRate`/`ExternalDoctorInvite` и конструктор `User(...)` в `invite_external_doctor`; правила привязки менеджера привлечения — проверка ролей в `invite_external_doctor` (`mgr_role_val not in (...)`).
- **Подводные камни:** роль `acquisition_manager` может отсутствовать в enum БД (миграция `external01` не применена) — оба `list`/`invite` имеют fallback на `RECRUITER` через `try/except ValueError`. `external_doctor_rate` хранится как JSON (`model_dump()`), при чтении возвращается как dict. `bonus_percent` для менеджера приводится к `Decimal`. **Функционально пересекается с `recruiter_doctors.py`** (там тоже регистрация внешних/приезжих врачей и список рекрутеров) — следить за согласованностью.
- **Строк:** 293

---

## `backend/app/routers/manager/finance.py`
- **Назначение:** финансовый раздел руководителя из нескольких блоков: счета от платформы (`FranchiseInvoice`), межклиничные счета (`InterClinicInvoice`), агрегация бонусов сотрудников, отметка счёта оплаченным, журнал биллинг-операций (`BillingLedger`, append-only).
- **Ключевые элементы:** сериализатор `_fr_invoice_out`; эндпоинты `list_platform_invoices`, `list_cross_clinic_invoices`, `list_bonus_aggregation`, `mark_invoice_paid`, `list_billing_ledger`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/finance/platform` | require_manager | query: `status?` | `list[dict]` | Счета от платформы тенанту (через franchise_id) |
| GET | `/manager/finance/cross-clinic` | require_manager | query: `status?`, `direction? (incoming\|outgoing)` | `{items, summary}` | Межклиничные счета + сводка |
| GET | `/manager/finance/bonuses` | require_manager | query: `status?` | `list[dict]` | Агрегация бонусов по сотрудникам |
| POST | `/manager/finance/invoices/{invoice_id}/mark-paid` | require_manager | query: `invoice_kind (franchise\|cross_clinic)` | `dict` | Пометить счёт оплаченным + аудит |
| GET | `/manager/billing/ledger` | require_manager | query: `from`,`to`,`type`,`clinic_id`,`page`,`limit` | `{items, page, limit, total, totals}` | Журнал биллинга с пагинацией и тоталами |
- **Зависимости:** `app.models.franchise_invoice` (`FranchiseInvoice`, `InvoiceStatus`), `app.models.inter_clinic_invoice` (`InterClinicInvoice`, `ICIStatus`), `app.models.bonus` (`Bonus`, `BonusStatus`), `app.models.billing_ledger` (`BillingLedger`, `Direction`), `app.models.tenant.Tenant`, `app.models.franchise.Franchise`, `app.models.clinic.Clinic`, `app.services.audit_service`.
- **Где менять для типовых задач:** новое поле в выдаче счёта платформы — `_fr_invoice_out`; направление/сводка межклиничных — блоки `is_incoming/is_outgoing` и `summary` в `list_cross_clinic_invoices`; логика «оплачен» (статусы, аудит-событие) — `mark_invoice_paid`; новые типы операций журнала — фильтр `type`/группировка `by_type` в `list_billing_ledger`.
- **Подводные камни:** агрегация бонусов джойнит `Bonus.admin_id == User.id` и хитро суммирует pending/paid через `func.cast(Bonus.status == ..., Integer) * Bonus.amount` — при добавлении статусов бонуса логику надо дополнять. `mark_invoice_paid` идемпотентен (если уже PAID — возвращает как есть). Тоталы журнала считаются по ВСЕЙ выборке (после фильтров), не по странице. `net = credit - debit`. `super_admin` без `tenant_id` видит весь платформенный лог/счета. Все суммы наружу — `float`.
- **Строк:** 464

---

## `backend/app/routers/manager/kanban.py`
- **Назначение:** Kanban-доска расписания приёмов: GET 4 колонок (scheduled/confirmed/in_progress/completed) и PATCH смены статуса (drag-and-drop).
- **Ключевые элементы:** маппинги `_UI_TO_DB`/`_DB_TO_UI`/`_KANBAN_DB_STATUSES`, схема `StatusPatch`; эндпоинты `get_kanban`, `patch_appointment_status`. При переходе в/из COMPLETED дёргаются inventory-хуки (`appointment_costing`).
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/appointments/kanban` | require_manager | query: `clinic_id?`,`doctor_id?`,`date_from?`,`date_to?` (деф. сегодня) | `{columns, doctors, filter}` | Доска приёмов по колонкам |
| PATCH | `/manager/appointments/{appointment_id}/status` | require_manager | `StatusPatch` (status) | `{id, status, before}` | Сменить статус + аудит + inventory-хук |
- **Зависимости:** `app.models.doctor.Appointment/AppointmentStatus/Doctor`, `resolve_clinic_filter_ids`, `app.services.audit_service` (+`AuditAction`), `app.services.appointment_costing.on_appointment_completed / on_appointment_uncomplete` (ленивый импорт).
- **Где менять для типовых задач:** добавить колонку/статус — расширить `_UI_TO_DB` (остальные маппинги выведутся автоматически); новые поля карточки — словарь `card` в `get_kanban`; побочные эффекты смены статуса — блок «Этап 2-3 INVENTORY_COST_PLAN» в `patch_appointment_status`.
- **Подводные камни:** `IN_PROGRESS` добавлен миграцией `mgr_templates01` — на старых БД статус может отсутствовать. Inventory-хук и аудит обёрнуты в `try/except` (best-effort, не должны ломать смену статуса). Per-clinic проверка в PATCH делается через `resolve_clinic_filter_ids(db, user, None)` (None=все клиники тенанта) — намеренно. Цена приёма (`appt.price`) → `float`.
- **Строк:** 241

---

## `backend/app/routers/manager/kpi.py`
- **Назначение:** KPI-цели регистраторов (роль REG): чтение цель-vs-факт за месяц и установка целей. Факт считается по `Referral` (всего и подтверждённых).
- **Ключевые элементы:** эндпоинты `list_kpi`, `set_kpi`. Цель хранится в `KpiTarget(admin_id, month, target_referrals, target_confirmed)`, факт — агрегация `Referral` по `created_by_admin_id`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/kpi/` | require_manager + feature `kpi` | query: `month? (YYYY-MM)`, `clinic_id?` | `list[dict]` (цель + факт + %) | KPI сотрудников за месяц |
| POST | `/manager/kpi/{admin_id}` | require_manager + feature `kpi` | `dict` (target_referrals, target_confirmed, month?) | `{status, month}` | Установить/обновить цель (upsert) |
- **Зависимости:** `app.models.kpi_target.KpiTarget`, `app.models.referral.Referral/ReferralStatus`, `app.models.user.User/UserRole`, `app.models.clinic.Clinic`, `app.core.tenant.require_feature`, `resolve_clinic_filter_ids`.
- **Где менять для типовых задач:** другие роли в KPI — `User.role == UserRole.REG` в `admins_filters` (сейчас только регистраторы); новые KPI-метрики — поля `KpiTarget` + блок `actual_q` (агрегация факта) + сборка `result`; формула прогресса — `progress_refs_pct/progress_conf_pct` (с потолком 100%).
- **Подводные камни:** фича-гейт `require_feature("kpi")` — на тарифе без фичи эндпоинт закрыт. `set_kpi` — upsert (обновляет существующую запись или создаёт). Месяц нормализуется к первому числу (`.replace(day=1)`). Прогресс ограничен `min(..., 100.0)`.
- **Строк:** 153

---

## `backend/app/routers/manager/mis_analytics.py`
- **Назначение:** аналитика, читающая данные **напрямую из МИС Renovatio** (а не из локальной БД) — для более точных показателей по флагам МИС (`is_first_doctor`, `is_first_clinic`, `status_id`). Имеет собственный `prefix="/analytics"`.
- **Ключевые элементы:** Pydantic-модели `RetentionMisRow`, `AttributionRow`, `ProgramRow`, `NoShowRow`; хелперы `_default_period`, `_fmt_date` (DD.MM.YYYY для МИС), `_is_completed`, `_is_noshow`, `_to_decimal`, `_to_int`, `_parse_date`, `_resolve_clinics`, `_fetch_all_appointments` (параллельно через `asyncio.gather`); эндпоинты `retention_mis`, `attribution`, `programs`, `noshow`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/analytics/retention-mis` | require_manager | query: `date_from?`,`date_to?`,`clinic_id?` | `list[RetentionMisRow]` | Возвратность по врачам (флаги МИС) |
| GET | `/manager/analytics/attribution` | require_manager | query: `date_from?`,`date_to?`,`clinic_id?` | `list[AttributionRow]` | Маркетинговая атрибуция по channel/source |
| GET | `/manager/analytics/programs` | require_manager | query: `date_from?`,`date_to?`,`clinic_id?` | `list[ProgramRow]` | Программы/абонементы клиники |
| GET | `/manager/analytics/noshow` | require_manager | query: `date_from?`,`date_to?`,`clinic_id?` | `list[NoShowRow]` (топ-100) | Рейтинг no-show пациентов |
- **Зависимости:** `app.services.mis_client` (`get_appointments`, `get_programs`, `get_services`), `app.services.mis_resolver.resolve_mis_creds`, `app.models.clinic.Clinic`, `app.models.tenant.Tenant` (поле `mis_clinic_ids`).
- **Где менять для типовых задач:** новый МИС-отчёт — добавить Pydantic-модель + эндпоинт по образцу (резолв клиник `_resolve_clinics` → загрузка `_fetch_all_appointments` → агрегация); статусы «завершён»/«no-show» — множества `_COMPLETED_STATUS_IDS/STRS`, `_NOSHOW_STATUS_IDS/STRS`; маппинг UUID-клиники → mis_id — `_resolve_clinics`.
- **Подводные камни:** **здесь работают с `Decimal`, не float** (МИС отдаёт суммы как строку/число/None → строго через `_to_decimal`). Формат дат для МИС — `DD.MM.YYYY` (`_fmt_date`), парсинг ответов гибкий (`_parse_date`). `programs` мягко обрабатывает нестабильный формат `getPrograms` (Renovatio не зафиксировал поля) — пробует альтернативные имена полей, при ошибке возвращает `[]`. Запросы к МИС параллельны (`asyncio.gather`), ошибка по одной клинике не валит весь ответ (логируется warning). Per-clinic скоуп тут НЕ через `resolve_clinic_filter_ids`, а через собственный `_resolve_clinics` (резолвит mis_id). Дублирует логику локального ретеншна из `analytics_retention.py` (не в этом срезе), но по «свежим» данным МИС.
- **Строк:** 565

---

## `backend/app/routers/manager/multi_clinic.py`
- **Назначение:** панорамный обзор всех доступных менеджеру клиник (сегодняшние счётчики, онлайн-врачи, последняя активность, алёрты) + назначение/отзыв доступа менеджера к доп. клиникам (`ManagerClinicAccess`).
- **Ключевые элементы:** схема `AssignBody`; эндпоинты `multi_clinic_overview`, `assign_manager_clinic`, `revoke_manager_clinic`. Алёрты: `overtime` (врач >10 приёмов), `no_registrar` (нет активного REG), `idle_long` (после 10:00 нет активных приёмов при ненулевом плане).
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/multi-clinic-overview` | require_manager | — | `{clinics, is_multi}` | Обзор клиник + метрики дня + алёрты |
| POST | `/manager/multi-clinic/assign` | get_current_user (внутри: только franchise_owner/super_admin) | `AssignBody` (user_id, clinic_id) | `{id, already}` (201) | Дать менеджеру доступ к клинике |
| DELETE | `/manager/multi-clinic/assign` | get_current_user (внутри: franchise_owner/super_admin) | query: `user_id`,`clinic_id` | 204 | Отозвать доступ |
- **Зависимости:** `app.models.manager_clinic_access.ManagerClinicAccess`, `app.models.activity_log.ActivityLog`, `app.models.clinic.Clinic`, `app.models.doctor.Appointment/AppointmentStatus/Doctor`, `app.models.user.User/UserRole`, `get_user_clinic_ids` из `clinics_access`, `app.services.audit_service`.
- **Где менять для типовых задач:** новый алёрт — блок `alerts` в `multi_clinic_overview`; новые метрики дня — `appt_rows`/`doc_rows`; правила, кто может назначать доступ — проверка ролей в `assign_manager_clinic`/`revoke_manager_clinic`.
- **Подводные камни:** `assign`/`revoke` используют **`get_current_user`, а НЕ `require_manager`**, и проверяют роль вручную (только FRANCHISE_OWNER/SUPER_ADMIN). `ActivityLog` не имеет `clinic_id` — «последняя активность» вычисляется через `User.clinic_id ↔ ActivityLog.user_id`. Алёрт `idle_long` завязан на `datetime.utcnow().hour >= 10` (UTC, не локальное время клиники — возможны ложные срабатывания). `assign` идемпотентен (возвращает `already: True`). Доступ менеджера = `get_user_clinic_ids` ∪ `ManagerClinicAccess`.
- **Строк:** 294

---

## `backend/app/routers/manager/partners.py`
- **Назначение:** управление партнёрами (роль `PARTNER_DOCTOR`, суб-агенты) и инвайт-кодами (`Invitation`) для самостоятельной регистрации партнёров по ссылке.
- **Ключевые элементы:** схема `CreateInviteRequest`; эндпоинты `list_partners`, `create_partner`, `update_partner`, `delete_partner`, `create_invitation`, `list_invitations`, `delete_invitation`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/partners/` | require_manager | — | `list[dict]` (+ referrals_count) | Список партнёров |
| POST | `/manager/partners/` | require_admin + region_lock | `CreateAdminRequest` | `dict` (201) | Создать партнёра |
| PATCH | `/manager/partners/{partner_id}` | require_admin + region_lock | `UpdateAdminRequest` | `dict` | Изменить партнёра |
| DELETE | `/manager/partners/{partner_id}` | require_admin + region_lock | query: `hard?` | `{"status":...}` | Деактивировать / анонимизировать |
| POST | `/manager/invitations/` | require_manager | `CreateInviteRequest` | `dict` (201) | Создать инвайт-код |
| GET | `/manager/invitations/` | require_manager | — | `list[dict]` (+ is_valid) | Список инвайтов |
| DELETE | `/manager/invitations/{invitation_id}` | require_manager | — | `{"status":"deleted"}` | Удалить инвайт |
- **Зависимости:** `app.models.user.User/UserRole`, `app.models.clinic.Clinic`, `app.models.referral.Referral`, `app.models.invitation.Invitation`, `app.schemas.manager.CreateAdminRequest/UpdateAdminRequest`, `app.services.activity_service.log_activity`, `app.core.region_lock.enforce_region_lock`, `app.core.security.hash_password`.
- **Где менять для типовых задач:** поля партнёра — `create_partner`/`update_partner`; срок жизни/лимит использований инвайта — `CreateInviteRequest` и конструктор `Invitation(...)`; вычисление валидности инвайта — `is_valid` в `list_invitations`.
- **Подводные камни:** POST/PATCH/DELETE партнёра требуют **`require_admin`** (не manager), плюс `enforce_region_lock`. `delete_partner(hard=True)` анонимизирует (обнуляет username/telegram/phone/password, `full_name="[Удалён]"`), без `hard` — просто деактивация. Инвайт-код = `secrets.token_urlsafe(16)`. Tenant-изоляция инвайтов реализована JOIN'ом через `Invitation.invited_by_id → User.tenant_id`. `referrals_count` считается отдельным запросом на каждого партнёра (N+1 — для больших списков может тормозить).
- **Строк:** 219

---

## `backend/app/routers/manager/recruiter_doctors.py`
- **Назначение:** самый крупный файл среза — управление врачами от рекрутеров, внешними/приезжими врачами (PARTNER_DOCTOR/VISITING_DOCTOR), редактирование профилей (со сменой роли), регистрация и управление рекрутерами и их бонусами.
- **Ключевые элементы:** схемы `ResetCredentialsRequest`, `UpdateStaffProfileRequest`, `RegisterExternalDoctorRequest`, `SetPercentRequest`; константы `ROLE_CHANGE_ALLOWED`, `_STAFF_ROLES_LIST`, `_ROLE_LABELS`; эндпоинты (см. таблицу). Условия приезжих врачей пишутся в `VisitingDoctorSettings` (цена визита + % врачу).
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/recruiter-doctors` | require_manager | — | `list[dict]` | Врачи, заведённые рекрутерами |
| POST | `/manager/recruiter-doctors/{doctor_id}/reset-credentials` | require_manager | `ResetCredentialsRequest` | `dict` (+ QR) | Сменить логин/пароль врача |
| PATCH | `/manager/recruiter-doctors/{doctor_id}/toggle-active` | require_manager | — | `dict` | Вкл/выкл доступ врача |
| PATCH | `/manager/recruiter-doctors/{doctor_id}/profile` | require_manager | `UpdateStaffProfileRequest` | `dict` | Полное редактирование профиля + смена роли |
| GET | `/manager/recruiter-doctors/{doctor_id}/visiting-settings` | require_manager | — | `dict` | Условия приезжего врача |
| GET | `/manager/all-partner-doctors` | require_manager | — | `list[dict]` | Все партнёры тенанта |
| GET | `/manager/all-external-doctors` | require_manager | — | `list[dict]` | Все сотрудники в скоупе |
| POST | `/manager/register-external-doctor` | require_manager | `RegisterExternalDoctorRequest` | `dict` (201, креды + QR) | Регистрация внешнего/приезжего врача |
| GET | `/manager/recruiters` | require_manager | — | `list[dict]` | Рекрутеры + бонусы |
| PATCH | `/manager/recruiters/{recruiter_id}/percent` | require_manager | `SetPercentRequest` | `dict` | Процент бонуса рекрутера |
| GET | `/manager/recruiters/{recruiter_id}/doctors` | require_manager | — | `list[dict]` | Врачи конкретного рекрутера |
| DELETE | `/manager/all-external-doctors/{doctor_id}` | require_manager | — | 204 | Удалить внешнего/приезжего врача |
- **Зависимости:** `app.models.user.User/UserRole`, `app.models.doctor_clinic_access.DoctorClinicAccess`, `app.models.clinic.Clinic`, `app.models.tenant.Tenant`, `app.models.doctor.Doctor`, `app.models.external_doctor.VisitingDoctorSettings`, `app.models.recruiter_bonus.RecruiterBonus`, `app.core.security.hash_password`, `app.services.qr_service.generate_url_qr_base64`.
- **Где менять для типовых задач:** разрешённые переходы ролей — множество `ROLE_CHANGE_ALLOWED`; какие роли показывать в общем списке — `_STAFF_ROLES_LIST` и подписи `_ROLE_LABELS`; логика условий приезжего врача — блок `vd_changes`/`VisitingDoctorSettings` в `update_doctor_profile` и в `register_external_doctor`; URL логина/QR — строка `https://клиниксеть.рф/{slug}/admin`.
- **Подводные камни:** `register_external_doctor` создаёт сразу несколько сущностей в одной транзакции (User + DoctorClinicAccess[] + Doctor + опц. VisitingDoctorSettings) — при правках следить за порядком `flush`/`commit`. Пароли/логины возвращаются **в открытом виде** (показать единожды). `super_admin` нельзя менять/сбрасывать через эти эндпоинты. `DELETE /all-external-doctors/{id}` — **физическое удаление** (`db.delete`), только для VISITING/PARTNER. `VisitingDoctorSettings` оборачивается в `try/except` (модель может отсутствовать). `Decimal` для денег приезжих (`price_per_visit`, `doctor_percent`). Функционально перекрывается с `external_doctors.py` и `partners.py` — три файла трогают тех же PARTNER_DOCTOR.
- **Строк:** 746

---

## `backend/app/routers/manager/referral_templates.py`
- **Назначение:** CRUD шаблонов направлений (предзаполненный `payload` формы направления) + POST `/use` для применения (отдаёт payload и инкрементит `usage_count`). Шаблоны — tenant-уровня (`clinic_id=NULL`) или клиничные.
- **Ключевые элементы:** схемы `TemplateIn`, `TemplatePatch`; сериализатор `_serialize`; хелпер `_check_clinic_scope`; эндпоинты `list/create/update/delete/use`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/referral-templates` | require_manager | query: `clinic_id?` | `list[dict]` | Шаблоны в скоупе (+ tenant-level) |
| POST | `/manager/referral-templates` | require_manager | `TemplateIn` | `dict` (201) + аудит | Создать шаблон |
| PATCH | `/manager/referral-templates/{tpl_id}` | require_manager | `TemplatePatch` | `dict` + аудит | Изменить шаблон |
| DELETE | `/manager/referral-templates/{tpl_id}` | require_manager | — | 204 + аудит | Удалить шаблон |
| POST | `/manager/referral-templates/{tpl_id}/use` | require_manager | — | `{id, payload, usage_count}` | Применить (инкремент usage_count) |
- **Зависимости:** `app.models.referral_template.ReferralTemplate`, `app.models.user.User/UserRole`, `resolve_clinic_filter_ids`, `app.services.audit_service`.
- **Где менять для типовых задач:** структура шаблона — поле `payload` (свободный `dict`, схема не валидирует содержимое); правила видимости — логика фильтров в `list_templates` (`clinic_id` указан/нет); проверка доступа к клинике — хелпер `_check_clinic_scope`.
- **Подводные камни:** `payload` — произвольный JSON, валидируется только на фронте/при применении. Все мутации логируются в audit (best-effort try/except). `_check_clinic_scope(clinic_id=None)` всегда разрешён (tenant-level шаблон). При PATCH `clinic_id` проверяется через `model_fields_set`, чтобы отличить «не прислали» от «прислали null». `delete` — физическое удаление.
- **Строк:** 249

---

## `backend/app/routers/manager/reports.py`
- **Назначение:** главный аналитико-отчётный файл руководителя: сводка по направлениям/бонусам, статистика по админам и клиникам, CSV-экспорт, списки бонусов/направлений, дневные/недельные графики, общая аналитика, today-сводка, badge-счётчики и отчёт по приёмам для PDF/Excel-экспорта на фронте.
- **Ключевые элементы:** эндпоинты `get_summary`, `get_admin_stats`, `get_clinic_flow`, `export_referrals`, `list_bonuses_by_admin`, `list_all_referrals`, `get_daily_report`, `get_analytics`, `get_today_stats`, `get_chart_data`, `get_badge_counts`, `get_appointments_report`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/reports/summary` | require_manager | `clinic_id?`,`date_from?`,`date_to?` | `SummaryReport` | Сводка по направлениям/бонусам |
| GET | `/manager/reports/admins` | require_manager | `clinic_id?`,`date_from?`,`date_to?` | `list[AdminStats]` | Статистика по сотрудникам |
| GET | `/manager/reports/clinics` | require_manager | `clinic_id?`,`date_from?`,`date_to?` | `list[ClinicFlowEntry]` | Потоки направлений между клиниками |
| GET | `/manager/reports/export` | require_manager | `clinic_id?`,`admin_id?`,`status?`,`date_from?`,`date_to?` | CSV (Response) | Экспорт направлений в CSV |
| GET | `/manager/reports/bonuses` | require_manager | `clinic_id?`,`only_pending?`,`date_from?`,`date_to?` | `list[dict]` | Бонусы, сгруппированные по админам |
| GET | `/manager/reports/referrals` | require_manager | `clinic_id?`,`status?`,`date_from?`,`date_to?`,`page`,`limit` | `list[dict]` | Список направлений (пагинация) |
| GET | `/manager/reports/daily` | require_manager | `clinic_id?` | `list[dict]` (30 дней) | Дневной отчёт |
| GET | `/manager/reports/analytics` | require_manager + feature `analytics` | `clinic_id?` | `dict` | Большая аналитика (daily/top_services/conversion/...) |
| GET | `/manager/reports/today` | require_manager + feature `analytics` | `clinic_id?` | `dict` | Сводка за сегодня |
| GET | `/manager/reports/chart` | require_manager + feature `analytics` | `clinic_id?` | `list[dict]` (7 дней) | Данные графика |
| GET | `/manager/badge-counts` | require_manager | — | `dict` | Счётчики для бейджей меню |
| GET | `/manager/reports/appointments` | require_manager | `from_date`,`to_date` (обяз.),`doctor_id?`,`clinic_id?`,`status?` | `dict` (appointments + kpi) | Отчёт по приёмам для экспорта |
- **Зависимости:** `app.models.referral.Referral/ReferralStatus`, `app.models.bonus.Bonus/BonusStatus`, `app.models.service.Service`, `app.models.clinic.Clinic`, `app.models.doctor.Appointment/AppointmentStatus/Doctor`, `app.models.user.User/UserRole`, `app.schemas.manager` (`SummaryReport`, `AdminStats`, `ClinicFlowEntry`), `resolve_clinic_filter_ids`, `app.core.deps.require_reports_access`, `app.core.tenant.require_feature`.
- **Где менять для типовых задач:** новый отчёт — добавить эндпоинт по образцу (резолв `filter_ids` → ранний выход при `== []` → сборка `where` → запрос); колонки CSV — заголовок и `writer.writerow` в `export_referrals` (заголовки должны совпадать); содержимое большой аналитики — `get_analytics` (блоки daily/top_services/admin_conversion/clinic_comparison/month_stats); лимит/срок отчёта приёмов — проверки `> 186` дней и `.limit(5000)` в `get_appointments_report`.
- **Подводные камни:** `require_reports_access` импортируется, но в самих сигнатурах используется `require_manager` — проверить, где `require_reports_access` реально навешен (возможно легаси-импорт). `get_badge_counts` **НЕ фильтрует по tenant/clinic** — считает CANCEL_REQUESTED и pending-бонусы по всей БД (потенциальная утечка между тенантами — кандидат на фикс). CSV пишется с BOM (`﻿`) для Excel-кириллицы. `get_appointments_report` возвращает данные, а НЕ файл — PDF/Excel строит фронт. Денежные значения наружу — `float`. Везде один и тот же приём `filter_ids == [] → ранний пустой ответ`; легко забыть при добавлении нового отчёта.
- **Строк:** 997

---

## `backend/app/routers/manager/services_mgmt.py`
- **Назначение:** управление прайс-листом услуг: CRUD, категории, массовое выставление бонуса по категории, синхронизация услуг из МИС Renovatio. Включает финансовую модель направлений (`referral_payout`, `visible_for_referrals`).
- **Ключевые элементы:** схемы `SyncServicesResponse`, `SetCategoryBonusRequest`; эндпоинты `list_service_categories`, `list_services`, `create_service`, `update_service`, `deactivate_service`, `set_category_bonus`, `sync_services_from_mis`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/services/categories` | require_manager | `clinic_id?` | `list[dict]` | Категории услуг + счётчики |
| GET | `/manager/services/` | require_manager | `clinic_id?`,`category?`,`has_bonus?`,`search?`,`for_referrals?` | `list[dict]` (лимит 2000) | Список услуг с фильтрами |
| POST | `/manager/services/` | require_manager | `CreateServiceRequest` | `ServiceSchema` (201) | Создать услугу |
| PATCH | `/manager/services/{service_id}` | require_manager | `UpdateServiceRequest` | `ServiceSchema` | Изменить услугу |
| DELETE | `/manager/services/{service_id}` | require_manager | — | `{"status":"deactivated"}` | Деактивировать услугу (soft) |
| POST | `/manager/services/set-category-bonus` | require_manager | `SetCategoryBonusRequest` | `{updated, bonus_amount}` | Массовый бонус по категории |
| POST | `/manager/mis/sync-services` | require_manager | `clinic_id?` | `SyncServicesResponse` | Синхронизация услуг из МИС |
- **Зависимости:** `app.models.service.Service`, `app.models.clinic.Clinic`, `app.models.user.User`, `app.schemas.manager` (`ServiceSchema`, `CreateServiceRequest`, `UpdateServiceRequest`), `app.services.mis_client.get_services`, `app.services.mis_resolver.resolve_mis_creds`.
- **Где менять для типовых задач:** новое поле услуги — обе схемы + `create_service`/`update_service` (+ выдача в `list_services`); правила финансовой модели — валидация `referral_payout` (≥0 и ≤ price) в create/update; маппинг полей МИС → Service — цикл `for svc in mis_services` в `sync_services_from_mis`.
- **Подводные камни:** DELETE — **soft (is_active=False)**, в отличие от discounts/templates (там физическое удаление) — несогласованность поведения по группе. `referral_payout` валидируется против price дважды (create и update). `sync_services_from_mis` берёт креды по конкретной клинике через `resolve_mis_creds` (а не глобальный `.env`) — раньше был баг «все тенанты в один МИС». Категория «Без категории» нормализуется в `NULL`. `set_category_bonus` — bulk `UPDATE` в рамках tenant/clinic-скоупа. Цены/бонусы наружу — `float`.
- **Строк:** 273
