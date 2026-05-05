"""
Медкарта пациента: диагнозы, аллергии, прививки.
Хранятся локально и/или приходят из МИС (поле source).
Привязка по нормализованному телефону пациента + tenant_id.
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
