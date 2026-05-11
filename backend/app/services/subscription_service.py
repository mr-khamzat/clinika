"""
Глава 9 — Сервис подписки пациента «Здоровье+».

Бизнес-правила:
  - один активный план одного типа на пациента;
  - trial: 7 дней default; active = с момента оплаты;
  - cancel: status=cancelled, expires_at не меняется (доступ до конца периода);
  - resume: если cancelled и expires_at в будущем — возвращаем active;
  - is_active(patient): любой не-expired + status in (active, trial, paused).

С версии subplans01 каталог планов хранится в БД (таблица subscription_plans),
управляется super_admin (глобально) и franchise_owner (override по тенанту).
Словарь PLANS оставлен как fallback, если БД пустая.
"""
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.subscription import PatientSubscription, PatientSubscriptionHistory


# ── Fallback-словарь (если БД пустая на первый запуск) ──────────────────────
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
    """Возвращает fallback-метаданные плана (если БД недоступна).

    Для актуальных данных используйте subscription_plan_service.get_plan_by_key.
    """
    return PLANS.get(plan) or {}


def all_plans() -> list[dict]:
    """Fallback-список планов (используется, если БД пустая)."""
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


async def all_plans_db(
    db: AsyncSession,
    tenant_id: uuid.UUID | None = None,
) -> list[dict]:
    """Список планов из БД (с применением override для tenant_id).

    Если БД пуста — возвращает fallback all_plans().
    Формат записи совместим с UI пациента: plan, title, price_monthly,
    price_annual, trial_days, benefits, features.
    """
    from app.services import subscription_plan_service as sps
    rows = await sps.get_effective_plans(db, tenant_id)
    if not rows:
        return all_plans()
    out = []
    for r in rows:
        out.append({
            "plan": r["plan_key"],
            "title": r["title"],
            "description": r.get("description") or "",
            "price_monthly": r.get("price_monthly"),
            "price_annual": r.get("price_annual"),
            "trial_days": r.get("trial_days") or 7,
            "benefits": r.get("benefits") or [],
            "features": r.get("features") or {},
            "is_override": r.get("is_override", False),
            "has_override": r.get("has_override", False),
        })
    return out


async def plan_meta_db(
    db: AsyncSession,
    plan: str,
    tenant_id: uuid.UUID | None = None,
) -> dict:
    """Получить актуальный план из БД (с override) или fallback из PLANS."""
    from app.services import subscription_plan_service as sps
    row = await sps.get_plan_by_key(db, tenant_id, plan)
    if row:
        return {
            "title": row.get("title") or plan,
            "description": row.get("description") or "",
            "price_monthly": Decimal(str(row.get("price_monthly") or 0)),
            "price_annual": Decimal(str(row.get("price_annual"))) if row.get("price_annual") else None,
            "trial_days": int(row.get("trial_days") or 7),
            "benefits": list(row.get("benefits") or []),
            "features": dict(row.get("features") or {}),
        }
    fb = plan_meta(plan)
    if not fb:
        return {}
    return {
        "title": fb.get("title") or plan,
        "description": "",
        "price_monthly": fb.get("price_monthly") or Decimal("0"),
        "price_annual": None,
        "trial_days": fb.get("trial_days") or 7,
        "benefits": fb.get("benefits") or [],
        "features": {},
    }


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
    Цена/trial берутся из БД (subscription_plans с учётом override),
    fallback — PLANS словарь.
    """
    # Берём актуальные параметры плана из БД с применением override
    meta = await plan_meta_db(db, plan, tenant_id)
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
    """Список текущих привилегий для UI (fallback по PLANS).

    Для актуальных данных пациент видит features из effective plan,
    собранных через subscription_plan_service.
    """
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


async def benefits_for_db(
    db: AsyncSession,
    plan: str,
    tenant_id: uuid.UUID | None = None,
) -> dict:
    """Список привилегий из БД (с применением override) или fallback."""
    meta = await plan_meta_db(db, plan, tenant_id)
    if not meta:
        return benefits_for(plan)
    feats = meta.get("features") or {}
    return {
        "plan": plan,
        "title": meta.get("title") or plan,
        "benefits": meta.get("benefits") or [],
        "discount_percent": int(feats.get("discount_percent", 0)),
        "unlimited_chat": bool(feats.get("unlimited_chat", False)),
        "monthly_supply": bool(feats.get("monthly_supply", False)),
        "priority_booking": bool(feats.get("priority_booking", False)),
        "family_members_allowed": int(feats.get("family_members_allowed", 1)),
        "telemedicine_unlimited": bool(feats.get("telemedicine_unlimited", False)),
        "services_access": dict(feats.get("services_access") or {}),
    }


# ── Helpers для интеграции скидки в appointments ────────────────────────────
async def get_active_subscription_by_phone(
    db: AsyncSession,
    patient_phone: str,
) -> Optional[PatientSubscription]:
    """Найти active/trial-подписку по телефону пациента (через PatientAccount)."""
    from app.models.patient_account import PatientAccount
    pa = (await db.execute(
        select(PatientAccount).where(PatientAccount.phone == patient_phone)
    )).scalar_one_or_none()
    if not pa:
        return None
    return await get_active_subscription(db, pa.id)


async def compute_discount_for(
    db: AsyncSession,
    patient_phone: str,
    base_price: float | Decimal | None,
    tenant_id: uuid.UUID | None = None,
) -> dict:
    """Считает скидку по активной подписке пациента для цены приёма.

    Возвращает:
      {
        applied_subscription_id: UUID | None,
        discount_percent: float,   # 0..50
        discount_amount: float,    # >=0
        price_after: float,
      }
    """
    if base_price is None:
        return {
            "applied_subscription_id": None,
            "discount_percent": 0.0,
            "discount_amount": 0.0,
            "price_after": None,
        }
    base = Decimal(str(base_price))
    sub = await get_active_subscription_by_phone(db, patient_phone)
    if not sub:
        return {
            "applied_subscription_id": None,
            "discount_percent": 0.0,
            "discount_amount": 0.0,
            "price_after": float(base),
        }
    bens = await benefits_for_db(db, sub.plan, tenant_id=tenant_id or sub.tenant_id)
    pct = int(bens.get("discount_percent", 0) or 0)
    if pct <= 0:
        return {
            "applied_subscription_id": str(sub.id),
            "discount_percent": 0.0,
            "discount_amount": 0.0,
            "price_after": float(base),
        }
    pct = max(0, min(50, pct))
    disc_amount = (base * Decimal(pct) / Decimal("100")).quantize(Decimal("0.01"))
    return {
        "applied_subscription_id": str(sub.id),
        "discount_percent": float(pct),
        "discount_amount": float(disc_amount),
        "price_after": float((base - disc_amount).quantize(Decimal("0.01"))),
    }
