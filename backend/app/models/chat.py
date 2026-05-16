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
    String, Integer, DateTime, ForeignKey, Text,
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
