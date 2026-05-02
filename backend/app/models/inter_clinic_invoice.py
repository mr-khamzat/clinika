"""
Межклиничный счёт — финансовый документ между клиниками одного или разных тенантов.
Используется для расчётов по реферальным бонусам и ручных выставлений счетов.
"""
import uuid
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import String, DateTime, Date, ForeignKey, Text, Numeric, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class ICIStatus:
    DRAFT     = "draft"      # создан, не отправлен
    SENT      = "sent"       # отправлен получателю
    PAID      = "paid"       # оплачен
    CANCELLED = "cancelled"  # отменён


class ICIType:
    REFERRAL_BONUS = "referral_bonus"  # автоматически при подтверждении направления
    MANUAL         = "manual"          # вручную менеджером
    ROYALTY        = "royalty"         # роялти франшизы
    CORRECTION     = "correction"      # корректировка


class InterClinicInvoice(Base):
    """Счёт между клиниками (межклиничные расчёты)."""
    __tablename__ = "inter_clinic_invoices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    invoice_number: Mapped[str] = mapped_column(String(60), unique=True, nullable=False, index=True)

    # Кто выставил (получатель денег)
    issuer_clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="SET NULL"), nullable=True, index=True
    )
    issuer_tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Кому выставлен (плательщик)
    recipient_clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="SET NULL"), nullable=True, index=True
    )
    recipient_tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )

    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    invoice_type: Mapped[str] = mapped_column(String(30), default=ICIType.MANUAL, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), default=ICIStatus.DRAFT, nullable=False, index=True)

    # Связь с направлением (если автогенерация)
    referral_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("referrals.id", ondelete="SET NULL"), nullable=True, index=True
    )

    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("ix_ici_issuer_tenant", "issuer_tenant_id", "status"),
        Index("ix_ici_recipient_tenant", "recipient_tenant_id", "status"),
    )
