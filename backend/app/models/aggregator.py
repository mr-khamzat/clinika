"""
Глава 10 — Партнёрская программа агрегаторам (DocDoc, ProDoctorov, ...).

AggregatorPartnership — оформленное партнёрство с агрегатором (включая API-ключ хэш).
AggregatorLead        — входящий лид (звонок/запись), который агрегатор присылает.
"""
import uuid
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import String, DateTime, Date, ForeignKey, Numeric
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class AggregatorPartnership(Base):
    __tablename__ = "aggregator_partnerships"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # docdoc | prodoctorov | yandex_health | other
    partner_name: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    # sha256 от исходного API key (64 hex символа)
    api_key_hash: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    # Префикс плейн-key для отображения (последний раз показывается при создании)
    key_prefix: Mapped[str | None] = mapped_column(String(16), nullable=True)
    commission_pct: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("0.00"), server_default="0.00"
    )
    # active | suspended | terminated
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", server_default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )


class AggregatorLead(Base):
    __tablename__ = "aggregator_leads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    partnership_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("aggregator_partnerships.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    patient_phone: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    patient_full_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    service_requested: Mapped[str | None] = mapped_column(String(200), nullable=True)
    desired_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # received | contacted | scheduled | completed | lost
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="received", server_default="received", index=True
    )
    commission_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("appointments.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
