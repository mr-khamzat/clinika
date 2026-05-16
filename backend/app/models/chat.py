"""
Глава 9 — Асинхронный чат пациент↔клиника.

ChatThread:
  открытый/закрытый тред между пациентом и конкретной клиникой;
  опционально назначен врач (assigned_doctor_id).
ChatMessage:
  сообщение в треде. sender_type определяет тип отправителя.

Логика:
  - без подписки health_plus: пациент может отправить максимум 3 msg/мес;
  - с подпиской: безлимит.
"""
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    String, Integer, DateTime, ForeignKey, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class ChatThread(Base):
    __tablename__ = "chat_threads"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clinics.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_accounts.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    subject: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # open | closed | archived
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="open", index=True
    )
    assigned_doctor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_message_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    unread_for_patient: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unread_for_clinic: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow,
        nullable=False,
    )
    # Quick Wins: индикатор "печатает..." (последний пинг от каждой стороны).
    # Фронт показывает индикатор если timestamp < 7 сек назад.
    last_typing_at_clinic: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_typing_at_patient: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Quick Wins #3: закрепление треда в списке клиники.
    # NULL = не запиннен. Запиннятые сортируются первыми (pinned_at DESC).
    pinned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True,
    )
    # Quick Wins #4: цветовая метка для визуальной приоритизации в списке.
    # Допустимые значения: 'red' / 'yellow' / 'green' / 'blue' или NULL.
    color_label: Mapped[str | None] = mapped_column(
        String(20), nullable=True,
    )
    # Workflow batch (wf01_sla): SLA-эскалация + reassign history.
    # last_inbound_message_at — таймстемп последнего сообщения от пациента
    # (нужно для расчёта SLA в chat_sla_job).
    last_inbound_message_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, index=True
    )
    # Текущий уровень SLA-эскалации: 'reg' | 'manager' | 'owner' | NULL.
    sla_breached_level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sla_breached_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # JSONB-лог передач треда:
    # [{at, from_user_id, to_user_id, actor_user_id, reason, note}]
    reassigned_history: Mapped[list] = mapped_column(
        JSONB, default=list, server_default='[]', nullable=False,
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    thread_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat_threads.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # patient | doctor | reg | manager | system
    sender_type: Mapped[str] = mapped_column(String(20), nullable=False)
    sender_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # массив {filename, url, size, mime}
    attachments: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True
    )


class ChatMessageReaction(Base):
    """Quick Wins #2: реакция на сообщение (emoji-тег).

    Юзер (пациент или сотрудник) может поставить любое количество
    разных emoji на одно сообщение, но не дублировать один и тот же.
    UNIQUE (message_id, user_type, user_id, emoji).
    """
    __tablename__ = "chat_message_reactions"
    __table_args__ = (
        UniqueConstraint(
            "message_id", "user_type", "user_id", "emoji",
            name="uq_chat_msg_reaction",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat_messages.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # 'patient' | 'staff'
    user_type: Mapped[str] = mapped_column(String(20), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    emoji: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
