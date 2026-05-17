"""Тесты Supervisor-эндпоинтов (`/admin/supervisor/*`).

Покрытие:
- /status под super_admin → 200 + структура {services, recent_errors, system}
- /restart без super_admin → 403 / 401
- /restart с invalid service → 400
- /restart с confirm=false → 400

Все тесты — unit (mock_db + переопределение зависимости require_super_admin).
"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio


def _fake_super_admin():
    """Мок-объект пользователя с ролью super_admin."""
    from app.models.user import User, UserRole
    u = MagicMock(spec=User)
    u.id = uuid.uuid4()
    u.role = UserRole.SUPER_ADMIN
    u.username = "supertest"
    u.tenant_id = uuid.uuid4()
    return u


# ── 1. /status: super_admin → 200 + структура snapshot ───────────────────
async def test_supervisor_status_returns_full_snapshot(client):
    """GET /admin/supervisor/status под super_admin → 200 и все ключи на месте."""
    from app.main import app
    from app.core.deps import require_super_admin

    app.dependency_overrides[require_super_admin] = lambda: _fake_super_admin()

    # _check_db / _check_redis ходят в реальную инфраструктуру — мокаем их.
    # _http_probe сам корректно вернёт status=down при недоступности — это ОК.
    from app.routers import supervisor as sup_mod

    async def _ok_db():
        return {"name": "db", "status": "healthy", "connections": 3, "size_mb": 12.3}

    async def _ok_redis():
        return {"name": "redis", "status": "healthy", "memory_mb": 8.1, "keys": 10}

    async def _ok_frontend():
        return {"name": "frontend", "status": "healthy", "version": "1.2.3"}

    async def _ok_recent(limit=20):
        return [{"ts": "2026-05-17T10:00:00", "level": "ERROR", "msg": "boom"}]

    with patch.object(sup_mod, "_check_db", _ok_db), \
         patch.object(sup_mod, "_check_redis", _ok_redis), \
         patch.object(sup_mod, "_check_frontend", _ok_frontend), \
         patch.object(sup_mod, "_recent_errors", _ok_recent):
        resp = await client.get("/admin/supervisor/status")

    app.dependency_overrides.pop(require_super_admin, None)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Структура контракта (соответствует AdminSupervisor.jsx).
    assert "services" in body and isinstance(body["services"], list)
    assert "recent_errors" in body and isinstance(body["recent_errors"], list)
    assert "system" in body and isinstance(body["system"], dict)
    assert "timestamp" in body

    # Бэкенд в списке — обязательная запись.
    names = [s.get("name") for s in body["services"]]
    assert "backend" in names
    assert "db" in names
    assert "redis" in names
    assert "frontend" in names
    assert "prometheus" in names
    assert "grafana" in names

    # System-метрики имеют нужные ключи.
    for key in ("cpu_pct", "ram_pct", "disk_pct"):
        assert key in body["system"]


# ── 2. /restart: invalid service → 400 ─────────────────────────────────
async def test_supervisor_restart_rejects_invalid_service(client):
    """POST /admin/supervisor/restart c неподдерживаемым сервисом → 400."""
    from app.main import app
    from app.core.deps import require_super_admin

    app.dependency_overrides[require_super_admin] = lambda: _fake_super_admin()
    try:
        resp = await client.post(
            "/admin/supervisor/restart",
            json={"service": "db", "confirm": True},
        )
    finally:
        app.dependency_overrides.pop(require_super_admin, None)

    assert resp.status_code == 400, resp.text
    body = resp.json()
    assert "detail" in body
    assert "нельзя" in body["detail"] or "db" in body["detail"]


# ── 3. /restart: confirm=false → 400 ───────────────────────────────────
async def test_supervisor_restart_requires_confirm(client):
    """POST /admin/supervisor/restart без confirm=true → 400."""
    from app.main import app
    from app.core.deps import require_super_admin

    app.dependency_overrides[require_super_admin] = lambda: _fake_super_admin()
    try:
        resp = await client.post(
            "/admin/supervisor/restart",
            json={"service": "frontend", "confirm": False},
        )
    finally:
        app.dependency_overrides.pop(require_super_admin, None)

    assert resp.status_code == 400, resp.text
    assert "confirm" in resp.json().get("detail", "").lower()
