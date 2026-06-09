"""Smoke + unit тесты для franchise P&L (services + router RBAC)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, date
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest

pytestmark = pytest.mark.asyncio


def _make_user(role, tenant_id=None):
    """Минимальный User для dependency_overrides[get_current_user]."""
    from app.models.user import User

    u = MagicMock(spec=User)
    u.id = uuid.uuid4()
    u.tenant_id = tenant_id or uuid.uuid4()
    u.clinic_id = uuid.uuid4()
    u.role = role
    u.is_active = True
    u.is_suspended = False
    u.username = "test-user"
    u.full_name = "Test User"
    return u


# ── 1) compute_pnl keys ───────────────────────────────────────────────────


async def test_compute_pnl_returns_keys():
    """compute_pnl возвращает все ожидаемые ключи P&L."""
    from app.services.franchise_pnl_service import compute_pnl

    db = AsyncMock()
    # Сценарий: тенант без франшизы → пустой ответ, но ключи на месте.
    db.get = AsyncMock(return_value=None)
    db.execute = AsyncMock()
    res = await compute_pnl(
        db, uuid.uuid4(),
        datetime(2026, 5, 1), datetime(2026, 5, 31),
    )
    for k in ("revenue", "revenue_by_clinic", "cogs", "gross_margin",
              "taxes", "platform_fee", "net_income"):
        assert k in res, f"Отсутствует ключ {k}"


# ── 2) net_income formula ─────────────────────────────────────────────────


async def test_pnl_net_income_formula():
    """net_income = (revenue - cogs) - taxes - platform_fee."""
    from app.services import franchise_pnl_service as svc

    db = AsyncMock()
    tenant_id = uuid.uuid4()
    franchise_id = uuid.uuid4()

    # Tenant с franchise_id
    fake_tenant = MagicMock()
    fake_tenant.id = tenant_id
    fake_tenant.franchise_id = franchise_id
    fake_tenant.name = "T1"
    fake_tenant.slug = "t1"

    # db.get → Tenant, потом None (для других вызовов)
    db.get = AsyncMock(return_value=fake_tenant)

    # Мокаем все внутренние агрегаторы — детерминированные значения.
    async def _fake_appt(*a, **kw): return Decimal("1000")
    async def _fake_pay(*a, **kw):  return Decimal("500")
    async def _fake_ici(*a, **kw):  return Decimal("200")
    async def _fake_po(*a, **kw):   return Decimal("300")
    async def _fake_cogs(*a, **kw): return (Decimal("400"), False)
    async def _fake_fee(*a, **kw):  return Decimal("100")

    # by_clinic читает Clinic — пусть будет пусто:
    list_tenants_orig = svc._list_tenants

    async def _fake_list(db_, tid):
        return [fake_tenant]

    rev_by_clinic_orig = svc._revenue_by_clinic

    async def _fake_by_clinic(*a, **kw):
        return []

    svc._list_tenants = _fake_list
    svc._revenue_appointments = _fake_appt
    svc._revenue_clinic_payments = _fake_pay
    svc._revenue_inter_clinic = _fake_ici
    svc._revenue_partner_offers = _fake_po
    svc._cogs_spendings = _fake_cogs
    svc._platform_fee = _fake_fee
    svc._revenue_by_clinic = _fake_by_clinic
    try:
        res = await svc.compute_pnl(
            db, tenant_id,
            datetime(2026, 5, 1), datetime(2026, 5, 31),
            tax_rate=Decimal("0.10"),
        )
    finally:
        svc._list_tenants = list_tenants_orig
        svc._revenue_by_clinic = rev_by_clinic_orig

    # revenue = 1000 + 500 + 200 + 300 = 2000
    assert res["revenue"] == 2000.0
    # cogs = 400
    assert res["cogs"] == 400.0
    # gross = 1600
    assert res["gross_margin"] == 1600.0
    # taxes = 2000 * 0.10 = 200
    assert res["taxes"] == 200.0
    # fee = 100
    assert res["platform_fee"] == 100.0
    # net = 1600 - 200 - 100 = 1300
    assert res["net_income"] == 1300.0


# ── 3) RBAC: только franchise_owner / super_admin ─────────────────────────


async def test_get_summary_role_check_franchise_owner_ok(client, mock_db):
    """franchise_owner может вызывать /pnl/summary."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.FRANCHISE_OWNER)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/franchise-owner/pnl/summary")
        # 200 (mock_db без франшизы вернёт пусто) или 404 (нет франшизы) допустимы.
        # Главное не 403.
        assert r.status_code != 403, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_get_summary_role_check_super_admin_ok(client, mock_db):
    """super_admin тоже допущен."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.SUPER_ADMIN)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/franchise-owner/pnl/summary")
        assert r.status_code != 403, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_get_summary_role_check_doctor_forbidden(client, mock_db):
    """Doctor получает 403."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.DOCTOR)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/franchise-owner/pnl/summary")
        assert r.status_code == 403, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ── 4) period validation ──────────────────────────────────────────────────


async def test_period_validation_400(client, mock_db):
    """Период custom без from/to → 400."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.FRANCHISE_OWNER)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/franchise-owner/pnl/summary?period=custom")
        assert r.status_code == 400, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_period_invalid_name_400(client, mock_db):
    """Неподдерживаемое имя периода → 400."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.FRANCHISE_OWNER)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/franchise-owner/pnl/summary?period=eternity")
        assert r.status_code == 400, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ── 5) resolve_period ─────────────────────────────────────────────────────


def test_resolve_period_current_month():
    from app.services.franchise_pnl_service import resolve_period
    s, e, label = resolve_period("current_month", None, None)
    assert label == "current_month"
    assert s.day == 1
    assert e >= s


def test_resolve_period_custom_requires_dates():
    from app.services.franchise_pnl_service import resolve_period
    with pytest.raises(ValueError):
        resolve_period("custom", None, None)


def test_resolve_period_custom_ok():
    from app.services.franchise_pnl_service import resolve_period
    s, e, label = resolve_period("custom", date(2026, 1, 1), date(2026, 1, 31))
    assert label == "custom"
    assert s.date() == date(2026, 1, 1)
    assert e.date() == date(2026, 1, 31)


def test_resolve_period_custom_reversed_dates():
    from app.services.franchise_pnl_service import resolve_period
    with pytest.raises(ValueError):
        resolve_period("custom", date(2026, 2, 1), date(2026, 1, 1))
