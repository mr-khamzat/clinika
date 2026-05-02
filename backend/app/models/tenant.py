# ===== БЛОК: Модели Multi-tenant =====
# Tenant — город/дилер. License — ограничения плана. Branding — визуальный стиль.
# Все основные таблицы содержат tenant_id для строгой изоляции данных.

import uuid
from datetime import datetime, date
from sqlalchemy import String, Boolean, DateTime, Date, Integer, ForeignKey, Text, Numeric
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    domain: Mapped[str | None] = mapped_column(String(200), unique=True, nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    franchise_owner_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    legal_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    legal_inn: Mapped[str | None] = mapped_column(String(20), nullable=True)
    legal_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    royalty_percent: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    license: Mapped["TenantLicense | None"] = relationship(
        "TenantLicense", back_populates="tenant", uselist=False, cascade="all, delete-orphan"
    )
    branding: Mapped["TenantBranding | None"] = relationship(
        "TenantBranding", back_populates="tenant", uselist=False, cascade="all, delete-orphan"
    )


class TenantLicense(Base):
    __tablename__ = "tenant_licenses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True
    )
    # Планы: basic | professional | enterprise
    plan: Mapped[str] = mapped_column(String(50), default="professional", nullable=False)
    max_clinics: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    max_users: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    # JSON-словарь включённых фич: {"scheduling": true, "billing": false, ...}
    features: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    valid_from: Mapped[date] = mapped_column(Date, default=date.today, nullable=False)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)  # NULL = бессрочно
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="license")


class TenantBranding(Base):
    __tablename__ = "tenant_branding"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True
    )
    brand_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    primary_color: Mapped[str] = mapped_column(String(20), default="#0097A7", nullable=False)
    sidebar_color: Mapped[str] = mapped_column(String(20), default="#004D5F", nullable=False)
    bg_color: Mapped[str] = mapped_column(String(20), default="#F0F5F6", nullable=False)
    font_family: Mapped[str] = mapped_column(String(100), default="Inter", nullable=False)
    # White-label CMS расширения
    secondary_color: Mapped[str | None] = mapped_column(String(20), nullable=True, default="#E0F7FA")
    favicon_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    og_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    footer_text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    custom_domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    domain_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    meta_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    meta_description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    support_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    support_email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    hide_menu_items: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=list)
    rename_menu_items: Mapped[dict | None] = mapped_column(JSONB, nullable=True, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="branding")


class TenantModule(Base):
    """Переопределение модулей (фич) на уровне отдельного тенанта."""
    __tablename__ = "tenant_modules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    module: Mapped[str] = mapped_column(String(100), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class TenantPlugin(Base):
    """Конфигурация плагинов на уровне тенанта."""
    __tablename__ = "tenant_plugins"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    plugin: Mapped[str] = mapped_column(String(100), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    # Биллинг плагина
    trial_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    paid_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    price_monthly: Mapped[float | None] = mapped_column(nullable=True)
