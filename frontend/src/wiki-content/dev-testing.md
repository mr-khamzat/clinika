# Тестирование

Backend покрыт unit + integration тестами через pytest. Frontend — пока вручную (e2e в roadmap). CI запускает тесты на каждый push в `main`.

## Стек тестирования

- **pytest** — основной test-runner.
- **pytest-asyncio** — для async-функций (`@pytest.mark.asyncio`).
- **httpx.AsyncClient** — для HTTP-тестов FastAPI.
- **factory-boy / factories.py** — фабрики тестовых данных.
- **PostgreSQL test database** — отдельная схема для тестов (создаётся в conftest).

## Структура

```
backend/tests/
├── conftest.py              # фикстуры: db_session, client, auth
├── factories.py             # UserFactory, TenantFactory, AppointmentFactory
├── test_auth.py             # JWT, login, refresh, lockout
├── test_billing.py          # invoices, payments, ledger
├── test_bonus_cascade.py    # каскадный расчёт бонусов с advisory lock
├── test_bonuses.py          # bonus engine: расчёт, idempotency
├── test_loyalty.py          # loyalty earn/redeem, transactions
├── test_referrals.py        # направления: создание, подтверждение
├── test_referrals_race.py   # race-conditions при одновременных подтверждениях
├── test_approve_cancel.py   # confirm + cancel сценарии
├── test_rbac_isolation.py   # роли: doctor не может действовать как manager
├── test_tenant_isolation.py # cross-tenant утечки данных
├── test_tenant_isolation_finance.py # финансы между тенантами
├── test_platforma_ofd_adapter.py    # ОФД-адаптер
└── test_yookassa_adapter.py # ЮKassa-адаптер
```

13 тестовых модулей, 112+ тестовых функций.

## Запуск тестов

```bash
# Все тесты
docker exec clinika-backend pytest /app/tests -v

# Конкретный модуль
docker exec clinika-backend pytest /app/tests/test_loyalty.py -v

# Конкретный тест
docker exec clinika-backend pytest /app/tests/test_loyalty.py::test_earn_basic -v

# Параллельно (если установлен pytest-xdist)
docker exec clinika-backend pytest /app/tests -n auto

# С покрытием
docker exec clinika-backend pytest /app/tests --cov=app --cov-report=term-missing
```

## Фикстуры (conftest.py)

```python
@pytest.fixture
async def db_session():
    """Чистая транзакция для каждого теста, rollback в конце."""

@pytest.fixture
async def client(db_session):
    """httpx AsyncClient с подмонтированным FastAPI app."""

@pytest.fixture
async def tenant(db_session):
    """Создаёт тестовый Tenant."""

@pytest.fixture
async def super_admin_user(db_session, tenant):
    """Создаёт super_admin + возвращает access_token."""

@pytest.fixture
async def manager_user(db_session, tenant):
    """Manager уровня тенанта."""
```

## Фабрики

```python
# factories.py
class UserFactory(factory.Factory):
    class Meta:
        model = User
    id = factory.LazyFunction(uuid4)
    email = factory.Faker("email")
    role = "doctor"
    tenant_id = None  # передаётся явно
```

Использование:
```python
async def test_create_appointment(db_session, tenant):
    doctor = UserFactory(tenant_id=tenant.id, role="doctor")
    db_session.add(doctor)
    await db_session.flush()
    # ... остальной тест
```

## Покрытие критичных сценариев

### Race-conditions (`test_referrals_race.py`)
Параллельные `asyncio.gather(...)` подтверждения одного направления → только одно успешно, остальные `409 Conflict`.

### Bonus cascade (`test_bonus_cascade.py`)
Проверка каскада `bonus_total − platform_fee_floor − recruiter_cut = автор`. Idempotency через `Idempotency-Key` + advisory lock.

### Tenant isolation (`test_tenant_isolation*.py`)
- Создаём 2 тенанта с одинаковыми email пациентов.
- Тенант A не видит данные тенанта B.
- Cross-tenant DirectBill / Invoice — отдельный модуль.

### RBAC (`test_rbac_isolation.py`)
- doctor → `POST /appointments` ok.
- doctor → `POST /admin/users` → 403.
- doctor одного тенанта → endpoint другого тенанта → 403.

## Тестовая БД

`docker-compose.test.yml` (если есть) поднимает отдельную PG-схему для тестов. Migrations применяются автоматически при первом запуске.

В conftest:
```python
@pytest.fixture(scope="session")
async def setup_test_db():
    """Создаёт тестовую схему, применяет миграции, чистит после."""
```

## Mocks

- HTTPX-запросы к внешним API (ЮKassa, AI-транскрипция, AI) — через `respx`.
- SMS-провайдер — `pytest-mock` для патча `send_sms`.
- Telegram-бот — патч `_send_telegram_message`.

Пример:
```python
async def test_yookassa_payment_success(client, respx_mock):
    respx_mock.post("https://api.yookassa.ru/v3/payments").mock(
        return_value=httpx.Response(200, json={"id": "p_1", "status": "succeeded"})
    )
    resp = await client.post("/payments/create", json={...})
    assert resp.status_code == 201
```

## CI/CD

`.github/workflows/test.yml`:
```yaml
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker compose up -d clinika-db clinika-redis
      - run: docker compose run --rm clinika-backend pytest /app/tests -v
```

Test results публикуются в PR-checks.

## Frontend testing

Сейчас только manual QA. В roadmap:
- **Vitest** для unit-тестов компонентов (когда понадобится критичная логика на фронте).
- **Playwright** для e2e сценариев (логин, запись на приём, оплата).

## Регрессионные сценарии (manual checklist)

При релизе backend:
1. Логин super_admin → manager → doctor → patient.
2. Запись на приём → подтверждение → оплата → бонус начислен.
3. Активация модуля → cancel → re-activate.
4. Cross-tenant: пациент тенанта A не виден тенанту B.
5. Region Lock: запрос из неразрешённого региона → алерт.

## Известные пробелы

- Нет тестов на WebRTC signaling (`/presence/ws`).
- Нет тестов на cron-jobs (`acts_overdue_check`, `sms_campaign_dispatch`).
- Frontend без автотестов.
- Нет load-тестов (планируется k6 или locust).

## Смотрите также

- [Dev · Архитектура](dev-architecture.md)
- [Dev · Безопасность](dev-security.md)
- [Dev · Contributing](dev-contributing.md)
