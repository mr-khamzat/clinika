"""Тесты для находки #7 — системный bypass tenant-изоляции при NULL tenant_id.

Корень: повсеместная fail-open лесенка
``if user.tenant_id and obj.tenant_id and obj.tenant_id != user.tenant_id: raise``
пропускала проверку, если ЛЮБОЙ операнд был NULL → кросс-тенантный доступ
к чату/медкарте/документам с ``tenant_id=NULL``.

Фикс: единый fail-CLOSED guard ``assert_same_tenant(user, obj, status=404)``
в ``app/core/deps.py``:
  • super_admin (строго ПО РОЛИ) — пропускается;
  • NULL у записи ИЛИ у пользователя (не-super_admin) — запрет;
  • несовпадение tenant_id — запрет.
+ ``assert_can_create_in_tenant`` — запрет рождения записи с tenant_id=NULL.

Тесты — unit-уровня (лёгкие фейковые объекты), без Docker/PostgreSQL.
Кросс-тенантные интеграционные сценарии из плана требуют реального PG и
запускаются отдельно.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.core.deps import (
    assert_same_tenant,
    assert_can_create_in_tenant,
    _is_super_admin,
)
from app.models.user import UserRole


class _FakeUser:
    """Минимальный пользователь: роль + tenant_id (как у ORM User)."""

    def __init__(self, tenant_id, role=UserRole.MANAGER):
        self.tenant_id = tenant_id
        self.role = role


class _FakeObj:
    """Запись с атрибутом tenant_id (чат/диагноз/документ)."""

    def __init__(self, tenant_id):
        self.tenant_id = tenant_id


# ─────────────────────────────────────────────────────────────────────
# assert_same_tenant
# ─────────────────────────────────────────────────────────────────────


def test_same_tenant_ok():
    """(a) Свой тенант — доступ разрешён (исключение НЕ бросается)."""
    tid = uuid.uuid4()
    user = _FakeUser(tenant_id=tid)
    obj = _FakeObj(tenant_id=tid)
    # Не должно бросить — функция возвращает None.
    assert assert_same_tenant(user, obj) is None


def test_foreign_tenant_404():
    """(b) Чужой тенант — запрет 404 по умолчанию."""
    user = _FakeUser(tenant_id=uuid.uuid4())
    obj = _FakeObj(tenant_id=uuid.uuid4())
    with pytest.raises(HTTPException) as exc:
        assert_same_tenant(user, obj)
    assert exc.value.status_code == 404


def test_obj_tenant_none_404():
    """(c) КЛЮЧЕВОЙ кейс: obj.tenant_id=None → запрет (раньше давал доступ).

    Именно здесь fail-open лесенка пропускала проверку и открывала
    кросс-тенантный доступ к записям с tenant_id=NULL.
    """
    user = _FakeUser(tenant_id=uuid.uuid4())
    obj = _FakeObj(tenant_id=None)
    with pytest.raises(HTTPException) as exc:
        assert_same_tenant(user, obj)
    assert exc.value.status_code == 404


def test_user_tenant_none_not_super_admin_404():
    """(d) user.tenant_id=None и НЕ super_admin → запрет."""
    user = _FakeUser(tenant_id=None, role=UserRole.MANAGER)
    obj = _FakeObj(tenant_id=uuid.uuid4())
    with pytest.raises(HTTPException) as exc:
        assert_same_tenant(user, obj)
    assert exc.value.status_code == 404


def test_both_tenant_none_not_super_admin_404():
    """user.tenant_id=None И obj.tenant_id=None, не super_admin → запрет.

    Совпадение двух NULL НЕ должно трактоваться как «свой тенант».
    """
    user = _FakeUser(tenant_id=None, role=UserRole.DOCTOR)
    obj = _FakeObj(tenant_id=None)
    with pytest.raises(HTTPException) as exc:
        assert_same_tenant(user, obj)
    assert exc.value.status_code == 404


def test_super_admin_ok_any_tenant():
    """(e) super_admin (строго по роли) — доступ всегда, даже к чужому/NULL."""
    sa = _FakeUser(tenant_id=None, role=UserRole.SUPER_ADMIN)
    # чужой тенант
    assert assert_same_tenant(sa, _FakeObj(tenant_id=uuid.uuid4())) is None
    # NULL у записи
    assert assert_same_tenant(sa, _FakeObj(tenant_id=None)) is None


def test_super_admin_strictly_by_role_not_null_tenant():
    """super_admin определяется ПО РОЛИ, а не по NULL tenant_id.

    Пользователь с NULL tenant_id, но обычной ролью — НЕ super_admin
    (иначе любой осиротевший юзер получил бы доступ ко всему).
    """
    user = _FakeUser(tenant_id=None, role=UserRole.MANAGER)
    assert _is_super_admin(user) is False
    sa = _FakeUser(tenant_id=None, role=UserRole.SUPER_ADMIN)
    assert _is_super_admin(sa) is True


def test_custom_status_403():
    """Вызывающий может запросить 403 вместо дефолтного 404."""
    user = _FakeUser(tenant_id=uuid.uuid4())
    obj = _FakeObj(tenant_id=uuid.uuid4())
    with pytest.raises(HTTPException) as exc:
        assert_same_tenant(user, obj, status=403)
    assert exc.value.status_code == 403


def test_obj_as_raw_tenant_value():
    """obj может быть сырым значением tenant_id (UUID/None), не только моделью."""
    tid = uuid.uuid4()
    user = _FakeUser(tenant_id=tid)
    # сырой UUID — свой
    assert assert_same_tenant(user, tid) is None
    # сырой UUID — чужой
    with pytest.raises(HTTPException):
        assert_same_tenant(user, uuid.uuid4())
    # сырой None — запрет
    with pytest.raises(HTTPException):
        assert_same_tenant(user, None)


def test_role_as_plain_string():
    """Роль может быть строкой (а не Enum) — _is_super_admin это учитывает."""
    sa = _FakeUser(tenant_id=None, role="super_admin")
    assert assert_same_tenant(sa, _FakeObj(tenant_id=None)) is None
    mgr = _FakeUser(tenant_id=None, role="manager")
    with pytest.raises(HTTPException):
        assert_same_tenant(mgr, _FakeObj(tenant_id=uuid.uuid4()))


# ─────────────────────────────────────────────────────────────────────
# assert_can_create_in_tenant
# ─────────────────────────────────────────────────────────────────────


def test_create_ok_with_tenant():
    """Пользователь с tenant_id может создавать записи."""
    user = _FakeUser(tenant_id=uuid.uuid4())
    assert assert_can_create_in_tenant(user) is None


def test_create_blocked_null_tenant_409():
    """Не-super_admin без tenant_id → 409 (запрет рождения NULL-тенанта)."""
    user = _FakeUser(tenant_id=None, role=UserRole.MANAGER)
    with pytest.raises(HTTPException) as exc:
        assert_can_create_in_tenant(user)
    assert exc.value.status_code == 409


def test_create_super_admin_null_tenant_ok():
    """super_admin может создавать в системном контексте даже с NULL tenant_id."""
    sa = _FakeUser(tenant_id=None, role=UserRole.SUPER_ADMIN)
    assert assert_can_create_in_tenant(sa) is None
