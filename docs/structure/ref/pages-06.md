# pages [06] — кабинет управляющего (Manager): сотрудники, услуги, подписки, склад, телефония

Все 12 файлов — страницы кабинета управляющего (роль `manager`) фронтенда КлиникСеть. Каждая страница — это React-компонент по умолчанию, который монтируется в `App.jsx` (часть через `lazy()`) на маршрутах вида `/manager/*` и оборачивается общим макетом `_ManagerShell` (sticky topbar + нижняя навигация + кнопка «домой»). У всех страниц одинаковый каркас: проп `active` задаёт подсвеченный пункт нижнего меню (см. `MGR_NAV` в `_ManagerShell.jsx`), `title/subtitle/icon` — заголовок, `topbarRight` — кнопка в шапке.

Внутри группы два типа файлов:
- **Тонкие обёртки** (`ManagerPartnerOffers`, `ManagerRegulations`, `ManagerSubscriptionCash`, `ManagerTemplatesPage`) — просто `ManagerShell` вокруг компонента из `../sections/` или `../components/`, часто через `lazy/Suspense`. Логики в них нет — менять надо вложенный компонент.
- **Полноценные страницы** с локальным состоянием, модалками и вызовами API (`ManagerRecruitDoctors`, `ManagerServiceNorms`, `ManagerSettings`, `ManagerSubscriptionDiscounts`, `ManagerSubscriptionPending`, `ManagerSuppliers`, `ManagerTelephony`, `ManagerVisitingDoctors`).

Все обращения к бэкенду идут через единый axios-инстанс `../api` (он сам подставляет токен и tenant по slug — tenant-фильтрация на бэкенде, на фронте её нет). Важная стилевая раздвоённость: новые премиум-страницы используют CSS-токены (`var(--fg)`, `var(--accent)`, дизайн-систему `../design`), а часть страниц (`ManagerSubscriptionDiscounts`, `ManagerSubscriptionPending`) написаны на «легаси» хардкод-цветах (`#047857`, `#fff`) и собственных модалках — это техдолг по перетемизации.

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `ManagerPartnerOffers.jsx` | Обёртка: партнёрский прайс (категории + услуги) | 37 |
| `ManagerRecruitDoctors.jsx` | Управление всеми сотрудниками: CRUD, роли, доступ | 1130 |
| `ManagerRegulations.jsx` | Обёртка: чтение назначенных регламентов | 36 |
| `ManagerServiceNorms.jsx` | Нормативы расхода материалов на услугу | 442 |
| `ManagerSettings.jsx` | Услуги по категориям: цена, бонус, видимость | 608 |
| `ManagerSubscriptionCash.jsx` | Обёртка: активация подписки за наличные | 24 |
| `ManagerSubscriptionDiscounts.jsx` | Дифференцированные % скидки тарифов подписки | 348 |
| `ManagerSubscriptionPending.jsx` | Очередь заявок пациентов на подписку | 514 |
| `ManagerSuppliers.jsx` | Справочник поставщиков для приходов на склад | 410 |
| `ManagerTelephony.jsx` | Телефония: провайдер, DID-номера, история | 318 |
| `ManagerTemplatesPage.jsx` | Обёртка: шаблоны направлений (Глава 4) | 25 |
| `ManagerVisitingDoctors.jsx` | Список приезжих врачей сети, блок/удаление | 209 |

---

## `frontend/src/pages/ManagerPartnerOffers.jsx`
- **Назначение:** Страница «Партнёрский прайс» — категории и услуги в прайсе для бонусов внешним врачам. Чистая обёртка-роутер.
- **Ключевые элементы:** `export default function ManagerPartnerOffers()`. Внутри `lazy(() => import('../components/admin/PartnerOffersAdmin'))` с `Suspense` (скелетон-плейсхолдеры на pulse-анимации).
- **Зависимости:** `_ManagerShell` (макет), `../components/admin/PartnerOffersAdmin` (вся реальная логика — две вкладки «Услуги в прайсе» + «Категории»).
- **Где менять для типовых задач:** Заголовок/иконка/`active`-пункт меню — здесь. Любая бизнес-логика прайса и его эндпоинты — в `../components/admin/PartnerOffersAdmin`, не здесь.
- **Подводные камни:** `active="partner_offers"` должен совпадать с ключом в `MGR_NAV` в `_ManagerShell.jsx`, иначе пункт меню не подсветится. Lazy-load намеренный — не превращать в обычный импорт без причины.
- **Строк:** 37

## `frontend/src/pages/ManagerRecruitDoctors.jsx`
- **Назначение:** Центральная страница управления персоналом тенанта — добавление сотрудников всех ролей, полное редактирование карточки, смена логина/пароля (QR), блокировка/удаление, группировка списка по ролям. Самый большой и важный файл группы.
- **Ключевые элементы:**
  - Главный компонент `ManagerRecruitDoctors()` — стейт `doctors/clinics/search/roleFilter`, группировка `grouped`/`roleCounts`/`presentRoles` через `useMemo`.
  - Локальный `apiFetch(_token, path, opts)` — обёртка над axios `api.request`, эмулирующая `fetch` (`{ ok, status, json() }`) для совместимости со старым кодом. **Первый аргумент `_token` игнорируется** — токен подставляет axios.
  - `formatApiError(data)` — разворачивает Pydantic-422 detail (массив `{loc,msg,type}`) в читаемую строку.
  - Константы: `ROLE_META` (лейбл/иконка/цвет/порядок группы по роли), `STAFF_ROLES` (роли при создании), `ROLE_NEEDS` (какие поля нужны на роль), `ROLE_EDIT_OPTIONS` (роли, доступные для смены в карточке — должен совпадать с `ROLE_CHANGE_ALLOWED` в backend `manager/recruiter_doctors.py`).
  - Под-компоненты: `Field`, `QRPopup` (показ логина/пароля/QR после reset), `EditModal` (вкладки Профиль/Доступ, условия для visiting_doctor), `AddModal` (создание), `DeleteStaffModal` (block vs hard-delete с паролем), `StaffCard`, `GroupHeader`.
  - Действия: `openChat(doc)` — пробрасывает токены через hash в `/staff-chat?dm=` (внутренний чат, тот же паттерн что у Calls Electron).
- **Эндпоинты:** (потребляемые)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|-----------|-----------|
| GET | `/manager/all-external-doctors` | manager | — | список сотрудников | загрузка списка (несмотря на имя — все роли) |
| GET | `/manager/clinics/` | manager | — | список клиник | заполнение чипов/селектов клиник |
| GET | `/manager/recruiter-doctors/{id}/visiting-settings` | manager | — | `{settings:{price_per_visit,doctor_percent}}` | условия договора приезжего |
| PATCH | `/manager/recruiter-doctors/{id}/profile` | manager | санитизированный payload профиля | обновлённый объект | сохранение профиля (включая смену роли) |
| POST | `/manager/recruiter-doctors/{id}/reset-credentials` | manager | `{username,password}` | `{message,qr_code,credentials}` | смена логина/пароля + QR |
| PATCH | `/manager/recruiter-doctors/{id}/toggle-active` | manager | — | — | блок/разблок |
| POST | `/manager/users/create-staff` | manager | payload по `ROLE_NEEDS` | `{credentials,qr_code}` | создание сотрудника |
| DELETE | `/manager/users/{id}` | manager | — | 204 | soft-delete (блокировка) |
| DELETE | `/manager/users/{id}/hard` | manager | `{password}` | 204 | полное удаление (пароль руководителя) |

- **Зависимости:** `../api` (axios), `../design` (Card, Chip, Button, Avatar, EmptyState, Modal), `../components/QuickActions`, `_ManagerShell`, `../config` (`SLUG`), `../lib/phoneActions` (`callPhone`, `whatsappPhone`), `react-router-dom` (`useNavigate`).
- **Где менять для типовых задач:**
  - Добавить новую роль → правь `ROLE_META`, `STAFF_ROLES`, `ROLE_NEEDS` и (для возможности переключения) `ROLE_EDIT_OPTIONS`; синхронизируй с backend `recruiter_doctors.py`.
  - Новое поле профиля → `EditModal.profile` стейт + поле в JSX + санитизация в `saveProfile`.
  - Изменить набор полей при создании роли → `ROLE_NEEDS` + ветки в `AddModal.submit`.
  - Поведение удаления → `DeleteStaffModal`.
- **Подводные камни:** Tenant-фильтрация целиком на бэкенде. `apiFetch` использует `validateStatus: () => true` — ошибки не бросаются axios'ом, проверяй `r.ok` вручную. `price_per_visit`/`doctor_percent` парсятся `parseFloat` (float, не Decimal) — округление делается на бэкенде. Смена роли самому себе → backend 400. Hard-delete падает с 409 при наличии FK-связей (направления/история) — UI предлагает блокировку. `AddModal` остаётся смонтированным (Modal лишь прячет узел) — форма сбрасывается через `useEffect([open])`, не убирать. Эндпоинт `/manager/all-external-doctors` исторически возвращает всех, а не только внешних — имя вводит в заблуждение.
- **Строк:** 1130

## `frontend/src/pages/ManagerRegulations.jsx`
- **Назначение:** Страница «Мои регламенты» (Глава 7, регламент-конструктор) — назначенные управляющему регламенты и подтверждение ознакомления. Тонкая обёртка.
- **Ключевые элементы:** `ManagerRegulations()`. Грузит `/admins/me` в стейт `user` и прокидывает в `RegulationsReaderSection`.
- **Эндпоинты:** потребляет `GET /admins/me` (профиль текущего пользователя). Логика чтения регламентов — в секции.
- **Зависимости:** `../api`, `_ManagerShell`, `../sections/RegulationsReaderSection`.
- **Где менять для типовых задач:** UI и логика чтения/подтверждения регламентов — в `RegulationsReaderSection`, не здесь. Здесь — только заголовок и `active="regulations"`.
- **Подводные камни:** `useEffect` использует флаг `alive` для защиты от setState после размонтирования — стандартный паттерн, сохранять при правках.
- **Строк:** 36

## `frontend/src/pages/ManagerServiceNorms.jsx`
- **Назначение:** Редактор нормативов расхода материалов на одно оказание услуги (этап INVENTORY_COST_PLAN). Слева список услуг с поиском, справа таблица `item × qty` с подсчётом расчётной себестоимости. Используется для авто-списания при закрытии визита и расчёта себестоимости.
- **Ключевые элементы:** `ManagerServiceNorms()` — стейт `services/items/norms/selectedId`. `itemMap` (id→item), `filteredServices`, `totalCost` через `useMemo`. Действия: `loadNorms`, `addRow`/`removeRow`/`setRow`, `save` (один PUT всего списка), `copyFrom` (с клиентским fallback). Хелперы `fmtMoney`, под-компоненты `Th`/`Td`.
- **Эндпоинты:** (часть «planned» — бэкенд-агент реализует параллельно)

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|-----------|-----------|
| GET | `/manager/services/` | manager | — | список услуг | левый список |
| GET | `/inventory/items?limit=1000` | manager | — | справочник номенклатуры | селекты позиций |
| GET | `/services/{id}/consumables` | manager | — | `[{item_id,quantity}]` | норматив услуги (404 = пусто, не ошибка) |
| PUT | `/services/{id}/consumables` | manager | `[{item_id,quantity}]` | — | сохранить весь норматив |
| POST | `/inventory/norms/copy` | manager | `{from_service_id,to_service_id}` | — | копия норматива (404 → клиентский fallback) |

- **Зависимости:** `../api`, `_ManagerShell`, `../design` (Card, Button, EmptyState, Modal, useToast).
- **Где менять для типовых задач:** Поля строки норматива (новый атрибут позиции) → `loadNorms` нормализация + `setRow` + JSX таблицы. Логика себестоимости → `totalCost` (берёт `item.cost_price ?? item.price`). Копирование → `copyFrom`.
- **Подводные камни:** Страница спроектирована устойчиво к отсутствию бэкенда: 404 на `/consumables` и `/norms/copy` обрабатываются молча (показ пустого списка / клиентское копирование). `quantity` парсится через `Number(...)` (float). Валидация в `save` отклоняет пустые строки и `qty<=0`. Себестоимость — оценочная (если у items нет цен — будет 0).
- **Строк:** 442

## `frontend/src/pages/ManagerSettings.jsx`
- **Назначение:** Управление услугами тенанта по категориям (accordion + поиск). Создание/редактирование услуги: название, код, финансовая модель (цена пациенту / бонус партнёру / авто-комиссия платформы), бонус сотруднику в баллах, видимость в форме направления. Inline-правка бонуса и видимости прямо из списка.
- **Ключевые элементы:** `ManagerSettings()` — стейт `services/search/expanded/editing/saving`. Хелперы `groupByCategory`, `orderedCategoryKeys` (категория «Без категории» сверху). Под-компоненты: `ServiceFormModal` (форма с computed `platformFee = max(0, price - referral_payout)` и флагом `payoutOverPrice`), `Field`, `ServiceRow` (inline-бонус по blur/Enter, toggle видимости с оптимистичным апдейтом). Действия: `handleSubmit`, `handleBonusInline`, `handleToggleVisible`, `handleDelete` (через `confirm`).
- **Эндпоинты:** через именованные хелперы из `../api`: `listManagerServices()` (GET), `createService(data)` (POST), `updateService(id, data)` (PATCH), `deleteService(id)` (DELETE — деактивация). Все под ролью manager, tenant — на бэкенде.
- **Зависимости:** `../api` (именованные функции, не дефолт-axios), `../design` (Card, Button, EmptyState, Modal, useToast), `_ManagerShell`.
- **Где менять для типовых задач:** Новое поле услуги → `ServiceFormModal.form` стейт + поле в JSX + `submit` payload + (если показывать в списке) `ServiceRow`. Финансовая модель → `priceNum/payoutNum/platformFee` в `ServiceFormModal`. Группировка/сортировка → `groupByCategory`/`orderedCategoryKeys`.
- **Подводные камни:** Двойная финансовая модель: `referral_payout` — приоритетное поле (бонус партнёру), `bonus_amount` оставлен для совместимости со старой логикой/отчётами (до миграции svcfin01) — оба отправляются. Все суммы — `parseFloat` (float). Toggle видимости и inline-бонус — оптимистичные апдейты с откатом при ошибке. `deleteService` — это деактивация, не физическое удаление. При активном поиске все группы разворачиваются принудительно (`isExpanded`).
- **Строк:** 608

## `frontend/src/pages/ManagerSubscriptionCash.jsx`
- **Назначение:** Страница «Подписки (наличные)» — активация тарифа за наличную оплату с печатью квитанции. Чистая обёртка.
- **Ключевые элементы:** `ManagerSubscriptionCash()` — `ManagerShell active="subscription_cash"` вокруг `ManagerSubscriptionCashSection`.
- **Зависимости:** `../sections/ManagerSubscriptionCashSection` (вся логика), `_ManagerShell`.
- **Где менять для типовых задач:** Любая логика наличной активации и её эндпоинты — в `ManagerSubscriptionCashSection`. Здесь — только заголовок/иконка/`active`.
- **Подводные камни:** Нет (24 строки, без логики).
- **Строк:** 24

## `frontend/src/pages/ManagerSubscriptionDiscounts.jsx`
- **Назначение:** Управление дифференцированными процентами скидки подписочных тарифов («Здоровье+»/«Семья+»/«Pro»). Три scope: `all` (на весь план), `category` (на категорию услуг), `service` (на конкретную услугу). Миграция discountrules01.
- **Ключевые элементы:** `ManagerSubscriptionDiscounts()` — стейт `planKey/rules/services/showModal`. Константы `PLAN_OPTIONS`, `SCOPE_LABELS`. `categories` через `useMemo` из услуг. Действия `load`, `onDelete` (через `confirm`), `onToggleActive` (PATCH `is_active`). Под-компонент `AddRuleModal` (своя собственная модалка на `position:fixed`, не из `../design`; autocomplete категорий через `<datalist>`, поиск услуг).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|-----------|-----------|
| GET | `/manager/subscription/discounts?plan_key=` | manager | — | `{items:[rule]}` | список правил плана |
| POST | `/manager/subscription/discounts` | manager | `{plan_key,scope,discount_percent,is_active,[category_name|service_id]}` | rule | создать правило |
| PATCH | `/manager/subscription/discounts/{id}` | manager | `{is_active}` | rule | переключить активность |
| DELETE | `/manager/subscription/discounts/{id}` | manager | — | — | удалить правило |
| GET | `/services?limit=500` | manager | — | список услуг | autocomplete (best-effort) |

- **Зависимости:** `../api` (импортирован как `apiClient`), `_ManagerShell`. **Дизайн-систему `../design` НЕ использует.**
- **Где менять для типовых задач:** Новый план → `PLAN_OPTIONS`. Новый scope → `SCOPE_LABELS` + ветки в таблице + `AddRuleModal`. Внешний вид правила в таблице → tbody основного компонента.
- **Подводные камни:** **Легаси-стилизация** — хардкод-цвета (`#047857`, `#fee2e2`, `#fff`), кастомная модалка вместо `../design/Modal`, ошибки через `alert()` — кандидат на перетемизацию. Различие глобальных и тенантских правил: правила без `r.tenant_id` помечаются «(глобальное)», их чекбокс/удаление **заблокированы** (`disabled={!r.tenant_id}`) — глобальные правила редактирует только суперадмин. `discount_percent` форматируется `Number(...).toFixed(2)`.
- **Строк:** 348

## `frontend/src/pages/ManagerSubscriptionPending.jsx`
- **Назначение:** Очередь заявок пациентов на подписку «Здоровье+», ожидающих ручного одобрения. Три таба (pending/approved/rejected), бейдж количества pending в навигации, модалки одобрения (с суммой для наличных и переопределением месяцев) и отклонения (с причиной).
- **Ключевые элементы:** `ManagerSubscriptionPending()` — стейт `tab/items/pendingCount/modal`. `reload(status)` и `reloadCount()` (отдельный запрос для бейджа) на `useCallback`. `handleApprove`/`handleReject`. Константы `PLAN_TITLES`, `PAYMENT_LABELS`, `STATUS_TABS`. Под-компоненты: `RequestsTable` (колонки зависят от таба), `ApproveModal` (поле суммы только при `payment_method==='cash'`), `RejectModal` (валидация причины), `ModalShell`, `Field`, `Th`/`Td`. Inline-стили-объекты `btnPrimary/btnDanger/btnSecondary/inputStyle`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|-----------|-----------|
| GET | `/manager/subscription/pending?status=pending\|approved\|rejected` | manager | — | `{items:[req]}` | список заявок по статусу |
| POST | `/manager/subscription/pending/{id}/approve` | manager | `{months_override,note,[amount_received]}` | — | одобрить (создаёт подписку) |
| POST | `/manager/subscription/pending/{id}/reject` | manager | `{reason}` | — | отклонить с причиной |

- **Зависимости:** `../api` (как `apiClient`), `_ManagerShell`. **`../design` НЕ используется.**
- **Где менять для типовых задач:** Новый статус/таб → `STATUS_TABS` + колонка в `RequestsTable`. Поля одобрения → `ApproveModal` payload. Новые типы оплаты → `PAYMENT_LABELS` + логика `isCash` в `ApproveModal`.
- **Подводные камни:** **Легаси-стилизация** — хардкод-цвета и собственный `ModalShell`, ошибки через `alert()` — техдолг перетемизации. `amount_received` отправляется только для наличных (`isCash`). Бейдж pending грузится отдельным запросом `reloadCount` — после каждого approve/reject вызываются и `reload(tab)`, и `reloadCount()`. Сценарий: пациент жмёт «Хочу тариф» в моб.приложении → POST `/patient/subscription/request` → запись в pending → TG-уведомление менеджеру.
- **Строк:** 514

## `frontend/src/pages/ManagerSuppliers.jsx`
- **Назначение:** Справочник поставщиков (контрагентов) для приходов на склад (этап INVENTORY_COST_PLAN). Таблица на desktop / карточки на mobile, debounced-поиск, создание/редактирование в модалке, soft-delete (деактивация) и реактивация.
- **Ключевые элементы:** `ManagerSuppliers()` — стейт `items/search/showInactive/modalOpen/editing/form`. `load` (`useCallback` с params `search`/`is_active`). Действия `openCreate`/`openEdit`, `save` (POST или PATCH), `deactivate` (через `confirm`), `reactivate`. Константы `INPUT_STYLE`, `EMPTY_FORM`. Под-компоненты `Th`/`Td`/`Field`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|-----------|-----------|
| GET | `/inventory/suppliers?search=&is_active=` | manager | — | список поставщиков | таблица |
| POST | `/inventory/suppliers` | manager | `{name,inn,contact_person,phone,email,payment_terms,notes}` | поставщик | создание |
| PATCH | `/inventory/suppliers/{id}` | manager | частичный body (в т.ч. `{is_active:true}`) | поставщик | правка / реактивация |
| DELETE | `/inventory/suppliers/{id}` | manager | — | — | soft-delete (is_active=false) |

- **Зависимости:** `../api`, `_ManagerShell`, `../design` (Card, Button, EmptyState, Modal, useToast, Chip).
- **Где менять для типовых задач:** Новое поле поставщика → `EMPTY_FORM` + `openEdit` маппинг + `save` body + поля в таблице/карточке/модалке. Фильтры списка → `load` (params).
- **Подводные камни:** Два `useEffect` дёргают `load`: один по `[load]` (изменение `showInactive`), второй — debounce 300ms по `[search]` — потенциально двойная загрузка при первом рендере, но безвредно. ИНН чистится regex `[^\d]` и `maxLength=12`. DELETE — это soft-delete (деактивация), не физическое удаление; реактивация — через PATCH `is_active:true`. Пустые строки формы санитизируются в `null`.
- **Строк:** 410

## `frontend/src/pages/ManagerTelephony.jsx`
- **Назначение:** Настройки телефонии тенанта в трёх табах: Провайдер (выбор АТС + ключи + опции), Номера DID (CRUD городских номеров), История звонков (фильтр по направлению + поиск).
- **Ключевые элементы:** `ManagerTelephony()` — только переключатель табов. Под-компоненты: `ProviderTab` (стейт `cfg/apiKey/apiSecret`, ключи показываются как `has_api_key/has_api_secret` без раскрытия значений, при сохранении отправляются только если введены новые), `DidTab` (список + своя `position:fixed` модалка create/edit, `remove` через `confirm`), `HistoryTab` (фильтр `direction`, поиск `q` по Enter). Константы `PROVIDERS`, `FEATURES_DEFAULT`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|-----------|-----------|
| GET | `/tenant/settings/telephony` | manager | — | `{provider,api_url,is_active,features,has_api_key,has_api_secret}` | конфиг провайдера |
| PATCH | `/tenant/settings/telephony` | manager | `{provider,api_url,is_active,features,[api_key],[api_secret]}` | обновлённый конфиг | сохранить провайдера |
| GET | `/tenant/did-numbers` | manager | — | `{dids:[...]}` | список DID |
| POST | `/tenant/did-numbers` | manager | `{number,display_name,clinic_id,default_assignee_id,record_calls,is_active}` | DID | создать номер |
| PATCH | `/tenant/did-numbers/{id}` | manager | тот же payload | DID | правка номера |
| DELETE | `/tenant/did-numbers/{id}` | manager | — | — | удалить номер |
| GET | `/telephony/calls?page=&limit=&direction=&q=` | manager | — | `{calls:[...]}` | история звонков |

- **Зависимости:** `../api`, `../design` (только `useToast`), `_ManagerShell`. Часть стилей — inline хардкод-градиенты (`linear-gradient(135deg, #0097A7, #0A2342)`).
- **Где менять для типовых задач:** Новый провайдер → `PROVIDERS`. Новая опция телефонии → `FEATURES_DEFAULT` + список в `ProviderTab`. Поля DID → `DidTab.save` payload + модалка. Колонки/фильтры истории → `HistoryTab`.
- **Подводные камни:** Реальные провайдеры (Mango/Sipuni/Zadarma) **пока не подключены** — выбор лишь сохраняется в конфиге, реальный dial вернёт 503 (явно указано в инфо-блоке). Секреты не приходят с бэкенда (только флаги `has_*`); при сохранении `api_key/api_secret` отправляются только если поле непустое — не затирать существующие. `useToast()` обёрнут в `|| {}` и вызывается как `toast?.(...)` — защита от отсутствия провайдера. Частично легаси-цвета (`#0097A7`, `#fee2e2`).
- **Строк:** 318

## `frontend/src/pages/ManagerTemplatesPage.jsx`
- **Назначение:** Страница «Шаблоны направлений» (Глава 4) — повторяющиеся комбинации услуг для быстрого создания направления. Тонкая обёртка с lazy-загрузкой.
- **Ключевые элементы:** `ManagerTemplatesPage()` — `ManagerShell active="templates"` + `Suspense` вокруг `lazy(() => import('../sections/ManagerReferralTemplates'))`.
- **Зависимости:** `_ManagerShell`, `../sections/ManagerReferralTemplates` (вся логика).
- **Где менять для типовых задач:** Логика шаблонов и эндпоинты — в `ManagerReferralTemplates`. Здесь — только заголовок/`active`.
- **Подводные камни:** Нет (25 строк).
- **Строк:** 25

## `frontend/src/pages/ManagerVisitingDoctors.jsx`
- **Назначение:** Отдельный раздел со списком приезжих врачей (`visiting_doctor`) всей сети тенанта. Поиск, блокировка/разблокировка, удаление. Создание приезжих — на странице «Сотрудники» (`ManagerRecruitDoctors`), здесь только просмотр/управление.
- **Ключевые элементы:** `ManagerVisitingDoctors()` — стейт `doctors/search/busy`. `load` (фильтрует по `type === 'visiting'`), `toggleActive`, `remove` (через `window.confirm`, `alert` при ошибке), `filtered`. Карточка врача отрисована inline (Avatar, Chip, контакты, клиники, действия).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|-----------|-----------|
| GET | `/manager/all-external-doctors` | manager | — | список (фильтруется по visiting) | загрузка |
| PATCH | `/manager/recruiter-doctors/{id}/toggle-active` | manager | — | — | блок/разблок |
| DELETE | `/manager/all-external-doctors/{id}` | manager | — | — | удаление приезжего |

- **Зависимости:** `../api`, `../design` (Card, Chip, Button, Avatar, EmptyState), `_ManagerShell`.
- **Где менять для типовых задач:** Внешний вид карточки приезжего → JSX внутри `filtered.map`. Набор действий → блок «Действия». Создание/смена кредов приезжего делается в `ManagerRecruitDoctors` — туда за расширенным функционалом (карточка/QR).
- **Подводные камни:** Делит эндпоинт `/manager/all-external-doctors` с `ManagerRecruitDoctors`, но фильтрует на клиенте `(d.type || 'visiting') === 'visiting'` — фактически частичный дубль/упрощённая версия той страницы (без EditModal, QR, групп). DELETE здесь — другой эндпоинт (`/manager/all-external-doctors/{id}`), не `/manager/users/{id}` как в RecruitDoctors. Ошибки показываются через `alert()` (легаси-UX). Tenant — на бэкенде.
- **Строк:** 209
