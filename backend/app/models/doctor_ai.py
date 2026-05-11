"""
Модели Главы 6: «Врач AI».

- TreatmentPlan — структурированный план лечения (черновик / утверждён / в архиве).
  Создаётся доктором вручную либо генерируется AI (Gemini), редактируется,
  затем утверждается и может быть скопирован в карту пациента.
- AIDoctorLog — журнал AI-вызовов из кабинета врача (briefing, treatment plan).
  Используется для контроля затрат и аналитики качества.
- DirectBill — прямой счёт от visiting_doctor / partner_doctor пациенту
  (или связанной клинике). Поддерживает черновик → отправлен → оплачен
  → отменён, со списком услуг в JSONB и расчётом скидки.

Все модели тенантны (tenant_id). Поля и индексы — см. миграцию `doctor_ai01`.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import String, DateTime, Boolean, ForeignKey, Integer, Numeric, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


# ─────────────────────────────────────────────────────────────────────
# TreatmentPlan
# ─────────────────────────────────────────────────────────────────────
class TreatmentPlanStatus:
    DRAFT    = "draft"
    APPROVED = "approved"
    ARCHIVED = "archived"


class TreatmentPlan(Base):
    """Структурированный план лечения, привязанный к приёму (опционально)."""
    __tablename__ = "treatment_plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    patient_phone: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    doctor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Полная структура плана (JSON) — см. AI-схему в ai_service.generate_treatment_plan
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=TreatmentPlanStatus.DRAFT, index=True)
    ai_provider: Mapped[str | None] = mapped_column(String(20), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )


# ─────────────────────────────────────────────────────────────────────
# AIDoctorLog
# ─────────────────────────────────────────────────────────────────────
class AIDoctorLog(Base):
    """Журнал AI-вызовов из кабинета врача (для аудита и расчёта расхода)."""
    __tablename__ = "ai_doctor_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    doctor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True
    )
    # 'briefing' | 'treatment_plan' | ...
    action: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ai_provider: Mapped[str] = mapped_column(String(20), nullable=False, default="rule-based")
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


# ─────────────────────────────────────────────────────────────────────
# DirectBill — прямой счёт visiting/partner doctor
# ─────────────────────────────────────────────────────────────────────
class DirectBillStatus:
    DRAFT     = "draft"
    SENT      = "sent"
    PAID      = "paid"
    CANCELLED = "cancelled"


class DirectBillPaymentMethod:
    CASH     = "cash"
    CARD     = "card"
    TRANSFER = "transfer"


class DirectBill(Base):
    """Прямой счёт от visiting/partner-доктора пациенту или клинике."""
    __tablename__ = "direct_bills"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    doctor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="SET NULL"), nullable=True, index=True
    )
    patient_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    patient_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    inter_clinic_invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("inter_clinic_invoices.id", ondelete="SET NULL"), nullable=True
    )
    # [{"name": "Консультация", "price": 3500, "qty": 1}, ...]
    services: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    discount_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=Decimal("0"))
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=DirectBillStatus.DRAFT, index=True)
    payment_method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    bill_number: Mapped[str | None] = mapped_column(String(40), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )
