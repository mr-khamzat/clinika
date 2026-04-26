import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Boolean, ForeignKey, Enum as SAEnum, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
import enum
from app.database import Base

class UserRole(str, enum.Enum):
    ADMIN = "admin"
    MANAGER = "manager"
    PARTNER = "partner"
    SUPER_ADMIN = "super_admin"
    DOCTOR = "doctor"
    NURSE = "nurse"
    RECRUITER = "recruiter"
    SUPERVISOR = "supervisor"
    ACQUISITION_MANAGER = "acquisition_manager"
    EXTERNAL_DOCTOR = "external_doctor"
    VISITING_DOCTOR = "visiting_doctor"

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True)
    telegram_id: Mapped[str | None] = mapped_column(String(50), unique=True, index=True, nullable=True)
    username: Mapped[str | None] = mapped_column(String(100), unique=True, index=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(200), nullable=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone_number: Mapped[str | None] = mapped_column(String(20), index=True, nullable=True)
    email: Mapped[str | None] = mapped_column(String(200), index=True, nullable=True)
    category: Mapped[str | None] = mapped_column(String(30), nullable=True)
    date_of_birth: Mapped[str | None] = mapped_column(String(20), nullable=True)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole, values_callable=lambda x: [e.value for e in x], create_type=False), default=UserRole.ADMIN)
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Рекрутер: кто привлёк этого врача (FK на users)
    recruiter_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    # Индивидуальный % рекрутера (заполняется только для роли recruiter)
    bonus_percent: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    # 152-ФЗ
    consent_given: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    consent_given_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    consent_version: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # Тип врача: internal | external | visiting
    doctor_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Менеджер привлечения (для external_doctor/visiting_doctor)
    manager_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    clinic: Mapped["Clinic"] = relationship("Clinic", back_populates="users")
    referrals_created: Mapped[list["Referral"]] = relationship("Referral", back_populates="created_by", foreign_keys="Referral.created_by_admin_id")
    bonuses: Mapped[list["Bonus"]] = relationship("Bonus", back_populates="admin")
    recruiter: Mapped["User | None"] = relationship("User", remote_side="User.id", foreign_keys=[recruiter_id])
    doctor_clinic_access: Mapped[list["DoctorClinicAccess"]] = relationship("DoctorClinicAccess", back_populates="doctor", foreign_keys="DoctorClinicAccess.doctor_id")
