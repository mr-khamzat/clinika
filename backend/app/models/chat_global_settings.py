"""
Глобальные настройки чата (Phase 2 — /admin/chat-settings).

Хранится единственная запись (одна на тенант). Если записи нет — используются
дефолтные значения из ENV / констант.

Поля:
  file_ttl_hours        — сколько хранить файлы (по умолчанию 48)
  max_file_mb           — лимит размера файла (по умолчанию 50)
  inter_clinic_allowed  — разрешать ли чаты между сотрудниками разных клиник
                           одного тенанта (по умолчанию True)
  tg_notifications_enabled — отправлять ли TG-уведомления вообще
  tg_notify_super_admin    — нотифицировать super_admin при сообщениях
  tg_notify_franchise_owner — нотифицировать franchise_owner
  patient_chat_tg_enabled  — нотифицировать TG при патиентских сообщениях
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, Integer, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ChatGlobalSettings(Base):
    __tablename__ = "chat_global_settings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=True, unique=True, index=True,
    )
    file_ttl_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=48)
    max_file_mb: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    inter_clinic_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    tg_notifications_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    tg_notify_super_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    tg_notify_franchise_owner: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    patient_chat_tg_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow,
        nullable=False,
    )
