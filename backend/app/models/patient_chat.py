"""
Чат пациента с клиникой — гибридная модель AI + регистратура (вариант D).

PatientChat: одна ветка чата = (пациент по телефону) × тенант.
PatientChatMessage: сообщения трёх типов — patient | assistant | admin.

Логика:
* mode='ai'     — AI-ассистент отвечает автоматически с контекстом тенанта.
* mode='manual' — AI отключен, ждём ответа администратора клиники.

Ограничения:
* до 20 AI-ответов в день на ветку (lazy-reset по дате).
* кэш частых вопросов в Redis (см. patient_chat_ai.py).
"""
import uuid
import enum
from datetime import datetime, date
from sqlalchemy import (
    String, Integer, Boolean, DateTime, Date, ForeignKey, Text,
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class PatientChatMode(str, enum.Enum):
    AI = "ai"
    MANUAL = "manual"


class PatientChatSender(str, enum.Enum):
    PATIENT = "patient"
    ASSISTANT = "assistant"
    ADMIN = "admin"


class PatientChat(Base):
    """Ветка чата пациента в рамках тенанта."""
    __tablename__ = "patient_chats"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    patient_phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    patient_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    mode: Mapped[PatientChatMode] = mapped_column(
        SAEnum(
            PatientChatMode,
            values_callable=lambda x: [e.value for e in x],
            native_enum=False,
            name="patient_chat_mode",
        ),
        default=PatientChatMode.AI,
        nullable=False,
    )
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Лимит AI-ответов на сутки (сбрасывается при первом сообщении следующего дня)
    ai_messages_today: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ai_messages_reset_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Счётчик непрочитанных для админа (сбрасывается при reply из админки)
    unread_admin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Время последнего сообщения (для сортировки в админке)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_message_preview: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    messages: Mapped[list["PatientChatMessage"]] = relationship(
        "PatientChatMessage",
        back_populates="chat",
        cascade="all, delete-orphan",
        order_by="PatientChatMessage.created_at",
    )


class PatientChatMessage(Base):
    """Одно сообщение в ветке чата пациента."""
    __tablename__ = "patient_chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    chat_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_chats.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    sender: Mapped[PatientChatSender] = mapped_column(
        SAEnum(
            PatientChatSender,
            values_callable=lambda x: [e.value for e in x],
            native_enum=False,
            name="patient_chat_sender",
        ),
        nullable=False,
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_cached: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    handed_off: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # AI пометил как «не знаю»
    is_read_by_patient: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Источник ответа: 'llm' | 'knowledge' | 'cache' | 'fallback'
    source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    admin_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False, index=True
    )

    chat: Mapped["PatientChat"] = relationship("PatientChat", back_populates="messages")
