# ===== БЛОК: Скидки =====
# CRUD скидок. Независимый модуль — не влияет на бонусы.
# /manager/discounts/*

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.models.user import User
from app.models.clinic import Clinic
from app.models.service import Service
from app.models.discount import Discount

router = APIRouter(tags=["manager:discounts"])


class CreateDiscountRequest(BaseModel):
    name: str
    description: Optional[str] = None
    discount_type: str = "percent"
    discount_value: float
    applies_to: str = "all"
    service_id: Optional[str] = None
    clinic_id: Optional[str] = None
    is_active: bool = True
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None


class UpdateDiscountRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    discount_type: Optional[str] = None
    discount_value: Optional[float] = None
    applies_to: Optional[str] = None
    service_id: Optional[str] = None
    clinic_id: Optional[str] = None
    is_active: Optional[bool] = None
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None


@router.get("/discounts/", response_model=list[dict])
async def list_discounts(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Discount).order_by(Discount.created_at.desc()))
    out = []
    for d in result.scalars().all():
        service_name = None
        clinic_name = None
        if d.service_id:
            svc = (await db.execute(select(Service).where(Service.id == d.service_id))).scalar_one_or_none()
            service_name = svc.name if svc else None
        if d.clinic_id:
            cl = (await db.execute(select(Clinic).where(Clinic.id == d.clinic_id))).scalar_one_or_none()
            clinic_name = cl.name if cl else None
        out.append({
            "id": str(d.id), "name": d.name, "description": d.description,
            "discount_type": d.discount_type, "discount_value": float(d.discount_value),
            "applies_to": d.applies_to,
            "service_id": str(d.service_id) if d.service_id else None, "service_name": service_name,
            "clinic_id": str(d.clinic_id) if d.clinic_id else None, "clinic_name": clinic_name,
            "is_active": d.is_active,
            "valid_from": d.valid_from.isoformat() if d.valid_from else None,
            "valid_until": d.valid_until.isoformat() if d.valid_until else None,
            "created_at": d.created_at.isoformat(),
        })
    return out


@router.post("/discounts/", response_model=dict, status_code=201)
async def create_discount(
    body: CreateDiscountRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    if body.discount_type not in ("percent", "fixed"):
        raise HTTPException(status_code=400, detail="discount_type должен быть 'percent' или 'fixed'")
    if body.applies_to not in ("all", "service", "clinic"):
        raise HTTPException(status_code=400, detail="applies_to должен быть 'all', 'service' или 'clinic'")
    if body.discount_type == "percent" and not (0 < body.discount_value <= 100):
        raise HTTPException(status_code=400, detail="Процент скидки должен быть от 1 до 100")
    if body.discount_value <= 0:
        raise HTTPException(status_code=400, detail="Значение скидки должно быть положительным")
    d = Discount(
        name=body.name.strip(), description=body.description,
        discount_type=body.discount_type, discount_value=body.discount_value,
        applies_to=body.applies_to,
        service_id=uuid.UUID(body.service_id) if body.service_id else None,
        clinic_id=uuid.UUID(body.clinic_id) if body.clinic_id else None,
        is_active=body.is_active, valid_from=body.valid_from, valid_until=body.valid_until,
        created_by_id=current_user.id,
    )
    db.add(d)
    await db.commit()
    await db.refresh(d)
    return {"id": str(d.id), "name": d.name, "discount_type": d.discount_type,
            "discount_value": float(d.discount_value), "applies_to": d.applies_to,
            "is_active": d.is_active, "created_at": d.created_at.isoformat()}


@router.patch("/discounts/{discount_id}", response_model=dict)
async def update_discount(
    discount_id: uuid.UUID,
    body: UpdateDiscountRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Discount).where(Discount.id == discount_id))
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(status_code=404, detail="Скидка не найдена")
    if body.name is not None: d.name = body.name.strip()
    if body.description is not None: d.description = body.description
    if body.discount_type is not None: d.discount_type = body.discount_type
    if body.discount_value is not None: d.discount_value = body.discount_value
    if body.applies_to is not None: d.applies_to = body.applies_to
    if body.service_id is not None: d.service_id = uuid.UUID(body.service_id) if body.service_id else None
    if body.clinic_id is not None: d.clinic_id = uuid.UUID(body.clinic_id) if body.clinic_id else None
    if body.is_active is not None: d.is_active = body.is_active
    if body.valid_from is not None: d.valid_from = body.valid_from
    if body.valid_until is not None: d.valid_until = body.valid_until
    await db.commit()
    await db.refresh(d)
    return {"id": str(d.id), "name": d.name, "is_active": d.is_active}


@router.delete("/discounts/{discount_id}")
async def delete_discount(
    discount_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Discount).where(Discount.id == discount_id))
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(status_code=404, detail="Скидка не найдена")
    await db.delete(d)
    await db.commit()
    return {"status": "deleted"}
