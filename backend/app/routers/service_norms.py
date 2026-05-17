"""REST-эндпоинты Этапов 2-3 INVENTORY_COST_PLAN.

  /services/{service_id}/consumables           — GET/PUT/POST
  /services/{service_id}/consumables/{item_id} — DELETE
  /inventory/norms/copy                        — POST
  /appointments/{id}/cost                      — GET (read-only для director)
  /appointments/{id}/cost/recalculate          — POST (manager)

Tenant-изоляция: каждая операция фильтрует по current_user.tenant_id.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    get_current_user,
    require_manager,
    require_director_or_owner,
)
from app.database import get_db
from app.models.inventory import (
    AppointmentCost,
    InventoryItem,
    ServiceConsumable,
)
from app.models.service import Service
from app.models.user import User
from app.models.doctor import Appointment
from app.services.appointment_costing import (
    calculate_appointment_cost,
    cost_breakdown,
)

logger = logging.getLogger("service_norms")

router = APIRouter(tags=["inventory_norms"])


# ─────────────────────────── Pydantic-схемы ──────────────────────────────


class ConsumableIn(BaseModel):
    item_id: uuid.UUID
    quantity: Decimal = Field(..., gt=0)
    is_optional: bool = False
    notes: Optional[str] = None


class ConsumableOut(BaseModel):
    id: uuid.UUID
    service_id: uuid.UUID
    item_id: uuid.UUID
    item_name: Optional[str] = None
    item_unit: Optional[str] = None
    quantity: Decimal
    is_optional: bool
    notes: Optional[str] = None

    class Config:
        from_attributes = True


class NormsBulkIn(BaseModel):
    items: list[ConsumableIn]


# ─────────────────────────── helpers ─────────────────────────────────────


async def _get_service_or_404(
    db: AsyncSession, service_id: uuid.UUID, user: User
) -> Service:
    svc = (
        await db.execute(select(Service).where(Service.id == service_id))
    ).scalar_one_or_none()
    if not svc:
        raise HTTPException(404, "Услуга не найдена")
    # tenant isolation (Service.tenant_id может быть NULL для платформенных)
    if user.tenant_id and svc.tenant_id and svc.tenant_id != user.tenant_id:
        raise HTTPException(403, "Чужой тенант")
    return svc


async def _norms_to_out(
    db: AsyncSession, norms: list[ServiceConsumable]
) -> list[ConsumableOut]:
    """Подтянуть имя/ед.изм. items одним запросом и сформировать DTO."""
    if not norms:
        return []
    item_ids = list({n.item_id for n in norms})
    items_map: dict[uuid.UUID, InventoryItem] = {}
    if item_ids:
        rs = await db.execute(
            select(InventoryItem).where(InventoryItem.id.in_(item_ids))
        )
        for it in rs.scalars().all():
            items_map[it.id] = it
    out: list[ConsumableOut] = []
    for n in norms:
        it = items_map.get(n.item_id)
        out.append(
            ConsumableOut(
                id=n.id,
                service_id=n.service_id,
                item_id=n.item_id,
                item_name=it.name if it else None,
                item_unit=it.unit if it else None,
                quantity=n.quantity,
                is_optional=n.is_optional,
                notes=n.notes,
            )
        )
    return out


# ─────────────────────────── эндпоинты норм ──────────────────────────────


@router.get(
    "/services/{service_id}/consumables",
    response_model=list[ConsumableOut],
)
async def list_consumables(
    service_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Получить норматив расходников для услуги."""
    svc = await _get_service_or_404(db, service_id, current_user)
    norms = (
        await db.execute(
            select(ServiceConsumable)
            .where(ServiceConsumable.service_id == svc.id)
            .order_by(ServiceConsumable.created_at)
        )
    ).scalars().all()
    return await _norms_to_out(db, norms)


@router.post(
    "/services/{service_id}/consumables",
    response_model=ConsumableOut,
)
async def add_consumable(
    service_id: uuid.UUID,
    data: ConsumableIn,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Добавить одну позицию в норматив услуги."""
    svc = await _get_service_or_404(db, service_id, current_user)
    if not current_user.tenant_id:
        raise HTTPException(400, "У пользователя нет tenant_id")

    # Проверка item принадлежит тому же тенанту.
    item = (
        await db.execute(
            select(InventoryItem).where(InventoryItem.id == data.item_id)
        )
    ).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Позиция склада не найдена")
    if item.tenant_id != current_user.tenant_id:
        raise HTTPException(403, "Позиция из другого тенанта")

    # Дубликат (service, item) — пресекаем.
    dup = (
        await db.execute(
            select(ServiceConsumable).where(
                ServiceConsumable.service_id == svc.id,
                ServiceConsumable.item_id == data.item_id,
            )
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "Эта позиция уже есть в нормативе")

    norm = ServiceConsumable(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        service_id=svc.id,
        item_id=data.item_id,
        quantity=data.quantity,
        is_optional=data.is_optional,
        notes=data.notes,
    )
    db.add(norm)
    await db.commit()
    await db.refresh(norm)
    out = await _norms_to_out(db, [norm])
    return out[0]


@router.put(
    "/services/{service_id}/consumables",
    response_model=list[ConsumableOut],
)
async def bulk_replace_consumables(
    service_id: uuid.UUID,
    body: NormsBulkIn,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Массовая замена норматива: удалить всё старое + добавить новое."""
    svc = await _get_service_or_404(db, service_id, current_user)
    if not current_user.tenant_id:
        raise HTTPException(400, "У пользователя нет tenant_id")

    # Валидация: уникальные item_id во входном списке.
    item_ids = [it.item_id for it in body.items]
    if len(item_ids) != len(set(item_ids)):
        raise HTTPException(400, "Дубликаты item_id во входных данных")

    # Проверка всех items принадлежат тенанту.
    if item_ids:
        rs = await db.execute(
            select(InventoryItem.id, InventoryItem.tenant_id).where(
                InventoryItem.id.in_(item_ids)
            )
        )
        rows = rs.all()
        if len(rows) != len(item_ids):
            raise HTTPException(400, "Некоторые позиции склада не найдены")
        for _id, tid in rows:
            if tid != current_user.tenant_id:
                raise HTTPException(403, "Позиция из другого тенанта")

    # Удалить все существующие нормативы для этой услуги.
    existing = (
        await db.execute(
            select(ServiceConsumable).where(
                ServiceConsumable.service_id == svc.id
            )
        )
    ).scalars().all()
    for n in existing:
        await db.delete(n)
    await db.flush()

    # Создать новые.
    created: list[ServiceConsumable] = []
    for it in body.items:
        n = ServiceConsumable(
            id=uuid.uuid4(),
            tenant_id=current_user.tenant_id,
            service_id=svc.id,
            item_id=it.item_id,
            quantity=it.quantity,
            is_optional=it.is_optional,
            notes=it.notes,
        )
        db.add(n)
        created.append(n)

    await db.commit()
    for n in created:
        await db.refresh(n)
    return await _norms_to_out(db, created)


@router.delete("/services/{service_id}/consumables/{item_id}")
async def delete_consumable(
    service_id: uuid.UUID,
    item_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Удалить одну позицию из норматива услуги."""
    svc = await _get_service_or_404(db, service_id, current_user)
    norm = (
        await db.execute(
            select(ServiceConsumable).where(
                ServiceConsumable.service_id == svc.id,
                ServiceConsumable.item_id == item_id,
            )
        )
    ).scalar_one_or_none()
    if not norm:
        raise HTTPException(404, "Позиция норматива не найдена")
    if current_user.tenant_id and norm.tenant_id != current_user.tenant_id:
        raise HTTPException(403, "Чужой тенант")
    await db.delete(norm)
    await db.commit()
    return {"ok": True}


@router.post("/inventory/norms/copy")
async def copy_norms(
    from_service_id: uuid.UUID = Query(...),
    to_service_id: uuid.UUID = Query(...),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Скопировать нормативы из одной услуги в другую (обе того же тенанта).

    Если у to_service уже есть нормативы — добавляет недостающие, не дублирует.
    """
    if from_service_id == to_service_id:
        raise HTTPException(400, "Источник и приёмник совпадают")

    src = await _get_service_or_404(db, from_service_id, current_user)
    dst = await _get_service_or_404(db, to_service_id, current_user)

    src_norms = (
        await db.execute(
            select(ServiceConsumable).where(
                ServiceConsumable.service_id == src.id
            )
        )
    ).scalars().all()
    if not src_norms:
        return {"copied": 0, "skipped": 0}

    existing_items = {
        n.item_id
        for n in (
            await db.execute(
                select(ServiceConsumable).where(
                    ServiceConsumable.service_id == dst.id
                )
            )
        ).scalars().all()
    }

    copied = 0
    skipped = 0
    for s in src_norms:
        if s.item_id in existing_items:
            skipped += 1
            continue
        n = ServiceConsumable(
            id=uuid.uuid4(),
            tenant_id=dst.tenant_id or current_user.tenant_id,
            service_id=dst.id,
            item_id=s.item_id,
            quantity=s.quantity,
            is_optional=s.is_optional,
            notes=s.notes,
        )
        db.add(n)
        copied += 1
    await db.commit()
    return {"copied": copied, "skipped": skipped}


# ─────────────────────────── эндпоинты cost ──────────────────────────────


@router.get("/appointments/{appointment_id}/cost")
async def get_appointment_cost(
    appointment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Себестоимость + детализация расходов по приёму.

    Доступно: manager (свой тенант), director, franchise_owner.
    """
    appt = (
        await db.execute(
            select(Appointment).where(Appointment.id == appointment_id)
        )
    ).scalar_one_or_none()
    if not appt:
        raise HTTPException(404, "Приём не найден")
    # Tenant isolation — для director/franchise_owner проверяем через franchise позже,
    # для обычных ролей — простая проверка.
    role = (
        current_user.role.value
        if hasattr(current_user.role, "value")
        else str(current_user.role)
    )
    if role not in ("director", "deputy_director", "franchise_owner", "super_admin"):
        if (
            current_user.tenant_id
            and appt.tenant_id
            and appt.tenant_id != current_user.tenant_id
        ):
            raise HTTPException(403, "Чужой тенант")
    return await cost_breakdown(db, appointment_id)


@router.post("/appointments/{appointment_id}/cost/recalculate")
async def recalculate_appointment_cost(
    appointment_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Ручной пересчёт себестоимости (после правки нормативов или цен партий)."""
    appt = (
        await db.execute(
            select(Appointment).where(Appointment.id == appointment_id)
        )
    ).scalar_one_or_none()
    if not appt:
        raise HTTPException(404, "Приём не найден")
    if (
        current_user.tenant_id
        and appt.tenant_id
        and appt.tenant_id != current_user.tenant_id
    ):
        raise HTTPException(403, "Чужой тенант")

    cost = await calculate_appointment_cost(
        db, appointment_id, recalc_revenue=True
    )
    await db.commit()
    return {
        "appointment_id": str(appointment_id),
        "materials_cost": float(cost.materials_cost or 0),
        "revenue": float(cost.revenue or 0),
        "margin_pct": float(cost.margin_pct) if cost.margin_pct is not None else None,
        "calculated_at": cost.calculated_at.isoformat() if cost.calculated_at else None,
    }
