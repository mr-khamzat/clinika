# components [04] — чат-инструменты, кабинет врача, документы, семья, лаборатория, импорт склада

Этот срез — 15 React-компонентов из 6 предметных папок (`chat`, `doctor`, `documents`, `family`, `inventory`, `lab`). Все они — **«листовые» UI-компоненты**: их не маунтят напрямую в роутере, а вставляют внутрь больших секций кабинетов (`ClinicChatSection`, `PatientChatSection`, `DoctorLayout`, `VisitingDoctorCabinet`, `PatientDocumentsSection`, `PatientFamilySection`, `ManagerInventory`, `DoctorLabOrdersSection`). Эндпоинтов они не определяют (это фронтенд) — но **дёргают** backend через два разных пути доступа:

- **`import api from '../../api'`** — общий axios-инстанс с авто-токеном и `baseURL = /<slug>/api` (мультитенантный). Так работают `chat/*`, `doctor/*`, `documents` (косвенно), `inventory`, и `lab` (api приходит пропом).
- **`import axios from 'axios'` + `API_BASE` + `{ params: { t: token } }`** — «сырой» путь пациентского портала, токен сессии в query-параметре `t`. Так работает **только `family/*`** (`AcceptInviteModal`, `AddMemberModal`) — это отдельный публичный пациентский контур.

Дизайн расколот на два мира: часть компонентов использует дизайн-систему (`../../design`: `Card`, `Modal`, `Button`, `Chip`, `useToast`, `KpiCard`) и CSS-переменные темы (`var(--fg)`, `var(--accent)`, `var(--border)`), а часть (особенно `family/*`, `documents/*`, `chat/StickerPicker`) — **захардкоженные hex-цвета и Tailwind-классы**. Это главный источник визуальной рассинхронизации при перетемизации.

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `chat/StickerPicker.jsx` | Палитра стикеров SVG для чата | 153 |
| `chat/TemplateAutocomplete.jsx` | Выпадашка шаблонов по «/» в чате | 141 |
| `chat/TemplateManagerModal.jsx` | CRUD-модалка шаблонов быстрых ответов | 407 |
| `chat/ThreadListItem.jsx` | Карточка треда в списке чатов + SLA | 202 |
| `doctor/DoctorBriefingPanel.jsx` | AI-сводка пациента перед приёмом | 361 |
| `doctor/DoctorTreatmentPlanEditor.jsx` | Генерация и правка плана лечения | 416 |
| `doctor/ExternalDoctorBillingSection.jsx` | Прямые счета внешнего врача + PDF | 488 |
| `documents/DocumentCard.jsx` | Карточка медицинского документа | 159 |
| `documents/DocumentUploadModal.jsx` | Загрузка документа с прогрессом | 340 |
| `documents/ImageLightbox.jsx` | Полноэкранный просмотр img/PDF | 120 |
| `family/AcceptInviteModal.jsx` | Приём invite-токена семьи | 101 |
| `family/AddMemberModal.jsx` | Добавление родственника в семью | 280 |
| `family/FamilyMemberCard.jsx` | Карточка члена семьи + права | 209 |
| `inventory/InventoryImportWizard.jsx` | 5-шаговый импорт остатков из 1С | 635 |
| `lab/LabOrderForm.jsx` | Форма заявки на анализы | 291 |

---

## `frontend/src/components/chat/StickerPicker.jsx`
- **Назначение:** Всплывающая палитра брендовых стикеров КлиникСеть для отправки в чат. Загружает каталог из статики и отдаёт URL выбранного SVG родителю.
- **Ключевые элементы:** дефолтный экспорт `StickerPicker({ open, onClose, onPick })`; локальный стейт `stickers` / `category`; константа `CAT_LABELS` (рус. ярлыки категорий); фильтрация `filtered` и вычисление `categories` через `Set`.
- **Зависимости:** только React (`useState`, `useEffect`). **Не использует** `api` — тянет каталог прямым `fetch('/stickers/index.json')` и картинки `/stickers/<file>`. Внешних дизайн-компонентов нет, стили инлайновые hex.
- **Где менять для типовых задач:** добавить категорию — правь словарь `CAT_LABELS` (стр. 23-33) и положи файлы в `public/stickers/` + запись в `index.json`. Поменять колбэк выбора — `onPick('/stickers/' + s.file)` (стр. 111). Сменить сетку — `gridTemplateColumns` (стр. 101).
- **Подводные камни:** путь `/stickers/...` **абсолютный от корня домена, без `baseURL`/slug** — на мультитенантном поддомене файлы должны лежать в общей статике, иначе 404. Ошибка fetch молча гасится в пустой массив (стр. 16) — «Стикеры не загружены» вместо явной ошибки. Цвета захардкожены (`#0097A7`, `#ffffff`) — тему не подхватывает.
- **Строк:** 153

## `frontend/src/components/chat/TemplateAutocomplete.jsx`
- **Назначение:** Inline-выпадашка под полем ввода чата: при наборе `/` показывает топ-шаблоны, при `/прив` фильтрует. Навигация стрелками/Enter/Tab/Esc.
- **Ключевые элементы:** дефолтный экспорт `TemplateAutocomplete({ query, onPick, onClose })`; константа `CATEGORY_ICONS` (маппинг категория→material-symbol); два `useEffect` — загрузка по `query` (с флагом `alive` против гонок) и глобальный `keydown`-листенер для навигации; стейт `items` / `active` / `loading`.
- **Зависимости:** `api` (`GET /chat/templates?q=&limit=10`). CSS-переменные темы с hex-фолбэками. Material Symbols (иконки категорий).
- **Где менять для типовых задач:** добавить иконку категории — `CATEGORY_ICONS` (стр. 23-29). Поменять лимит/поведение запроса — `useEffect` стр. 36-45. Добавить горячую клавишу — обработчик `onKey` стр. 49-61. Текст подсказки «ничего не найдено» — стр. 83.
- **Подводные камни:** `query == null` означает «выключено» (а `query === ''` — «показать топ»), это разные состояния — не путать при интеграции. Глобальный `window keydown` активен пока открыт — может конфликтовать с другими хоткеями страницы. Родитель textarea **обязан** иметь `position: relative` (компонент `absolute bottom-full`).
- **Строк:** 141

## `frontend/src/components/chat/TemplateManagerModal.jsx`
- **Назначение:** Полноэкранная модалка управления шаблонами быстрых ответов: поиск, группировка по категориям, CRUD, сид 10 платформенных шаблонов. Клик по шаблону подставляет его текст в драфт чата.
- **Ключевые элементы:** дефолтный экспорт `TemplateManagerModal({ open, onClose, onPick, canManage })`; константа `CATEGORIES` (6 категорий с иконками, включая `null` = «Без категории»); helper `categoryOf(t)`; `load()`, `handleSeed()`, `handleSave()`, `handleDelete()`; `useMemo` для `filtered` (поиск) и `grouped` (по категориям).
- **Зависимости:** `api` — `GET /chat/templates?limit=100`, `POST /chat/templates/seed-defaults`, `POST /chat/templates`, `PUT /chat/templates/{id}`, `DELETE /chat/templates/{id}`. CSS-переменные темы, Material Symbols.
- **Где менять для типовых задач:** добавить/переименовать категорию — массив `CATEGORIES` (стр. 23-30, синхронь с `CATEGORY_ICONS` в `TemplateAutocomplete`). Изменить набор полей шаблона — форма `handleSave` payload (стр. 97-103) + поля формы (стр. 238-291). Список плейсхолдеров (`{{ patient_name }}` и т.д.) — подсказка стр. 277-279 (это только текст-хинт, рендерит их backend при отправке).
- **Подводные камни:** `is_global` редактируется только при создании (`disabled={!!editing.id}`, стр. 287) — нельзя переключить у существующего. Используются нативные `alert`/`confirm` (стр. 86, 124) — заглушены eslint-комментом, не дизайн-система. `shortcut` чистится от ведущего `/` на сабмите (стр. 98). Права `canManage` приходят пропом — компонент сам ничего не проверяет.
- **Строк:** 407

## `frontend/src/components/chat/ThreadListItem.jsx`
- **Назначение:** Карточка одного треда в списке чатов. Универсальна для двух сторон: пациент (`side='patient'`) и клиника (`side='clinic'`) — определяет, какие имена/счётчик непрочитанного показывать. Рисует SLA-индикатор (Intercom-style), бейджи закрепления, цветовую метку, относительное время.
- **Ключевые элементы:** дефолтный экспорт `ThreadListItem({ thread, active, onClick, side })`; helpers `_ensureSlaPulseStyle()` (идемпотентно инжектит `@keyframes` в `<head>`), `_slaTitle()`, `fmtRelative(iso)`, `avatarColor(name)` (hash→палитра); константы `_SLA_COLORS`, `labelHex`; `useMemo` для `initials`/`color`.
- **Зависимости:** только React. Material Symbols (`push_pin`). CSS-переменные темы с hex-фолбэками.
- **Где менять для типовых задач:** изменить, какое поле треда читать для каждой стороны — блок `title`/`subtitle`/`unread`/`preview` (стр. 82-89). Пороги/цвета SLA — `_SLA_COLORS` (стр. 35-39) и `_slaTitle` (стр. 41-46); анимацию пульса — keyframes стр. 27-28. Цвета цветовых меток — словарь `labelHex` (стр. 98-100).
- **Подводные камни:** SLA-уровни приходят с backend (`thread.sla_level` ∈ red/yellow/green/gray) — фронт только раскрашивает. Относительное время считается на клиенте (часовой пояс браузера). `@keyframes` инжектится в DOM один раз глобально (по id `__sla_pulse_keyframes__`) — самодостаточно, но это побочный эффект в `<head>`. Используется в двух родителях — менять контракт пропов осторожно.
- **Строк:** 202

## `frontend/src/components/doctor/DoctorBriefingPanel.jsx`
- **Назначение:** AI-сводка пациента перед предстоящим приёмом (Глава 6, фича 1): витальные, аллергии, история диагнозов, редактируемые жалобы, AI-рекомендации. Серверный кеш (Redis 1ч), кнопка «Перегенерировать» шлёт `?refresh=1`.
- **Ключевые элементы:** дефолтный экспорт `DoctorBriefingPanel({ appointmentId, onClose })`; внутренние компоненты `Skel` (shimmer-скелетон) и `Section` (заголовок + бейдж источника); константа `REC_STYLE` (стили типов рекомендаций attention/caution/investigate); `load(refresh)` и `saveComplaints()` (оба `useCallback`).
- **Зависимости:** `api` — `GET /doctor/appointments/{id}/briefing[?refresh=1]` (загрузка) и `PATCH /appointments/{id}` с `{ notes }` (сохранение жалоб). Дизайн-система: `Card`, `Chip`, `Button`, `EmptyState`.
- **Где менять для типовых задач:** добавить блок данных briefing — новый `<Section>` + чтение поля из `data` (образец витальных стр. 205-238). Поменять стили AI-рекомендаций — `REC_STYLE` (стр. 23-27). Лейбл провайдера AI (Claude/Gemini/rule-based) — стр. 185-188.
- **Подводные камни:** жалобы сохраняются по `onBlur` (autosave, стр. 305) в `appointments.notes`, **и** требуют ручного «Перегенерировать» чтобы AI пересчитал — autosave не триггерит регенерацию (стр. 324). После сохранения вызывается `load(true)` — лишний refresh-запрос. `data.ai_provider` определяет, был ли это реальный AI или fallback `rule-based`. Поля витальных проверяются на `!= null` (т.е. `0` показывается корректно).
- **Строк:** 361

## `frontend/src/components/doctor/DoctorTreatmentPlanEditor.jsx`
- **Назначение:** Модал-редактор плана лечения (Глава 6, фича 2). Шаг 1 — форма генерации (диагноз/симптомы/подход), шаг 2 — правка структурированного плана (цель, этапы, назначения, диагностика, контроли, образ жизни, red flags) + действия draft/approve/archive/копировать в медкарту.
- **Ключевые элементы:** дефолтный экспорт `DoctorTreatmentPlanEditor({ appointmentId, initialPlan, onSaved, onClose })`; внутренние `AutoSizeText`, `ListEditor` (массив объектов с полями), `SimpleList` (массив строк); `generate()`, `save(newStatus)`, `copyToMedcard()` (все `useCallback`); стейт `step` ('gen'|'edit'), `payload`.
- **Зависимости:** `api` — `POST /doctor/appointments/{id}/generate-plan`, `PATCH /doctor/treatment-plans/{id}` (с `payload` и опц. `status`), `POST /doctor/treatment-plans/{id}/copy-to-medcard`. Дизайн-система: `Card`, `Button`, `Chip`.
- **Где менять для типовых задач:** добавить секцию плана — новый `<ListEditor>`/`<SimpleList>` со `set('новый_ключ', v)` (образцы стр. 346-412); ключи должны совпадать с тем, что отдаёт/принимает backend в `payload`. Поменять подходы генерации — Chip-кнопки стр. 261-274 (`conservative`/`active`). Статусы и кнопки — хедер шага 2 (стр. 311-333).
- **Подводные камни:** весь план хранится в свободном JSON `payload` — структура не типизирована, переименование ключа сломает связь фронт↔бэк. `copyToMedcard` использует нативный `alert` (стр. 210). `ai_provider` бывает `gemini` или `rule-based` (стр. 306). `save()` без аргумента сохраняет черновик; с `'approved'`/`'archived'` — меняет статус. После approve кнопка «Утвердить» скрывается, появляется «Архив».
- **Строк:** 416

## `frontend/src/components/doctor/ExternalDoctorBillingSection.jsx`
- **Назначение:** Секция прямых счетов для внешних врачей (visiting/partner, Глава 6, фича 3): KPI-статистика, топ клиник, форма выставления счёта с live-расчётом итога, список счетов с фильтром по статусу, PDF-печать.
- **Ключевые элементы:** дефолтный экспорт `ExternalDoctorBillingSection({ embedded })`; внутренние `CreateBillForm`, `BillsList`; helpers `fmtRub`, `fmtDate`; константы `STATUS_LABEL`, `PAY_METHOD_LABEL`; в форме — `useMemo` `subtotal` и расчёт `discountAmount`/`total`; в секции — `load()`, `handleAction()`, `filtered`.
- **Эндпоинты (потребляемые, не определяемые):**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | POST | `/external-doctor/direct-bill` | внешний врач | `{services[], discount_pct, payment_method, notes, appointment_id, patient_name, patient_phone}` | объект счёта | Создать счёт |
  | GET | `/external-doctor/direct-bills?limit=100` | внешний врач | query | массив счетов | Список своих счетов |
  | GET | `/external-doctor/my-stats` | внешний врач | — | `{earnings, paid_count, bills_total, average_check, appointments_count, top_clinics[]}` | KPI и топ клиник |
  | PATCH | `/external-doctor/direct-bills/{id}/status` | внешний врач | `{status}` (sent/paid/cancelled) | — | Смена статуса |
  | GET | `/external-doctor/direct-bills/{id}/print` | внешний врач | — | PDF | Печать (WeasyPrint), открывается `window.open` |

- **Зависимости:** `api` (включая `api.defaults.baseURL` для прямой ссылки на PDF, стр. 398). Дизайн-система: `Card`, `KpiCard`, `KpiRow`, `Chip`, `Button`, `EmptyState`.
- **Где менять для типовых задач:** добавить метод оплаты — `PAY_METHOD_LABEL` (стр. 33-37) + массив `['cash','card','transfer']` в форме (стр. 228). Поменять статусы счёта — `STATUS_LABEL` (стр. 26-31) и логику кнопок в `BillsList` (стр. 338-353). KPI-карточки — стр. 417-423.
- **Подводные камни:** **деньги считаются на клиенте через `parseFloat` (float)** — `subtotal`/`discountAmount`/`total` (стр. 69-79); итоговую сумму нужно перепроверять на backend (риск копеечных расхождений с Decimal). Форма рендерится inline, а не как настоящий модал («inline для простоты», стр. 466). PDF открывается прямой ссылкой с `baseURL` — токен должен прокидываться через cookie/заголовок инстанса, иначе 401. Ошибки `load()` молча гасятся в пустые данные (стр. 384).
- **Строк:** 488

## `frontend/src/components/documents/DocumentCard.jsx`
- **Назначение:** Карточка одного медицинского документа (Глава 9): иконка по MIME, бейдж категории, метаданные (дата/размер/видимость), кнопки открыть/скачать/удалить. Read-only режим без удаления.
- **Ключевые элементы:** дефолтный экспорт `DocumentCard({ doc, onPreview, onDownload, onDelete, readOnly })`; helpers `iconForMime(mime)`, `fmtSize(bytes)`, `fmtDate(iso)`; константы `CATEGORY_META` (7 категорий, цвета), `VIS_LABEL` (4 уровня видимости с иконками); флаги `isImage`/`isPdf`.
- **Зависимости:** только React (компонент без хуков, чистый). Material Symbols. **Hex-цвета захардкожены** — тему не использует.
- **Где менять для типовых задач:** добавить категорию документа — `CATEGORY_META` (стр. 16-24). Добавить тип превью/иконку — `iconForMime` (стр. 26-33). Добавить уровень видимости — `VIS_LABEL` (стр. 50-55, синхронь с `DocumentUploadModal.VISIBILITIES`). Логика «открыть vs скачать» по MIME — стр. 72.
- **Подводные камни:** превью (лайтбокс) открывается только для image/pdf; для остального клик по заголовку = скачивание (стр. 72). Все цвета — литералы (`#0F172A`, `#64748B`), при перетемизации не подхватятся. `onPreview`/`onDownload`/`onDelete` опциональны (`?.`) — родитель решает набор действий.
- **Строк:** 159

## `frontend/src/components/documents/DocumentUploadModal.jsx`
- **Назначение:** Модалка загрузки медицинского документа (Глава 9): drag&drop / file-picker, поля категория/название/описание/видимость, прогресс-бар на «сыром» `XMLHttpRequest` (не axios — нужен upload progress).
- **Ключевые элементы:** дефолтный экспорт `DocumentUploadModal({ open, initialFile, uploadUrl, onClose, onUploaded })`; константы `MAX_SIZE` (20 МБ), `ALLOWED_EXT`, `ALLOWED_MIME_HINT`, `CATEGORIES`, `VISIBILITIES`; helper `extOf`; `handleFile()` (валидация), `onDrop()`, `submit()` (XHR с `upload.onprogress`), `cancelUpload()`.
- **Зависимости:** дизайн-система `Modal`, `Button`. **НЕ использует `api`** — URL загрузки приходит готовым пропом `uploadUrl` (со встроенным `?t=...`), запрос идёт через нативный `XMLHttpRequest` (стр. 116-145). Material Symbols.
- **Где менять для типовых задач:** изменить лимит размера — `MAX_SIZE` (стр. 22). Разрешённые типы — `ALLOWED_EXT` + `ALLOWED_MIME_HINT` (стр. 23-24). Категории — `CATEGORIES` (стр. 26-34, синхронь с `DocumentCard`). Уровни видимости — `VISIBILITIES` (стр. 36-40, здесь их 3, а в `DocumentCard.VIS_LABEL` — 4: добавлен `clinic`).
- **Подводные камни:** **рассинхрон видимостей** — модалка предлагает только `private/doctors/admins`, а `DocumentCard` умеет отрисовать ещё и `clinic`. XHR не несёт авто-токен axios — авторизация целиком на `uploadUrl` (`?t=token`); если родитель не подставил токен — 401. `413` маппится в «Файл слишком большой» (стр. 138). Закрытие во время загрузки = `cancelUpload()` (abort), стр. 150.
- **Строк:** 340

## `frontend/src/components/documents/ImageLightbox.jsx`
- **Назначение:** Полноэкранный оверлей просмотра документа (Глава 9): `<img>` для картинок, `<iframe>` для PDF, заглушка для остального. Закрытие по фону/Esc/кнопке, блокировка скролла body.
- **Ключевые элементы:** дефолтный экспорт `ImageLightbox({ open, doc, onClose, onDownload })`; единственный `useEffect` — Esc-листенер + `body.style.overflow='hidden'` с восстановлением; флаги `isImage`/`isPdf`; источник `url = doc.file_url || doc.url`.
- **Зависимости:** только React. Material Symbols. Hex-цвета захардкожены.
- **Где менять для типовых задач:** поддержать новый тип превью — добавить ветку рядом с `isImage`/`isPdf` (стр. 80-95). Поменять ограничение ширины PDF — `maxWidth: 1200` (стр. 93). Поведение закрытия — `useEffect` стр. 18-29.
- **Подводные камни:** очень высокий `z-[2000]` (стр. 39) — перекрывает всё, включая модалки; следить за конфликтами слоёв. Восстанавливает `document.body.style.overflow` в предыдущее значение (стр. 23, 27) — корректно при вложенности. Поле URL читается из `file_url` ИЛИ `url` — backend должен отдавать одно из них.
- **Строк:** 120

## `frontend/src/components/family/AcceptInviteModal.jsx`
- **Назначение:** Модалка приёма invite-токена и присоединения к чужой семейной группе. Используется на онбординге, когда у пользователя ещё нет своей группы, но есть приглашение.
- **Ключевые элементы:** дефолтный экспорт `AcceptInviteModal({ onClose, onJoined, sessionToken })`; константа `SESSION_KEY = 'clinika_patient_session'`; `useEffect` автоподтягивает токен из URL (`?token=` / `?invite_token=`); `submit()`.
- **Зависимости:** **`axios` напрямую** + `API_BASE` из `../../config` + `useToast` из `../../design`. **Не использует общий `api`** — это пациентский публичный контур. `POST {API_BASE}/patient/family/accept-invite` с body `{ token }` и query `{ t: sessionToken }`.
- **Где менять для типовых задач:** изменить параметры URL для deep-link — `useEffect` стр. 26-32. Поменять эндпоинт/тело — `submit` стр. 40. Сессионный ключ localStorage — `SESSION_KEY` (стр. 16, общий с `AddMemberModal`).
- **Подводные камни:** два разных токена в одном запросе — **invite-токен** идёт в body, **сессионный** (`t`) в query: не перепутать. Сессия читается из `localStorage['clinika_patient_session']` (отдельно от axios-инстанса `api`). Своя реализация модала (фикс-оверлей + `@keyframes` инлайном), не `Modal` из DS. Цвета захардкожены.
- **Строк:** 101

## `frontend/src/components/family/AddMemberModal.jsx`
- **Назначение:** Модалка добавления родственника в семейную группу. Если backend нашёл пациента по телефону → сразу добавлен; если нет → создаётся приглашение, и модалка показывает копируемый deep-link.
- **Ключевые элементы:** дефолтный экспорт `AddMemberModal({ onClose, onAdded, sessionToken })`; helpers `formatPhone(raw)` (маска `+7 (XXX) XXX-XX-XX`), `phoneDigits(masked)`, `buildBirthDate()`; константы `MONTHS_RU`, `RELATIONS` (8 типов), `SESSION_KEY`; `useMemo` для `years`/`days`; флаг `canSubmit`; стейт `inviteResult` (двойной режим формы/результата); `submit()`, `copyLink()`.
- **Зависимости:** **`axios` напрямую** + `API_BASE` + `useToast`. `POST {API_BASE}/patient/family/invite` body `{ full_name, phone, relation, birth_date? }`, query `{ t: token }` → `{ status: 'added'|'pending_invite', invite_token? }`.
- **Где менять для типовых задач:** добавить тип родства — `RELATIONS` (стр. 42-51, синхронь с `FamilyMemberCard.RELATION_META`). Поменять маску телефона — `formatPhone` (стр. 22-34). Шаблон deep-link — стр. 106 (`${origin}/family/accept?token=...`). Валидация — `canSubmit` (стр. 80, требует ≥2 символов ФИО и ровно 11 цифр телефона).
- **Подводные камни:** телефон нормализуется к 11 цифрам с ведущей `7` (8→7), отправляется как `'+' + phoneDigits` (стр. 97). Дата рождения собирается из трёх селектов в `YYYY-MM-DD`, опциональна. При `pending_invite` модалка **намеренно не закрывается** (стр. 108) — надо показать ссылку. `copyLink` через `navigator.clipboard` с фолбэком на тост (стр. 121-129). Опять отдельный сессионный токен из localStorage, свой модал-layout.
- **Строк:** 280

## `frontend/src/components/family/FamilyMemberCard.jsx`
- **Назначение:** Карточка одного члена семьи в `PatientFamilySection`: аватар с инициалами, бейдж родства (кликабельный для смены), возраст, 3 чекбокса прав, кнопки «Переключиться»/«Удалить».
- **Ключевые элементы:** дефолтный экспорт `FamilyMemberCard({ member, onPermChange, onRelationChange, onSwitch, onRemove })`; внутренний `PermRow`; helpers `getRelationMeta`, `computeAge(birthDate)`, `ageLabel(age)` (русская плюрализация год/года/лет), `initialsOf(name)`; константы `RELATION_META` (9 типов с цветами/иконками), `RELATIONS_LIST`; стейт `relationOpen` (раскрытие списка родства).
- **Зависимости:** только React. Material Symbols. Hex-цвета захардкожены. **Никаких запросов** — всё через колбэки родителю.
- **Где менять для типовых задач:** добавить тип родства — `RELATION_META` (стр. 23-33) + `RELATIONS_LIST` (стр. 35); синхронь с `AddMemberModal.RELATIONS`. Добавить право — новый `<PermRow>` (образец стр. 165-185) + поле в `member` + обработка в родителе через `onPermChange`. Логика возраста/плюрализации — `computeAge`/`ageLabel` (стр. 42-62).
- **Подводные камни:** для `is_self` все права принудительно `true` и `disabled` (нельзя ограничить себя, стр. 168-184), кнопки действий скрыты. Права (`can_view_records`, `can_book_appointments`, `can_manage_payments`) приходят в `member` — компонент только отображает и эмитит изменения, **не сохраняет** (это родитель). Смена родства мгновенно вызывает `onRelationChange` и закрывает список (стр. 148).
- **Строк:** 209

## `frontend/src/components/inventory/InventoryImportWizard.jsx`
- **Назначение:** 5-шаговый мастер импорта складских остатков из выгрузки 1С (Excel/CSV) на странице `ManagerInventory`: файл → маппинг колонок → параметры → превью → выполнение с отчётом.
- **Ключевые элементы:** дефолтный экспорт `InventoryImportWizard({ open, onClose, onDone })`; подкомпонент `Stat`; внутренние рендереры `StepperHeader`, `StepContent`, `FooterButtons`; константы `TARGET_FIELDS` (11 целевых полей, 3 обязательных), `CATEGORY_OPTIONS`, `STRATEGY_OPTIONS` (skip/update/replace); helpers `fmtSize`, `todayISO`, `mapRow`; `uploadPreview()`, `executeImport()`; `useMemo` `missingRequired`.
- **Эндпоинты (потребляемые):**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/manager/clinics-accessible` | управляющий | — | массив клиник | Список клиник для назначения импорта |
  | POST | `/inventory/import/preview` | управляющий | multipart `file`, `sheet_name?` | `{headers, preview_rows, sheets, warnings, total_rows, suggested_mapping}` | Парсинг файла + авто-маппинг |
  | POST | `/inventory/import/execute` | управляющий | multipart `file`, `mapping(JSON)`, `clinic_id`, `existing_strategy`, `default_category`, `default_vendor?`, `income_date?`, `sheet_name?` | `{rows_total, rows_created, rows_updated, rows_skipped, rows_failed, errors[]}` | Выполнить импорт |

- **Зависимости:** `api` (multipart). Дизайн-система `Modal`, `Button`, `useToast` (с фолбэком на `alert`, стр. 72). CSS-переменные темы.
- **Где менять для типовых задач:** добавить целевое поле импорта — `TARGET_FIELDS` (стр. 27-39, ключ уйдёт в `mapping`, должен совпадать с backend-парсером). Стратегии слияния — `STRATEGY_OPTIONS` (стр. 49-53). Категории товара — `CATEGORY_OPTIONS` (стр. 41-47). Названия шагов — массив `STEPS` (стр. 193-195).
- **Подводные камни:** файл загружается **дважды** — отдельно на preview и отдельно на execute (стр. 124-126 и 147), пользователь не должен подменять файл между шагами. Маппинг сериализуется в JSON-строку в FormData (стр. 148). `clinic_id` может быть `id` ИЛИ `tenant_id` — берётся первое непустое (стр. 113, 361) — потенциальный источник путаницы тенантов. Обязательные поля проверяются только на фронте (`missingRequired`) — backend должен валидировать повторно. Авто-маппинг (`suggested_mapping`) приходит с backend и его можно переопределить вручную.
- **Строк:** 635

## `frontend/src/components/lab/LabOrderForm.jsx`
- **Назначение:** Модальная форма создания заявки на лабораторные анализы (Глава 10) в `DoctorLabOrdersSection`: поиск пациента с debounce, выбор провайдера-лаборатории, мульти-выбор тестов (пресет + произвольные коды), комментарий.
- **Ключевые элементы:** дефолтный экспорт `LabOrderForm({ open, onClose, onCreated, providers, api })`; константа `PRESET_TESTS` (12 популярных тестов код→название); стейт пациента/провайдера/кодов; `useEffect` сброса при закрытии и `useEffect` поиска пациента (debounce 300мс, флаг `alive`); `toggleCode`, `addCustom`; `useMemo` `canSubmit`; `submit()`.
- **Эндпоинты (потребляемые):**

  | Метод | Путь | Доступ/роль | Принимает | Возвращает | Назначение |
  |-------|------|-------------|-----------|------------|------------|
  | GET | `/admin/patients/search?q=&limit=8` | врач/админ | query | массив `{id, full_name, phone}` | Поиск пациента (debounce) |
  | POST | `/doctor/lab-orders` | врач | `{patient_id, provider_id, test_codes[], notes?}` | объект заявки | Создать заявку на анализы |

- **Зависимости:** **`api` приходит пропом** (а не импортируется) — гибкость инстанса. Дизайн-система `Modal`, `Button`, `Chip`, `useToast`. `providers` тоже проп от родителя.
- **Где менять для типовых задач:** расширить пресет тестов — `PRESET_TESTS` (стр. 22-35, коды произвольные, backend принимает любые). Поменять эндпоинт поиска пациента — `api.get('/admin/patients/search'...)` (стр. 69, в комментарии отмечено что можно вынести в проп `onSearchPatients`). Тело заявки — `submit` (стр. 99-104). Условие отправки — `canSubmit` (стр. 90-93).
- **Подводные камни:** `toast` вызывается объектным API `toast({ kind, text })` (стр. 105) — **отличается** от `toast(msg, 'success')` в `family/*` файлах: разные сигнатуры `useToast` в кодовой базе, при копипасте легко ошибиться. `provider_id` приводится к `Number` (стр. 101) — селект отдаёт строку. Произвольные коды апперкейзятся (стр. 84). Поиск пациента деградирует молча при ошибке (стр. 71). `api` обязателен в пропах — без него форма упадёт.
- **Строк:** 291
