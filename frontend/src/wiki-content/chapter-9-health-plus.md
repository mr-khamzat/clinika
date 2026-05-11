# Глава 9. Подписка Здоровье+ и инфраструктура общения

## Цель

Создать у клиники предсказуемый ежемесячный доход с пациента (подписочная модель), а у пациента — ощущение «всё включено»: безлимитный чат с врачом, скидки, ежемесячные подарки. Бизнес-смысл: вместо случайных визитов раз в полгода — стабильный денежный поток.

## Что реализовано

- **Подписка Здоровье+** (модуль с module gating).
- **Override тарифа** на уровне франшизы — каждая сеть устанавливает свою цену.
- **Cash activation** — manager продаёт подписку наличными прямо в клинике.
- **Discount в appointments** — автоматическая скидка для подписчиков.
- **Безлимит чата** с врачом (асинхронный).
- **Monthly supply** — крон ежемесячно начисляет бонус 500 баллов или подарок.
- **Structured benefits + chat deeplink** — список выгод с прямой ссылкой на «начать чат с врачом».
- **iCal feed** — все приёмы и события в календаре пациента.
- **Document storage** — все документы (выписки, анализы) в одной папке.

## Структура подписки

| Параметр | Значение |
|---|---|
| Цена (по умолчанию) | 990 ₽/мес |
| Override на уровне франшизы | да |
| Тип billing | online (ЮKassa) или cash (manager) |
| Период | помесячно / годовой со скидкой |
| Auto-renew | да, отказ по запросу |
| Trial | первые 7 дней бесплатно (опция франшизы) |

## Что входит

- Безлимитный асинхронный чат с дежурным врачом
- Скидка 15% на все услуги клиники
- Бесплатная консультация в месяц
- Приоритет в записи
- Ежемесячно: 500 баллов лояльности
- Расширенный годовой расходник для налогового вычета
- Семейная подписка (доплата 50% за каждого члена)

## API endpoints

### Активация (online)

```http
POST /patient/subscription/activate
```

```json
{ "plan": "health_plus_monthly", "payment_method": "yookassa" }
```

Response — URL ЮKassa для оплаты.

### Активация (cash через manager)

```http
POST /manager/subscription/cash-activate
```

```json
{
  "patient_id": "...",
  "plan": "health_plus_monthly",
  "amount": 990,
  "receipt_number": "K-2026-00123"
}
```

Manager выдаёт пациенту бумажный чек, активация мгновенная.

### Статус

```http
GET /patient/subscription/status
```

```json
{
  "active": true,
  "plan": "health_plus_monthly",
  "started_at": "2026-04-15T...",
  "next_billing_at": "2026-06-15T...",
  "benefits": {
    "discount_pct": 15,
    "chat_unlimited": true,
    "free_consultations_remaining": 1
  }
}
```

### Чат с врачом

```http
GET  /patient/chat/threads
POST /patient/chat/threads
GET  /patient/chat/threads/{id}/messages
POST /patient/chat/threads/{id}/messages
```

```http
GET /patient/chat/deeplink   → возвращает {url} для прямого открытия с главной
```

### iCal feed

```http
GET /patient/calendar/ical?token=...
```

Возвращает .ics файл. Токен — постоянный, можно подписаться в Google Calendar / Apple Calendar.

### Monthly supply cron

Каждый месяц в 04:00 МСК запускается `cron_monthly_supply`:

1. Перебирает все активные подписки.
2. Начисляет 500 баллов в `patient_loyalty_transactions`.
3. Отправляет уведомление «Зачислили 500 баллов по подписке».
4. Сбрасывает счётчик `free_consultations_remaining`.

## Module gating

Модуль `health_plus` управляется через `tenant_module_subscriptions`. Если у тенанта он не активен — UI скрывает кнопку «Подписка Здоровье+» в кабинете пациента, и `/patient/subscription/*` возвращает 404.

## Где найти в UI

Кабинет patient:

- **Здоровье+** — отдельная вкладка с benefits, статусом, кнопками.
- **Чат** — иконка в верхнем меню с индикатором непрочитанных.
- **Календарь** — iCal feed link.
- **Документы** — папка `documents/`.

Кабинет manager:

- **Подписки** — список подписчиков, активация наличными, отмена.

Кабинет franchise_owner:

- **Тарифы** — override цены подписки.

## Backend модели

| Таблица | Описание |
|---|---|
| `patient_subscriptions` | активные подписки |
| `patient_subscription_payments` | история оплат |
| `patient_chat_threads` | диалоги с врачом |
| `patient_chat_messages` | сообщения |
| `patient_calendar_tokens` | iCal токены |
| `patient_documents_v2` | хранилище документов |

## Зависимости

- **Гл. 8: лояльность** — monthly supply начисляет туда.
- **Биллинг** — подписка через ЮKassa.
- **Гл. 6: врач** — врачи отвечают в чатах.
- **Module marketplace** — модуль активируется глобально.

## Настройки администратора

- `HEALTH_PLUS_DEFAULT_PRICE_RUB` — цена по умолчанию (default 990).
- `HEALTH_PLUS_DISCOUNT_PCT` — скидка (default 15).
- `HEALTH_PLUS_FREE_CONSULTATIONS_PER_MONTH` — бесплатные консультации (default 1).
- `HEALTH_PLUS_MONTHLY_SUPPLY_POINTS` — точки за supply (default 500).
- `HEALTH_PLUS_CRON_HOUR_MSK` — час cron monthly supply (default 4).

## FAQ

**Что если у пациента нет смартфона?** Cash-активация через manager + бумажный чек. Уведомления о новых сообщениях в чате — по SMS.

**Можно ли купить на год сразу?** Да, через `plan=health_plus_annual` со скидкой 15% (11 услуг по цене 12).

**Кто отвечает в чате?** Дежурный врач смены. Если консультация требует узкого специалиста — эскалация через manager.

**Что происходит при просрочке оплаты?** 3 дня grace period с теми же правами. Потом подписка → `unpaid`, скидка снимается, безлимит чата выключается.

## Связанные статьи

- [Роль patient](/wiki/role-patient)
- [Гл. 8: семья и лояльность](/wiki/chapter-8-patient-family)
- [Каталог модулей](/wiki/concepts-modules)
- [Биллинг](/wiki/concepts-billing)
