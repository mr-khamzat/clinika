"""Smoke-тесты router'а partner_offers: RBAC + cross-tenant scope.

Используют ``client`` + ``mock_db`` фикстуры и ``app.dependency_overrides[get_current_user]``
для подмены аутентификации (минуя HTTPBearer/JWT).
"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

pytestmark = pytest.mark.asyncio


# ── Хелпер: фейковый user без полного построения SA-объекта ───────────────


def _make_user(role, clinic_id=None, tenant_id=None):
    """Минимальный User для dependency_overrides[get_current_user]."""
    from app.models.user import User

    u = MagicMock(spec=User)
    u.id = uuid.uuid4()
    u.tenant_id = tenant_id or uuid.uuid4()
    u.clinic_id = clinic_id or uuid.uuid4()
    u.role = role
    u.is_active = True
    u.is_suspended = False
    u.username = "test-user"
    u.full_name = "Test User"
    return u


# ── /clinics/me/partner-categories — RBAC ─────────────────────────────────


async def test_partner_categories_list_returns_empty_for_manager(client, mock_db):
    """GET /clinics/me/partner-categories под MANAGER → 200 + [] (mock_db пуст)."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.MANAGER)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/clinics/me/partner-categories")
        assert r.status_code == 200, r.text
        assert r.json() == []
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_partner_categories_list_works_for_franchise_owner(client, mock_db):
    """FRANCHISE_OWNER тоже в MANAGER_ROLES → 200."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.FRANCHISE_OWNER)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/clinics/me/partner-categories")
        assert r.status_code == 200, r.text
        assert r.json() == []
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_partner_categories_list_forbidden_for_doctor(client, mock_db):
    """DOCTOR — 403 (партнёрский прайс не для врачей)."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.DOCTOR)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/clinics/me/partner-categories")
        assert r.status_code == 403, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_partner_categories_list_forbidden_for_reg(client, mock_db):
    """REG (front-desk) — 403, доступ только у MANAGER+FRANCHISE_OWNER+SUPER_ADMIN."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.REG)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/clinics/me/partner-categories")
        assert r.status_code == 403, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_partner_categories_list_forbidden_for_recruiter(client, mock_db):
    """RECRUITER — 403."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.RECRUITER)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/clinics/me/partner-categories")
        assert r.status_code == 403, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ── /clinics/me/partner-offers — RBAC ─────────────────────────────────────


async def test_partner_offers_list_returns_empty_for_manager(client, mock_db):
    """GET /clinics/me/partner-offers под MANAGER → 200 + []."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.MANAGER)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/clinics/me/partner-offers")
        assert r.status_code == 200, r.text
        assert r.json() == []
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_partner_offers_list_forbidden_for_doctor(client, mock_db):
    """DOCTOR не может видеть свой партнёрский прайс — 403."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.DOCTOR)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        r = await client.get("/clinics/me/partner-offers")
        assert r.status_code == 403, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ── /clinics/{clinic_id}/partner-offers — cross-tenant ────────────────────


async def test_partner_offers_other_clinic_blocked_for_different_tenant(client, mock_db):
    """GET /clinics/{other_clinic_id}/partner-offers возвращает 403 если другой tenant."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.clinic import Clinic
    from app.models.user import UserRole

    other_clinic_id = uuid.uuid4()
    user_tenant = uuid.uuid4()
    other_tenant = uuid.uuid4()

    fake_user = _make_user(UserRole.DOCTOR, tenant_id=user_tenant)
    app.dependency_overrides[get_current_user] = lambda: fake_user

    # Мокаем Clinic lookup — возвращаем клинику в другом tenant.
    clinic = MagicMock(spec=Clinic)
    clinic.id = other_clinic_id
    clinic.tenant_id = other_tenant
    mock_result = MagicMock()
    mock_result.scalar_one_or_none = MagicMock(return_value=clinic)
    mock_db.execute = AsyncMock(return_value=mock_result)

    try:
        r = await client.get(f"/clinics/{other_clinic_id}/partner-offers")
        assert r.status_code == 403, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_partner_offers_other_clinic_404_when_clinic_not_found(client, mock_db):
    """GET /clinics/{unknown}/partner-offers → 404 если клиника не найдена."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    fake_user = _make_user(UserRole.DOCTOR)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    # mock_db по умолчанию возвращает scalar_one_or_none → None.
    try:
        r = await client.get(f"/clinics/{uuid.uuid4()}/partner-offers")
        assert r.status_code == 404, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_partner_offers_other_clinic_same_tenant_allowed(client, mock_db):
    """Внутри одного tenant'а GET /clinics/{other_clinic_id}/partner-offers → 200."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.clinic import Clinic
    from app.models.user import UserRole

    other_clinic_id = uuid.uuid4()
    shared_tenant = uuid.uuid4()

    fake_user = _make_user(UserRole.DOCTOR, tenant_id=shared_tenant)
    app.dependency_overrides[get_current_user] = lambda: fake_user

    clinic = MagicMock(spec=Clinic)
    clinic.id = other_clinic_id
    clinic.tenant_id = shared_tenant  # тот же tenant — доступ разрешён

    # Первый execute → Clinic; второй → пустой список офферов.
    clinic_result = MagicMock()
    clinic_result.scalar_one_or_none = MagicMock(return_value=clinic)
    empty_result = MagicMock()
    empty_result.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))

    call_count = {"n": 0}

    async def fake_execute(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return clinic_result
        return empty_result

    mock_db.execute = AsyncMock(side_effect=fake_execute)

    try:
        r = await client.get(f"/clinics/{other_clinic_id}/partner-offers")
        assert r.status_code == 200, r.text
        assert r.json() == []
    finally:
        app.dependency_overrides.pop(get_current_user, None)
