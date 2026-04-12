# ===== БЛОК: Управление бонусами и отменами =====
# Выплата бонусов, запросы на отмену направлений.
# /manager/bonuses/*, /manager/cancel-requests/*

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.models.user import User
from app.models.referral import Referral, ReferralStatus
from app.models.bonus import Bonus, BonusStatus
from app.models.clinic import Clinic
from app.models.service import Service
from app.schemas.manager import MarkPaidResponse
from app.services.activity_service import log_activity
from app.services import audit_service
from app.services.audit_service import AuditAction

router = APIRouter(tags=["manager:bonuses"])


@router.patch("/bonuses/{bonus_id}/mark-paid", response_model=MarkPaidResponse)
async def mark_bonus_paid(
    bonus_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Bonus).where(Bonus.id == bonus_id))
    bonus = result.scalar_one_or_none()
    if not bonus:
        raise HTTPException(status_code=404, detail="Бонус не найден")
    if bonus.status == BonusStatus.PAID:
        raise HTTPException(status_code=400, detail="Бонус уже оплачен")
    before = {status: bonus.status, amount: float(bonus.amount)}
    bonus.status = BonusStatus.PAID
    bonus.paid_at = datetime.utcnow()
    await audit_service.write_safe(db, AuditAction.BONUS_PAID,
        actor_id=current_user.id, actor_name=current_user.full_name,
        entity_type=bonus, entity_id=bonus.id,
        before=before, after={status: PAID, amount: float(bonus.amount)},
    )
    await db.commit()
    await db.refresh(bonus)
    return bonus


@router.post("/bonuses/mark-paid-all/{admin_id}")
async def mark_all_paid(
    admin_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Bonus).where(Bonus.admin_id == admin_id, Bonus.status == BonusStatus.PENDING))
    bonuses = result.scalars().all()
    if not bonuses:
        raise HTTPException(status_code=404, detail="Нет ожидающих бонусов")
    now = datetime.utcnow()
    for b in bonuses:
        b.status = BonusStatus.PAID
        b.paid_at = now
    await log_activity(db, current_user, f"Выплата бонусов ({len(bonuses)} шт.)", "bonus", admin_id)
    await db.commit()
    return {"marked_paid": len(bonuses)}


@router.get("/cancel-requests/", response_model=list[dict])
async def list_cancel_requests(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Referral).where(Referral.status == ReferralStatus.CANCEL_REQUESTED)
        .order_by(Referral.cancel_requested_at.desc())
    )
    referrals = result.scalars().all()
    items = []
    for r in referrals:
        creator = (await db.execute(select(User).where(User.id == r.created_by_admin_id))).scalar_one_or_none()
        from_c = (await db.execute(select(Clinic).where(Clinic.id == r.from_clinic_id))).scalar_one_or_none() if r.from_clinic_id else None
        to_c = (await db.execute(select(Clinic).where(Clinic.id == r.to_clinic_id))).scalar_one_or_none()
        svc = (await db.execute(select(Service).where(Service.id == r.service_id))).scalar_one_or_none()
        items.append({
            "id": str(r.id), "patient_phone": r.patient_phone,
            "service_name": svc.name if svc else None,
            "from_clinic_name": from_c.name if from_c else None,
            "to_clinic_name": to_c.name if to_c else None,
            "created_by_name": creator.full_name if creator else None,
            "cancel_reason": r.cancel_reason,
            "cancel_requested_at": r.cancel_requested_at.isoformat() if r.cancel_requested_at else None,
            "created_at": r.created_at.isoformat(), "status": r.status,
        })
    return items


@router.post("/cancel-requests/{referral_id}/approve")
async def approve_cancel(
    referral_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Referral).where(Referral.id == referral_id))
    referral = result.scalar_one_or_none()
    if not referral or referral.status != ReferralStatus.CANCEL_REQUESTED:
        raise HTTPException(status_code=404, detail="Запрос не найден")
    referral.status = ReferralStatus.CANCELLED
    referral.cancelled_at = datetime.utcnow()
    referral.cancelled_by_id = current_user.id
    bonus_res = await db.execute(select(Bonus).where(Bonus.referral_id == referral_id))
    for bonus in bonus_res.scalars().all():
        await db.delete(bonus)
    await log_activity(db, current_user, "Отмена направления подтверждена", "referral", referral_id)
    await db.commit()
    return {"status": "cancelled"}


@router.post("/cancel-requests/{referral_id}/reject")
async def reject_cancel(
    referral_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Referral).where(Referral.id == referral_id))
    referral = result.scalar_one_or_none()
    if not referral or referral.status != ReferralStatus.CANCEL_REQUESTED:
        raise HTTPException(status_code=404, detail="Запрос не найден")
    bonus = (await db.execute(select(Bonus).where(Bonus.referral_id == referral_id).limit(1))).scalars().first()
    referral.status = ReferralStatus.CONFIRMED if bonus else ReferralStatus.CREATED
    referral.cancel_reason = None
    referral.cancel_requested_at = None
    await db.commit()
    return {"status": "rejected"}
