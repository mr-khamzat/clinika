"""
Чат сотрудник↔сотрудник (StaffChat) — отдельный от пациентского чата.

Модели:
  StaffChatRoom    — комната (direct 1-1 / clinic-room / custom group / broadcast)
  StaffChatMember  — участник комнаты (с read-state и mute)
  StaffChatMessage — сообщение в комнате

RBAC видимости (см. services/staff_chat_service.visible_users_for):
  - super_admin / franchise_owner / admin / manager → все пользователи тенанта
  - doctor → свои клиники (через doctor_clinic_access) + менеджеры/админы тенанта
  - reg, nurse → своя клиника
  - recruiter → все пользователи тенанта (HR-функция)
  - partner_doctor / visiting_doctor → ограниченный круг (свои клиники)
  - patient → нет доступа (для пациентов отдельная инфраструктура)

Inter-clinic: ТОЛЬКО в рамках одной франшизы (один tenant_id).
Межфраншизный чат не разрешён по умолчанию.
"""
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    String, Boolean, Integer, DateTime, ForeignKey, Text, UniqueConstraint, Index,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


# Допустимые типы комнат
ROOM_TYPE_DIRECT = "direct"        # 1-1 личный чат между двумя сотрудниками
ROOM_TYPE_CLINIC = "clinic"        # общий чат клиники (все сотрудники клиники)
ROOM_TYPE_GROUP = "group"          # кастомная группа (произвольный набор)
ROOM_TYPE_BROADCAST = "broadcast"  # объявление от admin (read-only для участников)


class StaffChatRoom(Base):
    __tablename__ = "staff_chat_rooms"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # direct | clinic | group | broadcast
    type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    # Название (для group/broadcast). Для direct автогенерится из ФИО участников.
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Для type=clinic — ссылка на конкретную клинику (общий чат)
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clinics.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Описание канала (для type=channel/group). Только для каналов.
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_message_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow,
        nullable=False,
    )


class StaffChatMember(Base):
    __tablename__ = "staff_chat_members"

    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("staff_chat_rooms.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # member | admin (admin может добавлять/удалять участников группы)
    member_role: Mapped[str] = mapped_column(String(10), nullable=False, default="member")
    last_read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    muted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_staff_chat_members_user_id", "user_id"),
    )


class StaffChatFile(Base):
    """Файл-вложение к чату. TTL 48 часов: после `expires_at` файл удаляется
    джобом cleanup_staff_chat_files. Имя на диске — `{uuid}_{filename}`.
    Доступ к скачиванию проверяется по членству в комнате.
    """
    __tablename__ = "staff_chat_files"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("staff_chat_rooms.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    filename: Mapped[str] = mapped_column(String(300), nullable=False)
    mime: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )


class StaffChatMessage(Base):
    __tablename__ = "staff_chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("staff_chat_rooms.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    sender_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # [{filename, url, size, mime}]
    attachments: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    reply_to_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("staff_chat_messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Список user_id (как строки) — кого упомянули через @username (резолв уже сделан)
    mentioned_user_ids: Mapped[Any] = mapped_column(
        JSONB, default=list, server_default='[]', nullable=False
    )
    # Закрепление (Slack-pin). pinned_at IS NOT NULL → сообщение закреплено
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pinned_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True
    )

    __table_args__ = (
        Index("ix_staff_chat_messages_room_created", "room_id", "created_at"),
    )


class StaffChatMessageReaction(Base):
    """Реакция (emoji) пользователя на сообщение. Уникальный ключ
    (message_id, user_id, emoji) — один user может оставить только одну
    реакцию каждого emoji на одно сообщение."""
    __tablename__ = "staff_chat_message_reactions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("staff_chat_messages.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    emoji: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
