import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, DateTime, Boolean, Integer, Float, ForeignKey, Numeric
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

    # ── Контракт партнёра-клиники (Этап 14) ───────────────────────────────────
    # Внутри Tenant'а каждая Clinic является партнёром франшизы и имеет
    # отдельный контракт. Тип определяет схему расчёта выплаты:
    #   royalty       — % с выручки подтверждённых направлений
    #   per_referral  — фиксированный ₽-бонус за каждое подтверждённое направление
    #   hybrid        — оба механизма одновременно (% + ₽ за штуку)
    contract_type: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    # Процент роялти (0..100). NUMERIC(5,2) → до 999.99, но ограничивается на уровне API.
    royalty_percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    # Бонус в рублях за подтверждённое направление.
    bonus_per_referral: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    # Дата подписания контракта (если уже подписан).
    contract_signed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Дата истечения контракта (если есть срок).
    contract_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Статус партнёрства: active | paused | terminated
    partner_status: Mapped[str] = mapped_column(String(20), nullable=False, server_default='active', default='active')
    # Источник данных о выручке: mis | manual | export
    revenue_source: Mapped[str | None] = mapped_column(String(20), nullable=True)

    city_ref: Mapped["City | None"] = relationship("City", back_populates="clinics")
    users: Mapped[list["User"]] = relationship("User", back_populates="clinic")
    services: Mapped[list["Service"]] = relationship("Service", back_populates="clinic")
    referrals_from: Mapped[list["Referral"]] = relationship("Referral", back_populates="from_clinic", foreign_keys="Referral.from_clinic_id")
    referrals_to: Mapped[list["Referral"]] = relationship("Referral", back_populates="to_clinic", foreign_keys="Referral.to_clinic_id")
    schedules: Mapped[list["ClinicSchedule"]] = relationship("ClinicSchedule", back_populates="clinic", cascade="all, delete-orphan")
