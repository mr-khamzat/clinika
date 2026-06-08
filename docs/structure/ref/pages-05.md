# pages [05] — кабинет управляющего: склад, межклиничные счета, KPI, маркетинг, партнёры

Этот срез — 12 страниц-экранов кабинета управляющего (`/manager/*`) фронтенда МИС «КлиникСеть». Все они без исключения завёрнуты в общий каркас `ManagerShell` (`./_ManagerShell`) — он даёт sticky-topbar (title/subtitle/icon/topbarRight), bottom-nav и подсветку активного раздела через проп `active`. По архитектуре страницы делятся на два типа:

1. **Тонкие обёртки** (5-35 строк) — лениво (`lazy`/`Suspense`) подгружают «толстую» секцию из `../sections/*` или `../components/*` и оборачивают её в `ManagerShell`. Вся бизнес-логика живёт в секции, не здесь: `ManagerInvoices`, `ManagerKanban`, `ManagerLab`, `ManagerLoyalty`, `ManagerMarketing`, `ManagerMultiClinic`.
2. **Самодостаточные страницы** с собственным state/CRUD/таблицами — обращаются к `../api` напрямую: `ManagerInventoryReceipts`, `ManagerInventoryReceiptDetail`, `ManagerInvoiceApprovals`, `ManagerKPI`, `ManagerMisWebhooks`, `ManagerPartnerDoctors`.

Общие зависимости: HTTP-клиент `../api` (axios-инстанс с авторизацией; tenant-фильтрация выполняется на бэкенде по токену — в этих файлах `tenant_id` нигде не передаётся вручную), UI-кит `../design` (`Card`, `Button`, `EmptyState`, `Modal`, `Chip`, `Avatar`, `Tabs`, `useToast`), тема через CSS-переменные `var(--accent|fg|bg-1|border|...)`. Часть старых файлов (`ManagerMisWebhooks`) ещё на хардкод-цветах (`#047857`, `#fee2e2`) — легаси-стиль до перетемизации.

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `ManagerInventoryReceiptDetail.jsx` | Карточка прихода: позиции, провести/отменить/добавить | 536 |
| `ManagerInventoryReceipts.jsx` | Список приходов, фильтры, создание черновика | 394 |
| `ManagerInvoiceApprovals.jsx` | Согласование входящих межклиничных счетов | 301 |
| `ManagerInvoices.jsx` | Обёртка секции межклиничных счетов | 34 |
| `ManagerKPI.jsx` | Цели сотрудников по месяцам, прогресс | 207 |
| `ManagerKanban.jsx` | Обёртка Kanban-расписания записей | 35 |
| `ManagerLab.jsx` | Обёртка раздела провайдеров лаборатории | 35 |
| `ManagerLoyalty.jsx` | Обёртка раздела программы лояльности | 35 |
| `ManagerMarketing.jsx` | Вкладки: расходы, каналы, атрибуция | 62 |
| `ManagerMisWebhooks.jsx` | Webhook-интеграции внешних МИС, события подписки | 329 |
| `ManagerMultiClinic.jsx` | Обёртка панорамного обзора всех клиник | 25 |
| `ManagerPartnerDoctors.jsx` | Заявки рекрутеров и врачи-партнёры | 418 |

---

## `frontend/src/pages/ManagerInventoryReceiptDetail.jsx`

- **Назначение:** Детальная карточка документа прихода (поступления товаров на склад) — этап 1 INVENTORY_COST_PLAN. Показывает шапку (№, дата, поставщик, статус, сумма) и таблицу позиций-партий; позволяет добавлять/удалять позиции и проводить/отменять документ.
- **Ключевые элементы:**
  - `ManagerInventoryReceiptDetail()` — default-экспорт, страница. Берёт `id` из `useParams()`, `useNavigate()`, `useToast()`.
  - State: `receipt`, `batches` (позиции-партии), `items` (справочник номенклатуры), `supplierName`, `loading`, `working`, `addOpen`.
  - `itemMap` — `useMemo` мапа `item_id → item` для подписи номенклатуры.
  - `load()` (`useCallback`) — параллельно `GET /receipts/{id}` + `GET /batches?receipt_id`, затем дотягивает имя поставщика.
  - Действия: `post()`, `cancel()`, `removeItem(batchId)` — с `confirm()` и тостами.
  - `AddItemModal` — внутренняя модалка добавления позиции (поиск номенклатуры с фильтром, валидация qty>0 и price≥0).
  - Хелперы: `fmtDate`, `fmtMoney`, `Th`, `Td`, `Field`, `Meta`, константы `STATUS`, `INPUT_STYLE`.
- **Эндпоинты (вызываемые, не определяемые):**

  | Метод | Путь | Назначение |
  |-------|------|-----------|
  | GET | `/inventory/receipts/{id}` | Загрузить документ |
  | GET | `/inventory/batches?receipt_id={id}&active_only=false` | Позиции прихода |
  | GET | `/inventory/items?limit=500` | Справочник номенклатуры |
  | GET | `/inventory/suppliers/{supplier_id}` | Имя поставщика |
  | POST | `/inventory/receipts/{id}/items` | Добавить позицию (draft) |
  | DELETE | `/inventory/receipts/{id}/items/{batch_id}` | Удалить позицию (draft) |
  | POST | `/inventory/receipts/{id}/post` | Провести (обновляет остатки) |
  | POST | `/inventory/receipts/{id}/cancel` | Отменить |

- **Зависимости:** `../api` (axios), `react-router-dom` (`useParams`, `useNavigate`), `./_ManagerShell`, `../design` (`Card`, `Button`, `EmptyState`, `Modal`, `useToast`). `active="inventory-receipts"` в shell.
- **Где менять для типовых задач:**
  - Новое поле позиции (например, НДС) — `AddItemModal.form`, тело POST в `submit()` (строки ~411-417) и колонки таблицы/мобильной карточки.
  - Сменить условие доступности кнопок — флаг `isDraft = receipt.status === 'draft'` (строка ~180).
  - Новый статус документа — добавить в константу `STATUS` (строки ~39-43) — она дублируется и в `ManagerInventoryReceipts.jsx`, синхронизировать оба.
  - Лимит подгружаемой номенклатуры — `params: { limit: 500 }` (строка ~109) и `slice(0, 200)` в `filteredItems`.
- **Подводные камни:**
  - Сумма позиции считается на клиенте `Number(b.qty_received) * Number(b.unit_cost)` (строка ~292) — float-арифметика; источником истины по `total_amount` должен быть бэкенд (Decimal). Расхождение копеек возможно при отображении.
  - `STATUS`, `fmtDate`, `fmtMoney`, `Th`, `Td`, `Field` дублируются с `ManagerInventoryReceipts.jsx` — копипаст, не общий модуль.
  - `confirm()`/`alert()` нативные — не дизайн-система.
  - `tenant_id` не передаётся: изоляция клиники — на бэкенде по токену.
- **Строк:** 536

---

## `frontend/src/pages/ManagerInventoryReceipts.jsx`

- **Назначение:** Список документов прихода с фильтрами (период, поставщик, статус) и созданием нового черновика через модалку. После создания — редирект на детальную страницу. Этап 1 INVENTORY_COST_PLAN.
- **Ключевые элементы:**
  - `ManagerInventoryReceipts()` — default-экспорт.
  - State: `items` (список приходов), `suppliers`, `clinics`, `loading`, фильтры `from`/`to`/`supplierId`/`statusFilter`, модалка `createOpen`/`creating`/`form`.
  - `supplierMap` (`useMemo`) — `supplier_id → supplier` для подписи в таблице.
  - `load()` (`useCallback`, зависит от фильтров) — `GET /inventory/receipts` с параметрами.
  - Один раз: подгрузка `suppliers` (`is_active:true`) и `clinics`.
  - `openCreate()` (предзаполняет первую клинику и сегодняшнюю дату), `create()` — `POST` и `nav()` на `/manager/inventory/receipts/{id}`.
  - Хелперы: `fmtDate`, `fmtMoney`, `todayISO`, `Th`, `Td`, `Field`, `STATUS`, `INPUT_STYLE`.
- **Эндпоинты (вызываемые):**

  | Метод | Путь | Назначение |
  |-------|------|-----------|
  | GET | `/inventory/receipts?from=&to=&supplier_id=&status=` | Список приходов |
  | POST | `/inventory/receipts` | Создать черновик |
  | GET | `/inventory/suppliers?is_active=true` | Справочник для фильтра/формы |
  | GET | `/manager/clinics/` | Список клиник для формы |

- **Зависимости:** `../api`, `react-router-dom` (`useNavigate`), `./_ManagerShell`, `../design` (`Card`, `Button`, `EmptyState`, `Modal`, `useToast`, `Chip` — `Chip` импортирован, но в коде не используется). `active="inventory-receipts"`.
- **Где менять для типовых задач:**
  - Новый фильтр — добавить state + параметр в `load()` (строки ~88-92) и контрол в блок фильтров.
  - Новое поле при создании — `form` (строки ~76-79), тело `body` в `create()` (строки ~139-145) и поле в модалке.
  - Колонки таблицы списка — `<thead>`/`<tbody>` (desktop ~228-266) и зеркально мобильные карточки (~269-299).
- **Подводные камни:**
  - `Chip` импортируется, но не используется — мёртвый импорт.
  - `STATUS`/`fmtDate`/`fmtMoney`/`Th`/`Td`/`Field` — дубли с `ManagerInventoryReceiptDetail.jsx`.
  - `total_amount` приходит с бэкенда; здесь только форматирование, без вычислений.
  - Клиника обязательна (`clinic_id`); при пустом списке клиник создание невозможно.
- **Строк:** 394

---

## `frontend/src/pages/ManagerInvoiceApprovals.jsx`

- **Назначение:** Согласование входящих межклиничных счетов: сюда падают счета, выставленные другими клиниками сети нашей клинике (бонусы по направлению/роялти/корректировки). Руководитель согласовывает (его ФИО фиксируется как подпись, счёт уходит бухгалтеру) или отклоняет с причиной.
- **Ключевые элементы:**
  - `ManagerInvoiceApprovals()` — default-экспорт.
  - State: `tab` (`pending`/`approved`/`rejected`/`all`), `items`, `loading`, `error`, `acting` (id счёта в процессе действия), `rejectModal`, `rejectReason`.
  - `load()` — маппинг таба в query `status` и `GET /clinic-invoices/incoming`.
  - `approve(inv)` — `confirm()` + `PATCH .../approve`.
  - `openReject`/`confirmReject` — кастомная модалка отклонения (`PATCH .../reject` с `reason`).
  - `stats` (`useMemo`) — счётчик и сумма pending-счетов для футера.
  - Константы `STATUS_META` (бейджи статусов, включая legacy `sent`), `fmtMoney`, `fmtDate`.
- **Эндпоинты (вызываемые):**

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|-----------|-----------|
  | GET | `/clinic-invoices/incoming?status=` | manager | — | список счетов | Входящие межклиничные счета |
  | PATCH | `/clinic-invoices/{id}/approve` | manager | — | — | Согласовать (подпись = ФИО руководителя) |
  | PATCH | `/clinic-invoices/{id}/reject` | manager | `{reason}` | — | Отклонить с причиной |

- **Зависимости:** `../api`, `./_ManagerShell`, `../design` (`Card`, `Button`, `Chip` — импортирован, не используется, `EmptyState`). `active="invoice-approvals"`.
- **Где менять для типовых задач:**
  - Новый тип счёта (`invoice_type`) — расширить тернарник подписи типа (строки ~172-175).
  - Новый статус — добавить в `STATUS_META` (строки ~14-21).
  - Логика «что считается pending» — условие `isPending` (строка ~156) и фильтр в `stats` учитывают и `pending_approval`, и legacy `sent`.
- **Подводные камни:**
  - Статус `sent` помечен как legacy — двойная обработка `pending_approval || sent` в нескольких местах; при чистке легаси убрать обе ветки.
  - `Chip` импортирован, но не используется — мёртвый импорт.
  - Reject-модалка нарисована руками (`position:fixed`), не через `Modal` из дизайн-системы — расхождение с другими страницами этого среза.
  - `EmptyState` здесь вызывается с пропсами `icon="inbox"` (строка) и `text` — в других файлах среза `EmptyState` принимает `icon` как JSX-элемент и проп `message`. Возможно расхождение API компонента — проверить сигнатуру `EmptyState`.
  - `fmtMoney` использует `toLocaleString` без `maximumFractionDigits` — формат отличается от inventory-страниц.
- **Строк:** 301

---

## `frontend/src/pages/ManagerInvoices.jsx`

- **Назначение:** Тонкая обёртка-страница «Межклиничные счета»: оборачивает существующую секцию `InterClinicInvoicesSection` в `ManagerShell`. Бизнес-логика целиком в секции.
- **Ключевые элементы:** `ManagerInvoices()` — default-экспорт; рендерит `<InterClinicInvoicesSection isSupervisor={false} />` внутри стилизованного контейнера. `active="invoices"`.
- **Эндпоинты:** нет (вся работа с API — внутри `InterClinicInvoicesSection`).
- **Зависимости:** `../sections/InterClinicInvoicesSection`, `./_ManagerShell`.
- **Где менять для типовых задач:**
  - Логика/таблицы/формы межклиничных счетов — править `../sections/InterClinicInvoicesSection`, не этот файл.
  - Заголовок/иконка/подзаголовок раздела — пропсы `ManagerShell` (строки ~14-18).
  - Проп `isSupervisor={false}` различает режим менеджера vs супервайзера — для режима руководителя оставлять `false`.
- **Подводные камни:** Не путать с `ManagerInvoiceApprovals.jsx` — это разные экраны (исходящие/общие счета vs входящие на согласование).
- **Строк:** 34

---

## `frontend/src/pages/ManagerKPI.jsx`

- **Назначение:** Установка и просмотр целей/KPI сотрудников (администраторов) по месяцам: целевое и фактическое число направлений и подтверждённых, с прогресс-барами.
- **Ключевые элементы:**
  - `ManagerKPI()` — default-экспорт.
  - `KpiBar({label, actual, target, pct, color})` — компонент прогресс-бара (клампит pct в 0..100).
  - State: `kpiList`, `loading`, `saving` (admin_id), `editing` (admin_id), `editForm` (`target_referrals`/`target_confirmed`), `error`, `savedMsg`, `month`.
  - `load()` — `getKpi(month)`.
  - `handleSave(adminId)` — `setKpi(adminId, {target_referrals, target_confirmed, month})` с `parseInt`.
- **Эндпоинты:** прямых `api.get/post` нет — через именованные функции `getKpi`/`setKpi` из `../api`.

  | Функция api | Назначение |
  |-------------|-----------|
  | `getKpi(month)` | Список KPI сотрудников за месяц |
  | `setKpi(adminId, {target_referrals, target_confirmed, month})` | Установить цели сотруднику |

- **Зависимости:** `../api` (`getKpi`, `setKpi`), `../design` (`Card`, `Button`, `Avatar`, `EmptyState`), `./_ManagerShell`. `active="kpi"`.
- **Где менять для типовых задач:**
  - Новая метрика KPI (например, выручка) — добавить поле в `editForm`, в тело `setKpi` (строки ~62-66), новый `<KpiBar>` (строки ~192-193) и поле в форме редактирования.
  - Формат периода — переменная `currentMonth` (`YYYY-MM`, строка ~47).
- **Подводные камни:**
  - Цели приводятся `parseInt(...) || 0` — дробные цели потеряются (для счётных метрик ок, для денежных — нет).
  - `pct` (`progress_refs_pct`/`progress_conf_pct`) считается на бэкенде — здесь только отображение.
  - `month` — единственная зависимость `useEffect(load)`; смена месяца перезагружает список.
- **Строк:** 207

---

## `frontend/src/pages/ManagerKanban.jsx`

- **Назначение:** Тонкая обёртка-страница Kanban-расписания записей: лениво грузит `ManagerKanbanSchedule` и даёт переключение между режимами просмотра (Kanban/Календарь/Неделя) через навигацию.
- **Ключевые элементы:**
  - `ManagerKanban()` — default-экспорт.
  - `switchView(v)` — навигация: `calendar → /manager/appointments`, `week → /manager/schedules`, `kanban` — no-op (текущий).
  - `lazy(() => import('../sections/ManagerKanbanSchedule'))` + `Suspense`.
- **Эндпоинты:** нет (внутри `ManagerKanbanSchedule`).
- **Зависимости:** `react-router-dom` (`useNavigate`), `./_ManagerShell`, лениво `../sections/ManagerKanbanSchedule`. `active="kanban"`.
- **Где менять для типовых задач:**
  - Логика kanban-доски (колонки, drag-and-drop, статусы) — в `../sections/ManagerKanbanSchedule`.
  - Маршруты переключения режимов — функция `switchView` (строки ~17-21).
- **Подводные камни:** Маршрут `week` ведёт на `/manager/schedules`, хотя комментарий в шапке упоминает `/manager/appointments` для «недели» — комментарий устарел, источник истины — код `switchView`.
- **Строк:** 35

---

## `frontend/src/pages/ManagerLab.jsx`

- **Назначение:** Тонкая обёртка-страница «Лаборатории» (Глава 10): лениво грузит `AdminLabProvidersSection` (подключённые провайдеры анализов и приёмные URL) в `ManagerShell`.
- **Ключевые элементы:** `ManagerLab()` — default-экспорт; `lazy(() => import('../sections/AdminLabProvidersSection'))` + `Suspense` со skeleton-плейсхолдерами. `active="lab"`.
- **Эндпоинты:** нет (внутри `AdminLabProvidersSection`).
- **Зависимости:** `./_ManagerShell`, лениво `../sections/AdminLabProvidersSection`.
- **Где менять для типовых задач:** Вся логика провайдеров лаборатории — `../sections/AdminLabProvidersSection`. Здесь — только заголовок/иконка/`active`.
- **Подводные камни:** Секция переиспользуется из кабинета админа (префикс `Admin*`) — изменения в ней затронут оба кабинета. Skeleton использует хардкод-цвет `#e5e7eb` вместо `var(--bg-2)`.
- **Строк:** 35

---

## `frontend/src/pages/ManagerLoyalty.jsx`

- **Назначение:** Тонкая обёртка-страница «Лояльность» (Глава 8): лениво грузит `AdminLoyaltySection` (награды, лидерборд, запросы пациентов, корректировка баллов) в `ManagerShell`.
- **Ключевые элементы:** `ManagerLoyalty()` — default-экспорт; `lazy(() => import('../sections/AdminLoyaltySection'))` + `Suspense` со skeleton. `active="loyalty"`.
- **Эндпоинты:** нет (внутри `AdminLoyaltySection`).
- **Зависимости:** `./_ManagerShell`, лениво `../sections/AdminLoyaltySection`.
- **Где менять для типовых задач:** Логика программы лояльности — `../sections/AdminLoyaltySection`. Здесь — только обёртка.
- **Подводные камни:** Секция общая с кабинетом админа (`Admin*`) — правки затронут оба кабинета. Skeleton на хардкод-цвете `#e5e7eb`. Файл почти идентичен `ManagerLab.jsx` по структуре (одинаковый шаблон обёртки).
- **Строк:** 35

---

## `frontend/src/pages/ManagerMarketing.jsx`

- **Назначение:** Страница «Маркетинг»: три вкладки — Расходы (`ad_spend`), Каналы (`marketing_channels`), Атрибуция пациентов (`patient_attribution`). Stage 1 backend задеплоен; Stage 2/3 (отчёты, импорт) — зона другого агента.
- **Ключевые элементы:**
  - `ManagerMarketing()` — default-экспорт; локальный state `tab` (`spend`/`channels`/`attribution`).
  - Лениво грузит `AdSpendTab`, `ChannelsTab`, `AttributionTab` из `../components/marketing/*`.
  - Переключение через UI-компонент `Tabs` (массив `TABS`).
- **Эндпоинты:** прямых нет; вызовы внутри вкладок. Backend (для контекста): `GET/POST/PATCH/DELETE /marketing/channels`, `/marketing/ad-spend`, `/marketing/attribution`.
- **Зависимости:** `./_ManagerShell`, `../design` (`Tabs`), лениво `../components/marketing/{AdSpendTab,ChannelsTab,AttributionTab}`. `active="marketing"`.
- **Где менять для типовых задач:**
  - Новая вкладка — добавить в `TABS` (строки ~27-31), `lazy`-импорт и ветку `{tab === '...' && <...>}` (строки ~55-57).
  - Логика расходов/каналов/атрибуции — в соответствующих файлах `../components/marketing/*`, не здесь.
- **Подводные камни:** Расходы/атрибуция оперируют деньгами — все денежные вычисления должны жить в backend/Decimal; здесь только разводка вкладок. Все три вкладки лениво-загружаемы, но монтируется только активная (нет prefetch).
- **Строк:** 62

---

## `frontend/src/pages/ManagerMisWebhooks.jsx`

- **Назначение:** Управление webhook-интеграциями с внешними МИС (renovatio/stoclinic/custom): платформа шлёт им события подписки «Здоровье+» (`subscription.activated/cancelled/renewed`). Доставка best-effort, последняя ошибка хранится в `last_error`.
- **Ключевые элементы:**
  - `ManagerMisWebhooks()` — default-экспорт; таблица вебхуков + кнопки Тест/Удалить/тоггл активности.
  - State: `items`, `loading`, `showAdd`, `error`.
  - `load()`, `onDelete(id)` (`confirm`), `onToggle(h)` (`PATCH is_active`), `onTest(id)` (`POST .../test`, `alert` результата).
  - `AddWebhookModal({onClose, onCreated})` — внутренняя модалка создания (тип МИС, URL, auth header, чекбоксы событий из `EVENTS`).
- **Эндпоинты (вызываемые, миграция `miswebhook01`):**

  | Метод | Путь | Принимает | Назначение |
  |-------|------|-----------|-----------|
  | GET | `/manager/mis-webhooks` | — | Список интеграций (`r.data.items`) |
  | POST | `/manager/mis-webhooks` | `{mis_type, webhook_url, auth_header, events[], is_active}` | Создать |
  | PATCH | `/manager/mis-webhooks/{id}` | `{is_active}` | Тоггл активности |
  | DELETE | `/manager/mis-webhooks/{id}` | — | Удалить |
  | POST | `/manager/mis-webhooks/{id}/test` | — | Тест-доставка (`{success, info}`) |

- **Зависимости:** `../api` (импортирован как `apiClient`), `./_ManagerShell`. UI-кит `../design` НЕ используется — всё на хардкод-Tailwind/inline-стилях. `active="mis_webhooks"`.
- **Где менять для типовых задач:**
  - Новое событие подписки — добавить в `EVENTS` (строки ~26-30); дефолтный набор при создании — `useState` в `AddWebhookModal` (строки ~207-209).
  - Новый тип МИС — `<option>` в select модалки (строки ~257-259).
  - Поле интеграции — `AddWebhookModal.submit` body (строки ~222-228) и колонки таблицы.
- **Подводные камни:**
  - Легаси-стиль: хардкод-цвета (`#047857`, `#fee2e2`, `#dcfce7`, `#1e3a8a`) и `bg-white` вместо токенов `var(--*)` — НЕ перетемизирован под М33-подобный редизайн, в отличие от соседних страниц. Кандидат на рефактор под дизайн-систему.
  - `active="mis_webhooks"` — единственный раздел в этом срезе с `snake_case` ключом (остальные kebab/одно слово); проверить совпадение с ключом в `MGR_NAV` (`_ManagerShell`).
  - `confirm()`/`alert()` нативные; модалка нарисована руками, не через `Modal`.
  - `last_error` обрезается `.slice(0, 120)` при показе — полная ошибка только в БД.
- **Строк:** 329

---

## `frontend/src/pages/ManagerMultiClinic.jsx`

- **Назначение:** Тонкая обёртка-страница «Все клиники» (Глава 4): лениво грузит `ManagerMultiClinicView` — панорамный обзор сети клиник.
- **Ключевые элементы:** `ManagerMultiClinic()` — default-экспорт; `lazy(() => import('../sections/ManagerMultiClinicView'))` + `Suspense`. `active="multi-clinic"`.
- **Эндпоинты:** нет (внутри `ManagerMultiClinicView`).
- **Зависимости:** `./_ManagerShell`, лениво `../sections/ManagerMultiClinicView`.
- **Где менять для типовых задач:** Вся логика обзора клиник — `../sections/ManagerMultiClinicView`. Здесь — только заголовок/иконка/`active`.
- **Подводные камни:** Самый короткий файл среза (25 строк) — чистая обёртка, без особенностей.
- **Строк:** 25

---

## `frontend/src/pages/ManagerPartnerDoctors.jsx`

- **Назначение:** Раздел «Врачи-партнёры»: две вкладки — (1) Заявки рекрутеров (`DoctorRequest`, pending/approved/rejected — manager утверждает/отклоняет) и (2) Действующие партнёры (`User.role = PARTNER_DOCTOR`, блокировка/удаление). Утверждение заявки создаёт аккаунт врача и возвращает временные креды.
- **Ключевые элементы:**
  - `ManagerPartnerDoctors()` — default-экспорт; state `tab` (`pending`/`partners`), массив `TABS`, рендер вкладок кнопками.
  - `DoctorRequestsTab()` — заявки: state `requests`, `loading`, `busy`, `statusFilter`; `load()`, `approve(req)` (alert с логином+паролем), `reject(req)`; чипы-фильтры по статусу.
  - `PartnerDoctorsTab()` — партнёры: state `doctors`, `loading`, `search`, `busy`; `load()`, `toggleActive(doc)`, `remove(doc)`; клиентский фильтр `filtered` по имени/логину/спец./телефону.
  - Хелпер `formatDate`.
- **Эндпоинты (вызываемые):**

  | Метод | Путь | Принимает | Возвращает | Назначение |
  |-------|------|-----------|-----------|-----------|
  | GET | `/admins/doctor-requests?status_filter=` | — | список заявок | Заявки рекрутеров |
  | POST | `/admins/doctor-requests/{id}/approve` | — | `{username, temp_password}` | Утвердить → создать PARTNER_DOCTOR |
  | POST | `/admins/doctor-requests/{id}/reject` | — | — | Отклонить заявку |
  | GET | `/manager/all-partner-doctors` | — | список партнёров | Действующие партнёры |
  | PATCH | `/manager/recruiter-doctors/{id}/toggle-active` | — | — | Блокировка/активация |
  | DELETE | `/manager/all-external-doctors/{id}` | — | — | Удалить партнёра |

- **Зависимости:** `../api`, `../design` (`Card`, `Chip`, `Button`, `Avatar`, `EmptyState`), `./_ManagerShell`. `active="partners"`.
- **Где менять для типовых задач:**
  - Новая вкладка — массив `TABS` (строки ~24-27) + ветка рендера (строки ~413-414).
  - Новый статус заявки — `filterChips` в `DoctorRequestsTab` (строки ~82-87) и тернарники подписи (строки ~152-154).
  - Новое поле партнёра в карточке — массив объектов `{label, value}` (строки ~314-319).
- **Подводные камни:**
  - `approve()` показывает временный пароль в нативном `alert()` — чувствительные данные в UI; передача врачу вручную. При рефакторе на тосты не потерять отображение `temp_password`.
  - Эндпоинты разнесены между двумя префиксами: заявки под `/admins/*`, партнёры под `/manager/*` — следствие легаси-структуры роутеров (комментарий отмечает, что `all-external-doctors` DELETE работает и для `partner_doctor`).
  - Поиск партнёров клиентский (`filtered`) — при большом списке грузится всё сразу, без серверной пагинации.
  - `var(--line)` (border, строки ~181, ~345) и `var(--fg-4)` — токены, которых нет в части других файлов среза; проверить определение в теме.
- **Строк:** 418
