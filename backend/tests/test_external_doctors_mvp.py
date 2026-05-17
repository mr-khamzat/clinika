"""
Unit-тесты MVP-инфраструктуры External Doctors.

Проверяем role guards и pydantic-схемы новых endpoints
/manager/external-doctors и /manager/acquisition-managers.

Тесты помечены ``unit`` — БД мокается (см. conftest.py: mock_db / client).
"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.unit


# ─── Role guards: без токена → 401/403 ────────────────────────────────────


@pytest.mark.asyncio
async def test_external_doctors_list_requires_auth(client):
    """GET /manager/external-doctors без токена → 401/403."""
    resp = await client.get("/manager/external-doctors")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_external_doctors_create_requires_auth(client):
    """POST /manager/external-doctors без токена → 401/403."""
    resp = await client.post("/manager/external-doctors", json={
        "full_name": "Иванов Иван",
        "username": "ivanov_ext",
        "password": "pass1234",
    })
    assert resp.status_code in (401, 403, 422)


@pytest.mark.asyncio
async def test_external_doctors_patch_requires_auth(client):
    """PATCH /manager/external-doctors/{id} без токена → 401/403."""
    fake_id = uuid.uuid4()
    resp = await client.patch(
        f"/manager/external-doctors/{fake_id}",
        json={"external_doctor_active": False},
    )
    assert resp.status_code in (401, 403, 422)


@pytest.mark.asyncio
async def test_acquisition_managers_list_requires_auth(client):
    """GET /manager/acquisition-managers без токена → 401/403."""
    resp = await client.get("/manager/acquisition-managers")
    assert resp.status_code in (401, 403)


# ─── Pydantic-схема: ExternalRate валидация ────────────────────────────────


def test_external_rate_schema_valid():
    """ExternalRate принимает percent/fixed с числовым value."""
    from app.routers.manager.external_doctors import ExternalRate

    r1 = ExternalRate(type="percent", value=30)
    assert r1.type == "percent"
    assert r1.value == 30
    assert r1.currency == "RUB"

    r2 = ExternalRate(type="fixed", value=1500, currency="RUB")
    assert r2.type == "fixed"
    assert r2.value == 1500


def test_external_rate_schema_rejects_negative():
    """ExternalRate отклоняет отрицательный value."""
    from pydantic import ValidationError
    from app.routers.manager.external_doctors import ExternalRate

    with pytest.raises(ValidationError):
        ExternalRate(type="percent", value=-5)


# ─── Smoke: роутер зарегистрирован ─────────────────────────────────────────


def test_external_doctors_router_registered():
    """Endpoints зарегистрированы в FastAPI app."""
    from app.main import app

    paths = {route.path for route in app.routes if hasattr(route, "path")}
    assert "/manager/external-doctors" in paths
    assert "/manager/external-doctors/{doctor_id}" in paths
    assert "/manager/acquisition-managers" in paths
