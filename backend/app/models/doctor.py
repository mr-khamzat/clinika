"""
Модели для расписания врачей и записи пациентов.
Этап 5 SaaS-трансформации.
"""
import uuid
from datetime import datetime, date, time
from sqlalchemy import String, Boolean, Integer, ForeignKey, Date, Time, Text, Enum as SAEnum, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
import enum
from app.database import Base


class AppointmentStatus(str, enum.Enum):
    PENDING   = "pending"    # Ожидает подтверждения
    CONFIRMED = "confirmed"  # Подтверждена клиникой
    CANCELLED = "cancelled"  # Отменена
    COMPLETED = "completed"  # Визит состоялся
    NO_SHOW   = "no_show"    # Пациент не пришёл


class Doctor(Base):
    __tablename__ = "doctors"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False, index=True
    )
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    specialty: Mapped[str | None] = mapped_column(String(100), nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    slot_duration: Mapped[int] = mapped_column(Integer, default=30, nullable=False)  # минут
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, nullable=False)
    mis_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, unique=True)

    clinic: Mapped["Clinic"] = relationship("Clinic")
    schedules: Mapped[list["DoctorSchedule"]] = relationship(
        "DoctorSchedule", back_populates="doctor", cascade="all, delete-orphan"
    )
    appointments: Mapped[list["Appointment"]] = relationship(
        "Appointment", back_populates="doctor"
    )


class DoctorSchedule(Base):
    """Шаблонное расписание врача: в какие дни и часы он принимает."""
    __tablename__ = "doctor_schedules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doctor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("doctors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False)  # 0=Пн, 6=Вс
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    doctor: Mapped["Doctor"] = relationship("Doctor", back_populates="schedules")


class Appointment(Base):
    """Запись пациента к врачу на конкретный слот."""
    __tablename__ = "appointments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    doctor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("doctors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id"), nullable=False, index=True
    )
    referral_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("referrals.id", ondelete="SET NULL"), nullable=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Данные пациента (денормализованы для независимости)
    patient_phone: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    patient_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Время приёма
    appointment_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    # Статус и заметки
    status: Mapped[AppointmentStatus] = mapped_column(
        SAEnum(AppointmentStatus, values_callable=lambda x: [e.value for e in x], native_enum=False),
        default=AppointmentStatus.PENDING, nullable=False, index=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    qr_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    short_code: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True, index=True)
    patient_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    doctor: Mapped["Doctor"] = relationship("Doctor", back_populates="appointments")
