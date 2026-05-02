"""Модель отзыва пациента."""
import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ReviewStatus(str, enum.Enum):
    PENDING  = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class Review(Base):
    __tablename__ = "reviews"

    id:             Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id:      Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True, unique=True)
    doctor_id:      Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("doctors.id", ondelete="SET NULL"), nullable=True, index=True)
    clinic_id:      Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="SET NULL"), nullable=True, index=True)
    patient_name:   Mapped[str | None]     = mapped_column(String(200), nullable=True)
    patient_phone:  Mapped[str | None]     = mapped_column(String(20), nullable=True, index=True)
    rating:         Mapped[int]            = mapped_column(SmallInteger, nullable=False)
    comment:        Mapped[str | None]     = mapped_column(Text, nullable=True)
    status:         Mapped[str]            = mapped_column(String(20), default=ReviewStatus.PENDING, nullable=False, index=True)
    moderator_id:   Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    moderated_at:   Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_anonymous:   Mapped[bool]           = mapped_column(Boolean, default=False, nullable=False)
    created_at:     Mapped[datetime]       = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at:     Mapped[datetime]       = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
