"""Фикстуры pytest для Clinika backend.

Стратегия:
- **Unit-тесты (по умолчанию)** — используют ``mock_db`` (AsyncMock) и
  тестовый ``client`` через ``httpx.AsyncClient`` + ``ASGITransport``.
  PostgreSQL не нужен — все обращения к БД заглушены.

- **Integration-тесты** (маркер ``@pytest.mark.integration``) — могут
  опционально использовать ``pg_container``/``pg_engine``/``db_session``,
  которые поднимают реальный PostgreSQL через ``testcontainers``.
  Требуют установленного Docker и наличия `testcontainers` в зависимостях.
  Если ``testcontainers`` не установлен или Docker недоступен — тесты с
  этими фикстурами **скипаются** (а не падают), поэтому unit-набор всегда зелёный.

Фабрики ``factory_boy`` лежат рядом в ``tests/factories.py`` и могут
импортироваться как из unit-, так и из integration-тестов.
"""
from __future__ import annotations

import os
from typing import AsyncIterator

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock
from starlette.requests import Request

# Выставляем тестовые переменные окружения ДО импорта app
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-pytest-32chars!!")
os.environ.setdefault("QR_SECRET", "test-qr-secret")
os.environ.setdefault("SUPERADMIN_USERNAME", "testadmin")
os.environ.setdefault("SUPERADMIN_PASSWORD", "testpass")
os.environ.setdefault("SUPERADMIN_FULL_NAME", "Test Admin")


# ─── Unit-фикстуры (mock-based, без Docker) ──────────────────────────────────


async def _dummy_identifier(request: Request) -> str:
    """Тестовый identifier для FastAPILimiter — возвращает константу."""
    return "test-client:test-path"


@pytest.fixture(autouse=True, scope="session")
def mock_fastapi_limiter():
    """Мокаем FastAPILimiter полностью чтобы rate limiter не падал без Redis."""
    from fastapi_limiter import FastAPILimiter

    mock_redis = AsyncMock()
    mock_redis.script_load = AsyncMock(return_value="fakeshahex0123456789")
    mock_redis.evalsha = AsyncMock(return_value=0)
    mock_redis.pexpire = AsyncMock()

    FastAPILimiter.redis = mock_redis
    FastAPILimiter.lua_sha = "fakeshahex0123456789"
    FastAPILimiter.prefix = "fastapi-limiter"
    FastAPILimiter.identifier = _dummy_identifier

    from fastapi_limiter import http_default_callback
    FastAPILimiter.http_callback = http_default_callback

    yield

    FastAPILimiter.redis = None
    FastAPILimiter.identifier = None


@pytest.fixture
def mock_db():
    """Мок-сессия AsyncSession (по умолчанию execute → пустой результат)."""
    session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_result.scalars.return_value.all.return_value = []
    session.execute = AsyncMock(return_value=mock_result)
    session.commit = AsyncMock()
    session.add = MagicMock()
    session.refresh = AsyncMock()
    session.flush = AsyncMock()
    return session


@pytest_asyncio.fixture
async def client(mock_db, mock_fastapi_limiter):
    """Тестовый HTTP клиент с переопределённой зависимостью БД."""
    from app.main import app
    from app.database import get_db

    async def override_get_db():
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db

    import app.core.token_blacklist as _tbl
    _orig_redis = _tbl._redis_client
    _mock_redis = AsyncMock()
    _mock_redis.setex = AsyncMock()
    _mock_redis.exists = AsyncMock(return_value=0)
    _tbl._redis_client = _mock_redis

    from httpx import AsyncClient, ASGITransport
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()
    _tbl._redis_client = _orig_redis


# ─── Integration-фикстуры (testcontainers PostgreSQL) ────────────────────────
# Все три ниже скипаются если нет Docker / testcontainers — поэтому unit-набор
# не падает в окружениях без Docker (CI шаг lint, локально без docker).


@pytest.fixture(scope="session")
def pg_container():
    """Поднимает PostgreSQL 16 в Docker через testcontainers (1 раз на сессию).

    Skip если:
      - не установлен пакет ``testcontainers`` (нет в minimal-окружении);
      - Docker daemon недоступен (CI без docker-in-docker).
    """
    try:
        from testcontainers.postgres import PostgresContainer  # type: ignore
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"testcontainers недоступен: {exc}")

    try:
        with PostgresContainer("postgres:16-alpine") as pg:
            yield pg
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"Docker недоступен для testcontainers: {exc}")


@pytest_asyncio.fixture(scope="session")
async def pg_engine(pg_container):
    """Async SQLAlchemy engine для БД из ``pg_container``.

    Создаёт все таблицы по ``Base.metadata`` (Alembic-миграции не запускаем —
    долго и зависят от истории). Тест проверяет логику; схему — через ORM.
    """
    from sqlalchemy.ext.asyncio import create_async_engine
    from app.database import Base
    # триггерим импорт всех моделей чтобы Base.metadata содержал все таблицы
    import app.models  # noqa: F401

    raw_url = pg_container.get_connection_url()
    # testcontainers возвращает psycopg2 URL — переключаем на asyncpg
    async_url = raw_url.replace("postgresql+psycopg2://", "postgresql+asyncpg://").replace(
        "postgresql://", "postgresql+asyncpg://"
    )
    engine = create_async_engine(async_url, echo=False, pool_pre_ping=True)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(pg_engine) -> AsyncIterator:
    """Чистая сессия: каждый тест в отдельной транзакции с rollback в конце."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    SessionLocal = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as session:
        try:
            yield session
        finally:
            await session.rollback()


# ─── Хелперы-фабрики (factory_boy) ───────────────────────────────────────────
# Прокидываем factory_boy фабрики через фикстуры, чтобы тесты могли запросить
# их по имени (``user_factory``, ``tenant_factory``, ``referral_factory``).


@pytest.fixture
def tenant_factory():
    from tests.factories import TenantFactory
    return TenantFactory


@pytest.fixture
def user_factory():
    from tests.factories import UserFactory
    return UserFactory


@pytest.fixture
def manager_factory():
    from tests.factories import ManagerFactory
    return ManagerFactory


@pytest.fixture
def reg_factory():
    from tests.factories import RegFactory
    return RegFactory


@pytest.fixture
def recruiter_factory():
    from tests.factories import RecruiterFactory
    return RecruiterFactory


@pytest.fixture
def partner_doctor_factory():
    from tests.factories import PartnerDoctorFactory
    return PartnerDoctorFactory


@pytest.fixture
def referral_factory():
    from tests.factories import ReferralFactory
    return ReferralFactory
