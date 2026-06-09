"""NPS-опрос пациента после закрытия thread'а.

Создаётся автоматически при закрытии чат-треда (status='closed').
Связывается с thread_id (1:1). Пациент отвечает через /patient/nps/{id}/answer.
Отличается от nps_responses (модель NpsResponse в engagement.py), которая
привязана к appointment_id и общему NPS-опросу — здесь именно chat-thread NPS.
"""
import uuid
from datetime import datetime
from sqlalchemy import Integer, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class NPSSurvey(Base):
    __tablename__ = "nps_surveys"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True
    )
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="SET NULL"), nullable=True
    )
    patient_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    thread_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True, unique=True)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0..10
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
