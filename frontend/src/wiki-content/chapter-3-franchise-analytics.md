# Глава 3. Аналитика франшизы

## Цель

Дать владельцу сети 1-3 экрана, после которых он точно знает: какие клиники растут, какие сжимаются, где и почему теряются деньги. Цель — заменить экспорт в Excel и ручной анализ оперативным dashboard с auto-insights. Бизнес-смысл: владелец принимает решения о расширении, открытии новых точек, сокращении или пересмотре тарифа.

## Что реализовано

- **KPI-Dashboard сети** с фильтром по периоду и клиникам.
- **Когортный анализ** — пациенты по месяцу первого визита, удержание, средний чек.
- **Bulk-настройка тарифов** — массовое назначение plan override для клиник.
- **AI insights (multi-tenant рекомендации)** — AI формирует короткие текстовые подсказки на основе цифр.
- **Cost forecast** — прогноз расходов клиник на следующие 1-3 месяца.

## Ключевые метрики

| Метрика | Расчёт | Где смотреть |
|---|---|---|
| Revenue per Clinic | Σ(appointment.price) − refunds | Dashboard → плитка |
| Active Patients | пациенты с ≥1 визитом за период | Dashboard → плитка |
| LTV | средний доход с пациента за 12 мес | Cohort report |
| Retention (M1, M3, M6) | % пациентов с повторным визитом | Cohort report |
| AOV (средний чек) | revenue / completed appointments | Dashboard → плитка |
| Doctor Utilization | (часы приёма) / (часы расписания) | Heatmap |
| Cancellation Rate | cancelled / total appointments | Dashboard → плитка |

## API endpoints

### Dashboard

```http
GET /franchise/analytics/dashboard?from=2026-01-01&to=2026-04-30&clinic_ids=...
```

Response:

```json
{
  "period": { "from": "2026-01-01", "to": "2026-04-30" },
  "revenue": { "total": 4520000, "delta_pct": 12.5 },
  "patients": { "active": 1240, "new": 215 },
  "appointments": { "completed": 2890, "no_show": 145 },
  "aov": 1564.36,
  "by_clinic": [
    { "clinic_id": "...", "name": "Магас", "revenue": 1800000, "delta_pct": 18.2 }
  ]
}
```

### Cohort

```http
GET /franchise/analytics/cohorts?metric=ltv&period=monthly
```

```json
{
  "cohorts": [
    {
      "cohort_month": "2025-11",
      "size": 145,
      "ltv_by_month": [1200, 1850, 2400, 2780, 3100, 3200]
    }
  ]
}
```

### Bulk plan override

```http
POST /franchise/clinics/bulk/plan-override
```

```json
{
  "clinic_ids": ["...", "...", "..."],
  "plan_overrides": {
    "telemedicine": { "price_override": 3990, "active": true },
    "loyalty_pro": { "price_override": 0, "active": true }
  },
  "valid_from": "2026-06-01"
}
```

### AI insights

```http
POST /franchise/ai/insights
```

```json
{ "scope": "network", "period_days": 30 }
```

Response:

```json
{
  "insights": [
    {
      "severity": "warning",
      "title": "Клиника Сунжа теряет пациентов",
      "body": "Retention M3 упал с 38% до 22% за квартал. Возможные причины: ушёл стоматолог, конкурент рядом открылся.",
      "actions": ["Проверить причины оттока", "Запустить SMS-кампанию"]
    }
  ]
}
```

## Где найти в UI

Кабинет franchise_owner:

- **Дашборд** — главный экран, плитки + динамика.
- **Когорты** — графики удержания по месяцам.
- **Тарифы клиник** — таблица с массовым редактированием.
- **AI инсайты** — карточки с рекомендациями.
- **Прогноз** — линейная регрессия по revenue / расходам.

## Backend модели

| Таблица | Описание |
|---|---|
| `franchise_dashboards` | кеш расчётов dashboard, TTL 1 час |
| `franchise_cohorts` | подготовленные когорты, пересчёт 1 раз в сутки |
| `clinic_plan_overrides` | индивидуальные тарифы клиник |
| `ai_insights` | сохранённые insights с фидбеком |

## Зависимости

- **Гл. 5: Биллинг** — данные о revenue.
- **Гл. 4: Manager** — данные о расписании и загрузке.
- **Гл. 6: Врач** — данные о приёмах.
- **AI инфраструктура** — AI для insights.

## Настройки администратора

- `FRANCHISE_DASHBOARD_TTL_SECONDS` — TTL кеша dashboard (default 3600).
- `FRANCHISE_COHORT_REBUILD_CRON` — расписание пересчёта когорт (default `0 3 * * *`).
- `AI_INSIGHTS_PROVIDER` — `enabled` или `disabled`.
- `AI_INSIGHTS_MIN_DATA_DAYS` — минимум данных для генерации insights (default 30).

## FAQ

**Почему dashboard «зелёный», а клиника жалуется на падение?** Dashboard агрегирует по всей сети. Откройте фильтр по клинике — там увидите реальную динамику.

**Можно ли экспортировать в Excel?** Да, кнопка «Экспорт» на каждом виджете. Формат: xlsx с форматированием.

**Сколько хранятся когорты?** Бесконечно. Когорта — это пара (month, patients), которая не теряет смысла со временем.

**Что если клиника подключена недавно?** Cohort требует минимум 1 месяц данных. До этого — N/A.

## Связанные статьи

- [Роль franchise_owner](/wiki/role-franchise-owner)
- [Гл. 5: Биллинг](/wiki/concepts-billing)
- [Region Lock](/wiki/concepts-region-lock)
- [Каталог модулей](/wiki/concepts-modules)
