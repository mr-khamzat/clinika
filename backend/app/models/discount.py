"""
========================================
БЛОК: Модель скидок
========================================
Скидки — независимый модуль. Не уменьшают бонусы.
Применяются к стоимости услуг для пациентов.

Привязка (applies_to):
  'all'     — ко всем услугам
  'service' — к конкретной услуге (service_id)
  'clinic'  — к клинике (clinic_id)

Расширение: добавить привязку к:
  - категории пациента
  - дню недели / времени суток
  - промо-коду
========================================
"""
import uuid
import enum
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, DateTime, Boolean, ForeignKey, Enum as SAEnum, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class DiscountType(str, enum.Enum):
    PERCENT = "percent"   # % от стоимости (например, 10%)
    FIXED = "fixed"       # Фиксированная сумма (например, 500 ₽)


class Discount(Base):
    __tablename__ = "discounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # ─── Основные параметры скидки ───
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    discount_type: Mapped[str] = mapped_column(String(20), nullable=False, default="percent")  # percent | fixed
    discount_value: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)  # 10.00 или 500.00

    # ─── Привязка скидки ───
    applies_to: Mapped[str] = mapped_column(String(20), nullable=False, default="all")  # all | service | clinic
    service_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("services.id"), nullable=True)
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id"), nullable=True)

    # ─── Управление активностью ───
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    valid_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # ─── Метаданные ───
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # ─── Связи ───
    service: Mapped["Service"] = relationship("Service", foreign_keys=[service_id])
    clinic: Mapped["Clinic"] = relationship("Clinic", foreign_keys=[clinic_id])
