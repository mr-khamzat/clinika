# sections [09] — Расписание врачей + модуль SMS-маркетинга (фронтенд-секции)

Группа из 6 React-секций фронтенда МИС «КлиникСеть». Одна секция (`WeekScheduleSection`) — премиум-календарь записей врачей, используется тремя ролями (врач / менеджер / админ-супервайзер-медсестра). Остальные пять — целиком модуль **SMS-маркетинга** (`sms_marketing`, платная подписка 1 990 ₽/мес): wrapper с табами и четыре подсекции (Кампании, Шаблоны, История, Аналитика).

Все файлы — **фронтенд**, никаких backend-роутеров здесь нет: эндпоинты вызываются через axios-инстанс `../../api`. Tenant-изоляция и проверка подписки (`require_module("sms_marketing")` → HTTP 402) выполняются на бэкенде; фронт лишь ловит 402 и показывает CTA «Подключить модуль». Общий паттерн SMS-секций: локальный хелпер `apiFetch(method, url, _token, data)` — обёртка над `api({...})`, где третий аргумент `token` игнорируется (легаси-сигнатура).

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `scheduling/WeekScheduleSection.jsx` | Премиум-календарь записей врача, неделя/день, drag-and-drop | 908 |
| `sms/SmsMarketingSection.jsx` | Wrapper с табами над 4 SMS-секциями | 60 |
| `sms/SmsCampaignsSection.jsx` | Список кампаний + 4-шаговый wizard рассылки | 778 |
| `sms/SmsTemplatesSection.jsx` | CRUD SMS-шаблонов, live-preview, счётчик сегментов | 404 |
| `sms/SmsHistorySection.jsx` | Глобальная история отправок, фильтры, CSV-экспорт | 308 |
| `sms/SmsAnalyticsSection.jsx` | KPI и графики доставки SMS | 263 |

---

## `frontend/src/sections/scheduling/WeekScheduleSection.jsx`

- **Назначение:** Премиум-расписание врачей в стиле design-preview-2. Один компонент обслуживает врача (`mode='self'` — свой календарь) и управленцев (`mode='full'` — выбор любого врача + полное редактирование: запись/перенос/отмена/статусы). Поддерживает телемед-приёмы.
- **Ключевые элементы:**
  - `export default function WeekScheduleSection({ token, mode, selfDoctorId, selfDoctorName })` — главный компонент. `canEdit = mode === 'full'`.
  - Внутренние компоненты: `Header` (выбор врача, неделя, view-toggle, кнопка «+Запись»), `WeekGrid` (десктоп CSS-grid сетка часы×дни с drag-and-drop), `DayList` (мобильный список одного дня с чипами дней), `BookModal` (создание записи + чекбокс телемеда), `ApptModal` (легаси-модалка статуса/переноса записи на 14 дней вперёд).
  - Helpers: `ymd(d)`, `startOfWeek(d)` (понедельник как начало), `addDays(d,n)`, `isMobile()` (matchMedia ≤767px).
  - Константы: `DAY_SHORT`, `STATUS_INFO` (5 статусов: pending/confirmed/completed/cancelled/no_show — цвета фона/бордера/чипа), `PRIORITY_HIGH_BG/BORDER` (золотая подсветка приоритетных).
  - Lazy-импорт `TelemedRoomModal`; открывается через глобальное событие `window` `'open-telemed-room'`.
- **Эндпоинты:** не роутер. Потребляемые backend-эндпоинты:
  - `GET /doctors` — список врачей тенанта (только `mode='full'`).
  - `GET /doctors/{id}/week?start_date=YYYY-MM-DD` — слоты+записи на неделю (структура `{ days[], doctor_name, slot_duration }`).
  - `POST /appointments` — создать запись.
  - `PATCH /appointments/{id}` — перенос (`appointment_date`, `start_time`).
  - `PATCH /appointments/{id}/status` — `confirmed/cancelled/completed/no_show`.
  - `POST /telemed/sessions` — создать телемед-сессию по `appointment_id` (если ещё нет).
- **Зависимости:** `../../api`; из `../../design` — `Card, KpiRow, KpiCard, Button, Tabs, Chip, Modal, QuickActions, buildPatientCardActions`; `../../components/telemed/TelemedRoomModal` (lazy); `../../components/scheduling/AppointmentDetailsModal` (карточка приёма — заключение/файлы/направления/история). Клик по записи открывает `AppointmentDetailsModal` (новая карточка), а `ApptModal` — старый путь статус/перенос, оставлен как legacy.
- **Где менять для типовых задач:**
  - Новый статус записи или его цвет → `STATUS_INFO` (строки 36-42) + кнопки действий в `ApptModal` (строки 877-903).
  - Поля формы создания записи → `BookModal` (строки 658-729), payload собирается в `onCreate` (строки 172-210).
  - Логика приоритета/срочности (золотая/красная подсветка) → `WeekGrid` строки 478-528.
  - Сетка часов (диапазон рабочего дня) → `useMemo hoursAxis` (строки 142-156).
  - KPI недели (слотов/занято/свободно/загрузка) → `useMemo kpi` (строки 159-167) + `KpiRow` рендер 286-305.
  - Телемед-флоу (кнопка «Начать телемед-приём») → `ApptModal` строки 791-824.
  - Мобильная навигация по дням → `DayList` (строки 563-655).
- **Подводные камни:**
  - **Race-condition** при `mode='full'`: до возврата `GET /doctors` `doctorId=''`, `onCreate` явно бросает «Сначала выберите врача» (строки 173-176), иначе backend вернёт 422.
  - **FastAPI 422 detail-массив**: `onCreate` (строки 202-208) разворачивает массив объектов `detail` в строку, иначе пользователь видел `[object Object]` (баг #23).
  - **Телемед-маркер дублируется в `notes`**: флаг `is_telemed` отправляется и нативным полем, и текстом `[ТЕЛЕМЕД]` в `notes` (строки 192-196) — backend без миграции тоже распознаёт через regex `/телемед|telemed/i`.
  - `WeekGrid` и `DayList` — **намеренно НЕ мигрированы** на дизайн-систему (TODO #29): кастомный CSS-grid с `display:contents`, drag-and-drop, тач-чипы. При рефакторинге не ломать drag-drop перенос (`onDragStart`/`onDrop`/`onDropMove`).
  - QR-печать в `ApptModal` (строки 772-785) открывает `window.open` с inline-HTML; имя пациента санитизируется `replace(/[<>&"']/g, '')` — это единственная XSS-защита, не убирать.
  - Tenant_id-фильтрация — целиком на бэкенде; фронт доверяет, что `/doctors` и `/appointments` уже scoped по тенанту из токена.
- **Строк:** 908

---

## `frontend/src/sections/sms/SmsMarketingSection.jsx`

- **Назначение:** Корневой wrapper модуля SMS-маркетинга. Рисует заголовок, описание и `Tabs`, переключающие 4 подсекции. Сам не делает запросов — вся загрузка и обработка 402 внутри подсекций.
- **Ключевые элементы:** `export default function SmsMarketingSection({ token })`; локальный стейт `tab` (по умолчанию `'campaigns'`); массив `tabs` (campaigns/templates/history/analytics). Прокидывает `token` во все подсекции.
- **Эндпоинты:** нет — делегирует подсекциям.
- **Зависимости:** `Tabs` из `../../design`; `./SmsCampaignsSection`, `./SmsTemplatesSection`, `./SmsHistorySection`, `./SmsAnalyticsSection`.
- **Где менять для типовых задач:**
  - Добавить новую вкладку SMS-модуля → массив `tabs` (строки 25-30) + условный рендер (строки 52-55) + создать новую секцию-компонент.
  - Сменить вкладку по умолчанию → `useState('campaigns')` строка 23.
- **Подводные камни:** табы немонтируемые при переключении (условный рендер `&&`) — каждая подсекция перезагружает данные при возврате. Никакого кэша между табами нет. Если нужна история между вкладками — поднимать стейт сюда.
- **Строк:** 60

---

## `frontend/src/sections/sms/SmsCampaignsSection.jsx`

- **Назначение:** Список SMS-кампаний (таблица с прогресс-баром и статусом) + модальный **4-шаговый wizard** создания рассылки (Шаблон → Аудитория → Расписание → Подтверждение) + экран деталей кампании с авто-обновляемым логом сообщений.
- **Ключевые элементы:**
  - `export default function SmsCampaignsSection({ token })` — список + кнопка «Создать кампанию», обработка 402 (CTA с ссылкой `../admin/modules_catalog`).
  - `CampaignWizard({ token, onClose, onCreated })` — wizard. Ключевые функции: `buildCampaignPayload()` (сборка payload из формы), `doPreview()` (создаёт draft → `POST /preview`), `launch()` (использует `draftId` из preview либо создаёт заново → `POST /launch`), `canNext` (валидация шага), `Stepper`.
  - `CampaignDetails({ token, campaignId, onBack })` — деталка: прогресс-бар + лог сообщений с фильтром по статусу, авто-`setInterval(load, 5000)`.
  - `SummaryRow` — строка summary на шаге 4.
  - Константы: `STATUS_BADGES` (draft/scheduled/sending/sent/failed/cancelled), `AUDIENCES` (5 типов аудитории), `fmtDt`.
- **Эндпоинты:** не роутер. Потребляемые:
  - `GET /sms/campaigns` — список (и деталка фильтрует из него: бэкенд может не иметь `GET /sms/campaigns/{id}`).
  - `POST /sms/campaigns` — создать draft.
  - `POST /sms/campaigns/{id}/preview` → `{ total_recipients, sample_phones[] }`.
  - `POST /sms/campaigns/{id}/launch` — запуск.
  - `POST /sms/campaigns/{id}/cancel` — отмена (только status scheduled/sending).
  - `GET /sms/campaigns/{id}/messages?status=` — лог.
  - `GET /sms/templates` — для выбора шаблона в wizard.
- **Зависимости:** `../../api`; `useToast` из `../../design`. Шаблоны в wizard фильтруются `t.is_active !== false`.
- **Где менять для типовых задач:**
  - Новый тип аудитории → массив `AUDIENCES` (строки 33-39) + ветки сборки в `buildCampaignPayload` (строки 244-255) + UI-блок в шаге 2.
  - Новый статус кампании / его бейдж → `STATUS_BADGES` (строки 24-31).
  - Изменить payload кампании (новые поля, повтор, расписание) → `buildCampaignPayload` (строки 231-263).
  - Поля шага «Расписание» (datetime / повтор) → шаг 3 (строки 519-559).
  - Логика «когда можно жать Далее» → `canNext` (строки 305-319).
  - Частота авто-обновления лога деталей → `setInterval(load, 5000)` строка 654.
- **Подводные камни:**
  - **Preview создаёт реальный draft в БД**: каждый клик «Предпросмотр» делает `POST /sms/campaigns` (строки 267-283). Многократный preview плодит черновики — `launch` переиспользует только последний `previewData.draftId`. Возможны висящие draft-кампании, если юзер закрыл wizard после preview.
  - **`CampaignDetails` грузит весь список** `/sms/campaigns` и ищет `.find(x => x.id === campaignId)` (строки 640-642) — нет dedicated endpoint; на больших списках это N-кратная загрузка каждые 5 сек.
  - Тоасты ловят и `e.response.data.detail`, и `e.message` (двойной fallback) — корректно для FastAPI и JS-ошибок.
  - `custom_phones` парсятся построчно `split(/\r?\n/)` (строка 253) — без валидации формата +7; ответственность на бэкенде.
  - `template_id` приводится `Number(templateId)` (строка 242) — пустая строка станет `null`.
  - Tenant-изоляция полностью на бэкенде; 402 = подписка не оплачена.
- **Строк:** 778

---

## `frontend/src/sections/sms/SmsTemplatesSection.jsx`

- **Назначение:** CRUD SMS-шаблонов с live-preview (подстановка demo-значений), подсчётом длины и числа SMS-сегментов (с учётом кодировки), popover вставки переменных и toggle активности (soft-delete).
- **Ключевые элементы:**
  - `export default function SmsTemplatesSection({ token })` — таблица шаблонов + модальная форма создания/редактирования.
  - Функции: `load`, `openCreate`, `openEdit`, `insertVar(tag)`, `submit` (POST/PATCH), `onDelete` (soft-delete с confirm), `toggleActive` (PATCH `is_active`).
  - Утилиты: `detectEncoding(text)` (кириллица→ucs2, иначе gsm7), `smsSegments(text)` (70/67 для UCS-2, 160/153 для GSM-7), `renderPreview(body)` (подстановка demo), `usedVariables(body)` (какие теги использованы).
  - Константы: `VARIABLES` (5 тегов: `{{patient_name}}`, `{{date}}`, `{{clinic}}`, `{{phone}}`, `{{discount}}` с demo-значениями), `EMPTY_FORM`.
- **Эндпоинты:** не роутер. Потребляемые:
  - `GET /sms/templates` — список.
  - `POST /sms/templates` — создать.
  - `PATCH /sms/templates/{id}` — обновить / toggle `is_active`.
  - `DELETE /sms/templates/{id}` — soft-delete.
- **Зависимости:** `../../api`; `useToast` из `../../design`.
- **Где менять для типовых задач:**
  - Новая переменная-плейсхолдер шаблона → массив `VARIABLES` (строки 23-29). Она автоматически попадёт в popover, preview и `usedVariables`. **Важно:** demo-значение обязательно, иначе preview покажет пустоту.
  - Правила длины/кодировки SMS → `detectEncoding` и `smsSegments` (строки 36-53).
  - Поля формы шаблона → `EMPTY_FORM` (строка 31) + модал (строки 293-360).
- **Подводные камни:**
  - Подстановка в `renderPreview` через `split(tag).join(demo)` (строка 60) — без экранирования, но это plain-text preview, не HTML.
  - `detectEncoding` определяет кириллицу regex `/[А-яЁё]/` — диапазон `А-я` НЕ покрывает `ё/Ё` без явного добавления (оно добавлено отдельно) и захватывает технические символы между `я` и `ё` в Unicode; для production-точности сегментов это приближение, не точный GSM-7 расчёт.
  - Удаление — soft (бэкенд помечает неактивным/удалённым); список после `onDelete` перезагружается через `load()`.
  - Wizard кампаний (`SmsCampaignsSection`) грузит эти же `/sms/templates` и фильтрует `is_active !== false` — если шаблон на паузе, он не появится в выборе кампании.
- **Строк:** 404

---

## `frontend/src/sections/sms/SmsHistorySection.jsx`

- **Назначение:** Глобальная история отправок SMS по всем кампаниям. Так как нет единого `GET /sms/messages`, секция **агрегирует сообщения всех кампаний на клиенте** (до 30 последних), фильтрует (кампания/статус/телефон/даты) и экспортирует выборку в CSV.
- **Ключевые элементы:**
  - `export default function SmsHistorySection({ token })`.
  - `loadCampaigns` (список для фильтра-селекта), `loadMessages` (агрегация: либо одна кампания, либо `Promise.allSettled` по 30 кампаниям + сортировка по `sent_at` desc).
  - `filtered` (useMemo — локальная фильтрация по `phone` includes и диапазону дат), `totals` (useMemo — KPI: total/sent/delivered/failed/deliveryPct), `exportCsv` (Blob + BOM `﻿` для Excel).
  - Утилиты: `fmt(s)` (ru-локаль дата-время), `toCsv(rows)` (8 колонок, экранирование `"` → `""`).
  - `KpiCell` — карточка KPI.
  - Константы: `STATUS_LABEL`, `STATUS_COLOR`.
- **Эндпоинты:** не роутер. Потребляемые:
  - `GET /sms/campaigns` — список кампаний.
  - `GET /sms/campaigns/{id}/messages?status=` — сообщения (по каждой кампании).
- **Зависимости:** `../../api`; `useToast` из `../../design`.
- **Где менять для типовых задач:**
  - Новые колонки CSV → `toCsv` head (строка 43) + строка данных (строки 47-57).
  - Новые фильтры → блок Filters (строки 188-228) + логика в `filtered` (строки 125-139) или `loadMessages` (серверный `status`).
  - Лимит агрегируемых кампаний → `.slice(0, 30)` строка 97; лимит строк таблицы — `.slice(0, 500)` строка 270.
  - KPI-метрики → `totals` (строки 141-156).
- **Подводные камни:**
  - **Клиентская агрегация — узкое место**: до 30 параллельных `GET .../messages` через `Promise.allSettled`. Комментарий в шапке прямо помечает: для большой базы заменить на единый эндпоинт. При росте числа кампаний/сообщений UI деградирует.
  - Фильтры phone/dates — **локальные** (по уже загруженным данным), а status — **серверный** (в query). Поэтому смена status триггерит перезагрузку (в deps `loadMessages`), а phone/date — нет.
  - `deliveryPct` считает `delivered / sent` где `sent` = sent+delivered; деление защищено `sent ? ... : 0`.
  - CSV-ключ строки `${m._campaign_id}_${m.id}` — id сообщений уникальны только в рамках кампании, поэтому составной ключ обязателен (строка 271).
  - `loadMessages` зависит от `campaigns` в deps — пока `loadCampaigns` не вернулся, агрегация по пустому списку даст пустую историю (потом перезапустится).
- **Строк:** 308

---

## `frontend/src/sections/sms/SmsAnalyticsSection.jsx`

- **Назначение:** Дашборд аналитики SMS: KPI (кампаний / сообщений / % доставки / % открытий), bar-график отправок за 30 дней, топ-3 шаблона и топ-5 кампаний по delivery rate. Считает метрики на клиенте из messages последних 20 кампаний.
- **Ключевые элементы:**
  - `export default function SmsAnalyticsSection({ token })`.
  - Один `useEffect` загрузки: `GET /sms/campaigns` → берёт первые 20 → `Promise.allSettled` по `.../messages`, обогащает каждое сообщение `_campaign_id/_template_id/_template_name`.
  - useMemo-блоки: `kpi` (счётчики по статусам/`opened_at`), `chartData` (30 дневных бакетов + max для высоты столбцов), `topTemplates` (группировка по template, delivery %, top-3), `topCampaigns` (группировка по campaign, top-5).
  - `Kpi` — карточка KPI (с tone emerald/cyan).
- **Эндпоинты:** не роутер. Потребляемые:
  - `GET /sms/campaigns`.
  - `GET /sms/campaigns/{id}/messages` (первые 20 кампаний).
- **Зависимости:** `../../api`. (Не использует design-систему — собственная вёрстка на Tailwind.)
- **Где менять для типовых задач:**
  - Новый KPI → блок `kpi` useMemo (строки 67-81) + карточки `Kpi` (строки 163-168).
  - Изменить окно графика (30 дней) → цикл бакетов в `chartData` (строки 87-91).
  - Размер топов → `.slice(0, 3)` (топ-шаблоны, строка 118) и `.slice(0, 5)` (топ-кампании, строка 138).
  - Лимит кампаний для аналитики → `cs.slice(0, 20)` строка 42.
- **Подводные камни:**
  - **`cancelled`-флаг есть** (`let cancelled = false` + cleanup), чтобы не сетить стейт после размонтирования при гонке запросов — не удалять при рефакторинге (строки 33, 39, 45, 64).
  - Метрики считаются **по клиентским messages**, а не по counters кампании — если бэкенд начнёт отдавать `sent_count/delivered_count` в summary, расчёт лучше переключить на них (комментарий в шапке упоминает оба источника).
  - `% открытий` зависит от `m.opened_at` — если provider не отдаёт open-tracking, метрика всегда 0.
  - Даты бакетируются через `toISOString().slice(0,10)` — это **UTC**, а не локальная дата; на границе суток столбец может «уехать» относительно отображения в Истории (там `toLocaleString`). Несогласованность TZ между секциями.
  - `delivery_pct = delivered / sent` где `sent` включает delivered (строки 78-79) — та же семантика, что в History.
- **Строк:** 263

---

### Сводка по связям модуля SMS
`SmsMarketingSection` (wrapper) → 4 подсекции. Общий контракт API — `/sms/campaigns*`, `/sms/templates*`, `/sms/campaigns/{id}/messages`. Шаблоны (`SmsTemplatesSection`) питают wizard кампаний и аналитику. История и Аналитика — **read-only клиентская агрегация** одного и того же `messages`-эндпоинта (узкое место при масштабе). Все секции единообразно ловят HTTP 402 → CTA подключения модуля `sms_marketing`.
