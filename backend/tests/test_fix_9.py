"""Тесты для находки #9 — IDOR в upsert конфига платёжного шлюза.

Корень: `upsert_payment_config` выбирал существующий конфиг по
`clinic_id + gateway` БЕЗ предиката `tenant_id`, а `clinic_id` из path
не проверялся на принадлежность тенанту. Менеджер тенанта A, подставив
`clinic_id` тенанта B, перезаписывал чужой эквайринг.

Фикс: хелпер `_verify_clinic(db, tenant_id, clinic_id)` (404 если клиника
не принадлежит тенанту) + предикат `PaymentGatewayConfig.tenant_id == tenant.id`
в SELECT существующего конфига.

Тесты — unit-уровня (фейковая async-сессия), без Docker/PostgreSQL.
Кросс-тенантный интеграционный сценарий из плана требует реального PG и
запускается отдельно (RLS/реальная БД).
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.models.clinic import Clinic
from app.routers.clinic_payments import (
    PaymentConfigBody,
    _verify_clinic,
    upsert_payment_config,
)


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDB:
    """Минимальная async-сессия: возвращает заранее заданный объект из execute."""

    def __init__(self, returns):
        self._returns = returns
        self.committed = False
        self.added = []

    async def execute(self, *_args, **_kwargs):
        return _FakeResult(self._returns)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.committed = True

    async def refresh(self, _obj):
        pass


class _Tenant:
    def __init__(self, tid):
        self.id = tid


@pytest.mark.asyncio
async def test_verify_clinic_returns_owned_clinic():
    """Клиника тенанта проходит проверку и возвращается."""
    tid = uuid.uuid4()
    cid = uuid.uuid4()
    clinic = Clinic(id=cid, tenant_id=tid, name="My clinic")
    db = _FakeDB(returns=clinic)

    result = await _verify_clinic(db, tid, cid)
    assert result is clinic


@pytest.mark.asyncio
async def test_verify_clinic_foreign_or_missing_raises_404():
    """Чужой/несуществующий clinic_id → SELECT с фильтром tenant_id даёт None → 404.

    Это ключевой IDOR-кейс: клиника другого тенанта не находится по
    предикату `Clinic.tenant_id == tenant_id`, поэтому возвращается 404
    (не 403 — чтобы не подтверждать существование чужого clinic_id).
    """
    db = _FakeDB(returns=None)
    with pytest.raises(HTTPException) as exc:
        await _verify_clinic(db, uuid.uuid4(), uuid.uuid4())
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_upsert_payment_config_foreign_clinic_blocked():
    """PUT конфига с чужим clinic_id → 404 ещё до записи (строка не меняется).

    `_verify_clinic` отрабатывает первым: SELECT клиники с фильтром
    `tenant_id` вернёт None → 404. Конфиг не создаётся и не коммитится.
    """
    tenant = _Tenant(uuid.uuid4())
    foreign_clinic_id = uuid.uuid4()
    db = _FakeDB(returns=None)  # клиника не принадлежит тенанту
    body = PaymentConfigBody(
        gateway="yookassa",
        shop_id="shop-B",
        secret_key="attacker-secret",
        is_active=True,
        is_test_mode=False,
    )

    with pytest.raises(HTTPException) as exc:
        await upsert_payment_config(
            body=body,
            clinic_id=foreign_clinic_id,
            tenant=tenant,
            db=db,
        )

    assert exc.value.status_code == 404
    assert db.committed is False
    assert db.added == []
