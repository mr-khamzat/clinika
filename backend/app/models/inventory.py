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
    Integer,
    Numeric,
    String,
    TIMESTAMP,
    Text,
    UniqueConstraint,
    Index,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
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
        SAEnum(InventoryCategory, name="inventory_category", create_type=False, values_callable=lambda x: [e.value for e in x]),
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
        SAEnum(InventoryMovementType, name="inventory_movement_type", create_type=False, values_callable=lambda x: [e.value for e in x]),
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
    # Этап 1 INVENTORY_COST_PLAN: трассировка списания партии и приёма.
    batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_batches.id", ondelete="SET NULL"),
        nullable=True,
    )
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("appointments.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )


# ─────────── 1С Excel/CSV import audit log (Этап 0) ────────────────────────


class InventoryImportLog(Base):
    """Журнал импортов из Excel/CSV 1С — для аудита и отката."""
    __tablename__ = "inventory_import_logs"
    __table_args__ = (
        Index("ix_inventory_import_logs_tenant_created", "tenant_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clinics.id", ondelete="SET NULL"),
        nullable=True,
    )
    source: Mapped[str] = mapped_column(String(50), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    rows_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_created: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_updated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    mapping_used: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    result_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    errors: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )


# ─────────── Этап 1 INVENTORY_COST_PLAN ────────────────────────────────────


class Supplier(Base):
    """Поставщик (tenant-scoped)."""
    __tablename__ = "suppliers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_suppliers_tenant_name"),
        Index("ix_suppliers_tenant", "tenant_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    inn: Mapped[str | None] = mapped_column(String(12), nullable=True)
    contact_person: Mapped[str | None] = mapped_column(String(200), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    payment_terms: Mapped[str | None] = mapped_column(String(100), nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(),
        onupdate=datetime.utcnow, nullable=False
    )


class InventoryReceipt(Base):
    """Документ прихода (накладная). При проведении создаёт партии + movements."""
    __tablename__ = "inventory_receipts"
    __table_args__ = (
        Index("ix_receipts_tenant_date", "tenant_id", "doc_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id"), nullable=False
    )
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("suppliers.id", ondelete="SET NULL"),
        nullable=True,
    )
    doc_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    doc_date: Mapped[date] = mapped_column(Date, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    attachments: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    posted_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    posted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    external_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(),
        onupdate=datetime.utcnow, nullable=False
    )


class InventoryBatch(Base):
    """Партия товара — основа FIFO-списания.

    qty_remaining уменьшается при каждом outgoing/write_off/expired.
    expires_at = NULL → срок годности не отслеживается.
    """
    __tablename__ = "inventory_batches"
    __table_args__ = (
        Index("ix_batches_tenant", "tenant_id"),
        Index("ix_batches_item", "item_id"),
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
        UUID(as_uuid=True), ForeignKey("inventory_items.id"), nullable=False
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id"), nullable=False
    )
    receipt_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_receipts.id", ondelete="SET NULL"),
        nullable=True,
    )
    movement_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_movements.id", ondelete="SET NULL"),
        nullable=True,
    )
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    qty_received: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    qty_remaining: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False
    )
    expires_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("suppliers.id", ondelete="SET NULL"),
        nullable=True,
    )
    external_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )


# ─────────── Этапы 2-3 INVENTORY_COST_PLAN ─────────────────────────────────


class ServiceConsumable(Base):
    """Норматив расходников на услугу.

    Один service может иметь несколько items (перчатки, шприц, маска…).
    Уникальность по (service_id, item_id) — нельзя добавить тот же item дважды.
    При status='completed' приёма авто-списываем эти позиции по FIFO.
    """
    __tablename__ = "service_consumables"
    __table_args__ = (
        UniqueConstraint(
            "service_id", "item_id",
            name="uq_service_consumables_service_item",
        ),
        Index("ix_service_consumables_service", "service_id"),
        Index("ix_service_consumables_tenant", "tenant_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    service_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("services.id", ondelete="CASCADE"),
        nullable=False,
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    is_optional: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(),
        onupdate=datetime.utcnow, nullable=False
    )


class AppointmentCost(Base):
    """Кешированная себестоимость приёма.

    Пересчитывается:
      • при appointment.status → completed (после авто-списания);
      • при ручном POST /appointments/{id}/cost/recalculate;
      • при reverse_writeoff (откате completed).

    total_cost и margin — GENERATED ALWAYS колонки (на стороне Postgres).
    margin_pct считаем приложением (revenue может быть 0).
    """
    __tablename__ = "appointment_costs"
    __table_args__ = (
        Index("ix_appointment_costs_tenant", "tenant_id"),
    )

    appointment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("appointments.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    materials_cost: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0"
    )
    labor_cost: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0"
    )
    overhead_cost: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0"
    )
    # GENERATED ALWAYS — read-only из приложения.
    total_cost: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    revenue: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0"
    )
    margin: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    margin_pct: Mapped[Decimal | None] = mapped_column(
        Numeric(8, 2), nullable=True
    )
    calculated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
