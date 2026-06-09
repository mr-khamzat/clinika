# sections [04] — Маркетплейс модулей + кабинет пациента

Этот срез из `frontend/src/sections/` объединяет две большие подгруппы UI-секций КлиникСеть (фронт — React JSX, axios, Tailwind + inline-стили, material-symbols-иконки):

1. **Коммерция / маркетплейс модулей** (роли super_admin и franchise_owner): `MarketplaceSection`, `ModulesCatalogSection`, `ModuleMonitoringSection`, `PartnerClinicsSection`, `PaymentGatewaysSection`. Это «магазин» платных модулей платформы, мониторинг их health, расчёт роялти с клиник-партнёров и настройка эквайринга.
2. **Кабинет пациента** (PatientCabinet, авторизация через `session_token` в query-param `?t=`): `PatientCalendarSection`, `PatientChatSection`, `PatientChatsSection` (это админская!), `PatientDocumentsSection`, `PatientFamilySection`, `PatientLabResultsSection`, `PatientLoyaltySection`, `PatientSpendingSection`, `PatientSubscriptionSection`, `PatientWellnessSection`.

Ключевые архитектурные различия внутри среза, которые надо держать в голове:
- **Два способа вызова API.** Часть секций ходит через общий инстанс `../api` (axios с auto-Bearer + auto-refresh токена админа) — это все админские/owner-секции. Секции пациента используют **сырой `axios` + `API_BASE`** и передают сессию пациента как `params: { t: sessionToken }` (НЕ Bearer!). Не путать — это разные контуры авторизации.
- **402 = модуль не подключён.** Почти все секции пациента трактуют HTTP 402 как «соответствующий платный модуль выключен у тенанта» и рисуют плашку «Свяжитесь с клиникой». Это сквозной контракт с backend.
- **Tenant-изоляция — на бэкенде.** Фронт нигде не фильтрует по `tenant_id` сам; он лишь передаёт `tenantId` в путь (`/admin/tenants/{id}/...`, `/marketplace/tenant/{id}/...`). Корректность мультитенантности целиком на роутерах FastAPI.

## Оглавление

| Файл | Назначение в 5-7 слов | Строк |
|------|------------------------|-------|
| `MarketplaceSection.jsx` | Витрина-магазин модулей с триалом (owner) | 645 |
| `ModuleMonitoringSection.jsx` | Health-мониторинг подключённых модулей тенанта | 246 |
| `ModulesCatalogSection.jsx` | Каталог модулей: admin-редактор / owner read-only | 643 |
| `PartnerClinicsSection.jsx` | Контракты клиник-партнёров, расчёт роялти | 709 |
| `PatientCalendarSection.jsx` | Календарь пациента + подписка ICS-фид | 350 |
| `PatientChatSection.jsx` | Чат пациента с клиникой (mobile-first) | 674 |
| `PatientChatsSection.jsx` | Админский инбокс чатов пациентов | 432 |
| `PatientDocumentsSection.jsx` | Хранилище документов пациента (drag&drop) | 347 |
| `PatientFamilySection.jsx` | Семейный профиль, члены, контекст | 381 |
| `PatientLabResultsSection.jsx` | Результаты анализов из лаборатории | 251 |
| `PatientLoyaltySection.jsx` | Дашборд лояльности: тир, баллы, награды | 367 |
| `PatientSpendingSection.jsx` | «Расходник»: траты по году, графики | 373 |
| `PatientSubscriptionSection.jsx` | Премиум-подписка «Здоровье+» пациента | 806 |
| `PatientWellnessSection.jsx` | Wellness-партнёры со скидками/промокодами | 221 |
| `PaymentGatewaysSection.jsx` | Настройка Stripe/ЮKassa (super_admin) | 288 |

---

## `frontend/src/sections/MarketplaceSection.jsx`

- **Назначение:** Премиум-витрина платных модулей для FranchiseOwnerCabinet / super_admin: сетка карточек, модалка с деталями (скриншоты-карусель, фичи, цена), кнопки «триал / купить / отписаться».
- **Ключевые элементы:** default-экспорт `MarketplaceSection({ tenants, tenantId, onTenantChange })`; внутренние компоненты `ModuleCard` (карточка в сетке), `ModuleDetailModal` (модалка деталей с каруселью скриншотов). Хелперы `formatPrice`, `formatDate`. Словари `CATEGORY_LABELS`, `STATUS_BADGE`, `COMPLEXITY`, `FILTERS`. Действия `startTrial`/`activate`/`cancel`.
- **Эндпоинты (потребляет):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/marketplace/tenant/{id}/modules` | owner/super_admin | — | `[{module, subscription, trial_used}]` | Каталог + статусы подписок тенанта |
| POST | `/marketplace/tenant/{id}/modules/{key}/start-trial` | owner | `{}` | `{trial_ends_at}` | Активировать триал |
| POST | `/marketplace/tenant/{id}/modules/{key}/activate` | owner | `{billing_cycle:'monthly'}` | — | Купить (платная подписка) |
| POST | `/marketplace/tenant/{id}/modules/{key}/cancel` | owner | `{}` | — | Отписаться |

- **Зависимости:** `../api` (инстанс axios с Bearer); из `../design` — `Modal`, `Button`, `Chip`, `useToast`. Получает список тенантов пропсом сверху (из кабинета), сам тенантов не грузит.
- **Где менять для типовых задач:** новая категория модуля — добавить в `CATEGORY_LABELS` (label/color/bg/icon, иначе fallback на серый «extension»); новый статус подписки — `STATUS_BADGE`; набор фильтров-кнопок — массив `FILTERS` + ветки в `filtered` useMemo; логика «подключён» — массив `['active','trial','grace']` (встречается в `stats`, `filtered`, `isConnected` — менять во всех трёх).
- **Подводные камни:** «контролируемый/неконтролируемый» тенант — если `tenantIdProp` не передан, держится локальный `innerTid` (см. `tenantId = tenantIdProp ?? innerTid`). `formatPrice` использует `Math.round` — копейки теряются (для витрины ок). Дублирует словари `CATEGORY_LABELS`/`STATUS_BADGE` с `ModulesCatalogSection` (значения чуть разные: тут больше категорий — telemedicine/finance/inventory/loyalty/health).
- **Строк:** 645

## `frontend/src/sections/ModuleMonitoringSection.jsx`

- **Назначение:** Module Monitoring System — сетка карточек по платным модулям тенанта с health-статусом (ok/degraded/error/idle/unknown), авто-рефреш раз в 60 сек и кнопка «Проверить сейчас».
- **Ключевые элементы:** default-экспорт `ModuleMonitoringSection({ token })`; внутренний `ModuleCard({ row })`. Словари `MODULE_META` (ключ модуля → иконка+ярлык), `STATUS_META` (5 статусов с emoji/цветом). Хелпер `fmtTime`. Колбэки `load` (GET health), `checkNow` (POST + reload), счётчики `counts` (useMemo).
- **Эндпоинты (потребляет):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/admin/modules/health` | super_admin/owner | — | `{modules:[{module_key, health, subscription_status}]}` | Health всех модулей тенанта |
| POST | `/admin/modules/health/check-now` | super_admin/owner | — | — | Принудительная проверка сейчас |

- **Зависимости:** только `../api`. Бэкенд: `app/routers/module_monitoring.py` + `app/services/module_health_service.py` (указано в шапке файла).
- **Где менять для типовых задач:** добавить модуль в мониторинг — `MODULE_META[ключ]` (иначе fallback на сырой ключ + иконка «extension»); новый статус health — `STATUS_META` (плюс не забыть добавить в `counts` инициализацию `out`); интервал авто-рефреша — `setInterval(load, 60_000)` в `useEffect`.
- **Подводные камни:** `metrics` рендерятся как сырой `JSON.stringify` в `<details>` — потенциально PII/много данных. Таймер чистится в cleanup (`clearInterval(timerRef.current)`) — корректно. `last_error_message` обрезается до 160 символов в карточке, полный текст в `title`.
- **Строк:** 246

## `frontend/src/sections/ModulesCatalogSection.jsx`

- **Назначение:** Совмещённая секция каталога платных модулей платформы. Через `detectMode` рендерит один из двух режимов: `AdminCatalog` (super_admin — правит цены/активность модулей и управляет подписками выбранного тенанта) или `OwnerCatalog` (franchise_owner — read-only каталог + статусы по своим тенантам).
- **Ключевые элементы:** default-экспорт `ModulesCatalogSection({ token, mode })` → диспетчер; хелпер `detectMode` (по пропу или по `window.location.pathname.includes('franchise')`). Подкомпоненты `AdminCatalog` и `OwnerCatalog`. Действия admin: `savePrice`, `toggleActive`, `activateTrial`, `activateFull`, `disableForTenant`. Открывает редактор витрины `MarketplaceAdminEditor`.
- **Эндпоинты (потребляет):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/admin/modules` | super_admin | — | `[module]` | Каталог модулей платформы |
| PUT | `/admin/modules/{key}/price` | super_admin | `{price_monthly, price_annual}` | — | Изменить цену |
| PATCH | `/admin/modules/{key}` | super_admin | `{is_active}` | — | Включить/выключить в каталоге |
| GET | `/admin/tenants` | super_admin | — | `[tenant]` | Список тенантов |
| GET | `/admin/tenants/{id}/modules` | super_admin | — | `[{module, subscription}]` | Подписки тенанта |
| POST | `/admin/tenants/{id}/modules/{key}/enable` | super_admin | `{trial_days, billing_cycle}` | — | Trial/полная активация (trial_days=0 → платная) |
| POST | `/admin/tenants/{id}/modules/{key}/disable` | super_admin | `{}` | — | Отключить у тенанта |
| GET | `/franchise-owner/tenants` | owner | — | `[tenant]` | Мои тенанты (owner-режим) |
| GET | `/franchise-owner/tenants/{id}` | owner | — | `{modules:[{module_key, status,...}]}` | Модули тенанта (owner) |
| GET | `/modules/features` | owner | — | `[{name, label, category}]` | Публичный список модулей (owner-каталог) |

- **Зависимости:** `../api`; `./MarketplaceAdminEditor` (редактор витрины — открывается по кнопке storefront в admin-режиме). Словари `CATEGORY_LABELS`/`STATUS_BADGE` (свои, отличаются от MarketplaceSection — здесь 5 категорий).
- **Где менять для типовых задач:** добавить тип роли/режим — `detectMode`; в owner-режиме НЕТ бэк-эндпоинта на самоподключение, кнопка «Запросить» вызывает `requestEnable` → просто toast с инструкцией (TODO в коде, строки 502-507) — если появится бэк, менять здесь; категория — `CATEGORY_LABELS`.
- **Подводные камни:** **owner-режим частично заглушечный** — `requestEnable` не делает запрос, только уведомление. Owner строит `sourceList` из `/modules/features` (поля `{name,label,category}`), а если пусто — из подписок (`module_key`), цены при этом 0 — реальные цены owner не видит. `detectMode` по URL хрупок: если путь не содержит «franchise», но юзер — owner без пропа `mode`, попадёт в AdminCatalog (получит 403 на `/admin/*`). Сообщения через `msg`-строку с авто-сбросом `setTimeout`.
- **Строк:** 643

## `frontend/src/sections/PartnerClinicsSection.jsx`

- **Назначение:** Клиники-партнёры франшизы (Этап 14). Каждая клиника тенанта — партнёр с контрактом (royalty % / per_referral ₽ / hybrid). Таблица партнёров, предпросмотр выплаты за 30 дней, модалка редактирования контракта, пауза/resume/terminate, плюс кнопка подключения модуля `ltv_pro`.
- **Ключевые элементы:** default-экспорт `PartnerClinicsSection({ adminToken })`; подкомпоненты `ContractTypeCards` (3 объяснялки типов), `ContractEditModal` (форма контракта с live-preview расчёта), локальный `Icon`. Словари `CONTRACT_LABEL`, `STATUS_LABEL`, `REVENUE_SOURCE_LABEL`, `CONTRACT_TYPES`, текст `HINT_TEXT`. Хелперы `fmtRub`, `fmtDate`, `toInputDate`. Действия: `reload`, `calcPayout`, `setStatus`, `loadLtvForTenants`, `enableLtvForTenant`.
- **Эндпоинты (потребляет):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/franchise-owner/partner-clinics` | owner | — | `[partner]` | Список клиник-партнёров |
| PATCH | `/franchise-owner/partner-clinics/{id}/contract` | owner | `{contract_type, royalty_percent, bonus_per_referral, contract_signed_at, contract_expires_at, revenue_source}` | — | Обновить контракт |
| POST | `/franchise-owner/partner-clinics/{id}/calculate?period_days=30` | owner | `null` | `{total_amount, confirmed_referrals,...}` | Предпросмотр выплаты за период |
| POST | `/franchise-owner/partner-clinics/{id}/{pause\|resume\|terminate}` | owner | `null` | — | Сменить статус партнёра |
| GET | `/admin/tenants/{id}/modules` | super_admin | — | `[{module, subscription}]` | Проверка статуса ltv_pro |
| POST | `/admin/tenants/{id}/modules/ltv_pro/enable` | super_admin | `{billing_cycle, trial_days:14}` | — | Подключить LTV-аналитику |

- **Зависимости:** `../api`; из `../design` — `Card`, `Button`, `Chip`, `Modal`, `EmptyState`, `InfoHint`, `useToast`, `useConfirm`. Использует CSS-переменные темы (`var(--fg)`, `var(--accent)` и т.д.) — то есть подчиняется перетемизации tokens.css.
- **Где менять для типовых задач:** новый тип контракта — `CONTRACT_TYPES` + `CONTRACT_LABEL` + ветки в `rateText`, `showRoyalty/showPerRef`, валидации `submit` и live-preview; формула расчёта в preview (royalty % от 100000 + bonus × 30) — функция `submit`/preview-блок (строки 366-396), но фактический расчёт делает бэкенд `calculate`.
- **Подводные камни:** **⚠️ ЛАТЕНТНЫЙ ASI-БАГ.** В нескольких местах строка `(toast || (()=>{}))('...', '...')` стоит сразу после выражения без точки с запятой (например, `await api.patch(...)` затем с новой строки `(toast||...)(...)` — строки 247-248, 252-253, 459, 463, 476, 496, 536, 540). JS НЕ вставляет ASI перед строкой, начинающейся с `(`, поэтому это парсится как вызов результата предыдущего выражения как функции — `await api.patch(...)( ... )`. Сработает рантайм-ошибкой «is not a function» в этих ветках. При правке любой из этих функций добавлять `;` в конце предыдущего statement или явный `const t = toast || (()=>{}); t(...)`. `royalty_percent`/`bonus_per_referral` передаются как `Number(...)` — на бэке должны конвертироваться в Decimal, на фронте float (риск точности при крупных суммах). `revenue_source='mis'` тянет выручку из Renovatio автоматически — на фронте лишь подсказка.
- **Строк:** 709

## `frontend/src/sections/PatientCalendarSection.jsx`

- **Назначение:** Премиум-календарь пациента (Глава 9): hero-карточка ближайшего приёма, список следующих, и блок подписки на ICS-фид (Google/Apple/Outlook) с выпуском/отзывом персональных токенов.
- **Ключевые элементы:** default-экспорт `PatientCalendarSection({ sessionToken })`; хелперы `fmtRu`, `buildAbsoluteFeedUrl` (склейка относительного feed_url с `API_BASE`), `buildGoogleSubscribeUrl`, `buildWebcalUrl`. Действия `issueToken`, `revoke`, `copy`. Hero = первый из отсортированных `sorted`.
- **Эндпоинты (потребляет, через сырой axios + `?t=`):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/patient/calendar/upcoming` | пациент (`?t=`) | — | `[{id, datetime, clinic_name, doctor_name, service_name, address}]` | Предстоящие приёмы |
| POST | `/patient/calendar/issue-token` | пациент | `{}` | `{token, feed_url, id?}` | Выпустить ссылку-подписку |
| GET | `/patient/calendar/tokens` | пациент | — | `[{id, created_at, revoked_at}]` | Активные/отозванные токены |
| DELETE | `/patient/calendar/tokens/{id}` | пациент | — | — | Отозвать токен |

- **Зависимости:** `axios` (сырой!), `API_BASE` из `../config`, `useToast` из `../design`, компонент `../components/calendar/UpcomingCard`.
- **Где менять для типовых задач:** формат отображения приёма — `UpcomingCard` (внешний компонент); как строится подписочный URL под Google/webcal — три `build*Url`-хелпера; ключ сессии — константа `SESSION_KEY = 'clinika_patient_session'` (общая для всех патиент-секций).
- **Подводные камни:** Сессия — в query-param `?t=`, не Bearer. `feed_url` может приходить относительным — обязательно прогонять через `buildAbsoluteFeedUrl` (учитывает, что `API_BASE` уже может содержать `/api`). Использует глобальный `confirm()` для отзыва. `revoke` ищет `issued.id === id` — но `issue-token` может не вернуть `id`, тогда баннер не скроется (минор).
- **Строк:** 350

## `frontend/src/sections/PatientChatSection.jsx`

- **Назначение:** Mobile-first чат пациента с клиникой (Глава 9, редизайн июнь 2026). Список тредов + активный тред, отправка текста/файлов/стикеров, polling, запрос записи (slot request), upsell премиума на 402.
- **Ключевые элементы:** default-экспорт `PatientChatSection({ sessionToken, onGoSubscription })`; внутренние `EmptyChatIllustration` (inline SVG), `PremiumModal` (402-апселл). Lazy-компоненты `NewThreadModal`, `StickerPicker`. Логика: `fetchThreads`, `fetchThread(id, silent)`, `send`, `renderedMessages` (группировка с date-separator через `dateSeparatorLabel`/`sameDay`). Два polling-таймера (тред 10с, список 30с).
- **Эндпоинты (потребляет, `?t=`):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/patient/chat/threads` | пациент | — | `[thread]` | Список тредов |
| POST | `/patient/chat/threads` | пациент | (через NewThreadModal) | `{id}` | Создать тред |
| GET | `/patient/chat/threads/{id}` | пациент | `?limit=100&offset=0` | `{thread, messages}` | Сообщения треда |
| POST | `/patient/chat/threads/{id}/messages` | пациент | `{body}` или FormData(`body`+`attachments`) или `{body,attachments:[{type:'sticker'}]}` | — | Отправить сообщение/файл/стикер |
| POST | `/patient/chat/threads/{id}/read` | пациент | `{}` | — | Отметить прочитанным (silent) |

- **Зависимости:** `axios`, `API_BASE`, `useToast`; компоненты `../components/chat/{MessageBubble, ThreadListItem, PatientSlotRequestPicker}`, lazy `NewThreadModal`/`StickerPicker`. Связь с подпиской: на 402 показывает `PremiumModal`, кнопка → `onGoSubscription` (родитель переключает вкладку).
- **Где менять для типовых задач:** интервал polling — `POLL_MS` (10с тред) и `30_000` (список); своё/чужое сообщение — `isOwn = sender_type === 'patient' || 'me'`; лимит вложений — `.slice(0, 5)` в onChange файлового input; отправка стикера — inline-колбэк `onPick` в `StickerPicker` (строит JSON с `attachments:[{type:'sticker'}]`).
- **Подводные камни:** Mobile-логика через `mobileShowList`/`mobileShowChat` (по `activeId`) + Tailwind `hidden/flex md:flex` — на десктопе обе панели. Авто-скролл завязан на `lastMsgIdRef` чтобы не дёргать при silent-polling. Стикеры шлются отдельным запросом (не через общий `send`) — дублирование логики 402-обработки. `read` отправляется fire-and-forget (`.catch(()=>{})`).
- **Строк:** 674

## `frontend/src/sections/PatientChatsSection.jsx`

- **Назначение:** ⚠️ **Это АДМИНСКАЯ секция, не пациентская** (несмотря на имя). Инбокс чатов пациентов для регистратора/админа клиники: список чатов с поиском, правая панель переписки, переключение AI ↔ ручной режим, ответ от имени клиники.
- **Ключевые элементы:** default-экспорт `PatientChatsSection({ token })`; хелперы `fmtTime`, `fmtFullTime`, `maskPhone`. Внутренние JSX-блоки `ListPanel` и `ChatPanel`. Действия `fetchChats` (polling 8с), `fetchMessages` (polling 5с активного), `sendReply`, `toggleMode`. Поиск `filteredChats`, счётчик `totalUnread`.
- **Эндпоинты (потребляет, через `../api` Bearer):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/admin/patient-chats` | админ клиники | — | `{chats:[...]}` | Список чатов пациентов |
| GET | `/admin/patient-chats/{id}/messages` | админ | — | `{chat, messages}` | Сообщения чата (сбрасывает unread) |
| POST | `/admin/patient-chats/{id}/reply` | админ | `{text}` | `{chat, message}` | Ответ от имени клиники |
| POST | `/admin/patient-chats/{id}/toggle-mode` | админ | `{}` | `{chat}` | Переключить AI/ручной режим |

- **Зависимости:** только `../api`. Никаких внешних компонентов — всё inline.
- **Где менять для типовых задач:** интервалы polling — `setInterval(fetchChats, 8000)` и `fetchMessages, 5000`; типы отправителя сообщений — ветки `m.sender === 'patient'|'admin'|'assistant'` (цвет пузыря, подпись 🤖/👤/🧑); маскировка телефона — `maskPhone` (формат +7).
- **Подводные камни:** **Имя файла вводит в заблуждение** — путать с `PatientChatSection` (пациентской) легко. Эта секция ходит на `/admin/*` с Bearer — для пациента вернёт 403. `ai_messages_today`/`ai_daily_limit` показывают расход AI-лимита. Polling без отмены in-flight запросов (возможны гонки при медленной сети). `sendReply` оптимистично подмешивает сообщение из ответа сервера.
- **Строк:** 432

## `frontend/src/sections/PatientDocumentsSection.jsx`

- **Назначение:** Хранилище документов пациента (Глава 9): категории-табы, drag&drop на всю секцию, грид карточек, загрузка через модалку, preview в lightbox, скачивание/удаление.
- **Ключевые элементы:** default-экспорт `PatientDocumentsSection({ sessionToken })`; хелпер `plural` (русская плюрализация), `EmptyIllustration` (inline SVG). Lazy: `DocumentCard`, `DocumentUploadModal`, `ImageLightbox`. Константа `CATEGORIES` (8 категорий). Действия `downloadDoc`, `previewDoc`, `deleteDoc`, `onUploaded`, drag-хендлеры `onPageDragOver/Leave/Drop`. Счётчики `counts`, фильтр `filtered`.
- **Эндпоинты (потребляет, `?t=`):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/patient/documents` | пациент | — | `[doc]` (402→модуль off, 404→пусто) | Список документов |
| POST | `/patient/documents/upload` | пациент | multipart (file+category+title+description+visibility) | `{id,...}` | Загрузка (внутри UploadModal) |
| GET | `/patient/documents/{id}/download?t=` | пациент | — | file response | Скачать (window.open) |
| DELETE | `/patient/documents/{id}` | пациент | — | — | Удалить |

- **Зависимости:** `axios`, `API_BASE`, из `../design` — `useToast`, `useConfirm` (+`ConfirmHost`); lazy-компоненты `../components/documents/{DocumentCard, DocumentUploadModal, ImageLightbox}`.
- **Где менять для типовых задач:** новая категория документов — массив `CATEGORIES` (key/label/icon); preview/скачивание формируют URL с токеном в query — `downloadDoc`/`previewDoc` (токен в URL, т.к. это прямой переход браузера, не axios).
- **Подводные камни:** Токен сессии уходит в URL скачивания (`?t=...`) — попадёт в логи/историю браузера (так задумано для file-response, но это поверхность для утечки). `error` — строковый enum (`'module_off'`/`'load_failed'`), не объект. 404 трактуется как пустой список, 402 — как выключенный модуль.
- **Строк:** 347

## `frontend/src/sections/PatientFamilySection.jsx`

- **Назначение:** Семейный профиль пациента (Глава 8): создание/вступление в семейную группу по invite-токену, добавление родственников, управление разрешениями (видеть/записывать/платить), переключение активного контекста (смотреть кабинет родственника).
- **Ключевые элементы:** default-экспорт `PatientFamilySection({ sessionToken, ownerName, onContextChanged })`; внутренние `FamilySkeleton`, `FamilyOnboarding`. Действия `load`, `handleCreate`, `handleJoined`, `handleMemberAdded`, `handlePermChange`, `handleRelationChange`, `handleRemove`, `handleSwitch`, `handleRename`. Контекст пишется в `sessionStorage[ACTIVE_KEY]` + событие `patient:context-changed`.
- **Эндпоинты (потребляет, `?t=`):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/patient/family` | пациент | — | `{group_id, name, members[]}` или 404 | Состояние группы |
| POST | `/patient/family` | пациент | `{name}` | — | Создать группу |
| POST | `/patient/family/invite` | пациент | `{full_name, phone, relation, birth_date}` | — | Пригласить (через AddMemberModal) |
| POST | `/patient/family/accept-invite` | пациент | `{token}` | `{name}` | Принять приглашение |
| PATCH | `/patient/family/members/{id}` | пациент | `{relation?, can_*?}` | — | Изменить разрешения/родство |
| DELETE | `/patient/family/members/{id}` | пациент | — | — | Удалить члена |
| GET | `/patient/family/switch-context/{patient_id}` | пациент | — | `{patient_id, full_name}` | Переключить контекст |
| PATCH | `/patient/family` | пациент | `{name}` | — | Переименование (best-effort, может не быть на бэке) |

- **Зависимости:** `axios`, `API_BASE`, `useToast`; компоненты `../components/family/{FamilyMemberCard, AddMemberModal, AcceptInviteModal}`.
- **Где менять для типовых задач:** новое поле разрешения — пробрасывается универсально через `handlePermChange(memberId, field, value)` (имя поля любое `can_*`); сортировка членов (self сверху) — `sortedMembers`; событие смены контекста ловят другие секции по `window` event `patient:context-changed`.
- **Подводные камни:** **PATCH `/patient/family` (переименование) — best-effort, контракт не гарантирован** — при ошибке silent, имя не меняется (комментарий в коде, строки 250-251). Защита от legacy-эндпоинта: если ответ массив — трактуется как «нет группы». `handleSwitch` пишет контекст в `sessionStorage` (живёт до закрытия вкладки). `window.confirm` для удаления.
- **Строк:** 381

## `frontend/src/sections/PatientLabResultsSection.jsx`

- **Назначение:** Результаты анализов пациента (Глава 10): карточки заявок (только delivered/results_ready), разворот → таблица результатов с флагами отклонений, скачивание PDF.
- **Ключевые элементы:** default-экспорт `PatientLabResultsSection({ sessionToken })`; внутренние `CardSkeleton`, `HintBlock` (info/warn/success-плашки), хелпер `fmtDate`. Действие `downloadPdf` (blob → `<a download>`). Фильтрация `visible` (по статусу или наличию `results`). Подсчёт `flaggedCount`.
- **Эндпоинты (потребляет, `?t=`):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/patient/lab-results` | пациент | — | `[{id, date, provider_name, doctor_name, test_codes[], results[], status}]` (402→модуль off) | Список заявок/результатов |
| GET | `/patient/lab-results/{id}/pdf` | пациент | `responseType:'blob'` | PDF blob | Скачать PDF (fallback alert) |

- **Зависимости:** `axios`, `API_BASE`, компонент `../components/lab/LabResultsTable`. НЕ использует `useToast` — ошибки PDF через `alert()`.
- **Где менять для типовых задач:** какие статусы показывать пациенту — фильтр `visible` (`['delivered','results_ready']` + наличие `results`); число превью-кодов тестов — `tests.slice(0, 5)`; таблица значений — внешний `LabResultsTable`.
- **Подводные камни:** PDF скачивается через blob + `responseType:'blob'` (токен в params, не в URL) — при неудаче нативный `alert()` вместо тоста (несогласованность UX). `flaggedCount` считается по `o.results[].flagged` — если бэк не отдал `results`, всегда «В норме». `no_session` обрабатывается как отдельная плашка.
- **Строк:** 251

## `frontend/src/sections/PatientLoyaltySection.jsx`

- **Назначение:** Премиум-дашборд лояльности пациента (Глава 8): hero-карточка тира с прогресс-баром до следующего уровня, табы История/Награды/Достижения. Достижения вычисляются эвристикой на фронте (без отдельного API).
- **Ключевые элементы:** default-экспорт `PatientLoyaltySection({ sessionToken })`; `PageStub` (плашки), `buildAchievements(account)` (8 ачивок по total_spent/tier/стажу). Lazy: `LoyaltyTransactionsList`, `LoyaltyRewardsCatalog`. Словарь `NEXT_LABEL` (следующий тир). Расчёт `progressPct` от `next_tier_at`.
- **Эндпоинты (потребляет, `?t=`):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/patient/loyalty/account` | пациент | — | `{points, tier, next_tier_at, points_to_next_tier, total_spent, joined_at, last_activity_at}` (402→off) | Состояние счёта лояльности |

- **Зависимости:** `axios`, `API_BASE`; `../components/loyalty/TierBadge` (импортирует `TierBadge`, `TIER_PALETTE`, `paletteFor`); lazy `LoyaltyTransactionsList`, `LoyaltyRewardsCatalog` (им передаётся `sessionToken`). `LoyaltyRewardsCatalog.onClaimed` → `load` (рефреш баллов после обмена).
- **Где менять для типовых задач:** список достижений — `buildAchievements` (id/icon/label/условие unlocked); порядок тиров — массив `['bronze','silver','gold','platinum']` (в `buildAchievements` и `progressPct`); цвета/иконки тира — в `TierBadge` (`TIER_PALETTE`, `paletteFor`); 404 → один повторный запрос (бэк auto-create на первом хите).
- **Подводные камни:** Достижения — чистая фронт-эвристика, могут разойтись с реальной логикой бэка. `progressPct` ломается если `next_tier_at <= 0` (тогда 100%). Все числа через `Number(...)` — копейки `total_spent` в float (для отображения ок).
- **Строк:** 367

## `frontend/src/sections/PatientSpendingSection.jsx`

- **Назначение:** «Расходник» пациента (Глава 8): сводка трат за год — hero с total_spent, donut по категориям, bar по месяцам, top-5 клиник, экспорт PDF. Графика без библиотек (чистый CSS conic-gradient / flex-бары).
- **Ключевые элементы:** default-экспорт `PatientSpendingSection({ sessionToken })`; внутренние чарты `DonutChart` (conic-gradient), `MonthBars` (12 столбцов), `ClinicBars` (горизонтальные). Хелперы `fmtRub`, `getYearOptions`. Палитра `CAT_PALETTE`, `MONTH_NAMES`. Подготовка данных `catEntries`/`clinicEntries`/`monthValues` (useMemo). Действие `handlePdf` (window.open).
- **Эндпоинты (потребляет, `?t=`):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/patient/spending-summary` | пациент | `?year=YYYY` | `{year, total_spent, appointments_count, by_category, by_clinic, by_month[12], loyalty_earned_this_year, saved_with_loyalty}` (402→off) | Сводка трат за год |
| GET | `/patient/spending-summary/export.pdf?year=` | пациент | `&t=` | PDF | Экспорт PDF (window.open) |

- **Зависимости:** `axios`, `API_BASE`. Никаких внешних компонентов и чарт-библиотек — всё inline на CSS.
- **Где менять для типовых задач:** годы в селекторе — `getYearOptions` (текущий + 2 назад); палитра категорий — `CAT_PALETTE` (циклична по индексу); число клиник в топе — `.slice(0, 5)` в `clinicEntries`. PDF-экспорт открывает URL с токеном в query.
- **Подводные камни:** PDF-URL содержит `?t=...` (токен в URL). `monthValues` дополняет массив нулями до 12 — защита от короткого ответа. Donut строится накопительным conic-gradient — при множестве мелких категорий стопы сливаются. Все суммы через `Number(...)` (float).
- **Строк:** 373

## `frontend/src/sections/PatientSubscriptionSection.jsx`

- **Назначение:** Премиум-подписка пациента «Здоровье+» (Глава 9 v2). Три состояния: модуль выключен (CTA в чат за наличный расчёт), нет подписки (hero + 3 PlanCardV2 + toggle monthly/annual + таблица сравнения + FAQ), есть подписка (hero + привилегии + auto-renew + история + cancel/resume). Deeplink «Подробнее» открывает чат с клиникой.
- **Ключевые элементы:** default-экспорт `PatientSubscriptionSection({ sessionToken })`; внутренние `PageStub`, `Skeleton`, `accentFor`. Lazy: `PlanCardV2`, `CancelModal`, `BenefitsList`, `BenefitsCategoryAccordion`, `InquireBottomSheet`, `PlanComparisonTable`. Константы `FALLBACK_PLANS` (3 локальных тарифа), `FAQ`, `STATUS_LABEL`, `TIER_ACCENT`. Действия `startPlan`, `cancelSub`, `resumeSub`, `toggleAutoRenew`, `openBenefitDetail`, `openInquiryInChat`, `openCashInquiry`.
- **Эндпоинты (потребляет, `?t=`):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/patient/subscription/plans` | публичный | — | `[plan]` или `{plans, module_active}` (402→off) | Тарифы |
| GET | `/patient/subscription/my` | пациент | — | подписка или 404 | Текущая подписка |
| GET | `/patient/subscription/benefits` | пациент | — | `{benefits}` | Текущие привилегии |
| GET | `/patient/subscription/history` | пациент | — | `[платёж]` | История платежей |
| GET | `/patient/subscription/plans/{plan_key}/benefits-detail` | публичный | — | детали по категориям | Раскрытие «Подробнее» |
| POST | `/patient/subscription/start` | пациент | `{plan, billing}` | `{redirect_url?}` | Оформить (может вернуть редирект на оплату) |
| POST | `/patient/subscription/cancel` | пациент | `{reason, comment?}` | — | Отменить |
| POST | `/patient/subscription/resume` | пациент | `{}` | — | Возобновить |
| PATCH | `/patient/subscription/my` | пациент | `{auto_renew}` | — | Авто-продление |
| POST | `/patient/subscription/inquire-details` | пациент | `{plan_key, category}` | `{thread_id}` | Создать запрос в чат |

- **Зависимости:** `axios`, `API_BASE`, `useToast`; lazy-компоненты `../components/subscription/*`. Связь с чатом: `openInquiryInChat`/`openCashInquiry` пишут `sessionStorage['pending_subscription_inquiry']` и шлют `window` event `patient:navigate` (tab `chats-hub`) — родитель/PatientChatHub подхватывает.
- **Где менять для типовых задач:** добавить тариф — серверный `/plans`, плюс при недоступности `FALLBACK_PLANS` (локальный fallback с `summary_benefits`); цвет акцента тира — `TIER_ACCENT`; FAQ — массив `FAQ`; статусы — `STATUS_LABEL`. Оплата: `start` может вернуть `redirect_url` → `window.location.href`.
- **Подводные камни:** Жирная толстая секция (806 строк) — много состояний. `module_active=false` НЕ скрывает карточки, а переводит CTA в «связаться с клиникой» (наличный сценарий). 402 при загрузке `/plans` → fallback на локальные планы + `module_active=false`. `inquire-details` намеренно глотает ошибку (даже на 404/501 делает deeplink). `openInquiryInChat` имеет stale-closure-риск на `inquireBusy` (в deps), но guard в начале. Detail рендерится по-разному mobile (BottomSheet) vs desktop (Accordion) — `isMobileViewport` + resize-listener.
- **Строк:** 806

## `frontend/src/sections/PatientWellnessSection.jsx`

- **Назначение:** Wellness-партнёры пациента (Глава 10): сетка карточек партнёров со скидками, категории-табы, карточки с замком если нет нужной подписки, клик «Подробнее» → POST /click, копирование промокода в буфер и открытие ссылки партнёра.
- **Ключевые элементы:** default-экспорт `PatientWellnessSection({ sessionToken })`; внутренние `HintBlock`, `CardSkeleton`, async `copyToClipboard` (с fallback execCommand). Действие `onOpen` (POST click → промокод+ссылка), локальный `flashToast`. Сортировка: разблокированные сверху, затем по `sort_order`.
- **Эндпоинты (потребляет, `?t=`):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/patient/wellness/partners` | пациент | — | `[{id, name, category, description, logo_url, discount_text, min_subscription_plan, promo_code, link_url, locked?}]` (402→off) | Список партнёров |
| POST | `/patient/wellness/partners/{id}/click` | пациент | `null` | `{link_url, promo_code}` | Зафиксировать клик, выдать промокод/ссылку |

- **Зависимости:** `axios`, `API_BASE`; компоненты `../components/wellness/{PartnerCard, CategoryTabs}`. Собственный локальный toast (НЕ `useToast` из design).
- **Где менять для типовых задач:** фильтрация по категории — `filtered`/`counts` (нормализация `category.toLowerCase()`); сортировка карточек — компаратор в `load`; вид карточки и замка — внешний `PartnerCard` (проп `locked`).
- **Подводные камни:** Использует собственный `toast`-state (`flashToast`), а не общий `useToast` — несогласованность с другими патиент-секциями. `window.open` после await может блокироваться попап-блокером (комментарий в коде допускает это — промокод уже в буфере + toast виден). `locked`-партнёры всё равно приходят с бэка (фильтруются только сортировкой вниз) — реальная защита доступа на бэке.
- **Строк:** 221

## `frontend/src/sections/PaymentGatewaysSection.jsx`

- **Назначение:** Настройка платёжных шлюзов платформы (super_admin): Stripe и ЮKassa — ввод public/secret-ключей с маскировкой, сохранение, локальная «проверка подключения», ссылки на дашборды провайдеров.
- **Ключевые элементы:** default-экспорт `PaymentGatewaysSection({ token })`; адаптер `apiFetch(method, url, _token, data)` → просто `api({...})`; конфиг `PROVIDERS` (stripe, yookassa — лейблы/хинты/docUrl); подкомпонент `GatewayCard` с локальным состоянием ключей, `handleSave`, `handleTest`.
- **Эндпоинты (потребляет, через `../api` Bearer):**

| Метод | Путь | Доступ | Принимает | Возвращает | Назначение |
|-------|------|--------|-----------|------------|------------|
| GET | `/admin/payment-gateways` | super_admin | — | `[{provider, public_key, secret_key_present, configured, public_key_present}]` | Список шлюзов |
| POST | `/admin/payment-gateways/{providerKey}` | super_admin | `{public_key, secret_key?}` | — | Сохранить ключи |

- **Зависимости:** только `../api`. Никаких внешних компонентов.
- **Где менять для типовых задач:** добавить провайдера (например, CloudPayments) — элемент в массив `PROVIDERS` (key/name/icon/labels/hints/docUrl) — карточка отрисуется автоматически; реальная серверная проверка ключей — сейчас `handleTest` только локальная валидация длины с искусственным `setTimeout(500)` (TODO — заменить на запрос к бэку).
- **Подводные камни:** **`handleTest` НЕ проверяет ключи на сервере** — это заглушка (локальная проверка длины > 4). Секрет с бэка не приходит (только `secret_key_present`) — поле остаётся пустым, при сохранении пустой `secret_key` НЕ отправляется (не перезатирает существующий — логика в `handleSave`: `if (secretKey) body.secret_key = secretKey`). Ключи на бэке хранятся в `system_settings`, шифруются на уровне БД (см. подсказку снизу). Webhooks подтверждения оплаты настраиваются в отдельном разделе «Вебхуки».
- **Строк:** 288
