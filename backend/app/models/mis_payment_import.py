"""
MisPaymentImport — дедупликация платежей, импортированных из МИС в нашу кассу/ledger.

Сохраняем (mis_payment_id, mis_clinic_id) как уникальный ключ — гарантия что один
платёж не попадёт дважды в кассовую смену.

Связь с приёмом — через mis_invoice_id (если МИС вернул его), но это лишь
для отчётности — основной gate дедупликации это (mis_payment_id, clinic_id).
"""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import String, DateTime, ForeignKey, Numeric, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MisPaymentImport(Base):
    __tablename__ = "mis_payment_imports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # Айдишник клиники в самой МИС (integer) — для дедупа
    mis_clinic_id: Mapped[int] = mapped_column(Integer, nullable=False)
    # Айдишник платежа в МИС
    mis_payment_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # Айдишник счёта в МИС (для связи с услугами/инвойсом)
    mis_invoice_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    method: Mapped[str] = mapped_column(String(20), nullable=False)  # cash | card | other
    paid_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    # Связь с CashShiftEntry (если cash) — для возможности откатить sync
    shift_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cash_shift_entries.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Связь с LedgerEntry (если card/other)
    ledger_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ledger_entries.id", ondelete="SET NULL"),
        nullable=True,
    )

    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("mis_clinic_id", "mis_payment_id", name="uq_mis_payment_unique"),
    )
