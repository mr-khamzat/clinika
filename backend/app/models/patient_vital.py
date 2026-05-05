"""
Patient Vitals — модель показателей здоровья пациента.
Хранит измерения пульса, давления, SpO2, шагов, веса и т.д.
Источники: ручной ввод, Apple Health, Google Fit, медицинские устройства.

Дедупликация на уровне сервиса по (tenant_id, patient_phone, metric, measured_at):
повторная синхронизация одних и тех же сэмплов не создаёт дубликатов.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, DateTime, ForeignKey, Numeric, Index, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class PatientVital(Base):
    __tablename__ = "patient_vitals"
    __table_args__ = (
        # Композитный индекс под основные запросы:
        # (последние записи пациента, серии по конкретной метрике)
        Index(
            "ix_vitals_tenant_phone_metric_time",
            "tenant_id", "patient_phone", "metric", "measured_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Нормализованный телефон пациента (формат 7XXXXXXXXXX)
    patient_phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)

    # Тип показателя:
    # 'heart_rate', 'blood_pressure_sys', 'blood_pressure_dia', 'spo2',
    # 'glucose', 'weight_kg', 'height_cm', 'temperature', 'steps',
    # 'sleep_minutes', 'hrv'
    metric: Mapped[str] = mapped_column(String(40), nullable=False)

    # Основное числовое значение
    value_num: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    # Доп. данные для составных показателей (например, SYS+DIA вместе,
    # либо метаданные сна: фазы, эффективность)
    value_extra: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Единица измерения: 'bpm', 'mmHg', '%', 'mmol/L', 'kg', 'cm', '°C', 'steps', 'min', 'ms'
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)

    measured_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)

    # Источник сэмпла: 'manual' | 'apple_health' | 'google_fit' | 'device'
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="manual")
    # Например: "iPhone 15", "Apple Watch Series 9", "Withings BPM Core"
    device_info: Mapped[str | None] = mapped_column(String(200), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )
