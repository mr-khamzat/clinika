"""
SubscriptionPlan — каталог тарифов подписки «Здоровье+».

См. миграцию subplans01.

Виды записей:
  - Глобальный шаблон: tenant_id IS NULL — управляет super_admin
  - Override:          tenant_id IS NOT NULL — управляет franchise_owner

При чтении effective_plan для тенанта override применяется поверх шаблона.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import (
    String, Boolean, DateTime, ForeignKey, Numeric, Text, Integer,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class SubscriptionPlan(Base):
    __tablename__ = "subscription_plans"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    plan_key: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price_monthly: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    price_annual: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    trial_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7)
    benefits: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    features: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow,
        nullable=False,
    )
