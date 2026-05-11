"""
Глава 10 — Wellness партнёрки.

WellnessPartner       — справочник партнёров (фитнес/спа/питание/психология/йога)
WellnessPartnerClick  — аналитика кликов пациентов (для оценки конверсии)
"""
import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class WellnessPartner(Base):
    __tablename__ = "wellness_partners"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # fitness | spa | nutrition | psychology | yoga | other
    category: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    discount_text: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    promo_code: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    link_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    # min plan required: health_plus | family_plus | pro
    min_subscription_plan: Mapped[str] = mapped_column(
        String(40), nullable=False, default="health_plus", server_default="health_plus"
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, server_default="true")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )


class WellnessPartnerClick(Base):
    __tablename__ = "wellness_partner_clicks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    partner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wellness_partners.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("patient_accounts.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    clicked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True
    )
