# ===== БЛОК: Управление персоналом =====
# CRUD администраторов (admin/manager). Назначение клиник.
# /manager/admins/*, /manager/managers/

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.models.user import User, UserRole
from app.models.clinic import Clinic
from app.schemas.manager import (
    AssignClinicRequest, CreateAdminRequest, UpdateAdminRequest,
)
from app.schemas.user import UserResponse

router = APIRouter(tags=["manager:staff"])


@router.patch("/admins/{admin_id}/assign-clinic")
async def assign_clinic(
    admin_id: uuid.UUID,
    body: AssignClinicRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin:
        raise HTTPException(status_code=404, detail="Администратор не найден")
    if body.clinic_id is not None:
        clinic_result = await db.execute(select(Clinic).where(Clinic.id == body.clinic_id))
        if not clinic_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Клиника не найдена")
    admin.clinic_id = body.clinic_id
    await db.commit()
    await db.refresh(admin)
    return UserResponse.model_validate(admin)


@router.post("/admins/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_admin(
    body: CreateAdminRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    from app.core.security import hash_password
    if body.telegram_id:
        existing = await db.execute(select(User).where(User.telegram_id == body.telegram_id))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Telegram ID уже используется")
    if body.username:
        existing_u = await db.execute(select(User).where(User.username == body.username))
        if existing_u.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Логин уже занят")
    if body.clinic_id is not None:
        clinic_check = await db.execute(select(Clinic).where(Clinic.id == body.clinic_id))
        if not clinic_check.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Клиника не найдена")

    new_user = User(
        telegram_id=body.telegram_id or None, username=body.username or None,
        password_hash=hash_password(body.password) if body.password else None,
        full_name=body.full_name, phone_number=body.phone_number,
        date_of_birth=body.date_of_birth, clinic_id=body.clinic_id,
        role=body.role, is_active=True, category=body.category,
    )
    if current_user.clinic_id is not None:
        new_user.clinic_id = current_user.clinic_id
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return UserResponse.model_validate(new_user)


@router.patch("/admins/{admin_id}", response_model=UserResponse)
async def update_admin(
    admin_id: uuid.UUID,
    body: UpdateAdminRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    from app.core.security import hash_password
    result = await db.execute(select(User).where(User.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin:
        raise HTTPException(status_code=404, detail="Администратор не найден")
    if current_user.clinic_id is not None and admin.clinic_id != current_user.clinic_id:
        raise HTTPException(status_code=403, detail="Нет доступа к этому сотруднику")

    if body.full_name is not None: admin.full_name = body.full_name
    if body.username is not None: admin.username = body.username
    if body.password: admin.password_hash = hash_password(body.password)
    if 'phone_number' in body.model_fields_set: admin.phone_number = body.phone_number
    if body.date_of_birth is not None: admin.date_of_birth = body.date_of_birth
    if body.role is not None: admin.role = body.role
    if body.is_active is not None: admin.is_active = body.is_active
    if body.unset_clinic:
        admin.clinic_id = None
    elif body.clinic_id is not None:
        clinic_check = await db.execute(select(Clinic).where(Clinic.id == body.clinic_id))
        if not clinic_check.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Клиника не найдена")
        admin.clinic_id = body.clinic_id
    if body.category is not None: admin.category = body.category

    await db.commit()
    await db.refresh(admin)
    return UserResponse.model_validate(admin)


@router.delete("/admins/{admin_id}")
async def deactivate_admin(
    admin_id: uuid.UUID,
    hard: bool = Query(False),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    if admin_id == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя удалить собственный аккаунт")
    result = await db.execute(select(User).where(User.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin:
        raise HTTPException(status_code=404, detail="Администратор не найден")
    if current_user.clinic_id is not None and admin.clinic_id != current_user.clinic_id:
        raise HTTPException(status_code=403, detail="Нет доступа к этому сотруднику")

    if hard:
        admin.is_active = False
        admin.username = None; admin.telegram_id = None; admin.phone_number = None
        admin.password_hash = None; admin.full_name = "[Удалён]"; admin.clinic_id = None
        await db.commit()
        return {"status": "deleted"}

    admin.is_active = False
    await db.commit()
    return {"status": "deactivated"}


@router.get("/managers/", response_model=list[dict])
async def list_managers(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.role == UserRole.MANAGER, User.is_active == True))
    return [{"id": str(u.id), "full_name": u.full_name, "username": u.username} for u in result.scalars().all()]
