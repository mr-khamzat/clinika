"""Тесты охраны бонусов (outbound-only) и snapshot-приоритета в referral_service.

Покрывают:
- _finalize_bonus_and_ledger: guard'ит внутренние/нулевые from_clinic_id направления
  и не создаёт Bonus / ICI / RecruiterBonus / BillingLedger.
- Snapshot priority: bonus_snapshot_amount > service.referral_payout > service.bonus_amount.

Чистые unit-тесты (без PostgreSQL), используют AsyncMock.
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest  # noqa: F401  (используется pytest_asyncio для async-тестов)


# ── Хелпер: in-memory Referral (без вызова __init__ — иначе SA ругается) ────


def _make_referral(
    *,
    from_clinic_id,
    to_clinic_id,
    service_id=None,
    bonus_snapshot=None,
):
    """Минимальный Referral для тестов охраны/snapshot.

    Используем MagicMock(spec=Referral) — SA-instrumented атрибуты модели
    не позволяют присваивать поля на «голом» объекте через __new__.
    """
    from app.models.referral import Referral, ReferralStatus

    r = MagicMock(spec=Referral)
    r.id = uuid.uuid4()
    r.tenant_id = uuid.uuid4()
    r.from_clinic_id = from_clinic_id
    r.to_clinic_id = to_clinic_id
    r.service_id = service_id
    r.referral_type = "service"
    r.target_doctor_id = None
    r.created_by_admin_id = uuid.uuid4()
    r.status = ReferralStatus.CONFIRMED
    r.partner_offer_id = None
    r.bonus_snapshot_amount = bonus_snapshot
    return r


def _make_service(*, referral_payout=None, bonus_amount=None):
    """Минимальный Service для теста snapshot-приоритета."""
    from app.models.service import Service

    s = MagicMock(spec=Service)
    s.id = uuid.uuid4()
    s.referral_payout = referral_payout
    s.bonus_amount = bonus_amount
    return s


# ── 1. Guard: внутренние направления не создают финансовых записей ────────


async def test_finalize_returns_early_for_internal_referral():
    """from_clinic_id == to_clinic_id → return до записи Bonus/ICI/Ledger."""
    from app.services.referral_service import _finalize_bonus_and_ledger

    same_clinic = uuid.uuid4()
    referral = _make_referral(
        from_clinic_id=same_clinic,
        to_clinic_id=same_clinic,
        service_id=uuid.uuid4(),
    )
    db = AsyncMock()
    db.add = MagicMock()
    db.execute = AsyncMock()
    db.flush = AsyncMock()

    await _finalize_bonus_and_ledger(db, referral, confirmed_by_admin_id=None)

    # add никогда не вызывался — нет Bonus / ICI / RecruiterBonus / BillingLedger.
    db.add.assert_not_called()
    # execute тоже не вызывался — функция выходит сразу после guard.
    db.execute.assert_not_called()


async def test_finalize_returns_early_when_from_clinic_id_none():
    """from_clinic_id == NULL → не внешнее → return."""
    from app.services.referral_service import _finalize_bonus_and_ledger

    referral = _make_referral(
        from_clinic_id=None,
        to_clinic_id=uuid.uuid4(),
        service_id=uuid.uuid4(),
    )
    db = AsyncMock()
    db.add = MagicMock()
    db.execute = AsyncMock()
    db.flush = AsyncMock()

    await _finalize_bonus_and_ledger(db, referral, confirmed_by_admin_id=None)

    db.add.assert_not_called()
    db.execute.assert_not_called()


async def test_finalize_returns_early_when_to_clinic_id_none():
    """to_clinic_id == NULL → не внешнее → return."""
    from app.services.referral_service import _finalize_bonus_and_ledger

    referral = _make_referral(
        from_clinic_id=uuid.uuid4(),
        to_clinic_id=None,
        service_id=uuid.uuid4(),
    )
    db = AsyncMock()
    db.add = MagicMock()
    db.execute = AsyncMock()

    await _finalize_bonus_and_ledger(db, referral, confirmed_by_admin_id=None)

    db.add.assert_not_called()
    db.execute.assert_not_called()


# ── 2. Snapshot priority: bonus_snapshot > service.referral_payout > bonus_amount


async def test_finalize_uses_bonus_snapshot_when_present(monkeypatch):
    """Если bonus_snapshot_amount задан — берём именно его, игнорируем service.* поля."""
    from app.services import referral_service as rsvc

    from_c, to_c = uuid.uuid4(), uuid.uuid4()
    referral = _make_referral(
        from_clinic_id=from_c,
        to_clinic_id=to_c,
        service_id=uuid.uuid4(),
        bonus_snapshot=Decimal("777.00"),
    )
    # Сервис с _другим_ payout — не должен использоваться.
    service = _make_service(referral_payout=Decimal("100.00"), bonus_amount=Decimal("50.00"))

    # db.execute последовательно вызывают: select(Service), select(setting commission_enabled),
    # затем (если commission off) — никаких ICI / fee запросов до billing-блока.
    # Чтобы не вязнуть в финальном add(Bonus) — проверяем именно факт add(Bonus) с suммой 777.
    db = AsyncMock()
    added_objs = []
    db.add = MagicMock(side_effect=lambda o: added_objs.append(o))
    db.flush = AsyncMock()

    # Service lookup → возвращаем наш fake service.
    svc_result = MagicMock()
    svc_result.scalar_one_or_none = MagicMock(return_value=service)
    # _get_setting / прочие селекты → возвращаем empty/falsy.
    empty_result = MagicMock()
    empty_result.scalar_one_or_none = MagicMock(return_value=None)
    empty_result.scalar = MagicMock(return_value=None)
    empty_result.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))

    call_count = {"n": 0}

    async def fake_execute(*args, **kwargs):
        call_count["n"] += 1
        # Первый execute — select(Service). Дальше — settings / прочее.
        if call_count["n"] == 1:
            return svc_result
        return empty_result

    db.execute = AsyncMock(side_effect=fake_execute)

    # Мокаем _get_setting напрямую: возвращает default'ы.
    async def fake_get_setting(_db, key, default=None, tenant_id=None):
        return default

    monkeypatch.setattr(rsvc, "_get_setting", fake_get_setting)

    await rsvc._finalize_bonus_and_ledger(db, referral, confirmed_by_admin_id=None)

    # Проверяем что добавили Bonus с amount=777 (snapshot).
    from app.models.bonus import Bonus

    bonus_added = [o for o in added_objs if isinstance(o, Bonus)]
    assert bonus_added, f"Bonus не был создан. Добавлено: {added_objs}"
    # REGULAR bonus автору должен быть с амаунтом = snapshot.
    amounts = [float(b.amount) for b in bonus_added]
    assert 777.0 in amounts, f"Ожидали bonus.amount=777 (snapshot), а получили: {amounts}"


async def test_finalize_falls_back_to_referral_payout_when_no_snapshot(monkeypatch):
    """Snapshot=None, есть service.referral_payout → берём его (legacy fallback)."""
    from app.services import referral_service as rsvc

    referral = _make_referral(
        from_clinic_id=uuid.uuid4(),
        to_clinic_id=uuid.uuid4(),
        service_id=uuid.uuid4(),
        bonus_snapshot=None,
    )
    service = _make_service(
        referral_payout=Decimal("250.00"),
        bonus_amount=Decimal("50.00"),
    )

    db = AsyncMock()
    added_objs = []
    db.add = MagicMock(side_effect=lambda o: added_objs.append(o))
    db.flush = AsyncMock()

    svc_result = MagicMock()
    svc_result.scalar_one_or_none = MagicMock(return_value=service)
    empty_result = MagicMock()
    empty_result.scalar_one_or_none = MagicMock(return_value=None)
    empty_result.scalar = MagicMock(return_value=None)
    empty_result.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))

    call_count = {"n": 0}

    async def fake_execute(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return svc_result
        return empty_result

    db.execute = AsyncMock(side_effect=fake_execute)

    async def fake_get_setting(_db, key, default=None, tenant_id=None):
        return default

    monkeypatch.setattr(rsvc, "_get_setting", fake_get_setting)

    await rsvc._finalize_bonus_and_ledger(db, referral, confirmed_by_admin_id=None)

    from app.models.bonus import Bonus

    bonus_added = [o for o in added_objs if isinstance(o, Bonus)]
    assert bonus_added, "Bonus не был создан"
    amounts = [float(b.amount) for b in bonus_added]
    assert 250.0 in amounts, f"Ожидали bonus.amount=250 (legacy referral_payout), получили: {amounts}"


async def test_finalize_falls_back_to_bonus_amount_when_no_snapshot_no_payout(monkeypatch):
    """Snapshot=None и referral_payout=None → используем service.bonus_amount."""
    from app.services import referral_service as rsvc

    referral = _make_referral(
        from_clinic_id=uuid.uuid4(),
        to_clinic_id=uuid.uuid4(),
        service_id=uuid.uuid4(),
        bonus_snapshot=None,
    )
    service = _make_service(referral_payout=None, bonus_amount=Decimal("75.00"))

    db = AsyncMock()
    added_objs = []
    db.add = MagicMock(side_effect=lambda o: added_objs.append(o))
    db.flush = AsyncMock()

    svc_result = MagicMock()
    svc_result.scalar_one_or_none = MagicMock(return_value=service)
    empty_result = MagicMock()
    empty_result.scalar_one_or_none = MagicMock(return_value=None)
    empty_result.scalar = MagicMock(return_value=None)
    empty_result.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))

    call_count = {"n": 0}

    async def fake_execute(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return svc_result
        return empty_result

    db.execute = AsyncMock(side_effect=fake_execute)

    async def fake_get_setting(_db, key, default=None, tenant_id=None):
        return default

    monkeypatch.setattr(rsvc, "_get_setting", fake_get_setting)

    await rsvc._finalize_bonus_and_ledger(db, referral, confirmed_by_admin_id=None)

    from app.models.bonus import Bonus

    bonus_added = [o for o in added_objs if isinstance(o, Bonus)]
    assert bonus_added, "Bonus не был создан"
    amounts = [float(b.amount) for b in bonus_added]
    assert 75.0 in amounts, f"Ожидали bonus.amount=75 (legacy bonus_amount), получили: {amounts}"


# ── 3. Manager-roles set: контрактный тест ────────────────────────────────


def test_partner_offers_manager_roles_set():
    """RBAC: management партнёрского прайса — только MANAGER/FRANCHISE_OWNER/SUPER_ADMIN."""
    from app.routers.partner_offers import MANAGER_ROLES
    from app.models.user import UserRole

    assert MANAGER_ROLES == {
        UserRole.MANAGER,
        UserRole.FRANCHISE_OWNER,
        UserRole.SUPER_ADMIN,
    }
    # Явно проверяем что REG / DOCTOR / RECRUITER не входят.
    assert UserRole.REG not in MANAGER_ROLES
    assert UserRole.DOCTOR not in MANAGER_ROLES
    assert UserRole.RECRUITER not in MANAGER_ROLES
    assert UserRole.PARTNER_DOCTOR not in MANAGER_ROLES
