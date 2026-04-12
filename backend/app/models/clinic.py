import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Boolean, Integer, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base

class Clinic(Base):
    __tablename__ = "clinics"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    mis_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # ── Geo поля ──────────────────────────────────────────────────────────────
    city_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cities.id", ondelete="SET NULL"),
        nullable=True, index=True
    )
    city: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)   # денормализованное название города
    region: Mapped[str | None] = mapped_column(String(100), nullable=True)             # регион/республика
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)

    city_ref: Mapped["City | None"] = relationship("City", back_populates="clinics")
    users: Mapped[list["User"]] = relationship("User", back_populates="clinic")
    services: Mapped[list["Service"]] = relationship("Service", back_populates="clinic")
    referrals_from: Mapped[list["Referral"]] = relationship("Referral", back_populates="from_clinic", foreign_keys="Referral.from_clinic_id")
    referrals_to: Mapped[list["Referral"]] = relationship("Referral", back_populates="to_clinic", foreign_keys="Referral.to_clinic_id")
    schedules: Mapped[list["ClinicSchedule"]] = relationship("ClinicSchedule", back_populates="clinic", cascade="all, delete-orphan")
