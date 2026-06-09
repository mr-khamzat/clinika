# sections [03] — Франшиза, Manager-аналитика, утилиты редактирования

Это срез из 15 frontend-секций кабинета «КлиникСеть» (`frontend/src/sections/`). Все файлы — React-компоненты (`*.jsx`), которые рендерятся внутри готовых страниц (`pages/`) или вкладок и сами не определяют роутинг. Срез распадается на четыре смысловые группы:

1. **Кабинет франшизы (`franchise_owner`)** — консолидированная аналитика по всей сети клиник: P&L, перелив пациентов, gap-анализ платных модулей, override тарифов подписки. Дёргают эндпоинты `/franchise-owner/*` и `/admin/subscription-plans/*`.
2. **Управление франшизами (`super_admin`)** — `FranchisesSection` (CRUD франшиз + создание владельцев) и `ImpersonationsTab` (журнал входов под чужой учёткой).
3. **Глава 4 «Manager productivity»** — пять секций кабинета управляющего: прогноз расходов, тепловая карта загрузки врачей, Kanban-расписание, мультиклиника, шаблоны направлений; плюс наличная активация подписок.
4. **Утилиты/редакторы** — `ImageCropEditor` (canvas-кроп без зависимостей), `MarketplaceAdminEditor` (редактор витрины модуля), `InterClinicInvoicesSection` (межклиничные счета).

Общие конвенции среза:
- Сетевой слой — единый axios-инстанс `../api` (auto-Bearer + auto-refresh). Импорт называется `api` или `apiClient`.
- Дизайн-система `../design` (`Card`, `Button`, `Tabs`, `EmptyState`, `Modal`, `useToast`, `useConfirm`, `Skeleton`, KPI-компоненты). Часть старых секций (`FranchisesSection`, `InterClinicInvoicesSection`) написана на Tailwind-классах и захардкоженных hex-цветах в обход дизайн-токенов — это легаси-стиль.
- Графики рисуются вручную через SVG/CSS (без recharts/chart.js) — сознательное решение «без новых зависимостей».
- Tenant-изоляция — целиком на стороне backend; токен из axios несёт tenant_id. Фронт не фильтрует по tenant_id, кроме `FranchiseSubscriptionPlansSection`, который явно тащит свой `tenant_id` через `/admins/me`.

| Файл | Назначение в 5-7 слов | Строк |
|------|----------------------|-------|
| `FranchiseModuleGapsSection.jsx` | Gap-анализ неподключённых платных модулей сети | 203 |
| `FranchisePnlSection.jsx` | Консолидированный P&L всей сети клиник | 359 |
| `FranchiseReferralsSection.jsx` | Heatmap-матрица перелива пациентов между клиниками | 235 |
| `FranchiseSubscriptionPlansSection.jsx` | Override тарифов подписки для своей сети | 177 |
| `FranchisesSection.jsx` | CRUD франшиз + создание владельцев (super_admin) | 584 |
| `ImageCropEditor.jsx` | Canvas-редактор кропа/поворота/удаления фона | 325 |
| `ImpersonationsTab.jsx` | Журнал impersonation-сессий super_admin | 216 |
| `InterClinicInvoicesSection.jsx` | Межклиничные счета: список, создание, печать | 226 |
| `ManagerCostForecast.jsx` | SVG-прогноз расходов клиники на N месяцев | 261 |
| `ManagerDoctorLoad.jsx` | Heatmap загрузки врачей + экспорт CSV | 210 |
| `ManagerKanbanSchedule.jsx` | Kanban-расписание с drag&drop статусов | 290 |
| `ManagerMultiClinicView.jsx` | Панорама всех доступных менеджеру клиник | 171 |
| `ManagerReferralTemplates.jsx` | CRUD шаблонов направлений менеджера | 273 |
| `ManagerSubscriptionCashSection.jsx` | Наличная активация подписок: wizard+история+статистика | 1292 |
| `MarketplaceAdminEditor.jsx` | Редактор marketplace-полей модуля (super_admin) | 173 |

---

## `frontend/src/sections/FranchiseModuleGapsSection.jsx`
- **Назначение:** Кабинет франшизы → «Остатки модулей». Показывает, какие платные модули не подключены в клиниках сети, считает упущенную MRR и даёт отправить рекомендацию о подключении.
- **Ключевые элементы:** дефолтный экспорт `FranchiseModuleGapsSection()`; хелпер `fmtRub`. Состояния: `summary`, `items`, `expanded` (tenant_id→bool, раскрытие списка), `pushing` (tenant_id→bool, блокировка кнопки). `load()` тянет summary и список параллельно через `Promise.all`. `handlePush(tenantId, moduleKey)` — отправка рекомендации (moduleKey=null → по всем модулям клиники).
- **Эндпоинты:** компонент-потребитель, не роутер. Использует:
  - `GET /franchise-owner/module-gaps/summary` — total_potential_revenue, top_missing_modules, clinics_with_gaps.
  - `GET /franchise-owner/module-gaps` — `items[]` по клиникам (missing_modules с key/name/category/monthly_price_rub).
  - `POST /franchise-owner/module-gaps/push-recommendation` — body `{ tenant_id, module_key }`.
- **Зависимости:** `../api`; из `../design` — `Card`, `Button`, `Chip`, `EmptyState`, `Skeleton`, `useToast`.
- **Где менять для типовых задач:** новые поля карточки клиники — блок `items.map` (строки 136-197); изменить раскладку топ-модулей — `gridTemplateColumns` в строке 106; формат суммы — `fmtRub`.
- **Подводные камни:** `useToast?.()` вызывается опционально (защита от отсутствия провайдера) — паттерн копируется по всему franchise-срезу. `load` обёрнут в `useCallback([])` с пустыми зависимостями, поэтому при добавлении параметров фильтрации не забыть про deps. Money — обычные number из JSON, форматирование чисто на клиенте.
- **Строк:** 203

---

## `frontend/src/sections/FranchisePnlSection.jsx`
- **Назначение:** Кабинет франшизы → Финансы → P&L. Консолидированный отчёт прибылей/убытков по всей сети: 4 KPI (Revenue, Gross Margin, Taxes, Net Income), переключатель периода и ставки налога, две вкладки графиков (по клиникам / по месяцам).
- **Ключевые элементы:** дефолтный экспорт `FranchisePnlSection()`; внутренние компоненты `ByClinicChart` (CSS bar-chart), `ByMonthChart` (рукописный SVG line-chart с двумя линиями), `SourceBox`, `Legend`. Хелперы `fmtRub`, `fmtPct`, массив `PERIODS`. `queryParams` (useMemo) собирает строку из period/from/to/tax_rate. `taxRate` по умолчанию 0.06 (УСН 6%).
- **Эндпоинты:** потребитель:
  - `GET /franchise-owner/pnl/summary?period=&from=&to=&tax_rate=` — revenue, gross_margin, cogs, taxes, net_income, platform_fee, revenue_by_clinic[], revenue_breakdown, cogs_source ('stub' → плашка «учёт расходов не ведётся»).
  - `GET /franchise-owner/pnl/by-month?months=12&tax_rate=` — by_month[] (month/revenue/net_income).
- **Зависимости:** `../api`; из `../design` — `Card`, `KpiRow`, `KpiCard`, `Tabs`, `Button`, `Chip`, `EmptyState`, `Skeleton`, `useToast`.
- **Где менять для типовых задач:** новый налоговый режим — `<select>` строки 167-172; новые источники выручки — `revenue_breakdown` + `SourceBox` (строки 219-229); изменить геометрию графика по месяцам — константы `W/H/PAD` и функции `sx`/`sy` в `ByMonthChart` (строки 288-294).
- **Подводные камни:** при `period === 'custom'` запрос не делается пока не заполнены **обе** даты (строки 95-98) — иначе спиннер уходит, но данных нет. `grossPct`/`netPct` защищены от деления на ноль (`revenue > 0`). `by-month` всегда тянется с `tax_rate`, а `summary` — со всем queryParams; рассинхрон ставки между двумя запросами невозможен, т.к. оба берут актуальный `taxRate`.
- **Строк:** 359

---

## `frontend/src/sections/FranchiseReferralsSection.jsx`
- **Назначение:** Кабинет франшизы → «Перелив пациентов». Тепловая матрица направлений `from-clinic × to-clinic` с количеством cross-clinic-referral и суммой по партнёрским офферам + топ-5 направлений.
- **Ключевые элементы:** дефолтный экспорт `FranchiseReferralsSection()`; внутренний `Stat`. `byPair` — индекс ячеек `{ "${from}|${to}": row }`. `maxCount` для нормализации интенсивности цвета. Период-пикер идентичен `FranchisePnlSection` (тот же массив `PERIODS`, та же логика custom).
- **Эндпоинты:** потребитель. В коде реально вызывается только `GET /franchise-owner/referrals/matrix?period=&from=&to=` (возвращает `{ matrix[], tenants[], totals }`, где `totals.top_directions` уже включает топ). Эндпоинт `/referrals/top` упомянут в шапке-комментарии, но **не используется** — топ-5 берётся из `totals.top_directions`.
- **Зависимости:** `../api`; из `../design` — `Card`, `Button`, `Chip`, `EmptyState`, `Skeleton`, `useToast`.
- **Где менять для типовых задач:** цветовая шкала ячейки — формула `bg` (строки 150-152, `rgba(59,130,246, 0.12 + intensity*0.6)`); диагональ (from===to) — отрисовка `—` строка 159; контент ячейки/tooltip — строки 156-166.
- **Подводные камни:** sticky-колонка с именем клиники использует `background: var(--ks-bg, white)` — при тёмной теме без переменной `--ks-bg` будет белый артефакт. Матрица строится по `tenants[]`, пары без переливов = пустая ячейка (`·`). Несоответствие документации (комментарий обещает второй эндпоинт `/referrals/top`, которого в коде нет) — потенциальная путаница при доработке.
- **Строк:** 235

---

## `frontend/src/sections/FranchiseSubscriptionPlansSection.jsx`
- **Назначение:** Кабинет франшизы → тарифы подписки для пациентов своей сети. Показывает effective-планы (глобальные + override) и даёт создать/изменить/сбросить override на свой tenant_id.
- **Ключевые элементы:** дефолтный экспорт `FranchiseSubscriptionPlansSection({ adminToken })` (проп `adminToken` принимается, но в теле не используется — токен идёт через axios); внутренний `Kpi`, хелпер `fmtPrice`. Lazy-загрузка `PlanEditorModal` и `PlanComparisonCard` из `../components/subscription/`. Сначала тянет `/admins/me` → `tenant_id`, потом грузит планы. `onReset` спрашивает подтверждение и удаляет override.
- **Эндпоинты:** потребитель:
  - `GET /admins/me` — чтобы узнать свой `tenant_id`.
  - `GET /admin/subscription-plans/effective?tenant_id=<my>` — `plans[]` с флагом `has_override`.
  - `GET /admin/subscription-plans/kpi` — active_count, mrr, arpu, cancelled_30d, churn_pct_30d.
  - `POST /admin/subscription-plans/override`, `PATCH /admin/subscription-plans/override/{id}`, `DELETE /admin/subscription-plans/override/{id}` (POST/PATCH делаются внутри `PlanEditorModal`).
- **Зависимости:** `../api`; из `../design` — `useToast`, `useConfirm`; lazy-компоненты `../components/subscription/PlanEditorModal`, `../components/subscription/PlanComparisonCard`.
- **Где менять для типовых задач:** новые KPI-плитки — блок строки 121-128; параметры редактора (что можно/нельзя менять франчайзи) — пропы `PlanEditorModal`: `lockPlanKey={true}` (plan_key всегда из глобального шаблона), `hideActive={true}` (нельзя скрыть тариф целиком), `mode="override"`.
- **Подводные камни:** это **единственная** секция среза, которая явно работает с `tenant_id` на фронте — если `/admins/me` не вернёт tenant_id, показывается заглушка «Не удалось определить тенант» (строки 130-134). KPI-запрос обёрнут в собственный try/catch — его падение не ломает загрузку планов. Использует токены `var(--bg)`, `var(--line)`, `var(--fg-2)` (другой набор, чем franchise-аналитика с `--ks-*`).
- **Строк:** 177

---

## `frontend/src/sections/FranchisesSection.jsx`
- **Назначение:** Раздел super_admin «Франшизы». Создание/редактирование/удаление франшиз, назначение владельца (роль `franchise_owner`) с возможностью inline-создания нового пользователя-владельца. Включает Region Lock (географический контроль).
- **Ключевые элементы:** дефолтный экспорт `FranchisesSection({ token })`; хелпер `slugify` (транслитерация кириллицы → латиница для URL); `apiFetch(m,url,_t,d)` — тонкая обёртка над `api`, параметр токена оставлен для совместимости сигнатуры и **больше не используется**. Константы `EMPTY_FORM` (с `allowed_region`/`region_strict`), `EMPTY_OWNER_FORM`. Состояния формы, inline owner-формы, confirmDelete-модалки. `submitOwner` создаёт владельца и авто-выбирает его. Авто-slug отключается флагом `slugManual` при ручном вводе/редактировании.
- **Эндпоинты:** потребитель:
  - `GET /admin/franchises` (список с tenant_count, mrr_sum), `POST /admin/franchises`, `PATCH /admin/franchises/{id}`, `DELETE /admin/franchises/{id}`.
  - `GET /admin/users?role=franchise_owner` (кандидаты в владельцы), `POST /admin/users` (создать владельца).
- **Зависимости:** только `../api`. Дизайн-система НЕ используется — целиком Tailwind-классы и Material Symbols. Toast/confirm реализованы вручную (`showMsg`, модалка `confirmDelete`).
- **Где менять для типовых задач:** новое поле франшизы — добавить в `EMPTY_FORM`, `openEdit`, тело `submit` (строки 179-190) и UI-форму; правила транслитерации slug — `slugify`; логика Region Lock — блок строки 491-534 (фронт лишь отправляет `allowed_region`/`region_strict`, сравнение с geo_region из IP — на backend).
- **Подводные камни:** пароль нового владельца показывается **один раз** (блок `ownerCreated`, строки 452-460) — повторно не получить. Пустой `allowed_region` бэк трактует как «снять регион» (комментарий строка 187). Строгий режим Region Lock может ложно блокировать клиентов с VPN (предупреждение в UI). Легаси-стиль: захардкоженные tailwind-цвета вместо дизайн-токенов; самый объёмный CRUD-файл среза.
- **Строк:** 584

---

## `frontend/src/sections/ImageCropEditor.jsx`
- **Назначение:** Встроенный редактор кропа изображений без внешних зависимостей. Canvas + мышь/тач: кроп, зум, поворот на ±90°, пресеты соотношений, удаление фона flood-fill от краёв. Используется при загрузке логотипов/баннеров/фото.
- **Ключевые элементы:** дефолтный экспорт `ImageCropEditor({ src, mime='image/jpeg', onDone, onCancel })` — `src` это base64 (без data-префикса). Чистая функция `floodFillRemoveBg(imageData, tolerance)` — заливка от 4 углов, делает прозрачным фон. Внутри: `draw()` (рисует кадр+маску+рамку+сетку третей+угловые маркеры), `getZone`/`getCursor` (определение зоны drag/resize по 8 точкам + move), `toRel`, `onMouseMove`/`onMouseDown`/`onMouseUp` (поддерживают touch), `removeBackground`, `apply` (вырезает финальный кроп с учётом rotation/zoom и вызывает `onDone(base64, mime)`). Константа `RATIOS`.
- **Эндпоинты:** нет, чистый клиентский компонент.
- **Зависимости:** только React-хуки (`useEffect/useRef/useState/useCallback`). Никаких api/design — самодостаточный. Потребители передают `onDone`/`onCancel`.
- **Где менять для типовых задач:** новые соотношения сторон — массив `RATIOS` (строки 7-14); чувствительность удаления фона — `tolerance` (вызов `floodFillRemoveBg(imageData, 35)` строка 199, и формула `< tolerance*3` строка 30); качество экспорта — `toDataURL(outMime, 0.92)` строка 240; размер рабочего canvas — `width={600} height={400}` строка 248.
- **Подводные камни:** `apply()` при `rotation === 0` пересчитывает кроп с `zoom` напрямую (`sx*zoom...`), а при повороте рисует через промежуточный canvas — две разные ветки, при правке учитывать обе. Удаление фона форсирует выходной mime в `image/png` (нужна прозрачность). flood-fill итеративный (стек, не рекурсия) — но на больших изображениях (naturalWidth×naturalHeight) может быть тяжёлым; обёрнут в `requestAnimationFrame` чтобы не фризить UI. Координаты кропа хранятся в относительных долях (0..1), пересчёт в пиксели — через размеры canvas, а не natural-размеры.
- **Строк:** 325

---

## `frontend/src/sections/ImpersonationsTab.jsx`
- **Назначение:** Вкладка журнала impersonation-сессий (вход super_admin под учёткой пользователя тенанта). Подключается как ещё одна вкладка внутри `AuditLogSection`. Показывает кто/кого/тенант/причину/длительность/IP+город/статус.
- **Ключевые элементы:** дефолтный экспорт `ImpersonationsTab()`; хелперы `fmtDate`, `fmtDuration` (секунды → «Xч Yм»), словарь `ROLE_LABELS` (ключи ролей → русские названия). Состояния: `items`, `loading`, `err`, `days` (фильтр 7/30/90/365). Эффект с флагом `on` (cleanup от race-condition при размонтировании). Активные сессии (`still_active`) подсвечиваются мигающей красной плашкой (inline `@keyframes imp-blink`).
- **Эндпоинты:** потребитель: `GET /admin/impersonate/history?days=&limit=200` — возвращает `{ items[] }` с полями actor_name, target_name, target_role, target_username, tenant_slug, reason, started_at, stopped_at, duration_seconds, ip_address, geo_city/geo_country, still_active. Только super_admin.
- **Зависимости:** только `../api`. Дизайн-система не используется — inline-стили с CSS-переменными `var(--fg, ...)`, `var(--bg, ...)` и fallback-значениями.
- **Где менять для типовых задач:** новые роли в журнале — словарь `ROLE_LABELS` (строки 40-46); колонки таблицы — массив заголовков строка 132 + соответствующие `<td>`; диапазоны фильтра — `<select>` строки 90-93.
- **Подводные камни:** сессии хранятся не отдельной таблицей, а как пары событий `impersonation.started`/`impersonation.stopped` в основном `audit_log` (см. комментарий-шапку) — backend склеивает их в сессии. `ROLE_LABELS` неполон относительно всех ролей системы — неизвестная роль выводится как есть. Эффект перезапускается при смене `days`; флаг `on` нужен, чтобы поздний ответ не записал в размонтированный компонент.
- **Строк:** 216

---

## `frontend/src/sections/InterClinicInvoicesSection.jsx`
- **Назначение:** Межклиничные счета — расчёты между клиниками сети (реферальные бонусы, роялти, ручные счета, корректировки). Список с вкладками (входящие/исходящие/все), создание счёта, смена статуса, печать акта.
- **Ключевые элементы:** дефолтный экспорт `InterClinicInvoicesSection({ isSupervisor=false, token })`; внутренние `Badge` (статус), `InvoiceTable`. Словари `STATUS_LABEL` (draft/sent/paid/cancelled) и `TYPE_LABEL`. Состояния: `tab`, `invoices`, `clinics`, `form` (создание), `printInvoiceId`. `load(t)` выбирает эндпоинт по вкладке. `handleAction(action,id)` → PATCH pay/cancel. `handleCreate` → POST. Lazy-импорт `ActPrintModal` объявлен, но фактически используется статический импорт `./ActPrintModal` (строка 2).
- **Эндпоинты:** потребитель:
  - `GET /clinic-invoices/all` | `/clinic-invoices/incoming` | `/clinic-invoices/outgoing` (по вкладке).
  - `GET /clinics/` — список клиник-получателей.
  - `POST /clinic-invoices` — body `{ recipient_clinic_id, amount (parseFloat), description, due_date }`.
  - `PATCH /clinic-invoices/{id}/pay` | `/cancel`.
- **Зависимости:** `../api`; `./ActPrintModal` (модалка печати акта); из `../design` — `useToast`, `EmptyState`. Импортирует `lazy, Suspense` но их не применяет (мёртвый импорт).
- **Где менять для типовых задач:** новые типы счетов — `TYPE_LABEL`; новые статусы/цвета — `STATUS_LABEL`; набор действий в строке таблицы — блок кнопок `InvoiceTable` (строки 67-82); набор вкладок по роли — `TABS` (строки 148-150).
- **Подводные камни:** `amount` отправляется как `parseFloat(form.amount)` (float) — потенциальная потеря точности по сравнению с Decimal на backend; форматирование суммы через `inv.amount.toLocaleString(...currency RUB)`. Легаси-стиль: захардкоженные hex-цвета вместо токенов, emoji в кнопках («📄 Акт», «✕»). Проп `isSupervisor` пробрасывается в `InvoiceTable`, но внутри не используется (только меняет набор вкладок и стартовую вкладку). Печать акта требует `token` (передаётся напрямую в `ActPrintModal`).
- **Строк:** 226

---

## `frontend/src/sections/ManagerCostForecast.jsx`
- **Назначение:** Кабинет управляющего (Глава 4) → прогноз расходов клиники. Рукописный SVG-график: сплошная линия — история, пунктир — прогноз на 1/3/6/12 месяцев, заливка — доверительный интервал. Breakdown по категориям расходов.
- **Ключевые элементы:** дефолтный экспорт `ManagerCostForecast()`; внутренний `BreakdownTable` (категории bonuses/salaries/supplies). Словарь `CONF_LABEL`. `chart` (useMemo) — вся геометрия: масштабирующие функции `x`/`y`, точки `histPts`/`forePts`, путь `bandPath` доверительного интервала. Фильтр `{ clinic_id, months_ahead }`.
- **Эндпоинты:** потребитель:
  - `GET /manager/clinics-accessible` — селектор клиник.
  - `GET /manager/analytics/cost-forecast?clinic_id=&months_ahead=` — `{ history[], forecast[], trend, stats{confidence,r2}, warning, available_categories[] }`.
- **Зависимости:** `../api`; из `../design` — `Card`, `Button`, `EmptyState`.
- **Где менять для типовых задач:** новые категории расходов — массив `cats`/`labels` в `BreakdownTable` (строки 222-223; ключи должны совпадать с полями `history[]`); горизонты прогноза — `<select>` строки 98-101; геометрия графика — useMemo `chart` (строки 47-75).
- **Подводные камни:** селектор клиник показывается только при `clinics.length > 1` (одиночная клиника → запрос без clinic_id). `load` вызывается в эффекте без обёртки useCallback с `eslint-disable` (строка 44) — при добавлении зависимостей нужно вручную синхронизировать массив deps. `BreakdownTable` суммирует только три захардкоженных категории — если backend вернёт новые, они не отобразятся без правки `cats`. Деление на ноль защищено (`max=Math.max(1, ...)`, `total || 1`).
- **Строк:** 261

---

## `frontend/src/sections/ManagerDoctorLoad.jsx`
- **Назначение:** Кабинет управляющего (Глава 4) → тепловая карта загрузки врачей. Для каждого врача матрица 7 дней × часы с цветовой шкалой (0=серый, 1-2=жёлтый, 3-4=оранжевый, 5+=красный) + метрики и экспорт CSV.
- **Ключевые элементы:** дефолтный экспорт `ManagerDoctorLoad()`; внутренние `DoctorHeatmap`, `Stat`; чистые функции `cellColor`/`cellTextColor` (oklch-цвета). `exportCsv` — нативный Blob-download CSV с BOM (`﻿`) для корректной кириллицы в Excel, без html2canvas. Фильтр `{ clinic_id, date_from, date_to }` (по умолчанию последние 30 дней).
- **Эндпоинты:** потребитель:
  - `GET /manager/clinics-accessible` — селектор.
  - `GET /manager/analytics/doctor-load?clinic_id=&date_from=&date_to=` — `{ doctors[], hours[], days[] }`; у врача `load_matrix[dow][hour]`, `tooltip_data`, avg_load_pct, idle_windows_count, overtime_days, total_appointments.
- **Зависимости:** `../api`; из `../design` — `Card`, `Button`, `EmptyState`.
- **Где менять для типовых задач:** цветовые пороги ячеек — `cellColor`/`cellTextColor` (строки 25-36); колонки CSV — массивы в `exportCsv` (строки 73-77); метрики в шапке карточки врача — компоненты `Stat` в `DoctorHeatmap` (строки 142-145).
- **Подводные камни:** `EmptyState` здесь получает проп `subtitle` (строка 121), тогда как в других секциях используется `description` — разнобой в API дизайн-компонента, проверить актуальную сигнатуру `EmptyState`. CSV использует `;`-экранирование кавычек и BOM — не менять без проверки в Excel. tooltip ячейки склеивает count + `tooltip_data["dow-hour"]`. `load` с `eslint-disable` как и в CostForecast.
- **Строк:** 210

---

## `frontend/src/sections/ManagerKanbanSchedule.jsx`
- **Назначение:** Кабинет управляющего (Глава 4) → Kanban-доска расписания по 4 статусам (scheduled/confirmed/in_progress/completed) с нативным HTML5 drag&drop, фильтрами и polling раз в 30 сек.
- **Ключевые элементы:** дефолтный экспорт `ManagerKanbanSchedule({ onSwitchView })`; константы `COLS` (колонки) и `PRIO_COLORS`. DnD-обработчики `onDragStart`/`onDragOver`/`onDrop` — **оптимистичное** локальное перемещение карточки, затем PATCH; при ошибке — `load()` для rollback. `pollTimer` (useRef) — setInterval 30000, silent-перезагрузка. Фильтр `{ clinic_id, doctor_id, date_from, date_to }`. `onSwitchView` рисует Tabs «День/Неделя/Kanban».
- **Эндпоинты:** потребитель:
  - `GET /manager/clinics-accessible` — селектор клиник.
  - `GET /manager/appointments/kanban?clinic_id=&doctor_id=&date_from=&date_to=` — `{ columns{scheduled,confirmed,in_progress,completed}, doctors[] }`.
  - `PATCH /manager/appointments/{id}/status` — body `{ status }`.
- **Зависимости:** `../api`; из `../design` — `Card`, `Button`, `Tabs`, `EmptyState`, `useToast`.
- **Где менять для типовых задач:** новые статусы/колонки — массив `COLS` (строки 22-27; ключи должны совпадать с ключами `columns` от backend); приоритеты карточек — `PRIO_COLORS`; интервал polling — `setInterval(... 30000)` строка 74; поля карточки — блок рендера `items.map` (строки 226-274).
- **Подводные камни:** `toast` здесь — это **результат** `useToast()` напрямую, и вызывается как `toast?.error?.(...)`/`toast?.success?.(...)` (строки 64,109,112) — иной контракт, чем `const { toast } = useToast()` в других секциях; при рефакторинге дизайн-системы проверить, что `useToast()` возвращает объект с методами `.error`/`.success`. Оптимистичный DnD мутирует копию `data.columns` через splice — `card.status` меняется на месте; rollback только через полную перезагрузку. Polling и фильтры завязаны на один эффект с `eslint-disable`.
- **Строк:** 290

---

## `frontend/src/sections/ManagerMultiClinicView.jsx`
- **Назначение:** Кабинет управляющего (Глава 4) → панорама всех клиник, доступных менеджеру. Live-снимок: метрики дня, врачи онлайн, алёрты (переработка/нет регистратора/долгий простой). Раздел скрыт у менеджеров с одной клиникой.
- **Ключевые элементы:** дефолтный экспорт `ManagerMultiClinicView()`; внутренние `ClinicCard`, `Mini`; словарь `ALERT_LABELS` (overtime/no_registrar/idle_long → label+color+icon). `onSwitch` сохраняет выбранную клинику в `localStorage['clinika_active_clinic_id']` и диспатчит `window` event `clinika-active-clinic-changed` (слушается `ClinicScopeSelector`).
- **Эндпоинты:** потребитель: `GET /manager/multi-clinic-overview` — `{ clinics[], is_multi }`; у клиники `today{appointments_count, completed_count, pending_count}`, `online_doctors[]`, `alerts[]`, `last_activity`.
- **Зависимости:** `../api`; из `../design` — `Card`, `Button`, `EmptyState`. Внешняя связь — событие `clinika-active-clinic-changed` для синхронизации с `ClinicScopeSelector` (вне этого файла).
- **Где менять для типовых задач:** новые типы алёртов — словарь `ALERT_LABELS` (строки 19-23); метрики дня — компоненты `Mini` (строки 99-101); логика переключения активной клиники — `onSwitch` (строки 67-71) — здесь же localStorage-ключ и имя события.
- **Подводные камни:** видимость пункта меню по `is_multi` решается **снаружи** (App.jsx + _ManagerShell, см. комментарий-шапку) — флаг приходит в ответе, но сам компонент его не использует для скрытия. Переключение клиники — через localStorage + window-event, а не через React-контекст: при правке синхронизации искать парный слушатель в `ClinicScopeSelector`. Врачи онлайн обрезаются до 5 (`+N` сверху).
- **Строк:** 171

---

## `frontend/src/sections/ManagerReferralTemplates.jsx`
- **Назначение:** Кабинет управляющего (Глава 4) → CRUD шаблонов направлений. Шаблон хранит свободный JSON-payload (referral_type, priority, notes, services[], target_doctor_id, lab_tests), который при применении подставляется в форму направления.
- **Ключевые элементы:** дефолтный экспорт `ManagerReferralTemplates()`; внутренние `Field`, `Tag`. Константы `PRIORITIES`, `TYPES`. Состояние `editor` (null | новый | {id,...}) рендерит `Modal`. `openNew`/`openEdit` задают дефолтный payload. `save` различает create (POST) / update (PATCH) по наличию `editor.id`.
- **Эндпоинты:** потребитель:
  - `GET /manager/clinics-accessible` — селектор.
  - `GET /manager/referral-templates?clinic_id=` — список (поля name, description, clinic_id, payload, usage_count).
  - `POST /manager/referral-templates`, `PATCH /manager/referral-templates/{id}`, `DELETE /manager/referral-templates/{id}`.
  - В шапке упомянут `POST /manager/referral-templates/{id}/use` (возвращает payload для подстановки) — вызывается **не здесь**, а в форме направления (`ReferralCreateForm`/`AppointmentsCalendarSection`).
- **Зависимости:** `../api`; из `../design` — `Card`, `Button`, `Modal`, `EmptyState`, `useToast`.
- **Где менять для типовых задач:** новые типы/приоритеты направления — `TYPES`/`PRIORITIES`; новые поля payload — добавить в `openNew` дефолт + соответствующий `Field` в Modal (строки 189-236); поле `lab_tests` показывается только при `referral_type === 'lab'` (условный блок строки 228-235).
- **Подводные камни:** удаление через нативный `confirm()` (строка 82), а не через `useConfirm` дизайн-системы — несогласованность UX. `clinic_id === null` означает «общий шаблон для всех клиник тенанта». `toast` вызывается как `toast?.error?.()/.success?.()` (контракт как в Kanban, не `{ toast }`). payload — свободный JSON, схему держит фронт по соглашению, backend хранит как есть.
- **Строк:** 273

---

## `frontend/src/sections/ManagerSubscriptionCashSection.jsx`
- **Назначение:** Премиум-секция управляющего: активация подписок «Здоровье+»/«Семья+»/«Pro» по наличной оплате прямо в клинике. Три вкладки: 5-шаговый wizard активации, история активаций (фильтры+печать), статистика (KPI+графики). Самый крупный файл среза. Используется в `pages/ManagerSubscriptionCash.jsx` (роут `/manager/subscription-cash`).
- **Ключевые элементы:** дефолтный экспорт `ManagerSubscriptionCashSection()` (роутер вкладок). Крупные внутренние компоненты: `ActivateWizard` (шаги 1-5: пациент→тариф→срок→оплата→успех), `HistoryTab`, `StatsTab`. Вспомогательные: `ProgressBar`, `PatientHeaderCard`, `StepTitle`, `SecondaryBackButton`, `PrimaryNextButton`, `SummaryRow`, `ConfirmModal` (свой, не из design), `KpiCardCash`, `ChartCard`, `Th`/`Td`/`FieldLabel`/`DateInput`. Хелперы `fmtDate`/`fmtDateLong`/`fmtMoney`/`initials`, `withApi(path)` (склейка с baseURL axios для прямых ссылок на PDF). Lazy-импорты подкомпонентов из `../components/subscription-cash/` + `RegMobilePatientForm`. Импорт `calcPrice, PERIOD_OPTIONS` из `PeriodSelector`. StatsTab рисует bar-chart, donut через CSS `conic-gradient`, top-3 клиники.
- **Эндпоинты:** потребитель (axios назван `apiClient`):
  - `POST /manager/subscription-cash/activate` — body `{ patient_id, plan_key, months, amount_received, note }`.
  - `GET /patient/subscription/plans` — тарифы.
  - `GET /manager/subscription-cash/history?from=&to=&patient_q=&limit=50`.
  - `GET /manager/subscription-cash/stats?period=7d|30d|90d` — total_activations, total_revenue, avg_check, trend[], by_plan[], by_clinic[].
  - `GET /manager/subscription-cash/{id}/receipt.pdf` — печать чека (открывается через `withApi` + `window.open`).
  - Поиск пациента `GET /referrals/patients/search?q=` — внутри lazy `PatientSearchPicker`.
- **Зависимости:** `../api` (как `apiClient`); из `../design` — `Tabs`, `useToast`, `EmptyState`. Lazy: `../components/subscription-cash/{PatientSearchPicker,PlanSelector,PeriodSelector,PaymentConfirmStep,SuccessReceipt}`, `../components/RegMobilePatientForm`. Расчёт цены — `calcPrice` из `PeriodSelector` (single source of truth для скидок по периоду).
- **Где менять для типовых задач:** новые тарифы — словарь `PLAN_TITLES` (строки 41-45) + цвета `PLAN_COLORS` в StatsTab (строки 1007-1011); шаги wizard — `ActivateWizard` + `ProgressBar` (`stepsMeta`); формула цены/скидки — НЕ здесь, а в `../components/subscription-cash/PeriodSelector` (`calcPrice`); колонки истории — `Th`/`Td` в `HistoryTab` (строки 845-852, 857-896); графики статистики — `StatsTab` (trend bars, conic-gradient donut, top-3).
- **Подводные камни:** деньги (`amount_received`) отправляются как `Number(amount)` (float) — рассинхрон с Decimal backend возможен; суммы в UI через `toLocaleString('ru-RU')`. `confirmActivate` — отдельная «последняя точка возврата» перед POST, чтобы исключить случайную активацию. `confirmReactivate` срабатывает если у пациента уже есть `subscription_plan_key`+`subscription_expires_at`. `withApi` зависит от `apiClient.defaults.baseURL` — если baseURL поменяется, ссылки на PDF могут сломаться. PDF receipt открывается прямой ссылкой (`window.open`), т.е. авторизация по cookie/токену должна работать вне axios-интерсептора. `HistoryTab.load` зависит от from/to/patientQ, но эффект перезагрузки слушает только from/to (поиск по имени — по Enter/кнопке). Собственный `ConfirmModal` дублирует функциональность `useConfirm` из дизайн-системы.
- **Строк:** 1292

---

## `frontend/src/sections/MarketplaceAdminEditor.jsx`
- **Назначение:** Модалка super_admin для редактирования marketplace-полей (витрины) модуля: скриншоты, список фич, дни триала, флаг «популярно», сложность подключения, демо-цена. Открывается из `ModulesCatalogSection` (кнопка «✨ Витрина»).
- **Ключевые элементы:** дефолтный экспорт `MarketplaceAdminEditor({ moduleKey, onClose, onSaved })`. `load()` тянет весь список модулей и ищет нужный по `key`, преобразует массивы (screenshots/features_list) в текст (join `\n`) для textarea. `save()` обратно парсит textarea в массивы (split `\n`, trim, filter), приводит числа, шлёт PATCH.
- **Эндпоинты:** потребитель:
  - `GET /admin/modules` — весь список (фильтрует по `moduleKey` на клиенте, отдельного GET-by-key нет).
  - `PATCH /admin/modules/{key}/marketplace` — body `{ screenshots[], features_list[], default_trial_days, popular, setup_complexity, monthly_price_demo }`.
- **Зависимости:** `../api`; из `../design` — `Modal`, `Button`, `useToast`.
- **Где менять для типовых задач:** новые поля витрины — добавить в `setData` (load, строки 33-40), `body` (save, строки 53-60) и UI-блок формы; варианты сложности — `<select>` строки 123-131; дефолт триала (14) — строки 38 и 56.
- **Подводные камни:** грузит **весь** `/admin/modules` ради одного модуля — при росте каталога неэффективно, но GET-by-key отсутствует. `monthly_price_demo` — `'' → null`, иначе `Number(...)` (демо-цена «от X ₽/мес», используется только если основная цена = 0). При ненайденном модуле молча закрывает модалку с тостом. `toast` вызывается как `toast(msg, 'error'|'success')` (позиционный контракт) — отличается от объектного `toast({type,message})` в franchise-секциях; разнобой контрактов `useToast` по кодовой базе.
- **Строк:** 173
