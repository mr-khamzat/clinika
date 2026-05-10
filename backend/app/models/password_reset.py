"""Модель PasswordResetToken — токены сброса пароля.

Хранит SHA-256 хэш сгенерированного raw-токена (raw отдаётся пользователю по email),
TTL 1 час, флаг used_at для одноразовости. Используется в /auth/forgot-password
и /auth/reset-password.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # SHA-256 hex от raw_token (raw мы НЕ храним и НЕ логируем)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    requested_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
