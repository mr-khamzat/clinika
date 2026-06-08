"""Unit-тесты для пакета remediation "deps-config" (wave0).

Покрывают находку #37/#32 — CORS-дефолт больше не содержит localhost
в production, но localhost-origin'ы добавляются вне production для dev-фронта.

Тест изолированный: инстанцируем ``Settings`` напрямую с явными kwargs,
БД/Redis не требуются.
"""
from __future__ import annotations

from app.config import Settings


_REQUIRED = dict(
    database_url="postgresql://t:t@localhost/t",
    redis_url="redis://localhost:6379",
    secret_key="x" * 32,
    qr_secret="qr",
    superadmin_username="admin",
    superadmin_password="pass",
)


def _settings(**overrides) -> Settings:
    return Settings(**{**_REQUIRED, **overrides})


def test_default_allowed_origins_has_no_localhost():
    """Дефолт allowed_origins не содержит localhost (закрыт для prod)."""
    s = _settings()
    assert "localhost" not in s.allowed_origins
    assert "127.0.0.1" not in s.allowed_origins


def test_production_origins_exclude_localhost():
    """В production get_allowed_origins() не добавляет localhost."""
    s = _settings(environment="production")
    origins = s.get_allowed_origins()
    assert all("localhost" not in o and "127.0.0.1" not in o for o in origins)
    # prod-домены при этом присутствуют
    assert any("xn--" in o or "клиниксеть" in o for o in origins)


def test_development_origins_include_localhost():
    """Вне production localhost-origin'ы добавляются для dev-фронта (Vite :5173)."""
    s = _settings(environment="development")
    origins = s.get_allowed_origins()
    assert "http://localhost:5173" in origins
    assert "http://127.0.0.1:5173" in origins


def test_staging_origins_include_localhost():
    """staging тоже считается non-production → localhost разрешён."""
    s = _settings(environment="staging")
    origins = s.get_allowed_origins()
    assert "http://localhost:5173" in origins


def test_explicit_localhost_not_duplicated():
    """Если localhost уже задан в allowed_origins — он не дублируется."""
    s = _settings(
        environment="development",
        allowed_origins="https://example.com,http://localhost:5173",
    )
    origins = s.get_allowed_origins()
    assert origins.count("http://localhost:5173") == 1
