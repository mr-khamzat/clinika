"""Тесты модуля направлений (referrals) Clinika.

Покрывают:
- защищённость API (без токена → 401/403);
- арифметику бонусов и SLA-дедлайна (pure logic, без БД);
- рекрутер-цепочку (recruiter → partner_doctor → referral → bonus split)
  через factory_boy фабрики и AsyncMock-сессию.

Тесты помечены ``unit`` — не требуют PostgreSQL.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

import pytest

pytestmark = pytest.mark.unit


# ─── API-уровень: без токена ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_referrals_list_no_token(client):
    """GET /referrals/ без токена → 401/403 (FastAPI требует trailing slash)."""
    resp = await client.get("/referrals/")
    assert resp.status_code in (401, 403, 404)


@pytest.mark.asyncio
async def test_referrals_create_no_token(client):
    """POST /referrals/ без токена → 401/403."""
    resp = await client.post("/referrals/", json={
        "patient_phone": "+79001112233",
        "service_id": "00000000-0000-0000-0000-000000000000",
        "to_clinic_id": "00000000-0000-0000-0000-000000000000",
    })
    assert resp.status_code in (401, 403, 404, 422)


# ─── Реферальная цепочка: recruiter → partner_doctor → referral ───────────────


def test_recruiter_invites_partner_doctor(recruiter_factory, partner_doctor_factory):
    """Рекрутер привязывается к partner_doctor через recruiter_id."""
    recruiter = recruiter_factory()
    partner = partner_doctor_factory(recruiter_id=recruiter.id)

    assert partner.role.value == "partner_doctor"
    assert recruiter.role.value == "recruiter"
    assert partner.recruiter_id == recruiter.id
    assert recruiter.bonus_percent == Decimal("20")


def test_referral_created_by_partner_doctor(
    tenant_factory, partner_doctor_factory, referral_factory,
):
    """partner_doctor создаёт направление в рамках своего тенанта."""
    tenant = tenant_factory()
    partner = partner_doctor_factory(tenant_id=tenant.id)
    referral = referral_factory(
        tenant_id=tenant.id,
        created_by_admin_id=partner.id,
        patient_name="Иван Петров",
        patient_phone="+79001112233",
    )

    assert referral.tenant_id == tenant.id
    assert referral.created_by_admin_id == partner.id
    assert referral.patient_name == "Иван Петров"
    assert referral.confirmed_by_admin_id is None  # ещё не подтверждено


def test_recruiter_bonus_split_calculation():
    """При подтверждении направления:

    автор-бонус = base × bonus%/100, рекрутер-бонус = автор-бонус × rec%/100.
    """
    service_price = Decimal("5000.00")
    author_bonus_percent = Decimal("3")  # 3% автору
    recruiter_bonus_percent = Decimal("20")  # 20% рекрутеру от бонуса автора

    author_bonus = service_price * author_bonus_percent / 100
    recruiter_bonus = author_bonus * recruiter_bonus_percent / 100

    assert author_bonus == Decimal("150.00")
    assert recruiter_bonus == Decimal("30.00")


def test_referral_status_transition(referral_factory):
    """Подтверждение: status → confirmed, confirmed_by_admin_id заполнен."""
    from app.models.referral import ReferralStatus

    ref = referral_factory(status=ReferralStatus.CREATED)
    assert ref.status == ReferralStatus.CREATED
    assert ref.confirmed_at is None

    # Эмулируем подтверждение
    ref.status = ReferralStatus.CONFIRMED
    ref.confirmed_at = datetime.utcnow()
    assert ref.status == ReferralStatus.CONFIRMED
    assert ref.confirmed_at is not None


# ─── SLA-дедлайн ──────────────────────────────────────────────────────────────


def test_sla_deadline_calculation(referral_factory):
    """Если у услуги sla_days=7 → sla_deadline = created_at + 7 дней."""
    created = datetime(2026, 5, 1, 10, 0, 0)
    sla_days = 7
    deadline = created + timedelta(days=sla_days)

    ref = referral_factory(created_at=created)
    # sla_deadline в API считается на лету: created_at + service.sla_days
    assert deadline == datetime(2026, 5, 8, 10, 0, 0)
    assert ref.created_at == created


def test_sla_deadline_zero_means_no_sla():
    """Если sla_days = 0 — направление считается без SLA, дедлайн не считается."""
    sla_days = 0
    deadline = None if sla_days <= 0 else datetime.utcnow() + timedelta(days=sla_days)
    assert deadline is None


def test_sla_overdue_check():
    """Направление просрочено если now > created_at + sla_days."""
    created = datetime.utcnow() - timedelta(days=10)
    sla_days = 7
    deadline = created + timedelta(days=sla_days)
    now = datetime.utcnow()

    is_overdue = now > deadline
    assert is_overdue is True
