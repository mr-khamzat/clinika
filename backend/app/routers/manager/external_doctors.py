# ===== БЛОК: External Doctors MVP — Manager endpoints =====
# Тонкая обёртка над уже существующими ролями partner_doctor / visiting_doctor.
#
# Endpoints:
#   GET   /manager/external-doctors              — список внешних врачей тенанта
#   POST  /manager/external-doctors              — пригласить внешнего врача
#   PATCH /manager/external-doctors/{id}         — изменить ставку/ИНН/активность
#   GET   /manager/acquisition-managers          — список менеджеров привлечения
#   POST  /manager/acquisition-managers          — создать менеджера привлечения
#
# Совместимость: external_doctor ↔ partner_doctor (исторический алиас).

from __future__ import annotations

import uuid
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.core.security import hash_password
from app.models.user import User, UserRole

router = APIRouter(tags=["manager:external_doctors"])


# ─── Schemas ───────────────────────────────────────────────────────────────


class ExternalRate(BaseModel):
    """Ставка внешнего врача.

    type=percent  → % от приёма (value: 0..100)
    type=fixed    → фиксированная сумма за приём (value: руб)
    """
    type: Literal["percent", "fixed"] = "percent"
    value: float = Field(ge=0)
    currency: str = "RUB"


class ExternalDoctorInvite(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=4, max_length=200)
    phone_number: Optional[str] = None
    email: Optional[str] = None
    specialization: Optional[str] = None
    external_doctor_inn: Optional[str] = Field(default=None, max_length=20)
    external_doctor_rate: Optional[ExternalRate] = None
    manager_id: Optional[uuid.UUID] = None  # acquisition_manager, кто привёл


class ExternalDoctorUpdate(BaseModel):
    external_doctor_inn: Optional[str] = Field(default=None, max_length=20)
    external_doctor_rate: Optional[ExternalRate] = None
    external_doctor_active: Optional[bool] = None
    is_active: Optional[bool] = None
    manager_id: Optional[uuid.UUID] = None


class AcquisitionManagerInvite(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=4, max_length=200)
    phone_number: Optional[str] = None
    email: Optional[str] = None
    bonus_percent: Optional[float] = Field(default=None, ge=0, le=100)


# ─── Helpers ───────────────────────────────────────────────────────────────


def _serialize_external(u: User) -> dict:
    role_val = u.role.value if hasattr(u.role, "value") else str(u.role)
    return {
        "id": str(u.id),
        "full_name": u.full_name,
        "username": u.username,
        "phone_number": u.phone_number,
        "email": u.email,
        "specialization": u.specialization,
        "role": role_val,
        "doctor_type": u.doctor_type,
        "external_doctor_inn": getattr(u, "external_doctor_inn", None),
        "external_doctor_rate": getattr(u, "external_doctor_rate", None),
        "external_doctor_active": getattr(u, "external_doctor_active", True),
        "is_active": u.is_active,
        "is_suspended": u.is_suspended,
        "manager_id": str(u.manager_id) if u.manager_id else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


def _serialize_manager(u: User) -> dict:
    return {
        "id": str(u.id),
        "full_name": u.full_name,
        "username": u.username,
        "phone_number": u.phone_number,
        "email": u.email,
        "bonus_percent": float(u.bonus_percent) if u.bonus_percent is not None else None,
        "is_active": u.is_active,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


# ─── External doctors CRUD ─────────────────────────────────────────────────


@router.get("/external-doctors")
async def list_external_doctors(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Внешние врачи тенанта (роль partner_doctor — исторический алиас external_doctor)."""
    rows = (await db.execute(
        select(User).where(
            User.tenant_id == current_user.tenant_id,
            User.role == UserRole.PARTNER_DOCTOR,
        ).order_by(User.created_at.desc())
    )).scalars().all()
    return [_serialize_external(u) for u in rows]


@router.post("/external-doctors", status_code=201)
async def invite_external_doctor(
    body: ExternalDoctorInvite,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Пригласить внешнего врача (создаёт user с ролью partner_doctor)."""
    # Уникальность username
    existing = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Логин уже занят")

    # Менеджер привлечения должен быть в том же тенанте и иметь роль acquisition_manager
    if body.manager_id:
        mgr = await db.get(User, body.manager_id)
        if not mgr or mgr.tenant_id != current_user.tenant_id:
            raise HTTPException(status_code=400, detail="Менеджер привлечения не найден")
        mgr_role_val = mgr.role.value if hasattr(mgr.role, "value") else str(mgr.role)
        if mgr_role_val not in ("acquisition_manager", "manager", "super_admin"):
            raise HTTPException(status_code=400, detail="Указанный пользователь не менеджер привлечения")

    new_user = User(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        full_name=body.full_name,
        username=body.username,
        password_hash=hash_password(body.password),
        # pwdmust01: пароль задал админ → требуем смену при первом входе
        password_must_change=True,
        phone_number=body.phone_number,
        email=body.email,
        specialization=body.specialization,
        role=UserRole.PARTNER_DOCTOR,
        doctor_type="external",
        external_doctor_inn=body.external_doctor_inn,
        external_doctor_rate=body.external_doctor_rate.model_dump() if body.external_doctor_rate else None,
        external_doctor_active=True,
        manager_id=body.manager_id,
        is_active=True,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return _serialize_external(new_user)


@router.patch("/external-doctors/{doctor_id}")
async def update_external_doctor(
    doctor_id: uuid.UUID,
    body: ExternalDoctorUpdate,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Изменить ставку, ИНН, активность или менеджера внешнего врача."""
    doc = await db.get(User, doctor_id)
    if not doc or doc.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Внешний врач не найден")
    if doc.role != UserRole.PARTNER_DOCTOR:
        raise HTTPException(status_code=400, detail="Пользователь не является внешним врачом")

    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Нечего обновлять")

    if "external_doctor_inn" in payload:
        doc.external_doctor_inn = payload["external_doctor_inn"]
    if "external_doctor_rate" in payload:
        rate = payload["external_doctor_rate"]
        doc.external_doctor_rate = rate if isinstance(rate, dict) or rate is None else rate.model_dump()
    if "external_doctor_active" in payload:
        doc.external_doctor_active = bool(payload["external_doctor_active"])
    if "is_active" in payload:
        doc.is_active = bool(payload["is_active"])
    if "manager_id" in payload:
        new_mgr_id = payload["manager_id"]
        if new_mgr_id is not None:
            mgr = await db.get(User, new_mgr_id)
            if not mgr or mgr.tenant_id != current_user.tenant_id:
                raise HTTPException(status_code=400, detail="Менеджер не найден")
        doc.manager_id = new_mgr_id

    await db.commit()
    await db.refresh(doc)
    return _serialize_external(doc)


# ─── Acquisition managers ──────────────────────────────────────────────────


@router.get("/acquisition-managers")
async def list_acquisition_managers(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Менеджеры привлечения тенанта.

    На момент MVP реальная enum-роль 'acquisition_manager' может отсутствовать
    в БД (если миграция external01 не применена) — тогда возвращаем рекрутеров
    как fallback (логически они выполняют ту же функцию).
    """
    # Сначала пробуем найти именно acquisition_manager
    rows: list[User] = []
    try:
        rows = (await db.execute(
            select(User).where(
                User.tenant_id == current_user.tenant_id,
                User.role == "acquisition_manager",
            ).order_by(User.full_name)
        )).scalars().all()
    except Exception:
        rows = []

    # Fallback на рекрутеров (на ранней стадии MVP)
    if not rows:
        rows = (await db.execute(
            select(User).where(
                User.tenant_id == current_user.tenant_id,
                User.role == UserRole.RECRUITER,
            ).order_by(User.full_name)
        )).scalars().all()

    return [_serialize_manager(u) for u in rows]


@router.post("/acquisition-managers", status_code=201)
async def invite_acquisition_manager(
    body: AcquisitionManagerInvite,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Создать менеджера привлечения.

    Если enum-роль acquisition_manager доступна — создаём с ней.
    Иначе fallback на recruiter (исторически тот же функционал).
    """
    existing = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Логин уже занят")

    # Пробуем acquisition_manager, иначе recruiter
    try:
        role = UserRole("acquisition_manager")  # type: ignore[arg-type]
    except ValueError:
        role = UserRole.RECRUITER

    from decimal import Decimal
    new_user = User(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        full_name=body.full_name,
        username=body.username,
        password_hash=hash_password(body.password),
        # pwdmust01: пароль задал админ → требуем смену при первом входе
        password_must_change=True,
        phone_number=body.phone_number,
        email=body.email,
        role=role,
        bonus_percent=Decimal(str(body.bonus_percent)) if body.bonus_percent is not None else None,
        is_active=True,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return _serialize_manager(new_user)
