"""
Медкарта пациента: диагнозы, аллергии, прививки.
Хранятся локально и/или приходят из МИС (поле source).
Привязка по нормализованному телефону пациента + tenant_id.

[Находка #17 — 152-ФЗ] Сведения о здоровье (диагнозы, аллергии, прививки) —
специальная категория ПДн. Шифруются по тому же паттерну, что и PHI appointments
(см. app/models/doctor.py Appointment): plaintext-значение хранится в shadow-колонке
*_encrypted (Text, ciphertext 'enc:'/'plain:' от encryption_service), plaintext
отдаётся property *_plain (lazy decrypt с fallback на legacy-plaintext-колонку),
на запись шифрует set_*() и listener pii_sync.

Blind-index (*_hash) НЕ нужен: по медтексту (название диагноза/аллерген/вакцина)
exact-match/группировки в коде нет — только шифрование. Структурированный код
МКБ-10 (icd10_code) НЕ шифруется: используется для фильтров/справочников.

ВАЖНО: shadow-колонки *_encrypted добавляет ОТДЕЛЬНАЯ миграция (агент-миграция).
Здесь — только ORM-объявление + accessors. Существующие plaintext-колонки
(name/notes/allergen/reaction/vaccine_name) НЕ переименованы и НЕ удалены — это
сделает миграция после backfill.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Boolean, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class PatientDiagnosis(Base):
    __tablename__ = "patient_diagnoses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Нормализованный телефон пациента (формат 7XXXXXXXXXX)
    patient_phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # МКБ-10 код (например, J06.9)
    icd10_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Название диагноза
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    # Дата постановки диагноза
    diagnosed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Хроническое заболевание (true) или эпизод (false)
    is_chronic: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Заметки врача
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Имя врача, поставившего диагноз
    doctor_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Источник: manual (вручную) или mis (импорт из МИС)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    # ── Shadow-колонки шифрования медданных (#17) ────────────────────────────
    # Создаёт отдельная миграция. Имена 1:1 с миграцией. icd10_code НЕ шифруем.
    name_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Accessors (lazy-decrypt, fallback на legacy-plaintext) ───────────────
    @property
    def name_plain(self) -> str | None:
        """Расшифрованное название диагноза (или legacy-plaintext)."""
        if self.name_encrypted:
            from app.services.encryption_service import decrypt
            val = decrypt(self.name_encrypted)
            if val is not None:
                return val
        return self.name

    def set_name(self, value: str | None) -> None:
        from app.services.encryption_service import encrypt
        self.name = value
        self.name_encrypted = encrypt(value) if value else None

    @property
    def notes_plain(self) -> str | None:
        """Расшифрованные заметки врача (или legacy-plaintext)."""
        if self.notes_encrypted:
            from app.services.encryption_service import decrypt
            val = decrypt(self.notes_encrypted)
            if val is not None:
                return val
        return self.notes

    def set_notes(self, value: str | None) -> None:
        from app.services.encryption_service import encrypt
        self.notes = value
        self.notes_encrypted = encrypt(value) if value else None


class PatientAllergy(Base):
    __tablename__ = "patient_allergies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    patient_phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # Аллерген (например, "пенициллин", "арахис")
    allergen: Mapped[str] = mapped_column(String(200), nullable=False)
    # Тяжесть: mild | moderate | severe
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="mild")
    # Описание реакции
    reaction: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Когда зафиксирована аллергия
    noted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    # ── Shadow-колонки шифрования медданных (#17) ────────────────────────────
    allergen_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    reaction_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Accessors (lazy-decrypt, fallback на legacy-plaintext) ───────────────
    @property
    def allergen_plain(self) -> str | None:
        """Расшифрованный аллерген (или legacy-plaintext)."""
        if self.allergen_encrypted:
            from app.services.encryption_service import decrypt
            val = decrypt(self.allergen_encrypted)
            if val is not None:
                return val
        return self.allergen

    def set_allergen(self, value: str | None) -> None:
        from app.services.encryption_service import encrypt
        self.allergen = value
        self.allergen_encrypted = encrypt(value) if value else None

    @property
    def reaction_plain(self) -> str | None:
        """Расшифрованное описание реакции (или legacy-plaintext)."""
        if self.reaction_encrypted:
            from app.services.encryption_service import decrypt
            val = decrypt(self.reaction_encrypted)
            if val is not None:
                return val
        return self.reaction

    def set_reaction(self, value: str | None) -> None:
        from app.services.encryption_service import encrypt
        self.reaction = value
        self.reaction_encrypted = encrypt(value) if value else None


class PatientVaccination(Base):
    __tablename__ = "patient_vaccinations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    patient_phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # Название вакцины (например, "Спутник V", "Гриппол")
    vaccine_name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Дата введения
    given_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Номер дозы (1, 2, 3...)
    dose_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Дата окончания иммунитета (если применимо)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Серия / номер партии
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Имя врача, проводившего вакцинацию
    doctor_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    # ── Shadow-колонка шифрования медданных (#17) ────────────────────────────
    vaccine_name_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Accessors (lazy-decrypt, fallback на legacy-plaintext) ───────────────
    @property
    def vaccine_name_plain(self) -> str | None:
        """Расшифрованное название вакцины (или legacy-plaintext)."""
        if self.vaccine_name_encrypted:
            from app.services.encryption_service import decrypt
            val = decrypt(self.vaccine_name_encrypted)
            if val is not None:
                return val
        return self.vaccine_name

    def set_vaccine_name(self, value: str | None) -> None:
        from app.services.encryption_service import encrypt
        self.vaccine_name = value
        self.vaccine_name_encrypted = encrypt(value) if value else None
