"""
Модель присутствия пользователей и настроек звонков.
Этап 15 — P2P звонки с ролями и статусами.
"""
import uuid
import enum
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.database import Base


class PresenceStatus(str, enum.Enum):
    ONLINE   = "online"    # На месте, доступен
    AWAY     = "away"      # Не на месте (ушёл на время)
    BUSY     = "busy"      # Занят (в звонке / на приёме)
    OFFLINE  = "offline"   # Не в системе


class UserPresence(Base):
    """Статус присутствия пользователя — обновляется при каждом действии."""
    __tablename__ = "user_presence"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True
    )
    status: Mapped[PresenceStatus] = mapped_column(
        String(20), nullable=False, default=PresenceStatus.OFFLINE
    )
    # Кастомный статус-текст (например "На обеде", "Вернусь через час")
    status_text: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Автоматически → OFFLINE если не было активности N минут
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CallPermission(Base):
    """
    Матрица разрешений на звонки: from_role → to_role.
    Хранится per-tenant.
    """
    __tablename__ = "call_permissions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True
    )
    from_role: Mapped[str] = mapped_column(String(50), nullable=False)  # admin, manager, partner, doctor
    to_role: Mapped[str] = mapped_column(String(50), nullable=False)
    can_call: Mapped[bool] = mapped_column(Boolean, default=True)
    can_video: Mapped[bool] = mapped_column(Boolean, default=False)
    # Ограничение: только одна клиника (False = вся сеть)
    same_clinic_only: Mapped[bool] = mapped_column(Boolean, default=False)


class NotificationSetting(Base):
    """
    Настройки уведомлений per-tenant per-role.
    Хранит JSON с событиями и каналами.
    """
    __tablename__ = "notification_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True
    )
    role: Mapped[str] = mapped_column(String(50), nullable=False)  # admin, manager, partner
    # Какие события слать (JSON массив строк)
    events: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    # Каналы: {"sms": true, "telegram": true, "push": false}
    channels: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CallLog(Base):
    """Лог звонков между пользователями."""
    __tablename__ = "call_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True
    )
    caller_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    callee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # missed / answered / rejected / busy
    outcome: Mapped[str] = mapped_column(String(20), nullable=False, default="missed")
    duration_sec: Mapped[int | None] = mapped_column(nullable=True)  # секунды разговора
    call_type: Mapped[str] = mapped_column(String(10), nullable=False, default="audio")  # audio / video
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
