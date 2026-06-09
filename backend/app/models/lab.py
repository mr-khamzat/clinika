"""
Глава 10 — Лаборатория-интеграция.

Модели:
  LabProvider  — справочник лабораторий тенанта (Гемотест, Инвитро, KDL, ...)
  LabOrder     — заявка на анализ (отправляется в лабораторию, потом приходит результат)
  LabResult    — отдельный результат анализа (по тест-коду)

[Находка #17 — 152-ФЗ] Результаты анализов — специальная категория ПДн.
В LabResult шифруются value / reference_range / raw_json по тому же паттерну,
что и PHI appointments (см. app/models/doctor.py): plaintext в shadow-колонке
*_encrypted (Text), plaintext отдаётся property *_plain (lazy decrypt с fallback
на legacy-plaintext), на запись шифрует set_*() и listener pii_sync.
raw_json (JSONB) → шифруется как JSON-сериализованная строка в raw_json_encrypted
(Text); getter делает json.loads(decrypt(...)), setter — encrypt(json.dumps(...)).
flagged (Boolean, аномальность) и test_code/test_name/unit НЕ шифруются —
структурированные/служебные поля без сведений о здоровье конкретного пациента.
Blind-index не нужен (поиска по value/reference_range нет).

ВАЖНО: shadow-колонки добавляет ОТДЕЛЬНАЯ миграция; здесь — ORM + accessors.
Существующие plaintext-колонки НЕ переименованы.
"""
import json
import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class LabProvider(Base):
    __tablename__ = "lab_providers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # gemotest | invitro | kdl | citilab | generic_http
    provider_type: Mapped[str] = mapped_column(String(40), nullable=False)
    api_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Зашифрованный API-ключ (через secrets_service если есть; иначе fallback к plaintext).
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, server_default="true")
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class LabOrder(Base):
    __tablename__ = "lab_orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("patient_accounts.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    doctor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("doctors.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lab_providers.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    external_order_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    # JSONB array of test codes
    test_codes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    notes_encrypted: Mapped[str | None] = mapped_column("notes_encrypted", Text, nullable=True)
    # created | sent | in_progress | results_ready | delivered | cancelled | error
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="created", index=True)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    results_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    results: Mapped[list["LabResult"]] = relationship(
        "LabResult", back_populates="order", cascade="all, delete-orphan"
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

class LabResult(Base):
    __tablename__ = "lab_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lab_orders.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    test_code: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    test_name: Mapped[str] = mapped_column(String(200), nullable=False)
    value: Mapped[str | None] = mapped_column(String(120), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    reference_range: Mapped[str | None] = mapped_column(String(120), nullable=True)
    flagged: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    result_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    raw_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )

    # ── Shadow-колонки шифрования медданных (#17) ────────────────────────────
    # Создаёт отдельная миграция. raw_json_encrypted хранит JSON-строку (Text).
    value_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    reference_range_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_json_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)

    order: Mapped["LabOrder"] = relationship("LabOrder", back_populates="results")

    # ── Accessors (lazy-decrypt, fallback на legacy-plaintext) ───────────────
    @property
    def value_plain(self) -> str | None:
        """Расшифрованное значение анализа (или legacy-plaintext)."""
        if self.value_encrypted:
            from app.services.encryption_service import decrypt
            val = decrypt(self.value_encrypted)
            if val is not None:
                return val
        return self.value

    def set_value(self, value: str | None) -> None:
        from app.services.encryption_service import encrypt
        self.value = value
        self.value_encrypted = encrypt(value) if value else None

    @property
    def reference_range_plain(self) -> str | None:
        """Расшифрованный референсный интервал (или legacy-plaintext)."""
        if self.reference_range_encrypted:
            from app.services.encryption_service import decrypt
            val = decrypt(self.reference_range_encrypted)
            if val is not None:
                return val
        return self.reference_range

    def set_reference_range(self, value: str | None) -> None:
        from app.services.encryption_service import encrypt
        self.reference_range = value
        self.reference_range_encrypted = encrypt(value) if value else None

    @property
    def raw_json_plain(self) -> dict | None:
        """Расшифрованный сырой ответ лаборатории (JSON → dict; fallback legacy)."""
        if self.raw_json_encrypted:
            from app.services.encryption_service import decrypt
            val = decrypt(self.raw_json_encrypted)
            if val is not None:
                try:
                    return json.loads(val)
                except (ValueError, TypeError):
                    return None
        return self.raw_json

    def set_raw_json(self, value: dict | None) -> None:
        from app.services.encryption_service import encrypt
        self.raw_json = value
        self.raw_json_encrypted = encrypt(json.dumps(value)) if value is not None else None
