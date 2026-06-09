"""
Telemedicine — модели Этапа 1 (модуль 4990₽/мес).

3 таблицы:
- TelemedicineSession: WebRTC-сессия врач↔пациент с join_token (хранится только хеш)
- TelemedicineChatMessage: чат внутри звонка (текст + файлы)
- TelemedicinePrescription: электронная подпись рецептов (HMAC-SHA256)
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TelemedicineSessionStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    ACTIVE = "active"
    ENDED = "ended"
    EXPIRED = "expired"
    NO_SHOW = "no_show"


class TelemedicineChatRole(str, enum.Enum):
    DOCTOR = "doctor"
    PATIENT = "patient"
    SYSTEM = "system"


class TelemedicineSession(Base):
    """Сессия видеоприёма врач↔пациент."""
    __tablename__ = "telemedicine_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Связка с appointment — опциональна (возможна ad-hoc сессия)
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("appointments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    doctor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("doctors.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Нормализованный телефон пациента
    patient_phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # uuid4().hex — публичный идентификатор комнаты для WebRTC
    room_id: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )
    # SHA-256 от JWT join_token. Сам JWT отдаём один раз и не храним.
    join_token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[TelemedicineSessionStatus] = mapped_column(
        SAEnum(
            TelemedicineSessionStatus,
            name="telemedicine_session_status",
            values_callable=lambda x: [e.value for e in x],
            native_enum=True,
        ),
        default=TelemedicineSessionStatus.SCHEDULED,
        nullable=False,
        index=True,
    )
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Запись звонка (по умолчанию выкл — соблюдаем 152-ФЗ)
    recording_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    recording_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    chat_log_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes_encrypted: Mapped[str | None] = mapped_column("notes_encrypted", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    tenant = relationship("Tenant")
    appointment = relationship("Appointment")
    doctor = relationship("Doctor")
    chat_messages: Mapped[list["TelemedicineChatMessage"]] = relationship(
        "TelemedicineChatMessage",
        back_populates="session",
        cascade="all, delete-orphan",
    )
    prescriptions: Mapped[list["TelemedicinePrescription"]] = relationship(
        "TelemedicinePrescription",
        back_populates="session",
        cascade="all, delete-orphan",
    )


    def __init__(self, **kwargs):
        # Прозрачное шифрование PII-полей на __init__
        from app.services.encryption_service import encrypt as _enc
        for plain, enc_col in [('notes', 'notes_encrypted')]:
            if plain in kwargs:
                val = kwargs.pop(plain)
                kwargs[enc_col] = _enc(val) if val is not None else None
        super().__init__(**kwargs)

    @property
    def notes(self):
        from app.services.encryption_service import decrypt
        return decrypt(self.notes_encrypted)

    @notes.setter
    def notes(self, value):
        from app.services.encryption_service import encrypt
        self.notes_encrypted = encrypt(value) if value is not None else None

class TelemedicineChatMessage(Base):
    """Сообщение чата внутри телемед-сессии (текст + файл)."""
    __tablename__ = "telemedicine_chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("telemedicine_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    from_role: Mapped[TelemedicineChatRole] = mapped_column(
        SAEnum(
            TelemedicineChatRole,
            name="telemedicine_chat_role",
            values_callable=lambda x: [e.value for e in x],
            native_enum=True,
        ),
        nullable=False,
    )
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_mime: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False, index=True
    )

    session: Mapped["TelemedicineSession"] = relationship(
        "TelemedicineSession", back_populates="chat_messages"
    )


class TelemedicinePrescription(Base):
    """Электронный рецепт по итогам телемед-сессии (HMAC-SHA256 подпись)."""
    __tablename__ = "telemedicine_prescriptions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("telemedicine_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("appointments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Тело рецепта — Markdown
    body_encrypted: Mapped[str] = mapped_column("body_encrypted", Text, nullable=False)
    # HMAC-SHA256(secret, body || signed_at || signed_by_user_id)
    signature_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    signed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    signed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    pdf_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sent_to_patient_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    session: Mapped["TelemedicineSession"] = relationship(
        "TelemedicineSession", back_populates="prescriptions"
    )

    def __init__(self, **kwargs):
        # Прозрачное шифрование PII-полей на __init__
        from app.services.encryption_service import encrypt as _enc
        for plain, enc_col in [('body', 'body_encrypted')]:
            if plain in kwargs:
                val = kwargs.pop(plain)
                kwargs[enc_col] = _enc(val) if val is not None else None
        super().__init__(**kwargs)

    @property
    def body(self):
        from app.services.encryption_service import decrypt
        return decrypt(self.body_encrypted)

    @body.setter
    def body(self, value):
        from app.services.encryption_service import encrypt
        self.body_encrypted = encrypt(value) if value is not None else None
