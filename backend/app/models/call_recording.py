"""
Запись звонков + Whisper-транскрипция — модуль W5 master plan (call_recording).

2 таблицы:
- CallRecording: метаданные одной записи (файл на диске, статус, участники).
- CallTranscript: расшифровка от Whisper + опц. AI summary от Gemini.

Ключи:
  - tenant-изолировано через tenant_id
  - call_log_id nullable: запись может не быть привязана к существующему CallLog
  - status: uploading → ready → transcribing → done | failed
"""
import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


# ─────────────────────────── ENUM-типы ────────────────────────────────────


class CallSessionType(str, enum.Enum):
    """Тип сессии для целей биллинга/прав доступа."""
    STAFF    = "staff"     # внутренний звонок сотрудник↔сотрудник
    TELEMED  = "telemed"   # видеоприём врач↔пациент (telemedicine)
    EXTERNAL = "external"  # внешний (МИС / SIP-шлюз и т.д.)


class CallRecordingStatus(str, enum.Enum):
    """Жизненный цикл записи."""
    UPLOADING    = "uploading"     # клиент ещё льёт файл
    READY        = "ready"         # файл сохранён, ждёт обработки
    TRANSCRIBING = "transcribing"  # отдан в Whisper
    DONE         = "done"          # транскрипт готов
    FAILED       = "failed"        # ошибка на любом этапе


# ─────────────────────────── Модели ───────────────────────────────────────


class CallRecording(Base):
    """Метаданные одной записи звонка."""
    __tablename__ = "call_recordings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Не каждая запись имеет CallLog (внешние сессии). При удалении CallLog
    # связь сбрасывается, сама запись остаётся для аудита.
    call_log_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("call_logs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    session_type: Mapped[CallSessionType] = mapped_column(
        SAEnum(
            CallSessionType,
            name="call_session_type",
            values_callable=lambda x: [e.value for e in x],
            native_enum=True,
        ),
        nullable=False,
    )
    # Список участников как JSON: [{user_id, role, name}]
    participants: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    recording_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[CallRecordingStatus] = mapped_column(
        SAEnum(
            CallRecordingStatus,
            name="call_recording_status",
            values_callable=lambda x: [e.value for e in x],
            native_enum=True,
        ),
        default=CallRecordingStatus.UPLOADING,
        nullable=False,
        index=True,
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False, index=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    tenant = relationship("Tenant")
    transcript: Mapped["CallTranscript | None"] = relationship(
        "CallTranscript",
        back_populates="recording",
        uselist=False,
        cascade="all, delete-orphan",
    )


class CallTranscript(Base):
    """Транскрипт записи + опц. AI summary."""
    __tablename__ = "call_transcripts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    recording_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("call_recordings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        unique=True,
    )
    # Сегменты с таймкодами: [{start: 0.0, end: 3.4, speaker: "0", text: "..."}]
    segments: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    full_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    language: Mapped[str | None] = mapped_column(String(10), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    tokens_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    model: Mapped[str] = mapped_column(String(50), default="whisper-1", nullable=False)
    cost_usd: Mapped[Decimal] = mapped_column(
        Numeric(10, 4), default=Decimal("0"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    recording: Mapped["CallRecording"] = relationship(
        "CallRecording", back_populates="transcript"
    )
