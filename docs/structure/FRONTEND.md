# FRONTEND — премиальный обзор фронтенда «КлиникСеть»

> React 18 + Vite + Tailwind + Zustand + react-router-dom. Мультитенантная МИС/SaaS: один SPA обслуживает 7+ ролевых кабинетов и набор публичных страниц, разводя их по slug-у тенанта в URL.

Этот документ — карта верхнего уровня: маршрутизация по кабинетам, архитектурные слои (pages / sections / components / design), сетевой слой, состояние и темизация, и сквозной пример «от роута до рендера». Точечные детали по каждому файлу — в `ref/*.md` (ссылки расставлены по тексту).

Корневые файлы, на которые опирается весь обзор:
- `frontend/src/main.jsx` — точка входа: `createRoot`, `LocalErrorBoundary`, ленивая инициализация Sentry, глобальный импорт `design/tokens.css`.
- `frontend/src/App.jsx` — корневой диспетчер (`AppRouter`) + тенантное мини-приложение (`MiniApp`) + auth-гейт + lazy-реестр почти всех страниц.
- `frontend/src/config.js` — вычисление `SLUG`, `API_BASE`, `BASE_PATH`, `PLATFORM_MODE` из первого сегмента URL.

---

## 1. Мультитенантность: как один URL превращается в кабинет

Всё начинается с `frontend/src/config.js`. Slug тенанта — это **первый сегмент пути**, кроме зарезервированных (`admin`, `staff-chat`, `design-preview-2`, `design-preview`):

```
клиниксеть.рф/            → SLUG='',    API_BASE='/api'      (лендинг)
клиниксеть.рф/admin       → SLUG='',    API_BASE='/api'      (глобальная платформа super_admin, PLATFORM_MODE=true)
клиниксеть.рф/arc/...     → SLUG='arc', API_BASE='/arc/api'  (тенант arc)
клиниксеть.рф/imed/admin  → SLUG='imed',API_BASE='/imed/api' (панель тенанта imed)
```

Из `SLUG` выводятся и `API_BASE` (префикс всех REST-запросов), и имена ключей `localStorage` для токенов. Tenant-изоляция выполняется **на бэкенде по токену** — фронт почти нигде не передаёт `tenant_id` явно.

`App.jsx` — это **не один `<BrowserRouter>`**, а двухуровневый диспетчер:
1. `AppRouter()` смотрит на `window.location.pathname` и решает, какую крупную ветку монтировать (Wiki, лендинг, `/admin` глобальный, `/{slug}/p` пациент, `/{slug}/book`, telemed по токену, тенантное `MiniApp` и т.д.). Это «грубая» маршрутизация без react-router — обычные `if`-ы по `path`.
2. Внутри тенанта `MiniApp()` поднимает auth-гейт (см. §3) и единственный `<BrowserRouter basename={"/" + SLUG}>` с ролевыми `<Routes>`.

Важная архитектурная развилка: **панель `/admin` (`AdminRoot` → `AdminLayout`/кабинеты) рендерится ВНЕ `BrowserRouter`**. Поэтому кабинеты, монтируемые там (`DoctorLayout`, `OperationalCabinet`, `CreateReferralForm` и др.), не используют `useNavigate`/`useSearchParams` — навигация идёт через `window.location.assign('/' + SLUG + path)`. Это сквозной «подводный камень», проходящий через `ref/pages-01.md`, `ref/pages-02.md`, `ref/pages-07.md`.

---

## 2. Карта маршрутизации: кабинет → shell/layout → ключевые страницы → роль

«Shell/layout» — это оболочка кабинета (sidebar + topbar + nav), внутри которой рендерятся секции/страницы. В проекте уживаются **три механизма навигации**: react-router `<Routes>` (MiniApp, Director, Accountant), собственный `pushState`-роутер по `activeSection` (`AdminLayout`), и локальный `route`-state-switch (`DoctorLayout`, `FranchiseOwnerCabinet`, `OperationalCabinet`).

| Кабинет / зона | Точка входа (URL) | Shell / layout | Ключевые страницы / секции | Роль | ref |
|---|---|---|---|---|---|
| **Глобальная платформа** | `/admin` (PLATFORM_MODE) | `AdminRoot` → `AdminLayout` (монолит 9004 стр., ~80 секций, `pushState`-роутер) | Home-дашборд, Tenants, Billing/Ledger, ARR/LTV, Churn, TenantHealth, CostAttribution, FeatureFlags, ApiQuotas, Ads, Loyalty, Telemedicine, Reviews, Audit, Supervisor | `super_admin` | `pages-01` |
| **Кабинет франшизы** | `/{slug}/admin` | `AdminRoot` → `FranchiseOwnerCabinet` (оркестратор ~50 lazy-секций, локальный `route`-switch) | Overview, Tenants (создание клиник), Reviews, Analytics, NetworkBilling, PartnerDoctors, Recruiters, Settings + десятки секций из `../sections` | `franchise_owner` (+ `OnboardingWizard` при первом входе) | `pages-03`, `pages-10` |
| **Кабинет управляющего** | `/{slug}/manager/*` | `_ManagerShell` (sticky topbar + bottom-nav + Cmd+K; экспорт `MGR_NAV`/`MGR_NAV_GROUPS` — единый источник навигации) | `ManagerDashboard`, `ManagerHistory`, `ManagerBonuses`, `ManagerAnalytics`, `ManagerKPI`, `ManagerFinance`, `ManagerAppointments`, `ManagerRecruitDoctors` (персонал), `ManagerSettings` (услуги), Inventory/Receipts/Batches, Loyalty/Lab/Aggregator/Marketing/Telephony, Subscription* | `manager` (часть — `reg`) | `pages-04`, `pages-05`, `pages-06`, `pages-08` (`_ManagerShell`) |
| **Кабинет директора сети** | `/{slug}/director/*` | `DirectorLayout` (свой shell, `PeriodContext` + `useDirectorPeriod`, react-router `<Outlet/>`) | `DirectorDashboard`, `DirectorPnL`, `DirectorCashflow`, `DirectorKPI`, `DirectorMarketing`, `DirectorClinics`, `DirectorDoctors`, `DirectorServices`, `PatientEngagement`, `NetworkDashboard` (read-only аналитика) | `director`, `deputy_director` | `pages-02` (layout), `pages-09`, `pages-10` |
| **Кабинет бухгалтера** | `/{slug}/accountant/*` | `AccountantCabinet` (react-router `<Routes>`) → `_AccountantShell` (sidebar, экспорт `ACC_NAV`) | `AccSummary`, `AccCash` (кассовые смены), `AccActs`, `AccIncomingInvoices`, `AccPayments`, `AccPayroll`, `AccSpending`, `AccReports` (часть — Phase-2 заглушки) | `accountant` | `pages-01` (роутер), `pages-08`, `pages-09` |
| **Кабинет врача (штатный)** | `/{slug}/admin` (по роли) | `AdminRoot` → `DoctorLayout` (1526 стр., 12 секций, локальный `route`-switch, **вне BrowserRouter**) | Today, Schedule, Appointments, AI-tools, Patients, Referrals (inline `CreateReferralForm`), Lab, Chat, Earnings/Rating/Time, Regulations | `doctor` | `pages-02` |
| **Кабинет регистратора/медсестры** | `/{slug}/admin` (по роли) | `AdminRoot` → `OperationalCabinet` (2643 стр., вкладки в одном компоненте, hotkeys) | Dashboard, Create (направление/анализы), Referrals, Appointments, Visiting, Bonuses, Doctors, Regulations, Chat | `reg`, `nurse` | `pages-07` |
| **Кабинет рекрутёра** | `/{slug}/admin` (по роли) | `AdminRoot` → `RecruiterCabinet` | Dashboard, Register (врача → QR+пароль), Doctors, Bonuses, Percent, Regulations | `recruiter` | `pages-07` |
| **Кабинет врача-партнёра** | `/{slug}/admin` (hard-redirect) | `AdminRoot` → `PartnerDoctorCabinet` | Dashboard, Referrals, Schedule, Bonuses, Billing, Regulations | `partner_doctor` | `pages-07` |
| **Кабинет приезжего врача** | `/{slug}/admin` (hard-redirect) | `AdminRoot` → `VisitingDoctorCabinet` | Queue, History, Income, Billing, Regulations; приём по QR/коду | `visiting_doctor` | `pages-08` |
| **Кабинет пациента** | `/{slug}/p`, `/{slug}/p/...` | `PatientCabinet` (3863 стр., 5 секций home/health/chats/rewards/profile) | Записи, медкарта, рецепты, витальные, лаборатория, лояльность, подписка, документы, чат, семья, телемед-входящие; `PatientCabinetPreview` на `/{slug}/p-new` — параллельный дубль (dark) | `patient` (auth по session/QR-токену, без пароля) | `pages-07` |
| **Простой каркас сотрудника** | `/{slug}/` index, `/history`, `/bonuses`, `/qr/:id`, `/create`, `/scan` | `components/Layout` (`<Outlet/>` + BottomNav + CallWidget + SupportChat + push) | `Dashboard`, `History`, `Bonuses`, `QRScreen`, `CreateReferral`, `ScanScreen` | общие для staff (reg/manager/doctor/recruiter) | `pages-02`, `pages-07`, `components-01` (`Layout`) |
| **Публичные (без auth)** | `/`, `/franchise`, `/signup`, `/{slug}/book`, `/{slug}/clinic`, `/wiki`, `/{slug}/invite/:code`, `/reset-password`, `/privacy`, `/terms`, `/consent`, `/p/telemed/:token` | каждая страница самодостаточна (часто прямой `axios`, без `../api`) | `Landing`, `Franchise`, `SignupWizard`, `OnlineBooking`, `ClinicPage`, `Wiki`/`WikiArticle`, `InviteRegister`/`InviteAccept`, `ResetPassword`, legal-страницы, `PatientTelemedRoom` | без роли | `pages-02`, `pages-03`, `pages-07`, `pages-08` |
| **Чат сотрудников** | `/staff-chat` (SLUG='') | `StaffChat` (2807 стр., WebSocket-мессенджер) | комнаты/каналы, файлы, реакции, опросы, mentions, threads | staff (auth через URL hash) | `pages-08` |

### Логика `RootRedirect` (вход `/{slug}/`)

`MiniApp → RootRedirect` маршрутизирует залогиненного по роли (`App.jsx`):
`super_admin → /admin`, `manager → /{slug}/manager`, `director|deputy_director → /{slug}/director`, `accountant → /{slug}/accountant`, `patient → /{slug}/p`, **все остальные** (doctor/reg/nurse/recruiter/franchise_owner/visiting/partner) → `/{slug}/admin` (там `AdminRoot` выбирает конкретный кабинет по `user.role`).

```
                       ┌──────────────────────────────────────────────┐
   URL  ───────────────▶  config.js: SLUG / API_BASE / PLATFORM_MODE   │
                       └───────────────┬──────────────────────────────┘
                                       ▼
                         App.jsx → AppRouter()  (грубый роутинг по pathname)
        ┌──────────────┬───────────────┬────────────────┬───────────────────────┐
        ▼              ▼               ▼                ▼                       ▼
   Landing/        /admin          /{slug}/p        /{slug}/book,         /{slug}/* (MiniApp)
   /franchise/   (PLATFORM_MODE)  PatientCabinet    /clinic, /wiki,            │
   /signup/        AdminRoot                         telemed (public)          │
   /privacy ...                                                                ▼
   (public, axios)                                            auth-гейт (token? Telegram? Landing)
                                                                              │
                                                              <BrowserRouter basename=/{slug}>
                                       ┌──────────────────────┬───────────────┴───────────────┐
                                       ▼                      ▼                                ▼
                              Layout (/, /history,    /director/* DirectorLayout       /manager/* (_ManagerShell)
                              /bonuses, /create...)   /accountant/* AccountantCabinet  страницы Manager*

   AdminRoot (вне BrowserRouter) — по user.role монтирует:
   super_admin→AdminLayout · franchise_owner→FranchiseOwnerCabinet · doctor→DoctorLayout
   reg/nurse→OperationalCabinet · recruiter→RecruiterCabinet · partner→PartnerDoctorCabinet
   visiting→VisitingDoctorCabinet
```

---

## 3. Auth-гейт и точки входа (`MiniApp` в `App.jsx`)

`MiniApp` инициализируется в строгом порядке (см. `App.jsx`, `useEffect` инициализации):
1. **Веб-сессия первой**: если в сторе есть `token` — `getMe()`; при 401 чистит `clinika_token_<SLUG>` и `logout()`.
2. **Telegram Mini App** (опционально): `waitForTelegramSDK()` возвращает `null` мгновенно вне Telegram (таймаут 2с) → `authTelegram(...)` → `getMe()`. Telegram **никогда не блокирует** запуск веб-режима.
3. Нет ни токена, ни Telegram → показывается `Landing` (auth-гейт `if (!user) return <Landing/>`).

Особые до-роутинговые случаи в `MiniApp`: `/{slug}/invite/<token>` (инвайт врача `InviteAccept` / партнёра `InviteRegister`), `/staff-chat` (сам обрабатывает auth через URL hash), `ProfileSetup` для нового Telegram-сотрудника без аккаунта, hard-redirect приезжего/партнёрского врача на `/admin`. Поверх всего — `ForcePasswordChangeModal` (миграция pwdmust01): блокирующая, неотменяемая модалка при `user.password_must_change` (рендерится вне `BrowserRouter`, закрывается только успешным `PATCH /profile/me`; деталь — `components-01.md`).

---

## 4. Слои фронтенда: pages vs sections vs components vs design

Это четыре чётко разграниченных слоя. Понимание ролей важно, потому что «куда класть код» зависит именно от слоя.

### `pages/` — экраны уровня роутинга (≈90 файлов, `ref/pages-01..10.md`)
Верхнеуровневые компоненты, которые **монтирует роутер** (`App.jsx`/`AdminRoot`). Делятся на два подтипа:
- **Shell-кабинеты / монолиты**: собирают навигацию + данные + рендерят секции (`AdminLayout`, `FranchiseOwnerCabinet`, `DoctorLayout`, `OperationalCabinet`, `PatientCabinet`, `DirectorLayout`, `_ManagerShell`, `_AccountantShell`). Здесь живёт ролевая логика, реестры разделов, источник навигации.
- **Тонкие обёртки**: ~14–37 строк, оборачивают «толстую» секцию из `../sections` в shell через `lazy/Suspense` (`ManagerLab`, `ManagerLoyalty`, `ManagerKanban` по 34, `ManagerChatPage` 27, директорский `NetworkDashboard` всего 14, …). Бизнес-логики в них нет — её менять в секции.

Pages обычно вызывают API напрямую через `../api`, держат своё состояние, форматируют данные.

### `sections/` — крупные самодостаточные экраны-разделы (`ref/sections-01..09.md`)
«Раздел» кабинета: полноценный экран с собственными данными, модалками и API-вызовами, который **встраивается в один или несколько shell-ов**. Ключевое отличие от pages: секция **не знает про роутинг** — её монтирует страница/shell, передавая пропсы (`token`, `role`, `clinicId`, `isSupervisor`). Поэтому одна секция переиспользуется в нескольких кабинетах: `AdminLoyaltySection` живёт во `FranchiseOwnerCabinet` и `ManagerLoyalty`, `AdminLabProvidersSection` — в `ManagerLab`, `AdminAggregatorSection` — во `FranchiseOwnerCabinet` и `ManagerAggregator` (сама панель `/admin` `AdminLayout` для лояльности использует свою `sections/loyalty/LoyaltySection`, а не `AdminLoyaltySection`). Расписание `WeekScheduleSection` обслуживает врача, менеджера и медсестру через проп `mode`.

В секциях сосуществуют **две школы** (см. `sections-01.md`): новая (axios `../api` + дизайн-система `../design` + гейтинг платных модулей по HTTP 402) и старая «token-prop» (получают `token` пропом, ходят сырым `fetch` через `apiFetch`, верстают inline-стилями).

### `components/` — переиспользуемые UI-блоки и подсистемы (`ref/components-01..09.md`)
Презентационные/контейнерные компоненты, шарящиеся между кабинетами. Здесь нет роутинга и backend-эндпоинтов в смысле определения — они только **потребляют** API. Покрывают сквозные подсистемы: оболочка (`Layout`, `BottomNav`), реалтайм (`CallWidget` WebRTC, `IncomingCallModal`, `AdminSupportPanel`), impersonation (`ImpersonateModal` + `ImpersonationBanner`), глобальный поиск (`CommandPalette`), модалки франшизы/безопасности (`ClinicEditModal`, `ForcePasswordChangeModal`), а также доменные под-папки (`marketing/`, `inventory/`, `staff/`, `chat/`, `doctor/`, `telemed/`, `wellness/`, `system/`, `legal/`).

Граница sections↔components размыта по размеру, но правило такое: **section = «страница раздела» с маршрутным смыслом и загрузкой данных, component = переиспользуемый блок, который вставляют в секции/страницы**.

### `design/` — дизайн-система (UI-kit, `ref/design-01.md`)
23 файла в `frontend/src/design/` (`index.js` + `tokens.css` + 21 файл в `components/`) — единая дизайн-система, реализующая макет `design-preview-2`. Компоненты **чисто презентационные** (не ходят в API, не знают про tenant — единственное исключение `ClinicScopeSelector`), стилизуются **исключительно через CSS-переменные дизайн-токенов** (`var(--bg)`, `var(--fg)`, `var(--accent)`, `var(--good/warn/bad)`, `var(--radius)`, `var(--shadow-*)`). Единая точка входа — `design/index.js`: `import { Page, Card, Button, useToast } from '../design'`.

Состав: layout (`Page`, `PageHeader`, `Card`, `KpiRow`/`KpiCard`), элементы (`Button`, `Chip`, `Tabs`, `Avatar`, `Breadcrumbs`, `Sparkline`, `Skeleton`/`TableSkeleton`, `EmptyState`, `InfoHint`, `QuickActions`+`buildPatientCardActions`), overlay (`Modal`, `Toast`+`ToastProvider`/`useToast`, `useConfirm`, `ClinicScopeSelector`). Паттерны: глобальный CSS инжектируется лениво и единожды через `ensureStyles()` (в Modal/Toast/InfoHint/QuickActions — менять стили внутри строки `css` в самом файле); `useConfirm` строится поверх `Modal`+`Button`; `ToastProvider` оборачивает приложение **один раз в `App.jsx`**, поэтому `useToast()` доступен во всех ветках.

```
   pages/  (роутинг, ролевая логика, навигация)
     │  монтирует / lazy-import
     ▼
   sections/  (раздел кабинета: данные + API + модалки; переиспользуется между shell-ами)
     │  использует
     ▼
   components/  (переиспользуемые блоки: Layout, CallWidget, CommandPalette, доменные под-папки)
     │  строится из
     ▼
   design/  (UI-kit на CSS-токенах: Card/Button/Modal/Tabs/Toast/...; import { } from '../design')
```

---

## 5. Слой API: как страницы зовут бэкенд

Сетевое ядро — `frontend/src/api/index.js` (`ref/frontend-misc-01.md`). Это единый axios-инстанс `api` (default export) с `baseURL = API_BASE`, который импортирует почти весь проект.

**Request-интерсептор** подставляет `Authorization: Bearer <token>` и заголовок `X-Tenant-Slug`. Активный токен выбирается функцией `_getActiveTokenInfo()` по `_isAdminPath()` (т.е. по `window.location.pathname`):

- **Две независимые токен-системы на один SLUG:**
  - `clinika_token_<SLUG>` / `clinika_refresh_token_<SLUG>` — пациент/партнёр (пользовательское пространство).
  - `clinika_admin_token_<SLUG>` / `clinika_admin_refresh_token_<SLUG>` — admin/manager/franchise/director/super_admin (админ-панель).
- Выбор зависит от того, открыта ли админ-страница. При смене схемы роутинга `_isAdminPath` нужно синхронизировать.

**Response-интерсептор**:
- **Auto-refresh при 401**: вызывает `POST /auth/refresh` отдельным «голым» `axios.post` (без интерсепторов, чтобы 401 на refresh не зациклился), дедуплицирует параллельные refresh через модульный кэш `_refreshing` (per-tokenKey), защита от цикла — флаг `cfg._retry`.
- **Region-lock 403**: детектится по строковому префиксу русского `detail` → диспатчит `CustomEvent('region-lock-blocked')` (+ alert-fallback). UI может слушать это событие.

**REST-функции**: файл экспортирует десятки именованных хелперов (`authTelegram`, `loginPassword`, `getMe`, `updateMe`, `createReferral`, `getReferrals`, `getManagerSummary`, `getKpi`/`setKpi`, `exportCSV`, …) — страницы зовут либо их, либо сам `api.get/post/...`. Тематические обёртки: `api/chatSlots.js` (slot-booking с `Idempotency-Key`), `api/partnerOffers.js` (партнёрский прайс) — обе наследуют токены/refresh/slug от `api`.

**Исключения из общего паттерна (важно при правках):**
- **Публичные страницы** (`Landing`, `Franchise`, `OnlineBooking`, `ClinicPage`, `InviteAccept`, `ResetPassword`, `SignupWizard`) ходят **прямым `axios` + `API_BASE`** — намеренно, токена ещё нет, refresh не нужен.
- **`utils/ThemeLoader.js`** (CMS-брендинг) — голый `axios.get` мимо `api`: без токена, без refresh и **без `X-Tenant-Slug`** (тенант только через префикс `API_BASE`).
- **WebSocket-подсистемы** строят URL вручную из `API_BASE` (`http→ws`) и передают токен в query-string: `CallWidget` (`/presence/ws/...`), `usePatientCallListener` (`/patient/notifications/ws/...`), `StaffChat` (`/staff-chat/ws`), `PatientTelemedRoom` (`/telemed/ws/...`), `AdminRoot` presence.
- Легаси-сигнатуры `apiFetch(method, url, _token, data)` — третий аргумент `token` **игнорируется** (всё на едином инстансе), оставлен для совместимости (`AdminLayout`, `DoctorLayout`, SMS-секции). `ManagerRecruitDoctors`/`RecruiterCabinet` несут **другую** легаси-сигнатуру `apiFetch(token, path, opts)` (токен первым). `OperationalCabinet` своего `apiFetch` не определяет — ходит через импортированный инстанс `api`.
- Платные модули отдают **HTTP 402** → секция показывает блок «модуль не подключён» (`moduleOffBlock`); **501** в AI-секциях = «AI не настроен» (не ошибка).

---

## 6. Состояние, хуки, темизация

### Zustand-стор — `frontend/src/store/auth.js` (`ref/frontend-misc-01.md`)
Минимальный стор `useAuthStore`: `token`, `user` + экшены `setToken`, `setUser`, `logout`. **Частично легаси/неполный**: знает только про `clinika_token_<SLUG>`, **не** про админский токен и **не** про refresh. Реальная токен-логика (admin/user split, refresh, очистка) живёт в `api/index.js` + `localStorage`, а не в сторе. Высокий риск рассинхрона: `logout()` через стор оставит admin-токен и refresh в localStorage. Используется как источник `user`/`role` в `App.jsx`, кабинетах и `BottomNav`.

### Хуки — `frontend/src/hooks/` и `frontend/src/lib/`
- `useClinicScope()` — выбор активной клиники в аналитике (sticky в `localStorage('clinika_selected_clinic_<SLUG>')`), грузит `/manager/clinics-accessible`, `selectedId===''` = «все клиники». Используется во всех `Manager*`-аналитиках вместе с `<ClinicScopeSelector>`.
- `usePatientCallListener()` — WebSocket realtime-звонки в кабинете пациента (auto-reconnect с backoff).
- `useRegHotkeys()` — глобальные горячие клавиши регистратора (Alt+N/R/S/P/W, Ctrl+K; учитывает русскую раскладку через `e.code`).
- `useChatSoundNotification()` — Web Audio «ping» на сообщение чата.
- `lib/useTheme.js` — переключение **dark/light** (см. ниже), `lib/tg.js` — безопасная обёртка Telegram SDK, `lib/callTones.js` / `lib/deviceStorage.js` — звонковая инфраструктура, `lib/phoneActions.js` — звонок/WhatsApp/печать, `lib/webPush.js` — Web Push (SW + VAPID).

### Две независимые оси темизации (часто путают)
1. **dark/light** — `lib/useTheme.js`: хранит выбор в `localStorage('clinika-theme')` (+ легаси-ключи `theme`/`adminTheme`), ставит `data-theme` и класс `dark` на `<html>` (для Tailwind `dark:`). Ранний side-effect при импорте предотвращает FOUC; `App.jsx` дополнительно применяет тему до первого рендера.
2. **CMS-брендинг тенанта** — `utils/ThemeLoader.js`: `GET /cms/theme` → выставляет CSS-переменные `--color-primary/secondary/sidebar/bg`, `--font-family`, favicon, title. При ошибке тихо берёт дефолт (бирюза «КлиникСеть»). Перезагружается без F5 по событию `clinika-branding-updated`.

Обе оси трогают `document.documentElement`, но не конфликтуют по ключам.

### Стилизация
- `main.jsx` глобально импортирует `design/tokens.css` (значения CSS-переменных дизайн-системы — М33 перетемизация) и `index.css` (Tailwind).
- Премиум-кабинеты и дизайн-система — на токенах (`var(--accent)`, `var(--fg)`, `var(--bg-*)`). Иконки — Material Symbols Outlined.
- **Легаси-острова** (техдолг перетемизации): `Dashboard`, `ClinicPage`, `History`, `FranchiseModules`, `FranchiseRevenue`, `ManagerMisWebhooks`, `ManagerSubscriptionDiscounts`/`Pending`, `AdminSupervisor`, инвайт-страницы — хардкод hex/oklch и/или собственные модалки вместо `../design`. При редизайне это отдельные правки.

---

## 7. Сквозной пример: одна страница от роута до рендера

Возьмём **«История направлений» менеджера** — `/{slug}/manager/history` (`ref/pages-04.md`).

1. **URL → config**: пользователь на `arc/manager/history`. `config.js` вычисляет `SLUG='arc'`, `API_BASE='/arc/api'`.
2. **AppRouter**: путь не подходит под публичные ветки / `/admin` / `/p` → попадает в `MiniApp`.
3. **Auth-гейт**: в сторе есть `token` (ключ `clinika_token_arc` или admin-токен — зависит от роли) → `getMe()` наполняет `user` (`role='manager'`). `user` есть → рендерится `<BrowserRouter basename="/arc">`.
4. **Route-matching**: `App.jsx` в ветке `user?.role === 'manager'` объявляет `<Route path="manager/history" element={<ManagerHistory />} />`. Компонент `ManagerHistory` объявлен через `lazy()` — Vite подгружает чанк, `<Suspense>` показывает фон-плейсхолдер.
5. **Shell**: `ManagerHistory` рендерит `<ManagerShell active="history" title="История направлений">…children…</ManagerShell>`. `_ManagerShell` (`ref/pages-08.md`) даёт sticky-topbar, мобильную bottom-nav (из `MGR_NAV`/`MGR_NAV_GROUPS`), `<NotificationsBell>` и Cmd+K `<CommandPalette>`.
6. **Состояние и API**: страница берёт `useClinicScope()` (селектор клиники) и читает данные через `getManagerReferrals({ page, limit:50, date_from, date_to, status, clinic_id })` из `../api`. Axios-интерсептор сам подкладывает `Bearer` и `X-Tenant-Slug`; tenant-фильтрация — на бэкенде.
7. **Рендер**: данные раскладываются дизайн-системой — `Card`, `Chip` (статусы), `Button`, `EmptyState`, `ClinicScopeSelector`, `QuickActions` (`buildPatientCardActions` — позвонить/WhatsApp/печать QR), `Modal` (`PrintQrModal`). Тосты — через глобальный `useToast()` из `ToastProvider` (поднят в `App.jsx`).
8. **Нюансы**: фильтр по телефону применяется **на клиенте** поверх загруженной страницы (пагинация при этом отключается) — отсюда сброс дат на «всё время» при наличии `?patient_phone` в URL.

Сравните с **директорским** маршрутом `/{slug}/director/pnl`: там вместо MiniApp-Routes работает отдельный `DirectorLayout` (`<Outlet/>` + `PeriodContext`), `DirectorPnL` берёт период из `useDirectorPeriod()`, а данные — `GET /director/pnl` + экспорт blob; графики — самописный `_DirectorCharts` (`ref/pages-10.md`). А **`/admin`-секции** вообще не используют react-router — `AdminLayout` сам ведёт URL через `pushState` и `renderSection()`-switch (`ref/pages-01.md`).

---

## 8. Схема слоёв и потоков (сводная)

```
                            ┌─────────────────────────────────────────┐
                            │ main.jsx → LocalErrorBoundary → <App/>   │
                            │ + tokens.css (design) + index.css (TW)   │
                            │ + lazy Sentry                            │
                            └────────────────────┬────────────────────┘
                                                 ▼
                        App.jsx: <ToastProvider> → AppRouter (по pathname)
                                                 │
                  ┌──────────────────────────────┼─────────────────────────────┐
                  ▼                               ▼                             ▼
            PUBLIC pages                   /admin (AdminRoot)            тенант MiniApp
        (Landing/Franchise/...)         выбор кабинета по role        (auth-гейт + BrowserRouter)
         axios прямой, без auth         AdminLayout/Doctor/Reg/...       Layout/Director/Accountant/Manager*
                  │                               │                             │
                  └───────────────┬───────────────┴──────────────┬─────────────┘
                                  ▼                              ▼
                            pages → sections → components → design (UI-kit на токенах)
                                  │
                                  ▼
                  ───────────── СЕТЕВОЙ СЛОЙ ─────────────
                   api/index.js (axios)                       store/auth.js (zustand: token,user)
                   ├─ request: Bearer + X-Tenant-Slug         lib/useTheme (dark/light → <html>)
                   ├─ 401 → /auth/refresh (dedup, _retry)     utils/ThemeLoader (CMS-брендинг → :root vars)
                   ├─ 403 region-lock → CustomEvent           lib/* (tg, webPush, callTones, phoneActions)
                   └─ 402/501 → «модуль/AI не подключён»       hooks/* (clinicScope, regHotkeys, callListener)
                   WS: presence/telemed/staff-chat/patient — токен в query-string
```

---

## 9. Где что менять (быстрый справочник)

| Задача | Куда идти | ref |
|---|---|---|
| Добавить раздел в панель super_admin | `AdminLayout`: `NAV` + `NAV_GROUP_OF` + `PAGE_TITLES` + `ADMIN_SECTIONS` + `renderSection()` + `visibleNav` (6 структур синхронно!) | `pages-01` |
| Добавить раздел управляющему | `_ManagerShell`: `MGR_NAV` (+`group`) → затем `<Route>` в `App.jsx` + страница-обёртка | `pages-08`, `App.jsx` |
| Добавить раздел директору | `DirectorLayout`: `DIR_NAV` (+`BOTTOM_KEYS`) + `<Route>` + страница `director/*` | `pages-02` |
| Добавить раздел бухгалтеру | `_AccountantShell`: `ACC_NAV` + `accountant/Acc*.jsx` + `<Route>` в `AccountantCabinet` | `pages-08`, `pages-01` |
| Новый REST-вызов | именованный `export` в `api/index.js`, либо `api.get/post` в странице | `frontend-misc-01` |
| Изменить логику токенов/refresh | `api/index.js`: `_getActiveTokenInfo`/`_isAdminPath`/response-интерсептор | `frontend-misc-01` |
| Новый компонент дизайн-системы | `design/components/*` + реэкспорт в `design/index.js` | `design-01` |
| Тема dark/light | `lib/useTheme.js`; брендинг тенанта — `utils/ThemeLoader.js` | `frontend-misc-01` |
| Логика кабинета врача / регистратора | `DoctorLayout` (вне Router → `window.location.assign`) / `OperationalCabinet` | `pages-02`, `pages-07` |
| Логика кабинета пациента | `PatientCabinet` (+ дублировать auth/манифест в `PatientCabinetPreview`) | `pages-07` |

---

## 10. Ссылки на reference-доки

- Страницы: `ref/pages-01.md` (admin/platform + точки входа), `ref/pages-02.md` (врач/директор/чат-админка/лендинг), `ref/pages-03.md` (франшиза/публичные/manager ч.1), `ref/pages-04.md`–`ref/pages-06.md` (кабинет управляющего), `ref/pages-07.md` (кабинеты сотрудников/пациента/публичная запись), `ref/pages-08.md` (QR/онбординг/Wiki/чат + shells + бухгалтерия), `ref/pages-09.md`–`ref/pages-10.md` (бухгалтер + директор).
- Секции: `ref/sections-01.md`–`ref/sections-09.md` (AI/агрегаторы/лаборатории/реклама/расписание/SMS-маркетинг и др.).
- Компоненты: `ref/components-01.md`–`ref/components-09.md` (Layout/CallWidget/CommandPalette/impersonation/доменные под-папки/телемед).
- Дизайн-система: `ref/design-01.md`.
- Инфраструктура (API-клиент, хуки, lib, стор, темы): `ref/frontend-misc-01.md`.
