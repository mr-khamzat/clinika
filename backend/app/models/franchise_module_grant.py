"""
Модель `FranchiseModuleGrant` — распределение модулей внутри франшизы.

Логика:
- Платформа продаёт модуль франшизе (запись в commercial_modules + tenant_module_subscriptions для franchise root tenant).
- Франшиза распределяет этот модуль между своими подтенантами через FranchiseModuleGrant.
- internal_price_rub — сколько франшиза взимает с этой клиники в месяц за этот модуль
  (0 = бесплатно для клиники, всё несёт франшиза).
- При создании Grant также создаётся/активируется TenantModuleSubscription у дочернего тенанта,
  чтобы модуль реально работал.

Внутренние акты:
- Раз в месяц джоб смотрит все активные Grant'ы → считает сумму к оплате
  для каждой клиники → пишет в `franchise_internal_acts` (если is_billable).
"""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    String, Boolean, DateTime, ForeignKey, Numeric, UniqueConstraint, Index,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FranchiseModuleGrant(Base):
    __tablename__ = "franchise_module_grants"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    franchise_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("franchises.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # Ключ модуля из commercial_modules.key (например 'telemedicine', 'call_recording', 'ai_assistant')
    module_key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    # Внутренняя цена франшизы для этой клиники (₽/мес). 0 = бесплатно.
    internal_price_rub: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow,
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("franchise_id", "tenant_id", "module_key", name="uq_franchise_module_tenant"),
        Index("ix_franchise_module_grants_tenant", "tenant_id"),
        Index("ix_franchise_module_grants_module", "module_key"),
    )


class FranchiseInternalAct(Base):
    """Ежемесячный акт от франшизы клинике за пользование модулями.

    Создаётся джобом 1-го числа каждого месяца.
    Сумма = SUM(FranchiseModuleGrant.internal_price_rub) для tenant_id за месяц.
    """
    __tablename__ = "franchise_internal_acts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    franchise_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("franchises.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # Период (YYYY-MM): "2026-05"
    period: Mapped[str] = mapped_column(String(7), nullable=False, index=True)
    # Сумма к оплате
    total_rub: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Детализация: список модулей с ценами {module_key: price}
    breakdown_json: Mapped[str] = mapped_column(String(2000), nullable=False, default="{}")
    # Статус: pending / paid / cancelled
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint("franchise_id", "tenant_id", "period", name="uq_franchise_act_period"),
    )
