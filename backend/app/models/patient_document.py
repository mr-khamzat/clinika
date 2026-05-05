"""
Документы пациента: справки, направления, выписки, больничные.
Файлы хранятся в /app/uploads/patient_docs/{tenant_id}/{uuid}.{ext}.
Доступ из кабинета пациента — только владельцу телефона.

Также здесь — кэш назначений из МИС для офлайн-просмотра.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.database import Base


class PatientDocument(Base):
    __tablename__ = "patient_documents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Нормализованный телефон пациента
    patient_phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # Оригинальное имя файла (для отображения и скачивания)
    filename: Mapped[str] = mapped_column(String(300), nullable=False)
    # MIME-тип
    mime: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Размер в байтах
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Тип документа: reference | extract | sick_leave | other
    doc_type: Mapped[str] = mapped_column(String(30), nullable=False, default="other")
    # Кто загрузил (User.id)
    uploaded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Абсолютный путь к файлу на диске (например, /app/uploads/patient_docs/<tenant>/<uuid>.pdf)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    # Описание/комментарий
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Дата выдачи документа (отличается от created_at — даты загрузки)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class PatientPrescriptionCache(Base):
    """
    Кэш назначений из МИС — для офлайн-просмотра в кабинете.
    Заполняется при ответе МИС; при отсутствии связи отдаётся как fallback.
    """
    __tablename__ = "patient_prescription_cache"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    patient_phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # ID записи в МИС (для дедупликации)
    mis_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    drug_name: Mapped[str] = mapped_column(String(300), nullable=False)
    dosage: Mapped[str | None] = mapped_column(String(200), nullable=True)
    frequency: Mapped[str | None] = mapped_column(String(200), nullable=True)
    duration: Mapped[str | None] = mapped_column(String(100), nullable=True)
    prescribed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    doctor_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Сырые данные от МИС
    raw_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    cached_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
