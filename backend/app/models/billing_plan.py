"""
Тарифные планы и правила ценообразования тенанта.

TenantPlan — каталог планов в БД (вместо хардкода PLAN_PRICES).
TenantPricingRules — индивидуальные условия: скидки, revenue split, franchise fee.

Улучшение vs хардкода:
  - Добавить/изменить план без деплоя
  - Кастомные планы для Enterprise-клиентов
  - Индивидуальный split% на тенанта (франшиза vs прямой)
"""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, Boolean, DateTime, Numeric, Integer, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class TenantPlan(Base):
    """
    Каталог тарифных планов SaaS.
    Seed: basic / professional / enterprise.
    Можно добавлять кастомные планы для крупных клиентов без деплоя.
    """
    __tablename__ = "tenant_plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Slug: basic / professional / enterprise / custom_<id>
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Ценообразование (РУБ)
    base_price_month: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    base_price_year: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))

    # Лимиты ресурсов (-1 = безлимит)
    max_clinics: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    max_users: Mapped[int] = mapped_column(Integer, nullable=False, default=20)

    # Включённые фичи: {"scheduling": true, "analytics": true, "kpi": false, ...}
    features: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # UI: порядок отображения на странице тарифов
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # is_public=False — скрытый план (Enterprise custom, не показываем публично)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class TenantPricingRules(Base):
    """
    Индивидуальные условия ценообразования для конкретного тенанта.

    Используется для:
    - Revenue split при монетизации плагинов и рекламы
    - Franchise fee (% от дохода тенанта → головной офис)
    - Индивидуальных скидок на подписку

    Дефолты: plugin_split=30%, ad_split=20%, franchise=0%, discount=0%
    """
    __tablename__ = "tenant_pricing_rules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True  # один набор правил на тенанта
    )

    # Ценовые границы для пользовательских транзакций (None = без ограничений)
    min_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    max_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    # Revenue split: % от платежа → платформе (остальное → тенанту)
    plugin_split_percent: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("30.00")
    )
    ad_split_percent: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("20.00")
    )

    # Франшизный сбор: % от net-дохода тенанта → головному офису
    # 0.00 для прямых тенантов, >0 для франчайзи
    franchise_fee_percent: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("0.00")
    )

    # Индивидуальная скидка на подписку (договорная)
    subscription_discount_percent: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("0.00")
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
