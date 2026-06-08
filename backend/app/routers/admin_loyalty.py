"""
Глава 8 — Admin endpoints программы лояльности (Bronze/Silver/Gold).

Менеджер/владелец франшизы управляют:
  • Каталогом наград (CRUD);
  • Заявками пациентов (loyalty_claims);
  • Ручной корректировкой баланса;
  • Просмотром leaderboard.

Все требуют активного модуля loyalty_pro у тенанта.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user, require_role
from app.core.tenant import require_module
from app.models.user import User, UserRole
from app.models.loyalty_ext import LoyaltyAccountExt, LoyaltyEvent, LoyaltyClaim
from app.models.loyalty import LoyaltyReward
from app.models.patient_account import PatientAccount
from app.services import loyalty_ext_service as ls
from app.services import family_service as fs


router = APIRouter(
    prefix="/admin/loyalty",
    tags=["admin-loyalty"],
    dependencies=[Depends(require_module("loyalty_pro"))],
)

_REQUIRE_MANAGER = Depends(require_role(
    UserRole.MANAGER, UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN,
))


# ── Schemas ────────────────────────────────────────────────────────────────
class RewardIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: Optional[str] = None
    reward_type: str = Field(default="gift")  # free_service|service_discount|gift
    cost_points: int = Field(ge=1)
    discount_percent: Optional[Decimal] = None
    service_ref: Optional[str] = None
    is_active: bool = True
    icon: Optional[str] = None
    sort_order: int = 0
    min_tier: str = Field(default="bronze")
    stock: Optional[int] = None


class RewardPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    reward_type: Optional[str] = None
    cost_points: Optional[int] = None
    discount_percent: Optional[Decimal] = None
    service_ref: Optional[str] = None
    is_active: Optional[bool] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = None
    min_tier: Optional[str] = None
    stock: Optional[int] = None


class AdjustIn(BaseModel):
    patient_id: Optional[uuid.UUID] = None
    patient_phone: Optional[str] = None
    delta: int
    reason: str = Field(default="manual_admin", max_length=80)
    note: Optional[str] = None


class ClaimStatusIn(BaseModel):
    status: Literal["requested", "approved", "delivered", "cancelled"]
    note: Optional[str] = None


# ── Rewards CRUD ──────────────────────────────────────────────────────────
@router.get("/rewards", dependencies=[_REQUIRE_MANAGER])
async def list_rewards(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    r = await db.execute(
        select(LoyaltyReward)
        .where(LoyaltyReward.tenant_id == current_user.tenant_id)
        .order_by(LoyaltyReward.sort_order.asc(), LoyaltyReward.cost_points.asc())
    )
    items = []
    for rw in r.scalars().all():
        items.append({
            "id": str(rw.id),
            "name": rw.name,
            "description": rw.description,
            "reward_type": rw.reward_type,
            "cost_points": rw.cost_points,
            "discount_percent": float(rw.discount_percent) if rw.discount_percent is not None else None,
            "service_ref": rw.service_ref,
            "is_active": rw.is_active,
            "icon": rw.icon,
            "sort_order": rw.sort_order,
            "min_tier": getattr(rw, "min_tier", "bronze") or "bronze",
            "stock": getattr(rw, "stock", None),
            "created_at": rw.created_at.isoformat() if rw.created_at else None,
        })
    return {"items": items}


@router.post("/rewards", status_code=201, dependencies=[_REQUIRE_MANAGER])
async def create_reward(
    body: RewardIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rw = LoyaltyReward(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        name=body.name,
        description=body.description,
        reward_type=body.reward_type,
        cost_points=body.cost_points,
        discount_percent=body.discount_percent,
        service_ref=body.service_ref,
        is_active=body.is_active,
        icon=body.icon,
        sort_order=body.sort_order,
    )
    # min_tier и stock как поля новой миграции
    setattr(rw, "min_tier", body.min_tier)
    setattr(rw, "stock", body.stock)
    db.add(rw)
    await db.commit()
    return {"id": str(rw.id), "status": "created"}


@router.patch("/rewards/{reward_id}", dependencies=[_REQUIRE_MANAGER])
async def patch_reward(
    reward_id: uuid.UUID,
    body: RewardPatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rw = await db.get(LoyaltyReward, reward_id)
    if not rw or rw.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Reward not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(rw, k, v)
    rw.updated_at = datetime.utcnow()
    await db.commit()
    return {"id": str(rw.id), "status": "updated"}


@router.delete("/rewards/{reward_id}", dependencies=[_REQUIRE_MANAGER])
async def delete_reward(
    reward_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rw = await db.get(LoyaltyReward, reward_id)
    if not rw or rw.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Reward not found")
    await db.delete(rw)
    await db.commit()
    return {"status": "deleted"}


# ── Leaderboard ────────────────────────────────────────────────────────────
@router.get("/leaderboard", dependencies=[_REQUIRE_MANAGER])
async def leaderboard(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
):
    if not current_user.tenant_id:
        return {"items": []}
    r = await db.execute(
        select(LoyaltyAccountExt, PatientAccount)
        .join(PatientAccount, LoyaltyAccountExt.patient_id == PatientAccount.id)
        .where(LoyaltyAccountExt.tenant_id == current_user.tenant_id)
        .order_by(desc(LoyaltyAccountExt.points))
        .limit(limit)
    )
    items = []
    for acc, pa in r.all():
        items.append({
            "patient_id": str(pa.id),
            "patient_name": pa.name,
            "patient_phone": pa.phone,
            "points": acc.points,
            "tier": acc.tier,
            "total_spent": float(acc.total_spent or 0),
        })
    return {"items": items}


# ── Manual adjust ──────────────────────────────────────────────────────────
@router.post("/manual-adjust", dependencies=[_REQUIRE_MANAGER])
async def manual_adjust(
    body: AdjustIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.tenant_id:
        raise HTTPException(400, "No tenant")
    if not body.patient_id and not body.patient_phone:
        raise HTTPException(422, "patient_id или patient_phone обязателен")

    pa: PatientAccount | None = None
    if body.patient_id:
        pa = await db.get(PatientAccount, body.patient_id)
        # [#18] Линкуем пациента к тенанту менеджера (M2M), чтобы начисление
        # держало пациента в справочнике этой клиники.
        if pa is not None:
            await fs.link_patient_to_tenant(db, pa.id, current_user.tenant_id)
    else:
        # [#18] Изоляция: пациент — в рамках тенанта менеджера; create линкует.
        pa = await fs.get_account_by_phone(
            db, body.patient_phone, tenant_id=current_user.tenant_id
        )
        if not pa:
            pa, _ = await fs.get_or_create_account_by_phone(
                db, body.patient_phone, tenant_id=current_user.tenant_id
            )
    if not pa:
        raise HTTPException(404, "Patient not found")

    acc = await ls.get_or_create_account(db, current_user.tenant_id, pa)
    ev = await ls.adjust_points(
        db, acc, body.delta, body.reason, note=body.note,
    )
    await db.commit()
    return {
        "event_id": str(ev.id),
        "delta": ev.delta,
        "points_balance": acc.points,
        "tier": acc.tier,
    }


# ── Claims management ─────────────────────────────────────────────────────
@router.get("/claims", dependencies=[_REQUIRE_MANAGER])
async def list_claims(
    db: AsyncSession = Depends(get_db),
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
):
    if not current_user.tenant_id:
        return {"items": []}

    q = (
        select(LoyaltyClaim, LoyaltyReward, LoyaltyAccountExt, PatientAccount)
        .join(LoyaltyReward, LoyaltyClaim.reward_id == LoyaltyReward.id)
        .join(LoyaltyAccountExt, LoyaltyClaim.account_id == LoyaltyAccountExt.id)
        .join(PatientAccount, LoyaltyAccountExt.patient_id == PatientAccount.id)
        .where(LoyaltyAccountExt.tenant_id == current_user.tenant_id)
    )
    if status:
        q = q.where(LoyaltyClaim.status == status)
    q = q.order_by(desc(LoyaltyClaim.created_at)).limit(limit)

    r = await db.execute(q)
    items = []
    for claim, rw, acc, pa in r.all():
        items.append({
            "id": str(claim.id),
            "status": claim.status,
            "points_spent": claim.points_spent,
            "reward_id": str(rw.id),
            "reward_name": rw.name,
            "patient_id": str(pa.id),
            "patient_name": pa.name,
            "patient_phone": pa.phone,
            "created_at": claim.created_at.isoformat(),
            "delivered_at": claim.delivered_at.isoformat() if claim.delivered_at else None,
            "note": claim.note,
        })
    return {"items": items}


@router.patch("/claims/{claim_id}/status", dependencies=[_REQUIRE_MANAGER])
async def update_claim_status(
    claim_id: uuid.UUID,
    body: ClaimStatusIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    claim = await db.get(LoyaltyClaim, claim_id)
    if not claim:
        raise HTTPException(404, "Claim not found")
    # tenant check через account
    acc = await db.get(LoyaltyAccountExt, claim.account_id)
    if not acc or acc.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Claim not found")

    prev_status = claim.status
    claim.status = body.status
    if body.note:
        claim.note = body.note
    if body.status == "delivered" and not claim.delivered_at:
        claim.delivered_at = datetime.utcnow()

    # При cancelled — возвращаем points
    if body.status == "cancelled" and prev_status != "cancelled":
        await ls.adjust_points(
            db, acc, claim.points_spent, "manual_admin",
            note=f"Возврат за отмену награды claim {claim.id}",
        )

    await db.commit()
    return {"id": str(claim.id), "status": claim.status}


# ── Birthday batch ─────────────────────────────────────────────────────────
@router.post("/birthday-bonus-batch", dependencies=[_REQUIRE_MANAGER])
async def birthday_bonus_batch(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.tenant_id:
        raise HTTPException(400, "No tenant")
    n = await ls.run_birthday_batch(db, current_user.tenant_id)
    await db.commit()
    return {"awarded": n, "date": datetime.utcnow().date().isoformat()}
