# pages [04] — Кабинет управляющего: финансы, бонусы, склад, чат, аналитика

Это срез страниц кабинета **управляющего сети клиник** (`/manager/*`) — 12 файлов из `frontend/src/pages/`. Все они либо рендерят содержимое внутри единой оболочки `_ManagerShell` (sidebar + topbar + mobile bottom-nav), либо являются тонкими обёртками-«страницами», подгружающими тяжёлую логику из `../sections/*` через `React.lazy`. Бизнес-логика (вызовы API) живёт прямо в страницах через общий axios-инстанс `../api` (он же `../api/index.js`, `baseURL = /<slug>/api`), а UI собран из дизайн-системы `../design` (Card, Button, Chip, Modal, EmptyState, KpiCard, useToast и т.д.).

Ключевая сквозная концепция группы — **per-clinic scope** через хук `../lib/useClinicScope`: управляющий сети без жёсткой привязки к клинике видит селектор `ClinicScopeSelector` и пробрасывает `clinic_id` в каждый запрос; `lika` с `clinic_id` видит только свою клинику. Фильтрация по тенанту (`tenant_id`) и по клинике выполняется на бэкенде — фронт лишь передаёт `clinic_id`.

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `ManagerBonuses.jsx` | Агрегированные бонусы сотрудников, выплата, печать акта | 243 |
| `ManagerChatPage.jsx` | Обёртка чата с пациентами (lazy) | 27 |
| `ManagerChatSettings.jsx` | SLA-настройки чата (форма) | 68 |
| `ManagerChatTemplates.jsx` | CRUD шаблонов ответов чата | 143 |
| `ManagerDashboard.jsx` | Главная сводка кабинета: KPI, навигация, отмены | 753 |
| `ManagerDoctorLoadPage.jsx` | Обёртка heatmap загрузки врачей (lazy) | 26 |
| `ManagerDoctors.jsx` | Обёртка раздела «Врачи» + расписания | 24 |
| `ManagerFinance.jsx` | Финансы: платформа / сеть / сотрудники (3 таба) | 403 |
| `ManagerForecast.jsx` | Обёртка прогноза расходов (lazy) | 24 |
| `ManagerHistory.jsx` | История направлений: фильтры, карточки, печать QR | 405 |
| `ManagerInventory.jsx` | Склад: справочник позиций, CRUD, импорт 1С | 459 |
| `ManagerInventoryBatches.jsx` | Партии товаров, сроки годности, ручное списание | 495 |

---

## `frontend/src/pages/ManagerBonuses.jsx`
- **Назначение:** Список сотрудников с агрегированными бонусами; разворачивает детализацию начислений, позволяет «выплатить всё» одной кнопкой и распечатать акт о выплате (HTML → `window.print`).
- **Ключевые элементы:** экспорт по умолчанию `ManagerBonuses()`; локальный хелпер `fmt(iso)` (дата dd.mm.yy); внутренние обработчики `load`, `handlePayAll`, `handlePrintAct`; `pendingTotal` через `useMemo`.
- **Зависимости:** `getManagerBonuses`, `markAllPaid` из `../api`; UI — `Card, Chip, Button, Avatar, EmptyState, Tabs, ClinicScopeSelector` из `../design`; хук `../lib/useClinicScope`; оболочка `./_ManagerShell`.
- **Где менять для типовых задач:**
  - Поля акта/печатной формы — `handlePrintAct` (строки 50-58), там вся HTML-вёрстка.
  - Фильтр «ожидают / все» — массив `items` у `Tabs` (стр. 116-123) и параметр `only_pending` в `load` (стр. 34).
  - Что отдавать в запрос (например доп. фильтр) — `params` в `load` (стр. 33-36).
  - Колонки/вёрстка карточки сотрудника — блок `admins.map` (стр. 151+).
- **Подводные камни:** `bonus_id` используется как React-key при склейке `pending_bonuses + paid_bonuses` (стр. 153, 212) — если бэкенд вернёт пересекающиеся id, будут конфликты ключей. Суммы (`pending_total`, `amount`) приходят как числа и форматируются `toLocaleString` — на бэке это бонусные баллы «Б», не рубли (Decimal там, на фронте уже number). `handlePrintAct` подставляет данные в HTML без экранирования — теоретический XSS, если имя/услуга содержат `<`.
- **Строк:** 243

---

## `frontend/src/pages/ManagerChatPage.jsx`
- **Назначение:** Тонкая страница-обёртка раздела «Чат с пациентами»: оборачивает `ClinicChatSection` в `_ManagerShell`, грузит секцию лениво. Маршрут `/manager/chat`.
- **Ключевые элементы:** экспорт по умолчанию `ManagerChatPage()`; `const ClinicChatSection = lazy(() => import('../sections/ClinicChatSection'))`; `Suspense` с текстовым фолбэком.
- **Зависимости:** `./_ManagerShell`; lazy-импорт `../sections/ClinicChatSection` (туда передаётся `role="manager"`).
- **Где менять для типовых задач:** заголовок/подзаголовок/иконку — пропсы `ManagerShell` (стр. 16-20). Реальная логика чата (сообщения, ответы, назначение врача, закрытие) — НЕ здесь, а в `../sections/ClinicChatSection`.
- **Подводные камни:** чистая обёртка, без состояния. Поведение чата задаётся пропом `role` — для других кабинетов та же секция переиспользуется с другим `role`.
- **Строк:** 27

---

## `frontend/src/pages/ManagerChatSettings.jsx`
- **Назначение:** Форма SLA-настроек чата (включение эскалации, пороги в минутах для reg/manager/owner, автозакрытие в днях). Маршрут `/manager/chat-settings`.
- **Ключевые элементы:** экспорт по умолчанию `ManagerChatSettings()`; константа `DEFAULTS`; обработчики `save`, `setNum(k)`; состояние `s` (настройки) + `busy`.
- **Эндпоинты (потребляемые, base `/<slug>/api`):**

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/tenant/settings/chat` | manager | — | объект настроек | Загрузить текущие SLA-настройки |
  | PATCH | `/tenant/settings/chat` | manager | объект `s` (поля из DEFAULTS) | обновлённые настройки | Сохранить SLA-настройки |

- **Зависимости:** `api` из `../api`; `useToast` из `../design`; `./_ManagerShell`.
- **Где менять для типовых задач:** добавить новое поле настройки — дополнить `DEFAULTS` (стр. 10-16) и массив `[[key, label], ...]` рендера (стр. 47-52); чекбоксы обрабатываются отдельно (стр. 42-46).
- **Подводные камни:** `setNum` приводит к `Number(...) || 0` — пустое поле молча станет 0. `useToast()` вызывается с `|| {}` и `toast?.()` — защита от отсутствия провайдера. Слияние `{ ...DEFAULTS, ...(r.data || {}) }` гарантирует наличие всех ключей даже при частичном ответе.
- **Строк:** 68

---

## `frontend/src/pages/ManagerChatTemplates.jsx`
- **Назначение:** CRUD-страница быстрых шаблонов ответов в чате (shortcut `/анализы`, заголовок, тело, категория, признак «общий для клиники»). Маршрут `/manager/chat-templates`. Модалка создания/редактирования встроена.
- **Ключевые элементы:** экспорт по умолчанию `ManagerChatTemplates()`; обработчики `load`, `save`, `del`; состояние `items`, `edit` (`null` = закрыто, `{}` = новый, `{id,...}` = редактирование).
- **Эндпоинты (потребляемые, base `/<slug>/api`):**

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/chat/templates?limit=100` | manager | — | `{ templates: [...] }` | Список шаблонов |
  | POST | `/chat/templates` | manager | `{shortcut,title,body,category,is_global}` | созданный шаблон | Создать шаблон |
  | PUT | `/chat/templates/{id}` | manager | тот же payload | обновлённый шаблон | Обновить шаблон |
  | DELETE | `/chat/templates/{id}` | manager | — | — | Удалить шаблон |

- **Зависимости:** `api` из `../api`; `useToast` из `../design`; `./_ManagerShell`.
- **Где менять для типовых задач:** валидация перед сохранением — начало `save` (стр. 27-29); набор полей формы — модалка (стр. 102-139); формат payload — `payload` в `save` (стр. 30-36).
- **Подводные камни:** удаление через нативный `confirm()` (стр. 47). `body` отправляется без `.trim()` (намеренно — сохраняются переносы), а `shortcut/title` тримятся. Поле `usage_count` приходит с бэка только для чтения. `is_global` — общий шаблон на всю клинику (tenant-scope), проверка прав на бэке.
- **Строк:** 143

---

## `frontend/src/pages/ManagerDashboard.jsx`
- **Назначение:** Главная страница кабинета управляющего: sticky topbar с приветствием, два ряда KPI (+sparkline), виджет «Быстрые переходы» (accordion по группам навигации с сохранением в localStorage), фильтр периода с экспортом CSV, блок запросов на удаление направлений, таблицы «Сотрудники» и «Поток между клиниками», mobile bottom-nav + drawer «Ещё». Это самый большой и центральный файл группы.
- **Ключевые элементы:** экспорт по умолчанию `ManagerDashboard()`; хелперы `greeting()`, `todayRu()`, внутренний компонент `QuickTile`; константы `ALL_NAV`, `BOTTOM_KEYS`, `bottomItems`, `moreItems`, `QUICK_NAV_LS_KEY`; обработчики `fetchAll`, `buildParams`, `handleExport`, `handleApplyFilter`, `toggleGroup`; мемоизация `navByGroup`, `sparkData`, `conversionPct`.
- **Эндпоинты (потребляемые, base `/<slug>/api`):**

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/manager/summary` (через `getManagerSummary`) | manager | `date_from, date_to, clinic_id` | агрегаты направлений/бонусов | KPI сводки |
  | GET | `/manager/admins` (через `getManagerAdmins`) | manager | те же params | список сотрудников | Таблица «Сотрудники» |
  | GET | `/manager/reports/clinics` | manager | `clinic_id?` | поток откуда→куда | Таблица «Поток между клиниками» |
  | GET | `/manager/reports/today` | manager | `clinic_id?` | статистика за сегодня | Quick Stats / KPI «создано сегодня» |
  | GET | `/manager/clinics-accessible` | manager | — | список клиник | Скрыть «Все клиники» при ≤1 клинике |
  | GET | cancel-requests (через `getCancelRequests`) | manager | — | запросы на отмену | Блок «Запросы на удаление» |
  | POST | approve/reject (через `approveCancelRequest`/`rejectCancelRequest`) | manager | `id` | — | Решение по запросу удаления |
  | GET | CSV (через `exportCSV`) | manager | — | blob CSV | Экспорт отчёта |

- **Зависимости:** из `../api` — `getManagerSummary, getManagerAdmins, getManagerClinics, exportCSV, getCancelRequests, approveCancelRequest, rejectCancelRequest` + сам `api`; `useAuthStore` из `../store/auth`; UI `Page, PageHeader, Card, KpiCard, KpiRow, Chip, Button, Avatar, Sparkline, ClinicScopeSelector` из `../design`; хук `../lib/useClinicScope`; **`MGR_NAV` и `MGR_NAV_GROUPS` импортируются из `./_ManagerShell`** (единый источник навигации — стр. 45).
- **Где менять для типовых задач:**
  - Состав KPI-карточек — два `KpiRow` (стр. 290-343); значения берутся из `summary`/`todayStats`.
  - Какие разделы попадают в нижнюю мобильную панель — `BOTTOM_KEYS` (стр. 47).
  - Группировка/состав «Быстрых переходов» — правится в `_ManagerShell` (`MGR_NAV`/`MGR_NAV_GROUPS`), здесь только рендер `navByGroup` (стр. 380-444).
  - Дефолтно открытая группа Quick Actions — значение `new Set(['reports'])` (стр. 119).
  - Логика sparkline — `sparkData` (стр. 202-205): **это синтетика на базе KPI, а не реальные исторические данные** (см. ниже).
- **Подводные камни:** **`sparkData` и значок `+N п.п.` (стр. 353) — синтетические/декоративные**, не отражают реальную динамику. `fetchAll` запускает запросы параллельно без `await` (fire-and-forget через `.then().finally()`), общий `setError` ловит только summary/admins/clinics-блоки выборочно. `useEffect` на `fetchAll` зависит только от `scope.selectedId` (стр. 185) — смена дат применяется лишь по кнопке «Применить» (`handleApplyFilter`), не автоматически. Несоответствие имён полей сотрудника защищено фолбэками (`row.full_name || row.admin_name`). Все суммы — баллы «Б», не рубли.
- **Строк:** 753

---

## `frontend/src/pages/ManagerDoctorLoadPage.jsx`
- **Назначение:** Тонкая обёртка-страница heatmap-аналитики загрузки врачей по дням/часам. Глава 4. Маршрут `/manager/doctor-load`.
- **Ключевые элементы:** экспорт по умолчанию `ManagerDoctorLoadPage()`; `lazy(() => import('../sections/ManagerDoctorLoad'))`; `Suspense`.
- **Зависимости:** `./_ManagerShell`; lazy `../sections/ManagerDoctorLoad`.
- **Где менять для типовых задач:** заголовок/иконка — пропсы `ManagerShell` (стр. 15-19). Сама heatmap-логика — в `../sections/ManagerDoctorLoad`.
- **Подводные камни:** чистая обёртка без состояния и без API-вызовов.
- **Строк:** 26

---

## `frontend/src/pages/ManagerDoctors.jsx`
- **Назначение:** Обёртка раздела «Врачи»: рендерит `DoctorsSection` внутри `_ManagerShell`. Через неё менеджер задаёт штатным врачам шаблонное расписание (Пн-Вс), после чего у регистратора в `/manager/appointments` появляются слоты.
- **Ключевые элементы:** экспорт по умолчанию `ManagerDoctors()`; извлечение `token` из `api.defaults.headers` либо нескольких ключей `localStorage`.
- **Зависимости:** `api` из `../api`; `SLUG` из `../config`; `./_ManagerShell`; **`DoctorsSection` импортируется НЕ лениво** (прямой импорт `../sections/DoctorsSection`).
- **Где менять для типовых задач:** логика расписаний врачей — в `../sections/DoctorsSection`; здесь правится только способ получения `token` (стр. 13-17), который пробрасывается в секцию пропом.
- **Подводные камни:** **ручное добывание токена с фолбэками** (`clinika_token_<slug>` → `clinika_token_arc` → `clinika_token`) — легаси-подход; остальные страницы группы полагаются на автоматический заголовок `Authorization` в общем axios. Если меняется схема хранения токенов в `../api`, этот файл нужно синхронизировать вручную. В отличие от соседей не задаёт `title`/`subtitle` у `ManagerShell` (заголовок берётся из навигации по `active="doctors"`).
- **Строк:** 24

---

## `frontend/src/pages/ManagerFinance.jsx`
- **Назначение:** Финансовый раздел кабинета с тремя табами: «Платформе» (счета франшизы `FranchiseInvoice`), «Клиникам сети» (`InterClinicInvoice`, входящие/исходящие + чистый баланс), «Сотрудникам» (агрегация бонусов по людям). Маршрут `/manager/finance`.
- **Ключевые элементы:** экспорт по умолчанию `ManagerFinance()`; внутренние компоненты-табы `PlatformTab`, `CrossClinicTab`, `BonusesTab`; вспомогательные `StatusBadge`, `formatRub`, `formatDate`; константы `TABS`, `STATUS_BADGE`.
- **Эндпоинты (потребляемые, base `/<slug>/api`):**

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/manager/finance/platform` | manager | — | `FranchiseInvoice[]` | Счета от платформы |
  | GET | `/manager/finance/cross-clinic` | manager | `direction=incoming\|outgoing?` | `{items, summary}` | Межклиничные счета + сводка |
  | GET | `/manager/finance/bonuses` | manager | — | агрегаты по сотрудникам | Бонусы к выплате/выплачено |
  | POST | `/manager/finance/invoices/{id}/mark-paid?invoice_kind=franchise` | manager | — | — | Оплатить счёт платформы |
  | POST | `/manager/finance/invoices/{id}/mark-paid?invoice_kind=cross_clinic` | manager | — | — | Оплатить межклиничный счёт |

- **Зависимости:** `api` из `../api`; `Card, Button, EmptyState, useToast` из `../design`; `./_ManagerShell`.
- **Где менять для типовых задач:**
  - Новый таб — дополнить `TABS` (стр. 21-25) и условный рендер внизу (стр. 398-400) + написать компонент-таб.
  - Статусы и их цвета — карта `STATUS_BADGE` (стр. 27-35) + `StatusBadge` (стр. 37-46).
  - Фильтр направления межклиничных счетов — `CrossClinicTab` state `filter` (стр. 165) и кнопки (стр. 220-236).
  - Кнопка «Оплатить» — `handlePay` в `PlatformTab`/`CrossClinicTab`; важен query-параметр `invoice_kind`.
- **Подводные камни:** **два разных вида счетов оплачиваются через ОДИН эндпоинт `mark-paid`, различаемые `invoice_kind`** — при добавлении третьего типа счёта нужно расширять этот параметр. Суммы здесь — **рубли** (`formatRub`, `Number(...).toLocaleString` с `currency`), в отличие от бонусных баллов на других страницах; на бэке это Decimal, фронт приводит через `Number()`. `PlatformTab` показывает кнопку только при `status === 'pending'`; `CrossClinicTab` — только для `is_incoming && status not in (paid, cancelled)`. `confirm()` нативный. Поля счетов различаются между табами (`i.number` vs `i.invoice_number`, `i.total_amount` vs `i.amount`) — не унифицированы.
- **Строк:** 403

---

## `frontend/src/pages/ManagerForecast.jsx`
- **Назначение:** Тонкая обёртка-страница прогноза расходов (анализ истории + предсказание на 3 месяца). Глава 4. Маршрут `/manager/forecast`.
- **Ключевые элементы:** экспорт по умолчанию `ManagerForecast()`; `lazy(() => import('../sections/ManagerCostForecast'))`; `Suspense`.
- **Зависимости:** `./_ManagerShell`; lazy `../sections/ManagerCostForecast`.
- **Где менять для типовых задач:** заголовок/иконка — пропсы `ManagerShell` (стр. 13-17). Алгоритм прогноза — в `../sections/ManagerCostForecast`.
- **Подводные камни:** чистая обёртка без состояния и без API-вызовов.
- **Строк:** 24

---

## `frontend/src/pages/ManagerHistory.jsx`
- **Назначение:** История направлений с фильтрами (статус-табы, пресеты периода + ручные даты, фильтр по телефону из URL), разворачиваемыми карточками с деталями (бонус, причина отмены, кто отменил), Quick Actions на карточке и модалкой печати QR направления. Постраничная подгрузка «Загрузить ещё». Маршрут `/manager/history`.
- **Ключевые элементы:** экспорт по умолчанию `ManagerHistory()`; внутренний компонент `PrintQrModal`; вспомогательные `Row`, `fmt`, `fmtFull`, `today`, `weekAgo`, `monthAgo`, `normPhone`; константы `STATUS_TABS`, `STATUS_VARIANT`, `STATUS_LABEL`, `STATUS_BORDER`; `load(reset)`, `setPreset`, `clearPhoneFilter`; мемо `filteredReferrals`.
- **Эндпоинты (потребляемые, base `/<slug>/api`):**

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | referrals (через `getManagerReferrals`) | manager | `page, limit=50, date_from, date_to, status, clinic_id` | `Referral[]` | История направлений с пагинацией |

- **Зависимости:** `getManagerReferrals` из `../api`; `useSearchParams` (react-router); UI `Card, Chip, Button, EmptyState, ClinicScopeSelector, QuickActions, buildPatientCardActions, Modal` из `../design`; хук `../lib/useClinicScope`; `./_ManagerShell`.
- **Где менять для типовых задач:**
  - Набор статус-табов — `STATUS_TABS` (стр. 16-23) + соответствующие карты цвета/лейбла/бордера.
  - Пресеты периода — `setPreset` (стр. 133-138) и кнопки (стр. 177).
  - Действия на карточке — `buildPatientCardActions(...)` (стр. 278-288); сейчас активны звонок по телефону и печать QR.
  - Печатная форма QR — `PrintQrModal.handlePrint` (стр. 347-367).
  - Размер страницы — `LIMIT = 50` (стр. 86).
- **Подводные камни:** **фильтр по телефону применяется на КЛИЕНТЕ** (`filteredReferrals` через `useMemo`, стр. 89-94) поверх уже загруженной страницы — при включённом `patient_phone` пагинация/`hasMore` отключается визуально (`!phoneFilter && hasMore`), и совпадения за пределами загруженных 50 записей не найдутся; именно поэтому при наличии `patient_phone` в URL даты сбрасываются на «Всё время» (стр. 79-80). `load` зависит от `page` в `useCallback`, но `useEffect` его не слушает (стр. 131) — подгрузка только по кнопке. QR печатается с экранированием `< > & " '` (стр. 351-352), но base64-картинка вставляется как есть.
- **Строк:** 405

---

## `frontend/src/pages/ManagerInventory.jsx`
- **Назначение:** Складской справочник позиций (`inventory_items`): таблица SKU/Название/Категория/Ед./Остаток/Цена, поиск с дебаунсом, фильтр по категориям-чипам, ручное создание/редактирование позиции (модалка) для клиник без 1С, удаление, и запуск мастера импорта из 1С. Маршрут `/manager/inventory`.
- **Ключевые элементы:** экспорт по умолчанию `ManagerInventory()`; внутренние компоненты `ItemModal`, `Field`, `Th`, `Td`; хелпер `fmtMoney`; константы `CATEGORIES`, `CATEGORY_LABEL`, `NORM_CAT`, `PAGE_SIZE=50`; `load` (useCallback), `remove`.
- **Эндпоинты (потребляемые, base `/<slug>/api`):**

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/inventory/items?search=&limit=50&offset=` | manager | поиск/пагинация | `Item[]` или `{items,total}` | Список позиций |
  | POST | `/inventory/items` | manager | payload позиции | созданная позиция | Создать позицию |
  | PATCH | `/inventory/items/{id}` | manager | payload позиции | обновлённая позиция | Изменить позицию |
  | DELETE | `/inventory/items/{id}` | manager | — | — | Удалить позицию (движения/партии сохраняются) |

- **Зависимости:** `api` из `../api`; `Card, Button, EmptyState, Modal` из `../design`; **`InventoryImportWizard` из `../components/inventory/InventoryImportWizard`** (мастер импорта 1С); `./_ManagerShell`.
- **Где менять для типовых задач:**
  - Набор категорий и подсказок — `CATEGORIES` (стр. 33-39); используется и в форме, и в чипах-фильтрах, и в лейблах таблицы.
  - Поля позиции — `ItemModal` форма (стр. 61-205) и сборка `payload` в `save` (стр. 84-96).
  - Колонки таблицы — `<thead>`/`<tbody>` (стр. 370-418).
  - Логика импорта 1С — в `InventoryImportWizard`, тут только `wizardOpen`.
- **Подводные камни:** **категория enum на бэке lowercase, но старые данные могли быть UPPER** — повсюду нормализация `NORM_CAT` (стр. 42). API может вернуть **либо массив, либо `{items,total}`** — `load` обрабатывает оба варианта (стр. 224-229), `total`/`hasMore` при «голом массиве» считаются эвристически (стр. 248). Числа `cost_per_unit`/`min_stock_threshold` отправляются как `Number()` или `null` (пустое → null). Фильтр категорий работает на клиенте поверх текущей страницы (стр. 244-246) — счётчики в чипах считаются только по загруженным позициям. Дебаунс поиска 300мс (стр. 238-242) дублирует `load` из основного useEffect — при изменении `search` может произойти двойной запрос.
- **Строк:** 459

---

## `frontend/src/pages/ManagerInventoryBatches.jsx`
- **Назначение:** Список партий товаров (этап 1 `INVENTORY_COST_PLAN`) с цветовой индикацией по сроку годности (истекло/<30/<60/норма), сводными карточками, фильтрами (номенклатура с поиском, клиника, «истекает в N дней», только с остатком) и модалкой ручного списания (qty/причина/комментарий). Desktop-таблица + mobile-карточки. Маршрут `/manager/inventory-batches`.
- **Ключевые элементы:** экспорт по умолчанию `ManagerInventoryBatches()`; внутренние `SummaryCard`, `WriteoffModal`, `Th`, `Td`, `Field`; хелперы `daysUntil`, `expiryBucket`, `fmtDate`, `fmtMoney`; константы `INPUT_STYLE`, `WRITEOFF_REASONS`, `BUCKET_STYLE`; мемо `itemMap`, `clinicMap`, `summary`, `filteredItemOptions`.
- **Эндпоинты (потребляемые, base `/<slug>/api`):**

  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|------------|------------|
  | GET | `/inventory/batches?item_id=&clinic_id=&expiring_within=&active_only=` | manager | фильтры | `Batch[]` | Список партий |
  | GET | `/inventory/items?limit=1000` | manager | — | `Item[]`/`{items}` | Справочник номенклатуры (для маппинга и фильтра) |
  | GET | `/manager/clinics/` | manager | — | `Clinic[]` | Справочник клиник (маппинг и фильтр) |
  | POST | `/inventory/batches/{id}/writeoff` | manager | `{quantity, reason, comment}` | — | Ручное списание из партии |

- **Зависимости:** `api` из `../api`; `Card, Button, EmptyState, Modal, useToast` из `../design`; `./_ManagerShell`.
- **Где менять для типовых задач:**
  - Пороги/цвета сроков годности — `expiryBucket` (стр. 60-68) и `BUCKET_STYLE` (стр. 70-76); сводка строится автоматически по бакетам в `summary` (стр. 152-156).
  - Причины списания — `WRITEOFF_REASONS` (стр. 41-47).
  - Колонки desktop-таблицы — стр. 246-300; mobile-карточки — стр. 305-358 (две независимые вёрстки, менять обе).
  - Валидация списания — `submit` в `WriteoffModal` (стр. 404-425): проверка `qty > 0` и `qty <= qty_remaining`.
- **Подводные камни:** **имена номенклатуры и клиники не приходят в самой партии** — резолвятся через `itemMap`/`clinicMap` по `item_id`/`clinic_id` из отдельных справочников (стр. 110-115, 259-260); если справочник не загрузился, в таблице будут прочерки. Справочник `items` грузится с `limit:1000` — при большем каталоге часть имён не отобразится. Бакеты считают только по загруженным (отфильтрованным сервером) партиям, поэтому при включённом фильтре сводка отражает не весь склад. `daysUntil` обнуляет время до полуночи (стр. 53) — граница «истекло» считается по дате, не по моменту. `WriteoffModal` при отсутствии `batch` рендерит пустую закрытую `Modal` (стр. 400-402) — не ошибка, а защита.
- **Строк:** 495

---

### Сводные наблюдения по группе
- **4 из 12 файлов — тонкие lazy-обёртки** (`ManagerChatPage`, `ManagerDoctorLoadPage`, `ManagerForecast`) и одна не-lazy обёртка (`ManagerDoctors`); вся логика этих разделов лежит в `../sections/*`. Менять поведение там, а не в страницах.
- **Единый источник навигации** `MGR_NAV` / `MGR_NAV_GROUPS` экспортируется из `_ManagerShell.jsx` и переиспользуется дашбордом — добавление раздела в кабинет делается там.
- **Две денежные системы**: бонусные баллы «Б» (Bonuses, Dashboard, History) и рубли (Finance) — не путать при форматировании.
- **Клиентская фильтрация поверх серверной пагинации** в `ManagerHistory` (телефон) и `ManagerInventory` (категории) — потенциальные «пропажи» данных за пределами загруженной страницы.
- **Декоративная синтетика** в `ManagerDashboard` (sparkline и «+N п.п.») — не реальные данные; легко принять за метрику.
