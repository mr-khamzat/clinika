"""
Глава 9 — Сервис подписки пациента «Здоровье+».

Бизнес-правила:
  - один активный план одного типа на пациента;
  - trial: 7 дней default; active = с момента оплаты;
  - cancel: status=cancelled, expires_at не меняется (доступ до конца периода);
  - resume: если cancelled и expires_at в будущем — возвращаем active;
  - is_active(patient): любой не-expired + status in (active, trial, paused).
"""
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.subscription import PatientSubscription, PatientSubscriptionHistory


# Каталог планов (в будущем — из tenant_settings / commercial_modules)
PLANS = {
    "health_plus": {
        "title": "Здоровье+",
        "price_monthly": Decimal("290.00"),
        "trial_days": 7,
        "benefits": [
            "Безлимит чата с врачом",
            "Скидка 10% на приёмы",
            "Расходник 1 раз в месяц автоматически",
            "Приоритет в записи",
        ],
    },
    "family_plus": {
        "title": "Семья+",
        "price_monthly": Decimal("590.00"),
        "trial_days": 7,
        "benefits": [
            "Все преимущества Здоровье+",
            "До 4 членов семьи",
            "Семейная медкарта",
        ],
    },
    "pro": {
        "title": "Pro",
        "price_monthly": Decimal("990.00"),
        "trial_days": 7,
        "benefits": [
            "Все преимущества Семья+",
            "Телемедицина без ограничений",
            "Приоритет 24/7",
        ],
    },
}


def plan_meta(plan: str) -> dict:
    return PLANS.get(plan) or {}


def all_plans() -> list[dict]:
    return [
        {
            "plan": key,
            "title": v["title"],
            "price_monthly": float(v["price_monthly"]),
            "trial_days": v["trial_days"],
            "benefits": v["benefits"],
        }
        for key, v in PLANS.items()
    ]


def serialize_subscription(s: PatientSubscription) -> dict:
    return {
        "id": str(s.id),
        "tenant_id": str(s.tenant_id) if s.tenant_id else None,
        "patient_id": str(s.patient_id),
        "plan": s.plan,
        "plan_title": (PLANS.get(s.plan, {}) or {}).get("title") or s.plan,
        "status": s.status,
        "started_at": s.started_at.isoformat() if s.started_at else None,
        "expires_at": s.expires_at.isoformat() if s.expires_at else None,
        "auto_renew": bool(s.auto_renew),
        "price_monthly": float(s.price_monthly) if s.price_monthly is not None else None,
        "payment_method": s.payment_method,
        "external_subscription_id": s.external_subscription_id,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


async def get_active_subscription(
    db: AsyncSession, patient_id: uuid.UUID
) -> Optional[PatientSubscription]:
    """Возвращает активную/trial-подписку пациента (любого плана), либо None."""
    now = datetime.utcnow()
    r = await db.execute(
        select(PatientSubscription).where(
            PatientSubscription.patient_id == patient_id,
            PatientSubscription.status.in_(["active", "trial"]),
            PatientSubscription.expires_at > now,
        ).order_by(PatientSubscription.expires_at.desc())
    )
    return r.scalars().first()


async def has_active_plan(
    db: AsyncSession, patient_id: uuid.UUID, plans: list[str] | None = None
) -> bool:
    """True если у пациента есть активная подписка из списка plans (или любая если None)."""
    sub = await get_active_subscription(db, patient_id)
    if not sub:
        return False
    if plans is None:
        return True
    return sub.plan in plans


async def get_subscription_for_patient_any_status(
    db: AsyncSession, patient_id: uuid.UUID, plan: str
) -> Optional[PatientSubscription]:
    r = await db.execute(
        select(PatientSubscription).where(
            PatientSubscription.patient_id == patient_id,
            PatientSubscription.plan == plan,
        ).order_by(PatientSubscription.created_at.desc())
    )
    return r.scalars().first()


async def start_subscription(
    db: AsyncSession,
    patient_id: uuid.UUID,
    plan: str,
    tenant_id: uuid.UUID | None = None,
    trial_days: int | None = None,
    payment_method: str | None = None,
) -> PatientSubscription:
    """
    Создать подписку.
    Если trial_days > 0 — статус=trial, иначе=active (но без реальной оплаты
    остаётся в статусе trial — ЮKassa подключим позже).
    """
    meta = plan_meta(plan)
    if not meta:
        raise ValueError(f"Unknown plan: {plan}")

    # Проверяем, нет ли уже активной подписки этого плана
    existing = await get_subscription_for_patient_any_status(db, patient_id, plan)
    if existing and existing.status in ("active", "trial") and existing.expires_at > datetime.utcnow():
        return existing  # idempotent

    use_trial = trial_days is not None and trial_days > 0
    if use_trial is False and trial_days is None:
        use_trial = True
        trial_days = meta.get("trial_days") or 7

    now = datetime.utcnow()
    expires = now + timedelta(days=trial_days if use_trial else 30)
    sub = PatientSubscription(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        patient_id=patient_id,
        plan=plan,
        status="trial" if use_trial else "active",
        started_at=now,
        expires_at=expires,
        auto_renew=True,
        price_monthly=meta.get("price_monthly"),
        payment_method=payment_method,
    )
    db.add(sub)
    await db.flush()
    db.add(PatientSubscriptionHistory(
        subscription_id=sub.id,
        event="created",
        amount=meta.get("price_monthly"),
        note=f"trial_days={trial_days}" if use_trial else "instant_active",
    ))
    return sub


async def cancel_subscription(
    db: AsyncSession, sub: PatientSubscription, reason: str | None = None
) -> PatientSubscription:
    sub.status = "cancelled"
    sub.auto_renew = False
    sub.updated_at = datetime.utcnow()
    db.add(PatientSubscriptionHistory(
        subscription_id=sub.id,
        event="cancelled",
        note=reason,
    ))
    return sub


async def resume_subscription(
    db: AsyncSession, sub: PatientSubscription
) -> PatientSubscription:
    if sub.status != "cancelled":
        raise ValueError("Can resume only cancelled subscription")
    if sub.expires_at <= datetime.utcnow():
        raise ValueError("Subscription already expired — start new one")
    sub.status = "active"
    sub.auto_renew = True
    sub.updated_at = datetime.utcnow()
    db.add(PatientSubscriptionHistory(
        subscription_id=sub.id,
        event="resumed",
    ))
    return sub


def benefits_for(plan: str) -> dict:
    """Список текущих привилегий для UI."""
    meta = plan_meta(plan)
    return {
        "plan": plan,
        "title": meta.get("title") or plan,
        "benefits": meta.get("benefits") or [],
        "discount_percent": 10 if plan in ("health_plus", "family_plus", "pro") else 0,
        "unlimited_chat": True,
        "monthly_supply": True,
        "priority_booking": True,
        "family_members_allowed": 4 if plan in ("family_plus", "pro") else 1,
        "telemedicine_unlimited": plan == "pro",
    }
