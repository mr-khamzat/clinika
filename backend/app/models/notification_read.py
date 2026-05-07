"""
Таблица — какие уведомления (audit/activity/contact события) пользователь
прочитал. Источник «прочитанности» для центра уведомлений в шапке кабинетов.
audit_log — append-only, поэтому прочитанность хранится в отдельной таблице.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class NotificationRead(Base):
    __tablename__ = "notification_reads"
    __table_args__ = (
        UniqueConstraint("user_id", "kind", "source_id", name="uq_notif_read"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Источник: 'audit' | 'activity' | 'contact'
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # ID исходного события (audit_log.id, activity_log.id, contact_requests.id)
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
