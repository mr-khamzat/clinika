import uuid
from datetime import datetime, timedelta
from sqlalchemy import String, Integer, DateTime, ForeignKey, Enum as SAEnum, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
import enum
from app.database import Base

class ReferralStatus(str, enum.Enum):
    CREATED = "created"
    CONFIRMED = "confirmed"
    EXPIRED = "expired"
    CANCEL_REQUESTED = "cancel_requested"
    CANCELLED = "cancelled"

class Referral(Base):
    __tablename__ = "referrals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True)
    from_clinic_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id"), nullable=True)
    to_clinic_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id"), nullable=False)
    service_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("services.id"), nullable=True)
    # Тип направления: service (на услугу) | doctor (на конкретного врача) | lab (анализы)
    referral_type: Mapped[str] = mapped_column(String(16), nullable=False, default="service", server_default="service")
    # Для type=doctor — id врача из нашей БД (для МИС используем doctor.mis_id)
    target_doctor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("doctors.id", ondelete="SET NULL"), nullable=True)
    # Для type=lab — список анализов одной строкой/JSON
    lab_tests: Mapped[str | None] = mapped_column(Text, nullable=True)
    patient_phone: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    patient_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    mis_patient_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    created_by_admin_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    confirmed_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    status: Mapped[ReferralStatus] = mapped_column(SAEnum(ReferralStatus, values_callable=lambda x: [e.value for e in x]), default=ReferralStatus.CREATED, index=True)
    qr_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    patient_qr_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    short_code: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True, unique=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow() + timedelta(days=7))

    appointment_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    mis_appointment_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    mis_doctor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Cancellation fields
    cancel_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # ── Cross-clinic referrals (xref01) ────────────────────────────────────
    # Направление пациента из клиники А (referred_by_tenant_id) в клинику Б
    # (target_tenant_id) внутри одной франшизы. Жизненный цикл — отдельный
    # cross_clinic_status, не пересекается с обычным ReferralStatus.
    target_tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    referred_by_tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
    )
    cross_clinic_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    cross_clinic_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    inter_clinic_invoice_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    from_clinic: Mapped["Clinic"] = relationship("Clinic", back_populates="referrals_from", foreign_keys=[from_clinic_id])
    to_clinic: Mapped["Clinic"] = relationship("Clinic", back_populates="referrals_to", foreign_keys=[to_clinic_id])
    service: Mapped["Service"] = relationship("Service", back_populates="referrals")
    created_by: Mapped["User"] = relationship("User", back_populates="referrals_created", foreign_keys=[created_by_admin_id])
    bonus: Mapped["Bonus | None"] = relationship("Bonus", back_populates="referral", uselist=False)
