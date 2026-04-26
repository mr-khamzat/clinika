"""
Роутер менеджера привлечения (acquisition_manager).
GET  /acquisition/stats         — дашборд
GET  /acquisition/my-doctors    — мои врачи
POST /acquisition/requests      — создать заявку на врача
GET  /acquisition/requests      — мои заявки
GET  /acquisition/income        — доход (ledger)
"""
import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.core.deps import get_current_user, require_role
from app.models.user import User, UserRole
from app.models.external_doctor import DoctorRequest
from app.models.ledger import LedgerEntry
from app.models.referral import Referral, ReferralStatus
from app.models.bonus import Bonus

router = APIRouter(prefix="/acquisition", tags=["acquisition_manager"])

_mgr = Depends(require_role("acquisition_manager", "manager", "super_admin", "supervisor"))


class DoctorRequestCreate(BaseModel):
    doctor_name: str
    phone: Optional[str] = None
    clinic_name: Optional[str] = None
    specialization: Optional[str] = None
    notes: Optional[str] = None


class DoctorRequestOut(BaseModel):
    id: uuid.UUID
    doctor_name: str
    phone: Optional[str]
    clinic_name: Optional[str]
    specialization: Optional[str]
    notes: Optional[str]
    status: str
    created_at: datetime
    approved_at: Optional[datetime]

    class Config:
        from_attributes = True


@router.get("/stats")
async def get_acquisition_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Число привлечённых врачей (recruiter_id = текущий пользователь)
    doctors_count = await db.scalar(
        select(func.count(User.id)).where(
            User.tenant_id == current_user.tenant_id,
            User.manager_id == current_user.id,
            User.role.in_(["external_doctor", "visiting_doctor", "doctor"]),
        )
    ) or 0

    # Заявки
    requests_total = await db.scalar(
        select(func.count(DoctorRequest.id)).where(
            DoctorRequest.tenant_id == current_user.tenant_id,
            DoctorRequest.manager_id == current_user.id,
        )
    ) or 0
    requests_pending = await db.scalar(
        select(func.count(DoctorRequest.id)).where(
            DoctorRequest.tenant_id == current_user.tenant_id,
            DoctorRequest.manager_id == current_user.id,
            DoctorRequest.status == "pending",
        )
    ) or 0

    # Доход из ledger
    income = await db.scalar(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(
            LedgerEntry.tenant_id == current_user.tenant_id,
            LedgerEntry.user_id == current_user.id,
            LedgerEntry.amount > 0,
        )
    ) or 0

    return {
        "doctors_count": doctors_count,
        "requests_total": requests_total,
        "requests_pending": requests_pending,
        "total_income": float(income),
    }


@router.get("/my-doctors")
async def get_my_doctors(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(
            User.tenant_id == current_user.tenant_id,
            User.manager_id == current_user.id,
        ).order_by(User.created_at.desc())
    )
    doctors = result.scalars().all()
    return [
        {
            "id": str(d.id),
            "full_name": d.full_name,
            "phone_number": d.phone_number,
            "role": d.role,
            "doctor_type": d.doctor_type,
            "is_active": d.is_active,
            "created_at": d.created_at.isoformat(),
        }
        for d in doctors
    ]


@router.post("/requests", status_code=201)
async def create_doctor_request(
    body: DoctorRequestCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    req = DoctorRequest(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        manager_id=current_user.id,
        doctor_name=body.doctor_name,
        phone=body.phone,
        clinic_name=body.clinic_name,
        specialization=body.specialization,
        notes=body.notes,
        status="pending",
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return {"id": str(req.id), "status": req.status}


@router.get("/requests")
async def get_my_requests(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DoctorRequest).where(
            DoctorRequest.tenant_id == current_user.tenant_id,
            DoctorRequest.manager_id == current_user.id,
        ).order_by(DoctorRequest.created_at.desc())
    )
    reqs = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "doctor_name": r.doctor_name,
            "phone": r.phone,
            "clinic_name": r.clinic_name,
            "specialization": r.specialization,
            "status": r.status,
            "created_at": r.created_at.isoformat(),
            "approved_at": r.approved_at.isoformat() if r.approved_at else None,
        }
        for r in reqs
    ]


@router.get("/income")
async def get_income(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LedgerEntry).where(
            LedgerEntry.tenant_id == current_user.tenant_id,
            LedgerEntry.user_id == current_user.id,
        ).order_by(LedgerEntry.created_at.desc()).limit(100)
    )
    entries = result.scalars().all()
    total = sum(float(e.amount) for e in entries if e.amount > 0)
    return {
        "total": total,
        "entries": [
            {
                "id": str(e.id),
                "amount": float(e.amount),
                "operation_type": e.operation_type,
                "description": e.description,
                "created_at": e.created_at.isoformat(),
            }
            for e in entries
        ],
    }
