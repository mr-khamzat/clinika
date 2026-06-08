# components [06] — лояльность, маркетинг, кабинет пациента, направления, регламенты

Срез из 15 React-компонентов фронтенда МИС «КлиникСеть». Это **презентационные/контейнерные виджеты**, которые встраиваются в крупные секции (`sections/...`) и страницы кабинетов. Группа разнородна по доменам, но объединена тем, что это «листовые» UI-блоки: они сами дёргают API (через `axios` напрямую или через инстанс `../../api`), форматируют данные и рендерят таблицы/карточки/модалки/чаты. Чёткой архитектурной границы внутри среза нет — это просто алфавитный диапазон (loyalty → marketing → patient → referrals → regulations[A-C]).

Два технических «мира» внутри среза, важно не путать:
1. **Пациентский (patient/loyalty)** — авторизация по `sessionToken` (передаётся в query-параметре `?t=...`), вызовы через `axios` + `API_BASE` напрямую, светлая тема с захардкоженными HEX-цветами и Tailwind-классами, заточено под iPhone SE (375px).
2. **Админский/менеджерский (marketing/referrals/regulations)** — авторизация через JWT-инстанс `../../api` (cookie/header), tenant-скоуп на бэке, тёмная тема через CSS-переменные `var(--fg)`, `var(--accent)` (M33-токены).

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `loyalty/LoyaltyRewardsCatalog.jsx` | Каталог наград пациента + claim | 293 |
| `loyalty/LoyaltyTransactionsList.jsx` | История начислений баллов с пагинацией | 187 |
| `loyalty/TierBadge.jsx` | Переиспользуемый бейдж тира + палитра | 113 |
| `marketing/AdSpendTab.jsx` | Учёт расходов на рекламу, KPI/CPL | 673 |
| `marketing/AttributionTab.jsx` | Привязка пациентов к каналам, UTM | 657 |
| `marketing/ChannelsTab.jsx` | Справочник маркетинговых каналов (CRUD) | 494 |
| `patient/PatientBottomNav.jsx` | 5-табовая нижняя навигация Apple HIG | 94 |
| `patient/PatientChatHub.jsx` | Чат-hub: поддержка/клиника/AI | 646 |
| `patient/SegmentControl.jsx` | iOS-style сегмент-контрол | 72 |
| `patient/SubPageNav.jsx` | Список карточек-разделов внутри таба | 111 |
| `referrals/CreateReferralWizard.jsx` | 3-шаговый визард создания направления | 169 |
| `referrals/InternalServicePicker.jsx` | Выбор услуги из своего каталога | 97 |
| `referrals/PartnerOfferPicker.jsx` | Выбор услуги из партнёрского прайса | 89 |
| `regulations/AiGenerateModal.jsx` | AI-генерация шаблона регламента | 250 |
| `regulations/CompletionsModal.jsx` | Кто выполнил регламент (статистика) | 157 |

---

## `frontend/src/components/loyalty/LoyaltyRewardsCatalog.jsx`
- **Назначение:** Каталог наград программы лояльности для пациента. Показывает карточки наград, считает доступность по баллам/тиру/наличию и отправляет запрос на получение награды (claim) с подтверждением.
- **Ключевые элементы:**
  - `export default LoyaltyRewardsCatalog({ sessionToken, points, tier, onClaimed })` — единственный экспорт.
  - Локальные хелперы: `TIER_ORDER = ['bronze','silver','gold','platinum']`, `tierIndex(t)` — индекс тира для сравнения.
  - `isAvailable(r)` — награда доступна если хватает баллов И тир пациента ≥ `r.min_tier` И есть остаток.
  - Состояния: `rewards`, `loading`, `error` (`'module_off'` | `'load'`), `filterAvailable`, `confirmReward`, `claiming`.
  - Модалка подтверждения claim рендерится инлайн (overlay + центрированный диалог).
- **Зависимости:** `axios`, `API_BASE` из `../../config`, `useToast` из `../../design`, `TierBadge` и `TIER_PALETTE` из `./TierBadge`. Колбэк `onClaimed()` поднимает событие наверх (для обновления баланса в родителе — `PatientLoyaltySection`).
- **Эндпоинты (вызываются, не объявляются):** `GET /patient/loyalty/rewards?t=<token>` → массив наград; `POST /patient/loyalty/claim` body `{reward_id}` с `?t=<token>` → claim. HTTP 402 трактуется как «модуль не подключён».
- **Где менять для типовых задач:**
  - Новый критерий доступности награды (например, лимит на пациента) → правь `isAvailable()` (строки 66-71) и текст кнопки (строки 229-232).
  - Изменить порядок/набор тиров → `TIER_ORDER` (строка 29), но синхронно с `TierBadge`/бэком.
  - Текст после успешного claim → toast на строке 82.
- **Подводные камни:**
  - `sessionToken` уходит в URL query `?t=...` — токен светится в логах/реферерах (общая практика пациентского портала, но риск).
  - Сравнение тира строковое через индекс массива; неизвестный тир даёт `-1` → любая награда с `min_tier` будет недоступна.
  - Числа (`points`, `points_cost`) приводятся через `Number()`; баллы целочисленные, Decimal не задействован.
  - Фильтрует `active !== false` на клиенте — бэк может вернуть неактивные.
- **Строк:** 293

## `frontend/src/components/loyalty/LoyaltyTransactionsList.jsx`
- **Назначение:** Лента истории транзакций баллов пациента (начисления/списания) с подгрузкой «показать ещё» по 20 и локализацией причин.
- **Ключевые элементы:**
  - `export default LoyaltyTransactionsList({ sessionToken })`.
  - `REASON_MAP` — словарь `reason → {label, icon, color}` (11 причин: `appointment_completed`, `referral_completed`, `signup_bonus`, `birthday_bonus`, `review_bonus`, `invite_friend`, `manual_adjust`, `reward_claim`, `reward_cancelled`, `expired`, `tier_upgrade`).
  - `reasonInfo(reason)` — фолбэк на нейтральную иконку `history`. `formatDate(iso)`.
  - `PAGE = 20`. Состояния: `items`, `total`, `offset`, `loading`, `loadingMore`, `error`.
- **Зависимости:** `axios`, `API_BASE` из `../../config`. Не зависит от `design`/`TierBadge`. Самодостаточный.
- **Эндпоинты:** `GET /patient/loyalty/transactions?t=<token>&limit=20&offset=N` → `{items:[{delta, reason, note, created_at, ...}], total}`. 402 → «модуль не подключён».
- **Где менять для типовых задач:**
  - Новая причина начисления → добавь ключ в `REASON_MAP` (строки 25-37), иначе покажется сырой `reason` с иконкой `history`.
  - Размер страницы → `PAGE` (строка 22).
  - Знак/цвет бейджа → блок `positive = Number(t.delta) >= 0` (строки 135, 158-166).
- **Подводные камни:**
  - `delta` приводится `Number()`; если бэк вернёт Decimal-строку с дробной частью — отобразится как есть через `toLocaleString`.
  - Пагинация по `offset` без курсора — при параллельных начислениях возможны дубли/пропуски в ленте.
  - `key={`${t.created_at}-${idx}`}` — если две транзакции с одинаковым `created_at`, индекс спасает, но порядок зависит от бэка.
- **Строк:** 187

## `frontend/src/components/loyalty/TierBadge.jsx`
- **Назначение:** Чисто презентационный переиспользуемый бейдж уровня лояльности (бронза/серебро/золото/платина) с медальным градиентом и иконкой. Используется в 4+ местах.
- **Ключевые элементы:**
  - `export const TIER_PALETTE` — палитра по 4 тирам (`from`, `to`, `text`, `label`, `ru`, `icon`, `fill`).
  - `export function paletteFor(tier)` — безопасный доступ с фолбэком `DEFAULT_PALETTE`.
  - `export default TierBadge({ tier, size='md', showIcon=true, className })` — `SIZES` для `sm`/`md`/`lg`.
- **Зависимости:** Нет внешних импортов (нет даже React-импорта — JSX через автоматический runtime). Самый «листовой» компонент среза. Импортируется в `LoyaltyRewardsCatalog`, `PatientLoyaltySection`, `AdminLoyaltySection` (по комментарию).
- **Эндпоинты:** нет (не роутер).
- **Где менять для типовых задач:**
  - Новый тир (например, `diamond`) → добавь в `TIER_PALETTE` (строки 23-60) + синхронизируй `TIER_ORDER` в `LoyaltyRewardsCatalog`.
  - Новый размер бейджа → `SIZES` (строки 78-82).
  - Русские подписи (`ru`) определены, но **в рендере используется `p.label` (англ.)** — если нужен русский, меняй строку 110 на `p.ru`.
- **Подводные камни:** Поле `ru` в палитре объявлено, но нигде в этом файле не выводится — потенциально мёртвое/зарезервировано для родителей. Неизвестный тир тихо отрендерится как «Tier» (нейтральный).
- **Строк:** 113

## `frontend/src/components/marketing/AdSpendTab.jsx`
- **Назначение:** Вкладка «Расходы на рекламу» в маркетинг-разделе менеджера. Учёт затрат по каналам/периодам/клиникам, KPI (расход, лиды, клики, показы, средний CPL), таблица с edit/delete и модалка добавления/редактирования.
- **Ключевые элементы:**
  - `export default AdSpendTab()` — контейнер: фильтры, KPI, таблица (desktop) / карточки (mobile).
  - `AdSpendModal` — внутренняя модалка формы (поля канал, кампания, клиника, сумма, период, лиды/клики/показы, заметки) + клиентская `validate()`.
  - Хелперы форматирования: `fmtMoney`, `fmtInt`, `fmtDate`, `toInputDate`, `defaultPeriod()` (текущий месяц).
  - Локальные UI-компоненты: `FilterDate`, `FilterSelect`, `Field`, `inputStyle()`, `Th`, `Td`, `IconBtn`. `emptyForm`.
  - KPI считаются на клиенте через `useMemo` (сумма по `items`, `cpl = spent/leads`).
- **Зависимости:** инстанс `api` из `../../api`; из `../../design`: `Card, Button, EmptyState, Modal, KpiCard, KpiRow, useToast, useConfirm`.
- **Эндпоинты (вызываются):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/marketing/ad-spend` | менеджер (JWT, tenant на бэке) | query `from,to,channel_id,clinic_id` | массив записей расхода | список расходов по фильтрам |
| POST | `/marketing/ad-spend` | менеджер | `{channel_id, campaign, clinic_id, amount, period_from, period_to, leads, clicks, impressions, notes}` | созданная запись | добавить расход |
| PATCH | `/marketing/ad-spend/{id}` | менеджер | те же поля | обновлённая запись | редактировать расход |
| DELETE | `/marketing/ad-spend/{id}` | менеджер | — | — | удалить расход |
| GET | `/marketing/channels?is_active=true` | менеджер | — | каналы | для select канала |
| GET | `/manager/clinics/` | менеджер | — | клиники | для select клиники |

- **Где менять для типовых задач:**
  - Новый KPI → блок `useMemo kpi` (строки 135-145) + `<KpiRow cols=...>` (строки 206-212).
  - Новое поле записи → `emptyForm` (566), форма в `AdSpendModal` (450+), payload `onSubmit` (402-413), колонки таблицы (242-276) и mobile-карточки (292-329).
  - Период по умолчанию → `defaultPeriod()` (строка 72).
- **Подводные камни:**
  - `amount` уходит как `Number(form.amount)` — на фронте это float; на бэке деньги должны быть Decimal, следи за сериализацией.
  - `cpl = Math.round(spent/leads)` — деление целочисленно округляется, при `leads=0` даёт 0 (защита есть).
  - KPI считаются только по загруженной странице `items`; если бэк paginates без `total`-агрегата — KPI будут неполными (сейчас `items` грузится без лимита).
  - **Дубль кода:** `Field/inputStyle/Th/Td/IconBtn` продублированы в `AttributionTab.jsx` и `ChannelsTab.jsx` почти один-в-один — кандидат на вынос в shared.
- **Строк:** 673

## `frontend/src/components/marketing/AttributionTab.jsx`
- **Назначение:** Вкладка «Атрибуция» — связывание пациента с каналом привлечения и UTM-метками (для расчёта CAC/ROI). Поиск, фильтр по каналу, таблица/карточки, модалка с автоподсказкой пациентов по телефону.
- **Ключевые элементы:**
  - `export default AttributionTab()` — debounce поиска (300мс через `searchTimerRef`), фильтр по каналу.
  - `AttributionModal` — форма: телефон пациента (с live-подсказками из глобального поиска), канал, блок UTM (source/medium/campaign/content/term), `source_detail`, `referrer`. `normalizePhone()`.
  - `UtmTriad`/`UtmBadge` — компактный вывод UTM. Локальные `Field`, `inputStyle`, `Th`, `Td`, `IconBtn`.
  - Подсказки пациента: при ≥3 цифр телефона дебаунс-запрос к `/search`, маппинг к `{id, full_name, phone}`.
- **Зависимости:** `api` из `../../api`; из `../../design`: `Card, Button, EmptyState, Modal, useToast, useConfirm`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/marketing/attribution` | менеджер | query `search, channel_id, limit, offset` | массив атрибуций | список с пациентом/каналом |
| POST | `/marketing/attribution` | менеджер | `{patient_phone, patient_user_id, channel_id, utm_*, source_detail, referrer}` | созданная | связать пациента с каналом |
| PATCH | `/marketing/attribution/{id}` | менеджер | те же поля | обновлённая | редактировать |
| DELETE | `/marketing/attribution/{id}` | менеджер | — | — | удалить |
| GET | `/marketing/channels?is_active=true` | менеджер | — | каналы | для select |
| GET | `/search?q=<phone>` | менеджер | query `q` | `{patients:[...], doctors, ...}` | автоподсказка пациента (CommandPalette) |

- **Где менять для типовых задач:**
  - Новое поле атрибуции/UTM → `emptyForm` (554), блок UTM в модалке (501-527), payload (386-397), колонки/`UtmTriad`.
  - Изменить debounce поиска → `setTimeout(..., 300)` (строка 86) и подсказок (строка 343).
  - Источник подсказок → `api.get('/search', ...)` (строка 346) — переиспользует глобальный поиск менеджера, ожидает `r.data.patients`.
- **Подводные камни:**
  - `limit: 200` захардкожен (строка 70) — атрибуций может быть больше, нет пагинации в UI.
  - Подсказки маппят `p.name || p.full_name` — формат ответа `/search` нестабилен между сущностями.
  - **Дубль:** `Field/inputStyle/Th/Td/IconBtn` идентичны таковым в `AdSpendTab.jsx`/`ChannelsTab.jsx`.
- **Строк:** 657

## `frontend/src/components/marketing/ChannelsTab.jsx`
- **Назначение:** Справочник маркетинговых каналов. Системные каналы (`is_system=true`, общие для всех тенантов) можно только включать/выключать; tenant-каналы — полный CRUD.
- **Ключевые элементы:**
  - `export default ChannelsTab()` — таблица каналов, тоггл `is_active`, удаление только для своих.
  - `ChannelModal` — форма создания/редактирования tenant-канала: `code` (валидация snake_case `^[a-z][a-z0-9_]*$`), `name`, `icon` (пресеты `ICON_PRESETS`), `is_active`.
  - `Switch` — кастомный тоггл. Локальные `Field`, `inputStyle`, `badgeStyle`, `Th`, `Td`, `IconBtn`.
  - `toggleActive(ch)` доступен и для системных; `onDelete` блокирует системные.
- **Зависимости:** `api` из `../../api`; из `../../design`: `Card, Button, EmptyState, Modal, useToast, useConfirm`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/marketing/channels` | менеджер | — | массив каналов (системные + tenant) | список |
| POST | `/marketing/channels` | менеджер | `{code, name, icon, is_active}` | созданный | только tenant-канал |
| PATCH | `/marketing/channels/{id}` | менеджер | `{is_active}` или полный объект | обновлённый | toggle/редактирование |
| DELETE | `/marketing/channels/{id}` | менеджер | — | — | только tenant-канал |

- **Где менять для типовых задач:**
  - Новые пресет-иконки → `ICON_PRESETS` (строки 26-31).
  - Правило валидации кода → regex в `validate()` (строка 272).
  - Поведение системных каналов → `toggleActive` (можно всем) vs `onDelete` (блокирует, строки 68-72). `code` заблокирован при редактировании (`disabled={isEdit}`, строка 330).
- **Подводные камни:**
  - При удалении канала записи `ad_spend`/`attribution` «потеряют ссылку на канал» (предупреждение в confirm, строка 74) — на бэке должна быть либо защита FK, либо SET NULL.
  - `tenant_id=null` означает системный канал — мультитенантная семантика на бэке, фронт лишь читает `is_system`.
  - **Дубль:** `Field/inputStyle/Th/Td/IconBtn` те же, что в двух соседних табах.
- **Строк:** 494

## `frontend/src/components/patient/PatientBottomNav.jsx`
- **Назначение:** Нижняя таб-навигация (до 5 табов) строго для нового редизайна `PatientCabinet`. Apple HIG: иконка 24px, label 11px, touch-target ≥44px, бейдж непрочитанных, safe-area-inset.
- **Ключевые элементы:** `export default PatientBottomNav({ items, value, onChange })`. `items: [{key, icon, label, badge?}]`. Активный таб — `FILL 1` + цвет brand `#1565C0`, неактивный — серый `#9CA3AF`.
- **Зависимости:** Нет импортов вообще (чистый презентационный, Material Symbols через CSS-класс).
- **Эндпоинты:** нет.
- **Где менять для типовых задач:**
  - Цвет активного/неактивного таба → строка 54 (`#1565C0` / `#9CA3AF`).
  - Высота/позиционирование бейджа → строки 74-87.
- **Подводные камни:**
  - **ВАЖНО (отмечено в комментарии файла):** не путать с `components/BottomNav.jsx` — тот для ролей `partner_doctor/staff` основного приложения. Это разные компоненты.
  - Больше 5 табов нечитаемо на 375px (ограничение по дизайну, не по коду — массив не лимитирован).
  - Цвета захардкожены (не CSS-переменные) — пациентский портал вне M33-токенов.
- **Строк:** 94

## `frontend/src/components/patient/PatientChatHub.jsx`
- **Назначение:** Унифицированный чат-hub пациента с 3 сегментами: «Поддержка» (КлиникСеть, mock если бэка нет), «Клиника» (реальные треды с врачами через `PatientChatSection`), «AI» (Gemini-бот, если модуль подключён). Контекстное переключение по ключевым словам + deeplink из подписки.
- **Ключевые элементы:**
  - `export default PatientChatHub({ sessionToken, patientPhone, tenantSlug, onGoSubscription })`.
  - `SupportSegment` — лента поддержки, оптимистичная отправка, mock-ответ если `backendAvailable===false`, обработка `pending_subscription_inquiry` из `sessionStorage` (баннер тарифа + подгрузка `benefits-detail`).
  - `SupportBubble` — пузырь сообщения. `ClinicSegmentWrap` — обёртка над лениво-загруженным `PatientChatSection` + контекстная подсказка через `document` `input`-listener. `AiSegment` — отдельный конечный автомат состояний (`idle/loading/ready/unavailable/error`).
  - Константы: `LS_KEY='clinika_chat_hub_segment'`, словари ключевых слов `SUPPORT_KEYWORDS_FOR_DOCTOR`, `CLINIC_KEYWORDS_FOR_SUPPORT`, `SUPPORT_QUICK`.
- **Зависимости:** `axios`, `API_BASE` из `../../config`, `SegmentControl` из `./SegmentControl`, лениво `sections/PatientChatSection`. Колбэк `onGoSubscription` наверх.
- **Эндпоинты (вызываются):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/patient/support/messages?t=<token>` | пациент (token) | — | массив сообщений | лента поддержки (опц., 404→mock) |
| POST | `/patient/support/messages?t=<token>` | пациент | `{text}` | `{reply?}` | отправить в поддержку |
| GET | `/patient/subscription/plans/{plan_key}/benefits-detail` | пациент | — | `{full_details_chat_message, categories_breakdown,...}` | детали тарифа для inquiry-баннера |
| POST | `/patient-portal/ai/conversations?t=<token>` | пациент | `{patient_phone, tenant_slug}` | `{id}` | создать AI-беседу (402→unavailable) |
| GET | `/patient-portal/ai/conversations/{id}/messages?t=` | пациент | — | `{messages:[...]}` | история AI-беседы |
| POST | `/patient-portal/ai/conversations/{id}/messages?t=` | пациент | `{text}` | `{reply\|text}` | сообщение AI |

- **Где менять для типовых задач:**
  - Новые быстрые ответы поддержки → `SUPPORT_QUICK` (строки 39-45).
  - Триггеры контекстного переключения → словари ключевых слов (строки 35-36).
  - Добавить 4-й сегмент → `items` (строки 89-93) + ветка рендера (114-130).
  - Поведение mock-режима поддержки → `send()` ветка `else` (строки 254-264).
- **Подводные камни:**
  - `sessionToken` снова в query `?t=...`.
  - `ClinicSegmentWrap` читает токен **повторно из `localStorage('clinika_patient_session')`** (строка 502), а не из props — рассогласование источника токена, легко словить баг при ротации токена.
  - Контекстная подсказка в «Клиника» сделана через глобальный `document.addEventListener('input')` — хрупко, ловит любые input/textarea внутри контейнера.
  - `pending_subscription_inquiry` протухает >10 мин (строка 56) — двойное чтение `sessionStorage` в двух `useState`-инициализаторах (строки 50 и 67), потенциально рассинхрон.
  - 402 от AI трактуется как «модуль не подключён».
- **Строк:** 646

## `frontend/src/components/patient/SegmentControl.jsx`
- **Назначение:** iOS-style сегмент-контрол (серая pill-подложка, активный — белая капсула с тенью). Поддерживает тёмную тему через CSS-переменные, иконку и бейдж.
- **Ключевые элементы:** `export default SegmentControl({ items, value, onChange })`. `items: [{key, label, icon?, badge?}]`.
- **Зависимости:** Нет импортов. Чистый презентационный. Используется в `PatientChatHub.jsx`.
- **Эндпоинты:** нет.
- **Где менять для типовых задач:**
  - Внешний вид активного сегмента → строки 43-47 (фон/тень). В отличие от соседей по patient/, тут есть фолбэк на CSS-переменные `var(--bg)`, `var(--fg)`.
- **Подводные камни:** Минимальный, без рисков. Touch-target `minHeight:36/minWidth:44` — чуть ниже HIG-минимума 44px по высоте.
- **Строк:** 72

## `frontend/src/components/patient/SubPageNav.jsx`
- **Назначение:** Вертикальный список карточек-разделов («иконкое меню») внутри пациентского таба (Здоровье/Бонусы/Профиль). Иконка + заголовок + hint + бейдж + chevron, тап → `onOpen(key)`.
- **Ключевые элементы:** `export default SubPageNav({ items, onOpen, title })`. `items: [{key, icon, label, hint?, badge?, color?}]`. Константы `DEFAULT_BG='#E0F7FA'`, `DEFAULT_FG='#00838F'`.
- **Зависимости:** Нет импортов. Чистый презентационный.
- **Эндпоинты:** нет.
- **Где менять для типовых задач:**
  - Цвет иконки по умолчанию → `DEFAULT_BG`/`DEFAULT_FG` (строки 23-24); индивидуальный цвет через `it.color.bg/.fg`.
  - Высота карточки → `minHeight:64` (строка 54).
- **Подводные камни:** `it.color` ожидается как объект `{bg, fg}` (см. строки 46-47) — если передать строку, упадёт в дефолт молча. Бейдж выводится как есть (число или текст).
- **Строк:** 111

## `frontend/src/components/referrals/CreateReferralWizard.jsx`
- **Назначение:** 3-шаговый визард создания направления (referral) врачом/менеджером. Шаг 1 — режим (своя клиника / другая клиника франшизы), шаг 2 — выбор услуги, шаг 3 — данные пациента + submit.
- **Ключевые элементы:**
  - `export default CreateReferralWizard({ onCreated })`.
  - Состояния: `step` (1-3), `mode` (`internal`|`external`), `me`, `otherClinics`, `toClinicId`, `serviceId`, `patientPhone/Name`, `notes`.
  - `targetClinic` = своя `me.clinic_id` (internal) или выбранная (external). `submit()` валидирует обязательные поля и POST-ит.
  - `bonusBadge` — внешнее направление = «💰 Бонус начислится», своё = без бонуса.
  - Делегирует выбор услуги: `InternalServicePicker` (internal) / `PartnerOfferPicker` (external).
- **Зависимости:** `api` из `../../api`, `PartnerOfferPicker` и `InternalServicePicker` из `./`. Колбэк `onCreated(referral)`.
- **Эндпоинты:**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|-----------|------------|
| GET | `/admins/me` | админ/врач (JWT) | — | текущий пользователь (`clinic_id`) | для internal-режима |
| GET | `/clinics/` | админ/врач | — | список клиник | select клиник-сестёр |
| POST | `/referrals/` | админ/врач | `{to_clinic_id, service_id, patient_phone, patient_name, notes}` | созданное направление | создать referral |

- **Где менять для типовых задач:**
  - Новый режим направления → добавь radio на шаге 1 (строки 78-103) + ветку в `targetClinic` (строка 38) и шаге 2 (117-119).
  - Доп. поля пациента → шаг 3 (133-153) + payload `submit` (49-55).
  - Текст бейджа бонуса → `bonusBadge` (строки 65-67).
- **Подводные камни:**
  - **Стиль не соответствует остальным (легаси-вид):** обычные Tailwind-классы (`bg-blue-600`), эмодзи в UI (🏥/🏢/💰), нет CSS-переменных/`design`-системы — выглядит старее, чем marketing/regulations-секции. Кандидат на редизайн.
  - `otherClinics` фильтруется `c.id !== me.clinic_id` (строка 97) — список «сестёр» франшизы должен ограничиваться бэком, фронт лишь убирает свою.
  - Валидация минимальная (только наличие полей), формат телефона не проверяется.
- **Строк:** 169

## `frontend/src/components/referrals/InternalServicePicker.jsx`
- **Назначение:** Выбор услуги из собственного каталога клиники (режим internal визарда). Левая колонка — категории со счётчиками, правая — поиск + radio-список услуг.
- **Ключевые элементы:**
  - `export default InternalServicePicker({ value, onChange })` — `onChange(serviceId, serviceObj)`.
  - `cats` (`useMemo`) — категории из поля `s.category`, сортировка по убыванию счётчика.
  - `visible` (`useMemo`) — фильтр по категории + поиску, **`.slice(0, 500)`** для производительности.
- **Зависимости:** `api` из `../../api`. Используется в `CreateReferralWizard`.
- **Эндпоинты:** `GET /manager/services/?limit=5000&for_referrals=true` → `{items:[...]}` или массив — каталог своих услуг.
- **Где менять для типовых задач:**
  - Лимит отображаемых услуг → `.slice(0, 500)` (строка 43); лимит загрузки → `limit: 5000` (строка 17).
  - Поля цены → `s.price ?? s.original_price` (строка 85).
- **Подводные камни:**
  - Грузит до 5000 услуг разом, рендерит до 500 — на больших каталогах фронт-фильтрация может тормозить (нет виртуализации).
  - Категория null → ключ `'__none__'`, label «Без категории».
  - `for_referrals=true` — бэк должен фильтровать услуги, доступные для направлений.
- **Строк:** 97

## `frontend/src/components/referrals/PartnerOfferPicker.jsx`
- **Назначение:** Выбор услуги из партнёрского прайса **другой** клиники франшизы (режим external визарда). Показывает цену + сумму бонуса (`payout_amount`).
- **Ключевые элементы:**
  - `export default PartnerOfferPicker({ clinicId, value, onChange })` — `onChange(serviceId, offerObj)`.
  - `cats` (`useMemo`) — категории по `o.category_id`/`o.category_name`. `visible` — фильтр по категории + поиску (без лимита `.slice`).
  - Состояния «нет клиники» / «нет прайса» рендерятся отдельно.
- **Зависимости:** `partnerOffersApi` из `../../api/partnerOffers` (метод `listForClinic(clinicId)`, помечен «Task 7»). Используется в `CreateReferralWizard`.
- **Эндпоинты:** через `partnerOffersApi.listForClinic(clinicId)` — список партнёрских офферов клиники (точный путь инкапсулирован в api-модуле).
- **Где менять для типовых задач:**
  - Поля цены/бонуса → строки 79-82 (`o.price_override ?? o.service_original_price`, `o.payout_amount`).
  - Сравнение выбора идёт по `o.service_id` (не `o.id`!) — строки 67, 73.
- **Подводные камни:**
  - Сравнение `value === o.service_id` (а в `InternalServicePicker` — `value === s.id`): визард хранит `serviceId`, оба пикера согласованы по смыслу, но поля разные — легко перепутать при правках.
  - Нет лимита отображения (в отличие от InternalServicePicker) — но партнёрских офферов обычно меньше.
  - `payout_amount` выводится напрямую (`+{o.payout_amount} ₽`) — если бэк отдаёт Decimal-строку, отобразится как есть; число не форматируется через `toLocaleString`.
  - Эмодзи 💰 в UI — тот же легаси-стиль, что и у визарда.
- **Строк:** 89

## `frontend/src/components/regulations/AiGenerateModal.jsx`
- **Назначение:** Модалка AI-генерации шаблона регламента в конструкторе регламентов (`RegulationBuilderSection`). По теме/роли/контексту модель возвращает структуру (title/description/category/steps), которую можно вставить (append/replace) в редактор.
- **Ключевые элементы:**
  - `export default AiGenerateModal({ open, onClose, onInsert, onApplyMeta, existingSteps, defaultRole })`.
  - `ROLES` — 7 ролей (manager, reg, doctor, nurse, recruiter, admin, franchise_owner), синхронизированы с `RegulationBuilderSection`.
  - `generate()` — POST с темой/ролью/языком + `existing_steps` (первые 20, для контекста) + опц. `context`. `insert()` — вызывает `onInsert(steps, mode)` и опц. `onApplyMeta(meta)`.
  - Состояния: `topic`, `role`, `context`, `busy`, `result`, `insertMode` (`append`|`replace`). Поддержка fallback-бейджа «AI недоступен, шаблон» (`result._fallback || result.fallback`).
- **Зависимости:** `api` из `../../api`, `useToast` из `../../design`. CSS-классы `reg-*` (отдельная таблица стилей регламентов, не M33-токены).
- **Эндпоинты:** `POST /admin/regulations/ai-generate` body `{topic, role, language:'ru', existing_steps:[{type,content}], context?}` → `{title, description, category, steps:[]}` (бэк может вернуть rule-based фолбэк с флагом fallback).
- **Где менять для типовых задач:**
  - Новая роль → `ROLES` (строки 20-28), синхронно с `RegulationBuilderSection`.
  - Сколько шагов уходит как контекст → `existingSteps.slice(0, 20)` (строка 63).
  - Поведение вставки meta → `insert()` (строки 77-88) и колбэк `onApplyMeta`.
- **Подводные камни:**
  - Контейнер использует CSS-классы `reg-backdrop`/`reg-modal`/`reg-input`/`reg-ai` — стили живут вне компонента (в стайлшите регламентов); при копировании в другой модуль классы не подтянутся.
  - Флаг фолбэка проверяется в двух вариантах (`_fallback` или `fallback`) — нестабильный контракт бэка.
  - Это «контролируемая» модалка: рендер `null` при `!open`, без портала — z-index/overlay полагаются на CSS `reg-backdrop`.
- **Строк:** 250

## `frontend/src/components/regulations/CompletionsModal.jsx`
- **Назначение:** Модалка «Кто выполнил регламент»: прогресс-бар покрытия, фильтры (все/прочли последнюю/старая версия/не читали), таблица сотрудников со статусом прочтения относительно текущей версии.
- **Ключевые элементы:**
  - `export default CompletionsModal({ open, regulationId, currentVersion, onClose })`.
  - `classify(row)` — `'missing'` (нет `completed_at`) / `'current'` (`version === currentVersion`) / `'outdated'`.
  - `fmtDate(s)`. Состояния: `loading`, `data` (`{completions, stats:{covered,total,pct}}`), `filter`.
  - Защита `pct` через `Math.max(0, Math.min(100, ...))`.
- **Зависимости:** `api` из `../../api`, `useToast` из `../../design`. CSS-классы `reg-*` (та же стайлшит регламентов).
- **Эндпоинты:** `GET /admin/regulations/{id}/completions` → `{completions:[{user_id, full_name, version, completed_at}], stats:{covered, total, pct}}`.
- **Где менять для типовых задач:**
  - Логика статуса прочтения → `classify()` (строки 59-63) — завязана на `currentVersion`.
  - Набор фильтров → массив на строках 96-100.
  - Колонки таблицы → блок `<thead>/<tbody>` (124-147).
- **Подводные камни:**
  - Если бэк возвращает только тех, кто прочитал (без `missing`), фильтр «Не читали» будет пуст — но `stats` всё равно корректны (предупреждение в шапке файла).
  - `currentVersion` обязателен для отличия «актуально/старая» — если не передан, всё с `completed_at` попадёт в `outdated`.
  - Cleanup через `cancel`-флаг в `useEffect` (защита от set-after-unmount).
- **Строк:** 157

---

### Сквозные наблюдения по срезу
1. **Дубликация вспомогательных компонентов** в трёх marketing-табах (`Field`, `inputStyle`, `Th`, `Td`, `IconBtn`, частично `badgeStyle/Switch/UtmBadge`) — идеальный кандидат на общий `marketing/_shared.jsx`.
2. **Два стиля авторизации в одном срезе:** patient/loyalty через `sessionToken` в query (`?t=...`), остальное — через JWT-инстанс `../../api`. Tenant-скоуп везде на бэке, фронт его не передаёт явно.
3. **Легаси-островок:** `referrals/CreateReferralWizard.jsx` + оба пикера используют старый Tailwind-стиль с эмодзи, без `design`-системы и CSS-переменных — визуально устарели относительно marketing/regulations.
4. **HTTP 402 = «модуль не подключён»** — единый паттерн gated-модулей (лояльность, AI-ассистент) на пациентском портале.
5. **Decimal-риск на фронте:** денежные/бонусные поля (`amount`, `payout_amount`, `delta`) приводятся через `Number()`/выводятся как есть — при сериализации Decimal на бэке нужно следить за точностью.
