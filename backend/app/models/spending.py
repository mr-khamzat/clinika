"""
Модель Spending — расходы клиники (модуль бухгалтерии, Phase 3).

Категории: rent / lab / materials / marketing / utilities / other.
paid_at = NULL — ещё не оплачено; не-NULL — дата оплаты.
"""
import uuid
from datetime import datetime, date
from decimal import Decimal

from sqlalchemy import (
    String, DateTime, Date, ForeignKey, Numeric, Text, Boolean,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SpendingCategory:
    RENT       = "rent"
    LAB        = "lab"
    MATERIALS  = "materials"
    MARKETING  = "marketing"
    UTILITIES  = "utilities"
    OTHER      = "other"


class Spending(Base):
    __tablename__ = "spendings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    category: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    paid_at:  Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
