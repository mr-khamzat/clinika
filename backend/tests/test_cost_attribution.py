"""Тесты Cost Attribution (service + router)."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest

pytestmark = pytest.mark.asyncio


# ─── helpers ────────────────────────────────────────────────────────────────


def _make_user(role):
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


def _exec_result(scalar_value=None, all_value=None, scalar_one_value=None, one_value=None):
    res = MagicMock()
    res.scalar = MagicMock(return_value=scalar_value if scalar_value is not None else 0)
    # scalar_one_or_none: явный scalar_one_value > общий scalar_value > None
    _sc1 = scalar_one_value if scalar_one_value is not None else scalar_value
    res.scalar_one_or_none = MagicMock(return_value=_sc1)
    scalars = MagicMock()
    scalars.all = MagicMock(return_value=all_value or [])
    res.scalars = MagicMock(return_value=scalars)
    res.all = MagicMock(return_value=all_value or [])
    res.one = MagicMock(return_value=one_value if one_value is not None else (0, 0, 0))
    res.first = MagicMock(return_value=(all_value[0] if all_value else None))
    return res


def _make_tenant():
    from app.models.tenant import Tenant

    t = MagicMock(spec=Tenant)
    t.id = uuid.uuid4()
    t.name = "Test Tenant"
    t.slug = "test-tenant"
    t.is_active = True
    return t


def _make_cost_snapshot(est_cost: float = 100.0):
    from app.models.cost_attribution import TenantCostSnapshot

    s = MagicMock(spec=TenantCostSnapshot)
    s.id = uuid.uuid4()
    s.tenant_id = uuid.uuid4()
    s.period = date.today().replace(day=1)
    s.storage_mb = 500
    s.api_requests = 10000
    s.db_rows_estimate = 50000
    s.calls_minutes = 200
    s.est_cost_rub = Decimal(str(est_cost))
    s.captured_at = datetime.utcnow()
    return s


# ─── SERVICE: compute_costs ────────────────────────────────────────────────


async def test_compute_costs_returns_dict(mock_db):
    """compute_costs возвращает dict с обязательными ключами."""
    from app.services import cost_service

    # to_regclass и любые SUM/COUNT → 0.
    mock_db.execute = AsyncMock(return_value=_exec_result(scalar_value=0))
    out = await cost_service.compute_costs(
        mock_db, uuid.uuid4(), date.today().replace(day=1)
    )
    assert isinstance(out, dict)
    for key in (
        "storage_mb",
        "api_requests",
        "db_rows_estimate",
        "calls_minutes",
        "est_cost_rub",
    ):
        assert key in out


def test_est_cost_formula():
    """_calc_est_cost = storage*0.5 + api*0.001 + calls*0.5."""
    from app.services.cost_service import _calc_est_cost

    # 100MB * 0.5 + 10000req * 0.001 + 30min * 0.5
    # = 50 + 10 + 15 = 75.00
    cost = _calc_est_cost(100, 10000, 30)
    assert cost == Decimal("75.00")

    # Нулевые значения → 0.00
    assert _calc_est_cost(0, 0, 0) == Decimal("0.00")


# ─── ROUTER: GET / (top tenants) ───────────────────────────────────────────


async def test_get_top_tenants_super_admin(client, mock_db):
    """GET /admin/cost-attribution/ под super_admin возвращает топ тенантов."""
    from app.main import app
    from app.core.deps import get_current_user, require_super_admin
    from app.models.user import UserRole

    sa = _make_user(UserRole.SUPER_ADMIN)

    tenant1 = _make_tenant()
    snap1 = _make_cost_snapshot(est_cost=500.0)
    period = date.today().replace(day=1)

    # 1-ый execute — _latest_snapshot_period → возвращаем period
    # 2-ой execute — select JOIN → all_value = [(snap, tenant)]
    call_results = [
        _exec_result(scalar_value=period),
        _exec_result(all_value=[(snap1, tenant1)]),
    ]
    mock_db.execute = AsyncMock(side_effect=call_results)

    app.dependency_overrides[require_super_admin] = lambda: sa
    app.dependency_overrides[get_current_user] = lambda: sa
    try:
        r = await client.get("/admin/cost-attribution/")
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list)
        assert len(body) == 1
        assert body[0]["est_cost_rub"] == 500.0
        assert body[0]["tenant_name"] == "Test Tenant"
    finally:
        app.dependency_overrides.pop(require_super_admin, None)
        app.dependency_overrides.pop(get_current_user, None)


# ─── ROUTER: GET /summary ──────────────────────────────────────────────────


async def test_summary_aggregates(client, mock_db):
    """GET /admin/cost-attribution/summary возвращает total/avg/count/top."""
    from app.main import app
    from app.core.deps import get_current_user, require_super_admin
    from app.models.user import UserRole

    sa = _make_user(UserRole.SUPER_ADMIN)

    tenant1 = _make_tenant()
    snap1 = _make_cost_snapshot(est_cost=500.0)
    period = date.today().replace(day=1)

    # 1) _latest_snapshot_period → period
    # 2) agg SUM/AVG/COUNT → (1000, 500, 2)
    # 3) top → first → (snap1, tenant1)
    call_results = [
        _exec_result(scalar_value=period),
        _exec_result(one_value=(Decimal("1000"), Decimal("500"), 2)),
        _exec_result(all_value=[(snap1, tenant1)]),
    ]
    mock_db.execute = AsyncMock(side_effect=call_results)

    app.dependency_overrides[require_super_admin] = lambda: sa
    app.dependency_overrides[get_current_user] = lambda: sa
    try:
        r = await client.get("/admin/cost-attribution/summary")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total_cost_rub"] == 1000.0
        assert body["avg_cost_rub"] == 500.0
        assert body["tenant_count"] == 2
        assert body["top_tenant"]["est_cost_rub"] == 500.0
    finally:
        app.dependency_overrides.pop(require_super_admin, None)
        app.dependency_overrides.pop(get_current_user, None)
