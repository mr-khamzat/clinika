# План: Кабинет Директора (Финансовая отчётность сети)

**Версия:** 0.1 (draft)
**Дата:** 2026-05-15
**Автор:** Claude + Khamzat
**Статус:** Обсуждение

---

## 1. Цель

Добавить отдельный read-only кабинет для роли `director` — руководителя всей сети
(франшизы), который видит сводную финансовую и операционную картину всех клиник
сети, но **ничего не правит**. Это «бухгалтерский глаз» владельца бизнеса,
отделённый от `franchise_owner` (который может править настройки франшизы) и от
`manager` (оперативный кабинет конкретной клиники).

### Use-case
> «Я владелец сети из 5 клиник. Хочу за минуту увидеть: сколько мы заработали в
> этом месяце, сколько потратили на ФОТ/аренду/налоги/лабу, чистая прибыль по
> каждой клинике, какие услуги дают деньги, откуда идут пациенты, ROI рекламы.»

---

## 2. Архитектурный обзор: что уже есть

### Готовые роли (`UserRole` enum)
`super_admin`, `franchise_owner`, `manager`, `doctor`, `reg`, `nurse`,
`recruiter`, `partner_doctor`, `visiting_doctor`, `patient`.

### Готовые таблицы (доходная сторона)
- `services` — услуги клиник
- `appointments`, `appointment_outcomes` — приёмы и их исходы
- `payments`, `clinic_payments` — оплаты пациентов
- `invoices`, `franchise_invoices`, `inter_clinic_invoices` — счета
- `franchise_internal_acts` — внутренние акты франшизы
- `billing_ledger`, `ledger_entries` — двойная запись
- `loyalty_transactions`, `payment_gateway_configs`
- `lab_orders` — заказы в лабораторию (расход на сторону)

### Готовые API-эндпоинты, которые можно переиспользовать
- `analytics.py`: `/overview`, `/funnel`, `/dynamics`, `/top-services`,
  `/top-staff`, `/clinics`, `/ledger-trend`
- `franchise_revenue.py`: `/franchise-owner/revenue/dashboard`, `/by-clinic`
- `franchise_analytics.py`: `/admin/analytics/cohort-clinics`, `/franchise-kpi`
- `ledger.py`: `/balance`, `/summary`, `/history`
- `franchise_owner.py`: `/me`, `/tenants` (агрегаты по сети)

### Готовые страницы фронта (Manager-кабинет)
`ManagerFinance`, `ManagerAnalytics`, `ManagerKPI`, `ManagerForecast`,
`ManagerInvoices`, `ManagerSubscriptionCash`, `ManagerMultiClinic`,
`FranchiseRevenue`.

> **Вывод:** для **доходной части** и **аналитики KPI/маркетинга** инфраструктура
> уже есть. Большая часть Director-кабинета — это новый «вид» (frontend) поверх
> существующих API + расширение доступа для роли `director`.

---

## 3. Чего НЕТ и что придётся завести

### Расходная сторона — пустая
В БД нет таблиц для:
- ФОТ / зарплат / премий сотрудников (отдельных от bonus-системы рекрутёра)
- Аренды помещений
- Коммунальных платежей
- Налогов (НДФЛ, страховые взносы, УСН)
- Закупок расходных материалов
- Платежей внешним подрядчикам (лаба, IT, юристы)
- Маркетинговых расходов (отдельных от ad-tracking'а в `ads.py`)

> **Это блокер.** Без таблиц расходов раздел «Расходы» и «ДДС» физически не
> наполнить. Решения:
>
> **A. Минимум (MVP):** ввести универсальную таблицу `expenses` с категориями
>    и `expense_categories` (справочник). Импорт расходов вручную/из CSV.
>
> **B. Полноценно:** отдельные таблицы `payroll`, `rent_contracts`,
>    `tax_payments`, `supply_orders` — каждая со своими атрибутами. Дольше,
>    но точнее. Можно растянуть на 2-3 итерации.
>
> **C. Интеграция с 1С/Контур:** парсить выгрузки. Это работа на месяц+.

Рекомендация: начать с (A) — одна таблица `expenses` с `category`,
`amount`, `paid_at`, `clinic_id`, `description`, `attachments`. Категории
дают разрезы для отчётов. Через 1-2 спринта смотрим — где не хватает
структуры — и выделяем отдельную таблицу.

### Схема таблицы `expenses` (черновик)
```sql
CREATE TABLE expenses (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  clinic_id       UUID REFERENCES clinics(id) ON DELETE SET NULL,
  category_id     UUID NOT NULL REFERENCES expense_categories(id),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency        VARCHAR(3) DEFAULT 'RUB',
  paid_at         DATE NOT NULL,
  period_from     DATE,            -- для аренды, ФОТ: за какой период
  period_to       DATE,
  description     TEXT,
  counterparty    VARCHAR(255),    -- кому платили
  payment_method  VARCHAR(50),     -- cash / bank / card
  attachments     JSONB DEFAULT '[]',   -- ссылки на чеки/акты
  created_by_id   UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE expense_categories (
  id          UUID PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id),  -- NULL = глобальная категория
  code        VARCHAR(50) NOT NULL,         -- 'payroll', 'rent', 'tax', 'lab', ...
  name        VARCHAR(200) NOT NULL,
  parent_id   UUID REFERENCES expense_categories(id),  -- иерархия
  is_system   BOOLEAN DEFAULT FALSE,
  sort_order  INTEGER DEFAULT 0
);
```

Базовые категории (предзаполняем системными):
- `payroll` (ФОТ) → `payroll.salary`, `payroll.bonus`, `payroll.tax`
- `rent` (Аренда)
- `utilities` (Коммуналка)
- `tax` (Налоги) → `tax.usn`, `tax.ndfl`, `tax.insurance`
- `supplies` (Расходники)
- `lab` (Лаборатория)
- `marketing` (Маркетинг) → `marketing.ads`, `marketing.smm`
- `it` (IT / подписки / связь)
- `other` (Прочее)

---

## 4. Роль `director`: модель и доступ

### 4.1. Добавление в `UserRole` enum
В `backend/app/models/user.py`:
```python
class UserRole(str, enum.Enum):
    # ... существующие ...
    DIRECTOR = "director"
```

### 4.2. Связь с франшизой
Директор привязан к франшизе. Варианта два:

| Вариант | Плюс | Минус |
|---|---|---|
| (A) `users.franchise_id` FK | Просто. Один директор = одна франшиза | Если нужно несколько директоров на одну франшизу — норм; обратное (один директор на 2 франшизы) — не покрывается |
| (B) join-table `franchise_directors(franchise_id, user_id)` | Гибко: many-to-many | Сложнее |

**Рекомендация: A.** В Клинике один директор обычно курирует одну сеть. Если в
будущем понадобится — мигрируем в B. Сейчас `franchise_id` уже есть в логике
через `tenant.franchise_id`, нужен прямой FK у пользователя.

### 4.3. RBAC-зависимости
В `backend/app/core/deps.py` добавить:
```python
async def require_director(user: User = Depends(get_current_user)) -> User:
    """Только директор или super_admin."""
    if user.role not in (UserRole.DIRECTOR, UserRole.SUPER_ADMIN):
        raise HTTPException(403, "Доступ только для директора сети")
    return user

async def require_director_or_owner(user: User = Depends(get_current_user)) -> User:
    """Директор, владелец франшизы или super_admin — для read-эндпоинтов
    сетевой отчётности."""
    if user.role not in (UserRole.DIRECTOR, UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN):
        raise HTTPException(403, "Недостаточно прав")
    return user
```

### 4.4. Гарантия read-only на уровне БД (опционально, но желательно)
Для **критичных эндпоинтов** записи (POST/PUT/DELETE/PATCH) проверить, что
`UserRole.DIRECTOR` НЕ попадает в `require_*` зависимости. Можно добавить
sanity-тест: пройтись по всем роутерам и убедиться, что директор не имеет
write-доступа нигде.

Дополнительный bottle-neck — middleware, который при `user.role == DIRECTOR`
блокирует не-GET HTTP-методы для всех роутов кроме `/auth/*` и `/director/*/me`.
Можно сделать в `main.py`:
```python
@app.middleware("http")
async def director_readonly_guard(request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        # извлекаем user, проверяем role == DIRECTOR
        # → возврат 403 для любых пишущих методов
        ...
```
Это страховка «второго эшелона»: даже если случайно где-то забыли — глобально
закрыто.

---

## 5. Бэкенд: новый роутер `director.py`

Создать `backend/app/routers/director.py`:

```
GET  /director/me                        # данные директора + сводка по сети
GET  /director/dashboard                 # топ-метрики на главной (выручка/прибыль/счета)
GET  /director/pnl                       # P&L отчёт за период (?from=&to=&granularity=)
GET  /director/pnl/by-clinic             # P&L разбивка по клиникам
GET  /director/pnl/by-service            # выручка по услугам
GET  /director/pnl/by-doctor             # выручка по врачам
GET  /director/expenses                  # таблица расходов (?from=&to=&clinic_id=&category=)
GET  /director/expenses/summary          # сводка расходов по категориям
GET  /director/cashflow                  # ДДС по дням/месяцам
GET  /director/cashflow/balance          # остатки по кассам/счетам
GET  /director/kpi                       # KPI: средний чек, конверсия, LTV
GET  /director/kpi/funnel                # воронка: лид → запись → приём → оплата
GET  /director/marketing/sources         # источники пациентов
GET  /director/marketing/roi             # ROI по рекламным каналам
GET  /director/export/{report}.xlsx      # экспорт в Excel любого отчёта
GET  /director/export/{report}.pdf       # экспорт в PDF
```

Все эндпоинты используют `require_director_or_owner`. Большинство просто
агрегирует данные из существующих сервисов с фильтром по `franchise_id`
текущего пользователя.

---

## 6. Фронтенд: `DirectorCabinet`

### 6.1. Структура страниц
```
frontend/src/pages/
├── DirectorLayout.jsx              # шелл с сайдбаром
├── director/
│   ├── DirectorDashboard.jsx       # главная: ключевые метрики
│   ├── DirectorPnL.jsx             # доходы/расходы/прибыль
│   ├── DirectorExpenses.jsx        # детализация расходов
│   ├── DirectorCashflow.jsx        # ДДС, остатки
│   ├── DirectorKPI.jsx             # KPI и воронка
│   ├── DirectorMarketing.jsx       # маркетинг и реклама
│   └── DirectorReports.jsx         # выгрузки и архив отчётов
```

### 6.2. Главный экран `DirectorDashboard`
Виджеты (4×3 grid):
1. **Выручка за месяц** (текущий vs прошлый, %)
2. **Расходы за месяц** (с разбивкой на топ-3 категории)
3. **Чистая прибыль** (большая цифра + sparkline за 12 мес)
4. **Cashflow** (поступления − выплаты за месяц)
5. **По клиникам** (мини-таблица: клиника / выручка / прибыль / маржа)
6. **Топ-5 услуг по выручке**
7. **Топ-5 врачей по выработке**
8. **Воронка** (лиды → записи → приёмы → оплаты)
9. **Дебиторка** (неоплаченные счета, сумма)
10. **Источники пациентов** (donut)
11. **ROI рекламы** (по каналам)
12. **Алерт-лента** (просрочка налогов, спад выручки, etc.)

Дашборд **только переключатель периода**: текущий месяц / прошлый / квартал /
год / произвольный диапазон.

### 6.3. Главное правило UI
- **Никаких кнопок «Сохранить», «Отправить», «Изменить»**. Только просмотр,
  фильтры, сортировка, экспорт.
- В каждом разделе кнопка «📊 Экспорт» (Excel + PDF).
- В разделе с расходами — пометка «Данные вводятся в кабинете Менеджера»
  с link'ом, чтобы директор знал, где этим занимается персонал.

---

## 7. Чеклист добавления роли (6 мест)
> По [feedback_clinika_cabinets] добавление роли требует правки в 6 местах.
> Перечисляю явно, чтобы не забыть:

1. **`backend/app/models/user.py`** — добавить `DIRECTOR = "director"` в enum
2. **Alembic migration** — `ALTER TYPE user_role ADD VALUE 'director'`
3. **`backend/app/core/deps.py`** — `require_director`, `require_director_or_owner`
4. **`backend/app/routers/director.py`** — новый роутер + регистрация в `main.py`
5. **Frontend router** (`App.jsx` или `main.jsx`) — маршрут `/director/*`
6. **Frontend cabinet menu** — кнопка/линк «Кабинет Директора» на странице
   Login после успешной авторизации в зависимости от роли

Плюс:
7. **Сидер/seed** — функция «создать директора» в админке `super_admin`
   (`/admin/users` → создать с ролью director, привязать `franchise_id`)
8. **Тесты** — пара pytest-кейсов: директор не может POST/PUT, может GET

---

## 8. Поэтапный план работ

### Этап 1: Каркас роли (1-2 дня)
- [ ] Миграция: enum value `director` + `users.franchise_id` FK
- [ ] `UserRole.DIRECTOR` в `models/user.py`
- [ ] `require_director*` в `core/deps.py`
- [ ] Пустой роутер `director.py` с `GET /director/me`
- [ ] `super_admin` UI: создать пользователя-директора
- [ ] Логин → редирект на `/director`
- [ ] `DirectorLayout.jsx` с боковым меню (заглушки)
- [ ] Безопасность: middleware-страховка read-only

**Артефакт:** залогинились директором, видим пустую главную, не можем ничего
изменить.

### Этап 2: Доходная часть (2-3 дня)
- [ ] `GET /director/pnl`, `/by-clinic`, `/by-service`, `/by-doctor`
- [ ] `GET /director/dashboard` (виджеты выручки)
- [ ] `DirectorDashboard.jsx` — виджеты 1, 5, 6, 7
- [ ] `DirectorPnL.jsx` — таблица доходов с фильтрами и экспортом
- [ ] Экспорт в Excel/PDF (можно переиспользовать существующие хелперы)

**Артефакт:** директор видит доходы по сети, услугам, врачам, клиникам.

### Этап 3: Расходная часть (3-4 дня)
- [ ] Миграция: `expenses`, `expense_categories` + seed категорий
- [ ] CRUD расходов в кабинете Manager (`ManagerExpenses.jsx`) — это **новое
      место ввода данных**, без него Director-кабинет нечем будет наполнить
- [ ] `GET /director/expenses`, `/expenses/summary`
- [ ] `DirectorExpenses.jsx` — таблица + диаграмма по категориям
- [ ] Виджет «Расходы за месяц» на дашборде

**Артефакт:** менеджер вносит расходы, директор видит сводку расходов.

### Этап 4: ДДС и KPI (2-3 дня)
- [ ] `GET /director/cashflow` (банковские счета + кассы)
- [ ] `DirectorCashflow.jsx`
- [ ] `GET /director/kpi*`, `/marketing/*`
- [ ] `DirectorKPI.jsx`, `DirectorMarketing.jsx`

**Артефакт:** полная картина: P&L + ДДС + KPI + маркетинг.

### Этап 5: Полировка и алерты (1-2 дня)
- [ ] Алерт-лента на дашборде (просрочка налогов, проседание выручки)
- [ ] Сохранение пресетов отчётов
- [ ] Email-дайджест «Сводка за вчера» в 9:00 МСК
- [ ] Тесты read-only гарантий

**Артефакт:** production-ready Director-кабинет.

**Итого:** ~9-14 рабочих дней. Реально — 2-3 недели календарно с учётом
параллельных задач.

---

## 9. Открытые вопросы (требуют решения до этапа 2)

1. **Кто будет вносить расходы?**
   Менеджер клиники? Бухгалтер? Сам директор делегирует кому-то? От ответа
   зависит UX `ManagerExpenses.jsx` и набор полей.

2. **Многовалютность?**
   Сейчас в `expenses.currency` зашит RUB. Если планируется работа в
   Казахстане/Беларуси — нужно делать сразу с курсами.

3. **Период замыкания (closing the books)?**
   Должна ли быть кнопка «Закрыть месяц» с фиксацией данных, чтобы потом не
   менялись? Это бухгалтерский нюанс.

4. **Привязка к 1С/Эльба/Контур?**
   Если бухгалтерия уже ведётся в 1С — нужен импорт. Если нет — можно сделать
   Клинику единственным источником правды.

5. **Маркетинговые расходы — отдельно от `expenses`?**
   В `ads.py` уже есть отдельная система трекинга рекламных бюджетов. Стоит
   ли расходы на маркетинг хранить там, а в `expenses` — только сводно?
   Или дублировать?

6. **Должен ли директор видеть зарплаты конкретных сотрудников?**
   Или только агрегаты по категориям? Это вопрос приватности и доступа к
   персональным данным.

7. **HR-аналитика — в Директор-кабинете или отдельный кабинет?**
   Текучка кадров, найм, нагрузка врачей — это часть отчётности или другой
   модуль?

---

## 10. Что НЕ делаем в этой итерации

- ❌ Бюджетирование (план/факт) — будущая фича
- ❌ Сложная ABC-аналитика клиентов — позже
- ❌ Прогнозирование AI — пока ручной экспорт в Excel
- ❌ Мобильное приложение Директора — после стабилизации web
- ❌ Поддержка нескольких юрлиц в одной франшизе — пока 1 франшиза = 1 юрлицо

---

## 11. Метрики успеха

- Директор открывает кабинет утром, за 60 секунд понимает финансовое состояние
  сети за вчера/неделю/месяц
- Все 4 раздела (P&L, расходы, ДДС, KPI) наполнены данными
- Экспорт работает (Excel + PDF)
- Ноль write-операций доступно по роли `director`
- Время загрузки дашборда < 2 секунд при сети из 5 клиник
