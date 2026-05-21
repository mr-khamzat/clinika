"""
chatslot01: outbox-таблица для отложенных вызовов в МИС.

Используется когда МИС недоступен (5xx) или для будущего MIS replacement plan.
patient_identifier пишет сюда задачи add_patient/update_patient,
slot_booking_service — appointment.create/update/cancel.

Worker (отдельная фича) забирает rows со status='pending' и next_retry_at <= now(),
вызывает MIS, при успехе ставит status='sent', при 5xx — увеличивает attempt_count
и сдвигает next_retry_at по exp.backoff.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.database import Base


class MisOutbox(Base):
    __tablename__ = "mis_outbox"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # 'patient.create' | 'patient.update' | 'appointment.create' | 'appointment.update' | 'appointment.cancel'
    event_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    # Полезная нагрузка для вызова — зависит от event_type
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # 'pending' | 'sent' | 'failed' | 'manual_required'
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending", index=True
    )
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    next_retry_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, index=True
    )
    last_error: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
