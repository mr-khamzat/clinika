# routers [06] — франшиза-видимость, гео, импersonation, интеграции, межклиничные счета, склад (3 файла), реестр, лояльность, LTV + 4 manager-роутера

Это разнородный срез 15 роутеров FastAPI (backend МИС clinika). Несмотря на разные домены, у группы есть несколько сквозных закономерностей, которые важно держать в голове при правках:

- **Tenant-изоляция** — почти все запросы фильтруются `WHERE tenant_id == current_user.tenant_id`. Источник `tenant_id` различается: где-то берётся напрямую из `User` (`inventory*`, `ledger`, `manager/*`, `inter_clinic_invoices`), где-то — через `Depends(get_current_tenant)` который отдаёт объект `Tenant` (`loyalty`, `ltv`). Это две разные модели резолва — не путать.
- **Модульные / фичефлаговые гейты** — `inventory*` сидят за `require_module("inventory")`, `loyalty` — за `require_module("loyalty_pro")`, `ltv` — за `require_module("ltv_pro")`, `ledger` — за `require_feature("financial_ledger")`.
- **Decimal vs float** — деньги/количества в моделях хранятся как `Decimal`, но многие роутеры (`ledger`, `inter_clinic_invoices`, `ltv`) сериализуют их в `float(...)` в ответе. На вход денег используйте `Decimal(str(x))`, а не `Decimal(float)`.
- **Все хендлеры `async`**, БД-сессия — `AsyncSession`, каждый запрос обязан `await`. `commit()` делается в роутере (сервисы обычно только `add/flush`).
- **Префиксы** берутся либо из `APIRouter(prefix=...)` самого файла, либо навешиваются при монтировании в `main.py`. Четыре `manager/*` файла монтируются внутри родительского `APIRouter(prefix="/manager")` (см. `app/routers/manager/__init__.py`), поэтому их фактические пути — `/manager/...`.

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|---|---|---|
| `franchise_visibility.py` | Матрица видимости чат/звонки между клиниками франшизы | 152 |
| `geo.py` | Список городов + инфо об устройстве/IP | 57 |
| `impersonation.py` | Вход super_admin под видом пользователя (RFC 8693) | 491 |
| `integrations.py` | Вебхук от МИС: авто-подтверждение направления | 129 |
| `inter_clinic_invoices.py` | Межклиничные счета: workflow согласования/оплаты, реквизиты, печать | 536 |
| `inventory.py` | Учёт расходников: items/stocks/movements/alerts | 952 |
| `inventory_batches.py` | Поставщики, документы приходов, FIFO-партии | 660 |
| `inventory_import.py` | Импорт остатков из Excel/CSV 1С + откат | 649 |
| `ledger.py` | Финансовый реестр баланса пользователей + выплата | 245 |
| `loyalty.py` | Программа лояльности: баллы/тиры/правила/награды | 759 |
| `ltv.py` | LTV-аналитика пациентов + экспорт PDF/XLSX/CSV | 600 |
| `manager/activity.py` | Журнал активности системы (чтение лога) | 60 |
| `manager/analytics_retention.py` | Возвратность пациентов по врачам | 298 |
| `manager/bonuses_mgmt.py` | Выплата бонусов + согласование отмены направлений | 206 |
| `manager/clinics_access.py` | Резолв доступных пользователю клиник (scope-хелперы) | 200 |

---

## `backend/app/routers/franchise_visibility.py`

- **Назначение:** Управление матрицей видимости (чат/звонки) между парами клиник одной франшизы. Если для пары `(viewer, target)` записи нет — видимость разрешена по умолчанию.
- **Ключевые элементы:** хелперы `_require_franchise_admin(user)`, `_franchise_tenants(db, user)`; Pydantic `VisibilityCellIn`, `VisibilityMatrixIn`; хендлеры `get_matrix`, `set_matrix`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/franchise/visibility` | super_admin, franchise_owner | — | `{tenants[], cells[]}` | Полная матрица (отсутствующие пары = default true/true) |
| PUT | `/franchise/visibility` | super_admin, franchise_owner | `VisibilityMatrixIn` | `{status, updated}` | Полная замена: upsert/удаление ячеек |

- **Зависимости:** `models.user.User/UserRole`, `models.tenant.Tenant`, `models.tenant_visibility.TenantVisibility`, `core.deps.get_current_user`, `database.get_db`. Сервисного слоя нет — вся логика в роутере.
- **Где менять для типовых задач:** добавить новый флаг видимости (например `allow_video`) — правь `VisibilityCellIn`, обе ветки в `set_matrix` (создание/обновление/«is_default»), формирование `full_cells` в `get_matrix` и модель `TenantVisibility`. Сменить дефолт видимости с «разрешено» на «запрещено» — переписать логику `is_default` и блок генерации отсутствующих пар.
- **Подводные камни:** Запись с `allow_chat=true AND allow_calls=true` удаляется (default трактуется отсутствием строки) — нельзя «явно» хранить полное разрешение. Франшиза определяется через `Tenant.franchise_id` пользователя; если у тенанта нет `franchise_id` — возвращается пусто/400. Tenant-изоляция тут не по `tenant_id`, а по `franchise_id` (проверка `in tids_set` в обе стороны).
- **Строк:** 152

## `backend/app/routers/geo.py`

- **Назначение:** Справочник городов для UI-селекторов и информация об устройстве/IP текущего запроса.
- **Ключевые элементы:** Pydantic `CityOut`; хендлеры `list_cities`, `device_info`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/geo/cities` | любой авторизованный | `?search` | `list[CityOut]` | Активные города, опц. поиск по имени (ilike) |
| GET | `/geo/device` | любой авторизованный | — (Request) | `{device_info, client_ip, user_agent}` | Парсинг UA + IP клиента |

- **Зависимости:** `models.city.City`, `utils.geo.get_client_ip`, `utils.device.get_device_info`, `core.deps.get_current_user`, `database.get_db`.
- **Где менять для типовых задач:** новое поле города в ответе — `CityOut`. Изменить парсинг IP за прокси — `utils/geo.py` (не здесь). Добавить фильтр по региону/стране — добавить Query-параметры в `list_cities` и `.where(...)`.
- **Подводные камни:** `City.is_active == True` — сравнение с литералом (а не `.is_(True)`), работает, но стилистически легаси. Без tenant-фильтра: города — глобальный справочник. `latitude/longitude` — `Optional[float]`.
- **Строк:** 57

## `backend/app/routers/impersonation.py`

- **Назначение:** Позволяет super_admin временно работать «под видом» другого пользователя через короткоживущий JWT с claim'ами `imp/act` (паттерн RFC 8693 Token Exchange). Все действия пишутся в audit_log.
- **Ключевые элементы:** константы `IMPERSONATION_TOKEN_TTL_MIN=30`, `AUDIT_IMP_STARTED/STOPPED`; хелперы `_decode_current`, `_create_impersonation_token`, `_create_restore_token`, `_is_super_admin`, `_tenant_slug`, `_redirect_url_for`; Pydantic `ImpersonateRequest/Response/StopResponse`; хендлеры `start_impersonation`, `stop_impersonation`, `active_impersonation`, `impersonation_history`.
- **Эндпоинты:** (префикс `/admin/impersonate`)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| POST | `/admin/impersonate` | super_admin | `ImpersonateRequest` + Bearer | `ImpersonateResponse` | Выпустить imp-токен под target |
| POST | `/admin/impersonate/stop` | носитель imp-токена | Bearer (imp=true) | `ImpersonateStopResponse` | Вернуться в super_admin по claim `act` |
| GET | `/admin/impersonate/active` | носитель токена | Bearer | `{active, target, actor, reason, expires_at}` | Состояние для баннера UI |
| GET | `/admin/impersonate/history` | super_admin | `?days&limit` | `{total, days, items[]}` | Сессии started↔stopped из audit_log |

- **Зависимости:** `config.settings`, `core.deps.get_current_user`, `core.security` (`create_access_token`, `decode_token`, `ACCESS_TOKEN_EXPIRE_MINUTES`), `jose.jwt`, `models.audit.AuditEntry`, `models.tenant.Tenant`, `models.user.User/UserRole`, `services.audit_service.write_safe`.
- **Где менять для типовых задач:** изменить срок жизни imp-сессии — `IMPERSONATION_TOKEN_TTL_MIN`. Куда редиректить после входа — `_redirect_url_for` (роль→URL). Запретить импersonate новой роли — добавить проверку в `start_impersonation`. Структура claim'ов — `_create_impersonation_token`.
- **Подводные камни:** Токен подписывается **вручную** через `jwt.encode` (НЕ `create_access_token`) — при смене алгоритма/секрета в `core.security` правьте и тут. Запрет вложенного импersonate (`imp=true → 409`). Импersonate пациента требует `confirm_sensitive=true` (иначе 428, ФЗ-152). `stop` валидирует, что оригинальный actor всё ещё активен и super_admin. `history` парно сшивает события из `AuditEntry` в памяти (берёт `limit*2` строк) — при большой нагрузке возможны пропуски пар. В комментарии есть опечатка «обуэн».
- **Строк:** 491

## `backend/app/routers/integrations.py`

- **Назначение:** Входящий вебхук от внешней МИС: при событии «пациент пришёл на приём» автоматически подтверждает направление (`Referral`) и начисляет бонусные баллы автору.
- **Ключевые элементы:** Pydantic `MISWebhookPayload`; хендлер `mis_webhook`.
- **Эндпоинты:** (префикс `/integrations`)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| POST | `/integrations/mis/webhook` | по `X-Api-Key` (не JWT) | `MISWebhookPayload` + Header `X-Api-Key` | `{status, referral_id?, method?}` | Авто-подтверждение направления |

- **Зависимости:** `models.referral.Referral/ReferralStatus`, `models.clinic.Clinic`, `config.settings.webhook_api_key`, `utils.phone.phone_variants`; ленивые импорты `services.qr_service.generate_qr_data`, `services.referral_service.confirm_referral`, `services.loyalty_ext_service.award_referral`. Пишет в таблицу `mis_integration_log` сырым SQL (`text`).
- **Где менять для типовых задач:** новый тип события — расширить ветвление по `payload.event` (сейчас обрабатывается только `patient_visited`). Логика сопоставления направления — два «способа»: по `referral_id` (через QR) и по телефону (`phone_variants` + опц. клиника по `mis_id`). Сменить авторизацию вебхука — проверка `x_api_key != settings.webhook_api_key`.
- **Подводные камни:** Аутентификация — статический ключ из `.env`, НЕ JWT. Лог пишется сырым `INSERT ... mis_integration_log` (нет ORM-модели — при правках схемы синхронизировать вручную). Начисление лояльности обёрнуто в `try/except: pass` (молча глотает ошибки). Поиск по телефону берёт первое `CREATED` направление (`order_by created_at desc limit 1`) — при дублях возможна неоднозначность. Несколько `commit()` подряд в одном запросе.
- **Строк:** 129

## `backend/app/routers/inter_clinic_invoices.py`

- **Назначение:** Межклиничные счета (одна клиника выставляет другой за направление/услугу). Реализует workflow draft→sent→pending_approval→approved→paid с согласованием руководителем, реквизиты тенанта, загрузку печати и данные для печати акта.
- **Ключевые элементы:** наборы ролей `MANAGER_ROLES/SUPERVISOR_ROLES/APPROVER_ROLES/PAYER_ROLES`; гварды `_require_manager/_require_approver/_require_payer/_require_supervisor`; сериализатор `_ici_out`, обогатитель `_enrich`; Pydantic `CreateICIRequest`, `RequisitesBody`; константа `STAMP_DIR="/app/uploads/stamps"`; ~13 хендлеров.
- **Эндпоинты:** (роутер БЕЗ префикса — пути монтируются как есть)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/clinic-invoices/incoming` | manager+ | `?status,limit,offset` | `list[dict]` | Входящие (тенант-плательщик) |
| GET | `/clinic-invoices/outgoing` | manager+ | `?status,limit,offset` | `list[dict]` | Исходящие (тенант-получатель) |
| GET | `/clinic-invoices/all` | super_admin (supervisor) | `?status,limit,offset` | `list[dict]` | Все счета тенанта/платформы |
| POST | `/clinic-invoices` | manager+ | `CreateICIRequest` | `dict` (201) | Создать вручную (auto_send) |
| PATCH | `/clinic-invoices/{id}/send` | manager+ (только выставитель) | — | `dict` | draft→sent |
| PATCH | `/clinic-invoices/{id}/approve` | approver (плательщик) | — | `dict` | Согласовать (снэпшот ФИО) |
| PATCH | `/clinic-invoices/{id}/reject` | approver (плательщик) | `{reason?}` | `dict` | Отклонить |
| PATCH | `/clinic-invoices/{id}/pay` | payer (бухгалтер+) | — | `dict` | →paid (нужен approved) |
| PATCH | `/clinic-invoices/{id}/cancel` | manager+ (выставитель) | — | `dict` | Отменить |
| GET | `/admin/clinic-invoices` | super_admin | `?status,tenant_id,limit,offset` | `list[dict]` | Все счета платформы |
| POST | `/stamp/upload` | supervisor | `UploadFile` | `{ok, stamp_url}` | Загрузить печать тенанта |
| GET | `/stamps/{filename}` | manager+ | — | `FileResponse` | Отдать файл печати |
| GET | `/clinic-invoices/{id}/act` | manager+ | — | `{invoice, issuer, recipient}` | Данные акта для печати |
| GET/PATCH | `/requisites` | supervisor | `RequisitesBody` (PATCH) | реквизиты / `{ok}` | Реквизиты тенанта |

- **Зависимости:** `services.inter_clinic_invoice_service` (`list_incoming/outgoing/all_*`, `create_inter_clinic_invoice`, `mark_sent/approved/rejected/paid/cancelled`); `models.inter_clinic_invoice.InterClinicInvoice/ICIStatus`, `models.clinic.Clinic`, `models.tenant.Tenant`, `models.user.User/UserRole`; ленивый `services.alert_service.notify_big_invoice`.
- **Где менять для типовых задач:** новый статус/переход — добавить хендлер `PATCH /.../{id}/<action>` + метод в сервисе + проверку `inv.status not in (...)`. Поле счёта в ответе — `_ici_out`. Новые реквизиты для печати — `RequisitesBody`, `tenant_req()` внутри `get_invoice_act` и `get_requisites`, плюс модель `Tenant`. Порог уведомления о крупном счёте (>100k) — в `create_clinic_invoice`.
- **Подводные камни:** Роутер без префикса — пути абсолютны, легко словить коллизию (например `/requisites`). `amount` сериализуется как `float(inv.amount)` — Decimal→float (потеря точности на больших суммах). IDOR-проверки повторяются вручную в каждом хендлере (`issuer_tenant_id`/`recipient_tenant_id` vs `current_user.tenant_id`) — при добавлении хендлера легко забыть. `pay` принимает legacy-статусы `SENT/DRAFT` «для обратной совместимости» — обходит требование согласования. Множество `from app.models...` импортов внутри функций (легаси-стиль). `STAMP_DIR` хардкод `/app/uploads/stamps` (привязка к docker-пути). Согласование approve требует, чтобы счёт был адресован тенанту согласующего (`recipient_tenant_id`).
- **Строк:** 536

## `backend/app/routers/inventory.py`

- **Назначение:** Базовый учёт расходников/оборудования (W7): номенклатура (items), остатки (stocks по batch), движения (income/outgoing/transfer/write-off), инвентаризация и алерты (low_stock/expiring/expired). Это **ядро складского модуля** — `inventory_batches.py` и `inventory_import.py` переиспользуют его хелперы.
- **Ключевые элементы:** хелперы `_require_tenant`, `_verify_clinic`, `_verify_item`, `_get_or_create_stock`, **`_record_movement`** (центральная функция проводки delta→stock+movement, экспортируется в другие роутеры); множество Pydantic-схем (`ItemIn/Patch/Out/DetailOut`, `StockOut/WithItemOut`, `MovementOut`, `IncomeIn/OutgoingIn/TransferIn/WriteOffIn`, `AlertItem/AlertsOut`, `StockCountIn/Line`).
- **Эндпоинты:** (префикс `/inventory`, весь роутер за `require_module("inventory")`)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/inventory/items` | авторизованный (tenant) | фильтры+пагинация | `{total, items[]}` | Список номенклатуры |
| POST | `/inventory/items` | require_manager | `ItemIn` | `ItemOut` (201) | Создать (SKU уникален в тенанте) |
| GET | `/inventory/items/{id}` | авторизованный | — | `ItemDetailOut`+stocks | Карточка + остатки |
| PATCH | `/inventory/items/{id}` | require_manager | `ItemPatch` | `ItemOut` | Редактировать |
| DELETE | `/inventory/items/{id}` | require_manager | — | `{ok, id}` | Soft-delete (is_active=False) |
| POST | `/inventory/items/import-csv` | require_manager | `UploadFile` | `{created, skipped, errors}` | Импорт номенклатуры из CSV |
| GET | `/inventory/stocks` | авторизованный | фильтры | `{total, stocks[]}` | Остатки + поля item |
| POST | `/inventory/stocks/count` | require_manager | `StockCountIn` | `{ok, adjusted}` | Инвентаризация (ADJUSTMENT) |
| GET | `/inventory/movements` | авторизованный | фильтры | `{total, movements[]}` | Журнал движений |
| POST | `/inventory/movements/income` | require_manager | `IncomeIn` | `MovementOut` (201) | Приход (+qty) |
| POST | `/inventory/movements/outgoing` | require_manager | `OutgoingIn` | `MovementOut` (201) | Расход (−qty) |
| POST | `/inventory/movements/transfer` | require_manager | `TransferIn` | `{out, in}` (201) | Перемещение (двойная проводка) |
| POST | `/inventory/movements/write-off` | require_manager | `WriteOffIn` | `MovementOut` (201) | Списание/просрочка |
| GET | `/inventory/alerts` | авторизованный | `?expiring_days` | `AlertsOut` | low_stock + expiring + expired |

- **Зависимости:** `models.inventory.*` (`InventoryItem/Stock/Movement/MovementType/Category`), `models.clinic.Clinic`, `core.deps.get_current_user/require_manager`, `core.tenant.require_module`. Сервисного слоя нет — логика проводок в самом роутере.
- **Где менять для типовых задач:** новый тип движения — расширить `InventoryMovementType` (модель) + добавить хендлер `POST /movements/<x>` по образцу + вызвать `_record_movement` с нужным знаком delta. Логика остатка/баланса — `_record_movement` и `_get_or_create_stock` (правка тут влияет и на `inventory_import.py`!). Новое поле item — `ItemIn/Patch/Out` + модель. Новый вид алерта — функция `alerts`.
- **Подводные камни:** Остатки хранятся **по (item, clinic, batch_number)** — пустой batch это `""`, не NULL. `_record_movement` проверяет `new_qty < 0` → 409, но НЕТ блокировки строки (`SELECT ... FOR UPDATE`) — гонка при параллельных расходах теоретически возможна. `balance_after` тут = остаток конкретной (item,clinic,batch) пары после движения (в `inventory_batches.post_receipt` — наоборот, суммарный по item/clinic — несогласованность семантики!). Decimal повсюду — суммы/qty `Decimal`, `cost_per_unit` `Decimal`. `low_stock` alert берёт только items с `min_stock_threshold > 0`. Transfer создаёт две movement-записи и связывает их через `ref_entity_id`.
- **Строк:** 952

## `backend/app/routers/inventory_batches.py`

- **Назначение:** Этап 1 INVENTORY_COST_PLAN: поставщики (Supplier), документы приходов (InventoryReceipt, draft→posted) и FIFO-партии (InventoryBatch с `unit_cost`/`qty_remaining`). Проведение документа создаёт movements и обновляет кеш-остатки.
- **Ключевые элементы:** хелперы `_require_tenant`, `_verify_clinic`, `_verify_item`, `_verify_receipt`; Pydantic `SupplierIn/Patch/Out`, `ReceiptItemIn`, `ReceiptIn/Patch/Out`, `BatchOut`, `BatchWriteoffIn`; ~14 хендлеров.
- **Эндпоинты:** (префикс `/inventory`, за `require_module("inventory")`)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/inventory/suppliers` | require_manager | `?search,is_active` | `list[SupplierOut]` | Список поставщиков |
| POST | `/inventory/suppliers` | require_manager | `SupplierIn` | `SupplierOut` (201) | Создать (имя уникально) |
| GET | `/inventory/suppliers/{id}` | require_manager | — | `SupplierOut` | Карточка |
| PATCH | `/inventory/suppliers/{id}` | require_manager | `SupplierPatch` | `SupplierOut` | Редактировать |
| DELETE | `/inventory/suppliers/{id}` | require_manager | — | 204 | Soft-delete |
| GET | `/inventory/receipts` | require_manager | фильтры (from/to/supplier/clinic/status) | `list[ReceiptOut]` | Документы приходов |
| POST | `/inventory/receipts` | require_manager | `ReceiptIn` | `ReceiptOut` (201) | Создать черновик |
| GET | `/inventory/receipts/{id}` | require_manager | — | `ReceiptOut` | Документ |
| PATCH | `/inventory/receipts/{id}` | require_manager | `ReceiptPatch` | `ReceiptOut` | Правка (только draft) |
| POST | `/inventory/receipts/{id}/items` | require_manager | `ReceiptItemIn` | `BatchOut` (201) | Добавить партию-черновик |
| DELETE | `/inventory/receipts/{id}/items/{bid}` | require_manager | — | 204 | Удалить позицию из draft |
| POST | `/inventory/receipts/{id}/post` | require_manager | — | `ReceiptOut` | Провести (создать movements+stocks) |
| POST | `/inventory/receipts/{id}/cancel` | require_manager | — | `ReceiptOut` | Отменить (нельзя posted) |
| GET | `/inventory/batches` | require_manager | фильтры (item/clinic/expiring/active/receipt) | `list[BatchOut]` | Партии (FIFO-сортировка) |
| GET | `/inventory/batches/{id}` | require_manager | — | `BatchOut` | Партия |
| POST | `/inventory/batches/{id}/writeoff` | require_manager | `BatchWriteoffIn` | result-dict | Ручное списание из партии |
| Прочее | `/inventory/...` | | | | |

- **Зависимости:** `models.inventory.*` (`Supplier`, `InventoryReceipt`, `InventoryBatch`, `InventoryItem/Stock/Movement/MovementType`), `models.clinic.Clinic`, `services.inventory_fifo` (`writeoff_from_batch`, `InsufficientStockError`), `core.deps.require_manager`, `core.tenant.require_module`.
- **Где менять для типовых задач:** логика FIFO-списания из партий — в `services/inventory_fifo.py` (не здесь; роутер только ловит `InsufficientStockError`/`ValueError`). Логика проведения документа (расчёт `total`, создание движений) — `post_receipt`. Новое поле приходного документа/партии — `ReceiptIn/Out`/`ReceiptItemIn`/`BatchOut` + модели.
- **Подводные камни:** `post_receipt` НЕ использует `_record_movement` из `inventory.py` (своя реализация) — `balance_after` тут = **суммарный остаток по item/clinic** (в `inventory.py` — по batch). Это разная семантика `balance_after` между двумя роутерами одного модуля — при отчётности учитывать. Проведённый документ нельзя отменить (только сторно отрицательным). `total_amount` пересчитывается инкрементально при add/remove позиции (риск рассинхрона при ошибках). FIFO-сортировка batches: `expires_at asc nullslast, received_at asc`.
- **Строк:** 660

## `backend/app/routers/inventory_import.py`

- **Назначение:** Этап 0: импорт остатков и номенклатуры из Excel/CSV (выгрузки 1С). Парсинг файла, авто-маппинг колонок (RU/EN), превью, выполнение импорта (создание items + INCOME-движения), история и мягкий откат.
- **Ключевые элементы:** словари `COLUMN_MAPPING_HINTS`, `CATEGORY_HINTS`; парсеры `_parse_xlsx`, `_parse_csv`, утилиты `_norm`, `_auto_map`, `_cell`, `_parse_decimal`, `_parse_date`, `_detect_category`; Pydantic `PreviewResponse`, `ExecuteResult`, `HistoryRow`; хендлеры `preview_import`, `execute_import`, `list_history`, `rollback_import`.
- **Эндпоинты:** (префикс `/inventory/import`, за `require_module("inventory")`)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| POST | `/inventory/import/preview` | require_manager | `UploadFile` + `sheet_name?` | `PreviewResponse` | Заголовки + automapping + 10 строк |
| POST | `/inventory/import/execute` | require_manager | multipart (file, clinic_id, mapping JSON, strategy, defaults) | `ExecuteResult` | Импорт по маппингу |
| GET | `/inventory/import/history` | авторизованный (tenant) | `?limit,offset` | `{total, items[]}` | История импортов |
| POST | `/inventory/import/{id}/rollback` | require_manager | — | `{status, reversed_movements, deactivated_items, failed}` | Мягкий откат |

- **Зависимости:** `openpyxl`, `models.inventory.*` (включая `InventoryImportLog`), `models.clinic.Clinic`; **переиспользует `app.routers.inventory._record_movement` и `_require_tenant`** (прямой импорт из соседнего роутера).
- **Где менять для типовых задач:** добавить распознаваемую колонку — `COLUMN_MAPPING_HINTS` (синонимы) и обработку в `execute_import`. Новую категорию-синоним — `CATEGORY_HINTS`. Новый формат файла — добавить парсер по образцу `_parse_xlsx/_parse_csv` и ветку детекта в `preview_import`/`execute_import`. Стратегия дублей (`skip/update/replace`) — блок `if existing:` в `execute_import`.
- **Подводные камни:** Прямая зависимость от `inventory._record_movement` — изменение его сигнатуры/логики проводки ломает импорт. Откат (`rollback`) создаёт WRITE_OFF на каждую INCOME-запись с `ref_entity_id=import_id` и деактивирует items без иных outgoing-движений — НЕ восстанавливает прежнее состояние точно (это «мягкий» откат). `_parse_decimal` глушит ошибки → `Decimal("0")` (тихая потеря данных при кривом числе). CSV-кодировка автодетектится (utf-8-sig/utf-8/cp1251). `existing_strategy='replace'` перезаписывает category и cost даже при 0. Статус `completed` ставится даже при частичных ошибках, если хоть что-то создано/обновлено.
- **Строк:** 649

## `backend/app/routers/ledger.py`

- **Назначение:** Финансовый реестр (этап 6 SaaS): баланс бонусов/начислений пользователя (append-only записи), сводка по типам операций, ручная корректировка и выплата бонуса.
- **Ключевые элементы:** `_feature = Depends(require_feature("financial_ledger"))`; Pydantic `LedgerEntryOut`, `LedgerSummaryOut`, `AdjustRequest`; хендлеры `my_balance`, `my_summary`, `my_history`, `user_balance`, `user_history`, `manual_adjust`, `payout_bonus`.
- **Эндпоинты:** (префикс `/ledger`, всё за `require_feature("financial_ledger")`)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/ledger/balance` | авторизованный | — | `{user_id, balance, pending}` | Свой баланс |
| GET | `/ledger/summary` | авторизованный | — | `LedgerSummaryOut` | Своя сводка по типам |
| GET | `/ledger/history` | авторизованный | `?limit,offset` | `list[LedgerEntryOut]` | Своя история |
| GET | `/ledger/users/{id}/balance` | require_manager | — | `{balance, pending, ...summary}` | Баланс пользователя |
| GET | `/ledger/users/{id}/history` | require_manager | `?limit,offset` | `list[LedgerEntryOut]` | История пользователя |
| POST | `/ledger/adjust` | require_manager | `AdjustRequest` | entry-dict | Ручная корректировка (±) |
| POST | `/ledger/payout/{bonus_id}` | require_manager | — | `{id, status, paid_at, amount}` | Выплата бонуса (PENDING→PAID) |

- **Зависимости:** `services.ledger_service` (`get_balance/pending_balance/summary/history/add_entry`, enum `OpType`), `services.audit_service.write_safe` + `AuditAction`, `core.tenant.require_feature`, `core.deps.require_manager`; ленивые `services.bonus_service.mark_bonus_paid`, `models.bonus.Bonus`.
- **Где менять для типовых задач:** новый тип операции — `OpType` (в `ledger_service`) + обработка в `add_entry`. Логика расчёта баланса — `ledger_service` (не здесь). Новый менеджерский отчёт — добавить хендлер по образцу `user_balance` с tenant-проверкой target.
- **Подводные камни:** `amount` хранится Decimal, но в ответе `float(...)` и на вход `AdjustRequest.amount` это `float` → `Decimal(str(body.amount))` (правильно, через str). Tenant-изоляция реализована вручную в каждом менеджерском хендлере: загрузка `target` и сравнение `target.tenant_id != current_user.tenant_id` (если у менеджера `tenant_id is not None`). В `payout_bonus` сравнение роли через строку `"super_admin"` (а не enum) — хрупко. `manual_adjust` запрещает `amount == 0`.
- **Строк:** 245

## `backend/app/routers/loyalty.py`

- **Назначение:** Программа лояльности пациентов (этап 11): аккаунты с баллами, append-only транзакции, тиры (bronze/silver/...), правила автоначисления, каталог наград и обмен баллов. Курс: 1 балл = 100 ₽.
- **Ключевые элементы:** `RUB_PER_POINT=Decimal("100")`; хелперы `_tenant_id`, `_get_or_create_account`, `_recalculate_tier`; Pydantic-схемы для accounts/transactions/tiers/rules/rewards (`LoyaltyAccountOut`, `EarnRequest`, `RedeemRequest`, `TierCreateRequest`, `LoyaltyRuleIn/Out`, `LoyaltyRewardIn/Out`, `ExchangeRequest`, `TierWithTopOut`); ~22 хендлера.
- **Эндпоинты:** (префикс `/loyalty`; платные за `require_module("loyalty_pro")`)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/loyalty/account/{phone}` | manager+ +module | — | `LoyaltyAccountOut` | Баланс пациента (создаёт пустой) |
| GET | `/loyalty/transactions/{phone}` | manager+ +module | `?limit` | `list[...Out]` | История пациента |
| POST | `/loyalty/earn` | manager+ +module | `EarnRequest` | `LoyaltyAccountOut` | Начислить баллы за оплату |
| POST | `/loyalty/redeem` | manager+ +module | `RedeemRequest` | `LoyaltyAccountOut` | Списать баллы |
| GET | `/loyalty/tiers` | любой авторизованный | — | `list[TierOut]` | Список тиров |
| POST | `/loyalty/tiers` | manager+ +module | `TierCreateRequest` | `TierOut` (201) | Создать тир (имя уникально) |
| PATCH | `/loyalty/tiers/{id}` | manager+ +module | `TierCreateRequest` | `TierOut` | Редактировать тир |
| DELETE | `/loyalty/tiers/{id}` | manager+ +module | — | 204 | Удалить тир |
| GET/POST/PATCH/DELETE | `/loyalty/rules[/{id}]` | manager+ +module | `LoyaltyRuleIn` | `LoyaltyRuleOut` | CRUD правил автоначисления |
| GET/POST/PATCH/DELETE | `/loyalty/rewards[/{id}]` | manager+ +module | `LoyaltyRewardIn` | `LoyaltyRewardOut` | CRUD каталога наград |
| POST | `/loyalty/exchange` | manager+ +module | `ExchangeRequest` | `LoyaltyAccountOut` | Обмен баллов на награду |
| GET | `/loyalty/transactions` | manager+ +module | `?limit,op_type,phone` | `list[...Out]` | Лента всех транзакций тенанта |
| GET | `/loyalty/tiers/with-top` | manager+ +module | `?top_n` | `list[TierWithTopOut]` | Тиры + топ-пациенты |

- **Зависимости:** `models.loyalty.*` (`LoyaltyAccount/Transaction/Tier/Rule/Reward`), `models.tenant.Tenant`, `core.tenant.get_current_tenant/require_module`, `core.deps.get_current_user/require_manager`. Сервисного слоя нет — логика в роутере.
- **Где менять для типовых задач:** курс начисления — `RUB_PER_POINT` (+ формула в `earn_points`). Логика повышения тира — `_recalculate_tier`. Новый тип награды/правила — расширить `reward_type`/`rule_type` (строки) и обработку. Идентификация пациента — по `patient_phone` (нет связи с `Patient.id`).
- **Подводные камни:** Пациент идентифицируется **по телефону** — нет нормализации номера здесь (в отличие от `integrations.phone_variants`), так что разный формат номера = разные аккаунты. `tenant_id` может быть `None` (single-tenant) — `_tenant_id(tenant)` возвращает None, и фильтр `tenant_id == None` это `IS NULL`. Транзакции append-only, но баланс инкрементируется прямой мутацией поля аккаунта (не пересчитывается из транзакций) — риск рассинхрона при сбое между add(txn) и мутацией. `earn` начисляет `int(amount // 100)` — дробные рубли пропадают; сумма < 100 ₽ → 400. `_recalculate_tier` при отсутствии тиров оставляет bronze. `tiers/with-top` делает N+1 запросов (по запросу на каждый тир).
- **Строк:** 759

## `backend/app/routers/ltv.py`

- **Назначение:** LTV-аналитика пациентов (модуль `ltv_pro`): топ по LTV с фильтрами «повторные»/«спящие», когорты, сводные метрики, принудительный пересчёт, экспорт PDF/XLSX и выгрузка контактов (CSV/XLSX). Снапшоты в БД хранятся под горизонт 3 года, остальные горизонты пересчитываются на лету.
- **Ключевые элементы:** `_mgr/_mod` (Depends-гейты); хелперы `_resolve_clinic_scope` (права на клинику), `_days_since`, `_clamp_years`, `_scale_factor`, `_rescale` (пересчёт горизонта), `_content_disposition` (RFC 5987), `_fmt_date_ru`, `_fetch_contacts`, `_build_contacts_csv`, `_build_contacts_xlsx`; константа `_BASE_LTV_HORIZON_YEARS=Decimal("3")`.
- **Эндпоинты:** (префикс `/analytics/ltv`, всё за `require_manager` + `require_module("ltv_pro")`)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/analytics/ltv/patients` | manager+ +module | clinic_id,limit,min_visits,repeat_only,inactive_days,years | `list[dict]` | Топ пациентов по LTV |
| GET | `/analytics/ltv/cohorts` | manager+ +module | `?period=quarter` | cohorts | Когорты по кварталу |
| GET | `/analytics/ltv/summary` | manager+ +module | `?clinic_id,years` | metrics-dict | Сводка KPI |
| POST | `/analytics/ltv/recompute` | manager+ +module | `?clinic_id` | `{ok, updated, ...}` | Пересчёт снапшотов |
| GET | `/analytics/ltv/export/pdf` | manager+ +module | `?clinic_id,period,years` | PDF | Отчёт PDF |
| GET | `/analytics/ltv/export/xlsx` | manager+ +module | `?clinic_id,years` | XLSX | Отчёт Excel |
| GET | `/analytics/ltv/contacts.csv` | manager+ +module | `?clinic_id,min_visits,inactive_days,format` | CSV/XLSX | Выгрузка контактов |

- **Зависимости:** `models.ltv.PatientLtvSnapshot`, `models.tenant.Tenant`, `models.user.User/UserRole`; **`app.routers.manager.clinics_access.get_user_clinic_ids`** (для проверки прав на клинику); `services.ltv_service` (`compute_cohorts`, `compute_ltv_for_clinic`), `services.ltv_export_service` (`generate_ltv_pdf/excel`); `openpyxl` (lazy в `_build_contacts_xlsx`).
- **Где менять для типовых задач:** логика прав на clinic_id — `_resolve_clinic_scope` (использует `get_user_clinic_ids` из `clinics_access`). Базовый горизонт расчёта — `_BASE_LTV_HORIZON_YEARS` + `_rescale`. Поля в выгрузке контактов — `_fetch_contacts` + `_build_contacts_csv`/`_build_contacts_xlsx` (синхронно). Сами метрики LTV — в `services/ltv_service.py` (не здесь).
- **Подводные камни:** В БД лежат значения для 3-летнего горизонта; `years` пересчитывает ЛИНЕЙНО (`× years/3`) — это упрощение, не реальный пересчёт. NetLTV считается только по пациентам с `net_ltv > 0` (через `nullif`), иначе занижалось бы среднее. `_resolve_clinic_scope` для super_admin без выбранного тенанта расширяет accessible через `user.tenant_id` или кидает 403. CSV — UTF-8 BOM + разделитель `;` (для русского Excel). `tenant is None` → большинство хендлеров возвращают пусто/0 (а не 401). Тяжёлые экспорты обёрнуты в `try/except → 500`.
- **Строк:** 600

## `backend/app/routers/manager/activity.py`

- **Назначение:** Чтение журнала активности системы (ActivityLog) для менеджерского кабинета — с пагинацией и фильтром по датам.
- **Ключевые элементы:** один хендлер `get_activity_log`.
- **Эндпоинты:** (родительский префикс `/manager`)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/activity/` | require_manager | `?page,limit,date_from,date_to` | `list[dict]` | Лог событий тенанта |

- **Зависимости:** `models.activity_log.ActivityLog`, `core.deps.require_manager`, `database.get_db`.
- **Где менять для типовых задач:** новые поля в ответе — словарь внутри list-comprehension. Дополнительные фильтры (по `action`/`user_id`) — добавить Query + `filters.append(...)`. Префикс пути задаётся родителем — здесь только `/activity/`.
- **Подводные камни:** Tenant-фильтр применяется только если `current_user.tenant_id is not None` (super_admin без тенанта увидит все строки). Парсинг дат через `datetime.fromisoformat` обёрнут в `try/except: pass` (невалидная дата молча игнорируется). `where = and_(*filters) if filters else True` — при пустых фильтрах `True` (без WHERE).
- **Строк:** 60

## `backend/app/routers/manager/analytics_retention.py`

- **Назначение:** Аналитика возвратности (retention) пациентов по врачам: сколько приёмов, уникальных/первичных/повторных пациентов и retention_rate за период; drill-down по конкретному врачу.
- **Ключевые элементы:** константа `EXCLUDED_STATUSES=("cancelled","no_show","rejected")`; хелпер `_default_period`; Pydantic `DoctorRetentionRow`, `RetentionPatientRow`; хендлеры `doctor_retention`, `doctor_retention_patients`.
- **Эндпоинты:** (родительский `/manager` + локальный prefix `/analytics`)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/analytics/doctor-retention` | require_manager | `?date_from,date_to,clinic_id` | `list[DoctorRetentionRow]` | Возвратность по врачам |
| GET | `/manager/analytics/doctor-retention/{doctor_id}/patients` | require_manager | `?date_from,date_to,clinic_id` | `list[RetentionPatientRow]` | Drill-down пациентов врача |

- **Зависимости:** `models.doctor.Appointment`, `models.doctor.Doctor`, `models.clinic.Clinic`, `models.user.User`, `core.deps.require_manager`. Чистый SQL+aggregate, без сервисов.
- **Где менять для типовых задач:** определение «повторного» пациента — логика `prior_set` (был ли приём к этому же врачу ДО начала периода). Какие статусы исключать — `EXCLUDED_STATUSES`. Период по умолчанию — `_default_period` (сейчас 30 дней). Новые метрики строки — `DoctorRetentionRow` + блок агрегации.
- **Подводные камни:** «Повторный» = был приём к ТОМУ ЖЕ врачу до периода — пара `(doctor_id, patient_phone)`; пациент идентифицируется по телефону. Запрос `prior` использует `tuple_(...).in_(pairs)` — на больших объёмах может быть тяжёлым (в коде есть честный комментарий об этом). Менеджер с `me.clinic_id` и ролью именно `manager` ограничен своей клиникой; franchise_owner — нет. Tenant-фильтр `Appointment.tenant_id == me.tenant_id` обязателен.
- **Строк:** 298

## `backend/app/routers/manager/bonuses_mgmt.py`

- **Назначение:** Менеджерское управление бонусами (отметка оплаты по одному/всем сразу) и обработка запросов на отмену направлений (approve/reject) с корректным каскадом по финансам.
- **Ключевые элементы:** хендлеры `mark_bonus_paid`, `mark_all_paid`, `list_cancel_requests`, `approve_cancel`, `reject_cancel`; защита `enforce_region_lock` на мутациях.
- **Эндпоинты:** (родительский префикс `/manager`)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| PATCH | `/manager/bonuses/{bonus_id}/mark-paid` | require_manager + region_lock | — | `MarkPaidResponse` | Отметить бонус оплаченным |
| POST | `/manager/bonuses/mark-paid-all/{admin_id}` | require_manager + region_lock | — | `{marked_paid}` | Оплатить все PENDING сотрудника |
| GET | `/manager/cancel-requests/` | require_manager | — | `list[dict]` | Запросы на отмену направлений |
| POST | `/manager/cancel-requests/{referral_id}/approve` | require_manager + region_lock | — | `{status: cancelled}` | Подтвердить отмену (каскад) |
| POST | `/manager/cancel-requests/{referral_id}/reject` | require_manager + region_lock | — | `{status: rejected}` | Отклонить запрос отмены |

- **Зависимости:** `models.bonus.Bonus/BonusStatus`, `models.referral.Referral/ReferralStatus`, `models.clinic.Clinic`, `models.service.Service`, `schemas.manager.MarkPaidResponse`, `core.region_lock.enforce_region_lock`, `services.activity_service.log_activity`, `services.audit_service.write_safe`; в `approve_cancel` ленивые `services.bonus_service.mark_bonus_cancelled`, `services.inter_clinic_invoice_service.mark_cancelled`, `models.recruiter_bonus`, `models.inter_clinic_invoice`.
- **Где менять для типовых задач:** каскад при отмене направления (Bonus→CANCELLED + RecruiterBonus + ICI→cancelled + ledger refund) — целиком в `approve_cancel`. Логика выплаты — `mark_bonus_paid`/`mark_all_paid`. Список запросов — `list_cancel_requests`.
- **Подводные камни:** **В `mark_bonus_paid` есть БАГ** — строки 41 и 47 используют необъявленные имена `status`/`amount`/`PAID` как переменные (`before = {status: bonus.status, amount: float(bonus.amount)}` и `after={status: PAID, ...}`). Это `NameError` при выполнении (если только `status`/`amount`/`PAID` не определены глобально — а они не определены в файле). Ключи словаря должны быть строками `"status"`/`"amount"` и значение `BonusStatus.PAID`. Этот хендлер фактически падает — обязательно к исправлению. `approve_cancel` намеренно НЕ удаляет бонус физически (фикс аудита #4): использует `mark_bonus_cancelled` для refund в Ledger + откат platform_fee; каждый каскадный шаг обёрнут в `try/except` с логированием. `reject_cancel` возвращает направление в CONFIRMED если был бонус, иначе CREATED. `list_cancel_requests` делает N+1 запросов (creator/clinics/service на каждое направление). Tenant-проверки вручную.
- **Строк:** 206

## `backend/app/routers/manager/clinics_access.py`

- **Назначение:** Центральный resolver прав доступа пользователя к клиникам (scope). Содержит переиспользуемые хелперы `get_user_clinic_ids` и `resolve_clinic_filter_ids`, на которые опираются LTV/analytics-роутеры, плюс эндпоинт списка клиник для UI-селектора.
- **Ключевые элементы:** **`get_user_clinic_ids(db, user, tenant_id_param)`** и **`resolve_clinic_filter_ids(db, user, clinic_id)`** (импортируются другими модулями, напр. `ltv.py`); хендлер `list_accessible_clinics`.
- **Эндпоинты:** (родительский префикс `/manager`)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/manager/clinics-accessible` | любой авторизованный | `?tenant_id` (override для super_admin) | `list[{id,name,mis_id,is_default}]` | Клиники для селектора |

- **Зависимости:** `models.clinic.Clinic`, `models.franchise.Franchise`, `models.tenant.Tenant`, `models.user.User/UserRole`, `core.deps.get_current_user`; ленивый `models.manager_clinic_access.ManagerClinicAccess`.
- **Где менять для типовых задач:** **любое изменение правил «кто видит какие клиники» — ТОЛЬКО здесь** (это единая точка истины для аналитики). Расширение доступа менеджера к доп. клиникам — таблица `ManagerClinicAccess` (учитывается в `get_user_clinic_ids` для роли MANAGER). Логика выбора клиники по умолчанию для селектора — `list_accessible_clinics`.
- **Подводные камни:** Различайте два хелпера: `get_user_clinic_ids` возвращает СПИСОК доступных id; `resolve_clinic_filter_ids` возвращает `None` (фильтр не накладывать — «видит всё»), `[]` (нет доступа — пустой результат) или `[...]` (WHERE IN) — семантика None vs [] критична, легко перепутать. super_admin без выбранного тенанта → `[]` (UI отдельно показывает выбор тенанта). franchise_owner находится по `Franchise.owner_user_id == user.id`. Блок `ManagerClinicAccess` обёрнут в `try/except: pass` — если модель/таблицы нет, тихо откатывается к `[user.clinic_id]`.
- **Строк:** 200
