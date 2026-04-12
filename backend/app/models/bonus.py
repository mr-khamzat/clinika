import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Enum as SAEnum, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
import enum
from app.database import Base


class BonusStatus(str, enum.Enum):
    PENDING = "pending"
    PAID = "paid"


class BonusType(str, enum.Enum):
    REGULAR = "regular"
    COMMISSION = "commission"


class Bonus(Base):
    __tablename__ = "bonuses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True)
    admin_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    referral_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("referrals.id"), nullable=False, index=True)
    bonus_type: Mapped[BonusType] = mapped_column(
        SAEnum(BonusType, values_callable=lambda x: [e.value for e in x]),
        default=BonusType.REGULAR, nullable=False
    )
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    status: Mapped[BonusStatus] = mapped_column(SAEnum(BonusStatus), default=BonusStatus.PENDING)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    admin: Mapped["User"] = relationship("User", back_populates="bonuses")
    referral: Mapped["Referral"] = relationship("Referral", back_populates="bonus")
