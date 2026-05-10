"""Финансовая изоляция тенантов: комиссии и фи не утекают между tenant_A/tenant_B.

Покрывает фикс #5 — раньше commission_*, platform_fee_floor хранились как
ГЛОБАЛЬНЫЕ ключи в system_settings → одно изменение перетирало настройки
всех тенантов. Теперь settings_service.set_setting(..., tenant_id=X) пишет
ключ как ``{tenant_id}:{key}`` и get_setting читает per-tenant.

Тесты гарантируют:
1. commission_receiver_id у tenant_A не виден из tenant_B и наоборот;
2. platform_fee_floor разный у двух тенантов — каждый применяет свой;
3. Bonus(COMMISSION) идёт правильному получателю в зависимости от
   tenant_id направления.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


# ─── 1) settings_service: per-tenant изоляция ────────────────────────────────


async def test_commission_setting_per_tenant_isolated(pg_test_session):
    """set_setting(tenant_A) и set_setting(tenant_B) не пересекаются."""
    from app.services.settings_service import set_setting, get_setting

    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()

    receiver_a = str(uuid.uuid4())
    receiver_b = str(uuid.uuid4())

    await set_setting(pg_test_session, "commission_receiver_id", receiver_a, tenant_id=tenant_a)
    await set_setting(pg_test_session, "commission_receiver_id", receiver_b, tenant_id=tenant_b)

    # Каждый тенант видит свой receiver
    a = await get_setting(pg_test_session, "commission_receiver_id", "", tenant_id=tenant_a)
    b = await get_setting(pg_test_session, "commission_receiver_id", "", tenant_id=tenant_b)

    assert a == receiver_a, f"tenant_A should see {receiver_a}, got {a}"
    assert b == receiver_b, f"tenant_B should see {receiver_b}, got {b}"
    assert a != b, "Tenants должны иметь РАЗНЫЕ commission_receiver_id"


async def test_platform_fee_floor_per_tenant(pg_test_session):
    """platform_fee_floor — индивидуальная настройка на тенант."""
    from app.services.settings_service import set_setting, get_setting

    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()

    await set_setting(pg_test_session, "platform_fee_floor", "100", tenant_id=tenant_a)
    await set_setting(pg_test_session, "platform_fee_floor", "250", tenant_id=tenant_b)

    a = await get_setting(pg_test_session, "platform_fee_floor", "0", tenant_id=tenant_a)
    b = await get_setting(pg_test_session, "platform_fee_floor", "0", tenant_id=tenant_b)

    assert a == "100"
    assert b == "250"
    assert float(a) != float(b)


async def test_global_setting_is_fallback_not_overwrite(pg_test_session):
    """Глобальный ключ — fallback, но НЕ перезаписывает tenant-scoped значение."""
    from app.services.settings_service import set_setting, get_setting

    tenant_a = uuid.uuid4()

    # Сначала устанавливаем глобальный (без tenant_id).
    await set_setting(pg_test_session, "commission_rate", "5", tenant_id=None)
    # Потом — tenant-specific.
    await set_setting(pg_test_session, "commission_rate", "12", tenant_id=tenant_a)

    # Tenant_A видит свой 12, не глобальный 5.
    a = await get_setting(pg_test_session, "commission_rate", "0", tenant_id=tenant_a)
    assert a == "12"

    # Тенант, у которого нет своего ключа — получает глобальный fallback.
    other = uuid.uuid4()
    fallback = await get_setting(pg_test_session, "commission_rate", "0", tenant_id=other)
    assert fallback == "5", "tenant без своего ключа должен видеть глобальный fallback"


async def test_setting_default_when_not_set(pg_test_session):
    """Если нет ни tenant-scoped, ни глобального ключа — возвращается default."""
    from app.services.settings_service import get_setting

    tenant_a = uuid.uuid4()
    val = await get_setting(pg_test_session, "nonexistent_key", "default42", tenant_id=tenant_a)
    assert val == "default42"


# ─── 2) Финансовая изоляция: commission идёт «своему» receiver ───────────────


async def _seed_two_tenants_with_commission(session):
    """Создаёт 2 тенанта с разными commission_receiver_id и нужные сущности."""
    from app.models.tenant import Tenant
    from app.models.clinic import Clinic
    from app.models.service import Service
    from app.models.user import User, UserRole
    from app.services.settings_service import set_setting

    # tenant_A
    tenant_a = Tenant(id=uuid.uuid4(), name="A", slug=f"a-{uuid.uuid4().hex[:8]}")
    session.add(tenant_a)
    await session.flush()
    clinic_a = Clinic(id=uuid.uuid4(), tenant_id=tenant_a.id, name="ClinicA")
    session.add(clinic_a)
    await session.flush()
    receiver_a = User(
        id=uuid.uuid4(), tenant_id=tenant_a.id, full_name="ReceiverA",
        username=f"ra-{uuid.uuid4().hex[:8]}",
        role=UserRole.MANAGER, is_active=True,
    )
    author_a = User(
        id=uuid.uuid4(), tenant_id=tenant_a.id, full_name="AuthorA",
        username=f"aa-{uuid.uuid4().hex[:8]}",
        role=UserRole.PARTNER_DOCTOR, clinic_id=clinic_a.id, is_active=True,
    )
    session.add_all([receiver_a, author_a])
    await session.flush()
    service_a = Service(
        id=uuid.uuid4(), tenant_id=tenant_a.id, clinic_id=clinic_a.id,
        name="ServiceA", price=Decimal("1000"), bonus_amount=Decimal("0"),
        referral_payout=Decimal("300"),
    )
    session.add(service_a)

    # tenant_B
    tenant_b = Tenant(id=uuid.uuid4(), name="B", slug=f"b-{uuid.uuid4().hex[:8]}")
    session.add(tenant_b)
    await session.flush()
    clinic_b = Clinic(id=uuid.uuid4(), tenant_id=tenant_b.id, name="ClinicB")
    session.add(clinic_b)
    await session.flush()
    receiver_b = User(
        id=uuid.uuid4(), tenant_id=tenant_b.id, full_name="ReceiverB",
        username=f"rb-{uuid.uuid4().hex[:8]}",
        role=UserRole.MANAGER, is_active=True,
    )
    author_b = User(
        id=uuid.uuid4(), tenant_id=tenant_b.id, full_name="AuthorB",
        username=f"ab-{uuid.uuid4().hex[:8]}",
        role=UserRole.PARTNER_DOCTOR, clinic_id=clinic_b.id, is_active=True,
    )
    session.add_all([receiver_b, author_b])
    await session.flush()
    service_b = Service(
        id=uuid.uuid4(), tenant_id=tenant_b.id, clinic_id=clinic_b.id,
        name="ServiceB", price=Decimal("1000"), bonus_amount=Decimal("0"),
        referral_payout=Decimal("300"),
    )
    session.add(service_b)
    await session.commit()

    # Per-tenant настройки комиссии.
    await set_setting(session, "commission_enabled", "true", tenant_id=tenant_a.id)
    await set_setting(session, "commission_rate", "10", tenant_id=tenant_a.id)
    await set_setting(session, "commission_receiver_id", str(receiver_a.id), tenant_id=tenant_a.id)

    await set_setting(session, "commission_enabled", "true", tenant_id=tenant_b.id)
    await set_setting(session, "commission_rate", "10", tenant_id=tenant_b.id)
    await set_setting(session, "commission_receiver_id", str(receiver_b.id), tenant_id=tenant_b.id)

    return {
        "tenant_a": tenant_a, "clinic_a": clinic_a,
        "service_a": service_a, "receiver_a": receiver_a, "author_a": author_a,
        "tenant_b": tenant_b, "clinic_b": clinic_b,
        "service_b": service_b, "receiver_b": receiver_b, "author_b": author_b,
    }


async def test_commission_does_not_cross_tenants(pg_test_session):
    """Commission в направлении tenant_A → COMMISSION-Bonus идёт receiver_A.

    Направление в tenant_B → COMMISSION идёт receiver_B. Перекрёстных не должно
    быть. Это базовый smoke-test финансовой изоляции (фикс #5).
    """
    from sqlalchemy import select
    from app.models.bonus import Bonus, BonusType
    from app.models.referral import Referral, ReferralStatus
    from app.services.referral_service import _apply_confirmation

    seed = await _seed_two_tenants_with_commission(pg_test_session)

    # Создаём referral в tenant_A
    ref_a = Referral(
        id=uuid.uuid4(), tenant_id=seed["tenant_a"].id,
        from_clinic_id=seed["clinic_a"].id, to_clinic_id=seed["clinic_a"].id,
        service_id=seed["service_a"].id, patient_phone="+790011A",
        created_by_admin_id=seed["author_a"].id, short_code=11111,
        status=ReferralStatus.CREATED,
    )
    pg_test_session.add(ref_a)
    await pg_test_session.commit()

    # Подтверждаем через _apply_confirmation
    await _apply_confirmation(pg_test_session, ref_a, seed["author_a"].id)

    # Все Bonuses этого референса
    bonuses_a = (await pg_test_session.execute(
        select(Bonus).where(Bonus.referral_id == ref_a.id)
    )).scalars().all()

    commission_a = [b for b in bonuses_a if b.bonus_type == BonusType.COMMISSION]
    assert len(commission_a) == 1, (
        f"tenant_A должен иметь ровно 1 commission Bonus, got {len(commission_a)}"
    )
    assert commission_a[0].admin_id == seed["receiver_a"].id, (
        f"COMMISSION должен уйти receiver_A {seed['receiver_a'].id}, "
        f"got {commission_a[0].admin_id} — финансовая утечка между тенантами!"
    )
    # Точно НЕ ушло receiver_B
    assert commission_a[0].admin_id != seed["receiver_b"].id

    # Создаём referral в tenant_B
    ref_b = Referral(
        id=uuid.uuid4(), tenant_id=seed["tenant_b"].id,
        from_clinic_id=seed["clinic_b"].id, to_clinic_id=seed["clinic_b"].id,
        service_id=seed["service_b"].id, patient_phone="+790011B",
        created_by_admin_id=seed["author_b"].id, short_code=22222,
        status=ReferralStatus.CREATED,
    )
    pg_test_session.add(ref_b)
    await pg_test_session.commit()

    await _apply_confirmation(pg_test_session, ref_b, seed["author_b"].id)

    bonuses_b = (await pg_test_session.execute(
        select(Bonus).where(Bonus.referral_id == ref_b.id)
    )).scalars().all()

    commission_b = [b for b in bonuses_b if b.bonus_type == BonusType.COMMISSION]
    assert len(commission_b) == 1, "tenant_B должен иметь 1 commission Bonus"
    assert commission_b[0].admin_id == seed["receiver_b"].id, (
        f"COMMISSION в tenant_B должен уйти receiver_B {seed['receiver_b'].id}, "
        f"got {commission_b[0].admin_id}"
    )
    assert commission_b[0].admin_id != seed["receiver_a"].id


async def test_platform_fee_floor_isolation_smoke(pg_test_session):
    """Smoke: settings.platform_fee_floor читается per-tenant из _finalize_bonus_and_ledger.

    Прямо проверить эффект на сумме платформенного fee сложно без полного
    прогона confirm + franchise — поэтому минимально удостоверяемся что
    значение хранится изолированно (см. test_platform_fee_floor_per_tenant)
    и читается через _get_setting."""
    from app.services.referral_service import _get_setting
    from app.services.settings_service import set_setting

    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    await set_setting(pg_test_session, "platform_fee_floor", "150", tenant_id=tenant_a)
    await set_setting(pg_test_session, "platform_fee_floor", "350", tenant_id=tenant_b)

    a = await _get_setting(pg_test_session, "platform_fee_floor", "100", tenant_id=tenant_a)
    b = await _get_setting(pg_test_session, "platform_fee_floor", "100", tenant_id=tenant_b)
    assert a == "150"
    assert b == "350"


# ─── 3) Регресс: tenant_id присутствует в Bonus ──────────────────────────────


async def test_bonus_has_tenant_id_field():
    """Bonus.tenant_id — обязательное поле для изоляции."""
    from app.models.bonus import Bonus

    cols = Bonus.__table__.columns.keys()
    assert "tenant_id" in cols, "Bonus должен иметь tenant_id для изоляции"


async def test_billing_ledger_has_tenant_id_field():
    """BillingLedger.tenant_id — обязательное поле для изоляции."""
    from app.models.billing_ledger import BillingLedger

    cols = BillingLedger.__table__.columns.keys()
    assert "tenant_id" in cols, "BillingLedger должен иметь tenant_id для изоляции"
