"""SubscriptionPlanDiscount — дифференцированные скидки тарифа подписки.

См. миграцию discountrules01.

Виды записей по scope:
  - 'all'      — на ВСЕ услуги плана (fallback);
  - 'category' — на услуги конкретной категории (services.category — строка,
                 либо future category_id, если появится отдельная таблица);
  - 'service'  — на одну конкретную услугу.

Глобальное правило: tenant_id IS NULL (управляет super_admin).
Tenant-правило: tenant_id IS NOT NULL — приоритетнее глобальных.
"""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import String, Boolean, DateTime, ForeignKey, Numeric
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SubscriptionPlanDiscount(Base):
    __tablename__ = "subscription_plan_discounts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=True,
    )
    plan_key: Mapped[str] = mapped_column(String(40), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True,
    )
    category_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    service_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("services.id", ondelete="CASCADE"),
        nullable=True,
    )
    discount_percent: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
        default=datetime.utcnow, onupdate=datetime.utcnow,
    )
