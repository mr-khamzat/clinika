"""
Модель read receipts (галочки ✓/✓✓) для StaffChat.

StaffChatMessageRead — факт прочтения конкретного сообщения конкретным
пользователем. UNIQUE(message_id, user_id) гарантирует идемпотентность
upsert'а (один пользователь читает сообщение один раз).

Создаётся через POST /staff-chat/rooms/{room_id}/mark-read, тригерится из
UI по IntersectionObserver (только реально просмотренные сообщения).

Для bulk-операций обычно проще делать INSERT ... ON CONFLICT DO NOTHING
вместо итерации по объектам.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class StaffChatMessageRead(Base):
    __tablename__ = "staff_chat_message_reads"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("staff_chat_messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    read_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_staff_chat_message_reads_pair"),
        Index("ix_staff_chat_message_reads_message_id", "message_id"),
        Index("ix_staff_chat_message_reads_user_id", "user_id"),
    )
