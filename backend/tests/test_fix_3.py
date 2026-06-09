"""Fix #3 — вкладка «Атрибуция маркетинга» нерабочая (нет эндпоинтов).

Находка: фронт `AttributionTab.jsx` зовёт
  GET    /marketing/attribution?search=&channel_id=&limit=&offset=
  POST   /marketing/attribution
  PATCH  /marketing/attribution/{id}
  DELETE /marketing/attribution/{id}
но в `marketing_ads.py` были только /channels и /ad-spend → фронт получал 404.

Фикс: CRUD-эндпоинты в `app/routers/marketing_ads.py` поверх готовой модели
`PatientAttribution` (таблица patient_attribution уже создана миграцией
marketingads01 — новая миграция НЕ требуется). Ответ содержит вложенные
patient/channel (как читает фронт: it.patient?.full_name, it.channel?.name/icon).

Тесты двух видов (как в остальной волне):
  1) функциональные на client+mock_db — маршруты ЗАРЕГИСТРИРОВАНЫ (нет 404 на
     сам путь), принимают параметры, валидируют тело;
  2) статические инварианты на исходник — на каждом эндпоинте присутствует
     tenant-фильтр `PatientAttribution.tenant_id == tid` и резолв пациента в
     рамках тенанта (защита ПДн от кросс-тенант join).

Кросс-тенантное поведение по данным (B видит/правит запись A → 403/404) и
полный CRUD на реальной БД проверяются на интеграционном слое (PostgreSQL/SQLite
с реальной сессией); здесь mock_db не исполняет SQL.
"""
from __future__ import annotations

import inspect
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

pytestmark = pytest.mark.asyncio

ATTR_PATH = "/marketing/attribution"


def _empty_db(mock_db):
    """mock_db: любая выборка → пусто, get → None."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    result.all.return_value = []
    result.scalars.return_value.all.return_value = []
    mock_db.execute = AsyncMock(return_value=result)
    mock_db.get = AsyncMock(return_value=None)
    return mock_db


def _override_user(role: str, tenant_id=None):
    from app.models.user import User, UserRole

    u = MagicMock(spec=User)
    u.id = uuid.uuid4()
    u.is_active = True
    u.role = UserRole(role)
    u.tenant_id = tenant_id if tenant_id is not None else uuid.uuid4()
    u.clinic_id = None
    return u


# ── 1. GET зарегистрирован: без записей → пустой список, НЕ 404 ────────────
async def test_attribution_get_route_registered_returns_list(client, mock_db):
    """GET /marketing/attribution → 200 + [] (раньше путь давал 404).

    Ключевой кейс находки: эндпоинт обязан существовать и при пустой БД
    отдавать список, а не 404.
    """
    from app.main import app
    from app.core.deps import get_current_user

    _empty_db(mock_db)
    app.dependency_overrides[get_current_user] = lambda: _override_user("manager")
    try:
        resp = await client.get(ATTR_PATH, params={"limit": 200})
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json(), list)


# ── 2. GET принимает search / channel_id / offset ──────────────────────────
async def test_attribution_get_accepts_filters(client, mock_db):
    """search + channel_id(UUID) + offset → 200 (не 422)."""
    from app.main import app
    from app.core.deps import get_current_user

    _empty_db(mock_db)
    app.dependency_overrides[get_current_user] = lambda: _override_user("manager")
    try:
        resp = await client.get(
            ATTR_PATH,
            params={
                "search": "Иванов",
                "channel_id": str(uuid.uuid4()),
                "limit": 50,
                "offset": 10,
            },
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200, resp.text


# ── 3. GET: невалидный channel_id (не UUID) → 422 (валидация типа) ──────────
async def test_attribution_get_channel_id_must_be_uuid(client, mock_db):
    from app.main import app
    from app.core.deps import get_current_user

    _empty_db(mock_db)
    app.dependency_overrides[get_current_user] = lambda: _override_user("manager")
    try:
        resp = await client.get(ATTR_PATH, params={"channel_id": "not-a-uuid"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 422, resp.text


# ── 4. POST зарегистрирован + валидирует тело (нет ни phone, ни user_id) ───
async def test_attribution_post_requires_phone_or_user(client, mock_db):
    """POST без patient_phone и без patient_user_id → 400 (бизнес-валидация),
    но с валидным channel_id. Маршрут существует (не 404)."""
    from app.main import app
    from app.core.deps import get_current_user

    _empty_db(mock_db)
    app.dependency_overrides[get_current_user] = lambda: _override_user("manager")
    try:
        resp = await client.post(
            ATTR_PATH,
            json={"channel_id": str(uuid.uuid4())},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 400, resp.text


# ── 5. POST: отсутствует обязательный channel_id → 422 ─────────────────────
async def test_attribution_post_channel_id_required(client, mock_db):
    from app.main import app
    from app.core.deps import get_current_user

    _empty_db(mock_db)
    app.dependency_overrides[get_current_user] = lambda: _override_user("manager")
    try:
        resp = await client.post(ATTR_PATH, json={"patient_phone": "+79991234567"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 422, resp.text


# ── 6. PATCH зарегистрирован: несуществующий id → 404 (не 405/route-404) ───
async def test_attribution_patch_route_registered_404_on_missing(client, mock_db):
    """PATCH /marketing/attribution/{uuid} с пустой БД → 404 «не найдена».

    Это доменный 404 (db.get вернул None), а не отсутствие маршрута — значит
    эндпоинт зарегистрирован и принимает PATCH с UUID в пути.
    """
    from app.main import app
    from app.core.deps import get_current_user

    _empty_db(mock_db)
    app.dependency_overrides[get_current_user] = lambda: _override_user("manager")
    try:
        resp = await client.patch(
            f"{ATTR_PATH}/{uuid.uuid4()}",
            json={"utm_source": "google"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 404, resp.text


# ── 7. DELETE зарегистрирован: несуществующий id → 404 ─────────────────────
async def test_attribution_delete_route_registered_404_on_missing(client, mock_db):
    from app.main import app
    from app.core.deps import get_current_user

    _empty_db(mock_db)
    app.dependency_overrides[get_current_user] = lambda: _override_user("manager")
    try:
        resp = await client.delete(f"{ATTR_PATH}/{uuid.uuid4()}")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 404, resp.text


# ── 8. POST требует роль manager: пациент → 403 ────────────────────────────
async def test_attribution_post_forbidden_for_patient(client, mock_db):
    """Пациент не должен создавать атрибуции (require_manager)."""
    from app.main import app
    from app.core.deps import get_current_user

    _empty_db(mock_db)
    app.dependency_overrides[get_current_user] = lambda: _override_user("patient")
    try:
        resp = await client.post(
            ATTR_PATH,
            json={"patient_phone": "+79991234567", "channel_id": str(uuid.uuid4())},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 403, resp.text


# ── 9. Статический инвариант: tenant-фильтр на каждом эндпоинте ────────────
def test_attribution_endpoints_enforce_tenant_filter():
    """Каждый CRUD-эндпоинт атрибуции обязан фильтровать по tenant_id.

    Защита от случайного откладывания/отката (IDOR на ПДн — телефоны/ФИО).
      • list  — WHERE PatientAttribution.tenant_id == tid
      • patch — проверка obj.tenant_id != tid → 403
      • delete— проверка obj.tenant_id != tid → 403
      • post  — tenant_id берётся из пользователя, не из тела
    """
    from app.routers import marketing_ads as m

    list_src = inspect.getsource(m.list_attribution)
    assert "PatientAttribution.tenant_id == tid" in list_src, (
        "list_attribution должен фильтровать по tenant_id"
    )

    patch_src = inspect.getsource(m.update_attribution)
    assert "obj.tenant_id != tid" in patch_src, (
        "update_attribution должен запрещать чужой tenant (403)"
    )

    delete_src = inspect.getsource(m.delete_attribution)
    assert "obj.tenant_id != tid" in delete_src, (
        "delete_attribution должен запрещать чужой tenant (403)"
    )

    create_src = inspect.getsource(m.create_attribution)
    assert "tenant_id=tid" in create_src, (
        "create_attribution должен проставлять tenant_id из пользователя"
    )


# ── 10. Статический инвариант: пациент резолвится строго в рамках тенанта ──
def test_attribution_patient_resolution_scoped_to_tenant():
    """Резолв пациента (User) обязан фильтровать по тенанту — иначе join по
    patient_user_id подтянет чужого пациента (утечка ПДн)."""
    from app.routers import marketing_ads as m

    helper_src = inspect.getsource(m._resolve_patient_for_tenant)
    assert "User.tenant_id == tid" in helper_src, (
        "резолв пациента должен ограничиваться tenant_id"
    )

    list_src = inspect.getsource(m.list_attribution)
    assert "User.tenant_id == tid" in list_src, (
        "батч-резолв пациентов в list должен фильтровать по tenant_id"
    )


# ── 11. Статический инвариант: канал резолвится с проверкой тенанта ────────
def test_attribution_channel_resolution_checks_tenant():
    """Канал должен быть системным (tenant_id IS NULL) либо текущего тенанта,
    иначе POST/PATCH позволят привязать атрибуцию к чужому каналу."""
    from app.routers import marketing_ads as m

    src = inspect.getsource(m._resolve_channel_for_tenant)
    assert "ch.tenant_id is not None and ch.tenant_id != tid" in src, (
        "резолв канала должен отклонять чужой tenant (403)"
    )
