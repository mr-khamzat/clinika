"""
Коммерческие модули платформы и интеграции тенантов.
"""
import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class IntegrationType(str, enum.Enum):
    MIS    = "mis"
    LIS    = "lis"
    BARS   = "bars"
    CUSTOM = "custom"


class ModuleStatus(str, enum.Enum):
    TRIAL     = "trial"
    ACTIVE    = "active"
    GRACE     = "grace"
    EXPIRED   = "expired"
    CANCELLED = "cancelled"


class CommercialModule(Base):
    """Каталог платных модулей платформы. Цены редактируются super_admin."""
    __tablename__ = "commercial_modules"

    id:            Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key:           Mapped[str]       = mapped_column(String(100), unique=True, nullable=False, index=True)
    name:          Mapped[str]       = mapped_column(String(200), nullable=False)
    description:   Mapped[str | None]= mapped_column(Text, nullable=True)
    category:      Mapped[str]       = mapped_column(String(50), nullable=False)          # telephony | ai | advertising
    price_monthly: Mapped[Decimal]   = mapped_column(Numeric(12, 2), default=Decimal("0"), nullable=False)
    price_annual:  Mapped[Decimal]   = mapped_column(Numeric(12, 2), default=Decimal("0"), nullable=False)
    # Планы где модуль включён бесплатно (JSON-список: ["professional","enterprise"])
    included_in_plans: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    is_active:     Mapped[bool]      = mapped_column(Boolean, default=True, nullable=False)
    sort_order:    Mapped[int]       = mapped_column(Integer, default=0, nullable=False)
    # Схема конфига — описывает доп. поля (для UI-формы)
    config_schema: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # ── Marketplace fields (marketplace01) ────────────────────────────────────
    # Массив URL картинок (карусель в карточке)
    screenshots:        Mapped[list | None]    = mapped_column(JSONB, nullable=True, default=list)
    # Массив строк-фич («Видеозвонки», «Е-рецепты»...)
    features_list:      Mapped[list | None]    = mapped_column(JSONB, nullable=True, default=list)
    # Дней триала по умолчанию при подключении из marketplace
    default_trial_days: Mapped[int]            = mapped_column(Integer, default=14, nullable=False)
    # Badge «Популярно» в каталоге
    popular:            Mapped[bool]           = mapped_column(Boolean, default=False, nullable=False)
    # easy / medium / hard
    setup_complexity:   Mapped[str]            = mapped_column(String(16), default="easy", nullable=False)
    # «от X ₽/мес» если основная цена 0
    monthly_price_demo: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    created_at:    Mapped[datetime]  = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at:    Mapped[datetime]  = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class TenantModuleSubscription(Base):
    """Подписка конкретного тенанта на коммерческий модуль."""
    __tablename__ = "tenant_module_subscriptions"
    __table_args__ = (UniqueConstraint("tenant_id", "module_key", name="uq_tenant_module_sub"),)

    id:            Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id:     Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key:    Mapped[str]          = mapped_column(String(100), ForeignKey("commercial_modules.key", ondelete="CASCADE"), nullable=False, index=True)
    status:        Mapped[str]          = mapped_column(String(20), default=ModuleStatus.TRIAL, nullable=False)
    billing_cycle: Mapped[str]          = mapped_column(String(20), default="monthly", nullable=False)
    # Переговорная цена (None = берём из каталога)
    custom_price:  Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    trial_days:    Mapped[int]          = mapped_column(Integer, default=0, nullable=False)
    started_at:    Mapped[datetime]     = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at:    Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    grace_until:   Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at:  Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Модульный конфиг (для телефонии — role matrix, для рекламы — остаток показов)
    config:        Mapped[dict | None]  = mapped_column(JSONB, nullable=True)
    notes:         Mapped[str | None]   = mapped_column(Text, nullable=True)
    created_at:    Mapped[datetime]     = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at:    Mapped[datetime]     = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class TenantIntegration(Base):
    """MIS / LIS / BARS / custom интеграция для тенанта."""
    __tablename__ = "tenant_integrations"

    id:             Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id:      Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    type:           Mapped[str]          = mapped_column(String(20), nullable=False)   # mis|lis|bars|custom
    name:           Mapped[str]          = mapped_column(String(200), nullable=False)
    base_url:       Mapped[str]          = mapped_column(String(500), nullable=False)
    api_key:        Mapped[str]          = mapped_column(String(500), nullable=False)
    extra_config:   Mapped[dict | None]  = mapped_column(JSONB, nullable=True)         # доп. заголовки, clinic_ids и т.д.
    is_active:      Mapped[bool]         = mapped_column(Boolean, default=True, nullable=False)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    test_status:    Mapped[str | None]   = mapped_column(String(20), nullable=True)    # ok|error|timeout
    test_error:     Mapped[str | None]   = mapped_column(String(500), nullable=True)
    created_at:     Mapped[datetime]     = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at:     Mapped[datetime]     = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
