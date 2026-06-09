"""
Документы пациента: справки, направления, выписки, больничные.
Файлы хранятся в /app/uploads/patient_docs/{tenant_id}/{uuid}.{ext}
                 или в /app/data/patient_docs/{patient_id}/{uuid}.{ext} (Глава 9).

Доступ из кабинета пациента — только владельцу телефона / patient_id.

Также здесь — кэш назначений из МИС для офлайн-просмотра.

Глава 9: добавлены патиент-центричные колонки (patient_id / category / title /
visibility / deleted_at). Старые staff-загрузки (patient_phone-only) остаются
совместимы — новые колонки nullable.
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
    # Нормализованный телефон пациента (legacy)
    patient_phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # Глава 9: UUID-привязка к patient_accounts
    patient_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_accounts.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    # Оригинальное имя файла (для отображения и скачивания)
    filename: Mapped[str] = mapped_column(String(300), nullable=False)
    # MIME-тип
    mime: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Размер в байтах
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Тип документа: reference | extract | sick_leave | other (legacy staff)
    doc_type: Mapped[str] = mapped_column(String(30), nullable=False, default="other")
    # Глава 9: категория — lab_result|prescription|referral|discharge|mri|xray|other
    category: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # Глава 9: заголовок документа
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Глава 9: видимость — patient_only|patient_and_doctors|tenant_admins
    visibility: Mapped[str] = mapped_column(
        String(20), nullable=False, default="patient_and_doctors",
        server_default="patient_and_doctors",
    )
    # Кто загрузил (User.id; NULL если сам пациент)
    uploaded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Абсолютный путь к файлу на диске
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    # Описание/комментарий
    description_encrypted: Mapped[str | None] = mapped_column("description_encrypted", Text, nullable=True)
    # Дата выдачи документа (отличается от created_at — даты загрузки)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    # Глава 9: soft-delete
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


    def __init__(self, **kwargs):
        # Прозрачное шифрование PII-полей на __init__
        from app.services.encryption_service import encrypt as _enc
        for plain, enc_col in [('description', 'description_encrypted')]:
            if plain in kwargs:
                val = kwargs.pop(plain)
                kwargs[enc_col] = _enc(val) if val is not None else None
        super().__init__(**kwargs)

    @property
    def description(self):
        from app.services.encryption_service import decrypt
        return decrypt(self.description_encrypted)

    @description.setter
    def description(self, value):
        from app.services.encryption_service import encrypt
        self.description_encrypted = encrypt(value) if value is not None else None

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
