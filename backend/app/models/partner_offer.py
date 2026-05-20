"""Партнёрский прайс: категории и офферы услуг для cross-clinic направлений.

PartnerCategory  — собственные категории клиники-получателя (отдельно от МИС).
PartnerServiceOffer — связка (clinic_id, service_id) с payout и опц. price_override.
Видна другим клиникам того же tenant; cross-tenant закрыто на уровне роутера.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, DateTime, Boolean, Numeric, ForeignKey, Integer, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class PartnerCategory(Base):
    __tablename__ = "partner_categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    clinic_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    offers: Mapped[list["PartnerServiceOffer"]] = relationship(
        "PartnerServiceOffer", back_populates="category", foreign_keys="PartnerServiceOffer.category_id"
    )

    __table_args__ = (
        Index("uq_partner_category_clinic_name", "clinic_id", "name", unique=True),
    )


class PartnerServiceOffer(Base):
    __tablename__ = "partner_service_offers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    clinic_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False, index=True)
    service_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("services.id", ondelete="CASCADE"), nullable=False, index=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("partner_categories.id", ondelete="SET NULL"), nullable=True, index=True)
    payout_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    price_override: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    category: Mapped["PartnerCategory | None"] = relationship("PartnerCategory", back_populates="offers", foreign_keys=[category_id])

    __table_args__ = (
        Index("uq_partner_offer_clinic_service", "clinic_id", "service_id", unique=True),
        Index("ix_partner_offer_tenant_active", "tenant_id", "is_active"),
    )
