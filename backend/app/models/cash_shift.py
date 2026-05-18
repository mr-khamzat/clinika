"""
Модели кассовой смены клиники (модуль бухгалтерии).

CashShift — открытая/закрытая смена кассы клиники. В каждой клинике
одновременно может быть открыта только одна смена (DB-инвариант через
partial unique index по clinic_id WHERE status='open').

CashShiftEntry — операции внутри смены (приход/расход). Содержит
direction (in/out) и category (sale/refund/expense/incassation/other).

Z-отчёт собирается по закрытии: expected = cash_start + sum(in) - sum(out).
discrepancy = cash_end_actual - expected.
"""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    String, DateTime, ForeignKey, Numeric, Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CashShiftStatus:
    OPEN = "open"
    CLOSED = "closed"


class CashShiftEntryDirection:
    IN = "in"
    OUT = "out"


class CashShiftEntryCategory:
    SALE         = "sale"         # приход — оплата пациентом услуги/приёма
    REFUND       = "refund"       # расход — возврат пациенту
    SALARY       = "salary"       # расход — выплата зарплаты/бонуса
    EXPENSE      = "expense"      # расход — хоз. расходы (вода, материалы, проч.)
    INCASSATION  = "incassation"  # расход — инкассация (вывоз наличных в банк)
    ADJUSTMENT   = "adjustment"   # коррекция (учёт расхождений)
    OTHER        = "other"


class CashShift(Base):
    __tablename__ = "cash_shifts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    opened_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,  # SET NULL если пользователь удалён
    )
    opened_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    cash_start: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), nullable=False)

    closed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cash_end_actual: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    cash_end_expected: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    discrepancy: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default=CashShiftStatus.OPEN, nullable=False, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class CashShiftEntry(Base):
    __tablename__ = "cash_shift_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    shift_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cash_shifts.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    direction: Mapped[str] = mapped_column(String(10), nullable=False)  # 'in' | 'out'
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)  # модуль, всегда положительный
    category: Mapped[str] = mapped_column(String(40), nullable=False, index=True)

    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    reference_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
