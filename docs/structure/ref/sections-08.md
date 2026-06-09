# sections [08] — LTV-аналитика, сводка сети, кабинет пациента, платежи/чеки, доска слотов

Этот срез — 15 React-секций фронтенда МИС «КлиникСеть» (`frontend/src/sections/`). Это не «глупые» компоненты, а **самодостаточные экраны** (каждый — `export default function`), которые монтируются в кабинеты (`PatientCabinet`, `ManagerAppointments`, `Manager`/`FranchiseOwner`-панели, `ARC`/`network`-дэшборды). Объединяет их паттерн: внутри каждого живёт собственная загрузка данных (`useEffect` + `axios`/`api`), локальный `loading/error`-стейт и весь рендер вместе с вложенными подкомпонентами в одном файле. Бэкенд-эндпоинты вызываются напрямую, без отдельного data-слоя.

Две группы используют **два разных HTTP-стиля**, и это критично понимать перед правкой:

- **Админ/менеджер-секции** (`ltv`, `payments`, `scheduling`) импортируют общий инстанс `import api from '../../api'` — он сам подставляет `Authorization: Bearer <token>` из localStorage и заголовок `X-Tenant-Slug`. Токен в пропсах (`token`) в них де-факто **не используется** для запросов — он передаётся, но запрос идёт через интерсептор. Tenant-изоляция обеспечивается бэкендом по slug + JWT.
- **Пациентские секции** (`patient/*`) и `NetworkDashboard` ходят **голым `axios`** (или `fetch`) и авторизуются не JWT, а **session_token** пациента, который передаётся в query (`?t=<token>` и/или `?session_token=<token>`). Это короткоживущий пациентский токен из localStorage-ключа `clinika_patient_session`.

Многие секции — это «pro-модули», которые могут быть не подключены к тенанту: бэкенд отвечает `402 Payment Required` (нет подписки на модуль) или `403`, и секция либо показывает окно «подключить модуль», либо тихо скрывается.

## Таблица-оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `ltv/LtvAnalyticsSection.jsx` | LTV-аналитика пациентов, экспорт PDF/Excel/контактов | 781 |
| `network/NetworkDashboard.jsx` | Сводная панель сети клиник + ЛК-пациенты | 439 |
| `patient/AppointmentsTab.jsx` | Записи пациента: перенос, отмена, детали | 411 |
| `patient/DocumentsTab.jsx` | Документы пациента: справки, выписки, скачивание | 176 |
| `patient/MedCardTab.jsx` | Медкарта: хронология, диагнозы, аллергии, прививки | 290 |
| `patient/PatientAiWidget.jsx` | Плавающий AI-чат пациента с эскалацией | 276 |
| `patient/PatientLabDynamics.jsx` | Динамика анализов, SVG-графики с нормой | 447 |
| `patient/PatientMedicalRecord.jsx` | Единая агрегированная медкарта + PDF | 420 |
| `patient/PrescriptionsTab.jsx` | Назначения из МИС и кэша | 145 |
| `patient/VitalsTab.jsx` | Витальные показатели + Apple Health | 391 |
| `payments/FiscalSettingsSection.jsx` | Настройка ОФД (54-ФЗ) по провайдерам | 305 |
| `payments/PaymentSettingsSection.jsx` | Настройка интернет-эквайринга по шлюзам | 338 |
| `payments/PaymentsListSection.jsx` | Список онлайн-платежей + возврат | 161 |
| `payments/ReceiptsListSection.jsx` | Список фискальных чеков + QR ФНС | 114 |
| `scheduling/SlotBoardSection.jsx` | Доска слотов: врачи слева, сетка справа | 1205 |

---

## `frontend/src/sections/ltv/LtvAnalyticsSection.jsx`

- **Назначение:** Экран LTV-аналитики (модуль `ltv_pro`): топ-пациенты по пожизненной ценности, когорты по кварталу первого визита, сводные KPI. Считает всё бэкенд, фронт только рисует и экспортирует (PDF/Excel/CSV-контакты).
- **Ключевые элементы:**
  - `default LtvAnalyticsSection({ adminToken, clinicId })` — главный компонент; 3 таба (`summary`/`patients`/`cohorts`).
  - Подкомпоненты: `ConnectModulePrompt` (окно на 402), `SummaryView`, `Metric`, `PatientsTable`, `CohortsTable`, `ContactsMenuItem`.
  - Хелперы: `fmtRub`/`fmtRubOrDash` (NetLTV=0 → «—»), `fmtNum`, `fmtPct`, `fmtDate`, `daysAgoColor`, `yearsLabelRu` (склонение «лет/года/год»), `authH`.
  - Константы: `RISK_LABEL`, `ACTIVITY_TO_INACTIVE_DAYS`, `ACTIVITY_OPTIONS`, `HORIZON_OPTIONS` (1/3/5/10 лет).
  - Логика экспорта: `exportReport(kind)` (PDF/XLSX через blob + Content-Disposition), `exportContacts(preset, format)` (CSV/XLSX, пресеты all/repeat/sleeping_90).
- **Эндпоинты (вызовы, не определения):**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/analytics/ltv/summary` | менеджер/директор (`api` token) | `years`, `clinic_id?` | KPI-сводка | Карточки «Сводка» |
  | GET | `/analytics/ltv/patients` | то же | `years, limit=100, min_visits=2, repeat_only?, inactive_days?, clinic_id?` | массив пациентов | Таблица топ-пациентов |
  | GET | `/analytics/ltv/cohorts` | то же | `clinic_id?` (без `years`) | массив когорт | Таблица когорт |
  | POST | `/analytics/ltv/recompute` | то же | `clinic_id?` (body=null) | `{updated}` | Пересчёт снапшотов |
  | GET | `/analytics/ltv/export/{pdf\|xlsx}` | то же | `years, clinic_id?` (blob) | файл | Экспорт отчёта |
  | GET | `/analytics/ltv/contacts.csv` | то же | `format, min_visits?, inactive_days?, clinic_id?` | файл | Экспорт контактов |
- **Зависимости:** `../../api` (axios с авто-токеном), `../../config` (`API_BASE`, `SLUG`), design-system (`Card, KpiCard, KpiRow, Tabs, Button, Chip, EmptyState, useToast, ClinicScopeSelector, Skeleton, TableSkeleton`), хук `../../lib/useClinicScope`.
- **Где менять для типовых задач:**
  - Добавить горизонт LTV (напр. 7 лет) — `HORIZON_OPTIONS` (строка 94).
  - Новый фильтр активности — `ACTIVITY_TO_INACTIVE_DAYS` + `ACTIVITY_OPTIONS` (строки 65-72) и логика в `reload()` (строки 383-386).
  - Новая колонка в топе — `PatientsTable` (`<thead>` строки 237-248 + `<tbody>` строки 251-279).
  - Новый KPI в сводке — `SummaryView` (строки 142-201).
  - Новый пресет экспорта контактов — `exportContacts` (строки 505-559) + пункт меню (строки 679-685).
  - Текст окна «модуль не подключён» — `ConnectModulePrompt` (строка 115).
- **Подводные камни:**
  - **NetLTV = 0 трактуется как «нет данных»** (Renovatio не открыл `getPayments`) и показывается «—» через `fmtRubOrDash` — не путать с нулём денег.
  - Двойная семантика scope: если родитель передал `clinicId` — внутренний `useClinicScope` отключается (`externallyControlled`); иначе свой селектор.
  - Фильтр «Активные (<30д)» считается **на клиенте** (`visiblePatients`), бэк не умеет «строго меньше» — счётчик «Найдено» тоже клиентский.
  - Когорты сознательно **не зависят от `years`** — отдельный запрос без параметра.
  - Токен берётся каскадом из 5 localStorage-ключей (строки 362-369) — легаси-fallback'и оставлены ради совместимости.
- **Строк:** 781

## `frontend/src/sections/network/NetworkDashboard.jsx`

- **Назначение:** Сводная панель сети/франшизы клиник для топ-менеджмента (director/deputy_director/franchise_owner/super_admin): агрегированные KPI, графики выручки, сравнение клиник, таблица детализации и раздел «ЛК-пациенты сети» с drawer-карточкой пациента.
- **Ключевые элементы:**
  - `default NetworkDashboard({ token })` — главный компонент.
  - Локальный `fetchJson(token, path)` — **тонкая обёртка над `fetch`** (не `axios`, не общий `api`).
  - `fmtMoney`, подкомпоненты `KPICard`, `NetworkLineChart` (inline SVG-полилиния выручки), `ClinicsBarChart` (горизонтальные бары по клиникам).
  - Drawer пациента: `openPatientDrawer(p)` грузит детали в `patientDetails`.
- **Эндпоинты:**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/network/overview` | director/franchise_owner/super_admin | `days` | totals+clinics+daily | Основные данные дэшборда |
  | GET | `/network/overview/export-pdf` | то же | `days` (blob) | PDF | Кнопка «Скачать PDF» |
  | GET | `/network/patients` | то же | `q?` (поиск) | `{patients}` | ЛК-пациенты сети |
  | GET | `/network/patients/{id}` | то же | — | детали пациента | Drawer пациента |
- **Зависимости:** `../../config` (`API_BASE`), Tailwind-классы (включая `dark:` варианты), Material Symbols. **Не использует** design-system и общий `api` — это самостоятельный остров с собственным `fetch`.
- **Где менять для типовых задач:**
  - Добавить KPI — `KPICard` в KPI Row (строки 199-206).
  - Новый период — массив `[7,14,30,...]` в `<select>` (строка 185).
  - Новые поля пациента в drawer — блок `patientDetails` (строки 360-430).
  - Стиль графика выручки — `NetworkLineChart` (строки 44-73).
- **Подводные камни:**
  - **Стилистически инороден остальным секциям**: голый Tailwind + `fetch` + `alert()` для ошибок PDF (строка 153), а не toast/design-system. При рефакторинге это первый кандидат на унификацию.
  - Авторизация — **JWT в заголовке вручную** (`Authorization: Bearer ${token}`), токен реально используется (в отличие от `api`-секций).
  - `scope === 'franchise'` определяет подпись «Все клиники франшизы» vs «Одна клиника» — приходит с бэка.
- **Строк:** 439

## `frontend/src/sections/patient/AppointmentsTab.jsx`

- **Назначение:** Пациентская вкладка «Записи» в `PatientCabinet`: список карточек приёмов (предстоящие сверху, история ниже), просмотр деталей (QR, адрес, маршрут), перенос и отмена записи. Mobile-first bottom-sheet.
- **Ключевые элементы:**
  - `default AppointmentsTab({ sessionToken, onBookNew })`.
  - Подкомпоненты: `ApptCard`, `ApptDetailsSheet` (детали + QuickActions), `Row`, `RescheduleSheet` (выбор дня из 14 + слотов).
  - Хелперы: `ymd`, `fmtDate`, `fmtDow`, `timeUntil` (отсчёт «через N ч/мин/дн»).
  - `STATUS_INFO` — карта статусов (pending/confirmed/cancelled/completed/no_show) → цвет/иконка.
  - `useMemo` делит `appts` на `upcoming`/`past`.
- **Эндпоинты:**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/patient/appointments` | пациент (session_token) | `t=<token>, include_past=true` | массив записей | Загрузка списка |
  | POST | `/patient/appointment/{id}/cancel` | пациент | `{patient_token}` | — | Отмена записи |
  | POST | `/patient/appointment/{id}/reschedule` | пациент | `{patient_token, appointment_date, start_time}` | — | Перенос записи |
  | GET | `/public/{SLUG}/doctors/{id}/slots` | публичный | `day=YYYY-MM-DD` | `{slots}` | Свободные слоты при переносе |
- **Зависимости:** `axios` (голый), `../../config` (`API_BASE`, `SLUG`), design-system `useConfirm` (Modal вместо `window.confirm`), `../../components/QuickActions`.
- **Где менять для типовых задач:**
  - Новый статус записи — `STATUS_INFO` (строка 22).
  - Логика разделения предстоящие/прошлые — `useMemo` (строки 81-90).
  - Действия в деталях (кроме перенос/отмена) — `ApptDetailsSheet` (строки 262-292) и `QuickActions`.
  - Диапазон дней переноса — `days` в `RescheduleSheet` (строка 323, сейчас 14 дней).
- **Подводные камни:**
  - Авторизация записи на уровне **отдельного `patient_token` у каждой записи** (не sessionToken) — отмена/перенос упадут, если у карточки нет `patient_token` (строка 93).
  - Перенос дёргает **публичный** booking-роут `/public/{SLUG}/doctors/...`, а не пациентский — нужен корректный `apt.doctor_id`.
  - Слоты фильтруются `s.available !== false` и нормализуются из `start_time`/`time` — формат слотов с бэка неединообразен (строки 389-390).
  - Дата собирается локально через `new Date(\`${date}T${time}:00\`)` — без таймзон, считается «локальное время клиники».
- **Строк:** 411

## `frontend/src/sections/patient/DocumentsTab.jsx`

- **Назначение:** Вкладка «Документы» в кабинете пациента: справки, выписки, больничные. Список карточек с иконкой по типу и кнопкой скачивания (стрим blob с проверкой ownership на бэке).
- **Ключевые элементы:**
  - `default DocumentsTab({ sessionToken, apiBase='/api' })`.
  - Подкомпонент `DocCard`; хелперы `formatDate`, `formatSize`.
  - `DOC_TYPE` — карта типов документа → label/icon/цвет.
  - `handleDownload` — blob → временная `<a download>`.
- **Эндпоинты:**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/patient/documents` | пациент (session_token) | `session_token` и `t` (оба) | массив документов | Список |
  | GET | `/patient/documents/{id}/download` | пациент | `session_token`, `t` (blob) | файл | Скачивание |
- **Зависимости:** `axios`, design-system `useToast` (вместо `alert`).
- **Где менять для типовых задач:**
  - Новый тип документа — `DOC_TYPE` (строка 13).
  - Вид карточки — `DocCard` (строка 34).
  - Логика скачивания/MIME — `handleDownload` (строки 107-128, тип берётся из `doc.mime`).
- **Подводные камни:**
  - Сессия пробрасывается **двумя параметрами сразу** — `session_token` И `t` (строки 95, 111). Это компенсация разнобоя в пациентских роутах бэка; при добавлении новых вызовов держать оба.
  - `apiBase` по умолчанию `/api` — а не из config; если родитель передаёт другой base, проверять консистентность.
- **Строк:** 176

## `frontend/src/sections/patient/MedCardTab.jsx`

- **Назначение:** Вкладка «Медкарта» в кабинете пациента: аккордеон-секции с авто-хронологией приёмов (Уровень 1), диагнозами, аллергиями, прививками. Mobile-first.
- **Ключевые элементы:**
  - `default MedCardTab({ sessionToken, apiBase='/api' })`.
  - Подкомпоненты: `Section` (аккордеон), `DiagnosisCard`, `AllergyCard`, `VaccinationCard`, `EmptyState`, `TimelineItem`.
  - Карты: `SEVERITY_LABEL` (mild/moderate/severe), `DOC_TYPE_LABEL` (**экспортируется** именованно, строка 25 — используется снаружи).
  - `load()` грузит 4 эндпоинта параллельно через `Promise.all` с `.catch`-фоллбеком на пустой массив у каждого.
- **Эндпоинты:**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/patient/medcard/diagnoses` | пациент (session_token) | `session_token`, `t` | массив | Диагнозы |
  | GET | `/patient/medcard/allergies` | пациент | `session_token`, `t` | массив | Аллергии |
  | GET | `/patient/medcard/vaccinations` | пациент | `session_token`, `t` | массив | Прививки |
  | GET | `/patient/medcard/timeline` | пациент | `session_token`, `t` | `{items}` | Авто-хронология |
- **Зависимости:** `axios`. Никакой design-system. Экспортирует `DOC_TYPE_LABEL` для переиспользования.
- **Где менять для типовых задач:**
  - Новая секция медкарты — добавить эндпоинт в `Promise.all` (строки 195-200) + новый `<Section>` (строки 270-286).
  - Цвета/типы элементов timeline — `colors` в `TimelineItem` (строка 144).
  - Лимит timeline — `.slice(0, 50)` (строка 259).
- **Подводные камни:**
  - Каждый из 4 запросов имеет **собственный `.catch(() => ({data:[]}))`** — частичный отказ не валит весь таб (хорошо для надёжности, но ошибки тихо проглатываются).
  - Снова двойной `session_token` + `t`.
  - Склонение «запись/записи/записей» в `Section` — упрощённое, проверить на 21/22 (строка 52).
- **Строк:** 290

## `frontend/src/sections/patient/PatientAiWidget.jsx`

- **Назначение:** Плавающий AI-ассистент (правый нижний угол) в `PatientCabinet`. Чат с авто-эскалацией к менеджеру. Если модуль `ai_assistant` не подключён (402) — виджет полностью скрывается.
- **Ключевые элементы:**
  - `default PatientAiWidget({ apiBase, patientPhone, tenantSlug })`.
  - Конечный автомат `state`: `idle|loading|ready|unavailable|error`.
  - `ensureConversation()` (lazy-создание беседы), `send()` (оптимистичное добавление user-сообщения), `escalate()`.
  - session_token читается **прямо из localStorage** (`clinika_patient_session`) и кладётся в query `?t=`.
- **Эндпоинты:**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | POST | `/patient-portal/ai/conversations` | пациент (`?t=`) | `{patient_phone, tenant_slug}` | `{id, status}` | Создать/получить беседу |
  | GET | `/patient-portal/ai/conversations/{id}/messages` | пациент | `?t=` | `{messages}` | История |
  | POST | `/patient-portal/ai/conversations/{id}/messages` | пациент | `{text}` | `{text, escalated}` | Отправить сообщение |
  | POST | `/patient-portal/ai/conversations/{id}/escalate` | пациент | `?t=` | — | Эскалация менеджеру |
- **Зависимости:** `axios`. Самодостаточен (inline-стили + Tailwind).
- **Где менять для типовых задач:**
  - Приветственный текст ассистента — строки 210-216.
  - Логика показа/скрытия кнопки — «тихая» проверка модуля при монтировании (строки 67-85): 402 → `unavailable` (скрыть), прочая ошибка → `idle` (кнопку показать).
  - Позиция/размер окна — inline-стили (строки 158-183).
- **Подводные камни:**
  - **Двойное создание беседы**: один раз «тихо» при монтировании (проверка доступности), второй — при первом открытии через `ensureConversation`. Бэкенд должен быть идемпотентен (возвращать существующую беседу), иначе плодятся дубли.
  - Доступность модуля определяется по коду **402** на создании беседы — если бэк начнёт отдавать другой код, виджет перестанет скрываться.
  - `// cache-bust 1780606462` в конце файла (строка 275) — артефакт деплоя, не логика.
- **Строк:** 276

## `frontend/src/sections/patient/PatientLabDynamics.jsx`

- **Назначение:** Динамика лабораторных показателей пациента: список аналитов (проблемные high/low сверху), раскрываемые карточки с inline-SVG line-chart, зелёной зоной нормы, трендовой линией (линейная регрессия) и tooltip.
- **Ключевые элементы:**
  - `default PatientLabDynamics({ apiBase, sessionToken })`.
  - Подкомпоненты: `AnalyteCard` (раскрытие), `SvgLineChart` (вся геометрия графика в `useMemo`).
  - Селектор периода 6/12/24 мес. Графики чисто на SVG — **никаких recharts/chart.js** (политика проекта).
- **Эндпоинты:**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/patient/lab-dynamics` | пациент (session_token) | `t=<token>, months` | `{analytes:[...]}` | Динамика анализов |
- **Зависимости:** `axios`, `useMemo` (геометрия и тренд). Самодостаточен.
- **Где менять для типовых задач:**
  - Периоды — массив `[6,12,24]` (строка 83).
  - Цвета/подписи статусов (ok/high/low) — `AnalyteCard` (строки 120-127).
  - Логика трендовой линии / зоны нормы / тиков — `geom` в `SvgLineChart` (строки 206-272).
  - Сколько дат подписывать на оси X — `labelIdx` (строки 280-287).
- **Подводные камни:**
  - `hasNorm` отбрасывает «фейковые» нормы: требует `norm_max < 999` (строка 129) — большие значения трактуются как «нормы нет».
  - Тренд считается только при `n >= 2 && denom !== 0` — единичная точка графика не рисует линию.
  - При равных значениях расширяет диапазон вручную (`yMin-=1; yMax+=1`), иначе деление на ноль.
- **Строк:** 447

## `frontend/src/sections/patient/PatientMedicalRecord.jsx`

- **Назначение:** Единая агрегированная электронная медкарта: собирает в один экран данные из нашей БД + МИС Renovatio + лаб-результаты + документы. Шапка с профилем, блок аллергий, антропометрия, двухколоночная сетка (диагнозы/назначения/анализы/документы/направления/прививки) и timeline визитов. Скачивание PDF.
- **Ключевые элементы:**
  - `default PatientMedicalRecord({ apiBase, sessionToken })`.
  - Подкомпоненты `Section`, `Stat`.
  - Деструктуризация `data` на 11 секций (profile, anthropometry, visits, diagnoses_active, prescriptions_active, allergies, recent_labs, documents, referrals, vaccinations).
  - `onDownloadPdf` — открывает PDF в новой вкладке через `?t=`.
- **Эндпоинты:**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/patient/medical-record` | пациент (session_token) | `t=<token>` | агрегированная медкарта | Загрузка экрана |
  | GET | `/patient/medical-record/pdf` | пациент | `t=<token>` (открывается в new tab) | PDF | Кнопка «PDF» |
- **Зависимости:** `axios`. Самодостаточен (Tailwind + emoji-иконки вместо Material Symbols).
- **Где менять для типовых задач:**
  - Новый блок медкарты — добавить деструктуризацию (строки 50-61) + `<Section>` в сетку.
  - Источники визита (mis/local) — бейджи в timeline (строки 352-361).
  - Парсинг адреса (строка/объект) — IIFE строки 117-124 (уже умеет `string` и объект с `fullAddress`/city/street/house).
- **Подводные камни:**
  - **Мёртвый код**: блок `{false && (...)}` на строках 125-127 — старый рендер адреса, никогда не выполняется (оставлен на удаление).
  - Возраст считается на клиенте грубо (`365.25` дней) — без точного учёта дат рождения (строка 64).
  - Дубликат концепции с `MedCardTab` (тоже медкарта, но из 4 узких эндпоинтов): **это разные экраны** — `PatientMedicalRecord` единый/агрегированный, `MedCardTab` — аккордеон по узким срезам. Не путать при правке.
- **Строк:** 420

## `frontend/src/sections/patient/PrescriptionsTab.jsx`

- **Назначение:** Вкладка «Назначения» пациента: лекарства из МИС (live) и из локального кэша. При недоступности МИС — баннер «показаны данные из кэша».
- **Ключевые элементы:**
  - `default PrescriptionsTab({ sessionToken, apiBase='/api' })`.
  - Подкомпонент `PrescriptionCard` (бейдж «из кэша» если `source !== 'mis'`), хелпер `formatDate`.
  - Стейт `misAvailable` управляет баннером и текстом пустого состояния.
- **Эндпоинты:**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/patient/prescriptions` | пациент (session_token) | `session_token`, `t` | `{items, mis_available, count}` | Список назначений |
- **Зависимости:** `axios`. Самодостаточен.
- **Где менять для типовых задач:**
  - Поля назначения (дозировка/частота/длительность) — `PrescriptionCard` (строки 36-53).
  - Тексты пустого состояния (зависит от `misAvailable`) — строки 121-125.
- **Подводные камни:**
  - `key` карточки использует `Math.random()` как последний fallback (строка 140) — **антипаттерн React** (ломает reconciliation), но срабатывает редко (только если нет ни `id`, ни `mis_id`).
  - `mis_available` приходит с бэка и определяет, кэш это или live — не вычисляется на фронте.
- **Строк:** 145

## `frontend/src/sections/patient/VitalsTab.jsx`

- **Назначение:** Витальные показатели пациента (пульс, давление, SpO₂, шаги, вес, сон, HRV и др.): KPI-карточки, горизонтальный ряд sparkline-графиков, ручной ввод через bottom-sheet и синхронизация с Apple Health через нативный мост `window.ClinikaBridge`.
- **Ключевые элементы:**
  - `default VitalsTab({ token, sessionToken, phone })`.
  - Подкомпоненты: `Sparkline` (inline SVG), `KpiCard`, `MetricChartCard` (грузит серию сам), `AddVitalSheet` (модалка ввода).
  - Карта `METRICS` (10 показателей: label/icon/unit/fmt), порядки `KPI_ORDER`/`ALL_ORDER`.
  - `handleAppleHealth` — делегирует сбор сэмплов нативной обёртке iOS через `window.ClinikaBridge.requestHealthSync`.
- **Эндпоинты:**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/patient/vitals/summary` | пациент (session_token) | `session_token` | `{latest, available_sources}` | KPI + источники |
  | GET | `/patient/vitals/series` | пациент | `metric, days=30, session_token` | `{points}` | График по метрике |
  | POST | `/patient/vitals` | пациент | `{metric,value,unit,measured_at}` + `?session_token` | — | Ручной ввод |
  | POST | `/patient/vitals/sync/apple-health` | нативный мост | сэмплы (POST-ит сам ClinikaBridge) | — | Apple Health sync |
- **Зависимости:** `axios`, `../../config` (`API_BASE`, `BASE_PATH`), design-system `useToast`, глобальный `window.ClinikaBridge` (нативное iOS-приложение).
- **Где менять для типовых задач:**
  - Новая метрика — `METRICS` (строка 17) + `ALL_ORDER`/`KPI_ORDER`.
  - Логика давления (2 записи sys+dia) — `AddVitalSheet.handleSubmit` (строки 147-167).
  - Период графика — `days: 30` в `MetricChartCard` (строка 108).
  - Блок Apple Health показывается только если `available_sources.includes('apple') && isIOS` — модуль `health_apple` (строка 331).
- **Подводные камни:**
  - Apple Health **не делает sync сам** — фронт лишь зовёт мост, который нативно POST-ит на `/patient/vitals/sync/apple-health`. В обычном браузере `hasBridge=false` → подсказка.
  - Давление хранится двумя метриками (`blood_pressure_sys`/`_dia`) — `_dia` исключается из селектора ввода и из extra-KPI (строки 185, 322).
  - `MetricChartCard` грузит серию для **каждой** метрики при монтировании — это N параллельных запросов (по числу `ALL_ORDER`).
- **Строк:** 391

## `frontend/src/sections/payments/FiscalSettingsSection.jsx`

- **Назначение:** Настройка ОФД (54-ФЗ, модуль `fiscal_54fz_pro`): выбор провайдера (Платформа/Первый/Такском/Атол.Онлайн), ввод ИНН и API-ключа, активность, ручной pull чеков. Бейдж «В разработке» если адаптер ещё заглушка.
- **Ключевые элементы:**
  - `default FiscalSettingsSection({ token, clinicId, showToast })`.
  - Константа `PROVIDERS` (4 ОФД: key/name/icon/color/docUrl/apiKeyHint/description).
  - `load`, `handleSave`, `handlePull`. `isImplemented = available.includes(provider)` — реализованность адаптера приходит с бэка.
- **Эндпоинты:**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/clinics/{id}/ofd-config` | менеджер/owner (`api` token) | — | `{config, available_providers}` | Текущий конфиг ОФД |
  | PUT | `/clinics/{id}/ofd-config` | то же | `{provider, inn, is_active, api_key?, config}` | — | Сохранить |
  | POST | `/clinics/{id}/ofd/pull` | то же | `{}` | `{fetched, saved}` | Принудительно подтянуть чеки |
- **Зависимости:** `../../api` (axios c авто-токеном). `showToast` — колбэк от родителя (не useToast).
- **Где менять для типовых задач:**
  - Новый ОФД-провайдер — добавить объект в `PROVIDERS` (строка 23); признак «реализован» придёт через `available_providers` с бэка.
  - Дополнительные поля конфига — `handleSave.body` (строки 116-122).
- **Подводные камни:**
  - **API-ключ никогда не возвращается с бэка** — приходит только флаг `config.api_key_present`. Пустой инпут при сохранении = «не менять ключ» (строки 122, 247-251).
  - `clinicId` обязателен — без него `load()` молча выходит (строка 86), секция остаётся в `loading`.
  - tenant-изоляция: `/clinics/{id}/...` — id клиники в пути, но реальная проверка прав на бэке по токену+slug.
- **Строк:** 305

## `frontend/src/sections/payments/PaymentSettingsSection.jsx`

- **Назначение:** Настройка интернет-эквайринга (модуль `online_payments_pro`): выбор шлюза (ЮKassa/Т-Банк/Сбер/CloudPayments/Robokassa), shop_id, secret_key, тестовый режим, активность. Бейдж «В разработке» если адаптер не реализован.
- **Ключевые элементы:**
  - `default PaymentSettingsSection({ token, clinicId, showToast })`.
  - Константа `GATEWAYS` (5 шлюзов с разными лейблами полей: `publicLabel`/`secretLabel` отличаются у каждого).
  - При смене шлюза `useEffect` подставляет уже сохранённый конфиг (строки 135-148).
- **Эндпоинты:**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/clinics/{id}/payment-config` | менеджер/owner (`api` token) | — | `{configs, available_gateways}` | Все конфиги шлюзов |
  | PUT | `/clinics/{id}/payment-config` | то же | `{gateway, shop_id, is_active, is_test_mode, secret_key?, config}` | — | Сохранить шлюз |
- **Зависимости:** `../../api`. `showToast` — колбэк родителя.
- **Где менять для типовых задач:**
  - Новый шлюз — объект в `GATEWAYS` (строка 24), включая человекочитаемые `publicLabel`/`secretLabel`.
  - Дополнительные поля шлюза — `handleSave.body` (строки 157-163).
- **Подводные камни:**
  - Аналогично ОФД: `secret_key` не возвращается, только `secret_key_present`; пустой инпут = «не менять».
  - **Параллельная структура с `FiscalSettingsSection`** (тот же паттерн provider-карточки + бейдж «В разработке»), но это разные модули (платежи vs ОФД) — изменения копировать осознанно, не считать дублем.
  - Несколько шлюзов могут быть сохранены одновременно (`configs` — массив); активным платежом управляет `is_active` per-gateway.
- **Строк:** 338

## `frontend/src/sections/payments/PaymentsListSection.jsx`

- **Назначение:** Список онлайн-платежей пациентов клиники с фильтром по статусу и действием «полный возврат» (для менеджера).
- **Ключевые элементы:**
  - `default PaymentsListSection({ token, clinicId, showToast })`.
  - `STATUS_LABEL` (pending/succeeded/cancelled/refunded → текст/цвет), `fmtRub`.
  - `handleRefund(id)` через `useConfirm` (Modal-подтверждение).
- **Эндпоинты:**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/clinics/{id}/payments` | менеджер/owner (`api` token) | `status?` (+ from/to по описанию) | массив платежей | Список |
  | POST | `/payments/{id}/refund` | менеджер | `{}` | — | Полный возврат |
- **Зависимости:** `../../api`, design-system `useConfirm`, `EmptyState`. `showToast` — колбэк родителя.
- **Где менять для типовых задач:**
  - Новый статус — `STATUS_LABEL` (строка 17) + `<option>` фильтра (строки 83-88).
  - Колонки таблицы — `<thead>`/`<tbody>` (строки 104-153).
  - Кнопка возврата показывается только при `status === 'succeeded'` (строка 140).
- **Подводные камни:**
  - Возврат **только полный** — частичный возврат не предусмотрен.
  - `fmtRub` округляет через `Math.round(Number(...))` — для денег это потеря копеек; бэк хранит точную сумму, фронт показывает целые рубли.
  - Фильтры from/to упомянуты в шапке-комментарии, но в UI присутствует только фильтр статуса.
- **Строк:** 161

## `frontend/src/sections/payments/ReceiptsListSection.jsx`

- **Назначение:** Список фискальных чеков 54-ФЗ клиники (модуль `fiscal_54fz_pro`): дата, тип операции, сумма, ФД/ФН, ОФД, ссылка на проверку чека в ФНС.
- **Ключевые элементы:**
  - `default ReceiptsListSection({ token, clinicId, showToast })`.
  - `OP_LABEL` (sale/refund_sale/sale_correction), `fmtRub`. Только список — без действий.
- **Эндпоинты:**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/clinics/{id}/receipts` | менеджер/owner (`api` token) | (from/to по описанию) | массив чеков | Список чеков |
- **Зависимости:** `../../api`. Самый простой файл группы (read-only).
- **Где менять для типовых задач:**
  - Новый тип операции — `OP_LABEL` (строка 15).
  - Колонки — `<thead>`/`<tbody>` (строки 65-107).
  - Ссылка проверки чека ФНС — шаблон `https://lkdr.nalog.ru/check/?${r.qr_code}` (строка 94): `qr_code` уже содержит query-строку чека.
- **Подводные камни:**
  - QR-ссылка собирается конкатенацией `?${r.qr_code}` — формат `qr_code` должен быть готовой query-строкой ФНС, иначе ссылка битая.
  - Read-only: чеки только подтягиваются (через ОФД pull в `FiscalSettingsSection`), здесь не создаются.
  - from/to в комментарии описаны, но в UI фильтра дат нет.
- **Строк:** 114

## `frontend/src/sections/scheduling/SlotBoardSection.jsx`

- **Назначение:** Альтернативный вид расписания «слоты-карточки» (дизайн v3): слева панель врачей (поиск + прогресс-бар загрузки), справа сетка слотов (4 колонки) на выбранный день с почасовыми разделителями, метриками, now-подсветкой. Поддерживает режим менеджера (`full`) и врача (`self`). Большая часть файла — изолированный CSS.
- **Ключевые элементы:**
  - `default SlotBoardSection({ token, mode='full', selfDoctorId, selfDoctorName })`.
  - Подкомпоненты/хелперы: `renderSlotsGrid` (рендер сетки с разделителями по 2 часа), `BookModal` (создание записи), `SlotBoardStyles` (весь CSS в `<style>`, scoped под `.slot-board`).
  - Утилиты дат: `ymd`, `startOfWeek` (понедельник), `addDays`, `sameYMD`. Аватары: `doctorInitials`, `doctorColor` (хэш uuid → цвет).
  - Карта `STATUSES`. Метрики дня и now-подсветка через `useMemo`/`isNowSlot` (тик каждую минуту).
- **Эндпоинты:**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/doctors` | менеджер/админ (`api` token) | — | массив врачей | Левая панель (только `mode=full`) |
  | GET | `/doctors/{id}/week` | то же | `start_date=YYYY-MM-DD` | `{days, slot_duration}` | Слоты+записи на неделю |
  | GET | `/appointments` | то же | `appointment_date=YYYY-MM-DD` | массив записей | Счётчики по всем врачам |
  | POST | `/appointments` | то же | `{doctor_id, appointment_date, start_time, patient_phone, patient_name?, notes?}` | — | Создать запись (BookModal) |
- **Зависимости:** `../../api`, design-system `Modal`/`Button`, `../../components/scheduling/AppointmentDetailsModal` (карточка приёма — **сознательно переиспользуется, не дублируется**).
- **Где менять для типовых задач:**
  - Логика рендера слота/бейджей (приоритет, направления, EMR-галочка) — `renderSlotsGrid` (строки 500-596).
  - Создание записи (поля формы) — `BookModal` (строки 601-678).
  - Статусы и их цвета — `STATUSES` (строка 77) + CSS-классы `.status-*` (строки 1065-1068).
  - Все стили — `SlotBoardStyles` (строки 683-1204); цвета берут CSS-переменные темы (`--accent`, `--surface` и т.д.) с фоллбеками.
  - Открытие карточки приёма правится **не здесь**, а в `AppointmentDetailsModal`.
- **Подводные камни:**
  - **Самый крупный файл группы (1205 строк) — ~520 строк это CSS** в `<style>`. Стили scoped префиксом `.slot-board`, чтобы не утекать; не выносить в глобальные CSS бездумно.
  - `now`-подсветка зависит от `weekData.slot_duration` (по умолчанию 30 мин) — при нестандартной длительности слота окно «сейчас» считается из неё.
  - Прогресс-бар врача: для **активного** врача показывает `cnt/slotsTotal`, для остальных — приблизительно `cnt*10%` (нет точного числа слотов без загрузки их недели) — строки 364-368.
  - Ошибки создания записи разбирают `detail` бэка, который может быть строкой ИЛИ массивом FastAPI-валидации (строки 276-282).
  - В `self`-режиме `/doctors` не грузится — врач строится заглушкой из props (строки 113-120); левая панель скрыта.
- **Строк:** 1205
