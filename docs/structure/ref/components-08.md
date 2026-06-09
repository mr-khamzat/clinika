# components [08] — UI подписок: мастер активации за наличные + витрина/редактор тарифов

Эта группа — целиком про **модуль подписок «КлиникСеть»** (Глава 9). Файлы разбиты на две папки:

- `components/subscription-cash/` (5 файлов) — шаги визарда менеджера, который активирует подписку пациенту **за наличные** в кабинете клиники. Родитель-композитор — `ManagerSubscriptionCashSection` (в этот срез не входит); он держит state и склеивает шаги Step 1…Step 5.
- `components/subscription/` (10 файлов) — компоненты **витрины тарифов для пациента** (карточки, таблица сравнения, bottom-sheet деталей, модал отмены) и **админ/franchise-редактора тарифов** (PlanEditorModal + его дочерние редакторы фич и буллетов).

Общие черты: все — чистые презентационные React-компоненты (function-components, без классов), стилизованы **inline-стилями** + точечно Tailwind-утилитами и иконками `material-symbols-outlined`. Сетевые вызовы делают только три из пятнадцати (`PatientSearchPicker`, `PlanEditorModal`, и косвенно `CancelModal` через колбэк родителя). Палитры тарифов (`health_plus` золото→фиолет, `family_plus` голубой→индиго, `pro` изумруд/фиолет) дублируются почти в каждом файле — это техдолг, единого источника палитр нет.

| Файл | Назначение в 5-7 слов | Строк |
|---|---|---|
| `subscription-cash/PatientSearchPicker.jsx` | Поиск/автокомплит пациента, создание из МИС | 309 |
| `subscription-cash/PaymentConfirmStep.jsx` | Подтверждение наличной оплаты, сводка заказа | 262 |
| `subscription-cash/PeriodSelector.jsx` | Выбор периода 1/3/6/12 мес со скидками | 163 |
| `subscription-cash/PlanSelector.jsx` | Выбор тарифа: 3 премиум-карточки | 202 |
| `subscription-cash/SuccessReceipt.jsx` | Финальный экран успеха + квитанция | 190 |
| `subscription/BenefitsBulletEditor.jsx` | Редактор строк-буллетов привилегий | 113 |
| `subscription/BenefitsCategoryAccordion.jsx` | Раскрывающийся блок деталей категории | 195 |
| `subscription/BenefitsList.jsx` | Сетка статусов привилегий пациента | 68 |
| `subscription/CancelModal.jsx` | Модал отмены подписки с причиной | 140 |
| `subscription/FeaturesToggleList.jsx` | Тумблеры/слайдеры фич тарифа | 132 |
| `subscription/InquireBottomSheet.jsx` | Мобильный bottom-sheet деталей привилегии | 255 |
| `subscription/PlanCardV2.jsx` | Премиум-карточка тарифа для пациента | 293 |
| `subscription/PlanComparisonCard.jsx` | Карточка тарифа для franchise_owner | 170 |
| `subscription/PlanComparisonTable.jsx` | Таблица сравнения тарифов (desktop) | 221 |
| `subscription/PlanEditorModal.jsx` | Модал создания/редактирования тарифа | 341 |

---

## `frontend/src/components/subscription-cash/PatientSearchPicker.jsx`

- **Назначение:** Step 1 визарда наличной активации. Поле поиска с автокомплитом по PatientAccount + МИС; при выборе пациента из МИС (без личного кабинета) сначала автоматически создаёт ему PatientAccount, потом отдаёт наверх.
- **Ключевые элементы:** `default export PatientSearchPicker({ onSelect, onCreateNew })`; внутренние хелперы `colorFor(s)` (стабильный цвет аватара по хешу имени), `initials(name)`; локальные состояния `q/items/loading/open/activeIdx`; debounce 300 мс через `tmRef`; клавиатурная навигация (`onKey`: ↑/↓/Enter/Esc); закрытие по клику вне (`wrapRef` + `mousedown`).
- **Эндпоинты:** не роутер, но дёргает API напрямую:

| Метод | Путь | Принимает | Возвращает | Назначение |
|---|---|---|---|---|
| GET | `/manager/subscription-cash/search-patients` | params `q`, `limit=8` | `{patients:[...]}` | Поиск в ЛК + МИС |
| POST | `/manager/subscription-cash/ensure-patient` | `{phone, full_name, mis_patient_id}` | созданный PatientAccount | Завести ЛК для МИС-пациента |

- **Зависимости:** `apiClient` (`../../api`); React-хуки `useEffect/useRef/useState`. Связан с родителем через колбэки `onSelect(patient)` и `onCreateNew()`.
- **Где менять для типовых задач:** изменить минимум символов для поиска — условие `q.trim().length < 2` (стр. 53) и в dropdown-гарде (стр. 192); поменять задержку — `setTimeout(..., 300)`; поведение для МИС-пациента — ветка `if (p?.from_mis)` в `pick`; бейджи в строке результата (МИС/подписка) — блок `p.from_mis &&` / `p.subscription_plan_key &&`.
- **Подводные камни:** обе сетевые ошибки **молча проглатываются** (`catch {}` — пользователь видит только пропавшую крутилку, без тоста). Поле `from_mis` после успешного `ensure-patient` принудительно ставится в `false` в `merged`. Ключ React-списка хрупкий — fallback `mis-${...} || idx-${i}` (если `id` пустой и `mis_patient_id` пустой, получится числовой `0` от `||`). Tenant-фильтрация — целиком на backend.
- **Строк:** 309

---

## `frontend/src/components/subscription-cash/PaymentConfirmStep.jsx`

- **Назначение:** Step 4 — итоговая сводка заказа (пациент/тариф/период/сумма) и ввод фактически полученной наличными суммы; большая золотая кнопка «Активировать тариф».
- **Ключевые элементы:** `default export PaymentConfirmStep({ patient, planTitle, months, priceTotal, amount, setAmount, note, setNote, busy, onActivate, onBack })`; `useMemo` `diff` — считает расхождение `amount` vs `priceTotal`, флаг `warn` при `pct > 0.05` (5%).
- **Эндпоинты:** нет — фактический POST делает родитель в `onActivate`.
- **Зависимости:** только `useMemo`. Полностью controlled — все данные и сеттеры приходят из `ManagerSubscriptionCashSection`.
- **Где менять для типовых задач:** порог предупреждения о расхождении — `pct > 0.05`; текст предупреждения (переплата/скидка) — тернарник по `diff.delta > 0`; условие блокировки кнопки активации — `disabled={busy || !Number(amount || 0)}` (нулевая сумма запрещена).
- **Подводные камни:** `amount` — строка из `<input type="number">`, везде оборачивается в `Number(...)`; пустая строка → `0`. Склонение «месяц/месяца/месяцев» захардкожено инлайн (стр. 81) — не вынесено в утилиту, дублирует логику из `PeriodSelector`. Никакой серверной валидации тут нет — только визуальное предупреждение.
- **Строк:** 262

---

## `frontend/src/components/subscription-cash/PeriodSelector.jsx`

- **Назначение:** Step 3 — выбор периода (1/3/6/12 мес) четырьмя toggle-кнопками со скидками и крупным блоком расчёта итоговой суммы.
- **Ключевые элементы:** `default export PeriodSelector({ priceMonthly, value, onChange })`; **именованные экспорты** `PERIOD_OPTIONS` (массив {months, discount, label}) и `calcPrice(priceMonthly, months) → {gross, total, discount}` — переиспользуются родителем для расчёта суммы к оплате.
- **Эндпоинты:** нет.
- **Зависимости:** `useMemo`. `calcPrice`/`PERIOD_OPTIONS` — публичный API файла для `ManagerSubscriptionCashSection`.
- **Где менять для типовых задач:** **матрица скидок** — единственный источник в `PERIOD_OPTIONS` (1м→0, 3м→5%, 6м→10%, 12м→15%); добавить период — добавить элемент массива (сетка авто `grid-cols-4`). Формула цены — `calcPrice` (`gross = priceMonthly*months`, `total = round(gross*(1-discount))`).
- **Подводные камни:** все суммы считаются через `Math.round` в **числах с плавающей точкой** (не Decimal) — это фронт-превью, **итоговую сумму обязан пересчитать backend**; не полагаться на это значение как на источник истины. Скидки дублируют значения в склонениях с `PaymentConfirmStep`.
- **Строк:** 163

---

## `frontend/src/components/subscription-cash/PlanSelector.jsx`

- **Назначение:** Step 2 — выбор тарифа тремя премиум-карточками (Здоровье+ / Семья+ / Pro). При отсутствии данных от API показывает встроенный fallback.
- **Ключевые элементы:** `default export PlanSelector({ plans, onSelect })`; константы `FALLBACK_PLANS` (3 захардкоженных тарифа с ценами 290/590/990 и benefits), `PALETTES` (цвета по ключу), `RECOMMENDED = 'health_plus'`. Логика `source`: берёт из API только 3 известных ключа, остальное — fallback.
- **Эндпоинты:** нет (данные приходят через prop `plans`).
- **Зависимости:** только React-разметка; колбэк `onSelect(plan.key)`.
- **Где менять для типовых задач:** дефолтные цены/привилегии при недоступном API — `FALLBACK_PLANS`; какой тариф «ПОПУЛЯРНЫЙ» — `RECOMMENDED`; цвета/иконки карточек — `PALETTES`.
- **Подводные камни:** **жёстко завязан на 3 ключа** `health_plus/family_plus/pro` — новый тариф из API, которого нет в `FALLBACK_PLANS`, **не отобразится** (строка `FALLBACK_PLANS.map(fb => plans.find(...) || fb)` итерирует по fallback, а не по API). `FALLBACK_PLANS` дублирует данные `PlanComparisonTable.FALLBACK_MATRIX` и `PALETTES` — три источника правды про одни тарифы.
- **Строк:** 202

---

## `frontend/src/components/subscription-cash/SuccessReceipt.jsx`

- **Назначение:** Step 5 — финальный экран успешной активации: анимированная зелёная галка, итог (тариф/пациент/срок), опц. предупреждение о скидке от backend, три действия (печать квитанции, Telegram, активировать ещё).
- **Ключевые элементы:** `default export SuccessReceipt({ patient, planTitle, expiresAt, receiptUrl, discountWarning, onReset, onTelegram })`; хелпер `fmtDate(iso)`; `handlePrintReceipt` открывает `receiptUrl` в новой вкладке.
- **Эндпоинты:** нет; PDF-квитанция — это готовый `receiptUrl` от backend.
- **Зависимости:** нет импортов (чистая разметка + CSS-анимации `successPop`/`checkDraw`).
- **Где менять для типовых задач:** кнопка Telegram рендерится только если передан `onTelegram` (опц. фича); кнопка печати дизейблится при пустом `receiptUrl`; формат даты — `fmtDate` (`toLocaleDateString ru-RU`).
- **Подводные камни:** `window.open(..., 'noopener,noreferrer')` — если popup заблокирован браузером, тихо ничего не произойдёт. `discountWarning` отображается as-is из backend — это уже отрендеренный человекочитаемый текст.
- **Строк:** 190

---

## `frontend/src/components/subscription/BenefitsBulletEditor.jsx`

- **Назначение:** Редактор простого списка строк-привилегий (буллетов), которые пациент видит на карточке тарифа. Используется внутри `PlanEditorModal`.
- **Ключевые элементы:** `default export memo(BenefitsBulletEditor)` с props `{ value: string[], onChange }`; операции `add/update(idx,v)/remove(idx)/move(idx,dir)`; локальный `draft` для нового пункта (Enter = добавить).
- **Эндпоинты:** нет — fully controlled, состояние держит родитель.
- **Зависимости:** `memo, useState`. Подключается лениво (`lazy`) из `PlanEditorModal`.
- **Где менять для типовых задач:** перестановка/удаление пунктов — `move`/`remove`; добавить кнопку или валидацию длины — блок ввода внизу (`draft`/`add`).
- **Подводные камни:** ключ списка — индекс `key={idx}`, при перестановке (`move`) React переиспользует DOM-ноды по позиции — для текстовых инпутов это работает, но при будущем добавлении анимаций будут глитчи. Использует CSS-переменные `--bg-2`/`--line`/`--brand` с fallback'ами (тема может не определять их).
- **Строк:** 113

---

## `frontend/src/components/subscription/BenefitsCategoryAccordion.jsx`

- **Назначение:** Desktop-блок «развернуть детали категории привилегии» (сколько анализов/консультаций доступно, скидка, периодичность, примеры-чипы) с CTA «Открыть полный список в чате». Состояния loading/error/data/empty.
- **Ключевые элементы:** `default export BenefitsCategoryAccordion({ planKey, categoryKey, data, loading, error, onInquireFull, onClose, accent })`; хелпер `findCategory(data, categoryKey)` — ищет в `data.categories_breakdown` по `key|slug|category_key`, фолбэк на первый элемент.
- **Эндпоинты:** нет — `data` приходит готовым из родителя (родитель грузит `/benefits-detail`).
- **Зависимости:** нет импортов. Колбэки `onInquireFull(planKey, categoryKey)`, `onClose()`. Парная мобильная версия — `InquireBottomSheet`.
- **Где менять для типовых задач:** структура карточки данных (`available_count/total_in_clinic/discount/frequency/examples`) задаёт, какие поля бэка ожидаются — менять тут при изменении контракта `/benefits-detail`; лимит чипов — `cat.examples.slice(0, 8)`.
- **Подводные камни:** **дублирует `findCategory` и почти весь data-блок с `InquireBottomSheet`** — при правке контракта надо синхронно править оба файла. Цвета захардкожены HEX'ами (`#0F172A`, `#64748B` и т.д.), не через токены темы.
- **Строк:** 195

---

## `frontend/src/components/subscription/BenefitsList.jsx`

- **Назначение:** Сетка «иконка + название + статус» текущих привилегий активной подписки пациента. Питается объектом с `/patient/subscription/benefits`.
- **Ключевые элементы:** `default export BenefitsList({ benefits })`; константа `ITEMS` — массив из 6 дескрипторов `{key, icon, label, good(v), fmt(v)}`, где `good` определяет «включено», а `fmt` форматирует значение.
- **Эндпоинты:** нет (данные через prop).
- **Зависимости:** нет импортов.
- **Где менять для типовых задач:** добавить/убрать привилегию в выводе — элемент массива `ITEMS` (ключ должен совпадать с полем из API); правило «зелёная/серая плашка» — функция `good`.
- **Подводные камни:** строка `if (!isOn && val === undefined) return null` — недоступная привилегия, которой нет в ответе бэка, скрывается полностью; если же бэк прислал `false`/`0` — рисуется серая плашка «недоступно». То есть видимость зависит от того, **прислал ли бэк ключ вообще**. Ключи `ITEMS` (`chat_unlimited`, `appointment_discount_pct`...) — отдельный нейминг, **не совпадает** с `features`-ключами в `FeaturesToggleList` (`unlimited_chat`, `discount_percent`...) — два разных словаря привилегий в одном модуле.
- **Строк:** 68

---

## `frontend/src/components/subscription/CancelModal.jsx`

- **Назначение:** Модал отмены подписки пациентом: радио-причина + комментарий + предупреждение о потере привилегий и дате окончания. Используется в `PatientSubscriptionSection`.
- **Ключевые элементы:** `default export CancelModal({ open, planName, expiresAt, onClose, onSubmit })`; константа `REASONS` (6 причин); state `reason/comment/busy/error`; `submit` — `await onSubmit({reason, comment})`, на ошибке достаёт `e.response.data.detail`.
- **Эндпоинты:** нет — POST делает родитель через `onSubmit`.
- **Зависимости:** **`Modal` и `Button` из `../../design`** (единственный в группе файл, использующий design-систему вместо чистого inline-модала); `useState`.
- **Где менять для типовых задач:** список причин отмены — `REASONS`; текст «что вы потеряете» — статичный абзац (стр. 80-82), **захардкожен** и не синхронизирован с реальными фичами тарифа; обработка ошибок — `catch` в `submit`.
- **Подводные камни:** `planName` имеет дефолт `'Здоровье+'` — если родитель забыл передать, в UI покажется неверный тариф. Текст потери привилегий статичен — для Pro/Family+ он формально неточен.
- **Строк:** 140

---

## `frontend/src/components/subscription/FeaturesToggleList.jsx`

- **Назначение:** Редактор объекта `features` тарифа (доступ к функциям): 4 тумблера + слайдер скидки 0-50% + числовое поле членов семьи. Дочерний компонент `PlanEditorModal`.
- **Ключевые элементы:** `default export memo(FeaturesToggleList)` props `{ value, onChange }`; внутренние под-компоненты `Row`, `Toggle`; константа `TOGGLE_FIELDS` (4 булевых фичи); сеттер `set(k,v) → onChange({...features, [k]:v})`.
- **Эндпоинты:** нет.
- **Зависимости:** `memo`. Лениво импортируется в `PlanEditorModal`.
- **Где менять для типовых задач:** добавить булеву фичу — элемент `TOGGLE_FIELDS`; диапазон скидки — атрибуты `min/max` у `type="range"`; лимит членов семьи — `Math.max(0, Math.min(10, ...))` (стр. 120).
- **Подводные камни:** **канонический список ключей features** этого модуля: `unlimited_chat, discount_percent, family_members_allowed, telemedicine_unlimited, priority_booking, monthly_supply` (см. также `DEFAULT_FEATURES` в `PlanEditorModal`). Этот словарь **не совпадает** с ключами `BenefitsList.ITEMS` и со строками `ROWS` в `PlanComparisonTable` — три параллельных представления привилегий. `discount_percent` приводится к `Number`, `family_members_allowed` зажимается 0..10.
- **Строк:** 132

---

## `frontend/src/components/subscription/InquireBottomSheet.jsx`

- **Назначение:** Мобильная (full-screen, slide-up, blurred backdrop) альтернатива `BenefitsCategoryAccordion`: те же детали категории привилегии в формате bottom-sheet с Esc-закрытием и scroll-lock.
- **Ключевые элементы:** `default export InquireBottomSheet({ open, onClose, planKey, categoryKey, data, loading, error, onInquireFull, accent })`; **своя копия** `findCategory`; `useEffect` — блокировка скролла body + слушатель Escape; CSS-анимации `inq-slide`/`inq-fade`.
- **Эндпоинты:** нет — `data` готова от родителя.
- **Зависимости:** `useEffect`. Семантический двойник `BenefitsCategoryAccordion` (тот же контракт данных, тот же CTA `onInquireFull`).
- **Где менять для типовых задач:** маппинг ключа плана → название (стр. 106) **захардкожен инлайн** (`health_plus → Здоровье+` и т.д.) — менять тут И в других файлах; контент категории — те же поля `available_count/discount/frequency/examples`, что в аккордеоне.
- **Подводные камни:** **дублирует `findCategory` и data-блок с `BenefitsCategoryAccordion`** — правки контракта нужно вносить в оба. Маппинг названий планов локальный, рассинхрон с `FALLBACK_PLANS`/`PALETTES` возможен. Здесь `examples` показываются **все** (без `.slice`), в аккордеоне — `.slice(0,8)`.
- **Строк:** 255

---

## `frontend/src/components/subscription/PlanCardV2.jsx`

- **Назначение:** Главная премиум-карточка тарифа в кабинете **пациента** (`PatientSubscriptionSection`). Поддерживает помесячно/годовой биллинг, бейджи «Популярный»/«Активен», превью-чипы привилегий с «Подробнее →», ветвление CTA: онлайн-оплата / «активировать наличными в клинике» / «активный тариф» / «по умолчанию (free)».
- **Ключевые элементы:** `default export PlanCardV2({ plan, billing, featured, loading, current, onSelect, onBenefitDetail, onInquireCash, moduleActive })`; под-компонент `BenefitChip` (рендерит `detail_key` → кнопку «Подробнее»); константы `PALETTES`, `ICON_FOR_PLAN`. Расчёт: `annual = monthly * 10` (= 2 мес в подарок, ~17%); `summary` из `plan.summary_benefits` либо плоского `plan.benefits`.
- **Эндпоинты:** нет. Колбэки: `onSelect()` (онлайн-оплата), `onInquireCash()` (наличные), `onBenefitDetail(detail_key)`.
- **Зависимости:** нет импортов. Источник `detail_key` для чипа → попадает в `onBenefitDetail`, который родитель прокидывает в `BenefitsCategoryAccordion`/`InquireBottomSheet`.
- **Где менять для типовых задач:** **бизнес-правило годовой цены** — `const annual = monthly * 10` (стр. 99) — это фронт-эвристика, не из API; кнопки CTA — каскад `current ? ... : isFree ? ... : moduleActive ? ... : onInquireCash`; флаг `moduleActive=false` отключает онлайн-оплату и показывает наличный путь (связь с feature-флагом модуля подписок у тенанта).
- **Подводные камни:** все цены — `Number(...)` во float; годовая цена и экономия 17% **захардкожены на фронте** (если бэк отдаёт `price_annual` — он тут игнорируется, в отличие от `PlanComparisonCard`, который показывает `plan.price_annual`). hover-эффект меняет `style.transform/boxShadow` императивно через `onMouseEnter/Leave` (не через CSS-класс) — потенциально дёргано на слабых устройствах. `PALETTES` снова продублированы (отличаются от `PlanSelector`!).
- **Строк:** 293

---

## `frontend/src/components/subscription/PlanComparisonCard.jsx`

- **Назначение:** Карточка тарифа для кабинета **franchise_owner**: показывает итоговый план после применения override, бейдж «Изменён», кнопки «Редактировать» и «Сбросить override».
- **Ключевые элементы:** `default export memo(PlanComparisonCard)` props `{ plan, onEdit, onReset, highlight }`; константа `PLAN_THEME` (свои градиенты!); хелпер `fmt(price)` через `Intl.NumberFormat ru-RU`; флаг `overridden = !!plan.has_override`.
- **Эндпоинты:** нет — действия делегируются `onEdit`/`onReset` родителю.
- **Зависимости:** `memo`. Открывает `PlanEditorModal` через `onEdit`.
- **Где менять для типовых задач:** кнопка сброса показывается только при `overridden && onReset`; набор отображаемых фич внизу — блок `features.discount_percent/family_members_allowed/telemedicine_unlimited`; цвета — `PLAN_THEME` (отдельная палитра, **не** `PALETTES`!).
- **Подводные камни:** ещё одна **независимая палитра** `PLAN_THEME` с другими цветами (бирюза/розовый/янтарь), не совпадает ни с `PlanCardV2.PALETTES`, ни с `PlanSelector.PALETTES` — визуальный рассинхрон между кабинетами. `benefits.slice(0,5)` — показывает только первые 5 буллетов. Ожидает поля `has_override`, `plan_key`, `price_monthly`, `price_annual`.
- **Строк:** 170

---

## `frontend/src/components/subscription/PlanComparisonTable.jsx`

- **Назначение:** Desktop-таблица сравнения тарифов (строки — привилегии, колонки — не-free планы, отсортированы по цене), с подсветкой рекомендуемого и CTA «Подключить» в футере.
- **Ключевые элементы:** `default export PlanComparisonTable({ plans, recommend, billing, onSelect })`; константы `ROWS` (9 строк сравнения), `FALLBACK_MATRIX` (значения по тарифам, если API не дал), `PALETTES`; функция `resolveCell(plan, row)` — приоритет: `plan.features[row.key]` → `summary_benefits.find(detail_key)` → `FALLBACK_MATRIX[plan.key]` → `null`; под-компонент `Cell` (галка/прочерк/значение).
- **Эндпоинты:** нет.
- **Зависимости:** нет импортов; `onSelect(planKey)`.
- **Где менять для типовых задач:** строки сравнения — `ROWS`; значения по умолчанию (когда бэк молчит) — `FALLBACK_MATRIX`; правило извлечения ячейки — `resolveCell`. На mobile таблица **не прячется сама** — родитель должен обернуть в `hidden md:block` (см. шапку файла).
- **Подводные камни:** `billing` принимается, но **нигде не используется** (мёртвый prop — таблица всегда показывает месячную цену). `FALLBACK_MATRIX` — четвёртый источник правды о привилегиях тарифов (рядом с `PlanSelector.FALLBACK_PLANS`, `FeaturesToggleList.TOGGLE_FIELDS`, `BenefitsList.ITEMS`) и легко рассинхронизируется. `ROWS[].key` (`chat/lab/consult...`) — снова свой словарь, не совпадает с features-ключами.
- **Строк:** 221

---

## `frontend/src/components/subscription/PlanEditorModal.jsx`

- **Назначение:** Модал создания/редактирования тарифа подписки в админке/franchise-кабинете. Два режима: `global` (платформенный шаблон) и `override` (переопределение для конкретного тенанта). Единственный файл группы, который **сам пишет в API**.
- **Ключевые элементы:** `default export PlanEditorModal({ plan, mode, tenantId, lockPlanKey, hideActive, onClose, onSaved })`; хелперы `blankForm()`, `fromPlan(p)`, константа `DEFAULT_FEATURES`; под-компоненты `Field`, `inputStyle(disabled)`; ленивые `FeaturesToggleList`, `BenefitsBulletEditor` (через `lazy`+`Suspense`); валидация в `save` (title, price_monthly, формат plan_key `^[a-z][a-z0-9_]+$`).
- **Эндпоинты:** дёргает напрямую:

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| POST | `/admin/subscription-plans/global` | admin | payload тарифа | план | Создать глобальный шаблон |
| PATCH | `/admin/subscription-plans/global/{id}` | admin | payload | план | Редактировать шаблон (при `lockPlanKey`) |
| POST | `/admin/subscription-plans/override` | franchise/admin | payload + `tenant_id` | план | Создать override тенанта |
| PATCH | `/admin/subscription-plans/override/{id}` | franchise/admin | payload + `tenant_id` | план | Редактировать существующий override |

- **Зависимости:** `api` (`../../api`); React `useState/useEffect/lazy/Suspense`; дочерние `FeaturesToggleList` + `BenefitsBulletEditor` (lazy). Открывается из `PlanComparisonCard.onEdit` и админских экранов.
- **Где менять для типовых задач:** выбор эндпоинта (POST vs PATCH, global vs override) — каскад в `save` (стр. 96-113); правила валидации — начало `save`; дефолтные фичи нового тарифа — `DEFAULT_FEATURES`; набор полей формы — `blankForm`/`fromPlan` + JSX `Field`.
- **Подводные камни:** **`tenant_id` обязателен для `mode='override'`** — иначе `throw new Error('tenant_id required')`; для override используется `plan.has_override && plan.id` чтобы выбрать PATCH (без них — POST, создаст новый). `price_monthly`/`price_annual` отправляются как `Number(...)` (float), `price_annual===''` → `null` (бэк сам посчитает ×10). `plan_key` нормализуется `toLowerCase().replace(/[^a-z0-9_]/g,'')` на вводе. `is_active` скрывается для franchise (`hideActive`). Ошибки показываются из `e.response.data.detail`.
- **Строк:** 341

---

### Сквозные риски группы (для следующего разработчика)

1. **Четыре независимых словаря привилегий**: `FeaturesToggleList`/`DEFAULT_FEATURES` (features-ключи), `BenefitsList.ITEMS`, `PlanComparisonTable.ROWS`/`FALLBACK_MATRIX`, `PlanSelector.FALLBACK_PLANS`. Меняя одну привилегию — проверь все четыре.
2. **Палитры тарифов продублированы** минимум в 4 файлах (`PlanSelector`, `PlanCardV2`, `PlanComparisonCard`, `PlanComparisonTable`) с **расходящимися** цветами для одного и того же тарифа.
3. **`findCategory` + data-блок дублируются** между `BenefitsCategoryAccordion` (desktop) и `InquireBottomSheet` (mobile).
4. **Все цены на фронте — float**, годовая цена/скидки частью захардкожены (`PlanCardV2`, `PeriodSelector`); итог обязан считать backend, фронт-значения — только превью.
5. `PatientSearchPicker` молча глотает сетевые ошибки; `PlanComparisonTable.billing` — мёртвый prop.
