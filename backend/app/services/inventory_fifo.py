"""FIFO-сервис списания со склада с учётом партий и сроков годности.

Используется при:
  • Завершении приёма (completed) — авто-списание по протоколу.
  • Ручном write-off из конкретной партии (брак/потеря).
  • Реверсе списаний при откате completed→in_progress.

Порядок партий: expires_at ASC NULLS LAST, received_at ASC.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory import (
    InventoryBatch,
    InventoryMovement,
    InventoryMovementType,
    InventoryStock,
)


class InsufficientStockError(Exception):
    """Недостаточно остатка для списания."""

    def __init__(self, item_id, requested, available):
        self.item_id = item_id
        self.requested = requested
        self.available = available
        super().__init__(
            f"Недостаточно: запрошено {requested}, доступно {available}"
        )


async def writeoff_fifo(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    item_id: uuid.UUID,
    clinic_id: uuid.UUID,
    quantity: Decimal,
    appointment_id: Optional[uuid.UUID] = None,
    reason: str = "auto",
    user_id: Optional[uuid.UUID] = None,
    comment: Optional[str] = None,
    movement_type: InventoryMovementType = InventoryMovementType.WRITE_OFF,
    allow_negative: bool = False,
) -> list[dict]:
    """Списать quantity единиц item по FIFO.

    Возвращает список dict'ов: [{batch_id, qty, unit_cost, total_cost}, ...].
    Создаёт inventory_movements (по одному на каждую партию).
    Обновляет qty_remaining партий и InventoryStock.quantity (суммарно).
    """
    quantity = Decimal(str(quantity))
    if quantity <= 0:
        return []

    q = (
        select(InventoryBatch)
        .where(
            InventoryBatch.tenant_id == tenant_id,
            InventoryBatch.item_id == item_id,
            InventoryBatch.clinic_id == clinic_id,
            InventoryBatch.qty_remaining > 0,
        )
        .order_by(
            InventoryBatch.expires_at.asc().nullslast(),
            InventoryBatch.received_at.asc(),
        )
        .with_for_update()
    )
    batches = (await db.execute(q)).scalars().all()

    total_available = sum((b.qty_remaining for b in batches), Decimal("0"))
    if total_available < quantity and not allow_negative:
        raise InsufficientStockError(item_id, quantity, total_available)

    # Текущий суммарный остаток по item/clinic для balance_after.
    stock_rows = (await db.execute(
        select(InventoryStock).where(
            InventoryStock.tenant_id == tenant_id,
            InventoryStock.item_id == item_id,
            InventoryStock.clinic_id == clinic_id,
        )
    )).scalars().all()
    running_balance = sum((s.quantity for s in stock_rows), Decimal("0"))

    remaining = quantity
    results: list[dict] = []
    for batch in batches:
        if remaining <= 0:
            break
        take = min(batch.qty_remaining, remaining)
        batch.qty_remaining = batch.qty_remaining - take
        remaining -= take
        running_balance -= take

        movement = InventoryMovement(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            item_id=item_id,
            clinic_id=clinic_id,
            type=movement_type,
            quantity=-take,
            balance_after=running_balance,
            batch_number=batch.batch_number or "",
            expiry_date=batch.expires_at,
            batch_id=batch.id,
            appointment_id=appointment_id,
            ref_entity_type="appointment" if appointment_id else None,
            ref_entity_id=appointment_id,
            comment=comment or f"FIFO writeoff ({reason})",
            performed_by_user_id=user_id,
            created_at=datetime.utcnow(),
        )
        db.add(movement)
        results.append({
            "batch_id": str(batch.id),
            "qty": float(take),
            "unit_cost": float(batch.unit_cost),
            "total_cost": float(take * batch.unit_cost),
        })

    # Обновить кеш InventoryStock — уменьшить пропорционально по первой строке.
    # InventoryStock хранит остатки по batch_number, но списание по FIFO
    # затрагивает несколько партий → уменьшаем по убыванию quantity.
    to_subtract = quantity
    for s in sorted(stock_rows, key=lambda r: r.quantity or 0, reverse=True):
        if to_subtract <= 0:
            break
        take = min(s.quantity or Decimal("0"), to_subtract)
        s.quantity = (s.quantity or Decimal("0")) - take
        to_subtract -= take

    return results


async def writeoff_from_batch(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    batch_id: uuid.UUID,
    quantity: Decimal,
    reason: str = "damaged",
    user_id: Optional[uuid.UUID] = None,
    comment: Optional[str] = None,
    movement_type: InventoryMovementType = InventoryMovementType.WRITE_OFF,
) -> dict:
    """Списать из КОНКРЕТНОЙ партии (для брака/потери/просрочки)."""
    quantity = Decimal(str(quantity))
    if quantity <= 0:
        raise ValueError("quantity must be > 0")

    batch = (await db.execute(
        select(InventoryBatch).where(
            InventoryBatch.id == batch_id,
            InventoryBatch.tenant_id == tenant_id,
        ).with_for_update()
    )).scalar_one_or_none()
    if not batch:
        raise ValueError("batch not found")
    if batch.qty_remaining < quantity:
        raise InsufficientStockError(batch.item_id, quantity, batch.qty_remaining)

    batch.qty_remaining = batch.qty_remaining - quantity

    stock_rows = (await db.execute(
        select(InventoryStock).where(
            InventoryStock.tenant_id == tenant_id,
            InventoryStock.item_id == batch.item_id,
            InventoryStock.clinic_id == batch.clinic_id,
        )
    )).scalars().all()
    running_balance = sum((s.quantity for s in stock_rows), Decimal("0")) - quantity

    movement = InventoryMovement(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        item_id=batch.item_id,
        clinic_id=batch.clinic_id,
        type=movement_type,
        quantity=-quantity,
        balance_after=running_balance,
        batch_number=batch.batch_number or "",
        expiry_date=batch.expires_at,
        batch_id=batch.id,
        comment=comment or f"Manual writeoff from batch ({reason})",
        performed_by_user_id=user_id,
        created_at=datetime.utcnow(),
    )
    db.add(movement)

    to_subtract = quantity
    for s in sorted(stock_rows, key=lambda r: r.quantity or 0, reverse=True):
        if to_subtract <= 0:
            break
        take = min(s.quantity or Decimal("0"), to_subtract)
        s.quantity = (s.quantity or Decimal("0")) - take
        to_subtract -= take

    return {
        "batch_id": str(batch.id),
        "qty": float(quantity),
        "unit_cost": float(batch.unit_cost),
        "total_cost": float(quantity * batch.unit_cost),
    }


async def reverse_writeoff(
    db: AsyncSession,
    *,
    appointment_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> int:
    """Реверс списаний при откате completed→in_progress.

    Возвращает количество восстановленных movement'ов.
    """
    q = select(InventoryMovement).where(
        InventoryMovement.appointment_id == appointment_id,
        InventoryMovement.tenant_id == tenant_id,
        InventoryMovement.quantity < 0,
    )
    movements = (await db.execute(q)).scalars().all()

    count = 0
    for m in movements:
        qty = abs(m.quantity)

        if m.batch_id:
            batch = await db.get(InventoryBatch, m.batch_id)
            if batch:
                batch.qty_remaining = (batch.qty_remaining or Decimal("0")) + qty

        stock_rows = (await db.execute(
            select(InventoryStock).where(
                InventoryStock.tenant_id == tenant_id,
                InventoryStock.item_id == m.item_id,
                InventoryStock.clinic_id == m.clinic_id,
            )
        )).scalars().all()
        running_balance = sum((s.quantity for s in stock_rows), Decimal("0")) + qty

        reverse_m = InventoryMovement(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            item_id=m.item_id,
            clinic_id=m.clinic_id,
            type=InventoryMovementType.INCOME,
            quantity=qty,
            balance_after=running_balance,
            batch_number=m.batch_number or "",
            expiry_date=m.expiry_date,
            batch_id=m.batch_id,
            appointment_id=appointment_id,
            ref_entity_type="appointment_reversal",
            ref_entity_id=appointment_id,
            comment="Реверс списания (отмена приёма)",
            created_at=datetime.utcnow(),
        )
        db.add(reverse_m)

        # Положить qty обратно в первую строку stock (или создать пустую — но
        # InventoryStock у нас всегда существует если был приход).
        if stock_rows:
            target = max(stock_rows, key=lambda r: r.quantity or 0)
            target.quantity = (target.quantity or Decimal("0")) + qty
        count += 1

    return count
