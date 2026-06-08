"""R1 — недостающие backend-эндпоинты, которые звал фронт (находки #21, #22).

Контекст:
  • #21 — RegulationBuilderSection.jsx звал
        GET  /admin/regulations/{id}/versions/{vid}
        POST /admin/regulations/{id}/versions/{vid}/rollback
    Обоих не было → фронт деградировал через .catch(). Реализованы в
    app/routers/admin_regulations.py (GET одной версии + rollback = новая
    draft-копия указанной версии; версионность append-only).
  • #22 — FranchiseOwnerCabinet.jsx звал PATCH /integrations/mis/settings,
    эндпоинт не был подключён. Реализован в app/routers/integrations.py
    (tenant-скоуп, секрет api_key шифруется encryption_service.encrypt).

Все тесты — unit (mock_db, без реального PostgreSQL):
  • маршруты зарегистрированы (нет route-404 / 405);
  • валидация тела/типов;
  • tenant-инвариант — статически через inspect.getsource (кросс-тенантное
    поведение обеспечивается _get_reg_for_manage / tenant_id-скоупом и
    проверяется на интеграционном слое PostgreSQL).
"""
from __future__ import annotations

import inspect
import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

pytestmark = pytest.mark.asyncio


# ─────────────────────────────────────────────────────────────────────
# Хелперы
# ─────────────────────────────────────────────────────────────────────
def _override_user(role: str, tenant_id=None):
    """Фейковый пользователь с указанной ролью."""
    from app.models.user import User, UserRole

    u = MagicMock(spec=User)
    u.id = uuid.uuid4()
    u.username = "tester"
    u.is_active = True
    u.role = UserRole(role)
    u.tenant_id = tenant_id if tenant_id is not None else uuid.uuid4()
    u.clinic_id = None
    u.full_name = "Tester"
    return u


def _fake_regulation(tenant_id, reg_id=None):
    from app.models.regulation import Regulation, RegulationStatus

    r = MagicMock(spec=Regulation)
    r.id = reg_id or uuid.uuid4()
    r.tenant_id = tenant_id
    r.title = "SOP"
    r.description = None
    r.category = None
    r.status = RegulationStatus.PUBLISHED
    r.assigned_roles = []
    r.current_version_id = None
    r.created_by_user_id = None
    r.created_at = datetime.utcnow()
    r.updated_at = datetime.utcnow()
    return r


def _fake_version(reg_id, version_id=None, number=1):
    from app.models.regulation import RegulationVersion

    v = MagicMock(spec=RegulationVersion)
    v.id = version_id or uuid.uuid4()
    v.regulation_id = reg_id
    v.version_number = number
    v.content = [{"order": 1, "type": "text", "content": "шаг", "required": False}]
    v.changelog = "v1"
    v.published_at = datetime.utcnow()
    v.published_by_user_id = None
    v.created_at = datetime.utcnow()
    return v


# ═════════════════════════════════════════════════════════════════════
# #21 — GET одной версии регламента
# ═════════════════════════════════════════════════════════════════════
async def test_get_version_route_registered_not_404(client, mock_db):
    """GET /admin/regulations/{id}/versions/{vid} — маршрут зарегистрирован.

    До фикса этого маршрута не было → FastAPI отдавал route-404
    {"detail":"Not Found"}. Сейчас регламент-lookup отдаёт None (mock_db) →
    handler-404 «Регламент не найден». Главное — это НЕ route-404.
    """
    from app.main import app
    from app.core.deps import get_current_user

    app.dependency_overrides[get_current_user] = lambda: _override_user("franchise_owner")
    try:
        resp = await client.get(
            f"/admin/regulations/{uuid.uuid4()}/versions/{uuid.uuid4()}"
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code != 405, "метод GET не должен быть запрещён"
    # маршрут есть: дошли до хендлера → доменный 404, а не дефолтный route-404
    assert resp.json().get("detail") != "Not Found", resp.text
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Регламент не найден"


async def test_get_version_returns_content(client, mock_db):
    """GET версии возвращает content (фронт читает rv.data.content)."""
    from app.main import app
    from app.core.deps import get_current_user

    tid = uuid.uuid4()
    reg = _fake_regulation(tid)
    ver = _fake_version(reg.id)

    # 1-й execute → регламент; 2-й execute → версия
    res_reg = MagicMock(); res_reg.scalar_one_or_none.return_value = reg
    res_ver = MagicMock(); res_ver.scalar_one_or_none.return_value = ver
    mock_db.execute = AsyncMock(side_effect=[res_reg, res_ver])

    app.dependency_overrides[get_current_user] = lambda: _override_user("franchise_owner", tid)
    try:
        resp = await client.get(
            f"/admin/regulations/{reg.id}/versions/{ver.id}"
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == str(ver.id)
    assert isinstance(body["content"], list) and body["content"]


async def test_get_version_invalid_uuid_422(client, mock_db):
    """version_id не-UUID → 422 (валидация типа path-параметра)."""
    from app.main import app
    from app.core.deps import get_current_user

    app.dependency_overrides[get_current_user] = lambda: _override_user("franchise_owner")
    try:
        resp = await client.get(
            f"/admin/regulations/{uuid.uuid4()}/versions/not-a-uuid"
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 422, resp.text


# ═════════════════════════════════════════════════════════════════════
# #21 — POST rollback (новая draft-версия = копия указанной)
# ═════════════════════════════════════════════════════════════════════
async def test_rollback_route_registered_not_404(client, mock_db):
    """POST /admin/regulations/{id}/versions/{vid}/rollback зарегистрирован."""
    from app.main import app
    from app.core.deps import get_current_user

    app.dependency_overrides[get_current_user] = lambda: _override_user("franchise_owner")
    try:
        resp = await client.post(
            f"/admin/regulations/{uuid.uuid4()}/versions/{uuid.uuid4()}/rollback"
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code != 405
    assert resp.json().get("detail") != "Not Found", resp.text
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Регламент не найден"


async def test_rollback_creates_new_version_from_source(client, mock_db):
    """rollback создаёт НОВУЮ draft-версию (append-only), отдаёт её dict (201)."""
    from app.main import app
    from app.core.deps import get_current_user

    tid = uuid.uuid4()
    reg = _fake_regulation(tid)
    src = _fake_version(reg.id, number=2)

    res_reg = MagicMock(); res_reg.scalar_one_or_none.return_value = reg
    res_src = MagicMock(); res_src.scalar_one_or_none.return_value = src
    # 3-й execute — select(max(version_number)) внутри create_new_version
    res_max = MagicMock(); res_max.scalar.return_value = 2
    mock_db.execute = AsyncMock(side_effect=[res_reg, res_src, res_max])

    app.dependency_overrides[get_current_user] = lambda: _override_user("franchise_owner", tid)
    try:
        resp = await client.post(
            f"/admin/regulations/{reg.id}/versions/{src.id}/rollback"
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 201, resp.text
    # новая версия добавлена в сессию и закоммичена (append-only, источник не тронут)
    assert mock_db.add.called
    assert mock_db.commit.called
    body = resp.json()
    # content скопирован из источника
    assert body["content"] == src.content
    assert "Откат к версии #2" in (body["changelog"] or "")


async def test_rollback_version_not_found_when_foreign(client, mock_db):
    """version из другого регламента → 404 «Версия не найдена» (tenant/целостность)."""
    from app.main import app
    from app.core.deps import get_current_user

    tid = uuid.uuid4()
    reg = _fake_regulation(tid)
    foreign = _fake_version(uuid.uuid4())  # regulation_id != reg.id

    res_reg = MagicMock(); res_reg.scalar_one_or_none.return_value = reg
    res_ver = MagicMock(); res_ver.scalar_one_or_none.return_value = foreign
    mock_db.execute = AsyncMock(side_effect=[res_reg, res_ver])

    app.dependency_overrides[get_current_user] = lambda: _override_user("franchise_owner", tid)
    try:
        resp = await client.post(
            f"/admin/regulations/{reg.id}/versions/{foreign.id}/rollback"
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 404, resp.text
    assert resp.json()["detail"] == "Версия не найдена"


# ═════════════════════════════════════════════════════════════════════
# #21 — статические инварианты (защита от отката)
# ═════════════════════════════════════════════════════════════════════
def test_regulation_endpoints_use_tenant_guard():
    """GET-версии и rollback обязаны проходить через _get_reg_for_manage
    (tenant-скоуп + 403 на чужой тенант) и require-роль _require_manage."""
    from app.routers import admin_regulations as ar

    for fn in (ar.get_version, ar.rollback_version):
        src = inspect.getsource(fn)
        assert "_get_reg_for_manage" in src, (
            f"{fn.__name__} должен скоупить регламент по тенанту"
        )
        assert "_require_manage" in src, (
            f"{fn.__name__} должен требовать manage-роль"
        )

    # rollback не должен мутировать/удалять источник — только создавать новую версию
    roll_src = inspect.getsource(ar.rollback_version)
    assert "create_new_version" in roll_src, (
        "rollback обязан создавать НОВУЮ версию (append-only), а не править старую"
    )


# ═════════════════════════════════════════════════════════════════════
# #22 — PATCH /integrations/mis/settings
# ═════════════════════════════════════════════════════════════════════
async def test_mis_settings_route_registered(client, mock_db, monkeypatch):
    """PATCH /integrations/mis/settings зарегистрирован (не route-404/405)."""
    from app.main import app
    from app.core.deps import require_manager
    import app.routers.integrations as integ

    # set_setting/get_setting не должны лезть в реальную БД
    monkeypatch.setattr(integ, "set_setting", AsyncMock())
    monkeypatch.setattr(integ, "get_setting", AsyncMock(return_value="https://mis"))

    tid = uuid.uuid4()
    app.dependency_overrides[require_manager] = lambda: _override_user("franchise_owner", tid)
    try:
        resp = await client.patch(
            "/integrations/mis/settings",
            json={"mis_api_url": "https://mis.example.ru/api"},
        )
    finally:
        app.dependency_overrides.pop(require_manager, None)

    assert resp.status_code != 405
    assert resp.json().get("detail") != "Not Found", resp.text
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "ok"


async def test_mis_settings_encrypts_api_key(client, mock_db, monkeypatch):
    """api_key пишется через encryption_service.encrypt (под ключ mis_api_key_enc),
    plaintext-копия — под легаси-ключ mis_api_key. Секрет не возвращается в ответе."""
    from app.main import app
    from app.core.deps import require_manager
    import app.routers.integrations as integ

    set_calls = []

    async def _fake_set(db, key, value, tenant_id=None):
        set_calls.append((key, value))

    monkeypatch.setattr(integ, "set_setting", _fake_set)
    monkeypatch.setattr(integ, "get_setting", AsyncMock(return_value="secret-was-set"))
    monkeypatch.setattr(
        integ.encryption_service, "encrypt", lambda p: f"enc:{p}"
    )

    tid = uuid.uuid4()
    app.dependency_overrides[require_manager] = lambda: _override_user("manager", tid)
    try:
        resp = await client.patch(
            "/integrations/mis/settings",
            json={"mis_api_key": "TOP-SECRET-KEY"},
        )
    finally:
        app.dependency_overrides.pop(require_manager, None)

    assert resp.status_code == 200, resp.text
    keys_written = dict(set_calls)
    # зашифрованная копия секрета
    assert keys_written.get("mis_api_key_enc") == "enc:TOP-SECRET-KEY"
    # легаси plaintext-ключ (для существующих читателей)
    assert keys_written.get("mis_api_key") == "TOP-SECRET-KEY"
    # секрет НЕ утёк в ответ
    assert "TOP-SECRET-KEY" not in resp.text
    assert resp.json().get("mis_api_key_set") is True


async def test_mis_settings_clinic_ids_validation(client, mock_db, monkeypatch):
    """mis_clinic_ids должен быть списком; строка → 422 (валидация тела)."""
    from app.main import app
    from app.core.deps import require_manager
    import app.routers.integrations as integ

    monkeypatch.setattr(integ, "set_setting", AsyncMock())
    monkeypatch.setattr(integ, "get_setting", AsyncMock(return_value=""))

    tid = uuid.uuid4()
    app.dependency_overrides[require_manager] = lambda: _override_user("franchise_owner", tid)
    try:
        resp = await client.patch(
            "/integrations/mis/settings",
            json={"mis_clinic_ids": "1,2,3"},  # строка вместо списка
        )
    finally:
        app.dependency_overrides.pop(require_manager, None)

    assert resp.status_code == 422, resp.text


async def test_mis_settings_requires_tenant(client, mock_db, monkeypatch):
    """Пользователь без tenant_id (super_admin вне тенанта) → 400, ничего не пишем."""
    from app.main import app
    from app.core.deps import require_manager
    import app.routers.integrations as integ

    set_mock = AsyncMock()
    monkeypatch.setattr(integ, "set_setting", set_mock)
    monkeypatch.setattr(integ, "get_setting", AsyncMock(return_value=""))

    user = _override_user("super_admin")
    user.tenant_id = None
    app.dependency_overrides[require_manager] = lambda: user
    try:
        resp = await client.patch(
            "/integrations/mis/settings",
            json={"mis_api_url": "https://x"},
        )
    finally:
        app.dependency_overrides.pop(require_manager, None)

    assert resp.status_code == 400, resp.text
    assert not set_mock.called, "без tenant_id ничего не должно записываться"


def test_mis_settings_handler_is_tenant_scoped():
    """Статический инвариант: хендлер скоупит запись по tenant_id текущего юзера
    и шифрует секрет (защита от отката tenant-скоупа/шифрования)."""
    from app.routers.integrations import update_mis_settings

    src = inspect.getsource(update_mis_settings)
    assert "current_user.tenant_id" in src, "запись обязана быть tenant-скоупнутой"
    assert "tenant_id=tid" in src, "set_setting должен писать под tenant_id"
    assert "encryption_service.encrypt" in src, "секрет api_key обязан шифроваться"
