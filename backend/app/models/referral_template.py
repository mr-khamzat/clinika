"""
Модель ReferralTemplate — шаблон направления.

Глава 4 (mgr_templates01): менеджер сохраняет частые комбинации
(врач, услуги, заметки, приоритет) как шаблон и применяет одним кликом
из формы создания направления. Шаблон может быть привязан к клинике
(clinic_id) или быть общим для всего тенанта (clinic_id NULL).

Поля payload (JSONB):
  target_doctor_id : UUID | None
  service_ids      : list[UUID]
  notes            : str | None
  priority         : "normal" | "high" | "urgent"
  referral_type    : "service" | "doctor" | "lab"
  lab_tests        : str | None
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class ReferralTemplate(Base):
    __tablename__ = "referral_templates"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # NULL = шаблон видим всем клиникам tenant'а
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clinics.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Полная заготовка для применения в форме создания направления
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # Счётчик использований (инкрементится в POST /use)
    usage_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
