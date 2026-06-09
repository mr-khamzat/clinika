"""
Модели результата приёма (заключение врача), вложений и
внутриклинических направлений (между врачами/на КТ/анализы).

Используются после состоявшегося приёма:
  - AppointmentOutcome    → текстовое заключение + рекомендации
  - AppointmentAttachment → файлы (анализы, исследования: PDF/JPG/PNG)
  - InternalReferral      → направление к другому врачу/на КТ/МРТ/анализы
"""
import uuid
from datetime import datetime
from sqlalchemy import String, Integer, ForeignKey, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class AppointmentOutcome(Base):
    """Заключение врача по итогу приёма (1:1 с Appointment)."""
    __tablename__ = "appointment_outcomes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    appointment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("appointments.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    # Текст заключения врача
    conclusion_encrypted: Mapped[str] = mapped_column("conclusion_encrypted", Text, nullable=False)
    # Рекомендации (необязательно)
    recommendations_encrypted: Mapped[str | None] = mapped_column("recommendations_encrypted", Text, nullable=True)
    # Кто создал (User.id — обычно врач)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


    def __init__(self, **kwargs):
        # Прозрачное шифрование PII-полей на __init__
        from app.services.encryption_service import encrypt as _enc
        for plain, enc_col in [('conclusion', 'conclusion_encrypted'), ('recommendations', 'recommendations_encrypted')]:
            if plain in kwargs:
                val = kwargs.pop(plain)
                kwargs[enc_col] = _enc(val) if val is not None else None
        super().__init__(**kwargs)

    @property
    def conclusion(self):
        from app.services.encryption_service import decrypt
        return decrypt(self.conclusion_encrypted)

    @conclusion.setter
    def conclusion(self, value):
        from app.services.encryption_service import encrypt
        self.conclusion_encrypted = encrypt(value) if value is not None else None

    @property
    def recommendations(self):
        from app.services.encryption_service import decrypt
        return decrypt(self.recommendations_encrypted)

    @recommendations.setter
    def recommendations(self, value):
        from app.services.encryption_service import encrypt
        self.recommendations_encrypted = encrypt(value) if value is not None else None

class AppointmentAttachment(Base):
    """Файл, прикреплённый к приёму (анализы, исследования и т.п.)."""
    __tablename__ = "appointment_attachments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    appointment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("appointments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Публичный/относительный URL файла (отдаётся через /uploads/appointments/...)
    file_url: Mapped[str] = mapped_column(Text, nullable=False)
    # Оригинальное имя файла (для скачивания и отображения)
    file_name: Mapped[str] = mapped_column(String(300), nullable=False)
    # MIME-тип (для иконки/превью)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Размер в байтах
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Кто загрузил
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )


class InternalReferral(Base):
    """
    Внутриклиническое направление, созданное по итогам приёма.
    target_type:
      - doctor    → к другому врачу клиники (target_doctor_id)
      - ct/mri/xray/lab/procedure → к диагностике/процедуре (target_service)
    status:
      - pending    → создано, ожидает планирования
      - scheduled  → пациент записан (scheduled_appointment_id)
      - done       → выполнено
      - cancelled  → отменено
    """
    __tablename__ = "internal_referrals"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Изоляция по тенанту (берём из source_appointment.tenant_id)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Из какого приёма направлен
    source_appointment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("appointments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Денормализованные данные пациента (на случай удаления исходного приёма)
    patient_phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    patient_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Тип направления: doctor | ct | mri | xray | lab | procedure
    target_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    # ID целевого врача (если target_type='doctor')
    target_doctor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("doctors.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Текст для не-врачебных направлений (например, "КТ грудной клетки с контрастом")
    target_service: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Заметки врача-источника к направлению
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Статус: pending | scheduled | done | cancelled
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending", index=True
    )
    # Кто создал направление (обычно врач-источник)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Когда пациент записан по этому направлению — ссылка на новый Appointment
    scheduled_appointment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("appointments.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
