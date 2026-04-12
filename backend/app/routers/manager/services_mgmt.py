# ===== БЛОК: Управление услугами + синхронизация с МИС =====
# CRUD услуг, категории, массовое выставление бонусов, синхронизация с МИС Renovatio.
# /manager/services/*, /manager/mis/sync-services

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func, and_, Integer, cast, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.models.user import User
from app.models.clinic import Clinic
from app.models.service import Service
from app.schemas.manager import ServiceSchema, CreateServiceRequest, UpdateServiceRequest

router = APIRouter(tags=["manager:services"])


class SyncServicesResponse(BaseModel):
    synced: int
    added: int
    updated: int
    clinics: int
    details: list[dict]


class SetCategoryBonusRequest(BaseModel):
    category: str
    bonus_amount: float
    clinic_id: uuid.UUID | None = None


@router.get("/services/categories")
async def list_service_categories(
    clinic_id: uuid.UUID | None = None,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    filters = [Service.is_active == True]
    if clinic_id:
        filters.append(Service.clinic_id == clinic_id)
    result = await db.execute(
        select(Service.category, func.count(Service.id).label("total"),
            func.sum(cast(Service.bonus_amount > 0, Integer)).label("bonus_count"),
        )
        .where(and_(*filters)).group_by(Service.category)
        .order_by(func.sum(cast(Service.bonus_amount > 0, Integer)).desc(), Service.category.nulls_last())
    )
    return [{"category": r.category or "Без категории", "total": r.total, "bonus_count": int(r.bonus_count or 0)} for r in result.all()]


@router.get("/services/")
async def list_services(
    clinic_id: uuid.UUID | None = None,
    category: str | None = None,
    has_bonus: bool | None = None,
    search: str | None = None,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    filters = [Service.is_active == True]
    if clinic_id: filters.append(Service.clinic_id == clinic_id)
    if category is not None:
        filters.append(Service.category.is_(None) if category == "Без категории" else Service.category == category)
    if has_bonus is True: filters.append(Service.bonus_amount > 0)
    elif has_bonus is False: filters.append(Service.bonus_amount == 0)
    if search: filters.append(Service.name.ilike(f"%{search}%"))

    result = await db.execute(select(Service).where(and_(*filters)).order_by(Service.name).limit(500))
    return [
        {"id": str(s.id), "name": s.name, "code": s.code, "category": s.category or "Без категории",
         "clinic_id": str(s.clinic_id) if s.clinic_id else None, "bonus_amount": float(s.bonus_amount),
         "original_price": float(s.original_price) if s.original_price else None,
         "is_active": s.is_active, "mis_id": s.mis_id}
        for s in result.scalars().all()
    ]


@router.post("/services/", response_model=ServiceSchema, status_code=201)
async def create_service(
    body: CreateServiceRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(select(Service).where(Service.code == body.code.upper(), Service.clinic_id == body.clinic_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Услуга с таким кодом уже есть у этой клиники")
    svc = Service(name=body.name, code=body.code.upper(), bonus_amount=body.bonus_amount, clinic_id=body.clinic_id)
    db.add(svc)
    await db.commit()
    await db.refresh(svc)
    return ServiceSchema.model_validate(svc)


@router.patch("/services/{service_id}", response_model=ServiceSchema)
async def update_service(
    service_id: uuid.UUID,
    body: UpdateServiceRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Service).where(Service.id == service_id))
    svc = result.scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=404, detail="Услуга не найдена")
    if body.name is not None: svc.name = body.name
    if body.code is not None: svc.code = body.code.upper()
    if body.clinic_id is not None: svc.clinic_id = body.clinic_id
    if body.bonus_amount is not None: svc.bonus_amount = body.bonus_amount
    if body.is_active is not None: svc.is_active = body.is_active
    await db.commit()
    await db.refresh(svc)
    return ServiceSchema.model_validate(svc)


@router.delete("/services/{service_id}")
async def deactivate_service(
    service_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Service).where(Service.id == service_id))
    svc = result.scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=404, detail="Услуга не найдена")
    svc.is_active = False
    await db.commit()
    return {"status": "deactivated"}


@router.post("/services/set-category-bonus")
async def set_category_bonus(
    body: SetCategoryBonusRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    cat_filter = Service.category.is_(None) if body.category == "Без категории" else Service.category == body.category
    filters = [cat_filter, Service.is_active == True]
    if body.clinic_id: filters.append(Service.clinic_id == body.clinic_id)
    await db.execute(sa_update(Service).where(and_(*filters)).values(bonus_amount=body.bonus_amount))
    await db.commit()
    count_result = await db.execute(select(func.count(Service.id)).where(and_(*filters)))
    return {"updated": count_result.scalar(), "bonus_amount": body.bonus_amount}


@router.post("/mis/sync-services", response_model=SyncServicesResponse)
async def sync_services_from_mis(
    clinic_id: uuid.UUID | None = None,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    from app.services.mis_client import get_services
    q = select(Clinic).where(Clinic.mis_id.isnot(None))
    if clinic_id: q = q.where(Clinic.id == clinic_id)
    result = await db.execute(q)
    clinics = result.scalars().all()
    if not clinics:
        raise HTTPException(status_code=404, detail="Клиники с привязкой к МИС не на��дены")

    total_added = total_updated = 0
    details = []
    for clinic in clinics:
        mis_services = await get_services(clinic.mis_id)
        added = updated = 0
        for svc in mis_services:
            mis_svc_id = svc["service_id"]
            existing_result = await db.execute(select(Service).where(Service.mis_id == mis_svc_id, Service.clinic_id == clinic.id))
            existing = existing_result.scalar_one_or_none()
            price = float(svc.get("price") or svc.get("original_price") or 0)
            is_active = not svc.get("is_deleted", False) and not svc.get("is_hidden", False)
            title = svc["title"][:200]
            if existing:
                existing.name = title; existing.code = svc.get("code") or None
                existing.category = svc.get("category_title"); existing.original_price = price; existing.is_active = is_active
                updated += 1
            else:
                db.add(Service(name=title, code=svc.get("code") or None, mis_id=mis_svc_id,
                    category=svc.get("category_title"), original_price=price, clinic_id=clinic.id, bonus_amount=0, is_active=is_active))
                added += 1
        await db.commit()
        total_added += added; total_updated += updated
        details.append({"clinic": clinic.name, "mis_id": clinic.mis_id, "added": added, "updated": updated})

    return SyncServicesResponse(synced=total_added + total_updated, added=total_added, updated=total_updated, clinics=len(clinics), details=details)
