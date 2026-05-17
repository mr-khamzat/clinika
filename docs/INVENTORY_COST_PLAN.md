# План: Складской учёт + Себестоимость приёма

**Версия:** 0.1 (draft) · **Дата:** 2026-05-15
**Связан с:** [DIRECTOR_CABINET_PLAN.md](DIRECTOR_CABINET_PLAN.md), [ONEC_INTEGRATION_PLAN.md](ONEC_INTEGRATION_PLAN.md)

---

## 1. Цель

Дать Клинике полноценный складской учёт расходников с **партионным учётом
(FIFO + сроки годности)** и **автоматической калькуляцией себестоимости
каждого приёма** на основе фактически списанных материалов.

### Бизнес-сценарий
1. Руководитель завозит на склад партию: 100 контейнеров по 8 ₽ (срок — 6 мес)
2. Руководитель один раз настраивает норматив: услуга «Забор крови» = 1
   контейнер + 1 игла + 2 ваты
3. Врач выполняет приём, отмечает `completed` — система **автоматически**
   списывает по нормативу со склада (FIFO — старая партия первой)
4. Себестоимость приёма пересчитывается из стоимости списанных партий
5. Директор видит: выручка по приёму 800 ₽ − себестоимость 18 ₽ = **маржа 782 ₽**
6. На дашборде алерт: «Контейнеры — осталось 12 шт, истекают 15.06» → закупка

---

## 2. Что уже есть (фундамент)

### Таблицы в БД
- `inventory_items` (sku, name, **cost_per_unit**, **expiry_tracked**,
  **min_stock_threshold**, barcode, vendor, photo_url)
- `inventory_stocks` (остатки)
- `inventory_movements` (income / outgoing / transfer / write-off)

### REST API (роутер `/inventory`)
- CRUD items + import-csv
- Stocks + инвентаризация
- Movements (приход / расход / перемещение / списание)
- Alerts (low_stock + expiring + expired) — **уже есть!**

> **Решение:** строим поверх существующего, не ломая. Партионный учёт
> и нормативы — это **новые таблицы**, движения остаются совместимыми.

---

## 3. Что добавляем

### 3.1. Партионный учёт (FIFO + сроки годности)

Сейчас `inventory_items.cost_per_unit` — одна цена на весь товар.
**Проблема:** партии завозятся по разной цене, и сроки годности у них разные.

**Решение:** ввести `inventory_batches` — отдельная сущность партии.
`inventory_stocks.quantity` остаётся как кешированный итог (сумма по партиям).

```sql
CREATE TABLE inventory_batches (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id         UUID NOT NULL REFERENCES inventory_items(id),
  clinic_id       UUID NOT NULL REFERENCES clinics(id),
  movement_id     UUID NOT NULL REFERENCES inventory_movements(id),  -- приходное движение
  batch_number    VARCHAR(100),       -- номер партии от поставщика
  qty_received    NUMERIC(12,3) NOT NULL,
  qty_remaining   NUMERIC(12,3) NOT NULL,
  unit_cost       NUMERIC(12,2) NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL,
  expires_at      DATE,               -- срок годности (NULL если не отслеживается)
  supplier_id     UUID REFERENCES suppliers(id),
  external_id     VARCHAR(100),       -- ID партии в 1С
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_qty CHECK (qty_remaining >= 0 AND qty_remaining <= qty_received)
);
CREATE INDEX idx_batches_fifo ON inventory_batches (item_id, clinic_id, expires_at NULLS LAST, received_at)
  WHERE qty_remaining > 0;
```

**FIFO-алгоритм списания:**
- Сортируем партии по `(expires_at ASC NULLS LAST, received_at ASC)` — сначала истекающие, потом старые
- Списываем количество последовательно с первой партии. Если не хватает — переходим к следующей
- Каждое списание создаёт `inventory_movements` row с `batch_id` и `unit_cost` из партии
- `qty_remaining` партии уменьшается

### 3.2. Нормативы услуг — `service_consumables`

```sql
CREATE TABLE service_consumables (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  item_id         UUID NOT NULL REFERENCES inventory_items(id),
  quantity        NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  is_optional     BOOLEAN DEFAULT FALSE,   -- врач может убрать при списании
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (service_id, item_id)
);
```

**UI:** в `ManagerServices.jsx` (или отдельной странице) — таблица услуг,
по клику открывается список расходников с количеством. CRUD через REST.

**Шаблоны:** на этапе seed-данных можно подсунуть типовые нормативы для
популярных услуг (забор крови, УЗИ с гелем, инъекция, перевязка и т.д.).
Руководитель потом подгоняет под свою клинику.

### 3.3. Автосписание при `appointment.status = completed`

**Хук в сервисе `appointment_service.complete_appointment()`:**

```python
async def complete_appointment(db, appointment_id, user, actual_consumables=None):
    appt = await db.get(Appointment, appointment_id)
    # ... обычная логика смены статуса ...

    # Списание расходников
    for service_id in appt.service_ids:
        norms = await get_service_consumables(db, service_id)
        for norm in norms:
            qty = actual_consumables.get(norm.item_id, norm.quantity)
            if qty <= 0:
                continue
            await writeoff_fifo(
                db, item_id=norm.item_id, clinic_id=appt.clinic_id,
                quantity=qty, appointment_id=appt.id, written_off_by=user.id,
            )

    # Пересчёт себестоимости
    await recalculate_appointment_cost(db, appt.id)
```

**Правила:**
- Если расходника не хватает на складе — **не блокируем** приём, но создаём
  алерт «Списать не удалось: контейнеры, нужно 1, в наличии 0». Запись
  отправляется в очередь `pending_writeoffs` для последующего списания
  при первом приходе.
- Врач в форме закрытия приёма видит чек-лист расходников по нормативу и
  может скорректировать количества (галочка «использовал больше/меньше»).
- При `cancelled` / `no_show` — ничего не списывается.
- При откате `completed → in_progress` (редактирование) — все списания
  реверсятся (возврат на склад).

### 3.4. Калькуляция себестоимости приёма

```sql
CREATE TABLE appointment_costs (
  appointment_id  UUID PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
  materials_cost  NUMERIC(12,2) DEFAULT 0,   -- сумма из inventory_movements (write-off)
  labor_cost      NUMERIC(12,2) DEFAULT 0,   -- зарплата врача * время приёма
  overhead_cost   NUMERIC(12,2) DEFAULT 0,   -- доля аренды/коммуналки на приём
  total_cost      NUMERIC(12,2) GENERATED ALWAYS AS (materials_cost + labor_cost + overhead_cost) STORED,
  revenue         NUMERIC(12,2) DEFAULT 0,   -- сумма из payments по этому приёму
  margin          NUMERIC(12,2) GENERATED ALWAYS AS (revenue - materials_cost - labor_cost - overhead_cost) STORED,
  calculated_at   TIMESTAMPTZ DEFAULT NOW()
);
```

**Расчёт компонентов:**
- `materials_cost` — `SUM(qty * unit_cost)` по `inventory_movements` где
  `appointment_id = ...` и `type = 'write-off-auto'`. Тривиально.
- `labor_cost` — `(зарплата врача / норма часов в мес) * длительность приёма`.
  Требует наличия `payroll` (см. §6). На MVP — 0, либо ручной коэффициент.
- `overhead_cost` — общие расходы клиники за месяц / количество приёмов за
  месяц. Опционально. На MVP — 0.
- `revenue` — `SUM(payments.amount)` где `appointment_id = ...`.

---

## 4. Дополнительные таблицы

### Поставщики
```sql
CREATE TABLE suppliers (
  id UUID PRIMARY KEY, tenant_id UUID, name VARCHAR(200), inn VARCHAR(12),
  contact_person VARCHAR(200), phone VARCHAR(50), email VARCHAR(200),
  payment_terms VARCHAR(100), external_id VARCHAR(100), notes TEXT
);
```

### Документы приходов (товарные накладные)
```sql
CREATE TABLE inventory_receipts (
  id UUID PRIMARY KEY, tenant_id UUID, clinic_id UUID, supplier_id UUID,
  doc_number VARCHAR(100), doc_date DATE, total_amount NUMERIC(12,2),
  status VARCHAR(20),  -- draft / posted / cancelled
  attachments JSONB DEFAULT '[]',
  created_by_id UUID, posted_at TIMESTAMPTZ,
  external_id VARCHAR(100)  -- ID документа в 1С
);
```
> Сейчас движения «приход» создаются по одному. Добавляем «шапку документа»
> для нормальной работы с многострочными накладными и для синхронизации с 1С.

---

## 5. REST API (расширение `/inventory`)

```
# Партии
GET    /inventory/batches?item_id=&clinic_id=&expiring_within=30
GET    /inventory/batches/{id}
POST   /inventory/batches/manual-writeoff   # списать из конкретной партии

# Нормативы услуг
GET    /services/{id}/consumables
PUT    /services/{id}/consumables           # массовое обновление
POST   /inventory/copy-norms                # копировать с одной услуги на другую

# Документы приходов
GET    /inventory/receipts?from=&to=&supplier_id=
POST   /inventory/receipts                  # создать черновик
POST   /inventory/receipts/{id}/items       # добавить позицию (создаёт партию)
POST   /inventory/receipts/{id}/post        # провести (создаёт movements)
POST   /inventory/receipts/{id}/cancel

# Себестоимость
GET    /appointments/{id}/cost              # детализация себестоимости
GET    /director/cost/by-service?from=&to=  # средняя себестоимость по услугам
GET    /director/cost/by-doctor?from=&to=
GET    /director/cost/margin-analysis       # маржинальность

# Поставщики
GET/POST/PATCH/DELETE /suppliers
```

Все пишущие — для роли `manager` (директор read-only).

---

## 6. Связь с ФОТ и зарплатами (для labor_cost)

Пользователь выбрал «детально + выработка врачей». Это требует **отдельной
таблицы `payroll_entries`** (одна на сотрудника на период).

```sql
CREATE TABLE payroll_entries (
  id UUID PRIMARY KEY, tenant_id UUID, clinic_id UUID,
  user_id UUID REFERENCES users(id),        -- сотрудник
  period_from DATE, period_to DATE,
  base_salary NUMERIC(12,2),                -- оклад
  bonus NUMERIC(12,2) DEFAULT 0,            -- премия
  percent_revenue NUMERIC(12,2) DEFAULT 0,  -- % с выработки
  insurance_taxes NUMERIC(12,2) DEFAULT 0,  -- страховые
  ndfl NUMERIC(12,2) DEFAULT 0,             -- НДФЛ
  total_gross NUMERIC(12,2),
  total_net NUMERIC(12,2),                  -- к выплате
  status VARCHAR(20),                       -- draft / paid
  paid_at DATE, external_id VARCHAR(100),
  notes TEXT
);
```

Расчёт `labor_cost` приёма:
```python
hourly_rate = payroll.total_gross / (working_days * 8)   # упрощённо
labor_cost = hourly_rate * (appointment.duration_min / 60)
```

**Приватность:** в кабинете Директора зарплаты конкретных сотрудников
показываются — но **каждый просмотр пишется в `audit_log`** (кто, когда,
какие сотрудники). Можно дополнительно требовать ввод PIN-кода при
открытии раздела «Зарплаты».

---

## 7. Frontend

### Manager-кабинет (новые/расширенные страницы)
- `ManagerInventory.jsx` — номенклатура (CRUD, импорт CSV, поиск, фильтры)
- `ManagerInventoryReceipts.jsx` — приходы (создание накладной, добавление
  позиций → автогенерация партий)
- `ManagerInventoryBatches.jsx` — партии (список с фильтром «скоро истекает»)
- `ManagerInventoryWriteoffs.jsx` — журнал списаний (с привязкой к приёмам)
- `ManagerInventoryAudit.jsx` — инвентаризация (плановая/внеплановая)
- `ManagerSuppliers.jsx` — поставщики
- `ManagerServiceNorms.jsx` — нормативы (для каждой услуги — список расходников)
- `ManagerPayroll.jsx` — зарплатные ведомости

### Doctor-кабинет (правки)
- В форме «Завершение приёма» (`AppointmentComplete.jsx`):
  - Чек-лист расходников по нормативу
  - Возможность скорректировать количество («использовал 3 ваты, не 2»)
  - Кнопка «Завершить» → автосписание (хук на бэке)

### Director-кабинет (новые)
- `DirectorCostAnalysis.jsx` — маржинальность услуг и врачей
- `DirectorInventoryStatus.jsx` — состояние складов (без правок)
- `DirectorPayrollSummary.jsx` — зарплаты (агрегаты + drill-down с audit log)

---

## 8. Миграции

### Миграция 1 (база партионки)
- `inventory_batches`
- `suppliers`
- `inventory_receipts`
- Колонка `inventory_movements.batch_id` (FK → inventory_batches)
- Колонка `inventory_movements.appointment_id` (FK)
- Колонка `inventory_movements.type` расширить значениями `'write-off-auto'`,
  `'write-off-manual'`, `'reversal'`

### Миграция 2 (нормативы и себестоимость)
- `service_consumables`
- `appointment_costs`

### Миграция 3 (ФОТ)
- `payroll_entries`

### Миграция 4 (период замыкания — см. §10)
- `accounting_periods`

### Backfill для существующих данных
- Все текущие `inventory_movements (income)` → создать соответствующие
  `inventory_batches` с `unit_cost = inventory_items.cost_per_unit` и
  `expires_at = NULL`
- Все текущие `inventory_movements (outgoing/write-off)` → проставить
  `batch_id` ссылкой на сгенерированные партии (по FIFO)

Это критично, чтобы не сломать историю движений.

---

## 9. Поэтапный план

### Этап 1: Партии и FIFO (3-4 дня)
- [ ] Миграция: `inventory_batches`, `suppliers`, `inventory_receipts`
- [ ] Backfill старых данных
- [ ] Сервис `writeoff_fifo()` (партии в правильном порядке)
- [ ] REST `/inventory/batches`, `/receipts/*`, `/suppliers/*`
- [ ] Frontend Manager: `ManagerInventoryReceipts`, `ManagerInventoryBatches`,
      `ManagerSuppliers`
- [ ] Тесты: FIFO корректность, нехватка остатка, partial-list-off

### Этап 2: Нормативы услуг (1-2 дня)
- [ ] Миграция: `service_consumables`
- [ ] REST `/services/{id}/consumables`
- [ ] Frontend: `ManagerServiceNorms` (редактор нормативов)
- [ ] Seed типовых нормативов для популярных услуг

### Этап 3: Автосписание + себестоимость (2-3 дня)
- [ ] Миграция: `appointment_costs`
- [ ] Хук `complete_appointment()` → автосписание + расчёт себестоимости
- [ ] Реверс при откате completed → in_progress
- [ ] UI чек-листа расходников в `AppointmentComplete.jsx`
- [ ] REST `/appointments/{id}/cost`, `/director/cost/*`
- [ ] Тесты: completed → списание, no-show → не списано

### Этап 4: ФОТ и labor_cost (3-4 дня)
- [ ] Миграция: `payroll_entries`
- [ ] REST CRUD `payroll`
- [ ] Frontend: `ManagerPayroll`
- [ ] Включение `labor_cost` в `appointment_costs`
- [ ] Audit log на просмотр в Director-кабинете

### Этап 5: Директор-кабинет (2-3 дня)
- [ ] `DirectorCostAnalysis`, `DirectorInventoryStatus`, `DirectorPayrollSummary`
- [ ] Дашборд: виджеты маржинальности
- [ ] Экспорт

### Этап 6: Период замыкания + полировка (1-2 дня)
- [ ] `accounting_periods` (см. §10)
- [ ] Кнопка «Закрыть месяц» в Manager
- [ ] Защита от правок задним числом

**Итого:** ~12-18 дней. Параллельно с Director-кабинетом — около месяца.

---

## 10. Период замыкания (closing the books)

Пользователь не определился. Рекомендация: **сделать обязательно**, но
гибко.

```sql
CREATE TABLE accounting_periods (
  id UUID PRIMARY KEY, tenant_id UUID,
  period_from DATE, period_to DATE,
  status VARCHAR(20),  -- open / closed / reopened
  closed_at TIMESTAMPTZ, closed_by_id UUID, close_notes TEXT,
  external_id VARCHAR(100)  -- для 1С
);
```

**Правило:** при `status='closed'` — нельзя редактировать/удалять
`appointments`, `payments`, `inventory_movements`, `payroll_entries` с
датой в этом периоде. Можно только создавать корректировочные документы
текущей датой.

**Кто закрывает:** Manager (с правом «closing»). Можно повторно открыть
только Super_admin (для исправления ошибок) с пометкой в audit log.

---

## 11. Открытые вопросы

1. **Период замыкания — обязательный или опциональный?** Рекомендую
   обязательный, начиная со 2-го месяца использования.
2. **Минусовой остаток разрешён?** Сейчас рекомендация — не блокировать
   приём, но создавать алерт. Альтернатива: запретить `completed` если
   нехватка > X% от норматива.
3. **Шаблоны нормативов для популярных услуг** — поставлять как seed-данные
   или каждая клиника заводит сама?
4. **Доступ Manager к зарплатам других сотрудников** — только своей клиники
   или всей сети?
5. **Алерты в Telegram-боте о low_stock и истекающих партиях** — кому слать
   (руководитель / завхоз / директор)?

---

## 12. Что НЕ делаем в этой итерации

- ❌ Резервирование под запись (зарезервировать материалы на будущий приём) — далее
- ❌ Кассы / денежные ящики — отдельный модуль
- ❌ Сложные схемы трансфертного ценообразования между клиниками — далее
- ❌ Машинное обучение для прогноза расходов — на стабильной базе данных
