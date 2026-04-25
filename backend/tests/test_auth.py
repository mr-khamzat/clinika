"""Тесты аутентификации Clinika backend.

Покрывают: login, refresh, logout, защищённые endpoints.
Используют mock_db (AsyncMock) — без реального PostgreSQL.
"""
import pytest

pytestmark = pytest.mark.asyncio


async def test_login_wrong_password(client):
    """Неверный пароль → 401 (пользователь не найден в БД)."""
    resp = await client.post("/auth/login", json={
        "username": "nonexistent@test.com",
        "password": "wrongpassword"
    })
    assert resp.status_code == 401


async def test_login_missing_fields(client):
    """Пустой запрос (нет username/password) → 422 Validation Error."""
    resp = await client.post("/auth/login", json={})
    assert resp.status_code == 422


async def test_login_missing_password(client):
    """Только username без пароля → 422."""
    resp = await client.post("/auth/login", json={"username": "user@test.com"})
    assert resp.status_code == 422


async def test_login_missing_username(client):
    """Только пароль без username → 422."""
    resp = await client.post("/auth/login", json={"password": "secret"})
    assert resp.status_code == 422


async def test_protected_admin_no_token(client):
    """Запрос на /admin/tenants без токена → 401 или 403."""
    resp = await client.get("/admin/tenants")
    assert resp.status_code in (401, 403)


async def test_protected_admins_me_no_token(client):
    """Запрос на /admins/me без токена → 401 или 403."""
    resp = await client.get("/admins/me")
    assert resp.status_code in (401, 403)


async def test_refresh_token_invalid(client):
    """Невалидный refresh token — не найден в БД → 401."""
    resp = await client.post("/auth/refresh", json={"refresh_token": "invalid.token.here"})
    assert resp.status_code == 401


async def test_refresh_token_missing_field(client):
    """Пустой body для refresh → 422."""
    resp = await client.post("/auth/refresh", json={})
    assert resp.status_code == 422


async def test_health_endpoint(client):
    """Health check → 200."""
    resp = await client.get("/health")
    assert resp.status_code == 200


async def test_logout_invalid_refresh(client):
    """Logout с несуществующим refresh token — не падает, возвращает ok."""
    resp = await client.post("/auth/logout", json={"refresh_token": "fake-refresh-token"})
    assert resp.status_code == 200
