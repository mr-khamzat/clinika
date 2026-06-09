# components [02] — UI-компоненты кабинетов: шапка, профиль, регистратор, партнёрский прайс, агрегатор

Этот срез — 15 React-компонентов из `frontend/src/components/` (включая подпапки `admin/` и `aggregator/`). Все они — **презентационно-интерактивный слой** МИС: ничего не знают о маршрутизации напрямую (кроме `ReferralCard`), вместо этого получают данные и колбэки через props либо ходят в API через общий axios-инстанс `../api`. Тематически делятся на 5 групп:

1. **Шапка staff-кабинетов** — `NotificationsBell`, `ProfileModal`, `QuickActions`, `StatusBadge`, `SupportChat`.
2. **Кабинет регистратора (Глава 5)** — `RegCommandPalette`, `RegMobilePatientForm`, `RegQuickBar`.
3. **Реферальная программа** — `ReferralCard`.
4. **Партнёрский прайс (admin)** — `PartnerOffersAdmin`, `PartnerOffersTab`, `PartnerCategoriesTab`.
5. **Агрегаторы лидов (Глава 10)** — `PartnershipModal`, `ApiKeyDisplayModal`, `LeadCard`.

Общий стиль: inline-стили на CSS-переменных дизайн-системы (`--accent`, `--surface`, `--fg`, `--border`, `--bg-1/2`), Material Symbols (`material-symbols-outlined`), Tailwind-классы местами. Часть компонентов рендерится в кабинетах **вне `BrowserRouter`** (AdminRoot), поэтому хуки роутера там запрещены.

| Файл | Назначение в 5-7 слов | Строк |
|---|---|---|
| `NotificationsBell.jsx` | Колокольчик уведомлений в шапке кабинетов | 359 |
| `ProfileModal.jsx` | Личный кабинет сотрудника (телефон/пароль/аватар) | 439 |
| `QuickActions.jsx` | Обёртка 5 быстрых действий по карточке | 246 |
| `ReferralCard.jsx` | Карточка реферального направления пациента | 42 |
| `RegCommandPalette.jsx` | Командная палитра регистратора Ctrl+K | 315 |
| `RegMobilePatientForm.jsx` | Mobile-форма быстрой регистрации пациента | 546 |
| `RegQuickBar.jsx` | Полоса быстрых действий регистратора | 121 |
| `StatusBadge.jsx` | Бейдж статуса реферала (5 состояний) | 17 |
| `SupportChat.jsx` | Плавающий чат техподдержки с файлами | 347 |
| `admin/PartnerCategoriesTab.jsx` | Вкладка категорий партнёрского прайса | 124 |
| `admin/PartnerOffersAdmin.jsx` | Корневой экран партнёрского прайса (2 таба) | 37 |
| `admin/PartnerOffersTab.jsx` | Вкладка офферов прайса + bulk-добавление | 289 |
| `aggregator/ApiKeyDisplayModal.jsx` | Показ API-ключа партнёра один раз | 178 |
| `aggregator/LeadCard.jsx` | Карточка лида от агрегатора + статусы | 238 |
| `aggregator/PartnershipModal.jsx` | Создание/редактирование партнёрства | 223 |

---

## `frontend/src/components/NotificationsBell.jsx`

- **Назначение:** Иконка-колокольчик с бейджем непрочитанных, выпадающий список последних 10 уведомлений и настройка категорий. Подключается в шапки всех staff-кабинетов (Layout, _ManagerShell, AdminLayout, DoctorLayout).
- **Ключевые элементы:** дефолтный экспорт `NotificationsBell({ size=36, variant='square'|'round' })`; внутренние хелперы `ensureDropdownAnim()` (инжектит keyframes-стиль один раз), `relTime(iso)` (русское «5 мин назад»), `iconFor(type)`/`colorFor(type)` (маппинг типа уведомления на Material-иконку и цвет, есть ветки для legacy-типов); открывает дочернюю `NotificationPreferencesModal`.
- **Эндпоинты:** не роутер (фронт). Дёргает: `GET /notifications/recent` (items + unread), `POST /notifications/{id}/read`, `POST /notifications/read-all`. Настройки категорий — внутри `NotificationPreferencesModal` (`GET/PUT /notifications/preferences`).
- **Зависимости:** `../api` (axios-инстанс), `./NotificationPreferencesModal`. React-хуки `useState/useEffect/useRef/useCallback`.
- **Где менять для типовых задач:** новый тип уведомления и его иконка/цвет — `iconFor()`/`colorFor()` (строки 61-104); интервал опроса (сейчас 60 000 мс) — строка 146; ширина/позиция dropdown — объект стиля на строке 234; текст бейджа «99+» — строка 229.
- **Подводные камни:** `enabled = true` хардкодом (раньше зависел от SLUG — на платформе `/admin` колокольчик не работал; см. комментарий 107-110). Любая ошибка API проглатывается в `catch` → `items=[] , unread=0` (тихий fallback, без тоста). Polling каждые 60 c + перезапрос при открытии — на медленном бэке возможен лишний трафик. `markRead`/`markAllRead` оптимистично правят локальный стейт, при ошибке ничего не откатывают.
- **Строк:** 359

---

## `frontend/src/components/ProfileModal.jsx`

- **Назначение:** Модалка «Мой профиль» для любого сотрудника: правка телефона/email, смена пароля, загрузка/удаление аватара. ФИО, логин, роль, клиника — read-only (меняет только администратор).
- **Ключевые элементы:** дефолтный экспорт `ProfileModal({ open, onClose, onSaved })`; константа `ROLE_LABEL` (маппинг роли на русское название — список ролей системы); стили `inputStyle/labelStyle/hintStyle/readonlyStyle`; методы `savePersonal()`, `changePassword()`, `onPickFile()`, `deleteAvatar()`; 3 таба через `Tabs` (`personal`/`password`/`avatar`).
- **Эндпоинты:** не роутер. Дёргает `GET /profile/me`, `PATCH /profile/me` (используется и для телефона/email, и для смены пароля — payload `{current_password,new_password}`), `POST /profile/me/avatar` (multipart), `DELETE /profile/me/avatar`.
- **Зависимости:** `../api`; из `../design`: `Avatar`, `Button`, `Modal`, `Tabs`, `useToast`.
- **Где менять для типовых задач:** добавить роль в подпись — `ROLE_LABEL` (строки 26-43); новое редактируемое поле — добавить в форму таба `personal` и в diff-логику `savePersonal()` (строки 118-120); лимит размера аватара (5 МБ) — строка 173; правила пароля (мин 6 символов) — строка 144.
- **Подводные камни:** комментарий 17-19 явно предупреждает — компонент живёт **вне BrowserRouter** (AdminRoot), поэтому `useNavigate/useLocation/useParams` запрещены. `savePersonal` шлёт только изменённые поля, при пустом diff показывает «Нет изменений». `avatar_url` префиксится `api.defaults.baseURL`, если относительный (строки 215-221). `useEffect` загрузки профиля имеет `eslint-disable exhaustive-deps` (зависит только от `open`).
- **Строк:** 439

---

## `frontend/src/components/QuickActions.jsx`

- **Назначение:** Высокоуровневая обёртка (W4) над базовым `design/components/QuickActions`, собирающая до 5 быстрых действий по карточке пациента/врача/записи: Позвонить, WhatsApp, Перенести, Отменить, Печать. Поддерживает рендер «в линию» (`row`) и «меню по кнопке more_vert» (`menu`).
- **Ключевые элементы:** дефолтный экспорт `QuickActions({ context, patient, doctor, appointment, onCall, onWhatsApp, onReschedule, onCancel, onPrint, hidePrint, hideReschedule, hideCancel, size, variant, className })`; ре-экспорт `buildPatientCardActions` (для обратной совместимости старых вызовов); хелперы `pickPhone()`/`pickName()` (достают данные из props по контексту); внутренний `MenuVariant` (dropdown с click-outside).
- **Эндпоинты:** нет — действия выполняются через `phoneActions` (deep-link/печать).
- **Зависимости:** `../design/components/QuickActions` (базовый компонент + `buildPatientCardActions`), `../lib/phoneActions` (`callPhone`, `whatsappPhone`, `printVisit`).
- **Где менять для типовых задач:** добавить 6-е действие — массив `items` (строки 87-124, ставить `hidden` по условию); изменить логику печати визита — `handlePrint` (строки 70-81, формирует объект для `printVisit`); поведение скрытия кнопок call/whatsapp без телефона — флаг `hidden: !phone`; стиль меню — `MenuVariant` (строки 149-245).
- **Подводные камни:** если ни одно действие не видно — компонент возвращает `null` (строка 127). Телефон извлекается из нескольких возможных полей в `pickPhone` — при добавлении нового источника правьте обе функции. Печать доступна по умолчанию для `patient`/`appointment` даже без явного `onPrint` (fallback на `printVisit`), для `context='doctor'` печати нет, если не передан `onPrint`.
- **Строк:** 246

---

## `frontend/src/components/ReferralCard.jsx`

- **Назначение:** Карточка реферального направления в списках пациента (услуга, клиника, телефон, бонус, статус). Клик ведёт на QR-страницу направления; для активных направлений показывает кнопку «Запросить удаление».
- **Ключевые элементы:** дефолтный экспорт `ReferralCard({ referral, onCancelRequest })`; флаг `canRequestCancel` (статусы `created`/`confirmed`).
- **Эндпоинты:** нет — навигация и колбэк.
- **Зависимости:** `./StatusBadge`, `useNavigate` из `react-router-dom`.
- **Где менять для типовых задач:** статусы, при которых можно запросить отмену — массив на строке 5; маршрут перехода (`/qr/{id}`) — строка 11; отображение причины отмены — строки 23-28.
- **Подводные камни:** **использует `useNavigate`** → этот компонент должен рендериться только внутри `BrowserRouter` (в отличие от `ProfileModal`/`NotificationsBell` — не путать контексты). Tailwind-вёрстка (без CSS-переменных дизайн-системы), эмодзи в разметке. Самый «старый» по стилю компонент среза.
- **Строк:** 42

---

## `frontend/src/components/RegCommandPalette.jsx`

- **Назначение:** Командная палитра регистратора (Ctrl+K, Глава 5) — модал поверх кабинета с поиском по 6 статичным командам и живым поиском пациентов. Навигация стрелками/Enter/Esc.
- **Ключевые элементы:** дефолтный экспорт `RegCommandPalette({ open, onClose, onCommand, onSelectPatient })`; константа `STATIC_COMMANDS` (id/title/hint/icon/keywords); локальный `Icon`; debounce-поиск (220 мс), `matchedCommands` (фильтр по title+keywords), `items` (плоский список cmd+patient для управления клавиатурой), `handleKey`.
- **Эндпоинты:** не роутер. Дёргает `GET /referrals/patients/search?q=<query>&limit=8`.
- **Зависимости:** `../api` (как `apiClient`).
- **Где менять для типовых задач:** добавить команду — массив `STATIC_COMMANDS` (строки 38-45) + обработать её id в родителе через `onCommand`; задержка debounce и минимальная длина запроса (≥2) — строки 76, 89; параметры поиска (limit) — строка 83.
- **Подводные камни:** `handleKey` навешивается на `window` и пересоздаётся при каждом изменении `items`/`activeIdx` (есть `eslint-disable exhaustive-deps`). Ключ пациента — `last_referral_id || patient_phone+i` (нестабилен, если у пациента нет направлений). Поиск ничего не делает при <2 символах. Сам компонент только эмитит события — реальные действия (открытие форм) делает родительский кабинет.
- **Строк:** 315

---

## `frontend/src/components/RegMobilePatientForm.jsx`

- **Назначение:** Mobile-first 3-шаговая форма быстрой регистрации пациента (Глава 5): Контакты → Паспорт → Запись. Маска телефона +7, дата рождения тремя `select`, авто-поиск дубликатов по телефону, обязательное согласие 152-ФЗ, опциональное SMS-подтверждение.
- **Ключевые элементы:** дефолтный экспорт `RegMobilePatientForm({ open, onClose, onCreated, smsModuleEnabled=false })`; хелперы `formatPhone(raw)` (маска +7 ___ ___-__-__, нормализует 8→7), `digitsOf(s)`, локальный `Icon`; константа `MONTHS_RU`; вычисляемые `fullName`, `birthDate` (формат `YYYY-MM-DD`), `yearOptions` (100 лет); валидации `phoneValid`/`fioValid`/`birthValid`; `handleSubmit()`.
- **Эндпоинты:** не роутер. Дёргает `GET /referrals/patients/search?phone=…&limit=1` (поиск дубликата) и `POST /referrals/patients/quick-create` (payload: full_name, phone, birth_date, passport, consent_data_processing, sms_confirm, book_now).
- **Зависимости:** `../api` (как `apiClient`), `useToast` из `../design`.
- **Где менять для типовых задач:** новое поле формы — добавить state + input в нужный `step` (1/2/3) и в payload `handleSubmit` (строки 166-174); правила валидации шага 1 — `phoneValid`/`fioValid` (строки 139-140) и проверка на кнопке «Далее» (строки 508-511); задержка авто-поиска дубликата (400 мс) и порог (≥10 цифр) — строки 123, 135.
- **Подводные камни:** `birthDate` собирается из `Number(month)+1` (месяцы в `MONTHS_RU` индексируются с 0) — при правке селекта месяца легко получить off-by-one. `sms_confirm` уходит только если `smsModuleEnabled` (модуль SMS включён у клиники). При найденном дубликате форма не сохраняет — эмитит `onCreated({duplicate:true,...})` и родитель открывает существующую карточку. Согласие 152-ФЗ — жёсткий блокер сохранения (строка 163, 528). Маска возвращает пустую строку до первой цифры — `digitsOf` всегда работает по сырым цифрам.
- **Строк:** 546

---

## `frontend/src/components/RegQuickBar.jsx`

- **Назначение:** Полоса 48×48 быстрых действий в шапке `OperationalCabinet` регистратора (Глава 5): Пациент, Запись, Поиск, Печать, Ожидание, Команды. На mobile (<768px) — горизонтальный скролл без подписей.
- **Ключевые элементы:** дефолтный экспорт `RegQuickBar({ onAction, lastPrintAvailable=false })`; константа `ITEMS` (key/label/hint/icon/accent — у каждого свой акцентный цвет градиента); локальный `Icon`; адаптивный флаг `mobile` через `resize`-листенер.
- **Эндпоинты:** нет — только эмитит `onAction(key)`.
- **Зависимости:** только React (`useEffect/useState`). Material Symbols.
- **Где менять для типовых задач:** добавить кнопку — массив `ITEMS` (строки 19-26) + обработка `key` в родителе через `onAction`; кнопка «Печать» дизейблится при `lastPrintAvailable=false` (строка 65); порог mobile (768) — строки 42, 44.
- **Подводные камни:** цвета зашиты hex'ами в `ITEMS` (не CSS-переменные) — намеренно, т.к. бар стоит на цветной шапке (стили используют `oklch(1 0 0 / …)` поверх акцента). Логика действий целиком в родителе (`onAction`), сам бар stateless кроме `mobile`.
- **Строк:** 121

---

## `frontend/src/components/StatusBadge.jsx`

- **Назначение:** Маленький бейдж статуса реферального направления — 5 состояний с цветовой схемой. Используется в `ReferralCard` и списках направлений.
- **Ключевые элементы:** дефолтный экспорт `StatusBadge({ status })`; константа `statusMap` (created/confirmed/expired/cancelled/cancel_requested → label + Tailwind-класс).
- **Эндпоинты:** нет.
- **Зависимости:** нет (чистый презентационный компонент).
- **Где менять для типовых задач:** новый статус направления — добавить ключ в `statusMap` (строки 1-7); неизвестный статус рендерится как есть серым (fallback на строке 10).
- **Подводные камни:** статусы должны совпадать со строковыми значениями статусов рефералов на бэке; рассинхрон даст серый бейдж с сырым значением. Tailwind-классы с произвольными hex-цветами (`bg-[#dae5ff]`).
- **Строк:** 17

---

## `frontend/src/components/SupportChat.jsx`

- **Назначение:** Плавающий чат техподдержки v2: кнопка-пузырь снизу справа, окно диалога с polling сообщений, загрузка файлов/фото (до 20 МБ), индикатор онлайн оператора, полноэкранный просмотр изображений. Показывается только авторизованным (`token`).
- **Ключевые элементы:** дефолтный экспорт `SupportChat()`; колбэки `fetchMessages`/`fetchUnread`/`fetchStatus`, `handleSend`, `handleFile`; хелпер `fmt(iso)` (время/дата), `renderContent(m)` (рендер image/document/text-сообщения); 2 набора интервалов (фоновые unread/status и polling при открытом чате).
- **Эндпоинты:** не роутер. Дёргает `GET /support/messages`, `GET /support/unread`, `GET /support/status` (operator_online), `POST /support/send` (text), `POST /support/upload` (multipart).
- **Зависимости:** `../api`, `useAuthStore` из `../store/auth` (берёт `token`), `useToast` из `../design`.
- **Где менять для типовых задач:** интервалы опроса (unread 30 c, status 60 c, messages 8 c) — строки 57-58, 67-68; лимит размера файла (20 МБ) — строка 102; принимаемые типы файлов — `accept` на строке 272; рендер нового типа вложения — `renderContent` (строки 132-168).
- **Подводные камни:** **БАГ во вёрстке** — на строке 240 inline-стиль фона сообщения пользователя записан как строка внутри className (`'text-white rounded-br-sm' + " style='background:...'"`), а не как реальный атрибут `style` → фон-градиент пользовательского пузыря не применяется (мёртвый код в классе). Все `catch {}` пустые — ошибки чтения молча проглатываются. `handleSend` оптимистично чистит поле и восстанавливает текст при ошибке. Polling работает только при `open && token`.
- **Строк:** 347

---

## `frontend/src/components/admin/PartnerCategoriesTab.jsx`

- **Назначение:** Вкладка «Категории» партнёрского прайса (внутри `PartnerOffersAdmin`): список категорий клиники-владельца, добавление, переключение активности, удаление. При удалении категории связанные офферы остаются (на бэке `category_id` обнуляется).
- **Ключевые элементы:** дефолтный экспорт `PartnerCategoriesTab()`; методы `load()`, `add()`, `toggle(cat)`, `remove(id)`.
- **Эндпоинты:** не роутер сам по себе; через `partnerCategoriesApi` (`../../api/partnerOffers`) дёргает:

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/clinics/me/partner-categories` | менеджер-владелец (tenant) | — | массив категорий | список |
| POST | `/clinics/me/partner-categories` | менеджер-владелец | `{name}` | категория | создать |
| PATCH | `/clinics/me/partner-categories/{id}` | менеджер-владелец | `{is_active}` | категория | переключить активность |
| DELETE | `/clinics/me/partner-categories/{id}` | менеджер-владелец | — | — | удалить (офферы остаются) |

- **Зависимости:** `partnerCategoriesApi` из `../../api/partnerOffers` (axios-обёртка на общий `../api`, baseURL `/<slug>/api`).
- **Где менять для типовых задач:** новое поле категории — править input (строки 67-73) и payload в `add()` (строка 36); текст подтверждения удаления — строка 55.
- **Подводные камни:** все эндпоинты `/clinics/me/...` — **tenant-scoped** на бэке (видны только категории своей клиники). Удаление через `window.confirm` (синхронный браузерный диалог). Ошибки выводятся в локальный `error`-баннер, без тостов.
- **Строк:** 124

---

## `frontend/src/components/admin/PartnerOffersAdmin.jsx`

- **Назначение:** Корневой экран «Партнёрский прайс» с двумя вкладками — «Услуги в прайсе» (`PartnerOffersTab`) и «Категории» (`PartnerCategoriesTab`). Только переключатель табов, без своей логики данных.
- **Ключевые элементы:** дефолтный экспорт `PartnerOffersAdmin()`; локальный state `tab` (`offers`/`cats`).
- **Эндпоинты:** нет (делегирует дочерним вкладкам).
- **Зависимости:** `./PartnerCategoriesTab`, `./PartnerOffersTab`.
- **Где менять для типовых задач:** добавить третью вкладку — кнопка в шапке (строки 19-32) + условный рендер на строке 33; заголовок экрана — строка 18.
- **Подводные камни:** регистрация маршрута и пункта меню для этого экрана — НЕ здесь (комментарий 7: делалась отдельной задачей/агентом). Чистый контейнер, без API.
- **Строк:** 37

---

## `frontend/src/components/admin/PartnerOffersTab.jsx`

- **Назначение:** Вкладка «Услуги в прайсе»: таблица офферов клиники-владельца с inline-редактированием категории / `price_override` / `payout_amount` / активности, и модалка `BulkAddOfferModal` для массового добавления услуг из каталога МИС.
- **Ключевые элементы:** дефолтный экспорт `PartnerOffersTab()` (load офферов+категорий параллельно, `updateOffer`, `removeOffer`); вложенный компонент `BulkAddOfferModal({ cats, onClose, onAdded })` (поиск по каталогу МИС с debounce 300 мс, мультивыбор через `Set`, общая выплата+категория для всех выбранных).
- **Эндпоинты:** через `partnerOffersApi`/`partnerCategoriesApi` и прямой `api`:

| Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
|---|---|---|---|---|---|
| GET | `/clinics/me/partner-offers?include_inactive=true` | менеджер-владелец (tenant) | — | массив офферов | свой прайс (с неактивными) |
| POST | `/clinics/me/partner-offers` | менеджер-владелец | `{service_ids[], payout_amount, category_id}` | результат | массовое добавление |
| PATCH | `/clinics/me/partner-offers/{id}` | менеджер-владелец | `{category_id\|price_override\|payout_amount\|is_active}` | оффер | inline-правка |
| DELETE | `/clinics/me/partner-offers/{id}` | менеджер-владелец | — | — | удалить оффер |
| GET | `/manager/services/?search=` | менеджер (tenant) | — | массив услуг МИС | каталог для bulk-добавления |

- **Зависимости:** `partnerOffersApi`, `partnerCategoriesApi` из `../../api/partnerOffers`; прямой `api` из `../../api` (для `/manager/services/`).
- **Где менять для типовых задач:** новая редактируемая колонка оффера — добавить `<th>`+`<td>` в таблицу (строки 74-156) и поле в payload `updateOffer`; источник каталога bulk-модалки — строка 184 (`/manager/services/`); порог сабмита bulk (нужны selected + payout) — строка 202.
- **Подводные камни:** **денежные поля.** `price_override`/`payout_amount` правятся `onBlur` через `Number(value)` (float) — потенциальный риск float-неточности; перед записью сравнивается с текущим значением, чтобы не слать лишний PATCH. `payout_amount` при `NaN` пропускается. `/manager/services/` возвращает массив напрямую (учтён fallback на `r.data.items`). Все `/clinics/me/...` tenant-scoped. Цена услуги в bulk-списке — `s.price ?? s.original_price` (поля каталога МИС). После любого изменения делается полный `load()` (без оптимистичных обновлений — простой, но «тяжёлый» по запросам).
- **Строк:** 289

---

## `frontend/src/components/aggregator/ApiKeyDisplayModal.jsx`

- **Назначение:** Модалка показа сгенерированного API-ключа партнёрства РОВНО ОДИН РАЗ (Глава 10). После закрытия ключ недоступен (на бэке хранится только хеш). Кнопка копирования, счётчик «открыто N сек назад», обязательный чекбокс подтверждения перед закрытием.
- **Ключевые элементы:** дефолтный экспорт `ApiKeyDisplayModal({ open, apiKey, partnerName, onClose })`; методы `copy()` (Clipboard API + визуальный feedback), `tryClose()` (блокирует закрытие без подтверждения); счётчик `counter` (инкремент раз в секунду).
- **Эндпоинты:** нет — только отображает `apiKey`, полученный родителем из ответа POST `/admin/aggregator/partnerships`.
- **Зависимости:** из `../../design`: `Modal`, `Button`, `useToast`.
- **Где менять для типовых задач:** текст предупреждения / дизайн — блоки 70-148; правило обязательного подтверждения — `tryClose()` (строки 50-56) и `disabled={!confirmed}` на кнопке (строка 170); `hideCloseButton` у Modal (строка 66) — иначе можно было бы закрыть мимо чекбокса.
- **Подводные камни:** `toast` здесь вызывается в **объектной форме** `toast({ kind, text })` — отличается от `ProfileModal`/`SupportChat`, где `toast(text, type)`. Это два разных контракта `useToast`; при копировании кода между компонентами легко перепутать сигнатуру. Возвращает `null` если `!open || !apiKey`. Счётчик — чисто визуальный, ключ не «сгорает» по таймеру (сгорает по факту закрытия).
- **Строк:** 178

---

## `frontend/src/components/aggregator/LeadCard.jsx`

- **Назначение:** Карточка лида от партнёра-агрегатора (DocDoc/ПроДокторов/Yandex Health и т.д.) в `AdminAggregatorSection` (Глава 10). Показывает данные заявки и кнопки перевода по воркфлоу статусов: received → contacted → scheduled → completed | lost. На «Завершить» открывается inline-форма ввода комиссии.
- **Ключевые элементы:** дефолтный экспорт `LeadCard({ lead, onAction, busy })`; константа `STATUS_META` (label/color/bg по статусу); хелперы `fmtDate`, `fmtMoney`; вложенные компоненты `Info` (иконка+label+value), `ActionButton` (цветная кнопка по `tone`).
- **Эндпоинты:** нет напрямую — все переходы статуса эмитятся через `onAction({ id, status, appointment_id?, commission_amount? })`, запрос делает родитель.
- **Зависимости:** только React (`useState`). CSS-переменные дизайн-системы + hex-палитры статусов.
- **Где менять для типовых задач:** новый статус лида — `STATUS_META` (строки 21-27) + кнопки перехода в блоке действий (строки 103-139); ввод комиссии — форма завершения (строки 143-184); цвета кнопок — `ActionButton.palette` (строки 214-219).
- **Подводные камни:** `commission_amount` вводится как `Number(commission)` (float) и уходит в `onAction` — на бэке деньги, следить за Decimal-конвертацией. Статусы `completed`/`lost` считаются закрытыми (`isClosed`) → блок действий скрывается. `busy` блокирует все кнопки во время родительского запроса. `fmtMoney(0)` возвращает `null` (комиссия 0 не показывается).
- **Строк:** 238

---

## `frontend/src/components/aggregator/PartnershipModal.jsx`

- **Назначение:** Модалка создания/редактирования партнёрства-агрегатора (Глава 10). При создании POST возвращает plaintext `api_key`, который пробрасывается наверх через `onSaved(r.data)` и показывается в `ApiKeyDisplayModal`. При редактировании меняются только комиссия и статус (имя партнёра зашито в ключе и неизменяемо).
- **Ключевые элементы:** дефолтный экспорт `PartnershipModal({ open, initial, onClose, onSaved })`; константы `PARTNER_PRESETS` (docdoc/prodoctorov/yandex_health/sberhealth/other) и `EMPTY` (дефолтная форма); вложенный `Field` (label+hint); `submit()` с валидацией (имя обязательно, комиссия 0–100%).
- **Эндпоинты:** не роутер. Дёргает `POST /admin/aggregator/partnerships` (создать; возвращает `api_key`) и `PATCH /admin/aggregator/partnerships/{id}` (обновить `commission_pct`, `status`).
- **Зависимости:** `../../api`; из `../../design`: `useToast`, `Modal`, `Button`.
- **Где менять для типовых задач:** добавить пресет агрегатора — `PARTNER_PRESETS` (строки 25-31, должно совпадать с бэк-роутером admin_aggregator); диапазон/шаг ползунка комиссии — строки 168-184 (ползунок max=50, числовое поле max=100 — рассинхрон!); статусы редактирования — select (строки 191-200).
- **Подводные камни:** `toast` в объектной форме `toast({ kind, text })` (как в `ApiKeyDisplayModal`, не как в Profile/Support). При редактировании `partner_name` не отправляется (зашит в ключе). Ползунок комиссии ограничен 50%, а числовое поле — 100% (несогласованные max); валидация при сабмите всё равно 0–100. `onSaved(null)` для edit, `onSaved(r.data)` для create — родитель различает по наличию `api_key`. Логика «пресет vs custom» в `useEffect` маппит существующее имя обратно в select либо в «Другой».
- **Строк:** 223

---

### Сводка по перекрёстным рискам

- **Два контракта `useToast`** в одном срезе: `toast(text, type)` (Profile/Support) vs `toast({kind,text})` (ApiKeyDisplayModal/PartnershipModal). При копипасте — частый источник «молчащих» тостов.
- **Контекст роутера:** `ReferralCard` требует `BrowserRouter` (`useNavigate`); `ProfileModal`/`NotificationsBell` намеренно его НЕ используют (рендерятся в AdminRoot вне роутера).
- **Деньги как float:** `PartnerOffersTab` (`price_override`/`payout_amount`), `LeadCard` (`commission_amount`), `PartnershipModal` (`commission_pct`) шлют `Number(...)` — на бэке это Decimal-поля.
- **tenant-scope:** все `/clinics/me/...` (партнёрский прайс) и `/manager/services/` изолированы по клинике на бэке — фронт не передаёт tenant явно, полагается на токен/slug в baseURL.
