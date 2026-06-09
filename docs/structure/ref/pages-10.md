# pages [10] — Кабинет директора (P&L / услуги / обёртки + графики), Onboarding-мастер и Wiki-компоненты

Это сборная группа из трёх логических кусков фронтенда МИС «КлиникСеть»:

1. **`pages/director/*`** — экраны кабинета директора франшизы. Две полноценные страницы (`DirectorPnL`, `DirectorServices`) рендерятся внутри общего `DirectorLayout` и берут период из его контекста (`useDirectorPeriod`). Две страницы (`NetworkDashboard`, `PatientEngagement`) — тонкие lazy-обёртки, делегирующие в тяжёлые модули `sections/`. Плюс общий «движок» самописных SVG-графиков `_DirectorCharts.jsx`, на который опираются все аналитические страницы директора.
2. **`pages/onboarding/OnboardingWizard.jsx`** — 6-шаговый мастер первичной настройки франшизы (показывается `franchise_owner` после первого логина).
3. **`pages/wiki/*`** — пять презентационных компонентов публичной/внутренней Базы знаний (hero, карточки категории/статьи, результаты поиска, sidebar). Это НЕ страницы-роуты, а строительные блоки, которые подключаются в `WikiArticle.jsx` / странице `/wiki`.

Общая стилевая черта: ВСЕ файлы используют inline-стили на CSS-токенах дизайн-системы (`var(--accent)`, `var(--fg)`, `var(--surface)`, `var(--border)`, `var(--bg-1/2)`, `var(--shadow-*)`) — это соответствует премиум-перетемизации M33 из общего фронта. Иконки — Material Symbols Outlined через `<span className="material-symbols-outlined">`.

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|------|
| `director/DirectorPnL.jsx` | График+таблица доходы/расходы/прибыль, экспорт Excel/PDF | 207 |
| `director/DirectorServices.jsx` | Таблица услуг сети: выручка/маржа, сортировка/поиск | 164 |
| `director/NetworkDashboard.jsx` | Тонкая lazy-обёртка над sections/network | 15 |
| `director/PatientEngagement.jsx` | Тонкая lazy-обёртка над sections/engagement | 18 |
| `director/_DirectorCharts.jsx` | Самописные SVG-графики + форматтеры (общий движок) | 365 |
| `onboarding/OnboardingWizard.jsx` | 6-шаговый мастер настройки франшизы | 1035 |
| `wiki/WikiArticleCard.jsx` | Карточка статьи в гриде категории | 80 |
| `wiki/WikiCategoryCard.jsx` | Карточка категории на главной Wiki | 125 |
| `wiki/WikiHero.jsx` | Hero-секция главной Wiki с поиском | 166 |
| `wiki/WikiSearchResults.jsx` | Список результатов поиска с подсветкой | 146 |
| `wiki/WikiSidebar.jsx` | Sidebar статьи: TOC + список по категориям | 133 |

---

## `frontend/src/pages/director/DirectorPnL.jsx`
- **Назначение:** Страница кабинета директора «P&L: доходы / расходы / прибыль». Линейный график трёх серий + таблица по периодам + сводные карточки + выгрузка отчёта в Excel/PDF. Гранулярность (день/неделя/месяц/квартал) переключается локально.
- **Ключевые элементы:**
  - `default function DirectorPnL()` — главный компонент.
  - `async function downloadBlob(url, params, filename, toast)` — универсальный helper: `api.get` с `responseType: 'blob'`, создаёт временную `<a download>` ссылку и кликает по ней; при ошибке зовёт toast. Используется обеими кнопками экспорта.
  - Константа `GRANULARITIES` (day/week/month/quarter).
  - Состояния: `granularity`, `data`, `loading`, `error`, `expanded` (свернуть/развернуть таблицу — по умолчанию показ последних 12 строк через `series.slice(-12)`).
  - `chartSeries` — три серии: Доходы (`#1565c0`), Расходы (`#dc2626`), Прибыль (`#059669`).
- **Эндпоинты:** не роутер (фронт), но дёргает API:
  - `GET /director/pnl` (params `from`, `to`, `granularity`) → `{ series:[{date,revenue,expenses,profit}], totals:{revenue,expenses,profit,margin_pct} }`.
  - `GET /director/export/pnl.xlsx` (blob) и `GET /director/export/pnl.pdf` (blob) — выгрузка.
- **Зависимости:** `../../api` (axios-инстанс); `Card, Button, EmptyState, Skeleton, useToast` из `../../design`; `useDirectorPeriod` из `../DirectorLayout` (период `{from,to}`); `LineChart, fmtRUB, fmtDate` из `./_DirectorCharts`.
- **Где менять для типовых задач:**
  - Добавить гранулярность — массив `GRANULARITIES` + поддержка формата подписи в блоке вычисления `labels`.
  - Сменить цвета/состав серий графика — массив `chartSeries`.
  - Поменять формат выгружаемого файла/имя — аргументы вызовов `downloadBlob(...)` в кнопках Excel/PDF.
  - Изменить число строк в свёрнутой таблице — `series.slice(-12)`.
- **Подводные камни:** числа из API оборачиваются `Number(s.revenue || 0)` — на бэке это могут быть `Decimal`/строки (типично для денег), поэтому фронт принудительно приводит к Number; следи за потерей точности на больших суммах. Период приходит из контекста `DirectorLayout`, своего стейта периода нет. Tenant-фильтрация — целиком на бэке (`/director/*`), фронт не передаёт tenant_id.
- **Строк:** 207

## `frontend/src/pages/director/DirectorServices.jsx`
- **Назначение:** Таблица всех услуг сети с метриками (выручка, кол-во, средняя цена, маржа). Локальный поиск по названию и сортировка по любой колонке. На мобильном — карточки вместо таблицы.
- **Ключевые элементы:**
  - `default function DirectorServices()`.
  - Константа `COLS` (описание колонок: key/label/align/hideMobile).
  - Состояния: `services`, `loading`, `error`, `sortKey` (по умолчанию `revenue`), `sortDir` (`desc`), `search`.
  - `filtered` (`useMemo`) — фильтрация по `search` + сортировка (строки через `localeCompare(..., 'ru')`, числа через вычитание).
  - `toggleSort(key)` — клик по заголовку колонки.
- **Эндпоинты:** дёргает `GET /director/pnl/by-service` (params `from`, `to`) → ожидает `{ services:[...] }` ИЛИ `{ items:[...] }` (поддерживает оба ключа: `r.data?.services || r.data?.items`). Поле услуги: `{name, revenue, count, avg_price, margin_pct}`.
- **Зависимости:** `../../api`; `Card, EmptyState, Skeleton` из `../../design`; `useDirectorPeriod` из `../DirectorLayout`; `fmtRUB, fmtInt, fmtPct` из `./_DirectorCharts`.
- **Где менять для типовых задач:**
  - Добавить/убрать колонку — массив `COLS` + соответствующие `<td>` в desktop-таблице и блок мобильных карточек (их три фиксированных метрики — правятся отдельно).
  - Изменить колонку сортировки по умолчанию — начальные `sortKey/sortDir`.
  - Скрыть колонку на мобиле — флаг `hideMobile` + класс `hidden md:table-cell`.
- **Подводные камни:** при ошибке загрузки, если уже есть `services`, EmptyState НЕ показывается (`error && !services.length`) — то есть старые данные остаются на экране. `margin_pct` может прийти `null` — рендерится `—`. Числа форматируются через хелперы из `_DirectorCharts` (`num(v)=Number(v)||0`), float/Decimal с бэка сводятся к Number. Период — из контекста.
- **Строк:** 164

## `frontend/src/pages/director/NetworkDashboard.jsx`
- **Назначение:** Страница-обёртка кабинета директора для раздела «Сеть клиник». Сама ничего не рендерит, кроме `<Suspense>` + lazy-импорта тяжёлого модуля и передачи `token`.
- **Ключевые элементы:**
  - `default function DirectorNetworkPage()`.
  - `lazy(() => import('../../sections/network/NetworkDashboard'))` — реальный экран лежит в `sections/network/NetworkDashboard.jsx`.
  - Тянет `token` из `useAuthStore(s => s.token)` и пробрасывает пропсом.
- **Эндпоинты:** нет (обёртка).
- **Зависимости:** `useAuthStore` из `../../store/auth`; `sections/network/NetworkDashboard` (lazy).
- **Где менять для типовых задач:** вся реальная логика/верстка раздела — в `sections/network/NetworkDashboard.jsx`, НЕ здесь. Здесь правят только fallback загрузки и пробрасываемые пропсы. Это типовой паттерн директорских разделов (см. близнеца `PatientEngagement.jsx`).
- **Подводные камни:** дублирование имени `NetworkDashboard` (страница-обёртка и секция называются одинаково) — легко перепутать при импорте; обёртка экспортирует `DirectorNetworkPage`, секция — `NetworkDashboard`. `token` пробрасывается пропсом, хотя секции могут и сами читать стор — потенциальный легаси-проп.
- **Строк:** 15

## `frontend/src/pages/director/PatientEngagement.jsx`
- **Назначение:** Страница-обёртка кабинета директора для раздела «Вовлечённость пациентов». Идентична по структуре `NetworkDashboard.jsx`.
- **Ключевые элементы:**
  - `default function DirectorPatientEngagementPage()`.
  - `lazy(() => import('../../sections/engagement/PatientEngagement'))`.
  - `token` из `useAuthStore`.
- **Эндпоинты:** нет (обёртка).
- **Зависимости:** `useAuthStore` из `../../store/auth`; `sections/engagement/PatientEngagement` (lazy).
- **Где менять для типовых задач:** реальная логика — в `sections/engagement/PatientEngagement.jsx` (там же рядом `EngagementDashboard`, `CampaignsList`, `SegmentEditorModal` и пр.). Здесь — только fallback и пропсы.
- **Подводные камни:** то же дублирование имени `PatientEngagement` (обёртка vs секция). Чистый boilerplate — не путать с реальным экраном.
- **Строк:** 18

## `frontend/src/pages/director/_DirectorCharts.jsx`
- **Назначение:** Базовый «движок» визуализации кабинета директора — набор самописных SVG-графиков без внешних зависимостей (нет recharts/chart.js) и общие форматтеры. Подчёркивание в имени = служебный модуль, не маршрут. На него опираются `DirectorPnL`, `DirectorServices` и (по соглашению) прочие аналитические страницы директора.
- **Ключевые элементы (именованные экспорты):**
  - `LineChart({series, xLabels, height, showLegend, yFormatter})` — 1+ линий, авто-сетка (4 уровня), прореживание подписей X (каждая `ceil(len/8)`-я), легенда.
  - `BarChart({items, horizontal, formatter, maxBars=20, height})` — гор/верт столбики.
  - `StackedBarChart({items:[{label,parts:[{value,color}]}], formatter, height})`.
  - `DonutChart({slices:[{label,value,color}], formatter, size=200})` — donut + легенда с процентами.
  - `FunnelChart({stages:[{name,count,conversion_pct}], formatter})` — воронка.
  - `SparkLine({data, width, height, color})` — мини-линия для виджетов.
  - Форматтеры-экспорты: `fmtRUB`, `fmtInt`, `fmtPct`, `fmtDate`.
  - Внутренние: `palette` (8 цветов), `num(v)=Number(v)||0`, `fmt` (toLocaleString ru-RU).
- **Эндпоинты:** нет (чистый presentational/utility-модуль).
- **Зависимости:** только `useId` из `react`. Никаких сервисов/API — данные приходят пропсами. Самодостаточен; использует CSS-токены.
- **Где менять для типовых задач:**
  - Сменить палитру серий по умолчанию — массив `palette`.
  - Поправить логику прореживания подписей X — блок `skip = Math.ceil(xLabels.length / 8)` в `LineChart`.
  - Добавить новый тип графика — добавить экспорт-функцию здесь, тогда он станет доступен всем директорским страницам.
  - Изменить формат денег/дат во всех графиках сразу — `fmtRUB`/`fmtInt`/`fmtPct`/`fmtDate`.
- **Подводные камни:** `fmtDate` ожидает что `new Date(s)` распарсит строку; на нестандартном формате вернёт исходную строку (try/catch). Все значения прогоняются через `num()` → `Number(v)||0`, поэтому `Decimal`/строки с бэка молча станут числами или 0 (NaN-ловушка скрыта). `viewBox` фиксирован `600 x H` с `preserveAspectRatio="none"` — графики растягиваются, на очень узких экранах подписи могут искажаться. `useId` нужен только для уникальных key легенды `LineChart`.
- **Строк:** 365

## `frontend/src/pages/onboarding/OnboardingWizard.jsx`
- **Назначение:** Пошаговый мастер первичной настройки франшизы. Показывается владельцу (`franchise_owner`) после первого логина, пока `franchise.onboarding_done === false`. 6 шагов: приветствие → первая клиника/тенант → услуги (шаблон или CSV, мин. 5) → сотрудники (мин. 1 менеджер + 1 регистратор) → Telegram-бот → финальный чеклист. Прогресс кэшируется в localStorage и сохраняется на бэке по шагам.
- **Ключевые элементы:**
  - `default function OnboardingWizard({ user, onComplete })` — оркестратор: `step`, `data`, `direction/animKey` (анимация слайда), `franchiseId`, флаги `loading/saving/completing`.
  - Под-компоненты шагов: `Step1` (название/регион/контакты), `Step2` (тенант+клиника, авто-slug через `_slugify`), `Step3` (услуги: шаблоны+CSV), `Step4` (сотрудники), `Step5` (Telegram-бот, QR через api.qrserver.com), `Step6` (чеклист).
  - UI-хелперы: `MIcon`, `ProgressBar`, `STEPS_META` (метаданные 6 шагов), `SERVICE_TEMPLATES` (general/dental/cosmetology — синхронизированы с backend `SERVICE_TEMPLATES`).
  - Утилиты: `lsKey(franchiseId)` → `clinika_onboarding_<id>`; `parseServicesCsv(text)` (шапка `name,bonus_amount,duration,category`, разделитель `,` или `;`); `_slugify(s)` (транслит кириллицы → латиница, до 50 симв.).
  - Логика: `canProceed()` (валидация шага), `saveAndNext({skip})`, `goBack()`, `finish()`.
- **Эндпоинты:** дёргает API онбординга:
  - `GET /onboarding/status` → `{ franchise_id, step, data, completed }`.
  - `POST /onboarding/step/{n}` body `{ data }` или `{ skipped: true }`.
  - `POST /onboarding/complete` → финал.
- **Зависимости:** `../../api`; `Page, PageHeader, Card, Button, InfoHint, useToast` из `../../design`. Никаких внешних чартов. Внешние ресурсы: Google Fonts (Material Symbols) и `api.qrserver.com` (QR-картинка) — оба сетевые.
- **Где менять для типовых задач:**
  - Добавить/изменить шаг — `TOTAL_STEPS`, массив `STEPS_META`, новый `StepN`, ветка рендера `{step === N && ...}`, правило в `canProceed()`, подписи точек в `ProgressBar` (хардкод тернарником `s.id===1?...`).
  - Поменять шаблоны услуг — `SERVICE_TEMPLATES` (важно: держать синхрон с backend).
  - Правила минимумов (5 услуг, 1+1 сотрудник) — `canProceed()` и чеклист `Step6`.
  - Логин Telegram-бота/QR — `Step5` (`botUrl`, `qr`).
- **Подводные камни:**
  - Прогресс хранится локально (`localStorage`) + на сервере; при старте локальный кэш МЕРЖИТСЯ поверх серверного (`setData(prev => ({...prev, ...parsed.data}))`) — возможны рассинхроны, если бэк ушёл вперёд.
  - `super_admin` может прыгнуть на любой шаг через `?step=N` (отладка) и пропустить мастер кнопкой.
  - `bonus_amount`/`mis_id` приводятся через `Number(...) || 0/null` — следи за числовыми полями.
  - CSV читается `FileReader.readAsText` без явной кодировки — кириллица в cp1251 может «поехать» (UTF-8 ожидается). Toast вызывается как `toast?.error?.()/toast?.success?.()` — формат отличается от `DirectorPnL`, где `useToast` возвращает `{toast}` и зовётся `toast(msg, 'error')`; здесь `useToast()` берётся целиком как объект с методами. Несогласованность API тостов между файлами — учитывать при копипасте.
  - Самый крупный файл группы (1035 строк), всё в одном модуле — рефакторинг шагов в отдельные файлы напрашивается, но пока монолит.
- **Строк:** 1035

## `frontend/src/pages/wiki/WikiArticleCard.jsx`
- **Назначение:** Презентационная карточка-ссылка одной статьи в гриде категории (`/wiki?category=...`). Иконка + заголовок + краткое описание, hover-подъём и акцентный border.
- **Ключевые элементы:** `default function WikiArticleCard({icon, title, summary, to, accent, accentSoft})`; локальный `hover`-state для inline-стилей.
- **Эндпоинты:** нет (presentational).
- **Зависимости:** `Link` из `react-router-dom`; `useState`. Данные — целиком из пропсов (поставляет родительская Wiki-страница, обычно из `_index.json`).
- **Где менять для типовых задач:** размеры/типографика карточки — inline-стили здесь; навигация задаётся пропсом `to` родителем. Цвет акцента — пропсы `accent`/`accentSoft`.
- **Подводные камни:** hover реализован через React-state, а не CSS `:hover` — лишние ререндеры при наведении (микро-неоптимально, но безопасно). Нет проверки `to` на пустоту.
- **Строк:** 80

## `frontend/src/pages/wiki/WikiCategoryCard.jsx`
- **Назначение:** Кликабельная карточка категории на главной Wiki. Цветная иконка, заголовок, бейдж количества статей (`N статья/статьи/статей`), описание, стрелка-индикатор. Hover — подъём + scale иконки + accent border.
- **Ключевые элементы:** `default function WikiCategoryCard({icon, title, description, count, accent, accentSoft, to})`; локальный `hover`; внутренняя функция `pluralize(n)` — русский плюрал для слова «статья».
- **Эндпоинты:** нет (presentational).
- **Зависимости:** `Link` из `react-router-dom`; `useState`. Данные — пропсами.
- **Где менять для типовых задач:** оформление/размеры — inline-стили; правило склонения — `pluralize`. Целевой роут — пропс `to` (например `/wiki?category=role`).
- **Подводные камни:** `pluralize` ДУБЛИРУЕТСЯ в `WikiHero.jsx` (идентичная функция) — при изменении правил склонения надо править оба файла; кандидат на вынос в общий util. Hover через state (как и в `WikiArticleCard`).
- **Строк:** 125

## `frontend/src/pages/wiki/WikiHero.jsx`
- **Назначение:** Hero-секция ТОЛЬКО корневой страницы `/wiki`: заголовок, описание, крупное поле поиска с подсказкой `⌘K`, декоративные градиентные круги, hint с общим числом статей.
- **Ключевые элементы:** `default function WikiHero({query, onQueryChange, onFocus, inputRef, resultsCount})`; внутренняя `pluralize(n)` (дубль из `WikiCategoryCard`). `inputRef` пробрасывается на `<input>` для фокуса по Cmd/Ctrl+K (хоткей навешивает родитель).
- **Эндпоинты:** нет (presentational).
- **Зависимости:** никаких импортов модулей (даже react не импортируется явно — JSX-only). Полностью контролируемый компонент: состояние поиска живёт в родителе.
- **Где менять для типовых задач:** тексты заголовка/описания — здесь (хардкод). Поведение поиска (что происходит при вводе) — у родителя через `onQueryChange/onFocus`. Подсказка хоткея — блок `<kbd>`.
- **Подводные камни:** дубль `pluralize` (см. `WikiCategoryCard`). Сам хоткей `⌘K` здесь НЕ реализован — только `inputRef` и визуальный `<kbd>`; обработчик клавиш должен быть в родителе. Кнопка очистки/кнопка — это `<button className="material-symbols-outlined">`, меняет цвет через inline onMouseEnter/Leave.
- **Строк:** 166

## `frontend/src/pages/wiki/WikiSearchResults.jsx`
- **Назначение:** Плоский список результатов поиска по Wiki (заменяет грид категорий, когда `query` непустой). Подсветка совпадений в заголовке/summary/сниппете, бейдж категории, EmptyState при нуле находок.
- **Ключевые элементы:**
  - `default function WikiSearchResults({query, results, snippets={}})`.
  - Внутренние: `highlight(text, query)` — режет текст regexp'ом и оборачивает совпадения в `<mark>`; `escapeRegex(s)` — экранирует спецсимволы перед построением RegExp.
  - Карта `CATEGORY_LABELS` (role/concepts/setup → рус. подписи).
- **Эндпоинты:** нет; `results` (массив `Article` из `_index.json`) и `snippets` (`{[slug]: string}`) приходят пропсами от родителя.
- **Зависимости:** `Link` из `react-router-dom`. Линки ведут на `/wiki/{a.slug}`.
- **Где менять для типовых задач:** стиль подсветки — компонент `<mark>` в `highlight`. Подписи/набор категорий — `CATEGORY_LABELS` (этот же объект продублирован в `WikiSidebar.jsx`). Внешний вид карточки результата — inline-стили в `<Link>`.
- **Подводные камни:** `CATEGORY_LABELS` ДУБЛИРУЕТСЯ с `WikiSidebar.jsx` — синхронизировать при добавлении категории. `escapeRegex` обязателен (без него спецсимволы в query ломают `new RegExp`), при правках `highlight` не убирать. Ожидает `results.length` — родитель обязан передать массив (нет защиты от undefined). Hover — inline onMouseEnter/Leave (не CSS).
- **Строк:** 146

## `frontend/src/pages/wiki/WikiSidebar.jsx`
- **Назначение:** Sidebar страницы статьи: ссылка «Все статьи», TOC текущей статьи (если есть заголовки) и список статей, сгруппированный по категориям с подсветкой активного slug. Один компонент рендерится дважды — desktop sticky и mobile drawer (управляется родителем `WikiArticle.jsx`).
- **Ключевые элементы:**
  - `default function WikiSidebar({grouped, activeSlug, toc=[], onNavigate})`.
  - Карты `CATEGORY_LABELS` (дубль из `WikiSearchResults`) и `CATEGORY_ORDER = ['role','concepts','setup']` (порядок секций).
  - `toc` — массив `{id, text, level}`; level 3 даёт больший отступ (вложенный заголовок).
- **Эндпоинты:** нет; всё пропсами от `WikiArticle.jsx`.
- **Зависимости:** `Link` из `react-router-dom`. Якорные ссылки TOC — `href="#{id}"`. `onNavigate` зовётся при кликах (нужен для закрытия mobile-drawer).
- **Где менять для типовых задач:** порядок/состав категорий — `CATEGORY_ORDER` + `CATEGORY_LABELS`; стиль активного пункта — inline-стили в `<Link>` (`active`). Поведение «два экземпляра» (desktop/mobile) задаётся снаружи; проп `variant` упомянут в шапке-комментарии, но в коде НЕ деструктурируется и не используется — потенциальный мёртвый/планируемый проп.
- **Подводные камни:** `CATEGORY_LABELS` и логика категорий дублируются с `WikiSearchResults.jsx` — держать синхрон. Категории за пределами `CATEGORY_ORDER` НЕ отрисуются в sidebar (фильтр `CATEGORY_ORDER.filter(...)`), хотя в поиске они появятся (там fallback `|| a.category`) — рассинхрон поведения. Проп `variant` из JSDoc не реализован.
- **Строк:** 133
