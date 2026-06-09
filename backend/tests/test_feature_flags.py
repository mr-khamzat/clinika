"""Тесты Feature Flags (router + service).

Используем mock-based `client` (без реальной БД) + dependency overrides для
аутентификации и подмены AsyncSession. Сервис тестируем напрямую с
mock_db, имитируя ответы execute().
"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

pytestmark = pytest.mark.asyncio


# ─── helpers ────────────────────────────────────────────────────────────────


def _make_user(role):
    """Минимальный фейк User для get_current_user override."""
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


def _make_flag(
    *,
    key: str = "new_dashboard",
    name: str = "Новый дашборд",
    default_enabled: bool = False,
    strategy: str = "all",
    rollout_value: dict | None = None,
    flag_id: uuid.UUID | None = None,
):
    from app.models.feature_flag import FeatureFlag, RolloutStrategy

    f = MagicMock(spec=FeatureFlag)
    f.id = flag_id or uuid.uuid4()
    f.key = key
    f.name = name
    f.description = None
    f.default_enabled = default_enabled
    f.rollout_strategy = RolloutStrategy(strategy)
    f.rollout_value = rollout_value
    from datetime import datetime as _dt

    f.created_at = _dt.utcnow()
    f.updated_at = _dt.utcnow()
    return f


def _exec_result(scalar_value=None, all_value=None):
    """Возвращает мок-результат execute() с настраиваемыми scalar/all."""
    res = MagicMock()
    res.scalar_one_or_none = MagicMock(return_value=scalar_value)
    res.scalar = MagicMock(return_value=0)
    scalars = MagicMock()
    scalars.all = MagicMock(return_value=all_value or [])
    res.scalars = MagicMock(return_value=scalars)
    res.all = MagicMock(return_value=all_value or [])
    return res


# ─── ROUTER: create flag ────────────────────────────────────────────────────


async def test_create_flag_super_admin(client, mock_db):
    """POST /admin/feature-flags под super_admin → 201."""
    from app.main import app
    from app.core.deps import require_super_admin, get_current_user
    from app.models.user import UserRole

    sa = _make_user(UserRole.SUPER_ADMIN)

    # Сначала execute → existing проверка (None), потом refresh ничего не делает.
    mock_db.execute = AsyncMock(return_value=_exec_result(scalar_value=None))

    app.dependency_overrides[require_super_admin] = lambda: sa
    app.dependency_overrides[get_current_user] = lambda: sa
    try:
        r = await client.post(
            "/admin/feature-flags/",
            json={
                "key": "new_dashboard",
                "name": "Новый дашборд",
                "default_enabled": True,
                "rollout_strategy": "all",
            },
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["key"] == "new_dashboard"
        assert body["default_enabled"] is True
        assert body["rollout_strategy"] == "all"
    finally:
        app.dependency_overrides.pop(require_super_admin, None)
        app.dependency_overrides.pop(get_current_user, None)


async def test_non_admin_cannot_create(client, mock_db):
    """POST /admin/feature-flags под обычным MANAGER → 403."""
    from app.main import app
    from app.core.deps import get_current_user
    from app.models.user import UserRole

    manager = _make_user(UserRole.MANAGER)
    app.dependency_overrides[get_current_user] = lambda: manager
    try:
        r = await client.post(
            "/admin/feature-flags/",
            json={"key": "x", "name": "x", "rollout_strategy": "all"},
        )
        assert r.status_code == 403, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ─── ROUTER: tenant override ────────────────────────────────────────────────


async def test_set_tenant_override(client, mock_db):
    """PUT /admin/feature-flags/{key}/tenants/{tenant_id} создаёт override."""
    from app.main import app
    from app.core.deps import require_super_admin, get_current_user
    from app.models.user import UserRole
    from app.models.tenant import Tenant

    sa = _make_user(UserRole.SUPER_ADMIN)
    flag = _make_flag(key="show_kpi")
    tenant = MagicMock(spec=Tenant)
    tenant.id = uuid.uuid4()
    tenant.name = "Test Tenant"
    tenant.slug = "test-tenant"

    # Последовательность execute:
    #   1) _get_flag_by_key → flag
    #   2) select Tenant      → tenant
    #   3) select existing TFF → None (override отсутствует → создадим новый)
    mock_db.execute = AsyncMock(
        side_effect=[
            _exec_result(scalar_value=flag),
            _exec_result(scalar_value=tenant),
            _exec_result(scalar_value=None),
        ]
    )

    # db.refresh должен «нанести» id/timestamps на добавляемый объект.
    from datetime import datetime as _dt

    async def _fake_refresh(obj):
        if not getattr(obj, "id", None):
            obj.id = uuid.uuid4()
        if not getattr(obj, "created_at", None):
            obj.created_at = _dt.utcnow()
        if not getattr(obj, "updated_at", None):
            obj.updated_at = _dt.utcnow()

    mock_db.refresh = AsyncMock(side_effect=_fake_refresh)

    app.dependency_overrides[require_super_admin] = lambda: sa
    app.dependency_overrides[get_current_user] = lambda: sa
    try:
        r = await client.put(
            f"/admin/feature-flags/show_kpi/tenants/{tenant.id}",
            json={"enabled": True, "variant": None},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["enabled"] is True
        assert body["tenant_id"] == str(tenant.id)
        assert body["tenant_name"] == "Test Tenant"
    finally:
        app.dependency_overrides.pop(require_super_admin, None)
        app.dependency_overrides.pop(get_current_user, None)


# ─── SERVICE: is_enabled ────────────────────────────────────────────────────


async def test_is_enabled_default(monkeypatch):
    """Стратегия all + default_enabled=True → (True, None)."""
    from app.services import feature_flag_service as ffs

    # Делаем кеш «всегда промах».
    monkeypatch.setattr(ffs, "_cache_get", AsyncMock(return_value=None))
    monkeypatch.setattr(ffs, "_cache_set", AsyncMock(return_value=None))

    flag = _make_flag(default_enabled=True, strategy="all")
    db = MagicMock()
    # Один execute — для load_flag (override не запрашивается? запрашивается).
    db.execute = AsyncMock(
        side_effect=[
            _exec_result(scalar_value=flag),  # load_flag
            _exec_result(scalar_value=None),  # load_override
        ]
    )

    enabled, variant = await ffs.is_enabled(db, "new_dashboard", uuid.uuid4())
    assert enabled is True
    assert variant is None


async def test_is_enabled_with_override(monkeypatch):
    """Override на тенанте перебивает стратегию: enabled=False + variant='B'."""
    from app.services import feature_flag_service as ffs
    from app.models.feature_flag import TenantFeatureFlag

    monkeypatch.setattr(ffs, "_cache_get", AsyncMock(return_value=None))
    monkeypatch.setattr(ffs, "_cache_set", AsyncMock(return_value=None))

    flag = _make_flag(default_enabled=True, strategy="all")
    override = MagicMock(spec=TenantFeatureFlag)
    override.enabled = False
    override.variant = "B"

    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[
            _exec_result(scalar_value=flag),
            _exec_result(scalar_value=override),
        ]
    )

    enabled, variant = await ffs.is_enabled(db, "x", uuid.uuid4())
    assert enabled is False
    assert variant == "B"


async def test_percentage_rollout_deterministic(monkeypatch):
    """Один tenant_id всегда даёт один и тот же результат для percentage-стратегии."""
    from app.services import feature_flag_service as ffs

    monkeypatch.setattr(ffs, "_cache_get", AsyncMock(return_value=None))
    monkeypatch.setattr(ffs, "_cache_set", AsyncMock(return_value=None))

    flag = _make_flag(
        key="exp1", strategy="percentage", rollout_value={"percentage": 50}
    )
    tenant_id = uuid.uuid4()

    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[
            _exec_result(scalar_value=flag),
            _exec_result(scalar_value=None),
            _exec_result(scalar_value=flag),
            _exec_result(scalar_value=None),
        ]
    )

    r1 = await ffs.is_enabled(db, "exp1", tenant_id)
    r2 = await ffs.is_enabled(db, "exp1", tenant_id)
    assert r1 == r2  # детерминированность

    # Проверим что результат соответствует ручному вычислению bucket-а.
    expected_enabled = ffs._bucket("exp1", tenant_id) < 50 * 100
    assert r1[0] is expected_enabled
    assert r1[1] is None


async def test_percentage_rollout_split(monkeypatch):
    """При percentage=100 — все включены; при percentage=0 — все выключены."""
    from app.services import feature_flag_service as ffs

    monkeypatch.setattr(ffs, "_cache_get", AsyncMock(return_value=None))
    monkeypatch.setattr(ffs, "_cache_set", AsyncMock(return_value=None))

    flag_all = _make_flag(
        key="p100", strategy="percentage", rollout_value={"percentage": 100}
    )
    flag_none = _make_flag(
        key="p0", strategy="percentage", rollout_value={"percentage": 0}
    )

    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[
            _exec_result(scalar_value=flag_all),
            _exec_result(scalar_value=None),
            _exec_result(scalar_value=flag_none),
            _exec_result(scalar_value=None),
        ]
    )

    enabled_all, _ = await ffs.is_enabled(db, "p100", uuid.uuid4())
    enabled_none, _ = await ffs.is_enabled(db, "p0", uuid.uuid4())
    assert enabled_all is True
    assert enabled_none is False


async def test_ab_test_returns_variant(monkeypatch):
    """ab_test → enabled=True + один из вариантов; распределение детерминированное."""
    from app.services import feature_flag_service as ffs

    monkeypatch.setattr(ffs, "_cache_get", AsyncMock(return_value=None))
    monkeypatch.setattr(ffs, "_cache_set", AsyncMock(return_value=None))

    flag = _make_flag(
        key="checkout_redesign",
        strategy="ab_test",
        rollout_value={"variants": {"A": 50, "B": 50}},
    )
    tenant_id = uuid.uuid4()

    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[
            _exec_result(scalar_value=flag),
            _exec_result(scalar_value=None),
            _exec_result(scalar_value=flag),
            _exec_result(scalar_value=None),
        ]
    )

    enabled1, variant1 = await ffs.is_enabled(db, "checkout_redesign", tenant_id)
    enabled2, variant2 = await ffs.is_enabled(db, "checkout_redesign", tenant_id)

    assert enabled1 is True
    assert variant1 in ("A", "B")
    # Детерминированность распределения вариантов.
    assert variant1 == variant2
