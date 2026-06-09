# routers [01] — кабинет бухгалтера (`/accountant/*`) + платформенный super-admin (`/admin/*`)

Эта группа охватывает первые 15 файлов из `backend/app/routers/` (по алфавиту): весь подпакет **`accountant/`** (кабинет бухгалтера клиники) плюс верхнеуровневые роутеры **`acts.py`** и блок **`admin*.py`** (управление платформой суперадмином). Все файлы — FastAPI `APIRouter`'ы на `async`/`await` + SQLAlchemy AsyncSession (`get_db`). Две принципиально разные модели доступа:

- **`accountant/*`** — tenant-scoped: пускает `require_accountant` (бухгалтер/менеджер/owner/директор/super_admin), данные фильтруются по `tenant_id` пользователя, опционально сужаются `clinic_id`. Это «деньги клиники»: касса, платежи, ЗП, P&L, расходы, акты.
- **`admin*.py`** — platform-scoped: пускает только `require_super_admin`, агрегирует данные **по всем тенантам без фильтра** (тенанты, франшизы, биллинг платформы, MRR/ARR/churn/LTV, квоты, cost-attribution). Исключение — `admin_aggregator.py` (tenant-scoped, для менеджера/owner).

Монтирование в `backend/app/main.py` (без глобального `/api`-префикса): `accountant_router` имеет `prefix="/accountant"` и подключает 7 суброутеров (cash/acts/summary/payments/payroll/reports/spending); `admin.py` → `/admin`; `acts.py` → `/acts` + алиас `/inter-clinic-acts`; остальные admin-роутеры несут собственный полный prefix (`/admin/analytics`, `/admin/quotas`, `/admin/aggregator`, `/admin/arr-ltv`, `/admin/cost-attribution`).

## Оглавление

| Файл | Назначение в 5-7 слов | Строк |
|---|---|---|
| `accountant/acts.py` | Реестр платформенных актов тенанта (read-only) | 97 |
| `accountant/cash.py` | Кассовые смены: открытие, операции, Z-отчёт | 385 |
| `accountant/deps.py` | Dependency require_accountant + scope клиник | 50 |
| `accountant/payments.py` | Реестр платежей пациентов (read-only) | 81 |
| `accountant/payroll.py` | Зарплатная матрица + отметка выплат | 217 |
| `accountant/reports.py` | P&L и Cashflow по клинике/тенанту | 238 |
| `accountant/spending.py` | CRUD расходов клиники + summary | 261 |
| `accountant/summary.py` | Дашборд бухгалтера (касса/оборот/акты) | 171 |
| `acts.py` | Акты КлиникСети↔тенант: генерация, подпись, PDF | 233 |
| `admin.py` | Super-admin: тенанты, франшизы, биллинг, churn | 2110 |
| `admin_aggregator.py` | Партнёрства с агрегаторами (DocDoc и т.п.) | 241 |
| `admin_analytics.py` | Платформенная аналитика: MRR/churn/health | 558 |
| `admin_api_quotas.py` | API-квоты тенантов: лимиты, usage, алерты | 347 |
| `admin_arr_ltv.py` | ARR/LTV/когорты/прогноз (read-only) | 104 |
| `admin_cost_attribution.py` | Себестоимость тенантов: снапшоты, топ, summary | 199 |

---

## `backend/app/routers/accountant/acts.py`
- **Назначение:** Read-only реестр платформенных актов (подписочные акты, которые КлиникСеть выставила тенанту). MVP: показывает только `Invoice` c заполненным `act_number`. Phase 2 — акты клиника↔контрагент (ещё нет).
- **Ключевые элементы:** `ActOut` (Pydantic), `list_acts()`, helper `_to_date()` (нормализует datetime→date). `router` с `prefix="/acts"`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/accountant/acts` | require_accountant | `date_from`, `date_to`, `status`(alias), `limit≤500` | `list[ActOut]` | Список актов тенанта за период с фильтром по статусу |

- **Зависимости:** `app.models.billing.Invoice`, `app.models.user.User`, `require_accountant` из `accountant/deps.py`, `get_db`.
- **Где менять для типовых задач:** добавить поле в карточку акта — расширить `ActOut` и маппинг в `list_acts`; добавить фильтр (например по `act_type`) — добавить `Query`-параметр и условие в `conds`. Переход на отдельную таблицу актов (вместо `Invoice`) — менять модель и весь маппинг.
- **Подводные камни:** фильтрация `Invoice.tenant_id == user.tenant_id` (tenant-scoped, **не** clinic). Маппинг построен на `getattr(inv, ..., None)` с фоллбэками (`amount_total` или `amount`, `period_label` или `period`) — признак того, что поля акта добавлялись поверх `Invoice` миграцией и могут отсутствовать в старых записях. `date_from`/`date_to` объявлены как параметры, но **в `conds` не используются** (фильтрация по периоду фактически не применяется — потенциальный баг/недоделка). `act_status` сравнивается со строкой.
- **Строк:** 97

## `backend/app/routers/accountant/cash.py`
- **Назначение:** Полный жизненный цикл кассовой смены клиники: открыть, добавлять приходы/расходы, закрыть с Z-отчётом и расчётом расхождения (discrepancy). Плюс ручной импорт платежей из МИС в открытую смену.
- **Ключевые элементы:** схемы `OpenShiftRequest`/`AddEntryRequest`/`CloseShiftRequest`/`EntryOut`/`ShiftOut`/`ShiftDetailsOut`; helpers `_user_clinic_id()`, `_shift_totals()` (in/out/count), `_shift_to_out()`. `router` с `prefix="/cash"`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| POST | `/accountant/cash/open` | require_accountant | `OpenShiftRequest` | `ShiftOut` | Открыть смену; если уже открыта — вернуть её |
| POST | `/accountant/cash/{shift_id}/entries` | require_accountant | `AddEntryRequest` | `EntryOut` | Добавить приход/расход в открытую смену |
| POST | `/accountant/cash/{shift_id}/close` | require_accountant | `CloseShiftRequest` | `ShiftOut` | Закрыть смену, посчитать expected/discrepancy |
| GET | `/accountant/cash/current` | require_accountant | — | `ShiftDetailsOut`\|null | Текущая открытая смена клиники + операции |
| GET | `/accountant/cash/history` | require_accountant | `date_from`, `date_to`, `clinic_id`, `limit≤200` | `list[ShiftOut]` | История смен тенанта (по умолч. 30 дней) |
| GET | `/accountant/cash/{shift_id}` | require_accountant | — | `ShiftDetailsOut` | Детали смены с операциями |
| POST | `/accountant/cash/sync-mis-payments` | require_accountant | — | dict-stats | Ручной импорт платежей из МИС в открытую смену |

- **Зависимости:** `app.models.cash_shift` (`CashShift`, `CashShiftEntry`, статусы/категории), `app.models.user`, `require_accountant`; `sync-mis-payments` lazy-импортирует `app.services.mis_payments_sync.sync_tenant_payments` и `app.models.tenant.Tenant`.
- **Где менять для типовых задач:** новая категория операции — расширить enum в `app/models/cash_shift.py` (а не здесь); изменить формулу Z-отчёта — `close_shift()` (строки 247-249: `expected = cash_start + in_total - out_total`, `discrepancy = actual - expected`); логику «одна открытая смена» — `open_shift()` + DB-индекс из миграции `acct01_cashshift`.
- **Подводные камни:** инвариант «одна открытая смена на клинику» обеспечен **partial unique index в БД**, а в коде ловится через `IntegrityError`+rollback (гонка двух сессий) — не убирать этот try/except. Суммы — `Decimal` (`sum(..., Decimal("0"))` со стартовым значением, чтобы не падать на пустом генераторе). Доступ к чужой смене: `tenant_id` проверяется всегда (403), а `clinic_id` — только для ролей ACCOUNTANT/MANAGER (директор/owner видят все клиники). `add_entry` дублирует валидацию `direction` хотя схема уже её гарантирует через `pattern`.
- **Строк:** 385

## `backend/app/routers/accountant/deps.py`
- **Назначение:** Общие зависимости для всех `accountant/*`-роутеров. `require_accountant` — гейт по ролям; `scope_clinic_ids` — какие клиники видит пользователь.
- **Ключевые элементы:** множество `_ACCOUNTANT_ALLOWED` (ACCOUNTANT, MANAGER, FRANCHISE_OWNER, DIRECTOR, DEPUTY_DIRECTOR, SUPER_ADMIN); `async def require_accountant()`; `def scope_clinic_ids(user) -> list`.
- **Эндпоинты:** нет (модуль зависимостей).
- **Зависимости:** `app.models.user.User/UserRole`, `app.core.deps.get_current_user`.
- **Где менять для типовых задач:** дать новой роли доступ в кабинет бухгалтера — добавить в `_ACCOUNTANT_ALLOWED`; изменить, какие клиники видит роль — `scope_clinic_ids`.
- **Подводные камни:** `scope_clinic_ids` возвращает **пустой список и для super_admin (без ограничений), и для пользователя без clinic_id** — вызывающий код должен различать эти случаи сам; на практике большинство `accountant/*`-эндпоинтов эту функцию **не используют**, а фильтруют tenant-wide с опциональным `clinic_id` (см. payments/payroll/reports/spending). Функция выглядит легаси/недоиспользованной — при доработке мульти-клиник проверять реальное место вызова.
- **Строк:** 50

## `backend/app/routers/accountant/payments.py`
- **Назначение:** Read-only реестр платежей пациентов (`ClinicPayment`). Tenant-wide: бухгалтер видит обороты всех клиник сети.
- **Ключевые элементы:** `PaymentOut`, `list_payments()`. `router` с `prefix="/payments"`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/accountant/payments` | require_accountant | `date_from`, `date_to`, `status`(alias), `clinic_id`, `limit≤500` | `list[PaymentOut]` | Платежи пациентов тенанта за период |

- **Зависимости:** `app.models.payments_clinic.ClinicPayment`, `app.models.user`, `require_accountant`.
- **Где менять для типовых задач:** добавить поле платежа в выдачу — `PaymentOut` + маппинг; новый фильтр (gateway и т.п.) — `Query` + условие в `conds`.
- **Подводные камни:** фильтр по `tenant_id` (tenant-wide), `clinic_id` — опционально. `amount` — `Decimal`. По умолчанию период — последние 30 дней. `status` сравнивается со строкой (не enum).
- **Строк:** 81

## `backend/app/routers/accountant/payroll.py`
- **Назначение:** Зарплатная матрица сотрудников по периоду (начислено/выплачено/баланс) + операция «отметить выплату» (создаёт запись `withdrawal` в append-only ledger).
- **Ключевые элементы:** константы `ACCRUAL_OPS = ("bonus","referral_payout","doctor_payment")`, `WITHDRAWAL_OP="withdrawal"`; схемы `PayrollRow`/`MarkPaidIn`/`MarkPaidOut`; helpers `_period_bounds()`, `_ensure_clinic()`; `list_payroll()`, `mark_paid()`. `router` с `prefix="/payroll"`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/accountant/payroll` | require_accountant | `date_from`, `date_to`, `clinic_id` | `list[PayrollRow]` | Матрица начислений/выплат по сотрудникам |
| POST | `/accountant/payroll/{user_id}/mark-paid` | require_accountant | `MarkPaidIn` (amount>0, period_label) | `MarkPaidOut` | Записать выплату как withdrawal в ledger |

- **Зависимости:** `app.models.ledger.LedgerEntry` (источник истины по деньгам), `app.models.user.User/UserRole`, `require_accountant`.
- **Где менять для типовых задач:** какие операции считаются начислением — `ACCRUAL_OPS`; формула баланса — `balance = accrued - paid` (paid = `-SUM(amount)` по withdrawal); чтобы привязать выплату к конкретному периоду в ledger — сейчас `reference_id=None`, period кладётся в `description`.
- **Подводные камни:** `accrued`/`paid` считаются по `tenant_id` (не clinic_id!), даже когда задан `clinic_id` для фильтра пользователей — это сознательно (tenant-wide). `mark_paid` записывает `amount` **со знаком минус** (`-payload.amount`) — withdrawal хранится отрицательным, поэтому `paid = -SUM`. `clinic_id` ledger-записи берётся из `target.clinic_id` (может быть `None` для tenant-wide ролей). Все суммы — `Decimal` через `func.coalesce(..., 0)`. Пересчёт после mark_paid идёт по **всей истории** пользователя, не по периоду.
- **Строк:** 217

## `backend/app/routers/accountant/reports.py`
- **Назначение:** Финотчёты по клинике/тенанту: P&L (агрегат за период) и Cashflow (серия по day/week/month). Tenant-wide с опциональным `clinic_id`.
- **Ключевые элементы:** схемы `RevenueBlock`/`PnLOut`/`CashflowRow`; helpers `_period_bounds()`, `_ensure_clinic()`; константа `EXPENSE_CATEGORIES=("expense","salary","incassation")`; `pnl()`, `cashflow()`. `router` с `prefix="/reports"`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/accountant/reports/pnl` | require_accountant | `date_from`, `date_to`, `clinic_id` | `PnLOut` | P&L: онлайн-выручка, касса in/out, ЗП, расходы, net |
| GET | `/accountant/reports/cashflow` | require_accountant | `date_from`, `date_to`, `granularity`(day/week/month), `clinic_id` | `list[CashflowRow]` | Денежный поток по периодам (date_trunc) |

- **Зависимости:** `app.models.cash_shift` (`CashShift`+`CashShiftEntry`, JOIN), `app.models.ledger.LedgerEntry`, `app.models.payments_clinic.ClinicPayment/ClinicPaymentStatus`, `require_accountant`.
- **Где менять для типовых задач:** что входит в «расходы» — `EXPENSE_CATEGORIES`; формула net — `pnl()` строка 164 (`net = online_card + cash_in - cash_out`, расходы намеренно НЕ вычитаются повторно, т.к. уже сидят в `cash_out`); добавить блок выручки наличными — `RevenueBlock`+агрегат.
- **Подводные камни:** **двойной учёт расходов исключён вручную** — комментарий на строке 163 предупреждает: `cash_out` уже содержит категории expense/salary/incassation, поэтому `expenses` показывается отдельно, но в `net` не вычитается ещё раз. Cashflow использует `func.date_trunc(granularity, ...)` — это PostgreSQL-специфично, на SQLite (живые тесты) может не работать. Все суммы заворачиваются в `Decimal(... or 0)`. `payroll_paid = -SUM` (ledger withdrawal отрицателен).
- **Строк:** 238

## `backend/app/routers/accountant/spending.py`
- **Назначение:** CRUD расходов клиники (`Spending`) + сводка по категориям. Список/summary — tenant-wide; create/patch/delete/mark-paid — по `clinic_id` текущего пользователя.
- **Ключевые элементы:** `ALLOWED_CATEGORIES={rent,lab,materials,marketing,utilities,other}`; схемы `SpendingOut`/`SpendingCreateIn`/`SpendingPatchIn`/`SummaryOut`; helpers `_ensure_clinic()`, `_period_bounds()`, `_validate_category()`, `_get_owned()` (404/403); CRUD-функции. `router` с `prefix="/spending"`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/accountant/spending` | require_accountant | `date_from`, `date_to`, `category`, `clinic_id` | `list[SpendingOut]` | Список расходов (tenant-wide) |
| POST | `/accountant/spending` | require_accountant | `SpendingCreateIn` | `SpendingOut` (201) | Создать расход (в свою клинику) |
| PATCH | `/accountant/spending/{id}` | require_accountant | `SpendingPatchIn` | `SpendingOut` | Частичное обновление |
| POST | `/accountant/spending/{id}/mark-paid` | require_accountant | — | `SpendingOut` | Проставить `paid_at = today` |
| DELETE | `/accountant/spending/{id}` | require_accountant | — | 204 | Удалить расход |
| GET | `/accountant/spending/summary` | require_accountant | `date_from`, `date_to`, `clinic_id` | `SummaryOut` | Суммы по категориям + total |

- **Зависимости:** `app.models.spending.Spending`, `app.models.user`, `require_accountant`.
- **Где менять для типовых задач:** добавить категорию расхода — `ALLOWED_CATEGORIES`; новое поле — `Spending` модель + все 3 схемы + create-маппинг; правило владения — `_get_owned()` (проверяет `clinic_id`, не `tenant_id`).
- **Подводные камни:** **асимметрия скоупа** — чтение tenant-wide, а запись/удаление ограничены `_ensure_clinic`/`_get_owned` (только своя клиника, иначе 403). Маршрут `GET /summary` объявлен **после** `GET /{spending_id}`-нет (тут `{spending_id}` только на PATCH/DELETE/mark-paid), коллизии нет, но при добавлении `GET /{id}` следить за порядком (literal `/summary` должен идти раньше). `amount` — `Decimal(gt=0)`. `category` валидируется вручную через 422.
- **Строк:** 261

## `backend/app/routers/accountant/summary.py`
- **Назначение:** Дашборд бухгалтера — три блока за один запрос: кэш на руках по открытой смене (по своей клинике), сегодняшний онлайн-оборот (tenant-wide), акты текущего месяца + неоплаченные.
- **Ключевые элементы:** схемы `CashOnHandOut`/`TodayTurnoverOut`/`ActsSummaryOut`/`SummaryOut`; `summary()`. `router` с `prefix="/summary"`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/accountant/summary` | require_accountant | `period_from` (опц.) | `SummaryOut` | Сводный дашборд: касса/оборот/акты |

- **Зависимости:** `app.models.cash_shift`, `app.models.payments_clinic`, `app.models.billing.Invoice`, `require_accountant`.
- **Где менять для типовых задач:** добавить метрику на дашборд — новая Pydantic-схема + блок-расчёт в `summary()` + поле в `SummaryOut`; изменить «кэш на руках» — блок 1 (требует `clinic_id`, иначе пустой `CashOnHandOut()`).
- **Подводные камни:** **смешанный скоуп в одном эндпоинте** — блок «кэш на руках» работает только при наличии `clinic_id` (своя клиника), а «сегодняшний оборот» и «акты» — tenant-wide. Параметр `period_from` принимается, но **нигде не используется** (оборот всегда за сегодня, акты — за текущий месяц) — недоделка. Сумма актов берётся через `hasattr(Invoice,"amount_total")` фоллбэк на `amount` (см. acts.py). Суммы — `Decimal`.
- **Строк:** 171

## `backend/app/routers/acts.py`
- **Назначение:** Акты выполненных работ между КлиникСетью и тенантом (подписочные/межклиничные): генерация месячного акта, подпись (обычная и «электронная» упрощённая), оплата, проверка просрочки, PDF. Дублируется на алиас `/inter-clinic-acts` для совместимости с фронтом.
- **Ключевые элементы:** два роутера — `router` (`/acts`) и `inter_clinic_router` (`/inter-clinic-acts`); схемы `GenerateActIn`/`SignActIn`/`PayActIn`/`ElectronicSignIn`; helpers `_resolve_invoice_for_pdf()` (по UUID или act_number), `_can_access_act()`, `_act_pdf_response()`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/acts/` | get_current_user | `act_status?` | список актов | Список актов (super_admin — все, иначе свой тенант) |
| POST | `/acts/generate` | super_admin/reg/manager | `GenerateActIn` (year, month) | акт | Сгенерировать месячный акт по активной подписке |
| POST | `/acts/{act_number}/sign` | super_admin/reg/manager | `SignActIn` (signer_name) | акт | Подписать акт (фиксируется IP) |
| POST | `/acts/{act_number}/pay` | super_admin | `PayActIn` (amount) | акт | Отметить акт оплаченным |
| POST | `/acts/check-overdue` | super_admin | — | counts | Пометить просроченные + soft-lock |
| GET | `/acts/{act_id}/pdf` | super_admin/franchise_owner/manager+ своего тенанта | — | PDF (inline) | Скачать PDF акта |
| POST | `/acts/{act_id}/sign-electronic` | super_admin/franchise_owner/reg/manager | (пусто) | акт | Упрощённая внутренняя ЭП |
| GET | `/inter-clinic-acts/{act_id}/pdf` | то же | — | PDF | Алиас PDF |
| POST | `/inter-clinic-acts/{act_id}/sign-electronic` | то же | (пусто) | акт | Алиас ЭП |

- **Зависимости:** `app.services.acts_service.ActsService` (вся бизнес-логика: list/generate/sign/pay/PDF/overdue/soft-lock), `app.models.billing.Invoice/Subscription`, `app.core.tenant.get_current_tenant`, `app.core.deps.get_current_user`.
- **Где менять для типовых задач:** логика генерации/подписи/PDF — в `acts_service.py`, не здесь (роутер только проверяет роли и резолвит инвойс); правила доступа к PDF/ЭП — `_can_access_act()`; новый алиас-путь — добавить хендлер на `inter_clinic_router`, делегирующий тому же `_act_pdf_response`.
- **Подводные камни:** **роли заданы строковыми литералами** (`"super_admin"`, `"reg"`, `"manager"`, `"franchise_owner"`, `"admin"`) — не enum `UserRole`, риск рассинхрона при переименовании ролей. `/inter-clinic-acts` — **дубль-алиас**, реальные хендлеры те же; при изменении основной логики не забыть про алиас. `_resolve_invoice_for_pdf` ищет и по UUID, и по `act_number` (две попытки). PDF-генерация может падать (`weasyprint` lazy) — обёрнута в try/except→500. TODO в коде: реальная КЭП/ФНС не реализованы (только `signed_at=now`).
- **Строк:** 233

## `backend/app/routers/admin.py`
- **Назначение:** Главный super-admin-роутер платформы: CRUD тенантов и франшиз, смена тарифов/подписок, модули/плагины тенанта, платформенные метрики и биллинг (MRR/инвойсы/платежи/ledger), платёжные шлюзы, платформенные пользователи, Region Lock (блокировки + IP allowlist), Tenant Health Score, Churn Dashboard. Самый крупный файл группы.
- **Ключевые элементы:** локальная зависимость `require_super_admin()` (по роли ИЛИ по `settings.superadmin_username`); десятки Pydantic-схем (`TenantCreateRequest`, `TenantDetailOut`, `ModuleUpdate`, `TenantSubscriptionRequest`, `FranchiseCreateRequest/UpdateRequest`, `FranchiseBlockRequest`, `IpAllowlistRequest`, `ChurnMarkRequest`, `PaymentGatewayUpdate`, `PlatformUserCreate`...); helper `_serialize_franchise()`; константы `CHURN_REASONS`/`VOLUNTARY_REASONS`/`INVOLUNTARY_REASONS`. `router` с `prefix="/admin"`.
- **Эндпоинты (основные, ~40):**

| Метод | Путь (`/admin`) | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/tenants` | super_admin | — | list | Тенанты + агрегаты (clinics/users/sub) |
| GET | `/tenants/{id}` | super_admin | — | detail | Детали тенанта + модули/плагины |
| POST | `/tenants` | super_admin | `TenantCreateRequest` | result (201) | Онбординг тенанта (одна транзакция) |
| PATCH | `/tenants/{id}/toggle` | super_admin | — | состояние | Активировать/деактивировать |
| DELETE | `/tenants/{id}` | super_admin | — | status | Мягкое удаление + отзыв токенов |
| PATCH | `/tenants/{id}/plan` | super_admin | dict(plan,days) | ok | Сменить тариф + уведомить TG |
| POST | `/tenants/{id}/subscription` | super_admin | `TenantSubscriptionRequest` | ok | Активировать/обновить подписку |
| POST | `/tenants/{id}/reset-password` | super_admin | — | creds | Сброс пароля админа тенанта |
| GET | `/tenants/{id}/credentials` | super_admin | — | creds | URL + логин админа тенанта |
| PUT | `/tenants/{id}/modules` | super_admin | `ModuleUpdate` | ok | Вкл/выкл модуль тенанта |
| POST | `/tenants/{id}/churn` | super_admin | `ChurnMarkRequest` | ok | Пометить churned (raw SQL) |
| GET | `/tenants/health-overview` | super_admin | — | list | Health-score всех тенантов |
| GET | `/tenants/{id}/health` | super_admin | — | detail | Детальный health одного тенанта |
| GET | `/metrics` | super_admin | — | dict | Сводные метрики платформы |
| GET | `/billing` | super_admin | — | dict | Подписки + MRR |
| GET | `/billing/ledger` | super_admin | `days` | dict | Доходы из BillingLedger по тенантам/модулям |
| GET | `/billing/ledger/entries` | super_admin | `days,entry_type,tenant_id,limit,offset` | items | Журнал записей ledger |
| GET | `/billing/overview` | super_admin | — | dict | MRR/ARR/ARPU/churn/инвойсы |
| GET | `/billing/subscriptions` | super_admin | `status,days` | items | Все подписки + tenant.name |
| GET | `/billing/invoices` | super_admin | `status,from_date,to_date` | items | Все инвойсы платформы |
| GET | `/billing/payments` | super_admin | — | items | Платежи платформы (500) |
| GET | `/analytics/platform` | super_admin | `days` | dict | KPI: новые/активные/гео/top-revenue |
| GET | `/payment-gateways` | super_admin | — | list | Шлюзы (stripe/yookassa) + наличие ключей |
| POST | `/payment-gateways/{provider}` | super_admin | `PaymentGatewayUpdate` | ok | Сохранить ключи в system_settings |
| GET | `/users` | super_admin | `role?` | list | Платформенные пользователи |
| POST | `/users` | super_admin | `PlatformUserCreate` | creds (201) | Создать пользователя (без tenant) |
| GET | `/franchises` | super_admin | — | list | Франшизы + tenant_count + mrr_sum |
| GET/POST/PATCH/DELETE | `/franchises[/{id}]` | super_admin | `Franchise*Request` | franchise | CRUD франшиз (создание повышает владельца) |
| GET | `/franchises/{id}/tenants` | super_admin | — | list | Тенанты франшизы |
| PATCH | `/franchises/{id}/billing` | super_admin | `FranchiseBillingIn` | ok | Тарифная политика франшизы |
| POST | `/franchises/{id}/block` · `/unblock` | super_admin | `FranchiseBlockRequest` | ok | Ручная блокировка (Region Lock) + audit |
| GET/POST/DELETE | `/franchises/{id}/ip-allowlist[/{eid}]` | super_admin | `IpAllowlistRequest` | list/entry | IP allowlist франшизы + audit |
| GET | `/churn/summary` | super_admin | `period` (YYYY-MM) | dict | Churn rate, причины, тренд 12м |

- **Зависимости:** модели `tenant` (Tenant, TenantLicense, TenantBranding, TenantModule, TenantPlugin), `franchise.Franchise`, `franchise_ip_allowlist`, `billing` (Subscription, Invoice, Payment, PLAN_PRICES, SubStatus), `billing_ledger`, `clinic`, `referral`, `commercial`, `audit`, `refresh_token`; сервисы `tenant_onboarding_service.onboard_tenant`, `tenant_health.compute_health`, `billing_service`, `settings_service`, `audit_service.write_safe`, `alert_service` (graceful TG-уведомления). Много lazy-импортов внутри функций.
- **Где менять для типовых задач:** добавить поле тенанта в выдачу — `get_tenant_detail`/`list_tenants`; новая роль с доступом к админке — `require_super_admin` (по умолчанию роль ИЛИ суперадмин-username из настроек); причины оттока — `CHURN_REASONS`/`VOLUNTARY_REASONS`/`INVOLUNTARY_REASONS`; новый платёжный провайдер — `_PAYMENT_PROVIDERS`; цены планов — берутся из `app.models.billing.PLAN_PRICES`.
- **Подводные камни:** `churn`-эндпоинты и `mark_tenant_churned` используют **raw `text()`-SQL** для `churned_at`/`churn_reason` (поля из миграции `tenantchurn01`) — чтобы не зависеть от model-cache; это PostgreSQL (`date_trunc`, `FILTER (WHERE ...)`, `CAST(:ip AS inet)`) и **не запустится на SQLite**. Деньги в выдаче конвертируются в `float(...)` (для JSON) — следить, чтобы расчёты до этого шли в `Decimal`. Удаление тенанта — **мягкое** (`is_active=False`+отзыв токенов), системный тенант `arc` защищён. `delete_franchise` — жёсткое (`ON DELETE SET NULL` у тенантов). Все TG-уведомления и audit-записи обёрнуты в `try/except: pass` (никогда не должны ломать основную операцию). `platform_metrics`: `tenants_total` и `tenants_active` считаются по одному и тому же условию (`is_active==True`) — фактически дубль. `change_tenant_plan`/`set_tenant_subscription` частично дублируют логику обновления подписки+лицензии.
- **Строк:** 2110

## `backend/app/routers/admin_aggregator.py`
- **Назначение:** Управление партнёрствами с медицинскими агрегаторами (DocDoc, ПроДокторов и т.п.): CRUD партнёрств с генерацией API-ключа, обработка входящих лидов, статистика. **Tenant-scoped** (исключение в admin-группе).
- **Ключевые элементы:** локальная зависимость `_REQUIRE_MANAGER = require_role(MANAGER, FRANCHISE_OWNER, SUPER_ADMIN)`; схемы `PartnershipIn`/`PartnershipPatch`/`LeadStatusPatch`; helpers `_serialize_partnership()` (показывает plaintext-ключ один раз), `_serialize_lead()`. `router` с `prefix="/admin/aggregator"`.
- **Эндпоинты:**

| Метод | Путь (`/admin/aggregator`) | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/partnerships` | manager+ | — | items | Партнёрства тенанта |
| POST | `/partnerships` | manager+ | `PartnershipIn` | partnership+key (201) | Создать партнёрство + API-ключ |
| PATCH | `/partnerships/{id}` | manager+ | `PartnershipPatch` | partnership | Изменить комиссию/статус |
| DELETE | `/partnerships/{id}` | manager+ | — | 204 | Удалить партнёрство |
| GET | `/leads` | manager+ | `status,partner,limit` | items | Лиды по партнёрствам тенанта |
| PATCH | `/leads/{id}/status` | manager+ | `LeadStatusPatch` | lead | Сменить статус лида + комиссия |
| GET | `/stats` | manager+ | `period` (7d/30d/90d) | dict | Статистика за период |

- **Зависимости:** `app.models.aggregator` (AggregatorPartnership, AggregatorLead), `app.services.aggregator_service` (`generate_api_key`, `update_lead_status`, `stats_for_period`), `app.core.deps.require_role/get_current_user`.
- **Где менять для типовых задач:** допустимые статусы лида — set в `patch_lead_status` (строка 204: `{received,contacted,scheduled,completed,lost}`); генерация/хранение ключа — `aggregator_service.generate_api_key`; новый период статистики — `aggregator_service.stats_for_period`.
- **Подводные камни:** **tenant-scoped, не platform-scoped** — несмотря на `/admin/`-префикс, фильтрует по `current_user.tenant_id` и пускает manager/owner (не только super_admin). Владение лидом проверяется **через partnership** (lead → partnership.tenant_id). API-ключ показывается **в plaintext только при создании** (`api_key_plaintext` + warning), хранится как hash + prefix. Статусы лида валидируются строкой вручную.
- **Строк:** 241

## `backend/app/routers/admin_analytics.py`
- **Назначение:** Платформенная аналитика для super_admin: MRR/ARR dashboard с трендом 12м, Churn dashboard, Tenant Health Score (по упрощённой формуле 30/30/20/20). Альтернатива/расширение метрик из `admin.py`.
- **Ключевые элементы:** фоллбэк-прайслист `PLAN_PRICES_RUB`; helpers `_plan_price()`, `_month_label/_month_bounds/_last_n_months`, `_color_for_score()`, `_compute_simple_health()`; константы весов `W_USERS/W_BOOKINGS/W_PAYMENTS/W_TTV`. `router` с `prefix="/admin/analytics"`.
- **Эндпоинты:**

| Метод | Путь (`/admin/analytics`) | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/mrr` | super_admin | — | dict | MRR/ARR, by_plan, тренд 12м, LTV, source |
| GET | `/churn` | super_admin | `period` (last_3m/6m/12m) | dict | Churn rate помесячно, причины, vol/invol |
| GET | `/tenant-health` | super_admin | — | list | Все тенанты + health_score |
| GET | `/tenant-health/{id}` | super_admin | — | dict | Детальная разбивка health тенанта |

- **Зависимости:** `app.core.deps.require_super_admin`, модели `tenant` (Tenant, TenantLicense), `billing` (Subscription, SubStatus); raw `text()`-SQL по `audit_log`/`appointments`/`invoices`/`tenants`.
- **Где менять для типовых задач:** фоллбэк-цены планов — `PLAN_PRICES_RUB`; веса/пороги health-score — `W_*` константы и пороги в `_compute_simple_health`; пороги цвета — `_color_for_score` (70/40); причины оттока — `VOLUNTARY_REASONS`/`INVOLUNTARY_REASONS`.
- **Подводные камни:** **двойственный источник данных** — `/mrr` сначала считает по `subscriptions`, и только если их нет, делает derive из `tenant_licenses × PLAN_PRICES_RUB` (поле `source` в ответе говорит, какой использован). Health-score целиком на **raw SQL с PostgreSQL-синтаксисом** (`COUNT(*) FILTER`, `date_trunc`) — на SQLite не работает. Дублирует логику churn/health из `admin.py` (две реализации того же — следить за рассинхроном; список причин оттока тут шире: добавлен `non_payment`). `regex=` в `Query` — старый параметр (в новых Pydantic — `pattern=`).
- **Строк:** 558

## `backend/app/routers/admin_api_quotas.py`
- **Назначение:** Управление API-квотами тенантов (rate limit, storage, users, calls/мес): список с текущим usage, алерты по превышению порога, детали с историей, обновление лимитов, сброс счётчиков.
- **Ключевые элементы:** схемы `QuotaOut`/`UsageOut`/`TenantQuotaRow`/`QuotaPatchIn`/`QuotaDetailsOut`/`QuotaAlertOut`; helpers `_empty_usage()`, `_usage_to_out()`. `router` с `prefix="/admin/quotas"`.
- **Эндпоинты:**

| Метод | Путь (`/admin/quotas`) | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `` | super_admin | — | `list[TenantQuotaRow]` | Все тенанты + квоты + сегодняшний usage |
| GET | `/alerts` | super_admin | `threshold=0.8` | `list[QuotaAlertOut]` | Тенанты выше порога лимита |
| GET | `/{tenant_id}` | super_admin | — | `QuotaDetailsOut` | Квота + usage + история 30д |
| PUT | `/{tenant_id}` | super_admin | `QuotaPatchIn` | `QuotaOut` | Обновить квоты (создаёт строку) |
| POST | `/{tenant_id}/reset` | super_admin | — | dict | Сброс usage (Redis + строка сегодня) |

- **Зависимости:** `app.models.api_quota` (TenantQuota, QuotaUsage + DEFAULT_* константы), `app.services.quota_service` (get_quota/get_usage/list_history/reset_usage), `app.config.settings`, `redis.asyncio`, `app.core.deps.require_super_admin`.
- **Где менять для типовых задач:** дефолтные лимиты — константы `DEFAULT_*` в `app/models/api_quota.py` (не здесь); порог алертов — параметр `threshold`; новая метрика квоты — расширить модель + схемы + цикл алертов (строки 242-258).
- **Подводные камни:** если у тенанта нет строки `tenant_quotas`, выдаются **дефолты с `plan_default=True`** (не персистятся, пока не сделают PUT). PUT с любым изменением значений автоматически ставит `plan_default=False`, если клиент явно не задал его. Месячные звонки в `/alerts` считаются `SUM(calls_minutes_used)` за `[month_start, today]`, остальные метрики — за сегодня. `reset` дёргает Redis — соединение открывается/закрывается в try/finally, ошибки Redis проглатываются (graceful degrade).
- **Строк:** 347

## `backend/app/routers/admin_arr_ltv.py`
- **Назначение:** Тонкий read-only роутер расширенной финаналитики: ARR/MRR summary с MoM, retention-когорты, LTV (avg/median/p90), линейный прогноз MRR. Вся математика — в сервисе.
- **Ключевые элементы:** 4 хендлера-обёртки (`arr_ltv_summary`, `arr_ltv_cohorts`, `arr_ltv_summary_ltv`, `arr_ltv_forecast`). `router` с `prefix="/admin/arr-ltv"`.
- **Эндпоинты:**

| Метод | Путь (`/admin/arr-ltv`) | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/summary` | super_admin | — | dict | ARR/MRR + MoM-рост + хвост истории |
| GET | `/cohorts` | super_admin | `months` (1..36) | dict | Retention-матрица по когортам |
| GET | `/ltv` | super_admin | — | dict | avg/median/p90 LTV + by_plan |
| GET | `/forecast` | super_admin | `months_ahead` (1..24), `window` (3..36) | dict | Линейный прогноз MRR |

- **Зависимости:** `app.services.arr_ltv_service` (`compute_arr`, `compute_cohort_ltv`, `compute_ltv_summary`, `compute_forecast`, `compute_mrr_history`), `app.core.deps.require_super_admin`.
- **Где менять для типовых задач:** любые расчёты ARR/LTV/когорт/прогноза — **в `arr_ltv_service.py`**, не в роутере (он только валидирует параметры и делегирует); MoM-формула — в `arr_ltv_summary` (единственная логика прямо здесь).
- **Подводные камни:** полностью read-only, без записи в БД и фоновых задач (поэтому в main.py — обычный `include_router`). **Сознательно не пересекается** с `/admin/analytics/mrr` (docstring это подчёркивает) — две разные точки MRR, источники могут расходиться. MoM возвращает `None` при `prev=0` (фронт показывает «—»).
- **Строк:** 104

## `backend/app/routers/admin_cost_attribution.py`
- **Назначение:** Себестоимость тенантов (storage/API/db-rows/calls → est_cost_rub): топ-N тяжёлых тенантов за период, платформенный summary, детали+история тенанта, ручной запуск снапшота за месяц.
- **Ключевые элементы:** helpers `_normalize_period()` (→ 1-е число месяца), `_latest_snapshot_period()`, `_serialize_snapshot()`; хендлеры `top_tenants`, `summary`, `tenant_detail`, `trigger_snapshot`. `router` с `prefix="/admin/cost-attribution"`.
- **Эндпоинты:**

| Метод | Путь (`/admin/cost-attribution`) | Доступ | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/` | super_admin | `period?`, `limit` (1..200) | `list[dict]` | Топ-N тенантов по est_cost за период |
| GET | `/summary` | super_admin | `period?` | dict | Total/avg cost + самый тяжёлый тенант |
| GET | `/{tenant_id}` | super_admin | — | dict | Текущий снимок + история 12 периодов |
| POST | `/snapshot` | super_admin | `period?` | dict (201) | Запустить snapshot_all на период |

- **Зависимости:** `app.models.cost_attribution.TenantCostSnapshot`, `app.models.tenant.Tenant`, `app.services.cost_service.snapshot_all`, `app.core.deps.require_super_admin`.
- **Где менять для типовых задач:** формула себестоимости и сбор снапшота — **в `cost_service.snapshot_all`**, не здесь; что отдаётся наружу — `_serialize_snapshot`; «период по умолчанию» — `_normalize_period` (всегда 1-е число месяца) + `_latest_snapshot_period` (если period не задан — берётся последний доступный).
- **Подводные камни:** период всегда нормализуется к **первому числу месяца** (помесячные снапшоты). Если снапшотов нет вовсе — `top_tenants` → `[]`, `summary` → нули, `tenant_detail.current` → null (не падает). `est_cost_rub` — `Decimal` в модели, наружу `float(...)`. `POST /snapshot` — единственная пишущая операция; обычно дёргается шедулером, эндпоинт даёт ручной триггер.
- **Строк:** 199
