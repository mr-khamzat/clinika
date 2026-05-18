import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Boolean, ForeignKey, Enum as SAEnum, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
import enum
from app.database import Base

class UserRole(str, enum.Enum):
    SUPER_ADMIN = "super_admin"
    FRANCHISE_OWNER = "franchise_owner"
    MANAGER = "manager"
    DOCTOR = "doctor"
    REG = "reg"
    NURSE = "nurse"
    RECRUITER = "recruiter"
    PARTNER_DOCTOR = "partner_doctor"
    VISITING_DOCTOR = "visiting_doctor"
    # Менеджер привлечения внешних врачей (external01)
    ACQUISITION_MANAGER = "acquisition_manager"
    PATIENT = "patient"
    # Директор сети — read-only финансово-операционный кабинет владельца сети.
    # Привязка к франшизе через users.franchise_id (миграция director01).
    DIRECTOR = "director"
    # Зам руководителя сети — те же экраны DirectorCabinet, тоже read-only.
    # Главврач = зам в крупных клиниках/больницах (deputydir01).
    DEPUTY_DIRECTOR = "deputy_director"
    # Бухгалтер клиники — отдельный кабинет /accountant. Scope: clinic_id.
    # Видит и ведёт кассовые смены, акты, платежи, расходы. БЕЗ доступа к
    # медицинским данным и без прав на CRUD пользователей.
    ACCOUNTANT = "accountant"
    # Лаборанты: КТ и рентгенолог. Поведение как у doctor, отдельные роли
    # нужны для фильтра/UI и читаемого справочника.
    LAB_CT = "lab_ct"
    LAB_XRAY = "lab_xray"

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
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole, values_callable=lambda x: [e.value for e in x], create_type=False), default=UserRole.REG)
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_suspended: Mapped[bool] = mapped_column(Boolean, default=False)
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
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    specialization: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Менеджер привлечения (для partner_doctor/visiting_doctor)
    manager_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    # External doctors MVP (external01): ИНН самозанятого / ставка / признак активности
    external_doctor_inn: Mapped[str | None] = mapped_column(String(20), nullable=True)
    external_doctor_rate: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    external_doctor_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, server_default="true")
    # Привязка к франшизе (для роли director и удобной фильтрации franchise_owner)
    # Миграция: director01. NULL — не привязан к франшизе.
    franchise_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("franchises.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    clinic: Mapped["Clinic"] = relationship("Clinic", back_populates="users")
    referrals_created: Mapped[list["Referral"]] = relationship("Referral", back_populates="created_by", foreign_keys="Referral.created_by_admin_id")
    bonuses: Mapped[list["Bonus"]] = relationship("Bonus", back_populates="admin")
    recruiter: Mapped["User | None"] = relationship("User", remote_side="User.id", foreign_keys=[recruiter_id])
    doctor_clinic_access: Mapped[list["DoctorClinicAccess"]] = relationship("DoctorClinicAccess", back_populates="doctor", foreign_keys="DoctorClinicAccess.doctor_id")
