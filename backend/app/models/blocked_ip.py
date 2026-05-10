"""
BlockedIp — ручная блокировка IP-адреса (Журнал безопасности).

Запись создаётся super_admin'ом из UI «Безопасность». Middleware
BlockIpMiddleware проверяет каждый входящий запрос против активных
записей и отвергает с 403, если IP заблокирован и blocked_until ещё
не наступил.

Никакой автоматики (rate-limiter и Region Lock — отдельные системы),
эта таблица — только для ручных блокировок super_admin.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BlockedIp(Base):
    __tablename__ = "blocked_ips"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    ip: Mapped[str] = mapped_column(String(45), nullable=False, index=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    blocked_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    blocked_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    blocked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
