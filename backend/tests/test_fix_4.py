"""Fix #4 — кабинет врача/франчайзи звал несуществующий GET /manager/referrals/.

Находка: фронт (DoctorLayout.jsx, FranchiseOwnerCabinet.jsx) обращался к
`/manager/referrals/`, которого нет — у менеджера есть только
`GET /manager/reports/referrals`, а у врача (admin-токен) — `GET /referrals/`.

Кодовая часть фикса (backend): эндпоинт `GET /manager/reports/referrals`
(`app/routers/manager/reports.py::list_all_referrals`) расширен опциональным
query-параметром `author_id`, который при наличии добавляет фильтр
`Referral.created_by_admin_id == author_id` ПОВЕРХ tenant/clinic-скоупа
(нужен франчайзи, чтобы смотреть направления конкретного врача). Фронтовые
правки путей (DoctorLayout → /referrals/, Franchise → /manager/reports/referrals)
проверяются вручную (jsx).

Все тесты — unit (mock_db), без реального PostgreSQL. Кросс-тенантное поведение
author_id (чужой автор → пустой список) обеспечивается тем, что author_id
накладывается дополнительным фильтром к уже существующим tenant/clinic
предикатам и проверяется на интеграционном слое (PostgreSQL).
"""
from __future__ import annotations

import inspect
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

pytestmark = pytest.mark.asyncio


def _empty_rows_db(mock_db):
    """Настраивает mock_db: count → 0, выборка строк → []."""
    result = MagicMock()
    result.scalar.return_value = 0
    result.scalar_one_or_none.return_value = None
    result.all.return_value = []
    result.scalars.return_value.all.return_value = []
    mock_db.execute = AsyncMock(return_value=result)
    return mock_db


def _override_user(role: str):
    """Фейковый пользователь с указанной ролью (для require_manager)."""
    from app.models.user import User, UserRole

    u = MagicMock(spec=User)
    u.id = uuid.uuid4()
    u.is_active = True
    u.role = UserRole(role)
    u.tenant_id = uuid.uuid4()
    u.clinic_id = None
    return u


# ── 1. Эндпоинт принимает query-параметр author_id (раньше его не было) ────
async def test_manager_reports_referrals_accepts_author_id(client, mock_db):
    """GET /manager/reports/referrals?author_id=... → 200 (не 422).

    Ключевой кейс находки: эндпоинт должен принимать author_id, иначе
    franchise-вызов с этим параметром не отфильтрует по автору. До фикса
    параметр отсутствовал в сигнатуре.
    """
    from app.main import app
    from app.core.deps import get_current_user

    _empty_rows_db(mock_db)
    app.dependency_overrides[get_current_user] = lambda: _override_user("franchise_owner")
    try:
        resp = await client.get(
            "/manager/reports/referrals",
            params={"author_id": str(uuid.uuid4()), "limit": 30},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json(), list)


# ── 2. Регресс: без author_id эндпоинт по-прежнему работает ────────────────
async def test_manager_reports_referrals_without_author_id(client, mock_db):
    """GET /manager/reports/referrals без author_id → 200 (регресс)."""
    from app.main import app
    from app.core.deps import get_current_user

    _empty_rows_db(mock_db)
    app.dependency_overrides[get_current_user] = lambda: _override_user("franchise_owner")
    try:
        resp = await client.get("/manager/reports/referrals")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200, resp.text


# ── 3. Невалидный author_id (не UUID) отклоняется ──────────────────────────
async def test_manager_reports_referrals_author_id_must_be_uuid(client, mock_db):
    """author_id=not-a-uuid → 422 (валидация типа, не утечка строки в SQL)."""
    from app.main import app
    from app.core.deps import get_current_user

    _empty_rows_db(mock_db)
    app.dependency_overrides[get_current_user] = lambda: _override_user("franchise_owner")
    try:
        resp = await client.get(
            "/manager/reports/referrals",
            params={"author_id": "not-a-uuid"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 422, resp.text


# ── 4. Статический инвариант: фильтр по author_id реально накладывается ────
async def test_list_all_referrals_applies_author_filter():
    """Источник list_all_referrals обязан содержать фильтр по author_id.

    Защита от случайного отката: эндпоинт должен фильтровать по
    Referral.created_by_admin_id == author_id (поверх tenant/clinic-скоупа),
    иначе franchise-вкладка покажет направления всех врачей.
    """
    from app.routers.manager.reports import list_all_referrals

    src = inspect.getsource(list_all_referrals)
    assert "author_id" in src, "эндпоинт должен принимать author_id"
    assert "created_by_admin_id == author_id" in src, (
        "author_id обязан фильтровать по Referral.created_by_admin_id"
    )
