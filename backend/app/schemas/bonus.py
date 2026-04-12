from pydantic import BaseModel
from datetime import datetime
from uuid import UUID
from app.models.bonus import BonusStatus, BonusType

class BonusResponse(BaseModel):
    id: UUID
    admin_id: UUID
    referral_id: UUID
    bonus_type: BonusType = BonusType.REGULAR
    amount: float
    status: BonusStatus
    created_at: datetime
    paid_at: datetime | None = None

    class Config:
        from_attributes = True

class BonusSummary(BaseModel):
    total_pending: float
    total_paid: float
    total_referrals: int
    confirmed_referrals: int
