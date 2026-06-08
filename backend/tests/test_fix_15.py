"""Тесты для находки [15] — TOCTOU в наградах лояльности.

Закрываем гонку «check-then-use» в claim-пути программы лояльности:
  • adjust_points(allow_negative=False) не уводит баланс в минус молча, а
    поднимает LoyaltyClaimError ДО клампа max(0, ...);
  • create_claim повторно валидирует can_claim внутри лока и отказывает при
    недостатке баллов / исчерпанном stock (а не списывает «как получится»);
  • lock_account_and_reward перечитывает обе строки с FOR UPDATE — реальная
    сериализация параллельных claim'ов проверяется на PostgreSQL (skip без БД,
    т.к. на SQLite with_for_update не сериализует).

Unit-тесты используют простые in-memory объекты + AsyncMock-сессию: логика
сервиса (валидация/исключения) не зависит от реальной БД.
"""
from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock
from types import SimpleNamespace

import pytest

from app.services import loyalty_ext_service as ls


def _mock_session():
    """AsyncMock-сессия: add() синхронный, flush() — awaitable."""
    s = AsyncMock()
    s.add = MagicMock()
    s.flush = AsyncMock()
    return s


def _account(points: int):
    """Лёгкий стенд аккаунта (поведение полей as-is, без БД)."""
    return SimpleNamespace(
        id=uuid.uuid4(),
        points=points,
        tier="platinum",  # высокий тир, чтобы тир-проверка не мешала
        total_spent=Decimal("0"),
        last_activity_at=None,
    )


def _reward(cost: int, stock=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        name="Free cleaning",
        cost_points=cost,
        is_active=True,
        min_tier="bronze",
        stock=stock,
    )


# ── adjust_points: списание не уходит в молчаливый max(0) ────────────────────
@pytest.mark.asyncio
async def test_adjust_points_redeem_overspend_raises():
    """Списание больше баланса при allow_negative=False → LoyaltyClaimError,
    баланс НЕ обнуляется (раньше max(0,...) тихо съедал перерасход)."""
    acc = _account(points=30)
    db = _mock_session()

    with pytest.raises(ls.LoyaltyClaimError):
        await ls.adjust_points(
            db, acc, -100, "reward_claimed", allow_negative=False,
        )
    # баланс не тронут, событие не записано
    assert acc.points == 30
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_adjust_points_award_positive_ok():
    """Начисление (delta>0) при allow_negative=False по умолчанию не ломается."""
    acc = _account(points=30)
    db = _mock_session()

    ev = await ls.adjust_points(db, acc, 50, "appointment_completed")
    assert acc.points == 80
    assert ev is not None


# ── create_claim: re-validate внутри (предполагаемого) лока ──────────────────
@pytest.mark.asyncio
async def test_create_claim_insufficient_points_raises():
    """create_claim сам перепроверяет can_claim → при нехватке баллов кидает
    LoyaltyClaimError, а не списывает в минус."""
    acc = _account(points=10)
    rw = _reward(cost=500)
    db = _mock_session()

    with pytest.raises(ls.LoyaltyClaimError):
        await ls.create_claim(db, acc, rw)
    assert acc.points == 10  # не списано
    db.add.assert_not_called()  # claim не создан


@pytest.mark.asyncio
async def test_create_claim_depleted_stock_raises():
    """stock<=0 → LoyaltyClaimError (defense-in-depth, не уводит stock в минус)."""
    acc = _account(points=1000)
    rw = _reward(cost=100, stock=0)
    db = _mock_session()

    with pytest.raises(ls.LoyaltyClaimError):
        await ls.create_claim(db, acc, rw)
    assert rw.stock == 0
    assert acc.points == 1000


@pytest.mark.asyncio
async def test_create_claim_happy_path():
    """Одиночный валидный claim: списывает баллы, уменьшает stock, создаёт заявку."""
    acc = _account(points=1000)
    rw = _reward(cost=100, stock=2)
    db = _mock_session()

    claim = await ls.create_claim(db, acc, rw)
    assert claim.points_spent == 100
    assert acc.points == 900
    assert rw.stock == 1


# ── Конкурентность: реальная сериализация только на PostgreSQL ───────────────
@pytest.mark.integration
@pytest.mark.asyncio
async def test_concurrent_claims_serialized(db_session):
    """Два параллельных claim на reward со stock=1 и баллов ровно на ОДИН claim:

    благодаря lock_account_and_reward (FOR UPDATE) проходит ровно один, второй
    получает LoyaltyClaimError; итог — points==0, stock==0 (не -1), один claim.

    Требует реального PostgreSQL (db_session = testcontainers). На SQLite/без
    Docker фикстура db_session скипается, т.к. with_for_update там не сериализует.
    """
    from sqlalchemy import select, func
    from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
    from app.models.loyalty_ext import LoyaltyAccountExt, LoyaltyClaim
    from app.models.loyalty import LoyaltyReward
    from app.models.tenant import Tenant  # noqa: F401 — для FK tenant_id
    from app.models.patient_account import PatientAccount  # noqa: F401

    bind = db_session.bind
    SessionLocal = async_sessionmaker(bind, class_=AsyncSession, expire_on_commit=False)

    tenant_id = uuid.uuid4()
    patient_id = uuid.uuid4()

    # Минимальные родительские записи под FK (tenant, patient_account).
    async with SessionLocal() as setup:
        await setup.execute(
            Tenant.__table__.insert().values(
                id=tenant_id, name="T15", slug=f"t15-{tenant_id.hex[:8]}",
            )
        )
        await setup.execute(
            PatientAccount.__table__.insert().values(
                id=patient_id, phone=f"+7900{tenant_id.hex[:7]}",
            )
        )
        acc = LoyaltyAccountExt(
            id=uuid.uuid4(), tenant_id=tenant_id, patient_id=patient_id,
            patient_phone="+79000000000", points=100, tier="platinum",
            total_spent=Decimal("0"),
        )
        rw = LoyaltyReward(
            id=uuid.uuid4(), tenant_id=tenant_id, name="R", reward_type="gift",
            cost_points=100, is_active=True, min_tier="bronze", stock=1,
        )
        setup.add(acc)
        setup.add(rw)
        await setup.commit()
        account_id, reward_id = acc.id, rw.id

    async def attempt():
        async with SessionLocal() as s:
            try:
                a, r = await ls.lock_account_and_reward(s, account_id, reward_id)
                await ls.create_claim(s, a, r)
                await s.commit()
                return True
            except ls.LoyaltyClaimError:
                await s.rollback()
                return False

    results = await asyncio.gather(attempt(), attempt())

    # Ровно один claim прошёл.
    assert sorted(results) == [False, True], results

    async with SessionLocal() as check:
        claims = (await check.execute(
            select(func.count()).select_from(LoyaltyClaim)
            .where(LoyaltyClaim.account_id == account_id)
        )).scalar_one()
        acc_row = (await check.execute(
            select(LoyaltyAccountExt).where(LoyaltyAccountExt.id == account_id)
        )).scalar_one()
        rw_row = (await check.execute(
            select(LoyaltyReward).where(LoyaltyReward.id == reward_id)
        )).scalar_one()

    assert claims == 1
    assert acc_row.points == 0       # не отрицательный, списан ровно один раз
    assert rw_row.stock == 0         # не -1
