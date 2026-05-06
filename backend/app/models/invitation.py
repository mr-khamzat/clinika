import uuid
import secrets
from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class Invitation(Base):
    __tablename__ = "invitations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Старое поле — для обратной совместимости (партнёрские ссылки)
    code: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False,
        default=lambda: secrets.token_urlsafe(16)
    )
    # Email которому отправлено приглашение (для врачей от рекрутера)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id"), nullable=True)
    role: Mapped[str] = mapped_column(String(30), nullable=False, default="partner_doctor")
    invited_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # Рекрутер-владелец (заполняется когда рекрутер приглашает врача)
    recruiter_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    # Список clinic_id к которым врач получит доступ (JSON array of UUID strings)
    clinic_access: Mapped[list | None] = mapped_column(JSON, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    max_uses: Mapped[int] = mapped_column(Integer, default=100)
    uses_count: Mapped[int] = mapped_column(Integer, default=0)
    is_used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    clinic: Mapped["Clinic | None"] = relationship("Clinic", foreign_keys=[clinic_id])
    invited_by: Mapped["User"] = relationship("User", foreign_keys=[invited_by_id])
    recruiter: Mapped["User | None"] = relationship("User", foreign_keys=[recruiter_id])
