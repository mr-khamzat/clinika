"""
Inventory module — учёт расходных материалов и оборудования (W7 master plan).

3 таблицы:
- InventoryItem      : справочник товаров (sku, name, category, unit, …).
- InventoryStock     : остатки конкретного item на конкретной clinic
                       (с поддержкой партий — batch_number + expiry_date).
- InventoryMovement  : append-only журнал движений
                       (приход/расход/перемещение/инвентаризация/списание/просрочка).

Тенант-изоляция через tenant_id на всех 3-х таблицах.
ENUM-типы создаются в alembic-миграции inventory01.
"""
import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


# ─────────────────────────── ENUM-типы ────────────────────────────────────


class InventoryCategory(str, enum.Enum):
    """Категория позиции для группировки и отчётов."""
    CONSUMABLE = "consumable"   # расходный материал (перчатки, шприцы …)
    EQUIPMENT  = "equipment"    # оборудование (стерилизатор, УЗИ-датчик)
    MEDICATION = "medication"   # медикаменты (контролируем срок годности)
    REAGENT    = "reagent"      # реактивы для лаборатории
    OTHER      = "other"


class InventoryMovementType(str, enum.Enum):
    """Тип движения. Влияет на знак quantity и логику balance_after."""
    INCOME     = "income"       # приход на склад (положительное quantity)
    OUTGOING   = "outgoing"     # расход (на услугу, процедуру) — отрицательное
    TRANSFER   = "transfer"     # межклиничное перемещение (двойная проводка)
    ADJUSTMENT = "adjustment"   # инвентаризация — корректировка к фактическому
    WRITE_OFF  = "write_off"    # списание брака
    EXPIRED    = "expired"      # списание по окончанию срока годности


# ─────────────────────────── Модели ───────────────────────────────────────


class InventoryItem(Base):
    """Справочник единицы учёта (общий для всех клиник тенанта)."""
    __tablename__ = "inventory_items"
    __table_args__ = (
        UniqueConstraint("tenant_id", "sku", name="uq_inventory_item_tenant_sku"),
        Index("ix_inventory_items_tenant_id", "tenant_id"),
        Index("ix_inventory_items_sku", "sku"),
        Index("ix_inventory_items_barcode", "barcode"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    sku: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[InventoryCategory] = mapped_column(
        SAEnum(InventoryCategory, name="inventory_category", create_type=False),
        nullable=False,
        default=InventoryCategory.CONSUMABLE,
    )
    unit: Mapped[str] = mapped_column(String(20), nullable=False, default="шт")
    barcode: Mapped[str | None] = mapped_column(String(100), nullable=True)
    vendor: Mapped[str | None] = mapped_column(String(200), nullable=True)
    cost_per_unit: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    # Порог для low-stock-alert (суммарно по всем клиникам/партиям).
    min_stock_threshold: Mapped[Decimal] = mapped_column(
        Numeric(12, 3), nullable=False, default=Decimal("0")
    )
    # Если True — обязательно требуем expiry_date в InventoryStock.
    expiry_tracked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class InventoryStock(Base):
    """Текущий остаток item-а на клинике (опционально с разбивкой по партии).

    Уникальность по (item_id, clinic_id, batch_number) — позволяет
    хранить разные партии одного и того же item-а с разными expiry.
    """
    __tablename__ = "inventory_stocks"
    __table_args__ = (
        UniqueConstraint(
            "item_id", "clinic_id", "batch_number",
            name="uq_inventory_stock_item_clinic_batch",
        ),
        Index("ix_inventory_stocks_tenant_id", "tenant_id"),
        Index("ix_inventory_stocks_item_clinic", "item_id", "clinic_id"),
        Index("ix_inventory_stocks_expiry", "expiry_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clinics.id", ondelete="CASCADE"),
        nullable=False,
    )
    quantity: Mapped[Decimal] = mapped_column(
        Numeric(12, 3), nullable=False, default=Decimal("0")
    )
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Пустая строка вместо NULL чтобы UNIQUE-индекс работал
    # (PostgreSQL трактует NULL как «не равно ничему»).
    batch_number: Mapped[str] = mapped_column(
        String(50), nullable=False, default=""
    )
    last_counted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class InventoryMovement(Base):
    """Append-only журнал любого движения остатков.

    quantity:
      - income, transfer (поступление в to_clinic), adjustment (если +) — положительное
      - outgoing, write_off, expired, transfer (списание из from_clinic) — отрицательное
    balance_after — итоговый остаток ИМЕННО ЭТОГО (item_id, clinic_id, batch_number)
                    после применения операции.
    """
    __tablename__ = "inventory_movements"
    __table_args__ = (
        Index("ix_inventory_movements_tenant_id", "tenant_id"),
        Index("ix_inventory_movements_item_clinic", "item_id", "clinic_id"),
        Index("ix_inventory_movements_type", "type"),
        Index("ix_inventory_movements_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clinics.id", ondelete="CASCADE"),
        nullable=False,
    )
    type: Mapped[InventoryMovementType] = mapped_column(
        SAEnum(InventoryMovementType, name="inventory_movement_type", create_type=False),
        nullable=False,
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    balance_after: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    batch_number: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Куда «прицеплено» движение: appointment / treatment / vendor_invoice / transfer …
    ref_entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ref_entity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    performed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
