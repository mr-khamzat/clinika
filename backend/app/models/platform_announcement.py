"""
Платформенные объявления — super_admin отправляет всем активным
сотрудникам всех тенантов (через центр уведомлений NotificationsBell).

Пример: «Завтра в 02:00 техобслуживание», «Вышло обновление 1.0.18».
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import String

from app.database import Base


class PlatformAnnouncement(Base):
    __tablename__ = "platform_announcements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    # info | warning | critical
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="info", server_default="info")
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow,
        server_default=text("CURRENT_TIMESTAMP"), index=True,
    )
    # null = бессрочно, иначе исчезает после этой даты
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    # Soft-delete (отозвать)
    revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
