"""
Глава 9 — Календарь пациента: токены для iCal-feed (Google/Apple Calendar).

Пациент создаёт уникальный токен, подписывается в календаре по URL
  https://app.клиниксеть.рф/patient/calendar/feed.ics?token=<token>
и календарь сам обновляется (4-week look-ahead).
"""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class PatientCalendarToken(Base):
    __tablename__ = "patient_calendar_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_accounts.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    token: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
