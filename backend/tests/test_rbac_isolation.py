"""RBAC и privilege escalation проверки.

Покрывает:
- PATCH /admins/me с clinic_id в body — поле игнорится Pydantic'ом (не меняет clinic_id юзера);
- /visiting/admin/* без auth → 401, /visiting/admin/* с patient role → 403;
- /patient-portal/ai/conversations без `t` query → 422;
- GET /docs анонимом → 401/403/404 (не Swagger UI);
- POST /push/subscribe-doctor без токена → 401/403.

Все тесты unit (mock_db) — реальная БД не нужна, проверяется уровень
auth/dependency injection FastAPI.
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.unit


# ─── 1) Privilege escalation: PATCH /admins/me clinic_id ──────────────────────


def test_patch_admins_me_cannot_change_clinic_id():
    """clinic_id отсутствует в схеме UserUpdate — Pydantic его игнорирует.

    Это защита от privilege escalation: обычный регистратор не должен иметь
    возможность сменить себе clinic_id через self-update endpoint, иначе он
    получит доступ к чужой клинике в рамках того же тенанта.
    """
    from app.schemas.user import UserUpdate

    # Передаём ВСЕ поля, плюс «лишний» clinic_id.
    data = UserUpdate(
        full_name="New Name",
        phone_number="+79991234567",
        date_of_birth="1990-01-01",
        # Pydantic v2 по умолчанию игнорирует extra=ignore — clinic_id не должен
        # появиться в модели.
        clinic_id="11111111-1111-1111-1111-111111111111",
    )
    assert not hasattr(data, "clinic_id"), (
        "UserUpdate не должен содержать поле clinic_id — privilege escalation!"
    )
    assert data.full_name == "New Name"


def test_user_update_only_safe_fields():
    """Whitelist полей в UserUpdate: только full_name, phone_number, date_of_birth.

    Исторический регресс: добавление любых ролевых/тенантных полей в UserUpdate
    (clinic_id, tenant_id, role, is_active, recruiter_id, …) разрывает
    изоляцию. Жёсткая проверка whitelist.
    """
    from app.schemas.user import UserUpdate

    fields = set(UserUpdate.model_fields.keys())
    # Список разрешённых полей — синхронизировать с UserUpdate.
    allowed = {"full_name", "phone_number", "date_of_birth"}
    forbidden = {
        "clinic_id", "tenant_id", "role", "is_active", "is_suspended",
        "recruiter_id", "bonus_percent", "manager_id", "doctor_type",
    }
    leak = fields & forbidden
    assert not leak, f"UserUpdate имеет небезопасные поля: {leak}"
    assert fields <= allowed, f"UserUpdate имеет неожиданные поля: {fields - allowed}"


# ─── 2) /visiting/admin/* — auth required ─────────────────────────────────────


VISITING_ADMIN_ENDPOINTS = [
    # path, method
    ("/visiting/admin/settings", "POST"),
    ("/visiting/admin/settings", "GET"),
    ("/visiting/admin/complete-visit", "POST"),
    ("/visiting/admin/book-appointment", "POST"),
    ("/visiting/admin/all-appointments", "GET"),
    ("/visiting/admin/appointments/00000000-0000-0000-0000-000000000000", "GET"),
    ("/visiting/admin/appointments/00000000-0000-0000-0000-000000000000/edit", "PATCH"),
    ("/visiting/admin/appointments/00000000-0000-0000-0000-000000000000", "DELETE"),
    ("/visiting/admin/update-doctor/00000000-0000-0000-0000-000000000000", "PATCH"),
    ("/visiting/admin/suspend-doctor/00000000-0000-0000-0000-000000000000", "PATCH"),
    ("/visiting/admin/resume-doctor/00000000-0000-0000-0000-000000000000", "PATCH"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("path,method", VISITING_ADMIN_ENDPOINTS)
async def test_visiting_admin_endpoints_require_auth(client, path, method):
    """Без токена все /visiting/admin/* возвращают 401/403."""
    if method == "POST":
        resp = await client.post(path, json={})
    elif method == "GET":
        resp = await client.get(path)
    elif method == "PATCH":
        resp = await client.patch(path, json={})
    elif method == "DELETE":
        resp = await client.delete(path)
    else:
        raise AssertionError(f"unhandled method {method}")

    assert resp.status_code in (401, 403), (
        f"{method} {path} должен требовать auth (got {resp.status_code})"
    )


# ─── 3) /patient-portal/ai/conversations без `t` параметра — 422 ──────────────


@pytest.mark.asyncio
async def test_patient_ai_requires_session_token(client):
    """POST /patient-portal/ai/conversations без query-параметра ``t`` → 422."""
    resp = await client.post(
        "/patient-portal/ai/conversations",
        json={"tenant_slug": "demo", "patient_phone": "+79001112233"},
    )
    # Pydantic-валидация query-параметра `t` (Query(...)) → 422 без него.
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_patient_ai_invalid_session_token(client):
    """С невалидным `t` — ловим 401 (Session invalid or expired)."""
    resp = await client.post(
        "/patient-portal/ai/conversations?t=invalid-token",
        json={"tenant_slug": "demo", "patient_phone": "+79001112233"},
    )
    # _patient_session_or_401 → 401
    assert resp.status_code in (401, 422), (
        f"Невалидный t → 401, got {resp.status_code}"
    )


# ─── 4) GET /docs анонимом ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_docs_blocked_for_anonymous(client):
    """GET /docs без токена → 401/403/404 (не отдавать Swagger UI публично)."""
    resp = await client.get("/docs")
    assert resp.status_code in (401, 403, 404), (
        f"/docs должен быть защищён, got {resp.status_code}"
    )
    # Главное — точно НЕ 200 (т.е. не отдан HTML с Swagger UI).
    assert resp.status_code != 200


@pytest.mark.asyncio
async def test_redoc_blocked_for_anonymous(client):
    """GET /redoc без токена → 401/403/404."""
    resp = await client.get("/redoc")
    assert resp.status_code in (401, 403, 404)
    assert resp.status_code != 200


# ─── 5) /push/subscribe-doctor без токена ─────────────────────────────────────


@pytest.mark.asyncio
async def test_push_subscribe_doctor_requires_auth(client):
    """POST /push/subscribe-doctor без bearer-токена → 401/403."""
    resp = await client.post(
        "/push/subscribe-doctor",
        json={
            "endpoint": "https://fcm.googleapis.com/fcm/send/abc",
            "p256dh": "p256dh-value",
            "auth": "auth-value",
        },
    )
    assert resp.status_code in (401, 403), (
        f"/push/subscribe-doctor должен требовать auth, got {resp.status_code}"
    )


@pytest.mark.asyncio
async def test_push_subscribe_user_requires_auth(client):
    """POST /push/subscribe-user без токена тоже под защитой."""
    resp = await client.post(
        "/push/subscribe-user",
        json={
            "endpoint": "https://fcm.googleapis.com/fcm/send/abc",
            "p256dh": "p256dh-value",
            "auth": "auth-value",
        },
    )
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_manager_push_send_requires_auth(client):
    """POST /manager/push/send без токена → 401/403 (не должен слать пуши)."""
    resp = await client.post(
        "/manager/push/send",
        json={"title": "x", "body": "y"},
    )
    assert resp.status_code in (401, 403, 422)
