from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.models.user import User
from app.models.bonus import Bonus, BonusStatus
from app.models.referral import Referral, ReferralStatus
from app.schemas.bonus import BonusResponse, BonusSummary
from app.core.deps import get_current_user

router = APIRouter(prefix="/bonuses", tags=["bonuses"])

@router.get("/summary", response_model=BonusSummary)
async def get_bonus_summary(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    bonuses_result = await db.execute(select(Bonus).where(Bonus.admin_id == current_user.id))
    bonuses = bonuses_result.scalars().all()

    total_pending = sum(float(b.amount) for b in bonuses if b.status == BonusStatus.PENDING)
    total_paid = sum(float(b.amount) for b in bonuses if b.status == BonusStatus.PAID)

    refs_result = await db.execute(
        select(func.count()).where(Referral.created_by_admin_id == current_user.id)
    )
    total_referrals = refs_result.scalar() or 0

    confirmed_result = await db.execute(
        select(func.count()).where(
            Referral.created_by_admin_id == current_user.id,
            Referral.status == ReferralStatus.CONFIRMED
        )
    )
    confirmed_referrals = confirmed_result.scalar() or 0

    return BonusSummary(
        total_pending=total_pending,
        total_paid=total_paid,
        total_referrals=total_referrals,
        confirmed_referrals=confirmed_referrals
    )

@router.get("/", response_model=list[BonusResponse])
async def get_my_bonuses(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Bonus).where(Bonus.admin_id == current_user.id).order_by(Bonus.created_at.desc())
    )
    return result.scalars().all()
