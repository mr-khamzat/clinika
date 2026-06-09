# pages [02] — кабинеты (врач/директор), чат-админка, публичный лендинг + создание направления

Группа из 12 React-страниц (`frontend/src/pages/`) — это **верхнеуровневые экраны**, которые монтируются роутером (`App.jsx`/`AdminRoot`) и собирают данные через API, оборачивая их в дизайн-систему. Здесь смешаны несколько разнородных слоёв:

- **Лейауты кабинетов** — `DoctorLayout.jsx` (1526 строк, кабинет врача с 12 секциями) и `DirectorLayout.jsx` (read-only кабинет директора сети, period-context + side/bottom-nav). Это самые тяжёлые и самые важные файлы группы.
- **Бизнес-форма** — `CreateReferral.jsx` (создание межклинического направления; форма переиспользуется как страница `/arc/create` и как inline-модалка в кабинете врача).
- **Чат-админка** — `ChatRoles.jsx` (группы/broadcast-каналы) и `ChatSettings.jsx` (глобальные настройки чата для super_admin/franchise_owner).
- **Дашборд сотрудника** — `Dashboard.jsx` (баланс бонусов, KPI, последние направления для партнёра/админа).
- **Публичные/служебные** — `ClinicPage.jsx` (витрина клиники с рейтингом врачей и записью), `Franchise.jsx` (лендинг франшизы), `ConsentForm.jsx` (юридический текст согласия 152-ФЗ), `ClinicSchedules.jsx` (расписание клиник для менеджера).
- **Дизайн/превью (служебное, не прод)** — `DesignSystem.jsx` (витрина компонентов `/design-system`) и `DesignPreview2.jsx` (iframe-просмотр HTML-макетов).

Два архитектурных факта пронизывают группу: (1) `DoctorLayout` и `CreateReferralForm` рендерятся в **AdminRoot вне `BrowserRouter`**, поэтому НЕ используют `useNavigate`/`useSearchParams` — навигация идёт через `window.location.assign('/' + SLUG + ...)`; (2) часть страниц использует premium-дизайн-токены из `../design` (CSS-переменные `--accent`, `--fg`, `--bg-1`…), а часть — захардкоженные hex/oklch и Tailwind-классы (`Dashboard.jsx`, `ClinicSchedules.jsx`, `ClinicPage.jsx`).

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `ChatRoles.jsx` | Управление группами и broadcast-каналами чата | 394 |
| `ChatSettings.jsx` | Глобальные настройки чата (TTL, TG, inter-clinic) | 277 |
| `ClinicPage.jsx` | Публичная витрина клиники: врачи, отзывы, запись | 498 |
| `ClinicSchedules.jsx` | Менеджер: расписание и данные клиник | 234 |
| `ConsentForm.jsx` | Текст согласия на обработку ПДн (152-ФЗ) | 68 |
| `CreateReferral.jsx` | Создание межклинического направления (page+modal) | 1032 |
| `Dashboard.jsx` | Дашборд сотрудника: бонусы, KPI, направления | 331 |
| `DesignPreview2.jsx` | iframe-просмотр HTML-макетов дизайн-бандла | 81 |
| `DesignSystem.jsx` | Витрина компонентов дизайн-системы | 345 |
| `DirectorLayout.jsx` | Лейаут read-only кабинета директора сети | 407 |
| `DoctorLayout.jsx` | Лейаут кабинета врача, 12 секций | 1526 |
| `Franchise.jsx` | Публичный лендинг франшизы + ROI-калькулятор | 520 |

---

## `frontend/src/pages/ChatRoles.jsx`
- **Назначение:** Админ-страница (Phase 3 чата) для создания кастомных групповых чатов и broadcast-каналов, управления участниками, переименования и удаления групп.
- **Ключевые элементы:**
  - `export default function ChatRoles()` — корневой компонент: грузит группы + контакты, рендерит сетку карточек групп.
  - Внутренние функции-обработчики: `loadAll()`, `createGroup({name, member_ids, broadcast})`, `addMembers(room, user_ids)`, `deleteGroup(room)`, `renameGroup(room)` (через `prompt`), `removeMember(room, user_id)`, `flash(msg)` (toast на 2с).
  - `CreateGroupModal({contacts, onClose, onSubmit})` — модалка создания: имя, флаг broadcast, поиск + чек-бокс участников (`Set` selected).
  - `AddMembersModal({room, contacts, onClose, onSubmit})` — модалка добавления, фильтрует уже добавленных по `existingIds`.
  - `CR_CSS` — большой inline-`<style>` с CSS-переменными на `oklch`.
- **Эндпоинты:** не роутер (фронт). Дёргает API:
  | Метод | Путь | Назначение |
  |-------|------|-----------|
  | GET | `/admin/chat/groups` | список групп пользователя |
  | GET | `/staff-chat/contacts` | контакты (сгруппированы по клиникам) для пикера |
  | POST | `/admin/chat/groups` | создать группу/канал (`{name, member_ids, broadcast}`) |
  | POST | `/admin/chat/groups/{id}/members` | добавить участников |
  | DELETE | `/admin/chat/groups/{id}` | удалить группу целиком |
  | PATCH | `/admin/chat/groups/{id}` | переименовать (`{name}`) |
  | DELETE | `/admin/chat/groups/{id}/members/{user_id}` | удалить участника |
- **Зависимости:** `../api` (axios-инстанс с auto-Bearer). Никаких внешних компонентов — всё inline.
- **Где менять для типовых задач:** новое поле группы (например, аватар канала) → `createGroup` + `CreateGroupModal`; права на удаление участника → блок `g.is_admin && m.member_role !== 'admin'`; стиль карточек → `CR_CSS`.
- **Подводные камни:** использует нативные `alert`/`confirm`/`prompt` (в отличие от премиум-страниц с `useToast`/`Modal`) — это легаси-паттерн внутри новой Phase 3. Видимость кнопок управления завязана на флаг `g.is_admin`, приходящий с бэка; tenant-фильтрация целиком на сервере (фронт верит `contacts.groups`).
- **Строк:** 394

---

## `frontend/src/pages/ChatSettings.jsx`
- **Назначение:** Страница глобальных настроек чата (Phase 2). Только для super_admin / franchise_owner. Управляет TTL файлов, лимитом размера, inter-clinic режимом и Telegram-уведомлениями.
- **Ключевые элементы:**
  - `export default function ChatSettings()` — грузит `GET /admin/chat-settings`, рендерит 3 секции (Файлы / Inter-clinic / Telegram). Сохранение мгновенное (autosave на каждое изменение поля через `save(field, value)`).
  - `LABELS` — словарь имя-поля → человекочитаемая подпись (для toast).
  - Вспомогательные компоненты: `Field`, `ToggleField` (тумблер), `NumberInput` (степпер + локальный стейт с commit на blur), `FieldPresets` (быстрые значения-пилюли), `LoadingState`, `ErrorState`.
  - `CS_CSS` — inline-стили (oklch-токены `--cs-*`).
- **Эндпоинты:** не роутер. API:
  | Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
  |-------|------|--------|-----------|-----------|-----------|
  | GET | `/admin/chat-settings` | super_admin / franchise_owner | — | объект настроек | загрузка текущих значений |
  | PUT | `/admin/chat-settings` | super_admin / franchise_owner | `{[field]: value}` (одно поле) | обновлённый объект | сохранение одного параметра |
- **Зависимости:** `../api`.
- **Где менять для типовых задач:** добавить новый параметр чата → добавить ключ в `LABELS`, новый `Field`/`ToggleField` в нужную секцию, серверная схема обязана принять это поле в PUT. Изменить пресеты TTL/размера → массивы `presets` в JSX.
- **Подводные камни:** PUT отправляет один ключ за раз — бэк должен делать частичное обновление (PATCH-семантика на PUT). Все TG-тумблеры дизейблятся через `disabled={saving || !s.tg_notifications_enabled}` — глобальный switch гейтит остальные. Никакой явной защиты по роли на фронте — полагается на 403 от бэка.
- **Строк:** 277

---

## `frontend/src/pages/ClinicPage.jsx`
- **Назначение:** Публичная (без auth) мобильная витрина клиники по маршруту `/{slug}/clinic` — рейтинг и карточки врачей, отзывы, быстрая запись и отправка отзыва.
- **Ключевые элементы:**
  - `export default function ClinicPage()` — грузит `GET /public/{SLUG}/clinic`, две вкладки (`doctors`/`reviews`), фильтр по специальности, сортировка врачей (сначала `has_schedule`).
  - Презентационные хелперы: `fmt(iso)`, `isoDate(d)`, `Stars`, `StarSelect`, `Avatar` (инициалы или фото), `RatingBar`, `Modal` (bottom-sheet).
  - `ReviewForm({doctorId, tenantId, primary, ...})` — отправка отзыва (`POST /reviews`), поддержка анонимности.
  - `QuickBook({doctor, slug, primary, ...})` — мастер записи: выбор даты (14 дней) → слотов → ввод имени/телефона → бронь; показывает QR/код после успеха.
  - `DoctorCard({doc, ...})` — карточка врача с раскрываемым профилем (lazy-грузит `GET /public/{slug}/doctors/{id}/profile`).
- **Эндпоинты:** не роутер. Публичный API (через **прямой `axios`**, не `../api`):
  | Метод | Путь | Назначение |
  |-------|------|-----------|
  | GET | `/public/{slug}/clinic` | агрегат витрины (tenant, branding, clinics, doctors, reviews) |
  | GET | `/public/{slug}/doctors/{id}/slots?date=` | свободные слоты на дату |
  | GET | `/public/{slug}/doctors/{id}/profile` | профиль врача + разбивка оценок |
  | POST | `/public/{slug}/book` | создать запись (имя/телефон/дата/слот) |
  | POST | `/reviews` | отправить отзыв (`doctor_id, tenant_id, rating, comment, ...`) |
- **Зависимости:** `axios` (прямой импорт!), `API_BASE` и `SLUG` из `../config`. Не использует `../api` и `../design` — полностью автономная (нужна для публичного рендера).
- **Где менять для типовых задач:** добавить поле в карточку врача → `DoctorCard`; новые поля брони → `QuickBook.book()` payload; брендовый цвет берётся из `branding.primary_color` (fallback `#0097A7`).
- **Подводные камни:** **Не использует `../api`** — токены и refresh не работают (это намеренно, страница публичная). `tenant_id` нигде на фронте не фильтруется — сервер отдаёт уже отфильтрованный по slug агрегат. Все стили — inline hex (не дизайн-токены), отдельная цветовая система от премиум-кабинетов.
- **Строк:** 498

---

## `frontend/src/pages/ClinicSchedules.jsx`
- **Назначение:** Страница менеджера: выбор клиники, редактирование её данных (имя/адрес/телефон) и недельного расписания работы (7 дней, тумблер активности + время открытия/закрытия).
- **Ключевые элементы:**
  - `export default function ClinicSchedules()` — грузит список клиник, по выбору загружает расписание; два независимых блока сохранения: `handleSaveClinic()` (данные клиники) и `handleSave()` (расписание).
  - `defaultSchedule()` — 7 дней, все активны 09:00–18:00 по умолчанию.
  - `handleSelectClinic(clinic)`, `updateDay(idx, field, value)`.
  - Константы `DAY_NAMES`, `DAY_SHORT`.
- **Эндпоинты:** не роутер. API:
  | Метод | Путь | Назначение |
  |-------|------|-----------|
  | (helper) | `listManagerClinics()` | список клиник менеджера |
  | (helper) | `updateClinic(id, {name,address,phone})` | сохранить данные клиники |
  | GET | `/clinics/{id}/schedule` | загрузить расписание клиники |
  | PUT | `/clinics/{id}/schedule` | сохранить расписание (массив из 7 дней) |
- **Зависимости:** `../api` (`api`, именованные `listManagerClinics`, `updateClinic`), `useNavigate` из `react-router-dom`. Стили — Tailwind-классы (`bg-primary`, `rounded-2xl`).
- **Где менять для типовых задач:** дефолтные часы работы → `defaultSchedule()`; добавить поле клиники (например, email) → `clinicEdit` стейт + `handleSaveClinic` payload + `updateClinic` на бэке; формат `day_of_week` (0=Пн) синхронизирован с `DAY_NAMES`.
- **Подводные камни:** использует `react-router-dom` → значит работает в обычном Router-контексте (НЕ в AdminRoot, в отличие от DoctorLayout). `day_of_week` индексируется 0=Понедельник (не как JS `Date.getDay()` где 0=Вс) — расхождение с `ClinicPage`/`CreateReferral`, где идёт пересчёт `(getDay()+6)%7`. Расписание сохраняется как сырой массив без преобразований.
- **Строк:** 234

---

## `frontend/src/pages/ConsentForm.jsx`
- **Назначение:** Статическая юридическая страница `/consent` — текст согласия пациента на обработку персональных данных по ст. 9 ФЗ-152. Показывается при первом входе пациента, версия фиксируется в `ConsentRecord` (append-only) на бэке.
- **Ключевые элементы:**
  - `export default function ConsentForm()` — рендерит `<LegalPage>` с заголовком и 5 разделами (перечень данных, способы обработки, срок, отзыв, передача третьим лицам).
  - Константы `updated` (`'08 мая 2026'`) и `POLICY_VERSION` (`'2026.05.08'`) — версия меняется вручную при правке текста и хранится в БД.
- **Эндпоинты:** нет (чистая разметка).
- **Зависимости:** `../components/legal/LegalPage` — единая обёртка юридических страниц (заголовок, дата, типографика, токены `--fg-3`).
- **Где менять для типовых задач:** правка текста согласия → отредактировать JSX-разделы И **поднять `POLICY_VERSION`** (иначе бэк не отметит, что пациент согласился с новой редакцией). Плейсхолдеры `[ОПЕРАТОР: ...]`, `[EMAIL]` нужно заменить на реальные реквизиты оператора.
- **Подводные камни:** в тексте остались незаполненные плейсхолдеры (`[ОПЕРАТОР]`, `[EMAIL]`) — это не TODO в коде, а часть шаблона; перед прод-запуском обязательно подставить. Версия `POLICY_VERSION` — единственная связь с БД; забыть её обновить = пациенты считаются согласными со старой версией.
- **Строк:** 68

---

## `frontend/src/pages/CreateReferral.jsx`
- **Назначение:** Создание межклинического направления пациента. Один из ключевых бизнес-экранов. Содержит переиспользуемую форму `CreateReferralForm` (работает и как страница `/arc/create`, и как inline-модалка в кабинете врача) + страничный wrapper `CreateReferral`.
- **Ключевые элементы:**
  - `export function CreateReferralForm({mode='modal', initialPhone, initialName, onSuccess, onClose})` — вся бизнес-логика и JSX формы. Шаги: Пациент (телефон + проверка в МИС + ФИО) → [Клиника-отправитель, только менеджер] → Услуга (с категориями/поиском и бейджем выплаты) → Клиника назначения (cross-tenant optgroup) → Время приёма (доступные даты из расписания) → [Врач МИС] → Примечание → Submit.
  - `export default function CreateReferral()` — wrapper: `Page` + `PageHeader` + кнопка «Назад» (`useNavigate`), читает `patient_phone`/`patient_name` из `useSearchParams`, рендерит форму в `mode="page"`.
  - Утилиты: `getAvailableDates(schedule)` (14 дат на 30 дней вперёд, пересчёт `(getDay()+6)%7`), `formatDateShort`, локальные шаблоны в localStorage (`loadTemplates`/`saveTemplates`, ключ `clinika_referral_templates`).
  - Микрокомпоненты: `MIcon`, `SectionIcon`, `FieldLabel`; стили инпутов через `FIELD_BASE` + `focusOn`/`focusOff` (токены вместо hex).
  - Серверные шаблоны: `applyServerTemplate(tpl)` через `POST /manager/referral-templates/{id}/use`.
- **Эндпоинты:** не роутер. API:
  | Метод | Путь | Назначение |
  |-------|------|-----------|
  | (helper) | `getClinics()` | список клиник (своих + cross-tenant) |
  | (helper) | `getClinicServices(id)` | услуги клиники назначения |
  | GET | `/clinics/{id}/schedule` | расписание для доступных дат |
  | GET | `/mis/doctors` | врачи МИС (фильтр по `clinic_mis_id`) |
  | (helper) | `verifyPatientInMis(phone)` | поиск пациента в МИС по телефону |
  | (helper) | `createReferral(payload)` | создать направление |
  | GET | `/manager/referral-templates` | серверные шаблоны |
  | POST | `/manager/referral-templates/{id}/use` | применить шаблон (инкремент usage) |
- **Зависимости:** `../api` (helpers `getClinics`, `getClinicServices`, `createReferral`, `verifyPatientInMis` + `api`), `../config` (`SLUG`), `../store/auth` (`useAuthStore` — определяет `isManager`), `../design` (`Page, PageHeader, Card, Chip, Button, Modal, useToast`), `react-router-dom` (только во wrapper'е). **Импортируется в `DoctorLayout.jsx`** (`ReferralsPage`) как inline-модалка.
- **Где менять для типовых задач:** новое поле направления → `form` стейт + `handleSubmit` payload + `createReferral`; логика выплаты партнёру → блок `selectedPayout` (`referral_payout ?? bonus_amount`); добавление шага формы → новый `<Card>` в JSX; различие менеджер/партнёр → флаг `isManager = user?.role === 'manager' && !user?.clinic_id`.
- **Подводные камни:** **КРИТИЧНО** — внутренний `CreateReferralForm` НЕ использует `useNavigate`/`useSearchParams`, навигация на QR через `window.location.assign('/' + SLUG + '/qr/' + id)` (`goToQr`), потому что рендерится в AdminRoot вне BrowserRouter (см. memory `feedback_admin_root_no_router`). Замена нативного `prompt` на `Modal` (`tplPromptOpen`) и `alert` на `useToast` — премиум-паттерн. Суммы форматируются через `Number(...).toLocaleString('ru-RU')` — возможны float-значения с бэка (бонусы); явного Decimal-контроля на фронте нет. `day_of_week` пересчёт `(d.getDay()+6)%7` — обязателен, т.к. бэк хранит 0=Пн.
- **Строк:** 1032

---

## `frontend/src/pages/Dashboard.jsx`
- **Назначение:** Главный дашборд сотрудника (партнёр-врач / админ): баланс бонусов, мини-статистика дня, сетка быстрых действий, прогресс KPI, статистика месяца, последние 5 направлений.
- **Ключевые элементы:**
  - `export default function Dashboard()` — грузит параллельно 5 источников; ветвится по `isPartner = user?.role === 'partner_doctor'` (у партнёра другой набор быстрых действий: «Записать» вместо «Направление»+«Сканер»).
  - `STATUS_LABELS` / `STATUS_STYLE` — словари статусов направлений → подпись/Tailwind-классы.
  - `getTodayLabel()` — дата по-русски.
  - Навигация через `useNavigate` (обычный Router).
- **Эндпоинты:** не роутер. API:
  | Метод | Путь | Назначение |
  |-------|------|-----------|
  | (helper) | `getBonusSummary()` | баланс/ожидающие бонусы |
  | GET | `/admins/me/stats` | статистика (this/last/all-time month, today) |
  | GET | `/admins/me/kpi` | KPI-цели и текущий прогресс |
  | (helper) | `getIncomingReferrals()` | входящие (для бейджа `incomingCount` по `status==='created'`) |
  | GET | `/referrals?limit=5` | последние направления |
- **Зависимости:** `../api` (helpers `getBonusSummary`, `getIncomingReferrals` + `api`), `../store/auth` (`useAuthStore`), `react-router-dom` (`useNavigate`). Стили — Tailwind + захардкоженные hex (`#1565c0`, `#191c1e`…).
- **Где менять для типовых задач:** набор быстрых действий → блоки внутри тернарника `isPartner ? ... : ...`; новый статус направления → `STATUS_LABELS` + `STATUS_STYLE`; KPI-прогресс → блок `kpi?.has_target`.
- **Подводные камни:** все 5 запросов с независимыми `.catch(() => {})` — частичный отказ не ломает страницу, но и не сигнализирует об ошибке. Цвета захардкожены (не дизайн-токены) — расходится с премиум-кабинетами. Бонусы (`summary.total_pending`, `bonus_amount`) выводятся без форматирования — потенциальный float с бэка. Маршруты в `nav('/create')`, `nav('/scan')` и т.д. — относительные (работает в Router-контексте).
- **Строк:** 331

---

## `frontend/src/pages/DesignPreview2.jsx`
- **Назначение:** Служебная страница для разработчиков/дизайнеров: просмотр HTML-макетов второго дизайн-бандла (`/public/design2/*.html`) в iframe с переключалкой вкладок. Не прод-функционал.
- **Ключевые элементы:**
  - `export default function DesignPreview2()` — стейт `active`, рендерит iframe `${BASE_PATH}/design2/{file}`.
  - `TABS` — массив макетов (patient, doctor, admin, manager, klinikset) с иконкой и note.
- **Эндпоинты:** нет.
- **Зависимости:** `BASE_PATH` из `../config`. Статические HTML-файлы в `frontend/public/design2/`.
- **Где менять для типовых задач:** добавить макет → новый элемент в `TABS` + положить html в `public/design2/`.
- **Подводные камни:** служебная страница, доступ только для своих; мобильные макеты (patient android/iOS) намеренно опущены. Зависит от наличия файлов в `public/design2/` — если их нет, iframe пустой.
- **Строк:** 81

---

## `frontend/src/pages/DesignSystem.jsx`
- **Назначение:** Витрина (storybook-lite) дизайн-системы по маршруту `/design-system` — демонстрирует все базовые компоненты из `../design` и цветовые токены. Доступ: super_admin. Источник истины — design-preview-2.
- **Ключевые элементы:**
  - `export default function DesignSystem()` — переключатель темы light/dark (`theme` стейт, прокидывается в `<Page theme>`), демо Modal (3 размера), демо Toast (`useToast`), демо Tabs.
  - Секции: цветовые токены (массив `--accent`/`--bg`/… превью-плашек), KPI, кнопки, чипы, tabs, аватары, sparkline, empty-state, modal, toast.
- **Эндпоинты:** нет.
- **Зависимости:** `../design` — практически весь публичный API дизайн-системы (`Page, PageHeader, Card, KpiCard, KpiRow, Chip, Button, Tabs, Avatar, EmptyState, Sparkline, Modal, useToast`). Полезна как **живой справочник** доступных компонентов.
- **Где менять для типовых задач:** добавили новый компонент в `../design` → добавить демо-секцию сюда; новый цветовой токен в `tokens.css` → добавить в массив превью.
- **Подводные камни:** чисто демонстрационная, без данных и API. Тема переключается локально через prop `theme` (а не через глобальный `useTheme` как в кабинетах) — это изолированное демо.
- **Строк:** 345

---

## `frontend/src/pages/DirectorLayout.jsx`
- **Назначение:** Корневой layout read-only кабинета директора/руководителя сети. Sticky topbar (лого + имя франшизы + переключатель периода + аватар/logout), side-nav (desktop ≥1024px), bottom-nav (mobile), `<Outlet/>` для вложенных страниц аналитики (P&L, ДДС, KPI, маркетинг и т.д.).
- **Ключевые элементы:**
  - `export default function DirectorLayout()` — корневой; рендерит `PeriodContext.Provider` поверх `<Page>`.
  - `export const useDirectorPeriod()` / `PeriodContext` — **контекст периода**, доступен всем child-страницам (`period`, `from`, `to`, `setPeriod`, `setRange`).
  - `export const DIR_NAV` — карта 8 разделов (dashboard/pnl/cashflow/kpi/marketing/clinics/doctors/services).
  - `BOTTOM_KEYS` — 5 разделов в mobile bottom-nav + кнопка «Ещё» (drawer с остальными).
  - `PERIODS` + `computeRange(period)` — расчёт диапазона дат (today/week/month/quarter/year/custom).
  - Период персистится в `localStorage('director_period')`.
- **Эндпоинты:** не роутер. API:
  | Метод | Путь | Назначение |
  |-------|------|-----------|
  | GET | `/director/me` | профиль директора (`franchise_name`, `tenant_name`, `full_name`) |
- **Зависимости:** `../api`, `../design` (`Page`), `../store/auth` (`useAuthStore` — `user`, `logout`), `../config` (`SLUG`), `react-router-dom` (`Outlet, useNavigate, useLocation`). Стили — токены `--accent`/`--fg`/… + Tailwind.
- **Где менять для типовых задач:** новый раздел кабинета директора → добавить в `DIR_NAV` (+ опционально в `BOTTOM_KEYS`) + завести маршрут с этим `path` в роутере; новый период → `PERIODS` + ветка в `computeRange`; child-страницы читают период через `useDirectorPeriod()`.
- **Подводные камни:** активный раздел вычисляется по `loc.pathname` через `startsWith(n.path)` — порядок в `DIR_NAV` важен (длинные пути не должны затеняться `/director`). `deputy_director` отображается как «зам руководителя» (читает `user?.role`). Logout чистит `localStorage('clinika_token_' + SLUG)` и редиректит на `/' + SLUG + '/'`. Использует обычный `react-router-dom` (НЕ AdminRoot).
- **Строк:** 407

---

## `frontend/src/pages/DoctorLayout.jsx`
- **Назначение:** Самый большой файл группы — весь личный кабинет врача (premium-редизайн, light theme, teal accent) в одном файле: 12 секций навигации, sidebar (desktop) + bottom-nav (mobile) + drawer, профиль, переключатель темы, командная палитра, уведомления.
- **Ключевые элементы:**
  - `export default function DoctorLayout({adminToken, user, onLogout})` — корневой; стейт `route` (текущая секция), грузит `/my-doctor` и `/profile/me`, `renderRoute()` свитчит секции, защита `needBinding` (если врач не привязан — доступны только `referrals/earnings/rating/time/chat/lab`).
  - `NAV` — 12 пунктов (work: today/schedule/appointments/ai/patients/referrals/lab/chat; cabinet: earnings/rating/time/regulations). `MOBILE_NAV` — 5 для bottom-nav.
  - Секции-компоненты: `TodayPage` (KPI дня + расписание + кольцо прогресса), `SchedulePage` (обёртка `SlotBoardSection` в self-режиме), `AppointmentsPage` (фильтры + раскрытие документов пациента), `ReferralsPage` (список + inline-модалка `CreateReferralForm`), `PatientsPage` (группировка по пациенту из истории приёмов), `AIToolsPage` (Глава 6: briefing + treatment plan), `EarningsPage`/`RatingPage`/`TimePage` (визуал-каркасы «скоро»), `ChatPage` (переключатель «с пациентами»/«с клиникой» через iframe `/staff-chat`).
  - Микрокомпоненты: `MIcon`, `SectionHeader`, `RowKV`, `Hint`, `Spinner`, `NavItem`, `ChatModeTab`. Утилиты: `apiFetch`, `pluralize`, `formatTodayRu`.
  - lazy-секции: `RegulationsReaderSection`, `ClinicChatSection`, `DoctorPatientDocumentsSection`, `DoctorLabOrdersSection`.
- **Эндпоинты:** не роутер. API:
  | Метод | Путь | Назначение |
  |-------|------|-----------|
  | GET | `/my-doctor` | карточка врача (id, specialty, avg_rating, month_income) |
  | GET | `/profile/me` | личный профиль (avatar_url для шапки) |
  | GET | `/appointments?doctor_id=&date=&limit=` | приёмы (день/неделя/все/активные — варианты в секциях) |
  | GET | `/manager/referrals/?limit=` | направления врача |
- **Зависимости:** `../api`, `../config` (`SLUG`), `../design` (12 компонентов), **`./CreateReferral` (`CreateReferralForm`)** — ключевая внутренняя связь, `../sections/scheduling/{WeekScheduleSection,SlotBoardSection}`, `../components/doctor/{DoctorBriefingPanel,DoctorTreatmentPlanEditor}`, `../lib/useTheme`, `../components/{CommandPalette,NotificationsBell,ProfileModal}`, lazy-секции из `../sections/`.
- **Где менять для типовых задач:** новый раздел кабинета → добавить в `NAV` + новый case в `renderRoute()` + (опц.) в `MOBILE_NAV`/`allowedWithoutBinding`; изменить логику дня → `TodayPage`; источник направлений → `ReferralsPage`/`reload()`; интеграция новой AI-фичи → `AIToolsPage`.
- **Подводные камни:** **КРИТИЧНО** — рендерится в AdminRoot **вне BrowserRouter**, поэтому `useNavigate` бросает invariant; навигация через `window.location.assign('/' + SLUG + path)` (см. `ReferralsPage.nav` и memory `feedback_admin_root_no_router`). `ChatPage` передаёт токен в iframe через **URL hash** (`#access_token=...&refresh_token=...`), чтобы iframe не брал stale-токен из localStorage (был баг видимости чужого чата при смене аккаунта) — токен читается из `clinika_admin_token_{SLUG}` с fallback на `clinika_token_{SLUG}`. `apiFetch(m,u,_t,d)` игнорирует 3-й аргумент `_t` (токен) — всё на едином axios-инстансе с auto-Bearer; параметр оставлен для совместимости сигнатуры. `EarningsPage`/`RatingPage`/`TimePage` — заглушки с плейсхолдер-данными (`months = [218000,...]`), не настоящие данные. Доход/рейтинг форматируются `Number(...).toLocaleString` — потенциальный float.
- **Строк:** 1526

---

## `frontend/src/pages/Franchise.jsx`
- **Назначение:** Публичный (без auth) лендинг франшизы по маршруту `/franchise`: hero, 6 причин, условия партнёрства, статический ROI-калькулятор, форма заявки (POST `/contact/` с fallback на mailto), footer.
- **Ключевые элементы:**
  - `export default function Franchise()` — форма заявки (`form` стейт с honeypot `website_url`), `handleSubmit` (POST → fallback mailto), ROI-калькулятор (`roiClinics`/`roiRevenue` слайдеры → `royalty`/`platformCost`/`initialFee`/`expectedSavings`/`netGain`/`roiMonths`).
  - `Icon`/`ICONS` — inline SVG-иконки.
  - Данные-массивы: `REASONS` (6), `TERMS` (6).
  - `FRANCHISE_CSS` — большой inline-`<style>` (классы `ks-*`/`ks-fr-*`, переиспользует токены и общие классы из `Landing.jsx`).
- **Эндпоинты:** не роутер. API:
  | Метод | Путь | Назначение |
  |-------|------|-----------|
  | POST | `/contact/` | заявка франчайзи (`{name, phone, email, message, website_url}`); при ошибке — fallback `mailto:` |
- **Зависимости:** `axios` (прямой импорт), `API_BASE` из `../config`, `../components/BrandLogo`. Не использует `../api`/`../design` — автономная публичная страница.
- **Где менять для типовых задач:** условия франшизы → массив `TERMS`; причины → `REASONS`; формула ROI → блок расчёта (`royalty = totalRevenue * 0.03`, `platformCost = roiClinics * 24900 * 12` и т.д.); стили → `FRANCHISE_CSS`.
- **Подводные камни:** ROI-калькулятор полностью статический (хардкод коэффициентов 3% роялти, 250000₽ паушальный, 24900₽/мес подписка, 20% экономии) — при изменении тарифов цифры разъедутся с реальностью. Honeypot `website_url` — скрытое поле, заполнят только боты (бэк должен вернуть 403). Email-адрес в punycode (`franchise@xn--80aakbvaezg.xn--p1ai` = `franchise@клиниксеть.рф`). Использует прямой `axios` (не `../api`) — намеренно, публичная без токена.
- **Строк:** 520

---

### Сводка по рискам/связям группы
- **AdminRoot без Router:** `DoctorLayout.jsx` и `CreateReferralForm` (из `CreateReferral.jsx`) — навигация через `window.location.assign`, НЕ `useNavigate`. Остальные (`Dashboard`, `DirectorLayout`, `ClinicSchedules`) — обычный `react-router-dom`.
- **Две системы стилей:** премиум-токены `../design` (`CreateReferral`, `DoctorLayout`, `DirectorLayout`, `DesignSystem`) vs захардкоженные hex/Tailwind (`Dashboard`, `ClinicPage`, `ClinicSchedules`). При редизайне это разные правки.
- **Публичные страницы на прямом `axios`:** `ClinicPage.jsx`, `Franchise.jsx` — не `../api`, без токенов/refresh (намеренно).
- **Главная переиспользуемая связь:** `CreateReferral.jsx → CreateReferralForm` импортируется в `DoctorLayout.jsx` (inline-модалка направления). Менять форму — проверять оба места.
- **Несогласованность `day_of_week`:** бэк хранит 0=Пн; `CreateReferral` и `ClinicPage` делают пересчёт `(getDay()+6)%7`, `ClinicSchedules` работает с сырым индексом — при правке расписаний следить за конвенцией.
