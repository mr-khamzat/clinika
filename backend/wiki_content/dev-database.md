# База данных и миграции

PostgreSQL 16 (Alpine), 80+ моделей SQLAlchemy 2.0 (async), 98+ Alembic-миграций. Multi-tenant архитектура: shared schema + фильтрация по `tenant_id`.

## Конфигурация PG

`docker-compose.yml` поднимает `clinika-db` с включённым `pg_stat_statements`:

```yaml
command:
  - postgres
  - -c
  - shared_preload_libraries=pg_stat_statements
  - -c
  - pg_stat_statements.track=all
  - -c
  - pg_stat_statements.max=10000
```

База: `clinika`, пользователь: `clinika`. Healthcheck — `pg_isready`. Данные в Docker volume `clinika-db-data`.

## SQLAlchemy 2.0 async

```python
# database.py
engine = create_async_engine(DATABASE_URL, pool_pre_ping=True, ...)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)

async def get_db():
    async with async_session_factory() as session:
        # set tenant_id для текущего пользователя
        if request.state.tenant_id:
            await session.execute(
                text("SELECT set_config('app.tenant_id', :tid, false)"),
                {"tid": str(request.state.tenant_id)}
            )
        yield session
```

Pattern: `async with` + `await session.execute(...)` + `await session.commit()`.

## Multi-tenancy: tenant_id

Все тенант-зависимые таблицы:
```python
class Appointment(Base):
    id: Mapped[UUID] = mapped_column(primary_key=True)
    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), index=True)
    # ...
```

Везде в queries:
```python
stmt = select(Appointment).where(
    Appointment.tenant_id == current_tenant.id,
    Appointment.id == apt_id,
)
```

`set_config('app.tenant_id', ...)` устанавливает session-variable на уровне PG — может использоваться для RLS policies (если включены).

## Alembic

```bash
# Создать миграцию
docker exec clinika-backend alembic -c /app/alembic.ini revision --autogenerate -m "add column X"

# Применить
docker exec clinika-backend alembic -c /app/alembic.ini upgrade head

# Откатить на одну
docker exec clinika-backend alembic -c /app/alembic.ini downgrade -1

# История
docker exec clinika-backend alembic -c /app/alembic.ini history --verbose
```

Файлы в `/opt/clinika/backend/alembic/versions/`. Имя файла: `<rev_id>_<slug>.py`.

### Конвенции миграций

- Имя файла осмысленное: `add_tenant_module_subscriptions_config`, а не `xxx_changes`.
- Не использовать `op.execute("ALTER TABLE ...")` если можно через ORM.
- Для data-миграций — отдельная revision, отметить `# data migration` в комменте.
- Не править старые миграции — только новые поверх.
- При drop column — сначала задеплоить код без использования, потом drop в следующей миграции.

## Основные таблицы

| Таблица | Назначение |
|---|---|
| `tenants` | Тенанты (франшизы) |
| `users` | Пользователи всех ролей |
| `clinics` | Физические клиники тенанта |
| `patients` | Пациенты (per tenant) |
| `appointments` | Записи на приём |
| `referrals` | Направления (3 типа) |
| `bonuses` | Бонусы для врачей/рекрутеров |
| `medical_records` | ЭМК |
| `commercial_modules` | Каталог платных модулей |
| `tenant_module_subscriptions` | Активные модули тенанта |
| `audit_log` | Audit-trail (action, actor, target) |
| `billing_ledger` | Реестр финансовых операций |

## Индексы

- Все FK имеют индекс.
- Композитные индексы для частых WHERE: `(tenant_id, created_at DESC)`, `(tenant_id, status)`.
- Уникальные: `(tenant_id, phone)` для пациентов.
- JSONB GIN-индексы для конфигов модулей.

## Транзакции и locking

- Финансовые операции (bonus_cascade, loyalty_earn) — в transaction + advisory lock через `pg_advisory_xact_lock`.
- Идемпотентность через `Idempotency-Key` в Redis (TTL 24h) + UNIQUE constraint на ключ операции.
- Race-condition тесты: `test_referrals_race.py`, `test_bonus_cascade.py`.

## Бэкапы

```bash
# Полный дамп
docker exec clinika-db pg_dump -U clinika clinika | gzip > backup_$(date +%F).sql.gz

# Восстановление
gunzip -c backup_X.sql.gz | docker exec -i clinika-db psql -U clinika clinika
```

Скрипт `/opt/clinika/backup.sh` — ежедневно в 03:00 в `/opt/clinika/backups/daily/`. Хранение 14 дней.

## Производительность

- `pg_stat_statements` — топ медленных запросов в Grafana / `EXPLAIN ANALYZE`.
- Соединения: pool 5+10 (sync size + overflow) на backend instance.
- В .env: `DATABASE_URL=postgresql+asyncpg://clinika:clinika_pass@clinika-db:5432/clinika`.

## Безопасность

- Пароль БД хранится только в `.env`, не в коде.
- БД не доступна снаружи (только из `clinika-net`).
- SSL между backend и БД — выключен (внутренняя сеть Docker).
- Шифрование на уровне диска — провайдер.

## Смотрите также

- [Dev · Архитектура](dev-architecture.md)
- [Концепт · Multi-tenancy](concepts-multi-tenancy.md)
- [Dev · Безопасность](dev-security.md)
