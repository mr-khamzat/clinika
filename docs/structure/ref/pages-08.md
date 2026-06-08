# pages [08] — публичные экраны (QR/онбординг/Wiki/чат) + шеллы и старт бухгалтерии

Это «хвостовой» срез алфавитного списка страниц `frontend/src/pages` (S→W) плюс начало под-папки `accountant/`. Группа разнородна, но делится на 5 логических кластеров:

1. **Подтверждение визита** — `ScanScreen.jsx` (публичный QR/код-сканер для подтверждения направления).
2. **Онбординг франшизы** — `SignupWizard.jsx` (5-шаговый мастер регистрации тенанта) + `TermsOfService.jsx` (юридическая оферта).
3. **Wiki / База знаний** — `Wiki.jsx` + `WikiArticle.jsx` (Notion-style портал документации; обе читают один `_index.json` и `*.md` через `import.meta.glob`).
4. **Чат сотрудников** — `StaffChat.jsx` (самый большой файл среза, 2807 строк: WebSocket-мессенджер сотрудник↔сотрудник).
5. **Кабинеты-шеллы + бухгалтерия** — `VisitingDoctorCabinet.jsx` (кабинет приезжего врача), два корпуса-обёртки `_AccountantShell.jsx` / `_ManagerShell.jsx` (общий sidebar/topbar+nav для под-страниц), и первые три под-страницы бухгалтера `accountant/AccActs.jsx`, `AccCash.jsx`, `AccIncomingInvoices.jsx`.

Общие технические черты среза: все файлы — React-компоненты (нет роутеров/моделей — это фронтенд). Сетевые вызовы идут через единый axios-инстанс `../api` (он сам подкладывает `Bearer`-токен; tenant определяется токеном, не явным `tenant_id`). Дизайн-система импортируется из `../design` (`Card`, `Button`, `Chip`, `Modal`, `EmptyState`, `KpiCard`, `Page`, `useToast`). Денежные суммы повсеместно форматируются через `Number(v).toLocaleString('ru-RU')` — числовые поля приходят с бэка строками/Decimal, поэтому везде идёт явный `Number(...)`.

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `ScanScreen.jsx` | Публичный QR/код-сканер подтверждения визита | 327 |
| `SignupWizard.jsx` | 5-шаговый мастер регистрации франшизы + OTP | 573 |
| `StaffChat.jsx` | WebSocket-чат сотрудник↔сотрудник (комнаты/каналы) | 2807 |
| `TermsOfService.jsx` | Статическая страница договора-оферты | 99 |
| `VisitingDoctorCabinet.jsx` | Кабинет приезжего врача: очередь/QR-приём | 588 |
| `Wiki.jsx` | Главная базы знаний: категории, Cmd+K | 1384 |
| `WikiArticle.jsx` | Рендер одной MD-статьи Wiki + ToC | 1277 |
| `_AccountantShell.jsx` | Корпус-обёртка кабинета бухгалтера (sidebar) | 448 |
| `_ManagerShell.jsx` | Корпус-обёртка под-страниц управляющего | 374 |
| `accountant/AccActs.jsx` | Реестр актов выполненных работ + PDF | 269 |
| `accountant/AccCash.jsx` | Кассовые смены: открытие/операции/закрытие | 602 |
| `accountant/AccIncomingInvoices.jsx` | Входящие межклиничные счета, оплата бухгалтером | 202 |

---

## `frontend/src/pages/ScanScreen.jsx`
- **Назначение:** Мобильный публичный экран «Подтверждение визита»: сотрудник сканирует QR направления или вводит 5-значный код, чтобы подтвердить визит пациента и (при наличии) начислить бонус.
- **Ключевые элементы:** default-export `ScanScreen()`. Состояние: `mode` ('qr'|'code'), `scanning`, `result`, `error`, `shortCode`. Функции: `startScan` (динамический `import('html5-qrcode')` → `Html5Qrcode` с `facingMode:'environment'`), `stopScan`, `handleCodeSubmit`, `handleReset`, `switchMode`. Три состояния рендера: success (карточка услуги/пациента + бонус), error, normal-flow (табы QR/код).
- **Зависимости:** `scanQR`, `confirmByCode` из `../api`; `useNavigate` (react-router); `html5-qrcode` (lazy chunk, ~250 КБ — намеренно динамический импорт, см. комментарий в шапке). Material Symbols через CSS-классы.
- **Где менять для типовых задач:** длину/валидацию кода — `handleCodeSubmit` (сейчас жёстко `length !== 5`, парсит `parseInt`); поведение после успеха (кнопка «Открыть направление») — `nav(`/qr/${result.id}`)`; параметры камеры (fps, qrbox) — объект в `scanner.start`. Анимацию рамки сканирования — `<style>` с `@keyframes scanLine` в конце файла.
- **Подводные камни:** `result.bonus_amount` рисуется как `+{...} руб` без `Number()`-форматирования — если бэк вернёт Decimal-строку, отобразится как есть. `scanQR(decodedText)` отправляет сырой текст QR — нормализация URL/`APT:`-префикса делается на бэке (в отличие от `VisitingDoctorCabinet`, где парсинг на фронте). Камера освобождается в `useEffect`-cleanup через `stopScan`.
- **Строк:** 327

## `frontend/src/pages/SignupWizard.jsx`
- **Назначение:** Публичный мастер самостоятельной регистрации новой франшизы (тенанта) в 5 шагов с live-проверкой slug и email-OTP подтверждением. Это «вход» в платформу для нового клиента (Глава 2 roadmap).
- **Ключевые элементы:** default `SignupWizard()` + под-компоненты `Step1`..`Step5` (чисто презентационные). Локальный axios-инстанс `SIGNUP_API = axios.create({ baseURL: API_BASE })` — НЕ общий `../api`, т.к. вызовы анонимные (без токена). Константы: `PLANS` (trial/starter/pro UI-мета), `SLUG_RE`, `EMAIL_RE`, `EMPTY_CLINIC`. Async-flow: `doStart` → `doVerify` → `doComplete`, плюс `doResend`. Валидаторы `validStep1..5` + `canNext`.
- **Зависимости:** `axios` напрямую; `API_BASE` из `../config`; `useToast` из `../design/components/ToastContext`; стили `./SignupWizard.css` (классы `sw-*`). Каталог модулей грузится из `/marketplace/modules`.
- **Эндпоинты (вызываемые, анонимные):** `POST /signup/check-slug` (debounce 400 мс), `GET /marketplace/modules` (шаг 4), `POST /signup/start` (после шага 5 → `request_id`), `POST /signup/verify` (OTP), `POST /signup/complete` (финал → `login_url`/`trial_until`), `POST /signup/resend` (cooldown 60 сек).
- **Где менять для типовых задач:** тарифы/цены — массив `PLANS`; лимит клиник (сейчас 1..10) — `addClinic`/`validStep3`; правила slug — `SLUG_RE` + onChange-санитайзер в `Step2`; список модулей по умолчанию — `fallback` в `Step4` (используется если каталог пуст); preview URL — `Step2.preview`.
- **Подводные камни:** `doVerify` автоматически вызывает `doComplete` внутри себя — не дублировать. `fallback`-модули в Step4 жёстко зашиты (calls/ltv/marketplace/region-lock/monitoring) — если бэк-каталог отличается, ключи могут не совпасть. `request_id` хранится только в state — при перезагрузке страницы OTP-сессия теряется. Все строки тримятся/лоуэркейзятся в `doStart` перед отправкой.
- **Строк:** 573

## `frontend/src/pages/StaffChat.jsx`
- **Назначение:** Полноценный мессенджер сотрудник↔сотрудник внутри одной франшизы: двухпанельный layout (sidebar комнат + переписка), real-time через WebSocket, файлы (TTL 48ч), реакции, pinned, threads/reply, опросы, mentions, read-receipts, стикеры, web-push. Самый сложный файл среза.
- **Ключевые элементы:** default `StaffChat()` (~1640 строк логики+рендера) + под-компоненты в этом же файле: `Avatar`, `GroupInfoPanel`, `SettingsModal`, `ToggleRow`, `CreateGroupModal`, `AddMembersModal`. Хелперы: `avatarColor`/`initials`/`formatTime`/`formatBytes`/`isEmbedded`. Карта `ROLE_LABELS`, константа `STAFF_CHAT_CSS` (встроенные стили `sc-*`, oklch-палитра, dark-режим через класс `sc-dark` + `prefers-color-scheme`). Ключевые механики: `handleWsEvent` (диспетчер событий `message:new`/`deleted`/`read_receipt`/`typing`/`presence`), дебаунс read-receipts (`enqueueMarkRead`/`flushMarkRead` 500 мс + `IntersectionObserver` threshold 0.6), `openRoom`/`startDirectChat`/`sendMessage`/`uploadFile`/`votePoll`/`toggleReaction`/`togglePin`. Вкладки sidebar: 'chats' / 'contacts' / 'patients' (последняя открывает overlay с lazy `ClinicChatSection`).
- **Зависимости:** `api` (`../api`); `API_BASE`, `SLUG` (`../config`); модалки из `../components/staff/*` (`CreateChannelModal`, `ChannelSettingsModal`, `PinnedMessagesModal`, `MentionAutocomplete`, `CreatePollModal`, `GlobalSearchBox`); `StickerPicker` (`../components/chat/StickerPicker`); lazy `../sections/ClinicChatSection`; `enableWebPush`/`getPushPermissionState` (`../lib/webPush`).
- **Эндпоинты (вызываемые):** init — `GET /staff-chat/me`, `/staff-chat/rooms`, `/staff-chat/contacts`, `/staff-chat/files/policy`; WS — `/staff-chat/ws?token=...`; `GET /staff-chat/presence` (poll 30с), `GET /staff-chat/mentions/unread` (poll 30с); `POST /staff-chat/rooms/direct`; `GET /staff-chat/rooms/{id}` и `/messages`; `POST .../{id}/read`, `.../{id}/mark-read`, `.../{id}/messages`, `.../{id}/files`; `POST /staff-chat/messages/{id}/reactions`, `.../pin`, `DELETE /staff-chat/messages/{id}`; `POST /staff-chat/polls/{id}/vote`; админ-операции групп — `POST/PATCH/DELETE /admin/chat/groups...`, `GET/PUT /admin/chat-settings`.
- **Где менять для типовых задач:** новый тип WS-события — `handleWsEvent`; быстрые реакции — массив `QUICK_REACTIONS`; подписи ролей — `ROLE_LABELS`; вся визуалка — строка `STAFF_CHAT_CSS` (классы `sc-*`); политика файлов (UI-лимит) приходит с `/staff-chat/files/policy` в `filePolicy`, а реальный лимит/TTL правится через `SettingsModal` (`/admin/chat-settings`); логика галочек ✓/✓✓ — IIFE внутри рендера сообщения (`isReadByAll`/`delivered`). Авто-открытие DM из `?dm=<user_id>` или `#access_token=...` (проброс из Calls/Electron) — в первом большом `useEffect`.
- **Подводные камни:** токен берётся из `localStorage` по нескольким ключам (`clinika_admin_token_`+SLUG / `clinika_token_`+SLUG) — при `/staff-chat` SLUG пустой, пишутся оба. WS переподключается с экспоненциальным backoff (max 15с). Read-receipts батчатся — при ошибке id возвращаются в очередь. Оптимистичные апдензы в `votePoll`/`sendMessage` синхронизируются с серверным ответом; при ошибке `refetchMessages` откатывает. `unreadMentions`-endpoint может отсутствовать на бэке — ошибка молча проглатывается. Много `alert()`/`confirm()` для ошибок и подтверждений (легаси-стиль, не Toast). Хэш `#access_token` чистится из URL сразу после приёма (безопасность).
- **Строк:** 2807

## `frontend/src/pages/TermsOfService.jsx`
- **Назначение:** Статическая страница «Договор-оферта» (`/terms`) — юридический текст условий использования сервиса.
- **Ключевые элементы:** default `TermsOfService()`. Просто JSX-текст (9 разделов: предмет, тарифы, оплата, триал, обязательства, возврат, ответственность, споры, заключение) внутри обёртки `<LegalPage>`. Константа `updated = '08 мая 2026'`.
- **Зависимости:** `LegalPage` из `../components/legal/LegalPage` (общая обёртка с заголовком + датой).
- **Где менять для типовых задач:** текст — прямо в JSX; дату обновления — `updated`; цены тарифов в разделе 2 (Solo/Network/Enterprise) — там же. Парная страница политики конфиденциальности должна быть рядом (ссылка `/privacy`).
- **Подводные камни:** **Содержит незаполненные плейсхолдеры** `[ОПЕРАТОР: ООО «...» / ИП ...]` и `[EMAIL]` — комментарий в шапке прямо требует заменить их перед продакшеном. Тарифы здесь (9 900/24 900/49 900 ₽) НЕ совпадают с тарифами в `SignupWizard.PLANS` (12 900/29 900) — рассинхрон, который стоит свести.
- **Строк:** 99

## `frontend/src/pages/VisitingDoctorCabinet.jsx`
- **Назначение:** Мобильный кабинет приезжего/приглашённого врача (`VISITING_DOCTOR`): очередь записей, приём пациента по QR/коду, история, доход, прямые счета (billing), регламенты. Этап 5 roadmap, кабинет 7/9 — частичная миграция на дизайн-систему.
- **Ключевые элементы:** default `VisitingDoctorCabinet({ adminToken, user, onLogout })`. Под-компоненты в файле: `DoneModal` (success +N ₽), `QRScanner` (fullscreen, `BarcodeDetector` API → fallback на lazy `jsqr`), `QueueCard`. Хелперы: `fmtDate`, `urlBase64ToUint8Array`, `registerPush`. Состояние: `tab` (queue/history/income/billing/regulations), `queue`, `history`, `income`, `scanner`, `accepted`. Логика приёма: `acceptAppointment` + `handleQRScan` (парсит UUID из URL `/p/apt/<uuid>`, префикс `APT:`, 4-значный код).
- **Зависимости:** `api`; `API_BASE`, `SLUG` (`../config`); из `../design` — `Card`, `KpiCard`, `Chip`, `Button`, `EmptyState`, `useToast`; `ExternalDoctorBillingSection` (`../components/doctor/...`, Глава 6); lazy `RegulationsReaderSection` (`../sections/...`, Глава 7); `ProfileModal` (`../components/ProfileModal`, avatar01); `jsqr` (lazy).
- **Эндпоинты (вызываемые):** `GET /profile/me`; `GET /visiting/my-queue`, `/visiting/my-visits`, `/visiting/my-income`; `POST /visiting/admin/complete-visit` (тело: `{appointment_id}` либо `{qr_value}` либо `{short_code}`); push — `GET /push/vapid-key`, `POST /push/subscribe-user`.
- **Где менять для типовых задач:** пункты нижней навигации — массив `NAV`; парсинг QR/кода — `handleQRScan` (regex UUID, префикс `APT:`, проверка `/^\d{4}$/`); логику завершения приёма — `acceptAppointment`; счётчик «принято сегодня» — `loadQueue` (фильтр по `appointment_date===today && status==='completed'`). Цвета бренда — константы `P`/`D`.
- **Подводные камни:** ряд элементов помечены `TODO(design-system)` (Gradient Header, QRScanner, DoneModal, FAB, BottomNav) — намеренно НЕ мигрированы на DS, кастомный fullscreen. `hdr()` оставлен заглушкой для обратной совместимости (api сам подкладывает Bearer). Денежные значения везде через `Number(...).toLocaleString('ru')`. Push регистрирует SW по scope `/{SLUG}/`. Код пациента здесь 4-значный (в `ScanScreen` — 5-значный): разные форматы для разных потоков.
- **Строк:** 588

## `frontend/src/pages/Wiki.jsx`
- **Назначение:** Главная страница портала документации «КлиникСеть» (`/wiki`): 3-колоночный Notion/Linear-layout (sidebar-tree + контент категорий/карточек + right-rail), глобальный Cmd+K поиск по title+body статей. Публичный доступ.
- **Ключевые элементы:** default `Wiki()`. Под-компоненты: `SidebarTree`, `CommandPalette` (Cmd+K модал, fuzzy-скоринг title+summary+raw-MD), `CategoryCard`, `ArticleCard`, `RightRail`. Хелперы: `categoryFromSlug` (fallback-группировка по префиксу), `highlight`, `pluralize`. Константы: `CATEGORIES` (10 разделов с иконками/oklch-акцентами), `ARTICLE_ICONS` (мапа slug→иконка), `POPULAR_SLUGS`. **Экспортирует `{ CATEGORIES, ARTICLE_ICONS }`** — их переиспользует `WikiArticle.jsx`.
- **Зависимости:** `Link`, `useSearchParams`, `useNavigate` (react-router); `Page` (`../design`); данные — `indexData` из `../wiki-content/_index.json` + сырые `*.md` через `import.meta.glob('../wiki-content/*.md', { query:'?raw', eager:true })`.
- **Где менять для типовых задач:** добавить раздел — объект в `CATEGORIES` (id должен совпадать с `category` в `_index.json`); иконку статьи — `ARTICLE_ICONS[slug]`; популярные на главной — `POPULAR_SLUGS`; логику скоринга поиска — `CommandPalette.results` (сейчас title+10, summary+5, body+2). Сам контент статей — в `frontend/src/wiki-content/*.md` + `_index.json` (вне этого файла).
- **Подводные камни:** контент собирается на этапе сборки (`eager:true`) — новый `.md` требует пересборки и записи в `_index.json`. Группировка приоритетно по полю `category` из индекса, `categoryFromSlug` — только резерв. Это чистый фронт без API — нет tenant-фильтрации, документация общая для всех.
- **Строк:** 1384

## `frontend/src/pages/WikiArticle.jsx`
- **Назначение:** Рендер одной MD-статьи Wiki (`/wiki/:slug`): тот же 3-колоночный layout, что и `Wiki`, но центр — markdown-тело статьи с типографикой, авто-ToC из H2/H3, prev/next, связанные статьи, «Полезно?»-фидбек, edit-on-GitHub.
- **Ключевые элементы:** default `WikiArticle()`. Под-компоненты: `SidebarTree` (локальная копия из Wiki, но активна по slug — НЕ переиспользует Wiki-версию), `StickyToc`. Хелперы: `getMarkdown`, `slugifyHeading`, `parseFrontmatter` (минимальный YAML для `updated:`), `extractToc` (regex H2/H3, пропускает fenced-блоки), `readingTime` (≈200 слов/мин), `getFeedback`/`saveFeedback` (localStorage `wiki_feedback_v1`), `categoryFromSlug`. Большой объект `components` — кастомные рендереры для ReactMarkdown (h1/h2/h3 с якорями, code-блоки dark, таблицы, iframe). `IntersectionObserver` подсвечивает активный пункт ToC; Alt+←/→ навигируют prev/next.
- **Зависимости:** `Link`, `useParams`, `Navigate`, `useNavigate` (react-router); `ReactMarkdown` + `rehypeRaw` + `remarkGfm`; `Page` (`../design`); `indexData` (`_index.json`) + `import.meta.glob('*.md')`; **`{ CATEGORIES, ARTICLE_ICONS }` импортируются из `./Wiki`** (связь между двумя файлами).
- **Где менять для типовых задач:** стилизация markdown-элементов — объект `components`; формула reading-time — `readingTime`; правила извлечения ToC — `extractToc`; ссылка edit-on-GitHub — `ghUrl` (захардкожен репо `mr-khamzat/clinika`, путь `frontend/src/wiki-content/...`); фидбек-хранилище — `FEEDBACK_KEY`. Frontmatter-поля — `parseFrontmatter` (сейчас только `updated`/`date`).
- **Подводные камни:** `SidebarTree` здесь — отдельная копия от `Wiki.jsx` (дублирование: правки sidebar надо вносить в ОБА файла). Если статья/MD не найдены — `<Navigate to="/wiki" replace />`. `rehypeRaw` рендерит сырой HTML из MD — потенциальный XSS, но контент доверенный (свои `.md`). Заголовки H2/H3 в ToC и якоря используют одну `slugifyHeading` — кириллица сохраняется (`[^\wа-яё]`).
- **Строк:** 1277

## `frontend/src/pages/_AccountantShell.jsx`
- **Назначение:** Корпус-обёртка (layout) кабинета бухгалтера: адаптивный sidebar (desktop sticky 220px / mobile drawer) с меню разделов, брендом, именем клиники/юзера и кнопкой выхода. Оборачивает контент под-страниц `Acc*`.
- **Ключевые элементы:** default `AccountantShell({ active, children })`. **Экспортирует `ACC_NAV`** (массив разделов: summary/cash/acts/incoming/payments/payroll/spending/reports — key/label/icon/path). Хелперы: `logout` (чистит 4 ключа токенов + редирект на `/{SLUG}/login`), `useIsMobile` (matchMedia ≤880px). Подгружает профиль для шапки. Акцент задаётся CSS-переменными `--accent`/`--accent-soft`/`--accent-line` (бирюзовый `#0097A7`).
- **Зависимости:** `useNavigate` (react-router); `api`; `SLUG` (`../config`). Material Symbols.
- **Эндпоинты (вызываемые):** `GET /admins/me` (для имени клиники/юзера в шапке).
- **Где менять для типовых задач:** добавить раздел бухгалтера — объект в `ACC_NAV` (и создать соответствующую `accountant/Acc*.jsx`, передающую `active="<key>"`); цвет акцента — константы `ACC_ACCENT*`; брейкпоинт мобилы — `MOBILE_BREAKPOINT`; логика выхода — `logout`.
- **Подводные камни:** `active`-проп — это `key` из `ACC_NAV`; обрати внимание: путь `incoming` → `/accountant/incoming-invoices`, а ключ — `'incoming'` (используется в `AccIncomingInvoices` как `active="incoming"`). `logout` редиректит через `window.location.href` (полная перезагрузка), а не router. Блокирует скролл body при открытом drawer.
- **Строк:** 448

## `frontend/src/pages/_ManagerShell.jsx`
- **Назначение:** Корпус-обёртка под-страниц кабинета управляющего: sticky-topbar с «← Назад», иконкой/заголовком раздела, колоколом уведомлений; mobile bottom-nav (4 пункта + «Ещё»-drawer, сгруппированный по категориям); глобальный Cmd+K поиск.
- **Ключевые элементы:** default `ManagerShell({ active, title, subtitle, icon, badge, topbarRight, children })`. **Экспортирует `MGR_NAV`** (≈40 разделов с полями key/label/icon/path/group, плюс флаг `requiresMultiClinic`) и `MGR_NAV_GROUPS` (10 групп: reports/schedule/team/finance/subscriptions/inventory/marketing/communications/integrations/settings). Константы `BOTTOM_KEYS` (analytics/bonuses/kpi/history — для bottom-nav), `bottomItems`, `moreItems`.
- **Зависимости:** `useNavigate` (react-router); `api`; `Page`, `Chip` (`../design`); `CommandPalette` (`../components/CommandPalette`); `NotificationsBell` (`../components/NotificationsBell`).
- **Эндпоинты (вызываемые):** `GET /manager/clinics-accessible` (для скрытия пункта «Все клиники», если у юзера ≤1 клиники).
- **Где менять для типовых задач:** добавить раздел управляющего — объект в `MGR_NAV` (выбрать `group` из `MGR_NAV_GROUPS`, иначе попадёт в «Прочее»); изменить набор быстрых пунктов нижней навигации — `BOTTOM_KEYS`; новую группу — `MGR_NAV_GROUPS` (порядок = порядок отображения в drawer). Топбар-заголовок задаётся через props со стороны под-страницы.
- **Подводные камни:** `MGR_NAV` — единый источник правды, синхронизирован с `ManagerDashboard` (Quick Actions) — правки нужно держать согласованными. `requiresMultiClinic`-пункты скрываются до загрузки `clinics-accessible` (`accessibleClinicsCount` стартует `null`). Пункты без `group` падают в хвостовой блок «Прочее».
- **Строк:** 374

## `frontend/src/pages/accountant/AccActs.jsx`
- **Назначение:** Под-страница бухгалтера «Акты» (`/accountant/acts`): реестр актов выполненных работ с фильтрами (статус + диапазон дат), итоговой суммой и скачиванием PDF.
- **Ключевые элементы:** default `AccActs()` (внутри `<AccountantShell active="acts">`). Под-компонент `StatusChip` + карта `STATUS_META` (paid/signed/generated/draft/overdue). Хелперы `fmtMoney`/`fmtDate`, `actPdfUrl(id)`. Логика: `load` (с params фильтров), `downloadPdf`, `total` (useMemo сумма). Объекты-стили `th`/`td`.
- **Зависимости:** `api`; `Card`, `Button`, `Chip`, `EmptyState` (`../../design`); `API_BASE` (`../../config`); `AccountantShell` (`../_AccountantShell`).
- **Эндпоинты (вызываемые):** `GET /accountant/acts?status&date_from&date_to` (список); скачивание PDF — открывает в новой вкладке URL `${API_BASE}/acts/{id}/pdf` (бэк-роутер `acts.py:get_act_pdf`).
- **Где менять для типовых задач:** новые статусы/их цвета — `STATUS_META` + `<option>` в фильтре; URL PDF — `actPdfUrl` (комментарий прямо указывает: для отдельного accountant-URL менять здесь); колонки таблицы — `<thead>`/`<tbody>`.
- **Подводные камни:** PDF открывается через `window.open` (НЕ через axios) — токен не подкладывается interceptor'ом, полагается на куки/сессию браузера; если у акта `has_pdf===false` — `alert('Скачивание PDF будет в Phase 2')` (фича не доделана). `total` суммирует через `Number(a.amount_total)||0` (защита от Decimal-строк). Фильтры триггерят `load` через `useEffect` deps (с eslint-disable).
- **Строк:** 269

## `frontend/src/pages/accountant/AccCash.jsx`
- **Назначение:** Под-страница «Касса» (`/accountant/cash`): управление кассовыми сменами — открытие, лента приходов/расходов, синхронизация платежей из МИС, закрытие смены со сверкой (discrepancy), история последних 20 смен.
- **Ключевые элементы:** default `AccCash()` (внутри `<AccountantShell active="cash">`). Под-компонент `Field`. Константы категорий `CAT_IN`/`CAT_OUT`. Хелперы `fmtMoney`/`fmtTime`/`fmtDateTime`/`fmtDate`, `inputStyle`. Логика: `reload` (параллельно current+history), `handleOpen`, `openEntry`/`handleAddEntry`, `syncMisPayments`, `openCloseModal`/`handleClose`, `expectedCashOnHand` (useMemo: `cash_start + in_total - out_total`). Три ветки рендера: загрузка / нет смены (форма открытия) / открытая смена (header + лента). Две `<Modal>`: добавить операцию и закрыть смену.
- **Зависимости:** `api`; `Card`, `Button`, `Chip`, `Modal`, `EmptyState` (`../../design`); `AccountantShell` (`../_AccountantShell`).
- **Эндпоинты (вызываемые):** `GET /accountant/cash/current` (null/404 = нет смены), `GET /accountant/cash/history?limit=20`; `POST /accountant/cash/open` ({cash_start, notes}); `POST /accountant/cash/{id}/entries` ({direction, amount, category, description}); `POST /accountant/cash/{id}/close` ({cash_end_actual, notes}); `POST /accountant/cash/sync-mis-payments` (импорт наличных/карт из МИС с дедупликацией).
- **Где менять для типовых задач:** категории операций — `CAT_IN`/`CAT_OUT`; формула ожидаемого остатка — `expectedCashOnHand`; поведение синхронизации МИС — `syncMisPayments` (показывает `alert` со сводкой imported_cash/imported_card/skipped_dup); валидацию сумм — `handleAddEntry` (`amt>0`) / `handleClose` (`actual>=0`).
- **Подводные камни:** `/cash/current` намеренно ловит 404 как «нет смены» (а не ошибку) — см. `.catch` в `reload`. Все суммы парсятся `Number(...)` перед арифметикой (бэк отдаёт Decimal-строки) — discrepancy сравнивается с `< 0.01` (защита от float-погрешности). `syncMisPayments` использует `window.alert` для отчёта (легаси). После закрытия `shift` обнуляется и показывается баннер `closedShift` с расхождением.
- **Строк:** 602

## `frontend/src/pages/accountant/AccIncomingInvoices.jsx`
- **Назначение:** Под-страница «Счета от клиник сети» (`/accountant/incoming-invoices`): входящие межклиничные счета (за бонусы/услуги от других клиник франшизы). Бухгалтер видит ТОЛЬКО уже согласованные руководителем счета (approved/paid) и отмечает их оплаченными.
- **Ключевые элементы:** default `AccIncomingInvoices()` (внутри `<AccountantShell active="incoming">`). Карта `STATUS_META` (approved/paid). Хелперы `fmtMoney`/`fmtDate`. Состояние: `tab` (approved/paid/all), `items`, `paying`. Логика: `load` (фильтр по status), `pay` (с `window.confirm`), `stats` (useMemo: count + approvedSum). Рендер карточек с подписью согласовавшего (`approved_by_name`/`role`/`approved_at`).
- **Зависимости:** `api`; `Card`, `Button`, `EmptyState` (`../../design`); `AccountantShell` (`../_AccountantShell`).
- **Эндпоинты (вызываемые):** `GET /clinic-invoices/incoming?status=approved|paid` (для tab=all — без status, потом фронт фильтрует до approved+paid); `PATCH /clinic-invoices/{id}/pay` (отметить оплаченным).
- **Где менять для типовых задач:** статусы/их цвета — `STATUS_META`; вкладки — массив в JSX (`approved`/`paid`/`all`); подтверждение оплаты — `pay` (`window.confirm`); итоговую сводку «К оплате» — блок `stats` в конце.
- **Подводные камни:** бизнес-правило: `pending_approval`-счета намеренно НЕ показываются бухгалтеру (видны только руководителю) — для tab='all' фронт дополнительно фильтрует `['approved','paid'].includes(i.status)`. `active="incoming"` должен совпадать с ключом `incoming` в `ACC_NAV` шелла. `pay` использует `window.confirm`/`window.alert` (легаси-стиль). Подпись согласовавшего — «договорной артефакт», показывается всегда при наличии `approved_at`.
- **Строк:** 202
