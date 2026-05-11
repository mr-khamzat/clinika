# Глава 4. Продуктивность управляющего

## Цель

Превратить роль manager-а из «диспетчера» в полноценного оператора клиники. Цель — дать ему инструменты, чтобы он за 1-2 клика мог найти узкое место, перераспределить нагрузку, запустить акцию или связаться с врачом. Бизнес-смысл: один опытный manager должен закрывать 2-3 клиники без потери качества.

## Что реализовано

- **Kanban-расписание** — drag-and-drop приёмов между врачами и временными слотами.
- **Heatmap загрузки врачей** — визуализация занятости по дням недели и часам.
- **Шаблоны направлений** — пресеты для типовых сценариев (направление на УЗИ, на анализы).
- **Multi-clinic view** — переключение между клиниками одним меню без перелогина.
- **Forecast расходов** — прогноз ФОТ, расходников, аренды на следующий месяц.

## Kanban-расписание

Колонки = врачи на день. Карточки = приёмы. Действия:

- **Drag карточки** между врачами — система проверяет, есть ли свободный слот у целевого врача, корректирует время.
- **Drag между временными зонами** — сдвигает время, отправляет уведомление пациенту.
- **Двойной клик** — детальная карточка приёма.
- **Цвет границы** — статус: created (синий), confirmed (зелёный), in_progress (жёлтый), no_show (серый), cancelled (красный).

## API endpoints

### Расписание дня

```http
GET /manager/schedule/day?date=2026-05-12&clinic_id=...
```

Response:

```json
{
  "doctors": [
    {
      "doctor_id": "...",
      "name": "Иванов И.И.",
      "appointments": [
        { "id": "...", "time": "10:00", "duration": 30, "patient_name": "А.", "status": "confirmed" }
      ]
    }
  ]
}
```

### Перенос приёма (drag-and-drop)

```http
POST /manager/schedule/reassign
```

```json
{
  "appointment_id": "...",
  "new_doctor_id": "...",
  "new_start_time": "2026-05-12T14:30:00Z"
}
```

### Heatmap

```http
GET /manager/analytics/doctor-heatmap?clinic_id=...&period_days=30
```

```json
{
  "doctors": [
    {
      "doctor_id": "...",
      "name": "Иванов И.И.",
      "utilisation_by_hour": {
        "mon": [0, 0, ..., 60, 80, 95, 100, 95, 70, 0, ...],
        "tue": [...]
      }
    }
  ]
}
```

### Шаблоны направлений

```http
GET    /manager/referrals/templates
POST   /manager/referrals/templates
PATCH  /manager/referrals/templates/{id}
DELETE /manager/referrals/templates/{id}
```

```json
{
  "name": "УЗИ органов брюшной полости",
  "service_id": "...",
  "instructions_md": "Натощак, не есть за 8 часов, не пить за 2 часа",
  "default_clinic_id": "..."
}
```

### Multi-clinic switch

```http
GET /manager/clinics/accessible
POST /manager/clinics/switch
```

```json
{ "clinic_id": "..." }
```

После switch контекст в JWT не меняется (это всё ещё manager одной франшизы), но фронт перезагружает данные по новой клинике.

### Cost forecast

```http
GET /manager/forecast/expenses?months_ahead=3
```

```json
{
  "forecast": [
    {
      "month": "2026-06",
      "expected_expenses": {
        "salaries": 850000,
        "supplies": 120000,
        "rent": 180000,
        "modules": 32000
      },
      "expected_revenue": 1450000,
      "expected_profit": 268000,
      "confidence": 0.78
    }
  ]
}
```

## Где найти в UI

Кабинет manager (`/manager`):

- **Главная** — KPI плитки за сегодня и неделю.
- **Расписание Kanban** — drag-and-drop.
- **Загрузка врачей** — heatmap.
- **Шаблоны направлений** — список с CRUD.
- **Прогноз** — таблица + график.
- **Многоклиничный режим** — выпадающее меню в шапке.

## Backend модели

| Таблица | Описание |
|---|---|
| `appointments` | основная сущность приёмов |
| `clinic_schedules` | расписание клиники |
| `referral_templates` | шаблоны направлений |
| `manager_clinic_access` | права manager-а на клиники |
| `forecast_cache` | кеш прогнозов |

## Зависимости

- **Гл. 5: Регистратор** — приёмы создаются через reg.
- **Гл. 6: Врач** — статусы приёмов меняет врач.
- **Гл. 3: Franchise analytics** — данные о загрузке агрегируются.

## Настройки администратора

- `MANAGER_KANBAN_DAYS_AHEAD` — на сколько дней показывать Kanban (default 7).
- `MANAGER_FORECAST_PROVIDER` — `linear` или `arima` (advanced).
- `MANAGER_AUTO_SUGGEST_REASSIGN` — авто-предложения «перенести этот приём, врач загружен» (default true).

## FAQ

**Можно ли откатить случайный drag?** Да, Ctrl+Z в течение 30 секунд после перетаскивания. История изменений хранится в audit log.

**Что если у целевого врача нет свободного слота?** Drag будет отклонён, появится тост «У Иванов И.И. нет свободного слота в 14:30». Можно явно подвинуть соседние записи через многоступенчатое действие.

**Heatmap показывает 0 у нового врача — это нормально?** Да, для расчёта нужно минимум 7 дней приёмов.

**Forecast часто ошибается на короткой истории.** Confidence в ответе показывает достоверность. Если <0.6 — относитесь как к ориентиру, не как к плану.

## Связанные статьи

- [Роль manager](/wiki/role-manager)
- [Гл. 5: Регистратор](/wiki/chapter-5-reg.md)
- [Запись и расписание](/wiki/concepts-appointments)
- [Гл. 3: Franchise analytics](/wiki/chapter-3-franchise-analytics)
