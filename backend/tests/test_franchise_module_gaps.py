"""Тесты сервиса и роутера «Остатки модулей» (gap-analysis по клиникам)."""
from __future__ import annotations

import uuid
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest

pytestmark = pytest.mark.asyncio


def _make_user(role, tenant_id=None):
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


# ── 1) compute_gaps returns list ──────────────────────────────────────────


async def test_compute_gaps_returns_list_empty():
    """Если нет франшизы — пустой список."""
    from app.services.franchise_module_gaps_service import compute_gaps
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)
    res = await compute_gaps(db, uuid.uuid4())
    assert res == []


async def test_compute_gaps_builds_clinic_rows():
    """Для каждого тенанта формируется запись с missing_modules + potential_revenue."""
    from app.services import franchise_module_gaps_service as svc

    db = AsyncMock()
    franchise_id = uuid.uuid4()
    t_id = uuid.uuid4()

    # Tenant + Franchise + Clinic стабы
    tenant = MagicMock(); tenant.id = t_id; tenant.franchise_id = franchise_id
    tenant.name = "Клиника-1"; tenant.slug = "k1"
    franchise = MagicMock(); franchise.id = franchise_id; franchise.name = "Сеть"
    clinic = MagicMock(); clinic.id = uuid.uuid4(); clinic.name = "Главная"

    # Каталожный модуль (1 шт)
    module = MagicMock()
    module.key = "ai_assistant"; module.name = "AI ассистент"
    module.category = "ai"; module.price_monthly = Decimal("3000"); module.is_active = True

    # db.get → Tenant, потом Franchise
    db.get = AsyncMock(side_effect=[tenant, franchise])

    # db.execute последовательность:
    # 1) список тенантов
    # 2) список модулей
    # 3) список грантов
    # 4) Clinic (для тенанта)
    rt = MagicMock(); rt.scalars.return_value.all.return_value = [tenant]
    rm = MagicMock(); rm.scalars.return_value.all.return_value = [module]
    rg = MagicMock(); rg.scalars.return_value.all.return_value = []  # нет грантов
    rc = MagicMock(); rc.scalar_one_or_none.return_value = clinic

    db.execute = AsyncMock(side_effect=[rt, rm, rg, rc])

    res = await svc.compute_gaps(db, t_id)
    assert isinstance(res, list)
    assert len(res) == 1
    row = res[0]
    assert row["tenant_name"] == "Клиника-1"
    assert row["clinic_name"] == "Главная"
    assert row["missing_count"] == 1
    assert row["missing_modules"][0]["key"] == "ai_assistant"
    assert row["potential_revenue"] == 3000.0


# ── 2) summary aggregates ─────────────────────────────────────────────────


async def test_summary_aggregates_potential_revenue():
    """summary считает total_potential_revenue + top_missing_modules."""
    from app.services import franchise_module_gaps_service as svc

    gaps_orig = svc.compute_gaps

    async def _fake_gaps(db_, tid):
        return [
            {
                "clinic_id": "1", "clinic_name": "К-1", "tenant_id": "t1",
                "tenant_name": "T1", "tenant_slug": "t1",
                "missing_modules": [
                    {"key": "ai", "name": "AI", "category": "ai", "monthly_price_rub": 3000.0},
                    {"key": "tel", "name": "Tel", "category": "telephony", "monthly_price_rub": 5000.0},
                ],
                "missing_count": 2, "potential_revenue": 8000.0,
            },
            {
                "clinic_id": "2", "clinic_name": "К-2", "tenant_id": "t2",
                "tenant_name": "T2", "tenant_slug": "t2",
                "missing_modules": [
                    {"key": "ai", "name": "AI", "category": "ai", "monthly_price_rub": 3000.0},
                ],
                "missing_count": 1, "potential_revenue": 3000.0,
            },
        ]
    svc.compute_gaps = _fake_gaps
    try:
        summary = await svc.compute_summary(AsyncMock(), uuid.uuid4())
    finally:
        svc.compute_gaps = gaps_orig

    assert summary["total_clinics"] == 2
    assert summary["clinics_with_gaps"] == 2
    assert summary["total_potential_revenue"] == 11000.0
    # top: AI присутствует в 2 клиниках, поэтому суммарно 6000
    keys = [m["key"] for m in summary["top_missing_modules"]]
    assert "ai" in keys
    ai_entry = next(m for m in summary["top_missing_modules"] if m["key"] == "ai")
    assert ai_entry["missing_clinics_count"] == 2
    assert ai_entry["potential_revenue"] == 6000.0


# ── 3) RBAC ───────────────────────────────────────────────────────────────


async def test_role_check_franchise_owner(client, mock_db):
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.FRANCHISE_OWNER)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/franchise-owner/module-gaps")
        assert r.status_code != 403, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_role_check_doctor_forbidden(client, mock_db):
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.DOCTOR)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/franchise-owner/module-gaps")
        assert r.status_code == 403, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_role_check_summary_forbidden_for_recruiter(client, mock_db):
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.RECRUITER)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/franchise-owner/module-gaps/summary")
        assert r.status_code == 403, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)
