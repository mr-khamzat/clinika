import uuid
from datetime import datetime, date
from sqlalchemy import Integer, Date, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class KpiTarget(Base):
    __tablename__ = "kpi_targets"
    __table_args__ = (UniqueConstraint("admin_id", "month", name="uq_kpi_admin_month"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    admin_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    month: Mapped[date] = mapped_column(Date, nullable=False)
    target_referrals: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    target_confirmed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    admin: Mapped["User"] = relationship("User")
