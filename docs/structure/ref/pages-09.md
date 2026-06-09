# pages [09] — Кабинет бухгалтера + кабинет директора (5 экранов бухгалтера, 7 экранов директора)

Этот срез — 12 страничных React-компонентов фронтенда МИС «КлиникСеть», покрывающих два управленческих кабинета:

- **Бухгалтер** (`pages/accountant/*`, 5 файлов): сводка, платежи пациентов, зарплата, расходы клиники, отчёты P&L/Cashflow. Все они оборачиваются в общий лэйаут `_AccountantShell` (передают `active="<ключ>"` для подсветки меню), читают данные через `api.get('/accountant/...')` и используют общий набор UI-примитивов из `../../design` (`Card`, `Button`, `Chip`, `Modal`, `EmptyState`). Каждый файл самодостаточен: локальные хелперы форматирования (`fmtMoney`, `fmtDate*`), локальный компонент `Field` и объект стилей `inputStyle/tableStyle/...` дублируются почти в каждом файле — это сознательный «copy-paste» паттерн, не вынесенный в общий модуль.
- **Директор** (`pages/director/*`, 6 файлов) — read-only аналитика по всей сети клиник: дашборд, ДДС, клиники, врачи, KPI/воронка, маркетинг/ROI. Все они получают период из контекста через хук `useDirectorPeriod()` (из `../DirectorLayout`), рисуют графики компонентами из `./_DirectorCharts` (`BarChart`, `DonutChart`, `FunnelChart`, `LineChart`, `StackedBarChart`, `SparkLine` + форматтеры `fmtRUB/fmtInt/fmtPct/fmtDate`) и читают данные из `api.get('/director/...')`. Характерный паттерн — `Promise.allSettled` с graceful-fallback: если бэкенд части метрик не готов, экран всё равно рисуется.
- **Один тонкий ре-экспорт** (`pages/admin/PatientEngagement.jsx`) — 12-строчная обёртка над `sections/engagement/PatientEngagement` для маршрутизации в админ-лэйауте.

Общая инфраструктура (проверено — файлы существуют): `frontend/src/pages/_AccountantShell.jsx`, `frontend/src/pages/DirectorLayout.jsx`, `frontend/src/pages/director/_DirectorCharts.jsx`, `frontend/src/design/index.js` (+ `tokens.css`), `frontend/src/api/index.js`. Дизайн целиком на CSS-переменных (`var(--fg)`, `var(--accent)`, `var(--good)`, `var(--bad)`, `var(--warn)`, `var(--bg-1/2)`, `var(--border)` и `*-soft` варианты) — менять цвета через токены, не хардкодить (исключения-хардкоды в этом срезе перечислены ниже).

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|---|---|---|
| `accountant/AccPayments.jsx` | Реестр платежей пациентов с фильтрами | 239 |
| `accountant/AccPayroll.jsx` | Зарплата сотрудников + модалка выплаты | 337 |
| `accountant/AccReports.jsx` | Отчёты P&L и Cash flow | 323 |
| `accountant/AccSpending.jsx` | Расходы клиники: список, создание, оплата | 366 |
| `accountant/AccSummary.jsx` | Дашборд бухгалтера: касса, оборот, акты | 190 |
| `admin/PatientEngagement.jsx` | Тонкий ре-экспорт engagement-секции | 13 |
| `director/DirectorCashflow.jsx` | ДДС: stacked-bar, net-line, прогноз | 227 |
| `director/DirectorClinics.jsx` | Сравнение клиник сети, сортировка | 223 |
| `director/DirectorDashboard.jsx` | Главный read-only дашборд директора | 376 |
| `director/DirectorDoctors.jsx` | Таблица врачей сети, поиск, сортировка | 181 |
| `director/DirectorKPI.jsx` | KPI-плитки, воронка, тренды 12 мес | 155 |
| `director/DirectorMarketing.jsx` | Доходы с рекламы: ROI/CPL/CAC по каналам | 251 |

---

## `frontend/src/pages/accountant/AccPayments.jsx`

- **Назначение:** Реестр платежей пациентов для бухгалтера. Таблица с фильтром по периоду (даты от/до) и статусу платежа; внизу подбивка количества и суммы успешных платежей.
- **Ключевые элементы:**
  - `export default function AccPayments()` — основной компонент.
  - Локальные хелперы: `todayISO()`, `firstOfMonthISO()`, `fmtMoney(v)`, `fmtDateTime(s)`.
  - Словари маппинга статусов: `STATUS_LABELS` (succeeded→«Оплачен», refunded→«Возврат», cancelled, pending, failed) и `STATUS_VARIANT` (статус → вариант `Chip`).
  - Локальный `Field({ label, children })`, объекты стилей `inputStyle/tableStyle/trHeadStyle/thStyle/trStyle/tdStyle`.
  - State: `dateFrom` (по умолч. 1-е число месяца), `dateTo` (сегодня), `status` (`''`=все), `items`, `loading`, `error`. `useMemo` `totalSucceeded` — сумма по `status==='succeeded'`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/accountant/payments` | Бухгалтер | query `date_from`, `date_to`, опц. `status` | массив платежей или `{items:[]}` | Список платежей пациентов за период |

  Поля платежа, которые читает UI: `id`, `created_at`/`paid_at`, `patient_name`/`patient.full_name`, `patient_phone`/`patient.phone`, `amount`, `gateway`, `status`.
- **Зависимости:** `react` (`useEffect/useMemo/useState`); `../../design` → `Card`, `Chip`, `EmptyState`; `../_AccountantShell` → `AccountantShell`; `../../api` → `api` (axios-обёртка).
- **Где менять для типовых задач:**
  - Добавить новый статус платежа — в `STATUS_LABELS` и `STATUS_VARIANT`, плюс `<option>` в `<select>` фильтра (строки 118-123).
  - Изменить набор колонок таблицы — `<thead>` (строки 144-149) и тело `items.map` (строки 153-179).
  - Кнопка возврата средств — заглушка `{/* Phase 2.5: возврат */}` в последней `<td>` (строка 175), сюда вешать действие.
  - Период по умолчанию — `firstOfMonthISO()`/`todayISO()` в инициализации state (строки 54-55).
- **Подводные камни:**
  - Tenant-фильтрация полностью на бэкенде (`/accountant/payments`), фронт её не контролирует.
  - `fmtMoney` использует `Number(v||0)` — суммы приходят строкой/Decimal с бэка, JS-сложение в `totalSucceeded` может накопить ошибку float; для крупных оборотов считать итог лучше на сервере.
  - Гибкий парсинг ответа (`Array.isArray(data) ? data : data?.items`) — формат ответа бэкенда не зафиксирован.
- **Строк:** 239

---

## `frontend/src/pages/accountant/AccPayroll.jsx`

- **Назначение:** Зарплата сотрудников: таблица «Начислено / Выплачено / Остаток» с выбором периода (месяц/квартал/кастом) и модалкой ручной отметки выплаты.
- **Ключевые элементы:**
  - `export default function AccPayroll()` — основной компонент.
  - `function PayoutModal({ user, onClose, onSaved })` — модалка выплаты (сумма по умолчанию = `balance`, подпись периода `monthLabel()`, комментарий).
  - Хелперы: `fmtMoney`, `monthLabel`, `startOfMonthISO/endOfMonthISO`, `startOfQuarterISO/endOfQuarterISO`; константа `MONTHS_RU`; словарь `ROLE_LABELS` (роль → русская подпись).
  - State: `period` (month|quarter|custom), `dateFrom/dateTo`, `items`, `payingUser` (объект для модалки). `useMemo` `totals` = `{ due, withDebt }`.
  - Список сортируется по `balance` DESC после загрузки.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/accountant/payroll` | Бухгалтер | query `date_from`, `date_to` | массив строк `{user_id/id, full_name/name, role, accrued, paid, balance}` | Свод по зарплате за период |
| POST | `/accountant/payroll/{user_id}/mark-paid` | Бухгалтер | body `{amount:Number, period_label:string, notes:string\|null}` | — (успех) | Зафиксировать выплату сотруднику |

- **Зависимости:** `react`; `../../design` → `Card`, `Button`, `Chip`, `Modal`, `EmptyState`; `../_AccountantShell`; `../../api`.
- **Где менять для типовых задач:**
  - Добавить роль — в `ROLE_LABELS` (строки 44-53).
  - Изменить пресеты периода — в `useEffect([period])` (строки 66-75) и `<select>` (строки 115-119).
  - Поля формы выплаты — внутри `PayoutModal` (строки 273-301): сумма / `period_label` / `notes`.
  - Цвет остатка (warn/bad/нейтральный) — выражение `bal>0?warn:bal<0?bad:fg-2` (строка 183).
- **Подводные камни:**
  - `amount: Number(amount)` отправляется как JS-число — на бэке должно конвертироваться в Decimal во избежание потери копеек.
  - Отрицательный `balance` (переплата) подсвечивается красным и кнопка становится `secondary`, но всё равно позволяет «выплатить» — проверьте серверную валидацию суммы.
  - Tenant-изоляция на бэке; фронт шлёт только `user_id`.
- **Строк:** 337

---

## `frontend/src/pages/accountant/AccReports.jsx`

- **Назначение:** Финансовые отчёты бухгалтера — два блока на одном экране: P&L (прибыль/убытки) и Cash flow (движение денег с мини-барами прихода/расхода по периодам). Общий выбор периода (пресеты 7/30/90 дней + кастом) и гранулярность для cashflow (день/неделя/месяц).
- **Ключевые элементы:**
  - `export default function AccReports()` — контейнер с фильтрами; рендерит `<PnLBlock/>` и `<CashFlowBlock/>`.
  - `function PnLBlock({ dateFrom, dateTo })` — KPI-боксы (онлайн-оплаты, касса приход/расход, ЗП, прочие расходы) + крупный `net`.
  - `function CashFlowBlock({ dateFrom, dateTo, granularity })` — построчные мини-бары (нормировка по `maxAbs`) + итоги inflow/outflow/net.
  - `function KpiBox({ label, value, color })`, `function Field({label,children})`.
  - Хелперы: `fmtMoney`, `todayISO`, `daysAgoISO(n)`, `fmtDate`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/accountant/reports/pnl` | Бухгалтер | query `date_from`, `date_to` | объект P&L | Прибыль/убытки за период |
| GET | `/accountant/reports/cashflow` | Бухгалтер | query `date_from`, `date_to`, `granularity` | массив `{date/period, inflow, outflow, net?}` | Движение денег по периодам |

  P&L читается «терпимо» к разным именам полей: `net`, `income_online_card`/`online_card`, `cash_in`/`income_cash`, `cash_out`/`expense_cash`, `payroll_paid`/`payroll`, `spending`/`other_expenses`.
- **Зависимости:** `react`; `../../design` → `Card`; `../_AccountantShell`; `../../api`.
- **Где менять для типовых задач:**
  - Добавить KPI-метрику в P&L — добавить `<KpiBox/>` в grid (строки 140-144) и вытащить поле из `data` (строки 118-123).
  - Поменять пресеты периода — `useEffect([preset])` (строки 40-44) и `<select>` (строки 57-62).
  - Логика мини-баров cashflow — нормировка `maxAbs` (строки 205-211) и ширина баров `inflowPct/outflowPct` (строки 239-240).
- **Подводные камни:**
  - Двойные имена полей (`cash_in` vs `income_cash` и т.п.) — признак нестабильного контракта с бэкендом; при правке API синхронизировать обе ветки `??`.
  - `net` берётся напрямую из ответа P&L и НЕ пересчитывается на фронте — несоответствие сумме KPI-боксов будет видно пользователю; согласовывать с серверной формулой.
  - В cashflow `net` берётся из строки, если есть, иначе `inflow-outflow` (строка 238).
- **Строк:** 323

---

## `frontend/src/pages/accountant/AccSpending.jsx`

- **Назначение:** Учёт расходов клиники: список с фильтрами (период + категория), создание расхода через модалку, отметка «Оплачено», удаление. Внизу — итог за период и сумма неоплаченного.
- **Ключевые элементы:**
  - `export default function AccSpending()` — основной компонент.
  - `function CreateSpendingModal({ onClose, onSaved })` — форма создания (название, сумма, категория, срок, флаг «регулярный», комментарий) с клиентской валидацией (`title`, `amount>0`).
  - Словари `CAT_LABELS` (rent/lab/materials/marketing/utilities/other) и `CAT_VARIANT` (категория → вариант `Chip`).
  - Хелперы `fmtMoney/todayISO/firstOfMonthISO/fmtDate`, `Field`.
  - State: фильтры `dateFrom/dateTo/category`, `items`, `showCreate`, `busyId` (блокировка кнопок строки). `useMemo` `totals` = `{ total, unpaid }`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/accountant/spending` | Бухгалтер | query `date_from`, `date_to`, опц. `category` | массив расходов или `{items:[]}` | Список расходов за период |
| POST | `/accountant/spending` | Бухгалтер | body `{title, amount:Number, category, due_date\|null, is_recurring:bool, notes\|null}` | созданная запись | Создать расход |
| POST | `/accountant/spending/{id}/mark-paid` | Бухгалтер | — | — | Отметить расход оплаченным |
| DELETE | `/accountant/spending/{id}` | Бухгалтер | — | — | Удалить расход |

- **Зависимости:** `react`; `../../design` → `Card`, `Button`, `Chip`, `Modal`, `EmptyState`; `../_AccountantShell`; `../../api`.
- **Где менять для типовых задач:**
  - Добавить категорию расхода — в `CAT_LABELS` и `CAT_VARIANT` (строки 18-33); фильтр и `<select>` модалки строятся из `CAT_LABELS` автоматически (`Object.entries`).
  - Добавить поле в форму создания — в `CreateSpendingModal` (строки 291-328) и в `body` (строки 260-267).
  - Колонки таблицы — `<thead>` (строки 154-160) и `items.map` (строки 164-218).
- **Подводные камни:**
  - Признак оплаты вычисляется как `it.paid_at || it.is_paid` — бэкенд может отдавать любое из двух полей; при правке API не сломать оба пути.
  - Удаление и mark-paid используют `window.confirm`/`alert` (строки 85, 90, 96) — нативные диалоги, не дизайн-система; для премиальности заменить на `useToast`/`Modal`.
  - `amount: Number(amount)` — те же риски Decimal vs float, что и в payroll/payments.
- **Строк:** 366

---

## `frontend/src/pages/accountant/AccSummary.jsx`

- **Назначение:** Главный экран (дашборд) бухгалтера: 3 карточки-сводки — текущая кассовая смена (cash-on-hand + статус смены), сегодняшний онлайн-оборот, акты текущего месяца. Карточки имеют кнопки навигации в смежные разделы.
- **Ключевые элементы:**
  - `export default function AccSummary()` — единственный компонент.
  - Локальный `fmtMoney(v)` (с защитой от `NaN`/пусто).
  - Загрузка одним `api.get('/accountant/summary')` в `useEffect` с флагом `alive` (защита от setState после unmount).
  - Деструктуризация ответа: `coh` (cash_on_hand), `today`, `acts`; флаг `shiftOpen`.
  - Иконки Material Symbols (`point_of_sale`, `credit_card`, `description`).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/accountant/summary` | Бухгалтер | — | `{cash_on_hand:{shift_open, shift_id, cash_start, in_total, out_total, cash_on_hand}, today:{online_card, refunded, payments_count}, acts:{total, unpaid, unpaid_amount}}` | Агрегаты для дашборда бухгалтера |

- **Зависимости:** `react`; `react-router-dom` → `useNavigate` (переходы на `/accountant/cash` и `/accountant/acts`); `../../api`; `../../design` → `Card`, `Button`; `../_AccountantShell`.
- **Где менять для типовых задач:**
  - Добавить карточку-метрику — скопировать блок `<Card>` (например строки 80-117) внутри grid и подтянуть нужное поле из `data`.
  - Изменить целевые маршруты кнопок — `nav('/accountant/cash')` (строки 110/112) и `nav('/accountant/acts')` (строка 178).
  - Формат отображения смены (старт/приход/расход) — строки 103-107.
- **Подводные камни:**
  - Структура ответа задокументирована в шапке файла, но фронт не валидирует её — при изменении контракта `/accountant/summary` поля молча станут `undefined` (показ «0 ₽»).
  - `today.refunded > 0` и `acts.unpaid_amount > 0` — условный рендер; нулевые/отсутствующие значения скрывают блоки.
  - Tenant-скоуп и расчёт cash-on-hand целиком на бэке.
- **Строк:** 190

---

## `frontend/src/pages/admin/PatientEngagement.jsx`

- **Назначение:** Тонкая страница-обёртка для маршрутизации внутри `AdminLayout`. Ре-экспортирует основной компонент `PatientEngagement` из `sections/engagement/`, пробрасывая все props (включая `token`/`adminToken`). Вся реальная логика — в секции, не здесь.
- **Ключевые элементы:**
  - `export default function PatientEngagementAdminPage(props)` → `<PatientEngagement {...props} />`.
- **Эндпоинты:** нет (не роутер; никаких вызовов API).
- **Зависимости:** `../../sections/engagement/PatientEngagement` (проверено — файл существует: `frontend/src/sections/engagement/PatientEngagement.jsx`).
- **Где менять для типовых задач:**
  - Любая логика/UI вовлечённости пациентов — НЕ здесь, а в `sections/engagement/PatientEngagement.jsx`.
  - Менять здесь — только если нужно изменить способ проброса props или обернуть в `Suspense`/error-boundary на уровне страницы.
- **Подводные камни:**
  - Это намеренная обёртка (по ТЗ, см. комментарий в файле: `case 'engagement': return <Suspense><PatientEngagement token={adminToken}/></Suspense>`), НЕ мёртвый код и НЕ дубль. Дубль имени класса (`PatientEngagement` импорт vs `PatientEngagementAdminPage` экспорт) — намеренный, чтобы избежать коллизии имён.
- **Строк:** 13

---

## `frontend/src/pages/director/DirectorCashflow.jsx`

- **Назначение:** ДДС (движение денежных средств) для директора: stacked-bar приходы/расходы по дням, линия чистого потока (net), три карточки-итога, простой прогноз на следующий месяц (линейная экстраполяция среднего за последние 30 точек × 30) и таблица операций. Экспорт в Excel/PDF.
- **Ключевые элементы:**
  - `export default function DirectorCashflow()`.
  - `async function downloadBlob(url, params, filename, toast)` — универсальный скачиватель blob через скрытую `<a>` (этот хелпер скопирован также в `DirectorClinics` и `DirectorDashboard`).
  - Период через `useDirectorPeriod()`; графики `StackedBarChart`, `LineChart`.
  - Подготовка данных: `stackItems` (приход зелёный `#059669`, расход красный `#dc2626`), `netSeries` (фиолетовый `#7c3aed`), прогноз `forecast`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/director/cashflow` | Директор | query `from`, `to` | `{series:[{date,inflow,outflow}], totals:{inflow,outflow,net}}` | Данные ДДС за период |
| GET | `/director/export/cashflow.xlsx` | Директор | query `from`, `to`; `responseType:blob` | xlsx-файл | Экспорт ДДС в Excel |
| GET | `/director/export/cashflow.pdf` | Директор | query `from`, `to`; `responseType:blob` | pdf-файл | Экспорт ДДС в PDF |

- **Зависимости:** `react`; `../../api`; `../../design` → `Card`, `Button`, `EmptyState`, `Skeleton`, `useToast`; `../DirectorLayout` → `useDirectorPeriod`; `./_DirectorCharts` → `StackedBarChart`, `LineChart`, `fmtRUB`, `fmtDate`.
- **Где менять для типовых задач:**
  - Логика прогноза (сейчас примитив × 30) — строки 71-78. Здесь же менять окно усреднения (`slice(-30)`).
  - Цвета приход/расход/net — хардкод hex в `stackItems`/`netSeries` (строки 56-67); привести к токенам при унификации.
  - Добавить формат экспорта — продублировать кнопку с новым `url`/`filename` (строки 102-125).
- **Подводные камни:**
  - **Цвета захардкожены hex'ами** (`#059669`, `#dc2626`, `#7c3aed`), а не токенами `var(--good/bad)` — расхождение с остальным дизайном.
  - Прогноз — наивная экстраполяция, не сезонная; не выдавать за «настоящий» forecast.
  - `downloadBlob` дублируется в 3 файлах — кандидат на вынос в общий util.
  - Таблица показывает только последние 30 дней (`series.slice(-30).reverse()`).
- **Строк:** 227

---

## `frontend/src/pages/director/DirectorClinics.jsx`

- **Назначение:** Сравнение клиник сети: сортируемая таблица (название, город, выручка, приёмы, маржа, рейтинг) на десктопе и карточки на мобиле. Экспорт в Excel/PDF. На MVP без карты и без детальной страницы клиники.
- **Ключевые элементы:**
  - `export default function DirectorClinics()`.
  - `downloadBlob(...)` (дубль из DirectorCashflow).
  - Конфиг колонок `COLS` (key/label/align/hideMobile).
  - Клиентская сортировка `useMemo` `sorted` + `toggleSort(key)` (строки/числа, `localeCompare('ru')` для строк).
  - State `sortKey='revenue'`, `sortDir='desc'`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/director/clinics` | Директор | query `from`, `to` | `{clinics:[{name,slug,city,revenue,appointments,margin_pct,rating}]}` | Список клиник с метриками |
| GET | `/director/pnl/by-clinic` | Директор | query `from`, `to` | `{clinics:[...]}` | Fallback-источник, если `/clinics` не реализован |
| GET | `/director/export/clinics.xlsx` | Директор | query `from`, `to`; blob | xlsx | Экспорт клиник в Excel |
| GET | `/director/export/clinics.pdf` | Директор | query `from`, `to`; blob | pdf | Экспорт клиник в PDF |

- **Зависимости:** `react`; `../../api`; `../../design` → `Card`, `Button`, `EmptyState`, `Skeleton`, `useToast`; `../DirectorLayout` → `useDirectorPeriod`; `./_DirectorCharts` → `fmtRUB`, `fmtInt`, `fmtPct`.
- **Где менять для типовых задач:**
  - Добавить/убрать колонку — править `COLS` (строки 33-40); и десктоп-таблица, и мобильные карточки (карточки рендерят выручку/приёмы/маржу вручную, строки 151-166 — не из `COLS`!).
  - Изменить дефолтную сортировку — `sortKey/sortDir` (строки 48-49).
- **Подводные камни:**
  - **Fallback-логика:** через `Promise.allSettled` если `/director/clinics` упал, но `/director/pnl/by-clinic` ответил — берётся второй источник (строки 57-67). При изменении формата держать оба совместимыми.
  - Мобильные карточки НЕ управляются `COLS` — добавив колонку, не забыть про карточный рендер.
  - Сортировка клиентская — для больших сетей перенести на бэкенд.
- **Строк:** 223

---

## `frontend/src/pages/director/DirectorDashboard.jsx`

- **Назначение:** Главный read-only дашборд директора: 4 metric-карточки (выручка, расходы, прибыль, кешфло) со sparkline и дельтой, таблица топ-клиник, donut источников, бар-чарты топ-услуг/топ-врачей, воронка, активность, алерты, сводка по сети. Кнопка экспорта сводного PDF. Адаптив grid 1→2→4 колонки.
- **Ключевые элементы:**
  - `export default function DirectorDashboard()`.
  - `function MetricCard({ label, value, delta, trend, sparkline, notice, icon, accent })` — виджет «большая цифра + sparkline».
  - `downloadBlob(...)` (дубль).
  - Хелперы внутри: `deltaStr(pct)`, `trendOf(pct)`.
  - Три параллельных запроса через `Promise.allSettled`; терпимый разбор полей (`d.top_clinics||d.clinics`, `revenue.total||revenue.value`, и т.п.).
  - Навигация `useNavigate` на `/director/clinics`, `/director/services`, `/director/doctors`, `/director/kpi`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/director/dashboard` | Директор | query `from`, `to` | агрегаты (revenue/expenses/profit/cashflow/top_*/activity/alerts/summary) | Основные метрики дашборда |
| GET | `/director/kpi/funnel` | Директор | query `from`, `to` | `{stages:[...]}` | Данные воронки |
| GET | `/director/marketing/sources` | Директор | query `from`, `to` | `{sources:[{name,count,revenue}]}` | Donut источников пациентов |
| GET | `/director/export/dashboard.pdf` | Директор | query `from`, `to`; blob | pdf | Сводный отчёт PDF |

- **Зависимости:** `react`; `react-router-dom` → `useNavigate`; `../../api`; `../../design` → `Card`, `Button`, `EmptyState`, `Skeleton`, `useToast`; `../DirectorLayout` → `useDirectorPeriod`; `./_DirectorCharts` → `BarChart`, `DonutChart`, `FunnelChart`, `SparkLine`, `fmtRUB`, `fmtInt`, `fmtPct`.
- **Где менять для типовых задач:**
  - Добавить metric-карточку — добавить `<MetricCard/>` в Row 1 grid (строки 166-204) и вытащить поле из `d`.
  - Поменять акцентные цвета карточек — prop `accent` (хардкод hex `#dc2626`/`#059669`/`#7c3aed` для расходов/прибыли/кешфло).
  - Логика «расходы вверх = плохо» — инвертированный `trend` у карточки расходов (строка 181).
- **Подводные камни:**
  - **Очень терпимый разбор** имён полей (десятки `a||b` fallback) — изменения бэкенда переживёт молча, но трудно отлаживать «почему 0».
  - **Хардкод hex-цветов** вместо токенов в карточках и `var(--bad-soft, #fee2e2)` (строка 338) — fallback-литералы.
  - Sparkline рисуется только при `length>=2` (строка 65).
  - Алерт-сообщение может быть `JSON.stringify(a)` если нет `.message/.text` (строка 339) — сырой объект в UI при неожиданном формате.
- **Строк:** 376

---

## `frontend/src/pages/director/DirectorDoctors.jsx`

- **Назначение:** Таблица врачей сети: ФИО, клиника, выработка (revenue), приёмы, средний чек, рейтинг. Поиск по ФИО/клинике, сортировка по столбцам. Мобильная версия — карточки.
- **Ключевые элементы:**
  - `export default function DirectorDoctors()`.
  - Конфиг `COLS` (name/clinic/revenue/appointments/avg_check/rating).
  - `useMemo` `filtered` — поиск (по `name`/`full_name` и `clinic`/`clinic_name`) + сортировка; `toggleSort(key)`.
  - State `sortKey='revenue'`, `sortDir='desc'`, `search`.
  - **Нет** `downloadBlob`/экспорта (в отличие от Clinics/Cashflow/Dashboard).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/director/pnl/by-doctor` | Директор | query `from`, `to` | `{doctors:[...]}` или `{items:[...]}` | Метрики врачей за период |

- **Зависимости:** `react`; `../../api`; `../../design` → `Card`, `EmptyState`, `Skeleton`; `../DirectorLayout` → `useDirectorPeriod`; `./_DirectorCharts` → `fmtRUB`, `fmtInt`.
- **Где менять для типовых задач:**
  - Колонки — `COLS` (строки 15-22); мобильные карточки рендерят выработку/приёмы/ср.чек вручную (строки 113-126 — не из `COLS`).
  - Поля поиска — фильтр в `filtered` (строки 49-52).
  - Источник данных — единственный эндпоинт `/director/pnl/by-doctor` (нет fallback, в отличие от Clinics).
- **Подводные камни:**
  - Двойные имена полей: `name`/`full_name`, `clinic`/`clinic_name`, `revenue`/`amount` — оба варианта поддержаны; сортировка по `name` падает на `full_name` через `??` (строки 54-55).
  - Сортировка/поиск клиентские — для крупной сети перенести на сервер.
  - Мобильные карточки не из `COLS` — синхронизировать вручную при добавлении колонки.
- **Строк:** 181

---

## `frontend/src/pages/director/DirectorKPI.jsx`

- **Назначение:** KPI и воронка директора: 4 плитки (средний чек, конверсия лид→оплата, % повторных/retention, LTV) + визуализация воронки продаж + 3 линейных тренда за 12 месяцев (средний чек, конверсия, retention).
- **Ключевые элементы:**
  - `export default function DirectorKPI()`.
  - `function KpiTile({ label, value, hint, accent, icon })` — плитка KPI.
  - Два параллельных запроса через `Promise.allSettled`.
  - Терпимый разбор: `trends.avg_check||k.avg_check_series`, `trends.months||k.months` и т.п.
  - Тренды рисуются только если `months.length>0`.
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/director/kpi` | Директор | query `from`, `to` | `{avg_check, conversion_pct, retention_pct, ltv, ..._delta_pct, trends:{months, avg_check, conversion, retention}}` | KPI-метрики и тренды |
| GET | `/director/kpi/funnel` | Директор | query `from`, `to` | `{stages:[...]}` | Этапы воронки |

- **Зависимости:** `react`; `../../api`; `../../design` → `Card`, `EmptyState`, `Skeleton`; `../DirectorLayout` → `useDirectorPeriod`; `./_DirectorCharts` → `FunnelChart`, `LineChart`, `fmtRUB`, `fmtInt`, `fmtPct`.
- **Где менять для типовых задач:**
  - Добавить KPI-плитку — `<KpiTile/>` в grid (строки 80-106).
  - Добавить тренд-график — `<Card>` с `<LineChart/>` в блоке трендов (строки 119-150); подтянуть серию из `trends`.
  - Цвета акцентов плиток — prop `accent` (хардкод `#7c3aed`/`#059669`/`#d97706`).
- **Подводные камни:**
  - **Хардкод hex** для акцентов плиток и цветов линий (`#1565c0`, `#7c3aed`, `#059669`).
  - Двойные имена полей трендов (`trends.X` vs `k.X_series`) — синхронизировать при правке API.
  - Блок трендов скрыт целиком, если `months` пустой — данные есть, а графиков нет = возможна путаница.
- **Строк:** 155

---

## `frontend/src/pages/director/DirectorMarketing.jsx`

- **Назначение:** Реальные доходы с рекламы: KPI (расход, доход, ROI, CPL/CAC), donut источников пациентов, horizontal-bar ROI по каналам, две таблицы (детализация каналов: расход/лиды/пациенты/доход/ROI/CPL/CAC; и «откуда пришли пациенты»). Пустые состояния подсказывают, что подключить (UTM, расходы из админ-кабинета).
- **Ключевые элементы:**
  - `export default function DirectorMarketing()`.
  - Загрузка через `Promise.all` с `.catch(e=>({data:null,_err:e}))` на каждом запросе (мягкий fallback, ошибка только если упали оба).
  - State `sources`, `roi`; деривативы `sourcesList`, `channels`, `totals`, `hasAnyData`.
  - Иконки каналов/источников — `c.icon`/`s.icon` (Material Symbols, default `help`).
- **Эндпоинты:**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/director/marketing/sources` | Директор | query `from`, `to` | `{sources:[{name, patients_count/count, pct, appointments_count, revenue, icon}], total, total_revenue}` | Откуда пришли пациенты (donut + таблица) |
| GET | `/director/marketing/roi` | Директор | query `from`, `to` | `{channels:[{channel_id, name, spent, leads, patients, revenue, roi_pct, cpl, cac, icon}], totals:{...}}` | ROI/CPL/CAC по рекламным каналам |

- **Зависимости:** `react`; `../../api`; `../../design` → `Card`, `EmptyState`, `Skeleton`; `../DirectorLayout` → `useDirectorPeriod`; `./_DirectorCharts` → `DonutChart`, `BarChart`, `fmtRUB`, `fmtInt`, `fmtPct`.
- **Где менять для типовых задач:**
  - Добавить KPI-виджет маркетинга — в первый grid (строки 82-118).
  - Колонки таблицы каналов — `<thead>` (строки 165-174) + `channels.map` (строки 177-196).
  - Тексты пустых состояний (подсказки про UTM/расходы) — `EmptyState` (строки 125-126, 141-142, 242-245).
- **Подводные камни:**
  - Использует `Promise.all` (не `allSettled`), но оборачивает каждый запрос в `.catch` → эффект тот же, но паттерн отличается от других director-страниц.
  - ROI/CPL/CAC считаются на бэке; фронт только форматирует — формулы (`Доход/Расход−100%`) подписаны в UI, согласовывать с сервером.
  - Источники атрибуции зависят от UTM-разметки и ручных расходов из админ-кабинета (Маркетинг → Расходы на рекламу) — без них экран пустой, это by design.
- **Строк:** 251

---

## Сводные риски и наблюдения по срезу

- **Дубли копипасты:** `downloadBlob` идентичен в `DirectorCashflow/DirectorClinics/DirectorDashboard`; локальные `Field` + объекты `inputStyle/tableStyle/...` дублируются во всех accountant-файлах. Кандидаты на вынос в общий util/компонент.
- **Хардкод цветов hex** вместо токенов: `#059669/#dc2626/#7c3aed/#1565c0/#d97706` встречаются в director-страницах (Cashflow, Dashboard, KPI). При перетемизации их не подхватит `tokens.css`.
- **Decimal vs float:** все денежные суммы форматируются через `Number(v||0)` и местами суммируются на клиенте (`totalSucceeded`, `totals` в payroll/spending) — для точных итогов полагаться на серверные агрегаты.
- **Контракт API нестабилен:** массовые `a||b`/`??`-fallback на имена полей и `Array.isArray(data)?data:data?.items` — фронт «прощает» разные форматы, но это маскирует ошибки бэкенда.
- **Tenant-изоляция целиком на бэкенде** — ни один файл среза не передаёт tenant_id; фронт шлёт только период/фильтры.
