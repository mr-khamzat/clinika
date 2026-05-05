"""Счета от платформы к франшизе. Накапливаются периодически по billing_period_days."""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, Numeric, Integer, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class InvoiceStatus:
    PENDING = "pending"
    PAID = "paid"
    CANCELLED = "cancelled"


class FranchiseInvoice(Base):
    __tablename__ = "franchise_invoices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    franchise_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("franchises.id", ondelete="CASCADE"), nullable=False, index=True
    )
    number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    period_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    bonuses_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=InvoiceStatus.PENDING)
    due_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )
