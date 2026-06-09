# frontend-misc [01] — инфраструктурный слой фронтенда: API-клиент, хуки, lib-хелперы, стор, темы

Эта группа — несущая инфраструктура React-фронтенда МИС «КлиникСеть». Здесь нет страниц и крупных компонентов; вместо них собраны сквозные сервисы, которыми пользуется весь UI: единый axios-инстанс (`api/index.js`) с двойной токен-системой и auto-refresh, тематические API-обёртки (`chatSlots`, `partnerOffers`), переиспользуемые React-хуки (звук чата, realtime-звонки по WebSocket, горячие клавиши регистратора, выбор клиники, тема), low-level lib-хелперы (Web Audio тоны звонка, mediaDevice-предпочтения, действия по телефону, Telegram SDK, Web Push), а также zustand-стор аутентификации и загрузчик CMS-темы.

Ключевая сквозная сущность — **мультитенантность через `SLUG`** (см. `frontend/src/config.js`): slug тенанта вычисляется из первого сегмента URL, из него строятся `API_BASE` (`/<slug>/api`) и имена ключей localStorage. Почти все файлы этой группы так или иначе завязаны на `SLUG`/`API_BASE`, а токены хранятся per-slug в двух независимых пространствах (пациент/партнёр vs админ-панель).

Все API-обёртки используют общий axios-инстанс из `api/index.js`, поэтому auth-заголовок, `X-Tenant-Slug`, auto-refresh при 401 и обработка region-lock 403 применяются ко всем запросам автоматически.

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `frontend/src/api/index.js` | Единый axios-инстанс: токены, refresh, region-lock + REST-функции | 238 |
| `frontend/src/api/chatSlots.js` | API клиент slot-booking endpoints чата | 25 |
| `frontend/src/api/partnerOffers.js` | API партнёрского прайса: категории и офферы | 24 |
| `frontend/src/hooks/useChatSoundNotification.js` | Звуковой «ping» на новое сообщение чата | 47 |
| `frontend/src/hooks/usePatientCallListener.js` | WebSocket-хук realtime входящих звонков в ЛК | 125 |
| `frontend/src/hooks/useRegHotkeys.js` | Глобальные горячие клавиши регистратора (Alt/Ctrl+K) | 77 |
| `frontend/src/lib/callTones.js` | Web Audio тоны: гудок и мелодия звонка | 128 |
| `frontend/src/lib/deviceStorage.js` | Сохранение mic/cam ID + constraints getUserMedia | 55 |
| `frontend/src/lib/phoneActions.js` | Действия по телефону: звонок, WhatsApp, печать | 115 |
| `frontend/src/lib/tg.js` | Безопасная обёртка Telegram Web App SDK | 116 |
| `frontend/src/lib/useClinicScope.js` | Хук выбора клиники в аналитике (sticky) | 97 |
| `frontend/src/lib/useTheme.js` | Хук тёмная/светлая тема для всех кабинетов | 99 |
| `frontend/src/lib/webPush.js` | Web Push: регистрация SW, подписка, отписка | 97 |
| `frontend/src/store/auth.js` | zustand-стор токена/пользователя (легаси, частичный) | 19 |
| `frontend/src/utils/ThemeLoader.js` | Загрузчик CMS-темы клиники (CSS-переменные) | 46 |

---

## `frontend/src/api/index.js`

- **Назначение:** Сердце сетевого слоя. Создаёт единый axios-инстанс с `baseURL = API_BASE`, навешивает request/response-интерсепторы (подстановка токена и `X-Tenant-Slug`, auto-refresh при 401, спец-обработка region-lock 403) и экспортирует десятки именованных REST-функций для всех разделов (auth, бонусы, рефералы, manager-отчёты/KPI/настройки/услуги/партнёры/инвайты, МИС-интеграция).
- **Ключевые элементы:**
  - `default export api` — настроенный axios-инстанс (его импортируют почти все остальные файлы группы и весь проект).
  - Внутренние: `_isAdminPath()` — определяет, открыта ли админ-страница по `window.location.pathname`; `_getActiveTokenInfo()` — выбирает активный токен (admin vs user) и возвращает `{kind, tokenKey, refreshKey, token}`; `_showRegionBlockModal(detail)` — диспатчит CustomEvent `region-lock-blocked` + alert-fallback.
  - Модульный кэш `_refreshing` (per-tokenKey) — дедуп параллельных refresh при пачке 401.
  - REST-функции: `authTelegram`, `loginPassword`, `getMe`, `updateMe`, `getBonusSummary/getBonuses`, `getClinics/getServices/getClinicServices`, рефералы (`createReferral`, `getReferrals`, `getIncomingReferrals`, `scanQR`, `confirmByCode`, `requestCancelReferral`…), manager-блок (`getManagerSummary`, `getManagerAdmins`, `markBonusPaid`, `exportCSV`, KPI, activity, settings, services-категории), партнёры/инвайты, МИС (`syncMisServices`, `verifyPatientInMis`).
- **Эндпоинты:** не роутер (это клиент), но дёргает множество backend-путей. Ключевые: `POST /auth/login`, `POST /auth/telegram`, `POST /auth/refresh` (в интерсепторе), `GET /admins/me`, `GET /manager/clinics-accessible` (косвенно через другие файлы), `GET/POST /referrals/*`, `GET/POST/PATCH/DELETE /manager/*`. Доступ определяется backend-ом по Bearer-токену.
- **Зависимости:** `axios`; `API_BASE`, `BASE_PATH`, `SLUG` из `../config`. Сам по себе зависит только от config; от него зависят `chatSlots.js`, `partnerOffers.js`, `useClinicScope.js`, `webPush.js` и весь UI.
- **Где менять для типовых задач:**
  - Новый REST-вызов общего назначения — добавить именованный `export const` в конце файла (строки 145–236).
  - Поменять логику выбора токена (например, новый класс ролей) — `_getActiveTokenInfo()` / `_isAdminPath()` (строки 14–39).
  - Изменить поведение при 401/refresh — response-интерсептор (строки 99–140).
  - Поведение region-lock (заменить alert на свою модалку) — слушать `window.addEventListener('region-lock-blocked', …)`; диспатч в `_showRegionBlockModal` (строки 65–82).
  - Добавить общий заголовок ко всем запросам — request-интерсептор (строки 41–50).
- **Подводные камни:**
  - **Две независимые токен-системы** на один SLUG: `clinika_token_<SLUG>` (пациент/партнёр) и `clinika_admin_token_<SLUG>` (admin/manager/franchise/super). Выбор зависит от `pathname` — при изменении схемы роутинга `_isAdminPath` нужно синхронизировать.
  - `cfg._retry` защищает от бесконечного цикла рефреша — не сбрасывать.
  - Region-lock детектится по **строковому префиксу** русского `detail` (`'Доступ заблокирован: вы вне разрешённого региона'`) — хрупко: при смене текста на backend сломается. Дедуп 5 сек.
  - Отдельный «голый» `axios.post` для `/auth/refresh` (без интерсепторов) — намеренно, чтобы 401 на refresh не зациклился.
  - Несогласованность стиля: одни функции возвращают полный axios-response (`api.get(...)`), другие файлы (chatSlots/partnerOffers) сами делают `.then(r => r.data)`.
- **Строк:** 238

## `frontend/src/api/chatSlots.js`

- **Назначение:** Тонкая API-обёртка для slot-booking в чате клиника↔пациент: регистратор предлагает слоты, пациент запрашивает/бронирует.
- **Ключевые элементы:** объект `chatSlotsApi` с методами `postSlotOffer(threadId, body)`, `postSlotRequest(threadId, body)`, `bookSlot(threadId, messageId, slotIdx)`.
- **Эндпоинты (вызываемые):**
  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | POST | `/clinic-chat/threads/{thread_id}/slot-offer` | регистратор/клиника | `body` (слоты) | данные оффера | Предложить пациенту слоты |
  | POST | `/patient/chat/threads/{thread_id}/slot-request` | пациент | `body` | данные запроса | Пациент запрашивает слот |
  | POST | `/patient/chat/threads/{thread_id}/book-slot` | пациент | `{message_id, slot_idx}` + header `Idempotency-Key` | результат брони | Забронировать выбранный слот |
- **Зависимости:** `api` из `./index` (наследует токены/refresh/slug).
- **Где менять для типовых задач:** добавить новую slot-операцию — новый метод в `chatSlotsApi`. Используется в компонентах `SlotOfferBubble` / `SlotRequestBubble` / `ClinicSlotPicker` / `PatientSlotRequestPicker` (см. шапку файла).
- **Подводные камни:** `bookSlot` отправляет `Idempotency-Key: ${threadId}-${messageId}-${slotIdx}` — защита от двойного клика; backend обязан уважать этот ключ, иначе возможна двойная бронь. Все три метода возвращают уже `r.data` (а не response).
- **Строк:** 25

## `frontend/src/api/partnerOffers.js`

- **Назначение:** API-обёртка партнёрского прайса: CRUD категорий партнёров и офферов (своих и чужих по clinicId для франшизной видимости).
- **Ключевые элементы:**
  - `partnerCategoriesApi`: `list()`, `create(data)`, `update(id, data)`, `remove(id)`.
  - `partnerOffersApi`: `listMy(includeInactive=true)`, `listForClinic(clinicId)`, `createBulk(data)`, `update(id, data)`, `remove(id)`.
- **Эндпоинты (вызываемые):**
  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/clinics/me/partner-categories` | менеджер-владелец | — | список | Свои категории |
  | POST | `/clinics/me/partner-categories` | менеджер-владелец | `data` | категория | Создать категорию |
  | PATCH | `/clinics/me/partner-categories/{id}` | менеджер-владелец | `data` | категория | Обновить |
  | DELETE | `/clinics/me/partner-categories/{id}` | менеджер-владелец | — | — | Удалить |
  | GET | `/clinics/me/partner-offers?include_inactive=` | менеджер-владелец | query | список офферов | Свой прайс (с неактивными) |
  | GET | `/clinics/{clinicId}/partner-offers` | франшиза | — | список | Чужой прайс (Task 8) |
  | POST | `/clinics/me/partner-offers` | менеджер-владелец | `data` (bulk) | офферы | Массовое создание |
  | PATCH | `/clinics/me/partner-offers/{id}` | менеджер-владелец | `data` | оффер | Обновить |
  | DELETE | `/clinics/me/partner-offers/{id}` | менеджер-владелец | — | — | Удалить |
- **Зависимости:** `api` из `../api` (т.е. `api/index.js`).
- **Где менять для типовых задач:** добавить операцию над прайсом — новый метод в соответствующем объекте. Связь «свой/чужой прайс» через `me` vs `{clinicId}`.
- **Подводные камни:** `listMy` по умолчанию включает неактивные офферы (`include_inactive=true`) — чтобы их можно было снова включить; не путать с публичным списком. Все методы возвращают `r.data` (кроме `remove`, возвращающего сырой response). Цены офферов на backend — Decimal; на фронте приходят как строки/числа в JSON.
- **Строк:** 24

## `frontend/src/hooks/useChatSoundNotification.js`

- **Назначение:** React-хук, возвращающий функцию `playSound()` — короткий двухнотный «ping» (880→660 Гц, ~120–200 мс) на новое сообщение чата. Реализован через Web Audio API, без mp3-ассета.
- **Ключевые элементы:** `default export useChatSoundNotification({ enabled=true, volume=0.18 })` → возвращает мемоизированный `useCallback`. Держит `AudioContext` в `useRef` (`ctxRef`).
- **Эндпоинты:** нет.
- **Зависимости:** только `react` (`useCallback`, `useRef`). Браузерный Web Audio API.
- **Где менять для типовых задач:** изменить тембр/длительность/высоту — параметры осциллятора `o1` и envelope `gain` (строки 27–41). Включение по настройке — параметр `enabled`.
- **Подводные камни:** AudioContext может стартовать в `suspended` (autoplay-политика) — есть `ctx.resume()`, но реальный звук возможен только после первого пользовательского жеста. Все ошибки молча проглатываются (`catch {}`) — отладка через консоль не сработает. SSR-guard на `typeof window`.
- **Строк:** 47

## `frontend/src/hooks/usePatientCallListener.js`

- **Назначение:** Хук realtime-входящих звонков в личном кабинете пациента. Открывает WebSocket `/patient/notifications/ws/{phone}?token=…`, слушает `incoming_call`/`call_cancelled`, отвечает на `ping` pong-ом, авто-реконнект с backoff.
- **Ключевые элементы:** `default export usePatientCallListener({ phone, token, apiBase })` → `{ incomingCall, dismissCall }`. Внутри: `connect()`, `scheduleReconnect()`, refs `wsRef/attemptRef/reconnectTimerRef/closedByUserRef`. Константа `RECONNECT_DELAYS = [1000, 2000, 5000, 10000]`.
- **Эндпоинты (WS):**
  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | WS | `/patient/notifications/ws/{phone}?token=…` | пациент (patient_session_token) | сообщения `ping/connected` | события `incoming_call`, `call_cancelled` | Realtime-уведомления о звонке врача |
- **Зависимости:** только `react`. WebSocket строится из `apiBase` (http→ws, https→wss). Потребитель — `PatientCabinet.jsx` + компонент `IncomingCallModal`.
- **Где менять для типовых задач:**
  - Новый тип WS-сообщения — `case` в `ws.onmessage` switch (строки 65–89).
  - Изменить тайминги реконнекта — `RECONNECT_DELAYS` (строка 23).
  - Поля карточки звонка — объект в `case 'incoming_call'` (строки 73–80).
- **Подводные камни:**
  - Токен передаётся **в query-string URL** WS (а не в заголовке) — попадает в логи прокси; это осознанное ограничение WS API.
  - `closedByUserRef` отличает «закрыли мы» от обрыва — без него unmount вызвал бы лишний reconnect.
  - `call_cancelled` закрывает модалку только при совпадении `session_id` (защита от гонки).
  - effect-deps `[phone, token, apiBase]` — при смене токена WS пересоздаётся (корректно).
  - `phone` URL-энкодится; backend нормализует формат (+/без +).
- **Строк:** 125

## `frontend/src/hooks/useRegHotkeys.js`

- **Назначение:** Глобальные горячие клавиши рабочего места регистратора: `Alt+N/R/S/P/W` и `Ctrl/Cmd+K`. Не срабатывают в полях ввода (кроме Ctrl+K).
- **Ключевые элементы:** `default export useRegHotkeys(actions={}, { disabled=false })`. Колбэки: `onNewPatient` (Alt+N), `onBookAppointment` (Alt+R), `onSearch` (Alt+S), `onPrintLast` (Alt+P), `onWaitlist` (Alt+W), `onCommandPalette` (Ctrl+K). Хелпер `_isEditable(el)`. Держит actions в `useRef`, чтобы не пересоздавать listener.
- **Эндпоинты:** нет.
- **Зависимости:** только `react` (`useEffect`, `useRef`).
- **Где менять для типовых задач:** новый хоткей — добавить в `map` (по `key`) и `codeMap` (по `code`) и принять новый колбэк (строки 53–67). Глобально отключить — флаг `disabled`.
- **Подводные камни:** учтена **русская раскладка** — на ней `Alt+R` даёт «к», поэтому проверяется и `e.code` (`keyr`), а не только `e.key`. Ctrl+K срабатывает даже из инпутов (палитра команд), Alt-комбинации — нет. `e.preventDefault()` глушит дефолт браузера. `disabled` в deps — слушатель пересоздаётся при смене.
- **Строк:** 77

## `frontend/src/lib/callTones.js`

- **Назначение:** Генерация звуковых сигналов звонка через Web Audio API: `ringback` (гудок исходящего, 425 Гц, 1с/4с, RU PSTN) и `ringtone` (мелодия входящего, триада нот, повтор каждые 3 с). Без аудио-ассетов.
- **Ключевые элементы:** экспорты `startRingback()`, `stopRingback()`, `startRingtone()`, `stopRingtone()`, `stopAllTones()`. Модульный синглтон `_audioCtx` через `ctx()`; состояния `_rb`/`_rt` (осциллятор/gain/interval).
- **Эндпоинты:** нет.
- **Зависимости:** только браузерный Web Audio API. Логически парный с `usePatientCallListener.js` / звонковыми компонентами.
- **Где менять для типовых задач:** изменить мелодию входящего — массив `NOTES` (строки 74–80); тайминг гудка — `PERIOD`/`ON` (строки 33–34); громкость — `gain.value`/`master.gain.value`.
- **Подводные камни:**
  - **Обязательно вызывать stop-функции** при завершении/смене состояния звонка — иначе `setInterval` продолжит планировать ноты бесконечно (утечка/назойливый звук). `stopAllTones()` — страховка.
  - `_audioCtx` переиспользуется как синглтон; пересоздаётся только если `closed`. Autoplay-политика: `resume()` сработает лишь после жеста пользователя.
  - Ноты планируются батчами вперёд (на 30 с) + `setInterval` подкидывает ещё — при долгом звонке interval критичен.
- **Строк:** 128

## `frontend/src/lib/deviceStorage.js`

- **Назначение:** Хранение предпочитаемых ID микрофона/камеры в localStorage и построение `constraints` для `getUserMedia` с этими устройствами.
- **Ключевые элементы:** `getPreferredMic()`, `setPreferredMic(id)`, `getPreferredCam()`, `setPreferredCam(id)`, `buildMediaConstraints({ audio, video })`. Ключи: `clinika_mic_device_id`, `clinika_cam_device_id`.
- **Эндпоинты:** нет.
- **Зависимости:** только `localStorage`. Используется WebRTC/видео-консультацией.
- **Где менять для типовых задач:** изменить дефолтное качество видео/аудио — `baseVideo`/`baseAudio` в `buildMediaConstraints` (строки 30–49). Передача `null/''` в setter — удаляет ключ (сброс на дефолт устройства).
- **Подводные камни:** ключи **не** содержат SLUG — предпочтение устройства глобально на браузер (намеренно: микрофон не зависит от тенанта). `deviceId: { exact }` может бросить `OverconstrainedError`, если выбранное устройство отключили — вызывающий код должен ловить и фоллбэчить на дефолтные constraints. Все обращения к localStorage в `try/catch` (приватный режим).
- **Строк:** 55

## `frontend/src/lib/phoneActions.js`

- **Назначение:** Единые действия по телефонному номеру для UI: звонок (Electron deep-link или `tel:`), WhatsApp (`wa.me`), построение `href`-ов, очистка номера, печать визита/QR в дочернем окне.
- **Ключевые элементы:** `cleanPhone(phone)`, `telHref(phone)`, `waHref(phone)`, `waHrefWithText(phone, text)`, `callPhone(phone)`, `whatsappPhone(phone, text)`, `printVisit({...})`. Детект Electron через `window.clinikset?.isElectron` (приложение «Clinikset Calls»).
- **Эндпоинты:** нет (использует deep-link `clinikset://call?phone=…`, `tel:`, `https://wa.me/…`).
- **Зависимости:** только браузер/`window`. Интеграция с Electron-мостом `window.clinikset.shell.openExternal`.
- **Где менять для типовых задач:**
  - Изменить интеграцию звонков (другая телефония) — `callPhone()` (строки 54–66).
  - Текст печатного бланка визита — HTML-шаблон в `printVisit()` (строки 96–112).
  - Шаблон WhatsApp-сообщения — вызывающий код передаёт `text` в `whatsappPhone`/`waHrefWithText`.
- **Подводные камни:** `printVisit` экранирует данные через `safe()` (XSS при вставке в `document.write` дочернего окна) — **не убирать** экранирование. `cleanPhone` оставляет только цифры (для `wa.me`/E.164) — теряет `+`; `telHref` плюс сохраняет. Electron-ветки имеют graceful fallback на web-поведение. `window.open` может быть заблокирован попап-блокером (проверка `if (!w) return`).
- **Строк:** 115

## `frontend/src/lib/tg.js`

- **Назначение:** Безопасная обёртка над Telegram Web App SDK. Гарантирует, что Telegram **никогда не блокирует** запуск: если SDK не загрузился за 2 с — приложение работает как обычный веб-апп. Поддерживает оба режима (standalone web / Telegram Mini App).
- **Ключевые элементы:** `loadTelegramSDK()` (динамически подключает скрипт SDK, мемоизирует Promise `_sdkPromise`), `waitForTelegramSDK(timeout)`, `initTgApp(tg)` (`ready()`+`expand()`), `isTelegramWebApp()`, `getTgUser()`, `getTgInitData()`. Константы `SDK_WAIT_MS=2000`, `SDK_URL`.
- **Эндпоинты:** нет (грузит внешний `https://telegram.org/js/telegram-web-app.js`). `getTgInitData()` отдаёт `initData` для верификации на backend (через `authTelegram` в `api/index.js`).
- **Зависимости:** браузер/`window.Telegram.WebApp`. Используется в `PatientCabinet` (`/p/`) и при детекте Mini App в `App.jsx`.
- **Где менять для типовых задач:** изменить таймаут детекта — `SDK_WAIT_MS`. Добавить чтение нового поля Telegram-юзера — отдельный геттер по аналогии с `getTgUser`. Детект «это Telegram?» — проверка `tgWebApp` в `window.location.hash` (строка 71).
- **Подводные камни:** SDK грузится **лениво**, только если hash содержит `tgWebApp` — из глобального `index.html` его НЕ подключают (не нужен лендингу/admin/manager). Все обращения к `window.Telegram` через optional chaining — безопасны вне Telegram. `loadTelegramSDK` идемпотентен (не дублирует `<script>`). SSR-guard на `typeof document`.
- **Строк:** 116

## `frontend/src/lib/useClinicScope.js`

- **Назначение:** Хук выбора активной клиники в селекторе аналитики/отчётов. Грузит доступные пользователю клиники, хранит выбор в localStorage (sticky при reload), вычисляет `isMultiClinic`.
- **Ключевые элементы:** `default export useClinicScope()` → `{ clinics, selectedId, setSelectedId, isLoading, isMultiClinic, error }`. Хелпер `hasAnyToken()`. Ключ localStorage `clinika_selected_clinic_<SLUG>`.
- **Эндпоинты (вызываемые):**
  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/manager/clinics-accessible` | manager/franchise_owner | — | список клиник `{id, is_default, …}` | Список доступных пользователю клиник |
- **Зависимости:** `react`; `api` из `../api`; `SLUG` из `../config`.
- **Где менять для типовых задач:** изменить дефолтный выбор клиники — логика в `.then` (строки 64–74: валидный stored → `is_default` → первая). Сброс/persist — `setSelectedId` (строки 43–49). Условие показа селектора — `isMultiClinic` (`clinics.length > 1`).
- **Подводные камни:** `selectedId === ''` означает **«все клиники»** (доступно только manager без `user.clinic_id` и franchise_owner) — не путать с «ничего не выбрано». `hasAnyToken()` проверяет и легаси-ключи (`token`, `clinika_token`, `clinika_admin_token_`) — техдолг разнобоя ключей. `cancelled`-флаг гасит setState после unmount. Ключ выбора per-SLUG (изоляция тенантов).
- **Строк:** 97

## `frontend/src/lib/useTheme.js`

- **Назначение:** Единый хук переключения тёмной/светлой темы для всех кабинетов. Хранит выбор в `localStorage('clinika-theme')`, применяет к `<html>` `data-theme` и класс `dark` (для Tailwind `dark:`), мигрирует легаси-ключи, предотвращает «вспышку» ранним применением до рендера.
- **Ключевые элементы:** `useTheme()` (named + default) → `{ theme, setTheme, toggle, isDark }`. Хелперы `readInitialTheme()`, `applyDomTheme(theme)`. Константы `STORAGE_KEY='clinika-theme'`, `LEGACY_KEYS=['theme','adminTheme']`. Side-effect на импорте: применяет тему сразу (строки 60–64).
- **Эндпоинты:** нет.
- **Зависимости:** только `react`. Параллельно `ThemeLoader.js` (но это про **другую** ось — там CMS-брендинг, здесь dark/light).
- **Где менять для типовых задач:** добавить третий режим (например `auto`/system) — расширить `readInitialTheme`, `applyDomTheme`, `setTheme` (сейчас принимает только `'dark'|'light'`). Синхронизация между вкладками — `storage`-listener (строки 75–84).
- **Подводные камни:** пишет тему сразу в **три** ключа (`clinika-theme`, `theme`, `adminTheme`) для обратной совместимости — техдолг; при изменении не забыть все три. Ранний side-effect при импорте модуля — порядок импортов влияет на отсутствие FOUC. **Не конфликтует** с `ThemeLoader` по ключам, но обе системы трогают `document.documentElement` (одна dataset/class, другая CSS-переменные).
- **Строк:** 99

## `frontend/src/lib/webPush.js`

- **Назначение:** Хелперы Web Push: регистрация Service Worker, запрос разрешения, подписка через `PushManager` с VAPID-ключом от backend, отправка/снятие подписки.
- **Ключевые элементы:** `enableWebPush()`, `disableWebPush()`, `getPushPermissionState()`. Внутренние: `urlBase64ToUint8Array(base64)`, `ensureRegistration()`. Константа `SW_PATH='/sw.js'`. Возвраты `{ ok, reason?, endpoint?, reused?/already? }`.
- **Эндпоинты (вызываемые):**
  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/push/vapid-public-key` | без auth | — | `{public_key}` или `{key}` | Публичный VAPID-ключ |
  | POST | `/push/subscribe` | авторизован | `{endpoint, keys, user_agent}` | — | Зарегистрировать подписку |
  | DELETE | `/push/unsubscribe` | авторизован | `{endpoint}` (в `data`) | — | Снять подписку |
- **Зависимости:** `api` из `../api`; браузерные `navigator.serviceWorker`, `PushManager`, `Notification`. Зависит от наличия `/sw.js` в public.
- **Где менять для типовых задач:** сменить путь/scope SW — `SW_PATH`/`register` (строки 11, 28). Добавить метаданные подписки — тело `POST /push/subscribe` (строки 62–66). Имя поля VAPID — учитывает оба варианта `public_key`/`key` (строка 54).
- **Подводные камни:** `enableWebPush` сначала проверяет существующую подписку (`getSubscription`) и переиспользует (`reused: true`) — без неё повторный вызов создавал бы дубль. DELETE отправляет тело через `{ data: ... }` (особенность axios для DELETE). Ошибки не бросаются, а возвращаются как `{ ok:false, reason }` — вызывающему надо проверять `ok`. iOS Safari требует PWA-установки для push (не покрыто кодом).
- **Строк:** 97

## `frontend/src/store/auth.js`

- **Назначение:** Минимальный zustand-стор аутентификации (token + user). **Частично легаси / неполный**: знает только про пользовательский токен `clinika_token_<SLUG>`, не про админский и не про refresh-токен.
- **Ключевые элементы:** `default export useAuthStore` (zustand `create`) c полями `token`, `user` и экшенами `setToken`, `setUser`, `logout`.
- **Эндпоинты:** нет.
- **Зависимости:** `zustand` (`create`); `SLUG` из `../config`.
- **Где менять для типовых задач:** добавить глобальное состояние юзера — здесь. Но прежде проверьте: реальная токен-логика (admin/user split, refresh) живёт в `api/index.js` и `localStorage`, а не тут.
- **Подводные камни:** **Несогласованность с `api/index.js`** — этот стор не умеет admin-токен (`clinika_admin_token_<SLUG>`) и не чистит refresh-ключи при `logout` (api-интерсептор чистит). Высокий риск рассинхрона: при логауте через стор админ-токен и refresh останутся в localStorage. Вероятно остаток ранней архитектуры — перед использованием как «источник правды» нужно выровнять с токен-логикой `api/index.js`.
- **Строк:** 19

## `frontend/src/utils/ThemeLoader.js`

- **Назначение:** Загрузчик **CMS-темы клиники** (брендинг тенанта): тянет цвета/шрифт/лого/favicon/title с backend и применяет как CSS-переменные на `:root`. Это ось «брендинг тенанта», отдельная от dark/light (`useTheme.js`).
- **Ключевые элементы:** `loadTheme()` (axios GET + кэш `cachedTheme` + apply), `applyTheme(theme)` (выставляет `--color-primary/secondary/sidebar/bg`, `--font-family`, favicon, document.title), `getTheme()`. Константа `DEFAULT_THEME` (бирюзовая палитра, brand «КлиникСеть»).
- **Эндпоинты (вызываемые):**
  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/cms/theme` | без auth (публично) | — | `{primary_color, …, favicon_url, meta_title, brand_name}` | Тема/брендинг клиники |
- **Зависимости:** `axios` (собственный вызов, **не** общий `api`-инстанс!); `API_BASE` из `../config`.
- **Где менять для типовых задач:** добавить новую брендинг-переменную — поле в `DEFAULT_THEME` + `root.style.setProperty` в `applyTheme` (строки 28–32). Поведение при ошибке — фоллбэк на `DEFAULT_THEME` (строки 19–21).
- **Подводные камни:** использует **голый `axios.get`**, минуя `api/index.js` — значит без auth-токена, без refresh, **но и без `X-Tenant-Slug`-заголовка**; тенант определяется только префиксом `API_BASE` (`/<slug>/api/cms/theme`). При ошибке тихо берёт дефолт (бирюза «КлиникСеть») — пользователь не узнает, что брендинг не загрузился. Модульный кэш `cachedTheme` — `getTheme()` до `loadTheme()` вернёт дефолт. Не конфликтует ключами с `useTheme`, но обе пишут в `document.documentElement`.
- **Строк:** 46
