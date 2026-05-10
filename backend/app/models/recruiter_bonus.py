import uuid
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Enum as SAEnum, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
import enum
from app.database import Base


class RecruiterBonusStatus(str, enum.Enum):
    PENDING = "pending"
    PAID = "paid"
    # Фикс #4 (audit Фаза 1): отмена начисления рекрутера при отмене направления.
    CANCELLED = "cancelled"


class RecruiterBonus(Base):
    """Бонус рекрутера — % от бонуса привлечённого им врача."""
    __tablename__ = "recruiter_bonuses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True)
    recruiter_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    doctor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    referral_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("referrals.id", ondelete="CASCADE"), nullable=False)
    source_bonus_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("bonuses.id", ondelete="SET NULL"), nullable=True)
    # % который был у рекрутера на момент начисления
    percent_applied: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    # Итоговая сумма начисления рекрутеру
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    status: Mapped[RecruiterBonusStatus] = mapped_column(SAEnum(RecruiterBonusStatus, values_callable=lambda x: [e.value for e in x]), default=RecruiterBonusStatus.PENDING)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    recruiter: Mapped["User"] = relationship("User", foreign_keys=[recruiter_id])
    doctor: Mapped["User"] = relationship("User", foreign_keys=[doctor_id])
