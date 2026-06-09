# components [03] — чат клиники/пациента: слот-букинг, направления, калькулятор + карточка приёма

Это срез фронтенда (`frontend/src/components/`), почти целиком относящийся к **Главе 9 «Чат»** МИС «КлиникСеть». 14 из 15 файлов — это компоненты чата (`components/chat/`), плюс один файл календаря (`UpcomingCard`) и один файл звонков (`DeviceTestModal`). Вместе они образуют интерактивный слой переписки клиники с пациентом: пузыри сообщений с Markdown и реакциями, специализированные «баблы» для слот-букинга (предложение слотов → запрос → подтверждение), drawer'ы для записи на приём, создания направлений, расчёта цены, выпуска промокода и передачи треда другому сотруднику, а также правая панель с карточкой пациента.

Архитектурно это **тонкий презентационный слой**: компоненты сами дёргают backend через axios-инстанс `../../api` (несёт Bearer-токен и `tenant_id` на бэке) либо через тонкую обёртку `../../api/chatSlots`. Состояние локальное (`useState`/`useEffect`), глобального стора нет. Стилизация — **inline-стили** с CSS-переменными темы (`var(--accent, ...)`, `var(--sc-*, ...)`) и местами Tailwind-классы. Drawer'ы монтируются через `createPortal(... , document.body)`, чтобы не зависеть от overflow родителя. Денежные значения приходят с бэка готовыми (фронт их не считает) — финансовая логика и `tenant_id`-фильтрация полностью на сервере.

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `calendar/UpcomingCard.jsx` | Карточка ближайшего приёма пациента | 167 |
| `calls/DeviceTestModal.jsx` | Тест микрофона/камеры перед звонком | 229 |
| `chat/ClinicSlotPicker.jsx` | Клиника предлагает слоты пациенту (7 дней) | 296 |
| `chat/CreateReferralDrawer.jsx` | Inline-создание направления из чата | 145 |
| `chat/MarkdownText.jsx` | Безопасный inline-Markdown в сообщениях | 57 |
| `chat/MessageBubble.jsx` | Универсальный пузырь сообщения + диспетчер баблов | 405 |
| `chat/NewThreadModal.jsx` | Пациент создаёт новый тред с клиникой | 180 |
| `chat/PatientContextPanel.jsx` | Правая панель: карточка пациента + действия | 417 |
| `chat/PatientSlotRequestPicker.jsx` | Пациент запрашивает запись (врач/даты) | 110 |
| `chat/PriceCalculatorDrawer.jsx` | Мультивыбор услуг + расчёт скидки → чат | 275 |
| `chat/PromoCodeButton.jsx` | Кнопка-поповер выпуска промокода | 47 |
| `chat/ReassignModal.jsx` | Передача треда другому сотруднику | 98 |
| `chat/SlotBookedBubble.jsx` | Системный бабл «запись подтверждена» | 25 |
| `chat/SlotOfferBubble.jsx` | Бабл предложенных слотов с бронированием | 85 |
| `chat/SlotRequestBubble.jsx` | Бабл запроса записи от пациента | 33 |

---

## `frontend/src/components/calendar/UpcomingCard.jsx`
- **Назначение:** Презентационная карточка ближайшего приёма пациента. Два визуальных режима: «герой» (крупная градиентная карточка) и обычная компактная строка. Используется в `PatientCalendarSection.jsx`.
- **Ключевые элементы:** `export default UpcomingCard({ apt, highlight })`. Локальные хелперы дат: `parseDt`, `fmtDatePretty`, `fmtTime`, `daysUntil`. Константы `MONTHS_FULL`, `WEEKDAYS`. Метка «сегодня/завтра/через N дн.» вычисляется через `daysUntil`.
- **Эндпоинты:** нет (чистый презентационный компонент, данные приходят пропом `apt`).
- **Зависимости:** ничего не импортирует — самодостаточный. Стили инлайн + CSS-переменные `--surface/--border/--fg*`. Иконки Material Symbols.
- **Где менять для типовых задач:** добавить поле в карточку (например, кабинет/телефон врача) — добавь в JSX обоих режимов (highlight-ветка строки 51-99 и обычная 102-164) и убедись, что родитель кладёт поле в `apt`. Изменить пороги меток дней — функция `dayLabel` (строки 42-49).
- **Подводные камни:** `apt.datetime` парсится через `new Date(dt)` — ожидает ISO-строку; при некорректной дате `parseDt` вернёт `null` и покажет `—`. `WEEKDAYS` индексируется по `getDay()` (0=воскресенье), не перепутай с другими компонентами, где используется `(getDay()+6)%7` для Пн-первого порядка.
- **Строк:** 167

## `frontend/src/components/calls/DeviceTestModal.jsx`
- **Назначение:** Модал предзвонковой проверки устройств: live-превью камеры, VU-метр микрофона, выбор аудио/видео-устройства. По confirm запоминает выбор и отдаёт его наверх.
- **Ключевые элементы:** `export default DeviceTestModal({ open, onClose, onConfirm, title, confirmLabel })`. `enumerateDevices()` → списки `mics`/`cams`; `getUserMedia()` → стрим в `<video>` + `AudioContext`/`AnalyserNode` для уровня (`level` 0..100). `cleanup()` останавливает треки, закрывает AudioContext, отменяет `requestAnimationFrame`. `confirm()` сохраняет выбор и вызывает `onConfirm({mic, cam})`.
- **Эндпоинты:** нет (работа только с браузерным WebRTC/Media API).
- **Зависимости:** `../../lib/deviceStorage` — `getPreferredMic/setPreferredMic/getPreferredCam/setPreferredCam` (persist выбора в localStorage). React-хуки.
- **Где менять для типовых задач:** добавить выбор динамика (output device) — добавь `setSinkId` на video/audio и новый селектор. Поменять чувствительность VU-метра — формула `Math.round((avg/128)*100)` (строка 72) и пороги цвета (строка 155). Дефолтные заголовок/кнопку — пропсы `title`/`confirmLabel`.
- **Подводные камни:** обязателен `cleanup()` при размонтировании/смене устройств, иначе утечёт стрим и «зависнет» камера — он уже навешан в return эффекта (строка 82) и в `confirm`/`close`. `getUserMedia` с `deviceId: { exact }` бросит ошибку, если устройство исчезло — ошибка ловится в `error` и блокирует кнопку confirm (`disabled={!!error}`).
- **Строк:** 229

## `frontend/src/components/chat/ClinicSlotPicker.jsx`
- **Назначение:** Premium-drawer, в котором сотрудник клиники выбирает врача, услугу и до 5 свободных слотов на сетке 7 дней, затем отправляет их пациенту карточкой `slot_offer` в чат. Может быть преднастроен из запроса пациента (`defaults`).
- **Ключевые элементы:** `export default ClinicSlotPicker({ open, onClose, threadId, clinicId, defaults, onSent })`. `days` — мемо-массив 7 дат. `slotsByDate` — `{ 'YYYY-MM-DD': [{start_time, available}] }`. `toggleSlot`/`isSelected` — выбор max 5. `send()` строит массив `offers` и шлёт через `chatSlotsApi.offerSlots` (**баг/рассинхрон:** метода `offerSlots` в `api/chatSlots.js` нет — реальный метод `postSlotOffer`, POST `/clinic-chat/threads/{threadId}/slot-offer`; текущий вызов даёт runtime TypeError). Хелперы `fmtDateISO`, `fmtDateLabel`. Рендер через `createPortal`.
- **Эндпоинты (вызывает):**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/doctors?clinic_id=` | сотрудник клиники | query `clinic_id` | список врачей | заполнить селект врачей |
| GET | `/clinics/{clinicId}/services` | сотрудник | — | услуги клиники | список услуг (с fallback) |
| GET | `/manager/services/` | сотрудник | — | услуги | fallback, если нет clinic-эндпоинта |
| GET | `/doctors/{doctorId}/slots?target_date=` | сотрудник | query `target_date` | `[{start_time, end_time, available}]` | слоты врача на дату (×7) |
| POST | `/clinic-chat/threads/{threadId}/slot-offer` (метод `postSlotOffer`) | сотрудник | `[{doctor_id, service_id, date, start_time}]` | — | отправить предложение слотов в тред. **Баг:** код зовёт `chatSlotsApi.offerSlots`, которого нет в `chatSlots.js` (реальный метод — `postSlotOffer`) → runtime TypeError |

- **Зависимости:** `../../api` (axios), `../../api/chatSlots` (вызывает `offerSlots` — **отсутствующий метод**; в обёртке есть только `postSlotOffer`/`postSlotRequest`/`bookSlot`). `react-dom` `createPortal`. Парный компонент-получатель — `SlotOfferBubble`. Преднастройка приходит из `SlotRequestBubble` через родителя.
- **Где менять для типовых задач:** изменить горизонт дней (7→14) — массив `days` (строки 34-41) и сетку `gridTemplateColumns: 'repeat(7,1fr)'`. Лимит выбранных слотов (5) — `toggleSlot` (строка 82) и текст «/ 5». Формат отправляемого оффера — функция `send()` (строки 98-104), согласуй с бэком `chat_slots`.
- **Подводные камни:** загрузка слотов делает **7 параллельных GET** на каждого выбранного врача — на медленной сети заметно; есть `cancelled`-флаг от гонок. Услуги ищутся клиентским фильтром по `name||title` (строка 121) — большой каталог не пагинируется (slice 50). `s.available !== false` — слот считается свободным, если поле явно не `false`.
- **Строк:** 296

## `frontend/src/components/chat/CreateReferralDrawer.jsx`
- **Назначение:** Inline-форма создания направления (на услугу / к врачу / на анализы) прямо из треда чата, без перехода на отдельную страницу. После успеха показывает короткий код для пациента.
- **Ключевые элементы:** `export default CreateReferralDrawer({ open, onClose, threadId, clinicId, patientPhone, patientName, onCreated })`. Тип `type` ∈ `service|doctor|lab`. `submit()` валидирует по типу и шлёт `POST /referrals/`. Экран успеха показывает `done.short_code`.
- **Эндпоинты (вызывает):**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/clinics/{clinicId}/services` | сотрудник | — | услуги | селект услуг |
| GET | `/doctors?clinic_id=` | сотрудник | query `clinic_id` | врачи | селект врачей |
| POST | `/referrals/` | сотрудник | `{to_clinic_id, patient_phone, patient_name, referral_type, notes, [service_id\|target_doctor_id\|lab_tests]}` | `{short_code, ...}` | создать направление |

- **Зависимости:** `../../api`. Тематические переменные с префиксом `--sc-*` (scoped chat theme). Иконки Material Symbols.
- **Где менять для типовых задач:** добавить новый тип направления — массив переключателя (строка 93) + ветка `type === ...` для поля ввода + ветка в `submit` для payload. Изменить состав payload — объект `payload` (строки 43-52). Текст экрана успеха / поведение отправки кода — блок `done ?` (строки 82-89).
- **Подводные камни:** идентификация пациента идёт по `patient_phone` (не по id) — телефон обязателен от родителя. Комментарий про «Telegram/WhatsApp отправлены автоматически» — это серверная логика на `/referrals/`, фронт лишь показывает текст. Сброс формы — в `useEffect` при `open=false`.
- **Строк:** 145

## `frontend/src/components/chat/MarkdownText.jsx`
- **Назначение:** Безопасный рендер ограниченного inline-Markdown в теле сообщения (bold/italic/code/ссылки). Заголовки, списки, таблицы и raw-HTML намеренно отключены — это чат, не статья.
- **Ключевые элементы:** `export default MarkdownText({ children, className })`. Оборачивает `react-markdown` с `allowedElements={['p','strong','em','code','a','br']}`, `unwrapDisallowed`. Кастомные рендереры `p`/`a`/`code`. Константа `ALLOWED_TYPES` — справочная (в текущем коде в проп не передаётся).
- **Эндпоинты:** нет.
- **Зависимости:** внешний `react-markdown`. Используется в `MessageBubble`.
- **Где менять для типовых задач:** разрешить ещё элемент (например, списки) — добавь тег в `allowedElements` (строка 22) и при желании кастомный рендерер в `components`. Поменять стиль ссылок/кода — соответствующие рендереры (строки 27-49). Ссылки всегда открываются `target="_blank" rel="noreferrer noopener"`.
- **Подводные камни:** `ALLOWED_TYPES` (строка 15) объявлена, но не используется как пропс — потенциально мёртвая константа / остаток старого API react-markdown. `String(children)` защищает от не-строковых детей. Безопасность XSS опирается на то, что react-markdown по умолчанию не парсит raw HTML — не включай `rehype-raw`.
- **Строк:** 57

## `frontend/src/components/chat/MessageBubble.jsx`
- **Назначение:** Центральный компонент ленты сообщений. Рендерит обычный текстовый пузырь (с Markdown, цитатами reply_to, вложениями, стикерами, временем, статусом прочтения, реакциями) **и одновременно выступает диспетчером**: по `message_type` ранним return'ом отдаёт специализированные слот-баблы.
- **Ключевые элементы:** `export default MessageBubble({ message, isOwn, showAvatar, onReact, onReply, isPatient, threadId, onSlotBooked, onOfferRequest })`. Диспетчер `mt = message.message_type`: `slot_offer/slot_expired → SlotOfferBubble`, `slot_request → SlotRequestBubble`, `slot_booked → SlotBookedBubble`. Системные/bot-сообщения → серая пилюля. Хелперы `fmtTime`, `avatarColor` (хэш-палитра), `isImage`, `fileIconName`. `QUICK_REACTIONS` — emoji-пикер. Поддержка `sender_avatar_url`.
- **Эндпоинты:** нет напрямую — взаимодействия идут через колбэки `onReact`/`onReply`/`onSlotBooked`/`onOfferRequest`, которые реализует родитель (`PatientChatSection`/`ClinicChatSection`).
- **Зависимости:** локальные `./MarkdownText`, `./SlotOfferBubble`, `./SlotRequestBubble`, `./SlotBookedBubble`. React-хуки.
- **Где менять для типовых задач:** добавить новый тип сообщения-карточки — добавь ветку в диспетчер (строки 65-89) + создай парный бабл. Изменить набор быстрых реакций — `QUICK_REACTIONS` (строка 22). Поддержать новый тип вложения-иконки — `fileIconName` (строки 44-51). Логика «своё/чужое» — пропс `isOwn` (выравнивание, цвет градиента).
- **Подводные камни:** клик по цитате `reply_to` ищет DOM по `data-msg-id` и скроллит/подсвечивает (строки 172-203) — императивная манипуляция DOM в обход React, работает только если оригинал в текущей ленте. Стикеры — отдельная ветка (`type==='sticker'`), рендерятся без фона; `isStickerOnly` меняет всю обёртку. `read_at` → `done_all`, иначе `done` — только для своих сообщений.
- **Строк:** 405

## `frontend/src/components/chat/NewThreadModal.jsx`
- **Назначение:** Модал на стороне **пациента**: выбрать клинику (из тех, где есть история), задать тему и написать первое сообщение → создать новый тред.
- **Ключевые элементы:** `export default NewThreadModal({ open, onClose, onCreated, sessionToken, clinics, apiBase })`. `submit()` валидирует и шлёт `POST {apiBase}/patient/chat/threads` c `?t=sessionToken`. Спец-обработка `402` (лимит чатов → подписка «Здоровье+»). Авто-выбор клиники, если она одна.
- **Эндпоинты (вызывает):**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `{apiBase}/patient/chat/threads?t={sessionToken}` | пациент (по session-токену) | `{clinic_id, subject, initial_message}` | созданный thread | создать тред чата с клиникой |

- **Зависимости:** **прямой `axios`** (не общий `../../api`!), потому что пациентская сессия аутентифицируется query-параметром `t`, а не Bearer. React-хуки.
- **Где менять для типовых задач:** изменить лимиты длины — `maxLength` темы (120) и сообщения (2000). Поменять текст ошибки лимита — обработка `code === 402` (строка 57). Добавить вложение к первому сообщению — расширь форму и тело POST.
- **Подводные камни:** аутентификация **по `sessionToken` в query**, а не заголовком — отличается от остальных компонентов чата, которые ходят через `../../api`. `clinics` приходит пропом (список клиник с историей пациента); при пустом списке кнопка отправки заблокирована. Парсинг ошибок detail учитывает строку/массив/объект (строки 58-64).
- **Строк:** 180

## `frontend/src/components/chat/PatientContextPanel.jsx`
- **Назначение:** Правая колонка в чате **клиники**: карточка пациента (аватар, ФИО, возраст, телефон/email/ДР), последние приёмы, документы пациента (со скачиванием), быстрые действия «Записать на приём» / «Создать направление». На мобайле — overlay-drawer.
- **Ключевые элементы:** `export default PatientContextPanel({ threadId, variant, open, onClose, onBookAppointment, onCreateReferral, showBookButton })`. Загружает контекст по `threadId`. Хелперы: `initials`, `avatarColor` (HSL по seed), `ageFromBirth`, `ageWord` (русское склонение), `fmtDate/fmtTime/fmtDocDate/fmtSize`, `docTypeIcon/docTypeColor`, `downloadDoc` (blob через axios → `<a download>`). Карта статусов `APPT_STATUS`.
- **Эндпоинты (вызывает):**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/clinic/chat/threads/{threadId}/patient-context` | сотрудник клиники | — | `{patient, appointments[], documents[]}` | данные карточки пациента |
| GET | `{doc.file_url}` (responseType blob) | сотрудник | — | бинарь | скачать документ пациента |

- **Зависимости:** `../../api`. Колбэки `onBookAppointment`/`onCreateReferral` родитель связывает с `ClinicSlotPicker`/`CreateReferralDrawer`. Иконки Material Symbols.
- **Где менять для типовых задач:** добавить блок в карточку (аллергии, страховка) — расширь рендер `patient` (строки 206-394) и серверный ответ `patient-context`. Изменить число показываемых документов — `documents.slice(0, 10)` (строка 341). Логику склонения возраста — `ageWord`. Цвета статусов приёма — `APPT_STATUS`.
- **Подводные камни:** `variant='drawer'` рендерит только при `open=true` и не дёргает API, пока закрыт (флаг `active`, строка 152) — экономит запросы. Скачивание идёт через axios (Bearer), а не прямой `<a href>` — иначе документ за токеном не отдастся; расширение угадывается по `mime_type`. Кнопка «Показать все» (>10 документов) — заглушка через `alert` (строка 388), легаси/недоделка.
- **Строк:** 417

## `frontend/src/components/chat/PatientSlotRequestPicker.jsx`
- **Назначение:** Зеркало `ClinicSlotPicker` на стороне **пациента**: выбрать врача/услугу (опционально) и до 7 удобных дат, добавить комментарий → отправить `slot_request` в чат. Сотрудник потом ответит предложением слотов.
- **Ключевые элементы:** `export default PatientSlotRequestPicker({ open, onClose, threadId, onSent })`. Состояния `doctorId/serviceId/dates/note`. `toggleDate` (max 7). Список ближайших 14 дней (чекбоксы). `send()` → `chatSlotsApi.postSlotRequest`. Рендер через `createPortal`. Стилизация — **Tailwind-классы** (в отличие от соседних inline-drawer'ов).
- **Эндпоинты (вызывает):**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/patient/doctors` | пациент | — | врачи (public) | селект врачей, fallback `[]` при 404 |
| GET | `/patient/services` | пациент | — | услуги (public) | селект услуг, fallback `[]` |
| POST | `chatSlotsApi.postSlotRequest(threadId, ...)` | пациент | `{doctor_id, service_id, preferred_dates[], note}` | — | отправить запрос записи в тред |

- **Зависимости:** `../../api`, `../../api/chatSlots` (`postSlotRequest`). `react-dom` `createPortal`. Парный получатель — `SlotRequestBubble`.
- **Где менять для типовых задач:** изменить горизонт выбора дат (14) — цикл `for (let i=0; i<14; i++)` (строки 53-58). Лимит выбранных дат (7) — `toggleDate` (строка 31). Сделать врача/услугу обязательными — добавь валидацию в `send`.
- **Подводные камни:** **визуально отличается** от премиум-drawer'ов чата — это Tailwind, тёмно-зелёная кнопка, без CSS-переменных темы; кандидат на унификацию. `send()` не показывает ошибку пользователю (нет `catch`/`err` state) — при провале POST просто снимет busy в `finally`. Публичные эндпоинты `/patient/*` могут вернуть 404 — обработано graceful fallback на пустой список.
- **Строк:** 110

## `frontend/src/components/chat/PriceCalculatorDrawer.jsx`
- **Назначение:** Drawer для сотрудника: мультивыбор услуг клиники, **live-расчёт** итоговой стоимости с учётом скидки по подписке пациента, отправка карточки-quote пациенту в чат.
- **Ключевые элементы:** `export default PriceCalculatorDrawer({ open, onClose, threadId, clinicId, onSent })`. `picked` — массив `service_id`. Поиск `filtered` (по name/code, slice 200). Эффект пересчёта `quote` при изменении `picked` (debounce отсутствует — на каждое изменение POST). `send()` → отправка quote. Рендер через `createPortal`.
- **Эндпоинты (вызывает):**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/clinics/{clinicId}/services` | сотрудник | — | услуги | список для выбора |
| POST | `/clinic/chat/threads/{threadId}/price-quote` | сотрудник | `{service_ids[]}` | `{subtotal, discount_total, total, items[], subscription_plan_name, expires_in_hours}` | live-расчёт стоимости |
| POST | `/clinic/chat/threads/{threadId}/send-quote` | сотрудник | `{service_ids[]}` | — | отправить карточку quote пациенту |

- **Зависимости:** `../../api`. `react-dom` `createPortal`. React-хуки.
- **Где менять для типовых задач:** изменить вид расчётной плашки — блок `quote && (...)` (строки 184-225). Подключение drawer'а к `ClinicChatSection` делает «главный агент» (см. шапку файла) — здесь только сам компонент. Добавить ручную скидку — расширь payload `price-quote`/`send-quote` и серверный расчёт.
- **Подводные камни:** все денежные значения (`subtotal/discount_total/total`) **считаются на сервере** и приходят готовыми — фронт их только показывает (нет float-арифметики на клиенте); `Number(s.price||0)` в списке — только для отображения. Скидка по подписке пациента — серверная логика, фронт показывает `subscription_plan_name`. На каждое переключение чекбокса идёт новый POST `price-quote` (без debounce) — при быстром клике возможны лишние запросы, гонки прикрыты `cancelled`-флагом.
- **Строк:** 275

## `frontend/src/components/chat/PromoCodeButton.jsx`
- **Назначение:** Маленькая кнопка-иконка с поповером для выпуска персонального промокода в треде (процент скидки + срок действия). Возвращает код наверх через `onIssued`.
- **Ключевые элементы:** `export default PromoCodeButton({ threadId, onIssued })`. Локальный поповер `open`, поля `pct`/`days`. `issue()` → POST, при успехе `onIssued(code)` и закрытие.
- **Эндпоинты (вызывает):**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `/clinic/chat/threads/{threadId}/promo-code` | сотрудник | `{discount_type:'percent', discount_value, valid_days, max_uses:1}` | `{code, ...}` | выпустить персональный промокод |

- **Зависимости:** `../../api`. React-хук `useState`. Самый компактный файл группы.
- **Где менять для типовых задач:** добавить фиксированную скидку (₽, не %) — переключатель `discount_type` и поле; сейчас жёстко `'percent'` и `max_uses: 1`. Изменить дефолты — `useState(10)` / `useState(7)`.
- **Подводные камни:** `discount_type` и `max_uses` захардкожены (строка 15) — для других сценариев потребуется правка. Поповер позиционируется `position: absolute` от кнопки — у краёв экрана может обрезаться (не портал). Ошибка показывается строкой внутри поповера.
- **Строк:** 47

## `frontend/src/components/chat/ReassignModal.jsx`
- **Назначение:** Модал передачи треда другому сотруднику клиники с опциональной заметкой. По успеху показывает toast и вызывает `onDone` (родитель перезагружает).
- **Ключевые элементы:** `export default ReassignModal({ open, onClose, threadId, clinicId, onDone })`. Загрузка списка сотрудников с fallback. `submit()` → POST reassign + toast. Использует `useToast` из дизайн-системы.
- **Эндпоинты (вызывает):**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| GET | `/users/clinic-staff?clinic_id=` | сотрудник | query `clinic_id` | сотрудники | список для передачи |
| GET | `/doctors?clinic_id=` | сотрудник | query `clinic_id` | врачи | **fallback**, если нет clinic-staff |
| POST | `/clinic/chat/threads/{threadId}/reassign` | сотрудник | `{to_user_id, note?}` | — | передать тред сотруднику |

- **Зависимости:** `../../api`, `../../design` (`useToast`). По комментарию использует тот же fallback, что `AssignDoctorModal`.
- **Где менять для типовых задач:** ограничить выбор сотрудников по роли — отфильтруй `users` после загрузки или поменяй эндпоинт `/users/clinic-staff`. Сделать заметку обязательной — добавь проверку в `submit`. Текст toast'ов — строки 41/45.
- **Подводные камни:** `useToast()` обёрнут в `|| {}` и вызывается опционально (`toast?.()`) — безопасно, если провайдера тостов нет. Дубль-паттерн загрузки сотрудников с `AssignDoctorModal` (fallback `clinic-staff → doctors`) — кандидат на вынос в общий хук. `note` шлётся как `undefined` если пусто (не пустая строка).
- **Строк:** 98

## `frontend/src/components/chat/SlotBookedBubble.jsx`
- **Назначение:** Системный бабл-подтверждение «✅ Запись подтверждена» (врач + дата/время) — финальная карточка в цепочке слот-букинга. Рендерится `MessageBubble` для `message_type === 'slot_booked'`.
- **Ключевые элементы:** `export default SlotBookedBubble({ message })`. Читает `message.payload` (`appointment_id, doctor_name, service_name, start_at, duration_min`). Форматирует `start_at` в ru-RU. Чистый презентационный компонент на Tailwind.
- **Эндпоинты:** нет.
- **Зависимости:** ничего не импортирует. Вызывается из `MessageBubble` (диспетчер по `message_type`).
- **Где менять для типовых задач:** показать услугу/длительность — добавь рендер `p.service_name`/`p.duration_min` (сейчас приходят в payload, но не выводятся). Стиль — Tailwind-классы `bg-green-50 ...`.
- **Подводные камни:** `service_name`/`duration_min` есть в payload, но **не отображаются** — частичная реализация. Зависит от структуры `payload` с бэка `chat_slots`.
- **Строк:** 25

## `frontend/src/components/chat/SlotOfferBubble.jsx`
- **Назначение:** Интерактивная карточка предложенных клиникой слотов в чате **пациента**. Пациент кликает слот → бронирование. Учитывает состояния expired/superseded/занятый слот.
- **Ключевые элементы:** `export default SlotOfferBubble({ message, isPatient, threadId, onBooked })`. `offer = message.payload`, `slots = offer.slots`. Состояния: `expired` (TTL/`slot_expired`), `superseded` (`offer.booked_slot_idx`). `handleClick(slotIdx)` → `chatSlotsApi.bookSlot`; обработка кодов 409 (занят) / 410 (неактуально). `formatSlotLabel` (ru-RU).
- **Эндпоинты (вызывает):**

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|-------|------|-------------|-----------|------------|------------|
| POST | `chatSlotsApi.bookSlot(threadId, message.id, slotIdx)` | пациент | id треда, id сообщения, индекс слота | результат брони | забронировать выбранный слот |

- **Зависимости:** `../../api/chatSlots` (`bookSlot`). React `useState`. Рендерится из `MessageBubble`; парный отправитель — `ClinicSlotPicker`. После брони родитель показывает `SlotBookedBubble`.
- **Где менять для типовых задач:** изменить тексты состояний — строки 53-57. Добавить отмену брони — новый метод в `chatSlotsApi` и кнопка. Кликабельность только при `isPatient` — условие в `handleClick` (строка 35) и `disabled` (строка 61).
- **Подводные камни:** кнопки кликабельны только если `isPatient` (в чате клиники бабл read-only). Коды ошибок завязаны на бэк: **409 = слот занят, 410 = оффер протух** — менять синхронно с сервером. `offer.status` (`expired`/`superseded`) приходит с бэка; `booked_slot_idx` помечает выбранный слот зелёным.
- **Строк:** 85

## `frontend/src/components/chat/SlotRequestBubble.jsx`
- **Назначение:** Бабл «📅 Пациент просит запись» в чате **клиники**: показывает желаемые даты и комментарий пациента, и (для сотрудника) кнопку «Предложить слоты», которая открывает `ClinicSlotPicker`, преднастроенный из запроса.
- **Ключевые элементы:** `export default SlotRequestBubble({ message, isStaff, onOfferRequest })`. Читает `message.payload` (`preferred_dates`, `note`, doctor/service). Форматирует даты ru-RU. Кнопка вызывает `onOfferRequest(req)`.
- **Эндпоинты:** нет напрямую — действие делегируется наверх через `onOfferRequest` (родитель открывает `ClinicSlotPicker`).
- **Зависимости:** ничего не импортирует. Рендерится из `MessageBubble`; парный отправитель — `PatientSlotRequestPicker`; результат действия — `ClinicSlotPicker`.
- **Где менять для типовых задач:** показать выбранного врача/услугу из запроса — добавь рендер `req.doctor_id`/`req.service_id` (в payload есть, но не выводятся, нужны имена). Текст/стиль кнопки — строки 22-27.
- **Подводные камни:** кнопка «Предложить слоты» видна только сотруднику (`isStaff`). `onOfferRequest(req)` передаёт сырой payload — родитель маппит его в `defaults` для `ClinicSlotPicker`. Связка трёх компонентов (запрос → предложение → подтверждение) держится на согласованной структуре `payload` бэка `chat_slots`.
- **Строк:** 33

---

### Карта связей слот-букинга (важно для навигации)
Полный цикл записи через чат состоит из 5 компонентов этой группы:
1. Пациент: `PatientSlotRequestPicker` → POST `slot_request` → бабл `SlotRequestBubble` (у клиники).
2. Клиника жмёт «Предложить слоты» → открывается `ClinicSlotPicker` (преднастроенный) → POST `slot_offer` → бабл `SlotOfferBubble` (у пациента).
3. Пациент кликает слот в `SlotOfferBubble` → `bookSlot` → системный `SlotBookedBubble`.
Все три бабла диспетчеризуются в `MessageBubble` по `message_type`. API-обёртка — `frontend/src/api/chatSlots.js`.
