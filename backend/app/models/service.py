import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Boolean, Numeric, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class Service(Base):
    __tablename__ = "services"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id"), nullable=True, index=True
    )
    bonus_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # МИС Renovatio поля (заполняются при синхронизации)
    mis_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    category: Mapped[str | None] = mapped_column(String(200), nullable=True)
    original_price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    preparation: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Инструкция «Подготовка к приёму» — редактируется клиникой, не перезаписывается МИС
    prep_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    lab: Mapped[str | None] = mapped_column(String(200), nullable=True)
    duration: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # SLA: срок (в днях) до автоматической просрочки направления на эту услугу.
    # Используется при расчёте дедлайна: Referral.created_at + sla_days
    sla_days: Mapped[int] = mapped_column(Integer, nullable=False, default=14, server_default="14")

    referrals: Mapped[list["Referral"]] = relationship("Referral", back_populates="service")
    clinic: Mapped["Clinic | None"] = relationship("Clinic", back_populates="services")
