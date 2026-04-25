"""Фикстуры pytest для Clinika backend.

Используем AsyncMock для сессии БД вместо SQLite —
из-за PostgreSQL-специфичных типов (UUID, JSONB) в моделях.
"""
import os
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


async def _dummy_identifier(request: Request) -> str:
    """Тестовый identifier для FastAPILimiter — возвращает константу."""
    return "test-client:test-path"


@pytest.fixture(autouse=True, scope="session")
def mock_fastapi_limiter():
    """Мокаем FastAPILimiter полностью чтобы rate limiter не падал без Redis."""
    from fastapi_limiter import FastAPILimiter

    # Мок redis с evalsha, который всегда возвращает 0 (not rate limited)
    mock_redis = AsyncMock()
    mock_redis.script_load = AsyncMock(return_value="fakeshahex0123456789")
    mock_redis.evalsha = AsyncMock(return_value=0)
    mock_redis.pexpire = AsyncMock()

    FastAPILimiter.redis = mock_redis
    FastAPILimiter.lua_sha = "fakeshahex0123456789"
    FastAPILimiter.prefix = "fastapi-limiter"
    FastAPILimiter.identifier = _dummy_identifier

    # http_callback — стандартный (вызывается если rate limit сработал, т.е. pexpire != 0)
    from fastapi_limiter import http_default_callback
    FastAPILimiter.http_callback = http_default_callback

    yield

    # Восстанавливаем после сессии
    FastAPILimiter.redis = None
    FastAPILimiter.identifier = None


@pytest.fixture
def mock_db():
    """Мок-сессия AsyncSession."""
    session = AsyncMock()
    # execute возвращает result с scalar_one_or_none() == None по умолчанию
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

    # Мокаем Redis для token_blacklist (ленивая инициализация через _get_redis)
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
