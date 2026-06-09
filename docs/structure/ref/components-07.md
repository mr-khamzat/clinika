# components [07] — регламенты (читатель/конструктор), выгрузка отчётов, карточка приёма и StaffChat-модалки

Это «срез 07» компонентов фронта МИС «КлиникСеть» — 15 файлов из четырёх соседних доменных папок `frontend/src/components/`:

- **`regulations/`** (4 файла) — «Регламент-конструктор» (Глава 7). Сторона **читателя**: просмотр регламента и подтверждение ознакомления с e-подписью. Сторона **редактора**: один шаг конструктора + таймлайн версий с публикацией/откатом.
- **`reports/`** (4 файла) — выгрузка отчёта по приёмам для менеджера: одна модалка-форма + три ленивых генератора файлов (PDF / Excel / CSV). Все три читают один и тот же ответ `GET /manager/reports/appointments`.
- **`scheduling/`** (1 файл) — большая «карточка приёма» с 4 вкладками + вложенная модалка переноса записи. Один из самых тяжёлых компонентов среза.
- **`staff/`** (6 файлов) — модалки и вспомогательные виджеты корпоративного мессенджера StaffChat (Slack-style): создание/настройка канала, опрос, закреплённые, глобальный поиск, @-автокомплит.

Все файлы — **чисто клиентские React-компоненты на inline-стилях** (плюс часть на Tailwind-классах + дизайн-токены `var(--...)`). Сетевой слой везде один — общий axios-инстанс `../../api`. Серверная фильтрация по `tenant_id` происходит на бэкенде; на фронте мультитенантности нет, кроме передачи `clinic_id` в параметрах. Эндпоинтов-роутеров среди файлов нет (это фронт) — поэтому ниже вместо таблиц «эндпоинтов роутера» указаны **вызываемые API** каждого компонента.

| Файл | Назначение в 5-7 слов | Строк |
|---|---|---|
| `regulations/RegulationViewer.jsx` | Просмотр регламента, рендер шагов, подтверждение | 506 |
| `regulations/SignatureModal.jsx` | Модалка подписи-ознакомления с регламентом | 224 |
| `regulations/StepEditor.jsx` | Редактор одного шага в конструкторе | 122 |
| `regulations/VersionsTimeline.jsx` | Таймлайн версий: публикация и откат | 92 |
| `reports/AppointmentsReportModal.jsx` | Форма выгрузки отчёта по приёмам | 261 |
| `reports/appointmentsReportCsv.js` | Генератор CSV-отчёта (fallback) | 70 |
| `reports/appointmentsReportExcel.js` | Генератор Excel-отчёта в три листа | 113 |
| `reports/appointmentsReportPdf.js` | Генератор PDF-отчёта с кириллицей | 211 |
| `scheduling/AppointmentDetailsModal.jsx` | Карточка приёма: 4 вкладки + перенос | 1272 |
| `staff/ChannelSettingsModal.jsx` | Переименовать/описать/удалить канал | 194 |
| `staff/CreateChannelModal.jsx` | Создание канала (открытый/закрытый) | 118 |
| `staff/CreatePollModal.jsx` | Создание опроса в чате | 246 |
| `staff/GlobalSearchBox.jsx` | Глобальный поиск по сообщениям чата | 194 |
| `staff/MentionAutocomplete.jsx` | Автокомплит @-упоминаний | 106 |
| `staff/PinnedMessagesModal.jsx` | Список закреплённых сообщений комнаты | 78 |

---

## `frontend/src/components/regulations/RegulationViewer.jsx`
- **Назначение:** Премиум-просмотр одного регламента со стороны читателя (сотрудника). Грузит `GET /regulations/{id}`, рисует заголовок/версию/описание и интерактивные шаги, внизу — кнопка «Подтвердить ознакомление» (открывает `SignatureModal`) либо плашка «Подтверждено».
- **Ключевые элементы:**
  - Дефолтный экспорт `RegulationViewer({ regulationId, onBack, user })`.
  - Внутренние под-рендеры шагов: `StepText`, `StepCheckbox`, `StepAction`, `StepFile` (каждый — отдельный мелкий компонент, не экспортируется).
  - Хелперы `fmtDate`, `fmtDateLong`; словарь `CATEGORY_LABELS` (general/hr/finance/medical/reception/safety/it/service/legal).
  - Локальный state чекбоксов `checkboxesState` (`{ cb_<idx>: bool }`), `useMemo` `requiredCheckboxes` для проверки в модалке подписи.
- **Вызываемые API:**

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/regulations/{regulationId}` | Загрузка регламента + `current_version.content`, `already_completed`, `completed_at` |

- **Зависимости:** `../../api`; дизайн-система `../../design` (`Card`, `Button`, `Chip`, `EmptyState`, `useToast`); локальный `./SignatureModal`. Material Symbols через CSS-класс `material-symbols-outlined`.
- **Где менять для типовых задач:**
  - Новый **тип шага** регламента — добавить под-компонент по образцу `StepAction`/`StepFile` и зарегистрировать его в `content.map(...)` (строки ~408-440) рядом с проверкой `!['text','checkbox','action','file'].includes(type)`.
  - Новая **категория** регламента — словарь `CATEGORY_LABELS` (строки 35-45). Должен совпадать с категориями редактора/бэкенда.
  - Логика **файловых шагов** (`type:'file'`) — `StepFile`: сейчас открывает только `url`, ветка `file_id` — заглушка (см. подводные камни).
- **Подводные камни:**
  - `StepFile` для шагов только с `file_id` (без `url`) — **заглушка**: кнопка disabled, файл-стораджа ещё нет (`// file storage реализация ниже по дорожной карте`). Если backend начнёт отдавать `file_id` — здесь надо дописать скачивание.
  - Формат `content` свободный: каждый под-рендер подстраховывается через `step?.content || step?.text || step?.label`. При смене схемы content на бэке проверять все 4 рендера.
  - `checkboxesState` сбрасывается при каждой перезагрузке (`load()` → `setCheckboxesState({})`); после успешного complete вызывается `load()`, что подтянет `already_completed`.
- **Строк:** 506

---

## `frontend/src/components/regulations/SignatureModal.jsx`
- **Назначение:** Модалка подтверждения ознакомления с регламентом. Требует ввод ФИО (≥3 символа), проверяет, что все обязательные чекбоксы отмечены, и шлёт `POST /regulations/{id}/complete`. Подпись фиксируется в журнале сотрудника.
- **Ключевые элементы:**
  - Дефолтный экспорт `SignatureModal({ open, onClose, regulationId, regulationTitle, checkboxesState, requiredCheckboxes, onComplete, defaultFullName })`.
  - `useMemo` `missingChecks` — список незакрытых обязательных пунктов (показывается красным блоком, до 5 + «и ещё N»).
  - Флаги-гейты: `signatureOk` (≥3 симв.), `allChecksOk`, `canSubmit`.
- **Вызываемые API:**

| Метод | Путь | Принимает | Назначение |
|---|---|---|---|
| POST | `/regulations/{regulationId}/complete` | `{ signature_text, checkboxes_state }` | Зафиксировать ознакомление с e-подписью |

- **Зависимости:** `../../api`; `../../design` (`Modal`, `Button`, `useToast`). Получает `checkboxesState`/`requiredCheckboxes`/`defaultFullName` от `RegulationViewer`.
- **Где менять для типовых задач:**
  - **Минимальная длина ФИО** — константа в `signatureOk = trimmed.length >= 3` (строка 59).
  - Изменить **текст обязательства / юридическую формулировку** — блок строк 128-145 и нижняя приписка 217-220.
  - Поведение при **повторном подтверждении** — обработка `status === 409` в `catch` (строки 78-82): это НЕ ошибка, тихо обновляем статус и закрываем.
- **Подводные камни:**
  - `useToast()` деструктурируется как `{ toast }`, но вызывается через optional chaining `toast?.(...)`. В других файлах среза (`AppointmentsReportModal`) `useToast()` используется как объект с методами `.error/.success` — **формы хука различаются между файлами**, не копировать вслепую.
  - При `open` поле ФИО переинициализируется из `defaultFullName` (effect строки 46-51) — ручной ввод теряется при повторном открытии.
- **Строк:** 224

---

## `frontend/src/components/regulations/StepEditor.jsx`
- **Назначение:** Редактор одного шага регламента в конструкторе (`RegulationBuilderSection`). Textarea с auto-resize, переключатель «обязательный», смена типа шага inline, drag-n-drop ручка и кнопки «вверх/вниз/удалить».
- **Ключевые элементы:**
  - Дефолтный экспорт `StepEditor({ step, index, onChange, onDelete, onMoveUp, onMoveDown, isFirst, isLast, dragHandlers })`.
  - `TYPE_META` — иконки/подписи 4 типов (text/checkbox/action/file); `placeholderByType` — плейсхолдеры textarea.
  - `useEffect` авто-высота textarea (max 320px) по `step.content`.
  - `onChange` принимает **частичный patch** (`{ content }`, `{ required }`, `{ type }`) — родитель мержит.
- **Зависимости:** только `react` (`useEffect`, `useRef`). Стилизуется **внешними CSS-классами** `reg-step`, `reg-textarea`, `reg-select`, `reg-icon-btn`, `reg-step-handle/body/controls` (определены не здесь — в CSS родительской секции).
- **Где менять для типовых задач:**
  - Новый **тип шага** — добавить ключ в `TYPE_META` (строки 16-21), `placeholderByType` (45-50) и `<option>` в `<select>` (строки 99-102). Параллельно завести рендер в `RegulationViewer` (см. выше).
  - Лимит **высоты textarea** — `Math.min(el.scrollHeight, 320)` (строка 42).
- **Подводные камни:**
  - Цвета частично **захардкожены** (`#9ca3af`, `#6b7280`) вместо токенов `var(--fg-*)` — расходится с премиум-перетемизацией остальных файлов. При смене темы эти подписи не подхватят цвет.
  - Drag-n-drop полностью делегирован родителю через `dragHandlers` — сам компонент состояние перетаскивания не держит (кроме визуального класса `reg-drag-over` по `dragHandlers.isDragOver`).
- **Строк:** 122

---

## `frontend/src/components/regulations/VersionsTimeline.jsx`
- **Назначение:** Вертикальный таймлайн версий регламента. По каждой версии: номер, дата публикации (или «черновик»), changelog, кнопки «Просмотр / Опубликовать (для draft) / Откатиться».
- **Ключевые элементы:**
  - Дефолтный экспорт `VersionsTimeline({ versions, currentVersionId, onPreview, onPublish, onRollback })`.
  - Хелпер `fmtDate` (ru-RU dateStyle short + timeStyle short).
  - Сортировка по убыванию `version_number`; флаги `isDraft` (нет `published_at`), `isCurrent` (`v.id === currentVersionId`).
  - Условный показ кнопок: «Опубликовать» — только для draft; «Откатиться» — только для опубликованных не-текущих.
- **Зависимости:** только `react` (фактически без импортов хуков — чистая функция-рендер). Все действия — через колбэки родителя. CSS-классы `reg-timeline`, `reg-tl-item`, `reg-tl-num`, `reg-chip`, `reg-tool-btn`, `reg-ai` (внешние).
- **Где менять для типовых задач:**
  - Изменить **видимость кнопок** (например, дать откат текущей версии) — условия строк 68-85.
  - **Откат** (`onRollback`) по контракту создаёт новую draft на базе старой версии — сама логика на бэке/в родителе, здесь только кнопка.
- **Подводные камни:**
  - Захардкоженные цвета (`#9ca3af`, `#4b5563`) — как и в `StepEditor`, не на токенах.
  - Сортировка делает копию `[...versions]` — мутации исходного массива нет, ок.
- **Строк:** 92

---

## `frontend/src/components/reports/AppointmentsReportModal.jsx`
- **Назначение:** Модалка-форма выгрузки отчёта по приёмам для менеджера. Открывается из `ManagerAppointments`. Поля: период, врач, клиника, статус, формат (PDF/Excel/CSV). Показывает живое превью KPI (debounce 400ms) и по кнопке «Скачать» **лениво** импортирует нужный генератор файла.
- **Ключевые элементы:**
  - Дефолтный экспорт `AppointmentsReportModal({ open, onClose })`.
  - Хелперы дат `isoDate`, `startOfMonth`, `todayIso`; словари `STATUS_OPTIONS`, `FORMAT_OPTIONS`.
  - `queryParams` (`useMemo`) — собирает `{ from_date, to_date, doctor_id?, clinic_id?, status? }`.
  - `handleDownload` (`useCallback`) — ядро: переиспользует свежий `preview` либо догружает данные, затем `await import('./appointmentsReportPdf'|'Excel'|'Csv')`.
- **Вызываемые API:**

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/doctors` | Справочник врачей в `<select>` |
| GET | `/manager/clinics/` | Справочник клиник в `<select>` |
| GET | `/manager/reports/appointments` | Превью KPI и данные для файла (`{ appointments, total, total_revenue, kpi }`) |

- **Зависимости:** `../../api`; `../../design` (`Modal`, `Button`, `KpiRow`, `KpiCard`, `useToast`); ленивые `./appointmentsReportPdf`, `./appointmentsReportExcel`, `./appointmentsReportCsv`.
- **Где менять для типовых задач:**
  - Новая **колонка/поле фильтра** — добавить state + поле в grid формы (строки 187-231) и проброс в `queryParams` (строки 82-88); параллельно учесть в трёх генераторах.
  - **Новый формат файла** — добавить в `FORMAT_OPTIONS` + ветку в `handleDownload` (строки 130-139) с новым ленивым импортом.
  - Текст про **лимиты** (6 мес / 5000 записей) — строка 257 (это UI-подсказка, реальный лимит — на бэке).
- **Подводные камни:**
  - **`useToast()` здесь — объект с методами** `.error/.warn/.success` (строка 55), причём `.warn`/`.success` вызываются защитно (`toast.warn ? ... : ...`). В `SignatureModal`/`ChannelSettingsModal` тот же хук используется иначе (`{ toast }` + `toast(msg, type)`). **Не унифицировано** — сверяйся с реализацией `useToast` в `../../design`.
  - Тяжёлые либы (`jspdf` ~870КБ, `xlsx` ~330КБ) сознательно **вынесены из основного бандла** через динамический `import()` — не превращать в статические импорты.
  - `statusVal` — одиночное значение (multi-select упрощён до одного), хотя бэк, вероятно, принимает список.
  - Денежные значения берутся как `Number(...)` и форматируются `toLocaleString('ru-RU')` — на фронте float; точность сумм держится на бэкенде (Decimal).
- **Строк:** 261

---

## `frontend/src/components/reports/appointmentsReportCsv.js`
- **Назначение:** Простой fallback-генератор CSV (разделитель `;`, BOM для Excel, CRLF). Формирует blob и инициирует скачивание `appointments_<from>_<to>.csv`.
- **Ключевые элементы:**
  - Именованный экспорт `generateAppointmentsCSV(data, meta)`.
  - Словари `STATUS_LABEL`, `PAYMENT_LABEL`; хелперы `formatDateRu`, `escCsv` (экранирование `;`, `"`, переводов строк).
  - 11 колонок: Дата, Время, Врач, Специальность, Клиника, Пациент, Телефон, Статус, Цена, Оплата, Заметки.
- **Зависимости:** нет внешних импортов (чистый JS + DOM `Blob`/`URL`/`<a>`).
- **Где менять для типовых задач:**
  - **Колонки CSV** — массив `headers` (строки 37-40) + соответствующий массив значений в цикле (строки 42-55), порядок должен совпадать.
  - **Маппинг статусов/оплат** — словари `STATUS_LABEL` (9-15), `PAYMENT_LABEL` (17-21). Эти же словари продублированы в Excel- и PDF-генераторах.
- **Подводные камни:**
  - **Дубль словарей** `STATUS_LABEL`/`PAYMENT_LABEL`/`formatDateRu` в трёх файлах reports — при добавлении статуса править во всех трёх (csv/excel/pdf).
  - `data.appointments` ожидается массивом; если null — цикл `for (const a of data.appointments || [])` подстрахован.
- **Строк:** 70

---

## `frontend/src/components/reports/appointmentsReportExcel.js`
- **Назначение:** Генератор Excel-отчёта (через `xlsx`) на три листа: «Приёмы» (все записи, auto-filter + freeze header), «KPI» (сводка + по статусам), «По врачам» (топ-10). Скачивает `appointments_<from>_<to>.xlsx`.
- **Ключевые элементы:**
  - Именованный async-экспорт `generateAppointmentsExcel(data, meta)`.
  - Сборка через `XLSX.utils.aoa_to_sheet` + `book_append_sheet`; настройка `!autofilter`, `!freeze`, `!cols` (ширины колонок).
  - Дублирующиеся `STATUS_LABEL`, `PAYMENT_LABEL`, `formatDateRu` (как в CSV).
- **Зависимости:** `xlsx` (статический импорт `import * as XLSX from 'xlsx'`). Вызывается **только лениво** из `AppointmentsReportModal.handleDownload` через `await import(...)` — поэтому в основной бандл не попадает.
- **Где менять для типовых задач:**
  - Колонки листа «Приёмы» — `apptHeaders` (42-45) + `apptRows` (46-58) + ширины `!cols` (67-70).
  - Состав листа **KPI** — массив `kpiRows` (75-88).
  - Лист **«По врачам»** питается из `data.kpi.top_doctors` (`doctor_name`, `specialty`, `count`, `revenue`).
- **Подводные камни:**
  - `async` объявлен, но `await` внутри нет (`XLSX.writeFile` синхронный) — формально лишний, не баг.
  - `!freeze` не входит в публичный API стандартного `xlsx` (community-build часто игнорирует) — freeze header может не сработать в зависимости от версии либы.
  - Тот же риск **рассинхрона словарей** с csv/pdf.
- **Строк:** 113

---

## `frontend/src/components/reports/appointmentsReportPdf.js`
- **Назначение:** Генератор красивого PDF (jspdf + jspdf-autotable): брендовая шапка, 4 KPI-карточки, таблица записей **с группировкой по дням** и итогами по дню, подвал с пагинацией. Поддержка кириллицы через TTF-шрифт Roboto.
- **Ключевые элементы:**
  - Именованный async-экспорт `generateAppointmentsPDF(data, meta)`.
  - Загрузка шрифтов: `_fetchFontBase64`, `_ensureCyrillicFonts` (с модульным кэшем `_fontCache`), `_registerFonts`. Шрифты тянутся из `/fonts/Roboto-Regular.ttf` и `/fonts/Roboto-Bold.ttf`.
  - Хелперы `formatDateRu`, `formatRub`; дубль `STATUS_LABEL`/`PAYMENT_LABEL` (здесь сокращённые лейблы: «Подтв.», «Заверш.»).
  - Группировка `groups[a.date]`, заголовки групп `colSpan:8`, строка итога по дню.
- **Зависимости:** `jspdf`, `jspdf-autotable` (статические импорты, но файл грузится лениво). Требует наличия TTF-файлов в `public/fonts/`.
- **Где менять для типовых задач:**
  - **Фирменный цвет/шапка** — `doc.setFillColor(15,110,95)` (brand teal, строки 96, 183) и заголовок строки 100.
  - **Колонки таблицы** — `head` (строка 139) + сборка `body` в цикле (151-169) + `columnStyles` (190-194).
  - **KPI-карточки** — массив `kpiData` (109-114) и отрисовка `forEach` (118-128).
- **Подводные камни:**
  - Если **шрифты не загрузились** — `catch` падает на `helvetica` (строки 87-90), и кириллица в PDF превратится в «кракозябры». Перед релизом проверять, что `public/fonts/Roboto-*.ttf` задеплоены.
  - `for (const a of data.appointments)` **без `|| []`** (строка 132) — в отличие от CSV; если `appointments` будет null/undefined, упадёт. Вызывающий код в модалке заранее проверяет непустой массив, но прямой вызов генератора этого не гарантирует.
  - Денежные суммы складываются на фронте (`s + (a.price || 0)`) — float-арифметика; первичная сумма — с бэка.
- **Строк:** 211

---

## `frontend/src/components/scheduling/AppointmentDetailsModal.jsx`
- **Назначение:** Большая «Карточка приёма», открывается из расписания при клике на занятый слот. Тоглы статуса/приоритета + 4 вкладки (Заключение, Файлы, Направления, История) + менеджерские действия (Перенести/Удалить) + вложенная модалка переноса. Самый объёмный файл среза (1272 строки, несколько компонентов в одном модуле).
- **Ключевые элементы (всё в одном файле):**
  - Дефолтный экспорт `AppointmentDetailsModal({ ctx, onClose, onChanged })` (`ctx = { appointment, date, start_time }`).
  - Вложенные компоненты: `MoveAppointmentModal`, `OutcomeTab`, `AttachmentsTab` (+ `FilePreview`), `ReferralsTab` (+ `CreateReferralForm`), `HistoryTab`.
  - Константы: `MANAGER_LIKE_ROLES` (`manager`/`franchise_owner`/`super_admin`), `TARGET_TYPES` (виды направлений), словари чипов `STATUS_CHIP`/`REF_STATUS_CHIP`, `STATUSES`, `PRIORITIES`, `REF_CANCELLABLE`.
  - Хелперы `formatDate`, `formatBytes`.
  - `canManage` = роль пользователя ∈ `MANAGER_LIKE_ROLES`.
- **Вызываемые API:**

| Метод | Путь | Принимает | Назначение |
|---|---|---|---|
| PATCH | `/appointments/{id}/status` | `{ status }` | Сменить статус приёма (тоглы) |
| PATCH | `/appointments/{id}` | `{ priority }` / `{ appointment_date, start_time, doctor_id }` | Сменить приоритет / перенести запись |
| DELETE | `/appointments/{id}` | — | Мягкое удаление (cancelled), логируется в аудит |
| GET/POST | `/appointments/{id}/outcome` | `{ conclusion, recommendations }` | Заключение врача |
| GET/POST/DELETE | `/appointments/{id}/attachments[/{id}]` | multipart `file` | Вложения приёма |
| GET/POST | `/appointments/{id}/referrals` | `{ target_type, target_doctor_id?, target_service?, notes?, scheduled_date?, scheduled_time? }` | Внутриклинические направления |
| POST | `/referrals/{id}/cancel-request` | `{ reason }` | Запрос отмены направления (на подтверждение руководителю) |
| GET | `/doctors`, `/doctors/{id}/week?start_date=` | — | Список врачей и недельные слоты для переноса/направления |
| GET | `/patients/{phone}/history` | — | История приёмов пациента по телефону |

- **Зависимости:** `../../api`; `../../design` (`Modal`, `Button`, `Tabs`, `Chip`, `Avatar`); `../../store/auth` (`useAuthStore` → текущий `user`/`role`). Открывается из `WeekScheduleSection` (расписание).
- **Где менять для типовых задач:**
  - **Кто видит Перенести/Удалить** — `MANAGER_LIKE_ROLES` (строка 23). Бэк дублирует проверку (`require_manager`).
  - Новая **вкладка** — пункт в `Tabs.items` (строки 160-167) + новый под-компонент + строка рендера `{tab === '...' && <... />}` (244-247).
  - Новый **тип направления** — `TARGET_TYPES` (строки 26-33); влияет и на форму создания, и на отображение списка.
  - Ограничения **загрузки файлов** (типы/размер) — `accept` инпута + текст подсказки (строки 679-688) — реальный лимит на бэке.
  - Какие направления **можно отменять** — `REF_CANCELLABLE` (строка 830).
- **Подводные камни:**
  - **Ранний `return null` при отсутствии `apptId`** (строка 93) идёт ПОСЛЕ нескольких `useState`/`useStore` — но ДО любых условных хуков, так что правило хуков соблюдено; добавляя хуки, держать их выше этого `return`.
  - Статус хранится дважды: локальный `localStatus` (оптимистично) и серверный — после `changeStatus` локальный апдейтится только при успехе.
  - `MoveAppointmentModal` парсит свободные слоты из недельного эндпоинта, фильтруя `!s.appointment && !s.is_busy` — структура слота (`start_time` vs `time`) подстрахована в нескольких местах; при смене формата `/doctors/{id}/week` проверять оба места (`MoveAppointmentModal` и `CreateReferralForm`).
  - `HistoryTab` грузит историю **по телефону** (`/patients/{phone}/history`), а не по patient_id — если телефона нет, вкладка пустая.
  - Удаление — **мягкое** (статус cancelled), не физическое; комментарий в коде явно это поясняет.
  - Перенос/удаление вызывают `onChanged()` и закрывают модалку, т.к. дата/врач могли измениться — родитель обязан перезагрузить расписание.
- **Строк:** 1272

---

## `frontend/src/components/staff/ChannelSettingsModal.jsx`
- **Назначение:** Модалка настроек канала StaffChat: переименовать, изменить описание, удалить (с подтверждением). Используется в `StaffChat.jsx`.
- **Ключевые элементы:**
  - Дефолтный экспорт `ChannelSettingsModal({ open, room, canEdit, onClose, onUpdated, onDeleted })`.
  - State: `name`, `description`, `busy`, `confirmDelete` (двухшаговое подтверждение удаления).
  - Функции `save` (PATCH) и `remove` (DELETE).
  - Если `!canEdit` — показывает информер «только админ канала или менеджер».
- **Вызываемые API:**

| Метод | Путь | Принимает | Назначение |
|---|---|---|---|
| PATCH | `/staff-chat/channels/{room.id}` | `{ name, description }` | Обновить название/описание |
| DELETE | `/staff-chat/channels/{room.id}` | — | Удалить канал со всеми сообщениями |

- **Зависимости:** `../../api`; `../../design` (`useToast`). Собственная разметка модалки (НЕ использует `Modal` из дизайн-системы) — fixed-оверлей на Tailwind + inline-стилях.
- **Где менять для типовых задач:**
  - Право редактирования — приходит как prop `canEdit` извне (родитель решает `iAmAdmin || isManagerPlus`); сам компонент роли не проверяет.
  - Метка типа канала — тернарник строки 95 (`channel`→«открытый», `group`→«закрытый»).
- **Подводные камни:**
  - `useToast()` обёрнут `|| {}` и вызывается `toast?.(msg, type)` — форма как в `SignatureModal`/`CreateChannelModal`, но НЕ как в `AppointmentsReportModal`.
  - Не использует общий `Modal` (как `CreatePollModal`, `PinnedMessagesModal`, `CreateChannelModal`) — **в StaffChat сложилась своя «ручная» модалка**, отдельная от дизайн-системы. При редизайне учитывать это расхождение.
  - Захардкоженный бренд-градиент `linear-gradient(135deg, #0097A7, #0A2342)` повторяется во всех staff-модалках.
- **Строк:** 194

---

## `frontend/src/components/staff/CreateChannelModal.jsx`
- **Назначение:** Модалка создания канала StaffChat (Slack-style): название, описание, тип «открытый» (`channel`) / «закрытый» (`group`).
- **Ключевые элементы:**
  - Дефолтный экспорт `CreateChannelModal({ open, onClose, onCreated, clinicId })`.
  - State `name`, `type` (default `channel`), `description`, `busy`; функция `submit`.
- **Вызываемые API:**

| Метод | Путь | Принимает | Назначение |
|---|---|---|---|
| POST | `/staff-chat/channels` | `{ name, type, clinic_id, description }` | Создать канал в текущей клинике |

- **Зависимости:** `../../api`; `../../design` (`useToast`). Ручная модалка (без `Modal`).
- **Где менять для типовых задач:**
  - Добавить **тип канала** — пара кнопок-табов (строки 76-97) + значение в `submit.type`.
  - Привязка к клинике — `clinic_id: clinicId || null` (строка 24): передаётся пропом извне.
- **Подводные камни:**
  - `useToast()` распаковывается через `toastCtx?.toast` (строки 8-9) — третий вариант доступа к тосту в этом срезе.
  - Тот же захардкоженный градиент и inline-стили токенов с fallback-литералами (`var(--bg, #fff)`).
- **Строк:** 118

---

## `frontend/src/components/staff/CreatePollModal.jsx`
- **Назначение:** Модалка создания опроса в StaffChat: вопрос, 2-10 вариантов, флаг multi-select, опциональная дата закрытия.
- **Ключевые элементы:**
  - Дефолтный экспорт `CreatePollModal({ open, roomId, onClose, onCreated })`.
  - State: `question`, `options` (массив строк, min 2 / max 10), `multiSelect`, `closesAt`, `busy`, `error`.
  - Хелперы вариантов: `addOption`, `removeOption`, `updateOption`; гейт `canSubmit()` (вопрос ≥2 симв. и ≥2 непустых варианта).
- **Вызываемые API:**

| Метод | Путь | Принимает | Назначение |
|---|---|---|---|
| POST | `/staff-chat/polls` | `{ room_id, question, options:[{label}], multi_select, closes_at? }` | Создать опрос в комнате |

- **Зависимости:** только `../../api` (без дизайн-системы и тостов — ошибки показываются inline-блоком). Ручная модалка на чистых inline-стилях.
- **Где менять для типовых задач:**
  - Лимиты вариантов — `options.length >= 10` (addOption) и `<= 2` (removeOption).
  - Преобразование `closesAt` (`datetime-local`) → ISO происходит в `submit` (строки 50-54) внутри `try/catch`.
- **Подводные камни:**
  - `closes_at` отправляется только если задан; ошибка парсинга даты молча проглатывается (`catch {}`).
  - Не использует `useToast` вовсе — единственная staff-модалка с собственным inline-error вместо тоста.
- **Строк:** 246

---

## `frontend/src/components/staff/GlobalSearchBox.jsx`
- **Назначение:** Кнопка-лупа + выпадающая панель глобального поиска по StaffChat (комнаты + сообщения). Debounce 300ms, закрытие по клику снаружи / Esc, авто-фокус.
- **Ключевые элементы:**
  - Дефолтный экспорт `GlobalSearchBox({ onPick })` — `onPick(result)` зовётся при выборе результата.
  - State `open`, `query`, `results`, `loading`, `error`; refs `inputRef`, `debounceRef`, `wrapRef`.
  - Хелпер `formatShort` (сегодня → время, иначе → дата).
  - Три эффекта: debounce-поиск (≥2 симв.), click-outside, авто-фокус/reset.
- **Вызываемые API:**

| Метод | Путь | Параметры | Назначение |
|---|---|---|---|
| GET | `/staff-chat/search` | `?q=<query>` | Поиск, возвращает `{ results:[{ message_id, room_id, room_name, body_snippet, created_at, sender_name }] }` |

- **Зависимости:** только `../../api`. Использует CSS-классы `sc-icon-btn` и токены `--sc-*` (отдельное StaffChat-неймспейс-семейство токенов).
- **Где менять для типовых задач:**
  - Минимальная длина запроса — `q.length < 2` (строка 33) и подсказка строки 148.
  - Задержка debounce — `setTimeout(..., 300)` (строка 51).
  - Подсказка про **Ctrl+K** в `title` (строка 88) — но горячая клавиша здесь НЕ навешана; реальный хоткей должен висеть в родителе/StaffChat.
- **Подводные камни:**
  - Toggle-логика open/close на одной кнопке + click-outside через `mousedown` — при добавлении вложенных кликов оборачивать в `stopPropagation` (уже сделано для панели).
  - Использует префикс токенов `--sc-*` (StaffChat-локальные), а не общие `--fg/--bg` — отдельная тема.
- **Строк:** 194

---

## `frontend/src/components/staff/MentionAutocomplete.jsx`
- **Назначение:** Выпадающий автокомплит @-упоминаний (Slack/Discord-style) над полем ввода. Управляется родителем через prop `query` (string = показан/фильтр, `null` = скрыт). Навигация стрелками, выбор Enter/Tab, закрытие Esc.
- **Ключевые элементы:**
  - Дефолтный экспорт `MentionAutocomplete({ query, onPick, onClose })`.
  - State `users`, `active` (индекс подсветки).
  - Эффект загрузки + **толерантный парсер ответа**: принимает массив, `{items}`, `{users}` или `{groups:[{users}]}`, плюс клиентский дофильтр по `username`/`full_name`/`name`.
  - Эффект клавиатуры (capture-phase `keydown`, true).
- **Вызываемые API:**

| Метод | Путь | Параметры | Назначение |
|---|---|---|---|
| GET | `/staff-chat/contacts` | `?q=&limit=8` | Список контактов для подстановки упоминания |

- **Зависимости:** только `../../api`. Позиционируется абсолютно над полем ввода (родитель должен дать `position:relative`).
- **Где менять для типовых задач:**
  - Лимит показываемых пользователей — `limit: 8` в запросе и `list.slice(0, 8)` (строка 35).
  - Поля для отображения/фильтра — функция-фильтр (строки 28-34) и рендер `@{u.username || u.full_name || u.name}` (строка 97).
- **Подводные камни:**
  - Слушатель клавиатуры — **глобальный** `window.addEventListener('keydown', ..., true)` в capture-фазе. Перехватывает Enter/Tab/стрелки на всём окне, пока открыт. При нескольких автокомплитах одновременно возможны конфликты — гарантировать единственность открытого экземпляра.
  - Парсер ответа намеренно «всеядный» — это легаси-страховка под нестабильный контракт `/staff-chat/contacts`. Если контракт зафиксируют, парсер можно упростить.
- **Строк:** 106

---

## `frontend/src/components/staff/PinnedMessagesModal.jsx`
- **Назначение:** Простая модалка со списком закреплённых сообщений комнаты StaffChat. Грузит при открытии, показывает текст + дату закрепления.
- **Ключевые элементы:**
  - Дефолтный экспорт `PinnedMessagesModal({ open, onClose, roomId })`.
  - State `items`, `loading`; один эффект-загрузчик.
- **Вызываемые API:**

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/staff-chat/rooms/{roomId}/pinned` | Список закреплённых сообщений (`r.data.messages`) |

- **Зависимости:** только `../../api`. Ручная модалка (без `Modal`).
- **Где менять для типовых задач:**
  - Поля сообщения в карточке — рендер `items.map` (строки 57-73): сейчас `m.body` и `m.pinned_at`. Чтобы добавить автора/кнопку «открепить» — здесь.
- **Подводные камни:**
  - Только **просмотр**: открепить/перейти к сообщению нельзя (нет колбэка перехода) — самый «тонкий» компонент StaffChat-среза, кандидат на доработку.
  - Ответ ожидается как `{ messages: [...] }`; при пустом/ошибке — `setItems([])`.
- **Строк:** 78

---

### Сквозные наблюдения по срезу
1. **StaffChat-модалки живут отдельно от дизайн-системы.** `ChannelSettingsModal`, `CreateChannelModal`, `CreatePollModal`, `PinnedMessagesModal` — все на «ручных» fixed-оверлеях с захардкоженным брендовым градиентом `#0097A7→#0A2342` и собственными `--sc-*`/литеральными fallback-цветами. Regulations- и reports-компоненты, наоборот, на общих `Modal`/`Button`/`Chip`. Это два разных UI-стека в одном срезе.
2. **`useToast()` используется в трёх несовместимых формах** — `{ toast }` + `toast(msg,type)` (Signature, ChannelSettings), `toastCtx?.toast` (CreateChannel), объект-с-методами `.error/.warn/.success` (AppointmentsReportModal). Перед копированием паттерна свериться с реализацией хука в `../../design`.
3. **Дубль словарей в reports** (`STATUS_LABEL`/`PAYMENT_LABEL`/`formatDateRu` × 3 файла) — изменение статуса/способа оплаты требует правки во всех трёх генераторах (csv/excel/pdf).
4. **Тяжёлые либы выгрузки лениво подгружаются** (`jspdf`, `xlsx` через `await import()` в `AppointmentsReportModal`) — критично для размера бандла, не делать статическими. PDF дополнительно зависит от наличия `public/fonts/Roboto-*.ttf` (иначе кириллица ломается).
5. **`AppointmentDetailsModal` — мега-файл (1272 стр., ~6 компонентов в одном модуле)**: статусы/направления/файлы/история + перенос. Главные риски: слоты парсятся из `/doctors/{id}/week` в двух местах, удаление мягкое (cancelled), история по телефону, доступ к менеджерским действиям по `MANAGER_LIKE_ROLES` (бэк дублирует `require_manager`).
