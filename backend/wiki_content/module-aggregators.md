# Модуль «Агрегаторы — DocDoc, ПроДокторов»

Бесплатный встроенный модуль интеграции с медицинскими агрегаторами через Public API v1. Прокидывает лиды от агрегаторов в систему как направления (`Referral`), считает атрибуцию и комиссию.

## Что это даёт клинике

- Не нужно вручную переносить заявки с агрегаторов в CRM.
- Чёткое отслеживание ROI каналов: лиды → записи → пациенты → выручка.
- Авто-биллинг с агрегатором по факту приёма (без двойного учёта).
- Запретные списки: можно блокировать конкретного агрегатора при превышении SLA.

## Что входит технически

- **Партнёрства** (`AggregatorPartnership`): связь тенант ↔ агрегатор. С API-ключом, типом комиссии (% или fixed), приоритетом.
- **Лиды** (`AggregatorLead`): заявки от агрегатора. Статусы: new → contacted → booked → completed / declined.
- **Public API v1**: внешний endpoint `/public/aggregator/leads` принимает заявки с API-ключом партнёра.
- **Webhook**: можно настроить обратный webhook агрегатора (callback при изменении статуса).
- **Аналитика**: конверсия от лида до приёма, средний чек по агрегатору, RoMI.
- **Audit**: каждая операция логируется (приход лида, переход в статус, оплата комиссии).

## Как настроить

1. Договориться с агрегатором (DocDoc / ПроДокторов / 2GIS / Zoon) — получить контракт и контакты тех. поддержки.
2. `/admin/aggregators/partnerships/new` — создать партнёрство, сгенерировать API-ключ (хранится hashed, plaintext показывается ОДИН раз).
3. Отдать API-ключ агрегатору. Их IT интегрирует на своей стороне (POST на `/public/aggregator/leads`).
4. Настроить правила: для каких клиник / специализаций принимать лиды от этого агрегатора.
5. Тестовый лид: проверка прихода в `/admin/aggregators/leads`.

## Как пользоваться

### Со стороны агрегатора

Агрегатор шлёт POST на `https://клиниксеть.рф/public/aggregator/leads`:
```json
{
  "api_key": "ak_xxxxxxxxxxxx",
  "patient": {"name": "...", "phone": "+7...", "email": "..."},
  "service": "терапевт",
  "preferred_date": "2026-05-20",
  "comment": "..."
}
```

Ответ: `201 Created` + lead_id.

### Со стороны клиники

1. `/admin/aggregators/leads` — новые лиды.
2. Регистратор связывается с пациентом, переводит в статус `contacted`.
3. При записи на приём — статус `booked`, привязка к Appointment.
4. После приёма — `completed`, считается комиссия.

## API endpoints

Public (для агрегаторов):
- `POST /public/aggregator/leads` — приём заявки. Auth: API-key в body.

Admin (для тенанта):
- `GET /admin/aggregators/partnerships` — список партнёрств.
- `POST /admin/aggregators/partnerships` — создать партнёрство (генерит API-ключ).
- `PATCH /admin/aggregators/partnerships/{id}` — обновить.
- `DELETE /admin/aggregators/partnerships/{id}` — отключить.
- `GET /admin/aggregators/leads` — список лидов с фильтрами.
- `PATCH /admin/aggregators/leads/{id}/status` — сменить статус.
- `GET /admin/aggregators/stats` — конверсия, ROI.

## Безопасность

- API-ключи хешируются в БД (только prefix виден для идентификации).
- Rate-limit на public endpoint: 60 req/min per partner.
- Webhook lab-результатов отдельный: `POST /webhooks/lab-results/{provider_type}`.
- При компрометации ключа — `DELETE /partnerships/{id}` (logical delete) + регенерация нового.

## Известные ограничения

- Готовых клиентских библиотек для агрегаторов нет — каждый интегрируется по docs.
- Webhook callback (обратный) к агрегатору пока ограниченно поддержан.
- Нет sandbox-окружения для тестов агрегаторов — тестируется в prod с тестовыми API-ключами.

## Смотрите также

- [API Reference](api-reference.md)
- [Глава 10. Интеграции и устойчивость](chapter-10-integrations.md)
- [Концепт · Жизненный цикл направления](concepts-referrals.md)
