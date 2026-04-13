# ===== БЛОК: Управление клиниками =====
# CRUD клиник для руководителя.
# /manager/clinics/*

import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.models.user import User
from app.models.clinic import Clinic
from app.schemas.manager import CreateClinicRequest, UpdateClinicRequest, ClinicResponse
from app.core.limits import check_plan_limit

router = APIRouter(tags=["manager:clinics"])


@router.get("/clinics/", response_model=list[ClinicResponse])
async def list_clinics(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Clinic).order_by(Clinic.name))
    return [ClinicResponse.model_validate(c) for c in result.scalars().all()]


@router.patch("/clinics/{clinic_id}", response_model=ClinicResponse)
async def update_clinic(
    clinic_id: uuid.UUID,
    body: UpdateClinicRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Clinic).where(Clinic.id == clinic_id))
    clinic = result.scalar_one_or_none()
    if not clinic:
        raise HTTPException(status_code=404, detail="Клиника не найдена")
    if body.name is not None: clinic.name = body.name
    if body.address is not None: clinic.address = body.address
    if body.phone is not None: clinic.phone = body.phone
    if body.is_active is not None: clinic.is_active = body.is_active
    await db.commit()
    await db.refresh(clinic)
    return ClinicResponse.model_validate(clinic)


@router.post("/clinics/", response_model=ClinicResponse, status_code=201)
async def create_clinic(
    body: CreateClinicRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    # Проверяем лимит клиник по тарифу
    await check_plan_limit("clinics", current_user.tenant_id, db)
    new_clinic = Clinic(name=body.name, address=body.address, phone=body.phone, tenant_id=current_user.tenant_id)
    db.add(new_clinic)
    await db.commit()
    await db.refresh(new_clinic)
    return ClinicResponse.model_validate(new_clinic)
