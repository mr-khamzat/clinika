from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.bonus import Bonus, BonusStatus
from datetime import datetime
import uuid

async def mark_bonus_paid(db: AsyncSession, bonus_id: uuid.UUID) -> Bonus | None:
    result = await db.execute(select(Bonus).where(Bonus.id == bonus_id))
    bonus = result.scalar_one_or_none()
    if bonus and bonus.status == BonusStatus.PENDING:
        bonus.status = BonusStatus.PAID
        bonus.paid_at = datetime.utcnow()
        await db.commit()
        await db.refresh(bonus)
    return bonus
