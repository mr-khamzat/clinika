"""Калькуляция себестоимости приёма (Этап 3 INVENTORY_COST_PLAN).

Соединяет 3 компонента:
  • service_consumables — нормативы расходников на услугу.
  • inventory_fifo.writeoff_fifo() — FIFO-списание партий со склада.
  • appointment_costs — кеш себестоимости и маржи.

Точки подключения:
  • on_appointment_completed() — при смене status → completed.
  • on_appointment_uncomplete() — при откате completed → in_progress.
  • recalculate_cost() — ручной пересчёт (manager UI).

Все функции глотают исключения списания: смену статуса приёма НЕ блокируем,
ошибки логируем (warning).

Связка appointment → service:
  appointment.referral_id → referrals.service_id → services.id
  (т.к. приём не имеет прямой связи со услугой в текущей схеме).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.doctor import Appointment, AppointmentStatus
from app.models.inventory import (
    AppointmentCost,
    InventoryBatch,
    InventoryItem,
    InventoryMovement,
    InventoryMovementType,
    ServiceConsumable,
)
from app.models.payments_clinic import ClinicPayment, ClinicPaymentStatus
from app.services.inventory_fifo import (
    InsufficientStockError,
    reverse_writeoff,
    writeoff_fifo,
)

logger = logging.getLogger("appointment_costing")


# ─────────────────────── private helpers ──────────────────────────────────


async def _get_service_ids_for_appointment(
    db: AsyncSession, appointment: Appointment
) -> list[uuid.UUID]:
    """Найти список service_id, связанных с приёмом.

    Сейчас связь приём → услуга идёт через referral.service_id.
    Если referral отсутствует — список пустой (нет нормативов для списания).
    """
    if not appointment.referral_id:
        return []
    # Lazy import: модель Referral импортируется здесь чтобы не плодить циклы
    from app.models.referral import Referral

    r = (
        await db.execute(
            select(Referral.service_id).where(
                Referral.id == appointment.referral_id,
                Referral.service_id.isnot(None),
            )
        )
    ).scalar_one_or_none()
    if r is None:
        return []
    return [r]


async def _sum_materials_cost(
    db: AsyncSession, appointment_id: uuid.UUID
) -> Decimal:
    """Сумма стоимости материалов, реально списанных под приём.

    Источник правды — inventory_movements (type IN write_off|outgoing,
    quantity<0, appointment_id=X) + JOIN inventory_batches.unit_cost.

    Реверсы (type=income, ref_entity_type='appointment_reversal') не учитываем.
    """
    # Списания: abs(quantity) * batch.unit_cost.
    q_with_batch = (
        select(
            func.coalesce(
                func.sum(
                    func.abs(InventoryMovement.quantity)
                    * InventoryBatch.unit_cost
                ),
                0,
            )
        )
        .select_from(InventoryMovement)
        .join(InventoryBatch, InventoryBatch.id == InventoryMovement.batch_id)
        .where(
            InventoryMovement.appointment_id == appointment_id,
            InventoryMovement.type.in_(
                [
                    InventoryMovementType.WRITE_OFF,
                    InventoryMovementType.OUTGOING,
                ]
            ),
            InventoryMovement.quantity < 0,
        )
    )
    r1 = await db.execute(q_with_batch)
    with_batch = Decimal(str(r1.scalar() or 0))

    # Запасной путь: если batch_id NULL (старые движения) — fallback на
    # item.cost_per_unit. Не двойное считание: фильтр batch_id IS NULL.
    q_no_batch = (
        select(
            func.coalesce(
                func.sum(
                    func.abs(InventoryMovement.quantity)
                    * InventoryItem.cost_per_unit
                ),
                0,
            )
        )
        .select_from(InventoryMovement)
        .join(InventoryItem, InventoryItem.id == InventoryMovement.item_id)
        .where(
            InventoryMovement.appointment_id == appointment_id,
            InventoryMovement.type.in_(
                [
                    InventoryMovementType.WRITE_OFF,
                    InventoryMovementType.OUTGOING,
                ]
            ),
            InventoryMovement.quantity < 0,
            InventoryMovement.batch_id.is_(None),
        )
    )
    r2 = await db.execute(q_no_batch)
    no_batch = Decimal(str(r2.scalar() or 0))

    return with_batch + no_batch


async def _sum_revenue(
    db: AsyncSession, appointment_id: uuid.UUID
) -> Decimal:
    """Сумма succeeded-платежей пациента по приёму."""
    q = select(func.coalesce(func.sum(ClinicPayment.amount), 0)).where(
        ClinicPayment.appointment_id == appointment_id,
        ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED,
    )
    r = await db.execute(q)
    return Decimal(str(r.scalar() or 0))


# ─────────────────────── public API ───────────────────────────────────────


async def calculate_appointment_cost(
    db: AsyncSession,
    appointment_id: uuid.UUID,
    *,
    recalc_revenue: bool = True,
    notes: Optional[str] = None,
) -> AppointmentCost:
    """Пересчитать appointment_costs для одного приёма.

    Создаёт строку если её ещё нет.
    Возвращает обновлённый ORM-объект.

    На MVP: labor_cost=0, overhead_cost=0 (ФОТ и накладные — в плане v3).
    """
    appt = (
        await db.execute(
            select(Appointment).where(Appointment.id == appointment_id)
        )
    ).scalar_one_or_none()
    if not appt:
        raise ValueError(f"appointment {appointment_id} not found")

    if appt.tenant_id is None:
        raise ValueError(
            f"appointment {appointment_id} has no tenant_id — cannot cost"
        )

    materials = await _sum_materials_cost(db, appointment_id)
    revenue = (
        await _sum_revenue(db, appointment_id)
        if recalc_revenue
        else Decimal("0")
    )

    # margin_pct считаем приложением: margin/revenue*100 (избегаем DIV BY ZERO).
    labor = Decimal("0")
    overhead = Decimal("0")
    margin = revenue - materials - labor - overhead
    margin_pct: Optional[Decimal] = None
    if revenue and revenue > 0:
        margin_pct = (margin / revenue * Decimal("100")).quantize(Decimal("0.01"))

    cost = (
        await db.execute(
            select(AppointmentCost).where(
                AppointmentCost.appointment_id == appointment_id
            )
        )
    ).scalar_one_or_none()

    if cost is None:
        cost = AppointmentCost(
            appointment_id=appointment_id,
            tenant_id=appt.tenant_id,
            materials_cost=materials,
            labor_cost=labor,
            overhead_cost=overhead,
            revenue=revenue,
            margin_pct=margin_pct,
            calculated_at=datetime.utcnow(),
            notes=notes,
        )
        db.add(cost)
    else:
        cost.materials_cost = materials
        cost.labor_cost = labor
        cost.overhead_cost = overhead
        if recalc_revenue:
            cost.revenue = revenue
        cost.margin_pct = margin_pct
        cost.calculated_at = datetime.utcnow()
        if notes is not None:
            cost.notes = notes

    await db.flush()
    return cost


async def _writeoff_norms_for_service(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    clinic_id: uuid.UUID,
    appointment_id: uuid.UUID,
    service_id: uuid.UUID,
    user_id: Optional[uuid.UUID],
) -> tuple[int, list[str]]:
    """Списать нормативы одной услуги. Возвращает (успешно, [ошибки])."""
    norms = (
        await db.execute(
            select(ServiceConsumable).where(
                ServiceConsumable.service_id == service_id,
                ServiceConsumable.tenant_id == tenant_id,
            )
        )
    ).scalars().all()

    ok = 0
    errors: list[str] = []
    for n in norms:
        try:
            await writeoff_fifo(
                db,
                tenant_id=tenant_id,
                item_id=n.item_id,
                clinic_id=clinic_id,
                quantity=Decimal(str(n.quantity)),
                appointment_id=appointment_id,
                reason="appointment_completed",
                user_id=user_id,
                comment=f"Auto write-off (service={service_id})",
                movement_type=InventoryMovementType.WRITE_OFF,
            )
            ok += 1
        except InsufficientStockError as e:
            # Если позиция опциональная — пропустим тихо. Иначе — лог + продолжаем.
            msg = (
                f"item={n.item_id} req={e.requested} avail={e.available} "
                f"(optional={n.is_optional})"
            )
            if not n.is_optional:
                errors.append(msg)
            logger.warning(
                "writeoff insufficient stock: appt=%s svc=%s %s",
                appointment_id, service_id, msg,
            )
        except Exception as e:  # noqa: BLE001
            errors.append(f"item={n.item_id}: {e}")
            logger.warning(
                "writeoff error: appt=%s svc=%s item=%s err=%s",
                appointment_id, service_id, n.item_id, e,
            )
    return ok, errors


async def on_appointment_completed(
    db: AsyncSession,
    appointment_id: uuid.UUID,
    user_id: Optional[uuid.UUID] = None,
    *,
    actual_consumables: Optional[list[dict]] = None,
) -> dict:
    """Hook на переход статуса → completed.

    1. Идемпотентность: если уже есть movement'ы с этим appointment_id и
       type=write_off, повторно списывать не будем.
    2. Найти услуги приёма (через referral.service_id).
    3. Для каждой услуги — взять service_consumables, списать по FIFO.
       Если actual_consumables передано — использовать его вместо нормативов
       (зарезервировано на будущее, MVP игнорирует).
    4. Пересчитать appointment_costs.

    Возвращает summary dict — не бросает.
    """
    summary = {
        "appointment_id": str(appointment_id),
        "writeoff_count": 0,
        "skipped_reason": None,
        "errors": [],
    }
    try:
        appt = (
            await db.execute(
                select(Appointment).where(Appointment.id == appointment_id)
            )
        ).scalar_one_or_none()
        if not appt or not appt.tenant_id:
            summary["skipped_reason"] = "no_tenant"
            return summary

        # Идемпотентность: уже списано ранее (и ещё не реверснуто)?
        # Учитываем только НЕ-реверснутые WRITE_OFF: после отката приёма
        # (reverse_writeoff помечает их reversed=True) повторный complete
        # должен снова списать материалы, а не уйти в already_written_off.
        existing = (
            await db.execute(
                select(func.count(InventoryMovement.id)).where(
                    InventoryMovement.appointment_id == appointment_id,
                    InventoryMovement.type == InventoryMovementType.WRITE_OFF,
                    InventoryMovement.reversed.is_(False),
                )
            )
        ).scalar() or 0
        if existing > 0:
            summary["skipped_reason"] = "already_written_off"
            # Всё равно пересчитаем cost
            cost = await calculate_appointment_cost(
                db, appointment_id, recalc_revenue=True
            )
            summary["materials_cost"] = float(cost.materials_cost or 0)
            summary["revenue"] = float(cost.revenue or 0)
            return summary

        service_ids = await _get_service_ids_for_appointment(db, appt)
        for sid in service_ids:
            ok, errs = await _writeoff_norms_for_service(
                db,
                tenant_id=appt.tenant_id,
                clinic_id=appt.clinic_id,
                appointment_id=appointment_id,
                service_id=sid,
                user_id=user_id,
            )
            summary["writeoff_count"] += ok
            summary["errors"].extend(errs)

        # Пересчёт себестоимости (даже если списаний 0 — revenue может быть).
        cost = await calculate_appointment_cost(
            db, appointment_id, recalc_revenue=True
        )
        summary["materials_cost"] = float(cost.materials_cost or 0)
        summary["revenue"] = float(cost.revenue or 0)
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "on_appointment_completed failed for %s: %s", appointment_id, e
        )
        summary["errors"].append(str(e))
    return summary


async def on_appointment_uncomplete(
    db: AsyncSession,
    appointment_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> dict:
    """Hook на откат completed → не-completed.

    Реверсит ранее созданные write_off-движения по приёму, восстанавливает
    qty_remaining в партиях и InventoryStock. Также обнуляет materials_cost.
    """
    summary = {
        "appointment_id": str(appointment_id),
        "reversed_count": 0,
        "errors": [],
    }
    try:
        n = await reverse_writeoff(
            db, appointment_id=appointment_id, tenant_id=tenant_id
        )
        summary["reversed_count"] = n

        # Обнулим materials в кеше себестоимости.
        cost = (
            await db.execute(
                select(AppointmentCost).where(
                    AppointmentCost.appointment_id == appointment_id
                )
            )
        ).scalar_one_or_none()
        if cost is not None:
            cost.materials_cost = Decimal("0")
            cost.margin_pct = None
            cost.calculated_at = datetime.utcnow()
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "on_appointment_uncomplete failed for %s: %s", appointment_id, e
        )
        summary["errors"].append(str(e))
    return summary


async def cost_breakdown(
    db: AsyncSession, appointment_id: uuid.UUID
) -> dict:
    """Возвращает детализацию себестоимости + список movement'ов."""
    cost = (
        await db.execute(
            select(AppointmentCost).where(
                AppointmentCost.appointment_id == appointment_id
            )
        )
    ).scalar_one_or_none()

    # Детализация по движениям.
    q = (
        select(
            InventoryMovement.id,
            InventoryMovement.item_id,
            InventoryItem.name,
            InventoryItem.unit,
            InventoryMovement.quantity,
            InventoryMovement.batch_id,
            InventoryBatch.unit_cost,
            InventoryMovement.type,
            InventoryMovement.created_at,
        )
        .select_from(InventoryMovement)
        .join(InventoryItem, InventoryItem.id == InventoryMovement.item_id)
        .outerjoin(InventoryBatch, InventoryBatch.id == InventoryMovement.batch_id)
        .where(InventoryMovement.appointment_id == appointment_id)
        .order_by(InventoryMovement.created_at)
    )
    rows = (await db.execute(q)).all()
    items: list[dict] = []
    for r in rows:
        unit_cost = r.unit_cost or Decimal("0")
        qty = abs(Decimal(str(r.quantity or 0)))
        items.append(
            {
                "movement_id": str(r.id),
                "item_id": str(r.item_id),
                "item_name": r.name,
                "unit": r.unit,
                "quantity": float(qty),
                "unit_cost": float(unit_cost),
                "total": float(qty * unit_cost),
                "type": r.type.value if hasattr(r.type, "value") else str(r.type),
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
        )

    return {
        "appointment_id": str(appointment_id),
        "cost": (
            {
                "materials_cost": float(cost.materials_cost or 0),
                "labor_cost": float(cost.labor_cost or 0),
                "overhead_cost": float(cost.overhead_cost or 0),
                "total_cost": float(cost.total_cost or 0)
                if cost.total_cost is not None
                else float(
                    (cost.materials_cost or 0)
                    + (cost.labor_cost or 0)
                    + (cost.overhead_cost or 0)
                ),
                "revenue": float(cost.revenue or 0),
                "margin": float(cost.margin) if cost.margin is not None else None,
                "margin_pct": float(cost.margin_pct)
                if cost.margin_pct is not None
                else None,
                "calculated_at": cost.calculated_at.isoformat()
                if cost.calculated_at
                else None,
            }
            if cost
            else None
        ),
        "consumables": items,
    }
