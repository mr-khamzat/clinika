# design [01] — Дизайн-система фронтенда (UI-kit «КлиникСеть»)

Все 21 файла лежат в `frontend/src/design/` — это **единая дизайн-система** проекта: набор переиспользуемых React-компонентов, реализующих макет `design-preview-2`. Компоненты **презентационные** (не ходят в API, не знают про tenant_id, не содержат бизнес-логики МИС за единственным исключением — `ClinicScopeSelector`), стилизуются исключительно через **CSS-переменные дизайн-токенов** (`var(--bg)`, `var(--fg)`, `var(--accent)`, `var(--good/warn/bad)`, `var(--radius)`, `var(--shadow-*)` и т.п.). Стиль задаётся inline-`style` + утилитарными Tailwind-классами; цвета почти нигде не хардкодятся (берутся из токенов с дефолтами-фолбэками в `.css`-инъекциях). Единая точка входа — `index.js`, через который весь остальной код импортирует компоненты как `import { Page, Card, Button, useToast } from '@/design'`.

Архитектурные паттерны, которые стоит знать сразу:
- **Глобальный CSS инжектируется лениво и единожды** через `ensureStyles()` + проверку `document.getElementById(STYLE_ID)` (в `Modal`, `Toast`, `InfoHint`, `QuickActions`). Менять стили этих компонентов нужно внутри строки `css` в самом файле, а не во внешнем `.css`.
- **Токены подключаются отдельно** — `index.js` упоминает `./tokens.css`, `Skeleton.jsx` импортирует `./skeleton.css`. Этих `.css` нет в текущем срезе (только `.jsx`/`.js`), но это обязательная внешняя зависимость дизайн-системы.
- **Композиция overlay-слоёв:** `useConfirm` строится поверх `Modal` + `Button`; `ToastContext` оборачивает `Toast`. Это единственные внутренние связи между файлами группы.

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `components/Avatar.jsx` | Аватар: фото или инициалы, 4 размера | 67 |
| `components/Breadcrumbs.jsx` | Навигационная цепочка сверху раздела | 87 |
| `components/Button.jsx` | Кнопка: 4 варианта, 3 размера, иконки | 88 |
| `components/Card.jsx` | Карточка-контейнер с подкомпонентами | 85 |
| `components/Chip.jsx` | Чип/бейдж/пилюля, 5 цветовых вариантов | 73 |
| `components/ClinicScopeSelector.jsx` | Селектор клиники для аналитики | 112 |
| `components/EmptyState.jsx` | Заглушка пустого списка с действием | 56 |
| `components/InfoHint.jsx` | Иконка-подсказка: тултип/мобильная модалка | 246 |
| `components/KpiCard.jsx` | Карточка-метрика с дельтой и трендом | 64 |
| `components/KpiRow.jsx` | Адаптивная сетка KPI-карточек | 29 |
| `components/Modal.jsx` | Модалка с backdrop, focus-trap, bottom-sheet | 286 |
| `components/Page.jsx` | Обёртка страницы, переключает тему | 42 |
| `components/PageHeader.jsx` | Заголовок страницы + слот действий | 41 |
| `components/QuickActions.jsx` | Ряд иконок-действий для карточек | 187 |
| `components/Skeleton.jsx` | Shimmer-плейсхолдер загрузки + таблица | 74 |
| `components/Sparkline.jsx` | Мини-график SVG без зависимостей | 78 |
| `components/Tabs.jsx` | Горизонтальные вкладки с бейджами | 71 |
| `components/Toast.jsx` | Рендер очереди тостов (визуал) | 215 |
| `components/ToastContext.jsx` | Провайдер + хук useToast | 90 |
| `components/useConfirm.jsx` | Хук-замена window.confirm на Modal | 82 |
| `index.js` | Публичный API: реэкспорт всех компонентов | 34 |

---

## `frontend/src/design/components/Avatar.jsx`
- **Назначение:** Круглый аватар пользователя — показывает изображение по `src`, а при его отсутствии или ошибке загрузки отображает инициалы из `name`.
- **Ключевые элементы:** `default export Avatar({ name, src, size, className, ...rest })`; локальная константа `SIZES` (sm/md/lg/xl → px+font); helper `getInitials(name)`; стейт `imgErr` (фолбэк на инициалы при `onError`).
- **Зависимости:** только `useState` из React. Внутренних зависимостей нет.
- **Где менять для типовых задач:** новый размер аватара — добавь ключ в `SIZES`. Цвет градиента-плейсхолдера — строка `background: 'linear-gradient(135deg, ...)'` (захардкожен в `oklch`, не из токенов). Логика инициалов — `getInitials`.
- **Подводные камни:** градиент фона **захардкожен** (не использует токены) — единственное место, где цвет не темизируется. `getInitials` берёт первые буквы первых двух слов; для одного слова — одну букву, для пустого — `?`.
- **Строк:** 67

## `frontend/src/design/components/Breadcrumbs.jsx`
- **Назначение:** Навигационная «хлебная» цепочка над разделами `/admin` для контекста положения; последний элемент — текущая страница (без ссылки).
- **Ключевые элементы:** `default export Breadcrumbs({ items, className })`; helper `safeLabel(l)` (защита от объектов/null); chevron-разделитель через Material Symbols `chevron_right`.
- **Зависимости:** нет импортов. Использует глобальный шрифт иконок `material-symbols-outlined` (внешняя зависимость, подключается в `index.html`/`main`).
- **Где менять для типовых задач:** формат элемента — массив `{ label, to? }`, где `to` это функция-навигатор (НЕ строка-роут). Поменять разделитель — заменить `chevron_right`. Цвета — `var(--fg)`/`var(--fg-3)`/`var(--fg-4)`.
- **Подводные камни:** **не рендерится**, если валидных `label` меньше 2 (`items.filter(i => i?.label).length < 2`) — однопунктовая цепочка молча исчезает. `to` это callback, а не путь — клик вызывает `item.to()`, навигация на стороне родителя.
- **Строк:** 87

## `frontend/src/design/components/Button.jsx`
- **Назначение:** Базовая кнопка дизайн-системы с вариантами оформления, размерами и слотами под иконки слева/справа.
- **Ключевые элементы:** `default export Button` через `forwardRef`; константа `SIZE` (sm/md/lg → padding/fontSize/borderRadius); `buildVariantStyle(variant)` (primary/secondary/ghost/danger); слоты `leftIcon`/`rightIcon`; `type='button'` по умолчанию.
- **Зависимости:** `forwardRef` из React. Внутренних зависимостей нет. Потребляется внутри группы — `useConfirm.jsx` использует `Button` для кнопок диалога.
- **Где менять для типовых задач:** новый вариант кнопки — добавь `case` в `buildVariantStyle`. Новый размер — ключ в `SIZE`. Hover/active-эффекты — Tailwind-классы в `className` (`active:translate-y-px hover:brightness-95 disabled:opacity-50`).
- **Подводные камни:** `primary` несёт inline `boxShadow` с захардкоженными `oklch`-значениями. `forwardRef` важен — на кнопку могут вешать ref (фокус-менеджмент в модалках). `...rest` пробрасывается на нативный `<button>` (можно передать `onClick`, `disabled` и пр.).
- **Строк:** 88

## `frontend/src/design/components/Card.jsx`
- **Назначение:** Карточка-контейнер (surface + border + radius + shadow + padding) с набором подкомпонентов для шапки и заголовков.
- **Ключевые элементы:** `default export Card({ className, padded, children })` + статические подкомпоненты `Card.Header`, `Card.Title`, `Card.Subtitle`, `Card.Body` (присваиваются как свойства `Card`). Рендерится в семантический `<section>`.
- **Зависимости:** нет импортов. Чисто токены (`--surface`, `--border`, `--radius`, `--shadow-sm`).
- **Где менять для типовых задач:** убрать внутренний отступ — проп `padded={false}` (тогда padding=0). Изменить базовый padding (20px) или фон — корневой `style`. Шапка с заголовком и действием справа — `Card.Header` (flex justify-between).
- **Подводные камни:** `Card.Body` не несёт собственных стилей (padding уже на корне) — если использовать `padded={false}` и `Card.Body`, отступов не будет вовсе. Подкомпоненты — паттерн dot-notation, импортируются вместе с `Card`.
- **Строк:** 85

## `frontend/src/design/components/Chip.jsx`
- **Назначение:** Компактный чип/бейдж/статус-пилюля с цветовыми вариантами по семантике (нейтральный/акцент/успех/предупреждение/ошибка) и опциональной точкой-индикатором.
- **Ключевые элементы:** `default export Chip({ variant, dot, className, children })`; константа `VARIANTS` (default/accent/good/warn/bad → background/color/borderColor).
- **Зависимости:** нет импортов. Токены `--bg-2`, `--accent-soft`, `--good-soft`, `--warn-soft`, `--bad-soft` и одноимённые цвета.
- **Где менять для типовых задач:** новый цветовой вариант — ключ в `VARIANTS`. Точка-индикатор слева — проп `dot` (наследует `currentColor`). Форма «пилюля» задана `borderRadius: '999px'`.
- **Подводные камни:** у `good/warn/bad` `borderColor` совпадает с `*-soft` (граница почти невидима — это намеренно). Неизвестный `variant` тихо откатывается на `default`.
- **Строк:** 73

## `frontend/src/design/components/ClinicScopeSelector.jsx`
- **Назначение:** Селектор клиники для разделов аналитики. Если у пользователя одна клиника — показывает статичный лейбл; если несколько — выпадающий `<select>` с переключением; опция «Все клиники» добавляется только при `allowAll`.
- **Ключевые элементы:** `default export ClinicScopeSelector({ clinics, selectedId, onChange, allowAll, className })`; `useMemo` для `currentName`; ветка `single` (clinics.length <= 1) рендерит лейбл вместо select.
- **Зависимости:** `useMemo` из React. Material Symbols иконка `business`. **Единственный компонент группы с привязкой к доменной логике МИС** — используется в `LtvAnalyticsSection` и `ManagerAnalytics` (внешние потребители вне этого среза).
- **Где менять для типовых задач:** логика «показывать select или лейбл» — порог `single = clinics.length <= 1`. Когда показывать «Все клиники» — проп `allowAll` (передаётся родителем: manager без `user.clinic_id` или franchise_owner). Формат опции — `{ id, name }`.
- **Подводные камни:** `selectedId === ''` (пустая строка) трактуется как «Все клиники» — родитель должен передавать именно `''`, а не `null`/`undefined`, иначе `value` рассинхронится с `<option>`. `onChange` вызывается опционально (`onChange?.()`). Какие клиники доступны и роль (`allowAll`) определяет родитель — здесь tenant-фильтрации нет.
- **Строк:** 112

## `frontend/src/design/components/EmptyState.jsx`
- **Назначение:** Центрированная заглушка для пустых списков/результатов: иконка в плашке + заголовок + описание + опциональная кнопка-действие.
- **Ключевые элементы:** `default export EmptyState({ icon, title, message, action, className })`. Все слоты опциональны (рендерятся по наличию).
- **Зависимости:** нет импортов. Обычно `action` это `<Button>` из этой же группы (передаётся родителем). Токены `--bg-2`, `--fg`/`--fg-2`/`--fg-3`, `--radius`.
- **Где менять для типовых задач:** размер/форма плашки иконки — блок `style` контейнера иконки (56×56, `--radius`). Максимальная ширина текста — `max-w-md` на `<p>`.
- **Подводные камни:** `icon` — произвольный ReactNode (эмодзи, Material Symbol, SVG) — компонент не навязывает иконочный шрифт. Без подводных камней по данным.
- **Строк:** 56

## `frontend/src/design/components/InfoHint.jsx`
- **Назначение:** Маленькая иконка «ℹ️»-подсказка: на десктопе по hover/focus показывает тултип-поповер справа; на тач-устройствах (≤640px) по тапу открывает центральную модалку с тем же текстом.
- **Ключевые элементы:** `default export InfoHint({ text, title, size, className, ariaLabel })`; `ensureStyles()` (ленивая инъекция CSS по `STYLE_ID='ks-infohint-styles'`); `isTouchDevice()` (ontouchstart / maxTouchPoints / media-query); стейты `hover`, `modalOpen`; Esc-закрытие + body scroll-lock в `useEffect`.
- **Зависимости:** `useEffect`, `useRef`, `useState`. Material Symbol `info`. CSS встроен в файл (не использует общий `Modal`).
- **Где менять для типовых задач:** внешний вид тултипа/мобильной модалки — строка `css` внутри `ensureStyles()` (классы `.ks-ih-tip`, `.ks-ih-modal`). Порог «мобилка» — `@media (max-width: 640px)` + `isTouchDevice()`. Текст кнопки закрытия («Понятно») — захардкожен в JSX.
- **Подводные камни:** **собственная модалка**, НЕ переиспользует `Modal.jsx` (дублирование backdrop/scroll-lock/Esc-логики — потенциальный рефактор-кандидат). CSS инжектируется один раз глобально — правки в одном экземпляре действуют на все. `ensureStyles()` вызывается в теле рендера (не в эффекте) — для SSR есть guard `typeof document === 'undefined'`.
- **Строк:** 246

## `frontend/src/design/components/KpiCard.jsx`
- **Назначение:** Карточка-метрика: подпись + крупное значение + опциональная дельта, цвет которой определяется трендом (рост=зелёный, падение=красный, flat=серый).
- **Ключевые элементы:** `default export KpiCard({ label, value, delta, trend, icon, className })`; вычисление `deltaColor` по `trend` ('up'/'down'/'flat').
- **Зависимости:** нет импортов. Токены `--surface`, `--border`, `--radius`, `--good`/`--bad`/`--fg-3`. Обычно лежит внутри `KpiRow`.
- **Где менять для типовых задач:** цветовая семантика дельты — тернарник `deltaColor`. Числа выровнены табличными цифрами (`fontVariantNumeric: 'tabular-nums'`) — для корректного выравнивания значений в ряду. Дельта прячется при пустой строке/null/undefined.
- **Подводные камни:** `value` и `delta` форматируются на стороне родителя — компонент не делает округлений, ничего про Decimal/float не знает (важно: денежные суммы должны прийти уже отформатированными строками). `trend` по умолчанию `'up'` (зелёный) — если не передать, дельта будет зелёной.
- **Строк:** 64

## `frontend/src/design/components/KpiRow.jsx`
- **Назначение:** Адаптивная grid-сетка для `KpiCard`. Mobile-first: всегда 2 колонки на узком экране, расширяется до 3/4/5 на больших.
- **Ключевые элементы:** `default export KpiRow({ cols, className, children })`; маппинг `cols`→`colsClass` (Tailwind grid-классы для cols=2/3/4/5).
- **Зависимости:** нет импортов. Только Tailwind grid-классы.
- **Где менять для типовых задач:** добавить вариант на 6 колонок — расширить тернарник `colsClass`. Расстояние между карточками — `gap-3`.
- **Подводные камни:** поддерживаются ровно значения `cols` ∈ {2,3,4,5}; любое другое значение падает в дефолт (`grid-cols-2 md:grid-cols-4`). Tailwind-классы строковые — должны существовать в сборке (если purge агрессивный, перечисленные классы заданы статически, поэтому безопасны).
- **Строк:** 29

## `frontend/src/design/components/Modal.jsx`
- **Назначение:** Центральная переиспользуемая модалка дизайн-системы: backdrop с blur, surface-карточка, на мобильном (≤640px) превращается в bottom-sheet со slide-up. Контролируется снаружи (`open`/`onClose`).
- **Ключевые элементы:** `default export Modal({ open, onClose, title, children, size, actions, className })`; `SIZE` (sm/md/lg → max-width); `ensureStyles()` (CSS по `STYLE_ID='ks-modal-styles'`); стейты `mounted`/`closing` для exit-анимации (~220ms задержка размонтирования); `requestClose` (useCallback); focus-trap на Tab + возврат фокуса на `prevFocusRef`; body scroll-lock; закрытие по Esc и клику на backdrop (через `onMouseDown` + проверку `e.target === e.currentTarget`).
- **Зависимости:** `useEffect`, `useRef`, `useState`, `useCallback`. **Базовый блок для `useConfirm.jsx`** (тот строит диалог поверх `Modal` + `Button`).
- **Где менять для типовых задач:** новый размер — ключ в `SIZE`. Анимации входа/выхода и bottom-sheet — keyframes в строке `css` (`ks-modal-pop-in`, `ks-modal-slide-up`). Кнопки внизу — проп `actions` (JSX). Шапка скрывается, если нет ни `title`, ни `onClose`.
- **Подводные камни:** exit-анимация требует, чтобы узел оставался в DOM ещё 220ms после `open=false` — таймер в `useEffect`; если размонтировать родителя резко, анимации не будет. Закрытие по backdrop сделано через `onMouseDown` (а не `onClick`) — чтобы клик, начавшийся внутри карточки и завершившийся на backdrop, не закрывал модалку. Focus-trap простой (по querySelectorAll фокусируемых) — динамически добавленные элементы учитываются только на момент нажатия Tab. `eslint-disable` на зависимостях первого эффекта — намеренно (следит только за `open`).
- **Строк:** 286

## `frontend/src/design/components/Page.jsx`
- **Назначение:** Корневая обёртка экрана дизайн-системы: задаёт фон/цвет/шрифт через токены и переключает тему (light/dark) через `data-theme` на `<html>`.
- **Ключевые элементы:** `default export Page({ theme, className, children, ...rest })`; `useEffect`, который ставит/снимает `data-theme="dark"` на `document.documentElement` и **восстанавливает предыдущее значение** при размонтировании.
- **Зависимости:** `useEffect`. Токены `--bg`, `--fg`, `--font-sans`. Класс `ks-app` (стилизуется в `tokens.css`).
- **Где менять для типовых задач:** добавить тему — расширить ветку в `useEffect` (сейчас только dark vs нет). Глобальный фон/шрифт страницы — корневой `style`.
- **Подводные камни:** тема ставится на **глобальный** `document.documentElement` — если две `Page` вложены или живут одновременно, эффекты конфликтуют; cleanup восстанавливает `prev`, но порядок размонтирования может дать неожиданный результат. Это side-effect на html, а не локальный скоуп.
- **Строк:** 42

## `frontend/src/design/components/PageHeader.jsx`
- **Назначение:** Шапка страницы: слева крупный заголовок + подзаголовок, справа слот под действия (кнопки/чипы). Адаптивно складывается в колонку на узком экране.
- **Ключевые элементы:** `default export PageHeader({ title, subtitle, actions, className })`. Заголовок — `<h1>` 28px; адаптив через `sm:flex-row sm:items-end sm:justify-between`.
- **Зависимости:** нет импортов. `actions` обычно содержит `<Button>` из группы (передаётся родителем).
- **Где менять для типовых задач:** размер/трекинг заголовка — inline `style` на `<h1>`. Поведение переноса действий — `flex-wrap` на блоке `actions`.
- **Подводные камни:** `<h1>` — на странице должен быть один; не использовать `PageHeader` несколько раз на одном экране без причины (a11y). Без подводных камней по данным.
- **Строк:** 41

## `frontend/src/design/components/QuickActions.jsx`
- **Назначение:** Компактный ряд иконок-действий для карточек пациентов/направлений (позвонить, WhatsApp, перенести, отменить, печать QR) с tap-target ≥44px и русскими тултипами.
- **Ключевые элементы:** `default export QuickActions({ actions, className, compact, ariaLabel })`; `ensureStyles()` (CSS по `STYLE_ID='ks-qa-styles'`); **именованный экспорт `buildPatientCardActions({ phone, userId, onReschedule, onCancel, onPrintQr, hasCallApp, ... })`** — фабрика стандартного набора из 5 кнопок с авто-скрытием по отсутствию handler/телефона; helper `digitsOnly(s)`. Элемент действия: `{ key, icon, title, onClick?, href?, target?, danger?, disabled?, hidden? }`.
- **Зависимости:** `useEffect`. Material Symbols (иконки `call`/`chat`/`update`/`close`/`qr_code_2`). Потребители (внешние): PatientCabinet, AppointmentsCalendar, ManagerHistory, OperationalCabinet.
- **Где менять для типовых задач:** изменить стандартный набор кнопок карточки пациента — править `buildPatientCardActions` (там же логика deep-link `clinikset://call/{userId}` vs `tel:` и `https://wa.me/{digits}`). Внешний вид кнопок — CSS в `ensureStyles()` (`.ks-qa-btn`, `.is-danger`, `.is-compact`). Произвольный набор — передать массив `actions` напрямую.
- **Подводные камни:** действия с `href` рендерятся как `<a>` (с `rel="noreferrer noopener"` для `_blank`), без — как `<button>` с `e.stopPropagation()` (чтобы клик по иконке не всплыл на клик по карточке). `hidden`-элементы отфильтровываются; пустой видимый список → `null`. `buildPatientCardActions` сам прячет кнопки при отсутствии телефона/handler — не нужно фильтровать снаружи.
- **Строк:** 187

## `frontend/src/design/components/Skeleton.jsx`
- **Назначение:** Анимированный shimmer-плейсхолдер для загрузки секции (вместо спиннера, чтобы layout не «прыгал»). Плюс готовая заглушка под таблицу.
- **Ключевые элементы:** `default export Skeleton({ width, height, variant, className, style })` (variant text/rect/circle → разный radius); **именованный экспорт `TableSkeleton({ rows, cols, rowHeight, gap })`** — сетка из `rows × cols` skeleton-ячеек.
- **Зависимости:** **`import './skeleton.css'`** — внешний CSS-файл (класс `.ks-skeleton` и shimmer-анимация определены там, вне этого среза). Обязательная зависимость.
- **Где менять для типовых задач:** скорость/цвет shimmer — в `skeleton.css` (не в этом файле). Форма плейсхолдера — проп `variant`. Заглушка таблицы — `TableSkeleton`.
- **Подводные камни:** `variant='circle'` принудительно делает квадрат (`width = height`), игнорируя проп `width`. Анимация и базовый стиль приходят из внешнего `./skeleton.css` — без него компонент будет статичным серым блоком.
- **Строк:** 74

## `frontend/src/design/components/Sparkline.jsx`
- **Назначение:** Мини-график-линия (SVG) по массиву чисел, без сторонних библиотек; опциональная заливка под линией.
- **Ключевые элементы:** `default export Sparkline({ data, width, height, stroke, fill, strokeWidth, className })`. Нормализует значения в координаты (min/max/range, stepX, PAD_Y), строит `linePath` (M/L) и `areaPath` (замкнутая фигура для заливки).
- **Зависимости:** нет импортов. Цвета по умолчанию из токенов (`--accent`, `--accent-soft`).
- **Где менять для типовых задач:** толщина/цвет линии — пропы `strokeWidth`/`stroke`/`fill`. Отступ сверху/снизу — константа `PAD_Y`. Убрать заливку — `fill={null}`.
- **Подводные камни:** при `data.length < 2` рендерит пустой `<svg>` (без линии) — не падает. Деление на ноль защищено `range = max - min || 1`. `aria-hidden` — график декоративный, не для screen-reader; смысловые данные должны быть рядом текстом.
- **Строк:** 78

## `frontend/src/design/components/Tabs.jsx`
- **Назначение:** Горизонтальные controlled-вкладки на подложке: активная вкладка получает surface-фон + border + тень, у вкладки может быть бейдж-счётчик.
- **Ключевые элементы:** `default export Tabs({ items, value, onChange, className })`. Элемент: `{ id, label, badge? }`. Плавные переходы индикатора (transition 200ms). ARIA `role="tablist"`/`role="tab"`/`aria-selected`.
- **Зависимости:** нет импортов. Токены `--bg-2`, `--surface`, `--accent-soft`, `--bg-3` и др.
- **Где менять для типовых задач:** добавить вкладку — элемент в массив `items` (контроль активной через `value`/`onChange`). Стиль активной/неактивной — inline `style` по флагу `active`. Бейдж рендерится при `badge !== undefined && !== null`.
- **Подводные камни:** компонент **полностью controlled** — не хранит активную вкладку сам, родитель обязан держать стейт `value` и обновлять в `onChange`. `onChange?.()` вызывается опционально.
- **Строк:** 71

## `frontend/src/design/components/Toast.jsx`
- **Назначение:** Чисто визуальный рендер очереди тостов (правый-нижний угол на десктопе, сверху по центру на мобильном). Каждый тост сам себя закрывает по таймеру. Импортируется `ToastProvider`'ом, напрямую не используется.
- **Ключевые элементы:** `default export Toast({ queue, onDismiss })`; внутренние `ToastItem` (auto-dismiss `setTimeout(duration)`), `LevelIcon` (SVG по уровню), `LEVEL_STYLE` (info/success/warn/error → bg/border/icon/iconBg), `ensureStyles()` (CSS по `STYLE_ID='ks-toast-styles'`).
- **Зависимости:** `useEffect`. Токены `--surface`, `--good`/`--warn`/`--bad`, `--accent`, `--shadow-md`. **Связан с `ToastContext.jsx`** (тот рендерит `<Toast queue=... onDismiss=... />`).
- **Где менять для типовых задач:** новый уровень/цвет тоста — ключ в `LEVEL_STYLE` + ветка в `LevelIcon`. Позиция стека/анимация — CSS в `ensureStyles()` (`.ks-toast-stack`, keyframes). Длительность по умолчанию задаётся не здесь, а в `ToastContext`.
- **Подводные камни:** **защита от React error #31** — если `message` это объект, извлекается `text`/`message` или `JSON.stringify` (иначе React падает на рендере объекта). `role="alert"` только для `error`, иначе `status`. `duration <= 0` → тост не закрывается автоматически.
- **Строк:** 215

## `frontend/src/design/components/ToastContext.jsx`
- **Назначение:** React-контекст глобальных уведомлений. Заменяет `alert()`. `ToastProvider` оборачивает приложение один раз (в `App.jsx`) и рендерит `<Toast/>`; хук `useToast()` даёт `{ toast, dismiss }`.
- **Ключевые элементы:** `export function ToastProvider({ children })`; `export function useToast()`; `default export ToastProvider`; стейт `queue`, `idRef` (стабильный счётчик id); `toast(message, level, duration)` и `dismiss(id)` (useCallback); `ToastContext` (createContext).
- **Зависимости:** `createContext, useCallback, useContext, useMemo, useRef, useState`; **импортирует `./Toast`**. Потребляется почти всем приложением через `useToast()`.
- **Где менять для типовых задач:** дефолтная длительность тоста (4000ms) и дефолтный уровень ('info') — сигнатура `toast`. Поддержать новую форму вызова — ветки нормализации в `toast`.
- **Подводные камни:** `toast` поддерживает **две сигнатуры** для обратной совместимости: `toast(message, level, duration)` и объектную `toast({ kind|level, text|message, duration })` — при правках не сломать обе. Всё сообщение принудительно приводится к строке (`String(...)`) — защита от React error #31 (объекты не рендерятся). `level` и `kind` — синонимы (legacy).
- **Строк:** 90

## `frontend/src/design/components/useConfirm.jsx`
- **Назначение:** Хук-замена нативного `window.confirm()` на красивую модалку дизайн-системы. Возвращает `confirm()` (→ `Promise<boolean>`) и компонент `ConfirmHost`, который надо отрендерить в JSX вызывающего.
- **Ключевые элементы:** `default export useConfirm()` → `{ confirm, ConfirmHost }`; стейт `state` (open/message/title/okText/cancelText/danger/resolve); `confirm(message, opts)` возвращает Promise и сохраняет `resolve`; `close(result)` резолвит и закрывает; `ConfirmHost` (useCallback).
- **Зависимости:** `useCallback`, `useState`; **импортирует `./Modal` и `./Button`** — единственная композиция «компонент поверх компонентов» в группе.
- **Где менять для типовых задач:** дефолтные тексты кнопок/заголовок («Да»/«Отмена»/«Подтверждение») — дефолты в `state` и в `confirm`. Поддержать опасное действие — проп `danger` (переключает вариант кнопки на `danger`). Многострочное сообщение поддержано через `whiteSpace: 'pre-wrap'`.
- **Подводные камни:** **`ConfirmHost` обязательно рендерить в JSX** иначе модалка не покажется и Promise зависнет. `resolve` хранится в стейте — двойной вызов `close` защищён обнулением `resolve`. `ConfirmHost` мемоизирован по `[state, close]` — пересоздаётся на каждое изменение состояния (норма).
- **Строк:** 82

## `frontend/src/design/index.js`
- **Назначение:** Публичный API дизайн-системы — единственная точка реэкспорта. Позволяет импортировать `import { Page, Card, Button, useToast } from '@/design'`.
- **Ключевые элементы:** реэкспорты всех 20 компонентов/хуков: `Page, PageHeader, Card, KpiCard, KpiRow, Chip, Button, Tabs, Avatar, EmptyState, Sparkline, Modal, Toast, ToastProvider, useToast, useConfirm, InfoHint, ClinicScopeSelector, Skeleton, TableSkeleton, QuickActions, buildPatientCardActions, Breadcrumbs`.
- **Зависимости:** реэкспортирует все файлы `./components/*`. Комментарий указывает, что **токены подгружаются отдельно через `./tokens.css`** (обычно в `main.jsx`, один раз глобально) — этот `.css` не входит в текущий срез.
- **Где менять для типовых задач:** **добавил новый компонент в `components/` — обязательно добавь реэкспорт здесь**, иначе он не будет доступен через `@/design`. Именованные экспорты (`TableSkeleton`, `buildPatientCardActions`, `ToastProvider`, `useToast`) реэкспортируются отдельными строками.
- **Подводные камни:** последняя строка (`Breadcrumbs`) написана с двойными кавычками и без точки-запятой — мелкая стилистическая неоднородность, не баг. `tokens.css` НЕ импортируется здесь — забыть подключить его глобально = все `var(--*)` отвалятся на дефолты.
- **Строк:** 34
