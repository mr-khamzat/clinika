"""
Роутер приглашённого врача (visiting_doctor) и настройки (admin).
POST /visiting/admin/settings      — создать/обновить настройки visiting_doctor
GET  /visiting/admin/settings      — список всех visiting_doctor
GET  /visiting/my-visits           — мои приёмы (для врача)
GET  /visiting/my-income           — мой доход (для врача)
POST /visiting/admin/complete      — завершить приём + начислить в ledger
"""
import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.core.deps import get_current_user, require_role
from app.models.user import User, UserRole
from app.models.external_doctor import VisitingDoctorSettings
from app.models.doctor import Appointment, AppointmentStatus
from app.models.ledger import LedgerEntry

router = APIRouter(prefix="/visiting", tags=["visiting_doctor"])

_admin = Depends(require_role("admin", "manager", "super_admin", "supervisor"))


class VisitingSettingsCreate(BaseModel):
    doctor_id: uuid.UUID
    clinic_id: uuid.UUID
    price_per_visit: float
    doctor_percent: float = 70.0
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class CompleteVisitBody(BaseModel):
    appointment_id: uuid.UUID


@router.post("/admin/settings", status_code=201)
async def create_visiting_settings(
    body: VisitingSettingsCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Проверить, нет ли уже активной настройки для этой пары doctor+clinic
    existing = await db.scalar(
        select(VisitingDoctorSettings).where(
            VisitingDoctorSettings.tenant_id == current_user.tenant_id,
            VisitingDoctorSettings.doctor_id == body.doctor_id,
            VisitingDoctorSettings.clinic_id == body.clinic_id,
            VisitingDoctorSettings.is_active == True,
        )
    )
    if existing:
        # Обновить существующую
        existing.price_per_visit = Decimal(str(body.price_per_visit))
        existing.doctor_percent = Decimal(str(body.doctor_percent))
        existing.start_date = body.start_date
        existing.end_date = body.end_date
        await db.commit()
        return {"id": str(existing.id), "updated": True}

    settings = VisitingDoctorSettings(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        doctor_id=body.doctor_id,
        clinic_id=body.clinic_id,
        price_per_visit=Decimal(str(body.price_per_visit)),
        doctor_percent=Decimal(str(body.doctor_percent)),
        start_date=body.start_date,
        end_date=body.end_date,
        is_active=True,
        created_by_id=current_user.id,
    )
    db.add(settings)
    await db.commit()
    await db.refresh(settings)
    return {"id": str(settings.id), "created": True}


@router.get("/admin/settings")
async def list_visiting_settings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(VisitingDoctorSettings).where(
            VisitingDoctorSettings.tenant_id == current_user.tenant_id,
        ).order_by(VisitingDoctorSettings.created_at.desc())
    )
    settings = result.scalars().all()
    out = []
    for s in settings:
        doctor = await db.get(User, s.doctor_id)
        out.append({
            "id": str(s.id),
            "doctor_id": str(s.doctor_id),
            "doctor_name": doctor.full_name if doctor else "—",
            "clinic_id": str(s.clinic_id),
            "price_per_visit": float(s.price_per_visit),
            "doctor_percent": float(s.doctor_percent),
            "start_date": s.start_date.isoformat() if s.start_date else None,
            "end_date": s.end_date.isoformat() if s.end_date else None,
            "is_active": s.is_active,
        })
    return out


@router.get("/my-visits")
async def get_my_visits(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Для visiting_doctor — список своих приёмов через doctors table."""
    from app.models.doctor import Doctor
    # Найти doctor record для этого user
    doctor = await db.scalar(
        select(Doctor).where(Doctor.user_id == current_user.id)
    )
    if not doctor:
        return []

    result = await db.execute(
        select(Appointment).where(
            Appointment.tenant_id == current_user.tenant_id,
            Appointment.doctor_id == doctor.id,
        ).order_by(Appointment.appointment_date.desc()).limit(100)
    )
    appointments = result.scalars().all()
    return [
        {
            "id": str(a.id),
            "patient_name": a.patient_name,
            "patient_phone": a.patient_phone,
            "appointment_date": a.appointment_date.isoformat(),
            "start_time": str(a.start_time),
            "end_time": str(a.end_time),
            "status": a.status,
            "price": float(a.price) if a.price else None,
        }
        for a in appointments
    ]


@router.get("/my-income")
async def get_my_income(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LedgerEntry).where(
            LedgerEntry.tenant_id == current_user.tenant_id,
            LedgerEntry.user_id == current_user.id,
            LedgerEntry.operation_type.in_(["DOCTOR_SHARE", "VISIT_REVENUE", "BONUS_ACCRUED"]),
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


@router.post("/admin/complete-visit")
async def complete_visit(
    body: CompleteVisitBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Завершить приём visiting_doctor и начислить в ledger."""
    appointment = await db.get(Appointment, body.appointment_id)
    if not appointment or appointment.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Запись не найдена")
    if appointment.status == AppointmentStatus.COMPLETED:
        raise HTTPException(400, "Приём уже завершён")

    appointment.status = AppointmentStatus.COMPLETED
    appointment.updated_at = datetime.utcnow()

    # Найти visiting_doctor settings
    from app.models.doctor import Doctor
    doctor_record = await db.get(Doctor, appointment.doctor_id)
    if not doctor_record or not doctor_record.user_id:
        await db.commit()
        return {"status": "completed", "ledger": False}

    settings = await db.scalar(
        select(VisitingDoctorSettings).where(
            VisitingDoctorSettings.tenant_id == current_user.tenant_id,
            VisitingDoctorSettings.doctor_id == doctor_record.user_id,
            VisitingDoctorSettings.clinic_id == appointment.clinic_id,
            VisitingDoctorSettings.is_active == True,
        )
    )

    price = appointment.price or (settings.price_per_visit if settings else None)
    if price and settings:
        price = Decimal(str(price))
        pct = Decimal(str(settings.doctor_percent)) / 100
        doctor_share = (price * pct).quantize(Decimal("0.01"))
        clinic_share = price - doctor_share

        # VISIT_REVENUE — клинике (записываем на создавшего)
        db.add(LedgerEntry(
            id=uuid.uuid4(),
            tenant_id=current_user.tenant_id,
            user_id=current_user.id,
            amount=price,
            operation_type="VISIT_REVENUE",
            reference_id=appointment.id,
            reference_type="appointment",
            clinic_id=appointment.clinic_id,
            description=f"Приём {doctor_record.full_name} | {appointment.appointment_date}",
        ))
        # DOCTOR_SHARE — врачу
        db.add(LedgerEntry(
            id=uuid.uuid4(),
            tenant_id=current_user.tenant_id,
            user_id=doctor_record.user_id,
            amount=doctor_share,
            operation_type="DOCTOR_SHARE",
            reference_id=appointment.id,
            reference_type="appointment",
            clinic_id=appointment.clinic_id,
            description=f"Доля врача {int(settings.doctor_percent)}% от {price} ₽",
        ))
        # CLINIC_SHARE — тоже записываем для отчётов
        db.add(LedgerEntry(
            id=uuid.uuid4(),
            tenant_id=current_user.tenant_id,
            user_id=current_user.id,
            amount=clinic_share,
            operation_type="CLINIC_SHARE",
            reference_id=appointment.id,
            reference_type="appointment",
            clinic_id=appointment.clinic_id,
            description=f"Доля клиники от приёма | {appointment.appointment_date}",
        ))

    await db.commit()
    return {
        "status": "completed",
        "ledger": bool(price and settings),
        "price": float(price) if price else None,
    }
