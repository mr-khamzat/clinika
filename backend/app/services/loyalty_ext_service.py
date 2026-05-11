"""
Глава 8 — Сервис расширенной программы лояльности.

Тиры:
  bronze   : 0+
  silver   : 1000+
  gold     : 5000+
  platinum : 20000+

Триггеры начисления:
  award_appointment(...)  → +50 при completion
  award_referral(...)     → +100 при success referral
  award_birthday(...)     → +200 в день рождения

Триггеры не падают и не откатывают основную транзакцию: при любой ошибке
логируется warning и возвращается None.
"""
import logging
import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.loyalty_ext import LoyaltyAccountExt, LoyaltyEvent, LoyaltyClaim
from app.models.loyalty import LoyaltyReward
from app.models.patient_account import PatientAccount
from app.models.commercial import TenantModuleSubscription, ModuleStatus
from app.utils.phone import normalize_phone

logger = logging.getLogger(__name__)


# ── Constants ──────────────────────────────────────────────────────────────
TIER_THRESHOLDS = [
    ("platinum", 20000),
    ("gold", 5000),
    ("silver", 1000),
    ("bronze", 0),
]
TIER_ORDER = {"bronze": 0, "silver": 1, "gold": 2, "platinum": 3}

AWARD_APPOINTMENT = 50
AWARD_REFERRAL = 100
AWARD_BIRTHDAY = 200


def calc_tier(points: int) -> str:
    for name, thr in TIER_THRESHOLDS:
        if points >= thr:
            return name
    return "bronze"


def next_tier_threshold(points: int) -> tuple[str | None, int | None]:
    """Возвращает (имя_следующего_тира, баллов_до_него) или (None,None) если platinum."""
    for name, thr in reversed(TIER_THRESHOLDS):
        if points < thr:
            return name, thr - points
    return None, None


# ── Module check ───────────────────────────────────────────────────────────
async def is_module_active(db: AsyncSession, tenant_id: uuid.UUID | None) -> bool:
    """Проверка что модуль loyalty_pro активен у тенанта."""
    if not tenant_id:
        return False
    r = await db.execute(
        select(TenantModuleSubscription).where(
            and_(
                TenantModuleSubscription.tenant_id == tenant_id,
                TenantModuleSubscription.module_key == "loyalty_pro",
                TenantModuleSubscription.status.in_([
                    ModuleStatus.ACTIVE, ModuleStatus.TRIAL, ModuleStatus.GRACE,
                ]),
            )
        )
    )
    return r.first() is not None


# ── Account helpers ────────────────────────────────────────────────────────
async def get_or_create_account(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    patient: PatientAccount,
) -> LoyaltyAccountExt:
    """Получить или создать loyalty-аккаунт для пациента в тенанте."""
    r = await db.execute(
        select(LoyaltyAccountExt).where(
            and_(
                LoyaltyAccountExt.tenant_id == tenant_id,
                LoyaltyAccountExt.patient_id == patient.id,
            )
        )
    )
    acc = r.scalar_one_or_none()
    if acc:
        return acc

    acc = LoyaltyAccountExt(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        patient_id=patient.id,
        patient_phone=normalize_phone(patient.phone),
        points=0,
        tier="bronze",
        total_spent=Decimal("0"),
        joined_at=datetime.utcnow(),
        last_activity_at=datetime.utcnow(),
    )
    db.add(acc)
    await db.flush()
    return acc


async def get_account_by_patient(
    db: AsyncSession, tenant_id: uuid.UUID, patient_id: uuid.UUID,
) -> LoyaltyAccountExt | None:
    r = await db.execute(
        select(LoyaltyAccountExt).where(
            and_(
                LoyaltyAccountExt.tenant_id == tenant_id,
                LoyaltyAccountExt.patient_id == patient_id,
            )
        )
    )
    return r.scalar_one_or_none()


async def get_account_by_phone(
    db: AsyncSession, tenant_id: uuid.UUID, phone: str,
) -> LoyaltyAccountExt | None:
    phone_n = normalize_phone(phone)
    r = await db.execute(
        select(LoyaltyAccountExt).where(
            and_(
                LoyaltyAccountExt.tenant_id == tenant_id,
                LoyaltyAccountExt.patient_phone == phone_n,
            )
        )
    )
    return r.scalar_one_or_none()


# ── Adjust points ──────────────────────────────────────────────────────────
async def adjust_points(
    db: AsyncSession,
    account: LoyaltyAccountExt,
    delta: int,
    reason: str,
    appointment_id: uuid.UUID | None = None,
    referral_id: uuid.UUID | None = None,
    note: str | None = None,
    add_total_spent: Decimal | None = None,
) -> LoyaltyEvent:
    """Применить delta к балансу + обновить тир + создать LoyaltyEvent."""
    account.points = max(0, (account.points or 0) + delta)
    if add_total_spent:
        account.total_spent = (account.total_spent or Decimal("0")) + add_total_spent
    account.tier = calc_tier(account.points)
    account.last_activity_at = datetime.utcnow()

    ev = LoyaltyEvent(
        id=uuid.uuid4(),
        account_id=account.id,
        delta=delta,
        reason=reason,
        appointment_id=appointment_id,
        referral_id=referral_id,
        note=note,
    )
    db.add(ev)
    await db.flush()
    return ev


# ── Triggers (safe — не падают) ────────────────────────────────────────────
async def award_appointment(
    db: AsyncSession,
    tenant_id: uuid.UUID | None,
    appointment_phone: str,
    appointment_id: uuid.UUID,
    appointment_price: Decimal | None = None,
) -> Optional[LoyaltyEvent]:
    """+50 при закрытии приёма. Безопасный (try/except, не ломает основной поток)."""
    try:
        if not tenant_id:
            return None
        if not await is_module_active(db, tenant_id):
            return None

        from app.services.family_service import get_account_by_phone as get_pa
        patient = await get_pa(db, appointment_phone)
        if not patient:
            return None

        # Идемпотентность: не начислять второй раз за тот же appointment
        r = await db.execute(
            select(LoyaltyEvent).where(
                and_(
                    LoyaltyEvent.appointment_id == appointment_id,
                    LoyaltyEvent.reason == "appointment_completed",
                )
            )
        )
        if r.scalar_one_or_none():
            return None

        acc = await get_or_create_account(db, tenant_id, patient)
        ev = await adjust_points(
            db, acc, AWARD_APPOINTMENT, "appointment_completed",
            appointment_id=appointment_id,
            add_total_spent=appointment_price,
        )
        return ev
    except Exception as e:
        logger.warning(f"award_appointment failed: {e}")
        return None


async def award_referral(
    db: AsyncSession,
    tenant_id: uuid.UUID | None,
    patient_phone: str,
    referral_id: uuid.UUID,
) -> Optional[LoyaltyEvent]:
    """+100 при успешном referral (status=CONFIRMED)."""
    try:
        if not tenant_id:
            return None
        if not await is_module_active(db, tenant_id):
            return None

        from app.services.family_service import get_account_by_phone as get_pa
        patient = await get_pa(db, patient_phone)
        if not patient:
            return None

        r = await db.execute(
            select(LoyaltyEvent).where(
                and_(
                    LoyaltyEvent.referral_id == referral_id,
                    LoyaltyEvent.reason == "referral_made",
                )
            )
        )
        if r.scalar_one_or_none():
            return None

        acc = await get_or_create_account(db, tenant_id, patient)
        ev = await adjust_points(
            db, acc, AWARD_REFERRAL, "referral_made", referral_id=referral_id,
        )
        return ev
    except Exception as e:
        logger.warning(f"award_referral failed: {e}")
        return None


async def award_birthday(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    patient: PatientAccount,
) -> Optional[LoyaltyEvent]:
    """+200 в день рождения (один раз в год)."""
    try:
        if not patient.birth_date:
            return None
        today = date.today()
        if (today.month, today.day) != (patient.birth_date.month, patient.birth_date.day):
            return None
        if not await is_module_active(db, tenant_id):
            return None

        acc = await get_or_create_account(db, tenant_id, patient)
        # Идемпотентность: один birthday-bonus в год
        from sqlalchemy import func, extract
        r = await db.execute(
            select(LoyaltyEvent).where(
                and_(
                    LoyaltyEvent.account_id == acc.id,
                    LoyaltyEvent.reason == "birthday_bonus",
                    extract("year", LoyaltyEvent.created_at) == today.year,
                )
            )
        )
        if r.scalar_one_or_none():
            return None

        ev = await adjust_points(
            db, acc, AWARD_BIRTHDAY, "birthday_bonus",
            note=f"С Днём рождения! +{AWARD_BIRTHDAY} баллов",
        )
        return ev
    except Exception as e:
        logger.warning(f"award_birthday failed: {e}")
        return None


# ── Claims ────────────────────────────────────────────────────────────────
async def can_claim(reward: LoyaltyReward, account: LoyaltyAccountExt) -> tuple[bool, str | None]:
    """Проверить может ли пациент забронировать награду. Возвращает (ok, error_msg)."""
    if not reward.is_active:
        return False, "Награда неактивна"
    min_tier = getattr(reward, "min_tier", "bronze") or "bronze"
    if TIER_ORDER.get(account.tier, 0) < TIER_ORDER.get(min_tier, 0):
        return False, f"Нужен тир {min_tier} или выше"
    stock = getattr(reward, "stock", None)
    if stock is not None and stock <= 0:
        return False, "Награда закончилась"
    if account.points < reward.cost_points:
        return False, f"Недостаточно баллов (нужно {reward.cost_points})"
    return True, None


async def create_claim(
    db: AsyncSession, account: LoyaltyAccountExt, reward: LoyaltyReward,
) -> LoyaltyClaim:
    """Создать заявку, списать points, уменьшить stock."""
    claim = LoyaltyClaim(
        id=uuid.uuid4(),
        account_id=account.id,
        reward_id=reward.id,
        points_spent=reward.cost_points,
        status="requested",
    )
    db.add(claim)

    await adjust_points(
        db, account, -reward.cost_points, "reward_claimed",
        note=f"Reward: {reward.name}",
    )

    if reward.stock is not None and reward.stock > 0:
        reward.stock -= 1

    await db.flush()
    return claim


# ── Birthday batch ─────────────────────────────────────────────────────────
async def run_birthday_batch(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    """Прогнать всех пациентов с днём рождения сегодня — выдать бонус."""
    today = date.today()
    r = await db.execute(
        select(PatientAccount).where(PatientAccount.is_active.is_(True))
    )
    count = 0
    for p in r.scalars().all():
        if not p.birth_date:
            continue
        if (p.birth_date.month, p.birth_date.day) != (today.month, today.day):
            continue
        ev = await award_birthday(db, tenant_id, p)
        if ev:
            count += 1
    return count
