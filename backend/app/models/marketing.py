"""
Маркетинговая атрибуция и расходы на рекламу.

Модели:
  MarketingChannel    — справочник каналов (Yandex Direct, Google Ads, Instagram, …).
                        tenant_id NULL = глобальный/системный канал.
  AdSpendEntry        — рекламные расходы (помесячно или по кампаниям).
  PatientAttribution  — связь пациента (по телефону или user_id) с каналом + UTM.

Используется в Кабинете Директора (DirectorMarketing) и в Manager-кабинете
(CRUD расходов и кастомных каналов франшизы).
"""
import uuid
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import (
    String, Boolean, DateTime, Date, Numeric, Integer, Text,
    ForeignKey, CheckConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class MarketingChannel(Base):
    """Справочник маркетинговых каналов."""
    __tablename__ = "marketing_channels"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # NULL = глобальный системный канал (доступен всем тенантам)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )
    code: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow,
    )


class AdSpendEntry(Base):
    """Рекламные расходы — за период (помесячно или по кампании)."""
    __tablename__ = "ad_spend_entries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    channel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("marketing_channels.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    campaign_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    period_from: Mapped[date] = mapped_column(Date, nullable=False)
    period_to: Mapped[date] = mapped_column(Date, nullable=False)

    leads_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    clicks_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    impressions_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow,
    )

    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_ad_spend_amount_nonneg"),
        CheckConstraint("period_to >= period_from", name="ck_ad_spend_period"),
    )


class PatientAttribution(Base):
    """Атрибуция пациента к маркетинговому каналу.

    Пациент идентифицируется либо по телефону (`patient_phone`, основной кейс,
    т.к. `appointments.patient_phone` — единственная связка), либо по `user_id`
    (если пациент зарегистрирован в портале).
    """
    __tablename__ = "patient_attribution"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    patient_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    patient_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    contact_request_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True,
    )
    channel_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("marketing_channels.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    source_detail: Mapped[str | None] = mapped_column(String(200), nullable=True)

    utm_source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    utm_medium: Mapped[str | None] = mapped_column(String(100), nullable=True)
    utm_campaign: Mapped[str | None] = mapped_column(String(100), nullable=True)
    utm_term: Mapped[str | None] = mapped_column(String(100), nullable=True)
    utm_content: Mapped[str | None] = mapped_column(String(100), nullable=True)

    referrer: Mapped[str | None] = mapped_column(String(500), nullable=True)
    first_touch_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    last_touch_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow,
    )
