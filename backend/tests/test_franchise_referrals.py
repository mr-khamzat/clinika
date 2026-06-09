"""Тесты сервиса и роутера переливов пациентов (cross-clinic referrals matrix)."""
from __future__ import annotations

import uuid
from datetime import datetime
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


# ── 1) compute_matrix format ──────────────────────────────────────────────


async def test_compute_matrix_format_empty():
    """Если франшизы нет — корректный пустой ответ с полным набором ключей."""
    from app.services.franchise_referral_service import compute_matrix
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)
    db.execute = AsyncMock()
    res = await compute_matrix(
        db, uuid.uuid4(),
        datetime(2026, 5, 1), datetime(2026, 5, 31),
    )
    assert "matrix" in res
    assert "totals" in res
    assert "tenants" in res
    assert res["totals"]["total_count"] == 0
    assert res["totals"]["top_directions"] == []


async def test_compute_matrix_groups_directions():
    """compute_matrix формирует строки матрицы и считает итоги."""
    from app.services import franchise_referral_service as svc

    db = AsyncMock()
    franchise_id = uuid.uuid4()
    t1_id, t2_id = uuid.uuid4(), uuid.uuid4()
    t1 = MagicMock(); t1.id = t1_id; t1.franchise_id = franchise_id; t1.name = "Клиника-1"; t1.slug = "k1"
    t2 = MagicMock(); t2.id = t2_id; t2.franchise_id = franchise_id; t2.name = "Клиника-2"; t2.slug = "k2"

    # _list_tenants → [t1, t2]
    list_orig = svc._list_tenants
    name_orig = svc._clinic_name
    async def _fake_list(db_, tid):
        return [t1, t2]
    async def _fake_name(db_, tid):
        return "Клиника"
    svc._list_tenants = _fake_list
    svc._clinic_name = _fake_name

    # Мок строки от db.execute(...) — две группы.
    row1 = MagicMock(); row1.from_id = t1_id; row1.to_id = t2_id; row1.cnt = 5; row1.amt = Decimal("1500")
    row2 = MagicMock(); row2.from_id = t2_id; row2.to_id = t1_id; row2.cnt = 2; row2.amt = Decimal("600")
    exec_res = MagicMock()
    exec_res.all = MagicMock(return_value=[row1, row2])
    db.execute = AsyncMock(return_value=exec_res)

    try:
        res = await svc.compute_matrix(
            db, t1_id,
            datetime(2026, 5, 1), datetime(2026, 5, 31),
        )
    finally:
        svc._list_tenants = list_orig
        svc._clinic_name = name_orig

    assert len(res["matrix"]) == 2
    assert res["totals"]["total_count"] == 7
    assert res["totals"]["total_amount"] == 2100.0
    # топ-5 включает обе строки
    assert len(res["totals"]["top_directions"]) == 2
    # порядок: сначала строка с большим count
    assert res["matrix"][0]["count"] == 5


# ── 2) top limit ──────────────────────────────────────────────────────────


async def test_get_top_limits():
    """compute_top отсекает по `limit`."""
    from app.services import franchise_referral_service as svc

    matrix_orig = svc.compute_matrix
    async def _fake_matrix(db_, tid, s, e):
        return {
            "matrix": [{"from_clinic_id": "a", "to_clinic_id": "b", "count": i, "total_amount": 0.0,
                        "from_clinic_name": "", "to_clinic_name": "",
                        "from_tenant_id": "a", "from_tenant_name": "",
                        "to_tenant_id": "b", "to_tenant_name": ""}
                       for i in range(20)],
        }
    svc.compute_matrix = _fake_matrix
    try:
        top = await svc.compute_top(AsyncMock(), uuid.uuid4(), datetime.utcnow(), datetime.utcnow(), limit=3)
    finally:
        svc.compute_matrix = matrix_orig
    assert len(top) == 3


# ── 3) Router RBAC ────────────────────────────────────────────────────────


async def test_role_check_franchise_owner(client, mock_db):
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.FRANCHISE_OWNER)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/franchise-owner/referrals/matrix")
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
        r = await client.get("/franchise-owner/referrals/matrix")
        assert r.status_code == 403, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_role_check_top_doctor_forbidden(client, mock_db):
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.DOCTOR)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/franchise-owner/referrals/top?limit=5")
        assert r.status_code == 403, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)
