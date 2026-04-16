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
    q = select(Clinic).order_by(Clinic.name)
    if current_user.tenant_id is not None:
        q = q.where(Clinic.tenant_id == current_user.tenant_id)
    # Управляющий клиники видит только свою клинику
    if current_user.clinic_id is not None:
        q = q.where(Clinic.id == current_user.clinic_id)
    result = await db.execute(q)
    return [ClinicResponse.model_validate(c) for c in result.scalars().all()]


@router.patch("/clinics/{clinic_id}", response_model=ClinicResponse)
async def update_clinic(
    clinic_id: uuid.UUID,
    body: UpdateClinicRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    q = select(Clinic).where(Clinic.id == clinic_id)
    if current_user.tenant_id is not None:
        q = q.where(Clinic.tenant_id == current_user.tenant_id)
    result = await db.execute(q)
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

import secrets
import string


@router.post("/clinics/{clinic_id}/onboard-manager", response_model=dict, status_code=201)
async def onboard_clinic_manager(
    clinic_id: uuid.UUID,
    body: dict,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Создать управляющего для клиники. Возвращает логин+пароль единожды."""
    from app.models.user import UserRole
    from app.core.security import hash_password

    # Проверяем что клиника принадлежит тенанту
    cl = (await db.execute(select(Clinic).where(
        Clinic.id == clinic_id, Clinic.tenant_id == current_user.tenant_id
    ))).scalar_one_or_none()
    if not cl:
        raise HTTPException(status_code=404, detail="Клиника не найдена")

    # Проверяем — управляющий уже назначен?
    existing = (await db.execute(select(User).where(
        User.clinic_id == clinic_id,
        User.role == UserRole.MANAGER,
        User.tenant_id == current_user.tenant_id,
        User.is_active == True,
    ))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="У клиники уже есть управляющий")

    full_name = (body.get("full_name") or "").strip()
    phone = (body.get("phone_number") or "").strip()
    if not full_name:
        raise HTTPException(status_code=400, detail="Укажите ФИО")

    # Генерируем логин из телефона (если есть) или из имени
    if phone:
        base = phone.replace("+", "").replace("-", "").replace(" ", "")[-10:]
        username = f"fmgr_{base}"
    else:
        parts = full_name.lower().split()
        base = parts[0][:8] if parts else "manager"
        username = f"fmgr_{base}"

    # Гарантируем уникальность логина
    attempt = username
    for i in range(1, 20):
        exists = (await db.execute(select(User).where(User.username == attempt))).scalar_one_or_none()
        if not exists:
            username = attempt
            break
        attempt = f"{username}{i}"

    # Генерируем пароль
    alphabet = string.ascii_letters + string.digits
    password = "".join(secrets.choice(alphabet) for _ in range(10))

    new_user = User(
        tenant_id=current_user.tenant_id,
        clinic_id=clinic_id,
        full_name=full_name,
        phone_number=phone or None,
        username=username,
        password_hash=hash_password(password),
        role=UserRole.MANAGER,
        is_active=True,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return {
        "user_id": str(new_user.id),
        "full_name": new_user.full_name,
        "username": username,
        "password": password,
        "clinic_id": str(clinic_id),
        "clinic_name": cl.name,
    }


@router.get("/clinics/{clinic_id}/manager", response_model=dict)
async def get_clinic_manager(
    clinic_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Получить управляющего клиники (без пароля)."""
    from app.models.user import UserRole
    cl = (await db.execute(select(Clinic).where(
        Clinic.id == clinic_id, Clinic.tenant_id == current_user.tenant_id
    ))).scalar_one_or_none()
    if not cl:
        raise HTTPException(status_code=404, detail="Клиника не найдена")

    mgr = (await db.execute(select(User).where(
        User.clinic_id == clinic_id,
        User.role == UserRole.MANAGER,
        User.tenant_id == current_user.tenant_id,
        User.is_active == True,
    ))).scalar_one_or_none()
    if not mgr:
        return {"manager": None}
    return {
        "manager": {
            "id": str(mgr.id),
            "full_name": mgr.full_name,
            "username": mgr.username,
            "phone_number": mgr.phone_number,
        }
    }


@router.delete("/clinics/{clinic_id}/manager")
async def remove_clinic_manager(
    clinic_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Деактивировать управляющего клиники."""
    from app.models.user import UserRole
    mgr = (await db.execute(select(User).where(
        User.clinic_id == clinic_id,
        User.role == UserRole.MANAGER,
        User.tenant_id == current_user.tenant_id,
        User.is_active == True,
    ))).scalar_one_or_none()
    if not mgr:
        raise HTTPException(status_code=404, detail="Управляющий не найден")
    mgr.is_active = False
    await db.commit()
    return {"status": "removed"}
