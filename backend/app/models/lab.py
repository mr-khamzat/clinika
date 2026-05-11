"""
Глава 10 — Лаборатория-интеграция.

Модели:
  LabProvider  — справочник лабораторий тенанта (Гемотест, Инвитро, KDL, ...)
  LabOrder     — заявка на анализ (отправляется в лабораторию, потом приходит результат)
  LabResult    — отдельный результат анализа (по тест-коду)
"""
import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class LabProvider(Base):
    __tablename__ = "lab_providers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # gemotest | invitro | kdl | citilab | generic_http
    provider_type: Mapped[str] = mapped_column(String(40), nullable=False)
    api_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Зашифрованный API-ключ (через secrets_service если есть; иначе fallback к plaintext).
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, server_default="true")
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class LabOrder(Base):
    __tablename__ = "lab_orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("patient_accounts.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    doctor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("doctors.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lab_providers.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    external_order_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    # JSONB array of test codes
    test_codes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # created | sent | in_progress | results_ready | delivered | cancelled | error
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="created", index=True)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    results_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    results: Mapped[list["LabResult"]] = relationship(
        "LabResult", back_populates="order", cascade="all, delete-orphan"
    )


class LabResult(Base):
    __tablename__ = "lab_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lab_orders.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    test_code: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    test_name: Mapped[str] = mapped_column(String(200), nullable=False)
    value: Mapped[str | None] = mapped_column(String(120), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    reference_range: Mapped[str | None] = mapped_column(String(120), nullable=True)
    flagged: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    result_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    raw_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )

    order: Mapped["LabOrder"] = relationship("LabOrder", back_populates="results")
