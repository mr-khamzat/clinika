"""Тесты Tenant Health (service + router).

Используем mock-based client + dependency overrides — без реальной БД.
Сервис тестируем напрямую с mock_db (text(...).execute → 0 / пустой).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

pytestmark = pytest.mark.asyncio


# ─── helpers ────────────────────────────────────────────────────────────────


def _make_user(role):
    """Минимальный фейк User для get_current_user override."""
    from app.models.user import User

    u = MagicMock(spec=User)
    u.id = uuid.uuid4()
    u.tenant_id = uuid.uuid4()
    u.role = role
    u.is_active = True
    u.is_suspended = False
    u.username = "test-sa"
    u.full_name = "Super Admin"
    return u


def _exec_result(scalar_value=None, all_value=None, scalar_one_value=None):
    res = MagicMock()
    res.scalar = MagicMock(return_value=scalar_value if scalar_value is not None else 0)
    res.scalar_one_or_none = MagicMock(return_value=scalar_one_value)
    scalars = MagicMock()
    scalars.all = MagicMock(return_value=all_value or [])
    res.scalars = MagicMock(return_value=scalars)
    res.all = MagicMock(return_value=all_value or [])
    res.one = MagicMock(return_value=(0, 0, 0))
    return res


def _make_tenant():
    from app.models.tenant import Tenant

    t = MagicMock(spec=Tenant)
    t.id = uuid.uuid4()
    t.name = "Test Tenant"
    t.slug = "test-tenant"
    t.is_active = True
    return t


def _make_snapshot(score: int = 80, alert_level: str = "green"):
    from app.models.tenant_health import TenantHealthAlertLevel, TenantHealthSnapshot

    s = MagicMock(spec=TenantHealthSnapshot)
    s.id = uuid.uuid4()
    s.tenant_id = uuid.uuid4()
    s.captured_at = datetime.utcnow()
    s.score = score
    s.alert_level = TenantHealthAlertLevel(alert_level)
    s.factors = {"activity_30d": 0.8, "_source": "stub"}
    return s


# ─── SERVICE: compute_score ────────────────────────────────────────────────


async def test_compute_score_returns_dict(mock_db):
    """compute_score возвращает dict с обязательными ключами."""
    from app.services import tenant_health_service as ths

    # to_regclass и любые внутренние COUNT'ы → 0.
    mock_db.execute = AsyncMock(return_value=_exec_result(scalar_value=0))

    out = await ths.compute_score(mock_db, uuid.uuid4())
    assert isinstance(out, dict)
    assert "score" in out
    assert "alert_level" in out
    assert "factors" in out
    assert "_source" in out["factors"]


async def test_score_in_range_0_100(mock_db):
    """score всегда в [0, 100] вне зависимости от ответов БД."""
    from app.services import tenant_health_service as ths

    mock_db.execute = AsyncMock(return_value=_exec_result(scalar_value=0))
    out = await ths.compute_score(mock_db, uuid.uuid4())
    assert 0 <= out["score"] <= 100


@pytest.mark.parametrize(
    "score,expected",
    [
        (80, "green"),
        (50, "yellow"),
        (30, "red"),
    ],
)
async def test_alert_level_classification(score, expected):
    """_classify правильно мапит score → alert_level."""
    from app.services.tenant_health_service import _classify

    assert _classify(score).value == expected


# ─── ROUTER: GET / (super_admin) ───────────────────────────────────────────


async def test_get_all_super_admin(client, mock_db):
    """GET /admin/tenant-health/ под super_admin → 200."""
    from app.main import app
    from app.core.deps import get_current_user, require_super_admin
    from app.models.user import UserRole

    sa = _make_user(UserRole.SUPER_ADMIN)

    # Первый execute — выборка тенантов; следующие — snapshot per tenant (None).
    # mock_db.execute по умолчанию возвращает пустой scalars().all().
    mock_db.execute = AsyncMock(return_value=_exec_result(all_value=[]))

    app.dependency_overrides[require_super_admin] = lambda: sa
    app.dependency_overrides[get_current_user] = lambda: sa
    try:
        r = await client.get("/admin/tenant-health/")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)
    finally:
        app.dependency_overrides.pop(require_super_admin, None)
        app.dependency_overrides.pop(get_current_user, None)


# ─── ROUTER: POST /{id}/recompute ──────────────────────────────────────────


async def test_recompute_creates_snapshot(client, mock_db):
    """POST /admin/tenant-health/{tenant_id}/recompute создаёт snapshot."""
    from app.main import app
    from app.core.deps import get_current_user, require_super_admin
    from app.models.user import UserRole

    sa = _make_user(UserRole.SUPER_ADMIN)
    tenant = _make_tenant()

    # 1-ый execute — поиск тенанта (scalar_one_or_none → tenant).
    # Все остальные внутри snapshot_tenant → service использует TEXT-запросы,
    # возвращаем 0 (заглушки) везде.
    mock_db.execute = AsyncMock(
        return_value=_exec_result(scalar_one_value=tenant, scalar_value=0)
    )
    # add + flush + commit + refresh — заглушки.
    mock_db.add = MagicMock()
    mock_db.flush = AsyncMock()
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock()

    app.dependency_overrides[require_super_admin] = lambda: sa
    app.dependency_overrides[get_current_user] = lambda: sa
    try:
        r = await client.post(f"/admin/tenant-health/{tenant.id}/recompute")
        assert r.status_code == 201, r.text
        body = r.json()
        assert "score" in body
        assert "alert_level" in body
    finally:
        app.dependency_overrides.pop(require_super_admin, None)
        app.dependency_overrides.pop(get_current_user, None)


# ─── ROUTER: GET /alerts ───────────────────────────────────────────────────


async def test_alerts_filters_correctly(client, mock_db):
    """GET /admin/tenant-health/alerts возвращает только yellow|red."""
    from app.main import app
    from app.core.deps import get_current_user, require_super_admin
    from app.models.user import UserRole

    sa = _make_user(UserRole.SUPER_ADMIN)

    tenant_green = _make_tenant()
    tenant_yellow = _make_tenant()
    tenant_red = _make_tenant()
    snap_green = _make_snapshot(score=80, alert_level="green")
    snap_yellow = _make_snapshot(score=50, alert_level="yellow")
    snap_red = _make_snapshot(score=30, alert_level="red")

    # Поток вызовов execute (по порядку):
    # 1) select Tenants → 3 тенанта
    # 2..N) для каждого тенанта snapshot → green / yellow / red
    call_results = [
        _exec_result(all_value=[tenant_green, tenant_yellow, tenant_red]),
        _exec_result(scalar_one_value=snap_green),
        _exec_result(scalar_one_value=snap_yellow),
        _exec_result(scalar_one_value=snap_red),
    ]
    mock_db.execute = AsyncMock(side_effect=call_results)

    app.dependency_overrides[require_super_admin] = lambda: sa
    app.dependency_overrides[get_current_user] = lambda: sa
    try:
        r = await client.get("/admin/tenant-health/alerts")
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list)
        # Только yellow и red должны попасть в ответ
        levels = {row["alert_level"] for row in body}
        assert "green" not in levels
        assert levels.issubset({"yellow", "red"})
        assert len(body) == 2
    finally:
        app.dependency_overrides.pop(require_super_admin, None)
        app.dependency_overrides.pop(get_current_user, None)
