"""
Модели системы плагинов — расширяемая коммерческая платформа фич.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, Boolean, DateTime, Numeric, Text, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class PluginCatalog(Base):
    """Каталог плагинов системы (статичный, заполняется через seed)."""
    __tablename__ = "plugins"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str] = mapped_column(String(50), default="extension", nullable=False)
    category: Mapped[str] = mapped_column(String(50), default="general", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    features: Mapped[list["PluginFeature"]] = relationship(
        "PluginFeature", back_populates="plugin", cascade="all, delete-orphan",
        order_by="PluginFeature.sort_order"
    )


class PluginFeature(Base):
    """Конкретная фича внутри плагина — может быть платной или бесплатной."""
    __tablename__ = "plugin_features"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plugin_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("plugins.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    price_monthly: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), nullable=False)
    # boolean = вкл/выкл | limit = числовое ограничение | plan = выбор тарифа
    feature_type: Mapped[str] = mapped_column(String(20), default="boolean", nullable=False)
    default_value: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    plugin: Mapped["PluginCatalog"] = relationship("PluginCatalog", back_populates="features")


class TenantPluginFeature(Base):
    """Статус конкретной фичи для конкретного тенанта."""
    __tablename__ = "tenant_plugin_features"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    feature_key: Mapped[str] = mapped_column(
        String(150), ForeignKey("plugin_features.key", ondelete="CASCADE"),
        nullable=False, index=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    value: Mapped[str | None] = mapped_column(String(200), nullable=True)  # для limit/plan типов
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    enabled_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class BillingEvent(Base):
    """Аудит-лог биллинговых событий при включении/выключении фич."""
    __tablename__ = "billing_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    feature_key: Mapped[str] = mapped_column(String(150), nullable=False)
    # enabled | disabled | trial_started | charge
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), nullable=False)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class ClinicVisibility(Base):
    """Матрица видимости: FROM-клиника → TO-клиника, роли с доступом."""
    __tablename__ = "clinic_visibility"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    from_clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False
    )
    to_clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False
    )
    allow_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allow_doctor: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allow_manager: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
