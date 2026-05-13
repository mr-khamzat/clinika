# Глава 10. Интеграции и устойчивость

## Цель

Сделать платформу совместимой со внешним миром: лабораториями, wellness-партнёрами, агрегаторами и государственными сервисами. И при этом не падать вместе с ними. Бизнес-смысл: клиника не должна вести вторую систему рядом, всё в одной платформе; при отказе внешних сервисов работа клиники не останавливается.

## Что реализовано

- **Лабораторная интеграция** — gemotest, invitro, kdl, citilab через провайдер-адаптеры.
- **Wellness партнёры** — фитнес-залы, массажные кабинеты, СПА с deep-link для пациентов.
- **Партнёрская программа агрегаторам** — СберЗдоровье, Здоров.онлайн, ProDoctorov через Public API v1.
- **Disaster-mode** — деградация при отказе внешних сервисов.
- **Webhook outbound** — платформа уведомляет внешние системы тенанта о событиях.
- **МИС Renovatio** — синхронизация пациентов, услуг, расписаний.

## Лаборатории

### Поддерживаемые провайдеры

| Провайдер | Способ | Скорость результата |
|---|---|---|
| Gemotest | REST API | 1-3 рабочих дня |
| Invitro | SOAP API | 1-2 рабочих дня |
| KDL | REST API + S3 | 2-5 рабочих дней |
| Citilab | REST API | 1-3 рабочих дня |

### Жизненный цикл заявки

```
created → sent_to_lab → in_progress → result_ready → delivered_to_patient
```

### API endpoints

```http
GET  /doctor/lab/providers
POST /doctor/lab/orders
GET  /doctor/lab/orders/{id}
GET  /patient/lab/orders/{id}/result.pdf
```

Создание заявки:

```json
{
  "patient_id": "...",
  "provider": "gemotest",
  "tests": ["CBC", "GLU", "TSH"],
  "delivery": "pdf_to_patient"
}
```

## Wellness партнёры

Партнёр публикует свои услуги в каталоге аггрегатора. Пациент видит «попутные» услуги в кабинете (например, физиотерапия в партнёрском СПА).

```http
GET /wellness/offers
POST /wellness/offers/{id}/book
```

После бронирования генерируется купон-ссылка с уникальным кодом. Партнёр сканирует код → клиника получает % с продажи.

## Партнёрская программа агрегаторам

```http
POST /api/v1/aggregator/referrals
```

Заголовок: `X-Api-Key: <tenant_api_key>` со scope `aggregator:write`.

```json
{
  "patient": {
    "phone": "+79001234567",
    "first_name": "Иван",
    "last_name": "Иванов"
  },
  "service_code": "ULTRASOUND_ABDOMEN",
  "preferred_date": "2026-05-15",
  "preferred_clinic_id": "..."
}
```

Платформа возвращает referral_id и SMS пациенту со ссылкой на запись.

## Disaster Mode

При отказе ключевых внешних сервисов платформа переключается в degraded-режим:

| Сервис | Что отказало | Что делает платформа |
|---|---|---|
| ЮKassa | Не отвечает | Очередь платежей, ручной режим оплат |
| ОФД | API недоступен | Чек откладывается, потом отправляется батчем |
| AI | Rate-limit / 500 | AI-фичи показывают «временно недоступно» |
| Lab | Провайдер не принял | Заявка в статусе `retry`, до 5 попыток |
| Telegram | Bot API | Уведомления через SMS fallback |

Disaster mode включается автоматически при N подряд ошибок, выключается после M успешных запросов. Логируется в audit_log.

## Webhook outbound

Внешние системы тенанта могут подписаться на события:

```http
POST /webhooks/endpoints

{
  "url": "https://external.example.com/hook",
  "events": ["referral_created", "appointment_completed", "payment_received"],
  "secret": "shared-hmac-secret"
}
```

Подпись каждого POST: `X-Signature: sha256=<hmac>`. Body — JSON события.

Retry policy: 5 попыток с exp backoff (10s, 60s, 5m, 30m, 3h).

## МИС Renovatio

Per-clinic настройка:

```http
POST /admin/mis/connections
```

```json
{
  "clinic_id": "...",
  "provider": "renovatio",
  "base_url": "https://mis.clinic.example/api",
  "api_key": "...",
  "mis_id": "12345"
}
```

Что синхронизируется:

- Пациенты (двусторонняя, по phone)
- Услуги (из МИС → платформа, ежедневно)
- Расписание врачей (из МИС → платформа, каждый час)
- Записи на приём (платформа → МИС, в момент создания)

## Где найти в UI

Кабинет manager:

- **Интеграции → Лаборатории** — список, статус, настройка.
- **Интеграции → Webhooks** — endpoints с тестовой отправкой.
- **Интеграции → МИС** — статус подключения.

Кабинет super_admin:

- **System → Disaster Mode** — переключатель и логи деградации.

## Backend модели

| Таблица | Описание |
|---|---|
| `lab_providers` | провайдеры лабораторий |
| `lab_orders` | заявки |
| `wellness_partners` | партнёры |
| `webhook_endpoints` | подписки |
| `webhook_deliveries` | история доставок с retry |
| `mis_connections` | МИС-подключения |
| `disaster_mode_events` | лог деградаций |

## Настройки администратора

- `LAB_RETRY_MAX` — попыток ретрая (default 5).
- `WEBHOOK_TIMEOUT_SECONDS` — таймаут запроса (default 10).
- `DISASTER_MODE_FAIL_THRESHOLD` — кол-во подряд ошибок для включения (default 5).
- `DISASTER_MODE_RECOVERY_SUCCESSES` — успехов для выключения (default 10).
- `MIS_SYNC_PATIENTS_CRON` — расписание sync (default `*/15 * * * *`).

## FAQ

**Что если лаборатория не отдала результат за неделю?** Алерт manager + auto-retry. Если не помогло — manual escalation в audit_log.

**Можно ли подключить свою лабораторию?** Да, через `provider_type=custom` с базовым REST-контрактом. Документация по контракту — в dev-portal.

**Disaster mode — это автоматически?** Да, без участия super_admin. Можно форсировать вручную для теста.

**Сколько хранится webhook delivery history?** 30 дней. Потом архивируется в S3.

## Связанные статьи

- [Подключение МИС Renovatio](/wiki/setup-mis)
- [Интеграции (dev)](/wiki/dev-integrations)
- [API endpoints](/wiki/dev-api)
- [Гл. 1: Платформа](/wiki/chapter-1-platform)
