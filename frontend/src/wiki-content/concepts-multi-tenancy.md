# Multi-tenancy и изоляция данных

## Что такое тенант

Тенант — изолированная единица платформы, как правило равная франшизе. У тенанта есть свой `slug`, поддомен или префикс `/{slug}/`, набор клиник, сотрудников, пациентов, тарифов, модулей и истории. Несколько тенантов работают в одной инсталляции платформы и одной базе данных, но никогда не видят данные друг друга.

Цель multi-tenancy — снизить операционные затраты платформы (один деплой, одна БД, одна команда поддержки) при сохранении ощущения изоляции у клиента.

## Модель shared-database

Платформа использует подход **shared schema, shared database**:

```
PostgreSQL
└── public schema
    ├── tenants
    ├── users          (есть tenant_id)
    ├── patients       (есть tenant_id)
    ├── appointments   (есть tenant_id)
    └── ...
```

Каждая таблица с tenant-данными имеет колонку `tenant_id` и обязательный индекс с этим полем в составе. Альтернативы (schema-per-tenant, db-per-tenant) рассмотрены, но отклонены:

- **Schema-per-tenant** — сложные сводные запросы для super_admin, дорогие миграции.
- **DB-per-tenant** — невозможна сквозная агрегация, дорогие бэкапы, операционная сложность.

Shared-схема даёт простой ORM-код, дешёвые миграции и быстрые cross-tenant отчёты для super_admin за ту цену, что каждый разработчик обязан помнить про `tenant_id`.

## Механика фильтрации

Все запросы к данным проходят через зависимость `get_db_for_tenant`. Внутри SQLAlchemy session устанавливается PG-параметр `app.tenant_id` через **параметризованный** `set_config()` — это база для PostgreSQL RLS:

```python
async def get_db_for_tenant(tenant_id: str):
    async with AsyncSessionLocal() as session:
        # set_config(name, value, is_local=true) эквивалентен SET LOCAL,
        # но поддерживает bind-параметры → защищён от SQL-injection.
        await session.execute(
            text("SELECT set_config('app.tenant_id', :tid, true)"),
            {"tid": str(tenant_id)},
        )
        yield session
```

> **История (2026-05-12).** Раньше `tenant_id` подставлялся в `SET LOCAL` через f-string, что давало теоретическую SQL-injection-поверхность, если бы значение когда-либо просочилось из user-input. Параметризация через `set_config()` функционально эквивалентна `SET LOCAL`, но безопасна. См. [Безопасность](/wiki/concepts-security#tenant-isolation).

RLS-политики читают `current_setting('app.tenant_id', true)` и фильтруют строки. Дополнительно хук `before_execute` модифицирует SQL, добавляя `WHERE tenant_id = :tenant_id` (defense-in-depth):

```sql
-- Было
SELECT * FROM patients WHERE last_name ILIKE 'иван%';

-- Стало
SELECT * FROM patients
WHERE tenant_id = '01HF...'
  AND last_name ILIKE 'иван%';
```

Super_admin не получает фильтр и видит данные всех тенантов — это нужно для глобальной аналитики и поддержки.

## Slug и маршрутизация

Тенант имеет уникальный `slug` (например, `family-clinic`). Доступ:

- По поддомену: `https://family-clinic.клиниксеть.рф`
- По префиксу пути: `https://клиниксеть.рф/family-clinic/`

`TenantSlugMiddleware` извлекает slug из запроса, разрешает в `tenant_id` и проверяет, что текущий пользователь принадлежит этому тенанту (или super_admin). При несовпадении — 403.

## API ключи и Public API

Для внешних систем тенанта (агрегаторы, мобильные приложения) платформа выдаёт **Tenant API Keys**. Ключ привязан к одному тенанту, имеет scope и срок действия. Запросы с ключом приходят в `/api/v1/*`, который фильтрует по `tenant_id`, привязанному к ключу, и игнорирует JWT.

## Cross-tenant сценарии

Иногда нужно работать с данными за пределами тенанта:

- **Super_admin аналитика** — снимается фильтр.
- **Inter-clinic referrals** — направления между клиниками одной сети. Происходит внутри одного тенанта.
- **Wellness партнёры между франшизами** — НЕ реализовано. Каждая франшиза держит свои партнёры.

## Тестирование изоляции

Платформа имеет автоматические тесты `tests/test_tenant_isolation.py`, которые:

1. Создают двух тенантов A и B с данными.
2. Логинятся пользователем A.
3. Перебирают все эндпоинты GET/LIST.
4. Убеждаются, что в ответе нет данных тенанта B.
5. Дополнительно: пробуют обратиться по UUID объектов B — ожидают 404 или 403.

Линтер `app/utils/tenant_lint.py` сканирует код и выдаёт варнинг на любой SELECT без `tenant_id` в WHERE (кроме whitelist для глобальных таблиц).

## Глобальные таблицы

Не все таблицы имеют tenant_id. «Глобальные» таблицы платформы:

- `tenants` (сам список тенантов)
- `commercial_module_catalog` (каталог модулей)
- `audit_log` (имеет actor_tenant_id, но не основной tenant_id)
- `system_settings` (конфигурация платформы)
- `wiki_pages` (общая wiki)

Запросы к ним идут от super_admin или анонимных (для публичного каталога).

## Безопасность

- Каждая роль работает в контексте одного тенанта (кроме super_admin).
- JWT содержит `tenant_id`, который проверяется на каждом запросе.
- Cross-tenant ссылки на UUID гарантируют 404, потому что фильтр срабатывает раньше доступа к строке.
- Audit log пишет `actor_tenant_id` и `target_tenant_id`, чтобы видеть аномалии (например, super_admin вошёл в тенанта без необходимости).

## Что НЕ изолировано

- **Сетевые ресурсы** — все тенанты делят CPU и память сервера. Heavy запрос одного может замедлить других. Митигейшен — rate-limit и query timeout.
- **Кеш Redis** — ключи имеют префикс `tenant:{id}:...`. Никто не видит чужой ключ, но конкурируют за память.
- **Background queues** — общий APScheduler. Задачи имеют tenant_id в payload.

## Связанные статьи

- [Архитектура](/wiki/intro-architecture)
- [Безопасность](/wiki/concepts-security)
- [Гл. 1: Платформа](/wiki/chapter-1-platform)
- [Public API](/wiki/api-reference)
